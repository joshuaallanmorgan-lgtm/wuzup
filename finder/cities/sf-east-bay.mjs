// finder/cities/sf-east-bay.mjs — SF & East Bay city config (Stage D3).
//
// City #2 (Josh 2026-06-16, RECONFIRMED 2026-07-01 ruling #9): the SF → Walnut
// Creek corridor — San Francisco + Oakland/Berkeley/Emeryville + Orinda/Lafayette/
// Pleasant Hill → Walnut Creek/Concord. NOT the whole Bay Area (no San Jose, no
// North Bay). Cloned from the tampa-bay.mjs reference shape; every endpoint +
// hero below was live-verified 2026-07-03 (STAGE_D_SF_ENDPOINTS.md).
//
// ✅ D1 LANDED (multi-tenant artifacts): a CITY=sf-east-bay run is SAFE for
// Tampa — every output/cache path is namespaced (finder/output/sf-east-bay/,
// finder/cache/sf-east-bay/), mapillary --ship clears only this city's
// place-img dir, and app/public changes only via finder/deploy.mjs (which
// refuses to deploy this city until its artifact set exists).
// ⚠️ EVENTS still D2-GATED: this config exports `timezone` but not the `tz` +
// `geocode` shape finder.mjs consumes, so an events run FAILS CLOSED at module
// load (nothing written). The PLACES side runs (its adapters land in D3).

// sanity box — any coordinate outside this is wrong for a local place/event.
// Ratified by Josh 2026-06-16 (PHASE_3.7.md §I.5): SF through the East Bay to
// Walnut Creek/Concord + a buffer.
// ⚑ FLAG for Josh (STAGE_D_SF_ENDPOINTS.md): Mt. Diablo's summit sits at
// lng −121.914 — EAST of this box's −122.00 edge. As a HERO it's fine (a city-
// mood backdrop, not a place record — same logic as Tampa's skyline hero), but
// the packet's "Mt. Diablo generates as a benchmark spot" check CANNOT pass
// unless the box widens (lngMax ≈ −121.88 would take in the state park proper).
// Keeping the ratified box verbatim until Josh rules; see rosterBenchmark below.
export const bbox = { latMin: 37.68, latMax: 38.00, lngMin: -122.53, lngMax: -122.00 };
// the box in each source's required wire format (derived — edit the box once).
export const bboxOverpass = `(${bbox.latMin},${bbox.lngMin},${bbox.latMax},${bbox.lngMax})`;
export const bboxArcgisEnvelope = JSON.stringify({ xmin: bbox.lngMin, ymin: bbox.latMin, xmax: bbox.lngMax, ymax: bbox.latMax });
export const geocodeViewbox = `${bbox.lngMin},${bbox.latMax},${bbox.lngMax},${bbox.latMin}`;

// timezone — America/Los_Angeles (Pacific + DST). ⚠️ NOT WIRED YET: finder.mjs
// still hardcodes Eastern offsets (~293–310); until D2 routes day/time math
// through this field, every SF event would be stamped 3 hours early. This field
// is the D2 wiring target (PHASE_3.7.md §I.5 critical-refactor flag).
export const timezone = 'America/Los_Angeles';

// government source ranking — richness-ranked tie-breaks among gov layers.
// Strings must match each adapter's `name` export exactly. SF Rec & Parks
// outranks EBRPD (address/zip/acres/neighborhoods vs name/status/acres); the
// GGNRA editorial seed ranks last (hand-written, deliberately thin).
export const govOrder = [
  'SF Rec & Parks',
  'EBRPD Parks',
  'GGNRA (editorial seed)',
];

// tourist centroids for the hidden-gem "far from tourists" proxy (count-agnostic
// downstream — places.mjs takes the min distance over however many are listed).
export const touristCentroids = [
  { name: 'Fisherman\'s Wharf / Pier 39', lat: 37.8087, lng: -122.4098 },
  { name: 'Union Square', lat: 37.7880, lng: -122.4074 },
  { name: 'Golden Gate Bridge Welcome Center', lat: 37.8078, lng: -122.4750 },
  { name: 'Jack London Square', lat: 37.7946, lng: -122.2782 },
];

