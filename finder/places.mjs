// places.mjs — Tampa Bay Places Finder (Sprint R2)
//
// What it does: loads every self-contained source module in
// finder/places-sources/*.mjs (two-backbone architecture: government ArcGIS
// layers for truth — hours, amenity booleans, fees, descriptions — and OSM
// Overpass for breadth), merges duplicates across sources with a
// grid-blocked, edit-tolerant name + spatial-gate clusterer, scores a capped
// hidden-spots shelf, and writes finder/output/places.json + places.md and
// the app's copy (app/public/places.json — the second lazy fetch; NEVER
// concatenated into the events norm).
//
// Structural clone of finder.mjs's loader/cache/benchmark conventions; the
// build spec is PLACES_SOURCES.md (schema §2, merge rules §3, benchmarks §4,
// hidden scoring §5).
//
// Run:  node finder/places.mjs
//       PLACES_LIVE=1 node finder/places.mjs        (ignore fresh caches, force live)
//       PLACES_MAX_CACHE_H=168 node finder/places.mjs (widen the cache window)
//
// Refresh cadence: places change slowly — weekly is plenty (per-source caches
// under 24h serve re-runs instantly; the weekly cron always goes live).

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { enrichPlacesWithImages } from './places-images.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'output');
const CACHE = join(HERE, 'cache');
const SRC_DIR = join(HERE, 'places-sources');

// ---- shared primitives, copied from finder.mjs (keep in sync) -------------
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Tampa Bay sanity box: any coordinate outside this is wrong for a local place.
const TB_BOX = { latMin: 27.3, latMax: 28.6, lngMin: -83.3, lngMax: -81.9 };
const inBox = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  lat >= TB_BOX.latMin && lat <= TB_BOX.latMax &&
  lng >= TB_BOX.lngMin && lng <= TB_BOX.lngMax;

const STOPWORDS = new Set(['the', 'a', 'an', 'at', 'in', 'on', 'of', 'and', 'with', 'vs', 'v']);
const metersApart = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 92000);

// ===================== edit-tolerant name matching (§3.2) ===================
// Authoritative data carries typos (the county spells its own preserve with an
// o/e swap) plus trailing spaces, case dupes, "St."/"Saint" variants and
// designator-suffix variants (Park / Preserve / County Park / State Park).
// Name match is REQUIRED for every merge — proximity alone never merges
// (the adjacent-destination caution, §3.5).

// Ordered, folded, stopword-free tokens of a place name.
function nameTokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => (t === 'saint' ? 'st' : t)) // St./Saint folding
    .filter((t) => t && !STOPWORDS.has(t));
}

// Trailing designator tokens say WHAT a place is, not WHICH place it is —
// dropped from the END before comparing (never below one remaining token).
const DESIGNATORS = new Set(['park', 'parks', 'preserve', 'county', 'state', 'recreation', 'area', 'reserve']);
function stripDesignators(tokens) {
  const out = tokens.slice();
  while (out.length > 1 && DESIGNATORS.has(out[out.length - 1])) out.pop();
  return out;
}

// Per-token tolerance: edit distance ≤ 1, but only for tokens long enough
// that a one-letter slip is a typo, not a different word ("weeden"/"weedon"
// yes; "bay"/"day" never). Numeric tokens are never fuzzy.
function lev1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; }
    else if (la > lb) i++;
    else j++;
  }
  return edits + (la - i) + (lb - j) <= 1;
}
function tokenEq(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  return lev1(a, b);
}

// Greedy tolerant overlap: exact pairs first, then edit-1 pairs.
function tolerantOverlap(aArr, bArr) {
  const bUsed = new Array(bArr.length).fill(false);
  const aUsed = new Array(aArr.length).fill(false);
  let inter = 0;
  for (let i = 0; i < aArr.length; i++) {
    const j = bArr.findIndex((t, k) => !bUsed[k] && t === aArr[i]);
    if (j >= 0) { aUsed[i] = true; bUsed[j] = true; inter++; }
  }
  for (let i = 0; i < aArr.length; i++) {
    if (aUsed[i]) continue;
    const j = bArr.findIndex((t, k) => !bUsed[k] && tokenEq(aArr[i], t));
    if (j >= 0) { aUsed[i] = true; bUsed[j] = true; inter++; }
  }
  return inter;
}
function tolerantJaccard(aArr, bArr) {
  if (!aArr.length || !bArr.length) return 0;
  const inter = tolerantOverlap(aArr, bArr);
  return inter / (aArr.length + bArr.length - inter);
}

