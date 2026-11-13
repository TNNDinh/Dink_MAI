import { mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Database } from '../src/main/db/database'
import { McpHttpServer, type McpTool } from '../src/main/mcp/server'
import { McpService } from '../src/main/mcp/service'
import { buildTools } from '../src/main/mcp/tools'
import { clickElement, typeInto, type UiBridge } from '../src/main/mcp/ui-driver'
import { MemorySecrets } from './helpers/memory-secrets'

const TOKEN = 'secret-token'

/** node:http directly, so the Host and Origin headers can be forged (fetch forbids that). */
function post(port: number, body: unknown, headers: Record<string, string> = {}, path = '/mcp', method = 'POST'): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body)
    const req = request({ host: '127.0.0.1', port, path, method, agent: false, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers } }, (res) => {
      let t = ''
      res.on('data', (c) => (t += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: t ? JSON.parse(t) : null }))
    })
    req.on('error', reject)
    req.end(data)
  })
}
const rpc = (port: number, method: string, params?: unknown, id: number | undefined = 1, headers?: Record<string, string>) => post(port, { jsonrpc: '2.0', id, method, params }, headers)

const echo: McpTool = {
  name: 'echo',
  description: 'echo',
  inputSchema: { type: 'object', properties: {} },
  run: (a) => ({ content: [{ type: 'text', text: JSON.stringify(a) }] })
}
const boom: McpTool = {
  name: 'boom',
  description: 'fails',
  inputSchema: { type: 'object', properties: {} },
  run: () => {
    throw new Error('it broke')
  }
}

