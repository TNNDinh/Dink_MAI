import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatMessage } from '../src/main/providers/types'
import { trimOldToolResults } from '../src/main/orchestrator/history'
import { compactUiDump } from '../src/main/orchestrator/ui-dump'
import { describeCodeEvidence, EVIDENCE_RULES } from '../src/main/orchestrator/evidence'
import { environmentNote } from '../src/main/orchestrator/orchestrator'
import { findAtuDir } from '../src/main/orchestrator/atu-tools'
import { ToolPaths, resolveAtuDir } from '../src/main/services/tool-paths'
import { Database } from '../src/main/db/database'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tok-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** A tool-call round as the orchestrator stores it: the assistant asks, the user turn carries the results. */
const round = (id: string, result: string, isError = false): ChatMessage[] => [
  { role: 'assistant', content: [{ type: 'tool_call', id, name: 'read_file', arguments: {} }] as never },
  { role: 'user', content: [{ type: 'tool_result', toolCallId: id, content: result, isError }] }
]
const resultOf = (m: ChatMessage): string => ((m.content as Array<{ content: string }>)[0] as { content: string }).content

describe('trimOldToolResults', () => {
  it('keeps the newest results whole and shortens the older ones', () => {
    const big = 'x'.repeat(5000)
    const messages: ChatMessage[] = [{ role: 'user', content: 'goal' }, ...round('a', big), ...round('b', big), ...round('c', big), ...round('d', big), ...round('e', big)]
    expect(trimOldToolResults(messages)).toBe(3)
    const results = messages.filter((m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>)[0].type === 'tool_result').map(resultOf)
    expect(results[0].length).toBeLessThan(900)
    expect(results[0]).toContain('shortened to save tokens')
    expect(results[0]).toContain('5000 characters')
    expect(results.slice(0, 3).every((r) => r.length < 900)).toBe(true)
    expect(results.slice(3).every((r) => r.length === 5000)).toBe(true)
  })

  it('is stable when run every round and never shortens twice', () => {
    const messages: ChatMessage[] = [...round('a', 'y'.repeat(3000)), ...round('b', 'y'.repeat(3000)), ...round('c', 'y'.repeat(3000)), ...round('d', 'y'.repeat(3000))]
    expect(trimOldToolResults(messages)).toBe(2)
    const once = resultOf(messages[1])
    expect(trimOldToolResults(messages)).toBe(0)
    expect(resultOf(messages[1])).toBe(once)
  })

  it('leaves small results, errors and the assistant turns alone', () => {
    const messages: ChatMessage[] = [...round('a', 'short'), ...round('b', 'z'.repeat(4000), true), ...round('c', 'q'), ...round('d', 'q'), ...round('e', 'q')]
    expect(trimOldToolResults(messages)).toBe(0)
    expect(resultOf(messages[1])).toBe('short')
    expect(resultOf(messages[3])).toHaveLength(4000)
    expect(Array.isArray(messages[0].content)).toBe(true)
  })

  it('keeps the cost of a long loop roughly linear', () => {
    const size = (m: ChatMessage[]) => JSON.stringify(m).length
    const grow = (trim: boolean): number => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'goal' }]
      let sent = 0
      for (let i = 0; i < 12; i++) {
        messages.push(...round(`t${i}`, 'w'.repeat(14_000)))
        if (trim) trimOldToolResults(messages)
        sent += size(messages) // what the model is sent on the next round
      }
      return sent
    }
    expect(grow(true)).toBeLessThan(grow(false) / 2)
  })
})

