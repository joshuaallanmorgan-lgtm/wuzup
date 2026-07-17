# Wuzup V2 - active sprint map

> **Status:** owner-ratified execution map; Sprint 3 active - 2026-07-15
>
> **Authority:** subordinate to [V2_PLAN.md](V2_PLAN.md). This file translates the current scope and
> dependency queue into delivery cycles; it does not admit features that the plan parks in V3.

## Executive answer

The minimum credible V2 program is a short Sprint 0 closeout plus **17 two-week sprints**. The nominal
elapsed time is about **35 weeks** if every gate passes on the first attempt. Five lanes run in parallel,
so the sprint count is driven by integration order and validation time, not by adding every lane's effort
end to end.

The schedule driver is honest United States coverage. The app, finder, deployment path, runtime state,
relevance model, imagery policy, and two-city product must become trustworthy before new locations are
published. Location architecture and source work can develop in parallel, but rollout cannot bypass those
gates.

This estimate assumes:

- Sprint 0 takes no more than three working days; Sprints 1-17 are two weeks each.
- H0, E0, U0, I0, and L0 are logical workstreams, not persistent chats. The V2 Architect is the sole
  integration owner and uses temporary in-task subagents only for read-only review or disjoint bounded work.
- A failed exit gate extends the current sprint; the program does not declare a partial gate green.
- "Full US" means any location resolves to truthful flagship, metro, thin, or not-covered behavior. It
  does not promise flagship depth in every market.
- Numeric relevance, imagery, and city thresholds remain proposed until the owner ratifies the baselines.
- Validation may use privacy-preserving product-health measurement or explicit research sessions, but it
  cannot be replaced by internal opinion.

## Dependency spine

```text
S0 base lock
  -> S1-S2 artifact trust
  -> S3 runtime truth and durable state
  -> S4 all P0 journeys
  -> S5-S6 quality + credible first screen
  -> S7-S10 whole existing product
  -> S11-S12 two-city beta
  -> S13-S15 diverse-city pilot and soak
  -> S16 nationwide public beta
  -> S17 V2.0 general availability
```

Imagery and location-foundry work begin in Sprint 1 and continue behind these gates. They are not deferred
until Sprint 13; only their public expansion is deferred.

## Foundation and trust

### Sprint 0 - Baseline correction and program lock (up to three days)

**Outcome:** every worker starts from the same real base, with the same scope and decision queue.

Committed scope:

- Record `e7782d9` as the provisional `V2_BASE_SHA` and reconcile stale coordination status.
- Re-run the root gate, app lint/build, and `git diff --check`; preserve the current 129/129 receipt or
  record its tested successor.
- Capture starting artifact hashes and baseline quality, source, image, payload, accessibility, and core-
  journey reports.
- Open the owner decision log and schedule the freshness, planner-semantics, ranking, imagery, hosting,
  and source-policy rulings at their last safe decision points.
- Create bounded `imagery.md` and `us-coverage.md` specs without expanding V2 scope.

**Exit gate:** one pinned base, green verification, current docs agree, missing decisions have owners and
deadlines, and no worker depends on inaccessible prior-agent context.

### Sprint 1 - H0-A artifact contract and atomic generation

**Outcome:** the finder can produce a self-identifying, immutable city artifact set.

Committed scope:

- Define the shared artifact schema: schema version, city, IANA timezone, run/build ID, generated and
  expiry times, source health, counts, shards, and hashes.
- Emit the contract at the finder choke point and replace direct partial writes with atomic publication.
- Add selected-city staging for local development and deterministic negative fixtures.
- Start E0 frozen Tampa/SF rank and dedupe fixtures plus rank-path inventory.
- Start U0's independent filter, Search-scope, inert/focus, and false-copy fixes away from shared hotspots.
- Complete the I0 inventory and supervised SF imagery closeout; inventory L0's compile-time city assumptions.

**Exit gate:** the same frozen input produces the same identified bytes; wrong-city, partial, malformed,
expired, and hash-invalid sets are rejected by automated tests.

#### Sprint 1 execution receipt - 2026-07-14 (yellow)

- **Operating model:** the V2 Architect is the sole builder on `codex/v2-sprint-1`; temporary in-task
  subagents are read-only or receive disjoint, bounded work. The earlier persistent H0/E0/U0/I0/L0 task
  experiment was stopped to remove worktree/sidebar instability. The five labels remain lanes in this map,
  not five required sidebar tasks.
- **Pinned base:** `e7782d9ad70b12a435344ec676b7cc9dd34a6ff3`; the pre-implementation root gate passed
  129/129 with app lint/build and both city builds green.
- **Evidence captured:** Tampa's current finder `events.json` is 1,642 rows with stable IDs while the
  previously deployed `app/public/events.json` is 1,665 rows without them. Their SHA-256 hashes differ,
  proving the exact-byte guard is necessary rather than theoretical.
- **H0-A foundation implemented in this branch:** each city has a versioned sidecar with content-addressed
  `buildId`, exact-sidecar `manifestId`, city/IANA timezone, component run/provenance/freshness receipts,
  explicit shard seam, source health, byte/count hashes, and a sorted image-tree hash. Primary event/place
  writers publish through temp-and-rename, invalidate the old trust pointer before mutation, and seal the
  manifest last. A successful finder run issues a new run receipt even when payload bytes are unchanged;
  legacy snapshots remain explicitly `unknown` rather than being relabeled healthy or fresh. Supported
  derived imagery/description writers also invalidate before mutation and require an explicit reseal. The
  two-stage Mapillary flow keeps a non-public recovery receipt while its image-only intermediate state is
  untrusted; `places-images` publishes only after place references and image files agree.
- **Staging and refusal implemented:** local development locks `CITY` and `VITE_CITY`, launches Vite directly
  through Node on Windows, and stages only a verified selected-city set. Deploy verifies source and destination
  identities, removes the old pointer before flat-file publication, and leaves no manifest after an injected
  interruption. Wrong-city, missing-member, malformed-schema, invalid-expiry, expired, forged-prior,
  missing-local-image-reference, and hash-invalid sets fail closed.
- **Verification successor:** focused artifact contract 9/9; complete root gate 138/138, including finder,
  lint, Tampa/SF builds, base-path builds, exact-byte staging, and the real Windows Vite launch probe.
- **Current artifact posture:** Tampa build `65a75e81...` and SF build `df88fafe...` are honestly receipted from
  legacy July 6-7 snapshots. Both are expired under the proposed 48-hour event max age and retain source health
  `unknown`; strict freshness/source flags therefore refuse them. This branch does not claim a refresh occurred.
- **Sprint 1 gate remains yellow:** ratify the freshness SLA; keep render/cache provenance conservative until
  those adapters expose exact live/cache age receipts; and land the committed E0 fixture/rank inventory, U0
  independent truth/accessibility fixes, I0 inventory/SF imagery closeout, and L0 compile-time city-assumption
  inventory.
- **Held for Sprint 2 by design:** browser `loading | ready | stale | offline | error | empty` repository,
  removal of HTTP `Last-Modified` freshness, CI approval receipts, and the scheduled-refresh-to-production
  proof. Sprint 1 may define compatible seams but does not claim those exits early.

#### Sprint 1 lane-start receipt - 2026-07-14 (yellow)

- **H0-A committed:** `84a54b447fc480b46f2b601270fdd60a0ec8c404` is the independently reviewed
  artifact-trust foundation. The worktree was clean immediately after commit; H0 remains operationally
  honest that the current July 6-7 snapshots are expired and source-unverified.
- **U0 independent truth/accessibility slice implemented and independently reviewed:** event filters now apply
  `When AND Price AND Category` through one pure predicate, including chip-ID-to-category-value translation;
  Search renders and resets through a valid result scope; every inactive pager page is `inert` and
  `aria-hidden`; covered layers are hidden/inert; focus enters and returns from subpages/details; the filter
  dialog traps focus; primary navigation exposes the current page; and Spots no longer calls an unlocated/
  photo-first batch “Recommended near you” or the next unused batch “Worth the drive.” Focused U0 tests
  pass 3/3, app lint/build and diff hygiene are green, and a fresh 390x844 system-Edge journey verified filter
  entry/trap/return, Search scope preserve/reset/render and exact opener return, detail entry/exact-card return,
  and inactive-page isolation. The durable checked-in browser version remains scheduled with Sprint 4's
  Playwright seam rather than being hidden as an unscheduled prerequisite.
- **Current full-gate receipt:** 140/141 checks pass. The only failure is the unchanged live fast-finder
  corpus-health floor: two consecutive online runs produced 148 events against the 150 minimum. All finder
  benchmarks, artifact checks, U0 checks, lint, Tampa/SF builds, and base-path checks otherwise pass. The
  150-event gate was not weakened; Sprint 1 remains yellow until source health recovers or the corpus defect
  is diagnosed.
- **E0 inventory captured:** the current product has more than twenty independent rank paths. Frozen replay
  reproduced Tampa Home leading with a rehabilitation-hospital opening and document-automation promo, plus
  an SF New York-address workshop and a July-2026-to-December-2027 phantom range. The dependency-safe next
  slice is artifact-pinned Tampa/SF event-and-spot fixtures, context labels, actual-surface baseline orders,
  and pure evaluation metrics; production score weights and runtime wiring remain gated to Sprints 5-6.
- **E0 frozen evaluation foundation implemented:** `shared/relevance-eval.mjs` now provides a pure,
  count-preserving evaluator with nDCG, precision, known-bad leakage, actionability leakage, source/category/
  operator diversity, canonical/series duplicate lower bounds, and scoped gem-claim metrics. Versioned Tampa
  and SF fixtures pin artifact hashes, event/place generation timestamps, case type, context, candidate
  labels, actual surface orders, and diagnostic-only defect projections. `npm run test:e0` passes 7/7 and
  validates wrapper schema, exact permutations, hash-gated raw artifact facts, and receipt metrics. Labels
  remain `draft-owner-review`; no runtime ranking weights or production selectors were changed.
- **I0 inventory captured:** event image fields cover 1,439/1,642 Tampa rows and 678/743 SF rows, but collapse
  to 630 and 534 unique URLs with no retained event image credit/provenance. Real place imagery is only
  139/2,163 Tampa and 177/2,888 SF. Two known contextual/wrong place images were identified; all 35 Tampa
  Mapillary JPEGs are 900x600 while receipts claim width 1280; and the documented transcription workflow
  emits field names that Stage B does not read, forcing ordinary supervised SF candidates to zero. The next
  bounded slice is a deterministic image report plus schema/dimension/trust tests and correction of known
  wrong images before a supervised 40-60-item SF batch.
