import { FileText, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Project } from '../../../../shared/ipc'
import { fmtBytes, timeAgo } from '../../lib/format'
import { Markdown } from '../Markdown'
import { Button, Card, EmptyState } from '../ui'
import { useDocFiles } from './useDocFiles'

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The project's written documents: Markdown files in `docs/` and in the project root, newest first. */
export function ProjectDocs({ project, refreshKey, initial }: { project: Project; refreshKey: string; initial?: string | null }) {
  const { files, reload } = useDocFiles(project, refreshKey)
  const [selected, setSelected] = useState<string | null>(initial ?? null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep the selection valid when the list changes; prefer the main design document.
  useEffect(() => {
    if (!files) return
    setSelected((cur) => (cur && files.some((f) => f.path === cur) ? cur : (files.find((f) => /GAME_DESIGN|README/i.test(f.name)) ?? files[0])?.path ?? null))
  }, [files])

  useEffect(() => {
    if (!selected) {
      setContent(null)
      return
    }
    let cancelled = false
    setError(null)
    window.api.invoke('fs:read', { projectId: project.id, path: selected }).then(
      (r) => !cancelled && setContent(r.content),
      (e) => {
        if (cancelled) return
        setContent(null)
        setError(errMsg(e))
      }
    )
    return () => {
      cancelled = true
    }
  }, [project.id, selected, refreshKey])

  if (files === null) return <p className="p-4 text-xs text-muted">Loading…</p>
  if (files.length === 0)
    return (
      <Card>
        <EmptyState icon={<FileText size={18} />} title="No documents yet">
          Documents the agents write into <span className="font-mono">docs/</span> (design doc, notes, plans) show up here as soon as they exist.
        </EmptyState>
      </Card>
    )

  const current = files.find((f) => f.path === selected)
  return (
    <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
      <Card className="self-start">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-medium text-fg">{files.length} documents</span>
          <Button size="sm" variant="ghost" onClick={() => void reload()} title="Reload the list">
            <RefreshCw size={12} />
          </Button>
        </div>
        <ul className="max-h-[70vh] overflow-y-auto p-1">
          {files.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => setSelected(f.path)}
                data-doc={f.path}
                className={`w-full rounded-md px-2.5 py-1.5 text-left ${f.path === selected ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-elev hover:text-fg'}`}
              >
                <span className="block truncate text-xs font-medium">{f.name}</span>
                <span className="block text-[11px] text-faint">
                  {f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : 'project root'} · {fmtBytes(f.size)} · {timeAgo(f.mtimeMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <div className="border-b border-line px-4 py-2 text-xs text-muted">
          <span className="font-mono text-fg">{current?.path ?? selected}</span>
        </div>
        <div className="p-5">
          {error && (
            <div role="alert" className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-xs text-err">
              {error}
            </div>
          )}
          {content !== null && (/\.txt$/i.test(selected ?? '') ? <pre className="whitespace-pre-wrap text-xs text-muted">{content}</pre> : <Markdown source={content} />)}
        </div>
      </Card>
    </div>
  )
}
