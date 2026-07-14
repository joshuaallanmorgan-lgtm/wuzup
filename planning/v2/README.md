# /planning/v2 — the V2 plan and workstream registry

> **Current plan of record:** [V2_VISION.md](V2_VISION.md).
> V1 is shipped; [../../ROADMAP.md](../../ROADMAP.md) is its as-built history. New ideas enter
> [../../BACKLOG.md](../../BACKLOG.md). A supporting spec may propose a workstream, but cannot expand
> the ratified plan or resolve an owner decision by itself.

## How it works

1. [V2_VISION.md](V2_VISION.md) owns the product spine, rulings, release shape, and V2/V3 boundary.
2. Supporting specs explain a workstream and flag decisions; they do not become binding by being detailed.
3. Each spec carries a status: `stub` → `spec` → `ready` → `building` → `shipped`.
4. Implementation begins when its material rulings are resolved, or when it is an explicitly bounded
   post-ship hardening fix that does not pre-empt a product choice.
5. Code, current artifacts, reproducible tests, and repo-visible decision records outrank stale prose.

## Specs

| File | Status | One-liner |
|---|---|---|
| [V2_VISION.md](V2_VISION.md) | **current** | The Day Engine: Compose → Decide → Keep; Layer Zero first; Reach/City Foundry in parallel. |
| [smart-engine.md](smart-engine.md) | stub · rescope pending | On-device taste signals → bounded personal reorder/tiering over a quality-ordered base. |
| [guides-and-rankings.md](guides-and-rankings.md) | stub | Honest popular + hidden-gem lists by interest; deeper successor to shipped guides-lite. |
| [quality-engine.md](quality-engine.md) | spec · pending ratification | Proposed build-time corpus-quality stage and candidate mechanism for the binding quality gate. |
| [premium-ui.md](premium-ui.md) | spec · threshold pending | Proposed Feel Substrate for shared motion/touch/material/loading/ceremony grammar. |

_Reach is already mandated in V2_VISION §10. Social/community and ticketing remain unscheduled ideas._
