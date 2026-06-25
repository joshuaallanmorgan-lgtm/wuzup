// =============================================================================
// finder/mapillary-verify.mjs — Mapillary "oriented capture" for cafe storefronts
//
// HONESTY MODEL (Josh, 2026-06-25, plan valiant-bouncing-puffin):
//   A Mapillary photo ships ONLY IF a vision pass reads a storefront SIGN whose
//   text matches the cafe name. The sign IS the name-match (read from pixels
//   instead of a Commons file title) → a shipped image is provably THAT cafe.
//   No legible matching sign → the cafe keeps its art floor.
//
// THIS FILE does the OFFLINE half: per cafe, query all nearby Mapillary captures,
// rank by which can SEE the cafe (geometry), and produce framed candidate crops
// (flat-frame crop OR pano equirect→perspective reproject) on disk. The vision
// gate (name-blind sign transcription → deterministic name-match) runs separately
// via the Workflow tool over the crops this writes, then Stage B (mapillaryStageB)
// scores the transcriptions. Phase A = proof-first yield probe; no commit of
// assets or places.json.
//
// TOKEN: read from process.env.MAPILLARY_TOKEN, else regex'd from the plan file at
// runtime. NEVER hardcoded here, NEVER logged. (plan §"Token security")
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CROP_DIR = path.join(ROOT, 'finder', 'cache', 'mapillary-crops');
const PLACES = path.join(ROOT, 'app', 'public', 'places.json');

// ---- TUNABLES (surfaced for the scout) -------------------------------------
// Phase B: SEARCH loosened (Josh) — wider net = more cafes get a shot at a legible
// sign. The honesty core (the sign-gate in Stage B) is UNCHANGED. Phase A values in
// trailing comments.
export const TUNE = {
  BBOX_M: 200,          // search radius (m) for nearby captures           [A:140]
  API_LIMIT: 500,       // max images per bbox query
  PERSP_MIN_D: 4,       // perspective candidate: min camera→cafe dist (m)  [A:6]
  PERSP_MAX_D: 60,      // perspective candidate: max distance (m)          [A:45]
  PERSP_MAX_ALIGN: 45,  // perspective candidate: max |heading−bearing| (°) [A:35]
  PANO_MIN_D: 4,        // pano candidate: min distance (m)
  PANO_MAX_D: 45,       // pano candidate: max distance (m)                 [A:40]
  TOPN: 6,              // crops generated per cafe                         [A:4]
  // Tier-B "strong geometric candidate" gate (tighter than the search net) — a
  // no-name storefront ships only from a crop aimed squarely at the cafe.
  TIERB_MAX_ALIGN: 25,
  TIERB_MAX_D: 35,
  CROP_FOV: 45,         // flat-frame crop zoom (deg of FOV kept) — modest zoom
  DEFAULT_HFOV: 67,     // fallback HFOV when camera_parameters missing/implausible
  HFOV_MIN: 40,         // clamp computed HFOV
  HFOV_MAX: 100,
  PANO_HFOV: 67,        // reprojected pano perspective HFOV
  PANO_YAW_OFFSET: 0,   // calibration: deg added to (bearingToCafe) for pano yaw.
                        // 0 ⇒ pano center column faces the capture's compass_angle.
                        // Recalibrate on a known pano if panos aim at the wrong wall.
  Y_BIAS: 0.46,         // vertical crop center (frac of height) — bias up toward signs
  OUT_W: 1280,          // output crop width  (matches THUMB_W)
  OUT_H: 853,           // output crop height (3:2, > MIN_HERO_W=900 after... see note)
  JPEG_Q: 82,
  MIN_HERO_W: 900,      // never let the *source* crop fall below this (else widen, less zoom)
};

// ---- token (env first, then the plan file; never logged) -------------------
function mapillaryToken() {
  if (process.env.MAPILLARY_TOKEN) return process.env.MAPILLARY_TOKEN;
  const planPath = process.env.MLY_PLAN || 'C:/Users/daonl/.claude/plans/valiant-bouncing-puffin.md';
  try {
    const m = readFileSync(planPath, 'utf8').match(/MLY\|[A-Za-z0-9|]+/);
    if (m) return m[0];
  } catch { /* fall through */ }
  throw new Error('No Mapillary token: set MAPILLARY_TOKEN or MLY_PLAN');
}

