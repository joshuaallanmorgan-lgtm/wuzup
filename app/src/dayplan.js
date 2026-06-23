// dayplan.js — the day-plan store (Sprint U-a, CALENDAR_BRIEF Model C).
// weekend.js generalized: ANY day can carry a THREE-slot plan or a rest state,
// not just the Fri–Sun window. Pure logic only — plain .js, NO JSX and no
// React (same rule as lib.js / weekend.js) so the Node verification sims can
// import it directly. The slot semantics (daypartOf / fitsSlot / pickerModel /
// shareText) deliberately STAY in weekend.js — this module imports what it
// needs and the smoke harness's weekend.js imports never move.
//
// ⚑PLAN-P0: the slots are TERNARY (morning/afternoon/night) — migrated forward
// from the binary {day,night} model (day→afternoon, night→night) once, on the
// first loadDayPlans, by migrateBinaryToTernary (idempotent, see below).
//
// STORAGE: 'day-plans-v1' (auto-prefixed twh: via storage.js) = an object
// keyed by dayTs STRING (local-midnight ms, String(ts)):
//   { [dayTs]: { state: 'rest'|null, slots: { morning: keyOf|null, afternoon: keyOf|null, night: keyOf|null }, done: false, v: 1 } }
// · state==='rest' is the user-initiated quiet-day mark. REST AND SLOTS ARE
//   MUTUALLY EXCLUSIVE: withSlot() clears rest, withRest(on) refuses while a
//   slot is filled (the UI only offers the toggle on slot-empty days; this is
//   the defensive backstop). Rest is a calm filled state, never an absence.
// · done is RESERVED for Sprint U-d's one-shot planned→did conversion (the
//   sanctioned violet moment #7). NOTHING in U-a sets it — it exists in the
//   shape so U-d needs no migration. Validation preserves it; UI ignores it.
//
// ARCHIVE SWEEP (risk register: the rest-day-marked-yesterday transition):
// loadDayPlans() moves every entry whose dayTs < anchors.todayTs into
// 'day-history-v1' (array of { dayTs, ...entry }, cap 120 ≈ 4 months, dedup
// by dayTs — first write wins, an already-archived day is never overwritten).
// ARCHIVE-BEFORE-REMOVAL: past plans are the raw material of U-d's journal.
// An empty past entry (no slots, no rest state) is NOT history and drops.
//
// MIGRATION (⚑U-WB, default ratified): migrateWeekendPlan() converts a stored
// 'weekend-plan-v1' exactly once — see the function comment for semantics.
import { lsGet, lsRemove, lsSet } from './storage.js'
import { DAY_IDS, PLAN_KEY, weekendDays } from './weekend.js'

export const DAYPLANS_KEY = 'day-plans-v1' // stored as twh:day-plans-v1
const DAYHISTORY_KEY = 'day-history-v1'
const WEEKEND_DONE_KEY = 'weekend-done-v1' // the WB completion beat's one-shot memory (see below)
const CONVERTED_KEY = 'day-converted-v1' // U-d's morning-after answer ledger (see §U-d block)
const MIGRATED_KEY = 'day-migrated-v1' // ⚑PLAN-P0 binary→ternary one-shot guard (see migrateBinaryToTernary)
export const HISTORY_CAP = 120
// ⚑PLAN-P0: the day-plan slots are TERNARY (was binary {day,night}). PARTS is the
// store's source of truth for slot keys, in canonical order; weekend.DAYPARTS
// carries the matching label/emoji per id (keep the two in sync). Everything that
// reads/counts a slot iterates PARTS so a new daypart can never be silently dropped.
export const PARTS = ['morning', 'afternoon', 'night']

export const emptyDay = () => ({ state: null, slots: { morning: null, afternoon: null, night: null }, done: false, v: 1 })

// stored → clean entry, planFor-grade: wrong shape / wrong version returns
// null (the caller DROPS it — never crash on a corrupt blob); a valid entry
// is rebuilt field-by-field so junk keys and wrong-typed slots can't survive.
export function dayEntryFor(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || stored.v !== 1) return null
  if (!stored.slots || typeof stored.slots !== 'object' || Array.isArray(stored.slots)) return null
  const d = emptyDay()
  for (const part of PARTS) {
    const k = stored.slots[part]
    if (typeof k === 'string' && k) d.slots[part] = k
  }
  // rest+slots is a contradiction no mutator can produce — a hand-edited blob
  // carrying both would render as an invisible-but-counted plan (rest card
  // hides the slot, Profile counts it), so slots win and rest drops here
  if (stored.state === 'rest' && !PARTS.some((p) => d.slots[p])) d.state = 'rest'
  d.done = stored.done === true
  return d
}

