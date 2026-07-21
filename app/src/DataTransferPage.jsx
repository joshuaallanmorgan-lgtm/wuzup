import { useRef, useState } from 'react'
import { LOCAL_STATE_TRANSFER_MAX_BYTES } from './local-state-transfer.js'
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { useStateTransfer } from './StateTransferProvider.jsx'
import './data-transfer.css'

function downloadJson(raw, cityId) {
  const blob = new Blob([raw], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `wuzup-${cityId}-backup.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function DataTransferPage() {
  const { closePage } = useNav()
  const transfer = useStateTransfer()
  const fileRef = useRef(null)
  const [raw, setRaw] = useState('')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const exportData = () => {
    const exported = transfer.exportJson()
    setResult(exported)
    if (exported.ok) downloadJson(exported.raw, transfer.activeCity.id)
  }
  const chooseFile = async (event) => {
    const file = event.target.files?.[0]
    setArmed(false)
    setResult(null)
    if (!file) return
    if (file.size > LOCAL_STATE_TRANSFER_MAX_BYTES) {
      setRaw('')
      setResult({ ok: false, code: 'STATE_BUNDLE_TOO_LARGE' })
      return
    }
    try {
      setRaw(await file.text())
    } catch {
      setRaw('')
      setResult({ ok: false, code: 'STATE_BUNDLE_READ_FAILED' })
    }
  }
  const importData = async () => {
    if (!raw.trim() || busy) return
    if (!armed) {
      setArmed(true)
      setResult(null)
      return
    }
    setBusy(true)
    const imported = await transfer.importJson(raw, { mode: 'replace' })
    setResult(imported)
    setBusy(false)
    setArmed(false)
  }
  const summary = result?.summary

  return (
    <div className="pg data-transfer" data-transfer-status={transfer.status} data-transfer-blockers={transfer.blockers.join(',')}>
      <header className="pg-head">
        <button className="pg-back" onClick={closePage} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Export &amp; restore</h1>
      </header>
      <div className="pg-body data-transfer-body">
        <section className="data-transfer-card">
          <div className="data-transfer-over">Keep a copy</div>
          <h2>Download your Wuzup data</h2>
          <p>Includes your plans, saves, added events, corrections, taste, profile, onboarding choice, and recent searches for this coverage area.</p>
          <button className="data-transfer-primary" type="button" onClick={exportData} disabled={!transfer.ready}>
            Download JSON backup
          </button>
          {!transfer.ready && <p className="data-transfer-note" role="status">Your local stores are still loading or need recovery. Export and restore stay paused until every included store is durably readable.</p>}
          <p className="data-transfer-note">Current location, permission state, weather, listings, and caches are never included.</p>
        </section>

        <section className="data-transfer-card">
          <div className="data-transfer-over">Restore this device</div>
          <h2>Replace local Wuzup data</h2>
          <p>Choose a backup from this exact coverage area. Wuzup saves a durable pre-import backup first, then stops at the first store it cannot verify.</p>
          <input
            ref={fileRef}
            className="data-transfer-file"
            type="file"
            accept="application/json,.json"
            aria-label="Choose Wuzup backup file"
            disabled={!transfer.ready}
            onChange={chooseFile}
          />
          <button className="data-transfer-secondary" type="button" onClick={() => fileRef.current?.click()} disabled={!transfer.ready}>
            {raw ? 'Choose a different backup' : 'Choose backup file'}
          </button>
          {raw && <div className="data-transfer-ready">Backup loaded and ready to verify.</div>}
          {raw && (
            <button
              className={armed ? 'data-transfer-danger' : 'data-transfer-primary'}
              type="button"
              onClick={importData}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy
                ? 'Verifying every store…'
                : armed
                  ? 'Confirm: replace this device’s Wuzup data'
                  : 'Review and restore backup'}
            </button>
          )}
          {armed && !busy && (
            <button className="data-transfer-cancel" type="button" onClick={() => setArmed(false)}>
              Keep current data
            </button>
          )}
        </section>

        {result && (
          <div className={result.ok ? 'data-transfer-result success' : 'data-transfer-result'} role="status" aria-live="polite">
            {result.ok && summary?.fullSuccess
              ? 'Restore verified. Reload Wuzup to refresh every screen from the restored data.'
              : summary?.status === 'partial'
                ? `Restore stopped after ${summary.succeeded} verified section${summary.succeeded === 1 ? '' : 's'}; ${summary.failed} section failed and ${summary.skipped} later section${summary.skipped === 1 ? ' was' : 's were'} not attempted.`
                : result.code === 'STATE_EXPORT_READY'
                  ? 'Backup downloaded.'
                  : `Nothing was reported as fully restored (${result.code || 'unknown error'}).`}
            {result.ok && summary?.fullSuccess && (
              <button type="button" onClick={() => window.location.reload()}>Reload Wuzup</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
