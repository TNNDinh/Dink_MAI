import type { DeptId } from './departments'
import { deskOf, findPath, getLayout, roomOf, visitSpot, walkGrid, type Tile } from './layout'
import type { Employee, OfficeSnapshot, OfficeTask } from './model'

/** Grid directions: N is −y, S is +y, E is +x, W is −x (on screen: up-right, down-left, down-right, up-left). */
export type Dir = 'N' | 'S' | 'E' | 'W'
export type Pose = 'sit' | 'stand' | 'walk'

export type Step =
  | { k: 'goto'; to: Tile }
  | { k: 'wait'; t: number; until?: number }
  /** Say something and stand still for `t` seconds. */
  | { k: 'say'; text: string; t: number; until?: number }
  /** Show a bubble and carry on. */
  | { k: 'bubble'; text: string; t: number }
  /** Make another person show a bubble. */
  | { k: 'sayTo'; id: string; text: string; t: number }
  | { k: 'carry'; on: boolean }
  | { k: 'face'; at: Tile }
  | { k: 'sit'; at?: Tile }
  | { k: 'signal'; name: string }
  | { k: 'waitSignal'; name: string; timeout: number; until?: number }
  | { k: 'label'; text: string | null }
  | { k: 'dyn'; fn: (sim: OfficeSim, actor: Actor) => Step[] }

export interface Bubble {
  text: string
  until: number
}

export interface Actor {
  id: string
  kind: 'pm' | 'employee'
  dept: DeptId
  /** The tile the person is on (or is leaving). */
  tile: Tile
  next: Tile | null
  prog: number
  /** Position in tiles, for drawing. */
  x: number
  y: number
  facing: Dir
  pose: Pose
  walkPhase: number
  carrying: boolean
  bubble: Bubble | null
  /** A line that replaces the activity of the task (e.g. "Fixing what the tester found"). */
  label: string | null
  steps: Step[]
  path: Tile[]
  goal: Tile | null
  blocked: number
  home: Tile
  /** Not drawn before this time (a new hire is still outside). */
  hiddenUntil: number
}

export interface SimEvent {
  type: string
  message: string
  agentId: string | null
}

const SPEED = 3.4
const same = (a: Tile, b: Tile): boolean => a.x === b.x && a.y === b.y
const key = (t: Tile): string => `${t.x},${t.y}`
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const facingFrom = (from: Tile, to: Tile, keep: Dir): Dir => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return keep
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N'
}

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Brings the people to life. What exists comes from `OfficeSnapshot` (real tasks); what they do comes from the changes
 * between two snapshots and from the orchestrator's events:
 *  - a new task with nobody to take it: a new hire walks in from the entrance to a new desk;
 *  - a task that finishes: its owner takes the document to the PM's desk, the PM reviews it, then the owner passes the
 *    result on to whoever works on the task that depends on it (another department included);
 *  - a tester that sends work back: the tester walks over to the developer and says what is wrong;
 *  - the PM looks at the boards, visits departments, and calls a meeting when the run is over.
 * Nobody here is invented: an actor exists only for an employee of the snapshot.
 */
export class OfficeSim {
  readonly actors = new Map<string, Actor>()
  t = 0
  private snap: OfficeSnapshot | null = null
  private prevStatus = new Map<string, string>()
  private grid: Uint8Array
  private counts = ''
  private occ = new Map<string, string>()
  private signals = new Set<string>()
  private seq = 0
  private pmJobs: Step[][] = []
  private pmIdle = 0
  private chatTimer = 20
  private patrol = 0
  private rnd: () => number

  constructor(seed = 7) {
    this.rnd = mulberry(seed)
    this.grid = walkGrid({})
  }

  get snapshot(): OfficeSnapshot | null {
    return this.snap
  }

  /** The people, back to front for drawing. */
  ordered(): Actor[] {
    return [...this.actors.values()].filter((a) => a.hiddenUntil <= this.t).sort((a, b) => a.x + a.y - (b.x + b.y))
  }

