import type { DeptId } from './departments'
import type { FloorKind } from './assets/floors'
import { DESK_COLS, DESK_ROWS, DESK_SLOTS, DIR_VEC, DOORS, ENTRANCE, GRID_H, GRID_W, HUB_TABLE_CENTRE, OPPOSITE, PM_W, ROOMS, ROOM_H, ROOM_W, type Dir, type FeatureKind, type RoomId, type RoomSpec } from './blueprint'

/**
 * The floor plan, built from `blueprint.ts`: rooms, walls, doors, furniture and the walking grid. Seen from the south-east
 * in isometric view: tile (x, y) is drawn at ((x − y)·TW/2, (x + y)·TH/2), so x grows to the right-and-down and y to
 * the left-and-down.
 *
 * Every staff room has 16 workstations (`DESK_SLOTS` in the blueprint). A workstation is a chair and the desk in front of it;
 * the way the person looks is the way from the chair to the desk, and it is the same number for the sprite of the desk, the
 * sprite of the chair and the sprite of the person (`Desk.facing`, `seatFacing`). Slots are filled in a fixed order, so a desk
 * never moves when another one is added. In the east wing everything is mirrored, so the feature strip of each room faces the hub.
 */

export { DESK_COLS, DESK_ROWS, GRID_H, GRID_W, PM_W, ROOM_H, ROOM_W }
export type { Dir }

export interface Tile {
  x: number
  y: number
}

export interface Door {
  id: string
  orient: 'h' | 'v'
  /** The wall tiles the door opens (2). */
  tiles: [Tile, Tile]
  a: RoomId
  b: RoomId
}

export interface Room {
  dept: DeptId
  x: number
  y: number
  w: number
  h: number
  mirror: boolean
  floor: FloorKind
  /** The two wall tiles of the door onto the hub. */
  door: [Tile, Tile]
  /** The aisle row along the south side of the room (every desk aisle starts there). */
  entryY: number
  /** Every door of the room, onto the hub and onto its neighbours. */
  doors: Door[]
}

export interface Desk {
  index: number
  /** Where the table is (blocked). */
  desk: Tile
  /** Where the employee sits (looking at the desk). */
  chair: Tile
  /** The way the person in the chair looks: from the chair to the desk, so toward the keyboard and the screen. */
  facing: Dir
  /** Where one stands to talk to the person sitting there. */
  approach: Tile
}

export type PropKind = FeatureKind

export interface Prop {
  kind: PropKind
  /** The name the studio brief gives it. */
  object: string
  /** Which drawing a board or a screen shows. */
  content?: string
  room: RoomId
  x: number
  y: number
  w: number
  h: number
  /** A workstation's chair, on the side of the desk away from where the person looks. */
  chair?: Tile
  /** The way the person at the workstation looks (toward the desk). */
  face?: Dir
}

export interface PmSpots {
  seat: Tile
  /** Where an employee stands to hand over a document. */
  receive: Tile
  projectBoard: Tile
  kanban: Tile
  statusScreen: Tile
  cabinet: Tile
  /** The stools around the PM's own meeting table. */
  meetingSeats: Tile[]
  /** Wall panels, as [first x, last x] on the north wall. */
  panels: { project: [number, number]; kanban: [number, number]; status: [number, number] }
}

export interface HubSpots {
  x: number
  y: number
  w: number
  h: number
  /** Seats at the big table, the ones nearest the middle first. */
  tableSeats: Tile[]
  /** Every seat of the hub (the big table and the discussion tables). */
  seats: Tile[]
  /** The middle of the big table (tile-centre coordinates). */
  centre: { x: number; y: number }
  table: { x: number; y: number; w: number; h: number }
}

export interface Layout {
  w: number
  h: number
  /** Every department room (the hub is `hub`). */
  rooms: Room[]
  hub: HubSpots
  props: Prop[]
  pm: PmSpots
  entrance: Tile
  doors: Door[]
}

const spec = (id: RoomId): RoomSpec => ROOMS.find((r) => r.id === id)!

/** The tile of the chair of a desk whose person looks toward `face`: on the opposite side of the desk (south of it for N). */
function chairBeside(d: { x: number; y: number; w: number; h: number }, face: Dir): Tile {
  switch (face) {
    case 'N':
      return { x: d.x, y: d.y + d.h }
    case 'S':
      return { x: d.x, y: d.y - 1 }
    case 'E':
      return { x: d.x - 1, y: d.y }
    case 'W':
      return { x: d.x + d.w, y: d.y }
  }
}

