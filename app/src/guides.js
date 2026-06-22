// guides.js — Smart Groups, surfaced to users as "Guides" (Phase 3.7 §4/§5).
//
// A guide is a DERIVABLE INTENTION — a moment or mood ("beach day", "rainy-day
// backup") composed as a PURE selector over fields the app already carries. Zero
// new data, never a fabricated claim. The point that separates a guide from a
// filter-with-a-nicer-name: it carries a point of view, and (for place-based
// ones) a "plan a day" action. The TIMELY layer — curated/keyword "Watch Guides"
// from a static guides.json — is separate (3.75b); this file is the evergreen,
// always-honest core.
//
// Plain .js (no JSX, Node-importable for the smoke harness). DRAFT copy — ⚑ Charles.
import { useEffect, useSyncExternalStore } from 'react'
import { daypartOf } from './weekend.js'
import { keyOf } from './lib.js'

// indoor-ish categories — a good backup when the forecast turns
const INDOOR = new Set(['arts', 'theatre', 'comedy', 'music', 'nightlife', 'food', 'family', 'market', 'community'])
// an easy-night-out cut (not a raw category filter — an intention)
const DATE_CATS = new Set(['food', 'music', 'theatre', 'arts', 'nightlife'])
// outdoor placeTypes that read as "get outside"
const OUTDOOR_PLACE = new Set(['park', 'trail', 'preserve', 'garden', 'beach', 'viewpoint', 'pier'])

// Each guide: { id, emoji, hue, title, pov, domain, plannable, needsPlaces, select(ctx) }.
// 3.7P-7 (FB-03): `domain` keeps a guide on the right side of the two-store
// boundary — 'events' (resolves from the events store, shows on the Events page),
// 'spots' (resolves from places, shows on Spots), or 'mixed' (both — shows on
// BOTH pages and GuidePage labels each item's domain). This fixes the leak where a
// spots guide (beach-day) surfaced on the Events page.
// ctx = { events, places, anchors } (events should be the UPCOMING list; places
// is [] until the lazy store loads). select() returns a flat array of normalized
// items (events and/or places) — RowFeed renders either kind unchanged.
export const GUIDES = [
  {
    id: 'beach-day',
    emoji: '🏖️',
    hue: 200,
    title: 'Beach day',
    pov: 'Sand, sun, and salt water — pick your spot.',
    domain: 'spots',
    plannable: true,
    needsPlaces: true,
    select: ({ places }) => (places || []).filter((p) => p.placeType === 'beach'),
  },
  {
    id: 'free-outdoor',
    emoji: '🌳',
    hue: 140,
    title: 'Free outdoor reset',
    pov: 'Fresh air, zero dollars.',
    domain: 'mixed',
    plannable: true,
    needsPlaces: true,
    select: ({ events, places }) => [
      ...(events || []).filter((e) => e._free === true && e.category === 'outdoors'),
      ...(places || []).filter((p) => p.isFree === true && OUTDOOR_PLACE.has(p.placeType)),
    ],
  },
  {
    id: 'rainy-day',
    emoji: '🌧️',
    hue: 215,
    title: 'Rainy-day backup',
    pov: 'Somewhere good when the sky opens up.',
    domain: 'events',
    plannable: false,
    needsPlaces: false,
    select: ({ events }) => (events || []).filter((e) => INDOOR.has(e.category)),
  },
  {
    id: 'date-night',
    emoji: '🌆',
    hue: 330,
    title: 'Date night',
    pov: 'An easy night out, together.',
    domain: 'events',
    plannable: false,
    needsPlaces: false,
    select: ({ events }) =>
      // an EVENING-out cut: night events, or weekend evenings — never a weekend
      // DAYTIME thing riding in under a "night" label (3.75 review).
      (events || []).filter(
        (e) => DATE_CATS.has(e.category) && (daypartOf(e) === 'night' || (e._weekend === true && daypartOf(e) !== 'day'))
      ),
  },
  // HOME_PHASE2: Quick-action destinations
  {
    id: 'markets',
    emoji: '🛍️',
    hue: 45,
    title: 'Markets',
    pov: 'Fresh finds, local makers, and weekend favorites.',
    domain: 'events',
    plannable: false,
    needsPlaces: false,
    select: ({ events }) => (events || []).filter((e) => e.category === 'market'),
  },
  {
    id: 'sports-bars',
    emoji: '📺',
    hue: 210,
    title: 'Sports bars',
    pov: 'Catch the game, big screens, cold beers.',
    domain: 'events',
    plannable: false,
    needsPlaces: false,
    select: ({ events }) => (events || []).filter((e) => e.category === 'sports' || e.category === 'nightlife'),
  },
]

