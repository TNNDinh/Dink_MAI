import type { DeptId } from './departments'
import type { FloorKind } from './assets/floors'

/**
 * The office blueprint: the whole floor plan as plain data. Nothing here is computed from the project, the agents or a
 * random number, so the office looks the same every time it is opened. `layout.ts` turns it into tiles, walls, doors and
 * walking routes; `scene.ts` and `draw.ts` turn that into pixels. To move a room or a piece of furniture, edit this file.
 *
 * Plan (tile grid 42 × 31, x to the right-and-down, y to the left-and-down on screen):
 *
 *      x 0 ........ 11 | 12·13 | 14 ....... 27 | 28·29 | 30 ........ 41
 *   y 0  ┌─────────────┬───────┬───────────────┬───────┬─────────────┐   tall back wall (windows)
 *        │ GD          ⇄       │ PM            │       ⇄ QA          │
 *   y 10 ├──── ⇅ ──────┤  hub  └──────⇩────────┘  hub  ├──── ⇅ ──────┤   (the hub wraps the PM room:
 *        │ ART         ⇄       ·  HUB — collaboration  ·       ⇄ DEV         │    two corridors and the lounge)
 *   y 20 ├──── ⇅ ──────┤       ·  table, dashboards,  ·       ├──── ⇅ ──────┤
 *        │ AUDIO       ⇄       ·  seating, workstations·       ⇄ INTEG       │
 *   y 30 └─────────────┴───────┴──────⇩ entrance ──────┴─────────────┘
 *
 *  - every department room opens onto the hub by a door in the wall that faces it (⇄);
 *  - GD sits on ART (door ⇅), ART on AUDIO; QA on DEV, DEV on INTEG: DEV is next to QA and INTEG and across the hub from ART;
 *  - the PM room has its own door onto the hub, the entrance is the south door of the hub.
 *
 * A department room is 12 × 11: four columns of desks (4 rows, so 16 desks, the staff cap) and, beside them, a two-column
 * strip with what only that department has. The east wing is the west wing mirrored, so the strips face the hub.
 */

export type RoomId = DeptId | 'hub'

export const GRID_W = 42
export const GRID_H = 31
export const ROOM_W = 12
export const ROOM_H = 11
export const PM_W = 14
export const DESK_COLS = 4
export const DESK_ROWS = 4

export type FeatureKind =
  | 'board'
  | 'screen'
  | 'rack'
  | 'console'
  | 'booth'
  | 'speaker'
  | 'easel'
  | 'testbench'
  | 'station'
  | 'round-table'
  | 'table'
  | 'storage'
  | 'sofa'
  | 'plant'
  | 'cabinet'
  | 'cooler'
  | 'vending'
  | 'pm-desk'
  | 'stool'

/** A thing standing on the floor. Coordinates are local to the room (west-wing orientation; the east wing is mirrored). */
export interface Feature {
  /** What the studio brief calls it. */
  object: string
  kind: FeatureKind
  /** Which drawing a board or a screen shows, or the look of a workstation. */
  content?: string
  x: number
  y: number
  w: number
  h: number
  /** A workstation: a chair on the tile south of the desk. */
  chair?: boolean
}

export interface RoomSpec {
  id: RoomId
  x: number
  y: number
  w: number
  h: number
  floor: FloorKind
  /** East-wing rooms are the west-wing plan mirrored so that the feature strip faces the hub. */
  mirror: boolean
  /** Why the room exists. */
  purpose: string
  features: Feature[]
  /** Things of the brief that are part of the desks (monitors, tablets) or of the walls (boards painted on them). */
  deskGear: string[]
  wall: string[]
}

export interface DoorSpec {
  id: string
  /** h: a gap in a wall that runs along x (tiles x … x+len−1 of row y); v: a gap in a wall along y. */
  orient: 'h' | 'v'
  x: number
  y: number
  len: number
  a: RoomId
  b: RoomId
}

