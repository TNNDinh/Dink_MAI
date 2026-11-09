import { DEPT, type DeptId } from './departments'
import { GRID_H, HALL_Y, ROOM_H, getLayout, type Room } from './layout'
import { FLOOR_PAL, floorTile, rugPalette, rugTile, type FloorKind, type RugRect } from './assets/floors'
import { stamp, bake } from './assets/pixmap'
import { THEME, doorPost, lowElevation, northElevation, northTile, southTile, westTile, type TileSprite } from './assets/walls'
import { glow, sunPatch, wallShadow } from './lighting'
import { poly, type G, type Pt, type Sprite } from './pixels'
import { chairBack, chairSeat, furniture, PM_CHAIR } from './sprites'
import { SLAB, toWorld, worldInfo } from './world'
import type { Elev } from './assets/elev'

/** The part of the office that never changes: the floor (one canvas, painted once) and the walls and furniture (sprites). */

export interface Item {
  /** Depth: the sum x + y of the front-most tile it stands on, plus how far in front of it. Items are drawn in this order. */
  d: number
  /** Order among items of the same depth. */
  o: number
  fn: (g: G) => void
}

const FLOOR_OF: Record<DeptId, FloorKind> = { pm: 'parquet', gd: 'planks', art: 'birch', audio: 'acoustic', dev: 'carpet', qa: 'lino', integration: 'steel' }

/** The room a tile column belongs to (the wall column between two rooms belongs to the room on its east). */
export const ownerOf = (x: number): Room => {
  const L = getLayout()
  return L.rooms.find((r) => x >= r.x && x < r.x + r.w - 1) ?? L.rooms[L.rooms.length - 1]
}

// ── floor ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Rug {
  rect: RugRect
  color: string
}

function rugs(): Rug[] {
  const L = getLayout()
  const out: Rug[] = []
  // a runner in the colour of the department along its entrance, a coir mat in the doorway
  for (const r of L.rooms) {
    const [a, b] = r.door
    if (r.dept !== 'pm') out.push({ rect: { x0: r.x + 2, y0: r.entryY, x1: r.x + r.w - 3, y1: r.entryY }, color: DEPT[r.dept].color })
    out.push({ rect: { x0: a.x, y0: r.entryY, x1: b.x, y1: a.y }, color: '#7d5c3e' })
  }
  const pm = L.rooms.find((r) => r.dept === 'pm')!
  out.push({ rect: { x0: pm.x + 5, y0: 3, x1: pm.x + 8, y1: 5 }, color: '#8c3f4f' })
  out.push({ rect: { x0: pm.x + 8, y0: 4, x1: pm.x + 12, y1: 7 }, color: '#2f6f8f' })
  // a long runner down the hall and a mat at the entrance
  out.push({ rect: { x0: 0, y0: HALL_Y + 1, x1: L.w - 1, y1: HALL_Y + 2 }, color: '#8c3f4f' })
  return out
}

function backdrop(g: G, w: number, h: number): void {
  const bands = ['#222a44', '#1f2640', '#1c233b', '#191f35', '#161b2e', '#131728']
  const bh = Math.ceil(h / bands.length)
  bands.forEach((c, i) => {
    g.fillStyle = c
    g.fillRect(0, i * bh, w, bh)
  })
  // dithered seams between the bands and a few faint specks
  for (let i = 1; i < bands.length; i++) {
    g.fillStyle = bands[i]
    for (let x = 0; x < w; x += 2) g.fillRect(x, i * bh - 2, 1, 1)
    g.fillStyle = bands[i - 1]
    for (let x = 1; x < w; x += 2) g.fillRect(x, i * bh + 1, 1, 1)
  }
  g.fillStyle = '#2d365a'
  for (let k = 0; k < 140; k++) {
    const x = (k * 7919) % w
    const y = (k * 104729) % h
    g.fillRect(x, y, 1, 1)
  }
}

