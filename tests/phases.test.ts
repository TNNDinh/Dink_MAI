import { describe, expect, it } from 'vitest'
import type { Run, Task } from '../src/shared/ipc'
import { DEV_GOAL_PREFIX, designPhase, devGoal, devPhase, isDevRun, testPhase } from '../src/renderer/src/lib/phases'

const run = (o: Partial<Run>): Run => ({ id: 'r', projectId: 'p', workflowId: null, goal: 'g', status: 'completed', iteration: 0, maxIterations: 3, budgetUsd: null, spentUsd: 0, unpricedCalls: 0, concurrency: 3, error: null, startedAt: 1, finishedAt: 2, createdAt: 1, taskCounts: {} as Run['taskCounts'], ...o })
const task = (o: Partial<Task>): Task => ({ id: 't', projectId: 'p', runId: 'r', title: 't', description: '', role: null, assignedAgentId: null, assignedAgentName: null, status: 'done', priority: 2, attempts: 1, dependsOn: [], resultSummary: null, error: null, inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: 1, updatedAt: 1, ...o })

describe('project phases', () => {
  it('the development goal names every document and is recognised as a development run', () => {
    const g = devGoal(['docs/GAME_DESIGN.md', 'docs/playtest-notes.md'])
    expect(g.startsWith(DEV_GOAL_PREFIX)).toBe(true)
    expect(g).toContain('- docs/GAME_DESIGN.md')
    expect(g).toContain('- docs/playtest-notes.md')
    expect(isDevRun(run({ goal: g }))).toBe(true)
    expect(isDevRun(run({ goal: 'Write the design doc' }))).toBe(false)
  })

  it('design is done only when a design document exists, not just because a run ran', () => {
    expect(designPhase([], []).state).toBe('todo')
    expect(designPhase([], [run({})]).state).toBe('attention')
    expect(designPhase(['GAME_DESIGN.md', 'code-map.md'], [run({})])).toMatchObject({ state: 'done', detail: '2 documents written.' })
    expect(designPhase(['GAME_DESIGN.md'], [run({ status: 'running' })]).state).toBe('active')
  })

  it('a development run that is running does not make the design phase active', () => {
    expect(designPhase(['GAME_DESIGN.md'], [run({ goal: devGoal([]), status: 'running' })]).state).toBe('done')
  })

  it('development follows the latest development run and counts its tasks', () => {
    expect(devPhase([run({})], []).state).toBe('todo')
    const dev = run({ id: 'd', goal: devGoal([]), status: 'running', createdAt: 5 })
    expect(devPhase([dev], [])).toMatchObject({ state: 'active', detail: 'Waiting for the Project Manager’s plan.' })
    const tasks = [task({ runId: 'd', role: 'game_developer', status: 'done' }), task({ id: 't2', runId: 'd', role: 'lead_developer', status: 'todo' }), task({ id: 't3', runId: 'other', role: 'game_developer', status: 'done' }), task({ id: 't4', runId: 'd', role: 'qa_tester', status: 'todo' })]
    expect(devPhase([dev], tasks).detail).toBe('1/2 feature tasks done.')
    expect(devPhase([{ ...dev, status: 'completed' }], tasks).state).toBe('attention')
    expect(devPhase([{ ...dev, status: 'paused' }], tasks).state).toBe('attention')
    expect(devPhase([{ ...dev, status: 'failed', error: 'no budget' }], tasks)).toMatchObject({ state: 'attention', label: 'Failed', detail: 'no budget' })
  })

  it('testing waits for development, and reports its own tasks', () => {
    const dev = run({ id: 'd', goal: devGoal([]), status: 'running', createdAt: 5, iteration: 1 })
    const tasks = [task({ runId: 'd', role: 'game_developer', status: 'in_progress', assignedAgentName: 'Dev A' }), task({ id: 'q', runId: 'd', role: 'qa_tester', status: 'todo' })]
    expect(devPhase([dev], tasks).detail).toContain('1 developer working now')
    expect(testPhase([dev], tasks).state).toBe('todo')
    expect(testPhase([], tasks).state).toBe('todo')
    const doneDev = [task({ runId: 'd', role: 'game_developer', status: 'done' }), task({ id: 'q', runId: 'd', role: 'qa_tester', status: 'in_progress' })]
    expect(devPhase([dev], doneDev).state).toBe('done')
    expect(testPhase([dev], doneDev)).toMatchObject({ state: 'active', detail: '0/1 test tasks done · 1 round sent back to developers.' })
    expect(testPhase([dev], [doneDev[0], { ...doneDev[1], status: 'done' }]).state).toBe('done')
    expect(testPhase([dev], [doneDev[0], { ...doneDev[1], status: 'failed' }]).state).toBe('attention')
  })
})
