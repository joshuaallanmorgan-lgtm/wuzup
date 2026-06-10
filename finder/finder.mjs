// finder.mjs — Tampa Bay Event Finder (MVP)
//
// What it does: fetches a list of free local event sources, pulls out their
// schema.org/Event data (the machine-readable JSON-LD that sites embed for Google),
// normalizes everything into one clean list, and writes it to output/.
//
// Why this approach: JSON-LD is a web standard, so extraction is robust and free —
// no AI, no paid APIs, no fragile per-site scraping. Re-runnable any time.
//
// Run:  node finder/finder.mjs

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// Benchmark events we want to be sure the finder keeps catching (a smoke test).
// Red Bull Cliff Diving is the canonical "hidden gem" that resonated — if we ever
// stop catching it while it's live, something regressed.
const BENCHMARKS = [
  { label: 'Red Bull Cliff Diving', re: /cliff diving|red bull/i },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
// (Eventbrite packs ~40 events into a list like that).
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

function normalize(node, sourceName) {
  const { venue, address } = venueAddress(node.location);
  const { price, currency, isFree } = priceInfo(node.offers);
  const { lat, lng } = geoOf(node.location);
  let desc = node.description || null;
  if (typeof desc === 'string') {
    desc = desc.replace(/\s+/g, ' ').trim();
    if (desc.length > 200) desc = desc.slice(0, 197) + '...';
  }
  let url = node.url;
  if (Array.isArray(url)) url = url[0];
  let image = node.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === 'object') image = image.url || null;
  return {
    title: typeof node.name === 'string' ? node.name.trim() : null,
    start: node.startDate || null,
    end: node.endDate || null,
    venue,
    address,
    price,
    currency,
    isFree,
    lat,
    lng,
    url: url || null,
    image: image || null,
    description: desc,
    source: sourceName,
  };
}

