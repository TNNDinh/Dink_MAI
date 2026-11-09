import { Grid } from './iso'

/**
 * A flat elevation: a wall seen straight on, drawn with (i, j) = (to the right, up from the bottom). Walls and wall
 * decorations are drawn this way (the way an artist draws a wall) and the iso sprite shears it onto the wall face.
 */
export class Elev {
  readonly g: Grid
  constructor(
    readonly w: number,
    readonly h: number
  ) {
    this.g = new Grid(w, h)
  }
  /** Fills i..i+w, j..j+h (j counted from the bottom). */
  r(ch: string, i: number, j: number, w: number, h: number): this {
    this.g.rect(i, this.h - j - h, w, h, ch)
    return this
  }
  p(ch: string, i: number, j: number): this {
    this.g.set(i, this.h - 1 - j, ch)
    return this
  }
  /** A 1 px frame around the rectangle. */
  frame(ch: string, i: number, j: number, w: number, h: number): this {
    this.r(ch, i, j, w, 1)
    this.r(ch, i, j + h - 1, w, 1)
    this.r(ch, i, j, 1, h)
    this.r(ch, i + w - 1, j, 1, h)
    return this
  }
  /** Rows of characters with their bottom row on line j. */
  stamp(rows: readonly string[], i: number, j: number): this {
    this.g.stamp(rows, i, this.h - j - rows.length)
    return this
  }
  /** Columns 16k..16k+15 as rows (top to bottom), ready for SouthFace/EastFace.stamp. */
  slice(k: number, tile = 16): string[] {
    return this.g.rows().map((row) => row.slice(k * tile, (k + 1) * tile).padEnd(tile, '.'))
  }
}