- **L0 inventory captured:** H0 supplies the reusable city artifact identity, but runtime identity remains
  compile-time, data stores and persistence are unkeyed, browser time is device-local, URLs are not durable,
  and finder/CI/deploy contain two-city assumptions. `finder/places.mjs` also loads Florida-only adapters on
  SF runs. The dependency-safe next slice is a pure synthetic location resolver and versioned cities-index
  contract that separates resolved locality from artifact pack, coverage tier from health, and metro depth
  from an honest thin/not-covered nationwide floor. React, workflows, and live crawling stay untouched.
- **Sprint 1 remains yellow:** land the
  I0 deterministic report and pipeline-contract fixes, then complete the supervised SF batch; land the L0
  synthetic resolver/contract; and record the owner freshness-SLA decision. None of these findings promote
  Sprint 5-6 ranking integration, Sprint 2 runtime loading, or public expansion into Sprint 1.

#### Sprint 1 I0 execution receipt - 2026-07-15 (yellow)

- **Deterministic inventory implemented:** `shared/imagery-audit.mjs` now reports event URL reuse/provenance,
  place coverage/credit, local references and decodability, Mapillary receipts, and receipt-versus-file
  dimensions without network access or mutation. The focused `npm run test:i0` gate passes 13/13 against
  pinned Tampa/SF artifacts plus synthetic missing/broken-file cases.
- **Baseline reproduced:** both cities have zero self-hosted event imagery and no dedicated event image
  provenance. Tampa has 35 readable local Mapillary JPEGs with 35 receipt-width mismatches; SF still has zero
  shipped local place JPEGs and no Mapillary receipt.
- **Stage-B drift fixed compatibly:** the ship guard and `reVerified` receipt now prefer the workflow's current
  `isDirectoryOrPylon` / `cafeIsDominantSubject` / `otherBusinessNameOnSign` fields while accepting legacy
  `rj*` aliases. Missing booleans, pylons, and named conflicting-business crops still fail closed; ranking,
  thresholds, output formats, and forced verdicts did not change.
- **Sprint 1 remains yellow:** this receipt is the deterministic I0 foundation, not an imagery closeout. The
  supervised 40-60-item SF batch, correction of known contextual/wrong images, dimension receipt repair, and
  owner licensing/storage/proxy/attribution decisions remain.

#### Sprint 1 L0 execution receipt - 2026-07-15 (yellow)

- **Synthetic location contract implemented:** a pure, self-identifying version-1 cities index validates city,
  timezone, bounding-box, coverage, artifact-pack, fallback, and US-region facts. Deterministic resolution uses
  query, then `/cities/<id-or-alias>`, then coordinates, and uses the default only when no explicit signal exists.
- **Honest load boundary established:** healthy unexpired flagship packs may load; degraded/unknown packs carry
  stable warnings; expired/failed packs refuse with stable codes; thin and not-covered fallbacks have no invented
  artifact URL. The 20/20 focused L0 tests also reject decoded URL traversal, inherited schema values, and
  incomplete shard/count sets, and prove that an injected later plan time refuses a previously ready expired pack;
  Tampa/SF, the `sf` alias, contiguous US, Alaska, Hawaii, outside-region, explicit-unknown, invalid-coordinate,
  identity-forgery, pack-state, and purity cases remain covered.
- **Sprint 1 remains yellow:** the fixture and regional boxes are synthetic contract data only. No React/runtime,
  finder/deploy, workflow, crawl, production-artifact, or public-location change landed, and this receipt does not
  claim full-US data coverage or complete Sprint 1.

#### Sprint 1 integrated gate receipt - 2026-07-15 (yellow)

- **All five foundation lanes are committed on the integration branch:** H0 `84a54b4`, U0 `254eb4e`, E0
  `72e2f87`, I0 `d4f7ded`, and L0 `c87eccf`. Their focused contracts, deterministic fixtures, and independent
  spec/quality reviews are retained as the Sprint 1 baseline; no runtime ranking, public city expansion, or
  unsupported imagery claim was smuggled into the foundation.
- **The last root-gate failure was diagnosed rather than threshold-weakened:** the July 7 static cache contains
  280 raw rows, of which 167 remain actionable on July 15 and 148 remain after merge/dedupe. All 14 configured
  static sources failed live fetch and used cache, while the old DNS-only probe incorrectly called the run
  online. I Love the Burg and Tampa Bay Events had already decayed to zero actionable cached rows; the result
  was a stale-cache fingerprint, not a merge regression.
- **Acquisition truth is now part of the immutable receipt:** `f6dd910` records `live-empty`, `live-error`,
  opaque source-adapter errors, and post-fetch processing errors separately. The unchanged `>=150` live corpus
  floor is bypassed only when the exact complete static-source set used cache after true fetch failures. A
  parser-zero, processing error, missing/duplicate receipt, mixed live/cached run, or viable partial live run
  remains fail-closed. Cache-write failure retains the live rows and reports degraded health instead of adding
  duplicate cached rows.
- **Integrated verification is green:** `npm test` passes 183/183, including artifact trust, E0, U0, I0, L0,
  finder, Tampa/SF and base-path builds, app lint, and deterministic failure-branch coverage. The gate repair
  passed separate spec and code-quality reviews; `git diff --check` was clean and the finder backup/restore left
  no generated-data drift.
- **Sprint 1 remains yellow by the ratified all-or-nothing rule:** the supervised 40-60-item SF imagery batch
  and owner freshness plus imagery-policy decisions remain open. Sprint 2 implementation does not inherit a false
  green status from the completed artifact/relevance/product-truth/location foundations.

#### Sprint 1 I0 trust-debt remediation receipt - 2026-07-15 (yellow)

- **Known false/contextual SF image claims are removed:** `Q4116375` and `Q5192966` both supplied the same East
  Bay lifeguard-training photo for different named destinations. The city deny list now sends both places to the
  honest art floor; offline enrichment removed their image/credit fields, pruned the unused attribution, and
  resealed the 2,888-place artifact without changing event bytes or any other image selection. The prune preserves
  the prior source-fetch timestamp rather than fabricating freshness. SF now has 175 credited remote place images
  rather than 177.
- **Mapillary dimensions are truthful and future-safe:** all 35 retained Tampa receipts now match their readable
  900x600 local JPEGs, eliminating all 35 `LOCAL_IMAGE_DIMENSION_MISMATCH` findings. Stage B records actual copied
  JPEG width and height for future supervised runs instead of hardcoding a requested 1280-pixel source width.
- **Focused verification is green:** `npm run test:i0` passes 14/14; the updated tests pin both corrected byte sets,
  require the two SF QIDs and lifeguard image to remain off-artifact, and require every Tampa receipt dimension to
  match its local file. Artifact trust and E0 focused gates also remain green, and the complete root successor
  passes 184/184 with finder, lint, Tampa/SF builds, and base-path checks included.
- **The remaining batch is externally gated, not silently simulated:** no SF Mapillary crop directory, candidate
  manifest, transcription set, receipt, or local JPEG exists. Candidate generation needs network access and a
  Mapillary token; shipping also requires name-blind transcription, independent adversarial review, a human
  eyeball, and the owner imagery-policy ruling. Until those inputs exist, SF stays on verified Commons images plus
  the art floor and Sprint 1 remains yellow.

### Sprint 2 - H0-A production-byte trust and runtime data states

**Outcome:** CI, deployment, and the browser agree on exactly which data is live and how failure is shown.

Committed scope:

- Make CI approve exact city bytes; make deploy validate those bytes and publish the manifest last.
- Add one runtime artifact repository for events and places with `loading`, `ready`, `stale`, `offline`,
  `error`, and `empty` states plus retry/recovery.
- Stop deriving freshness from HTTP `Last-Modified`; expose immutable generation age and source health.
- Prove one scheduled refresh PR and its resulting deployment end to end.
- Freeze the imagery receipt/credit schema and resolve the licensing/storage/proxy policy needed for build
  work; let L0 extend, rather than fork, the H0 manifest.

**Exit gate:** production hashes equal the approved hashes, stale/mixed/partial artifacts fail closed, a UI-
only deploy cannot change the data date, and the scheduled refresh has a repo-visible receipt.

#### Sprint 2 runtime and production-byte receipt - 2026-07-15 (yellow)

- **One browser repository now owns event and place artifacts:** it fetches one immutable manifest, verifies
  city, IANA timezone, schema, run/build/manifest identities, timestamps, source health, exact byte count,
  SHA-256, row count, and minimum payload shape before exposing anything. Events load at boot while places
  remain lazy; concurrent loads coalesce, retry refreshes every active kind atomically, a late old response
  cannot overwrite a newer generation, and a kind first requested during refresh joins the new manifest.
- **Runtime truth is explicit and time-aware:** `loading`, `ready`, `stale`, `offline`, `error`, and verified
  `empty` are distinct. Expired or failed-source rows are withheld, live ready data transitions to stale when
  its immutable expiry passes, malformed/future/non-object manifests fail closed, transport retry is bounded,
  and HTTP `Last-Modified` no longer participates in freshness. Immutable generation date and degraded/unknown
  source health are disclosed for both events and places.
- **The production-byte chain is closed:** Vite refuses a wrong-city, partial, hash-invalid, or caller-
  overridden staged set before building, embeds the verified staged `manifestId` into browser JavaScript, and
  copies that same public tree. CI and Pages deployment run a post-build verifier for Tampa and SF that requires
  source bytes, built bytes, built manifest, and the browser-embedded approval ID to agree before publication.
  The runtime then refuses any self-consistent live manifest that differs from the build-approved ID.
- **Failure UX was exercised rather than source-inspected only:** event-only subpages replace false zero-result
  copy with one actionable unavailable page; mixed surfaces retain a foreground disclosure; retryable failures
  offer Retry while a build-ID/integrity mismatch offers Reload Wuzup so an old tab can acquire the new bundle;
  remote event detail closes if its backing artifact becomes unavailable; the Spots calibration flow handles every terminal state;
  and place freshness/source health appear on Spots, Coverage, and Credits. A local mobile browser pass confirmed
  one visible accessibility-tree alert, enabled Back and Retry controls with non-overlapping bounds, immutable
  place provenance, and zero console errors.
