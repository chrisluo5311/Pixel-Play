import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Player, Track } from '../types'
import { PixelArt } from './pixel'
import {
  dockColumns,
  equalizer,
  formatTime,
  ipcCommand,
  ipcSucceeded,
  parsePlaylist,
  parseProgress,
  progressBar,
  trackLabel,
  truncateToWidth,
} from './player'
import { SKINS } from './skins.gen'

const PANE = 'pixel-player'
const FRAME_MS = 250
// Inline above the prompt: a half-size sprite beside the controls fits in this many rows.
const INLINE_ROWS = 12

const STOPPED: Player = { status: 'stopped', index: 0, title: '', position: -1, duration: -1 }
const failed = (index: number, message: string): Player => ({ ...STOPPED, index, status: 'error', message })

const player = atom({ plugin: 'pixel-player', key: 'player' } as const, STOPPED)
const playlist = atom({ plugin: 'pixel-player', key: 'playlist' } as const, [] as Track[])
const skin = atom({ plugin: 'pixel-player', key: 'skin' } as const, SKINS[0]?.id ?? '')
const frame = atom({ plugin: 'pixel-player', key: 'frame' } as const, 0)
const volume = atom({ plugin: 'pixel-player', key: 'volume' } as const, 60)

const HELP = [
  '/music              open the player pane',
  '/music play [n]     play the playlist (from track n)',
  '/music pause        pause, or resume when paused',
  '/music resume       resume a paused track',
  '/music stop | next | prev',
  '/music add <url>    append a YouTube link, audio URL or file to playlist.txt',
  '/music reload       re-read playlist.txt',
  '/music skins        list the skins',
  '/music skin [name]  next skin, or one by name or number',
  '/music vol <0-100>  volume, from the next track on',
].join('\n')

// Playback lives in this module: a reload kills the child and starts over.
let stream: AsyncGenerator<unknown, unknown> | undefined
let generation = 0
let ticker: { cancel: () => void } | undefined
let titles: Record<string, string> = {}
// mpv's JSON IPC socket for the running child; one name per module load.
let socket: string | undefined
const SOCKET_ID = Math.random().toString(36).slice(2, 8)

