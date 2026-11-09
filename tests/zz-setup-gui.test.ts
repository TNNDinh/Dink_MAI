import { describe, expect, it } from 'vitest'
import { Database } from '../src/main/db/database'
import { AgentService } from '../src/main/services/agents'
import { ConnectionService } from '../src/main/services/connections'
import { EventService } from '../src/main/services/events'
import { MemorySecrets } from './helpers/memory-secrets'

// Not a real test: adds the VoxelDash project, a Claude Code connection and the agents to the owner's real app database.
describe.skipIf(!process.env.DINH_SETUP_GUI)('set up the real app database', () => {
  it('creates project, connection and agents', async () => {
    const db = new Database(process.env.DINH_SETUP_GUI as string)
    db.migrate()
    const events = new EventService(db)
    const conns = new ConnectionService(db, events, new MemorySecrets())
    const agents = new AgentService(db, events, conns)
    const now = Date.now()
    db.run(`INSERT INTO projects (id, name, type, root_path, goal, created_at, updated_at) VALUES ('voxel-e2e', 'VoxelDash rebuild', 'game', ?, 'Document and rebuild VoxelDash from its APK (own game)', ?, ?)`, 'D:/Projects/ATU_E2E', now, now)
    const conn = await conns.create({ kind: 'claude-code', name: 'Claude Code', baseUrl: 'claude' })
    agents.create({ templateKey: 'project_manager', projectId: 'voxel-e2e', connectionId: conn.id, model: 'opus' })
    agents.create({ templateKey: 'lead_developer', projectId: 'voxel-e2e', connectionId: conn.id, model: 'sonnet' })
    expect(db.get(`SELECT COUNT(*) AS n FROM agents WHERE project_id = 'voxel-e2e'`)).toBeTruthy()
  })
})
