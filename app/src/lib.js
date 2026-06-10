// lib.js — shared data helpers, constants, and (JSX-free) icon components.
// NOTE: this file is plain .js, so NO JSX here — icons use createElement.
import { createElement as h } from 'react'

// Per-city hero art is a future, multi-city feature; hardcoded to Tampa for now.
export const CITY = {
  name: 'Tampa Bay',
  hero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/1920px-Tampa_Skyline_-_Eric_Statzer.jpg',
}
export const DAY = 86400000

// bubble destinations: every bubble opens a full BubblePage (round-3)
export const BUBBLES = [
  { id: 'tonight', emoji: '🌙', label: 'Tonight', kind: 'time', value: 'tonight', hue: 250 },
  { id: 'weekend', emoji: '🎉', label: 'This Weekend', kind: 'time', value: 'weekend', hue: 35 },
  { id: 'free', emoji: '🆓', label: 'Free', kind: 'free', value: true, hue: 145 },
  { id: 'near', emoji: '📍', label: 'Near Me', kind: 'sort', value: 'near', hue: 200 },
  { id: 'music', emoji: '🎵', label: 'Music', kind: 'cat', value: 'music', hue: 285 },
  { id: 'food', emoji: '🍔', label: 'Food & Drink', kind: 'cat', value: 'food', hue: 15 },
  { id: 'outdoors', emoji: '🌳', label: 'Outdoors', kind: 'cat', value: 'outdoors', hue: 110 },
  { id: 'sports', emoji: '🏟️', label: 'Sports', kind: 'cat', value: 'sports', hue: 220 },
  { id: 'arts', emoji: '🎨', label: 'Arts', kind: 'cat', value: 'art', hue: 330 },
  { id: 'night', emoji: '🪩', label: 'Nightlife', kind: 'cat', value: 'nightlife', hue: 265 },
  { id: 'comedy', emoji: '😂', label: 'Comedy', kind: 'cat', value: 'comedy', hue: 50 },
  { id: 'theatre', emoji: '🎭', label: 'Theatre', kind: 'cat', value: 'theatre', hue: 350 },
  { id: 'family', emoji: '👨‍👩‍👧', label: 'Family', kind: 'cat', value: 'family', hue: 190 },
  { id: 'markets', emoji: '🛍️', label: 'Markets', kind: 'cat', value: 'market', hue: 80 },
  { id: 'clubs', emoji: '🤝', label: 'Clubs', kind: 'cat', value: 'community', hue: 175 },
]

// hotScore desc, nulls last, ties by start time
export const hotDesc = (x, y) => (y.hotScore ?? -Infinity) - (x.hotScore ?? -Infinity) || x._t - y._t

// source-family: 'Eventbrite (Tampa p2)' and 'Eventbrite (Free)' are ONE family
// (the parenthetical is a finder pagination/area detail, not a different voice);
// primary source = sources[0]. Used by orderDay's diversity constraint.
export function sourceFamily(e) {
  const s = (Array.isArray(e.sources) && e.sources.length ? e.sources[0] : e.source) || ''
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'unknown'
}

