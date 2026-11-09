import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { isSecretPath } from '../workspace/sandbox'
import type { AgentTool, ToolContext } from './tools'

/**
 * Reads the class outline Dink_ATU writes for IL2CPP games (il2cpp/dump.cs, tens of MB, about a million lines) and answers
 * structured questions about it: which assemblies, which namespaces, which classes, which fields and methods. It is plain
 * parsing with no AI in the loop, so the result is a fact about the file and costs no tokens to produce. The outline holds
 * names and signatures only, never what a method does.
 */
const MAX_BIG_BYTES = 400 * 1024 * 1024
const DEFAULT_CLASSES = 40
const MAX_CLASSES = 120
const DEFAULT_MEMBERS = 40
const MAX_MEMBERS = 150
const OUTPUT_CHARS = 14_000
const LINE_CLIP = 220

export interface OutlineQuery {
  /** Substring of the assembly (image) name, e.g. "Assembly-CSharp" or "TurnBase". */
  assembly?: string
  /** Substring of the namespace. */
  namespace?: string
  /** Case-insensitive regular expression (or substring) matched on the class name. */
  className?: string
  /** Case-insensitive substring matched on field/property/method lines; keeps only classes that have a match. */
  member?: string
  /** Show members of every matching class (otherwise only when className or member is given). */
  members?: boolean
  maxClasses?: number
  maxMembers?: number
}

export interface OutlineClass {
  assembly: string
  namespace: string
  kind: string
  name: string
  base: string
  typeDefIndex: number
  fields: number
  properties: number
  methods: number
  generated: boolean
  /** Member lines kept for display (only for classes that pass the filters). */
  lines: string[]
  matchedMembers: number
}

export interface OutlineResult {
  assemblies: Array<{ name: string; classes: number }>
  /** Classes that passed the filters (members are kept only for the first maxClasses). */
  classes: OutlineClass[]
  totalClasses: number
  matchedClasses: number
  hiddenGenerated: number
  lines: number
}

const HEADER = /^((?:[a-z]+ )*)(class|struct|enum|interface) (.+?) \/\/ TypeDefIndex: (\d+)\s*$/
const IMAGE = /^\/\/ Image (\d+): (.+?) - (\d+)\s*$/

const clip = (s: string): string => (s.length > LINE_CLIP ? `${s.slice(0, LINE_CLIP)}…` : s)

