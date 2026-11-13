import type { McpContent, McpTool, McpToolResult } from './server'
import { clickElement, formatValue, SNAPSHOT_SCRIPT, typeInto, type ElementQuery, type UiBridge } from './ui-driver'

/** Calls one of the app's own IPC handlers (the same ones the interface uses), without going through the window. */
export type ChannelCaller = (channel: string, ...args: unknown[]) => Promise<unknown>

export interface ToolDeps {
  call: ChannelCaller
  /** Channels `app_call` may reach (everything except dialogs and the few that would let an AI approve itself). */
  channels: () => string[]
  ui: () => UiBridge | null
}

const text = (t: string): McpToolResult => ({ content: [{ type: 'text', text: t }] })
const json = (v: unknown): McpToolResult => text(formatValue(v === null || v === undefined ? 'ok' : v))
const image = (data: string): McpContent => ({ type: 'image', data, mimeType: 'image/png' })

type Props = Record<string, unknown>
const str = (description: string): Props => ({ type: 'string', description })
const num = (description: string): Props => ({ type: 'number', description })
const schema = (properties: Record<string, Props> = {}, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })

const need = (a: Record<string, unknown>, key: string): string => {
  const v = a[key]
  if (typeof v !== 'string' || !v) throw new Error(`"${key}" is required.`)
  return v
}
const opt = (a: Record<string, unknown>, key: string): string | undefined => (typeof a[key] === 'string' && a[key] ? (a[key] as string) : undefined)
const optNum = (a: Record<string, unknown>, key: string): number | undefined => (typeof a[key] === 'number' ? (a[key] as number) : undefined)

function target(a: Record<string, unknown>): ElementQuery {
  const q: ElementQuery = {}
  if (typeof a.index === 'number') q.index = a.index
  if (typeof a.selector === 'string' && a.selector) q.selector = a.selector
  if (typeof a.text === 'string' && a.text) q.text = a.text
  if (typeof a.exact === 'boolean') q.exact = a.exact
  if (typeof a.nth === 'number') q.nth = a.nth
  return q
}
const hasTarget = (q: ElementQuery): boolean => q.index !== undefined || q.selector !== undefined || q.text !== undefined

const TARGET_PROPS: Record<string, Props> = {
  index: num('Element number from the latest ui_snapshot.'),
  text: str('Visible label of the thing to click (button text, tab name, aria-label, placeholder).'),
  selector: str('CSS selector, when the label is ambiguous.'),
  exact: { type: 'boolean', description: 'With text: require the whole label to match, not just part of it.' },
  nth: num('Which match to use when several fit (0 = first).')
}

