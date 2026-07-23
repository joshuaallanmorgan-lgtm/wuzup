# Sprint 10 flagship image audit - 2026-07-21

**Status: yellow.** This preserves the reproducible engineering inspection of the
original frozen 100-row flagship sample and the exact corrective action it caused.
It is not an owner policy approval, legal opinion, or final release receipt. The
failed shipping claims have now been quarantined; the corrected release population
still requires a fresh independent schema-v2 review.

## Evidence binding

- Review report: `sha256:4bee54bf0847f6de7a06443ffdf513055abfd85d0f2d6a67110f928518958830`
- Population: 100 rows, exactly 50 Tampa Bay and 50 SF/East Bay
- Reviewed bytes: 79 unique remote references, downloaded with exact URL, byte,
  MIME, dimension, and SHA-256 evidence
- Inspection: three separate Codex inspection lanes reviewed rows 1-34, 35-67,
  and 68-100. This separation helps catch obvious identity and mobile-quality
  errors, but it is not the independent human/owner sign-off required by the
  Sprint 10 exit gate.
- Working bundle: the exact pixels and complete 100-row byte evidence currently
  live only in an OS temporary review session. This document preserves aggregates
  and row-level failure findings; its durable report hash does not reproduce the
  temporary evidence. The temporary directory is not a release authority and
  must not be referenced by production.

The conservative policy evaluated here is the proposal in
`planning/v2/S10_IMAGE_REVIEW.md`: automatic metadata clearance is limited to
owned/commissioned media with a rights record, CC0, verified public domain, and
CC BY 4.0. BY-SA, older CC versions, missing public-domain basis links, and
Mapillary remain `needs-owner`. A source label was evidence, never proof that
the pixels depicted the listed item.

## Results

| Gate | Pass | Fail / needs owner |
| --- | ---: | ---: |
| Exact-item identity | 74 | 26 fail |
| Mobile pixel usefulness | 83 | 17 fail |
| Proposed automatic license policy | 9 | 91 needs owner |
| Identity and pixel together | 69 | 31 fail one or both |

Only rows 52, 81, 83, and 93 clear both the current identity/pixel inspection
and the proposed automatic license metadata gate. Row 52 is merely a usable
fallback; rows 81, 83, and 93 are the only strong policy-ready candidates. Even
those four remain non-final until the owner ratifies the policy and a new
schema-v2 release session records exact HTTP-200 source-page verification and an
exclusively published, externally sealed decision receipt.

Twenty-eight rows should be removed or replaced now, independent of the pending
license decision. Three more rows may survive only after resolving misleading
cross-item reuse and re-reviewing the retained target.

## Remove or replace before release

| Rows | Finding |
| --- | --- |
| 2, 46 | An Amtrak/Ybor streetscape is used for Foundation Coffee and the Ybor City Museum rather than depicting either item. |
| 8 | A generic skyline/palm view does not establish the listed park. |
| 10, 34 | Fort Hamer Bridge/docks are reused for the park and boat ramp without proving either exact item. |
| 13 | The exact coffee storefront is too blurry for the mobile image bar. |
| 14, 31 | A reservoir overview is reused for a boat ramp and canoe/kayak launch; neither access point appears. |
| 21 | The credible Banyan storefront is too blurred for the mobile image bar. |
| 23 | A fruit close-up is not a useful or identifying park image. |
| 24 | The Beangood subject is tiny, dark, tilted, and soft. |
| 25, 43 | A people-first beach portrait is reused for the park and sand launch rather than depicting either listing usefully. |
| 28 | Bro Bowl pixels are assigned to the broader Perry Harvey Sr. Park listing. |
| 29 | A generic access road does not establish Colt Creek State Park. |
| 36 | The Foundation Coffee drive-by is dark, distant, and ambiguous. |
| 37, 40 | One mangrove-channel image is reused for a boat ramp and kayak beach but shows neither access point. |
| 39 | The Indian Shores Coffee roadside capture is too dark and unclear. |
| 49 | A bikini-model portrait is not a place-identifying Del Bello Park image. |
| 51 | A portrait of Don Castro is not an image of the recreation area. |
| 54 | A generic Unsplash beach does not establish San Francisco's Ocean Beach. |
| 56 | The 1280x224 Sutro Heights panorama cannot produce a useful mobile crop. |
| 62 | A wood-chip/parking scene neither shows Lake Chabot nor establishes the listed park. |
| 78 | An electric-unicycle group dominates the Presidio candidate; it is contextual activity, not a representative exact-place image. |
| 85 | Coit Tower is shown for the distinct Coit Tower Cafe listing. |
| 91 | The Candlestick candidate centers the demolished stadium and is materially outdated for the current recreation area. |
| 95 | The 1280x237 Dinosaur Hill panorama is too shallow and generic for a useful mobile card crop. |

