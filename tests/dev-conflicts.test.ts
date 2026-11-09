import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../src/main/db/database'
import { CallCancelledError, type CompleteRequest, type CompleteResult, type LlmGateway } from '../src/main/orchestrator/gateway'
import { WORKSPACE_TOOLS } from '../src/main/orchestrator/file-tools'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import type { ToolContext } from '../src/main/orchestrator/tools'
import { createChatProvider } from '../src/main/providers/registry'
import { AgentService } from '../src/main/services/agents'
import { ConnectionService } from '../src/main/services/connections'
import { EventService } from '../src/main/services/events'
import { TaskService } from '../src/main/services/tasks'
import { ContextIndexer } from '../src/main/workspace/indexer'
import { FileDeadlockError, FileLockedError, FileLocks, LOCK_POLL_MS } from '../src/main/workspace/locks'
import { WorkspaceService, type Actor } from '../src/main/workspace/workspace'
import { devGoal } from '../src/renderer/src/lib/phases'
import { MemorySecrets } from './helpers/memory-secrets'
import { MockServer } from './helpers/mock-server'

const server = new MockServer()
beforeAll(() => server.start())
afterAll(() => server.stop())

const roots: string[] = []
afterAll(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })))

let db: Database
let events: EventService
let agents: AgentService
let tasks: TaskService
let connId: string
let root: string

beforeEach(async () => {
  server.reset()
  root = mkdtempSync(join(tmpdir(), 'mads-conflict-'))
  roots.push(root)
  db = new Database(':memory:')
  db.migrate()
  events = new EventService(db)
  const conns = new ConnectionService(db, events, new MemorySecrets(), { providerFactory: (c) => createChatProvider({ ...c, maxRetries: 0 }) })
  agents = new AgentService(db, events, conns)
  tasks = new TaskService(db, events)
  db.run(`INSERT INTO projects (id, name, type, root_path, goal, created_at, updated_at) VALUES ('p1', 'Proj', 'web', ?, 'Ship it', 1, 1)`, root)
  connId = (await conns.create({ kind: 'openai', name: 'Conn', baseUrl: `${server.url}/v1`, apiKey: 'sk-test-key-0123456789' })).id
})

const hire = (role: string, name?: string) => agents.create({ templateKey: role, projectId: 'p1', connectionId: connId, model: 'gpt-x', ...(name ? { name } : {}) })
const makeTask = (title: string, runId = 'r1') => {
  const id = randomUUID()
  db.run(`INSERT OR IGNORE INTO runs (id, project_id, goal, status, created_at) VALUES (?, 'p1', 'g', 'running', 1)`, runId)
  db.run(`INSERT INTO tasks (id, project_id, run_id, title, description, status, created_at, updated_at) VALUES (?, 'p1', ?, ?, '', 'in_progress', 1, 1)`, id, runId, title)
  return id
}

// ------------------------------------------------------------------ waiting for a file another developer edits

