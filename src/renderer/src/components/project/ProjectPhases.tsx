import { CheckCircle2, Circle, Loader2, Play, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type ReactElement } from 'react'
import type { Agent, Project, Run, Task } from '../../../../shared/ipc'
import { fmtUsd } from '../../lib/format'
import { devGoal, designPhase, devPhase, testPhase, type PhaseInfo, type PhaseState } from '../../lib/phases'
import { DEV_ROLES } from '../../../../shared/phases'
import { useStudio } from '../../store'
import { StartRunModal } from '../tasks/RunModals'
import { isActiveRun } from '../tasks/meta'
import { Badge, Button, Card, CardHeader } from '../ui'
import { useDocFiles } from './useDocFiles'

const ICON: Record<PhaseState, ReactElement> = {
  todo: <Circle size={16} className="text-faint" />,
  active: <Loader2 size={16} className="animate-spin text-info" />,
  done: <CheckCircle2 size={16} className="text-ok" />,
  attention: <TriangleAlert size={16} className="text-warn" />
}
const TONE = { todo: 'neutral', active: 'info', done: 'ok', attention: 'warn' } as const

function PhaseRow({ name, info, action }: { name: string; info: PhaseInfo; action?: ReactElement }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3" data-phase={name} data-phase-state={info.state}>
      {ICON[info.state]}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
          {name} <Badge tone={TONE[info.state]}>{info.label}</Badge>
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{info.detail}</span>
      </span>
      {action}
    </li>
  )
}

/** “Game Developer 2”, “Game Developer 3”… the first one that is not taken. */
const nextName = (label: string, taken: string[]): string => {
  let n = 2
  while (taken.includes(`${label} ${n}`)) n++
  return `${label} ${n}`
}

const AGENT_DOT: Record<Agent['status'], string> = { idle: 'bg-faint', working: 'bg-info', waiting: 'bg-warn', error: 'bg-err', disabled: 'bg-faint/50' }

/** Where the project is on its way (design → development) and who works on it. */
export function ProjectPhases({ project, runs, tasks, refreshKey }: { project: Project; runs: Run[]; tasks: Task[]; refreshKey: string }) {
  const agents = useStudio((s) => s.agents)
  const { files } = useDocFiles(project, refreshKey)
  const [starting, setStarting] = useState(false)
  const docs = files ?? []
  const design = designPhase(docs.map((f) => f.name), runs)
  const dev = devPhase(runs, tasks)
  const test = testPhase(runs, tasks)
  const busy = runs.some((r) => isActiveRun(r.status))
  const refresh = useStudio((s) => s.refresh)
  const team = useMemo(() => agents.filter((a) => a.projectId === project.id), [agents, project.id])
  const developers = team.filter((a) => a.enabled && a.issues.length === 0 && DEV_ROLES.includes(a.role))
  const [addError, setAddError] = useState<string | null>(null)

  /** A new developer on the same model as an existing one, so features can be built in parallel. */
  async function addDeveloper() {
    setAddError(null)
    const base = developers[0] ?? team.find((a) => DEV_ROLES.includes(a.role))
    try {
      await window.api.invoke('agents:create', {
        templateKey: base?.role ?? 'game_developer',
        projectId: project.id,
        name: nextName(base?.roleLabel ?? 'Game Developer', team.map((a) => a.name)),
        connectionId: base?.connectionId ?? null,
        model: base?.model ?? null
      })
      await refresh()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e))
    }
  }

  // Why the button is off, in words: a greyed-out button with no reason is the worst answer.
  const blocked = busy ? 'A run is in progress. Wait for it to finish or stop it first.' : design.state !== 'done' ? 'Write the design documents first: the developers build from them.' : null

  return (
    <>
      <Card>
        <CardHeader title="Phases" />
        <ul className="divide-y divide-line/60">
          <PhaseRow name="Design & documents" info={design} />
          <PhaseRow
            name="Development"
            info={dev}
            action={
              <Button size="sm" variant="primary" disabled={blocked !== null} title={blocked ?? undefined} onClick={() => setStarting(true)} data-action="start-development">
                <Play size={12} /> {dev.state === 'todo' ? 'Start development' : 'Run development again'}
              </Button>
            }
          />
          <PhaseRow name="Testing (QA)" info={test} />
        </ul>
        {blocked && <p className="border-t border-line/60 px-4 py-2 text-[11px] text-faint">{blocked}</p>}
      </Card>

      <Card>
        <CardHeader
          title={`Team (${team.length})`}
          action={
            <Button size="sm" onClick={() => void addDeveloper()} data-action="add-developer">
              + Add developer
            </Button>
          }
        />
        <p className="border-b border-line/60 px-4 py-2 text-[11px] text-muted" data-testid="developer-note">
          {developers.length === 0
            ? 'No developer can run yet: add one or fix the ones below.'
            : `${developers.length} developer${developers.length === 1 ? '' : 's'} can write code. You choose how many work at the same time when you start development: 1 builds the features one after another (no file conflicts), 2 or more builds them in parallel.`}
        </p>
        {addError && <p role="alert" className="border-b border-line/60 px-4 py-2 text-[11px] text-err">{addError}</p>}
        {team.length === 0 ? (
          <p className="p-4 text-xs text-muted">This project has no team yet. Add one on the AI Agents page (“Add the full team”).</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {team.map((a) => {
              const mine = tasks.filter((t) => t.assignedAgentId === a.id)
              const cost = mine.reduce((s, t) => s + t.costUsd, 0)
              return (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5" data-team-member={a.role}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${AGENT_DOT[a.status]}`} title={a.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{a.name}</span>
                    <span className="block truncate text-[11px] text-faint">
                      {a.roleLabel} · {a.status === 'idle' ? 'idle' : a.status}
                      {a.issues.length > 0 ? ` · cannot run: ${a.issues[0]}` : ''}
                    </span>
                  </span>
                  <span className="text-right text-[11px] text-muted">
                    {mine.filter((t) => t.status === 'done').length}/{mine.length} tasks
                    <span className="block font-mono">{fmtUsd(cost)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {starting && (
        <StartRunModal
          project={project}
          title="Start development"
          initialGoal={devGoal(docs.map((f) => f.path))}
          onClose={() => setStarting(false)}
          onStarted={() => setStarting(false)}
        />
      )}
    </>
  )
}
