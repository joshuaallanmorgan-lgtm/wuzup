# Stage 1 — Finish punch list (render-vs-reference)

> Generated 2026-06-17 from Josh's screen-by-screen feedback. Send to the builder **one batch at a
> time** (or point it at this file: "execute Batch N from STAGE1_PUNCHLIST.md"). Scope = **pixel-finish
> existing surfaces only**; Stage 1.5 (new vision: lower homepage, map-from-home, guides content,
> per-location images) is OUT of scope here — see `ROADMAP.md` §2A + Stage 1.5.
>
> **Global rules:** onboarding + the 3 decks stay DARK. Primary buttons = `--cta #bb5719` + white.
> Never touch nav opener signatures / from-origin guards, the detail/VT seams, `focusMap`/`{type:'map'}`,
> the Escape ladder, day-plan keys, or the single-slot subpage union. Gate each batch (lint + build +
> `npm test`), live-verify, one commit per batch, push.

## Resolved decisions (don't re-ask)
- **Profile stats trio** — YES, re-add (it was stripped in Stage R; Josh wants it back).
- **DayPage day-selector** — a **tappable** date control that changes the day via `openDay(ts)` (not a static label).
- **Search zero-state** — **Option 2**: a muted/disabled `.srch-tabs` preview (All · Events · Spots · Guides) above the suggestion chips, to foreshadow the results UI.

---

## Batch 1 — Home
- **S1-H1** · `HomeView.jsx:104-110` + `App.css` — add a page title `<h2 class="home-title">Home</h2>` ABOVE the greeting `<h1 class="home-greet">`; style `home-title` as a small muted overline (like `pg-head-title`), greeting becomes the subtitle below it. *(greeting/weather logic unchanged)*
- **S1-H2** · `nextdays.css:54-64` `.nd-cta` — reformat (chunky → refined): font-size 12.5→**11.5px**, weight 700→**650**, padding 7px 13px→**6px 12px**, radius 9→**8px**, letter-spacing→**0**.

## Batch 2 — Spots
- **S1-SP1** · `places.js:93-94` — delete the `act-parks` activity entry (**9 → 8 tiles**).
- **S1-SP2** · `cards.css:221` `.intent-tile` — background pastel gradient → **`var(--card)`/white**.
- **S1-SP3** · `cards.css:222` `.intent-tile` — border hue-tint → **`var(--line)`** (keeps contrast on white).
- **S1-SP4 (fix 1-B)** · `LocationsView.jsx:155-160` — the "Recommended" `FeaturedCard` shows a flat **green** block when `topSpot` has no photo. Prefer a `topSpot` that HAS a real photo; else render the **text-rich / no-photo** treatment (name + amenity chips). Never a flat color hero. *(honesty: real photo or text floor)*

## Batch 3 — Calendar + nav rename
- **S1-C1** · `nav.jsx:63` — VIEWS label `'Plan'` → **`'Calendar'`** (keep `id:'calendar'` so `viewIndex()` is intact).
- **S1-C7 (fix 1-A)** · `calendar.css:9` `.cal-top` — orange gradient (`linear-gradient(135deg,var(--accent),var(--accent-2))`) → **clean light header** (`var(--bg)`/transparent, bold-ink title, no band) to match the other tabs + reference.
- **S1-C2** · `CalendarView.jsx:385-408` — remove the "did you make it to ___?" prompt card (keep `litCard`, 370-384).
- **S1-C3** · `CalendarView.jsx:142` — remove the "N out in {month}" days-out stat push (keep the `daysOut` var).
- **S1-C4** · `CalendarView.jsx:453-485` + `calendar.css:107-122` — delete the prev/next ‹ › buttons; move **Today** to the far right (`margin-left:auto`).
- **S1-C5** · `calendar.css:73-74` `.mon-caret` — color → **`var(--cta)`** (orange); ~10-11px.
- **S1-C6** · `calendar.css:57` `.mon-title` — font-weight 800 → **600/700** (less bold).

## Batch 4 — Profile header block + stats trio
- **S1-P1** · `ProfileView.jsx:59-100` — add a `.pf-name-block` **colored card** (name + city, white text on `--cta`) above the menu; gear stays top-right.
- **S1-P2** · `ProfileView.jsx:13-16` — import `loadDayPlans, loadDayHistory, didDays` (dayplan.js) + `useBeenThere` (saves.js, already).
- **S1-P3** · `ProfileView.jsx:38-100` — `useEffect` computing **honest lifetime stats**: plans = distinct filled days (loadDayPlans + loadDayHistory) · saves = `useSaves().list.length` · days-out = `didDays(useBeenThere()).size`. Render `.pf-stats` trio (Plans · Saves · Days out), pluralized. *(CSS already at profile.css:463-478)*
- **S1-P4** · order = colored name block → stats trio → hairline → the existing 5 rows (unchanged).

