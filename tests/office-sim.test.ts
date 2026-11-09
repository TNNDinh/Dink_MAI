import { describe, expect, it } from 'vitest'
import type { Run, Task } from '../src/shared/ipc'
import { deskOf, getLayout } from '../src/renderer/src/office/layout'
import { buildOffice } from '../src/renderer/src/office/model'
import { OfficeSim } from '../src/renderer/src/office/sim'

const run = (o: Partial<Run> = {}): Run => ({ id: 'r1', projectId: 'p', workflowId: null, goal: 'g', status: 'running', iteration: 0, maxIterations: 3, budgetUsd: null, spentUsd: 0, unpricedCalls: 0, concurrency: 3, error: null, startedAt: 1, finishedAt: null, createdAt: 1, taskCounts: {} as Run['taskCounts'], ...o })
let n = 0
const task = (o: Partial<Task> & { id: string }): Task => ({ projectId: 'p', runId: 'r1', title: o.id, description: '', role: 'game_developer', assignedAgentId: null, assignedAgentName: null, status: 'todo', priority: 2, attempts: 0, dependsOn: [], resultSummary: null, error: null, inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: ++n, updatedAt: 1, ...o })
const office = (tasks: Task[], r: Partial<Run> = {}) => buildOffice(tasks, [], [run(r)])

/** Runs the sim for up to `secs` seconds (0.1 s frames), calling `probe` each frame; stops early when `until` says so. */
function play(sim: OfficeSim, secs: number, probe?: () => void, until?: () => boolean): void {
  for (let t = 0; t < secs; t += 0.1) {
    sim.update(0.1)
    probe?.()
    if (until?.()) return
  }
}

const seatedAtDesks = (sim: OfficeSim): boolean =>
  [...sim.actors.values()].filter((a) => a.kind === 'employee').every((a) => a.pose === 'sit' && a.tile.x === a.home.x && a.tile.y === a.home.y)

