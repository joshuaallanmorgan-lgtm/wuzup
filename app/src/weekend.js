// weekend.js — shared planning selectors (Sprint K2 core, slimmed by 3.7P-8).
// Pure logic only: weekend-window math, daypart classification, slot fitting,
// the picker model, and the plan validator the migration uses. Plain .js with
// NO JSX and no React so the Node verification sim can import it directly (same
// rule as lib.js / taste.js).
//
// 3.7P-8 (FB-10) retired the Weekend Builder VIEW and dropped weekend history.
// What remains here is the SHARED cast still used across the live app:
//   · daypartOf / fitsDay / fitsSlot / pickerModel / whyFits / wxMood
//     — used by DayPage, PickerSheet, AddEvent, DayFillDeck, CalendarView, guides;
//   · PLAN_KEY / planFor / DAY_IDS / SLOT_IDS / weekendDays / emptyPlan
//     — the one-shot 'weekend-plan-v1' → 'day-plans-v1' migration's support cast
//       (dayplan.migrateWeekendPlan is the ONLY remaining reader of PLAN_KEY).
// The retired pieces — loadPlan/savePlan (Sprint U-c) and loadHistory/archivePlan/
// shareText/visibleWeekend/filledCount (3.7P-8) — are gone; see git history.
import { keyOf } from './lib.js'

export const PLAN_KEY = 'weekend-plan-v1' // stored as twh:weekend-plan-v1 via storage.js
export const DAY_IDS = ['fri', 'sat', 'sun']
export const SLOT_IDS = ['fri_day', 'fri_night', 'sat_day', 'sat_night', 'sun_day', 'sun_night']
export const SUGGEST_MAX = 8

// --- the weekend window ---
// makeAnchors (lib.js) already picks the Fri–Sun window containing-or-after
// today: Mon–Thu → this coming Fri; Fri/Sat/Sun → the in-progress weekend.
// weekendDays expands wkStartTs to the three day timestamps with the date
// constructor (NOT +DAY ms) so a DST hop can never misalign a midnight.
export function weekendDays(anchors) {
  const d0 = new Date(anchors.wkStartTs)
  return [0, 1, 2].map((i) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime())
}
// the columns to SHOW: already-finished weekend days drop (Sat → [sat, sun];
// Sun → [sun]); today itself stays — "this weekend incl. today's remaining days".
// A pure window selector (covered by the weekend-window smoke test); kept as a
// shared helper through 3.7P-8 even though the Weekend Builder view that used it
// is gone — the migration + tests rely on the honest window math.
export function visibleWeekend(anchors) {
  return weekendDays(anchors)
    .map((ts, i) => ({ ts, id: DAY_IDS[i] }))
    .filter((d) => d.ts >= anchors.todayTs)
}

// --- daypart classification (TERNARY: morning / afternoon / night) ---
// ⚑PLAN-P0: the plan slots went binary {day,night} → ternary. Thresholds:
//   05:00–12:59 → morning · 13:00–16:59 → afternoon · 17:00+ AND the small
//   hours (≤04:59 — a 12:30 AM club night is the tail of a night out, not a
//   morning plan) → night. No clocked time (date-only) → 'any' — shown in ALL
//   THREE pickers (flagged "Anytime") and defaulting to morning when auto-routed.
export function daypartOf(e) {
  if (!/T\d/.test(e.start || '')) return 'any'
  const h = new Date(e.start).getHours()
  if (h >= 5 && h < 13) return 'morning'
  if (h >= 13 && h < 17) return 'afternoon'
  return 'night'
}

// --- the three dayparts: ONE source of truth for slot label + emoji, in the
// canonical morning → afternoon → night order. EVERY renderer consumes this so a
// slot can never silently mislabel (a future 4th part would surface here, not
// fall into a binary ☀️/🌙 else — the ⚑PLAN-P0 scout contract). Keep the ids in
// sync with dayplan.PARTS (the store's slot keys). ---
export const DAYPARTS = [
  { id: 'morning', label: 'Morning', emoji: '☀️' },
  { id: 'afternoon', label: 'Afternoon', emoji: '☀️' },
  { id: 'night', label: 'Night', emoji: '🌙' },
]
export const DAYPART = Object.fromEntries(DAYPARTS.map((d) => [d.id, d]))
const PART_ORDER = DAYPARTS.map((d) => d.id)

// auto-add slot PREFERENCE for an event: its natural daypart first, then the
// remaining parts in canonical order — so a one-tap add lands in the right slot
// and only falls back when that slot is taken (never clobbers). 'any' (places /
// date-only) → morning-first, the day's start (matching the picker default).
// Shared by every daypart-routing writer (AddEvent / DayFillDeck) so they can't
// drift apart.
export function fillOrder(e) {
  const p = daypartOf(e)
  const pref = p === 'any' ? 'morning' : p
  return [pref, ...PART_ORDER.filter((x) => x !== pref)]
}

