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
  // pipeline stays GATED by missing INPUTS (no sf source modules; sources.json/
  // venues.json are Tampa's) — the tz/geocode seams ARE wired (sf-east-bay.mjs).
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
  govOrder, touristCentroids, area, qidDeny, imageRejects, cafe, imagery, rosterBenchmark, meta,
  eventSourceModules, placeSourceModules,
} = mod;
// Optional per-city categorization priors (venuePriors + sourceCategory —
// see sf-east-bay.mjs). A city without the export (Tampa: its priors still
// live as finder.mjs literals) gets empty defaults — behavior unchanged.
export const priors = {
  venuePriors: [],
  sourceCategory: {},
  ...(mod.priors || {}),
};
