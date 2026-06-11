// Hillsborough County Parks_and_Recreation — 541 authoritative polygons.
// THIN by design (no hours, no booleans, no URLs): use for names + geometry +
// USES free-text; the OSM/Tampa merge supplies amenities. PLACES_SOURCES.md §1 S6.
// Gotcha: ADDR ships with embedded \r\n — stripped via the shared tidy().
import { pathToFileURL } from 'node:url';
import { arcgisQuery, tidy } from './_arcgis.mjs';

export const name = 'Hillsborough County Parks';

const LAYER = 'https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/Parks_and_Recreation/FeatureServer/0';

// USES free-text → normalized amenities (only clear, literal mentions).
const USES_MAP = [
  [/boat ramp/i, 'boat-ramp'],
  [/canoe|kayak/i, 'canoe-launch'],
  [/playground/i, 'playground'],
  [/trail/i, 'trails'],
  [/dog park/i, 'dog-park'],
  [/fishing/i, 'fishing'],
  [/camping/i, 'camping'],
  [/picnic/i, 'picnic'],
  [/pool/i, 'pool'],
  [/tennis/i, 'tennis'],
  [/basketball/i, 'basketball'],
];

export async function fetchPlaces() {
  // Polygons — request centroids, not geometry (hosted layers support it).
  const features = await arcgisQuery(LAYER, {
    returnGeometry: false,
    params: { returnCentroid: 'true' },
  });

  const places = [];
  for (const f of features) {
    const a = f.attributes || {};
    const placeName = tidy(a.NAME);
    const lat = f.centroid?.y;
    const lng = f.centroid?.x;
    if (!placeName || typeof lat !== 'number' || typeof lng !== 'number') continue;
    // The county's facility inventory leaks non-destinations into the parks
    // layer ("Administration" = the downtown admin building, "Maintenance
    // Unit 1", "Church") — these aren't places anyone visits on purpose.
    if (/^(administration|maintenance unit|church|office)\b/i.test(placeName)) continue;

    const uses = tidy(a.USES) || '';
    const amenities = [];
    for (const [re, amenity] of USES_MAP) {
      if (re.test(uses) && !amenities.includes(amenity)) amenities.push(amenity);
    }

    const classes = ['park'];
    if (/\bpreserve\b/i.test(placeName)) classes.push('preserve');
    if (/boat ramp/i.test(uses) || /\bboat ramp\b/i.test(placeName)) classes.push('boat_ramp');
    if (/dog park/i.test(uses)) classes.push('dog_park');

    const place = {
      name: placeName,
      lat,
      lng,
      classes,
      amenities,
      source: name,
      designation: 'County',
    };
    if (tidy(a.ADDR)) place.address = tidy(a.ADDR); // \r\n stripped by tidy
    // PROPMNG/PROPOWNER carry the county's own code for itself.
    if (a.PROPMNG === 'HC' || a.PROPOWNER === 'HC') place.operator = 'Hillsborough County';
    places.push(place);
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count: ${places.length}`);
      console.log(`with USES-derived amenities: ${places.filter((p) => p.amenities.length).length}`);
      const dirty = places.filter((p) => /[\r\n]/.test(p.address || ''));
      console.log(`addresses still carrying CRLF: ${dirty.length} (must be 0)`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
