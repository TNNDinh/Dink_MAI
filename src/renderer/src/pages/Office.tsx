import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Building2, Maximize, Minus, Plus } from 'lucide-react'
import { useStudio } from '../store'
import { Badge, Button, Select } from '../components/ui'
import { DEPARTMENTS, DEPT, type DeptId } from '../office/departments'
import { buildOffice, type Employee, type EmployeeStatus } from '../office/model'
import { roomOf } from '../office/layout'
import { OfficeSim } from '../office/sim'
import { MAX_SCALE, MIN_SCALE, actorScreen, fitView, focusView, renderOffice, statusColor, type View } from '../office/draw'

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  working: 'Working',
  in_review: 'In review / testing',
  queued: 'Ready to start',
  waiting: 'Waiting for another task',
  failed: 'Failed',
  blocked: 'Blocked',
  done: 'Done'
}

const FRAME_MS = 33

export function Office(): ReactElement {
  const { projects, tasks, runs, agents, events, selectedProjectId } = useStudio()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  // The project to show: the one chosen here, else the one open in Projects, else the one with the newest task.
  const auto = useMemo(() => {
    if (selectedProjectId && projects.some((p) => p.id === selectedProjectId)) return selectedProjectId
    const newest = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    return newest?.projectId ?? projects[0]?.id ?? null
  }, [selectedProjectId, projects, tasks])
  const pid = projectId && projects.some((p) => p.id === projectId) ? projectId : auto

  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === pid), [tasks, pid])
  const projectRuns = useMemo(() => runs.filter((r) => r.projectId === pid), [runs, pid])
  const snap = useMemo(() => buildOffice(projectTasks, agents, projectRuns), [projectTasks, agents, projectRuns])

  const sim = useMemo(() => new OfficeSim(), [pid])
  const simRef = useRef(sim)
  simRef.current = sim
  const snapRef = useRef(snap)
  snapRef.current = snap

  // data in: the snapshot at every change, and only the events that happen while the page is open
  useEffect(() => {
    sim.sync(snap)
  }, [sim, snap])
  const lastEvent = useRef<number | null>(null)
  useEffect(() => {
    if (lastEvent.current === null) lastEvent.current = events.reduce((m, e) => Math.max(m, e.id), 0)
    const fresh = events.filter((e) => e.id > (lastEvent.current ?? 0) && e.projectId === pid).sort((a, b) => a.id - b.id)
    for (const e of fresh) sim.event({ type: e.type, message: e.message, agentId: e.agentId })
    lastEvent.current = Math.max(lastEvent.current, ...events.map((e) => e.id), 0)
  }, [events, pid, sim])
  useEffect(() => setSelected(null), [pid])

  // ── the canvas ──────────────────────────────────────────────────────────────────────────────────────────────────
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ scale: 1, panX: 0, panY: 0 })
  const size = useRef({ w: 0, h: 0 })
  const fitted = useRef(false)
  const hover = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected

  useEffect(() => {
    const el = wrap.current
    const cv = canvas.current
    if (!el || !cv) return
    const paint = (now: number): void => {
      const ctx = cv.getContext('2d')
      if (!ctx || size.current.w === 0) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderOffice(ctx, size.current.w, size.current.h, simRef.current, view.current, { selected: selectedRef.current, hovered: hover.current, time: now / 1000 })
    }
    // Setting the size of a canvas wipes it, and the resize observer runs after the animation frame but before the
    // screen is painted: draw again right here so the wiped canvas is never what gets shown.
    const resize = (): void => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      const bw = Math.round(w * dpr)
      const bh = Math.round(h * dpr)
      if (cv.width !== bw || cv.height !== bh) {
        cv.width = bw
        cv.height = bh
      }
      cv.style.width = `${w}px`
      cv.style.height = `${h}px`
      size.current = { w, h }
      if (!fitted.current) {
        view.current = fitView(w, h)
        fitted.current = true
      }
      paint(performance.now())
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let last = performance.now()
    let acc = 0
    let raf = 0
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      acc += dt * 1000
      if (acc < FRAME_MS) return
      const step = acc / 1000
      acc = 0
      simRef.current.update(step)
      paint(now)
    }
    raf = requestAnimationFrame(loop)

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = cv.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015))
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      cv.removeEventListener('wheel', onWheel)
    }
  }, [])

  const zoomAt = (px: number, py: number, factor: number): void => {
    const v = view.current
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor))
    const k = scale / v.scale
    view.current = { scale, panX: px - (px - v.panX) * k, panY: py - (py - v.panY) * k }
  }

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const pick = (px: number, py: number): string | null => {
    let best: string | null = null
    let bestD = Infinity
    for (const a of sim.ordered()) {
      const [sx, sy] = actorScreen(a, view.current)
      const r = 15 * view.current.scale + 4
      const d = Math.hypot(px - sx, py - sy)
      if (d < r && d < bestD) {
        best = a.id
        bestD = d
      }
    }
    return best
  }

  const local = (e: React.PointerEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  const jump = (dept: DeptId): void => {
    const r = roomOf(dept)
    view.current = focusView(size.current.w, size.current.h, Math.min(MAX_SCALE, Math.max(1.4, size.current.w / 560)), r.x + r.w / 2, r.h / 2 + 1)
  }

  const zoomBy = (f: number): void => zoomAt(size.current.w / 2, size.current.h / 2, f)

  // ── the side panel ──────────────────────────────────────────────────────────────────────────────────────────────
  const emp = snap.employees.find((e) => e.id === selected) ?? null
  const total = snap.employees.length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <Building2 size={16} className="text-accent" />
        <h1 className="text-sm font-semibold">AI Office</h1>
        <Select aria-label="Project" className="!w-56" value={pid ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted" data-testid="office-summary">
          {total} {total === 1 ? 'employee' : 'employees'} · {snap.kanban.in_progress} working · {snap.kanban.done}/{projectTasks.length} tasks done
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" title="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
            <Minus size={14} />
          </Button>
          <Button variant="ghost" size="sm" title="Zoom in" onClick={() => zoomBy(1.3)}>
            <Plus size={14} />
          </Button>
          <Button variant="ghost" size="sm" title="Fit the whole office" onClick={() => (view.current = fitView(size.current.w, size.current.h))}>
            <Maximize size={14} /> Fit
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-1.5">
        {DEPARTMENTS.map((d) => {
          const n = d.id === 'pm' ? 1 : snap.departments[d.id].employees
          const over = d.id === 'pm' ? 0 : snap.departments[d.id].overflow
          return (
            <button
              key={d.id}
              data-dept={d.id}
              onClick={() => jump(d.id)}
              title={d.label}
              className="flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-fg"
            >
              <span className="size-2 rounded-sm" style={{ background: d.color }} />
              {d.short}
              <span className="tabular-nums text-fg">
                {n}
                {over > 0 ? `+${over}` : ''}
              </span>
            </button>
          )
        })}
      </div>

      <div className="relative min-h-0 flex-1 bg-[#0d1016]" ref={wrap}>
        <canvas
          ref={canvas}
          data-testid="office-canvas"
          className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => {
            const [x, y] = local(e)
            drag.current = { x, y, moved: false }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const [x, y] = local(e)
            const d = drag.current
            if (d) {
              const dx = x - d.x
              const dy = y - d.y
              if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
              if (d.moved) {
                view.current = { ...view.current, panX: view.current.panX + dx, panY: view.current.panY + dy }
                d.x = x
                d.y = y
              }
            } else hover.current = pick(x, y)
          }}
          onPointerUp={(e) => {
            const d = drag.current
            drag.current = null
            if (d && !d.moved) {
              const [x, y] = local(e)
              setSelected(pick(x, y))
            }
          }}
          onPointerLeave={() => (hover.current = null)}
        />
        {total === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-4 mx-auto w-fit max-w-md rounded-md border border-line bg-panel/90 px-3 py-2 text-center text-xs text-muted">
            The office is empty: people appear here when the project has tasks. Start a run and each task gets an employee at a desk of its department.
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-faint">Drag to move · wheel to zoom · click a person for details</div>

        {selected && (
          <aside className="absolute right-3 top-3 w-72 max-w-[calc(100%-1.5rem)] rounded-lg border border-line bg-panel/95 p-3 text-xs shadow-xl backdrop-blur" data-testid="office-inspector">
            {selected === 'pm' ? (
              <PmCard snap={snap} />
            ) : emp ? (
              <EmployeeCard emp={emp} snap={snap} onSelect={setSelected} />
            ) : (
              <p className="text-muted">This employee no longer exists.</p>
            )}
            <button className="mt-2 text-[11px] text-faint hover:text-fg" onClick={() => setSelected(null)}>
              Close
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}

function PmCard({ snap }: { snap: ReturnType<typeof buildOffice> }): ReactElement {
  const pm = snap.pm
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: DEPT.pm.color }} />
        <span className="text-sm font-semibold">{pm.name}</span>
        <Badge tone="warn">Project Manager</Badge>
      </div>
      {pm.model && <p className="text-muted">Model: {pm.model}</p>}
      <p className="text-muted">Run: {pm.runStatus ?? 'none yet'}</p>
      {pm.goal && <p className="line-clamp-3 text-muted">Goal: {pm.goal}</p>}
      <p className="text-muted">
        {pm.done}/{pm.tasks} tasks done · ${pm.spentUsd.toFixed(2)} spent
      </p>
    </div>
  )
}

