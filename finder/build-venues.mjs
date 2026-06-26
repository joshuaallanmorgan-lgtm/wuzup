// build-venues.mjs — generate finder/venues.json, the canonical venue table.
//
// Usage:  node finder/build-venues.mjs [eventsJsonPath]
//         (eventsJsonPath defaults to finder/output/events.json)
//
// Reads the latest pipeline output (finder/output/events.json) and clusters
// venue spellings into canonical identities:
//   { canonicalName, aliases[], lat, lng, address }
//
// CONSERVATIVE by design — two venue spellings merge only when BOTH the name
// and the coordinates agree:
//   (a) their aggressively-normalized names are identical
//       ("The Dalí" vs "the dali"), or
//   (b) distinctive-token Jaccard >= 0.5 with >= 1 shared token, coords within
//       150 m, and their street numbers don't contradict (2300 Central vs
//       2340 Central stay separate), or
//   (c) one name's distinctive tokens are a subset of the other's with NOTHING
//       unexplained left over ("The Dali" ⊂ "Salvador Dali Museum"), coords
//       within 100 m, and identical street-number sets, or
//   (d) both names are pure addresses (no distinctive words), with identical
//       street numbers and coords within 80 m ("3101 Beach Blvd S" vs
//       "3101 Beach Blvd.").
// Spelling pairs with no coordinates never fuzzy-merge (exact key only).
//
// The table keeps clusters that actually NEED canonicalizing: 2+ distinct raw
// spellings, or one spelling whose own coords jitter by > 40 m across events.
// finder.mjs applies the table at merge time (canonical name + coords).
//
// ACCRETIVE: the existing venues.json is folded back in before clustering.
// Pipeline output is already canonicalized, so alias spellings stop appearing
// in the data the moment the table works — without this, every regeneration
// would forget yesterday's aliases (observed live: 44 venues collapsed to 5).
//
// Re-run after big source changes; the output is committed.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bbox } from './cities/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVENTS = process.argv[2] || join(HERE, 'output', 'events.json');
const OUT = join(HERE, 'venues.json');

// Tampa Bay sanity box — from the active city config (cities/).
const inBox = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  lat >= bbox.latMin && lat <= bbox.latMax && lng >= bbox.lngMin && lng <= bbox.lngMax;

// Same normalization as finder.mjs's venueKey (kept in sync by the sim).
function venueKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

// Tokens that say nothing about WHICH venue it is — place-words, geography,
// street-suffixes and directionals.
const GENERIC = new Set([
  'the', 'a', 'an', 'at', 'of', 'and', 'in', 'on', 'or',
  'center', 'centre', 'theatre', 'theater', 'hall', 'park', 'museum',
  'library', 'branch', 'regional', 'public', 'community', 'recreation',
  'club', 'bar', 'grill', 'restaurant', 'church', 'school', 'arena',
  'stadium', 'gallery', 'studio', 'room', 'house', 'building', 'campus',
  'st', 'saint', 'pete', 'north', 'south', 'east', 'west', 'downtown', 'state',
  'tampa', 'petersburg', 'clearwater', 'florida', 'fl', 'bay', 'beach',
  'ave', 'avenue', 'blvd', 'boulevard', 'dr', 'drive', 'rd', 'road',
  'street', 'ln', 'lane', 'ct', 'court', 'hwy', 'highway', 'pl', 'place',
  'way', 'ter', 'terrace', 'suite', 'ste', 'unit',
  'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw',
  'united', 'states', 'usa',
]);

// Distinctive tokens: alphabetic, >= 3 chars, non-generic. Address numerals
// and 2-letter residue never count as identity evidence.
function tokensOf(key) {
  return new Set(key.split(' ').filter((t) => /^[a-z]{3,}$/.test(t) && !GENERIC.has(t)));
}

// Looser residue set — used to verify a subset-merge leaves NOTHING of the
// smaller name unexplained ("ro hyde park" has residue 'ro' → no merge).
function rawTokensOf(key) {
  return new Set(key.split(' ').filter((t) => /^[a-z]{2,}$/.test(t) && !GENERIC.has(t)));
}