// Name-match confidence: 'strong' (designator-stripped tolerant equality on
// ≥2 tokens, or tolerant Jaccard ≥ 0.75) gets the 2.5 km gate — Fort De
// Soto-sized parks put a gov entrance point and an OSM centroid far apart.
// 'fuzzy' (tolerant Jaccard ≥ 0.5, or one-token stripped equality) gets 1 km.
function nameMatchLevel(a, b) {
  const eqLen = a.stripped.length === b.stripped.length &&
    tolerantOverlap(a.stripped, b.stripped) === a.stripped.length;
  if (eqLen && a.stripped.length >= 2) return 'strong';
  const j = tolerantJaccard(a.stripped, b.stripped);
  if (j >= 0.75) return 'strong';
  if (j >= 0.5 || eqLen) return 'fuzzy';
  return null;
}

const GATE_M = { strong: 2500, fuzzy: 1000 };

// ===================== source ranking (§3.4) ================================
// Government beats OSM for hours/amenities/address/url; the order below is
// richness-ranked for tie-breaks among gov layers.
const GOV_ORDER = [
  'Pinellas Park Points',
  'Tampa Parks',
  'FDEP State Parks',
  'FWC Boat Ramps',
  'SWFWMD Recreation',
  'Hillsborough County Parks',
];
const srcRank = (s) => {
  const i = GOV_ORDER.indexOf(s);
  return i >= 0 ? i : 50; // OSM (and anything unknown) ranks after government
};
const isGov = (s) => GOV_ORDER.includes(s);

// ===================== schema v1 vocabulary =================================
const PLACETYPE_ORDER = ['park', 'preserve', 'beach', 'trail', 'dog_park', 'garden', 'pier', 'boat_ramp', 'playground', 'viewpoint', 'courts'];
function placeTypeOf(classes) {
  for (const t of PLACETYPE_ORDER) if (classes.includes(t)) return t;
  return classes[0] || 'park';
}
// Singular category into the app's 12-category taxonomy (Phase-2 decision).
function categoryOf(placeType) {
  if (placeType === 'courts') return 'sports';
  if (placeType === 'playground') return 'family';
  return 'outdoors';
}

// ===================== module loader (finder.mjs pattern) ===================
// Per-source JSON cache with TWO jobs: (1) freshness fast-path — a cache
// younger than PLACES_MAX_CACHE_H (default 24h) serves the run without a
// network call, so re-runs are instant and identical; (2) fall-back-on-failure
// — a live failure of any age falls back to the last good pull.
const MAX_CACHE_AGE_MS = (Number(process.env.PLACES_MAX_CACHE_H) || 24) * 3600e3;
const FORCE_LIVE = process.env.PLACES_LIVE === '1';

async function loadSources() {
  const raws = [];
  const report = [];
  let files = [];
  try {
    files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
  } catch {
    // no places-sources/ directory — nothing to load
  }
  mkdirSync(CACHE, { recursive: true });
  for (const file of files) {
    const modBase = file.replace(/\.mjs$/, '');
    const cacheFile = join(CACHE, `places-${modBase}.json`);
    let label = modBase;
    // freshness fast-path
    if (!FORCE_LIVE && existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
        const age = Date.now() - Date.parse(cached.fetchedAt || 0);
        if (Array.isArray(cached.places) && age < MAX_CACHE_AGE_MS) {
          raws.push(...cached.places);
          label = cached.source || modBase;
          report.push({ source: label, found: cached.places.length, ok: true, cached: 'fresh' });
          console.log(`  💾 ${label.padEnd(26)} ${cached.places.length} places (cache, ${(age / 3600e3).toFixed(1)}h old)`);
          continue;
        }
      } catch { /* unreadable cache — go live */ }
    }
    try {
      const mod = await import(pathToFileURL(join(SRC_DIR, file)).href);
      label = mod.name || modBase;
      if (typeof mod.fetchPlaces !== 'function') throw new Error('module has no fetchPlaces() export');
      const fetched = await mod.fetchPlaces();
      const list = Array.isArray(fetched) ? fetched : [];
      raws.push(...list);
      writeFileSync(cacheFile, JSON.stringify({ fetchedAt: new Date().toISOString(), source: label, places: list }));
      report.push({ source: label, found: list.length, ok: true });
      console.log(`  ✅ ${label.padEnd(26)} ${list.length} places`);
    } catch (e) {
      if (existsSync(cacheFile)) {
        try {
          const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
          if (Array.isArray(cached.places)) {
            raws.push(...cached.places);
            label = cached.source || label;
            report.push({ source: label, found: cached.places.length, ok: false, cached: 'stale' });
            console.log(`  ⚠️  ${label.padEnd(26)} ${cached.places.length} places (cached — live failed: ${e.message || e})`);
            continue;
          }
        } catch { /* corrupt cache — fall through */ }
      }
      report.push({ source: label, found: 0, ok: false, error: String(e.message || e) });
      console.warn(`  ❌ ${label.padEnd(26)} failed, no cache — skipped (${e.message || e})`);
    }
  }
  return { raws, report };
}