  // ── data in ───────────────────────────────────────────────────────────────────────────────────────────────────
  sync(snap: OfficeSnapshot): void {
    const first = this.snap === null
    this.snap = snap
    const counts = Object.fromEntries(Object.values(snap.departments).map((d) => [d.id, d.employees]))
    const sig = JSON.stringify(counts)
    if (sig !== this.counts) {
      this.counts = sig
      this.grid = walkGrid(counts)
    }
    const L = getLayout()

    if (!this.actors.has('pm')) this.spawn('pm', 'pm', L.pm.seat, L.pm.seat, 'N', 0)
    const ids = new Set(['pm'])
    const hired = new Map<DeptId, number>()
    let hires = 0
    for (const e of snap.employees) {
      ids.add(e.id)
      if (this.actors.has(e.id)) continue
      const chair = deskOf(e.department, e.deskIndex).chair
      if (first) {
        this.spawn(e.id, 'employee', chair, chair, 'N', 0)
        continue
      }
      const a = this.spawn(e.id, 'employee', L.entrance, chair, 'E', this.t + hires * 1.4)
      hires += 1
      const task = snap.tasks.find((t) => t.taskId === e.assignedTaskId)
      a.pose = 'walk'
      a.steps.push({ k: 'bubble', text: `New task: ${clip(task?.title ?? '', 28)}`, t: 4 }, { k: 'goto', to: chair }, { k: 'sit' })
      hired.set(e.department, (hired.get(e.department) ?? 0) + 1)
    }
    for (const id of [...this.actors.keys()]) {
      if (ids.has(id)) continue
      const a = this.actors.get(id)!
      this.occ.delete(key(a.tile))
      if (a.next) this.occ.delete(key(a.next))
      this.actors.delete(id)
    }
    // the PM goes to a department that got new people to tell them what to do
    for (const [dept, n] of hired) {
      if (this.pmJobs.length >= 6) break
      this.pmJobs.push([{ k: 'goto', to: visitSpot(dept) }, { k: 'say', text: `${n === 1 ? 'A new task' : `${n} new tasks`} for you`, t: 2 }])
    }

    // what changed since the last snapshot
    if (!first) {
      for (const t of snap.tasks) {
        const before = this.prevStatus.get(t.taskId)
        if (before !== undefined && before !== t.status) this.transition(t)
      }
    }
    this.prevStatus = new Map(snap.tasks.map((t) => [t.taskId, t.status]))
  }

  /** A fresh event of the orchestrator (not the history that was already there when the page opened). */
  event(e: SimEvent): void {
    const snap = this.snap
    if (!snap) return
    const L = getLayout()
    const taskOf = (msg: string): OfficeTask | undefined => {
      const m = /“(.+?)”/.exec(msg)
      return m ? snap.tasks.find((t) => t.title === m[1]) : undefined
    }
    switch (e.type) {
      case 'plan.started':
        this.queuePm([{ k: 'goto', to: L.pm.projectBoard }, { k: 'face', at: { x: L.pm.projectBoard.x, y: 0 } }, { k: 'say', text: 'Planning the project…', t: 5 }])
        break
      case 'plan.created':
        this.queuePm([
          { k: 'goto', to: L.pm.kanban },
          { k: 'face', at: { x: L.pm.kanban.x, y: 0 } },
          { k: 'say', text: 'Plan ready — handing out tasks', t: 3 },
          { k: 'dyn', fn: (sim) => sim.tour() }
        ])
        break
      case 'task.waiting': {
        const reviewer = taskOf(e.message)
        if (reviewer) this.bounce(reviewer)
        break
      }
      case 'task.retry': {
        const t = taskOf(e.message)
        const a = t?.employeeId ? this.actors.get(t.employeeId) : undefined
        if (a) this.shout(a, 'Retrying…', 3)
        break
      }
      case 'run.completed':
        this.queuePm([{ k: 'dyn', fn: (sim) => sim.meeting() }])
        break
      case 'run.failed':
        this.queuePm([{ k: 'goto', to: L.pm.statusScreen }, { k: 'say', text: 'The run failed — checking why', t: 4 }])
        break
    }
  }

  // ── time ──────────────────────────────────────────────────────────────────────────────────────────────────────
  update(dtIn: number): void {
    const dt = Math.min(dtIn, 0.25)
    this.t += dt
    for (const a of this.actors.values()) {
      if (a.bubble && a.bubble.until <= this.t) a.bubble = null
      if (a.hiddenUntil > this.t) continue
      this.stepActor(a, dt)
    }
    this.idleBehaviour(dt)
  }

