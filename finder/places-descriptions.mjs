// places-descriptions.mjs — W7 (Phase 3.5): give a wikidata-known place a REAL
// description of itself, sourced from its Wikipedia article.
//
// HONEST contract (same spirit as places-images.mjs): a description is only ever
// the actual encyclopedic intro for THAT place. We resolve it via the place's
// Wikidata Q-id → its English Wikipedia sitelink → the REST summary extract.
// Two deliberate exclusions:
//   • a place that already has a description (gov/OSM sourced) keeps it — those
//     are authoritative for the specific place; we never overwrite.
//   • a place with a Wikidata entity but NO Wikipedia article gets NOTHING. The
//     bare Wikidata description ("park in Polk County, Florida") is near-noise,
//     so we do not fabricate a blurb from it — no description beats a generic one.
//
// Cached in finder/cache/wikidata-descriptions.json (TRACKED, idempotent — a
// warm/offline run leaves it byte-identical). PLACES_LIVE=1 forces a refresh.
//
// Importable (places.mjs calls enrichPlacesWithDescriptions before writing) and
// runnable standalone (node finder/places-descriptions.mjs — patches the
// existing places.json copies in place).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_UA } from './ua.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(HERE, 'cache', 'wikidata-descriptions.json');
// city-neutral product UA (Wikimedia etiquette) + this caller's purpose token.
const UA = {
  'User-Agent': `${PRODUCT_UA} place-description-enrichment`,
};
const MAX_CACHE_AGE_MS = 30 * 24 * 3600e3; // descriptions change very rarely — 30d
const MAX_LEN = 320; // a tidy blurb, not the whole article — trim at a sentence end

// W7 review: a few OSM-supplied wikidata Q-ids point at a DIFFERENT entity than
// the place (the tag rides the place but the Q-id is the old coaster / the whole
// island). The token gate below catches no-overlap mismatches (e.g. a JCC whose
// Q-id resolves to an armory); these two SHARE a token with the place name, so
// the gate can't catch them — skip them explicitly. "No description beats a
// wrong one." Q966471 = "Gwazi Field" → Iron Gwazi roller coaster; Q15274993 =
// "Sand Key Bayside Park" → the whole 12-mile Sand Key barrier island.
const WRONG_ENTITY = new Set(['Q966471', 'Q15274993']);

// generic place/geo words dropped before the name↔article overlap check, so the
// overlap must be on a DISTINCTIVE token, not "park"/"key"/"the".
const STOP = new Set([
  'park', 'field', 'court', 'courts', 'center', 'centre', 'complex', 'area', 'the', 'and', 'of', 'at',
  'club', 'recreation', 'reserve', 'preserve', 'beach', 'trail', 'state', 'county', 'city', 'national',
  'wildlife', 'refuge', 'island', 'bay', 'lake', 'river', 'springs', 'spring', 'key', 'point', 'gardens', 'garden',
]);
const distinctiveTokens = (s) =>
  new Set((s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// trim a Wikipedia extract to a clean ≤MAX_LEN blurb, breaking at the last
// sentence boundary before the cap (never mid-word, never a dangling clause).
function tidy(extract) {
  const s = (extract || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length <= MAX_LEN) return s;
  const cut = s.slice(0, MAX_LEN);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > 80) return cut.slice(0, lastStop + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).trim() + '…';
}

// Q-id → { description, title } | null. Two honest hops: Wikidata entity →
// English Wikipedia sitelink title, then the Wikipedia REST summary → extract.
export async function resolveWikipediaDescription(qid, placeName) {
  if (WRONG_ENTITY.has(qid)) return null; // known wrong-entity Q-id (review)
  const ed = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
    headers: UA,
  }).then((r) => (r.ok ? r.json() : null));
  const title = ed?.entities?.[qid]?.sitelinks?.enwiki?.title;
  if (!title) return null; // no Wikipedia article → no honest blurb to show
  const sum = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { headers: UA }
  ).then((r) => (r.ok ? r.json() : null));
  const desc = tidy(sum?.extract);
  if (!desc) return null;
  // sanity gate: the article must plausibly be about THIS place — a distinctive
  // token of the place name must appear in the article title OR the lead sentence
  // (the lead catches honest renames, e.g. "Loyce Harpe Park, formerly Carter
  // Road Park…"). Otherwise the Q-id resolved to a different entity → skip.
  const nameTok = distinctiveTokens(placeName);
  if (nameTok.size) {
    const lead = (sum?.extract || '').split(/[.!?]/)[0];
    const haystack = new Set([...distinctiveTokens(title), ...distinctiveTokens(lead)]);
    if (![...nameTok].some((t) => haystack.has(t))) return null;
  }
  return { description: desc, title };
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return { fetchedAt: null, byQid: {} };
  try {
    const c = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    return c && c.byQid ? c : { fetchedAt: null, byQid: {} };
  } catch {
    return { fetchedAt: null, byQid: {} };
  }
}

// Sets `description` on each wikidata place that LACKS one and has a resolvable
// Wikipedia extract. Never overwrites an existing (gov/OSM) description. Returns
// counts.
export async function enrichPlacesWithDescriptions(places, { live = false, log = () => {} } = {}) {
  const cache = loadCache();
  const stats = { candidates: 0, set: 0, fromCache: 0, fetched: 0, noArticle: 0 };
  let dirty = false;
  for (const p of places) {
    if (!p || !p.wikidata || p.description) continue; // gov/OSM description wins
    stats.candidates++;
    const cached = cache.byQid[p.wikidata];
    const fresh = cached && cached.at && Date.now() - Date.parse(cached.at) < MAX_CACHE_AGE_MS;
    let rec;
    if (cached && fresh && !live) {
      rec = cached;
      stats.fromCache++;
    } else {
      try {
        const r = await resolveWikipediaDescription(p.wikidata, p.name);
        rec = { description: (r && r.description) || null, title: (r && r.title) || null, at: new Date().toISOString() };
        cache.byQid[p.wikidata] = rec;
        dirty = true;
        stats.fetched++;
        await sleep(120); // politeness between live Wikimedia calls
      } catch (e) {
        rec = cached || { description: null, title: null, at: new Date().toISOString() };
        log(`  ⚠️  ${p.wikidata} (${p.name}): ${e.message || e}`);
      }
    }
    if (rec.description) {
      p.description = rec.description;
      stats.set++;
    } else {
      stats.noArticle++;
    }
  }
  if (dirty) {
    cache.fetchedAt = new Date().toISOString();
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  }
  return stats;
}

// ---- standalone: backfill the existing places.json copies in place ----------
async function main() {
  const live = process.env.PLACES_LIVE === '1';
  const targets = [
    join(HERE, 'output', 'places.json'),
    join(HERE, '..', 'app', 'public', 'places.json'),
  ].filter((p) => existsSync(p));
  if (!targets.length) {
    console.error('no places.json found (run finder/places.mjs first)');
    process.exit(1);
  }
  let first = true;
  for (const path of targets) {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(doc.places)) continue;
    const stats = await enrichPlacesWithDescriptions(doc.places, { live: live && first, log: console.log });
    writeFileSync(path, JSON.stringify(doc, null, 2));
    first = false;
    console.log(
      `${path}: ${stats.set}/${stats.candidates} descriptions added ` +
        `(fetched ${stats.fetched}, cache ${stats.fromCache}, no-article ${stats.noArticle})`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
