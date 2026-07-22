# Sprint 11 explicit-research beta protocol

> **Status:** engineering green; production observation, Sprint 10 external approval, and real beta evidence remain blocked
>
> **Authority:** [V2_SPRINTS.md](V2_SPRINTS.md) and [V2_PLAN.md](V2_PLAN.md). This protocol does not
> authorize background analytics, declare a beta pass, or substitute fixture data for observed use.

## Purpose

Sprint 11 requires reproducible evidence that a person can reach a credible option, retain it as a save or
plan, and follow the source successfully. Wuzup does not currently ship analytics. The initial protocol uses
explicit, observer-recorded research sessions so beta evidence can be collected without silently expanding
the privacy contract.

`shared/beta-research.mjs` validates one exact session schema and aggregates a cycle deterministically. A
session is bound to the immutable composed-site release ID plus the city manifest and build IDs that were actually
tested. Sessions cannot be mixed across UI-only or city-data release bytes.

`finder/build-site-release.mjs` seals the composed Pages upload as one deterministic `site-release.json` receipt.
That receipt binds the exact source commit and two city releases to every intended participant-facing path, byte
count, and SHA-256 digest. `shared/beta-production-observation.mjs` supplies deployment identities only after one
complete whole-site observation of that expected receipt and both city runtimes. Manually copied IDs, a successful
workflow, HTTP dates, and available legacy JSON members are not deployment evidence. The observer accepts only
Wuzup's canonical GitHub Pages origin and emits a usable binding only for the exact expected site release, source
commit, and two-city release pair; an otherwise exact but unbound observation cannot authorize research.
`shared/beta-release-kit.mjs` independently verifies the checked local sets and requires the observed composed-site
ID plus exact agreement with both deployed city identities before it can emit owner-fillable research inputs.

## Participant-facing release observation

The deploy assembles Tampa at the product root and SF under `sf/`, removes Vite's private `.vite/` build-evidence
directories, and creates an empty `.nojekyll` control before sealing. The receipt excludes only itself (which cannot
hash itself) and `.nojekyll` (represented by an exact `noJekyll: true` control); every remaining regular file is
listed in canonical path order. Case-aliased reserved names or directory prefixes, file/directory conflicts, symlinks,
junctions, special files, unsafe or unexpected dot paths, over-budget entry/directory/file/byte trees, and incomplete
or mismatched city artifacts fail closed in a streaming preflight before any participant file or artifact is parsed.

The observer retries one bounded whole-site transaction rather than combining independently successful generations:

- fetch and validate receipt R1 against the same-run expected site release ID and source commit;
- fetch every listed participant-facing member, require exact status/MIME/size/hash, and reconstruct the canonical
  file count, byte total, and tree digest (`index.html` and `sf/index.html` use their slash-base URLs so canonical
  Pages routing is observed without accepting arbitrary redirects);
- inside that outer bracket, perform each city's manifest, member, local-image, and executed-runtime transaction; and
- fetch receipt R2 and require byte identity with R1. Any receipt, member, city, or runtime failure retries the whole
  attempt and emits no deployment binding when the bounded attempts are exhausted.

For each city inside that bracket, the observer:

- require the canonical Wuzup HTTPS origin, exact city-base URLs, status 200, no redirects, expected MIME, no
  credentials/referrer, bounded response bytes, and `no-store`/`no-cache` request semantics;
- validate the manifest shape, city, timezone, temporal coherence, build ID, and manifest ID from its body;
- fetch and hash-check all three manifest members, then validate their schemas and row counts;
- derive every local `/place-img/<safe filename>` reference from the verified Places member, fetch it at the city
  base, and reconstruct the exact sorted image-tree count, byte total, and digest;
- refuse future nonempty manifest shards until their member contract is implemented, and require raw HTML not to
  pre-populate the runtime identity marker;
- launch isolated Chromium with external origins and service workers blocked, execute the exact city URL, require the
  parsed document and every loaded same-origin script URL/byte set to match that city's receipt entries, require a
  loaded script to contain the approved manifest pin, and require the mounted app's city, timezone, ready state,
  manifest ID, build ID, and composed-site identity to match the release; and
- fetch the manifest again and require byte identity, aborting the outer whole-site attempt rather than mixing
  generations.

