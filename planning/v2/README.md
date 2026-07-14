# /planning/v2 — V2 plan and supporting specs

> **Current plan of record:** [V2_PLAN.md](V2_PLAN.md).
> V1 is shipped; [../../ROADMAP.md](../../ROADMAP.md) is its as-built history. New ideas enter
> [../../BACKLOG.md](../../BACKLOG.md), but optional feature concepts stay suggestions/V3 unless the
> current plan explicitly admits them.

## How it works

1. [V2_PLAN.md](V2_PLAN.md) owns scope, ordering, acceptance gates, and the V2/V3 boundary.
2. [V2_COORDINATION.md](V2_COORDINATION.md) owns the five-chat operating model and merge dependencies.
3. Supporting specs explain implementation details but cannot expand V2 by themselves.
4. Each spec carries a status: `draft` → `evaluating` → `ready` → `building` → `shipped`.
5. A new product concept goes to V3 until Josh explicitly promotes it.
6. Code, current artifacts, reproducible tests, and repo-visible decision records outrank stale prose.

## Specs

| File | Status | One-liner |
|---|---|---|
| [V2_PLAN.md](V2_PLAN.md) | **current** | GPT hardening plus relevance, premium existing UI, full-US locations, imagery, and bounded feature enrichment. |
| [V2_COORDINATION.md](V2_COORDINATION.md) | ready | Architect/control-room packet for H0, E0, U0, I0, and L0. |
| [V2_VISION.md](V2_VISION.md) | archive | Fable Day Engine concept research; optional product ideas are nonbinding/V3. |
| [smart-engine.md](smart-engine.md) | stub · rescope pending | On-device taste signals → bounded personal reorder/tiering over a quality-ordered base. |
| [guides-and-rankings.md](guides-and-rankings.md) | stub | Honest popular + hidden-gem lists by interest; deeper successor to shipped guides-lite. |
| [quality-engine.md](quality-engine.md) | draft | Useful corpus-quality research; deterministic phases lead and model assumptions require rebaselining. |
| [premium-ui.md](premium-ui.md) | draft | Existing-surface feel work is V2; ceremonies/layouts for archived features are V3 with those features. |

_Primary audit evidence: [../../ADVERSARIAL_AUDIT_2026-07-14.md](../../ADVERSARIAL_AUDIT_2026-07-14.md). Specs still needed: `us-coverage.md` and `imagery.md`._
