/* eslint-disable react-refresh/only-export-components --
   dealDeck (the pure sampler) is pinned to this file so the deck's stratified
   draw is Node-sim-able next to the component that owns it (same precedent as
   cards.jsx / Primer.jsx — dev-time Fast Refresh granularity only). */
// CalibrationDeck — Sprint P3: the SANCTIONED swipe surface ("Rate 15 — we'll
// dial you in"). A full-screen card stack of taste-spanning upcoming events,
// opened from Profile → Settings (the settings agent owns the wiring; this
// file owns the surface). Dark ambiance is allowed here — this is a sibling
// of FMN's ritual energy, but TEAL-leaning (the dice keeps the hot palette);
// --reward appears ONLY at the finish beat (sanctioned micro-moment #6, ⚑P1).
//
// Props contract: { events (normalized), anchors, onClose }.
//
// SPRINT Q1 REFACTOR — gesture core extracted to SwipeDeck.jsx, behavior
// IDENTICAL by construction: the drag math, SWIPE_X/SWIPE_Y thresholds,
// one-verdict-per-gesture nulling, exit-clone timing (400ms / 220ms reduced)
// and the 420ms last-card→done delay moved verbatim; classPrefix="deck" keeps
// every verified deck.css class name on the same elements (deck-stack /
// deck-card / deck-top / deck-under1 / deck-under2 / deck-exit-*); the
// stamps, buttons, dots and the finish beat render here unchanged. The card
// index is DERIVED (idx ≡ into + nope — every commit increments exactly one
// tally and SwipeDeck's idx in lockstep), so progress/counthead/top-card
// reads are unchanged. pushFmnSeen moved to fmnseen.js (shared with LensDeck,
// same FIFO/cap-40 write contract).
//
// THE SAMPLER (dealDeck, pure + rng-injectable for Node sims): stratified,
// NOT top-N — one hottest event per registry category (all 12, empty
// categories skipped), remainder filled with high-hotScore picks capped at 2
// per category, then shuffled. Always real events; SPONSORED IS EXCLUDED — a
// paid placement must not harvest taste calibration. A re-deal excludes
// events rated in recent deals ('deck-last-v1', FIFO cap 30 ≈ the last two
// full decks); if that exclusion would empty a tiny dataset entirely, the
// deal falls back to the full pool — re-rating old events beats a dead deck.
//
// VERDICTS (each = exactly ONE taste signal, never two):
//   right / ✓  "into it"    → recordCalibration('yes') (+3 category)
//   left  / ✕  "not for me" → recordCalibration('no')  (−1, floor 0 — P4) and
//              the key joins 'fmn-seen-v1' so Find My Night won't re-pitch
//              what was JUST rejected. DELIBERATE ASYMMETRY: only 'no'
//              verdicts push to fmn-seen — an "into it" SHOULD stay pitchable
//              (de-prioritizing things the user liked would be self-defeat).
//   up    / ♥  save         → toggleSave (the existing save seam records the
//              +3, so a save is never double-counted); counts as "into it"
//              in the tally. Already-saved card? recordCalibration('yes')
//              instead — the verdict still means something, un-saving doesn't.
// GESTURES are raw pointer events (SwipeDeck, no deps) with always-visible
// button fallbacks; reduced-motion users get buttons only and cards crossfade
// instead of flying (swipedeck.css). Skippable anytime — verdicts are
// recorded as they happen, so "Done early" simply jumps to the finish beat
// and an unrated close loses nothing.
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useMemo, useRef, useState } from 'react'
import { CATEGORIES, categoryById } from './categories.js'
import { Icon, dayLoose, hotDesc, keyOf, timeOf } from './lib.js'
import { lsGet, lsSet } from './storage.js'
import { pushFmnSeen } from './fmnseen.js'
import { CardImg, PriceChip, SponsoredTag } from './cards.jsx'
import { useSaves } from './saves.js'
import { getProfile, recordCalibration, topCategories } from './taste.js'
import SwipeDeck from './SwipeDeck.jsx'
import './deck.css'

export const DECK_SIZE = 15
const FILL_CAT_CAP = 2 // remainder fill: at most 2 of any category in a deal

// ===== re-deal memory: keys rated in recent deals (FIFO, cap 30 ≈ two full
// decks). 'deck-last-v1' → stored as twh:deck-last-v1 via storage.js. =====
const LAST_KEY = 'deck-last-v1'
const LAST_CAP = 30
function loadLastDeal() {
  try {
    const v = JSON.parse(lsGet(LAST_KEY))
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []
  } catch {
    return [] // missing / corrupt / private mode — memory just starts empty
  }
}
function pushLastDeal(key) {
  const kept = loadLastDeal().filter((k) => k !== key)
  lsSet(LAST_KEY, JSON.stringify(kept.concat(key).slice(-LAST_CAP))) // guarded in storage.js
}

