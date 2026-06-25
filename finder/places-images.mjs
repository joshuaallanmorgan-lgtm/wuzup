// places-images.mjs — W4 (Phase 3.5) + 3.7P-2 (Phase 3.7): give a place a REAL
// photo of ITSELF, with a captured credit.
//
// THE HONEST-IMAGES CONTRACT (Josh, 2026-06-15): a place image is ONLY ever a
// verified photo OF THAT ACTUAL PLACE — never a representative stand-in (a
// generic park photo on a specific park would imply it's that place: soft
// fabrication, rejected). We trust two curated provenances on Wikimedia, both
// keyed off the place's Wikidata Q-id:
//   • P18 ("image") — the entity's single curated lead photo. Strongest signal.
//   • P373 ("Commons category") — the entity's OWN category; its file members
//     are curated-as-depicting that exact entity (3.7P-2 fallback when no P18).
//
// ⚑ AMENDED — PREMIUM A3 (Josh, 2026-06-25): the contract is now HYBRID. The
// `image` field above STILL means "a verified photo of THIS place" and is the
// SOLE thing this pipeline writes — UNCHANGED. What changed is the *floor*: a
// place WITHOUT a real photo no longer falls straight to the flat hue+emoji block.
// It gets a curated, free-licensed (Pexels), CREDITED CATEGORY-STOCK image from
// finder/category-images.json — a CLEARLY-GENERIC floor, picked by placeType +
// hash(key) at RENDER time (app/src/categoryImages.js → CardImg / PlaceDetail),
// NEVER written into `image` and NEVER claimed to be the specific venue. The stock
// images are credited as stock on the Settings → About page (source + author). The
// honesty bar is the SAME the emoji floor met — a generic stand-in that doesn't
// pose as this place — just prettier. The art floor (refined: muted, textured)
// remains the last resort when no real image AND no/failed category image.
//
// 3.7P-2 honesty guardrails on the P373 fallback (mining a category is riskier
// than a single curated P18, so it is fenced hard):
//   1. only the entity's OWN P373 category (membership = the "of this place"
//      proof; we never touch generic/parent categories, never geosearch).
//   2. mediatype=BITMAP + mime jpeg/png only (kills SVG logos, PDF maps, GIFs).
//   3. width >= MIN_HERO_W (Commons reports true source pixels, never upscales).
//   4. negative title filter (skip map/diagram/chart/plan/logo/seal/flag/sign).
//   5. deterministic single pick: prefer files whose title token-matches the
//      place name, then alphabetical — reproducible, never "most attractive".
//   6. CREDIT-REQUIRED: a photo with no captured license is NOT shipped (the
//      place keeps art). enrich is the SOLE writer of BOTH `image` and the
//      matching attributions.json record.
// (OSM image=/wikimedia_commons tags: bare image= URLs are REJECTED — third-party
//  hosts, no license, ToS-cache breach. wikimedia_commons is ABSENT in the Tampa
//  OSM data, so its plumbing rides into the multi-city patch where it has data.)
//
// Caching: results live in finder/cache/wikidata-images.json (TRACKED) keyed by
// Q-id; per-image credits live in finder/cache/attributions.json (TRACKED) keyed
// by the Commons "File:" title — the machine-readable backing for the Settings →
// About source-attribution page (⚑X3) AND the CC-BY/BY-SA legal duty, rendered
// with NO live network call. Both caches are idempotent (only rewritten when
// content changed). PLACES_LIVE=1 forces a refresh (mirrors places.mjs's flag).
//
// Two ways in:
//   • import { enrichPlacesWithImages } — places.mjs calls it before writing, so
//     a full regeneration keeps photos.
//   • node finder/places-images.mjs — standalone: patches the existing
//     places.json copies in place (minimal diff: just the `image` field) and
//     warms the caches.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(HERE, 'cache', 'wikidata-images.json');
const ATTRIB_FILE = join(HERE, 'cache', 'attributions.json');
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
const CAT_LIMIT = 50; // category members to consider for the P373 pick

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// extmetadata Artist/Credit values are HTML (anchors + entities) — flatten to a
// plain byline. Returns null for empty/whitespace.
function cleanHtml(s) {
  if (!s) return null;
  const t = s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // tidy the common wiki-process byline (3.7P-2 review P2): keep the creator
    // handle, drop the "The original uploader was … at <wiki>" scaffolding.
    .replace(/^the original uploader was (.+?) at .*/i, '$1')
    .trim();
  return t || null;
}