// an event fits a day when its start..end span covers that day — a Saturday
// pick can legitimately be a 3-week exhibit that runs through this weekend
export function fitsDay(e, ts) {
  return e._day != null && e._day <= ts && (e._endDay ?? e._day) >= ts
}
export function fitsSlot(e, ts, part) {
  if (!fitsDay(e, ts)) return false
  const p = daypartOf(e)
  return p === 'any' || p === part
}

// --- 'weekend-plan-v1' shape (the migration's source) ---
// shape: { weekendStartTs, slots: { fri_day: keyOf|null, … }, done, v: 1 }
// (`done` = the plan already had its one-shot complete beat; persisted so the
//  celebration can never re-fire on a later open)
export const emptyPlan = (weekendStartTs) => ({
  weekendStartTs,
  slots: { fri_day: null, fri_night: null, sat_day: null, sat_night: null, sun_day: null, sun_night: null },
  done: false,
  v: 1,
})

// stored → live plan, fully guarded: wrong shape, wrong version, or a
// weekendStartTs that no longer matches the requested weekend all reset to an
// empty plan. Slot values must be non-empty strings. 3.7P-8 removed the
// past-weekend ARCHIVE path (weekend history is gone) — a stale plan just resets.
export function planFor(stored, weekendStartTs) {
  if (
    stored &&
    typeof stored === 'object' &&
    !Array.isArray(stored) &&
    stored.v === 1 &&
    stored.weekendStartTs === weekendStartTs &&
    stored.slots &&
    typeof stored.slots === 'object' &&
    !Array.isArray(stored.slots)
  ) {
    const p = emptyPlan(weekendStartTs)
    for (const id of SLOT_IDS) {
      const k = stored.slots[id]
      if (typeof k === 'string' && k) p.slots[id] = k
    }
    p.done = stored.done === true
    return p
  }
  return emptyPlan(weekendStartTs)
}

// --- picker model for one slot ---
// (a) your SAVED events that fit this day+part first ("From your list ❤️"),
// (b) then suggestions: upcoming events fitting day+part, ordered by
//     (hotScore ?? 30) + tasteNudge, max 8.
// Dedup: anything already slotted (any slot) never re-offers, and the
// suggestion list never repeats an event already shown in the saved group.
export function pickerModel({ ts, part, upcoming, saved, plan, nudge }) {
  const slotted = new Set(Object.values(plan.slots).filter(Boolean))
  const savedFit = saved.filter((e) => fitsSlot(e, ts, part) && !slotted.has(keyOf(e)))
  const savedKeys = new Set(savedFit.map((e) => keyOf(e)))
  const suggestions = upcoming
    .filter((e) => fitsSlot(e, ts, part) && !slotted.has(keyOf(e)) && !savedKeys.has(keyOf(e)))
    .map((e) => ({ e, s: (e.hotScore ?? 30) + (nudge ? nudge(e) : 0) }))
    .sort((a, b) => b.s - a.s || a.e._t - b.e._t)
    .slice(0, SUGGEST_MAX)
    .map((x) => x.e)
  return { saved: savedFit, suggestions }
}

// 3.74 — an honest "why it fits" reason for a plan-builder pick, composed ONLY
// from real signal (no fabrication, ban-list clean — no guilt/counts). Priority:
// a real weather cue for the day > free > a strong taste match. Returns a short
// chip label or null (no chip beats a weak one). `w` = the day's forecast entry
// (wx[dateKey(ts)]); `nudge` = tasteNudge. DRAFT labels — ⚑ Charles.
// the day's weather "mood" off the real forecast — shared by whyFits + the DayPage
// cue so the two can never desync (3.74 review). Honest thresholds only; null when
// the forecast is absent or ambiguous (cloudy/fog dead zone → silence, not a weak
// claim). `w` = wx[dateKey(ts)] = { emoji, hi, rain } (rain may be null).
export function wxMood(w) {
  if (!w) return null
  if ((w.emoji === '☀️' || w.emoji === '⛅') && (w.rain == null || w.rain < 40)) return 'clear'
  if (w.rain != null && w.rain >= 50) return 'rainy'
  return null
}

export function whyFits(e, { w, nudge } = {}) {
  if (!e) return null
  const outdoor = e.category === 'outdoors'
  const mood = wxMood(w)
  if (outdoor && mood === 'clear') return '☀️ Clear that day'
  if (!outdoor && mood === 'rainy') return '☔ Good rainy-day pick'
  if (e.isFree === true) return 'Free'
  if (nudge && nudge(e) >= 8) return 'Your kind of thing'
  return null
}
