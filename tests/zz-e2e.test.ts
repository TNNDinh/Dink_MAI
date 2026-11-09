import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Database } from '../src/main/db/database'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { AgentService } from '../src/main/services/agents'
import { ChatService } from '../src/main/services/chat'
import { ConnectionService } from '../src/main/services/connections'
import { EventService } from '../src/main/services/events'
import { TaskService } from '../src/main/services/tasks'
import { ApprovalService, CommandService } from '../src/main/workspace/commands'
import { ContextIndexer } from '../src/main/workspace/indexer'
import { FileLocks } from '../src/main/workspace/locks'
import { WorkspaceService } from '../src/main/workspace/workspace'
import { MemorySecrets } from './helpers/memory-secrets'

const ROOT = 'D:/Projects/ATU_E2E'
const LOG = 'D:/Projects/ATU_E2E_run.log'
const log = (s: string) => appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`)

describe.skipIf(!process.env.DINH_E2E)('end to end with the real Claude Code CLI', () => {
  it('runs the Unity / ATU / gate flow', async () => {
    const db = new Database(':memory:')
    db.migrate()
    const events = new EventService(db)
    const conns = new ConnectionService(db, events, new MemorySecrets())
    const agents = new AgentService(db, events, conns)
    const tasks = new TaskService(db, events)
    const approvals = new ApprovalService()
    const commands = new CommandService(db, events, approvals)
    const ws = new WorkspaceService(db, events, new FileLocks(db), new ContextIndexer(db))
    const chat = new ChatService(db, events, conns)
    db.run(`INSERT INTO projects (id, name, type, root_path, goal, created_at, updated_at) VALUES ('p1', 'ATU E2E', 'game', ?, 'Document and rebuild a game', 1, 1)`, ROOT)
    const conn = await conns.create({ kind: 'claude-code', name: 'Claude Code', baseUrl: 'claude' })
    for (const role of ['project_manager', 'lead_developer']) agents.create({ templateKey: role, projectId: 'p1', connectionId: conn.id, model: role === 'project_manager' ? (process.env.DINH_E2E_PM_MODEL ?? 'opus') : (process.env.DINH_E2E_MODEL ?? 'sonnet') })

    // Approve only the commands this test expects the tools to run; deny everything else.
    const allowed = /Unity\.exe|apk2unity\.ps1|HD-Adb\.exe|^Select-String/
    const timer = setInterval(() => {
      for (const p of approvals.list()) {
        const ok = allowed.test(p.command)
        log(`APPROVAL ${ok ? 'yes' : 'NO '} ${p.command.slice(0, 200)}`)
        approvals.respond(p.id, ok)
      }
    }, 500)
    events.subscribe?.((e: { level: string; type: string; message: string }) => log(`EVENT ${e.level} ${e.type} ${e.message.slice(0, 200)}`))

    const orch = new Orchestrator(db, events, agents, chat, tasks, { workspace: ws, commands })
    const runAndWait = async (goal: string) => {
      const run = orch.start({ projectId: 'p1', goal, maxIterations: 1 } as never)
      log(`RUN START ${goal.slice(0, 80)}`)
      await orch.whenDone(run.id)
      const r = orch.getRun(run.id)
      log(`RUN END ${r?.status}`)
      for (const t of tasks.list({ runId: run.id })) log(`TASK ${t.status} ${t.title} :: ${(t.resultSummary ?? '').slice(0, 600).replace(/\n/g, ' | ')}`)
      return r
    }

    // Phase C: from the existing doc, write test cases, then the game code, then compile and run the tests.
    if (process.env.DINH_E2E_PHASE === 'C') {
      if (!process.env.DINH_E2E_SKIP_TC) {
        const c1 = await runAndWait(
          'Read docs/GAME_DOC.md. Write docs/TEST_CASES.md for rebuilding this game: a table of cases (id, what is checked, expected result), based only on what the doc says. Mark every case that depends on behaviour the doc says is unknown as "assumed". Finish with a short report.'
        )
        expect(c1?.status).toBe('completed')
      }
      // Small steps: one run has a limit of 12 tool rounds per task.
      const steps = [
        'Code already exists in Assets/Scripts (keep it, do not rewrite it). Create the EditMode test assembly: Assets/Tests/EditMode/VoxelDash.Tests.EditMode.asmdef (references the code assemblies in Assets/Scripts and the Unity test framework, editor only). Then write test files for the FIRST HALF of the cases in docs/TEST_CASES.md (TC-001 to TC-025), at most 3 test files. Do not run Unity.',
        'Code and an EditMode test assembly already exist (keep them). Check which cases of docs/TEST_CASES.md are already covered by files in Assets/Tests/EditMode and write test files for the REMAINING cases (about TC-026 onward), at most 3 test files. Do not run Unity.',
        'Run unity_run with mode "compile". Fix compile errors in Assets/Scripts or Assets/Tests (small edits), and compile again until it is clean. Report the result.',
        'Run unity_run with mode "test_editmode". Fix failing tests or code with small edits, run again. Report the real totals (passed/failed) from the output; if you could not read them, say so. Do not copy files from atu_output.'
      ]
      const review = 'Review the project against docs/GAME_DOC.md and docs/TEST_CASES.md: read Assets/Scripts and Assets/Tests briefly, check that no file was copied from atu_output, and that guesses are marked. Then write docs/REPORT.md, an honest final report: what was built, what is a guess, and the real compile/test result (last verified: compile clean, EditMode 56 passed, 0 failed, 1 skipped, exit code 0).'
      for (const s of process.env.DINH_E2E_ONLY_REVIEW ? [review] : [...steps, review]) {
        const r = await runAndWait(s)
        expect(r?.status).toBe('completed')
      }
      clearInterval(timer)
      writeFileSync('D:/Projects/ATU_E2E_done.txt', 'done C')
      return
    }

    // Phase A: study the APK and document it.
    const a = await runAndWait(
      'The file input/VoxelDash.apk is our own game. Use the apk_to_unity tool: first action "analyze" with name "an1", then action "convert" with name "run1" and skip_asset_ripper false. ' +
        'Then, from the files in atu_output/run1 (REPORT.md and a few targeted search_files queries into il2cpp/dump.cs, never read the whole dump), write docs/GAME_DOC.md: engine, version, the main systems you can identify from class names, and what could not be recovered. Finish with a short report.'
    )
    expect(a?.status).toBe('completed')

    if (process.env.DINH_E2E_PHASE === 'A') { clearInterval(timer); log(`DOC exists: ${existsSync(join(ROOT, 'docs', 'GAME_DOC.md'))}`); return }
    // Simulate the agent reusing original textures in the new game, so the gate has something to find.
    mkdirSync(join(ROOT, 'Assets', 'Art'), { recursive: true })
    const texDir = join(ROOT, 'atu_output', 'run1', 'UnityProject', 'ExportedProject', 'Assets', 'Texture2D')
    const pngs = existsSync(texDir) ? readdirSync(texDir).filter((f) => f.endsWith('.png')).slice(0, 5) : []
    for (const f of pngs) copyFileSync(join(texDir, f), join(ROOT, 'Assets', 'Art', f))
    log(`COPIED ${pngs.length} original textures into Assets/Art`)

    // Phase B: the gate.
    const b = await runAndWait(
      'Use the android_build tool. 1) Try target "aab". 2) If it is refused because assets are still the original files from the APK, delete every file the message lists with delete_file (also their .meta files if present), then try "aab" again. ' +
        '3) Also build target "apk". Report exactly what each build call returned, including any warning at the start of the result.'
    )
    expect(b?.status).toBe('completed')
    clearInterval(timer)
    log(`DOC exists: ${existsSync(join(ROOT, 'docs', 'GAME_DOC.md'))}`)
    log(`BUILDS: ${existsSync(join(ROOT, 'Builds')) ? readdirSync(join(ROOT, 'Builds')).join(', ') : 'none'}`)
    writeFileSync('D:/Projects/ATU_E2E_done.txt', 'done')
    void readFileSync
  }, 3_600_000)
})
