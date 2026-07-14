# BACKLOG — post-v1 intake + operational closeout

> **How to use this:** v1 is shipped. New product ideas enter here as **v2** or **parked**; operational
> closeout stays explicitly separate from feature scope. Material v2 items get a spec in
> [`/planning/v2/`](planning/v2/) and an explicit decision status before implementation.
> This file supersedes the old `LONG_TERM.md` (its items are triaged in below). _Established 2026-06-22._

**Tags:** `v1-history` = frozen launch-era intake · `v2` = current/future product work · `parked` = maybe never / needs a reason to revive · `done` = shipped (kept so we don't re-litigate).

---

## 📥 Inbox (untriaged — drop raw ideas here, I sort them)
_Empty. Add a line and I'll tag + place it._

---

## v1 ledger — frozen historical intake
_This table records what the launch-era backlog asked for; it is not a current checklist. For what
actually shipped, use [ROADMAP.md](ROADMAP.md) and [STAGE_E.md](STAGE_E.md). Any row that did not land
must be re-filed deliberately under post-v1 work rather than silently treated as launch debt._

| Idea | Lands in | Notes |
|---|---|---|
| City selection flow + per-city hero art | Stage 3 | Needed the moment there's a 2nd city. |
| Second city live (SF & East Bay corridor) | Stage 3 | Config-ready spec exists (PHASE_3.7 Addendum I → ROADMAP §Stage 3). |
| Deploy + PWA + automated data refresh | Stage 4 | The old "Sprint F / Sprint W"; Josh-gated. |
| Per-source attribution page (per city) | Stage 4 | Honesty-contract requirement (the old ⚑X3). |
| Final a11y pass + dark mode | Stage 4 | ROADMAP scopes dark mode into v1 ship. |
| Data-quality hardening (suspect times, price semantics) | Stage 2 / 4 | The honest-data floor; egregious cases only for v1. |
| Plan/DayPage 3-daypart rework + store migration | Stage 1.5 | Currently deferred (path-risky) — must land before ship. |
| **Images — unique real photo per location (deep pass)** | Stage 1.5 | "Current images totally suck." Sourcing + licensing + pipeline; honest real-photo-or-art floor (no type-photos). A real workstream, not a patch. |
| **Premium polish — "lamination"** (feel, not structure) | **Stage 2.5** (new) | After structure is locked: elevate type, spacing, motion, iconography/little icons, menu items + micro-QA (clipped/half-hidden buttons, odd placements). No layout changes — turn "perfect structure" into "perfect feel." |
| **Full path-trace bug hunt** (every navigable path) | Stage 4 (+ re-run Stage 2) | Backend cleanup + walk every path in the app to confirm it works; re-runs the Deep Sweep against the shipped build. |
| Guides (lite) — a few sourced guide pages | Stage 1.5 | The deep, interest-driven version is **v2** → [planning/v2/guides-and-rankings.md](planning/v2/guides-and-rankings.md). |
| **Orphaned-but-built audit** — inventory hidden/unwired sections + logic, re-use or note-to-revisit | Stage 2 (guard) | Don't let Deep Sweep silently delete reusable feature logic (esp. by-activity / by-category). Findings table below. |
| **Sports-bars → place Activity** (not an events guide) | Stage 1.5 / 3 | The right end state once real sports-bar PLACES are sourced (places.json is parks/outdoors today, no bars). Designed once during Stage B Batch 1 — `act-sports-bars` predicate + a HomeView `openPlaceBubble` rewire — then reverted to keep the populated game-watch **events** guide until bar data exists. Flip back when the data lands. |
| **Cross-section variety** — the same top event can headline Home picks AND Events "Tonight's best bets" (and Home "Your next days" ≡ Plan "Upcoming") | Stage D / E polish | Curation-diversity, NOT the (fixed) dedup bug: sections draw from the same tonight pool by rank. A count-preserving diversity nudge (skip an event already featured one section up) keeps never-hide intact. Flagged by the 2026-07-01 live capture + re-confirmed on the fresh snapshot. |
| **Finder data-tail batch** (from the Cohesion REFUTE, 2026-07-02) | Stage D (rides the next finder pass) | (a) "St."↔"Saint" venue-alias fold (trolley-tour July-4 dupe); (b) the date-only/max-end exhibit fold can umbrella a *celebration listing* onto a game record (Threshers 7/3→7/4 artifact) — needs a family-title guard; (c) UT staff/HR + degree-deadline rows ship as "community" events — extend the calendar-row filter; (d) ~6 category-tail cases ("Movie Screening: Monsters **vs.** Aliens"→sports via the ballgame heuristic; arcade nights→sports; piano-rock→other); (e) 1 "About this event" Eventbrite chrome prefix in a description. All disclosed in the Cohesion PR; snapshot self-heals on the refresh after the fixes land. |
| **Guides → the refs' large editorial cards** (photo-backed, honest covers) | Stage E / v2 | WS4 skipped guide covers for good reasons: tile-size covers have no honest home for CC attribution, and the shared IntentTile widget would fork. The real fix is the reference design — a Josh/Charles redesign decision. |

### 🔍 Orphaned-but-built inventory (historical Stage-2 audit prompt)
_Sections + logic that are **built but no longer shown** by the UI (much got hidden/cut during the reference-match grind). Goal: **don't throw away reusable work.** Each finding gets a disposition: **re-use now** · **revisit later** (→ v1 or v2) · **intentionally retired** (stays gone)._

**Candidate areas to check** _(to confirm in code during the audit — not yet verified; this chat doesn't read code):_ old magazine/feed sections (Tonight / Free / Hidden / The Big One), the "your kind of night" taste rail, the **by-activity / by-category** logic behind tiles + bubbles, Recently-saved (wiped from Profile), and anything cut while pixel-matching references. **Do NOT revive deliberately-retired features** (Dice, Find-My-Night).

| Built-but-hidden section / logic | Disposition | Notes |
|---|---|---|
| _(no live inventory was recorded here; new findings must be filed as concrete post-v1 items)_ | intentionally retired as an empty tracker | Stage C completed; do not infer untracked work from this row. |

## Operational closeout (not product scope)

| Item | Status | Evidence / next gate |
|---|---|---|
| Pages after `cj` → `wuzup` rename | ✅ repaired 2026-07-14 | Fresh deploy; Tampa + SF assets 200; real mobile-browser pass clean. |
| Main-branch safeguards | ✅ enabled 2026-07-14 | Required `gate`, strict/linear history, conversation resolution, admin enforcement; force-push/deletion blocked. |
| First scheduled refresh cycle | ⏳ observe | Thursday 2026-07-16 09:23 UTC: runner fetch → test → bot PR → merge → deploy. |
| Supervised SF imagery | ⚑ Josh | Human pixel review remains non-delegable under the imagery honesty contract. |
| Brand/copy/glyph refinement | ⚑ Charles | Placeholder mark/favicon, copy, warmed greens, medallion tints, nine drawn glyphs. |

---

## v2 — post-launch
_Tag an idea `v2` and I file it here; the big ones get a spec in [`/planning/v2/`](planning/v2/) and get developed early._

**Discovery thesis (the frame for all of v2):** people find things three ways — (1) **recommended for you**, (2) **hidden gems you may like**, (3) **popular + hidden together**. Mode 1 = the Smart Engine; modes 2–3 = Guides & Rankings.

### 🌟 Headline builds (specced)
| Theme | Spec | What it is |
|---|---|---|
| **Smart Engine** — learning → ranking/tiering | [planning/v2/smart-engine.md](planning/v2/smart-engine.md) | The app *learns* (likes, swipe deck, settings, onboarding) and ties it **back into event + spot generation**; tiers the best 10–20 while keeping all (never-hide). The invisible work that makes it actually feel smart — the real point of v2. Absorbs: event/spot-engine tuning, ranking & tiers, personalization, Tinder/swipe **redesign**. (Rescope pending — quality-engine §13.10: objective scoring = quality's lane; the tie-back narrows to per-user ordering.) |
| **Guides & Rankings** | [planning/v2/guides-and-rankings.md](planning/v2/guides-and-rankings.md) | "Top 10 beaches / top 10 hidden beaches" by interest — popular **and** hidden gems; our own honest sourced rankings → later **community-influenced** (IMDB × Letterboxd × Finch). Absorbs: evidence layer, sourced rankings, the deep successor to v1 guides-lite. |
| **Quality Engine** — corpus quality at build time | [planning/v2/quality-engine.md](planning/v2/quality-engine.md) | Proposed Foundry first stage, pending ratification: junk floor → two-axis scoring → quality/evidence tiers (reorder + badge, never filter) → fail-closed LLM gate → honest hidden gems. Absorbs PHASE_3.7 Addendum G and supplies a candidate mechanism for V2_VISION §5's binding quality gate. |
| **Premium UI — the Feel Substrate** | [planning/v2/premium-ui.md](planning/v2/premium-ui.md) | Motion/touch/materials/loading/ceremony grammar under every V2 surface; proposed sibling substrate to Layer Zero (threshold ruling pending, its §7.0). Receipts chrome ships only on quality-engine's emitted fields. |

### Other v2 items
| Idea | Notes |
|---|---|
| Everywhere / City Foundry Reach track | Ruling #8: run in parallel to feature releases; US ≥50% honest coverage minimum, then toward full-US and global. See V2_VISION §10. |
| Social / community layer (likes, reviews, friends, who's-going) | Powers community-influenced rankings; "whole second product," needs accounts. |
| In-app ticketing / purchase flow | Today "Get Tickets" links out. |
| Cross-source fuzzy dedup · user/operator photos · NL-search · event series · expanded dayparts · year calendar view · paid data · headless JS-source coverage (Red Bull benchmark) | Grab-bag; promote individually when prioritized. Hourly refresh was cut; offline/service-worker work belongs to Layer Zero #5. |

## parked
| Idea | Notes |
|---|---|
| Native wrap (Capacitor) | Only if PWA proves insufficient. |
| Monetization | No reason to design yet. |
| Interactive map (Leaflet) | **Parked v1 (D8, Stage A5).** Removed the map tab/sub-view, the LensNav Map pill, and the detail mini-maps; location now routes to Google Maps via the Directions link (same as before). Retired `MapView.jsx` / `map.css` / `leaflet-lazy.js` (dropped ~18KB gzip from the bundle). Revisit in v2 only if an in-app map earns its weight. |

---

_Full historical detail for the migrated items lives in [LONG_TERM.md](LONG_TERM.md) (read-only history)._
