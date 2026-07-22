# Sprint 11 explicit-research beta protocol

> **Status:** beta-readiness and participant-facing observation foundation; Sprint 10 external gates remain open
>
> **Authority:** [V2_SPRINTS.md](V2_SPRINTS.md) and [V2_PLAN.md](V2_PLAN.md). This protocol does not
> authorize background analytics, declare a beta pass, or substitute fixture data for observed use.

## Purpose

Sprint 11 requires reproducible evidence that a person can reach a credible option, retain it as a save or
plan, and follow the source successfully. Wuzup does not currently ship analytics. The initial protocol uses
explicit, observer-recorded research sessions so beta evidence can be collected without silently expanding
the privacy contract.

`shared/beta-research.mjs` validates one exact session schema and aggregates a cycle deterministically. A
session is bound to the immutable city manifest and build IDs that were actually tested. Sessions for the
same city cannot be mixed across release bytes.

`shared/beta-production-observation.mjs` supplies those deployment identities only after one complete two-city
participant-facing observation. Manually copied IDs, a successful workflow, HTTP dates, and available legacy JSON
members are not deployment evidence. The observer accepts only Wuzup's canonical GitHub Pages origin and emits a
usable binding only for the exact expected two-city release pair; an otherwise exact but unbound observation cannot
authorize research. `shared/beta-release-kit.mjs` independently verifies the checked local sets and requires exact
agreement with the observed deployment before it can emit owner-fillable research inputs.

## Participant-facing release observation

For each city, the observer performs one bounded manifest-first transaction:

- require the canonical Wuzup HTTPS origin, exact city-base URLs, status 200, no redirects, expected MIME, no
  credentials/referrer, bounded response bytes, and `no-store`/`no-cache` request semantics;
- validate the manifest shape, city, timezone, temporal coherence, build ID, and manifest ID from its body;
- fetch and hash-check all three manifest members, then validate their schemas and row counts;
- derive every local `/place-img/<safe filename>` reference from the verified Places member, fetch it at the city
  base, and reconstruct the exact sorted image-tree count, byte total, and digest;
- refuse future nonempty manifest shards until their member contract is implemented, and require raw HTML not to
  pre-populate the runtime identity marker;
- launch isolated Chromium with external origins and service workers blocked, execute the exact city URL, capture the
  bounded same-origin asset JavaScript responses it actually loads, require one to contain the approved manifest pin,
  and require the mounted app's city, timezone, ready state, manifest ID, and build ID to match the release; and
- fetch the manifest again and require byte identity, retrying the whole city rather than mixing generations.

Only two successful cities matching the caller's complete expected pair produce a `deployedReleases` object. Exact
bytes without that pair remain `observed-unbound`. One-city success, a manifest flip, stale expected identity,
404/HTML fallback, bad hash, missing image, unsupported shards, pre-populated identity, missing loaded-script pin, or
executed runtime mismatch returns no usable binding. Exact remote publication is distinct from beta policy: stale or
source-unverified bytes may be observed, but the release kit still blocks them.

The post-Pages job retains the JSON observation for 90 days and fails on remote integrity mismatch. The deploy
workflow itself is main-only, checks out the exact triggering SHA, refuses stale or source-unverified artifact staging,
installs locked observer dependencies plus its Chromium runtime, and grants Pages/id-token permissions only to the
deploy job. This observation binds Wuzup's published data, actually loaded bundle pin, and executed app identity; a
canonical digest of every UI/static file remains a further hardening step and is not claimed here. A successful point-
in-time receipt must be rechecked before each participant session because a later deploy or natural expiry can
invalidate it.

## What a receipt may contain

Every receipt contains only:

- schema/version, a random single-session receipt ID, flagship city ID, manifest ID, and build ID;
- total elapsed session duration;
- nullable elapsed time to a credible option and first retained value;
- source-link outcome: not attempted, succeeded, or failed;
- bounded counts of empty searches, duplicate exposures, and corrections;
- a boolean returning-use self-report; and
- a yes/no/unclear core-promise assessment.

Exact-key validation rejects participant identity, wall-clock timestamps, titles, listing or plan contents,
queries, URLs, coordinates, taste data, free text, and unknown nested fields. The receipt is research evidence,
not an event log. `sessionReceiptId` is a new random `r-` plus 32-lowercase-hex nonce for that receipt only; it
must not be derived from a person, device, time, or research roster, and duplicate nonces are rejected as replay.

## Session procedure

1. Deploy and observe one exact two-city participant-facing release. Record identities only from the successful
   production observation, run the release kit against the same checked local sets, and bind the cycle's review
   configuration to those releases before evaluating sample sufficiency.
2. State the task without coaching: find one credible local option and save it or add it to a plan if useful.
3. Start one elapsed timer when the participant begins. Record the first credible-option milestone only when
   the participant identifies it; record retained value only after a visible save or plan succeeds.
4. Record only the bounded outcomes in the schema. An attempted source link requires a credible option, and a
   `yes` core-promise assessment requires credible value, retained value, and a successful source-link follow-through.
   Do not transcribe searches, listing names, personal facts, or commentary into the receipt.
5. Store the research receipts outside the shipped app. Run the deterministic report locally and review its
   aggregate output.

## Metrics and denominators

The report emits aggregate and per-city session counts; median and nearest-rank p75 timing with observed,
missing, and total session denominators; source-link successes per attempted link; sessions with empty search,
duplicate, or correction outcomes; returning-use self-report; and yes/no/unclear core-promise counts. A null
rate means its denominator is zero.

Run the frozen contract with:

```text
npm run test:s11
node shared/beta-production-observation.mjs https://joshuaallanmorgan-lgtm.github.io/wuzup/
node shared/beta-research.mjs path/to/receipts.json path/to/review-config.json
```

The research CLI writes its report to stdout and errors to stderr. It does not write, upload, or transmit receipts.
The production-observation CLI performs read-only HTTPS requests plus an isolated browser load and writes its
attestation to stdout. An integrity block exits nonzero; an exact but beta-ineligible publication remains explicit as
`production-observed` rather than being mislabeled as deployment failure or beta readiness.

## Decision boundary

Without an owner-ratified review configuration, every report is `insufficient`. A configured report becomes
`reviewable` only after both flagship cities match the configuration's exact expected manifest/build IDs and meet
the configured minimum unique-session count. A release mismatch or replayed receipt hard-fails. `Reviewable`
never means pass or fail; Sprint 11 still requires real sessions, green refresh/deploy SLOs, no open P0, and an
owner interpretation against the first-value promise.

The checked-in six-session fixture is synthetic contract data. It proves validation and arithmetic only. It
must never be included in a beta report or cited as product evidence.