// a license whose family requires crediting the author (CC BY / CC BY-SA). Public
// domain / CC0 need no byline. enforce: no attribution-required photo ships
// without an author (the BY clause's legal duty — 3.7P-2 review P0).
const needsAttribution = (license) => /^\s*cc\s*by/i.test(license || '');
// a record is shippable only with a license AND, when the license demands it, an
// author. This is the single credit gate used by both the P373 pick and enrich.
const creditOk = (rec) => !!(rec && rec.license && (!needsAttribution(rec.license) || rec.author));

// generic place-words carry no identifying signal — drop them so the name-match
// preference keys on the distinctive token ("Hillsborough", not "park"/"river").
const STOP = new Set([
  'park', 'beach', 'lake', 'river', 'trail', 'trails', 'center', 'centre', 'the', 'and',
  'state', 'county', 'preserve', 'area', 'recreation', 'nature', 'reserve', 'point',
  'island', 'bay', 'creek', 'springs', 'spring', 'garden', 'gardens', 'museum', 'park.',
]);
const nameTokens = (name) =>
  (name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
const titleMatchesName = (fileTitle, toks) => {
  const t = (fileTitle || '').toLowerCase();
  return toks.some((tok) => t.includes(tok));
};
// cheap belt-and-suspenders for the P373 pick: titles that are clearly a non-photo
// subject (map/logo/sign) OR a weak hero — a closeup/marker (3.7P-2 review P1) or
// a self-undermining condition shot like "What's left of it" (a drought photo).
// The dominant filters are still mediatype/mime/width + the name-match gate.
const BAD_TITLE =
  /\b(map|diagram|chart|plan|logo|seal|flag|sign|signpost|marker|coat[\s_-]of[\s_-]arms|locator|svg|close-?up|drought|hurricane)\b|what'?s? left|tropical storm/i;

// shape a Commons imageinfo entry into our record (image URL + credit). title is
// the canonical "File:Foo.jpg". Returns null if no sized thumbnail resolved.
function recFromImageInfo(info, title, source) {
  const thumb = info && info.thumburl;
  if (!thumb) return null;
  const ext = info.extmetadata || {};
  return {
    image: thumb,
    file: title.replace(/^File:/, ''), // bare filename (back-compat with W4 cache)
    fileTitle: title, // "File:Foo.jpg" — the attributions.json key
    fileUrl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title),
    width: typeof info.width === 'number' ? info.width : null,
    mediatype: info.mediatype || null,
    mime: info.mime || null,
    license: (ext.LicenseShortName && ext.LicenseShortName.value) || null,
    licenseUrl: (ext.LicenseUrl && ext.LicenseUrl.value) || null,
    author: cleanHtml(ext.Artist && ext.Artist.value) || cleanHtml(ext.Credit && ext.Credit.value) || null,
    source,
  };
}

const II_PROPS =
  'iiprop=url%7Csize%7Cmediatype%7Cmime%7Cextmetadata' +
  '&iiextmetadatafilter=LicenseShortName%7CLicenseUrl%7CArtist%7CCredit';

// resolve a single Commons "File:Foo.jpg" → record | null (the P18 path).
async function resolveCommonsFile(fileTitle) {
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&${II_PROPS}` +
    `&iiurlwidth=${THUMB_W}&titles=${encodeURIComponent(fileTitle)}`;
  const ii = await fetch(api, { headers: UA }).then((r) => (r.ok ? r.json() : null));
  const page = ii && ii.query && Object.values(ii.query.pages)[0];
  const info = page && page.imageinfo && page.imageinfo[0];
  return recFromImageInfo(info, (page && page.title) || fileTitle, 'wikidata-p18');
}

// 3.7P-2: resolve a Wikidata P373 Commons category → the best honest photo of
// the entity, applying the guardrails above. category is the bare name (no
// "Category:" prefix). Returns a record | null.
async function resolveCommonsCategory(category, name) {
  const title = 'Category:' + category;
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&generator=categorymembers&gcmtitle=${encodeURIComponent(title)}&gcmtype=file&gcmnamespace=6&gcmlimit=${CAT_LIMIT}` +
    `&prop=imageinfo&${II_PROPS}&iiurlwidth=${THUMB_W}`;
  const r = await fetch(api, { headers: UA }).then((x) => (x.ok ? x.json() : null));
  const pages = r && r.query && r.query.pages ? Object.values(r.query.pages) : [];
  const cands = [];
  for (const pg of pages) {
    const info = pg.imageinfo && pg.imageinfo[0];
    if (!info || !info.thumburl) continue;
    const t = pg.title || '';
    if (BAD_TITLE.test(t)) continue; // skip maps/logos/signs by title
    if (info.mediatype !== 'BITMAP') continue; // photos only (no SVG/PDF/audio)
    if (info.mime !== 'image/jpeg' && info.mime !== 'image/png') continue;
    if (!(typeof info.width === 'number' && info.width >= MIN_HERO_W)) continue;
    const rec = recFromImageInfo(info, t, 'wikidata-p373');
    if (!creditOk(rec)) continue; // credit-required (license + author when CC-BY)
    cands.push(rec);
  }
  // name-match is a HARD GATE on the mined path (3.7P-2 review P1): a P373 file
  // must token-match the place name to count as a verified photo "of this place"
  // — category membership alone is not enough (a category can hold sub-features,
  // adjacent subjects, unrelated uploads). No distinctive name token, or no
  // matching file → return null and keep the honest art floor. This closes the
  // "in the category but not provably of the place" stand-in path the honesty
  // pillar forbids (PHASE_3.7.md: reject category mining w/o name-match).
  const toks = nameTokens(name);
  const named = toks.length ? cands.filter((c) => titleMatchesName(c.fileTitle, toks)) : [];
  if (!named.length) return null;
  // establishing shots LEAD with the place name ("Exploring Nathan Benderson
  // Park"); specimen/subject shots trail it ("Pinus elliottii Werner-Boyce").
  // Prefer the earliest name-token position, then alphabetical (deterministic).
  // A pure sort PREFERENCE — never drops an honest photo, just orders better.
  const pos = (ft) => {
    const t = ft.toLowerCase();
    let m = Infinity;
    for (const tok of toks) {
      const i = t.indexOf(tok);
      if (i >= 0) m = Math.min(m, i);
    }
    return m;
  };
  named.sort((a, b) => pos(a.fileTitle) - pos(b.fileTitle) || a.fileTitle.localeCompare(b.fileTitle));
  return named[0];
}