// G1 — diversity-aware ordering WITHIN a day group (replaces raw hotDesc in
// HotView Everything / BubblePage / SearchPage day groups). Score each item
// adjustedScore = (hotScore ?? 30) + nudge(e) (nudge optional: taste.js's
// bounded tasteNudge), then interleave so no run of >2 consecutive items
// shares the same source-family OR category while alternatives exist (the
// library de-flood). Pure reordering — COUNT-PRESERVING by construction:
// every item is consumed exactly once, nothing hidden, nothing added.
//
// Implementation: bucket by family+category (each bucket stays score-desc),
// then repeatedly take the best bucket head by (1) fewest run-violations
// (0 → 1 → 2 — the tiered fallback matters on single-category pages: a Music
// bubble can never satisfy the category constraint, but family interleaving
// must survive), then (2) highest score minus a small RECENCY penalty:
// −4/appearance of the same family and −2/same category within the last 8
// picks. The hard constraint alone only stops 3-runs; the soft penalty makes
// the filler slots ROTATE families instead of ping-ponging between the top
// two (verified effect: ≥4 distinct families in the first 10 on the heaviest
// library day). The top-scored item always leads; within the 8-pick window,
// penalties (≤48 effective pts) can locally reorder mid-pack items — that
// reordering IS the de-flood. O(n log n) sort + O(n·B) selection, B =
// family×category buckets present that day (a few dozen at most).
const RUN_WIN = 8 // recency window for the soft de-flood penalty
const FAM_PEN = 4 // per same-family appearance in the window
const CAT_PEN = 2 // per same-category appearance in the window
export function orderDay(items, nudge) {
  const n = items.length
  if (n <= 1) return [...items]
  const scored = items.map((e) => ({
    e,
    s: (e.hotScore ?? 30) + (nudge ? nudge(e) : 0),
    fam: sourceFamily(e),
    cat: e.category || 'other',
  }))
  scored.sort((a, b) => b.s - a.s || a.e._t - b.e._t)
  if (n === 2) return scored.map((x) => x.e)
  const buckets = new Map()
  for (const it of scored) {
    const k = it.fam + '|' + it.cat
    const b = buckets.get(k)
    if (b) b.push(it)
    else buckets.set(k, [it])
  }
  const lists = [...buckets.values()]
  const heads = lists.map(() => 0)
  const out = []
  const win = [] // the last RUN_WIN picks (soft-penalty memory)
  const winFam = new Map()
  const winCat = new Map()
  let f1 = null, f2 = null, c1 = null, c2 = null // the last two families/categories placed
  for (let step = 0; step < n; step++) {
    const banFam = f1 != null && f1 === f2 ? f1 : null // placing this fam again = run of 3
    const banCat = c1 != null && c1 === c2 ? c1 : null
    let best = -1
    let bestViol = 3
    let bestEff = -Infinity
    let bestS = -Infinity
    let bestT = Infinity
    for (let i = 0; i < lists.length; i++) {
      if (heads[i] >= lists[i].length) continue
      const it = lists[i][heads[i]]
      const viol = (banFam !== null && it.fam === banFam ? 1 : 0) + (banCat !== null && it.cat === banCat ? 1 : 0)
      const eff = it.s - FAM_PEN * (winFam.get(it.fam) || 0) - CAT_PEN * (winCat.get(it.cat) || 0)
      if (
        viol < bestViol ||
        (viol === bestViol &&
          (eff > bestEff || (eff === bestEff && (it.s > bestS || (it.s === bestS && it.e._t < bestT)))))
      ) {
        best = i
        bestViol = viol
        bestEff = eff
        bestS = it.s
        bestT = it.e._t
      }
    }
    const pick = lists[best][heads[best]++]
    out.push(pick.e)
    f2 = f1
    f1 = pick.fam
    c2 = c1
    c1 = pick.cat
    win.push(pick)
    winFam.set(pick.fam, (winFam.get(pick.fam) || 0) + 1)
    winCat.set(pick.cat, (winCat.get(pick.cat) || 0) + 1)
    if (win.length > RUN_WIN) {
      const old = win.shift()
      winFam.set(old.fam, winFam.get(old.fam) - 1)
      winCat.set(old.cat, winCat.get(old.cat) - 1)
    }
  }
  return out
}

