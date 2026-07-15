// FiltersSheet — EVENTS_PHASE2: bottom-up filter panel (When · Price · Category).
// Opened via openEvFilters() → {type:'evfilters'} subpage. "Show results" replaces
// the page with the matching BubblePage; "Reset" clears all selections.
// Uses its own fltUp/fltFade sheet animations (filters.css); the map's old
// mfUp/mfFade were retired with map.css (D8).
import { useRef, useState } from 'react'
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
  const sheetRef = useRef(null)

  const anySelected = when || price || cat

  const handleReset = () => {
    setWhen(null)
    setPrice(null)
    setCat(null)
  }

  const handleShowResults = () => {
    if (!anySelected) return closePage()
    const whenBubble = WHEN_BUBBLES.find((b) => b.id === when)
    const categoryBubble = CAT_BUBBLES.find((b) => b.id === cat)
    const labels = [
      whenBubble?.label,
      price === 'free' ? FREE_BUBBLE?.label : null,
      categoryBubble?.label,
    ].filter(Boolean)
    openBubble({
      id: 'filters',
      emoji: '✓',
      label: 'Filtered events',
      kind: 'filters',
      hue: 28,
      filters: { when: whenBubble?.value || null, price, category: categoryBubble?.value || null },
      filterLabels: labels,
    })
  }

  const trapFocus = (ev) => {
    if (ev.key !== 'Tab') return
    const controls = sheetRef.current?.querySelectorAll('button:not(:disabled)')
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault()
      first.focus()
    }
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
    <div className={'flt-wrap' + (pageClosing ? ' closing' : '')}>
      <button className="flt-scrim" onClick={closePage} aria-label="Close filters" tabIndex={-1} />
      <div
        className="flt-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filter events"
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="flt-head">
          <span className="flt-title">Filters</span>
          <button className="flt-close pressable" onClick={closePage} aria-label="Close" data-initial-focus>✕</button>
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
                  aria-pressed={value === b.id}
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
