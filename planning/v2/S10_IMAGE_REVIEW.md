# Sprint 10 flagship image review

> **Status:** deterministic 100-row evidence set ready; independent pixel/identity/legal review pending
>
> **Authority:** [V2_SPRINTS.md](V2_SPRINTS.md), [V2_PLAN.md](V2_PLAN.md), and
> [I0_IMAGE_INVENTORY.md](I0_IMAGE_INVENTORY.md). This document does not approve an image or ratify a
> positive coverage target.

## What is ready

`shared/flagship-image-review.mjs` builds one immutable review population from the currently pinned Tampa Bay
and SF/East Bay place artifacts. It selects exactly 50 credited, runtime-renderable place photos per city and
binds the result to:

- the complete city manifest bytes, `manifestId`, and `buildId`;
- the complete places artifact hash, byte count, and row count;
- each selected item identity, name, address, coordinates, and common-ranker proxy position/tier;
- image delivery, host, source family/page, author, license, optional license URL, and artifact reuse count;
- explicit risk flags for reused references, missing license URLs, local delivery, and missing addresses; and
- SHA-256, byte size, dimensions, and format for every selected local image.

The selection is deterministic and risk/source/delivery stratified. Tampa contributes 35 remote Commons and
15 local Mapillary rows; SF contributes 50 remote Commons rows. The candidate pools remain 139 Tampa and 175
SF credited place rows. The test fixture pins the two release identities, sample item IDs, summaries, and
canonical report hash so artifact or policy drift requires a deliberate review-set update.

Run the contract and emit the complete reviewer evidence with:

```text
npm run test:s10-images
node shared/flagship-image-review.mjs > flagship-image-review.json
```

The generated JSON is evidence for review, not a completed review receipt. Its exact schema requires every
identity, pixel, legal, and human-pass field to remain pending/false; undeclared verdicts are rejected. A separate
decision receipt must bind every reviewed byte set to the report SHA. Remote rows require SHA-256, byte count,
dimensions, MIME type, canonical retrieval time, and final HTTPS URL; local rows must match the already pinned
local SHA/dimensions exactly. The remote final URL must equal the audited reference, and pixel retrieval must occur
no later than and within 24 hours of the recorded review. A failed identity, pixel, or credit/license verdict cannot
resolve to `keep`.

## What the independent reviewer must still do

For all 100 selected rows, a reviewer who did not curate the source result must inspect the actual pixels and
source page, then record a separate decision receipt bound to the canonical report SHA and the exact fetched pixels.
The owner may sign/store that receipt through the approved audit process. The review must answer:

1. Does the image depict the named place, rather than a nearby activity, operator, sign directory, pylon, or
   different business?
2. Is the crop useful and non-misleading at mobile card and detail sizes?
3. Do the author, license, source page, attribution wording, and delivery method satisfy the owner-approved
   policy? A URL or metadata field alone is not legal proof.
4. Is any repeated photo being presented as multiple distinct places?
5. Does a failed row need removal, a corrected candidate, or the honest Aurora fallback?

The audit passes only when the reviewed release has zero wrong-place and zero uncredited displayed images.
Remote availability and source terms must be checked at review time. The current repository contains only 35
local Tampa pixels, so the remote portion requires network access or cleared local review copies.

## Positive imagery target remains an owner decision

Current event artifacts have zero displayable event-image receipts and intentionally use Aurora. Credited
place coverage is 6.43% Tampa and 6.06% SF; a current rank-based lead-eligible diagnostic is roughly 9.74% and
8.93%. Those measurements are not an approved target. Event/spot coverage percentages, top-tier semantics,
license allowlists, Mapillary posture, contextual/venue use, hotlink versus self-host policy, and the independent
reviewer remain owner decisions. Sprint 10 therefore remains yellow even though the evidence population is now
reproducible.
