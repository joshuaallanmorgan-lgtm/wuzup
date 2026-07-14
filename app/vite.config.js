import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// the build-time city config (D4). In this Node context city.js selects via
// process.env.VITE_CITY — the same env var that selects inside the bundle —
// so the tab title always names the city the build ships. (A VITE_CITY set
// only in a .env file would not reach this import; select via the real env
// var, which is the documented one-deployment-per-city knob.)
import { CITY } from './src/city.js'

// Stage E deploy-infra: BASE_PATH is the ONE subpath-hosting knob. GitHub
// Pages serves a project site under /<repo>/ — Tampa builds with
// BASE_PATH=/wuzup/ and SF with BASE_PATH=/wuzup/sf/ (two self-contained builds,
// one deployment per city, D-DEP). Default '/' is a true no-op: the default
// build's JS/CSS/HTML output stays byte-identical (verified against the
// pre-change dist). Normalized to leading+trailing '/' exactly like vite's
// own base normalization, so the manifest below and vite agree on the prefix.
// (globalThis.process — the lint config is browser-globals-only; same pattern
// as city.js. This file always runs in Node, where process is real.)
const RAW_BASE = globalThis.process?.env?.BASE_PATH || '/'
const BASE = (RAW_BASE.startsWith('/') ? '' : '/') + RAW_BASE + (RAW_BASE.endsWith('/') ? '' : '/')

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
  plugins: [
    react(),
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
