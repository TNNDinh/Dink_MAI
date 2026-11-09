import { DEPT } from './departments'
import { deskOf, getLayout, type Tile } from './layout'
import type { Employee } from './model'
import type { ScreenState } from './assets/props'
import { drawBoards } from './boards'
import { glow } from './lighting'
import { drawOverlay } from './overlay'
import { hex, type Pt } from './pixels'
import { buildStatics, paintFloor, type Item } from './scene'
import type { Actor, OfficeSim } from './sim'
import { PM_LOOK, chairBack, chairSeat, deskSprite, docSprite, lookOf, person, pmDeskSprite, shadowSprite } from './sprites'
import { BG, feetOf, toScreen, toWorld, worldInfo, type View } from './world'

/**
 * The office on the canvas. The world is drawn at 1× into an offscreen canvas (one floor canvas, then every wall piece,
 * piece of furniture and person as a sprite, back to front) and then scaled by the view with no smoothing, so every art
 * pixel stays a hard square. Layers, in order: floor and rugs and baked light → walls and furniture (sorted by depth, the
 * glow of working screens under their desks) → people with their contact shadows → backs of chairs and wall boards in
 * front of what they belong to → the screen overlay (signs, name and task plates, speech bubbles).
 */

export { MAX_SCALE, MIN_SCALE, feetOf, fitView, focusView, toWorld, worldInfo, type View, type WorldInfo } from './world'
export { statusColor } from './overlay'
export { lookOf }
export type { Tile }

/** How far a seated person is raised: the height of the seat above the floor, less what sinks into the cushion. */
const SIT_LIFT = 4

let floorCanvas: HTMLCanvasElement | null = null
let worldCanvas: HTMLCanvasElement | null = null
let statics: Item[] | null = null

function screenOf(e: Employee | undefined): ScreenState {
  if (!e) return 'off'
  if (e.status === 'working') return 'on'
  if (e.status === 'failed' || e.status === 'blocked') return 'err'
  if (e.status === 'in_review' || e.status === 'queued') return 'idle'
  return 'off'
}

function actorItem(a: Actor, emp: Employee | undefined, t: number): Item {
  const [fx, fy] = feetOf(a)
  const pm = a.kind === 'pm'
  const sitting = a.pose === 'sit'
  const typing = sitting && (pm || emp?.status === 'working')
  const frame = a.pose === 'walk' ? Math.floor(a.walkPhase) % 4 : typing ? Math.floor(t * 4 + a.x) % 2 : 0
  const look = pm ? PM_LOOK : lookOf(emp?.look ?? 0)
  return {
    d: a.x + a.y + 1.02,
    o: 3,
    fn: (g) => {
      const s = person(look, a.dept, pm ? 'pm' : 'staff', a.facing, a.pose, frame)
      const lift = sitting ? SIT_LIFT : 0
      if (!sitting) {
        const sh = shadowSprite()
        g.drawImage(sh.c, Math.round(fx - sh.ox), Math.round(fy - sh.oy))
      }
      g.drawImage(s.c, Math.round(fx - s.ox), Math.round(fy - s.oy - lift))
      if (a.carrying) {
        const d = docSprite()
        const side = a.facing === 'W' ? -6 : a.facing === 'E' ? 6 : a.facing === 'S' ? -5 : 5
        g.drawImage(d.c, Math.round(fx + side - d.ox), Math.round(fy - 11 - d.oy - lift))
      }
    }
  }
}

/** The glow of a working screen on the floor in front of its desk. */
function glowItem(dept: Employee['department'], x: number, y: number): Item {
  const [cx, cy] = toWorld(x + 0.5, y + 1.05)
  const [r, gr, b] = hex(DEPT[dept].color)
  const color = `rgba(${r},${gr},${b},0.055)`
  return {
    d: x + y + 0.99,
    o: 0,
    fn: (g) => {
      g.save()
      g.globalCompositeOperation = 'lighter'
      glow(g, cx, cy, 34, color, 3)
      g.restore()
    }
  }
}

function buildItems(sim: OfficeSim, t: number): Item[] {
  statics ??= buildStatics()
  const items: Item[] = [...statics]
  const snap = sim.snapshot
  const L = getLayout()
  const frame = Math.floor(t * 3)

  const pmDesk = L.props.find((p) => p.kind === 'pm-desk')
  if (pmDesk) {
    const s = pmDeskSprite('on', frame % 3)
    const [sx, sy] = toWorld(pmDesk.x, pmDesk.y)
    items.push({ d: pmDesk.x + pmDesk.y + (pmDesk.w + pmDesk.h) / 2, o: 1, fn: (g) => g.drawImage(s.c, Math.round(sx - s.ox), Math.round(sy - s.oy)) })
  }

  const byId = new Map<string, Employee>()
  if (snap) {
    for (const e of snap.employees) {
      byId.set(e.id, e)
      const d = deskOf(e.department, e.deskIndex)
      const state = screenOf(e)
      const accent = DEPT[e.department].color
      const desk = deskSprite(e.department, state, state === 'on' ? (frame + e.deskIndex) % 3 : 0)
      const seat = chairSeat(accent)
      const back = chairBack(accent)
      const [dx, dy] = toWorld(d.desk.x, d.desk.y)
      const [cx, cy] = toWorld(d.chair.x, d.chair.y)
      if (state === 'on') items.push(glowItem(e.department, d.desk.x, d.desk.y))
      items.push({ d: d.desk.x + d.desk.y + 1, o: 1, fn: (g) => g.drawImage(desk.c, Math.round(dx - desk.ox), Math.round(dy - desk.oy)) })
      items.push({ d: d.chair.x + d.chair.y + 0.97, o: 1, fn: (g) => g.drawImage(seat.c, Math.round(cx - seat.ox), Math.round(cy - seat.oy)) })
      items.push({ d: d.chair.x + d.chair.y + 1, o: 2, fn: (g) => g.drawImage(back.c, Math.round(cx - back.ox), Math.round(cy - back.oy)) })
    }
    // the boards on the PM's wall, one slice per wall tile so they sit behind whoever stands in front
    const [a, b] = [L.pm.panels.project[0], L.pm.panels.status[1]]
    for (let x = a; x <= b; x++) {
      const [sx] = toWorld(x, 1)
      items.push({
        d: x + 1.2,
        o: 0,
        fn: (g) => {
          g.save()
          g.beginPath()
          g.rect(sx, 0, 16, worldInfo().h)
          g.clip()
          drawBoards(g, snap, t)
          g.restore()
        }
      })
    }
  }
  for (const a of sim.ordered()) items.push(actorItem(a, byId.get(a.id), t))
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
  ctx.drawImage(worldCanvas, Math.round(view.panX), Math.round(view.panY), Math.round(W.w * view.scale), Math.round(W.h * view.scale))
  ctx.restore()
  drawOverlay(ctx, sim, view, opts)
}

/** The centre of a person on the screen (for clicking). */
export function actorScreen(a: Actor, view: View): Pt {
  const [fx, fy] = feetOf(a)
  return toScreen(view, fx, fy - (a.pose === 'sit' ? 16 : 12))
}

