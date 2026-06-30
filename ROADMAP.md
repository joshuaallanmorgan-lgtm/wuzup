# Wuzup — Road to v1

> **This is the working master plan.** It supersedes `PHASE_3.7.md`, which is retained as
> history + the original detailed spec. When this doc and 3.7 disagree, **this doc wins.**
> Maintained by the plan-scout; the builder executes punch lists derived from it.
>
> _Created 2026-06-17, at the close of Stage R (the visual rework)._
> _Doc map + naming spine = [INDEX.md](INDEX.md). Idea intake (v1/v2) = [BACKLOG.md](BACKLOG.md). Maintained by the project cop._

---

## ▶ CURRENT ROAD TO V1 (2026-06-25 — post UI overnight-grind)

The **UI overnight-grind (Stage 1 / Reference Finish) is DONE** and merged to `main` (`c96971c`): Plan
section (P0 daypart migration → P1 DayPage → P2 flows), card+filter consolidation + fidelity polish,
Events-full (+4 sections), Spots-full (themed sections + chips), the **cafe data source** (332 real OSM
cafes → real Coffee & Hang), and **Tinder** ("Tune your taste" on Events + Spots). The big structure +
content is built and matches the mockups' **content** — but not yet their **premium feel.**

**What's left to v1 is FEEL → cleanup → expansion → ship, in this order:**

### Stage A — PREMIUM-FEEL PASS ◀ IN PROGRESS — imagery (A3) ✅ shipped · A5 next (the headline)
Driven by **[`PREMIUM_PUNCH.md`](PREMIUM_PUNCH.md)** (Josh's playtest notes ∪ a 7-lens diagnostic —
typography/spacing/color/depth/imagery/motion/components — merged, deduped, ranked, **8 LOCKED owner
decisions** at the top). **Four non-negotiables are deliberately bent for this pass: imagery · depth ·
motion · richer content** (new policy re-codified in PREMIUM_PUNCH §2; honesty bar still holds — nothing
fake presented as real). Sub-phases:
- ✅ **A1 Quick wins** (PREMIUM_PUNCH §3) — tabular numerals · card padding 10→16 · gutter unify · warm bg ·
  warm floating tab bar · carousel shadows · press feedback · section-title bump · accent restraint · chip
  primitive. Mostly token edits → immediate visible lift.
- ✅ **A2 Card system rework** — D1 uniform size · D2 lower contrast · D3 full title · D4 heart top-right ·
  tall left image · real CTA button · stroke-icon family (retire emoji controls).
- ✅ **A3 Place imagery — DONE** (honesty-first; the old "curated stock + per-placeType sets, ≥80% coverage"
  target was REJECTED + reverted). Shipped in 3 merged PRs: (1) **Mapillary sign-verified** cafe storefronts
  (35/332 — ship ONLY when a storefront sign name-matches; real-of-the-place, CC-BY-SA credited); (2) the
  **Aurora art floor** — a per-place deterministic generative gradient field (seeded by `place.key`) for the
  ~89% with no photo, breaking the per-type "wall"; (3) the **multi-city imagery lock** — city-agnostic
  pipeline + fail-closed honesty guards + a committed per-city runbook. Coverage is precision-first (~6% real
  photos, but 100% a premium floor) — never fake-presented-as-real.
- ✅ **A4 Depth + motion systems** — the 3-step shadow scale + the motion policy (skeletons, the Add-to-plan
  animation, deck polish).
- ◀ **A5 Per-screen + decisions** *(NEXT)* — Settings (D7 row removals + premium primer) · Map (D8 park → Google Maps)
  · Tinder deck match (D6) · one-line filter chips (D5) · Plan/Calendar · Taste/Interests · header pattern +
  Title Case · BubblePage chrome (FLOWS §1 folded in).
- **A6 Codify the new contracts** into `index.css` + the design-system docs.

*(Status caveat: A3 is independently verified done. **A1/A2/A4 are marked done per the overnight grind, but PREMIUM_PUNCH §0's D1–D8 decision boxes are all still unticked** — so A5 opens with a quick render-vs-§0 reconcile to confirm what's actually shipped before Stage A formally closes.)*

