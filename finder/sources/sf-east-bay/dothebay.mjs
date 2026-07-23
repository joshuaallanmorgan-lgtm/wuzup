// dothebay.mjs — DoTheBay, the SF Bay Area metro on the DoStuff network.
// Port of the do813.mjs client (STAGE_D_SF_EVENTS.md row 2 — a BASE swap +
// a live CATEGORY_MAP resample + city-tz date math).
//
// HOW THE DATA FLOWS (live-verified 2026-07-05, same Rails .json twin as do813):
//   https://dothebay.com/events.json?page=N   → upcoming feed, paginated
//   https://dothebay.com/events/YYYY/M/D.json → single day (unused here)
// Response: { events: [...], paging: { count, total_pages, next_page_path } }.
// Live probe: 66 events / 3 pages; records carry begin_date /
// tz_adjusted_begin_date (correct -07:00 Pacific offsets), venue {title,
// full_address, latitude, longitude}, category, is_free, ticket_info,
// imagery, permalink. No key needed. robots.txt allows /events (disallows
// /search and /latest — neither is touched).
//
// UNLIKE do813 (dormant metro), DoTheBay is ACTIVE — the same curated
// local-culture class, but publishing.
import { fetchWithTimeout, cleanText, sourceStartDay, sourceWindow } from '../_shared.mjs';
// D2 seam: all day math runs in THIS city's zone, from the city config —
// never the machine clock (the easternToday()/machine-local bug class).
// bbox: DoTheBay is BAY-WIDE (Napa, Petaluma, San Jose...) while this city
// is the SF→Walnut Creek corridor — records whose OWN coords fall outside
// the ratified box are dropped HERE, because downstream only NULLS
// out-of-box coords (the event would ship coordless, out-of-market).
// Coordless records pass through: the bounded geocoder decides them.
import { tz as CITY_TZ, bbox as CITY_BBOX } from '../../cities/sf-east-bay.mjs';

export const name = 'DoTheBay';

const BASE = 'https://dothebay.com';
const MAX_PAGES = 8; // 25/page — live paging says 3 pages today; headroom is cheap
const PAGE_SIZE = 25;
const WINDOW_DAYS = 45;
const PAGE_GAP_MS = 400; // polite pacing between pages, same as meetup.mjs
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// DoStuff display categories → app categories, RESAMPLED on DoTheBay live
// data 2026-07-05 (vocabulary differs from do813/do312 as the scout warned).
// Observed: Music 27 · Variety 15 · Theatre & Performing Arts 5 · Film 4 ·
// The Arts 3 · Lecture/Education 2 (trailing space in the wire value!) ·
// Comedy 2 · Sports 2 · Experiences 2 · Festival 1 · Outdoor & Recreation 1 ·
// DJ/Parties 1 · Arts & Family 1.
// Sense decisions: 'Arts & Family' is kid-facing arts programming → family
// (checked BEFORE the art rule); 'Lecture/Education' → community;
// 'Variety' / 'Experiences' / 'Festival' carry no categorical sense → left
// unmapped so the pipeline's text classifier decides.
const CATEGORY_MAP = [
  [/family|kids/i, 'family'],
  [/music|concert/i, 'music'],
  [/comedy/i, 'comedy'],
  [/theatre|performing/i, 'theatre'],
  [/sports|fitness/i, 'sports'],
  [/food|drink/i, 'food'],
  [/parties|djs?\b|karaoke|nightlife/i, 'nightlife'],
  [/film|art/i, 'art'],
  [/market/i, 'market'],
  [/outdoor/i, 'outdoors'],
  [/lecture|education|community/i, 'community'],
];

function mapCategory(cat) {
  if (!cat) return undefined;
  for (const [re, val] of CATEGORY_MAP) if (re.test(cat)) return val;
  return undefined;
}

// '2026-07-05T12:00:00-07:00' → '2026-07-05T12:00:00' (contract: local wall
// time, no offset — finder.mjs re-attaches the city offset downstream).
// tz_adjusted_begin_date is verified to carry the correct Pacific offset;
// begin_time carries the DoStuff server zone and is only a fallback.
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
  const rawCategory = cleanText(e.category, 80);
  const event = {
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
  if (rawCategory) event.rawCategories = [rawCategory];
  return event;
}

