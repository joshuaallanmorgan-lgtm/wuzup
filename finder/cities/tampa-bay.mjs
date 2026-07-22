// finder/cities/tampa-bay.mjs — Tampa Bay REFERENCE city config.
//
// THE reference config + the byte-identical regression target for the multi-city
// imagery lock. Every Tampa-specific pipeline constant lives here; consumers import
// from finder/cities/index.mjs. A second city clones this shape (its place/event
// SOURCE modules are a separate, later task — out of scope here).
//
// Byte-identity rule: the values + derived wire-format strings below MUST match what
// the consumers hard-coded before this extraction, so `node finder/places.mjs`
// reproduces the same places.json. The derived strings are computed from `bbox` so a
// new city only edits the box once.

// IANA zone — ALL wall-clock derivation in the events pipeline (day boundaries,
// offset stamping, weekend windows, junk-hour checks) routes through this.
// Offsets incl. DST come from Intl at runtime, never hardcoded ("every SF event
// stamped 7 hours early" is the bug class this prevents).
import { defineReviewedImageRejects } from '../reviewed-image-rejections.mjs';

export const tz = 'America/New_York';

// sanity box — any coordinate outside this is wrong for a local place/event.
export const bbox = { latMin: 27.3, latMax: 28.6, lngMin: -83.3, lngMax: -81.9 };
// the box in each source's required wire format (byte-identical to the literals the
// consumers used: osm Overpass, FWC ArcGIS envelope, Nominatim geocode viewbox).
export const bboxOverpass = `(${bbox.latMin},${bbox.lngMin},${bbox.latMax},${bbox.lngMax})`;
export const bboxArcgisEnvelope = JSON.stringify({ xmin: bbox.lngMin, ymin: bbox.latMin, xmax: bbox.lngMax, ymax: bbox.latMax });
export const geocodeViewbox = `${bbox.lngMin},${bbox.latMax},${bbox.lngMax},${bbox.latMin}`;

// geocoding (Nominatim) — the query-building city facts for the EVENTS pipeline.
// `region` is appended to bare address keys and anchors the venue-name fallback
// query; `regionRe` detects keys that already carry it; `cityRe` (capture group
// required) extracts a locality hint from a listing's address; `fallbackLocality`
// stands in when the address names no known locality; `junkKeyWords` are city
// words that are junk as WHOLE geocode cache keys (purged on load).
export const geocode = {
  region: 'Florida',
  regionRe: /\bfl\b|\bflorida\b/i,
  cityRe: /(tampa|st\.?\s*petersburg|st\.?\s*pete(?:\s+beach)?|clearwater|dunedin|largo|gulfport|safety harbor|palm harbor|tarpon springs|pinellas park|wesley chapel|brandon|ybor city)/i,
  fallbackLocality: 'Tampa Bay',
  junkKeyWords: ['tampa', 'florida'],
};

// government source ranking — richness-ranked tie-breaks among gov layers (§3.4).
export const govOrder = [
  'Pinellas Park Points',
  'Tampa Parks',
  'FDEP State Parks',
  'FWC Boat Ramps',
  'SWFWMD Recreation',
  'Hillsborough County Parks',
];

// tourist centroids for the hidden-gem "far from tourists" proxy.
export const touristCentroids = [
  { name: 'St. Pete Pier', lat: 27.7659, lng: -82.6259 },
  { name: 'Clearwater Beach', lat: 27.9775, lng: -82.8271 },
  { name: 'downtown Tampa', lat: 27.9477, lng: -82.4584 },
];

// HONESTY — AREA gazetteer (town / city / island / neighborhood words) for the
// Commons geosearch name-match. This is the CANONICAL list: places-images.mjs uses it
// verbatim, so changing it changes places.json. The single highest-leverage honesty
// constant — the geosearch ladder has no human eyeball gate, only this name-match.
export const area =
  'saint petersburg pete tampa clearwater dunedin sarasota bradenton brandon riverview ' +
  'seminole largo gulfport palmetto tarpon springs safety harbor temple terrace treasure ' +
  'island islands anna maria davis sand key bird ybor pine hernando pinellas hillsborough ' +
  'manatee indian rocks shores redington madeira grille apollo ruskin oldsmar estates hyde ' +
  'westshore channelside beach county usa florida fl';

// Wikidata P18/P373 entity-image conflations to exclude (per-city).
export const qidDeny = ['Q966471']; // Gwazi Field → the Iron Gwazi coaster that replaced it

