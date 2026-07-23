// Visit Tampa Bay (Simpleview DMO) event source.
// Two-step flow: fetch a per-session token, then query the events_by_date REST plugin.
// Date range boundaries MUST be midnight Eastern Time (the API errors otherwise).
import {
  cleanText,
  decodeEntities,
  fetchWithTimeout,
  midnightInTz,
  sourceStartDay,
  sourceWallTime,
  sourceWindow,
} from '../_shared.mjs';
import { tz as CITY_TZ } from '../../cities/tampa-bay.mjs';

export const name = 'Visit Tampa Bay';

const BASE = 'https://www.visittampabay.com';
const UA = 'tampabay-events-finder/0.1';
const DAYS_AHEAD = 45;
const PAGE_LIMIT = 50; // keep responses under the API's ~200KB result-set cap (categories field adds bulk)
const MAX_PAGES = 10;
function vtbFetch(url, fetchImpl) {
  return fetchWithTimeout(url, { headers: { 'user-agent': UA } }, undefined, fetchImpl);
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

function mapCategory(categories, text = '') {
  if (!Array.isArray(categories)) return null;
  const present = new Set(
    categories.map((c) => (c && typeof c.catName === 'string' ? c.catName.trim() : '')).filter(Boolean)
  );
  for (const [catName, category] of CATNAME_MAP) {
    if (!present.has(catName)) continue;
    // 'Comedy' is the top-priority catName, but Simpleview venue self-tagging
    // misfiles straight concerts under it (Josh Groban with Jennifer Hudson,
    // live 2026-06). Trust it only when the listing's own words sound like
    // comedy; otherwise fall through to the next category signal.
    if (category === 'comedy' && !/\bcomed|\bstand-?up\b|\bimprov\b|\bfunny\b|\bjokes?\b/i.test(text)) continue;
    return category;
  }
  return null;
}

function rawCategoryNames(categories) {
  const names = [];
  for (const category of Array.isArray(categories) ? categories : []) {
    const categoryName = category && typeof category.catName === 'string'
      ? decodeEntities(category.catName).trim().slice(0, 80)
      : '';
    if (categoryName && !names.includes(categoryName)) names.push(categoryName);
    if (names.length === 12) break;
  }
  return names;
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

async function getToken(fetchImpl) {
  const res = await vtbFetch(`${BASE}/plugins/core/get_simple_token/`, fetchImpl);
  if (!res.ok) throw new Error(`Visit Tampa Bay token request failed: HTTP ${res.status}`);
  const token = (await res.text()).trim();
  if (!token || token.length > 200 || /[<>\s]/.test(token)) {
    throw new Error(`Visit Tampa Bay token response not recognized: ${token.slice(0, 80)}`);
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
        latitude: 1, longitude: 1, absoluteUrl: 1, media_raw: 1,
        description: 1, admission: 1, categories: 1,
      },
    },
  };
  const url = `${BASE}/includes/rest_v2/plugins_events_events_by_date/find/` +
    `?json=${encodeURIComponent(JSON.stringify(query))}&token=${encodeURIComponent(token)}`;
  const res = await vtbFetch(url, fetchImpl);
  if (!res.ok) {
    throw new Error(`Visit Tampa Bay events request failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  const docs = body?.docs?.docs;
  if (!Array.isArray(docs)) {
    throw new Error('Visit Tampa Bay response missing docs.docs array');
  }
  return { docs, count: body.docs.count ?? docs.length, declaredCount: body.docs.count };
}

function mapDoc(doc, todayDay, lastDay) {
  const title = cleanText(doc.title, 300);
  if (!title) return null;

  // `date` is the next occurrence inside the queried range, encoded as 23:59:59
  // Eastern of the event's local day (e.g. 2026-07-03T03:59:59Z => July 2 local).
  const occurrence = doc.date || doc.nextDate || doc.startDate;
  if (!occurrence) return null;
  const day = sourceStartDay(CITY_TZ, occurrence);
  if (!day) return null;
  if (day < todayDay || day > lastDay) return null;

  const start = doc.startTime ? sourceWallTime(CITY_TZ, day, doc.startTime) : day;
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
  const category = mapCategory(doc.categories, `${event.title || ''} ${event.description || ''}`);
  if (category) event.category = category;
  const rawCategories = rawCategoryNames(doc.categories);
  if (rawCategories.length) event.rawCategories = rawCategories;
  return event;
}

export async function fetchEvents(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const requireLive = options.requireLive === true;
  const { today: todayDay, lastDay } = sourceWindow(CITY_TZ, nowMs, DAYS_AHEAD);
  const startISO = midnightInTz(CITY_TZ, todayDay).toISOString();
  const endISO = midnightInTz(CITY_TZ, lastDay).toISOString();

  const token = await getToken(fetchImpl);

  const allDocs = [];
  let expected = Infinity;
  for (let page = 0; page < MAX_PAGES && allDocs.length < expected; page++) {
    const skip = page * PAGE_LIMIT;
    const { docs, count, declaredCount } = await fetchPage(token, startISO, endISO, skip, fetchImpl);
    if (requireLive && (!Number.isInteger(declaredCount) || declaredCount < skip + docs.length)) {
      throw new Error(`Visit Tampa Bay: live page ${page + 1} missing a valid docs.count`);
    }
    if (requireLive && Number.isFinite(expected) && declaredCount !== expected) {
      throw new Error(`Visit Tampa Bay: docs.count changed from ${expected} to ${declaredCount}`);
    }
    expected = count;
    allDocs.push(...docs);
    if (docs.length < PAGE_LIMIT) break;
  }
  if (allDocs.length < expected) {
    if (requireLive) {
      throw new Error(`Visit Tampa Bay: live result incomplete (${allDocs.length} of ${expected} docs)`);
    }
    console.warn(`Visit Tampa Bay: fetched ${allDocs.length} of ${expected} docs (page cap reached)`);
  }

  const events = [];
  for (const doc of allDocs) {
    try {
      const event = mapDoc(doc, todayDay, lastDay);
      if (event) events.push(event);
    } catch (err) {
      if (requireLive) throw new Error(`Visit Tampa Bay: required doc ${doc?.recid ?? '?'} failed mapping: ${err.message}`, { cause: err });
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