Gate: reads **premium** against the north-star, top-to-bottom.

### Stage B — Patch sprint
Josh's accumulated micro-tweaks + tracked cleanups (Guides mid-page on Events, the P2 tap-through to fully
close Plan, the pre-existing flaky smoke test).

### Stage C — Deep Sweep *(was Stage 2)* — dead-code / dedup / perf / bundle / a11y / final token + card-variant consolidation.

### Stage D — Multi-City *(was Stage 3)* — per-city event/place data (new source modules) · a city switcher · per-city copy/theming. The big pre-ship expansion. **Imagery already pre-banked (2026-06-26 multi-city lock):** the finder's region is now ONE city config (no longer a hard-coded Tampa bbox) and the Mapillary + Aurora pipeline runs for any city with all honesty guards baked in — so Stage D's remaining work is the data sources + switcher + theming, NOT the imagery.

### Stage E — V1 Ship *(was Stage 4)* — holistic pass (full app vs all refs + the premium bar) · final contract/honesty audit (post-bending) · perf/build hardening → ship. Then v2 (the parked map, etc.).

*(This re-sequences the original §2 — Premium + Patches now precede Deep Sweep. The Stage definitions for Deep Sweep / Multi-City / v1 Ship below still hold.)*

---

## Naming (the one spine — old numbers are retired)

Forward work is named by **Stage** (see §2). The old **"Phase 4" = Stage 4 (v1 Ship)**; the old **"3.77 / 3.78" = Stage 3 (Multi-City)**; the **`*_GRIND` / `*_PHASE2`** screen docs are the **Stage 1** per-screen pass. Everything earlier (Sprints A–Y · Waves · Phases 1–3 · 3.5 / 3.6 · 3.71–3.76 · 3.7P-*) is **shipped history** — see [INDEX.md](INDEX.md).

---

## 0. Where we actually are (baseline — read this honestly)

Stage R (the aggressive "Sunlit Coastal Pop" visual rework) is **structurally complete**: a state-map
audit found **all 24 user-facing surfaces now wear the new visual skin** (modern tokens, `--cta`
primary buttons, flipped section-head hierarchy, clean light headers, `pg`/`pg-head` subpage shells).
There are **no surfaces left in the old pre-Stage-R style.**

**But "skinned" is not "done," and we will not pretend otherwise:**

1. **Fidelity is unconfirmed.** "Has Stage R tokens" ≠ "matches the reference image." Only Josh's
   eye confirms a pixel-match, and that pass hasn't happened.
2. **14 of 24 surfaces had no reference image to match against.** The builder *interpreted* the
   visual language on those (onboarding, the 3 decks, empty/error/loading, Settings, sheets, the new
   Profile sub-pages). They are styled, not matched.
3. **The aggressive push left code debt** — dead CSS, duplicated markup, paths that need
   re-verification after the churn.
4. **Features, multi-city, and shipping are still ahead.**

**Honest scope to v1: ~12–16 calendar weeks at a part-time pace (~60–80 focused dev-hours, overlapping).**
This is a multi-week road, not a few patches. We are NOT "almost at the next phase."

---

## 1. Binding contracts (carry verbatim — do not drift)

These are load-bearing and survive every stage. Any change requires explicit Josh sign-off.

1. **Honesty contract (never-hide).** Curation-by-quality + see-all; taste **reorders, never filters**;
   no fake data; real-photo-of-the-actual-place or category-art floor (no type-photos); sources
   disclosed; sponsored / added-by-you labeled.
   - **Amended 2026-06-28 (Josh + Charles re-adaptation; recorded sign-off — §1 requires it):** the default feed is a
     **curated magazine**; the **complete, taste-tuned set lives behind the Tinder swipe** (the primary find-AND-tune door)
     **and/or a scrollable see-all fallback.** **Reachability is binding** — every event must stay surfaceable: the deck must
     offer a **non-dead-ending re-deal loop** (or a link to the full list), and a **button/scroll fallback** to the complete set
     must exist for reduced-motion users. Sponsored is excluded from the deck for **honesty** (not taste). `curate.js`'s
     count-preserving `full`/`fullEventCount` is retained as the never-hide proof.
     _Shipped 2026-06-30 (Stage B Batch 5): the deck re-deal loop landed FIRST — CalibrationDeck's done screen now has a reachable "Deal again" that re-deals the next batch via the deck-last-v1 exclude. The Events see-all then relocated to the deck (openDeck {kind:'events'}), with the in-feed "See all N" expand RETAINED as the fallback (Josh's call). All three binding reachability conditions hold: re-deal loop · in-feed fallback · curate.js count-preserving full/fullEventCount proof._
