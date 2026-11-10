import type { Sprite } from '../pixels'
import { accentRamp, personPalette, type Look } from './palette'
import { bake, mergeLayers, px, type Layer, type Palette, type PixMap } from './pixmap'

/**
 * Character sprite sheet, built from layered pixel maps ("paper doll"): legs, torso, arms, head, hair, accessories.
 * Frame size 18×32, the feet stand on (9, 30). Views: F (towards the camera), B (away from it), E (facing east; west is
 * the mirror image), and FD / BD, the two diagonals the isometric grid really has: toward the camera and to the right (the
 * way an east-facing person looks on screen), and away from it and to the right (north). Their mirror images are south and
 * west. A diagonal turns the head, which is what shows where somebody looks in a 3/4 view. Walking has 4 frames per view,
 * sitting has a typing frame pair.
 */
export type View = 'F' | 'B' | 'E' | 'FD' | 'BD'
/** The views the body (torso, arms, legs) is drawn in: the diagonals reuse the body of the front and the back and turn the head. */
type Body = 'F' | 'B' | 'E'
const bodyOf = (v: View): Body => (v === 'FD' ? 'F' : v === 'BD' ? 'B' : v)
export type CharPose = 'stand' | 'walk' | 'sit'

export const CHAR_W = 18
export const CHAR_H = 32
export const FEET_X = 9
export const FEET_Y = 30

const m = (...rows: string[]): PixMap => px(0, 0, ...rows)

// ── heads ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const HEAD_BASE: Record<View, PixMap> = {
  F: m('...kkkk...', '..kssssk..', '.kssssssk.', '.kssssssk.', '.kskssksk.', '.kssssssk.', '.kssuussk.', '..kttttk..', '...kkkk...'),
  B: m('...kkkk...', '..kssssk..', '.kssssssk.', '.kssssssk.', '.kssssssk.', '.kssssssk.', '.kssssssk.', '..kttttk..', '...kkkk...'),
  E: m('...kkkk...', '..kssssk..', '.kssssssk.', '.kssssssk.', '.kssssksk.', '.kssssssst', '.kssssuuk.', '..kttttk..', '...kkkk...'),
  // 3/4 front, turned to the right: two eyes on the right half of the face, the nose pushed to the edge, an ear on the left
  FD: m('...kkkk...', '..kssssk..', '.kssssssk.', '.kssssssk.', '.kttskskk.', '.kttssssst', '.kssssuuk.', '..kttttk..', '...kkkk...'),
  // 3/4 from behind, turned to the right: the hair covers the head and a strip of cheek shows on the right
  BD: m('...kkkk...', '..kssssk..', '.kssssssk.', '.kssssssk.', '.kssssssk.', '.kssssssk.', '.kssssssk.', '..kttttk..', '...kkkk...')
}

interface HairMap {
  map: PixMap
  /** Rows above the head the map starts at. */
  up: number
}

const hair = (up: number, ...rows: string[]): HairMap => ({ map: m(...rows), up })

const HAIR_BASE: Record<Body, HairMap[]> = {
  F: [
    hair(0, '...kkkk...', '..kHHHHk..', '.kHIHHHHk.', '.kHH..HHk.', '.kH....Hk.'),
    hair(0, '...kkkk...', '..kHHHHk..', '.kHIHHHHk.', '.kHH..HHk.', '.kH....Hk.', '.kH....Hk.', '.kH....Hk.', '..kH..Hk..'),
    hair(0, '..kkkkkk..', '.kAAAaaak.', '.kAAaaaak.', 'kbbbbbbbbk', '.kH....Hk.'),
    hair(0, '...kkkk...', '..kJJJJk..', '.kJIJJJJk.', '.kJ....Jk.'),
    hair(1, '..kkkkkk..', '.kHIIHHHk.', 'kHHHHHHHHk', '.kHH..HHk.', '.kH....Hk.')
  ],
  B: [
    hair(0, '...kkkk...', '..kHHHHk..', '.kHIHHHHk.', '.kHHHHHHk.', '.kHHHHHHk.', '.kHHHHHHk.', '.kHJJJJHk.'),
    hair(0, '...kkkk...', '..kHHHHk..', '.kHIHHHHk.', '.kHHHHHHk.', '.kHHHHHHk.', '.kHHHHHHk.', '.kHHHHHHk.', '.kHJJJJHk.'),
    hair(0, '..kkkkkk..', '.kAAAaaak.', '.kAAaaaak.', 'kbbbbbbbbk', '.kHHHHHHk.', '.kHHHHHHk.', '.kHJJJJHk.'),
    hair(0, '...kkkk...', '..kJJJJk..', '.kJJJJJJk.', '.kJJJJJJk.', '.kJJJJJJk.', '.kJJJJJJk.'),
    hair(1, '..kkkkkk..', '.kHIIHHHk.', 'kHHHHHHHHk', '.kHHHHHHk.', '.kHHHHHHk.', '.kHHHHHHk.', '.kHJJJJHk.')
  ],
  E: [
    hair(0, '...kkkk...', '..kHHHHk..', '.kHHIHHHk.', '.kHHHH..k.', '.kHHH.....', '.kHH......', '.kHJ......'),
    hair(0, '...kkkk...', '..kHHHHk..', '.kHHIHHHk.', '.kHHHH..k.', '.kHHH.....', '.kHHH.....', '.kHHH.....', '.kHJJ.....', '..kJJ.....'),
    hair(0, '..kkkkkk..', '.kAAAaaak.', '.kAAaaabbb', '.kHHH..bbk', '.kHH......', '.kHH......'),
    hair(0, '...kkkk...', '..kJJJJk..', '.kJIJJJJk.', '.kJJJJ..k.', '.kJJ......'),
    hair(1, '..kkkkkk..', '.kHIIHHHk.', '.kHHHHHHHk', '.kHHHH..k.', '.kHHH.....', '.kHH......')
  ]
}

