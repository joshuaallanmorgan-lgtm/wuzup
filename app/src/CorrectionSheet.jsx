import { useEffect, useRef, useState } from 'react'
import { CORRECTION_PROBLEMS } from './correction-state-core.js'
import { correctionEvidence, useCorrections } from './corrections.js'
import './correction.css'

export default function CorrectionSheet({ item, onClose }) {
  const { submit } = useCorrections()
  const [problem, setProblem] = useState('wrong-time')
  const [detail, setDetail] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [error, setError] = useState(null)
  const dialogRef = useRef(null)
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])
  const save = () => {
    const result = submit({ item: correctionEvidence(item), problem, detail })
    if (!result.changed) {
      setError(result.code === 'correction-cap-reached' ? 'The on-device correction queue is full.' : 'Could not record this correction safely.')
      return
    }
    setReceipt(result)
  }
  const trap = (event) => {
    if (event.key === 'Escape') onClose()
    if (event.key !== 'Tab') return
    const nodes = [...dialogRef.current.querySelectorAll('button, select, textarea')].filter((node) => !node.disabled)
    if (!nodes.length) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return (
    <div className="correction-wrap">
      <button className="correction-scrim" onClick={onClose} aria-label="Close correction form" />
      <section ref={dialogRef} className="correction-sheet" role="dialog" aria-modal="true" aria-labelledby="correction-title" tabIndex={-1} onKeyDown={trap}>
        <header className="correction-head">
          <div>
            <h2 id="correction-title">Suggest a correction</h2>
            <p>{item?.title || item?.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">&times;</button>
        </header>
        {receipt ? (
          <div className="correction-done" role="status">
            <strong>Recorded on this device</strong>
            <p>Receipt {receipt.correction.id}</p>
            <p>{receipt.persisted ? 'It will be included when you export correction receipts.' : 'Browser storage failed, so this receipt lasts only for this visit.'}</p>
            <p>This has not been sent or monitored.</p>
            <button type="button" className="correction-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <label>
              <span>What needs fixing?</span>
              <select value={problem} onChange={(event) => setProblem(event.target.value)}>
                {CORRECTION_PROBLEMS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Details <small>(optional)</small></span>
              <textarea value={detail} maxLength={1000} rows={4} onChange={(event) => setDetail(event.target.value)} placeholder="What should someone verify?" />
            </label>
            <div className="correction-evidence">
              The receipt includes this item’s ID, coverage area, source family, source link, problem, and time.
            </div>
            {error && <div className="correction-error" role="alert">{error}</div>}
            <button type="button" className="correction-primary" onClick={save}>Record correction</button>
            <p className="correction-disclosure">Saved locally until you export it. Wuzup does not claim automatic delivery or monitoring.</p>
          </>
        )}
      </section>
    </div>
  )
}
