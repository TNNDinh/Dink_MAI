import { spawn as nodeSpawn } from 'node:child_process'
import { BaseChatProvider, ResponseAccumulator } from './base'
import { ProviderError } from './http'
import type { ChatMessage, ChatRequest, ConnectionStatus, ModelInfo, StreamEvent, ToolCall, ToolDefinition } from './types'

/**
 * Chat provider that drives the locally installed Claude Code CLI (`claude -p`) instead of calling an HTTP API.
 * It uses whatever login the CLI already has on this PC, so no API key is stored by this app.
 *
 * The CLI runs with all of its own tools turned off, so the app stays in control. When the orchestrator offers tools,
 * they are described to the model in the system prompt and the model asks for them in a ```tool_calls block of JSON,
 * which is parsed back into normal tool calls (see `toolInstructions` / `parseToolCalls`). Images in a message are
 * replaced by a short placeholder.
 */

const MODEL_ALIASES: ModelInfo[] = [
  { id: 'sonnet', displayName: 'Claude Sonnet (via Claude Code)', kind: 'chat' },
  { id: 'opus', displayName: 'Claude Opus (via Claude Code)', kind: 'chat' },
  { id: 'haiku', displayName: 'Claude Haiku (via Claude Code)', kind: 'chat' }
]

const DEFAULT_TIMEOUT_MS = 180_000

// Tests replace this with a fake process so no real CLI is needed.
let spawn: typeof nodeSpawn = nodeSpawn
export function setSpawnForTests(fn: typeof nodeSpawn | undefined): void {
  spawn = fn ?? nodeSpawn
}

/** Flatten a conversation into one prompt; the CLI takes a single prompt per call. */
export function renderTranscript(messages: ChatMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const label = m.role === 'user' ? 'User' : 'Assistant'
    if (typeof m.content === 'string') {
      lines.push(`${label}: ${m.content}`)
      continue
    }
    const parts: string[] = []
    for (const p of m.content) {
      if (p.type === 'text') parts.push(p.text)
      else if (p.type === 'image') parts.push('[image omitted]')
      else if (p.type === 'tool_call') parts.push(`(requested tool ${p.name} [${p.id}] with ${JSON.stringify(p.arguments)})`)
      else if (p.type === 'tool_result') parts.push(`(tool result [${p.toolCallId}]${p.isError ? ' ERROR' : ''}: ${p.content})`)
    }
    lines.push(`${label}: ${parts.join('\n')}`)
  }
  // With a single user turn there is no need for the "User:" label.
  if (messages.length === 1 && messages[0].role === 'user' && typeof messages[0].content === 'string') return messages[0].content
  lines.push('Assistant:')
  return lines.join('\n\n')
}


/** System-prompt text that teaches the model to request tools through a JSON block. */
export function toolInstructions(tools: ToolDefinition[]): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description}\n  arguments (JSON schema): ${JSON.stringify(t.parameters)}`).join('\n')
  return [
    'You can use the following tools. You cannot run them yourself: ask for them and the host application will run them and send back the results.',
    list,
    'To use tools, reply with ONLY one fenced block, with no other text before or after it, in exactly this form:',
    '```tool_calls',
    '[{"name": "<tool name>", "arguments": { ... }}]',
    '```',
    'The array may hold several calls; they are run in order. The arguments must be valid JSON that matches the schema (escape newlines inside strings as \\n).',
    'Never write tool calls in any other form (no <invoke> or XML tags): only the ```tool_calls block is understood.',
    'When you have everything you need and the work is finished, reply with a normal text answer and no tool_calls block.'
  ].join('\n')
}

/** Pulls the tool_calls block out of a reply. Returns the remaining text and the calls it asked for. */
/**
 * Some replies use the XML shape Claude models know natively (<invoke name="x"><parameter name="p">value</parameter></invoke>)
 * instead of the JSON block. Parameter values are text; the tool's schema decides which ones are numbers, booleans or JSON.
 */
