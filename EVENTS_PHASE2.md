# Events — Phase 2: flow destinations

> Runs after the Events landing (`EVENTS_GRIND.md`) locks. Each a **self-loop grind** (build → self-verify
> vs its flow panel → iterate → commit → scout backstop-verifies; **no human QA**).
> Refs: `ref-events-flows-1.png` = Search · Filters · Tonight's top picks · Tomorrow · Weekend;
> `ref-events-flows-2.png` = Free · Near me · This weekend · Event detail · Saved state.
> Light theme · `--cta`+white · canonical left-image card · honesty (never-hide).

## Status + build order
| Destination | Status | Panel | Mechanism |
|---|---|---|---|
| Filter results (Tonight · Tomorrow · Weekend · Free · Near me · Saved) | ♻️ reuse | flows-1 p3-5 · flows-2 p1-3,5 | existing list + chip filtering, matched result headers |
| Search | ✅ verify | flows-1 p1 | SearchPage |
| Event detail | ✅ verify | flows-2 p4 | DetailPage |
| **Filters panel** | 🔨 net-new | flows-1 p2 | `FiltersSheet.jsx` + opener |

## Per-destination

### Filter results — ♻️ reuse — flows-1 p3-5 + flows-2 p1-3,5
The chips already filter the Events list. Each filtered state just needs to match the ref's **header label + day-grouping + the vertical card format** (from `EVENTS_GRIND` E-L1):
- "Tonight's top picks" · "Tomorrow's events" · "The weekend" (Friday/Saturday/Sunday grouped) · "Free events" · "Near you" · "Saved events".
Diffs: match each result-state header + grouping; reuse the list. **Never-hide** (filtered = narrowed, full set reachable). No new screens — these are states of the existing list/bubble.

### Search — ✅ verify — flows-1 p1 · `SearchPage.jsx`
Already built. Self-loop = verify vs the panel; fix drift only. (Search zero-state refresh already queued in STAGE1 batch 8.)

### Event detail — ✅ verify — flows-2 p4 · `DetailPage.jsx`
Already built (incl. the "Why this fits" line + add-to-day CTA). Self-loop = verify vs the panel (big image, title, why-this-fits, official page, "Add to [day]" CTA, "Recommended for you"); fix drift only.

### Filters panel — 🔨 NET-NEW — flows-1 p2
A bottom-up **Filters sheet** (When · Price · Category + Reset + "Show results"), reusing the **Map filter-sheet pattern**. Opened from a filter button on the Events header/chip row.
Build: additive `FiltersSheet.jsx` + `filters.css` + an opener in `nav.jsx`; reuse the existing category/lens filtering + the chip logic. Match `flows-1` panel 2 exactly.

## Path-safety (all additive)
- `nav.jsx` gains the Filters opener (+ a `{type:'filters'}` or a local sheet like Map's) — no existing opener-signature changes.
- `FiltersSheet.jsx` + `filters.css` new (append-only); reuse `TonightCard`/`CompactRow`/`Row`/`RowFeed`/`GemRow`/`SaveHeart`/`HeatBadge`, the SavesStore/RecentsStore, and the subpage z-layer + Escape ladder.
- Filter results reuse the existing list — no new state machinery.

## Honesty
Filtered states never-hide (narrow, full set reachable). "Why this fits" real-reason-only. Free/price honest. Sponsored disclosed.

## Self-loop (each)
Build → restore screenshots → self-verify vs the flow panel → fix → iterate (≤6) → gate → commit + self-verify table. Scout backstop-verifies. No human QA.