const f = (object: string, kind: FeatureKind, x: number, y: number, w = 1, h = 1, extra: Partial<Feature> = {}): Feature => ({ object, kind, x, y, w, h, ...extra })

/** Hub features are written in grid coordinates; the hub room starts at x = 11. */
const HUB_X = 11
const hub = (object: string, kind: FeatureKind, x: number, y: number, w = 1, h = 1, extra: Partial<Feature> = {}): Feature => f(object, kind, x - HUB_X, y, w, h, extra)

/** The stools around a w × h table whose top-left tile is (x, y): north side, south side, then the two ends. */
function ring(object: string, x: number, y: number, w: number, h: number, centre = false): Feature[] {
  const out: Feature[] = []
  const xs = Array.from({ length: w }, (_, i) => x + i)
  const order = centre ? [...xs].sort((a, b) => Math.abs(a - (x + (w - 1) / 2)) - Math.abs(b - (x + (w - 1) / 2))) : xs
  for (const sx of order) out.push(hub(object, 'stool', sx, y - 1))
  for (const sx of order) out.push(hub(object, 'stool', sx, y + h))
  for (let i = 0; i < h; i++) out.push(hub(object, 'stool', x - 1, y + i), hub(object, 'stool', x + w, y + i))
  return out
}

const staffRoom = (id: DeptId, x: number, y: number, floor: FloorKind, mirror: boolean, purpose: string, extra: Pick<RoomSpec, 'features' | 'deskGear' | 'wall'>): RoomSpec => ({
  id,
  x,
  y,
  w: ROOM_W,
  h: ROOM_H,
  floor,
  mirror,
  purpose,
  ...extra
})

