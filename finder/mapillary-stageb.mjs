// =============================================================================
// finder/mapillary-stageb.mjs — STRICT deterministic ship-gate for the vision pass.
//
// Stage A (agent, name-blind) transcribed each crop → { signsRead, confidence,
// isCafeStorefront, otherBusinessNameOnSign, isDirectoryOrPylon,
// cafeIsDominantSubject, imageQuality, sceneNote }. Stage B
// (here, name-AWARE, deterministic) decides ship/no-ship in TWO tiers:
//
//   • TIER A — the cafe's own identity is IN the image (name-match). LENIENT in
//     Phase B: exact phrase/token, partial/occluded token ("ahwa"⊂"kahwa"), fuzzy
//     OCR (Levenshtein ≤2), and address-number ("1001"). Auto-ship.
//   • TIER B — "confirmed-location storefront": NO name-match, BUT the vision pass
//     says it is clearly a cafe storefront AND there is NO conflicting other-business
//     sign AND it is a strong geometric candidate (tight align + distance). Auto-ship,
//     but FLAGGED into phaseB-tierB-review.md for Josh's ONE-TIME eyeball before lock.
//
// Keeping the match deterministic + transcription name-blind means the model can't
// prime an illegible sign into the expected name. Among a cafe's qualifying crops we
// pick the BEST-QUALITY one (no quality FLOOR — correct-but-ugly still ships).
//
// Reads: _review/_transcriptions.json (Stage A), _review/_map.json (rid→key,name),
//        mapillary-crops/_manifest.json (crop geometry/urls/creator).
// Writes (always): finder/cache/<cityId>/phaseB-mapillary-report.md,
//        phaseB-tierB-review.md, _review/_verdicts.json.
// Writes (--ship): finder/cache/<cityId>/place-mapillary-images.json + copies the
//        chosen crops to finder/output/<cityId>/place-img/<slug>.jpg (clears ONLY
//        that city's dir first; deploy.mjs ships the dir into the app).
// =============================================================================
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  area as cityArea,
  cafe as cityCafe,
  imageRejects,
  imagery as cityImagery,
  cityId,
  tz as CITY_TZ,
} from './cities/index.mjs';
import { invalidateManifest } from './artifact-manifest.mjs';
import { hasMapillaryGuardSignals, mapillaryCropFailsClosed } from './mapillary-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// D1: crop scratch + the shipped-cafes cache are per-city (finder/cache/<cityId>/)
const CROP_DIR = path.join(ROOT, 'finder', 'cache', cityId, 'mapillary-crops');
const REVIEW = path.join(CROP_DIR, '_review');
// D1: --ship writes the PER-CITY artifact dir — rmSync below clears ONLY this
// city's crops (the old app/public/place-img target deleted Tampa's 35 ships on
// any other city's run). deploy.mjs is what copies the dir into app/public/.
const PLACE_IMG = path.join(ROOT, 'finder', 'output', cityId, 'place-img');
const OUTPUT_ROOT = path.join(ROOT, 'finder', 'output', cityId);
const MAP_CACHE = path.join(ROOT, 'finder', 'cache', cityId, 'place-mapillary-images.json');

// thresholds: config DEFAULTS (per active city), env vars still override at runtime.
const CONF_FLOOR = Number(process.env.CONF_FLOOR || cityImagery.confFloor);
const TIERB_MAX_ALIGN = Number(process.env.TIERB_MAX_ALIGN || cityImagery.tierBMaxAlign);
const TIERB_MAX_D = Number(process.env.TIERB_MAX_D || cityImagery.tierBMaxD);
const TIERB_MIN_QUALITY = Number(process.env.TIERB_MIN_QUALITY || cityImagery.tierBMinQuality);
const SHIP = process.argv.includes('--ship');

