import { DEPT, type DeptId } from './departments'
import { getLayout, type Prop } from './layout'
import type { OfficeSnapshot, OfficeTask } from './model'
import { accentOfRoom, type Item } from './scene'
import { Face, poly, shade, type G } from './pixels'
import { toWorld } from './world'

/**
 * The free-standing boards and screens of the departments and of the hub. Each one stands on legs in its row of the
 * feature strip, faces south and shows what the studio really has: tasks per status, progress per developer, the
 * state of the build. Nothing on them is made up; a board of a department with no work yet is simply empty.
 */

const COLOR = {
  todo: '#9aa4b2',
  active: '#4fb2ff',
  review: '#f5b942',
  done: '#52d674',
  bad: '#ff6b61',
  blocked: '#ff8a5c',
  ink: '#1b2236',
  paper: '#eef1f6',
  grid: '#cfd5e0'
}

const statusColor = (t: OfficeTask): string => {
  switch (t.status) {
    case 'done':
      return COLOR.done
    case 'failed':
      return COLOR.bad
    case 'blocked':
      return COLOR.blocked
    case 'review':
    case 'testing':
      return COLOR.review
    case 'in_progress':
      return COLOR.active
    default:
      return COLOR.todo
  }
}

const of = (snap: OfficeSnapshot, dept: DeptId): OfficeTask[] => snap.tasks.filter((t) => t.department === dept)

const LEG = 8
const HEIGHT = 26

interface Ink {
  r(color: string, i: number, j: number, w: number, h: number): void
}

type Paint = (f: Ink, iw: number, ih: number, snap: OfficeSnapshot, t: number, p: Prop) => void

/** A grid of one small square per task of a department, filled with the colour of its status. */
function cells(f: Ink, iw: number, ih: number, tasks: OfficeTask[], size = 4): void {
  const cols = Math.max(1, Math.floor(iw / (size + 1)))
  const rows = Math.max(1, Math.floor(ih / (size + 1)))
  for (let i = 0; i < cols * rows; i++) {
    const cx = 1 + (i % cols) * (size + 1)
    const cy = ih - size - Math.floor(i / cols) * (size + 1)
    const task = tasks[i]
    f.r(task ? statusColor(task) : COLOR.grid, cx, cy, size, size)
  }
}

function level(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#243049', 0, 0, iw, ih)
  const tasks = of(snap, 'gd')
  // a platformer level: one platform per task, left to right, climbing, coloured by status
  const n = Math.max(tasks.length, 1)
  for (let i = 0; i < n; i++) {
    const x = 2 + Math.floor((i * (iw - 10)) / n)
    const y = 3 + ((i * 5) % (ih - 8))
    f.r(tasks[i] ? statusColor(tasks[i]) : '#3a4766', x, y, Math.max(4, Math.floor((iw - 10) / n) - 1), 2)
  }
  f.r('#e0b341', iw - 5, 3, 3, 3)
}

function diagram(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r(COLOR.paper, 0, 0, iw, ih)
  const staff = snap.employees.filter((e) => e.department === 'gd').slice(0, 5)
  const nodes = Math.max(staff.length, 2)
  for (let i = 0; i < nodes - 1; i++) f.r('#7d879b', 4 + i * Math.floor((iw - 10) / (nodes - 1)), Math.floor(ih / 2), Math.floor((iw - 10) / (nodes - 1)), 1)
  for (let i = 0; i < nodes; i++) {
    const e = staff[i]
    const c = !e ? COLOR.grid : e.status === 'working' ? COLOR.active : e.status === 'done' ? COLOR.done : e.status === 'failed' ? COLOR.bad : COLOR.todo
    f.r(COLOR.ink, 2 + i * Math.floor((iw - 10) / (nodes - 1)), Math.floor(ih / 2) - 2, 6, 6)
    f.r(c, 3 + i * Math.floor((iw - 10) / (nodes - 1)), Math.floor(ih / 2) - 1, 4, 4)
  }
}

