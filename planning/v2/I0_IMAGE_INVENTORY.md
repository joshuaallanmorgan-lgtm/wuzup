# I0 imagery trust inventory

> **Status:** Sprint 1 deterministic measurement and compatibility foundation; supervised SF imagery remains pending
>
> **Authority:** [V2_PLAN.md](V2_PLAN.md) and [V2_SPRINTS.md](V2_SPRINTS.md). This inventory does not authorize
> a crawl, a generated-artifact rewrite, or public imagery expansion.

## Purpose

The existing artifacts mixed remote event images, credited Commons place images, and locally shipped
Mapillary crops without one reproducible inventory. They also contained a real pipeline drift: the committed
name-blind transcription workflow and deterministic Stage B used different names for the same safety guards.
I0 establishes a read-only audit and a small compatibility contract before another supervised image batch.

`shared/imagery-audit.mjs` reads a supplied repository root and city ID. It does not fetch, rewrite, stage, or
timestamp anything, so identical files produce identical JSON. `finder/mapillary-contract.mjs` is a pure
normalizer used by Stage B and directly covered by the focused test suite.

## Audit schema

`auditCityImagery({ repoRoot, cityId })` returns `schemaVersion: 1` with these sections:

- `events`: artifact total, image-bearing rows, exact unique URLs, self-hosted/remote/unknown location counts,
  dedicated provenance-or-credit presence, missing provenance, duplicated URL/reference counts, duplicate
  pressure, and deterministically sorted duplicate URLs;
- `places`: the same core image metrics plus local/remote counts and image coverage;
- `localImages`: image-file count under `finder/output/<city>/place-img`, readable dimensions, unique local
  references from places and Mapillary receipts, missing references, undecodable files, and unreferenced files;
- `mapillaryReceipts`: receipt availability and entry count, local references, dimensions checked, and exact
  receipt-versus-file mismatches;
- `findings`: stable codes, severity, affected count, and a deterministic message.

An image is self-hosted/local only when its artifact URL is root-relative. HTTP(S) and protocol-relative URLs
are remote. Provenance means a non-empty dedicated `imageCredit`, `imageProvenance`, or `imageAttribution`
field; the event's general source label is not silently treated as image provenance. Duplicate pressure is
`(image-bearing rows - unique exact URLs) / image-bearing rows`. It detects exact URL reuse, not perceptual
similarity. The 10% low-place-coverage threshold is an audit signal, not an owner-ratified product or release
target.

Stable finding codes are:

| Code | Trigger |
|---|---|
| `EVENT_IMAGE_PROVENANCE_MISSING` | At least one image-bearing event lacks dedicated image metadata |
| `EVENT_IMAGE_DUPLICATE_PRESSURE` | At least one event image URL is reused |
| `PLACE_IMAGE_COVERAGE_LOW` | Place image coverage is below the audit's 10% signal threshold |
| `LOCAL_IMAGE_REFERENCE_MISSING` | A local place/receipt URL does not resolve to a file |
| `LOCAL_IMAGE_FILE_BROKEN` | A local image file cannot be decoded for dimensions |
| `LOCAL_IMAGE_DIMENSION_MISMATCH` | A recorded receipt width or height disagrees with the readable file |

## How to run it

From the repository root:

```text
npm run test:i0
node shared/imagery-audit.mjs tampa-bay
node shared/imagery-audit.mjs sf-east-bay
```

The direct commands print the complete JSON report. Tests use only pinned repository artifacts and temporary
local fixtures; they make no network requests.

## Computed July 6-7 artifact baseline

These are measurements of the checked-in Tampa and SF/East Bay artifacts, not fresh-source claims. The
focused suite pins both build IDs and the actual event/place bytes, plus the Tampa Mapillary receipt's
canonical-LF text hash, so an artifact refresh must deliberately update this baseline and its tests together.

| Event metric | Tampa Bay | SF/East Bay |
|---|---:|---:|
| Total | 1,642 | 743 |
| Image-bearing | 1,439 | 678 |
| Unique exact image URLs | 630 | 534 |
| Self-hosted / remote | 0 / 1,439 | 0 / 678 |
| Dedicated provenance or credit | 0 | 0 |
| Reused references | 809 | 144 |
| Duplicate pressure | 56.2196% | 21.2389% |
| Distinct duplicated URLs | 58 | 11 |

