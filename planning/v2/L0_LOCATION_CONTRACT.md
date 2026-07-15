# L0 location-resolution contract

> **Status:** synthetic Sprint 1 foundation; no browser, finder, deploy, workflow, or public-location wiring
>
> **Contract:** `shared/cities-index.mjs` with the version-1 fixture at
> `test/fixtures/location/cities-index.v1.json`

## Purpose

L0 separates three facts that the current product previously conflated: which locality a request names,
how deep coverage is there, and whether an identified artifact pack is safe to load. The contract is pure:
callers inject the cities index, URL inputs, coordinates, and `now`. It reads no clock, storage, location API,
network, production artifact, or environment state.

## Version-1 index

The root object contains:

- `schemaVersion: 1`, canonical `generatedAt`, self-identity `indexId`, and an existing `defaultCityId`;
- a non-empty `cities[]` roster;
- explicit `fallbacks.nationwideFloor` and `fallbacks.notCovered` records; and
- `usRegions[]` bounding boxes that include `contiguous-us`, `alaska`, and `hawaii`.

Each city carries `cityId`, display names, region and country, an IANA `timeZone`, center and bounding box,
one recognized `coverageTier`, unique `pathAliases`, and an artifact pack. A pack carries only index-declared
data: root-relative `manifestUrl`, SHA-256-form manifest/build identities, generation and expiry timestamps,
nonnegative counts, recognized source health, and root-relative, content-identified shards.

Version 1 accepts only plain schema objects whose required values are own properties. Root-relative artifact
URLs are checked after percent-decoding and reject dot segments, encoded separators, backslashes, controls,
query/fragment text, and ambiguous empty segments. Pack `counts` and shard kinds are a closed set: every count
has exactly one shard and every shard has one declared count.

`calculateCitiesIndexId(index)` hashes a canonical JSON representation with the root `indexId` omitted.
Object keys are sorted recursively and array order is preserved. `validateCitiesIndex(index)` validates the
full shape and then requires the exact identity, so changing any bound value without resealing the index is a
forgery.

The checked-in fixture is deliberately synthetic. Its counts, hashes, freshness, health, URLs, region boxes,
and fallback entries are contract examples, not production artifact claims and not a new public city roster.

## Deterministic resolution

`resolveLocation({ index, pathname, query, coords, now })` uses this precedence:

1. A present `city` query parameter, including an empty or unknown value.
2. An explicit `/cities/<id-or-alias>` path segment.
3. Valid injected coordinates.
4. `defaultCityId`, only when none of the first three location signals exists.

City IDs and aliases are matched case-insensitively after trimming. The legacy `sf` alias resolves to
`sf-east-bay`. A query outranks a path, and an explicitly unknown query or path resolves to `not-covered`; it
never falls through to Tampa or to a lower-precedence signal.

Coordinates inside a city bounding box resolve to that city. Other coordinates inside one of the declared US
region boxes resolve to `nationwide-floor` with `coverageTier: thin`. Coordinates outside the declared boxes
resolve to `not-covered`. Missing, non-finite, or out-of-range coordinate components throw a deterministic
error instead of guessing. These coarse synthetic boxes establish routing behavior only; they are not a
border-grade geocoder.

Every resolution reports a stable reason, coverage tier, city identity and timezone when a city applies, or
an explicit fallback identity otherwise. It also reports the pack state at injected `now`:

- `ready`: healthy and unexpired;
- `degraded` or `unknown`: unexpired, with source-health uncertainty retained;
- `expired` or `failed`: identified but unsafe to load; or
- `none`: an honest fallback with no artifact pack.

## Artifact load and refusal

`artifactLoadPlan(index, resolution, { now })` accepts only a resolution bound to the same `indexId` and requires
a fresh injected evaluation time. The resolution retains its status snapshot at `resolvedAt`; the load plan
recomputes pack state at injected `now` and reports that time as `evaluatedAt`. A previously ready resolution
therefore refuses once its pack expires instead of replaying old trust. The plan returns `canLoad`, coverage and
identity fields, any loadable manifest/shards, stable warnings, and stable refusal reasons. It copies URLs only
from the validated index and returns no URL or shard for a refused plan.

| Pack state | `canLoad` | Warning | Refusal |
|---|---:|---|---|
| `ready` | `true` | none | none |
| `degraded` | `true` | `SOURCE_HEALTH_DEGRADED` | none |
| `unknown` | `true` | `SOURCE_HEALTH_UNKNOWN` | none |
| `expired` | `false` | none | `ARTIFACT_PACK_EXPIRED` |
| `failed` | `false` | none | `ARTIFACT_PACK_FAILED` |
| `none` | `false` | none | `NO_ARTIFACT_PACK` |

Thin and not-covered fallbacks therefore remain useful resolution results without pretending that a city
artifact exists.

## Verification

Run the focused contract gate with:

```text
npm run test:l0
```

The root serial `npm test` gate also includes `test/location-resolver.mjs`. Its 20 focused tests cover canonical
identity, plain/own schema enforcement, validation and forgery rejection, decoded URL traversal, exact
count/shard closure, query/path/alias precedence, Tampa and SF bounding boxes, contiguous-US/Alaska/Hawaii
fallback behavior, outside-region and explicit-unknown behavior, invalid coordinates, injected plan-time
expiry replay, all pack load states, and input immutability.

## Explicit non-claims

This L0 slice does not wire React or browser routing, load any artifact at runtime, alter finder city configs,
change generation or deployment, crawl a source, publish a new location, prove exact national boundaries, or
claim full-US data coverage. Sprint 1 stays yellow. Runtime loading and location expansion remain behind their
scheduled trust, product, source, private-pilot, and public-rollout gates.
