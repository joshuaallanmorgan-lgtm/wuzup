// GGNRA (Golden Gate National Recreation Area) — EDITORIAL SEED, not a fetch.
//
// GGNRA/NPS exposes NO parks API and the honesty contract forbids scraping
// nps.gov (PHASE_3.7.md §I.5a; image-honesty rules). This module is a small,
// hand-curated list of the famous in-corridor GGNRA units: names + coordinates
// are honest public knowledge; each record links its official nps.gov page
// (a link is not a scrape). Deliberately THIN — no hours, no fabricated
// amenities; the OSM merge enriches what it can.
//
// CITY-GATED: no-ops (returns []) unless the active city is sf-east-bay.
//
// isFree: these units are genuinely free to enter (fee-charging GGNRA units —
// Muir Woods, Alcatraz — are deliberately NOT seeded; see the exclusions note).
import { pathToFileURL } from 'node:url';
import { cityId } from '../cities/index.mjs';

export const name = 'GGNRA (editorial seed)';

// Excluded on purpose:
//  - Muir Woods NM (37.8912, -122.5719) — WEST of the ratified corridor bbox
//    (lngMin -122.53), and a reservation/fee unit besides.
//  - Rodeo Beach / Rodeo Lagoon (37.8317, -122.5368) — barely west of the box
//    edge; the central inBox drop would discard it anyway (kept out to keep
//    this seed honest about what actually ships).
//  - Alcatraz Island — ticketed-ferry attraction, not a free outdoor unit.
const SEED = [
  { name: 'Crissy Field',            lat: 37.8039, lng: -122.4640, classes: ['park', 'beach'],            npsPath: 'crissy-field.htm' },
  { name: 'Lands End',               lat: 37.7799, lng: -122.5115, classes: ['park', 'trail', 'viewpoint'], npsPath: 'lands-end.htm' },
  { name: 'Baker Beach',             lat: 37.7936, lng: -122.4831, classes: ['beach'],                    npsPath: 'baker-beach.htm' },
  { name: 'China Beach',             lat: 37.7883, lng: -122.4909, classes: ['beach'],                    npsPath: 'china-beach.htm' },
  { name: 'Ocean Beach',             lat: 37.7594, lng: -122.5107, classes: ['beach'],                    npsPath: 'ocean-beach.htm' },
  { name: 'Fort Point National Historic Site', lat: 37.8107, lng: -122.4770, classes: ['park', 'viewpoint'], npsPath: 'fort-point.htm' },
  { name: 'Fort Mason',              lat: 37.8060, lng: -122.4270, classes: ['park'],                     npsPath: 'fort-mason.htm' },
  { name: 'Sutro Heights Park',      lat: 37.7787, lng: -122.5121, classes: ['park', 'viewpoint'],        npsPath: 'sutro-heights.htm' },
  { name: 'Marin Headlands',         lat: 37.8262, lng: -122.4993, classes: ['park', 'trail', 'viewpoint'], npsPath: 'marin-headlands.htm' },
  { name: 'Hawk Hill',               lat: 37.8255, lng: -122.4997, classes: ['viewpoint'],                npsPath: 'hawk-hill.htm' },
];

export async function fetchPlaces() {
  if (cityId !== 'sf-east-bay') return []; // city gate — see header
  return SEED.map(({ name: unitName, lat, lng, classes, npsPath }) => ({
    name: unitName,
    lat,
    lng,
    classes,
    amenities: [],
    source: name,
    designation: 'National Recreation Area',
    operator: 'National Park Service',
    url: `https://www.nps.gov/goga/planyourvisit/${npsPath}`,
    isFree: true,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces().then((places) => {
    console.log(`count: ${places.length} (0 unless CITY=sf-east-bay — city-gated)`);
    const inBox = places.filter((p) => p.lat >= 37.68 && p.lat <= 38.00 && p.lng >= -122.53 && p.lng <= -122.00);
    console.log(`inside the ratified corridor bbox: ${inBox.length} (must equal count — the seed keeps out-of-box units excluded by hand)`);
    for (const p of places.slice(0, 2)) console.log(JSON.stringify(p));
  });
}
