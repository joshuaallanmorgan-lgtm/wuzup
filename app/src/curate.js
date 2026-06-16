// curate.js — Phase 3.5 W3 front-page CURATION for the Everything feed.
//
// THE PROBLEM (Josh, ratified 2026-06-15): "condense… we're not being selective
// enough especially with the events." The default Everything feed shows ~1,200
// upcoming rows, ~50% of which are recurring library programs (Baby Time ×88,
// Family Story Time ×71, …) — the same handful of programs repeated across days
// and branches. The feed reads as a firehose, not a magazine.
//
// THE FIX = FRONT PAGE + SEE-ALL (two pure, count-preserving passes):
//   1) COLLAPSE recurring series — group the same program (title + source
//      family) into ONE card that honestly says "+ N more dates". The collapsed
//      card carries every instance (`_series`), so nothing is dropped — it's
//      grouped, with the count shown. (1,198 upcoming rows → ~643 groups.)
//   2) CURATE the front page — over the collapsed groups, keep a quality set
//      (frontPagePredicate). The non-front-page groups are NOT removed: a
//      "See all {N}" affordance opens the FULL, uncollapsed feed (curateFeed's
//      `full`), so every single event stays one tap away.
//
// THE NEVER-HIDE CONTRACT (MASTER_PLAN2 — curation-by-quality ≠ taste-filtering):
//   front-page ⊆ collapsed ⊆ full, and "See all" reaches `full` (every event).
//   curateFeed returns BOTH the curated sections AND the full sections from the
//   SAME input, so the UI can never show a "See all" that omits anything. The
//   collapse is count-preserving by construction (every instance lands in some
//   group's `_series`); the front-page filter only chooses which groups LEAD —
//   it removes nothing from `full`.
//
// PURE + tunable: no React, no CSS, no storage — Node-importable for the smoke
// harness. The predicate + threshold are named constants so Josh/Charles can
// ratify the bar against real data without code spelunking.
import { NON_GEM_RE, sourceFamily } from './lib.js'

// ─── tunables (Josh/Charles ratify against real data) ───────────────────────
// FRONT_HOT: a single event earns the front page on quality alone at/above this
// hotScore. The dataset's hotScore clusters: a ~30 default floor, then a real
// step up at ~38+ for events the finder scored on actual signal (named venue,
// rich description, cross-source corroboration). 38 keeps ~460 of 643 collapsed
// groups (≈72%) — visibly shorter than the firehose, still a full magazine, and
// no single day goes empty. Lower = more permissive; raise toward 45 to tighten.
export const FRONT_HOT = 38
// FRONT_BUZZ: cross-source corroboration (the 🔥 heat badge bar) is always
// front-page-worthy regardless of hotScore — two independent sources listing the
// same event is the strongest honest "this matters" signal we have.
export const FRONT_BUZZ = 2
// Collapse threshold is intrinsic, not a tunable: collapseSeries groups every
// repeat, and a group of ONE comes back with _moreDates 0 — so a lone event
// renders no "+N" stamp and reads as a plain single event. The "collapse only
// when ≥2" behavior therefore needs no constant; a former SERIES_MIN export was
// dead (never read by any caller) and was removed rather than left as a dial
// that did nothing.

// front-page predicate over a COLLAPSED group's representative event. A clearly
// named pure boolean so the bar is inspectable + ratifiable. Tags that earn the
// front page outright: a hand-curated hidden-gem or an editorial staff-pick is
// front-page by editorial fiat, whatever its score. DRAFT bar — ⚑ Josh/Charles.
export function frontPagePredicate(e) {
  if (!e) return false
  const tags = Array.isArray(e.tags) ? e.tags : []
  // 3.7P-39 review: a stale hidden-gem tag on a job/career fair must not earn
  // front-page-by-fiat (it can still qualify on its own buzz/hotScore below).
  if (tags.includes('staff-pick') || (tags.includes('hidden-gem') && !NON_GEM_RE.test(e.title || ''))) return true
  if (typeof e.buzz === 'number' && e.buzz >= FRONT_BUZZ) return true
  if (typeof e.hotScore === 'number' && e.hotScore >= FRONT_HOT) return true
  return false
}

// the collapse key: same program voice = same title (case/space-insensitive) +
// same source family. Two DIFFERENT galleries' "Made in Florida" carry distinct
// titles ("Gallery @ 2607 Presents: Made in Florida" vs "Gallery on the Avenue:
// Made in Florida"), so they stay separate cards. But same title within ONE
// source family DOES merge ACROSS venues — Baby Time @ 12 libraries is one
// program (good), and a same-named program running at 2+ businesses also
// collapses (≈53 of 89 multi-instance groups span 2+ venues). That's honest
// ONLY because the collapsed card stamps "+N more dates & venues" and the
// detail's "All dates & venues" list shows each instance's own venue — the
// merge never hides a venue, it discloses them. Falls back to a stable
// per-event identity when a title is missing so a titleless event can never
// accidentally merge with another.
export function seriesKey(e) {
  const t = (e.title || '').trim().toLowerCase()
  if (!t) return 'untitled|' + (e.url || e._t || Math.random())
  return t + '||' + sourceFamily(e)
}

