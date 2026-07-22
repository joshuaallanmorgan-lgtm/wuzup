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
// ✅ EVENTS UNGATED (Stage D sf-events build): the manifest refusal lifts
// with `finder/cities/sf-east-bay.sources.json` (the scouted static set:
// AllEvents pages + paced Eventbrite geo queries). Source modules load ONLY
// from `finder/sources/sf-east-bay/` — Tampa's modules live in
// finder/sources/tampa-bay/ and can never run for this city (the Stage D
// module-isolation fix); a missing/empty dir is a loud zero, never a
// fallback. `sf-east-bay.venues.json` bootstraps from the first real events
// run via finder/build-venues.mjs (its absence is a loud merge-quality skip,
// not an honesty gate). The PLACES side runs (its adapters landed in D3).

// sanity box — any coordinate outside this is wrong for a local place/event.
// Ratified by Josh 2026-06-16 (PHASE_3.7.md §I.5): SF through the East Bay to
// Walnut Creek/Concord + a buffer.
// ⚑ RESOLVED (Fable ruling 2026-07-06, judgment delegated by Josh for the v1
// ship): lngMax widened −122.00 → −121.88 so Mt. Diablo State Park generates
// as a real spot — the city HERO shows the mountain, users will search it, and
// the packet's own rosterBenchmark wanted it. The east-edge widening adds the
// state-park corridor only; the Mt. Diablo / east-Concord places MATERIALIZED
// in the Stage E places regeneration (same branch). NOTE the places pipeline
// is operator-run, at need — the weekly refresh workflow is events-only by
// design (STAGE_E.md §E4); a bbox/config change here does nothing to the
// shipped spots until someone runs `CITY=sf-east-bay node finder/places.mjs`.
import { defineReviewedImageRejects } from '../reviewed-image-rejections.mjs';

export const bbox = { latMin: 37.68, latMax: 38.00, lngMin: -122.53, lngMax: -121.88 };
// the box in each source's required wire format (derived — edit the box once).
export const bboxOverpass = `(${bbox.latMin},${bbox.lngMin},${bbox.latMax},${bbox.lngMax})`;
export const bboxArcgisEnvelope = JSON.stringify({ xmin: bbox.lngMin, ymin: bbox.latMin, xmax: bbox.lngMax, ymax: bbox.latMax });
export const geocodeViewbox = `${bbox.lngMin},${bbox.latMax},${bbox.lngMax},${bbox.latMin}`;

// timezone — America/Los_Angeles (Pacific + DST). Wired: D2 routes ALL day/time
// math through `tz` (Intl-derived per-date offsets, DST-safe — see tampa-bay.mjs).
export const tz = 'America/Los_Angeles';

// geocode facts (the D2 seam shape — see tampa-bay.mjs for field semantics).
// cityRe = locality-hint extractor for THIS city's listings; corridor localities
// only (the D3 gazetteer ambiguity traps — richmond/alameda-as-island — matter
// for the AREA list, not here: this regex only ever sees this city's addresses).
export const geocode = {
  region: 'California',
  regionRe: /\bca\b|\bcalifornia\b/i,
  cityRe: /(san francisco|oakland|berkeley|emeryville|alameda|albany|el cerrito|richmond|orinda|lafayette|moraga|walnut creek|pleasant hill|concord|martinez|san leandro|piedmont|danville)/i,
  fallbackLocality: 'San Francisco',
  junkKeyWords: ['san francisco', 'california', 'east bay', 'bay area'],
};

