// lib.js — shared data helpers, constants, and (JSX-free) icon components.
// NOTE: this file is plain .js, so NO JSX here — icons use createElement.
import { createElement as h } from 'react'
import { categoryById } from './categories.js'
import { assignLocalEventIds } from './identity.js'
import { lsGet, lsSet } from './storage.js'

// Stage D4: the CITY config (identity, center, heroes + credits) moved wholesale
// to city.js — the build-time per-city module (D-DEP: one deployment per city).
// Re-exported here so the ~24 existing `import { CITY } from './lib.js'` sites
// stay untouched; new city-shaped code may import './city.js' directly.
// fmtLocale (D4 §3) rides along: the one formatting-locale constant every
// toLocale* call site uses instead of a hardcoded locale literal.
import {
  calendarDayDiff,
  addCalendarDays,
  cityClock,
  cityHourAt,
  cityMidnightMs,
  coversDay,
  dayIdAt,
  daysInMonth,
  eventAvailability,
  eventTime,
  formatDay,
  formatInstant,
  monthStart,
  parseZonedDateTime,
  weekdayOf,
} from '../../shared/city-time.mjs'
import { CITY, fmtLocale } from './city.js'
export { CITY, fmtLocale }
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
// TOUCHUP P2: a Tomorrow filter for the Events FiltersSheet — deliberately NOT in
// BUBBLES (so it never joins the lens row / category menu), only reachable through
// Filters. BubblePage handles value==='tomorrow' (events on the tomorrow date).
export const TOMORROW_BUBBLE = { id: 'tomorrow', emoji: '🌅', label: 'Tomorrow', kind: 'time', value: 'tomorrow', hue: 40 }

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
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? eventTime({ start: iso }, { timeZone: CITY.tz })
    : parseZonedDateTime(iso, CITY.tz)
  const epochMs = parsed?.ok ? (parsed.startAt ?? parsed.epochMs) : NaN
  return Number.isFinite(epochMs) ? new Date(epochMs) : null
}
export function dayTs(iso) {
  const parsed = eventTime({ start: iso }, { timeZone: CITY.tz })
  return parsed.ok ? cityMidnightMs(parsed.startDay, CITY.tz) : null
}
export function dayKey(iso) {
  const parsed = eventTime({ start: iso }, { timeZone: CITY.tz })
  return parsed.ok
    ? formatDay(parsed.startDay, { timeZone: CITY.tz, locale: fmtLocale, weekday: 'long', month: 'long', day: 'numeric' })
    : null
}
export function timeOf(iso) {
  if (!iso || !/T\d/.test(iso)) return ''
  const parsed = parseZonedDateTime(iso, CITY.tz)
  return parsed.ok
    ? formatInstant(parsed.epochMs, { timeZone: CITY.tz, locale: fmtLocale, hour: 'numeric', minute: '2-digit' })
    : ''
}
export function dayLabel(ts, anchors) {
  const day = dayIdAt(ts, CITY.tz)
  const today = anchors.todayDay ?? dayIdAt(anchors.todayTs, CITY.tz)
  const tomorrow = anchors.tomorrowDay ?? dayIdAt(anchors.tomorrowTs, CITY.tz)
  if (day === today) return 'Today'
  if (day === tomorrow) return 'Tomorrow'
  return formatDay(day, { timeZone: CITY.tz, locale: fmtLocale, weekday: 'short', month: 'short', day: 'numeric' })
}
export function dayIdOf(ts) {
  return dayIdAt(ts, CITY.tz)
}

export function addDayTs(ts, amount) {
  const day = dayIdOf(ts)
  return cityMidnightMs(addCalendarDays(day, amount), CITY.tz)
}

export function calendarDayDistance(fromTs, toTs) {
  return calendarDayDiff(dayIdOf(fromTs), dayIdOf(toTs))
}

export function formatDayTs(ts, options = {}) {
  const day = dayIdOf(ts)
  return formatDay(day, { timeZone: CITY.tz, locale: fmtLocale, ...options })
}

export function formatCityInstant(ts, options = {}) {
  return formatInstant(ts, { timeZone: CITY.tz, locale: fmtLocale, ...options })
}

export function weekdayIndex(ts) {
  return weekdayOf(dayIdOf(ts))
}

