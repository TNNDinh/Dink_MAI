import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { UNTRUSTED, clip, decodeBody, decodeEntities, note, safeGet } from './web-tools'
import type { AgentTool, ToolContext } from './tools'

/**
 * YouTube for agents that may go online: find videos, read what one says (title, chapters, description and its captions as
 * a timed transcript) and, for a writer, save a copy into the project. A text model cannot watch pictures or hear audio, so
 * "checking a video" means reading its transcript; the downloaded file is for the team to open. All of it goes through
 * yt-dlp when it is installed (it keeps up with YouTube's changes); without it the tools say so instead of guessing.
 */

const TRANSCRIPT_CHARS = 25_000
const DESCRIPTION_CHARS = 1_500
export const VIDEO_DIR = 'docs/references/videos'
const MAX_VIDEO = '300M'
const MAX_VIDEO_SECONDS = 3600
const INSTALL_HINT = 'yt-dlp is not installed on this computer, so this cannot be done. Install it (Windows: `winget install yt-dlp.yt-dlp`, then restart the app) or set YT_DLP_PATH. Meanwhile use web_search with `site:youtube.com` and web_fetch.'

// ── yt-dlp ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function findYtDlp(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, win = process.platform === 'win32'): string | null {
  if (env.YT_DLP_PATH && exists(env.YT_DLP_PATH)) return env.YT_DLP_PATH
  const name = win ? 'yt-dlp.exe' : 'yt-dlp'
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (dir && exists(join(dir, name))) return join(dir, name)
  }
  const links = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe') : ''
  return win && links && exists(links) ? links : null
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOpts {
  cwd?: string
  signal?: AbortSignal
  timeoutMs: number
}

/** Runs yt-dlp with an argument list (no shell, so nothing in an argument can become a command). Output is capped; the whole process tree is stopped on timeout or cancel. */
export function runYtDlp(bin: string, args: string[], opts: RunOpts): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('Stopped.'))
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const cap = 4_000_000
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (d: Buffer) => void (stdout.length < cap && (stdout += d.toString('utf8'))))
    child.stderr.on('data', (d: Buffer) => void (stderr.length < 200_000 && (stderr += d.toString('utf8'))))
    const stop = (): void => {
      if (child.pid === undefined) return
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      else child.kill('SIGKILL')
    }
    const timer = setTimeout(() => ((timedOut = true), stop()), opts.timeoutMs)
    const onAbort = (): void => stop()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const done = (): void => (clearTimeout(timer), opts.signal?.removeEventListener('abort', onAbort))
    child.on('error', (e) => (done(), reject(new Error(`yt-dlp could not start: ${e.message}`))))
    child.on('close', (code) => {
      done()
      if (opts.signal?.aborted) return reject(new Error('Stopped.'))
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/** What the tools call, so a test can stand in for the real program. */
export const ytdlp = { find: findYtDlp, run: runYtDlp }

/** The reason yt-dlp gave, in one line: its last ERROR line, with the few common causes made plain. */
export function ytError(stderr: string): string {
  const line = stderr.split(/\r?\n/).filter((l) => /^ERROR:/.test(l)).pop()?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?(\w[\w-]*:\s*)?/, '') ?? stderr.trim().split(/\r?\n/).pop() ?? ''
  if (/sign in to confirm|not a bot/i.test(line)) return 'YouTube asked for a sign-in or a bot check for this video, so it cannot be read from here.'
  if (/private video|members-only|join this channel/i.test(line)) return 'The video is private or for members only.'
  if (/unavailable|not available|removed|terminated/i.test(line)) return 'The video is unavailable (removed, blocked in this region, or the link is wrong).'
  if (/429|too many requests/i.test(line)) return 'YouTube is rate-limiting this computer. Try again in a few minutes.'
  return line ? line.slice(0, 300) : 'yt-dlp failed without a message.'
}

// ── links ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ID = /^[\w-]{11}$/
const HOSTS = /^(www\.|m\.|music\.)?(youtube\.com|youtube-nocookie\.com)$/

/** The 11-character video id in a YouTube link (watch, shorts, live, embed, youtu.be) or a bare id; null for anything else, including other sites and playlists-only links. */
export function videoIdOf(raw: string): string | null {
  const s = raw.trim()
  if (ID.test(s)) return s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null
  else if (HOSTS.test(host)) {
    const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(u.pathname)
    id = u.pathname === '/watch' ? u.searchParams.get('v') : (m?.[1] ?? null)
  }
  return id && ID.test(id) ? id : null
}

const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`

// ── what yt-dlp returns ──────────────────────────────────────────────────────────────────────────────────────────

export const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

export interface VideoMeta {
  id: string
  title: string
  channel: string
  durationS: number | null
  published: string
  views: number | null
  description: string
  chapters: Array<{ at: number; title: string }>
  manual: string[]
  auto: string[]
}

/** The fields of yt-dlp's `--dump-single-json` that the tools use. Anything missing becomes empty, never invented. */
export function parseMeta(json: unknown): VideoMeta {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, any>
  const date = typeof j.upload_date === 'string' && /^\d{8}$/.test(j.upload_date) ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6)}` : ''
  return {
    id: String(j.id ?? ''),
    title: String(j.title ?? ''),
    channel: String(j.channel ?? j.uploader ?? ''),
    durationS: typeof j.duration === 'number' ? j.duration : null,
    published: date,
    views: typeof j.view_count === 'number' ? j.view_count : null,
    description: String(j.description ?? ''),
    chapters: Array.isArray(j.chapters) ? j.chapters.filter((c: any) => typeof c?.start_time === 'number').map((c: any) => ({ at: c.start_time as number, title: String(c.title ?? '') })) : [],
    manual: j.subtitles && typeof j.subtitles === 'object' ? Object.keys(j.subtitles).filter((k) => k !== 'live_chat') : [],
    auto: j.automatic_captions && typeof j.automatic_captions === 'object' ? Object.keys(j.automatic_captions) : []
  }
}

