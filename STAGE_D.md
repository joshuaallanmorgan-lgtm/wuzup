# STAGE_D — Multi-City execution plan (plan-of-record)

> House rule 4: execution plans live in repo docs. Assembled 2026-07-02 from the live packet
> (PHASE_3.7.md §15 + Addendum I — still the authority for the SF & East Bay specifics) plus the
> 2026-07-01 pipeline forensics that found the gaps the packet predates. **City #2 = SF & East Bay
> (`sf-east-bay`) — resolved by Josh 2026-06-16, RECONFIRMED 2026-07-01 (ruling #9).**
> Prereq: the Cohesion Pass (Stage C.5) merged. Exit: Tampa + SF/East Bay both live and clean,
> **Tampa byte-identical** through every refactor step.

## The honest shape of the work

The 2026-06-26 imagery lock made the PLACES/imagery pipeline city-agnostic — that part is real
(config extraction verified, fail-closed guards verified). But the **events pipeline — most of the
product's data — is entirely Tampa-bound**, and the artifact store is single-tenant. Stage D is a
data-engineering stage, not a config flip.

## D1 — Multi-tenant artifacts (do FIRST — running city #2 today would OVERWRITE Tampa)

- Namespace every output path per city: `finder/output/<cityId>/…`, `app/public/<cityId>/…` (or a
  build-time selector — decide the deployment model first, see ⚑D-DEP below).
- Fix the cache-key collision class: `place-geo-images.json` / `place-mapillary-images.json` key on
  `p|slug` — another city's `p|starbucks-30` collides. Prefix keys or split caches per city.
- `mapillary-stageb.mjs --ship` does `rmSync(PLACE_IMG)` — running city #2 **deletes Tampa's 35
  self-hosted crops**. Make the ship dir per-city.
- Regression bar: after D1, a Tampa run produces byte-identical outputs at the new paths.

## D2 — Events pipeline de-Tampa (the big one)

Verified hardcodes (2026-07-01 forensics):
- **ET timezone math** (`finder.mjs:293` UTC offsets) — "every SF event stamped 7 hours early" is a
  shipped-data corruption bug for any non-Eastern city. City config gains a `tz`; all day/time
  derivation goes through it.
- Geocode string `'${venue}, ${city || 'Tampa Bay'}, Florida'` (`finder.mjs:~1675`) → city config.
- Tampa source→category map (`finder.mjs:~1005`), 14 Tampa-only `sources.json` URLs, 12 Tampa
  source modules in `finder/sources/`, Playwright render hardwired to cltampa.com (`render.mjs`).
  The loaders auto-discover modules — city #2 means WRITING new source modules, not refactoring.
- UA strings say "TampaBayWhatsOn" (`places-images.mjs:78`, `places-descriptions.mjs:27`) → neutral.
- `smoke.mjs:~386` runs Tampa-literal merge guards (Fort De Soto === 1) whenever a roster exists —
  **any rostered city #2 fails `npm test`**. Scope the guards to `CITY === 'tampa-bay'`.

## D3 — SF & East Bay build (the Addendum I packet, verified endpoints table at PHASE_3.7 §I.5a)

- Config: `id sf-east-bay`; bbox 37.68–38.00 N / −122.53 to −122.00 W; tz America/Los_Angeles;
  heroes Golden Gate + Mt. Diablo (Commons, credited); **CA State Parks DROPPED on license**.
- Places adapters: OSM (bbox swap — free) · `ebrpd-parks` (ArcGIS) · `sf-parks` (Socrata custom
  fetch) · dedupe reuses Tampa's 2.5km+name merge. GGNRA = editorial seed, no nps.gov scraping.
- Events: new source scout per DATA_SOURCES.md method (budget 1–2 spike days for endpoint
  verification — 3 endpoints in the packet still need curl-confirm).
- **AREA gazetteer for SF** before any Commons geosearch shipping — a thin gazetteer reintroduces
  the exact false-positive class Phase 1.1 fixed; the runbook flags it, and there is NO tooling to
  validate one (build the gazetteer from the adapters' district fields + manual review).
- Imagery: run MULTICITY_IMAGERY_RUNBOOK.md end-to-end — the manual REFUTE gate + Josh's pixel
  eyeball are STANDING requirements (~150 vision-gate candidates, ~11% cafe yield expected).
  `orientFlipThreshold=60` was tuned on Tampa dashcams — per-city recheck flagged in config.

## D4 — App-side city model

- `CITY` (lib.js) → a per-city config module; `wx-tampa-v1` storage key → `wx-{cityId}-v1` (with
  one-shot migration); data fetch URLs parameterized; the ~10 `en-US`/locale literals behind one
  `fmt` helper; Tampa copy in guides/taglines → config.
- ✅ **D-DEP RESOLVED (Josh, 2026-07-02): ONE DEPLOYMENT PER CITY** — build-time city selection.
  Consequences now binding for D1/D4: the finder namespaces outputs per city
  (`finder/output/<cityId>/…`) and the DEPLOY step copies ONE city's artifacts into `app/public/`
  (each deployment ships exactly one city's data at the same URLs the app already fetches — the app
  needs no fetch-path changes); the app's `CITY` config resolves at build time (env/config module,
  Tampa default); the in-app switcher is v2 ([BACKLOG](BACKLOG.md)).

## Exit gate

Tampa byte-identical regression (now automated, not just the runbook step) · SF & East Bay live
with all honesty guards green · `npm test` green for BOTH cities · attribution ledger correct
per-city (feeds the Stage E attribution page).