export function monthStartTs(ts, offset = 0) {
  const day = monthStart(dayIdOf(ts), offset)
  return cityMidnightMs(day, CITY.tz)
}

export function daysInCityMonth(ts) {
  return daysInMonth(dayIdOf(ts))
}

export function dayNumber(ts) {
  return Number(dayIdOf(ts).slice(8, 10))
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
  // 3.7P-35: for a url-less event the title is the identity. normalize() now
  // CLEANS the title, so key off the stashed ORIGINAL (_keyTitle) when present —
  // this keeps keys byte-identical to before title-norm, so saves/recents/day-plan
  // written earlier still resolve (no "same event, two titles" divergence). Raw
  // objects (snapshots) lack _keyTitle and fall back to their own raw title.
  return (e.url || e._keyTitle || e.title || '') + '|' + (e.start || '')
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
export function makeAnchors(now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const clock = cityClock({ timeZone: CITY.tz, nowMs })
  return {
    nowMs,
    nextMidnightMs: clock.nextMidnightMs,
    todayDay: clock.today,
    tomorrowDay: clock.tomorrow,
    wkStartDay: clock.weekendStart,
    wkEndDay: clock.weekendEnd,
    todayTs: cityMidnightMs(clock.today, CITY.tz),
    tomorrowTs: cityMidnightMs(clock.tomorrow, CITY.tz),
    wkStartTs: cityMidnightMs(clock.weekendStart, CITY.tz),
    wkEndTs: cityMidnightMs(clock.weekendEnd, CITY.tz),
  }
}

// --- schema v2 normalization (defensive: fields may be absent in the file on disk) ---
// 3.7P-35 — title normalization: raw scraped titles often SHOUT, carry empty
// parens, or repeat the venue. normalizeTitle cleans them CONSERVATIVELY — it only
// rewrites a title that is fully UPPERCASE (no lowercase letter at all), so a
// proper-case name ("MacFarlane Park", "Ye") is never mangled. Pure + Node-safe.
//
// 3.7P-35 review (HONESTY): de-shouting must never turn a correct acronym into a
// wrong word (USCG→"Uscg", FL→"Fl", RBS→"Rbs" alter meaning). The bias is "when
// unsure, leave the token UPPERCASE" — only a token we're confident is a real
// word gets Title-cased. Acronym signal: allowlisted, OR no vowel (USCG/RBS/FL),
// OR the de-punctuated token has a 3+ run of distinct consonants with no internal
// vowel (e.g. YMCA, NSYNC). A few real words may stay shouted (the SAFE failure —
// no content altered); a real acronym is never flattened into a misnomer.
const TITLE_SMALL = new Set(['a', 'an', 'and', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with'])
const TITLE_ACRONYM = new Set(['DJ', 'BBQ', 'NYE', 'EDM', 'VIP', 'FIFA', 'USA', 'US', 'UK', 'FC', 'EP', 'LP', 'BYOB', 'MLK', 'NYC', 'DIY', 'RSVP', 'AAPI', 'LGBTQ', 'HBCU', 'UFC', 'NBA', 'NFL', 'MLB', 'NASA', 'IPA', 'YMCA', 'YWCA', 'NCAA', 'AARP', 'USCG', 'NASCAR', 'EDC', 'BYO'])
const ORDINAL = /(\d)(TH|ST|ND|RD|S)\b/g
// looks like an acronym/initialism → keep its caps. `bare` is letters+digits only.
function looksAcronym(bare) {
  const up = bare.toUpperCase()
  if (TITLE_ACRONYM.has(up)) return true
  const letters = up.replace(/[^A-Z]/g, '')
  if (!letters) return false
  if (!/[AEIOU]/.test(letters)) return true // no vowel at all (USCG, RBS, FL, BBQ)
  // a leading 3+ all-consonant run before the first vowel (YMCA, NSYNC, BTS)
  return /^[BCDFGHJKLMNPQRSTVWXYZ]{3,}/.test(letters)
}
// Title-case ONE alphabetic word: cap the first letter of each sub-segment so
// hyphen/slash/apostrophe/dotted forms survive (O'Connor, Rock-N-Roll, R.E.M.,
// Jazz/Blues), with the rest lowered.
function caseWord(w) {
  return w.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, pre, c) => pre + c.toUpperCase())
}
function smartTitleCase(s) {
  const words = s.split(/\s+/)
  return words
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9]/g, '')
      if (!bare) return w
      // digit tokens first (an ordinal like 5TH has no vowel and would otherwise
      // read as an acronym): lowercase ordinal/decade suffixes, keep 5K / U2 / 3M.
      if (/\d/.test(w)) return w.replace(ORDINAL, (_m, d, suf) => d + suf.toLowerCase())
      if (looksAcronym(bare)) return w // keep acronyms/initialisms (FIFA, USCG, YMCA…) verbatim
      const low = w.toLowerCase()
      if (i > 0 && TITLE_SMALL.has(low)) return low // small connectors stay lowercase mid-title
      return caseWord(w)
    })
    .join(' ')
}
export function normalizeTitle(raw, venue) {
  if (typeof raw !== 'string') return raw
  let t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return t
  // strip a trailing " - venue" / " @ venue" / " | venue" duplicate of the venue
  // (one-or-more separators, so "Show -- The Hall" leaves no dangling dash)
  const v = typeof venue === 'string' ? venue.trim() : ''
  if (v) {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp('\\s*[-|@·]+\\s*' + esc + '\\s*$', 'i'), '').trim() || t
  }
  // empty parens + collapsed whitespace — never let cleanup blank a real title
  t = t.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim() || t
  // ALL-CAPS (shouting) → smart Title Case; mixed/proper case is left untouched
  if (/[A-Z]/.test(t) && !/[a-z]/.test(t)) t = smartTitleCase(t)
  return t.trim()
}

