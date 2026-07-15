// finder/deploy.mjs — deploy ONE city's artifacts into the app (Stage D · D1).
//
// D-DEP ruling (STAGE_D.md, resolved 2026-07-02): ONE DEPLOYMENT PER CITY.
// The finder writes per-city artifacts under finder/output/<cityId>/; this step
// copies exactly ONE city's set into app/public/ at the SAME filenames the app
// already fetches (/events.json, /places.json, /guides.json, /place-img/*) —
// the app changes nothing. This is the ONLY writer of those app/public data
// artifacts; no finder module writes app/public directly (smoke-guarded).
//
// Run:   npm run deploy-city                 (CITY env selects; default tampa-bay)
//        CITY=sf-east-bay npm run deploy-city
//
// Refuses LOUDLY (exit 1) when the city's artifact set is missing or corrupt —
// a deploy must never leave app/public half-swapped or empty. place-img/ is
// mirrored (cleared + recopied) so a previous city's crops can never linger in
// a new deployment; the JSON files are validated before a single byte moves.
import { readFileSync, mkdirSync, existsSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cityId, tz as CITY_TZ } from './cities/index.mjs';
import { MANIFEST_FILE, verifyArtifactSet } from './artifact-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// DEPLOY_SRC / DEPLOY_DEST — verification seams (Stage D sf-app), NOT deploy
// knobs: the smoke harness points DEPLOY_SRC at an empty scratch root to prove
// the refusal path stays loud for ANY city, and DEPLOY_DEST at a scratch dir to
// prove a full artifact set deploys correctly WITHOUT touching the real
// deployment. Neither engages unless explicitly set — an unadorned
// `npm run deploy-city` reads finder/output/<cityId>/ and writes app/public/,
// exactly as before.
const SRC = join(process.env.DEPLOY_SRC || join(HERE, 'output'), cityId);
const DEST = process.env.DEPLOY_DEST || join(HERE, '..', 'app', 'public');

const JSON_ARTIFACTS = ['events.json', 'places.json', 'guides.json'];
const IMG_DIR = 'place-img';
const REQUIRE_FRESH = process.env.REQUIRE_FRESH_ARTIFACTS === '1';
const REQUIRE_VERIFIED_SOURCES = process.env.REQUIRE_VERIFIED_SOURCES === '1';
// Deterministic interruption seam for the artifact contract test only.
const FAIL_AFTER = process.env.DEPLOY_FAIL_AFTER || null;

// ---- refuse before touching anything --------------------------------------
const problems = [];
if (!existsSync(SRC)) problems.push(`finder/output/${cityId}/ does not exist`);
for (const f of JSON_ARTIFACTS) {
  const p = join(SRC, f);
  if (!existsSync(p)) {
    problems.push(`missing ${f}`);
    continue;
  }
  try {
    JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    problems.push(`${f} is not valid JSON (${e.message})`);
  }
}
// Stage D REFUTE F8: validate place-img is a real, readable DIRECTORY here —
// the copy phase rmSyncs the deployed dir before enumerating the source, so a
// source that turns out to be a file (or unreadable) mid-copy would leave
// app/public half-swapped with its photos deleted. All refusals happen before
// any destructive step.
const srcImgCheck = join(SRC, IMG_DIR);
if (!existsSync(srcImgCheck)) problems.push(`missing ${IMG_DIR}/`);
else if (!statSync(srcImgCheck).isDirectory()) problems.push(`${IMG_DIR} is not a directory`);
else {
  try { readdirSync(srcImgCheck); } catch (e) { problems.push(`${IMG_DIR}/ unreadable (${e.message})`); }
}
if (!existsSync(DEST)) problems.push(`${process.env.DEPLOY_DEST ? `DEPLOY_DEST '${DEST}'` : 'app/public/'} does not exist${process.env.DEPLOY_DEST ? '' : ' (run from the repo root)'}`);
if (existsSync(SRC)) {
  const checked = verifyArtifactSet({
    root: SRC,
    expectedCityId: cityId,
    expectedTimeZone: CITY_TZ,
    requireFresh: REQUIRE_FRESH,
    requireVerifiedSources: REQUIRE_VERIFIED_SOURCES,
  });
  problems.push(...checked.problems);
}
if (problems.length) {
  console.error(`deploy-city: REFUSING to deploy '${cityId}' — ${problems.join(' · ')}`);
  console.error(`  Generate the city's artifacts first (finder/finder.mjs + finder/places.mjs${cityId === 'tampa-bay' ? '' : `, CITY=${cityId}`}), then re-run.`);
  process.exit(1);
}