describe('the people of the office', () => {
  it('seats everyone at their desks the first time, with nobody walking', () => {
    const sim = new OfficeSim()
    sim.sync(office([task({ id: 'a', status: 'in_progress' }), task({ id: 'b', role: 'game_designer' })]))
    expect(sim.actors.size).toBe(3) // two employees and the PM
    expect(seatedAtDesks(sim)).toBe(true)
    expect(sim.actors.get('pm')!.pose).toBe('sit')
    expect(sim.busy()).toBe(false)
    expect(sim.actors.get('dev-1')!.x).toBe(deskOf('dev', 0).chair.x)
  })

  it('has one person per employee of the data, no more', () => {
    const sim = new OfficeSim()
    sim.sync(office(Array.from({ length: 10 }, (_, i) => task({ id: `d${i}`, role: 'game_designer' }))))
    expect([...sim.actors.keys()].filter((k) => k.startsWith('gd-'))).toHaveLength(10)
    expect(sim.actors.size).toBe(11)
  })

  it('walks a new hire in from the entrance to the new desk and sits down', () => {
    const sim = new OfficeSim()
    const a = task({ id: 'a' })
    sim.sync(office([a]))
    sim.sync(office([a, task({ id: 'b' })]))
    const hire = sim.actors.get('dev-2')!
    expect(hire.tile).toEqual(getLayout().entrance)
    let appearedAtEntrance = false
    play(sim, 60, () => {
      if (sim.ordered().includes(hire) && Math.abs(hire.x - getLayout().entrance.x) < 1) appearedAtEntrance = true
    }, () => !sim.busy())
    expect(appearedAtEntrance).toBe(true)
    expect(hire.pose).toBe('sit')
    expect(hire.tile).toEqual(deskOf('dev', 1).chair)
  })

  it('takes finished work to the PM, who reviews and approves it, then the owner returns to the desk', () => {
    const sim = new OfficeSim()
    const mk = (status: Task['status']) => office([task({ id: 'a', status, title: 'Player jump' })])
    sim.sync(mk('in_progress'))
    sim.sync(mk('done'))
    const dev = sim.actors.get('dev-1')!
    const pm = sim.actors.get('pm')!
    const L = getLayout()
    const said: string[] = []
    let carriedToPm = false
    play(sim, 90, () => {
      if (pm.bubble) said.push(pm.bubble.text)
      if (dev.carrying && dev.tile.x === L.pm.receive.x && dev.tile.y === L.pm.receive.y) carriedToPm = true
    }, () => !sim.busy())
    expect(carriedToPm).toBe(true)
    expect(said.some((s) => s.startsWith('Reviewing'))).toBe(true)
    expect(said).toContain('Approved ✓')
    expect(dev.carrying).toBe(false)
    expect(seatedAtDesks(sim)).toBe(true)
    expect(pm.tile).toEqual(L.pm.seat)
  })

  it('passes the result on to the person who builds on it, even in another department', () => {
    const sim = new OfficeSim()
    const mk = (s: Task['status']) => office([task({ id: 'art', role: 'concept_artist', status: s }), task({ id: 'code', role: 'game_developer', dependsOn: ['art'] })])
    sim.sync(mk('in_progress'))
    sim.sync(mk('done'))
    const artist = sim.actors.get('art-1')!
    const dev = deskOf('dev', 0)
    const devActor = sim.actors.get('dev-1')!
    let visited = false
    const heard: string[] = []
    play(sim, 120, () => {
      if (artist.tile.x === dev.approach.x && artist.tile.y === dev.approach.y) visited = true
      if (devActor.bubble) heard.push(devActor.bubble.text)
    }, () => !sim.busy())
    expect(visited).toBe(true)
    expect(heard.join('|')).toContain('Thanks')
    expect(seatedAtDesks(sim)).toBe(true)
  })

  it('never puts two people on the same tile when many finish at once', () => {
    const sim = new OfficeSim()
    const mk = (s: Task['status']) => office([...Array.from({ length: 6 }, (_, i) => task({ id: `d${i}`, status: s })), ...Array.from({ length: 4 }, (_, i) => task({ id: `g${i}`, role: 'game_designer', status: s }))])
    sim.sync(mk('in_progress'))
    sim.sync(mk('done'))
    let clashes = 0
    play(sim, 400, () => {
      const seen = new Map<string, string>()
      for (const a of sim.ordered()) {
        if (a.next) continue
        const k = `${a.tile.x},${a.tile.y}`
        if (seen.has(k)) clashes += 1
        seen.set(k, a.id)
      }
    }, () => !sim.busy())
    expect(clashes).toBe(0)
    expect(sim.busy()).toBe(false)
    expect(seatedAtDesks(sim)).toBe(true)
  })

  it('lets a tester that sends work back walk to the developer and tell them', () => {
    const sim = new OfficeSim()
    const mk = (qaStatus: Task['status']) => office([task({ id: 'feat', status: 'done', title: 'Feature' }), task({ id: 'qa', role: 'qa_tester', status: qaStatus, dependsOn: ['feat'], title: 'Test it' })])
    sim.sync(mk('in_progress'))
    sim.event({ type: 'task.waiting', message: '“Test it” waits for the requested changes, then runs again', agentId: null })
    const dev = sim.actors.get('dev-1')!
    const tester = sim.actors.get('qa-1')!
    const d = deskOf('dev', 0)
    let walked = false
    play(sim, 60, () => {
      if (tester.tile.x === d.approach.x && tester.tile.y === d.approach.y) walked = true
    }, () => !sim.busy())
    expect(walked).toBe(true)
    expect(dev.label).toBe('Fixing what the tester found')
    expect(seatedAtDesks(sim)).toBe(true)
  })

  it('shows what a failed task says and forgets people when their tasks disappear', () => {
    const sim = new OfficeSim()
    sim.sync(office([task({ id: 'a', status: 'in_progress' })]))
    sim.sync(office([task({ id: 'a', status: 'failed' })]))
    expect(sim.actors.get('dev-1')!.bubble?.text).toMatch(/failed/)
    sim.sync(office([]))
    expect([...sim.actors.keys()]).toEqual(['pm'])
  })

  it('has the PM walk to the boards when idle, then come back', () => {
    const sim = new OfficeSim()
    sim.sync(office([task({ id: 'a', status: 'in_progress' })]))
    const pm = sim.actors.get('pm')!
    const L = getLayout()
    let atBoard = false
    play(sim, 60, () => {
      if ([L.pm.projectBoard, L.pm.kanban, L.pm.statusScreen].some((b) => b.x === pm.tile.x && b.y === pm.tile.y)) atBoard = true
    })
    expect(atBoard).toBe(true)
  })

  it('calls a meeting at the big table of the hub when the run completes', () => {
    const sim = new OfficeSim()
    sim.sync(office([task({ id: 'a', status: 'done' }), task({ id: 'b', role: 'game_designer', status: 'done' })], { status: 'completed' }))
    sim.event({ type: 'run.completed', message: 'done', agentId: null })
    const L = getLayout()
    const seats = new Set(L.hub.tableSeats.map((s) => `${s.x},${s.y}`))
    let atTable = 0
    play(sim, 90, () => {
      const here = [...sim.actors.values()].filter((a) => !a.next && seats.has(`${a.tile.x},${a.tile.y}`)).length
      atTable = Math.max(atTable, here)
    }, () => !sim.busy())
    expect(atTable).toBe(3)
    expect(seatedAtDesks(sim)).toBe(true)
  })

  it('shows what happens as effects and derives the state of each person', () => {
    const sim = new OfficeSim()
    sim.sync(office([task({ id: 'a', status: 'todo' }), task({ id: 'q', role: 'qa', status: 'todo' })]))
    expect(sim.stateOf('dev-1')).toBe('waiting')
    sim.sync(office([task({ id: 'a', status: 'in_progress' }), task({ id: 'q', role: 'qa', status: 'todo' })]))
    expect(sim.stateOf('dev-1')).toBe('thinking')
    expect(sim.effects.some((e) => e.kind === 'task-started')).toBe(true)
    play(sim, 6, () => {})
    expect(sim.stateOf('dev-1')).toBe('working')
    sim.sync(office([task({ id: 'a', status: 'failed' }), task({ id: 'q', role: 'qa', status: 'todo' })]))
    expect(sim.stateOf('dev-1')).toBe('error')
    expect(sim.effects.some((e) => e.kind === 'bug-found')).toBe(true)
    sim.event({ type: 'run.completed', message: 'done', agentId: null })
    expect(sim.effects.some((e) => e.kind === 'release-completed')).toBe(true)
    play(sim, 8, () => {})
    expect(sim.effects.some((e) => e.kind === 'task-started')).toBe(false)
  })
})
