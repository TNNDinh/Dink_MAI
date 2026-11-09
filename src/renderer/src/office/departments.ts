import type { Task } from '../../../shared/ipc'

export type DeptId = 'pm' | 'gd' | 'art' | 'audio' | 'dev' | 'qa' | 'integration'

export interface Department {
  id: DeptId
  /** Short sign, e.g. "DEV". */
  short: string
  label: string
  /** Accent colour of the sign, the carpet and the staff shirts. */
  color: string
  /** Two carpet tones (checker). */
  floor: [string, string]
  /** Which row of rooms the department sits in; the hall runs between the two rows. */
  band: 'top' | 'bottom'
  /** Template roles that belong here. */
  roles: string[]
  /** What the department's props look like. */
  props: 'pm' | 'gd' | 'art' | 'audio' | 'dev' | 'qa' | 'integration'
}

/** Department order is the order of rooms, left to right, in each row. */
export const DEPARTMENTS: Department[] = [
  { id: 'pm', short: 'PM', label: 'Project Management', color: '#e0b341', floor: ['#4b4630', '#423d2a'], band: 'top', roles: ['project_manager'], props: 'pm' },
  { id: 'gd', short: 'GD', label: 'Game Design', color: '#a66be6', floor: ['#3d3252', '#352b49'], band: 'top', roles: ['game_designer'], props: 'gd' },
  { id: 'art', short: 'ART', label: 'Art & Graphics', color: '#ee8a4c', floor: ['#4f3a2d', '#463226'], band: 'top', roles: ['concept_artist', 'image_generator', 'ui_ux_designer'], props: 'art' },
  { id: 'audio', short: 'AUDIO', label: 'Sound Design', color: '#3cc4b5', floor: ['#27474a', '#213e41'], band: 'top', roles: [], props: 'audio' },
  { id: 'dev', short: 'DEV', label: 'Programming', color: '#5b9bf0', floor: ['#2c3f5b', '#263851'], band: 'bottom', roles: ['lead_developer', 'backend_developer', 'frontend_developer', 'game_developer', 'technical_architect'], props: 'dev' },
  { id: 'qa', short: 'QA', label: 'Quality Assurance', color: '#e5675d', floor: ['#4d3032', '#442a2c'], band: 'bottom', roles: ['qa_tester', 'code_reviewer'], props: 'qa' },
  { id: 'integration', short: 'INTEG', label: 'Integration & Build', color: '#9aa4b2', floor: ['#3b4047', '#343940'], band: 'bottom', roles: [], props: 'integration' }
]

export const DEPT: Record<DeptId, Department> = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d])) as Record<DeptId, Department>

const AUDIO_WORDS = /\b(audio|sound|sfx|music|voice|soundtrack)\b/i
const INTEGRATION_WORDS = /integrat/i

/** Department of a role alone (custom roles are recognised by name, anything unknown goes to programming). */
export function departmentOfRole(role: string | null | undefined): DeptId {
  if (!role) return 'dev'
  const hit = DEPARTMENTS.find((d) => d.roles.includes(role))
  if (hit) return hit.id
  if (AUDIO_WORDS.test(role)) return 'audio'
  if (INTEGRATION_WORDS.test(role) || /build|release|devops/i.test(role)) return 'integration'
  return 'dev'
}

/**
 * Department of a task: its role decides, except that an integration task of the developers (the plan always has one) sits
 * in INTEGRATION and a sound task in AUDIO. The wording of the title is the only signal there is for those two, since the
 * team has no audio or integration role.
 */
export function departmentOfTask(task: Pick<Task, 'role' | 'title'>): DeptId {
  const byRole = departmentOfRole(task.role)
  if (byRole === 'pm' || byRole === 'qa') return byRole
  if (AUDIO_WORDS.test(task.title)) return 'audio'
  if (byRole === 'dev' && INTEGRATION_WORDS.test(task.title)) return 'integration'
  return byRole
}
