import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { MAX_TIMEOUT_MS } from '../workspace/commands'
import { buildUnityCommand, findUnityEditor, isProjectLocked, readEditorVersion } from './unity-tools'
import type { AgentTool, ToolContext } from './tools'

/**
 * Release gate for games rebuilt from someone's APK (see apk_to_unity).
 *  - Everything Dink_ATU extracted lands in atu_output/<name>/ (UnityProject/ExportedProject/Assets, extracted/assets).
 *  - A file in the game's own Assets/ whose content is byte-identical to one of those extracted files is "unresolved":
 *    it still is the original asset. It is resolved by replacing it with original or licensed work (different content) or removing it.
 *  - APK builds are test builds: they are allowed while assets are unresolved, but always report in red.
 *  - AAB builds (the store format) are refused until nothing is unresolved.
 */
const ASSET_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tga', '.psd', '.bmp', '.gif', '.exr', '.wav', '.mp3', '.ogg', '.aif', '.aiff', '.fbx', '.obj', '.dae', '.blend', '.mp4', '.mov', '.ttf', '.otf', '.anim', '.skel', '.atlas', '.bytes'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'Library', 'Temp', 'Logs', 'obj'])
const MAX_FILES = 40_000
const MAX_LISTED = 40
const BUILD_TIMEOUT_MS = 20 * 60_000
export const BUILD_CLASS = 'DinhMai.BuildTools'
export const BUILD_SCRIPT_PATH = 'Assets/Editor/DinhMaiBuild.cs'

/** Editor script the build tool puts into the project: builds Android to a path, as APK or AAB. */
export const BUILD_SCRIPT = `// Written by Dinh_MAI. Used for batch-mode Android builds: -executeMethod DinhMai.BuildTools.BuildAndroid -dmOut <path> -dmAab <true|false>
using System;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace DinhMai
{
    public static class BuildTools
    {
        static string Arg(string name)
        {
            var a = Environment.GetCommandLineArgs();
            for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
            return null;
        }

        public static void BuildAndroid()
        {
            string output = Arg("-dmOut");
            bool aab = Arg("-dmAab") == "true";
            var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
            if (scenes.Length == 0) { Debug.LogError("DinhMai build: no enabled scenes in Build Settings."); EditorApplication.Exit(2); return; }
            EditorUserBuildSettings.buildAppBundle = aab;
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = scenes, locationPathName = output, target = BuildTarget.Android, options = BuildOptions.None });
            Debug.Log("DinhMai build result: " + report.summary.result + ", " + report.summary.totalErrors + " errors, " + report.summary.totalSize + " bytes");
            EditorApplication.Exit(report.summary.result == BuildResult.Succeeded ? 0 : 1);
        }
    }
}
`;

export interface UnresolvedAsset {
  /** Path in the game's Assets/ that still is the original asset. */
  path: string
  /** The extracted file it equals. */
  source: string
}

function walk(dir: string, visit: (full: string, size: number) => void, budget: { left: number }): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (budget.left <= 0) return
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), visit, budget)
    } else if (e.isFile() && ASSET_EXTS.has(extname(e.name).toLowerCase())) {
      budget.left--
      try {
        visit(join(dir, e.name), statSync(join(dir, e.name)).size)
      } catch {
        /* vanished */
      }
    }
  }
}

const sha1 = (file: string): string => createHash('sha1').update(readFileSync(file)).digest('hex')

/** Original assets still present in the game's Assets/ folder. Empty when nothing was extracted. */
export function findUnresolvedAssets(projectRoot: string): { unresolved: UnresolvedAsset[]; extractedCount: number; truncated: boolean } {
  const out = join(projectRoot, 'atu_output')
  const budget = { left: MAX_FILES }
  const bySize = new Map<number, string[]>()
  let extractedCount = 0
  if (existsSync(out)) {
    for (const run of readdirSync(out, { withFileTypes: true })) {
      if (!run.isDirectory()) continue
      for (const sub of [join(out, run.name, 'UnityProject', 'ExportedProject', 'Assets'), join(out, run.name, 'UnityProject', 'Assets'), join(out, run.name, 'extracted', 'assets')]) {
        walk(sub, (f, size) => {
          extractedCount++
          const list = bySize.get(size) ?? []
          list.push(f)
          bySize.set(size, list)
        }, budget)
      }
    }
  }
  const unresolved: UnresolvedAsset[] = []
  if (extractedCount > 0) {
    const hashes = new Map<string, string>()
    walk(join(projectRoot, 'Assets'), (f, size) => {
      const same = bySize.get(size)
      if (!same) return
      const h = sha1(f)
      for (const s of same) {
        if (!hashes.has(s)) hashes.set(s, sha1(s))
        if (hashes.get(s) === h) {
          unresolved.push({ path: relative(projectRoot, f).replace(/\\/g, '/'), source: relative(projectRoot, s).replace(/\\/g, '/') })
          return
        }
      }
    }, budget)
  }
  return { unresolved, extractedCount, truncated: budget.left <= 0 }
}

export type BuildTarget = 'apk' | 'aab'

export interface GateResult {
  allowed: boolean
  /** Always shown with the result of the build or the refusal. */
  banner: string
  unresolved: UnresolvedAsset[]
}

const listUnresolved = (u: UnresolvedAsset[]): string => u.slice(0, MAX_LISTED).map((a) => `- ${a.path}  (same as ${a.source})`).join('\n') + (u.length > MAX_LISTED ? `\n… and ${u.length - MAX_LISTED} more` : '')

