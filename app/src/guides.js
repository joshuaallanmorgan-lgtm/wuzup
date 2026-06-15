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
import { daypartOf } from './weekend.js'
import { keyOf } from './lib.js'

// indoor-ish categories — a good backup when the forecast turns
const INDOOR = new Set(['arts', 'theatre', 'comedy', 'music', 'nightlife', 'food', 'family', 'market', 'community'])
// an easy-night-out cut (not a raw category filter — an intention)
const DATE_CATS = new Set(['food', 'music', 'theatre', 'arts', 'nightlife'])
// outdoor placeTypes that read as "get outside"
const OUTDOOR_PLACE = new Set(['park', 'trail', 'preserve', 'garden', 'beach', 'viewpoint', 'pier'])

// Each guide: { id, emoji, hue, title, pov, plannable, needsPlaces, select(ctx) }.
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
    plannable: false,
    needsPlaces: false,
    select: ({ events }) =>
      // an EVENING-out cut: night events, or weekend evenings — never a weekend
      // DAYTIME thing riding in under a "night" label (3.75 review).
      (events || []).filter(
        (e) => DATE_CATS.has(e.category) && (daypartOf(e) === 'night' || (e._weekend === true && daypartOf(e) !== 'day'))
      ),
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
