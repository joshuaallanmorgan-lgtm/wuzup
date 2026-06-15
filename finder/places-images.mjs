// places-images.mjs — W4 (Phase 3.5): give a place a REAL photo of ITSELF.
//
// THE HONEST-IMAGES CONTRACT (Josh, 2026-06-15): a place image is ONLY ever a
// verified photo OF THAT ACTUAL PLACE — never a representative stand-in (a
// generic park photo on a specific park would imply it's that place: soft
// fabrication, rejected). The only place we can prove a photo is OF the place
// is Wikidata's P18 ("image") claim, which points at a Wikimedia Commons file
// curated for that exact entity. So: for each place carrying a `wikidata` Q-id,
// resolve P18 → a sized Commons thumbnail URL → the place's `image` field.
// Places without a P18 keep their category-art (the honest floor — refined in
// W4's CSS, never faked).
//
// Caching: results live in finder/cache/wikidata-images.json (TRACKED, not
// ignored — it's tiny + stable, and committing it means a CI/finder run never
// refetches and the resolved URLs are reproducible). The cache also keeps the
// Commons FILE name per Q-id so Sprint X3's attribution page can resolve
// author/license without re-deriving. PLACES_LIVE=1 forces a refresh (mirrors
// places.mjs's flag).
//
// Two ways in:
//   • import { enrichPlacesWithImages } — places.mjs calls it before writing, so
//     a full regeneration keeps photos.
//   • node finder/places-images.mjs — standalone: patches the existing
//     places.json copies in place (minimal diff: just the `image` field) and
//     warms the cache. Used for the one-off W4 backfill.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(HERE, 'cache', 'wikidata-images.json');
// a descriptive User-Agent is required by the Wikimedia API etiquette policy.
const UA = {
  'User-Agent':
    'TampaBayWhatsOn/1.0 (Tampa Bay events+places discovery app; https://github.com/joshuaallanmorgan-lgtm/cj) place-image-enrichment',
};
const THUMB_W = 1280; // crisp on a retina 460px hero, still light (~one image)
// the place-detail hero is ~42svh full-bleed → ~920px physical on a 460px retina
// frame. A source narrower than this upscales and reads soft — worse than the
// honest category-art floor. So a photo must be at least this wide to ship;
// below it, the place keeps its art (still honest, and crisper). Commons never
// upscales, so `width` is the file's true pixel width.
const MIN_HERO_W = 900;
const MAX_CACHE_AGE_MS = 30 * 24 * 3600e3; // place photos change very rarely — 30d

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Q-id → { image, file } | null. Two honest hops: Wikidata entity → P18 filename,
// then Commons imageinfo → a DIRECT sized thumbnail URL (same upload.wikimedia.org
// shape as the app's CITY.hero, so no redirect on load).
export async function resolveWikidataImage(qid) {
  const ed = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
    headers: UA,
  }).then((r) => (r.ok ? r.json() : null));
  const file = ed?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!file) return null; // no curated photo of this place — keep category-art
  // iiprop=url|size gives the sized thumb URL AND the source file's true width,
  // so the caller can drop too-small photos to art (the resolution floor).
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo` +
    `&iiprop=url|size&iiurlwidth=${THUMB_W}&titles=${encodeURIComponent('File:' + file)}`;
  const ii = await fetch(api, { headers: UA }).then((r) => (r.ok ? r.json() : null));
  const info = ii && ii.query && Object.values(ii.query.pages)[0]?.imageinfo?.[0];
  const thumb = info?.thumburl;
  if (!thumb) return null;
  return { image: thumb, file, width: typeof info.width === 'number' ? info.width : null };
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

// Mutates each place that carries a wikidata Q-id, setting `image` when a real
// photo resolves. Pure on places that have no Q-id (never touches them) and on
// those whose Q-id has no P18 (they keep category-art). Returns counts.
export async function enrichPlacesWithImages(places, { live = false, log = () => {} } = {}) {
  const cache = loadCache();
  const stats = { withQid: 0, set: 0, fromCache: 0, fetched: 0, noImage: 0, tooSmall: 0 };
  let dirty = false; // only rewrite the TRACKED cache when content actually changed
  for (const p of places) {
    if (!p || !p.wikidata) continue;
    stats.withQid++;
    const cached = cache.byQid[p.wikidata];
    const fresh = cached && cached.at && Date.now() - Date.parse(cached.at) < MAX_CACHE_AGE_MS;
    let rec;
    if (cached && fresh && !live) {
      rec = cached;
      stats.fromCache++;
    } else {
      try {
        const r = await resolveWikidataImage(p.wikidata);
        rec = {
          image: (r && r.image) || null,
          file: (r && r.file) || null,
          width: (r && r.width) || null,
          at: new Date().toISOString(),
        };
        cache.byQid[p.wikidata] = rec;
        dirty = true;
        stats.fetched++;
        await sleep(120); // politeness between live Wikimedia calls
      } catch (e) {
        // network hiccup: fall back to any cached value, else leave art
        rec = cached || { image: null, file: null, width: null, at: new Date().toISOString() };
        log(`  ⚠️  ${p.wikidata} (${p.name}): ${e.message || e}`);
      }
    }
    // resolution floor: a photo narrower than the hero needs reads soft → keep
    // art instead. Unknown width (legacy cache record) is allowed through.
    // enrich is the SOLE writer of `image`, so it authoritatively sets OR clears
    // it — a re-run after the floor tightened drops a now-too-small photo.
    if (rec.image && (rec.width == null || rec.width >= MIN_HERO_W)) {
      p.image = rec.image;
      stats.set++;
    } else {
      if ('image' in p) delete p.image;
      if (rec.image) stats.tooSmall++;
      stats.noImage++;
    }
  }
  // idempotent: only touch the file when a fetch changed it (a warm offline run
  // must leave the tracked cache byte-identical — no spurious fetchedAt churn).
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
  let lastStats = null;
  for (const path of targets) {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(doc.places)) continue;
    // first target fetches live (if needed); later targets ride the warm cache
    const stats = await enrichPlacesWithImages(doc.places, { live: live && lastStats === null, log: console.log });
    writeFileSync(path, JSON.stringify(doc, null, 2));
    lastStats = stats;
    console.log(
      `${path}: ${stats.set}/${stats.withQid} places imaged ` +
        `(fetched ${stats.fetched}, cache ${stats.fromCache}, no-photo ${stats.noImage})`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
