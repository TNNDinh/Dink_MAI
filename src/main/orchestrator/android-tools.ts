import { existsSync, statSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MAX_TIMEOUT_MS } from '../workspace/commands'

const execFileAsync = promisify(execFile)
import type { AgentTool, ToolContext } from './tools'
import { describeShot, prepareScreenshot } from './screenshot'
import { compactUiDump } from './ui-dump'

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
const LOGCAT_CHARS = 6_000

/** BlueStacks' own adb (HD-Adb.exe), ANDROID_ADB / `adb` as fallbacks. */
export function findAdb(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string {
  const roots = [env.BLUESTACKS_DIR, 'C:\\Program Files\\BlueStacks_nxt', 'C:\\Program Files\\BlueStacks', 'D:\\Program Files\\BlueStacks_nxt'].filter((r): r is string => Boolean(r))
  for (const r of roots) if (exists(join(r, 'HD-Adb.exe'))) return join(r, 'HD-Adb.exe')
  return env.ANDROID_ADB && exists(env.ANDROID_ADB) ? env.ANDROID_ADB : 'adb'
}

/** Windows ships bsdtar as tar.exe (System32); it extracts .zip/.xapk bundles, no extra dependency. */
export function findTar(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
}

/** APKPure / split-APK bundle extensions — all plain zip archives of several .apk parts. */
const ARCHIVE_EXT = new Set(['.xapk', '.apkm', '.apks', '.zip'])

/** Every .apk under a folder (recursively). Base first so install-multiple never sees only config/asset packs up front. */
function listApks(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listApks(p))
    else if (extname(e.name).toLowerCase() === '.apk') out.push(p)
  }
  // A config/asset split carries no launcher; keep those after the base apk (adb accepts any order, but this is clearer in logs).
  const isSplit = (f: string): boolean => /(^|[._-])config[._]|Pack\.apk$|^split[._-]/i.test(basename(f))
  return out.sort((a, b) => Number(isSplit(a)) - Number(isSplit(b)) || a.localeCompare(b))
}

/**
 * The .apk files to hand `install` for one target: a single .apk as-is, a folder of split apks, or a .xapk/.apkm/.apks/.zip
 * bundle extracted into `extractDir` first. Several parts → the caller uses install-multiple so the app installs complete and
 * never has to reach Google Play for a missing pack.
 */
export async function resolveInstallApks(
  targetFull: string,
  extractDir: string,
  deps: { tar?: string; run?: typeof execFileAsync } = {}
): Promise<string[]> {
  const run = deps.run ?? execFileAsync
  const st = statSync(targetFull)
  if (st.isDirectory()) {
    const apks = listApks(targetFull)
    if (!apks.length) throw new Error(`No .apk files were found in ${basename(targetFull)}.`)
    return apks
  }
  const ext = extname(targetFull).toLowerCase()
  if (ext === '.apk') return [targetFull]
  if (!ARCHIVE_EXT.has(ext)) throw new Error(`Cannot install ${basename(targetFull)}: expected a .apk, a .xapk/.apkm bundle, or a folder of split apks.`)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  await run(deps.tar ?? findTar(), ['-xf', targetFull, '-C', extractDir])
  const apks = listApks(extractDir)
  if (!apks.length) throw new Error(`No .apk files were found inside ${basename(targetFull)}.`)
  return apks
}

