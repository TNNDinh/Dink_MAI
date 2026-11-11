import { AlertTriangle, CheckCircle2, FileArchive, FolderOpen, Loader2, PackageOpen, Smartphone } from 'lucide-react'
import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { ApkBundleInfo, ApkConvertResult, ApkInstallResult, ApkProgress, ApkToolsStatus } from '../../../shared/ipc'
import { Badge, Button, Card, CardHeader, Input, PageHeader, cx } from '../components/ui'

const ANDROID_OF_SDK: Record<number, string> = { 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' }
const androidOf = (sdk: number): string => (ANDROID_OF_SDK[sdk] ? `Android ${ANDROID_OF_SDK[sdk]}` : '')
/** BlueStacks' default instance is Android 11, which is SDK 30. */
const EMULATOR_SDK = 30

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line/60 px-4 py-2 last:border-0">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12px] break-all" data-selectable>
        {children}
      </dd>
    </div>
  )
}

/** Drop an .xapk (or .apkm / .apks) and get one installable .apk back, no project or agent needed. */
export function ApkTool() {
  const [status, setStatus] = useState<ApkToolsStatus | null>(null)
  const [info, setInfo] = useState<ApkBundleInfo | null>(null)
  const [result, setResult] = useState<ApkConvertResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState<ApkInstallResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const [log, setLog] = useState<ApkProgress[]>([])
  const [lower, setLower] = useState(false)
  const [sdk, setSdk] = useState(String(EMULATOR_SDK))

  useEffect(() => {
    void window.api.invoke('apk:status').then(setStatus, () => undefined)
    return window.api.onApkProgress((p) => setLog((l) => [...l, p]))
  }, [])

  // The result card sits below the options; bring it into view when it appears.
  useEffect(() => {
    if (result) document.querySelector('[data-apk-result]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [result])

  const load = async (path: string) => {
    setError('')
    setResult(null)
    setInstalled(null)
    setLog([])
    setInfo(null)
    try {
      const next = await window.api.invoke('apk:inspect', path)
      setInfo(next)
      // The common failure: a game that needs a newer Android than the emulator has. Offer the fix, but leave it to the user.
      setLower(false)
      setSdk(String(EMULATOR_SDK))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const pick = async () => {
    try {
      const path = await window.api.invoke('apk:pickFile')
      if (path) await load(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const file = e.dataTransfer.files[0]
    if (!file) return
    let path = ''
    try {
      path = window.api.pathForFile(file)
    } catch {
      /* handled below */
    }
    if (!path) setError('Could not read the location of the dropped file. Use “Choose file…” instead.')
    else void load(path)
  }

  const sdkNumber = Number(sdk)
  const sdkValid = Number.isInteger(sdkNumber) && sdkNumber >= 1 && sdkNumber <= 60
  const convert = async () => {
    if (!info) return
    setBusy(true)
    setError('')
    setResult(null)
    setInstalled(null)
    setLog([])
    try {
      setResult(await window.api.invoke('apk:convert', { path: info.path, minSdk: lower && sdkValid ? sdkNumber : null }))
      void window.api.invoke('apk:status').then(setStatus, () => undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    if (!result) return
    setInstalling(true)
    setError('')
    setInstalled(null)
    setLog([])
    try {
      setInstalled(await window.api.invoke('apk:install', { path: result.outputPath, packageName: info?.packageName ?? null }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(false)
    }
  }

  const tooNew = info?.minSdk != null && info.minSdk > EMULATOR_SDK

  return (
    <div className="page-enter mx-auto max-w-3xl space-y-4 p-6">
      <PageHeader title="XAPK to APK" subtitle="Drop a .xapk / .apkm / .apks (or a folder of split apks). The parts are merged into one signed .apk saved next to the original file." />

      <div
        data-apk-drop
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx('flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors', dragging ? 'border-accent bg-accent-soft' : 'border-line bg-panel')}
      >
        <PackageOpen size={32} className={dragging ? 'text-accent' : 'text-faint'} />
        <div>
          <p className="text-[13px] font-medium">{dragging ? 'Release to load the file' : 'Drag an .xapk file here'}</p>
          <p className="mt-0.5 text-xs text-muted">or pick one from your computer</p>
        </div>
        <Button disabled={busy} onClick={() => void pick()}>
          <FolderOpen size={14} /> Choose file…
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-err/30 bg-err/10 p-3 text-xs text-err" role="alert">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <pre className="font-sans break-words whitespace-pre-wrap" data-selectable>
            {error}
          </pre>
        </div>
      )}

      {info && (
        <Card>
          <CardHeader title={info.name ?? info.fileName} action={<Badge>{info.kind === 'bundle' ? 'bundle' : info.kind}</Badge>} />
          <dl>
            <Row label="File">
              <span className="inline-flex items-center gap-1.5">
                <FileArchive size={12} className="text-faint" /> {info.fileName}
                {info.sizeBytes > 0 && <span className="text-faint">· {mb(info.sizeBytes)}</span>}
              </span>
            </Row>
            {info.packageName && <Row label="Package">{info.packageName}</Row>}
            {info.versionName && <Row label="Version">{info.versionName}</Row>}
            {info.minSdk !== null && (
              <Row label="Needs at least">
                SDK {info.minSdk} {androidOf(info.minSdk) && `(${androidOf(info.minSdk)})`}
                {tooNew && <span className="ml-2 text-warn">BlueStacks Android 11 is SDK {EMULATOR_SDK}: it will refuse to install this</span>}
              </Row>
            )}
            <Row label="Parts">{info.parts.length ? info.parts.join(', ') : 'none found'}</Row>
            {info.obbFiles.length > 0 && <Row label="OBB data"><span className="text-warn">{info.obbFiles.join(', ')} (an apk cannot hold these)</span></Row>}
          </dl>

          <div className="space-y-2 border-t border-line p-4">
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={lower} disabled={busy} onChange={(e) => setLower(e.target.checked)} />
              <span>
                <span className={tooNew ? 'font-medium text-warn' : 'font-medium'}>Lower the minimum Android version</span>
                <span className="block text-muted">So an older emulator or phone will install it. Changes the app’s manifest (it is re-signed with a debug key). The game may still crash if it needs features only newer Android has.</span>
              </span>
            </label>
            {lower && (
              <div className="flex items-center gap-2 pl-6 text-xs text-muted">
                SDK level
                <Input className="!w-20" inputMode="numeric" value={sdk} disabled={busy} onChange={(e) => setSdk(e.target.value.replace(/\D/g, ''))} />
                {sdkValid && androidOf(sdkNumber) && <span>= {androidOf(sdkNumber)}</span>}
                {!sdkValid && <span className="text-err">1 to 60</span>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line p-4">
            <p className="text-[11px] text-muted">
              {status && !status.java && <span className="text-err">Java was not found. Install Dink_ATU (it includes a JDK) or set JAVA_HOME. </span>}
              {status && status.downloadMegabytes > 0 && `First use downloads two helper tools (${status.downloadMegabytes.toFixed(1)} MB, kept for next time).`}
            </p>
            <div className="flex gap-2">
              {busy && (
                <Button variant="danger" onClick={() => void window.api.invoke('apk:cancel')}>
                  Cancel
                </Button>
              )}
              <Button variant="primary" disabled={busy || (lower && !sdkValid) || info.parts.length === 0} onClick={() => void convert()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : null} Convert to APK
              </Button>
            </div>
          </div>
        </Card>
      )}

      {(busy || installing || (log.length > 0 && !result)) && log.length > 0 && (
        <Card>
          <CardHeader title="Progress" />
          <ul className="space-y-1 p-4 text-xs text-muted" data-selectable>
            {log.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </Card>
      )}

      {result && (
        <Card data-apk-result>
          <CardHeader title="Done" action={<CheckCircle2 size={16} className="text-ok" />} />
          <dl>
            <Row label="Saved as">{result.outputPath}</Row>
            <Row label="Size">{mb(result.sizeBytes)}</Row>
            <Row label="Merged parts">{result.parts}</Row>
            {result.minSdkBefore !== null && (
              <Row label="Minimum SDK">
                {result.minSdkAfter !== result.minSdkBefore ? `${result.minSdkBefore} → ${result.minSdkAfter}` : `${result.minSdkBefore} (unchanged)`}
              </Row>
            )}
          </dl>
          {result.warnings.length > 0 && (
            <ul className="space-y-1.5 border-t border-line p-4 text-xs text-warn">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span data-selectable>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {installed && (
            <p className="flex items-start gap-2 border-t border-line p-4 text-xs text-ok" data-apk-installed>
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              <span data-selectable>
                Installed on {installed.serial}.{' '}
                {installed.installer === 'com.android.vending' ? 'Google Play is recorded as the installer, so the game should not send you to the Play Store.' : 'Could not confirm which installer was recorded.'}
              </span>
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-line p-4">
            <Button variant="primary" disabled={installing} onClick={() => void install()}>
              {installing ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />} Install on BlueStacks
            </Button>
            <Button onClick={() => void window.api.invoke('apk:reveal', result.outputPath).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}>
              <FolderOpen size={14} /> Show in folder
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