// ===================== merge / dedupe (§3) ==================================
// Grid blocking replaces the events pipeline's by-day blocking; name match is
// REQUIRED always; the spatial gate scales with name confidence.
// CELL must be large enough that ±1-cell search covers the 2.5km strong gate
// (0.02° guaranteed only ~1.84km in lng — review HIGH: nondeterministic
// misses for strong pairs at 2.2–2.5km).
const CELL = 0.03;
const cellOf = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

// Generic color-route names ("Red Trail", "Blue Trail") name a DIFFERENT
// trail in every park that has one — an identical name is NOT the same place
// out at park-to-park distances. They merge only when practically co-located
// (the same trail mapped twice).
const GENERIC_NAME = /^(red|blue|green|yellow|orange|white|purple|black|gold|silver) (trail|loop|path)$/;
const isGenericName = (rec) => GENERIC_NAME.test(rec.tokens.join(' '));
const GENERIC_GATE_M = 250;

function mergePlaces(raws) {
  const prepared = raws.map((r) => {
    const tokens = nameTokens(r.name);
    return { ...r, tokens, stripped: stripDesignators(tokens) };
  });
  // Union-find over clusters: a record can match SEVERAL existing clusters
  // (Fort De Soto: the Pinellas point matched both the OSM relation cluster
  // and the De Soto Monument cluster) — greedy first-match-wins left the
  // official relation orphaned. All matching clusters union instead.
  const clusters = [];          // member arrays, live only at root ids
  const parent = [];
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return a;
    if (b < a) [a, b] = [b, a];
    clusters[a].push(...clusters[b]);
    clusters[b] = [];
    parent[b] = a;
    return a;
  };
  const pairGate = (a, b) => {
    const level = nameMatchLevel(a, b);
    if (!level) return null;
    if (isGenericName(a) || isGenericName(b)) return GENERIC_GATE_M;
    return GATE_M[level];
  };
  const cellIndex = new Map();  // cell key -> Set of (possibly stale) cluster ids
  for (const rec of prepared) {
    const ci = Math.floor(rec.lat / CELL);
    const cj = Math.floor(rec.lng / CELL);
    const candidates = new Set();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const ids = cellIndex.get(`${ci + di}:${cj + dj}`);
        if (ids) for (const id of ids) candidates.add(find(id));
      }
    }
    const hits = [];
    for (const id of candidates) {
      const hit = clusters[id].some((m) => {
        const gate = pairGate(rec, m);
        return gate != null && metersApart(rec, m) <= gate;
      });
      if (hit) hits.push(id);
    }
    let placed;
    if (!hits.length) {
      placed = clusters.length;
      clusters.push([]);
      parent.push(placed);
    } else {
      placed = hits.reduce((a, b) => union(a, b));
    }
    clusters[placed].push(rec);
    const key = cellOf(rec.lat, rec.lng);
    if (!cellIndex.has(key)) cellIndex.set(key, new Set());
    cellIndex.get(key).add(placed);
  }

  // PASS 2 — two targeted second passes the cell-local pass can't see:
  //
  // (a) WIDE: big state parks/preserves split across sources sit farther
  //     apart than the strong gate (an FDEP entrance vs an OSM centroid on a
  //     2,400-acre park — Alafia ×2 at 2.9km, Anclote Key ×3). Identical
  //     designator-stripped names + a State/Water-Mgmt/preserve pedigree
  //     merge out to 10km. City parks are exempt ON PURPOSE: two different
  //     neighborhood "Sunset Park"s are two places.
  //
  // (b) MICRO: initials/possessive token misses at ≤150m ("E L Bing Park" vs
  //     "El Bing" at 10m, "Freedom Lake Park's Dog Park" at 60m, "By-Pass
  //     Canal" vs "Bypass Canal" at 90m) — joined-token equality (with and
  //     without single-letter tokens) at near-zero distance.
  const WIDE_GATE_M = 10000;
  const MICRO_GATE_M = 150;
  const liveRoots = () => {
    const out = [];
    for (let i = 0; i < clusters.length; i++) if (find(i) === i && clusters[i].length) out.push(i);
    return out;
  };
  const wideEligible = (members) => members.some((m) =>
    m.designation === 'State' || m.designation === 'Water-Mgmt' || (m.classes || []).includes('preserve'));
  const minClusterDist = (a, b) => {
    let best = Infinity;
    for (const ma of clusters[a]) for (const mb of clusters[b]) {
      const d = metersApart(ma, mb);
      if (d < best) best = d;
    }
    return best;
  };
  const keyGroups = new Map(); // key string -> Set of root ids
  const addKey = (k, id) => {
    if (!k) return;
    if (!keyGroups.has(k)) keyGroups.set(k, new Set());
    keyGroups.get(k).add(id);
  };
  for (const id of liveRoots()) {
    for (const m of clusters[id]) {
      if (!isGenericName(m)) addKey('W:' + m.stripped.join(' '), id);
      addKey('M:' + m.stripped.join(''), id);
      const noSingles = m.stripped.filter((t) => t.length > 1);
      if (noSingles.length) addKey('M:' + noSingles.join(''), id);
    }
  }
  for (const [k, idSet] of keyGroups) {
    const roots = [...new Set([...idSet].map(find))];
    if (roots.length < 2) continue;
    const wide = k.startsWith('W:');
    for (let i = 0; i < roots.length; i++) {
      for (let j = i + 1; j < roots.length; j++) {
        const a = find(roots[i]), b = find(roots[j]);
        if (a === b) continue;
        if (wide) {
          if (!wideEligible([...clusters[a], ...clusters[b]])) continue;
          if (minClusterDist(a, b) <= WIDE_GATE_M) union(a, b);
        } else if (minClusterDist(a, b) <= MICRO_GATE_M) {
          union(a, b);
        }
      }
    }
  }

  return liveRoots().map((id) => mergeCluster(clusters[id]));
}

