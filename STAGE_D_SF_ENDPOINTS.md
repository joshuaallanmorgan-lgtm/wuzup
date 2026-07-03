# STAGE D3 — SF & East Bay places-endpoint verification report

_Stage D3 scout-builder, 2026-07-03. Every endpoint in the PHASE_3.7.md §I.5a table was
live-probed today with small sample fetches (LIMIT 1–3 / `returnCountOnly` / Overpass
`out count`) — **no full pipeline runs** (D1 multi-tenant artifacts isn't built; a full
run would overwrite Tampa's outputs). The packet's 85% confidence is now 100% on the
core stack; the three formerly-unconfirmed endpoints are each resolved below (two live
with corrected URLs, one confirmed dead with a replacement plan)._

Bbox used everywhere (Josh 2026-06-16, ratified): **37.68–38.00 N, −122.53 to −122.00 W**.

## Verdict table (supersedes §I.5a where they differ)

| Source | Endpoint (verified 2026-07-03) | HTTP | Rows | Verdict |
|---|---|---|---|---|
| OSM/Overpass | `overpass-api.de/api/interpreter`, bbox `(37.68,-122.53,38.00,-122.00)` | 200 | parks 1,058 el · cafes 1,386 el | ✅ **LIVE** — bbox swap only |
| SF Parks (DataSF) | `data.sfgov.org/resource/gtr9-ntp6.json` | 200 | **255** properties | ✅ **LIVE** (packet said 256; one retired) |
| SF Facilities (DataSF) | `data.sfgov.org/resource/ib5c-xgwu.json` | 200 | **2,685** facilities | ✅ **LIVE** (grew from 2,612) |
| EBRPD parks | `services2.arcgis.com/jeEP9c9zZoQQwtck/arcgis/rest/services/EBRPD_Parks/FeatureServer/0` | 200 | **135** park-unit polygons | ✅ **LIVE — CORRECTED URL** (see below) |
| ~~EBRPD parks (packet URL)~~ | `gis.sanramon.ca.gov/…/EBRPD_ACCP_DATE/FeatureServer/0` | 200 | 2,311 | ⚠️ live but **WRONG LAYER** — acquisition-date parcels (NAME/STATUS/ACQ_DATE/ACREAGE), many parcels per park; superseded by the official org layer above |
| EBRPD trails *(was ⚠️ 55%)* | `services2.arcgis.com/jeEP9c9zZoQQwtck/arcgis/rest/services/EBRPD_Regional_Trails_External/FeatureServer/17` | 200 | 777 polylines | ✅ **RESOLVED** — hosted item `6a6209d…` reverse-looked-up; layer id is **17** ("Regional Trails"), not 0. Nice-to-have (v1.1) |
| Alameda County *(was ⚠️ 65%)* | `services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Alameda_County_Parks/FeatureServer/0` | 200 | 450 | ✅ **RESOLVED** — the packet's UUID was an **ArcGIS Hub item id**, not a Socrata view (`data.acgov.org` is "Alameda County Open Data Hub" on ArcGIS, NOT Socrata; the packet's `api/v3/views/…/query.json` 404s). Nice-to-have |
| Contra Costa *(was ⚠️ 40%)* | `gis.cccounty.us/arcgis/rest/services` (directory live, all folders enumerated) | 200 | — | ❌ **DEAD END** — no parks/rec/trails/open-space service anywhere on the county server; Walnut Creek city GIS is private/unreachable (`data-walnutcreek.opendata.arcgis.com` → 401 private org; `gis.walnutcreekca.gov`/`gis.walnut-creek.org` → no DNS). Replacement plan below |
| ~~CA State Parks~~ | — | — | — | **DROPPED on license** (Josh 2026-06-16) — do not re-add; Mt. Diablo is covered by OSM (ODbL) |
| GGNRA/NPS | no API (packet-confirmed) | — | — | ✅ editorial seed — a committed const of famous units in `finder/places-sources/ggnra-seed.mjs`, **no nps.gov scraping** (honesty contract) |

## Per-endpoint detail

### 1. OSM Overpass — ✅ (bbox swap only)
- POST `https://overpass-api.de/api/interpreter`, resolved bbox `(37.68,-122.53,38.00,-122.00)`.
- `out count` probes (2 queries, ≥10s apart per the politeness law):
  `leisure=park` → 53 nodes + 963 ways + 42 relations = **1,058**; `amenity=cafe` →
  1,292 nodes + 94 ways = **1,386** (SF cafe density is ~5× Tampa's — the Mapillary
  cafe pass will need a candidate cap or a district slice; flagged for the imagery run).
