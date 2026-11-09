import { shade } from '../pixels'
import type { Palette } from './pixmap'

/**
 * The studio palette. One character = one colour role, so every pixel map in the office shares the same colours and the
 * same light (from the upper left: highlights on top and west edges, shadow on the south/east faces).
 *
 *  k K outline (hard / soft)       1 2 3 4 wood  light→dark          g h i j l metal light→dark
 *  A a b B department accent       n m f e plant dark→light          r R terracotta
 *  s t u skin   H I J hair         S T U shirt   P Q trousers        O shoes
 *  w c paper/cream                 y z Z screen glow / mid / off     q glass   x soft shadow
 */
export const BASE: Palette = {
  k: '#1b1824',
  K: '#2d2a3a',
  W: '#f3d3a0',
  '1': '#e0b27a',
  '2': '#bd8650',
  '3': '#8d6139',
  '4': '#5c3d22',
  g: '#eef1f7',
  h: '#c0c7d4',
  i: '#8d96aa',
  j: '#5d667b',
  l: '#363d50',
  w: '#fbfaf4',
  c: '#e6dcc4',
  C: '#b9ad8f',
  n: '#2f7d41',
  m: '#215f33',
  f: '#4cae5a',
  e: '#86d98d',
  r: '#cf7a52',
  R: '#9c533a',
  y: '#9be8ff',
  z: '#3fa6e8',
  Z: '#0e1522',
  d: '#e5675d',
  D: '#a8403f',
  Y: '#f6d44e',
  o: '#f09a45',
  v: '#5b9bf0',
  V: '#3b66b8',
  p: '#f08fb8',
  q: 'rgba(176,224,244,0.42)',
  Q: 'rgba(214,240,252,0.7)',
  x: 'rgba(8,6,20,0.26)',
  O: '#1f1c28',
  P: '#364565',
  L: '#26304a'
}

export function accentRamp(color: string): Palette {
  return { A: shade(color, 1.42), a: color, b: shade(color, 0.72), B: shade(color, 0.5) }
}

export const SKIN: Array<[string, string, string]> = [
  ['#f8d4b3', '#eab68f', '#c98c68'],
  ['#efc096', '#dc9f74', '#b97a55'],
  ['#d79d70', '#bd7d54', '#97603f'],
  ['#b27650', '#935a3b', '#6f432b'],
  ['#8a5a3c', '#6f4430', '#52311f']
]

export const HAIR: Array<[string, string, string]> = [
  ['#5b4a3c', '#352a21', '#1e1713'],
  ['#9a6a3e', '#6f4727', '#46291a'],
  ['#d8a14e', '#b17c33', '#855a22'],
  ['#e6c987', '#c8a55c', '#9c7c3e'],
  ['#b4b9c4', '#8b919f', '#626877'],
  ['#d2584a', '#a53b32', '#742621'],
  ['#6a4fa3', '#4b367e', '#322356'],
  ['#3a3f4e', '#242836', '#14161e']
]

export const PANTS: Array<[string, string]> = [
  ['#46557a', '#2e3a58'],
  ['#5b5650', '#3c3935'],
  ['#4e6a63', '#324a43'],
  ['#6b5a4a', '#46392d']
]

export interface Look {
  skin: number
  hair: number
  style: number
  glasses: boolean
  pants: number
  /** Shirt tone relative to the department accent. */
  tone: number
}

/** Full palette of one person. */
export function personPalette(look: Look, accent: string, role: 'staff' | 'pm'): Palette {
  const sk = SKIN[look.skin % SKIN.length]
  const hr = HAIR[look.hair % HAIR.length]
  const pn = PANTS[look.pants % PANTS.length]
  const tone = [1, 0.84, 1.18][look.tone % 3]
  const base = role === 'pm' ? '#2a3558' : shade(accent, tone)
  return {
    ...BASE,
    s: sk[0],
    t: sk[1],
    u: sk[2],
    H: hr[0],
    I: hr[1],
    J: hr[2],
    S: shade(base, 1.22),
    T: base,
    U: shade(base, 0.7),
    P: pn[0],
    Q: pn[1]
  }
}
