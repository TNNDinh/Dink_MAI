import { DEPT } from './departments'
import { doorAt, getLayout, isWall, roomAt, type Room } from './layout'
import type { RoomId } from './blueprint'
import { FLOOR_PAL, floorTile, rugPalette, rugTile, type FloorKind, type RugRect } from './assets/floors'
import { stamp, bake } from './assets/pixmap'
import { HUB_ACCENT, THEME, accentOf, doorPost, doorPostV, lowElevation, northElevation, northTile, southTile, westTile, type ThemeId, type TileSprite } from './assets/walls'
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

const floorOf = (id: RoomId | null): FloorKind => {
  if (!id || id === 'hub') return 'stone'
  return getLayout().rooms.find((r) => r.dept === id)!.floor
}

/** The theme (wall colours, accent) of a room or of the hub. */
export const themeOf = (id: RoomId | null): ThemeId => id ?? 'hub'

/** The accent colour of a place in the studio. */
export const accentOfRoom = (id: RoomId): string => accentOf(themeOf(id))

// ── floor ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Rug {
  rect: RugRect
  color: string
}

const rug = (x0: number, y0: number, x1: number, y1: number, color: string): Rug => ({ rect: { x0, y0, x1, y1 }, color })

function rugs(): Rug[] {
  const L = getLayout()
  const out: Rug[] = []
  for (const r of L.rooms) {
    // a runner in the colour of the department along its aisle, a coir mat where its door opens onto the hub
    if (r.dept !== 'pm') out.push(rug(r.x + 2, r.entryY, r.x + r.w - 3, r.entryY, DEPT[r.dept].color))
    const [a, b] = r.door
    const horizontal = a.y === b.y
    out.push(horizontal ? rug(a.x, a.y - 1, b.x, a.y + 1, '#7d5c3e') : rug(Math.min(a.x, a.x + (r.mirror ? 1 : -1)), a.y, Math.max(a.x, a.x + (r.mirror ? 1 : -1)), b.y, '#7d5c3e'))
  }
  const pm = L.rooms.find((r) => r.dept === 'pm')!
  out.push(rug(pm.x + 5, 3, pm.x + 8, 5, '#8c3f4f'))
  out.push(rug(pm.x + 8, 4, pm.x + 12, 7, '#2f6f8f'))
  // the hub: under the big table, the two lounges and a runner from the entrance
  const t = L.hub.table
  out.push(rug(t.x - 2, t.y - 2, t.x + t.w + 1, t.y + t.h + 1, '#2f4f8f'))
  out.push(rug(12, 19, 17, 23, '#5f3f86'))
  out.push(rug(24, 19, 29, 23, '#2f6f8f'))
  out.push(rug(20, 22, 21, 29, '#8c3f4f'))
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

/** Clips the context to the floor of a rectangle of tiles. */
function clipTiles(g: G, x0: number, y0: number, x1: number, y1: number): void {
  const pts = [toWorld(x0, y0), toWorld(x1, y0), toWorld(x1, y1), toWorld(x0, y1)]
  g.beginPath()
  g.moveTo(pts[0][0], pts[0][1])
  for (const p of pts.slice(1)) g.lineTo(p[0], p[1])
  g.closePath()
  g.clip()
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
  for (let y = 0; y < L.h; y++) {
    for (let x = 0; x < L.w; x++) {
      const kind: FloorKind = y === 0 ? 'base' : floorOf(roomAt(x, y))
      const [nx, ny] = toWorld(x, y)
      stamp(g, floorTile(kind, x, y), FLOOR_PAL[kind], nx - 16, ny)
      let r: Rug | undefined
      for (const q of rugList) if (x >= q.rect.x0 && x <= q.rect.x1 && y >= q.rect.y0 && y <= q.rect.y1) r = q
      if (r) stamp(g, rugTile(x, y, r.rect), rugPalette(r.color), nx - 16, ny)
    }
  }

  // light: a soft pool of ceiling light in every room, sun through the windows of the back wall
  for (const r of L.rooms) {
    g.save()
    clipTiles(g, r.x + 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1)
    const [cx, cy] = toWorld(r.x + r.w / 2, r.y + 5.5)
    glow(g, cx, cy, 92, 'rgba(255,232,190,0.035)', 4)
    if (r.y === 0) {
      wallShadow(g, r.x + 1, r.x + r.w - 1, 1, 'rgba(14,10,30,0.13)')
      const win = THEME[r.dept].window
      const sun = win === 'open' ? 'rgba(255,226,160,0.11)' : win === 'blinds' ? 'rgba(190,214,255,0.08)' : 'rgba(226,234,244,0.09)'
      const windows: Array<[number, number]> = r.dept === 'pm' ? [[1.125, 1.875], [r.w - 2 + 0.125, r.w - 2 + 0.875]] : r.mirror ? [[r.w - 3 + 0.125, r.w - 3 + 1.875], [r.w - 8 + 0.125, r.w - 8 + 1.875]] : [[1.125, 2.875], [6.125, 7.875]]
      for (const [a, b] of windows) sunPatch(g, r.x + a, r.x + b, sun, r.dept === 'pm' ? 3.6 : 4.2, r.dept === 'pm' ? 1.4 : 1.8)
    }
    if (r.dept === 'pm') {
      const [lx, ly] = toWorld(r.x + 6.4, 3.6)
      glow(g, lx, ly, 52, 'rgba(255,208,130,0.07)', 3)
    }
    g.restore()
  }
  // the hub: pools of light over the table, the lounges and the entrance, and the sun in the two corridors
  g.save()
  clipTiles(g, L.hub.x + 1, 1, L.hub.x + L.hub.w - 1, L.hub.h - 1)
  const lamp = (x: number, y: number, r: number, color = 'rgba(255,232,190,0.04)'): void => {
    const [cx, cy] = toWorld(x, y)
    glow(g, cx, cy, r, color, 4)
  }
  lamp(L.hub.centre.x, L.hub.centre.y + 0.5, 130, 'rgba(180,210,255,0.05)')
  lamp(14.5, 21, 70, 'rgba(210,170,255,0.045)')
  lamp(26.5, 21, 70, 'rgba(160,220,255,0.045)')
  lamp(20.5, 27, 80)
  lamp(20.5, 12, 80)
  g.restore()
  g.save()
  clipTiles(g, L.hub.x + 1, 1, L.hub.x + L.hub.w - 1, 10)
  wallShadow(g, L.hub.x + 1, 14, 1, 'rgba(14,10,30,0.13)')
  wallShadow(g, 28, L.hub.x + L.hub.w - 1, 1, 'rgba(14,10,30,0.13)')
  sunPatch(g, 12.125, 13.875, 'rgba(255,226,160,0.1)', 4, 1.6)
  sunPatch(g, 28.125, 29.875, 'rgba(255,226,160,0.1)', 4, 1.6)
  g.restore()
  return c
}

// ── walls and furniture ──────────────────────────────────────────────────────────────────────────────────────────

const north = new Map<ThemeId, Elev>()
const low = new Map<ThemeId, Elev>()

/** The tile a theme's back wall starts at (the first tile of its elevation). */
const originOf = (t: ThemeId): { x: number; w: number } => {
  const L = getLayout()
  if (t === 'hub') return { x: L.hub.x, w: L.hub.w }
  const r = L.rooms.find((q) => q.dept === t)!
  return { x: r.x, w: r.w }
}

const nElev = (t: ThemeId): Elev => {
  let e = north.get(t)
  if (!e) north.set(t, (e = northElevation(t, originOf(t).w)))
  return e
}
const lElev = (t: ThemeId): Elev => {
  let e = low.get(t)
  if (!e) low.set(t, (e = lowElevation(t, 42)))
  return e
}

/** The room whose face a wall tile shows to the camera: the one south of a wall along x, the one east of a wall along y. */
const faceRoom = (x: number, y: number, dx: number, dy: number): RoomId | null => {
  const f = roomAt(x + dx, y + dy)
  return f ?? roomAt(x, y)
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
    const theme = themeOf(roomAt(x, 1))
    const k = x - originOf(theme).x
    put(tile(`wn:${theme}:${k}`, northTile(theme, k, nElev(theme))), x, 0, x + 1, 0)
  }
  // glass walls: along x they show their south face, along y their east face
  for (let y = 1; y < L.h; y++) {
    for (let x = 0; x < L.w; x++) {
      if (!isWall(x, y)) continue
      const alongX = isWall(x - 1, y) || isWall(x + 1, y) || doorAt(x - 1, y) !== undefined || doorAt(x + 1, y) !== undefined
      const alongY = isWall(x, y - 1) || isWall(x, y + 1) || doorAt(x, y - 1) !== undefined || doorAt(x, y + 1) !== undefined
      if (alongX) {
        const t = themeOf(faceRoom(x, y, 0, 1))
        put(tile(`ws:${t}:${x}`, southTile(t, x, lElev(t))), x, y, x + y + 1, 0)
      }
      if (alongY) {
        const t = themeOf(faceRoom(x, y, 1, 0))
        const k = L.h - 1 - y
        put(tile(`ww:${t}:${k}`, westTile(t, k, lElev(t))), x, y, x + y + 1, 0)
      }
    }
  }
  // the posts of every door
  for (const d of L.doors) {
    const [a, b] = d.tiles
    if (d.orient === 'h') {
      const t = themeOf(faceRoom(a.x, a.y, 0, 1))
      put(tile(`dp:${t}:L`, doorPost(t, 'L')), a.x, a.y, a.x + a.y + 1, 0)
      put(tile(`dp:${t}:R`, doorPost(t, 'R')), b.x, b.y, b.x + b.y + 1, 0)
    } else {
      const t = themeOf(faceRoom(a.x, a.y, 1, 0))
      put(tile(`dv:${t}:N`, doorPostV(t, 'N')), a.x, a.y, a.x + a.y + 1, 0)
      put(tile(`dv:${t}:S`, doorPostV(t, 'S')), b.x, b.y, b.x + b.y + 1, 0)
    }
  }

  // furniture
  const front = (p: { x: number; y: number }): number => p.x + p.y + 1
  const mid = (p: { x: number; y: number; w: number; h: number }): number => p.x + p.y + (p.w + p.h) / 2
  for (const p of L.props) {
    const accent = accentOfRoom(p.room)
    switch (p.kind) {
      case 'plant':
        put(furniture((p.x + p.y) % 2 === 0 ? 'plant.tall' : 'plant.small'), p.x, p.y, front(p), 1)
        break
      case 'cabinet':
        put(furniture(p.y === 4 ? 'filing' : 'bookshelf'), p.x, p.y, front(p), 1)
        break
      case 'cooler':
      case 'vending':
        put(furniture(p.kind), p.x, p.y, front(p), 1)
        break
      case 'table':
        // people sit all around it, so it sorts by its middle
        put(furniture('meeting-table'), p.x, p.y, mid(p), 1)
        break
      case 'round-table':
      case 'booth':
      case 'console':
      case 'testbench':
        put(furniture(p.kind), p.x, p.y, mid(p), 1)
        break
      case 'sofa':
        put(furniture('sofa', p.room === 'hub' ? '#4f78b8' : DEPT[p.room].color), p.x, p.y, mid(p), 1)
        break
      case 'stool':
        put(furniture('stool'), p.x, p.y, front(p), 1)
        break
      case 'speaker':
      case 'easel':
      case 'storage':
        put(furniture(p.kind), p.x, p.y, front(p), 1)
        break
      default:
        break // racks, boards, screens, desks and the PM's desk are alive: they are added with the people
    }
    if (p.chair) {
      put(chairSeat(accent), p.chair.x, p.chair.y, p.chair.x + p.chair.y + 0.97, 1)
      put(chairBack(accent), p.chair.x, p.chair.y, p.chair.x + p.chair.y + 1, 2)
    }
  }
  for (const s of L.pm.meetingSeats) put(furniture('stool'), s.x, s.y, front(s), 1)
  const seat = L.pm.seat
  put(chairSeat(PM_CHAIR), seat.x, seat.y, seat.x + seat.y + 0.97, 1)
  put(chairBack(PM_CHAIR), seat.x, seat.y, seat.x + seat.y + 1, 2)
  return items
}

export type { Room }
export { HUB_ACCENT }
