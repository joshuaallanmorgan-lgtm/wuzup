// finder.mjs — Tampa Bay Event Finder (v2)
//
// What it does: fetches a list of free local event sources, pulls out their
// schema.org/Event data (the machine-readable JSON-LD that sites embed for Google),
// optionally pulls render-scraped sources (render.mjs — Creative Loafing etc.),
// loads every self-contained source module in finder/sources/*.mjs,
// fuzzy-merges duplicates across sources into a "buzz" signal, tags and scores
// every event, and writes the result to output/ (and the app's public folder).
//
// Why this approach: JSON-LD is a web standard, so extraction is robust and free —
// no AI, no paid APIs, no fragile per-site scraping. Re-runnable any time.
//
// Run:  node finder/finder.mjs
//       SKIP_RENDER=1 node finder/finder.mjs   (skip the headless-browser sources)
//       SKIP_EXTRA=1  node finder/finder.mjs   (skip the finder/sources/*.mjs modules)

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { bbox as TB_BOX, geocodeViewbox } from './cities/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'output');
const CACHE = join(HERE, 'cache');
const GEO = join(CACHE, 'geocode.json');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Pretend to be a normal browser — some sites return nothing to a bare script.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SOURCES = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tampa Bay sanity box (TB_BOX) now comes from the active city config (cities/).
const inBox = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  lat >= TB_BOX.latMin && lat <= TB_BOX.latMax &&
  lng >= TB_BOX.lngMin && lng <= TB_BOX.lngMax;

// --- fetch one page's HTML, with a timeout so a slow site can't hang the run ---
async function fetchOnce(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept': 'text/html' },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Retry transient failures (503s, timeouts) with backoff so one flaky source
// doesn't degrade the whole run.
async function fetchHtml(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchOnce(url);
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

// --- pull every <script type="application/ld+json"> block and JSON.parse it ---
function ldJsonBlocks(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Unparseable block (rare) — just skip it rather than crash the run.
    }
  }
  return out;
}

// --- walk any nested JSON-LD structure and collect anything event-shaped ---
// Handles plain Event objects, @graph wrappers, and ItemList/itemListElement
// (Eventbrite packs ~20 events into a list like that).
function collectEvents(node, out) {
  if (Array.isArray(node)) {
    for (const x of node) collectEvents(x, out);
    return;
  }
  if (node && typeof node === 'object') {
    const t = node['@type'];
    const types = Array.isArray(t) ? t : (t ? [t] : []);
    const looksLikeEvent = types.some((x) => /Event/i.test(String(x)));
    // An event has a name + a start date. That's a more reliable signal than @type alone.
    if (node.name && (node.startDate || looksLikeEvent)) {
      out.push(node);
    }
    for (const k of Object.keys(node)) {
      if (k === '@context') continue;
      collectEvents(node[k], out);
    }
  }
}

// --- normalize schema.org location (string | Place | array) into venue + address ---
function venueAddress(loc) {
  if (!loc) return { venue: null, address: null };
  if (typeof loc === 'string') return { venue: loc, address: null };
  if (Array.isArray(loc)) return venueAddress(loc[0]);
  const venue = loc.name || null;
  let address = null;
  const a = loc.address;
  if (typeof a === 'string') {
    address = a;
  } else if (a && typeof a === 'object') {
    address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
      .filter(Boolean)
      .join(', ') || null;
  }
  return { venue, address };
}

// --- pull coordinates out of schema.org location.geo when present ---
function geoOf(loc) {
  const place = Array.isArray(loc) ? loc[0] : loc;
  if (place && typeof place === 'object' && place.geo && typeof place.geo === 'object') {
    const lat = parseFloat(place.geo.latitude);
    const lng = parseFloat(place.geo.longitude);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }
  return { lat: null, lng: null };
}

// --- normalize schema.org offers (object | array) into a price + free flag ---
function priceInfo(offers) {
  if (!offers) return { price: null, currency: null, isFree: null };
  const arr = Array.isArray(offers) ? offers : [offers];
  let min = null;
  let currency = null;
  for (const o of arr) {
    if (!o || typeof o !== 'object') continue;
    currency = currency || o.priceCurrency || null;
    let p = o.price ?? o.lowPrice;
    if (p === undefined || p === null || p === '') continue;
    p = parseFloat(String(p).replace(/[^0-9.]/g, ''));
    if (!isNaN(p) && (min === null || p < min)) min = p;
  }
  const isFree = min === 0 ? true : (min > 0 ? false : null);
  return { price: min, currency, isFree };
}

// ===================== text hygiene (source-agnostic) =====================
// Some sources (I Love the Burg especially) leak HTML entities (&amp; &#8211;)
// and stray tags into titles/descriptions. Decode + strip for EVERY source.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', eacute: 'é', uuml: 'ü', ouml: 'ö', auml: 'ä',
  copy: '©', reg: '®', trade: '™', deg: '°', frac12: '½', bull: '•',
};

function decodeEntitiesOnce(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

// Alternate strip-tags / decode-entities passes: sources ship raw tags,
// escaped tags (&lt;p&gt;), and double-escaped entities (&amp;#8211;) — each
// decode pass can reveal new tags, so strip again after every decode.
function cleanText(s) {
  if (typeof s !== 'string') return null;
  let out = s;
  for (let i = 0; i < 2; i++) {
    out = decodeEntitiesOnce(out.replace(/<[^>]*>/g, ' '));
  }
  out = out.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return out || null;
}

function cleanDescription(desc) {
  let t = cleanText(desc);
  if (!t) return null;
  if (t.length > 200) t = t.slice(0, 197) + '...';
  return t;
}

// ===================== title hygiene (fixer pass, 2026-06-10) =====================
// Aggregator titles ship demo-wincing junk: ALL-CAPS SHOUTING, "- ST PETE"
// city suffixes, "Tampa Tickets" resale suffixes, trailing colons, "TBD at"
// placeholders, date ranges jammed into the name. Cleaned for EVERY source,
// BEFORE merging (normalized titles also dedupe better). Facts are never
// added — only formatting noise removed; orthography fixes are limited to an
// explicit, reviewable list.

const TITLE_CITY_SUFFIX_RE = /\s+[-–—]\s*(?:st\.?\s*pete(?:rsburg)?(?:\s+beach)?|saint petersburg|tampa|ybor(?:\s+city)?|clearwater|dunedin|largo|gulfport|pinellas park|palm harbor|safety harbor|tarpon springs|wesley chapel|brandon|riverview|seminole|bradenton|sarasota|treasure island)\s*$/i;
const TITLE_CITY_TICKETS_RE = /\s+(?:tampa|st\.?\s*pete(?:rsburg)?|clearwater)\s+tickets\s*$/i;
const TITLE_TICKETS_RE = /\s+tickets\s*$/i;
const TITLE_DATE_RANGE_RE = /\s*[-–—]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s*[-–—]\s*\d{1,2},?\s*\d{4}\s*$/i;
// stylized tokens that must survive title-casing
const TITLE_KEEP_CAPS = new Set([
  'DJ', 'DJS', 'USA', 'UK', 'VIP', 'BYOB', 'NYE', 'BBQ', 'MFA', 'EDM', 'UFC',
  'WWE', 'MMA', 'TV', 'NFL', 'NBA', 'MLB', 'NHL', 'USF', 'LGBTQ', 'LGBTQ+',
  'R&B', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XL',
]);
const TITLE_SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
// explicit orthography corrections (reviewable, idempotent)
const TITLE_FIXES = [[/\bBoh[éeè]me\b/g, 'Bohème']];

// ">85% caps and 10+ letters" = shouting, not stylization — recase it.
function smartTitleCase(t) {
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 10) return t;
  if (letters.replace(/[^A-Z]/g, '').length / letters.length <= 0.85) return t;
  const words = t.split(' ');
  return words
    .map((w, i) => {
      const core = w.replace(/[^\w&+']/g, '');
      if (TITLE_KEEP_CAPS.has(core.toUpperCase()) && core === core.toUpperCase()) return w;
      const lower = w.toLowerCase();
      if (i > 0 && i < words.length - 1 && TITLE_SMALL_WORDS.has(lower)) return lower;
      return lower.replace(/(^|[-/.])([a-z])/g, (m, p, c) => p + c.toUpperCase());
    })
    .join(' ');
}

function cleanEventTitle(raw) {
  let t = String(raw || '');
  t = t.replace(/^\s*TBD\s+at\s+/i, ''); // "TBD at Tampa Bay Lightning — ..." placeholder prefix
  t = t.replace(/\s*[:;]+\s*$/, ''); // "Movie Screening:" truncation colons
  t = t.replace(TITLE_DATE_RANGE_RE, ''); // "End of the Rainbow- June 11-21, 2026"
  t = t.replace(TITLE_CITY_TICKETS_RE, ''); // "Ye Tampa Tickets"
  t = t.replace(TITLE_TICKETS_RE, '');
  t = t.replace(TITLE_CITY_SUFFIX_RE, ''); // "KBONG & JOHNNY COSMIC - ST PETE"
  t = t.replace(/\s*[-–—]\s*artist\s*$/i, ''); // aggregator's "Ye - Artist" type suffix
  t = smartTitleCase(t.trim());
  for (const [re, fix] of TITLE_FIXES) t = t.replace(re, fix);
  t = t.trim();
  return t.length >= 2 ? t : String(raw || '');
}

function normalize(node, sourceName) {
  const { venue, address } = venueAddress(node.location);
  const { price, currency, isFree } = priceInfo(node.offers);
  const { lat, lng } = geoOf(node.location);
  let url = node.url;
  if (Array.isArray(url)) url = url[0];
  let image = node.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === 'object') image = image.url || null;
  return {
    title: cleanText(node.name),
    start: node.startDate || null,
    end: node.endDate || null,
    venue: cleanText(venue),
    address: cleanText(address),
    price,
    currency,
    isFree,
    lat,
    lng,
    url: url || null,
    image: image || null,
    description: cleanDescription(node.description),
    source: sourceName,
    staffPick: false,
    promoted: false,
    // schema.org eventAttendanceMode — Online-only events get filtered out
    // (virtual junk isn't a Tampa Bay event). Mixed/Offline pass through.
    attendanceMode: node.eventAttendanceMode ?? null,
  };
}

// Online-only per schema.org (value like "https://schema.org/OnlineEventAttendanceMode").
// MixedEventAttendanceMode does NOT match — hybrid events have a real local venue.
function isOnlineOnly(e) {
  return /OnlineEventAttendanceMode/i.test(String(e.attendanceMode || ''));
}

// ===================== Eastern-time helpers =====================

// UTC offset ('-04:00' / '-05:00') in effect in Tampa around a local datetime.
function easternOffsetFor(isoLocal) {
  const probe = new Date(String(isoLocal).slice(0, 10) + 'T12:00:00Z');
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'longOffset',
  }).formatToParts(probe).find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part?.value || '');
  return m ? m[1] : '-04:00';
}

// 'YYYY-MM-DDTHH:MM[:SS]' with no zone → append the Eastern offset so the
// timestamp is unambiguous off this machine. Anything else passes through.
function withEasternOffset(s) {
  if (typeof s !== 'string') return s || null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/);
  if (!m) return s;
  return `${m[1]}${m[2] || ':00'}${easternOffsetFor(s)}`;
}

