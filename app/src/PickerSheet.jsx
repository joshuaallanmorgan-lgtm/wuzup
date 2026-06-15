// PickerSheet — the saved-first slot picker bottom sheet (Sprint U-a).
// Extracted from WeekendBuilder's K2 sheet so the day screen and the weekend
// view share ONE picker surface; markup, classes and behavior are the K2
// originals (styles stay in weekend.css). The parent owns mount + the
// closing-state machine (mirrors the WB pattern); this component owns the
// rows and the capture-phase Escape that closes the sheet BEFORE App's
// window listener can close the whole subpage.
//
// Props:
//   title    — sheet heading ("☀️ Saturday daytime")
//   model    — pickerModel() output: { saved, suggestions }
//   noSaves  — true when the user has NO saves at all (shows the ♥ hint)
//   closing  — plays the slide-down exit animation
//   onPick(e) / onClose()
import { useEffect } from 'react'
import { keyOf, timeOf } from './lib.js'
import { CardImg, SponsoredTag } from './cards.jsx'
import { daypartOf } from './weekend.js'
import './weekend.css'

export default function PickerSheet({ title, model, noSaves, closing, onPick, onClose }) {
  // Escape closes the sheet BEFORE App's window listener can close the whole
  // page (capture phase runs first; stopPropagation keeps the page up)
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const pickRow = (e) => (
    <button key={keyOf(e)} className="wkb-pick pressable" onClick={() => onPick(e)}>
      <CardImg e={e} className="wkb-pick-img" />
      <span className="wkb-pick-main">
        <span className="wkb-pick-title">{e.title}</span>
        <span className="wkb-pick-meta">
          {[daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null, e.venue].filter(Boolean).join(' · ')}
        </span>
        <SponsoredTag e={e} />
      </span>
      <span className="wkb-pick-add" aria-hidden>
        +
      </span>
    </button>
  )

  return (
    <div className={'wkb-sheet-wrap' + (closing ? ' closing' : '')}>
      <button className="wkb-scrim" onClick={onClose} aria-label="Close picker" />
      <div className="wkb-sheet" role="dialog" aria-label="Pick an event">
        <div className="wkb-sheet-head">
          <div className="wkb-sheet-title">{title}</div>
          <button className="wkb-sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="wkb-sheet-body">
          {model.saved.length > 0 && (
            <>
              <div className="wkb-group">From your list ❤️</div>
              {model.saved.map(pickRow)}
            </>
          )}
          {noSaves && <div className="wkb-note">♥ save things and they'll show up here first</div>}
          {model.suggestions.length > 0 && (
            <>
              <div className="wkb-group">Top picks 🔥</div>
              {model.suggestions.map(pickRow)}
            </>
          )}
          {model.saved.length === 0 && model.suggestions.length === 0 && (
            <div className="wkb-note">Nothing fits this slot yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
