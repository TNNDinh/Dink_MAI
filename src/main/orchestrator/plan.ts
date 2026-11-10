import { DEV_ROLES, QA_ROLE, normPath, pathsOverlap } from '../../shared/phases'
import type { ToolDefinition } from '../providers/types'

export const MAX_PLAN_TASKS = 40

export interface PlanTask {
  key: string
  title: string
  description: string
  role: string
  priority: number
  dependsOn: string[]
  /** Files/folders this task owns (development plans). Nobody who runs at the same time may touch them. */
  files: string[]
}

export type PlanResult = { ok: true; tasks: PlanTask[] } | { ok: false; errors: string[] }

export const SUBMIT_PLAN_TOOL: ToolDefinition = {
  name: 'submit_plan',
  description:
    'Submit the complete task plan for the goal. Call it exactly once when the plan is final. If it is rejected, the reply lists what to fix: correct it and call again.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: `1 to ${MAX_PLAN_TASKS} tasks.`,
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Short unique id used by other tasks in depends_on, e.g. "design" or "player_code".' },
            title: { type: 'string', description: 'Imperative title, max 200 characters.' },
            description: { type: 'string', description: 'What to do and the acceptance criteria, specific enough to act on without further questions.' },
            role: { type: 'string', description: 'The role key of the team member who does it (see the team list).' },
            priority: { type: 'integer', description: '1 = high, 2 = normal, 3 = low.' },
            depends_on: { type: 'array', items: { type: 'string' }, description: 'Keys of tasks that must be finished first.' },
            files: { type: 'array', items: { type: 'string' }, description: 'Development plans: the files or folders (relative to the project, e.g. "Assets/Scripts/Player") this task creates or edits. Two tasks that can run at the same time must not list the same file or a folder containing it.' }
          },
          required: ['key', 'title', 'description', 'role']
        }
      }
    },
    required: ['tasks']
  }
}

const KEY = /^[A-Za-z0-9_-]{1,40}$/

/** One spelling of a path claim, keeping its letter case so messages show what the model wrote. */
const normPathKeepCase = (p: string): string => p.trim().split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '')

/**
 * Checks a plan the model produced. Everything the model says is untrusted: roles must exist on this
 * project's team, dependencies must resolve and be acyclic, sizes are bounded. The errors are written to be
 * fed straight back to the model so it can correct itself.
 */
export function validatePlan(raw: unknown, availableRoles: ReadonlySet<string>, opts: { development?: boolean; developers?: number } = {}): PlanResult {
  const errors: string[] = []
  const list = (raw as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(list) || list.length === 0) return { ok: false, errors: ['`tasks` must be a non-empty array.'] }
  if (list.length > MAX_PLAN_TASKS) return { ok: false, errors: [`Too many tasks (${list.length}); the maximum is ${MAX_PLAN_TASKS}. Merge small tasks.`] }

  const tasks: PlanTask[] = []
  const keys = new Set<string>()
  list.forEach((t, i) => {
    const at = `Task #${i + 1}`
    if (typeof t !== 'object' || t === null) return errors.push(`${at} is not an object.`)
    const o = t as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key.trim() : ''
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    const description = typeof o.description === 'string' ? o.description.trim() : ''
    const role = typeof o.role === 'string' ? o.role.trim() : ''
    if (!KEY.test(key)) errors.push(`${at}: key must be 1-40 letters, digits, "_" or "-".`)
    else if (keys.has(key)) errors.push(`${at}: duplicate key "${key}".`)
    else keys.add(key)
    if (!title || title.length > 200) errors.push(`${at} (${key}): title is required (max 200 characters).`)
    if (description.length > 4000) errors.push(`${at} (${key}): description is too long (max 4000 characters).`)
    if (!availableRoles.has(role)) errors.push(`${at} (${key}): role "${role}" is not on the team. Available roles: ${[...availableRoles].join(', ')}.`)
    const pr = o.priority === undefined ? 2 : o.priority
    if (typeof pr !== 'number' || !Number.isInteger(pr) || pr < 1 || pr > 3) errors.push(`${at} (${key}): priority must be 1, 2 or 3.`)
    const deps = o.depends_on === undefined ? [] : o.depends_on
    if (!Array.isArray(deps) || deps.some((d) => typeof d !== 'string')) errors.push(`${at} (${key}): depends_on must be an array of keys.`)
    const rawFiles = o.files === undefined ? [] : o.files
    if (!Array.isArray(rawFiles) || rawFiles.some((f) => typeof f !== 'string')) errors.push(`${at} (${key}): files must be an array of paths.`)
    const files = Array.isArray(rawFiles) ? [...new Set(rawFiles.filter((f): f is string => typeof f === 'string').map((f) => normPathKeepCase(f)).filter(Boolean))] : []
    tasks.push({ key, title, description, role, priority: typeof pr === 'number' ? pr : 2, dependsOn: Array.isArray(deps) ? [...new Set(deps.map(String))] : [], files })
  })
  if (errors.length) return { ok: false, errors }

  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (d === t.key) errors.push(`Task "${t.key}" depends on itself.`)
      else if (!keys.has(d)) errors.push(`Task "${t.key}" depends on unknown key "${d}".`)
    }
  }
  if (errors.length) return { ok: false, errors }

  // Kahn's algorithm: whatever cannot be ordered sits on a cycle.
  const indeg = new Map(tasks.map((t) => [t.key, t.dependsOn.length]))
  const queue = tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.key)
  let seen = 0
  while (queue.length) {
    const k = queue.shift()!
    seen++
    for (const t of tasks) {
      if (t.dependsOn.includes(k)) {
        const n = indeg.get(t.key)! - 1
        indeg.set(t.key, n)
        if (n === 0) queue.push(t.key)
      }
    }
  }
  if (seen !== tasks.length) {
    const stuck = tasks.filter((t) => indeg.get(t.key)! > 0).map((t) => t.key)
    return { ok: false, errors: [`The dependencies form a cycle involving: ${stuck.join(', ')}.`] }
  }
  if (opts.development) {
    const errs = developmentErrors(tasks, availableRoles, opts.developers ?? 1)
    if (errs.length) return { ok: false, errors: errs }
  }
  return { ok: true, tasks }
}

