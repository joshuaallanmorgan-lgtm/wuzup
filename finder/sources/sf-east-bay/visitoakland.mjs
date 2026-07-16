// Visit Oakland (Simpleview DMO) event source — the East Bay anchor.
// Port of visittampabay.mjs per STAGE_D_SF_EVENTS.md row 3: same two-step
// flow (per-session token, then the events_by_date REST plugin), new
// timezone + a live category-sense pass.
//
// THE MIDNIGHT-PT GOTCHA (scout-verified; the API literally errors with
// "00:00 in the client's timezone"): date_range boundaries MUST be midnight
// Pacific — the same rule class as VTB's midnight-ET, driven here by the
// city config tz, not a hardcoded zone. And the same honesty rule downstream:
// a midnight/absent startTime means DATE-ONLY — never invent a time
// (combineDayTime returns the bare day when startTime is missing).
//
// Live-verified 2026-07-05: token 32 chars via get_simple_token; count=70
// docs across 14 days; response nests docs.docs; docs carry title, date
// (encoded 23:59:59 PACIFIC of the event's local day), startTime/endTime,
// recurType, location, address1/city/state/zip, latitude/longitude (plus
// GeoJSON loc.coordinates in lng,lat order as fallback), absoluteUrl,
// media_raw, description, admission (bare numbers like "100" AND "Free"),
// categories[].catName.
import {
  cleanText,
  decodeEntities,
  fetchWithTimeout,
  midnightInTz,
  sourceStartDay,
  sourceWallTime,
  sourceWindow,
} from '../_shared.mjs';
// D2 seam: Pacific comes from the city config, never a module literal.
import { tz as CITY_TZ } from '../../cities/sf-east-bay.mjs';

export const name = 'Visit Oakland';

const BASE = 'https://www.visitoakland.com';
const UA = 'wuzup-events-finder/0.1';
const DAYS_AHEAD = 45;
const PAGE_LIMIT = 50; // keep responses under the API's result-set cap (categories field adds bulk)
const MAX_PAGES = 10;

function voFetch(url, fetchImpl) {
  return fetchWithTimeout(url, { headers: { 'user-agent': UA } }, undefined, fetchImpl);
}

// Native Simpleview catName -> our category vocabulary, RESAMPLED on Visit
// Oakland live data 2026-07-05 (iteration order IS priority — first hit wins).
// Observed vocabulary (50-doc sample): FREE 12 · Family 11 · Love our Lake 10 ·
// Food & Drink 8 · Sports 7 · Museum & Gallery Exhibits 7 · Comedy & Trivia 6 ·
// Live Concerts & Performances 5 · Wellness 4 · Festival 3 · Markets 2 ·
// Tours 2 · Cannabis 2 · Nightlife 1.
// Sense decisions:
// - 'Comedy & Trivia' bundles trivia nights with stand-up: trust it for
//   comedy ONLY when the listing's own words sound like comedy (the VTB
//   comedy-guard pattern); otherwise fall through (trivia lands nightlife
//   via the pipeline's text rules).
// - 'FREE' is an admission signal, not a category (handled in mapDoc).
// - 'Love our Lake' (Lake Merritt programming), 'Festival', 'Tours',
//   'Cannabis' carry no stable categorical sense — left unmapped for the
//   pipeline text classifier.
const CATNAME_MAP = new Map([
  ['Comedy & Trivia', 'comedy'],
  ['Live Concerts & Performances', 'music'],
  ['Museum & Gallery Exhibits', 'art'],
  ['Sports', 'sports'],
  ['Markets', 'market'],
  ['Food & Drink', 'food'],
  ['Nightlife', 'nightlife'],
  ['Wellness', 'community'],
  ['Family', 'family'],
]);

