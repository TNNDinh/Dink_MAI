import type { Dir } from '../blueprint'
import type { DeptId } from '../departments'
import { EastFace, Grid, IP, SouthFace, groundShadow, isoBox, isoFlat, type Material } from './iso'
import type { PixMap } from './pixmap'
import { BOOKS, CLIPBOARD, DICE, HEADPHONES, LAMP, MINI_PLANT, MIXER, MUG, MUG_WHITE, NAMEPLATE, PALETTE_ART, PAPER_STACK, PEN_JAR, PHONE, SERVER, STICKY, monitorBackRows, monitorRows, screenContent, type ScreenState } from './props'

/**
 * Furniture sprites. Each is a PixMap built from an iso shell (slabs and boxes), a grain/texture pass, hand-drawn details
 * and an outline. Anchor = north corner of the object's first tile. Light comes from the upper left.
 */

export const WOOD: Material = { top: '1', south: '2', east: '3', rim: 'W', edge: 'W', corner: '4' }
export const WOOD_DARK: Material = { top: '2', south: '3', east: '4', rim: '1', edge: '1', corner: 'k' }
export const LAMINATE: Material = { top: 'i', south: 'j', east: 'l', rim: 'h', edge: 'A', corner: 'k' }
export const WHITE: Material = { top: 'g', south: 'h', east: 'i', rim: 'w', edge: 'w', corner: 'j' }
export const STEEL: Material = { top: 'h', south: 'i', east: 'j', rim: 'g', edge: 'A', corner: 'l' }
export const FABRIC: Material = { top: 'A', south: 'a', east: 'b', rim: 'A', edge: 'A', corner: 'B' }

const put = (g: Grid, rows: readonly string[], ax: number, ay: number, u: number, v: number, z: number): void => {
  const [x, y] = IP(ax, ay, u, v, z)
  g.stamp(rows, x - (rows[0].length >> 1), y - rows.length)
}

const grain = (g: Grid, top: string, to: string): void => g.speckle(top, to, (x, y) => (x + y * 2) % 11 === 0 || (x * 3 + y) % 17 === 0)

const DESK_MAT: Record<DeptId, Material> = { pm: WOOD_DARK, gd: WOOD, art: WOOD, audio: LAMINATE, dev: LAMINATE, qa: WHITE, integration: STEEL }

// ── desks ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const DESK_AX = 16
export const DESK_AY = 28
export const DESK_W = 32
export const DESK_H = 46

/**
 * A workstation is drawn once for a person looking north and then turned a quarter at a time, so every desk has its screen,
 * keyboard and drawers where the person at it expects them. (u, v) are tile coordinates of the desk as seen by a person
 * looking north (u to their right, v toward them); `turn` says where that point lands when the person looks toward `face`.
 */
export const turn = (face: Dir, u: number, v: number): [number, number] => (face === 'N' ? [u, v] : face === 'S' ? [1 - u, 1 - v] : face === 'E' ? [1 - v, u] : [v, 1 - u])