export interface AndroidRequest {
  adb: string
  serial: string
  action: AndroidAction
  apk?: string
  /** For install: every .apk to push. One → `install`; several (split APKs / a .xapk bundle) → `install-multiple`. */
  files?: string[]
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
    case 'install': {
      const apks = r.files && r.files.length ? r.files : r.file ? [r.file] : []
      if (!apks.length) throw new Error('apk is required.')
      const quoted = apks.map(quote).join(' ')
      // Two things make a delisted game usable on the emulator, both set here at install time:
      // 1) install-multiple for a split app (base + config/asset packs, e.g. an APKPure .xapk) — the base alone launches and
      //    tries to fetch its missing packs from Play, the "get this app on Google Play" dead end for a game that is gone.
      // 2) -i com.android.vending records Play as the installer, so the game's own "was I installed from Play?" check passes
      //    instead of bouncing the user to the (now empty) Play listing.
      const opts = '-r -i com.android.vending'
      return apks.length === 1 ? `${dev} install ${opts} ${quoted}` : `${dev} install-multiple ${opts} ${quoted}`
    }
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
      'Play an Android game on the BlueStacks emulator (through adb) to learn how it really works when its code could not be recovered fully: install an APK, launch it, read the screen as text (ui_dump lists texts, buttons and their bounds; games drawn with OpenGL show little, so also use screenshot), tap, swipe, press keys, and read warnings from logcat. For install, apk may be a single .apk, an APKPure .xapk / .apkm bundle, or a folder of split apks — every part is installed together (install-multiple), which a split game needs or it launches and asks to be fetched from Google Play (a dead end for a delisted game). Work step by step: connect, install, packages (find the package name), launch, then repeat ui_dump / tap. Note what you see and write it into the documentation (write_memory or a doc file). Screenshots are saved to atu_output/screens/ for people to review. BlueStacks must be running with ADB enabled (Settings > Advanced). ONLY use games the user owns or has the right to analyse.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        apk: { type: 'string', description: 'For install: path (relative to the project root) of a .apk, a .xapk/.apkm bundle, or a folder of split apks. All parts are installed together.' },
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
    let files: string[] | undefined
    let shot: string | undefined
    if (action === 'install') {
      if (typeof args.apk !== 'string' || !args.apk.trim()) throw new Error('apk is required.')
      const p = sandbox.resolve(args.apk.trim())
      if (!existsSync(p.full)) throw new Error(`${p.rel} does not exist in the project.`)
      const safe = args.apk.trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(-60)
      const extractDir = sandbox.resolve(`atu_output/.install/${safe}`).full
      files = await resolveInstallApks(p.full, extractDir)
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
      files,
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
    const what = describeAction(action, args)
    const note = (level: 'info' | 'warn', message: string, data?: Record<string, unknown>): void => {
      ctx.events.record({ projectId: ctx.projectId, runId: ctx.runId, agentId: ctx.agent.id, level, type: 'android.action', message: `${ctx.agent.name}: ${message}`, data: { action, ...data } })
    }
    if (action === 'install') note('info', `${what}${files && files.length > 1 ? ` — ${files.length} split parts together` : ''} (can take a while)`)
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
    // A screen dump is mostly layout noise: keep only what can be read or pressed. A log is clipped from the front (the newest lines matter).
    const ui = action === 'ui_dump' && r.exitCode === 0 ? compactUiDump(r.output) : null
    const limit = action === 'logcat' ? LOGCAT_CHARS : OUTPUT_CHARS
    const out = ui ? ui.text : r.output.length <= limit ? r.output : action === 'logcat' ? `[… older lines clipped …]\n${r.output.slice(-limit)}` : `${r.output.slice(0, limit)}\n[… clipped …]`
    const head = r.outcome === 'exited' ? (r.exitCode === 0 ? 'OK.' : `adb exit code ${r.exitCode}.`) : r.outcome === 'timeout' ? 'adb timed out.' : `${r.outcome}${r.message ? `: ${r.message}` : ''}`
    const hint = r.exitCode !== 0 && /no devices|offline|cannot connect|refused/i.test(r.output) ? '\nIs BlueStacks running with ADB enabled? Call action "connect" first.' : ''
    // Shown live in the Activity panel so the user can follow what the agent does on the emulator.
    const seen = ui ? ` (${ui.shown} readable elements)` : ''
    note(r.exitCode === 0 ? 'info' : 'warn', `${what} → ${head.replace(/\.$/, '')}${seen}${shot && r.exitCode === 0 ? ` · ${shot}` : ''}`, { ...(shot ? { screenshot: shot } : {}), ok: r.exitCode === 0 })
    // A model that can see pictures gets the screenshot itself: games drawn with OpenGL have an almost empty ui_dump.
    let seen2 = ''
    if (shot && file && r.exitCode === 0 && ctx.canSeeImages && ctx.attachImage) {
      try {
        const prepared = await prepareScreenshot(file)
        if (prepared) {
          ctx.attachImage(prepared.image)
          seen2 = ` ${describeShot(prepared)}`
        } else seen2 = ' (The file is not a usable PNG, so it could not be shown to you.)'
      } catch (e) {
        seen2 = ` (The screenshot could not be shown to you: ${e instanceof Error ? e.message : String(e)})`
      }
    }
    return `${head}${shot && r.exitCode === 0 ? ` Saved ${shot}.` : ''}${seen2}\n${action === 'screenshot' ? '' : out || '(no output)'}${hint}`
  }
}

/** A short human sentence for one emulator action, for the Activity panel. */
export function describeAction(action: AndroidAction, args: Record<string, unknown>): string {
  const n = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : '?')
  switch (action) {
    case 'tap':
      return `tap (${n(args.x)},${n(args.y)})`
    case 'swipe':
      return `swipe (${n(args.x)},${n(args.y)}) → (${n(args.x2)},${n(args.y2)})`
    case 'key':
      return `press key ${typeof args.key === 'string' ? args.key : '?'}`
    case 'text':
      return `type ${typeof args.text === 'string' ? `"${args.text.slice(0, 40)}"` : 'text'}`
    case 'launch':
    case 'stop':
      return `${action} ${typeof args.package === 'string' ? args.package : 'the game'}`
    case 'install':
      return `install ${typeof args.apk === 'string' ? args.apk : 'APK'}`
    case 'ui_dump':
      return 'read the screen'
    case 'screenshot':
      return 'take a screenshot'
    case 'logcat':
      return 'read the device log'
    case 'packages':
      return 'list installed packages'
    default:
      return 'connect to BlueStacks'
  }
}

export const ANDROID_TOOLS: AgentTool[] = [androidPlay]
