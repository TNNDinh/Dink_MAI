import type { DeptId } from '../departments'
import { Elev } from './elev'

/**
 * Wall pieces drawn as flat elevations: windows, clocks and one picture wall per department (the room's identity).
 * Characters come from the studio palette (see palette.ts); M N E are the wall paint.
 */

const pick = (a: number, b: number, n: number): number => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) % n
}

const CLOUD = ['..ww..', '.wwwww', 'wwwwwg']
const SKYLINE: Array<[number, number]> = [[0, 5], [3, 8], [6, 4], [9, 9], [12, 6], [15, 10], [18, 5], [21, 7]]

export type WindowStyle = 'open' | 'blinds' | 'slats'

/** A window at (i, j) of size w × h: white frame, sky, skyline, glare, sill. */
export function drawWindow(e: Elev, i: number, j: number, w: number, h: number, style: WindowStyle = 'open'): void {
  e.r('k', i - 1, j - 1, w + 2, h + 2)
  e.r('g', i, j, w, h)
  e.r('h', i, j, w, 1)
  e.r('h', i + w - 1, j, 1, h)
  const gi = i + 2
  const gj = j + 2
  const gw = w - 4
  const gh = h - 4
  e.r('v', gi, gj, gw, gh)
  e.r('z', gi, gj, gw, Math.floor(gh * 0.62))
  e.r('y', gi, gj, gw, Math.floor(gh * 0.3))
  // skyline: two layers of buildings, the nearer ones darker, with lit windows
  for (const [x0, bh] of SKYLINE) {
    const bx = gi + ((x0 * gw) / 24) | 0
    const bw = Math.max(3, Math.floor(gw / 8))
    e.r('V', bx, gj, Math.min(bw, gi + gw - bx), Math.floor(bh * 0.7) + 1)
    if (bh > 6) e.p('Y', bx + 1, gj + Math.floor(bh * 0.5))
  }
  for (const [x0, bh] of [[1, 4], [5, 6], [10, 3], [14, 5], [19, 4]] as const) {
    const bx = gi + ((x0 * gw) / 24) | 0
    e.r('l', bx, gj, Math.min(4, gi + gw - bx), bh)
    e.p('Y', bx + 1, gj + 2)
  }
  e.stamp(CLOUD, gi + 3, gj + gh - 5)
  e.stamp(CLOUD, gi + gw - 10, gj + gh - 8)
  // mullions
  e.r('g', gi + (gw >> 1) - 1, gj, 2, gh)
  e.r('h', gi + (gw >> 1), gj, 1, gh)
  e.r('g', gi, gj + Math.floor(gh * 0.62), gw, 1)
  // glare
  for (let t = 0; t < 5; t++) e.p('w', gi + 2 + t, gj + gh - 3 - t)
  for (let t = 0; t < 3; t++) e.p('w', gi + 9 + t, gj + gh - 3 - t)
  if (style === 'blinds') {
    for (let t = 0; t < Math.floor(gh * 0.55); t += 2) {
      e.r('h', gi, gj + gh - 1 - t, gw, 1)
      e.r('i', gi, gj + gh - 2 - t, gw, 1)
    }
    e.r('j', gi, gj + gh - 1 - Math.floor(gh * 0.55), gw, 1)
  }
  if (style === 'slats') {
    for (let t = 0; t < gh; t += 3) e.r('i', gi, gj + t, gw, 1)
  }
  // sill with a little shadow under it
  e.r('c', i - 2, j - 2, w + 4, 2)
  e.r('w', i - 2, j - 1, w + 4, 1)
  e.r('C', i - 2, j - 3, w + 4, 1)
}

export function drawClock(e: Elev, i: number, j: number): void {
  e.stamp(
    [
      '..kkkkkk..',
      '.kwwwwwwk.',
      'kwwwwkwwwk',
      'kwwwwkwwwk',
      'kwwwwkkwwk',
      'kwwwwwwwwk',
      'kwwwwwwwwk',
      '.kwwwwwwk.',
      '..kkkkkk..'
    ],
    i,
    j
  )
}

/** A wall lamp: small shade and a warm glow painted on the wall around it. */
export function drawSconce(e: Elev, i: number, j: number, glow = true): void {
  if (glow) {
    e.r('E', i - 4, j - 4, 11, 12)
    e.r('W', i - 3, j - 3, 9, 10)
  }
  e.stamp(['.kkkkk.', 'kAAAAAk', '.kaaak.', '..kkk..'], i, j + 2)
  e.r('k', i + 3, j + 1, 1, 2)
}

