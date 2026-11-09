import { DEPARTMENTS, DEPT, type DeptId } from './departments'
import { DESK_COLS, HALL_Y, ROOM_H, deskOf, getLayout, roomOf, type Tile } from './layout'
import type { Employee, EmployeeStatus, OfficeSnapshot } from './model'
import { Face, P, box, diamond, hex, poly, rect, shade, sprite, type G, type Pt, type Sprite } from './pixels'
import type { Actor, Dir, OfficeSim } from './sim'

const WALL_H = 44
const LOW_H = 12
const BG = '#0d1016'

// ── the world canvas ─────────────────────────────────────────────────────────────────────────────────────────────

export interface WorldInfo {
  w: number
  h: number
  ox: number
  oy: number
}

export const worldInfo = (): WorldInfo => {
  const L = getLayout()
  return { ox: L.h * 16 + 48, oy: WALL_H + 40, w: (L.w + L.h) * 16 + 96, h: (L.w + L.h) * 8 + WALL_H + 80 }
}

/** World pixel of the north corner of tile (x, y) (fractions allowed). */
export const toWorld = (x: number, y: number): Pt => {
  const W = worldInfo()
  return [(x - y) * 16 + W.ox, (x + y) * 8 + W.oy]
}

export interface View {
  scale: number
  panX: number
  panY: number
}

export const MIN_SCALE = 0.5
export const MAX_SCALE = 4

export function fitView(width: number, height: number): View {
  const W = worldInfo()
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(width / W.w, height / W.h) * 0.98))
  return { scale, panX: (width - W.w * scale) / 2, panY: (height - W.h * scale) / 2 }
}

/** A view with the given tile in the middle of the screen. */
export function focusView(width: number, height: number, scale: number, tx: number, ty: number): View {
  const [wx, wy] = toWorld(tx + 0.5, ty + 0.5)
  return { scale, panX: width / 2 - wx * scale, panY: height / 2 - wy * scale }
}

// ── sprites: furniture ───────────────────────────────────────────────────────────────────────────────────────────

const roomAtX = (x: number): DeptId | null => {
  const L = getLayout()
  for (let i = L.rooms.length - 1; i >= 0; i--) if (x >= L.rooms[i].x) return L.rooms[i].dept
  return null
}

function wallSprite(kind: 'N' | 'X' | 'Y', accent: string): Sprite {
  const H = kind === 'N' ? WALL_H : LOW_H
  return sprite(`wall:${kind}:${accent}`, 40, H + 28, 20, H, (g, ax, ay) => {
    const north = kind === 'N'
    const [u0, u1, v0, v1] = kind === 'Y' ? [0.3, 0.7, 0, 1] : [0, 1, 0.3, 0.7]
    box(g, ax, ay, u0, v0, u1, v1, 0, H, north ? '#8590aa' : '#7a85a0', north ? '#4f5974' : '#555f7a', '#39415a')
    if (kind === 'Y') return
    // the south face is a surface along x: base board, accent stripe, top edge
    const f = new Face(g, Math.round(P(ax, ay, 0, 0.7, 0)[0]), Math.round(P(ax, ay, 0, 0.7, 0)[1]))
    f.r('#2c3347', 0, 0, 16, north ? 3 : 2)
    if (north) {
      f.r(accent, 0, H - 9, 16, 2)
      f.r('#6b7694', 0, H - 2, 16, 1)
    } else {
      f.r(accent, 0, H - 4, 16, 1)
    }
  })
}

function plantSprite(): Sprite {
  return sprite('plant', 32, 40, 16, 30, (g, ax, ay) => {
    const [cx, cy] = P(ax, ay, 0.5, 0.5, 0)
    rect(g, '#6b4a33', cx - 4, cy - 7, 9, 7)
    rect(g, '#4f3624', cx - 4, cy - 7, 9, 1)
    rect(g, '#3d9a4b', cx - 2, cy - 17, 5, 10)
    rect(g, '#52b95e', cx - 6, cy - 14, 5, 6)
    rect(g, '#52b95e', cx + 2, cy - 15, 5, 7)
    rect(g, '#2f7a3b', cx - 1, cy - 21, 3, 6)
    rect(g, '#7fd68b', cx - 5, cy - 14, 1, 2)
    rect(g, '#7fd68b', cx + 3, cy - 15, 1, 2)
  })
}

function cabinetSprite(): Sprite {
  return sprite('cabinet', 32, 56, 16, 34, (g, ax, ay) => {
    box(g, ax, ay, 0.12, 0.12, 0.88, 0.88, 0, 26, '#c3cad6', '#9aa3b4', '#7b8497')
    const f = new Face(g, Math.round(P(ax, ay, 0.12, 0.88, 0)[0]), Math.round(P(ax, ay, 0.12, 0.88, 0)[1]))
    for (const j of [3, 10, 17]) {
      f.r('#6c7488', 3, j, 9, 6)
      f.r('#dfe4ee', 6, j + 3, 3, 1)
    }
  })
}

function stoolSprite(color: string): Sprite {
  return sprite(`stool:${color}`, 32, 28, 16, 12, (g, ax, ay) => {
    const [cx, cy] = P(ax, ay, 0.5, 0.5, 0)
    rect(g, '#2a2f3b', cx - 1, cy - 6, 3, 6)
    box(g, ax, ay, 0.3, 0.3, 0.7, 0.7, 6, 9, shade(color, 1.1), shade(color, 0.8), shade(color, 0.6))
  })
}

