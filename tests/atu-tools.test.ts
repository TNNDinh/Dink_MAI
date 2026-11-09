import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAtuCommand, findAtuDir, searchLargeFile } from '../src/main/orchestrator/atu-tools'

const base = { atuDir: 'D:/Projects/Dink_ATU', input: 'D:/Work/game.apk', outRoot: 'D:/Work/atu_output' }

describe('Dink_ATU tool', () => {
  it('builds analyze and convert commands', () => {
    const a = buildAtuCommand({ ...base, action: 'analyze' })
    expect(a).toMatch(/-File "D:.Projects.Dink_ATU.apk2unity.ps1"/)
    expect(a).toContain('-Apk "D:/Work/game.apk"')
    expect(a.endsWith('-Analyze')).toBe(true)
    const c = buildAtuCommand({ ...base, action: 'convert', name: 'My-Game_1', decompileLogic: true, skipAssetRipper: true })
    expect(c).toContain('-Name My-Game_1')
    expect(c).toContain('-DecompileLogic')
    expect(c).toContain('-SkipAssetRipper')
    expect(c).not.toContain('-Analyze')
  })

  it('refuses names and paths that could add another command', () => {
    expect(() => buildAtuCommand({ ...base, action: 'convert', name: 'x; calc' })).toThrow()
    expect(() => buildAtuCommand({ ...base, action: 'convert', input: 'D:/a" & calc' })).toThrow()
    expect(() => buildAtuCommand({ ...base, action: 'convert', input: 'D:/a$(calc).apk' })).toThrow()
  })

  it('finds the install folder', () => {
    expect(findAtuDir({ DINK_ATU_DIR: 'X' }, (p) => p.startsWith('X'))).toBe('X')
    expect(findAtuDir({}, () => false)).toBeNull()
  })
})

describe('search_large_file', () => {
  const file = () => {
    const f = join(mkdtempSync(join(tmpdir(), 'sl-')), 'dump.cs')
    writeFileSync(f, ['// Namespace:', 'public class PlayerController : MonoBehaviour', 'public struct Vec', 'public class GameManager', 'x'.repeat(500) + ' class Long'].join('\n'))
    return f
  }
  it('finds substrings and regexes with line numbers, clipping long lines', async () => {
    const f = file()
    expect((await searchLargeFile(f, 'class ', false, 10)).hits.map((h) => h.split(':')[0])).toEqual(['2', '4', '5'])
    expect((await searchLargeFile(f, String.raw`^public class \w+Manager`, true, 10)).hits).toEqual(['4: public class GameManager'])
    expect((await searchLargeFile(f, 'Long', false, 10)).hits[0].length).toBeLessThan(320)
  })
  it('stops at the limit and says so', async () => {
    const r = await searchLargeFile(file(), 'class', false, 1)
    expect(r.hits).toHaveLength(1)
    expect(r.truncated).toBe(true)
  })
})
