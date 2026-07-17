// LensDeck — Sprint Q2: the FINITE "Deck this" mode. A 🃏 button on HotView's
// Everything day-headers and on bubble pages deals the EXACT list the user
// was browsing (lensdeal.js — same upcoming/lens filters, G1 orderDay
// diversity interleave) into a SwipeDeck. Count-exact header ("18 for
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
//   left  / ✕  pass  → recordCalibration('no') (−1 category, floored at 0).
//              A pass affects ORDERING ONLY — nothing is ever hidden. (C5:
//              the fmn-seen write-mirror was deleted with FindMyNight.)
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
import { Icon, dayLabel, keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { useSaves } from './saves.js'
import { recordCalibration, tasteNudge } from './taste.js'
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
  const reduced = useMemo(() => prefersReduced(), [])
  // ONE deal per mount (CalibrationDeck's rule, same reason: App rebuilds
  // `norm` identities on refreshes and a re-deal mid-swipe would reshuffle
  // the stack under the user's thumb). Re-dealing = explicit re-entry only.
  const [deck] = useState(() => dealLens(events, anchors, lens, tasteNudge))
  const [kept, setKept] = useState(0)
  const [passed, setPassed] = useState(0)
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
    if (!has(e)) {
      const result = await toggle(e)
      const changed = result?.changed === true || result?.applied === true
      if (!changed || result?.saved !== true) return false
    }
    setKept((n) => n + 1)
    return true
  }
  const passIt = (e) => {
    recordCalibration('no', e) // −1 category, floored at 0 — ordering only
    setPassed((n) => n + 1)
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
              {deck.length} called — kept {kept} ♥ · passed {passed}
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
                  ? '♥ keeps it, ✕ passes, ↗ opens the details.'
                  : 'Swipe or tap: ♥ keeps it, ✕ passes, ↗ peeks at the details.'}
              </div>
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
                    Pass
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
                aria-label="Pass"
                disabled={savePending}
              >
                ✕
                <span className="ldk-btn-label">Pass</span>
              </button>
              <button
                className="ldk-btn ldk-btn-open pressable"
                onClick={() => deckApi.current?.up()}
                aria-label="Open details"
                disabled={savePending}
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
                disabled={!top || !canToggle(top)}
                aria-busy={savePending || undefined}
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