## Batch 5 — DayPage rework (match ui-benchmark "Plan your day")
- **S1-D1** · `DayPage.jsx:86-89` — add a **tappable day-selector** showing the date ("Friday, Jun 20") that changes the day via `openDay(ts)`. *(don't break day-plan keys)*
- **S1-D2** · `DayPage.jsx:336-339` — header title = constant **"Plan your day"**; date moves into the S1-D1 selector.
- **S1-D3** · `day.css:12-20` `.dpg-wx` — expand the weather module (padding 4px20px0→**12px 20px 8px**, font 13→**15px**, **min-height:60px**).
- **S1-D4** · `DayPage.jsx:369-380` — **remove the FillDay swipe deck** (both buttons); keep "Add your own" + "Share this day". *(delete render only; FillDay logic stays for reuse later)*
- **S1-D5** · `DayPage.jsx:374-399` + `day.css:127-169` — fold "Add your own" + "Mark a quiet day" into a small compact row near the **top** (by the date selector), out of the main area.
- **S1-D6** · `DayPage.jsx:405-407` — rename "Happening this day (N)" → **"Suggestions for you"** + subline **"Based on weather + your likes"**; drop the count.
- **S1-D7** · `DayPage.jsx:409-415` — add a small **+** icon on each event row (opens the picker to add it to the day).

## Batch 6 — Map top-bar + decision deck
- **S1-M1** · `map.css:61-85` `.map-tools` — grid: row 1 = full-width search; row 2 = layer toggle **left** + actions **right**; 8px gutter, center-aligned.
- **S1-M2** · `MapView.jsx:532-548` + `map.css:108-133` — layer toggle to row-2 start; `.map-seg-btn.on` → **orange** (`var(--accent)`) bg + ink text; inactive = light-on-dark.
- **S1-M3** · `MapView.jsx:552-564` + `map.css:244-269` — Filters button **icon-only** (drop label, keep aria-label), ~40px; keep the activeFilterCount badge.
- **S1-M4** · `MapView.jsx:565-571` + `map.css:143-163` — **Near Me** on the right; active = orange (`var(--cta)`) + white.
- **S1-M5** · `map.css:548-559` `.map-deck` — dark glass → **white** (`var(--card)`); update border/shadow/text for light; title dark ink, accent gold.
- **S1-M6 (PRESERVE)** · `MapView.jsx:166-177, 413-423, 514-516` — Escape ladder, `focusTarget.kind==='place'` guard, back nav — **do NOT touch**.
- **S1-M7 (VERIFY)** · `.map-filter-done`, `.msheet-cta` already `--cta`+white — confirm only.
- Keep the search bar on top (Josh likes it).

## Batch 7 — Settings / Taste / Interests (match sheet-b; verify-first)
- **S1-ST1** · `SettingsPage.jsx:94-115` + `settings.css` — reformat to sheet-b #4: group the preference controls under a **"Customize interests"** grouping; nest "Retake primer". *(live-verify before structural change; do NOT touch nav opener signatures)*
- **S1-ST2** · `TastePanel.jsx` — pixel-match vs sheet-b's "Taste profile" (live device check; likely minor).
- **S1-ST3** · `InterestEditor.jsx` — pixel-match vs sheet-b's "Customize interests" (live device check; likely minor).

## Batch 8 — My Plans / Saves / Search zero-state (verify + 1 build)
- **S1-PS1 (VERIFY)** · `MyPlansPage.jsx:144` + `profile.css:61` — check the shelf-count badge alignment vs sheet-a.
- **S1-PS2 (DONE)** · My Saves — already pixel-matches sheet-b; no change.
- **S1-PS3 (BUILD)** · `SearchPage.jsx:285-336` — refresh the zero-state: render a **muted/disabled `.srch-tabs` preview** (All · Events · Spots · Guides) above the suggestion chips to foreshadow the results UI; keep `.srch-sug-btn` chips intact.

---

## Send order
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Batches **7 & 8 are mostly verify** (the builder render-checks vs the
sheets and changes only what differs). After all 8 land + Josh signs off screen-by-screen, **Stage 1
closes** and we move to Stage 1.5 (build-up) / Stage 2 (Deep Sweep) per `ROADMAP.md`.
