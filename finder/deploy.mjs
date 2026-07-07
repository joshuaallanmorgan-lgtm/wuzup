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
import { cityId } from './cities/index.mjs';

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
if (problems.length) {
  console.error(`deploy-city: REFUSING to deploy '${cityId}' — ${problems.join(' · ')}`);
  console.error(`  Generate the city's artifacts first (finder/finder.mjs + finder/places.mjs${cityId === 'tampa-bay' ? '' : `, CITY=${cityId}`}), then re-run.`);
  process.exit(1);
}

// ---- copy the set -----------------------------------------------------------
let total = 0;
const lines = [];
for (const f of JSON_ARTIFACTS) {
  copyFileSync(join(SRC, f), join(DEST, f));
  const bytes = statSync(join(DEST, f)).size;
  total += bytes;
  lines.push(`  ${f.padEnd(24)} ${bytes.toLocaleString('en-US').padStart(12)} bytes`);
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
  // imagery run (Stage D: SF ships with zero place photos until Josh's
  // supervised run) — repo plumbing, never a deployable artifact.
  if (f.startsWith('.')) continue;
  copyFileSync(join(srcImg, f), join(destImg, f));
  total += statSync(join(destImg, f)).size;
  imgN++;
}
lines.push(`  ${(IMG_DIR + '/').padEnd(24)} ${String(imgN).padStart(6)} files`);

console.log(`deploy-city: deployed '${cityId}' → ${process.env.DEPLOY_DEST ? DEST : 'app/public/'}`);
for (const l of lines) console.log(l);
console.log(`  total ${total.toLocaleString('en-US')} bytes`);