2. **D.0-R primary-button system.** One shared treatment = **`--cta #bb5719` fill + white text**
   (white-on-`#bb5719` ≈ 4.68:1, passes AA). White is **forbidden** on the light gold `--accent #ff8c42`.
   `--accent-ink #b35418` for accent-text-on-light.
3. **"Sunlit Coastal Pop" tokens (current values):** `--bg #fcfbf9` · `--card #fefdfb` · `--ink #1a1410`
   · `--muted #756b61` · `--line #ede8e2` · `--accent #ff8c42` · `--accent-2 #ffa754` ·
   `--cta #bb5719` · `--accent-ink #b35418` · `--hot #ff3b5f` · `--reward #d966f5` · `--free #0fa86d`.
   Kumbh Sans titles + Inter body + paper-grain.
   - **Dark immersive theme (binding, decided 2026-06-17):** onboarding (Primer) + the 3 decks
     (Calibration / Lens / DayFill) use a deliberate **dark ambiance** (warm-dark `#1b1712`, gold kicker
     `#ffb066`, white text, reward-violet `#d966f5` finish beats) as a focus/ceremony contrast to the
     light browse app. **Keep it.** REFERENCE II (`sheet-a.png`) renders these light — that's a
     generation artifact, **not** the target; those panels are **layout/content reference only**, never
     color. Everything else is the light palette above.
4. **Profile vs Settings split.** Profile = **taste + identity + memory** (plans/saves/likes); Settings
   = **maintenance only**. Decided + shipped in the Profile rework.
5. **Builder discipline.** One commit per patch; build → 3-lens review → hand-verify → `npm test` →
   live-verify → push. No giant rewrites. **Aggressive in Stage 1, disciplined in Stage 2.**
6. **Data model.** Two never-merged stores: `events.json` (time-based) + `places.json` (always-there).
   Multi-city = parameterize (~12 touch points; bbox + timezone per city), never fork.

Also carried: guide naming (**Guides** / Watch Guides / Smart Groups); image strategy (real photos;
CC-BY licensing bar; ~Tampa free coverage via Wikidata + OSM + gov); gamification (streaks/rhythm on
self-reported data; the zero-is-silence ban was **lifted** to allow this).

---

## 2. The stages (the road)

| Stage | Name | Mode | Exit gate |
|---|---|---|---|
| **1** | **Reference Finish** | Aggressive patch, until Josh says stop | Josh's screen-by-screen visual sign-off |
| **1.5** | **Build-up** | New development + new references (deferred from the finish) | Per-feature; runs alongside/after Stage 1 |
| **2** | **Deep Sweep** | Disciplined, verify-everything | Green gate + path sweep + no P1/P2 bugs |
| **2.5** | **Premium Polish ("Lamination")** | Feel, not structure | Type/spacing/motion/icons elevated; micro-QA clean |
| **3** | **Multi-City** | Refactor + prove | Two cities live + clean |
| **4** | **v1 Ship** | Harden + release | Shippability gate passes; beta out |
| **v2** | **Backlog** | Post-v1 | — |

### Stage 1 — Reference Finish  *(runs until Josh approves; expect many patches)*

Goal: **match the reference down to the pixel** on every surface, and bring the un-referenced surfaces
into the same visual language so nothing reads as orphaned.