// "is this entry worth keeping/archiving?" — a rest mark or any filled slot
// (iterates PARTS so a ternary afternoon plan counts just like day/night did).
// (done alone is impossible in U-a and meaningless without content anyway)
export const hasContent = (d) => d.state === 'rest' || PARTS.some((p) => !!d.slots[p])

function readMap() {
  try {
    const v = JSON.parse(lsGet(DAYPLANS_KEY))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {
    /* absent, corrupt, or private mode — start empty */
  }
  return {}
}

function readHistory() {
  try {
    const v = JSON.parse(lsGet(DAYHISTORY_KEY))
    if (Array.isArray(v)) return v
  } catch {
    /* absent, corrupt, or private mode — no history */
  }
  return []
}

// Profile's past-days list (U-d makes it rich): validated { dayTs, ...entry }
// rows, oldest → newest as stored (callers reverse for most-recent-first).
// Read-only — the archive is only ever WRITTEN by the sweep in loadDayPlans.
export function loadDayHistory() {
  const out = []
  for (const h of readHistory()) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) continue
    if (typeof h.dayTs !== 'number' || !Number.isFinite(h.dayTs)) continue
    const entry = dayEntryFor(h)
    if (entry) out.push({ dayTs: h.dayTs, ...entry })
  }
  return out
}

// append-only, deduped by dayTs (an already-archived day NEVER gets
// overwritten — first write wins, same contract as weekend.js archivePlan)
function archiveDays(rows) {
  if (!rows.length) return
  const list = readHistory()
  const have = new Set(list.map((h) => h && h.dayTs))
  const add = rows.filter((h) => !have.has(h.dayTs))
  if (!add.length) return
  lsSet(DAYHISTORY_KEY, JSON.stringify(list.concat(add).slice(-HISTORY_CAP)))
}

// the ONE read path: runs the one-shot WB migration, validates every entry
// (wrong shapes drop silently), sweeps past days into history, persists the
// cleaned map when anything changed, returns { [String(dayTs)]: entry }.
export function loadDayPlans(anchors) {
  migrateBinaryToTernary() // ⚑PLAN-P0 one-shot binary→ternary (idempotent, guarded) — BEFORE the weekend migration so it reads/writes ternary slots
  migrateWeekendPlan(anchors) // idempotent; a missing weekend-plan-v1 is one lsGet
  const raw = readMap()
  const map = {}
  const past = []
  let dirty = false
  for (const k of Object.keys(raw)) {
    const ts = Number(k)
    const entry = Number.isInteger(ts) && ts > 0 ? dayEntryFor(raw[k]) : null
    if (!entry) {
      dirty = true // junk key or corrupt entry — drop, never crash
      continue
    }
    if (ts < anchors.todayTs) {
      // ARCHIVE-BEFORE-REMOVAL: yesterday's plan (or rest mark) becomes
      // history; an empty past entry is not history and just falls away
      dirty = true
      if (hasContent(entry)) past.push({ dayTs: ts, ...entry })
      continue
    }
    // field-level scrubs (junk slot types, bogus state, extra keys) also mark
    // dirty so the cleaned entry actually persists, not just the cleaned READ
    // (mutator-written entries are canonical, so this stays byte-equal there)
    if (JSON.stringify(entry) !== JSON.stringify(raw[k])) dirty = true
    map[String(ts)] = entry
  }
  if (past.length) {
    past.sort((a, b) => a.dayTs - b.dayTs)
    archiveDays(past)
  }
  if (dirty) saveDayPlans(map)
  return map
}

export function saveDayPlans(map) {
  // returns lsSet's persisted? boolean — the migration checks it (a failed
  // write must not let the source plan get removed); other callers ignore it
  return lsSet(DAYPLANS_KEY, JSON.stringify(map))
}

// ===== pure mutation helpers (return a NEW map; callers save) =====
// withSlot: filling a slot CLEARS a rest mark — rest and slots never coexist
export function withSlot(map, dayTs, part, key) {
  const k = String(dayTs)
  const cur = dayEntryFor(map[k]) ?? emptyDay()
  return { ...map, [k]: { ...cur, state: null, slots: { ...cur.slots, [part]: key } } }
}

