import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { PROVIDER_CATALOG } from '../src/main/providers/catalog'
import { buildClaudeArgs, parseToolCalls, renderTranscript, setSpawnForTests, toolInstructions } from '../src/main/providers/claude-code'
import { createChatProvider } from '../src/main/providers'
import { Database } from '../src/main/db/database'
import { ConnectionService } from '../src/main/services/connections'
import { EventService } from '../src/main/services/events'
import { MemorySecrets } from './helpers/memory-secrets'
import type { ChatRequest, StreamEvent } from '../src/main/providers/types'

/** A fake `claude` process: writes the given stdout lines, then exits with `code`. */
function fakeSpawn(lines: string[], code = 0, capture?: { args?: string[]; stdin?: string; command?: string }) {
  return ((command: string, args: string[]) => {
    const child = new EventEmitter() as any
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdin = new PassThrough()
    child.exitCode = null
    child.kill = () => true
    if (capture) {
      capture.command = command
      capture.args = args
      let data = ''
      child.stdin.on('data', (d: Buffer) => (data += d.toString()))
      child.stdin.on('end', () => (capture.stdin = data))
    }
    setImmediate(() => {
      for (const l of lines) child.stdout.write(l + '\n')
      child.stdout.end()
      child.exitCode = code
      child.emit('close', code)
    })
    return child
  }) as any
}

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: 'sonnet',
  system: 'You are a tester',
  messages: [{ role: 'user', content: 'hello' }],
  ...over
})

const delta = (text: string): string =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

const result = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Hi there', usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4 }, ...over })

afterEach(() => setSpawnForTests(undefined))

describe('Claude Code provider', () => {
  it('is in the catalog and needs no API key', () => {
    const entry = PROVIDER_CATALOG['claude-code']
    expect(entry.requiresApiKey).toBe(false)
    expect(entry.protocol).toBe('claude-cli')
    const p = createChatProvider({ id: 'c1', kind: 'claude-code', baseUrl: '' })
    expect(p.kind).toBe('claude-code')
  })

  it('builds CLI arguments with all CLI tools disabled', () => {
    const args = buildClaudeArgs(req())
    expect(args).toContain('-p')
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'stream-json'])
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', ''])
    expect(args).toContain('--strict-mcp-config')
    expect(args.slice(args.indexOf('--mcp-config'), args.indexOf('--mcp-config') + 2)).toEqual(['--mcp-config', '{"mcpServers":{}}'])
    expect(args).toContain('--disable-slash-commands')
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'sonnet'])
    expect(args.slice(args.indexOf('--system-prompt'), args.indexOf('--system-prompt') + 2)).toEqual(['--system-prompt', 'You are a tester'])
  })

  it('sends a single user message as-is and labels longer conversations', () => {
    expect(renderTranscript([{ role: 'user', content: 'hello' }])).toBe('hello')
    const t = renderTranscript([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: [{ type: 'text', text: 'c' }, { type: 'image', mimeType: 'image/png', dataBase64: 'xx' }] }
    ])
    expect(t).toContain('User: a')
    expect(t).toContain('Assistant: b')
    expect(t).toContain('[image omitted]')
    expect(t.trim().endsWith('Assistant:')).toBe(true)
  })

  it('streams text deltas and a final response with usage', async () => {
    const capture: { args?: string[]; stdin?: string; command?: string } = {}
    setSpawnForTests(fakeSpawn([delta('Hi '), delta('there'), result()], 0, capture))
    const p = createChatProvider({ id: 'c1', kind: 'claude-code', baseUrl: 'claude' })
    const events: StreamEvent[] = []
    const res = await p.chat(req(), (e) => events.push(e))
    expect(events.filter((e) => e.type === 'text').map((e: any) => e.delta)).toEqual(['Hi ', 'there'])
    expect(res.text).toBe('Hi there')
    expect(res.usage).toEqual({ inputTokens: 14, cachedInputTokens: 4, outputTokens: 3 })
    expect(res.stopReason).toBe('end')
    expect(capture.command).toBe('claude')
    expect(capture.stdin).toBe('hello')
  })

  it('falls back to the final result text when the CLI sends no partial chunks', async () => {
    setSpawnForTests(fakeSpawn([result({ result: 'whole answer' })]))
    const p = createChatProvider({ id: 'c1', kind: 'claude-code', baseUrl: 'claude' })
    const res = await p.chat(req())
    expect(res.text).toBe('whole answer')
  })

  it('reports a failed run as an error', async () => {
    setSpawnForTests(fakeSpawn([result({ is_error: true, result: 'Not logged in' })], 1))
    const p = createChatProvider({ id: 'c1', kind: 'claude-code', baseUrl: 'claude' })
    await expect(p.chat(req())).rejects.toThrow(/Not logged in/)
  })

  it('lists the model aliases and tests the connection with --version', async () => {
    setSpawnForTests(fakeSpawn(['2.1.318 (Claude Code)']))
    const p = createChatProvider({ id: 'c1', kind: 'claude-code', baseUrl: 'claude' })
    expect((await p.listModels()).map((m) => m.id)).toEqual(['sonnet', 'opus', 'haiku'])
    const status = await p.testConnection()
    expect(status.ok).toBe(true)
  })
})

