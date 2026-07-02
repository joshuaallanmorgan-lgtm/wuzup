// FiltersSheet — EVENTS_PHASE2: bottom-up filter panel (When · Price · Category).
// Opened via openEvFilters() → {type:'evfilters'} subpage. "Show results" replaces
// the page with the matching BubblePage; "Reset" clears all selections.
// Uses its own fltUp/fltFade sheet animations (filters.css); the map's old
// mfUp/mfFade were retired with map.css (D8).
import { useState } from 'react'
import { BUBBLES, CAT_BUBBLES, LENS_BUBBLES, TOMORROW_BUBBLE } from './lib.js'
import { useNav } from './nav.jsx'
import './filters.css'

// When: Tonight · Tomorrow · This Weekend (Tomorrow is Filters-only — see lib.js)
const TONIGHT_BUBBLE = LENS_BUBBLES.find((b) => b.id === 'tonight')
const WEEKEND_BUBBLE = LENS_BUBBLES.find((b) => b.id === 'weekend')
const WHEN_BUBBLES = [TONIGHT_BUBBLE, TOMORROW_BUBBLE, WEEKEND_BUBBLE].filter(Boolean)
const FREE_BUBBLE = BUBBLES.find((b) => b.id === 'free')

export default function FiltersSheet() {
  // C5: pageClosing is nav's 400ms unmount window — riding it gives the sheet a
  // symmetric slide-down/fade-out close (filters.css .closing) with no own timer
  const { closePage, openBubble, pageClosing } = useNav()
  const [when, setWhen] = useState(null)
  const [price, setPrice] = useState(null)
  const [cat, setCat] = useState(null)

  const anySelected = when || price || cat

  const handleReset = () => {
    setWhen(null)
    setPrice(null)
    setCat(null)
  }

  const handleShowResults = () => {
    let target = null
    if (cat) target = CAT_BUBBLES.find((b) => b.id === cat)
    else if (when) target = WHEN_BUBBLES.find((b) => b.id === when)
    else if (price === 'free') target = FREE_BUBBLE
    if (target) openBubble(target)
    else closePage()
  }

  // C5: the three chip-group sections were copy-paste blocks of one shape —
  // render them from config instead. Same DOM: a Price pick toggles on
  // b.id === 'free', exactly the old hardcoded literal.
  const sections = [
    { label: 'When', bubbles: WHEN_BUBBLES, value: when, set: setWhen },
    { label: 'Price', bubbles: [FREE_BUBBLE], value: price, set: setPrice },
    { label: 'Category', bubbles: CAT_BUBBLES, value: cat, set: setCat },
  ]

  return (
    <div className={'flt-wrap' + (pageClosing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label="Filter events">
      <button className="flt-scrim" onClick={closePage} aria-label="Close filters" />
      <div className="flt-sheet">
        <div className="flt-head">
          <span className="flt-title">Filters</span>
          <button className="flt-close pressable" onClick={closePage} aria-label="Close">✕</button>
        </div>

        {sections.map(({ label, bubbles, value, set }) => (
          <div className="flt-section" key={label}>
            <div className="flt-section-label">{label}</div>
            <div className="flt-chips">
              {bubbles.map((b) => (
                <button
                  key={b.id}
                  className={'flt-chip pressable' + (value === b.id ? ' flt-chip--on' : '')}
                  onClick={() => set(value === b.id ? null : b.id)}
                >
                  <span aria-hidden>{b.emoji}</span> {b.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="flt-footer">
          <button className="flt-reset pressable" onClick={handleReset} disabled={!anySelected}>
            Reset
          </button>
          <button className="flt-submit pressable" onClick={handleShowResults}>
            Show results
          </button>
        </div>
      </div>
    </div>
  )
}
