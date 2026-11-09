import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, relative, resolve, sep } from 'node:path'
import { isBinaryExt, isSecretPath } from '../workspace/sandbox'
import type { AgentTool } from './tools'

/**
 * Skills: folders with a SKILL.md (front matter `name` + `description`, then instructions) that teach an agent a job,
 * the same format Claude Code uses. They are read from the user's skill folders at run time and are never copied into the
 * app or the project. Folders come from DINH_MAI_SKILLS_DIR (a path list) or default to ~/.claude/skills.
 * An agent lists them, loads one when its description fits the task, and follows it with its other tools
 * (scripts that a skill names run through run_command and its approval policy).
 */
const MAX_DEPTH = 3
const MAX_SKILLS = 200
const BODY_CHARS = 30_000
const FILE_CHARS = 30_000
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__'])

export interface Skill {
  name: string
  description: string
  dir: string
  file: string
}

export function skillRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.DINH_MAI_SKILLS_DIR?.split(delimiter).map((s) => s.trim()).filter(Boolean)
  return configured?.length ? configured : [join(homedir(), '.claude', 'skills')]
}

/** Front matter of a SKILL.md: `key: value` lines between two `---` lines. */
export function parseSkill(text: string): { meta: Record<string, string>; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
  }
  return { meta, body: m[2] }
}

export function discoverSkills(roots: string[] = skillRoots()): Skill[] {
  const found = new Map<string, Skill>()
  const visit = (dir: string, depth: number): void => {
    if (found.size >= MAX_SKILLS) return
    const file = join(dir, 'SKILL.md')
    if (existsSync(file)) {
      try {
        const { meta } = parseSkill(readFileSync(file, 'utf8'))
        const name = meta.name || dir.split(sep).pop() || ''
        if (name && !found.has(name)) found.set(name, { name, description: meta.description ?? '', dir, file })
      } catch {
        /* unreadable skill: skip */
      }
      return // a skill folder holds its own files, not other skills
    }
    if (depth >= MAX_DEPTH) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) visit(join(dir, e.name), depth + 1)
  }
  for (const r of roots) visit(r, 0)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}\n[… clipped: ${s.length - max} more characters …]` : s)

const listSkills: AgentTool = {
  def: { name: 'list_skills', description: 'List the skills available to you: reusable instructions for specific jobs (name and what each is for). Check this when a task looks like something a skill covers, then load it with use_skill.', parameters: { type: 'object', properties: {} } },
  allowed: (a) => a.permissions.readFiles,
  execute: async () => {
    const skills = discoverSkills()
    if (!skills.length) return `No skills found. Skill folders: ${skillRoots().join(', ')}`
    return skills.map((s) => `- ${s.name}: ${s.description || '(no description)'}`).join('\n')
  }
}

const useSkill: AgentTool = {
  def: {
    name: 'use_skill',
    description:
      'Load one skill by name (see list_skills) and follow it. Returns its instructions and the folder it lives in. Scripts and files the skill mentions are in that folder: read them with read_skill_file, run scripts with run_command using the absolute path (that needs approval like any command). Skills are written for various assistants; use only the tools you actually have and say so if a step cannot be done.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  allowed: (a) => a.permissions.readFiles,
  execute: async (_ctx, args) => {
    const skill = discoverSkills().find((s) => s.name === args.name)
    if (!skill) throw new Error(`No skill named "${String(args.name)}". Use list_skills.`)
    const { body } = parseSkill(readFileSync(skill.file, 'utf8'))
    return `# Skill: ${skill.name}\nFolder: ${skill.dir}\n\n${clip(body.trim(), BODY_CHARS)}`
  }
}

const readSkillFile: AgentTool = {
  def: {
    name: 'read_skill_file',
    description: 'Read a text file that belongs to a skill (a reference, a script, a template), by path relative to the skill folder. Credential files and binaries are refused.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } }, required: ['name', 'path'] }
  },
  allowed: (a) => a.permissions.readFiles,
  execute: async (_ctx, args) => {
    const skill = discoverSkills().find((s) => s.name === args.name)
    if (!skill) throw new Error(`No skill named "${String(args.name)}". Use list_skills.`)
    if (typeof args.path !== 'string' || !args.path.trim()) throw new Error('path is required.')
    const full = resolve(skill.dir, args.path)
    const rel = relative(skill.dir, full)
    if (rel.startsWith('..') || resolve(rel) === rel) throw new Error('The path must stay inside the skill folder.')
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`${args.path} is not a file of this skill.`)
    // A link inside the skill folder must not lead out of it.
    const real = realpathSync(full)
    const base = realpathSync(skill.dir)
    if (relative(base, real).startsWith('..')) throw new Error('The path must stay inside the skill folder.')
    if (isSecretPath(rel) || isBinaryExt(rel)) throw new Error('That file cannot be read (credential or binary file).')
    return clip(readFileSync(full, 'utf8'), FILE_CHARS)
  }
}

export const SKILL_TOOLS: AgentTool[] = [listSkills, useSkill, readSkillFile]
