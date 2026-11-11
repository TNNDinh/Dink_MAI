import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ApkBundleInfo, ApkConvertInput, ApkConvertResult, ApkInstallInput, ApkInstallResult, ApkProgress, ApkToolsStatus } from '../../shared/ipc'
import { findAdb, findTar } from '../orchestrator/android-tools'
import { lowerMinSdk, readMinSdk } from './axml'
import { readZipEntry, replaceZipEntry } from './zip-replace'

/**
 * Turns an APKPure .xapk (or .apkm / .apks / .zip bundle, or a folder of split apks) into ONE installable .apk:
 *   1. unpack the bundle,  2. merge base + config splits (APKEditor),  3. optionally lower minSdkVersion so an older Android
 *   accepts it,  4. zipalign and sign with the debug key (uber-apk-signer; Android refuses unsigned or unaligned apks).
 * Everything runs through execFile with an argument list (no shell). The two jars are downloaded once, checked against a pinned
 * SHA-256 and kept in the app's data folder. Java comes from Dink_ATU's JDK, JAVA_HOME or the PATH.
 */
const ARCHIVE_EXT = new Set(['.xapk', '.apkm', '.apks', '.zip'])
const TOOL_TIMEOUT_MS = 15 * 60_000
const MAX_SDK = 60

export interface ToolSpec {
  file: string
  url: string
  sha256: string
  /** Shown to the user before the first download. */
  megabytes: number
}

export const APK_EDITOR: ToolSpec = {
  file: 'APKEditor-1.4.9.jar',
  url: 'https://github.com/REAndroid/APKEditor/releases/download/V1.4.9/APKEditor-1.4.9.jar',
  sha256: 'a9cd40df818845456be6d696de6110c89edf4b0a0580cb83438ed6b25a366e67',
  megabytes: 7.4
}

export const APK_SIGNER: ToolSpec = {
  file: 'uber-apk-signer-1.3.0.jar',
  url: 'https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar',
  sha256: 'e1299fd6fcf4da527dd53735b56127e8ea922a321128123b9c32d619bba1d835',
  megabytes: 3.1
}

export interface RunResult {
  stdout: string
  stderr: string
}
export type Runner = (file: string, args: string[], opts: { signal?: AbortSignal; timeoutMs?: number }) => Promise<RunResult>
export type Downloader = (url: string, dest: string, signal?: AbortSignal) => Promise<void>

const defaultRun: Runner = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeoutMs ?? TOOL_TIMEOUT_MS, signal: opts.signal, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }))
      resolve({ stdout, stderr })
    })
  })

const defaultDownload: Downloader = async (url, dest, signal) => {
  const res = await fetch(url, { redirect: 'follow', signal })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
}

const BLUESTACKS_ADB_PORTS = [5555, 5556, 5557, 5558, 5565, 5575]

/** adb prints a bare `Failure [CODE: text]`; say what it means and what to do. */
export function explainInstallFailure(output: string, pkg: string | null): string {
  const code = output.match(/INSTALL_[A-Z_]+/)?.[0] ?? null
  const hint: Record<string, string> = {
    INSTALL_FAILED_OLDER_SDK: 'The game needs a newer Android than this emulator has. Convert again with “Lower the minimum Android version” ticked.',
    INSTALL_FAILED_UPDATE_INCOMPATIBLE: `A copy signed with a different key is already installed${pkg ? ` (${pkg})` : ''}. Uninstall it from the emulator first; its saved data is lost.`,
    INSTALL_FAILED_VERSION_DOWNGRADE: 'A newer version of this game is already installed. Uninstall it from the emulator first.',
    INSTALL_FAILED_INSUFFICIENT_STORAGE: 'The emulator is out of storage space.',
    INSTALL_FAILED_NO_MATCHING_ABIS: 'The game has no code for this emulator’s CPU type (for example arm only on an x86 emulator).',
    INSTALL_PARSE_FAILED_NO_CERTIFICATES: 'The apk is not signed, so Android refused it.'
  }
  if (code && hint[code]) return `${hint[code]} (${code})`
  const line = output.split(/\r?\n/).map((l) => l.trim()).find((l) => /Failure|error/i.test(l))
  return `adb could not install the apk${code ? ` (${code})` : ''}${line ? `: ${line}` : '.'}`
}

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