function chairSprites(color: string): { seat: Sprite; back: Sprite } {
  const seat = sprite(`chair-seat:${color}`, 32, 30, 16, 14, (g, ax, ay) => {
    const [cx, cy] = P(ax, ay, 0.5, 0.5, 0)
    rect(g, '#20242d', cx - 4, cy - 1, 9, 2)
    rect(g, '#2a2f3b', cx - 1, cy - 7, 3, 6)
    box(g, ax, ay, 0.22, 0.2, 0.78, 0.8, 7, 10, shade(color, 1.15), shade(color, 0.8), shade(color, 0.6))
  })
  const back = sprite(`chair-back:${color}`, 32, 40, 16, 26, (g, ax, ay) => {
    box(g, ax, ay, 0.22, 0.72, 0.78, 0.84, 10, 21, shade(color, 1.05), shade(color, 0.85), shade(color, 0.6))
  })
  return { seat, back }
}

type DeskScreen = 'on' | 'idle' | 'err' | 'off'

const DESK_TOP: Record<DeptId, [string, string, string]> = {
  pm: ['#a07a52', '#7d5e3f', '#664c33'],
  gd: ['#b08a5e', '#8c6b46', '#725638'],
  art: ['#c0a37a', '#9a7f5b', '#7e6648'],
  audio: ['#566274', '#3f4958', '#313944'],
  dev: ['#5b6578', '#434c5c', '#343b48'],
  qa: ['#9aa0ac', '#767c89', '#5e6470'],
  integration: ['#6b7482', '#505866', '#3e4551']
}

const SCREEN_COLOR: Record<DeptId, [string, string]> = {
  pm: ['#9fd6ff', '#5aa7e0'],
  gd: ['#e6d6ff', '#a98be0'],
  art: ['#ffd9b8', '#f0a05c'],
  audio: ['#aaf0e6', '#3cc4b5'],
  dev: ['#bfe6ff', '#4fb2ff'],
  qa: ['#ffc9c4', '#f0766c'],
  integration: ['#c9f7d1', '#52d674']
}

function screenLines(g: G, f: Face, i: number, j: number, w: number, h: number, dept: DeptId, frame: number, state: DeskScreen): void {
  if (state === 'off') {
    f.r('#12151b', i, j, w, h)
    return
  }
  if (state === 'err') {
    f.r('#5a1c1c', i, j, w, h)
    f.r('#ff7b72', i + 1, j + h - 3, w - 2, 1)
    f.r('#ff7b72', i + 1, j + 2, Math.max(2, w - 5), 1)
    return
  }
  const [light, strong] = SCREEN_COLOR[dept]
  f.r(state === 'idle' ? '#1b2230' : '#0f1724', i, j, w, h)
  if (state === 'idle') {
    f.r('#34405a', i + 1, j + Math.floor(h / 2), w - 2, 1)
    return
  }
  for (let r = 0; r < h - 1; r += 2) {
    const len = 2 + ((r * 5 + frame * 3 + (r >> 1) * 7) % (w - 3))
    f.r(r % 4 === 0 ? light : strong, i + 1 + ((r >> 1) % 2), j + h - 2 - r, Math.min(len, w - 2), 1)
  }
  void g
}

function monitor(g: G, f: Face, i: number, w: number, dept: DeptId, frame: number, state: DeskScreen): void {
  f.r('#1c2029', i, 2, w, 9)
  screenLines(g, f, i + 1, 3, w - 2, 7, dept, frame, state)
  f.r('#2b303b', i + Math.floor(w / 2) - 1, 0, 3, 2)
}

function deskSprite(dept: DeptId, state: DeskScreen, frame: number): Sprite {
  return sprite(`desk:${dept}:${state}:${frame}`, 40, 44, 20, 30, (g, ax, ay) => {
    const [top, south, east] = DESK_TOP[dept]
    box(g, ax, ay, 0.06, 0.14, 0.94, 0.86, 0, 10, top, south, east)
    // legs peeking under the front edge
    rect(g, shade(east, 0.8), Math.round(P(ax, ay, 0.1, 0.86, 0)[0]), Math.round(P(ax, ay, 0.1, 0.86, 0)[1]) - 1, 1, 1)
    const z = 10
    const origin = P(ax, ay, 0, 0.36, z)
    const f = new Face(g, Math.round(origin[0]), Math.round(origin[1]))
    switch (dept) {
      case 'dev':
        monitor(g, f, 1, 7, dept, frame, state)
        monitor(g, f, 8, 7, dept, frame + 1, state)
        break
      case 'integration': {
        monitor(g, f, 6, 9, dept, frame, state)
        box(g, ax, ay, 0.08, 0.2, 0.34, 0.5, z, z + 9, '#8a94a6', '#5f6878', '#4a5262')
        rect(g, state === 'on' ? '#52d674' : '#3a4150', Math.round(P(ax, ay, 0.2, 0.5, z + 5)[0]), Math.round(P(ax, ay, 0.2, 0.5, z + 5)[1]), 2, 1)
        break
      }
      case 'qa':
        monitor(g, f, 3, 9, dept, frame, state)
        rect(g, '#20242d', Math.round(P(ax, ay, 0.8, 0.6, z)[0]) - 1, Math.round(P(ax, ay, 0.8, 0.6, z)[1]) - 3, 3, 3)
        rect(g, '#ff7b72', Math.round(P(ax, ay, 0.15, 0.6, z)[0]), Math.round(P(ax, ay, 0.15, 0.6, z)[1]) - 2, 2, 2)
        break
      case 'art': {
        monitor(g, f, 2, 10, dept, frame, state)
        poly(g, [P(ax, ay, 0.55, 0.62, z), P(ax, ay, 0.9, 0.62, z), P(ax, ay, 0.9, 0.82, z), P(ax, ay, 0.55, 0.82, z)], '#262b36')
        const c = P(ax, ay, 0.2, 0.7, z)
        rect(g, '#e5675d', c[0], c[1] - 2, 1, 1)
        rect(g, '#f5d547', c[0] + 2, c[1] - 2, 1, 1)
        rect(g, '#5b9bf0', c[0] + 4, c[1] - 1, 1, 1)
        break
      }
      case 'audio': {
        monitor(g, f, 2, 9, dept, frame, state)
        const c = P(ax, ay, 0.78, 0.62, z)
        rect(g, '#20242d', c[0] - 4, c[1] - 6, 1, 4)
        rect(g, '#20242d', c[0] + 4, c[1] - 6, 1, 4)
        rect(g, '#20242d', c[0] - 4, c[1] - 7, 9, 1)
        rect(g, '#3cc4b5', c[0] - 5, c[1] - 4, 2, 3)
        rect(g, '#3cc4b5', c[0] + 4, c[1] - 4, 2, 3)
        break
      }
      case 'gd':
        monitor(g, f, 3, 9, dept, frame, state)
        {
          const c = P(ax, ay, 0.2, 0.66, z)
          rect(g, '#f5d547', c[0], c[1] - 2, 3, 2)
          rect(g, '#f58fb4', c[0] + 3, c[1] - 1, 3, 2)
        }
        break
      default:
        monitor(g, f, 3, 9, dept, frame, state)
    }
    // keyboard
    poly(g, [P(ax, ay, 0.3, 0.58, z), P(ax, ay, 0.7, 0.58, z), P(ax, ay, 0.7, 0.72, z), P(ax, ay, 0.3, 0.72, z)], '#d3d8e2')
  })
}