export interface Caption {
  lang: string
  kind: 'manual' | 'automatic'
}

/**
 * Which captions to read. A language the caller asked for wins (the original-language automatic track is preferred over a machine translation);
 * otherwise a person-made track in Vietnamese or English, then any person-made track, then the automatic track in the video's own language.
 */
export function pickCaption(meta: Pick<VideoMeta, 'manual' | 'auto'>, want?: string): Caption | null {
  const { manual, auto } = meta
  if (want) {
    if (manual.includes(want)) return { lang: want, kind: 'manual' }
    if (auto.includes(`${want}-orig`)) return { lang: `${want}-orig`, kind: 'automatic' }
    if (auto.includes(want)) return { lang: want, kind: 'automatic' }
    return null
  }
  for (const l of ['vi', 'en']) if (manual.includes(l)) return { lang: l, kind: 'manual' }
  if (manual.length) return { lang: manual[0], kind: 'manual' }
  const orig = auto.find((k) => k.endsWith('-orig'))
  if (orig) return { lang: orig, kind: 'automatic' }
  for (const l of ['vi', 'en']) if (auto.includes(l)) return { lang: l, kind: 'automatic' }
  return null
}

/** A WebVTT caption file as readable text with a time mark about every 30 seconds. Automatic captions repeat each line as they scroll; the repeats are dropped. */
export function parseVtt(vtt: string): string {
  const out: string[] = []
  const recent: string[] = []
  let at = 0
  let marked = -999
  for (const raw of vtt.split(/\r?\n/)) {
    const t = /^(?:(\d+):)?(\d{2}):(\d{2})[.,]\d{3}\s+-->/.exec(raw)
    if (t) {
      at = Number(t[1] ?? 0) * 3600 + Number(t[2]) * 60 + Number(t[3])
      continue
    }
    if (/^(WEBVTT|Kind:|Language:|NOTE\b|STYLE\b)/.test(raw)) continue
    const line = decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (!line || recent.includes(line)) continue
    recent.push(line)
    if (recent.length > 4) recent.shift()
    if (at - marked >= 30) {
      out.push(`\n[${clock(at)}] `)
      marked = at
    }
    out.push(`${line} `)
  }
  return out.join('').replace(/ +\n/g, '\n').trim()
}

