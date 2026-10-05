import { expect, mock, test } from 'claude-code/testing'

import {
  displayWidth,
  dockColumns,
  equalizer,
  formatTime,
  ipcCommand,
  ipcSucceeded,
  parsePlaylist,
  parseProgress,
  progressBar,
  truncateToWidth,
} from './hooks/player'
import { rasterize } from './hooks/pixel'
import { SKINS } from './hooks/skins.gen'

test('playlist.txt: comments skipped, optional titles kept', () => {
  const list = parsePlaylist(
    [
      '# my mix',
      '',
      'https://www.youtube.com/watch?v=abc123 # Lofi beats',
      '  https://youtu.be/xyz  ',
      '/Users/me/Music/song.mp3',
    ].join('\n'),
  )
  expect(list).toEqual([
    { url: 'https://www.youtube.com/watch?v=abc123', title: 'Lofi beats' },
    { url: 'https://youtu.be/xyz' },
    { url: '/Users/me/Music/song.mp3' },
  ])
})

test('progress lines from mpv/progress.lua', () => {
  expect(parseProgress('noise\n@@pos|1.0|200.5|0|A\n@@pos|2.0|200.5|1|Song | Live\n')).toEqual({
    position: 2,
    duration: 200.5,
    paused: true,
    title: 'Song | Live',
  })
  expect(parseProgress('@@pos|2.0|-1.0|0|Radio')?.paused).toBe(false)
  expect(parseProgress('nothing here')).toBe(undefined)
})

test('labels are cut by terminal cells, wide characters counting two', () => {
  const title = '▸ 1. 【MAD/60fps】戀如雨止【愛在雨過天晴時】'
  expect(displayWidth(title)).toBe(44)
  expect(truncateToWidth(title, 44)).toBe(title)
  const cut = truncateToWidth(title, 20)
  expect(cut).toBe('▸ 1. 【MAD/60fps】…')
  expect(displayWidth(cut) <= 20).toBe(true)
  // A wide character that would straddle the edge is dropped whole.
  expect(truncateToWidth('戀如雨止', 4)).toBe('戀…')
  expect(truncateToWidth('abc', 3)).toBe('abc')
})

test('the dock asks for a share of the terminal, within bounds', () => {
  expect(dockColumns(110)).toBe(33)
  expect(dockColumns(130)).toBe(39)
  expect(dockColumns(200)).toBe(44)
  expect(dockColumns(80)).toBe(30)
})

test('a short pane halves the sprite', () => {
  for (const sprite of SKINS) {
    expect(rasterize(sprite, 0, 40, 10).length <= 10).toBe(true)
    for (const runs of rasterize(sprite, 0, 40, 10)) expect(runs.reduce((n, r) => n + r.text.length, 0) <= 20).toBe(true)
  }
})

test('mpv IPC lines and replies', () => {
  expect(ipcCommand('set_property', 'pause', true)).toBe('{"command":["set_property","pause",true]}\n')
  expect(ipcSucceeded('{"request_id":0,"error":"success"}\n')).toBe(true)
  expect(ipcSucceeded('{"request_id":0,"error":"property not found"}\n')).toBe(false)
  expect(ipcSucceeded('')).toBe(false)
})

test('time, bar and equalizer formatting', () => {
  expect(formatTime(72)).toBe('01:12')
  expect(formatTime(3725)).toBe('1:02:05')
  expect(formatTime(-1)).toBe('--:--')
  expect(progressBar(50, 100, 10)).toBe('█████░░░░░')
  expect(progressBar(5, -1, 6)).toBe('░░░░░░')
  expect(equalizer(3, 8, false)).toBe('▁▁▁▁▁▁▁▁')
  expect(equalizer(3, 8, true).length).toBe(8)
})

test('every skin rasterizes into half-block rows within the width', () => {
  expect(SKINS.length).toBe(10)
  for (const sprite of SKINS) {
    expect(sprite.frames.length).toBe(5)
    for (let f = 0; f < sprite.frames.length; f++) {
      const rows = rasterize(sprite, f, 40)
      expect(rows.length <= 20).toBe(true)
      for (const runs of rows) {
        expect(runs.reduce((n, r) => n + r.text.length, 0) <= 40).toBe(true)
      }
    }
    // A narrow pane halves the picture.
    const narrow = rasterize(sprite, 0, 20)
    for (const runs of narrow) expect(runs.reduce((n, r) => n + r.text.length, 0) <= 20).toBe(true)
  }
})

