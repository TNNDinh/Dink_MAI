import { EastFace, Grid, IP, SouthFace, groundShadow, isoBox, isoFlat, type Material, type Pt } from './iso'
import type { PixMap } from './pixmap'
import { WHITE } from './furniture'

/**
 * The furniture only the studio's departments have: server racks, the mixing console, the recording booth, studio
 * speakers, an easel, the device test bench, the sound library shelves and the round discussion table. Same method as
 * furniture.ts: an iso shell, then details written as rows of palette characters, then an outline.
 */

const DARK: Material = { top: 'j', south: 'l', east: 'K', rim: 'i', edge: 'i', corner: 'k' }
const FOAM: Material = { top: 'j', south: 'l', east: 'K', rim: 'i', edge: 'j', corner: 'k' }

// ── server rack (1 × 1) ──────────────────────────────────────────────────────────────────────────────────────────────

export function rackMap(frame = 0): PixMap {
  const g = new Grid(32, 62)
  const ax = 16
  const ay = 44
  groundShadow(g, ax, ay, 0.1, 0.1, 0.92, 0.92, 3, 2)
  isoBox(g, ax, ay, 0.1, 0.1, 0.9, 0.9, 0, 38, { top: 'i', south: 'l', east: 'j', rim: 'h', edge: 'h', corner: 'k' })
  // the front looks east: six rack units with their lights
  const f = new EastFace(g, ...IP(ax, ay, 0.9, 0.9, 0))
  f.r('K', 1, 1, 11, 35)
  for (let r = 0; r < 6; r++) {
    const y = 2 + r * 5
    f.r('j', 1, y, 11, 4)
    f.r('i', 1, y + 3, 11, 1)
    f.r('l', 2, y + 1, 5, 2)
    f.r('h', 2, y + 1, 5, 1)
    f.r(((frame + r) & 1) === 0 ? 'e' : 'f', 8, y + 1, 1, 1)
    f.r(((frame + r * 2) % 3) === 0 ? 'Y' : 'j', 10, y + 1, 1, 1)
  }
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── mixing console (2 × 1) ───────────────────────────────────────────────────────────────────────────────────────────

export function consoleMap(): PixMap {
  const g = new Grid(64, 52)
  const ax = 24
  const ay = 28
  groundShadow(g, ax, ay, 0.06, 0.12, 2.0, 0.96, 3, 2)
  isoBox(g, ax, ay, 0.08, 0.2, 0.26, 0.86, 0, 9, DARK)
  isoBox(g, ax, ay, 1.74, 0.2, 1.92, 0.86, 0, 9, DARK)
  isoBox(g, ax, ay, 0.04, 0.12, 1.96, 0.9, 9, 13, { top: 'l', south: 'j', east: 'K', rim: 'i', edge: 'i', corner: 'k' })
  const z = 13
  // faders: a track and a coloured cap on each channel strip
  const caps = ['d', 'Y', 'e', 'z', 'o', 'p', 'e', 'Y', 'd', 'z', 'e', 'Y']
  for (let i = 0; i < 12; i++) {
    const u = 0.14 + i * 0.145
    isoFlat(g, ax, ay, u, 0.3, u + 0.06, 0.78, z, 'h')
    const v = 0.34 + ((i * 5) % 7) * 0.05
    isoFlat(g, ax, ay, u - 0.02, v, u + 0.08, v + 0.1, z, caps[i])
  }
  // two level meters at the back and a row of knobs
  for (const u of [0.2, 1.38]) isoBox(g, ax, ay, u, 0.16, u + 0.42, 0.26, z, z + 5, { top: 'Z', south: 'Z', east: 'l' })
  const a = IP(ax, ay, 0.2, 0.26, z)
  const s = new SouthFace(g, a[0], a[1])
  for (let i = 0; i < 6; i++) {
    s.r(i < 4 ? 'e' : 'Y', 1 + i, 1, 1, 2 + (i % 3))
    s.r(i < 4 ? 'e' : 'd', 15 + i, 1, 1, 1 + ((i + 1) % 3))
  }
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── recording booth (2 × 2) ──────────────────────────────────────────────────────────────────────────────────────────

export function boothMap(): PixMap {
  const g = new Grid(80, 100)
  const ax = 40
  const ay = 52
  groundShadow(g, ax, ay, 0.1, 0.1, 2.02, 2.02, 4, 3)
  isoBox(g, ax, ay, 0.06, 0.06, 1.94, 1.94, 0, 3, { top: 'j', south: 'l', east: 'K', rim: 'i' })
  isoBox(g, ax, ay, 0.1, 0.1, 1.9, 1.9, 3, 48, { top: 'l', south: 'l', east: 'K', rim: 'i', edge: 'i', corner: 'k' })
  // south side: acoustic foam wedges and the door
  const sf = new SouthFace(g, ...IP(ax, ay, 0.1, 1.9, 3))
  for (let i = 0; i < 28; i++) {
    for (let j = 0; j < 9; j++) sf.r((i + j) % 2 === 0 ? 'j' : 'l', i, 4 + j * 4, 1, 4)
  }
  sf.r('k', 2, 0, 1, 44)
  sf.r('i', 3, 0, 1, 44)
  sf.r('k', 25, 0, 1, 44)
  sf.r('i', 26, 0, 1, 44)
  // east side: the glass window onto the booth, with the microphone inside
  const ef = new EastFace(g, ...IP(ax, ay, 1.9, 1.9, 3))
  ef.r('K', 0, 0, 29, 45)
  for (let i = 0; i < 29; i++) {
    for (let j = 0; j < 9; j++) if ((i + j) % 2 === 0) ef.r('l', i, 2 + j * 4, 1, 4)
  }
  ef.r('k', 4, 8, 21, 30)
  ef.r('Z', 5, 9, 19, 28)
  ef.r('q', 5, 9, 19, 28)
  ef.r('Q', 6, 30, 5, 1)
  ef.r('Q', 7, 29, 4, 1)
  ef.r('Q', 18, 12, 3, 1)
  ef.r('Z', 5, 9, 19, 3)
  // mic on a stand, with the pop filter
  ef.r('j', 14, 9, 1, 14)
  ef.r('h', 11, 23, 7, 1)
  ef.r('l', 13, 24, 3, 4)
  ef.r('h', 13, 28, 3, 1)
  // the 'on air' lamp over the window
  ef.r('k', 11, 40, 7, 4)
  ef.r('d', 12, 41, 5, 2)
  ef.r('Y', 13, 41, 1, 1)
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── studio speaker (1 × 1) ───────────────────────────────────────────────────────────────────────────────────────────

export function speakerMap(): PixMap {
  const g = new Grid(32, 56)
  const ax = 16
  const ay = 36
  groundShadow(g, ax, ay, 0.25, 0.25, 0.8, 0.8, 2, 1)
  isoBox(g, ax, ay, 0.26, 0.26, 0.74, 0.74, 0, 2, { top: 'j', south: 'l', east: 'K' })
  const [cx, cy] = IP(ax, ay, 0.5, 0.5, 0)
  g.rect(cx - 1, cy - 16, 2, 15, 'j')
  isoBox(g, ax, ay, 0.2, 0.2, 0.8, 0.8, 16, 36, { top: 'j', south: 'l', east: 'K', rim: 'i', edge: 'i', corner: 'k' })
  const f = new EastFace(g, ...IP(ax, ay, 0.8, 0.8, 16))
  f.r('l', 1, 1, 8, 18)
  // tweeter and woofer
  f.r('i', 3, 13, 4, 3)
  f.r('h', 4, 14, 2, 1)
  f.r('j', 2, 3, 6, 7)
  f.r('l', 3, 4, 4, 5)
  f.r('K', 4, 5, 2, 3)
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── easel (1 × 1) ────────────────────────────────────────────────────────────────────────────────────────────────────

export function easelMap(): PixMap {
  const g = new Grid(32, 58)
  const ax = 16
  const ay = 38
  groundShadow(g, ax, ay, 0.2, 0.2, 0.85, 0.85, 2, 1)
  const [cx, cy] = IP(ax, ay, 0.5, 0.55, 0)
  g.line(cx - 8, cy + 2, cx - 3, cy - 22, '3')
  g.line(cx + 8, cy + 2, cx + 3, cy - 22, '3')
  g.line(cx, cy - 10, cx, cy - 26, '2')
  g.rect(cx - 7, cy - 8, 14, 2, '2')
  // the canvas, facing south
  const s = new SouthFace(g, cx - 9, cy - 4)
  s.r('w', 0, 7, 18, 20)
  s.r('c', 0, 7, 18, 1)
  s.r('k', 0, 6, 18, 1)
  s.r('v', 2, 20, 14, 5)
  s.r('z', 2, 20, 14, 1)
  s.r('f', 2, 12, 14, 6)
  s.r('n', 8, 12, 8, 3)
  s.r('Y', 4, 21, 2, 2)
  s.r('o', 11, 14, 3, 3)
  s.r('d', 5, 13, 2, 2)
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── device test bench (2 × 1) ────────────────────────────────────────────────────────────────────────────────────────

export function testBenchMap(): PixMap {
  const g = new Grid(64, 56)
  const ax = 24
  const ay = 32
  groundShadow(g, ax, ay, 0.06, 0.12, 2.0, 0.96, 3, 2)
  isoBox(g, ax, ay, 0.1, 0.2, 0.22, 0.84, 0, 8, { top: 'j', south: 'l', east: 'l' })
  isoBox(g, ax, ay, 1.78, 0.2, 1.9, 0.84, 0, 8, { top: 'j', south: 'l', east: 'l' })
  isoBox(g, ax, ay, 0.04, 0.12, 1.96, 0.9, 8, 11, WHITE)
  const z = 11
  // a row of test devices: phones, a tablet and a handheld console, each lit
  const dev = (u: number, v: number, du: number, dv: number, face: string): void => {
    isoBox(g, ax, ay, u, v, u + du, v + dv, z, z + 1, { top: 'l', south: 'k', east: 'k', rim: 'j' })
    isoFlat(g, ax, ay, u + 0.02, v + 0.02, u + du - 0.02, v + dv - 0.02, z + 1, face)
  }
  dev(0.12, 0.5, 0.14, 0.22, 'y')
  dev(0.32, 0.46, 0.14, 0.24, 'e')
  dev(0.52, 0.5, 0.14, 0.22, 'z')
  dev(0.72, 0.4, 0.3, 0.34, 'y')
  dev(1.14, 0.48, 0.26, 0.2, 'Y')
  dev(1.5, 0.5, 0.14, 0.22, 'd')
  // charging cables and a small test rig with a monitor
  isoBox(g, ax, ay, 1.62, 0.2, 1.9, 0.3, z, z + 2, { top: 'j', south: 'l', east: 'K' })
  const m = IP(ax, ay, 0.2, 0.28, z)
  new SouthFace(g, m[0], m[1]).stamp(['kkkkkkkkkk', 'kjjjjjjjjk', 'kZZZZZZZZk', 'kZeeeyyZZk', 'kZZZZZZZZk', 'kkkkkkkkkk', '...kjjk...'], 0, 0)
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── sound library storage (1 × 1) ────────────────────────────────────────────────────────────────────────────────────

export function storageMap(): PixMap {
  const g = new Grid(32, 56)
  const ax = 16
  const ay = 38
  groundShadow(g, ax, ay, 0.08, 0.08, 0.92, 0.92, 3, 2)
  isoBox(g, ax, ay, 0.08, 0.08, 0.92, 0.92, 0, 32, { top: 'l', south: 'K', east: 'l', rim: 'j', edge: 'j', corner: 'k' })
  const f = new EastFace(g, ...IP(ax, ay, 0.92, 0.92, 0))
  f.r('K', 1, 1, 13, 29)
  const cols = 'zdYevpoh'
  for (let s = 0; s < 4; s++) {
    const base = 2 + s * 7
    f.r('j', 1, base, 13, 1)
    // crates and drive cases with a label colour each
    let col = 2
    for (let b = 0; b < 5 && col < 13; b++) {
      const w = 2 + ((b + s) % 2)
      f.r('i', col, base + 1, w, 5)
      f.r(cols[(b * 3 + s * 2) % cols.length], col, base + 4, w, 1)
      f.r('h', col, base + 5, w, 1)
      col += w + 0
    }
  }
  g.outline('k')
  return g.toMap(ax, ay)
}

// ── round discussion table (2 × 2) ───────────────────────────────────────────────────────────────────────────────────

const ring = (ax: number, ay: number, cu: number, cv: number, r: number, z: number): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    out.push(IP(ax, ay, cu + Math.cos(a) * r, cv + Math.sin(a) * r, z))
  }
  return out
}

export function roundTableMap(): PixMap {
  const g = new Grid(64, 60)
  const ax = 32
  const ay = 20
  // soft shadow, then the foot
  const sh = ring(ax, ay, 1.08, 1.08, 0.9, 0).map(([x, y]) => [x + 3, y + 2] as Pt)
  g.poly(sh, 'x')
  isoBox(g, ax, ay, 0.82, 0.82, 1.18, 1.18, 0, 9, { top: 'j', south: 'l', east: 'K' })
  g.poly(ring(ax, ay, 1, 1, 0.5, 0), 'l')
  for (let z = 9; z < 12; z++) g.poly(ring(ax, ay, 1, 1, 0.92, z), z === 9 ? '3' : '2')
  g.poly(ring(ax, ay, 1, 1, 0.92, 12), '1')
  g.poly(ring(ax, ay, 1, 1, 0.8, 12), 'W')
  g.speckle('W', '1', (x, y) => (x * 3 + y * 5) % 9 === 0)
  g.outline('k')
  return g.toMap(ax, ay)
}

export const STUDIO_MAPS: Record<string, PixMap> = {
  rack: rackMap(0),
  'rack.b': rackMap(1),
  console: consoleMap(),
  booth: boothMap(),
  speaker: speakerMap(),
  easel: easelMap(),
  testbench: testBenchMap(),
  storage: storageMap(),
  'round-table': roundTableMap()
}
