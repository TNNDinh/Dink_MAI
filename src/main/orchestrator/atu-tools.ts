import { createReadStream, existsSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { MAX_TIMEOUT_MS } from '../workspace/commands'
import { isSecretPath } from '../workspace/sandbox'
import type { AgentTool, ToolContext } from './tools'

/**
 * Dink_ATU (https://github.com/TNNDinh/Dink_ATU): turns a game's APK/XAPK (or a PC game folder) into a Unity project
 * and decompiled sources. The app drives its `apk2unity.ps1` script; the tool itself is installed separately.
 */
const ATU_TIMEOUT_MS = 15 * 60_000
const OUTPUT_CHARS = 12_000
const ACTIONS = ['analyze', 'convert'] as const
type AtuAction = (typeof ACTIONS)[number]
const SAFE_NAME = /^[A-Za-z0-9_-]{1,60}$/
const OUT_DIR = 'atu_output'

/** Where Dink_ATU lives: DINK_ATU_DIR, or the usual clone folder. */
export function findAtuDir(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | null {
  // An explicit DINK_ATU_DIR is the only place looked at; without it the usual clone folders are tried.
  const dirs = env.DINK_ATU_DIR ? [env.DINK_ATU_DIR] : ['D:\\Projects\\Dink_ATU', 'D:\\apk2unity']
  return dirs.find((d) => exists(join(d, 'apk2unity.ps1'))) ?? null
}

export interface AtuRequest {
  atuDir: string
  input: string
  outRoot: string
  action: AtuAction
  name?: string
  decompileLogic?: boolean
  skipAssetRipper?: boolean
}

const quote = (s: string): string => {
  if (/["\r\n%^&|<>`$]/.test(s)) throw new Error(`Unsafe characters in "${s}".`)
  return `"${s}"`
}

/** The shell command for one Dink_ATU run; every value is validated or quoted so nothing can add another command. */
export function buildAtuCommand(r: AtuRequest): string {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', quote(join(r.atuDir, 'apk2unity.ps1')), '-Apk', quote(r.input), '-OutRoot', quote(r.outRoot)]
  if (r.name) {
    if (!SAFE_NAME.test(r.name)) throw new Error('name may only contain letters, digits, "_" and "-" (max 60).')
    args.push('-Name', r.name)
  }
  if (r.action === 'analyze') args.push('-Analyze')
  else {
    if (r.decompileLogic) args.push('-DecompileLogic')
    if (r.skipAssetRipper) args.push('-SkipAssetRipper')
  }
  return `powershell.exe ${args.join(' ')}`
}

const apkToUnity: AgentTool = {
  def: {
    name: 'apk_to_unity',
    description:
      'Use the Dink_ATU tool to study a game package: "analyze" only detects the engine, Unity version and Mono/IL2CPP backend (fast, writes a report); "convert" also rebuilds a Unity project and decompiled code (slow, many minutes; IL2CPP games give class outlines, and pseudo-C logic with decompile_logic). Input is an .apk/.xapk file or a PC game folder inside the project. Results go to atu_output/<name>/ (REPORT.md, UnityProject/, decompiled/ or il2cpp/). If the result only has class outlines (IL2CPP without logic) and the behaviour has to be guessed, install the APK on BlueStacks and observe the real game with android_play, then write the documentation from what you saw. ONLY use it on games the user owns, open-source games, or apps the user has the right to analyse. The command goes through the normal approval policy.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        input: { type: 'string', description: 'Path of the .apk/.xapk (or game folder), relative to the project root, e.g. "input/game.apk".' },
        name: { type: 'string', description: 'Output folder name under atu_output/. It must not exist yet.' },
        decompile_logic: { type: 'boolean', description: 'IL2CPP only: also decompile function bodies with Ghidra (about 10+ minutes).' },
        skip_asset_ripper: { type: 'boolean', description: 'Skip rebuilding the Unity project (code only).' },
        timeout_seconds: { type: 'integer', description: `Default ${ATU_TIMEOUT_MS / 1000}, max ${MAX_TIMEOUT_MS / 1000}.` }
      },
      required: ['action', 'input']
    }
  },
  allowed: (a) => a.permissions.runCommands !== 'none' && a.permissions.readFiles,
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace || !ctx.commands) throw new Error('Running commands is not available.')
    const action = args.action as AtuAction
    if (!ACTIONS.includes(action)) throw new Error(`action must be one of: ${ACTIONS.join(', ')}.`)
    if (typeof args.input !== 'string' || !args.input.trim()) throw new Error('input is required.')
    const atuDir = findAtuDir()
    if (!atuDir) throw new Error('Dink_ATU is not installed. Clone https://github.com/TNNDinh/Dink_ATU, run setup.ps1 -WithGhidra once, and set DINK_ATU_DIR to its folder.')
    if (!existsSync(join(atuDir, 'tools'))) throw new Error(`Dink_ATU has no tools yet. Run "${join(atuDir, 'setup.ps1')} -WithGhidra" once (downloads about 600 MB).`)
    const sandbox = ctx.workspace.sandbox(ctx.projectId)
    const input = sandbox.resolve(args.input.trim())
    if (!existsSync(input.full)) throw new Error(`${input.rel} does not exist in the project.`)
    const command = buildAtuCommand({
      atuDir,
      input: input.full,
      outRoot: sandbox.resolve(OUT_DIR).full,
      action,
      name: typeof args.name === 'string' && args.name ? args.name : undefined,
      decompileLogic: args.decompile_logic === true,
      skipAssetRipper: args.skip_asset_ripper === true
    })
    const project = ctx.workspace.project(ctx.projectId)
    const task = ctx.db.get<{ title: string }>(`SELECT title FROM tasks WHERE id = ?`, ctx.taskId)
    const timeoutMs = (typeof args.timeout_seconds === 'number' ? Math.min(Math.max(Math.trunc(args.timeout_seconds), 1), MAX_TIMEOUT_MS / 1000) : ATU_TIMEOUT_MS / 1000) * 1000
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
    const head = r.outcome === 'exited' ? `Dink_ATU exit code ${r.exitCode} after ${Math.round(r.durationMs / 1000)}s.` : r.outcome === 'timeout' ? `Dink_ATU timed out after ${timeoutMs / 1000}s and was killed (a partial result may be in ${OUT_DIR}/).` : `${r.outcome}${r.message ? `: ${r.message}` : ''}`
    return `${head}\n${out || '(no output)'}`
  }
}

