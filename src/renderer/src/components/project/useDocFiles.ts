import { useCallback, useEffect, useState } from 'react'
import type { FileEntry, Project } from '../../../../shared/ipc'

const isDoc = (e: FileEntry): boolean => e.type === 'file' && /\.(md|markdown|txt)$/i.test(e.name)

/** Markdown/text files in the project's `docs/` and root folders, newest first. `null` while the first listing is loading. */
export function useDocFiles(project: Project, refreshKey: string): { files: FileEntry[] | null; reload: () => Promise<FileEntry[]> } {
  const [files, setFiles] = useState<FileEntry[] | null>(null)

  const reload = useCallback(async () => {
    const found: FileEntry[] = []
    for (const dir of ['docs', '']) {
      try {
        const listing = await window.api.invoke('fs:list', { projectId: project.id, path: dir || undefined })
        found.push(...listing.entries.filter(isDoc))
      } catch {
        // No docs folder yet: that is a normal state, not an error.
      }
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs)
    setFiles(found)
    return found
  }, [project.id])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  return { files, reload }
}
