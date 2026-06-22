# Spots grind — pixel-match to `ref-spots.png` (landing)

> **Self-loop grind** (build → restore screenshots → self-verify vs `ref-spots.png` → iterate → commit;
> scout backstop-verifies; **no human QA**). Light theme · real tokens · canonical left-image card · honesty.
>
> **Status:** Stage 1 already made the activity tiles **white + cut to 8** and fixed the green featured
> card, so the landing is close. The one real diff (the spec agent over-claimed "match"): `ref-spots.png`
> shows a **"★ Best for: …"** line on the spot cards — currently detail-only. Add it (honest), same as
> Events' "Why this fits."

## Canonical order (`ref-spots.png`)
Header "Spots" + search bar → **8 activity tiles** (white card, colored icon disc) → **"Recommended near you"** (left-image spot cards) → **"Worth the drive"** (left-image spot cards) → *(Everything section below)*.

## Diffs
- **SP-L1 — Add "★ Best for: [reason]" to spot cards.** Derive from amenities / activity match (reuse the detail page's best-for logic). **Honesty-critical:** real reason only, omit if none. `cards.jsx` (SpotCard/FeaturedCard).
- **SP-L2 — Spot card meta** = distance · price · type + amenity chips (≤3) — verify vs the ref; fix drift. `cards.jsx`.
- **SP-L3 — Verify** the 8 activity tiles (white, colored icon discs) + "Recommended near you" + "Worth the drive" sections match the ref's spacing/sizing.

## Path-safety
Tile tap → PlaceBubblePage, card tap → PlaceDetail (VT morph), search → openSearch — all existing seams. Card-layout + best-for line are presentational/derived. No opener-signature changes.

## Honesty
Never-hide; "Best for" real-reason-only; distance/price honest; real-photo-or-text floor (no green-wall).

## Self-loop
Build → restore screenshots → self-verify each item vs `ref-spots.png` → fix → iterate (≤6) → gate → commit + self-verify table. Scout backstop-verifies.
