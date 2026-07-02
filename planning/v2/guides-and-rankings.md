# v2 spec — Guides & Rankings (curation as a product)

> **Status: stub.** Source: Josh brain-dump 2026-06-22. Home: [../../BACKLOG.md](../../BACKLOG.md) (v2). Not v1 (v1 ships a *lite* version — see bottom).
> Honesty contracts bind: rankings must be **honest and sourced** (no fabricated "#1 best"); show-all; hidden gems per the thesis.

## The discovery thesis — 3 ways people find stuff
The product organizes discovery around three modes. Guides serve modes 2 & 3; the [smart-engine](smart-engine.md) serves mode 1.

1. **Recommended for you** — based on what the app knows about you + what's going on. *(→ [smart-engine](smart-engine.md))*
2. **Hidden gems you may like** — surfacing the under-the-radar stuff that fits your taste.
3. **Popular + hidden, together** — both the well-known things you'd want to know about **and** the hidden gems you *haven't* heard of but should. *(the core "field guide" promise)*

## What we're building
> "Build in the guides for sure next round… really incorporate the 'here are the top 10 beaches in Florida' type of thing — apps finding the most popular stuff for you **plus** some hidden gems, per the thesis."

- **Curated lists by interest:** "Top 10 beaches," "Top 10 *hidden* beaches," top dog parks, best sunset spots, etc. — both a **popular** cut and a **hidden-gem** cut of each topic.
- **Browsable + deep:** the user can pull up a list for any interest, and we go *deep* on it — not a thin filter, an editorial ranking with a point of view + per-pick reasoning.
- **Our own rankings first:** start as honest, sourced rankings we compose (corroboration across sources + amenities + designation + distance — the existing evidence-layer idea).
- **Community-influenced later:** evolve so **users help shape the rankings** (votes/ratings/reviews) — the app becomes a living ranking, not a static list.

## The north-star analogy
> **IMDB × Letterboxd × Finch.** The "second app to take ideas from": ratings, lists, reviews, and community-driven rankings (IMDB/Letterboxd) fused with Finch's gentle, personal, do-things-in-real-life loop. Long-term, this is what makes the app genuinely useful and sticky, not just a directory.

## Open decisions (for later)
- Our-own-rankings vs. citing/aggregating external "best of" lists (honesty: cite the real source, don't launder it).
- How community influence works without becoming gameable (moderation, weighting, provenance).
- Where guides live (Home modules vs a dedicated surface vs inside Spots) — PHASE_3.7 §5 deferred a "Guides tab" until guides prove out.
- Data dependency: deep rankings are **blocked on the finder enriching amenities/signal** (the FB-A data gap) — sequence accordingly.

## Prior art already in the repo (don't reinvent)
- PHASE_3.7 §4–6 — **Smart Groups / "Guides"** (three flavors: intention / moment / sourced-ranking) + the GuideCard→GuidePage primitive + `guides.json` editorial layer.
- PHASE_3.7 Addendum G — **Activity Evidence Layer** (the honest scoring tiers: candidate / recommended / top).
- LONG_TERM "True comprehensiveness" + "Social layer" — the community-rankings end-state overlaps the parked social product.

## Relation to v1
**v1 = guides-lite:** a few hand-curated guide pages (the Stage 1.5 "Guides" item — source real guides/rankings, roll out the guide-page design). **v2 = this** — the deep, interest-driven, eventually-community-ranked system. Developed early here; never adds work to a v1 Stage unless promoted.
