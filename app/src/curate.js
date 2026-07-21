// curate.js — recurring-series grouping and bounded lead selection for the
// Everything feed.
//
// THE PROBLEM (Josh, ratified 2026-06-15): "condense… we're not being selective
// enough especially with the events." The default Everything feed shows ~1,200
// upcoming rows, ~50% of which are recurring library programs (Baby Time ×88,
// Family Story Time ×71, …) — the same handful of programs repeated across days
// and branches. The feed reads as a firehose, not a magazine.
//
// THE FIX = LEAD + SEE-ALL (two pure, count-preserving passes):
//   1) COLLAPSE recurring series — group the same program (title + source
//      family) into ONE card that honestly says "+ N more dates". The collapsed
//      card carries every instance (`_series`), so nothing is dropped — it's
//      grouped, with the count shown. (1,198 upcoming rows → ~643 groups.)
//   2) CURATE the lead — the caller supplies the shared relevance ordering and
//      a bounded prefix length. Non-lead groups are NOT removed: "See all {N}"
//      opens `curateFeed().full`, so every event remains reachable.
//
// THE NEVER-HIDE CONTRACT (MASTER_PLAN2 — curation-by-quality ≠ taste-filtering):
//   lead ⊆ collapsed ⊆ full, and "See all" reaches `full` (every event).
//   curateFeed returns BOTH the curated sections AND the full sections from the
//   SAME input, so the UI can never show a "See all" that omits anything. The
//   collapse is count-preserving by construction (every instance lands in some
//   group's `_series`); the bounded prefix only chooses which groups LEAD.
//
// PURE + tunable: no React, no CSS, no storage — Node-importable for tests.
import { sourceFamily } from './lib.js'
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
  if (typeof e.seriesId === 'string' && e.seriesId.trim()) return 'series|' + e.seriesId.trim()
  if (typeof e.seriesKey === 'string' && e.seriesKey.trim()) return 'series|' + e.seriesKey.trim()
  const t = (e.title || '').trim().toLowerCase()
  if (!t) return 'untitled|' + (e.id || e.canonicalId || e.canonicalKey || e.url || `${e.start || ''}|${e.venue || ''}`)
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
// via `order` (the caller's shared relevance/diversity contract).
//
// Two parallel section lists come back, built from the SAME collapsed groups:
//   • full     — every collapsed group, day-grouped + ordered. This is what
//                "See all" shows: de-spammed (recurring → one "+N" card) but
//                UNFILTERED by quality. Count-preserving — every input event
//                lives in exactly one group's _series.
//   • curated  — a bounded prefix of that shared ordering. The default lead.
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
// NEVER-HIDE proof shape: curated ⊆ full (curated days are prefix-selected
// subsets of the same collapsed groups) and ⋃ full[*].items[*]._series == the
// input set. The caller wires "See all" to `full`. Nothing is hidden — recurring
// is grouped (with its count shown), low-quality is de-prioritized (not removed).
export function curateFeed(upcoming, { dayOf, labelOf, order, curatedLimit = Infinity } = {}) {
  const keyDay = typeof dayOf === 'function' ? dayOf : (e) => e._clamp ?? e._day
  const ord = typeof order === 'function' ? order : (x) => x
  const limit = Number.isInteger(curatedLimit) && curatedLimit >= 0 ? curatedLimit : Infinity
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
  let remaining = limit
  for (const [d, reps] of byDay.entries()) {
    const ordered = ord(reps)
    const keep = ordered.slice(0, remaining)
    remaining = Math.max(0, remaining - keep.length)
    fullCount += ordered.length
    curatedCount += keep.length
    const meta = labelOf ? labelOf(d) : { label: undefined, dayTs: d }
    // full always carries the day (See-all is complete); curated only when the
    // prefix kept something (no empty-headered days in the default feed).
    full.push({ ...meta, items: ordered })
    if (keep.length) curated.push({ ...meta, items: keep })
  }
  return { curated, full, fullCount, curatedCount, fullEventCount }
}
