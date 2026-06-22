# Spots — Phase 2: flow destinations (all reuse — no net-new screens)

> Runs after the Spots landing (`SPOTS_GRIND.md`). Each a self-loop grind (build → self-verify vs its
> flow panel → iterate → commit; scout backstop-verifies; **no human QA**).
> Refs: `ref-spots-flows-1.png` = Search · Quick reset · Water views · Easy walk;
> `ref-spots-flows-2.png` = Dog-friendly · Recommended near you · Worth the drive · Spot detail.
> Light theme · canonical card · honesty (never-hide).

## Status (everything exists — verify + small diffs)
| Destination | Status | Panel | Mechanism |
|---|---|---|---|
| Activity-tile lists (Quick reset · Water views · Easy walk · Dog-friendly) | ♻️ reuse | flows-1 p2-4 · flows-2 p1 | PlaceBubblePage (filtered spot list) |
| Recommended near you · Worth the drive | ♻️ reuse | flows-2 p2-3 | landing sections |
| Search | ✅ verify | flows-1 p1 | SearchPage |
| Spot detail | ✅ verify | flows-2 p4 | PlaceDetail |

## Per-destination
- **Activity-tile lists** → **PlaceBubblePage**: hue-band header + tagline + left-image spot rows (distance · type · amenity chips · "★ Best for" · heart). Wire each tile to its bubble; match the panels. Never-hide.
- **Spot detail** (flows-2 p4) → **PlaceDetail**: image · distance/price/type · amenity chips · **"★ Best for"** · **"⚠ Watch out"** · **"View map & directions"** · **Save + Add to day**. Verify vs the panel; fix drift.
- **Search** → SearchPage (verify; cross-layer events + places).

## Path-safety
All existing seams (PlaceBubblePage / PlaceDetail / SearchPage / SaveHeart / make-this-my-plan modal). No new components or openers. Mini-map stays lazy.

## Honesty
Never-hide (filtered = narrowed, full set reachable). "Best for" / "Watch out" real-only. Real-photo-or-text floor.

## Self-loop (each)
Build → restore screenshots → self-verify vs the flow panel → fix → iterate (≤6) → gate → commit. Scout backstop-verifies.