// ── the tools ────────────────────────────────────────────────────────────────────────────────────────────────────

const int = (v: unknown, def: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def)

const needVideo = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('url is required.')
  const id = videoIdOf(raw)
  if (!id) throw new Error('That is not a YouTube video link. Use a link like https://www.youtube.com/watch?v=VIDEO_ID, https://youtu.be/VIDEO_ID, or the 11-character video id (a playlist or channel link is not a video).')
  return id
}

const youtubeSearch: AgentTool = {
  def: {
    name: 'youtube_search',
    description: 'Search YouTube and get video titles, channels, lengths and links. Then read one with youtube_video (title, chapters, transcript). Use it to find gameplay breakdowns, postmortems, GDC talks or tutorials that show how something really works.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: 'How many videos, 1 to 10 (default 5).' } }, required: ['query'] }
  },
  allowed: (a) => a.permissions.internet,
  execute: async (ctx, args) => {
    const query = typeof args.query === 'string' ? args.query.replace(/\s+/g, ' ').trim() : ''
    if (!query) throw new Error('query is required.')
    if (query.length > 200) throw new Error('query is too long (max 200 characters).')
    const bin = ytdlp.find()
    if (!bin) throw new Error(INSTALL_HINT)
    const limit = int(args.limit, 5, 1, 10)
    note(ctx, `searched YouTube for “${query}”`)
    const r = await ytdlp.run(bin, ['--flat-playlist', '--dump-json', '--no-warnings', `ytsearch${limit}:${query}`], { signal: ctx.signal, timeoutMs: 60_000 })
    if (r.timedOut) throw new Error('The YouTube search took too long. Try again.')
    const videos: string[] = []
    for (const line of r.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue
      let j: Record<string, any>
      try {
        j = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof j.id !== 'string' || !ID.test(j.id)) continue
      const meta = [j.channel ?? j.uploader, typeof j.duration === 'number' ? clock(j.duration) : '', typeof j.view_count === 'number' ? `${j.view_count.toLocaleString('en-US')} views` : ''].filter(Boolean).join(' · ')
      const desc = typeof j.description === 'string' ? j.description.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
      videos.push(`${videos.length + 1}. ${String(j.title ?? '(no title)')}\n   ${watchUrl(j.id)}${meta ? `\n   ${meta}` : ''}${desc ? `\n   ${desc}` : ''}`)
    }
    if (!videos.length) {
      if (r.code) throw new Error(`YouTube search failed: ${ytError(r.stderr)}`)
      return `No videos found for “${query}”. Try other words.`
    }
    return `${UNTRUSTED}\nVideos for “${query}”:\n\n${videos.join('\n\n')}`
  }
}

