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
const SRC = join(HERE, 'output', cityId);
const DEST = join(HERE, '..', 'app', 'public');

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
if (!existsSync(join(SRC, IMG_DIR))) problems.push(`missing ${IMG_DIR}/`);
if (!existsSync(DEST)) problems.push('app/public/ does not exist (run from the repo root)');
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
  copyFileSync(join(srcImg, f), join(destImg, f));
  total += statSync(join(destImg, f)).size;
  imgN++;
}
lines.push(`  ${(IMG_DIR + '/').padEnd(24)} ${String(imgN).padStart(6)} files`);

console.log(`deploy-city: deployed '${cityId}' → app/public/`);
for (const l of lines) console.log(l);
console.log(`  total ${total.toLocaleString('en-US')} bytes`);