- **Verification is green:** focused runtime 15/15 and artifact trust 11/11; app lint and production build pass;
  Tampa post-build verification approves `035cb1...615b1`; staged SF builds from its own scratch public tree and
  proves its embedded identity; the complete serial root gate passes 202/202, including finder, exact staging,
  Tampa/SF, base-path, relevance, imagery, location, product-truth, build, and lint contracts.
- **Sprint 2 remains yellow:** the committed Tampa event snapshot is correctly refused as stale (generated July
  7 under the 48-hour max age), and source health remains conservative where old receipts cannot prove a live
  run. A scheduled refresh PR plus resulting production deployment still needs a repo-visible end-to-end receipt,
  and the owner licensing/storage/proxy policy required for the imagery pipeline remains unresolved. Neither
  missing external proof is relabeled complete by this code receipt.

### Sprint 3 - H0-B city time, identity, persistence, and planner state

**Outcome:** time and user state mean the same thing across cities, devices, reloads, and refreshes.

Committed scope:

- Add one city clock and one actionable/ended-event predicate; correct all-day, range, DST, and ICS behavior.
- Migrate from title/URL-derived keys to stable IDs with dual-read, idempotent migration.
- Add versioned, city-scoped storage with schema validation and corrupt/quota recovery.
- Add atomic, reactive planner operations and retained snapshots.
- Correct geolocation permission state so denial or failure never appears enabled.

**Exit gate:** cross-city isolation, three non-city timezones, DST, corrupt storage, quota failure, refresh,
and migration tests pass; planner operations are idempotent and survive reload.

#### Sprint 3 city-storage foundation receipt - 2026-07-15 (yellow)

- **City isolation is now the default durable-state contract:** logical app keys map to versioned
  `twh:v2:c:<city-id>:` keys. Saves, recents, taste, plans, history, custom events, and the other existing
  stores inherit the active city through one storage seam; profile name/bio are the only explicit global
  exception. Storage-event listeners use the same canonical physical keys, taste-tuner fatigue is city-scoped,
  and Tampa's old weather key cannot be claimed by SF.
- **Legacy migration is deterministic and rollback-safe:** unscoped V1 bytes default to Tampa, V1's canonical
  root city, while an existing valid known-city ownership receipt remains authoritative. Copying is
  destination-first, idempotent, and copy-only; corrupt, wrong-version, and unknown-city receipts repair to
  the deterministic owner, and a failed repair remains closed until persistence succeeds. A forced
  re-entrant Tampa/SF first-load test proves both cities cannot inherit the same legacy bundle.
- **Quota, deletion, and malformed data fail honestly:** V2 values use an escaped envelope, so arbitrary user
  text cannot collide with deletion metadata; persistent tombstones prevent copy-only legacy bytes from
  resurrecting after reset. Failed writes remain usable only in the active session and return `false`.
  Settings now distinguishes a durable reset from a browser-blocked session-only reset, while malformed
  custom-event rows such as `[null]` are filtered before normalization instead of crashing launch.
- **Verification is green and independently reviewed:** focused city-storage tests pass 12/12; app lint and
  production build pass; the complete serial root gate passes 214/214, including finder, exact artifact
  staging, Tampa/SF and base-path builds, relevance, imagery, location, product-truth, and runtime contracts.
- **Sprint 3 remains yellow:** city-local clock/actionability/DST/ICS behavior, stable-ID dual-read migration,
  atomic reactive planner snapshots, and truthful geolocation permission state remain in the committed
  Sprint 3 scope.

#### Sprint 3 city-time contract foundation receipt - 2026-07-15 (yellow)

- **One device-independent calendar contract now exists:** `shared/city-time.mjs` owns IANA city-day identity,
  calendar-day arithmetic, zoneless and strict offset-bearing parsing, DST gap rejection and fold disambiguation,
  all-day/inclusive-range boundaries, half-open timed coverage, bounded assumed ends, city clocks, dayparts,
  status-aware actionability, and a single raw-event actionability wrapper. It does not use the host device zone.
- **The contract is deterministic and fast enough for runtime integration:** serialized results are byte-identical
  with the device configured for Los Angeles, Honolulu, and Tokyo. Cached formatters and per-city/day offset
  candidates reduce a full Tampa plus SF canonicalization pass from roughly 5.1 seconds to about 105 ms in the
  Node benchmark (68.9 ms for 1,642 Tampa rows; 35.8 ms for 743 SF rows).
- **Corpus posture is explicit:** SF canonicalizes 743/743. Tampa canonicalizes 1,640/1,642; the two refused rows
  contain explicit offset-bearing end instants earlier than their starts. They remain fail-closed for upstream
  correction rather than being silently reinterpreted. Same-day reversed *zoneless* clocks may infer a bounded
  overnight end and record that inference; explicit instants stay authoritative.
- **Verification is green and independently reviewed:** focused city-time tests pass 15/15; app lint and syntax/
  diff checks pass; the complete serial root gate passes 229/229. The tests cover 23/25-hour days, DST gaps/folds,
  strict offsets, exact expiry, equal-time assumed ends, overnight handling, mixed precision, status URLs,
  inclusive and half-open day coverage, and cross-device-zone invariance.
- **This is a foundation, not a runtime claim:** browser normalization, root actionable inventory, finder expiry,
  city-aware labels/dayparts/weather/Open Now, and TZID ICS still need to delegate to this contract before the
  Sprint 3 time gate is complete.

#### Sprint 3 browser city-time integration receipt - 2026-07-15 (yellow)

- **Discovery now has one actionable inventory:** browser normalization delegates start/end, range, status,
  and exact expiry to the shared city-time contract. Home, Events, Search, guides, notifications, and settings
  receive only actionable rows; Calendar, My Plans, My Saves, and day history retain ended snapshots.
- **The live clock is city-owned:** the shell refreshes at the selected city's midnight, after foregrounding,
  and at the next exact actionability boundary. Labels, day anchors, tonight/late mode, weekend fit, and ternary
  dayparts no longer inherit the device timezone.
- **Weather and supported Open Now claims are city-correct:** forecast keys use the city day, stated hours use
  the city clock, unknown hours stay closed, and explicit overnight ranges remain open after midnight only
  until their stated closing time.
- **Calendar exports now preserve the city contract:** timed ICS rows carry the selected city's IANA `TZID`,
  all-day rows use an exclusive `DTEND`, stable event IDs produce stable UIDs, stamps are coherent, and UTF-8
  lines fold at RFC 5545's 75-octet boundary. Invalid or dateless inventory fails closed.
- **Legacy calendar state migrates without changing meaning:** V1 device-midnight plan, history, conversion, and
  weekend keys rekey through a durable source-timezone basis before any data mutation. Collision merging,
  binary-to-ternary conversion, quota retry, corrupt metadata, and cross-device restart cases are idempotent.
- **Cross-device evidence is executable:** browser, share, and migration projections are byte-identical with Los
  Angeles, Honolulu, and Tokyo device zones. Focused time/ICS/migration tests pass 33/33 and the complete serial
  root gate passes 250/250, including finder, artifact trust, Tampa/SF and base-path builds, lint, and existing
  product contracts. Independent review approved the migration boundary after its singleton legacy case was fixed.
- **The adversarial browser follow-up is closed:** ambiguous weekday-abbreviation hours now fail closed instead of
  making a false Open Now claim; every add entry point rejects occupied slots and cross-slot/day duplicates;
  already-planned items leave Day suggestions; saved shelves and notifications resolve retained live lifecycle
  state; only genuinely ended events trigger attendance prompts; and unavailable details remove calendar/ticket
  actions in favor of an explicit status. Focused browser-time tests pass 12/12 and targeted re-review found no
  remaining P0/P1 in these journeys.
- **Sprint 3 remains yellow:** finder generation-time expiry and city-day derivation, stable-ID dual-read migration,
  atomic reactive planner snapshots, and truthful geolocation permission state remain.
  The two refused Tampa offset ranges still require upstream correction rather than silent reinterpretation.

#### Sprint 3 finder city-time integration receipt - 2026-07-15 (yellow)

- **Post-ingest generation now shares the city-time contract:** `finder/time.mjs` owns published identity days,
  canonical city days, generation context, actionability, calendar distance, and interval merge selection. The
  finder captures `Date.now()` once at run start and reuses that epoch for admission, today/weekend labels,
  imminence scoring, source-health receipt time, `generatedAt`, and the ended-output benchmark.
- **Intervals fail closed without sacrificing valid corroboration:** merge selection validates an end against both
  its publisher's own start and the chosen merged start, falls back to the latest deterministic valid member pair,
  and retains an invalid pair only when every explicit member is invalid. Adversarial regressions cover invalid-
  end laundering, valid-member poisoning, reversed input order, midnight-exclusive ends, and assumed ranges that
  cross midnight. Dedupe and span guards now consume the full canonical interval's `startDay`/`endDay`.
- **Identity compatibility is explicit:** stable-ID recipe `v1` continues to mint from the literal published ISO
  day, even when an offset-bearing instant projects onto a different city day. Non-ISO dates deterministically use
  `tbd`; product grouping, recurrence, tags, display days, sorting, and expiry use canonical city semantics.
- **Generation-time evidence is hash-bound:** the smoke gate no longer parses locale-formatted `events.md` or
  falls back to file modification time. It verifies the exact `app/public` artifact manifest, ratchets Tampa's two
  known `end-before-start` rows, requires zero ended valid rows at immutable generation time, and requires every
  fresh fast-finder row to be canonical and actionable at its own receipt time.
- **Verification is green and independently approved:** focused finder city-time tests pass 12/12; the complete
  serial root gate passes 262/262, including the real fast finder, exact artifact trust, Tampa/SF and base-path
  builds, app lint, and all browser-time contracts. Tampa remains SHA-256 `a8df0d0c...f875d090` (1,642 rows) and
  SF remains `84981a8e...873b1d8` (743 rows); `app/public` still matches the pinned Tampa bytes.
- **The boundary is deliberately narrow:** this receipt proves the post-ingest finder core, not every network
  adapter. `render.mjs` plus ten Tampa adapters still contain host-calendar derivation. Their queued follow-up is
  shared source-clock/run-epoch propagation, two mechanical adapter batches, render-date isolation, isolated
  St. Pete recurrence, and a three-device-timezone fixture ratchet before any end-to-end invariance claim.
- **Sprint 3 remains yellow:** complete the adapter/render follow-up, stable-ID dual-read migration, atomic reactive
  planner snapshots, and truthful geolocation permission state. The two pinned Tampa invalid rows remain explicit
  artifact debt until a newly generated artifact removes them; they are never silently reinterpreted.

