// FDEP — Florida State Parks (the real state-parks registry).
// Boundaries layer (/0) carries the attributes (SITE_NAME, ACREAGE, URL,
// PUBLIC_ACC fee flag, ADDRESS); the sibling Entrances point layer (/2) is
// preferred over polygon centroids for coordinates. PLACES_SOURCES.md §1 S4.
//
// Do NOT scrape floridastateparks.org — Akamai 403 wall even with a browser
// UA; the URL field is the link-out.
import { pathToFileURL } from 'node:url';
import { arcgisQuery, tidy } from './_arcgis.mjs';

export const name = 'FDEP State Parks';

const BASE = 'https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PARKS_BOUNDARIES/MapServer';
const TIMEOUT_MS = 60000; // state self-hosted server — be generous

export async function fetchPlaces() {
  // Attributes only from the polygon layer (geometry is huge and unneeded)…
  const bounds = await arcgisQuery(`${BASE}/0`, { returnGeometry: false, timeoutMs: TIMEOUT_MS });
  // …coords from the Entrances point layer, joined by UNIT_ID.
  const entrances = await arcgisQuery(`${BASE}/2`, { returnGeometry: false, timeoutMs: TIMEOUT_MS });

  // One entrance per park: prefer "Main Entrance", else the first seen.
  const entranceByUnit = new Map();
  for (const f of entrances) {
    const a = f.attributes || {};
    if (typeof a.LATITUDE !== 'number' || typeof a.LONGITUDE !== 'number') continue;
    const prev = entranceByUnit.get(a.UNIT_ID);
    if (!prev || (/main/i.test(a.TYPE || '') && !/main/i.test(prev.type || ''))) {
      entranceByUnit.set(a.UNIT_ID, { lat: a.LATITUDE, lng: a.LONGITUDE, type: a.TYPE });
    }
  }

  const places = [];
  for (const f of bounds) {
    const a = f.attributes || {};
    const placeName = tidy(a.SITE_NAME);
    const entrance = entranceByUnit.get(a.UNIT_ID);
    if (!placeName || !entrance) continue; // statewide layer; the orchestrator's bbox filter trims to Tampa Bay
    // A closed park shipped as a destination is a stale lie (Tampa and FWC
    // both filter closed; FDEP must too — 'Closed' is a live PUBLIC_ACC value).
    if (/^closed/i.test(tidy(a.PUBLIC_ACC) || '')) continue;

    const classes = ['park'];
    if (/\bpreserve\b/i.test(placeName)) classes.push('preserve');
    if (/\btrail\b/i.test(placeName)) classes.push('trail');

    const place = {
      name: placeName,
      lat: entrance.lat,
      lng: entrance.lng,
      classes,
      amenities: [],
      source: name,
      designation: 'State',
      operator: 'Florida State Parks',
    };
    if (tidy(a.ADDRESS)) place.address = tidy(a.ADDRESS);
    if (tidy(a.URL)) place.url = tidy(a.URL);
    // PUBLIC_ACC live values: 'Open-No Fee Required' / 'Open-Fee Required' /
    // 'Open-Prior Arrangement Required' / 'Closed' / null. ORDER MATTERS:
    // 'Open-No Fee Required' CONTAINS the substring 'fee required', so the
    // no-fee test must run first. Anything else (prior-arrangement, null)
    // says nothing about fees — omit, never infer.
    const acc = tidy(a.PUBLIC_ACC);
    if (acc && /no fee required/i.test(acc)) place.isFree = true;
    else if (acc && /fee required/i.test(acc)) place.isFree = false;
    places.push(place);
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count (statewide, pre-bbox): ${places.length}`);
      console.log(`fee-flagged: ${places.filter((p) => p.isFree === false).length}`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