function EmployeeCard({ emp, snap, onSelect }: { emp: Employee; snap: ReturnType<typeof buildOffice>; onSelect: (id: string) => void }): ReactElement {
  const tasks = useStudio((s) => s.tasks)
  const d = DEPT[emp.department]
  const task = snap.tasks.find((t) => t.taskId === emp.assignedTaskId)
  const raw = tasks.find((t) => t.id === emp.assignedTaskId)
  const mine = snap.tasks.filter((t) => t.employeeId === emp.id)
  const target = snap.employees.find((e) => e.agentId !== null && e.agentId === emp.targetAgentId && e.id !== emp.id)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: d.color }} />
        <span className="text-sm font-semibold">{emp.name}</span>
      </div>
      <p className="text-muted">
        {d.label}
        {emp.model ? ` · ${emp.model}` : ''}
      </p>
      <p className="flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: statusColor(emp.status) }} />
        {STATUS_LABEL[emp.status]}
        {emp.progress !== null && emp.status !== 'waiting' && emp.status !== 'queued' && <span className="text-muted tabular-nums">· {Math.round(emp.progress * 100)}%</span>}
      </p>
      {task && <p className="font-medium">{task.title}</p>}
      {raw?.description && <p className="line-clamp-4 text-muted">{raw.description}</p>}
      <p className="text-muted">{emp.currentActivity}</p>
      {task && task.dependencies.length > 0 && (
        <p className="text-muted">
          Depends on:{' '}
          {task.dependencies
            .map((id) => snap.tasks.find((t) => t.taskId === id)?.title ?? id)
            .slice(0, 4)
            .join(', ')}
        </p>
      )}
      {target && (
        <p className="text-muted">
          Working with{' '}
          <button className="text-accent hover:underline" onClick={() => onSelect(target.id)}>
            {target.name}
          </button>
        </p>
      )}
      {raw?.resultSummary && <p className="line-clamp-4 rounded bg-elev px-2 py-1 text-muted">{raw.resultSummary}</p>}
      {raw?.error && <p className="line-clamp-3 text-err">{raw.error}</p>}
      {mine.length > 1 && (
        <p className="text-faint">
          {emp.tasksDone}/{mine.length} of their tasks done
        </p>
      )}
    </div>
  )
}