const mat = (e: Elev, i: number, j: number, w: number, h: number): void => {
  e.r('k', i, j, w, h)
  e.r('4', i + 1, j + 1, w - 2, h - 2)
  e.r('3', i + 1, j + h - 2, w - 2, 1)
}

/** The picture wall of a department. Area: 44 × 22 starting at (i, j). */
export function drawDecor(e: Elev, dept: DeptId, i: number, j: number): void {
  switch (dept) {
    case 'gd': {
      // pinboard: index cards, red string and a flow of sticky notes
      mat(e, i, j, 44, 22)
      e.r('1', i + 2, j + 2, 40, 18)
      for (let x = 0; x < 40; x++) for (let y = 0; y < 18; y++) if (pick(x, y, 9) === 0) e.p('2', i + 2 + x, j + 2 + y)
      const cards: Array<[number, number, number, number, string]> = [
        [4, 11, 9, 6, 'w'],
        [17, 12, 9, 6, 'Y'],
        [30, 11, 9, 6, 'p'],
        [10, 3, 9, 6, 'y'],
        [24, 3, 9, 6, 'w']
      ]
      cards.forEach(([x, y, w, h, c], k) => {
        e.r('x', i + 2 + x + 1, j + 2 + y - 1, w, h)
        e.r(c, i + 2 + x, j + 2 + y, w, h)
        e.r('k', i + 2 + x + 2, j + 2 + y + h - 3, w - 4, 1)
        e.r('k', i + 2 + x + 2, j + 2 + y + h - 5, Math.max(2, w - 6 - (k % 3)), 1)
        e.p('d', i + 2 + x + (w >> 1), j + 2 + y + h - 1)
      })
      for (const [x0, y0, x1, y1] of [[8, 14, 17, 14], [21, 14, 30, 14], [14, 11, 14, 9], [28, 11, 28, 9]] as const) {
        for (let t = 0; t <= Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); t++) {
          e.p('D', i + 2 + x0 + Math.round(((x1 - x0) * t) / Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))), j + 2 + y0 + Math.round(((y1 - y0) * t) / Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))))
        }
      }
      return
    }
    case 'art': {
      // three framed pieces: a sunset, an abstract, a portrait
      const frame = (x: number, y: number, w: number, h: number): void => {
        e.r('k', i + x, j + y, w, h)
        e.r('2', i + x + 1, j + y + 1, w - 2, h - 2)
        e.r('w', i + x + 2, j + y + 2, w - 4, h - 4)
      }
      frame(1, 1, 16, 20)
      e.r('o', i + 5, j + 12, 8, 7)
      e.r('Y', i + 5, j + 9, 8, 3)
      e.r('d', i + 5, j + 14, 8, 1)
      e.stamp(['..YY..', '.YYYY.', '..YY..'], i + 7, j + 13)
      e.r('m', i + 5, j + 5, 8, 4)
      e.r('n', i + 5, j + 5, 8, 2)
      frame(18, 5, 14, 14)
      e.r('v', i + 21, j + 8, 4, 4)
      e.r('d', i + 25, j + 8, 4, 8)
      e.r('Y', i + 21, j + 12, 4, 4)
      e.r('z', i + 21, j + 16, 8, 1)
      e.r('k', i + 24, j + 7, 1, 9)
      frame(33, 2, 11, 18)
      e.r('W', i + 37, j + 10, 4, 5)
      e.r('R', i + 36, j + 14, 6, 3)
      e.r('k', i + 38, j + 12, 1, 1)
      e.r('k', i + 40, j + 12, 1, 1)
      e.r('z', i + 36, j + 5, 6, 4)
      return
    }
    case 'audio': {
      // acoustic foam panels around a lit waveform screen
      const foam = (x: number): void => {
        e.r('k', i + x, j, 12, 22)
        e.r('l', i + x + 1, j + 1, 10, 20)
        for (let y = 0; y < 20; y += 4) {
          for (let c = 0; c < 10; c++) {
            e.p((c + y) % 4 < 2 ? 'j' : 'K', i + x + 1 + c, j + 1 + y)
            e.p((c + y) % 4 < 2 ? 'i' : 'l', i + x + 1 + c, j + 2 + y)
            e.p('K', i + x + 1 + c, j + 3 + y)
          }
        }
      }
      foam(0)
      foam(32)
      e.r('k', i + 13, j + 2, 18, 18)
      e.r('Z', i + 14, j + 3, 16, 16)
      for (let c = 0; c < 14; c++) {
        const a = 1 + Math.abs(Math.round(Math.sin(c * 0.8) * 5 + Math.cos(c * 0.37) * 2))
        e.r(c % 3 === 0 ? 'y' : 'e', i + 15 + c, j + 11 - (a >> 1), 1, a)
      }
      e.r('Z', i + 15, j + 4, 4, 1)
      e.r('d', i + 15, j + 4, 2, 1)
      e.r('l', i + 14, j + 3, 16, 1)
      return
    }
    case 'dev': {
      // a status dashboard: code, a graph, build lights
      e.r('k', i, j, 44, 22)
      e.r('l', i + 1, j + 1, 42, 20)
      e.r('Z', i + 3, j + 3, 38, 16)
      const cols = ['e', 'y', 'o', 'p']
      for (let r = 0; r < 6; r++) e.r(cols[(r * 3) % 4], i + 5 + ((r * 5) % 3) * 2, j + 16 - r * 2, 5 + ((r * 7) % 10), 1)
      e.r('h', i + 25, j + 4, 1, 14)
      e.r('h', i + 25, j + 4, 14, 1)
      const pts = [3, 5, 4, 8, 7, 11, 9, 12]
      pts.forEach((v, k) => {
        e.r('e', i + 26 + k * 2, j + 5, 1, v)
        e.p('Y', i + 26 + k * 2, j + 5 + v)
      })
      e.r('e', i + 36, j + 16, 2, 2)
      e.r('Y', i + 33, j + 16, 2, 2)
      e.r('d', i + 30, j + 16, 2, 2)
      e.r('i', i + 18, j + 1, 8, 1)
      return
    }
    case 'qa': {
      // whiteboard with a test checklist and a bug
      e.r('k', i, j, 44, 22)
      e.r('i', i + 1, j + 1, 42, 20)
      e.r('w', i + 2, j + 3, 40, 17)
      e.r('g', i + 2, j + 19, 40, 1)
      e.r('c', i + 2, j + 3, 40, 1)
      for (let r = 0; r < 4; r++) {
        const y = j + 15 - r * 4
        e.frame('k', i + 5, y, 3, 3)
        if (r < 3) e.stamp(['..e', 'e.e', '.e.'], i + 5, y)
        else e.stamp(['d.d', '.d.', 'd.d'], i + 5, y)
        e.r(r === 3 ? 'd' : 'h', i + 10, y + 1, 14 + ((r * 5) % 7), 1)
      }
      e.stamp(['.k..k.', '..kk..', '.dddd.', 'kddddk', '.dddd.', 'k.dd.k'], i + 32, j + 9)
      e.r('i', i + 4, j + 1, 22, 2)
      for (const [x, c] of [[6, 'd'], [9, 'v'], [12, 'e']] as const) e.r(c, i + x, j + 2, 2, 1)
      return
    }
    case 'integration': {
      // pipeline diagram on a wall screen
      e.r('k', i, j, 44, 22)
      e.r('l', i + 1, j + 1, 42, 20)
      e.r('Z', i + 3, j + 3, 38, 16)
      const nodes: Array<[number, string]> = [[5, 'z'], [18, 'v'], [31, 'e']]
      nodes.forEach(([x, c], k) => {
        e.r('k', i + x - 1, j + 8, 9, 7)
        e.r(c, i + x, j + 9, 7, 5)
        e.r('w', i + x + 1, j + 12, 3, 1)
        if (k < 2) {
          e.r('y', i + x + 8, j + 11, 5, 1)
          e.p('y', i + x + 11, j + 12)
          e.p('y', i + x + 11, j + 10)
        }
      })
      e.r('e', i + 5, j + 5, 22, 1)
      e.r('h', i + 27, j + 5, 9, 1)
      for (let k = 0; k < 4; k++) e.r(k < 3 ? 'e' : 'Y', i + 5 + k * 3, j + 16, 2, 1)
      return
    }
    default:
      return
  }
}
