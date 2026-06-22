# Home — Phase 2: button destinations (the 7 screens behind Home's buttons)

> Runs after the Home landing (`HOME_GRIND.md`) locks. Each is its own **self-loop grind**
> (build → self-verify vs its flow panel → iterate to ~95% → commit → scout backstop-verifies; **no human QA**).
> Refs: `ref-home-flows-1.png` = Full Forecast · Notifications · Tonight's Top Picks · Free things tonight;
> `ref-home-flows-2.png` = Nature · Markets · Sports bars.
> Light theme · `--cta #bb5719`+white · canonical left-image row card · honesty (real/derived data, never fabricated).

## Status + build order (reuse first, net-new last)
| Destination | Status | Panel | Mechanism |
|---|---|---|---|
| Tonight's Top Picks | ♻️ reuse | flows-1 p3 | BubblePage — a "tonight" events bubble |
| Free tonight | ♻️ reuse | flows-1 p4 | BubblePage — free-events bubble |
| Nature | ♻️ reuse | flows-2 | PlaceBubblePage — outdoors/nature spots |
| Sports bars | 🔨 new bubble | flows-2 | PlaceBubblePage — new venue bubble def |
| Markets | 🔨 new guide | flows-2 | GuidePage — new mixed (events + places) guide |
| Full Forecast | 🔨 new screen | flows-1 p1 | ForecastPage + `openForecast` |
| Notifications | 🔨 new screen | flows-1 p2 | NotificationsPage + `openNotifications` |

## Per-destination

### 1. Tonight's Top Picks (reuse) — flows-1 p3
The Home "See all" → a full list of tonight's picks. Reuse **BubblePage** with a "tonight" events bubble (left-image rows). Verify the bubble page matches the panel; wire the See-all → this bubble (or the Events tonight bubble). Diffs: mostly the card format + header.

### 2. Free tonight (reuse) — flows-1 p4
Quick-action tile → **BubblePage**, free-events filter (`_free`/tonight). Header "Free things tonight" + tagline + left-image rows. Wire the Home tile → this bubble.

### 3. Nature (reuse) — flows-2
Quick-action tile → **PlaceBubblePage**, outdoors/nature spots. Header "Nature" + "Outdoor escapes, easy trails, and scenic green spaces" + left-image spot rows (Cockroach Bay, Lettuce Lake, Riverwalk, Fort De Soto…). Wire the tile.

### 4. Sports bars (new bubble) — flows-2
Quick-action tile → **PlaceBubblePage** with a **new "sports bars" venue bubble definition** (append to `places.js`/the bubble registry). Header "Sports bars" + "Catch the game, big screens, cold beers" + venue rows. Honest: real venues tagged/matched as sports bars.

### 5. Markets (new guide) — flows-2
Quick-action tile → **GuidePage**, a **new mixed guide** (events + places, append to `guides.js`). Header "Markets" + "Fresh finds, local makers, and weekend favorites" + rows (Tampa Bay Market, Hyde Park Fresh Market, India Flea, Night Market at Sparkman Wharf). Reuse the GuidePage mixed-domain rendering.

### 6. Full Forecast (NET-NEW screen) — flows-1 p1
From the landing's "View full forecast" link. **ForecastPage** subpage using the **real `weather.js` 16-day data**: header "Forecast" + location + current temp/condition, an **hourly** row, a **7-day** (or full) list, a "best day for outdoors" line. Build: additive `{type:'forecast'}` in `App.jsx` + `openForecast` in `nav.jsx`. All real data; no fabrication.

### 7. Notifications (NET-NEW screen) — flows-1 p2
From the **bell**. **NotificationsPage** subpage, a **time-grouped** list. Build: additive `{type:'notifications'}` + `openNotifications`. **HONESTY-CRITICAL:** items derive ONLY from real on-device signals — upcoming **saved-event reminders**, **weather-forecast alerts** (e.g. "Rain likely tomorrow afternoon"), **new-events-this-weekend** from the data. **No fabricated notifications.** The deeper push/unread system is stubbed (build later). If there are no real signals, honest empty state.

## Path-safety (all additive)
- `nav.jsx` gains `openForecast` + `openNotifications` (+ the bell rewire from H-L1) — no existing opener-signature changes.
- `App.jsx` adds 2 render blocks (`{type:'forecast'|'notifications'}`) after an existing subpage pattern.
- `guides.js` / `places.js` **append** new bubble/guide entries (Sports bars bubble, Markets guide) — never mutate existing.
- New CSS append-only (`forecast.css`, `notifications.css`); reuse `.intent-grid`/`.intent-tile`, BubblePage/PlaceBubblePage/GuidePage, RowFeed. All net-new close via `closePage()`.

## Honesty
Forecast = real `weather.js` data. Notifications = derived real signals only. Bubbles/guides = real events/places, never-hide. No fake names/data anywhere.

## Self-loop (each)
Build → restore screenshots (disable anims+grain) → self-verify vs the flow panel → fix → iterate (≤6 rounds) → gate → commit + self-verify table. Scout backstop-verifies. No human QA.
