import type { DeptId } from './departments'

/**
 * The floor plan. One row of rooms with a hall along the front, seen from the south-east in isometric view:
 * tile (x, y) is drawn at ((x − y)·TW/2, (x + y)·TH/2), so x grows to the right-and-down and y to the left-and-down.
 *
 *   GD | ART | AUDIO | PM | DEV | QA | INTEG        y 0..10   (north wall at y 0 is the tall back wall, doors on the south wall)
 *   ───────────── hall ─────────────────────         y 11..14
 *
 * Every staff room has 4 desk rows × 4 desks. A desk is a tile with its chair on the tile south of it; the chair is
 * reached from the aisle column on the east of the desk column. Desks are placed from the door outwards, so a desk
 * never moves when another one is added.
 */

export const ROOM_W = 10
export const ROOM_H = 11
export const PM_W = 14
export const HALL_Y = 11
export const HALL_H = 4
export const GRID_H = HALL_Y + HALL_H
/** Desks per row and rows per room (the staff cap is their product). */
export const DESK_COLS = 4
export const DESK_ROWS = 4

export interface Tile {
  x: number
  y: number
}

export interface Room {
  dept: DeptId
  x: number
  y: number
  w: number
  h: number
  /** The two tiles of the door in the south wall. */
  door: [Tile, Tile]
  /** Row just inside the door; every aisle starts there. */
  entryY: number
}

export interface Desk {
  index: number
  /** Where the table is (blocked). */
  desk: Tile
  /** Where the employee sits (looking north at the desk). */
  chair: Tile
  /** Where one stands to talk to the person sitting there. */
  approach: Tile
}

export type PropKind = 'plant' | 'cabinet' | 'pm-desk' | 'meeting-table' | 'sofa' | 'cooler' | 'vending'

export interface Prop {
  kind: PropKind
  x: number
  y: number
  w: number
  h: number
}

export interface PmSpots {
  seat: Tile
  /** Where an employee stands to hand over a document. */
  receive: Tile
  projectBoard: Tile
  kanban: Tile
  statusScreen: Tile
  cabinet: Tile
  meetingSeats: Tile[]
  /** Wall panels, as [first x, last x] on the north wall. */
  panels: { project: [number, number]; kanban: [number, number]; status: [number, number] }
}

export interface Layout {
  w: number
  h: number
  rooms: Room[]
  props: Prop[]
  pm: PmSpots
  entrance: Tile
  /** The hall, as a rectangle. */
  hall: { x: number; y: number; w: number; h: number }
}

const rooms = (): Room[] => {
  const order: DeptId[] = ['gd', 'art', 'audio', 'pm', 'dev', 'qa', 'integration']
  const out: Room[] = []
  let x = 0
  for (const dept of order) {
    const w = dept === 'pm' ? PM_W : ROOM_W
    const mid = dept === 'pm' ? 6 : 4
    out.push({ dept, x, y: 0, w, h: ROOM_H, door: [{ x: x + mid, y: ROOM_H - 1 }, { x: x + mid + 1, y: ROOM_H - 1 }], entryY: ROOM_H - 2 })
    x += w - 1 // neighbouring rooms share their wall
  }
  return out
}

const build = (): Layout => {
  const rs = rooms()
  const last = rs[rs.length - 1]
  const w = last.x + last.w
  const pmRoom = rs.find((r) => r.dept === 'pm')!
  const at = (x: number, y: number): Tile => ({ x: pmRoom.x + x, y: pmRoom.y + y })

  const props: Prop[] = []
  const prop = (kind: PropKind, x: number, y: number, pw = 1, ph = 1): void => void props.push({ kind, x, y, w: pw, h: ph })

  for (const r of rs) {
    if (r.dept === 'pm') continue
    prop('plant', r.x + 1, r.entryY)
  }
  // the project manager's room
  for (const y of [2, 3, 4]) prop('cabinet', pmRoom.x + 1, y)
  prop('pm-desk', pmRoom.x + 6, 3, 2, 1)
  prop('meeting-table', pmRoom.x + 9, 5, 3, 2)
  prop('plant', pmRoom.x + 1, pmRoom.entryY)
  prop('plant', pmRoom.x + pmRoom.w - 2, pmRoom.entryY)
  prop('sofa', pmRoom.x + 11, 2, 1, 2)

  const seats: Tile[] = []
  for (let x = 9; x <= 11; x++) seats.push(at(x, 4), at(x, 7))
  seats.push(at(8, 5), at(8, 6), at(12, 5), at(12, 6))

  // the hall: a water cooler, a vending machine or a plant along the front of every room, never on the walking rows
  const hallKinds: PropKind[] = ['cooler', 'vending', 'plant', 'cooler', 'plant', 'vending', 'cooler']
  rs.forEach((r, i) => {
    prop(hallKinds[i], r.x + 2, HALL_Y + HALL_H - 1)
    if (i % 2 === 0) prop('plant', r.x + 7, HALL_Y + HALL_H - 1)
  })
  // plants in the hall corners
  prop('plant', w - 1, HALL_Y)
  prop('plant', 0, HALL_Y + HALL_H - 1)

  return {
    w,
    h: GRID_H,
    rooms: rs,
    props,
    pm: {
      seat: at(6, 4),
      receive: at(7, 4),
      projectBoard: at(3, 1),
      kanban: at(6, 1),
      statusScreen: at(10, 1),
      cabinet: at(2, 3),
      meetingSeats: seats,
      panels: { project: [pmRoom.x + 2, pmRoom.x + 4], kanban: [pmRoom.x + 5, pmRoom.x + 8], status: [pmRoom.x + 9, pmRoom.x + 11] }
    },
    entrance: { x: 0, y: HALL_Y + 2 },
    hall: { x: 0, y: HALL_Y, w, h: HALL_H }
  }
}