function parseInvokeBlocks(text: string, idPrefix: string, tools: ToolDefinition[] | undefined): { text: string; calls: ToolCall[] } | null {
  const wrapper = /<(?:[\w-]+:)?function_calls>[\s\S]*?<\/(?:[\w-]+:)?function_calls>/
  const invoke = /<(?:[\w-]+:)?invoke name="([^"]+)">([\s\S]*?)<\/(?:[\w-]+:)?invoke>/g
  const calls: ToolCall[] = []
  for (const m of text.matchAll(invoke)) {
    const props = (tools?.find((t) => t.name === m[1])?.parameters as { properties?: Record<string, { type?: string }> } | undefined)?.properties ?? {}
    const args: Record<string, unknown> = {}
    for (const p of m[2].matchAll(/<(?:[\w-]+:)?parameter name="([^"]+)">([\s\S]*?)<\/(?:[\w-]+:)?parameter>/g)) {
      const value = p[2].replace(/^\n/, '').replace(/\n$/, '')
      const type = props[p[1]]?.type
      if (type === 'string' || type === undefined) args[p[1]] = value
      else {
        try {
          args[p[1]] = JSON.parse(value)
        } catch {
          args[p[1]] = value
        }
      }
    }
    calls.push({ id: `${idPrefix}-${calls.length}`, name: m[1], arguments: args })
  }
  if (!calls.length) return null
  const rest = text.replace(wrapper, '').replace(invoke, '').trim()
  return { text: rest, calls }
}

export function parseToolCalls(text: string, idPrefix: string, tools?: ToolDefinition[]): { text: string; calls: ToolCall[] } {
  const fenced = /```(?:tool_calls|json)?\s*\n?(\[[\s\S]*?\])\s*```/.exec(text)
  // Models sometimes drop the opening or the closing fence around the array.
  const bare = /^\s*(?:```(?:tool_calls|json)?\s*)?(\[\s*\{[\s\S]*\}\s*\])\s*(?:```)?\s*$/.exec(text)
  const raw = fenced ? fenced[1] : bare?.[1]
  if (!raw) return parseInvokeBlocks(text, idPrefix, tools) ?? { text, calls: [] }
  let arr: unknown
  try {
    arr = JSON.parse(raw)
  } catch {
    return { text, calls: [] }
  }
  if (!Array.isArray(arr)) return { text, calls: [] }
  const calls: ToolCall[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as { name?: unknown; arguments?: unknown; input?: unknown }
    if (typeof o.name !== 'string') continue
    const args = o.arguments ?? o.input
    calls.push({ id: `${idPrefix}-${calls.length}`, name: o.name, arguments: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} })
  }
  if (!calls.length) return { text, calls: [] }
  const rest = fenced ? text.replace(fenced[0], '').trim() : ''
  return { text: rest, calls }
}

export function buildClaudeArgs(req: ChatRequest): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--tools', '',
    // Nothing from this PC's own Claude setup may leak in: no MCP servers or connectors (they would show up as tools the app cannot control), no skills or slash commands.
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands'
  ]
  if (req.model) args.push('--model', req.model)
  const system = [req.system, req.tools?.length ? toolInstructions(req.tools) : undefined].filter(Boolean).join('\n\n')
  if (system) args.push('--system-prompt', system)
  return args
}

export class ClaudeCodeProvider extends BaseChatProvider {
  readonly kind = 'claude-code' as const

  /** The base URL field holds the command to run (default: `claude`). */
  private get command(): string {
    return this.config.baseUrl || 'claude'
  }

  protected authHeaders(): Record<string, string> {
    return {}
  }

  async listModels(): Promise<ModelInfo[]> {
    return MODEL_ALIASES
  }

