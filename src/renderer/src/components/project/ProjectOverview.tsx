import { useMemo, useState } from 'react'
import type { Project, Run, Task } from '../../../../shared/ipc'
import { fmtTokens, fmtUsd, timeAgo } from '../../lib/format'
import { useStudio } from '../../store'
import { RunStatusBadge, TaskStatusBadge, isActiveRun } from '../tasks/meta'
import { Card, CardHeader, EmptyState, ProgressBar, StatCard } from '../ui'
import { ProjectPhases } from './ProjectPhases'

const firstLine = (s: string): string => s.trim().split('\n')[0].slice(0, 160)

/** Where the project stands: the latest run, every task with its status and cost, and what the whole project has cost so far. */
export function ProjectOverview({ project, onOpenDocs }: { project: Project; onOpenDocs: () => void }) {
  const { runs, tasks, openTask } = useStudio()
  const [showGoal, setShowGoal] = useState(false)
  const myRuns = useMemo(() => runs.filter((r) => r.projectId === project.id).sort((a, b) => b.createdAt - a.createdAt), [runs, project.id])
  const myTasks = useMemo(() => tasks.filter((t) => t.projectId === project.id).sort((a, b) => a.createdAt - b.createdAt), [tasks, project.id])
  const taskKey = myTasks.map((t) => `${t.id}:${t.status}:${t.updatedAt}`).join('|')
  const latest: Run | undefined = myRuns[0]
  const spent = myRuns.reduce((s, r) => s + r.spentUsd, 0)
  const unpriced = myRuns.reduce((s, r) => s + r.unpricedCalls, 0)
  const tokens = myTasks.reduce((s, t) => s + t.inputTokens + t.outputTokens, 0)
  const latestTasks = latest ? myTasks.filter((t) => t.runId === latest.id) : []
  const done = latestTasks.filter((t) => t.status === 'done').length

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Status" value={latest ? (isActiveRun(latest.status) ? 'Running' : latest.status === 'completed' ? 'Last run done' : latest.status) : 'No run yet'} sub={latest ? `Started ${timeAgo(latest.startedAt ?? latest.createdAt)}` : 'Start a run from the Tasks page'} />
        <StatCard label="Tasks" value={`${done}/${latestTasks.length}`} sub="done in the latest run" />
        <StatCard label="Spent so far" value={fmtUsd(spent)} sub={unpriced > 0 ? `at least: ${unpriced} calls had no price` : `${myRuns.length} run${myRuns.length === 1 ? '' : 's'}${project.budgetUsd !== null ? ` · budget ${fmtUsd(project.budgetUsd)}` : ''}`} />
        <StatCard label="Tokens" value={fmtTokens(tokens)} sub="input + output, all tasks" />
      </div>

      <ProjectPhases project={project} runs={myRuns} tasks={myTasks} refreshKey={taskKey} />

      <Card>
        <CardHeader title="Goal" />
        <div className="space-y-2 p-4">
          <p className={`whitespace-pre-wrap text-[13px] leading-relaxed text-muted ${showGoal ? '' : 'line-clamp-4'}`} data-selectable>
            {project.goal || 'No goal written.'}
          </p>
          {project.goal.length > 280 && (
            <button className="text-xs text-accent hover:underline" onClick={() => setShowGoal((v) => !v)}>
              {showGoal ? 'Show less' : 'Show all'}
            </button>
          )}
          <ProgressBar value={project.progress} />
          <p className="text-[11px] text-faint">{Math.round(project.progress * 100)}% of the tasks on the board are finished.</p>
        </div>
      </Card>

      {latest && (
        <Card>
          <CardHeader
            title="Latest run"
            action={
              <span className="flex items-center gap-2 text-xs text-muted">
                <RunStatusBadge status={latest.status} />
                {fmtUsd(latest.spentUsd)}
              </span>
            }
          />
          <div className="space-y-1 p-4 text-xs text-muted">
            {latest.error && (
              <div role="alert" className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-err">
                {latest.error}
              </div>
            )}
            <p data-selectable>{firstLine(latest.goal)}</p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Tasks (${myTasks.length})`}
          action={
            <button className="text-xs text-accent hover:underline" onClick={onOpenDocs}>
              Open documents
            </button>
          }
        />
        {myTasks.length === 0 ? (
          <EmptyState title="No tasks yet">Start a run and the Project Manager will split the goal into tasks.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/60">
            {myTasks.map((t: Task) => (
              <li key={t.id}>
                <button onClick={() => openTask(t)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elev/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{t.title}</span>
                    <span className="block truncate text-[11px] text-faint">
                      {t.assignedAgentName ?? t.role ?? 'unassigned'}
                      {t.attempts > 1 ? ` · ${t.attempts} attempts` : ''}
                      {t.error ? ` · ${firstLine(t.error)}` : ''}
                    </span>
                  </span>
                  <span className="w-14 text-right font-mono text-xs text-muted">{fmtUsd(t.costUsd)}</span>
                  <TaskStatusBadge status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
