import { deflateSync } from 'node:zlib'
import { mapSize, type Palette, type PixMap } from '../../src/renderer/src/office/assets/pixmap'

/** Dev tool: renders pixel maps into a PNG contact sheet (no DOM, no dependencies) so the art can be looked at. */

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const parseColor = (c: string): [number, number, number, number] => {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
  }
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return [255, 0, 255, 255]
  const p = m[1].split(',').map((s) => parseFloat(s))
  return [p[0], p[1], p[2], Math.round((p[3] ?? 1) * 255)]
}

export interface SheetItem {
  name: string
  map: PixMap
  pal: Palette
  flip?: boolean
}

/** Lays the items out in rows on a neutral floor colour, `scale`× enlarged. */
export function sheet(items: SheetItem[], opts: { cols?: number; scale?: number; bg?: string; pad?: number } = {}): Buffer {
  const cols = opts.cols ?? 6
  const scale = opts.scale ?? 3
  const pad = opts.pad ?? 6
  const sizes = items.map((i) => mapSize(i.map))
  const cellW = Math.max(...sizes.map((s) => s.w)) + pad * 2
  const cellH = Math.max(...sizes.map((s) => s.h)) + pad * 2
  const rows = Math.ceil(items.length / cols)
  const W = cols * cellW * scale
  const H = rows * cellH * scale
  const buf = new Uint8Array(W * H * 4)
  const bg = parseColor(opts.bg ?? '#7d8aa3')
  for (let i = 0; i < W * H; i++) buf.set(bg, i * 4)
  const put = (x: number, y: number, c: [number, number, number, number]): void => {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const o = ((y * scale + dy) * W + x * scale + dx) * 4
        const a = c[3] / 255
        buf[o] = Math.round(buf[o] * (1 - a) + c[0] * a)
        buf[o + 1] = Math.round(buf[o + 1] * (1 - a) + c[1] * a)
        buf[o + 2] = Math.round(buf[o + 2] * (1 - a) + c[2] * a)
        buf[o + 3] = 255
      }
    }
  }
  items.forEach((it, n) => {
    const cx = (n % cols) * cellW + pad
    const cy = Math.floor(n / cols) * cellH + pad
    const { w } = sizes[n]
    it.map.rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]
        if (ch === '.' || ch === ' ') continue
        const col = it.pal[ch]
        if (!col) {
          put(cx + i, cy + j, [255, 0, 255, 255])
          continue
        }
        put(cx + (it.flip ? w - 1 - i : i), cy + j, parseColor(col))
      }
    })
  })
  return encodePng(W, H, buf)
}
