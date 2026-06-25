# Events grind — pixel-match the FULL page to `ref-events-full-1/2/3.png`

> **Self-loop grind** (build → screenshot WITH anims+grain disabled → self-verify vs the ref → iterate
> → commit; scout backstop-verifies; no human QA). Light theme · real tokens · honesty (never-hide).
> The landing basics (vertical cards, "Why this fits", filter chips) already landed overnight — **this
> adds the full top-to-bottom section set + the Tinder module.** THE target = `ref-events-full-1/2/3.png`
> (+ `tinder.png` for the top module).

## Canonical event card
**🔒 LOCKED — see `CARD_LOCK.md`: canonical event card = `GemRow` (make universal); retire `CompactRow` from result feeds; filter-chip bar standardized onto results. Do the Phase 0 consolidation FIRST, then this full-page work.**
Left image with an **on-image time badge** (bottom-left, e.g. "5:00 PM") + HeatBadge (top-right, when hot) → title (bold) → meta (📍 venue · date · time) → **category chips** → optional honest **"Why this fits"** → SaveHeart (right) → **"Add to plan"** link.

## Full section order (top → bottom)
1. Header — title + location + search [have]
2. **"Tune your taste" module** (Tinder entry — see `TINDER.md`) [NEW — ships in its OWN sprint (TINDER.md), NOT in EVENTS P1; Events P1 = the section set below]
3. Filter chips (Tonight · This Weekend · Free · Near Me · Music · Outdoors) [have]
4. Tonight's Best Bets [have]
5. **Worth planning around** [NEW — carousel of worth/buzz events]
6. This Weekend (day-grouped) [have]
7. Hidden Gems [have]
8. **Free & Easy** [NEW — free events carousel]
9. **Recurring Series** [NEW — `_series`/recurring events]
10. **Neighborhood Picks** [NEW — 2-column, neighborhood/tag-based]
11. Your kind of night (taste rail) [have — **move to here**]
12. Recently viewed [have]
13. **"More upcoming around Tampa Bay"** — the Everything feed [have — rename heading]
*(Guides + Your Saves shelf: keep where they fit per the ref.)*

## Diffs
- **Add the 4 NEW sections** (Worth planning around · Free & Easy · Recurring Series · Neighborhood Picks) — `HotView.jsx` + section logic + `cards.css`. Real data + honest gating (e.g. Free & Easy only if free events exist).
- **Reorder:** taste rail → after Neighborhood Picks; Everything → after Recently viewed; heading → "More upcoming around Tampa Bay."
- **Card:** confirm the **on-image time badge + category chips** (this is the touch-up item; the full refs confirm it).
- **Add the "Tune your taste" module** at position 2 (see `TINDER.md`).

## Path-safety / honesty / self-loop
Additive sections; existing openers unchanged; never-hide ("See all {N}"); "Why this fits" real-reason-only. Self-loop with the working screenshot trick vs `ref-events-full-1/2/3.png`.
