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

## D1 — Multi-tenant artifacts ✅ LANDED (stage-d/multicity; a city-#2 run can no longer touch Tampa)

All landed and adversarially verified: outputs at `finder/output/<cityId>/…` (Tampa git-mv'd,
100% renames); ALL caches per-city at `finder/cache/<cityId>/…`; `finder/deploy.mjs` +
`npm run deploy-city` is the ONLY writer of `app/public/` (validates then copies; refuses
missing/corrupt sets; smoke-guarded write monopoly); `--ship` writes only its city's
`place-img/`; the attribution ledger is per-city (a foreign run can no longer erase Tampa's
credits); **event-source inputs are per-city too** (`finder/cities/<cityId>.sources.json` +
`<cityId>.venues.json` — the REFUTE's F1/F2: without this, an SF events run ingested Tampa's
sources and labeled them SF; finder.mjs now REFUSES an events run for a manifest-less city).
Regression bar met: warm-run byte-identity + deploy-loop clean + dry SF-paths-only proof.

## D2 — Events pipeline de-Tampa ✅ SEAMS LANDED (remaining = the per-city SOURCE MODULES themselves)

The tz/geocode/UA seams are in the city configs (byte-identical Tampa proof via
`finder/warm-preload.mjs`, the committed frozen-clock harness); smoke's Tampa guards are
city-scoped. What remains is WRITING the SF source modules (STAGE_D_SF_EVENTS.md, ~4–4.5
builder-days). The original forensics, for the record:
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

## D3 — SF & East Bay build — CONFIGS + PLACE ADAPTERS ✅ LANDED · events modules + imagery run REMAIN

Landed: every packet endpoint live-verified to 100% (STAGE_D_SF_ENDPOINTS.md — two rescued, one
confirmed dead), `finder/cities/sf-east-bay.mjs` (credited Commons heroes; AREA gazetteer ships
EMPTY + fail-closed BAN with 90 UNREVIEWED candidates staged), EBRPD/SF-parks adapters city-gated
+ sample-verified, GGNRA 10-unit editorial seed, the events scouting report (STAGE_D_SF_EVENTS.md).
**⚑ JOSH:** Mt. Diablo's summit (lng −121.914) sits OUTSIDE the ratified bbox east edge (−122.00) —
fine as the city HERO, but it cannot generate as a spot unless the box widens to ~−121.88. One-line
config call. The original packet, for the record:

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

## D4 — App-side city model ✅ LANDED

`app/src/city.js` (build-time `VITE_CITY` registry, fail-closed on unknown ids; lib.js re-exports
so importers were untouched); wx key migrated per-city (chained legacy path); `fmtLocale` covers
all 33 locale literals; Tampa copy interpolated incl. the `%CITY_NAME%` tab title. The
sf-east-bay `CITIES` entry ✅ LANDED (stage-d/complete): `VITE_CITY=sf-east-bay` is a working,
runtime-proven build (real SF events render; Coverage Card compact at 747; attribution derives
SF sources + hero credits). Unknown ids still fail closed.
- ✅ **D-DEP RESOLVED (Josh, 2026-07-02): ONE DEPLOYMENT PER CITY** — build-time city selection.
  Consequences now binding for D1/D4: the finder namespaces outputs per city
  (`finder/output/<cityId>/…`) and the DEPLOY step copies ONE city's artifacts into `app/public/`
  (each deployment ships exactly one city's data at the same URLs the app already fetches — the app
  needs no fetch-path changes); the app's `CITY` config resolves at build time (env/config module,
  Tampa default); the in-app switcher is v2 ([BACKLOG](BACKLOG.md)).

## Grafts pulled in from the V2 adjudication ✅ BOTH LANDED (D-G1 via PR #12; D-G2 on stage-d/complete)

Two small V2-substrate items land in the current road because they're cheap now and painful later:

- ✅ **D-G1 — Coverage Card** (SHIPPED — Home colophon + attribution header + the sparse-city promotion): a small honest "what we know here" surface — N events ·
  M sources · updated <time> · imagery coverage — rendered from data already in the artifacts +
  attribution ledger. Doubles as SF's week-one sparse-data answer (an honest floor beats an empty
  feed pretending otherwise). Per-city by construction.
- ✅ **D-G2 — Stable event IDs** (SHIPPED — v1|-versioned recipe, venue-free + deterministic tiebreaks, both cities id-carrying; the ONE sanctioned Tampa amendment landed, new warm baseline c68491d4…): mint a deterministic content-derived `id`
  per event at emit (stable across re-runs, collision-checked at build; Tampa regression must show
  ONLY the added field). Zero UI change in v1 — it exists so every V2 share/link/ledger feature has
  identity ground to stand on. **Byte-identity caveat:** this intentionally amends the Tampa
  regression baseline once (the one sanctioned diff = the new `id` field).

## Exit gate

Tampa byte-identical regression (now automated, not just the runbook step) · SF & East Bay live
with all honesty guards green · `npm test` green for BOTH cities · attribution ledger correct
per-city (feeds the Stage E attribution page) · **the two V2 grafts (D-G1 Coverage Card, D-G2 stable
event IDs) landed**.
