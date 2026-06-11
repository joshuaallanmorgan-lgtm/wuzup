// lensdeal.js — the PURE lens-deck dealer (Sprint Q2). Plain .js, no React,
// no taste imports (the nudge is injected) — Node-importable for sims.
//
// A "lens" is the exact list the user was just browsing:
//   { kind: 'day',    dayTs }   — one day-group of HotView's Everything feed
//   { kind: 'bubble', bubble }  — a BUBBLES entry (time / free / cat / sort)
//
// dealLens reproduces that list with the SAME math the list surfaces use:
// upcoming filter (un-ended events, _clamp = max(_day, todayTs) exactly as
// HotView/BubblePage compute it), the lens filter (BubblePage's semantics
// verbatim), then day-grouped ascending with G1 orderDay diversity
// interleaving inside each day (count-preserving — the deck IS the lens,
// nothing hidden, nothing added). FINITE by construction: the deck length is
// the lens count, and that length is the only count the header may claim.
//
// SPONSORED RIDES ALONG, score-neutral: unlike the calibration deck's sampler
// (which excludes paid placements from taste-harvesting), a lens deck is just
// the list in card form — a sponsored event the list shows, the deck shows,
// SponsoredTag and all. orderDay scores by hotScore + nudge; sponsorship
// contributes nothing to either.
//
// Dedup: defensive key-level pass (first occurrence wins). App's `norm` is
// already key-unique in practice (finder dedupes; AddEvent blocks same-key
// adds), so this is a guarantee, not a workaround.
import { keyOf, orderDay } from './lib.js'

export function lensIdOf(lens) {
  return lens.kind === 'day' ? 'day|' + lens.dayTs : 'bub|' + lens.bubble.id
}

export function dealLens(events, anchors, lens, nudge) {
  const up = events
    .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
    .map((e) => ({ ...e, _clamp: Math.max(e._day, anchors.todayTs) }))
  let pool
  if (lens.kind === 'day') {
    pool = up.filter((e) => e._clamp === lens.dayTs)
  } else {
    const b = lens.bubble
    if (b.kind === 'time') pool = up.filter((e) => (b.value === 'tonight' ? e._tonight : e._weekend))
    else if (b.kind === 'free') pool = up.filter((e) => e._free)
    else if (b.kind === 'cat') pool = up.filter((e) => e.category === b.value)
    else pool = up // 'sort' (Near Me): all upcoming — the page shows them all too
  }
  const seen = new Set()
  pool = pool.filter((e) => {
    const k = keyOf(e)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const byDay = new Map()
  for (const e of pool) {
    const list = byDay.get(e._clamp)
    if (list) list.push(e)
    else byDay.set(e._clamp, [e])
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, items]) => orderDay(items, nudge))
}
