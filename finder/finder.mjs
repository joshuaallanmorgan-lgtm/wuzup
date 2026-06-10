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

// Tampa Bay sanity box: any coordinate outside this is wrong for a local event.
const TB_BOX = { latMin: 27.3, latMax: 28.6, lngMin: -83.3, lngMax: -81.9 };
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
  const venueMatch = !!(a.nVenue && b.nVenue && a.nVenue === b.nVenue);
  if (a.fam && b.fam && a.fam === b.fam) {
    // Both venues null: the venue test can't separate them, and one publisher
    // listing the same title twice on one day is a duplicate (the PTSD-Matters /
    // Remix City-of-Tampa case) — let the title decide.
    if (!a.nVenue && !b.nVenue) return titleMatch;
    return titleMatch && venueMatch;
  }
  // Cross-family: title OR venue (preserves the Red Sox/Rays cross-source
  // merge), but veto a title-only merge when both venues are present and
  // share zero non-generic tokens — those are two different rooms.
  if (venueMatch) return true;
  if (!titleMatch) return false;
  if (a.vTokens.size && b.vTokens.size) {
    let shared = 0;
    for (const t of a.vTokens) if (b.vTokens.has(t)) shared++;
    if (shared === 0) return false;
  }
  return true;
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
  };
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
      nVenue: normVenue(e.venue),
      fam: familyOf(e.source),
      vTokens: venueMergeTokens(e.venue),
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
const CATEGORY_RULES = [
  ['theatre', /\bopera\b|\bboh[eèé]me\b|\bballets?\b/i],
  ['music', /\bconcerts?\b|\bbands?\b|\bdj\b|\btour\b|\borchestra\b|\bsymphony\b|\blive music\b|\balbum\b|\btribute\b|\bunplugged\b|\bacoustic\b|\blive at\b|\bkaraoke\b|\bopen mic\b|\bjazz\b|\bblues\b|\bsongwriters?\b|\bhip.?hop\b|\bvinyl\b/i],
  ['sports', /\bvs\.?\b|\bgame\b|\bmatch day\b|\bgrand prix\b|\braces?\b|\broller derby\b|\bwrestling\b|\bpickleball\b/i],
  ['theatre', /\btheatre\b|\btheater\b|\bmusicals?\b|\bbroadway\b|\bcabaret\b/i],
  ['comedy', /\bcomedy\b|\bstand-?up\b|\bimprov\b|\bcomedians?\b/i],
  ['art', /\barts?\b|\bgallery\b|\bmuseum\b|\bexhibits?\b|\bexhibitions?\b|\bmurals?\b|\bcrafts?\b|\bpottery\b|\bpainting\b|\bfilms?\b|\bscreenings?\b|\bcinema\b/i],
  ['market', /\bmarkets?\b|\bflea\b|\bfairs?\b|\bbazaar\b|\bexpo\b|\bvendors?\b/i],
  ['food', /\bfood\b|\bbrunch\b|\bdinner\b|\btastings?\b|\bbeer\b|\bwine\b|\bcocktails?\b|\btacos?\b|\bbbq\b|\bculinary\b|\bchef\b/i],
  ['outdoors', /\bparks?\b|\bbeach\b|\bkayak\b|\bhikes?\b|\brun club\b|\b5k\b|\boutdoor\b|\bgardens?\b|\bnature\b|\btrails?\b|\byoga\b/i],
  ['nightlife', /\bparty\b|\bclub night\b|\bburlesque\b|\bball\b|\brave\b|\bnightlife\b|\bdrag\b|\btrivia\b|\bbingo\b/i],
  ['family', /\bfamily\b|\bkids?\b|\bchildren\b|\btoddlers?\b|\bteens?\b|\bstory ?time\b/i],
  ['community', /\bmeetup\b|\bworkshops?\b|\bclass(?:es)?\b|\bclubs?\b|\blibrary\b|\bnetworking\b|\bvolunteer\b|\bseminar\b|\blectures?\b|\bbook\b|\bgrand opening\b|\bconferences?\b|\bauthor\b|\bfundraisers?\b|\breceptions?\b|\bmixers?\b/i],
];

// Every category value this pipeline can emit — used to validate native hints.
const KNOWN_CATEGORIES = new Set([
  'music', 'sports', 'theatre', 'comedy', 'art', 'market', 'food',
  'outdoors', 'nightlife', 'family', 'community', 'other',
]);

