import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AgentTool, ToolContext } from './tools'

/** The Unity MCP bridge (AnkleBreaker unity-mcp-plugin): a Unity package that serves a small JSON API from inside the open editor. */
export const BRIDGE_PACKAGE = 'com.anklebreaker.unity-mcp'
export const BRIDGE_PACKAGE_URL = 'https://github.com/AnkleBreaker-Studio/unity-mcp-plugin.git'
const PORTS = Array.from({ length: 10 }, (_, i) => 7890 + i)
const ACTIONS = ['status', 'install', 'compile_errors', 'menu_item', 'execute_code'] as const
type Action = (typeof ACTIONS)[number]
const OUTPUT_CHARS = 15_000

type Fetch = (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>
let fetcher: Fetch = (url, init) => fetch(url, init)
export function setBridgeFetchForTests(f: Fetch | undefined): void {
  fetcher = f ?? ((url, init) => fetch(url, init))
}

const norm = (p: string): string => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

async function post(port: number, path: string, body: unknown, ms: number): Promise<any> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetcher(`http://127.0.0.1:${port}/api/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}), signal: ctl.signal })
    const t = await r.text()
    if (!r.ok) throw new Error(`Bridge answered ${r.status}: ${t.slice(0, 300)}`)
    try {
      return JSON.parse(t)
    } catch {
      return t
    }
  } finally {
    clearTimeout(timer)
  }
}

/** The port of the open editor that has this project loaded, or null. A second editor (e.g. a Multiplayer Play Mode clone) is skipped by its project path. */
export async function findBridgePort(projectRoot: string): Promise<number | null> {
  const want = norm(projectRoot)
  for (const port of PORTS) {
    try {
      const r = await post(port, 'ping', {}, 1500)
      if (typeof r?.projectPath === 'string' && norm(r.projectPath) === want) return port
    } catch {
      /* nothing listening here */
    }
  }
  return null
}

/** The copy of the plugin that ships with the app (extraResources when packaged, ./resources in development). */
export function bundledPluginDir(): string {
  const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [process.env.DINH_MAI_UNITY_PLUGIN, res && join(res, 'unity-mcp-plugin'), join(process.cwd(), 'resources', 'unity-mcp-plugin')].filter((c): c is string => Boolean(c))
  return candidates.find((c) => existsSync(join(c, 'package.json'))) ?? candidates[candidates.length - 1]
}

export type BridgeSetup = 'not_unity' | 'present' | 'installed' | 'installed_from_git'

/**
 * Makes sure a Unity project has the MCP bridge: if the manifest or Packages/ already holds it nothing changes;
 * otherwise the bundled copy is placed in Packages/ (works offline), or the git URL is added to the manifest when the app has no bundled copy.
 */
export function ensureBridgePackage(projectRoot: string, source: string = bundledPluginDir()): BridgeSetup {
  const versionFile = join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt')
  if (!existsSync(versionFile)) return 'not_unity'
  const manifest = join(projectRoot, 'Packages', 'manifest.json')
  // The plugin uses the Test Runner and uGUI but does not declare them, so a project without them fails to compile.
  const depsAdded = addRequiredPackages(projectRoot, /m_EditorVersion:\s*(\d+)/.exec(readFileSync(versionFile, 'utf8'))?.[1])
  if (existsSync(manifest) && readFileSync(manifest, 'utf8').includes(BRIDGE_PACKAGE)) return depsAdded ? 'installed' : 'present'
  const target = join(projectRoot, 'Packages', BRIDGE_PACKAGE)
  if (existsSync(target)) return depsAdded ? 'installed' : 'present'
  if (existsSync(join(source, 'package.json'))) {
    cpSync(source, target, { recursive: true })
    return 'installed'
  }
  addBridgePackage(projectRoot)
  return 'installed_from_git'
}

/** Unity packages the bridge needs; versions that fit the editor generation. Returns true when the manifest changed. */
export function addRequiredPackages(projectRoot: string, editorMajor: string | undefined): boolean {
  const file = join(projectRoot, 'Packages', 'manifest.json')
  if (!existsSync(file)) return false
  const json = JSON.parse(readFileSync(file, 'utf8'))
  json.dependencies = json.dependencies ?? {}
  const modern = Number(editorMajor ?? 0) >= 6000
  const wanted: Record<string, string> = { 'com.unity.test-framework': modern ? '1.6.0' : '1.1.33', 'com.unity.ugui': modern ? '2.0.0' : '1.0.0' }
  let changed = false
  for (const [name, version] of Object.entries(wanted)) {
    if (!json.dependencies[name]) {
      json.dependencies[name] = version
      changed = true
    }
  }
  if (changed) writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  return changed
}

/** Adds the bridge package to Packages/manifest.json. Returns false when it is already there. */
export function addBridgePackage(projectRoot: string): boolean {
  const file = join(projectRoot, 'Packages', 'manifest.json')
  if (!existsSync(file)) throw new Error('Packages/manifest.json not found: this is not a Unity project.')
  const json = JSON.parse(readFileSync(file, 'utf8'))
  json.dependencies = json.dependencies ?? {}
  if (json.dependencies[BRIDGE_PACKAGE]) return false
  json.dependencies[BRIDGE_PACKAGE] = BRIDGE_PACKAGE_URL
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  return true
}

const clip = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1)
  return s.length > OUTPUT_CHARS ? `${s.slice(0, OUTPUT_CHARS)}\n[… clipped …]` : s
}

export const INSTALLED_NOTE: Record<BridgeSetup, string> = {
  not_unity: 'Not a Unity project.',
  present: 'The Unity MCP bridge is already in the project.',
  installed: `Installed the Unity MCP bridge (${BRIDGE_PACKAGE}, "Powered by AnkleBreaker MCP") into Packages/. It becomes active when the Unity editor next opens or refreshes the project.`,
  installed_from_git: `Added ${BRIDGE_PACKAGE} to Packages/manifest.json (git). It becomes active when the Unity editor next opens or refreshes the project.`
}

const unityBridge: AgentTool = {
  def: {
    name: 'unity_bridge',
    description:
      'Talk to the Unity editor that is OPEN on this project through its MCP bridge (fast, no restart): read compile errors, run a menu item, or run C# code inside the editor. Use action "status" first. If the editor is not open, use unity_run (batch mode) instead. If the project has no bridge package, action "install" adds it to Packages/manifest.json (Unity downloads it the next time the editor opens the project). Never run code that opens a modal dialog: it freezes the bridge.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        menu_path: { type: 'string', description: 'For menu_item, e.g. "Tools/Build/Build Windows".' },
        code: { type: 'string', description: 'For execute_code: C# statements to run in the editor (C# 7, no newlines inside string literals).' }
      },
      required: ['action']
    }
  },
  allowed: (a) => a.permissions.runCommands !== 'none' && a.permissions.writeFiles,
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace) throw new Error('The project workspace is not available.')
    const action = args.action as Action
    if (!ACTIONS.includes(action)) throw new Error(`action must be one of: ${ACTIONS.join(', ')}.`)
    const root = ctx.workspace.sandbox(ctx.projectId).root
    if (!existsSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'))) throw new Error('This project folder is not a Unity project.')
    if (action === 'install') {
      const r = ensureBridgePackage(root)
      return r === 'present' ? `${BRIDGE_PACKAGE} is already in the project.` : INSTALLED_NOTE[r]
    }
    const port = await findBridgePort(root)
    if (port === null) {
      const has = existsSync(join(root, 'Packages', 'manifest.json')) && readFileSync(join(root, 'Packages', 'manifest.json'), 'utf8').includes(BRIDGE_PACKAGE)
      return `No open Unity editor with this project answered on ports ${PORTS[0]}-${PORTS[PORTS.length - 1]}. ${has ? 'The bridge package is installed, so the editor is simply not open.' : 'The bridge package is not installed (action "install" adds it).'} Use unity_run for batch mode work.`
    }
    if (action === 'status') return `Unity editor connected on port ${port}.\n${clip(await post(port, 'ping', {}, 5000))}`
    if (action === 'compile_errors') return clip(await post(port, 'compilation/errors', {}, 30_000))
    if (action === 'menu_item') {
      if (typeof args.menu_path !== 'string' || !args.menu_path.trim()) throw new Error('menu_path is required.')
      return clip(await post(port, 'editor/execute-menu-item', { menuPath: args.menu_path }, 60_000))
    }
    if (typeof args.code !== 'string' || !args.code.trim()) throw new Error('code is required.')
    return clip(await post(port, 'editor/execute-code', { code: args.code }, 120_000))
  }
}

export const UNITY_BRIDGE_TOOLS: AgentTool[] = [unityBridge]