/** A turned footprint: the two turned corners, smallest first. */
const turnRect = (face: Dir, u0: number, v0: number, u1: number, v1: number): [number, number, number, number] => {
  const [a, b] = turn(face, u0, v0)
  const [c, d] = turn(face, u1, v1)
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

function box(g: Grid, ax: number, ay: number, face: Dir, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, m: Material): [number, number, number, number] {
  const r = turnRect(face, u0, v0, u1, v1)
  isoBox(g, ax, ay, r[0], r[1], r[2], r[3], z0, z1, m)
  return r
}

function deskShell(g: Grid, ax: number, ay: number, face: Dir, m: Material, u1 = 0.96, drawers = true): void {
  const sh = turnRect(face, 0.06, 0.16, u1 + 0.05, 0.95)
  groundShadow(g, ax, ay, sh[0], sh[1], sh[2], sh[3], 3, 2)
  // legs / pedestal under the slab
  box(g, ax, ay, face, 0.08, 0.2, 0.16, 0.82, 0, 8, { top: m.south, south: m.east, east: 'l' })
  let ped: [number, number, number, number] | null = null
  if (drawers) ped = box(g, ax, ay, face, u1 - 0.34, 0.16, u1 - 0.02, 0.84, 0, 8, { top: m.south, south: m.south, east: m.east, edge: m.east, corner: m.east })
  box(g, ax, ay, face, 0.04, 0.12, u1, 0.88, 8, 11, m)
  if (m === WOOD || m === WOOD_DARK) grain(g, m.top, m.south)
  if (ped) {
    // the drawer handle, on the side of the pedestal the camera sees
    const wpx = Math.round((ped[3] - ped[1]) * 16)
    const f = new EastFace(g, ...IP(ax, ay, ped[2], ped[3], 0))
    const hw = Math.max(1, Math.min(3, wpx - 2))
    const at = Math.max(0, (wpx - hw) >> 1)
    f.r('h', at, 4, hw, 1)
    f.r('k', at, 3, hw, 1)
  }
}

function keyboard(g: Grid, ax: number, ay: number, face: Dir, u: number, v: number): void {
  box(g, ax, ay, face, u, v, u + 0.42, v + 0.15, 11, 12, { top: 'w', south: 'h', east: 'i', rim: 'g' })
  g.speckle('w', 'h', (x, y) => (x + y) % 3 === 0)
}

/**
 * The desk of a workstation for a person looking toward `face` (N: the chair is south of the desk and the screen faces the
 * camera; S: the chair is north and we see the back of the screen; W: the screen faces east, to the camera; E: its back).
 */
export function deskMap(dept: DeptId, state: ScreenState, frame: number, face: Dir = 'N'): PixMap {
  const g = new Grid(DESK_W, DESK_H)
  const ax = DESK_AX
  const ay = DESK_AY
  const m = DESK_MAT[dept]
  deskShell(g, ax, ay, face, m)
  const z = 11
  const S = (rows: readonly string[], u: number, v: number, zz = z): void => {
    const [x, y] = turn(face, u, v)
    put(g, rows, ax, ay, x, y, zz)
  }
  const K = (u: number, v: number): void => keyboard(g, ax, ay, face, u, v)
  /** A monitor whose bottom-left corner (for the person) is at (u, v): its screen towards the person. */
  const mon = (u: number, v: number, iw: number, ih: number, fr: number): void => {
    const du = (iw + 4) / 16
    const screen = monitorRows(screenContent(dept, state, fr, iw, ih))
    const back = monitorBackRows(iw, ih, state === 'on')
    if (face === 'N') new SouthFace(g, ...IP(ax, ay, u, v, z)).stamp(screen, 0, 0)
    else if (face === 'S') new SouthFace(g, ...IP(ax, ay, 1 - u - du, 1 - v, z)).stamp(back, 0, 0)
    else if (face === 'W') new EastFace(g, ...IP(ax, ay, v, 1 - u, z)).stamp(screen, 0, 0)
    else new EastFace(g, ...IP(ax, ay, 1 - v, u + du, z)).stamp(back, 0, 0)
  }
  switch (dept) {
    case 'dev': {
      mon(0.02, 0.3, 4, 5, frame)
      mon(0.5, 0.3, 4, 5, frame + 1)
      K(0.28, 0.58)
      S(MUG, 0.86, 0.66)
      break
    }
    case 'art': {
      mon(0.1, 0.3, 7, 5, frame)
      // drawing tablet with a stylus
      box(g, ax, ay, face, 0.32, 0.56, 0.8, 0.84, 11, 12, { top: 'l', south: 'k', east: 'k', rim: 'j' })
      S(['w', 'w'], 0.62, 0.7, 12)
      S(PALETTE_ART, 0.1, 0.78, 12)
      S(PEN_JAR, 0.86, 0.3, 11)
      break
    }
    case 'audio': {
      mon(0.1, 0.3, 7, 5, frame)
      S(MIXER, 0.28, 0.72)
      S(HEADPHONES, 0.88, 0.7)
      break
    }
    case 'qa': {
      mon(0.1, 0.3, 7, 5, frame)
      K(0.28, 0.6)
      S(PHONE, 0.84, 0.62)
      S(CLIPBOARD, 0.1, 0.7)
      break
    }
    case 'gd': {
      mon(0.1, 0.3, 7, 5, frame)
      K(0.3, 0.6)
      S(BOOKS, 0.82, 0.6)
      S(STICKY, 0.12, 0.74)
      S(DICE, 0.9, 0.8)
      break
    }
    case 'integration': {
      mon(0.34, 0.3, 7, 5, frame)
      S(SERVER.map((r, j) => (state === 'on' && j % 2 === 0 && (frame + j) % 2 === 0 ? r.replace(/e/g, 'y') : r)), 0.04, 0.4)
      K(0.38, 0.62)
      break
    }
    default: {
      mon(0.1, 0.3, 7, 5, frame)
      K(0.3, 0.6)
    }
  }
  if (dept !== 'dev' && dept !== 'art') {
    if (dept === 'gd' || dept === 'pm') S(LAMP, 0.9, 0.3)
    else if (dept === 'integration') S(MUG_WHITE, 0.9, 0.7)
  }
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── PM desk (two tiles wide) ───────────────────────────────────────────────────────────────────────────────────

export const PMD_AX = 24
export const PMD_AY = 28

export function pmDeskMap(state: ScreenState, frame: number): PixMap {
  const g = new Grid(64, 46)
  const ax = PMD_AX
  const ay = PMD_AY
  groundShadow(g, ax, ay, 0.06, 0.16, 2.0, 0.95, 3, 2)
  isoBox(g, ax, ay, 0.1, 0.2, 0.3, 0.82, 0, 8, { top: '3', south: '3', east: '4' })
  isoBox(g, ax, ay, 1.62, 0.16, 1.94, 0.84, 0, 8, { top: '3', south: '3', east: '4', edge: '4', corner: '4' })
  isoBox(g, ax, ay, 0.04, 0.12, 1.96, 0.88, 8, 12, WOOD_DARK)
  grain(g, '2', '3')
  const f = new EastFace(g, ...IP(ax, ay, 1.94, 0.84, 0))
  f.r('Y', 3, 4, 3, 1)
  f.r('k', 3, 3, 3, 1)
  const z = 12
  const mon = (u: number, fr: number): void => {
    const [x, y] = IP(ax, ay, u, 0.3, z)
    new SouthFace(g, x, y).stamp(monitorRows(screenContent('pm', state, fr, 10, 6)), 0, 0)
  }
  mon(0.26, frame)
  mon(0.96, frame + 1)
  keyboard(g, ax, ay, 'N', 0.5, 0.6)
  put(g, PAPER_STACK, ax, ay, 1.38, 0.62, z)
  put(g, NAMEPLATE, ax, ay, 1.0, 0.8, z)
  put(g, LAMP, ax, ay, 0.12, 0.3, z)
  put(g, MUG, ax, ay, 1.74, 0.7, z)
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── chairs ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const CHAIR_AX = 16
export const CHAIR_AY = 28

export function chairSeatMap(): PixMap {
  const g = new Grid(32, 44)
  const ax = CHAIR_AX
  const ay = CHAIR_AY
  groundShadow(g, ax, ay, 0.2, 0.2, 0.85, 0.85, 2, 1)
  const [cx, cy] = IP(ax, ay, 0.5, 0.5, 0)
  for (const [dx, dy] of [[-7, -3], [7, 3], [-7, 3], [7, -3]] as const) {
    g.line(cx, cy, cx + dx, cy + dy, 'l')
    g.set(cx + dx, cy + dy + 1, 'k')
  }
  g.rect(cx - 1, cy - 9, 2, 9, 'i')
  g.set(cx - 1, cy - 9, 'h')
  isoBox(g, ax, ay, 0.2, 0.18, 0.8, 0.82, 7, 11, FABRIC)
  g.speckle('A', 'a', (x, y) => (x * 5 + y * 3) % 13 === 0)
  g.outline('k')
  return g.toMap(ax, ay)
}

/** The back of a chair for a person looking toward `face`: it stands on the side of the seat behind them. */
export function chairBackMap(face: Dir = 'N'): PixMap {
  const g = new Grid(32, 44)
  const ax = CHAIR_AX
  const ay = CHAIR_AY
  const r = box(g, ax, ay, face, 0.24, 0.74, 0.76, 0.86, 11, 24, { top: 'A', south: 'a', east: 'b', rim: 'A', edge: 'A', corner: 'B' })
  // the padding and the head rest, on the face the camera sees
  const f = face === 'N' || face === 'S' ? new SouthFace(g, ...IP(ax, ay, r[0], r[3], 11)) : new EastFace(g, ...IP(ax, ay, r[2], r[3], 11))
  f.r('b', 3, 6, 6, 1)
  f.r('B', 3, 5, 6, 1)
  f.r('j', 5, 0, 2, 3)
  g.outline('k')
  return g.toMap(ax, ay)
}

export function stoolMap(): PixMap {
  const g = new Grid(32, 36)
  const ax = 16
  const ay = 20
  groundShadow(g, ax, ay, 0.25, 0.25, 0.8, 0.8, 2, 1)
  const [cx, cy] = IP(ax, ay, 0.5, 0.5, 0)
  g.rect(cx - 1, cy - 8, 2, 8, 'j')
  g.line(cx - 5, cy + 1, cx + 5, cy + 1, 'l')
  isoBox(g, ax, ay, 0.28, 0.28, 0.72, 0.72, 8, 11, { top: 'v', south: 'V', east: 'l', rim: 'z', edge: 'z', corner: 'k' })
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── tables and sofa ─────────────────────────────────────────────────────────────────────────────────────────────

export const MT_AX = 40
export const MT_AY = 26

export function meetingTableMap(): PixMap {
  const g = new Grid(96, 74)
  const ax = MT_AX
  const ay = MT_AY
  groundShadow(g, ax, ay, 0.1, 0.12, 3.05, 1.98, 4, 3)
  isoBox(g, ax, ay, 0.45, 0.6, 0.75, 1.4, 0, 8, { top: '3', south: '3', east: '4' })
  isoBox(g, ax, ay, 2.25, 0.6, 2.55, 1.4, 0, 8, { top: '3', south: '3', east: '4' })
  isoBox(g, ax, ay, 0.05, 0.08, 2.95, 1.92, 8, 12, WOOD)
  grain(g, '1', '2')
  const z = 12
  // a lit panel in the middle: the shared screen
  isoFlat(g, ax, ay, 1.15, 0.7, 1.85, 1.3, z, 'Z')
  isoFlat(g, ax, ay, 1.25, 0.78, 1.75, 1.22, z, 'z')
  g.speckle('z', 'y', (x, y) => (x + y) % 4 === 0)
  for (const [u, v] of [[0.3, 0.3], [2.35, 0.34], [0.34, 1.5], [2.3, 1.5]] as const) {
    isoBox(g, ax, ay, u, v, u + 0.36, v + 0.22, z, z + 1, { top: 'w', south: 'c', east: 'C', rim: 'w' })
  }
  put(g, MUG_WHITE, ax, ay, 0.9, 0.2, z)
  put(g, MUG, ax, ay, 2.0, 1.7, z)
  g.outline('k')
  return g.toMap(ax, ay)
}

export function sofaMap(): PixMap {
  const g = new Grid(64, 56)
  const ax = 48
  const ay = 24
  groundShadow(g, ax, ay, 0.12, 0.05, 1.0, 2.0, 3, 2)
  isoBox(g, ax, ay, 0.12, 0.08, 0.96, 1.92, 0, 8, FABRIC)
  isoBox(g, ax, ay, 0.12, 0.08, 0.96, 0.3, 8, 14, FABRIC)
  isoBox(g, ax, ay, 0.12, 1.7, 0.96, 1.92, 8, 14, FABRIC)
  isoBox(g, ax, ay, 0.66, 0.08, 0.96, 1.92, 8, 20, { top: 'A', south: 'a', east: 'b', rim: 'A', edge: 'A', corner: 'B' })
  g.speckle('A', 'a', (x, y) => (x * 3 + y * 7) % 9 === 0)
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── shelves, plants, hall furniture ─────────────────────────────────────────────────────────────────────────────

const BOOK_COLORS = 'dYvepohwzV'

export function bookshelfMap(): PixMap {
  const g = new Grid(32, 56)
  const ax = 16
  const ay = 38
  groundShadow(g, ax, ay, 0.08, 0.08, 0.92, 0.92, 3, 2)
  isoBox(g, ax, ay, 0.08, 0.08, 0.92, 0.92, 0, 32, { top: '2', south: '3', east: '2', rim: '1', edge: '1', corner: '4' })
  // the front looks east: three shelves of books
  const f = new EastFace(g, ...IP(ax, ay, 0.92, 0.92, 0))
  f.r('4', 1, 1, 13, 29)
  for (let s = 0; s < 3; s++) {
    const base = 2 + s * 9
    f.r('3', 1, base, 13, 1)
    let col = 2
    for (let b = 0; b < 12 && col < 13; b++) {
      const h = 5 + ((b * 7 + s * 3) % 3)
      const w = 1 + ((b + s) % 2)
      f.r(BOOK_COLORS[(b * 3 + s * 5) % BOOK_COLORS.length], col, base + 1, w, h)
      col += w
    }
  }
  g.outline('k')
  return g.toMap(ax, ay)
}

export function filingCabinetMap(): PixMap {
  const g = new Grid(32, 44)
  const ax = 16
  const ay = 26
  groundShadow(g, ax, ay, 0.15, 0.15, 0.9, 0.9, 3, 2)
  isoBox(g, ax, ay, 0.15, 0.15, 0.85, 0.85, 0, 20, { top: 'h', south: 'i', east: 'h', rim: 'g', edge: 'g', corner: 'j' })
  const f = new EastFace(g, ...IP(ax, ay, 0.85, 0.85, 0))
  for (let d = 0; d < 3; d++) {
    f.r('i', 1, 1 + d * 6, 10, 5)
    f.r('g', 1, 5 + d * 6, 10, 1)
    f.r('j', 4, 3 + d * 6, 3, 1)
    f.r('w', 4, 4 + d * 6, 3, 1)
  }
  g.outline('k')
  return g.toMap(ax, ay)
}

const LEAF_A = ['.kk..', 'kffk.', 'kefnk', '.knnk', '..kk.']
const LEAF_B = ['..kk.', '.kffk', 'knfek', 'knnk.', '.kk..']

export function plantMap(kind: 'tall' | 'small' = 'tall'): PixMap {
  const g = new Grid(32, 48)
  const ax = 16
  const ay = 28
  groundShadow(g, ax, ay, 0.28, 0.28, 0.78, 0.78, 2, 1)
  const [cx, cy] = IP(ax, ay, 0.5, 0.5, 0)
  // pot
  g.stamp(['kkkkkkkk', 'kmmmmmmk', 'kRrrrrRk', '.kRrrRk.', '.kRRRRk.', '..kkkk..'], cx - 4, cy - 3)
  const tall = kind === 'tall'
  g.rect(cx - 1, cy - (tall ? 22 : 12), 2, tall ? 19 : 9, 'n')
  const leaves: Array<[string[], number, number]> = tall
    ? [[LEAF_A, -8, -19], [LEAF_B, 2, -21], [LEAF_A, -9, -12], [LEAF_B, 3, -14], [LEAF_A, -4, -27], [LEAF_B, -2, -18], [LEAF_A, 3, -8], [LEAF_B, -9, -6]]
    : [[LEAF_A, -6, -13], [LEAF_B, 1, -14], [LEAF_A, -3, -17]]
  for (const [l, dx, dy] of leaves) g.stamp(l, cx + dx, cy + dy)
  g.outline('k')
  return g.toMap(ax, ay)
}

export function coolerMap(): PixMap {
  const g = new Grid(32, 52)
  const ax = 16
  const ay = 34
  groundShadow(g, ax, ay, 0.25, 0.25, 0.8, 0.8, 3, 2)
  isoBox(g, ax, ay, 0.22, 0.22, 0.78, 0.78, 0, 15, { top: 'g', south: 'h', east: 'i', rim: 'w', edge: 'w', corner: 'j' })
  // the water bottle
  isoBox(g, ax, ay, 0.28, 0.28, 0.72, 0.72, 15, 27, { top: 'Q', south: 'q', east: 'z', rim: 'w' })
  g.speckle('q', 'Q', (x, y) => (x + y * 2) % 7 === 0)
  const f = new EastFace(g, ...IP(ax, ay, 0.78, 0.78, 0))
  f.r('v', 3, 8, 2, 2)
  f.r('d', 7, 8, 2, 2)
  f.r('j', 2, 4, 8, 1)
  g.outline('k')
  return g.toMap(ax, ay)
}

export function vendingMap(): PixMap {
  const g = new Grid(32, 64)
  const ax = 16
  const ay = 44
  groundShadow(g, ax, ay, 0.12, 0.12, 0.92, 0.92, 3, 2)
  isoBox(g, ax, ay, 0.12, 0.12, 0.92, 0.92, 0, 34, { top: 'a', south: 'b', east: 'a', rim: 'A', edge: 'A', corner: 'B' })
  const f = new EastFace(g, ...IP(ax, ay, 0.92, 0.92, 0))
  f.r('Z', 2, 8, 9, 22)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) f.r('dYvepoh'[(r * 3 + c) % 7], 3 + c * 3, 11 + r * 5, 2, 3)
    f.r('j', 3, 10 + r * 5, 8, 1)
  }
  f.r('l', 2, 2, 9, 4)
  f.r('y', 3, 3, 3, 2)
  g.outline('k')
  return g.toMap(ax, ay)
}

export function benchMap(): PixMap {
  const g = new Grid(64, 40)
  const ax = 48
  const ay = 22
  groundShadow(g, ax, ay, 0.15, 0.1, 0.95, 1.95, 3, 2)
  isoBox(g, ax, ay, 0.2, 0.12, 0.34, 0.24, 0, 7, { top: 'j', south: 'j', east: 'l' })
  isoBox(g, ax, ay, 0.2, 1.76, 0.34, 1.88, 0, 7, { top: 'j', south: 'j', east: 'l' })
  isoBox(g, ax, ay, 0.16, 0.08, 0.9, 1.92, 7, 10, FABRIC)
  isoBox(g, ax, ay, 0.62, 0.08, 0.9, 1.92, 10, 18, { top: 'A', south: 'a', east: 'b', rim: 'A', edge: 'A', corner: 'B' })
  g.outline('k')
  return g.toMap(ax, ay)
}

export const FURNITURE_MAPS: Record<string, PixMap> = {
  'chair.seat': chairSeatMap(),
  'chair.back': chairBackMap(),
  ...Object.fromEntries((['S', 'E', 'W'] as Dir[]).map((f) => [`chair.back.${f}`, chairBackMap(f)])),
  stool: stoolMap(),
  'meeting-table': meetingTableMap(),
  sofa: sofaMap(),
  bookshelf: bookshelfMap(),
  filing: filingCabinetMap(),
  'plant.tall': plantMap('tall'),
  'plant.small': plantMap('small'),
  cooler: coolerMap(),
  vending: vendingMap(),
  bench: benchMap(),
  'pm-desk': pmDeskMap('on', 0),
  ...Object.fromEntries((['pm', 'gd', 'art', 'audio', 'dev', 'qa', 'integration'] as DeptId[]).flatMap((d) => (['on', 'idle', 'err', 'off'] as ScreenState[]).map((s) => [`desk.${d}.${s}`, deskMap(d, s, 0)]))),
  ...Object.fromEntries((['S', 'E', 'W'] as Dir[]).flatMap((f) => (['dev', 'art', 'qa'] as DeptId[]).map((d) => [`desk.${d}.on.${f}`, deskMap(d, 'on', 0, f)])))
}