export function withClearedSlot(map, dayTs, part) {
  const k = String(dayTs)
  const cur = dayEntryFor(map[k])
  if (!cur || !cur.slots[part]) return map
  const next = { ...cur, slots: { ...cur.slots, [part]: null } }
  const out = { ...map }
  // a fully-empty entry doesn't persist (an unplanned day is a blank page,
  // not a record of nothing) — but a done flag, once U-d sets one, survives
  if (hasContent(next) || next.done) out[k] = next
  else delete out[k]
  return out
}

// withRest(on=true) only ever succeeds on a slot-empty day — the UI only
// offers the toggle there, and this guard makes the rule hold from any caller
export function withRest(map, dayTs, on) {
  const k = String(dayTs)
  const cur = dayEntryFor(map[k]) ?? emptyDay()
  if (on) {
    if (PARTS.some((p) => cur.slots[p])) return map
    return { ...map, [k]: { ...cur, state: 'rest' } }
  }
  const next = { ...cur, state: null }
  const out = { ...map }
  if (hasContent(next) || next.done) out[k] = next
  else delete out[k]
  return out
}

// filled-slot count across a list of day timestamps (WB header, Profile card)
export function filledForDays(map, dayTsList) {
  let n = 0
  for (const ts of dayTsList) {
    const e = dayEntryFor(map[String(ts)])
    if (!e) continue
    for (const part of PARTS) if (e.slots[part]) n++
  }
  return n
}

// ===== ⚑PLAN-P0 — the one-shot binary → ternary daypart migration =====
// remap ONE stored entry's binary slots {day,night} → ternary
// {morning,afternoon,night}: day → afternoon, night → night, morning starts
// empty. Returns a NEW entry object ONLY when a legacy 'day' key was present
// (so callers detect a change by identity); anything already ternary, or not a
// valid entry/slots object, passes through UNCHANGED. That pass-through is the
// defense-in-depth idempotency: even an unguarded re-run can't double-remap a
// slot that no longer carries a 'day' key.
function remapBinaryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const s = entry.slots
  if (!s || typeof s !== 'object' || Array.isArray(s)) return entry
  if (!('day' in s)) return entry // already ternary (or never had a daytime slot) — untouched
  const dayKey = typeof s.day === 'string' && s.day ? s.day : null
  const nightKey = typeof s.night === 'string' && s.night ? s.night : null
  // an explicit morning/afternoon (shouldn't exist pre-migration) is preserved;
  // otherwise the old daytime 'day' lands in afternoon, and night stays night
  const morning = typeof s.morning === 'string' && s.morning ? s.morning : null
  const afternoon = typeof s.afternoon === 'string' && s.afternoon ? s.afternoon : dayKey
  return { ...entry, slots: { morning, afternoon, night: nightKey } }
}

// THE MIGRATION (⚑PLAN-P0). Converts the binary {day,night} day-plan model to
// the ternary {morning,afternoon,night} model: day → afternoon, night → night;
// morning is a NEW, empty slot. Runs EXACTLY ONCE, guarded by 'day-migrated-v1';
// a second call returns immediately, and even unguarded the per-entry remap
// skips anything already ternary (idempotent two ways). Migrates BOTH stores
// that hold the slot shape:
//   · the active 'day-plans-v1' map, AND
//   · the 'day-history-v1' archive — otherwise an archived daytime plan would
//     silently vanish when dayEntryFor rebuilds it on the new PARTS (the journal
//     / Profile / monthReality reads), which would be data loss.
// Forward-only · no data loss. The guard key is written LAST so a mid-run quota
// failure simply retries the whole remap on the next load (it never persists the
// guard without the data). Called at the top of loadDayPlans (the one read path).
export function migrateBinaryToTernary() {
  if (lsGet(MIGRATED_KEY) !== null) return // already migrated — the normal case
  // active map: day-plans-v1
  const raw = readMap()
  let changed = false
  for (const k of Object.keys(raw)) {
    const next = remapBinaryEntry(raw[k])
    if (next !== raw[k]) {
      raw[k] = next
      changed = true
    }
  }
  if (changed) saveDayPlans(raw)
  // archive: day-history-v1 (same {day,night} shape; dayEntryFor reads it on PARTS)
  const hist = readHistory()
  let histChanged = false
  const nextHist = hist.map((h) => {
    const next = remapBinaryEntry(h)
    if (next !== h) histChanged = true
    return next
  })
  if (histChanged) lsSet(DAYHISTORY_KEY, JSON.stringify(nextHist))
  lsSet(MIGRATED_KEY, '1') // guard LAST — see the header
}

