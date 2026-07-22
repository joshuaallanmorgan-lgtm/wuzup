// Meetup recurring clubs / hobby groups across the SF → East Bay corridor.
// Port of the Tampa meetup.mjs donor (STAGE_D_SF_EVENTS.md row 7 — location
// URL adds; RECURRING CLUBS are still our weakest area). Scrapes the
// embedded __NEXT_DATA__ JSON from Meetup's find page. The internal
// structure (Apollo state) is brittle across Meetup deploys, so parsing is
// a defensive recursive walk: collect anything event-shaped, warn and
// return [] when nothing is found — never throw on shape surprises.

import { decodeEntities, stripHtml, truncate, fetchWithTimeout, sourceStartDay, sourceWindow } from '../_shared.mjs';
// D2 seam: the window opens at CITY midnight, not machine midnight (the
// donor's `new Date(y, m, d)` was machine-local — the D2 hazard class).
import { tz as CITY_TZ } from '../../cities/sf-east-bay.mjs';

export const name = 'Meetup';

// Listing fetches (live-verified 2026-07-05: each location returns its own
// ~10-12 events embedded in __NEXT_DATA__; categoryId filters server-side —
// ids from the find page's category chips: 652 food&drink, 395 music).
// NOTE: we deliberately do NOT emit a category hint from these — Meetup's
// category is group-level, not event-level (a fitness group's happy hour
// shows under "sports"), and native hints override the pipeline's text
// classifier. Keep this list <= 6 — requests are paced 400ms apart.
const SF = 'https://www.meetup.com/find/?location=us--ca--san-francisco&source=EVENTS';
const OAKLAND = 'https://www.meetup.com/find/?location=us--ca--oakland&source=EVENTS';
const BERKELEY = 'https://www.meetup.com/find/?location=us--ca--berkeley&source=EVENTS';
const WALNUT_CREEK = 'https://www.meetup.com/find/?location=us--ca--walnut-creek&source=EVENTS';
const LISTING_URLS = [
  SF,
  OAKLAND,
  BERKELEY,
  WALNUT_CREEK,
  `${SF}&categoryId=652`,
  `${SF}&categoryId=395`,
];
const FETCH_GAP_MS = 400;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const WINDOW_DAYS = 45;

function meetupFetch(url, fetchImpl) {
  return fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }, 20000, fetchImpl);
}

// Resolve Apollo-style { __ref: "Group:123" } references against the state map.
function deref(obj, refMap) {
  if (obj && typeof obj === 'object' && typeof obj.__ref === 'string' && refMap) {
    return refMap[obj.__ref] ?? null;
  }
  return obj;
}

function looksLikeFutureDate(v, today, lastDay) {
  if (typeof v !== 'string' || v.length < 8) return null;
  const day = sourceStartDay(CITY_TZ, v);
  if (!day || day < today || day > lastDay) return null;
  return day;
}

// Recursively walk the parsed JSON collecting event-shaped objects.
function collectEventLike(root, today, lastDay) {
  const hits = [];
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const title = node.title || node.name;
    const dt = node.dateTime || node.startTime;
    if (
      typeof title === 'string' && title.trim() &&
      looksLikeFutureDate(dt, today, lastDay) &&
      // require an event-ish signal so Group/Member objects don't slip in
      (node.eventUrl || node.link || node.eventType || node.venue)
    ) {
      hits.push(node);
    }
    for (const k of Object.keys(node)) stack.push(node[k]);
  }
  return hits;
}

