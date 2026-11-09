import { Fragment, useMemo } from 'react'
import { parseMarkdown, type Block, type Inline } from '../lib/markdown'

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        switch (p.kind) {
          case 'code':
            return (
              <code key={i} className="rounded bg-elev px-1 py-px font-mono text-[0.92em] text-fg">
                {p.text}
              </code>
            )
          case 'bold':
            return (
              <strong key={i} className="font-semibold text-fg">
                {p.text}
              </strong>
            )
          case 'em':
            return <em key={i}>{p.text}</em>
          case 'link':
            return (
              <span key={i} className="text-accent underline decoration-dotted" title={p.href}>
                {p.text}
              </span>
            )
          default:
            return <Fragment key={i}>{p.text}</Fragment>
        }
      })}
    </>
  )
}

const HEADING_CLASS = ['', 'mt-6 mb-3 text-xl font-semibold', 'mt-6 mb-2 border-b border-line pb-1 text-lg font-semibold', 'mt-5 mb-2 text-base font-semibold', 'mt-4 mb-1.5 text-sm font-semibold', 'mt-3 mb-1 text-sm font-medium', 'mt-3 mb-1 text-xs font-medium']

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1'
      return (
        <Tag className={`${HEADING_CLASS[block.level]} text-fg`}>
          <Inlines parts={block.inline} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="my-2 leading-relaxed">
          <Inlines parts={block.inline} />
        </p>
      )
    case 'code':
      return (
        <pre className="my-3 overflow-x-auto rounded-md border border-line bg-elev/60 p-3 font-mono text-xs leading-relaxed text-fg">
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote className="my-3 rounded-r-md border-l-2 border-accent/60 bg-elev/40 py-1.5 pl-3 pr-2 text-muted">
          <Inlines parts={block.inline} />
        </blockquote>
      )
    case 'rule':
      return <hr className="my-4 border-line" />
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag className={`my-2 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'} pl-5`}>
          {block.items.map((it, i) => (
            <li key={i} style={{ marginLeft: it.depth * 16 }} className="leading-relaxed">
              <Inlines parts={it.inline} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div className="my-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-elev/60 text-left text-muted">
              <tr>
                {block.header.map((h, i) => (
                  <th key={i} className="border-b border-line px-3 py-1.5 font-medium">
                    <Inlines parts={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-line/60 align-top">
                  {row.map((c, i) => (
                    <td key={i} className="px-3 py-1.5">
                      <Inlines parts={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/** Shows Markdown text as formatted content. Everything is built as React elements, never as raw HTML. */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className="text-[13px] text-muted" data-selectable>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  )
}
