// LensNav — Phase 3.6 N1: the quiet top navigation that replaced the loud,
// clipping bubble strip (Josh: "I hate the buttons… quieter, more premium,
// still where you can click into absolutely everything"). Two calm parts:
//   • a LENS row — the few context filters you actually reach for (Tonight /
//     This weekend / Free / Near me on Events; Free / Hidden / Dog on Spots),
//     as quiet text pills that wrap, never clip.
//   • an "All categories" bar that opens a bottom-sheet MENU holding the full
//     taxonomy — so nothing is hidden, just demoted from a 16-button scroll to
//     one tidy menu (the dropdown Josh asked for).
// Same destinations as before (onOpen === openBubble / openPlaceBubble); this
// only changes how they're presented.
//
// A11y (N1 review): the sheet is a real dialog — focus moves INTO it on open,
// is trapped while open, and returns to the trigger on close; aria-modal + a
// capture-phase Escape (closes the sheet before App's page listener).
import { useEffect, useRef, useState } from 'react'
import './topnav.css'

export default function LensNav({ lenses = [], categories = [], menuLabel = 'All categories', navLabel = 'Browse', onOpen, onAdd }) {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const tRef = useRef(null)
  const moreRef = useRef(null) // the trigger — focus returns here on close
  const sheetRef = useRef(null)
  useEffect(() => () => clearTimeout(tRef.current), [])

  // move focus INTO the sheet on open (a dialog you can't reach isn't one)
  useEffect(() => {
    if (!open) return
    const first = sheetRef.current?.querySelector('.tn-item')
    ;(first || sheetRef.current)?.focus()
  }, [open])

  const dismiss = () => {
    setClosing(true)
    clearTimeout(tRef.current)
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    tRef.current = setTimeout(
      () => {
        setOpen(false)
        setClosing(false)
        moreRef.current?.focus() // WCAG 2.4.3: return focus to the trigger
      },
      reduced ? 0 : 240
    )
  }
  // a pick navigates away (the view swaps) — drop the sheet instantly, no restore
  const pick = (fn, arg) => {
    clearTimeout(tRef.current)
    setOpen(false)
    setClosing(false)
    fn(arg)
  }

  // Escape closes the sheet FIRST (capture phase) — never the whole tab
  useEffect(() => {
    if (!open) return
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        dismiss()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  // minimal focus trap: keep Tab within the sheet's controls while it's open
  const trap = (ev) => {
    if (ev.key !== 'Tab') return
    const f = sheetRef.current?.querySelectorAll('button')
    if (!f || !f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <nav className="lensbar" aria-label={navLabel}>
        {lenses.length > 0 && (
          <div className="lens-row">
            {lenses.map((b) => (
              <button key={b.id} className="lens-pill pressable" onClick={() => onOpen(b)}>
                {b.label}
              </button>
            ))}
          </div>
        )}
        <button
          ref={moreRef}
          className={'lens-more pressable' + (open ? ' open' : '')}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span>{menuLabel}</span>
          <svg className="lens-chev" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </nav>

      {open && (
        <div className={'tn-sheet-wrap' + (closing ? ' closing' : '')}>
          <button className="tn-scrim" tabIndex={-1} onClick={dismiss} aria-label="Close menu" />
          <div
            className="tn-sheet"
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={menuLabel}
            onKeyDown={trap}
          >
            <div className="tn-sheet-head">
              <div className="tn-sheet-title">{menuLabel}</div>
              <button className="tn-sheet-close pressable" onClick={dismiss} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="tn-grid">
              {categories.map((b) => (
                <button key={b.id} className="tn-item pressable" onClick={() => pick(onOpen, b)}>
                  <span className="tn-item-emoji" aria-hidden="true">
                    {b.emoji}
                  </span>
                  <span className="tn-item-label">{b.label}</span>
                </button>
              ))}
              {onAdd && (
                <button className="tn-item tn-item-add pressable" onClick={() => pick(onAdd)}>
                  <span className="tn-item-emoji" aria-hidden="true">
                    ➕
                  </span>
                  <span className="tn-item-label">Add event</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
