// Draws a sprite with half blocks: one cell holds two pixels, the top one as
// the glyph's color and the bottom one as its background.

import type { Elements } from 'claude-code'

import { ALPHABET } from './skins.gen'

export type Sprite = {
  id: string
  width: number
  height: number
  palette: string[]
  // One char per pixel, row by row; '.' is transparent.
  frames: string[]
}

type Cell = { glyph: string; color?: string; backgroundColor?: string }

const decode = new Map([...ALPHABET].map((ch, i) => [ch, i]))

function pixel(sprite: Sprite, frame: string, x: number, y: number): string | undefined {
  if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return undefined
  const k = decode.get(frame[y * sprite.width + x] ?? '.')
  return k === undefined ? undefined : sprite.palette[k]
}

function cell(top?: string, bottom?: string): Cell {
  if (!top && !bottom) return { glyph: ' ' }
  if (!top) return { glyph: '▄', color: bottom }
  if (!bottom) return { glyph: '▀', color: top }
  if (top === bottom) return { glyph: '█', color: top }
  return { glyph: '▀', color: top, backgroundColor: bottom }
}

// The opaque bounding box across every frame, so empty margins cost no rows.
const boxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>()
function boxOf(sprite: Sprite) {
  const known = boxes.get(sprite.id)
  if (known) return known
  let [x0, y0, x1, y1] = [sprite.width, sprite.height, -1, -1]
  for (const frame of sprite.frames) {
    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        if (frame[y * sprite.width + x] === '.') continue
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
  }
  const box = x1 < 0 ? { x0: 0, y0: 0, x1: sprite.width - 1, y1: sprite.height - 1 } : { x0, y0, x1, y1 }
  boxes.set(sprite.id, box)
  return box
}

/** Cell rows for one frame, each row as runs of identical cells. */
export function rasterize(sprite: Sprite, frameIndex: number, maxColumns: number, maxRows = Infinity) {
  const frame = sprite.frames[frameIndex % sprite.frames.length] ?? ''
  const box = boxOf(sprite)
  const w = box.x1 - box.x0 + 1
  const h = box.y1 - box.y0 + 1
  // Halve the picture when the pane is too narrow or too short for it.
  const step = w > maxColumns || Math.ceil(h / 2) > maxRows ? 2 : 1
  const rows: Array<Array<Cell & { text: string }>> = []
  for (let y = box.y0; y <= box.y1; y += 2 * step) {
    const runs: Array<Cell & { text: string }> = []
    for (let x = box.x0; x <= box.x1; x += step) {
      const c = cell(pixel(sprite, frame, x, y), pixel(sprite, frame, x, y + step))
      const last = runs[runs.length - 1]
      if (last && last.color === c.color && last.backgroundColor === c.backgroundColor && last.glyph === c.glyph) {
        last.text += c.glyph
      } else {
        runs.push({ ...c, text: c.glyph })
      }
    }
    rows.push(runs)
  }
  return rows
}

export function PixelArt(props: {
  Text: Elements['terminal']['Text']
  Box: Elements['terminal']['Box']
  sprite: Sprite
  frame: number
  maxColumns: number
  maxRows?: number
}) {
  const { Text, Box, sprite, frame, maxColumns, maxRows } = props
  return (
    <Box flexDirection="column" alignItems="center" flexShrink={0}>
      {rasterize(sprite, frame, maxColumns, maxRows).map(runs => (
        <Text wrap="truncate">
          {runs.map(run =>
            run.color ? (
              <Text color={run.color} backgroundColor={run.backgroundColor}>
                {run.text}
              </Text>
            ) : (
              run.text
            ),
          )}
        </Text>
      ))}
    </Box>
  )
}
