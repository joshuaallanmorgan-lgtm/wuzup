# Wuzup V2 — implementation coordination packet

> **Status:** Gate Zero verified; base commit pending; implementation has not started.
> **Authority:** subordinate to `V2_PLAN.md` and `ADVERSARIAL_AUDIT_2026-07-14.md` once those
> source-task artifacts are integrated into the implementation base.

## 1. Product target

V2 makes Wuzup the fastest, most trustworthy way to find a relevant local event or place and add it
to a real plan. The working first-value target is one credible option and a successful plan action in
roughly one minute.

The five first-class V2 lanes are:

1. **H0 — Trust boundary:** exact artifact identity, freshness, time, city, state, failure, and deploy truth.
2. **E0 — Relevance engine:** deterministic event/spot quality, context, taste, diversity, and reasons.
3. **U0 — Product completion:** premiumize and complete the existing core flows and accessibility.
4. **I0 — Imagery:** truthful, licensed, useful imagery and enrichment with honest fallbacks.
5. **L0 — Locations:** runtime city architecture, City Foundry, and honest United States coverage.

New Day Engine, Passport/ledger, social/co-swipe, accounts, runtime LLM concierge, map revival,
global rollout, and other new product families remain parked unless the owner explicitly promotes one.

## 2. Gate zero — integrate the planning handoff

Before any implementation branch is cut:

- Integrate `planning/v2/V2_PLAN.md` and `ADVERSARIAL_AUDIT_2026-07-14.md` from their source tasks.
- Integrate the supporting registry/archive changes without overwriting concurrent edits.
- Integrate or deliberately supersede the Planner task's deterministic smoke-test correction.
- Run `git diff --check`, the full root test gate, and an app build/lint gate.
- Commit planning/docs separately from test or production-code changes.
- Pin the resulting commit as `V2_BASE_SHA`; every worker chat starts from that exact base.

No worker may infer that a clean checkout in its own task means the source-task changes have landed.

### Gate Zero receipt — 2026-07-14

- Exact `V2_PLAN.md` and adversarial-audit snapshots recovered from their original task logs, including
  every successful correction patch.
- Current-plan pointers reconciled; `V2_VISION.md` is explicitly a nonbinding archive.
- Deterministic merge fixture and its test documentation already present in the handoff-closeout commit.
- `npm test`: **129/129 pass**; root gate includes app lint/build plus Tampa, SF, and base-path builds.
- `git diff --check`: pass.
- Expected H0 diagnostic remains visible: the current default artifact has no matching immutable
  generation stamp, so the ended-at-generation invariant is gated rather than falsely certified.
- Remaining Gate Zero action: commit this planning-only set and record that commit as `V2_BASE_SHA`.

## 3. Five-chat operating model

The current V2 Kickoff chat is the **architect/control room**. The five worker chats own bounded lanes.
Each worker should run in a separate Codex worktree from `V2_BASE_SHA`, using these exact titles and
branches:

| Chat title | Branch | Initial release state |
|---|---|---|
| `V2 H0 — Trust Boundary` | `codex/v2-h0-trust` | **GO** after Gate Zero |
| `V2 E0 — Relevance Engine` | `codex/v2-e0-relevance` | Fixtures/eval/new pure modules may start; runtime wiring waits for H0 contract |
| `V2 U0 — Product Completion` | `codex/v2-u0-product` | Independent UI defects may start; persistence/time wiring waits for H0 contract |
| `V2 I0 — Imagery` | `codex/v2-i0-imagery` | Inventory, policy, and build-time pipeline work may start immediately |
| `V2 L0 — Locations` | `codex/v2-l0-locations` | Adapter inventory and loader prototype may start; artifact schema follows H0 |

After creating the chats, the owner sends their five task IDs to the architect. The architect may then
read progress, send coordination messages, request focused handoffs, identify collisions, and recommend
merge order. Owner rulings remain with the owner; workers must not resolve product-policy questions by
silence or by implementation.

## 4. Shared rules for every worker