> **Now running as a per-screen pass** (the work happening tonight): the `*_GRIND` (landing pixel-match) + `*_PHASE2` (its flow destinations) docs, screen by screen — **Profile → Home → Events → Spots → Plan**. Fidelity/wiring cleanup in [TOUCHUP_PUNCHLIST.md](TOUCHUP_PUNCHLIST.md). **Plan/DayPage is deferred** (path-risky daypart store migration — held for an awake session). All screens tracked in [INDEX.md](INDEX.md).

- **1a — Pixel-match the 11 referenced screens.** The recursive loop we've been running:
  Josh eyeballs a fresh build → scout produces a file:line punch list → builder fixes → repeat.
  Surfaces: Home, Events, Spots, Calendar, Profile, Map, Event detail, Spot detail, Search
  (+ the design-system/cards conventions).
- **1b — Bring the 14 un-referenced surfaces up to spec** (see §3). For the distinct ones, **commission
  new "same-vibe" reference images** first; for the rest, derive a written spec from the existing
  reference language, then patch + confirm.
- Builder mode: **build aggressively; revert is the safety net; deep QA is Stage 2.** Surface — don't
  silently reject — anything you choose not to build.

### Stage 1.5 — Build-up  *(deferred development + new references; not pure pixel-finish)*

Stuff that needs real development and/or new reference art, split out of Stage 1 so the finish stays fast.
Runs alongside or after Stage 1; each item gets scoped when we reach it.

- **Home — the rest of the page:** the "Tonight's top picks" treatment + Josh's vision for the lower
  homepage; the swipe-deck's home placement; **Map-opens-from-Home.**
- **Events / Spots — below the fold:** the additional content/sections beneath the cleaned-up top.
- **Guides (flagship):** source real guides/rankings from the web; roll out the sheet-b guide-page design;
  clarify what the Topic/Bubble page is for (or retire it).
- **Images (B1 — non-negotiable):** a **unique real image per location** across ~1,832 spots + ~1,536
  events — a sourcing + licensing + pipeline workstream (the "green wall" is its visible symptom). Needs
  its own plan; honors the real-photo-or-text-floor / no-type-photo rule. Stage-1 ships the text-rich
  fallback (fix 1-B) in the meantime.
- **Search — richer zero-state:** extrapolate the pre-search screen into the fuller visual vision.
- **Onboarding depth:** possible re-render keeping the established taste (Josh preferred the original feel).

### Stage 2 — Deep Sweep  *(hardening, before we multiply surfaces across cities)*

Goal: clean up what the fast UI work left underneath, so we harden the single-city app **once** rather
than per-city.

> **Re-run after the grind:** the per-screen Stage-1 rebuild has landed a lot of new code since the early Deep Sweep — this stage must run again against the current tree, not be assumed done.

- **Tier 0 — Orphan inventory (do FIRST; preserve before you delete):** inventory the sections + logic
  that are **built but no longer shown** by the UI (e.g. the by-activity / by-category logic hidden or cut
  during the grind). For each: **re-use now**, **note to revisit later** (→ [BACKLOG.md](BACKLOG.md)), or
  **intentionally retired** (Dice / Find-My-Night — stay gone). Do not let the dead-CSS/de-dup tiers below
  silently delete reusable feature logic.
- **Tier 1 — Dead CSS (zero risk):** remove `.loc-hero*` (locations.css), `.sec-overline` (App.css,
  never fires post-flip), and other retired rules; verify removed classes are gone.
- **Tier 2 — Path re-verification (§O do-not-break):** `openDetail` `[data-vt]` morph targets; `focusMap`
  → `{type:'map'}` resolution; Escape capture/bubble layering (detail closes before map; the Map
  filter-vs-pin-sheet ladder); day-plan `ts` / `anchors.todayTs` consistency; single-slot subpage union
  (no stacking); z-index hierarchy (detail 2000 > subpage 1500 > overlays); `openSearch` from all tabs;
  NextDays re-seed on return.
- **Tier 3 — De-dup:** extract the `.loc-search` button (duplicated in HotView / LocationsView / MapView)
  into a shared `<SearchBarButton />`.
- **Bug hunt + a11y basics + honesty re-audit**, then **Tier 4 test gate:** `npm test` + clean build
  (no orphan-CSS warnings) + a ~30-min scripted live QA run of the core flows.

