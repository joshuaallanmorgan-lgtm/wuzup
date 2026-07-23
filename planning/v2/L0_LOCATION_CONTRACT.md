# L0 location and dark City Foundry contract

> **Status:** Sprint 13 dark foundation; no React, compile-time `CITY`, `app/public`, workflow, or public-location wiring
>
> **Contracts:** `shared/cities-index-core.mjs`, the Node facade `shared/cities-index.mjs`,
> `finder/build-cities-tree.mjs`, and `app/src/city-artifact-loader.js`

## Purpose

L0 separates four facts the original product conflated: which locality a request names, how deep coverage is
there, whether an identified artifact pack is safe to load, and which immutable bytes belong to that pack.
Resolution and load planning remain deterministic and clock-injected. Sprint 13 adds a scratch-only composer and
a browser-safe loader without connecting either one to the shipped mobile runtime.

## Version-1 index

The root object contains exactly:

- `schemaVersion: 1`, canonical `generatedAt`, self-identity `indexId`, and an existing `defaultCityId`;
- a bounded, non-empty `cities[]` roster;
- exact `fallbacks.nationwideFloor` and `fallbacks.notCovered` records; and
- bounded `usRegions[]` boxes including `contiguous-us`, `alaska`, and `hawaii`.

Each city carries exact identity/display/location fields, an IANA timezone, center and bounding box, one recognized
coverage tier, unique bounded aliases, and one artifact pack. Every pack binds:

- semantic `manifestId` and `buildId` SHA-256 identities;
- generated/expiry timestamps and source-health state;
- exact nonnegative event/place/guide counts; and
- exactly one event, place, and guide shard, each with an immutable URL, SHA-256 identity, byte count, and row count.

Pack URLs are not arbitrary. A city manifest must live at
`<product-root>/cities/<city-id>/releases/<manifest-id-hex>/artifact-manifest.json`; its three shards must live in
that same release directory. All cities in one index share one product root. The schema rejects unknown keys,
nonstandard or augmented arrays, accessors/prototype tricks, sparse arrays, non-primitive digests, unbounded counts
or bytes, traversal/encoded separators, duplicate IDs, aliases, shards, or query signals, and inconsistent counts or
paths. Validation reads property descriptors without invoking getters and returns one detached, deeply frozen
snapshot; hashing, resolution, and planning operate on that same snapshot.

`canonicalCitiesIndexJson(index)` supplies the browser-safe canonical payload with the root `indexId` omitted.
The Node facade's `calculateCitiesIndexId(index)` hashes that payload. `validateCitiesIndex(index)` requires both
the exact shape and exact identity. The checked-in fixture remains synthetic contract data, not a production
coverage or freshness claim.

## Deterministic resolution

`resolveLocation({ index, pathname, query, coords, now })` uses this precedence:

1. An explicit `city` query parameter.
2. A city path under the index's own product root.
3. Valid injected coordinates.
4. `defaultCityId`, only when no explicit location signal exists.

One request may not smuggle two city query parameters. If query and path are both present they must resolve to the
same city (including aliases) or the request fails closed. Unknown explicit locations resolve to `not-covered`;
they never fall through to Tampa. Coordinates matching more than one city or US-region box fail instead of using
array order. The coarse region boxes support deterministic routing tests only; they are not a border-grade
geocoder.

Every resolution reports a stable reason, coverage tier, identity/timezone where applicable, and the pack state at
injected `now`: `ready`, `degraded`, `unknown`, `expired`, `failed`, or `none`.

## Artifact planning and browser loading

`artifactLoadPlan` and its browser-safe counterpart re-evaluate the selected pack at an injected current time.
Expired and failed packs expose no loadable URLs; degraded and unknown packs retain explicit warnings. Resolution,
plan, manifest, build, and shard identities must all agree.

`createCityArtifactLoader(...)` is deliberately dark and has no React or app-store dependency. It requires:

- an absolute, credential-free HTTP(S) `productRoot` (including a subpath such as `/wuzup/`);
- an externally supplied `expectedIndexId`--a self-consistent downloaded index cannot approve itself;
- WebCrypto SHA-256; and
- bounded timeout and byte policies.

