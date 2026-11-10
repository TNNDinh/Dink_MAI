import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../src/main/db/database'
import { MIGRATIONS } from '../src/main/db/migrations'
import { AGENT_TEMPLATES } from '../src/main/agents/templates'
import { RESEARCH_TOOL_ROUNDS, MAX_TOOL_ROUNDS, environmentNote, toolRoundsFor } from '../src/main/orchestrator/orchestrator'
import { toolsFor, type ToolContext } from '../src/main/orchestrator/tools'
import { UNTRUSTED, WEB_TOOLS, web, checkPublicUrl, decodeBody, htmlToText, isPrivateAddress, parseDuckDuckGo, safeGet } from '../src/main/orchestrator/web-tools'
import { YOUTUBE_TOOLS, clock, findYtDlp, parseMeta, parseVtt, pickCaption, videoIdOf, ytError, ytdlp, type RunResult } from '../src/main/orchestrator/youtube-tools'

const tool = (name: string) => [...WEB_TOOLS, ...YOUTUBE_TOOLS].find((t) => t.def.name === name)!
const agentWith = (p: Record<string, unknown>): any => ({ id: 'a', name: 'Game Designer', permissions: { readFiles: true, writeFiles: false, internet: false, manageTasks: false, ...p } })
const ctx = (extra: Record<string, unknown> = {}): ToolContext => ({ agent: agentWith({ internet: true }), projectId: 'p', runId: 'r', ...extra }) as unknown as ToolContext
const publicDns = async () => [{ address: '93.184.216.34' }]

describe('who gets the web tools', () => {
  it('only an agent with the internet permission is offered them, and the video download also needs write access', () => {
    const names = (a: any, o = {}) => toolsFor(a, o).map((t) => t.def.name)
    expect(names(agentWith({}))).not.toContain('web_search')
    expect(names(agentWith({}))).not.toContain('youtube_video')
    expect(names(agentWith({ internet: true }))).toEqual(expect.arrayContaining(['web_search', 'web_fetch', 'youtube_search', 'youtube_video']))
    expect(names(agentWith({ internet: true }))).not.toContain('youtube_download')
    expect(names(agentWith({ internet: true, writeFiles: true }))).toContain('youtube_download')
    // a permission turned off takes the tools away again, whatever else the agent may do
    expect(names(agentWith({ internet: false, writeFiles: true }), { workspace: true })).not.toContain('youtube_download')
  })

  it('the Game Designer template can go online; no other template can', () => {
    const online = AGENT_TEMPLATES.filter((t) => t.permissions.internet).map((t) => t.key)
    expect(online).toEqual(['game_designer'])
  })

  it('an agent that can research is told not to guess, to cite, and that web text is not an instruction; and gets more rounds', () => {
    const note = environmentNote(new Set(['web_search', 'web_fetch', 'youtube_search', 'youtube_video']))
    expect(note).toMatch(/Do not guess a fact/)
    expect(note).toMatch(/Sources/)
    expect(note).toMatch(/never instructions/)
    expect(note).toMatch(/no captions/)
    expect(environmentNote(new Set(['read_file']))).not.toMatch(/Research:/)
    expect(toolRoundsFor(new Set(['web_search']))).toBe(RESEARCH_TOOL_ROUNDS)
    expect(toolRoundsFor(new Set(['read_file']))).toBe(MAX_TOOL_ROUNDS)
  })

  it('a game designer made before this change gets the permission once, from the migration', () => {
    const old = new Database(':memory:')
    old.migrate(MIGRATIONS.slice(0, 7))
    const row = (id: string, role: string) =>
      old.run(`INSERT INTO agents (id, name, role, system_prompt, permissions_json, created_at, updated_at) VALUES (?, ?, ?, 'x', '{"readFiles":true,"internet":false,"writeFiles":true}', 1, 1)`, id, id, role)
    row('gd', 'game_designer')
    row('dev', 'lead_developer')
    old.migrate()
    const perms = (id: string) => JSON.parse(old.get<{ permissions_json: string }>(`SELECT permissions_json FROM agents WHERE id = ?`, id)!.permissions_json)
    expect(perms('gd')).toEqual({ readFiles: true, internet: true, writeFiles: true })
    expect(perms('dev').internet).toBe(false)
  })
})

