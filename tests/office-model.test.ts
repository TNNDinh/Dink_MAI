import { describe, expect, it } from 'vitest'
import type { Agent, Run, Task } from '../src/shared/ipc'
import { departmentOfRole, departmentOfTask } from '../src/renderer/src/office/departments'
import { buildOffice, MAX_STAFF } from '../src/renderer/src/office/model'

const run = (o: Partial<Run> = {}): Run => ({ id: 'r1', projectId: 'p', workflowId: null, goal: 'g', status: 'running', iteration: 0, maxIterations: 3, budgetUsd: null, spentUsd: 0, unpricedCalls: 0, concurrency: 3, error: null, startedAt: 1, finishedAt: null, createdAt: 1, taskCounts: {} as Run['taskCounts'], ...o })
let n = 0
const task = (o: Partial<Task> & { id: string }): Task => ({ projectId: 'p', runId: 'r1', title: o.id, description: '', role: 'game_developer', assignedAgentId: null, assignedAgentName: null, status: 'todo', priority: 2, attempts: 0, dependsOn: [], resultSummary: null, error: null, inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: ++n, updatedAt: 1, ...o })
const agent = (id: string, role: string, name = id): Agent => ({ id, projectId: 'p', name, role, roleLabel: role, kind: 'chat', connectionId: null, connectionName: null, model: 'm-' + id, systemPrompt: '', permissions: {} as Agent['permissions'], temperature: null, maxTokens: null, maxCostUsd: null, enabled: true, status: 'idle', issues: [], createdAt: 1, updatedAt: 1 })
const many = (count: number, role: string, extra: Partial<Task> = {}) => Array.from({ length: count }, (_, i) => task({ id: `${role}-${i}`, role, ...extra }))

describe('which department a task belongs to', () => {
  it('maps the studio roles', () => {
    expect(departmentOfRole('game_designer')).toBe('gd')
    expect(departmentOfRole('concept_artist')).toBe('art')
    expect(departmentOfRole('ui_ux_designer')).toBe('art')
    expect(departmentOfRole('qa_tester')).toBe('qa')
    expect(departmentOfRole('code_reviewer')).toBe('qa')
    expect(departmentOfRole('project_manager')).toBe('pm')
    expect(departmentOfRole('lead_developer')).toBe('dev')
    expect(departmentOfRole('something_custom')).toBe('dev')
  })

  it('puts integration and sound tasks in their own departments by their wording (there is no such role)', () => {
    expect(departmentOfTask({ role: 'lead_developer', title: 'Integrate all features' })).toBe('integration')
    expect(departmentOfTask({ role: 'game_developer', title: 'Add jump SFX and music' })).toBe('audio')
    expect(departmentOfTask({ role: 'qa_tester', title: 'Test the integration' })).toBe('qa')
    expect(departmentOfTask({ role: 'game_developer', title: 'Player controller' })).toBe('dev')
  })
})

describe('the staff follows the real tasks', () => {
  it.each([1, 5, 10])('%i independent design tasks seat exactly %i designers', (count) => {
    const o = buildOffice(many(count, 'game_designer'), [], [run()])
    expect(o.employees.filter((e) => e.department === 'gd')).toHaveLength(count)
    expect(o.departments.gd.employees).toBe(count)
    expect(new Set(o.employees.map((e) => e.deskIndex)).size).toBe(count)
  })

  it('has nobody when there are no tasks', () => {
    const o = buildOffice([], [], [])
    expect(o.employees).toHaveLength(0)
    expect(o.kanban.todo).toBe(0)
  })

  it('splits the tasks across departments', () => {
    const o = buildOffice([...many(2, 'game_designer'), ...many(3, 'concept_artist'), ...many(4, 'game_developer'), ...many(1, 'qa_tester')], [], [run()])
    expect(o.departments.gd.employees).toBe(2)
    expect(o.departments.art.employees).toBe(3)
    expect(o.departments.dev.employees).toBe(4)
    expect(o.departments.qa.employees).toBe(1)
    expect(o.departments.audio.employees + o.departments.integration.employees).toBe(0)
  })

  it('keeps one person for a chain of tasks, who takes the next one when done', () => {
    const a = task({ id: 'a', status: 'done' })
    const b = task({ id: 'b', status: 'in_progress', dependsOn: ['a'] })
    const c = task({ id: 'c', dependsOn: ['b'] })
    const o = buildOffice([a, b, c], [], [run()])
    expect(o.employees).toHaveLength(1)
    expect(o.employees[0].taskIds).toEqual(['a', 'b', 'c'])
    expect(o.employees[0].assignedTaskId).toBe('b')
    expect(o.employees[0].status).toBe('working')
    expect(o.employees[0].tasksDone).toBe(1)
    expect(o.employees[0].progress).toBeCloseTo(1 / 3)
  })

  it('hires a second person when two tasks wait for the same finished task', () => {
    const a = task({ id: 'a', status: 'done' })
    const o = buildOffice([a, task({ id: 'b', dependsOn: ['a'] }), task({ id: 'c', dependsOn: ['a'] })], [], [run()])
    expect(o.employees).toHaveLength(2)
  })

  it('does not rehire for a finished employee: a person of an earlier run takes the new run\'s task', () => {
    const first = task({ id: 'a', runId: 'r1', status: 'done' })
    const second = task({ id: 'b', runId: 'r2', status: 'todo' })
    const o = buildOffice([first, second], [], [run({ id: 'r1', createdAt: 1 }), run({ id: 'r2', createdAt: 2 })])
    expect(o.employees).toHaveLength(1)
    expect(o.employees[0].assignedTaskId).toBe('b')
  })

  it('ids and desks stay the same when later tasks arrive', () => {
    const base = many(3, 'game_developer', { status: 'in_progress' })
    const before = buildOffice(base, [], [run()])
    const after = buildOffice([...base, task({ id: 'late', role: 'game_developer' })], [], [run()])
    expect(after.employees.slice(0, 3).map((e) => [e.id, e.deskIndex])).toEqual(before.employees.map((e) => [e.id, e.deskIndex]))
    expect(after.employees).toHaveLength(4)
  })

  it('stops at the room capacity and counts the rest instead of drawing them', () => {
    const o = buildOffice(many(MAX_STAFF + 5, 'game_developer'), [], [run()])
    expect(o.departments.dev.employees).toBe(MAX_STAFF)
    expect(o.departments.dev.overflow).toBe(5)
    expect(o.tasks.filter((t) => t.employeeId === null)).toHaveLength(5)
  })

  it('leaves the planner out of the staff (the PM is the one character)', () => {
    const o = buildOffice([task({ id: 'plan', role: 'project_manager', status: 'done' }), task({ id: 'x' })], [], [run()])
    expect(o.employees).toHaveLength(1)
    expect(o.kanban.done).toBe(1)
  })
})

