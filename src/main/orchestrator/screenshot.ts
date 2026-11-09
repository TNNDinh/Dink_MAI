import { readFile } from 'node:fs/promises'
import type { ImagePart } from '../providers/types'

/**
 * A game drawn with OpenGL/Vulkan has no UI tree, so text from the screen is nearly empty and an agent playing it from text
 * alone is blind. This prepares a screenshot to be shown to the model: small enough to be cheap (a model downsizes big images
 * itself, but only after the whole file has been uploaded and paid for in time), and with the real screen size reported so
 * taps still land on the right pixel.
 */
export const SHOT_MAX_EDGE = 1280
const RAW_MAX_BYTES = 1_500_000
const HARD_MAX_BYTES = 4_500_000

export interface PreparedShot {
  image: ImagePart
  /** The real screen size in pixels: tap and swipe coordinates are in this space. */
  width: number
  height: number
  /** The size of the picture the model gets. */
  shownWidth: number
  shownHeight: number
}

/** Width and height from a PNG header, or null when it is not a PNG. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}

interface NativeImageApi {
  createFromBuffer(b: Buffer): { isEmpty(): boolean; resize(o: { width: number; height: number; quality?: string }): { toJPEG(q: number): Buffer } }
}

export type Resizer = (png: Buffer, width: number, height: number) => Promise<{ data: Buffer; mimeType: string } | null>

/** Electron's own image codec (main process only). Returns null anywhere else, for example in tests. */
export const electronResizer: Resizer = async (png, width, height) => {
  try {
    const mod = (await import('electron')) as unknown as { nativeImage?: NativeImageApi; default?: { nativeImage?: NativeImageApi } }
    const ni = mod.nativeImage ?? mod.default?.nativeImage
    if (!ni?.createFromBuffer) return null
    const img = ni.createFromBuffer(png)
    if (img.isEmpty()) return null
    return { data: img.resize({ width, height, quality: 'good' }).toJPEG(80), mimeType: 'image/jpeg' }
  } catch {
    return null
  }
}

/** Reads a saved PNG screenshot and returns it ready to attach, or null when it cannot be shown (not a PNG, too big to send as it is). */
export async function prepareScreenshot(file: string, resize: Resizer = electronResizer, maxEdge = SHOT_MAX_EDGE): Promise<PreparedShot | null> {
  const png = await readFile(file)
  const size = pngSize(png)
  if (!size) return null
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height))
  if (scale < 1 || png.length > RAW_MAX_BYTES) {
    const w = Math.max(1, Math.round(size.width * scale))
    const h = Math.max(1, Math.round(size.height * scale))
    const small = await resize(png, w, h)
    if (small) return { image: { type: 'image', mimeType: small.mimeType, dataBase64: small.data.toString('base64') }, width: size.width, height: size.height, shownWidth: w, shownHeight: h }
    if (png.length > HARD_MAX_BYTES) return null
  }
  return { image: { type: 'image', mimeType: 'image/png', dataBase64: png.toString('base64') }, width: size.width, height: size.height, shownWidth: size.width, shownHeight: size.height }
}

/** What the model is told next to the picture, so it reads coordinates correctly. */
export function describeShot(s: PreparedShot): string {
  const scaled = s.shownWidth !== s.width || s.shownHeight !== s.height
  return `The screenshot is attached below. The device screen is ${s.width}x${s.height} pixels${scaled ? `; the picture is shown scaled to ${s.shownWidth}x${s.shownHeight}, so multiply the x and y you read from it by ${(s.width / s.shownWidth).toFixed(3)} before you tap or swipe` : ''}. Tap and swipe coordinates are in device pixels. Only your newest 2 screenshots stay in view: write down what this one shows (screen, buttons, numbers, what changed) in your notes file now, before the next action, or it is lost.`
}