// Q-id → record | null. P18 first (strongest curated signal); if it has no P18,
// or its P18 isn't a usable photo, fall back to the P373 category (3.7P-2).
export async function resolvePlaceImage(qid, name) {
  const ed = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
    headers: UA,
  }).then((r) => (r.ok ? r.json() : null));
  const claims = ed && ed.entities && ed.entities[qid] && ed.entities[qid].claims;
  if (!claims) return null;
  // P18: the curated lead image. Lenient (it's the strongest signal): accept any
  // non-SVG raster with a captured license at/above the resolution floor.
  const p18 = claims.P18 && claims.P18[0] && claims.P18[0].mainsnak?.datavalue?.value;
  if (p18) {
    const rec = await resolveCommonsFile('File:' + p18);
    const okWidth = rec && (rec.width == null || rec.width >= MIN_HERO_W);
    // P18 is lenient (it's the entity's single curated claim) but still must be a
    // non-SVG raster with a satisfiable credit (license + author when CC-BY).
    if (rec && creditOk(rec) && rec.mediatype !== 'DRAWING' && okWidth) return rec;
  }
  // P373: the entity's Commons category — mined under the strict guardrails.
  const cat = claims.P373 && claims.P373[0] && claims.P373[0].mainsnak?.datavalue?.value;
  if (cat) {
    const rec = await resolveCommonsCategory(cat, name);
    if (rec) return rec;
  }
  return null;
}

// back-compat shim: W4 callers / tests may import resolveWikidataImage. It now
// resolves P18-or-P373 (name optional). Kept so external imports don't break.
export const resolveWikidataImage = (qid, name = '') => resolvePlaceImage(qid, name);

function loadJson(file, empty) {
  if (!existsSync(file)) return empty;
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    return c && typeof c === 'object' ? c : empty;
  } catch {
    return empty;
  }
}
const loadCache = () => {
  const c = loadJson(CACHE_FILE, { fetchedAt: null, byQid: {} });
  return c.byQid ? c : { fetchedAt: null, byQid: {} };
};
const loadAttrib = () => {
  const c = loadJson(ATTRIB_FILE, { fetchedAt: null, byFile: {} });
  return c.byFile ? c : { fetchedAt: null, byFile: {} };
};