test('/music skin switches and remembers the skin', async ($, on) => {
  mock.store(on)
  const music = (args: string) =>
    $.command.run({
      command: 'music',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

  expect(await music('skin penguin')).toEqual(expect.objectContaining({ text: 'Skin: penguin' }))
  // Penguin is the last skin, so the next one wraps around to the first.
  expect(await music('skin')).toEqual(expect.objectContaining({ text: 'Skin: vinyl' }))
  expect(await music('skin nope')).toEqual(expect.objectContaining({ text: expect.stringContaining('No skin') }))
  expect(await music('skin 3')).toEqual(expect.objectContaining({ text: 'Skin: cat' }))
  expect(await music('skins')).toEqual(expect.objectContaining({ text: expect.stringContaining('▸  3. cat') }))
})

for (const bodyColumns of [44, 24]) {
  test(`the pane draws on the terminal at ${bodyColumns} columns`, async ($, on) => {
    mock.store(on)
    const ui = await $.ui.mount({
      plugin: 'pixel-player',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pixel-player',
      props: {
        title: '♪ Pixel Player',
        isFocused: false,
        bodyColumns,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ key: 'play' })).toBeDefined()
    expect(await ui.find({ key: 'skin' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Nothing queued/ })).toBeDefined()
  })
}

// A fake mpv: it reports progress every mocked second and takes pause/resume over "IPC".
function fakeMpv(on: Parameters<Parameters<typeof test>[1]>[1], options: { ipcWorks: boolean }) {
  mock.store(on)
  mock.env(on, { HOME: '/home/me', TMPDIR: '/tmp/' })
  const clock = mock.clock(on)
  const sent: string[] = []
  let paused = 0
  on('ui.open', async () => ({ value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: 'https://youtu.be/abc # Song\n' }))
  on('fs.write', async () => ({ value: undefined }))
  on('process.run', async ($, e) => {
    const stdin = e.init?.stdin ?? ''
    sent.push(`${e.argv.join(' ')} <- ${stdin.trim()}`)
    if (!options.ipcWorks) {
      return { value: { exitCode: 1, stdout: '', stderr: 'refused', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (stdin.includes('"pause",true')) paused = 1
    if (stdin.includes('"pause",false')) paused = 0
    const stdout = '{"request_id":0,"error":"success"}\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e, next) {
    sent.push(e.argv.find(a => a.startsWith('--input-ipc-server=')) ?? 'no ipc server')
    while (!next.signal.aborted) {
      yield { stream: 'stdout' as const, text: `@@pos|3.0|100.0|${paused}|Song\n` }
      // Asleep on the mocked clock, so the test moves time; a kill wakes it.
      await Promise.race([clock.sleep(1000), new Promise(r => next.signal.addEventListener('abort', r))])
    }
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  return { clock, sent }
}

const runMusic = ($: Parameters<Parameters<typeof test>[1]>[0]) => async (args: string) =>
  (
    (await $.command.run({
      command: 'music',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })) as { text?: string }
  ).text

test('/music pause pauses mpv over IPC, and pause or play resumes it', async ($, on) => {
  const { clock, sent } = fakeMpv(on, { ipcWorks: true })
  const music = runMusic($)

  expect(await music('pause')).toBe('Nothing is playing.')
  expect(await music('play')).toBe('Playing track 1.')
  await clock.advance(10)
  expect(sent[0]).toMatch(/^--input-ipc-server=\/tmp\/pixel-play-\w+\.sock$/)

  expect(await music('pause')).toBe('Paused at 00:03.')
  expect(sent[1]).toBe(`/usr/bin/nc -U ${sent[0]!.split('=')[1]} <- {"command":["set_property","pause",true]}`)
  // mpv's next report agrees, and the pane shows it.
  await clock.advance(1000)
  const ui = await $.ui.mount({
    plugin: 'pixel-player',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pixel-player',
    props: { title: '♪', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /⏸ Song/ })).toBeDefined()
  expect((await ui.find({ key: 'play' }))?.text).toBe('▶')
  expect(await music('pause')).toBe('Resumed.')
  expect(await music('resume')).toBe('Nothing is paused.')

  // The pane's play button toggles: pause, then play resumes the same track.
  expect((await ui.find({ key: 'play' }))?.text).toBe('⏸')
  await ui.press({ key: 'play' })
  expect(sent.at(-1)).toMatch(/"pause",true/)
  expect(await music('play')).toBe('Resumed.')
  expect(sent.at(-1)).toMatch(/"pause",false/)
  // Only one mpv was ever started.
  expect(sent.filter(s => s.startsWith('--input-ipc-server')).length).toBe(1)

  expect(await music('stop')).toBe('Stopped.')
  expect(await music('pause')).toBe('Nothing is playing.')
  await ui.unmount()
})

test('/music pause says so when mpv cannot be reached', async ($, on) => {
  const { clock } = fakeMpv(on, { ipcWorks: false })
  const music = runMusic($)
  await music('play')
  await clock.advance(10)
  expect(await music('pause')).toBe('Could not reach mpv to pause.')
  expect(await music('stop')).toBe('Stopped.')
})

test('/music opens a dock sized to the terminal', async ($, on) => {
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  const opened: unknown[] = []
  on('ui.open', async ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: '' }))
  for (const columns of [120, 200]) {
    await $.command.run({ command: 'music', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns } })
  }
  expect(opened).toEqual([
    expect.objectContaining({ id: 'pixel-player', columns: 36, rows: 12 }),
    expect.objectContaining({ id: 'pixel-player', columns: 44, rows: 12 }),
  ])
})

test('inline above the prompt, the sprite sits beside the controls', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({
    plugin: 'pixel-player',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pixel-player',
    props: { title: '♪', isFocused: false, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const tree = JSON.stringify(await ui.find({ type: 'Box' }))
  // The first row holds the half-size sprite and the controls together.
  expect(tree.indexOf('"flexDirection":"row","gap":2') >= 0).toBe(true)
  expect(await ui.find({ key: 'play' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nothing queued/ })).toBeDefined()
  await ui.unmount()
})
