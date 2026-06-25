// places-images.mjs — W4 (Phase 3.5) + 3.7P-2 (Phase 3.7): give a place a REAL
// photo of ITSELF, with a captured credit.
//
// THE HONEST-IMAGES CONTRACT (Josh, 2026-06-15): a place image is ONLY ever a
// verified photo OF THAT ACTUAL PLACE — never a representative stand-in (a
// generic park photo on a specific park would imply it's that place: soft
// fabrication, rejected). We trust three of-the-place provenances, EACH gated by
// the same name-match + credit checks; first hit wins:
//   • P18 ("image") — the Wikidata entity's single curated lead photo. Strongest.
//   • P373 ("Commons category") — the entity's OWN category; its file members
//     are curated-as-depicting that exact entity (3.7P-2 fallback when no P18).
//   • Commons GEOSEARCH + name-match (honest-imagery Phase 1) — for the ~97% of
//     places with coords but no usable Q-id: geotagged Commons files within 500m,
//     then the SAME name-match HARD GATE turns "near" into "of" (resolveCommonsGeosearch).
// Places where all fail keep their category-art (the honest floor — refined in
// W4's CSS, never faked). NO generic stock (the A3 category-stock floor was rejected).
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
// honest-imagery Phase 1: the place-KEYED cache for the Commons GEOSEARCH ladder
// step (the ~97% of places with coords but no usable Q-id), alongside the Q-id
// cache above. Same shape/TTL; keyed by place.key.
const GEO_CACHE_FILE = join(HERE, 'cache', 'place-geo-images.json');
// Phase 2: the place-keyed Mapillary cache (cafes). The stored URL expires ~30d.
const MLY_CACHE_FILE = join(HERE, 'cache', 'place-mapillary-images.json');
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
// Tampa-Bay TOWN / CITY / ISLAND / NEIGHBORHOOD words (Phase-1.1 honesty cleanup).
// A 2-word phrase made ENTIRELY of these is an AREA match — it proves the file is
// in the same area, NOT that it's OF a specific venue there (a generic "Davis
// Islands, Tampa - panoramio" geotag on "Davis Islands Park", or an "Anna Maria
// Pier" on "Anna Maria Bayfront Park"). Generic geo-feature words that pair with a
// town to form an area name (beach/island/springs/harbor/key) are here too; a
// DISTINCTIVE word beside them still makes a strong phrase ("Coquina Beach",
// "Bonnet Springs"). The bar: precision over coverage.
const AREA = new Set(
  ('saint petersburg pete tampa clearwater dunedin sarasota bradenton brandon riverview ' +
    'seminole largo gulfport palmetto tarpon springs safety harbor temple terrace treasure ' +
    'island islands anna maria davis sand key bird ybor pine hernando pinellas hillsborough ' +
    'manatee indian rocks shores redington madeira grille apollo ruskin oldsmar estates hyde ' +
    'westshore channelside beach county usa florida fl').split(' ')
);
// the N-word phrases of a place name (contiguous), skipping leading/trailing 1-char
// fragments and (for 2-word) all-generic pairs ("state park") that carry no signal.
const namePhrases = (name, n) => {
  const words = (name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i + n - 1 < words.length; i++) {
    const seg = words.slice(i, i + n);
    if (seg[0].length < 2 || seg[n - 1].length < 2) continue;
    if (n === 2 && STOP.has(seg[0]) && STOP.has(seg[1])) continue;
    out.push(seg.join(' '));
  }
  return out;
};
const phraseAreaOnly = (ph) => ph.split(' ').every((w) => AREA.has(w));
// STRONG name-match for the GEOSEARCH path (geosearch has no category-membership
// proof — proximity only). A geotagged file ships ONLY if it names THIS place:
//   • it contains a 3-WORD phrase from the place name (strong: it names the full
//     specific place — "Treasure Island Beach.jpg" for "Treasure Island Beach"), OR
//   • it contains a 2-WORD phrase that is NOT purely town/city/island words (so a
//     mere shared neighborhood — "anna maria", "davis islands" — is not enough).
// A 1-word place name (a town node like "Brandon") never matches. This rejects the
// generic-area geotags + adjacent-subject photos the single-token gate let through.
const nameMatchStrong = (fileTitle, name) => {
  const t = (fileTitle || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (namePhrases(name, 3).some((ph) => t.includes(ph))) return true;
  const strong = namePhrases(name, 2).filter((ph) => !phraseAreaOnly(ph));
  return strong.length > 0 && strong.some((ph) => t.includes(ph));
};

// Wikidata P18/P373 entity-image conflations to EXCLUDE (Phase-1.1): a place whose
// Wikidata entity carries a curated image that is NOT of-the-place. Q966471 "Gwazi"
// is now imaged with the Iron Gwazi COASTER that replaced the Gwazi field — an
// adjacent subject, not the field. P18 stays lenient otherwise (gating it would
// collateral-drop genuine curated photos like DeSoto Memorial / Weedon Island).
const QID_DENY = new Set(['Q966471']);
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

// shared honest pick (the P373 category path + the NEW geosearch path): from the
// credit-passed candidates, apply the name-match HARD GATE — a file must match the
// place name, because "in the category" / "near the coords" only becomes "OF this
// place" with the name — and the deterministic establishing-shot ordering (earliest
// name-token position, then alphabetical). `strong` (geosearch) requires a 2-word
// phrase; the weak token-match is for P373 (already fenced by category membership).
// Returns the best record | null.
function bestNamedRecord(cands, name, { strong = false } = {}) {
  const toks = nameTokens(name);
  const match = strong
    ? (c) => nameMatchStrong(c.fileTitle, name)
    : (c) => toks.length > 0 && titleMatchesName(c.fileTitle, toks);
  const named = cands.filter(match);
  if (!named.length) return null;
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
  return bestNamedRecord(cands, name);
}

// honest-imagery Phase 1 — resolve a REAL of-the-place photo by COORDS. A near-
// clone of resolveCommonsCategory: it swaps the category generator for a Commons
// GEOSEARCH (geotagged files within 500m of the place) and runs the IDENTICAL
// honest filter chain — BAD_TITLE + BITMAP + jpeg/png + width floor + creditOk —
// then the SAME name-match HARD GATE (geosearch returns "near"; the name match is
// the proof it's "of"). Covers the ~97% of places with coords but no usable Q-id.
async function resolveCommonsGeosearch(lat, lng, name) {
  // no distinctive name token → we could never prove a file is "of this place".
  // Skip the call entirely (cheaper + honest): keep the art floor.
  const toks = nameTokens(name);
  if (!toks.length) return null;
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&generator=geosearch&ggscoord=${lat}%7C${lng}&ggsradius=500&ggslimit=40&ggsnamespace=6` +
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
    const rec = recFromImageInfo(info, t, 'commons-geosearch');
    if (!creditOk(rec)) continue; // credit-required (license + author when CC-BY)
    cands.push(rec);
  }
  // the STRONG name-match gate (geosearch has no category-membership proof): a
  // geotagged file near the coords ships ONLY if its title contains a 2-word phrase
  // from the place name — not just a shared neighborhood token. Otherwise art.
  return bestNamedRecord(cands, name, { strong: true });
}

// ── Mapillary selection TUNABLES (surfaced for the scout's visual judgement) ──
// quality over quantity: ship a frame ONLY when the camera is actually pointing at
// the cafe. Loosen for more coverage, tighten for more precision.
const MLY_MAX_DIST_M = 30; // the capture must be within this many metres of the cafe
const MLY_MAX_ALIGN_DEG = 45; // the camera heading must be within this of the bearing-to-cafe

// small-angle / short-distance geo helpers (metres + degrees, WGS84-ish).
const _toRad = (d) => (d * Math.PI) / 180;
const _toDeg = (r) => (r * 180) / Math.PI;
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = _toRad(lat2 - lat1), dLng = _toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function initialBearingDeg(lat1, lng1, lat2, lng2) {
  const φ1 = _toRad(lat1), φ2 = _toRad(lat2), Δλ = _toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (_toDeg(Math.atan2(y, x)) + 360) % 360;
}
function angularDiffDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Phase 2 (reworked — facing-camera selection) — Mapillary street-level for cafes,
// where Commons has nothing. v4 Graph API candidates in a ~40m bbox; KEEP only a
// flat (non-pano) frame that is CLOSE (≤ MLY_MAX_DIST_M) AND whose camera HEADING
// points roughly AT the cafe (align ≤ MLY_MAX_ALIGN_DEG) — so it ships a frame
// FACING the storefront, not a random roadside one pointing away. Best survivor =
// smallest align, distance as tiebreak; none qualify → null (art floor). 360 panos
// are dropped (their flat thumbs are distorted). CC-BY-SA 4.0 credit. Honesty: a
// frame at ≤30m pointing at the venue is a real photo OF the storefront. ⚠ the
// thumb_1024_url is a SIGNED CDN URL that expires ~30 days out (≈ the cache TTL).
// SECURITY: token read from process.env.MAPILLARY_TOKEN ONLY — never hardcoded /
// logged. Graceful skip (null) when the env var is unset.
async function resolveMapillary(lat, lng) {
  const token = process.env.MAPILLARY_TOKEN;
  if (!token) return null;
  const d = 0.0005; // ~50m half-box — wide enough to hold every ≤30m candidate
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const fields = 'id,geometry,compass_angle,computed_compass_angle,is_pano,captured_at,thumb_1024_url,creator';
  const api = `https://graph.mapillary.com/images?fields=${fields}&bbox=${bbox}&limit=40`;
  const r = await fetch(api, { headers: { Authorization: `OAuth ${token}` } })
    .then((x) => (x.ok ? x.json() : null))
    .catch(() => null);
  const data = (r && Array.isArray(r.data) && r.data) || [];
  const survivors = [];
  for (const c of data) {
    if (!c || !c.thumb_1024_url) continue;
    if (c.is_pano !== false) continue; // drop 360 panos (distorted flat thumbs)
    const co = c.geometry && c.geometry.coordinates;
    if (!Array.isArray(co) || co.length < 2) continue;
    const [capLng, capLat] = co;
    const heading = c.compass_angle ?? c.computed_compass_angle;
    if (heading == null || Number.isNaN(heading)) continue; // can't verify facing → skip
    const dist = haversineM(capLat, capLng, lat, lng);
    if (dist > MLY_MAX_DIST_M) continue;
    const align = angularDiffDeg(initialBearingDeg(capLat, capLng, lat, lng), heading);
    if (align > MLY_MAX_ALIGN_DEG) continue; // camera faces away from the cafe
    survivors.push({ c, dist, align });
  }
  if (!survivors.length) return null;
  // best: most-aligned (facing the cafe), nearest as the tiebreak.
  survivors.sort((a, b) => a.align - b.align || a.dist - b.dist);
  const best = survivors[0].c;
  const year = best.captured_at ? new Date(best.captured_at).getFullYear() : null;
  const who = (best.creator && best.creator.username) || 'a Mapillary contributor';
  return {
    image: best.thumb_1024_url,
    file: `mapillary-${best.id}`,
    fileTitle: `Mapillary:${best.id}`,
    fileUrl: `https://www.mapillary.com/app/?pKey=${best.id}`,
    width: 1024,
    mediatype: 'BITMAP',
    mime: 'image/jpeg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    author: year ? `${who} via Mapillary (${year})` : `${who} via Mapillary`,
    source: 'mapillary',
  };
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
// honest-imagery Phase 1: the geosearch cache, keyed by place.key.
const loadGeoCache = () => {
  const c = loadJson(GEO_CACHE_FILE, { fetchedAt: null, byKey: {} });
  return c.byKey ? c : { fetchedAt: null, byKey: {} };
};
const loadMlyCache = () => {
  const c = loadJson(MLY_CACHE_FILE, { fetchedAt: null, byKey: {} });
  return c.byKey ? c : { fetchedAt: null, byKey: {} };
};
// normalize a resolver record (or null) into the cached/stored shape + timestamp.
const storeRec = (r) =>
  r
    ? {
        image: r.image, file: r.file, fileTitle: r.fileTitle, fileUrl: r.fileUrl,
        width: r.width, source: r.source, license: r.license,
        licenseUrl: r.licenseUrl, author: r.author, at: new Date().toISOString(),
      }
    : { image: null, file: null, fileTitle: null, width: null, source: null, license: null, at: new Date().toISOString() };
// a record ships ONLY with an image + a satisfiable credit + the hero width floor.
const shippable = (rec) => !!(rec && rec.image && creditOk(rec) && (rec.width == null || rec.width >= MIN_HERO_W));

// Mutates EVERY place with coords, setting `image` when a real, CREDITED photo of
// THAT place resolves (and recording its credit). Per place, a real-photo LADDER —
// first hit wins: (1) Wikidata Q-id (P18 → P373) for the ~3% with a Q-id, then
// (2) NEW Commons geosearch + name-match for the rest with coords. enrich is the
// SOLE writer of `image` — it authoritatively sets OR clears it, so a re-run after a
// guardrail tightened drops a now-disqualified photo. No generic stock. Returns counts.
export async function enrichPlacesWithImages(places, { live = false, log = () => {} } = {}) {
  const cache = loadCache();
  const geoCache = loadGeoCache();
  const mlyCache = loadMlyCache();
  const attrib = loadAttrib();
  const stats = {
    withQid: 0, set: 0, fromCache: 0, fetched: 0, noImage: 0,
    tooSmall: 0, noCredit: 0, viaP18: 0, viaP373: 0,
    geoTried: 0, geoFetched: 0, geoFromCache: 0, viaGeo: 0,
    mlyTried: 0, mlyFetched: 0, mlyFromCache: 0, viaMapillary: 0,
  };
  let dirty = false; // only rewrite the TRACKED caches when content changed
  let geoDirty = false;
  let mlyDirty = false;
  let attribDirty = false;
  const shippedFiles = new Set(); // attributions to keep (prune the rest)
  for (const p of places) {
    if (!p) continue;
    const hasCoords = typeof p.lat === 'number' && typeof p.lng === 'number';
    let rec = null;

    // ── ladder 1: Wikidata Q-id (P18 → P373) — the curated, strongest signal ──
    if (p.wikidata && !QID_DENY.has(p.wikidata)) {
      stats.withQid++;
      const cached = cache.byQid[p.wikidata];
      // freshness also requires the NEW record shape (3.7P-2 review P1): a pre-3.7P-2
      // record carries `image` but no `license`/`source` key — trusting it verbatim
      // would fail the credit gate below and silently drop a good photo. Treat such
      // a record as stale so it re-resolves (a live run self-heals an old cache).
      const newShape = cached && (!cached.image || 'license' in cached);
      const fresh = cached && cached.at && newShape && Date.now() - Date.parse(cached.at) < MAX_CACHE_AGE_MS;
      if (cached && fresh && !live) {
        rec = cached;
        stats.fromCache++;
      } else {
        try {
          rec = storeRec(await resolvePlaceImage(p.wikidata, p.name));
          cache.byQid[p.wikidata] = rec;
          dirty = true;
          stats.fetched++;
          await sleep(120); // politeness between live Wikimedia calls
        } catch (e) {
          rec = cached || storeRec(null); // network hiccup → cached value, else art
          log(`  ⚠️  ${p.wikidata} (${p.name}): ${e.message || e}`);
        }
      }
    }

    // ── ladder 2: Commons GEOSEARCH + name-match (the big outdoor win) — only if
    //    the Q-id step didn't ship. Runs over EVERY place with coords + a name;
    //    the name-match HARD GATE inside makes "near" → "of". Place-keyed cache. ──
    if (!shippable(rec) && hasCoords && p.name) {
      stats.geoTried++;
      const gkey = p.key || `${p.lat},${p.lng}`;
      const gcached = geoCache.byKey[gkey];
      const gNewShape = gcached && (!gcached.image || 'license' in gcached);
      const gfresh = gcached && gcached.at && gNewShape && Date.now() - Date.parse(gcached.at) < MAX_CACHE_AGE_MS;
      let grec;
      if (gcached && gfresh && !live) {
        grec = gcached;
        stats.geoFromCache++;
      } else {
        try {
          grec = storeRec(await resolveCommonsGeosearch(p.lat, p.lng, p.name));
          geoCache.byKey[gkey] = grec;
          geoDirty = true;
          stats.geoFetched++;
          await sleep(120);
        } catch (e) {
          grec = gcached || storeRec(null);
          log(`  ⚠️  geo ${gkey} (${p.name}): ${e.message || e}`);
        }
      }
      // ship only a STRONG (2-word-phrase) name match — re-validated HERE so a
      // cached weak pick (from before the gate tightened) self-corrects to the art
      // floor on a warm run, no re-fetch needed.
      if (shippable(grec) && nameMatchStrong(grec.fileTitle, p.name)) rec = grec;
    }

    // ── ladder 3: Mapillary street-level (CAFES only) — where Commons has nothing.
    //    "At the location" (a real capture at the cafe's coords), credited CC-BY-SA.
    //    Skipped entirely when MAPILLARY_TOKEN is unset (Phase-1 runs need nothing). ──
    if (!shippable(rec) && hasCoords && p.placeType === 'cafe' && process.env.MAPILLARY_TOKEN) {
      stats.mlyTried++;
      const mkey = p.key || `${p.lat},${p.lng}`;
      const mcached = mlyCache.byKey[mkey];
      const mfresh = mcached && mcached.at && ('license' in mcached || !mcached.image) && Date.now() - Date.parse(mcached.at) < MAX_CACHE_AGE_MS;
      let mrec;
      if (mcached && mfresh && !live) {
        mrec = mcached;
        stats.mlyFromCache++;
      } else {
        try {
          mrec = storeRec(await resolveMapillary(p.lat, p.lng));
          mlyCache.byKey[mkey] = mrec;
          mlyDirty = true;
          stats.mlyFetched++;
          await sleep(120);
        } catch (e) {
          mrec = mcached || storeRec(null);
          log(`  ⚠️  mapillary ${mkey} (${p.name}): ${e.message || e}`);
        }
      }
      if (shippable(mrec)) rec = mrec;
    }

    // ── ship the winning record, or clear ──
    // credit-required + resolution floor: a photo ships ONLY with a SATISFIABLE
    // credit (license, plus an author when CC-BY) at/above the hero floor. Otherwise
    // the honest art floor stays. enrich also stamps the inline credit ON the place
    // (p.imageCredit) so the place-detail hero can render the byline the CC-BY/BY-SA
    // license legally requires — no live call, no lookup.
    if (shippable(rec)) {
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
      else if (rec.source === 'commons-geosearch') stats.viaGeo++;
      else if (rec.source === 'mapillary') stats.viaMapillary++;
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
      if (rec && rec.image && !creditOk(rec)) stats.noCredit++;
      else if (rec && rec.image) stats.tooSmall++;
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
  if (geoDirty) {
    geoCache.fetchedAt = new Date().toISOString();
    writeFileSync(GEO_CACHE_FILE, JSON.stringify(geoCache, null, 2));
  }
  if (mlyDirty) {
    mlyCache.fetchedAt = new Date().toISOString();
    writeFileSync(MLY_CACHE_FILE, JSON.stringify(mlyCache, null, 2));
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
    const total = doc.places.length;
    console.log(
      `${path}: ${stats.set}/${total} imaged (${((stats.set / total) * 100).toFixed(1)}%) ` +
        `— P18 ${stats.viaP18}, P373 ${stats.viaP373}, geosearch ${stats.viaGeo}, mapillary ${stats.viaMapillary} ` +
        `(geo: tried ${stats.geoTried}, fetched ${stats.geoFetched}/cache ${stats.geoFromCache}; ` +
        `mly: tried ${stats.mlyTried}, fetched ${stats.mlyFetched}/cache ${stats.mlyFromCache}; ` +
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