const build = (): Layout => {
  const hubSpec = spec('hub')
  const doors: Door[] = DOORS.map((d) => ({
    id: d.id,
    orient: d.orient,
    tiles: d.orient === 'h' ? [{ x: d.x, y: d.y }, { x: d.x + 1, y: d.y }] : [{ x: d.x, y: d.y }, { x: d.x, y: d.y + 1 }],
    a: d.a,
    b: d.b
  }))

  const rooms: Room[] = ROOMS.filter((r) => r.id !== 'hub').map((r) => {
    const own = doors.filter((d) => d.a === r.id || d.b === r.id)
    const toHub = own.find((d) => d.a === r.id && d.b === 'hub')!
    return {
      dept: r.id as DeptId,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      mirror: r.mirror,
      floor: r.floor,
      door: toHub.tiles,
      entryY: r.y + r.h - 2,
      doors: own
    }
  })

  // furniture: the features of every room, in grid coordinates
  const props: Prop[] = []
  for (const r of ROOMS) {
    for (const ft of r.features) {
      const lx = r.mirror ? r.w - 1 - (ft.x + ft.w - 1) : ft.x
      const x = r.x + lx
      const y = r.y + ft.y
      // a mirrored room turns east into west
      const face: Dir | undefined = ft.chair ? (r.mirror && (ft.face === 'E' || ft.face === 'W') ? OPPOSITE[ft.face] : ft.face ?? 'N') : undefined
      const chair = face ? chairBeside({ x, y, w: ft.w, h: ft.h }, face) : undefined
      props.push({ kind: ft.kind, object: ft.object, content: ft.content, room: r.id, x, y, w: ft.w, h: ft.h, chair, face })
    }
  }

  const pmRoom = rooms.find((r) => r.dept === 'pm')!
  const at = (x: number, y: number): Tile => ({ x: pmRoom.x + x, y: pmRoom.y + y })
  const seats: Tile[] = []
  for (let x = 9; x <= 11; x++) seats.push(at(x, 4), at(x, 7))
  seats.push(at(8, 5), at(8, 6), at(12, 5), at(12, 6))

  const bigTable = props.filter((p) => p.room === 'hub' && p.object === 'central-meeting-table')
  const table = {
    x: Math.min(...bigTable.map((p) => p.x)),
    y: Math.min(...bigTable.map((p) => p.y)),
    w: Math.max(...bigTable.map((p) => p.x + p.w)) - Math.min(...bigTable.map((p) => p.x)),
    h: Math.max(...bigTable.map((p) => p.y + p.h)) - Math.min(...bigTable.map((p) => p.y))
  }
  const hubSeats = props.filter((p) => p.room === 'hub' && p.kind === 'stool').map((p) => ({ x: p.x, y: p.y }))
  const nearTable = (s: Tile): boolean => s.x >= table.x - 1 && s.x <= table.x + table.w && s.y >= table.y - 1 && s.y <= table.y + table.h
  const tableSeats = hubSeats.filter(nearTable)

  return {
    w: GRID_W,
    h: GRID_H,
    rooms,
    hub: { x: hubSpec.x, y: hubSpec.y, w: hubSpec.w, h: hubSpec.h, tableSeats, seats: hubSeats, centre: HUB_TABLE_CENTRE, table },
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
    entrance: { ...ENTRANCE },
    doors
  }
}

let cached: Layout | null = null
export const getLayout = (): Layout => (cached ??= build())

export const roomOf = (dept: DeptId): Room => getLayout().rooms.find((r) => r.dept === dept)!

/** The room (or the hub) a tile belongs to. A wall tile shared by two rooms belongs to the department, not the hub. */
export function roomAt(x: number, y: number): RoomId | null {
  for (const r of ROOMS) {
    if (r.id === 'hub') continue
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.id
  }
  const h = spec('hub')
  return x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h ? 'hub' : null
}

/** Is the tile inside the room (not on its walls)? The hub's interior leaves out the PM room. */
function inside(r: RoomSpec, x: number, y: number): boolean {
  return x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1
}

