import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_TIMEOUT_MS } from '../workspace/commands'
import type { AgentTool, ToolContext } from './tools'

/**
 * Plays an Android game on the BlueStacks emulator through adb, so an agent can learn how a game behaves when its code
 * cannot be recovered completely (IL2CPP builds give outlines, not logic). Tool results are text, so the agent reads the
 * screen through the UI hierarchy (`ui_dump`); screenshots are saved into the project for people to look at.
 */
const ACTIONS = ['connect', 'install', 'packages', 'launch', 'stop', 'ui_dump', 'screenshot', 'tap', 'swipe', 'key', 'text', 'logcat'] as const
export type AndroidAction = (typeof ACTIONS)[number]
const KEYS: Record<string, number> = { home: 3, back: 4, enter: 66, menu: 82, app_switch: 187 }
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/
const SHOT_DIR = 'atu_output/screens'
const DEFAULT_TIMEOUT_MS = 120_000
const OUTPUT_CHARS = 14_000

/** BlueStacks' own adb (HD-Adb.exe), ANDROID_ADB / `adb` as fallbacks. */
export function findAdb(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string {
  const roots = [env.BLUESTACKS_DIR, 'C:\\Program Files\\BlueStacks_nxt', 'C:\\Program Files\\BlueStacks', 'D:\\Program Files\\BlueStacks_nxt'].filter((r): r is string => Boolean(r))
  for (const r of roots) if (exists(join(r, 'HD-Adb.exe'))) return join(r, 'HD-Adb.exe')
  return env.ANDROID_ADB && exists(env.ANDROID_ADB) ? env.ANDROID_ADB : 'adb'
}

export interface AndroidRequest {
  adb: string
  serial: string
  action: AndroidAction
  apk?: string
  package?: string
  x?: number
  y?: number
  x2?: number
  y2?: number
  durationMs?: number
  key?: string
  text?: string
  file?: string
  lines?: number
}

const quote = (s: string): string => {
  if (/["\r\n%^&|<>`$]/.test(s)) throw new Error(`Unsafe characters in "${s}".`)
  return `"${s}"`
}
const coord = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000) throw new Error(`${what} must be a screen coordinate (0-10000).`)
  return Math.trunc(v)
}
const pkg = (v: unknown): string => {
  if (typeof v !== 'string' || !PACKAGE.test(v)) throw new Error('package must look like com.company.game.')
  return v
}

/** The adb command line for one action. Values are validated or quoted so nothing can add another command. */
export function buildAndroidCommand(r: AndroidRequest): string {
  if (!/^[A-Za-z0-9_.:-]{1,60}$/.test(r.serial)) throw new Error('Invalid device address.')
  const adb = quote(r.adb)
  const dev = `${adb} -s ${r.serial}`
  switch (r.action) {
    case 'connect':
      return `${adb} connect ${r.serial}`
    case 'install':
      if (!r.file) throw new Error('apk is required.')
      return `${dev} install -r ${quote(r.file)}`
    case 'packages':
      return `${dev} shell pm list packages -3`
    case 'launch':
      return `${dev} shell monkey -p ${pkg(r.package)} -c android.intent.category.LAUNCHER 1`
    case 'stop':
      return `${dev} shell am force-stop ${pkg(r.package)}`
    case 'ui_dump':
      return `${dev} shell uiautomator dump /dev/tty`
    case 'screenshot':
      if (!r.file) throw new Error('screenshot needs an output file.')
      return `${dev} exec-out screencap -p > ${quote(r.file)}`
    case 'tap':
      return `${dev} shell input tap ${coord(r.x, 'x')} ${coord(r.y, 'y')}`
    case 'swipe':
      return `${dev} shell input swipe ${coord(r.x, 'x')} ${coord(r.y, 'y')} ${coord(r.x2, 'x2')} ${coord(r.y2, 'y2')} ${Math.min(Math.max(Math.trunc(r.durationMs ?? 300), 50), 5000)}`
    case 'key': {
      const code = KEYS[String(r.key)]
      if (!code) throw new Error(`key must be one of: ${Object.keys(KEYS).join(', ')}.`)
      return `${dev} shell input keyevent ${code}`
    }
    case 'text':
      if (!r.text || !/^[A-Za-z0-9 ._@-]{1,200}$/.test(r.text)) throw new Error('text may only contain letters, digits, space and ._@- (max 200).')
      return `${dev} shell input text ${r.text.replace(/ /g, '%s')}`
    case 'logcat':
      return `${dev} logcat -d -t ${Math.min(Math.max(Math.trunc(r.lines ?? 200), 10), 1000)} *:W`
  }
}

const androidPlay: AgentTool = {
  def: {
    name: 'android_play',
    description:
      'Play an Android game on the BlueStacks emulator (through adb) to learn how it really works when its code could not be recovered fully: install an APK, launch it, read the screen as text (ui_dump lists texts, buttons and their bounds; games drawn with OpenGL show little, so also use screenshot), tap, swipe, press keys, and read warnings from logcat. Work step by step: connect, install, packages (find the package name), launch, then repeat ui_dump / tap. Note what you see and write it into the documentation (write_memory or a doc file). Screenshots are saved to atu_output/screens/ for people to review. BlueStacks must be running with ADB enabled (Settings > Advanced). ONLY use games the user owns or has the right to analyse.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        apk: { type: 'string', description: 'For install: path of the .apk relative to the project root.' },
        package: { type: 'string', description: 'For launch/stop: the package name, e.g. com.company.game.' },
        x: { type: 'integer' },
        y: { type: 'integer' },
        x2: { type: 'integer', description: 'Swipe end.' },
        y2: { type: 'integer', description: 'Swipe end.' },
        duration_ms: { type: 'integer', description: 'Swipe duration, default 300.' },
        key: { type: 'string', enum: Object.keys(KEYS) },
        text: { type: 'string' },
        lines: { type: 'integer', description: 'logcat lines, default 200.' },
        name: { type: 'string', description: 'Screenshot file name without extension.' }
      },
      required: ['action']
    }
  },
  allowed: (a) => a.permissions.runCommands !== 'none' && a.permissions.writeFiles,
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace || !ctx.commands) throw new Error('Running commands is not available.')
    const action = args.action as AndroidAction
    if (!ACTIONS.includes(action)) throw new Error(`action must be one of: ${ACTIONS.join(', ')}.`)
    const sandbox = ctx.workspace.sandbox(ctx.projectId)
    let file: string | undefined
    let shot: string | undefined
    if (action === 'install') {
      if (typeof args.apk !== 'string' || !args.apk.trim()) throw new Error('apk is required.')
      const p = sandbox.resolve(args.apk.trim())
      if (!existsSync(p.full)) throw new Error(`${p.rel} does not exist in the project.`)
      file = p.full
    }
    if (action === 'screenshot') {
      const name = typeof args.name === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(args.name) ? args.name : `shot-${Date.now().toString(36)}`
      shot = `${SHOT_DIR}/${name}.png`
      const dir = sandbox.resolve(SHOT_DIR).full
      await import('node:fs/promises').then((f) => f.mkdir(dir, { recursive: true }))
      file = sandbox.resolve(shot).full
    }
    const serial = process.env.BLUESTACKS_ADB_SERIAL || `127.0.0.1:${process.env.BLUESTACKS_ADB_PORT || '5555'}`
    const command = buildAndroidCommand({
      adb: findAdb(),
      serial,
      action,
      file,
      package: typeof args.package === 'string' ? args.package : undefined,
      x: args.x as number,
      y: args.y as number,
      x2: args.x2 as number,
      y2: args.y2 as number,
      durationMs: typeof args.duration_ms === 'number' ? args.duration_ms : undefined,
      key: typeof args.key === 'string' ? args.key : undefined,
      text: typeof args.text === 'string' ? args.text : undefined,
      lines: typeof args.lines === 'number' ? args.lines : undefined
    })
    const project = ctx.workspace.project(ctx.projectId)
    const task = ctx.db.get<{ title: string }>(`SELECT title FROM tasks WHERE id = ?`, ctx.taskId)
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
      timeoutMs: action === 'install' ? MAX_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
      signal: ctx.signal
    })
    const out = r.output.length > OUTPUT_CHARS ? `${r.output.slice(0, OUTPUT_CHARS)}\n[… clipped …]` : r.output
    const head = r.outcome === 'exited' ? (r.exitCode === 0 ? 'OK.' : `adb exit code ${r.exitCode}.`) : r.outcome === 'timeout' ? 'adb timed out.' : `${r.outcome}${r.message ? `: ${r.message}` : ''}`
    const hint = r.exitCode !== 0 && /no devices|offline|cannot connect|refused/i.test(r.output) ? '\nIs BlueStacks running with ADB enabled? Call action "connect" first.' : ''
    return `${head}${shot && r.exitCode === 0 ? ` Saved ${shot}.` : ''}\n${action === 'screenshot' ? '' : out || '(no output)'}${hint}`
  }
}

export const ANDROID_TOOLS: AgentTool[] = [androidPlay]
