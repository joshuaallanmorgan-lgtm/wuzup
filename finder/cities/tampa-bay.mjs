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

// sanity box — any coordinate outside this is wrong for a local place/event.
export const bbox = { latMin: 27.3, latMax: 28.6, lngMin: -83.3, lngMax: -81.9 };
// the box in each source's required wire format (byte-identical to the literals the
// consumers used: osm Overpass, FWC ArcGIS envelope, Nominatim geocode viewbox).
export const bboxOverpass = `(${bbox.latMin},${bbox.lngMin},${bbox.latMax},${bbox.lngMax})`;
export const bboxArcgisEnvelope = JSON.stringify({ xmin: bbox.lngMin, ymin: bbox.latMin, xmax: bbox.lngMax, ymax: bbox.latMax });
export const geocodeViewbox = `${bbox.lngMin},${bbox.latMax},${bbox.lngMax},${bbox.latMin}`;

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