- Server: Overpass API 0.7.62.11, data timestamp same-day. No auth. Rate limit =
  the repo's binding politeness law (≥10s gaps, 429/504 backoff — `osm.mjs`).
- The packet's older probe bbox `(37.70,-122.52,37.95,-122.06)` is superseded by the
  ratified box; the derived `bboxOverpass` in `finder/cities/sf-east-bay.mjs` is canonical.

### 2. SF Rec & Parks — DataSF Socrata — ✅ (conf 100% held)
Two datasets, join on `property_id` (numeric, stable) or `property_name`:
- **Properties** `gtr9-ntp6` — 255 rows. Verified fields: `property_id`,
  `property_name`, `latitude`/`longitude` (strings — parse), `acres`, `propertytype`
  (e.g. "Regional Park", "Neighborhood Park or Playground", "Mini Park"), `address`,
  `city`, `zipcode`, `complex`, `ownership`, `supdist`, plus FOUR neighborhood fields:
  `analysis_neighborhood`, `mons_neighborhood`, `realtor_neighborhood`,
  `planning_neighborhood` — **the AREA-gazetteer feedstock** (comma-separated values,
  e.g. "Glen Park, West of Twin Peaks").
- **Facilities** `ib5c-xgwu` — 2,685 rows. Verified fields: `facility_name`,
  `facility_type` (e.g. "Tennis Court", "Playground", "Dog Play Area"…), own
  `latitude`/`longitude`, `property_id`, `property_name`. → amenity chips for the
  parent property (mirrors the OSM anonymous-court → chip path).
- Auth: none required. Socrata unauthenticated requests share a throttled pool — our
  volume (2 GETs/run, weekly) is far below it; a free `X-App-Token` is the upgrade
  path if we ever see 429s. License: PDDL/public (DataSF standard) — attribution line
  "SF Rec & Parks / DataSF" per ⚑X3.
- Field gap confirmed: **no hours, no fee** anywhere (same as the packet's note) —
  honest "check online", never fabricate.

### 3. EBRPD parks — ✅ but at a CORRECTED endpoint
- The packet's `gis.sanramon.ca.gov …/EBRPD_ACCP_DATE/FeatureServer/0` is live but is
  an **acquisition-date parcel layer** (2,311 polygons; fields OBJECTID, NAME, STATUS,
  ACQ_DATE, SHAPE_Leng, ACQ_DATE_1, ACREAGE) — many parcels per park, third-party
  hosted (City of San Ramon). Do not build on it.
- **Build on EBRPD's own AGOL org** (`services2.arcgis.com/jeEP9c9zZoQQwtck` — the org
  the trails hosted-item reverse-lookup exposed; 160 public services):
  **`EBRPD_Parks/FeatureServer/0`** (item `7f323d1e5bb14ad2a7803d13f4be063d`, access
  public, licenseInfo: "no internal use limitations") — **135 park-unit polygons**,
  fields `NAME`, `STATUS` ("Parkland" / "Landbank"…), `PARK_UNIT`, `OFFICIAL_NAME`,
  `GIS_ACRES`, `PRIMARY_CONTACT`. `returnCentroid=true` works (hosted layer).
  Sample verified: `{NAME:"Alameda Creek Trail", STATUS:"Parkland", GIS_ACRES:7.87,
  centroid:(-122.0706, 37.5648)}`.
- Notes for the adapter: south-county units (Coyote Hills, Del Valle, Alameda Creek
  Trail…) fall OUTSIDE the ratified bbox — the pipeline's central `inBox` drop handles
  that (places.mjs:497), same as every Tampa source. `STATUS != 'Parkland'` units
  (landbank = closed to the public) must be filtered in-adapter.
- Alternate org layers surveyed (documented so nobody re-scouts): `EBRPD_Park_Boundaries_Merged`
  (103, name-merged but includes ops facilities like "Air Support Unit"),
  `ParkNames_asPoints` (36 — label points only), `Ebrparkp_m`, `ParkFinder_Parklands_Only`.
  `EBRPD_Parks` is the authoritative unit inventory.

### 4. EBRPD trails — ✅ RESOLVED (was ⚠️ find-URL, conf 55%)
- Hosted item `6a6209d423d24451a5d584b840f0867a` → service URL
  `services2.arcgis.com/jeEP9c9zZoQQwtck/arcgis/rest/services/EBRPD_Regional_Trails_External/FeatureServer`,
  **layer 17** ("Regional Trails") — 777 polylines. Fields: `LOCALNAME`, `REGNAME_1..4`,
  `PARK_NAME`, `TYPE`, `SURFACE`, `MILES_LENGTH`, `ACCESS`, `OWNER`, `OPERATED_BY`.
