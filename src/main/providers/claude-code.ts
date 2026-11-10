import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BaseChatProvider, ResponseAccumulator } from './base'
import { ProviderError } from './http'
import type { ChatMessage, ChatRequest, ConnectionStatus, ImagePart, ModelInfo, StreamEvent, ToolCall, ToolDefinition } from './types'

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

/**
 * `spawn('claude')` without a shell finds only `claude.exe`, and on Windows the installer often leaves that file outside PATH
 * (`~/.local/bin`) while PATH holds only npm's `claude.cmd` shim, which cannot be started without a shell. A shell is not an
 * option: the system prompt is passed as an argument and cmd.exe would mangle or interpret it. So look for the real .exe.
 * Anything other than the bare name `claude` (a full path the user typed) is used as is.
 */
export function resolveClaudeCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync
): string {
  if (platform !== 'win32' || command.toLowerCase() !== 'claude') return command
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)
  const home = env.USERPROFILE
  const candidates = [
    ...dirs.map((d) => join(d, 'claude.exe')),
    ...(home ? [join(home, '.local', 'bin', 'claude.exe')] : []),
    ...(env.APPDATA ? [join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')] : [])
  ]
  return candidates.find((c) => exists(c)) ?? command
}

/** Flatten a conversation into one prompt; the CLI takes a single prompt per call. */
export function renderTranscript(messages: ChatMessage[]): string {
  return renderWith(messages, () => '[image omitted]')
}

const IMAGE_MARK = '\u0001IMAGE\u0001'

/** True when any message carries a picture: the CLI then has to be fed structured input instead of plain text. */
export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image'))
}

export type InputBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/** The same transcript as renderTranscript, as content blocks with each picture where it appeared. */
export function renderTranscriptBlocks(messages: ChatMessage[]): InputBlock[] {
  const images = messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((p): p is ImagePart => p.type === 'image') : []))
  const text = renderWith(messages, () => IMAGE_MARK)
  const blocks: InputBlock[] = []
  const pieces = text.split(IMAGE_MARK)
  pieces.forEach((piece, i) => {
    if (piece) blocks.push({ type: 'text', text: piece })
    const img = images[i]
    if (i < pieces.length - 1 && img) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.dataBase64 } })
  })
  return blocks
}

/** One line of stream-json input: the whole conversation as a single user turn. */
export function renderStreamInput(messages: ChatMessage[]): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: renderTranscriptBlocks(messages) } })}\n`
}

function renderWith(messages: ChatMessage[], image: () => string): string {
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
      else if (p.type === 'image') parts.push(image())
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

/**
 * A long JSON block sometimes ends one or two closing brackets short. When that is the only problem (balanced outside strings,
 * nothing left open in a string), the missing closers are added; anything else is left alone and still fails to parse.
 */
export function closeMissingBrackets(raw: string): string {
  const stack: string[] = []
  let out = ''
  let inString = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (inString) {
      out += c
      if (c === '\\') out += raw[++i] ?? ''
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') {
      // A closer that does not match the innermost open bracket: the ones above its partner were forgotten, add them here.
      const at = stack.lastIndexOf(c)
      if (at < 0) return raw
      out += stack.splice(at).reverse().slice(0, -1).join('')
    }
    out += c
  }
  return inString ? raw : out + stack.reverse().join('')
}

export function parseToolCalls(text: string, idPrefix: string, tools?: ToolDefinition[]): { text: string; calls: ToolCall[] } {
  // The array may end in "}" when the model forgot the outer "]"; closeMissingBrackets repairs that below.
  const fenced = /```(?:tool_calls|json)?\s*\n?(\[[\s\S]*?[\]}])\s*```/.exec(text)
  // Models sometimes drop the opening or the closing fence around the array.
  const bare = /^\s*(?:```(?:tool_calls|json)?\s*)?(\[\s*\{[\s\S]*\}\s*\])\s*(?:```)?\s*$/.exec(text)
  const raw = fenced ? fenced[1] : bare?.[1]
  if (!raw) return parseInvokeBlocks(text, idPrefix, tools) ?? { text, calls: [] }
  let arr: unknown
  try {
    arr = JSON.parse(raw)
  } catch {
    try {
      arr = JSON.parse(closeMissingBrackets(raw))
    } catch {
      return { text, calls: [] }
    }
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
  // An empty array after a call written in the other format ("[]" as a self-correction) must not hide that call.
  if (!calls.length) return parseInvokeBlocks(text, idPrefix, tools) ?? { text, calls: [] }
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
  // Pictures cannot travel in the plain-text prompt: switch the CLI to structured input only when there is one.
  if (hasImages(req.messages)) args.push('--input-format', 'stream-json')
  if (req.model) args.push('--model', req.model)
  const system = [req.system, req.tools?.length ? toolInstructions(req.tools) : undefined].filter(Boolean).join('\n\n')
  if (system) args.push('--system-prompt', system)
  return args
}

export class ClaudeCodeProvider extends BaseChatProvider {
  readonly kind = 'claude-code' as const

  /** The base URL field holds the command to run (default: `claude`). A bare `claude` is resolved to the real executable on Windows. */
  private get command(): string {
    return resolveClaudeCommand(this.config.baseUrl || 'claude')
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
    child.stdin.end(hasImages(req.messages) ? renderStreamInput(req.messages) : renderTranscript(req.messages))

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
            // The CLI prices the call itself (API-equivalent; on a subscription plan nothing is billed per call).
            if (typeof ev.total_cost_usd === 'number' && Number.isFinite(ev.total_cost_usd) && ev.total_cost_usd >= 0) acc.usage.costUsd = ev.total_cost_usd
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