Only one exact site receipt matching the caller's same-run identity plus two successful cities matching its complete
expected pair produce a `deployedReleases` object. Exact bytes without those bindings remain `observed-unbound`.
One-city success, a receipt or manifest flip, stale expected identity, omitted/extra or changed intended member,
404/HTML fallback, bad hash, missing image, unsupported shards, pre-populated identity, missing loaded-script pin, or
executed runtime mismatch returns no usable binding. Exact remote publication is distinct from beta policy: stale or
source-unverified bytes may be observed, but the release kit still blocks them.

The post-Pages job retains the JSON observation for 90 days and fails on remote integrity mismatch. The deploy
workflow itself is main-only, checks out the exact triggering SHA, reruns the complete deterministic repository gate
and all three composed/mobile browser journeys on that SHA, refuses stale or source-unverified artifact staging,
checks both final city builds against the payload budgets, seals the composed site before upload, installs locked
observer dependencies plus its Chromium runtime, and grants Pages/id-token permissions only to the deploy job. This
observation binds every intended published UI/static/data member, the exact document and script bytes Chromium
actually executes, the loaded bundle pin, and executed app identity. It does not prove that the hosting platform exposes
no additional alias or platform-generated URL outside the sealed path list, and it does not replace beta eligibility,
freshness, source-health, or SLO evidence. A successful point-in-time receipt must be rechecked before each participant
session because a later deploy or natural expiry can invalidate it.

## What a receipt may contain

Every receipt contains only:

- schema/version, a random single-session receipt ID, composed-site release ID, flagship city ID, manifest ID, and
  build ID;
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

The research input is bounded before normalization or JSON parsing can become an unbounded workload: at most
1,000 receipts per flagship city and 2,000 total receipts, with an 8 MiB receipts file and 256 KiB review-config
file. The CLI reads through one open regular-file handle up to the limit plus one byte, rejects files that change
while being read, requires strict UTF-8, and writes no report on an input-limit failure. These are safety ceilings,
not target sample sizes; the owner-supplied review configuration remains the only minimum-sample contract.

## Session procedure

1. Deploy and observe one exact two-city participant-facing release. Record identities only from the successful
   production observation, run the release kit against the same checked local sets, and bind the cycle's review
   configuration to that composed-site release and both city releases before evaluating sample sufficiency.
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
node shared/beta-production-observation.mjs https://joshuaallanmorgan-lgtm.github.io/wuzup/ <site-release-id> <40-char-source-commit>
node shared/beta-research.mjs path/to/receipts.json path/to/review-config.json
```

The research CLI writes its report to stdout and errors to stderr. It does not write, upload, or transmit receipts.
The production-observation CLI performs read-only HTTPS requests plus isolated browser loads and writes its
attestation to stdout. The site release ID and source commit are required same-run workflow inputs, not values learned
from the remote response. An integrity block exits nonzero; an exact but beta-ineligible publication remains explicit
as `production-observed` rather than being mislabeled as deployment failure or beta readiness.

## Engineering verification

At the 2026-07-22 checkpoint, `npm run test:s11` passes 60/62 with only two expected Windows capability skips
(case-sensitive path representation and symlink creation). The complete `npm test` pre-gate is green and its serial
core suite passes 919/919. The independently executed composed-city, Sprint 9, and Sprint 10 browser journeys pass
1/1, 1/1, and 4/4 respectively, and the payload-performance contract passes 2/2. Independent security and deployment-
operations reviews reported SHIP with no open P0/P1. These results validate the code and workflow contract only;
the current public site still lacks an observed composed-site receipt and cannot authorize beta sessions.

## Decision boundary

Without an owner-ratified review configuration, every report is `insufficient`. A configured report becomes
`reviewable` only after both flagship cities match the configuration's exact expected manifest/build IDs and meet
the configured minimum unique-session count. A release mismatch or replayed receipt hard-fails. `Reviewable`
never means pass or fail; Sprint 11 still requires real sessions, green refresh/deploy SLOs, no open P0, and an
owner interpretation against the first-value promise. A review configuration or receipt with an omitted, malformed,
or different composed-site ID fails even when both city data identities are unchanged.

The checked-in six-session fixture is synthetic contract data. It proves validation and arithmetic only. It
must never be included in a beta report or cited as product evidence.
