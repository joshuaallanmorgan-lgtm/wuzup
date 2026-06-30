// TINDER P3 — the "Tune your taste" top module (light theme, pixel-matches
// tinder.png). Lives between the filter chips and the first content section on
// BOTH Events (HotView) and Spots (LocationsView). It is a doorway into the
// dark swipe deck — kind 'events' opens the events Tinder, 'places' the spots.
//
// Honesty: the two preview mini-cards are REAL items handed down from the page
// (samples), never fabricated — the "I'm into it" / "Not for me" tags illustrate
// the SWIPE CONTROL, they assert no judgement about those specific venues.
//
// Session fatigue guard: dismissing collapses the module to a quiet "Tune again"
// pill for the rest of the session (sessionStorage), so it stops nagging but
// stays discoverable; re-entry (re-mount) keeps that collapsed state.
import { useCallback, useState } from 'react'
import { CardImg, featuredChips, spotChips } from './cards.jsx'

const DISMISS_KEY = (kind) => `wuzup-tune-dismissed-${kind}`
const readDismissed = (kind) => {
  try {
    return sessionStorage.getItem(DISMISS_KEY(kind)) === '1'
  } catch {
    return false
  }
}

function firstChip(e, kind) {
  if (kind === 'places') return spotChips(e)[0]?.label || null
  return featuredChips(e)[0] || null
}

function TunePreviewCard({ e, kind, verdict }) {
  const chip = e ? firstChip(e, kind) : null
  return (
    <div className={'tune-pc tune-pc-' + verdict}>
      <span className={'tune-cap tune-cap-' + verdict}>
        {verdict === 'yes' ? "I'm into it" : 'Not for me'}
      </span>
      <div className="tune-pc-card">
        <CardImg e={e} className="tune-pc-img" />
        <div className="tune-pc-body">
          <div className="tune-pc-title">{e?.title}</div>
          {chip && <span className="tune-pc-chip">{chip}</span>}
        </div>
      </div>
    </div>
  )
}

export default function TasteTuner({ kind = 'events', samples = [], onTune }) {
  const noun = kind === 'places' ? 'spots' : 'events'
  const [dismissed, setDismissed] = useState(() => readDismissed(kind))

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY(kind), '1')
    } catch {
      /* private mode — fall back to in-memory only */
    }
    setDismissed(true)
  }, [kind])

  const restore = useCallback(() => {
    try {
      sessionStorage.removeItem(DISMISS_KEY(kind))
    } catch {
      /* no-op */
    }
    setDismissed(false)
  }, [kind])

  const tune = useCallback(() => {
    onTune?.({ kind, origin: kind === 'places' ? 'spots' : 'events' })
  }, [kind, onTune])

  if (dismissed) {
    return (
      <button type="button" className="tune-again" onClick={restore}>
        ✦ Tune your {noun} taste
      </button>
    )
  }

  const [yes, no] = samples
  // No real samples to show? Skip the decorative preview rather than invent one.
  const hasPreview = !!(yes || no)

  return (
    <section className="tune" aria-label={`Tune your ${noun} taste`}>
      <button type="button" className="tune-x" aria-label="Dismiss" onClick={dismiss}>
        ✕
      </button>
      <div className="tune-main">
        <div className="tune-copy">
          {/* T2 (Batch 5): reframed backup→primary — the deck is now the main
              find-AND-tune door. The "12" was a bug (the deck deals 15 = DECK_SIZE);
              the CTA is open-ended now. Copy is a PLACEHOLDER ⚑ Charles. */}
          <h2 className="tune-title">Find your night by swiping</h2>
          <p className="tune-sub">Keep what you like, skip what you don’t — your {noun} feed tunes as you swipe.</p>
          <button type="button" className="tune-cta pressable" onClick={tune}>
            Start swiping
          </button>
        </div>
        {hasPreview && (
          <div className="tune-preview" aria-hidden>
            {no && <TunePreviewCard e={no} kind={kind} verdict="no" />}
            {yes && <TunePreviewCard e={yes} kind={kind} verdict="yes" />}
          </div>
        )}
      </div>
    </section>
  )
}