// ---- geometry --------------------------------------------------------------
const R = 6371000, rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
export function haversine(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function bearing(aLat, aLng, bLat, bLng) {
  const y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) -
    Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const signedDelta = (bearingTo, heading) => ((bearingTo - heading + 540) % 360) - 180;

// HFOV (radians) from OpenSfM focal (normalized by long edge). Landscape:
// HFOV = 2·atan(0.5/f). Portrait: scale by w/h. Clamp + default per TUNE.
function hfovRad(focal, w, h) {
  let hfovDeg;
  if (focal && focal > 0.05 && focal < 10) {
    const halfW = w >= h ? 0.5 : 0.5 * (w / h);
    hfovDeg = deg(2 * Math.atan(halfW / focal));
  }
  if (!hfovDeg || hfovDeg < TUNE.HFOV_MIN || hfovDeg > TUNE.HFOV_MAX) {
    hfovDeg = Math.max(TUNE.HFOV_MIN, Math.min(TUNE.HFOV_MAX, hfovDeg || TUNE.DEFAULT_HFOV));
  }
  return rad(hfovDeg);
}

// ---- Mapillary fetch -------------------------------------------------------
const FIELDS = [
  'id', 'is_pano', 'camera_type', 'compass_angle', 'computed_compass_angle',
  'camera_parameters', 'geometry', 'computed_geometry', 'width', 'height',
  'thumb_2048_url', 'thumb_original_url', 'creator', 'captured_at',
  'quality_score', 'sequence',
].join(',');

export async function fetchNearby(cafe, token) {
  const dLat = TUNE.BBOX_M / 111000;
  const dLng = TUNE.BBOX_M / (111000 * Math.cos(rad(cafe.lat)));
  const bbox = [cafe.lng - dLng, cafe.lat - dLat, cafe.lng + dLng, cafe.lat + dLat].join(',');
  const url = `https://graph.mapillary.com/images?fields=${FIELDS}&bbox=${bbox}&limit=${TUNE.API_LIMIT}`;
  const res = await fetch(url, { headers: { Authorization: `OAuth ${token}` } });
  if (!res.ok) throw new Error(`Mapillary ${res.status} for ${cafe.name}`);
  const j = await res.json();
  return j.data || [];
}

// ---- candidate scoring -----------------------------------------------------
function candidatesFor(cafe, imgs) {
  const cands = [];
  for (const im of imgs) {
    const g = (im.computed_geometry || im.geometry || {}).coordinates;
    if (!g || g.length < 2) continue;
    const [lng, lat] = g;
    const d = haversine(lat, lng, cafe.lat, cafe.lng);
    const heading = im.computed_compass_angle != null ? im.computed_compass_angle : im.compass_angle;
    const bTo = bearing(lat, lng, cafe.lat, cafe.lng);
    const delta = heading != null ? signedDelta(bTo, heading) : null;
    const align = delta != null ? Math.abs(delta) : null;
    const pano = !!im.is_pano;
    const quality = typeof im.quality_score === 'number' ? im.quality_score : 0.5;

    let ok = false;
    if (pano) ok = d >= TUNE.PANO_MIN_D && d <= TUNE.PANO_MAX_D;
    else ok = d >= TUNE.PERSP_MIN_D && d <= TUNE.PERSP_MAX_D && align != null && align <= TUNE.PERSP_MAX_ALIGN;
    if (!ok) continue;

    const distScore = Math.max(0, 1 - Math.abs(d - 22) / 25);
    const alignScore = pano ? 1 : Math.cos(rad(delta));
    const oncoming = !pano && align <= 20 && d >= 15 ? 1 : 0;
    const score = 0.5 * alignScore + 0.3 * distScore + 0.12 * quality + 0.08 * oncoming;

    cands.push({
      id: im.id, pano, lat, lng, d, heading, bearingToCafe: bTo, delta, align,
      quality, score,
      cam: Array.isArray(im.camera_parameters) ? im.camera_parameters : null,
      w: im.width, h: im.height,
      thumb2048: im.thumb_2048_url, thumbOrig: im.thumb_original_url,
      creator: im.creator && im.creator.username, capturedAt: im.captured_at,
      sequence: im.sequence,
    });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands;
}

const mapillaryUrl = (id) => `https://www.mapillary.com/app/?focus=photo&pKey=${id}`;

// ---- crop: flat frame ------------------------------------------------------
async function cropFlat(buf, cand, outPath) {
  const meta = await sharp(buf).metadata();
  const srcW = meta.width, srcH = meta.height;
  const focal = cand.cam ? cand.cam[0] : null;
  const hfov = hfovRad(focal, srcW, srcH);

  // horizontal position of the cafe in the frame
  let xFrac = 0.5 + Math.tan(rad(cand.delta)) / (2 * Math.tan(hfov / 2));
  xFrac = Math.max(0.05, Math.min(0.95, xFrac));

  // crop width from CROP_FOV; widen (less zoom) before dropping below hero floor
  let cropFovDeg = Math.min(TUNE.CROP_FOV, deg(hfov));
  let cropW = Math.round((srcW * cropFovDeg) / deg(hfov));
  if (cropW < TUNE.MIN_HERO_W && cropW < srcW) cropW = Math.min(srcW, TUNE.MIN_HERO_W);
  cropW = Math.min(cropW, srcW);
  let cropH = Math.round((cropW * TUNE.OUT_H) / TUNE.OUT_W);
  if (cropH > srcH) { cropH = srcH; cropW = Math.min(srcW, Math.round((cropH * TUNE.OUT_W) / TUNE.OUT_H)); }

  let left = Math.round(xFrac * srcW - cropW / 2);
  left = Math.max(0, Math.min(srcW - cropW, left));
  let top = Math.round(TUNE.Y_BIAS * srcH - cropH / 2);
  top = Math.max(0, Math.min(srcH - cropH, top));

  await sharp(buf)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(TUNE.OUT_W, TUNE.OUT_H, { fit: 'fill' })
    .jpeg({ quality: TUNE.JPEG_Q })
    .toFile(outPath);
  return { srcW, srcH, hfovDeg: +deg(hfov).toFixed(1), xFrac: +xFrac.toFixed(3), cropFovDeg: +cropFovDeg.toFixed(1) };
}

// ---- crop: pano equirect → perspective -------------------------------------
async function cropPano(buf, cand, outPath) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const pw = info.width, ph = info.height, ch = info.channels;
  const W = TUNE.OUT_W, H = TUNE.OUT_H;
  const hfov = rad(TUNE.PANO_HFOV);
  const f = (W / 2) / Math.tan(hfov / 2);
  // yaw in the pano's own frame: bearingToCafe relative to the capture heading
  const yaw = rad((cand.bearingToCafe - (cand.heading || 0) + TUNE.PANO_YAW_OFFSET));
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const out = Buffer.alloc(W * H * 3);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const X = px + 0.5 - W / 2;
      const Y = py + 0.5 - H / 2;
      const Z = f;
      // rotate ray by yaw around vertical axis (pitch 0)
      const wx = X * cy + Z * sy;
      const wz = -X * sy + Z * cy;
      const wy = Y;
      const lon = Math.atan2(wx, wz);                       // [-π, π]
      const lat = Math.atan2(-wy, Math.sqrt(wx * wx + wz * wz)); // [-π/2, π/2]
      let u = lon / (2 * Math.PI) + 0.5;
      let v = 0.5 - lat / Math.PI;
      u = ((u % 1) + 1) % 1;
      v = Math.max(0, Math.min(0.999999, v));
      // bilinear sample
      const fx = u * pw - 0.5, fy = v * ph - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const x0c = ((x0 % pw) + pw) % pw, x1c = (x0c + 1) % pw;
      const y0c = Math.max(0, Math.min(ph - 1, y0)), y1c = Math.max(0, Math.min(ph - 1, y0 + 1));
      const o = (py * W + px) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = data[(y0c * pw + x0c) * ch + c];
        const p10 = data[(y0c * pw + x1c) * ch + c];
        const p01 = data[(y1c * pw + x0c) * ch + c];
        const p11 = data[(y1c * pw + x1c) * ch + c];
        const top = p00 * (1 - tx) + p10 * tx;
        const bot = p01 * (1 - tx) + p11 * tx;
        out[o + c] = (top * (1 - ty) + bot * ty) | 0;
      }
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: TUNE.JPEG_Q })
    .toFile(outPath);
  return { panoW: pw, panoH: ph, yawDeg: +deg(yaw).toFixed(1) };
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- per-cafe: gen candidate crops -----------------------------------------
export async function genCropsForCafe(cafe, token) {
  const imgs = await fetchNearby(cafe, token);
  const cands = candidatesFor(cafe, imgs);
  const persp = cands.filter((c) => !c.pano);
  const panos = cands.filter((c) => c.pano);
  const pick = cands.slice(0, TUNE.TOPN); // best-first across both kinds
  const slug = cafe.key.replace(/^p\|/, '');
  const dir = path.join(CROP_DIR, slug);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const crops = [];
  for (let i = 0; i < pick.length; i++) {
    const cand = pick[i];
    const outPath = path.join(dir, `c${i}.jpg`);
    try {
      const buf = await download(cand.pano ? (cand.thumb2048 || cand.thumbOrig) : cand.thumb2048);
      const extra = cand.pano ? await cropPano(buf, cand, outPath) : await cropFlat(buf, cand, outPath);
      crops.push({
        i, path: path.relative(ROOT, outPath).replace(/\\/g, '/'),
        id: cand.id, kind: cand.pano ? 'pano' : 'flat',
        d: +cand.d.toFixed(1), align: cand.align != null ? +cand.align.toFixed(0) : null,
        score: +cand.score.toFixed(3), creator: cand.creator, capturedAt: cand.capturedAt,
        sequence: cand.sequence, mapillaryUrl: mapillaryUrl(cand.id), ...extra,
      });
    } catch (e) {
      crops.push({ i, id: cand.id, kind: cand.pano ? 'pano' : 'flat', error: String(e.message || e) });
    }
  }
  return {
    key: cafe.key, name: cafe.name, lat: cafe.lat, lng: cafe.lng,
    nFrames: imgs.length, nPersp: persp.length, nPano: panos.length,
    nCandidates: cands.length, crops,
  };
}