// ---- name-match (mirrors places-images.mjs, extended + lenient for cafes) ----
const STOP = new Set([
  'park', 'beach', 'lake', 'river', 'trail', 'trails', 'center', 'centre', 'the', 'and',
  'state', 'county', 'preserve', 'area', 'recreation', 'nature', 'reserve', 'point',
  'island', 'bay', 'creek', 'springs', 'spring', 'garden', 'gardens', 'museum',
]);
const GENERIC_CAFE = new Set([
  ...STOP, 'cafe', 'café', 'coffee', 'coffeehouse', 'coffeeshop', 'roasters', 'roastery',
  'roasting', 'roasted', 'roast', 'espresso', 'bakery', 'brew', 'brews', 'brewing',
  'tea', 'co', 'company', 'shop', 'shoppe', 'house', 'bar', 'kitchen', 'eatery',
  'juicery', 'juice', 'kombucha', 'drip', 'grind', 'beans', 'bean', 'donuts', 'donut',
  // business-CATEGORY / descriptor words — they describe a TYPE or quality, not an
  // identity, so a match must NOT rest on them alone (a beach-town "SURF" sign for an
  // unrelated surf shop matched "Grove Surf Café"; a generic "GOURMET COFFEE" awning
  // matched "Pascal's Artisan Bistro & Gourmet Coffee"). A distinctive token beside
  // them still matches; distinctive multi-word names (Indian Shores / Tenth Street
  // Coffee) keep their distinctive tokens and are unaffected.
  'surf', 'deli', 'market', 'bistro', 'grill', 'grille', 'diner', 'pub', 'tavern',
  'lounge', 'pizzeria', 'pizza', 'taqueria', 'taco', 'tacos', 'sushi', 'grocery',
  'restaurant', 'food', 'foods', 'creamery', 'parlor',
  'gourmet', 'artisan', 'fresh', 'iced', 'organic', 'premium', 'specialty',
  'handcrafted', 'handmade', 'craft', 'fine', 'local', 'fresh', 'served',
  ...cityCafe.genericExtra, // per-city local-vocab additions (none for Tampa)
]);
// the canonical AREA gazetteer (from the active city config — same source as the
// Commons geosearch ladder) PLUS the cafe-directional extras for THIS matcher only
// (north/south/… would change places.json if added to the canonical list, so they
// live in cafe.areaExtra, not the shared gazetteer).
const AREA = new Set([...cityArea.split(' '), ...cityCafe.areaExtra]);
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const phrases = (name, n) => {
  const w = norm(name).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i + n - 1 < w.length; i++) {
    const seg = w.slice(i, i + n);
    if (seg[0].length < 2 || seg[n - 1].length < 2) continue;
    if (n === 2 && GENERIC_CAFE.has(seg[0]) && GENERIC_CAFE.has(seg[1])) continue;
    out.push(seg.join(' '));
  }
  return out;
};
const phraseAreaOnly = (ph) => ph.split(' ').every((w) => AREA.has(w));
const distinctiveTokens = (name) =>
  [...new Set(norm(name).split(' '))].filter((t) => t.length >= 4 && !GENERIC_CAFE.has(t) && !AREA.has(t));
const numberTokens = (name) =>
  [...new Set(norm(name).split(' '))].filter((t) => /^\d{3,}$/.test(t));