function pmDeskSprite(): Sprite {
  return sprite('pm-desk', 72, 56, 36, 38, (g, ax, ay) => {
    box(g, ax, ay, 0.04, 0.12, 1.96, 0.88, 0, 11, '#a37a4f', '#7d5c3b', '#654a31')
    const z = 11
    const f = new Face(g, Math.round(P(ax, ay, 0, 0.34, z)[0]), Math.round(P(ax, ay, 0, 0.34, z)[1]))
    monitor(g, f, 6, 11, 'pm', 1, 'on')
    monitor(g, f, 19, 11, 'pm', 2, 'on')
    poly(g, [P(ax, ay, 1.2, 0.56, z), P(ax, ay, 1.65, 0.56, z), P(ax, ay, 1.65, 0.8, z), P(ax, ay, 1.2, 0.8, z)], '#f2f2f2')
    poly(g, [P(ax, ay, 0.35, 0.58, z), P(ax, ay, 0.8, 0.58, z), P(ax, ay, 0.8, 0.72, z), P(ax, ay, 0.35, 0.72, z)], '#d3d8e2')
    rect(g, '#e0b341', Math.round(P(ax, ay, 1.0, 0.82, z)[0]) - 3, Math.round(P(ax, ay, 1.0, 0.82, z)[1]) - 2, 6, 2)
  })
}

function meetingTableSprite(): Sprite {
  return sprite('meeting-table', 100, 56, 50, 30, (g, ax, ay) => {
    box(g, ax, ay, 0.05, 0.08, 2.95, 1.92, 0, 11, '#8a6a49', '#6b4f36', '#563f2a')
    const z = 11
    poly(g, [P(ax, ay, 1.2, 0.8, z), P(ax, ay, 1.8, 0.8, z), P(ax, ay, 1.8, 1.2, z), P(ax, ay, 1.2, 1.2, z)], '#2a3a55')
    for (const [u, v] of [[0.4, 0.4], [2.3, 0.5], [0.5, 1.4], [2.2, 1.45]]) poly(g, [P(ax, ay, u, v, z), P(ax, ay, u + 0.3, v, z), P(ax, ay, u + 0.3, v + 0.22, z), P(ax, ay, u, v + 0.22, z)], '#f2f2f2')
  })
}

function sofaSprite(): Sprite {
  return sprite('sofa', 56, 52, 24, 24, (g, ax, ay) => {
    box(g, ax, ay, 0.15, 0.08, 0.95, 1.92, 0, 9, '#7a3f55', '#5e2f41', '#4b2535')
    box(g, ax, ay, 0.15, 0.08, 0.35, 1.92, 9, 20, '#8f4d66', '#6e3a4e', '#5a2e40')
  })
}

function rugColor(): string {
  return 'rgba(0,0,0,0.18)'
}

// ── sprites: people ──────────────────────────────────────────────────────────────────────────────────────────────

const SKINS = ['#f1c7a0', '#e3a97d', '#c98b5e', '#a26a44', '#7a4d32']
const HAIRS = ['#2b2118', '#5a3a22', '#a8672f', '#d9b25f', '#8a8f9a', '#c9473b', '#3b2a55']
const PANTS = ['#2f3a52', '#3d3a36', '#4a4f5e', '#2d4a3e']

export interface Look {
  skin: string
  hair: string
  style: number
  glasses: boolean
  shirt: string
  shirtDark: string
  pants: string
}

export function lookOf(look: number, dept: DeptId): Look {
  const c = DEPT[dept].color
  const k = Math.abs(look)
  const tone = [1, 0.82, 1.2][k % 3]
  const shirt = shade(c, tone)
  return {
    skin: SKINS[(k * 3 + (k >> 3)) % SKINS.length],
    hair: HAIRS[(k * 5 + (k >> 2)) % HAIRS.length],
    style: (k * 7 + (k >> 3)) % 5,
    glasses: (k * 11) % 4 === 0,
    shirt,
    shirtDark: shade(shirt, 0.72),
    pants: PANTS[(k * 13) % PANTS.length]
  }
}

const PM_LOOK: Look = { skin: '#e8b58c', hair: '#e8e8ee', style: 0, glasses: true, shirt: '#25304d', shirtDark: '#1a2238', pants: '#1c2336' }

type Pose = 'stand' | 'walk' | 'sit'

