import { EFFECT_LOOK, STATE_LOOK, type AgentState, type Glyph } from './blueprint'
import { DEPT } from './departments'
import { getLayout } from './layout'
import type { Employee, EmployeeStatus } from './model'
import { hex, shade, type Pt } from './pixels'
import type { Actor, OfficeSim } from './sim'
import { DOOR_H, LOW_H, WALL_H } from './assets/walls'
import { feetOf, toScreen, toWorld, type View } from './world'

/**
 * Everything that is drawn on the screen rather than in the world: department signs, name and task plates, speech
 * bubbles, progress. It is made of the same hard-edged, notched plates as the pixel art (no soft rounded boxes), sized
 * for the zoom, placed above the people and moved apart when two would overlap.
 */

export const STATUS_COLOR: Record<EmployeeStatus, string> = {
  working: '#4fb2ff',
  in_review: '#f5b942',
  queued: '#9aa4b2',
  waiting: '#6b7486',
  failed: '#ff6b61',
  blocked: '#ff6b61',
  done: '#52d674'
}

export const statusColor = (s: EmployeeStatus): string => STATUS_COLOR[s]

export interface OverlayOpts {
  selected: string | null
  hovered: string | null
  /** Seconds, for the animated markers. */
  time: number
}

type Ctx = CanvasRenderingContext2D
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const ACTIVE = new Set<EmployeeStatus>(['working', 'in_review', 'failed', 'blocked'])
const INK = '#17142a'
const PAPER = '#f7f4ea'
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const hit = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const dark = (c: string): boolean => hex(c).reduce((s, v) => s + v, 0) < 440

/** A plate with notched corners, a 1 px border and a hard drop shadow. */
function plate(g: Ctx, r: Rect, fill: string, border: string, shadow = true): void {
  const { x, y, w, h } = r
  if (shadow) {
    g.fillStyle = 'rgba(8,6,20,0.45)'
    g.fillRect(x + 1, y + 2, w, h)
  }
  g.fillStyle = border
  g.fillRect(x + 1, y, w - 2, h)
  g.fillRect(x, y + 1, w, h - 2)
  g.fillStyle = fill
  g.fillRect(x + 2, y + 1, w - 4, h - 2)
  g.fillRect(x + 1, y + 2, w - 2, h - 4)
  // a lit top edge
  g.fillStyle = 'rgba(255,255,255,0.16)'
  g.fillRect(x + 2, y + 1, w - 4, 1)
}

const font = (ui: number, weight = 600): string => `${weight} ${Math.round(11 * ui)}px system-ui, "Segoe UI", sans-serif`

function lines(g: Ctx, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (g.measureText(next).width > maxW && cur) {
      out.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) out.push(cur)
  return out.slice(0, 2).map((l, i, a) => (i === a.length - 1 && out.length > 2 ? clip(l, Math.max(4, l.length - 1)) : l))
}

interface Label {
  prio: number
  /** Anchor: centre-x and the bottom of the plate (just above the head). */
  x: number
  y: number
  draw: (r: Rect) => void
  w: number
  h: number
  fixed: boolean
}

function speech(g: Ctx, ui: number, x: number, y: number, text: string, prio: number): Label {
  g.font = font(ui, 500)
  const wrapped = lines(g, clip(text, 60), 150 * ui)
  const tw = Math.max(...wrapped.map((l) => g.measureText(l).width))
  const lh = Math.round(12 * ui)
  const w = Math.round(tw + 14)
  const h = wrapped.length * lh + 6
  return {
    prio,
    x,
    y: y - 5,
    w,
    h,
    fixed: true,
    draw: (r) => {
      plate(g, r, PAPER, INK)
      // tail
      g.fillStyle = INK
      g.fillRect(Math.round(x) - 3, r.y + r.h, 7, 1)
      g.fillRect(Math.round(x) - 2, r.y + r.h + 1, 5, 1)
      g.fillRect(Math.round(x) - 1, r.y + r.h + 2, 3, 1)
      g.fillRect(Math.round(x), r.y + r.h + 3, 1, 1)
      g.fillStyle = PAPER
      g.fillRect(Math.round(x) - 2, r.y + r.h - 1, 5, 1)
      g.fillRect(Math.round(x) - 1, r.y + r.h, 3, 1)
      g.fillRect(Math.round(x), r.y + r.h + 1, 1, 1)
      g.fillStyle = INK
      g.font = font(ui, 500)
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      wrapped.forEach((l, i) => g.fillText(l, r.x + r.w / 2, r.y + 4 + lh * i + lh / 2))
    }
  }
}