export function buildTools({ call, channels, ui }: ToolDeps): McpTool[] {
  const bridge = (): UiBridge => {
    const b = ui()
    if (!b) throw new Error('The app window is not available.')
    return b
  }
  const tool = (name: string, description: string, inputSchema: Record<string, unknown>, run: McpTool['run']): McpTool => ({ name, description, inputSchema, run })
  /** A tool that is exactly one IPC call. */
  const ipc = (name: string, description: string, channel: string, inputSchema: Record<string, unknown>, args: (a: Record<string, unknown>) => unknown[] = () => []): McpTool =>
    tool(name, description, inputSchema, async (a) => json(await call(channel, ...args(a))))

  const PROJECT = { projectId: str('Project id (from projects_list).') }

  return [
    // ---------------------------------------------------------------- the studio
    ipc('studio_info', 'Version, data folder and platform of the running Studio.', 'app:info', schema()),
    ipc('projects_list', 'All projects with id, name, type, folder, goal, progress and budget.', 'projects:list', schema()),
    ipc('project_get', 'One project in full.', 'projects:get', schema(PROJECT, ['projectId']), (a) => [need(a, 'projectId')]),
    ipc('agents_list', 'The AI agents (roles, models, permissions).', 'agents:list', schema()),
    ipc('events_recent', 'Recent activity log entries, newest first. Use it to see what a run is doing or why it failed.', 'events:recent', schema({ limit: num('How many (default 100).'), projectId: str('Only this project.'), minLevel: { type: 'string', enum: ['info', 'warn', 'error'], description: 'Hide anything less severe.' } }), (a) => [{ limit: optNum(a, 'limit'), projectId: opt(a, 'projectId'), minLevel: opt(a, 'minLevel') }]),

    // ---------------------------------------------------------------- tasks and runs
    ipc('tasks_list', 'Tasks on the board, optionally for one project or one run.', 'tasks:list', schema({ projectId: str('Only this project.'), runId: str('Only this run.') }), (a) => [{ projectId: opt(a, 'projectId'), runId: opt(a, 'runId') }]),
    ipc('task_get', 'One task with its dependencies, messages and result.', 'tasks:get', schema({ taskId: str('Task id.') }, ['taskId']), (a) => [need(a, 'taskId')]),
    ipc('task_create', 'Adds a task to the board.', 'tasks:create', schema({ ...PROJECT, title: str('Short title.'), description: str('What has to be done.'), role: str('Agent role that should take it.'), priority: num('Higher runs first.') }, ['projectId', 'title']), (a) => [{ projectId: need(a, 'projectId'), title: need(a, 'title'), description: opt(a, 'description'), role: opt(a, 'role') ?? null, priority: optNum(a, 'priority') }]),
    ipc('runs_list', 'Runs (agent teams working a goal), optionally for one project, with status and cost.', 'runs:list', schema({ projectId: str('Only this project.') }), (a) => [opt(a, 'projectId') ?? null]),
    ipc('run_start', 'Starts an agent run on a project. Defaults come from the project (goal, budget, iteration limit).', 'runs:start', schema({ ...PROJECT, goal: str('Overrides the project goal.'), budgetUsd: num('Spending cap in USD.'), maxIterations: num('Iteration cap.'), concurrency: num('Tasks at once, 1-8.'), developers: num('Developers at once, 1-8.') }, ['projectId']), (a) => [{ projectId: need(a, 'projectId'), goal: opt(a, 'goal'), budgetUsd: optNum(a, 'budgetUsd'), maxIterations: optNum(a, 'maxIterations'), concurrency: optNum(a, 'concurrency'), developers: optNum(a, 'developers') }]),
    ipc('run_stop', 'Stops one run.', 'runs:stop', schema({ runId: str('Run id.') }, ['runId']), (a) => [need(a, 'runId')]),
    ipc('run_resume', 'Resumes a paused or budget-stopped run, optionally with a new budget.', 'runs:resume', schema({ runId: str('Run id.'), budgetUsd: num('New spending cap in USD.') }, ['runId']), (a) => [{ id: need(a, 'runId'), budgetUsd: optNum(a, 'budgetUsd') }]),
    ipc('approvals_list', 'Commands and workflow steps waiting for the human to approve. You can read them but only the person at the keyboard can approve.', 'approvals:list', schema()),

    // ---------------------------------------------------------------- project files, git, build
    ipc('files_list', 'Lists a folder inside a project.', 'fs:list', schema({ ...PROJECT, path: str('Folder relative to the project root (default: root).') }, ['projectId']), (a) => [{ projectId: need(a, 'projectId'), path: opt(a, 'path') ?? '' }]),
    ipc('file_read', 'Reads a text file inside a project. The result includes a hash to pass to file_write as expectedHash.', 'fs:read', schema({ ...PROJECT, path: str('File relative to the project root.') }, ['projectId', 'path']), (a) => [{ projectId: need(a, 'projectId'), path: need(a, 'path') }]),
    ipc('file_write', 'Writes a text file inside a project (creates it if missing). Pass expectedHash from file_read to avoid overwriting someone else\'s edit.', 'fs:write', schema({ ...PROJECT, path: str('File relative to the project root.'), content: str('Full new content.'), expectedHash: str('Hash from file_read; omit to overwrite unchecked.') }, ['projectId', 'path', 'content']), (a) => [{ projectId: need(a, 'projectId'), path: need(a, 'path'), content: typeof a.content === 'string' ? a.content : '', expectedHash: opt(a, 'expectedHash') }]),
    ipc('files_search', 'Searches file contents in a project.', 'fs:search', schema({ ...PROJECT, query: str('Text to find.'), regex: { type: 'boolean', description: 'Treat query as a regular expression.' }, path: str('Limit to a folder.') }, ['projectId', 'query']), (a) => [{ projectId: need(a, 'projectId'), query: need(a, 'query'), regex: a.regex === true, path: opt(a, 'path') }]),
    ipc('git_status', 'Branch and changed files of a project.', 'git:status', schema(PROJECT, ['projectId']), (a) => [need(a, 'projectId')]),
    ipc('git_diff', 'Diff of one file in a project.', 'git:diff', schema({ ...PROJECT, path: str('File relative to the project root.'), staged: { type: 'boolean', description: 'Staged changes instead of working tree.' } }, ['projectId', 'path']), (a) => [{ projectId: need(a, 'projectId'), path: need(a, 'path'), staged: a.staged === true }]),
    ipc('automation_detect', 'The build / test / lint / typecheck commands the project itself defines.', 'automation:detect', schema(PROJECT, ['projectId']), (a) => [need(a, 'projectId')]),
    ipc('automation_run', 'Runs the project\'s own build, test, lint or typecheck. Returns the run; poll automation_list for its result.', 'automation:run', schema({ ...PROJECT, kind: { type: 'string', enum: ['build', 'test', 'lint', 'typecheck'], description: 'What to run.' } }, ['projectId', 'kind']), (a) => [{ projectId: need(a, 'projectId'), kind: need(a, 'kind') }]),
    ipc('automation_list', 'Recent build/test runs with problems and test counts.', 'automation:list', schema(PROJECT, ['projectId']), (a) => [need(a, 'projectId')]),

    // ---------------------------------------------------------------- anything else the app can do
    tool('app_channels', 'Lists every app function app_call can reach. Argument shapes are the IpcContract in src/shared/ipc.ts.', schema(), () => json(channels())),
    tool(
      'app_call',
      'Calls any app function by channel name, exactly as the interface does (window.api.invoke). Prefer the dedicated tools; use this for the rest (agents, connections, workflows, assets, checkpoints, preview, ...). Argument shapes: IpcContract in src/shared/ipc.ts.',
      schema({ channel: str('Channel such as "checkpoints:create".'), args: { type: 'array', items: {}, description: 'Positional arguments for that channel (usually one object).' } }, ['channel']),
      async (a) => json(await call(need(a, 'channel'), ...(Array.isArray(a.args) ? a.args : [])))
    ),

    // ---------------------------------------------------------------- the window
    tool('ui_screenshot', 'Screenshot of the Studio window as the user sees it. Works even if other windows cover it.', schema({ maxWidth: num('Scale down to this width in pixels (default 1280).') }), async (a) => {
      const shot = await bridge().capture(Math.min(Math.max(optNum(a, 'maxWidth') ?? 1280, 320), 3840))
      return { content: [image(shot.data), { type: 'text', text: `${shot.width}x${shot.height}` }] }
    }),
    tool('ui_snapshot', 'Text of the visible page plus a numbered list of everything clickable or typeable, with positions. Cheaper and more precise than a screenshot; use the numbers with ui_click / ui_type.', schema(), async () => json(await bridge().evaluate(SNAPSHOT_SCRIPT))),
    tool('ui_click', 'Clicks something in the window with a real mouse click. Identify it by index, text or selector.', schema({ ...TARGET_PROPS, button: { type: 'string', enum: ['left', 'right'] }, double: { type: 'boolean', description: 'Double click.' } }), async (a) => {
      const q = target(a)
      if (!hasTarget(q)) throw new Error('Give index, text or selector.')
      const at = await clickElement(bridge(), q, { button: a.button === 'right' ? 'right' : 'left', double: a.double === true })
      return text(`Clicked <${at.tag}> "${at.label}" at ${at.x},${at.y}.`)
    }),
    tool('ui_type', 'Types text. With a target it is clicked first to focus it; without one the focused element receives the text.', schema({ ...TARGET_PROPS, value: str('Text to type.'), clear: { type: 'boolean', description: 'Select all and delete what is there first.' }, submit: { type: 'boolean', description: 'Press Enter afterwards.' } }, ['value']), async (a) => {
      const q = target(a)
      const at = await typeInto(bridge(), typeof a.value === 'string' ? a.value : '', hasTarget(q) ? q : null, { clear: a.clear === true, submit: a.submit === true })
      return text(at ? `Typed into <${at.tag}> "${at.label}".` : 'Typed into the focused element.')
    }),
    tool('ui_key', 'Presses a key, e.g. "Enter", "Escape", "Tab", "ArrowDown", or a letter with modifiers like ["control"] for Ctrl+S.', schema({ key: str('Key name or single character.'), modifiers: { type: 'array', items: { type: 'string', enum: ['shift', 'control', 'alt', 'meta'] } } }, ['key']), async (a) => {
      await bridge().key(need(a, 'key'), Array.isArray(a.modifiers) ? a.modifiers.map(String) : [])
      return text('ok')
    }),
    tool('ui_eval', 'Runs JavaScript inside the app window and returns the result (pass an expression, or an async IIFE such as "(async () => { ... })()"). The page API is window.api.invoke(channel, ...args). Last resort when the other ui_* tools cannot do it.', schema({ code: str('JavaScript expression.') }, ['code']), async (a) => json(await bridge().evaluate(need(a, 'code'))))
  ]
}