// COLLAPSE a flat event list into groups, preserving every instance. Returns one
// representative per group (the SOONEST instance, so the collapsed card shows the
// next occurrence) carrying:
//   _series      — the full sorted instance list (count-preserving proof)
//   _seriesCount — instances.length (1 for a lone event)
//   _moreDates   — instances.length - 1 (the "+ N more dates" number; 0 = lone)
// Input order within a group is by start time; group order follows FIRST
// appearance of each key in `items` (so a pre-ordered list keeps its lead).
// PURE — never mutates input; representatives are shallow clones (so _series et
// al. don't leak onto the shared normalized objects).
export function collapseSeries(items) {
  const groups = new Map()
  for (const e of items) {
    const k = seriesKey(e)
    const g = groups.get(k)
    if (g) g.push(e)
    else groups.set(k, [e])
  }
  const out = []
  for (const g of groups.values()) {
    // soonest instance leads (the next time this program actually happens)
    const sorted = [...g].sort((a, b) => (a._t ?? Infinity) - (b._t ?? Infinity))
    const rep = sorted[0]
    out.push({
      ...rep,
      _series: sorted,
      _seriesCount: sorted.length,
      _moreDates: sorted.length - 1,
    })
  }
  return out
}

// CURATE a flat, date-sorted upcoming list into the front-page + see-all pair,
// day-grouped for RowFeed ([{ label, dayTs?, items:[event] }]).
//
// COLLAPSE IS GLOBAL, not per-day — that's the whole point. "Baby Time" runs on
// 88 different days; a per-day collapse would still leave 88 cards (one per day).
// Collapsing the FLAT list first turns the whole program into ONE card on its
// soonest day, honestly stamped "+ 87 more dates". The collapsed reps are then
// re-grouped by their representative's day (`dayOf`) and ordered within each day
// via `order` (orderDay's diversity de-flood).
//
// Two parallel section lists come back, built from the SAME collapsed groups:
//   • full     — every collapsed group, day-grouped + ordered. This is what
//                "See all" shows: de-spammed (recurring → one "+N" card) but
//                UNFILTERED by quality. Count-preserving — every input event
//                lives in exactly one group's _series.
//   • curated  — full ∩ frontPagePredicate. The default, quality-led feed.
//
// Returns { curated, full, fullCount, curatedCount, fullEventCount }:
//   fullCount / curatedCount — GROUP (card) counts after collapse.
//   fullEventCount           — raw INSTANCE total (for an honest "See all {N}
//                              events" that quotes the real event number).
//
// upcoming MUST already be date-asc (HotView/BubblePage sort it that way before
// calling). dayOf(e) → the day-bucket key (HotView passes e._clamp; the day
// label/dayTs come from labelOf). order defaults to identity.
//
// NEVER-HIDE proof shape: curated ⊆ full (curated days are predicate-filtered
// subsets of the same collapsed groups) and ⋃ full[*].items[*]._series == the
// input set. The caller wires "See all" to `full`. Nothing is hidden — recurring
// is grouped (with its count shown), low-quality is de-prioritized (not removed).
export function curateFeed(upcoming, { dayOf, labelOf, order } = {}) {
  const keyDay = typeof dayOf === 'function' ? dayOf : (e) => e._clamp ?? e._day
  const ord = typeof order === 'function' ? order : (x) => x
  // 1) GLOBAL collapse — recurring program → one rep on its soonest day
  const groups = collapseSeries(upcoming)
  const fullEventCount = groups.reduce((n, g) => n + (g._seriesCount || 1), 0)
  // 2) re-group the reps by day, preserving the input's date-asc day order
  const byDay = new Map()
  for (const g of groups) {
    const d = keyDay(g)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d).push(g)
  }
  const curated = []
  const full = []
  let fullCount = 0
  let curatedCount = 0
  for (const [d, reps] of byDay.entries()) {
    const ordered = ord(reps)
    const keep = ordered.filter((e) => frontPagePredicate(e))
    fullCount += ordered.length
    curatedCount += keep.length
    const meta = labelOf ? labelOf(d) : { label: undefined, dayTs: d }
    // full always carries the day (See-all is complete); curated only when the
    // predicate kept something (no empty-headered days in the default feed).
    full.push({ ...meta, items: ordered })
    if (keep.length) curated.push({ ...meta, items: keep })
  }
  return { curated, full, fullCount, curatedCount, fullEventCount }
}