- Verdict: **v1.1 nice-to-have** (packet agrees). Trails-as-places needs a name-
  aggregation design (777 segments → ~dozens of named regional trails); EBRPD parks +
  OSM `route=hiking` relations already carry the v1 trail story.

### 5. Alameda County — ✅ RESOLVED (was ⚠️ test, conf 65%)
- The packet's `data.acgov.org/api/v3/views/4842a702…/query.json` → **404**; the
  Socrata discovery API says `Domain not found: data.acgov.org`. The county portal is
  an **ArcGIS Hub** ("Alameda County Open Data Hub") and the packet's UUID is the
  **Hub item id**: `4842a70247ee493eb1d523f176c04483` ("Alameda_County_Parks", owner
  AlamedaCounty.CA.US) → live service
  `services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Alameda_County_Parks/FeatureServer/0`
  — **450 rows**, field-RICH amenity flags ("X" marks): Restrooms, Dog_Park, Hiking,
  Picnic_Tables, Play_Structure, Skate_Park, Swimming, Boat_Launch, Tennis_*,
  `Park_Name`, `City`, `Park_Type`. No licenseInfo on the item (public Hub default).
- Verdict: **v1.1 nice-to-have** (packet agrees) — mostly south-county cities outside
  the bbox; the in-bbox slice (Oakland/Berkeley/Alameda/San Leandro fringe) plus its
  amenity flags would enrich the OSM merge. Standard `_arcgis.mjs` shape when built.

### 6. Contra Costa — ❌ CONFIRMED DEAD (was ⚠️ find-layer, conf 40%) + replacement
- `gis.cccounty.us/arcgis/rest/services` directory is live (22 root services + 23
  folders, all enumerated): **no parks/rec/open-space layer exists** (closest hits:
  Libraries, City_Limits, Child_Care_Centers). Walnut Creek city GIS: Hub org is
  **private** (401), `gis.walnutcreekca.gov` / `gis.walnut-creek.org` don't resolve.
- Replacement plan (no new adapter needed for v1):
  1. **EBRPD already covers the Contra Costa regional parks** in-bbox (Tilden, Briones,
     Wildcat Canyon, Point Isabel… are EBRPD units — the county itself runs almost none).
  2. **Walnut Creek Open Space** (Shell Ridge, Lime Ridge, Sugarloaf, Acalanes Ridge)
     is well-mapped in **OSM** (`leisure=nature_reserve` / `boundary=protected_area`).
  3. If richer WC data is ever wanted: CPAD (California Protected Areas Database) has
     a holdings layer (EBRPD's own org mirrors it) — **license must be checked first**
     (CPAD terms are custom; same caution class as the dropped CA State Parks).

### 7. Heroes — verified Commons files (licenses + credits recorded in the city config)
- **Events hero — Golden Gate Bridge:** `File:GoldenGateBridge-001.jpg` — 3264×2448,
  **CC BY 2.5**, author **Rich Niewiroski Jr.** (projectrich.com). Thumb-960 URL +
  license URL + file page verified live via the Commons API.
- **Spots hero — Mt. Diablo:** `File:Mount Diablo with wildflowers.jpg` — 4624×3472,
  **CC0** (no byline legally required; credited anyway), author **Mx. Granger**.
- Alternates verified (if Charles wants options): `Snow on Mt Diablo.jpg` (CC BY-SA 3.0
  pano, ShakataGaNai), `Mt diablo north peak.jpg` (CC BY-SA 4.0, 9yz),
  `Mount Diablo State Park.jpg` (CC BY-SA 2.0, formulanone).

## What this changes vs the packet
1. **EBRPD adapter builds against the official org layer** (`EBRPD_Parks`), not the
   San Ramon parcel layer. Same `_arcgis.mjs` boilerplate; add `STATUS='Parkland'` filter.
2. **Alameda is ArcGIS Hub, not Socrata** — when v1.1 builds it, it's `_arcgis.mjs`
   boilerplate too (the packet's "Socrata — custom" note is obsolete).
3. **Contra Costa county adapter is cancelled**, not deferred — the layer doesn't
   exist. Coverage comes from EBRPD + OSM (verified above).
4. Core v1 adapter set unchanged: **OSM (bbox swap) · ebrpd-parks · sf-parks (Socrata
   custom fetch) · GGNRA editorial seed** — plus Tampa's existing 2.5km+name dedupe.

_Events-source verification is a separate report: `STAGE_D_SF_EVENTS.md`._
