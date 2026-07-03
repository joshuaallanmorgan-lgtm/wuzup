# BACKLOG — v1 / v2 idea intake

> **How to use this (the whole point):** when you have an idea, tell the project cop **"that's v1"** or **"that's v2."**
> I add it here with a tag. **v1** items feed the Stages in [ROADMAP.md](ROADMAP.md). **v2** items that are worth developing get their own spec in [`/planning/v2/`](planning/v2/) — so we can **start building v2 while v1 is still finishing**, without touching the v1 plan.
> This file supersedes the old `LONG_TERM.md` (its items are triaged in below). _Established 2026-06-22._

**Tags:** `v1` = must be in the launch · `v2` = post-launch · `parked` = maybe never / needs a reason to revive · `done` = already shipped (kept so we don't re-litigate).

---

## 📥 Inbox (untriaged — drop raw ideas here, I sort them)
_Empty. Add a line and I'll tag + place it._

---

## v1 — must ship in version one
_The launch bar. Each maps to a Stage; that's where it actually gets built._

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

### 🔍 Orphaned-but-built inventory (v1 audit — populate during the Stage 2 sweep)
_Sections + logic that are **built but no longer shown** by the UI (much got hidden/cut during the reference-match grind). Goal: **don't throw away reusable work.** Each finding gets a disposition: **re-use now** · **revisit later** (→ v1 or v2) · **intentionally retired** (stays gone)._

**Candidate areas to check** _(to confirm in code during the audit — not yet verified; this chat doesn't read code):_ old magazine/feed sections (Tonight / Free / Hidden / The Big One), the "your kind of night" taste rail, the **by-activity / by-category** logic behind tiles + bubbles, Recently-saved (wiped from Profile), and anything cut while pixel-matching references. **Do NOT revive deliberately-retired features** (Dice, Find-My-Night).

| Built-but-hidden section / logic | Disposition | Notes |
|---|---|---|
| _(populate during the Stage 2 audit)_ | | |

---

## v2 — post-launch
_Tag an idea `v2` and I file it here; the big ones get a spec in [`/planning/v2/`](planning/v2/) and get developed early._

**Discovery thesis (the frame for all of v2):** people find things three ways — (1) **recommended for you**, (2) **hidden gems you may like**, (3) **popular + hidden together**. Mode 1 = the Smart Engine; modes 2–3 = Guides & Rankings.

### 🌟 Headline builds (specced)
| Theme | Spec | What it is |
|---|---|---|
| **Smart Engine** — learning → ranking/tiering | [planning/v2/smart-engine.md](planning/v2/smart-engine.md) | The app *learns* (likes, swipe deck, settings, onboarding) and ties it **back into event + spot generation**; tiers the best 10–20 while keeping all (never-hide). The invisible work that makes it actually feel smart — the real point of v2. Absorbs: event/spot-engine tuning, ranking & tiers, personalization, Tinder/swipe **redesign**. |
| **Guides & Rankings** | [planning/v2/guides-and-rankings.md](planning/v2/guides-and-rankings.md) | "Top 10 beaches / top 10 hidden beaches" by interest — popular **and** hidden gems; our own honest sourced rankings → later **community-influenced** (IMDB × Letterboxd × Finch). Absorbs: evidence layer, sourced rankings, the deep successor to v1 guides-lite. |

### Other v2 items
| Idea | Notes |
|---|---|
| More cities (NYC, Austin, Seattle, Puerto Rico) | Beyond the v1 two; PR is hard (Spanish + thin open data) — do last. |
| Social / community layer (likes, reviews, friends, who's-going) | Powers community-influenced rankings; "whole second product," needs accounts. |
| In-app ticketing / purchase flow | Today "Get Tickets" links out. |
| Cross-source fuzzy dedup · refresh daily→hourly · user/operator photos · NL-search · event series · expanded dayparts · offline mode · year calendar view · paid data · headless JS-source coverage (Red Bull benchmark) | Grab-bag; promote individually when prioritized. |

## parked
| Idea | Notes |
|---|---|
| Native wrap (Capacitor) | Only if PWA proves insufficient. |
| Monetization | No reason to design yet. |
| Interactive map (Leaflet) | **Parked v1 (D8, Stage A5).** Removed the map tab/sub-view, the LensNav Map pill, and the detail mini-maps; location now routes to Google Maps via the Directions link (same as before). Retired `MapView.jsx` / `map.css` / `leaflet-lazy.js` (dropped ~18KB gzip from the bundle). Revisit in v2 only if an in-app map earns its weight. |

---

_Full historical detail for the migrated items lives in [LONG_TERM.md](LONG_TERM.md) (read-only history)._
