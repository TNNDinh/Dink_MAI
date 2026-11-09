import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A game rebuilt from an APK is only as good as what is known about the original. Mono games give real C#; IL2CPP games give
 * a list of classes and method names, and at best machine-made pseudo-C. An agent that fills the gap with plausible guesses
 * and writes them down as facts hands those "facts" to the next task, which builds on them, and the errors pile up.
 * These rules make the agent say what it SAW and what it GUESSED, and tell it how good the evidence is.
 */
export const EVIDENCE_RULES = [
  'Evidence rule for reverse-engineered games: every statement about how the original game behaves must carry a tag.',
  '[VERIFIED: <source>] only when you read it in real C# (decompiled/), saw it in an observed run (a ui_dump or logcat line), or found it in a data file; name the file and line or the screen.',
  '[INFERRED] for anything you worked out from names, class outlines or pseudo-C. Inferred statements are guesses: never present them as facts, never build a later decision on one without checking it, and list each under "Open questions" with the cheapest way to check it (a search_large_file query, a run in the emulator).',
  'A document about how a game plays must start by saying whether anyone played it in this project (a play-test note exists) or not: if not, write "Not played: the gameplay below is [INFERRED] from code and data" in its first lines.',
  'When you do not know, write "unknown". An honest gap is worth more than a believable invention. Numbers (damage, speed, prices, drop rates) are VERIFIED only if read from data or code.'
].join(' ')

const countFiles = (dir: string, ext: string, cap = 100_000): number => {
  try {
    let n = 0
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(ext) && ++n >= cap) break
    }
    return n
  } catch {
    return 0
  }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export interface CodeEvidence {
  backend: 'Mono' | 'IL2CPP' | 'unknown'
  monoSources: number
  hasDump: boolean
  pseudoC: number
  summary: string
}

/** How much of the original code a Dink_ATU output folder really contains. Reads only the folder, never guesses. */
export function describeCodeEvidence(outDir: string): CodeEvidence {
  let backend: CodeEvidence['backend'] = 'unknown'
  try {
    const m = /Backend\s*:\s*(Mono|IL2CPP)/i.exec(readFileSync(join(outDir, 'REPORT.md'), 'utf8'))
    if (m) backend = /il2cpp/i.test(m[1]) ? 'IL2CPP' : 'Mono'
  } catch {
    /* no report: decided from the folders below */
  }
  const monoSources = countFiles(join(outDir, 'decompiled'), '.cs')
  const hasDump = existsSync(join(outDir, 'il2cpp', 'dump.cs'))
  const logicDir = ['logic', 'Logic_PseudoC'].map((d) => join(outDir, d)).find(isDir)
  const pseudoC = logicDir ? countFiles(logicDir, '.c') : 0
  if (backend === 'unknown') backend = monoSources > 0 ? 'Mono' : hasDump ? 'IL2CPP' : 'unknown'

  const lines: string[] = []
  if (monoSources > 0) {
    lines.push(`REAL C# SOURCE: ${monoSources} files in decompiled/. Read them for behaviour; this is the strongest evidence you have.`)
  }
  if (hasDump) {
    lines.push('CLASS OUTLINES: il2cpp/dump.cs lists classes, fields and method signatures with addresses, but NO logic. Behaviour cannot be read from it.')
  }
  if (pseudoC > 0) {
    lines.push(`PSEUDO-C: ${pseudoC} files in logic/, made by Ghidra. It is NOT the original code: names are auto-generated and the control flow is approximate. Use it to confirm ideas, expect mistakes, and tag what you take from it [INFERRED] unless the value is a plain constant or string.`)
  } else if (backend === 'IL2CPP') {
    lines.push('NO LOGIC: the IL2CPP logic was not decompiled. Run apk_to_unity convert again under a new name with decompile_logic=true if you need the behaviour of specific classes, or observe the game with android_play.')
  }
  if (monoSources === 0 && !hasDump && pseudoC === 0) lines.push('No code was recovered. Only assets are available; do not describe code behaviour.')
  return { backend, monoSources, hasDump, pseudoC, summary: `Code evidence (backend ${backend}):\n- ${lines.join('\n- ')}\n${EVIDENCE_RULES}` }
}
