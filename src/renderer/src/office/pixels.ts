/** Small helpers for drawing crisp pixel art with the canvas (no anti-aliasing) and caching the pieces as sprites. */

export type G = CanvasRenderingContext2D
export type Pt = [number, number]

export interface Sprite {
  c: HTMLCanvasElement
  /** Where the anchor (a tile's north corner, or the feet) sits inside the sprite. */
  ox: number
  oy: number
}

const cache = new Map<string, Sprite>()

/** Paints a sprite once and keeps it. `paint` gets a context and the anchor. */
export function sprite(key: string, w: number, h: number, ox: number, oy: number, paint: (g: G, ox: number, oy: number) => void): Sprite {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  paint(g, ox, oy)
  const s = { c, ox, oy }
  cache.set(key, s)
  return s
}

export const clearSpriteCache = (): void => cache.clear()

export const rect = (g: G, color: string, x: number, y: number, w: number, h: number): void => {
  g.fillStyle = color
  g.fillRect(x, y, w, h)
}

/** Fills a convex polygon pixel by pixel (the canvas path fill would blur the edges). */
export function poly(g: G, pts: Pt[], color: string): void {
  let minY = Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minY = Math.min(minY, p[1])
    maxY = Math.max(maxY, p[1])
  }
  g.fillStyle = color
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
    if (hi > lo) {
      const x0 = Math.round(lo)
      const x1 = Math.round(hi)
      if (x1 > x0) g.fillRect(x0, y, x1 - x0, 1)
    }
  }
}

/** Screen position of the grid point (u, v) at height z, relative to the anchor of the sprite (ax, ay). */
export const P = (ax: number, ay: number, u: number, v: number, z = 0): Pt => [ax + (u - v) * 16, ay + (u + v) * 8 - z]

/** An upright box on the floor. Footprint u0..u1 × v0..v1 (tiles), from height z0 to z1 (pixels). */
export function box(g: G, ax: number, ay: number, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, top: string, south: string, east: string): void {
  // the faces that face the camera: the south side (v = v1) and the east side (u = u1)
  poly(g, [P(ax, ay, u0, v1, z0), P(ax, ay, u1, v1, z0), P(ax, ay, u1, v1, z1), P(ax, ay, u0, v1, z1)], south)
  poly(g, [P(ax, ay, u1, v0, z0), P(ax, ay, u1, v1, z0), P(ax, ay, u1, v1, z1), P(ax, ay, u1, v0, z1)], east)
  poly(g, [P(ax, ay, u0, v0, z1), P(ax, ay, u1, v0, z1), P(ax, ay, u1, v1, z1), P(ax, ay, u0, v1, z1)], top)
}

/** The diamond of one floor tile whose north corner is at (nx, ny). */
export function diamond(g: G, nx: number, ny: number, color: string): void {
  g.fillStyle = color
  for (let r = 0; r < 16; r++) {
    const hw = r < 8 ? 2 * r + 2 : 2 * (15 - r) + 2
    g.fillRect(nx - hw, ny + r, hw * 2, 1)
  }
}

/**
 * Paints on a flat surface that faces south (a wall, the front of a monitor): the surface runs along x, so on the
 * screen it climbs 1 px per 2 px. (i, j) are pixels along the surface and up from its bottom edge.
 */
export class Face {
  constructor(
    private g: G,
    private x0: number,
    private y0: number
  ) {}
  /** (x0, y0) is the screen position of the bottom-left corner. */
  r(color: string, i: number, j: number, w: number, h: number): void {
    this.g.fillStyle = color
    for (let k = 0; k < w; k++) {
      const x = this.x0 + i + k
      const y = this.y0 + Math.floor((i + k) / 2) - j - h
      this.g.fillRect(x, y, 1, h)
    }
  }
}

export const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Lighter (f > 1) or darker (f < 1) version of a #rrggbb colour. */
export const shade = (c: string, f: number): string => {
  const [r, g, b] = hex(c).map((v) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f))))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}
