// Visit Tampa Bay (Simpleview DMO) event source.
// Two-step flow: fetch a per-session token, then query the events_by_date REST plugin.
// Date range boundaries MUST be midnight Eastern Time (the API errors otherwise).
import { decodeEntities, cleanText, fetchWithTimeout } from './_shared.mjs';

export const name = 'Visit Tampa Bay';

const BASE = 'https://www.visittampabay.com';
const UA = 'tampabay-events-finder/0.1';
const DAYS_AHEAD = 45;
const PAGE_LIMIT = 50; // keep responses under the API's ~200KB result-set cap (categories field adds bulk)
const MAX_PAGES = 10;
const TZ = 'America/New_York';

function vtbFetch(url) {
  return fetchWithTimeout(url, { headers: { 'user-agent': UA } });
}

// Native Simpleview catName -> our category vocabulary.
// Iteration order IS priority: first hit wins for multi-category events, so
// specific signals (comedy/theatre/music) beat the broad "Family Friendly".
// Sense decisions from live data sampling (2026-06):
// - "Dining & Nightlife" titles are mostly dinners/high teas/food trucks -> food
// - "Brewery Event" is drinks-first -> nightlife (and outranks Dining & Nightlife)
// - "Classes & Workshops" titles are mostly paint-and-sip / canvas classes -> art
// Unmapped on purpose (no categorical sense): Free Event, Holiday, Fun/Adventure.
const CATNAME_MAP = new Map([
  ['Comedy', 'comedy'],
  ['Theatre/Performing Arts', 'theatre'],
  ['Concerts', 'music'],
  ['Sports and Recreation', 'sports'],
  ['Festivals, Expos & Fairs', 'market'],
  ['Arts & Culture Events', 'art'],
  ['Classes & Workshops', 'art'],
  ['Brewery Event', 'nightlife'],
  ['Dining & Nightlife', 'food'],
  ['Shopping', 'market'],
  ['Health & Wellness', 'community'],
  ['Fundraising', 'community'],
  ['Family Friendly', 'family'],
]);

function mapCategory(categories) {
  if (!Array.isArray(categories)) return null;
  const present = new Set(
    categories.map((c) => (c && typeof c.catName === 'string' ? c.catName.trim() : '')).filter(Boolean)
  );
  for (const [catName, category] of CATNAME_MAP) {
    if (present.has(catName)) return category;
  }
  return null;
}

// 'YYYY-MM-DD' for a Date instant, evaluated in Eastern time.
function easternDay(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// UTC offset string ('-04:00' / '-05:00') in effect in Eastern time at the given instant.
function easternOffset(date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part?.value || '');
  return m ? m[1] : '-04:00';
}

// Date instant for midnight Eastern on a 'YYYY-MM-DD' calendar day (DST-safe).
function easternMidnight(dayStr) {
  for (const offset of ['-04:00', '-05:00']) {
    const candidate = new Date(`${dayStr}T00:00:00.000${offset}`);
    if (easternOffset(candidate) === offset) return candidate;
  }
  return new Date(`${dayStr}T00:00:00.000-04:00`);
}

function addDays(dayStr, days) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// Combine an Eastern calendar day with an 'HH:MM:SS' local time into an ISO string.
function combineDayTime(dayStr, timeStr) {
  if (!timeStr || !/^\d{2}:\d{2}/.test(timeStr)) return dayStr;
  const offset = easternOffset(easternMidnight(dayStr));
  return `${dayStr}T${timeStr}${offset}`;
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
  if (/\bfree\b/i.test(text)) return { price: 0, isFree: true };
  return { price: null, isFree: null };
}

async function getToken() {
  const res = await vtbFetch(`${BASE}/plugins/core/get_simple_token/`);
  if (!res.ok) throw new Error(`Visit Tampa Bay token request failed: HTTP ${res.status}`);
  const token = (await res.text()).trim();
  if (!token || token.length > 200 || /[<>\s]/.test(token)) {
    throw new Error(`Visit Tampa Bay token response not recognized: ${token.slice(0, 80)}`);
  }
  return token;
}

