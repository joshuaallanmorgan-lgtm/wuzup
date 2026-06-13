// dayfill.js — the PURE day-fill deck dealer (Sprint U-b, the THIRD decide-for-me
// lens per Q2f). Plain .js, no React, no taste imports (the nudge is injected) —
// Node-importable for the smoke sims, same contract as lensdeal.js.
//
// "Fill day X" pools the supply that could plausibly land on ONE day:
//   • EVENTS whose [_day.._endDay] span COVERS the target day (fitsDay
//     semantics — the picker's rule, NOT the agenda's one-day clamp; a 3-week
//     exhibit legitimately fills any day it runs). An event whose run started
//     earlier is honestly an "Ongoing" card (the deck face labels it).
//   • PLACES (optional, when a places list is passed) — always-there spots that
//     fit ANY day. They round out a thin weekday (the whole reason U-b waited
//     for the Places layer: a 4-card Tuesday deck pre-Places burns trust).
//
// Ordering: events first (a dated thing for a specific day outranks an
// evergreen spot), G1 orderDay diversity-interleaved (count-preserving — the
// deck IS the candidate set, nothing hidden, nothing fabricated), then the
// places tail ordered by corroboration then name (taste-neutral among places;
// the per-card taste nudge already shaped the event interleave).
//
// FINITE BY DESIGN: a decide-for-me deck is a curated SHORTLIST, not the whole
// supply ("18 for Friday", Q2). The deck is capped at DECK_TARGET: events
// (taste-ordered) lead, and PLACES only fill the REMAINING room — so a rich
// event day deals events alone, and a thin day rounds out with the nearest
// always-there spots (the whole reason U-b waited for Places). Everything is
// still in the day's agenda + the per-slot picker; the deck just curates the
// decision. ≤3 total → the caller falls back to the picker (the fatigue rule).
import { keyOf, milesBetween, orderDay } from './lib.js'

// the curated shortlist size (matches Q2's "18 for Friday" framing)
export const DECK_TARGET = 18
const NEAR_MI = 15 // a place farther than this is not "round out tonight"

// the lens id for the session fatigue guard (one deck per day per session) and
// the back-navigation. A day-fill lens is identified by its target day ts.
export function dayFillIdOf(lens) {
  return 'fill|' + lens.dayTs
}

// fitsDay span semantics, inlined (dayfill.js stays JSX/CSS-free for the sim;
// weekend.js's fitsDay is identical but importing it is fine too — kept inline
// so the dealer has zero app-module coupling beyond lib.js)
const fitsDayTs = (e, ts) => e._day != null && e._day <= ts && (e._endDay ?? e._day) >= ts

// dealDayFill(events, places, ts, anchors, nudge, coords) → the finite,
// CAPPED candidate array (≤ DECK_TARGET). `places` may be null/[] (events-only)
// and `coords` is optional (near-first the place tail when known). Every event
// is tagged _clamp (its effective day, clamped to today) so orderDay's day-
// grouping is a no-op here (one day) while still applying the within-day
// diversity interleave.
export function dealDayFill(events, places, ts, anchors, nudge, coords) {
  // upcoming + fits-this-day; an ended run can't fill a future day
  const evs = events
    .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs && fitsDayTs(e, ts))
    .map((e) => ({ ...e, _clamp: Math.max(e._day, anchors.todayTs) }))
  // dedup defensively (norm is key-unique in practice)
  const seen = new Set()
  const evDedup = evs.filter((e) => {
    const k = keyOf(e)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  // events lead, taste-ordered, capped at the shortlist size
  const orderedEvents = orderDay(evDedup, nudge).slice(0, DECK_TARGET)
  // places ONLY fill the room events left — a rich event day gets no tail; a
  // thin day rounds out with the NEAREST spots (near-first within NEAR_MI, then
  // corroboration, then name). This is the thin-day gate AND the cap in one:
  // room ≤ 0 → no places (the catalog never bolts onto a full day).
  const room = DECK_TARGET - orderedEvents.length
  let placeTail = []
  if (room > 0 && Array.isArray(places) && places.length) {
    const pseen = new Set()
    placeTail = places
      .filter((p) => p && typeof p.key === 'string' && !pseen.has(p.key) && pseen.add(p.key))
      .map((p) => {
        const d = coords && p.lat != null && p.lng != null ? milesBetween(coords, p) : null
        return { p, d, far: d == null ? 1 : d <= NEAR_MI ? 0 : 1 }
      })
      .sort((a, b) => a.far - b.far || (b.p.srcCount || 0) - (a.p.srcCount || 0) || (a.p.name || '').localeCompare(b.p.name || ''))
      .slice(0, room)
      .map((x) => (x.d != null ? { ...x.p, _dist: x.d } : x.p))
  }
  return orderedEvents.concat(placeTail)
}
