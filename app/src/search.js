// search.js — Q2e search enrichment v1: THE pure matcher behind SearchPage.
//
// Plain .js, no React, no JSX — Node-importable by design (the Temp sim runs
// this file against the real events.json). Two things live here:
//
//   1. The matcher: parseQuery(query, anchors) + searchEvents(events, anchors,
//      query) → ranked array. Callers pass normalize()d events (lib.js) — the
//      matcher reads _day/_endDay/_free/_t alongside raw title/venue/category/
//      address/description. It NEVER hides events on its own initiative: it is
//      a search — results are exactly what matches the query, and an empty
//      query returns [] so the PAGE can show its zero-state instead.
//
//   2. Recent searches: 'search-recents-v1' (stored as twh:search-recents-v1
//      via storage.js) — most-recent-first, dedup (case/diacritic-folded),
//      hard cap 8 (oldest drops). Recorded by SearchPage on a tapped result or
//      a submitted query — never on keystrokes.
//
// QUERY GRAMMAR (all tokens AND together):
//   • text tokens — case/diacritic-insensitive WORD-PREFIX match ("com" finds
//     Comedy) across title, venue, category (label AND id, via categories.js),
//     plus plain-substring fallbacks on address (neighborhood lives there —
//     "ybor", "petersburg") and description (lowest weight; kept so v1 recall
//     never regresses below the old haystack search).
//   • date tokens — reserved words, exact match only ("freedom" stays text):
//     full weekday names ("friday" → the NEXT such calendar day, today counts),
//     "today"/"tonight" (today), "tomorrow", "weekend" (Fri–Sun anchors window).
//     An event matches a day when its [_day.._endDay] span covers it (an
//     ongoing exhibition IS on that Friday — honest). Undated events can never
//     match a date-constrained query.
//   • "free" — isFree/_free filter, not a text word.
//   • connector words ("this"/"next"/"on") are dropped ONLY when immediately
//     followed by a date token, so the "free this weekend" chip parses as
//     free + weekend; "next friday" deliberately reads as plain "friday" (the
//     next occurrence) — v1 has no week-after arithmetic.
//
// RANKING: text-relevance score desc (sum over tokens of the BEST field hit:
// title 40 > venue 30 > category 25 > address 15 > description 8; exact whole-
// word beats prefix by +10 on the word fields), then hotScore desc (nulls
// last), then start time, then folded title + url for a fully deterministic,
// input-order-independent total order (the sim asserts stability under
// shuffle). Date-only queries ("tonight") are a BROWSE, not a lookup — they
// get the feed's orderDay de-flood (taste-neutral: no nudge — search results
// must read the same on every phone) so one prolific source can't own the
// first screen. Text queries stay on pure relevance.
import { categoryById } from './categories.js'
import { orderDay } from './lib.js'
import { lsGet, lsRemove, lsSet } from './storage.js'

// case + diacritic folding ("José" matches "jose") — the class is the literal
// combining-diacritics range U+0300–U+036F, same fold SearchPage always used
export const fold = (s) =>
  (typeof s === 'string' ? s : '') // pure Node-consumable API: a non-string query must degrade, not throw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean)

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const CONNECTORS = new Set(['this', 'next', 'on'])

// next calendar day with weekday `idx` at/after todayTs (today itself counts:
// "trivia friday" typed ON a Friday means tonight). Built via Date components,
// never todayTs + n*86400000 — DST would shear the midnight alignment off _day.
function nextWeekdayTs(todayTs, idx) {
  const d = new Date(todayTs)
  const off = (idx - d.getDay() + 7) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + off).getTime()
}

// does the event's day span cover [start..end]? (single days use start===end)
const inRange = (e, r) => e._day != null && e._day <= r.end && (e._endDay ?? e._day) >= r.start

