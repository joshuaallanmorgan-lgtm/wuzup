# PLACES_SOURCES.md — Sprint R data-source plan (R1 scout synthesis)
_Produced by the R1 research scout workflow (3 agents), 2026-06-11. Every endpoint live-verified that day._
_This is the build spec for R2 (finder/places.mjs + finder/places-sources/*). Companion to MASTER_PLAN2.md Sprint R and CALENDAR_BRIEF.md (the durable-doc pattern)._

> ⚑R-MOON (RESOLVED — Josh, 2026-06-11): "Moonlight Beach" does not exist in Tampa Bay; Josh ratified **Honeymoon Island State Park** as the fifth roster benchmark (and confirmed Weedon Island was the intended spelling — the county's "Weeden" is the typo). The R2 build ran with the slot vacant per the original flag; the Honeymoon benchmark is added at fix-application and must pass by generation. Evidence trail in §0.3 / Appendix A §3 / Appendix B alert.

---
# Sprint R — Places Data-Source Plan (R1 synthesis, decision-ready)
_Synthesis lead, 2026-06-11. Inputs: MASTER_PLAN2.md Phase 2 (Sprints R/S/T + the Phase-2 schema decision at line 25), finder/finder.mjs conventions (per-source modules, cache-with-fallback, fuzzy merge, benchmarks block), finder/sources/pinellas.mjs as the module-contract exemplar, and two verified scout reports (OSM live-probe + government directories, both run 2026-06-11). Every endpoint below was live-queried by a scout today. This document is the build spec handed to the R2 agents._

---

## 0. Headline decisions

1. **Two-backbone architecture, not one.** OSM Overpass supplies breadth (~1,400–1,500 named elements across 12+ classes); government ArcGIS layers supply *truth* (hours, amenity booleans, fees, editorial descriptions, official URLs). Neither alone hits the quality bar; merged, the R DoD (300+ places) is exceeded ~4x before dedupe.
2. **Pipeline = `finder/places.mjs` + `finder/places-sources/*.mjs`**, a structural clone of finder.mjs's loader: per-source modules exporting `name` + `fetchPlaces()`, per-source JSON cache in `finder/cache/` with fall-back-to-cache-on-failure, console benchmarks block, output to `finder/output/places.json` + `places.md` + `app/public/places.json`. Run independently of the events finder (`node finder/places.mjs`), weekly refresh.
3. **⚑ ONE ROSTER ITEM IS BROKEN: "Moonlight Beach" does not exist in Tampa Bay.** Both scouts independently proved this (Overpass full-bbox name scan → only residential streets; Nominatim global → zero FL hits; Tampa + Pinellas GIS layers → 0 rows; the famous one is in Encinitas, CA). Most likely intended: **Honeymoon Island State Park** (generates richly today: OSM relation/20601459, 15 tags incl. fee + hours, + FDEP layer, + "Honeymoon Island Dog Beach" node). Alternates: Sunset Beach (Tarpon Springs or Treasure Island), Ben T Davis Beach, Dog Beach (Fort De Soto). **R2 must NOT hardcode this benchmark until Josh re-ratifies — flag ⚑R-MOON, do not silently substitute.** The other four roster items pass by generation today (§4).
4. **Schema honors the Phase-2 decision already written into MASTER_PLAN2 (line 25):** `kind:'place'`, a **singular** `category` mapped into the 12-category taxonomy, `'p|'`-prefixed keys, places.json as a second lazy fetch — never concatenated into the events norm.

---

## 1. The source stack, ranked (all endpoints verified live 2026-06-11)

### Tier 1 — Backbone (build first)

**S1. Pinellas County Park Points** — the single best source found. One module covers the county AND all 23 municipalities (St Pete 125, Clearwater 72, Dunedin 26…).
- `https://services.arcgis.com/f5HgUpxURgEzTccH/arcgis/rest/services/Pinellas_Park_Points/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json` (paginate `resultOffset`; 418 points)
- Feeds: name, address, hours (OPERDAYS/OPERHOURS), official URL (PARKURL), restroom/ADA, ~30 amenity booleans (SWIMMING, HIKING, FISHING, PLAYGROUND, TENNISCOURTS, BASKETBALL, DOGPARKAREA, DISCGOLF, SKATEPARKAREA…), DESIGNATION (City/County/State), MUNICIPALTY.
- **Gotcha: `outSR=4326` is mandatory** (default returns Web Mercator). Trailing spaces in NAME observed ("North Shore Park ").

**S2. OSM Overpass (the breadth layer)** — 12 class queries, template verbatim:
- `https://overpass-api.de/api/interpreter` POST `data=[out:json][timeout:90];( <FILTER> (27.3,-83.3,28.6,-81.9););out center;` — note bbox = the existing `TB_BOX` in finder.mjs, reuse it.
- Class filters (verbatim, with measured counts): parks `nwr["leisure"="park"]` (1,540 / 67% named) · beaches `nwr["natural"="beach"]` (194) · nature reserves `nwr["leisure"="nature_reserve"]` (156) · protected areas `nwr["boundary"="protected_area"]` (84, **filter on protect_class/access** — top hit was a Coast Guard sector) · trails `relation["route"~"^(hiking|foot|walking)$"]` (43, 100% named, richest avg tags) · dog parks `nwr["leisure"="dog_park"]` (175, **filter brewery co-tags** `craft`/`amenity` — Two Shepherds Taproom is tagged dog_park) · gardens `nwr["leisure"="garden"]` **named-only** (34 of 1,324) · piers `nwr["man_made"="pier"]` **named-only** (88 of 3,448) · boat ramps `nwr["leisure"="slipway"]` (234) · viewpoints `nwr["tourism"="viewpoint"]` (46, thin) · playgrounds `nwr["leisure"="playground"]` **named-only** (54) · sport courts tennis/basketball/pickleball (2,413/1,040/483 — **geometry, not places**; see §3 join rule).
- **Politeness law (measured, binding):** serialize, **≥10s between queries**, retry 429/504 ×3 with 20/40/60s backoff, real User-Agent (`TampaBayWeekendApp-places/0.1 (contact: joshuaallanmorgan@gmail.com)`). At 3s gaps the scout got 11/15 rate-limited; at 8–10s + backoff, 100% success. ~15 queries weekly = trivially polite.
- **Always `out center;`, never `out geom`** (4.3 MB total vs tens of MB). Cache per-class JSON (`cache/osm-parks.json` etc.) exactly like event source caches. Fallback endpoint `https://overpass.kumi.systems/api/interpreter` works but was **7 weeks stale** and 90s slow — cold fallback only.
- Use Node native `fetch` (already the repo standard) — the scout hit a MinGW curl bug (`--data-urlencode "data@file"` silently posts empty); fetch avoids it entirely.
- Feeds: name, lat/lng (centroid), website/wikidata where mapped, opening_hours (sparse: 5% of parks), the entire viewpoint/pier/trail/beach classes no government layer carries.

**S3. City of Tampa Parks** — the richest amenity schema and the ONLY editorial-description source.
- `https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Location/MapServer/9/query?where=1%3D1&outFields=*&outSR=4326&f=json` (196 points; polygons = layer 10)
- Feeds: **DESCRIPT** (real blurbs), PHONE, OPERDAYS/OPERHOURS, PARKURL, ~45 booleans incl. BEACH, **DOGBEACH**, DOGPARK, BOATRAMP, CANOELAUNCH, PIER, MARINA, SPLASHPAD, PICKLECOURT, DISCGOLF, NATURALTRAILS.
- **Gotcha: server is slow** — a count query needed 60s. Set this module's timeout ≥60s (override `DEFAULT_TIMEOUT_MS`), cache hard.

### Tier 2 — Enrichment (build same sprint, lower risk)

**S4. FDEP Florida State Parks** — `https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PARKS_BOUNDARIES/MapServer/0/query` (179 statewide, 15 in Hillsborough/Pinellas/Pasco/Manatee). Fields: SITE_NAME, COUNTY, ACREAGE, **URL** (floridastateparks.org link-out), **PUBLIC_ACC** (fee flag, e.g. "Open-Fee Required"). Sibling **Park Entrances point layer** preferred over polygon centroids for directions. **Do NOT scrape floridastateparks.org** — Akamai 403 wall even with browser UA; the URL field is the link-out, hours are near-uniform ("8 a.m. to sundown").

**S5. FWC Boat Ramp Inventory** — `https://gis.myfwc.com/mapping/rest/services/Open_Data/FWC_Florida_Boat_Ramp_Inventory/MapServer/4/query` (275 in bbox via envelope query with `inSR=4326`). Maps almost 1:1 onto the schema: RampName, Hours, **isFeeRequired/FeeAmount**, RestroomType, AccessibilityLevel, plain Latitude/Longitude fields, WaterBodyName, Status.

**S6. Hillsborough County Parks** — `https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/Parks_and_Recreation/FeatureServer/0/query` (541 polygons). **Thin** (no hours/booleans/URLs): use for authoritative names + geometry + USES free-text ("Boat Ramp"); let OSM/Tampa merge supply amenities. Gotcha: `\r\n` embedded in ADDR.

**S7. SWFWMD RecreationGuide** (lower priority, can slip to a fast-follow inside R): `https://services1.arcgis.com/gdr0FcZCwx1BmrQk/arcgis/rest/services/RecreationGuide/FeatureServer` — `/0` entrances, `/3` Amenities and Activities (join to properties via PROJECTNAME), `/7` properties; plus RecreationAmenitiesGeodatabase `/0` (472 land-project polygons). Covers the Brooker Creek-class preserves the "nature paths" bubble wants. NOT on their open-data hub — these endpoints came from extracting web-map `ce92eb0ed43f4c8590c143cbb4c2ad29`; record that in the module header.

### Skip / one-time-seed (decided)
St. Pete Parks_view (redundant — Pinellas carries its 125 parks; keep URL as documented fallback) · Clearwater (no portal; covered by Pinellas) · FTA trails (seed from SWFWMD layer 6's 6 features if wanted) · floridastateparks.org scrape (403 wall) · **disc golf**: OSM has 5 elements total — rely on Pinellas/Tampa DISCGOLF booleans for v1, note UDisc as a future supplement.

**Shared plumbing to build once:** a `_arcgis.mjs` helper in `finder/places-sources/` (query-with-paging, `outSR=4326` enforcement, Yes/No boolean coercion, timeout override per source) — five of the seven modules are the same ArcGIS call shape. Hub re-discovery if an endpoint moves: `{hub}/api/search/v1/collections/dataset/items?q=` worked on every portal.

---

## 2. places.json schema v1 (finalized against what sources actually provide)

Adjustments from the R2 sketch: `categories[]` → singular `category` (the Phase-2 schema decision already ratified in MASTER_PLAN2 line 25) plus a places-native `placeType` + `classes[]` for the S1 bubbles; `images[]` **dropped from v1** (no verified image source — never fabricate, per Risk #2); `fee` added (FWC/FDEP provide real fee amounts, richer than bare isFree); `designation`/`operator` added (drives "The classics" vs hidden scoring); `hidden` boolean + capped shelf mirrors events' `hidden-gem` tag.

```jsonc
{
  "schemaVersion": 1,
  "places": [{
    "key": "p|fort-de-soto-park",       // 'p|' + slug — the ratified keyOf prefix
    "kind": "place",
    "name": "Fort De Soto Park",         // cleaned: trim, collapse ws (gov data ships trailing spaces)
    "placeType": "park",                 // primary class: park|beach|preserve|trail|dog_park|garden|pier|boat_ramp|viewpoint|playground|courts
    "classes": ["park", "dog_park", "beach"],  // every applicable class → S1 bubbles
    "category": "outdoors",              // singular, 12-category app taxonomy (most places: outdoors)
    "lat": 27.6301, "lng": -82.7226,
    "address": "...",                    // gov FULLADDR > OSM addr:* > null (never geocode-fabricate)
    "description": "...",                // Tampa DESCRIPT only real source; else null — omit, don't invent
    "amenities": ["dog-park","fishing","restrooms","playground","ada","beach"],  // normalized vocabulary
    "isFree": true,                      // FDEP PUBLIC_ACC / FWC isFeeRequired / default-true for city parks w/ source note
    "fee": null,                         // e.g. "8 USD" (OSM fee=*, FWC FeeAmount) — only when sourced
    "hours": "sunrise-sunset",           // gov OPERHOURS > OSM opening_hours > null
    "url": "https://...",                // PARKURL / FDEP URL / OSM website
    "phone": null,                       // Tampa only
    "designation": "County",             // City|County|State|Water-Mgmt|null
    "operator": "Pinellas County",
    "sources": ["Pinellas Park Points", "OSM", "FDEP State Parks"],  // detailed names, like events
    "srcCount": 3,                       // cross-source corroboration (familyOf analog)
    "osm": { "type": "relation", "id": 20601460 },   // provenance for refresh-time re-matching
    "wikidata": "Q5471030",              // when present — also the hidden-score exclusion signal
    "hiddenScore": 0,                    // 0..N proxy score (§5)
    "hidden": false                      // capped-shelf tag, events-gem pattern
  }]
}
```

**Field-by-source feed matrix** (✔ = primary, ◐ = sometimes/partial):

| Field | Pinellas | Tampa | OSM | FDEP | FWC | Hillsborough | SWFWMD |
|---|---|---|---|---|---|---|---|
| name/lat/lng | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| address | ✔ | ✔ | ◐ | ✔ | ✔ | ✔ (clean \r\n) | — |
| hours | ✔ | ✔ | ◐ (5%) | ◐ (uniform) | ✔ | — | — |
| amenities | ✔ (30 bools) | ✔ (45 bools) | ◐ (court join) | — | ✔ (typed) | ◐ (USES text) | ✔ (/3 points) |
| isFree/fee | — | — | ◐ (fee=*) | ✔ (PUBLIC_ACC) | ✔ ($ amount) | — | — |
| description | — | ✔ (DESCRIPT) | — | — | — | — | — |
| url | ✔ | ✔ | ◐ (14%) | ✔ | — | — | — |
| phone | — | ✔ | ◐ | — | — | — | — |
| wikidata | — | — | ✔ | — | — | — | — |
| designation | ✔ | (City) | — | (State) | — | ✔ | (SWFWMD) |

Per-source **amenity normalization maps** are fully specified by the verified field lists (Pinellas DOGPARKAREA=Yes ↔ Tampa DOGPARK=Yes ↔ OSM leisure=dog_park → `"dog-park"`); R2 writes one map per module, all emitting the same normalized vocabulary. Smoke-harness schema asserts: every place has key/kind/name/placeType/category/lat/lng/sources; coords inside TB_BOX; `'p|'` prefix universal; no `hidden` without `hiddenScore`.

---

## 3. Merge / dedupe strategy

Precedent: finder.mjs's `fuzzyMerge` (token-Jaccard titles + normalized-venue equality + family-aware strictness) and `mergeCluster` (richest-field-wins, sources/buzz union). Places are simpler in one way (no dates) and harder in two (name typos in authoritative data; one destination spanning multiple records).

1. **Blocking:** grid-bucket by ~0.02° cells (compare within cell + 8 neighbors) — replaces the events pipeline's by-day blocking.
2. **Name match:** reuse `titleTokens`/`jaccard` (≥0.5) **plus per-token edit-distance ≤1 tolerance**. This is mandatory, not optional: Pinellas County GIS spells its own preserve **"Weeden Island"** vs official "Weedon" — exact tokens fail an o/e benchmark. Also strip trailing spaces, fold case, normalize "St."/"Saint", drop designator suffix variants (Park/Preserve/County Park/State Park) before comparing (e.g. "Caladesi Island State Park" relation vs legacy GNIS node).
3. **Spatial gate, name-confidence-scaled:** strong name match → merge within **2.5 km** (Fort De Soto-sized parks put gov point and OSM centroid far apart); fuzzy-only match → **1 km** (covers every observed dupe: Caladesi ×2 @700m, Weedon ×2, Anclote pier ×3 segments, "Pass-a-Grille"/"Pass-A-Grille" case dupes).
4. **Field precedence in the cluster merge:** government > OSM for hours/amenities/address/url; longest description wins (only Tampa has them); amenities = **union** across sources; isFree: any explicit fee source beats inference; name: official gov spelling wins EXCEPT when OSM matches the operator's own website spelling (the Weedon case — prefer "Weedon", keep "Weeden" in an internal aliases list for matching). `sources[]` union + `srcCount` mirror events' sources/buzz.
5. **Adjacent-destination caution (do NOT over-merge):** Tampa marks "Davis Islands Beach" DOGPARK=Yes and the adjacent "Davis Islands Seaplane Basin" DOGBEACH=Yes — same destination to a human, two official records ~hundreds of meters apart, **different names**. Rule: never merge on proximity alone; name match is always required. The Davis Islands pair ships as two places (both pass the benchmark); S-sprint UI can group later.
6. **Courts/anonymous geometry → amenities, not places:** OSM tennis/basketball/pickleball/anonymous playgrounds/piers (0.7–5% named) attach to the **nearest named park within 400 m of centroid** as amenity chips (`"tennis"`, `"pickleball"`…); unmatched anonymous elements are dropped. (We deliberately don't fetch polygons — `out center` only — so this is a centroid-distance heuristic, not true point-in-polygon; the government amenity booleans carry the primary load, OSM courts are corroboration. If precision disappoints, upgrading to Overpass area-joins is a contained v1.5 task.) Named courts facilities (Pickleball Kingdom, Tejas Pradip Patel Tennis Center) DO ship as standalone `placeType:"courts"` places.
7. **No geocoding needed** — every source ships coordinates. Nominatim stays out of this pipeline entirely (saves budget, removes a failure mode). Keep the `inBox` assert from finder.mjs as a hard filter.

---

## 4. Benchmark-by-benchmark (R3 — pass by GENERATION)

Harness rule: benchmarks are **fuzzy-substring matches against the generated places.json** (the events benchmarks-block pattern), NEVER live name-regex Overpass queries — the scout proved case-insensitive full-bbox name regexes time out at 66s. Matching must use the same edit-tolerant comparator as the merge (Weeden/Weedon).

| Roster item | Generates from | Status today |
|---|---|---|
| **Caladesi Island State Park** | OSM parks (relation/4237301) + FDEP (SITE_NAME exact, fee flag, URL) + Pinellas (DESIGNATION=State) | ✅ green, triple-sourced |
| **Fort De Soto** | Pinellas ("Fort De Soto Park", DOGPARKAREA=Yes) + OSM (relation/20601460, hours/dog/website/wikidata; + Recreational Trail relation) | ✅ green, richest of the five |
| **Weedon Island Preserve** | OSM (relation/1004552, hours/operator/website/wikidata) + Pinellas (**as "Weeden"** — fuzzy match required) | ✅ green IF the comparator tolerates the county's own typo |
| **Davis Islands dog park beach** | Tampa (Davis Islands Beach DOGPARK=Yes + Seaplane Basin DOGBEACH=Yes, the literal field) + OSM (Dog Beach way/28940097 + Dog Park way/28938150) | ✅ green; descriptions/amenities come from Tampa (OSM records carry 2 tags) |
| **Moonlight Beach** | **NOWHERE — does not exist in Tampa Bay** (proven 6 independent ways across both scouts) | ❌ **⚑R-MOON: Josh must re-ratify.** Recommended: Honeymoon Island State Park (rich in OSM + FDEP today). Alternates: Sunset Beach (Tarpon Springs / Treasure Island), Ben T Davis Beach, Dog Beach (Fort De Soto). Do not build the benchmark until he calls it. |
| ⚑FLAG-R1 (existing) | Courts/rec + urban-basics rosters still owed by Josh/Charles (Riverwalk, Julian B. Lane, Bayshore seeds). Note: urban-basics (Riverwalk) will come from Tampa layer + OSM; courts class from Pinellas booleans + named OSM facilities. | open |

Additional mechanism benchmarks for the block (events-pipeline style): total places ≥300 · coords-in-box = 100% · places with hours ≥150 (gov layers guarantee it) · places with amenities ≥250 · hidden shelf within cap · zero anonymous ("name"-less) places · per-source count floors (Pinellas ≥350, Tampa ≥150, OSM-named ≥600, FWC ≥200) so a silently-broken source fails loudly.

---

## 5. Hidden-gem scoring v1 (R4) — proxies grounded in verified fields

All signals below were probed against real data today; weights are starting points for the in-sprint sim:

1. **No wikidata/wikipedia tag** (OSM) — verified inverse-fame signal: only 50/1,035 named parks carry wiki tags and they're exactly the famous ones (Fort De Soto, Honeymoon, Weedon). `has wiki → hiddenScore = 0, hard exclusion`. Free and defensible.
2. **Distance from tourist centroids** — St. Pete Pier, Clearwater Beach, downtown Tampa; >8 mi adds points (scout's combined probe at this threshold yielded 139 plausible candidates).
3. **Niche amenity present** (gov booleans, verified to exist): DISCGOLF, SHUFFLEBOARD, CANOELAUNCH, DOGBEACH, SKATEPARKAREA — "without this app, how would you know" material (the Diaby principle).
4. **Designation = City/County (not State)** — state parks are by definition publicized.
5. **Maintained-destination floor:** OSM tag richness ≥6 OR any gov hours/amenity record — the honest fix for the plan's named risk that tag-richness ≠ hidden (it means *well-mapped*); it's used as a quality floor, not a hidden signal.
6. **srcCount as a mild inverse signal** — a place in 3+ sources is well-known; single-gov-source + no-wiki leans hidden.
- "Absence from top-10 lists" (R4 sketch): **deferred** — no verified machine-readable source for it; wikidata-absence is the v1 stand-in.
- Shipping rule mirrors events: capped shelf (GEM_CAP analog), title-dedupe, **Josh/Charles eyeball the first generation before the tag ships** (MASTER_PLAN2 Risk #1 mitigation, unchanged).

---

## 6. Attribution obligations (feeds Sprint X3)

| Source | Obligation |
|---|---|
| OSM (Overpass + the events pipeline's existing Nominatim use) | **ODbL — REQUIRED** once places ship: "© OpenStreetMap contributors" with ODbL link. Already slotted in X3; now it has teeth. |
| FDEP State Parks | **Explicit licenseInfo requirement:** "Acknowledgement of the Originator when using the data set as a source." Credit FDEP by name. |
| Pinellas County | Public records; licenseInfo names the steward — credit "Pinellas County BTS Enterprise GIS" (egis@pinellas.gov). |
| City of Tampa / Hillsborough County / FWC / SWFWMD | FL public records, keyless; credit each agency by name on the attribution page. |
| Politeness ledger (documented per X3) | Overpass: ≤15 serialized queries/week, 10s spacing, identified UA. ArcGIS self-hosted (tampagov.net, ca.dep.state.fl.us, gis.myfwc.com): cached hard, weekly, single-pass. |

---

## 7. Effort estimate (fractions of a past sprint ≈ Sprint L's data work as the unit)

| Work item | Estimate | Notes |
|---|---|---|
| `_arcgis.mjs` shared helper + module loader skeleton in places.mjs (clone finder.mjs's loader/cache pattern) | 0.15 | The pattern is already written — it's a port, not a design |
| Pinellas module | 0.10 | Helper does most of it; amenity map is the work |
| Tampa module | 0.10 | Same shape + 60s timeout + DESCRIPT cleaning (reuse `_shared.mjs` cleanText) |
| FDEP module (+ Entrances layer) | 0.05 | 15 rows in-region; trivial |
| FWC boat ramps module | 0.10 | Envelope query + typed fee fields |
| Hillsborough module | 0.05 | Thin fields, \r\n cleanup |
| SWFWMD module (PROJECTNAME join across layers) | 0.15 | The only multi-layer join; can slip to fast-follow |
| OSM Overpass module (12 classes, serialization + backoff, class filters, named-only/brewery/protected filters, court→park amenity join) | 0.30 | The biggest single module; rate-limit discipline + filters are spec'd verbatim above |
| Merge/dedupe + schema emit + benchmarks block + smoke asserts | 0.30 | fuzzyMerge/mergeCluster are direct precedents; new: edit-tolerant names, spatial gate |
| Hidden scoring v1 + sim + eyeball pass | 0.20 | Signals verified; the sim is the work |
| **Total R2–R4** | **≈ 1.3–1.5 sprint-units** | Matches MASTER_PLAN2's "heavy lift" framing; SWFWMD deferral buys 0.15 if needed |

---

## 8. Risks (named honestly)

1. **⚑R-MOON blocks R3 sign-off** — one of five ratified benchmarks cannot ever pass. Cheap to resolve (one Josh decision), expensive to ignore.
2. **Overpass rate-limiting** — proven hostile at 3s spacing. Mitigation is spec'd (10s + backoff + UA) and measured to work 11/11; a CI/W3 future run shares the same code path. Kumi fallback is 7 weeks stale — acceptable for places, log when used.
3. **Slow government servers** — tampagov.net needed 60s for a count; ca.dep/myfwc also self-hosted. Per-module timeout overrides + the existing cache-fallback pattern make this a warning, not a failure.
4. **Endpoint drift** — ArcGIS layer indices move on portal reorganizations. Mitigation: per-source count-floor benchmarks fail loudly; the Hub discovery API (`{hub}/api/search/v1/collections/dataset/items?q=`) re-finds layers fast; SWFWMD endpoints especially (they're extracted from a web map, not a catalog) — documented in the module header.
5. **Authoritative-data typos** ("Weeden", trailing spaces, \r\n) — handled by the edit-tolerant comparator; add a benchmark asserting Weedon merges to ONE record.
6. **Dog-park false positives** (breweries tagged dog_park) and **protected-area junk** (Coast Guard sectors) — co-tag filters spec'd; eyeball pass on first generation.
7. **Class thinness**: disc golf (OSM n=5 — gov booleans carry it), viewpoints (n=46 — sunset spots will come from beaches/piers; the S1 "Views" bubble may need beach/pier members, flag to S-sprint design).
8. **Payload/refresh**: total raw ~5 MB/week across everything — trivial. Weekly cadence per the R DoD; when W3's cron lands, places refresh runs as a separate weekly job, NOT on the 6h events cadence (also softens the already-flagged 1.7 GB/yr git-history sleeper).
9. **Court-join approximation** (centroid distance, not polygon containment) — bounded risk because gov booleans are the primary amenity feed; upgrade path named in §3.6.

## File map for R2 build agents
- `C:\Users\daonl\Desktop\cj\finder\places.mjs` — new orchestrator (clone loader/cache/benchmark conventions from `C:\Users\daonl\Desktop\cj\finder\finder.mjs`; reuse its `TB_BOX`/`inBox`, slugify, titleTokens/jaccard via export or copy)
- `C:\Users\daonl\Desktop\cj\finder\places-sources\` — `_arcgis.mjs`, `osm.mjs`, `pinellas-parks.mjs`, `tampa-parks.mjs`, `fdep.mjs`, `fwc-ramps.mjs`, `hillsborough-parks.mjs`, `swfwmd.mjs` (module contract mirrors `C:\Users\daonl\Desktop\cj\finder\sources\pinellas.mjs`: export `name`, `fetchPlaces()`, self-test under `process.argv` guard; `_`-prefix = skipped by loader)
- Output: `finder\output\places.json` + `places.md`; sync copy to `app\public\places.json` (second lazy fetch — never concat into events norm)
- Text helpers: reuse `C:\Users\daonl\Desktop\cj\finder\sources\_shared.mjs` as-is.

---

# APPENDIX A — OSM-as-backbone scout report (verbatim)

# OSM-as-Backbone Scout Report — Sprint R1 (places layer)
_Research scout, 2026-06-11. Every number below comes from live Overpass API queries run today against the Tampa Bay bbox (lat 27.3–28.6, lng −83.3–−81.9). No repo files written; raw dumps in `C:\Users\daonl\AppData\Local\Temp\osm-scout\` if you want to inspect before they evaporate._

## VERDICT UP FRONT

**OSM is the backbone. Proven, with three honest caveats.**

1. **4 of 5 nature benchmarks pass by generation** from plain class queries — no name targeting, no hardcoding. The 5th, **Moonlight Beach, does not exist in Tampa Bay** (or anywhere in Florida) under that name in OSM — see the benchmark table for the evidence and the likely intended place (Honeymoon Island).
2. **Class coverage is deep where it matters** (parks 1,540 · tennis 2,413 · gardens 1,324 · playgrounds 1,101 · basketball 1,040 · pickleball 483 · boat ramps 234 · beaches 194 · dog parks 175 · nature reserves 156) and **thin in exactly two classes**: viewpoints (46, only 14 named) and disc golf (5 elements — genuinely bad; supplement from UDisc or county sources).
3. **Names are the gate, not geometry.** Courts/piers/playgrounds are mapped as anonymous polygons (tennis 0.7% named, piers 2.5%, playgrounds 4.9%). The pipeline MUST spatially join sport facilities to their containing named park rather than treat each court way as a "place." Parks themselves are 67% named — that's the usable inventory.

Estimated named-place yield after dedupe: **~1,400–1,500 raw named elements → comfortably clears R's 300+ DoD** from OSM alone, before county/state sources add a single row.

---

## 1. ENDPOINT & RATE-LIMIT INTEL (measured, not read about)

| Endpoint | Behavior today |
|---|---|
| `https://overpass-api.de/api/interpreter` | **Primary. Use this.** First probe returned 504 "dispatcher too busy" (transient — common on the main instance); 30s later it served the same query in 0.65s. DB timestamp **2026-06-11T17:46Z — minutes fresh**. Biggest class (parks, 901 KB) returned in 13.1s. |
| `https://overpass.kumi.systems/api/interpreter` | Works (HTTP 200, no rate-limiting observed) but took **91.6s for a trivial count** and its DB timestamp was **2026-04-21 — ~7 weeks stale**. Fallback only; fine for places (they change slowly), but don't prefer it. |

**Rate-limit law, measured:** with a 3s gap between queries, overpass-api.de gave me **11× HTTP 429 out of 15 queries** (the two free slots exhaust and refill on ~30–40s horizons under load). With an **8–10s gap + retry-on-429 with 20/40/60s backoff, every single query succeeded** (11/11 on the retry pass, two transient 429/504s recovered on attempt 2). The pipeline rule for `places.mjs`: **serialize queries, ≥10s apart, retry 429/504 with linear backoff, send a real User-Agent** (I used `TampaBayWeekendApp-research-scout/0.1 (contact: joshuaallanmorgan@gmail.com)`). At one full refresh per week this is far inside fair-use.

**Payload sizes** (`out center;` = tags + centroid, no full geometry): total for all 15 classes = **4.3 MB raw JSON**. Largest: parks 880 KB, piers 841 KB, tennis 682 KB, gardens 485 KB. Nothing approached the MB-per-query danger zone because `out center` skips way geometry — **never use `out geom` for this pipeline**, centroids are all the app needs.

**One MinGW gotcha for the builder:** `curl --data-urlencode "data@file"` silently posted an empty body on Windows git-bash curl 7.75 ("Your input contains only whitespace" error from Overpass). Inline `--data-urlencode "data=$Q"` works. Watch for this in any `.mjs`→`child_process` curl path; native `fetch` in Node avoids it entirely.

---

## 2. CLASS-BY-CLASS RESULTS (every query verbatim, replayable)

All class queries follow this template — substitute the filter line:

```
[out:json][timeout:90];(  <FILTER>  (27.3,-83.3,28.6,-81.9););out center;
```

| Class | Filter (verbatim) | Hits | Named | website | opening_hours | wheelchair | surface | avg tags |
|---|---|---|---|---|---|---|---|---|
| Parks | `nwr["leisure"="park"]` | **1,540** | 1,035 (67%) | 226 (14%) | 90 (5%) | 6 | 10 | 3.5 |
| Beaches | `nwr["natural"="beach"]` | **194** | 34 (17%) | 1 | 1 | 1 | 43 (22%) | 1.8 |
| Nature reserves | `nwr["leisure"="nature_reserve"]` | **156** | 77 (49%) | 9 (5%) | 8 (5%) | 0 | 0 | 3.5 |
| Protected areas | `nwr["boundary"="protected_area"]` | **84** | 59 (70%) | 6 (7%) | 4 | 0 | 0 | 5.4 |
| Trails (routes) | `relation["route"~"^(hiking|foot|walking)$"]` | **43** | 43 (**100%**) | 7 (16%) | 0 | 0 | 0 | **6.3** |
| Tennis | `nwr["sport"~"tennis"]["sport"!~"table_tennis"]` | **2,413** | 17 (0.7%) | 3 | 38 | 7 | 95 | 2.3 |
| Basketball | `nwr["sport"~"basketball"]` | **1,040** | 16 (1.5%) | 1 | 1 | 0 | 57 | 2.4 |
| Pickleball | `nwr["sport"~"pickleball"]` | **483** | 4 (0.8%) | 2 | 2 | 1 | 32 | 2.4 |
| Dog parks | `nwr["leisure"="dog_park"]` | **175** | 72 (41%) | 11 (6%) | 7 (4%) | 11 (6%) | 4 | 2.7 |
| Viewpoints | `nwr["tourism"="viewpoint"]` | **46** | 14 (30%) | 0 | 0 | 2 | 2 | 2.4 |
| Gardens | `nwr["leisure"="garden"]` | **1,324** | 34 (2.6%) | 6 | 1 | 2 | 0 | 1.2 |
| Piers | `nwr["man_made"="pier"]` | **3,448** | 88 (2.5%) | 2 | 2 | 0 | 156 | 1.6 |
| Boat ramps | `nwr["leisure"="slipway"]` | **234** | 35 (15%) | 3 | 2 | 0 | 19 | 1.9 |
| Playgrounds | `nwr["leisure"="playground"]` | **1,101** | 54 (4.9%) | 2 | 7 | 3 | 37 | 1.4 |
| Disc golf | `nwr["leisure"="disc_golf_course"]` + `nwr["sport"="disc_golf"]` | **5** | 2 | 0 | 0 | 0 | 0 | 3.6 |

Example names pulled from the dumps (3–5 per headline class, lat/lng):
- **Parks:** Hillsborough River State Park (way/35014944, 28.1473,−82.2344, 14 tags) · Vila Brothers Park (27.9499,−82.4861) · Eureka Springs Park (28.0066,−82.3456) · Ellis Park (28.0131,−82.1195)
- **Beaches:** Clearwater Beach (27.9850,−82.8287) · Pass-a-Grille Beach (27.7136,−82.7463) · Belleair Beach (27.9320,−82.8422) · Dog Beach (27.6149,−82.7292) · Sunset Beach, Tarpon Springs (28.1444,−82.7909)
- **Nature reserves:** Gladys E. Douglas Preserve (28.0065,−82.7603, **17 tags**) · Werner-Boyce Salt Springs State Park (28.3165,−82.7199) · Alafia Scrub Nature Preserve (27.8592,−82.3391) · Bell Creek Nature Preserve (27.8461,−82.2882)
- **Trails:** Fort De Soto Recreational Trail (rel/4627962) · Florida National Scenic Trail – Central Region (rel/14480289, 18 tags) · the Lettuce Lake red/yellow/blue trail set (28.09,−82.44)
- **Dog parks:** Apollo Beach Dog Park (27.7651,−82.4105, 14 tags) · Mango Dog Park (27.9880,−82.3011) · Saladino Dog Park (27.9166,−82.2766) — plus dog-friendly taprooms tagged `dog_park` (Two Shepherds Taproom, Pinellas Ale Works): charming, but the pipeline should not call a brewery a park (filter on co-tags like `craft`/`amenity`).
- **Gardens:** Sunken Gardens (way/469432855, 27.7900,−82.6372, **20 tags**) · Hollis Gardens (28.0422,−81.9514) · Gizella Kopsick Palm Arboretum (27.7826,−82.6259)
- **Piers:** Anclote Gulf Park Fishing Pier (28.1927,−82.7882, 14 tags) · Spa Beach/St. Pete area piers — but **97.5% of pier ways are anonymous private docks**; name-required filter is mandatory.
- **Boat ramps:** Kingfish Boat Ramp (27.4975,−82.7024, 11 tags) · Water Works Park Canoe/Kayak Launch (27.9599,−82.4638)
- **Pickleball:** Crescent Lake Pickleball Courts (27.7852,−82.6426) · The Tejas Pradip Patel Tennis Center (27.9774,−82.5078, 17 tags, multi-sport) · Pickleball Kingdom (27.8370,−82.6883)

**Pipeline-shaping observations:**
- **Courts are geometry, not places.** 2,413 tennis ways with 17 names total. The right model: courts/playgrounds/piers become **amenity chips on the containing named park** (spatial containment join — Overpass `map_to_area`/`is_in` or a point-in-polygon pass in places.mjs against park polygons). This is exactly the `amenities[]` field R2 already specs.
- **Gardens needs a named-only or `garden:type` filter** — 1,290 of 1,324 are anonymous residential garden polygons.
- **Protected areas needs a `protect_class`/access filter** — the top tag-rich hits were literally *U.S. Coast Guard Sector St. Petersburg* (34 tags, very much not a weekend destination).
- **Dedupe is real and the R2 spatial+name plan is right:** Caladesi exists twice (legacy GNIS node/358692989 + relation/4237301, 700m apart), Weedon twice (node "Weedon Island State Preserve" + relation "Weedon Island Preserve"), Anclote Gulf Park Fishing Pier three times (three way segments). Name-normalized + ~1km spatial merge handles all observed cases.
- The `["sport"~"tennis"]["sport"!~"table_tennis"]` regex pair has one known edge: a hypothetical `sport=table_tennis;tennis` value would be wrongly excluded — none observed in this bbox; acceptable.

---

## 3. THE BENCHMARK ROSTER — query-by-query

The honest headline first: **full-bbox name-regex queries TIME OUT and are the wrong tool.** All five of these (verbatim) returned `remark: "runtime error: Query timed out in 'query' at line 1 after 66 seconds"` — a case-insensitive regex over name can't use the index across a 1.3°×1.4° box:

```
[out:json][timeout:60];(nwr["name"~"Moonlight",i](27.3,-83.3,28.6,-81.9););out center;   ← TIMED OUT
[out:json][timeout:60];(nwr["name"~"Caladesi",i](27.3,-83.3,28.6,-81.9););out center;    ← TIMED OUT
[out:json][timeout:60];(nwr["name"~"De Soto|DeSoto",i](27.3,-83.3,28.6,-81.9););out center; ← TIMED OUT
```

Two forms that DO work, both verified live:
- **Case-sensitive regex, full bbox** (uses substring index): `[out:json][timeout:150];nwr["name"~"Moonlight"](27.3,-83.3,28.6,-81.9);out tags center 30;` → 200 OK in 30.6s.
- **Tight bbox, case-insensitive**: `[out:json][timeout:30];nwr["name"~"Dog",i](27.89,-82.47,27.93,-82.43);out tags center;` → 200 OK in 7.9s.
- **Best of all: don't name-query at all.** R3 demands pass-by-GENERATION, and generation delivers: every benchmark below was found inside the plain class dumps from §2.

| Benchmark | Verdict | OSM evidence (element, coords, tags) |
|---|---|---|
| **Caladesi Island State Park** | ✅ **PASS by generation** (parks class) | relation/4237301 (28.0263,−82.8176) `leisure=park`, `website=floridastateparks.org/...caladesi-island-state-park` + legacy GNIS node/358692989. Tags modest (4) — state-park registry enriches. |
| **Fort De Soto** | ✅ **PASS by generation** (parks + trails) | relation/20601460 "Fort De Soto County Park" (27.6301,−82.7226), **10 tags: opening_hours=sunrise-sunset, dog=yes, website, wikidata Q5471030, alt_name** — plus relation/4627962 "Fort De Soto Recreational Trail" in the trails class. Richest benchmark of the five. |
| **Weedon Island Preserve** | ✅ **PASS by generation** (nature_reserves + protected_areas) | relation/1004552 (27.8483,−82.6077), **9 tags: opening_hours=07:00-sunset, operator=Pinellas County, website=weedonislandpreserve.org, wikidata Q7979351**. |
| **Davis Islands dog park beach** | ✅ **PASS by generation** (dog_parks class) | way/28940097 "**Davis Islands Dog Beach**" (27.9125,−82.4460) + way/28938150 "Davis Islands Dog Park" (27.9097,−82.4462). **Caveat: 2 tags each** (leisure + name only) — the place exists and generates, but descriptions/amenities must come from City of Tampa parks data. |
| **Moonlight Beach** | ❌ **ABSENT — honestly reported** | Exhaustive evidence: (a) zero matches across all 15 class dumps; (b) the case-sensitive full-bbox query above returned **only 11 residential streets** (Moonlight Lane/Court/Avenue…); (c) Nominatim "Moonlight Beach Florida" → one residential street in Walton County (panhandle). The famous "Moonlight Beach" is in **Encinitas, CA**. **Most likely intended: Honeymoon Island State Park** (the moon-named barrier island immediately north of Caladesi) — which generates beautifully: relation/20601459 (28.0759,−82.8243), **15 tags incl. fee=8 USD, opening_hours=08:00-sunset, phone, website, wikidata Q1626871**, plus node/1948057363 "Honeymoon Island Dog Beach." Alternates if Josh meant something else: Sunset Beach (Tarpon Springs, way/194250907), Dog Beach (Fort De Soto, way/329959789), Pass-a-Grille Beach. **⚑ Needs Josh's call — do not silently substitute.** |

Full named-beach inventory (34 names) is in the dump if Josh wants to re-pick: Apollo, Bahama, Bahia, Belleair, Bradenton, Clearwater, Crystal, Dog Beach, Dunedin, East (×2), Gardenville, Hernando, Howard Park, Hubbard's, Hudson, Indian, Lido, Manatee County, North, Pass-a-Grille (×2 spellings — dedupe case!), Picnic Island (×3 segments), Pine Island Park, Rogers Park, South, Spa, Sunset, + misc.

---

## 4. HIDDEN-GEM PROXY — is there enough signal? Yes, cautiously.

Probed on the parks class (n=1,035 named):
- **Inverse-fame signal exists and is cheap:** only **50/1,035 parks carry wikidata/wikipedia tags** — and they're exactly the famous ones (Fort De Soto, Honeymoon Island, Weedon all have wikidata). `has_wiki → NOT hidden` is a free, defensible exclusion.
- **Tag richness works as an "actually maintained, actually a destination" filter:** 322/1,035 named parks have ≥6 tags.
- Combined probe — **≥6 tags AND no wiki tags AND >8 mi from tourist centroids** (St. Pete Pier / Clearwater Beach / downtown Tampa) → **139 candidates**, e.g. Mike E Sansone Community Park (Plant City), Riverview Park, Saladino Park (Brandon), Higginbotham Park. Eyeballing them: plausible "without this app, how would you know" material, leaning suburban-county-park. The plan's risk note stands — tag-richness ≠ hidden, it means *well-mapped* — but as one input among several (R4's niche-amenity + absence-from-top-10 signals), the raw material is there. Capped shelf + Josh/Charles eyeball remains the right safety.

---

## 5. RECOMMENDATIONS FOR `finder/places.mjs` (R2)

1. **Endpoint policy:** overpass-api.de primary, ≥10s between queries, retry 429/504 ×3 with 20/40/60s backoff, kumi.systems as cold fallback, real User-Agent. ~15 queries/refresh, weekly — trivially polite.
2. **Always `out center;` never `out geom`** — 4.3 MB total vs tens of MB. Cache per-class JSON like the event sources do.
3. **Place inventory = named elements of:** parks, beaches, nature_reserves, protected_areas (filtered), trails, dog_parks (brewery-filtered), gardens (named-only), piers (named-only), boat_ramps, viewpoints, playgrounds (named-only). Courts (tennis/basketball/pickleball) + anonymous playgrounds/piers become **amenities[] on containing parks via point-in-polygon**, not standalone places.
4. **Benchmarks in the harness = substring match against generated places.json** (never live name-regex queries — they time out and aren't generation anyway).
5. **Known supplements needed:** disc golf (OSM has 5 elements — county/UDisc), viewpoint thinness (sunset spots will mostly come from beaches/piers, not `tourism=viewpoint`), descriptions for sparse-tag winners like Davis Islands Dog Beach (City of Tampa), state-park enrichment for Caladesi (floridastateparks.org).
6. **ODbL attribution is mandatory once this ships** — already correctly slotted in X3.
7. **⚑ for Josh:** confirm Moonlight Beach → Honeymoon Island State Park substitution (or supply the real intended place). The other four roster items are green by generation today.


---

# APPENDIX B — Government/institutional sources scout report (verbatim)

# Sprint R Source Scout — Government/Institutional Places Sources (VERIFIED 2026-06-11)

Every endpoint below was **actually queried** (live `f=json` REST calls with `where=1=1&resultRecordCount=N`, counts via `returnCountOnly`), not just located. All are keyless and free. Tampa Bay bbox used for spatial tests: lat 27.3–28.6, lng −83.3–−81.9.

---

## ⚠️ BENCHMARK ALERT FIRST: "Moonlight Beach" does not exist in Tampa Bay

Reported honestly per mission orders. Verified four independent ways:
- **Nominatim global search** for "Moonlight Beach": every hit is Canada, South Africa, New Zealand, or Turkey. Zero in Florida.
- **Web search** `"Moonlight Beach" Florida`: the famous one is Moonlight **State** Beach, Encinitas, **California**; the only FL hits are "Moonlight Beach Villas" (a condo complex in Flagler Beach, Atlantic coast) and a Moonlight Park in Royal Palm Beach.
- **Tampa parks GIS layer**: `NAME LIKE '%MOONLIGHT%'` → 0 rows.
- **Pinellas parks GIS layer** (418 parks incl. every municipality): 0 rows.

(OSM Overpass itself was 504/busy during the session, but Nominatim runs on the same OSM data — the negative is solid.)

**Closest real candidates Josh may have meant** (all verified present in the sources): **Sunset Beach** (Treasure Island — Pinellas layer has "Sunset Beach Pavilion" + "Sunset Vista Park"), **Sunset Beach** (Tarpon Springs — in Pinellas layer under that exact name), **Honeymoon Island State Park** (FDEP layer; the moon/romance association), **Ben T Davis Beach** (Tampa layer). There's also a "Moonlight zip line tour" at Mobbly Bayou Preserve (Oldsmar) — a possible memory crossover. **Josh needs to re-ratify this roster slot before R3 hardcodes a benchmark that can never pass.**

---

## Benchmark coverage table

| Benchmark | Source it should appear in | Verified result |
|---|---|---|
| Moonlight Beach | (beaches) | ❌ **Does not exist in Tampa Bay** under that name — see candidates above |
| Caladesi Island State Park | FL State Parks | ✅ FDEP layer: `SITE_NAME="Caladesi Island State Park"`, Pinellas, 2,420 ac, fee flag, URL. ALSO in Pinellas Park_Points (`DESIGNATION="State"`, `MUNICIPALTY="Dunedin"`) |
| Fort De Soto | Pinellas County | ✅ Pinellas Park_Points: `"Fort De Soto Park"`, County, `DOGPARKAREA="Yes"` |
| Weedon Island Preserve | Pinellas County | ✅* Present but spelled **"Weeden Island Preserve"** (county GIS misspells its own preserve; official site spells "Weedon"). **Merge/benchmark matching MUST be fuzzy** (≥1-char edit tolerance) or this benchmark fails on an o/e |
| Davis Islands dog park beach | City of Tampa | ✅ Tampa layer generates it: `"Davis Islands Beach"` (BEACH=Yes, DOGPARK=Yes, 1002 Severn Ave) + `"Davis Islands Seaplane Basin"` (DOGBEACH=Yes, BEACH=Yes, 864 Severn Ave). The literal `DOGBEACH` field exists in the schema |

4 of 5 pass by generation today; the 5th is a roster error, not a coverage gap.

---

## Source inventory, ranked by value-per-effort

### 1. Pinellas County Park Points — ★ the single best source found
- **Endpoint (verified):** `https://services.arcgis.com/f5HgUpxURgEzTccH/arcgis/rest/services/Pinellas_Park_Points/FeatureServer/0/query`
- **Format:** ArcGIS hosted FeatureServer, `f=json` verified; hosted services also support `f=geojson`. Add `&outSR=4326` (default geometry comes back Web Mercator 102100).
- **Count:** **418** points — and it includes **county AND all 23 municipalities**: St Petersburg 125, Clearwater 72, Dunedin 26, Largo 18, Tarpon Springs 16… (verified via groupBy stats). One module covers the whole peninsula including St Pete and Clearwater city parks.
- **Fields:** NAME, FULLADDR, **OPERDAYS/OPERHOURS**, PARKURL, PARKAREA, NUMPARKING, RESTROOM, ADACOMPLY + ~30 amenity booleans (SWIMMING, HIKING, FISHING, PICNIC, BOATING, PLAYGROUND, TENNISCOURTS, BASKETBALL, VOLLEYBALL, SKATEPARKAREA, **DOGPARKAREA**, DISCGOLF, SHUFFLEBOARD…) + DESIGNATION (City/County/State) + PARK_TYPE + MUNICIPALTY.
- **Sample records:** Williams Park (330 2nd Ave N, St Pete, RESTROOM=Yes, PARKURL→stpeteparksrec.org) · Fort De Soto Park (County, DOGPARKAREA=Yes) · Caladesi Island State Park (State, Dunedin).
- **Terms:** public records; licenseInfo names the data steward (Pinellas BTS Enterprise GIS, egis@pinellas.gov) — credit on the X3 attribution page.
- **Companion:** `Pinellas_ParkBoundaries_view/FeatureServer` (polygons) if area/boundary needed later.

### 2. City of Tampa — Park and Recreation Areas
- **Endpoint (verified):** `https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Location/MapServer/9/query` (Park Polygons = layer 10). Hub: [City of Tampa GeoHub](https://city-tampa.opendata.arcgis.com/datasets).
- **Format:** self-hosted ArcGIS MapServer, `f=json` verified. Server is **slow** (one count query timed out at 40s, succeeded at 60s) — cache hard, be polite.
- **Count:** **196** points.
- **Fields — the richest amenity schema of any source:** NAME, FULLADDR, CITY/ZIP, **PHONE**, **DESCRIPT** (real editorial blurbs — e.g. Kate Jackson Community Center ships a 3-sentence history), **OPERDAYS/OPERHOURS**, PARKURL + ~45 booleans: **BEACH, DOGBEACH, DOGPARK, BOATRAMP, CANOELAUNCH, PIER, MARINA**, SPLASHPAD, SKATEPARK, DISCGOLF, POOL, PICKLECOURT, AUTISMFRIEND, NATURALTRAILS, IMPROVEDTRAILS…
- **Sample records:** Picnic Island Park (DOGBEACH=Yes, BEACH=Yes) · Ben T Davis Beach (FEATURECODE=Beach) · Davis Islands Seaplane Basin (DOGBEACH=Yes).
- **Terms:** city open data, free; credit City of Tampa.

### 3. FDEP — Florida State Parks Boundaries (the real "Florida State Parks registry")
- **Endpoint (verified):** `https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PARKS_BOUNDARIES/MapServer/0/query` — found via [FDEP geodata hub](https://geodata.dep.state.fl.us), which also has sibling layers: **Florida State Park Entrances** (point coords — better than polygon centroids for directions), Camping Sites, Structures.
- **Format:** state-hosted MapServer, `f=json` verified. Field names: `SITE_NAME`, COUNTY, ACREAGE, **URL** (direct floridastateparks.org page link), ADDRESS, **PUBLIC_ACC** (e.g. "Open-Fee Required" — a fee flag!).
- **Count:** 179 statewide; **15 in Hillsborough/Pinellas/Pasco/Manatee** (verified list: Caladesi, Honeymoon Island, Hillsborough River, Egmont Key, Alafia River, Little Manatee River, Werner-Boyce, Cockroach Bay, Terra Ceia, Ybor City Museum…).
- **Terms (from licenseInfo):** "Acknowledgement of the Originator when using the data set as a source" — explicit attribution requirement, note for X3.
- **Important:** `floridastateparks.org` itself returns **403 even with a browser UA** (Akamai bot wall) — no public JSON behind the park finder was found. Don't build a scraper; the FDEP layer's URL field gives you the link-out, and hours are near-uniform ("8 a.m. to sundown, 365 days"). If per-park fees/blurbs are ever wanted, the finder's existing Playwright stack is the only viable route.

### 4. FWC Florida Boat Ramp Inventory (the water-access class, solved)
- **Endpoint (verified):** `https://gis.myfwc.com/mapping/rest/services/Open_Data/FWC_Florida_Boat_Ramp_Inventory/MapServer/4/query`
- **Count in bbox:** **275** ramps (envelope query verified with `inSR=4326`).
- **Fields:** RampName, **Hours** ("Sunrise to Sunset"), **isFeeRequired + FeeAmount + FeeCollectionType**, RampSurface/Condition, lanes, parking counts, **RestroomType**, AccessibilityLevel, Street/City/County, **Latitude/Longitude as plain fields**, WaterBodyName, Status ("Open for Business").
- This maps almost 1:1 onto the places schema (isFree, hours, amenities). Inventory base is a 2009 study but FWC states they maintain it (Status field is live).

### 5. Hillsborough County Parks_and_Recreation
- **Endpoint (verified):** `https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/Parks_and_Recreation/FeatureServer/0/query` — via [Hillsborough GeoHub](https://gis2017-01-10t133755357z-hillsborough.opendata.arcgis.com).
- **Count:** **541** polygons. **But thin:** NAME, ADDR (note embedded `\r\n`), TYPE, **USES** (free-text like "Boat Ramp"), PROPOWNER/PROPMNG. **No hours, no amenity booleans, no URLs.**
- Sample: "Alafia River Boat Ramp", 4020 Alafia Blvd, Brandon, USES="Boat Ramp".
- **Verdict:** authoritative names/footprints for 541 county properties — use for names+geometry+USES, and let the OSM merge supply amenities. The hcfl.gov HTML directory was probed for enrichment but the guessed URL 404'd; their site restructure makes scrape-enrichment a separate (low-priority) investigation.

### 6. SWFWMD Recreation (found the hard way — NOT on their open-data hub)
- The [SWFWMD open data portal](https://data-swfwmd.opendata.arcgis.com) has **no recreation dataset** (verified: full 50-item listing is land-use/potentiometric/seagrass). The real services hide behind their Recreation Map Viewer web map (item `ce92eb0ed43f4c8590c143cbb4c2ad29`), whose operational layers I extracted and queried:
  - **SWFWMD Recreation Areas:** `https://services1.arcgis.com/gdr0FcZCwx1BmrQk/arcgis/rest/services/RecreationAmenitiesGeodatabase/FeatureServer/0` — 472 land-project polygons (acquisition-flavored names).
  - **RecreationGuide FeatureServer** (same org): `/0` Main Entrances · `/1` Public Access Points · `/3` **Amenities and Activities** (verified sample: `{TYPE:"picnic area", PROJECTNAME:"Brooker Creek Headwaters Nature Preserve", STATUS:"Active"}`) · `/4` Camping Locations · `/5` Multiuse Trails · `/6` Florida Trail Association Trails (only 6 features) · `/7` Recreation Properties.
- **Verdict:** worth a module for the preserve class (Brooker Creek, Weekiwachee-type lands Josh's "nature paths" bubble wants), joining amenity points to properties via PROJECTNAME, bbox-filtered. Medium effort, medium reward.

### 7. City of St. Petersburg Parks — SKIP (redundant)
- Verified to exist: `https://services2.arcgis.com/9qPLjNtocjo438CJ/arcgis/rest/services/Parks_view/FeatureServer` (via [St. Pete Geohub](https://geohub-csp.opendata.arcgis.com)). But Pinellas Park_Points already carries 125 St Pete parks with amenities/hours. Keep as a fallback if Pinellas ever staleness-fails.

### 8. City of Clearwater — SKIP (no portal needed)
- Clearwater has [no open-data parks dataset of its own](https://www.myclearwater.com/My-Government/About-Clearwater/Maps-GIS); its 72 parks are in the Pinellas layer. Solved by source #1.

### 9. Florida Trail Association — one-time seed at most
- No public API of their own; their trails appear as the 6-feature layer inside SWFWMD's RecreationGuide. The Florida National Scenic Trail barely clips the bbox (Green Swamp/Withlacoochee fringe). Not worth a module.

---

## Module vs one-time-seed recommendations

| Build as finder/sources-style module (cached, weekly refresh) | One-time seed / skip |
|---|---|
| Pinellas Park_Points (#1) | FTA trails (seed from SWFWMD layer 6 if wanted) |
| Tampa Parks MapServer/9 (#2) | St Pete Parks_view (fallback only) |
| FDEP State Parks (+ Entrances layer) (#3) | Clearwater (covered) |
| FWC Boat Ramps (#4) | floridastateparks.org scrape (don't — 403 wall) |
| Hillsborough Parks (#5) | |
| SWFWMD RecreationGuide (#6, lower priority) | |

Sprint R's DoD of 300+ places is comfortably covered by government sources alone: 418 + 196 + 541 + 275 + 15 ≈ 1,400 raw records pre-dedupe, before OSM adds a single node.

## Attribution & politeness (for X3 and the pipeline)

- All sources are Florida public records, keyless, no rate-limit terms published. **FDEP explicitly requires acknowledgement of originator**; Pinellas names its data steward; credit each agency by name on the attribution page (alongside the already-planned OSM ODbL line — and note Nominatim/Overpass usage also falls under ODbL).
- Esri-cloud-hosted services (`services.arcgis.com`, `services1/2…`) are robust; the **state/city self-hosted servers (`arcgis.tampagov.net`, `ca.dep.state.fl.us`, `gis.myfwc.com`) are slow** — Tampa needed 60s for a count. Cache every response (finder already has the cache pattern), refresh weekly as the plan says, paginate with `resultOffset` (typical `maxRecordCount` 1000-2000, irrelevant at these sizes).
- Always pass `&outSR=4326` — Pinellas returned Web Mercator by default.

## Engineering gotchas worth carrying into R2

1. **Fuzzy name matching is mandatory**: "Weeden" vs "Weedon" is a county's own typo; also trailing spaces in NAME ("North Shore Park ") and `\r\n` inside Hillsborough ADDR.
2. **Amenity vocabularies differ per source**: Pinellas uses Yes/No strings (DOGPARKAREA), Tampa uses Yes/No with different field names (DOGPARK, DOGBEACH), FWC uses typed fields (isFeeRequired/FeeAmount) — the R2 normalizer needs a per-source amenity map, which these field lists fully specify.
3. **Dog-beach truth is messy even in authoritative data**: Tampa marks Davis Islands Beach DOGPARK=Yes/DOGBEACH=No and the adjacent Seaplane Basin DOGBEACH=Yes — merge-by-proximity will want to treat that pair carefully (they're the same destination to a human).
4. **Hub discovery API** (`{hub}/api/search/v1/collections/dataset/items?q=`) worked on every ArcGIS Hub portal and is the fastest way to re-discover layers if any endpoint moves.

Sources: [Pinellas eGIS](https://new-pinellas-egis.opendata.arcgis.com/) · [City of Tampa GeoHub](https://city-tampa.opendata.arcgis.com/datasets) · [Hillsborough GeoHub](https://gis2017-01-10t133755357z-hillsborough.opendata.arcgis.com/) · [FDEP geodata](https://geodata.dep.state.fl.us) / [FDEP park mapping](https://floridadep.gov/parks/park-mapping-databases) · [SWFWMD data & maps](https://www.swfwmd.state.fl.us/resources/data-maps) · [FWC Boat Ramp Finder](https://gis.myfwc.com/BoatRampFinder/) and [inventory service](https://gis.myfwc.com/mapping/rest/services/Open_Data/FWC_Florida_Boat_Ramp_Inventory/MapServer) · [Find a Park — Florida State Parks](https://www.floridastateparks.org/parks-and-trails) (bot-blocked) · [Tampa beaches page](https://www.tampa.gov/parks-and-recreation/parks-and-facilities/beaches) · [St. Pete Geohub](https://geohub-csp.opendata.arcgis.com/) · [Clearwater Maps & GIS](https://www.myclearwater.com/My-Government/About-Clearwater/Maps-GIS)