/** One 16×30 frame; the feet stand at (8, 28). */
function personSprite(look: Look, back: boolean, pose: Pose, frame: number, pm: boolean): Sprite {
  const key = `person:${look.skin}${look.hair}${look.style}${look.glasses}${look.shirt}${look.pants}:${back}:${pose}:${frame}:${pm}`
  return sprite(key, 16, 30, 8, 28, (g) => {
    const T = 3
    const walkSwing = pose === 'walk' ? [0, 1, 0, -1][frame % 4] : 0
    const legL = pose === 'walk' ? [0, -2, 0, 0][frame % 4] : 0
    const legR = pose === 'walk' ? [0, 0, 0, -2][frame % 4] : 0
    const typing = pose === 'sit' ? frame % 2 : 0
    // legs
    if (pose !== 'sit') {
      rect(g, look.pants, 5, T + 15, 3, 8 + legL)
      rect(g, look.pants, 8, T + 15, 3, 8 + legR)
      rect(g, '#1b1e26', 5, T + 23 + legL, 3, 2)
      rect(g, '#1b1e26', 8, T + 23 + legR, 3, 2)
    } else {
      rect(g, look.pants, 5, T + 14, 6, 2)
    }
    // torso and arms
    rect(g, look.shirt, 4, T + 8, 8, 7)
    rect(g, look.shirtDark, 10, T + 8, 2, 7)
    const armY = pose === 'sit' ? T + 8 - typing : T + 8
    rect(g, look.shirt, 2, armY + (pose === 'walk' ? walkSwing : 0), 2, 5)
    rect(g, look.shirtDark, 12, armY + (pose === 'walk' ? -walkSwing : 0), 2, 5)
    rect(g, look.skin, 2, armY + 5 + (pose === 'walk' ? walkSwing : 0), 2, 2)
    rect(g, look.skin, 12, armY + 5 + (pose === 'walk' ? -walkSwing : 0), 2, 2)
    if (pm) {
      if (!back) {
        rect(g, '#f4f4f6', 7, T + 8, 2, 2)
        rect(g, '#c0392b', 7, T + 10, 2, 5)
        rect(g, '#e0b341', 10, T + 10, 2, 2)
      } else {
        rect(g, '#e0b341', 6, T + 8, 4, 1)
      }
    }
    // head
    rect(g, look.skin, 7, T + 7, 2, 1)
    rect(g, look.skin, 5, T + 2, 6, 5)
    if (!back) {
      rect(g, '#1d2029', 6, T + 4, 1, 1)
      rect(g, '#1d2029', 9, T + 4, 1, 1)
      if (look.glasses) {
        rect(g, '#2a2f3b', 5, T + 3, 3, 1)
        rect(g, '#2a2f3b', 8, T + 3, 3, 1)
        rect(g, '#2a2f3b', 5, T + 5, 3, 1)
        rect(g, '#2a2f3b', 8, T + 5, 3, 1)
      }
    }
    // hair
    const hair = look.hair
    const cap = !pm && look.style === 2
    if (cap) {
      rect(g, '#e5e9f2', 4, T + 1, 8, 2)
      if (!back) rect(g, '#cfd5e2', 4, T + 3, 8, 1)
    } else {
      rect(g, hair, 5, T + 1, 6, 2)
      if (back) rect(g, hair, 5, T + 3, 6, 4)
      if (look.style === 1 || look.style === 4) {
        rect(g, hair, 4, T + 2, 1, 5)
        rect(g, hair, 11, T + 2, 1, 5)
      }
      if (look.style === 4) rect(g, hair, 6, T, 1, 1), rect(g, hair, 9, T, 2, 1)
      if (look.style === 3) rect(g, look.skin, 5, T + 1, 6, 1)
      rect(g, shade(hair, 1.25), 6, T + 1, 2, 1)
    }
    if (pm) {
      // a small gold crown so the PM is never mistaken for somebody else
      rect(g, '#e0b341', 5, T, 6, 1)
      rect(g, '#e0b341', 5, T - 2, 1, 2)
      rect(g, '#e0b341', 7, T - 2, 2, 2)
      rect(g, '#e0b341', 10, T - 2, 1, 2)
    }
  })
}

function docSprite(): Sprite {
  return sprite('doc', 9, 11, 4, 10, (g) => {
    rect(g, '#f3f1e6', 0, 0, 8, 10)
    rect(g, '#d6d2bd', 5, 0, 3, 3)
    rect(g, '#7c8597', 1, 3, 5, 1)
    rect(g, '#7c8597', 1, 5, 6, 1)
    rect(g, '#7c8597', 1, 7, 4, 1)
  })
}

// ── drawing the scene ────────────────────────────────────────────────────────────────────────────────────────────

interface Item {
  d: number
  /** Order among items of the same depth: floor things, then furniture, then people. */
  o: number
  fn: (g: G) => void
}

let floorCanvas: HTMLCanvasElement | null = null
let worldCanvas: HTMLCanvasElement | null = null
let statics: Item[] | null = null

function paintFloor(): HTMLCanvasElement {
  const W = worldInfo()
  const L = getLayout()
  const c = document.createElement('canvas')
  c.width = W.w
  c.height = W.h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.fillStyle = BG
  g.fillRect(0, 0, W.w, W.h)
  const tile = (x: number, y: number, color: string): void => {
    const [nx, ny] = toWorld(x, y)
    diamond(g, nx, ny, color)
  }
  for (const r of L.rooms) {
    const d = DEPT[r.dept]
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const wall = y === r.y || y === r.y + r.h - 1 || x === r.x || x === r.x + r.w - 1
        const door = r.door.some((t) => t.x === x && t.y === y)
        tile(x, y, door ? shade(d.color, 0.55) : wall ? '#1b1f28' : d.floor[(x + y) % 2])
      }
    }
  }
  for (let y = L.hall.y; y < L.hall.y + L.hall.h; y++) {
    for (let x = L.hall.x; x < L.hall.x + L.hall.w; x++) {
      const runner = y === HALL_Y + 1 || y === HALL_Y + 2
      tile(x, y, runner ? ['#454f69', '#3e4860'][(x + y) % 2] : ['#383f4e', '#323847'][(x + y) % 2])
    }
  }
  tile(L.entrance.x, L.entrance.y, '#7b3434')
  // a rug under the meeting table
  const pm = roomOf('pm')
  for (let y = 4; y <= 7; y++) for (let x = 8; x <= 12; x++) tile(pm.x + x, y, (x + y) % 2 ? '#3b4a6b' : '#364464')
  return c
}