const NODE = (attrs: string): string => `<node index="0" ${attrs} />`
const XML = (...nodes: string[]): string => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${nodes.join('')}</hierarchy>\nUI hierchary dumped to: /dev/tty`

describe('compactUiDump', () => {
  it('keeps what can be read or pressed, with a tap point, and drops layout containers', () => {
    const xml = XML(
      NODE('text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" bounds="[0,0][1080,1920]"'),
      NODE('text="Play" resource-id="com.game:id/btn_play" class="android.widget.Button" content-desc="" clickable="true" bounds="[100,200][300,400]"'),
      NODE('text="Tom &amp; Jerry" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" bounds="[0,10][200,50]"'),
      NODE('text="" resource-id="" class="android.view.View" content-desc="Settings" clickable="true" bounds="[900,0][1000,100]"')
    )
    const r = compactUiDump(xml)!
    expect(r.text).toContain('Screen 1080x1920, 4 view nodes, 3 readable or clickable')
    expect(r.text).toContain('"Play" #btn_play [Button, clickable] tap (200,300)')
    expect(r.text).toContain('"Tom & Jerry"')
    expect(r.text).toContain('desc "Settings"')
    expect(r.text).toContain('tap (950,50)')
    expect(r.text).not.toContain('FrameLayout')
    expect(r.text).not.toContain('<node')
  })

  it('is far smaller than the raw dump', () => {
    const nodes = Array.from({ length: 300 }, (_, i) =>
      NODE(`text="Item ${i}" resource-id="com.game:id/row_${i}" class="android.widget.TextView" content-desc="" clickable="${i % 3 === 0}" bounds="[0,${i * 10}][1080,${i * 10 + 9}]"`)
    )
    const xml = XML(...nodes)
    const r = compactUiDump(xml)!
    expect(r.shown).toBe(60)
    expect(r.text).toContain('first 60 shown')
    expect(r.text.length).toBeLessThan(xml.length / 4)
  })

  it('says so when a game draws its own interface, and passes non-dumps through', () => {
    const r = compactUiDump(XML(NODE('text="" resource-id="" class="android.view.SurfaceView" content-desc="" clickable="false" bounds="[0,0][1920,1080]"')))!
    expect(r.shown).toBe(0)
    expect(r.text).toContain('draws its own interface')
    expect(compactUiDump('ERROR: null root node returned by UiTestAutomationBridge.')).toBeNull()
  })
})

describe('describeCodeEvidence', () => {
  const make = (files: Record<string, string>): string => {
    const root = tmp()
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, body)
    }
    return root
  }

  it('Mono: real C# is the strong evidence', () => {
    const e = describeCodeEvidence(make({ 'REPORT.md': '- Backend       : Mono\n', 'decompiled/Player.cs': 'class Player {}', 'decompiled/sub/Enemy.cs': 'class Enemy {}' }))
    expect(e.backend).toBe('Mono')
    expect(e.monoSources).toBe(2)
    expect(e.summary).toContain('REAL C# SOURCE: 2 files')
    expect(e.summary).not.toContain('NO LOGIC')
  })

  it('IL2CPP outlines only: says behaviour cannot be read and how to get more', () => {
    const e = describeCodeEvidence(make({ 'REPORT.md': '- Backend       : IL2CPP\n', 'il2cpp/dump.cs': 'class A {}' }))
    expect(e.backend).toBe('IL2CPP')
    expect(e.hasDump).toBe(true)
    expect(e.summary).toContain('NO logic')
    expect(e.summary).toContain('NO LOGIC')
    expect(e.summary).toContain('decompile_logic=true')
    expect(e.summary).toContain('new name')
  })

  it('IL2CPP with Ghidra output: pseudo-C is labelled as unreliable', () => {
    const e = describeCodeEvidence(make({ 'REPORT.md': '- Backend       : IL2CPP\n', 'il2cpp/dump.cs': 'x', 'logic/FUN_0010.c': 'void f(){}', 'logic/FUN_0020.c': 'void g(){}' }))
    expect(e.pseudoC).toBe(2)
    expect(e.summary).toContain('PSEUDO-C: 2 files in logic/')
    expect(e.summary).toContain('NOT the original code')
    expect(e.summary).not.toContain('NO LOGIC')
  })

  it('works without a report, and admits when no code came out', () => {
    expect(describeCodeEvidence(make({ 'decompiled/A.cs': 'x' })).backend).toBe('Mono')
    const none = describeCodeEvidence(make({ 'extracted/a.png': 'x' }))
    expect(none.summary).toContain('Only assets are available')
  })

  it('always ends with the VERIFIED / INFERRED rule', () => {
    expect(describeCodeEvidence(make({ 'extracted/a.png': 'x' })).summary.endsWith(EVIDENCE_RULES)).toBe(true)
    expect(EVIDENCE_RULES).toContain('[VERIFIED')
    expect(EVIDENCE_RULES).toContain('[INFERRED]')
  })
})

describe('environmentNote', () => {
  it('adds the evidence rule only when the game-analysis tools are offered', () => {
    expect(environmentNote(new Set(['apk_to_unity']))).toContain('[INFERRED]')
    expect(environmentNote(new Set(['android_play']))).toContain('[VERIFIED')
    expect(environmentNote(new Set(['read_file']))).not.toContain('[INFERRED]')
  })
})

describe('Dink_ATU folder picked in the app', () => {
  const atu = (): string => {
    const d = tmp()
    writeFileSync(join(d, 'apk2unity.ps1'), '# stand-in script')
    return d
  }
  const db = (): Database => {
    const d = new Database(':memory:')
    d.migrate()
    return d
  }

  it('prefers the picked folder, then the environment, then the usual places', () => {
    const picked = atu()
    const env = atu()
    expect(resolveAtuDir(picked, { DINK_ATU_DIR: env })).toEqual({ dir: picked, source: 'setting' })
    expect(resolveAtuDir(null, { DINK_ATU_DIR: env })).toEqual({ dir: env, source: 'env' })
    expect(resolveAtuDir(null, {}, (p) => p === join('D:\\apk2unity', 'apk2unity.ps1'))).toEqual({ dir: 'D:\\apk2unity', source: 'default' })
    expect(findAtuDir({}, () => false)).toBeNull()
    expect(findAtuDir({}, () => false, picked)).toBeNull() // exists() says no, so a stale pick is skipped
  })

  it('ignores a picked folder that has since been deleted and falls through', () => {
    const env = atu()
    expect(resolveAtuDir(join(tmp(), 'gone'), { DINK_ATU_DIR: env })).toEqual({ dir: env, source: 'env' })
  })

  it('saves a valid folder, rejects a wrong one, and can forget it', () => {
    const tp = new ToolPaths(db())
    const good = atu()
    const saved = tp.setAtu(good)
    expect(saved).toMatchObject({ dir: good, source: 'setting', configured: good, configuredValid: true })
    expect(tp.configuredAtu()).toBe(good)
    expect(() => tp.setAtu(tmp())).toThrow(/apk2unity\.ps1 was not found/)
    expect(tp.configuredAtu()).toBe(good) // a rejected pick changes nothing
    expect(tp.setAtu(null).configured).toBeNull()
  })

  it('reports a picked folder that went missing, and whether tools/ is installed', () => {
    const tp = new ToolPaths(db())
    const good = atu()
    expect(tp.setAtu(good).toolsInstalled).toBe(false)
    mkdirSync(join(good, 'tools'))
    expect(tp.atuStatus().toolsInstalled).toBe(true)
    rmSync(join(good, 'apk2unity.ps1'))
    expect(tp.atuStatus()).toMatchObject({ configured: good, configuredValid: false })
  })
})
