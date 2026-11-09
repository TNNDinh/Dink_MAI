import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../db/database'
import type { AtuStatus } from '../../shared/ipc'

const KEY = 'tools.atu_dir'
const SCRIPT = 'apk2unity.ps1'
const DEFAULT_DIRS = ['D:\\Projects\\Dink_ATU', 'D:\\apk2unity']

const hasScript = (dir: string, exists: (p: string) => boolean = existsSync): boolean => exists(join(dir, SCRIPT))

/** The folder the user picked in the app, or null. Not checked for existence here. */
export function readConfiguredAtuDir(db: Pick<Database, 'get'>): string | null {
  const row = db.get<{ value_json: string }>(`SELECT value_json FROM settings WHERE key = ?`, KEY)
  if (!row) return null
  try {
    const v: unknown = JSON.parse(row.value_json)
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

/**
 * Where Dink_ATU is. Order: the folder picked in Settings, then DINK_ATU_DIR, then the usual clone folders. A folder that no
 * longer holds apk2unity.ps1 is skipped, so a moved or deleted install falls through instead of failing at run time.
 */
export function resolveAtuDir(configured: string | null, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): { dir: string; source: AtuStatus['source'] } | null {
  const tries: Array<{ dir: string; source: NonNullable<AtuStatus['source']> }> = []
  if (configured) tries.push({ dir: configured, source: 'setting' })
  if (env.DINK_ATU_DIR) tries.push({ dir: env.DINK_ATU_DIR, source: 'env' })
  // An explicit environment folder is the only auto-detection that is honoured; without it the usual clone folders are tried.
  else for (const d of DEFAULT_DIRS) tries.push({ dir: d, source: 'default' })
  return tries.find((t) => hasScript(t.dir, exists)) ?? null
}

export class ToolPaths {
  constructor(private readonly db: Database) {}

  configuredAtu(): string | null {
    return readConfiguredAtuDir(this.db)
  }

  atuStatus(): AtuStatus {
    const configured = this.configuredAtu()
    const found = resolveAtuDir(configured)
    return {
      dir: found?.dir ?? null,
      source: found?.source ?? null,
      configured,
      configuredValid: configured ? hasScript(configured) : null,
      toolsInstalled: found ? existsSync(join(found.dir, 'tools')) : false
    }
  }

  /** Saves the folder after checking it really is a Dink_ATU install. Pass null to forget it. */
  setAtu(dir: string | null): AtuStatus {
    if (dir === null) {
      this.db.run(`DELETE FROM settings WHERE key = ?`, KEY)
      return this.atuStatus()
    }
    const clean = dir.trim()
    if (!clean || !hasScript(clean)) throw new Error(`That folder is not Dink_ATU: ${SCRIPT} was not found in it. Pick the folder that contains ${SCRIPT} (for example D:\\apk2unity).`)
    this.db.run(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      KEY,
      JSON.stringify(clean),
      Date.now()
    )
    return this.atuStatus()
  }
}