function tag(g: Ctx, ui: number, x: number, y: number, text: string, dot: string, progress: number | null, prio: number): Label {
  g.font = font(ui * 0.92)
  const t = clip(text, 24)
  const w = Math.round(g.measureText(t).width + 12 * ui + 12)
  const h = Math.round(15 * ui) + (progress !== null ? 3 : 0)
  return {
    prio,
    x,
    y: y - 3,
    w,
    h,
    fixed: false,
    draw: (r) => {
      plate(g, r, 'rgba(24,20,42,0.94)', shade(dot, 0.7))
      g.fillStyle = dot
      const d = Math.max(3, Math.round(4 * ui))
      g.fillRect(r.x + 5, r.y + Math.round((r.h - (progress !== null ? 3 : 0) - d) / 2), d, d)
      g.fillStyle = '#eef0f7'
      g.font = font(ui)
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      g.fillText(t, r.x + 9 + d, r.y + (r.h - (progress !== null ? 3 : 0)) / 2 + 0.5)
      if (progress !== null) {
        g.fillStyle = '#0c0a18'
        g.fillRect(r.x + 3, r.y + r.h - 4, r.w - 6, 2)
        g.fillStyle = dot
        g.fillRect(r.x + 3, r.y + r.h - 4, Math.max(1, Math.round((r.w - 6) * clamp(progress, 0.04, 1))), 2)
      }
    }
  }
}

/** A 5 × 5 pixel glyph for a state, drawn inside a box of `u` px per art pixel. */
const GLYPH: Record<Glyph, string[]> = {
  dash: ['.....', '.....', '#####', '.....', '.....'],
  gear: ['.#.#.', '#####', '##.##', '#####', '.#.#.'],
  dots: ['.....', '.....', '#.#.#', '.....', '.....'],
  link: ['.....', '##.##', '#####', '##.##', '.....'],
  hourglass: ['#####', '.###.', '..#..', '.###.', '#####'],
  bang: ['..#..', '..#..', '..#..', '.....', '..#..'],
  check: ['.....', '....#', '#..#.', '.##..', '..#..'],
  cross: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']
}

function glyph(g: Ctx, kind: Glyph, x: number, y: number, size: number, color: string): void {
  const u = Math.max(1, Math.floor(size / 5))
  g.fillStyle = color
  GLYPH[kind].forEach((row, j) => {
    for (let i = 0; i < 5; i++) if (row[i] === '#') g.fillRect(x + i * u, y + j * u, u, u)
  })
}

/** A small status marker over a person whose task plate is not shown (idle people, or when the screen is crowded). */
function pip(g: Ctx, ui: number, x: number, y: number, state: AgentState, t: number, prio: number): Label {
  const look = STATE_LOOK[state]
  const w = Math.round(13 * ui)
  return {
    prio,
    x,
    y: y - 2,
    w,
    h: w,
    fixed: true,
    draw: (r) => {
      plate(g, r, 'rgba(24,20,42,0.94)', shade(look.color, 0.7))
      const u = Math.max(1, Math.floor((r.w - 4) / 5))
      // THINKING: three dots that light one after the other
      if (state === 'thinking') {
        const on = Math.floor(t * 3) % 3
        for (let i = 0; i < 3; i++) {
          g.fillStyle = i === on ? look.color : shade(look.color, 0.5)
          g.fillRect(r.x + 2 + i * (u + 1) * 1.5, r.y + Math.round(r.h / 2) - 1, Math.max(2, u), Math.max(2, u))
        }
        return
      }
      glyph(g, look.glyph, r.x + Math.round((r.w - u * 5) / 2), r.y + Math.round((r.h - u * 5) / 2), u * 5, look.color)
    }
  }
}

function sign(g: Ctx, ui: number, x: number, y: number, text: string, color: string): void {
  g.font = font(ui, 700)
  const w = Math.round(g.measureText(text).width + 16)
  const h = Math.round(16 * ui)
  const r: Rect = { x: Math.round(x - w / 2), y: Math.round(y - h), w, h }
  plate(g, r, color, shade(color, 0.45))
  g.fillStyle = 'rgba(0,0,0,0.12)'
  g.fillRect(r.x + 2, r.y + r.h - 3, r.w - 4, 1)
  g.fillStyle = dark(color) ? '#ffffff' : '#1a1630'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, r.x + r.w / 2, r.y + r.h / 2)
}

function nameplate(g: Ctx, ui: number, x: number, y: number, name: string): void {
  g.font = font(ui * 0.9)
  const w = Math.round(g.measureText(name).width + 10)
  const h = Math.round(13 * ui)
  const r: Rect = { x: Math.round(x - w / 2), y: Math.round(y), w, h }
  plate(g, r, 'rgba(24,20,42,0.88)', '#3b3558')
  g.fillStyle = '#eef0f7'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(name, r.x + r.w / 2, r.y + r.h / 2 + 0.5)
}

/** Where the head of a person is on the screen (top of the sprite). */
const headOf = (a: Actor, view: View): Pt => {
  const [sx, sy] = toScreen(view, ...feetOf(a))
  return [sx, sy - (a.pose === 'sit' ? 41 : 33) * view.scale]
}