#### Sprint 3 source-clock propagation receipt - 2026-07-15 (yellow)

- **One injected clock now reaches every adapter boundary:** the finder passes its immutable `runEpoch` to render
  and every city source module. Shared `sourceWindow` and `sourceStartDay` helpers require a finite epoch, use IANA
  city days and calendar arithmetic across DST, and fail closed on malformed or unrepresentable starts.
- **Legacy source APIs remain compatible:** Do813 and DoTheBay accept the new options object without turning it into
  a corrupt base URL, while retaining their no-argument and explicit string-base calls. No adapter output or cache
  was regenerated in this foundation slice.
- **Verification is green and independently approved:** source-clock tests pass 7/7 across Los Angeles, Honolulu,
  and Tokyo device zones; the full serial gate passes 269/269 and artifact hashes remain pinned. Review found no
  P0/P1 within this propagation/helper/options-compatibility scope.
- **No premature invariance claim:** existing adapters and render still need to consume `nowMs` internally. The next
  commits migrate the mechanical local-calendar and timestamp batches, isolate render dates and St. Pete recurrence,
  then add an all-target static/fixture ratchet before this part of Sprint 3 can turn green.

#### Sprint 3 Tampa HTTP source-time receipt - 2026-07-15 (yellow)

- **Four host-calendar adapters now consume the finder clock:** Do813, Don't Tell Comedy, Hillsborough Libraries,
  and Pinellas County derive requests, yearless dates, and inclusive admission windows from one injected epoch and
  Tampa's configured IANA zone. Invalid and DST-gap wall times fail closed; Do813's string-base CLI/API remains
  compatible; Pinellas paging and partial-success behavior are unchanged.
- **Raw source fixtures prove the boundary rather than normalized cache output:** deterministic API/HTML fixtures cover
  the prior day, exact city today, exact day `+45`, the following day, malformed dates, the spring-forward gap,
  year rollover, leap-day rollover, virtual rows, all-day projection, cross-page loading, and duplicate city listings.
  A fetch-injection seam keeps these parser tests isolated from network availability and shared global state.
- **Verification is green and independently approved:** focused source-time tests pass 13/13 and the complete serial
  gate passes 275/275, including the live-finder diagnostic, app lint/build, Tampa/SF builds, and artifact contracts.
  LA, Honolulu, and Tokyo probes emit byte-identical adapter results. Tampa remains SHA-256
  `a8df0d0c...f875d090`, SF remains `84981a8e...873b1d8`, and `app/public` still matches the pinned Tampa bytes.
- **Sprint 3 remains yellow:** this receipt covers four HTTP adapters only. The remaining timestamp-oriented adapters,
  DoTheBay's run-epoch consumption, VSPC's product-calendar window, render-date isolation, St. Pete recurrence, and the
  final all-target ratchet remain before adapter-level city-time is complete; identity, planner, and geolocation work
  also remain in Sprint 3.

#### Sprint 3 VSPC source-time receipt - 2026-07-15 (yellow)

- **The browser-heavy St. Pete/Clearwater source now separates product time from elapsed time:** its inclusive 45-day
  occurrence window comes from the injected finder epoch and Tampa's configured zone. Browser deadlines, retry ages,
  render pacing, and scrape-failure timing remain live elapsed-time mechanics rather than being frozen incorrectly.
- **Detail-page clocks are DST-correct at the actual wall time:** same-day human-visible clocks resolve through the
  shared zoned parser, spring-forward gaps stay date-only, and fall-fold starts/ends follow the canonical earlier/later
  policy. The source no longer stamps every clock with a noon-derived daily offset or compares offset strings as time.
- **The normalized cache is bound to the city day it represents:** new receipts persist `windowDay`; ordinary fresh
  hits require that day plus a finite, nonfuture age. Legacy and mismatched-day receipts cannot hide the next recurring
  occurrence after midnight. Explicit `SKIP_RENDER` and scrape-failure fallbacks remain available as degraded paths and
  report both cached and requested windows.
- **Verification is green after a caught review defect:** raw listing fixtures cover both window boundaries, recurrence,
  short ranges, cancelled/outside rows, summer/winter offsets, DST gaps/folds, and cache rollover. Focused tests pass
  6/6 across LA, Honolulu, and Tokyo; the complete serial gate passes 281/281. Independent review found the midnight
  cache defect, verified its test-first repair, and approved the resulting scope with no remaining P0/P1.
- **Pinned artifacts are unchanged:** Tampa remains SHA-256 `a8df0d0c...f875d090`, SF remains
  `84981a8e...873b1d8`, and `app/public` still matches Tampa. Sprint 3 remains yellow for the timestamp-adapter batch,
  DoTheBay run coherence, render-date isolation, St. Pete recurrence, final static ratchet, identity, planner, and
  geolocation work.

#### Sprint 3 timestamp-source receipt - 2026-07-15 (yellow)

- **Four more Tampa adapters now share the immutable run clock:** Meetup, City of Tampa RSS, University of Tampa
  Trumba, and WMNF derive their inclusive city windows from the injected epoch and Tampa zone. Every list, category,
  and WMNF detail request accepts the deterministic fetch seam; Meetup keeps its production pacing while tests inject
  a no-op wait. CLI/no-argument behavior retains a single `Date.now()` compatibility fallback per public boundary.
- **Eligibility uses city-projected instants without rewriting publisher data:** offset-bearing rows can cross their
  literal date into or out of Tampa's window, zoneless DST gaps fail closed, and accepted start/end strings remain the
  source literals for identity compatibility. WMNF selects its earliest occurrence by canonical epoch with a stable
  raw tie-break, including mixed-offset inputs, while still emitting the chosen publisher timestamp unchanged.
- **All-day duration is calendar-correct:** Trumba applies one strict exclusive-midnight rule to both its phantom-range
  gate and emitted inclusive end. Exact 30-day coverage remains reachable; 31-day exclusive and non-midnight inclusive
  ranges are rejected even across the spring DST transition.
- **Verification is green after two review defects were fixed:** raw HTML, XML, and JSON fixtures cover Meetup's six-
  page dedupe/pacing, RSS end validation, WMNF inline/detail paths and mixed offsets, Trumba 30/31-day semantics, both
  window boundaries, malformed rows, virtual/cancelled rows, and LA/Honolulu/Tokyo byte equality. Focused tests pass
  5/5; the complete serial gate passes 286/286. Independent review caught the initial WMNF lexical ordering and
  Trumba inclusive-range undercount, then approved their test-first repairs with no remaining P0/P1.
- **Pinned artifacts are unchanged:** Tampa remains SHA-256 `a8df0d0c...f875d090`, SF remains
  `84981a8e...873b1d8`, and `app/public` still matches Tampa. Sprint 3 remains yellow for DoTheBay run coherence,
  render-date isolation, St. Pete recurrence, the final source ratchet, identity, planner, and geolocation work.

#### Sprint 3 DoTheBay run-clock receipt - 2026-07-15 (yellow)

- **SF's DoStuff adapter now consumes the finder epoch:** its inclusive 45-day window and start validation use the
  configured SF/East Bay zone; list fetches and polite page waits are injectable; no-argument and explicit string-base
  calls remain compatible. The existing corridor bbox policy is unchanged, and invalid spring-gap starts fail closed.
- **The fixture cannot pass by going empty:** raw DoStuff rows cover both window boundaries, prior/after inventory,
  a DST gap, and an out-of-corridor record. Direct and LA/Honolulu/Tokyo probes require two exact emitted rows rather
  than accepting byte-identical empty output. Source-time tests pass 15/15; the serial gate passes 288/288; independent
  review approved the scope with no P0/P1.
- **Artifacts remain pinned:** Tampa is `a8df0d0c...f875d090`, SF is `84981a8e...873b1d8`, and `app/public` matches
  Tampa. Sprint 3 remains yellow for render-date isolation, St. Pete recurrence, the final source ratchet, identity,
  planner, and geolocation work.

#### Sprint 3 render-source city-time receipt - 2026-07-15 (yellow)

- **Creative Loafing parsing is bound to one Tampa run day:** the finder epoch now creates one parser reused by
  listing dedupe, ordinary-card parsing, and promoted-card enrichment. Yearless dates use Tampa calendar arithmetic,
  preserve the exact 14-day rollover cutoff, choose the first future occurrence, and reject impossible civil dates
  instead of allowing host `Date` normalization. Browser navigation delays remain live elapsed-time mechanics.
- **Render cache time is explicit and fail-closed:** reads use the same injected epoch, require `0 <= age < TTL`, and
  reject future or malformed receipts. Cache writes stamp the finder epoch, while standalone runs retain their
  compatibility fallback by capturing `Date.now()` once at the public boundary.
- **The regression exercises the real parser path:** a raw Creative Loafing card pins New Year selection and a time
  range; cutoff, future-occurrence, impossible-date, strict-clock, cache-boundary, and static wiring tests prevent a
  host-local path from returning. LA/Honolulu/Tokyo probes are byte-identical. An independent review caught the
  Tampa-only parser initially borrowing the active city's timezone; an active-city regression failed first, the
  parser now imports Tampa's own city zone, and the repair was approved. Focused tests pass 8/8 and the complete
  serial gate passes 296/296.
- **Artifacts remain pinned:** Tampa is `a8df0d0c...f875d090`, SF is `84981a8e...873b1d8`, and `app/public` matches
  Tampa. Sprint 3 remains yellow for St. Pete recurrence, the final all-source ratchet, stable-ID dual-read migration,
  atomic reactive planner snapshots, and truthful geolocation.

#### Sprint 3 St. Pete recurrence receipt - 2026-07-15 (yellow)

- **Revize recurrence is now city-calendar deterministic:** strict civil parsing replaces worker-local `Date` math;
  the inclusive Tampa 45-day window, DAILY/WEEKLY/MONTHLY intervals, ordinal and last weekdays, COUNT, timed UNTIL,
  RDATE, EXDATE, dedupe, year rollover, and leap days all use shared calendar primitives. Impossible days and clocks
  fail closed; nonexistent spring-gap starts are omitted without ending the series; fold occurrences preserve the
  publisher's advertised wall-clock end.
- **The 5.9 MB source cache cannot conceal a new city day:** freshness requires the requested Tampa `windowDay`, a
  valid event array, and `0 <= age < 6h`; future, malformed, legacy, wrong-day, and exact-TTL receipts miss. Fetch,
  read-cache, and write-cache seams consume one injected finder epoch, while standalone compatibility captures
  `Date.now()` only at the public boundary.
