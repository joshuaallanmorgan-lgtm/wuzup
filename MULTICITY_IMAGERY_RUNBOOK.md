# Multi-city imagery runbook

How to run the honest imagery pipeline for a new city. The pipeline is city-agnostic;
the per-city specifics live in `finder/cities/<city>.mjs`. Tampa Bay (`tampa-bay`) is
the reference config + the byte-identical regression test.

**Honesty is binding.** A place gets a photo ONLY when it can be proven of-that-place:
a Commons file whose name matches, or a Mapillary crop whose storefront SIGN reads the
cafe name (or a confirmed cafe storefront with no conflicting business). Everything else
keeps the Aurora art floor. The manual REFUTE gate below is a STANDING requirement, not
a one-off — a self-review systematically misses false positives it wants to pass.

## 0. Token security
- The Mapillary token is read from **`process.env.MAPILLARY_TOKEN` ONLY** (or `MLY_PLAN`,
  a path to a local, untracked file containing one `MLY|...` token — for dev probing
  without putting the token on a command line). **Never** hardcode it, commit it, or log
  it. There is no machine-specific default path (`mapillary-verify.mjs`).

## 1. Add the city config
- Copy `finder/cities/tampa-bay.mjs` → `finder/cities/<city>.mjs`, edit:
  - `bbox` (the derived Overpass / ArcGIS / Nominatim strings recompute from it),
  - `govOrder`, `touristCentroids`, `area` (the gazetteer — town/neighborhood words),
  - `qidDeny`, and the `cafe` verdict sets (`forceDrop`/`forceKeep` start EMPTY — they
    fill in only after the manual review, step 5),
  - `rosterBenchmark` (a few well-known places to anchor the generation smoke test),
  - `meta.name`/`meta.center`.
- Register it in `finder/cities/index.mjs`. Select with `CITY=<id> node …`.
- **⚠️ Per-city rechecks:** `imagery.orientFlipThreshold` (the upside-down-frame sky
  heuristic is tuned on Tampa dashcam frames — re-verify on the new city's capture mix);
  the `area` gazetteer (the Commons geosearch ladder has NO human eyeball gate, only this
  name-match — get it right).

## 2. Place / event sources — SEPARATE TASK (out of scope for the lock)
The city's own OSM/gov/event source modules are written later. The imagery lock ships
without them.

## 3. Mapillary cafe imagery — the manual gates (in order)
1. **Candidate-gen:** `MAPILLARY_TOKEN=… node finder/mapillary-verify.mjs` — queries
   nearby captures per cafe, frames flat-crop + pano-reproject candidates, writes
   `finder/cache/mapillary-crops/<slug>/`. (Single cafe re-crop: `--merge p|<slug>`.)
2. **Anonymize:** `node finder/mapillary-verify.mjs --anon` — copies crops into opaque
   `_review/rNNN/` dirs (name-blind) + writes `_review/_map.json` + `_workflow_args.json`.
3. **Name-blind transcription / re-judge (Workflow tool):** run
   `finder/mapillary-transcribe.workflow.js` with `args` = the rid count (or rid list).
   It transcribes each crop's storefront sign AND flags `isDirectoryOrPylon`,
   `cafeIsDominantSubject`, `otherBusinessNameOnSign`, `imageQuality` — all name-blind.
   Save the returned array to `_review/_transcriptions.json`.
4. **Stage B (deterministic ship gate):** `node finder/mapillary-stageb.mjs --ship`.
   Tier A = sign name-matches the cafe (lenient: edge-occlusion + address-numbers, never
   fuzzy). Tier B = confirmed cafe storefront, no conflicting business, strong geometry.
   **Guards FAIL CLOSED**: a crop with no re-judge signal CANNOT ship; pylons + other-
   business-dominant crops are rejected. Writes `place-mapillary-images.json` (each ship
   carries `reVerified: true` — the honesty receipt) + self-hosts `app/public/place-img/`.
5. **Standing adversarial REFUTE re-verification (REQUIRED):** independent agents, told
   to REFUTE each ship (find why it's the WRONG business / a pylon / a different hero),
   default-to-rejected when uncertain. Plus a human eyeball of EVERY ship — including the
   "obviously fine" ones (2 Tampa "Starbucks" ships were directory pylons). Confirmed
   false positives → add to the city config's `cafe.forceDrop`; confirmed-genuine ships a
   guard misjudges → `cafe.forceKeep`. Re-run step 4. Repeat until the refute pass is clean.
6. **Tier-B eyeball:** review `finder/cache/phaseB-tierB-review.md` (the no-name-match
   ships). If any shows the wrong place, tighten; otherwise Tier B is trusted.

## 4. Regenerate + gate
- `node finder/places.mjs` (warm) applies ladder-3 from the committed cache — it does NO
  Mapillary network and self-heals (cache pruned OR jpeg missing → art floor). Confirm a
  warm re-run is byte-identical.
- Gate: `npm run lint` (in `app/`) + `npm run build` + `npm test`. The smoke harness reads
  the active city config (box, roster) + the canonical taxonomy (placeTypes/categories) and
  asserts the fail-closed receipt (no shipped cafe lacks `reVerified`).

## 5. Aurora art floor
Free per-city — the floor is deterministic from the place key (`app/src/artseed.js`), no
per-city tuning. New placeTypes just need a hue/emoji in `app/src/categories.js`.