1. Read `V2_PLAN.md`, the adversarial audit, this packet, and the code actually in the assigned base.
2. Begin with a short evidence-backed plan and report the files expected to change.
3. Preserve existing/user/concurrent changes. Never stage broadly or rewrite unrelated files.
4. Prefer new focused modules and tests over adding more responsibility to monoliths.
5. Do not weaken a gate because current data fails it. Report the failure and fix the cause or request a ruling.
6. No runtime LLM dependency. Cached build-time model judgment is optional only after a labeled eval
   demonstrates material lift; it must be pinned, schema-validated, costed, reproducible, and fail closed.
7. Every user-facing claim must have an emitted reason/evidence path. No unsupported “best,” “near,”
   “open,” “fresh,” “hidden gem,” or weather-fit language.
8. Every behavior change receives a regression test proportional to risk.
9. Before requesting integration: rebase on the architect-designated integration base, run the lane gate,
   run `git diff --check`, and provide a concise handoff.
10. Do not merge, push, or open a PR unless the owner or architect explicitly asks.

### Required status format

Workers use this compact block for coordination updates:

```text
STATUS: green | yellow | red
BASE: <commit>
SCOPE: <current bounded slice>
CHANGED/PLANNED: <files or modules>
TESTS: <passed, failed, not yet run>
BLOCKERS: <none or exact dependency/decision>
CONTRACTS: <interfaces another lane consumes or changes>
NEXT HANDOFF: <specific deliverable and expected checkpoint>
```

`yellow` means progress continues but another lane or owner should know. `red` means work has stopped
because continuing would create rework, violate a gate, or make an owner decision implicitly.

## 5. Dependency and merge graph

### H0-A — Artifact Trust Envelope (first exclusive merge lane)

- Shared artifact contract: schema version, city, IANA timezone, build/run ID, generated/expiry times,
  source health, counts, shards, and hashes.
- Finder emits the contract at the artifact choke point.
- Deploy validates exact tested bytes and publishes the manifest last.
- Runtime exposes `loading | ready | stale | offline | error | empty` with retry/recovery.
- Selected-city local staging and negative fixtures.
- One scheduled refresh proven end to end.

### H0-B — Runtime truth and state

- One city clock and actionable-event predicate.
- Stable-ID migration and city-scoped, versioned storage.
- Reactive, atomic planner operations and retained snapshots.
- Cross-city, cross-timezone, corrupt-storage, and refresh tests.

Once the H0 interfaces are frozen, E0, U0, and I0 may merge independently. L0 can merge its loader and
manifest work only after confirming it extends rather than forks the H0 artifact contract.

### First visible slice — Credible First Screen

E0 and U0 integrate a shared selector into Home's primary recommendations and the Events lead shelf:

- no expired, wrong-city, duplicate-series, or unsupported-claim cards;
- three credible and diverse first options with honest reason codes;
- full inventory remains reachable;
- truthful image hierarchy and fallback from I0;
- premium hierarchy, loading/failure treatment, responsive behavior, and accessibility.

Tampa is the richer acceptance corpus; SF/East Bay is the sparse-data regression corpus.

### Expansion sequence

L0 proceeds from runtime manifest/shards → diverse metro pilot → repeatable platform adapters → major
U.S. metros → nationwide floor. Publishing a city requires coverage/freshness disclosure and the
ratified quality gates; preparing adapters and sources does not.

## 6. Protected integration hotspots

The architect coordinates edits to these high-conflict files:

- `app/src/App.jsx`
- `app/src/nav.jsx`
- `app/src/lib.js`
- `finder/finder.mjs`
- `test/smoke.mjs`
- planning registries and plan-of-record documents

Workers should expose new interfaces from focused modules and request an integration window before
changing a protected hotspot. The architect may assign one temporary owner or perform the final wiring.

Candidate module seams (names may be refined during H0 design):

- `shared/contracts/artifact.mjs`
- `app/src/data/artifactRepository.js`
- `app/src/time/cityClock.js`
- `app/src/persistence/scopedStorage.js`
- `app/src/planner/store.js`
- `shared/rank.mjs`
- an imagery receipt/credit contract shared by finder and UI

## 7. Lane-specific worker prompts

The following prompts are ready to paste into the five implementation chats after Gate Zero. Replace
`<V2_BASE_SHA>` and `<ARCHITECT_TASK_ID>` first.

