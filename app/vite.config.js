import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyArtifactSet } from '../finder/artifact-manifest.mjs'
import { runtimeDeploymentPlan } from './runtime-deployment.mjs'
// the build-time city config (D4). In this Node context city.js selects via
// process.env.VITE_CITY — the same env var that selects inside the bundle —
// so the tab title always names the city the build ships. (A VITE_CITY set
// only in a .env file would not reach this import; select via the real env
// var, which is the documented one-deployment-per-city knob.)
import { CITY } from './src/city.js'

const APP_ROOT = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(APP_ROOT, '..')
const PUBLIC_DIR = resolve(globalThis.process?.env?.WUZUP_PUBLIC_DIR || resolve(APP_ROOT, 'public'))
const STABLE_DEV = globalThis.process?.env?.WUZUP_STABLE_DEV === '1'
const STABLE_DEV_TRACE = globalThis.process?.env?.WUZUP_STABLE_DEV_TRACE === '1'
const verifiedArtifacts = verifyArtifactSet({
  root: PUBLIC_DIR,
  expectedCityId: CITY.id,
  expectedTimeZone: CITY.tz,
})
if (!verifiedArtifacts.ok) {
  throw new Error(
    `Vite refused unverified ${CITY.id} public data at ${PUBLIC_DIR}: ${verifiedArtifacts.problems.join(' · ')}`
  )
}
const APPROVED_MANIFEST_ID = verifiedArtifacts.manifest.manifestId
const suppliedManifestId = globalThis.process?.env?.VITE_ARTIFACT_MANIFEST_ID
if (suppliedManifestId && suppliedManifestId !== APPROVED_MANIFEST_ID) {
  throw new Error(
    `Vite refused VITE_ARTIFACT_MANIFEST_ID='${suppliedManifestId}'; staged bytes require '${APPROVED_MANIFEST_ID}'`
  )
}

// BASE_PATH names this city's deployed bytes. WUZUP_PRODUCT_ROOT is supplied
// only by a composed multi-city deployment and verifies that BASE_PATH is the
// canonical route for CITY before Vite emits anything. Without a product root,
// the build is intentionally standalone and cross-city navigation stays off.
// (globalThis.process — the lint config is browser-globals-only; same pattern
// as city.js. This file always runs in Node, where process is real.)
const RAW_BASE = globalThis.process?.env?.BASE_PATH || '/'
const DEPLOYMENT = runtimeDeploymentPlan({
  basePath: RAW_BASE,
  productRoot: globalThis.process?.env?.WUZUP_PRODUCT_ROOT || null,
  city: CITY,
})
if (!DEPLOYMENT.ok) {
  throw new Error(
    `Vite refused ${CITY.id} at BASE_PATH='${DEPLOYMENT.baseUrl}'; WUZUP_PRODUCT_ROOT requires '${DEPLOYMENT.expectedBaseUrl}'`
  )
}
const BASE = DEPLOYMENT.baseUrl
const PRODUCT_ROOT = DEPLOYMENT.productRoot