// ===== ⚑U-WB — the one-shot weekend-plan-v1 migration =====
// A stored 'weekend-plan-v1' whose weekendStartTs is current-or-future
// converts into day entries (fri/sat/sun dayTs; the legacy fri_day → slots.afternoon,
// fri_night → slots.night per ⚑PLAN-P0) — existing day entries keep their
// already-filled slots (migration never clobbers; in practice the day store is
// empty when this runs). A PAST
// plan is intentionally DISCARDED: 3.7P-8 retired the Weekend Builder and the
// 'weekend-history-v1' archive, so there's no past-weekend record anymore (the
// day-history-v1 journal accumulates going forward). weekend-plan-v1 is REMOVED
// after, which is exactly what makes a second run a no-op (idempotent by absence).
//
// plan.done (the WB completion beat already fired) carries over into
// 'weekend-done-v1' = { weekendStartTs, done: true, v: 1 } — a single-slot
// memory keyed to one weekend, so the sanctioned --reward beat can never
// re-fire after migration. (The DAY entry's done flag is NOT used for this:
// that flag belongs to U-d's planned→did conversion and means something else.)
export function migrateWeekendPlan(anchors) {
  const raw = lsGet(PLAN_KEY)
  if (raw === null) return // already migrated (or never planned) — the normal case
  let stored = null
  try {
    stored = JSON.parse(raw)
  } catch {
    /* corrupt blob — no recoverable plan; fall through to removal */
  }
  const valid =
    stored &&
    typeof stored === 'object' &&
    !Array.isArray(stored) &&
    stored.v === 1 &&
    typeof stored.weekendStartTs === 'number' &&
    stored.slots &&
    typeof stored.slots === 'object' &&
    !Array.isArray(stored.slots)
  if (valid) {
    if (stored.weekendStartTs >= anchors.wkStartTs) {
      // current (or future) weekend → day entries, slot-for-slot. The legacy
      // 'weekend-plan-v1' slots are suffixed _day/_night (the OLD binary
      // dayparts); map them to the TERNARY slots — _day → afternoon, _night →
      // night (matching ⚑PLAN-P0's binary→ternary rule). Decoupled from PARTS
      // ON PURPOSE: the source keys are the old daypart names, not the new ones.
      const dayTsArr = weekendDays({ wkStartTs: stored.weekendStartTs })
      const map = readMap()
      const WEEKEND_SLOT_MAP = { day: 'afternoon', night: 'night' }
      for (let i = 0; i < DAY_IDS.length; i++) {
        for (const legacy of Object.keys(WEEKEND_SLOT_MAP)) {
          const key = stored.slots[DAY_IDS[i] + '_' + legacy]
          if (typeof key !== 'string' || !key) continue
          const part = WEEKEND_SLOT_MAP[legacy]
          const k = String(dayTsArr[i])
          const cur = dayEntryFor(map[k]) ?? emptyDay()
          if (cur.slots[part]) continue // never clobber an existing day slot
          map[k] = { ...cur, state: null, slots: { ...cur.slots, [part]: key } }
        }
      }
      // HARDENING (review #9): archive-before-removal can silently invert if
      // the day-plans write fails (quota) but the removal below succeeds — a
      // failed write keeps weekend-plan-v1 alive for a retry on the next load
      if (!saveDayPlans(map)) return
      if (stored.done === true) markWeekendDone(stored.weekendStartTs)
    }
    // a PAST weekend's plan falls straight through to the lsRemove below —
    // 3.7P-8 discards it (weekend history retired; nothing to archive).
  }
  lsRemove(PLAN_KEY)
}

// ===== the WB completion beat's persistence (replaces plan.done) =====
// Single-slot: only the CURRENT weekend's flag ever matters; a stale ts
// simply reads false and the next markWeekendDone overwrites it.
export function loadWeekendDone(wkStartTs) {
  try {
    const v = JSON.parse(lsGet(WEEKEND_DONE_KEY))
    return !!(v && typeof v === 'object' && !Array.isArray(v) && v.v === 1 && v.weekendStartTs === wkStartTs && v.done === true)
  } catch {
    return false
  }
}
export function markWeekendDone(wkStartTs) {
  lsSet(WEEKEND_DONE_KEY, JSON.stringify({ weekendStartTs: wkStartTs, done: true, v: 1 }))
}

