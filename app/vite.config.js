import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
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
const PUBLIC_DIR = resolve(globalThis.process?.env?.WUZUP_PUBLIC_DIR || resolve(APP_ROOT, 'public'))
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

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  publicDir: PUBLIC_DIR,
  define: {
    'import.meta.env.VITE_ARTIFACT_MANIFEST_ID': JSON.stringify(APPROVED_MANIFEST_ID),
    'globalThis.__WUZUP_PRODUCT_ROOT__': JSON.stringify(PRODUCT_ROOT),
  },
  plugins: [
    react(),
    {
      // Production keeps a strict meta CSP. Vite's development-only React
      // refresh preamble is inline and HMR connects to a local WebSocket, so
      // widen only the in-memory dev HTML instead of weakening shipped bytes.
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        return html
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
