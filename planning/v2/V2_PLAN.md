# Wuzup V2 — GPT migration and core-product improvement

> **Status: current plan of record · 2026-07-14**
>
> Josh's latest direction supersedes the mandatory release scope in
> [V2_VISION.md](V2_VISION.md), which is retained as nonbinding concept research. Optional new
> products are suggestions only. V2 improves the product that already exists.

## V2 contract

V2 succeeds when Wuzup shows people substantially better events and spots, feels premium across its
existing flows, works honestly anywhere in the United States, and carries much richer real imagery.

V2 admits work that:

1. hardens the shipped app or completes the Claude/Fable-to-GPT handoff;
2. improves event/spot ingestion, quality, selection, ranking, or explanation;
3. improves an existing surface's UX, UI, accessibility, responsiveness, performance, or finish;
4. deepens an existing feature using the improved engines;
5. expands honest United States location coverage;
6. adds truthful, licensed, verified imagery or more reliable image delivery; or
7. is a bounded quick win that advances one of those outcomes without delaying a core track.

New product loops, social/accounts systems, backend-dependent features, and elaborate ceremonies are
V3 suggestions unless Josh explicitly promotes them.

V1 contracts still bind: never fabricate; taste changes the lead set but never makes legitimate
inventory unreachable; sponsorship never boosts quality; real-place photos show the actual place and
are credited; sparse coverage is described honestly.

## Verified starting point

- `main` is at `f3a9589`, the merged Stage E ship PR. The renamed `wuzup` repo deploys healthy Tampa
  and SF builds at `/wuzup/` and `/wuzup/sf/`.
- The app is static React/Vite plus a Node build-time finder. Shipped runtime code does not depend on
  Claude, Anthropic, GPT, or another provider. This handoff is mainly knowledge, process, evidence,
  and tooling migration.
- Current artifacts contain 1,642 Tampa events / 2,163 places and 743 SF events / 2,888 places. Event
  image fields cover 87.6% / 91.3%, mostly as external hotlinks. Real place-photo coverage is only
  6.4% / 6.1%.
- The default local `app/public/events.json` differs from the current Tampa finder artifact and lacks
  stable IDs. Production stages data through `deploy.mjs`, but local dev can show stale data unless a
  city is staged first.
- The source-task baseline initially passed 125/126 checks because the reduced live finder set
  contained no future cross-source duplicate. That corpus coincidence is now diagnostic, while a
  deterministic two-family fixture pins merge behavior. It reached 127/127 there; after integrating
  the handoff-closeout additions, the current Gate Zero baseline passes 129/129.
- Live mobile review found a coherent shell but weak lead content and finish seams: low-value business
  and institutional rows lead; time labels repeat; copy truncates; tuning dominates Events and Spots;
  Spots says “Find your night”; Plan opens as “Calendar”; inactive tabs remain in the accessibility
  tree; and misleading “near you” / “worth the drive” claims are not backed by their selectors.
- This file is now the canonical V2 scope, but the handoff edits are still uncommitted, several draft
  specs remain model-specific, and some evidence exists only in inaccessible prior-agent workflows.

## Workstreams

### H — GPT migration and hardening

- Make this plan the forward authority; mark Stage E as history and the Fable vision as an archive.
- Reproduce useful prior conclusions as repo-visible fixtures, benchmarks, and decision records.
- Remove model names, pricing, cache assumptions, and provider behavior from binding specs.
- Establish one green verification command, one city-staging/dev command, and artifact metadata with
  city, run ID, generated time, schema version, hashes, and source health.
- Prove the scheduled refresh PR and deploy end to end. Reject stale, mixed-city, partial, unapproved,
  or schema-invalid artifacts.
- Rebaseline quality, sources, categories, duplicates, images, payloads, accessibility, and UI paths.

**Exit:** deterministic green tests; reproducible builds for both cities; current docs agree; deploy
and refresh have evidence; no implementation depends on missing prior-agent context.

### E — Event and spot quality/relevance

Keep three layers separate:

1. **Corpus quality:** source health, freshness, time/status/price/location validation,
   canonicalization, dedupe, series, taxonomy, and legitimate-item floor.
2. **Objective selection:** quality, substance, evidence, context fit, diversity, tiers, and short
   reasons. Replace overloaded `hotScore`; image presence is presentation, not quality.