- **Raw fixtures cover the failure modes:** the main corpus emits exactly 12 expected rows including 23:59 on the
  last day, plus nonempty fold, New Year, leap, UTC recurrence, and elapsed-duration probes. LA/Honolulu/Tokyo
  output is byte-identical. Independent review caught both missing UTC compatibility and loss of the publisher's
  UTC recurrence basis across DST; both were repaired test-first and the follow-up review approved the result with
  no remaining P0/P1. Focused tests pass 9/9 and the complete serial gate passes 305/305.
- **The follow-up inventory widened before the final ratchet:** six live adapters still ignore the injected epoch:
  Tampa AllEvents and Visit Tampa Bay, plus SF Meetup, SF Rec & Parks, UC Berkeley, and Visit Oakland. They are the
  next bounded clock batch; Sprint 3 remains yellow for that batch, the all-source ratchet, stable-ID dual-read and
  retained planner snapshots, atomic planner reactivity, and truthful geolocation.

#### Sprint 3 all-source clock receipt - 2026-07-15 (yellow)

- **Every live adapter now consumes one finder epoch:** Tampa AllEvents and Visit Tampa Bay plus SF Meetup, UC
  Berkeley, Visit Oakland, and SF Rec & Parks accept injected clocks and transports; Meetup also accepts injected
  pacing. Their inclusive today-plus-45 city windows use city-projected starts, so offset timestamps can cross a
  lexical day without crossing the eligibility contract, while zoneless values are interpreted only in their city.
- **Publisher clocks are no longer fabricated at a midnight/noon offset:** one shared wall-time resolver applies the
  offset at the exact event time, rejects impossible civil dates and spring-gap clocks, and disambiguates fold starts
  earlier and fold ends later. Both Simpleview adapters retain honest date-only rows, and Rec & Parks validates its
  human-readable date and clock grammar before publishing an event.
- **The boundary is enforced for all 17 adapters:** an automatically enumerated ratchet rejects ambient/local `Date`
  calendar paths, adapter-local `Intl` and UTC calendar arithmetic, implicit helper instants, and hardcoded city
  zones. Shared day/offset helpers now require an explicit instant. VSPC uses the shared calendar-day difference,
  names its live operational clock separately, and stamps its artifact cache with the injected run epoch.
- **Verification and review are green:** raw fixtures require nonempty first/last-day, offset, zoneless, gap, fold,
  malformed, request, pacing, and LA/Honolulu/Tokyo invariance behavior. The combined source batch passes 50/50,
  independent review passes 26/26 with no P0/P1, and the complete serial gate passes 325/325 including build, lint,
  both city builds, and base-path checks.
- **Generated bytes remain pinned:** Tampa and `app/public` remain SHA-256 `a8df0d0c...f875d090`; SF remains
  `84981a8e...873b1d8`. Sprint 3 remains yellow only for stable-ID dual-read and retained planner snapshots, atomic
  planner reactivity, and truthful geolocation/runtime city resolution.

#### Sprint 3 identity-contract foundation receipt - 2026-07-15 (yellow)

- **Stable IDs are now a tested compatibility contract, not yet a runtime key flip:** the pure identity module
  keeps the exact V1 `(URL or original title)|published start` key beside valid 16-hex finder IDs, preserves existing
  `p|` place keys, introduces persistent `c|` identities for local events, and rejects malformed IDs instead of
  minting unusable primary keys.
- **Resolution fails closed on conflicting evidence:** historical aliases form an equivalence graph, but an alias
  that reaches more than one live primary returns `ambiguous` rather than selecting the first row. An exact unique
  current stable primary remains authoritative. Empty/corrupt `|` identities cannot enter the graph or compare equal,
  and duplicate custom IDs are deterministically reminted without changing their first owner.
- **The regression corpus uses observed refresh drift:** Gulfport's unchanged stable ID bridges a date-only-to-timed
  legacy-key change; Train's unchanged URL/start bridges a stable-ID change; a removed Tampa event remains missing;
  and a genuinely new SF row cannot inherit old state. Both committed artifacts also prove every current event yields
  one unique valid stable primary.
- **Verification and review are green for this bounded foundation:** focused identity tests pass 10/10, app lint
  passes, the complete serial root gate passes 335/335, and independent review found no P0. Its corrupt-identity P1
  was reproduced and fixed test-first.
- **No migration is claimed yet:** the reviewer correctly noted that actual V1 saves omit stable IDs while plans and
  recents retain only legacy strings. The next identity slice must migrate those exact bytes destination-first,
  retain unresolved/ambiguous rows, prove quota/retry/idempotence behavior, preserve new snapshot aliases, and keep
  V1 rollback bytes untouched before any consumer switches to stable primaries. Sprint 3 therefore remains yellow
  for stable-ID dual-read integration, retained atomic planner state, and truthful geolocation/runtime city resolution.

#### Sprint 3 identity migration and custom-event durability receipt - 2026-07-16 (yellow)

- **The pre-V2 compatibility gap is explicit and bounded:** a checked-in, city-isolated seed contains exactly the
  25 Tampa V1 legacy aliases whose current legacy key changed while a stable-ID chain still proves identity. Its
  canonical 3,036-byte payload is pinned at SHA-256 `15a20535...d342c3`; SF intentionally has zero seeds because
  its eight unmatched id-less V1 aliases have no safe bridge and must remain unresolved.
- **Exact V1 state now has a pure lossless destination transform:** saved maps, Been-there rows, recents, event-deck
  memory, active plans, and day history retain counts, order, snapshots, status, and slot topology. Unique evidence
  attaches stable primary plus aliases; missing and ambiguous references remain explicit without a guessed primary.
  Historical seeds are graph evidence only and can never invent a live catalog candidate.
- **Local events receive identity only after durability is proven:** valid new and migrated custom rows use persistent
  `c|` IDs; a blocked write keeps the usable legacy identity and untouched durable bytes retryable. Missing browser
  ID support still persists the legacy row, duplicates retry before claiming success, and an unremintable duplicate
  strips only the later owner back to a collision-free legacy identity. App state consumes the canonical write result
  immediately, and Add Event tells the user when the browser could not save beyond the current visit.
- **Focused verification is green:** the identity/storage group passes 36/36, app lint and production build pass,
  and every seed resolves to one current committed Tampa primary while differing from its current legacy alias.
- **This is not yet the consumer cutover:** the pure transform and seed are ready, but destination-first persistent
  V2 save/Been/recents/deck stores and the atomic planner store still need to land before `keyOf` can switch. V1 bytes
  remain untouched for rollback, and Sprint 3 remains yellow for that wiring plus geolocation/runtime city resolution.

#### Sprint 3 atomic planner reducer foundation receipt - 2026-07-16 (yellow)

- **Planner mutations now have one deterministic contract:** the versioned document owns active days, retained
  history, revision state, and per-cell mutation tokens. Add, exact-slot move, remove, rest, undo, and rollover are
  pure count-preserving operations; occupied slots, duplicates, rest conflicts, and stale expectations fail without
  silently selecting another day or daypart.
- **Undo is compare-and-act rather than shape-based:** every affected slot or rest state receives a persisted
  generation token. Receipts remain valid across unrelated edits, but same-primary re-adds, empty-after-intervening
  writes, repeated rest states, and move-away/back ABA cycles conflict instead of deleting or resurrecting newer
  state. Undo changes only its owned cell and preserves a newer day completion marker.
- **Retained value is useful but storage-bounded:** each event/place/custom reference keeps stable and legacy
  identity evidence plus an allowlisted snapshot. Snapshots are cycle-safe and capped at 4,096 exact serialized
  UTF-8 bytes with bounded depth, nodes, arrays, objects, keys, and strings. Alias reads are capped before expansion,
  persisted references are revalidated, and overbudget primary identities fail closed.
- **Done-only and historical state survive honestly:** removing the final slot does not erase a completion marker,
  rest transitions preserve it, past done-only days roll into history once, history remains capped, and rollover
  removes expired mutation tombstones without disturbing future cells.
- **Verification and review are green:** the focused reducer suite passes 36/36, app lint passes, and independent
  review plus additional probes found no P0/P1 across malformed receipts/tokens, same-day moves, unrelated-slot undo,
  rollover cleanup, snapshot attacks, or alias-prefix enforcement.
- **This is still a foundation, not the UI cutover:** the reducer is not yet backed by the destination-first
  city-scoped persistent store or wired into Add-to-day, Calendar, Profile, and My Plans. V1 planner bytes remain
  untouched for rollback, and Sprint 3 stays yellow until that reactive persistence and journey integration land.

#### Sprint 3 destination-first planner persistence receipt - 2026-07-16 (yellow)

- **V1 planner state now has one pure, lossless migration path:** exact-version active plans and history project
  device-midnight keys into the selected city calendar, preserve canonical-key precedence, convert the old binary
  day slot to afternoon, fold only the current weekend, and roll past plans into retained history. Snapshot recovery
  may cross one unambiguous historical seed component, but unresolved rows keep their legacy primary and explicit
  missing/ambiguous evidence; no seed can invent a stable attachment.
- **The destination is city-scoped, reactive, and rollback-safe:** `planner-v2` uses a validated envelope with
  immutable retained references, bounded migration metadata, a 3 MiB exact UTF-8 document cap, stable subscriptions,
  storage-event reloads, and destination-first initialization. Valid existing V2 bytes win, corrupt destinations
  require explicit recovery, and every V1 source byte remains untouched.
- **Durability and concurrency fail honestly:** physical-only reads verify that a write actually landed instead of
  accepting a legacy dual-read or session fallback. Quota failures remain explicit `session-only` state with retry;
  Web Locks serialize cooperating tabs, the optimistic fallback detects conflicts, operation and commit IDs remain
  distinct across tab contexts, and commits cannot self-parent. Pending work rebases only when every exact reducer
  precondition still holds.
- **Planner reads now share one bounded identity model:** event, place, and custom catalogs resolve separately;
  current live fields may refresh a retained snapshot, missing rows remain usable, and ambiguous evidence never
  first-wins. Exact stable primaries outrank weak aliases only when the current catalog proves them, planned identity
  sets are kind-qualified, and hostile aliases, candidates, depth, cycles, strings, and collections are capped before
  resolution or rendering.
- **Verification and review are green:** focused city-storage plus planner suites pass 88/88; the complete serial
  repository gate passes 425/425, including finder, artifact trust, Tampa/SF and base-path builds, product truth,
  relevance, imagery, location, lint, and production build contracts. Independent migration, selector, and store
  reviews approve the final implementation after adversarial regressions for wrong versions, oversized documents,
  ambiguous aliases, false durable reads, cross-tab ID collisions, self-parenting commits, and duplicate emissions.
