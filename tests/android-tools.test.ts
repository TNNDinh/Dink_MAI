import { describe, expect, it } from 'vitest'
import { buildAndroidCommand, findAdb } from '../src/main/orchestrator/android-tools'

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
