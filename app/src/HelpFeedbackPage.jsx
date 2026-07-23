import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { useCorrections } from './corrections.js'
import './profile.css'

function downloadJson(value, name) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function HelpFeedbackPage() {
  const { closePage: onClose } = useNav()
  const { corrections, durability, export: exportReceipt, status } = useCorrections()
  const exportCorrections = () => downloadJson(exportReceipt(), 'wuzup-correction-receipts.json')
  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back"><Icon.chevron /></button>
        <h1 className="pg-head-title">Help &amp; Feedback</h1>
      </header>
      <div className="pg-body">
        <div className="hf-hero">
          <div className="hf-hero-title">Help improve local listings</div>
          <div className="hf-hero-sub">Open an event or spot and choose Suggest a correction. Wuzup records the item ID, source, issue, and time.</div>
        </div>
        <section className="pf-id-card">
          <h2 className="pf-row-label">Correction receipts</h2>
          {status === 'corrupt' ? (
            <p role="alert">Stored correction receipts could not be read safely. New reports are paused so nothing gets overwritten.</p>
          ) : (
            <>
              <p>{corrections.length} receipt{corrections.length === 1 ? '' : 's'} on this device.</p>
              {durability === 'session-only' && <p role="status">Browser storage is unavailable; current receipts last only for this visit.</p>}
              <button className="empty-cta" type="button" disabled={corrections.length === 0} onClick={exportCorrections}>
                Export correction receipts
              </button>
              <p className="ep-optional">Exporting creates a JSON file you can choose to share. Receipts are not automatically sent or monitored.</p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
