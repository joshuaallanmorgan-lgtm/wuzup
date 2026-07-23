// OpenStreetMap Overpass — the breadth layer: 12 place classes over the Tampa
// Bay bbox. PLACES_SOURCES.md §1 S2 + Appendix A (filters VERBATIM from the
// measured scout table).
//
// POLITENESS LAW (measured, binding — Appendix A §1): queries are SERIALIZED
// with ≥10s gaps, 429/504 retried ×3 with 20/40/60s backoff, and a real
// User-Agent. At 3s gaps the scout was rate-limited on 11/15 queries; at
// 8–10s + backoff, 100% success. ~15 queries weekly is trivially polite.
//
// Always `out center;` — NEVER `out geom` (4.3 MB total vs tens of MB;
// centroids are all the app needs). Node native fetch only: the documented
// MinGW curl bug silently posts an empty body on Windows.
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { bboxOverpass, cityId } from '../cities/index.mjs';

export const name = 'OSM';

const HERE = dirname(fileURLToPath(import.meta.url));
// D1: raw Overpass caches are bbox-derived — per-city (finder/cache/<cityId>/)
const CACHE = join(HERE, '..', 'cache', cityId);

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
// Works but measured 7-weeks-stale and ~90s slow — cold fallback only, logged.
const FALLBACK_ENDPOINT = 'https://overpass.kumi.systems/api/interpreter';
const UA = 'TampaBayWeekendApp-places/0.1 (contact: joshuaallanmorgan@gmail.com)';
const BBOX = bboxOverpass; // == TB_BOX, from the active city config (cities/)
const GAP_MS = 10000;                    // ≥10s between queries — binding
const BACKOFF_MS = [20000, 40000, 60000]; // 429/504 retry ladder — binding

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// W7 review: a court element whose `name` is just the facility noun ("Skate
// Park", "Shuffleboard", "Volleyball Courts", the verbatim-OSM typo "Vollyball
// Court") is geometry, not a destination — route it to the anonymous→chip path
// so it enriches a nearby park instead of shipping as a bare-named standalone
// card. Genuinely named ones ("Bro Bowl", "Skatepark of Tampa") don't match.
const GENERIC_COURT_NAME =
  /^(tennis|basketball|volleyball|vollyball|pickleball|racquetball|racketball|shuffleboard|disc[ -]?golf|skate[ -]?board|skate[ -]?park|beach ?volleyball)( ?(court|courts|complex|area))?$/i;

// The 12 classes, filters verbatim from the spec table. `court` classes are
// geometry, not places — they join to parks as amenity chips downstream.
// `namedOnly` classes drop anonymous elements outright (anonymous piers/
// playgrounds become join candidates instead — see mapping below).
const CLASSES = [
  { id: 'parks',           filter: 'nwr["leisure"="park"]',                          cls: 'park' },
  { id: 'beaches',         filter: 'nwr["natural"="beach"]',                         cls: 'beach' },
  { id: 'nature-reserves', filter: 'nwr["leisure"="nature_reserve"]',                cls: 'preserve' },
  { id: 'protected-areas', filter: 'nwr["boundary"="protected_area"]',               cls: 'preserve', protectedFilter: true },
  { id: 'trails',          filter: 'relation["route"~"^(hiking|foot|walking)$"]',    cls: 'trail' },
  { id: 'dog-parks',       filter: 'nwr["leisure"="dog_park"]',                      cls: 'dog_park', breweryFilter: true },
  { id: 'gardens',         filter: 'nwr["leisure"="garden"]',                        cls: 'garden', namedOnly: true },
  // Coffee & Hang (Spots-full): real cafes. namedOnly — an anonymous cafe is not a
  // destination (no chipAnonymous → anonymous dropped). Paid by nature (handled
  // downstream: placeType 'cafe' forces isFree:false; never a Free tag).
  { id: 'cafes',           filter: 'nwr["amenity"="cafe"]',                          cls: 'cafe', namedOnly: true },
  { id: 'piers',           filter: 'nwr["man_made"="pier"]',                         cls: 'pier', namedOnly: true, chipAnonymous: 'pier' },
  { id: 'boat-ramps',      filter: 'nwr["leisure"="slipway"]',                       cls: 'boat_ramp' },
  { id: 'viewpoints',      filter: 'nwr["tourism"="viewpoint"]',                     cls: 'viewpoint' },
  { id: 'playgrounds',     filter: 'nwr["leisure"="playground"]',                    cls: 'playground', namedOnly: true, chipAnonymous: 'playground' },
  // class 12: sport courts — amenity-chip material (anonymous → join to parks;
  // named facilities → standalone 'courts' places)
  { id: 'tennis',          filter: 'nwr["sport"~"tennis"]["sport"!~"table_tennis"]', cls: 'courts', court: 'tennis' },
  { id: 'basketball',      filter: 'nwr["sport"~"basketball"]',                      cls: 'courts', court: 'basketball' },
  { id: 'pickleball',      filter: 'nwr["sport"~"pickleball"]',                      cls: 'courts', court: 'pickleball' },
  // W7 (Phase 3.5): deepen rec coverage — disc golf + skate parks (real
  // destinations, via the leisure=* facility tag) and three more court sports
  // (density). `amenityOnNamed` stamps the specific amenity onto the named
  // place too (so a disc-golf course/skate park carries its own chip + emoji),
  // which the original three deliberately don't — this avoids churning the
  // existing tennis/basketball/pickleball records. Region-wide bbox → multi-county.
  { id: 'disc-golf',       filter: 'nwr["leisure"="disc_golf_course"]',              cls: 'courts', court: 'disc-golf',   amenityOnNamed: true },
  // skate parks here are tagged sport=skateboard (leisure=skatepark is empty in
  // this region); dropShops filters the odd skate SHOP that shares the tag.
  { id: 'skate-parks',     filter: 'nwr["sport"~"skateboard"]',                      cls: 'courts', court: 'skate-park',  amenityOnNamed: true, dropShops: true },
  { id: 'shuffleboard',    filter: 'nwr["sport"~"shuffleboard"]',                    cls: 'courts', court: 'shuffleboard', amenityOnNamed: true },
  { id: 'volleyball',      filter: 'nwr["sport"~"volleyball"]',                      cls: 'courts', court: 'volleyball',  amenityOnNamed: true },
  { id: 'racquetball',     filter: 'nwr["sport"~"racquetball"]',                     cls: 'courts', court: 'racquetball', amenityOnNamed: true },
];