// ===== ⚑U-V7 / U-d — the two-beat loop's RETURN beat: the morning-after
// conversion store + derivations (CALENDAR_BRIEF §5 violet moment #7). =====
//
// THE ANSWER LEDGER ('day-converted-v1' = { [String(dayTs)]: 'went'|'missed', v:1 }):
// when a PAST planned day's morning-after card is answered, the answer is
// recorded here so the card NEVER re-fires and is NEVER re-asked (the Finch
// silence-on-absence rule, ban §7 #9: no daily cadence, no nags). This is a
// SIBLING one-shot store, deliberately NOT the history entry's `done` flag:
// 'day-history-v1' is append-only and dedup-by-dayTs (an archived day is never
// overwritten), so a per-day answer can't live there without breaking that
// contract. The ledger is the single source of "already answered".
// · 'went'  also rides markBeen('went') at the call site (saves.js) — the +2
//           taste signal stays UNFARMABLE (markBeen is idempotent per key); the
//           been-there 'went' entry is what makes the day a DID-DAY (didDays()).
// · 'missed' records ONLY the answer here. Nothing else changes — no taste, no
//           been-there 'went', no branding: the day simply stops being a
//           candidate and goes quietly blank (ban §7 #8: never "you missed").
//
// VIOLET MOMENT #7 is ONE-SHOT PER DAY, persisted: markDayConverted returns
// { firstWrite, violet }. violet === true ONLY on the FIRST 'went' write for a
// day — a re-answer (idempotent: a recorded day never re-writes) returns
// violet:false, so the beat can never re-fire on reopen, and 'missed' NEVER
// lights it. The caller fires the single quiet --reward beat iff violet.
function readConverted() {
  try {
    const v = JSON.parse(lsGet(CONVERTED_KEY))
    if (v && typeof v === 'object' && !Array.isArray(v) && v.v === 1) return v
  } catch {
    /* absent, corrupt, or private mode — nothing answered yet */
  }
  return { v: 1 }
}

// the answered-day map { [String(dayTs)]: 'went'|'missed' } — read-only view
// (the `v` marker filtered out) for the candidate derivation + the journal.
export function loadConverted() {
  const raw = readConverted()
  const out = {}
  for (const k of Object.keys(raw)) {
    if (k === 'v') continue
    if (raw[k] === 'went' || raw[k] === 'missed') out[k] = raw[k]
  }
  return out
}

// record the morning-after answer for a past day. Idempotent: a day already
// answered (went OR missed) is never re-written, so a re-tap can't re-fire the
// violet beat or re-run any side effect. Returns:
//   firstWrite — true only when this call actually recorded the answer
//   violet     — true only on the first-ever 'went' for this day (#7's one-shot)
export function markDayConverted(dayTs, answer) {
  if (answer !== 'went' && answer !== 'missed') return { firstWrite: false, violet: false }
  const k = String(dayTs)
  const raw = readConverted()
  if (raw[k] === 'went' || raw[k] === 'missed') return { firstWrite: false, violet: false }
  raw[k] = answer
  lsSet(CONVERTED_KEY, JSON.stringify(raw))
  return { firstWrite: true, violet: answer === 'went' }
}