/**
 * The development process, enforced instead of hoped for: developers build the features, and the tester only starts once
 * ALL of that work is finished (directly or through a task that itself waits for it). Without a developer or tester on
 * the team the matching rule does not apply.
 */
function developmentErrors(tasks: PlanTask[], availableRoles: ReadonlySet<string>, developers: number): string[] {
  const errors: string[] = []
  const devKeys = tasks.filter((t) => DEV_ROLES.includes(t.role)).map((t) => t.key)
  const qa = tasks.filter((t) => t.role === QA_ROLE)
  const hasDevRole = DEV_ROLES.some((r) => availableRoles.has(r))
  if (hasDevRole && devKeys.length === 0) errors.push('A development plan needs feature tasks for the developer roles: split the work into features, one task per feature.')
  if (availableRoles.has(QA_ROLE) && qa.length === 0) errors.push(`A development plan needs at least one testing task for the "${QA_ROLE}" role that runs after all the development.`)
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  const ancestors = (key: string): Set<string> => {
    const seen = new Set<string>()
    const walk = (k: string): void => {
      for (const d of byKey.get(k)?.dependsOn ?? []) if (!seen.has(d)) (seen.add(d), walk(d))
    }
    walk(key)
    return seen
  }
  for (const q of qa) {
    const before = ancestors(q.key)
    const missing = devKeys.filter((k) => !before.has(k))
    if (missing.length) errors.push(`Testing task "${q.key}" must start only after development is finished. Add depends_on for: ${missing.join(', ')} (or for one task that itself waits for all of them).`)
  }
  if (developers >= 2) errors.push(...ownershipErrors(tasks, ancestors))
  return errors
}

/**
 * With several developers working at once, two of them must never need the same file at the same time. So every
 * feature task names the files it owns, and two tasks that CAN run together (neither waits for the other, directly or
 * through others) may not share a file or a folder that contains the other's file. A genuinely shared file has to be
 * serialised (depends_on), moved into a foundation task, or left to the integration task.
 */
function ownershipErrors(tasks: PlanTask[], ancestors: (key: string) => Set<string>): string[] {
  const errors: string[] = []
  const devs = tasks.filter((t) => DEV_ROLES.includes(t.role))
  const missing = devs.filter((t) => t.files.length === 0).map((t) => t.key)
  if (missing.length) errors.push(`Every development task must list the files or folders it owns in \`files\` (several developers work at the same time). Missing for: ${missing.join(', ')}.`)
  const before = new Map(devs.map((t) => [t.key, ancestors(t.key)]))
  for (let i = 0; i < devs.length; i++) {
    for (let j = i + 1; j < devs.length; j++) {
      const a = devs[i]
      const b = devs[j]
      if (before.get(a.key)!.has(b.key) || before.get(b.key)!.has(a.key)) continue // one waits for the other: never at the same time
      const shared = a.files.flatMap((x) => b.files.filter((y) => pathsOverlap(x, y)).map((y) => (normPath(x).length <= normPath(y).length ? x : y)))
      if (shared.length) errors.push(`Tasks "${a.key}" and "${b.key}" can run at the same time but both own ${[...new Set(shared)].join(', ')}. Make one depend on the other, move the shared part into a foundation task that both depend on, or leave it to the integration task.`)
    }
  }
  return errors
}