describe('FileLocks.acquireWaiting', () => {
  let clock: number
  let l: FileLocks
  let a: string
  let b: string
  let ta: string
  let tb: string
  /** A sleep that moves the injected clock instead of waiting, and lets a test act "while the other developer works". */
  let during: (ms: number) => void
  const sleep = async (ms: number): Promise<void> => {
    clock += ms
    during(ms)
  }
  beforeEach(() => {
    a = hire('lead_developer').id
    b = hire('frontend_developer').id
    ta = makeTask('Feature A')
    tb = makeTask('Feature B')
    clock = 1_000_000
    l = new FileLocks(db, () => clock)
    during = () => {}
  })

  it('takes a free file at once and says it did not wait', async () => {
    expect(await l.acquireWaiting('p1', 'a.ts', a, ta, { sleep })).toBe(false)
    expect(l.heldByOther('p1', 'a.ts', b)?.agentId).toBe(a)
  })

  it('waits until the other developer’s task ends, then takes the file and says it waited', async () => {
    l.acquire('p1', 'src/shared.ts', a, ta)
    let polls = 0
    during = () => {
      if (++polls === 3) l.releaseTask(ta) // developer A finishes after a few polls
    }
    const noted: string[] = []
    expect(await l.acquireWaiting('p1', 'src/shared.ts', b, tb, { sleep, onWait: (h) => noted.push(h.taskTitle ?? '') })).toBe(true)
    expect(polls).toBe(3)
    expect(noted).toEqual(['Feature A']) // reported once, not on every poll
    expect(l.heldByOther('p1', 'src/shared.ts', a)?.agentId).toBe(b)
  })

  it('gives up after the wait limit with the normal "locked" message', async () => {
    l.acquire('p1', 'x.ts', a, ta, 60 * 60_000)
    await expect(l.acquireWaiting('p1', 'x.ts', b, tb, { sleep, waitMs: LOCK_POLL_MS * 3 })).rejects.toThrow(FileLockedError)
  })

  it('stops waiting when the run is aborted', async () => {
    l.acquire('p1', 'x.ts', a, ta, 60 * 60_000)
    const c = new AbortController()
    during = () => c.abort()
    await expect(l.acquireWaiting('p1', 'x.ts', b, tb, { sleep, signal: c.signal })).rejects.toThrow(FileLockedError)
  })

  it('refuses at once when two tasks would wait for each other (circular wait), instead of hanging', async () => {
    l.acquire('p1', 'one.ts', a, ta)
    l.acquire('p1', 'two.ts', b, tb)
    let seenDeadlock: unknown = null
    // A waits for two.ts (held by B)...
    during = () => {
      // ...and while A waits, B asks for one.ts (held by A): that would be a circle.
      if (seenDeadlock === null) seenDeadlock = 'asked'
      else return
      void l.acquireWaiting('p1', 'one.ts', b, tb, { sleep }).catch((e) => (seenDeadlock = e))
    }
    const aWait = l.acquireWaiting('p1', 'two.ts', a, ta, { sleep, waitMs: LOCK_POLL_MS * 4 }).catch((e) => e)
    expect(await aWait).toBeInstanceOf(FileLockedError)
    expect(seenDeadlock).toBeInstanceOf(FileDeadlockError)
    expect(String((seenDeadlock as Error).message)).toMatch(/waiting for a file you hold/)
  })

  it('compares paths without regard to case on Windows, like the plain lock does', async () => {
    l.acquire('p1', 'Src/A.ts', a, ta, 60 * 60_000)
    if (process.platform === 'win32') await expect(l.acquireWaiting('p1', 'src/a.ts', b, tb, { sleep, waitMs: 1 })).rejects.toThrow(FileLockedError)
  })
})

// ------------------------------------------------------------------ the file tools, two developers, one file

describe('two developers who need the same file', () => {
  let ws: WorkspaceService
  let locks: FileLocks
  let dev1: Actor
  let dev2: Actor
  const tool = (name: string) => WORKSPACE_TOOLS.find((t) => t.def.name === name)!
  const ctx = (actor: Actor): ToolContext =>
    ({ projectId: 'p1', runId: actor.runId, taskId: actor.taskId, agent: actor.agent, workspace: ws, signal: actor.signal ?? new AbortController().signal }) as unknown as ToolContext
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

  beforeEach(() => {
    locks = new FileLocks(db)
    ws = new WorkspaceService(db, events, locks, new ContextIndexer(db))
    const a1 = hire('lead_developer')
    const a2 = hire('frontend_developer')
    dev1 = { agent: a1, runId: 'r1', taskId: makeTask('Feature A') }
    dev2 = { agent: a2, runId: 'r1', taskId: makeTask('Feature B') }
  })
  afterEach(() => locks.clearAll())

  it('the second developer’s edit waits, then applies on top of the first one’s finished work, and is logged as a conflict', async () => {
    await ws.agentWrite('p1', 'src/game.ts', 'line1\nline2\nline3\n', dev1)
    // Developer 1 changes line1 and keeps the file until their task ends.
    await tool('edit_file').execute(ctx(dev1), { path: 'src/game.ts', old_text: 'line1', new_text: 'ONE' })
    const second = tool('edit_file').execute(ctx(dev2), { path: 'src/game.ts', old_text: 'line3', new_text: 'THREE' })
    await new Promise((r) => setTimeout(r, 50))
    expect(read('src/game.ts')).toBe('ONE\nline2\nline3\n') // still waiting: nothing of developer 2 written yet
    expect(events.recent({ projectId: 'p1' }).some((e) => e.type === 'file.conflict' && /Feature A/.test(e.message))).toBe(true)
    locks.releaseTask(dev1.taskId) // developer 1 finishes
    await second
    expect(read('src/game.ts')).toBe('ONE\nline2\nTHREE\n') // both changes are there
  }, 15_000)

  it('a whole-file write after waiting is refused, so the other developer’s work is not erased', async () => {
    await ws.agentWrite('p1', 'src/game.ts', 'original\n', dev1)
    const blind = ws.agentWrite('p1', 'src/game.ts', 'my own full version\n', dev2)
    await new Promise((r) => setTimeout(r, 50))
    await ws.agentWrite('p1', 'src/game.ts', 'original\nplus developer 1\n', dev1)
    locks.releaseTask(dev1.taskId)
    await expect(blind).rejects.toThrow(/changed by another developer while you waited.*edit_file/)
    expect(read('src/game.ts')).toBe('original\nplus developer 1\n')
  }, 15_000)

  it('a new file written after waiting still works (nothing to overwrite)', async () => {
    await ws.agentWrite('p1', 'src/new.ts', '', dev1) // creates it, holds it
    locks.releaseTask(dev1.taskId)
    await ws.agentWrite('p1', 'src/new.ts', 'x\n', dev2) // free: no waiting involved
    expect(read('src/new.ts')).toBe('x\n')
  })
})