export function paintFloor(): HTMLCanvasElement {
  const W = worldInfo()
  const L = getLayout()
  const c = document.createElement('canvas')
  c.width = W.w
  c.height = W.h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  backdrop(g, W.w, W.h)

  // the building stands on a slab: a drop shadow on the ground, then the visible edges of the slab
  const corner = (x: number, y: number, dy = 0): Pt => {
    const p = toWorld(x, y)
    return [p[0], p[1] + dy]
  }
  poly(g, [corner(0, 0, 8), corner(L.w, 0, 8), corner(L.w, L.h, SLAB + 9), corner(0, L.h, SLAB + 9)], 'rgba(4,5,12,0.4)')
  poly(g, [corner(0, L.h), corner(L.w, L.h), corner(L.w, L.h, SLAB), corner(0, L.h, SLAB)], '#3a3550')
  poly(g, [corner(0, L.h, SLAB - 2), corner(L.w, L.h, SLAB - 2), corner(L.w, L.h, SLAB), corner(0, L.h, SLAB)], '#272339')
  poly(g, [corner(L.w, 0), corner(L.w, L.h), corner(L.w, L.h, SLAB), corner(L.w, 0, SLAB)], '#2a2639')

  const rugList = rugs()
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < L.w; x++) {
      const kind: FloorKind = y >= HALL_Y ? 'stone' : y === 0 ? 'base' : FLOOR_OF[ownerOf(x).dept]
      const [nx, ny] = toWorld(x, y)
      stamp(g, floorTile(kind, x, y), FLOOR_PAL[kind], nx - 16, ny)
      let rug: Rug | undefined
      for (const r of rugList) if (x >= r.rect.x0 && x <= r.rect.x1 && y >= r.rect.y0 && y <= r.rect.y1) rug = r
      if (rug) stamp(g, rugTile(x, y, rug.rect), rugPalette(rug.color), nx - 16, ny)
    }
  }

  for (const r of L.rooms) {
    const inner = (x: number, y: number): Pt => toWorld(x, y)
    g.save()
    g.beginPath()
    const pts = [inner(r.x + 1, 1), inner(r.x + r.w - 1, 1), inner(r.x + r.w - 1, ROOM_H - 1), inner(r.x + 1, ROOM_H - 1)]
    g.moveTo(pts[0][0], pts[0][1])
    for (const p of pts.slice(1)) g.lineTo(p[0], p[1])
    g.closePath()
    g.clip()
    // a soft pool of ceiling light and the contact shadow under the back wall
    const [cx, cy] = toWorld(r.x + r.w / 2, 5.5)
    glow(g, cx, cy, 92, 'rgba(255,232,190,0.035)', 4)
    wallShadow(g, r.x + 1, r.x + r.w - 1, 1, 'rgba(14,10,30,0.13)')
    // sunlight through the windows of the back wall
    const sun = THEME[r.dept].window === 'open' ? 'rgba(255,226,160,0.11)' : THEME[r.dept].window === 'blinds' ? 'rgba(190,214,255,0.08)' : 'rgba(226,234,244,0.09)'
    const windows: Array<[number, number]> = r.dept === 'pm' ? [[1.125, 1.875], [r.w - 2 + 0.125, r.w - 2 + 0.875]] : [[1.125, 2.875], [6.125, 7.875]]
    for (const [a, b] of windows) sunPatch(g, r.x + a, r.x + b, sun, r.dept === 'pm' ? 3.6 : 4.2, r.dept === 'pm' ? 1.4 : 1.8)
    if (r.dept === 'pm') {
      const [lx, ly] = toWorld(r.x + 6.4, 3.6)
      glow(g, lx, ly, 52, 'rgba(255,208,130,0.07)', 3)
    }
    g.restore()
  }
  return c
}

// ── walls and furniture ──────────────────────────────────────────────────────────────────────────────────────────