The loader fetches the exact `<productRoot>/cities/index.json` without credentials, referrer, cache reuse, or
redirects. It verifies the pinned canonical index before selecting a city. It then refuses stale/failed packs before
manifest access, derives every release URL rather than trusting redirects or arbitrary index URLs, verifies the
manifest/build/shard bindings, and leaves event/place/guide shards lazy until requested. It rechecks pack status
after manifest verification and before and after every shard fetch or cached return, so a session opened just before
expiry cannot outlive its evidence. Shards must match declared transport bytes, digest, UTF-8, JSON, minimum artifact
schema, and row count. Streaming caps work without a truthful `Content-Length`; explicit timeout races cover a fetch
or body reader that ignores `AbortSignal`.

Only one location session may be current. Opening a new session aborts and invalidates every late result from the
old one. The loader deliberately exposes no browser image/asset URL capability yet: the current manifest binds only
an aggregate image directory, not each member's bytes. A future image-loading contract must add index-pinned member
identity and bounded verified fetching before these packed images become browser-loadable.

## Scratch composer and publication order

`buildCitiesTree(...)` accepts only an explicit, new destination outside the verified source tree. It verifies the
current Tampa and SF artifact sets, preflights file/count/aggregate byte limits, rejects symlink/junction and
unsafe-filename inputs, and builds in an unpredictable same-parent staging directory. An exclusive sibling claim
serializes cooperating builders. Exclusive member copies, BigInt file/root/claim identity, single-link regular-file
rules, exact expected byte counts, and bounded streaming tree enumeration protect the staging tree before any
artifact parser reads it. Source image directories reject unsupported hidden members, and fixed-batch cleanup stays
memory-bounded while unlinking reparse points rather than traversing them. It verifies the copies and publishes in
this order:

1. JSON and image members;
2. each city's bound artifact manifest;
3. the globally pinned `index.json`, last inside staging;
4. one atomic staging-to-destination rename as the only visible commit.

The complete directory topology, artifact sets, index shape, canonical identity, and every receipt hash are rechecked
after callbacks and again after the commit. The returned receipt enumerates every JSON member, manifest, place image,
and final index. A catchable pre-commit interruption removes only the verified owned staging identity and leaves no
final destination. A crash can leave an unreferenced claim/staging directory, but not a misleading final path; a
post-commit callback/error never rolls the completed destination back. The current checked-in Tampa and SF artifacts
are integrity-valid but expired with unknown source health on the Sprint 13 evaluation date; the generated index
preserves that state and current-date load plans refuse both cities.

This composer does not deploy, update an existing catalog, or implement production release retention. A later
publication lane must retain prior immutable releases for rollback and flip a separately approved index last.
Its no-clobber guarantee is scoped to the claimed builder-owned scratch namespace: pure Node has no portable
`renameat2(RENAME_NOREPLACE)` equivalent, so replacement by a non-cooperating same-user process in the final POSIX
rename window is explicitly not claimed. Production publication needs a host/object-store conditional write or an
OS-specific no-replace primitive before this contract can be promoted.

## Verification

Run the complete focused gate with:

```text
npm run test:s13
```

It covers the browser-safe split and Node compatibility; exact schemas and limits; immutable path derivation;
duplicate/conflicting/overlapping resolution; real Tampa/SF composition; all-member receipts and image-pack binding;
staging/commit interruption, link-swap, cleanup, and byte-limit safety; external index pinning; lazy loading;
timeout/byte/UTF-8/JSON/schema failure; expiry during manifest/shard/cache boundaries; session supersession; explicit
absence of unverified browser image authorization; an isolated verified source snapshot for deterministic filesystem
testing; and an actual Vite browser bundle.

## Explicit non-claims

This slice does not switch cities in the shipped app, change the mobile UI, publish `/cities`, update `app/public`,
modify deployment, refresh stale source data, add a market, prove national coverage, activate a Coverage Card, or
ratify hosting/source/licensing policy. Runtime integration remains blocked by compile-time city singletons and the
Sprint 11/12 production, owner-policy, and pilot-cohort gates.
