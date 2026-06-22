# Plan — Phase 2: flow destinations

> Runs after the DayPage landing + Phase 0 store migration (`PLAN_GRIND.md`). Each a self-loop grind
> (build → self-verify vs its flow panel → iterate → commit; scout backstop-verifies; **no human QA**).
> Refs: `ref-plan-flows-1.png` = Date picker · Calendar · Add-a-plan suggestions · Item actions;
> `ref-plan-flows-2.png` = Suggestion detail · Add-to-day sheet · Saved picks · Planned-day.
> Light theme · canonical card · honesty (real suggestions only). **All dayparts = Morning/Afternoon/Night** (Phase 0).

## Status + build order
| Destination | Status | Panel | Mechanism |
|---|---|---|---|
| Calendar / date picker | 🔨 net-new | flows-1 p1-2 | `CalendarPickerPage.jsx` + opener |
| Add-to-slot suggestions | ♻️ enhance | flows-1 p3 | tap a slot → suggestions list |
| Plan-item actions (move / remove) | ✏️ small new | flows-1 p4 | "…" menu on a planned item |
| Suggestion detail | ✅ verify | flows-2 p1 | DetailPage |
| Add-to-day sheet (daypart choice) | ♻️ enhance | flows-2 p2 | PickerSheet + Morning/Afternoon/Night |
| Saved picks (events / spots tabs) | ♻️ reuse | flows-2 p3 | saved store |
| Planned-day state | ✅ verify | flows-2 p4 | DayPage filled slots |

## Per-destination
- **Calendar / date picker (NET-NEW)** — from the DayPage day-selector. A "Pick a date" list (Today/Fri/Sat/… + "Full calendar") + a month-grid picker. Build: additive `CalendarPickerPage.jsx` + `openCalendarPicker` in `nav.jsx` + an `App.jsx` block; selecting a date → `openDay(ts)`. (Can reuse CalendarView's grid logic.)
- **Add-to-slot suggestions** — tap an empty slot → "Add a {daypart} plan" with a suggestions list (Suggested for the {daypart}), each with a `+`. Reuse the existing suggestion/picker logic; daypart-aware (Phase 0 slots).
- **Add-to-day sheet** — "Add to your day": **Choose a time (Morning / Afternoon / Night)** + "Add to {date}" + Add button. Enhance the existing PickerSheet to offer the 3 dayparts. Used from a suggestion/detail's "Add to day."
- **Plan-item actions** — "…" menu on a planned item: Move to another time (daypart) · Remove from plan. Small new menu; uses `withSlot`/`withClearedSlot`.
- **Saved picks** — Saved events / Saved spots tabs to pull into the day. Reuse the saves store + card.
- **Suggestion detail / Planned-day** — verify vs panels (DetailPage; DayPage with filled slots).

## Path-safety (additive)
`CalendarPickerPage` + `openCalendarPicker` new (additive, subpage pattern). The add-to-day daypart choice + item-move use the **Phase-0 3-slot** model (`withSlot(part)` — param-based, safe). No existing opener-signature changes. Saved picks reuse the saves store.

## Honesty
Suggestions derive from real weather + taste (never fabricated). Saved picks = real saves. Planned-day reflects real slots.

## Self-loop (each)
Build → restore screenshots → self-verify vs the flow panel → fix → iterate (≤6) → gate → commit. Scout backstop-verifies.
