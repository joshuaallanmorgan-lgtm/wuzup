# INDEX — the planning-doc map (start here)

> **What this is:** the single map of every planning doc, so we never again wonder "which plan is real?"
> **The one master plan = [ROADMAP.md](ROADMAP.md).** **Idea intake = [BACKLOG.md](BACKLOG.md).** Everything else is execution detail, durable reference, or history.
> Maintained by the project cop. _Established 2026-06-22._

---

## The one naming spine (Stages — use these words only)

All forward work is named by **Stage**. The old Phase/Sprint/3.7x numbers are **retired to history** (kept on disk, banner-ed, not executed from).

| Stage | Name | What it is | Status |
|---|---|---|---|
| **R** | Visual rework | "Sunlit Coastal Pop" skin on all 24 surfaces | ✅ done |
| **1** | **Reference Finish** | Pixel-match every screen to its reference — **incl. the current per-screen `*_GRIND`/`*_PHASE2` pass** | 🔨 **current** |
| **1.5** | Build-up | Deferred dev + new reference art (lower homepage, guides content, per-location images) | ⏳ next |
| **2** | Deep Sweep | Dead-CSS / de-dup / path re-verify / QA gate | ◑ mostly done early |
| **3** | Multi-City | Geo-refactor + add city #2 (**= the old "3.77 / 3.78"**) | 📋 specced, not built |
| **4** | v1 Ship | Deploy, PWA, attribution, a11y + dark mode, beta (**= the old "Phase 4"**) | ⏳ |
| **v2** | Backlog | Everything post-launch | → [BACKLOG.md](BACKLOG.md) |

**Where we are right now:** tail of **Stage 1** — the per-screen reference grind on branch `ui-overnight-grind` (Profile/Home/Events landings done, Spots in progress, Plan/DayPage deferred = path-risky store migration), plus the `TOUCHUP_PUNCHLIST` fidelity pass.

## Dead-vocabulary crosswalk

| You might still say… | It actually means |
|---|---|
| "Phase 4" | **Stage 4 — v1 Ship** |
| "3.77" | **Stage 3 — Multi-City** (geo-refactor) |
| "3.78" | **Stage 3 — Multi-City** (city #2 = SF & East Bay) |
| "the GRIND / PHASE2 work" | **Stage 1 — Reference Finish** (per-screen pass) |
| Sprints A–Y · Waves 1–4 · Phases 1–3 · 3.5 / 3.6 · 3.71–3.76 · 3.7P-* | **shipped — history** |

---

## Doc registry

### 🟢 LIVE — the plan + current execution
| Doc | Purpose |
|---|---|
| **[ROADMAP.md](ROADMAP.md)** | ⭐ The master plan. The Stage spine, binding contracts, current status. **Authority.** |
| [INDEX.md](INDEX.md) | This map. |
| [BACKLOG.md](BACKLOG.md) | v1/v2 idea intake + triage. |
| [STAGE1_PUNCHLIST.md](STAGE1_PUNCHLIST.md) | Stage 1 fidelity punch list (8 batches). |
| [TOUCHUP_PUNCHLIST.md](TOUCHUP_PUNCHLIST.md) | Overnight-grind fidelity/wiring fixes (current branch). |
| [PROFILE_GRIND.md](PROFILE_GRIND.md) · [PROFILE_PHASE2.md](PROFILE_PHASE2.md) | Profile landing + 8 sub-screens (active). |
| [HOME_GRIND.md](HOME_GRIND.md) · [HOME_PHASE2.md](HOME_PHASE2.md) | Home landing + 7 destinations (done). |
| [EVENTS_GRIND.md](EVENTS_GRIND.md) · [EVENTS_PHASE2.md](EVENTS_PHASE2.md) | Events landing + flow destinations (done). |
| [SPOTS_GRIND.md](SPOTS_GRIND.md) · [SPOTS_PHASE2.md](SPOTS_PHASE2.md) | Spots landing + flow destinations (active). |
| [PLAN_GRIND.md](PLAN_GRIND.md) · [PLAN_PHASE2.md](PLAN_PHASE2.md) | DayPage 3-daypart + flows — **deferred** (path-risky store migration). |
| [TINDER.md](TINDER.md) | "Tune your taste" swipe module on Events + Spots (queued, v1). |

### 🔵 REFERENCE — durable specs (consult, don't execute)
| Doc | Purpose |
|---|---|
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | ⭐ The locked design-system canon (Stage A6): warm palette, the 4 bent-rules policy + honesty bar, the token primitives (elevation/radius/chip/eyebrow/type), motion policy, emoji-for-identity-only, the D1–D8 decisions. **Authority for design primitives.** |
| [UI_SPEC.md](UI_SPEC.md) | Hot-feed / chips / motion / calendar build spec (layered rounds). _Palette superseded by DESIGN_SYSTEM.md (warm, not the old teal `--accent`)._ |
| [CALENDAR_BRIEF.md](CALENDAR_BRIEF.md) | "Your Calendar" Model C design brief + the 12-item anti-gamification ban list. |
| [DATA_SOURCES.md](DATA_SOURCES.md) | Verified **event** data sources for the finder. |
| [PLACES_SOURCES.md](PLACES_SOURCES.md) | **Places/spots** data-source plan (OSM + gov ArcGIS). |
| [REFRESH.md](REFRESH.md) | Operator runbook for refreshing events data. |
| [README-TEST.md](README-TEST.md) | The `npm test` smoke harness (5 blocks). |

### ⚪ HISTORICAL — superseded, banner-ed, kept for history
| Doc | Was | Why kept |
|---|---|---|
| [PLAN.md](PLAN.md) | Gen 1 — Sprints A–F | First day-3 plan. |
| [MASTER_PLAN.md](MASTER_PLAN.md) | Gen 2 — Waves / Sprints G–N | |
| [MASTER_PLAN2.md](MASTER_PLAN2.md) | Gen 3 — Phases 1–4 / Sprints O–Y | Source of "Phase 4"; rich as-built log. |
| [PHASE_3.5.md](PHASE_3.5.md) | Gen 4 — Phase 3.5 (W1–W8) | |
| [PHASE_3.6.md](PHASE_3.6.md) | Gen 4 — Phase 3.6 (N1–N5) | |
| [PHASE_3.7.md](PHASE_3.7.md) | Gen 4 — 3.71–3.78 + addenda | **Still holds the live multi-city build packet** (Addendum I → lifted into ROADMAP Stage 3). |
| [W5_W8_PROPOSAL.md](W5_W8_PROPOSAL.md) | Gen 4 satellite | Ratified into 3.6. |
| [LONG_TERM.md](LONG_TERM.md) | the old backlog | Triaged into [BACKLOG.md](BACKLOG.md). |

_Not planning docs: `app/README.md`, `finder/output/{events,places}.md` (generated data digests)._

---

## House rules (project-cop conventions)
1. **One spine.** New work is named by Stage. Don't invent a new numbering scheme — extend the Stage model or add to BACKLOG.
2. **ROADMAP is the only plan-of-record.** If a doc and ROADMAP disagree, ROADMAP wins. Superseded docs get a banner, never silent deletion.
3. **Ideas go to BACKLOG**, tagged `v1` or `v2`. v2 ideas worth developing get a spec in `/planning/v2/` — built in parallel, never polluting the v1 plan.
4. **This chat (project cop) edits markdown + folders only — never app code.**
