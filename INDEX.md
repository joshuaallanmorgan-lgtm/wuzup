# INDEX — the planning-doc map (start here)

> **What this is:** the single map of every planning doc, so we never again wonder "which plan is real?"
> **Current product plan = [planning/v2/V2_PLAN.md](planning/v2/V2_PLAN.md).**
> **v1 as-built authority = [ROADMAP.md](ROADMAP.md).** **Idea intake = [BACKLOG.md](BACKLOG.md).**
> Everything else is execution detail, durable reference, or history.
> Maintained by the project cop. _Established 2026-06-22 · re-synced 2026-07-14 for the GPT handoff._

---

## The one naming spine (lettered Stages — use these words only)

Wuzup v1 was delivered through the **lettered Stage A–E spine** below. Those stages are now the
completed v1 record, not names for new work. Current development follows the V2 core-improvement plan and its
named workstreams in `planning/v2/`; the old numbered Stages (R/1/1.5/2/2.5/3/4) and all
Phase/Sprint/3.7x numbers remain retired history.

| Stage | Name | What it is | Status |
|---|---|---|---|
| **A** | Premium-feel pass | PREMIUM_PUNCH D1–D8 + A1–A6 token/primitive codification | ✅ merged (PR #4) |
| **B** | Patch sprint | V1_PUNCHLIST Batches 1–5 + the never-hide deck-coverage fix | ✅ merged (PR #5) |
| **C** | Deep Sweep | dead-code / perf / a11y / inert tokens / dedup — [STAGE_C.md](STAGE_C.md) | ✅ merged (PR #6) |
| **C.5** | **Cohesion Pass** | the premium gap as 4 whole-cloth passes (data quality · app feel · one visual language · Aurora re-derivation) | ✅ merged (PR #7) |
| **D** | Multi-City | geo-refactor + city #2 = **SF & East Bay (reconfirmed 2026-07-01)** + the two V2 grafts (D-G1 Coverage Card, D-G2 stable event IDs) | ✅ merged (PRs #8–#13) |
| **E** | v1 Ship | PWA/dark/attribution (PRs #9/#10) · deploy topology + refresh automation · final path-trace + shippability REFUTE — [STAGE_E.md](STAGE_E.md) | ✅ merged (PR #14, `f3a9589`) · production repair verified 2026-07-14 |
| **v2** | Core improvement | Trust · relevance · premium existing UI · full-US locations · imagery · feature depth | ▶ **current plan** — [V2_PLAN.md](planning/v2/V2_PLAN.md) |

**Where we are right now (2026-07-14):** v1 code is complete through Stage E. PR #14 merged at
`f3a9589`; the repository is now `joshuaallanmorgan-lgtm/wuzup`. A post-rename Pages artifact briefly
referenced the old `/cj/*` base and rendered blank; a fresh deploy was dispatched and both production
builds are verified in a real browser at `/wuzup/` and `/wuzup/sf/`, with city-specific data and no
console errors. The weekly refresh workflow opens test-gated PRs and its first scheduled-cycle proof
is still outstanding. Current work is the handoff closeout plus the first bounded post-ship fixes;
V2's core-improvement plan is the plan of record. Human-only follow-up remains the supervised SF imagery pass.

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

### 🟢 LIVE — current plan + intake
| Doc | Purpose |
|---|---|
| **[planning/v2/V2_PLAN.md](planning/v2/V2_PLAN.md)** | ⭐ Current product plan. Trust, relevance, premium existing UI, United States coverage, imagery, and feature depth. **Authority for forward product work.** |
| [planning/v2/V2_SPRINTS.md](planning/v2/V2_SPRINTS.md) | ⭐ Active dependency-gated execution map and receipt ledger from trust through full-US V2.0 release. |
| [planning/v2/V2_COORDINATION.md](planning/v2/V2_COORDINATION.md) | Archived five-task coordination experiment; lane boundaries remain reference material. |
| **[ROADMAP.md](ROADMAP.md)** | Completed v1 road and as-built authority: Stage spine, binding contracts, rulings, and delivery record. |
| [INDEX.md](INDEX.md) | This map. |
| [BACKLOG.md](BACKLOG.md) | Post-v1 idea intake, operational closeout, and v2 triage. |
| [planning/v2/README.md](planning/v2/README.md) | V2 workstream registry and spec-status rules. |
| [ADVERSARIAL_AUDIT_2026-07-14.md](ADVERSARIAL_AUDIT_2026-07-14.md) | Primary V2 risk evidence: release blockers, product/data/UI findings, launch gates, and builder backlog. |

### ✅ COMPLETED v1 execution records
| Doc | Purpose |
|---|---|
| **[STAGE_C.md](STAGE_C.md)** | Stage C Deep Sweep execution record (shipped via PR #6). |
| **[STAGE_D.md](STAGE_D.md)** | Stage D Multi-City execution record (shipped via PRs #8–#13). |
| **[STAGE_E.md](STAGE_E.md)** | Stage E v1 Ship as-built and operational-closeout record: `/wuzup/` topology, workflows, ship gates, rename repair, and remaining first-cycle proof. |

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
| [PHASE_3.7.md](PHASE_3.7.md) | Gen 4 — 3.71–3.78 + addenda | Historical source for the shipped Stage-D packet (Addendum I / §15); Addendum G is absorbed by the Quality Engine spec. |
| [W5_W8_PROPOSAL.md](W5_W8_PROPOSAL.md) | Gen 4 satellite | Ratified into 3.6. |
| [LONG_TERM.md](LONG_TERM.md) | the old backlog | Triaged into BACKLOG. |
| [planning/v2/V2_VISION.md](planning/v2/V2_VISION.md) | Fable Day Engine plan | Nonbinding concept archive; optional product ideas are V3 suggestions. |
| [PREMIUM_PUNCH.md](PREMIUM_PUNCH.md) | Stage A source doc | §0 D1–D8 record; §2 promoted into DESIGN_SYSTEM. ⚠️ §1's checkboxes under-report ship-state (~11 shipped items unticked) — trust §0's reconciliation + render checks, not §1 boxes. |
| [V1_PUNCHLIST.md](V1_PUNCHLIST.md) | Stage B execution doc | Shipped (PR #5); the house execution style exemplar. |
| [STAGE1_PUNCHLIST.md](STAGE1_PUNCHLIST.md) · [TOUCHUP_PUNCHLIST.md](TOUCHUP_PUNCHLIST.md) | Stage-1-era punch lists | Shipped. |
| `*_GRIND.md` · `*_PHASE2.md` (Profile/Home/Events/Spots/Plan) | Stage-1-era per-screen pass | Shipped; record which reference each screen was matched against. |
| [FLOWS_GRIND.md](FLOWS_GRIND.md) · [EVENTS_GRIND.md](EVENTS_GRIND.md) etc. | (same family) | |

_Not planning docs: `app/README.md` and `finder/output/{events,places}.md` (generated data digests)._

---

## House rules (project-cop conventions)
1. **One current spine.** Forward product work follows `planning/v2/V2_PLAN.md`; A–E remain the completed v1 vocabulary.
2. **Authority is time-scoped.** `ROADMAP.md` wins for v1 as-built facts; `V2_PLAN.md` wins for forward product planning. Superseded docs get a banner, never silent deletion.
3. **Ideas go to BACKLOG.** Material v2 ideas get a spec in `/planning/v2/` and an explicit status before implementation.
4. **Execution plans live in repo docs** (STAGE_C.md-style), never only in session prompts — a stage's granular plan must survive any session's death.
5. **Doc edits ship with the work.** Status headers (this file + ROADMAP's completion/current-plan headers) update in the same commit that changes the status.