// ===== THE SAMPLER — pure, rng-injectable (Node sims pass a seeded rng).
// Stratify first (one hottest per registry category — taste-SPANNING, the
// whole point: a top-N deal would only re-ask about what's already winning),
// then fill with high-hotScore diverse picks (≤2/category), then shuffle so
// the deal order doesn't telegraph the category walk. =====
export function dealDeck(events, anchors, { exclude = new Set(), size = DECK_SIZE, rng = Math.random } = {}) {
  const upcoming = events.filter(
    (e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs && e.sponsored !== true
  )
  let pool = upcoming.filter((e) => !exclude.has(keyOf(e)))
  if (!pool.length) pool = upcoming // tiny-dataset fallback: re-rating beats a dead deck
  const byCat = new Map()
  for (const e of pool) {
    const list = byCat.get(e.category)
    if (list) list.push(e)
    else byCat.set(e.category, [e])
  }
  for (const list of byCat.values()) list.sort(hotDesc)
  const picked = []
  const taken = new Set()
  for (const { id } of CATEGORIES) {
    // never SOLICIT a rating on the 'other' junk-drawer: a 'yes' there would
    // nudge a heterogeneous pile of unrelated events (the fill pass may still
    // include one organically, but the deck doesn't ask for it on purpose)
    if (id === 'other') continue
    const list = byCat.get(id)
    if (list && list.length && picked.length < size) {
      picked.push(list[0])
      taken.add(keyOf(list[0]))
    }
  }
  const rest = pool.filter((e) => !taken.has(keyOf(e))).sort(hotDesc)
  const catCount = {}
  for (const e of picked) catCount[e.category] = (catCount[e.category] || 0) + 1
  for (const e of rest) {
    if (picked.length >= size) break
    if ((catCount[e.category] || 0) >= FILL_CAT_CAP) continue
    picked.push(e)
    taken.add(keyOf(e))
    catCount[e.category] = (catCount[e.category] || 0) + 1
  }
  if (picked.length < size) {
    // diversity cap left slots open (lopsided pool) — relax it rather than under-deal
    for (const e of rest) {
      if (picked.length >= size) break
      if (!taken.has(keyOf(e))) {
        picked.push(e)
        taken.add(keyOf(e))
      }
    }
  }
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[picked[i], picked[j]] = [picked[j], picked[i]]
  }
  return picked
}

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// one rated card's face (shared by the live stack and the flying exit clone;
// exported since Q2 — LensDeck renders the same verified face, single source)
export function DeckFace({ e }) {
  const cat = categoryById[e.category] ?? categoryById.other
  const meta = [dayLoose(e), timeOf(e.start), e.venue].filter(Boolean).join(' · ')
  return (
    <>
      <CardImg e={e} className="deck-img" />
      <div className="deck-info">
        <span className="deck-cat" style={{ '--ch': cat.hue }}>
          <span aria-hidden>{cat.emoji}</span> {cat.label}
        </span>
        <div className="deck-title">{e.title}</div>
        {meta && <div className="deck-meta">{meta}</div>}
        <div className="deck-extra">
          <PriceChip e={e} />
          {/* sponsored never reaches the CALIBRATION deck (sampler excludes
              it), but added-by-you events can — and LensDeck decks carry
              sponsored cards too, so the labeling invariant rides along */}
          <SponsoredTag e={e} />
        </div>
      </div>
    </>
  )
}

