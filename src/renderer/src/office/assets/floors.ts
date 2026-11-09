import { Grid } from './iso'
import { accentRamp } from './palette'
import { px, type Palette, type PixMap } from './pixmap'

/**
 * Floor tiles. Every material is a pixel rule evaluated on the 32×16 diamond of a tile in *world* tile coordinates
 * (gu, gv), so planks, seams and carpet tiles run on across neighbouring tiles without a break; a few variants per
 * material (chosen by the tile position) keep the floor from looking stamped. The result is an ordinary PixMap.
 */
export type FloorKind = 'parquet' | 'planks' | 'birch' | 'acoustic' | 'carpet' | 'lino' | 'steel' | 'stone' | 'base'

export const FLOOR_PAL: Record<FloorKind, Palette> = {
  parquet: { a: '#8a5a36', b: '#9d6a40', c: '#74492b', d: '#4f3120', f: '#b98657', e: '#a2723f' },
  planks: { a: '#d9a86a', b: '#e6bb80', c: '#c8955a', d: '#9c6c40', f: '#f3d6a2', e: '#cf9c60' },
  birch: { a: '#e2c49a', b: '#edd3ae', c: '#d1b088', d: '#a98a64', f: '#f8e8cb', e: '#ee8a4c' },
  acoustic: { a: '#2f6f6e', b: '#37807d', c: '#265b5a', d: '#1d4545', f: '#4aa59a', e: '#5cc9b8' },
  carpet: { a: '#41567d', b: '#4a6490', c: '#384a6e', d: '#2a3858', f: '#5d7cb0', e: '#6f94cc' },
  lino: { a: '#e9ecef', b: '#f7f9fa', c: '#d2d8de', d: '#aeb7c1', f: '#ffffff', e: '#e8a39e' },
  steel: { a: '#6b7380', b: '#7c8594', c: '#596070', d: '#3b414d', f: '#98a2b4', e: '#a9b3c4' },
  stone: { a: '#cdbc9f', b: '#d9caaf', c: '#bba88a', d: '#8f7c5f', f: '#e8dcc4', e: '#c4b092' },
  base: { a: '#2a2838', b: '#322f44', c: '#232130', d: '#1b1926', f: '#3a374e', e: '#2e2c3f' }
}

const hash = (a: number, b: number, c = 0): number => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}
const frac = (v: number): number => v - Math.floor(v)

type Sampler = (gu: number, gv: number, x: number, y: number, tx: number, ty: number) => string

const SAMPLERS: Record<FloorKind, Sampler> = {
  parquet: (gu, gv, x, y) => planks(gu, gv, x, y, 3, 1),
  planks: (gu, gv, x, y) => planks(gu, gv, x, y, 4, 1),
  birch: (gu, gv, x, y) => {
    const ch = planks(gu, gv, x, y, 4, 0.5)
    // paint drips of the art department
    return ch !== 'd' && hash(x, y, 91) % 197 === 0 ? 'e' : ch
  },
  acoustic: (gu, gv, x, y) => {
    const band = Math.floor(gu * 4 + gv * 4) % 2 === 0
    const n = hash(x, y) % 61
    if (n === 0) return 'f'
    if (frac(gu * 2) < 0.06 || frac(gv * 2) < 0.06) return 'd'
    // foam panels in two calm tones, a few perforation dots
    return band ? 'a' : n < 4 ? 'a' : 'c'
  },
  carpet: (gu, gv, x, y, tx, ty) => {
    const lu = frac(gu)
    const lv = frac(gv)
    if (lu < 0.04 || lv < 0.0625) return 'd'
    const n = hash(x, y, 3) % 13
    if (n === 0) return 'f'
    const alt = (tx + ty) % 2 === 0
    if (n < 4) return alt ? 'a' : 'b'
    return alt ? 'b' : 'a'
  },
  lino: (gu, gv, x, y) => {
    if (frac(gu * 2) < 0.07 || frac(gv * 2) < 0.12) return 'd'
    const sq = (Math.floor(gu * 2) + Math.floor(gv * 2)) % 2 === 0
    const n = hash(x, y, 5) % 41
    if (n === 0) return 'f'
    // a few red accent squares: first aid cabinet colours of QA
    if (hash(Math.floor(gu * 2), Math.floor(gv * 2), 17) % 23 === 0) return 'e'
    return sq ? 'a' : n < 9 ? 'b' : 'c'
  },
  steel: (gu, gv, x, y) => {
    if (frac(gu * 2) < 0.06 || frac(gv * 2) < 0.12) return 'd'
    const i = Math.floor(gu * 8)
    const j = Math.floor(gv * 8)
    if ((i + j) % 2 === 0 && (i * 3 + j) % 4 === 0) return 'f'
    if ((i + j) % 2 === 1 && (i + j * 3) % 5 === 0) return 'c'
    return hash(x, y, 9) % 17 === 0 ? 'b' : 'a'
  },
  stone: (gu, gv, x, y) => {
    if (frac(gu * 2) < 0.06 || frac(gv * 2) < 0.12) return 'd'
    const t = hash(Math.floor(gu * 2), Math.floor(gv * 2), 31) % 5
    const n = hash(x, y, 7) % 15
    if (n === 0) return t < 2 ? 'c' : 'f'
    return t === 0 ? 'b' : t === 1 ? 'c' : 'a'
  },
  base: (_gu, _gv, x, y) => (hash(x, y) % 9 === 0 ? 'b' : 'a')
}

