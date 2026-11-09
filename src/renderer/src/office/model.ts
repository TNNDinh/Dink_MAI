import type { Agent, Run, Task, TaskStatus } from '../../../shared/ipc'
import { DEPARTMENTS, departmentOfTask, type DeptId } from './departments'

/** Most desks one department room can hold (4 per row, 4 rows). The tasks beyond it are counted, not drawn. */
export const MAX_STAFF = 16

export type EmployeeStatus = 'working' | 'in_review' | 'queued' | 'waiting' | 'failed' | 'blocked' | 'done'

/** A task, as the office sees it: the fields the studio really has for it. */
export interface OfficeTask {
  taskId: string
  title: string
  department: DeptId
  assignedAgentId: string | null
  /** Id of the employee at the desk this task belongs to (null for a task beyond the room's capacity). */
  employeeId: string | null
  status: TaskStatus
  dependencies: string[]
  output: string | null
  /** The agent of the first review/test task that waits for this one, when it has one yet. */
  reviewerId: string | null
  runId: string | null
}

export interface Employee {
  /** Stable: "dev-3" is always the third developer this project has had. */
  id: string
  agentId: string | null
  name: string
  model: string | null
  department: DeptId
  /** Desk number in the room (0-based); also the position in the department's staff. */
  deskIndex: number
  /** Number that picks the look of the character. */
  look: number
  /** Every task this employee has had, oldest first. */
  taskIds: string[]
  /** The task the employee is on now (or the last one it finished). */
  assignedTaskId: string
  status: EmployeeStatus
  currentActivity: string
  /** done / total of this employee's tasks; null while a single task is in progress (its length is not known). */
  progress: number | null
  /** The employee this one works with now: the developer a tester is checking, or the tester checking this work. */
  targetAgentId: string | null
  tasksDone: number
}

export interface DepartmentInfo {
  id: DeptId
  employees: number
  /** Tasks that belong to the department but did not get a desk. */
  overflow: number
  /** Employees doing something right now. */
  active: number
  tasks: number
  done: number
}

export interface OfficeSnapshot {
  employees: Employee[]
  tasks: OfficeTask[]
  departments: Record<DeptId, DepartmentInfo>
  kanban: Record<TaskStatus, number>
  pm: { name: string; model: string | null; runStatus: string | null; goal: string | null; tasks: number; done: number; spentUsd: number }
}

const sortKey = (runOrder: Map<string, number>) => (a: Task, b: Task) => {
  const ra = a.runId ? (runOrder.get(a.runId) ?? 0) : -1
  const rb = b.runId ? (runOrder.get(b.runId) ?? 0) : -1
  return ra - rb || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)
}

const ancestorsOf = (task: Task, byId: Map<string, Task>): Set<string> => {
  const out = new Set<string>()
  const stack = [...task.dependsOn]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    stack.push(...(byId.get(id)?.dependsOn ?? []))
  }
  return out
}

const EMPTY_KANBAN = (): Record<TaskStatus, number> => ({ todo: 0, in_progress: 0, review: 0, testing: 0, done: 0, failed: 0, blocked: 0 })

const DEPT_BASE = Object.fromEntries(DEPARTMENTS.map((d, i) => [d.id, i])) as Record<DeptId, number>

interface Draft {
  index: number
  tasks: Task[]
  runs: Set<string>
}

/**
 * The office from the real data. The people in it are the project's tasks seated by department:
 *  - a task goes to the person who just finished one of the tasks it depends on (the work passes on to the same desk),
 *  - otherwise to someone from an earlier run who has no task in this run yet,
 *  - otherwise a new employee is hired. So independent tasks get one person each and chains of tasks keep one.
 * Nothing is added for show; a department stops at `MAX_STAFF` desks and counts the rest as overflow.
 */