3. **Personal relevance:** a bounded explainable on-device ranker using existing onboarding,
   interests, saves, plans, deck verdicts, went/skipped feedback, daypart, price, distance, weather,
   novelty, and repetition.

Build deterministic logic first. A cached fail-closed GPT judgment gate is admitted only if a frozen
eval proves that rules cannot meet the bar and the model materially improves precision. Code owns
facts, caps, tiers, final order, and reachability.

Home, Tonight, Event shelves, browse, search defaults, guides, decks, Plan, Spots, and activities use
one rank contract. A surface may filter for context; it may not invent another quality model.

**Proposed acceptance:**

- zero cancelled, ended, wrong-market, non-event/non-place, known-junk, or known false-merge rows in a
  sampled top 50 per flagship city;
- at least 85% agreement with a frozen human event/spot pairwise set;
- at least 90% primary-category accuracy on 200 labeled events and `other` at or below 5%;
- false merges at or below 1% and surviving duplicates at or below 3% on 100 audited clusters;
- strong positive/negative preference moves at least four matching items in/out of the actual first
  20, with no category or source owning more than half of an unfiltered top 20;
- every legitimate row stays reachable; and
- Spots labels describe real math: radius for “near,” a quality floor for “recommended,” and measured
  quality-over-distance for “worth the drive.”

### U — Premium UI on existing surfaces

- Refine Home, Events, Spots, Plan/Day, cards, details, deck, Search, Guides, Saves, Profile, Settings,
  sheets, and loading/error/empty states.
- Fix truth and hierarchy before ornament: useful leads, accurate labels, no duplicate metadata,
  graceful long copy, and the right primary action.
- Finish one motion/touch/focus/loading grammar, one icon language, and one navigation model.
- Remove inactive pager views from the accessibility tree; verify focus, keyboard/switch paths,
  contrast, targets, reduced motion, and screen-reader names.
- Test representative small/standard mobile widths and desktop without inventing a new desktop product.

**Exit:** every existing path passes visual, behavioral, accessibility, error/empty, light/dark, and
responsive review with no console errors or measurable performance regression; Josh confirms it reads
as one premium product.

### L — Full United States locations

“Full US” means any US location can resolve and Wuzup tells the truth about what it knows there. It
does not mean pretending every location has flagship depth.

- Replace one-build-per-city assumptions with a runtime coverage manifest and region-sliced loader.
- Make the Coverage Card the contract: sources, counts, freshness, imagery, and thin/not-covered state
  are derived.
- Ship a nationwide honest floor early, then deepen metros through reusable platform adapters and
  per-location configs.
- Scope adapters before loading; add fixture contracts, health bands, politeness controls, cross-city
  guards, payload budgets, timezone/weather routing, and atomic manifest publication.
- Pilot diverse inland, small, and data-poor markets before extrapolating Tampa/SF economics.
- Resolve hosting, refresh cadence, API/ToS posture, and imagery storage before a mass city ramp.

**Exit:** all 50 states plus DC resolve in one runtime system; every location exposes honest coverage
and freshness; thin locations degrade usefully; no cross-city contamination; metro depth no longer
requires bespoke app code. Global is V3.

### I — Honest imagery expansion

- Complete the supervised SF Mapillary/gazetteer work owed from Stage E.
- Report coverage by city, category, source, quality tier, and visible surface.
- Expand actual-place licensed sources: Commons/Wikimedia, verified Mapillary, compatible government
  and operator sources, and permitted first-party media.
- Verify identity/attribution fail-closed; prioritize visible top-tier items while growing breadth.
- Validate, deduplicate, and detect generic/repeated event art; resize/proxy/self-host only where terms
  and licensing permit.
- Keep image availability out of quality scoring; excellent photoless items get premium honest art.

**Proposed acceptance:** reliable/self-hosted or verified-fallback imagery on at least 95% of top-tier
events; real photos on at least 70% of top-tier and 25% of all flagship spots; zero wrong-place or
uncredited images in a 100-image audit. Thin national locations publish their true level.

### F — Enrich existing features

