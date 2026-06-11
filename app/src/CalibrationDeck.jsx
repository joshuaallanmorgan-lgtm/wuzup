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
// GESTURES are raw pointer events (no deps) with always-visible button
// fallbacks; reduced-motion users get buttons only and cards crossfade
// instead of flying (deck.css). Skippable anytime — verdicts are recorded as
// they happen, so "Done early" simply jumps to the finish beat and an
// unrated close loses nothing.
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, categoryById } from './categories.js'
import { Icon, dayLoose, hotDesc, keyOf, timeOf } from './lib.js'
import { lsGet, lsSet } from './storage.js'
import { CardImg, PriceChip, SponsoredTag } from './cards.jsx'
import { useSaves } from './saves.js'
import { getProfile, recordCalibration, topCategories } from './taste.js'
import './deck.css'

export const DECK_SIZE = 15
const FILL_CAT_CAP = 2 // remainder fill: at most 2 of any category in a deal
const SWIPE_X = 80 // px of horizontal travel that commits a verdict
const SWIPE_Y = 90 // px of upward travel that commits a save

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

// ===== fmn-seen push (REJECTIONS ONLY — see the header asymmetry note).
// FindMyNight owns the read side of 'fmn-seen-v1'; this mirrors its exact
// FIFO/cap-40 write contract (its pushSeen is module-private by design, and
// this file's ownership contract forbids exporting it from there). FMN
// re-reads the key on every 🎲 open, so deck rejections land next session. =====
const FMN_SEEN_KEY = 'fmn-seen-v1'
const FMN_SEEN_CAP = 40
function pushFmnSeen(key) {
  let kept = []
  try {
    const v = JSON.parse(lsGet(FMN_SEEN_KEY))
    if (Array.isArray(v)) kept = v.filter((k) => typeof k === 'string' && k !== key)
  } catch {
    /* absent / corrupt / private mode — start empty */
  }
  lsSet(FMN_SEEN_KEY, JSON.stringify(kept.concat(key).slice(-FMN_SEEN_CAP)))
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

// one rated card's face (shared by the live stack and the flying exit clone)
function DeckFace({ e }) {
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
          {/* sponsored never reaches the deck (sampler excludes it), but
              added-by-you events can — the labeling invariant rides along */}
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
  const [idx, setIdx] = useState(0)
  const [into, setInto] = useState(0) // 'yes' + 'save' verdicts
  const [nope, setNope] = useState(0)
  const [exit, setExit] = useState(null) // { e, dir, dx, dy, rot } — the flying clone
  const [phase, setPhase] = useState(deck.length ? 'rate' : 'empty') // 'rate' | 'done' | 'empty'
  const exitTRef = useRef(null)
  const doneTRef = useRef(null)
  const cardRef = useRef(null) // the live top card element (drag transform target)
  const dragRef = useRef(null) // { id, x0, y0, dx, dy } during a pointer drag
  useEffect(
    () => () => {
      clearTimeout(exitTRef.current)
      clearTimeout(doneTRef.current)
    },
    []
  )

  const verdict = (v, dx = 0, dy = 0) => {
    const e = deck[idx]
    if (!e || phase !== 'rate') return
    if (v === 'no') {
      recordCalibration('no', e) // −1 category, floored at 0 (P4)
      pushFmnSeen(keyOf(e)) // rejections only — see header asymmetry note
      setNope((n) => n + 1)
    } else {
      // 'yes' and 'save' are both "into it"; exactly ONE +3 signal either way
      if (v === 'save' && !has(e)) toggle(e) // save seam records the +3
      else recordCalibration('yes', e) // plain yes, or save on an already-saved card
      setInto((n) => n + 1)
    }
    pushLastDeal(keyOf(e))
    setExit({ e, dir: v === 'no' ? 'left' : v === 'save' ? 'up' : 'right', dx, dy, rot: dx * 0.05 })
    clearTimeout(exitTRef.current)
    exitTRef.current = setTimeout(() => setExit(null), reduced ? 220 : 400)
    const next = idx + 1
    setIdx(next)
    if (next >= deck.length) {
      clearTimeout(doneTRef.current)
      if (reduced) setPhase('done')
      else doneTRef.current = setTimeout(() => setPhase('done'), 420) // let the last card finish flying
    }
  }

  // "Done early" keeps what it learned — verdicts were recorded as they
  // happened, so this just jumps to the finish beat (≥1 rated only; a
  // zero-rating close is the header ✕, which earns no reward moment)
  const finishEarly = () => {
    clearTimeout(doneTRef.current)
    setPhase('done')
  }

  // ===== pointer gestures (top card only; reduced motion = buttons only) =====
  const clearDragStyles = () => {
    const el = cardRef.current
    if (!el) return
    el.classList.remove('grabbed')
    el.style.transform = ''
    el.style.removeProperty('--like')
    el.style.removeProperty('--nope')
    el.style.removeProperty('--keep')
  }
  const onDown = (ev) => {
    if (dragRef.current || !cardRef.current) return
    dragRef.current = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, dy: 0 }
    cardRef.current.classList.add('grabbed')
    ev.currentTarget.setPointerCapture(ev.pointerId)
  }
  const onMove = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    d.dx = ev.clientX - d.x0
    d.dy = ev.clientY - d.y0
    const el = cardRef.current
    if (!el) return
    el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx * 0.05}deg)`
    // verdict stamps fade in with travel (CSS reads these vars)
    el.style.setProperty('--like', String(Math.min(Math.max(d.dx / SWIPE_X, 0), 1)))
    el.style.setProperty('--nope', String(Math.min(Math.max(-d.dx / SWIPE_X, 0), 1)))
    el.style.setProperty('--keep', String(Math.min(Math.max(-d.dy / SWIPE_Y, 0), 1)))
  }
  const onUp = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    dragRef.current = null
    clearDragStyles()
    if (d.dy < -SWIPE_Y && -d.dy > Math.abs(d.dx)) verdict('save', d.dx, d.dy)
    else if (d.dx > SWIPE_X) verdict('yes', d.dx, d.dy)
    else if (d.dx < -SWIPE_X) verdict('no', d.dx, d.dy)
    // else: under threshold — the CSS transition springs the card back
  }
  const onCancel = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    dragRef.current = null
    clearDragStyles()
  }

  const top = deck[idx]
  const visible = deck.slice(idx, idx + 3)
  const rated = into + nope
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
            {Math.min(idx + 1, deck.length)}/{deck.length}
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

            <div className="deck-stack">
              {visible.map((e, i) => (
                <div
                  key={keyOf(e)}
                  ref={i === 0 ? cardRef : undefined}
                  className={'deck-card' + (i === 0 ? ' deck-top' : i === 1 ? ' deck-under1' : ' deck-under2')}
                  onPointerDown={i === 0 && !reduced ? onDown : undefined}
                  onPointerMove={i === 0 && !reduced ? onMove : undefined}
                  onPointerUp={i === 0 && !reduced ? onUp : undefined}
                  onPointerCancel={i === 0 && !reduced ? onCancel : undefined}
                >
                  <DeckFace e={e} />
                  {i === 0 && !reduced && (
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
                  )}
                </div>
              ))}
              {exit && (
                <div
                  className={'deck-card deck-exit deck-exit-' + exit.dir}
                  style={{ '--dx': exit.dx + 'px', '--dy': exit.dy + 'px', '--rot': exit.rot + 'deg' }}
                  aria-hidden
                >
                  <DeckFace e={exit.e} />
                </div>
              )}
            </div>

            <div className="deck-actions">
              <button className="deck-btn deck-btn-no pressable" onClick={() => verdict('no')} aria-label="Not for me">
                ✕
              </button>
              <button
                className={'deck-btn deck-btn-save pressable' + (saved ? ' is-saved' : '')}
                onClick={() => verdict('save')}
                aria-label={saved ? 'Already saved — counts as into it' : 'Save it'}
              >
                ♥
              </button>
              <button className="deck-btn deck-btn-yes pressable" onClick={() => verdict('yes')} aria-label="Into it">
                ✓
              </button>
            </div>

            <div className="deck-progress" aria-label={`Card ${Math.min(idx + 1, deck.length)} of ${deck.length}`}>
              {deck.map((e, i) => (
                <span key={keyOf(e)} className={'deck-dot' + (i < idx ? ' done' : i === idx ? ' on' : '')} />
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
