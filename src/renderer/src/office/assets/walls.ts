import { DEPT, type DeptId } from '../departments'
import { drawClock, drawDecor, drawWindow, type WindowStyle } from './decor'
import { Elev } from './elev'
import { EastFace, Grid, IP, SouthFace, isoBox } from './iso'
import { BASE, accentRamp } from './palette'
import type { Palette, PixMap } from './pixmap'

/**
 * Walls. The back wall (north) is tall; the walls toward the camera (south) and between rooms (west) are low partitions:
 * a solid accent-coloured base with glass above, so you can see into every room. Each wall is drawn as one flat elevation
 * per room (paint, wainscot, windows, picture wall) and cut into 16 px tiles that are sheared onto an iso wall box.
 */
export const WALL_H = 44
export const LOW_H = 20
const TILE = 16
const AX = 18

interface Theme {
  paint: [string, string, string]
  window: WindowStyle
}

export const THEME: Record<DeptId, Theme> = {
  pm: { paint: ['#c79d6b', '#a88053', '#dab784'], window: 'open' },
  gd: { paint: ['#d8cde8', '#b9abd0', '#ebe4f5'], window: 'open' },
  art: { paint: ['#f1d2b6', '#d9b393', '#fbe6d3'], window: 'open' },
  audio: { paint: ['#2e5a5e', '#244749', '#3a6f73'], window: 'blinds' },
  dev: { paint: ['#47546e', '#374259', '#566581'], window: 'blinds' },
  qa: { paint: ['#dfeee9', '#c0d6cf', '#f0f8f5'], window: 'open' },
  integration: { paint: ['#8892a3', '#6c7585', '#9ba5b5'], window: 'slats' }
}

export const wallPalette = (dept: DeptId): Palette => {
  const [m, n, e] = THEME[dept].paint
  return { ...BASE, ...accentRamp(DEPT[dept].color), M: m, N: n, E: e }
}

const hashPx = (a: number, b: number, c: number): number => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

// ── elevations ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The inside face of the back wall of a room, `tiles` tiles wide. */
export function northElevation(dept: DeptId, tiles: number): Elev {
  const w = tiles * TILE
  const e = new Elev(w, WALL_H)
  const pm = dept === 'pm'
  e.r('M', 0, 0, w, WALL_H)
  // soft occlusion under the crown and above the wainscot
  e.r('N', 0, 15, w, 2)
  e.r('N', 0, 39, w, 2)
  for (let x = 0; x < w; x++) {
    for (let y = 17; y < 39; y++) {
      const h = hashPx(x, y, dept.length)
      if (pm) {
        // vertical wood panelling
        if (x % 5 === 0) e.p('N', x, y)
        else if (x % 5 === 1 && h % 4 === 0) e.p('E', x, y)
      } else if (h % 29 === 0) e.p('E', x, y)
      else if (h % 37 === 1) e.p('N', x, y)
    }
  }
  // crown moulding
  e.r('w', 0, 43, w, 1)
  e.r('E', 0, 42, w, 1)
  e.r('N', 0, 41, w, 1)
  // wainscot: accent panels between a rail and the base board
  e.r('b', 0, 3, w, 12)
  e.r('A', 0, 14, w, 1)
  e.r('a', 0, 13, w, 1)
  for (let t = 0; t < tiles; t++) {
    const x0 = t * TILE + 2
    e.r('B', x0, 5, 12, 7)
    e.r('b', x0 + 1, 6, 10, 5)
    e.r('a', x0 + 1, 6, 10, 1)
    e.r('a', x0 + 1, 6, 1, 5)
  }
  // base board
  e.r('4', 0, 0, w, 3)
  e.r('3', 0, 2, w, 1)
  e.r('k', 0, 0, w, 1)

  const win = THEME[dept].window
  if (pm) {
    for (const t of [1, tiles - 2]) drawWindow(e, t * TILE + 2, 19, 12, 21, 'open')
  } else {
    for (const t of [1, 6]) drawWindow(e, t * TILE + 2, 19, 28, 21, win)
    drawDecor(e, dept, 3 * TILE + 2, 17)
    drawClock(e, 8 * TILE + 3, 27)
  }
  return e
}