// parseQuery(query, anchors) → { empty, text: [token…], days: [{start,end}…], free }
// `empty` = no usable token at all → the page shows its zero-state.
export function parseQuery(query, anchors) {
  const raw = fold(query).split(/[^a-z0-9]+/).filter(Boolean)
  const text = []
  const days = []
  let free = false
  const isDateWord = (t) =>
    t === 'today' || t === 'tonight' || t === 'tomorrow' || t === 'weekend' || WEEKDAYS.includes(t)
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]
    if (CONNECTORS.has(t) && i + 1 < raw.length && isDateWord(raw[i + 1])) continue // "this weekend"
    const wd = WEEKDAYS.indexOf(t)
    if (wd >= 0) {
      const ts = nextWeekdayTs(anchors.todayTs, wd)
      days.push({ start: ts, end: ts })
    } else if (t === 'today' || t === 'tonight') days.push({ start: anchors.todayTs, end: anchors.todayTs })
    else if (t === 'tomorrow') days.push({ start: anchors.tomorrowTs, end: anchors.tomorrowTs })
    else if (t === 'weekend') days.push({ start: anchors.wkStartTs, end: anchors.wkEndTs })
    else if (t === 'free') free = true
    else text.push(t)
  }
  return { empty: !text.length && !days.length && !free, text, days, free }
}

// ---- per-event field index, memoized per event OBJECT (App's `norm` memo
// keeps identities stable across renders, so each event folds exactly once
// per dataset; a WeakMap never outlives a swapped dataset) ----
const IX = new WeakMap()
function indexOf(e) {
  let ix = IX.get(e)
  if (!ix) {
    const cat = categoryById[e.category]
    ix = {
      title: words(e.title),
      venue: words(e.venue),
      // label words AND the id itself ("music" hits id, "drink" hits label)
      cat: cat ? [...words(cat.label), cat.id] : words(e.category),
      addr: fold(e.address),
      desc: fold(e.description),
    }
    IX.set(e, ix)
  }
  return ix
}

const WORD_FIELDS = [
  ['title', 40],
  ['venue', 30],
  ['cat', 25],
]
// best single-field score for one text token, 0 = no hit anywhere
function tokenScore(ix, t) {
  let best = 0
  for (const [f, base] of WORD_FIELDS) {
    for (const w of ix[f]) {
      if (w === t) {
        if (base + 10 > best) best = base + 10
      } else if (w.startsWith(t) && base > best) best = base
    }
  }
  if (best < 15 && ix.addr.includes(t)) best = 15
  if (best < 8 && ix.desc.includes(t)) best = 8
  return best
}

// searchEvents(events, anchors, query, nudge?) → NEW ranked array (input
// untouched). events: normalize()d pool (the page passes upcoming + undated).
// Empty/connector-only/punctuation-only queries → [] (zero-state is the page's
// job). `nudge` (optional, the page passes tasteNudge) applies ONLY to a
// DATE-ONLY browse query ("tonight"/"friday" with no text) — that's a discovery
// browse, so taste may tilt its order (Phase 3.5). A TEXT query stays pure
// relevance + taste-neutral so an explicit search reads identically on every
// phone (search.js itself imports no taste — the nudge is injected, like
// orderDay everywhere else).
export function searchEvents(events, anchors, query, nudge) {
  const q = parseQuery(query, anchors)
  if (q.empty) return []
  const hits = []
  for (const e of events) {
    if (q.free && !(e._free === true || e.isFree === true)) continue
    if (q.days.length) {
      let ok = true
      for (const r of q.days) {
        if (!inRange(e, r)) {
          ok = false
          break
        }
      }
      if (!ok) continue
    }
    let score = 0
    let miss = false
    if (q.text.length) {
      const ix = indexOf(e)
      for (const t of q.text) {
        const s = tokenScore(ix, t)
        if (!s) {
          miss = true
          break
        }
        score += s
      }
    }
    if (miss) continue
    hits.push({ e, score })
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.e.hotScore ?? -Infinity) - (a.e.hotScore ?? -Infinity) ||
      a.e._t - b.e._t ||
      fold(a.e.title).localeCompare(fold(b.e.title)) ||
      (a.e.url || '').localeCompare(b.e.url || '')
  )
  // date-only browse → de-flood + optional taste tilt (count-preserving
  // permutation; nudge is the injected tasteNudge when the page supplies it)
  if (q.days.length && !q.text.length) return orderDay(hits.map((h) => h.e), nudge)
  return hits.map((h) => h.e)
}

