import { px, type PixMap } from './pixmap'

/**
 * Pixel-map authoring kit. A Grid is a canvas of palette characters (no colours, no DOM), so every sprite of the office is
 * a plain PixMap that can be checked, dumped to a PNG contact sheet and baked later. Hand-drawn details are written as
 * rows of characters and stamped on top of the iso shells (the 2:1 slab/box silhouettes artists draw from a grid).
 */
export type Pt = [number, number]

export class Grid {
  readonly cells: string[]
  constructor(
    readonly w: number,
    readonly h: number
  ) {
    this.cells = new Array<string>(w * h).fill('.')
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }
  get(x: number, y: number): string {
    return this.inside(x, y) ? this.cells[y * this.w + x] : '.'
  }
  set(x: number, y: number, ch: string): void {
    if (this.inside(x, y)) this.cells[y * this.w + x] = ch
  }
  rect(x: number, y: number, w: number, h: number, ch: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch)
  }
  /** Convex polygon, scan-converted so a 2:1 edge stays a clean pixel staircase. */
  poly(pts: Pt[], ch: string): void {
    let minY = Infinity
    let maxY = -Infinity
    for (const p of pts) {
      minY = Math.min(minY, p[1])
      maxY = Math.max(maxY, p[1])
    }
    for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
      const sy = y + 0.5
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          const x = a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0])
          lo = Math.min(lo, x)
          hi = Math.max(hi, x)
        }
      }
      if (hi > lo) for (let x = Math.round(lo); x < Math.round(hi); x++) this.set(x, y, ch)
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, ch: string): void {
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    for (;;) {
      this.set(x0, y0, ch)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x0 += sx
      }
      if (e2 < dx) {
        err += dx
        y0 += sy
      }
    }
  }
  /** Draws rows of characters at (x, y); "." and " " leave the grid alone, "_" erases. */
  stamp(rows: readonly string[], x: number, y: number): void {
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < rows[j].length; i++) {
        const ch = rows[j][i]
        if (ch === '.' || ch === ' ') continue
        this.set(x + i, y + j, ch === '_' ? '.' : ch)
      }
    }
  }
  /** Replaces `from` by `to` on pixels chosen by `pick(x, y)` (grain, speckles, dither). */
  speckle(from: string, to: string, pick: (x: number, y: number) => boolean): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y) === from && pick(x, y)) this.set(x, y, to)
  }
  /** Surrounds the drawing with a 1 px outline: every empty pixel that touches a filled one (4-neighbourhood). */
  outline(ch = 'k', skip = ''): void {
    const add: Array<[number, number]> = []
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== '.') continue
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = this.get(x + dx, y + dy)
          if (n !== '.' && !skip.includes(n)) {
            add.push([x, y])
            break
          }
        }
      }
    }
    for (const [x, y] of add) this.set(x, y, ch)
  }
  /** Draws another grid at (x, y); empty pixels are skipped. */
  blit(o: Grid, x: number, y: number): void {
    for (let j = 0; j < o.h; j++) for (let i = 0; i < o.w; i++) if (o.get(i, j) !== '.') this.set(x + i, y + j, o.get(i, j))
  }
  rows(): string[] {
    const out: string[] = []
    for (let y = 0; y < this.h; y++) out.push(this.cells.slice(y * this.w, (y + 1) * this.w).join(''))
    return out
  }
  toMap(ox: number, oy: number): PixMap {
    return px(ox, oy, ...this.rows())
  }
}

/** Screen position of the tile coordinates (u, v) at height z from the anchor (ax, ay) = north corner of tile (0, 0). */
export const IP = (ax: number, ay: number, u: number, v: number, z = 0): Pt => [Math.round(ax + (u - v) * 16), Math.round(ay + (u + v) * 8 - z)]

export interface Material {
  top: string
  south: string
  east: string
  /** Highlight on the top rim facing the light (north-west), and on the upper edge of the south face. */
  rim?: string
  edge?: string
  /** Dark vertical corner line between the two faces. */
  corner?: string
}