export const ROOMS: RoomSpec[] = [
  // ── west wing ────────────────────────────────────────────────────────────────────────────────────────────────────
  staffRoom('gd', 0, 0, 'planks', false, 'Designs the game: rules, levels, the design document', {
    deskGear: ['workstations', 'prototype-monitors'],
    wall: ['gdd-wall'],
    features: [
      f('level-design-board', 'board', 9, 2, 2, 1, { content: 'level' }),
      f('gameplay-diagrams', 'board', 9, 4, 2, 1, { content: 'diagram' }),
      f('design-discussion-table', 'round-table', 9, 6, 2, 2),
      f('plant', 'plant', 10, 1)
    ]
  }),
  staffRoom('art', 0, 10, 'birch', false, 'Concept art, 2D and 3D assets, animation', {
    deskGear: ['concept-art-workstations', '2d-drawing-tablets', '3d-modeling-computers'],
    wall: [],
    features: [
      f('animation-preview-screen', 'screen', 9, 2, 2, 1, { content: 'animation' }),
      f('character-concept-board', 'board', 9, 4, 2, 1, { content: 'concept' }),
      f('asset-reference-wall', 'board', 9, 6, 2, 1, { content: 'reference' }),
      f('easel', 'easel', 10, 7),
      f('plant', 'plant', 10, 1)
    ]
  }),
  staffRoom('audio', 0, 20, 'acoustic', false, 'Sound and music: its own room, away from the noise', {
    deskGear: ['sound-designer-workstation'],
    wall: [],
    features: [
      f('recording-booth', 'booth', 9, 2, 2, 2),
      f('waveform-monitor', 'screen', 9, 4, 2, 1, { content: 'waveform' }),
      f('mixing-console', 'console', 9, 5, 2, 1),
      f('studio-speaker', 'speaker', 9, 6),
      f('studio-speaker', 'speaker', 10, 6),
      f('sound-library-storage', 'storage', 9, 7),
      f('sound-library-storage', 'storage', 10, 7)
    ]
  }),
  // ── east wing ────────────────────────────────────────────────────────────────────────────────────────────────────
  staffRoom('qa', 30, 0, 'lino', true, 'Tests what the developers build, finds and reproduces bugs', {
    deskGear: ['testing-stations', 'multi-monitor'],
    wall: [],
    features: [
      f('device-testing-bench', 'testbench', 9, 2, 2, 1),
      f('bug-tracking-board', 'board', 9, 4, 2, 1, { content: 'bugs' }),
      f('test-result-dashboard', 'screen', 9, 6, 2, 1, { content: 'results' }),
      f('bug-reproduction-workstation', 'station', 9, 7, 1, 1, { chair: true, content: 'qa' }),
      f('plant', 'plant', 10, 1)
    ]
  }),
  staffRoom('dev', 30, 10, 'carpet', true, 'Writes the code, in parallel, each on their own task', {
    deskGear: ['programmer-desks', 'multi-monitor', 'debugging-workstations'],
    wall: [],
    features: [
      f('build-server-cabinet', 'rack', 9, 2),
      f('build-server-cabinet', 'rack', 10, 2),
      f('technical-whiteboard', 'board', 9, 4, 2, 1, { content: 'whiteboard' }),
      f('progress-monitor', 'screen', 9, 6, 2, 1, { content: 'progress' }),
      f('plant', 'plant', 10, 1)
    ]
  }),
  staffRoom('integration', 30, 20, 'steel', true, 'Merges the work, builds it and ships it', {
    deskGear: ['integration-workstation'],
    wall: [],
    features: [
      f('deployment-server-rack', 'rack', 9, 2),
      f('deployment-server-rack', 'rack', 10, 2),
      f('version-control-dashboard', 'screen', 9, 4, 2, 1, { content: 'vcs' }),
      f('build-pipeline-monitor', 'screen', 9, 6, 2, 1, { content: 'pipeline' }),
      f('release-management-station', 'station', 9, 7, 1, 1, { chair: true, content: 'integration' }),
      f('build-status-display', 'screen', 10, 7, 1, 1, { content: 'build' })
    ]
  }),
  // ── the project manager, at the head of the hub ──────────────────────────────────────────────────────────────────
  {
    id: 'pm',
    x: 14,
    y: 0,
    w: PM_W,
    h: ROOM_H,
    floor: 'parquet',
    mirror: false,
    purpose: 'Plans the project, hands out the work and reviews what comes back',
    deskGear: [],
    wall: ['planning-board', 'sprint-board', 'status-monitors'],
    features: [
      f('document-cabinet', 'cabinet', 1, 2),
      f('document-cabinet', 'cabinet', 1, 3),
      f('document-cabinet', 'cabinet', 1, 4),
      f('pm-desk', 'pm-desk', 6, 3, 2, 1),
      f('meeting-table', 'table', 9, 5, 3, 2),
      f('lounge-sofa', 'sofa', 11, 2, 1, 2),
      f('task-assignment-workstation', 'station', 2, 6, 1, 1, { chair: true, content: 'pm' }),
      f('plant', 'plant', 1, 9),
      f('plant', 'plant', 12, 9)
    ]
  },
  // ── the hub ──────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'hub',
    x: HUB_X,
    y: 0,
    w: 20,
    h: GRID_H,
    floor: 'stone',
    mirror: false,
    purpose: 'Where every department meets: the big table, the shared screens, the lounge and the entrance',
    deskGear: [],
    wall: [],
    features: [
      hub('shared-project-dashboard', 'screen', 22, 12, 3, 1, { content: 'dashboard' }),
      hub('project-milestone-screen', 'screen', 15, 12, 3, 1, { content: 'milestone' }),
      hub('central-meeting-table', 'table', 17, 16, 3, 2),
      hub('central-meeting-table', 'table', 20, 16, 3, 2),
      ...ring('discussion-seating', 17, 16, 6, 2, true),
      hub('discussion-table', 'round-table', 14, 20, 2, 2),
      ...ring('discussion-seating', 14, 20, 2, 2),
      hub('discussion-table', 'round-table', 25, 20, 2, 2),
      ...ring('discussion-seating', 25, 20, 2, 2),
      hub('discussion-sofa', 'sofa', 28, 19, 1, 2),
      hub('discussion-sofa', 'sofa', 28, 21, 1, 2),
      ...[14, 16, 18, 23, 25, 27].map((x) => hub('common-workstation', 'station', x, 26, 1, 1, { chair: true, content: 'pm' })),
      hub('water-cooler', 'cooler', 14, 29),
      hub('vending-machine', 'vending', 27, 29),
      hub('plant', 'plant', 12, 1),
      hub('plant', 'plant', 29, 1),
      hub('plant', 'plant', 12, 11),
      hub('plant', 'plant', 29, 11),
      hub('plant', 'plant', 12, 27),
      hub('plant', 'plant', 29, 27)
    ]
  }
]

