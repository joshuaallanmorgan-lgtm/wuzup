# v2 spec — The Smart Engine (learning → ranking/tiering)

> **Status: stub** (the v2 centerpiece). Source: Josh brain-dump 2026-06-22. Home: [../../BACKLOG.md](../../BACKLOG.md) (v2). Not v1.
> Honesty contracts still bind: **taste reorders, never filters** · show-all · no fake data/signals.

## Why this is the whole point of v2
> "The MVP is the MVP, but we need to make the app actually feel smart and useful and like it's giving you good events. That's the real point, where it becomes useful rather than just a UI with an idea."

v1 shipped a good **UI + finder**. v2 makes it **intelligent**. This is mostly *invisible* work — no new screens — but it's what turns "a clean events directory" into "an app that knows what I'd actually want to do." Highest-leverage post-MVP investment.

## Two coupled halves (build together — one feeds the other)

### A. The learning layer (input — barely exists today)
Capture and actually *use* every real signal of taste:
- **Explicit:** the **swipe deck** (Calibration + DayFill — "very important"), likes/saves, the onboarding answers, the Settings taste controls.
- **Implicit:** what they open, plan, mark "been there," dwell on.
Today this is thin (light reorder only). v2 builds a real, durable **taste model** from these signals — and keeps it honest (privacy-first, on-device-leaning, no creepy inference).

### B. Ranking + tiering (output — tie it back to generation)
> **Proposed seam (pending Josh ruling — [quality-engine.md](quality-engine.md) §0/§13.10):** objective corpus scoring/tiering =
> the Quality Engine's build-time lane; this spec owns bounded per-user, on-device reordering on top
> of the quality-ordered base — which is also the cold-start answer. Zero-backend makes per-user
> builds impossible, so "feed back into generation" below narrows to per-user ordering — **pending
> Josh ruling (quality-engine §13.10)**.
- **Tier the feed:** a strong **best 10–20** at the top, then **everything else** below — never hidden (never-hide contract = tiers, not filters).
- **Close the loop:** feed the taste model *back into* event **and** spot selection/ordering — not just a cosmetic re-sort. The engine should change *which* things surface and *in what order*, per person, per moment (time, weather, history).
- Applies to **both engines** — events (time-based) and spots (evergreen).

**The loop:** signals → taste model → tiered/reordered feed (best-first, all-present) → better picks → more signal. The flywheel that makes it feel smart.

## First visible surface to restyle
- **Tinder / swipe UI redesign** — "the first thing that'll need to look different" once the engine is real. The v1 `TINDER.md` module is already shipped; v2 re-skins/expands it to match the smarter engine. (Split per [premium-ui.md](premium-ui.md) §3.S9: deck **content/reskin** = this spec; deck **motion/gesture substrate** = the Feel Substrate.)

## Open decisions (for later)
- How explicit vs implicit should tuning feel? (visible sliders vs silent behavioral learning vs both)
- Cold-start: what does a brand-new user get before there's signal? **Resolved: the quality-ordered feed (quality-engine §7).**
- On-device model vs backend? (privacy contract pushes on-device)
- How much of "tie back to generation" is re-ranking the existing finder output vs. influencing the finder itself? **Resolved seam: influencing the finder = quality-engine's lane; this spec = re-ranking (ruling §13.10 pending).**

## Prior art already in the repo (don't reinvent)
- `taste.js` / TastePanel / CalibrationDeck / InterestEditor (the v1 thin version).
- PHASE_3.7 Addendum G — **absorbed into [quality-engine.md](quality-engine.md)**; the ranking half's objective substrate lives there now.
- LONG_TERM "Event ranking & tiers (the infinite list)" + "Personalization" — folded into this spec.

## Relation to v1
v1 shipped the *thin* version (taste lightly reorders; swipe deck collects signal). This spec is a
**post-launch headline build**; its quality/personalization seam and narrowed "tie back" ambition
remain pending Josh's ruling before promotion to `ready`.
