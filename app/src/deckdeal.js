// deckdeal.js — the PURE, Node-importable deck samplers + the cumulative re-deal
// walk. Extracted from CalibrationDeck (Stage B Batch 5 coverage fix) so the
// never-hide coverage proof is testable in Node: this module imports ONLY pure
// lib/categories helpers — no React, no CSS, no storage. The component keeps the
// persisted-FIFO (deck-last-v1, localStorage) and passes it in as `persisted`.
import { hotDesc, keyOf } from './lib.js'
import { CATEGORIES } from './categories.js'

export const DECK_SIZE = 15
const FILL_CAT_CAP = 2 // remainder fill: at most 2 of any category in a deal

// ===== THE SAMPLER — pure, rng-injectable (Node sims pass a seeded rng).
// Stratify first (one hottest per registry category — taste-SPANNING), then fill
// with high-hotScore diverse picks (<=2/category), then shuffle so the deal order
// doesn't telegraph the category walk. Always real events; SPONSORED IS EXCLUDED —
// a paid placement must not harvest taste calibration. =====
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
    // never SOLICIT a rating on the 'other' junk-drawer (the fill pass may still
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

// THE PLACES SAMPLER (Tinder Spots deck): same stratify->fill->shuffle shape, but
// PLACES have no date/sponsored — the pool is every place, the stratum is PLACETYPE,
// and corroboration (srcCount) is the place "hotness".
export function dealPlaceDeck(places, { exclude = new Set(), size = DECK_SIZE, rng = Math.random } = {}) {
  let pool = (places || []).filter((p) => !exclude.has(keyOf(p)))
  if (!pool.length) pool = places || [] // tiny-pool fallback: re-rating beats a dead deck
  const byType = new Map()
  for (const p of pool) {
    const t = p.placeType || 'spot'
    const list = byType.get(t)
    if (list) list.push(p)
    else byType.set(t, [p])
  }
  const srcDesc = (a, b) => (b.srcCount || 0) - (a.srcCount || 0)
  for (const list of byType.values()) list.sort(srcDesc)
  const picked = []
  const taken = new Set()
  for (const list of byType.values()) {
    if (picked.length >= size) break
    picked.push(list[0])
    taken.add(keyOf(list[0]))
  }
  const rest = pool.filter((p) => !taken.has(keyOf(p))).sort(srcDesc)
  const typeCount = {}
  for (const p of picked) typeCount[p.placeType] = (typeCount[p.placeType] || 0) + 1
  for (const p of rest) {
    if (picked.length >= size) break
    if ((typeCount[p.placeType] || 0) >= FILL_CAT_CAP) continue
    picked.push(p)
    taken.add(keyOf(p))
    typeCount[p.placeType] = (typeCount[p.placeType] || 0) + 1
  }
  for (const p of rest) {
    if (picked.length >= size) break
    if (!taken.has(keyOf(p))) {
      picked.push(p)
      taken.add(keyOf(p))
    }
  }
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[picked[i], picked[j]] = [picked[j], picked[i]]
  }
  return picked
}

// ===== THE CUMULATIVE RE-DEAL WALK (Batch 5 coverage fix) =====
// The bug it fixes: re-dealing with ONLY the persisted FIFO(30) as the exclude, over a
// deterministic hotScore sort, cycles a shallow top-~45 carousel — so "Swipe all N
// events" was a false claim. The fix: an in-memory cumulative `seen` set that
// accumulates EVERY served key. Each call excludes (persisted-FIFO ∪ seen), so it walks
// FORWARD through the catalog serving NEW events; when the dealable pool is exhausted
// (everything served) it clears `seen` and deals from the top again — never dead-ends,
// and reaches every event within ~ceil(N/size) calls. PURE + Node-importable; mutates
// only the passed `seen` accumulator (the caller owns it). The persisted FIFO is the
// cross-session freshness for the INITIAL deal; it is small (<=30) and the in-feed
// "See all N" fallback is the complete-set guarantee for anything it shadows.
function nextBatch(all, seen, sample, persisted) {
  const persistedSet = persisted instanceof Set ? persisted : new Set(persisted || [])
  const dealable = all.filter((e) => !persistedSet.has(keyOf(e)))
  // wrap: once every dealable event has been served this session, start the walk over
  if (dealable.length && dealable.every((e) => seen.has(keyOf(e)))) seen.clear()
  const exclude = new Set(persistedSet)
  for (const k of seen) exclude.add(k)
  const deck = sample(exclude)
  for (const e of deck) seen.add(keyOf(e)) // mark SERVED so the next call moves forward
  return deck
}

export function nextEventsBatch(events, anchors, seen, { persisted = [], size = DECK_SIZE, rng = Math.random } = {}) {
  const all = events.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs && e.sponsored !== true)
  return nextBatch(all, seen, (exclude) => dealDeck(events, anchors, { exclude, size, rng }), persisted)
}

export function nextPlacesBatch(places, seen, { persisted = [], size = DECK_SIZE, rng = Math.random } = {}) {
  return nextBatch(places || [], seen, (exclude) => dealPlaceDeck(places, { exclude, size, rng }), persisted)
}
