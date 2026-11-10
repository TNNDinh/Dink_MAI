import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_TEMPLATES, getTemplate } from '../src/main/agents/templates'
import { trimPolicyFor, WRITE_TOOLS, writeNudge, writeNudgeRound } from '../src/main/orchestrator/orchestrator'
import { Sandbox } from '../src/main/workspace/sandbox'
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

  it('search_files reads the YAML .asset/.prefab files of an exported Unity project, but still skips a binary one and the .meta files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'unity-search-'))
    try {
      mkdirSync(join(root, 'Assets', 'Localization'), { recursive: true })
      writeFileSync(join(root, 'Assets', 'Localization', 'Gameplay_en.asset'), '%YAML 1.1\n  m_Localized: Level {0}\n')
      writeFileSync(join(root, 'Assets', 'Localization', 'Gameplay_en.asset.meta'), 'm_Localized: not here\n')
      writeFileSync(join(root, 'Assets', 'Binary.asset'), Buffer.from([0x55, 0x6e, 0x69, 0x00, 0x6d, 0x5f, 0x4c, 0x6f, 0x63, 0x61, 0x6c, 0x69, 0x7a, 0x65, 0x64, 0x3a]))
      const sb = new Sandbox(root)
      const r = await sb.search('m_Localized:')
      expect(r.hits.map((h) => `${h.path}:${h.line}`)).toEqual(['Assets/Localization/Gameplay_en.asset:2'])
      // The file index still leaves these extensions out: every Unity file has a .meta, they would drown it.
      expect((await sb.walk('')).files).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('an agent that reads many files keeps more of its older tool results than the others', () => {
    const analyst = new Set(['apk_to_unity', 'read_file'])
    expect(trimPolicyFor(analyst)).toEqual({ keep: 6, head: 1500 })
    expect(trimPolicyFor(new Set(['read_file']))).toEqual({})
  })

  it('an analyst that has read for 5 rounds without writing a file is told to write now, again every 3 rounds, and never once it wrote', () => {
    const first = writeNudgeRound(new Set(['apk_to_unity']))
    expect(first).toBe(5)
    expect(writeNudgeRound(new Set(['write_file']))).toBe(0)
    expect([1, 2, 3, 4].map((r) => writeNudge(r, first, false))).toEqual([null, null, null, null])
    expect(writeNudge(5, first, false)).toMatch(/call write_file/)
    expect([6, 7].map((r) => writeNudge(r, first, false))).toEqual([null, null])
    expect(writeNudge(8, first, false)).not.toBeNull()
    expect(writeNudge(5, first, true)).toBeNull()
    expect(writeNudge(9, 0, false)).toBeNull()
    expect(WRITE_TOOLS.has('write_file') && WRITE_TOOLS.has('edit_file') && !WRITE_TOOLS.has('read_file')).toBe(true)
  })

  it('the designer is told to read the analyst notes and to write gameplay as concrete rules', () => {
    const gd = getTemplate('game_designer')!.systemPrompt
    expect(gd).toMatch(/docs\/evidence\//)
    expect(gd).toMatch(/concrete rules/)
  })
})