/** Streams the file once. Members are only kept for classes that pass the filters, so memory stays small. */
export async function readOutline(full: string, q: OutlineQuery = {}): Promise<OutlineResult> {
  const asm = q.assembly?.toLowerCase()
  const ns = q.namespace?.toLowerCase()
  const member = q.member?.toLowerCase()
  let nameRe: RegExp | null = null
  if (q.className) {
    try {
      nameRe = new RegExp(q.className, 'i')
    } catch {
      nameRe = new RegExp(q.className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }
  }
  const wantMembers = q.members === true || !!q.className || !!member
  const keep = Math.min(Math.max(q.maxClasses ?? DEFAULT_CLASSES, 1), MAX_CLASSES)
  const maxMembers = Math.min(Math.max(q.maxMembers ?? DEFAULT_MEMBERS, 1), MAX_MEMBERS)

  const images: Array<{ name: string; start: number }> = []
  let sorted: Array<{ name: string; start: number }> | null = null
  const counts = new Map<string, number>()
  const assemblyOf = (idx: number): string => {
    sorted ??= [...images].sort((a, b) => a.start - b.start)
    let lo = 0
    let hi = sorted.length - 1
    let found = sorted[0]?.name ?? '?'
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid].start <= idx) {
        found = sorted[mid].name
        lo = mid + 1
      } else hi = mid - 1
    }
    return found
  }

  const out: OutlineClass[] = []
  let total = 0
  let matched = 0
  let hiddenGenerated = 0
  let n = 0
  let namespace = ''
  let cur: OutlineClass | null = null
  let section: 'fields' | 'properties' | 'methods' | 'other' = 'other'
  let inBlock = false

  const finish = (): void => {
    if (!cur) return
    const c = cur
    cur = null
    total++
    counts.set(c.assembly, (counts.get(c.assembly) ?? 0) + 1)
    if (asm && !c.assembly.toLowerCase().includes(asm)) return
    if (ns && !c.namespace.toLowerCase().includes(ns)) return
    if (nameRe && !nameRe.test(c.name)) return
    if (member && c.matchedMembers === 0) return
    if (c.generated && !nameRe) {
      hiddenGenerated++
      return
    }
    matched++
    if (out.length < keep) out.push(c)
  }

  const rl = createInterface({ input: createReadStream(full, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    n++
    if (line.length === 0) continue
    const c0 = line.charCodeAt(0)
    if (c0 === 0x2f /* / */) {
      const im = IMAGE.exec(line)
      if (im) images.push({ name: im[2], start: Number(im[3]) })
      else if (line.startsWith('// Namespace:')) namespace = line.slice(13).trim()
      continue
    }
    if (c0 !== 0x09 /* tab */) {
      if (c0 === 0x7b || c0 === 0x7d) {
        // "{" opens and "}" closes a class body; the class is complete at "}".
        if (c0 === 0x7d) finish()
        continue
      }
      const h = HEADER.exec(line)
      if (h) {
        finish()
        const rest = h[3]
        const sep = rest.indexOf(' : ')
        const name = sep === -1 ? rest : rest.slice(0, sep)
        const idx = Number(h[4])
        cur = { assembly: assemblyOf(idx), namespace, kind: h[2], name, base: sep === -1 ? '' : rest.slice(sep + 3), typeDefIndex: idx, fields: 0, properties: 0, methods: 0, generated: name.includes('<'), lines: [], matchedMembers: 0 }
        section = 'other'
        inBlock = false
      }
      continue
    }
    if (!cur) continue
    // Tab-indented: a section marker, a comment, a generic-instance block, or a member.
    if (inBlock) {
      if (line.startsWith('\t*/')) inBlock = false
      continue
    }
    if (line.startsWith('\t/*')) {
      if (!line.includes('*/')) inBlock = true
      continue
    }
    if (line.startsWith('\t//')) {
      const m = line.slice(3).trim()
      if (m === 'Fields') section = 'fields'
      else if (m === 'Properties') section = 'properties'
      else if (m === 'Methods') section = 'methods'
      else if (m === 'Events') section = 'other'
      continue
    }
    if (line.startsWith('\t|')) continue
    let text = line.trim()
    if (!text) continue
    if (section === 'fields') cur.fields++
    else if (section === 'properties') cur.properties++
    else if (section === 'methods') cur.methods++
    else continue
    // "private int x; // 0x10" -> "private int x;"   and   "void Foo() { }" -> "void Foo()"
    text = text.replace(/\s*\/\/ 0x[0-9A-Fa-f]+$/, '').replace(/\s*\{ \}$/, '')
    if (member && !text.toLowerCase().includes(member)) continue
    if (member) cur.matchedMembers++
    if (wantMembers && cur.lines.length < maxMembers) cur.lines.push(`${section === 'fields' ? 'field' : section === 'properties' ? 'prop' : 'method'}: ${clip(text)}`)
  }
  finish()
  return { assemblies: images.map((i) => ({ name: i.name, classes: counts.get(i.name) ?? 0 })), classes: out, totalClasses: total, matchedClasses: matched, hiddenGenerated, lines: n }
}

/** Assemblies that hold the game's own code are the ones that are not part of the engine, the runtime or a well-known SDK. */
const PLATFORM = /^(mscorlib|System(\.|$)|Mono\.|netstandard|UnityEngine|Unity\.|Newtonsoft|DOTween|Firebase|Facebook|Google|AppsFlyer|MaxSdk|spine-|Coffee\.|com\.|UniTask|UltimateEditorEnhancer|__Generated|Cinemachine|UnityUIExtensions|BrunoMikoski|UIEffect|I2|Sirenix|Purchasing|TigerForge)/i

function formatClass(c: OutlineClass, withMembers: boolean): string {
  const head = `${c.namespace ? `${c.namespace}.` : ''}${c.name}${c.base ? ` : ${c.base}` : ''}  [${c.kind}, ${c.assembly}, ${c.fields} fields, ${c.properties} props, ${c.methods} methods]`
  if (!withMembers) return head
  const shown = c.lines.length
  const total = c.fields + c.properties + c.methods
  return `${head}\n${c.lines.map((l) => `    ${l}`).join('\n')}${shown < total && !c.lines.length ? '' : shown < total ? `\n    [… ${total - shown} more members: narrow with member or max_members]` : ''}`
}

/** The text an agent reads. Everything in it comes straight from the file. */
export function renderOutline(r: OutlineResult, q: OutlineQuery, rel: string): string {
  const parts: string[] = []
  const filtered = !!(q.assembly || q.namespace || q.className || q.member)
  parts.push(`Source: ${rel} (${r.lines} lines, ${r.totalClasses} types). This is a signature outline: it lists names and shapes, NOT what a method does.`)
  if (!filtered) {
    const game = r.assemblies.filter((a) => !PLATFORM.test(a.name) && a.classes > 0)
    const rest = r.assemblies.filter((a) => PLATFORM.test(a.name) && a.classes > 0)
    parts.push(`Assemblies likely to hold the game's own code (${game.length}):\n${game.map((a) => `  ${a.name} — ${a.classes} types`).join('\n') || '  (none recognised)'}`)
    parts.push(`Engine, runtime and SDK assemblies (${rest.length}): ${rest.map((a) => `${a.name} (${a.classes})`).join(', ')}`)
    parts.push('Next: call again with assembly="<name>" to list its namespaces and classes, or class="<regex>" to read members.')
    return parts.join('\n\n')
  }
  const withMembers = !!(q.className || q.member || q.members)
  const byNs = new Map<string, number>()
  for (const c of r.classes) byNs.set(c.namespace || '(global)', (byNs.get(c.namespace || '(global)') ?? 0) + 1)
  const header: string[] = []
  header.push(`${r.matchedClasses} type(s) match${r.hiddenGenerated ? ` (${r.hiddenGenerated} compiler-generated hidden)` : ''}${r.matchedClasses > r.classes.length ? `, showing ${r.classes.length}: narrow the filter to see the rest` : ''}.`)
  parts.push(header.join(' '))
  if (!r.classes.length) return parts.join('\n\n')
  if (!withMembers && r.matchedClasses > r.classes.length) {
    // Too many to list one by one: a namespace overview is more useful than the first few classes.
    parts.push(`Classes shown, by namespace: ${[...byNs.entries()].map(([k, v]) => `${k} (${v})`).join(', ')}`)
  }
  parts.push(r.classes.map((c) => formatClass(c, withMembers)).join('\n'))
  return parts.join('\n\n')
}

/** The newest il2cpp/dump.cs under atu_output/, for when the agent does not give a path. */
function findDump(outRoot: string): string | null {
  try {
    const found = readdirSync(outRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(outRoot, e.name, 'il2cpp', 'dump.cs'))
      .filter((p) => existsSync(p))
      .map((p) => ({ p, t: statSync(p).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]
    return found?.p ?? null
  } catch {
    return null
  }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

const il2cppOutline: AgentTool = {
  def: {
    name: 'il2cpp_outline',
    description: `Structured, free (no tokens spent producing it) outline of an IL2CPP game's code from il2cpp/dump.cs: assemblies, namespaces, classes with base types, and their fields, properties and method signatures. Prefer it to reading or searching dump.cs by hand (the file is about a million lines). With no filter it lists the assemblies, separating likely game code from engine and SDK. Then narrow: assembly (substring), namespace (substring), class (regex on the class name), member (substring of a field/method line, keeps only classes that have one). Result sizes are capped (max_classes up to ${MAX_CLASSES}, max_members up to ${MAX_MEMBERS} per class), so use filters instead of asking for everything. Only names and signatures exist here: say what a method does only if you observed it or marked it [INFERRED]. Without path it uses the newest atu_output/*/il2cpp/dump.cs.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'dump.cs relative to the project root. Optional.' },
        assembly: { type: 'string', description: 'Assembly name or part of it, e.g. "Assembly-CSharp" or "TurnBase.Features".' },
        namespace: { type: 'string', description: 'Namespace or part of it.' },
        class: { type: 'string', description: 'Class name or regular expression (case-insensitive), e.g. "Manager$|Controller$".' },
        member: { type: 'string', description: 'Text that must appear in a field, property or method line, e.g. "Score" or "OnLevelComplete".' },
        members: { type: 'boolean', description: 'Show members of every listed class (default: only when class or member is given).' },
        max_classes: { type: 'integer', description: `Default ${DEFAULT_CLASSES}, max ${MAX_CLASSES}.` },
        max_members: { type: 'integer', description: `Per class, default ${DEFAULT_MEMBERS}, max ${MAX_MEMBERS}.` }
      }
    }
  },
  allowed: (a) => a.permissions.readFiles,
  execute: async (ctx: ToolContext, args) => {
    if (!ctx.workspace) throw new Error('The project workspace is not available.')
    const sandbox = ctx.workspace.sandbox(ctx.projectId)
    let full: string
    let rel: string
    const given = str(args.path)
    if (given) {
      const r = sandbox.resolve(given)
      if (isSecretPath(r.rel)) throw new Error('That file cannot be read (credential file).')
      full = r.full
      rel = r.rel
    } else {
      const found = findDump(sandbox.resolve('atu_output').full)
      if (!found) throw new Error('No atu_output/*/il2cpp/dump.cs found. Run apk_to_unity with action "convert" on an IL2CPP game first.')
      full = found
      rel = found.slice(sandbox.resolve('.').full.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
    }
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`${rel} is not a file of the project.`)
    if (statSync(full).size > MAX_BIG_BYTES) throw new Error(`${rel} is larger than ${MAX_BIG_BYTES / 1024 / 1024} MB.`)
    const q: OutlineQuery = { assembly: str(args.assembly), namespace: str(args.namespace), className: str(args.class), member: str(args.member), members: args.members === true, maxClasses: num(args.max_classes), maxMembers: num(args.max_members) }
    const r = await readOutline(full, q)
    if (!r.totalClasses) throw new Error(`${rel} has no class declarations: it is not an il2cpp dump.cs.`)
    const text = renderOutline(r, q, rel)
    return text.length > OUTPUT_CHARS ? `${text.slice(0, OUTPUT_CHARS)}\n[… clipped: use a narrower filter or smaller max_classes/max_members …]` : text
  }
}

export const IL2CPP_TOOLS: AgentTool[] = [il2cppOutline]
