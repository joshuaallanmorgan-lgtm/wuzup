import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// the build-time city config (D4). In this Node context city.js selects via
// process.env.VITE_CITY — the same env var that selects inside the bundle —
// so the tab title always names the city the build ships. (A VITE_CITY set
// only in a .env file would not reach this import; select via the real env
// var, which is the documented one-deployment-per-city knob.)
import { CITY } from './src/city.js'

// https://vite.dev/config/
export default defineConfig({
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
