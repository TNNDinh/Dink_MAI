import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GAME_INIT_TOOLS, buildCloneCommand, templateRepo, DEFAULT_TEMPLATE_REPO } from '../src/main/orchestrator/game-init'
import { classifyCommand } from '../src/main/security/command-policy'
import { Sandbox } from '../src/main/workspace/sandbox'
import type { ToolContext } from '../src/main/orchestrator/tools'

const gameInit = GAME_INIT_TOOLS[0]

/**
 * A tool context whose command runner, instead of running `git clone`, drops a minimal Unity project into the temp
 * folder the command names (unless `result` says the clone failed). That lets us test the whole seed-and-move flow.
 */
function fakeContext(root: string, result: Record<string, unknown> = { outcome: 'exited', exitCode: 0, durationMs: 1000, output: 'Cloning...' }, seed = true) {
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
        if (seed && result.outcome === 'exited' && result.exitCode === 0) {
          // The clone command ends with the temp folder name; fill it like a cloned Unity project would be.
          const temp = o.command.trim().split(/\s+/).pop() as string
          const tmp = join(root, temp)
          mkdirSync(join(tmp, 'ProjectSettings'), { recursive: true })
          mkdirSync(join(tmp, 'Assets'), { recursive: true })
          mkdirSync(join(tmp, '.git'), { recursive: true })
          writeFileSync(join(tmp, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.2.6f2\n')
          writeFileSync(join(tmp, 'CLAUDE.md'), 'base')
          writeFileSync(join(tmp, '.git', 'HEAD'), 'ref: refs/heads/base_mobile\n')
        }
        return result
      }
    }
  } as unknown as ToolContext
  return { ctx, ran, events }
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gi-'))
  delete process.env.GAME_TEMPLATE_REPO
})
afterEach(() => {
  delete process.env.GAME_TEMPLATE_REPO
  rmSync(root, { recursive: true, force: true })
})

describe('buildCloneCommand', () => {
  it('builds a shallow single-branch clone and validates its inputs', () => {
    const cmd = buildCloneCommand(DEFAULT_TEMPLATE_REPO, 'base_mobile', '.tmp')
    expect(cmd).toBe(`git clone --depth 1 --single-branch --branch base_mobile ${DEFAULT_TEMPLATE_REPO} .tmp`)
    // The command the policy sees needs user approval (not auto, not blocked).
    expect(classifyCommand(cmd).kind).toBe('ask')
  })

  it('rejects an unsafe branch or repo (no injection)', () => {
    expect(() => buildCloneCommand(DEFAULT_TEMPLATE_REPO, 'main && rm -rf /', '.tmp')).toThrow(/template name/)
    expect(() => buildCloneCommand(DEFAULT_TEMPLATE_REPO, '../evil', '.tmp')).toThrow(/template name/)
    expect(() => buildCloneCommand('http://evil.test/x.git', 'base_mobile', '.tmp')).toThrow(/https/)
    expect(() => buildCloneCommand('https://host/x.git; echo hi', 'base_mobile', '.tmp')).toThrow(/https/)
  })
})

describe('templateRepo', () => {
  it('uses the default, and a valid override, but ignores an unsafe one', () => {
    expect(templateRepo({})).toBe(DEFAULT_TEMPLATE_REPO)
    expect(templateRepo({ GAME_TEMPLATE_REPO: 'https://example.com/a/b.git' })).toBe('https://example.com/a/b.git')
    expect(templateRepo({ GAME_TEMPLATE_REPO: 'not a url' })).toBe(DEFAULT_TEMPLATE_REPO)
  })
})

describe('game_init', () => {
  it('seeds an empty project from the default base and moves the template up (dropping its .git)', async () => {
    const { ctx, ran, events } = fakeContext(root)
    const out = await gameInit.execute(ctx, {})
    expect(ran).toHaveLength(1)
    expect(ran[0]).toContain('--branch base_mobile')
    expect(ran[0]).toContain(DEFAULT_TEMPLATE_REPO)
    expect(existsSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'))).toBe(true)
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(root, '.game_template_tmp'))).toBe(false) // temp cleaned up
    expect(readdirSync(root)).not.toContain('.git') // the template's history was not kept
    expect(out).toContain('Unity 6000.2.6f2')
    expect(events.some((e) => e.type === 'game.init')).toBe(true)
  })

  it('honours the chosen template branch', async () => {
    const { ctx, ran } = fakeContext(root)
    await gameInit.execute(ctx, { template: 'base_pc' })
    expect(ran[0]).toContain('--branch base_pc')
  })

  it('refuses a folder that is already a Unity project', async () => {
    mkdirSync(join(root, 'ProjectSettings'), { recursive: true })
    writeFileSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.2.6f2\n')
    await expect(gameInit.execute(fakeContext(root).ctx, {})).rejects.toThrow(/already a Unity project/)
  })

  it('refuses a non-empty folder but ignores a pre-existing .git', async () => {
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'README.md'), 'hi')
    await expect(gameInit.execute(fakeContext(root).ctx, {})).rejects.toThrow(/not empty/)
  })

  it('cleans up and reports when the clone command fails', async () => {
    const { ctx } = fakeContext(root, { outcome: 'exited', exitCode: 128, durationMs: 10, output: 'fatal: Remote branch nope not found' }, false)
    await expect(gameInit.execute(ctx, { template: 'nope' })).rejects.toThrow(/failed.*exit code 128|Remote branch/)
    expect(existsSync(join(root, '.game_template_tmp'))).toBe(false)
  })

  it('is gated behind run-commands and write-files permissions', () => {
    const can = (p: Record<string, unknown>) => gameInit.allowed({ permissions: p } as never)
    expect(can({ runCommands: 'ask', writeFiles: true })).toBe(true)
    expect(can({ runCommands: 'none', writeFiles: true })).toBe(false)
    expect(can({ runCommands: 'ask', writeFiles: false })).toBe(false)
  })
})
