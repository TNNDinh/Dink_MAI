import type { Run, Task } from '../../../shared/ipc'
import { DEV_GOAL_PREFIX, DEV_ROLES, QA_ROLE, isDevGoal } from '../../../shared/phases'

export { DEV_GOAL_PREFIX }

export const isDevRun = (r: Pick<Run, 'goal'>): boolean => isDevGoal(r.goal)

/** The goal given to the Project Manager when development starts: the written documents are the specification. */
export function devGoal(docPaths: string[]): string {
  const list = docPaths.length ? docPaths.map((p) => `- ${p}`).join('\n') : '- (no documents found)'
  return `${DEV_GOAL_PREFIX} build the project from its design documents.

The documents are the specification. Read them first:
${list}

Process (the team works like this):
1. Split the work into features. One task per feature, each with its own acceptance criteria. Developers build different features, as many at a time as the user assigned for this run.
2. One integration task after all the features makes everything build and run together, then a code review if the team has a reviewer.
3. The tester starts only when all the development is finished: it runs the real result, and sends every problem back to the developer who owns it. Work goes back and forth until the tester signs off.

Rules:
- Trust what the documents mark as verified (seen on screen, read from files). Treat anything marked inferred, guessed or unverified as a hypothesis: check it against the real files or by running the program, and say so when it was wrong.
- Write real, working code. No stubs, no placeholder logic, no fake data standing in for the real thing.
- Build or compile what you write and run it to check it works. Report what you ran and what you saw.
- Do not rewrite the design documents. Record every mistake or gap you find in docs/dev-notes.md.`
}

export type PhaseState = 'todo' | 'active' | 'done' | 'attention'

export interface PhaseInfo {
  state: PhaseState
  label: string
  detail: string
}

/** Design phase: finished when the main design document exists. Only the files and the runs decide, nothing is guessed. */
export function designPhase(docNames: string[], runs: Run[]): PhaseInfo {
  const hasDesign = docNames.some((n) => /GAME_DESIGN|DESIGN/i.test(n))
  const designRuns = runs.filter((r) => !isDevRun(r))
  if (designRuns.some((r) => r.status === 'running' || r.status === 'pending')) return { state: 'active', label: 'In progress', detail: 'The team is working on it now.' }
  if (hasDesign) return { state: 'done', label: 'Done', detail: `${docNames.length} document${docNames.length === 1 ? '' : 's'} written.` }
  if (designRuns.length > 0) return { state: 'attention', label: 'No design document yet', detail: 'A run happened but no GAME_DESIGN document exists. Check the run.' }
  return { state: 'todo', label: 'Not started', detail: 'Start a run from the Tasks page.' }
}

const inRun = (tasks: Task[], run: Run, roles: (role: string | null) => boolean): Task[] => tasks.filter((t) => t.runId === run.id && roles(t.role))
const isDevRole = (r: string | null): boolean => r !== null && DEV_ROLES.includes(r)
const isQaRole = (r: string | null): boolean => r === QA_ROLE

const latestDev = (runs: Run[]): Run | undefined => runs.filter(isDevRun).sort((a, b) => b.createdAt - a.createdAt)[0]

/** Development phase, from the runs started as development and the developers' tasks they planned. */
export function devPhase(runs: Run[], tasks: Task[]): PhaseInfo {
  const latest = latestDev(runs)
  if (!latest) return { state: 'todo', label: 'Not started', detail: 'Developers each build different features, split into tasks by the Project Manager.' }
  const mine = inRun(tasks, latest, isDevRole)
  const done = mine.filter((t) => t.status === 'done').length
  const working = new Set(mine.filter((t) => t.status === 'in_progress').map((t) => t.assignedAgentName ?? t.role)).size
  const progress = mine.length ? `${done}/${mine.length} feature tasks done${working > 0 ? ` · ${working} developer${working === 1 ? '' : 's'} working now` : ''}.` : 'Waiting for the Project Manager’s plan.'
  const active = latest.status === 'running' || latest.status === 'pending'
  if (mine.length > 0 && done === mine.length && !mine.some((t) => t.status === 'failed' || t.status === 'blocked')) return { state: 'done', label: 'Done', detail: progress }
  if (active) return { state: 'active', label: 'In progress', detail: progress }
  if (latest.status === 'paused') return { state: 'attention', label: 'Paused', detail: `${progress} Resume it from the Tasks page.` }
  if (latest.status === 'failed') return { state: 'attention', label: 'Failed', detail: latest.error ?? progress }
  if (latest.status === 'cancelled') return { state: 'attention', label: 'Stopped', detail: progress }
  return { state: 'attention', label: 'Not finished', detail: progress }
}

/** Testing phase: the tester's tasks of the latest development run. They only start after the development is done. */
export function testPhase(runs: Run[], tasks: Task[]): PhaseInfo {
  const latest = latestDev(runs)
  const wait: PhaseInfo = { state: 'todo', label: 'Waiting', detail: 'The tester starts when all the development is finished, then plays and checks the result.' }
  if (!latest) return wait
  const mine = inRun(tasks, latest, isQaRole)
  if (mine.length === 0) return latest.status === 'running' || latest.status === 'pending' ? wait : { ...wait, label: 'No test task', detail: 'The plan has no testing task (the team may have no tester).' }
  const done = mine.filter((t) => t.status === 'done').length
  const text = `${done}/${mine.length} test tasks done${latest.iteration > 0 ? ` · ${latest.iteration} round${latest.iteration === 1 ? '' : 's'} sent back to developers` : ''}.`
  if (mine.some((t) => t.status === 'failed' || t.status === 'blocked')) return { state: 'attention', label: 'Problems', detail: text }
  if (done === mine.length) return { state: 'done', label: 'Finished', detail: text }
  if (mine.some((t) => t.status === 'in_progress' || t.status === 'review' || t.status === 'testing')) return { state: 'active', label: 'Testing', detail: text }
  return { ...wait, detail: `${text} Waiting for the development to finish.` }
}