| Place/local metric | Tampa Bay | SF/East Bay |
|---|---:|---:|
| Total places | 2,163 | 2,888 |
| Image-bearing | 139 (6.4263%) | 175 (6.0596%) |
| Local / remote | 35 / 104 | 0 / 175 |
| Dedicated provenance or credit | 139 | 175 |
| Shipped local image files | 35 | 0 |
| Missing / broken local files | 0 / 0 | 0 / 0 |
| Mapillary receipt entries | 35 | 0 (receipt absent) |
| Dimension checks / mismatches | 35 / 0 | 0 / 0 |

The original inventory found every Tampa Mapillary receipt recording width 1280 while every corresponding
readable local JPEG was 900x600. The July 15 repair derives width and height from the copied JPEG in Stage B
and corrects all 35 retained receipts to 900x600, so the mismatch finding is now absent. SF still has a tracked
`.gitkeep` only; it has no shipped local place JPEGs and no Mapillary receipt.

## Deterministic trust-debt repair - 2026-07-15

SF QIDs `Q4116375` and `Q5192966` both resolved to `East Bay Life Guard Training.JPG`. The photo is related
to the park operator/program but is not an exact photo of either the Briones-to-Mt-Diablo trail or Cull Canyon
destination. Both QIDs now fail closed through the city deny list. Offline image enrichment removed the two
place image/credit claims, pruned the unused attribution, and resealed the city set as build
`sha256:7b025d648b008ee914eefbc0df65cc20b2ec783d405db8958779eb11ce35a0d7` without changing event bytes,
place count, or any other image selection. Offline attribution pruning preserves the prior source `fetchedAt`
instead of making local ledger maintenance look like a new remote fetch.

The focused I0 contract now pins the corrected SF place bytes and Tampa receipt bytes, asserts that the
lifeguard image is absent, and requires every retained Tampa receipt to match the readable local JPEG. Stage B
reads actual copied-file metadata for all future receipts instead of assuming a requested source width.

## Stage-B schema drift and compatibility fix

`finder/mapillary-transcribe.workflow.js` emits `isDirectoryOrPylon`, `cafeIsDominantSubject`, and
`otherBusinessNameOnSign`. Stage B still read only the older `rjPylon`, `rjDominant`, and `rjOtherBiz` names.
Because missing boolean guards fail closed, ordinary results from the current workflow were ineligible and the
`reVerified` receipt could not become true. That explains the zero-yield supervised SF path without weakening
the fail-closed rule.

The compatibility module normalizes both schemas. Current fields take precedence whenever present; legacy
fields remain fallback input for saved transcriptions. Both booleans must exist. A directory/pylon always
fails. A non-dominant cafe fails when a specific conflicting business is named. The established exception is
preserved: a non-dominant result with no named conflicting business is not dropped for that fact alone. Stage
B now uses the same helpers for crop eligibility and `reVerified`; ranking, confidence/geometry thresholds,
output formats, and force-keep/force-drop verdicts are unchanged.

## What remains before supervised SF imagery

This foundation is not the supervised batch. Before that batch ships:

1. Ratify licensing, storage/proxy, attribution, and contextual-image policy; the audit does not choose policy.
2. Run the name-blind workflow on the planned supervised 40-60-item SF set, then adversarially review identity,
   pylon/dominance, credit, and crop quality rather than trusting a positive first pass.
3. Re-run this audit against the proposed receipt/local files and publish/reseal
   the city artifact only through the artifact-trust path.

## Explicit non-claims

Metadata presence is not proof that a license is correct, transferable, or sufficient for the intended use.
The audit does not contact source hosts, validate availability, inspect terms, authenticate authors, or infer
rights from a URL. Exact URL uniqueness is not perceptual uniqueness. The Stage-B compatibility fix does not
re-run vision, prove that a crop depicts the intended business, or certify a contributor's identity. The
pinned artifacts are inventory evidence only; this work does not claim fresh data, zero wrong-place images,
completed SF coverage, or full Sprint 1 completion.
