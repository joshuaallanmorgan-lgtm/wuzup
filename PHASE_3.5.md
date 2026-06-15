# PHASE 3.5 — Cleanup & polish before Phase 4
_2026-06-15 · Josh's playtest feedback, scouted (workflow wh95x5f3j) + ratified. Branch: master-plan-2. Same contract: each workstream → build → adversarial review → hand-verify → npm test → push. No fake data; never-hide holds (curation-by-quality with "see all" ≠ taste-filtering)._

## Ratified decisions (Josh, 2026-06-15)
1. **Calendar = FULL LOGBOOK.** Remove the per-day event list AND the city-busyness heat/counts from the Calendar tab. It shows ONLY the personal layer: planned days, rest days, did-days, the gentle ledger, the morning-after two-beat card. Tapping a day still opens the day screen (the supply bridge stays). Calendar = DEMAND, full stop (Model C, finally clean).
2. **Dice / Find My Night = REMOVED entirely.** Retire FMN + the floating 🎲 FAB + the `night` subpage + openNight. Keep the shared fmnseen.js (Deck/day-fill use it) and the Deck + day-fill decks (the surviving decide-for-me surfaces). recordSignal('fmn') becomes caller-less — leave the seam, note it.
3. **Images = HONEST (real-or-art).** Real tab heroes for Events (skyline already real) + Spots (replace the CSS placeholder with a real Tampa bay/waterfront image). Real per-place photos ONLY for the ~64 places with a verified Wikidata id (one-off fetch → places.json `image` field → finder integration). Everyone else keeps a POLISHED version of today's category-emoji art. **NO type-photos** (a generic park photo on a specific park would imply it's that place — rejected as soft fabrication). Category-art is the honest floor; it just gets refined.
4. **Curation = FRONT PAGE + SEE-ALL.** The default Everything feed shows a quality-curated set; collapse repeated recurring-series (library programs ≈ 50.7% of the 1,536) into one card; a "See all {N}" escape keeps every event one tap away (never-hide intact). Curation decided at GENERATION where possible (a `_frontPage`-style flag in finder/finder.mjs so Josh/Charles own the criteria), UI reads the flag.

## Just-do (no decision needed)
- **Bubble cut-off bug** (App.css .bubbles): bubbles are fixed 112px; at the 460px frame only 3 fit and the 4th overflows the clip with no scroll cue. Fix: narrow to ~96px so 4 fit + a right-edge fade/peek so it reads as scrollable. All bubbles stay in the DOM.
- **Remove the "Full list + weekend plans → Profile" rail** from HotView (Profile owns Your-list + plans).
- **Search polish**: day labels on results, richer grouped zero-state, delete-one-recent (✕ per chip), taste-nudge on date-only "browse" queries only (explicit text searches stay byte-identical on every phone).

## Workstreams (sequence avoids file conflicts on HotView/App/nav)
- **W1 UI cleanup + FMN removal** (main loop): bubble fix, pointer-rail removal, FMN retirement, search polish. Small/mechanical/deletions.
- **W2 Calendar full-logbook rewrite** (workflow build+review): the big one — strip supply from CalendarView, design the clean logbook layout, keep the personal layer + day-open bridge + morning-after card + weekend access.
- **W3 Curation** (workflow build+review): finder front-page flag + collapse-recurring + the "see all" surface; HotView reads it.
- **W4 Images** (workflow/main loop): Spots hero (real), Wikidata image fetch for the 64 (script + finder + places.json), category-art polish.

## Honesty / contract notes
- Curation keeps a visible "See all {N}" — nothing is hidden, only de-prioritized in the default view.
- Place images: only ever a REAL photo of the actual place (Wikidata-verified) or honest category-art. Never a representative stand-in.
- Heat-tint leaving the calendar is fine (it was SUPPLY data on a DEMAND surface).

## Open ⚑ for Josh/Charles (non-blocking)
- The Spots hero image + the ~7 polished category-art treatments — Charles eyeball.
- Front-page curation criteria — ratify the threshold once W3's first generation runs.
- The 💎 hidden-shelf eyeball pass + ⚑R1 rosters + the standing copy pass still stand from Phase 2/3.