const youtubeVideo: AgentTool = {
  def: {
    name: 'youtube_video',
    description: `Read what a YouTube video says: its title, channel, length, chapters, description and, when it has captions, a timed transcript (parts of ${TRANSCRIPT_CHARS} characters; pass start to continue). You read text, not the picture or sound, so use the transcript and chapters to check facts and quote the time mark ([m:ss]) when you cite it. If the video has no captions the result says so: do not guess what it contains.`,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A YouTube link or the 11-character video id.' },
        transcript: { type: 'boolean', description: 'Include the transcript (default true).' },
        lang: { type: 'string', description: 'Caption language code such as "en" or "vi". Default: Vietnamese or English if the video has them, otherwise its own language.' },
        start: { type: 'integer', description: 'Character offset in the transcript to continue from (default 0).' }
      },
      required: ['url']
    }
  },
  allowed: (a) => a.permissions.internet,
  execute: async (ctx, args) => {
    const id = needVideo(args.url)
    const url = watchUrl(id)
    const wantText = args.transcript !== false
    const lang = typeof args.lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(args.lang.trim()) ? args.lang.trim() : undefined
    const start = int(args.start, 0, 0, 10_000_000)
    note(ctx, `read YouTube video ${url}`)
    const bin = ytdlp.find()
    if (!bin) {
      // without yt-dlp only the public title and channel are available, and the text of the video is not
      const o = await safeGet(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: ctx.signal, timeoutMs: 15_000 }).catch(() => null)
      let title = ''
      let author = ''
      try {
        const j = JSON.parse(o ? decodeBody(o.body, o.contentType) : '{}') as { title?: string; author_name?: string }
        title = j.title ?? ''
        author = j.author_name ?? ''
      } catch {
        /* no metadata */
      }
      return `${UNTRUSTED}\nURL: ${url}${title ? `\nTitle: ${title}` : ''}${author ? `\nChannel: ${author}` : ''}\n\nThe transcript could not be read. ${INSTALL_HINT}`
    }
    const m = await ytdlp.run(bin, ['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--', url], { signal: ctx.signal, timeoutMs: 90_000 })
    if (m.timedOut) throw new Error('Reading the video took too long. Try again.')
    let meta: VideoMeta
    try {
      meta = parseMeta(JSON.parse(m.stdout))
    } catch {
      throw new Error(`Could not read the video: ${ytError(m.stderr)}`)
    }
    if (!meta.title) throw new Error(`Could not read the video: ${ytError(m.stderr)}`)

    const head = [
      `URL: ${url}`,
      `Title: ${meta.title}`,
      meta.channel && `Channel: ${meta.channel}`,
      meta.durationS !== null && `Length: ${clock(meta.durationS)}`,
      meta.published && `Published: ${meta.published}`,
      meta.views !== null && `Views: ${meta.views.toLocaleString('en-US')}`,
      meta.chapters.length && `Chapters:\n${meta.chapters.map((c) => `  ${clock(c.at)} ${c.title}`).join('\n')}`,
      meta.description.trim() && `Description:\n${clip(meta.description.trim(), DESCRIPTION_CHARS)}`
    ].filter(Boolean)
    const have = `Captions: ${meta.manual.length ? `made by people: ${meta.manual.slice(0, 12).join(', ')}` : 'none made by people'}; ${meta.auto.some((k) => k.endsWith('-orig')) ? `automatic: ${meta.auto.filter((k) => k.endsWith('-orig')).join(', ')}` : meta.auto.length ? 'automatic (machine) captions exist' : 'no automatic captions'}`
    head.push(have)
    if (!wantText) return `${UNTRUSTED}\n${head.join('\n')}`

    const pick = pickCaption(meta, lang)
    if (!pick) {
      return `${UNTRUSTED}\n${head.join('\n')}\n\nNo transcript: this video has no captions${lang ? ` in “${lang}”` : ''}, so what is said in it cannot be read. Do not state what it says; rely on the description and chapters above, or find a written source with web_search.`
    }
    const dir = mkdtempSync(join(tmpdir(), 'mads-yt-'))
    try {
      const t = await ytdlp.run(bin, ['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', pick.lang, '--sub-format', 'vtt', '--no-warnings', '--no-playlist', '--ignore-errors', '-o', '%(id)s.%(ext)s', '--', url], { cwd: dir, signal: ctx.signal, timeoutMs: 90_000 })
      const file = readdirSync(dir).find((f) => f.endsWith('.vtt'))
      if (!file) return `${UNTRUSTED}\n${head.join('\n')}\n\nThe transcript could not be downloaded${t.timedOut ? ' (timed out)' : `: ${ytError(t.stderr)}`}. Do not state what the video says.`
      const text = parseVtt(readFileSync(join(dir, file), 'utf8'))
      if (!text) return `${UNTRUSTED}\n${head.join('\n')}\n\nThe caption track is empty (for example only [Music]). Do not state what the video says.`
      const end = start + TRANSCRIPT_CHARS
      const part = text.slice(start, end)
      if (!part) return `${UNTRUSTED}\n${head.join('\n')}\n\nThe transcript is only ${text.length} characters long; start ${start} is past the end.`
      const more = end < text.length ? `\n[Part ${start}–${Math.min(end, text.length)} of ${text.length} characters. Call youtube_video again with start=${end} to continue.]` : ''
      return `${UNTRUSTED}\n${head.join('\n')}\n\nTranscript (${pick.lang}, ${pick.kind === 'manual' ? 'captions made by people' : 'automatic captions: names and numbers may be wrong'}):\n${part}${more}`
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const youtubeDownload: AgentTool = {
  def: {
    name: 'youtube_download',
    description: `Save a copy of a YouTube video into the project (${VIDEO_DIR}/) so the team can open and watch it. You cannot watch it yourself: to check what it says, use youtube_video for the transcript. Limits: videos up to ${MAX_VIDEO_SECONDS / 60} minutes and ${MAX_VIDEO}; default quality 480p.`,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A YouTube link or the 11-character video id.' },
        quality: { type: 'integer', description: 'Highest picture height to download: 144 to 1080 (default 480).' }
      },
      required: ['url']
    }
  },
  allowed: (a) => a.permissions.internet && a.permissions.writeFiles,
  execute: async (ctx: ToolContext, args) => {
    const id = needVideo(args.url)
    if (!ctx.workspace) throw new Error('There is no project folder to save into.')
    const bin = ytdlp.find()
    if (!bin) throw new Error(INSTALL_HINT)
    const h = int(args.quality, 480, 144, 1080)
    const sandbox = ctx.workspace.sandbox(ctx.projectId)
    const rel = await sandbox.mkdir(VIDEO_DIR)
    const dir = sandbox.resolve(rel).full
    note(ctx, `downloading YouTube video ${watchUrl(id)} (up to ${h}p)`)
    const r = await ytdlp.run(
      bin,
      ['--no-playlist', '--no-warnings', '--newline', '--max-filesize', MAX_VIDEO, '--match-filters', `duration<=${MAX_VIDEO_SECONDS}`, '-f', `b[height<=${h}][ext=mp4]/bv*[height<=${h}]+ba/b[height<=${h}]`, '--merge-output-format', 'mp4', '--windows-filenames', '-o', join(dir, '%(id)s.%(ext)s'), '--', watchUrl(id)],
      { signal: ctx.signal, timeoutMs: 600_000 }
    )
    const file = readdirSync(dir)
      .filter((f) => f.startsWith(`${id}.`) && !/\.(part|ytdl|temp)$/.test(f))
      .map((f) => ({ f, size: statSync(join(dir, f)).size }))
      .sort((a, b) => b.size - a.size)[0]
    if (!file) {
      if (r.timedOut) throw new Error('The download took longer than 10 minutes and was stopped.')
      if (r.code) throw new Error(`The video was not downloaded: ${ytError(r.stderr)}`)
      throw new Error(`The video was not downloaded: it is longer than ${MAX_VIDEO_SECONDS / 60} minutes or bigger than ${MAX_VIDEO}.`)
    }
    const path = relative(sandbox.root, join(dir, file.f)).split('\\').join('/')
    ctx.workspace.notify({ projectId: ctx.projectId, path, kind: 'write', by: 'agent' })
    ctx.events?.record({ projectId: ctx.projectId, runId: ctx.runId, agentId: ctx.agent.id, type: 'web.download', message: `${ctx.agent.name} saved ${path} (${(file.size / 1048576).toFixed(1)} MB)` })
    return `Saved ${path} (${(file.size / 1048576).toFixed(1)} MB). You cannot watch it: use youtube_video to read its transcript, and tell the team where the file is.${r.code ? ` yt-dlp exited with code ${r.code}: ${ytError(r.stderr)} Check that the file opens.` : ''}`
  }
}

export const YOUTUBE_TOOLS: AgentTool[] = [youtubeSearch, youtubeVideo, youtubeDownload]