  // ── choreography ──────────────────────────────────────────────────────────────────────────────────────────────
  private spawn(id: string, kind: 'pm' | 'employee', at: Tile, home: Tile, facing: Dir, hiddenUntil: number): Actor {
    const dept: DeptId = kind === 'pm' ? 'pm' : (id.split('-')[0] as DeptId)
    const a: Actor = {
      id, kind, dept, tile: { ...at }, next: null, prog: 0, x: at.x, y: at.y, facing, pose: same(at, home) ? 'sit' : 'stand', walkPhase: 0,
      carrying: false, bubble: null, label: null, steps: [], path: [], goal: null, blocked: 0, home, hiddenUntil
    }
    this.actors.set(id, a)
    this.occ.set(key(at), id)
    return a
  }

  private shout(a: Actor, text: string, secs: number): void {
    a.bubble = { text, until: this.t + secs }
  }

  private queuePm(steps: Step[]): void {
    if (this.pmJobs.length < 8) this.pmJobs.push(steps)
  }

  private transition(task: OfficeTask): void {
    const a = task.employeeId ? this.actors.get(task.employeeId) : undefined
    const emp = this.snap?.employees.find((e) => e.id === task.employeeId)
    if (!a || !emp) return
    switch (task.status) {
      case 'in_progress':
        this.shout(a, `Starting: ${clip(task.title, 26)}`, 3.5)
        break
      case 'review':
      case 'testing':
        this.shout(a, 'Waiting for review', 3)
        break
      case 'failed':
        this.shout(a, `✖ ${clip(task.title, 24)} failed`, 5)
        break
      case 'blocked':
        this.shout(a, 'Blocked by an earlier task', 4)
        break
      case 'done':
        a.label = null
        this.deliver(a, emp, task)
        break
    }
  }

  /** The finished work goes to the PM's desk; once approved, whoever builds on it gets it. */
  private deliver(a: Actor, emp: Employee, task: OfficeTask): void {
    const L = getLayout()
    const id = ++this.seq
    const chair = deskOf(emp.department, emp.deskIndex).chair
    a.steps.push(
      { k: 'bubble', text: `📄 ${clip(task.title, 26)}`, t: 6 },
      { k: 'waitSignal', name: `go:${id}`, timeout: 150 },
      { k: 'carry', on: true },
      { k: 'goto', to: L.pm.receive },
      { k: 'face', at: L.pm.seat },
      { k: 'signal', name: `arrived:${id}` },
      { k: 'waitSignal', name: `done:${id}`, timeout: 60 },
      { k: 'dyn', fn: (sim, who) => sim.handoff(who, task) },
      { k: 'carry', on: false },
      { k: 'goto', to: chair },
      { k: 'sit' }
    )
    this.queuePm([
      { k: 'goto', to: L.pm.seat },
      { k: 'sit' },
      { k: 'signal', name: `go:${id}` },
      { k: 'waitSignal', name: `arrived:${id}`, timeout: 120 },
      { k: 'face', at: L.pm.receive },
      { k: 'say', text: `Reviewing “${clip(task.title, 22)}”…`, t: 2.4 },
      { k: 'say', text: 'Approved ✓', t: 1.2 },
      { k: 'dyn', fn: (sim) => sim.dispatch(task) },
      { k: 'signal', name: `done:${id}` }
    ])
  }

  /** Tasks that were waiting for this one and are now ready, that have somebody at a desk. */
  private nextTasks(task: OfficeTask): OfficeTask[] {
    const snap = this.snap
    if (!snap) return []
    const byId = new Map(snap.tasks.map((t) => [t.taskId, t]))
    return snap.tasks.filter((t) => t.dependencies.includes(task.taskId) && t.status !== 'done' && t.employeeId && t.dependencies.every((d) => d === task.taskId || byId.get(d)?.status === 'done'))
  }

  /** PM side of an approval: says what comes next. */
  dispatch(task: OfficeTask): Step[] {
    const next = this.nextTasks(task).slice(0, 3)
    if (next.length === 0) return []
    const steps: Step[] = next.map((t) => ({ k: 'sayTo', id: t.employeeId!, text: 'New task for me', t: 3 }) as Step)
    steps.push({ k: 'say', text: next.length === 1 ? `Next: ${clip(next[0].title, 26)}` : `Next: ${next.length} tasks are ready`, t: 2 })
    return steps
  }