function pickBy(members, field) {
  for (const m of members) if (m[field] != null && m[field] !== '') return m[field];
  return null;
}

function mergeCluster(members) {
  // gov-first ordering for field precedence (stable within rank)
  const byRank = members.slice().sort((a, b) => srcRank(a.source) - srcRank(b.source));

  // Name: official gov spelling wins EXCEPT when an OSM member that carries
  // the operator's own website (or wikidata) differs only by a one-letter
  // token slip — then the operator-confirmed OSM spelling wins and the gov
  // variant is kept as an internal alias for matching (the o/e-typo rule).
  let name = byRank[0].name;
  const aliases = new Set(members.map((m) => m.name));
  const govM = byRank.find((m) => isGov(m.source));
  const osmM = members.find((m) => m.source === 'OSM' && m.url);
  if (govM && osmM && osmM.name !== govM.name) {
    const g = stripDesignators(nameTokens(govM.name));
    const o = stripDesignators(nameTokens(osmM.name));
    const sameShape = g.length === o.length && tolerantOverlap(g, o) === g.length;
    const exactSame = g.length === o.length && g.every((t, i) => o.includes(t));
    if (sameShape && !exactSame) {
      // Operator-website confirmation (§3.4, review LOW): the OSM variant
      // spelling wins only when its differing tokens actually appear in the
      // OSM-tagged website (weedonislandpreserve.org vouches for "weedon");
      // a url that doesn't carry the variant can't vouch for it.
      const urlBlob = String(osmM.url).toLowerCase();
      const variantTokens = o.filter((t) => !g.includes(t));
      if (variantTokens.length && variantTokens.every((t) => urlBlob.includes(t))) name = osmM.name;
    }
  }

  // Coords: government point (entrance/point layers) over OSM centroid.
  const { lat, lng } = byRank[0];

  // Field precedence: gov > OSM for hours/amenities/address/url (§3.4).
  const amenities = [];
  for (const m of byRank) {
    for (const a of m.amenities || []) if (!amenities.includes(a)) amenities.push(a);
  }
  const classes = [];
  for (const m of byRank) {
    for (const c of m.classes || []) if (!classes.includes(c)) classes.push(c);
  }
  let description = null;
  for (const m of members) {
    if (m.description && (!description || m.description.length > description.length)) description = m.description;
  }
  const sources = [...new Set(byRank.map((m) => m.source))];
  const osmMember = members.find((m) => m.osm);

  return {
    name,
    lat,
    lng,
    classes,
    amenities,
    address: pickBy(byRank, 'address'),
    description,
    hours: pickBy(byRank, 'hours'),
    url: pickBy(byRank, 'url'),
    phone: pickBy(byRank, 'phone'),
    isFree: pickBy(byRank, 'isFree'),       // explicit fee sources outrank inference
    fee: pickBy(byRank, 'fee'),
    designation: pickBy(byRank, 'designation'),
    operator: pickBy(byRank, 'operator'),
    osm: osmMember ? osmMember.osm : null,
    wikidata: pickBy(members, 'wikidata'),
    sources,
    srcCount: sources.length,
    _hasWiki: members.some((m) => m.hasWiki === true),
    _osmTags: Math.max(0, ...members.map((m) => m.osmTagCount || 0)),
    _govBacked: members.some((m) => isGov(m.source) && (m.hours || (m.amenities || []).length)),
    _aliases: [...aliases],
  };
}

