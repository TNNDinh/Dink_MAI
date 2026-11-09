import { describe, expect, it } from 'vitest'
import { DEPARTMENTS } from '../src/renderer/src/office/departments'
import { DESK_COLS, DESK_ROWS, deskOf, findPath, getLayout, roomOf, visitSpot, walkGrid } from '../src/renderer/src/office/layout'
import { MAX_STAFF } from '../src/renderer/src/office/model'

const STAFF = DEPARTMENTS.filter((d) => d.id !== 'pm')
const full = Object.fromEntries(STAFF.map((d) => [d.id, MAX_STAFF]))
const key = (t: { x: number; y: number }) => `${t.x},${t.y}`

describe('office floor plan', () => {
  it('has a room for each of the 7 departments, the PM in the middle', () => {
    const L = getLayout()
    expect(L.rooms.map((r) => r.dept)).toEqual(['gd', 'art', 'audio', 'pm', 'dev', 'qa', 'integration'])
    expect(MAX_STAFF).toBe(DESK_COLS * DESK_ROWS)
  })

  it('puts every desk and chair inside its own room without overlapping anything', () => {
    const L = getLayout()
    const used = new Map<string, string>()
    const take = (t: { x: number; y: number }, what: string): void => {
      expect(used.get(key(t)), `${what} at ${key(t)} overlaps ${used.get(key(t))}`).toBeUndefined()
      used.set(key(t), what)
    }
    for (const p of L.props) for (let dx = 0; dx < p.w; dx++) for (let dy = 0; dy < p.h; dy++) take({ x: p.x + dx, y: p.y + dy }, p.kind)
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

  it('keeps a desk where it is when more desks are added', () => {
    expect(deskOf('dev', 0)).toEqual(deskOf('dev', 0))
    const first = deskOf('dev', 3)
    expect(first.chair.y).toBe(deskOf('dev', 0).chair.y)
    expect(deskOf('dev', 4).chair.y).toBeLessThan(first.chair.y)
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

  it('reaches the project manager desk, the boards, the cabinets and the meeting table, and walks back', () => {
    const L = getLayout()
    const grid = walkGrid(full)
    const spots = [L.pm.seat, L.pm.receive, L.pm.projectBoard, L.pm.kanban, L.pm.statusScreen, L.pm.cabinet, ...L.pm.meetingSeats, visitSpot('dev'), visitSpot('gd')]
    for (const s of spots) {
      expect(findPath(grid, L.entrance, s), key(s)).not.toBeNull()
      expect(findPath(grid, s, L.entrance), key(s)).not.toBeNull()
    }
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

  it('finds no path through a blocked tile and treats an occupied tile as a wall when asked', () => {
    const L = getLayout()
    const grid = walkGrid({})
    const door = roomOf('qa').door
    const hall = { x: door[0].x, y: L.hall.y }
    expect(findPath(grid, hall, door[0])!.length).toBe(1)
    expect(findPath(grid, L.entrance, visitSpot('qa'), (x, y) => door.some((d) => d.x === x && d.y === y))).toBeNull()
  })
})
