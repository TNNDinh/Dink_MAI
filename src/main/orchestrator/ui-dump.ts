/**
 * `uiautomator dump` returns the whole Android view tree as XML: thousands of tokens per screen, mostly layout containers
 * that say nothing. An agent only needs what it can read or press. This keeps the nodes with a text, a description or a click
 * action and gives each one the point to tap, so a screen costs a few hundred tokens instead of several thousand.
 */
const MAX_NODES = 60

const unescapeXml = (s: string): string =>
  s
    .replace(/&#10;|&#xA;/gi, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2])
  return out
}

const shortClass = (c: string): string => c.split('.').pop() || c

export interface UiSummary {
  text: string
  /** Nodes in the dump / nodes kept. */
  total: number
  shown: number
}

/** Returns null when the text is not a view-tree dump (an error message, for example), so the caller can show it as it is. */
export function compactUiDump(raw: string): UiSummary | null {
  const tags = [...raw.matchAll(/<node\b[^>]*>/g)].map((m) => m[0])
  if (tags.length === 0) return null
  const lines: string[] = []
  const seen = new Set<string>()
  let screen = ''
  for (const tag of tags) {
    const a = attrs(tag)
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a.bounds ?? '')
    if (!b) continue
    const [l, t, r, bt] = [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])]
    if (!screen) screen = `${r}x${bt}`
    const text = (a.text ?? '').trim()
    const desc = (a['content-desc'] ?? '').trim()
    const clickable = a.clickable === 'true'
    if (!text && !desc && !clickable) continue
    if (r - l <= 0 || bt - t <= 0) continue
    const label = [text && `"${text.slice(0, 80)}"`, desc && desc !== text && `desc "${desc.slice(0, 80)}"`].filter(Boolean).join(' ')
    const id = (a['resource-id'] ?? '').split('/').pop()
    const line = `- ${label || '(no text)'}${id ? ` #${id}` : ''} [${shortClass(a.class ?? 'View')}${clickable ? ', clickable' : ''}] tap (${Math.round((l + r) / 2)},${Math.round((t + bt) / 2)})`
    if (seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  const shown = lines.slice(0, MAX_NODES)
  const head = `Screen ${screen || 'size unknown'}, ${tags.length} view nodes, ${lines.length} readable or clickable${lines.length > MAX_NODES ? ` (first ${MAX_NODES} shown)` : ''}.`
  const body = shown.length
    ? shown.join('\n')
    : 'No readable text or buttons: the game probably draws its own interface (OpenGL/Unity). Use action "screenshot" for people to review and tap by coordinates; say in your notes that this screen could not be read.'
  return { text: `${head}\n${body}`, total: tags.length, shown: shown.length }
}
