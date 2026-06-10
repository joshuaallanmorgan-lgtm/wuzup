// Hillsborough County Public Library Cooperative events (libnet calendar API).
import { pathToFileURL } from 'node:url';

export const name = 'Hillsborough Libraries';

const API_BASE = 'https://hcplc.libnet.info/eeventcaldata';
const IMAGE_BASE = 'https://hcplc.libnet.info/images/events/hcplc/';
const WINDOW_DAYS = 45;
const TIMEOUT_MS = 20000;
const USER_AGENT = 'tampabay-events-finder/0.1';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', eacute: 'é',
  amp_: '&',
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

// "2026-06-10 00:00:00" -> "2026-06-10T00:00:00" (local library time)
function toIso(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : null;
}

export async function fetchEvents() {
  const today = new Date();
  const req = JSON.stringify({
    private: false,
    date: localYmd(today),
    days: 30,
    locations: '',
    ages: '',
    types: '',
  });
  const url = `${API_BASE}?event_type=0&req=${encodeURIComponent(req)}`;
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Hillsborough Libraries: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Hillsborough Libraries: unexpected response shape (not an array)');

  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS * 86400000);

  const events = [];
  for (const item of data) {
    const title = decodeEntities((item.title || '').trim());
    if (!title) continue;

    const start = toIso(item.event_start);
    if (!start) continue;
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) continue;
    if (startDate < windowStart || startDate > windowEnd) continue;

    // Skip purely-virtual programs when identifiable.
    const place = `${item.location || ''} ${item.library || ''} ${item.venues || ''}`;
    if (/\b(virtual|online|zoom|webinar)\b/i.test(place)) continue;

    const rawDesc = item.description || item.long_description || '';
    events.push({
      title,
      start,
      end: toIso(item.event_end),
      venue: item.location || item.library || null,
      address: null,
      price: 0,
      isFree: true,
      lat: null,
      lng: null,
      url: item.url ? item.url.replace(/([^:])\/\//g, '$1/') : null,
      image: item.image ? IMAGE_BASE + encodeURIComponent(item.image) : null,
      description: truncate(stripHtml(rawDesc)) || null,
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
