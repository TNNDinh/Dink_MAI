import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_TIMEOUT_MS } from '../workspace/commands'
import type { AgentTool, ToolContext } from './tools'

const OUTPUT_CHARS = 20_000
const UNITY_TIMEOUT_MS = 10 * 60_000
const MODES = ['compile', 'test_editmode', 'test_playmode', 'execute_method'] as const
type UnityMode = (typeof MODES)[number]
const TARGETS = ['Android', 'iOS', 'StandaloneWindows64', 'WebGL']
const SAFE_NAME = /^[A-Za-z0-9_.]+$/

/**
 * True only while an editor really has the project open. Unity keeps Temp/UnityLockfile open and exclusive, so a file that can
 * be opened is a leftover from a crashed or killed run and does not count.
 */
export function isProjectLocked(projectRoot: string, open: (path: string, flags: string) => number = openSync): boolean {
  const lock = join(projectRoot, 'Temp', 'UnityLockfile')
  if (!existsSync(lock)) return false
  try {
    closeSync(open(lock, 'r+'))
    return false
  } catch {
    return true
  }
}

/** The editor version a Unity project asks for (ProjectSettings/ProjectVersion.txt), or null if it is not a Unity project. */
export function readEditorVersion(projectRoot: string): string | null {
  try {
    const m = /m_EditorVersion:\s*(\S+)/.exec(readFileSync(join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8'))
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** Finds Unity.exe for a version: UNITY_EDITOR_PATH first, then UNITY_EDITORS_DIR and the usual install folders. */
export function findUnityEditor(version: string, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | null {
  if (env.UNITY_EDITOR_PATH && exists(env.UNITY_EDITOR_PATH)) return env.UNITY_EDITOR_PATH
  const roots = [env.UNITY_EDITORS_DIR, 'C:\\Program Files\\Unity\\Hub\\Editor', 'D:\\Unity\\Hub\\Editor', 'D:\\EditorUnity'].filter((r): r is string => Boolean(r))
  for (const r of roots) {
    const p = join(r, version, 'Editor', 'Unity.exe')
    if (exists(p)) return p
  }
  return null
}

export interface UnityRequest {
  editor: string
  projectRoot: string
  mode: UnityMode
  method?: string
  buildTarget?: string
  testFilter?: string
  /** Extra arguments for the method, e.g. ['-dmOut', 'D:/x.apk']; each is quoted. */
  extra?: string[]
}

/** The shell command for one Unity run. Every user-controlled piece is validated, so nothing can add another command. */
export function buildUnityCommand(r: UnityRequest): string {
  const q = (s: string): string => {
    if (/["\r\n%^&|<>]/.test(s)) throw new Error(`Unsafe characters in "${s}".`)
    return `"${s}"`
  }
  const args = ['-batchmode', '-nographics', '-projectPath', q(r.projectRoot), '-logFile', '-']
  if (r.buildTarget) {
    if (!TARGETS.includes(r.buildTarget)) throw new Error(`build_target must be one of: ${TARGETS.join(', ')}.`)
    args.push('-buildTarget', r.buildTarget)
  }
  if (r.mode === 'compile') args.push('-quit')
  else if (r.mode === 'execute_method') {
    if (!r.method || !SAFE_NAME.test(r.method)) throw new Error('method must look like Namespace.Class.Method.')
    args.push('-quit', '-executeMethod', r.method)
    for (const e of r.extra ?? []) args.push(q(e))
  } else {
    args.push('-runTests', '-testPlatform', r.mode === 'test_editmode' ? 'EditMode' : 'PlayMode', '-testResults', q(join(r.projectRoot, 'Temp', 'agent-test-results.xml')))
    if (r.testFilter) {
      if (!SAFE_NAME.test(r.testFilter)) throw new Error('test_filter may only contain letters, digits, "_" and ".".')
      args.push('-testFilter', r.testFilter)
    }
  }
  return `${q(r.editor)} ${args.join(' ')}`
}

const unityRun: AgentTool = {
  def: {
    name: 'unity_run',
    description:
      'Open the Unity editor on this project in batch mode (no window) and let it work: compile the scripts and report errors, run EditMode/PlayMode tests, or run a static editor method (e.g. a build or a scene-setup script). Needs a Unity project at the project root. Unity cannot open a project that is already open in the editor. It is slow (a minute or more), so batch your changes first and do not call it after every small edit. The command goes through the normal approval policy.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: [...MODES] },
        method: { type: 'string', description: 'For execute_method: Namespace.Class.Method of a public static editor method.' },
        build_target: { type: 'string', enum: TARGETS, description: 'Optional platform to switch to first.' },
        test_filter: { type: 'string', description: 'For tests: a test name or namespace to run.' },
        timeout_seconds: { type: 'integer', description: `Default ${UNITY_TIMEOUT_MS / 1000}, max ${MAX_TIMEOUT_MS / 1000}.` }
      },
      required: ['mode']
    }
  },
  allowed: (a) => a.permissions.runCommands !== 'none',
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace || !ctx.commands) throw new Error('Running commands is not available.')
    const mode = args.mode as UnityMode
    if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}.`)
    const sandbox = ctx.workspace.sandbox(ctx.projectId)
    const version = readEditorVersion(sandbox.root)
    if (!version) throw new Error('This project folder is not a Unity project (no ProjectSettings/ProjectVersion.txt).')
    if (isProjectLocked(sandbox.root)) {
      throw new Error('The project looks open in a Unity editor already (Temp/UnityLockfile). Close it, or ask the user to, then try again.')
    }
    const editor = findUnityEditor(version)
    if (!editor) throw new Error(`Unity ${version} was not found. Set UNITY_EDITOR_PATH to Unity.exe, or UNITY_EDITORS_DIR to the folder holding the version folders.`)
    const command = buildUnityCommand({
      editor,
      projectRoot: sandbox.root,
      mode,
      method: typeof args.method === 'string' ? args.method : undefined,
      buildTarget: typeof args.build_target === 'string' ? args.build_target : undefined,
      testFilter: typeof args.test_filter === 'string' ? args.test_filter : undefined
    })
    const project = ctx.workspace.project(ctx.projectId)
    const task = ctx.db.get<{ title: string }>(`SELECT title FROM tasks WHERE id = ?`, ctx.taskId)
    const timeoutMs = (typeof args.timeout_seconds === 'number' ? Math.min(Math.max(Math.trunc(args.timeout_seconds), 1), MAX_TIMEOUT_MS / 1000) : UNITY_TIMEOUT_MS / 1000) * 1000
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
    const out = r.output.length > OUTPUT_CHARS ? `${r.output.slice(0, OUTPUT_CHARS / 4)}\n[… clipped …]\n${r.output.slice(-OUTPUT_CHARS * 3 / 4)}` : r.output
    const head = r.outcome === 'exited' ? `Unity exit code ${r.exitCode} after ${(r.durationMs / 1000).toFixed(0)}s.` : r.outcome === 'timeout' ? `Unity timed out after ${timeoutMs / 1000}s and was killed.` : `${r.outcome}${r.message ? `: ${r.message}` : ''}`
    // Compile errors look like "Assets/X.cs(12,5): error CS1002: ..."; list them first so the model sees them.
    const errors = [...new Set(r.output.split('\n').filter((l) => /error CS\d+/.test(l)).map((l) => l.trim()))].slice(0, 30)
    return `${head}${errors.length ? `\nCompile errors:\n${errors.join('\n')}` : ''}\n${out || '(no output)'}`
  }
}

export const UNITY_TOOLS: AgentTool[] = [unityRun]