Conditional dedupe/re-review rows:

- Row 6 credibly depicts Bro Bowl, but the identical bytes are also assigned to
  Perry Harvey Sr. Park. Retain for at most the exact Bro Bowl item.
- Row 18 credibly depicts the Morris Bridge area, but the identical bytes are
  assigned to two overlapping place identities. Choose one canonical target.
- Row 22 credibly depicts Hammock Park's boardwalk, but the identical bytes are
  also assigned to the distinct paddlecraft-access item. Retain for at most the
  park after re-review.

## Corrective release-candidate publication - 2026-07-21

The audit preimage was corrected without rerunning image acquisition. A per-city,
item-keyed quarantine now blocks the reviewed items in both the Commons/Mapillary
enrichment path and Mapillary Stage B. The correction writer refuses any candidate
whose image, source page, or source family differs from the reviewed tuple; it
cannot use this historical audit to strip a later replacement. Runtime generation
keeps each quarantined item on Aurora until a later positive review changes the
registry explicitly.

- Tampa removed 23 display claims: its 20 unconditional failures, the paddlecraft-
  access duplicate, and both unresolved Morris Bridge identities. Exact Bro Bowl
  and Hammock Park remain item-scoped candidates for the next review.
- SF/East Bay removed all eight unconditional failures.
- Five rejected Tampa Mapillary receipts and JPEGs were removed. Cache receipts,
  output files, and shipped local references now agree at 30/30/30; source
  `fetchedAt` was preserved.
- Attribution entries were pruned only when no retained place still used the exact
  source page. Shared references were not URL-denied globally.
- Artifact verification now rejects unreferenced local place images, preventing an
  unreferenced rejected JPEG from shipping through the mirrored directory.

The checked-in, artifact-bound, replay-validated correction receipts are:

- Tampa: preimage manifest `sha256:035cb1eed7e67d143c4b0739d8dd3c2373bd3af2e85562aad0fc4895651615b1`
  -> corrected manifest `sha256:7a9c4bb85d64c8488470691dc3b8f537e2ab3e2218534fa7def444d4ffc494e0`.
- SF/East Bay: preimage manifest `sha256:64bb1151dc6ab947689ac5fa661b563ce5951c7c1098a7c1733884ddccccddf9`
  -> corrected manifest `sha256:62a4dfb0bd4885c419cfa44ced14ca765c6471caabf3314fa38c86ca888f0799`.

The correction transaction writes a digest-bound recovery journal before it
removes the public trust pointer. That journal contains the exact places, cache,
attribution, and deleted-image preimages needed to recover from an ordinary
process interruption. Recovery restores and validates the reviewed preimage
off-pointer, then reapplies the correction; it never republishes the rejected
preimage. A journal beside a newer trusted manifest refuses mutation, and a
committed manifest/receipt pair is recognized without rollback. The temporary
journal is removed after verification, is not an audit log, and makes no `fsync`
or sudden-power-loss durability claim.

Future full-place and standalone image refreshes also reconcile safe orphan image
files before reseal, while artifact verification remains the final missing/orphan
reference guard. Those ordinary writers fail closed and do not inherit the audited
correction transaction's snapshot-based replay recovery.

The corrected deterministic 50/50 population is report
`sha256:5cda3c0d362ea1e98190d8fb77da889222d453694a9798061f1e386c14db368e`:
84 remote rows/references and 16 local rows. It is pinned and explicitly pending
review; it does not inherit a single verdict from the historical report above.

## License-policy exceptions

Rows 14, 25, 31, 43, 52, 54, 81, 83, and 93 carry metadata that fits the proposed
automatic policy. Five of those nine still fail identity or pixel review (14,
25, 31, 43, and 54), proving why a license-looking field cannot serve as an image
quality or identity gate. Every other row remains `needs-owner`, principally for
BY-SA, older Creative Commons versions, missing public-domain basis links, or
unratified Mapillary use.

## Required closeout

1. Keep every quarantined row on Aurora until a separately reviewed replacement;
   resolve the Morris Bridge canonical identity and re-review retained Bro Bowl and
   Hammock Park in the new population.
2. Ratify the license/version, Mapillary, storage, crop, attribution, and
   takedown policy; do not infer approval from a reviewer name or CSV value.
3. Rebuild the frozen population and obtain zero identity, pixel, and
   credit/license failures on exact release-bound bytes.
4. Preserve reviewer rationale, exact source-page verification, the original
   prepared evidence seal, the owner-policy receipt/hash, and the externally
   retained final-receipt hash. Publish the canonical decision receipt once with
   the exclusive-write schema-v2 workflow; it is immutable once created, not an
   append log. Owner/reviewer authentication remains a separate policy decision.