function buildStatics(): Item[] {
  const L = getLayout()
  const items: Item[] = []
  const at = (x: number, y: number): Pt => toWorld(x, y)
  const put = (s: Sprite, x: number, y: number, d: number, o: number): void => {
    const [sx, sy] = at(x, y)
    items.push({ d, o, fn: (g) => g.drawImage(s.c, Math.round(sx - s.ox), Math.round(sy - s.oy)) })
  }
  // walls
  for (let x = 0; x < L.w; x++) {
    const dept = roomAtX(x)
    put(wallSprite('N', dept ? DEPT[dept].color : '#888'), x, 0, x + 0.5, 0)
  }
  const edges = new Set<number>(L.rooms.map((r) => r.x))
  edges.add(L.w - 1)
  for (const c of edges) {
    for (let y = 1; y < ROOM_H - 1; y++) put(wallSprite('Y', '#888'), c, y, c + y + 1, 0)
  }
  for (let x = 0; x < L.w; x++) {
    if (L.rooms.some((r) => r.door.some((t) => t.x === x))) continue
    const dept = roomAtX(x)
    put(wallSprite('X', dept ? DEPT[dept].color : '#888'), x, ROOM_H - 1, x + ROOM_H - 0.5, 0)
  }
  // wall decorations of the staff rooms
  for (const r of L.rooms) {
    if (r.dept === 'pm') continue
    for (const [span, name] of [[1, 'a'], [6, 'b']] as const) {
      const s = decorSprite(r.dept, name)
      put(s, r.x + span, 0, r.x + span + 2.5 + 0.02, 1)
    }
  }
  // furniture
  const props = L.props
  for (const p of props) {
    if (p.kind === 'plant') put(plantSprite(), p.x, p.y, p.x + p.y + 1, 1)
    else if (p.kind === 'cabinet') put(cabinetSprite(), p.x, p.y, p.x + p.y + 1, 1)
    else if (p.kind === 'pm-desk') put(pmDeskSprite(), p.x, p.y, p.x + p.w - 1 + p.y + 1, 1)
    else if (p.kind === 'meeting-table') put(meetingTableSprite(), p.x, p.y, p.x + p.w - 1 + p.y + p.h - 1 + 0.9, 1)
    else if (p.kind === 'sofa') put(sofaSprite(), p.x, p.y, p.x + p.y + p.h - 0.2, 1)
  }
  const stool = stoolSprite('#5d6d8f')
  for (const s of L.pm.meetingSeats) put(stool, s.x, s.y, s.x + s.y + 1, 1)
  const pmChair = chairSprites('#2c3552')
  put(pmChair.seat, L.pm.seat.x, L.pm.seat.y, L.pm.seat.x + L.pm.seat.y + 0.98, 1)
  return items
}