describe('Claude Code provider: tools through text', () => {
  const tools = [{ name: 'write_file', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } }]

  it('describes the tools and the reply format in the system prompt', () => {
    const text = toolInstructions(tools)
    expect(text).toContain('write_file')
    expect(text).toContain('```tool_calls')
    const args = buildClaudeArgs(req({ tools }))
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('You are a tester')
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('write_file')
  })

  it('parses a fenced tool_calls block into calls and keeps the other text', () => {
    const reply = ['Sure.', '```tool_calls', '[{"name":"write_file","arguments":{"path":"a.txt","content":"hi\\nthere"}},{"name":"list_files","arguments":{}}]', '```'].join('\n')
    const r = parseToolCalls(reply, 'x')
    expect(r.text).toBe('Sure.')
    expect(r.calls).toEqual([
      { id: 'x-0', name: 'write_file', arguments: { path: 'a.txt', content: 'hi\nthere' } },
      { id: 'x-1', name: 'list_files', arguments: {} }
    ])
  })

  it('leaves ordinary replies alone, including malformed blocks', () => {
    expect(parseToolCalls('All done.', 'x')).toEqual({ text: 'All done.', calls: [] })
    const bad = ['```tool_calls', '[{"name": }]', '```'].join('\n')
    expect(parseToolCalls(bad, 'x')).toEqual({ text: bad, calls: [] })
  })

  it('turns the block of a streamed reply into tool_call events and a tool_use stop', async () => {
    const block = ['```tool_calls', '[{"name":"write_file","arguments":{"path":"a.txt","content":"hi"}}]', '```'].join('\n')
    setSpawnForTests(fakeSpawn([delta(block.slice(0, 20)), delta(block.slice(20)), result({ result: block })]))
    const p = createChatProvider({ id: 'c1', kind: 'claude-code', baseUrl: 'claude' })
    const events: StreamEvent[] = []
    const res = await p.chat(req({ tools }), (e) => events.push(e))
    expect(res.stopReason).toBe('tool_use')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls[0]).toMatchObject({ name: 'write_file', arguments: { path: 'a.txt', content: 'hi' } })
    // The raw JSON block is never shown as text.
    expect(events.some((e) => e.type === 'text')).toBe(false)
    expect(events.some((e) => e.type === 'tool_call')).toBe(true)
  })

  it('shows tool calls and results to the model on the next turn', () => {
    const t = renderTranscript([
      { role: 'user', content: 'make a file' },
      { role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'write_file', arguments: { path: 'a.txt' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolCallId: 'c1', content: 'written' }] }
    ])
    expect(t).toContain('requested tool write_file [c1]')
    expect(t).toContain('tool result [c1]')
    expect(t).toContain('written')
  })
})

describe('Claude Code connection record', () => {
  const make = () => {
    const db = new Database(':memory:')
    db.migrate()
    return new ConnectionService(db, new EventService(db), new MemorySecrets())
  }

  it('accepts a command in the base URL field without an API key', async () => {
    const c = await make().create({ kind: 'claude-code', name: 'Claude Code', baseUrl: 'claude' })
    expect(c.baseUrl).toBe('claude')
    expect(c.hasKey).toBe(false)
  })

  it('defaults to the claude command and refuses several commands in one field', async () => {
    const svc = make()
    expect((await svc.create({ kind: 'claude-code', name: 'Default', baseUrl: '' })).baseUrl).toBe('claude')
    await expect(svc.create({ kind: 'claude-code', name: 'Bad', baseUrl: 'claude; calc' })).rejects.toThrow(/single program/)
  })
})

describe('parseToolCalls with sloppy fences', () => {
  it('accepts an array with only a closing fence, or only an opening one', () => {
    const arr = '[{"name":"read_file","arguments":{"path":"a.md"}}]'
    expect(parseToolCalls(`${arr}\n\`\`\``, 'x').calls).toHaveLength(1)
    expect(parseToolCalls(`\`\`\`tool_calls\n${arr}`, 'x').calls).toHaveLength(1)
    expect(parseToolCalls(arr, 'x').calls).toHaveLength(1)
  })

  it('parses a command with backslashes, brackets and quotes inside the JSON', () => {
    const cmd = "Select-String -Path a.cs -Pattern '^(public )?class \\w*(Player|Manager)\\w*' | ForEach-Object { $_.Line }"
    const block = ['```tool_calls', JSON.stringify([{ name: 'run_command', arguments: { command: cmd, timeout_seconds: 180 } }]), '```'].join('\n')
    const r = parseToolCalls(block, 'x')
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].arguments.command).toBe(cmd)
    expect(r.text).toBe('')
  })
})

describe('parseToolCalls with the XML form', () => {
  const defs = [{ name: 'write_file', description: '', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, count: { type: 'integer' } } } }]
  it('turns <invoke> blocks into calls, keeping strings raw and typing the rest by schema', () => {
    const text = 'Writing it now.\n<invoke name="write_file">\n<parameter name="path">docs/a.md</parameter>\n<parameter name="content"># T\n123</parameter>\n<parameter name="count">3</parameter>\n</invoke>'
    const r = parseToolCalls(text, 'x', defs)
    expect(r.calls).toEqual([{ id: 'x-0', name: 'write_file', arguments: { path: 'docs/a.md', content: '# T\n123', count: 3 } }])
    expect(r.text).toBe('Writing it now.')
  })

  it('handles a namespaced wrapper and leaves plain text alone', () => {
    const text = '<ns:function_calls><ns:invoke name="write_file"><ns:parameter name="path">a</ns:parameter></ns:invoke></ns:function_calls>'
    expect(parseToolCalls(text, 'x', defs).calls[0].arguments).toEqual({ path: 'a' })
    expect(parseToolCalls(text, 'x', defs).text).toBe('')
    expect(parseToolCalls('no tools here', 'x', defs)).toEqual({ text: 'no tools here', calls: [] })
  })
})
