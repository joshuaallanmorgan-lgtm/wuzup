// City of Tampa calendar RSS (tampa.gov Drupal feed), parsed with string ops only.
import { pathToFileURL } from 'node:url';

export const name = 'City of Tampa';

const FEED_URL = 'https://www.tampa.gov/calendar/rss.xml';
const WINDOW_DAYS = 45;
const TIMEOUT_MS = 20000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Government-meeting noise filter.
const NOISE = /board|commission|committee|council|hearing|advisory|authority|task force/i;

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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

// Return the chunk of HTML belonging to one Drupal field, cut off at the next
// field--name- marker (the description concatenates many rendered fields).
function fieldBlock(html, fieldName) {
  const marker = `field--name-${fieldName}`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  let block = html.slice(idx);
  const nextField = block.indexOf('field--name-', marker.length);
  if (nextField !== -1) block = block.slice(0, nextField);
  // Drop any trailing incomplete tag left by the cut (e.g. '<div class="field').
  return block.replace(/<[^>]*$/, '');
}

// Pull start/end datetimes from the "When" field block. The description HTML
// contains several <time datetime> elements (e.g. node-created date), so we
// must anchor on the field--name-field-event-when block specifically.
function extractWhen(html) {
  const block = fieldBlock(html, 'field-event-when');
  if (!block) return [];
  return [...block.matchAll(/datetime="([^"]+)"/g)].map((m) => m[1]);
}

function spanText(html, className) {
  const m = html.match(new RegExp(`<span class="${className}"[^>]*>([\\s\\S]*?)</span>`));
  return m ? stripHtml(m[1]) || null : null;
}

export async function fetchEvents() {
  const res = await fetchWithTimeout(FEED_URL, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`City of Tampa: HTTP ${res.status}`);
  const xml = await res.text();

  const items = xml.split(/<item>/).slice(1);
  if (!items.length) {
    console.warn('City of Tampa: no <item> entries found in RSS feed');
    return [];
  }

  const today = new Date();
  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS * 86400000);

  const events = [];
  for (const item of items) {
    const title = decodeEntities((tagText(item, 'title') || '').trim());
    if (!title || NOISE.test(title)) continue;

    const link = tagText(item, 'link');
    // <description> holds XML-escaped HTML; decode once to get real markup.
    const descHtml = decodeEntities(tagText(item, 'description') || '');

    const whenDates = extractWhen(descHtml);
    const start = whenDates[0] || null;
    if (!start) continue;
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) continue;
    if (startDate < windowStart || startDate > windowEnd) continue;
    const end = whenDates[1] && !Number.isNaN(new Date(whenDates[1]).getTime()) ? whenDates[1] : null;

    // Geolocation block carries coordinates as data attributes.
    const latM = descHtml.match(/data-lat="(-?\d+(?:\.\d+)?)"/);
    const lngM = descHtml.match(/data-lng="(-?\d+(?:\.\d+)?)"/);

    // Structured address field: organization span = venue, rest = address.
    let venue = null;
    let address = null;
    const addrBlock = fieldBlock(descHtml, 'field-event-address');
    if (addrBlock) {
      venue = spanText(addrBlock, 'organization');
      const line1 = spanText(addrBlock, 'address-line1');
      const locality = spanText(addrBlock, 'locality');
      const state = spanText(addrBlock, 'administrative-area');
      const zip = spanText(addrBlock, 'postal-code');
      const parts = [line1, locality, [state, zip].filter(Boolean).join(' ')].filter(Boolean);
      if (parts.length) address = parts.join(', ');
    }
    if (!venue) {
      // Fallback: geolocation block title, when it's a place name and not raw coordinates.
      const locM = descHtml.match(/class="location-title"[^>]*>([\s\S]*?)<\/h2>/);
      if (locM) {
        const locText = stripHtml(locM[1]);
        if (locText && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(locText)) venue = locText;
      }
    }

    // Body field = actual event description.
    let description = null;
    const bodyBlock = fieldBlock(descHtml, 'body');
    if (bodyBlock) description = truncate(stripHtml(bodyBlock.replace(/^[^>]*>/, ''))) || null;

    // Explicit "Free/Open to the public?" field when present; otherwise free
    // unless a dollar amount appears in the body text.
    let price = null;
    let isFree = true;
    const freeBlock = fieldBlock(descHtml, 'field-eventisaccessibleforfree');
    const freeFlag = freeBlock ? (freeBlock.match(/field__item[^>]*>\s*(Yes|No)\s*</i) || [])[1] : null;
    const priceM = (description || '').match(/\$\s?(\d+(?:\.\d{1,2})?)/);
    if (priceM) {
      price = Number(priceM[1]);
      isFree = price === 0;
    }
    if (freeFlag) isFree = /yes/i.test(freeFlag);

    events.push({
      title,
      start,
      end,
      venue,
      address,
      price,
      isFree,
      lat: latM ? Number(latM[1]) : null,
      lng: lngM ? Number(lngM[1]) : null,
      url: link || null,
      image: null,
      description,
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
