# E0 relevance evaluation foundation

> **Status:** Sprint 1 measurement foundation; labels are draft and await owner review
>
> **Authority:** [V2_PLAN.md](V2_PLAN.md) and [V2_SPRINTS.md](V2_SPRINTS.md). This does not authorize
> Sprint 5 corpus changes or Sprint 6 ranker integration.

## Purpose

V1 has more than twenty ranking and selection paths, but no reproducible answer to whether a first screen is
useful, actionable, diverse, duplicate-free, or evidence-backed. Sprint 1 therefore freezes representative
failures and defines pure measurements before score weights change.

The fixtures replay hash-pinned July 6-7 Tampa and SF/East Bay finder outputs. Those outputs are expired and
have unknown source health, and the live finder files may legitimately change after refresh. This is evidence
about captured V1 behavior, not a claim about current inventory.

## Frozen contract

The versioned fixtures in `test/fixtures/relevance/` pin city, timezone, artifact hashes, build and manifest IDs,
surface, case type, intent, `asOf`, prefix, candidate set, and observed order. `surface-order` cases replay an
actual observed surface order. `defect-projection` cases group known failures for measurement and must not be
reported as first-screen UI quality baselines. Every judgment is context-local:

- relevance is 0 through 3;
- `actionable` means usable for the frozen surface and time, not globally valid;
- `knownBad` is for strict wrong-market, phantom-range, wrong-image, or non-product defects;
- `gem` is `yes`, `no`, or `insufficient`; insufficient evidence never supports a claim;
- canonical and series IDs are fixture annotations until production retains them.

Labels are `draft-owner-review`. There are no release thresholds and no positive gem ground truth yet. Owner
ratification remains a Sprint 5 decision before Sprint 6 integration.

## Evaluator guarantees

`shared/relevance-eval.mjs` consumes a labeled candidate set and total order. It never imports V1 selectors,
calculates a rank score, reads the clock, or consults mutable finder output.

Count-preserving reachability is checked first. Missing, invented, or duplicated IDs are reported and quality
metrics are withheld. Exact permutations receive:

- nDCG using gain `2^relevance - 1` and precision for relevance at least 2;
- strict known-bad rate and non-actionable leakage;
- source, category, and operator/venue distinctness and maximum share;
- canonical and series duplicate rows, groups, lower-bound exposure, and label coverage;
- gem precision with separate `no` and `insufficient` rates.

Missing diversity facets count as `unknown`; missing group IDs do not coalesce. Fixture order is preserved and
dominance ties sort lexically, making repeated evaluations deterministic.

## Captured surface receipts

These results are descriptive, not targets:

| Surface case | nDCG | Precision | Known bad | Non-actionable | Concentration signal |
|---|---:|---:|---:|---:|---|
| Tampa Home lead, evening | 0.235 | 33.3% | 0% | 100% | source max 66.7%; category max 33.3% |
| Tampa unlocated Spots | 0.746 | 66.7% | 0% | 0% | category max 100%; FWC max 66.7% |
| SF Home lead, morning | 0.433 | 50% | 50% | 100% | source max 50% |
| SF unlocated Spots | 1.000 | 100% | 0% | 0% | source, category, and operator max 100% |

Low relevance and strict defects remain separate. Tampa's hospital opening and automation open house are real
listings with poor lead value. SF's New York workshop is a strict contextual defect on the actual Home surface.

## Diagnostic projections

The Tampa duplicate/series projection is not a full-screen baseline. It proves the evaluator can expose one
canonical duplicate row, two series duplicate rows, and 40% non-actionable leakage when a repeated cluster is
placed into the evaluated prefix.

The SF image/gem projection is also diagnostic-only. It groups a wrong contextual place image, thin
private/generic place rows, and a false gem claim; the measured gem precision is 0% for that claim set.

## V1 rank-path inventory

| Area | Independent behavior to consolidate later |
|---|---|
| Finder events | `hotScore` mixes buzz, staff, one-off, image, imminence, and free; threshold is permissive |
| Finder places | `hiddenScore` can promote thin generic or private-sounding rows |
| Home | first three rows are sliced from `tonightModel` |
| Events | separate hot, rail, tonight, day, weekend, worth, free, recurring, neighborhood, and feed selectors |
| Shared ordering | `orderDay` mixes hot score with nonnegative taste and local de-flooding |
| Taste | mute bottoms out at zero, weakening negative preference |
| Search | text then hot score; date browse re-enters `orderDay` |
| Spots | photo-, distance-, free-, source-count-, name-, and next-unused ordering paths |
| Other | Plan/weekend suggestions, deck dealing, related items, guides, Saves, and details add more selectors |

Sprint 5 adds trustworthy signals, source health, normalization, and owner-ratified judgments. Sprint 6 can build
one count-preserving rank contract and compare it to these fixtures. This foundation must not wire unratified
weights into production early.

## Verification

Run `npm run test:e0`. The suite covers invalid judgments, count loss/duplication, deterministic metrics,
zero-gain nDCG, diversity, group duplication, gem evidence, case types, artifact pins, hash-gated raw fact
checks, and Tampa/SF receipts.