type $ = EngineInterface

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'music', description: 'Pixel-art music player: play, stop, next, skin, vol' })
    await restoreState($)
    // Whatever was playing before a reload is gone with the old module.
    await update($, player, () => STOPPED)

    return next(e)
  })

  on('command.run', { command: 'music' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const arg = rest.join(' ')

    switch (verb.toLowerCase()) {
      case '':
        await openPane($, e.presentation.columns)
        return { text: 'Pixel Player opened. /music help lists the commands.' }
      case 'help':
        return { text: HELP }
      case 'play': {
        if (!arg && (await read($, player)).status === 'paused') return { text: await resume($) }
        const list = await loadPlaylist($)
        if (list.length === 0) return { text: emptyPlaylist() }
        const n = arg ? Number(arg) - 1 : (await read($, player)).index
        void play($, Number.isInteger(n) && n >= 0 && n < list.length ? n : 0)
        await openPane($, e.presentation.columns)
        return { text: `Playing track ${(Number.isInteger(n) && n >= 0 && n < list.length ? n : 0) + 1}.` }
      }
      case 'pause':
        return { text: (await read($, player)).status === 'paused' ? await resume($) : await pause($) }
      case 'resume':
        return { text: await resume($) }
      case 'stop':
        await stop($)
        return { text: 'Stopped.' }
      case 'next':
      case 'prev':
        return { text: await step($, verb === 'next' ? 1 : -1) }
      case 'reload': {
        const list = await loadPlaylist($)
        return { text: `playlist.txt: ${list.length} track(s).` }
      }
      case 'add': {
        if (!arg) return { text: 'Usage: /music add <url or file>' }
        const path = await playlistPath($)
        const old = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
        await $.fs.write(path, `${old}${old.endsWith('\n') || old === '' ? '' : '\n'}${arg}\n`)
        const list = await loadPlaylist($)
        return { text: `Added as track ${list.length}.` }
      }
      case 'skins': {
        const current = await read($, skin)
        const rows = SKINS.map((s, i) => `${s.id === current ? '▸' : ' '} ${String(i + 1).padStart(2)}. ${s.id}`)
        return { text: `${rows.join('\n')}\n\n/music skin <name or number> to switch.` }
      }
      case 'skin': {
        const id = await cycleSkin($, arg)
        return { text: id ? `Skin: ${id}` : `No skin "${arg}". /music skins lists them.` }
      }
      case 'vol':
      case 'volume': {
        const v = Number(arg)
        if (!Number.isFinite(v)) return { text: `Volume is ${await read($, volume)}. Usage: /music vol <0-100>` }
        await setVolume($, v)
        return { text: `Volume ${Math.round(Math.max(0, Math.min(100, v)))} (from the next track).` }
      }
      default:
        return { text: HELP }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const inline = e.props.placement === 'inline'
    const p = await read($, player)
    const list = await read($, playlist)
    const skinId = await read($, skin)
    const sprite = SKINS.find(s => s.id === skinId) ?? SKINS[0]
    const tick = await read($, frame)
    const vol = await read($, volume)
    const isPlaying = p.status === 'playing'
    const title = p.title || trackLabel(list[p.index], titles) || 'Nothing queued'
    const icon = { stopped: '■', loading: '…', playing: '▶', paused: '⏸', error: '!' }[p.status]

    // Inline, the sprite goes at half size to the left; docked, it sits on top and
    // shrinks on a short terminal so the controls stay in view.
    const art = sprite && (
      <PixelArt
        Box={Box}
        Text={Text}
        sprite={sprite}
        frame={isPlaying ? tick : 0}
        maxColumns={inline ? 20 : width}
        maxRows={inline ? 10 : Math.max(6, e.props.scroll.bodyRows - 12)}
      />
    )
    const controlsWidth = inline ? Math.max(20, width - 22) : width
    const align = inline ? 'flex-start' : 'center'
    const controls = (
      <Box flexDirection="column" alignItems={align} flexGrow={1}>
        <Text bold wrap="truncate">
          {icon} {title}
        </Text>
        <Text wrap="truncate">
          <Text color="cyan">{progressBar(p.position, p.duration, Math.max(4, controlsWidth - 16))}</Text>{' '}
          <Text dimColor>
            {formatTime(p.position)}/{formatTime(p.duration)}
          </Text>
        </Text>
        <Text color="magenta">{equalizer(tick, Math.min(controlsWidth, 24), isPlaying)}</Text>
        {p.status === 'error' && p.message && (
          <Text color="red" wrap="truncate">
            {p.message}
          </Text>
        )}
        <Box flexDirection="row" flexWrap="wrap" justifyContent={align} gap={1}>
          <Button key="prev" hotkey="b" label="⏮" onPress={() => step($, -1)} />
          <Button
            key="play"
            hotkey="p"
            label={isPlaying ? '⏸' : '▶'}
            onPress={() => (isPlaying ? pause($) : p.status === 'paused' ? resume($) : play($, p.index))}
          />
          <Button key="stop" hotkey="s" label="■" onPress={() => stop($)} />
          <Button key="next" hotkey="n" label="⏭" onPress={() => step($, 1)} />
        </Box>
        <Box flexDirection="row" flexWrap="wrap" justifyContent={align} gap={1}>
          <Button key="voldown" hotkey="d" label="vol-" dimColor onPress={() => setVolume($, vol - 10)} />
          <Text dimColor>{vol}</Text>
          <Button key="volup" hotkey="u" label="vol+" dimColor onPress={() => setVolume($, vol + 10)} />
          <Button key="skin" hotkey="k" label={`skin: ${sprite?.id ?? '-'}`} dimColor onPress={() => cycleSkin($, '')} />
        </Box>
      </Box>
    )
    const tracks = (
      <Box flexDirection="column">
        <Text dimColor>─ Playlist ({list.length}) ─</Text>
        {list.length === 0 && <Text dimColor>Empty. /music add &lt;youtube link&gt;</Text>}
        {/* One cell short of the edge: a wide character in the last column wraps on some terminals. */}
        {list.map((track, i) => (
          <Button
            key={`t${i}`}
            plain
            dimColor={i !== p.index}
            label={truncateToWidth(`${i === p.index ? '▸' : ' '} ${i + 1}. ${trackLabel(track, titles)}`, width - 1)}
            onPress={() => play($, i)}
          />
        ))}
      </Box>
    )

    if (inline) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={2}>
            {art}
            {controls}
          </Box>
          <Text> </Text>
          {tracks}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {art}
        <Text> </Text>
        {controls}
        <Text> </Text>
        {tracks}
      </Box>
    )
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      // /clear goes on under a new session whose state starts empty, and no
      // session.start fires for it: keep the music and carry the state over
      // once the new session is in place (a write before then is wiped).
      const carried = await read($, player)
      const ended = await next(e)
      carryOver($, e.sessionId, carried, 0)
      return ended
    }
    await stop($)
    if (socket) await $.process.run(['/bin/rm', '-f', socket]).catch(() => undefined)
    return next(e)
  })
}