describe('MCP HTTP server', () => {
  let server: McpHttpServer | null = null
  const start = async (token = TOKEN) => {
    server = new McpHttpServer({ tools: () => [echo, boom], token: () => token, name: 'studio', version: '1.2.3', instructions: 'hi' })
    return server.start(48800)
  }
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('answers initialize with the client protocol version and its tool capability', async () => {
    const port = await start()
    const r = await rpc(port, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    expect(r.status).toBe(200)
    expect(r.json.result.protocolVersion).toBe('2025-03-26')
    expect(r.json.result.capabilities.tools).toBeDefined()
    expect(r.json.result.serverInfo).toEqual({ name: 'studio', version: '1.2.3' })
    // An unknown version is answered with one we speak.
    const other = await rpc(port, 'initialize', { protocolVersion: '1999-01-01' })
    expect(other.json.result.protocolVersion).toBe('2025-06-18')
  })

  it('lists tools, runs them, and reports a failing tool as an error result (not a protocol error)', async () => {
    const port = await start()
    const list = await rpc(port, 'tools/list')
    expect(list.json.result.tools.map((t: { name: string }) => t.name)).toEqual(['echo', 'boom'])
    const ok = await rpc(port, 'tools/call', { name: 'echo', arguments: { a: 1 } })
    expect(ok.json.result.content[0].text).toBe('{"a":1}')
    const bad = await rpc(port, 'tools/call', { name: 'boom', arguments: {} })
    expect(bad.json.error).toBeUndefined()
    expect(bad.json.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'it broke' }] })
    const unknown = await rpc(port, 'tools/call', { name: 'nope' })
    expect(unknown.json.error.code).toBe(-32602)
    expect((await rpc(port, 'wat')).json.error.code).toBe(-32601)
  })

  it('accepts notifications with 202 and no body, and answers a batch', async () => {
    const port = await start()
    const note = await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(note.status).toBe(202)
    const batch = await post(port, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'ping' }])
    expect(batch.json.map((r: { id: number }) => r.id)).toEqual([1, 2])
  })

  it('rejects malformed input', async () => {
    const port = await start()
    expect((await post(port, '{nope')).json.error.code).toBe(-32700)
    expect((await post(port, { id: 1, method: 'ping' })).json.error.code).toBe(-32600)
    expect((await post(port, 'x'.repeat(1_100_000))).status).toBe(413)
  })

  it('needs the bearer token, and follows a rotated one', async () => {
    let token = TOKEN
    server = new McpHttpServer({ tools: () => [echo], token: () => token, name: 's', version: '1' })
    const port = await server.start(48820)
    expect((await rpc(port, 'ping', undefined, 1, { Authorization: '' })).status).toBe(401)
    expect((await rpc(port, 'ping', undefined, 1, { Authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await rpc(port, 'ping')).status).toBe(200)
    token = 'rotated'
    expect((await rpc(port, 'ping')).status).toBe(401)
    expect((await rpc(port, 'ping', undefined, 1, { Authorization: 'Bearer rotated' })).status).toBe(200)
  })

  it('refuses browser requests (Origin) and foreign Host headers even with a valid token', async () => {
    const port = await start()
    expect((await rpc(port, 'ping', undefined, 1, { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await rpc(port, 'ping', undefined, 1, { Host: 'evil.example' })).status).toBe(403)
    expect((await rpc(port, 'ping', undefined, 1, { Host: `localhost:${port}` })).status).toBe(200)
  })

  it('only serves POST /mcp', async () => {
    const port = await start()
    expect((await post(port, {}, {}, '/other')).status).toBe(404)
    expect((await post(port, '', {}, '/mcp', 'GET')).status).toBe(405)
  })

  it('moves to the next port when the preferred one is taken, and frees it on stop', async () => {
    const a = new McpHttpServer({ tools: () => [], token: () => TOKEN, name: 'a', version: '1' })
    const b = new McpHttpServer({ tools: () => [], token: () => TOKEN, name: 'b', version: '1' })
    const pa = await a.start(48840)
    const pb = await b.start(48840)
    expect(pb).toBe(pa + 1)
    await a.stop()
    expect(a.running).toBe(false)
    await b.stop()
  })
})

describe('MCP tools and service', () => {
  const setup = async (opts: { enabled?: boolean } = {}) => {
    const db = new Database(join(mkdtempSync(join(tmpdir(), 'mcp-')), 'studio.db'))
    db.migrate()
    const secrets = new MemorySecrets()
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const handlers = Object.fromEntries(['projects:list', 'term:run', 'approvals:respond', 'projects:update', 'fs:read', 'mcp:status'].map((channel) => [channel, (...args: unknown[]) => (calls.push({ channel, args }), { channel })]))
    const svc = new McpService(db, secrets, { version: '9', ui: () => null, port: 48860, forceEnabled: opts.enabled })
    svc.attach(handlers)
    await svc.init()
    return { svc, secrets, calls, db }
  }
  let svc: McpService | null = null
  afterEach(async () => {
    await svc?.stop()
    svc = null
  })

  it('stays off until switched on, remembers the choice, and keeps its token across restarts', async () => {
    const first = await setup()
    svc = first.svc
    expect(first.svc.status()).toMatchObject({ enabled: false, running: false, url: null, registerCommand: null })
    const token = first.svc.status().token
    expect(token.length).toBeGreaterThan(20)
    expect(first.secrets.data.get('mcp.token')).toBe(token)

    const on = await first.svc.setEnabled(true)
    expect(on.running).toBe(true)
    expect(on.url).toBe(`http://127.0.0.1:${on.port}/mcp`)
    expect(on.registerCommand).toContain(`Bearer ${token}`)
    expect(on.toolCount).toBeGreaterThan(20)
    await first.svc.stop()

    // A new service on the same database and secrets: still enabled, same token.
    const again = new McpService(first.db, first.secrets, { version: '9', ui: () => null, port: 48870 })
    again.attach({})
    await again.init()
    svc = again
    expect(again.status()).toMatchObject({ enabled: true, running: true, token })

    const off = await again.setEnabled(false)
    expect(off).toMatchObject({ enabled: false, running: false, port: null })
  })

  it('rotating the token cuts off the old one immediately', async () => {
    const { svc: s } = await setup({ enabled: true })
    svc = s
    const old = s.status().token
    const port = s.status().port!
    const call = (token: string) => post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${token}` })
    expect((await call(old)).status).toBe(200)
    const fresh = (await s.rotateToken()).token
    expect(fresh).not.toBe(old)
    expect((await call(old)).status).toBe(401)
    expect((await call(fresh)).status).toBe(200)
  })

  it('works for the session when the OS cannot store the token', async () => {
    const db = new Database(join(mkdtempSync(join(tmpdir(), 'mcp-')), 'studio.db'))
    db.migrate()
    const secrets = new MemorySecrets()
    secrets.failNextSet = true
    const s = new McpService(db, secrets, { version: '1', ui: () => null, port: 48880 })
    s.attach({})
    await s.init()
    expect(s.status().token.length).toBeGreaterThan(20)
    expect(secrets.data.size).toBe(0)
  })

  it('reports a busy port range instead of crashing', async () => {
    const blockers = Array.from({ length: 10 }, () => new McpHttpServer({ tools: () => [], token: () => 'x', name: 'b', version: '1' }))
    for (const b of blockers) await b.start(48890)
    const db = new Database(join(mkdtempSync(join(tmpdir(), 'mcp-')), 'studio.db'))
    db.migrate()
    const other = new McpService(db, new MemorySecrets(), { version: '1', ui: () => null, port: 48890, forceEnabled: true })
    other.attach({})
    await other.init()
    expect(other.status()).toMatchObject({ enabled: true, running: false, port: null, registerCommand: null })
    expect(other.status().error).toMatch(/EADDRINUSE|in use/i)
    for (const b of blockers) await b.stop()
  })

  it('app_call reaches handlers but never dialogs, terminal, approvals or its own controls', async () => {
    const { svc: s, calls } = await setup()
    svc = s
    expect(await s.call('projects:list', [])).toEqual({ channel: 'projects:list' })
    expect(s.channels()).toEqual(['fs:read', 'projects:list', 'projects:update'])
    await expect(s.call('term:run', [{ command: 'del /s *' }])).rejects.toThrow(/person at the keyboard/)
    await expect(s.call('approvals:respond', [{ id: 'x', allow: true }])).rejects.toThrow(/person at the keyboard/)
    await expect(s.call('mcp:status', [])).rejects.toThrow(/person at the keyboard/)
    await expect(s.call('projects:update', [{ id: 'p', bypassApprovals: true }])).rejects.toThrow(/bypass approvals/)
    expect(await s.call('projects:update', [{ id: 'p', name: 'x' }])).toEqual({ channel: 'projects:update' })
    expect(calls.map((c) => c.channel)).toEqual(['projects:list', 'projects:update'])
  })

  it('dedicated tools map their arguments onto the right channel', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const tools = buildTools({ call: async (channel, ...args) => (calls.push({ channel, args }), { ok: true }), channels: () => ['a'], ui: () => null })
    const run = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.run(args)
    await run('run_start', { projectId: 'p1', budgetUsd: 5, developers: 2 })
    await run('file_read', { projectId: 'p1', path: 'src/a.ts' })
    await run('app_call', { channel: 'checkpoints:create', args: [{ projectId: 'p1' }] })
    expect(calls[0]).toEqual({ channel: 'runs:start', args: [{ projectId: 'p1', goal: undefined, budgetUsd: 5, maxIterations: undefined, concurrency: undefined, developers: 2 }] })
    expect(calls[1]).toEqual({ channel: 'fs:read', args: [{ projectId: 'p1', path: 'src/a.ts' }] })
    expect(calls[2]).toEqual({ channel: 'checkpoints:create', args: [{ projectId: 'p1' }] })
    await expect(run('file_read', { projectId: 'p1' })).rejects.toThrow(/"path" is required/)
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length)
    for (const t of tools) expect(t.inputSchema.type).toBe('object')
  })

  it('ui tools say so when the window is not available', async () => {
    const tools = buildTools({ call: async () => null, channels: () => [], ui: () => null })
    await expect(tools.find((t) => t.name === 'ui_screenshot')!.run({})).rejects.toThrow(/window/)
  })
})

describe('window driver', () => {
  const fake = (locateResult: unknown) => {
    const log: string[] = []
    const ui: UiBridge = {
      capture: async () => ({ data: '', width: 1, height: 1 }),
      evaluate: async (code) => {
        log.push(`eval:${code.includes('__madsMcpEls') ? 'locate' : 'other'}`)
        return locateResult
      },
      click: async (x, y, o) => void log.push(`click:${x},${y}:${o.button}:${o.count}`),
      key: async (k, m) => void log.push(`key:${[...m, k].join('+')}`),
      insertText: async (t) => void log.push(`text:${t}`)
    }
    return { ui, log }
  }

  it('clicks where the page says the element is', async () => {
    const { ui, log } = fake({ x: 120, y: 44, tag: 'button', label: 'Settings' })
    const at = await clickElement(ui, { text: 'Settings' }, { double: true })
    expect(at.label).toBe('Settings')
    expect(log).toEqual(['eval:locate', 'click:120,44:left:2'])
  })

  it('surfaces the page\'s reason when nothing matches', async () => {
    const { ui, log } = fake({ error: 'Nothing clickable is labelled "Nope".' })
    await expect(clickElement(ui, { text: 'Nope' })).rejects.toThrow(/Nothing clickable/)
    expect(log).toEqual(['eval:locate'])
  })

  it('focuses the target, clears, types and submits in that order', async () => {
    const { ui, log } = fake({ x: 5, y: 6, tag: 'input', label: 'Search' })
    await typeInto(ui, 'hello', { selector: 'input' }, { clear: true, submit: true })
    expect(log).toEqual(['eval:locate', 'click:5,6:left:1', 'key:control+a', 'key:Backspace', 'text:hello', 'key:Enter'])
  })

  it('types into whatever has focus when there is no target', async () => {
    const { ui, log } = fake(null)
    await typeInto(ui, 'x', null)
    expect(log).toEqual(['text:x'])
  })
})
