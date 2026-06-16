// gamify.js — Finch-kind RHYTHM / streak selectors (Phase 3.7, 3.7P-4).
//
// Gamification was BANNED by CALENDAR_BRIEF §7, then RATIFIED by Josh (PHASE_3.7
// Addendum E): a rhythm/streak is GO, built on the user's own self-reported,
// on-device actions. This module is the honest engine for it.
//
// HONEST BY CONSTRUCTION (Addendum E.3): a "rhythm day" is ONLY a day the user
// explicitly logged — a DID-DAY (a been-there 'went', via didDays) OR a REST day
// (state==='rest', user-marked). Nothing is inferred: a 'missed' answer counts as
// NOTHING, a planned-but-unanswered day counts as NOTHING, opening the app counts
// as NOTHING. Counting your own real taps is not fabrication; inventing a "went"
// would be — and there is no code path that does.
//
// FINCH-KIND (Addendum E.4 — "motivating, not punishing"): the current streak is
// GRACED (act today OR yesterday and it still reads full), the BEST streak is
// monotonic (a gap can never make a number go DOWN), rest is a full citizen, and
// streakStatus() lets the UI stay kind — a gap yields 'dormant' (show the lifetime
// arc + a warm invite), NEVER a broken-flame/shame state. A brand-new user is
// 'none' → render nothing (zero-is-silence as a tone, Addendum E.2).
//
// PURE: no React, no storage, no Date.now() — selectors over data the CALLER
// already loaded (didSet from didDays(been); restTsList via restDayList below),
// plus `anchors` for "today". Same posture as dayplan.js / taste.js, so a Node
// sim can prove every claim.

export const GRACE_DAYS = 1 // act today OR yesterday and a live streak still holds

// DST-safe previous local-midnight (NOT ts - 86400000 — across a DST boundary
// consecutive local midnights are 23h/25h apart, which would falsely break a
// streak; this matters for Pacific cities as much as Eastern).
function prevMidnight(ts) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
}

// collect rest-day local-midnight timestamps from the live plans map + the
// archived history (the caller passes the loaded data — we never touch storage).
export function restDayList(plansMap, history) {
  const out = []
  if (plansMap && typeof plansMap === 'object') {
    for (const [k, e] of Object.entries(plansMap)) if (e && e.state === 'rest') out.push(Number(k))
  }
  if (Array.isArray(history)) {
    for (const h of history) if (h && h.state === 'rest' && typeof h.dayTs === 'number') out.push(h.dayTs)
  }
  return out
}

// the single source of "a logged day": did-days ∪ rest-days, as a Set<dayTs>.
export function rhythmDays(didSet, restTsList) {
  const s = new Set()
  if (didSet) for (const ts of didSet) s.add(ts)
  if (Array.isArray(restTsList)) for (const ts of restTsList) s.add(ts)
  return s
}

// current streak (GRACED): consecutive rhythm days ending at the grace anchor —
// today if logged today, else yesterday if within GRACE_DAYS. 0 once grace lapses
// (paired by streakStatus with a kind 'dormant', never a shame state). Never < 0.
export function currentStreak(didSet, restTsList, anchors) {
  const days = rhythmDays(didSet, restTsList)
  if (!days.size || !anchors) return 0
  const today = anchors.todayTs
  let anchor = null
  if (days.has(today)) anchor = today
  else {
    let probe = today
    for (let g = 0; g < GRACE_DAYS; g++) {
      probe = prevMidnight(probe)
      if (days.has(probe)) {
        anchor = probe
        break
      }
    }
  }
  if (anchor == null) return 0
  let n = 0
  let cur = anchor
  while (days.has(cur)) {
    n++
    cur = prevMidnight(cur)
  }
  return n
}

// best/lifetime streak — the longest consecutive run EVER. Monotonic: it only ever
// grows, so a gap can never decrement it (the never-punishing brag number).
export function bestStreak(didSet, restTsList) {
  const days = [...rhythmDays(didSet, restTsList)].sort((a, b) => a - b)
  if (!days.length) return 0
  let best = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = prevMidnight(days[i]) === days[i - 1] ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

// a calm lifetime fact: how many distinct days you've logged (not a run).
export function totalRhythmDays(didSet, restTsList) {
  return rhythmDays(didSet, restTsList).size
}

// the tone decider, so no view has to (gentleness lives here, not in JSX):
//   'none'    — brand new, nothing logged ever → render nothing (zero-is-silence)
//   'active'  — logged today
//   'grace'   — logged yesterday, today still open (gentle, never "you broke it")
//   'dormant' — nothing recent → show the lifetime arc + a warm invite, NO shame
export function streakStatus(didSet, restTsList, anchors) {
  const days = rhythmDays(didSet, restTsList)
  if (!days.size) return 'none'
  if (!anchors) return 'dormant'
  const today = anchors.todayTs
  if (days.has(today)) return 'active'
  let probe = today
  for (let g = 0; g < GRACE_DAYS; g++) {
    probe = prevMidnight(probe)
    if (days.has(probe)) return 'grace'
  }
  return 'dormant'
}

// the one bundled selector the views call (so Calendar + Profile can't drift —
// the same sharing discipline as monthReality). Pure; one call, all the facts.
export function rhythmSummary(didSet, restTsList, anchors) {
  const days = rhythmDays(didSet, restTsList)
  let lastRhythmTs = null
  for (const ts of days) if (lastRhythmTs == null || ts > lastRhythmTs) lastRhythmTs = ts
  return {
    current: currentStreak(didSet, restTsList, anchors),
    best: bestStreak(didSet, restTsList),
    total: days.size,
    status: streakStatus(didSet, restTsList, anchors),
    lastRhythmTs,
  }
}

// soft, non-streak companion: "you've shown up N days this month" — a gentler %
// than the hard streak. Caller keeps it zero-is-silence (render only when > 0).
export function rhythmThisMonth(didSet, restTsList, monthStartTs, nextMonthStartTs) {
  let logged = 0
  for (const ts of rhythmDays(didSet, restTsList)) {
    if (ts >= monthStartTs && ts < nextMonthStartTs) logged++
  }
  return logged
}
