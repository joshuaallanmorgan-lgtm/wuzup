# Plan grind — "Plan your day" (DayPage), pixel-match to `ref-plan.png`

> **Self-loop grind.** This is the **"Plan your day" DAY screen (DayPage)** — the **Calendar TAB**
> (CalendarView month grid) is SEPARATE and already Stage-1-polished (light header, month dropdown).
> The bottom-nav label is already **"Calendar"** (Stage 1 `50b726e`). Light theme · real tokens · honesty.
>
> ⚠️ **Phase 0 (store migration) is a path-risky prerequisite — do it first, carefully.**

## Phase 0 — Daypart store migration (PATH-SAFE prerequisite)
Convert the day-plan store from **binary `{day, night}` → ternary `{morning, afternoon, night}`**.
Idempotent · forward-only · no data loss. (Josh confirmed: match the 3-daypart reference.)
- `dayplan.js`: `PARTS = ['morning','afternoon','night']`; `emptyDay()` adds `morning:null`; `hasContent()` checks all three slots; **NEW `migrateBinaryToTernary()`** (existing **day→afternoon**, **night→night**) runs once on first `loadDayPlans()`, guarded by a **`day-migrated-v1`** localStorage key.
- `weekend.js` `daypartOf()` thresholds: **05:00–12:59 → morning · 13:00–16:59 → afternoon · 17:00+ & ≤04:59 → night · no clock → 'any'** (shown in all three; defaults to morning).
- `withSlot` / `withClearedSlot` / `withRest` already take `part` as a parameter — **safe, no change**.
- **Path-safety:** audit every slot CONSUMER (DayPage, NextDays, the day-fill deck, CalendarView day-markers) — none may hardcode `'day'`/`'night'`; all read the 3 slots. Migration runs exactly once.

## Phase 1 — DayPage 3-daypart layout (`ref-plan.png`)
Canonical order: **"Plan your day"** title + back → **day-selector** (`[←] prev-day · "{day} · {monthDay}" tappable → calendar picker · [date icon]`) → **expanded weather module** (bigger, more space) → **3 slots: ☀️ Morning · ☀️ Afternoon · 🌙 Night** (each: filled card OR dashed empty "+ Add a … plan") → **"Suggestions for you"** + subline **"Based on weather and your likes"** + a small **`+`** per suggestion row → small folded actions (Add your own · Mark a quiet day) near the top.
- **Diffs:** rework DayPage from binary Day/Night to the **3-slot** layout (consumes Phase 0); make the day-selector label **tappable** → calendar picker (Phase 2); expand the weather module; rename/format the suggestions section + `+` icons. *(Supersedes Stage-1 Batch 5's Day/Night.)* `DayPage.jsx` + `day.css`.

## Path-safety
DayPage uses `openDay(ts)` + the day-plan store (now 3-slot). The tappable day-selector adds an `openCalendarPicker` (Phase 2, additive). No existing opener-signature changes.

## Honesty
Suggestions are real (derived from weather + taste); plan-state honest; real-photo-or-text floor.

## Self-loop
Phase 0 first (verify migration idempotent + all consumers read 3 slots). Then build Phase 1 → self-verify vs `ref-plan.png` → iterate (≤6) → gate → commit + self-verify table. Scout backstop-verifies.
