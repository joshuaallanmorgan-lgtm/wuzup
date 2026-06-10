// do813.mjs — Do813, Tampa Bay's metro on the DoStuff network (property_id 63).
//
// HOW THE DATA FLOWS (probed 2026-06-10):
// The site is a Rails app; every listing page has a JSON twin — append .json:
//   https://do813.com/events.json            → upcoming feed, paginated (?page=N)
//   https://do813.com/events/YYYY/M/D.json   → single day
// Response: { events: [...], paging: { count, total_pages, next_page_path } }.
// Event records carry begin_date/tz_adjusted_begin_date, venue {title, full_address,
// latitude, longitude}, category, is_free, imagery, permalink. No key needed.
// (The embedded Algolia config — app SLX3J5GU6S — is dead: every Algolia host
// for that app is NXDOMAIN. The .json twin is the real, supported path.)
//
// STATUS (verified 2026-06-10): the API works — sibling metros do312/do512
// return hundreds of events — but the do813 metro is DORMANT: every date
// segment returns {"events":[],"count":0}, and the Playwright-rendered
// listing page shows zero listings. This module is a thin, correct client
// that costs one request while dormant and revives automatically if the
// metro is restaffed. Parser mechanics were verified against the identical
// live schema on do312:  node finder/sources/do813.mjs https://do312.com
import { fetchWithTimeout, cleanText } from './_shared.mjs';

export const name = 'Do813';

const BASE = 'https://do813.com';
const MAX_PAGES = 8; // 25/page → up to 200 events
const WINDOW_DAYS = 45;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// DoStuff display categories → app categories. Anything unmapped stays
// undefined and lets the pipeline classify.
const CATEGORY_MAP = [
  [/music|concert/i, 'music'],
  [/comedy/i, 'comedy'],
  [/theatre|performing/i, 'theatre'],
  [/sports|fitness/i, 'sports'],
  [/food|drink/i, 'food'],
  [/parties|djs|karaoke|nightlife/i, 'nightlife'],
  [/film|art/i, 'art'],
  [/market/i, 'market'],
  [/family|kids/i, 'family'],
  [/outdoor/i, 'outdoors'],
  [/community/i, 'community'],
];

function mapCategory(cat) {
  if (!cat) return undefined;
  for (const [re, val] of CATEGORY_MAP) if (re.test(cat)) return val;
  return undefined;
}

// '2026-05-28T19:00:00-05:00' → '2026-05-28T19:00:00' (contract: local time, no offset)
function localDateTime(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function pickImage(imagery) {
  if (!imagery) return null;
  const aws = imagery.aws || {};
  const cover =
    aws.cover_image_h_250_w_680 || aws.cover_image_h_300_w_864 || aws.cover_image_h_630_w_1200;
  if (cover) return cover;
  if (imagery.photo) return 'https://res.cloudinary.com/dostuff-media/image/upload/' + imagery.photo;
  return null;
}

function mapEvent(e, base) {
  const begin = e.begin_date; // 'YYYY-MM-DD'
  if (!begin || !e.title) return null;
  const startDT = localDateTime(e.tz_adjusted_begin_date || e.begin_time);
  const v = e.venue || {};
  const priceM = String(e.ticket_info || '').match(/\$\s*(\d{1,4}(?:\.\d{2})?)/);
  return {
    title: cleanText(e.title, 200),
    start: startDT || begin,
    end: localDateTime(e.end_time),
    venue: cleanText(v.title, 120) || null,
    address: cleanText(v.full_address, 200) || null,
    price: priceM ? Number(priceM[1]) : null,
    isFree: e.is_free === true,
    lat: Number.isFinite(v.latitude) ? v.latitude : null,
    lng: Number.isFinite(v.longitude) ? v.longitude : null,
    url: e.permalink ? base + e.permalink : base,
    image: pickImage(e.imagery),
    description: cleanText(e.description || e.excerpt, 300),
    category: mapCategory(e.category),
    source: name,
  };
}

export async function fetchEvents(base = BASE) {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const t1 = new Date(t0.getTime() + WINDOW_DAYS * 86400000);
  const seen = new Set();
  const events = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    let json;
    try {
      const res = await fetchWithTimeout(
        `${base}/events.json?page=${page}`,
        { headers: { 'user-agent': UA, accept: 'application/json' } },
        25000,
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      json = await res.json();
    } catch (err) {
      console.warn(`[do813] page ${page} failed: ${err.message}`);
      break;
    }
    const batch = Array.isArray(json?.events) ? json.events : [];
    for (const raw of batch) {
      if (raw?.past === true) continue;
      const ev = mapEvent(raw, base);
      if (!ev) continue;
      const day = new Date(ev.start.slice(0, 10) + 'T00:00:00');
      if (day < t0 || day > t1) continue; // skip already-running ("ongoing") and far-future
      if (seen.has(ev.url)) continue;
      seen.add(ev.url);
      events.push(ev);
    }
    const totalPages = json?.paging?.total_pages || 0;
    if (page >= totalPages) break;
  }

  if (events.length === 0) {
    console.warn('[do813] 0 events — metro has been dormant since at least 2026-06; API itself is fine.');
  }
  return events;
}

// CLI runner: node finder/sources/do813.mjs [baseUrl]
// Pass a sibling metro (e.g. https://do312.com) to verify parser mechanics
// against live data while do813 is dormant. fetchEvents() in the pipeline
// always uses do813.com.
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] || BASE;
  fetchEvents(base).then((evs) => {
    console.log(`Do813 (${base}): ${evs.length} events`);
    for (const e of evs.slice(0, 8)) {
      console.log(' -', e.start, '|', e.title, '|', e.venue, '|', e.category || '-', '|', e.isFree ? 'FREE' : e.price ?? '?');
    }
  });
}