- **The remaining planner gate is the atomic runtime cutover:** ten existing UI consumers still read or write the V1
  planner. The next slice must add the city-keyed provider and raw V1 source adapter, switch every writer and reader
  together, remove silent quick-add behavior, and render current/future retained plans in My Plans. Sprint 3 remains
  yellow for that journey integration plus truthful geolocation/runtime city resolution.

#### Sprint 3 atomic planner runtime cutover receipt - 2026-07-16 (yellow)

- **One reactive planner now owns every runtime surface:** a city-keyed provider initializes the destination-first
  atomic store only after an artifact reaches a terminal state, subscribes through stable external-store snapshots,
  resolves event/place/custom catalogs without eagerly loading places, and destroys exactly one runtime per city.
  Valid V2 bytes win before any V1 capture; strict raw capture distinguishes missing data from storage failure and
  leaves every rollback byte untouched.
- **All ten legacy consumers switched together:** cards, Add Event, Guides, event/place detail, Day, Plan,
  Next Days, Profile, and My Plans no longer call a V1 planner reader or writer. Cards and guides are doorways rather
  than silent writers; a custom event is created without auto-slotting; event/place detail requires visible exact
  day and daypart confirmation; occupied, duplicate, rest, persistence, and concurrent-change outcomes remain
  explicit; planned items route to their stored day.
- **Current and retained value render honestly:** My Plans shows current/future active days before bounded history;
  Plan, Day, Next Days, and Profile update reactively; missing, ambiguous, and retained references keep their saved
  title and status instead of disappearing. Only live resolved Day items open detail, so incomplete retained
  snapshots cannot crash or produce a blank destination.
- **The city-day boundary is enforced, not merely displayed:** successful current-day rollover is now a prerequisite
  for public planner readiness. Failure becomes an explicit retryable error, stale completions cannot publish, and a
  failed same-day rollover remains retryable. Detail selections clamp when midnight changes the planning horizon,
  the runtime rejects past-day add/move/rest targets, My Plans filters stale active past rows, Calendar cannot clear
  a past or unavailable plan, and weekend guide doorways choose the first non-past day.
- **Failure and accessibility behavior are part of the contract:** session-only writes remain usable but labelled
  unsaved with retry; unavailable planners cannot expose an enabled success action; detail planning sheets are
  modal, focus-trapped, covered-layer inert, pending-serialized, focus-returning, and live-announced.
- **Verification and independent review are green:** the focused planner state gate passes 115/115; the complete
  smoke harness passes 130/130; app lint and production build pass; and the complete serial repository gate passes
  464/464, including finder, immutable artifacts, Tampa/SF and base-path builds, city time, identity, relevance,
  imagery, location, product truth, and the new planner runtime/UI contracts. Independent adversarial re-review
  records **SHIP** with no P0/P1 remaining.
- **Sprint 3 remains yellow:** custom events, saves/Been, recents, and deck memories still need destination-first
  stable-identity stores before the global key cutover. Truthful geolocation permission state and runtime city
  resolution also remain. Sprint 4 still owns the checked-in two-city browser journey and the P2 refinements for a
  planner status change during an open sheet, loading/error Profile counts, and more proximate recovery actions.

#### Sprint 3 retained-value V1 capture receipt - 2026-07-16 (yellow)

- **Every retained V1 source now has a strict read-only entrance:** custom events, saves, Been there, recents, and
  the separate event/place deck memories are captured through physical-aware `peek` reads. Exact raw bytes and
  per-key provenance remain available to migration; capture never invokes a side-effecting legacy loader, claims
  ownership, copies bytes, writes a tombstone, removes a value, or touches the session fallback.
- **Migration domains fail independently:** custom events, saves+Been, recents, and deck memories are explicit
  capture domains. Corrupt low-value deck or recents data cannot block valid custom events or saved history, while
  saves and Been remain paired for their future atomic transition. Malformed JSON and wrong top-level shapes remain
  typed failures inside their own domain rather than being relabelled empty.
- **Deletion and city ownership stay authoritative:** a durable V2 tombstone is captured as an intentional empty
  value and never resurrects unscoped legacy bytes. Existing city-scoped V1 destinations outrank legacy input,
  Tampa and SF cannot inherit one another's bytes, mismatched storage scopes fail closed, and malformed custom-event
  child rows remain intact for downstream diagnostics rather than disappearing during capture.
- **Verification and review are green:** focused capture plus city-storage tests pass 21/21; targeted lint and diff
  hygiene pass; the complete serial repository gate passes 473/473. Independent adversarial review records
  **SHIP** after the tombstone and all-or-nothing-domain defects were repaired.
- **This is evidence capture, not the destination cutover:** the next slices add the shared atomic city-document
  store, pure activity/custom/saved schemas, and then runtime providers. V1 bytes remain the rollback source until
  each valid destination is durably committed, so Sprint 3 remains yellow.

#### Sprint 3 reusable atomic city-store receipt - 2026-07-16 (yellow)

- **One product-agnostic store now owns the durability contract:** the configurable city-document engine binds
  every envelope to store name, schema version, and city; initializes destination-first; preserves physical-only
  source evidence for migration; verifies exact durable bytes; and treats an existing tombstone as authoritative.
  Corrupt or cross-city destinations fail closed without overwriting either destination or rollback evidence.
- **Durability claims match the available primitive:** Web Locks serialize durable commits, rebase pending
  operations over newly observed commits, and publish stable same-tab snapshots. When Web Locks are unavailable,
  the store remains explicitly retryable and session-only rather than claiming an atomic localStorage write that
  the platform cannot prove. Storage events reload external commits, while bounded operation IDs and recent-op
  evidence prevent duplicate replay.
- **The engine is bounded and independently reusable:** document validation rejects invalid ancestry and commit
  metadata, pending operations and retained commit evidence are capped, migrations receive cloned source context,
  and store-specific reducers, validators, empty documents, and source adapters remain outside the engine. No
  planner-specific behavior or product copy is embedded in this layer.
- **Verification and review are green:** the focused atomic suite passes 26/26; atomic, city-storage, and planner
  compatibility pass 153/153; targeted lint and diff hygiene pass; and the complete registered repository gate
  passes 532/532. Independent adversarial re-review records **SHIP** with no P0/P1 remaining.
- **This is shared infrastructure, not retained-value completion:** custom events, saves/Been, recents, and decks
  still need their bounded schemas, source adapters, stores, providers, and coherent consumer cutovers. Every
  product surface must expose the engine's session-only or retry state honestly, so Sprint 3 remains yellow.

#### Sprint 3 retained activity-state foundation receipt - 2026-07-16 (yellow)

- **Recents and calibration memories now have one kind-safe destination contract:** the V2 city document keeps
  recents, event-deck history, and place-deck history separate, with independent 12/30/30 caps. Attached,
  missing, and ambiguous references remain explicit; an event/place alias collision cannot silently select the
  first catalog row or leak one product kind into another.
- **Migration preserves the user's newest evidence without inventing inventory:** V1 deck arrays retain their
  oldest-to-newest FIFO meaning, cap from the newest tail, and let the last duplicate position win. Historical
  identity seeds contribute alias evidence only; they cannot manufacture a live row after an event or place has
  left the current catalog.
- **Hostile input is bounded before identity expansion:** catalog and seed scans, aliases, candidates, strings,
  references, document bytes, and nesting depth all have deterministic limits. Wrong-version, wrong-city,
  malformed, oversized, or cross-kind rows fail closed, while valid sibling evidence remains copy-safe and
  migration output remains deterministic.
- **Verification and review are green:** the activity and identity suites pass 33/33; targeted app lint and diff
  hygiene pass. Independent adversarial repair review records **SHIP** with no P0/P1 remaining.
- **Runtime memory is not cut over yet:** this pure schema still needs an atomic store/source adapter, provider,
  and one coherent replacement of the current recents and event/place deck readers and writers. V1 bytes remain
  untouched for rollback, and Sprint 3 remains yellow.

#### Sprint 3 atomic activity-store foundation receipt - 2026-07-16 (yellow)

- **Retained activity now has a destination-first atomic adapter:** `activity-v2` binds the shared activity
  document to the selected city and the generic atomic engine. Commands persist bounded identity references only,
  publish stable same-tab snapshots, replay through canonical record/clear operations, and retain the engine's
  explicit durable, retryable session-only, corrupt, and unavailable states.
- **The three V1 memories preserve their real ordering contracts:** recents remain most-recent-first at 12 rows;
  event and place calibration histories remain oldest-to-newest FIFOs capped from the newest tail at 30 each.
  Runtime actions can promote one directly evidenced old primary, missing ref, or ambiguous ref to the item the
  user actually opened or rated, while weak-alias overlap and multiple possible matches never first-win.
- **Source damage is isolated and visible:** recents, event-deck, and place-deck bytes are captured through
  independent strict read domains, so one malformed low-value FIFO cannot erase a valid sibling. Oversized but
  bounded V1 arrays salvage the correct head/tail and record an explicit truncated migration status and counts;
  storage I/O failure still blocks initialization, exact V1 bytes remain untouched, and migration context stores
  compact provenance rather than duplicating raw source values.
- **Verification and review are green:** the registered activity/retained/atomic gate passes 62/62; the independent
  activity, retained-capture, identity-migration, and atomic compatibility review passes 76/76; exact-file lint and
  diff hygiene pass. Final adversarial re-review records **SHIP** with no P0/P1 remaining.
- **The React cutover remains intentionally pending:** `ActivityProvider` must use the StrictMode-safe runtime-holder
  pattern, wrap `NavProvider`, keep session recents tab-local, feed alias-aware exclusions to both decks, clear both
  deck memories, and expose session-only durability honestly. Until that coherent consumer swap lands, Sprint 3
  remains yellow and the V1 writers remain the active runtime.

#### Sprint 3 saved-and-Been state foundation receipt - 2026-07-16 (yellow)

- **Saves and follow-through now share one transactional city document:** event, custom-event, place, and guide
  references stay kind-correct; attached, missing, and ambiguous identity evidence remains explicit; and malformed
  prefixes, cross-kind claims, cross-city documents, or first-win ambiguity fail closed. Marking an item went or
  missed can remove its save in the same pure transition instead of leaving contradictory retained value.
