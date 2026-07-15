// Stage exactly one verified city artifact set, then launch Vite with the same
// city identity. DEV_STAGE_ONLY=1 is the deterministic test/CI seam.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cityId } from './cities/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.VITE_CITY && process.env.VITE_CITY !== cityId) {
  console.error(`dev-city: REFUSING conflicting CITY='${cityId}' and VITE_CITY='${process.env.VITE_CITY}'`);
  process.exit(1);
}

const env = { ...process.env, CITY: cityId, VITE_CITY: cityId };
const stage = spawnSync(process.execPath, ['finder/deploy.mjs'], { cwd: ROOT, env, stdio: 'inherit' });
if (stage.status !== 0) process.exit(stage.status ?? 1);
console.log(`dev-city: staged '${cityId}' and locked VITE_CITY='${cityId}'`);
if (process.env.DEV_STAGE_ONLY === '1') process.exit(0);

// Launch Vite through Node instead of spawning npm.cmd. The latter raises
// EINVAL under Node's Windows spawn implementation in this workspace.
const viteCli = join(ROOT, 'app', 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteCli)) {
  console.error('dev-city: Vite is not installed (run npm install in app/)');
  process.exit(1);
}
const appRoot = join(ROOT, 'app');
const viteArgs = process.env.DEV_LAUNCH_PROBE === '1'
  ? ['build', '--outDir', process.env.DEV_PROBE_OUT || join(appRoot, 'dist-probe')]
  : process.argv.slice(2);
const child = spawn(process.execPath, [viteCli, ...viteArgs], {
  cwd: appRoot,
  env,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(`dev-city: Vite launch failed — ${error.message || error}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
