// City of Tampa — Park and Recreation Areas (MapServer/9). The richest amenity
// schema of any source (~45 booleans incl. BEACH, DOGBEACH, DOGPARK, BOATRAMP,
// CANOELAUNCH, PIER, MARINA, SPLASHPAD, PICKLECOURT…) and the ONLY editorial-
// description source (DESCRIPT). PLACES_SOURCES.md §1 S3.
//
// Gotcha (measured by the R1 scout): the server is SLOW — a count query needed
// 60s. Timeout is overridden to 90s; the orchestrator caches hard.
import { pathToFileURL } from 'node:url';
import { cleanText } from '../sources/_shared.mjs';
import { arcgisQuery, amenitiesFrom, ynBool, tidy } from './_arcgis.mjs';

export const name = 'Tampa Parks';

const LAYER = 'https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Location/MapServer/9';
const TIMEOUT_MS = 90000; // ≥60s required — measured-slow self-hosted server

// Verified field list (probed 2026-06-11) → normalized amenity vocabulary.
const AMENITY_FIELDS = {
  RESTROOMS: 'restrooms',
  BALLFIELDS: 'baseball',
  BEACH: 'beach',
  BOATRAMP: 'boat-ramp',
  CANOELAUNCH: 'canoe-launch',
  COMMUNITYCENTER: 'community-center',
  CONCESSION: 'concessions',
  DOGPARK: 'dog-park',
  DOGBEACH: 'dog-beach',
  FITNESSFACILITY: 'fitness',
  OUTDOORFITNESS: 'fitness',
  GOLF: 'golf',
  GRILLS: 'grills',
  GYM: 'gym',
  PIER: 'pier',
  SHUFFLECOURTS: 'shuffleboard',
  PLAYGROUND: 'playground',
  POOL: 'pool',
  SHELTERS: 'shelters',
  TENNIS: 'tennis',
  IMPROVEDTRAILS: 'trails',
  BASKETCOURTS: 'basketball',
  RACQUETCOURTS: 'racquetball',
  NATURALTRAILS: 'nature-trails',
  DISCGOLF: 'disc-golf',
  SKATEPARK: 'skate-park',
  SPLASHPAD: 'splash-pad',
  SANDCOURTS: 'volleyball',
  VOLLEYCOURT: 'volleyball',
  BANDSHELL: 'bandshell',
  MARINA: 'marina',
  AUTISMFRIEND: 'autism-friendly',
  PICKLECOURT: 'pickleball',
  FISHING: 'fishing',
};

export async function fetchPlaces() {
  const features = await arcgisQuery(LAYER, { timeoutMs: TIMEOUT_MS });
  const places = [];
  for (const f of features) {
    const a = f.attributes || {};
    const placeName = tidy(a.NAME);
    const lat = f.geometry?.y;
    const lng = f.geometry?.x;
    if (!placeName || typeof lat !== 'number' || typeof lng !== 'number') continue;
    // Cemeteries aren't weekend destinations; closed parks aren't honest listings.
    if (/cemetery/i.test(a.FEATURECODE || '')) continue;
    if (/closed/i.test(a.PARKSTATUS || '')) continue;

    const amenities = amenitiesFrom(a, AMENITY_FIELDS);
    const classes = ['park'];
    if (ynBool(a.BEACH) === true || ynBool(a.DOGBEACH) === true || /beach/i.test(a.FEATURECODE || '')) classes.push('beach');
    if (ynBool(a.DOGPARK) === true || ynBool(a.DOGBEACH) === true) classes.push('dog_park');
    if (ynBool(a.PIER) === true) classes.push('pier');
    if (ynBool(a.BOATRAMP) === true) classes.push('boat_ramp');
    if (ynBool(a.PLAYGROUND) === true) classes.push('playground');
    if (/\bpreserve\b/i.test(placeName)) classes.push('preserve');

    const place = {
      name: placeName,
      lat,
      lng,
      classes,
      amenities,
      source: name,
      designation: 'City',
    };
    // Operator only when the OWNER field actually says so — never assumed.
    if (/tampa/i.test(a.OWNER || '')) place.operator = 'City of Tampa';
    const addr = [tidy(a.FULLADDR), tidy(a.CITY)].filter(Boolean).join(', ');
    if (addr) place.address = addr;
    // DESCRIPT carries real editorial blurbs — cleaned with the shared helper.
    // 59 records ship the same department motto ("Achievement, future,
    // community… it starts in Parks!") in DESCRIPT — boilerplate presented as
    // editorial reads as fabricated content; drop it, keep only real blurbs.
    const desc = cleanText(a.DESCRIPT);
    if (desc && !/^achievement, future, community/i.test(desc)) place.description = desc;
    const hours = [tidy(a.OPERDAYS), tidy(a.OPERHOURS)].filter(Boolean).join(' ');
    // 'Temporarily Closed N/A'-grade values are status junk, not hours.
    if (hours && !/n\/?a|closed/i.test(hours)) place.hours = hours;
    if (tidy(a.PARKURL)) place.url = tidy(a.PARKURL);
    if (tidy(a.PHONE)) place.phone = tidy(a.PHONE);
    places.push(place);
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count: ${places.length}`);
      console.log(`with description: ${places.filter((p) => p.description).length}`);
      console.log(`with hours: ${places.filter((p) => p.hours).length}`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
