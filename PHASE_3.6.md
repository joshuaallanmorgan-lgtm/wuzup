# PHASE 3.6 — The big premium pass (app-wide)
_2026-06-15 · Josh ratified the W5/W8 proposal + raised the bar: 3.6 is its own large phase — a top-to-bottom premium pass on the WHOLE app, including a rethink of the top navigation. Branch: master-plan-2. Same contract: each workstream → build → adversarial review → hand-verify → npm test → live-verify → push. No fake data; never-hide holds._

Supersedes the W5/W8 scope in [W5_W8_PROPOSAL.md](W5_W8_PROPOSAL.md) — that proposal is ratified and folds in here, expanded.

## RATIFIED (Josh, 2026-06-15)
1. **Premium copy voice — APPROVED.** The calm, emoji-as-icon-only (never inside a sentence), no-winking direction. Charles passes the actual copy over the 43 DRAFT strings + the before/after table in the proposal.
2. **Settings redesign — APPROVED.** The 5 intent-groups (Your taste profile · Tune your feed · Reset · Data & privacy · About) + the ⚑W5 Profile-canonical dedup.
3. **Type/spacing/motion — APPROVED.** Body 13.5→15 + line-height 1.6, a real spacing scale, the motion additions.
4. **Onboarding (W8) — APPROVED + refined:**
   - **Teach the 5-tab IA on first open — YES**, but it MUST be skippable (one-tap skip always visible — never a trap).
   - **Add the Profile + Calendar pull cards** for 2nd/Nth-open re-entry (pull-based, ban-list-clean).
   - **The deck integrates more prominently into the Calendar / Finch day-building flow** — not a buried onboarding bonus; it becomes a real, surfaced part of building your days. (Reconcile the calibration deck + the day-fill deck as the day-building swipe surface.)
5. **THE BIG ONE — rethink the top navigation (the "buttons"):** Josh hates the top bubble strip.
   - **It's partially broken**: the 4th bubble clips off the side (the W1 fade mitigated but didn't fix the feel).
   - **It needs to be more premium + QUIETER** — still fully informative, still "I can click into absolutely everything," just calmer. Likely a **dropdown / menu** pattern instead of a loud scroll of buttons.
   - This is the centerpiece of 3.6 and the one OPEN design decision (options below — Josh picks).
6. **Scope:** app-wide premium pass — Josh: "a very big phase." Not just copy + Settings; rethink how ALL information is displayed and clicked-through, everywhere.

## THE TOP-NAV RETHINK — options for Josh to pick
Today: HotView + LocationsView open with a horizontal-scroll strip of ~16 emoji "bubbles" (Tonight · This Weekend · Free · Near Me + 12 categories + Add). Loud, clips on the right, button-heavy. Each bubble → a BubblePage destination. Must stay never-hide ("click into absolutely everything").

- **Option A — Quiet lens row + categories menu (recommended).** A calm row of just the high-value CONTEXT lenses as text pills (Tonight · This weekend · Free · Near me) + a trailing **"All categories ▾"** that opens a clean sheet/menu holding all 12 (Events) / 8 (Spots) categories. Keeps the most-used lenses one tap away, tucks the long tail into a quiet menu (the dropdown Josh hinted at), nothing clips. Magazine sections below still surface categories inline.
- **Option B — Search-forward, sections-as-nav.** Remove the strip; the search bar becomes the prominent "find anything" entry (lens/category chips live in its zero-state), and the editorial section headers (Tonight, Free, Music, Outdoors…) ARE the navigation — each taps to its page. Quietest/most editorial; the content is the nav.
- **Option C — Hybrid: a single "Browse" entry next to search.** Hero shows just masthead + search + one quiet "Browse" affordance that opens the full category/lens grid as a sheet. Cleanest hero; everything one tap into the sheet.

Recommendation: **A** — it matches Josh's "dropdown/menu, quieter, still click into everything" most directly while keeping the time lenses immediate. (Visual mockups shared in chat for the pick.)

## WORKSTREAMS (3.6) — sequence TBD after the nav pick
- **N1 — Top-nav rethink** (the picked option) on HotView + LocationsView (+ the bubble-page destinations stay). The structural keystone; do FIRST since the premium pass sits on it.
- **N2 — App-wide premium visual pass**: type/spacing/motion tokens, card/section/detail polish, "quieter but informative" everywhere, every surface clickable + calm.
- **N3 — Copy voice pass** (Charles): the 43 DRAFT strings + empty/error states + onboarding copy, premium voice.
- **N4 — Settings redesign** (the 5 intent-groups + dedup).
- **N5 — Onboarding (W8)**: first-open 5-tab IA tour (skippable) + taste-snapshot finish + the deck reframed; Profile + Calendar pull cards; deck integrated into Finch day-building.
- Josh + Charles approve copy + the nav direction + Settings layout before ship (brand/taste).

## Open ⚑ for Josh/Charles
- **Pick the top-nav option (A/B/C)** — the one blocker for N1.
- Charles: the premium copy voice over the before/after table + 43 DRAFT strings.
- Premium visual direction (how quiet is too quiet — eyeball as N2 lands).
- Carried from 3.5: ⚑X3 Commons image attribution page; ⚑R1 hidden-shelf re-eyeball (re-balanced by W7); the post-3.5 city-guide layer (restaurants/bars/cafés, ~+1,500–2,200, ~1.5 sprints).
