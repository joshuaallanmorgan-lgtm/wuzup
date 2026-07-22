// Pinellas County government calendar (The Events Calendar / tribe REST API).
import { pathToFileURL } from 'node:url';
import { decodeEntities, stripHtml, truncate, fetchWithTimeout, sourceStartDay, sourceWindow } from '../_shared.mjs';
import { tz as CITY_TZ } from '../../cities/tampa-bay.mjs';

export const name = 'Pinellas County';

const API_BASE = 'https://pinellas.gov/wp-json/tribe/events/v1/events';
const MAX_PAGES = 3;
const PER_PAGE = 50;
const WINDOW_DAYS = 45;
const USER_AGENT = 'tampabay-events-finder/0.1';

// County service noise, not "events" anyone attends for fun — includes
// government-body meetings (board/commission/committee/etc.) and
// procurement/admin sessions (agency/working group/RFQ/RFP/etc.).
const NOISE = /mobile medical|vaccin|tax |permit|hearing|board|commission|committee|council|advisory|authority|task force|trust fund|co-applicant|agency|working group|evaluation meeting|RFQ|RFP|procurement/i;

// Native tribe categories[].name -> our category vocabulary. The live feed's
// categories are mostly government-body names (filtered as noise anyway);
// only the recreational ones carry a usable signal.
function categoryNames(categories) {
  return (Array.isArray(categories) ? categories : [])
    .map((c) => (c && typeof c.name === 'string' ? decodeEntities(c.name) : ''))
    .map((value) => value.trim().slice(0, 80))
    .filter(Boolean);
}

function mapCategory(categories) {
  const names = categoryNames(categories);
  for (const n of names) {
    if (/\bparks?\b|conservation|nature|preserve|trail/i.test(n)) return 'outdoors';
    if (/heritage|history|museum/i.test(n)) return 'community';
    if (/library/i.test(n)) return 'family';
  }
  return null;
}

// "2026-06-10 08:30:00" -> "2026-06-10T08:30:00"
function toIso(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : null;
}

function parseCost(cost) {
  const c = (cost == null ? '' : String(cost)).trim();
  if (c === '' || c === '0' || /^free$/i.test(c)) {
    return { price: c === '' ? null : 0, isFree: true };
  }
  const m = c.match(/(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const n = Number(m[1]);
    return { price: n, isFree: n === 0 };
  }
  return { price: null, isFree: null };
}

function buildAddress(venue) {
  if (!venue || typeof venue !== 'object') return null;
  const parts = [venue.address, venue.city, [venue.stateprovince || venue.state, venue.zip].filter(Boolean).join(' ')]
    .map((p) => (p || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function fetchEvents(options = {}) {
  const config = options || {};
  const nowMs = config.nowMs ?? Date.now();
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const requireLive = config.requireLive === true;
  const { today, lastDay } = sourceWindow(CITY_TZ, nowMs, WINDOW_DAYS);

  const all = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(MAX_PAGES, totalPages); page++) {
    const url = `${API_BASE}?per_page=${PER_PAGE}&page=${page}&start_date=${today}`;
    const res = await fetchWithTimeout(
      url,
      { headers: { 'user-agent': USER_AGENT } },
      undefined,
      fetchImpl,
    );
    if (!res.ok) {
      if (page === 1 || requireLive) throw new Error(`Pinellas County: HTTP ${res.status} on page ${page}`);
      console.warn(`Pinellas County: page ${page} returned HTTP ${res.status}; using ${all.length} events fetched so far`);
      break;
    }
    const data = await res.json();
    if (!Array.isArray(data.events)) {
      if (page === 1 || requireLive) throw new Error(`Pinellas County: unexpected response shape on page ${page} (no events array)`);
      console.warn(`Pinellas County: page ${page} had unexpected shape; using ${all.length} events fetched so far`);
      break;
    }
    const declaredPages = Number(data.total_pages);
    if (requireLive && (!Number.isInteger(declaredPages) || declaredPages < page)) {
      throw new Error(`Pinellas County: page ${page} missing valid total_pages`);
    }
    totalPages = declaredPages || totalPages;
    if (requireLive && totalPages > MAX_PAGES) {
      throw new Error(`Pinellas County: live feed requires ${totalPages} pages, above cap ${MAX_PAGES}`);
    }
    all.push(...data.events);
    if (requireLive && page < totalPages && !data.next_rest_url) {
      throw new Error(`Pinellas County: page ${page} omitted next_rest_url before page ${totalPages}`);
    }
    if (!data.next_rest_url) break;
  }

  const events = [];
  for (const item of all) {
    const title = decodeEntities(stripHtml(item.title || ''));
    if (!title || NOISE.test(title)) continue;

    // Virtual events aren't attendable city events — skip entirely.
    if (item.is_virtual) continue;

    const start = toIso(item.start_date);
    if (!start) continue;
    const startDay = sourceStartDay(CITY_TZ, start);
    if (!startDay || startDay < today || startDay > lastDay) continue;

    const venue = item.venue && typeof item.venue === 'object' && !Array.isArray(item.venue) ? item.venue : null;
    const lat = venue && venue.geo_lat != null && venue.geo_lat !== '' ? Number(venue.geo_lat) : null;
    const lng = venue && venue.geo_lng != null && venue.geo_lng !== '' ? Number(venue.geo_lng) : null;
    const { price, isFree } = parseCost(item.cost);

    const event = {
      title,
      start,
      end: toIso(item.end_date),
      venue: venue ? decodeEntities(venue.venue || '') || null : null,
      address: buildAddress(venue),
      price,
      isFree,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      url: item.url || null,
      image: item.image && item.image.url ? item.image.url : null,
      description: truncate(stripHtml(item.description || '')) || null,
      source: name,
    };
    const category = mapCategory(item.categories);
    if (category) event.category = category;
    const rawCategories = [...new Set(categoryNames(item.categories))].slice(0, 12);
    if (rawCategories.length) event.rawCategories = rawCategories;
    events.push(event);
  }
  return events;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents()
    .then((events) => {
      console.log(`count: ${events.length}`);
      console.log(`categorized: ${events.filter((e) => e.category).length}`);
      for (const e of events.slice(0, 3)) console.log(JSON.stringify(e));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