// match ONE sign string against the cafe name. Strongest match wins.
// kind: phrase3 > phrase2 > token > number > tokenPartial > fuzzy > none.
// The last two (partial/fuzzy) are the Phase-B LENIENT additions and are flagged.
const LENIENT = new Set(['tokenPartial', 'number']);
function matchSign(sign, name) {
  const s = ' ' + norm(sign) + ' ';
  for (const ph of phrases(name, 3)) if (s.includes(' ' + ph + ' ') || norm(sign).includes(ph)) return { kind: 'phrase3', matched: ph };
  for (const ph of phrases(name, 2).filter((p) => !phraseAreaOnly(p))) if (norm(sign).includes(ph)) return { kind: 'phrase2', matched: ph };
  const words = norm(sign).split(' ').filter(Boolean);
  const toks = distinctiveTokens(name);
  for (const t of toks) if (words.includes(t)) return { kind: 'token', matched: t };
  for (const t of numberTokens(name)) if (words.includes(t)) return { kind: 'number', matched: t };
  // LENIENT — edge-occlusion: a sign word (≥5 chars) is a PREFIX or SUFFIX of a
  // distinctive name token (≥6 chars). Models a pole/tree hiding the START or END of
  // the sign ("tarbucks" for Starbucks, "gypsy" for GypsySouls, "biker" for Bikery).
  // We deliberately do NOT use edit-distance fuzziness or a token buried inside a
  // longer DIFFERENT word — both produced false positives in Phase B (Fast Jacks ⊂
  // "Jackson's"; "brian"~"brown" → a barbershop; "daily"~"wally" → a steak special).
  for (const t of toks) {
    if (t.length < 6) continue;
    for (const w of words) {
      if (w.length >= 5 && w !== t && (t.startsWith(w) || t.endsWith(w))) return { kind: 'tokenPartial', matched: `${w}⊂${t}` };
    }
  }
  return { kind: 'none', matched: null };
}
const RANK = { phrase3: 6, phrase2: 5, token: 4, number: 4, tokenPartial: 3, none: 0 };
const STRONG = new Set(['phrase3', 'phrase2', 'token', 'number']); // vs LENIENT tier

// a crop is INELIGIBLE for EITHER tier (the multi-city lock, 2026-06-26). The two
// guard signals come from the name-blind transcription. The current workflow fields
// take precedence, with rj* aliases retained for older saved transcriptions. A crop
// fails
// when it's a multi-tenant DIRECTORY/PYLON that merely LISTS businesses (the 2
// Starbucks pylons), OR a DIFFERENT business is the dominant subject — encoded as
// cafeIsDominantSubject===false AND a specific OTHER business is named (so a
// non-coffee food
// venue like "The Sandwich on Main", whose own sign just isn't a coffee cafe, is
// NOT false-dropped; only a genuine other-business hero like La Casa's tattoo shop is).
// FAIL CLOSED: a crop with NO re-judge signal CANNOT ship. A skipped or incomplete
// re-judge must DISABLE its crops, not silently disable the pylon + dominant guards —
// the fail-OPEN bug was the exact failure mode behind the 4 Tampa false positives. The
// guarantee that every shipped crop was re-verified is enforced again at ship time
// (the cache records reVerified) and asserted in the smoke harness.
// ---- evaluate one cafe across its crops → a tier-A or tier-B ship, or reject --
// bypassGuards: a force-KEEP cafe (Josh's explicit call) is exempt from the pylon/
// dominant guards (a faint-wordmark storefront can read as "not dominant").
function evalCafe(rec, crops, cropMetaByI, bypassGuards = false) {
  const q = (cr) => (cr.imageQuality ?? cr.confidence ?? 0.5);
  const eligible = (cr) => bypassGuards || !mapillaryCropFailsClosed(cr);
  // Tier A candidates: a name-match at/above the confidence floor, on an eligible crop
  const tierA = [];
  for (const cr of crops) {
    if ((cr.confidence ?? 0) < CONF_FLOOR) continue;
    if (!eligible(cr)) continue;
    let best = { kind: 'none', matched: null, sign: null };
    for (const sg of cr.signsRead || []) {
      const m = matchSign(sg, rec.name);
      if (RANK[m.kind] > RANK[best.kind]) best = { ...m, sign: sg };
    }
    if (best.kind !== 'none') tierA.push({ cropI: cr.i, ...best, q: q(cr), confidence: cr.confidence, sceneNote: cr.sceneNote });
  }
  if (tierA.length) {
    // prefer STRONG matches over lenient; within the best tier, best image quality
    const anyStrong = tierA.some((c) => STRONG.has(c.kind));
    const pool = tierA.filter((c) => (anyStrong ? STRONG.has(c.kind) : true));
    pool.sort((a, b) => b.q - a.q || b.confidence - a.confidence || a.cropI - b.cropI);
    const pick = pool[0];
    return { tier: 'A', cropI: pick.cropI, matchKind: pick.kind, matched: pick.matched, sign: pick.sign,
      lenient: LENIENT.has(pick.kind), quality: pick.q, confidence: pick.confidence, sceneNote: pick.sceneNote };
  }
  // Tier B candidates: clear cafe storefront, no conflicting business, strong geometry
  const tierB = [];
  for (const cr of crops) {
    if (!eligible(cr)) continue;
    const meta = cropMetaByI[cr.i] || {};
    // a pano is REPROJECTED to face the cafe (yaw = bearingToCafe), so its stored
    // camera-heading align is irrelevant — only distance gates it. A flat frame must
    // also be squarely aimed (tight align).
    const isPano = meta.kind === 'pano';
    const geomStrong = meta.d != null && meta.d <= TIERB_MAX_D &&
      (isPano || (meta.align != null && meta.align <= TIERB_MAX_ALIGN));
    const ob = cr.otherBusinessNameOnSign;
    const noConflict = !ob || /^(none|null|n\/?a|no|na)$/i.test(String(ob).trim());
    if (cr.isCafeStorefront === true && noConflict && geomStrong && q(cr) >= TIERB_MIN_QUALITY) {
      tierB.push({ cropI: cr.i, q: q(cr), align: meta.align, d: meta.d, sceneNote: cr.sceneNote, confidence: cr.confidence });
    }
  }
  if (tierB.length) {
    tierB.sort((a, b) => b.q - a.q || a.align - b.align || a.cropI - b.cropI);
    const pick = tierB[0];
    return { tier: 'B', cropI: pick.cropI, matchKind: 'tierB-storefront', matched: null, sign: null,
      lenient: true, quality: pick.q, confidence: pick.confidence, sceneNote: pick.sceneNote, align: pick.align, d: pick.d };
  }
  return null;
}