describe('what each person is shown doing', () => {
  const agents = [agent('a1', 'game_developer', 'Dev One'), agent('q1', 'qa_tester', 'Tess')]

  it('uses the real agent name and model once the task is assigned, and a placeholder before', () => {
    const o = buildOffice([task({ id: 'x', assignedAgentId: 'a1', status: 'in_progress' }), task({ id: 'y' })], agents, [run()])
    expect(o.employees[0]).toMatchObject({ name: 'Dev One', model: 'm-a1', agentId: 'a1', status: 'working' })
    expect(o.employees[0].progress).toBeNull()
    expect(o.employees[1]).toMatchObject({ name: 'DEV 2', model: null, agentId: null, status: 'queued' })
  })

  it('tells apart ready, waiting, in review, done, failed and blocked', () => {
    const o = buildOffice(
      [
        task({ id: 'ready' }),
        task({ id: 'wait', role: 'game_designer', dependsOn: ['ready'] }),
        task({ id: 'rev', status: 'review' }),
        task({ id: 'ok', status: 'done' }),
        task({ id: 'bad', status: 'failed' }),
        task({ id: 'blk', status: 'blocked' })
      ],
      [],
      [run()]
    )
    const by = Object.fromEntries(o.employees.map((e) => [e.assignedTaskId, e.status]))
    expect(by).toMatchObject({ ready: 'queued', wait: 'waiting', rev: 'in_review', ok: 'done', bad: 'failed', blk: 'blocked' })
  })

  it('links a tester to the developer being checked, and the developer to the reviewer', () => {
    const dev = task({ id: 'feat', assignedAgentId: 'a1', status: 'review' })
    const qa = task({ id: 'qa', role: 'qa_tester', assignedAgentId: 'q1', status: 'in_progress', dependsOn: ['feat'] })
    const o = buildOffice([dev, qa], agents, [run()])
    const devE = o.employees.find((e) => e.department === 'dev')!
    const qaE = o.employees.find((e) => e.department === 'qa')!
    expect(qaE.targetAgentId).toBe('a1')
    expect(devE.targetAgentId).toBe('q1')
    expect(o.tasks.find((t) => t.taskId === 'feat')!.reviewerId).toBe('q1')
  })

  it('suffixes the name when one agent sits at several desks', () => {
    const o = buildOffice([task({ id: 'p', assignedAgentId: 'a1', status: 'in_progress' }), task({ id: 'q', assignedAgentId: 'a1', status: 'in_progress' })], agents, [run()])
    expect(o.employees.map((e) => e.name)).toEqual(['Dev One', 'Dev One #2'])
  })

  it('counts the kanban and the spending for the project manager', () => {
    const o = buildOffice([task({ id: 'a', status: 'done' }), task({ id: 'b' }), task({ id: 'c', status: 'in_progress' })], [agent('pm', 'project_manager', 'Pia')], [run({ spentUsd: 1.5 }), run({ id: 'r2', createdAt: 2, spentUsd: 0.5, goal: 'second' })])
    expect(o.kanban).toMatchObject({ todo: 1, in_progress: 1, done: 1 })
    expect(o.pm).toMatchObject({ name: 'Pia', goal: 'second', tasks: 3, done: 1, spentUsd: 2 })
  })
})