/** Pictures and equipment on the back wall of a department. 3 tiles wide. */
function decorSprite(dept: DeptId, which: 'a' | 'b'): Sprite {
  return sprite(`decor:${dept}:${which}`, 96, WALL_H + 44, 16, WALL_H, (g, ax, ay) => {
    const o = P(ax, ay, 0, 0.7, 0)
    const f = new Face(g, Math.round(o[0]), Math.round(o[1]))
    const frame = (i: number, j: number, w: number, h: number, bg: string): void => {
      f.r('#2a3042', i - 1, j - 1, w + 2, h + 2)
      f.r(bg, i, j, w, h)
    }
    const color = DEPT[dept].color
    const I = 4
    const J = 14
    switch (`${dept}:${which}`) {
      case 'gd:a': {
        frame(I, J, 40, 22, '#f2f4f8')
        for (const [i, j, c] of [[4, 4, '#f5d547'], [14, 12, '#f58fb4'], [26, 6, '#7fd0f5'], [30, 14, '#b9f58f']] as const) f.r(c, I + i, J + j, 6, 5)
        f.r('#7c8597', I + 10, J + 7, 4, 1)
        f.r('#7c8597', I + 20, J + 9, 5, 1)
        break
      }
      case 'gd:b': {
        frame(I, J, 40, 22, '#b07f4d')
        for (const [i, j, c] of [[3, 3, '#f3f1e6'], [14, 8, '#f3f1e6'], [26, 4, '#f5d547'], [8, 13, '#f58fb4'], [29, 12, '#f3f1e6']] as const) {
          f.r(c, I + i, J + j, 7, 6)
          f.r('#e5675d', I + i + 3, J + j + 5, 1, 1)
        }
        break
      }
      case 'art:a': {
        for (let k = 0; k < 3; k++) {
          frame(I + k * 14, J + 2, 11, 16, '#f2f4f8')
          f.r(['#ee8a4c', '#5b9bf0', '#6bc46d'][k], I + k * 14 + 1, J + 3, 9, 7)
          f.r(['#f5d547', '#e5675d', '#b07ff0'][k], I + k * 14 + 4, J + 11, 5, 5)
        }
        break
      }
      case 'art:b': {
        frame(I, J, 40, 22, '#e8dcc6')
        const cs = ['#e5675d', '#ee8a4c', '#f5d547', '#6bc46d', '#3cc4b5', '#5b9bf0', '#a66be6', '#f58fb4']
        cs.forEach((c, k) => f.r(c, I + 3 + (k % 4) * 9, J + 3 + Math.floor(k / 4) * 9, 7, 7))
        break
      }
      case 'audio:a': {
        frame(I, J, 40, 22, '#0f1d22')
        for (let k = 0; k < 36; k += 2) {
          const h = 2 + Math.abs(Math.round(Math.sin(k * 0.55) * 8))
          f.r('#3cc4b5', I + 2 + k, J + 11 - Math.floor(h / 2), 1, h)
        }
        break
      }
      case 'audio:b': {
        for (const k of [0, 22]) {
          frame(I + 2 + k, J + 2, 16, 20, '#1d2229')
          f.r('#454d5c', I + 6 + k, J + 4, 8, 7)
          f.r('#454d5c', I + 8 + k, J + 14, 4, 5)
          f.r('#8791a5', I + 9 + k, J + 7, 2, 1)
        }
        break
      }
      case 'dev:a': {
        frame(I, J, 40, 22, '#0f1724')
        const cols = ['#7ee787', '#79c0ff', '#d2a8ff', '#ffa657']
        for (let r = 0; r < 9; r++) f.r(cols[(r * 3) % 4], I + 2 + ((r * 5) % 3) * 3, J + 19 - r * 2, 6 + ((r * 7) % 15), 1)
        break
      }
      case 'dev:b': {
        frame(I + 8, J - 4, 24, 28, '#1b1f27')
        for (let r = 0; r < 4; r++) {
          f.r('#2e3441', I + 9, J - 3 + r * 7, 22, 5)
          f.r(r % 2 ? '#7ee787' : '#ffa657', I + 11, J - 1 + r * 7, 2, 1)
          f.r('#4fb2ff', I + 15, J - 1 + r * 7, 2, 1)
        }
        break
      }
      case 'qa:a': {
        frame(I, J, 40, 22, '#f2f4f8')
        for (let r = 0; r < 4; r++) {
          f.r(r === 3 ? '#e5675d' : '#6bc46d', I + 3, J + 16 - r * 5, 3, 3)
          f.r('#9aa3b4', I + 9, J + 17 - r * 5, 18 + ((r * 5) % 9), 1)
        }
        f.r('#e5675d', I + 31, J + 4, 5, 5)
        f.r('#f2f4f8', I + 33, J + 6, 1, 1)
        break
      }
      case 'qa:b': {
        frame(I, J, 40, 22, '#3a3f4b')
        for (let k = 0; k < 4; k++) {
          f.r('#13161c', I + 3 + k * 9, J + 4, 6, 12)
          f.r(['#5b9bf0', '#6bc46d', '#f5d547', '#e5675d'][k], I + 4 + k * 9, J + 6, 4, 8)
        }
        break
      }
      case 'integration:a': {
        frame(I, J, 40, 22, '#101826')
        const bx = [3, 17, 30]
        bx.forEach((x, k) => {
          f.r(['#4fb2ff', '#a66be6', '#52d674'][k], I + x, J + 8, 8, 7)
          if (k < 2) f.r('#9aa4b2', I + x + 9, J + 11, 4, 1)
        })
        f.r('#52d674', I + 3, J + 3, 14, 1)
        break
      }
      default: {
        frame(I + 4, J, 32, 22, '#1b1f27')
        for (let r = 0; r < 5; r++) {
          f.r('#2e3441', I + 5, J + 1 + r * 4, 30, 3)
          for (let k = 0; k < 6; k++) f.r(k % 3 === r % 3 ? '#52d674' : '#454d5c', I + 7 + k * 4, J + 2 + r * 4, 2, 1)
        }
      }
    }
    f.r(color, 0, 4, 1, 1)
  })
}

const STATUS_COLOR: Record<EmployeeStatus, string> = {
  working: '#4fb2ff',
  in_review: '#f5b942',
  queued: '#9aa4b2',
  waiting: '#6b7486',
  failed: '#ff6b61',
  blocked: '#ff6b61',
  done: '#52d674'
}

export const statusColor = (s: EmployeeStatus): string => STATUS_COLOR[s]

function screenOf(e: Employee | undefined): DeskScreen {
  if (!e) return 'off'
  if (e.status === 'working') return 'on'
  if (e.status === 'failed' || e.status === 'blocked') return 'err'
  if (e.status === 'in_review' || e.status === 'queued') return 'idle'
  return 'off'
}

/** The boards on the PM's back wall: they show the real state of the project. */
function drawBoards(g: G, snap: OfficeSnapshot, t: number): void {
  const L = getLayout()
  const panel = (span: [number, number], w: number, bg: string): Face => {
    const o = toWorld(span[0], 0.7)
    const f = new Face(g, Math.round(o[0]), Math.round(o[1]))
    f.r('#2a3042', 3, 11, w + 2, 26)
    f.r(bg, 4, 12, w, 24)
    return f
  }
  // project board: one bar per department, how much of its work is done
  const p = panel(L.pm.panels.project, 40, '#f2f4f8')
  let row = 0
  for (const d of DEPARTMENTS) {
    if (d.id === 'pm') continue
    const info = snap.departments[d.id]
    p.r('#d3d8e2', 6, 31 - row * 3, 36, 2)
    if (info.tasks > 0) p.r(d.color, 6, 31 - row * 3, Math.max(1, Math.round((36 * info.done) / info.tasks)), 2)
    row += 1
  }
  // kanban: five columns, a card per task (up to 5)
  const k = panel(L.pm.panels.kanban, 56, '#e9ecf2')
  const cols: Array<[string, number]> = [
    ['#9aa4b2', snap.kanban.todo],
    ['#4fb2ff', snap.kanban.in_progress],
    ['#f5b942', snap.kanban.review + snap.kanban.testing],
    ['#52d674', snap.kanban.done],
    ['#ff6b61', snap.kanban.failed + snap.kanban.blocked]
  ]
  cols.forEach(([c, n], i) => {
    const x = 6 + i * 11
    k.r(c, x, 31, 9, 2)
    for (let r = 0; r < Math.min(n, 5); r++) k.r(shade(c, 1.25), x, 26 - r * 4, 9, 3)
    if (n > 5) k.r(c, x + 3, 5, 3, 1)
  })
  // status screen: overall progress and the state of the run
  const s = panel(L.pm.panels.status, 40, '#0f1724')
  const total = snap.kanban.todo + snap.kanban.in_progress + snap.kanban.review + snap.kanban.testing + snap.kanban.done + snap.kanban.failed + snap.kanban.blocked
  s.r('#1f2a3d', 6, 18, 36, 5)
  if (total > 0) s.r('#52d674', 6, 18, Math.max(1, Math.round((36 * snap.kanban.done) / total)), 5)
  const live = snap.pm.runStatus === 'running'
  const runColor = snap.pm.runStatus === 'failed' ? '#ff6b61' : snap.pm.runStatus === 'completed' ? '#4fb2ff' : live ? '#52d674' : '#6b7486'
  s.r(!live || Math.floor(t * 2) % 2 === 0 ? runColor : '#1f2a3d', 6, 28, 4, 4)
  s.r('#34405a', 12, 29, 20, 1)
  s.r('#34405a', 12, 31, 12, 1)
}

