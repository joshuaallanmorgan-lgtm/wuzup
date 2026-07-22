// Stage exactly one verified city artifact set, then launch Vite with the same
// city identity. DEV_STAGE_ONLY=1 is the deterministic test/CI seam.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cityId } from './cities/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(ROOT, 'app');
const EXPIRED_PREVIEW_FLAG = 'VITE_ALLOW_EXPIRED_ARTIFACT_PREVIEW';
const STABLE_DEV_FLAG = 'WUZUP_STABLE_DEV';
const DEFAULT_VITE_PORT = 5173;
const LOCK_PORT_MIN = 49152;
const LOCK_PORT_COUNT = 16383;

function optionValue(args, name) {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index < 0) return null;
  const next = args[index + 1];
  return next && !next.startsWith('-') ? next : true;
}

function requestedEndpoint(args) {
  const rawPort = optionValue(args, '--port');
  const port = rawPort == null ? DEFAULT_VITE_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid Vite port '${rawPort}'`);
  }
  const rawHost = optionValue(args, '--host');
  const host = rawHost === true ? '0.0.0.0' : (rawHost || '127.0.0.1');
  return { host, port };
}

function defaultLockPort() {
  const rootHash = createHash('sha256').update(ROOT).digest();
  return LOCK_PORT_MIN + (rootHash.readUInt16BE(0) % LOCK_PORT_COUNT);
}

async function acquireDevLock(requestedPort) {
  const configured = process.env.WUZUP_DEV_LOCK_PORT;
  let port = configured == null ? defaultLockPort() : Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid WUZUP_DEV_LOCK_PORT '${configured}'`);
  }
  if (port === requestedPort) port = LOCK_PORT_MIN + ((port - LOCK_PORT_MIN + 1) % LOCK_PORT_COUNT);

  const lockServer = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    lockServer.once('error', reject);
    lockServer.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  }).catch((error) => {
    if (error?.code === 'EADDRINUSE') {
      throw new Error(`another Wuzup dev server is already running (ownership port ${port})`);
    }
    throw error;
  });

  let released = false;
  return {
    port,
    release: () => new Promise((resolve) => {
      if (released || !lockServer.listening) return resolve();
      released = true;
      lockServer.close(resolve);
    }),
  };
}

async function assertPortAvailable(args) {
  const { host, port } = requestedEndpoint(args);
  if (port === 0) return { host, port };
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => reject(error));
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  }).catch((error) => {
    if (error?.code === 'EADDRINUSE') {
      throw new Error(`Vite port ${host}:${port} is already in use`);
    }
    throw error;
  });
  return { host, port };
}

if (process.env.VITE_CITY && process.env.VITE_CITY !== cityId) {
  console.error(`dev-city: REFUSING conflicting CITY='${cityId}' and VITE_CITY='${process.env.VITE_CITY}'`);
  process.exit(1);
}

const viteArgs = process.env.DEV_LAUNCH_PROBE === '1'
  ? ['build', '--outDir', process.env.DEV_PROBE_OUT || join(appRoot, 'dist-probe')]
  : process.argv.slice(2);
const viteCommand = viteArgs[0]?.startsWith('-') ? 'serve' : viteArgs[0] || 'serve';
const viteServe = process.env.DEV_STAGE_ONLY !== '1' && process.env.DEV_LAUNCH_PROBE !== '1' &&
  ['serve', 'dev'].includes(viteCommand);
let devLock = null;
let devEndpoint = null;
if (viteServe) {
  try {
    devEndpoint = requestedEndpoint(viteArgs);
    devLock = await acquireDevLock(devEndpoint.port);
    await assertPortAvailable(viteArgs);
    console.log(
      `dev-city: reserved single-server startup for ${devEndpoint.host}:${devEndpoint.port || 'automatic'} ` +
      `(ownership port ${devLock.port})`
    );
  } catch (error) {
    console.error(`dev-city: REFUSING before artifact staging — ${error.message || error}`);
    process.exit(1);
  }
}

const env = {
  ...process.env,
  CITY: cityId,
  VITE_CITY: cityId,
  WUZUP_PUBLIC_DIR: process.env.DEPLOY_DEST || join(appRoot, 'public'),
};
// Callers cannot smuggle the development-only preview seam into staging,
// probes, builds, or preview/production commands. It is added back only for
// the explicit Vite serve command below.
delete env[EXPIRED_PREVIEW_FLAG];
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
const viteEnv = { ...env };
if (viteServe) {
  viteEnv[EXPIRED_PREVIEW_FLAG] = '1';
  // Codex and Windows workspace synchronization can report large batches of
  // modules together. React Fast Refresh may then transiently mix provider and
  // consumer context identities. Full-page reloads are slower but atomic and
  // keep the local product usable while the workspace is changing.
  viteEnv[STABLE_DEV_FLAG] = process.env[STABLE_DEV_FLAG] === '0' ? '0' : '1';
  console.warn(
    'dev-city: DEVELOPMENT-ONLY EXPIRED ARTIFACT PREVIEW ENABLED — hashes, schema, city, and manifest identity remain mandatory; builds and production still refuse expired data.'
  );
  if (viteEnv[STABLE_DEV_FLAG] === '1') {
    console.warn('dev-city: stable localhost mode enabled — atomic page reloads replace React Fast Refresh');
  }
}

if (viteServe) {
  // Keep Vite in this process. On Windows, terminating a wrapper process does
  // not reliably deliver a catchable signal before an independently spawned
  // Vite child is orphaned. One process owns the lock, watcher, socket, and
  // shutdown lifecycle.
  Object.assign(process.env, viteEnv);
  const viteApi = join(ROOT, 'app', 'node_modules', 'vite', 'dist', 'node', 'index.js');
  const { createServer: createViteServer } = await import(pathToFileURL(viteApi).href);
  const rawOpen = optionValue(viteArgs, '--open');
  const rawMode = optionValue(viteArgs, '--mode');
  const server = await createViteServer({
    root: appRoot,
    mode: typeof rawMode === 'string' ? rawMode : 'development',
    server: {
      host: devEndpoint.host,
      port: devEndpoint.port,
      strictPort: true,
      open: rawOpen === true ? true : (typeof rawOpen === 'string' ? rawOpen : false),
    },
  });
  try {
    await server.listen();
    server.printUrls();
  } catch (error) {
    await server.close().catch(() => {});
    await devLock?.release();
    console.error(`dev-city: Vite launch failed — ${error.message || error}`);
    process.exit(1);
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    await devLock?.release();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdown().catch((error) => {
        console.error(`dev-city: Vite shutdown failed — ${error.message || error}`);
        process.exit(1);
      });
    });
  }
  process.on('message', (message) => {
    if (message?.type === 'wuzup-shutdown') shutdown().catch(() => process.exit(1));
  });
} else {
  const child = spawn(process.execPath, [viteCli, ...viteArgs], {
    cwd: appRoot,
    env: viteEnv,
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
}