const MAX_BIG_BYTES = 400 * 1024 * 1024
const MAX_HITS = 80
const LINE_CLIP = 300

/** Searches one big text file line by line without loading it (search_files skips files over about 1 MB). */
export async function searchLargeFile(full: string, query: string, regex: boolean, maxResults: number): Promise<{ hits: string[]; lines: number; truncated: boolean }> {
  const re = regex ? new RegExp(query, 'i') : null
  const needle = query.toLowerCase()
  const hits: string[] = []
  let n = 0
  let truncated = false
  const rl = createInterface({ input: createReadStream(full, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    n++
    if (re ? re.test(line) : line.toLowerCase().includes(needle)) {
      if (hits.length >= maxResults) {
        truncated = true
        rl.close()
        break
      }
      hits.push(`${n}: ${line.length > LINE_CLIP ? `${line.slice(0, LINE_CLIP)}…` : line}`)
    }
  }
  return { hits, lines: n, truncated }
}

const searchBig: AgentTool = {
  def: {
    name: 'search_large_file',
    description: `Search ONE large text file of the project (for example atu_output/<name>/il2cpp/dump.cs, tens of MB) line by line. Use it where search_files finds nothing because it skips big files. Returns up to ${MAX_HITS} lines as "line: text"; with regex=true the query is a case-insensitive regular expression, otherwise a case-insensitive substring. Use a precise query (class declarations such as "class .*Manager") and ask again with a different query rather than for everything.`,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File, relative to the project root.' }, query: { type: 'string' }, regex: { type: 'boolean' }, max_results: { type: 'integer', description: `Default 40, max ${MAX_HITS}.` } },
      required: ['path', 'query']
    }
  },
  allowed: (a) => a.permissions.readFiles,
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace) throw new Error('The project workspace is not available.')
    if (typeof args.path !== 'string' || typeof args.query !== 'string' || !args.query.trim()) throw new Error('path and query are required.')
    const rel = ctx.workspace.sandbox(ctx.projectId).resolve(args.path.trim())
    if (isSecretPath(rel.rel)) throw new Error('That file cannot be read (credential file).')
    if (!existsSync(rel.full) || !statSync(rel.full).isFile()) throw new Error(`${rel.rel} is not a file of the project.`)
    if (statSync(rel.full).size > MAX_BIG_BYTES) throw new Error(`${rel.rel} is larger than ${MAX_BIG_BYTES / 1024 / 1024} MB.`)
    if (args.regex === true) {
      try {
        new RegExp(args.query)
      } catch (e) {
        throw new Error(`Invalid regular expression: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const max = typeof args.max_results === 'number' ? Math.min(Math.max(Math.trunc(args.max_results), 1), MAX_HITS) : 40
    const r = await searchLargeFile(rel.full, args.query, args.regex === true, max)
    if (!r.hits.length) return `No matches in ${r.lines} lines of ${rel.rel}.`
    return `${r.hits.join('\n')}${r.truncated ? '\n[more matches exist: use a more precise query]' : ''}`
  }
}

export const ATU_TOOLS: AgentTool[] = [apkToUnity, searchBig]
