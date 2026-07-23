// deckdeal.js — the PURE, Node-importable deck samplers + the cumulative re-deal
// walk. Extracted from CalibrationDeck (Stage B Batch 5 coverage fix) so the
// never-hide coverage proof is testable in Node: this module imports ONLY pure
// lib/categories helpers — no React, no CSS, no storage. The component keeps the
// persisted-FIFO (deck-last-v1, localStorage) and passes it in as `persisted`.
import { primaryKeyOf } from './identity.js'
import { keyOf } from './lib.js'
import { CATEGORIES } from './categories.js'
import { CITY } from './city.js'
import { rankRuntimeItems } from './relevance.js'

export const DECK_SIZE = 15
const FILL_CAT_CAP = 2 // remainder fill: at most 2 of any category in a deal

export function deckKeyOf(item) {
  const primary = primaryKeyOf(item)
  return primary && primary !== '|' ? primary : keyOf(item)
}

// ===== THE SAMPLER — pure, rng-injectable (Node sims pass a seeded rng).
// The shared rank contract orders the complete eligible pool first. We then
// stratify it (one strong candidate per registry category), fill with at most
// two/category when supply allows, and shuffle so the deal does not telegraph
// the category walk. Always real events; SPONSORED IS EXCLUDED — a paid
// placement must not harvest taste calibration. =====
export function dealDeck(events, anchors, {
  exclude = new Set(),
  excludeItem = null,
  size = DECK_SIZE,
  rng = Math.random,
  nowMs = anchors.nowMs ?? anchors.todayTs,
  city = CITY,
  taste = {},
} = {}) {
  const isRetained = typeof excludeItem === 'function' ? excludeItem : () => false
  const upcoming = events.filter(
    (e) => e._day != null
      && (e._endDay ?? e._day) >= anchors.todayTs
      && e.sponsored !== true
      && !isRetained(e)
  )
  let pool = upcoming.filter((e) => !exclude.has(deckKeyOf(e)))
  if (!pool.length) pool = upcoming // tiny-dataset fallback: re-rating beats a dead deck
  if (!pool.length) return []
  const rankedPool = rankRuntimeItems(pool, {
    kind: 'events',
    nowMs,
    city,
    taste,
    diversityPolicy: {
      prefix: Math.min(Math.max(size * 2, size), pool.length),
      sourceMax: 2,
      categoryMax: 2,
      venueMax: 1,
      canonicalMax: 1,
      seriesMax: 1,
    },
  }).ordered
  const byCat = new Map()
  for (const e of rankedPool) {
    const list = byCat.get(e.category)
    if (list) list.push(e)
    else byCat.set(e.category, [e])
  }
  const picked = []
  const taken = new Set()
  for (const { id } of CATEGORIES) {
    // never SOLICIT a rating on the 'other' junk-drawer (the fill pass may still
    // include one organically, but the deck doesn't ask for it on purpose)
    if (id === 'other') continue
    const list = byCat.get(id)
    if (list && list.length && picked.length < size) {
      picked.push(list[0])
      taken.add(deckKeyOf(list[0]))
    }
  }
  const rest = rankedPool.filter((e) => !taken.has(deckKeyOf(e)))
  const catCount = {}
  for (const e of picked) catCount[e.category] = (catCount[e.category] || 0) + 1
  for (const e of rest) {
    if (picked.length >= size) break
    if ((catCount[e.category] || 0) >= FILL_CAT_CAP) continue
    picked.push(e)
    taken.add(deckKeyOf(e))
    catCount[e.category] = (catCount[e.category] || 0) + 1
  }
  if (picked.length < size) {
    // diversity cap left slots open (lopsided pool) — relax it rather than under-deal
    for (const e of rest) {
      if (picked.length >= size) break
      if (!taken.has(deckKeyOf(e))) {
        picked.push(e)
        taken.add(deckKeyOf(e))
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
// PLACES have no date/sponsored — the pool is every place and the stratum is
// PLACETYPE. Objective place quality, bounded taste, and diversity come from the
// shared rank contract. `nowMs` defaults to a stable epoch because place quality
// is timeless; callers may still inject a clock for one uniform runtime contract.
export function dealPlaceDeck(places, {
  exclude = new Set(),
  excludeItem = null,
  size = DECK_SIZE,
  rng = Math.random,
  nowMs = 0,
  city = CITY,
  taste = {},
} = {}) {
  const isRetained = typeof excludeItem === 'function' ? excludeItem : () => false
  const eligible = (places || []).filter((p) => !isRetained(p))
  let pool = eligible.filter((p) => !exclude.has(deckKeyOf(p)))
  if (!pool.length) pool = eligible // tiny-pool fallback: re-rating beats a dead deck
  if (!pool.length) return []
  const rankedPool = rankRuntimeItems(pool, {
    kind: 'places',
    nowMs,
    city,
    taste,
    diversityPolicy: {
      prefix: Math.min(Math.max(size * 2, size), pool.length),
      sourceMax: 2,
      categoryMax: 2,
      venueMax: 1,
      canonicalMax: 1,
      seriesMax: 1,
    },
  }).ordered
  const byType = new Map()
  for (const p of rankedPool) {
    const t = p.placeType || 'spot'
    const list = byType.get(t)
    if (list) list.push(p)
    else byType.set(t, [p])
  }
  const picked = []
  const taken = new Set()
  for (const list of byType.values()) {
    if (picked.length >= size) break
    picked.push(list[0])
    taken.add(deckKeyOf(list[0]))
  }
  const rest = rankedPool.filter((p) => !taken.has(deckKeyOf(p)))
  const typeCount = {}
  for (const p of picked) typeCount[p.placeType] = (typeCount[p.placeType] || 0) + 1
  for (const p of rest) {
    if (picked.length >= size) break
    if ((typeCount[p.placeType] || 0) >= FILL_CAT_CAP) continue
    picked.push(p)
    taken.add(deckKeyOf(p))
    typeCount[p.placeType] = (typeCount[p.placeType] || 0) + 1
  }
  for (const p of rest) {
    if (picked.length >= size) break
    if (!taken.has(deckKeyOf(p))) {
      picked.push(p)
      taken.add(deckKeyOf(p))
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
// a deterministic top-of-pool sort, cycles a shallow top-~45 carousel — so "Swipe all N
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
  const dealable = all.filter((e) => !persistedSet.has(deckKeyOf(e)))
  // wrap: once every dealable event has been served this session, start the walk over
  if (dealable.length && dealable.every((e) => seen.has(deckKeyOf(e)))) seen.clear()
  const exclude = new Set(persistedSet)
  for (const k of seen) exclude.add(k)
  const deck = sample(exclude)
  for (const e of deck) seen.add(deckKeyOf(e)) // mark SERVED so the next call moves forward
  return deck
}

export function nextEventsBatch(events, anchors, seen, {
  persisted = [],
  excludeItem = null,
  size = DECK_SIZE,
  rng = Math.random,
  nowMs = anchors.nowMs ?? anchors.todayTs,
  city = CITY,
  taste = {},
} = {}) {
  const isRetained = typeof excludeItem === 'function' ? excludeItem : () => false
  const all = events.filter((e) => e._day != null
    && (e._endDay ?? e._day) >= anchors.todayTs
    && e.sponsored !== true
    && !isRetained(e))
  return nextBatch(
    all,
    seen,
    (exclude) => dealDeck(events, anchors, { exclude, excludeItem: isRetained, size, rng, nowMs, city, taste }),
    persisted,
  )
}

export function nextPlacesBatch(places, seen, {
  persisted = [],
  excludeItem = null,
  size = DECK_SIZE,
  rng = Math.random,
  nowMs = 0,
  city = CITY,
  taste = {},
} = {}) {
  const isRetained = typeof excludeItem === 'function' ? excludeItem : () => false
  const all = (places || []).filter((place) => !isRetained(place))
  return nextBatch(
    all,
    seen,
    (exclude) => dealPlaceDeck(places, {
      exclude,
      excludeItem: isRetained,
      size,
      rng,
      nowMs,
      city,
      taste,
    }),
    persisted,
  )
}
