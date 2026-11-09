import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '../src/renderer/src/lib/markdown'

describe('markdown reader for project docs', () => {
  it('reads headings, paragraphs and wraps lines of one paragraph together', () => {
    const b = parseMarkdown('# Tiêu đề\n\nDòng một\ndòng hai\n\n## Mục 2')
    expect(b.map((x) => x.kind)).toEqual(['heading', 'paragraph', 'heading'])
    expect(b[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(b[1]).toMatchObject({ kind: 'paragraph', inline: [{ kind: 'text', text: 'Dòng một dòng hai' }] })
  })

  it('reads a table with a | inside backticks kept in its cell', () => {
    const b = parseMarkdown('| Nhãn | Nghĩa |\n|---|---|\n| `[VERIFIED: a|b]` | Thấy ở ảnh |\n| x | y |\n\nSau bảng')
    expect(b[0].kind).toBe('table')
    if (b[0].kind !== 'table') return
    expect(b[0].header).toHaveLength(2)
    expect(b[0].rows).toHaveLength(2)
    expect(b[0].rows[0][0]).toEqual([{ kind: 'code', text: '[VERIFIED: a|b]' }])
    expect(b[1].kind).toBe('paragraph')
  })

  it('reads fenced code as it is, also when the closing fence is missing', () => {
    const closed = parseMarkdown('```text\nLaunch\n   -> Level 1\n```\nxong')
    expect(closed[0]).toEqual({ kind: 'code', lang: 'text', text: 'Launch\n   -> Level 1' })
    expect(closed[1].kind).toBe('paragraph')
    const open = parseMarkdown('```\nkhông đóng')
    expect(open).toEqual([{ kind: 'code', lang: '', text: 'không đóng' }])
  })

  it('reads lists with depth, ordered lists and wrapped item lines', () => {
    const b = parseMarkdown('- một\n  - con\n- hai\n  tiếp dòng\n\n1. a\n2. b')
    expect(b[0]).toMatchObject({ kind: 'list', ordered: false })
    if (b[0].kind !== 'list') return
    expect(b[0].items.map((i) => i.depth)).toEqual([0, 1, 0])
    expect(b[0].items[2].inline.map((p) => p.text).join('')).toBe('hai tiếp dòng')
    expect(b[1]).toMatchObject({ kind: 'list', ordered: true })
  })

  it('reads quotes and rules, and inline code, bold, italic and links', () => {
    const b = parseMarkdown('> **CẢNH BÁO:** chưa chơi\n\n---')
    expect(b.map((x) => x.kind)).toEqual(['quote', 'rule'])
    expect(parseInline('a `b` **c** *d* [e](http://x)').map((p) => p.kind)).toEqual(['text', 'code', 'text', 'bold', 'text', 'em', 'text', 'link'])
  })

  it('keeps markup in the text as text: nothing is turned into HTML', () => {
    const b = parseMarkdown('<script>alert(1)</script> and <img src=x onerror=alert(1)>')
    expect(b).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '<script>alert(1)</script> and <img src=x onerror=alert(1)>' }] }])
  })

  it('always finishes on odd input', () => {
    for (const s of ['', '|', '|\n|', '- ', '>', '```', '#', '***', '| a |\n|--|', '\t\t- x', '1) a\n  b\n```x']) expect(() => parseMarkdown(s)).not.toThrow()
  })
})