function mapCategory(categories, text = '') {
  if (!Array.isArray(categories)) return null;
  const present = new Set(
    categories.map((c) => (c && typeof c.catName === 'string' ? c.catName.trim() : '')).filter(Boolean)
  );
  for (const [catName, category] of CATNAME_MAP) {
    if (!present.has(catName)) continue;
    // The comedy guard (see the sense decisions above).
    if (category === 'comedy' && !/\bcomed|\bstand-?up\b|\bimprov\b|\bfunny\b|\bjokes?\b/i.test(text)) continue;
    return category;
  }
  return null;
}

// 'FREE' catName = the DMO's own free-admission flag.
function hasFreeCat(categories) {
  return Array.isArray(categories) &&
    categories.some((c) => c && typeof c.catName === 'string' && c.catName.trim() === 'FREE');
}

// 'YYYY-MM-DD' for a Date instant, evaluated on the city's wall clock.
// Combine a city calendar day with an 'HH:MM:SS' local time into an ISO
// string. NO timeStr → the bare day (date-only stays date-only — the
// midnight gotcha's honesty half).
function combineDayTime(dayStr, timeStr) {
  if (!timeStr) return dayStr;
  return sourceWallTime(CITY_TZ, dayStr, timeStr);
}

function parseAdmission(admission) {
  if (!admission || typeof admission !== 'string') return { price: null, isFree: null };
  const text = decodeEntities(admission).trim();
  if (/^free\b[!.]?$/i.test(text)) return { price: 0, isFree: true };
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(text);
  if (m) {
    const price = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(price)) return { price, isFree: price === 0 };
  }
  // Visit Oakland publishes bare numeric admissions ("100") — a price with
  // the dollar sign left off (live-verified against the event pages).
  if (/^[\d,]+(?:\.\d{1,2})?$/.test(text)) {
    const price = parseFloat(text.replace(/,/g, ''));
    if (Number.isFinite(price)) return { price, isFree: price === 0 };
  }
  if (/\bfree\b/i.test(text)) return { price: 0, isFree: true };
  return { price: null, isFree: null };
}

async function getToken(fetchImpl) {
  const res = await voFetch(`${BASE}/plugins/core/get_simple_token/`, fetchImpl);
  if (!res.ok) throw new Error(`Visit Oakland token request failed: HTTP ${res.status}`);
  const token = (await res.text()).trim();
  if (!token || token.length > 200 || /[<>\s]/.test(token)) {
    throw new Error(`Visit Oakland token response not recognized: ${token.slice(0, 80)}`);
  }
  return token;
}