async function fetchPage(token, startISO, endISO, skip) {
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
        latitude: 1, longitude: 1, absoluteUrl: 1, media_raw: 1,
        description: 1, admission: 1, categories: 1,
      },
    },
  };
  const url = `${BASE}/includes/rest_v2/plugins_events_events_by_date/find/` +
    `?json=${encodeURIComponent(JSON.stringify(query))}&token=${encodeURIComponent(token)}`;
  const res = await vtbFetch(url);
  if (!res.ok) {
    throw new Error(`Visit Tampa Bay events request failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  const docs = body?.docs?.docs;
  if (!Array.isArray(docs)) {
    throw new Error('Visit Tampa Bay response missing docs.docs array');
  }
  return { docs, count: body.docs.count ?? docs.length };
}

function mapDoc(doc, todayDay, lastDay) {
  const title = cleanText(doc.title, 300);
  if (!title) return null;

  // `date` is the next occurrence inside the queried range, encoded as 23:59:59
  // Eastern of the event's local day (e.g. 2026-07-03T03:59:59Z => July 2 local).
  const occurrence = doc.date || doc.nextDate || doc.startDate;
  if (!occurrence) return null;
  const occurrenceDate = new Date(occurrence);
  if (Number.isNaN(occurrenceDate.getTime())) return null;
  const day = easternDay(occurrenceDate);
  if (day < todayDay || day > lastDay) return null;

  const start = combineDayTime(day, doc.startTime);

  // endDate on recurring events is the series end, not the occurrence end.
  let end = null;
  if (doc.recurType === 0 && doc.endDate) {
    const endDate = new Date(doc.endDate);
    if (!Number.isNaN(endDate.getTime())) {
      const endDay = easternDay(endDate);
      if (endDay >= day) {
        const candidate = combineDayTime(endDay, doc.endTime);
        if (candidate !== start) end = candidate;
      }
    }
  }

  const addressParts = [doc.address1, doc.city, doc.state, doc.zip]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const { price, isFree } = parseAdmission(doc.admission);
  const lat = typeof doc.latitude === 'number' ? doc.latitude : null;
  const lng = typeof doc.longitude === 'number' ? doc.longitude : null;
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
    isFree,
    lat,
    lng,
    url: typeof doc.absoluteUrl === 'string' && doc.absoluteUrl ? doc.absoluteUrl : null,
    image,
    description: cleanText(doc.description),
    source: name,
  };
  const category = mapCategory(doc.categories);
  if (category) event.category = category;
  return event;
}

export async function fetchEvents() {
  const now = new Date();
  const todayDay = easternDay(now);
  const lastDay = addDays(todayDay, DAYS_AHEAD);
  const startISO = easternMidnight(todayDay).toISOString();
  const endISO = easternMidnight(lastDay).toISOString();

  const token = await getToken();

  const allDocs = [];
  let expected = Infinity;
  for (let page = 0; page < MAX_PAGES && allDocs.length < expected; page++) {
    const { docs, count } = await fetchPage(token, startISO, endISO, page * PAGE_LIMIT);
    expected = count;
    allDocs.push(...docs);
    if (docs.length < PAGE_LIMIT) break;
  }
  if (allDocs.length < expected) {
    console.warn(`Visit Tampa Bay: fetched ${allDocs.length} of ${expected} docs (page cap reached)`);
  }

  const events = [];
  for (const doc of allDocs) {
    try {
      const event = mapDoc(doc, todayDay, lastDay);
      if (event) events.push(event);
    } catch (err) {
      console.warn(`Visit Tampa Bay: skipping doc ${doc?.recid ?? '?'}: ${err.message}`);
    }
  }
  return events;
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await fetchEvents();
  console.log(`count: ${events.length}`);
  console.log(`categorized: ${events.filter((e) => e.category).length}`);
  for (const sample of events.slice(0, 3)) {
    console.log(JSON.stringify(sample));
  }
}