// Street numbers (pure digit runs) — contradictory numbers veto a merge.
function numsOf(key) {
  return new Set(key.split(' ').filter((t) => /^\d+$/.test(t)));
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function subsetOf(a, b) {
  if (!a.size || a.size > b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------

const events = JSON.parse(readFileSync(EVENTS, 'utf8'));

// 1. Spelling groups: exact normalized key → stats over every event there.
const groups = new Map(); // key -> { key, spellings: Map(raw -> count), coords: [], addresses: Map }
for (const e of events) {
  if (!e.venue) continue;
  const key = venueKey(e.venue);
  if (!key || key.length < 3) continue;
  if (!groups.has(key)) groups.set(key, { key, spellings: new Map(), coords: [], addresses: new Map() });
  const g = groups.get(key);
  g.spellings.set(e.venue, (g.spellings.get(e.venue) || 0) + 1);
  if (inBox(e.lat, e.lng)) g.coords.push({ lat: e.lat, lng: e.lng });
  if (e.address) g.addresses.set(e.address, (g.addresses.get(e.address) || 0) + 1);
}

// 1b. Fold the existing table back in (accretion — see header). The canonical
// spelling gets a small count boost so canonical names stay stable across
// regenerations; aliases re-enter at the canonical coordinates.
try {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  for (const row of Array.isArray(prev) ? prev : []) {
    const entries = [[row.canonicalName, 3], ...(row.aliases || []).map((a) => [a, 1])];
    for (const [raw, n] of entries) {
      const key = venueKey(raw);
      if (!key || key.length < 3) continue;
      if (!groups.has(key)) groups.set(key, { key, spellings: new Map(), coords: [], addresses: new Map() });
      const g = groups.get(key);
      g.fromPrevTable = true; // earned its row once — keep it (see emit filter)
      g.spellings.set(raw, (g.spellings.get(raw) || 0) + n);
      if (inBox(row.lat, row.lng)) g.coords.push({ lat: row.lat, lng: row.lng });
      if (row.address) g.addresses.set(row.address, (g.addresses.get(row.address) || 0) + n);
    }
  }
} catch { /* first run: no table yet */ }

const list = [...groups.values()];
for (const g of list) {
  g.tokens = tokensOf(g.key);
  g.rawTokens = rawTokensOf(g.key);
  g.nums = numsOf(g.key);
  g.eventCount = [...g.spellings.values()].reduce((a, b) => a + b, 0);
  g.center = g.coords.length
    ? { lat: median(g.coords.map((c) => c.lat)), lng: median(g.coords.map((c) => c.lng)) }
    : null;
}

// 2. Union-find fuzzy clustering across spelling groups.
const parent = list.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const union = (i, j) => { parent[find(j)] = find(i); };

// Distance gates scale with name-evidence strength: identical distinctive
// tokens tolerate the most geocode noise (observed: "The Dali Museum"
// geocoded 319 m from "The Dali" — same building, noisy geocoder), weaker
// name matches must sit closer.
const DIST_IDENTICAL_M = 400;
const DIST_SUBSET_M = 250;
const DIST_SIMILAR_M = 150;
const DIST_ADDRESS_M = 80;

function shouldMerge(A, B) {
  if (!A.center || !B.center) return false; // coordless: exact-key only
  // Don't Tell Comedy-style "(secret location)" venues are DELIBERATELY vague
  // — folding the real district name into them (or vice versa) would either
  // unmask or mis-vague real venues. Exact-key only.
  if (/secret location/.test(A.key) || /secret location/.test(B.key)) return false;
  const dist = haversineM(A.center, B.center);
  if (dist > DIST_IDENTICAL_M) return false;
  const numsDisjoint = A.nums.size && B.nums.size && ![...A.nums].some((t) => B.nums.has(t));
  if (numsDisjoint) return false; // 2300 Central vs 2340 Central: different doors
  let shared = 0;
  for (const t of A.tokens) if (B.tokens.has(t)) shared++;
  // (b) similar names, close coords. Both sides need >= 2 distinctive tokens —
  // a 1-token name ("ro Hyde Park" → {hyde}) can hit J=0.5 by accident and
  // must instead pass the strict subset rule (c) below.
  if (
    dist <= DIST_SIMILAR_M &&
    A.tokens.size >= 2 && B.tokens.size >= 2 && shared >= 1 && jaccard(A.tokens, B.tokens) >= 0.5
  ) return true;
  // (b2) IDENTICAL distinctive tokens — the name-vs-address spelling of one
  // venue ("The Dali" vs "1 Dali Blvd"). The numsDisjoint veto above already
  // rejected contradictory street numbers.
  if (A.tokens.size >= 1 && setsEqual(A.tokens, B.tokens) && dist <= DIST_IDENTICAL_M) return true;
  // (c) clean subset ("The Dali" ⊂ "Salvador Dali Museum"), identical street
  //     numbers, no unexplained residue in the smaller name
  const [small, big] = A.tokens.size <= B.tokens.size ? [A, B] : [B, A];
  if (
    dist <= DIST_SUBSET_M &&
    setsEqual(A.nums, B.nums) &&
    small.tokens.size >= 1 &&
    subsetOf(small.tokens, big.tokens) &&
    setsEqual(small.rawTokens, small.tokens)
  ) return true;
  // (d) both pure addresses, same street number, near-identical spot
  if (
    dist <= DIST_ADDRESS_M &&
    A.tokens.size === 0 && B.tokens.size === 0 &&
    A.nums.size >= 1 && setsEqual(A.nums, B.nums)
  ) return true;
  return false;
}

for (let i = 0; i < list.length; i++) {
  for (let j = i + 1; j < list.length; j++) {
    if (shouldMerge(list[i], list[j])) union(i, j);
  }
}

const clusters = new Map();
for (let i = 0; i < list.length; i++) {
  const root = find(i);
  if (!clusters.has(root)) clusters.set(root, []);
  clusters.get(root).push(list[i]);
}

// 3. Emit table rows for clusters that need canonicalizing.
const rows = [];
for (const members of clusters.values()) {
  const allSpellings = new Map();
  const allCoords = [];
  const allAddresses = new Map();
  for (const g of members) {
    for (const [raw, n] of g.spellings) allSpellings.set(raw, (allSpellings.get(raw) || 0) + n);
    allCoords.push(...g.coords);
    for (const [a, n] of g.addresses) allAddresses.set(a, (allAddresses.get(a) || 0) + n);
  }

  // Worth a row? multiple spellings, a single spelling with jittery coords,
  // or anything carried over from the previous table (its jitter/aliases
  // vanished from the data BECAUSE the table fixed them — keep the cure).
  const fromPrev = members.some((g) => g.fromPrevTable);
  let jitter = 0;
  if (allCoords.length > 1) {
    const c = { lat: median(allCoords.map((x) => x.lat)), lng: median(allCoords.map((x) => x.lng)) };
    for (const x of allCoords) jitter = Math.max(jitter, haversineM(c, x));
  }
  if (!fromPrev && allSpellings.size < 2 && jitter <= 40) continue;

  // Canonical spelling: prefer a real NAME over a bare street address
  // ("The Dali" beats "1 Dali Blvd"), then frequency, then length.
  const looksLikeAddress = (s) => /^\d/.test(s.trim());
  const byFreq = [...allSpellings.entries()].sort((a, b) =>
    (looksLikeAddress(a[0]) - looksLikeAddress(b[0])) || b[1] - a[1] || b[0].length - a[0].length);
  const canonicalName = byFreq[0][0];
  const aliases = byFreq.slice(1).map(([raw]) => raw);
  const lat = allCoords.length ? +median(allCoords.map((x) => x.lat)).toFixed(6) : null;
  const lng = allCoords.length ? +median(allCoords.map((x) => x.lng)).toFixed(6) : null;
  const address = allAddresses.size
    ? [...allAddresses.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;
  rows.push({ canonicalName, aliases, lat, lng, address });
}

rows.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
writeFileSync(OUT, JSON.stringify(rows, null, 2));

const multi = rows.filter((r) => r.aliases.length);
console.log(`venues.json: ${rows.length} canonical venues (${multi.length} with aliases) from ${groups.size} raw spellings across ${events.length} events`);
for (const r of multi.slice(0, 25)) {
  console.log(`  • ${r.canonicalName}  ←  ${r.aliases.join(' | ')}`);
}
if (multi.length > 25) console.log(`  … and ${multi.length - 25} more alias clusters`);
