import { DEPT, type DeptId } from './departments'
import { HAIR_MAPS, personSprite, type CharPose, type View as CharView } from './assets/characters'
import { FURNITURE_MAPS, chairBackMap, chairSeatMap, deskMap, pmDeskMap } from './assets/furniture'
import { STUDIO_MAPS } from './assets/studio'
import { BASE, accentRamp, type Look } from './assets/palette'
import { bake, px, type Palette, type PixMap } from './assets/pixmap'
import type { ScreenState } from './assets/props'
import type { Sprite } from './pixels'
import type { Dir } from './blueprint'

/** Baked sprites of the office: every one comes from a pixel map of the asset pipeline (assets/*), nothing is drawn with shapes. */

const pals = new Map<string, Palette>()
export const palOf = (accent: string): Palette => {
  let p = pals.get(accent)
  if (!p) {
    p = { ...BASE, ...accentRamp(accent) }
    pals.set(accent, p)
  }
  return p
}

const baked = new Map<string, Sprite>()
function lazy(key: string, make: () => PixMap, accent: string, flip = false): Sprite {
  const k = flip ? `${key}:f` : key
  let s = baked.get(k)
  if (!s) {
    s = bake(key, make(), palOf(accent), flip)
    baked.set(k, s)
  }
  return s
}

export const PM_ACCENT = '#e0b341'
export const PM_CHAIR = '#3d4f86'

/** The desk of a workstation whose person looks toward `face`; the screen, keyboard and drawers are turned with it. */
export const deskSprite = (dept: DeptId, state: ScreenState, frame: number, face: Dir = 'N'): Sprite => lazy(`desk:${dept}:${state}:${frame}:${face}`, () => deskMap(dept, state, frame, face), DEPT[dept].color)
export const pmDeskSprite = (state: ScreenState, frame: number): Sprite => lazy(`pmdesk:${state}:${frame}`, () => pmDeskMap(state, frame), PM_ACCENT)
export const chairSeat = (accent: string): Sprite => lazy(`chair.seat:${accent}`, chairSeatMap, accent)
export const chairBack = (accent: string, face: Dir = 'N'): Sprite => lazy(`chair.back:${accent}:${face}`, () => chairBackMap(face), accent)

/** A piece of furniture from the asset table, in the accent of a department (only some pieces use it). */
export const furniture = (name: string, accent = '#5b9bf0'): Sprite => lazy(`f:${name}:${accent}`, () => FURNITURE_MAPS[name] ?? STUDIO_MAPS[name], accent)

// ── small things that are not furniture ──────────────────────────────────────────────────────────────────────────

const DOC: PixMap = px(3, 8, 'kkkkkk.', 'kwwwwkk', 'kwhhhwk', 'kwwwwwk', 'kwhhhhk', 'kwwwwwk', 'kwhhwwk', 'kwwwwwk', 'kkkkkkk')
export const docSprite = (): Sprite => lazy('doc', () => DOC, '#ffffff')

/** Soft contact shadow under somebody who stands or walks. */
const SHADOW: PixMap = px(6, 2, '...xxxxxx...', '.xxxxxxxxxx.', '.xxxxxxxxxx.', '...xxxxxx...')
export const shadowSprite = (): Sprite => lazy('shadow', () => SHADOW, '#ffffff')

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A person's looks from the number the data gives them (the same number always gives the same person). */
export function lookOf(look: number): Look {
  const k = Math.abs(Math.trunc(look))
  return {
    skin: (k * 3 + (k >> 3)) % 5,
    hair: (k * 5 + (k >> 2)) % 8,
    style: (k * 7 + (k >> 3)) % HAIR_MAPS.F.length,
    glasses: (k * 11) % 4 === 0,
    pants: (k * 13) % 4,
    tone: k % 3
  }
}

export const PM_LOOK: Look = { skin: 1, hair: 4, style: 0, glasses: true, pants: 0, tone: 0 }

export type Facing = 'N' | 'S' | 'E' | 'W'

/** Which drawing of a person to use for the direction they face: seen from the front, the back or the side (west is the east drawing mirrored). */
export const viewOf = (dir: Facing): { view: CharView; flip: boolean } => {
  switch (dir) {
    case 'S':
      return { view: 'F', flip: false }
    case 'N':
      return { view: 'B', flip: false }
    case 'E':
      return { view: 'E', flip: false }
    default:
      return { view: 'E', flip: true }
  }
}

export function person(look: Look, dept: DeptId, role: 'staff' | 'pm', dir: Facing, pose: CharPose, frame: number): Sprite {
  const { view, flip } = viewOf(dir)
  const accent = role === 'pm' ? PM_ACCENT : DEPT[dept].color
  return personSprite(look, dept, accent, role, { view, pose, frame }, flip)
}
