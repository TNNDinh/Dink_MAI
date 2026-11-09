/** A development run is recognised by this start of its goal: the studio writes it when the user starts the phase. */
export const DEV_GOAL_PREFIX = 'Development phase:'

export const isDevGoal = (goal: string): boolean => goal.startsWith(DEV_GOAL_PREFIX)

/** Roles that write the code of a feature. */
export const DEV_ROLES: readonly string[] = ['lead_developer', 'backend_developer', 'frontend_developer', 'game_developer']

/** The role that tests the finished work. */
export const QA_ROLE = 'qa_tester'

/** "./Assets\Scripts/" → "assets/scripts": one spelling for comparing paths (Windows paths are not case-sensitive). */
export const normPath = (p: string): string => p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()

/** Two file/folder claims clash when they are the same path or one is a folder that contains the other. */
export const pathsOverlap = (a: string, b: string): boolean => {
  const x = normPath(a)
  const y = normPath(b)
  return x !== '' && y !== '' && (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`))
}

/** How long a developer waits for a file another developer is editing before giving up (ms). */
export const LOCK_WAIT_MS = 8 * 60_000
