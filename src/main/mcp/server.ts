import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * A small Model Context Protocol server (Streamable HTTP transport, JSON responses) that lives inside the app,
 * so an AI client such as Claude Code can drive the Studio through typed tools instead of a screen-controlling desktop MCP.
 *
 * Only the pieces tools need are implemented: initialize, ping, tools/list, tools/call. No SSE stream, no sessions.
 * It listens on loopback only and every request needs the bearer token.
 */

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

export interface McpTool {
  name: string
  description: string
  /** JSON Schema of the arguments (an object schema). */
  inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<McpToolResult> | McpToolResult
}

export interface McpServerOptions {
  tools: () => McpTool[]
  /** The current token; read on every request so rotating it takes effect immediately. */
  token: () => string
  name: string
  version: string
  instructions?: string
}

export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 1_000_000

interface RpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: unknown
}

const rpcError = (id: RpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const rpcResult = (id: RpcMessage['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })

const digest = (s: string): Buffer => createHash('sha256').update(s).digest()

export class McpHttpServer {
  private server: Server | null = null
  private boundPort: number | null = null

  constructor(private readonly opts: McpServerOptions) {}

  get port(): number | null {
    return this.boundPort
  }

  get running(): boolean {
    return this.server !== null
  }

  /** Binds 127.0.0.1 on the preferred port, or the next free one (up to 9 higher). Resolves with the port. */
  async start(preferredPort: number): Promise<number> {
    if (this.server) return this.boundPort!
    let lastError: unknown
    for (let port = preferredPort; port < preferredPort + 10; port++) {
      try {
        await this.listen(port)
        return port
      } catch (e) {
        lastError = e
        if ((e as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') break
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Could not open a local port for the MCP server.')
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      })
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        this.server = server
        this.boundPort = (server.address() as { port: number }).port
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.boundPort = null
    if (!s) return
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  }

  private send(res: ServerResponse, status: number, body?: unknown, extra: Record<string, string> = {}): void {
    const payload = body === undefined ? '' : JSON.stringify(body)
    res.writeHead(status, { ...(payload ? { 'Content-Type': 'application/json' } : {}), 'Cache-Control': 'no-store', ...extra })
    res.end(payload)
  }

  private authorized(req: IncomingMessage): boolean {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
    return m !== null && timingSafeEqual(digest(m[1].trim()), digest(this.opts.token()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // DNS-rebinding guard: a web page cannot make a browser send a loopback Host that is not ours, nor omit Origin.
    const host = (req.headers.host ?? '').toLowerCase()
    const port = this.boundPort
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && host !== `[::1]:${port}`) return this.send(res, 403, { error: 'Bad host.' })
    if (req.headers.origin) return this.send(res, 403, { error: 'Browser requests are not allowed.' })
    if (!this.authorized(req)) return this.send(res, 401, { error: 'Missing or wrong token.' }, { 'WWW-Authenticate': 'Bearer' })

    const path = (req.url ?? '').split('?')[0]
    if (path !== '/mcp') return this.send(res, 404, { error: 'Use /mcp.' })
    if (req.method === 'DELETE') return this.send(res, 200, {}) // there are no sessions to end
    if (req.method !== 'POST') return this.send(res, 405, { error: 'POST only.' }, { Allow: 'POST' })

    const raw = await readBody(req)
    if (raw === null) return this.send(res, 413, rpcError(null, -32600, 'Request too large.'))
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return this.send(res, 400, rpcError(null, -32700, 'Parse error.'))
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return this.send(res, 400, rpcError(null, -32600, 'Empty batch.'))
      const out = (await Promise.all(parsed.map((m) => this.dispatch(m as RpcMessage)))).filter((r) => r !== null)
      return out.length ? this.send(res, 200, out) : this.send(res, 202)
    }
    const reply = await this.dispatch(parsed as RpcMessage)
    return reply === null ? this.send(res, 202) : this.send(res, 200, reply)
  }

  /** Returns the JSON-RPC reply, or null for notifications and client replies (which need none). */
  private async dispatch(msg: RpcMessage): Promise<unknown | null> {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid request.')
    if (typeof msg.method !== 'string') return null // a response to something we never asked
    const isRequest = msg.id !== undefined && msg.id !== null
    if (!isRequest) return null // notifications/initialized, notifications/cancelled, ...
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>

    switch (msg.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        return rpcResult(msg.id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.opts.name, version: this.opts.version },
          ...(this.opts.instructions ? { instructions: this.opts.instructions } : {})
        })
      }
      case 'ping':
        return rpcResult(msg.id, {})
      case 'tools/list':
        return rpcResult(msg.id, { tools: this.opts.tools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
      case 'tools/call': {
        const tool = this.opts.tools().find((t) => t.name === params.name)
        if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(params.name)}`)
        const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {}
        try {
          return rpcResult(msg.id, await tool.run(args))
        } catch (e) {
          // Tool failures are results the model can read and act on, not protocol errors.
          return rpcResult(msg.id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
        }
      }
      default:
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  }
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    // Past the limit the rest is read and thrown away, so the client gets its 413 instead of a reset connection.
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size <= MAX_BODY) chunks.push(c)
    })
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
