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
// reads are unchanged. Retained verdict memory now crosses the atomic activity
// provider before taste or progress advances.
//
// THE SAMPLER + the CUMULATIVE re-deal WALK live in deckdeal.js now (pure +
// Node-importable so the never-hide COVERAGE proof is testable). dealDeck is
// stratified — one hottest event per registry category, remainder filled
// (≤2/category), shuffled; SPONSORED IS EXCLUDED (a paid placement must not harvest
// taste calibration). The INITIAL deal excludes the provider's kind-scoped,
// alias-aware retained FIFO for cross-session freshness; each "Deal again" excludes (FIFO ∪ an
// in-memory cumulative SEEN set) via nextEventsBatch, so it WALKS FORWARD through
// the whole catalog (not a top-N carousel) and wraps when exhausted — never dead-ends.
//
// VERDICTS (each = exactly ONE taste signal, never two):
//   right / ✓  "into it"    → recordCalibration('yes') (+3 category)
//   left  / ✕  "not for me" → recordCalibration('no')  (−1, floor 0 — P4).
//              Ordering only — nothing is ever hidden. The event/place activity
//              FIFOs remain independent and atomically persisted.
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActivity } from './ActivityProvider.jsx'
import { categoryById } from './categories.js'
import { Icon, dayLoose, keyOf, timeOf } from './lib.js'
import { CardImg, PriceChip, SponsoredTag, placeTypeLabel, spotChips, hueFor, artEmoji } from './cards.jsx'
import { useSaves } from './saves.js'
import { usePlaces } from './places.js'
import { getProfile, recordCalibration, topCategories } from './taste.js'
import SwipeDeck from './SwipeDeck.jsx'
import { DECK_SIZE, dealDeck, dealPlaceDeck, deckKeyOf, nextEventsBatch, nextPlacesBatch } from './deckdeal.js'
import './deck.css'

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
        {e.venue && <div className="deck-meta"><Icon.pin className="meta-ic" aria-hidden /> {e.venue}</div>}
        {chips.length > 0 && (
          <div className="deck-extra deck-amen">
            {chips.map((c, i) => {
              const Glyph = Icon[c.icon]
              return (
                <span className="chip-dark" key={i}>
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
function ReadyCalibrationDeck({ activity, kind = 'events', events, places, anchors, onClose, closeLabel = 'Back to Settings' }) {
  const reduced = useMemo(() => prefersReduced(), [])
  const { has, toggle, canToggle, identityPending, identityAmbiguous, identityWent, isPending } = useSaves()
  const {
    eventDeckExclusions,
    placeDeckExclusions,
    isEventDeckExcluded,
    isPlaceDeckExcluded,
    recordEventDeck,
    recordPlaceDeck,
  } = activity
  // TINDER: the deck is parameterized by kind (events|places) — the pool sampler,
  // the card face, and the re-deal memory differ; the verdict→taste mapping is the
  // SAME category model (recordCalibration reads e.category — places carry one).
  const isPlaces = kind === 'places'
  const noun = isPlaces ? 'spots' : 'events'
  const retainedExclusions = isPlaces ? placeDeckExclusions : eventDeckExclusions
  const isRetained = isPlaces ? isPlaceDeckExcluded : isEventDeckExcluded
  const recordDeck = isPlaces ? recordPlaceDeck : recordEventDeck
  // ONE deal per mount (deliberately not a useMemo on [events]: App rebuilds
  // `norm` identities on anchor refreshes / my-event edits, and a re-deal
  // mid-rating would reshuffle the stack under the user's thumb)
  const [deck, setDeck] = useState(() =>
    isPlaces
      ? dealPlaceDeck(places, { exclude: new Set(retainedExclusions), excludeItem: isRetained })
      : dealDeck(events, anchors, { exclude: new Set(retainedExclusions), excludeItem: isRetained })
  )
  // BATCH 5 COVERAGE FIX: the in-memory cumulative seen set. The persisted FIFO above only
  // freshens the INITIAL deal cross-session; `seen` accumulates EVERY served key, so each
  // "Deal again" excludes (persisted ∪ seen) and walks FORWARD through the whole catalog
  // (~ceil(pool/15) deals), wrapping when exhausted — never a shallow top-N carousel.
  // Seeded from the initial deck via a guarded lazy ref (StrictMode-safe: no render mutation).
  const seenRef = useRef(null)
  if (seenRef.current === null) seenRef.current = new Set(deck.map((x) => deckKeyOf(x)))
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
  const verdictNo = async (e) => {
    const result = await recordDeck(e)
    if (result?.applied !== true) return false
    recordCalibration('no', e) // −1 category, floored at 0 (P4)
    setNope((n) => n + 1)
    return true
  }
  const verdictYes = async (e) => {
    const result = await recordDeck(e)
    if (result?.applied !== true) return false
    recordCalibration('yes', e)
    setInto((n) => n + 1)
    return true
  }
  const verdictSave = async (e) => {
    const retained = await recordDeck(e)
    if (retained?.applied !== true) return false
    // 'yes' and 'save' are both "into it"; exactly ONE +3 signal either way
    if (!has(e)) {
      const result = await toggle(e) // changed save-on records the +3 centrally
      const changed = result?.changed === true || result?.applied === true
      if (!changed || result?.saved !== true) return false
    } else recordCalibration('yes', e) // save on an already-saved card
    setInto((n) => n + 1)
    return true
  }

  // BATCH 5 (the never-hide door): re-deal the NEXT batch from the done screen so the deck
  // never dead-ends. nextEventsBatch excludes (persisted-FIFO ∪ the cumulative seen set) and
  // walks FORWARD through the catalog — serving genuinely NEW events each tap until the whole
  // pool is covered, then wrapping. (The complete set is also always one tap away via the
  // kept in-feed "See all N" fallback + curate.js's count-preserving proof.)
  const dealAgain = () => {
    const next = isPlaces
      ? nextPlacesBatch(places, seenRef.current, {
          persisted: placeDeckExclusions,
          excludeItem: isPlaceDeckExcluded,
        })
      : nextEventsBatch(events, anchors, seenRef.current, {
          persisted: eventDeckExclusions,
          excludeItem: isEventDeckExcluded,
        })
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

  // WS2 #7: keyboard swipes — ←/→/↑ mirror the buttons through the SAME
  // commit paths (deckApi). Attached to the page root so it hears keys
  // bubbling from the focused buttons; the z-2000 detail layer is a SIBLING
  // of the subpage, so an open detail never leaks arrows into the deck.
  // Guards: rate phase only (deckApi closures go stale once SwipeDeck
  // unmounts) and no ev.repeat (a held key must not machine-gun verdicts).
  const onDeckKey = (ev) => {
    if (phase !== 'rate' || ev.repeat || !deckApi.current) return
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); deckApi.current.left() }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); deckApi.current.right() }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); deckApi.current.up() }
  }
  // Cohesion REFUTE fix: onDeckKey only hears keys bubbling from a FOCUSED
  // descendant — nothing focused the deck on open, so arrow swipes were inert
  // until the user happened to Tab to a button. Focus the page root itself on
  // mount (tabIndex -1 keeps it out of the tab order; buttons Tab as before;
  // programmatic focus paints no ring — :focus-visible only).
  const deckRootRef = useRef(null)
  useEffect(() => { deckRootRef.current?.focus({ preventScroll: true }) }, [])

  const top = deck[rated]
  const saved = top ? has(top) : false
  const savePending = top ? isPending(top) : false
  const saveIdentityPending = top ? identityPending(top) : false
  const saveIdentityAmbiguous = top ? identityAmbiguous(top) : false
  const saveIdentityWent = top ? identityWent(top) : false

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
    <div className="pg deck" ref={deckRootRef} tabIndex={-1} onKeyDown={onDeckKey}>
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
              keyFor={deckKeyOf}
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

            {/* WS2 #9: visible labels under the circles (glyph-only buttons made
                first-time users hesitate). Copy DRAFT ⚑ Charles; label text is
                contained in each aria-label (WCAG 2.5.3 label-in-name). Button
                ORDER untouched — reordering is a Josh call. */}
            <div className="deck-actions">
              <button
                className="deck-btn deck-btn-no pressable"
                onClick={() => deckApi.current?.left()}
                aria-label="Not for me"
                disabled={savePending}
              >
                ✕
                <span className="deck-btn-label">Not for me</span>
              </button>
              <button
                className={'deck-btn deck-btn-save pressable' + (saved ? ' is-saved' : '')}
                onClick={() => deckApi.current?.up()}
                aria-label={saveIdentityWent
                  ? 'Already in your Been history'
                  : saveIdentityAmbiguous
                  ? 'Saved item needs review before it can be changed'
                  : saveIdentityPending
                    ? 'Save unavailable until this added event can be saved'
                  : saved
                    ? 'Already saved — counts as into it'
                    : 'Save it'}
                disabled={!top || !canToggle(top)}
                aria-busy={savePending || undefined}
              >
                {/* D6: the engineered stroke heart (matches SaveHeart app-wide), not a raw ♥ */}
                {saved ? <Icon.heartFill className="deck-btn-ic" aria-hidden /> : <Icon.heart className="deck-btn-ic" aria-hidden />}
                <span className="deck-btn-label">{saveIdentityWent ? 'Completed' : saveIdentityAmbiguous ? 'Needs review' : saveIdentityPending ? 'Unavailable' : 'Save'}</span>
              </button>
              <button
                className="deck-btn deck-btn-yes pressable"
                onClick={() => deckApi.current?.right()}
                aria-label="Into it"
                disabled={savePending}
              >
                ✓
                <span className="deck-btn-label">Into it</span>
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

export default function CalibrationDeck(props) {
  const activity = useActivity()
  if (!activity.ready) {
    const failed = ['corrupt', 'error'].includes(activity.status)
    return (
      <div className="pg deck">
        <header className="pg-head deck-head">
          <button className="pg-back" onClick={props.onClose} aria-label="Close">
            <Icon.chevron />
          </button>
          <h1 className="pg-head-title">Dial It In</h1>
        </header>
        <div className="pg-body deck-body">
          <div className="deck-empty">
            <p role={failed ? 'alert' : 'status'}>
              {failed
                ? 'Your deck history could not be loaded. Try again before rating cards.'
                : 'Getting your deck history ready…'}
            </p>
            <button className="deck-done-btn pressable" onClick={props.onClose}>
              {props.closeLabel || 'Back to Settings'}
            </button>
          </div>
        </div>
      </div>
    )
  }
  return <ReadyCalibrationDeck {...props} activity={activity} />
}

// TINDER Spots deck: lazy-loads the places store (the deck deals ONCE on mount, so
// the places must be ready first) and then mounts the kind='places' CalibrationDeck.
// usePlaces fetches only because this wrapper is mounted only when the Spots Tinder
// is open (App gates on page.kind==='places').
export function PlacesDeck({ onClose, closeLabel = 'Done' }) {
  const { places, status, recover, recoverLabel } = usePlaces(true)
  if (status === 'ready' && Array.isArray(places) && places.length) {
    return <CalibrationDeck kind="places" places={places} onClose={onClose} closeLabel={closeLabel} />
  }
  const loading = status === 'idle' || status === 'loading'
  const unavailable = ['stale', 'offline', 'error'].includes(status)
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
          <p role={loading ? 'status' : unavailable ? 'alert' : undefined}>
            {loading
              ? 'Loading spots…'
              : status === 'empty' || (status === 'ready' && places?.length === 0)
                ? 'No spots are available here yet.'
                : status === 'stale'
                  ? 'These spot listings are too old to use safely.'
                  : status === 'offline'
                    ? 'You’re offline. Spots weren’t loaded.'
                    : status === 'error'
                      ? "Couldn't verify spots right now."
                      : 'Spots are unavailable right now.'}
          </p>
          {unavailable && recover && (
            <button className="deck-done-btn pressable" onClick={recover}>
              {recoverLabel}
            </button>
          )}
          <button className="deck-done-btn pressable" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