export const guideById = Object.fromEntries(GUIDES.map((g) => [g.id, g]))

// resolve a guide's items against the live stores. The guide IS the curated view
// (like a bubble) — it shows ALL its matches, nothing sliced away, so never-hide
// holds. De-dup by key so an event/place overlap can't double. A throwing
// selector degrades to an empty (honest) guide rather than crashing the page.
export function resolveGuide(guide, ctx) {
  if (!guide || typeof guide.select !== 'function') return []
  let items
  try {
    items = guide.select(ctx) || []
  } catch {
    return []
  }
  const seen = new Set()
  return items.filter((it) => {
    if (!it) return false
    const k = keyOf(it) // the app's canonical key (handles events + places)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ===== the TIMELY layer: hand-authored "Watch Guides" from a static guides.json
// (Phase 3.7 §10). The only flavor that needs data the pipeline lacks (there's no
// parent world-event entity). Honest by construction: a watch guide carries
// KEYWORDS, not fabricated picks — resolveWatchGuide matches them against the LIVE
// events store (real listings only), and a guide is "active" only inside its
// window. One static file + this lazy loader, mirroring the places.js singleton. =====
let _guides = null
let _gstatus = 'idle'
let _ginflight = null
const _glisteners = new Set()
let _gsnap = { watchGuides: [], status: 'idle' }
const _gemit = () => {
  _gsnap = { watchGuides: _guides || [], status: _gstatus }
  _glisteners.forEach((l) => l())
}

export function loadGuides() {
  if (_gstatus === 'ready') return Promise.resolve(_guides)
  if (_ginflight) return _ginflight
  _gstatus = 'loading'
  _gemit()
  _ginflight = fetch('/guides.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('guides http ' + r.status))))
    .then((doc) => {
      _guides = Array.isArray(doc?.guides) ? doc.guides : []
      _gstatus = 'ready'
      _gemit()
      return _guides
    })
    .catch(() => {
      _guides = [] // graceful: no guides.json = no watch guides, never a crash
      _gstatus = 'error'
      _gemit()
      return _guides
    })
    .finally(() => {
      _ginflight = null
    })
  return _ginflight
}

const _gsubscribe = (l) => {
  _glisteners.add(l)
  return () => _glisteners.delete(l)
}
export function useGuides(enabled = true) {
  const s = useSyncExternalStore(_gsubscribe, () => _gsnap)
  useEffect(() => {
    if (enabled && _gsnap.status === 'idle') loadGuides()
  }, [enabled])
  return s
}

// a watch guide is "active" only inside its window (honest — never advertise a
// World Cup guide in October).
export function watchGuideActive(guide, nowTs) {
  if (!guide || guide.kind !== 'watch' || !guide.window) return false
  const start = Date.parse(guide.window.start)
  const end = Date.parse(guide.window.end)
  return Number.isFinite(start) && Number.isFinite(end) && nowTs >= start && nowTs <= end
}

// resolve a watch guide against the LIVE events — matches a keyword in the event's
// title / description / venue (case-insensitive). Real listings only; no curated
// picks to fabricate. De-dups on the canonical key.
export function resolveWatchGuide(guide, events) {
  if (!guide || !Array.isArray(guide.keywords) || guide.keywords.length === 0) return []
  const kws = guide.keywords.map((k) => String(k).toLowerCase())
  const seen = new Set()
  return (events || []).filter((e) => {
    if (!e) return false
    const hay = ((e.title || '') + ' ' + (e.desc || e.description || '') + ' ' + (e.venue || '')).toLowerCase()
    if (!kws.some((k) => hay.includes(k))) return false
    const k = keyOf(e)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
