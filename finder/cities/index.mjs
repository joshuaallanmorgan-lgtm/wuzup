// finder/cities/index.mjs — active-city selector.
//
// Reads the CITY env var (default 'tampa-bay'). Every Tampa-specific pipeline constant
// flows from the active city module, so the finder is runnable for any city by adding
// a module here + setting CITY=<id>. The active city's place/event SOURCE modules are
// a separate concern (out of scope for the imagery lock).
import * as tampaBay from './tampa-bay.mjs';
import * as sfEastBay from './sf-east-bay.mjs';

const CITIES = {
  'tampa-bay': tampaBay,
  // Stage D3: registered but NOT runnable until D1 (multi-tenant artifacts) +
  // D2 (events de-Tampa) land — running the pipeline with CITY=sf-east-bay
  // today would OVERWRITE Tampa's outputs (see finder/cities/sf-east-bay.mjs
  // header + STAGE_D.md D1).
  'sf-east-bay': sfEastBay,
};

const id = process.env.CITY || 'tampa-bay';
const mod = CITIES[id];
if (!mod) {
  throw new Error(`Unknown CITY '${id}' — known cities: ${Object.keys(CITIES).join(', ')}`);
}

export const cityId = id;
export const {
  tz, bbox, bboxOverpass, bboxArcgisEnvelope, geocodeViewbox, geocode,
  govOrder, touristCentroids, area, qidDeny, cafe, imagery, rosterBenchmark, meta,
} = mod;