### Prompt A — H0 Trust Boundary

```text
You own Wuzup V2 H0 — Trust Boundary. Start from exact base <V2_BASE_SHA> in a dedicated worktree and
branch codex/v2-h0-trust. The architect/control-room task is <ARCHITECT_TASK_ID>.

Read planning/v2/V2_PLAN.md, ADVERSARIAL_AUDIT_2026-07-14.md, and planning/v2/V2_COORDINATION.md fully.
Inspect the actual finder → deploy → app data path before editing. Implement the smallest contract-first
sequence that establishes the Artifact Trust Envelope, then runtime time/state truth. Do not change
ranking, redesign navigation, or add product features.

Required outcomes: immutable artifact manifest and shared validation; exact-tested-artifact deploy guard;
manifest-last publishing; explicit runtime loading/stale/offline/error/empty states with retry; selected-city
dev staging; IANA city-clock/actionable predicate; versioned city-scoped storage with safe stable-ID migration;
atomic planner seam; two-city, multiple-host-timezone, corrupt-data, and negative deploy tests; one scheduled
refresh proof recorded when externally observable.

Before editing, send the architect your proposed contract, file list, migration strategy, and commit slices.
Do not orphan existing saves/plans: use dual-read or another explicit idempotent migration. Avoid broad edits
to protected hotspots until the architect assigns the integration window. Use the required status format.
```

### Prompt B — E0 Relevance Engine

```text
You own Wuzup V2 E0 — Relevance Engine. Start from exact base <V2_BASE_SHA> in a dedicated worktree and
branch codex/v2-e0-relevance. The architect/control-room task is <ARCHITECT_TASK_ID>.

Read planning/v2/V2_PLAN.md, ADVERSARIAL_AUDIT_2026-07-14.md, and planning/v2/V2_COORDINATION.md fully.
First create frozen Tampa and SF/East Bay evaluation fixtures from representative first-screen candidates
and document the scoring rubric for owner ratification. Trace every existing rank/sort path. Build a pure,
deterministic shared ranking contract returning objective quality, context, bounded signed user preference,
total score, and honest reason codes; keep diversification as a separate deterministic pass.

Initial work may add fixtures, evaluation tools, retained-signal normalization, and new pure modules. Do not
wire runtime surfaces or depend on unratified H0 artifact/time/state interfaces. Preserve never-hide catalog
reachability. Add source/category/venue/series diversity, recurring-series control, and tests proving expired
or wrong-city items cannot rank once H0 supplies those fields. No runtime LLM; propose cached build-time AI
only if a labeled comparison proves material lift.

Before editing, send the architect the evaluation sample design, existing ranking map, proposed API, file
list, and protected-hotspot needs. Use the required status format.
```

### Prompt C — U0 Product Completion

```text
You own Wuzup V2 U0 — Product Completion and premium existing UI. Start from exact base <V2_BASE_SHA> in a
dedicated worktree and branch codex/v2-u0-product. The architect/control-room task is <ARCHITECT_TASK_ID>.

Read planning/v2/V2_PLAN.md, ADVERSARIAL_AUDIT_2026-07-14.md, and planning/v2/V2_COORDINATION.md fully.
Inventory the existing Home → discovery/search → detail → quick-add/save → My Plans journey at mobile and
desktop widths, keyboard-only, and failure states. Implement bounded independent P0 fixes first: true combined
filters, invalid Search scope reset, inert/aria-hidden inactive pages, honest copy/claims, repeated-time cleanup,
kind-correct Saves, clipped controls, and explicit error/empty/retry treatment where it does not fork H0.

Wait for H0's persistence/time contracts before changing quick-add, city scoping, or planner lifecycle.
Then make add/duplicate/undo/remove/reload/city-switch/refresh behavior canonical and idempotent. Premium work
means hierarchy, responsiveness, motion/touch, image treatment, skeletons, focus, contrast, and complete states
on existing surfaces—not new ceremonies or top-level products. Add Playwright coverage for the critical path
and keyboard/focus/inert/back behavior.

Before editing, send the architect a defect-to-slice map, file list, screenshots or DOM evidence, dependencies,
and protected-hotspot needs. Use the required status format.
```

### Prompt D — I0 Imagery