// --- pretty helpers for the human-readable output ---
function fmtPrice(e) {
  if (e.isFree === true) return 'Free';
  if (e.price > 0) return '$' + e.price + (e.currency && e.currency !== 'USD' ? ' ' + e.currency : '');
  return '—';
}
function fmtDateKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 'Date TBD';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtTime(iso) {
  if (!/T\d/.test(iso)) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function main() {
  console.log('\n🔎 Tampa Bay Event Finder — pulling real events from free sources...\n');
  const all = [];
  const report = [];

  mkdirSync(CACHE, { recursive: true });
  for (const src of SOURCES) {
    const cacheFile = join(CACHE, slugify(src.name) + '.json');
    try {
      const html = await fetchHtml(src.url);
      const blocks = ldJsonBlocks(html);
      const nodes = [];
      for (const b of blocks) collectEvents(b, nodes);
      const events = nodes.map((n) => normalize(n, src.name)).filter((e) => e.title && e.start);
      // Events from a "free" source query are free by definition (e.g. Eventbrite's
      // free filter), even though their JSON-LD omits the price.
      if (src.free) for (const e of events) { e.isFree = true; e.price = 0; }
      all.push(...events);
      writeFileSync(cacheFile, JSON.stringify(events)); // remember last good pull
      report.push({ source: src.name, found: events.length, ok: true });
      console.log(`  ✅ ${src.name.padEnd(22)} ${events.length} events`);
    } catch (e) {
      // Live fetch failed — fall back to the last good pull so one outage
      // doesn't drop the whole source (and its benchmark events).
      if (existsSync(cacheFile)) {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
        all.push(...cached);
        report.push({ source: src.name, found: cached.length, ok: false, cached: true });
        console.log(`  ⚠️  ${src.name.padEnd(22)} ${cached.length} events (cached — live failed: ${e.message || e})`);
      } else {
        report.push({ source: src.name, found: 0, ok: false, error: String(e.message || e) });
        console.log(`  ❌ ${src.name.padEnd(22)} failed, no cache (${e.message || e})`);
      }
    }
  }

  // Basic dedup (exact title + day). Cross-source fuzzy dedup is a known LONG_TERM item.
  const seen = new Map();
  for (const e of all) {
    const key = (e.title || '').toLowerCase().replace(/\s+/g, ' ').trim() + '|' + (e.start || '').slice(0, 10);
    if (!seen.has(key)) seen.set(key, e);
  }

  // Keep upcoming events (from ~today on), sorted soonest first.
  const cutoff = Date.now() - 12 * 3600 * 1000;
  let events = [...seen.values()]
    .filter((e) => {
      // Keep an event until it has fully ENDED, so multi-day events still
      // running today (e.g. Red Bull Cliff Diving Jun 5-6) don't drop off.
      const d = Date.parse(e.end || e.start);
      return !isNaN(d) && d >= cutoff;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  // Fill in missing coordinates via free OpenStreetMap (Nominatim) geocoding.
  // Cached per venue so we never geocode the same place twice, and rate-limited
  // to respect Nominatim's <=1 req/sec policy.
  const geoCache = existsSync(GEO) ? JSON.parse(readFileSync(GEO, 'utf8')) : {};
  let geocoded = 0;
  for (const e of events) {
    if (e.lat != null && e.lng != null) continue;
    const key = e.venue || e.address;
    if (!key) continue;
    if (!(key in geoCache)) {
      try {
        const q = e.venue ? `${e.venue}, Florida` : e.address;
        const res = await fetch(
          'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q),
          { headers: { 'user-agent': 'tampabay-events-finder/0.1 (mvp)' } }
        );
        const j = await res.json();
        geoCache[key] = j && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) } : null;
        writeFileSync(GEO, JSON.stringify(geoCache, null, 2));
        await sleep(1100);
      } catch {
        geoCache[key] = null;
      }
    }
    const hit = geoCache[key];
    if (hit) {
      e.lat = hit.lat;
      e.lng = hit.lng;
      geocoded++;
    }
  }
  if (geocoded) console.log(`  📍 geocoded ${geocoded} venues via OpenStreetMap`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'events.json'), JSON.stringify(events, null, 2));

  // Human-readable markdown, grouped by day.
  let md = `# Tampa Bay Events — found ${events.length} real events\n\n`;
  md += `_Generated ${new Date().toLocaleString('en-US')} · sources: ${SOURCES.map((s) => s.name).join(', ')}_\n\n`;
  let lastDay = null;
  for (const e of events) {
    const day = fmtDateKey(e.start);
    if (day !== lastDay) {
      md += `\n## ${day}\n\n`;
      lastDay = day;
    }
    const time = fmtTime(e.start);
    const where = e.venue ? ` · ${e.venue}` : '';
    const link = e.url ? ` · [details](${e.url})` : '';
    md += `- ${time ? `**${time}** — ` : ''}${e.title}${where} · _${fmtPrice(e)}_ · (${e.source})${link}\n`;
  }
  writeFileSync(join(OUT, 'events.md'), md);

  // Keep the web app's copy in sync, so re-running the finder refreshes the UI.
  const appPublic = join(HERE, '..', 'app', 'public');
  if (existsSync(appPublic)) {
    writeFileSync(join(appPublic, 'events.json'), JSON.stringify(events, null, 2));
  }

  // Console summary + canary check.
  const freeCount = events.filter((e) => e.isFree === true).length;
  const span = events.length
    ? `${fmtDateKey(events[0].start)} → ${fmtDateKey(events[events.length - 1].start)}`
    : 'n/a';
  console.log('\n──────────────────────────────────────────');
  console.log(`  TOTAL upcoming events: ${events.length}`);
  console.log(`  Free events:           ${freeCount}`);
  console.log(`  Date span:             ${span}`);
  const mapped = events.filter((e) => e.lat != null && e.lng != null).length;
  console.log(`  Mapped (has coords):   ${mapped} / ${events.length}`);
  console.log('  Benchmarks (must-catch events):');
  for (const b of BENCHMARKS) {
    const hit = events.find((e) => b.re.test(e.title));
    console.log(`    ${hit ? '✅' : '❌'} ${b.label}${hit ? ' → "' + hit.title + '"' : ' — NOT FOUND'}`);
  }
  console.log('──────────────────────────────────────────');
  console.log(`  Wrote: finder/output/events.json  (structured)`);
  console.log(`  Wrote: finder/output/events.md    (readable)`);
  console.log('');
}

main().catch((e) => {
  console.error('Finder crashed:', e);
  process.exit(1);
});
