import { poly, type G, type Pt } from './pixels'
import { toWorld } from './world'

/**
 * Light is painted as a few flat translucent bands (the way pixel artists fake a gradient), never as a smooth blur:
 *  - sun from the windows of the north wall, falling on the floor as slanted patches (baked once into the floor);
 *  - lamps (a soft warm pool around the PM's desk);
 *  - the glow of a working screen on the floor in front of the desk (changes, drawn every frame).
 * The light comes from the upper left, so patches slant to the right as they fall.
 */

/** Concentric pixel ellipses, each band adding its alpha. Centre and radii in world pixels (an iso ellipse is twice as wide as tall). */
export function glow(g: G, cx: number, cy: number, rx: number, color: string, bands = 3): void {
  g.fillStyle = color
  for (let b = 0; b < bands; b++) {
    const r = rx * (1 - b / bands)
    const ry = r / 2
    for (let y = -Math.floor(ry); y <= Math.floor(ry); y++) {
      const hw = Math.round(r * Math.sqrt(Math.max(0, 1 - (y / ry) * (y / ry))))
      if (hw > 0) g.fillRect(Math.round(cx) - hw, Math.round(cy) + y, hw * 2, 1)
    }
  }
}

/** A slanted patch of sunlight from a window of the north wall (tile coordinates). */
export function sunPatch(g: G, x0: number, x1: number, color: string, depth = 3.4, slant = 1.5): void {
  // three bands: the full patch, then a narrower and shorter one inside it, then the bright core
  const bands: Array<[number, number]> = [
    [0, 1],
    [0.12, 0.78],
    [0.26, 0.5]
  ]
  for (const [inset, reach] of bands) {
    const a = x0 + (x1 - x0) * inset * 0.5
    const b = x1 - (x1 - x0) * inset * 0.5
    const d = depth * reach
    const s = slant * reach
    const pts: Pt[] = [toWorld(a, 1), toWorld(b, 1), toWorld(b + s, 1 + d), toWorld(a + s, 1 + d)]
    poly(g, pts, color)
  }
}

/** Darkens the floor along a wall: a contact shadow, two bands. */
export function wallShadow(g: G, x0: number, x1: number, y: number, color: string): void {
  for (const d of [0.38, 0.2]) poly(g, [toWorld(x0, y), toWorld(x1, y), toWorld(x1, y + d), toWorld(x0, y + d)], color)
}