/** Seen from behind and turned right, the hair stops one column short on the two rows of the cheek, so a strip of skin shows. */
const cheek = (h: HairMap): HairMap => ({ up: h.up, map: m(...h.map.rows.map((r, i) => (i - h.up === 4 || i - h.up === 5 ? `${r.slice(0, 7)}.${r.slice(8)}` : r))) })

export const HAIR_MAPS: Record<View, HairMap[]> = { ...HAIR_BASE, FD: HAIR_BASE.E, BD: HAIR_BASE.B.map(cheek) }

const GLASSES: Record<View, PixMap | null> = {
  F: m('..........', '..........', '..........', '..jj..jj..', '..jkjjkj..', '..jj..jj..'),
  B: null,
  E: m('..........', '..........', '..........', '..........', '.....jkjj.', '..........'),
  FD: m('..........', '..........', '..........', '....jjjj..', '....jkjk..', '....jjjj..'),
  BD: null
}

/** Headphones (sound department). */
const PHONES: Record<View, PixMap> = {
  F: m('..........', '..........', '..kjjjjk..', '.kj....jk.', 'AA......aa', 'AA......aa', 'bb......bb'),
  B: m('..........', '..........', '..kjjjjk..', '.kj....jk.', 'AA......aa', 'AA......aa', 'bb......bb'),
  E: m('..........', '..........', '..kjjjjk..', '.kj.......', '..AAA.....', '..AAa.....', '..bbb.....'),
  FD: m('..........', '..........', '..kjjjjk..', '.kj.......', '..AAA.....', '..AAa.....', '..bbb.....'),
  BD: m('..........', '..........', '..kjjjjk..', '.kj....jk.', 'AA......aa', 'AA......aa', 'bb......bb')
}

// ── torso, arms, legs ───────────────────────────────────────────────────────────────────────────────────────────

const TORSO: Record<Body, PixMap> = {
  F: m('kSSttSTk', 'kSSSSTTk', 'kSSSSTTk', 'kSSSSTTk', 'kSSSSTUk', 'kSSTTTUk', 'kSTTTTUk', 'kQQQQQQk'),
  B: m('kSSSSSTk', 'kSSSSSTk', 'kSSSSTTk', 'kSSSSTTk', 'kSSSSTUk', 'kSSTTTUk', 'kSTTTTUk', 'kQQQQQQk'),
  E: m('.kSSSSSk', '.kSSSSTk', '.kSSSTTk', '.kSSSTTk', '.kSSSTUk', '.kSSTTUk', '.kSTTTUk', '.kQQQQQk')
}

/** Things worn on the torso, by department. */
const OUTFIT: Record<string, Partial<Record<Body, PixMap>>> = {
  pm: {
    F: m('kwwttwwk', '...dd...', '...dd...', '...dd...', '...Dd...', '........', '........', '........'),
    B: m('kYYYYYYk', '........', '........', '........', '........', '........', '........', '........'),
    E: m('........', '...dd...', '...dd...', '...Dd...', '........', '........', '........', '........')
  },
  dev: {
    F: m('.TTTTTT.', '..w..w..', '..w..w..', '........', '........', '.UUUUUU.', '.UkUUkU.', '........'),
    B: m('.TTTTTT.', '.TTTTTT.', '........', '........', '........', '........', '........', '........'),
    E: m('........', '........', '........', '........', '........', '..UUUU..', '........', '........')
  },
  art: {
    F: m('........', '..c..c..', '..c..c..', '.cccccc.', '.cccccc.', '.cccccc.', '.ccAAcc.', '........'),
    B: m('........', '..c..c..', '........', '........', '........', '........', '........', '........'),
    E: m('........', '........', '...cc...', '...ccc..', '...ccc..', '...ccc..', '........', '........')
  },
  qa: {
    F: m('..d..d..', '..d..d..', '...dd...', '...ww...', '...wk...', '........', '........', '........'),
    B: m('..d..d..', '........', '........', '........', '........', '........', '........', '........'),
    E: m('........', '........', '...d....', '...w....', '........', '........', '........', '........')
  }
}

