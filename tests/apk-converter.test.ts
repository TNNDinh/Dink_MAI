import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { lowerMinSdk, readMinSdk } from '../src/main/apk/axml'
import { ApkConverter, explainInstallFailure, type Runner, type ToolSpec } from '../src/main/apk/converter'
import { readZipEntry, replaceZipEntry } from '../src/main/apk/zip-replace'

const root = mkdtempSync(join(tmpdir(), 'apk-converter-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0
const fresh = (): string => {
  const d = join(root, String(++n))
  mkdirSync(d, { recursive: true })
  return d
}

/** A tiny binary AndroidManifest: string pool, resource map and one <uses-sdk android:minSdkVersion=…> element. */
function manifestWithMinSdk(min: number, withMinAttr = true): Buffer {
  const header = (type: number, headerSize: number, size: number): Buffer => {
    const b = Buffer.alloc(8)
    b.writeUInt16LE(type, 0)
    b.writeUInt16LE(headerSize, 2)
    b.writeUInt32LE(size, 4)
    return b
  }
  // String pool with 2 empty UTF-8 strings (offsets 0 and 3): header 28 bytes + 2 offsets + 6 bytes of data (padded to 4).
  const pool = Buffer.alloc(28 + 8 + 8)
  header(0x0001, 28, pool.length).copy(pool)
  pool.writeUInt32LE(2, 8)
  pool.writeUInt32LE(0x100, 16) // UTF-8 flag
  pool.writeUInt32LE(36, 20)
  pool.writeUInt32LE(0, 28)
  pool.writeUInt32LE(3, 32)
  const resMap = Buffer.alloc(8 + 4)
  header(0x0180, 8, resMap.length).copy(resMap)
  resMap.writeUInt32LE(withMinAttr ? 0x0101020c : 0x01010270, 8) // string 0 is the attribute's name
  const el = Buffer.alloc(16 + 20 + 20)
  header(0x0102, 16, el.length).copy(el)
  el.writeUInt32LE(0xffffffff, 16) // namespace
  el.writeUInt32LE(1, 20) // element name
  el.writeUInt16LE(20, 24) // attributeStart
  el.writeUInt16LE(20, 26) // attributeSize
  el.writeUInt16LE(1, 28) // attributeCount
  el.writeUInt32LE(0xffffffff, 36) // attr namespace
  el.writeUInt32LE(0, 40) // attr name -> string 0
  el.writeUInt32LE(0xffffffff, 44) // raw value
  el.writeUInt16LE(8, 48)
  el[51] = 0x10 // int dec
  el.writeUInt32LE(min, 52)
  const body = Buffer.concat([pool, resMap, el])
  const file = Buffer.alloc(8)
  header(0x0003, 8, 8 + body.length).copy(file)
  return Buffer.concat([file, body])
}

/** A minimal zip writer (deflate or stored) so the zip code is tested without any external tool. */
function makeZip(entries: Array<{ name: string; data: Buffer; stored?: boolean }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const body = e.stored ? e.data : deflateRawSync(e.data)
    const name = Buffer.from(e.name)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0)
    l.writeUInt16LE(20, 4)
    l.writeUInt16LE(e.stored ? 0 : 8, 8)
    l.writeUInt32LE(crc32(e.data), 14)
    l.writeUInt32LE(body.length, 18)
    l.writeUInt32LE(e.data.length, 22)
    l.writeUInt16LE(name.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(e.stored ? 0 : 8, 10)
    c.writeUInt32LE(crc32(e.data), 16)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(e.data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    locals.push(l, name, body)
    centrals.push(c, name)
    offset += l.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

describe('binary manifest minSdkVersion', () => {
  it('reads the value and lowers it in place without changing the size', () => {
    const m = manifestWithMinSdk(32)
    expect(readMinSdk(m)).toBe(32)
    const r = lowerMinSdk(m, 30)!
    expect(r).toMatchObject({ from: 32, changed: true })
    expect(r.manifest.length).toBe(m.length)
    expect(readMinSdk(r.manifest)).toBe(30)
    expect(readMinSdk(m)).toBe(32) // the original buffer is not touched
  })

  it('leaves a manifest alone when it already needs less than the target', () => {
    const r = lowerMinSdk(manifestWithMinSdk(24), 30)!
    expect(r.changed).toBe(false)
    expect(r.from).toBe(24)
  })

  it('returns null for a manifest without minSdkVersion or text that is not a binary manifest', () => {
    expect(readMinSdk(manifestWithMinSdk(32, false))).toBeNull()
    expect(lowerMinSdk(manifestWithMinSdk(32, false), 30)).toBeNull()
    expect(readMinSdk(Buffer.from('<manifest/>'))).toBeNull()
  })
})

describe('replacing one zip entry', () => {
  it('changes only that entry and keeps every other entry readable, whether it comes before or after', async () => {
    const dir = fresh()
    const big = Buffer.alloc(5000, 'abc')
    const src = join(dir, 'a.zip')
    writeFileSync(
      src,
      makeZip([
        { name: 'before.bin', data: big },
        { name: 'AndroidManifest.xml', data: manifestWithMinSdk(32) },
        { name: 'resources.arsc', data: Buffer.from('stored-data'), stored: true },
        { name: 'classes.dex', data: Buffer.alloc(9000, 7) }
      ])
    )
    const dst = join(dir, 'b.zip')
    await replaceZipEntry(src, dst, 'AndroidManifest.xml', (m) => lowerMinSdk(m, 30)!.manifest)
    expect(readMinSdk((await readZipEntry(dst, 'AndroidManifest.xml'))!)).toBe(30)
    expect((await readZipEntry(dst, 'before.bin'))!.equals(big)).toBe(true)
    expect((await readZipEntry(dst, 'resources.arsc'))!.toString()).toBe('stored-data')
    expect((await readZipEntry(dst, 'classes.dex'))!.equals(Buffer.alloc(9000, 7))).toBe(true)
    expect(await readZipEntry(dst, 'nope')).toBeNull()
  })

  it('also works when the replaced entry grows and when it is the last one', async () => {
    const dir = fresh()
    const src = join(dir, 'a.zip')
    writeFileSync(src, makeZip([{ name: 'x', data: Buffer.from('1') }, { name: 'last', data: Buffer.from('short') }]))
    const dst = join(dir, 'b.zip')
    await replaceZipEntry(src, dst, 'last', () => Buffer.alloc(20000, 'z'))
    expect((await readZipEntry(dst, 'last'))!.length).toBe(20000)
    expect((await readZipEntry(dst, 'x'))!.toString()).toBe('1')
  })

  it('refuses a missing entry and a file that is not a zip', async () => {
    const dir = fresh()
    const src = join(dir, 'a.zip')
    writeFileSync(src, makeZip([{ name: 'x', data: Buffer.from('1') }]))
    await expect(replaceZipEntry(src, join(dir, 'b.zip'), 'missing', (d) => d)).rejects.toThrow(/no missing/)
    writeFileSync(join(dir, 'c.zip'), 'not a zip at all')
    await expect(readZipEntry(join(dir, 'c.zip'), 'x')).rejects.toThrow(/Not a zip/)
  })
})

describe('ApkConverter', () => {
  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
  const jar = Buffer.from('fake jar')
  const spec = (file: string): ToolSpec => ({ file, url: `https://example.invalid/${file}`, sha256: sha(jar), megabytes: 1 })
  const tools = { editor: spec('editor.jar'), signer: spec('signer.jar') }

  /** Fakes java: "APKEditor m" writes a merged zip, "signer" writes a signed copy. */
  function fakeRunner(calls: string[][]): Runner {
    return async (file, args) => {
      calls.push([file, ...args])
      if (args[0] === '-version') return { stdout: '', stderr: 'openjdk' }
      if (args[0] === '-jar' && args[1].endsWith('editor.jar')) {
        writeFileSync(args[args.indexOf('-o') + 1], makeZip([{ name: 'AndroidManifest.xml', data: manifestWithMinSdk(32) }, { name: 'classes.dex', data: Buffer.alloc(100, 1) }]))
      } else if (args[0] === '-jar' && args[1].endsWith('signer.jar')) {
        const out = args[args.indexOf('--out') + 1]
        mkdirSync(out, { recursive: true })
        writeFileSync(join(out, 'merged-aligned-debugSigned.apk'), readFileSync(args[args.indexOf('-a') + 1]))
        writeFileSync(join(out, 'merged-aligned-debugSigned.apk.idsig'), 'x')
      }
      return { stdout: '', stderr: '' }
    }
  }
  const make = (calls: string[][], over: Partial<ConstructorParameters<typeof ApkConverter>[0]> = {}) => {
    const toolsDir = fresh()
    const progress: string[] = []
    const c = new ApkConverter({
      toolsDir,
      atuDir: () => null,
      emit: (p) => progress.push(p.step),
      run: fakeRunner(calls),
      download: async (_u, dest) => writeFileSync(dest, jar),
      env: { JAVA_HOME: '' },
      tools,
      ...over
    })
    return { c, toolsDir, progress }
  }
  const splitFolder = (): string => {
    const d = join(fresh(), 'Cool Game')
    mkdirSync(d)
    writeFileSync(join(d, 'base.apk'), 'x')
    writeFileSync(join(d, 'config.armeabi_v7a.apk'), 'x')
    return d
  }

  it('merges the splits, signs the result and saves it next to the source without touching anything else', async () => {
    const calls: string[][] = []
    const { c, toolsDir, progress } = make(calls)
    const folder = splitFolder()
    const r = await c.convert({ path: folder })
    expect(r.outputPath).toBe(join(folder, '..', 'Cool Game.apk').replace(/[\\/]+/g, (m) => m))
    expect(existsSync(r.outputPath)).toBe(true)
    expect(r).toMatchObject({ parts: 2, minSdkBefore: 32, minSdkAfter: 32 })
    expect(readdirSync(toolsDir).sort()).toEqual(['editor.jar', 'signer.jar'])
    const merge = calls.find((x) => x[2]?.endsWith('editor.jar'))!
    expect(merge.slice(3, 5)).toEqual(['m', '-i'])
    expect(progress).toEqual(['tools', 'tools', 'merge', 'sign', 'done'])
  })

  it('lowers minSdk, names the file after it and warns about the risk', async () => {
    const { c } = make([])
    const r = await c.convert({ path: splitFolder(), minSdk: 30 })
    expect(r.outputPath.endsWith('Cool Game_minSdk30.apk')).toBe(true)
    expect(r).toMatchObject({ minSdkBefore: 32, minSdkAfter: 30 })
    expect(readMinSdk((await readZipEntry(r.outputPath, 'AndroidManifest.xml'))!)).toBe(30)
    expect(r.warnings.join(' ')).toMatch(/lowered from 32 to 30/)
  })

  it('never overwrites an existing file', async () => {
    const { c } = make([])
    const folder = splitFolder()
    const a = await c.convert({ path: folder })
    const b = await c.convert({ path: folder })
    expect(b.outputPath).not.toBe(a.outputPath)
    expect(b.outputPath.endsWith('Cool Game (2).apk')).toBe(true)
    expect(existsSync(a.outputPath)).toBe(true)
  })

  it('refuses a download that does not match the pinned checksum and keeps nothing', async () => {
    const { c, toolsDir } = make([], { download: async (_u, dest) => writeFileSync(dest, 'tampered') })
    await expect(c.convert({ path: splitFolder() })).rejects.toThrow(/expected checksum/)
    expect(readdirSync(toolsDir)).toEqual([])
  })

  it('does not download again when the jars are already there', async () => {
    let downloads = 0
    const { c, toolsDir } = make([], { download: async (_u, dest) => void (downloads++, writeFileSync(dest, jar)) })
    writeFileSync(join(toolsDir, 'editor.jar'), jar)
    writeFileSync(join(toolsDir, 'signer.jar'), jar)
    await c.convert({ path: splitFolder() })
    expect(downloads).toBe(0)
  })

  it('says so when Java is missing, and rejects bad input before doing any work', async () => {
    const failing: Runner = async () => {
      throw new Error('spawn java ENOENT')
    }
    await expect(make([], { run: failing }).c.convert({ path: splitFolder() })).rejects.toThrow(/Java was not found/)
    const { c } = make([])
    await expect(c.convert({ path: join(root, 'nope.xapk') })).rejects.toThrow(/does not exist/)
    const txt = join(fresh(), 'a.txt')
    writeFileSync(txt, 'x')
    await expect(c.convert({ path: txt })).rejects.toThrow(/Expected a \.xapk/)
    await expect(c.convert({ path: splitFolder(), minSdk: 0 })).rejects.toThrow(/whole number/)
  })

  it('cleans its working folder and can run again after a failure', async () => {
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith('apk-convert-')).length
    const { c } = make([], { download: async (_u, dest) => writeFileSync(dest, 'bad') })
    await expect(c.convert({ path: splitFolder() })).rejects.toThrow()
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('apk-convert-')).length).toBe(before)
    expect(c.cancel()).toBe(false)
  })

  it('warns that OBB files cannot be part of an apk', async () => {
    const { c } = make([])
    const folder = splitFolder()
    mkdirSync(join(folder, 'Android', 'obb', 'com.x'), { recursive: true })
    writeFileSync(join(folder, 'Android', 'obb', 'com.x', 'main.1.com.x.obb'), 'x')
    const r = await c.convert({ path: folder })
    expect(r.warnings.join(' ')).toMatch(/OBB/)
    expect((await c.inspect(folder)).obbFiles).toEqual(['main.1.com.x.obb'])
  })
})

describe('installing on the emulator', () => {
  const apk = (): string => {
    const f = join(fresh(), 'game.apk')
    writeFileSync(f, 'x')
    return f
  }
  /** A fake adb. `devices` is what `adb devices` lists; `install` is what the install prints (or an error to throw). */
  const adbFake = (o: { devices: string[]; afterConnect?: string[]; install?: string | Error; installer?: string }) => {
    const calls: string[][] = []
    let connected = false
    const run: Runner = async (_f, args) => {
      calls.push(args)
      if (args[0] === 'connect') {
        connected = true
        return { stdout: 'connected', stderr: '' }
      }
      if (args[0] === 'devices') {
        const list = connected && o.afterConnect ? o.afterConnect : o.devices
        return { stdout: ['List of devices attached', ...list, ''].join('\n'), stderr: '' }
      }
      if (args.includes('install')) {
        if (o.install instanceof Error) throw o.install
        return { stdout: o.install ?? 'Performing Streamed Install\nSuccess', stderr: '' }
      }
      if (args.includes('list')) return { stdout: `package:com.x.y  installer=${o.installer ?? 'com.android.vending'}\n`, stderr: '' }
      return { stdout: '', stderr: '' }
    }
    return { run, calls }
  }
  const conv = (run: Runner) => new ApkConverter({ toolsDir: fresh(), atuDir: () => null, emit: () => undefined, run, adb: 'adb', env: {} })

  it('installs with Google Play recorded as the installer and confirms it', async () => {
    const f = adbFake({ devices: ['127.0.0.1:5555	device'] })
    const r = await conv(f.run).installToEmulator({ path: apk(), packageName: 'com.x.y' })
    expect(r).toEqual({ serial: '127.0.0.1:5555', installer: 'com.android.vending' })
    const install = f.calls.find((a) => a.includes('install'))!
    expect(install.slice(0, 6)).toEqual(['-s', '127.0.0.1:5555', 'install', '-r', '-i', 'com.android.vending'])
  })

  it('connects to BlueStacks by itself when nothing is listed, and skips offline devices', async () => {
    const f = adbFake({ devices: ['emulator-5554	offline'], afterConnect: ['emulator-5554	offline', '127.0.0.1:5555	device'] })
    expect((await conv(f.run).installToEmulator({ path: apk() })).serial).toBe('127.0.0.1:5555')
    expect(f.calls.filter((a) => a[0] === 'connect').map((a) => a[1])).toEqual(expect.arrayContaining(['127.0.0.1:5555', '127.0.0.1:5556']))
  })

  it('says what to do when no emulator is online, and does not try to install', async () => {
    const f = adbFake({ devices: ['127.0.0.1:5555	offline'] })
    await expect(conv(f.run).installToEmulator({ path: apk() })).rejects.toThrow(/Open BlueStacks/)
    expect(f.calls.some((a) => a.includes('install'))).toBe(false)
  })

  it('explains the common install failures', async () => {
    const fail = (out: string) => adbFake({ devices: ['127.0.0.1:5555	device'], install: Object.assign(new Error('exit 1'), { stdout: out }) })
    await expect(conv(fail('Failure [INSTALL_FAILED_OLDER_SDK: Dex requires 32]').run).installToEmulator({ path: apk() })).rejects.toThrow(/Lower the minimum Android version/)
    await expect(conv(fail('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]').run).installToEmulator({ path: apk(), packageName: 'com.x.y' })).rejects.toThrow(/different key.*com\.x\.y/)
    expect(explainInstallFailure('boom', null)).toMatch(/could not install/)
  })

  it('reports an unconfirmed installer instead of claiming success, and refuses a missing or non-apk file', async () => {
    const f = adbFake({ devices: ['127.0.0.1:5555	device'], installer: 'null' })
    expect((await conv(f.run).installToEmulator({ path: apk(), packageName: 'com.x.y' })).installer).toBeNull()
    await expect(conv(f.run).installToEmulator({ path: join(root, 'gone.apk') })).rejects.toThrow(/no longer exists/)
    const txt = join(fresh(), 'a.txt')
    writeFileSync(txt, 'x')
    await expect(conv(f.run).installToEmulator({ path: txt })).rejects.toThrow(/no longer exists/)
  })
})

/** Opt-in: APK_E2E_XAPK=<path to a real .xapk> runs the real tools (needs Java and network on the first run). */
describe.runIf(process.env.APK_E2E_XAPK)('real xapk', () => {
  it('produces a signed single apk', async () => {
    const src = process.env.APK_E2E_XAPK as string
    const copyDir = fresh()
    const copy = join(copyDir, 'game.xapk')
    writeFileSync(copy, readFileSync(src))
    const c = new ApkConverter({ toolsDir: join(tmpdir(), 'apk-e2e-tools'), atuDir: () => process.env.APK_E2E_ATU ?? null, emit: (p) => console.log(p.message) })
    const info = await c.inspect(copy)
    console.log(info)
    const r = await c.convert({ path: copy, minSdk: info.minSdk && info.minSdk > 30 ? 30 : null })
    console.log(r)
    expect(statSync(r.outputPath).size).toBeGreaterThan(1_000_000)
    expect(r.outputPath.startsWith(copyDir)).toBe(true)
    if (process.env.APK_E2E_OUT) writeFileSync(process.env.APK_E2E_OUT, readFileSync(r.outputPath))
  }, 600_000)
})
