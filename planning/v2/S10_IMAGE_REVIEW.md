# Sprint 10 flagship image review

> **Status:** exact-byte engineering inspection and schema-v2 receipt implementation complete; corrections, a new
> release-bound review session, independent human review, and owner policy ratification pending
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

Run the contracts and build the immutable review population with:

```text
npm run test:s10-images
node shared/flagship-image-review.mjs > flagship-image-review.json
```

The authoritative review workflow is `prepare -> finalize -> verify`:

```text
node shared/flagship-image-review-session.mjs prepare
node shared/flagship-image-review-session.mjs finalize --session-dir "<prepare sessionDir>" --reviewer "<independent reviewer>" --evidence-seal "<prepare evidenceSealSha256>" --owner-policy-receipt "<owner-policy.json>" --owner-policy-sha256 "<externally retained owner-policy SHA-256>"
node shared/flagship-image-review-session.mjs verify --session-dir "<prepare sessionDir>" --evidence-seal "<prepare evidenceSealSha256>" --decision-receipt-sha256 "<finalize decisionReceiptSha256>" --owner-policy-receipt "<owner-policy.json>" --owner-policy-sha256 "<externally retained owner-policy SHA-256>"
```

Retain `evidenceSealSha256` outside the session immediately after `prepare`, and retain
`decisionReceiptSha256` outside it immediately after the first successful `finalize`. A session with no `keep`
decision must omit both owner-policy options. Repeating `finalize` on an existing receipt also requires
`--decision-receipt-sha256` with the externally retained final digest.

The generated JSON is evidence for review, not a completed review receipt. Its exact schema requires every
identity, pixel, legal, and human-pass field to remain pending/false; undeclared verdicts are rejected. A separate
decision receipt must bind every reviewed byte set to the report SHA. Remote rows require SHA-256, byte count,
dimensions, MIME type, canonical retrieval time, and final HTTPS URL; local rows must match the already pinned
local SHA/dimensions exactly. The remote final URL must equal the audited reference, and pixel retrieval must occur
no later than and within 24 hours of the recorded review. A failed identity, pixel, or credit/license verdict cannot
resolve to `keep`.

The release implementation now enforces review-session schema v2 and decision-receipt schema v2. Finalization
re-verifies every cached byte set, requires the original external evidence seal, accepts a source-page check only at
exactly HTTP 200 and the exact audited HTTPS URL, and publishes one canonical decision receipt with an exclusive,
non-overwriting write. Re-finalization is idempotent only when the existing bytes match the externally retained
decision-receipt digest; verification requires that digest and rejects mutation. Schema-v1 session/decision evidence
fails closed. Owner-policy authentication remains explicitly `not-cryptographically-authenticated`: the external
hash detects mutation but does not authenticate the owner or reviewer.

## 2026-07-21 online inspection checkpoint

The online session successfully captured all 100 rows and 79 unique remote byte sets under report
`sha256:4bee54bf0847f6de7a06443ffdf513055abfd85d0f2d6a67110f928518958830`. Three separate inspection lanes
reviewed the exact cached pixels. They found 26 identity failures, 17 mobile-pixel failures, and 91 rows that
remain outside the proposed automatic license policy. Thirty-one rows fail identity or pixel review; 28 should be
removed/replaced immediately and three require duplicate-target resolution and re-review. Only four rows clear
both the visual checks and proposed automatic license metadata gate.

The aggregate findings and row-level failure list are in
[S10_IMAGE_AUDIT_2026-07-21.md](S10_IMAGE_AUDIT_2026-07-21.md).
This inspection deliberately did not edit the decision template, approve a `keep`, or modify a shipping artifact.
The complete 100-row evidence and cached pixels remain only in the OS temporary session; the report digest and audit
Markdown do not reproduce those bytes. The now-implemented schema-v2 workflow retains reviewer rationale and exact
source-page checks, accepts `needs-owner` without converting it into approval, binds to the originally retained
evidence seal, rejects linked local paths, paces every request/retry, and seals the final receipt separately. The
existing temporary bundle predates that contract, is historical inspection evidence only, and will not be
grandfathered into a final release receipt.

