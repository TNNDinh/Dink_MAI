import { describe, expect, it } from 'vitest'
import { DOORS, EFFECT_LOOK, GRID_H, GRID_W, REQUIRED_OBJECTS, ROOMS, STATE_LOOK, type EffectKind, type RoomId } from '../src/renderer/src/office/blueprint'
import { findPath, getLayout, walkGrid } from '../src/renderer/src/office/layout'
import { DEPARTMENTS } from '../src/renderer/src/office/departments'

const objects = (id: RoomId): Set<string> => {
  const room = ROOMS.find((r) => r.id === id)!
  return new Set([...room.features.map((f) => f.object), ...room.deskGear, ...room.wall])
}

describe('office blueprint', () => {
  it('is plain data: the same every time it is read', () => {
    expect(JSON.stringify(ROOMS)).toBe(JSON.stringify(ROOMS))
    expect(JSON.stringify(getLayout().props)).toBe(JSON.stringify(getLayout().props))
  })

  it('gives every room of the brief the objects the brief asks for', () => {
    for (const [id, wanted] of Object.entries(REQUIRED_OBJECTS) as Array<[RoomId, string[]]>) {
      const have = objects(id)
      for (const o of wanted) expect(have.has(o), `${id} is missing ${o}`).toBe(true)
    }
  })

  it('has a purpose for every room, rooms that fit the grid and never overlap', () => {
    for (const r of ROOMS) {
      expect(r.purpose.length, r.id).toBeGreaterThan(10)
      expect(r.x + r.w).toBeLessThanOrEqual(GRID_W)
      expect(r.y + r.h).toBeLessThanOrEqual(GRID_H)
    }
    const rooms = ROOMS.filter((r) => r.id !== 'hub')
    for (const a of rooms) {
      for (const b of rooms) {
        if (a === b) continue
        // neighbouring rooms share the row or column of wall between them
        const apart = a.x + a.w - 1 <= b.x || b.x + b.w - 1 <= a.x || a.y + a.h - 1 <= b.y || b.y + b.h - 1 <= a.y
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }
  })

  it('sizes a room by its importance: the hub and the PM are bigger than a department', () => {
    const area = (id: RoomId): number => {
      const r = ROOMS.find((q) => q.id === id)!
      return r.w * r.h
    }
    expect(area('hub')).toBeGreaterThan(area('pm'))
    expect(area('pm')).toBeGreaterThan(area('dev'))
  })

  it('uses a different floor for the rooms of one wing and different furniture in every department', () => {
    const wing = ['gd', 'art', 'audio'].map((id) => ROOMS.find((r) => r.id === id)!.floor)
    expect(new Set(wing).size).toBe(3)
    const east = ['qa', 'dev', 'integration'].map((id) => ROOMS.find((r) => r.id === id)!.floor)
    expect(new Set(east).size).toBe(3)
    const own = (id: RoomId): string[] => ROOMS.find((r) => r.id === id)!.features.filter((f) => f.kind !== 'plant').map((f) => f.object)
    for (const a of DEPARTMENTS) {
      for (const b of DEPARTMENTS) {
        if (a.id >= b.id) continue
        const shared = own(a.id).filter((o) => own(b.id).includes(o))
        expect(shared, `${a.id} and ${b.id} share furniture`).toEqual([])
      }
    }
  })

  it('follows the spatial rules: PM next to the hub, GD by ART, DEV by QA and INTEG, the hub open to every department', () => {
    const L = getLayout()
    const door = (a: RoomId, b: RoomId): boolean => DOORS.some((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a))
    for (const d of DEPARTMENTS) expect(door(d.id, 'hub'), `${d.id} has no door onto the hub`).toBe(true)
    expect(door('gd', 'art')).toBe(true)
    expect(door('art', 'audio')).toBe(true)
    expect(door('dev', 'qa')).toBe(true)
    expect(door('dev', 'integration')).toBe(true)
    // PM sits on the hub, GD and ART in the same wing
    const pm = L.rooms.find((r) => r.dept === 'pm')!
    expect(pm.y + pm.h).toBeLessThanOrEqual(L.hub.y + L.hub.h)
    expect(L.rooms.find((r) => r.dept === 'gd')!.x).toBe(L.rooms.find((r) => r.dept === 'art')!.x)
  })

  it('leaves no room isolated: every door tile and every room is reachable from the entrance', () => {
    const L = getLayout()
    const grid = walkGrid({})
    for (const d of L.doors) for (const t of d.tiles) expect(findPath(grid, L.entrance, t), `${d.id} at ${t.x},${t.y}`).not.toBeNull()
  })

  it('has a look for every agent state and every effect of the brief', () => {
    expect(Object.keys(STATE_LOOK).sort()).toEqual(['blocked', 'collaborating', 'completed', 'error', 'idle', 'thinking', 'waiting', 'working'])
    const effects: EffectKind[] = ['task-started', 'task-completed', 'agent-assigned', 'agent-moved', 'collaboration', 'build-started', 'build-completed', 'test-failed', 'bug-found', 'release-completed']
    expect(Object.keys(EFFECT_LOOK).sort()).toEqual([...effects].sort())
  })
})