const imageAuditEvidence = Object.freeze({
  report: 'planning/v2/S10_IMAGE_AUDIT_2026-07-21.md',
  reportSha256: 'sha256:4bee54bf0847f6de7a06443ffdf513055abfd85d0f2d6a67110f928518958830',
});
const reviewedImageRejection = (
  placeKey, image, sourcePage, sourceFamily, reviewRow, disposition, reason,
) => ({
  placeKey,
  image,
  sourcePage,
  sourceFamily,
  evidence: { ...imageAuditEvidence, reviewRow },
  disposition,
  reason,
});

// Exact-item image quarantine from the frozen Sprint 10 review. The recorded
// candidate/provenance tuple keeps the audit exact, while an active entry
// quarantines every image ladder for that item until a positive review clears it.
export const imageRejects = defineReviewedImageRejects('tampa-bay', [
  reviewedImageRejection(
    'p|foundation-coffee-co-ybor-city',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Ybor_City_%288061548385%29.jpg/1280px-Ybor_City_%288061548385%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AYbor%20City%20(8061548385).jpg',
    'commons-geosearch', 2, 'remove-or-replace',
    'An Amtrak/Ybor streetscape does not depict Foundation Coffee.',
  ),
  reviewedImageRejection(
    'p|curtis-hixon-waterfront-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Curtis_Hixon_Park_Tampa_Florida_United_States_-_panoramio_%281%29.jpg/1280px-Curtis_Hixon_Park_Tampa_Florida_United_States_-_panoramio_%281%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3ACurtis%20Hixon%20Park%20Tampa%20Florida%20United%20States%20-%20panoramio%20(1).jpg',
    'wikidata-p373', 8, 'remove-or-replace',
    'A generic skyline and palm view does not establish the listed park.',
  ),
  reviewedImageRejection(
    'p|fort-hamer-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Fort_Hamer_Bridge.jpg/1280px-Fort_Hamer_Bridge.jpg',
    'https://commons.wikimedia.org/wiki/File%3AFort%20Hamer%20Bridge.jpg',
    'commons-geosearch', 10, 'remove-or-replace',
    'Fort Hamer Bridge and docks do not establish the exact park item.',
  ),
  reviewedImageRejection(
    'p|tenth-street-coffee',
    '/place-img/tenth-street-coffee.jpg',
    'https://www.mapillary.com/app/?focus=photo&pKey=650653606780814',
    'mapillary-sign', 13, 'remove-or-replace',
    'The storefront is too blurry for the mobile image bar.',
  ),
  reviewedImageRejection(
    'p|edward-medard-park-boat-ramp',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Edward_Medard_Park_Lake_July_2024.jpg/1280px-Edward_Medard_Park_Lake_July_2024.jpg',
    'https://commons.wikimedia.org/wiki/File%3AEdward%20Medard%20Park%20Lake%20July%202024.jpg',
    'commons-geosearch', 14, 'remove-or-replace',
    'A reservoir overview does not show the listed boat ramp.',
  ),
  reviewedImageRejection(
    'p|banyan-coffee-co',
    '/place-img/banyan-coffee-co.jpg',
    'https://www.mapillary.com/app/?focus=photo&pKey=522934939993817',
    'mapillary-sign', 21, 'remove-or-replace',
    'The storefront is too blurred for the mobile image bar.',
  ),
  reviewedImageRejection(
    'p|palma-sola-botanical-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/CassiaFistula02_PalmaSola_Asit.jpg/1280px-CassiaFistula02_PalmaSola_Asit.jpg',
    'https://commons.wikimedia.org/wiki/File%3ACassiaFistula02%20PalmaSola%20Asit.jpg',
    'wikidata-p18', 23, 'remove-or-replace',
    'A fruit close-up is not a useful or identifying park image.',
  ),
  reviewedImageRejection(
    'p|beangood-coffee',
    '/place-img/beangood-coffee.jpg',
    'https://www.mapillary.com/app/?focus=photo&pKey=974016848499650',
    'mapillary-sign', 24, 'remove-or-replace',
    'The subject is tiny, dark, tilted, and soft.',
  ),
  reviewedImageRejection(
    'p|sunset-beach',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Sunset_Beach%2C_Tarpon_Springs%2C_United_States_%28Unsplash%29.jpg/1280px-Sunset_Beach%2C_Tarpon_Springs%2C_United_States_%28Unsplash%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3ASunset%20Beach%2C%20Tarpon%20Springs%2C%20United%20States%20(Unsplash).jpg',
    'commons-geosearch', 25, 'remove-or-replace',
    'A people-first beach portrait does not usefully depict the listed place.',
  ),
  reviewedImageRejection(
    'p|perry-harvey-sr-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Bro_Bowl_at_Perry_Harvey_Sr._Park_-_Tampa%2C_Florida.jpg/1280px-Bro_Bowl_at_Perry_Harvey_Sr._Park_-_Tampa%2C_Florida.jpg',
    'https://commons.wikimedia.org/wiki/File%3ABro%20Bowl%20at%20Perry%20Harvey%20Sr.%20Park%20-%20Tampa%2C%20Florida.jpg',
    'commons-geosearch', 28, 'remove-or-replace',
    'Bro Bowl pixels are assigned to the broader Perry Harvey Sr. Park item.',
  ),
  reviewedImageRejection(
    'p|colt-creek-state-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Colt_Creek_SP_road01.jpg/1280px-Colt_Creek_SP_road01.jpg',
    'https://commons.wikimedia.org/wiki/File%3AColt%20Creek%20SP%20road01.jpg',
    'wikidata-p18', 29, 'remove-or-replace',
    'A generic access road does not establish Colt Creek State Park.',
  ),
  reviewedImageRejection(
    'p|edward-medard-park-canoe-kayak-launch',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Edward_Medard_Park_Lake_July_2024.jpg/1280px-Edward_Medard_Park_Lake_July_2024.jpg',
    'https://commons.wikimedia.org/wiki/File%3AEdward%20Medard%20Park%20Lake%20July%202024.jpg',
    'commons-geosearch', 31, 'remove-or-replace',
    'A reservoir overview does not show the listed canoe and kayak launch.',
  ),
  reviewedImageRejection(
    'p|fort-hamer-public-boat-ramp',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Fort_Hamer_Bridge.jpg/1280px-Fort_Hamer_Bridge.jpg',
    'https://commons.wikimedia.org/wiki/File%3AFort%20Hamer%20Bridge.jpg',
    'commons-geosearch', 34, 'remove-or-replace',
    'Fort Hamer Bridge and docks do not establish the exact boat-ramp item.',
  ),
  reviewedImageRejection(
    'p|foundation-coffee-company',
    '/place-img/foundation-coffee-company.jpg',
    'https://www.mapillary.com/app/?focus=photo&pKey=484893932562446',
    'mapillary-sign', 36, 'remove-or-replace',
    'The drive-by is dark, distant, and ambiguous.',
  ),
  reviewedImageRejection(
    'p|ken-thompson-park-boat-ramp',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Ken_Thompson_Park_-_Sarasota%2C_Florida_2023-01-23_%2801%29.jpg/1280px-Ken_Thompson_Park_-_Sarasota%2C_Florida_2023-01-23_%2801%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AKen%20Thompson%20Park%20-%20Sarasota%2C%20Florida%202023-01-23%20(01).jpg',
    'commons-geosearch', 37, 'remove-or-replace',
    'A mangrove-channel image does not show the listed boat ramp.',
  ),
  reviewedImageRejection(
    'p|indian-shores-coffee',
    '/place-img/indian-shores-coffee.jpg',
    'https://www.mapillary.com/app/?focus=photo&pKey=1342952362741418',
    'mapillary-sign', 39, 'remove-or-replace',
    'The roadside capture is too dark and unclear.',
  ),
  reviewedImageRejection(
    'p|ken-thompson-park-kayak-beach',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Ken_Thompson_Park_-_Sarasota%2C_Florida_2023-01-23_%2801%29.jpg/1280px-Ken_Thompson_Park_-_Sarasota%2C_Florida_2023-01-23_%2801%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AKen%20Thompson%20Park%20-%20Sarasota%2C%20Florida%202023-01-23%20(01).jpg',
    'commons-geosearch', 40, 'remove-or-replace',
    'A mangrove-channel image does not show the listed kayak beach.',
  ),
  reviewedImageRejection(
    'p|sunset-beach-park-sand-launch-beach-city-permit-required',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Sunset_Beach%2C_Tarpon_Springs%2C_United_States_%28Unsplash%29.jpg/1280px-Sunset_Beach%2C_Tarpon_Springs%2C_United_States_%28Unsplash%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3ASunset%20Beach%2C%20Tarpon%20Springs%2C%20United%20States%20(Unsplash).jpg',
    'commons-geosearch', 43, 'remove-or-replace',
    'A people-first beach portrait does not depict the listed sand launch.',
  ),
  reviewedImageRejection(
    'p|ybor-city-museum-state-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Ybor_City_%288061548385%29.jpg/1280px-Ybor_City_%288061548385%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AYbor%20City%20(8061548385).jpg',
    'commons-geosearch', 46, 'remove-or-replace',
    'An Amtrak/Ybor streetscape does not depict the museum.',
  ),
  reviewedImageRejection(
    'p|del-bello-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Bikini_modelling_Del_Bello_Park_pp.jpg/1280px-Bikini_modelling_Del_Bello_Park_pp.jpg',
    'https://commons.wikimedia.org/wiki/File%3ABikini%20modelling%20Del%20Bello%20Park%20pp.jpg',
    'commons-geosearch', 49, 'remove-or-replace',
    'A bikini-model portrait is not a place-identifying park image.',
  ),
  reviewedImageRejection(
    'p|dundedin-hammock-park-paddlecraft-access',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Hammock_Park_%2815208028960%29.jpg/1280px-Hammock_Park_%2815208028960%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AHammock%20Park%20(15208028960).jpg',
    'commons-geosearch', 22, 'quarantine-noncanonical-duplicate',
    'The Hammock Park boardwalk belongs at most to the park, not the paddlecraft-access item.',
  ),
  reviewedImageRejection(
    'p|morris-bridge-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Morris_Bridge_Summer_Day_%289433839633%29.jpg/1280px-Morris_Bridge_Summer_Day_%289433839633%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AMorris%20Bridge%20Summer%20Day%20(9433839633).jpg',
    'commons-geosearch', 18, 'quarantine-pending-canonical-choice',
    'The shared Morris Bridge image has no ratified canonical target.',
  ),
  reviewedImageRejection(
    'p|lower-hillsborough-wilderness-preserve-morris-bridge-park',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Morris_Bridge_Summer_Day_%289433839633%29.jpg/1280px-Morris_Bridge_Summer_Day_%289433839633%29.jpg',
    'https://commons.wikimedia.org/wiki/File%3AMorris%20Bridge%20Summer%20Day%20(9433839633).jpg',
    'commons-geosearch', 18, 'quarantine-pending-canonical-choice',
    'The shared Morris Bridge image has no ratified canonical target.',
  ),
]);