export interface TeamMember {
  role: string
  roleLabel: string
  name: string
  description: string
}

/** The instruction given to the Project Manager on top of its own system prompt. */
export function plannerInstructions(opts: { projectName: string; projectType: string; goal: string; team: TeamMember[]; existing: string[]; canPlay?: boolean; development?: boolean; developerCount?: number }): string {
  const team = opts.team.map((m) => `- role "${m.role}" (${m.roleLabel}, agent "${m.name}"): ${m.description}`).join('\n')
  const existing = opts.existing.length ? `\nTasks that already exist on the board (do not duplicate them; you may depend on none of them, they run too):\n${opts.existing.map((t) => `- ${t}`).join('\n')}\n` : ''
  const imageRule = opts.team.some((m) => m.role === 'image_generator')
    ? '\n- A task for the image_generator role is sent to the image model word for word as its prompt (title, then description) and produces exactly one picture. Write its description as the finished prompt: subject, art style, palette, view, background (say "transparent background" when needed) and size such as 1024x1024. Plan one task per picture; do not put instructions to a person in it.'
    : ''
  const playRule = opts.canPlay
    ? '\n- The team can play Android games in an emulator (android_play). When the goal is to document or rebuild an existing game whose behaviour cannot be read from real C# source (an IL2CPP game gives only class names), plan a play-test task for a role that can run commands BEFORE the task that writes the design document, and make the design task depend on it. The play-test task installs and launches the game, plays the main loop and the first minutes of progression, and writes what it SAW (screens, controls, rules, numbers on screen) to docs/playtest-notes.md. The design document then uses those notes as its VERIFIED source. If the game was never played, the document must say so at the top.'
    : ''
  const analystRule = opts.team.some((m) => m.role === 'game_analyst')
    ? '\n- The team has a game_analyst (Dink_ATU department). When the goal is to document an existing game and a game package (.apk/.xapk/.apks or a PC game folder) is in the project, plan TWO tasks for the game_analyst, so that each one stays small: (1) run Dink_ATU on the package (apk_to_unity analyze, then convert) and write docs/evidence/assets-and-data.md (the strings shown to the player, tutorial text, level and config tables, booster and currency names); (2) depending on (1), write docs/evidence/code-map.md (the classes of the game itself and what they suggest) and, when the game could be played, what was observed. The designer task that writes the design document must depend on both: it reads docs/evidence/ AND researches online (when it can), and states the gameplay as concrete rules with the source of each statement. Do not give the analyst design work, and do not give the designer package analysis. Without a package in the project, plan no analyst task.'
    : ''
  const n = opts.developerCount ?? 1
  const staffing =
    n >= 2
      ? `The user assigned ${n} developers to this project, so up to ${n} features are built at the same time. Every development task MUST list in \`files\` the files or folders it owns, and two tasks that can run at the same time must not share a file (or a folder containing it): two developers editing one file at once corrupt each other's work. If two features really need the same file, make one depend on the other, or put the shared part in the foundation task or the integration task. Give the features to the developer roles in turn.`
      : 'The user assigned ONE developer to this project, so the features are built one after another: order them with depends_on in a sensible build order (foundation first) and do not plan parallel development.'
  const devRule = opts.development
    ? `
- DEVELOPMENT PLAN. Work like a software team: (1) Split the work into features and plan ONE task per feature, each with its own acceptance criteria. ${staffing} (2) A short foundation task first only when features really need shared code (project setup, common data, shared classes); the features depend on it. (3) One integration task that depends on every feature task and makes the whole thing build and run. (4) A code review task after the integration, if the team has that role. (5) The testing task(s) for the qa_tester role LAST: they must depend on the integration (and so on all the development), play/run the real result, and send problems back with request_changes. Do not let testing start before the development is finished.`
    : ''
  return `Plan the work for this project and submit it with the submit_plan tool.

Project: ${opts.projectName} (type: ${opts.projectType})
Goal: ${opts.goal}

Your team (use these exact role keys; each role can only be given work that fits it):
${team}
${existing}
Guidelines:
- Keep the plan as small as the goal allows; every task must be independently verifiable and have acceptance criteria.
- Order the work like a real team: design and architecture first; art/asset work in parallel with implementation when the roles exist; then integration; then a code review task; then a QA/testing task; a final task that summarises the result. Skip stages for which the team has no role.
- Use depends_on so a task starts only when what it needs exists. Tasks without dependencies start immediately and may run in parallel.
- A reviewer or QA task must depend on the implementation it checks. They can send work back for changes, so do not plan separate "fix" tasks.
- Do not assign work to roles that are not in the team list.${imageRule}${playRule}${analystRule}${devRule}
Call submit_plan once.`
}