// --- map a render.mjs event ({title,start,end,venue,address,price,isFree,url,
//     image,description,staffPick,promoted,source}) into our normalized shape ---
function normalizeRenderEvent(r) {
  if (!r || typeof r !== 'object') return null;
  let price = r.price;
  if (typeof price === 'string') price = parseFloat(price.replace(/[^0-9.]/g, ''));
  if (typeof price !== 'number' || isNaN(price)) price = null;
  return {
    title: cleanText(r.title),
    start: withEasternOffset(r.start),
    end: withEasternOffset(r.end),
    venue: cleanText(r.venue),
    address: cleanText(r.address),
    price,
    currency: price != null ? 'USD' : null,
    isFree: r.isFree === true ? true : (r.isFree === false ? false : null),
    lat: null,
    lng: null,
    url: r.url || null,
    image: r.image || null,
    description: cleanDescription(r.description),
    source: r.source || 'Creative Loafing',
    staffPick: r.staffPick === true,
    promoted: r.promoted === true,
  };
}

// --- map a finder/sources/*.mjs RawEvent into the normalized pipeline shape ---
// They may carry lat/lng (use them); price may arrive as a string (coerce);
// staffPick/promoted default false.
function normalizeModuleEvent(r, fallbackSource) {
  if (!r || typeof r !== 'object') return null;
  let price = r.price;
  if (typeof price === 'string') price = parseFloat(price.replace(/[^0-9.]/g, ''));
  if (typeof price !== 'number' || isNaN(price)) price = null;
  let lat = typeof r.lat === 'string' ? parseFloat(r.lat) : r.lat;
  let lng = typeof r.lng === 'string' ? parseFloat(r.lng) : r.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    lat = null;
    lng = null;
  }
  return {
    title: cleanText(r.title),
    start: r.start || null,
    end: r.end || null,
    venue: cleanText(r.venue),
    address: cleanText(r.address),
    price,
    currency: price != null ? 'USD' : null,
    isFree: r.isFree === true ? true : (r.isFree === false ? false : null),
    lat,
    lng,
    url: r.url || null,
    image: r.image || null,
    description: cleanDescription(r.description),
    source: r.source || fallbackSource,
    staffPick: r.staffPick === true,
    promoted: r.promoted === true,
    // Native category hint: modules MAY set category to one of our values
    // when their API provides one — respect it downstream, don't re-derive.
    category: typeof r.category === 'string' ? r.category : null,
    // Native recurring hint: a module that SEES the full occurrence series
    // (VSPC's dates[]/recurrence) marks it, because a single shipped instance
    // can never trip detectRecurring's 3-distinct-dates rule downstream.
    recurring: r.recurring === true,
  };
}

// ===================== venue-conflict guard =====================
// Render-scraped cards sometimes attach the WRONG venue (e.g. "Beetlejuice"
// listed at a Brooksville arts center while the description says it opens at
// the Straz Center). If the description names a different venue than the
// venue field, ship NO location rather than a wrong one.

const DESC_VENUE_RE = new RegExp(
  '(?:\\bat|\\bopening at|\\bheld at|\\blocated at|\\bcomes? to|\\bopens at|\\breturns to)\\s+(?:the\\s+)?' +
  "([A-Z][A-Za-z'’&.\\- ]{2,50}?(?:Center|Centre|Theatre|Theater|Arena|Hall|Stadium|Auditorium|Amphitheatre|Amphitheater|Museum|Ballroom))\\b"
);
const VENUE_GENERIC_TOKENS = new Set([
  'center', 'centre', 'theatre', 'theater', 'arena', 'hall', 'stadium',
  'auditorium', 'amphitheatre', 'amphitheater', 'museum', 'ballroom',
  'arts', 'performing', 'for',
]);

function venueConflict(e) {
  if (!e.venue || !e.description) return false;
  const m = e.description.match(DESC_VENUE_RE);
  if (!m) return false;
  const named = [...titleTokens(m[1])].filter((t) => !VENUE_GENERIC_TOKENS.has(t));
  if (!named.length) return false;
  const own = titleTokens(e.venue);
  const overlap = named.filter((t) => own.has(t)).length;
  return overlap / named.length < 0.5;
}

// ===================== fuzzy cross-source merge → buzz =====================

const STOPWORDS = new Set(['the', 'a', 'an', 'at', 'in', 'on', 'of', 'and', 'with', 'vs', 'v']);

// Title → set of meaningful lowercase tokens (punctuation stripped, stopwords dropped).
function titleTokens(title) {
  return new Set(
    String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !STOPWORDS.has(t))
  );
}

