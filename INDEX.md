# INDEX — the planning-doc map (start here)

> **What this is:** the single map of every planning doc, so we never again wonder "which plan is real?"
> **The one master plan = [ROADMAP.md](ROADMAP.md).** **Idea intake = [BACKLOG.md](BACKLOG.md).** Everything else is execution detail, durable reference, or history.
> Maintained by the project cop. _Established 2026-06-22 · re-synced 2026-07-01 (Fable 5 takeover)._

---

## The one naming spine (lettered Stages — use these words only)

All forward work is named by **lettered Stage** (ROADMAP's A–E road). The old numbered Stages (R/1/1.5/2/2.5/3/4) and all Phase/Sprint/3.7x numbers are **retired to history** (kept on disk, banner-ed, not executed from).

| Stage | Name | What it is | Status |
|---|---|---|---|
| **A** | Premium-feel pass | PREMIUM_PUNCH D1–D8 + A1–A6 token/primitive codification | ✅ merged (PR #4) |
| **B** | Patch sprint | V1_PUNCHLIST Batches 1–5 + the never-hide deck-coverage fix | ✅ merged (PR #5) |
| **C** | Deep Sweep | dead-code / perf / a11y / inert tokens / dedup — [STAGE_C.md](STAGE_C.md) | ✅ merged (PR #6) |
| **C.5** | **Cohesion Pass** | the premium gap as 4 whole-cloth passes (data quality · app feel · one visual language · Aurora re-derivation) — ROADMAP §CURRENT | 🔨 **current** (branch `cohesion/pass`; rulings + back-button + deck physics ✅; finder/Aurora/Detail in flight) |
| **D** | Multi-City | geo-refactor + city #2 = **SF & East Bay (reconfirmed 2026-07-01)**; imagery pre-banked | 📋 specced (PHASE_3.7 Addendum I) |
| **E** | v1 Ship | holistic pass vs all refs · honesty audit · PWA/deploy/attribution · beta | ⏳ |
| **v2** | Backlog | everything post-launch | → [BACKLOG.md](BACKLOG.md) |

**Where we are right now:** the **Cohesion Pass (Stage C.5) is COMPLETE on branch `cohesion/pass`** — all four workstreams merged + 5-lens REFUTE-verified — awaiting Josh's eyeball via the Cohesion PR. Stage C merged earlier (PR #6). Next: Stage D Multi-City ([STAGE_D.md](STAGE_D.md)). **Fable 5 resumed leadership 2026-07-01** (single-session driver's seat; Josh's 10 rulings in ROADMAP §5).

## Dead-vocabulary crosswalk

| You might still say… | It actually means |
|---|---|
| "Stage R / Stage 1 / the GRIND / PHASE2 work" | shipped history (the reference-finish era, pre-Stage-A) |
| "Stage 2" (numbered) | **Stage C — Deep Sweep** |
| "Stage 2.5 / Lamination / premium polish" | **Stage C.5 — Cohesion Pass** |
| "Stage 3" / "3.77" / "3.78" | **Stage D — Multi-City** |
| "Stage 4" / "Phase 4" | **Stage E — v1 Ship** |
| Sprints A–Y · Waves 1–4 · Phases 1–3 · 3.5 / 3.6 · 3.71–3.76 · 3.7P-* | **shipped — history** |

---

## Doc registry

### 🟢 LIVE — the plan + current execution
| Doc | Purpose |
|---|---|
| **[ROADMAP.md](ROADMAP.md)** | ⭐ The master plan. The Stage spine, binding contracts (§1), the 2026-07-01 rulings (§5), the takeover process (§4). **Authority.** |
| [INDEX.md](INDEX.md) | This map. |
| [BACKLOG.md](BACKLOG.md) | v1/v2 idea intake + triage (incl. the still-empty Tier-0 orphan inventory table — populate during C5). |
| **[STAGE_C.md](STAGE_C.md)** | Stage C execution plan-of-record (recovered kickoff + checkpoint status; shipped via PR #6). |
| **[STAGE_D.md](STAGE_D.md)** | Stage D Multi-City execution plan-of-record (Addendum I packet + the 2026-07-01 pipeline forensics; ⚑D-DEP open). |

### 🔵 REFERENCE — durable specs (consult, don't execute)
| Doc | Purpose |
|---|---|
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | ⭐ The locked design-system canon (Stage A6): warm palette, bent-rules policy + honesty bar, token primitives, motion policy, D1–D8. **Authority for design primitives.** |
| [CARD_LOCK.md](CARD_LOCK.md) | The one canonical left-image editorial card (locked; scoped to the vertical list card only — the deck face is NOT locked). |
| [TINDER.md](TINDER.md) | The swipe module + decks spec (finish-beat line amended 2026-07-01 per ruling 8). |
| [MULTICITY_IMAGERY_RUNBOOK.md](MULTICITY_IMAGERY_RUNBOOK.md) | Per-city imagery operator runbook (manual REFUTE gate is a standing requirement). |
| [UI_SPEC.md](UI_SPEC.md) | Hot-feed / chips / motion spec. _Palette superseded by DESIGN_SYSTEM.md._ |
| [CALENDAR_BRIEF.md](CALENDAR_BRIEF.md) | "Your Calendar" Model C design brief + the anti-gamification ban list. |
| [DATA_SOURCES.md](DATA_SOURCES.md) | Verified **event** data sources for the finder. |
| [PLACES_SOURCES.md](PLACES_SOURCES.md) | **Places/spots** data-source plan (OSM + gov ArcGIS). |
| [REFRESH.md](REFRESH.md) | Operator runbook for refreshing events data. |
| [README-TEST.md](README-TEST.md) | The `npm test` smoke harness. |

### ⚪ HISTORICAL — superseded, banner-ed, kept for history
| Doc | Was | Why kept |
|---|---|---|
| [PLAN.md](PLAN.md) | Gen 1 — Sprints A–F | First day-3 plan. |
| [MASTER_PLAN.md](MASTER_PLAN.md) | Gen 2 — Waves / Sprints G–N | North-star prose. |
| [MASTER_PLAN2.md](MASTER_PLAN2.md) | Gen 3 — Phases 1–4 / Sprints O–Y | Rich as-built log. |
| [PHASE_3.5.md](PHASE_3.5.md) · [PHASE_3.6.md](PHASE_3.6.md) | Gen 4 — shipped | |
| [PHASE_3.7.md](PHASE_3.7.md) | Gen 4 — 3.71–3.78 + addenda | **Still holds the live Stage-D build packet** (Addendum I / §15). |
| [W5_W8_PROPOSAL.md](W5_W8_PROPOSAL.md) | Gen 4 satellite | Ratified into 3.6. |
| [LONG_TERM.md](LONG_TERM.md) | the old backlog | Triaged into BACKLOG. |
| [PREMIUM_PUNCH.md](PREMIUM_PUNCH.md) | Stage A source doc | §0 D1–D8 record; §2 promoted into DESIGN_SYSTEM. ⚠️ §1's checkboxes under-report ship-state (~11 shipped items unticked) — trust §0's reconciliation + render checks, not §1 boxes. |
| [V1_PUNCHLIST.md](V1_PUNCHLIST.md) | Stage B execution doc | Shipped (PR #5); the house execution style exemplar. |
| [STAGE1_PUNCHLIST.md](STAGE1_PUNCHLIST.md) · [TOUCHUP_PUNCHLIST.md](TOUCHUP_PUNCHLIST.md) | Stage-1-era punch lists | Shipped. |
| `*_GRIND.md` · `*_PHASE2.md` (Profile/Home/Events/Spots/Plan) | Stage-1-era per-screen pass | Shipped; record which reference each screen was matched against. |
| [FLOWS_GRIND.md](FLOWS_GRIND.md) · [EVENTS_GRIND.md](EVENTS_GRIND.md) etc. | (same family) | |

_Not planning docs: `app/README.md`, `finder/output/{events,places}.md` (generated data digests), `/planning/v2/` (v2 spec workshop — [planning/v2/README.md](planning/v2/README.md))._

---

## House rules (project-cop conventions)
1. **One spine.** New work is named by lettered Stage. Don't invent a new numbering scheme — extend the Stage model or add to BACKLOG.
2. **ROADMAP is the only plan-of-record.** If a doc and ROADMAP disagree, ROADMAP wins. Superseded docs get a banner, never silent deletion.
3. **Ideas go to BACKLOG**, tagged `v1` or `v2`. v2 ideas worth developing get a spec in `/planning/v2/` — built in parallel, never polluting the v1 plan.
4. **Execution plans live in repo docs** (STAGE_C.md-style), never only in session prompts — a stage's granular plan must survive any session's death.
5. **Doc edits ship with the work.** Status headers (this file + ROADMAP §CURRENT) update in the same commit that changes the status.
