# CARD + FILTER lock — the canonical result card + inline filter bar (Events + Spots)

> **Locked decision (Josh, 2026-06-24 check-in):** adopt the LEFT-IMAGE editorial card everywhere and
> RETIRE the right-thumb `CompactRow` from result/destination feeds; standardize the inline filter-chip
> bar and render it on results too. Build Events-full + Spots-full to THIS so the card is built once.
> Grounded in `ref-events-full-1.png` / `ref-spots-full-1.png` + the existing landing cards (which already
> match). Honesty contract binding — every card field is real data or it's omitted (never fabricated).

## Canonical cards (ALREADY on the landings, ref-matching — make them universal)
- **Event card = `GemRow`** (`cards.jsx`). Anatomy (ref "Tonight's Best Bets"): left photo (`CardImg`,
  art-floor when no image) + **on-image time badge** bottom-left (events only) + `HeatBadge` when hot →
  **title** → "📍 venue · Today · 5:00 – 9:00 PM" → **category chips** (real category / Free / buzz, ≤3) →
  optional honest **"Why this fits"** (`_why`, real reason only) → outline **heart** → **"Add to plan"** (orange).
- **Spot card = `SpotCard`** (`cards.jsx`). Anatomy (ref "Recommended near you"): left photo + **no time
  badge** → **title** → "📍 location" + "12 min · Free · Park" (**distance as TEXT, only when known** · price ·
  placeType) → **amenity chips** (real, ≤3) → **"★ Best for: …"** (honest) → outline **heart** → **"Open map"**.
  - _⚑ AMENDMENT PENDING JOSH (Cohesion WS4, `c3074cd`): PHOTOLESS spot rows no longer wear the art-floor
    in the photo slot — they lead with a compact 56px placeType **medallion** (the honesty re-derivation:
    an aurora blob at thumbnail density read as a broken photo, not designed art). Photo-row anatomy above
    is unchanged; row height stays the locked 158px. Josh's eyeball ratifies or reverts; this note then resolves._
- **Save control stays the HEART** (FLOWS §1.3 — bookmark deferred; not worth a global churn for MVP).

## RETIRE from result/destination feeds: `CompactRow` (the right-thumb outlier)
- Currently used by `RowFeed` `compact` + the "Everything" feeds + **BubblePage / GuidePage / PlaceBubblePage**
  results. Replace with the canonical card — `GemRow` for events, `SpotCard` for places.
- If `RowFeed`'s non-compact `Row` duplicates `GemRow`, **consolidate `Row` → `GemRow`** (one card, not two).
- Carousel/landing variants in distinct contexts (`TonightCard` image-top, `FeaturedCard` inline-action) keep
  their roles — this lock governs the **vertical result/list card** only.

## Inline filter-chip bar (standardize + add to results)
- **Events:** Tonight · This Weekend · Free · Near Me · Music · Outdoors. **Spots:** Water Views · Easy Walk ·
  Dog Friendly · Open Now · Free. Active chip = `--cta` fill + white text; rest = outline; horizontal scroll.
- Exists on the **landings** — extract a shared component and ALSO render it on the destination/results
  pages (`BubblePage`/`GuidePage`/`PlaceBubblePage`); the ref shows the chip row on every results screen.
- An **"All filters"** entry opens the existing `FiltersSheet`. Chips map to **real bubbles/filters** — no dead chips.

## Build order (GATED — mirrors the Plan P0→P1 pattern that worked)
1. **Phase 0 — consolidation (path-risky).** Make `GemRow`/`SpotCard` universal; retire `CompactRow` from
   result feeds; standardize + place the filter-chip bar on results. **Commit ALONE.** Scout verifies: every
   surface still renders, results now show the canonical card + filter bar, `CompactRow` gone from result feeds,
   no honesty regressions. Gate: lint + build + test. **THEN:**
2. **Phase 1 — Events-full** (`EVENTS_GRIND.md`: +4 sections — Worth-planning-around / Free & Easy / Recurring
   Series / Neighborhood Picks — reorder, "More upcoming around Tampa Bay"). Built on the locked card.
3. **Phase 2 — Spots-full** (`SPOTS_GRIND.md`: verify/lay out the themed sections — Nature & Water / Coffee &
   Hang / Sunset Views / Quiet Corners). Built on the locked card.
4. **Then** the "Tune your taste" Tinder module (`TINDER.md`).

## Self-loop / honesty
Each phase: build → screenshot (anims+grain disabled) or eval → verify vs the ref → iterate ≤6 → gate → commit;
scout backstop-verifies. Real-photo-or-art floor; chips/why/best-for/distance from real fields only or omitted.