/** A low glass-topped partition, `tiles` tiles long. */
export function lowElevation(dept: DeptId, tiles: number): Elev {
  const w = tiles * TILE
  const e = new Elev(w, LOW_H)
  e.r('l', 0, 0, w, 3)
  e.r('j', 0, 2, w, 1)
  e.r('b', 0, 3, w, 6)
  e.r('B', 0, 3, w, 1)
  e.r('a', 0, 7, w, 1)
  e.r('A', 0, 8, w, 1)
  e.r('q', 0, 9, w, 9)
  for (let t = 0; t <= tiles; t++) {
    const x = Math.min(w - 1, t * TILE)
    e.r('h', x, 9, 1, 9)
  }
  for (let x = 4; x < w; x += 24) for (let t = 0; t < 4; t++) e.p('Q', x + t, 10 + t)
  e.r('i', 0, 18, w, 1)
  e.r('g', 0, 19, w, 1)
  return e
}

// ── tile sprites ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface TileSprite {
  map: PixMap
  pal: Palette
}

const cap = { top: 'g', south: 'M', east: 'N', rim: 'w' }

/** Tile k of the back wall of a room (the whole wall is `n` tiles). Anchor: the north corner of the tile (x, 0). */
export function northTile(dept: DeptId, k: number, elev: Elev): TileSprite {
  const g = new Grid(36, WALL_H + 22)
  const ay = WALL_H + 3
  isoBox(g, AX, ay, 0, 0.5, 1, 1, 0, WALL_H, cap)
  new SouthFace(g, ...IP(AX, ay, 0, 1, 0)).stamp(elev.slice(k), 0, 0)
  return { map: g.toMap(AX, ay), pal: wallPalette(dept) }
}

/** Tile k (from the west) of the glass wall on the camera side of a room (y = 10). */
export function southTile(dept: DeptId, k: number, elev: Elev): TileSprite {
  const g = new Grid(36, LOW_H + 22)
  const ay = LOW_H + 3
  isoBox(g, AX, ay, 0, 0.5, 1, 1, 0, LOW_H, { top: 'g', south: 'b', east: 'B', rim: 'w' })
  new SouthFace(g, ...IP(AX, ay, 0, 1, 0)).stamp(elev.slice(k), 0, 0)
  return { map: g.toMap(AX, ay), pal: wallPalette(dept) }
}

/** Tile k counted from the south end of a glass wall between rooms. Faces east (into the room on its east). */
export function westTile(dept: DeptId, k: number, elev: Elev): TileSprite {
  const g = new Grid(36, LOW_H + 22)
  const ay = LOW_H + 3
  isoBox(g, AX, ay, 0.5, 0, 1, 1, 0, LOW_H, { top: 'g', south: 'b', east: 'B', rim: 'w' })
  new EastFace(g, ...IP(AX, ay, 1, 1, 0)).stamp(elev.slice(k), 0, 0)
  return { map: g.toMap(AX, ay), pal: wallPalette(dept) }
}

export const DOOR_H = 30

/** A door post on one side of the opening. `side` L stands on the west edge of the first door tile, R on the east edge of the second. */
export function doorPost(dept: DeptId, side: 'L' | 'R'): TileSprite {
  const g = new Grid(36, DOOR_H + 22)
  const ay = DOOR_H + 3
  const [u0, u1] = side === 'L' ? [0, 0.18] : [0.82, 1]
  isoBox(g, AX, ay, u0, 0.5, u1, 1, 0, DOOR_H, { top: 'A', south: 'a', east: 'b', rim: 'A', edge: 'A', corner: 'B' })
  const [x, y] = IP(AX, ay, side === 'L' ? u0 : u1, 1, DOOR_H)
  g.rect(x - 1, y - 1, 4, 2, 'k')
  g.outline('k')
  return { map: g.toMap(AX, ay), pal: wallPalette(dept) }
}
