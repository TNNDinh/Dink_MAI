import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASE, accentRamp, type Look } from '../src/renderer/src/office/assets/palette'
import { CHARACTER_MAPS, OUTFIT_MAPS, personMap, type View } from '../src/renderer/src/office/assets/characters'
import { mapSize, unknownChars, type PixMap } from '../src/renderer/src/office/assets/pixmap'
import { FURNITURE_MAPS, chairBackMap, deskMap } from '../src/renderer/src/office/assets/furniture'
import { STUDIO_MAPS } from '../src/renderer/src/office/assets/studio'
import { FLOOR_PAL, floorPatch, type FloorKind } from '../src/renderer/src/office/assets/floors'
import { LOW_H, WALL_H, doorPost, lowElevation, northElevation, northTile, southTile, westTile } from '../src/renderer/src/office/assets/walls'
import { mergeLayers, type Layer } from '../src/renderer/src/office/assets/pixmap'
import { sheet, type SheetItem } from './helpers/sheet'

const FULL = { ...BASE, ...accentRamp('#5b9bf0'), s: '#eab68f', t: '#dc9f74', u: '#b97a55', H: '#6f4727', I: '#9a6a3e', J: '#46291a', S: '#8bbcff', T: '#5b9bf0', U: '#3c6db0', P: '#46557a', Q: '#2e3a58' }

const checkMaps = (maps: Record<string, PixMap>): void => {
  for (const [name, m] of Object.entries(maps)) {
    const w = mapSize(m).w
    expect(m.rows.every((r) => r.length === w), `${name}: rows have different widths`).toBe(true)
    expect(unknownChars(m, FULL), `${name}: characters missing in the palette`).toEqual([])
  }
}

const LOOKS: Look[] = [
  { skin: 0, hair: 0, style: 0, glasses: false, pants: 0, tone: 0 },
  { skin: 2, hair: 1, style: 1, glasses: true, pants: 1, tone: 1 },
  { skin: 4, hair: 7, style: 2, glasses: false, pants: 2, tone: 2 },
  { skin: 1, hair: 3, style: 3, glasses: true, pants: 3, tone: 0 },
  { skin: 3, hair: 5, style: 4, glasses: false, pants: 0, tone: 1 }
]

const out = process.env.OFFICE_SHEET_DIR

describe('office character sprites', () => {
  it('every character part is a clean pixel map', () => {
    checkMaps(CHARACTER_MAPS)
    checkMaps(OUTFIT_MAPS)
  })

  it('frames come out at one size and nothing is left outside the palette', () => {
    for (const view of ['F', 'B', 'E', 'FD', 'BD'] as View[]) {
      for (const pose of ['stand', 'walk', 'sit'] as const) {
        for (let frame = 0; frame < 4; frame++) {
          const { map, pal } = personMap(LOOKS[1], 'dev', '#5b9bf0', 'staff', { view, pose, frame })
          expect(mapSize(map)).toEqual({ w: 18, h: 32 })
          expect(unknownChars(map, pal)).toEqual([])
        }
      }
    }
  })

  it.skipIf(!out)('dumps a contact sheet of the people', () => {
    const items: SheetItem[] = []
    const depts: Array<[string, string, 'staff' | 'pm']> = [['dev', '#5b9bf0', 'staff'], ['art', '#ee8a4c', 'staff'], ['audio', '#3cc4b5', 'staff'], ['qa', '#e5675d', 'staff'], ['gd', '#a66be6', 'staff'], ['pm', '#e0b341', 'pm']]
    depts.forEach(([dept, color, role], k) => {
      const look = LOOKS[k % LOOKS.length]
      for (const view of ['F', 'B', 'E', 'FD', 'BD'] as View[]) {
        for (const [pose, frame] of [['stand', 0], ['walk', 1], ['walk', 3], ['sit', 0]] as const) {
          const { map, pal } = personMap(look, dept, color, role, { view, pose, frame })
          items.push({ name: `${dept}.${view}.${pose}${frame}`, map, pal })
        }
      }
    })
    mkdirSync(out!, { recursive: true })
    writeFileSync(join(out!, 'people.png'), sheet(items, { cols: 20, scale: 4 }))
  })
})