// last-resort CATEGORIZATION PRIORS (documented as priors, not facts) — the
// city-flavored half of finder.mjs's categorize() fallthrough, the seam the
// D2 audit flagged for extraction "when city #2's source scout lands".
// These fire ONLY after every text rule came up empty, exactly like Tampa's
// in-finder CONCERT_VENUE_RE / SOURCE_CATEGORY. Built from the FIRST REAL
// SF RUN's 'other' residue (2026-07-05: 104 events, 75 of them artist-name-
// only listings at the big sheds).
export const priors = {
  // venue priors, tested in order: what these rooms program in the
  // overwhelming majority of cases. music BEFORE sports so the combined
  // "Oakland Arena and Oakland-Alameda County Coliseum" complex string
  // resolves to the arena's concert prior; the bare Coliseum/stadium/park
  // strings are the pro/college sports parks.
  venuePriors: [
    ['music', /oakland arena|chase center|bill graham civic|greek theatre|the fillmore|the warfield|davies symphony|sfjazz|yoshi'?s|stern grove|great american music hall|the independent\b|the masonic|regency ballroom|fox theater|\bthe freight\b|freight (?:&|and) salvage|music park|the chapel\b|\bpier 80\b/i],
    ['nightlife', /1015 folsom|the great northern|\bcrybaby\b|dance fridays|retro junkie/i],
    ['sports', /oracle park|california memorial stadium|oakland.alameda county coliseum|\bcoliseum\b/i],
  ],
  // source-family priors for the civic/campus calendars whose unmatched
  // residue is municipal/campus programming by definition (the City-of-
  // Tampa / Univ.-of-Tampa class).
  sourceCategory: {
    'SF Rec & Parks': 'community',
    'UC Berkeley': 'community',
  },
};

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

// Wikidata P18/P373 entity-image conflations to exclude. Both entities resolve
// to a lifeguard-training photo: related context, but not an exact photo of the
// named trail or recreation area. Exact-place imagery fails closed to art.
export const qidDeny = ['Q4116375', 'Q5192966'];

const imageAuditEvidence = Object.freeze({
  report: 'planning/v2/S10_IMAGE_AUDIT_2026-07-21.md',
  reportSha256: 'sha256:4bee54bf0847f6de7a06443ffdf513055abfd85d0f2d6a67110f928518958830',
});
const reviewedImageRejection = (
  placeKey, image, sourcePage, sourceFamily, reviewRow, reason,
) => ({
  placeKey,
  image,
  sourcePage,
  sourceFamily,
  evidence: { ...imageAuditEvidence, reviewRow },
  disposition: 'remove-or-replace',
  reason,
});

// Exact-item image quarantine from the frozen Sprint 10 review. The recorded
// candidate/provenance tuple keeps the audit exact, while an active entry
// quarantines every image ladder for that item until a positive review clears it.
export const imageRejects = defineReviewedImageRejects('sf-east-bay', [
  reviewedImageRejection(
    'p|don-castro-regional-recreation-area',
    'https://upload.wikimedia.org/wikipedia/commons/6/6f/Don_Guillermo_Castro_%28cropped%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3ADon%20Guillermo%20Castro%20(cropped).jpg',
    'wikidata-p18', 51,
    'A portrait of Don Castro is not an image of the recreation area.',
  ),
  reviewedImageRejection(
    'p|ocean-beach',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Ocean_and_waves_%28Unsplash%29.jpg/1280px-Ocean_and_waves_%28Unsplash%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AOcean%20and%20waves%20(Unsplash).jpg',
    'wikidata-p373', 54,
    'A generic Unsplash beach does not establish San Francisco\'s Ocean Beach.',
  ),
  reviewedImageRejection(
    'p|sutro-heights-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Sutro_Heights_Park_-_panoramio.jpg/1280px-Sutro_Heights_Park_-_panoramio.jpg',
    'https://commons.wikimedia.org/wiki/File%3ASutro%20Heights%20Park%20-%20panoramio.jpg',
    'wikidata-p373', 56,
    'The shallow panorama cannot produce a useful mobile crop.',
  ),
  reviewedImageRejection(
    'p|lake-chabot-regional-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Chabot_Park%2C_San_Leandro%2C_California%2C_US.jpg/1280px-Chabot_Park%2C_San_Leandro%2C_California%2C_US.jpg',
    'https://commons.wikimedia.org/wiki/File%3AChabot%20Park%2C%20San%20Leandro%2C%20California%2C%20US.jpg',
    'wikidata-p373', 62,
    'A wood-chip and parking scene neither shows Lake Chabot nor establishes the park.',
  ),
  reviewedImageRejection(
    'p|presidio-of-san-francisco',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Euc_presidio.jpg/1280px-Euc_presidio.jpg',
    'https://commons.wikimedia.org/wiki/File%3AEuc%20presidio.jpg',
    'wikidata-p373', 78,
    'An electric-unicycle group is not a representative exact-place image.',
  ),
  reviewedImageRejection(
    'p|coit-tower-cafe',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Coit_Tower_2021.jpg/1280px-Coit_Tower_2021.jpg',
    'https://commons.wikimedia.org/wiki/File%3ACoit%20Tower%202021.jpg',
    'wikidata-p18', 85,
    'Coit Tower is shown for the distinct Coit Tower Cafe item.',
  ),
  reviewedImageRejection(
    'p|candlestick-point-state-recreation-area',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Candlestick_Point_Park5.jpg/1280px-Candlestick_Point_Park5.jpg',
    'https://commons.wikimedia.org/wiki/File%3ACandlestick%20Point%20Park5.jpg',
    'wikidata-p18', 91,
    'The demolished stadium makes this materially outdated for the current recreation area.',
  ),
  reviewedImageRejection(
    'p|dinosaur-hill-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/DinoHillPano2731x505.jpg/1280px-DinoHillPano2731x505.jpg',
    'https://commons.wikimedia.org/wiki/File%3ADinoHillPano2731x505.jpg',
    'wikidata-p18', 95,
    'The shallow panorama is too generic for a useful mobile card crop.',
  ),
]);

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