export async function fetchEvents(options = {}) {
  const config = typeof options === 'string' ? { base: options } : options || {};
  const base = config.base || BASE;
  const nowMs = config.nowMs ?? Date.now();
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const waitImpl = config.waitImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const requireLive = config.requireLive === true;
  // Window bounds as CITY-day strings — begin_date is a local calendar day,
  // mapped starts are canonicalized before exact string comparison.
  const { today, lastDay } = sourceWindow(CITY_TZ, nowMs, WINDOW_DAYS);
  const seen = new Set();
  const acquired = new Set();
  const events = [];
  let declaredCount = null;
  let outOfBox = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await waitImpl(PAGE_GAP_MS);
    let json;
    try {
      const res = await fetchWithTimeout(
        `${base}/events.json?page=${page}`,
        { headers: { 'user-agent': UA, accept: 'application/json' } },
        25000,
        fetchImpl,
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      json = await res.json();
    } catch (err) {
      if (requireLive) throw new Error(`[dothebay] required page ${page} failed: ${err.message}`, { cause: err });
      console.warn(`[dothebay] page ${page} failed: ${err.message}`);
      break;
    }
    if (!Array.isArray(json?.events)) {
      if (requireLive) throw new Error(`[dothebay] required page ${page} missing events array`);
      console.warn(`[dothebay] page ${page} missing events array`);
    }
    const batch = Array.isArray(json?.events) ? json.events : [];
    for (const raw of batch) {
      if (requireLive) {
        const acquisitionKey = raw?.id ?? raw?.permalink ?? `${raw?.title || ''}|${raw?.begin_date || ''}|${raw?.tz_adjusted_begin_date || ''}`;
        if (acquired.has(acquisitionKey)) throw new Error(`[dothebay] duplicate raw row across live pages: ${acquisitionKey}`);
        acquired.add(acquisitionKey);
      }
      if (raw?.past === true) continue;
      const ev = mapEvent(raw, base);
      if (!ev) continue;
      const day = sourceStartDay(CITY_TZ, ev.start);
      if (!day || day < today || day > lastDay) continue; // skip already-running ("ongoing") and far-future
      // out-of-corridor drop (see the bbox import note): source-provided
      // venue coords outside the city box = a North/South Bay listing.
      if (ev.lat != null && ev.lng != null &&
          (ev.lat < CITY_BBOX.latMin || ev.lat > CITY_BBOX.latMax ||
           ev.lng < CITY_BBOX.lngMin || ev.lng > CITY_BBOX.lngMax)) {
        outOfBox++;
        continue;
      }
      if (seen.has(ev.url)) continue;
      seen.add(ev.url);
      events.push(ev);
    }
    const totalPagesValue = Number(json?.paging?.total_pages);
    const countValue = Number(json?.paging?.count);
    if (requireLive && (!Number.isInteger(totalPagesValue) || totalPagesValue < 0)) {
      throw new Error(`[dothebay] required page ${page} missing valid paging.total_pages`);
    }
    if (requireLive && (!Number.isInteger(countValue) || countValue < 0)) {
      throw new Error(`[dothebay] required page ${page} missing valid paging.count`);
    }
    if (requireLive && declaredCount !== null && countValue !== declaredCount) {
      throw new Error(`[dothebay] paging.count changed from ${declaredCount} to ${countValue}`);
    }
    if (requireLive && Math.ceil(countValue / PAGE_SIZE) !== totalPagesValue) {
      throw new Error(`[dothebay] paging count/pages are incoherent (${countValue}/${totalPagesValue})`);
    }
    declaredCount = countValue;
    const totalPages = totalPagesValue || 0;
    if (requireLive && totalPages > MAX_PAGES) {
      throw new Error(`[dothebay] live feed requires ${totalPages} pages, above cap ${MAX_PAGES}`);
    }
    if (page >= totalPages) break;
  }

  if (requireLive && acquired.size !== declaredCount) {
    throw new Error(`[dothebay] live result incomplete (${acquired.size} of ${declaredCount} rows)`);
  }

  if (outOfBox) console.warn(`[dothebay] dropped ${outOfBox} out-of-corridor listing(s) (own coords outside the city box)`);
  if (events.length === 0) {
    console.warn('[dothebay] 0 events — feed empty or shape changed (66 events live on 2026-07-05).');
  }
  return events;
}

// CLI runner: node finder/sources/sf-east-bay/dothebay.mjs [baseUrl]
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] || BASE;
  fetchEvents(base).then((evs) => {
    console.log(`DoTheBay (${base}): ${evs.length} events`);
    for (const e of evs.slice(0, 8)) {
      console.log(' -', e.start, '|', e.title, '|', e.venue, '|', e.category || '-', '|', e.isFree ? 'FREE' : e.price ?? '?');
    }
  });
}