export function checkBuildGate(target: BuildTarget, projectRoot: string): GateResult {
  const { unresolved, truncated } = findUnresolvedAssets(projectRoot)
  const scanNote = truncated ? '\n(The scan hit its file limit; the real number may be higher.)' : ''
  if (target === 'aab') {
    if (unresolved.length > 0) {
      return {
        allowed: false,
        unresolved,
        banner: `🔴 AAB BUILD REFUSED: ${unresolved.length} asset(s) in Assets/ are still the original files taken from the APK. Replace each with original or licensed work (the file content must change) or remove it, then ask for the AAB again.\n${listUnresolved(unresolved)}${scanNote}`
      }
    }
    return { allowed: true, unresolved, banner: `All extracted assets are resolved; the AAB build may go ahead.${scanNote}` }
  }
  return {
    allowed: true,
    unresolved,
    banner: `🔴 TEST BUILD ONLY — NOT FOR RELEASE. ${unresolved.length ? `${unresolved.length} asset(s) are still the original files from the APK; the AAB build stays blocked until they are replaced or removed:\n${listUnresolved(unresolved)}` : 'This APK is for testing; the store build (AAB) is a separate step.'}${scanNote}`
  }
}

const androidBuild: AgentTool = {
  def: {
    name: 'android_build',
    description:
      'Build the game for Android with the Unity editor in batch mode. target "apk" makes a TEST build: it is always reported in red as not for release, and lists the assets that are still the original files taken from the analysed APK. target "aab" (the store format) is REFUSED until no asset in Assets/ is byte-identical to an asset extracted by apk_to_unity (atu_output/): replace those files with original or licensed work, or delete them. Needs Unity (see unity_run) and a project that is not open in the editor.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['apk', 'aab'] },
        timeout_seconds: { type: 'integer', description: `Default ${BUILD_TIMEOUT_MS / 1000}, max ${MAX_TIMEOUT_MS / 1000}.` }
      },
      required: ['target']
    }
  },
  allowed: (a) => a.permissions.runCommands !== 'none' && a.permissions.writeFiles,
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace || !ctx.commands) throw new Error('Running commands is not available.')
    const target = args.target as BuildTarget
    if (target !== 'apk' && target !== 'aab') throw new Error('target must be "apk" or "aab".')
    const sandbox = ctx.workspace.sandbox(ctx.projectId)
    const root = sandbox.root
    const version = readEditorVersion(root)
    if (!version) throw new Error('This project folder is not a Unity project.')
    const gate = checkBuildGate(target, root)
    const event = (level: 'warn' | 'error', message: string): unknown => ctx.events.record({ projectId: ctx.projectId, runId: ctx.runId, agentId: ctx.agent.id, level, type: 'build.gate', message })
    if (!gate.allowed) {
      event('error', `AAB build refused: ${gate.unresolved.length} unresolved original asset(s).`)
      throw new Error(gate.banner)
    }
    if (isProjectLocked(root)) throw new Error('The project looks open in a Unity editor (Temp/UnityLockfile). Close it, or ask the user to, then try again.')
    const editor = findUnityEditor(version)
    if (!editor) throw new Error(`Unity ${version} was not found. Set UNITY_EDITOR_PATH to Unity.exe, or UNITY_EDITORS_DIR to the folder holding the version folders.`)
    const scriptFull = join(root, ...BUILD_SCRIPT_PATH.split('/'))
    if (!existsSync(scriptFull)) {
      mkdirSync(join(root, 'Assets', 'Editor'), { recursive: true })
      writeFileSync(scriptFull, BUILD_SCRIPT, 'utf8')
    }
    const outDir = join(root, 'Builds')
    mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, target === 'aab' ? 'game.aab' : 'game-TEST.apk')
    const command = buildUnityCommand({ editor, projectRoot: root, mode: 'execute_method', method: `${BUILD_CLASS}.BuildAndroid`, buildTarget: 'Android', extra: ['-dmOut', outFile, '-dmAab', target === 'aab' ? 'true' : 'false'] })
    const project = ctx.workspace.project(ctx.projectId)
    const task = ctx.db.get<{ title: string }>(`SELECT title FROM tasks WHERE id = ?`, ctx.taskId)
    const timeoutMs = (typeof args.timeout_seconds === 'number' ? Math.min(Math.max(Math.trunc(args.timeout_seconds), 1), MAX_TIMEOUT_MS / 1000) : BUILD_TIMEOUT_MS / 1000) * 1000
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
    const built = r.outcome === 'exited' && r.exitCode === 0 && existsSync(outFile)
    if (target === 'apk') {
      event('error', `Test APK ${built ? 'built' : 'failed'}: not for release${gate.unresolved.length ? `, ${gate.unresolved.length} unresolved original asset(s)` : ''}.`)
      if (built) writeFileSync(join(outDir, 'TEST_BUILD_WARNING.txt'), `${gate.banner}\n`, 'utf8')
    }
    const errors = [...new Set(r.output.split('\n').filter((l) => /error CS\d+|DinhMai build/.test(l)).map((l) => l.trim()))].slice(0, 30)
    const tail = r.output.length > 6000 ? r.output.slice(-6000) : r.output
    const head = built ? `Built Builds/${target === 'aab' ? 'game.aab' : 'game-TEST.apk'} in ${Math.round(r.durationMs / 1000)}s.` : r.outcome === 'timeout' ? `Build timed out after ${timeoutMs / 1000}s.` : `Build failed (${r.outcome}${r.exitCode !== null && r.exitCode !== undefined ? `, exit code ${r.exitCode}` : ''}).`
    return `${gate.banner}\n\n${head}${errors.length ? `\n${errors.join('\n')}` : ''}\n${tail || '(no output)'}`
  }
}

export const BUILD_TOOLS: AgentTool[] = [androidBuild]