function concept(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#2b2f45', 0, 0, iw, ih)
  const staff = snap.employees.filter((e) => e.department === 'art')
  const n = Math.max(1, Math.min(4, staff.length))
  const w = Math.floor((iw - 2) / n)
  for (let i = 0; i < n; i++) {
    const e = staff[i]
    f.r(e ? statusColor({ status: e.status === 'working' ? 'in_progress' : e.status === 'done' ? 'done' : 'todo' } as OfficeTask) : '#3a4766', 1 + i * w, 3, w - 2, ih - 6)
    f.r('#f1c9a5', 3 + i * w, ih - 9, Math.max(3, w - 6), 4) // a head on every sheet
    f.r('#222', 3 + i * w, ih - 9, Math.max(3, w - 6), 1)
  }
}

function reference(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#d9d2c2', 0, 0, iw, ih)
  const tasks = of(snap, 'art')
  const palette = ['#d8694f', '#e7b94c', '#6bb36f', '#4f8fd8', '#9b6cd1', '#7d879b']
  for (let i = 0; i < 12; i++) {
    const cx = 2 + (i % 6) * Math.floor((iw - 3) / 6)
    const cy = ih - 7 - Math.floor(i / 6) * 8
    f.r(i < tasks.length ? palette[i % palette.length] : '#c3bba9', cx, cy, Math.floor((iw - 3) / 6) - 1, 6)
  }
}

function animation(f: Ink, iw: number, ih: number, snap: OfficeSnapshot, t: number): void {
  const live = snap.employees.some((e) => e.department === 'art' && e.status === 'working')
  f.r(live ? '#10203a' : '#10131c', 0, 0, iw, ih)
  if (!live) return
  const k = Math.floor(t * 6) % 8
  f.r('#2c3a5e', 0, 3, iw, 1)
  const x = 3 + Math.floor((k * (iw - 12)) / 8)
  const jump = k < 4 ? k : 8 - k
  f.r('#ffd166', x, 5 + jump * 2, 5, 6)
  f.r('#ef476f', x + 1, 11 + jump * 2, 3, 2)
}

function waveform(f: Ink, iw: number, ih: number, snap: OfficeSnapshot, t: number): void {
  const live = snap.employees.some((e) => e.department === 'audio' && e.status === 'working')
  f.r('#0c1b17', 0, 0, iw, ih)
  const mid = Math.floor(ih / 2)
  for (let i = 1; i < iw - 1; i += 2) {
    const a = live ? 1 + Math.abs(Math.round(Math.sin(i * 0.6 + t * 7) * (ih / 2 - 3))) : 1
    f.r(live ? '#52e0a0' : '#2c5a49', i, mid - Math.floor(a / 2), 1, a)
  }
}

function bugs(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r(COLOR.paper, 0, 0, iw, ih)
  const tasks = of(snap, 'qa')
  const cols: Array<[string, (t: OfficeTask) => boolean]> = [
    [COLOR.bad, (t) => t.status === 'failed'],
    [COLOR.blocked, (t) => t.status === 'blocked'],
    [COLOR.review, (t) => t.status === 'testing' || t.status === 'review' || t.status === 'in_progress'],
    [COLOR.done, (t) => t.status === 'done']
  ]
  const w = Math.floor((iw - 2) / cols.length)
  cols.forEach(([c, test], i) => {
    f.r(c, 1 + i * w, ih - 3, w - 2, 2)
    const n = tasks.filter(test).length
    for (let r = 0; r < Math.min(n, 4); r++) f.r(shade(c, 1.2), 1 + i * w, ih - 8 - r * 4, w - 2, 3)
  })
}

function results(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#10171f', 0, 0, iw, ih)
  const tasks = of(snap, 'qa')
  const total = Math.max(tasks.length, 1)
  const pass = tasks.filter((t) => t.status === 'done').length
  const fail = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked').length
  f.r('#243044', 2, ih - 8, iw - 4, 5)
  f.r(COLOR.done, 2, ih - 8, Math.round(((iw - 4) * pass) / total), 5)
  f.r(COLOR.bad, 2 + Math.round(((iw - 4) * pass) / total), ih - 8, Math.round(((iw - 4) * fail) / total), 5)
  f.r(fail > 0 ? COLOR.bad : COLOR.done, 2, 3, 5, 5)
}

