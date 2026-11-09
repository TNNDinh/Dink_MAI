import { getLayout } from './layout'
import type { Pt } from './pixels'
import type { Actor } from './sim'
import { WALL_H } from './assets/walls'

/** World geometry: one iso tile is 32 × 16 px, the world canvas is drawn at 1× and scaled by the view. */
export const BG = '#141826'
/** Space under the floor slab at the front and on the east side. */
export const SLAB = 7

export interface WorldInfo {
  w: number
  h: number
  ox: number
  oy: number
}

export const worldInfo = (): WorldInfo => {
  const L = getLayout()
  return { ox: L.h * 16 + 48, oy: WALL_H + 40, w: (L.w + L.h) * 16 + 96, h: (L.w + L.h) * 8 + WALL_H + 80 + SLAB }
}

/** World pixel of the north corner of tile (x, y) (fractions allowed). */
export const toWorld = (x: number, y: number): Pt => {
  const W = worldInfo()
  return [(x - y) * 16 + W.ox, (x + y) * 8 + W.oy]
}

export interface View {
  scale: number
  panX: number
  panY: number
}

export const MIN_SCALE = 0.5
export const MAX_SCALE = 4

export function fitView(width: number, height: number): View {
  const W = worldInfo()
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(width / W.w, height / W.h) * 0.98))
  return { scale, panX: (width - W.w * scale) / 2, panY: (height - W.h * scale) / 2 }
}

/** A view with the given tile in the middle of the screen. */
export function focusView(width: number, height: number, scale: number, tx: number, ty: number): View {
  const [wx, wy] = toWorld(tx + 0.5, ty + 0.5)
  return { scale, panX: width / 2 - wx * scale, panY: height / 2 - wy * scale }
}

/** Where an actor's feet are in the world (tile centre). */
export const feetOf = (a: Actor): Pt => toWorld(a.x + 0.5, a.y + 0.5)

export const toScreen = (view: View, wx: number, wy: number): Pt => [wx * view.scale + view.panX, wy * view.scale + view.panY]
