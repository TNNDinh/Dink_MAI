import { describe, expect, it } from 'vitest'
import { AGENT_TEMPLATES, getTemplate } from '../src/main/agents/templates'
import { plannerInstructions, type TeamMember } from '../src/main/orchestrator/plan'
import { toolsFor } from '../src/main/orchestrator/tools'
import { DEPARTMENTS, departmentOfRole, departmentOfTask } from '../src/renderer/src/office/departments'

const member = (role: string): TeamMember => ({ role, roleLabel: role, name: role, description: 'x' })
const base = { projectName: 'P', projectType: 'other', goal: 'Document the game in input/game.xapk', existing: [] }
const asAgent = (key: string): any => ({ id: key, name: key, permissions: getTemplate(key)!.permissions })

describe('the Game Analyst of the Dink_ATU department', () => {
  it('is a template that can run Dink_ATU and write notes, but cannot go online or commit', () => {
    const t = getTemplate('game_analyst')!
    expect(t.permissions).toMatchObject({ readFiles: true, writeFiles: true, runCommands: 'allowlist', internet: false, gitCommit: false })
    expect(new Set(AGENT_TEMPLATES.map((x) => x.key)).size).toBe(AGENT_TEMPLATES.length)
  })

  it('is offered the package tools; the designer is offered the web tools and not the package tools', () => {
    const analyst = toolsFor(asAgent('game_analyst'), { workspace: true }).map((x) => x.def.name)
    expect(analyst).toEqual(expect.arrayContaining(['apk_to_unity', 'search_large_file', 'android_play']))
    expect(analyst).not.toContain('web_search')
    const designer = toolsFor(asAgent('game_designer'), { workspace: true }).map((x) => x.def.name)
    expect(designer).toContain('web_search')
    expect(designer).not.toContain('apk_to_unity')
  })

  it('works in the integration room of the office, whatever the wording of its task', () => {
    expect(departmentOfRole('game_analyst')).toBe('integration')
    expect(departmentOfTask({ role: 'game_analyst', title: 'Run Dink_ATU on the package' })).toBe('integration')
    expect(DEPARTMENTS.find((d) => d.id === 'integration')!.label).toMatch(/Dink_ATU/)
  })

  it('the planner is told to split the analyst work in two small tasks and to make the designer wait for both, only when the team has an analyst', () => {
    const withAnalyst = plannerInstructions({ ...base, team: [member('project_manager'), member('game_analyst'), member('game_designer')] })
    expect(withAnalyst).toMatch(/game_analyst \(Dink_ATU department\)/)
    expect(withAnalyst).toMatch(/must depend on both/)
    expect(withAnalyst).toMatch(/docs\/evidence\//)
    expect(plannerInstructions({ ...base, team: [member('project_manager'), member('game_designer')] })).not.toMatch(/Dink_ATU department/)
  })

  it('the designer is told to read the analyst notes and to write gameplay as concrete rules', () => {
    const gd = getTemplate('game_designer')!.systemPrompt
    expect(gd).toMatch(/docs\/evidence\//)
    expect(gd).toMatch(/concrete rules/)
  })
})