// Mapillary cafe-imagery honesty (the OFFLINE Stage-B harness; per-city, does NOT
// affect places.json directly — it produces the committed place-mapillary cache).
export const cafe = {
  // local-vocab additions to the base GENERIC_CAFE stop-list (none for Tampa yet).
  genericExtra: [],
  // cafe-directional words that extend AREA for the cafe matcher ONLY — deliberately
  // NOT in the canonical `area` above (adding them there would change places.json).
  areaExtra: ['north', 'south', 'east', 'west', 'dtsp', 'downtown'],
  // Josh's verified pixel-level verdicts (2026-06-26 adversarial review). Per-city.
  forceDrop: ['p|la-casa-de-pane', 'p|pascal-s-artisan-bistro-gourmet-coffee', 'p|starbucks-78'],
  forceKeep: ['p|starbucks-30', 'p|banyan-coffee-co'],
};

// imagery thresholds — config DEFAULTS; the existing env vars still override at runtime.
export const imagery = {
  confFloor: 0.4,
  tierBMaxAlign: 25,
  tierBMaxD: 35,
  tierBMinQuality: 0.4,
  // ⚠️ PER-CITY RECHECK: the upside-down-frame sky heuristic is tuned on Tampa dashcam
  // frames (parkside measured a +123 top→bottom luma gap vs the next-most-inverted
  // real frame at +24). A new city's capture mix may differ — re-verify this threshold
  // before trusting it (see MULTICITY_IMAGERY_RUNBOOK.md, candidate-gen step).
  orientFlipThreshold: 60,
};

// smoke-test roster benchmark — Tampa-specific generation anchors (a new city swaps
// these for its own well-known places). Empty roster ⇒ the benchmark assertion skips.
export const rosterBenchmark = [
  'honeymoon-island-state-park',
  'caladesi-island-state-park',
  'weedon-island-preserve',
  'davis-islands-beach',
];

export const meta = { id: 'tampa-bay', name: 'Tampa Bay', center: { lat: 27.95, lng: -82.46 } };
