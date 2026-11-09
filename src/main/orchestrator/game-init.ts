import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { MAX_TIMEOUT_MS } from '../workspace/commands'
import { readEditorVersion } from './unity-tools'
import type { AgentTool, ToolContext } from './tools'

/**
 * Seeds a brand-new game project from a base template so the rest of the Unity pipeline (unity_run, unity_bridge,
 * android_build) has a real project to work on. Without this there is no way to START a game from the app: every
 * Unity tool refuses a folder that has no ProjectSettings/ProjectVersion.txt, and apk_to_unity only reverse-engineers
 * an APK you already own.
 *
 * The template is a Git branch of a template repo (default: TNNDinh/Base_Template, branch base_mobile — a complete
 * Unity mobile project). We clone one branch shallow into a temporary folder inside the project, move its contents to
 * the project root (keeping the project's own .git, dropping the template's history), and remove the temp folder.
 */
const CLONE_TIMEOUT_MS = 10 * 60_000
const TEMP_DIR = '.game_template_tmp'
export const DEFAULT_TEMPLATE_REPO = 'https://github.com/TNNDinh/Base_Template.git'
/** The template repo's base branches, most useful first. Any other branch of the repo may still be named explicitly. */
export const KNOWN_TEMPLATES = ['base_mobile', 'base_pc', 'auto_chess', 'bus_dash', 'kingdom_assault_3d', 'mircro_rpg', 'prop_horror'] as const

const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/
const SAFE_REPO = /^https:\/\/[A-Za-z0-9._/-]+\.git$/

export function templateRepo(env: NodeJS.ProcessEnv = process.env): string {
  const r = env.GAME_TEMPLATE_REPO?.trim()
  return r && SAFE_REPO.test(r) ? r : DEFAULT_TEMPLATE_REPO
}

/** The shell command for one shallow, single-branch clone. Branch and repo are validated so nothing can be injected. */
export function buildCloneCommand(repo: string, branch: string, tempDir: string): string {
  if (!SAFE_REPO.test(repo)) throw new Error('The template repository must be an https://…​.git URL.')
  if (!SAFE_BRANCH.test(branch) || branch.includes('..')) throw new Error('The template name may only contain letters, digits, ".", "_", "-" and "/".')
  return `git clone --depth 1 --single-branch --branch ${branch} ${repo} ${tempDir}`
}

const gameInit: AgentTool = {
  def: {
    name: 'game_init',
    description:
      'Seed THIS (empty) project with a ready-made game template so you can actually start a game: it clones a base Unity project (by default the mobile base) into the project root. Use it once, at the very start, before any unity_run / unity_bridge / android_build — those tools refuse a folder that is not yet a Unity project. The project folder must be empty (apart from its .git); it will NOT overwrite an existing Unity project. After it succeeds the folder is a full Unity project (Assets/, Packages/, ProjectSettings/) you can compile and build. The clone goes through the normal command approval.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', description: `Which base to start from, a branch of the template repo. Common ones: ${KNOWN_TEMPLATES.join(', ')}. Default "base_mobile" (a Unity mobile game).` },
        repo_url: { type: 'string', description: 'Override the template repository (an https://…​.git URL). Defaults to the built-in Base_Template repo, or GAME_TEMPLATE_REPO.' },
        timeout_seconds: { type: 'integer', description: `Default ${CLONE_TIMEOUT_MS / 1000}, max ${MAX_TIMEOUT_MS / 1000}.` }
      }
    }
  },
  allowed: (a) => a.permissions.runCommands !== 'none' && a.permissions.writeFiles,
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace || !ctx.commands) throw new Error('Running commands is not available.')
    const sandbox = ctx.workspace.sandbox(ctx.projectId)
    const root = sandbox.root

    if (readEditorVersion(root)) throw new Error('This project is already a Unity project (ProjectSettings/ProjectVersion.txt exists). game_init only seeds a fresh project; it will not overwrite one.')

    // The folder must be empty apart from its own .git, so moving the template in cannot clobber anything.
    const existing = (await fsp.readdir(root)).filter((n) => n.toLowerCase() !== '.git' && n !== TEMP_DIR)
    if (existing.length > 0) {
      throw new Error(`The project folder is not empty (${existing.slice(0, 8).join(', ')}${existing.length > 8 ? ', …' : ''}). game_init seeds a brand-new game, so start from an empty project (or remove those files first).`)
    }

    const branch = typeof args.template === 'string' && args.template.trim() ? args.template.trim() : 'base_mobile'
    const repo = typeof args.repo_url === 'string' && args.repo_url.trim() ? args.repo_url.trim() : templateRepo()
    const command = buildCloneCommand(repo, branch, TEMP_DIR) // validates branch and repo

    const tempFull = join(root, TEMP_DIR)
    await fsp.rm(tempFull, { recursive: true, force: true })

    const project = ctx.workspace.project(ctx.projectId)
    const task = ctx.db.get<{ title: string }>(`SELECT title FROM tasks WHERE id = ?`, ctx.taskId)
    const timeoutMs = (typeof args.timeout_seconds === 'number' ? Math.min(Math.max(Math.trunc(args.timeout_seconds), 1), MAX_TIMEOUT_MS / 1000) : CLONE_TIMEOUT_MS / 1000) * 1000
    const r = await ctx.commands.run({
      projectId: ctx.projectId,
      projectName: project.name,
      sandbox,
      command,
      origin: 'agent',
      policy: ctx.agent.permissions.runCommands,
      agent: { id: ctx.agent.id, name: ctx.agent.name },
      runId: ctx.runId,
      taskId: ctx.taskId,
      taskTitle: task?.title ?? null,
      timeoutMs,
      signal: ctx.signal
    })

    const tail = r.output.length > 4000 ? r.output.slice(-4000) : r.output
    if (r.outcome !== 'exited' || r.exitCode !== 0) {
      await fsp.rm(tempFull, { recursive: true, force: true }).catch(() => undefined)
      const why = r.outcome === 'timeout' ? `timed out after ${timeoutMs / 1000}s` : `failed (${r.outcome}${r.exitCode != null ? `, exit code ${r.exitCode}` : ''})`
      throw new Error(`Cloning the "${branch}" template ${why}. Check the template name and that git and the network are available.\n${tail || '(no output)'}`)
    }

    // Move the template's contents up into the project root, keeping the project's own .git and dropping the template's.
    let moved = 0
    try {
      for (const name of await fsp.readdir(tempFull)) {
        if (name.toLowerCase() === '.git') continue
        await fsp.rename(join(tempFull, name), join(root, name))
        moved++
      }
    } finally {
      await fsp.rm(tempFull, { recursive: true, force: true }).catch(() => undefined)
    }

    const version = readEditorVersion(root)
    if (!version) throw new Error(`The "${branch}" template was cloned but it is not a Unity project (no ProjectSettings/ProjectVersion.txt). Pick a base template branch such as ${KNOWN_TEMPLATES.join(', ')}.`)

    ctx.events.record({ projectId: ctx.projectId, runId: ctx.runId, agentId: ctx.agent.id, level: 'info', type: 'game.init', message: `Seeded the project from the "${branch}" template (Unity ${version}).` })
    return `Seeded the project from the "${branch}" template: ${moved} top-level item(s), Unity ${version}.\nIt is now a Unity project. Next: open it with unity_run (mode "compile") to check it builds, then android_build (target "apk") for a test build.`
  }
}

export const GAME_INIT_TOOLS: AgentTool[] = [gameInit]