async function fetchPage(token, startISO, endISO, skip, fetchImpl) {
  const query = {
    filter: {
      active: true,
      date_range: { start: { $date: startISO }, end: { $date: endISO } },
    },
    options: {
      limit: PAGE_LIMIT,
      skip,
      count: true,
      fields: {
        title: 1, date: 1, nextDate: 1, startDate: 1, endDate: 1,
        startTime: 1, endTime: 1, recurType: 1,
        location: 1, address1: 1, city: 1, state: 1, zip: 1,
        latitude: 1, longitude: 1, loc: 1, absoluteUrl: 1, media_raw: 1,
        description: 1, admission: 1, categories: 1,
      },
    },
  };
  const url = `${BASE}/includes/rest_v2/plugins_events_events_by_date/find/` +
    `?json=${encodeURIComponent(JSON.stringify(query))}&token=${encodeURIComponent(token)}`;
  const res = await voFetch(url, fetchImpl);
  if (!res.ok) {
    throw new Error(`Visit Oakland events request failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  const docs = body?.docs?.docs;
  if (!Array.isArray(docs)) {
    throw new Error('Visit Oakland response missing docs.docs array');
  }
  return { docs, count: body.docs.count ?? docs.length };
}

function mapDoc(doc, todayDay, lastDay) {
  const title = cleanText(doc.title, 300);
  if (!title) return null;

  // `date` is the next occurrence inside the queried range, encoded as
  // 23:59:59 PACIFIC of the event's local day (live-verified:
  // 2026-07-12T06:59:59Z => July 11 local) — same convention as VTB's ET.
  const occurrence = doc.date || doc.nextDate || doc.startDate;
  if (!occurrence) return null;
  const day = sourceStartDay(CITY_TZ, occurrence);
  if (!day) return null;
  if (day < todayDay || day > lastDay) return null;

  const start = combineDayTime(day, doc.startTime);
  if (!start) return null;

  // endDate on recurring events is the series end, not the occurrence end.
  let end = null;
  if (doc.recurType === 0 && doc.endDate) {
    const endDay = sourceStartDay(CITY_TZ, doc.endDate);
    if (endDay && endDay >= day) {
      const candidate = doc.endTime
        ? sourceWallTime(CITY_TZ, endDay, doc.endTime, { disambiguation: 'later' })
        : endDay;
      if (candidate && candidate !== start) end = candidate;
    }
  }

  const addressParts = [doc.address1, doc.city, doc.state, doc.zip]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const { price, isFree } = parseAdmission(doc.admission);
  let lat = typeof doc.latitude === 'number' ? doc.latitude : null;
  let lng = typeof doc.longitude === 'number' ? doc.longitude : null;
  // GeoJSON fallback: loc.coordinates is [lng, lat] — wire order matters.
  if ((lat == null || lng == null) && Array.isArray(doc.loc?.coordinates) && doc.loc.coordinates.length === 2) {
    const [gLng, gLat] = doc.loc.coordinates;
    if (typeof gLat === 'number' && typeof gLng === 'number') { lat = gLat; lng = gLng; }
  }
  const image = Array.isArray(doc.media_raw)
    ? (doc.media_raw.find((m) => m && m.mediaurl)?.mediaurl ?? null)
    : null;

  const event = {
    title,
    start,
    end,
    venue: cleanText(doc.location, 200),
    address: addressParts.length ? addressParts.join(', ') : null,
    price,
    isFree: isFree === null && hasFreeCat(doc.categories) ? true : isFree,
    lat,
    lng,
    url: typeof doc.absoluteUrl === 'string' && doc.absoluteUrl ? doc.absoluteUrl : null,
    image,
    description: cleanText(doc.description),
    source: name,
  };
  if (event.isFree === true && event.price === null) event.price = 0;
  const category = mapCategory(doc.categories, `${event.title || ''} ${event.description || ''}`);
  if (category) event.category = category;
  return event;
}

export async function fetchEvents(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const { today: todayDay, lastDay } = sourceWindow(CITY_TZ, nowMs, DAYS_AHEAD);
  // Midnight-PACIFIC boundaries (the gotcha): derived from the city tz.
  const startISO = midnightInTz(CITY_TZ, todayDay).toISOString();
  const endISO = midnightInTz(CITY_TZ, lastDay).toISOString();

  const token = await getToken(fetchImpl);

  const allDocs = [];
  let expected = Infinity;
  for (let page = 0; page < MAX_PAGES && allDocs.length < expected; page++) {
    const { docs, count } = await fetchPage(token, startISO, endISO, page * PAGE_LIMIT, fetchImpl);
    expected = count;
    allDocs.push(...docs);
    if (docs.length < PAGE_LIMIT) break;
  }
  if (allDocs.length < expected) {
    console.warn(`Visit Oakland: fetched ${allDocs.length} of ${expected} docs (page cap reached)`);
  }

  const events = [];
  for (const doc of allDocs) {
    try {
      const event = mapDoc(doc, todayDay, lastDay);
      if (event) events.push(event);
    } catch (err) {
      console.warn(`Visit Oakland: skipping doc ${doc?.recid ?? '?'}: ${err.message}`);
    }
  }
  return events;
}

// CLI runner: node finder/sources/sf-east-bay/visitoakland.mjs
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await fetchEvents();
  console.log(`count: ${events.length}`);
  console.log(`categorized: ${events.filter((e) => e.category).length}`);
  console.log(`date-only starts: ${events.filter((e) => !/T/.test(e.start)).length}`);
  for (const sample of events.slice(0, 3)) {
    console.log(JSON.stringify(sample));
  }
}
