import { open, type FileHandle } from 'node:fs/promises'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * Reads one entry of a zip file and writes a copy of the zip with that entry replaced. Every other entry is copied byte for byte
 * (streamed, so a 1 GB apk is never held in memory); only the replaced entry is held, and the central directory is rewritten.
 * Zip64 archives (over 4 GB) are not supported. The result is not zip-aligned or signed: run zipalign and apksigner afterwards.
 */
const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50
const COPY_CHUNK = 4 * 1024 * 1024

interface Entry {
  name: string
  /** The whole central-directory record (46 bytes + name + extra + comment). */
  raw: Buffer
  offset: number
  method: number
  flags: number
  csize: number
}

interface Directory {
  entries: Entry[]
  cdStart: number
  /** The end-of-central-directory record, including the archive comment. */
  eocd: Buffer
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done)
    if (bytesRead === 0) throw new Error('The zip file ends early (it is damaged or incomplete).')
    done += bytesRead
  }
  return buf
}

async function readDirectory(fh: FileHandle): Promise<Directory> {
  const size = (await fh.stat()).size
  const tailLen = Math.min(size, 22 + 65535)
  const tail = await readAt(fh, size - tailLen, tailLen)
  let at = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      at = i
      break
    }
  }
  if (at < 0) throw new Error('Not a zip file: no end-of-archive record.')
  const eocd = tail.subarray(at)
  const count = eocd.readUInt16LE(10)
  const cdSize = eocd.readUInt32LE(12)
  const cdStart = eocd.readUInt32LE(16)
  if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff) throw new Error('Zip64 archives are not supported.')
  const cd = await readAt(fh, cdStart, cdSize)
  const entries: Entry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN_SIG) throw new Error('The zip directory is damaged.')
    const nameLen = cd.readUInt16LE(p + 28)
    const total = 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32)
    if (p + total > cd.length) throw new Error('The zip directory is damaged.')
    entries.push({
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      raw: Buffer.from(cd.subarray(p, p + total)),
      offset: cd.readUInt32LE(p + 42),
      method: cd.readUInt16LE(p + 10),
      flags: cd.readUInt16LE(p + 8),
      csize: cd.readUInt32LE(p + 20)
    })
    p += total
  }
  return { entries, cdStart, eocd: Buffer.from(eocd) }
}

async function readEntryData(fh: FileHandle, e: Entry): Promise<Buffer> {
  const head = await readAt(fh, e.offset, 30)
  if (head.readUInt32LE(0) !== LOC_SIG) throw new Error(`The zip entry ${e.name} is damaged.`)
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  const data = await readAt(fh, start, e.csize)
  if (e.method === 0) return data
  if (e.method === 8) return inflateRawSync(data)
  throw new Error(`The zip entry ${e.name} uses compression method ${e.method}, which is not supported.`)
}

/** The decompressed content of one entry, or null when the zip has no such entry. */
export async function readZipEntry(path: string, name: string): Promise<Buffer | null> {
  const fh = await open(path, 'r')
  try {
    const dir = await readDirectory(fh)
    const e = dir.entries.find((x) => x.name === name)
    return e ? await readEntryData(fh, e) : null
  } finally {
    await fh.close()
  }
}

async function copyRange(src: FileHandle, dst: FileHandle, from: number, to: number, dstPos: number): Promise<number> {
  let pos = from
  let out = dstPos
  while (pos < to) {
    const n = Math.min(COPY_CHUNK, to - pos)
    const chunk = await readAt(src, pos, n)
    await dst.write(chunk, 0, n, out)
    pos += n
    out += n
  }
  return out
}

/** Writes `dstPath` as a copy of `srcPath` where `name` holds `transform(oldContent)`. Throws when the entry does not exist. */
export async function replaceZipEntry(srcPath: string, dstPath: string, name: string, transform: (data: Buffer) => Buffer): Promise<void> {
  const src = await open(srcPath, 'r')
  try {
    const dir = await readDirectory(src)
    const target = dir.entries.find((e) => e.name === name)
    if (!target) throw new Error(`The zip has no ${name}.`)
    const next = dir.entries.filter((e) => e.offset > target.offset).reduce((m, e) => Math.min(m, e.offset), dir.cdStart)
    const content = transform(await readEntryData(src, target))
    const deflated = deflateRawSync(content, { level: 9 })
    const stored = deflated.length >= content.length
    const body = stored ? content : deflated
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(content)
    const flags = target.flags & ~0x0008
    const method = stored ? 0 : 8

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(LOC_SIG, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    target.raw.copy(local, 10, 12, 16) // modification time and date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)

    const delta = local.length + body.length - (next - target.offset)
    const dst = await open(dstPath, 'w')
    try {
      let pos = await copyRange(src, dst, 0, target.offset, 0)
      await dst.write(local, 0, local.length, pos)
      pos += local.length
      await dst.write(body, 0, body.length, pos)
      pos += body.length
      pos = await copyRange(src, dst, next, dir.cdStart, pos)

      const parts: Buffer[] = []
      for (const e of dir.entries) {
        const raw = Buffer.from(e.raw)
        if (e === target) {
          raw.writeUInt16LE(flags, 8)
          raw.writeUInt16LE(method, 10)
          raw.writeUInt32LE(crc, 16)
          raw.writeUInt32LE(body.length, 20)
          raw.writeUInt32LE(content.length, 24)
        } else if (e.offset >= next) raw.writeUInt32LE(e.offset + delta, 42)
        parts.push(raw)
      }
      const cd = Buffer.concat(parts)
      const eocd = Buffer.from(dir.eocd)
      eocd.writeUInt32LE(dir.cdStart + delta, 16)
      await dst.write(cd, 0, cd.length, pos)
      await dst.write(eocd, 0, eocd.length, pos + cd.length)
    } finally {
      await dst.close()
    }
  } finally {
    await src.close()
  }
}
