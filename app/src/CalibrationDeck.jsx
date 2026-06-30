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
// THE SAMPLER + the CUMULATIVE re-deal WALK live in deckdeal.js now (pure +
// Node-importable so the never-hide COVERAGE proof is testable). dealDeck is
// stratified — one hottest event per registry category, remainder filled
// (≤2/category), shuffled; SPONSORED IS EXCLUDED (a paid placement must not harvest
// taste calibration). The INITIAL deal excludes the persisted FIFO ('deck-last-v1',
// cap 30) for cross-session freshness; each "Deal again" excludes (FIFO ∪ an
// in-memory cumulative SEEN set) via nextEventsBatch, so it WALKS FORWARD through
// the whole catalog (not a top-N carousel) and wraps when exhausted — never dead-ends.
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
import { categoryById } from './categories.js'
import { Icon, dayLoose, keyOf, timeOf } from './lib.js'
import { lsGet, lsSet } from './storage.js'
import { pushFmnSeen } from './fmnseen.js'
import { CardImg, PriceChip, SponsoredTag, placeTypeLabel, spotChips, hueFor, artEmoji } from './cards.jsx'
import { useSaves } from './saves.js'
import { usePlaces } from './places.js'
import { getProfile, recordCalibration, topCategories } from './taste.js'
import SwipeDeck from './SwipeDeck.jsx'
import { DECK_SIZE, dealDeck, dealPlaceDeck, nextEventsBatch, nextPlacesBatch } from './deckdeal.js'
import './deck.css'