export function buildOffice(tasksIn: Task[], agents: Agent[], runsIn: Run[]): OfficeSnapshot {
  const agentById = new Map(agents.map((a) => [a.id, a]))
  const runs = [...runsIn].sort((a, b) => a.createdAt - b.createdAt)
  const runOrder = new Map(runs.map((r, i) => [r.id, i]))
  const byId = new Map(tasksIn.map((t) => [t.id, t]))
  const kanban = EMPTY_KANBAN()
  for (const t of tasksIn) kanban[t.status] += 1

  const work = tasksIn.filter((t) => t.role !== 'project_manager').sort(sortKey(runOrder))

  // ── seat the tasks ─────────────────────────────────────────────────────────────────────────────────────────────
  const staff = new Map<DeptId, Draft[]>(DEPARTMENTS.map((d) => [d.id, []]))
  const owner = new Map<string, Draft | null>()
  const deptOf = new Map<string, DeptId>()
  for (const task of work) {
    const dept = departmentOfTask(task)
    deptOf.set(task.id, dept)
    const people = staff.get(dept)!
    const before = ancestorsOf(task, byId)
    const runKey = task.runId ?? ''
    let who = people.find((p) => {
      const last = p.tasks[p.tasks.length - 1]
      return last !== undefined && before.has(last.id)
    })
    who ??= people.find((p) => !p.runs.has(runKey))
    if (!who && people.length < MAX_STAFF) {
      who = { index: people.length, tasks: [], runs: new Set() }
      people.push(who)
    }
    if (who) {
      who.tasks.push(task)
      who.runs.add(runKey)
    }
    owner.set(task.id, who ?? null)
  }

  const employeeId = (dept: DeptId, d: Draft): string => `${dept}-${d.index + 1}`

  // ── the tasks, as the office shows them ───────────────────────────────────────────────────────────────────────
  const tasks: OfficeTask[] = work.map((t) => {
    const dept = deptOf.get(t.id)!
    const dependents = work.filter((o) => o.dependsOn.includes(t.id) && (deptOf.get(o.id) === 'qa'))
    const reviewer = dependents.map((o) => o.assignedAgentId).find((id) => id !== null) ?? null
    const who = owner.get(t.id)
    return {
      taskId: t.id,
      title: t.title,
      department: dept,
      assignedAgentId: t.assignedAgentId,
      employeeId: who ? employeeId(dept, who) : null,
      status: t.status,
      dependencies: [...t.dependsOn],
      output: t.resultSummary,
      reviewerId: reviewer,
      runId: t.runId
    }
  })

  // ── the people ────────────────────────────────────────────────────────────────────────────────────────────────
  const employees: Employee[] = []
  const departments = Object.fromEntries(
    DEPARTMENTS.map((d) => [d.id, { id: d.id, employees: 0, overflow: 0, active: 0, tasks: 0, done: 0 } satisfies DepartmentInfo])
  ) as Record<DeptId, DepartmentInfo>

  for (const task of work) {
    const info = departments[deptOf.get(task.id)!]
    info.tasks += 1
    if (task.status === 'done') info.done += 1
    if (!owner.get(task.id)) info.overflow += 1
  }

  for (const dept of DEPARTMENTS) {
    const people = staff.get(dept.id)!
    const named = new Map<string, number>()
    for (const p of people) {
      const current = currentTask(p.tasks, byId)
      const agentId = [...p.tasks].reverse().find((t) => t.assignedAgentId)?.assignedAgentId ?? null
      const agent = agentId ? agentById.get(agentId) : undefined
      let name = agent?.name ?? `${dept.short} ${p.index + 1}`
      if (agent) {
        const n = (named.get(agent.id) ?? 0) + 1
        named.set(agent.id, n)
        if (n > 1) name = `${name} #${n}`
      }
      const done = p.tasks.filter((t) => t.status === 'done').length
      const status = employeeStatus(current, byId)
      const e: Employee = {
        id: employeeId(dept.id, p),
        agentId,
        name,
        model: agent?.model ?? null,
        department: dept.id,
        deskIndex: p.index,
        look: DEPT_BASE[dept.id] * 19 + p.index,
        taskIds: p.tasks.map((t) => t.id),
        assignedTaskId: current.id,
        status,
        currentActivity: activityOf(status, current, dept.id),
        progress: current.status === 'in_progress' && p.tasks.length === 1 ? null : done / p.tasks.length,
        targetAgentId: targetOf(current, status, dept.id, byId, work, deptOf),
        tasksDone: done
      }
      employees.push(e)
      departments[dept.id].employees += 1
      if (status === 'working' || status === 'in_review') departments[dept.id].active += 1
    }
  }

  // ── the project manager ───────────────────────────────────────────────────────────────────────────────────────
  const latest = runs[runs.length - 1]
  const pmAgent = agents.find((a) => a.role === 'project_manager' && a.enabled) ?? agents.find((a) => a.role === 'project_manager')
  const pm = {
    name: pmAgent?.name ?? 'Project Manager',
    model: pmAgent?.model ?? null,
    runStatus: latest?.status ?? null,
    goal: latest?.goal ?? null,
    tasks: tasksIn.length,
    done: kanban.done,
    spentUsd: runs.reduce((sum, r) => sum + r.spentUsd, 0)
  }
  return { employees, tasks, departments, kanban, pm }
}