let cached: Layout | null = null
export const getLayout = (): Layout => (cached ??= build())

export const roomOf = (dept: DeptId): Room => getLayout().rooms.find((r) => r.dept === dept)!

/** Desk `index` of a staff room: 4 per row, rows counted from the door. */
export function deskOf(dept: DeptId, index: number): Desk {
  const room = roomOf(dept)
  const col = index % DESK_COLS
  const row = Math.floor(index / DESK_COLS)
  const x = room.x + 1 + 2 * col
  const chairY = room.entryY - 1 - 2 * row
  return { index, desk: { x, y: chairY - 1 }, chair: { x, y: chairY }, approach: { x: x + 1, y: chairY } }
}

/** Where a visitor stands inside the department, just past the door. */
export const visitSpot = (dept: DeptId): Tile => {
  const r = roomOf(dept)
  return { x: r.door[0].x, y: r.entryY }
}

/** Walkable tiles for a given number of desks in each room. Chairs and desks that exist are blocked (a chair can still be a goal). */
export function walkGrid(deskCounts: Partial<Record<DeptId, number>>): Uint8Array {
  const L = getLayout()
  const grid = new Uint8Array(L.w * L.h)
  const set = (x: number, y: number, v: 0 | 1): void => {
    if (x >= 0 && y >= 0 && x < L.w && y < L.h) grid[y * L.w + x] = v
  }
  for (const r of L.rooms) {
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) set(x, y, 1)
    for (const d of r.door) set(d.x, d.y, 1)
  }
  for (let y = L.hall.y; y < L.hall.y + L.hall.h; y++) for (let x = L.hall.x; x < L.hall.x + L.hall.w; x++) set(x, y, 1)
  for (const p of L.props) {
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) set(p.x + dx, p.y + dy, 0)
  }
  for (const r of L.rooms) {
    const n = Math.min(deskCounts[r.dept] ?? 0, DESK_COLS * DESK_ROWS)
    for (let i = 0; i < n; i++) {
      const d = deskOf(r.dept, i)
      set(d.desk.x, d.desk.y, 0)
      set(d.chair.x, d.chair.y, 0)
    }
  }
  for (const s of L.pm.meetingSeats) set(s.x, s.y, 0)
  set(L.pm.seat.x, L.pm.seat.y, 0)
  return grid
}

/** Shortest walk on the grid (4 directions). The start and the goal may be blocked tiles (a chair). Returns the tiles after `from`, or null. */
export function findPath(grid: Uint8Array, from: Tile, to: Tile, extraBlocked?: (x: number, y: number) => boolean): Tile[] | null {
  const L = getLayout()
  const W = L.w
  const H = L.h
  if (from.x === to.x && from.y === to.y) return []
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H
  const free = (x: number, y: number): boolean => (x === to.x && y === to.y) || (grid[y * W + x] === 1 && !(extraBlocked?.(x, y) ?? false))
  if (!inside(to.x, to.y) || !inside(from.x, from.y)) return null
  const prev = new Int32Array(W * H).fill(-1)
  const seen = new Uint8Array(W * H)
  const start = from.y * W + from.x
  seen[start] = 1
  const queue = [start]
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    const cx = cur % W
    const cy = (cur - cx) / W
    for (const [dx, dy] of dirs) {
      const nx = cx + dx
      const ny = cy + dy
      if (!inside(nx, ny)) continue
      const id = ny * W + nx
      if (seen[id] || !free(nx, ny)) continue
      seen[id] = 1
      prev[id] = cur
      if (nx === to.x && ny === to.y) {
        const path: Tile[] = []
        for (let at = id; at !== start; at = prev[at]) path.push({ x: at % W, y: Math.floor(at / W) })
        return path.reverse()
      }
      queue.push(id)
    }
  }
  return null
}
