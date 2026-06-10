// Meetup recurring clubs / hobby groups around Tampa.
// Scrapes the embedded __NEXT_DATA__ JSON from Meetup's find page.
// The internal structure (Apollo state) is brittle across Meetup deploys,
// so parsing is a defensive recursive walk: collect anything event-shaped,
// warn and return [] when nothing is found — never throw on shape surprises.

export const name = 'Meetup';

const BASE_URL = 'https://www.meetup.com/find/?location=us--fl--tampa&source=EVENTS';
const EXTRA_URL = BASE_URL + '&dateRange=this-week';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const WINDOW_DAYS = 45;
const TIMEOUT_MS = 20000;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”',
};

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}

function stripHtml(s) {
  if (!s) return s;
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function truncate(s, n = 250) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

// Resolve Apollo-style { __ref: "Group:123" } references against the state map.
function deref(obj, refMap) {
  if (obj && typeof obj === 'object' && typeof obj.__ref === 'string' && refMap) {
    return refMap[obj.__ref] ?? null;
  }
  return obj;
}

function looksLikeFutureDate(v, todayStart, windowEnd) {
  if (typeof v !== 'string' || v.length < 8) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  if (d < todayStart || d > windowEnd) return null;
  return d;
}

// Recursively walk the parsed JSON collecting event-shaped objects.
function collectEventLike(root, todayStart, windowEnd) {
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
      looksLikeFutureDate(dt, todayStart, windowEnd) &&
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
    source: name,
  };
}

async function fetchPageEvents(url, todayStart, windowEnd) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    console.warn(`[${name}] HTTP ${res.status} for ${url}`);
    return [];
  }
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) {
    console.warn(`[${name}] __NEXT_DATA__ script not found — page structure changed?`);
    return [];
  }
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
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

  const nodes = collectEventLike(data, todayStart, windowEnd);
  const events = [];
  for (const node of nodes) {
    try {
      events.push(mapEvent(node, refMap));
    } catch (err) {
      console.warn(`[${name}] skipping unmappable event node: ${err.message}`);
    }
  }
  return events;
}

export async function fetchEvents() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = new Date(todayStart.getTime() + WINDOW_DAYS * 86400000);

  const all = [];
  for (const url of [BASE_URL, EXTRA_URL]) {
    try {
      all.push(...await fetchPageEvents(url, todayStart, windowEnd));
    } catch (err) {
      // Network/abort failures on one page are soft — keep what we have.
      console.warn(`[${name}] fetch failed for ${url}: ${err.message}`);
    }
  }

  // Dedupe by event URL (fall back to title+start).
  const byKey = new Map();
  for (const ev of all) {
    const key = ev.url || `${ev.title}|${ev.start}`;
    if (!byKey.has(key)) byKey.set(key, ev);
  }
  const events = [...byKey.values()];

  if (events.length === 0) {
    console.warn(`[${name}] no event-like objects found — Meetup structure may have changed`);
  }
  return events;
}

// Standalone CLI runner
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