// ===================== hidden scoring v1 (§5) ===============================
// Proxies, all grounded in verified fields. Wiki presence is a HARD exclusion
// (only the famous places carry wiki tags); the maintained-destination floor
// keeps "hidden" from meaning "abandoned mud lot".
const TOURIST_CENTROIDS = [
  { name: 'St. Pete Pier', lat: 27.7659, lng: -82.6259 },
  { name: 'Clearwater Beach', lat: 27.9775, lng: -82.8271 },
  { name: 'downtown Tampa', lat: 27.9477, lng: -82.4584 },
];
const FAR_FROM_TOURISTS_M = 12875; // 8 miles
const NICHE_AMENITIES = ['disc-golf', 'shuffleboard', 'canoe-launch', 'dog-beach', 'skate-park'];
const HIDDEN_CAP = 24;       // capped shelf — events GEM_CAP pattern
const HIDDEN_MIN_SCORE = 3;

function hiddenScoreOf(p) {
  const minTouristM = Math.min(...TOURIST_CENTROIDS.map((c) => metersApart(p, c)));
  p._touristM = minTouristM; // kept for the shelf tie-break
  if (p._hasWiki) return 0; // inverse-fame hard exclusion
  // maintained-destination floor: well-mapped OSM (≥6 tags) OR any gov
  // hours/amenity record — otherwise it's not a recommendable destination.
  if (!(p._osmTags >= 6 || p._govBacked)) return 0;
  let score = 0;
  if (minTouristM > FAR_FROM_TOURISTS_M) score += 2;
  if (p.amenities.some((a) => NICHE_AMENITIES.includes(a))) score += 2;
  if (p.designation === 'City' || p.designation === 'County') score += 1; // state parks are publicized by definition
  if (p.srcCount === 1) score += 1;      // single-source + no wiki leans hidden
  else if (p.srcCount >= 3) score -= 1;  // 3+ sources = well-known
  return Math.max(0, score);
}

