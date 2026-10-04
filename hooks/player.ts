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

export type Progress = { position: number; duration: number; title: string }

/** Pulls the last `@@pos|<pos>|<dur>|<title>` line that mpv/progress.lua wrote. */
export function parseProgress(chunk: string): Progress | undefined {
  let found: Progress | undefined
  for (const line of chunk.split('\n')) {
    const m = /^@@pos\|(-?[\d.]+)\|(-?[\d.]+)\|(.*)$/.exec(line.trim())
    if (m) found = { position: Number(m[1]), duration: Number(m[2]), title: m[3] ?? '' }
  }
  return found
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

export function trackLabel(track: Track | undefined, titles: Record<string, string>): string {
  if (!track) return ''
  return titles[track.url] ?? track.title ?? shortUrl(track.url)
}

function shortUrl(url: string): string {
  const id = /[?&]v=([\w-]+)/.exec(url)?.[1] ?? /youtu\.be\/([\w-]+)/.exec(url)?.[1]
  if (id) return `youtube ${id}`
  return url.split('/').filter(Boolean).pop() ?? url
}
