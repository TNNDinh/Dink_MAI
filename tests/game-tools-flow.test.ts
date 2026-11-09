import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UNITY_BRIDGE_TOOLS, setBridgeFetchForTests, BRIDGE_PACKAGE } from '../src/main/orchestrator/unity-bridge'
import { UNITY_TOOLS } from '../src/main/orchestrator/unity-tools'
import { ATU_TOOLS } from '../src/main/orchestrator/atu-tools'
import { ANDROID_TOOLS } from '../src/main/orchestrator/android-tools'
import { BUILD_TOOLS } from '../src/main/orchestrator/build-gate'
import { Sandbox } from '../src/main/workspace/sandbox'
import type { ToolContext } from '../src/main/orchestrator/tools'

/** A tool context whose command runner records what it was asked to run instead of running it. */
function fakeContext(root: string, result: Record<string, unknown> = { outcome: 'exited', exitCode: 0, durationMs: 1000, output: 'ok' }) {
  const sandbox = new Sandbox(root)
  const ran: string[] = []
  const events: Array<{ level?: string; type: string; message: string }> = []
  const ctx = {
    db: { get: () => ({ title: 'Task' }) },
    events: { record: (e: { level?: string; type: string; message: string }) => events.push(e) },
    agent: { id: 'a1', name: 'Dev', permissions: { runCommands: 'ask', readFiles: true, writeFiles: true, manageTasks: true } },
    projectId: 'p1',
    runId: 'r1',
    taskId: 't1',
    workspace: { sandbox: () => sandbox, project: () => ({ name: 'Game' }) },
    commands: {
      run: async (o: { command: string }) => {
        ran.push(o.command)
        return result
      }
    }
  } as unknown as ToolContext
  return { ctx, ran, events }
}

const unityTool = UNITY_TOOLS[0]
const bridgeTool = UNITY_BRIDGE_TOOLS[0]
const atuTool = ATU_TOOLS[0]
const androidTool = ANDROID_TOOLS[0]
const buildTool = BUILD_TOOLS[0]

