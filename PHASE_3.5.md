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

## AMBITIOUS EXPANSION (Josh, 2026-06-15 follow-up — "make it very ambitious")
The cleanup above (W1–W4) is table-stakes. Josh raised the bar: make 3.5 a real product-grade pass. Four more workstreams, scouted (2nd wave) before building. These are the CAPSTONE — sequence them AFTER the structural changes (W2/W3/W4) land so we polish the final surfaces, not moving targets.

- **W5 PREMIUM PASS (deep).** Josh: "everything's premium… it still feels a little bit childish… every single part looks premium — the text is premium, even the copy is premium." A top-to-bottom design + copy elevation: the type scale, spacing, color, the emoji-as-UI density (where emoji read childish vs intentional), card/section/detail polish, motion restraint, and a real COPY voice pass (premium tone, not cute). Includes the **Settings page redesign** — Josh: "doesn't match what a premium settings page would look like… a bunch of weird sections." Settings → a clean, premium, grouped surface. This is design-taste-heavy → Josh + Charles own the direction; scout surfaces the cringe spots + options.
- **W6 CONNECTIVITY / USER-PATH.** Josh: "there are a lot of really cool sections… users can't get to those by taking that path. Some sections haven't been updated in terms of how they're intended to connect." Audit EVERY surface + its entry points; find orphaned/hard-to-reach sections + stale connections; define the intended IA so the whole app ties together and every cool thing is reachable on a natural path.
- **W7 MORE LOCATIONS (lift check first).** Josh: "check how heavy of a lift it would be to start adding in more locations… hopefully not that bad." Scout the places-pipeline headroom: more OSM classes / more counties / **and the bigger question — NEW categories** (restaurants, bars, coffee, music venues, museums, shops) vs deepening nature coverage. ⚑Josh decides what KIND of "more" once the lift is known (it reshapes the app's identity + the no-fake-data sourcing).
- **W8 FULL ONBOARDING.** Josh: "the full onboarding experience… we can start over… what does the user think when they click in for the first time, second time, and so on?" Rethink first-open → Nth-open as a premium, intentional arc (today: a 3-tap primer + an optional deck). Likely pairs with W5 (premium) + W6 (path) + W2 (the new calendar) since onboarding teaches the IA.

## Ratified expansion decisions (Josh, 2026-06-15, after the 2nd scout wave wc6rvq5au)
- **W7 = HYBRID.** Deepen nature/outdoor coverage IN 3.5 (disc golf via UDisc, court density, multi-county, Wikidata descriptions — ~+50 places, ~0.4 sprint, no identity shift). The big city-guide layer (restaurants/bars/cafes/museums, ~+1,500–2,200, ~1.5 sprints, OSM-keyless + honest "check online" hours) is a DELIBERATE effort right AFTER 3.5 — not rushed into the polish sprint. Don't reshape the IA/bubbles for restaurants yet.
- **W5 = DEEP, app-wide.** Full premium pass this sprint: copy-voice rewrite everywhere (kill the cutesy empty-states — "go touch grass"/"Crickets"/"Capitalism wins"; emoji-in-copy cleanup while emoji-as-UI stays), Settings redesign (intent-grouped, not data-model "weird sections"), type/spacing refinement (body 13.5→14–15px, the cramped floor), motion polish. **Josh + Charles approve the actual copy + the Settings layout before it ships** (it's brand/taste).
- **W6 connectivity (scout specifics):** orphans to surface — TastePanel (only via Settings, 3 taps → add a Profile entry), CalibrationDeck (only via Settings post-onboarding), InterestEditor (semi-buried). Retire the leftover weekend pill (⚑U-WKND — days are richer; the W2 calendar build kept openWeekend, revisit). Make taste a first-class surface.
- **W8 onboarding = ambitious** (Josh: "very ambitious"): first-open IA tour (teach the 5-tab story + seed taste) + gentle 2nd/Nth-open re-entry (welcome-back, nudge to plan a day) — pull-based, ban-list-clean. Pairs with W5 (voice) + W6 (IA) + W2 (the new calendar). Tour drop-off risk noted; bring the design to Josh.

## Process for the expansion
2nd scout wave (read-only, parallel with W2): **premium+settings**, **connectivity/path**, **more-locations lift**, **onboarding**. Synthesize → bring Josh the design directions + the genuine decisions (what KIND of more-locations; onboarding arc; premium/settings direction) → then build W5–W8 (premium + onboarding are the LAST things, polishing settled surfaces).

## Open ⚑ for Josh/Charles (non-blocking)
- The Spots hero image + the ~7 polished category-art treatments — Charles eyeball.
- Front-page curation criteria — ratify the threshold once W3's first generation runs.
- The 💎 hidden-shelf eyeball pass + ⚑R1 rosters + the standing copy pass still stand from Phase 2/3.
- ⚑W7 what KIND of "more locations" (deepen nature vs add new categories) — Josh, after the lift scout.
- ⚑W5/W8 premium design direction + onboarding arc — Josh + Charles, after the 2nd scout wave.