/** Refills the state once the session after a /clear has taken over; retries for about 5 s. */
function carryOver($: $, endedId: string, carried: Player, tries: number): void {
  $.clock.after(tries === 0 ? 50 : 200, () => {
    void (async () => {
      const id = await $.session.id().catch(() => endedId)
      if (id === endedId && tries < 25) return carryOver($, endedId, carried, tries + 1)
      await restoreState($)
      // A running track reports its own progress; a stopped one is put back as it was.
      const now = await read($, player)
      if (now.status === 'stopped' && now.title === '' && now.index === 0) await update($, player, () => carried)
    })()
  })
}

/** Fills the session's state from what is kept across sessions: titles, skin, volume, playlist. */
async function restoreState($: $): Promise<void> {
  titles = ((await $.store.get('titles')) as Record<string, string> | undefined) ?? {}
  const savedSkin = await $.store.get('skin')
  if (typeof savedSkin === 'string' && SKINS.some(s => s.id === savedSkin)) await update($, skin, () => savedSkin)
  const savedVolume = await $.store.get('volume')
  if (typeof savedVolume === 'number') await update($, volume, () => savedVolume)
  await loadPlaylist($).catch(() => undefined)
}

// Asks for a dock sized to the terminal, and a short block when it sits inline above the prompt.
async function openPane($: $, terminalColumns: number): Promise<void> {
  await $.ui.open({ id: PANE, title: '♪ Pixel Player', columns: dockColumns(terminalColumns), rows: INLINE_ROWS })
}

// Kept outside the plugin folder: an installed plugin's folder is a copy that an update replaces.
async function playlistPath($: $): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const path = `${home}/.claude/pixel-play/playlist.txt`
  if (!(await $.fs.exists(path))) {
    const legacy = `${$.plugin.root}/playlist.txt`
    const start = (await $.fs.exists(legacy))
      ? await $.fs.read(legacy)
      : '# One track per line: a YouTube link, a direct audio URL, or a local file path.\n' +
        '# Anything after " # " on a line is a title shown until the real one loads.\n'
    await $.fs.write(path, start)
  }
  return path
}

async function loadPlaylist($: $): Promise<Track[]> {
  const path = await playlistPath($)
  const list = (await $.fs.exists(path)) ? parsePlaylist(await $.fs.read(path)) : []
  await update($, playlist, () => list)
  return list
}

function emptyPlaylist(): string {
  return 'The playlist is empty. Add a line with /music add <youtube link>, or edit ~/.claude/pixel-play/playlist.txt'
}

async function which($: $, name: string): Promise<string | undefined> {
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    if (await $.fs.exists(`${dir}/${name}`)) return `${dir}/${name}`
  }
  return undefined
}

async function play($: $, index: number): Promise<void> {
  const list = await read($, playlist)
  const track = list[index]
  if (!track) return
  await halt()
  const mine = ++generation

  const mpv = await which($, 'mpv')
  if (!mpv) {
    await update($, player, () => failed(index, 'mpv not found: brew install mpv yt-dlp'))
    return
  }
  const ytdlp = await which($, 'yt-dlp')
  socket = await socketPath($)
  const vol = await read($, volume)
  await update($, player, () => ({ status: 'loading', index, title: trackLabel(track, titles), position: -1, duration: -1 }))
  $.ui.status(`♪ ${trackLabel(track, titles)}`)
  startTicker($)

  const argv = [
    mpv,
    '--no-video',
    '--really-quiet',
    `--volume=${vol}`,
    `--script=${$.plugin.root}/mpv/progress.lua`,
    `--input-ipc-server=${socket}`,
    '--ytdl-format=bestaudio/best',
    ...(ytdlp ? [`--script-opts=ytdl_hook-ytdl_path=${ytdlp}`] : []),
    track.url,
  ]
  const child = $.process.spawn({ argv })
  stream = child
  let errors = ''
  let code: number | null = null
  try {
    for await (const chunk of child) {
      if (mine !== generation) break
      if (chunk.stream === 'stderr') {
        errors = (errors + chunk.text).slice(-400)
        continue
      }
      const progress = parseProgress(chunk.text)
      if (!progress) continue
      if (progress.title && !progress.title.startsWith('watch?') && titles[track.url] !== progress.title) {
        titles = { ...titles, [track.url]: progress.title }
        await $.store.set('titles', titles)
        $.ui.status(`♪ ${progress.title}`)
      }
      await update($, player, () => ({
        status: progress.paused ? 'paused' : 'playing',
        index,
        title: titles[track.url] ?? progress.title,
        position: progress.position,
        duration: progress.duration,
      }))
    }
    if (mine === generation) code = (await child.result).code
  } catch (err) {
    if (mine === generation) {
      await update($, player, () => failed(index, String(err).slice(0, 200)))
      endTicker($)
    }
    return
  }
  if (mine !== generation) return
  stream = undefined

  if (code === 0) {
    // Finished on its own: on to the next track, wrapping around.
    void play($, (index + 1) % list.length)
    return
  }
  const message = errors.trim().split('\n').pop() || `mpv exited with ${code}`
  await update($, player, () => failed(index, message))
  endTicker($)
}

