import type { DeptId } from '../departments'

/**
 * Small hand-drawn pixel maps for the desks: monitor frames, what the screens show, and the things people keep on a desk.
 * Monitors are drawn flat (front elevation) and sheared onto the south-facing surface when stamped (see SouthFace).
 */
export type ScreenState = 'on' | 'idle' | 'err' | 'off'

/** A monitor with a bezel around `inner` (rows of the same width), on a short neck and foot. */
export function monitorRows(inner: string[]): string[] {
  const iw = inner[0].length
  const W = iw + 4
  const mid = Math.floor(W / 2)
  const rows: string[] = []
  rows.push('k'.repeat(W))
  rows.push(`k${'j'.repeat(W - 2)}k`)
  for (const r of inner) rows.push(`klj`.slice(0, 2) + r + 'lk')
  rows.push(`k${'l'.repeat(W - 2)}k`)
  rows.push('k'.repeat(W))
  rows.push('.'.repeat(mid - 1) + 'kjk' + '.'.repeat(W - mid - 2))
  rows.push('.'.repeat(mid - 2) + 'kjjjk' + '.'.repeat(W - mid - 3))
  return rows
}

const fill = (w: number, h: number, ch: string): string[] => Array.from({ length: h }, () => ch.repeat(w))
const setAt = (rows: string[], x: number, y: number, ch: string): void => {
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[y].length) return
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1)
}
const hline = (rows: string[], x: number, y: number, len: number, ch: string): void => {
  for (let i = 0; i < len; i++) setAt(rows, x + i, y, ch)
}

/** What a screen shows. `frame` moves things so a working screen is alive. */
export function screenContent(dept: DeptId, state: ScreenState, frame: number, w: number, h: number): string[] {
  if (state === 'off') {
    const r = fill(w, h, 'Z')
    setAt(r, 1, 1, 'l')
    setAt(r, 2, 1, 'l')
    return r
  }
  if (state === 'err') {
    const r = fill(w, h, 'D')
    hline(r, 1, 1, Math.max(2, w - 2), 'd')
    hline(r, 1, Math.floor(h / 2) + 1, Math.max(2, w - 4), 'd')
    if (frame % 2 === 0) setAt(r, w - 2, h - 2, 'w')
    return r
  }
  if (state === 'idle') {
    const r = fill(w, h, 'Z')
    hline(r, 1, Math.floor(h / 2), w - 2, 'l')
    hline(r, 1, Math.floor(h / 2) + 1, Math.max(1, w - 5), 'j')
    return r
  }
  const r = fill(w, h, 'Z')
  switch (dept) {
    case 'dev':
    case 'integration': {
      const cols = dept === 'dev' ? ['e', 'y', 'o', 'p', 'Y'] : ['e', 'e', 'y', 'h', 'e']
      for (let j = 0; j < h; j++) {
        const len = 2 + ((j * 5 + frame * 2 + (j >> 1) * 3) % Math.max(2, w - 2))
        hline(r, 1 + ((j + frame) % 3 === 0 ? 1 : 0), j, Math.min(len, w - 2), cols[(j * 3 + (frame >> 1)) % cols.length])
      }
      if (frame % 2 === 0) setAt(r, 1, h - 1, 'w')
      break
    }
    case 'art': {
      const cs = ['d', 'o', 'Y', 'f', 'z', 'p']
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setAt(r, i, j, cs[(i + j * 2 + (frame >> 1)) % cs.length])
      hline(r, 0, 0, w, 'c')
      break
    }
    case 'audio': {
      for (let i = 0; i < w; i++) {
        const a = 1 + Math.abs(Math.round(Math.sin((i + frame) * 0.9) * (h / 2 - 1)))
        for (let j = 0; j < a; j++) setAt(r, i, Math.floor(h / 2) - Math.floor(a / 2) + j, j === 0 ? 'e' : 'y')
      }
      break
    }
    case 'qa': {
      for (let j = 0; j < h; j += 2) {
        setAt(r, 1, j, (j / 2 + frame) % 3 === 2 ? 'd' : 'e')
        hline(r, 3, j, Math.max(2, w - 4 - ((j + frame) % 3)), 'h')
      }
      break
    }
    case 'gd': {
      for (const [x, y, c] of [[1, 1, 'Y'], [w - 4, 1, 'p'], [2, h - 3, 'z'], [w - 3, h - 3, 'e']] as const) {
        hline(r, x, y, 3, c)
        hline(r, x, y + 1, 3, c)
      }
      hline(r, 4, 2, Math.max(1, w - 8), 'h')
      break
    }
    default: {
      // pm: a little board
      for (let j = 0; j < h; j += 2) {
        hline(r, 1, j, 2, ['e', 'y', 'Y'][(j / 2 + frame) % 3])
        hline(r, 4, j, Math.max(1, w - 5), 'h')
      }
    }
  }
  return r
}

// ── things on a desk (flat, 1 px = 1 px) ─────────────────────────────────────────────────────────────────────────

export const MUG = ['kddk.', 'kddkk', 'kddk.', '.kkk.']
export const MUG_WHITE = ['kwwk.', 'kwwkk', 'kwwk.', '.kkk.']
export const LAMP = ['.kkkk.', 'kAAaak', '.kbbk.', '..kj..', '..kj..', '..kj..', '.kjjk.']
export const PEN_JAR = ['k.k.k', 'kdkYk', 'kjjjk', 'kjjjk', '.kkk.']
export const BOOKS = ['kdkk', 'kdvk', 'kYek', 'kkkk']
export const PHONE = ['kjk', 'kzk', 'kzk', 'kkk']
export const STICKY = ['Yp', 'pY']
export const HEADPHONES = ['.kkkk.', 'kj..jk', 'kA..Ak', 'kAkkAk']
export const CLIPBOARD = ['.kk.', 'kwwk', 'kdwk', 'kewk', 'kwwk', 'kkkk']
export const MINI_PLANT = ['.kfk.', 'kfefk', '.knk.', '.krk.', 'kRRRk']
export const MIXER = ['kkkkkkkk', 'kjdjYjzk', 'kjijijjk', 'kjijijjk', 'kkkkkkkk']
export const PALETTE_ART = ['.kkkk.', 'kdYozk', 'kpefvk', '.kkkk.']
export const DICE = ['kwk', 'kwk', 'kkk']
export const SERVER = [
  'kkkkkk',
  'kjjjjk',
  'kehkhk',
  'kjjjjk',
  'kehkhk',
  'kjjjjk',
  'kkkkkk'
]
export const TABLET_STYLUS = ['k', 'w', 'k']
export const PAPER_STACK = ['kkkkkk', 'kwwwck', 'kwhwck', 'kkkkkk']
export const NAMEPLATE = ['kYYYYk', 'kkkkkk']
