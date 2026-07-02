# Touch-up punch list — overnight-grind fidelity pass

> The overnight run (branch `ui-overnight-grind`) did MORE than it felt like: **Profile landed fully;
> Home / Events / Spots landings are close; the net-new screens are all built + wired.** It built
> everything **blind** (screenshots were wedged all night), so the gaps are **fidelity** + a couple of
> wiring/completeness items — **not missing screens.** Build on the commits — **no uncommit.**
>
> **The enabler:** the screenshot trick now works — before any capture, inject
> `*{animation:none!important;transition:none!important}` and hide `.grain`. So **every item below =
> re-run the self-loop WITH working screenshots vs the ref panel** (the eyes the overnight lacked).
> Light theme · `--cta #bb5719` + white · honesty · path-safety.

## P1 — functional / wiring
- **HOME · sports-bars tile wired wrong.** It opens a **Guide** (`openGuide`, `guides.js`); per spec it should be a **PlaceBubble Activity**. Add a `sports-bars` ACTIVITY to `places.js` (with match logic), import it in `HomeView.jsx`, open via `openPlaceBubble`; remove the sports-bars guide entry. → `places.js` · `HomeView.jsx` · `guides.js`.

## P2 — fidelity (the visible "didn't do great")
- **EVENTS · event browse cards (GemRow)** — add the **on-image time badge** (overlay, lower-left) + a **category chip** below the title (tinted, like FeaturedCard). Currently image + title + venue + "Why this fits." → `cards.jsx` (GemRow) · `cards.css`. Verify vs `ref-events.png` / `ref-events-flows-1` p1-2.
- **SPOTS · spot cards (SpotCard)** — ~~move distance to an on-image badge~~ **CORRECTED:** the newer full-page refs (`ref-spots-full-1/2/3.png`) show distance as **TEXT meta** ("12 min · Free · Park"), **not** an on-image badge. So: **leave distance as text**; just verify the card = image + title + venue + meta(distance · price · type) + amenity chips + "★ Best for" + heart, matching the full-page refs. **No on-image badge on spot cards** (only *event* cards get the on-image time badge).
- **EVENTS · filter-result headers** — FiltersSheet opens + filters, but the results page lacks the dynamic header ("Tonight's top picks" / "Tomorrow's events" / "The weekend" + day-grouping). → `BubblePage.jsx` · `nav.jsx`. Verify vs `ref-events-flows-1` p3-5.
- **NET-NEW destinations — visual fidelity pass (built blind; present but pixel-match unverified).** For EACH, re-run the self-loop with screenshots vs its ref panel and fix layout/sizing/copy:
  - Edit Profile → `ref-profile-flows-1` p4
  - Help & Feedback → `ref-profile-flows-2` p4
  - Full Forecast → `ref-home-flows-1` p1
  - Notifications → `ref-home-flows-1` p2 *(confirm items are HONEST/derived — saved-event reminders, weather alerts, new-weekend-events — never fabricated)*
  - Events Filters sheet → `ref-events-flows-1` p2

## P3 — verify (likely fine; confirm visually, fix only drift)
- **SPOTS Phase 2** (the run stopped before it): activity-tile lists (PlaceBubblePage) + spot detail (PlaceDetail) — reuse existing; verify vs `ref-spots-flows-1/2`.
- **PROFILE sub-screens** (My Plans · My Saves · Taste profile · Customize interests · Settings) — verify vs `ref-profile-flows-1/2`.
- **HOME quick-action bubbles** (Free tonight · Nature · Markets) — verify vs `ref-home-flows-1/2`.

## Method (every item)
Fix → screenshot **with anims + grain disabled** → diff vs the ref panel → iterate (≤6) → gate (lint + build + `npm test`) → **commit per item**. Scout backstop-verifies. No human QA.

## Path-safety / honesty
Additive only; don't change existing opener signatures; real/derived data (Notifications especially); never-hide; keep onboarding/decks dark.

## Not in scope here
- **Plan** (DayPage 3-daypart + the store migration) — still held for an awake session (path-risky).
- Font — keeping **Inter everywhere** (settled).
