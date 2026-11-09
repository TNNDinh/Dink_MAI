import { describe, expect, it } from 'vitest'
import { plannerInstructions, validatePlan } from '../src/main/orchestrator/plan'

const roles = new Set(['project_manager', 'game_developer', 'lead_developer', 'qa_tester', 'code_reviewer'])
const t = (key: string, role: string, depends_on: string[] = []) => ({ key, title: key, description: 'd', role, depends_on })
const dev = { development: true }

describe('development plans keep the process: developers build, the tester comes after', () => {
  it('accepts features in parallel → integration → QA', () => {
    const r = validatePlan({ tasks: [t('f1', 'game_developer'), t('f2', 'lead_developer'), t('integ', 'lead_developer', ['f1', 'f2']), t('qa', 'qa_tester', ['integ'])] }, roles, dev)
    expect(r.ok).toBe(true)
  })

  it('rejects a tester that can start before some development is finished, naming what is missing', () => {
    const r = validatePlan({ tasks: [t('f1', 'game_developer'), t('f2', 'lead_developer'), t('qa', 'qa_tester', ['f1'])] }, roles, dev)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/"qa" must start only after development.*f2/)
  })

  it('rejects a plan with no tester or no developer task when the team has those roles', () => {
    const noQa = validatePlan({ tasks: [t('f1', 'game_developer')] }, roles, dev)
    expect(noQa.ok === false && noQa.errors.join()).toMatch(/testing task/)
    const noDev = validatePlan({ tasks: [t('qa', 'qa_tester')] }, roles, dev)
    expect(noDev.ok === false && noDev.errors.join()).toMatch(/feature tasks/)
  })

  it('does not demand a tester the team does not have, and leaves other runs alone', () => {
    expect(validatePlan({ tasks: [t('f1', 'game_developer')] }, new Set(['game_developer']), dev).ok).toBe(true)
    expect(validatePlan({ tasks: [t('qa', 'qa_tester'), t('f1', 'game_developer')] }, roles).ok).toBe(true)
  })

  it('counts a chain of dependencies as waiting', () => {
    const r = validatePlan({ tasks: [t('f1', 'game_developer'), t('review', 'code_reviewer', ['f1']), t('qa', 'qa_tester', ['review'])] }, roles, dev)
    expect(r.ok).toBe(true)
  })

  it('tells the planner the process and how many developers there are', () => {
    const base = { projectName: 'p', projectType: 'game', goal: 'g', team: [], existing: [] }
    expect(plannerInstructions({ ...base, development: true, developerCount: 3 })).toMatch(/DEVELOPMENT PLAN[\s\S]*3 developers[\s\S]*qa_tester role LAST/)
    expect(plannerInstructions({ ...base, development: true, developerCount: 1 })).toMatch(/ONE developer[\s\S]*one after another/)
    expect(plannerInstructions(base)).not.toContain('DEVELOPMENT PLAN')
  })
})

describe('several developers: nobody plans two features into the same file', () => {
  const f = (key: string, role: string, files: string[], depends_on: string[] = []) => ({ key, title: key, description: 'd', role, depends_on, files })
  const two = { development: true, developers: 2 }
  const qa = f('qa', 'qa_tester', [], ['integ'])

  it('accepts features with their own files and folders', () => {
    const r = validatePlan({ tasks: [f('a', 'game_developer', ['Assets/Scripts/Player']), f('b', 'lead_developer', ['Assets/Scripts/Enemy', 'Assets/UI/Menu.cs']), f('integ', 'lead_developer', ['Assets/Scenes'], ['a', 'b']), qa] }, roles, two)
    expect(r.ok).toBe(true)
  })

  it('rejects two tasks that can run together and own the same file, naming both and the way out', () => {
    const r = validatePlan({ tasks: [f('a', 'game_developer', ['src/game.ts']), f('b', 'lead_developer', ['./src\\Game.ts']), f('integ', 'lead_developer', ['x'], ['a', 'b']), qa] }, roles, two)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/"a" and "b" can run at the same time but both own src\/game\.ts.*depend on the other.*foundation/s)
  })

  it('treats a folder as owning everything inside it', () => {
    const r = validatePlan({ tasks: [f('a', 'game_developer', ['src/player']), f('b', 'lead_developer', ['src/player/jump.ts']), f('integ', 'lead_developer', ['x'], ['a', 'b']), qa] }, roles, two)
    expect(r.ok).toBe(false)
  })

  it('lets two tasks share a file when one waits for the other', () => {
    const r = validatePlan({ tasks: [f('a', 'game_developer', ['src/shared.ts']), f('b', 'lead_developer', ['src/shared.ts'], ['a']), f('integ', 'lead_developer', ['x'], ['b']), qa] }, roles, two)
    expect(r.ok).toBe(true)
    // ...also through a chain: a -> mid -> b
    const chain = validatePlan({ tasks: [f('a', 'game_developer', ['src/shared.ts']), f('mid', 'lead_developer', ['m.ts'], ['a']), f('b', 'game_developer', ['src/shared.ts'], ['mid']), f('integ', 'lead_developer', ['x'], ['b']), qa] }, roles, two)
    expect(chain.ok).toBe(true)
  })

  it('requires every development task to say which files it owns', () => {
    const r = validatePlan({ tasks: [f('a', 'game_developer', []), f('b', 'lead_developer', ['b.ts']), f('integ', 'lead_developer', ['x'], ['a', 'b']), qa] }, roles, two)
    expect(r.ok === false && r.errors.join()).toMatch(/must list the files.*Missing for: a/)
  })

  it('does not ask for any of this with one developer (they work one after another)', () => {
    const r = validatePlan({ tasks: [f('a', 'game_developer', []), f('b', 'lead_developer', []), f('integ', 'lead_developer', [], ['a', 'b']), qa] }, roles, { development: true, developers: 1 })
    expect(r.ok).toBe(true)
  })
})
