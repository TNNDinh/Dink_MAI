import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ANDROID_TOOLS, describeAction } from '../src/main/orchestrator/android-tools'
import { Sandbox } from '../src/main/workspace/sandbox'
import type { ToolContext } from '../src/main/orchestrator/tools'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** The command runner is a stand-in: it returns a canned adb result. The events are what the Activity panel receives. */
function setup(result: { exitCode: number; output: string }) {
  const root = mkdtempSync(join(tmpdir(), 'andact-'))
  roots.push(root)
  const sandbox = new Sandbox(root)
  const events: Array<{ level?: string; type: string; message: string; agentId?: string; data?: Record<string, unknown> }> = []
  const ctx = {
    db: { get: () => ({ title: 'Play-test' }) },
    events: { record: (e: (typeof events)[number]) => events.push(e) },
    agent: { id: 'a1', name: 'Tester', permissions: { runCommands: 'ask', readFiles: true, writeFiles: true, manageTasks: true } },
    projectId: 'p1',
    runId: 'r1',
    taskId: 't1',
    workspace: { sandbox: () => sandbox, project: () => ({ name: 'Game' }) },
    commands: { run: async () => ({ outcome: 'exited', durationMs: 5, ...result }) }
  } as unknown as ToolContext
  return { ctx, events }
}

describe('android_play shows its actions in the Activity panel', () => {
  it('describes each action in plain words', () => {
    expect(describeAction('tap', { x: 540.4, y: 960 })).toBe('tap (540,960)')
    expect(describeAction('swipe', { x: 1, y: 2, x2: 3, y2: 4 })).toBe('swipe (1,2) → (3,4)')
    expect(describeAction('key', { key: 'back' })).toBe('press key back')
    expect(describeAction('text', { text: 'hello' })).toBe('type "hello"')
    expect(describeAction('launch', { package: 'com.x.y' })).toBe('launch com.x.y')
    expect(describeAction('ui_dump', {})).toBe('read the screen')
    expect(describeAction('tap', {})).toBe('tap (?,?)')
  })

  it('records one event per action with the agent, and the screen summary for ui_dump', async () => {
    const xml = `<hierarchy><node text="Play" resource-id="a:id/p" class="android.widget.Button" content-desc="" clickable="true" bounds="[0,0][100,100]" /></hierarchy>`
    const { ctx, events } = setup({ exitCode: 0, output: xml })
    await ANDROID_TOOLS[0].execute(ctx, { action: 'ui_dump' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ level: 'info', type: 'android.action', agentId: 'a1' })
    expect(events[0].message).toBe('Tester: read the screen → OK (1 readable elements)')
  })

  it('marks a failed action as a warning', async () => {
    const { ctx, events } = setup({ exitCode: 1, output: 'error: no devices/emulators found' })
    await ANDROID_TOOLS[0].execute(ctx, { action: 'tap', x: 5, y: 6 })
    expect(events[0].level).toBe('warn')
    expect(events[0].message).toContain('tap (5,6) → adb exit code 1')
    expect(events[0].data).toMatchObject({ action: 'tap', ok: false })
  })

  it('announces a slow install before it runs, then the result', async () => {
    const { ctx, events } = setup({ exitCode: 0, output: 'Success' })
    // The APK must exist in the project; use a stand-in file.
    const { writeFileSync } = await import('node:fs')
    const root = (ctx.workspace!.sandbox('p1') as Sandbox).root
    writeFileSync(join(root, 'g.apk'), 'x')
    await ANDROID_TOOLS[0].execute(ctx, { action: 'install', apk: 'g.apk' })
    expect(events.map((e) => e.message)).toEqual(['Tester: install g.apk (can take a while)', 'Tester: install g.apk → OK'])
  })

  it('links the screenshot file', async () => {
    const { ctx, events } = setup({ exitCode: 0, output: '' })
    await ANDROID_TOOLS[0].execute(ctx, { action: 'screenshot', name: 'home' })
    expect(events[0].data).toMatchObject({ screenshot: 'atu_output/screens/home.png' })
  })
})