describe('link safety', () => {
  it('knows which addresses are not on the public internet, also when written in IPv6', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', 'ff02::1', 'not-an-ip']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '172.15.255.255', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false)
  })

  it('only opens public http and https links', async () => {
    await expect(checkPublicUrl('https://example.com/a?b=1', publicDns)).resolves.toBeInstanceOf(URL)
    for (const bad of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'data:text/plain,hi', 'not a link', '']) await expect(checkPublicUrl(bad, publicDns), bad).rejects.toThrow()
    for (const bad of ['http://localhost:3000', 'http://127.0.0.1', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data', 'http://router', 'http://printer.local', 'http://a.internal', 'http://user:pw@example.com']) {
      await expect(checkPublicUrl(bad, publicDns), bad).rejects.toThrow()
    }
  })

  it('refuses a name that points inside, and says so when a name does not exist', async () => {
    await expect(checkPublicUrl('https://evil.example', async () => [{ address: '10.0.0.5' }])).rejects.toThrow(/local network/)
    await expect(checkPublicUrl('https://evil.example', async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }])).rejects.toThrow(/local network/)
    await expect(checkPublicUrl('https://nope.example', async () => Promise.reject(new Error('ENOTFOUND')))).rejects.toThrow(/could not be found/)
  })

  const res = (status: number, body = '', headers: Record<string, string> = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers })

  it('checks every redirect, so a public page cannot send the agent to an internal one', async () => {
    const seen: string[] = []
    const fetchImpl = (async (u: string) => {
      seen.push(u)
      return res(302, '', { location: 'http://169.254.169.254/latest/meta-data' })
    }) as unknown as typeof fetch
    await expect(safeGet('https://example.com/start', { lookup: publicDns, fetchImpl })).rejects.toThrow(/local network/)
    expect(seen).toEqual(['https://example.com/start'])
  })

  it('follows a normal redirect, limits the size, and reports a refusing site plainly', async () => {
    const hops: string[] = []
    const ok = (async (u: string) => (hops.push(u), hops.length === 1 ? res(301, '', { location: '/final' }) : res(200, 'hello', { 'content-type': 'text/plain' }))) as unknown as typeof fetch
    const got = await safeGet('https://example.com/a', { lookup: publicDns, fetchImpl: ok })
    expect(got.url).toBe('https://example.com/final')
    expect(got.body.toString()).toBe('hello')

    const big = (async () => res(200, 'x'.repeat(5000), { 'content-type': 'text/plain' })) as unknown as typeof fetch
    await expect(safeGet('https://example.com', { lookup: publicDns, fetchImpl: big, maxBytes: 1000 })).rejects.toThrow(/limit/)

    const blocked = (async () => res(403, 'no')) as unknown as typeof fetch
    await expect(safeGet('https://example.com', { lookup: publicDns, fetchImpl: blocked })).rejects.toThrow(/HTTP 403/)

    const loop = (async () => res(302, '', { location: 'https://example.com/again' })) as unknown as typeof fetch
    await expect(safeGet('https://example.com', { lookup: publicDns, fetchImpl: loop })).rejects.toThrow(/redirects/)
  })

  it('stops at once when the run is stopped', async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(safeGet('https://example.com', { lookup: publicDns, signal: ctl.signal, fetchImpl: (async () => res(200, 'x')) as unknown as typeof fetch })).rejects.toThrow(/Stopped/)
  })
})