- **Migration requires exact physical-source evidence:** both V1 save and Been fields need structured provenance
  with their raw values, allowed source scope, and matching byte counts before any destination can be produced.
  Missing, unverified, rawBytes-only, malformed, oversized, or partial capture cannot be relabelled as a successful
  empty migration, while the original V1 bytes remain untouched for rollback.
- **Replay and capacity behavior is explicit:** imports compare canonical semantic state rather than object key
  order, so a save already superseded by `went` is a true no-op with no revision churn. Save and Been limits refuse
  new rows instead of evicting history; archive and mark commands bind exact save/Been tokens to survive retries and
  ABA changes; and canonical imports fail explicitly below the atomic engine's 64 KiB command boundary.
- **Verification and review are green:** the focused saved/Been plus identity compatibility gate passes 35/35;
  exact-file lint passes. Independent read-only review records **SHIP** with no P0/P1 remaining.
- **Runtime remains deliberately on V1 until one coherent swap:** the atomic saved/Been adapter, StrictMode-safe
  provider, kind-correct My Saves rendering, all heart/Been consumers, and out-of-render expiry archival must cut
  over together. Taste signals must run only after a genuinely changed action, and session-only durability must be
  visible and retryable; Sprint 3 remains yellow until that group lands.

#### Sprint 3 atomic saved-and-Been store receipt - 2026-07-16 (yellow)

- **One atomic destination now owns saved intent and follow-through:** `saved-been-v2` binds the exact city document
  to the shared store engine and replays bounded add, remove, toggle, mark, archive, unmark, and import commands.
  Marking an item went removes its save in the same durable transition; archive commands bind both save and Been
  tokens so retries, stale effects, and ABA changes cannot overwrite a newer answer.
- **Physical migration evidence is reserved and authoritative:** default and explicit source factories carry their
  own strict captured provenance, and caller migration context cannot replace it. Explicit source initialization
  may provide matching evidence intentionally; existing valid destinations skip source capture; Tampa/SF physical
  keys remain isolated; and V1 bytes are never copied, removed, tombstoned, or rewritten by the adapter.
- **Exact validation does not execute caller hooks:** plain JSON-domain descriptor checks reject `toJSON`, accessors,
  custom prototypes, hidden or unknown fields, sparse or extended arrays, symbols, cycles, non-finite values, and
  noncanonical city/schema data before structural comparison. Command builders retain kind-correct bounded refs,
  snapshots, revision tokens, and command-size limits without embedding live catalogs.
- **Durability truth is inherited without dilution:** Web Locks protect durable convergence and rebase; missing lock
  support remains explicit session-only with zero durable writes; same-tab subscribers, retry, storage-event reload,
  corrupt-destination refusal, and destination-first behavior stay on the common atomic contract.
- **Verification and review are green:** adapter, state, atomic, and identity compatibility pass 69/69; exact-file
  lint and diff hygiene pass. Independent adversarial re-review records **SHIP** with no P0/P1 remaining.
- **The adapter is not mounted yet:** a StrictMode-safe provider and one coherent all-consumer cutover still need to
  replace the V1 module singleton, move archival out of render, await action outcomes, and expose session-only retry
  truth. Until that runtime group lands, V1 stays active and Sprint 3 remains yellow.

#### Sprint 3 custom-event state foundation receipt - 2026-07-16 (yellow)

- **Added-by-you events now have one exact city-and-time contract:** the bounded V2 document persists the selected
  city ID and trusted IANA timezone. Date-only/all-day and timed precision must agree; invalid offsets, backwards or
  mixed ranges, contradictory item zones, DST gaps or ambiguous wall times, invalid city zones, and cross-city
  documents all fail closed rather than becoming planner or calendar evidence.
- **Identity becomes stable only after durability is real:** migrated and durably written rows retain their local
  `c|` identity plus bounded legacy aliases. Session-only projection uses a non-reserved synthetic identity and
  cannot leak an unlanded stable-looking `c|` into saved, activity, or planner stores; current legacy evidence stays
  available for display and retry without forging landed identity.
- **Migration evidence and persisted schemas are exact:** strict wrapped raw provenance must structurally match
  plain JSON source rows. Accessors, `toJSON`, custom prototypes, missing or malformed aliases, unknown
  identity-bearing fields, partial rows, source mismatch, oversized input, and duplicate IDs are rejected or
  deterministically repaired only where the contract explicitly permits it. V1 bytes remain untouched.
- **Pure mutations are bounded and conflict-aware:** add, update, delete, merge, and replace-import use revision
  guards, preserve valid identity history without dropping the current legacy alias, support the full 256-row
  document cap subject to the atomic command-size ceiling, and never freeze or mutate caller-owned invalid input.
- **Verification and review are green:** the focused repaired suite passes 21/21; root custom/identity/activity/saved
  compatibility passes 72/72; independent focused compatibility passes 35/35; exact-file lint and diff hygiene pass.
  Final adversarial re-review records **SHIP** with no P0/P1 remaining.
- **The atomic/runtime cutover remains pending:** a city-bound custom-event store and StrictMode-safe provider must
  replace App/lib V1 state, feed planner initialization only after terminal usable custom state, await add/delete/
  undo outcomes, and show session-only retry truth. Until that coherent group lands, Sprint 3 remains yellow.

#### Sprint 3 truthful location-permission runtime receipt - 2026-07-16 (yellow)

- **Permission intent and effective use are separate:** one city-scoped controller owns disabled, desired,
  requesting, granted, denied, unavailable, and error states. A legacy `location-allowed-v1` value becomes
  unverified intent only; it never appears enabled until a fresh coordinate succeeds. Denial, revocation,
  timeout, synchronous browser failure, invalid coordinates, storage failure, disable-during-request, and late
  callbacks all fail closed while session-only success remains explicitly labelled.
- **Every surface now consumes one reactive truth:** `LocationProvider` owns the controller lifecycle and shared
  request promise; App, Settings, and the existing distance lens no longer maintain independent permission flags
  or call `navigator.geolocation` directly. Settings exposes `aria-pressed` only for effective grant, status
  changes are live-announced, and the distance doorway shares the same pending, denied, retry, and revocation state.
- **A valid browser fix is not automatically a local-product fix:** Tampa and SF app boxes are pinned exactly to
  the finder sanity boxes. Only granted coordinates inside the active market become `usableCoords`; an out-of-
  market fix remains an honest browser grant but cannot drive current-city sorting. Without usable coordinates the
  page says `Events across <city>`; with them it says `Events by day and distance` and `Closest within each day`,
  matching the actual day-first then distance-within-day ordering.
- **Verification and review are green:** the registered location gate passes 33/33; app lint and production build
  pass; the complete serial repository gate passes 506/506, including the exact Tampa/SF box mirror and the UI
  false-claim contracts. Independent adversarial re-review records **SHIP** with no P0/P1 remaining.
- **Sprint 3 remains yellow:** the shared custom-event, saves/Been, recents, and deck destinations still need to
  land before the global stable-identity cutover. Full runtime city resolution remains an L0 follow-up; this slice
  deliberately gates only the current two shipped market packs. A behavioral StrictMode rejection test, bounded
  Permissions-query wait, denial recovery without change events, and resume-age refresh remain bounded P2 work.

### Sprint 4 - P0 core journeys and the browser release harness

**Outcome:** every known release blocker is fixed through the real browser journey, not only a source seam.

Committed scope:

- Render current/future items in My Plans and make add, duplicate, confirmed-slot, undo, remove, and planned-
  state semantics canonical.
- Make category, date, and price filters combine; reset invalid Search scope truthfully.
- Make inactive pages and covered layers inert; repair focus return and back behavior.
- Add an ErrorBoundary, validated storage loads, fetch timeout/retry, and honest error-versus-empty treatment.
- Remove or correct unsupported `Open now`, `near you`, freshness, and other recommendation claims.
- Add Playwright core journeys, axe checks, and the first failure/time/state matrix.

**Exit gate:** every audit P0 has an automated regression; the complete first-visit -> find -> add -> Day/
Calendar/Profile/My Plans -> remove journey passes in Tampa and SF with no console error.

## Relevance and the existing product

### Sprint 5 - E0 corpus quality, source health, and signal foundation

**Outcome:** the corpus and evidence needed for honest ranking exist before ranking is tuned.

Committed scope:

- Add source-health SLOs, recurrence/range normalization, canonical duplicate/series identity, decision-field
  confidence, and source-concentration reporting.
- Capture organizer, status, raw categories, description length, image rank, OSM provenance/brand, government
  backing, and the other currently discarded signals.
- Start the retained snapshot/signals archive for velocity and organizer/source track record.
- Fix deterministic quality-floor defects and assert count preservation and payload budgets.
- Run the owner labeling session; ratify the relevance/gem rubric, demote-versus-drop policy, tier language,
  and numeric evaluation targets.
- Begin the licensed image ingest/validation/fallback pipeline and L0 platform-adapter interfaces.

**Exit gate:** zero cancelled, ended, wrong-market, known-junk, or known false-merge rows appear in a sampled
top 50 per flagship city, or the city is explicitly labelled limited; baseline category/dedupe/source reports
and frozen human judgments are reproducible.

### Sprint 6 - E0 common rank contract and Credible First Screen

**Outcome:** a new user sees three defensible choices and can make a real plan in about one minute.

Committed scope:

- Build one pure rank API that keeps corpus quality, objective context, and personal taste separate.
- Emit honest tiers, diversity controls, and short reason codes while preserving full-catalog reachability.
- Integrate the shared selector into Home's primary recommendations and the Events lead shelf.
- Apply the truthful image hierarchy: exact item, verified venue/place, clearly contextual licensed image,
  then honest Aurora fallback.
- Ship browse-first entry, immediate local value, a decisive lead feed, and confirmed date/daypart plan add.
- Complete premium loading/failure/empty, responsive, and accessible treatment for this first slice.

**Exit gate:** Tampa and sparse SF each show three credible, diverse, non-expired, non-duplicate, correctly
located choices with supported reasons; a new user reaches a visible plan in about 60 seconds; all legitimate
inventory remains reachable.

The optional build-time model judgment gate is **not** scheduled by default. It enters a later sprint only
if a frozen evaluation shows deterministic rules cannot meet the ratified bar and the model materially lifts
precision while remaining pinned, cached, versioned, costed, schema-validated, and fail-closed.

### Sprint 7 - Unified objective discovery and truthful Spots

**Outcome:** every existing discovery surface uses the same objective truth instead of a shelf-specific score.

Committed scope:

- Route Home, Tonight, Events, browse, Search defaults, Guides-lite, deck candidates, Plan suggestions, Spots,
  and activities through the common rank contract.
- Simplify Events from repeated shelves into a decisive ranked experience without hiding the catalog.
- Add source/category/neighborhood diversity, honest evidence-tier claim language, and recurrence control.
- Give Spots a real activity, amenity, quality, distance, hours-confidence, and quality-over-distance model.
- Complete ratified quality phase-two work such as rank fusion, diversity re-ranking, gem slots, and fuzzy
  dedupe only where frozen tests justify it.

**Exit gate:** there is no second quality model in a surface; `near`, `recommended`, `worth the drive`, `gem`,
and superlative labels map to inspectable math/evidence; ranking, category, dedupe, source-diversity, and never-
hide gates pass.

### Sprint 8 - Bounded personal relevance and taste loop

**Outcome:** Wuzup meaningfully reorders good inventory for a person without making inventory disappear.

Committed scope:

- Use existing onboarding, interests, saves, plans, deck verdicts, went/skipped feedback, daypart, price,
  distance, weather, novelty, and repetition in an explainable on-device taste model.
- Keep the quality-ordered feed as cold start and apply bounded, signed personal adjustments above it.
- Improve deck dealing, feedback transparency, and candidate coverage; reskin the existing deck without
  creating a new co-swipe or social product.
- Apply the personal layer consistently to events and places while keeping source/category diversity.

**Exit gate:** strong positive/negative preferences move at least four matching items into/out of the real
first 20, no category or source owns more than half of an unfiltered top 20, muted inventory remains reachable,
and corrupt/no taste data falls back cleanly to objective quality.

### Sprint 9 - Existing-flow depth and durable user value

**Outcome:** the existing planner, guides, Search, Saves, and Profile turn discovery into durable value.

Committed scope:

- Give Plan/Day 3-6 complementary suggestions, honest reasons, reroll, and weather/distance/taste fit with
  no planned or duplicate suggestion.
- Enrich Guides-lite with truthful covers, freshness, sourced reasoning, and item resolution; do not create
  community rankings.
- Make Search, Saves, Profile, and user-added items kind-correct and complete.
- Add durable event/place/plan routes and sharing plus full local-state export/import.
- Replace placeholder support with a correction flow carrying item ID, source, and problem.

**Exit gate:** detail and plan state survive refresh and can be shared; export/import round-trips supported
state; planner suggestions are complementary and duplicate-free; no guide makes an unearned ranking claim.

### Sprint 10 - Premium completion, accessibility, performance, and flagship imagery

**Outcome:** every existing path reads and behaves like one finished product.

Committed scope:

- Finish shared Page, navigation/tabs, dialog/sheet, toast, chip, calendar, and card-action primitives.
- Finish one motion/touch/focus/loading/icon grammar with reduced-motion support.
- Complete light/dark, error/empty/loading, long-copy, small-mobile, tablet, and desktop behavior for every
  existing surface; no new big-canvas product is admitted.
- Add route/data splitting, defer the place index, keep content readable while imagery loads, and enforce
  payload/boot budgets.
- Complete privacy/CSP/referrer truth and make the offline posture explicit.
- Reach the ratified flagship imagery targets and run the independent 100-image identity/credit audit.

**Exit gate:** WCAG 2.2 AA and keyboard/screen-reader/switch journeys pass; 320, 390, 768, and 1440 px visual
checks pass; no console error or measurable performance regression; imagery has zero wrong-place or uncredited
items in the audit; the owner approves the premium existing-product pass.

## Validation and United States coverage

### Sprint 11 - Controlled Tampa/SF beta, cycle one

**Outcome:** real use starts testing whether the product is trustworthy and useful, not merely attractive.

Committed scope:

- Run the full artifact, browser, failure, time, accessibility, and responsive release suite.
- Use privacy-preserving health measurement or explicit research sessions to establish time to credible option,
  time to first plan/save, source-link success, corrections, empty searches, duplicate exposure, and repeat use.
- Fix every new P0 immediately and triage P1 findings against the V2 contract.
- Keep L0 candidate cities private while foundry, source, hosting, and policy work continues.

**Exit gate:** no open P0, green refresh/deploy SLOs, a reproducible beta report, and no evidence that the core
first-value promise is false.

### Sprint 12 - Controlled Tampa/SF beta, cycle two and pilot go/no-go

**Outcome:** enough elapsed operation exists to decide whether expansion is responsible.

Committed scope:

- Complete a second beta cycle or the ratified equivalent set of observed research sessions.
- Repair trust, relevance, planner, imagery, accessibility, and performance regressions.
- Ratify the city-launch gates, national-source API/ToS posture, hosting/cadence, and operating budget.
- Freeze the diverse 5-10-market pilot cohort and rollback/auto-demotion rules.

**Exit gate:** the ratified trust and repeat-use signals pass, the entire two-city release gate is green, and
the owner records an explicit go/no-go for public pilot expansion.

### Sprint 13 - City Foundry integration and private diverse-market proof

**Outcome:** the L0 work developed since Sprint 1 becomes one operational system.

Committed scope:

- Integrate runtime manifest/shards, location resolution, reusable platform adapters, per-location configs,
  auto-gazetteer, source-health/politeness controls, tiered cadence, and manifest-last publication.
- Make the Coverage Card derive sources, counts, freshness, imagery, and thin/not-covered status.
- Build the selected 5-10 diverse markets privately across inland, small, and data-poor regimes.
- Validate timezone/weather routing, payload budgets, cross-city guards, image receipts, and operating cost.

**Exit gate:** every pilot market either meets its ratified launch gate or renders an honest limited state;
there is no cross-city contamination, bespoke app code, policy breach, or unbounded owner-ops requirement.

### Sprint 14 - Public 5-10-market pilot, cycle one

**Outcome:** the foundry faces live source drift and public use at more than two cities.

Committed scope:

- Publish the approved pilot cohort with coverage/freshness disclosure and automatic demotion on source failure.
- Closely audit the first cities in each source/capture regime, including links, dates, categories, images, and
  recommendation evidence.
- Measure refresh reliability, source concentration, corrections, payloads, owner time, and per-city cost.

**Exit gate:** two weeks of green pilot operation, no silent thin-data regression, no severe identity/image
breach, and a bounded correction/rollback path.

### Sprint 15 - Pilot soak and private nationwide floor

**Outcome:** the pilot proves repeatability while the honest any-US floor is tested privately.

Committed scope:

- Complete roughly 30 days of pilot operation or the owner-ratified equivalent reliability window.
- Generate the nationwide thin/not-covered floor and test resolution across all 50 states plus DC.
- Exercise representative urban, micropolitan, rural, border, timezone, sparse-source, and no-coverage points.
- Confirm that owner audit time, source costs, refresh cadence, and storage/hosting stay within ratified bands.

**Exit gate:** the pilot reliability window passes; every state plus DC resolves privately; the nationwide
artifacts are sharded and truthful; no systemic source family or cost makes rollout unsustainable.

### Sprint 16 - Full-US public beta

**Outcome:** any US location works honestly in the real runtime system.

Committed scope:

- Publish the nationwide flagship/metro/thin/not-covered ladder with Coverage Card truth on every path.
- Run national cross-city, timezone, weather, storage-isolation, payload, source-health, and image-provenance
  regressions.
- Repair beta findings without weakening launch gates or presenting thin coverage as flagship depth.

**Exit gate:** all 50 states plus DC resolve; thin locations degrade usefully; freshness and coverage are visible;
there is no cross-city contamination; metro depth requires config/adapters rather than app forks; H/E/U/I gates
remain green under national loading.

### Sprint 17 - V2.0 release certification and general availability

**Outcome:** V2 exits as one supportable product, not as parallel experiments.

Committed scope:

- Run the complete immutable-artifact, core-browser, failure, time, accessibility, responsive, imagery, ranking,
  and national-location suite against release bytes.
- Close beta defects, prove rollback/recovery, publish runbooks and concise before/after reports, and update the
  plan/registry status in the same change.
- Record every numeric gate and policy ruling; do not silently implement unresolved owner decisions.

**Exit gate:** every H, E, U, I, L, and F exit in [V2_PLAN.md](V2_PLAN.md) passes; production bytes equal tested
bytes; no P0/P1 launch blocker remains; the owner gives the final product and visual go/no-go.

## Parallel lane map

| Lane | Primary build sprints | Validation/rollout sprints |
|---|---|---|
| H0 Trust | S1-S4 | S5-S17 operational gates |
| E0 Relevance | S1 fixtures, S5-S8 build | S9-S17 tuning/regression |
| U0/F0 Product | S1 independent fixes, S4, S6-S10 | S11-S17 beta remediation |
| I0 Imagery | S1-S2 inventory/policy, S5-S10 pipeline/breadth | S13-S17 national receipts/audits |
| L0 Locations | S1 inventory, S2-S10 architecture/foundry | S13-S16 pilot/nationwide rollout |
| QA/release | S0 onward | S11-S17 full certification |

## Owner decision calendar

| Decision | Last safe point |
|---|---|
| First-value promise and V3 parking list | Before S1 starts |
| Freshness SLA and stale/refusal behavior | Before S1 contract freezes |
| Canonical quick-add and My Plans semantics | Before S3 planner store freezes |
| Image license, attribution, contextual-use, storage/proxy policy | Before S2 pipeline implementation |
| Relevance/gem rubric, chain/drop posture, tier language, numeric gates | During S5, before S6 integration |
| Smart Engine scope = bounded on-device reorder over objective quality | Before S8 |
| Beta measurement/research and privacy posture | Before S11 |
| National-source API/ToS, hosting, cadence, city gates, operating budget | Before S13 |
| Optional model-judgment gate | Only after a failed deterministic frozen eval |

## Explicitly outside this sprint train

The current plan does not authorize a separate sprint for the productized Day Engine/"Give me a Saturday,"
Weekend Brief, Tonight Board, Plan takeover, co-swipe/Who's In/Pass-the-Day, Passport/recaps/Vault, accounts,
friends, reviews, community rankings, runtime LLM concierge, push digest, in-app ticketing, map revival, Trip
Mode, global expansion, elaborate ceremonies, or new big-canvas products.

The archived 50%-population metro-depth ambition is also not a V2.0 exit in the current plan. After V2.0,
metro-depth rollout can use repeatable V2.x expansion sprints, with a separately ratified market count and gate.
Likewise, no V2.1 Dusk/big-canvas/recap sprint is scheduled unless the owner explicitly promotes it.