/** An upright box on the floor. Footprint u0..u1 × v0..v1 in tiles, from z0 to z1 pixels. */
export function isoBox(g: Grid, ax: number, ay: number, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, m: Material): void {
  g.poly([IP(ax, ay, u0, v1, z0), IP(ax, ay, u1, v1, z0), IP(ax, ay, u1, v1, z1), IP(ax, ay, u0, v1, z1)], m.south)
  g.poly([IP(ax, ay, u1, v0, z0), IP(ax, ay, u1, v1, z0), IP(ax, ay, u1, v1, z1), IP(ax, ay, u1, v0, z1)], m.east)
  g.poly([IP(ax, ay, u0, v0, z1), IP(ax, ay, u1, v0, z1), IP(ax, ay, u1, v1, z1), IP(ax, ay, u0, v1, z1)], m.top)
  if (m.edge) {
    const a = IP(ax, ay, u0, v1, z1)
    const b = IP(ax, ay, u1, v1, z1)
    g.line(a[0], a[1], b[0] - 1, b[1], m.edge)
  }
  if (m.rim) {
    const a = IP(ax, ay, u0, v1, z1)
    const b = IP(ax, ay, u0, v0, z1)
    const c = IP(ax, ay, u1, v0, z1)
    g.line(a[0] + 1, a[1] - 1, b[0], b[1], m.rim)
    g.line(b[0], b[1], c[0] - 1, c[1] + 1, m.rim)
  }
  if (m.corner) {
    const a = IP(ax, ay, u1, v1, z0)
    const b = IP(ax, ay, u1, v1, z1)
    g.line(a[0] - 1, a[1] - 1, b[0] - 1, b[1] + 1, m.corner)
  }
}

/** A flat diamond (floor tile, rug, light pool) of the tile footprint u0..u1 × v0..v1 at height z. */
export function isoFlat(g: Grid, ax: number, ay: number, u0: number, v0: number, u1: number, v1: number, z: number, ch: string): void {
  g.poly([IP(ax, ay, u0, v0, z), IP(ax, ay, u1, v0, z), IP(ax, ay, u1, v1, z), IP(ax, ay, u0, v1, z)], ch)
}

/** A surface that faces south (front of a monitor, a wall, a cabinet). (x, y) is its bottom-left corner on screen. */
export class SouthFace {
  constructor(
    private g: Grid,
    private x0: number,
    private y0: number
  ) {}
  /** Fills i..i+w along the surface and j..j+h up from its bottom; the surface climbs 1 px per 2 px. */
  r(ch: string, i: number, j: number, w: number, h: number): void {
    for (let k = 0; k < w; k++) {
      const x = this.x0 + i + k
      const y = this.y0 + Math.floor((i + k) / 2) - j - h
      for (let t = 0; t < h; t++) this.g.set(x, y + t, ch)
    }
  }
  /** Paints rows of characters on the surface (row 0 is the top). */
  stamp(rows: readonly string[], i: number, j: number): void {
    const h = rows.length
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c]
        if (ch === '.' || ch === ' ') continue
        const col = i + c
        const x = this.x0 + col
        const y = this.y0 + Math.floor(col / 2) - j - (h - r)
        this.g.set(x, y, ch === '_' ? '.' : ch)
      }
    }
  }
}

/** Like SouthFace, but for a surface that faces east: seen from the camera it climbs 1 px per 2 px going right. (x, y) is its bottom-left corner. */
export class EastFace {
  constructor(
    private g: Grid,
    private x0: number,
    private y0: number
  ) {}
  r(ch: string, i: number, j: number, w: number, h: number): void {
    for (let k = 0; k < w; k++) {
      const x = this.x0 + i + k
      const y = this.y0 - Math.floor((i + k) / 2) - j - h
      for (let t = 0; t < h; t++) this.g.set(x, y + t, ch)
    }
  }
  stamp(rows: readonly string[], i: number, j: number): void {
    const h = rows.length
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c]
        if (ch === '.' || ch === ' ') continue
        const col = i + c
        this.g.set(this.x0 + col, this.y0 - Math.floor(col / 2) - j - (h - r), ch === '_' ? '.' : ch)
      }
    }
  }
}

/** Ground shadow of a thing: a soft diamond pushed away from the light (south-east). */
export function groundShadow(g: Grid, ax: number, ay: number, u0: number, v0: number, u1: number, v1: number, dx = 3, dy = 2): void {
  const p = [IP(ax, ay, u0, v0, 0), IP(ax, ay, u1, v0, 0), IP(ax, ay, u1, v1, 0), IP(ax, ay, u0, v1, 0)].map(([x, y]) => [x + dx, y + dy] as Pt)
  g.poly(p, 'x')
}
