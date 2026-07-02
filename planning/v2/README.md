# /planning/v2 — the v2 workshop

> **Purpose:** a place to develop **v2 ideas into real specs while v1 is still being built** — without touching the v1 plan.
> Nothing here is part of v1. When v1 ships, this folder becomes the opening of the v2 plan.
> Source of ideas = the **v2** section of [../../BACKLOG.md](../../BACKLOG.md). Master plan (v1) = [../../ROADMAP.md](../../ROADMAP.md).

## How it works
1. An idea gets tagged `v2` in [BACKLOG.md](../../BACKLOG.md).
2. When we want to develop it early, it gets its own file here: `planning/v2/<idea>.md`.
3. Each spec carries a **status**: `stub` (one paragraph) → `spec` (scoped, decisions flagged) → `ready` (build-ready when v1 ships).
4. v2 specs may reference v1 code/docs, but **must not add work to any v1 Stage**. If a v2 idea turns out to be needed for launch, the project cop moves it to `v1` in BACKLOG and into a Stage — deliberately, not by accident.

## Specs
| File | Status | One-liner |
|---|---|---|
| [smart-engine.md](smart-engine.md) | stub | App learns (likes/swipe/settings/onboarding) → ties back into event + spot generation + tiering. The v2 centerpiece. |
| [guides-and-rankings.md](guides-and-rankings.md) | stub | Top-10 popular + hidden-gem lists by interest; our own honest rankings → community-influenced (IMDB × Letterboxd × Finch). |

_Next candidates from BACKLOG: more-cities, social-layer, in-app-ticketing._