// 3.7P-39 — section-label honesty (D6 strict): a "Hidden Gems" shelf must not
// carry a job/career/hiring fair (a transactional career event is not an
// under-the-radar find). This predicate gates the gem SHELF only — the event
// still lives in Everything/See-all (curation, never hiding). Kept in sync with
// the finder's own copy (finder.mjs gemCandidates) so future runs tag clean too.
export const NON_GEM_RE = /\b(job|career)\s+fair\b|\bhiring\b|\b(job|career)\s+expo\b|\brecruit(?:ing|ment)?\b/i

export function normalize(raw, anchors) {
  const tags = Array.isArray(raw.tags) ? raw.tags : []
  const sources = Array.isArray(raw.sources) && raw.sources.length ? raw.sources : raw.source ? [raw.source] : []
  const hotScore = typeof raw.hotScore === 'number' ? raw.hotScore : null
  const buzz = typeof raw.buzz === 'number' ? raw.buzz : Math.max(sources.length, 1)
  const category = typeof raw.category === 'string' && raw.category ? raw.category : 'other'
  const sponsored = raw.sponsored === true
  const _ongoing = tags.includes('ongoing')
  const _time = eventTime(raw, { timeZone: CITY.tz })
  const _availability = eventAvailability(_time, {
    nowMs: anchors.nowMs ?? Date.now(),
    status: raw.status,
  })
  const _day = _time.ok ? cityMidnightMs(_time.startDay, CITY.tz) : null
  const _endDay = _time.ok ? cityMidnightMs(_time.endDay, CITY.tz) : _day
  const _t = _time.ok ? _time.startAt : Number.MAX_SAFE_INTEGER
  const _free = raw.isFree === true || tags.includes('free')
  // computed from the live anchors only — baked _tonight/_weekend tags in the
  // snapshot can be a day old and must never override the runtime range math
  const todayDay = anchors.todayDay ?? dayIdAt(anchors.todayTs, CITY.tz)
  const wkStartDay = anchors.wkStartDay ?? dayIdAt(anchors.wkStartTs, CITY.tz)
  const wkEndDay = anchors.wkEndDay ?? dayIdAt(anchors.wkEndTs, CITY.tz)
  const tonightSpan = _time.ok ? calendarDayDiff(_time.startDay, _time.endDay) : Infinity
  const _tonight = coversDay(_time, todayDay) && (
    _time.kind === 'all-day'
      ? _time.startDay === todayDay && _time.endDay === todayDay
      : tonightSpan <= 1
  )
  const _weekend = _time.ok && _time.startDay <= wkEndDay && _time.endDay >= wkStartDay
  // 3.7P-35: clean the scraped title (override raw's pass-through). Conservative —
  // only SHOUTING titles get Title-cased; mixed-case is left exactly as authored.
  // Stash the original ONLY for url-less events, where keyOf needs a stable
  // identity. Preserve an existing _keyTitle so re-normalizing a stored snapshot
  // (whose `title` is already cleaned) can't drift the key off the cleaned title.
  const title = normalizeTitle(raw.title, raw.venue)
  const _keyTitle = raw.url ? undefined : (raw._keyTitle ?? raw.title)
  return {
    ...raw,
    title, _keyTitle, tags, sources, hotScore, buzz, category, sponsored,
    _time, _availability, _actionable: _availability.actionable,
    _day, _endDay, _t, _free, _tonight, _weekend, _ongoing,
  }
}

