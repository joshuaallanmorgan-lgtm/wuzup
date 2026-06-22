# Home grind — pixel-match to `ref-home.png` (landing)

> **Self-loop grind** (build → restore screenshots [disable anims+grain] → self-verify every item vs
> `ref-home.png` → fix → iterate to ~95% [≤6 rounds] → gate → commit + self-verify table; scout
> backstop-verifies live computed values; **no human QA**). Runs when we reach Home (after Profile).
> Light theme · real tokens (`--bg #fcfbf9`, `--card #fefdfb`, `--ink #1a1410`, `--cta #bb5719`+white) ·
> canonical left-image row card · honesty (all real data). Most of the landing EXISTS — these are the deltas.

## Canonical order (`ref-home.png`)
"Home" title → greeting + real weather + **bell** (top-right) → **"Your next days"** (3 day-cards: Today **filled** / Fri-Sat **outline** + **"View full forecast →"**) → **"Tonight's top picks"** + "See all" (left-image cards) → **"Quick actions"** grid (Free tonight · Nature · Markets · Sports bars) → nav.

## Diffs
- **H-L1 — Bell, not search, top-right.** Current `.home-search` button → `openSearch` (a search disc). Change it to a **bell icon → `openNotifications`** (per `ref-home.png`; this reverses R-HD1). Search stays on Events/Spots where the refs show it. `HomeView.jsx` + `App.css` `.home-search`/bell.
- **H-L2 — "View full forecast →" link** under the NextDays stack → `openForecast`. `NextDays.jsx` + `nextdays.css`.
- **H-L3 — Day buttons:** **Today = filled** (`--cta` + white), **Friday & Saturday = outline** (per ref; currently likely all filled). Add an outline `.nd-cta` variant. `nextdays.css`.
- **H-L4 — "Tonight's top picks" → left-image cards.** Match the canonical card (image left · time badge · title · venue · category chips · heart) + "See all" → Events (tonight). `cards.jsx` (FeaturedCard/top-picks render).
- **H-L5 — "Quick actions" tile grid (NEW section):** 4 tiles — Free tonight · Nature · Markets · Sports bars — reuse the existing `.intent-grid`/`.intent-tile` CSS; each opens its destination (see `HOME_PHASE2.md`). `HomeView.jsx`.
- *(Title "Home" + greeting below already shipped in S1-H1.)*

## Path-safety
Additive + surgical. The bell rewires the top-right from `openSearch` → `openNotifications` (search remains on Events/Spots). Quick-action tiles wire via the existing `openBubble`/`openPlaceBubble`/`openGuide`. No opener-signature changes.

## Honesty
Weather, plan-state, and the featured pick are all real (no fabrication). Quick-actions are real category/bubble filters.

## Self-loop
Build → restore screenshots (disable anims+grain) → self-verify each item vs `ref-home.png` → fix → iterate (≤6 rounds) → gate (lint+build+`npm test`) → commit + self-verify table. Scout backstop-verifies. No human QA.