// ------------------------------------------------------------------ how many developers work at once is the user's choice

class Gateway implements LlmGateway {
  inFlight = 0
  max = 0
  handler: (req: CompleteRequest) => { text?: string; tools?: Array<{ name: string; args: Record<string, unknown> }> } = () => ({ text: 'done' })
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    if (req.signal.aborted) throw new CallCancelledError()
    const planning = !!req.tools?.some((t) => t.name === 'submit_plan')
    if (!planning) {
      this.inFlight++
      this.max = Math.max(this.max, this.inFlight)
      await new Promise((r) => setTimeout(r, 30))
      this.inFlight--
    }
    const reply = this.handler(req)
    const toolCalls = (reply.tools ?? []).map((c, i) => ({ id: `c${i}`, name: c.name, arguments: c.args }))
    return { costUsd: 0.01, response: { model: req.model, text: reply.text ?? '', toolCalls, stopReason: toolCalls.length ? 'tool_use' : 'end', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 } }
  }
}

describe('Orchestrator: developers per development run', () => {
  let gw: Gateway
  let orch: Orchestrator
  const plan = [
    { key: 'f1', title: 'F1', description: 'd', role: 'lead_developer', files: ['a.ts'] },
    { key: 'f2', title: 'F2', description: 'd', role: 'lead_developer', files: ['b.ts'] },
    { key: 'f3', title: 'F3', description: 'd', role: 'lead_developer', files: ['c.ts'] },
    { key: 'integ', title: 'Integrate', description: 'd', role: 'lead_developer', files: ['main.ts'], depends_on: ['f1', 'f2', 'f3'] },
    { key: 'qa', title: 'QA', description: 'd', role: 'qa_tester', depends_on: ['integ'] }
  ]
  beforeEach(() => {
    gw = new Gateway()
    gw.handler = (req) => (req.tools?.some((t) => t.name === 'submit_plan') ? { tools: [{ name: 'submit_plan', args: { tasks: plan } }] } : { text: 'ok' })
    orch = new Orchestrator(db, events, agents, gw, tasks)
    for (const [r, n] of [['project_manager', 'PM'], ['lead_developer', 'Dev 1'], ['lead_developer', 'Dev 2'], ['lead_developer', 'Dev 3'], ['qa_tester', 'QA']]) hire(r, n)
  })
  const go = async (developers?: number) => {
    const r = orch.start({ projectId: 'p1', goal: devGoal(['docs/GAME_DESIGN.md']), concurrency: 8, ...(developers === undefined ? {} : { developers }) })
    await orch.whenDone(r.id)
    return orch.getRun(r.id)!
  }

  it('defaults to ONE developer: features run one after another', async () => {
    expect((await go()).status).toBe('completed')
    expect(gw.max).toBe(1)
  })

  it('two developers build two features at the same time, never more', async () => {
    expect((await go(2)).status).toBe('completed')
    expect(gw.max).toBe(2)
  })

  it('tells the Project Manager how many developers were assigned, and rejects plans that clash on a file', async () => {
    const prompts: string[] = []
    const clash = [{ ...plan[0], files: ['shared.ts'] }, { ...plan[1], files: ['shared.ts'] }, plan[2], plan[3], plan[4]]
    let first = true
    gw.handler = (req) => {
      if (!req.tools?.some((t) => t.name === 'submit_plan')) return { text: 'ok' }
      const last = req.messages[req.messages.length - 1]
      prompts.push(typeof last.content === 'string' ? last.content : JSON.stringify(last.content))
      const out = { tools: [{ name: 'submit_plan', args: { tasks: first ? clash : plan } }] }
      first = false
      return out
    }
    expect((await go(2)).status).toBe('completed')
    expect(prompts[0]).toMatch(/assigned 2 developers/)
    expect(prompts[1]).toContain('can run at the same time but both own shared.ts')
  })

  it('refuses a number that makes no sense for this team', () => {
    expect(() => orch.start({ projectId: 'p1', goal: devGoal([]), developers: 4 })).toThrow(/only 3 can run/)
    expect(() => orch.start({ projectId: 'p1', goal: devGoal([]), developers: 0 })).toThrow(/between 1 and/)
    expect(() => orch.start({ projectId: 'p1', goal: 'Write docs', developers: 2 })).toThrow(/only to development runs/)
  })
})