```text
You own Wuzup V2 I0 — truthful, licensed, useful imagery and enrichment. Start from exact base <V2_BASE_SHA>
in a dedicated worktree and branch codex/v2-i0-imagery. The architect/control-room task is
<ARCHITECT_TASK_ID>.

Read planning/v2/V2_PLAN.md, ADVERSARIAL_AUDIT_2026-07-14.md, and planning/v2/V2_COORDINATION.md fully.
Begin with a reproducible inventory across both cities: exact versus venue/contextual/fallback image,
host/domain, license/attribution/provenance, hotlink status, dimensions/quality, broken links, exact and
perceptual duplicates, first-screen coverage, and payload cost. Complete the supervised SF imagery closeout.

Propose and then implement the machine-readable image receipt/credit contract and the build-time ingest,
resize, optimize, self-host, validate, and fallback pipeline where policy permits. Enforce the hierarchy:
verified exact image → verified venue/place image → clearly contextual licensed image → honest Aurora/Wuzup
fallback. Never present a contextual image as the exact event/place. Prioritize first-screen and flagship
inventory before universal coverage. Numeric gates and external-source licensing/storage policy require owner
ratification after the baseline report.

Before editing production behavior, send the architect the baseline, policy questions, proposed schema,
file list, and protected-hotspot needs. Use the required status format.
```

### Prompt E — L0 Locations

```text
You own Wuzup V2 L0 — City Foundry and honest United States coverage. Start from exact base <V2_BASE_SHA> in a
dedicated worktree and branch codex/v2-l0-locations. The architect/control-room task is <ARCHITECT_TASK_ID>.

Read planning/v2/V2_PLAN.md, ADVERSARIAL_AUDIT_2026-07-14.md, and planning/v2/V2_COORDINATION.md fully.
Inventory compile-time city assumptions, city-specific source logic, reusable platform patterns, payload
sizes, deployment topology, and coverage-state behavior. Prototype a runtime cities manifest, lazy per-city
artifact loader, and city resolution on new focused interfaces. Coordinate the manifest schema with H0; do
not fork artifact identity/freshness/hash contracts or wire protected hotspots without an integration window.

Design the City Foundry path: platform adapters, per-location configs, auto-gazetteer, source health and
politeness, manifest-last publishing, tiered cadence, coverage disclosure, and auto-demotion. Prepare a
diverse 5–10-metro pilot proposal that tests platform and data regimes; do not mass-publish cities yet.
Full-US means flagship + metro + nationwide floor + honest low/no-coverage states, with sharded loads rather
than a client monolith. National-source API/ToS posture, hosting, and final launch thresholds require owner
ratification before scaled acquisition.

Before editing, send the architect the assumption inventory, proposed interfaces, pilot-selection rubric,
file list, H0 dependencies, and protected-hotspot needs. Use the required status format.
```

## 8. Owner decisions and escalation

Decisions needed before or during the first implementation cycle:

1. Ratify the first-value promise and the V3 parking list.
2. Ratify the freshness SLA and stale/refusal behavior.
3. Ratify canonical quick-add/My Plans semantics.
4. Approve the labeled relevance/gem rubric after E0 supplies examples.
5. Approve imagery licensing, storage/proxy, attribution, and contextual-image rules after I0's inventory.
6. Approve national-source API/ToS posture and hosting after L0's spike.
7. Ratify numeric relevance, imagery, and city launch gates after reproducible baselines.

Workers route a decision with: the evidence, two or three options, the recommended default, impact if deferred,
and the last safe decision point. Non-blocking decisions do not stop independent work.

## 9. Definition of implementation-cycle success

The first cycle is complete when:

- planning/audit evidence is safely integrated and every lane shares one base;
- H0 exact-artifact, time, city, storage, and failure contracts pass negative tests in both cities;
- the first-screen E0/U0 slice demonstrably improves current recommendations without hiding the catalog;
- I0 can account for every displayed first-screen image as approved provenance or an explicit fallback;
- L0 proves runtime sharded-city loading and presents a gated pilot plan without mass rollout;
- the full release gate, focused browser flows, and `git diff --check` are green;
- unresolved owner decisions are recorded rather than silently implemented.