function normVenue(venue) {
  return String(venue || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Source FAMILY: "Eventbrite (Tampa p2)" and "Eventbrite (Free)" are the same
// publisher — page overlap between them is NOT independent corroboration.
// Any "(...)" suffix is a variant of the same family.
function familyOf(source) {
  return String(source || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Calendar day of an event start, preferring the literal YYYY-MM-DD in the
// string (sites publish local dates; Date.parse would shift date-only values).
function dayOf(start) {
  const m = String(start || '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(start);
  return isNaN(d) ? null : localDayStr(d);
}

function localDayStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Parse an event start into epoch ms; date-only strings become LOCAL midnight
// (Date.parse would treat them as UTC and shift the day in Tampa).
function startMs(start) {
  const s = String(start || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(s);
}

// Epoch ms at which an event is FULLY ENDED. Date-only stamps (end if present,
// else start) end at local end-of-day; a timed end is taken literally; a timed
// start with no end gets a 3-hour assumed duration. NaN if unparseable.
const ASSUMED_DURATION_MS = 3 * 3600 * 1000;
function endedAtMs(e) {
  const s = String(e.end || e.start || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d + 1).getTime();
  }
  const t = Date.parse(s);
  if (isNaN(t)) return NaN;
  return e.end ? t : t + ASSUMED_DURATION_MS;
}

// Venue tokens that say nothing about WHICH venue it is — stripped before the
// cross-family "totally different venues" veto below.
const VENUE_MERGE_GENERIC = new Set(['library', 'branch', 'regional', 'public', 'center', 'the']);

function venueMergeTokens(venue) {
  const out = new Set();
  for (const t of titleTokens(venue)) if (!VENUE_MERGE_GENERIC.has(t)) out.add(t);
  return out;
}

// Acronym venue identity: "MFA" names "Museum of Fine Arts St. Petersburg",
// "MAACM" names "Museum of the American Arts and Crafts Movement". One side is
// a single 3–5 letter token; the other's initials (stopwords dropped) start
// with it. Without this, the same museum splits the venue-equality merge.
const VENUE_ACR_STOP = new Set(['of', 'the', 'and', 'at', 'in', 'for']);
function acronymVenueMatch(a, b) {
  const isAcr = (x) => x.nVenue && !x.nVenue.includes(' ') && x.nVenue.length >= 3 && x.nVenue.length <= 5;
  const acr = isAcr(a) ? a : isAcr(b) ? b : null;
  if (!acr) return false;
  const full = acr === a ? b : a;
  if (!full.nVenue || !full.nVenue.includes(' ')) return false;
  const initials = full.nVenue
    .split(' ')
    .filter((w) => w && !VENUE_ACR_STOP.has(w))
    .map((w) => w[0])
    .join('');
  return initials.startsWith(acr.nVenue);
}

// Two same-day events are the same real-world event if their title token sets
// overlap strongly OR they're at the same (normalized) venue.
// e.g. "Red Sox vs. Tampa Bay Rays" / "Tampa Bay Rays vs. Boston Red Sox"
// → tokens {red,sox,tampa,bay,rays} vs {tampa,bay,rays,boston,red,sox} → J=5/6.
//
// SAME-FAMILY pairs (one publisher) are stricter: a publisher never lists one
// real event at two venues, so a title match alone must NOT merge "Baby Time"
// at five library branches into one card — venue equality is required too.
function sameEvent(a, b) {
  const titleMatch = jaccard(a.tokens, b.tokens) >= 0.5;
  const venueMatch = !!(a.nVenue && b.nVenue && (a.nVenue === b.nVenue || acronymVenueMatch(a, b)));
  if (a.fam && b.fam && a.fam === b.fam) {
    // Both venues null: the venue test can't separate them, and one publisher
    // listing the same title twice on one day is a duplicate (the PTSD-Matters /
    // Remix City-of-Tampa case) — let the title decide.
    if (!a.nVenue && !b.nVenue) return titleMatch;
    return titleMatch && venueMatch;
  }
  // Cross-family. Venue+day equality ALONE is not identity: it merged a
  // Scorpions tribute with a same-day afternoon tea at one brewery into a
  // chimera card (Wild Rover, 2026-06-13 — tribute title, tea description).
  // A venue merge also needs a shared significant title token, or both
  // records clocking the SAME start hour.
  if (venueMatch) {
    let shared = 0;
    for (const t of a.tokens) if (b.tokens.has(t)) shared++;
    if (shared > 0) return true;
    return a.hr != null && b.hr != null && a.hr === b.hr;
  }
  if (titleMatch) {
    // veto a title-only merge when both venues are present and share zero
    // non-generic tokens — those are two different rooms.
    if (a.vTokens.size && b.vTokens.size) {
      let shared = 0;
      for (const t of a.vTokens) if (b.vTokens.has(t)) shared++;
      if (shared === 0) return false;
    }
    return true;
  }
  // Renamed listing of one clocked event ("Safety Harbor Ghost Tour — Haunted
  // History & True Crime" vs "Safety Harbor Haunted History Tours", both 8 PM,
  // one venue-null): same start hour, the shorter stemmed title ≥70% contained
  // in the longer (≥3 significant tokens), and at most ONE venue present —
  // both-venued pairs must match on venue above ("Art After Dark" really does
  // run at two museums on the same night).
  if (a.hr != null && a.hr === b.hr && (!a.vTokens.size || !b.vTokens.size)) {
    const [small, big] = a.sTokens.size <= b.sTokens.size ? [a.sTokens, b.sTokens] : [b.sTokens, a.sTokens];
    if (small.size >= 3) {
      let inter = 0;
      for (const t of small) if (big.has(t)) inter++;
      if (inter / small.size >= 0.7) return true;
    }
  }
  return false;
}

function pickFirst(members, key) {
  for (const m of members) if (m[key] != null) return m[key];
  return null;
}

// Merge a cluster of duplicate listings into one record, keeping the richest
// value for every field. sources[] keeps every detailed listing name; buzz
// counts distinct source FAMILIES (real cross-publisher consensus).
// Literal published hour of a start string ("...T02:00..." → 2), null if date-only.
function startHourOf(s) {
  const m = String(s || '').match(/T(\d{2}):/);
  return m ? Number(m[1]) : null;
}

function mergeCluster(members) {
  const starts = members.map((m) => m.start).filter(Boolean);
  // Prefer a timed start only when the hour is plausible (06:00–23:59).
  // A lone 01:00–05:59 stamp is publisher junk (I Love the Burg's "T02:00"
  // beat Eventbrite's clean date on the Seafood Festival) — prefer a
  // date-only alternative over it when the cluster has one.
  const saneTimed = starts.find((s) => { const h = startHourOf(s); return h !== null && h >= 6; });
  const dateOnly = starts.find((s) => startHourOf(s) === null);
  const anyTimed = starts.find((s) => startHourOf(s) !== null);
  const start = saneTimed || dateOnly || anyTimed || starts[0] || null;

  let description = null;
  for (const m of members) {
    if (m.description && (!description || m.description.length > description.length)) {
      description = m.description;
    }
  }

  let price = null;
  for (const m of members) {
    if (typeof m.price === 'number' && !isNaN(m.price) && (price === null || m.price < price)) {
      price = m.price;
    }
  }
  let isFree = members.some((m) => m.isFree === true) ? true
    : (members.some((m) => m.isFree === false) ? false : null);
  if (price === 0) isFree = true;

  let lat = null, lng = null;
  for (const m of members) {
    if (m.lat != null && m.lng != null) { lat = m.lat; lng = m.lng; break; }
  }

  const sources = [...new Set(members.map((m) => m.source).filter(Boolean))];
  const families = [...new Set(sources.map(familyOf).filter(Boolean))];

  return {
    title: pickFirst(members, 'title'),
    start,
    end: pickFirst(members, 'end'),
    venue: pickFirst(members, 'venue'),
    address: pickFirst(members, 'address'),
    price,
    currency: pickFirst(members, 'currency'),
    isFree,
    lat,
    lng,
    url: pickFirst(members, 'url'),
    image: pickFirst(members, 'image'),
    description,
    source: sources[0] || null,   // primary source (v1 back-compat)
    sources,                      // every source that listed it (detailed names)
    buzz: families.length,        // cross-FAMILY consensus signal
    staffPick: members.some((m) => m.staffPick === true),
    promoted: members.some((m) => m.promoted === true),
    category: pickFirst(members, 'category'), // native module hint, if any
    recurring: members.some((m) => m.recurring === true), // native series hint
  };
}

// ===================== venue canonicalization (Sprint L4) =====================
// finder/venues.json is a GENERATED, committed canonical-venue table (built by
// finder/build-venues.mjs from real pipeline output). At merge time, any raw
// listing whose venue matches a canonical alias gets the canonical name +
// coordinates + (if missing) address. One venue, one name, one coord — so
// coordinate jitter and alias spellings ("The Dali" / "Salvador Dali Museum")
// can't split the venue-equality merge or scatter map pins.

const VENUES_FILE = join(HERE, 'venues.json');

// Aggressive-normalize a venue name into a lookup key: fold diacritics
// (Dalí → dali), lowercase, strip punctuation, drop a leading "the".
function venueKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function loadVenueTable() {
  if (!existsSync(VENUES_FILE)) return null;
  try {
    const rows = JSON.parse(readFileSync(VENUES_FILE, 'utf8'));
    if (!Array.isArray(rows)) return null;
    const byAlias = new Map();
    for (const row of rows) {
      for (const alias of [row.canonicalName, ...(row.aliases || [])]) {
        const k = venueKey(alias);
        if (k) byAlias.set(k, row);
      }
    }
    return { byAlias, size: rows.length };
  } catch {
    return null;
  }
}

// Rewrite raw listings to canonical venue identity. Returns listings touched.
function canonicalizeVenues(all, table) {
  if (!table) return 0;
  let touched = 0;
  for (const e of all) {
    const k = venueKey(e.venue);
    if (!k) continue;
    const row = table.byAlias.get(k);
    if (!row) continue;
    // An alias hit with WILDLY different own-coords is a different real place
    // sharing a name (a generic "Pier" must not teleport to St. Pete) — trust
    // the listing's own in-box coords over the table when they disagree >500m.
    const ownCoordsFar =
      e.lat != null && e.lng != null && row.lat != null && row.lng != null &&
      Math.hypot((e.lat - row.lat) * 111320, (e.lng - row.lng) * 92000) > 500;
    if (ownCoordsFar) continue;
    let changed = false;
    if (e.venue !== row.canonicalName) { e.venue = row.canonicalName; changed = true; }
    if (row.lat != null && row.lng != null && (e.lat !== row.lat || e.lng !== row.lng)) {
      e.lat = row.lat;
      e.lng = row.lng;
      changed = true;
    }
    if (!e.address && row.address) { e.address = row.address; changed = true; }
    if (changed) touched++;
  }
  return touched;
}

// ============== ongoing-exhibit cross-day dedupe (Sprint L3) ==============
// The "REALM Exhibition" class: one source publishes an exhibit as a single
// ONGOING record (multi-week start→end span) while another publishes dated
// single-day occurrence records inside that span. The same-day fuzzy merge
// can't see those — fold each dated occurrence INTO the ongoing record
// (sources/buzz union) so one exhibit = one card.

// Light stemming so exhibit/exhibition and singular/plural compare equal
// ("Voices in REALM Exhibit at FloridaRAMA" vs "REALM Exhibition & Voices in
// REALM at FloridaRAMA Gallery").
function stemToken(t) {
  let s = t.replace(/ions?$/, '');
  if (s.length < 3) s = t;
  if (s.length > 3) s = s.replace(/s$/, '');
  return s;
}

function stemmedTokens(title) {
  return new Set([...titleTokens(title)].map(stemToken));
}

const EXHIBIT_SPAN_MIN_DAYS = 14;   // multi-week = an exhibit-style run
const EXHIBIT_SPAN_MAX_DAYS = 270;  // longer = permanent installation, not a run
const EXHIBIT_TITLE_JACCARD = 0.6;

export function dedupeOngoingOccurrences(events) {
  const ongoing = [];
  for (const e of events) {
    const sd = dayOf(e.start);
    const ed = dayOf(e.end);
    if (!sd || !ed) continue;
    const span = (startMs(ed) - startMs(sd)) / 86400e3;
    if (span >= EXHIBIT_SPAN_MIN_DAYS && span <= EXHIBIT_SPAN_MAX_DAYS) {
      ongoing.push({
        e, sd, ed,
        tokens: stemmedTokens(e.title),
        vTokens: venueMergeTokens(e.venue),
        fams: new Set((e.sources || []).map(familyOf).filter(Boolean)),
      });
    }
  }
  if (!ongoing.length) return { events, folded: 0 };

  const drop = new Set();
  let folded = 0;
  for (const e of events) {
    const day = dayOf(e.start);
    if (!day || e.end || drop.has(e)) continue; // single-day records only
    for (const o of ongoing) {
      if (o.e === e || drop.has(o.e)) continue;
      if (day < o.sd || day > o.ed) continue; // must fall inside the run
      // Cross-source only: the occurrence must add a family the ongoing
      // record doesn't already carry (same-family repeats are a different
      // problem and are left alone — conservative by design).
      const eFams = (e.sources || []).map(familyOf).filter(Boolean);
      if (!eFams.length || !eFams.some((f) => !o.fams.has(f))) continue;
      if (jaccard(stemmedTokens(e.title), o.tokens) < EXHIBIT_TITLE_JACCARD) continue;
      // Venue guard: when both name a venue they must share a non-generic
      // token — otherwise it's a same-name run at a different place.
      const vt = venueMergeTokens(e.venue);
      if (vt.size && o.vTokens.size) {
        let shared = 0;
        for (const t of vt) if (o.vTokens.has(t)) shared++;
        if (shared === 0) continue;
      }
      const t = o.e;
      t.sources = [...new Set([...(t.sources || []), ...(e.sources || [])])];
      t.buzz = [...new Set(t.sources.map(familyOf).filter(Boolean))].length;
      for (const f of eFams) o.fams.add(f);
      if (!t.image && e.image) t.image = e.image;
      if (!t.url && e.url) t.url = e.url;
      if (e.description && (!t.description || e.description.length > t.description.length)) {
        t.description = e.description;
      }
      if (typeof e.price === 'number' && !isNaN(e.price) && (t.price === null || e.price < t.price)) {
        t.price = e.price;
      }
      if (e.isFree === true) t.isFree = true;
      if (t.lat == null && e.lat != null) { t.lat = e.lat; t.lng = e.lng; }
      t.staffPick = t.staffPick || e.staffPick === true;
      t.promoted = t.promoted || e.promoted === true;
      drop.add(e);
      folded++;
      break;
    }
  }
  return { events: events.filter((e) => !drop.has(e)), folded };
}

// ============== cross-day "bare echo" dedupe (fixer pass, 2026-06-10) ==============
// Aggregators (AllEvents especially) re-publish a big show as a second BARE
// record — date-only start, no description, single family — stamped ±1 day
// off: "Ye - Artist" Jun 25 echoing the timed "Ye" Jun 26 at Raymond James;
// "Josh Groban & Jennifer Hudson" Jun 18 echoing the timed Jun 19 arena show.
// Fold the bare echo into the rich record (sources/buzz union; the rich
// record's date, time and description stand). Conservative by design: the
// echo must be bare AND uncorroborated, titles must contain each other, and
// named venues must overlap. Every fold is logged by the caller.
export function dedupeBareEchoes(events) {
  const rich = [];
  for (const e of events) {
    // "rich" = the record someone actually WROTE about (description present).
    // A clocked time is corroborating but not required: the AllEvents
    // one-day-early bug also echoes date-only described listings (Rays vs.
    // D-backs Jun 25 echoing VTB's described Jun 26).
    if (!e.description) continue;
    const day = dayOf(e.start);
    if (!day) continue;
    rich.push({ e, day, tokens: stemmedTokens(e.title), vTokens: venueMergeTokens(e.venue) });
  }
  if (!rich.length) return { events, folded: [] };
  const drop = new Set();
  const folded = [];
  for (const e of events) {
    if (drop.has(e)) continue;
    if (/T\d/.test(String(e.start)) || e.description || (e.buzz || 1) > 1) continue; // bare echoes only
    const day = dayOf(e.start);
    if (!day) continue;
    const tokens = stemmedTokens(e.title);
    if (!tokens.size) continue;
    const vTokens = venueMergeTokens(e.venue);
    for (const r of rich) {
      if (r.e === e || drop.has(r.e)) continue;
      if (Math.abs(startMs(r.day) - startMs(day)) !== 86400e3) continue; // exactly ±1 day
      const [small, big] = tokens.size <= r.tokens.size ? [tokens, r.tokens] : [r.tokens, tokens];
      let inter = 0;
      for (const t of small) if (big.has(t)) inter++;
      if (inter / small.size < 0.8) continue;
      if (vTokens.size && r.vTokens.size) {
        let shared = 0;
        for (const t of vTokens) if (r.vTokens.has(t)) shared++;
        if (shared === 0) continue;
      }
      const t = r.e;
      t.sources = [...new Set([...(t.sources || []), ...(e.sources || [])])];
      t.buzz = [...new Set(t.sources.map(familyOf).filter(Boolean))].length;
      if (!t.image && e.image) t.image = e.image;
      if (!t.url && e.url) t.url = e.url;
      if (typeof e.price === 'number' && !isNaN(e.price) && (t.price === null || e.price < t.price)) {
        t.price = e.price;
      }
      if (e.isFree === true) t.isFree = true;
      if (t.lat == null && e.lat != null) { t.lat = e.lat; t.lng = e.lng; }
      drop.add(e);
      folded.push(`"${e.title}" (${day}) → "${t.title}" (${r.day})`);
      break;
    }
  }
  return { events: events.filter((e) => !drop.has(e)), folded };
}

// Cluster all raw listings by calendar day, then greedily merge matches.
function fuzzyMerge(all) {
  const byDay = new Map();
  for (const e of all) {
    const day = dayOf(e.start) || 'tbd';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({
      ...e,
      tokens: titleTokens(e.title),
      sTokens: stemmedTokens(e.title),
      nVenue: normVenue(e.venue),
      fam: familyOf(e.source),
      vTokens: venueMergeTokens(e.venue),
      hr: startHourOf(e.start),
    });
  }
  const merged = [];
  for (const list of byDay.values()) {
    const clusters = [];
    for (const e of list) {
      const hit = clusters.find((c) => c.some((m) => sameEvent(e, m)));
      if (hit) hit.push(e);
      else clusters.push([e]);
    }
    for (const c of clusters) merged.push(mergeCluster(c));
  }
  return merged;
}

// ===================== tags / score / category =====================

const BIG_TICKET_RE = /rays|buccaneers|lightning|rowdies|amalie arena|raymond james|tropicana/i;

// Dates of the current/upcoming weekend (Fri/Sat/Sun). If today IS the weekend,
// it's this weekend; otherwise the next one.
function weekendDays(now) {
  const dow = now.getDay(); // 0=Sun .. 6=Sat
  let toFri;
  if (dow === 0) toFri = -2;        // Sunday → weekend started Friday
  else if (dow === 6) toFri = -1;   // Saturday → started yesterday
  else toFri = 5 - dow;             // Mon-Fri → this coming Friday (0 on Friday)
  const days = new Set();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toFri + i);
    days.add(localDayStr(d));
  }
  return days;
}

// Venues that are music rooms — whatever is on at these is a music event.
const MUSIC_VENUE_RE = /jannus live|orpheum|crowbar|the ritz|floridian social/i;

// Word-boundary rules, tested in order. Stage-works (opera/ballet) come FIRST
// so "La Bohème" with a symphony-orchestra description lands theatre, not
// music. Music stays BEFORE sports so "Queen vs. ABBA Tribute" lands music.
// WEAK rules sit at the END (below community): they only fire when nothing
// stronger matched, so a soft signal ("w/ special guests", a brewery mention)
// can't steal an event from a confident rule.
const CATEGORY_RULES = [
  ['theatre', /\bopera\b|\bboh[eèé]me\b|\bballets?\b|\bfringe\b|\bdramatic play\b|\bplaywrights?\b/i],
  ['music', /\bconcerts?\b|\bconciertos?\b|\bbands?\b|\bdj\b|\btour\b|\borchestra\b|\bsymphony\b|\blive music\b|\balbum\b|\btribute\b|\bunplugged\b|\bacoustic\b|\blive at\b|\bkaraoke\b|\bopen mic\b|\bjazz\b|\bblues\b|\bsongwriters?\b|\bhip.?hop\b|\bvinyl\b|\bgreatest hits\b/i],
  ['sports', /\bvs\.?\b|\bgame\b|\bmatch day\b|\bgrand prix\b|\braces?\b|\broller derby\b|\bwrestling\b|\bpickleball\b/i],
  ['theatre', /\btheatre\b|\btheater\b|\bmusicals?\b|\bbroadway\b|\bcabaret\b/i],
  ['comedy', /\bcomedy\b|\bstand-?up\b|\bimprov\b|\bcomedians?\b/i],
  ['art', /\barts?\b|\bgallery\b|\bmuseum\b|\bexhibits?\b|\bexhibitions?\b|\bmurals?\b|\bcrafts?\b|\bpottery\b|\bpainting\b|\bfilms?\b|\bscreenings?\b|\bcinema\b|\bfashion\b|\brunway\b/i],
  ['market', /\bmarkets?\b|\bflea\b|\bfairs?\b|\bbazaar\b|\bexpo\b|\bvendors?\b|\bbridal\b|\bboat show\b|\btrain show\b|\bshow (?:&|and) sale\b/i],
  ['food', /\bfood\b|\bbrunch\b|\bdinner\b|\btastings?\b|\bbeer\b|\bwine\b|\bcocktails?\b|\btacos?\b|\bbbq\b|\bculinary\b|\bchefs?\b|\bbrewfests?\b/i],
  ['outdoors', /\bparks?\b|\bbeach\b|\bkayak\b|\bhikes?\b|\brun club\b|\b5k\b|\boutdoor\b|\bgardens?\b|\bnature\b|\btrails?\b|\byoga\b|\bpaddles?\b|\bpaddleboard\w*\b|\bfishing\b|\bdragon boats?\b|\bpilates\b|\bbarre\b|\bon the lawn\b|\bwho walk\b|\bwalk (?:&|and) talk\b/i],
  ['nightlife', /\bparty\b|\bclub night\b|\bburlesque\b|\bball\b|\brave\b|\bnightlife\b|\bdrag\b|\btrivia\b|\bbingo\b|\bbar crawls?\b|\bpub crawls?\b|\bspeed dating\b|\bsingles\b|\bhappy hour\b|\b(?:latin|salsa|disco|80s|90s) nights?\b|\bjuke joints?\b|\baxe throwing\b|\bthirsty thursday\b/i],
  ['family', /\bfamily\b|\bkids?\b|\bchildren\b|\btoddlers?\b|\bteens?\b|\bstory ?time\b|\b(?:father|daddy)[\s-]+daughter\b|\bmother[\s-]+son\b|\bfather[’']?s day\b|\bmother[’']?s day\b|\bback[\s-]+to[\s-]+school\b|\bvbs\b|\bvacation bible school\b/i],
  ['community', /\bmeetup\b|\bworkshops?\b|\bclass(?:es)?\b|\bclubs?\b|\blibrary\b|\bnetworking\b|\bvolunteer\b|\bseminar\b|\blectures?\b|\bbooks?\b|\bgrand opening\b|\bconferences?\b|\bauthor\b|\bfundraisers?\b|\breceptions?\b|\bmixers?\b|\bpuzzles?\b|\bgame nights?\b|\bjuneteenth\b|\bpride\b(?!\s+(?:and|&)\s+prejudice)|pridetopia|\bsummits?\b|\bsymposiums?\b|\bforums?\b|\binfo(?:rmation)? sessions?\b|\btown halls?\b|\bawareness\b|\bsupport (?:group|meeting)s?\b|\brecycling\b|\bchemical collection\b|\bcollection events?\b|\bsandbags?\b|\bclean-?ups?\b|\bcoffee (?:&|and) conversation\b|\bmingle\b|\bsocialize\b|\bentrepreneurs?\b|\bbusiness\b|\bfireside chats?\b|\blunch (?:&|and) learn\b|\bceu\b|\bwebinars?\b|\breal estate\b|\bnonprofits?\b|\bcareers?\b|\bemployers?\b|\bempower\w*\b|\bwellness\b|\breiki\b|\bsound bath\b|\btarot\b|\bheart disease\b|\bcancer\b|\bhealth\b|\bstaying safe\b|\bsafety\b|\binspections?\b|\bcyber\w*\b|\banniversar\w*\b|\bpups?\b|\bdog grooming\b|\bpaws\b|\badoptions?\b|\bstorytell\w*\b|\bcandidate forums?\b|\bcosplay\b|\bcon?ventions?\b|\bmeet (?:&|and) greet\b/i],
  // --- weak signals: last resort before the venue/source priors below ---
  // (headliner/genre/doors-showtime language also shows up in comedy and
  // theatre listings, so it must NOT outrank those rules above.)
  ['music', /\bw\/\s|\bspecial guests?\b|\bfeat\.\s|\bft\.\s|\bheadlin\w*\b|\bafrobeats?\b|\bamapiano\b|\btechno\b|\bdoors\b.{0,24}\bshowtime\b|pm doors\b/i],
  ['sports', /\bgames\b/i],
  ['food', /\bbrewer(?:y|ies)\b/i],
];

// Every category value this pipeline can emit — used to validate native hints.
const KNOWN_CATEGORIES = new Set([
  'music', 'sports', 'theatre', 'comedy', 'art', 'market', 'food',
  'outdoors', 'nightlife', 'family', 'community', 'other',
]);

// ---- strong overrides (fixer pass, 2026-06-10) -----------------------------
// High-precision rules that run FIRST, beating even native source categories:
// the data walk found AllEvents/VSPC/VTB natives misfiling pride events as
// art, a Juneteenth stretch session as sports, meet-ups as food, a seafood
// festival as music and a stage play as art. [cat, regex, unlessRegex?] —
// title-only, so a stray description word can't trip them.
const STRONG_TITLE_RULES = [
  // pride/juneteenth gatherings are community — but a "Pride Night" THEME at a
  // ballgame stays sports (the unless-guard), and Pride & Prejudice is a play.
  ['community', /\bpride\b(?!\s+(?:and|&)\s+prejudice)|pridetopia|\bjuneteenth\b/i, /\bvs\.?\b/i],
  ['community', /\bmeet[\s-]?ups?\b|\bmeet (?:&|and) greet\b|\bgame nights?\b/i],
  ['food', /\b(?:sea\s?food|tacos?|bbq|barbecue|wine|beer|brunch|chili|chowder|ribs?|oyster|shrimp|crawfish|food|culinary)[\w\s&+'-]{0,16}fest(?:ival)?s?\b/i],
  // civic facility programming — "Solid Waste Disposal Complex Tour" was
  // landing music via the \btour\b concert rule
  ['community', /\bsolid waste\b|\blandfill\b|\bwastewater\b|\bwater treatment\b|\brecycling\b/i],
  // industry networking — "Cocktails & Closings | Real Estate Mixer" was
  // landing food via \bcocktails?\b and topping the gem shelf
  ['community', /\breal estate\b/i],
  // nature programming — a sea-turtle conservation ride-along carried a
  // native "Sports & Recreation" tag
  ['outdoors', /\bsea turtles?\b|\bbirdwatch\w*\b|\bnature preserve\b|\bwildlife\b/i],
];
// title+description rules of the same rank ("Written by X … Directed by Y" is
// playbill language — "American Stage: The Hot Wing King" carried native art).
const STRONG_TEXT_RULES = [
  ['theatre', /\bwritten by\b[\s\S]{0,80}\bdirected by\b/i],
];

// ---- last-resort priors (documented as priors, not facts) ------------------
// These fire ONLY after every text rule came up empty. They encode what kind
// of programming a venue/source hosts in the overwhelming majority of cases —
// a prior, not a per-event claim.

// Touring stand-ups whose shows are listed title-only ("Jo Koy") at concert
// venues — without this they'd take the concert-venue prior and land music.
const KNOWN_COMEDIANS_RE = /\bjo koy\b|\bbert kreischer\b|\bnate bargatze\b|\bsebastian maniscalco\b|\bkatt williams\b|\bmatt rife\b|\btom segura\b|\bbill burr\b|\bgabriel iglesias\b|\bjeff dunham\b|\bnikki glaser\b|\btheo von\b|\bshane gillis\b|\bkevin hart\b|\bjim gaffigan\b|\btrevor noah\b|\bjohn mulaney\b|\bali wong\b|\btaylor tomlinson\b|\bleanne morgan\b/i;

// Concert rooms/sheds/arenas: an event here that matched NO text rule is a
// concert in practice (sports/comedy/family shows at these venues carry their
// own keywords and were caught above).
const CONCERT_VENUE_RE = /ruth eckerd|capitol theatre|bilheimer|music hall|new world (?:music hall|brewery|tampa)|zodiac live|music4life|amphitheat(?:re|er)|amalie arena|benchmark international arena|raymond james stadium|seminole hard rock|hard rock (?:event center|live)|baycare sound|coachman park/i;

// Venue-type priors, checked after the concert list so "Bilheimer Capitol
// Theatre" stays music. Sales-office "galleries" are why museum ≠ gallery here.
const VENUE_TYPE_PRIORS = [
  ['theatre', /theat(?:re|er)|playhouse/i],
  ['community', /librar|\bbooks\b|bookstore|\bchurch\b/i],
  ['art', /museum/i],
  ['nightlife', /\blounge\b/i],
];

// Source-level category priors, applied only when no text/venue rule matched.
const SOURCE_CATEGORY = {
  'WMNF 88.5': 'music',            // grassroots-music calendar by charter
  'Hillsborough Libraries': 'community',
  // Civic calendars: their unmatched residue is municipal programming
  // (collections, info sessions, campus dates) — community by definition.
  'City of Tampa': 'community',
  'City of St. Petersburg': 'community',
  'Pinellas County': 'community',
  'Univ. of Tampa': 'community',
  // A meetup with no stronger signal is, definitionally, a community gathering.
  'Meetup': 'community',
};

export function categorize(e) {
  // Strong overrides FIRST — they outrank native hints (see the rule comment).
  const title = e.title || '';
  const text = `${title} ${e.description || ''}`;
  for (const [cat, re, unless] of STRONG_TITLE_RULES) {
    if (re.test(title) && !(unless && unless.test(title))) return cat;
  }
  for (const [cat, re] of STRONG_TEXT_RULES) {
    if (re.test(text)) return cat;
  }
  // Native category from a source module's API — respect it, don't re-derive.
  // 'other' carries no information, so the text classifier still gets a shot.
  if (e.category && e.category !== 'other' && KNOWN_CATEGORIES.has(e.category)) {
    return e.category;
  }
  if (MUSIC_VENUE_RE.test(e.venue || '')) return 'music';
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  // Text gave nothing — fall through the documented priors, specific → broad.
  if (KNOWN_COMEDIANS_RE.test(e.title || '')) return 'comedy';
  // Touring-act listing convention: a title ending in "Live" is a show.
  if (/\blive!?\s*$/i.test(e.title || '')) return 'music';
  const venue = e.venue || '';
  if (CONCERT_VENUE_RE.test(venue)) return 'music';
  for (const [cat, re] of VENUE_TYPE_PRIORS) {
    if (re.test(venue)) return cat;
  }
  const hinted = SOURCE_CATEGORY[familyOf(e.source)];
  return hinted || 'other';
}

// Recurring = same normalized title+venue on >= 3 distinct dates in this pull,
// OR recurrence language in the title/description ("weekly", "every Tuesday",
// "Thursdays", "nights from ...") — series often publish only one instance.
// The weekday match REQUIRES the plural ("Thursdays", never "Thursday"):
// a bare "Thursday, June 11" date mention is not recurrence language.
const RECURRING_TEXT_RE = /\bweekly\b|\bevery (mon|tues|wednes|thurs|fri|satur|sun)days?\b|\b(mon|tues|wednes|thurs|fri|satur|sun)days\b|\bnights? from\b/i;

function detectRecurring(events) {
  const datesByKey = new Map();
  const keyOf = (e) => [...titleTokens(e.title)].sort().join(' ') + '|' + normVenue(e.venue);
  for (const e of events) {
    const k = keyOf(e);
    if (!datesByKey.has(k)) datesByKey.set(k, new Set());
    const day = dayOf(e.start);
    if (day) datesByKey.get(k).add(day);
  }
  for (const e of events) {
    e._recurring = e.recurring === true
      || (datesByKey.get(keyOf(e))?.size || 0) >= 3
      || RECURRING_TEXT_RE.test(`${e.title || ''} ${e.description || ''}`);
  }
}

// Somber gatherings (memorials, vigils, funerals) are listed honestly but
// never CELEBRATED: no staff-pick chip, no hidden-gem tag, no 🔥 framing a
// grieving community's service as a find. "Memorial Day" events are exempt.
const SOMBER_TITLE_RE = /\bmemorial(?!\s+day\b)|\bvigils?\b|\bfunerals?\b|\bcelebration of life\b|\bin loving memory\b|\bremembrance\b/i;

function tagsFor(e, todayStr, weekend) {
  const tags = [];
  const day = dayOf(e.start);
  if (day === todayStr) tags.push('tonight');
  if (day && weekend.has(day)) tags.push('weekend');
  // Already started, still running (multi-day exhibitions etc. — the alive
  // filter guarantees it hasn't ended). True start stays in the data.
  if (day && day < todayStr) tags.push('ongoing');
  if (e.isFree === true) tags.push('free');
  tags.push(e._recurring ? 'recurring' : 'one-off');
  // Sponsored (paid promotion) events get NO staff-pick treatment; somber
  // gatherings get no celebratory chip either (SOMBER_TITLE_RE).
  if (e.staffPick && !e.promoted && !SOMBER_TITLE_RE.test(e.title || '')) tags.push('staff-pick');
  return tags;
}

// Ancillary commerce sold as "events" — parking marketplaces and branded
// tailgates cross-post to every aggregator, hit buzz 3, and outranked the
// actual headliner by 50 points. Their heat is capped, never their listing.
const ANCILLARY_TITLE_RE = /\btailgreeter\b|\bevent parking\b|\bparking pass(?:es)?\b|\bshuttle service\b/i;

function hotScore(e, tags, now, megaFams) {
  let score = 20;
  score += Math.min((e.buzz - 1) * 25, 50);
  if (tags.includes('staff-pick')) score += 15;
  // Mega-family de-stack: a 700-record library system's "one-off" instances
  // are programming, not scarcity — the +10 walled storytimes above real
  // single-listing headliners. Buzz-1 events from families with > 300 records
  // in this run skip the one-off bonus (corroborated events keep it).
  const fam = familyOf((e.sources || [])[0] || e.source);
  const mega = e.buzz === 1 && megaFams && megaFams.has(fam);
  if (tags.includes('one-off') && !mega) score += 10;
  if (e.image) score += 8;
  const diff = startMs(e.start) - now.getTime();
  if (!isNaN(diff)) {
    if (diff <= 48 * 3600e3) score += 10;
    else if (diff <= 7 * 86400e3) score += 5;
  }
  if (tags.includes('free')) score += 5;
  if (ANCILLARY_TITLE_RE.test(e.title || '')) score = Math.min(score, 40);
  return Math.min(100, Math.round(score));
}

// --- pretty helpers for the human-readable output ---
function fmtPrice(e) {
  if (e.isFree === true) return 'Free';
  if (e.price > 0) return '$' + e.price + (e.currency && e.currency !== 'USD' ? ' ' + e.currency : '');
  return '—';
}
// Day heading for a start value. Uses the same local-midnight logic as
// dayOf/startMs — a bare "2026-06-13" must NOT drift to June 12 via UTC parsing.
function fmtDateKey(iso) {
  const day = dayOf(iso);
  if (!day) return 'Date TBD';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtTime(iso) {
  if (!/T\d/.test(iso)) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ============== venue identity backfills (fixer pass, 2026-06-10) ==============
// Data-internal only: every adopted fact comes from sibling records in this
// same run. Two problems solved: (1) coordless events whose venue/address has
// coord-bearing twins ("FloridaRAMA" vs "FloridaRAMA Gallery"); (2) raw street
// addresses sitting in the VENUE slot of visible cards ("10165 McKinley Dr"
// is Busch Gardens — a named twin at the same address/coords says so).

const ADDRESSY_VENUE_RE = /^\d{1,6}\s+\S+/;
const ADDR_STREET_TYPES = new Map(Object.entries({
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', av: 'ave',
  boulevard: 'blvd', blvd: 'blvd', drive: 'dr', dr: 'dr', road: 'rd', rd: 'rd',
  lane: 'ln', ln: 'ln', court: 'ct', ct: 'ct', highway: 'hwy', hwy: 'hwy',
  parkway: 'pkwy', pkwy: 'pkwy', terrace: 'ter', ter: 'ter', circle: 'cir',
  cir: 'cir', place: 'pl', pl: 'pl', way: 'way', plaza: 'plaza', trail: 'trl', trl: 'trl',
}));
const ADDR_DIRECTIONALS = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'ne', 'nw', 'se', 'sw']);

// "10165 N McKinley Drive, Tampa, FL 33612" -> "10165 mckinley dr": leading
// number + street words + normalized street type; directionals dropped (the
// SAME street publishes with and without them), street TYPE kept (2nd Ave ≠
// 2nd St). Null when it doesn't start with a street number.
function addrCore(s) {
  const toks = String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length || !/^\d+$/.test(toks[0])) return null;
  const out = [toks[0]];
  for (let i = 1; i < toks.length && out.length < 4; i++) {
    const t = toks[i];
    if (ADDR_DIRECTIONALS.has(t)) continue;
    const st = ADDR_STREET_TYPES.get(t);
    if (st) { out.push(st); break; }
    if (/^\d{5}$/.test(t)) break;
    out.push(t);
  }
  return out.length >= 2 ? out.join(' ') : null;
}

// Venue-name core for coord donation: type words stripped so "FloridaRAMA"
// and "FloridaRAMA Gallery" share a key. Donation still demands geographic
// agreement (below), so a generic core can't teleport anything.
const VENUE_TYPE_WORDS = new Set([
  'gallery', 'museum', 'theatre', 'theater', 'center', 'centre', 'hall',
  'park', 'club', 'brewery', 'brewing', 'company', 'co', 'stadium', 'arena',
  'auditorium', 'ballroom', 'lounge', 'bar', 'grill', 'cafe', 'church',
  'library', 'branch', 'the', 'at',
]);
function venueCoreKey(name) {
  const toks = normVenue(name).split(' ').filter((t) => t && !VENUE_TYPE_WORDS.has(t));
  return toks.length ? toks.join(' ') : null;
}

const COORD_AGREE_M = 1000;
const metersApart = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 92000);

// Fill missing coords from same-venue/same-address siblings. Donors for a key
// must agree within ~1 km with each other — "city hall" naming two real city
// halls disqualifies itself. Returns the number filled.
export function backfillCoords(events) {
  const donors = new Map();
  const add = (key, e) => {
    if (!key) return;
    let l = donors.get(key);
    if (!l) donors.set(key, (l = []));
    l.push({ lat: e.lat, lng: e.lng });
  };
  for (const e of events) {
    if (e.lat == null) continue;
    add(venueCoreKey(e.venue), e);
    add(addrCore(e.address), e);
  }
  let filled = 0;
  for (const e of events) {
    if (e.lat != null) continue;
    for (const key of [venueCoreKey(e.venue), addrCore(e.address)]) {
      const list = key ? donors.get(key) : null;
      if (!list) continue;
      if (!list.every((p) => metersApart(p, list[0]) <= COORD_AGREE_M)) continue;
      e.lat = list[0].lat;
      e.lng = list[0].lng;
      filled++;
      break;
    }
  }
  return filled;
}

// Rename address-as-venue records from named twins at the same address core /
// identical coords; otherwise at least trim ", City, Florida, USA" tails.
export function nameAddressVenues(events) {
  const byAddr = new Map();
  const byCoord = new Map();
  const tally = (map, key, e) => {
    if (!key) return;
    let m = map.get(key);
    if (!m) map.set(key, (m = new Map()));
    const rec = m.get(e.venue) || { n: 0, lat: e.lat, lng: e.lng };
    rec.n++;
    m.set(e.venue, rec);
  };
  for (const e of events) {
    if (!e.venue || ADDRESSY_VENUE_RE.test(e.venue)) continue;
    tally(byAddr, addrCore(e.address), e);
    if (e.lat != null) tally(byCoord, e.lat.toFixed(5) + ',' + e.lng.toFixed(5), e);
  }
  let renamed = 0;
  let trimmed = 0;
  for (const e of events) {
    if (!e.venue || !ADDRESSY_VENUE_RE.test(e.venue)) continue;
    const keys = [];
    const a1 = addrCore(e.venue);
    if (a1) keys.push([byAddr, a1]);
    const a2 = addrCore(e.address);
    if (a2 && a2 !== a1) keys.push([byAddr, a2]);
    if (e.lat != null) keys.push([byCoord, e.lat.toFixed(5) + ',' + e.lng.toFixed(5)]);
    let best = null;
    for (const [map, k] of keys) {
      const m = map.get(k);
      if (!m) continue;
      const top = [...m.entries()].sort((x, y) => y[1].n - x[1].n)[0];
      // both sides located -> they must agree geographically
      if (top[1].lat != null && e.lat != null && metersApart(top[1], e) > COORD_AGREE_M) continue;
      best = top[0];
      break;
    }
    if (best) {
      if (!e.address) e.address = e.venue; // keep the raw address as the sub-line
      e.venue = best;
      renamed++;
    } else {
      const t = e.venue.replace(
        /(?:,\s*(?:tampa|st\.?\s*pete(?:rsburg)?|saint petersburg|clearwater|dunedin|largo|gulfport|pinellas park|palm harbor|safety harbor|tarpon springs|wesley chapel|brandon|riverview|seminole|oldsmar|temple terrace|plant city|ruskin|st\.?\s*pete beach|treasure island|madeira beach))?(?:,?\s*(?:fl|florida))?(?:,?\s*(?:usa|united states(?: of america)?))?\s*$/i,
        ''
      ).replace(/[,\s]+$/, '');
      if (t && t !== e.venue) {
        e.venue = t;
        trimmed++;
      }
    }
  }
  return { renamed, trimmed };
}

// ===================== geocode cache hygiene =====================
// Junk keys ("June", "Festivals", bare numbers) and any cached value outside
// the Tampa Bay box (Key West, Argentina, Chile...) get purged so they're
// re-resolved with the hardened bounded query.
const JUNK_GEO_KEY_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december|festivals?|events?|tampa|florida|\d+)$/i;

function loadGeoCache() {
  if (!existsSync(GEO)) return {};
  let cache;
  try {
    cache = JSON.parse(readFileSync(GEO, 'utf8'));
  } catch {
    return {};
  }
  let purged = 0;
  let nullPurged = 0;
  for (const [key, val] of Object.entries(cache)) {
    if (JUNK_GEO_KEY_RE.test(key.trim()) || (val && !inBox(val.lat, val.lng))) {
      delete cache[key];
      purged++;
    } else if (val == null) {
      // null = "no result last time". Queries improve between versions, so a
      // miss must not be cached forever — give it another chance each run.
      delete cache[key];
      nullPurged++;
    }
  }
  if (purged || nullPurged) {
    console.log(`  🧹 purged ${purged} junk/out-of-area + ${nullPurged} null geocode cache entries`);
    try {
      writeFileSync(GEO, JSON.stringify(cache, null, 2));
    } catch (e) {
      // best-effort persist: transient FS contention (AV/indexer, errno -4094)
      // must not kill the run — the purged in-memory cache is what matters
      console.log(`  ⚠️ geocode cache persist skipped (${e.code || e.message})`);
    }
  }
  return cache;
}

// ===================== image sample audit (Sprint L5) =====================
// HEAD-check a small per-source-family sample of image URLs (cap ~40 requests
// total, concurrency 6). A source whose images systematically 404 ships WORSE
// than no image — the app's fallback art beats a broken <img>. Feeds the
// images-ok benchmark line. SKIP_IMGCHECK=1 skips it.

const IMG_CHECK_CAP = 40;
const IMG_MIN_BYTES = 2048; // below this it's a tracking pixel/placeholder

async function checkImage(url) {
  const probe = async (method) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ac.signal,
        headers: { 'user-agent': UA, accept: 'image/*,*/*;q=0.8' },
      });
      try { await res.body?.cancel(); } catch { /* no body to cancel */ }
      return res;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let res = await probe('HEAD');
    // Some CDNs reject HEAD outright — retry those as GET (body cancelled).
    if (!res.ok && [403, 405, 501].includes(res.status)) res = await probe('GET');
    if (res.status === 403) {
      // Cloudflare-style bot block: it refused OUR prober, which is NOT
      // evidence the image fails in a real user's browser. Count separately.
      return { ok: false, blocked: true, why: 'HTTP 403 (bot-blocked to prober)' };
    }
    if (!res.ok) return { ok: false, why: 'HTTP ' + res.status };
    const type = String(res.headers.get('content-type') || '');
    if (type && !/^image\//i.test(type)) return { ok: false, why: 'not image: ' + type.split(';')[0] };
    const len = Number(res.headers.get('content-length') || NaN);
    if (!isNaN(len) && len < IMG_MIN_BYTES) return { ok: false, why: 'tiny (' + len + ' B)' };
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? 'timeout' : (e.message || 'fetch failed') };
  }
}