/** The openings. Every department opens onto the hub; neighbouring rooms have a door between them. */
export const DOORS: DoorSpec[] = [
  { id: 'gd-hub', orient: 'v', x: 11, y: 8, len: 2, a: 'gd', b: 'hub' },
  { id: 'art-hub', orient: 'v', x: 11, y: 18, len: 2, a: 'art', b: 'hub' },
  { id: 'audio-hub', orient: 'v', x: 11, y: 28, len: 2, a: 'audio', b: 'hub' },
  { id: 'qa-hub', orient: 'v', x: 30, y: 8, len: 2, a: 'qa', b: 'hub' },
  { id: 'dev-hub', orient: 'v', x: 30, y: 18, len: 2, a: 'dev', b: 'hub' },
  { id: 'integration-hub', orient: 'v', x: 30, y: 28, len: 2, a: 'integration', b: 'hub' },
  { id: 'pm-hub', orient: 'h', x: 19, y: 10, len: 2, a: 'pm', b: 'hub' },
  { id: 'entrance', orient: 'h', x: 20, y: 30, len: 2, a: 'hub', b: 'hub' },
  { id: 'gd-art', orient: 'h', x: 8, y: 10, len: 2, a: 'gd', b: 'art' },
  { id: 'art-audio', orient: 'h', x: 8, y: 20, len: 2, a: 'art', b: 'audio' },
  { id: 'qa-dev', orient: 'h', x: 32, y: 10, len: 2, a: 'qa', b: 'dev' },
  { id: 'dev-integration', orient: 'h', x: 32, y: 20, len: 2, a: 'dev', b: 'integration' }
]

/** Where a new hire appears (the entrance door) and where the hub table's seats look. */
export const ENTRANCE = { x: 20, y: 30 }
/** The middle of the big table, in tile-centre coordinates. */
export const HUB_TABLE_CENTRE = { x: 19.5, y: 16.5 }

/** What the brief asks for, department by department (checked by the tests against the plan above). */
export const REQUIRED_OBJECTS: Record<RoomId, string[]> = {
  pm: ['pm-desk', 'planning-board', 'sprint-board', 'meeting-table', 'status-monitors', 'task-assignment-workstation'],
  gd: ['workstations', 'gdd-wall', 'level-design-board', 'gameplay-diagrams', 'prototype-monitors', 'design-discussion-table'],
  art: ['concept-art-workstations', '2d-drawing-tablets', '3d-modeling-computers', 'character-concept-board', 'animation-preview-screen', 'asset-reference-wall'],
  audio: ['sound-designer-workstation', 'mixing-console', 'recording-booth', 'studio-speaker', 'waveform-monitor', 'sound-library-storage'],
  dev: ['programmer-desks', 'multi-monitor', 'technical-whiteboard', 'debugging-workstations', 'build-server-cabinet', 'progress-monitor'],
  qa: ['testing-stations', 'multi-monitor', 'bug-tracking-board', 'device-testing-bench', 'test-result-dashboard', 'bug-reproduction-workstation'],
  integration: ['integration-workstation', 'version-control-dashboard', 'build-pipeline-monitor', 'release-management-station', 'deployment-server-rack', 'build-status-display'],
  hub: ['central-meeting-table', 'shared-project-dashboard', 'discussion-seating', 'common-workstation', 'project-milestone-screen']
}