export function currentEvents(events) {
  return Array.isArray(events) ? events.filter((event) => event?._actionable === true) : []
}
const LIFECYCLE_LABEL = {
  ended: 'Happened',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  'sold-out': 'Sold out',
  invalid: 'Unavailable',
}

export function eventLifecycle(event) {
  if (event?.kind === 'place') return { actionable: true, code: 'place', label: null }
  if (event?._actionable === true) return { actionable: true, code: 'actionable', label: null }
  const code = event?._availability?.code || 'invalid'
  return { actionable: false, code, label: LIFECYCLE_LABEL[code] || 'Unavailable' }
}
// 'ongoing' events show "Ongoing" instead of a stale start date/time; a timed
// start that already passed TODAY reads "Started 7:00 PM" — the card stays
// visible, it just stops posing as a plan. Date-only events NEVER say Started
// (an all-day event isn't late). `now` injectable for tests.
export function startLabel(e, now = Date.now()) {
  if (e._ongoing) return 'Ongoing'
  const t = timeOf(e.start)
  if (!t) return ''
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const canonical = e._time?.ok ? e._time : eventTime(e, { timeZone: CITY.tz })
  const sameDay = canonical.ok && canonical.startDay === dayIdAt(nowMs, CITY.tz)
  return sameDay && canonical.startAt < nowMs ? 'Started ' + t : t
}

// startedness for sorting: timed starts compare against the clock; date-only
// events only count as started once their whole day is behind todayTs (a
// date-only event today is an all-day plan, never "missed")
export function startedPast(e, todayTs, nowMs = Date.now()) {
  const canonical = e._time?.ok ? e._time : eventTime(e, { timeZone: CITY.tz })
  if (!canonical.ok) return false
  if (canonical.kind === 'timed') return canonical.startAt < nowMs
  return canonical.startDay < dayIdAt(todayTs, CITY.tz)
}

