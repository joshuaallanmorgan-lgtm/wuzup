// lib.js — shared data helpers, constants, and (JSX-free) icon components.
// NOTE: this file is plain .js, so NO JSX here — icons use createElement.
import { createElement as h } from 'react'
import { categoryById } from './categories.js'
import { lsGet, lsSet } from './storage.js'

// Per-city hero art is a future, multi-city feature; hardcoded to Tampa for now.
// 3.7P-6: hero art is an ARRAY now — cinematic + swipe-READY. One curated entry
// each today (a single hero with a Ken-Burns zoom; FB-06's "slight zoom in/out").
// The multi-photo crossfade turns ON when ≥3 hero-QUALITY Tampa images are
// curated (Charles — a taste call, deferred). Each entry carries its license/
// credit for the ⚑X3 attribution page: these two were hand-picked in W4 and never
// went through the finder's attributions.json, so their credits are recorded here
// (resolved live from Commons). Honesty: a city-mood hero must be a REAL licensed
// Tampa photo (the no-type-photos rule governs a PLACE photo of itself, not the
// city hero) — both are real Tampa Commons photos.
export const CITY = {
  name: 'Tampa Bay',
  heroes: [
    {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/1920px-Tampa_Skyline_-_Eric_Statzer.jpg',
      credit: 'Eric Statzer',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      page: 'https://commons.wikimedia.org/wiki/File:Tampa_Skyline_-_Eric_Statzer.jpg',
    },
  ],
  // W4: the Spots (Locations) tab hero — Bayshore Boulevard, Tampa Bay's waterfront.
  spotsHeroes: [
    {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Tampa_Bayshore_Blvd_looking_south01.jpg/1920px-Tampa_Bayshore_Blvd_looking_south01.jpg',
      credit: 'Ebyabe',
      license: 'CC BY 2.5',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.5',
      page: 'https://commons.wikimedia.org/wiki/File:Tampa_Bayshore_Blvd_looking_south01.jpg',
    },
  ],
  // back-compat scalar aliases — the Primer onboarding reuses CITY.hero as its bg;
  // they mirror heroes[0]/spotsHeroes[0].url (kept as plain strings so the W4
  // real-photo smoke guard still reads them).
  hero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/1920px-Tampa_Skyline_-_Eric_Statzer.jpg',
  spotsHero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Tampa_Bayshore_Blvd_looking_south01.jpg/1920px-Tampa_Bayshore_Blvd_looking_south01.jpg',
}
export const DAY = 86400000