let root: string
const makeUnityProject = (version = '6000.2.6f2') => {
  mkdirSync(join(root, 'ProjectSettings'), { recursive: true })
  mkdirSync(join(root, 'Packages'), { recursive: true })
  mkdirSync(join(root, 'Assets'), { recursive: true })
  writeFileSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${version}\n`)
  writeFileSync(join(root, 'Packages', 'manifest.json'), '{"dependencies":{}}')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gt-'))
  delete process.env.UNITY_EDITOR_PATH
})
afterEach(() => {
  setBridgeFetchForTests(undefined)
  delete process.env.UNITY_EDITOR_PATH
  delete process.env.DINK_ATU_DIR
  rmSync(root, { recursive: true, force: true })
})

describe('unity_run', () => {
  it('refuses a folder that is not a Unity project', async () => {
    await expect(unityTool.execute(fakeContext(root).ctx, { mode: 'compile' })).rejects.toThrow(/not a Unity project/)
  })

  it('ignores a stale lock file that no editor holds', async () => {
    makeUnityProject()
    mkdirSync(join(root, 'Temp'))
    writeFileSync(join(root, 'Temp', 'UnityLockfile'), '')
    const exe = join(root, 'Unity.exe')
    writeFileSync(exe, '')
    process.env.UNITY_EDITOR_PATH = exe
    const { ctx, ran } = fakeContext(root)
    await unityTool.execute(ctx, { mode: 'compile' })
    expect(ran).toHaveLength(1)
  })

  it('runs the editor found through UNITY_EDITOR_PATH and lists compile errors first', async () => {
    makeUnityProject()
    const exe = join(root, 'Unity.exe')
    writeFileSync(exe, '')
    process.env.UNITY_EDITOR_PATH = exe
    const { ctx, ran } = fakeContext(root, { outcome: 'exited', exitCode: 1, durationMs: 5000, output: 'x\nAssets/A.cs(1,2): error CS1002: ; expected\ny' })
    const out = await unityTool.execute(ctx, { mode: 'compile' })
    expect(ran).toHaveLength(1)
    expect(ran[0]).toContain('-batchmode')
    expect(ran[0]).toContain('-quit')
    expect(out).toContain('Unity exit code 1')
    expect(out).toContain('Compile errors:\nAssets/A.cs(1,2): error CS1002')
  })

  it('rejects an unknown mode and an unsafe method', async () => {
    makeUnityProject()
    await expect(unityTool.execute(fakeContext(root).ctx, { mode: 'format' })).rejects.toThrow(/mode must be/)
  })
})

describe('unity_bridge', () => {
  it('installs the bundled package, then reports it is already there', async () => {
    makeUnityProject()
    const { ctx } = fakeContext(root)
    expect(await bridgeTool.execute(ctx, { action: 'install' })).toMatch(/Installed the Unity MCP bridge|Added/)
    expect(existsSync(join(root, 'Packages', BRIDGE_PACKAGE)) || readFileSync(join(root, 'Packages', 'manifest.json'), 'utf8').includes(BRIDGE_PACKAGE)).toBe(true)
    expect(await bridgeTool.execute(ctx, { action: 'install' })).toMatch(/already/)
  })

  it('says so when the editor is not open', async () => {
    makeUnityProject()
    setBridgeFetchForTests(async () => {
      throw new Error('refused')
    })
    const out = await bridgeTool.execute(fakeContext(root).ctx, { action: 'compile_errors' })
    expect(out).toMatch(/No open Unity editor/)
    expect(out).toMatch(/unity_run/)
  })

  it('talks to the editor whose project path matches and sends the right request', async () => {
    makeUnityProject()
    const calls: Array<{ url: string; body: string }> = []
    setBridgeFetchForTests(async (url, init) => {
      calls.push({ url, body: init?.body ?? '' })
      return { ok: true, status: 200, text: async () => JSON.stringify(url.endsWith('/ping') ? { projectPath: root } : { isCompiling: false, errors: [] }) }
    })
    const { ctx } = fakeContext(root)
    expect(await bridgeTool.execute(ctx, { action: 'status' })).toContain('connected on port 7890')
    expect(await bridgeTool.execute(ctx, { action: 'compile_errors' })).toContain('isCompiling')
    await bridgeTool.execute(ctx, { action: 'menu_item', menu_path: 'Tools/X' })
    expect(calls.some((c) => c.url.endsWith('/editor/execute-menu-item') && c.body.includes('Tools/X'))).toBe(true)
    await expect(bridgeTool.execute(ctx, { action: 'execute_code' })).rejects.toThrow(/code is required/)
  })
})

describe('apk_to_unity', () => {
  it('explains how to install Dink_ATU when it is missing', async () => {
    process.env.DINK_ATU_DIR = join(root, 'nowhere')
    await expect(atuTool.execute(fakeContext(root).ctx, { action: 'analyze', input: 'g.apk' })).rejects.toThrow(/Dink_ATU is not installed|has no tools/)
  })

  it('rejects an input outside the project and one that does not exist', async () => {
    const atu = join(root, 'atu')
    mkdirSync(join(atu, 'tools'), { recursive: true })
    writeFileSync(join(atu, 'apk2unity.ps1'), '')
    process.env.DINK_ATU_DIR = atu
    const { ctx } = fakeContext(root)
    await expect(atuTool.execute(ctx, { action: 'analyze', input: '../evil.apk' })).rejects.toThrow()
    await expect(atuTool.execute(ctx, { action: 'analyze', input: 'missing.apk' })).rejects.toThrow(/does not exist/)
  })

  it('runs the script for an existing APK and writes output under atu_output', async () => {
    const atu = join(root, 'atu')
    mkdirSync(join(atu, 'tools'), { recursive: true })
    writeFileSync(join(atu, 'apk2unity.ps1'), '')
    process.env.DINK_ATU_DIR = atu
    writeFileSync(join(root, 'game.apk'), 'x')
    const { ctx, ran } = fakeContext(root)
    const out = await atuTool.execute(ctx, { action: 'convert', input: 'game.apk', name: 'Game1', decompile_logic: true })
    expect(ran[0]).toContain('-Name Game1')
    expect(ran[0]).toContain('-DecompileLogic')
    expect(ran[0]).toContain('atu_output')
    expect(out).toContain('Dink_ATU exit code 0')
  })
})

describe('android_play', () => {
  it('runs adb for a tap and passes through failures with a hint', async () => {
    const ok = fakeContext(root)
    expect(await androidTool.execute(ok.ctx, { action: 'tap', x: 5, y: 6 })).toMatch(/^OK\./)
    expect(ok.ran[0]).toContain('input tap 5 6')
    const bad = fakeContext(root, { outcome: 'exited', exitCode: 1, durationMs: 10, output: 'error: no devices/emulators found' })
    expect(await androidTool.execute(bad.ctx, { action: 'ui_dump' })).toMatch(/BlueStacks running with ADB enabled/)
  })

  it('saves screenshots into atu_output/screens and refuses an unknown action', async () => {
    const { ctx, ran } = fakeContext(root)
    const out = await androidTool.execute(ctx, { action: 'screenshot', name: 'home' })
    expect(out).toContain('atu_output/screens/home.png')
    expect(ran[0]).toContain('screencap')
    expect(existsSync(join(root, 'atu_output', 'screens'))).toBe(true)
    await expect(androidTool.execute(ctx, { action: 'format' })).rejects.toThrow(/action must be/)
  })

  it('install needs an APK that exists in the project', async () => {
    const { ctx } = fakeContext(root)
    await expect(androidTool.execute(ctx, { action: 'install' })).rejects.toThrow(/apk is required/)
    await expect(androidTool.execute(ctx, { action: 'install', apk: 'nope.apk' })).rejects.toThrow(/does not exist/)
  })
})

describe('android_build', () => {
  const withEditor = () => {
    makeUnityProject()
    const exe = join(root, 'Unity.exe')
    writeFileSync(exe, '')
    process.env.UNITY_EDITOR_PATH = exe
  }
  const extractOriginal = () => {
    mkdirSync(join(root, 'atu_output', 'g', 'UnityProject', 'Assets'), { recursive: true })
    writeFileSync(join(root, 'atu_output', 'g', 'UnityProject', 'Assets', 'hero.png'), 'ORIGINAL')
    writeFileSync(join(root, 'Assets', 'hero.png'), 'ORIGINAL')
  }

  it('refuses an AAB while an original asset remains, without starting Unity', async () => {
    withEditor()
    extractOriginal()
    const { ctx, ran, events } = fakeContext(root)
    await expect(buildTool.execute(ctx, { target: 'aab' })).rejects.toThrow(/AAB BUILD REFUSED[\s\S]*Assets\/hero\.png/)
    expect(ran).toHaveLength(0)
    expect(events.some((e) => e.level === 'error' && e.type === 'build.gate')).toBe(true)
  })

  it('builds the test APK with a red banner, a warning file and an error event', async () => {
    withEditor()
    extractOriginal()
    mkdirSync(join(root, 'Builds'), { recursive: true })
    writeFileSync(join(root, 'Builds', 'game-TEST.apk'), 'apk')
    const { ctx, ran, events } = fakeContext(root)
    const out = await buildTool.execute(ctx, { target: 'apk' })
    expect(out.startsWith('🔴 TEST BUILD ONLY')).toBe(true)
    expect(ran[0]).toContain('DinhMai.BuildTools.BuildAndroid')
    expect(ran[0]).toContain('"-dmAab" "false"')
    expect(existsSync(join(root, 'Assets', 'Editor', 'DinhMaiBuild.cs'))).toBe(true)
    expect(readFileSync(join(root, 'Builds', 'TEST_BUILD_WARNING.txt'), 'utf8')).toContain('TEST BUILD ONLY')
    expect(events.some((e) => e.level === 'error')).toBe(true)
  })

  it('allows the AAB once the original is replaced', async () => {
    withEditor()
    extractOriginal()
    writeFileSync(join(root, 'Assets', 'hero.png'), 'NEW ART')
    mkdirSync(join(root, 'Builds'), { recursive: true })
    writeFileSync(join(root, 'Builds', 'game.aab'), 'aab')
    const { ctx, ran } = fakeContext(root)
    const out = await buildTool.execute(ctx, { target: 'aab' })
    expect(ran[0]).toContain('"-dmAab" "true"')
    expect(out).toContain('Built Builds/game.aab')
  })

  it('rejects a bad target', async () => {
    makeUnityProject()
    await expect(buildTool.execute(fakeContext(root).ctx, { target: 'exe' })).rejects.toThrow(/target must be/)
  })
})
