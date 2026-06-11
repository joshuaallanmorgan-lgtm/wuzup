// FWC Florida Boat Ramp Inventory — the water-access class, solved.
// Envelope query (inSR=4326) over the Tampa Bay box: ~275 ramps with typed
// fee fields (isFeeRequired/FeeAmount), Hours, RestroomType, plain
// Latitude/Longitude attribute fields. PLACES_SOURCES.md §1 S5.
import { pathToFileURL } from 'node:url';
import { arcgisQuery, ynBool, tidy } from './_arcgis.mjs';

export const name = 'FWC Boat Ramps';

const LAYER = 'https://gis.myfwc.com/mapping/rest/services/Open_Data/FWC_Florida_Boat_Ramp_Inventory/MapServer/4';
const TIMEOUT_MS = 60000; // state self-hosted server

// Same box as finder.mjs TB_BOX, expressed as an ArcGIS envelope.
const ENVELOPE = JSON.stringify({ xmin: -83.3, ymin: 27.3, xmax: -81.9, ymax: 28.6 });

export async function fetchPlaces() {
  const features = await arcgisQuery(LAYER, {
    timeoutMs: TIMEOUT_MS,
    params: {
      geometry: ENVELOPE,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
    },
  });

  const places = [];
  for (const f of features) {
    const a = f.attributes || {};
    const placeName = tidy(a.RampName);
    // Plain attribute fields are the verified coordinate source here.
    const lat = typeof a.Latitude === 'number' ? a.Latitude : f.geometry?.y;
    const lng = typeof a.Longitude === 'number' ? a.Longitude : f.geometry?.x;
    if (!placeName || typeof lat !== 'number' || typeof lng !== 'number') continue;
    // A non-open ramp shipped as a destination is a stale lie. WHITELIST, not
    // blacklist: live Status values include 'Destroyed' and 'Undetermined',
    // which a /closed/ test would wave through ('Open for Business' is the
    // sole open value).
    if (!/open/i.test(a.Status || '')) continue;
    // Military/base-access facilities are not public destinations.
    if (/military|air force|\bafb\b|base access/i.test(`${a.RampName || ''} ${a.PrimaryAdminEntity || ''}`)) continue;

    const amenities = ['boat-ramp'];
    // WHITELISTS — live values include 'Unknown' and bare 'No', which the old
    // blacklists waved through. Claim an amenity only when the source states
    // it exists; omit, never infer (the no-fake-data contract, literally).
    if (/flush|portable|composting/i.test(a.RestroomType || '')) amenities.push('restrooms');
    if (/^(high|moderate|yes)/i.test(a.AccessibilityLevel || '')) amenities.push('ada');

    const place = {
      name: placeName,
      lat,
      lng,
      classes: ['boat_ramp'],
      amenities,
      source: name,
    };
    const addr = [tidy(a.Street1), tidy(a.City)].filter(Boolean).join(', ');
    if (addr) place.address = addr;
    // Placeholder junk observed live: Hours "Unknown", ContactPhone "NA" —
    // omit them rather than ship non-facts.
    const JUNK = /^(unknown|n\/?a|none|tbd)$/i;
    const hours = tidy(a.Hours);
    if (hours && !JUNK.test(hours)) place.hours = hours;
    if (tidy(a.URL)) place.url = tidy(a.URL);
    const phone = tidy(a.ContactPhone);
    if (phone && !JUNK.test(phone)) place.phone = phone;
    // Typed fee fields — richer than a bare isFree.
    const feeRequired = ynBool(a.isFeeRequired);
    if (feeRequired === false) place.isFree = true;
    else if (feeRequired === true) {
      place.isFree = false;
      if (typeof a.FeeAmount === 'number' && a.FeeAmount > 0) place.fee = `${a.FeeAmount} USD`;
    }
    const operator = tidy(a.PrimaryAdminEntity);
    if (operator) place.operator = operator;
    places.push(place);
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPlaces()
    .then((places) => {
      console.log(`count: ${places.length}`);
      console.log(`fee-flagged: ${places.filter((p) => p.isFree === false).length}`);
      console.log(`with hours: ${places.filter((p) => p.hours).length}`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