// bubble destinations: every bubble opens a full BubblePage (round-3).
// Category bubbles derive their identity (emoji/label/category id) from the
// canonical registry (categories.js — audit prep #7); the bubble id (used by
// BubblePage's TAGLINES/EMPTIES + HotView's seeAll) and the tile hue stay
// bubble-local facts: the tile tints predate the card hues and deliberately
// differ from them — unifying would be a visible change, not a refactor.
const catBubble = (bubbleId, catId, hue) => {
  const c = categoryById[catId]
  return { id: bubbleId, emoji: c.emoji, label: c.label, kind: 'cat', value: c.id, hue }
}
export const BUBBLES = [
  { id: 'tonight', emoji: '🌙', label: 'Tonight', kind: 'time', value: 'tonight', hue: 250 },
  { id: 'weekend', emoji: '🎉', label: 'This Weekend', kind: 'time', value: 'weekend', hue: 35 },
  { id: 'free', emoji: '🆓', label: 'Free', kind: 'free', value: true, hue: 145 },
  { id: 'near', emoji: '📍', label: 'Near Me', kind: 'sort', value: 'near', hue: 200 },
  catBubble('music', 'music', 285),
  catBubble('food', 'food', 15),
  catBubble('outdoors', 'outdoors', 110),
  catBubble('sports', 'sports', 220),
  catBubble('arts', 'art', 330),
  catBubble('night', 'nightlife', 265),
  catBubble('comedy', 'comedy', 50),
  catBubble('theatre', 'theatre', 350),
  catBubble('family', 'family', 190),
  catBubble('markets', 'market', 80),
  catBubble('clubs', 'community', 175),
]
// Phase 3.6 N1 — the quiet top-nav splits BUBBLES into two roles, never-hide
// preserved (LENS_BUBBLES ∪ CAT_BUBBLES === BUBBLES): the context LENSES
// (time/free/near — the things you reach for) ride a calm pill row; the 11
// CATEGORIES tuck into the "All categories" menu. Same destinations, quieter.
export const LENS_BUBBLES = BUBBLES.filter((b) => b.kind !== 'cat')
export const CAT_BUBBLES = BUBBLES.filter((b) => b.kind === 'cat')

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
  // Sprint S: places carry their own canonical 'p|'-prefixed key (places.json
  // schema v1). Honoring it here is what lets the SAME save/taste/recents seams
  // serve both layers without forking — a place save lands under 'p|slug', an
  // event under its url/title, so the two namespaces can never collide in the
  // shared 'saved-events-v1' store. Inert for events (they never carry kind).
  if (e.kind === 'place' && typeof e.key === 'string' && e.key) return e.key
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
// 3.7P-35 — title normalization: raw scraped titles often SHOUT, carry empty
// parens, or repeat the venue. normalizeTitle cleans them CONSERVATIVELY — it only
// rewrites a title that is fully UPPERCASE (no lowercase letter at all), so a
// proper-case name ("MacFarlane Park", "Ye") is never mangled. Pure + Node-safe.
const TITLE_SMALL = new Set(['a', 'an', 'and', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with'])
const TITLE_ACRONYM = new Set(['DJ', 'BBQ', 'NYE', 'EDM', 'VIP', 'FIFA', 'USA', 'US', 'UK', 'FC', 'EP', 'LP', 'BYOB', 'MLK', 'NYC', 'DIY', 'RSVP', 'AAPI', 'LGBTQ', 'HBCU', 'UFC', 'NBA', 'NFL', 'MLB', 'NASA', 'IPA'])
function smartTitleCase(s) {
  const words = s.split(/\s+/)
  return words
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9]/g, '')
      if (!bare) return w
      const up = bare.toUpperCase()
      if (TITLE_ACRONYM.has(up)) return w // keep known acronyms (FIFA, DJ…) as-is
      if (/\d/.test(w)) return w // numerics/alphanumerics (5K, U2, 90s)
      const low = w.toLowerCase()
      if (i > 0 && TITLE_SMALL.has(low)) return low // small connectors stay lowercase mid-title
      return low.charAt(0).toUpperCase() + low.slice(1)
    })
    .join(' ')
}
export function normalizeTitle(raw, venue) {
  if (typeof raw !== 'string') return raw
  let t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return t
  // strip a trailing " - venue" / " @ venue" / " | venue" duplicate of the venue
  const v = typeof venue === 'string' ? venue.trim() : ''
  if (v) {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp('\\s*[-|@·]\\s*' + esc + '\\s*$', 'i'), '').trim() || t
  }
  // empty parens + collapsed whitespace
  t = t.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim()
  // ALL-CAPS (shouting) → smart Title Case; mixed/proper case is left untouched
  if (/[A-Z]/.test(t) && !/[a-z]/.test(t)) t = smartTitleCase(t)
  return t.trim()
}

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
  // 3.7P-35: clean the scraped title (override raw's pass-through). Conservative —
  // only SHOUTING titles get Title-cased; mixed-case is left exactly as authored.
  const title = normalizeTitle(raw.title, raw.venue)
  return { ...raw, title, tags, sources, hotScore, buzz, category, sponsored, _day, _endDay, _t, _free, _tonight, _weekend, _ongoing }
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
  // future leads via G1 orderDay: hotScore-desc with the same family/category
  // de-flood as the Everything feed (late at night, when every timed event has
  // started, six same-program library cards led the rail). Count-preserving;
  // when everything shares one family+category it degenerates to pure hot-desc.
  const future = orderDay(all.filter((e) => !startedPast(e, anchors.todayTs, nowMs)))
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
  // Profile tab (Sprint O1) — head + shoulders, same 2.1 stroke voice
  profile: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 12, cy: 8, r: 3.7, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', {
        d: 'M4.8 20.4c1-3.7 3.8-5.6 7.2-5.6s6.2 1.9 7.2 5.6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
  // Locations tab pin — DRAWN AND READY for Sprint S, intentionally unused
  // until the tab has content (O1 driver's-seat call: no dead tabs)
  locations: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12 21.2S5.4 15.3 5.4 10.6a6.6 6.6 0 0 1 13.2 0c0 4.7-6.6 10.6-6.6 10.6Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }),
      h('circle', { cx: 12, cy: 10.6, r: 2.4, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 })
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
  // 3.7P-1 elite polish: utility glyphs (replace 🕑🎟️🧭🔗📤 emoji on the
  // detail/place surfaces). Same stroke voice as the tab icons — 2.1 width,
  // round caps, currentColor — so they read as one engineered icon family.
  // (Identity emoji stay: category badges, weather, the 🔥 multi-source flame.)
  clock: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 12, cy: 12, r: 8.4, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', {
        d: 'M12 7.6V12l3 1.9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
  // a price/admission tag — robust stand-in for 🎟️ (Price / Entry rows)
  tag: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M11 3H4.5A1.5 1.5 0 0 0 3 4.5V11a2 2 0 0 0 .6 1.4l8 8a2 2 0 0 0 2.8 0l6-6a2 2 0 0 0 0-2.8l-8-8A2 2 0 0 0 11 3Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 7.6, cy: 7.6, r: 1.5, fill: 'currentColor' })
    ),
  // a navigation arrow for Directions (was 🧭)
  compass: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M3.4 10.9 20.5 3.5 13.1 20.6l-2-7.6-7.7-2.1Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  // share nodes (was 🔗 / 📤)
  share: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 18, cy: 5.5, r: 2.6, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('circle', { cx: 6, cy: 12, r: 2.6, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('circle', { cx: 18, cy: 18.5, r: 2.6, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', {
        d: 'M8.3 10.8 15.7 6.7M8.3 13.2l7.4 4.1',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
      })
    ),
  // 3.7P-13 amenity glyphs for the SpotCard meta — same 2.1 stroke voice. Small,
  // recognizable utility icons (NOT identity emoji); each pairs with a text label.
  restroom: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 12, cy: 4.8, r: 2.2, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', {
        d: 'M12 7.2v6.3m0 0-2.6 5.3M12 13.5l2.6 5.3M8.4 10.2h7.2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
  playground: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M4 5h16M6.5 5 10 12M17.5 5 14 12M9.4 12a2.6 2.6 0 0 0 5.2 0M12 12v8',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
  trail: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M6.5 21c0-4 3-4 3-7s-3-3-3-6 4-3 6-3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 16.5, cy: 15.5, r: 1.25, fill: 'currentColor' }),
      h('circle', { cx: 19, cy: 11, r: 1.25, fill: 'currentColor' })
    ),
  water: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M2.5 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2.5 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
  sports: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 12, cy: 12, r: 8.4, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', {
        d: 'M3.7 12h16.6M12 3.6c3.1 2.5 3.1 14.3 0 16.8M12 3.6c-3.1 2.5-3.1 14.3 0 16.8',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
      })
    ),
  picnic: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M6 3v6a2 2 0 0 0 4 0V3M8 9v12M16.5 3c-1.6 0-2.5 3-2.5 6 0 1.6 1 2.6 2.5 2.6V21',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
  dog: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 7.2, cy: 9, r: 1.55, fill: 'currentColor' }),
      h('circle', { cx: 11, cy: 6.6, r: 1.55, fill: 'currentColor' }),
      h('circle', { cx: 15.4, cy: 7.6, r: 1.55, fill: 'currentColor' }),
      h('path', {
        d: 'M12 11.2c-2.5 0-4.6 2-4.6 4.2 0 1.9 1.7 2.9 4.6 2.9s4.6-1 4.6-2.9c0-2.2-2.1-4.2-4.6-4.2Z',
        fill: 'currentColor',
      })
    ),
}

// --- "Added by you" events (Add Event MVP, Sprint C) ---
// Raw schema-v2 objects the user created via AddEvent, persisted to
// localStorage and merged into the normalized feed by App (same normalize()
// path as fetched events; tag 'added-by-you' drives the provenance label).
export const MY_EVENTS_KEY = 'my-events-v1' // stored as twh:my-events-v1 via storage.js
export const MY_SOURCE = 'Added by you'
export function loadMyEvents() {
  try {
    const v = JSON.parse(lsGet(MY_EVENTS_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return [] // missing key / corrupt JSON / private mode — never crash the boot
  }
}
export function saveMyEvents(list) {
  lsSet(MY_EVENTS_KEY, JSON.stringify(list)) // guarded in storage.js — session state still works
}
// strip normalize()'s computed _fields → a clean schema-v2 object (an
// undo-restored event persists as raw data, identical to a fresh submission)
export function rawOf(e) {
  const out = {}
  for (const k in e) if (k[0] !== '_') out[k] = e[k]
  return out
}