### Stage 2.5 — Premium Polish ("Lamination")  *(feel, not structure — added 2026-06-22 per Josh)*

Structure is locked by here. This pass makes the app **feel premium without changing the layout** — the "lamination" coat over a finished frame:
- **Type & spacing** — elevate every text style and rhythm from "correct" to "premium."
- **Motion** — purposeful transitions + micro-interactions.
- **Iconography** — refine icons / little glyphs / menu affordances for consistency and polish.
- **Micro-QA** — hunt visual glitches: clipped or half-hidden buttons, awkward placements, off spacing, anything that reads cheap.

No structural or flow changes — same screens, better finish. Distinct from Stage 2's *code* hygiene; this is *visual feel*. Runs before Multi-City so the second city inherits the laminated version.

### Stage 3 — Multi-City

> **= the old "3.77 (geo-refactor) / 3.78 (city #2)".** Config-ready: city #2 = **SF & East Bay** (`id sf-east-bay`; bbox 37.68–38.00 N / −122.53 to −122.00 W; CA State Parks dropped on license; adapters osm / ebrpd-parks / sf-parks / dedupe). **Keep Tampa byte-identical** and fix the Eastern-timezone hardcode. Full build packet = [PHASE_3.7.md](PHASE_3.7.md) Addendum I / §15.

- **3a — Geo-refactor:** de-hardcode Tampa Bay; introduce a city model + selector; parameterize the
  ~12 touch points (bbox + timezone per city). No forking.
- **3b — Add SF + East Bay:** SF + Walnut-Creek-and-between (drop CA State Parks). **Risk flag:** gov
  API endpoints may need 1–2 spike days to verify per city — budget for it.
- Exit: Tampa + SF/East Bay both live and clean.

### Stage 4 — v1 Ship

- Attribution page (per-source, per-city — the X3 requirement), PWA + deploy + brand polish, final
  a11y + dark-mode pass, the §B.5 shippability gate, beta release.
- **Full path-trace bug hunt:** walk every navigable path in the app and confirm it works; backend
  cleanup; no P1/P2 bugs. (Re-runs the Stage 2 sweep against the shipped build.)

### v2 Backlog (explicitly post-v1)

> Tracked + triaged in [BACKLOG.md](BACKLOG.md); specs developed early in `/planning/v2/`.

Evidence layer (P9 + scoring), more cities (NYC / Austin / Seattle / Puerto Rico), deeper gamification,
expanded dayparts, event series, user photos, NL-search expansion, community features, offline mode.

---

## 2A. Stage 1 live status — render-vs-reference (method + findings)

> **Lesson learned (2026-06-17):** a *code* comparison ("does the component exist / use the tokens")
> measures **structure**, not **fidelity**. It will report "matches" while the rendered screen has a
> flat-green hero or an orange header band. **Pixel-fidelity can only be judged on the live render.**
> So Stage 1 verification is done against the running app, not the source.

### The method (how to actually verify)
1. `preview_start` the `app` server (port 5173) → `preview_resize` to **460×920** (the mobile frame).
2. Navigate, then **screenshot twice** — subpage slide-in is ~400ms, so the *first* shot catches it
   mid-animation; the *second* is the settled view.
3. **Navigation quirk:** bottom-nav tabs and onClick menu rows fire from a synthetic
   `MouseEvent('click',{bubbles:true})` on a leaf element. **"pressable" components do NOT** (search
   disc, featured card, "Deck this", the Map chip) — so **event/spot detail, Search, Map, and the decks
   are not drivable by a scout via synthetic events.** Those must be verified by the builder driving the
   app for real, or by Josh's eyeball.
4. Compare each screen to its panel across **all three** sheets: `ui-benchmark.png` (core 11),
   `sheet-a.png` (onboarding/decks = dark, keep; + planning), `sheet-b.png` (taste/settings/sheets/states).