/** Ends the child, if any, without touching the state. */
async function halt(): Promise<void> {
  generation++
  const s = stream
  stream = undefined
  await s?.return(undefined).catch(() => undefined)
}

async function stop($: $): Promise<void> {
  await halt()
  const p = await read($, player)
  await update($, player, () => ({ ...STOPPED, index: p.index, title: p.title }))
  endTicker($)
}

// Short enough for a Unix socket path (104 bytes on macOS).
async function socketPath($: $): Promise<string> {
  const tmp = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')
  return `${tmp}/pixel-play-${SOCKET_ID}.sock`
}

/** Sends commands to the running mpv over its IPC socket; true when it took them. */
async function mpvCommand($: $, ...commands: unknown[][]): Promise<boolean> {
  if (!socket || !stream) return false
  const result = await $.process
    .run(['/usr/bin/nc', '-U', socket], { stdin: commands.map(c => ipcCommand(...c)).join(''), timeoutMs: 3000 })
    .catch(() => undefined)
  return result?.exitCode === 0 && ipcSucceeded(result.stdout)
}

async function pause($: $): Promise<string> {
  const p = await read($, player)
  if (p.status !== 'playing') return p.status === 'paused' ? 'Already paused.' : 'Nothing is playing.'
  if (!(await mpvCommand($, ['set_property', 'pause', true]))) return 'Could not reach mpv to pause.'
  await update($, player, q => ({ ...q, status: 'paused' }))
  endTicker($)
  $.ui.status(`⏸ ${p.title}`)
  return `Paused at ${formatTime(p.position)}.`
}

async function resume($: $): Promise<string> {
  const p = await read($, player)
  if (p.status !== 'paused') return 'Nothing is paused.'
  if (!(await mpvCommand($, ['set_property', 'pause', false]))) return 'Could not reach mpv to resume.'
  await update($, player, q => ({ ...q, status: 'playing' }))
  startTicker($)
  $.ui.status(`♪ ${p.title}`)
  return 'Resumed.'
}

async function step($: $, delta: number): Promise<string> {
  const list = await read($, playlist)
  if (list.length === 0) return emptyPlaylist()
  const p = await read($, player)
  const n = (p.index + delta + list.length) % list.length
  void play($, n)
  return `Track ${n + 1}: ${trackLabel(list[n], titles)}`
}

async function cycleSkin($: $, name: string): Promise<string | undefined> {
  const current = await read($, skin)
  const byNumber = /^\d+$/.test(name) ? SKINS[Number(name) - 1] : undefined
  const target = name
    ? (byNumber ?? SKINS.find(s => s.id === name || s.id.includes(name)))
    : SKINS[(SKINS.findIndex(s => s.id === current) + 1) % SKINS.length]
  if (!target) return undefined
  await update($, skin, () => target.id)
  await $.store.set('skin', target.id)
  return target.id
}

async function setVolume($: $, v: number): Promise<void> {
  const clamped = Math.round(Math.max(0, Math.min(100, v)))
  await update($, volume, () => clamped)
  await $.store.set('volume', clamped)
}

function startTicker($: $): void {
  if (ticker) return
  ticker = $.clock.every(FRAME_MS, () => update($, frame, n => (n + 1) % 1_000_000))
}

function endTicker($: $): void {
  ticker?.cancel()
  ticker = undefined
  $.ui.status(undefined)
}