## What the independent human reviewer must still do

For all 100 selected rows, a reviewer who did not curate the source result must inspect the actual pixels and
source page, then record a separate decision receipt bound to the canonical report SHA and the exact fetched pixels.
The owner must separately ratify and retain the policy receipt and hashes through the approved audit process; the
current implementation does not cryptographically authenticate that identity. The review must answer:

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

## Conservative policy proposal for owner ratification

> This is an engineering-risk proposal, not legal advice. Every retained image still needs its exact source-page
> terms checked, and publicity, privacy, trademark, moral-rights, or other non-copyright restrictions can apply.

Until the owner approves a broader policy, the runtime and pipeline should fail closed to Aurora unless a real
photo has one immutable receipt that proves all of the following:

- the exact displayed bytes, item identity, display role, source page, creator, license/version, license URL,
  required attribution, delivery mode, retrieval time, MIME type, dimensions, byte count, SHA-256, crop/change
  disclosure, reviewer verdicts, and release-artifact binding;
- an `exact-item` photo actually depicts the listed event or spot; a `verified-venue` photo is visibly labeled
  **Venue photo** and depicts that stable venue; a `contextual` image is labeled as contextual and is used only on
  generic guide, neighborhood, category, or editorial surfaces, never as the item's photo or as image coverage;
- adjacent mobile credit plus a complete Credits-ledger entry. Public-domain media keeps provenance credit even
  where attribution may not be legally required; and
- a current, reachable source page and a license in the ratified allowlist. A raw image URL, a credit-shaped
  artifact field, an inferred license, or a successful HTTP response is not approval.

The proposed automatic allowlist is intentionally narrow: owned/commissioned media with a retained rights record;
CC0 1.0; a verified public-domain basis; and CC BY 4.0. CC BY-SA 4.0 is proposed only if the owner accepts and the
receipt captures its ShareAlike obligations for adaptations. Older CC versions, government/operator terms, and
special permissions require manual exception receipts. Event aggregators, social networks, arbitrary CDNs,
tourism/library feeds, stock services, arbitrary OSM `image` values, ambiguous `Attribution`, fair-use/non-free
claims, and missing/unknown/inferred terms remain blocked.

This proposal follows the primary license guidance: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
permits commercial sharing and adaptation but requires appropriate credit, a license link, and change disclosure;
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) adds ShareAlike for adaptations. Wikimedia's own
[outside-reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) says each
file can carry different obligations, provides no warranty for license accuracy, recommends verifying the file
page and non-copyright restrictions, and says direct hotlinking is possible but not recommended. The proposed
default is therefore self-hosted, content-addressed bytes when the verified terms permit it, with remote Commons
delivery only as an explicitly recorded transitional mode.

New Mapillary expansion remains disabled until the owner approves the current API/terms, commercial-use,
self-hosting, crop, privacy, and attribution posture. The 35 existing Tampa crops are not grandfathered into a
positive policy decision: each must independently pass place identity, crop/change disclosure, license, source,
privacy, and attribution review or fall back to Aurora.

Proposed numeric targets for the two flagship cities are:

- 100% of displayed real photos have a release-bound ready receipt, policy pass, and visible credit; zero images
  come from a non-allowlisted source or have misleading cross-place reuse;
- the independent 100-image audit has zero identity, pixel, or credit/license errors after every failed row is
  removed, corrected, or replaced by Aurora;
- at least 70% of a frozen deterministic top-tier flagship-spot denominator and at least 25% of all flagship spots
  have approved exact-place photos; and
- at least 95% of a frozen top-tier flagship-event denominator have an approved visual treatment, with real-photo
  and Aurora rates reported separately so generated treatment cannot masquerade as photo coverage.

The owner must ratify the license allowlist (especially BY-SA), Mapillary posture, self-hosting/storage budget,
mobile credit placement, numeric targets and their frozen denominators, independent-review/signature process, and
permission/takedown workflow. Engineering may implement the fail-closed schema, role labels, hashes, receipts,
fallbacks, and tests before those decisions; it may not mark an image `keep` or Sprint 10 green on the owner's
behalf.
