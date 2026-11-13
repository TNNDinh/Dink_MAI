import { Copy, FolderOpen, Lock, ShieldAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { AtuStatus, CommandPolicyInfo, McpStatus } from '../../../shared/ipc'
import { useStudio } from '../store'
import { Badge, Button, Card, CardHeader, PageHeader } from '../components/ui'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line/60 px-4 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12px] break-all" data-selectable>
        {children}
      </dd>
    </div>
  )
}

const SOURCE_TEXT = { setting: 'picked in Settings', env: 'DINK_ATU_DIR variable', default: 'found automatically' } as const

/** Where Dink_ATU (APK to Unity) is on this PC: pick the folder instead of downloading it again. */
function AtuTool() {
  const [status, setStatus] = useState<AtuStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.api.invoke('tools:atuStatus').then(setStatus, () => undefined)
  }, [])
  const run = async (channel: 'tools:atuBrowse' | 'tools:atuClear') => {
    setBusy(true)
    setError('')
    try {
      const next = await window.api.invoke(channel)
      if (next) setStatus(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader
        title="Tools"
        action={
          <div className="flex gap-2">
            {status?.configured && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('tools:atuClear')}>
                Forget
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => void run('tools:atuBrowse')}>
              <FolderOpen size={13} /> Browse…
            </Button>
          </div>
        }
      />
      <dl>
        <Row label="Dink_ATU (APK to Unity)">
          {!status ? (
            'Checking…'
          ) : status.dir ? (
            <span className="text-ok">{status.dir}</span>
          ) : (
            <span className="text-warn">Not found. Press Browse and pick the folder that contains apk2unity.ps1 (for example D:\apk2unity).</span>
          )}
        </Row>
        {status?.dir && <Row label="Chosen how">{SOURCE_TEXT[status.source ?? 'default']}</Row>}
        {status?.dir && !status.toolsInstalled && <Row label="Setup">This folder has no tools/ yet. Run setup.ps1 -WithGhidra in it once (about 600 MB).</Row>}
        {status?.configured && status.configuredValid === false && <Row label="Warning">The folder you picked ({status.configured}) no longer has apk2unity.ps1, so it is being ignored.</Row>}
        {error && <Row label="Error"><span className="text-err">{error}</span></Row>}
      </dl>
    </Card>
  )
}

/** Lets an AI client such as Claude Code operate the Studio through local MCP tools, instead of controlling the screen. */
function McpAccess() {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void window.api.invoke('mcp:status').then(setStatus, () => undefined)
  }, [])
  const run = async (channel: 'mcp:setEnabled' | 'mcp:rotateToken', arg?: boolean) => {
    setBusy(true)
    setError('')
    try {
      setStatus(channel === 'mcp:setEnabled' ? await window.api.invoke(channel, arg === true) : await window.api.invoke(channel))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!status?.registerCommand) return
    try {
      await navigator.clipboard.writeText(status.registerCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy. Select the command and copy it by hand.')
    }
  }
  return (
    <Card>
      <CardHeader
        title="AI access (MCP)"
        action={
          status && (
            <Button size="sm" variant={status.enabled ? 'ghost' : undefined} disabled={busy} onClick={() => void run('mcp:setEnabled', !status.enabled)}>
              {status.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          )
        }
      />
      <dl>
        <Row label="What it does">Lets Claude Code or another MCP client use this app directly: read and create projects, tasks and runs, read and edit project files, and operate the window with real clicks. It cannot approve commands or change approval settings for you.</Row>
        <Row label="Status">
          {!status ? 'Checking…' : status.running ? <span className="text-ok">On, {status.url}</span> : status.enabled ? <span className="text-err">Could not start</span> : 'Off'}
        </Row>
        {status?.running && <Row label="Tools">{status.toolCount} (see the list with your client, or call app_channels for every app function)</Row>}
        {status?.running && status.registerCommand && (
          <Row label="Connect Claude Code">
            <div className="flex flex-col items-end gap-2">
              <code className="rounded bg-black/30 px-2 py-1 text-left font-mono text-[11px]">{status.registerCommand}</code>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('mcp:rotateToken')}>
                  New token
                </Button>
                <Button size="sm" onClick={() => void copy()}>
                  <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          </Row>
        )}
        <Row label="Safety">Only programs on this PC can connect, and only with the token above. Anyone who has the token can use everything this page lists, so treat it like a password; “New token” cuts off every client that has the old one.</Row>
        {status?.error && <Row label="Problem"><span className="text-err">{status.error}</span></Row>}
        {error && <Row label="Error"><span className="text-err">{error}</span></Row>}
      </dl>
    </Card>
  )
}