/** A tile you can stand on without regard to furniture: the inside of a room, the hub, or an open door. */
export function isFloor(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false
  if (getLayout().doors.some((d) => d.tiles.some((t) => t.x === x && t.y === y))) return true
  return ROOMS.some((r) => inside(r, x, y)) && !(roomAt(x, y) === 'pm' && !inside(spec('pm'), x, y))
}

/** Is there a wall on the tile (a room's outline, except where a door opens)? */
export function isWall(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false
  if (getLayout().doors.some((d) => d.tiles.some((t) => t.x === x && t.y === y))) return false
  return ROOMS.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && !inside(r, x, y))
}

/** The door whose opening contains the tile, if any. */
export const doorAt = (x: number, y: number): Door | undefined => getLayout().doors.find((d) => d.tiles.some((t) => t.x === x && t.y === y))

/** Workstation `index` of a staff room: its chair, its desk (in front of the chair), the way the person looks and where one stands to talk to them. */
export function deskOf(dept: DeptId, index: number): Desk {
  const room = roomOf(dept)
  const slot = DESK_SLOTS[index % DESK_SLOTS.length]
  const gx = (lx: number): number => (room.mirror ? room.x + room.w - 1 - lx : room.x + lx)
  const facing: Dir = room.mirror && (slot.face === 'E' || slot.face === 'W') ? OPPOSITE[slot.face] : slot.face
  const chair = { x: gx(slot.x), y: room.y + slot.y }
  const v = DIR_VEC[facing]
  return { index, desk: { x: chair.x + v.x, y: chair.y + v.y }, chair, facing, approach: { x: gx(slot.approach.x), y: room.y + slot.approach.y } }
}

/** The way a person looks when sitting on a chair (a workstation's, a department desk's or the PM's), or undefined when the tile is not one. */
export function seatFacing(tile: Tile): Dir | undefined {
  return seats().get(`${tile.x},${tile.y}`)
}

let seatCache: Map<string, Dir> | null = null
function seats(): Map<string, Dir> {
  if (seatCache) return seatCache
  const L = getLayout()
  const m = new Map<string, Dir>()
  for (const r of L.rooms) {
    for (let i = 0; i < DESK_SLOTS.length; i++) {
      const d = deskOf(r.dept, i)
      m.set(`${d.chair.x},${d.chair.y}`, d.facing)
    }
  }
  for (const p of L.props) if (p.chair && p.face) m.set(`${p.chair.x},${p.chair.y}`, p.face)
  m.set(`${L.pm.seat.x},${L.pm.seat.y}`, 'N')
  seatCache = m
  return m
}

/** Where a visitor stands inside the department, just past its door onto the hub. */
export const visitSpot = (dept: DeptId): Tile => {
  const r = roomOf(dept)
  const [a, b] = r.door
  // the door's second tile, one step into the room
  if (a.y === b.y) return { x: a.x, y: b.y - 1 }
  return { x: r.mirror ? b.x + 1 : b.x - 1, y: b.y }
}

/** Where someone waits in the hub in front of a department's door. */
export const hubSpot = (dept: DeptId): Tile => {
  const r = roomOf(dept)
  const [a, b] = r.door
  if (a.y === b.y) return { x: a.x, y: b.y + 1 }
  return { x: r.mirror ? b.x - 1 : b.x + 1, y: b.y }
}

/** Walkable tiles for a given number of desks in each room. Chairs and desks that exist are blocked (a chair can still be a goal). */
export function walkGrid(deskCounts: Partial<Record<DeptId, number>>): Uint8Array {
  const L = getLayout()
  const grid = new Uint8Array(L.w * L.h)
  const set = (x: number, y: number, v: 0 | 1): void => {
    if (x >= 0 && y >= 0 && x < L.w && y < L.h) grid[y * L.w + x] = v
  }
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (isFloor(x, y)) set(x, y, 1)
  for (const p of L.props) {
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) set(p.x + dx, p.y + dy, 0)
    if (p.chair) set(p.chair.x, p.chair.y, 0)
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
  const within = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H
  const free = (x: number, y: number): boolean => (x === to.x && y === to.y) || (grid[y * W + x] === 1 && !(extraBlocked?.(x, y) ?? false))
  if (!within(to.x, to.y) || !within(from.x, from.y)) return null
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
      if (!within(nx, ny)) continue
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
