import type { Track } from '../types'

/** Reads playlist.txt: one track per line, `#` lines skipped, ` # title` optional. */
export function parsePlaylist(text: string): Track[] {
  const tracks: Track[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const cut = line.indexOf(' # ')
    const url = (cut < 0 ? line : line.slice(0, cut)).trim()
    const title = cut < 0 ? undefined : line.slice(cut + 3).trim() || undefined
    tracks.push(title ? { url, title } : { url })
  }
  return tracks
}

export type Progress = { position: number; duration: number; paused: boolean; title: string }

/** Pulls the last `@@pos|<pos>|<dur>|<paused 0/1>|<title>` line that mpv/progress.lua wrote. */
export function parseProgress(chunk: string): Progress | undefined {
  let found: Progress | undefined
  for (const line of chunk.split('\n')) {
    const m = /^@@pos\|(-?[\d.]+)\|(-?[\d.]+)\|([01])\|(.*)$/.exec(line.trim())
    if (m) found = { position: Number(m[1]), duration: Number(m[2]), paused: m[3] === '1', title: m[4] ?? '' }
  }
  return found
}

/** One line of mpv's JSON IPC protocol. */
export function ipcCommand(...command: unknown[]): string {
  return `${JSON.stringify({ command })}\n`
}

/** Whether mpv answered every command it was sent with success. */
export function ipcSucceeded(reply: string): boolean {
  const lines = reply.split('\n').filter(l => l.includes('"error"'))
  return lines.length > 0 && lines.every(l => l.includes('"error":"success"'))
}

export function formatTime(seconds: number): string {
  if (!(seconds >= 0)) return '--:--'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function progressBar(position: number, duration: number, width: number): string {
  const cells = Math.max(4, width)
  if (!(duration > 0)) return '░'.repeat(cells)
  const filled = Math.min(cells, Math.round((position / duration) * cells))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

const BARS = '▁▂▃▄▅▆▇█'

/** A made-up equalizer: there are no samples to analyse, only a beat to fake. */
export function equalizer(tick: number, width: number, isPlaying: boolean): string {
  let s = ''
  for (let i = 0; i < width; i++) {
    if (!isPlaying) {
      s += BARS[0]
      continue
    }
    const v = Math.sin(tick * 0.9 + i * 1.7) + Math.sin(tick * 0.37 + i * 0.6) + Math.sin(i * 3.1 + tick * 1.3)
    s += BARS[Math.max(0, Math.min(7, Math.round(((v + 3) / 6) * 7)))]
  }
  return s
}

// East Asian wide and fullwidth ranges, plus emoji: each takes two terminal cells.
const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  return WIDE.some(([lo, hi]) => code >= lo && code <= hi) ? 2 : 1
}

/** How many terminal cells the text takes. */
export function displayWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charWidth(ch)
  return w
}

/** Cuts the text to at most `width` cells, ending in … when cut. */
export function truncateToWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = charWidth(ch)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return `${out}…`
}

export function trackLabel(track: Track | undefined, titles: Record<string, string>): string {
  if (!track) return ''
  return titles[track.url] ?? track.title ?? shortUrl(track.url)
}

function shortUrl(url: string): string {
  const id = /[?&]v=([\w-]+)/.exec(url)?.[1] ?? /youtu\.be\/([\w-]+)/.exec(url)?.[1]
  if (id) return `youtube ${id}`
  return url.split('/').filter(Boolean).pop() ?? url
}