describe('office furniture sprites', () => {
  it('every piece is a clean pixel map', () => {
    for (const [name, m] of Object.entries(FURNITURE_MAPS)) {
      const w = mapSize(m).w
      expect(m.rows.every((r) => r.length === w), `${name}: rows have different widths`).toBe(true)
      expect(unknownChars(m, FULL), `${name}: characters missing in the palette`).toEqual([])
    }
  })

  it('draws a workstation for each of the four ways a person can look, each with its own pixels', () => {
    const depts = ['pm', 'gd', 'art', 'audio', 'dev', 'qa', 'integration'] as const
    for (const dept of depts) {
      const maps = (['N', 'S', 'E', 'W'] as const).map((f) => JSON.stringify(deskMap(dept, 'on', 0, f).rows))
      expect(new Set(maps).size, dept).toBe(4)
    }
    const backs = (['N', 'S', 'E', 'W'] as const).map((f) => JSON.stringify(chairBackMap(f).rows))
    expect(new Set(backs).size).toBe(4)
    // the facing of the default is north, as before
    expect(deskMap('dev', 'on', 0).rows).toEqual(deskMap('dev', 'on', 0, 'N').rows)
    // the same sprite size for every facing, so the anchor of one is the anchor of all
    for (const f of ['S', 'E', 'W'] as const) expect(mapSize(deskMap('qa', 'on', 0, f))).toEqual(mapSize(deskMap('qa', 'on', 0, 'N')))
  })

  it('seen from the side, a seated person reaches forward to the keyboard; from the front or the back the forearms stay short', () => {
    const side = personMap(LOOKS[1], 'dev', '#5b9bf0', 'staff', { view: 'E', pose: 'sit', frame: 0 })
    const standing = personMap(LOOKS[1], 'dev', '#5b9bf0', 'staff', { view: 'E', pose: 'stand', frame: 0 })
    expect(JSON.stringify(side.map.rows)).not.toEqual(JSON.stringify(standing.map.rows))
    expect(CHARACTER_MAPS.arm_e_sit).toBeDefined()
    // the forearm is wider than the hanging arm: it points to the desk
    expect(mapSize(CHARACTER_MAPS.arm_e_sit).w).toBeGreaterThan(mapSize(CHARACTER_MAPS.arm_e).w)
  })

  it('every studio piece (racks, console, booth, speakers, easel, bench, storage, round table) is a clean pixel map', () => {
    expect(Object.keys(STUDIO_MAPS).sort()).toEqual(['booth', 'console', 'easel', 'rack', 'rack.b', 'round-table', 'speaker', 'storage', 'testbench'])
    for (const [name, m] of Object.entries(STUDIO_MAPS)) {
      const w = mapSize(m).w
      expect(m.rows.every((r) => r.length === w), `${name}: rows have different widths`).toBe(true)
      expect(unknownChars(m, FULL), `${name}: characters missing in the palette`).toEqual([])
    }
  })

  it.skipIf(!out)('dumps a contact sheet of the furniture', () => {
    const accents: Record<string, string> = { pm: '#e0b341', gd: '#a66be6', art: '#ee8a4c', audio: '#3cc4b5', dev: '#5b9bf0', qa: '#e5675d', integration: '#9aa4b2' }
    const items: SheetItem[] = Object.entries({ ...FURNITURE_MAPS, ...STUDIO_MAPS }).map(([name, map]) => {
      const dept = name.split('.')[1]
      return { name, map, pal: { ...FULL, ...accentRamp(accents[dept] ?? '#5b9bf0') } }
    })
    mkdirSync(out!, { recursive: true })
    writeFileSync(join(out!, 'furniture.png'), sheet(items.filter((i) => !i.name.endsWith('.idle') && !i.name.endsWith('.err') && !i.name.endsWith('.off')), { cols: 6, scale: 3 }))
  })
})

describe('office floors', () => {
  it.skipIf(!out)('dumps a contact sheet of the floors', () => {
    const kinds = Object.keys(FLOOR_PAL) as FloorKind[]
    const items: SheetItem[] = kinds.map((k) => {
      const { map, pal } = floorPatch(k, 6, k === 'carpet' || k === 'stone' ? { x0: 1, y0: 1, x1: 4, y1: 3 } : undefined)
      return { name: `floor.${k}`, map, pal }
    })
    mkdirSync(out!, { recursive: true })
    writeFileSync(join(out!, 'floors.png'), sheet(items, { cols: 3, scale: 2 }))
  })
})

describe('office walls', () => {
  const rooms: Array<[string, number]> = [['gd', 10], ['art', 10], ['audio', 10], ['pm', 14], ['dev', 10], ['qa', 10], ['integration', 10]]

  it('every wall tile is a clean pixel map', () => {
    for (const [dept, n] of rooms) {
      const d = dept as 'gd'
      const e = northElevation(d, n)
      const t = northTile(d, 3, e)
      expect(unknownChars(t.map, t.pal)).toEqual([])
      const l = lowElevation(d, n)
      for (const s of [southTile(d, 2, l), westTile(d, 2, l), doorPost(d, 'L'), doorPost(d, 'R')]) expect(unknownChars(s.map, s.pal)).toEqual([])
    }
  })

  it.skipIf(!out)('dumps room previews', () => {
    const items: SheetItem[] = []
    for (const [dept, n] of rooms) {
      const d = dept as 'gd'
      const ne = northElevation(d, n)
      const le = lowElevation(d, n)
      const W = (n + 11) * 16 + 80
      const H = (n + 11) * 8 + WALL_H + 70
      const ox = 11 * 16 + 40
      const oy = WALL_H + 10
      const layers: Layer[] = []
      const add = (t: { map: PixMap; pal: Record<string, string> }, tx: number, ty: number): void => {
        layers.push({ map: t.map, pal: t.pal, x: (tx - ty) * 16 + ox - t.map.ox, y: (tx + ty) * 8 + oy - t.map.oy })
      }
      for (let x = 0; x < n; x++) add(northTile(d, x, ne), x, 0)
      for (let y = 1; y <= 9; y++) add(westTile(d, 9 - y, le), 0, y)
      for (let x = 0; x < n; x++) if (x !== 4 && x !== 5) add(southTile(d, x, le), x, 10)
      add(doorPost(d, 'L'), 4, 10)
      add(doorPost(d, 'R'), 5, 10)
      const { map, pal } = mergeLayers(W, H, 0, 0, layers)
      items.push({ name: `room.${dept}`, map, pal })
    }
    mkdirSync(out!, { recursive: true })
    writeFileSync(join(out!, 'walls.png'), sheet(items, { cols: 2, scale: 2 }))
    void LOW_H
  })
})
