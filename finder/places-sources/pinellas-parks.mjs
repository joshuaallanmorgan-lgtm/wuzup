// Pinellas County Park Points — the single best places source found by R1.
// One layer covers the county AND all 23 municipalities (St Pete 125,
// Clearwater 72, Dunedin 26…): 418 points with hours, official URLs, and
// ~30 amenity booleans. PLACES_SOURCES.md §1 S1.
import { pathToFileURL } from 'node:url';
import { arcgisQuery, amenitiesFrom, ynBool, tidy } from './_arcgis.mjs';

export const name = 'Pinellas Park Points';

const LAYER = 'https://services.arcgis.com/f5HgUpxURgEzTccH/arcgis/rest/services/Pinellas_Park_Points/FeatureServer/0';

// Verified field list (probed 2026-06-11) → normalized amenity vocabulary.
const AMENITY_FIELDS = {
  RESTROOM: 'restrooms',
  ADACOMPLY: 'ada',
  CAMPING: 'camping',
  SWIMMING: 'swimming',
  HIKING: 'hiking',
  FISHING: 'fishing',
  PICNIC: 'picnic',
  BOATING: 'boating',
  ROADCYCLE: 'biking',
  MTBCYCLE: 'mountain-biking',
  PLAYGROUND: 'playground',
  GOLF: 'golf',
  SOCCER: 'soccer',
  BASEBALL: 'baseball',
  BASKETBALL: 'basketball',
  TENNISCOURTS: 'tennis',
  RACQUETBALL: 'racquetball',
  VOLLEYBALL: 'volleyball',
  SKATEPARKAREA: 'skate-park',
  OUTDOORFITNESSAREA: 'fitness',
  RECREATIONCENTER: 'recreation-center',
  RENTALS: 'rentals',
  DOGPARKAREA: 'dog-park',
  DISCGOLF: 'disc-golf',
  HORSETRAIL: 'equestrian',
  SHUFFLEBOARD: 'shuffleboard',
};

export async function fetchPlaces() {
  const features = await arcgisQuery(LAYER);
  const places = [];
  for (const f of features) {
    const a = f.attributes || {};
    const placeName = tidy(a.NAME); // trailing spaces observed ("North Shore Park ")
    const lat = f.geometry?.y;
    const lng = f.geometry?.x;
    if (!placeName || typeof lat !== 'number' || typeof lng !== 'number') continue;

    const amenities = amenitiesFrom(a, AMENITY_FIELDS);
    const classes = ['park'];
    if (/beach/i.test(a.PARK_TYPE || '')) classes.push('beach');
    if (/preserve/i.test(a.PARK_TYPE || '') || /\bpreserve\b/i.test(placeName)) classes.push('preserve');
    if (ynBool(a.DOGPARKAREA) === true) classes.push('dog_park');
    if (ynBool(a.PLAYGROUND) === true) classes.push('playground');

    const place = { name: placeName, lat, lng, classes, amenities, source: name };
    if (tidy(a.FULLADDR)) place.address = tidy(a.FULLADDR);
    const hours = [tidy(a.OPERDAYS), tidy(a.OPERHOURS)].filter(Boolean).join(' ');
    if (hours) place.hours = hours;
    if (tidy(a.PARKURL)) place.url = tidy(a.PARKURL);
    const designation = tidy(a.DESIGNATION); // City | County | State
    if (designation) place.designation = designation;
    // Operator is a sourced composition: DESIGNATION + MUNICIPALTY fields.
    if (designation === 'County') place.operator = 'Pinellas County';
    else if (designation === 'City' && tidy(a.MUNICIPALTY)) place.operator = tidy(a.MUNICIPALTY);
    places.push(place);
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count: ${places.length}`);
      console.log(`with hours: ${places.filter((p) => p.hours).length}`);
      console.log(`with amenities: ${places.filter((p) => p.amenities.length).length}`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