  override async testConnection(signal?: AbortSignal): Promise<ConnectionStatus> {
    const started = Date.now()
    try {
      await this.run(['--version'], '', signal, 20_000)
      return { ok: true, latencyMs: Date.now() - started, modelCount: MODEL_ALIASES.length }
    } catch (e) {
      const pe = e instanceof ProviderError ? e : undefined
      return { ok: false, latencyMs: Date.now() - started, errorKind: pe?.kind ?? 'unknown', error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Run the CLI to completion and return stdout (used for the connection test). */
  private run(args: string[], stdin: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new ProviderError(`"${this.command}" did not answer within ${Math.round(timeoutMs / 1000)}s`, 'timeout', { provider: this.kind }))
      }, timeoutMs)
      signal?.addEventListener('abort', () => child.kill(), { once: true })
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new ProviderError(`Cannot start "${this.command}": ${e.message}. Is Claude Code installed and on PATH?`, 'not_found', { provider: this.kind }))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(out.trim())
        else reject(new ProviderError(`"${this.command}" exited with code ${code}: ${(err || out).trim().slice(0, 400)}`, 'unknown', { provider: this.kind }))
      })
      child.stdin.end(stdin)
    })
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent, void, void> {
    const acc = new ResponseAccumulator(req.model)
    const args = buildClaudeArgs(req)
    const child = spawn(this.command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    const onAbort = (): void => {
      child.kill()
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })

    let spawnError: Error | undefined
    child.on('error', (e) => {
      spawnError = e
    })
    const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)))
    child.stdin.on('error', () => undefined)
    child.stdin.end(renderTranscript(req.messages))

    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timer = setTimeout(() => child.kill(), timeoutMs)
    let buffer = ''
    let finalText: string | undefined
    let sawDelta = false
    const toolMode = Boolean(req.tools?.length)
    let isError = false
    let errorText = ''

    try {
      for await (const chunk of child.stdout) {
        buffer += chunk.toString('utf8')
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          let ev: any
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'stream_event') {
            const d = ev.event?.type === 'content_block_delta' ? ev.event.delta : undefined
            if (d?.type === 'text_delta' && typeof d.text === 'string') {
              sawDelta = true
              acc.text += d.text
              if (!toolMode) yield { type: 'text', delta: d.text }
            }
          } else if (ev.type === 'result') {
            isError = Boolean(ev.is_error)
            if (typeof ev.result === 'string') finalText = ev.result
            if (isError) errorText = String(ev.result ?? '')
            const u = ev.usage
            if (u) {
              acc.usage.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
              acc.usage.cachedInputTokens = u.cache_read_input_tokens
              acc.usage.outputTokens = u.output_tokens ?? 0
            }
            if (ev.stop_reason === 'max_tokens') acc.stopReason = 'max_tokens'
          } else if (ev.type === 'system' && typeof ev.model === 'string') {
            acc.setModel(ev.model)
          }
        }
      }
      const code = await exited
      if (spawnError) {
        throw new ProviderError(`Cannot start "${this.command}": ${spawnError.message}. Is Claude Code installed and on PATH?`, 'not_found', { provider: this.kind })
      }
      if (req.signal?.aborted) throw new ProviderError('Request aborted', 'cancelled', { provider: this.kind })
      if (isError || (code !== 0 && code !== null)) {
        throw new ProviderError(`Claude Code failed${code ? ` (exit ${code})` : ''}: ${(errorText || stderr).trim().slice(0, 400) || 'unknown error'}`, 'unknown', { provider: this.kind })
      }
      if (!sawDelta && finalText) acc.text = finalText
      if (toolMode) {
        // Tool requests arrive as a JSON block in the reply: turn them into real tool calls.
        const parsed = parseToolCalls(acc.text, `cc-${Date.now().toString(36)}`, req.tools)
        acc.text = parsed.text
        for (const call of parsed.calls) {
          acc.toolCalls.push(call)
          yield { type: 'tool_call', call }
        }
        if (acc.text) yield { type: 'text', delta: acc.text }
      } else if (!sawDelta && acc.text) {
        // If the CLI produced no partial deltas, emit the final text once so the caller still sees it.
        yield { type: 'text', delta: acc.text }
      }
      yield { type: 'done', response: acc.build() }
    } finally {
      clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
      if (child.exitCode === null) child.kill()
    }
  }
}