describe('reading pages and search results', () => {
  it('turns HTML into text: no scripts or styles, keeps headings and lists, decodes entities', () => {
    const { title, text } = htmlToText(
      '<html><head><title>Hades &amp; co</title><style>p{}</style></head><body><script>alert(1)</script><h2>Loop</h2><p>Run&nbsp;&amp; die.</p><ul><li>Boon</li><li>Weapon</li></ul><!-- hidden --><p>Caf&#233; &#x1F600;</p></body></html>'
    )
    expect(title).toBe('Hades & co')
    expect(text).toContain('## Loop')
    expect(text).toContain('Run & die.')
    expect(text).toContain('- Boon\n- Weapon')
    expect(text).toContain('Café 😀')
    expect(text).not.toMatch(/alert|hidden|p\{\}/)
  })

  it('uses the charset the server names', () => {
    expect(decodeBody(Buffer.from('Xin chào', 'utf8'), 'text/html; charset=utf-8')).toBe('Xin chào')
    expect(decodeBody(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'text/html; charset=iso-8859-1')).toBe('café')
    expect(decodeBody(Buffer.from('ok'), 'text/html; charset=nonsense-1')).toBe('ok')
  })

  const DDG = `<div class="result results_links web-result">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhades%2Dloop&amp;rut=abc">Hades &amp; the <b>loop</b></a></h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhades%2Dloop&amp;rut=abc">Every run gives <b>boons</b> and a reason to retry.</a></div>
  <div class="result result--ad"><a rel="nofollow" class="result__a" href="//duckduckgo.com/y.js?ad_domain=shop.example&amp;u3=x">Buy now</a></div>
  <div class="result"><a rel="nofollow" class="result__a" href="https://plain.example/page">No snippet here</a></div>
  <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fthird.example%2F&amp;rut=z">Third</a><a class="result__snippet" href="x">Third snippet</a></div>`

  it('reads search results, drops ads, and does not give a result the snippet of the next one', () => {
    const hits = parseDuckDuckGo(DDG)
    expect(hits).toEqual([
      { title: 'Hades & the loop', url: 'https://example.com/hades-loop', snippet: 'Every run gives boons and a reason to retry.' },
      { title: 'No snippet here', url: 'https://plain.example/page', snippet: '' },
      { title: 'Third', url: 'https://third.example/', snippet: 'Third snippet' }
    ])
    expect(parseDuckDuckGo('<html>nothing</html>')).toEqual([])
  })
})