  /** The owner's side of an approval: carry the result to whoever builds on it (that may be another department). */
  handoff(a: Actor, task: OfficeTask): Step[] {
    const emp = this.snap?.employees.find((e) => e.id === a.id)
    const steps: Step[] = []
    const seen = new Set<string>([a.id])
    for (const t of this.nextTasks(task)) {
      const id = t.employeeId!
      if (seen.has(id) || !this.actors.has(id) || steps.length >= 6) continue
      seen.add(id)
      const target = this.snap?.employees.find((e) => e.id === id)
      if (!target) continue
      const d = deskOf(target.department, target.deskIndex)
      steps.push(
        { k: 'goto', to: d.approach },
        { k: 'face', at: d.chair },
        { k: 'say', text: target.department === emp?.department ? 'Here is my part' : `Here is the ${emp ? emp.department.toUpperCase() : ''} output`, t: 1.6 },
        { k: 'sayTo', id, text: 'Thanks — got it', t: 2 },
        { k: 'wait', t: 0.8 }
      )
    }
    return steps
  }

  /** A tester (or reviewer) sends the work back: walks to the developer who made it. */
  private bounce(reviewTask: OfficeTask): void {
    const snap = this.snap
    const a = reviewTask.employeeId ? this.actors.get(reviewTask.employeeId) : undefined
    if (!snap || !a) return
    const owners = reviewTask.dependencies.map((d) => snap.tasks.find((t) => t.taskId === d)).filter((t): t is OfficeTask => !!t && !!t.employeeId && t.employeeId !== a.id)
    const owner = owners[0]
    const target = owner ? snap.employees.find((e) => e.id === owner.employeeId) : undefined
    const other = target ? this.actors.get(target.id) : undefined
    if (!target || !other) {
      this.shout(a, 'Changes needed', 4)
      return
    }
    const d = deskOf(target.department, target.deskIndex)
    const home = deskOf(snap.employees.find((e) => e.id === a.id)?.department ?? 'qa', snap.employees.find((e) => e.id === a.id)?.deskIndex ?? 0).chair
    other.label = 'Fixing what the tester found'
    a.steps.push(
      { k: 'bubble', text: 'Found problems…', t: 2 },
      { k: 'goto', to: d.approach },
      { k: 'face', at: d.chair },
      { k: 'say', text: 'This needs changes', t: 2.2 },
      { k: 'sayTo', id: target.id, text: 'On it — fixing', t: 2.5 },
      { k: 'wait', t: 1 },
      { k: 'goto', to: home },
      { k: 'sit' }
    )
  }

  /** After a plan: the PM walks past the departments that got work. */
  tour(): Step[] {
    const snap = this.snap
    if (!snap) return []
    const steps: Step[] = []
    for (const d of Object.values(snap.departments)) {
      if (d.employees === 0 || d.id === 'pm' || steps.length >= 8) continue
      steps.push({ k: 'goto', to: visitSpot(d.id) }, { k: 'say', text: `${d.tasks} task${d.tasks === 1 ? '' : 's'} for ${d.id.toUpperCase()}`, t: 1.8 })
    }
    return steps
  }

  /** The run is over: the PM sits at the meeting table with one person from each department. */
  meeting(): Step[] {
    const snap = this.snap
    if (!snap) return []
    const L = getLayout()
    const picks: Employee[] = []
    const seenDept = new Set<DeptId>()
    for (const e of snap.employees) {
      if (seenDept.has(e.department)) continue
      seenDept.add(e.department)
      picks.push(e)
    }
    const seats = L.pm.meetingSeats
    const centre: Tile = { x: roomOf('pm').x + 10, y: 5.5 }
    const id = ++this.seq
    const who = picks.slice(0, seats.length - 1)
    who.forEach((e, i) => {
      const a = this.actors.get(e.id)
      if (!a) return
      const chair = deskOf(e.department, e.deskIndex).chair
      a.steps.push(
        { k: 'goto', to: seats[i + 1] },
        { k: 'sit', at: centre },
        { k: 'signal', name: `seated:${id}:${e.id}` },
        { k: 'waitSignal', name: `meeting-over:${id}`, timeout: 90 },
        { k: 'goto', to: chair },
        { k: 'sit' }
      )
    })
    // the PM starts once everybody is seated (or after a while), talks, then ends the meeting
    return [
      { k: 'goto', to: seats[0] },
      { k: 'sit', at: centre },
      ...who.map((e): Step => ({ k: 'waitSignal', name: `seated:${id}:${e.id}`, timeout: 60 })),
      { k: 'say', text: 'Run complete — well done everyone', t: 3 },
      { k: 'wait', t: 3 },
      { k: 'signal', name: `meeting-over:${id}` }
    ]
  }

