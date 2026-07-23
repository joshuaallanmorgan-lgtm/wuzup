// LensDeck — Sprint Q2: the FINITE "Deck this" mode. A 🃏 button on HotView's
// Everything day-headers and on bubble pages deals the EXACT list the user
// was browsing (lensdeal.js — same upcoming/lens filters, shared objective
// rank and diversity) into a SwipeDeck. Count-exact header ("18 for
// Friday"), honest end card (kept/passed from real tallies), one explicit
// return button. NEVER autoplays, never the default view, never re-deals on
// its own — the end card is a stopping cue, not a loop (the research's
// fatigue warning, honored).
//
// Props contract: { lens, events (normalized), anchors }.
//   lens = { kind:'day', dayTs } | { kind:'bubble', bubble (a BUBBLES entry) }
//
// SIGNALS (Q3) — all through EXISTING seams, exactly once per committed card:
//   right / ♥  keep  → saves.js toggleSave (the seam records the +3 itself —
//              no recordSignal here, ever). An ALREADY-saved card stays saved
//              (no toggle → no un-save, no second signal) and still counts
//              as kept in the tally.
//   left  / ✕  less  → Activity receipt, then capturePersonalSignal('deck-no').
//              This is an explicit ordering choice; nothing is hidden.
//   up    / ↗  open  → openDetail (nav.jsx's seam records the 'open' +1 and
//              the recents view). PEEK semantics: the card stays in the deck
//              (SwipeDeck upMode="peek") — looking closer must not cost the
//              user their keep/pass call on that card.
//
// FATIGUE GUARD: one deck per lens per SESSION — an in-memory module-level
// Set keyed by lens id (deliberately NOT localStorage: "this session" is the
// honest scope of "you already decked this"). After a lens is dealt once its
// entry button flips to the quieter "Deck again", which re-deals only on an
// explicit tap. Both states honest: the button never pretends a deck is fresh.
//
// SPONSORED rides in with its SponsoredTag (DeckFace renders it) and is
// score-neutral (lensdeal.js header). NO --reward anywhere on this surface —
// finishing a lens deck is a decision aid completing, not one of the six
// sanctioned reward moments (the calibration finish beat keeps its own).
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActivity } from './ActivityProvider.jsx'
import { CITY } from './city.js'
import { Icon, dayLabel, keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { useSaves } from './saves.js'
import { useTaste } from './taste.js'
import { capturePersonalSignal, projectPersonalEvidence } from './personal-signals.js'
import { commitCalibrationVerdict, commitLensChoice, deckFeedback } from './feedback-transparency.js'
import { dealLens, lensIdOf } from './lensdeal.js'
import SwipeDeck from './SwipeDeck.jsx'
import { DeckFace } from './CalibrationDeck.jsx'
import './lensdeck.css'

// ===== the session fatigue guard (module-level, in-memory only) =====
const dealtThisSession = new Set()

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// the entry affordance — lives with the deck so HotView/BubblePage import ONE
// thing and the fatigue state stays module-local. useNav re-renders it when
// navigation changes, so the label is fresh every time a deck closes.
export function DeckThisButton({ lens }) {
  const { openLensDeck } = useNav()
  const again = dealtThisSession.has(lensIdOf(lens))
  return (
    <button
      className={'deckthis pressable' + (again ? ' deckthis-again' : '')}
      onClick={() => openLensDeck(lens)}
    >
      <span aria-hidden>🃏</span> {again ? 'Deck again' : 'Deck this'}
    </button>
  )
}

export default function LensDeck({ lens, events, anchors }) {
  const { openDetail, openBubble, closePage } = useNav()
  const { has, toggle, canToggle, identityPending, identityAmbiguous, identityWent, isPending } = useSaves()
  const activity = useActivity()
  const taste = useTaste()
  const reduced = useMemo(() => prefersReduced(), [])
  // ONE deal per mount (CalibrationDeck's rule, same reason: App rebuilds
  // `norm` identities on refreshes and a re-deal mid-swipe would reshuffle
  // the stack under the user's thumb). Re-dealing = explicit re-entry only.
  const [deck] = useState(() => dealLens(events, anchors, lens, taste))
  const [kept, setKept] = useState(0)
  const [passed, setPassed] = useState(0)
  const [choicePending, setChoicePending] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [phase, setPhase] = useState(deck.length ? 'rate' : 'empty') // 'rate' | 'done' | 'empty'
  const deckApi = useRef(null) // SwipeDeck's { left, right, up } — the button fallbacks' commit path

  // mark the lens dealt for this session (flips the entry button to "Deck again")
  useEffect(() => {
    dealtThisSession.add(lensIdOf(lens))
  }, [lens])

  const label = lens.kind === 'day' ? dayLabel(lens.dayTs, anchors) : lens.bubble.label
  const hue = lens.kind === 'bubble' ? lens.bubble.hue : null
  // return to where the user came from: bubble decks reopen their bubble page
  // (quiet — re-entry is navigation, not a fresh interest tap), day decks
  // slide back to the feed
  const back = lens.kind === 'bubble' ? () => openBubble(lens.bubble, { quiet: true }) : closePage
  const backLabel = lens.kind === 'bubble' ? `Back to ${label}` : 'Back to the feed'

  // ===== the Q3 verdicts (each exactly once per committed card) =====
  const idx = kept + passed // SwipeDeck's index, derived (peek never advances)
  const keepIt = async (e) => {
    setChoicePending('keep')
    const result = await commitLensChoice({
      action: 'keep',
      alreadySaved: has(e),
      save: async () => await toggle(e),
    })
    setChoicePending(null)
    setFeedback(deckFeedback(result, { surface: 'lens' }))
    if (result?.applied !== true) return false
    setKept((n) => n + 1)
    return true
  }
  const passIt = async (e) => {
    setChoicePending('no')
    const expectedEvidence = projectPersonalEvidence('deck-no', e, { cityId: CITY.id })
    const result = await commitCalibrationVerdict({
      action: 'no',
      retain: async () => {
        const retained = await activity.recordEventDeck(e)
        if (retained?.applied !== true) return retained
        return retained
      },
      signal: (retained) => capturePersonalSignal('deck-no', e, {
        cityId: CITY.id,
        source: 'activity',
        result: retained,
      }),
      expectedEvidence,
    })
    setChoicePending(null)
    setFeedback(deckFeedback(result, { surface: 'lens' }))
    if (result?.applied !== true) return false
    setPassed((n) => n + 1)
    return true
  }
  const openIt = (e) => openDetail(e) // nav's seam records the open + recents

  const top = deck[idx]
  const saved = top ? has(top) : false
  const savePending = top ? isPending(top) : false
  const saveIdentityPending = top ? identityPending(top) : false
  const saveIdentityAmbiguous = top ? identityAmbiguous(top) : false
  const saveIdentityWent = top ? identityWent(top) : false

  // WS2 #7: keyboard swipes — ←/→/↑ mirror the buttons through the SAME
  // commit paths (deckApi; ↑ = peek here, matching the kicker copy). Page-root
  // handler hears keys bubbling from the focused buttons; the z-2000 detail
  // layer is a sibling, so a peeked-open detail never leaks arrows back into
  // the deck. Rate-phase-only + no ev.repeat (see CalibrationDeck).
  const onDeckKey = (ev) => {
    if (phase !== 'rate' || ev.repeat || !deckApi.current) return
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); deckApi.current.left() }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); deckApi.current.right() }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); deckApi.current.up() }
  }
  // Cohesion REFUTE fix (see CalibrationDeck): nothing focused the deck on
  // open, so arrow swipes were inert until a button was tabbed to. Focus the
  // page root on mount; tabIndex -1 keeps it out of the tab order.
  const deckRootRef = useRef(null)
  useEffect(() => { deckRootRef.current?.focus({ preventScroll: true }) }, [])

  // ===== end card — the honest stopping cue (NO --reward, by contract) =====
  if (phase === 'done') {
    return (
      <div className="pg ldk" style={hue != null ? { '--lh': hue } : undefined}>
        <header className="pg-head ldk-head">
          <button className="pg-back" onClick={back} aria-label="Back">
            <Icon.chevron />
          </button>
          <h1 className="pg-head-title">{label}</h1>
        </header>
        <div className="pg-body ldk-body">
          <div className="ldk-done">
            <div className="ldk-done-emoji" aria-hidden>
              🃏
            </div>
            <h2 className="ldk-done-title">That’s the whole deck.</h2>
            <div className="ldk-done-sub">
              {deck.length} called — kept {kept} ♥ · moved down {passed}
            </div>
            <button className="ldk-done-btn pressable" onClick={back}>
              {backLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pg ldk" style={hue != null ? { '--lh': hue } : undefined} ref={deckRootRef} tabIndex={-1} onKeyDown={onDeckKey}>
      <header className="pg-head ldk-head">
        <button className="pg-back" onClick={back} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">{label}</h1>
        {phase === 'rate' && (
          <div className="ldk-counthead" aria-label={`Card ${Math.min(idx + 1, deck.length)} of ${deck.length}`}>
            {Math.min(idx + 1, deck.length)}/{deck.length}
          </div>
        )}
      </header>

      <div className="pg-body ldk-body">
        {phase === 'empty' ? (
          <div className="ldk-empty">
            <div className="ldk-empty-emoji" aria-hidden>
              🃏
            </div>
            <p>Nothing in this lens right now — the list moved on.</p>
            <button className="ldk-done-btn pressable" onClick={back}>
              {backLabel}
            </button>
          </div>
        ) : (
          <>
            <div className="ldk-kicker">
              <div className="ldk-kicker-title">
                {deck.length} for {label}
              </div>
              <div className="ldk-kicker-sub">
                {reduced
                  ? 'Keep saves it. Less like this lowers similar picks. Open only looks closer.'
                  : 'Swipe or tap. Keep saves; Less like this changes order; Open does not rate it.'}
              </div>
            </div>

            <div
              className={'ldk-feedback' + (feedback?.tone === 'error' ? ' is-error' : '')}
              role={feedback?.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              aria-atomic="true"
            >
              {feedback?.text || (choicePending ? 'Applying your choice…' : '')}
            </div>

            <SwipeDeck
              cards={deck}
              keyFor={keyOf}
              classPrefix="ldk"
              upMode="peek"
              apiRef={deckApi}
              renderCard={(e) => <DeckFace e={e} />}
              stamps={
                <>
                  <span className="ldk-stamp ldk-stamp-keep" aria-hidden>
                    Keeping ♥
                  </span>
                  <span className="ldk-stamp ldk-stamp-pass" aria-hidden>
                    Less like this
                  </span>
                  <span className="ldk-stamp ldk-stamp-open" aria-hidden>
                    Opening
                  </span>
                </>
              }
              onLeft={passIt}
              onRight={keepIt}
              onUp={openIt}
              onDone={() => setPhase('done')}
            />

            {/* WS2 #9: visible labels under the circles (copy DRAFT ⚑ Charles;
                label text contained in each aria-label per WCAG 2.5.3 — the
                keep button's aria-labels gained a leading "Keep" for that).
                Button ORDER untouched — it differs from Calibration's
                pass-save-yes, and reordering is a Josh call. */}
            <div className="ldk-actions">
              <button
                className="ldk-btn ldk-btn-pass pressable"
                onClick={() => deckApi.current?.left()}
                aria-label="Less like this — move similar options down"
                disabled={!activity.ready || savePending || choicePending !== null}
              >
                ✕
                <span className="ldk-btn-label">Less like this</span>
              </button>
              <button
                className="ldk-btn ldk-btn-open pressable"
                onClick={() => deckApi.current?.up()}
                aria-label="Open details"
                disabled={savePending || choicePending !== null}
              >
                ↗
                <span className="ldk-btn-label">Open</span>
              </button>
              <button
                className={'ldk-btn ldk-btn-keep pressable' + (saved ? ' is-saved' : '')}
                onClick={() => deckApi.current?.right()}
                aria-label={saveIdentityWent
                  ? 'Already in your Been history'
                  : saveIdentityAmbiguous
                  ? 'Saved item needs review before Keep can change it'
                  : saveIdentityPending
                    ? 'Keep unavailable until this added event can be saved'
                  : saved
                    ? 'Keep — already on your list'
                    : 'Keep it — saves to your list'}
                disabled={!top || !canToggle(top) || choicePending !== null}
                aria-busy={savePending || choicePending === 'keep' || undefined}
              >
                {/* D6: engineered stroke heart (matches SaveHeart app-wide) */}
                {saved ? <Icon.heartFill className="ldk-btn-ic" aria-hidden /> : <Icon.heart className="ldk-btn-ic" aria-hidden />}
                <span className="ldk-btn-label">{saveIdentityWent ? 'Completed' : saveIdentityAmbiguous ? 'Needs review' : saveIdentityPending ? 'Unavailable' : 'Keep'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