export default function CalibrationDeck({ events, anchors, onClose }) {
  const reduced = useMemo(() => prefersReduced(), [])
  const { has, toggle } = useSaves()
  // ONE deal per mount (deliberately not a useMemo on [events]: App rebuilds
  // `norm` identities on anchor refreshes / my-event edits, and a re-deal
  // mid-rating would reshuffle the stack under the user's thumb)
  const [deck] = useState(() => dealDeck(events, anchors, { exclude: new Set(loadLastDeal()) }))
  const [beforeTop] = useState(() => topCategories(getProfile(), 3)) // the honest "before"
  const [into, setInto] = useState(0) // 'yes' + 'save' verdicts
  const [nope, setNope] = useState(0)
  const [phase, setPhase] = useState(deck.length ? 'rate' : 'empty') // 'rate' | 'done' | 'empty'
  const deckApi = useRef(null) // SwipeDeck's { left, right, up } — the button fallbacks' commit path

  // ===== verdicts (SwipeDeck fires each exactly once per committed card) =====
  // idx is DERIVED: every verdict bumps exactly one tally, so into + nope
  // tracks SwipeDeck's internal index in lockstep — counthead, dots and the
  // top-card read below are unchanged from the pre-refactor component.
  const rated = into + nope
  const verdictNo = (e) => {
    recordCalibration('no', e) // −1 category, floored at 0 (P4)
    pushFmnSeen(keyOf(e)) // rejections only — see header asymmetry note
    pushLastDeal(keyOf(e))
    setNope((n) => n + 1)
  }
  const verdictYes = (e) => {
    recordCalibration('yes', e)
    pushLastDeal(keyOf(e))
    setInto((n) => n + 1)
  }
  const verdictSave = (e) => {
    // 'yes' and 'save' are both "into it"; exactly ONE +3 signal either way
    if (!has(e)) toggle(e) // save seam records the +3
    else recordCalibration('yes', e) // save on an already-saved card
    pushLastDeal(keyOf(e))
    setInto((n) => n + 1)
  }

  // "Done early" keeps what it learned — verdicts were recorded as they
  // happened, so this just jumps to the finish beat (≥1 rated only; a
  // zero-rating close is the header ✕, which earns no reward moment).
  // SwipeDeck unmounts with the stack, clearing its own pending done timer.
  const finishEarly = () => setPhase('done')

  const top = deck[rated]
  const saved = top ? has(top) : false

  // ===== finish beat (the --reward sanctioned moment #6) =====
  if (phase === 'done') {
    const afterTop = topCategories(getProfile(), 3)
    const changed = afterTop.join('|') !== beforeTop.join('|')
    const vibes = (ids) => ids.map((c) => (categoryById[c] ?? categoryById.other).emoji).join(' ')
    return (
      <div className="pg deck">
        <header className="pg-head deck-head">
          <button className="pg-back" onClick={onClose} aria-label="Close">
            <Icon.chevron />
          </button>
          <h1 className="pg-head-title">Dial it in</h1>
        </header>
        <div className="pg-body deck-body">
          <div className="deck-done">
            <div className="deck-done-spark" aria-hidden>
              ✨
            </div>
            <h2 className="deck-done-title">Got it — your feed just got smarter</h2>
            <div className="deck-done-sub">
              {rated} rated · {into} into it · {nope} not for you
            </div>
            {afterTop.length > 0 && (
              <div className="deck-vibes">
                Your top vibes: <span className="deck-vibes-now">{vibes(afterTop)}</span>
                {/* before/after shows ONLY when the deck actually moved it — honest, never theatrical */}
                {changed && (
                  <span className="deck-vibes-was">
                    {beforeTop.length ? `was ${vibes(beforeTop)}` : 'that’s brand new'}
                  </span>
                )}
              </div>
            )}
            <button className="deck-done-btn pressable" onClick={onClose}>
              Back to Settings
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pg deck">
      <header className="pg-head deck-head">
        <button className="pg-back" onClick={onClose} aria-label="Close">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Dial it in</h1>
        {phase === 'rate' && (
          <div className="deck-counthead" aria-hidden>
            {Math.min(rated + 1, deck.length)}/{deck.length}
          </div>
        )}
      </header>

      <div className="pg-body deck-body">
        {phase === 'empty' ? (
          <div className="deck-empty">
            <div className="deck-empty-emoji" aria-hidden>
              🃏
            </div>
            <p>Nothing to rate right now — come back once fresh events land.</p>
            <button className="deck-done-btn pressable" onClick={onClose}>
              Back to Settings
            </button>
          </div>
        ) : (
          <>
            <div className="deck-kicker">
              <div className="deck-kicker-title">Rate {deck.length} — we’ll dial you in.</div>
              <div className="deck-kicker-sub">
                {reduced ? 'Tap a button to call each one.' : 'Swipe, or use the buttons — every call tunes your feed.'}
              </div>
            </div>

            <SwipeDeck
              cards={deck}
              keyFor={keyOf}
              classPrefix="deck"
              apiRef={deckApi}
              renderCard={(e) => <DeckFace e={e} />}
              stamps={
                <>
                  <span className="deck-stamp deck-stamp-yes" aria-hidden>
                    Into it
                  </span>
                  <span className="deck-stamp deck-stamp-no" aria-hidden>
                    Not for me
                  </span>
                  <span className="deck-stamp deck-stamp-save" aria-hidden>
                    Saving ♥
                  </span>
                </>
              }
              onLeft={verdictNo}
              onRight={verdictYes}
              onUp={verdictSave}
              onDone={() => setPhase('done')}
            />

            <div className="deck-actions">
              <button
                className="deck-btn deck-btn-no pressable"
                onClick={() => deckApi.current?.left()}
                aria-label="Not for me"
              >
                ✕
              </button>
              <button
                className={'deck-btn deck-btn-save pressable' + (saved ? ' is-saved' : '')}
                onClick={() => deckApi.current?.up()}
                aria-label={saved ? 'Already saved — counts as into it' : 'Save it'}
              >
                ♥
              </button>
              <button
                className="deck-btn deck-btn-yes pressable"
                onClick={() => deckApi.current?.right()}
                aria-label="Into it"
              >
                ✓
              </button>
            </div>

            <div className="deck-progress" aria-label={`Card ${Math.min(rated + 1, deck.length)} of ${deck.length}`}>
              {deck.map((e, i) => (
                <span key={keyOf(e)} className={'deck-dot' + (i < rated ? ' done' : i === rated ? ' on' : '')} />
              ))}
            </div>

            {rated > 0 && (
              <button className="deck-early" onClick={finishEarly}>
                Done early — keep what it learned
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
