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

// Exported for the D4 smoke pin ONLY (test/smoke.mjs imports the full registry
// to mirror-check EVERY entry against its finder config, not just the active
// city). App code must keep consuming the selected CITY below — never the map.
export const CITIES = {
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
    bbox: { south: 27.3, north: 28.6, west: -83.3, east: -81.9 },
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
  // Stage D: city #2 — SF & East Bay (the SF → Walnut Creek corridor, Josh
  // 2026-06-16, reconfirmed 2026-07-01 ruling #9). Identity fields + heroes
  // MIRROR finder/cities/sf-east-bay.mjs (meta/heroes/spotsHeroes) — no import,
  // by design; the D4 smoke pin holds the two in sync. Heroes were live-verified
  // on Commons 2026-07-03 (STAGE_D_SF_ENDPOINTS.md §7); credits carried in full
  // for the attribution page. ⚑ The Mt. Diablo Spots hero is a city-mood
  // backdrop (fine per the hero rule) — the summit sits OUTSIDE the ratified
  // finder bbox, so Diablo-as-a-SPOT stays Josh's bbox call (STAGE_D.md D3).
  'sf-east-bay': {
    id: 'sf-east-bay',
    name: 'SF & East Bay', // mirrors finder meta.name EXACTLY (smoke-pinned)
    shortName: 'SF', // the casual/vocative form (taglines, address hints)
    region: 'California', // mirrors the finder geocode region
    locale: 'en-US',
    tz: 'America/Los_Angeles', // mirrors the finder tz (weather.js forecast query)
    center: { lat: 37.84, lng: -122.25 }, // mirrors finder meta.center
    bbox: { south: 37.68, north: 38.00, west: -122.53, east: -121.88 },
    heroes: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/GoldenGateBridge-001.jpg/960px-GoldenGateBridge-001.jpg',
        credit: 'Rich Niewiroski Jr.',
        license: 'CC BY 2.5',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.5',
        page: 'https://commons.wikimedia.org/wiki/File:GoldenGateBridge-001.jpg',
      },
    ],
    spotsHeroes: [
      {
        // CC0 — no byline legally required; credited anyway (house style: every
        // hero carries its credit).
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Mount_Diablo_with_wildflowers.jpg/960px-Mount_Diablo_with_wildflowers.jpg',
        credit: 'Mx. Granger',
        license: 'CC0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        page: 'https://commons.wikimedia.org/wiki/File:Mount_Diablo_with_wildflowers.jpg',
      },
    ],
    // scalar aliases — mirror heroes[0]/spotsHeroes[0].url as plain string
    // literals (the W4 real-photo smoke guard reads them from this source text).
    hero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/GoldenGateBridge-001.jpg/960px-GoldenGateBridge-001.jpg',
    spotsHero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Mount_Diablo_with_wildflowers.jpg/960px-Mount_Diablo_with_wildflowers.jpg',
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

// D4 §3 — THE formatting locale: every toLocaleDateString/toLocaleTimeString/
// toLocaleString call site routes through this one constant (re-exported via
// lib.js), so a future city localizes in exactly one place. 'en-US' for Tampa —
// rendered output is byte-identical to the old per-call-site literals.
export const fmtLocale = CITY.locale