### Verified so far (live render, 2026-06-17)
| Screen | Verdict | Note |
|---|---|---|
| Profile | ✅ excellent | monogram + name + city + gear + 5 flat rows — true match |
| Settings · Taste · My saves · My plans | ✅ strong | sections/controls/copy all match (sparse where data is thin — honest) |
| Home | ✅ close | minor: day-card CTA pills read chunky vs the mock |
| Events | ✅ close | header + search bar + chips + Guides + Your list on-style |
| **Spots** | ✅ **fixed** (`c29aabc`, 1-B) | now prefers a photo-bearing top spot (Crews Lake + real photo); text-rich medallion card if none has a photo |
| **Plan/Calendar** | ✅ **fixed** (`c29aabc`, 1-A) | clean light header (`var(--bg)`, no band); dropdown + Today/arrows kept |
| Home | ✅ **fixed** (`c29aabc`, 1-C) | day-card CTA tightened (12.5px/700, 7×13, r9) |
| Event detail | ✅ render-verified | hero photo · back-left · share+save cluster · two-button CTA (`#bb5719`+white) · honest When/Where/Price/Why rows |
| Spot detail | ✅ render-verified | title-below-hero · share+save · Free/Restrooms/Boat-launch chips · "Make this my plan" CTA |
| Search | ✅ render-verified | light · 4 scope tabs w/ counts · active tab gold+ink (D.0 ok) · empty state "No matches. Try…" muted-on-light |
| Map | ✅ render-verified | search bar · layer seg · SVG sliders filter glyph · Near me · honest deck label · tiles |
| LensDeck · DayFillDeck | ✅ render-verified **dark** | `.pg.ldk` warm radial-gradient bg + white text + white/gold kicker — contract-correct |
| Primer | ✅ render-verified **dark** | `.primer` `#1b1712` + white + Continue/Skip — contract-correct |
| CalibrationDeck | ⏳ **inferred dark** | not directly driven (only reachable via the primer-finish "dial it in" offer); shares the confirmed `.pg.ldk` dark shell — recommend a direct eyeball |
| DayPage | ✅ render-verified | light `.pg` · "Wednesday, June 17" · `.dpg-slots` · 🃏 deck entry |
| Guide page | ✅ render-verified | light `.pg` · "⚽ Where to watch the World Cup" · `.guide-sources` |
| Bubble page (PlaceBubblePage) | ✅ render-verified | light `.pg` · "🏖️ Beach day" · 275 spot rows |
| loading / error states | ⏳ **fault-gated** | Map "Loading spots…" deck observed during lazy load; full empty/error not triggerable without network-fault injection — derive a spec in 1b |

> **Render-sweep note (builder, 2026-06-17):** screenshots **wedge** in this preview env (renderer-capture
> hangs at 30s while `eval` returns instantly — not an app hang). Verified above via live computed-style /
> DOM driving at 460×920. **Josh's eyeball stays the visual gate.** No console errors across the full sweep.

### ✅ STAGE 1 PUNCH LIST COMPLETE — fixes `c29aabc` + Batches 1–8 (`322c808`→`e634b24`)

All of `STAGE1_PUNCHLIST.md` shipped, one commit per batch, each gated (lint + build + 83/83) and
live-verified at 460×920: pre-fixes (1-A/1-B/1-C) · B1 Home · B2 Spots · B3 Calendar+nav · B4 Profile ·
B5 DayPage · B6 Map · B7 Settings/Taste/Interests · B8 Plans/Saves/Search-zero-state. Deviations
surfaced for Josh (litCard removal, DayPage "weather+likes" → taste-honest subline, deck accent-ink vs
raw gold, kept richer-than-mock transparency). **Awaiting Josh's screen-by-screen sign-off to close
Stage 1 → Stage 2 (Deep Sweep).** (Note: screenshots wedge in this env; verification was DOM/computed-style.)

### Confirmed Stage-1 fixes — ✅ SHIPPED `c29aabc` (1-A/1-B/1-C; lint+build+83/83, live-verified)
- **1-A · Calendar header → clean light.** `calendar.css:9` `.cal-top` uses
  `background: linear-gradient(135deg, var(--accent), var(--accent-2))` (orange band). Change to the
  clean light header every other tab uses (background `var(--bg)`/transparent, bold-ink title, no band).
  *High confidence.*