const ARM_L: PixMap = m('kS', 'kS', 'kT', 'kT', 'ks', 'kt')
const ARM_R: PixMap = m('Uk', 'Uk', 'Uk', 'Uk', 'tk', 'tk')
const ARM_E: PixMap = m('Sk', 'Tk', 'Tk', 'Tk', 'sk', 'tk')
/** Seen from the side and seated at the keyboard: the upper arm hangs, the forearm reaches forward (toward the desk) and the hand rests on it. */
const ARM_E_SIT: PixMap = m('Sk..', 'TTTk', '.sst')
/** Seated at the keyboard, seen from the front or the back: the forearms are forward, so only a short stub shows. */
const ARM_L_SIT: PixMap = m('kS', 'kT', 'ks')
const ARM_R_SIT: PixMap = m('Uk', 'Uk', 'tk')

const LEGS_F: PixMap[] = [
  m('kPPPPQQk', 'kPPPPQQk', 'kPPkkQQk', 'kPPkkQQk', 'kPPkkQQk', 'kPPkkQQk', 'kOOkkOOk', 'kOOkkOOk'),
  m('kPPPPQQk', 'kPPPPQQk', 'kPPkkQQk', 'kOOkkQQk', 'kOOkkQQk', '.kkkkQQk', '....kOOk', '....kOOk'),
  m('kPPPPQQk', 'kPPPPQQk', 'kPPkkQQk', 'kPPkkQQk', 'kPPkkQQk', 'kPPkkQQk', 'kOOkkOOk', 'kOOkkOOk'),
  m('kPPPPQQk', 'kPPPPQQk', 'kPPkkQQk', 'kPPkkOOk', 'kPPkkOOk', 'kPPkk.kk', 'kOOk....', 'kOOk....')
]

const LEGS_E: PixMap[] = [
  m('.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kOOOOOk', '..kkkkk.'),
  m('........', '..kPPQk.', '.kPPkQQk', '.kPPkQQk', 'kPPk.kQk', 'kPPk.kQk', 'kOOk.kOO', 'kkkk.kkk'),
  m('.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kPPPQk.', '.kOOOOOk', '..kkkkk.'),
  m('........', '..kPPQk.', '.kQQkPPk', '.kQQkPPk', 'kQQk.kPk', 'kQQk.kPk', 'kOOk.kOO', 'kkkk.kkk')
]

const SIT_LEGS: Record<Body, PixMap> = {
  B: m('kPPPPPPk', '.kQQQQk.'),
  F: m('kPPPPQQk', 'kPPkkQQk', 'kPPkkQQk', 'kOOkkOOk'),
  E: m('kPPPPPPk', 'kPPQQQkk', '..kOOOk.')
}

// ── assembling a frame ──────────────────────────────────────────────────────────────────────────────────────────

const HEAD_X = 4
const HEAD_Y = 5
const TORSO_X = 5
const TORSO_Y = 14
const LEGS_Y = 22

export interface CharFrame {
  view: View
  pose: CharPose
  /** Walk frame 0–3 or typing frame 0–1. */
  frame: number
}

const accessoryOf = (dept: string): string => (dept === 'gd' ? 'none' : dept)