function whiteboard(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#f4f6f8', 0, 0, iw, ih)
  const staff = snap.employees.filter((e) => e.department === 'dev').slice(0, 4)
  const rows = Math.max(staff.length, 1)
  for (let i = 0; i < rows; i++) {
    const e = staff[i]
    const y = ih - 5 - i * 5
    f.r(e ? COLOR.active : COLOR.grid, 2, y, 4, 3)
    f.r('#7d879b', 8, y + 1, Math.floor((iw - 14) * (e?.progress ?? 0.4)), 1)
    if (e && e.status === 'done') f.r(COLOR.done, iw - 5, y, 3, 3)
  }
}

function progress(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#0f1724', 0, 0, iw, ih)
  const staff = snap.employees.filter((e) => e.department === 'dev').slice(0, 5)
  const rows = Math.max(staff.length, 1)
  for (let i = 0; i < rows; i++) {
    const e = staff[i]
    const y = ih - 5 - i * 4
    f.r('#243044', 2, y, iw - 4, 2)
    if (e) f.r(e.status === 'failed' ? COLOR.bad : COLOR.active, 2, y, Math.max(1, Math.round((iw - 4) * (e.status === 'done' ? 1 : (e.progress ?? 0.3)))), 2)
  }
}

function vcs(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#10171f', 0, 0, iw, ih)
  const n = Math.min(snap.tasks.filter((t) => t.status === 'done').length, Math.floor((iw - 6) / 4))
  f.r('#34405a', 2, Math.floor(ih / 2), iw - 4, 1)
  for (let i = 0; i < n; i++) {
    f.r('#52d674', 3 + i * 4, Math.floor(ih / 2) - 1, 3, 3)
    if (i % 3 === 2) f.r('#4fb2ff', 5 + i * 4, Math.floor(ih / 2) + 3, 3, 3)
  }
  f.r('#e0b341', 3, ih - 5, 4, 3)
}

function pipeline(f: Ink, iw: number, ih: number, snap: OfficeSnapshot, t: number): void {
  f.r('#0f1724', 0, 0, iw, ih)
  const tasks = of(snap, 'integration')
  const stages = ['merge', 'build', 'test', 'ship']
  const done = tasks.filter((x) => x.status === 'done').length
  const running = tasks.findIndex((x) => x.status === 'in_progress')
  const failed = tasks.some((x) => x.status === 'failed')
  const w = Math.floor((iw - 4) / stages.length)
  stages.forEach((_, i) => {
    const frac = tasks.length ? (i + 1) / stages.length : 2
    const doneStage = tasks.length > 0 && done / tasks.length >= frac
    const cur = !doneStage && running >= 0 && (i === 0 || done / tasks.length >= i / stages.length)
    const c = failed && cur ? COLOR.bad : doneStage ? COLOR.done : cur ? (Math.floor(t * 3) % 2 === 0 ? COLOR.review : '#8a6a20') : '#34405a'
    f.r(c, 2 + i * w, Math.floor(ih / 2) - 2, w - 2, 5)
    if (i < stages.length - 1) f.r('#7d879b', 2 + i * w + w - 2, Math.floor(ih / 2), 2, 1)
  })
}

function build(f: Ink, iw: number, ih: number, snap: OfficeSnapshot, t: number): void {
  const tasks = of(snap, 'integration')
  const c = tasks.some((x) => x.status === 'failed') ? COLOR.bad : tasks.some((x) => x.status === 'in_progress') ? (Math.floor(t * 3) % 2 === 0 ? COLOR.review : '#6a521a') : tasks.length > 0 && tasks.every((x) => x.status === 'done') ? COLOR.done : '#34405a'
  f.r('#0f1724', 0, 0, iw, ih)
  f.r(c, 2, 2, Math.max(2, iw - 4), Math.max(2, ih - 4))
}

function dashboard(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#f2f4f8', 0, 0, iw, ih)
  let row = 0
  for (const d of Object.values(DEPT)) {
    if (d.id === 'pm') continue
    const info = snap.departments[d.id]
    const y = ih - 3 - row * 3
    f.r('#cfd5e0', 4, y, iw - 6, 2)
    if (info.tasks > 0) f.r(d.color, 4, y, Math.max(1, Math.round(((iw - 6) * info.done) / info.tasks)), 2)
    f.r(d.color, 1, y, 2, 2)
    row += 1
  }
}