function buildQuery(filter) {
  // Template verbatim from the spec (out center, never out geom).
  return `[out:json][timeout:90];( ${filter} ${BBOX};);out center;`;
}

// The ≥10s politeness gap is enforced HERE, against the time of the previous
// actual network query — so cache-served classes don't count and can't be
// used to cheat the spacing, and retries/fallback hops inherit it too.
let lastQueryAt = 0;
async function overpassOnce(endpoint, query) {
  const sinceLast = Date.now() - lastQueryAt;
  if (lastQueryAt && sinceLast < GAP_MS) await sleep(GAP_MS - sinceLast);
  lastQueryAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    });
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// One class query: fresh RAW cache first, then the primary endpoint with the
// 429/504 backoff ladder, then one cold try at the stale fallback, then the
// per-class cache regardless of age. Throws only when everything fails.
//
// The raw fast-path matters for politeness AND iteration: the per-class
// caches hold UNtransformed Overpass elements, so a same-day re-run (e.g.
// after a filter fix) re-applies the new transform without re-querying
// Overpass at all. PLACES_LIVE=1 / OSM_LIVE=1 force the network.
const RAW_CACHE_MAX_AGE_MS = 24 * 3600e3;
export async function fetchOsmClass(cls, {
  cacheDir = CACHE,
  forceLive = process.env.PLACES_LIVE === '1'
    || process.env.OSM_LIVE === '1'
    || process.env.REQUIRE_LIVE_SOURCES === '1',
  requireLive = process.env.REQUIRE_LIVE_SOURCES === '1',
  nowMs = Date.now(),
  queryImpl = overpassOnce,
  delay = sleep,
  logger = console,
} = {}) {
  const cacheFile = join(cacheDir, `osm-${cls.id}.json`);
  if (!requireLive && !forceLive && existsSync(cacheFile)) {
    try {
      const age = nowMs - statSync(cacheFile).mtimeMs;
      if (age < RAW_CACHE_MAX_AGE_MS) {
        const elements = JSON.parse(readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(elements)) return { elements, from: `raw cache, ${(age / 3600e3).toFixed(1)}h old` };
      }
    } catch { /* unreadable cache — go live */ }
  }
  const query = buildQuery(cls.filter);
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const data = await queryImpl(ENDPOINT, query);
      if (requireLive && !Array.isArray(data?.elements)) {
        throw new Error(`osm-${cls.id} primary response has no elements array`);
      }
      if (requireLive && String(data?.remark || '').trim()) {
        throw new Error(`osm-${cls.id} primary response was partial: ${String(data.remark).trim()}`);
      }
      const elements = Array.isArray(data.elements) ? data.elements : [];
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(elements));
      return { elements, from: 'live' };
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 429 || e.status === 504 || e.name === 'AbortError';
      if (!retryable || attempt === BACKOFF_MS.length) break;
      logger.log(`    ⏳ osm-${cls.id}: ${e.message} — backing off ${BACKOFF_MS[attempt] / 1000}s (attempt ${attempt + 2})`);
      await delay(BACKOFF_MS[attempt]);
    }
  }
  if (requireLive) throw lastErr;
  try {
    logger.log(`    🧊 osm-${cls.id}: primary failed (${lastErr.message}) — trying stale fallback endpoint`);
    const data = await queryImpl(FALLBACK_ENDPOINT, query);
    const elements = Array.isArray(data.elements) ? data.elements : [];
    return { elements, from: 'fallback (kumi, possibly stale)' };
  } catch {
    if (existsSync(cacheFile)) {
      const elements = JSON.parse(readFileSync(cacheFile, 'utf8'));
      return { elements, from: 'cache' };
    }
    throw lastErr;
  }
}

