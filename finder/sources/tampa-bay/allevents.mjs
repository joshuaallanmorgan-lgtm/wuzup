// AllEvents (allevents.in) event source.
// Scrapes schema.org Event objects embedded as <script type="application/ld+json">
// in four Tampa Bay listing pages. Listing-level startDate is often date-only; we
// deliberately do NOT fetch detail pages (politeness + speed).

import { cleanText, fetchWithTimeout } from '../_shared.mjs';

export const name = 'AllEvents';

const PAGES = [
  { url: 'https://allevents.in/tampa', free: false },
  { url: 'https://allevents.in/tampa/free', free: true },
  { url: 'https://allevents.in/st-petersburg', free: false },
  { url: 'https://allevents.in/clearwater', free: false },
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const DAYS_AHEAD = 45;
const TZ = 'America/New_York';

function aeFetch(url) {
  return fetchWithTimeout(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  });
}

// 'YYYY-MM-DD' for "today" in Tampa's timezone.
function easternToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(dayStr, days) {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Calendar day of a schema.org startDate ('YYYY-MM-DD' or ISO datetime).
function dayOf(dateStr) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(dateStr).trim());
  return m ? m[1] : null;
}

// Recursively collect schema.org Event objects from a parsed ld+json value.
function collectEvents(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && /Event$/.test(t))) out.push(node);
  if (node['@graph']) collectEvents(node['@graph'], out);
  if (node.itemListElement) collectEvents(node.itemListElement, out);
  if (node.item) collectEvents(node.item, out);
}

function extractLdEvents(html) {
  const out = [];
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    try {
      collectEvents(JSON.parse(block[1]), out);
    } catch {
      // Malformed/truncated JSON block; ignore and keep the rest.
    }
  }
  return out;
}

function parsePrice(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list) {
    if (!offer || typeof offer !== 'object') continue;
    const raw = offer.lowPrice ?? offer.price;
    if (raw === undefined || raw === null || raw === '') continue;
    const value = parseFloat(String(raw).replace(/[$,]/g, ''));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function mapEvent(item, fromFreePage, todayDay, lastDay) {
  const title = cleanText(item.name, 300);
  if (!title) return null;

  const startDay = dayOf(item.startDate);
  if (!startDay || startDay < todayDay || startDay > lastDay) return null;
  const start = String(item.startDate).trim();

  let end = item.endDate ? String(item.endDate).trim() : null;
  if (end && (dayOf(end) === null || end === start)) end = null;

  const location = item.location && typeof item.location === 'object' ? item.location : {};
  const addr = location.address && typeof location.address === 'object' ? location.address : {};
  const addressParts = [addr.streetAddress, addr.addressLocality, addr.addressRegion]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const geo = location.geo && typeof location.geo === 'object' ? location.geo : {};
  const lat = Number.isFinite(Number(geo.latitude)) && geo.latitude !== null ? Number(geo.latitude) : null;
  const lng = Number.isFinite(Number(geo.longitude)) && geo.longitude !== null ? Number(geo.longitude) : null;

  const price = parsePrice(item.offers);
  let isFree = null;
  if (fromFreePage || price === 0) isFree = true;
  else if (price !== null) isFree = false;

  return {
    title,
    start,
    end,
    venue: cleanText(location.name, 200),
    address: addressParts.length ? addressParts.join(', ') : null,
    price,
    isFree,
    lat,
    lng,
    url: typeof item.url === 'string' && item.url ? item.url : null,
    image: typeof item.image === 'string' && item.image ? item.image : null,
    description: cleanText(item.description),
    source: name,
  };
}

export async function fetchEvents() {
  const todayDay = easternToday();
  const lastDay = addDays(todayDay, DAYS_AHEAD);

  const byUrl = new Map();
  let anonCounter = 0;
  let pagesOk = 0;
  let lastError = null;

  for (const page of PAGES) {
    let items;
    try {
      const res = await aeFetch(page.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = extractLdEvents(await res.text());
    } catch (err) {
      lastError = err;
      console.warn(`AllEvents: failed to fetch ${page.url}: ${err.message}`);
      continue;
    }
    pagesOk++;
    if (!items.length) {
      console.warn(`AllEvents: no ld+json Event objects found on ${page.url} (page structure may have changed)`);
      continue;
    }
    for (const item of items) {
      const event = mapEvent(item, page.free, todayDay, lastDay);
      if (!event) continue;
      const key = event.url ?? `anon-${anonCounter++}`;
      const existing = byUrl.get(key);
      if (existing) {
        // The /free listing overlaps the city listings; keep one copy, upgrade flags.
        if (page.free || event.isFree === true) {
          existing.isFree = true;
          if (existing.price === null) existing.price = 0;
        }
        if (existing.price === null && event.price !== null) existing.price = event.price;
      } else {
        if (event.isFree === true && event.price === null) event.price = 0;
        byUrl.set(key, event);
      }
    }
  }

  if (pagesOk === 0) {
    throw new Error(`AllEvents: all listing pages failed (last error: ${lastError?.message ?? 'unknown'})`);
  }
  return [...byUrl.values()];
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await fetchEvents();
  console.log(`count: ${events.length}`);
  for (const sample of events.slice(0, 3)) {
    console.log(JSON.stringify(sample));
  }
}
