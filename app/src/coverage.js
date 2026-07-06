// coverage.js — the D-G1 Coverage Card's DERIVATION seams (Stage D graft,
// V2 adjudication ruling #6 / V2_VISION §8.6 + STAGE_D.md grafts section).
//
// The card is a small honest "what we know here" surface: N events · M sources
// · updated <time> · imagery coverage. Its contract is the ATTRIBUTION page's
// contract (the anti-drift precedent): every number DERIVES at render time from
// the data the app already loads — the events array App fetched, the places
// store the Spots tab shares, the Last-Modified stamp the boot fetch carried.
// Nothing here is hand-typed, nothing is ever inflated, and an absent input
// makes a line DISAPPEAR rather than fabricate (the stale-banner grace).
//
// Plain .js, JSX-free, Node-importable by design — the smoke harness imports
// this module and runs the promotion gate against the REAL shipped snapshot
// (Tampa must never read "sparse"; see SPARSE_EVENTS_FLOOR below).
//
// Shared helpers extracted here (not duplicated): the event/source tally that
// SettingsPage's provenance card and AttributionPage's headline both spoke,
// and the stale-banner's day-label idiom (App.jsx staleDayLabel → dayStamp).
import { DAY, fmtLocale, sourceFamily } from './lib.js'

// ===== the sparse-city floor (D-G1's real point) =====
// Below this many loaded events, the Coverage Card PROMOTES: it moves to the
// top of Home and says so ("We're new here — N events and growing") instead of
// letting a week-one city render a thin feed that pretends to be Tampa.
//
// Derivation, not magic: Tampa's shipped snapshot carries ~1,665 events across
// ~58 distinct days (median ~22/day) — that is what "rich" reads like. A
// week-one city with 2–3 live sources lands nearer 100–200 total. Under ~300
// events every surface visibly thins (the 7-day feed sections, tonight picks,
// the deck's coverage), so 300 is the honest floor: Tampa clears it 5× over
// (smoke-pinned against the real snapshot), a launch city trips it until its
// source roster grows past its first weeks.
export const SPARSE_EVENTS_FLOOR = 300

// events + distinct source FAMILIES actually loaded ("Eventbrite (p2)" and
// "Eventbrite (Free)" are one voice — lib.js sourceFamily); the user's own
// added-by-you entries are theirs, not a source (the Settings/attribution rule).
export function coverageStats(events) {
  const list = Array.isArray(events) ? events.filter((e) => !e.tags?.includes('added-by-you')) : []
  const fams = new Set()
  for (const e of list) fams.add(sourceFamily(e))
  return { events: list.length, sources: fams.size }
}

// imagery coverage from the places layer: total spots + how many carry a REAL
// verified photo (image + its credit record — the same predicate the
// attribution page's photographer ledger counts). Returns null when the places
// store hasn't loaded — the card then says nothing about spots rather than
// paying the ~1.2MB /places.json fetch at boot or guessing.
export function photoStats(places) {
  if (!Array.isArray(places) || places.length === 0) return null
  return { spots: places.length, photos: places.filter((p) => p.image && p.imageCredit).length }
}

// the promotion gate. Zero is deliberately NOT sparse: a real city snapshot is
// never empty (the finder refuses an empty run) — 0 loaded events means the
// fetch failed or hasn't landed, and the honest answer there is the existing
// empty/loading states, not "0 events and growing".
export function isSparse(nEvents) {
  return nEvents > 0 && nEvents < SPARSE_EVENTS_FLOOR
}

// the stale-banner day-label idiom (extracted from App.jsx staleDayLabel):
// weekday inside the last 6 days ("Friday"), month + day beyond ("Jul 2").
export function dayStamp(ms) {
  return Date.now() - ms <= 6 * DAY
    ? new Date(ms).toLocaleDateString(fmtLocale, { weekday: 'long' })
    : new Date(ms).toLocaleDateString(fmtLocale, { month: 'short', day: 'numeric' })
}
