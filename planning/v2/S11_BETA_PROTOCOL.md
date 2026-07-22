# Sprint 11 explicit-research beta protocol

> **Status:** beta-readiness foundation only; Sprint 10 remains the active release gate
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

1. Deploy and verify one exact Tampa or SF/East Bay artifact set. Record its `manifestId` and `buildId`, and bind
   the cycle's review configuration to those expected releases before evaluating sample sufficiency.
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
node shared/beta-research.mjs path/to/receipts.json path/to/review-config.json
```

The CLI writes the report to stdout and errors to stderr. It does not write, upload, or transmit receipts.

## Decision boundary

Without an owner-ratified review configuration, every report is `insufficient`. A configured report becomes
`reviewable` only after both flagship cities match the configuration's exact expected manifest/build IDs and meet
the configured minimum unique-session count. A release mismatch or replayed receipt hard-fails. `Reviewable`
never means pass or fail; Sprint 11 still requires real sessions, green refresh/deploy SLOs, no open P0, and an
owner interpretation against the first-value promise.

The checked-in six-session fixture is synthetic contract data. It proves validation and arithmetic only. It
must never be included in a beta report or cited as product evidence.
