// Pinellas County government calendar (The Events Calendar / tribe REST API).
import { pathToFileURL } from 'node:url';

export const name = 'Pinellas County';

const API_BASE = 'https://pinellas.gov/wp-json/tribe/events/v1/events';
const MAX_PAGES = 3;
const PER_PAGE = 50;
const WINDOW_DAYS = 45;
const TIMEOUT_MS = 20000;
const USER_AGENT = 'tampabay-events-finder/0.1';

// County service noise, not "events" anyone attends for fun — includes
// government-body meetings (board/commission/committee/etc.).
const NOISE = /mobile medical|vaccin|tax |permit|hearing|board|commission|committee|council|advisory|authority|task force|trust fund|co-applicant/i;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', eacute: 'é',
};

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m);
}

function stripHtml(str) {
  if (!str) return str;
  return decodeEntities(str.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function truncate(str, max = 250) {
  if (!str) return str;
  return str.length <= max ? str : str.slice(0, max - 1).trimEnd() + '…';
}

function localYmd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

export async function fetchEvents() {
  const today = new Date();
  const startParam = localYmd(today);

  const all = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(MAX_PAGES, totalPages); page++) {
    const url = `${API_BASE}?per_page=${PER_PAGE}&page=${page}&start_date=${startParam}`;
    const res = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) {
      if (page === 1) throw new Error(`Pinellas County: HTTP ${res.status}`);
      console.warn(`Pinellas County: page ${page} returned HTTP ${res.status}; using ${all.length} events fetched so far`);
      break;
    }
    const data = await res.json();
    if (!Array.isArray(data.events)) {
      if (page === 1) throw new Error('Pinellas County: unexpected response shape (no events array)');
      console.warn(`Pinellas County: page ${page} had unexpected shape; using ${all.length} events fetched so far`);
      break;
    }
    totalPages = Number(data.total_pages) || totalPages;
    all.push(...data.events);
    if (!data.next_rest_url) break;
  }

  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS * 86400000);

  const events = [];
  for (const item of all) {
    const title = decodeEntities(stripHtml(item.title || ''));
    if (!title || NOISE.test(title)) continue;

    const start = toIso(item.start_date);
    if (!start) continue;
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) continue;
    if (startDate < windowStart || startDate > windowEnd) continue;

    const venue = item.venue && typeof item.venue === 'object' && !Array.isArray(item.venue) ? item.venue : null;
    const lat = venue && venue.geo_lat != null && venue.geo_lat !== '' ? Number(venue.geo_lat) : null;
    const lng = venue && venue.geo_lng != null && venue.geo_lng !== '' ? Number(venue.geo_lng) : null;
    const { price, isFree } = parseCost(item.cost);

    events.push({
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
    });
  }
  return events;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents()
    .then((events) => {
      console.log(`count: ${events.length}`);
      for (const e of events.slice(0, 3)) console.log(JSON.stringify(e));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