/** The last few lines a failed tool printed, enough to tell the user why. */
function tail(e: unknown): string {
  const x = e as { stdout?: string; stderr?: string; message?: string }
  const text = `${x.stdout ?? ''}\n${x.stderr ?? ''}`.trim() || x.message || String(e)
  return text.split(/\r?\n/).filter(Boolean).slice(-12).join('\n')
}

/** Every .apk under a folder, base first. */
function findApks(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findApks(p))
    else if (extname(e.name).toLowerCase() === '.apk') out.push(p)
  }
  const split = (f: string): boolean => /(^|[._-])config[._]|Pack\.apk$|^split[._-]/i.test(basename(f))
  return out.sort((a, b) => Number(split(a)) - Number(split(b)) || a.localeCompare(b))
}

function findFiles(dir: string, ext: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findFiles(p, ext))
    else if (extname(e.name).toLowerCase() === ext) out.push(p)
  }
  return out
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export interface ApkConverterDeps {
  /** Where the downloaded jars are kept. */
  toolsDir: string
  /** Dink_ATU's folder when it is installed (its JDK is reused); null otherwise. */
  atuDir: () => string | null
  emit: (p: ApkProgress) => void
  run?: Runner
  download?: Downloader
  env?: NodeJS.ProcessEnv
  tar?: string
  adb?: string
  /** Replaces the pinned jars; for tests. */
  tools?: { editor: ToolSpec; signer: ToolSpec }
}

export class ApkConverter {
  private readonly run: Runner
  private readonly download: Downloader
  private readonly env: NodeJS.ProcessEnv
  private readonly tar: string
  private readonly editorSpec: ToolSpec
  private readonly signerSpec: ToolSpec
  private abort: AbortController | null = null
  private installing = false

  constructor(private readonly deps: ApkConverterDeps) {
    this.run = deps.run ?? defaultRun
    this.download = deps.download ?? defaultDownload
    this.env = deps.env ?? process.env
    this.tar = deps.tar ?? findTar(this.env)
    this.editorSpec = deps.tools?.editor ?? APK_EDITOR
    this.signerSpec = deps.tools?.signer ?? APK_SIGNER
  }

  private say(step: ApkProgress['step'], message: string): void {
    this.deps.emit({ step, message })
  }

  /** java.exe from Dink_ATU's JDK, JAVA_HOME or the PATH; null when none of them runs. */
  async findJava(): Promise<{ path: string; source: ApkToolsStatus['javaSource'] } | null> {
    const atu = this.deps.atuDir()
    if (atu) {
      const jdks = join(atu, 'tools', 'jdk')
      try {
        for (const d of readdirSync(jdks, { withFileTypes: true })) {
          const exe = join(jdks, d.name, 'bin', 'java.exe')
          if (d.isDirectory() && existsSync(exe)) return { path: exe, source: 'dink_atu' }
        }
      } catch {
        /* no JDK folder: try the next place */
      }
    }
    if (this.env.JAVA_HOME) {
      const exe = join(this.env.JAVA_HOME, 'bin', 'java.exe')
      if (existsSync(exe)) return { path: exe, source: 'java_home' }
    }
    try {
      await this.run('java', ['-version'], { timeoutMs: 15_000 })
      return { path: 'java', source: 'path' }
    } catch {
      return null
    }
  }

  async status(): Promise<ApkToolsStatus> {
    const java = await this.findJava()
    const have = (t: ToolSpec): boolean => existsSync(join(this.deps.toolsDir, t.file))
    return { java: java?.path ?? null, javaSource: java?.source ?? null, apkEditor: have(this.editorSpec), signer: have(this.signerSpec), downloadMegabytes: [this.editorSpec, this.signerSpec].filter((t) => !have(t)).reduce((s, t) => s + t.megabytes, 0) }
  }