// Tonight section model (HotView): not-yet-started events lead (hotScore desc),
// already-started ones SINK below — never hidden, they wear startLabel's
// "Started …" line. After ~22:00 local with < 3 future events left tonight, the
// section turns into "Late tonight + tomorrow": tomorrow's early-evening timed
// events (4–10 PM starts) fold in between tonight's future and tonight's
// started picks, date-labeled via TonightCard's withDate prop. Pure + clock-
// injectable so the ordering is Node-traceable.
export function tonightModel(upcoming, anchors, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
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
  const late = cityHourAt(nowMs, CITY.tz) >= 22 && futureTimed.length < 3
  let tomorrow = []
  if (late) {
    // strictly tomorrow-starting (an in-progress event already lives in `all`,
    // so nothing renders twice), timed, early-evening start
    tomorrow = upcoming
      .filter((e) => e._time?.startDay === (anchors.tomorrowDay ?? addCalendarDays(dayIdAt(anchors.todayTs, CITY.tz), 1)) && /T\d/.test(e.start || ''))
      .filter((e) => {
        const h = cityHourAt(e._time.startAt, CITY.tz)
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
  const day = e._time?.startDay ?? (e._day != null ? dayIdAt(e._day, CITY.tz) : null)
  return day
    ? formatDay(day, { timeZone: CITY.tz, locale: fmtLocale, weekday: 'short', month: 'short', day: 'numeric' })
    : null
}
export function dayLoose(e) {
  return e._ongoing ? 'Ongoing' : dayLabelLoose(e)
}

// WAI-ARIA tabs keyboard nav (roving tabindex): Arrow/Home/End move BOTH selection
// and focus on an automatic-activation tablist. Caller passes the ordered values,
// the current index, a value-setter, and a ref holding the tab-button elements.
// Shared so the two tablists (MySaves filter, PickerSheet source) don't diverge.
export function tablistArrowKey(ev, order, currentIndex, setByValue, tabRefs) {
  const last = order.length - 1
  let next
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = currentIndex >= last ? 0 : currentIndex + 1
  else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = currentIndex <= 0 ? last : currentIndex - 1
  else if (ev.key === 'Home') next = 0
  else if (ev.key === 'End') next = last
  else return
  ev.preventDefault()
  setByValue(order[next])
  tabRefs.current?.[next]?.focus()
}

// --- icons (createElement, since this is a .js file) ---
export const Icon = {
  // Home tab (Stage R nav restructure) — a house, same 2.1 stroke voice as the
  // other tab glyphs.
  home: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M3.5 11.3 12 4.2l8.5 7.1M5.6 9.6V20h12.8V9.6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
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
  // PREMIUM A2: the engineered controls family — same 2.1-stroke voice as the tab
  // glyphs (retires the raw ♥ ♡ 🔥 📍 ★ emoji on the result cards). heart =
  // outline (resting), heartFill = filled (saved). flame reuses `hot`; the venue
  // pin + the "Best for" sparkle round out the set. 💎 stays as a deliberate accent.
  heart: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12 20.6C12 20.6 3.7 15.1 3.7 9.2 3.7 6.3 6 4.4 8.4 4.4 10 4.4 11.4 5.4 12 6.8 12.6 5.4 14 4.4 15.6 4.4 18 4.4 20.3 6.3 20.3 9.2 20.3 15.1 12 20.6 12 20.6Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  heartFill: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12 20.6C12 20.6 3.7 15.1 3.7 9.2 3.7 6.3 6 4.4 8.4 4.4 10 4.4 11.4 5.4 12 6.8 12.6 5.4 14 4.4 15.6 4.4 18 4.4 20.3 6.3 20.3 9.2 20.3 15.1 12 20.6 12 20.6Z',
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  // a compact map pin for the inline venue/location meta line (was 📍)
  pin: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12 21S5.5 14.8 5.5 9.8a6.5 6.5 0 0 1 13 0c0 5-6.5 11.2-6.5 11.2Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }),
      h('circle', { cx: 12, cy: 9.8, r: 2.2, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 })
    ),
  // a 4-point sparkle for the "Best for" line (was ★)
  sparkle: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12 3.2c.8 4.6 1.9 5.7 6.5 6.5-4.6.8-5.7 1.9-6.5 6.5-.8-4.6-1.9-5.7-6.5-6.5 4.6-.8 5.7-1.9 6.5-6.5Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  // Cohesion WS3 (§9 emoji-out-of-chrome): the minimal WEATHER set — the wx
  // emoji stays the DATA key (weather.js WMO map); these are the engineered
  // faces chrome renders (NextDays' tinted disc). Same 2.1-stroke voice.
  // ⚑ Charles: all five weather paths + moon/dots/burst/sprout/shuffle below
  // are NEW drawings — retune shapes freely, keep the 2.1/round voice.
  sun: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 12, cy: 12, r: 4.1, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', {
        d: 'M12 2.6v2.5M12 18.9v2.5M2.6 12h2.5M18.9 12h2.5M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2 17 7M7 17l-1.8 1.8',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
      })
    ),
  cloud: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M7 18.5a4.2 4.2 0 0 1-.6-8.36 5.4 5.4 0 0 1 10.6 1.06 3.65 3.65 0 0 1-.75 7.3H7Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  rain: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M7 15.5a4.1 4.1 0 0 1-.6-8.16 5.3 5.3 0 0 1 10.4 1.04 3.55 3.55 0 0 1-.73 7.12H7Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M8.4 18.4l-.8 2.4M12.4 18.4l-.8 2.4M16.4 18.4l-.8 2.4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
      })
    ),
  storm: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M7 15a4.1 4.1 0 0 1-.6-8.16 5.3 5.3 0 0 1 10.4 1.04A3.55 3.55 0 0 1 16.07 15H7Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M12.8 15.4 10.6 19h2.6l-1.6 3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  // a crescent for the rest/quiet-day language (the calendar's CSS crescent,
  // as a glyph — was the 🌙 text emoji)
  moon: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M19.6 14.2A7.9 7.9 0 0 1 9.8 4.4a7.9 7.9 0 1 0 9.8 9.8Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  // the ⋯ options trigger (kebab) — small filled dots, same voice as trail's
  dots: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('circle', { cx: 5, cy: 12, r: 1.8, fill: 'currentColor' }),
      h('circle', { cx: 12, cy: 12, r: 1.8, fill: 'currentColor' }),
      h('circle', { cx: 19, cy: 12, r: 1.8, fill: 'currentColor' })
    ),
  // a celebration burst (was 🎉 on "I went" / "Weekends are your nights")
  burst: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12 4.4v3M17.4 6.6l-2.2 2.2M19.6 12h-3M17.4 17.4l-2.2-2.2M12 19.6v-3M6.6 17.4l2.2-2.2M4.4 12h3M6.6 6.6l2.2 2.2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
      }),
      h('circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor' })
    ),
  // a sprout for the fresh-start settings beat (was 🌱)
  sprout: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12 20.5v-7M12 13.5c0-3.6 2.4-6 6.4-6 0 3.6-2.4 6-6.4 6ZM12 11.5c0-3-2-5-5.4-5 0 3 2 5 5.4 5Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  // crossing shuffle arrows for the "out whenever" mood (was 🤷)
  shuffle: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M3.5 7h3.4c5.4 0 8.2 10 13.6 10M3.5 17h3.4c1.9 0 3.4-1.2 4.7-2.8M20.5 7h-3.4c-1.9 0-3.5 1.3-4.8 3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'm18 4.6 2.5 2.4L18 9.4M18 14.6l2.5 2.4L18 19.4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
}