function milestone(f: Ink, iw: number, ih: number, snap: OfficeSnapshot): void {
  f.r('#0f1724', 0, 0, iw, ih)
  const total = Math.max(snap.pm.tasks, 1)
  const frac = snap.pm.done / total
  f.r('#243044', 3, Math.floor(ih / 2) - 2, iw - 6, 5)
  f.r(COLOR.done, 3, Math.floor(ih / 2) - 2, Math.round((iw - 6) * frac), 5)
  for (let i = 1; i <= 4; i++) {
    const x = 3 + Math.round(((iw - 6) * i) / 4) - 1
    f.r(frac >= i / 4 ? '#e0b341' : '#5a5478', x, Math.floor(ih / 2) + 4, 2, 5)
    f.r(frac >= i / 4 ? '#ffd166' : '#7d879b', x + 1, Math.floor(ih / 2) + 7, 4, 3)
  }
}

const PAINT: Record<string, Paint> = {
  level: (f, w, h, s) => level(f, w, h, s),
  diagram: (f, w, h, s) => diagram(f, w, h, s),
  concept: (f, w, h, s) => concept(f, w, h, s),
  reference: (f, w, h, s) => reference(f, w, h, s),
  animation,
  waveform,
  bugs: (f, w, h, s) => bugs(f, w, h, s),
  results: (f, w, h, s) => results(f, w, h, s),
  whiteboard: (f, w, h, s) => whiteboard(f, w, h, s),
  progress: (f, w, h, s) => progress(f, w, h, s),
  vcs: (f, w, h, s) => vcs(f, w, h, s),
  pipeline,
  build,
  dashboard: (f, w, h, s) => dashboard(f, w, h, s),
  milestone: (f, w, h, s) => milestone(f, w, h, s)
}

/** One board or screen as a depth-sorted item. */
function panelItem(p: Prop, snap: OfficeSnapshot, t: number): Item | null {
  const paint = p.content ? PAINT[p.content] : undefined
  if (!paint) return null
  const accent = accentOfRoom(p.room)
  const screen = p.kind === 'screen'
  const W = p.w * 16
  return {
    d: p.x + p.y + (p.w + p.h) / 2,
    o: 1,
    fn: (g: G) => {
      // contact shadow on the floor, then the legs, the frame and the field
      const sh = [toWorld(p.x + 0.05, p.y + 0.78), toWorld(p.x + p.w - 0.05, p.y + 0.78), toWorld(p.x + p.w - 0.05, p.y + 1.02), toWorld(p.x + 0.05, p.y + 1.02)]
      poly(g, sh, 'rgba(8,6,20,0.3)')
      const [ox, oy] = toWorld(p.x, p.y + 1)
      const f = new Face(g, Math.round(ox), Math.round(oy) - 3)
      f.r('#2b2740', 2, 0, 2, LEG)
      f.r('#2b2740', W - 4, 0, 2, LEG)
      f.r('#5a5478', 2, 0, 1, LEG)
      f.r('#5a5478', W - 4, 0, 1, LEG)
      f.r(shade(accent, 0.55), 0, LEG, W, HEIGHT)
      f.r(shade(accent, 0.8), 0, LEG + HEIGHT - 1, W, 1)
      f.r(shade(accent, 0.4), 0, LEG, W, 1)
      // the field sits 2 px in and 2 px up from the frame; an even shift keeps the slope of the rows aligned
      const field = new Face(g, Math.round(ox) + 2, Math.round(oy) - 3 + 1)
      const iw = W - 4
      const ih = HEIGHT - 4
      field.r(screen ? '#06090f' : '#fff', 0, LEG + 2, iw, ih)
      paint({ r: (c, i, j, w, h) => field.r(c, i, j + LEG + 2, w, h) }, iw, ih, snap, t, p)
    }
  }
}

export function panelItems(snap: OfficeSnapshot, t: number): Item[] {
  const out: Item[] = []
  for (const p of getLayout().props) {
    if (p.kind !== 'board' && p.kind !== 'screen') continue
    const it = panelItem(p, snap, t)
    if (it) out.push(it)
  }
  return out
}

export { COLOR as PANEL_COLOR }