// HONESTY — AREA gazetteer (town / city / island / neighborhood words) for the
// Commons geosearch name-match. ⛔ DELIBERATELY EMPTY — FAIL-CLOSED RULE:
// the geosearch ladder (places-images.mjs ladder 2) must NOT run for this city
// until this gazetteer is populated AND manually reviewed per
// MULTICITY_IMAGERY_RUNBOOK.md. An empty gazetteer does NOT fail safe there —
// it fails OPEN: phraseAreaOnly() stops recognizing area-only phrases, so a
// generic "San Francisco" / "Lake Merritt" geotag would count as a strong
// of-the-place name-match and ship wrong photos (the exact false-positive class
// the Phase-1.1 Tampa cleanup fixed). UNREVIEWED candidates are staged in the
// comment block at the bottom of this file — a human review promotes them here.
export const area = '';

// Wikidata P18/P373 entity-image conflations to exclude (per-city; fills in as
// the imagery pass finds them — starts empty like every honesty verdict set).
export const qidDeny = [];

// Mapillary cafe-imagery honesty (the OFFLINE Stage-B harness; per-city).
export const cafe = {
  // local-vocab additions to the base GENERIC_CAFE stop-list (none yet — the
  // candidate-gen pass proposes, the manual review ratifies).
  genericExtra: [],
  // cafe-directional words extending AREA for the cafe matcher ONLY. Empty for
  // the same fail-closed reason as `area` — SF candidates ('soma', 'fidi',
  // 'gourmet ghetto', 'uptown', 'downtown'…) go through the same manual gate.
  areaExtra: [],
  // pixel-level verdicts land ONLY after the standing adversarial REFUTE pass +
  // Josh's eyeball (runbook step 3.5). They start empty for every new city.
  forceDrop: [],
  forceKeep: [],
};

// imagery thresholds — config DEFAULTS; env vars still override at runtime.
export const imagery = {
  confFloor: 0.4,
  tierBMaxAlign: 25,
  tierBMaxD: 35,
  tierBMinQuality: 0.4,
  // ⚠️ PER-CITY RECHECK REQUIRED (MULTICITY_IMAGERY_RUNBOOK.md §1): 60 is the
  // TAMPA-TUNED value for the upside-down-frame sky heuristic (measured on Tampa
  // dashcam captures). SF & East Bay's capture mix (hills, fog, dense street
  // canyons, far more pedestrian/bike captures) may separate differently —
  // re-verify against this city's frames BEFORE trusting any orientation flip.
  // Do not treat this number as verified for this city; it is a placeholder
  // inheriting Tampa's tuning.
  orientFlipThreshold: 60,
};

// smoke-test roster benchmark — EMPTY until this city's sources land + D1/D2
// merge (an empty roster ⇒ the benchmark assertion skips, so `npm test` stays
// green with Tampa active AND with this city selected). Candidate anchors for
// when it fills (packet §I.5 checklist), slugs to be confirmed against actual
// generation:
//   'crissy-field'            (GGNRA seed — in-box)
//   'lands-end'               (GGNRA seed — in-box)
//   'charles-lee-tilden-regional-park' (EBRPD — in-box; the layer's
//                             OFFICIAL_NAME is "Charles Lee Tilden Regional
//                             Park", live-verified — NOT 'tilden-regional-park')
//   'briones-regional-park'   (EBRPD — in-box, live-verified)
//   'mount-diablo-state-park' ⚑ OUTSIDE the ratified bbox (see the bbox flag) —
//                             cannot generate unless Josh widens the box.
export const rosterBenchmark = [];