- **Plan/Day:** better suggestions, reasons, reroll, and weather/distance/taste fit in the existing flow.
- **Deck/taste:** better dealing, signed feedback, transparency, and a premium existing-deck reskin.
- **Home/Events/Spots:** relevant, diverse shelves whose names match their selectors.
- **Guides-lite:** richer covers, sourced reasoning, honest language, and real item resolution.
- **Search/Saves/Profile:** kind-correct rendering, better current intent, and use of existing state to
  improve recommendations.

Community rankings, runtime LLM concierge, Passport/Vault/recaps, and social identity are V3.

## First execution queue

### H0 — close the handoff

1. Reconcile and commit planning drafts separately from engine code.
2. Make tests deterministic, stage current data before dev, and add immutable run metadata plus a
   stale/hash deploy guard.
3. Observe the first scheduled refresh PR and resulting deploy.
4. Produce baseline quality, source, category, dedupe, image, payload, accessibility, and UI reports.

### E0/U0/I0/L0 — start the product tracks together

1. Label frozen event/spot rank and dedupe fixtures; evaluate actual screens, not surrogate lists.
2. Capture discarded organizer/status/price/category/source/image/OSM signals and snapshot history.
3. Fix deterministic top-shelf defects; implement decomposed quality and one rank API.
4. Ship bounded existing-UI trust and finish fixes during engine work.
5. Add imagery reporting and complete the SF image work.
6. Prototype the runtime location manifest/loader and adapter boundary before mass expansion.

### E1/F0 — connect intelligence to the product

1. Route every existing shelf through the common ranker and add signed bounded personalization.
2. Give Spots a real activity/amenity/quality/distance model.
3. Enrich Plan, deck, guides, saves, and search from the same context and reasons.
4. Pilot the national floor and a diverse metro cohort; grow imagery with visible inventory.

## Quick-win lane

A quick win is bounded, reversible, testable, needs no standing service, improves an existing V2
outcome, and does not bypass planned architecture. Audited candidates, to reverify first:

- distinguish failed loading from genuinely empty results;
- add immutable generated time, run ID, source health, hashes, and stale-snapshot refusal;
- stage a selected city before local dev;
- repair the complete add-to-plan → My Plans lifecycle;
- correct filters, repeated time labels, Spots/Plan copy, and misleading location claims;
- make inactive pager pages `inert`/`aria-hidden`;
- make Saves kind-correct and remove/complete visible placeholder controls;
- fix taste dependencies and route headline shelves through the common ranker;
- emit discarded organizer/status/category/source/image-rank/OSM-brand signals;
- keep chains/generic facilities off gem shelves without hiding legitimate places;
- stop loading Florida-only place adapters in other-city runs; and
- complete the supervised SF imagery pass.

## V3 suggestions

- Productized “Give me a Saturday,” Weekend Brief, Tonight Board, and Plan-tab takeover.
- Couch/async co-swipe, Who's In, Pass-the-Day, and Crew Relay.
- Passport, stamps, quests, Year recaps, Reality Ledger, Vault, and Memory Sync.
- Accounts, friends, reviews, comments, community rankings, feeds, and user-photo moderation.
- Runtime LLM concierge, push-digest product, in-app ticketing, map revival, Trip Mode, global
  expansion, elaborate ceremonies, and new big-canvas product layouts.

Small improvements to an existing flow can return to V2 only if they independently satisfy the
admission rules above.

## GPT-era operating rules

1. The repo is durable memory: decisions, fixtures, prompts, evals, and status survive a session or
   model change.
2. Verify code and current artifacts before trusting prose.
3. Keep requirements provider-neutral. If GPT is selected, pin model ID, rubric, prompt hash, cost,
   and eval result in an implementation record.
4. Deterministic logic owns facts and reachability. Model judgment is optional build-time evidence,
   cached, versioned, schema-validated, and fail-closed.
5. Every workstream ships with a baseline, acceptance test, and concise before/after report.
6. A draft cannot expand scope. Optional concepts stay V3 until explicitly promoted.

## Owner decisions to schedule, not block H0

- Ratify the relevance/gem rubric after representative Tampa and SF examples are labeled.
- Approve national-source API/ToS posture before scale crawling or paid-key work.
- Approve image licensing policy and any proxy/storage budget.
- Choose post-spike hosting for one runtime app plus national artifacts.
- Ratify numeric image/ranking targets after the first eval if proposed gates prove unrealistic.