// Per-city verified verdict sets from the active city config (Tampa's live in
// finder/cities/tampa-bay.mjs — Josh's 2026-06-26 adversarial-review pixel calls).
// FORCE_DROP guarantees a verified-FP falls to art-floor even if a guard misjudges;
// FORCE_KEEP exempts a confirmed-genuine ship from the new guards.
const FORCE_DROP = new Set(cityCafe.forceDrop);
const FORCE_KEEP = new Set(cityCafe.forceKeep);

// ---- load inputs -----------------------------------------------------------
const transcriptions = JSON.parse(readFileSync(path.join(REVIEW, '_transcriptions.json'), 'utf8'));
const map = JSON.parse(readFileSync(path.join(REVIEW, '_map.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(CROP_DIR, '_manifest.json'), 'utf8'));
const manByKey = new Map(manifest.cafes.map((c) => [c.key, c]));
const transByRid = new Map(transcriptions.map((t) => [t.rid, t]));
const NOW = new Date().toISOString();

const rows = [];
for (const [rid, rec] of Object.entries(map)) {
  const tr = transByRid.get(rid) || { crops: [] };
  const man = manByKey.get(rec.key) || {};
  const cropMetaByI = Object.fromEntries((man.crops || []).map((c) => [c.i, c]));
  let v = evalCafe(rec, tr.crops || [], cropMetaByI, FORCE_KEEP.has(rec.key));
  if (FORCE_DROP.has(rec.key)) v = null; // Josh's verified-FP removal (belt-and-suspenders)
  const reviewedQuarantine = Boolean(imageRejects[rec.key]);
  if (reviewedQuarantine) v = null;
  const chosenMeta = v ? (cropMetaByI[v.cropI] || {}) : {};
  const chosenCrop = v ? (tr.crops || []).find((c) => c.i === v.cropI) : null;
  const slug = rec.key.replace(/^p\|/, '');
  rows.push({
    rid, key: rec.key, name: rec.name, slug, reviewedQuarantine,
    place: { name: man.name || rec.name, lat: man.lat, lng: man.lng },
    // the honesty receipt: did the CHOSEN crop carry a re-judge guard verdict? (fail-closed)
    reVerified: v ? hasMapillaryGuardSignals(chosenCrop) : null,
    nCandidates: man.nCandidates ?? null, nPersp: man.nPersp ?? null, nPano: man.nPano ?? null,
    ship: !!v, tier: v ? v.tier : null, matchKind: v ? v.matchKind : 'none',
    matched: v ? v.matched : null, lenient: v ? !!v.lenient : false,
    signTextRead: v && v.sign ? v.sign : null,
    quality: v ? +Number(v.quality).toFixed(2) : null,
    confidence: v ? v.confidence : Math.max(0, ...(tr.crops || []).map((c) => c.confidence ?? 0)),
    cropI: v ? v.cropI : null,
    cropPath: v ? (chosenMeta.path || null) : null,
    mapId: v ? (chosenMeta.id || null) : null,
    creator: v ? (chosenMeta.creator || null) : null,
    mapillaryUrl: v ? (chosenMeta.mapillaryUrl || null) : null,
    align: v ? (chosenMeta.align ?? null) : null,
    d: v ? (chosenMeta.d ?? null) : null,
    sceneNote: v ? v.sceneNote : null,
    allSigns: (tr.crops || []).map((c) => ({
      i: c.i, signs: c.signsRead || [], conf: c.confidence, q: c.imageQuality,
      isCafe: c.isCafeStorefront, other: c.otherBusinessNameOnSign, note: c.sceneNote,
    })),
  });
}

const rejectReason = (r) => {
  if (r.ship) return null;
  if (r.reviewedQuarantine) return 'reviewed-image-quarantine';
  const anySign = r.allSigns.some((c) => (c.signs || []).length);
  if (!anySign) return 'no-legible-storefront-sign';
  const anyConf = r.allSigns.some((c) => (c.conf ?? 0) >= CONF_FLOOR);
  if (!anyConf) return 'sign-below-confidence-floor';
  return 'sign-does-not-match-name';
};
rows.forEach((r) => { r.rejectReason = rejectReason(r); });

const totalCafes = manifest.cafes.length;
const cafesWithCand = rows.length;
const shipped = rows.filter((r) => r.ship);
const tierA = shipped.filter((r) => r.tier === 'A');
const tierB = shipped.filter((r) => r.tier === 'B');
const lenientA = tierA.filter((r) => r.lenient);

// ---- write the human receipt: the place-keyed Mapillary cache + JPEGs --------
function tierBReceipt(r) { return `cafe storefront — location-confirmed (align ${r.align}°, ${r.d}m), no conflicting business sign`; }
if (SHIP) {
  // preserve per-entry `at` (and fetchedAt) across re-ships so a re-run is a minimal
  // diff (idempotent timestamps); a genuinely new ship gets NOW.
  const prev = existsSync(MAP_CACHE) ? JSON.parse(readFileSync(MAP_CACHE, 'utf8')) : { byKey: {} };
  const prevByKey = prev.byKey || {};
  invalidateManifest(OUTPUT_ROOT, { expectedCityId: cityId, expectedTimeZone: CITY_TZ, preservePending: true });
  if (existsSync(PLACE_IMG)) rmSync(PLACE_IMG, { recursive: true, force: true });
  mkdirSync(PLACE_IMG, { recursive: true });
  const byKey = {};
  for (const r of shipped) {
    const src = path.join(ROOT, r.cropPath);
    const dst = path.join(PLACE_IMG, `${r.slug}.jpg`);
    copyFileSync(src, dst);
    const imageBytes = readFileSync(dst);
    const metadata = await sharp(imageBytes, { failOn: 'error' }).metadata();
    const decoded = await sharp(imageBytes, { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
    if (
      metadata.format !== 'jpeg' || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) ||
      decoded.info.width !== metadata.width || decoded.info.height !== metadata.height
    ) {
      throw new Error(`shipped crop dimensions unavailable for ${r.key}`);
    }
    if (
      !r.place || typeof r.place.name !== 'string' || !r.place.name.trim() ||
      !Number.isFinite(r.place.lat) || !Number.isFinite(r.place.lng)
    ) throw new Error(`shipped crop place identity unavailable for ${r.key}`);
    byKey[r.key] = {
      id: String(r.mapId),
      image: `/place-img/${r.slug}.jpg`,
      width: metadata.width,
      height: metadata.height,
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      author: r.creator || 'Mapillary contributor',
      signTextRead: r.tier === 'A' ? r.signTextRead : tierBReceipt(r),
      mapillaryUrl: r.mapillaryUrl,
      tier: r.tier,
      matchKind: r.matchKind,
      reVerified: r.reVerified === true, // fail-closed honesty receipt (asserted in smoke)
      place: r.place,
      imageSha256: `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`,
      at: (prevByKey[r.key] && prevByKey[r.key].at) || NOW,
    };
  }
  writeFileSync(MAP_CACHE, JSON.stringify({ fetchedAt: prev.fetchedAt || NOW, byKey }, null, 2));
}

// ---- reports ---------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const pct = (n, d) => (d ? (100 * n / d).toFixed(0) : '0');

let md = `# Phase B — Mapillary cafe imagery at full scale\n\n`;
md += `_Generated ${manifest.generatedAt} · CONF_FLOOR ${CONF_FLOOR} · TierB align≤${TIERB_MAX_ALIGN}° d≤${TIERB_MAX_D}m q≥${TIERB_MIN_QUALITY}_\n\n`;
md += `## Headline\n\n`;
md += `- **Cafes imaged: ${shipped.length} / ${totalCafes} total cafes (${pct(shipped.length, totalCafes)}%)** · ${shipped.length} / ${cafesWithCand} cafes-with-candidates (${pct(shipped.length, cafesWithCand)}%)\n`;
md += `- **Tier A (name-match): ${tierA.length}** — of which ${lenientA.length} on a LENIENT match (occluded prefix/suffix or address-number)\n`;
md += `- **Tier B (confirmed-location storefront, FLAGGED for review): ${tierB.length}**\n`;
md += `- Projection was ~10–17% of cafes → actual ${pct(shipped.length, totalCafes)}%\n`;
md += `- Panos in sample: ${manifest.cafes.reduce((a, c) => a + (c.nPano || 0), 0)}\n\n`;
md += `### Verification history — NOT "zero FP" on first pass\n\n`;
md += `The initial Phase-B self-review claimed zero false positives; an independent ADVERSARIAL\n`;
md += `re-verification (agents instructed to REFUTE each ship) + a scout eyeball then found **4\n`;
md += `false positives** the self-review had passed: \`la-casa-de-pane\` (a tattoo/tobacco shop is\n`;
md += `the hero), \`pascal-s-artisan-bistro-gourmet-coffee\` (matched the generic phrase "gourmet\n`;
md += `coffee"; "ISLANDS" dominates), and \`starbucks-48\` + \`starbucks-78\` (shopping-center DIRECTORY\n`;
md += `PYLONS, not storefronts). Fix: two name-blind gate fields now enforced on BOTH tiers —\n`;
md += `**isDirectoryOrPylon** (reject tenant boards) and **cafeIsDominantSubject** (reject when a\n`;
md += `different business is the hero) — plus descriptor stop-words (gourmet/artisan/fresh/…) so a\n`;
md += `match can't rest on a generic phrase. \`la-casa\` + \`pascal's\` dropped; \`starbucks-30\` +\n`;
md += `\`banyan-coffee-co\` force-kept. A crop FALL-THROUGH (when a guard rejects the top crop, ship\n`;
md += `the next-best that passes) reinstated **\`starbucks-48\`** on its real "STARBUCKS COFFEE"\n`;
md += `storefront crop; **\`starbucks-78\`** stays dropped (its only non-pylon crop is a logo-only\n`;
md += `siren, no legible name). Separately, **\`parkside-cafe\`** was shipping UPSIDE-DOWN (a dashcam\n`;
md += `frame inverted with no EXIF tag) — fixed with a sky-heuristic orientation check in the crop\n`;
md += `step. Lesson: refute-style verification is a STANDING gate, not a one-off.\n\n`;
const tally = {};
rows.forEach((r) => { if (r.rejectReason) tally[r.rejectReason] = (tally[r.rejectReason] || 0) + 1; });
md += `### Reject-reason tally (of ${cafesWithCand} with candidates)\n\n`;
Object.entries(tally).forEach(([k, v]) => { md += `- ${k}: ${v}\n`; });
md += `\n## Shipped cafes\n\n`;
md += `| cafe | tier | matchKind | lenient? | sign / receipt | q | align/d | Mapillary |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of shipped.sort((a, b) => (a.tier).localeCompare(b.tier) || a.name.localeCompare(b.name))) {
  md += `| ${esc(r.name)} | ${r.tier} | ${r.matchKind} | ${r.lenient ? '⚠︎' : ''} | ${esc(r.tier === 'A' ? r.signTextRead : 'storefront, no conflict')} | ${r.quality} | ${r.align}/${r.d} | [link](${r.mapillaryUrl}) |\n`;
}
md += `\n## Lenient-only Tier-A ships (quick glance — partial/fuzzy/number matches)\n\n`;
if (!lenientA.length) md += `_(none — every Tier-A ship was a strong phrase/exact-token match)_\n`;
for (const r of lenientA) md += `- **${esc(r.name)}** — ${r.matchKind} \`${esc(r.matched)}\` from sign “${esc(r.signTextRead)}” · ${r.cropPath}\n`;
writeFileSync(path.join(ROOT, 'finder', 'cache', cityId, 'phaseB-mapillary-report.md'), md);

// Tier-B review — Josh's ONE-TIME eyeball gate
let tb = `# Phase B — Tier-B ships (ONE-TIME review gate)\n\n`;
tb += `_${tierB.length} cafes shipped on Tier B: NO name-match, but a clear cafe storefront with NO conflicting other-business sign at a strong geometric candidate. Eyeball each crop: if they genuinely show a cafe (no wrong business), Tier B is clean → keep it for multi-city. If any shows the wrong place, drop the rule._\n\n`;
tb += `Crop files are at the listed path under \`finder/cache/${cityId}/mapillary-crops/<slug>/\`.\n\n`;
for (const r of tierB.sort((a, b) => a.name.localeCompare(b.name))) {
  tb += `### ${esc(r.name)}  (align ${r.align}°, ${r.d}m, q ${r.quality})\n`;
  tb += `- crop: \`${r.cropPath}\`  ·  [Mapillary](${r.mapillaryUrl})\n`;
  tb += `- scene: _${esc(r.sceneNote)}_\n`;
  const cr = r.allSigns.find((c) => c.i === r.cropI) || {};
  tb += `- vision: isCafeStorefront=${cr.isCafe}, otherBusinessNameOnSign=${cr.other == null ? 'null' : '“' + esc(cr.other) + '”'}, signs read=${(cr.signs || []).length ? (cr.signs).map((s) => '“' + esc(s) + '”').join(', ') : '(none)'}\n\n`;
}
if (!tierB.length) tb += `_(no Tier-B ships in this run)_\n`;
writeFileSync(path.join(ROOT, 'finder', 'cache', cityId, 'phaseB-tierB-review.md'), tb);

writeFileSync(path.join(REVIEW, '_verdicts.json'), JSON.stringify({
  CONF_FLOOR, TIERB_MAX_ALIGN, TIERB_MAX_D, totalCafes, cafesWithCand,
  shipped: shipped.length, tierA: tierA.length, tierB: tierB.length, lenientA: lenientA.length, tally, rows,
}, null, 2));

console.log(`SHIPPED ${shipped.length}/${totalCafes} cafes (${pct(shipped.length, totalCafes)}%) · TierA ${tierA.length} (lenient ${lenientA.length}) · TierB ${tierB.length} · ${SHIP ? 'CACHE+JPEGs WRITTEN' : 'report only (no --ship)'}`);
if (SHIP) {
  console.log('artifact manifest remains invalid pending places-images.mjs; deploy-city will refuse the intermediate image tree');
}
console.log('reject tally:', JSON.stringify(tally));
