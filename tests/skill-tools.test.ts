import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SKILL_TOOLS, discoverSkills, parseSkill, skillRoots } from '../src/main/orchestrator/skill-tools'
import { toolsFor, type ToolContext } from '../src/main/orchestrator/tools'

const [listSkills, useSkill, readSkillFile] = SKILL_TOOLS
const ctx = {} as ToolContext
let root: string

const skill = (dir: string, name: string, description: string, body = 'Do the thing.') => {
  mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${description}"\nversion: "1"\n---\n\n# ${name}\n${body}\n`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sk-'))
  process.env.DINH_MAI_SKILLS_DIR = root
})
afterEach(() => {
  delete process.env.DINH_MAI_SKILLS_DIR
  rmSync(root, { recursive: true, force: true })
})

describe('skills', () => {
  it('parses front matter with quotes and a BOM, and leaves plain files alone', () => {
    const r = parseSkill('﻿---\r\nname: a\r\ndescription: "Hello: world"\r\n---\r\nBody')
    expect(r.meta).toEqual({ name: 'a', description: 'Hello: world' })
    expect(r.body).toBe('Body')
    expect(parseSkill('no front matter').meta).toEqual({})
  })

  it('finds skills in nested folders, ignores folders without SKILL.md, and does not look inside a skill', () => {
    skill('one', 'one', 'First')
    skill('group/two', 'two', 'Second')
    skill('one/inner', 'hidden', 'Nested inside a skill')
    mkdirSync(join(root, 'empty'))
    expect(discoverSkills([root]).map((s) => s.name)).toEqual(['one', 'two'])
  })

  it('reads the folder list from the environment and defaults to ~/.claude/skills', () => {
    expect(skillRoots({ DINH_MAI_SKILLS_DIR: 'a;b'.replace(';', require('node:path').delimiter) })).toHaveLength(2)
    expect(skillRoots({})[0]).toMatch(/\.claude/)
  })

  it('lists skills and loads one with its folder', async () => {
    skill('one', 'one', 'First skill', 'Step 1. Step 2.')
    expect(await listSkills.execute(ctx, {})).toBe('- one: First skill')
    const out = (await useSkill.execute(ctx, { name: 'one' })) as string
    expect(out).toContain('# Skill: one')
    expect(out).toContain(`Folder: ${join(root, 'one')}`)
    expect(out).toContain('Step 1. Step 2.')
    expect(out).not.toContain('version:')
    await expect(useSkill.execute(ctx, { name: 'nope' })).rejects.toThrow(/No skill named/)
  })

  it('says where it looked when there are no skills', async () => {
    expect(await listSkills.execute(ctx, {})).toContain('No skills found')
  })

  it('reads supporting files but not outside the folder, secrets or binaries', async () => {
    skill('one', 'one', 'First')
    mkdirSync(join(root, 'one', 'refs'))
    writeFileSync(join(root, 'one', 'refs', 'guide.md'), 'GUIDE')
    writeFileSync(join(root, 'one', '.env'), 'TOKEN=1')
    writeFileSync(join(root, 'one', 'logo.png'), 'x')
    writeFileSync(join(root, 'outside.txt'), 'SECRET')
    expect(await readSkillFile.execute(ctx, { name: 'one', path: 'refs/guide.md' })).toBe('GUIDE')
    await expect(readSkillFile.execute(ctx, { name: 'one', path: '../outside.txt' })).rejects.toThrow(/inside the skill folder/)
    await expect(readSkillFile.execute(ctx, { name: 'one', path: join(root, 'outside.txt') })).rejects.toThrow(/inside the skill folder/)
    await expect(readSkillFile.execute(ctx, { name: 'one', path: '.env' })).rejects.toThrow(/cannot be read/)
    await expect(readSkillFile.execute(ctx, { name: 'one', path: 'logo.png' })).rejects.toThrow(/cannot be read/)
    await expect(readSkillFile.execute(ctx, { name: 'one', path: 'missing.md' })).rejects.toThrow(/not a file/)
  })

  it('is offered to agents that can read files, with or without a workspace', () => {
    const reader: any = { permissions: { readFiles: true, writeFiles: false, runCommands: 'none', manageTasks: false } }
    const blind: any = { permissions: { readFiles: false, writeFiles: false, runCommands: 'none', manageTasks: false } }
    expect(toolsFor(reader, { skills: true }).map((t) => t.def.name)).toEqual(expect.arrayContaining(['list_skills', 'use_skill', 'read_skill_file']))
    expect(toolsFor(blind, { skills: true }).map((t) => t.def.name)).not.toContain('use_skill')
  })
})