// Source-level category hints, applied only when no text rule matched.
const SOURCE_CATEGORY = {
  'WMNF 88.5': 'music',            // grassroots-music calendar by charter
  'Hillsborough Libraries': 'community',
};

function categorize(e) {
  // Native category from a source module's API — respect it, don't re-derive.
  // 'other' carries no information, so the text classifier still gets a shot.
  if (e.category && e.category !== 'other' && KNOWN_CATEGORIES.has(e.category)) {
    return e.category;
  }
  if (MUSIC_VENUE_RE.test(e.venue || '')) return 'music';
  const text = `${e.title || ''} ${e.description || ''}`;
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(text)) return cat;
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
    e._recurring = (datesByKey.get(keyOf(e))?.size || 0) >= 3
      || RECURRING_TEXT_RE.test(`${e.title || ''} ${e.description || ''}`);
  }
}

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
  // Sponsored (paid promotion) events get NO staff-pick treatment.
  if (e.staffPick && !e.promoted) tags.push('staff-pick');
  return tags;
}

function hotScore(e, tags, now) {
  let score = 20;
  score += Math.min((e.buzz - 1) * 25, 50);
  if (tags.includes('staff-pick')) score += 15;
  if (tags.includes('one-off')) score += 10;
  if (e.image) score += 8;
  const diff = startMs(e.start) - now.getTime();
  if (!isNaN(diff)) {
    if (diff <= 48 * 3600e3) score += 10;
    else if (diff <= 7 * 86400e3) score += 5;
  }
  if (tags.includes('free')) score += 5;
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
    writeFileSync(GEO, JSON.stringify(cache, null, 2));
  }
  return cache;
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

  // Fuzzy cross-source merge: duplicate listings of the same real-world event
  // collapse into one record whose `buzz` = number of distinct source families.
  const rawCount = all.length;
  let events = fuzzyMerge(all);
  console.log(`  🔀 merged ${rawCount} raw listings → ${events.length} unique events`);

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

  // Fill in missing coordinates via free OpenStreetMap (Nominatim) geocoding.
  // Hardened: prefer the full street address (venue names are ambiguous —
  // they resolved to Key West, Argentina, Chile), constrain the search to the
  // Tampa Bay viewbox, and REJECT any result outside the box (coords stay
  // null instead). Cached per query key, rate-limited <= 1 req/sec.
  const geoCache = loadGeoCache();
  let geocoded = 0;
  for (const e of events) {
    if (e.lat != null && e.lng != null) continue;
    const key = e.address || e.venue;
    if (!key) continue;
    if (!(key in geoCache)) {
      try {
        const q = /\bfl\b|\bflorida\b/i.test(key) ? key : `${key}, Florida`;
        const res = await fetch(
          'https://nominatim.openstreetmap.org/search?format=json&limit=1' +
          '&viewbox=-83.3,28.6,-81.9,27.3&bounded=1&q=' + encodeURIComponent(q),
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
    if (hit && inBox(hit.lat, hit.lng)) {
      e.lat = hit.lat;
      e.lng = hit.lng;
      geocoded++;
    }
  }
  if (geocoded) console.log(`  📍 geocoded ${geocoded} venues via OpenStreetMap`);

  // Recurring detection, then tags / hot score / category per event.
  detectRecurring(events);
  const now = new Date();
  const todayStr = localDayStr(now);
  const weekend = weekendDays(now);
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
      hotScore: hotScore(e, tags, now),
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
  // is NOT cheap), not community programming, not big-ticket. Then keep only
  // the top 24 by hotScore.
  const GEM_CAP = 24;
  const gemPicks = events
    .filter((e) =>
      e.buzz === 1 &&
      e.tags.includes('one-off') &&
      !e.sponsored &&
      (e.isFree === true || (typeof e.price === 'number' && e.price <= 25)) &&
      e.category !== 'community' &&
      !BIG_TICKET_RE.test(e.title || ''))
    .sort((a, b) => b.hotScore - a.hotScore || startMs(a.start) - startMs(b.start))
    .slice(0, GEM_CAP);
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
  console.log(`    ${otherCount <= 90 ? '✅' : '❌'} 'other' category: ${otherCount} (need <= 90)`);
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
  console.log('──────────────────────────────────────────');
  console.log(`  Wrote: finder/output/events.json  (structured)`);
  console.log(`  Wrote: finder/output/events.md    (readable)`);
  console.log('');
}

main().catch((e) => {
  console.error('Finder crashed:', e);
  process.exit(1);
});
