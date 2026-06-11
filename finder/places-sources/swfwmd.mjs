// SWFWMD RecreationGuide — the water-management-district preserve class
// (Brooker Creek Headwaters-type lands the "nature paths" bubble wants).
// PLACES_SOURCES.md §1 S7.
//
// ENDPOINT PROVENANCE (important): these services are NOT on the SWFWMD open-
// data hub. They were extracted from the Recreation Map Viewer web map (item
// ce92eb0ed43f4c8590c143cbb4c2ad29) by the R1 scout. If they drift, re-extract
// from that web map's operational layers.
//
// Layer shapes (probed 2026-06-11):
//   /0 "Recreational Lands Gate Locations" — per-area entrance POINTS that
//      also carry ~30 amenity Yes/No booleans + FULLADDR + MAPURL. The
//      RECREATIONAREA field names the property.
//   /3 "Amenities" — typed amenity points joined to properties via
//      PROJECTNAME (the cross-layer join the spec calls for).
import { pathToFileURL } from 'node:url';
import { arcgisQuery, amenitiesFrom, tidy } from './_arcgis.mjs';

export const name = 'SWFWMD Recreation';

const BASE = 'https://services1.arcgis.com/gdr0FcZCwx1BmrQk/arcgis/rest/services/RecreationGuide/FeatureServer';

// Gate-layer booleans (verified) → normalized vocabulary.
const GATE_AMENITY_FIELDS = {
  BIRDING: 'birding',
  DOGSALLOWED: 'dogs-allowed',
  HIKING: 'hiking',
  BICYCLING: 'biking',
  EQUESTRIAN: 'equestrian',
  BOATING: 'boating',
  PADDLING: 'paddling',
  FISHING: 'fishing',
  ADAACCESSIBLE: 'ada',
  PICNICFACILITIES: 'picnic',
  RESTROOMS: 'restrooms',
  RVCAMPING: 'camping',
  GROUPCAMPING: 'camping',
  PRIMITIVECAMPING: 'camping',
  BACKCOUNTRYCAMPING: 'camping',
  TRAILS: 'trails',
  PLAYGROUND: 'playground',
  BBQGRILLS: 'grills',
  DISCGOLF: 'disc-golf',
  SANDVOLLEYBALLPIT: 'volleyball',
  BOARDWALK: 'boardwalk',
  CANOERENTALS: 'rentals',
  SHOWERS: 'showers',
  SWIMMING: 'swimming',
  SNORKELING: 'snorkeling',
};

// /3 Amenities TYPE free-text → normalized vocabulary (clear matches only).
const TYPE_MAP = [
  [/picnic/i, 'picnic'],
  [/restroom/i, 'restrooms'],
  [/camp/i, 'camping'],
  [/canoe|kayak|paddl/i, 'canoe-launch'],
  [/boat/i, 'boat-ramp'],
  [/fishing/i, 'fishing'],
  [/playground/i, 'playground'],
  [/trail/i, 'trails'],
  [/observation|tower|overlook/i, 'viewpoint-deck'],
];

export async function fetchPlaces() {
  const gates = await arcgisQuery(`${BASE}/0`);
  const amenityPts = await arcgisQuery(`${BASE}/3`, { returnGeometry: false });

  // PROJECTNAME (layer 3) → normalized amenity names, for the cross-layer join.
  const joinAmenities = new Map();
  for (const f of amenityPts) {
    const a = f.attributes || {};
    if (!/active/i.test(a.STATUS || '')) continue;
    const project = tidy(a.PROJECTNAME);
    const type = tidy(a.TYPE) || '';
    if (!project) continue;
    for (const [re, amenity] of TYPE_MAP) {
      if (re.test(type)) {
        if (!joinAmenities.has(project)) joinAmenities.set(project, new Set());
        joinAmenities.get(project).add(amenity);
        break;
      }
    }
  }

  // One place per recreation area: gates grouped by RECREATIONAREA (falling
  // back to NAME), amenity booleans unioned across that area's gates.
  const byArea = new Map();
  for (const f of gates) {
    const a = f.attributes || {};
    const area = tidy(a.RECREATIONAREA) || tidy(a.NAME);
    const lat = f.geometry?.y;
    const lng = f.geometry?.x;
    if (!area || typeof lat !== 'number' || typeof lng !== 'number') continue;
    let rec = byArea.get(area);
    if (!rec) {
      rec = {
        name: area,
        lat,
        lng,
        classes: ['preserve'],
        amenities: new Set(),
        source: name,
        designation: 'Water-Mgmt',
        operator: 'Southwest Florida Water Management District',
      };
      if (tidy(a.FULLADDR)) rec.address = tidy(a.FULLADDR);
      if (tidy(a.MAPURL)) rec.url = tidy(a.MAPURL);
      byArea.set(area, rec);
    }
    for (const am of amenitiesFrom(a, GATE_AMENITY_FIELDS)) rec.amenities.add(am);
  }

  // Join layer-3 amenity points by PROJECTNAME ↔ area name.
  for (const [project, set] of joinAmenities) {
    const rec = byArea.get(project);
    if (rec) for (const am of set) rec.amenities.add(am);
  }

  return [...byArea.values()].map((rec) => ({ ...rec, amenities: [...rec.amenities] }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count: ${places.length}`);
      console.log(`with amenities: ${places.filter((p) => p.amenities.length).length}`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