// ===================== main =================================================
async function main() {
  console.log('\n🏞️  Tampa Bay Places Finder — building the places layer from free sources...\n');
  const { raws, report } = await loadSources();

  // Split amenity-chip points (courts + anonymous OSM geometry) from place
  // candidates; hard-filter both to the Tampa Bay box and to named records.
  const chips = [];
  const candidates = [];
  let outOfBoxDropped = 0;
  for (const r of raws) {
    if (!r || typeof r !== 'object') continue;
    if (!inBox(r.lat, r.lng)) { outOfBoxDropped++; continue; }
    if (r.amenityOnly) { chips.push(r); continue; }
    const nm = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim() : null;
    if (!nm) continue; // zero nameless places — benchmark-enforced
    candidates.push({ ...r, name: nm, amenities: r.amenities || [], classes: r.classes || [] });
  }
  if (outOfBoxDropped) console.log(`  🧭 dropped ${outOfBoxDropped} records outside the Tampa Bay box (statewide layers trim here)`);

  // Per-source raw place counts (pre-merge) — the count-floor benchmarks read
  // these so a silently-broken source fails loudly.
  const rawBySource = new Map();
  for (const c of candidates) rawBySource.set(c.source, (rawBySource.get(c.source) || 0) + 1);

  // Merge/dedupe (§3): grid blocking + required name match + scaled spatial gate.
  const merged = mergePlaces(candidates);
  console.log(`  🔀 merged ${candidates.length} raw place records → ${merged.length} unique places`);

  // Courts & anonymous-geometry join (§3.6): each chip attaches to the nearest
  // named park within 400 m as an amenity; unmatched chips are dropped.
  const parks = merged.filter((p) => p.classes.includes('park') || p.classes.includes('preserve'));
  const parkCells = new Map();
  for (const p of parks) {
    const key = cellOf(p.lat, p.lng);
    if (!parkCells.has(key)) parkCells.set(key, []);
    parkCells.get(key).push(p);
  }
  let chipsJoined = 0;
  for (const chip of chips) {
    const ci = Math.floor(chip.lat / CELL);
    const cj = Math.floor(chip.lng / CELL);
    let best = null;
    let bestD = 400; // meters
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const p of parkCells.get(`${ci + di}:${cj + dj}`) || []) {
          const d = metersApart(chip, p);
          if (d <= bestD) { bestD = d; best = p; }
        }
      }
    }
    if (best) {
      if (!best.amenities.includes(chip.amenity)) best.amenities.push(chip.amenity);
      chipsJoined++;
    }
  }
  console.log(`  🎾 amenity-chip join: ${chipsJoined}/${chips.length} OSM court/anonymous points attached to named parks (≤400m); rest dropped`);

  // Hidden scoring v1 (§5) — capped shelf, eyeball pass before the tag ships.
  for (const p of merged) p._hiddenScore = hiddenScoreOf(p);
  const shelfTitles = new Set();
  const shelf = [];
  // Tie-break by distance-from-tourist-centroids (farther = more hidden), not
  // alphabet — 400+ places compete at score 3 for the last shelf slots, and an
  // A-name bias systematically ignored K–Z gems (review LOW).
  const hiddenSorted = merged
    .filter((p) => p._hiddenScore >= HIDDEN_MIN_SCORE)
    .sort((a, b) => b._hiddenScore - a._hiddenScore || b._touristM - a._touristM || a.name.localeCompare(b.name));
  for (const p of hiddenSorted) {
    if (shelf.length >= HIDDEN_CAP) break;
    const tKey = nameTokens(p.name).sort().join(' ');
    if (shelfTitles.has(tKey)) continue; // two same-named rows read broken
    shelfTitles.add(tKey);
    shelf.push(p);
  }
  const hiddenSet = new Set(shelf);

  // Keys: 'p|' + slug (the ratified keyOf prefix); deterministic collision
  // suffixes (two real "Sunset Beach"es exist — they must not share a key).
  merged.sort((a, b) => a.name.localeCompare(b.name) || a.lat - b.lat || a.lng - b.lng);
  const usedKeys = new Set();
  for (const p of merged) {
    let key = 'p|' + slugify(p.name);
    for (let n = 2; usedKeys.has(key); n++) key = `p|${slugify(p.name)}-${n}`;
    usedKeys.add(key);
    p._key = key;
  }

  // Emit schema v1 EXACTLY (§2): kind 'place', singular category, omit
  // unsourced fields — never fabricate.
  const places = merged.map((p) => {
    const placeType = placeTypeOf(p.classes);
    const out = {
      key: p._key,
      kind: 'place',
      name: p.name,
      placeType,
      classes: p.classes,
      category: categoryOf(placeType),
      lat: p.lat,
      lng: p.lng,
    };
    if (p.address) out.address = p.address;
    if (p.description) out.description = p.description;
    if (p.amenities.length) out.amenities = p.amenities;
    if (p.isFree != null) out.isFree = p.isFree;
    if (p.fee) out.fee = p.fee;
    if (p.hours) out.hours = p.hours;
    if (p.url) out.url = p.url;
    if (p.phone) out.phone = p.phone;
    if (p.designation) out.designation = p.designation;
    if (p.operator) out.operator = p.operator;
    out.sources = p.sources;
    out.srcCount = p.srcCount;
    // variant spellings survive for refresh-time re-matching and Sprint S
    // save-keys ("Weeden" stays findable after the official spelling won)
    if (p._aliases && p._aliases.length > 1) out.aliases = p._aliases;
    if (p.osm) out.osm = p.osm;
    if (p.wikidata) out.wikidata = p.wikidata;
    out.hiddenScore = p._hiddenScore;
    out.hidden = hiddenSet.has(p);
    return out;
  });
  places.sort((a, b) => (a.key < b.key ? -1 : 1));

  // W4: give places that carry a wikidata Q-id a REAL photo of themselves
  // (Wikidata P18 → Commons thumbnail), cached so this doesn't refetch weekly.
  // Sets `image` on the ~24 with a curated photo; the rest keep category-art.
  // PLACES_LIVE forces a refresh in lockstep with the source caches above.
  const imgStats = await enrichPlacesWithImages(places, { live: FORCE_LIVE, log: console.log });
  console.log(`  🖼️  images: ${imgStats.set}/${imgStats.withQid} wikidata places photographed (${imgStats.noImage} no P18 → category-art)`);

  // ---- write outputs --------------------------------------------------------
  mkdirSync(OUT, { recursive: true });
  const payload = { schemaVersion: 1, places };
  writeFileSync(join(OUT, 'places.json'), JSON.stringify(payload, null, 2));

  const typeDist = {};
  for (const p of places) typeDist[p.placeType] = (typeDist[p.placeType] || 0) + 1;
  const desigDist = {};
  for (const p of places) desigDist[p.designation || '(none)'] = (desigDist[p.designation || '(none)'] || 0) + 1;
  const withHours = places.filter((p) => p.hours).length;
  const withAmenities = places.filter((p) => p.amenities && p.amenities.length).length;
  const scoreDist = {};
  for (const p of places) scoreDist[p.hiddenScore] = (scoreDist[p.hiddenScore] || 0) + 1;

  let md = `# Tampa Bay Places — ${places.length} real places\n\n`;
  md += `_Generated ${new Date().toLocaleString('en-US')} · sources: ${report.map((r) => r.source).join(', ')}_\n\n`;
  md += `## Summary\n\n`;
  md += `- Total places: ${places.length}\n`;
  md += `- By type: ${Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(' · ')}\n`;
  md += `- By designation: ${Object.entries(desigDist).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(' · ')}\n`;
  md += `- With hours: ${withHours} · with amenities: ${withAmenities} · with description: ${places.filter((p) => p.description).length}\n`;
  md += `- Cross-sourced (srcCount ≥ 2): ${places.filter((p) => p.srcCount >= 2).length}\n`;
  md += `- Hidden shelf: ${shelf.length} (cap ${HIDDEN_CAP})\n`;
  md += `\n## 💎 Hidden shelf (eyeball pass requested — Josh/Charles review before the tag ships)\n\n`;
  for (const p of shelf) {
    const bits = [p._key.replace(/^p\|/, ''), placeTypeOf(p.classes), p.designation || p.operator || ''].filter(Boolean);
    const ams = p.amenities.slice(0, 5).join(', ');
    md += `- **${p.name}** (score ${p._hiddenScore}) — ${bits.join(' · ')}${ams ? ` · ${ams}` : ''}${p.hours ? ` · hours: ${p.hours}` : ''}\n`;
  }
  md += `\n## The classics (srcCount ≥ 3)\n\n`;
  for (const p of places.filter((x) => x.srcCount >= 3).slice(0, 25)) {
    md += `- **${p.name}** — ${p.placeType} · sources: ${p.sources.join(', ')}\n`;
  }
  writeFileSync(join(OUT, 'places.md'), md);

  // Keep the web app's copy in sync (second lazy fetch — Sprint S consumes it).
  const appPublic = join(HERE, '..', 'app', 'public');
  if (existsSync(appPublic)) {
    writeFileSync(join(appPublic, 'places.json'), JSON.stringify(payload, null, 2));
  }

  // ---- console summary + benchmarks ----------------------------------------
  console.log('\n──────────────────────────────────────────');
  console.log(`  TOTAL places: ${places.length}  (from ${candidates.length} raw records)`);
  console.log(`  Types:        ${Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join('  ')}`);
  console.log(`  Designation:  ${Object.entries(desigDist).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}:${n}`).join('  ')}`);
  console.log(`  Hours/amenities/descriptions: ${withHours} / ${withAmenities} / ${places.filter((p) => p.description).length}`);
  console.log(`  Hidden score distribution:    ${Object.entries(scoreDist).sort((a, b) => Number(a[0]) - Number(b[0])).map(([s, n]) => `${s}:${n}`).join('  ')}`);

  console.log('  Benchmarks (mechanism checks):');
  const bench = (ok, label) => console.log(`    ${ok ? '✅' : '❌'} ${label}`);
  bench(places.length >= 300, `total places: ${places.length} (need >= 300)`);
  const outOfBox = places.filter((p) => !inBox(p.lat, p.lng)).length;
  bench(outOfBox === 0, `coords outside Tampa Bay box: ${outOfBox} (need 0)`);
  bench(withHours >= 150, `places with hours: ${withHours} (need >= 150)`);
  bench(withAmenities >= 250, `places with amenities: ${withAmenities} (need >= 250)`);
  const nameless = places.filter((p) => !p.name || !p.name.trim()).length;
  bench(nameless === 0, `nameless places: ${nameless} (need 0)`);
  const badKeys = places.filter((p) => !/^p\|/.test(p.key)).length;
  bench(badKeys === 0, `keys without the 'p|' prefix: ${badKeys} (need 0)`);
  bench(shelf.length <= HIDDEN_CAP, `hidden shelf: ${shelf.length} (cap ${HIDDEN_CAP})`);
  // Per-source raw count floors — a silently-broken source fails loudly here.
  const floors = [
    ['Pinellas Park Points', 350],
    ['Tampa Parks', 150],
    ['FWC Boat Ramps', 200],
    ['OSM', 600],
  ];
  for (const [src, floor] of floors) {
    const n = rawBySource.get(src) || 0;
    bench(n >= floor, `${src} raw records: ${n} (need >= ${floor})`);
  }

  // ROSTER BENCHMARKS (R3 — pass by GENERATION, never hardcoding; these
  // strings appear NOWHERE in fetch or merge code — this block is fuzzy
  // matching against the GENERATED output only, using the same edit-tolerant
  // comparator as the merge).
  //
  // ⚑R-MOON RESOLVED (Josh, 2026-06-11): "Moonlight Beach" was a
  // misremembering — it does not exist in Tampa Bay (proven six independent
  // ways by the R1 scouts). Josh ratified Honeymoon Island State Park as the
  // fifth roster slot. PLACES_SOURCES.md §0.3 / §4.
  const roster = [
    'Honeymoon Island State Park',
    'Caladesi Island State Park',
    'Fort De Soto',
    'Weedon Island Preserve',   // county GIS spells it "Weeden" — comparator must tolerate
    'Davis Islands dog park beach', // the Tampa pair may ship as two adjacent records
  ];
  const rosterMatches = (rosterName) => {
    const rTokens = nameTokens(rosterName);
    return places.filter((p) => tolerantJaccard(rTokens, nameTokens(p.name)) >= 0.5);
  };
  for (const r of roster) {
    const hits = rosterMatches(r);
    bench(hits.length >= 1, `roster "${r}": ${hits.length ? hits.map((h) => h.key).join(', ') : 'NOT FOUND'}`);
  }
  // The o/e-typo benchmark also asserts the merge: county + OSM spellings of
  // the same preserve must converge on ONE record, not two. STRICT stripped-
  // token matching here, not the loose roster matcher — the preserve's own
  // paddlecraft launch is a genuinely separate place, not a failed merge.
  const weedonStripped = stripDesignators(nameTokens('Weedon Island Preserve'));
  const weedonHits = places.filter((p) => {
    const s = stripDesignators(nameTokens(p.name));
    return s.length === weedonStripped.length && tolerantOverlap(weedonStripped, s) === s.length;
  });
  bench(weedonHits.length === 1, `roster "Weedon Island Preserve" merged to exactly ONE record: ${weedonHits.length} (${weedonHits.map((h) => h.key).join(', ')})`);

  console.log('──────────────────────────────────────────');
  console.log('  Wrote: finder/output/places.json  (structured, schema v1)');
  console.log('  Wrote: finder/output/places.md    (readable + hidden shelf for the eyeball pass)');
  console.log('  Wrote: app/public/places.json     (second lazy fetch — Sprint S consumes it)');
  console.log('');
}

// Run only when executed directly — importing for helpers must not fetch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Places finder crashed:', e);
    process.exit(1);
  });
}
