// places.js — the LOCATIONS store (Sprint S). The places layer is a SECOND,
// SEPARATE data source from events: it lazy-fetches /places.json ONCE on first
// Locations visit and is NEVER concatenated into the events `norm` (the
// Phase-2 schema decision, MASTER_PLAN2 line 25). Events answer "what's
// happening"; places answer "what's always here" — one app, two stores.
//
// Plain .js (same rule as lib.js / taste.js — NO JSX); the React hook uses
// useSyncExternalStore. A module-level singleton holds the fetched+normalized
// list so EVERY consumer (LocationsView, PlaceBubblePage, PlaceDetail, and
// DayPage's Make-this-my-plan slot resolution) shares ONE cached fetch.
//
// places.json schema v1 (finder/places.mjs): { key:'p|slug', kind:'place',
// name, placeType, classes[], category, lat, lng, address?, description?,
// amenities[]?, isFree?, fee?, hours?, url?, phone?, designation?, operator?,
// sources[], srcCount, osm?, wikidata?, aliases?, hiddenScore, hidden }.
import { useEffect, useSyncExternalStore } from 'react'
import { milesBetween } from './lib.js'

// normalize a raw place into the UI shape the shared card/save/taste/recents
// seams expect — the ONLY adaptation is aliasing name→title and address→venue
// so cards.jsx (which reads e.title / e.venue / e.category / keyOf) renders a
// place with zero card-component changes. Everything place-native is preserved.
// NO date fields (_day/start): a place has no date — dayLoose/startLabel return
// nothing, so place cards show just their venue, never a fake "Started" line.
// buzz is left UNSET on purpose: HeatBadge (buzz>=2) is an event-buzz signal,
// not a "this park has 3 GIS sources" signal — places never wear the flame.
export function normalizePlace(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string') return null
  if (typeof raw.lat !== 'number' || typeof raw.lng !== 'number') return null
  const name = typeof raw.name === 'string' ? raw.name : ''
  if (!name) return null
  return {
    ...raw,
    kind: 'place',
    title: name, // cards.jsx reads e.title — alias so a place renders as a card
    venue: typeof raw.address === 'string' && raw.address ? raw.address : null,
    // the pipeline already maps placeType → the 12-category taxonomy; default
    // defensively to outdoors (the overwhelming majority) if ever absent
    category: typeof raw.category === 'string' && raw.category ? raw.category : 'outdoors',
    _free: raw.isFree === true,
    classes: Array.isArray(raw.classes) ? raw.classes : [],
    amenities: Array.isArray(raw.amenities) ? raw.amenities : [],
    sources: Array.isArray(raw.sources) ? raw.sources : [],
  }
}

// ===== the eight Locations bubbles (S1). Each is a DESTINATION (a full
// PlaceBubblePage), mirroring the Hot bubbles. `match` is a pure predicate
// over a normalized place; `hue` tints the tile (bubble-local, like lib.js
// BUBBLES). Order = the magazine reading order. DRAFT labels for Charles. =====
const hasClass = (p, c) => p.classes.includes(c)
const hasAmenity = (p, a) => p.amenities.includes(a)
export const PLACE_BUBBLES = [
  { id: 'beaches', emoji: '🏖️', label: 'Beaches', hue: 200, match: (p) => p.placeType === 'beach' || hasClass(p, 'beach') },
  { id: 'parks', emoji: '🌳', label: 'Parks & trails', hue: 140, match: (p) => p.placeType === 'park' || hasClass(p, 'park') || p.placeType === 'trail' || hasClass(p, 'trail') },
  { id: 'courts', emoji: '🎾', label: 'Courts & rec', hue: 35, match: (p) => p.placeType === 'courts' || ['tennis', 'basketball', 'pickleball', 'volleyball', 'racquetball', 'disc-golf', 'shuffleboard', 'skate-park'].some((a) => hasAmenity(p, a)) },
  { id: 'nature', emoji: '🥾', label: 'Nature paths', hue: 110, match: (p) => p.placeType === 'preserve' || p.placeType === 'trail' || hasClass(p, 'preserve') || hasClass(p, 'trail') || hasAmenity(p, 'nature-trails') || hasAmenity(p, 'trails') },
  { id: 'views', emoji: '🌅', label: 'Views', hue: 25, match: (p) => p.placeType === 'viewpoint' || p.placeType === 'pier' || hasClass(p, 'pier') },
  { id: 'dog', emoji: '🐕', label: 'Dog-friendly', hue: 50, match: (p) => p.placeType === 'dog_park' || hasClass(p, 'dog_park') || ['dog-park', 'dog-beach', 'dogs-allowed'].some((a) => hasAmenity(p, a)) },
  { id: 'hidden', emoji: '💎', label: 'Hidden spots', hue: 285, match: (p) => p.hidden === true },
  { id: 'free', emoji: '🆓', label: 'Free forever', hue: 145, match: (p) => p.isFree === true },
]
// Phase 3.6 N1 — the quiet top-nav split for Spots (never-hide preserved:
// LENS ∪ CAT === PLACE_BUBBLES). The place-TYPE bubbles (beaches/parks/courts/
// nature/views) live in the "All spots" menu; the QUALITY bubbles (free/hidden/
// dog) ride the calm pill row, since they're the contextual filters you reach for.
// ordered so the row reads Free · Hidden · Dog (Free leads, mirroring Events)
const PLACE_LENS_ORDER = ['free', 'hidden', 'dog']
export const PLACE_LENS_BUBBLES = PLACE_LENS_ORDER.map((id) => PLACE_BUBBLES.find((b) => b.id === id)).filter(Boolean)
export const PLACE_CAT_BUBBLES = PLACE_BUBBLES.filter((b) => !PLACE_LENS_ORDER.includes(b.id))

