# Spots grind — pixel-match the FULL page to `ref-spots-full-1/2/3.png`

> **Self-loop grind.** Light theme · real tokens · honesty. The audit found the Spots page is **largely
> already built** (all sections implemented), so this is **mostly VERIFY** + the Tinder module + the
> card correction. THE target = `ref-spots-full-1/2/3.png` (+ `tinder.png` for the top module).

## Canonical spot card (CORRECTED — text distance, no on-image badge)
**🔒 LOCKED — see `CARD_LOCK.md`: canonical spot card = `SpotCard` (make universal); retire `CompactRow` from result feeds; filter-chip bar standardized onto results. Phase 0 consolidation runs ONCE for both Events + Spots.**
Left/top image (art-floor fallback if no photo) + placeType overline (orange) → title (2-line) → amenity chips (≤3, icon+label) + **distance as TEXT** ("12 min · Free · Park") → **"★ Best for: …"** → SaveHeart → "Open map" / "Add to day". 💎 badge if hidden gem. **No on-image time/distance badge** (that's events only).

## Full section order (top → bottom)
1. Header — title + location + search [have]
2. **"Tune your taste" module** (Tinder entry — see `TINDER.md`) [NEW]
3. Quick chips (Water views · Easy Walk · Dog Friendly · Open Now · Free) + 8 activity tiles [have]
4. Recommended near you [have]
5. Worth the drive [have]
6. Nature & Water · Coffee & Hang · Sunset Views · Quiet Corners — themed sections [have via per-activity carousels — **verify they match the ref's themed groupings; add/rename if different**]
7. Saved Places [have]
8. Guide Picks (Best Sunsets · Free Outdoor Hangs · Nature Escapes…) [have — verify]
9. Everything list [have]

## Diffs
- **Verify** each section vs `ref-spots-full-1/2/3` and fix drift only. The likely gap: the ref's **themed sections** (Nature & Water, Coffee & Hang, Sunset Views, Quiet Corners) — confirm they render as curated sections matching the ref; the existing per-activity carousels cover most, add/rename to match the ref's groupings + copy.
- **Card:** distance stays **TEXT** (no badge); confirm amenity chips + "★ Best for."
- **Add the "Tune your taste" module** at position 2 (see `TINDER.md`).

## Path-safety / honesty / self-loop
Additive; existing openers unchanged; real-photo-or-art floor (no green-wall); never-hide. Self-loop with the working screenshot trick vs `ref-spots-full-1/2/3.png`.