/** Boards that run along x: `rows` boards per tile, each `len` tiles long with its own joint offset. */
function planks(gu: number, gv: number, x: number, y: number, rows: number, len: number): string {
  const r = Math.floor(gv * rows)
  const fv = gv * rows - r
  const off = (hash(r, 7) % 100) / 100
  const s = gu / (len * 2) + off
  const seg = Math.floor(s)
  if (fv < 0.25) return 'd'
  if (frac(s) < 0.035) return 'd'
  const t = hash(r, seg, 13) % 5
  const n = hash(x, y, 2) % 29
  if (n === 0) return 'c'
  if (fv < 0.5 && hash(x, y, 4) % 3 === 0) return 'f'
  return t === 0 ? 'b' : t === 1 || t === 2 ? 'a' : t === 3 ? 'e' : 'c'
}

const inside = (x: number, y: number): boolean => Math.abs(x + 0.5 - 16) / 16 + Math.abs(y + 0.5 - 8) / 8 < 1

/** Local tile coordinates of the pixel (x, y) of the 32×16 tile. */
const uv = (x: number, y: number): [number, number] => {
  const sx = x + 0.5 - 16
  const sy = y + 0.5
  return [(sx / 16 + sy / 8) / 2, (sy / 8 - sx / 16) / 2]
}

export function floorTile(kind: FloorKind, tx: number, ty: number): PixMap {
  const sample = SAMPLERS[kind]
  const rows: string[] = []
  for (let y = 0; y < 16; y++) {
    let row = ''
    for (let x = 0; x < 32; x++) {
      if (!inside(x, y)) {
        row += '.'
        continue
      }
      const [u, v] = uv(x, y)
      // world pixel coordinates keep the grain from repeating at tile borders
      row += sample(tx + u, ty + v, (tx - ty) * 16 + x, (tx + ty) * 8 + y, tx, ty)
    }
    rows.push(row)
  }
  return px(0, 0, ...rows)
}

export interface RugRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A rug tile (1 tile of a rectangle rug) in an accent colour: fringe, border bands, patterned field. */
export function rugTile(tx: number, ty: number, r: RugRect): PixMap {
  const rows: string[] = []
  for (let y = 0; y < 16; y++) {
    let row = ''
    for (let x = 0; x < 32; x++) {
      if (!inside(x, y)) {
        row += '.'
        continue
      }
      const [u, v] = uv(x, y)
      const gu = tx + u
      const gv = ty + v
      // distance (in tiles) to the nearest edge of the rug
      const du = Math.min(gu - r.x0, r.x1 + 1 - gu)
      const dv = Math.min(gv - r.y0, r.y1 + 1 - gv)
      const d = Math.min(du, dv * 1.0)
      let ch: string
      if (d < 0.07) ch = 'B'
      else if (d < 0.2) ch = 'a'
      else if (d < 0.27) ch = 'A'
      else if (d < 0.33) ch = 'B'
      else {
        const i = Math.floor(gu * 3)
        const j = Math.floor(gv * 3)
        ch = (i + j) % 2 === 0 ? 'b' : hash(x, y, 21) % 11 === 0 ? 'a' : 'b'
        if ((i + j) % 2 === 0 && frac(gu * 3) > 0.35 && frac(gu * 3) < 0.65 && frac(gv * 3) > 0.35 && frac(gv * 3) < 0.65) ch = 'a'
      }
      row += ch
    }
    rows.push(row)
  }
  return px(0, 0, ...rows)
}

export const rugPalette = (color: string): Palette => accentRamp(color)

/** A patch of n × n tiles as one pixel map (for the contact sheet and for tests). Origin of the map: the patch's north corner. */
export function floorPatch(kind: FloorKind, n: number, rug?: RugRect): { map: PixMap; pal: Palette } {
  const g = new Grid((n * 2) * 16, n * 16 + 8)
  const ramp = accentRamp('#a66be6')
  const pal: Palette = { ...FLOOR_PAL[kind], M: ramp.A, N: ramp.a, O: ramp.b, R: ramp.B }
  const swap: Record<string, string> = { A: 'M', a: 'N', b: 'O', B: 'R' }
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const m = floorTile(kind, tx, ty)
      const t = new Grid(32, 16)
      t.stamp(m.rows, 0, 0)
      g.blit(t, (tx - ty) * 16 + n * 16 - 16, (tx + ty) * 8)
      if (rug && tx >= rug.x0 && tx <= rug.x1 && ty >= rug.y0 && ty <= rug.y1) {
        const r = new Grid(32, 16)
        r.stamp(rugTile(tx, ty, rug).rows.map((row) => [...row].map((c) => swap[c] ?? c).join('')), 0, 0)
        g.blit(r, (tx - ty) * 16 + n * 16 - 16, (tx + ty) * 8)
      }
    }
  }
  return { map: g.toMap(0, 0), pal }
}