// ===== T2: the PLACES matcher (cross-layer search, second result group) =====
// A place has NO date — so the date tokens ("friday", "tonight", "weekend")
// can never match one: a date-constrained query returns ZERO places (honest —
// places aren't scheduled). "free" filters on isFree. Text tokens word-prefix
// match across name(40)/placeType(30)/category(25)/amenities(20)/classes(15),
// with plain-substring fallbacks on address (neighborhood — "ybor", "dunedin")
// and description (lowest). Ordering is TASTE-NEUTRAL (relevance, then
// srcCount corroboration, then folded name) — search results read identically
// on every phone, same contract as the events path.
//
// placeType is a slug ("dog_park") AND amenities/classes are slugs — fold +
// split on non-alphanumerics turns them into words so "dog" prefix-hits
// "dog_park"/"dog-beach" and "tennis" hits the courts amenity.
const PIX = new WeakMap()
function placeIndexOf(p) {
  let ix = PIX.get(p)
  if (!ix) {
    const cat = categoryById[p.category]
    ix = {
      name: words(p.name),
      ptype: words(p.placeType),
      cat: cat ? [...words(cat.label), cat.id] : words(p.category),
      amen: (Array.isArray(p.amenities) ? p.amenities : []).flatMap(words),
      cls: (Array.isArray(p.classes) ? p.classes : []).flatMap(words),
      addr: fold(p.address),
      desc: fold(p.description),
    }
    PIX.set(p, ix)
  }
  return ix
}

const PLACE_WORD_FIELDS = [
  ['name', 40],
  ['ptype', 30],
  ['cat', 25],
  ['amen', 20],
  ['cls', 15],
]
function placeTokenScore(ix, t) {
  let best = 0
  for (const [f, base] of PLACE_WORD_FIELDS) {
    for (const w of ix[f]) {
      if (w === t) {
        if (base + 10 > best) best = base + 10
      } else if (w.startsWith(t) && base > best) best = base
    }
  }
  if (best < 12 && ix.addr.includes(t)) best = 12
  if (best < 6 && ix.desc.includes(t)) best = 6
  return best
}

// searchPlaces(places, anchors, query) → NEW ranked array (input untouched).
// places: normalizePlace()d pool. A date-constrained query → [] (places have
// no date). Empty/connector-only query → [] (the page owns the zero-state).
export function searchPlaces(places, anchors, query) {
  const q = parseQuery(query, anchors)
  if (q.empty || q.days.length) return [] // a place can never be "on Friday"
  const hits = []
  for (const p of places) {
    if (q.free && !(p._free === true || p.isFree === true)) continue
    let score = 0
    let miss = false
    if (q.text.length) {
      const ix = placeIndexOf(p)
      for (const t of q.text) {
        const s = placeTokenScore(ix, t)
        if (!s) {
          miss = true
          break
        }
        score += s
      }
    }
    if (miss) continue
    hits.push({ p, score })
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.p.srcCount ?? 0) - (a.p.srcCount ?? 0) ||
      fold(a.p.name).localeCompare(fold(b.p.name))
  )
  return hits.map((h) => h.p)
}

// ---- recent searches ('search-recents-v1' → twh:search-recents-v1) ----
export const SEARCH_RECENTS_KEY = 'search-recents-v1'
const RECENTS_CAP = 8

export function loadSearchRecents() {
  try {
    const v = JSON.parse(lsGet(SEARCH_RECENTS_KEY))
    if (!Array.isArray(v)) return []
    const out = []
    const seen = new Set()
    for (const s of v) {
      if (typeof s !== 'string') continue
      const t = s.trim()
      if (!t || seen.has(fold(t))) continue
      seen.add(fold(t))
      out.push(t)
      if (out.length >= RECENTS_CAP) break
    }
    return out
  } catch {
    return [] // absent, corrupt, or private mode — start empty
  }
}

// record a query (tapped result / submitted), return the NEW list. Dedup is
// fold-compared (re-searching "Jazz" moves the old "jazz" chip to the front,
// keeping the latest typed form); oldest entry drops past the cap of 8.
export function recordSearchRecent(query) {
  const t = (query || '').trim().slice(0, 80)
  if (!t) return loadSearchRecents()
  const f = fold(t)
  const next = [t, ...loadSearchRecents().filter((s) => fold(s) !== f)].slice(0, RECENTS_CAP)
  lsSet(SEARCH_RECENTS_KEY, JSON.stringify(next)) // guarded in storage.js
  return next
}

export function clearSearchRecents() {
  lsRemove(SEARCH_RECENTS_KEY)
  return []
}

// remove ONE recent (the per-chip ✕, Phase 3.5) — fold-compared so the ✕ on
// the displayed form removes its stored entry; returns the new list.
export function removeSearchRecent(query) {
  const f = fold(query)
  const next = loadSearchRecents().filter((s) => fold(s) !== f)
  lsSet(SEARCH_RECENTS_KEY, JSON.stringify(next)) // guarded in storage.js
  return next
}