describe('web tools, end to end with a stand-in network', () => {
  const realFetch = globalThis.fetch
  let calls: string[]
  const serve = (handler: (u: string) => Response): void => {
    globalThis.fetch = (async (u: any) => (calls.push(String(u)), handler(String(u)))) as typeof fetch
  }
  const realLookup = web.lookup
  beforeEach(() => {
    calls = []
    web.lookup = publicDns
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    web.lookup = realLookup
  })

  it('web_fetch marks the page as outside content and lets the agent read on in parts', async () => {
    // a name that resolves publicly is needed: use the real resolver on a literal public address
    const long = `<html><head><title>Doc</title></head><body><p>${'a'.repeat(30_000)}</p></body></html>`
    serve(() => new Response(long, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }))
    const first = await tool('web_fetch').execute(ctx(), { url: 'http://93.184.216.34/doc' })
    expect(first.startsWith(UNTRUSTED)).toBe(true)
    expect(first).toContain('Title: Doc')
    expect(first).toMatch(/Call web_fetch again with start=20000/)
    const second = await tool('web_fetch').execute(ctx(), { url: 'http://93.184.216.34/doc', start: 20_000 })
    expect(second).not.toMatch(/Call web_fetch again/)
    expect(await tool('web_fetch').execute(ctx(), { url: 'http://93.184.216.34/doc', start: 99_999 })).toMatch(/past the end/)
  })

  it('web_fetch refuses internal addresses and non-text files without making a request', async () => {
    serve(() => new Response('x'))
    await expect(tool('web_fetch').execute(ctx(), { url: 'http://127.0.0.1:8080/admin' })).rejects.toThrow(/local network/)
    await expect(tool('web_fetch').execute(ctx(), { url: 'file:///C:/Windows/win.ini' })).rejects.toThrow(/http/)
    expect(calls).toEqual([])
    serve(() => new Response('PK', { status: 200, headers: { 'content-type': 'application/zip' } }))
    await expect(tool('web_fetch').execute(ctx(), { url: 'http://93.184.216.34/a.zip' })).rejects.toThrow(/not a text page/)
  })

  it('web_search lists results, and says plainly when there are none or the engine blocks it', async () => {
    serve(() => new Response('<a rel="nofollow" class="result__a" href="https://x.example/p">X</a><a class="result__snippet" href="y">about x</a>', { status: 200, headers: { 'content-type': 'text/html' } }))
    // the search host must resolve to a public address; the real resolver is used for html.duckduckgo.com
    const out = await tool('web_search').execute(ctx(), { query: 'hades loop' })
    expect(out).toContain('1. X')
    expect(out).toContain('https://x.example/p')
    expect(calls[0]).toContain('html.duckduckgo.com/html/?q=hades%20loop')

    serve(() => new Response('<html>no results</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect(await tool('web_search').execute(ctx(), { query: 'zzzz' })).toMatch(/No results/)
    serve(() => new Response('<html><div class="anomaly-modal">Unfortunately, bots use DuckDuckGo too</div></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(tool('web_search').execute(ctx(), { query: 'zzzz' })).rejects.toThrow(/human check/)
    await expect(tool('web_search').execute(ctx(), { query: '  ' })).rejects.toThrow(/required/)
  })
})

describe('YouTube', () => {
  it('finds the video in the usual links and in nothing else', () => {
    const id = 'dQw4w9WgXcQ'
    for (const u of [`https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&t=30s&list=PL1`, `https://m.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?si=abc`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`, `https://www.youtube.com/live/${id}`, `https://music.youtube.com/watch?v=${id}`, id]) {
      expect(videoIdOf(u), u).toBe(id)
    }
    for (const u of ['https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/@channel', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch?v=--output=C:/x', 'file:///dQw4w9WgXcQ', '--version', '']) {
      expect(videoIdOf(u), u).toBeNull()
    }
  })

  it('finds yt-dlp from an explicit path, from PATH, then from the WinGet folder', () => {
    const has = (...ps: string[]) => (p: string) => ps.includes(p)
    expect(findYtDlp({ YT_DLP_PATH: 'C:\\x\\yt.exe' }, has('C:\\x\\yt.exe'))).toBe('C:\\x\\yt.exe')
    const dir = join('C:\\tools')
    expect(findYtDlp({ PATH: `C:\\a;${dir}` }, has(join(dir, 'yt-dlp.exe')), true)).toBe(join(dir, 'yt-dlp.exe'))
    expect(findYtDlp({ PATH: 'C:\\a', LOCALAPPDATA: 'C:\\L' }, has(join('C:\\L', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe')), true)).toBe(join('C:\\L', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'))
    expect(findYtDlp({ PATH: 'C:\\a' }, () => false, true)).toBeNull()
  })

  it('reads the fields it needs from yt-dlp and never invents the rest', () => {
    const m = parseMeta({ id: 'abc', title: 'T', channel: 'C', duration: 125, upload_date: '20240131', view_count: 1234, description: 'D', chapters: [{ start_time: 0, title: 'Intro' }, { title: 'bad' }], subtitles: { en: [], live_chat: [] }, automatic_captions: { 'en-orig': [], en: [] } })
    expect(m).toMatchObject({ title: 'T', channel: 'C', durationS: 125, published: '2024-01-31', views: 1234, chapters: [{ at: 0, title: 'Intro' }], manual: ['en'], auto: ['en-orig', 'en'] })
    expect(parseMeta(null)).toMatchObject({ title: '', durationS: null, published: '', views: null, chapters: [], manual: [], auto: [] })
    expect(clock(5)).toBe('0:05')
    expect(clock(3725)).toBe('1:02:05')
  })

  it('chooses captions: what was asked for, then people over machines, original language over a translation', () => {
    const v = (manual: string[], auto: string[]) => ({ manual, auto })
    expect(pickCaption(v(['en', 'vi'], ['en-orig']))).toEqual({ lang: 'vi', kind: 'manual' })
    expect(pickCaption(v(['en'], ['vi-orig']))).toEqual({ lang: 'en', kind: 'manual' })
    expect(pickCaption(v([], ['ja-orig', 'en', 'vi']))).toEqual({ lang: 'ja-orig', kind: 'automatic' })
    expect(pickCaption(v([], ['en', 'vi']))).toEqual({ lang: 'vi', kind: 'automatic' })
    expect(pickCaption(v([], ['en-orig', 'en']), 'en')).toEqual({ lang: 'en-orig', kind: 'automatic' })
    expect(pickCaption(v(['fr'], ['en-orig']), 'de')).toBeNull()
    expect(pickCaption(v([], []))).toBeNull()
  })

  it('turns a caption file into text with time marks, dropping the lines that scroll by twice', () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.320 --> 00:00:03.000 align:start position:0%
We're<00:00:01.000><c> no</c><00:00:02.000><c> strangers</c>

00:00:03.000 --> 00:00:03.010
We're no strangers

00:00:03.010 --> 00:00:06.000
We're no strangers
to love &amp; war

00:00:35.000 --> 00:00:38.000
Second paragraph
`
    expect(parseVtt(vtt)).toBe("[0:00] We're no strangers to love & war\n[0:35] Second paragraph")
    expect(parseVtt('WEBVTT\n')).toBe('')
  })

  it('puts the reason yt-dlp gave in plain words', () => {
    expect(ytError('ERROR: [youtube] abc: Sign in to confirm you’re not a bot')).toMatch(/bot check/)
    expect(ytError('ERROR: [youtube] abc: Private video. Sign in')).toMatch(/private/)
    expect(ytError('ERROR: [youtube] abc: Video unavailable')).toMatch(/unavailable/)
    expect(ytError('ERROR: Something odd happened')).toBe('Something odd happened')
    expect(ytError('')).toMatch(/without a message/)
  })

  describe('the tools with a stand-in for yt-dlp', () => {
    const real = { ...ytdlp }
    let runs: string[][]
    let script: (args: string[], cwd?: string) => Partial<RunResult> | Promise<Partial<RunResult>>
    beforeEach(() => {
      runs = []
      ytdlp.find = () => 'yt-dlp'
      ytdlp.run = (async (_bin: string, args: string[], opts: { cwd?: string }) => {
        runs.push(args)
        return { code: 0, stdout: '', stderr: '', timedOut: false, ...(await script(args, opts.cwd)) }
      }) as typeof ytdlp.run
    })
    afterEach(() => Object.assign(ytdlp, real))

    it('says how to install yt-dlp instead of guessing when it is missing', async () => {
      ytdlp.find = () => null
      await expect(tool('youtube_search').execute(ctx(), { query: 'hades' })).rejects.toThrow(/winget install yt-dlp/)
      await expect(tool('youtube_download').execute(ctx({ workspace: {} }), { url: 'dQw4w9WgXcQ' })).rejects.toThrow(/not installed/)
    })

    it('searches YouTube and lists what it found', async () => {
      script = () => ({
        stdout: [JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'Hades analysis', channel: 'GDP', duration: 373, view_count: 3880, description: 'How the loop motivates\nyou' }), 'garbage', JSON.stringify({ id: 'bad', title: 'x' })].join('\n')
      })
      const out = await tool('youtube_search').execute(ctx(), { query: 'hades loop', limit: 3 })
      expect(out).toContain('1. Hades analysis')
      expect(out).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      expect(out).toContain('GDP · 6:13 · 3,880 views')
      expect(out).not.toContain('garbage')
      expect(out.startsWith(UNTRUSTED)).toBe(true)
      expect(runs[0].at(-1)).toBe('ytsearch3:hades loop')
      script = () => ({ code: 1, stderr: 'ERROR: [youtube] x: HTTP Error 429: Too Many Requests' })
      await expect(tool('youtube_search').execute(ctx(), { query: 'hades' })).rejects.toThrow(/rate-limiting/)
      script = () => ({})
      expect(await tool('youtube_search').execute(ctx(), { query: 'hades' })).toMatch(/No videos found/)
    })

    const META = { id: 'dQw4w9WgXcQ', title: 'Hades talk', channel: 'GDC', duration: 600, upload_date: '20240101', description: 'Notes', chapters: [{ start_time: 0, title: 'Intro' }], subtitles: { en: [{}] }, automatic_captions: {} }

    it('reads a video: details, chapters and the transcript, and only ever passes the clean link to yt-dlp', async () => {
      script = (args, cwd) => {
        if (args.includes('--dump-single-json')) return { stdout: JSON.stringify(META) }
        writeFileSync(join(cwd!, 'dQw4w9WgXcQ.en.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nThe core loop is run, die, upgrade.\n')
        return {}
      }
      const out = await tool('youtube_video').execute(ctx(), { url: 'https://youtu.be/dQw4w9WgXcQ?si=--exec=calc' })
      expect(out.startsWith(UNTRUSTED)).toBe(true)
      expect(out).toContain('Title: Hades talk')
      expect(out).toContain('0:00 Intro')
      expect(out).toContain('Transcript (en, captions made by people)')
      expect(out).toContain('[0:01] The core loop is run, die, upgrade.')
      for (const a of runs) {
        expect(a.at(-1)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
        expect(a.at(-2)).toBe('--')
      }
      await expect(tool('youtube_video').execute(ctx(), { url: 'https://evil.example/watch?v=dQw4w9WgXcQ' })).rejects.toThrow(/not a YouTube video link/)
      expect(runs).toHaveLength(2)
    })

    it('says plainly that a video has no captions rather than letting the agent guess its content', async () => {
      script = (args) => (args.includes('--dump-single-json') ? { stdout: JSON.stringify({ ...META, subtitles: {}, automatic_captions: {} }) } : {})
      const out = await tool('youtube_video').execute(ctx(), { url: 'dQw4w9WgXcQ' })
      expect(out).toContain('Title: Hades talk')
      expect(out).toMatch(/No transcript: this video has no captions/)
      expect(out).toMatch(/Do not state what it says/)
      expect(runs).toHaveLength(1)
    })

    it('reports a failed transcript download and an unreadable video honestly', async () => {
      script = (args) => (args.includes('--dump-single-json') ? { stdout: JSON.stringify(META) } : { code: 1, stderr: 'ERROR: [youtube] x: HTTP Error 429: Too Many Requests' })
      expect(await tool('youtube_video').execute(ctx(), { url: 'dQw4w9WgXcQ' })).toMatch(/could not be downloaded: YouTube is rate-limiting/)
      script = () => ({ code: 1, stderr: 'ERROR: [youtube] x: Video unavailable' })
      await expect(tool('youtube_video').execute(ctx(), { url: 'dQw4w9WgXcQ' })).rejects.toThrow(/unavailable/)
    })

    describe('saving a video into the project', () => {
      let root: string
      const notified: any[] = []
      const events: any[] = []
      const workspaceCtx = () =>
        ctx({
          workspace: {
            sandbox: () => ({
              root,
              mkdir: async (rel: string) => (mkdirSync(join(root, rel), { recursive: true }), rel),
              resolve: (rel: string) => ({ rel, full: join(root, rel) })
            }),
            notify: (c: unknown) => notified.push(c)
          },
          events: { record: (e: unknown) => events.push(e) }
        })
      beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'yt-'))
        notified.length = 0
        events.length = 0
      })
      afterEach(() => rmSync(root, { recursive: true, force: true }))

      it('saves under docs/references/videos with the limits on, and tells the file tree', async () => {
        script = (args) => {
          const out = args[args.indexOf('-o') + 1].replace('%(id)s.%(ext)s', 'dQw4w9WgXcQ.mp4')
          writeFileSync(out, Buffer.alloc(2 * 1048576))
          writeFileSync(`${out}.part`, 'x')
          return {}
        }
        const out = await tool('youtube_download').execute(workspaceCtx(), { url: 'dQw4w9WgXcQ', quality: 4000 })
        expect(out).toContain('Saved docs/references/videos/dQw4w9WgXcQ.mp4 (2.0 MB)')
        expect(notified).toEqual([{ projectId: 'p', path: 'docs/references/videos/dQw4w9WgXcQ.mp4', kind: 'write', by: 'agent' }])
        const a = runs[0]
        expect(a).toContain('--no-playlist')
        expect(a[a.indexOf('--max-filesize') + 1]).toBe('300M')
        expect(a[a.indexOf('--match-filters') + 1]).toBe('duration<=3600')
        expect(a[a.indexOf('-f') + 1]).toContain('height<=1080')
        expect(a.at(-2)).toBe('--')
      })

      it('reports a video that was too long or big, or a failure, instead of pretending it saved', async () => {
        script = () => ({})
        await expect(tool('youtube_download').execute(workspaceCtx(), { url: 'dQw4w9WgXcQ' })).rejects.toThrow(/longer than 60 minutes or bigger than 300M/)
        script = () => ({ code: 1, stderr: 'ERROR: [youtube] x: Private video' })
        await expect(tool('youtube_download').execute(workspaceCtx(), { url: 'dQw4w9WgXcQ' })).rejects.toThrow(/private/)
        script = () => ({ timedOut: true, code: null })
        await expect(tool('youtube_download').execute(workspaceCtx(), { url: 'dQw4w9WgXcQ' })).rejects.toThrow(/10 minutes/)
        await expect(tool('youtube_download').execute(ctx(), { url: 'dQw4w9WgXcQ' })).rejects.toThrow(/no project folder/)
        expect(notified).toEqual([])
      })
    })
  })
})
