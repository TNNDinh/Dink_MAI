import { randomBytes } from 'node:crypto'
import type { McpStatus } from '../../shared/ipc'
import type { Database } from '../db/database'
import type { SecretStore } from '../secrets/secret-store'
import { McpHttpServer } from './server'
import { buildTools } from './tools'
import type { UiBridge } from './ui-driver'

export const DEFAULT_MCP_PORT = 47615
const SETTING = 'mcp'
const TOKEN_REF = 'mcp.token'

/**
 * Channels an AI client may not reach through app_call:
 * - native dialogs would pop up on the user's screen and wait for them;
 * - terminal commands run as the user without the approval step agents go through (the client has its own shell anyway);
 * - answering approvals is the human's decision, and the mcp:* channels would let the client lock the owner out or read the token.
 */
const DENIED = new Set(['projects:pickFolder', 'tools:atuBrowse', 'apk:pickFile', 'term:run', 'approvals:respond', 'mcp:status', 'mcp:setEnabled', 'mcp:rotateToken'])

type HandlerMap = Record<string, (...args: never[]) => unknown>

const INSTRUCTIONS =
  'Multi-AI Development Studio. Use the dedicated tools first (projects, tasks, runs, files, git, automation). app_call reaches every other app function. ' +
  'To check the interface, ui_snapshot lists what is on screen and ui_click / ui_type operate it with real input events; ui_screenshot shows it. ' +
  'Approving commands is left to the person at the keyboard.'

/** Owns the in-app MCP server: on/off setting, the access token, and the tools it serves. */
export class McpService {
  private handlers: HandlerMap | null = null
  private token = ''
  private lastError = ''
  private enabled = false
  private readonly server: McpHttpServer

  constructor(
    private readonly db: Database,
    private readonly secrets: SecretStore,
    private readonly opts: { version: string; ui: () => UiBridge | null; port?: number; forceEnabled?: boolean; /** Fixed token for automated runs (MADS_MCP_TOKEN); never stored. */ token?: string }
  ) {
    this.server = new McpHttpServer({
      name: 'multi-ai-dev-studio',
      version: opts.version,
      instructions: INSTRUCTIONS,
      token: () => this.token,
      tools: () => this.tools
    })
  }

  private readonly tools = buildTools({
    call: (channel, ...args) => this.call(channel, args),
    channels: () => this.channels(),
    ui: () => this.opts.ui()
  })

  /** Wires in the app's handlers (created after this service because they include its own control channels). */
  attach(handlers: object): void {
    this.handlers = handlers as HandlerMap
  }

  channels(): string[] {
    return Object.keys(this.handlers ?? {}).filter((c) => !DENIED.has(c)).sort()
  }

  async call(channel: string, args: unknown[]): Promise<unknown> {
    const h = this.handlers
    if (!h || !Object.prototype.hasOwnProperty.call(h, channel)) throw new Error(`Unknown channel "${channel}". Call app_channels for the list.`)
    if (DENIED.has(channel)) throw new Error(`"${channel}" is not available to AI clients: it needs the person at the keyboard.`)
    const first = args[0] as { bypassApprovals?: unknown } | undefined
    if (channel === 'projects:update' && first?.bypassApprovals === true) throw new Error('Turning on "bypass approvals" is for the person at the keyboard.')
    return await (h[channel] as (...a: unknown[]) => unknown)(...args)
  }

  /** Loads the saved state and starts listening if it is switched on. Never throws: a busy port must not stop the app. */
  async init(): Promise<void> {
    const row = this.db.get<{ value_json: string }>(`SELECT value_json FROM settings WHERE key = ?`, SETTING)
    try {
      this.enabled = Boolean(JSON.parse(row?.value_json ?? '{}').enabled)
    } catch {
      this.enabled = false
    }
    if (this.opts.forceEnabled) this.enabled = true
    await this.loadToken()
    if (this.enabled) await this.start()
  }

  private async loadToken(): Promise<void> {
    if (this.opts.token) {
      this.token = this.opts.token
      return
    }
    this.token = (await this.secrets.get(TOKEN_REF).catch(() => undefined)) ?? ''
    if (this.token) return
    this.token = randomBytes(24).toString('base64url')
    // Without OS encryption the token lives for this session only; the settings page then shows a fresh command each launch.
    await this.secrets.set(TOKEN_REF, this.token).catch(() => undefined)
  }

  private async start(): Promise<void> {
    this.lastError = ''
    try {
      await this.server.start(this.opts.port ?? DEFAULT_MCP_PORT)
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
    }
  }

  async setEnabled(on: boolean): Promise<McpStatus> {
    this.enabled = on
    this.db.run(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      SETTING,
      JSON.stringify({ enabled: on }),
      Date.now()
    )
    if (on) await this.start()
    else {
      this.lastError = ''
      await this.server.stop()
    }
    return this.status()
  }

  /** A new token: every client registered with the old one stops working. */
  async rotateToken(): Promise<McpStatus> {
    this.token = randomBytes(24).toString('base64url')
    await this.secrets.set(TOKEN_REF, this.token).catch(() => undefined)
    return this.status()
  }

  status(): McpStatus {
    const port = this.server.port
    const url = port ? `http://127.0.0.1:${port}/mcp` : null
    return {
      enabled: this.enabled,
      running: this.server.running,
      port,
      url,
      token: this.token,
      toolCount: this.tools.length,
      registerCommand: url ? `claude mcp add --transport http studio ${url} --header "Authorization: Bearer ${this.token}"` : null,
      error: this.lastError || null
    }
  }

  async stop(): Promise<void> {
    await this.server.stop()
  }
}
