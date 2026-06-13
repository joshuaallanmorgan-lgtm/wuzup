// weekend.js — Weekend Builder core (Sprint K2, ⚑FLAG-4 prototype).
// Pure logic only: weekend-window math, daypart classification, slot fitting,
// the picker model and the weekend share text. Plain .js with NO JSX and no
// React so the Node verification sim can import it directly (same rule as
// lib.js / taste.js); WeekendBuilder.jsx is the UI.
//
// Sprint U-c: the LIVE plan store ('weekend-plan-v1' loadPlan/savePlan) was
// retired — dayplan.js's 'day-plans-v1' is the single plan store now. What
// remains here of the old store is only the migration's support cast: PLAN_KEY
// (read once by dayplan.migrateWeekendPlan), planFor (its validator), and the
// 'weekend-history-v1' archive (loadHistory/archivePlan — Profile still shows
// past weekends). The single-event ICS + share builders generalized into
// share.js (vevent/wrapIcs/shareDayText); weekend.js's whole-weekend shareText
// below is unchanged and still used by the Weekend Builder.
import { keyOf, timeOf } from './lib.js'
import { lsGet, lsSet } from './storage.js'

export const PLAN_KEY = 'weekend-plan-v1' // stored as twh:weekend-plan-v1 via storage.js
const HISTORY_KEY = 'weekend-history-v1'
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
// Sun → [sun]); today itself stays — "this weekend incl. today's remaining days"
export function visibleWeekend(anchors) {
  return weekendDays(anchors)
    .map((ts, i) => ({ ts, id: DAY_IDS[i] }))
    .filter((d) => d.ts >= anchors.todayTs)
}

// --- daypart classification ---
// 05:00–16:59 starts → 'day'; 17:00+ AND the small hours (a 12:30 AM club
// night is the tail of a night out, not a daytime plan) → 'night'; no
// clocked time (date-only) → 'any' — shown in BOTH pickers, flagged "Anytime".
export function daypartOf(e) {
  if (!/T\d/.test(e.start || '')) return 'any'
  const h = new Date(e.start).getHours()
  return h >= 5 && h < 17 ? 'day' : 'night'
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

// --- 'weekend-plan-v1' persistence ---
// shape: { weekendStartTs, slots: { fri_day: keyOf|null, … }, done, v: 1 }
// (`done` = the plan already had its one-shot complete beat / "Done planning";
//  persisted so the celebration can never re-fire on a later open)
export const emptyPlan = (weekendStartTs) => ({
  weekendStartTs,
  slots: { fri_day: null, fri_night: null, sat_day: null, sat_night: null, sun_day: null, sun_night: null },
  done: false,
  v: 1,
})

// ARCHIVE-BEFORE-OVERWRITE (pre-Sprint-O audit): a stale plan with anything
// in it is the raw material of Profile's "plan history" — push it to
// 'weekend-history-v1' (cap 26 ≈ half a year) before the reset erases it.
function archivePlan(stored) {
  try {
    const filled = Object.values(stored.slots || {}).some((k) => typeof k === 'string' && k)
    if (!filled) return // an empty stale plan is not history
    const prev = JSON.parse(lsGet(HISTORY_KEY))
    const list = Array.isArray(prev) ? prev : []
    if (list.some((p) => p && p.weekendStartTs === stored.weekendStartTs)) return
    lsSet(HISTORY_KEY, JSON.stringify(list.concat(stored).slice(-26)))
  } catch {
    /* private mode — best-effort */
  }
}

// Profile's plan history (O5): the archived past plans, validated, oldest →
// newest as stored (callers reverse for most-recent-first). Read-only — the
// archive is only ever WRITTEN by archivePlan above.
export function loadHistory() {
  try {
    const v = JSON.parse(lsGet(HISTORY_KEY))
    if (Array.isArray(v)) {
      return v.filter(
        (p) =>
          p &&
          typeof p === 'object' &&
          !Array.isArray(p) &&
          p.v === 1 &&
          typeof p.weekendStartTs === 'number' &&
          p.slots &&
          typeof p.slots === 'object' &&
          !Array.isArray(p.slots)
      )
    }
  } catch {
    /* absent, corrupt, or private mode — no history */
  }
  return []
}

// stored → live plan, fully guarded: wrong shape, wrong version, or a
// weekendStartTs that no longer matches the CURRENT weekend all reset to an
// empty plan — but a real stale plan is ARCHIVED first (Profile's plan
// history). Slot values must be non-empty strings.
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
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && stored.v === 1 && stored.weekendStartTs !== weekendStartTs) {
    archivePlan(stored) // a PAST weekend's plan — preserve before the reset
  }
  return emptyPlan(weekendStartTs)
}

// loadPlan/savePlan RETIRED in Sprint U-c: the live 'weekend-plan-v1' store is
// gone — dayplan.js's 'day-plans-v1' is the single plan store now, and
// migrateWeekendPlan() (dayplan.js) is the ONLY remaining reader of PLAN_KEY
// (a one-shot conversion via lsGet, then lsRemove). planFor stays — it's the
// validator the migration's past-weekend archive path calls; loadHistory +
// archivePlan keep 'weekend-history-v1' alive for Profile's past-weekend cards.

export const filledCount = (plan, slotIds = SLOT_IDS) =>
  slotIds.reduce((n, id) => n + (plan.slots[id] ? 1 : 0), 0)

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

// --- "Share plan" text (no image generation — a composed, emoji-rich text) ---
// days = visibleWeekend(anchors); resolve(key, dayTs) → normalized event | null
// (the day ts lets the resolver drop events that no longer fit that day after
// a dataset refresh). Empty slots and fully-empty days are skipped; vanished
// events resolve null and silently drop. Within a day: ☀️ day then 🌙 night.
export function shareText(plan, days, resolve) {
  const lines = ['My Tampa Bay weekend 🌴']
  for (const d of days) {
    const picks = ['day', 'night']
      .map((part) => ({ part, e: resolve(plan.slots[d.id + '_' + part], d.ts) }))
      .filter((x) => x.e)
    if (!picks.length) continue
    lines.push('')
    lines.push('🗓️ ' + new Date(d.ts).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }))
    for (const { part, e } of picks) {
      const bits = [e.title, timeOf(e.start) || null, e.venue || null].filter(Boolean).join(' · ')
      lines.push((part === 'day' ? '☀️ ' : '🌙 ') + bits)
    }
  }
  return lines.join('\n')
}