// ===== module-level singleton store (same shape contract as saves.js) =====
let places = null // null = not loaded yet; [] or [...] once a fetch resolves
let status = 'idle' // 'idle' | 'loading' | 'ready' | 'error'
let inflight = null
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

// a stable snapshot object so useSyncExternalStore sees a new identity only on
// real change (a fresh object per emit, never per render — getSnapshot returns
// the cached one)
let snap = { places, status }
const rebuild = () => {
  snap = { places, status }
}

export function loadPlaces() {
  if (status === 'ready') return Promise.resolve(places)
  if (inflight) return inflight
  status = 'loading'
  rebuild()
  emit()
  inflight = fetch('/places.json')
    .then((r) => {
      if (!r.ok) throw new Error('places http ' + r.status)
      return r.json()
    })
    .then((doc) => {
      const list = Array.isArray(doc?.places) ? doc.places : []
      places = list.map(normalizePlace).filter(Boolean)
      status = 'ready'
      rebuild()
      emit()
      return places
    })
    .catch(() => {
      // graceful: the tab shows an honest "couldn't load" state, never a crash
      places = []
      status = 'error'
      rebuild()
      emit()
      return places
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => snap

// usePlaces(enabled = true) — subscribes to the store and, when enabled,
// triggers the one-shot lazy load on first mount. Returns { places:
// place[]|null, status }. The `enabled` gate exists so the day screen
// (DayPage) can fold places into its slot resolver WITHOUT paying the ~1.2MB
// /places.json fetch on every day open — it passes enabled only when a slot
// actually holds a 'p|' key. LocationsView / PlaceBubblePage / PlaceDetail
// leave it true (they exist to show places).
export function usePlaces(enabled = true) {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  // trigger the lazy load from an EFFECT, never during render — loadPlaces
  // synchronously emit()s to subscribers, and doing that mid-render is the
  // "setState while rendering another component" anti-pattern (it warned ×6
  // from MapView). The effect re-checks live status so a second consumer
  // mounting after the fetch started never double-fires.
  useEffect(() => {
    if (enabled && getSnapshot().status === 'idle') loadPlaces()
  }, [enabled])
  return s
}

// ===== selectors (pure; used by LocationsView's sections) =====
export const isPlaceKey = (k) => typeof k === 'string' && k.startsWith('p|')

// "The classics" — corroborated across 3+ sources (the well-known anchors)
export const classics = (list) => list.filter((p) => p.srcCount >= 3)

// nearest-first when coords are known (missing coords sink); for "Near you"
export function nearest(list, coords, max = 12) {
  if (!coords) return []
  return list
    .map((p) => ({ p, d: milesBetween(coords, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => ({ ...x.p, _dist: x.d }))
}

// ===== T4: places as FMN's thin-night fallback (pure, Node-simmed) =====
// When tonight's EVENT supply for the chosen vibe is thin, FMN may answer with
// an always-there PLACE that fits the vibe (chill/outdoors → a park, a sunset
// spot). `affinity` is a Set of category ids the brief chose (the union of the
// who-set + vibe-set, exactly what FMN already builds); a null/empty affinity
// (the "surprise" vibe maps to none) matches nothing here — a surprise brief is
// best served by real events, not a generic park. Ordering is taste-neutral:
// corroboration (srcCount) desc, then hiddenScore (a quiet find edges a busy
// one on a chill night), then name. NEVER fabricates a time — a place carries
// no date, and the FMN card renders it "always here · no schedule".
//
// `coords` (optional) nudges nearer places up FIRST — a sunset spot 40 miles
// away is not tonight's plan — but distance never excludes (never-hide).
export function placesForBrief(list, affinity, coords, max = 5) {
  if (!Array.isArray(list) || !affinity || affinity.size === 0) return []
  const hits = list.filter((p) => affinity.has(p.category))
  const withD = hits.map((p) => ({ p, d: coords ? milesBetween(coords, p) : null }))
  withD.sort(
    (a, b) =>
      (a.d == null ? 0 : a.d <= 15 ? 0 : 1) - (b.d == null ? 0 : b.d <= 15 ? 0 : 1) ||
      (b.p.srcCount || 0) - (a.p.srcCount || 0) ||
      (b.p.hiddenScore || 0) - (a.p.hiddenScore || 0) ||
      (a.p.name || '').localeCompare(b.p.name || '')
  )
  return withD.slice(0, max).map((x) => (x.d != null ? { ...x.p, _dist: x.d } : x.p))
}

// NOTE (3.73b): a sourced "best beaches" RANKING selector was prototyped here and
// pulled before commit — the adversarial review found it degenerate on the real
// data (all 22 beaches share srcCount 1 + zero amenities, so any score collapses
// to distance/alphabetical). Calling that a "ranking by sources & amenities"
// would be fabricated authority, and ranking parks by srcCount just duplicates
// classics(). Honest sourced rankings (§6.2) wait until the data carries real
// differentiating signal (amenity/designation coverage, or a curated best-of
// layer in 3.75). LocationsView ships an honest beach-day BROWSE instead; the
// smoke "beach ranking-signal reality guard" trips if the data ever gains spread.
