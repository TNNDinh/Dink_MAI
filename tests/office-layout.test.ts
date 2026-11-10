import { describe, expect, it } from 'vitest'
import { DEPARTMENTS } from '../src/renderer/src/office/departments'
import { DIR_VEC, OPPOSITE } from '../src/renderer/src/office/blueprint'
import { DESK_COLS, DESK_ROWS, deskOf, doorAt, findPath, getLayout, hubSpot, isFloor, isWall, roomOf, seatFacing, visitSpot, walkGrid } from '../src/renderer/src/office/layout'
import { MAX_STAFF } from '../src/renderer/src/office/model'

const STAFF = DEPARTMENTS.filter((d) => d.id !== 'pm')
const full = Object.fromEntries(STAFF.map((d) => [d.id, MAX_STAFF]))
const key = (t: { x: number; y: number }) => `${t.x},${t.y}`

describe('office floor plan', () => {
  it('has a room for each of the 7 departments and the hub, the same every time', () => {
    const L = getLayout()
    expect(L.rooms.map((r) => r.dept).sort()).toEqual(['art', 'audio', 'dev', 'gd', 'integration', 'pm', 'qa'])
    expect(MAX_STAFF).toBe(DESK_COLS * DESK_ROWS)
    expect(L.hub.w).toBeGreaterThan(10)
  })

  it('puts every desk and chair inside its own room without overlapping anything', () => {
    const L = getLayout()
    const used = new Map<string, string>()
    const take = (t: { x: number; y: number }, what: string): void => {
      expect(used.get(key(t)), `${what} at ${key(t)} overlaps ${used.get(key(t))}`).toBeUndefined()
      used.set(key(t), what)
    }
    for (const p of L.props) {
      for (let dx = 0; dx < p.w; dx++) for (let dy = 0; dy < p.h; dy++) take({ x: p.x + dx, y: p.y + dy }, `${p.room}:${p.object}`)
      if (p.chair) take(p.chair, `${p.room}:${p.object} chair`)
    }
    for (const s of L.pm.meetingSeats) take(s, 'pm stool')
    take(L.pm.seat, 'pm seat')
    for (const d of STAFF) {
      const r = roomOf(d.id)
      for (let i = 0; i < MAX_STAFF; i++) {
        const desk = deskOf(d.id, i)
        for (const t of [desk.desk, desk.chair]) {
          expect(t.x).toBeGreaterThan(r.x)
          expect(t.x).toBeLessThan(r.x + r.w - 1)
          expect(t.y).toBeGreaterThan(r.y)
          expect(t.y).toBeLessThan(r.entryY)
        }
        take(desk.desk, `${d.id} desk ${i}`)
        take(desk.chair, `${d.id} chair ${i}`)
      }
    }
  })

  it('keeps a desk where it is when more desks are added, and gives every desk its own place', () => {
    expect(deskOf('dev', 0)).toEqual(deskOf('dev', 0))
    for (const d of STAFF) {
      const chairs = new Set(Array.from({ length: MAX_STAFF }, (_, i) => key(deskOf(d.id, i).chair)))
      expect(chairs.size, d.id).toBe(MAX_STAFF)
    }
  })

  it('turns every workstation by its own layout: the person looks from the chair at the desk, never one fixed way', () => {
    for (const d of STAFF) {
      const seen = new Set<string>()
      for (let i = 0; i < MAX_STAFF; i++) {
        const w = deskOf(d.id, i)
        const v = DIR_VEC[w.facing]
        expect({ x: w.chair.x + v.x, y: w.chair.y + v.y }, `${d.id} ${i}: the desk is in front of the chair`).toEqual(w.desk)
        // the approach is a tile next to the chair, on a side that is neither the desk nor the one behind another desk
        expect(Math.abs(w.approach.x - w.chair.x) + Math.abs(w.approach.y - w.chair.y), `${d.id} ${i}`).toBe(1)
        expect(seatFacing(w.chair), `${d.id} ${i}`).toBe(w.facing)
        if (i < 4) seen.add(w.facing)
      }
      // the first four workstations of every room already look four different ways
      expect(seen.size, d.id).toBe(4)
    }
    // every direction is used, and the people of one pod look at each other
    const all = new Set(Array.from({ length: MAX_STAFF }, (_, i) => deskOf('dev', i).facing))
    expect([...all].sort()).toEqual(['E', 'N', 'S', 'W'])
    const a = deskOf('dev', 0)
    const b = deskOf('dev', 1)
    expect(OPPOSITE[a.facing]).toBe(b.facing)
    expect(Math.abs(a.chair.y - b.chair.y)).toBe(3)
  })

  it('turns the east wing with its plan: what looks east in the west wing looks west there', () => {
    for (let i = 0; i < MAX_STAFF; i++) {
      const w = deskOf('art', i)
      const e = deskOf('dev', i)
      expect(e.facing).toBe(w.facing === 'E' ? 'W' : w.facing === 'W' ? 'E' : w.facing)
      // the same slot, seen in the mirror: the same row, the other side of the room
      expect(e.chair.y - roomOf('dev').y).toBe(w.chair.y - roomOf('art').y)
      expect(e.chair.x - roomOf('dev').x).toBe(roomOf('art').w - 1 - (w.chair.x - roomOf('art').x))
    }
  })

  it('gives the workstations of the offices and the hub a facing too, with the chair opposite the way they look', () => {
    const L = getLayout()
    const ws = L.props.filter((p) => p.chair)
    expect(ws.length).toBeGreaterThanOrEqual(8)
    for (const p of ws) {
      expect(p.face, p.object).toBeDefined()
      const v = DIR_VEC[p.face!]
      expect({ x: p.chair!.x + v.x, y: p.chair!.y + v.y }, `${p.object} at ${p.x},${p.y}`).toEqual({ x: p.x, y: p.y })
      expect(seatFacing(p.chair!)).toBe(p.face)
    }
    // the common workstations of the hub do not all look the same way
    const hub = ws.filter((p) => p.object === 'common-workstation').map((p) => p.face)
    expect(new Set(hub).size).toBeGreaterThanOrEqual(3)
    expect(seatFacing(L.pm.seat)).toBe('N')
    expect(seatFacing({ x: 0, y: 0 })).toBeUndefined()
  })

  it('mirrors the east wing so the aisle of every desk is on the side of the hub', () => {
    for (const id of ['qa', 'dev', 'integration'] as const) {
      expect(roomOf(id).mirror).toBe(true)
      const d = deskOf(id, 0)
      expect(d.approach.x).toBe(d.chair.x - 1)
    }
    for (const id of ['gd', 'art', 'audio'] as const) expect(deskOf(id, 0).approach.x).toBe(deskOf(id, 0).chair.x + 1)
  })

  it('lets everyone walk from the entrance to every chair, even when every room is full', () => {
    const L = getLayout()
    const grid = walkGrid(full)
    for (const d of STAFF) {
      for (let i = 0; i < MAX_STAFF; i++) {
        const path = findPath(grid, L.entrance, deskOf(d.id, i).chair)
        expect(path, `${d.id} desk ${i}`).not.toBeNull()
        // the last step before the chair is an open aisle tile, never another desk or chair
        const chair = deskOf(d.id, i).chair
        const before = path!.length > 1 ? path![path!.length - 2] : L.entrance
        expect(Math.abs(before.x - chair.x) + Math.abs(before.y - chair.y)).toBe(1)
        expect(grid[before.y * L.w + before.x]).toBe(1)
      }
    }
  })

  it('reaches the project manager desk, the boards, the cabinets, the hub table and the workstations, and walks back', () => {
    const L = getLayout()
    const grid = walkGrid(full)
    const spots = [L.pm.seat, L.pm.receive, L.pm.projectBoard, L.pm.kanban, L.pm.statusScreen, L.pm.cabinet, ...L.pm.meetingSeats, ...L.hub.seats, ...L.props.filter((p) => p.chair).map((p) => p.chair!)]
    for (const d of STAFF) spots.push(visitSpot(d.id), hubSpot(d.id))
    for (const s of spots) {
      expect(findPath(grid, L.entrance, s), key(s)).not.toBeNull()
      expect(findPath(grid, s, L.entrance), key(s)).not.toBeNull()
    }
  })

  it('opens every department onto the hub and onto its neighbours, with no room left out', () => {
    const L = getLayout()
    const grid = walkGrid(full)
    for (const r of L.rooms) {
      expect(doorAt(r.door[0].x, r.door[0].y), r.dept).toBeDefined()
      expect(isFloor(r.door[0].x, r.door[0].y)).toBe(true)
      expect(isWall(r.door[0].x, r.door[0].y)).toBe(false)
      // from the hub's side of the door to the room's side
      expect(findPath(grid, hubSpot(r.dept), visitSpot(r.dept))!.length).toBeLessThanOrEqual(4)
    }
    // neighbours reach each other without going through the hub
    const direct = (a: 'gd' | 'art' | 'audio' | 'qa' | 'dev' | 'integration', b: typeof a): boolean => {
      const shared = getLayout().doors.find((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a))
      return !!shared
    }
    expect(direct('gd', 'art')).toBe(true)
    expect(direct('art', 'audio')).toBe(true)
    expect(direct('qa', 'dev')).toBe(true)
    expect(direct('dev', 'integration')).toBe(true)
    expect(direct('qa', 'integration')).toBe(false)
    const blockedHub = (x: number, y: number): boolean => L.hub.x < x && x < L.hub.x + L.hub.w - 1 && !roomOfTile(x, y)
    expect(findPath(grid, visitSpot('qa'), visitSpot('dev'), blockedHub)).not.toBeNull()
    expect(findPath(grid, visitSpot('art'), visitSpot('gd'), blockedHub)).not.toBeNull()
  })

  it('does not walk through a desk that exists, but walks over the floor where a desk is not (yet) placed', () => {
    const none = walkGrid({})
    const one = walkGrid({ dev: 1 })
    const d = deskOf('dev', 0)
    const W = getLayout().w
    expect(none[d.desk.y * W + d.desk.x]).toBe(1)
    expect(one[d.desk.y * W + d.desk.x]).toBe(0)
    expect(one[d.chair.y * W + d.chair.x]).toBe(0)
  })

  it('finds no path through a closed wall and treats an occupied tile as a wall when asked', () => {
    const L = getLayout()
    const grid = walkGrid({})
    const door = roomOf('qa').door
    expect(findPath(grid, hubSpot('qa'), visitSpot('qa'))!.length).toBe(2)
    const shut = [...door, ...roomOf('qa').doors.flatMap((d) => d.tiles)]
    expect(findPath(grid, L.entrance, visitSpot('qa'), (x, y) => shut.some((d) => d.x === x && d.y === y))).toBeNull()
    // with only the door onto the hub shut, QA is still reachable through its neighbour DEV
    expect(findPath(grid, L.entrance, visitSpot('qa'), (x, y) => door.some((d) => d.x === x && d.y === y))).not.toBeNull()
    // the walls between two rooms stay closed outside their doors
    expect(isWall(11, 5)).toBe(true)
    expect(isWall(5, 10)).toBe(true)
    expect(isWall(20, 10)).toBe(false)
  })
})

/** A tile that is part of a department room (not the hub's open floor). */
function roomOfTile(x: number, y: number): boolean {
  const L = getLayout()
  return L.rooms.some((r) => x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1)
}