const fetchClass = fetchOsmClass;

function coordsOf(el) {
  if (el.type === 'node') return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

// protect_class 21–29 are social/political designations (military zones,
// political boundaries — the Coast Guard sector class of junk); access-
// restricted areas aren't weekend destinations either.
function keepProtectedArea(tags) {
  if (/^(private|no|customers|permit)$/i.test(tags.access || '')) return false;
  if (tags.military || tags.landuse === 'military') return false;
  const pc = parseInt(tags.protect_class, 10);
  if (!Number.isNaN(pc) && pc >= 21 && pc <= 29) return false;
  return true;
}

function buildAddress(tags) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [street, tags['addr:city']].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function fetchPlaces() {
  // byId: one record per OSM element, classes unioned across the class dumps
  // (nature_reserve + protected_area co-tagging is common).
  const byId = new Map();
  const chips = []; // amenity-chip points: courts + anonymous piers/playgrounds

  for (let i = 0; i < CLASSES.length; i++) {
    const cls = CLASSES[i];
    // serialization + the ≥10s gap live inside overpassOnce (politeness law)
    const { elements, from } = await fetchClass(cls);
    console.log(`    🌍 osm-${cls.id}: ${elements.length} elements (${from})`);

    for (const el of elements) {
      const tags = el.tags || {};
      const pt = coordsOf(el);
      if (!pt) continue;
      const rawNm = typeof tags.name === 'string' ? tags.name.replace(/\s+/g, ' ').trim() : null;
      // Stage E ship: a PURE-NUMBER "name" is an OSM ref/number tag leaking into
      // name ("1200" piers, "1"/"2"/"3" courts — 19 shipped in SF's first cut, a
      // spot card titled "1200" is broken UX). Same family: MICRO-NAMES ≤2 chars
      // ("A"/"B"/"C"/"H1" — Alameda Marina berth refs; surfaced by the ship-gate
      // regen). Treat both as ANONYMOUS: the element flows into the same
      // namedOnly/court/chip handling as a nameless one (honest — we don't
      // fabricate "Pier 1200"; if the ref IS the real name, the source should
      // say so in words somewhere we can verify).
      const nm = rawNm && (/^\d+$/.test(rawNm) || rawNm.length <= 2) ? null : rawNm;

      // Courts are geometry, not places: anonymous → chip; named facilities
      // (tennis centers, pickleball barns) DO ship as standalone courts places.
      // School/academy/HOA courts are restricted-access, not public
      // destinations — this branch runs before the general filter below, so
      // it needs its own copy (IMG Academy slipped through here).
      if (cls.court) {
        // a real name → standalone 'courts' place; anonymous OR a bare facility
        // noun ("Skate Park", "Vollyball Court") → amenity chip that joins a park
        const generic = nm && GENERIC_COURT_NAME.test(nm.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim());
        if (nm && !generic) {
          if (!/\bschool\b|\bacademy\b|\bhoa\b/i.test(nm) && !(cls.dropShops && tags.shop)) {
            addPlace(byId, el, tags, pt, nm, 'courts');
            // W7: stamp the specific amenity onto the named place (new classes
            // only — keeps the original tennis/basketball/pickleball untouched)
            if (cls.amenityOnNamed) {
              const rec = byId.get(`${el.type}/${el.id}`);
              if (rec && !rec.amenities.includes(cls.court)) rec.amenities.push(cls.court);
            }
          }
        } else {
          chips.push({ amenityOnly: true, amenity: cls.court, lat: pt.lat, lng: pt.lng, source: name });
        }
        continue;
      }
      if (!nm) {
        // Anonymous geometry: piers/playgrounds become join candidates
        // (never standalone places); everything else anonymous is dropped —
        // the named-only law for gardens lives here too (no chipAnonymous).
        if (cls.chipAnonymous) {
          chips.push({ amenityOnly: true, amenity: cls.chipAnonymous, lat: pt.lat, lng: pt.lng, source: name });
        }
        continue;
      }
      // Dog-friendly taprooms tagged leisure=dog_park are bars, not parks.
      // The live offenders carry NO craft/amenity tag (Two Shepherds is
      // access=private + website; Pinellas Ale Works is building=retail), so
      // the co-tag test alone is dead — also drop commercial buildings,
      // customer-only access, and brewery-named elements.
      if (cls.breweryFilter && (
        tags.craft || tags.amenity ||
        /^(private|customers)$/i.test(tags.access || '') ||
        /^(retail|commercial)$/i.test(tags.building || '') ||
        /brew|taproom|tap room|ale works/i.test(nm)
      )) continue;
      // Generic-grade pier names ("Dock B"…"Dock NT") and Coast Guard piers
      // are not destinations — demote to join candidates like the anonymous.
      if (cls.cls === 'pier' && /^dock\b|coast guard/i.test(nm)) {
        chips.push({ amenityOnly: true, amenity: 'pier', lat: pt.lat, lng: pt.lng, source: name });
        continue;
      }
      // Schools, academies and HOA facilities are restricted-access, not
      // public weekend destinations (IMG Academy, HOA rec fields…).
      if (/\bschool\b|\bacademy\b|\bhoa\b/i.test(nm)) continue;
      if (cls.protectedFilter && !keepProtectedArea(tags)) continue;
      addPlace(byId, el, tags, pt, nm, cls.cls);
    }
  }

  return [...byId.values(), ...chips];
}

function addPlace(byId, el, tags, pt, nm, cls) {
  const key = `${el.type}/${el.id}`;
  let rec = byId.get(key);
  if (!rec) {
    rec = {
      name: nm,
      lat: pt.lat,
      lng: pt.lng,
      classes: [],
      amenities: [],
      source: name,
      osm: { type: el.type, id: el.id },
      osmTagCount: Object.keys(tags).length, // hidden-scoring maintained-floor input
    };
    if (tags.opening_hours) rec.hours = tags.opening_hours;
    const url = tags.website || tags['contact:website'];
    if (url) rec.url = url;
    const phone = tags.phone || tags['contact:phone'];
    if (phone) rec.phone = phone;
    if (tags.brand) rec.brand = tags.brand;
    if (tags['brand:wikidata']) rec.brandWikidata = tags['brand:wikidata'];
    if (tags.operator) rec.operator = tags.operator;
    const addr = buildAddress(tags);
    if (addr) rec.address = addr;
    if (tags.wikidata) rec.wikidata = tags.wikidata;
    if (tags.wikidata || tags.wikipedia) rec.hasWiki = true; // inverse-fame signal
    // fee=* : "no" → free; "yes" → paid; any other value is the amount.
    if (tags.fee === 'no') rec.isFree = true;
    else if (tags.fee === 'yes') rec.isFree = false;
    else if (tags.fee) { rec.isFree = false; rec.fee = tags.fee; }
    if (tags.charge && !rec.fee) rec.fee = tags.charge;
    if (tags.wheelchair === 'yes') rec.amenities.push('ada');
    if (tags.dog === 'yes' || tags.dogs === 'yes') rec.amenities.push('dogs-allowed');
    // cafe-relevant OSM amenities (generic — present mostly on amenity=cafe)
    if (tags.outdoor_seating === 'yes') rec.amenities.push('outdoor-seating');
    if (['yes', 'wlan', 'free'].includes(tags.internet_access) || ['yes', 'free'].includes(tags.wifi)) rec.amenities.push('wifi');
    if (tags.takeaway === 'yes' || tags.takeaway === 'only') rec.amenities.push('takeaway');
    byId.set(key, rec);
  }
  if (!rec.classes.includes(cls)) rec.classes.push(cls);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Full self-test does 14 polite serialized queries — expect ~3 minutes.
  fetchPlaces()
    .then((all) => {
      const places = all.filter((p) => !p.amenityOnly);
      const chips = all.length - places.length;
      console.log(`named places: ${places.length}, amenity-chip points: ${chips}`);
      console.log(`with hours: ${places.filter((p) => p.hours).length}, with wiki: ${places.filter((p) => p.hasWiki).length}`);
      for (const p of places.slice(0, 3)) console.log(JSON.stringify(p));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