const northElev = new Map<DeptId, Elev>()
const lowElev = new Map<DeptId, Elev>()
const nElev = (r: Room): Elev => {
  let e = northElev.get(r.dept)
  if (!e) northElev.set(r.dept, (e = northElevation(r.dept, r.w)))
  return e
}
const lElev = (r: Room): Elev => {
  let e = lowElev.get(r.dept)
  if (!e) lowElev.set(r.dept, (e = lowElevation(r.dept, r.w)))
  return e
}

export function buildStatics(): Item[] {
  const L = getLayout()
  const items: Item[] = []
  const put = (s: Sprite, x: number, y: number, d: number, o: number): void => {
    const [sx, sy] = toWorld(x, y)
    items.push({ d, o, fn: (g) => g.drawImage(s.c, Math.round(sx - s.ox), Math.round(sy - s.oy)) })
  }
  const tile = (key: string, t: TileSprite): Sprite => bake(key, t.map, t.pal)

  // the tall back wall, one tile at a time so people can stand in front of it
  for (let x = 0; x < L.w; x++) {
    const r = ownerOf(x)
    const k = x - r.x
    put(tile(`wn:${r.dept}:${k}`, northTile(r.dept, k, nElev(r))), x, 0, x + 1, 0)
  }
  // glass walls between the rooms (and at the east end), seen from the east
  const columns = [...L.rooms.map((r) => r.x), L.w - 1]
  for (const c of columns) {
    const r = c === L.w - 1 ? L.rooms[L.rooms.length - 1] : L.rooms.find((q) => q.x === c)!
    for (let y = 1; y < ROOM_H - 1; y++) {
      const k = ROOM_H - 2 - y
      put(tile(`ww:${r.dept}:${k}`, westTile(r.dept, k, lElev(r))), c, y, c + y + 1, 0)
    }
  }
  // glass wall on the hall side, with a doorway in each room
  for (let x = 0; x < L.w; x++) {
    const r = ownerOf(x)
    const door = L.rooms.find((q) => q.door.some((t) => t.x === x))
    if (door) {
      const side = door.door[0].x === x ? 'L' : 'R'
      put(tile(`dp:${door.dept}:${side}`, doorPost(door.dept, side)), x, ROOM_H - 1, x + ROOM_H, 0)
      continue
    }
    const k = x - r.x
    put(tile(`ws:${r.dept}:${k}`, southTile(r.dept, k, lElev(r))), x, ROOM_H - 1, x + ROOM_H, 0)
  }

  // furniture
  for (const p of L.props) {
    switch (p.kind) {
      case 'plant':
        put(furniture((p.x + p.y) % 2 === 0 ? 'plant.tall' : 'plant.small'), p.x, p.y, p.x + p.y + 1, 1)
        break
      case 'cabinet':
        put(furniture(p.y === 4 ? 'filing' : 'bookshelf'), p.x, p.y, p.x + p.y + 1, 1)
        break
      case 'cooler':
        put(furniture('cooler'), p.x, p.y, p.x + p.y + 1, 1)
        break
      case 'vending':
        put(furniture('vending'), p.x, p.y, p.x + p.y + 1, 1)
        break
      case 'meeting-table':
        // people sit all around it, so it sorts by its middle
        put(furniture('meeting-table'), p.x, p.y, p.x + p.y + (p.w + p.h) / 2, 1)
        break
      case 'sofa':
        put(furniture('sofa', DEPT.pm.color), p.x, p.y, p.x + p.y + (p.w + p.h) / 2, 1)
        break
      default:
        break // the PM's desk has a live screen: it is added with the people
    }
  }
  for (const s of L.pm.meetingSeats) put(furniture('stool'), s.x, s.y, s.x + s.y + 1, 1)
  const seat = L.pm.seat
  put(chairSeat(PM_CHAIR), seat.x, seat.y, seat.x + seat.y + 0.97, 1)
  put(chairBack(PM_CHAIR), seat.x, seat.y, seat.x + seat.y + 1, 2)
  return items
}
