# Sprint 5 provisional relevance rubric

**Status:** `architect-default-awaiting-owner-ratification`.

This is a reproducible default for frozen Sprint 6 evaluation, not an owner-approved ranking policy and not authority to change production weights, drops, or labels. The packet is [rubric.v1.json](../../test/fixtures/relevance/rubric.v1.json); its validator pins the Tampa and SF/East Bay frozen fixture IDs, artifact provenance, and exact fixture-byte hashes. Those fixture judgments remain `draft-owner-review`.

## Proposed decisions for owner review

| Topic | Provisional decision |
| --- | --- |
| Relevance | 0 = not a credible lead in context; 1 = legitimate but weak/niche/low-information; 2 = credible choice; 3 = strong defensible lead after safety gates. |
| Actionable | Yes only when the item is usable for the specific frozen surface and time; no is not a legitimacy judgment. |
| Gem | `yes`, `no`, or `insufficient`; insufficient evidence never supports a gem claim. |
| Hard drop | Only objective non-product, wrong-market, cancelled, ended, or known false-merge defects. |
| Demotion | Legitimate low-information rows, business promos, chains, generic facilities, tribute bills, and recurrence overexposure remain reachable; they are demoted, not hidden. |
| Evidence language | Candidate = browse/listing only; recommended = supported recommendation; top-placement = receipt-backed top placement. Unsupported superlatives remain forbidden. |

## Proposed first-screen gates

For a three-item evaluated prefix: precision of 1.00; nDCG at least 0.90; zero known-bad, non-actionable, and duplicate exposure; source maximum share at most 35% where coverage allows; exact count-preserving reachability always.

An explicit limited-city state may report that fewer than three eligible actionable non-duplicates exist. It does **not** pass or waive unavailable precision/nDCG/source-share measurements, and it never waives the zero-leakage, zero-duplicate, or count-preserving gates.

## Ratification choices

The owner can ratify this packet unchanged or replace the definitions, gate values, hard-drop boundary, demotion treatment, claim language, and limited-city wording in a succeeding version. Until then, the frozen labels remain evidence for review rather than approved ground truth.
