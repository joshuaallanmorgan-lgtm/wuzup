// SF Recreation & Parks — DataSF Socrata (NOT ArcGIS; custom fetch per the
// packet + STAGE_D_SF_ENDPOINTS.md §2). Two datasets joined on property_id:
//   gtr9-ntp6 — 255 properties (name, coords, type, address, neighborhoods)
//   ib5c-xgwu — 2,685 facilities (typed sub-features) → amenity chips
//
// CITY-GATED: no-ops (returns []) unless the active city is sf-east-bay (the
// loader auto-discovers every module here; Tampa runs must not fetch SF data).
//
// Honesty: no hours, no fees anywhere in either dataset (verified) — omit,
// never fabricate. License: DataSF open data (PDDL) — attribution
// "SF Rec & Parks / DataSF" (⚑X3). Socrata unauthenticated access shares a
// throttled pool; our 2 GETs/run are far below it (X-App-Token = upgrade path).
import { pathToFileURL } from 'node:url';
import { tidy } from './_arcgis.mjs';
import { cityId } from '../cities/index.mjs';

export const name = 'SF Rec & Parks';

const PROPS_URL = 'https://data.sfgov.org/resource/gtr9-ntp6.json?$limit=1000';
const FACS_URL = 'https://data.sfgov.org/resource/ib5c-xgwu.json?$select=facility_type,property_id&$limit=5000';
const UA = 'WuzupApp-places/0.1 (contact: joshuaallanmorgan@gmail.com)';
const TIMEOUT_MS = 30000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// propertytype → keep/drop + classes. Verified distinct values 2026-07-03.
// Dropped: Library (a building, covered elsewhere if ever), Other Non-Park
// Property, Concession, Zoological Garden (paid attraction, not in the place
// taxonomy), Family Camp (Camp Mather — Yosemite, far outside the bbox).
const DROP_TYPES = /^(library|other non-park property|concession|zoological garden|family camp)$/i;
const classesOf = (propertytype) => {
  if (/community garden/i.test(propertytype || '')) return ['garden'];
  return ['park']; // Neighborhood/Mini/Regional Park, Civic Plaza, Parkway
};

// facility_type → normalized amenity vocabulary (app AMENITY_LABELS ids).
// Positive matches only — maintenance/admin/landscape rows emit nothing.
const FACILITY_AMENITIES = [
  [/children'?s play area/i, 'playground'],
  [/picnic area/i, 'picnic'],
  [/basketball court/i, 'basketball'],
  [/^restroom/i, 'restrooms'],
  [/tennis\/pickleball/i, 'tennis'],
  [/tennis\/pickleball/i, 'pickleball'], // combined courts emit both
  [/^tennis court/i, 'tennis'],
  [/pickleball court/i, 'pickleball'],
  [/dog play area/i, 'dog-park'],
  [/ball field/i, 'baseball'],
  [/swimming pool/i, 'pool'],
  [/skatepark/i, 'skate-park'],
  [/volleyball court/i, 'volleyball'],
  [/disc golf/i, 'disc-golf'],
  [/campground/i, 'camping'],
  [/marina/i, 'marina'],
  [/golf facility/i, 'golf'],
  [/rec center/i, 'community-center'],
  [/adult fitness/i, 'fitness'],
  [/handball|racquetball/i, 'racquetball'],
];

export async function fetchPlaces() {
  if (cityId !== 'sf-east-bay') return []; // city gate — see header

  const [props, facs] = await Promise.all([fetchJson(PROPS_URL), fetchJson(FACS_URL)]);

  // facilities → per-property amenity sets (join key: property_id)
  const amenitiesByProp = new Map();
  for (const f of Array.isArray(facs) ? facs : []) {
    const pid = f.property_id;
    const ft = f.facility_type;
    if (!pid || !ft) continue;
    for (const [re, amenity] of FACILITY_AMENITIES) {
      if (!re.test(ft)) continue;
      let set = amenitiesByProp.get(pid);
      if (!set) amenitiesByProp.set(pid, (set = new Set()));
      set.add(amenity);
    }
  }

  const places = [];
  for (const r of Array.isArray(props) ? props : []) {
    const placeName = tidy(r.property_name);
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    const ptype = tidy(r.propertytype) || '';
    if (!placeName || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (DROP_TYPES.test(ptype)) continue;

    const classes = classesOf(ptype);
    if (/dog play area/i.test(placeName)) classes.push('dog_park');
    const amenities = [...(amenitiesByProp.get(r.property_id) || [])].sort();

    const place = {
      name: placeName,
      lat,
      lng,
      classes,
      amenities,
      source: name,
      designation: ptype || 'Park',
      operator: 'San Francisco Recreation & Parks',
    };
    const addr = tidy(r.address);
    // the dataset ships placeholder addresses on some rows — keep real ones only
    if (addr && !/^(0|n\/?a|none|unknown)$/i.test(addr)) {
      place.address = r.city ? `${addr}, ${tidy(r.city)}` : addr;
    }
    places.push(place);
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count: ${places.length} (0 unless CITY=sf-east-bay — city-gated)`);
      console.log(`with amenities: ${places.filter((p) => p.amenities.length).length}`);
      const byClass = {};
      for (const p of places) for (const c of p.classes) byClass[c] = (byClass[c] || 0) + 1;
      console.log('classes:', JSON.stringify(byClass));
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
