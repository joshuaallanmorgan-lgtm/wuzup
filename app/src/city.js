// city.js — the BUILD-TIME city config module (Stage D4).
//
// D-DEP ruling (Josh, 2026-07-02): ONE DEPLOYMENT PER CITY — each deployment
// ships exactly one city's data at the same URLs. So the city is selected at
// BUILD time (VITE_CITY), never at runtime: no switcher, no fetch-path changes.
// This module mirrors the identity fields of the finder-side config
// (finder/cities/tampa-bay.mjs `meta`) but deliberately does NOT import it —
// the app stays free of finder imports; the D4 smoke guard pins the two in sync.
//
// A second city = add a registry entry here (+ its finder config / data run,
// D1–D3) and build with VITE_CITY=<id>. Tampa Bay is the reference config.
//
// Hero-art honesty (moved wholesale from lib.js, W4/3.7P-6): hero art is an
// ARRAY — cinematic + swipe-READY, one curated entry each today (a single hero
// with a Ken-Burns zoom; FB-06's "slight zoom in/out"). The multi-photo
// crossfade turns ON when ≥3 hero-QUALITY images are curated (Charles — a
// taste call, deferred). Each entry carries its license/credit for the ⚑X3
// attribution page: the Tampa pair were hand-picked in W4 and never went
// through the finder's attributions.json, so their credits are recorded here
// (resolved live from Commons). Honesty: a city-mood hero must be a REAL
// licensed photo OF the city (the no-type-photos rule governs a PLACE photo of
// itself, not the city hero) — both are real Tampa Commons photos.
//
// Plain .js, JSX-free, Node-importable by design (the smoke harness imports
// lib.js → city.js into Node, and vite.config.js imports it for the HTML
// title) — hence the guarded env access below.

const CITIES = {
  'tampa-bay': {
    id: 'tampa-bay',
    name: 'Tampa Bay', // the user-facing city label (headers, counts, Profile)
    shortName: 'Tampa', // the casual/vocative form (taglines, address hints)
    region: 'Florida', // state / locale region (mirrors the finder geocode region)
    locale: 'en-US', // date/time/number formatting locale (lib.js fmtLocale seam)
    tz: 'America/New_York', // IANA timezone (weather.js forecast query)
    // city center — the single source for the weather query + the map default
    // view (consolidated from weather.js + MapView.jsx in W4).
    center: { lat: 27.95, lng: -82.46 },
    heroes: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/960px-Tampa_Skyline_-_Eric_Statzer.jpg',
        credit: 'Eric Statzer',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        page: 'https://commons.wikimedia.org/wiki/File:Tampa_Skyline_-_Eric_Statzer.jpg',
      },
    ],
    // W4: the Spots (Locations) tab hero — Bayshore Boulevard, Tampa Bay's waterfront.
    spotsHeroes: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Tampa_Bayshore_Blvd_looking_south01.jpg/960px-Tampa_Bayshore_Blvd_looking_south01.jpg',
        credit: 'Ebyabe',
        license: 'CC BY 2.5',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.5',
        page: 'https://commons.wikimedia.org/wiki/File:Tampa_Bayshore_Blvd_looking_south01.jpg',
      },
    ],
    // back-compat scalar aliases — the Primer onboarding reuses CITY.hero as its
    // bg; they mirror heroes[0]/spotsHeroes[0].url (kept as plain string literals
    // so the W4 real-photo smoke guard still reads them from this file's source).
    hero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/960px-Tampa_Skyline_-_Eric_Statzer.jpg',
    spotsHero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Tampa_Bayshore_Blvd_looking_south01.jpg/960px-Tampa_Bayshore_Blvd_looking_south01.jpg',
  },
}

// Build-time selection: Vite statically injects import.meta.env; the optional
// chains keep the module Node-importable (smoke harness, vite.config.js), where
// the same VITE_CITY env var selects via process.env. Default = the reference city.
const CITY_ID = import.meta.env?.VITE_CITY ?? globalThis.process?.env?.VITE_CITY ?? 'tampa-bay'

const selected = CITIES[CITY_ID]
// Fail LOUDLY on an unknown id — a misconfigured build must never quietly ship
// Tampa's data wearing another city's name (same fail-closed stance as
// finder/cities/index.mjs).
if (!selected) {
  throw new Error(`Unknown VITE_CITY '${CITY_ID}' — known cities: ${Object.keys(CITIES).join(', ')}`)
}

export const CITY = selected