  /** Downloads a jar the first time it is needed; a file that fails the pinned checksum is deleted and refused. */
  private async ensureTool(t: ToolSpec, signal?: AbortSignal): Promise<string> {
    const path = join(this.deps.toolsDir, t.file)
    if (existsSync(path) && sha256(path) === t.sha256) return path
    mkdirSync(this.deps.toolsDir, { recursive: true })
    this.say('tools', `Downloading ${t.file} (${t.megabytes} MB), only needed once…`)
    const part = `${path}.${randomUUID().slice(0, 8)}.part`
    try {
      await this.download(t.url, part, signal)
      if (sha256(part) !== t.sha256) throw new Error(`${t.file} does not match the expected checksum, so it was not used. Download it again later or check your connection.`)
      renameSync(part, path)
    } finally {
      rmSync(part, { force: true })
    }
    return path
  }

  private validate(path: unknown): { full: string; isDir: boolean } {
    if (typeof path !== 'string' || !path.trim()) throw new Error('Choose a file first.')
    const full = path.trim()
    if (!existsSync(full)) throw new Error(`${full} does not exist.`)
    const st = statSync(full)
    const ext = extname(full).toLowerCase()
    if (!st.isDirectory() && ext !== '.apk' && !ARCHIVE_EXT.has(ext)) throw new Error(`Expected a .xapk, .apkm, .apks or .apk file (or a folder of split apks), not "${basename(full)}".`)
    return { full, isDir: st.isDirectory() }
  }

  /** What is inside a bundle, read from its file list and manifest.json without unpacking it. */
  async inspect(path: string): Promise<ApkBundleInfo> {
    const { full, isDir } = this.validate(path)
    const base: ApkBundleInfo = { path: full, fileName: basename(full), kind: isDir ? 'folder' : extname(full).toLowerCase() === '.apk' ? 'apk' : 'bundle', sizeBytes: isDir ? 0 : statSync(full).size, name: null, packageName: null, versionName: null, minSdk: null, targetSdk: null, parts: [], obbFiles: [] }
    if (isDir) {
      const apks = findApks(full)
      return { ...base, parts: apks.map((a) => basename(a)), obbFiles: findFiles(full, '.obb').map((o) => basename(o)) }
    }
    if (base.kind === 'apk') {
      try {
        const m = await readZipEntry(full, 'AndroidManifest.xml')
        return { ...base, parts: [basename(full)], minSdk: m ? readMinSdk(m) : null }
      } catch {
        return { ...base, parts: [basename(full)] }
      }
    }
    const listing = await this.run(this.tar, ['-tf', full], { timeoutMs: 120_000 })
    const names = listing.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const info: ApkBundleInfo = { ...base, parts: names.filter((n) => extname(n).toLowerCase() === '.apk'), obbFiles: names.filter((n) => extname(n).toLowerCase() === '.obb') }
    if (names.includes('manifest.json')) {
      try {
        const m = JSON.parse((await this.run(this.tar, ['-xOf', full, 'manifest.json'], { timeoutMs: 60_000 })).stdout.replace(/^﻿/, '')) as Record<string, unknown>
        return { ...info, name: str(m.name), packageName: str(m.package_name), versionName: str(m.version_name), minSdk: num(m.min_sdk_version), targetSdk: num(m.target_sdk_version) }
      } catch {
        /* a bundle without a readable manifest.json is still convertible */
      }
    }
    return info
  }