// local-midnight ms for a snapshot.start (ISO 'YYYY-MM-DD' or a full datetime),
// matching lib.dayTs's local-not-UTC rule. A bare date is parsed component-wise
// so it never drifts a day across timezones; anything unparseable → null.
// (Kept local so this module stays import-light — see the file header rule.)
function dayTsOf(iso) {
  if (typeof iso !== 'string' || !iso) return null
  let d
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  else {
    const t = new Date(iso)
    if (Number.isNaN(t.getTime())) return null
    d = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  }
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

// DID-DAYS — derived from the been-there store (NOT day-history): a day you
// actually went out is a day with a been-there entry whose status==='went',
// keyed by snapshot.start's local-midnight (CALENDAR_BRIEF §5 / the scout's
// "snapshot.start, never statusAt" rule — statusAt is WHEN you answered, not
// the day you went). Returns a Set<dayTs>. `beenList` is useBeenThere()'s
// array; entries without a went status or a parseable start are skipped.
export function didDays(beenList) {
  const s = new Set()
  if (!Array.isArray(beenList)) return s
  for (const b of beenList) {
    if (!b || b.status !== 'went') continue
    const ts = dayTsOf(b.snapshot?.start)
    if (ts != null) s.add(ts)
  }
  return s
}

// THE MORNING-AFTER CANDIDATES — the past PLANNED days the two-beat card may
// ask about, most-recent-first. A candidate is a day-history entry that is:
//   · genuinely PAST (dayTs < anchors.todayTs — the sweep already guarantees
//     this for archived rows, but we re-check defensively),
//   · a real PLAN (a filled slot — NOT a rest day: a past rest day is a RECORD,
//     honored and never asked "did you make it", ban §7 #10 / ⚑U-REST), and
//   · NOT already answered (absent from the converted ledger).
// The CARD shows ONE candidate at a time (the caller takes [0]) — never a feed
// of nags, never a per-day cadence (ban §7 #9). `history` is loadDayHistory()'s
// array; `converted` is loadConverted()'s answer map.
export function morningAfterCandidates(history, converted, anchors) {
  if (!Array.isArray(history)) return []
  const answered = converted || {}
  return history
    .filter((h) => {
      if (!h || typeof h.dayTs !== 'number') return false
      if (h.dayTs >= anchors.todayTs) return false // not past yet
      if (h.state === 'rest') return false // a rested day is a record, never asked
      if (!h.slots || !PARTS.some((p) => h.slots[p])) return false // no plan to convert (any daypart)
      if (answered[String(h.dayTs)]) return false // already went/missed
      return true
    })
    .sort((a, b) => b.dayTs - a.dayTs) // most recent past planned day first
}

// "N days out in {month}" — ZERO IS SILENCE (ban §7 #8: a quiet month renders
// as nothing, never "0 📉", never shame). Counts DISTINCT did-days (didDays)
// that fall in the given month window [monthStartTs, nextMonthStartTs). Pure;
// the caller renders the line ONLY when n > 0. Breadth-framed by the COPY at
// the call site — this returns the bare count.
export function daysOutInMonth(didDaySet, monthStartTs, nextMonthStartTs) {
  let n = 0
  for (const ts of didDaySet) if (ts >= monthStartTs && ts < nextMonthStartTs) n++
  return n
}

// PLANS → REALITY for a month window (3.76b, extracted to share in 3.7P-3 FB-13):
// of the PAST PLANNED days in [monthStartTs, nextMonthStartTs), how many you made
// it to. A calm RECORD with positive framing — you can only have GONE to a past
// day, so this is a fact, never a score or a guilt line; the caller keeps it
// ZERO-IS-SILENCE (renders only when planned > 0). `history` = loadDayHistory();
// `didDaySet` = didDays(been). Shared by Profile (narrative line) + the Calendar
// this-month rhythm strip so the two surfaces can't drift.
export function monthReality(history, didDaySet, monthStartTs, nextMonthStartTs) {
  let planned = 0
  let went = 0
  for (const h of history) {
    if (h.dayTs < monthStartTs || h.dayTs >= nextMonthStartTs) continue
    if (PARTS.some((p) => h.slots?.[p])) planned++
    if (didDaySet.has(h.dayTs)) went++
  }
  return { planned, went }
}

// VARIETY FIRSTS — breadth, never volume (ban §7 #5: no "10 events!"). A small
// FIXED set of first-time-category stamps: the first time a did-day carried a
// given category, that stamp is earned ONCE and never grows. Returns the EARNED
// stamps (id/label/emoji) for the categories present in the went-list, capped at
// MAX_FIRSTS so the row stays a handful of badges, not a scoreboard. `wentSnaps`
// is the been-there 'went' entries (their snapshots carry .category). Order:
// by the canonical FIRSTS order (stable), so the row never reshuffles.
export const FIRSTS = [
  { id: 'outdoors', label: 'First day outdoors', emoji: '🌳' }, // matches the 'outdoors' id — no 'beach' category exists, so don't claim one
  { id: 'music', label: 'First live music', emoji: '🎵' },
  { id: 'food', label: 'First food outing', emoji: '🍔' },
  { id: 'art', label: 'First arts day', emoji: '🎨' },
  { id: 'market', label: 'First market', emoji: '🛍️' },
]
export const MAX_FIRSTS = FIRSTS.length // 5 — the hard ceiling (breadth, not a tracker)
export function varietyFirsts(wentSnaps) {
  if (!Array.isArray(wentSnaps)) return []
  const have = new Set()
  for (const b of wentSnaps) {
    const c = b?.status === 'went' ? b?.snapshot?.category : null
    if (typeof c === 'string' && c) have.add(c)
  }
  return FIRSTS.filter((f) => have.has(f.id)).slice(0, MAX_FIRSTS)
}