// Mutates each place that carries a wikidata Q-id, setting `image` when a real,
// CREDITED photo resolves (and recording that credit). Pure on places with no
// Q-id; places whose Q-id yields no usable photo keep category-art. enrich is
// the SOLE writer of `image` — it authoritatively sets OR clears it, so a re-run
// after a guardrail tightened drops a now-disqualified photo. Returns counts.
export async function enrichPlacesWithImages(places, { live = false, log = () => {} } = {}) {
  const cache = loadCache();
  const attrib = loadAttrib();
  const stats = {
    withQid: 0, set: 0, fromCache: 0, fetched: 0, noImage: 0,
    tooSmall: 0, noCredit: 0, viaP18: 0, viaP373: 0,
  };
  let dirty = false; // only rewrite the TRACKED caches when content changed
  let attribDirty = false;
  const shippedFiles = new Set(); // attributions to keep (prune the rest)
  for (const p of places) {
    if (!p || !p.wikidata) continue;
    stats.withQid++;
    const cached = cache.byQid[p.wikidata];
    // freshness also requires the NEW record shape (3.7P-2 review P1): a pre-3.7P-2
    // record carries `image` but no `license`/`source` key — trusting it verbatim
    // would fail the credit gate below and silently drop a good photo. Treat such
    // a record as stale so it re-resolves (a live run self-heals an old cache).
    const newShape = cached && (!cached.image || 'license' in cached);
    const fresh = cached && cached.at && newShape && Date.now() - Date.parse(cached.at) < MAX_CACHE_AGE_MS;
    let rec;
    if (cached && fresh && !live) {
      rec = cached;
      stats.fromCache++;
    } else {
      try {
        const r = await resolvePlaceImage(p.wikidata, p.name);
        rec = r
          ? {
              image: r.image, file: r.file, fileTitle: r.fileTitle, fileUrl: r.fileUrl,
              width: r.width, source: r.source, license: r.license,
              licenseUrl: r.licenseUrl, author: r.author, at: new Date().toISOString(),
            }
          : { image: null, file: null, fileTitle: null, width: null, source: null, license: null, at: new Date().toISOString() };
        cache.byQid[p.wikidata] = rec;
        dirty = true;
        stats.fetched++;
        await sleep(120); // politeness between live Wikimedia calls
      } catch (e) {
        // network hiccup: fall back to any cached value, else leave art
        rec = cached || { image: null, file: null, fileTitle: null, width: null, source: null, license: null, at: new Date().toISOString() };
        log(`  ⚠️  ${p.wikidata} (${p.name}): ${e.message || e}`);
      }
    }
    // credit-required + resolution floor: a photo ships ONLY with a SATISFIABLE
    // credit (license, plus an author when the license is CC-BY) at/above the hero
    // floor. Otherwise the honest art floor stays. enrich also stamps the inline
    // credit ON the place (p.imageCredit) so the place-detail hero can render the
    // byline the CC-BY/BY-SA license legally requires — no live call, no lookup.
    if (rec.image && creditOk(rec) && (rec.width == null || rec.width >= MIN_HERO_W)) {
      const fileUrl = rec.fileUrl || 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(rec.fileTitle);
      p.image = rec.image;
      p.imageCredit = {
        author: rec.author || null,
        license: rec.license,
        licenseUrl: rec.licenseUrl || null,
        url: fileUrl,
      };
      stats.set++;
      if (rec.source === 'wikidata-p373') stats.viaP373++;
      else stats.viaP18++;
      if (rec.fileTitle) {
        shippedFiles.add(rec.fileTitle);
        const cur = attrib.byFile[rec.fileTitle];
        const next = {
          file: rec.fileTitle,
          fileUrl,
          author: rec.author || null,
          license: rec.license,
          licenseUrl: rec.licenseUrl || null,
          sourceFamily: rec.source || null,
          at: (cur && cur.at) || new Date().toISOString(), // stable for idempotency
        };
        if (
          !cur || cur.author !== next.author || cur.license !== next.license ||
          cur.licenseUrl !== next.licenseUrl || cur.sourceFamily !== next.sourceFamily ||
          cur.fileUrl !== next.fileUrl
        ) {
          attrib.byFile[rec.fileTitle] = next;
          attribDirty = true;
        }
      }
    } else {
      if ('image' in p) delete p.image;
      if ('imageCredit' in p) delete p.imageCredit;
      if (rec.image && !creditOk(rec)) stats.noCredit++;
      else if (rec.image) stats.tooSmall++;
      stats.noImage++;
    }
  }
  // prune attribution entries for files no longer shipped by any place, so the
  // ledger never advertises a credit for an image the app doesn't show (the
  // sources-disclosed pillar = exactly what's on screen). 3.7P-2 review P2.
  for (const f of Object.keys(attrib.byFile)) {
    if (!shippedFiles.has(f)) {
      delete attrib.byFile[f];
      attribDirty = true;
    }
  }
  // idempotent: a warm offline run must leave the tracked caches byte-identical.
  if (dirty) {
    cache.fetchedAt = new Date().toISOString();
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  }
  if (attribDirty) {
    attrib.fetchedAt = new Date().toISOString();
    writeFileSync(ATTRIB_FILE, JSON.stringify(attrib, null, 2));
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
      `${path}: ${stats.set}/${stats.withQid} imaged ` +
        `(P18 ${stats.viaP18}, P373 ${stats.viaP373}; fetched ${stats.fetched}, cache ${stats.fromCache}, ` +
        `none ${stats.noImage} [too-small ${stats.tooSmall}, no-credit ${stats.noCredit}])`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