  // ── the idle life of the PM and the staff ─────────────────────────────────────────────────────────────────────
  private idleBehaviour(dt: number): void {
    const snap = this.snap
    const pm = this.actors.get('pm')
    if (!snap || !pm) return
    const running = snap.pm.runStatus === 'running'

    if (pm.steps.length === 0 && !pm.next) {
      const job = this.pmJobs.shift()
      if (job) {
        pm.steps.push(...job)
        this.pmIdle = 0
      } else {
        this.pmIdle += dt
        if (this.pmIdle > (running ? 9 : 16) && snap.tasks.length > 0) {
          this.pmIdle = 0
          pm.steps.push(...this.pmRound())
        }
      }
    }

    // two people of one department who work at the same time now and then stop by each other's desk
    this.chatTimer -= dt
    if (this.chatTimer <= 0) {
      this.chatTimer = 18 + this.rnd() * 18
      if (running) this.chatter()
    }
  }

  /** What the PM does while there is nothing to hand out: look at a board, or visit someone who is working. */
  private pmRound(): Step[] {
    const snap = this.snap!
    const L = getLayout()
    this.patrol += 1
    const working = snap.employees.filter((e) => e.status === 'working' || e.status === 'in_review')
    if (working.length > 0 && this.patrol % 2 === 0) {
      const e = working[Math.floor(this.rnd() * working.length)]
      const d = deskOf(e.department, e.deskIndex)
      return [
        { k: 'goto', to: visitSpot(e.department) },
        { k: 'goto', to: d.approach },
        { k: 'face', at: d.chair },
        { k: 'say', text: `How is “${clip(this.snap!.tasks.find((t) => t.taskId === e.assignedTaskId)?.title ?? '', 20)}” going?`, t: 2.4 },
        { k: 'sayTo', id: e.id, text: e.status === 'working' ? 'On track' : 'Waiting for review', t: 2.4 },
        { k: 'wait', t: 1 }
      ]
    }
    const boards = [L.pm.projectBoard, L.pm.kanban, L.pm.statusScreen]
    const spot = boards[this.patrol % boards.length]
    return [{ k: 'goto', to: spot }, { k: 'face', at: { x: spot.x, y: 0 } }, { k: 'wait', t: 3.5 }]
  }

  private chatter(): void {
    const snap = this.snap!
    const byDept = new Map<DeptId, Employee[]>()
    for (const e of snap.employees) {
      const a = this.actors.get(e.id)
      if (e.status !== 'working' || !a || a.steps.length > 0 || a.next || a.pose !== 'sit') continue
      byDept.set(e.department, [...(byDept.get(e.department) ?? []), e])
    }
    const rooms = [...byDept.values()].filter((l) => l.length >= 2)
    if (rooms.length === 0) return
    const list = rooms[Math.floor(this.rnd() * rooms.length)]
    const i = Math.floor(this.rnd() * list.length)
    const j = (i + 1 + Math.floor(this.rnd() * (list.length - 1))) % list.length
    const me = list[i]
    const you = list[j]
    const a = this.actors.get(me.id)!
    const d = deskOf(you.department, you.deskIndex)
    const home = deskOf(me.department, me.deskIndex).chair
    a.steps.push(
      { k: 'goto', to: d.approach },
      { k: 'face', at: d.chair },
      { k: 'say', text: 'Let us line up our parts', t: 2.2 },
      { k: 'sayTo', id: you.id, text: 'Sure, one moment', t: 2.2 },
      { k: 'wait', t: 1 },
      { k: 'goto', to: home },
      { k: 'sit' }
    )
  }

  // ── one person, one frame ─────────────────────────────────────────────────────────────────────────────────────
  private stepActor(a: Actor, dt: number): void {
    if (a.next) {
      this.advance(a, dt)
      return
    }
    for (let guard = 0; guard < 12 && !a.next; guard++) {
      const s = a.steps[0]
      if (!s) {
        this.settle(a)
        return
      }
      if (!this.run(a, s, dt)) return
      a.steps.shift()
    }
  }

