// tastequality.js — Sprint V4: the RECOMMENDATION-QUALITY BENCHMARK. A pure,
// sim-able metric over (events, profile) so the smoke harness can assert that
// taste never starves the feed or collapses its diversity. Plain .js (no JSX,
// no CSS) — the harness imports it straight into Node, same rule as lib/taste.
//
// WHY THIS EXISTS: the taste invariants (nudge bound, count-preserving order)
// guarantee taste never HIDES anything. But "never hides" isn't "stays good":
// a future change could let a strong lean dominate the top of the feed so
// hard that the first screen is one category from one source — technically
// present-but-buried diversity, practically a monoculture. This metric catches
// that NUMERICALLY: a regression that lets taste over-concentrate or starve
// fails npm test loudly, not in a user's hands six weeks later.
//
// TWO NUMBERS, both over the TOP-20 of the taste-ordered feed (the part a user
// actually sees first — the rest of the count-preserving permutation is real
// but below the fold):
//
//   1. diversity — 1 − concentration. We measure how concentrated the top-20
//      is across CATEGORIES and across SOURCE FAMILIES (the library de-flood's
//      own enemy), and take the WORSE (max concentration) of the two.
//      · maxShare(cat) and maxShare(family): the largest single share of the
//        top-20. diversity = 1 − max(catShare, famShare). A perfectly even
//        spread → high; one category owning the whole top-20 → 0.
//      · TWO assertions, because the RAW feed's diversity is a property of the
//        DATA (a date whose first day is all standing gallery exhibitions is
//        genuinely art-heavy — not a bug). So the benchmark catches TASTE-
//        INDUCED collapse, not the data's own shape:
//        (a) an ABSOLUTE backstop — DIVERSITY_FLOOR is a low true-monoculture
//            alarm (one bucket owning > 1−floor of the top-20 is broken no
//            matter the cause), AND
//        (b) a RELATIVE guard — tasted diversity ≥ neutral diversity −
//            DIVERSITY_DROP_TOL: taste may not COLLAPSE the feed below what the
//            raw (no-taste) order already delivers. THIS is the regression the
//            spec names ("taste collapses diversity") — measured against the
//            data's own honest baseline, not an arbitrary absolute.
//
//   2. matchRate — for a profile with a CLEAR lean, the fraction of the top-20
//      in that lean's top categories. The contract is a BAND, not "maximize":
//      · a clear-lean profile must see MORE of its lean than a neutral profile
//        would (taste is doing its job — lift ≥ MATCH_MIN_LIFT), AND
//      · it must NOT starve everything else: the lean can't own MORE than
//        MATCH_MAX of the top-20 (room for serendipity + the other categories
//        the never-hide promise protects). A profile that sees 100% of one lean
//        in its first 20 is over-fit — that fails too.
//
// HOW THE TOP-20 IS DRAWN — and why NOT "the literal first day of the feed":
// HotView's Everything feed is day-grouped, so the user's literal first 20 are
// day-0's first 20. But day 0 is often hotScore-saturated by one standing
// category (e.g. gallery exhibitions that run for weeks), where NO per-day
// reordering — taste or not — can change much: that measures the data's first
// day, not the taste engine. The quality benchmark instead measures taste's
// RANKING POWER across the browsing window: every upcoming event scored by the
// SAME adjustedScore the feed uses (hotScore + nudge), global top-20. This is
// "what taste surfaces if you flatten the next-N-days a user scrolls" — the
// place taste's lift is actually observable, and the honest target of a
// "does taste help / does it starve" benchmark. orderDay's per-day de-flood
// still governs the live feed; this metric governs the RANKER underneath it.
import { sourceFamily } from './lib.js'
import { tasteNudge, topCategories } from './taste.js'

export const TOP_N = 20
export const DIVERSITY_FLOOR = 0.2 // absolute backstop: top-20 may not be > 80%
//                                    one cat OR one family (a true monoculture)
export const DIVERSITY_DROP_TOL = 0.1 // taste may not drop top-20 diversity more
//                                       than this below the no-taste baseline
//                                       (the "taste collapses diversity" guard)
export const MATCH_MIN_LIFT = 1 // a clear lean must add ≥ 1 lean-item vs neutral
export const MATCH_MAX = 0.85 // …but never own > 85% of the top-20 (no starvation)

// the top-N by adjustedScore = (hotScore ?? 30) + nudge(e) — the SAME score
// orderDay ranks with, read as a flat global ranking (the browsing-window
// ranker, see the header note). `nudge` is the taste fold (tasteNudge bound to
// a profile) or null for the neutral baseline. Ties break by _t (sooner first),
// matching orderDay's tiebreak. Pure: never mutates `events`. Upcoming-only is
// the CALLER's job (pass the already-filtered list).
export function topFeed(events, nudge, n = TOP_N) {
  return [...events]
    .map((e) => ({ e, s: (e.hotScore ?? 30) + (nudge ? nudge(e) : 0) }))
    .sort((a, b) => b.s - a.s || (a.e._t ?? 0) - (b.e._t ?? 0))
    .slice(0, n)
    .map((x) => x.e)
}

// the largest single share of `items` under keyFn (1 → all one bucket)
function maxShare(items, keyFn) {
  if (!items.length) return 0
  const counts = new Map()
  for (const it of items) {
    const k = keyFn(it) || 'other'
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  let top = 0
  for (const c of counts.values()) if (c > top) top = c
  return top / items.length
}

// diversity = 1 − the worse of {category concentration, family concentration}.
// We take the WORSE so a feed that's varied by category but all one source
// family (the library flood) still scores low — both axes must hold.
export function diversityScore(topItems) {
  if (!topItems.length) return 1
  const catConc = maxShare(topItems, (e) => e.category)
  const famConc = maxShare(topItems, (e) => sourceFamily(e))
  return 1 - Math.max(catConc, famConc)
}

// matchRate = share of topItems whose category is in the profile's top-k lean.
export function matchRate(topItems, leanCats) {
  if (!topItems.length) return 0
  const set = new Set(leanCats)
  let hit = 0
  for (const e of topItems) if (set.has(e.category)) hit++
  return hit / topItems.length
}

// THE BENCHMARK — pure over (upcomingEvents, profile). Returns the numbers the
// harness asserts. `profile` is a taste profile object (the live one or a
// synthetic one). Computes the neutral baseline (no nudge) and the tasted feed
// (this profile's nudge) so the lift is honest — "more of your lean than you'd
// get with no taste at all", measured, not assumed.
export function feedQuality(upcoming, profile) {
  const leanCats = topCategories(profile, 2)
  const neutralTop = topFeed(upcoming, null)
  const tastedTop = topFeed(upcoming, (e) => tasteNudge(e, profile))
  const neutralMatch = matchRate(neutralTop, leanCats)
  const tastedMatch = matchRate(tastedTop, leanCats)
  return {
    n: tastedTop.length,
    leanCats,
    diversity: diversityScore(tastedTop),
    neutralDiversity: diversityScore(neutralTop),
    matchRate: tastedMatch,
    neutralMatchRate: neutralMatch,
    // lift in COUNT (items, not fraction) — the harness's MATCH_MIN_LIFT is in
    // items so a small top-20 isn't punished by fractional rounding
    matchLift: Math.round((tastedMatch - neutralMatch) * tastedTop.length),
  }
}