- **1-B · Spots "Recommended" featured card → no green wall.** `LocationsView.jsx:155-160` renders
  `<FeaturedCard e={topSpot}>`; with no real photo it falls back to a flat green category-art block.
  Fix: prefer a `topSpot` that HAS a real photo, **or** render the text-rich/no-photo treatment (name +
  amenity chips) instead of a big flat color hero. (Ties to the never-hide / no-type-photo / "green wall" rule.)
- **1-C (minor) · Home day-card CTAs** read chunky vs the mock — verify + tighten padding/size.

### Process from here
1. Send 1-A/1-B (1-C optional) to the builder.
2. **Builder render-verifies the pressable-gated screens** (it can interact for real): event/spot
   detail, Search, Map, the 3 decks, Primer, DayPage, Guide/Bubble, empty/error/loading — screenshots
   each vs its sheet panel, logs deltas into this section.
3. Loop: render-vs-reference → file:line punch list → fix → re-screenshot/confirm → **until Josh signs
   off** screen by screen. Then Stage 1 closes and Stage 2 (Deep Sweep) begins.

---

## 3. Reference-image plan (the coverage gap)

**Have a benchmark panel (11):** Home, Events browse, Event detail, Search, Map, Spots, Spot detail,
Calendar, Profile, + the design-system / cards panels.

**Need a NEW "same-vibe" reference image (the distinct interaction paradigms — do these first):**
Primer (onboarding), the 3 swipeable decks (CalibrationDeck, LensDeck, DayFillDeck), and the
empty / error / loading states.

**Can be derived from the existing reference (write a spec, no new image):** Settings + sub-sections
(main-list pattern), InterestEditor, TastePanel, My Plans / My Saves (Profile sub-pages), PinSheet,
NextDays, DayPage, Bubble / Guide pages, HotView filter UI, Map layers/legend.

---

## 4. Roles & loop

- **Josh (PM + the visual gate).** Eyeballs fresh builds; his sign-off is the Stage 1 exit. Final
  call on scope, the v1/v2 line, and brand.
- **Scout (this Claude).** Plan-side only — owns this doc, turns Josh's eyeball feedback + reference
  comparisons into precise file:line punch lists, verifies builder output against the benchmark, guards
  the contracts and the §O paths. Does not write app code.
- **Builder (separate session).** Executes punch lists; one commit per patch; aggressive in Stage 1,
  disciplined in Stage 2.

**The loop:** Josh eyeballs → scout punch-lists (deduped, path-safe, file:line) → builder fixes a batch
→ Josh re-looks → repeat to sign-off.

---

## 5. Decisions (resolved 2026-06-17)

- **Stage order** — **Deep Sweep (2) before Multi-City (3).** Clean the mess once, not per-city.
- **v1/v2 line** — **v1 = Tampa + SF/East Bay + ship polish; v2 = evidence layer, other cities, deeper
  gamification.** (Josh can still flip if scope tightens.)
- **Reference images** — **generate NEW "same-vibe" images for ALL 14 un-referenced surfaces** (Josh:
  "match down to the pixel"). Scout produces a code-grounded image brief → Josh generates → builder
  pixel-matches. **Stage 1b is gated on these images; Stage 1a (the 11 already-referenced screens) runs
  in parallel** (no image dependency).

---

## Appendix — Surface coverage (Stage R skin applied; fidelity unconfirmed)

All 24 carry Stage R styling. ✅ = has a benchmark image to match; ⚠ = styled without a reference
(builder interpretation — needs an image or a spec in Stage 1b).

✅ HomeView · HotView (Events) · LocationsView (Spots) · CalendarView · ProfileView · MapView ·
DetailPage · PlaceDetail · SearchPage · (cards/design-system)

⚠ Primer · CalibrationDeck · LensDeck · DayFillDeck · empty/error/loading states · SettingsPage ·
InterestEditor · TastePanel · MyPlansPage · MySavesPage · PinSheet · NextDays · DayPage ·
BubblePage / PlaceBubblePage / GuidePage