// --- date / formatting helpers ---
export function parseDate(iso) {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d) // local midnight, NOT UTC
  }
  const d = new Date(iso)
  return isNaN(d) ? null : d
}
export function dayTs(iso) {
  const d = parseDate(iso)
  return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null
}
export function dayKey(iso) {
  const d = parseDate(iso)
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : null
}
export function timeOf(iso) {
  if (!iso || !/T\d/.test(iso)) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
export function dayLabel(ts, anchors) {
  if (ts === anchors.todayTs) return 'Today'
  if (ts === anchors.tomorrowTs) return 'Tomorrow'
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
export function priceLabel(e) {
  if (e.isFree === true) return 'Free'
  if (e.price > 0) return '$' + e.price
  return null
}
export function keyOf(e) {
  return (e.url || e.title || '') + '|' + (e.start || '')
}
export function milesBetween(a, b) {
  const R = 3958.8
  const toR = (x) => (x * Math.PI) / 180
  const dLat = toR(b.lat - a.lat)
  const dLng = toR(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// today/tomorrow/weekend anchors; weekend = Fri–Sun window containing or after today
export function makeAnchors(now = new Date()) {
  const at = (off) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off).getTime()
  const dow = now.getDay()
  const friOff = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow
  return { todayTs: at(0), tomorrowTs: at(1), wkStartTs: at(friOff), wkEndTs: at(friOff + 2) }
}

// --- schema v2 normalization (defensive: fields may be absent in the file on disk) ---
export function normalize(raw, anchors) {
  const tags = Array.isArray(raw.tags) ? raw.tags : []
  const sources = Array.isArray(raw.sources) && raw.sources.length ? raw.sources : raw.source ? [raw.source] : []
  const hotScore = typeof raw.hotScore === 'number' ? raw.hotScore : null
  const buzz = typeof raw.buzz === 'number' ? raw.buzz : Math.max(sources.length, 1)
  const category = typeof raw.category === 'string' && raw.category ? raw.category : 'other'
  const sponsored = raw.sponsored === true
  const _ongoing = tags.includes('ongoing')
  const _day = dayTs(raw.start)
  const _endDay = dayTs(raw.end) ?? _day
  const _t = parseDate(raw.start)?.getTime() ?? Number.MAX_SAFE_INTEGER
  const _free = raw.isFree === true || tags.includes('free')
  // computed from the live anchors only — baked _tonight/_weekend tags in the
  // snapshot can be a day old and must never override the runtime range math
  const _tonight = _day != null && anchors.todayTs >= _day && anchors.todayTs <= (_endDay ?? _day)
  const _weekend = _day != null && _day <= anchors.wkEndTs && (_endDay ?? _day) >= anchors.wkStartTs
  return { ...raw, tags, sources, hotScore, buzz, category, sponsored, _day, _endDay, _t, _free, _tonight, _weekend, _ongoing }
}
// 'ongoing' events show "Ongoing" instead of a stale start date/time; a timed
// start that already passed TODAY reads "Started 7:00 PM" — the card stays
// visible, it just stops posing as a plan. Date-only events NEVER say Started
// (an all-day event isn't late). `now` injectable for tests.
export function startLabel(e, now = new Date()) {
  if (e._ongoing) return 'Ongoing'
  const t = timeOf(e.start)
  if (!t) return ''
  const d = new Date(e.start)
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay && d.getTime() < now.getTime() ? 'Started ' + t : t
}

// startedness for sorting: timed starts compare against the clock; date-only
// events only count as started once their whole day is behind todayTs (a
// date-only event today is an all-day plan, never "missed")
export function startedPast(e, todayTs, nowMs = Date.now()) {
  if (e.start && /T\d/.test(e.start)) return e._t < nowMs
  return e._day != null && e._day < todayTs
}

// Tonight section model (HotView): not-yet-started events lead (hotScore desc),
// already-started ones SINK below — never hidden, they wear startLabel's
// "Started …" line. After ~22:00 local with < 3 future events left tonight, the
// section turns into "Late tonight + tomorrow": tomorrow's early-evening timed
// events (4–10 PM starts) fold in between tonight's future and tonight's
// started picks, date-labeled via TonightCard's withDate prop. Pure + clock-
// injectable so the ordering is Node-traceable.
export function tonightModel(upcoming, anchors, now = new Date()) {
  const nowMs = now.getTime()
  const all = upcoming.filter((e) => e._tonight)
  const future = all.filter((e) => !startedPast(e, anchors.todayTs, nowMs)).sort(hotDesc)
  const started = all.filter((e) => startedPast(e, anchors.todayTs, nowMs)).sort(hotDesc)
  // late-mode + the "N still to come" count consider TIMED events only: a
  // date-only listing at 11 PM is almost certainly over, not "still to come" —
  // counting them kept late mode permanently dead (41 phantom futures at 11 PM)
  const futureTimed = future.filter((e) => /T\d/.test(e.start || ''))
  const late = now.getHours() >= 22 && futureTimed.length < 3
  let tomorrow = []
  if (late) {
    // strictly tomorrow-starting (an in-progress event already lives in `all`,
    // so nothing renders twice), timed, early-evening start
    tomorrow = upcoming
      .filter((e) => e._day === anchors.tomorrowTs && /T\d/.test(e.start || ''))
      .filter((e) => {
        const h = new Date(e.start).getHours()
        return h >= 16 && h < 22
      })
      .sort(hotDesc)
  }
  const items = [
    ...future.map((e) => ({ e, withDate: false })),
    ...tomorrow.map((e) => ({ e, withDate: true })),
    ...started.map((e) => ({ e, withDate: false })),
  ]
  return { items, late, futureN: futureTimed.length, tomorrowN: tomorrow.length }
}
export function dayLabelLoose(e) {
  return e._day != null ? new Date(e._day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null
}
export function dayLoose(e) {
  return e._ongoing ? 'Ongoing' : dayLabelLoose(e)
}

// --- icons (createElement, since this is a .js file) ---
export const Icon = {
  hot: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12.6 2.5c.5 3.2-.9 5.1-2.5 6.9C8.6 11 7 12.7 7 15a5.4 5.4 0 0 0 10.8 0c0-2-.9-3.5-2-4.7-.3 1.2-1 2.2-2.2 2.7.7-2.6.3-7-1-10.5Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  map: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Zm0 0v15m6-12v15',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  calendar: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('rect', { x: 3, y: 5, width: 18, height: 16, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', { d: 'M3 9.5h18M8 3v4M16 3v4', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' })
    ),
  // back chevron used by detail + subpage headers
  chevron: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', width: 20, height: 20, ...p },
      h('path', {
        d: 'M15 18l-6-6 6-6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
}

// --- "Added by you" events (Add Event MVP, Sprint C) ---
// Raw schema-v2 objects the user created via AddEvent, persisted to
// localStorage and merged into the normalized feed by App (same normalize()
// path as fetched events; tag 'added-by-you' drives the provenance label).
export const MY_EVENTS_KEY = 'my-events-v1'
export const MY_SOURCE = 'Added by you'
export function loadMyEvents() {
  try {
    const v = JSON.parse(localStorage.getItem(MY_EVENTS_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return [] // missing key / corrupt JSON / private mode — never crash the boot
  }
}
export function saveMyEvents(list) {
  try {
    localStorage.setItem(MY_EVENTS_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable — events still live in App state for the session */
  }
}
// strip normalize()'s computed _fields → a clean schema-v2 object (an
// undo-restored event persists as raw data, identical to a fresh submission)
export function rawOf(e) {
  const out = {}
  for (const k in e) if (k[0] !== '_') out[k] = e[k]
  return out
}