/** The task a person is busy with: what is being done now beats what is next, which beats what is over. */
function currentTask(list: Task[], byId: Map<string, Task>): Task {
  const rank = (t: Task): number => {
    if (t.status === 'in_progress') return 0
    if (t.status === 'review' || t.status === 'testing') return 1
    if (t.status === 'todo') return t.dependsOn.every((d) => byId.get(d)?.status === 'done') ? 2 : 3
    if (t.status === 'failed' || t.status === 'blocked') return 4
    return 5
  }
  // among equals the later task (the one that came after the others) is the current one
  return [...list].reverse().reduce((best, t) => (rank(t) < rank(best) ? t : best))
}

function employeeStatus(task: Task, byId: Map<string, Task>): EmployeeStatus {
  switch (task.status) {
    case 'in_progress':
      return 'working'
    case 'review':
    case 'testing':
      return 'in_review'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'blocked'
    default:
      return task.dependsOn.every((d) => byId.get(d)?.status === 'done') ? 'queued' : 'waiting'
  }
}

function activityOf(status: EmployeeStatus, task: Task, dept: DeptId): string {
  const verb = dept === 'qa' ? 'Testing' : dept === 'art' ? 'Drawing' : dept === 'gd' ? 'Designing' : dept === 'audio' ? 'Composing' : dept === 'integration' ? 'Integrating' : 'Building'
  switch (status) {
    case 'working':
      return `${verb}: ${task.title}`
    case 'in_review':
      return `Waiting for review: ${task.title}`
    case 'queued':
      return `Ready to start: ${task.title}`
    case 'waiting':
      return `Waiting for earlier tasks: ${task.title}`
    case 'failed':
      return `Stuck: ${task.title}`
    case 'blocked':
      return `Blocked: ${task.title}`
    default:
      return `Finished: ${task.title}`
  }
}

/** Who this person is dealing with: a tester checks the developer's work; the developer waits for the tester's verdict. */
function targetOf(
  task: Task,
  status: EmployeeStatus,
  dept: DeptId,
  byId: Map<string, Task>,
  work: Task[],
  deptOf: Map<string, DeptId>
): string | null {
  if (dept === 'qa' && (status === 'working' || status === 'queued')) {
    return task.dependsOn.map((d) => byId.get(d)).find((d) => d && deptOf.get(d.id) !== 'qa' && d.assignedAgentId)?.assignedAgentId ?? null
  }
  if (status === 'in_review' || status === 'done') {
    return work.find((o) => o.dependsOn.includes(task.id) && deptOf.get(o.id) === 'qa' && o.assignedAgentId)?.assignedAgentId ?? null
  }
  return null
}