// Stage E (ship-shell): the installable-PWA manifest, generated from the SAME
// city registry as the %CITY_NAME% title token — public/ can't carry it because
// files there copy verbatim and the app name must follow VITE_CITY at build.
// NO service worker ships with this: Chrome/Edge install on manifest-only now
// (developer.chrome.com/blog/update-install-criteria — the fetch-handler
// requirement is gone; MDN "Making PWAs installable" concurs), BACKLOG scopes
// offline mode to v2, and zero SW guarantees events.json is never served stale
// from a cache. Revisit only when v2 offline work starts.
// theme/background: the shipped light canvas #faf6f1 (index.css --bg). The
// manifest spec has no prefers-color-scheme conditional — the in-page
// theme-color meta pair (index.html) carries dark; the launch splash staying
// light in dark mode is a known platform limitation (noted for Josh).
// Icons: rendered from favicon.svg — the ⚑ Charles placeholder mark — via a
// sharp scratch script; re-render when the real mark lands.
// start_url/scope/icons ride BASE: vite's base only rewrites what it bundles,
// and this manifest is emitted as a raw asset — its internals are the classic
// base-path escapees (a /wuzup/ deployment would otherwise install an app whose
// start_url and icons 404). At BASE '/' every value is byte-identical to before.
const MANIFEST = JSON.stringify(
  {
    name: `Wuzup · ${CITY.name}`,
    short_name: 'Wuzup',
    start_url: BASE,
    scope: BASE,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf6f1',
    theme_color: '#faf6f1',
    icons: [
      { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${BASE}icons/icon-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: `${BASE}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  null,
  2
)

const normalizedPath = (value) => resolve(value).replaceAll('\\', '/').toLowerCase()
const STABLE_DEV_APP_SOURCE_ROOT = normalizedPath(resolve(APP_ROOT, 'src')) + '/'
const STABLE_DEV_SHARED_SOURCE_ROOT = normalizedPath(resolve(PROJECT_ROOT, 'shared')) + '/'
const STABLE_DEV_SOURCE_PATHS = [
  resolve(APP_ROOT, 'index.html'),
  resolve(APP_ROOT, 'runtime-deployment.mjs'),
  resolve(APP_ROOT, 'vite.config.js'),
]
const STABLE_DEV_SOURCE_FILES = new Set(STABLE_DEV_SOURCE_PATHS.map(normalizedPath))
const STABLE_DEV_NATIVE_IGNORED_FILES = new Set([
  normalizedPath(resolve(APP_ROOT, 'index.html')),
  normalizedPath(resolve(APP_ROOT, 'vite.config.js')),
])
const STABLE_DEV_TEXT_SOURCE = /\.(?:[cm]?[jt]sx?|css|html|json|svg|md)$/i

export function stableDevNativeWatchIgnored(file, enabled = STABLE_DEV) {
  if (!enabled || typeof file !== 'string' || file.trim() === '') return false
  const absolute = isAbsolute(file) ? file : resolve(APP_ROOT, file)
  return STABLE_DEV_NATIVE_IGNORED_FILES.has(normalizedPath(absolute))
}

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const candidate = resolve(root, entry.name)
    if (entry.isDirectory()) return filesUnder(candidate)
    return entry.isFile() ? [candidate] : []
  }))
  return nested.flat()
}

async function defaultStableDevInitialFiles() {
  const [appSources, sharedSources] = await Promise.all([
    filesUnder(resolve(APP_ROOT, 'src')),
    filesUnder(resolve(PROJECT_ROOT, 'shared')),
  ])
  return [...STABLE_DEV_SOURCE_PATHS, ...appSources, ...sharedSources]
}

export function stableDevSourceFile(file, { modules = [] } = {}) {
  if (typeof file !== 'string' || file.trim() === '') return false
  const normalized = normalizedPath(file)
  return STABLE_DEV_SOURCE_FILES.has(normalized)
    || normalized.startsWith(STABLE_DEV_APP_SOURCE_ROOT)
    || (normalized.startsWith(STABLE_DEV_SHARED_SOURCE_ROOT) && modules.length > 0)
}

export function stableDevReload({
  enabled = STABLE_DEV,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  readSource = readFile,
  initialFiles = null,
  trace = STABLE_DEV_TRACE,
} = {}) {
  let reloadTimer = null
  const sourceDigests = new Map()
  const digestSource = (bytes, file) => {
    // Git/workspace synchronization on Windows can alternate LF and CRLF
    // while preserving the JavaScript/CSS/HTML source. Treat that as the
    // same source revision so line-ending restoration is also invisible.
    if (!STABLE_DEV_TEXT_SOURCE.test(file)) return createHash('sha256').update(bytes).digest('hex')
    const canonicalSource = (typeof bytes === 'string' ? bytes : bytes.toString('utf8')).replaceAll('\r\n', '\n')
    return createHash('sha256').update(canonicalSource).digest('hex')
  }
  const initialSnapshot = enabled
    ? Promise.resolve(initialFiles || defaultStableDevInitialFiles()).then(async (files) => {
        await Promise.all(files.map(async (file) => {
          try {
            sourceDigests.set(normalizedPath(file), digestSource(await readSource(file), file))
          } catch {
            // A file may disappear between discovery and read. Its first real
            // watcher event still takes the conservative missing-file path.
          }
        }))
      })
    : Promise.resolve()
  const scheduleReload = (server, environment) => {
    clearTimer(reloadTimer)
    reloadTimer = setTimer(() => {
      const channel = environment?.hot || server.environments?.client?.hot || server.ws
      channel.send({ type: 'full-reload' })
    }, 100)
  }
  return {
    name: 'stable-development-reload',
    apply: 'serve',
    enforce: 'post',
    async hotUpdate({ file, modules, server }) {
      if (!enabled) return
      // Vite invokes this hook once per environment. The document reload is a
      // client concern; allowing SSR/module-runner environments to run the same
      // closure would debounce and reschedule the client message unpredictably.
      if (this?.environment?.name && this.environment.name !== 'client') return
      // Vite watches more than the module graph while tools build, capture QA,
      // or stage city data in the same checkout. Suppress its default handling
      // for those generated/non-source paths so stable mode cannot turn output
      // churn into a user-visible navigation reset.
      if (!stableDevSourceFile(file, { modules })) return []
      // Workspace test/build tools may restore source mtimes without changing
      // their bytes. Vite reports those touches as updates, so bind reloads to
      // content instead of timestamps. Startup snapshots ensure even the first
      // touch-only event stays invisible.
      await initialSnapshot
      const sourceKey = normalizedPath(file)
      let digest
      try {
        const bytes = await readSource(file)
        digest = digestSource(bytes, file)
      } catch {
        // A real delete/rename must still invalidate the page. Cache one
        // sentinel so a noisy missing-file watcher cannot reload forever.
        digest = 'missing'
      }
      if (sourceDigests.get(sourceKey) === digest) return []
      sourceDigests.set(sourceKey, digest)
      if (trace) server.config.logger.info(`stable-dev: source bytes changed ${sourceKey}`)
      scheduleReload(server, this?.environment)
      // Suppress partial module updates. One debounced document reload applies
      // the complete provider graph from a coherent module evaluation.
      return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  publicDir: PUBLIC_DIR,
  // Vite handles HTML changes before module hot-update hooks. Workspace tools
  // restore index/config mtimes frequently on Windows, which otherwise forces
  // document reloads every few seconds despite identical bytes. In stable
  // localhost mode these two shell files are restart-owned; React/CSS source
  // changes remain content-aware and reload through stableDevReload above.
  server: STABLE_DEV ? {
    watch: {
      ignored: file => stableDevNativeWatchIgnored(file),
    },
  } : undefined,
  define: {
    'import.meta.env.VITE_ARTIFACT_MANIFEST_ID': JSON.stringify(APPROVED_MANIFEST_ID),
    'globalThis.__WUZUP_PRODUCT_ROOT__': JSON.stringify(PRODUCT_ROOT),
  },
  plugins: [
    react(),
    stableDevReload(),
    {
      // Production keeps a strict meta CSP. Vite's development-only React
      // refresh preamble is inline and HMR connects to a local WebSocket, so
      // widen only the in-memory dev HTML instead of weakening shipped bytes.
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        return html
          .replace("worker-src 'none';", "worker-src 'self' blob:;")
          .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
          .replace(
            "connect-src 'self' https://api.open-meteo.com;",
            "connect-src 'self' https://api.open-meteo.com ws://localhost:* ws://127.0.0.1:*;",
          )
      },
    },
    {
      // D4: index.html's <title> carries the city name; the %CITY_NAME% token
      // is replaced here (dev + build) from the ONE city registry instead of a
      // second hardcoded copy of the name.
      name: 'city-title',
      transformIndexHtml(html) {
        return html.replaceAll('%CITY_NAME%', CITY.name)
      },
    },
    {
      // Stage E: emit /manifest.webmanifest (build) + serve it (dev) from MANIFEST
      // above — one registry, no second copy of the city name on disk.
      name: 'city-manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: MANIFEST })
      },
      transformIndexHtml(html) {
        // base-path escapee (verified with a BASE_PATH=/wuzup/ build): vite's HTML
        // url rewriting only touches files it can resolve — favicon/icons/assets
        // get the base prefix, but this plugin-emitted manifest doesn't exist on
        // disk, so its <link href="/manifest.webmanifest"> ships un-prefixed and
        // 404s under a subpath deployment. Prefix it here. At BASE '/' the
        // replacement is the identity (byte-identical output).
        return html.replaceAll('href="/manifest.webmanifest"', `href="${BASE}manifest.webmanifest"`)
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // configureServer middlewares run BEFORE vite's internal base-strip,
          // so a BASE_PATH dev server sees the full /wuzup/… URL — normalize it.
          const u = req.url?.startsWith(BASE) ? '/' + req.url.slice(BASE.length) : req.url
          if (u === '/manifest.webmanifest' || u?.startsWith('/manifest.webmanifest?')) {
            res.setHeader('Content-Type', 'application/manifest+json')
            res.end(MANIFEST)
          } else next()
        })
      },
    },
  ],
  build: {
    // Sprint 10: emit Vite's module graph so CI can prove that route-only
    // surfaces stay outside the eager boot payload. The manifest is build
    // evidence only (under dist/.vite/) and is never fetched by the app.
    manifest: true,
    rollupOptions: {
      output: {
        // C5: split the framework out of the app bundle. Dependencies change only
        // on version bumps, so the vendor chunk stays byte-stable across app
        // deploys and long-caches on returning visits; the app chunk shrinks by
        // the same amount. (True lazy-loading of subpages/decks is Cohesion Pass
        // perf work — this is the free, zero-risk cut.) Function form: vite 8's
        // rolldown rejects the old object shorthand.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