// ---- review set: NAME-BLIND anonymization for the vision gate ---------------
// Slugged crop paths would leak the cafe name to the transcriber, so copy each
// cafe's crops into an opaque _review/<rid>/ dir. _map.json (rid↔key) is private —
// agents never read it. _workflow_args.json is the array passed to the Workflow.
export function buildReviewSet() {
  const REVIEW = path.join(CROP_DIR, '_review');
  const man = JSON.parse(readFileSync(path.join(CROP_DIR, '_manifest.json'), 'utf8'));
  if (existsSync(REVIEW)) rmSync(REVIEW, { recursive: true, force: true });
  mkdirSync(REVIEW, { recursive: true });
  const withCrops = man.cafes.filter((c) => (c.crops || []).some((x) => !x.error));
  const map = {};
  const wfArgs = [];
  withCrops.forEach((c, idx) => {
    const rid = 'r' + String(idx + 1).padStart(3, '0');
    const dir = path.join(REVIEW, rid);
    mkdirSync(dir, { recursive: true });
    const crops = [];
    c.crops.filter((x) => !x.error).forEach((x) => {
      const dst = path.join(dir, `c${x.i}.jpg`);
      copyFileSync(path.join(ROOT, x.path), dst);
      crops.push(path.relative(ROOT, dst).replace(/\\/g, '/'));
    });
    map[rid] = { key: c.key, name: c.name, n: crops.length, crops };
    wfArgs.push({ rid, crops });
  });
  writeFileSync(path.join(REVIEW, '_map.json'), JSON.stringify(map, null, 2));
  writeFileSync(path.join(REVIEW, '_workflow_args.json'), JSON.stringify(wfArgs, null, 2));
  return { count: withCrops.length, wfArgs };
}

