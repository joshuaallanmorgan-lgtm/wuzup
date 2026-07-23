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
//   model    — pickerModel() output: { saved, suggestions, suggestionPages }
//   noSaves  — true when the user has NO saves at all (the ♥ hint)
//   closing  — plays the slide-down exit animation
//   onPick(e) / onClose()
import { useRef, useState } from 'react'
import { keyOf, timeOf, tablistArrowKey } from './lib.js'
import { CardImg, SponsoredTag } from './cards.jsx'
import { daypartOf, DAYPART } from './weekend.js'
import ModalSheet from './ModalSheet.jsx'
import './weekend.css'

const PICKER_TAB_IDS = {
  suggested: 'picker-tab-suggested',
  saved: 'picker-tab-saved',
}
const PICKER_PANEL_IDS = {
  suggested: 'picker-panel-suggested',
  saved: 'picker-panel-saved',
}

export default function PickerSheet({ part, dayLabel, model, noSaves, closing, onPick, onClose, returnFocusRef, resolveFallbackFocus }) {
  const suggestionPages = model.suggestionPages?.length
    ? model.suggestionPages
    : model.suggestions.length
      ? [model.suggestions.map(item => ({ item, reasons: [], primaryReason: null }))]
      : []
  const suggestionKey = model.suggestionResetKey || suggestionPages
    .flat()
    .map(record => keyOf(record.item))
    .join('\u001f')
  const [suggestionRun, setSuggestionRun] = useState(() => ({ key: suggestionKey, page: 0 }))
  const suggestionPage = suggestionRun.key === suggestionKey
    ? Math.min(suggestionRun.page, Math.max(0, suggestionPages.length - 1))
    : 0
  const suggestionRecords = suggestionPages[suggestionPage] || []
  const suggestionRemaining = suggestionPages
    .slice(suggestionPage + 1)
    .reduce((count, nextPage) => count + nextPage.length, 0)
  const suggestionTotal = suggestionPages.reduce((count, nextPage) => count + nextPage.length, 0)
  const browseSuggestions = model.browseSuggestions || model.suggestions
  // default to whichever group has something; prefer Suggested (the ref default)
  const [tab, setTab] = useState(suggestionPages.length === 0 && model.saved.length > 0 ? 'saved' : 'suggested')
  const tabRefs = useRef([])

  const partLow = part ? DAYPART[part].label.toLowerCase() : 'plan'
  const art = part === 'afternoon' ? 'an' : 'a'
  const heading = part ? `Add ${art} ${partLow} plan` : 'Add a plan'

  const pickRow = (entry) => {
    const record = entry?.item ? entry : null
    const e = record?.item || entry
    const why = record?.primaryReason?.label || null
    return (
      <button key={keyOf(e)} className="wkb-pick pressable" onClick={() => onPick(e)}>
        <CardImg e={e} className="wkb-pick-img" />
        <span className="wkb-pick-main">
          <span className="wkb-pick-title">{e.title}</span>
          <span className="wkb-pick-meta">
            {[daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null, e.venue].filter(Boolean).join(' · ')}
          </span>
          {why && (
            <span className="wkb-pick-why">
              <span className="wkb-pick-fit">{why}</span>
            </span>
          )}
          <SponsoredTag e={e} />
        </span>
        <span className="wkb-pick-add" aria-hidden>
          +
        </span>
      </button>
    )
  }

  const sub =
    tab === 'saved'
      ? 'From your saved list'
      : `Suggested for the ${partLow}${dayLabel ? ' · ' + dayLabel : ''}${suggestionTotal ? ` · ${suggestionTotal} options` : ''}`

  return (
    <ModalSheet
      className={'wkb-sheet-wrap' + (closing ? ' closing' : '')}
      scrimClassName="wkb-scrim"
      dialogClassName="wkb-sheet"
      label={heading}
      closing={closing}
      onDismiss={onClose}
      returnFocusRef={returnFocusRef}
      resolveFallbackFocus={resolveFallbackFocus}
    >
      <>
        <div className="wkb-sheet-head">
          <div className="wkb-sheet-title">{heading}</div>
          <button className="wkb-sheet-close" onClick={onClose} aria-label="Close" data-modal-initial-focus>
            ✕
          </button>
        </div>
        {/* Suggested / Saved tabs (flows-1 p3) */}
        <div className="wkb-tabs" role="tablist" aria-label="Picker source">
          <button
            ref={(el) => (tabRefs.current[0] = el)}
            id={PICKER_TAB_IDS.suggested}
            className={'wkb-tab' + (tab === 'suggested' ? ' on' : '')}
            role="tab"
            aria-selected={tab === 'suggested'}
            aria-controls={PICKER_PANEL_IDS.suggested}
            tabIndex={tab === 'suggested' ? 0 : -1}
            onClick={() => setTab('suggested')}
            onKeyDown={(ev) => tablistArrowKey(ev, ['suggested', 'saved'], tab === 'suggested' ? 0 : 1, setTab, tabRefs)}
          >
            Suggested
          </button>
          <button
            ref={(el) => (tabRefs.current[1] = el)}
            id={PICKER_TAB_IDS.saved}
            className={'wkb-tab' + (tab === 'saved' ? ' on' : '')}
            role="tab"
            aria-selected={tab === 'saved'}
            aria-controls={PICKER_PANEL_IDS.saved}
            tabIndex={tab === 'saved' ? 0 : -1}
            onClick={() => setTab('saved')}
            onKeyDown={(ev) => tablistArrowKey(ev, ['suggested', 'saved'], tab === 'suggested' ? 0 : 1, setTab, tabRefs)}
          >
            Saved{model.saved.length ? ` (${model.saved.length})` : ''}
          </button>
        </div>
        <div className="wkb-sheet-sub">{sub}</div>
        <div className="wkb-sheet-body">
          <div
            id={PICKER_PANEL_IDS.suggested}
            role="tabpanel"
            aria-labelledby={PICKER_TAB_IDS.suggested}
            hidden={tab !== 'suggested'}
            tabIndex={0}
          >
            {suggestionRecords.length > 0
              ? suggestionRecords.map(pickRow)
              : <div className="wkb-note">Nothing fits this slot yet.</div>}
            {suggestionPages.length > 1 && (
              <div className="wkb-more-row">
                {suggestionRemaining > 0 ? (
                  <button
                    className="wkb-more pressable"
                    onClick={() => setSuggestionRun({ key: suggestionKey, page: suggestionPage + 1 })}
                  >
                    More options · {suggestionRemaining} left
                  </button>
                ) : (
                  <span className="wkb-more-done" role="status">All suggestions shown</span>
                )}
              </div>
            )}
            {browseSuggestions.length > 0 && (
              <details className="wkb-browse">
                <summary>Browse every fitting listing · {browseSuggestions.length}</summary>
                <div className="wkb-browse-list">{browseSuggestions.map(pickRow)}</div>
              </details>
            )}
          </div>
          <div
            id={PICKER_PANEL_IDS.saved}
            role="tabpanel"
            aria-labelledby={PICKER_TAB_IDS.saved}
            hidden={tab !== 'saved'}
            tabIndex={0}
          >
            {model.saved.length > 0 ? (
              model.saved.map(pickRow)
            ) : (
              <div className="wkb-note">
                {noSaves ? "♥ save things and they'll show up here first" : 'None of your saved picks fit this slot.'}
              </div>
            )}
          </div>
        </div>
      </>
    </ModalSheet>
  )
}
