import { describe, expect, it } from 'vitest'
import { buildUnityCommand, findUnityEditor } from '../src/main/orchestrator/unity-tools'
import { toolsFor } from '../src/main/orchestrator/tools'

const base = { editor: String.raw`D:\U\6000.2.6f2\Editor\Unity.exe`, projectRoot: String.raw`D:\Projects\Game` }

describe('Unity tools', () => {
  it('builds a compile command', () => {
    const c = buildUnityCommand({ ...base, mode: 'compile', buildTarget: 'Android' })
    expect(c).toBe(String.raw`"D:\U\6000.2.6f2\Editor\Unity.exe" -batchmode -nographics -projectPath "D:\Projects\Game" -logFile - -buildTarget Android -quit`)
  })

  it('builds test and method commands and refuses injection', () => {
    expect(buildUnityCommand({ ...base, mode: 'test_playmode', testFilter: 'My.Tests' })).toContain('-runTests -testPlatform PlayMode')
    expect(buildUnityCommand({ ...base, mode: 'execute_method', method: 'Ns.Build.Run' })).toContain('-executeMethod Ns.Build.Run')
    expect(() => buildUnityCommand({ ...base, mode: 'execute_method', method: 'A.B & calc' })).toThrow()
    expect(() => buildUnityCommand({ ...base, mode: 'compile', buildTarget: 'x' })).toThrow()
    expect(() => buildUnityCommand({ ...base, projectRoot: 'D:/a" & calc', mode: 'compile' })).toThrow()
  })

  it('finds the editor by version', () => {
    const hit = String.raw`D:\EditorUnity\6000.2.6f2\Editor\Unity.exe`
    expect(findUnityEditor('6000.2.6f2', {}, (p) => p === hit)).toBe(hit)
    expect(findUnityEditor('1.0', {}, () => false)).toBeNull()
    expect(findUnityEditor('1.0', { UNITY_EDITOR_PATH: 'X' }, (p) => p === 'X')).toBe('X')
  })

  it('is offered only with a workspace', () => {
    const agent: any = { permissions: { runCommands: 'ask', readFiles: true, writeFiles: true, manageTasks: true } }
    expect(toolsFor(agent, { workspace: true }).some((t) => t.def.name === 'unity_run')).toBe(true)
    expect(toolsFor(agent, {}).some((t) => t.def.name === 'unity_run')).toBe(false)
  })
})

describe('project lock detection', () => {
  it('treats a leftover lock file nobody holds as not locked, a missing one too', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { isProjectLocked } = await import('../src/main/orchestrator/unity-tools')
    const root = mkdtempSync(join(tmpdir(), 'lk-'))
    expect(isProjectLocked(root)).toBe(false)
    mkdirSync(join(root, 'Temp'))
    writeFileSync(join(root, 'Temp', 'UnityLockfile'), '')
    expect(isProjectLocked(root)).toBe(false)
    // An editor holds the file exclusively, so opening it fails.
    expect(isProjectLocked(root, () => { throw new Error('EBUSY') })).toBe(true)
  })
})