  /** Runs a step. true = it is finished (take it off the queue), false = still going. */
  private run(a: Actor, s: Step, dt: number): boolean {
    switch (s.k) {
      case 'goto': {
        if (same(a.tile, s.to)) {
          a.goal = null
          a.path = []
          return true
        }
        if (!a.goal || !same(a.goal, s.to)) {
          a.goal = s.to
          a.path = findPath(this.grid, a.tile, s.to) ?? []
          if (a.path.length === 0) {
            // no way there: appear at the goal rather than stand stuck forever
            this.moveTo(a, s.to)
            a.goal = null
            return true
          }
        }
        this.tryMove(a, dt)
        return false
      }
      case 'wait':
        s.until ??= this.t + s.t
        a.pose = a.pose === 'walk' ? 'stand' : a.pose
        return this.t >= s.until
      case 'say':
        if (s.until === undefined) {
          s.until = this.t + s.t
          a.bubble = { text: s.text, until: s.until }
        }
        a.pose = a.pose === 'walk' ? 'stand' : a.pose
        return this.t >= s.until
      case 'bubble':
        a.bubble = { text: s.text, until: this.t + s.t }
        return true
      case 'sayTo': {
        const o = this.actors.get(s.id)
        if (o) o.bubble = { text: s.text, until: this.t + s.t }
        return true
      }
      case 'carry':
        a.carrying = s.on
        return true
      case 'face':
        a.facing = facingFrom(a.tile, s.at, a.facing)
        if (a.pose === 'walk') a.pose = 'stand'
        return true
      case 'sit':
        a.pose = 'sit'
        a.facing = s.at ? facingFrom(a.tile, s.at, a.facing) : 'N'
        return true
      case 'signal':
        this.signals.add(s.name)
        return true
      case 'waitSignal':
        s.until ??= this.t + s.timeout
        if (a.pose === 'walk') a.pose = 'stand'
        return this.signals.has(s.name) || this.t >= s.until
      case 'label':
        a.label = s.text
        return true
      case 'dyn':
        a.steps.splice(1, 0, ...s.fn(this, a))
        return true
    }
  }

  /** Nothing left to do: go back to the desk and sit. */
  private settle(a: Actor): void {
    if (a.pose === 'walk') a.pose = 'stand'
    if (a.kind === 'pm') {
      if (this.pmJobs.length > 0) return // the next errand starts from here, not from the desk
      const L = getLayout()
      if (!same(a.tile, L.pm.seat)) a.steps.push({ k: 'goto', to: L.pm.seat }, { k: 'sit' })
      else if (a.pose !== 'sit') a.steps.push({ k: 'sit' })
      return
    }
    if (!same(a.tile, a.home)) a.steps.push({ k: 'goto', to: a.home }, { k: 'sit' })
    else if (a.pose !== 'sit') a.steps.push({ k: 'sit' })
  }

  private moveTo(a: Actor, to: Tile): void {
    this.occ.delete(key(a.tile))
    a.tile = { ...to }
    a.x = to.x
    a.y = to.y
    this.occ.set(key(to), a.id)
  }

  private tryMove(a: Actor, dt: number): void {
    const step = a.path[0]
    if (!step) return
    const holder = this.occ.get(key(step))
    if (holder && holder !== a.id) {
      a.blocked += dt
      a.pose = a.pose === 'walk' ? 'stand' : a.pose
      if (a.blocked > 1.2 && a.goal) {
        // go around whoever is in the way; if there is no other way keep waiting, then walk through
        const detour = findPath(this.grid, a.tile, a.goal, (x, y) => {
          const h = this.occ.get(`${x},${y}`)
          return h !== undefined && h !== a.id
        })
        if (detour && detour.length > 0) {
          a.path = detour
          a.blocked = 0
        }
      }
      if (a.blocked < 6) return
    }
    a.blocked = 0
    a.path.shift()
    a.next = step
    a.prog = 0
    a.pose = 'walk'
    a.facing = facingFrom(a.tile, step, a.facing)
    this.occ.set(key(step), a.id)
  }

  private advance(a: Actor, dt: number): void {
    const to = a.next!
    a.prog += dt * SPEED
    a.walkPhase += dt * 9
    const k = Math.min(1, a.prog)
    a.x = a.tile.x + (to.x - a.tile.x) * k
    a.y = a.tile.y + (to.y - a.tile.y) * k
    if (a.prog >= 1) {
      if (this.occ.get(key(a.tile)) === a.id) this.occ.delete(key(a.tile))
      a.tile = { ...to }
      a.x = to.x
      a.y = to.y
      a.next = null
      a.prog = 0
      this.occ.set(key(to), a.id)
      const nextStep = a.steps[0]
      // keep walking without a pause while the path goes on
      if (nextStep?.k === 'goto' && a.path.length > 0) this.tryMove(a, 0)
      else a.pose = 'stand'
    }
  }

  /** For tests and the inspector: is nobody walking or talking any more? */
  busy(): boolean {
    for (const a of this.actors.values()) if (a.steps.length > 0 || a.next) return true
    return this.pmJobs.length > 0
  }
}