// ---- publish the set --------------------------------------------------------
// Flat filenames cannot make a multi-file swap atomic. Removing the old trust
// pointer first makes the transition fail closed: interrupted publication may
// leave member bytes to recover, but never a manifest that blesses a mixed set.
let total = 0;
const lines = [];
const destManifest = join(DEST, MANIFEST_FILE);
rmSync(destManifest, { force: true });
try {
  for (const f of JSON_ARTIFACTS) {
    copyFileSync(join(SRC, f), join(DEST, f));
    const bytes = statSync(join(DEST, f)).size;
    total += bytes;
    lines.push(`  ${f.padEnd(24)} ${bytes.toLocaleString('en-US').padStart(12)} bytes`);
    if (FAIL_AFTER === f) throw new Error(`injected interruption after ${f}`);
  }
  // mirror place-img/: clear the deployed dir, then copy this city's crops —
  // the ONE sanctioned clear of app/public/place-img (stageb --ship writes only
  // the per-city finder/output/<cityId>/place-img/ now).
  const srcImg = join(SRC, IMG_DIR);
  const destImg = join(DEST, IMG_DIR);
  if (existsSync(destImg)) rmSync(destImg, { recursive: true, force: true });
  mkdirSync(destImg, { recursive: true });
  let imgN = 0;
  for (const f of readdirSync(srcImg)) {
    // dotfiles (.gitkeep) are the empty-dir GIT seed for a city before its
    // imagery run — repo plumbing, never a deployable artifact.
    if (f.startsWith('.')) continue;
    copyFileSync(join(srcImg, f), join(destImg, f));
    total += statSync(join(destImg, f)).size;
    imgN++;
  }
  lines.push(`  ${(IMG_DIR + '/').padEnd(24)} ${String(imgN).padStart(6)} files`);
  if (FAIL_AFTER === IMG_DIR) throw new Error(`injected interruption after ${IMG_DIR}`);

  // The trust pointer is published LAST. A consumer that sees this manifest
  // can rely on every hash it names already being present at that instant.
  copyFileSync(join(SRC, MANIFEST_FILE), destManifest);
  const manifestBytes = statSync(destManifest).size;
  total += manifestBytes;
  lines.push(`  ${MANIFEST_FILE.padEnd(24)} ${manifestBytes.toLocaleString('en-US').padStart(12)} bytes`);

  const deployedCheck = verifyArtifactSet({
    root: DEST,
    expectedCityId: cityId,
    expectedTimeZone: CITY_TZ,
    requireFresh: REQUIRE_FRESH,
    requireVerifiedSources: REQUIRE_VERIFIED_SOURCES,
  });
  if (!deployedCheck.ok) throw new Error(`destination verification failed: ${deployedCheck.problems.join(' · ')}`);
} catch (error) {
  rmSync(destManifest, { force: true });
  console.error(`deploy-city: REFUSING deployed '${cityId}' — ${error.message || error}`);
  process.exit(1);
}

console.log(`deploy-city: deployed '${cityId}' → ${process.env.DEPLOY_DEST ? DEST : 'app/public/'}`);
for (const l of lines) console.log(l);
console.log(`  total ${total.toLocaleString('en-US')} bytes`);
