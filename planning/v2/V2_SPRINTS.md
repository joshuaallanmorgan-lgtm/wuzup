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
