import { DEPARTMENTS } from './departments'
import { getLayout } from './layout'
import type { OfficeSnapshot } from './model'
import { Face, shade, type G } from './pixels'
import { toWorld } from './world'

/**
 * The three boards on the PM's back wall. They show the real state of the project (bars per department, kanban cards,
 * overall progress and whether the run is live). They are drawn on the wall face, so they are cut into one clipped slice
 * per wall tile and drawn with that tile: a person standing in front of the wall hides the right part of them.
 */

const FRAME = '#2b2740'
const FRAME_HI = '#5a5478'

function panel(g: G, span: [number, number], w: number, bg: string): Face {
  const o = toWorld(span[0], 1)
  const f = new Face(g, Math.round(o[0]), Math.round(o[1]))
  // wall shadow, frame, inner field
  f.r('rgba(10,8,25,0.28)', 2, 14, w + 4, 25)
  f.r(FRAME, 1, 15, w + 2, 25)
  f.r(FRAME_HI, 1, 39, w + 2, 1)
  f.r(bg, 2, 16, w, 23)
  f.r(shade(bg, 0.86), 2, 16, w, 1)
  return f
}

/** Draws the three boards (the caller clips to one wall tile). Heights are counted from the bottom of the wall. */
export function drawBoards(g: G, snap: OfficeSnapshot, t: number): void {
  const L = getLayout()
  // project board: one bar per department showing how much of its work is done
  const p = panel(g, L.pm.panels.project, 40, '#f2f4f8')
  let row = 0
  for (const d of DEPARTMENTS) {
    if (d.id === 'pm') continue
    const info = snap.departments[d.id]
    p.r('#cfd5e0', 4, 35 - row * 3, 36, 2)
    if (info.tasks > 0) p.r(d.color, 4, 35 - row * 3, Math.max(1, Math.round((36 * info.done) / info.tasks)), 2)
    p.r(d.color, 2, 35 - row * 3, 1, 2)
    row += 1
  }
  // kanban: five columns with a card per task (up to five)
  const k = panel(g, L.pm.panels.kanban, 56, '#e9ecf2')
  const k0 = snap.kanban
  const cols: Array<[string, number]> = [
    ['#9aa4b2', k0.todo],
    ['#4fb2ff', k0.in_progress],
    ['#f5b942', k0.review + k0.testing],
    ['#52d674', k0.done],
    ['#ff6b61', k0.failed + k0.blocked]
  ]
  cols.forEach(([c, n], i) => {
    const x = 4 + i * 10
    k.r(c, x, 36, 9, 2)
    for (let r = 0; r < Math.min(n, 5); r++) k.r(shade(c, 1.25), x, 32 - r * 3, 9, 2)
    if (n > 5) k.r(c, x + 3, 17, 3, 1)
  })
  // status screen: overall progress and the state of the run
  const s = panel(g, L.pm.panels.status, 40, '#0f1724')
  const total = k0.todo + k0.in_progress + k0.review + k0.testing + k0.done + k0.failed + k0.blocked
  s.r('#1f2a3d', 4, 22, 36, 5)
  s.r('#34405a', 4, 21, 36, 1)
  if (total > 0) s.r('#52d674', 4, 22, Math.max(1, Math.round((36 * k0.done) / total)), 5)
  const live = snap.pm.runStatus === 'running'
  const runColor = snap.pm.runStatus === 'failed' ? '#ff6b61' : snap.pm.runStatus === 'completed' ? '#4fb2ff' : live ? '#52d674' : '#6b7486'
  s.r(!live || Math.floor(t * 2) % 2 === 0 ? runColor : '#1f2a3d', 4, 32, 4, 4)
  s.r('#34405a', 10, 33, 20, 1)
  s.r('#34405a', 10, 35, 12, 1)
}