// ---- CLI -------------------------------------------------------------------
function loadCafes() {
  const raw = JSON.parse(readFileSync(PLACES, 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.places || raw.items || []);
  return arr.filter((p) => p.placeType === 'cafe' && p.lat && p.lng);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('mapillary-verify.mjs')) {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  if (flags.includes('--anon')) {
    const { count } = buildReviewSet();
    process.stderr.write(`${count} cafes anonymized → _review/ + _workflow_args.json\n`);
  } else {
    const token = mapillaryToken();
    const keysArg = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const cafes = loadCafes();
    const byKey = new Map(cafes.map((c) => [c.key, c]));
    const targets = keysArg.length ? keysArg.map((k) => byKey.get(k)).filter(Boolean) : cafes;
    mkdirSync(CROP_DIR, { recursive: true });
    const out = [];
    let i = 0;
    for (const cafe of targets) {
      i++;
      process.stderr.write(`[${i}/${targets.length}] ${cafe.name} … `);
      try {
        const r = await genCropsForCafe(cafe, token);
        out.push(r);
        process.stderr.write(`${r.nCandidates} cand (${r.nPersp}p/${r.nPano}pano), ${r.crops.filter((c) => !c.error).length} crops\n`);
      } catch (e) {
        out.push({ key: cafe.key, name: cafe.name, error: String(e.message || e) });
        process.stderr.write(`ERR ${e.message}\n`);
      }
      await sleep(120); // politeness between bbox queries
    }
    const manifest = { tune: TUNE, generatedAt: new Date().toISOString(), cafes: out };
    writeFileSync(path.join(CROP_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
    const withCand = out.filter((c) => c.nCandidates > 0).length;
    process.stderr.write(`\n${out.length} cafes · ${withCand} with candidates · manifest written\n`);
  }
}
