// Shared ArcGIS REST query helper for the places sources.
// Five of the seven modules are the same call shape: a FeatureServer/MapServer
// layer queried with f=json, paged with resultOffset, coerced Yes/No booleans.
// "_"-prefixed files are skipped by the places loader (same convention as
// finder/sources/_shared.mjs).
//
// Hard rules learned by the R1 scouts (PLACES_SOURCES.md §1):
// - outSR=4326 ALWAYS — Pinellas returns Web Mercator by default.
// - Government self-hosted servers (tampagov.net, ca.dep.state.fl.us,
//   gis.myfwc.com) are SLOW — every source can override the timeout.
// - If an endpoint ever moves, the Hub discovery API re-finds it fast:
//   {hub}/api/search/v1/collections/dataset/items?q=

export const DEFAULT_TIMEOUT_MS = 30000;

// Plain fetch + AbortController, mirroring finder/sources/_shared.mjs.
async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Query an ArcGIS layer, following resultOffset paging until the server stops
// reporting exceededTransferLimit. Returns the full features array.
// `params` lets a source add spatial-filter params (the FWC envelope query).
export async function arcgisQuery(layerUrl, {
  where = '1=1',
  outFields = '*',
  returnGeometry = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  params = {},
} = {}) {
  const features = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) { // hard page cap — no source is near this
    const qs = new URLSearchParams({
      where,
      outFields,
      outSR: '4326', // MANDATORY — default geometry is Web Mercator on some servers
      returnGeometry: String(returnGeometry),
      resultOffset: String(offset),
      f: 'json',
      ...params,
    });
    const data = await fetchJson(`${layerUrl}/query?${qs}`, timeoutMs);
    if (data.error) throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
    const batch = Array.isArray(data.features) ? data.features : [];
    features.push(...batch);
    offset += batch.length;
    if (!batch.length || !data.exceededTransferLimit) break;
  }
  return features;
}

// 'Yes'/'No' string booleans (Pinellas/Tampa/SWFWMD/FWC all use them) →
// true/false/null. Anything that isn't a clear yes/no stays null (unknown).
export function ynBool(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'yes' || s === 'y') return true;
  if (s === 'no' || s === 'n') return false;
  return null;
}

// Build amenities[] from a record using a FIELD → normalized-vocabulary map.
// Only Yes booleans emit; No/null/missing emit nothing (omit, never fabricate).
export function amenitiesFrom(attrs, fieldMap) {
  const out = [];
  for (const [field, amenity] of Object.entries(fieldMap)) {
    if (ynBool(attrs[field]) === true && !out.includes(amenity)) out.push(amenity);
  }
  return out;
}

// Collapse whitespace + trim — gov data ships trailing spaces ("North Shore
// Park ") and Hillsborough embeds \r\n inside ADDR. FWC ships CSV-style
// doubled quotes (H.S. ""Pop"" Stansell) — collapsed to one.
export function tidy(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\r\n]+/g, ' ').replace(/"{2,}/g, '"').replace(/\s+/g, ' ').trim();
  return t || null;
}