// --- "Added by you" events (Add Event MVP, Sprint C) ---
// Raw schema-v2 objects the user created via AddEvent, persisted to
// localStorage and merged into the normalized feed by App (same normalize()
// path as fetched events; tag 'added-by-you' drives the provenance label).
export const MY_EVENTS_KEY = 'my-events-v1' // stored as twh:my-events-v1 via storage.js
export const MY_SOURCE = 'Added by you'
export function validMyEvent(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && typeof value.start === 'string'
    && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?/.test(value.start)
}
function legacySafeMyEvents(valid) {
  return assignLocalEventIds(valid, { createId: () => null }).items
}
export function loadMyEvents() {
  try {
    const v = JSON.parse(lsGet(MY_EVENTS_KEY))
    const valid = Array.isArray(v) ? v.filter(validMyEvent) : []
    const migration = assignLocalEventIds(valid)
    if (!migration.changed) return valid
    if (lsSet(MY_EVENTS_KEY, JSON.stringify(migration.items))) return migration.items
    if (!migration.complete) {
      // Duplicate IDs are unsafe even for one session. Keep the collision-free
      // legacy fallback in memory while the untouched durable source retries.
      lsSet(MY_EVENTS_KEY, JSON.stringify(migration.items))
      return migration.items
    }
    // Newly minted IDs would disappear on reload. Keep only durable prior IDs,
    // strip later duplicate owners, and fall new rows back to legacy identity.
    const fallback = legacySafeMyEvents(valid)
    lsSet(MY_EVENTS_KEY, JSON.stringify(fallback))
    return fallback
  } catch {
    return [] // missing key / corrupt JSON / private mode — never crash the boot
  }
}
export function saveMyEvents(list, { createId } = {}) {
  const valid = Array.isArray(list) ? list.filter(validMyEvent) : []
  const migration = assignLocalEventIds(valid, { createId })
  if (!migration.complete) {
    const persisted = lsSet(MY_EVENTS_KEY, JSON.stringify(migration.items))
    return { items: migration.items, persisted, complete: false }
  }
  const persisted = lsSet(MY_EVENTS_KEY, JSON.stringify(migration.items))
  if (persisted) return { items: migration.items, persisted: true, complete: true }
  // Keep failed writes collision-free on legacy identities in session too.
  const fallback = legacySafeMyEvents(valid)
  lsSet(MY_EVENTS_KEY, JSON.stringify(fallback))
  return { items: fallback, persisted: false, complete: false }
}
// strip normalize()'s computed _fields → a clean schema-v2 object (an
// undo-restored event persists as raw data, identical to a fresh submission)
export function rawOf(e) {
  const out = {}
  for (const k in e) if (k[0] !== '_') out[k] = e[k]
  return out
}

export function cityHour(ts) {
  return cityHourAt(ts, CITY.tz)
}
