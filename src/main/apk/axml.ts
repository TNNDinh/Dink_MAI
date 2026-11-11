/**
 * Just enough of Android's binary XML (AndroidManifest.xml inside an APK) to read and change `android:minSdkVersion`.
 * The value is a fixed-size integer, so it is patched in place; nothing else in the file moves.
 */
const XML_FILE = 0x0003
const XML_RESOURCE_MAP = 0x0180
const XML_START_ELEMENT = 0x0102
/** Resource id of the framework attribute android:minSdkVersion. */
const MIN_SDK_ATTR = 0x0101020c
const TYPE_INT_DEC = 0x10

/** Offset of the 4-byte minSdkVersion value, or null when the manifest has none that can be edited in place. */
function findMinSdk(buf: Buffer): { offset: number; value: number } | null {
  if (buf.length < 8 || buf.readUInt16LE(0) !== XML_FILE) return null
  let pos = buf.readUInt16LE(2)
  let resMap: number[] | null = null
  while (pos + 8 <= buf.length) {
    const type = buf.readUInt16LE(pos)
    const headerSize = buf.readUInt16LE(pos + 2)
    const size = buf.readUInt32LE(pos + 4)
    if (size < 8 || headerSize < 8 || pos + size > buf.length) return null
    if (type === XML_RESOURCE_MAP) {
      resMap = []
      for (let o = pos + headerSize; o + 4 <= pos + size; o += 4) resMap.push(buf.readUInt32LE(o))
    } else if (type === XML_START_ELEMENT && resMap && pos + headerSize + 20 <= buf.length) {
      const ext = pos + headerSize
      const attrStart = buf.readUInt16LE(ext + 8)
      const attrSize = buf.readUInt16LE(ext + 10)
      const attrCount = buf.readUInt16LE(ext + 12)
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize
        if (attrSize < 20 || a + 20 > buf.length) break
        // Attribute: namespace, name, raw value, then a typed value (size u16, reserved u8, type u8, data u32).
        if (resMap[buf.readUInt32LE(a + 4)] === MIN_SDK_ATTR && buf[a + 15] === TYPE_INT_DEC) return { offset: a + 16, value: buf.readUInt32LE(a + 16) }
      }
    }
    pos += size
  }
  return null
}

/** The manifest's minSdkVersion, or null when it is absent (Android then assumes 1) or cannot be read. */
export function readMinSdk(manifest: Buffer): number | null {
  return findMinSdk(manifest)?.value ?? null
}

/** A copy of the manifest with minSdkVersion lowered to `to`. null when it cannot be patched; unchanged when already <= `to`. */
export function lowerMinSdk(manifest: Buffer, to: number): { manifest: Buffer; from: number; changed: boolean } | null {
  const slot = findMinSdk(manifest)
  if (!slot) return null
  if (slot.value <= to) return { manifest, from: slot.value, changed: false }
  const copy = Buffer.from(manifest)
  copy.writeUInt32LE(to, slot.offset)
  return { manifest: copy, from: slot.value, changed: true }
}
