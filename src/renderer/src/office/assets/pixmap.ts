import { sprite, type Sprite } from '../pixels'

/**
 * The sprite pipeline. Every piece of art in the office is a PixMap: a grid of palette characters ("pixel map") that is
 * baked once into a transparent canvas and then only ever drawn with drawImage. A "." or a space is a transparent pixel.
 * Palettes are indexed by one character so a department can recolour the same drawing (accent, skin, hair, ...).
 */
export type Palette = Record<string, string>

export interface PixMap {
  rows: string[]
  /** Anchor inside the map: a tile's north corner for things on the floor, the feet for people. */
  ox: number
  oy: number
}

export const px = (ox: number, oy: number, ...rows: string[]): PixMap => ({ rows, ox, oy })

export const mapSize = (m: PixMap): { w: number; h: number } => ({ w: Math.max(0, ...m.rows.map((r) => r.length)), h: m.rows.length })

/** Paints a map onto a context at (x, y). `flip` mirrors it left-right inside its own width. */
export function stamp(g: CanvasRenderingContext2D, m: PixMap, pal: Palette, x: number, y: number, flip = false): void {
  const { w } = mapSize(m)
  for (let j = 0; j < m.rows.length; j++) {
    const row = m.rows[j]
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '.' || ch === ' ') continue
      const color = pal[ch]
      if (!color) continue
      g.fillStyle = color
      g.fillRect(x + (flip ? w - 1 - i : i), y + j, 1, 1)
    }
  }
}

/** Bakes one map into a cached sprite. `tag` must identify the palette (the key is map-key + tag). */
export function bake(key: string, m: PixMap, pal: Palette, flip = false): Sprite {
  const { w, h } = mapSize(m)
  const ox = flip ? w - 1 - m.ox : m.ox
  return sprite(`${key}${flip ? ':f' : ''}`, w, h, ox, m.oy, (g) => stamp(g, m, pal, 0, 0, flip))
}

export interface Layer {
  map: PixMap
  pal: Palette
  /** Offset of the map's top-left corner inside the composed sprite. */
  x: number
  y: number
}

/** Composes several maps (a body, an outfit, a hairstyle, ...) into one sprite. */
export function bakeLayers(key: string, w: number, h: number, ox: number, oy: number, layers: Layer[], flip = false): Sprite {
  return sprite(`${key}${flip ? ':f' : ''}`, w, h, flip ? w - 1 - ox : ox, oy, (g) => {
    if (!flip) {
      for (const l of layers) stamp(g, l.map, l.pal, l.x, l.y)
      return
    }
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const tg = tmp.getContext('2d')!
    for (const l of layers) stamp(tg, l.map, l.pal, l.x, l.y)
    g.translate(w, 0)
    g.scale(-1, 1)
    g.drawImage(tmp, 0, 0)
  })
}

/** Flattens layers (each with its palette) into one map and one palette; pure, no canvas. Later layers paint over earlier ones. */
export function mergeLayers(w: number, h: number, ox: number, oy: number, layers: Layer[]): { map: PixMap; pal: Palette } {
  const cells: string[] = new Array<string>(w * h).fill('.')
  const pal: Palette = {}
  for (const l of layers) {
    Object.assign(pal, l.pal)
    l.map.rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]
        const x = l.x + i
        const y = l.y + j
        if (ch === '.' || ch === ' ' || x < 0 || y < 0 || x >= w || y >= h) continue
        cells[y * w + x] = ch
      }
    })
  }
  const rows: string[] = []
  for (let y = 0; y < h; y++) rows.push(cells.slice(y * w, (y + 1) * w).join(''))
  return { map: px(ox, oy, ...rows), pal }
}

/** Validates a map's rows (used by the tests that run without a canvas): every character must exist in the palette. */
export function unknownChars(m: PixMap, pal: Palette): string[] {
  const bad = new Set<string>()
  for (const r of m.rows) for (const ch of r) if (ch !== '.' && ch !== ' ' && !pal[ch]) bad.add(ch)
  return [...bad]
}
