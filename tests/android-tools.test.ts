import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildAndroidCommand, findAdb, resolveInstallApks } from '../src/main/orchestrator/android-tools'

const base = { adb: 'C:/BS/HD-Adb.exe', serial: '127.0.0.1:5555' }
const cmd = (over: Record<string, unknown>) => buildAndroidCommand({ ...base, action: 'tap', ...over } as any)

describe('Android (BlueStacks) tool', () => {
  it('builds adb commands for the common actions', () => {
    expect(cmd({ action: 'connect' })).toBe('"C:/BS/HD-Adb.exe" connect 127.0.0.1:5555')
    expect(cmd({ action: 'tap', x: 10.7, y: 20 })).toBe('"C:/BS/HD-Adb.exe" -s 127.0.0.1:5555 shell input tap 10 20')
    expect(cmd({ action: 'swipe', x: 1, y: 2, x2: 3, y2: 4 })).toMatch(/input swipe 1 2 3 4 300$/)
    expect(cmd({ action: 'key', key: 'back' })).toMatch(/keyevent 4$/)
    expect(cmd({ action: 'launch', package: 'com.company.game' })).toMatch(/monkey -p com\.company\.game /)
    expect(cmd({ action: 'ui_dump' })).toMatch(/uiautomator dump \/dev\/tty$/)
    expect(cmd({ action: 'screenshot', file: 'D:/p/a.png' })).toMatch(/exec-out screencap -p > "D:\/p\/a\.png"$/)
    expect(cmd({ action: 'text', text: 'hi there' })).toMatch(/input text hi%sthere$/)
    expect(cmd({ action: 'logcat', lines: 5 })).toMatch(/-t 10 /)
  })

  it('installs one apk with install, several splits with install-multiple, always spoofing Play as installer', () => {
    expect(cmd({ action: 'install', file: 'x.apk' })).toBe('"C:/BS/HD-Adb.exe" -s 127.0.0.1:5555 install -r -i com.android.vending "x.apk"')
    expect(cmd({ action: 'install', files: ['x.apk'] })).toMatch(/ install -r -i com\.android\.vending "x\.apk"$/)
    expect(cmd({ action: 'install', files: ['base.apk', 'UnityDataAssetPack.apk', 'config.armeabi_v7a.apk'] })).toBe(
      '"C:/BS/HD-Adb.exe" -s 127.0.0.1:5555 install-multiple -r -i com.android.vending "base.apk" "UnityDataAssetPack.apk" "config.armeabi_v7a.apk"'
    )
    expect(() => cmd({ action: 'install', files: [] })).toThrow()
  })

  it('refuses values that could add another command', () => {
    expect(() => cmd({ action: 'launch', package: 'com.a; calc' })).toThrow()
    expect(() => cmd({ action: 'text', text: 'a; calc' })).toThrow()
    expect(() => cmd({ action: 'tap', x: 'a', y: 1 })).toThrow()
    expect(() => cmd({ action: 'key', key: 'power' })).toThrow()
    expect(() => cmd({ action: 'install', file: 'D:/a" & calc' })).toThrow()
    expect(() => cmd({ serial: '1.2.3.4 & calc', action: 'connect' })).toThrow()
  })

  it('finds BlueStacks adb, falling back to adb on PATH', () => {
    expect(findAdb({}, (p) => p.endsWith('BlueStacks_nxt\\HD-Adb.exe'))).toMatch(/HD-Adb\.exe$/)
    expect(findAdb({}, () => false)).toBe('adb')
  })
})

describe('resolveInstallApks', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'apkres-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('returns a single .apk unchanged', async () => {
    const f = join(tmp, 'solo.apk')
    writeFileSync(f, 'x')
    expect(await resolveInstallApks(f, join(tmp, 'ignored'))).toEqual([f])
  })

  it('lists split apks from a folder, base before config/asset packs', async () => {
    const dir = join(tmp, 'splits')
    mkdirSync(dir)
    for (const n of ['config.armeabi_v7a.apk', 'com.base.game.apk', 'UnityDataAssetPack.apk', 'notes.txt']) writeFileSync(join(dir, n), 'x')
    const apks = await resolveInstallApks(dir, join(tmp, 'ignored'))
    const names = apks.map((p) => p.split(/[\\/]/).pop())
    expect(names[0]).toBe('com.base.game.apk') // base before the config/asset splits
    expect(names).toContain('UnityDataAssetPack.apk')
    expect(names).toContain('config.armeabi_v7a.apk')
    expect(names).not.toContain('notes.txt') // non-apk files skipped
    expect(names).toHaveLength(3)
  })

  it('extracts a .xapk bundle (via the tar runner) and returns its apks', async () => {
    const xapk = join(tmp, 'game.xapk')
    writeFileSync(xapk, 'zip-bytes')
    const extractDir = join(tmp, 'out')
    // Stand in for tar: drop two apks where the extractor was asked to write.
    const run = async (_tar: string, argv: readonly string[]) => {
      const dest = argv[argv.indexOf('-C') + 1]
      writeFileSync(join(dest, 'base.apk'), 'x')
      writeFileSync(join(dest, 'config.armeabi_v7a.apk'), 'x')
      return { stdout: '', stderr: '' }
    }
    const apks = await resolveInstallApks(xapk, extractDir, { run: run as never })
    expect(apks.map((p) => p.split(/[\\/]/).pop())).toEqual(['base.apk', 'config.armeabi_v7a.apk'])
  })

  it('rejects an unsupported file', async () => {
    const f = join(tmp, 'readme.md')
    writeFileSync(f, 'x')
    await expect(resolveInstallApks(f, join(tmp, 'ignored'))).rejects.toThrow()
  })
})