export function personMap(look: Look, dept: string, accent: string, role: 'staff' | 'pm', f: CharFrame): { map: PixMap; pal: Palette } {
  const pal = personPalette(look, accent, role)
  const layers: Layer[] = []
  const view = f.view
  const body = bodyOf(view)
  const walk = f.pose === 'walk'
  const sit = f.pose === 'sit'
  const fr = f.frame % 4
  const swing = walk ? [0, -1, 0, 1][fr] : 0
  const typing = sit ? f.frame % 2 : 0

  // legs
  if (sit) layers.push({ map: SIT_LEGS[body], pal, x: TORSO_X, y: LEGS_Y })
  else layers.push({ map: body === 'E' ? LEGS_E[walk ? fr : 0] : LEGS_F[walk ? fr : 0], pal, x: TORSO_X, y: LEGS_Y })
  // far arm first for the side view, torso, then the near arm(s)
  layers.push({ map: TORSO[body], pal, x: TORSO_X, y: TORSO_Y })
  const outfit = OUTFIT[role === 'pm' ? 'pm' : accessoryOf(dept)]?.[body]
  if (outfit) layers.push({ map: outfit, pal: { ...pal, ...accentPal(accent) }, x: TORSO_X, y: TORSO_Y })
  if (body === 'E') {
    layers.push({ map: sit ? ARM_E_SIT : ARM_E, pal, x: TORSO_X + 3, y: TORSO_Y + 2 + (sit ? typing : swing - 1) })
  } else if (sit) {
    layers.push({ map: ARM_L_SIT, pal, x: TORSO_X - 2, y: TORSO_Y + 1 - typing })
    layers.push({ map: ARM_R_SIT, pal, x: TORSO_X + 8, y: TORSO_Y + 1 + typing - 1 })
  } else {
    layers.push({ map: ARM_L, pal, x: TORSO_X - 2, y: TORSO_Y + 1 + swing })
    layers.push({ map: ARM_R, pal, x: TORSO_X + 8, y: TORSO_Y + 1 - swing })
  }
  // head
  const bob = walk && (fr === 1 || fr === 3) ? 1 : 0
  const headY = HEAD_Y + bob
  layers.push({ map: HEAD_BASE[view], pal, x: HEAD_X, y: headY })
  const style = HAIR_MAPS[view][look.style % HAIR_MAPS[view].length]
  layers.push({ map: style.map, pal: { ...pal, ...accentPal(accent) }, x: HEAD_X, y: headY - style.up })
  const gl = GLASSES[view]
  if (look.glasses && gl) layers.push({ map: gl, pal, x: HEAD_X, y: headY })
  if (role === 'staff' && dept === 'audio') layers.push({ map: PHONES[view], pal: { ...pal, ...accentPal(accent) }, x: HEAD_X, y: headY })
  if (role === 'pm') layers.push({ map: CROWN[view], pal, x: HEAD_X, y: headY - 2 })
  return mergeLayers(CHAR_W, CHAR_H, FEET_X, FEET_Y, layers)
}

export function personSprite(look: Look, dept: string, accent: string, role: 'staff' | 'pm', f: CharFrame, flip: boolean): Sprite {
  const key = `person:${dept}:${accent}:${role}:${look.skin}.${look.hair}.${look.style}.${look.glasses ? 1 : 0}.${look.pants}.${look.tone}:${f.view}:${f.pose}:${f.frame}`
  const hit = spriteCache.get(key)
  const { map, pal } = hit ?? personMap(look, dept, accent, role, f)
  if (!hit) spriteCache.set(key, { map, pal })
  return bake(key, map, pal, flip)
}

const spriteCache = new Map<string, { map: PixMap; pal: Palette }>()

const accentPal = accentRamp

/** A small gold circlet so the PM is never mistaken for somebody else. */
const CROWN: Record<View, PixMap> = {
  F: m('..Y.YY.Y..', '..YYYYYY..'),
  B: m('..Y.YY.Y..', '..YYYYYY..'),
  E: m('..Y.YY.Y..', '..YYYYYY..'),
  FD: m('..Y.YY.Y..', '..YYYYYY..'),
  BD: m('..Y.YY.Y..', '..YYYYYY..')
}

export const CHARACTER_MAPS: Record<string, PixMap> = {
  ...Object.fromEntries((['F', 'B', 'E', 'FD', 'BD'] as View[]).map((v) => [`headbase.${v}`, HEAD_BASE[v]])),
  ...Object.fromEntries((['F', 'B', 'E', 'FD', 'BD'] as View[]).flatMap((v) => HAIR_MAPS[v].map((h, i) => [`hair.${v}.${i}`, h.map]))),
  ...Object.fromEntries((['F', 'B', 'E'] as Body[]).map((v) => [`torso.${v}`, TORSO[v]])),
  ...Object.fromEntries(LEGS_F.map((l, i) => [`legs.F.${i}`, l])),
  ...Object.fromEntries(LEGS_E.map((l, i) => [`legs.E.${i}`, l])),
  ...Object.fromEntries((['F', 'B', 'E'] as Body[]).map((v) => [`sitlegs.${v}`, SIT_LEGS[v]])),
  ...Object.fromEntries((['F', 'B', 'E', 'FD', 'BD'] as View[]).map((v) => [`phones.${v}`, PHONES[v]])),
  arm_l: ARM_L,
  arm_r: ARM_R,
  arm_e: ARM_E,
  arm_e_sit: ARM_E_SIT
}

export const OUTFIT_MAPS: Record<string, PixMap> = Object.fromEntries(
  Object.entries(OUTFIT).flatMap(([k, v]) => Object.entries(v).map(([view, map]) => [`outfit.${k}.${view}`, map as PixMap]))
)