function shadow(g: G, x: number, y: number, w = 11): void {
  g.fillStyle = 'rgba(0,0,0,0.28)'
  g.fillRect(Math.round(x - w / 2), Math.round(y - 1), w, 3)
  g.fillRect(Math.round(x - w / 2 + 2), Math.round(y - 2), w - 4, 1)
}

const viewOf = (dir: Dir): { back: boolean; flip: boolean } => {
  switch (dir) {
    case 'S':
      return { back: false, flip: false }
    case 'E':
      return { back: false, flip: true }
    case 'W':
      return { back: true, flip: false }
    default:
      return { back: true, flip: true }
  }
}

/** Where an actor's feet are in the world (tile centre; a seated person is a little above the floor). */
export const feetOf = (a: Actor): Pt => {
  const [x, y] = toWorld(a.x + 0.5, a.y + 0.5)
  return [x, y]
}

function actorItem(a: Actor, look: Look, snap: OfficeSnapshot | null, t: number): Item {
  const [fx, fy] = feetOf(a)
  const pm = a.kind === 'pm'
  const { back, flip } = viewOf(a.facing)
  const frame = a.pose === 'walk' ? Math.floor(a.walkPhase) % 4 : a.pose === 'sit' ? Math.floor(t * 4 + a.x) % 2 : 0
  const emp = snap?.employees.find((e) => e.id === a.id)
  const typing = a.pose === 'sit' && (pm || emp?.status === 'working')
  return {
    d: a.x + a.y + 1 + 0.02,
    o: 3,
    fn: (g) => {
      const s = personSprite(look, back, a.pose, typing || a.pose !== 'sit' ? frame : 0, pm)
      shadow(g, fx, fy + (a.pose === 'sit' ? 0 : 0))
      const lift = a.pose === 'sit' ? 8 : 0
      const x = Math.round(fx - s.ox)
      const y = Math.round(fy - s.oy - lift)
      if (flip) {
        g.save()
        g.translate(x + 16, y)
        g.scale(-1, 1)
        g.drawImage(s.c, 0, 0)
        g.restore()
      } else g.drawImage(s.c, x, y)
      if (a.carrying) {
        const d = docSprite()
        const side = flip ? -4 : 4
        g.drawImage(d.c, Math.round(fx + side - d.ox), Math.round(fy - d.oy - 3 - lift))
      }
    }
  }
}

function buildItems(sim: OfficeSim, t: number): Item[] {
  statics ??= buildStatics()
  const items: Item[] = [...statics]
  const snap = sim.snapshot
  const L = getLayout()
  if (snap) {
    const chairColor: Record<DeptId, string> = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, shade(d.color, 0.55)])) as Record<DeptId, string>
    for (const e of snap.employees) {
      const d = deskOf(e.department, e.deskIndex)
      const [dx, dy] = toWorld(d.desk.x, d.desk.y)
      const [cx, cy] = toWorld(d.chair.x, d.chair.y)
      const state = screenOf(e)
      const frame = state === 'on' ? Math.floor(t * 3 + e.deskIndex) % 3 : 0
      const spr = deskSprite(e.department, state, frame)
      items.push({ d: d.desk.x + d.desk.y + 1, o: 1, fn: (g) => g.drawImage(spr.c, Math.round(dx - spr.ox), Math.round(dy - spr.oy)) })
      const ch = chairSprites(chairColor[e.department])
      items.push({ d: d.chair.x + d.chair.y + 0.97, o: 1, fn: (g) => g.drawImage(ch.seat.c, Math.round(cx - ch.seat.ox), Math.round(cy - ch.seat.oy)) })
      items.push({ d: d.chair.x + d.chair.y + 1.2, o: 4, fn: (g) => g.drawImage(ch.back.c, Math.round(cx - ch.back.ox), Math.round(cy - ch.back.oy)) })
    }
    items.push({ d: L.pm.panels.status[1] + 0.9, o: 2, fn: (g) => drawBoards(g, snap, t) })
  }
  const pmChair = chairSprites('#2c3552')
  const [pcx, pcy] = toWorld(L.pm.seat.x, L.pm.seat.y)
  items.push({ d: L.pm.seat.x + L.pm.seat.y + 1.2, o: 4, fn: (g) => g.drawImage(pmChair.back.c, Math.round(pcx - pmChair.back.ox), Math.round(pcy - pmChair.back.oy)) })
  for (const a of sim.ordered()) {
    const emp = snap?.employees.find((e) => e.id === a.id)
    items.push(actorItem(a, a.kind === 'pm' ? PM_LOOK : lookOf(emp?.look ?? 0, a.dept), snap, t))
  }
  items.sort((p, q) => p.d - q.d || p.o - q.o)
  return items
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface DrawOpts {
  selected: string | null
  hovered: string | null
  /** Seconds, for the animations of screens and typing. */
  time: number
}

