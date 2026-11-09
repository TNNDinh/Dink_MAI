/**
 * A small Markdown reader for the project docs the agents write. It turns text into plain data (blocks and inline pieces) and never into HTML,
 * so a doc cannot inject markup into the app. Supported: headings, paragraphs, fenced code, flat and indented lists, tables, quotes, rules,
 * and inline code, bold, italic and links (links are shown, not followed).
 */
export type Inline = { kind: 'text' | 'code' | 'bold' | 'em' | 'link'; text: string; href?: string }

export type Block =
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ depth: number; inline: Inline[] }> }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'rule' }

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: src.slice(last, at) })
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] })
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ kind: 'bold', text: m[2] ?? m[3] })
    else if (m[4] !== undefined) out.push({ kind: 'em', text: m[4] })
    else out.push({ kind: 'link', text: m[5], href: m[6] })
    last = at + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  return out
}

const isTableRule = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-')

/** Cells of one table row. A `|` inside backticks stays in its cell. */
function cells(line: string): string[] {
  const parts: string[] = []
  let cur = ''
  let inCode = false
  for (const c of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (c === '`') inCode = !inCode
    if (c === '|' && !inCode) {
      parts.push(cur.trim())
      cur = ''
    } else cur += c
  }
  parts.push(cur.trim())
  return parts
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++ // the closing fence (or the end of the file when it is missing)
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, inline: parseInline(heading[2]) })
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const header = cells(line).map(parseInline)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]).map(parseInline))
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push({ kind: 'quote', inline: parseInline(quoted.join(' ').trim()) })
      continue
    }
    const first = LIST_ITEM.exec(line)
    if (first) {
      const items: Array<{ depth: number; inline: Inline[] }> = []
      const ordered = /\d/.test(first[2])
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i])
        if (m) {
          items.push({ depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), inline: parseInline(m[3]) })
          i++
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          // A wrapped line of the previous item.
          const prev = items[items.length - 1]
          prev.inline = [...prev.inline, ...parseInline(` ${lines[i].trim()}`)]
          i++
        } else break
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|`{3,}|~{3,}|>)/.test(lines[i]) && !LIST_ITEM.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1]))) para.push(lines[i++].trim())
    if (!para.length) para.push(lines[i++].trim()) // never stall on a line no rule wants
    blocks.push({ kind: 'paragraph', inline: parseInline(para.join(' ')) })
  }
  return blocks
}
