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
//   left  / ✕  pass  → recordCalibration('no') (−1 category, floored at 0)
//              AND pushFmnSeen (fmnseen.js — the shared FIFO/cap-40 mirror of
//              FindMyNight's contract) so FMN rerolls respect the rejection.
//              A pass affects ORDERING ONLY — nothing is ever hidden.
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
import { pushFmnSeen } from './fmnseen.js'
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
  const { has, toggle } = useSaves()
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
  const keepIt = (e) => {
    if (!has(e)) toggle(e) // the save seam records the +3; already-saved stays saved
    setKept((n) => n + 1)
  }
  const passIt = (e) => {
    recordCalibration('no', e) // −1 category, floored at 0 — ordering only
    pushFmnSeen(keyOf(e)) // FMN rerolls respect the pass
    setPassed((n) => n + 1)
  }
  const openIt = (e) => openDetail(e) // nav's seam records the open + recents

  const top = deck[idx]
  const saved = top ? has(top) : false

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
    <div className="pg ldk" style={hue != null ? { '--lh': hue } : undefined}>
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

            <div className="ldk-actions">
              <button
                className="ldk-btn ldk-btn-pass pressable"
                onClick={() => deckApi.current?.left()}
                aria-label="Pass"
              >
                ✕
              </button>
              <button
                className="ldk-btn ldk-btn-open pressable"
                onClick={() => deckApi.current?.up()}
                aria-label="Open details"
              >
                ↗
              </button>
              <button
                className={'ldk-btn ldk-btn-keep pressable' + (saved ? ' is-saved' : '')}
                onClick={() => deckApi.current?.right()}
                aria-label={saved ? 'Already on your list' : 'Save to your list'}
              >
                {/* D6: engineered stroke heart (matches SaveHeart app-wide) */}
                {saved ? <Icon.heartFill className="ldk-btn-ic" aria-hidden /> : <Icon.heart className="ldk-btn-ic" aria-hidden />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