  /** Online adb devices; BlueStacks is tried on its usual address when none is listed yet. */
  private async emulators(adb: string): Promise<string[]> {
    const list = async (): Promise<string[]> => {
      const { stdout } = await this.run(adb, ['devices'], { timeoutMs: 20_000 })
      return stdout.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0])
    }
    let found = await list().catch(() => [])
    if (!found.length) {
      // Each BlueStacks instance shows its own ADB port in Settings → Advanced (5555 for the first, 5556 and up or 5565, 5575… for others).
      await Promise.all(BLUESTACKS_ADB_PORTS.map((p) => this.run(adb, ['connect', `127.0.0.1:${p}`], { timeoutMs: 8_000 }).catch(() => undefined)))
      found = await list().catch(() => [])
    }
    return found
  }

  /**
   * Installs a converted apk on the emulator the same way the android_play tool does: `-i com.android.vending` records Google Play
   * as the installer, so a game that checks "was I installed from Play?" does not bounce the user to the Play listing. That record
   * lives in the system's package database, not in the apk file, which is why double-clicking the .apk cannot give it.
   */
  async installToEmulator(input: ApkInstallInput): Promise<ApkInstallResult> {
    if (this.installing) throw new Error('An install is already running.')
    const path = String(input.path)
    if (extname(path).toLowerCase() !== '.apk' || !existsSync(path) || !statSync(path).isFile()) throw new Error('That apk no longer exists.')
    const pkg = typeof input.packageName === 'string' && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(input.packageName) ? input.packageName : null
    this.installing = true
    try {
      const adb = this.deps.adb ?? findAdb(this.env)
      this.say('install', 'Looking for the emulator…')
      const devices = await this.emulators(adb)
      if (!devices.length) throw new Error('No emulator is online. Open BlueStacks, turn on Android Debug Bridge in its settings (Advanced), wait until it has booted, then try again.')
      const serial = devices.find((d) => d.startsWith('127.0.0.1:')) ?? devices[0]
      this.say('install', `Installing on ${serial} with Google Play as the installer (can take a minute)…`)
      let out = ''
      try {
        const r = await this.run(adb, ['-s', serial, 'install', '-r', '-i', 'com.android.vending', path], { timeoutMs: 10 * 60_000 })
        out = `${r.stdout}\n${r.stderr}`
      } catch (e) {
        const x = e as { stdout?: string; stderr?: string; message?: string }
        out = `${x.stdout ?? ''}\n${x.stderr ?? ''}\n${x.message ?? ''}`
      }
      if (!/\bSuccess\b/.test(out)) throw new Error(explainInstallFailure(out, pkg))
      let installer: string | null = null
      if (pkg) {
        const q = await this.run(adb, ['-s', serial, 'shell', 'pm', 'list', 'packages', '-i', pkg], { timeoutMs: 30_000 }).catch(() => null)
        installer = q?.stdout.match(/installer=(\S+)/)?.[1] ?? null
        if (installer === 'null') installer = null
      }
      this.say('done', installer ? `Installed. Installer recorded as ${installer}.` : 'Installed.')
      return { serial, installer }
    } finally {
      this.installing = false
    }
  }

  cancel(): boolean {
    if (!this.abort) return false
    this.abort.abort()
    return true
  }

  async convert(input: ApkConvertInput): Promise<ApkConvertResult> {
    if (this.abort) throw new Error('A conversion is already running.')
    const { full, isDir } = this.validate(input.path)
    const minSdk = input.minSdk ?? null
    if (minSdk !== null && (!Number.isInteger(minSdk) || minSdk < 1 || minSdk > MAX_SDK)) throw new Error(`The minimum SDK must be a whole number from 1 to ${MAX_SDK}.`)
    const ctl = new AbortController()
    this.abort = ctl
    const work = mkdtempSync(join(tmpdir(), 'apk-convert-'))
    try {
      return await this.pipeline(full, isDir, minSdk, work, ctl.signal)
    } catch (e) {
      if (ctl.signal.aborted) throw new Error('Cancelled.')
      throw e
    } finally {
      this.abort = null
      rmSync(work, { recursive: true, force: true })
    }
  }

  private async pipeline(full: string, isDir: boolean, minSdk: number | null, work: string, signal: AbortSignal): Promise<ApkConvertResult> {
    const java = await this.findJava()
    if (!java) throw new Error('Java was not found. Install Dink_ATU (its setup.ps1 includes a JDK), or install a JDK and set JAVA_HOME.')
    const editor = await this.ensureTool(this.editorSpec, signal)
    const signer = await this.ensureTool(this.signerSpec, signal)
    const runJava = (jar: string, args: string[]): Promise<RunResult> => this.run(java.path, ['-jar', jar, ...args], { signal })
    const warnings: string[] = []

    // 1. Unpack.
    const ext = extname(full).toLowerCase()
    let sourceDir = full
    if (!isDir && ext !== '.apk') {
      sourceDir = join(work, 'bundle')
      mkdirSync(sourceDir)
      this.say('extract', `Unpacking ${basename(full)}…`)
      try {
        await this.run(this.tar, ['-xf', full, '-C', sourceDir], { signal, timeoutMs: 10 * 60_000 })
      } catch (e) {
        throw new Error(`Could not unpack ${basename(full)}:\n${tail(e)}`)
      }
    }
    const apks = isDir || ext !== '.apk' ? findApks(sourceDir) : [full]
    if (!apks.length) throw new Error(`No .apk files were found in ${basename(full)}.`)
    const obb = isDir || ext !== '.apk' ? findFiles(sourceDir, '.obb') : []
    if (obb.length) warnings.push(`This bundle also holds ${obb.length} OBB data file(s) (${obb.map((o) => basename(o)).join(', ')}). An apk cannot contain them: copy them to /sdcard/Android/obb/<package>/ on the device or the game may stop at a download screen.`)

    // 2. Merge the splits into one apk.
    let merged = join(work, 'merged.apk')
    if (apks.length === 1) {
      copyFileSync(apks[0], merged)
      this.say('merge', 'The package is already a single apk, no merge needed.')
    } else {
      this.say('merge', `Merging ${apks.length} parts into one apk…`)
      try {
        await runJava(editor, ['m', '-i', sourceDir, '-o', merged])
      } catch (e) {
        throw new Error(`Merging the splits failed:\n${tail(e)}`)
      }
      if (!existsSync(merged)) throw new Error('Merging the splits produced no apk.')
    }

    // 3. Optionally lower the minimum Android version.
    const manifest = await readZipEntry(merged, 'AndroidManifest.xml')
    const minSdkBefore = manifest ? readMinSdk(manifest) : null
    let minSdkAfter = minSdkBefore
    if (minSdk !== null && manifest) {
      const patched = lowerMinSdk(manifest, minSdk)
      if (!patched) warnings.push('The minimum SDK could not be changed: this manifest has no editable minSdkVersion. The apk keeps its original requirement.')
      else if (!patched.changed) this.say('patch', `The app already needs only SDK ${patched.from}, nothing to lower.`)
      else {
        this.say('patch', `Lowering the minimum Android version from SDK ${patched.from} to ${minSdk}…`)
        const out = join(work, 'patched.apk')
        await replaceZipEntry(merged, out, 'AndroidManifest.xml', () => patched.manifest)
        merged = out
        minSdkAfter = minSdk
        warnings.push(`The minimum SDK was lowered from ${patched.from} to ${minSdk}. It installs on older Android, but the game can still crash if it uses features only newer Android has.`)
      }
    }

    // 4. Align and sign (a modified or merged apk has no valid signature, and Android refuses to install it).
    this.say('sign', 'Aligning and signing the apk…')
    const signedDir = join(work, 'signed')
    try {
      await runJava(signer, ['-a', merged, '--allowResign', '--out', signedDir])
    } catch (e) {
      throw new Error(`Signing failed:\n${tail(e)}`)
    }
    const signed = (existsSync(signedDir) ? readdirSync(signedDir) : []).filter((f) => extname(f).toLowerCase() === '.apk')
    if (!signed.length) throw new Error('Signing produced no apk.')

    // 5. Put the result next to the source file, never over an existing file.
    const stem = (isDir ? basename(full) : basename(full, extname(full))).replace(/[<>:"/\\|?*]/g, '_')
    const lowered = minSdkAfter !== minSdkBefore && minSdkAfter !== null
    const outDir = dirname(full)
    let outputPath = join(outDir, `${stem}${lowered ? `_minSdk${minSdkAfter}` : ''}.apk`)
    for (let n = 2; existsSync(outputPath); n++) outputPath = join(outDir, `${stem}${lowered ? `_minSdk${minSdkAfter}` : ''} (${n}).apk`)
    copyFileSync(join(signedDir, signed[0]), outputPath)
    const result: ApkConvertResult = { outputPath, sizeBytes: statSync(outputPath).size, parts: apks.length, minSdkBefore, minSdkAfter, warnings }
    this.say('done', `Saved ${outputPath}`)
    return result
  }
}
