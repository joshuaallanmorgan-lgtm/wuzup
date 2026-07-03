// East Bay Regional Park District (EBRPD) park units — the SF & East Bay
// crown-jewel gov layer (the corridor's Hillsborough-GIS analog).
//
// CITY-GATED: no-ops (returns []) unless the active city is sf-east-bay — the
// places loader auto-discovers every module in this directory, and Tampa runs
// must not fetch Bay Area data (STAGE_D.md D3). The gate reads the same active-
// city selector every consumer uses (finder/cities/index.mjs).
//
// Endpoint verified 2026-07-03 (STAGE_D_SF_ENDPOINTS.md §3): EBRPD's OWN AGOL
// org — NOT the packet's gis.sanramon.ca.gov URL, which turned out to be an
// acquisition-date PARCEL layer (2,311 polygons, many per park). This layer is
// the authoritative unit inventory: 135 park-unit polygons, fields NAME /
// STATUS / PARK_UNIT / OFFICIAL_NAME / GIS_ACRES. Item licenseInfo: "no
// internal use limitations" (public). THIN by design (no hours, no amenity
// booleans, no fees — same honest gap as every source here: never fabricate);
// the OSM merge supplies amenities.
//
// South-county units (Coyote Hills, Del Valle, Alameda Creek Trail…) and far-
// east units (Round Valley) fall OUTSIDE the ratified corridor bbox — the
// pipeline's central inBox drop (places.mjs) handles that, same as every
// Tampa source; this module ships the full inventory unfiltered.
import { pathToFileURL } from 'node:url';
import { arcgisQuery, tidy } from './_arcgis.mjs';
import { cityId } from '../cities/index.mjs';

export const name = 'EBRPD Parks';

const LAYER = 'https://services2.arcgis.com/jeEP9c9zZoQQwtck/arcgis/rest/services/EBRPD_Parks/FeatureServer/0';

export async function fetchPlaces() {
  if (cityId !== 'sf-east-bay') return []; // city gate — see header

  // Polygons — request centroids, not geometry (hosted layer supports it).
  const features = await arcgisQuery(LAYER, {
    returnGeometry: false,
    params: { returnCentroid: 'true' },
  });

  // One record per unit NAME: the layer carries 135 polygons for ~120 distinct
  // units (a large park can be split); keep the LARGEST polygon's centroid so
  // the record sits in the unit's main body, not an outparcel.
  const byName = new Map();
  for (const f of features) {
    const a = f.attributes || {};
    // Landbank units are ACQUIRED BUT CLOSED to the public — not destinations.
    // Only 'Parkland' (open, operating) ships.
    if (a.STATUS !== 'Parkland') continue;
    const unitName = tidy(a.OFFICIAL_NAME) || tidy(a.NAME);
    const lat = f.centroid?.y;
    const lng = f.centroid?.x;
    if (!unitName || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const acres = typeof a.GIS_ACRES === 'number' ? a.GIS_ACRES : 0;
    const prev = byName.get(unitName.toLowerCase());
    if (prev && prev._acres >= acres) continue;
    byName.set(unitName.toLowerCase(), { unitName, lat, lng, _acres: acres });
  }

  const places = [];
  for (const { unitName, lat, lng } of byName.values()) {
    // EBRPD unit-name designators tell the class honestly: "… Regional Trail" /
    // "… Trail" units are linear corridors; wilderness/preserve units are
    // preserves; shorelines/parks/recreation areas read as parks.
    const classes = [];
    if (/\btrails?\b/i.test(unitName)) classes.push('trail');
    if (/\bwilderness\b|\bpreserve\b/i.test(unitName)) classes.push('preserve');
    if (!classes.length) classes.push('park');

    places.push({
      name: unitName,
      lat,
      lng,
      classes,
      amenities: [],
      source: name,
      designation: 'Regional',
      operator: 'East Bay Regional Park District',
    });
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count: ${places.length} (0 unless CITY=sf-east-bay — city-gated)`);
      const trails = places.filter((p) => p.classes.includes('trail')).length;
      const preserves = places.filter((p) => p.classes.includes('preserve')).length;
      console.log(`trails: ${trails}, preserves: ${preserves}`);
      // corridor-box preview (the pipeline's central inBox does the real drop)
      const inCorridor = places.filter((p) => p.lat >= 37.68 && p.lat <= 38.00 && p.lng >= -122.53 && p.lng <= -122.00).length;
      console.log(`inside the ratified corridor bbox: ${inCorridor}`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