// ---------------------------------------------------------------------------
// City heroes — REAL Commons photos, live-verified 2026-07-03 (Commons API:
// size/mime/license/artist all confirmed; see STAGE_D_SF_ENDPOINTS.md §7).
// Shape mirrors app/src/lib.js CITY.heroes / CITY.spotsHeroes — the app still
// hardcodes Tampa's heroes; D4 (app-side city model) wires these in. Recorded
// here so the verified credits live with the city config (⚑X3 attribution).
// ---------------------------------------------------------------------------
export const heroes = [
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/GoldenGateBridge-001.jpg/960px-GoldenGateBridge-001.jpg',
    credit: 'Rich Niewiroski Jr.',
    license: 'CC BY 2.5',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.5',
    page: 'https://commons.wikimedia.org/wiki/File:GoldenGateBridge-001.jpg',
  },
];
export const spotsHeroes = [
  {
    // CC0 — no byline legally required; credited anyway (house style: every
    // hero carries its credit).
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Mount_Diablo_with_wildflowers.jpg/960px-Mount_Diablo_with_wildflowers.jpg',
    credit: 'Mx. Granger',
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:Mount_Diablo_with_wildflowers.jpg',
  },
];

export const meta = { id: 'sf-east-bay', name: 'SF & East Bay', center: { lat: 37.84, lng: -122.25 } };

// ---------------------------------------------------------------------------
// ⛔ UNREVIEWED — AREA gazetteer STAGING (Stage D3 prep, 2026-07-03).
// NOT CODE — a human review per MULTICITY_IMAGERY_RUNBOOK.md must cull
// ambiguous words before any of this text moves into `area` above (each
// promoted word neutralizes 2-word geosearch phrases made entirely of AREA
// words — promote a park-name word and that park stops matching its own
// photos). The staging list lives in this file so the config and its pending
// honesty review travel together.
//
// (a) DATA-DERIVED — the 50 distinct DataSF neighborhood values carried by the
// sf-parks adapter's source datasets (analysis/planning_neighborhood fields,
// live-sampled 2026-07-03; multi-word values decompose into words for review):
//   bayview hunters point bernal heights castro upper market chinatown crocker
//   amazon diamond heights downtown civic center excelsior financial district
//   south beach glen park haight ashbury hayes valley inner richmond inner
//   sunset japantown lakeshore lincoln park lone mountain usf marina mclaren
//   mission mission bay nob hill noe valley north beach ocean view oceanview
//   merced ingleside outer mission outer richmond outer sunset pacific heights
//   parkside portola potrero hill presidio presidio heights russian hill
//   seacliff south of market tenderloin treasure island ybi twin peaks
//   visitacion valley western addition
//   (EBRPD's layer carries NO district fields — East Bay area words come from
//   the corridor town list below, not from that adapter.)
//
// (b) HAND-DRAFTED — corridor towns/districts (the Tampa-list analog):
//   san francisco oakland berkeley emeryville alameda albany piedmont orinda
//   lafayette moraga walnut creek concord pleasant hill martinez richmond
//   el cerrito kensington hercules pinole san pablo soma fillmore embarcadero
//   dogpatch telegraph laurel rockridge temescal fruitvale dimond montclair
//   elmwood claremont gourmet ghetto uptown jack london yerba buena angel
//   island alcatraz county usa california ca
//
// Known review traps already spotted (do NOT promote blindly):
//   'richmond'   — both an East Bay CITY and an SF DISTRICT; high collision value.
//   'alameda'    — city, county AND island name.
//   'mission'    — neighborhood word that also opens 'Mission Peak', 'Mission
//                  Creek', 'Mission Dolores Park' (the park must still match).
//   'golden'/'gate' — NEVER: would neutralize 'Golden Gate Park' name-matches.
//   'lake'/'merritt' — 'Lake Merritt' is a DESTINATION, not an area word.
//   'glen'/'park', 'mclaren', 'lincoln', 'buena vista', 'golden gate park' —
//                  DataSF neighborhood values that are PARK NAMES (the
//                  neighborhood is named after the park): promoting their words
//                  would swallow the parks' own photo matches. Same class:
//                  'presidio' (both a district and the destination).
//   'marina'     — district word AND a generic waterfront feature word.
// ---------------------------------------------------------------------------
