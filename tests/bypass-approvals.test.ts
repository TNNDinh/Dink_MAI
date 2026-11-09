import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../src/main/db/database'
import { EventService } from '../src/main/services/events'
import { ProjectService } from '../src/main/services/projects'
import { ApprovalService, CommandRefusedError, CommandService } from '../src/main/workspace/commands'
import { Sandbox } from '../src/main/workspace/sandbox'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** Real commands run in a temp folder; only the model is absent. A chained command is one the policy cannot check, so it asks. */
const CHAINED = 'echo one && echo two'

let db: Database
let events: EventService
let approvals: ApprovalService
let commands: CommandService
let projects: ProjectService
let sandbox: Sandbox
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bypass-'))
  roots.push(root)
  db = new Database(':memory:')
  db.migrate()
  events = new EventService(db)
  approvals = new ApprovalService()
  commands = new CommandService(db, events, approvals)
  projects = new ProjectService(db, events, { defaultProjectsRoot: root, gitInit: async () => true })
  db.run(`INSERT INTO projects (id, name, type, root_path, goal, created_at, updated_at) VALUES ('p1', 'Proj', 'web', ?, 'g', 1, 1)`, root)
  sandbox = new Sandbox(root)
})

const run = (command: string, policy: 'none' | 'ask' | 'allowlist' = 'allowlist') =>
  commands.run({ projectId: 'p1', projectName: 'Proj', sandbox, command, origin: 'agent', policy, timeoutMs: 20_000 })
const eventTypes = (): string[] => db.all<{ type: string }>(`SELECT type FROM events`).map((e) => e.type)

describe('Bypass approvals (per project, opt-in)', () => {
  it('is off by default, validated, and recorded when it changes', () => {
    expect(projects.get('p1')?.bypassApprovals).toBe(false)
    expect(projects.update({ id: 'p1', bypassApprovals: true }).bypassApprovals).toBe(true)
    expect(() => projects.update({ id: 'p1', bypassApprovals: 'yes' as never })).toThrow(/on or off/)
    expect(eventTypes()).toContain('project.bypass_approvals')
    expect(projects.update({ id: 'p1', name: 'Renamed' }).bypassApprovals).toBe(true)
    expect(projects.update({ id: 'p1', bypassApprovals: false }).bypassApprovals).toBe(false)
  })

  it('without bypass a chained command waits for the user', async () => {
    const p = run(CHAINED)
    await new Promise((r) => setTimeout(r, 50))
    expect(approvals.list()).toHaveLength(1)
    approvals.respond(approvals.list()[0].id, false)
    await expect(p).rejects.toBeInstanceOf(CommandRefusedError)
  })

  it('with bypass the same command runs at once, is logged, and nothing is queued', async () => {
    projects.update({ id: 'p1', bypassApprovals: true })
    const r = await run(CHAINED)
    expect(r.outcome).toBe('exited')
    expect(r.output).toContain('two')
    expect(approvals.list()).toHaveLength(0)
    expect(eventTypes()).toContain('command.bypassed')
    const row = db.get<{ decision: string; reason: string }>(`SELECT decision, reason FROM command_log WHERE id = ?`, r.id)!
    expect(row.decision).toBe('auto_allowed')
    expect(row.reason).toMatch(/Bypass approvals is on/)
  })

  it('also lifts an agent that is set to ask before every command', async () => {
    projects.update({ id: 'p1', bypassApprovals: true })
    expect((await run('node --version', 'ask')).outcome).toBe('exited')
  })

  it('never lifts a hard block or an agent that may not run commands', async () => {
    projects.update({ id: 'p1', bypassApprovals: true })
    await expect(run('shutdown /s /t 0')).rejects.toThrow(/Blocked/)
    await expect(run('reg delete HKCU\\Software\\X /f')).rejects.toThrow(/Blocked/)
    await expect(run(CHAINED, 'none')).rejects.toThrow(/not allowed to run commands/)
    expect(eventTypes()).not.toContain('command.bypassed')
  })

  it('only applies to the project that turned it on', async () => {
    db.run(`INSERT INTO projects (id, name, type, root_path, goal, created_at, updated_at) VALUES ('p2', 'Other', 'web', ?, 'g', 1, 1)`, join(root, 'other'))
    projects.update({ id: 'p1', bypassApprovals: true })
    const p = commands.run({ projectId: 'p2', projectName: 'Other', sandbox, command: CHAINED, origin: 'agent', policy: 'allowlist', timeoutMs: 20_000 })
    await new Promise((r) => setTimeout(r, 50))
    expect(approvals.list().map((a) => a.projectId)).toEqual(['p2'])
    approvals.respond(approvals.list()[0].id, false)
    await expect(p).rejects.toBeInstanceOf(CommandRefusedError)
  })
})