// ===== re-deal memory: keys rated in recent deals (FIFO, cap 30 ≈ two full
// decks). Kind-scoped so the Events + Spots Tinder decks keep INDEPENDENT
// re-deal memories ('deck-last-v1' events · 'deck-last-places-v1' spots). =====
const LAST_CAP = 30
const lastKeyFor = (kind) => (kind === 'places' ? 'deck-last-places-v1' : 'deck-last-v1')
function loadLastDeal(kind) {
  try {
    const v = JSON.parse(lsGet(lastKeyFor(kind)))
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []
  } catch {
    return [] // missing / corrupt / private mode — memory just starts empty
  }
}
function pushLastDeal(kind, key) {
  const kept = loadLastDeal(kind).filter((k) => k !== key)
  lsSet(lastKeyFor(kind), JSON.stringify(kept.concat(key).slice(-LAST_CAP))) // guarded in storage.js
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

// the PLACE card face (Tinder Spots deck): image (art-floor when no photo) +
// placeType overline + title + 📍location + honest amenity chips — NO date.
export function PlaceDeckFace({ e }) {
  const chips = spotChips(e)
  return (
    <>
      <CardImg e={e} className="deck-img" />
      <div className="deck-info">
        <span className="deck-cat" style={{ '--ch': hueFor(e) }}>
          <span aria-hidden>{artEmoji(e)}</span> {placeTypeLabel(e)}
        </span>
        <div className="deck-title">{e.title}</div>
        {e.venue && <div className="deck-meta">📍 {e.venue}</div>}
        {chips.length > 0 && (
          <div className="deck-extra deck-amen">
            {chips.map((c, i) => {
              const Glyph = Icon[c.icon]
              return (
                <span className="deck-chip" key={i}>
                  {Glyph && <Glyph className="deck-chip-ic" aria-hidden />}
                  {c.label}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// closeLabel: the done/empty button's text — defaults to the settings-origin
// phrasing; the primer-origin mount (Q2d onboarding offer) passes its own,
// since a fresh user closes to the Events tab, not to Settings.
export default function CalibrationDeck({ kind = 'events', events, places, anchors, onClose, closeLabel = 'Back to Settings' }) {
  const reduced = useMemo(() => prefersReduced(), [])
  const { has, toggle } = useSaves()
  // TINDER: the deck is parameterized by kind (events|places) — the pool sampler,
  // the card face, and the re-deal memory differ; the verdict→taste mapping is the
  // SAME category model (recordCalibration reads e.category — places carry one).
  const isPlaces = kind === 'places'
  const noun = isPlaces ? 'spots' : 'events'
  // ONE deal per mount (deliberately not a useMemo on [events]: App rebuilds
  // `norm` identities on anchor refreshes / my-event edits, and a re-deal
  // mid-rating would reshuffle the stack under the user's thumb)
  const [deck, setDeck] = useState(() =>
    isPlaces
      ? dealPlaceDeck(places, { exclude: new Set(loadLastDeal('places')) })
      : dealDeck(events, anchors, { exclude: new Set(loadLastDeal('events')) })
  )
  // BATCH 5 COVERAGE FIX: the in-memory cumulative seen set. The persisted FIFO above only
  // freshens the INITIAL deal cross-session; `seen` accumulates EVERY served key, so each
  // "Deal again" excludes (persisted ∪ seen) and walks FORWARD through the whole catalog
  // (~ceil(pool/15) deals), wrapping when exhausted — never a shallow top-N carousel.
  // Seeded from the initial deck via a guarded lazy ref (StrictMode-safe: no render mutation).
  const seenRef = useRef(null)
  if (seenRef.current === null) seenRef.current = new Set(deck.map((x) => keyOf(x)))
  // BATCH 5: re-deal counter — keys SwipeDeck so a "Deal again" remounts it with the
  // next batch (its derived index resets in lockstep with into/nope below).
  const [dealNum, setDealNum] = useState(0)
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
    if (!isPlaces) pushFmnSeen(keyOf(e)) // rejections only; FMN is events-only (places never re-pitch there)
    pushLastDeal(kind, keyOf(e))
    setNope((n) => n + 1)
  }
  const verdictYes = (e) => {
    recordCalibration('yes', e)
    pushLastDeal(kind, keyOf(e))
    setInto((n) => n + 1)
  }
  const verdictSave = (e) => {
    // 'yes' and 'save' are both "into it"; exactly ONE +3 signal either way
    if (!has(e)) toggle(e) // save seam records the +3 (works for places too)
    else recordCalibration('yes', e) // save on an already-saved card
    pushLastDeal(kind, keyOf(e))
    setInto((n) => n + 1)
  }

  // BATCH 5 (the never-hide door): re-deal the NEXT batch from the done screen so the deck
  // never dead-ends. nextEventsBatch excludes (persisted-FIFO ∪ the cumulative seen set) and
  // walks FORWARD through the catalog — serving genuinely NEW events each tap until the whole
  // pool is covered, then wrapping. (The complete set is also always one tap away via the
  // kept in-feed "See all N" fallback + curate.js's count-preserving proof.)
  const dealAgain = () => {
    const next = isPlaces
      ? nextPlacesBatch(places, seenRef.current, { persisted: loadLastDeal('places') })
      : nextEventsBatch(events, anchors, seenRef.current, { persisted: loadLastDeal('events') })
    setDeck(next)
    setInto(0)
    setNope(0)
    setDealNum((n) => n + 1) // remounts SwipeDeck → its derived index resets to 0 (== rated)
    setPhase(next.length ? 'rate' : 'empty')
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
          <h1 className="pg-head-title">Dial It In</h1>
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
            {/* BATCH 5: "Deal again" keeps the catalog reachable — the done screen no
                longer dead-ends. Close is the quiet secondary. (Copy DRAFT ⚑ Charles.) */}
            <button className="deck-done-btn pressable" onClick={dealAgain}>
              Deal another {DECK_SIZE}
            </button>
            <button className="deck-early" onClick={onClose}>
              {closeLabel}
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
        <h1 className="pg-head-title">Dial It In</h1>
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
            <p>Nothing to rate right now — come back once fresh {noun} land.</p>
            <button className="deck-done-btn pressable" onClick={onClose}>
              {closeLabel}
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
              key={dealNum}
              cards={deck}
              keyFor={keyOf}
              classPrefix="deck"
              apiRef={deckApi}
              renderCard={isPlaces ? (e) => <PlaceDeckFace e={e} /> : (e) => <DeckFace e={e} />}
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
                {/* D6: the engineered stroke heart (matches SaveHeart app-wide), not a raw ♥ */}
                {saved ? <Icon.heartFill className="deck-btn-ic" aria-hidden /> : <Icon.heart className="deck-btn-ic" aria-hidden />}
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

// TINDER Spots deck: lazy-loads the places store (the deck deals ONCE on mount, so
// the places must be ready first) and then mounts the kind='places' CalibrationDeck.
// usePlaces fetches only because this wrapper is mounted only when the Spots Tinder
// is open (App gates on page.kind==='places').
export function PlacesDeck({ onClose, closeLabel = 'Done' }) {
  const { places, status } = usePlaces(true)
  if (status === 'ready' && Array.isArray(places) && places.length) {
    return <CalibrationDeck kind="places" places={places} onClose={onClose} closeLabel={closeLabel} />
  }
  return (
    <div className="pg deck">
      <header className="pg-head deck-head">
        <button className="pg-back" onClick={onClose} aria-label="Close">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Dial It In</h1>
      </header>
      <div className="pg-body deck-body">
        <div className="deck-empty">
          <div className="deck-empty-emoji" aria-hidden>
            🃏
          </div>
          <p>{status === 'error' ? "Couldn't load spots right now — try again in a moment." : 'Loading spots…'}</p>
          <button className="deck-done-btn pressable" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