export function drawOverlay(g: Ctx, sim: OfficeSim, view: View, opts: OverlayOpts): void {
  const snap = sim.snapshot
  const L = getLayout()
  const ui = clamp(0.8 + view.scale * 0.25, 0.85, 1.25)
  g.save()
  g.imageSmoothingEnabled = false

  // department signs: above the tall back wall on the top row, on the glass wall that closes the room in the north elsewhere
  for (const r of L.rooms) {
    const d = DEPT[r.dept]
    const [wx, wy] = toWorld(r.x + r.w / 2, r.y + (r.y === 0 ? 1 : 0.5))
    const [sx, sy] = toScreen(view, wx, wy - (r.y === 0 ? WALL_H + 5 : LOW_H + 9))
    const n = snap ? (r.dept === 'pm' ? 1 : snap.departments[r.dept].employees) : 0
    const over = snap && r.dept !== 'pm' ? snap.departments[r.dept].overflow : 0
    sign(g, ui, sx, sy, r.dept === 'pm' ? d.short : `${d.short} · ${n}${over > 0 ? ` +${over}` : ''}`, d.color)
  }
  // the hub: a sign over the entrance
  {
    const [wx, wy] = toWorld(L.entrance.x + 1, L.entrance.y + 0.5)
    const [sx, sy] = toScreen(view, wx, wy - DOOR_H - 10)
    sign(g, ui, sx, sy, 'HUB · COLLABORATION', '#d8d2c4')
  }
  if (!snap) {
    g.restore()
    return
  }

  // below this zoom a crowded office would be a wall of text: people get a status pip, the plate appears on hover/zoom
  const detail = view.scale >= 1.25
  const plates = view.scale >= 2.1
  const names = view.scale >= 2.7
  const labels: Label[] = []
  const byId = new Map<string, Employee>(snap.employees.map((e) => [e.id, e]))
  const tasks = new Map(snap.tasks.map((t) => [t.taskId, t]))

  for (const a of sim.ordered()) {
    const emp = byId.get(a.id)
    const [sx, sy] = toScreen(view, ...feetOf(a))
    const [hx, hy] = headOf(a, view)
    const selected = opts.selected === a.id
    const hot = selected || opts.hovered === a.id
    if (hot) {
      // a ring on the floor: two pixel ellipses
      g.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.7)'
      g.lineWidth = Math.max(1, Math.round(view.scale))
      g.beginPath()
      g.ellipse(Math.round(sx), Math.round(sy), 11 * view.scale, 5.5 * view.scale, 0, 0, Math.PI * 2)
      g.stroke()
    }
    const state = sim.stateOf(a.id)
    const color = STATE_LOOK[state].color
    if (a.bubble) {
      labels.push(speech(g, ui, hx, hy, a.bubble.text, 3))
    } else if (detail && !hot && a.kind !== 'pm' && (!plates || !emp || !ACTIVE.has(emp.status))) {
      labels.push(pip(g, ui, hx, hy, state, opts.time, 0))
    } else if (detail || hot || a.kind === 'pm') {
      const task = emp ? tasks.get(emp.assignedTaskId ?? '') : undefined
      const text = a.kind === 'pm' ? `PM · ${snap.pm.name}` : `${STATE_LOOK[state].label} · ${a.label ?? (task ? task.title : emp?.currentActivity ?? '')}`
      const progress = detail && emp && emp.progress !== null && a.kind !== 'pm' ? emp.progress : null
      labels.push(tag(g, ui, hx, hy, text, color, progress, selected ? 2 : hot ? 2 : a.kind === 'pm' ? 1 : 0))
    }
    if ((names || hot) && emp) nameplate(g, ui, sx, sy + 3, emp.name)
  }

  // what just happened: a marker that rises over the place and fades
  for (const e of sim.effects) {
    const look = EFFECT_LOOK[e.kind]
    const age = (sim.t - e.at) / look.seconds
    if (age < 0 || age > 1) continue
    const [wx, wy] = toWorld(e.x, e.y)
    const [sx, sy] = toScreen(view, wx, wy - 40 - age * 10)
    g.globalAlpha = age > 0.75 ? (1 - age) * 4 : 1
    g.font = font(ui * 0.95, 700)
    const w = Math.round(g.measureText(e.text).width + 12 * ui + 14)
    const h = Math.round(16 * ui)
    const r: Rect = { x: Math.round(sx - w / 2), y: Math.round(sy - h), w, h }
    plate(g, r, shade(look.color, 0.35), look.color)
    glyph(g, look.glyph, r.x + 4, r.y + Math.round((h - 5 * Math.max(1, Math.floor(h / 8))) / 2), 5 * Math.max(1, Math.floor(h / 8)), '#ffffff')
    g.fillStyle = '#ffffff'
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.fillText(e.text, r.x + 10 + 5 * Math.max(1, Math.floor(h / 8)), r.y + h / 2 + 0.5)
    g.globalAlpha = 1
  }

  // place the plates: speech bubbles stay where they are, the others move up until they clear what is already placed
  labels.sort((p, q) => q.prio - p.prio)
  const placed: Rect[] = []
  for (const l of labels) {
    const r: Rect = { x: Math.round(l.x - l.w / 2), y: Math.round(l.y - l.h), w: l.w, h: l.h }
    if (!l.fixed) {
      for (let i = 0; i < 4 && placed.some((p) => hit(p, r)); i++) r.y -= l.h + 2
    }
    placed.push(r)
    l.draw(r)
  }
  g.restore()
}
