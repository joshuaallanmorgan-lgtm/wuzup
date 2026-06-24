// PickerSheet — the add-to-slot picker bottom sheet (Sprint U-a; Plan Phase 2
// flows-1 p3). Tap an empty daypart slot on DayPage → "Add a {daypart} plan"
// with Suggested / Saved TABS, a daypart-aware list (pickerModel does the real
// filtering — Phase 0 ternary slots), each row a one-tap +. The parent owns
// mount + the closing-state machine; this owns the rows, the tabs, and the
// capture-phase Escape that closes the sheet BEFORE App's window listener can
// close the whole subpage.
//
// Props:
//   part     — the daypart id ('morning'|'afternoon'|'night') being filled
//   dayLabel — the day label ("Today" / "Saturday") for the subline
//   model    — pickerModel() output: { saved, suggestions }
//   noSaves  — true when the user has NO saves at all (the ♥ hint)
//   closing  — plays the slide-down exit animation
//   onPick(e) / onClose()
import { useEffect, useState } from 'react'
import { keyOf, timeOf } from './lib.js'
import { CardImg, SponsoredTag } from './cards.jsx'
import { daypartOf, DAYPART } from './weekend.js'
import './weekend.css'

export default function PickerSheet({ part, dayLabel, model, noSaves, closing, onPick, onClose }) {
  // default to whichever group has something; prefer Suggested (the ref default)
  const [tab, setTab] = useState(model.suggestions.length === 0 && model.saved.length > 0 ? 'saved' : 'suggested')

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

  const partLow = part ? DAYPART[part].label.toLowerCase() : 'plan'
  const art = part === 'afternoon' ? 'an' : 'a'
  const heading = part ? `Add ${art} ${partLow} plan` : 'Add a plan'

  const pickRow = (e, top = false) => (
    <button key={keyOf(e)} className={'wkb-pick pressable' + (top ? ' wkb-pick-top' : '')} onClick={() => onPick(e)}>
      <CardImg e={e} className="wkb-pick-img" />
      <span className="wkb-pick-main">
        <span className="wkb-pick-title">{e.title}</span>
        <span className="wkb-pick-meta">
          {[daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null, e.venue].filter(Boolean).join(' · ')}
        </span>
        {(e._why || top) && (
          <span className="wkb-pick-why">
            {top && <span className="wkb-pick-star">★ Top pick</span>}
            {e._why && <span className="wkb-pick-fit">{e._why}</span>}
          </span>
        )}
        <SponsoredTag e={e} />
      </span>
      <span className="wkb-pick-add" aria-hidden>
        +
      </span>
    </button>
  )

  const list = tab === 'saved' ? model.saved : model.suggestions
  const sub =
    tab === 'saved'
      ? 'From your saved list'
      : `Suggested for the ${partLow}${dayLabel ? ' · ' + dayLabel : ''}`

  return (
    <div className={'wkb-sheet-wrap' + (closing ? ' closing' : '')}>
      <button className="wkb-scrim" onClick={onClose} aria-label="Close picker" />
      <div className="wkb-sheet" role="dialog" aria-label={heading}>
        <div className="wkb-sheet-head">
          <div className="wkb-sheet-title">{heading}</div>
          <button className="wkb-sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {/* Suggested / Saved tabs (flows-1 p3) */}
        <div className="wkb-tabs" role="tablist">
          <button
            className={'wkb-tab' + (tab === 'suggested' ? ' on' : '')}
            role="tab"
            aria-selected={tab === 'suggested'}
            onClick={() => setTab('suggested')}
          >
            Suggested
          </button>
          <button
            className={'wkb-tab' + (tab === 'saved' ? ' on' : '')}
            role="tab"
            aria-selected={tab === 'saved'}
            onClick={() => setTab('saved')}
          >
            Saved{model.saved.length ? ` (${model.saved.length})` : ''}
          </button>
        </div>
        <div className="wkb-sheet-sub">{sub}</div>
        <div className="wkb-sheet-body">
          {list.length > 0 ? (
            list.map((e, i) => pickRow(e, tab === 'suggested' && i === 0))
          ) : tab === 'saved' ? (
            <div className="wkb-note">
              {noSaves ? "♥ save things and they'll show up here first" : 'None of your saved picks fit this slot.'}
            </div>
          ) : (
            <div className="wkb-note">Nothing fits this slot yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
