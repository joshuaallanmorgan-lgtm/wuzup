# V1 Patch List — pre-MVP finish (Josh + Charles review, 2026-06-28)

> **The actionable last patch list before v1.** Grounded against the live code (workflow `wf_0fb9900a-817`) and sequenced by the architect.
> Master plan = [ROADMAP.md](ROADMAP.md) · doc map = [INDEX.md](INDEX.md). Builder executes batches **in order, one commit each**, gated (lint + build + `npm test`), path-safe.
> ⚠️ **Batch 5 changes a binding contract (never-hide)** and is gated on Josh — see [Contract change](#contract-change--never-hide-re-adaptation-batch-5).

## How to read this
- Each **batch = one commit.** Shared tokens first → per-surface → contract change last.
- ✅ confirmed in code · ⚪ **already correct — do NOT touch** · ⚠️ decision needed.
- **Path-safety (all batches except 5):** no nav opener-signature changes; no subpage-union / Escape-ladder / detail-z changes. D.0-R holds (white text on `--cta #bb5719` only; never white on `--accent`).

---

## Decisions needed from Josh + Charles
1. **🚧 Contract blocker (Josh):** the Tinder deck currently **dead-ends** — its "done" screen only offers Close, a deal is 15 events and it excludes the last ~30 rated. If the deck becomes the primary "see all events" door, **the tail of the catalog becomes unreachable = a real never-hide violation.** Fix options: **(a)** add a "Deal again" loop on the done screen, **(b)** add a "See the full list" link from done → scrollable complete feed, **(c)** keep the in-feed "See all N" expand as a permanent secondary fallback. *Architect (and I) recommend **(a) + (c)**.* Batch 5 cannot ship without one of these.
2. **T1 scope (Josh):** remove the in-feed "See all N events" expand **entirely** (deck = sole door, requires rewriting the smoke test in the same commit) **or keep it as a secondary fallback** (safer for accessibility, keeps tests green)? *Recommend keep as fallback.*
3. **Spots too? (Josh):** Spots already renders ~all places inline (no infinite-firehose problem). Does Spots get the same deck relocation, or does its inline "Everything · N" stay? *Recommend Spots stays as-is.*
4. **Tinder copy (Charles):** reframe "Tune your taste" / "Swipe 12 quick picks" from backup → **primary find-AND-tune door**. Confirm a direction (e.g. "Find your night by swiping" + open-ended "Start swiping"). *Note: the "12" is a bug — the deck deals 15.*
5. **Header type-scale (Charles):** confirm **32px / 800 / -0.02em / line-height 1.05** as the one title for all 5 pages. *Visible shift: Calendar 900→800 weight, Profile 26→32px — that's the intended consistency, not a regression.*

---

## ⚠️ Reality-check — where the asks didn't fully match the code
Three of the review notes are **already handled** or **mis-targeted**. Flagging so we don't "fix" working code or chase the wrong thing (eyeball to confirm against your build):
- **"Edit Profile has no margins / buttons full-width"** → the grounding says Edit Profile (`.ep-body`/`.ep-save`) **already honors the gutter.** The *real* margin culprit is **one shared widget, `.intent-grid`** (cards.css:234) — it has no horizontal padding and powers Home **Quick actions**, Spots **By activity**, and Spots **Guides**. Fixing that one rule repairs all three. (If you're still seeing Edit Profile bleed, screenshot it — that'd contradict the code.)
- **"Remove the music/food/drinks/sports chips"** → there's **no literal chip row** on the Taste Profile. The grounding maps this to the **".tp-leans 'Leaning toward'" weight-bar block** (TastePanel.jsx:91-114). Confirm that's what you meant before deletion.
- **"See all just scrolls to the bottom"** → **partly already correct.** Events Tonight/Weekend/Free and the 4 Spot themes **already open dedicated pages.** But some sections (**Recommended near you, Worth the drive, Worth planning around, Recurring, Neighborhood**) are *dynamic top-N with no honest static predicate* — pointing their "See all" at a filter page would show a **different set than the preview** = an honesty violation. Those should keep scroll-to-section (honest) unless we design real predicate-backed sections (out of patch scope).

---

## The batches

### Batch 0 — Confirm-only / guard (no code)
- ⚪ **S3 (events):** Tonight / Weekend / Free "See all" already open BubblePage — leave.
- ⚪ **S3 (spots):** the 4 theme "See all"s already open PlaceBubblePage — leave.
- ⚪ **H2:** Calendar & Profile already render **title-only** — preserve (don't let H1 add subheaders).
- ⚪ **S2 guard:** the user-data carousels (Events shelf/rail/recents, Spots Saved) are **not** preview sections — leave their counts.

### Batch 1 — Shared tokens: one header primitive + one gutter fix *(commit 1)*
- **H1** — reclass all 5 page titles onto the **`.loc-head` / `.loc-head-title` / `.loc-head-sub`** family (the Events/Spots treatment = the "Charles likes" target: 32/800/-0.02em + 14px muted sub). Use **path A (reclass JSX)**, not copy-values-into-4-rules (that reopens the drift bug). Files: HomeView.jsx:68-79, HotView.jsx:242-246, LocationsView.jsx:161-165, CalendarView.jsx:252, ProfileView.jsx:90. Then delete dead size rules: calendar.css:16, profile.css:26, App.css:64-77 (`.home-greet`) + App.css:36-44 (`.home-title` eyebrow).
- **H2** — Calendar + Profile get `.loc-head-title` **only** (no `.loc-head-sub`). Keep `.cal-rhythm` and `.pf-id-card` below the title untouched.
- **H3** — Home: delete the greeting (HomeView.jsx:70) + the now-dead `heroKicker` fn (HomeView.jsx:22-27). **KEEP `nowMs` state/effect (HomeView.jsx:33-45)** — it feeds `tonightModel`. Promote "Home" to `.loc-head-title`; weather/location line stays below (`.home-wx` or reclassed to `.loc-head-sub`). *Note: ref-home.png is now **stale** (still shows "Good morning, Alex") — flag for re-export.*
- **M1** — add `padding: 0 var(--gutter);` to **`.intent-grid`** (cards.css:234). That's the whole margin fix. Do **not** edit `.home-picks` / `.feed--cards` / `.ep-body` / `.lensbar` (already gutter-correct — double-padding). Eyeball the activity grid at 360px (may reflow 3→2 cols; all-visible, acceptable).

### Batch 2 — Premium-button propagation *(commit 2)*
- **B1** — the praised effect is **already a centralized recipe** (App.css:218-241: ambient glow + inset sheen on `.btn-primary`/`.ms-tab-sel`/…). Reuse by **appending class names** to that selector list (use `--accent-rgb` tint to match the `.ms-tab-sel` Josh liked — *not* the deeper `--cta-rgb`). Drop a `<button className="btn-primary">` into the bare empty states: `.pf-empty` "no saves" (MySavesPage.jsx:68-75), plus HotView:479 / BubblePage:172 / ForecastPage:61 / DayPage:558. Add new classes to the `prefers-reduced-motion` block.
- **F1** — Events Filters button: add a `.lens-filter` rule mirroring `.lens-search` (topnav.css after :55) so search+filter are a matched 44px accent-tinted icon pair; swap the multicolor 🎚️ for a **currentColor stroke SVG** (LensNav.jsx:109-113). Preserve onClick/aria-label/title.

### Batch 3 — Taste Profile content sweep *(commit 3, all in TastePanel.jsx)*
- **P1** — delete the `.tp-promise` callout widget (TastePanel.jsx:85-89); re-home the **never-hide line as a second `.tp-trust` subheader** (reuse tastepanel.css:22). Delete dead `.tp-promise` CSS (tastepanel.css:24-36). **The new subheader copy MUST preserve "reorders the order, never hides anything"** — that honesty line currently lives only in the widget being deleted.
- **P2** — delete the `.tp-leans` "Leaning toward" weight-bar block (TastePanel.jsx:91-114) + dead CSS (tastepanel.css:38-63). Keep `sum.leans` in the headline + `k:5` in `tasteSummary`. *(Confirm this is the "music/food/drinks/sports" thing — see reality-check.)*

### Batch 4 — Magazine caps + Hidden-Gems removal + scroll-to-top *(commit 4)*
- **S2 (events)** — cap previews to **3** (HotView.jsx:163/183/196/201/211; neighborhoods break :227). Caps are upper-bounds on **previews only** — do not lower the section gates (≥2 events).
- **S2 (spots)** — cap previews to **3** (LocationsView.jsx:84/90/102 both branches; gate total ≥3 stays).
- **S1 (events)** — delete the Hidden Gems section (HotView.jsx:355-367) + dead `gems` useMemo (85-88) + drop `NON_GEM_RE` from the line-7 import. **Spots:** do **nothing** (no Events-style analogue; do NOT touch the `hidden` PLACE_BUBBLE or quiet-corners — they're never-hide targets). *(Confirm — Q in decisions.)*
- **N1** — in `nav.jsx` `goTo`, reset `child.scrollTop = 0` **and** `child.querySelector('.hot-scroll').scrollTop = 0` (both container shapes; fires on active re-tap). Body-only change, signature unchanged. *Recommend scroll-only — let the Escape ladder own subpage dismissal.*

### Batch 5 — CONTRACT CHANGE: Tinder-as-primary + see-all relocation *(commit 5 — GATED on Josh)*
- **🚧 BLOCKER FIRST** — add a reachable **re-deal loop** (or full-list link) to the deck "done" screen (CalibrationDeck.jsx:312-350 currently dead-ends at Close). Without this, see-all-behind-the-deck **violates never-hide**.
- **T1** — point the Events "See all" (HotView.jsx:459-468) at `openDeck({kind:'events',origin:'events'})`; **keep `feed.full` reachable** as a secondary fallback. (Spots: pending decision #3.)
- **T1 tests** — update smoke.mjs:2489-2498 **in the same commit** to assert the deck is the new never-hide door (keep :2435-2436 `fullEventCount === raw`).
- **T2** — reframe `TasteTuner.jsx:93-97` copy backup→primary; fix the "12"→15/open-ended CTA; update TINDER.md:10-13 in lockstep.
- **ROADMAP §1.1 amendment** + recorded Josh sign-off (done below).

---

## Contract change — never-hide re-adaptation (Batch 5)
**Summary:** the complete event set moves from an in-feed "See all N" scroll to **behind the Tinder swipe** (now the primary find-AND-tune door). Default feed = curated magazine; deck = the door to "everything." **Nothing is deleted or quality-filtered** — the destination moves, the count-preserving engine (`curate.js`) stays.

**Honesty verdict (architect, honest):** on the *filter/delete* axis it's **clean** — `curate.js` removes nothing; the deck draws the full pool minus sponsored (sponsored-exclusion is an honesty feature, not a taste filter). **But "see ALL" only survives if:** (a) the deck has a **reachable, non-dead-ending re-deal loop** (today it dead-ends — the blocker above), (b) a **scroll/button fallback** to the full set exists for reduced-motion users, and (c) `curate.js`'s `full`/`fullEventCount` proof is retained. With (a)+(b)+(c) it honors the spirit; without (a) it does **not**.

The amended §1.1 clause + Josh sign-off is recorded in [ROADMAP.md](ROADMAP.md) §1.

---

## Full open-question list & per-cluster grounding
This doc is the distilled plan. The complete grounded findings (every cluster, every file:line, all 17 open questions) live in the workflow output: `wf_0fb9900a-817` (`tasks/wfd2rpynl.output`).