export function renderOffice(ctx: CanvasRenderingContext2D, width: number, height: number, sim: OfficeSim, view: View, opts: DrawOpts): void {
  const W = worldInfo()
  floorCanvas ??= paintFloor()
  if (!worldCanvas) {
    worldCanvas = document.createElement('canvas')
    worldCanvas.width = W.w
    worldCanvas.height = W.h
  }
  const wg = worldCanvas.getContext('2d')!
  wg.imageSmoothingEnabled = false
  wg.drawImage(floorCanvas, 0, 0)
  for (const it of buildItems(sim, opts.time)) it.fn(wg)

  ctx.save()
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(worldCanvas, view.panX, view.panY, W.w * view.scale, W.h * view.scale)
  ctx.restore()
  drawOverlay(ctx, sim, view, opts)
}

const toScreen = (view: View, wx: number, wy: number): Pt => [wx * view.scale + view.panX, wy * view.scale + view.panY]

/** The centre of a person on the screen (for clicking). */
export function actorScreen(a: Actor, view: View): Pt {
  const [fx, fy] = feetOf(a)
  return toScreen(view, fx, fy - (a.pose === 'sit' ? 16 : 10))
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, dot?: string): void {
  ctx.font = '600 11px system-ui, sans-serif'
  const pad = 6
  const w = ctx.measureText(text).width + pad * 2 + (dot ? 10 : 0)
  const h = 17
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - h, w, h, 5)
  ctx.fill()
  let tx = x - w / 2 + pad
  if (dot) {
    ctx.fillStyle = dot
    ctx.beginPath()
    ctx.arc(tx + 3, y - h / 2, 3, 0, Math.PI * 2)
    ctx.fill()
    tx += 10
  }
  ctx.fillStyle = fg
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, tx, y - h / 2 + 0.5)
}

function speech(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.font = '500 11px system-ui, sans-serif'
  const t = clip(text, 46)
  const w = ctx.measureText(t).width + 14
  const h = 19
  ctx.fillStyle = '#fbfbfd'
  ctx.strokeStyle = '#1b1f2a'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - h - 5, w, h, 6)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 4, y - 6)
  ctx.lineTo(x, y - 1)
  ctx.lineTo(x + 4, y - 6)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#1b1f2a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(t, x, y - h / 2 - 4.5)
}

function drawOverlay(ctx: CanvasRenderingContext2D, sim: OfficeSim, view: View, opts: DrawOpts): void {
  const snap = sim.snapshot
  const L = getLayout()
  ctx.save()
  // department signs on the back walls
  for (const r of L.rooms) {
    const d = DEPT[r.dept]
    const [wx, wy] = toWorld(r.x + r.w / 2, 0.7)
    const [sx, sy] = toScreen(view, wx, wy - WALL_H - 3)
    const n = snap ? (r.dept === 'pm' ? 1 : snap.departments[r.dept].employees) : 0
    const over = snap && r.dept !== 'pm' ? snap.departments[r.dept].overflow : 0
    const label = r.dept === 'pm' ? d.short : `${d.short} · ${n}${over > 0 ? ` +${over}` : ''}`
    pill(ctx, sx, sy, label, d.color, hex(d.color).reduce((a, b) => a + b, 0) > 480 ? '#111' : '#fff')
  }
  if (!snap) {
    ctx.restore()
    return
  }
  const detail = view.scale >= 1.25
  const names = view.scale >= 2.7
  const list = sim.ordered()
  for (const a of list) {
    const emp = snap.employees.find((e) => e.id === a.id)
    const [sx, sy] = toScreen(view, ...feetOf(a))
    const head = sy - (a.pose === 'sit' ? 38 : 40) * view.scale
    const hot = opts.selected === a.id || opts.hovered === a.id
    if (hot) {
      ctx.strokeStyle = opts.selected === a.id ? '#ffffff' : 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(sx, sy, 9 * view.scale, 4.5 * view.scale, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    const color = a.kind === 'pm' ? '#e0b341' : emp ? STATUS_COLOR[emp.status] : '#9aa4b2'
    if (a.bubble) {
      speech(ctx, sx, head, a.bubble.text)
    } else if (detail || hot || a.kind === 'pm') {
      const task = emp ? snap.tasks.find((t) => t.taskId === emp.assignedTaskId) : undefined
      const text = a.kind === 'pm' ? `PM · ${snap.pm.name}` : a.label ?? (task ? task.title : emp?.currentActivity ?? '')
      pill(ctx, sx, head, clip(text, 26), 'rgba(16,19,27,0.88)', '#e8ebf2', color)
      if (detail && emp && emp.progress !== null && a.kind !== 'pm') {
        const bw = 34
        ctx.fillStyle = 'rgba(16,19,27,0.88)'
        ctx.fillRect(sx - bw / 2, head + 2, bw, 4)
        ctx.fillStyle = color
        ctx.fillRect(sx - bw / 2 + 0.5, head + 2.5, (bw - 1) * Math.max(0.04, emp.progress), 3)
      }
    }
    if ((names || hot) && emp) {
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const w = ctx.measureText(emp.name).width + 8
      ctx.fillStyle = 'rgba(16,19,27,0.75)'
      ctx.fillRect(sx - w / 2, sy + 3, w, 14)
      ctx.fillStyle = '#e8ebf2'
      ctx.fillText(emp.name, sx, sy + 5)
    }
  }
  ctx.restore()
}

export type { Tile }
void rugColor