/** Mostly read-only: shows the facts that matter for trust, plus where external tools live. */
export function Settings() {
  const info = useStudio((s) => s.info)
  const [policy, setPolicy] = useState<CommandPolicyInfo | null>(null)
  useEffect(() => {
    void window.api.invoke('term:policy').then(setPolicy, () => undefined)
  }, [])
  if (!info) return <p className="p-6 text-xs text-faint">Loading…</p>

  return (
    <div className="page-enter mx-auto max-w-3xl space-y-4 p-6">
      <PageHeader title="Settings" subtitle="System and security information for this installation." />

      <Card>
        <CardHeader title="Security" />
        <dl>
          <Row label="API key encryption">
            {info.encryptionAvailable ? (
              <span className="inline-flex items-center gap-1 text-ok">
                <Lock size={12} /> Windows DPAPI available
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-err">
                <ShieldAlert size={12} /> Unavailable: keys cannot be saved
              </span>
            )}
          </Row>
          <Row label="Key storage">Encrypted file in the data folder, bound to your Windows user. Never stored in plain text.</Row>
          <Row label="Keys in the UI">Never sent to the interface after saving. Only “a key is stored” is shown.</Row>
          <Row label="Renderer isolation">Sandboxed, context-isolated, no Node access. Only an allow-listed set of IPC calls is exposed.</Row>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Commands and files" />
        <dl>
          <Row label="Agent file access">Only inside the project folder. Links and junctions that lead elsewhere are refused. Agents cannot read or write credential files such as .env, keys and certificates, nor the .git folder.</Row>
          <Row label="Agent commands">
            Each agent has a setting: none, ask every time, or allow-list. With the allow-list, only the safe commands below run unattended; everything else waits for your approval in a dialog.
          </Row>
          <Row label="Always blocked">Destructive or privilege-changing commands are refused for everyone, even if you would approve them.</Row>
          <Row label="Limits">This is a guard rail, not an operating-system sandbox: a command you allow runs with your Windows user’s permissions. Commands get a cleaned environment (no API keys or tokens), no keyboard input, and a time limit.</Row>
        </dl>
        {policy && (
          <div className="grid gap-4 border-t border-line p-4 md:grid-cols-2" data-policy>
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ok uppercase">Runs without asking (allow-list)</h4>
              <ul className="space-y-1 text-[12px] text-muted">
                {policy.safe.map((s) => (
                  <li key={s} className="font-mono" data-selectable>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-err uppercase">Always blocked</h4>
              <ul className="space-y-1 text-[12px] text-muted">
                {policy.blocked.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>

      <McpAccess />

      <AtuTool />

      <Card>
        <CardHeader title="Storage" />
        <dl>
          <Row label="Data folder">{info.userDataPath}</Row>
          <Row label="Default projects folder">{info.defaultProjectsRoot}</Row>
          <Row label="Database schema">v{info.dbVersion}</Row>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Application" />
        <dl>
          <Row label="Version">{info.version}</Row>
          <Row label="Electron / Node">
            {info.electron} / {info.node}
          </Row>
          <Row label="Platform">{info.platform}</Row>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Not yet available" />
        <ul className="space-y-2 p-4 text-xs text-muted">
          <li className="flex items-center justify-between gap-3">
            Interactive terminal (a real shell with typed input) <Badge>Not built</Badge>
          </li>
          <li className="flex items-center justify-between gap-3">
            App-wide default budget and review-round limits (today they are set per project and per run) <Badge>Not built</Badge>
          </li>
        </ul>
      </Card>
    </div>
  )
}