function mapEvent(node, refMap) {
  const title = decodeEntities(String(node.title || node.name).trim());
  const start = node.dateTime || node.startTime;
  const end = node.endTime || null;

  const venueObj = deref(node.venue, refMap);

  // Skip virtual/online events: Meetup marks them eventType "ONLINE" with a
  // placeholder "Online event" venue; titles carry "(Virtual)" or "Online"
  // (a Zoom-from-home listing can carry eventType PHYSICAL and a street
  // venue — the title/venue words are the honest signal).
  const venueName =
    venueObj && typeof venueObj === 'object' && typeof venueObj.name === 'string'
      ? venueObj.name.trim()
      : '';
  if (
    String(node.eventType || '').toUpperCase() === 'ONLINE' ||
    /\b(virtual|online)\b/i.test(venueName) ||
    /\b(virtual|online)\b/i.test(title)
  ) {
    return null;
  }
  let venue = null;
  let address = null;
  let lat = null;
  let lng = null;
  if (venueObj && typeof venueObj === 'object') {
    venue = (venueObj.name || '').trim() || null;
    const street = typeof venueObj.address === 'string' ? venueObj.address.trim() : '';
    const city = typeof venueObj.city === 'string' ? venueObj.city.trim() : '';
    const state = typeof venueObj.state === 'string' ? venueObj.state.trim().toUpperCase() : '';
    const parts = [street];
    // venue.address sometimes already embeds "City, ST zip" — avoid duplicating.
    if (city && !street.toLowerCase().includes(city.toLowerCase())) parts.push(city);
    if (state && !new RegExp(`\\b${state}\\b`, 'i').test(street)) parts.push(state);
    const joined = parts.filter(Boolean).join(', ');
    address = joined || null;
    if (typeof venueObj.lat === 'number') lat = venueObj.lat;
    if (typeof venueObj.lng === 'number') lng = venueObj.lng;
    else if (typeof venueObj.lon === 'number') lng = venueObj.lon;
  }

  // No venue AND no address = a webinar/online event Meetup didn't flag.
  // A things-to-do app needs a place you can go.
  if (!venue && !address) return null;

  const groupObj = deref(node.group, refMap);
  const groupName =
    groupObj && typeof groupObj === 'object' && typeof groupObj.name === 'string'
      ? groupObj.name.trim()
      : null;

  let image = null;
  const photo = deref(node.featuredEventPhoto || node.displayPhoto || node.image, refMap);
  if (photo && typeof photo === 'object') {
    image = photo.highResUrl || photo.standardUrl || photo.source || null;
  } else if (typeof photo === 'string') {
    image = photo;
  }

  let description = node.description;
  if (typeof description !== 'string') description = null;
  if (description) description = truncate(stripHtml(description));
  if (groupName) {
    description = description
      ? truncate(`[${groupName}] ${description}`)
      : `Hosted by ${groupName}`;
  }

  return {
    title,
    start,
    end,
    venue,
    address,
    price: null,
    isFree: null,
    lat,
    lng,
    url: node.eventUrl || node.link || null,
    image,
    description,
    organizer: groupName ? truncate(groupName, 160) : null,
    source: name,
  };
}

async function fetchPageEvents(url, today, lastDay, fetchImpl, { requireLive = false } = {}) {
  const res = await meetupFetch(url, fetchImpl);
  if (!res.ok) {
    if (requireLive) throw new Error(`HTTP ${res.status} for ${url}`);
    console.warn(`[${name}] HTTP ${res.status} for ${url}`);
    return [];
  }
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) {
    if (requireLive) throw new Error(`__NEXT_DATA__ script not found for ${url}`);
    console.warn(`[${name}] __NEXT_DATA__ script not found — page structure changed?`);
    return [];
  }
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    if (requireLive) throw new Error(`failed to parse __NEXT_DATA__ for ${url}: ${err.message}`, { cause: err });
    console.warn(`[${name}] failed to JSON.parse __NEXT_DATA__: ${err.message}`);
    return [];
  }

  // Apollo state map (when present) lets us resolve { __ref } pointers.
  let refMap = null;
  try {
    refMap = data?.props?.pageProps?.__APOLLO_STATE__ ?? null;
  } catch {
    refMap = null;
  }

  const nodes = collectEventLike(data, today, lastDay);
  const events = [];
  for (const node of nodes) {
    try {
      const ev = mapEvent(node, refMap);
      if (ev) events.push(ev);
    } catch (err) {
      if (requireLive) throw new Error(`required event node mapping failed: ${err.message}`, { cause: err });
      console.warn(`[${name}] skipping unmappable event node: ${err.message}`);
    }
  }
  return events;
}

export async function fetchEvents(options = {}) {
  const config = options || {};
  const nowMs = config.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const waitImpl = config.waitImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const requireLive = config.requireLive === true;
  const { today, lastDay } = sourceWindow(CITY_TZ, nowMs, WINDOW_DAYS);

  const all = [];
  let firstFetch = true;
  for (const url of LISTING_URLS) {
    if (!firstFetch) await waitImpl(FETCH_GAP_MS);
    firstFetch = false;
    try {
      all.push(...await fetchPageEvents(url, today, lastDay, fetchImpl, { requireLive }));
    } catch (err) {
      if (requireLive) throw new Error(`[${name}] required listing failed for ${url}: ${err.message}`, { cause: err });
      // Network/abort failures on one page are soft — keep what we have.
      console.warn(`[${name}] fetch failed for ${url}: ${err.message}`);
    }
  }

  // Dedupe by event URL (fall back to title+start) — the same event can
  // surface under several listing fetches.
  const byKey = new Map();
  for (const ev of all) {
    const key = ev.url || `${ev.title}|${ev.start}`;
    if (!byKey.has(key)) byKey.set(key, ev);
  }
  const events = [...byKey.values()];

  if (events.length === 0) {
    if (requireLive) throw new Error(`[${name}] live listings contained no event-like objects`);
    console.warn(`[${name}] no event-like objects found — Meetup structure may have changed`);
  }
  return events;
}

// Standalone CLI runner: node finder/sources/sf-east-bay/meetup.mjs
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents()
    .then((events) => {
      console.log(`count: ${events.length}`);
      for (const ev of events.slice(0, 3)) console.log(JSON.stringify(ev));
    })
    .catch((err) => {
      console.error(`[${name}] FAILED:`, err.message);
      process.exitCode = 1;
    });
}