async function auditImages(events) {
  const byFam = new Map();
  for (const e of events) {
    if (!e.image || !/^https?:/i.test(e.image)) continue;
    const fam = familyOf(e.source);
    if (!byFam.has(fam)) byFam.set(fam, []);
    byFam.get(fam).push(e.image);
  }
  if (!byFam.size) return [];
  const perFam = Math.max(1, Math.floor(IMG_CHECK_CAP / byFam.size));
  const sample = [];
  for (const [fam, urls] of byFam) {
    const seen = new Set();
    const step = Math.max(1, Math.ceil(urls.length / perFam));
    for (let i = 0; i < urls.length && seen.size < perFam; i += step) {
      if (!seen.has(urls[i])) {
        seen.add(urls[i]);
        sample.push({ fam, url: urls[i] });
      }
    }
  }
  const capped = sample.slice(0, IMG_CHECK_CAP);
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < capped.length) {
        const item = capped[cursor++];
        results.push({ ...item, ...(await checkImage(item.url)) });
      }
    })
  );
  return results;
}

async function main() {
  console.log('\n🔎 Tampa Bay Event Finder — pulling real events from free sources...\n');
  const all = [];
  const report = [];
  let onlineDropped = 0;

  mkdirSync(CACHE, { recursive: true });
  for (const src of SOURCES) {
    const cacheFile = join(CACHE, slugify(src.name) + '.json');
    try {
      const html = await fetchHtml(src.url);
      const blocks = ldJsonBlocks(html);
      const nodes = [];
      for (const b of blocks) collectEvents(b, nodes);
      const withDates = nodes.map((n) => normalize(n, src.name)).filter((e) => e.title && e.start);
      const events = withDates.filter((e) => !isOnlineOnly(e));
      onlineDropped += withDates.length - events.length;
      // Events from a "free" source query are free by definition (e.g. Eventbrite's
      // free filter), even though their JSON-LD omits the price.
      if (src.free) for (const e of events) { e.isFree = true; e.price = 0; }
      all.push(...events);
      writeFileSync(cacheFile, JSON.stringify(events)); // remember last good pull
      report.push({ source: src.name, found: events.length, ok: true });
      console.log(`  ✅ ${src.name.padEnd(26)} ${events.length} events`);
    } catch (e) {
      // Live fetch failed — fall back to the last good pull so one outage
      // doesn't drop the whole source.
      if (existsSync(cacheFile)) {
        try {
          const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
          all.push(...cached);
          report.push({ source: src.name, found: cached.length, ok: false, cached: true });
          console.log(`  ⚠️  ${src.name.padEnd(26)} ${cached.length} events (cached — live failed: ${e.message || e})`);
          continue;
        } catch {
          // corrupt cache — fall through to the no-cache failure path
        }
      }
      report.push({ source: src.name, found: 0, ok: false, error: String(e.message || e) });
      console.log(`  ❌ ${src.name.padEnd(26)} failed, no cache (${e.message || e})`);
    }
  }

  // Render-scraped sources (teammate's render.mjs — Creative Loafing etc.).
  // It may not exist yet and handles its own caching/failures — never let it
  // break the static pipeline.
  let renderOk = false;
  try {
    if (process.env.SKIP_RENDER !== '1') {
      const { scrapeRenderSources } = await import('./render.mjs');
      const rEvents = await scrapeRenderSources();
      const mapped = (Array.isArray(rEvents) ? rEvents : [])
        .map(normalizeRenderEvent)
        .filter((e) => e && e.title && e.start);
      // Venue-conflict guard: ship NO location rather than a wrong one.
      for (const e of mapped) {
        if (venueConflict(e)) {
          console.log(`  🧭 venue conflict — dropped location on "${e.title}" (venue "${e.venue}" vs description)`);
          e.venue = null;
          e.address = null;
        }
      }
      all.push(...mapped);
      renderOk = true;
      report.push({ source: 'Render sources', found: mapped.length, ok: true });
      console.log(`  ✅ ${'Render sources'.padEnd(26)} ${mapped.length} events`);
    } else {
      console.log(`  ⏭️  ${'Render sources'.padEnd(26)} skipped (SKIP_RENDER=1)`);
    }
  } catch (e) {
    console.log(`  ⚠️  ${'Render sources'.padEnd(26)} unavailable (${e.message || e}) — continuing without them`);
  }

  // Self-contained source modules (finder/sources/*.mjs). Each exports
  // { name, fetchEvents } and gets the same per-source resilience as the
  // static sources: cache on success, fall back to cache, else skip.
  const moduleNames = [];
  if (process.env.SKIP_EXTRA !== '1') {
    const srcDir = join(HERE, 'sources');
    let files = [];
    try {
      // "_"-prefixed files are shared helpers (e.g. _shared.mjs), not sources.
      files = readdirSync(srcDir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
    } catch {
      // no sources/ directory — nothing to load
    }
    for (const file of files) {
      const modBase = file.replace(/\.mjs$/, '');
      const cacheFile = join(CACHE, modBase + '.json');
      let label = modBase;
      try {
        const mod = await import(pathToFileURL(join(srcDir, file)).href);
        label = mod.name || modBase;
        if (typeof mod.fetchEvents !== 'function') throw new Error('module has no fetchEvents() export');
        const raw = await mod.fetchEvents();
        const mapped = (Array.isArray(raw) ? raw : [])
          .map((r) => normalizeModuleEvent(r, label))
          .filter((e) => e && e.title && e.start);
        all.push(...mapped);
        writeFileSync(cacheFile, JSON.stringify(mapped)); // remember last good pull
        moduleNames.push(label);
        report.push({ source: label, found: mapped.length, ok: true });
        console.log(`  ✅ ${label.padEnd(26)} ${mapped.length} events`);
      } catch (e) {
        if (existsSync(cacheFile)) {
          try {
            const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
            all.push(...cached);
            moduleNames.push(label);
            report.push({ source: label, found: cached.length, ok: false, cached: true });
            console.log(`  ⚠️  ${label.padEnd(26)} ${cached.length} events (cached — live failed: ${e.message || e})`);
            continue;
          } catch {
            // corrupt cache — fall through to the skip warning
          }
        }
        report.push({ source: label, found: 0, ok: false, error: String(e.message || e) });
        console.warn(`  ❌ ${label.padEnd(26)} failed, no cache — skipped (${e.message || e})`);
      }
    }
  } else {
    console.log(`  ⏭️  ${'Extra source modules'.padEnd(26)} skipped (SKIP_EXTRA=1)`);
  }

  if (onlineDropped) {
    console.log(`  🌐 dropped ${onlineDropped} online-only events (OnlineEventAttendanceMode)`);
  }

  // Title hygiene (fixer pass): de-shout, strip city/tickets/date-range
  // suffixes and placeholder prefixes on EVERY raw listing — before merging,
  // so normalized titles also dedupe better.
  let titlesCleaned = 0;
  for (const e of all) {
    const t2 = cleanEventTitle(e.title);
    if (t2 !== e.title) {
      e.title = t2;
      titlesCleaned++;
    }
  }
  if (titlesCleaned) console.log(`  ✏️  cleaned ${titlesCleaned} junk titles (caps/suffixes/colons)`);

  // Venue canonicalization (L4): rewrite alias spellings + jittery coords to
  // the committed canonical identity BEFORE merging, so venue-equality rules
  // see one venue as one venue.
  const venueTable = loadVenueTable();
  const venuesCanonicalized = canonicalizeVenues(all, venueTable);
  if (venueTable) {
    console.log(`  🏛️  venue table: ${venueTable.size} canonical venues — rewrote ${venuesCanonicalized} listings`);
  } else {
    console.log('  ⚠️  finder/venues.json missing — venue canonicalization skipped (run finder/build-venues.mjs)');
  }

  // Fuzzy cross-source merge: duplicate listings of the same real-world event
  // collapse into one record whose `buzz` = number of distinct source families.
  const rawCount = all.length;
  let events = fuzzyMerge(all);
  console.log(`  🔀 merged ${rawCount} raw listings → ${events.length} unique events`);

  // Ongoing-exhibit cross-day dedupe (L3): fold dated occurrence records from
  // other sources into the multi-week ongoing record they belong to.
  const exhibitPass = dedupeOngoingOccurrences(events);
  events = exhibitPass.events;
  const exhibitsFolded = exhibitPass.folded;
  if (exhibitsFolded) {
    console.log(`  🖼️  folded ${exhibitsFolded} dated occurrence(s) into ongoing exhibit records`);
  }

  // Cross-day bare-echo dedupe (fixer): aggregator re-publishes of one show
  // stamped ±1 day off fold into the timed, described record.
  const echoPass = dedupeBareEchoes(events);
  events = echoPass.events;
  if (echoPass.folded.length) {
    console.log(`  🪞 folded ${echoPass.folded.length} cross-day bare echo(es):`);
    for (const line of echoPass.folded) console.log(`      ${line}`);
  }

  // Schedule/listing PAGES are not events ("Tampa Bay Rowdies Home Game
  // Schedule" shipped as a Tonight card). Title-level drop, logged loud.
  const SCHEDULE_PAGE_RE = /\bschedules?\s*$/i;
  const schedDropped = events.filter((e) => SCHEDULE_PAGE_RE.test(e.title || ''));
  if (schedDropped.length) {
    events = events.filter((e) => !SCHEDULE_PAGE_RE.test(e.title || ''));
    console.log(`  🗂️  dropped ${schedDropped.length} schedule-page listing(s): ${schedDropped.map((e) => `"${e.title}"`).join(', ')}`);
  }

  // Keep upcoming events, sorted soonest first. An event stays until it has
  // fully ENDED as of run time — never ship an ended event:
  //  - date-only stamps end at local end-of-day (all-day event today survives,
  //    yesterday's is gone at midnight — no UTC drift, no grace period);
  //  - a timed start with an explicit end ends exactly then;
  //  - a timed start with NO end gets a 3-hour assumed duration, so a show
  //    that started an hour ago isn't dropped mid-set.
  const runEpoch = Date.now();
  events = events
    .filter((e) => {
      const d = endedAtMs(e);
      return !isNaN(d) && d > runEpoch;
    })
    .sort((a, b) => startMs(a.start) - startMs(b.start));

  // Coordinate sanity sweep: module/JSON-LD coords outside the Tampa Bay box
  // are junk — null them (geocoding may refill). A Creative Loafing event with
  // out-of-area coords also loses venue/address (wrong-venue listing).
  let sweptCoords = 0;
  for (const e of events) {
    if (e.lat != null && e.lng != null && !inBox(e.lat, e.lng)) {
      e.lat = null;
      e.lng = null;
      sweptCoords++;
      if ((e.sources || []).some((s) => familyOf(s) === 'Creative Loafing')) {
        e.venue = null;
        e.address = null;
      }
    }
  }
  if (sweptCoords) console.log(`  🧭 nulled ${sweptCoords} out-of-area coordinate pairs`);

  // Coord backfill from siblings (fixer): same venue-core / address-core
  // records that DO carry coords donate them (1 km donor-agreement guard) —
  // free, data-internal, and it saves Nominatim budget.
  const coordsBackfilled = backfillCoords(events);
  if (coordsBackfilled) console.log(`  🧲 backfilled ${coordsBackfilled} coordinate pairs from same-venue siblings`);

  // Fill in missing coordinates via free OpenStreetMap (Nominatim) geocoding.
  // Hardened: prefer the full street address (venue names are ambiguous —
  // they resolved to Key West, Argentina, Chile), constrain the search to the
  // Tampa Bay viewbox, and REJECT any result outside the box (coords stay
  // null instead). Cached per query key, rate-limited <= 1 req/sec.
  const geoCache = loadGeoCache();
  const geocodeKey = async (key) => {
    if (!(key in geoCache)) {
      try {
        const q = /\bfl\b|\bflorida\b/i.test(key) ? key : `${key}, Florida`;
        const res = await fetch(
          'https://nominatim.openstreetmap.org/search?format=json&limit=1' +
          '&viewbox=' + geocodeViewbox + '&bounded=1&q=' + encodeURIComponent(q),
          { headers: { 'user-agent': 'tampabay-events-finder/0.2 (mvp)' } }
        );
        const j = await res.json();
        const hit = j && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) } : null;
        geoCache[key] = hit && inBox(hit.lat, hit.lng) ? hit : null;
        writeFileSync(GEO, JSON.stringify(geoCache, null, 2));
        await sleep(1100);
      } catch {
        geoCache[key] = null;
      }
    }
    const hit = geoCache[key];
    return hit && inBox(hit.lat, hit.lng) ? hit : null;
  };
  let geocoded = 0;
  for (const e of events) {
    if (e.lat != null && e.lng != null) continue;
    const key = e.address || e.venue;
    if (!key) continue;
    const hit = await geocodeKey(key);
    if (hit) {
      e.lat = hit.lat;
      e.lng = hit.lng;
      geocoded++;
    }
  }
  if (geocoded) console.log(`  📍 geocoded ${geocoded} venues via OpenStreetMap`);

  // Second chance (fixer): the street address failed but the venue has a NAME —
  // landmark queries often succeed where abbreviated addresses fail ("The
  // Palladium Theater" vs "253 Fifth Ave. N."). Same cache, same pacing, ≤40
  // fresh lookups per run.
  let geocoded2 = 0;
  let nameBudget = 40;
  for (const e of events) {
    if (nameBudget <= 0) break;
    if (e.lat != null || !e.venue || ADDRESSY_VENUE_RE.test(e.venue)) continue;
    const city = (String(e.address || '').match(
      /(tampa|st\.?\s*petersburg|st\.?\s*pete(?:\s+beach)?|clearwater|dunedin|largo|gulfport|safety harbor|palm harbor|tarpon springs|pinellas park|wesley chapel|brandon|ybor city)/i
    ) || [])[1];
    const key = `${e.venue}, ${city || 'Tampa Bay'}, Florida`;
    if (!(key in geoCache)) nameBudget--;
    const hit = await geocodeKey(key);
    if (hit) {
      e.lat = hit.lat;
      e.lng = hit.lng;
      geocoded2++;
    }
  }
  if (geocoded2) console.log(`  📍 geocoded ${geocoded2} more via venue-name fallback queries`);

  // Address-as-venue naming (fixer): "10165 McKinley Dr" on a visible card IS
  // Busch Gardens when a named sibling shares the address/coords; renames are
  // data-internal, the rest at least lose their ", City, Florida, USA" tails.
  const venueNames = nameAddressVenues(events);
  if (venueNames.renamed || venueNames.trimmed) {
    console.log(`  🏷️  address-venues: ${venueNames.renamed} renamed from named siblings, ${venueNames.trimmed} de-tailed`);
  }

  // Recurring detection, then tags / hot score / category per event.
  detectRecurring(events);
  const now = new Date();
  const todayStr = localDayStr(now);
  const weekend = weekendDays(now);
  // Mega families (one publisher > 300 records this run — today: Hillsborough
  // Libraries at ~780) lose the one-off heat bonus on uncorroborated records;
  // see hotScore.
  const famSizes = new Map();
  for (const e of events) {
    const f = familyOf((e.sources || [])[0] || e.source);
    famSizes.set(f, (famSizes.get(f) || 0) + 1);
  }
  const megaFams = new Set([...famSizes].filter(([, n]) => n > 300).map(([f]) => f));
  if (megaFams.size) console.log(`  🏛️  mega-family one-off de-stack active for: ${[...megaFams].join(', ')}`);
  let junkTimesStripped = 0;
  events = events.map((e) => {
    const category = categorize(e);
    // Output sanity: a 01:00–05:59 start on anything that isn't nightlife is
    // a publisher's junk placeholder time — keep the date, strip the time.
    if (category !== 'nightlife') {
      const h = startHourOf(e.start);
      if (h !== null && h >= 1 && h <= 5) {
        const day = dayOf(e.start);
        if (day) {
          e.start = day;
          junkTimesStripped++;
        }
      }
    }
    const tags = tagsFor(e, todayStr, weekend);
    return {
      title: e.title,
      start: e.start,
      end: e.end,
      venue: e.venue,
      address: e.address,
      price: e.price,
      currency: e.currency,
      isFree: e.isFree,
      lat: e.lat,
      lng: e.lng,
      url: e.url,
      image: e.image,
      description: e.description,
      source: e.source,
      sources: e.sources,
      buzz: e.buzz,
      hotScore: hotScore(e, tags, now, megaFams),
      tags,
      category,
      // Paid promotion (e.g. Creative Loafing promoted strip). The UI renders
      // a "Sponsored" label off this; sponsored events get no staff-pick
      // bonus and no hidden-gem tag.
      sponsored: e.promoted === true,
    };
  });
  if (junkTimesStripped) {
    console.log(`  🕑 stripped ${junkTimesStripped} junk 01:00–05:59 start times (kept the date)`);
  }

  // Hidden gems: a curated shelf, not a census. Qualify = single-family buzz,
  // one-off, not sponsored, demonstrably cheap (free or <= $25 — unknown price
  // is NOT cheap), has something to SAY (description required — "hand-scored
  // finds" can't be blank cards), not community programming, not the 'other'
  // junk drawer, never somber gatherings, not big-ticket. Then: top by
  // hotScore with ≤ 2 per source family (a 700-record library system was 13
  // of 24 gems) and no repeated titles; if the family cap starves the shelf
  // below 5 (fast mode has 3 families total), top back up past the cap.
  const GEM_CAP = 24;
  const GEM_FAMILY_CAP = 2;
  const GEM_FLOOR = 5;
  // 3.7P-39: a job/career/hiring fair is not a "hidden gem" (it slipped the
  // category gate as 'market'). Keep in sync with app/src/lib.js NON_GEM_RE.
  const NON_GEM_RE = /\b(job|career)\s+fair\b|\bhiring\b|\b(job|career)\s+expo\b|\brecruit(?:ing|ment)?\b/i;
  const gemCandidates = events
    .filter((e) =>
      e.buzz === 1 &&
      e.tags.includes('one-off') &&
      !e.sponsored &&
      (e.isFree === true || (typeof e.price === 'number' && e.price <= 25)) &&
      e.description != null &&
      e.category !== 'community' &&
      e.category !== 'other' &&
      !SOMBER_TITLE_RE.test(e.title || '') &&
      !BIG_TICKET_RE.test(e.title || '') &&
      !NON_GEM_RE.test(e.title || ''))
    .sort((a, b) => b.hotScore - a.hotScore || startMs(a.start) - startMs(b.start));
  const gemFams = new Map();
  const gemTitles = new Set();
  const gemPicks = [];
  const gemOverflow = [];
  for (const e of gemCandidates) {
    if (gemPicks.length >= GEM_CAP) break;
    const tKey = [...titleTokens(e.title)].sort().join(' ');
    if (gemTitles.has(tKey)) continue; // two "Family Story Time" rows read broken
    const fam = familyOf((e.sources || [])[0] || e.source);
    const n = gemFams.get(fam) || 0;
    if (n >= GEM_FAMILY_CAP) {
      gemOverflow.push(e);
      continue;
    }
    gemFams.set(fam, n + 1);
    gemTitles.add(tKey);
    gemPicks.push(e);
  }
  for (const e of gemOverflow) {
    if (gemPicks.length >= GEM_FLOOR) break;
    gemPicks.push(e);
  }
  for (const e of gemPicks) e.tags.push('hidden-gem');

  // Counts used by the summary, the markdown block, and the benchmarks.
  const count = (fn) => events.filter(fn).length;
  const counts = {
    tonight: count((e) => e.tags.includes('tonight')),
    weekend: count((e) => e.tags.includes('weekend')),
    free: count((e) => e.tags.includes('free')),
    gems: count((e) => e.tags.includes('hidden-gem')),
    recurring: count((e) => e.tags.includes('recurring')),
    ongoing: count((e) => e.tags.includes('ongoing')),
    buzz2: count((e) => e.buzz >= 2),
    sponsored: count((e) => e.sponsored === true),
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'events.json'), JSON.stringify(events, null, 2));

  // Human-readable markdown, grouped by display day. Ongoing events (started
  // in the past, still running) group under TODAY so stale month-old headings
  // don't open the file; the true start stays in the data. Within each day,
  // events are listed by hotScore descending so the 1,000-event library flood
  // doesn't drown the cool stuff (nothing is hidden — just ordered).
  const allSourceNames = [...SOURCES.map((s) => s.name), ...moduleNames];
  let md = `# Tampa Bay Events — found ${events.length} real events\n\n`;
  md += `_Generated ${new Date().toLocaleString('en-US')} · sources: ${allSourceNames.join(', ')}${renderOk ? ' + render' : ''}_\n\n`;
  md += `## Summary\n\n`;
  md += `- Tonight: ${counts.tonight}\n`;
  md += `- This weekend: ${counts.weekend}\n`;
  md += `- Free: ${counts.free}\n`;
  md += `- Hidden gems: ${counts.gems}\n`;
  md += `- Recurring: ${counts.recurring}\n`;
  md += `- Ongoing (already started): ${counts.ongoing}\n`;
  md += `- Sponsored: ${counts.sponsored}\n`;
  const byDisplayDay = new Map();
  for (const e of events) {
    let day = dayOf(e.start) || 'tbd';
    if (day !== 'tbd' && day < todayStr) day = todayStr; // clamp ongoing to today
    if (!byDisplayDay.has(day)) byDisplayDay.set(day, []);
    byDisplayDay.get(day).push(e);
  }
  const dayKeys = [...byDisplayDay.keys()].sort((a, b) => {
    if (a === 'tbd') return 1;
    if (b === 'tbd') return -1;
    return a < b ? -1 : 1;
  });
  for (const dayKey of dayKeys) {
    md += `\n## ${dayKey === 'tbd' ? 'Date TBD' : fmtDateKey(dayKey)}\n\n`;
    const list = byDisplayDay.get(dayKey).slice().sort((a, b) => b.hotScore - a.hotScore);
    for (const e of list) {
      const time = fmtTime(e.start);
      const where = e.venue ? ` · ${e.venue}` : '';
      const link = e.url ? ` · [details](${e.url})` : '';
      const ongoing = e.tags.includes('ongoing') ? ` · _ongoing since ${fmtDateKey(e.start)}_` : '';
      const sponsored = e.sponsored ? ' · **SPONSORED**' : '';
      md += `- ${time ? `**${time}** — ` : ''}${e.title}${where} · _${fmtPrice(e)}_ · 🔥${e.hotScore} · buzz ${e.buzz}${sponsored}${ongoing} · (${e.source})${link}\n`;
    }
  }
  writeFileSync(join(OUT, 'events.md'), md);

  // Keep the web app's copy in sync, so re-running the finder refreshes the UI.
  const appPublic = join(HERE, '..', 'app', 'public');
  if (existsSync(appPublic)) {
    writeFileSync(join(appPublic, 'events.json'), JSON.stringify(events, null, 2));
  }

  // Image sample audit (L5) — null means skipped, [] means nothing to check.
  let imgAudit = null;
  if (process.env.SKIP_IMGCHECK !== '1') {
    imgAudit = await auditImages(events);
  }

  // Console summary + mechanism benchmarks.
  const span = events.length
    ? `${fmtDateKey(events[0].start)} → ${fmtDateKey(events[events.length - 1].start)}`
    : 'n/a';
  const mapped = events.filter((e) => e.lat != null && e.lng != null).length;
  const buzzDist = {};
  for (const e of events) buzzDist[e.buzz] = (buzzDist[e.buzz] || 0) + 1;
  const catDist = {};
  for (const e of events) catDist[e.category] = (catDist[e.category] || 0) + 1;
  const outOfBox = events.filter((e) => e.lat != null && !inBox(e.lat, e.lng)).length;
  console.log('\n──────────────────────────────────────────');
  console.log(`  TOTAL upcoming events: ${events.length}  (from ${rawCount} raw listings)`);
  console.log(`  Tonight:               ${counts.tonight}`);
  console.log(`  This weekend:          ${counts.weekend}`);
  console.log(`  Free events:           ${counts.free}`);
  console.log(`  Hidden gems:           ${counts.gems} (cap ${GEM_CAP})`);
  console.log(`  Recurring:             ${counts.recurring}`);
  console.log(`  Ongoing:               ${counts.ongoing}`);
  console.log(`  Sponsored:             ${counts.sponsored}`);
  console.log(`  Date span:             ${span}`);
  console.log(`  Mapped (has coords):   ${mapped} / ${events.length}`);
  console.log(`  Buzz distribution:     ${Object.entries(buzzDist).map(([b, n]) => `${b}:${n}`).join('  ')}`);
  console.log(`  Categories:            ${Object.entries(catDist).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join('  ')}`);
  console.log('  Benchmarks (mechanism checks):');
  if (renderOk) {
    console.log(`    ${counts.sponsored >= 1 ? '✅' : '❌'} sponsored (promoted) cltampa events captured: ${counts.sponsored} (need >= 1)`);
  } else {
    console.log(`    ⚠️  sponsored (promoted) cltampa events: render source offline`);
  }
  console.log(`    ${counts.free >= 15 ? '✅' : '❌'} free events: ${counts.free} (need >= 15)`);
  console.log(`    ${counts.buzz2 >= 3 ? '✅' : '❌'} events with buzz >= 2: ${counts.buzz2} (need >= 3 — merge works, family-collapsed)`);
  console.log(`    ${counts.gems >= 5 && counts.gems <= GEM_CAP ? '✅' : '❌'} hidden gems: ${counts.gems} (need 5..${GEM_CAP} — curated shelf)`);
  console.log(`    ${outOfBox === 0 ? '✅' : '❌'} coords outside Tampa Bay box: ${outOfBox} (need 0)`);
  const junkHourCount = events.filter((e) => {
    const h = startHourOf(e.start);
    return e.category !== 'nightlife' && h !== null && h >= 1 && h <= 5;
  }).length;
  console.log(`    ${junkHourCount === 0 ? '✅' : '❌'} non-nightlife events starting 01:00–05:59: ${junkHourCount} (need 0)`);
  const otherCount = catDist.other || 0;
  console.log(`    ${otherCount <= 40 ? '✅' : '❌'} 'other' category: ${otherCount} (need <= 40 — ratcheted from 60, current ~12)`);
  const NOISE_TITLE_RE = /procurement|RFQ|RFP|working group|evaluation meeting|regular meeting/i;
  const noiseCount = events.filter((e) => NOISE_TITLE_RE.test(e.title || '')).length;
  console.log(`    ${noiseCount === 0 ? '✅' : '❌'} gov-noise titles (procurement/RFQ/RFP/meetings): ${noiseCount} (need 0)`);
  const endedCount = events.filter((e) => !(endedAtMs(e) > runEpoch)).length;
  console.log(`    ${endedCount === 0 ? '✅' : '❌'} fully-ended events in output: ${endedCount} (need 0)`);
  const libraryCount = events.filter((e) =>
    (e.sources || []).some((s) => /librar/i.test(String(s)))).length;
  console.log(`    📚 library records in output: ${libraryCount} (was 207 pre-merge-fix; expect ~440+ on a full run — 0/low is normal with SKIP_EXTRA=1)`);
  const redBull = events.find((e) => /cliff diving|red bull/i.test(e.title));
  console.log(`    ${redBull ? '👀 present: "' + redBull.title + '"' : '✅ absent'} — Red Bull Cliff Diving (legacy canary — event ended 6/6, expected absent)`);
  // Hidden-event-class benchmark (Josh, 2026-06-10): Don't Tell Comedy sells
  // secret-location shows only through its own site — if we stop catching them,
  // the "hidden events" differentiation has regressed. Skipped in fast mode
  // (the module loader is what produces them).
  if (process.env.SKIP_EXTRA !== '1') {
    const dtc = events.filter((e) => /don'?t tell comedy/i.test(e.title));
    console.log(`    ${dtc.length ? '✅' : '❌'} Don't Tell Comedy secret shows captured: ${dtc.length} (need >= 1 — hidden-event class)`);
  }
  // Sprint L data-v3 checks.
  const vspcTimed = events.filter((e) =>
    (e.sources || []).some((s) => familyOf(s) === 'Visit St. Pete/Clearwater') &&
    /T\d{2}:/.test(String(e.start))).length;
  if (process.env.SKIP_RENDER === '1' && vspcTimed < 10) {
    console.log(`    ⚠️  VSPC events with a real start time: ${vspcTimed} (enrichment needs a render run)`);
  } else {
    console.log(`    ${vspcTimed >= 10 ? '✅' : '❌'} VSPC events with a real start time: ${vspcTimed} (need >= 10 — detail-page enrichment)`);
  }
  console.log(`    ${venueTable ? '✅' : '❌'} venue table loaded: ${venueTable ? venueTable.size : 0} canonical venues, ${venuesCanonicalized} listings rewritten`);
  console.log(`    🖼️  ongoing-exhibit occurrences folded: ${exhibitsFolded} (cross-source, cross-day)`);
  if (imgAudit === null) {
    console.log('    ⚠️  images-ok sample: skipped (SKIP_IMGCHECK=1)');
  } else {
    const imgOk = imgAudit.filter((r) => r.ok).length;
    const blocked = imgAudit.filter((r) => r.blocked).length;
    const broken = imgAudit.length - imgOk - blocked;
    const verifiable = imgOk + broken;
    const pct = verifiable ? Math.round((imgOk / verifiable) * 100) : 100;
    console.log(`    ${pct >= 90 ? '✅' : '❌'} images-ok sample: ${imgOk}/${verifiable} verifiable (${pct}% — need >= 90%; +${blocked} bot-blocked to prober, unverifiable)`);
    for (const r of imgAudit.filter((x) => !x.ok && !x.blocked)) {
      console.log(`        ✗ [${r.fam}] ${r.why} — ${r.url.slice(0, 90)}`);
    }
  }
  console.log('──────────────────────────────────────────');
  console.log(`  Wrote: finder/output/events.json  (structured)`);
  console.log(`  Wrote: finder/output/events.md    (readable)`);
  console.log('');
}

// Run only when executed directly (node finder/finder.mjs) — importing this
// module for its exported pure helpers (sims, the future smoke harness) must
// NOT kick off a pipeline run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Finder crashed:', e);
    process.exit(1);
  });
}
