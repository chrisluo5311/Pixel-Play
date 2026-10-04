// Converts assets/frames/<skin>/<n>.png into hooks/skins.gen.ts.
// Each skin becomes a palette plus one string per frame, one char per pixel.
// Usage: node scripts/png2sprite.mjs   (Node 18+, no dependencies)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const framesDir = join(root, 'assets', 'frames')
const stillsDir = join(root, 'assets', 'png')
const out = join(root, 'hooks', 'skins.gen.ts')

// One char per palette entry; '.' is transparent.
const ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+,-/:;<=>?@[]^_{|}~'

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  let palette = null
  let trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported')
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} is not supported`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`color type ${colorType} is not supported`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[y * stride + x] = v & 0xff
    }
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = i * channels
    let r, g, b, al
    if (colorType === 6) [r, g, b, al] = [px[s], px[s + 1], px[s + 2], px[s + 3]]
    else if (colorType === 2) [r, g, b, al] = [px[s], px[s + 1], px[s + 2], 255]
    else if (colorType === 4) [r, g, b, al] = [px[s], px[s], px[s], px[s + 1]]
    else if (colorType === 0) [r, g, b, al] = [px[s], px[s], px[s], 255]
    else {
      const k = px[s]
      ;[r, g, b] = [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]]
      al = trns && k < trns.length ? trns[k] : 255
    }
    rgba.set([r, g, b, al], i * 4)
  }
  return { width, height, rgba }
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

function framesOf(skin) {
  const dir = join(framesDir, skin)
  if (existsSync(dir)) {
    return readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(f => join(dir, f))
  }
  return [join(stillsDir, `${skin}.png`)]
}

const skins = readdirSync(stillsDir)
  .filter(f => f.endsWith('.png'))
  .map(f => f.replace(/\.png$/, ''))
  .sort()

const result = []
for (const skin of skins) {
  const images = framesOf(skin).map(f => decodePng(readFileSync(f)))
  const { width, height } = images[0]
  const palette = []
  const index = new Map()
  const frames = images.map(img => {
    if (img.width !== width || img.height !== height) throw new Error(`${skin}: frame sizes differ`)
    let s = ''
    for (let i = 0; i < width * height; i++) {
      const [r, g, b, a] = img.rgba.subarray(i * 4, i * 4 + 4)
      if (a < 128) {
        s += '.'
        continue
      }
      const key = hex(r, g, b)
      if (!index.has(key)) {
        if (palette.length >= ALPHABET.length) {
          // Too many colors: reuse the nearest one already in the palette.
          let best = 0
          let bestD = Infinity
          palette.forEach((p, k) => {
            const d =
              (parseInt(p.slice(1, 3), 16) - r) ** 2 +
              (parseInt(p.slice(3, 5), 16) - g) ** 2 +
              (parseInt(p.slice(5, 7), 16) - b) ** 2
            if (d < bestD) [best, bestD] = [k, d]
          })
          index.set(key, best)
        } else {
          index.set(key, palette.length)
          palette.push(key)
        }
      }
      s += ALPHABET[index.get(key)]
    }
    return s
  })
  const id = skin.replace(/^\d+-/, '')
  result.push({ id, width, height, palette, frames })
  console.log(`${id}: ${width}x${height}, ${frames.length} frame(s), ${palette.length} colors`)
}

writeFileSync(
  out,
  `// Generated by scripts/png2sprite.mjs from assets/. Do not edit by hand.\n` +
    `import type { Sprite } from './pixel'\n\n` +
    `export const ALPHABET = ${JSON.stringify(ALPHABET)}\n\n` +
    `export const SKINS: readonly Sprite[] = ${JSON.stringify(result, null, 1)}\n`,
)
console.log(`wrote ${out}`)