// ── how an agent looks in each state ─────────────────────────────────────────────────────────────────────────────────

export type AgentState = 'idle' | 'working' | 'thinking' | 'collaborating' | 'waiting' | 'blocked' | 'completed' | 'error'
export type Glyph = 'dash' | 'gear' | 'dots' | 'link' | 'hourglass' | 'bang' | 'check' | 'cross'
export type ScreenLook = 'on' | 'idle' | 'err' | 'off'

export interface StateLook {
  label: string
  color: string
  /** What the workstation screen shows. */
  screen: ScreenLook
  /** The marker over the head. */
  glyph: Glyph
  /** How the person moves: they type, sit still, stand and talk, shake (an error) or hop (a finished task). */
  motion: 'still' | 'type' | 'think' | 'talk' | 'shake' | 'hop'
}

export const STATE_LOOK: Record<AgentState, StateLook> = {
  idle: { label: 'IDLE', color: '#9aa4b2', screen: 'off', glyph: 'dash', motion: 'still' },
  working: { label: 'WORKING', color: '#4fb2ff', screen: 'on', glyph: 'gear', motion: 'type' },
  thinking: { label: 'THINKING', color: '#b18cff', screen: 'on', glyph: 'dots', motion: 'think' },
  collaborating: { label: 'COLLABORATING', color: '#3cc4b5', screen: 'idle', glyph: 'link', motion: 'talk' },
  waiting: { label: 'WAITING', color: '#f5b942', screen: 'idle', glyph: 'hourglass', motion: 'still' },
  blocked: { label: 'BLOCKED', color: '#ff8a5c', screen: 'err', glyph: 'bang', motion: 'still' },
  completed: { label: 'COMPLETED', color: '#52d674', screen: 'off', glyph: 'check', motion: 'hop' },
  error: { label: 'ERROR', color: '#ff6b61', screen: 'err', glyph: 'cross', motion: 'shake' }
}

// ── what the office shows when something happens ─────────────────────────────────────────────────────────────────────

export type EffectKind =
  | 'task-started'
  | 'task-completed'
  | 'agent-assigned'
  | 'agent-moved'
  | 'collaboration'
  | 'build-started'
  | 'build-completed'
  | 'test-failed'
  | 'bug-found'
  | 'release-completed'

export interface EffectLook {
  label: string
  color: string
  /** Seconds on screen. */
  seconds: number
  glyph: Glyph
}

export const EFFECT_LOOK: Record<EffectKind, EffectLook> = {
  'task-started': { label: 'Task started', color: '#4fb2ff', seconds: 2.6, glyph: 'gear' },
  'task-completed': { label: 'Task completed', color: '#52d674', seconds: 3, glyph: 'check' },
  'agent-assigned': { label: 'Agent assigned', color: '#e0b341', seconds: 3, glyph: 'dots' },
  'agent-moved': { label: 'Moving', color: '#9aa4b2', seconds: 1.6, glyph: 'dash' },
  collaboration: { label: 'Collaborating', color: '#3cc4b5', seconds: 3.2, glyph: 'link' },
  'build-started': { label: 'Build started', color: '#f5b942', seconds: 3, glyph: 'gear' },
  'build-completed': { label: 'Build completed', color: '#52d674', seconds: 3.4, glyph: 'check' },
  'test-failed': { label: 'Test failed', color: '#ff6b61', seconds: 4, glyph: 'cross' },
  'bug-found': { label: 'Bug found', color: '#ff8a5c', seconds: 4, glyph: 'bang' },
  'release-completed': { label: 'Release completed', color: '#e0b341', seconds: 5, glyph: 'check' }
}
