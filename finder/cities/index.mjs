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
  // Stage D3: registered. D1 (multi-tenant artifacts) LANDED — a
  // CITY=sf-east-bay run writes ONLY finder/{output,cache}/sf-east-bay/ and
  // cannot touch Tampa's artifacts or the deployment (app/public changes only
  // via finder/deploy.mjs, which refuses an artifact-less city). The EVENTS
  // pipeline stays D2-gated: this config has no `tz`/`geocode` wiring yet, so
  // an events run fails closed at module load (see sf-east-bay.mjs header).
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
