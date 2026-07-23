# STAGE E — v1 Ship (plan-of-record + as-built record)

> **Status: ✅ MERGED / CODE COMPLETE** · PR #14 · `f3a9589` · operational record updated 2026-07-14
> Charter (ROADMAP §2): final contract/honesty audit · deploy + refresh automation · the
> full-app ship gate → **Wuzup v1 live**. Stage D (multi-city, PRs #8–#13) is the floor this
> stands on. Josh's standing instruction for this stage (2026-07-06): *"Let's finish V1 today.
> Feel free to use your best judgement to resolve anything that is blocking you."* — the open
> calls below marked **(Fable ruling)** were made under that delegated judgment; everything
> marked ⚑Josh stays his.

---

## E1 — The three delegated finder rulings (`204a1a1`)

1. **Vuori×Pvolve false-fold** — a retail store canonicalizing to its host mall made two
   distinct Broadway Plaza events fold into one. Fix: the `"Vuori Broadway Plaza"` alias
   removed from `finder/cities/sf-east-bay.venues.json`; SF regenerated at **SF's own**
   frozen stamp (`WARM_FROZEN_AT=2026-07-06T04:11:23.000Z`) → a surgical 742→743 diff,
   verified by stable-ID comparison (D-G2 paying for itself immediately).
   *Process lesson banked: freezing a regen at the WRONG city's stamp widens the upcoming
   window → phantom adds (+44 the first try). WARM_FROZEN_AT must be the active city's own
   generation instant.*
2. **Pure-number OSM names** — numeric-only `name` tags (`"1200"`, `"350"`…) are ref-tag
   leaks, not names. Guard in `finder/places-sources/osm.mjs`: a `/^\d+$/` name is treated
   as anonymous (the place drops instead of shipping a junk card). The committed SF
   `places.json` predated the guard and still carried 13 junk rows — caught by the ship-gate
   REFUTE audit, healed by the E4 places regeneration on this branch. The regen surfaced the
   sibling class — MICRO-NAMES ≤2 chars ("A"/"B"/"C"/"H1", Alameda Marina berth refs) — so
   the guard now also treats those as anonymous. *(Pipeline gotcha for the record:
   `finder/cache/<city>/places-<module>.json` is a POST-PARSE loader cache — a parser-rule
   change does nothing until that file is dropped or expires; the raw Overpass caches
   underneath still serve, so the re-run costs no live fetches.)*
3. **Mt. Diablo bbox (Fable ruling, 3rd surfacing)** — east edge widened `−122.00 → −121.88`
   in `finder/cities/sf-east-bay.mjs`: the summit generates as a real spot (the city hero
   shows the mountain; the packet's own rosterBenchmark wanted it), and eastern Concord
   un-clips. The wider box took effect in the E4 places regeneration on this branch.

## E2 — Deploy topology (Fable ruling, D-DEP-compliant)

**GitHub Pages**, one repo, two self-contained builds:

| City | URL path | Build |
|---|---|---|
| Tampa Bay | `/wuzup/` | `CITY=tampa-bay node finder/deploy.mjs` → `VITE_CITY=tampa-bay BASE_PATH=/wuzup/ npm --prefix app run build` → `_site/` |
| SF & East Bay | `/wuzup/sf/` | same pipeline with `sf-east-bay` + `BASE_PATH=/wuzup/sf/` → `_site/sf/` |

Why Pages: zero-backend (matches the v2.0 ruling), free, PR-previewable via workflows, no
new accounts/secrets — and D-DEP holds (each build is one city, selected at build time; no
runtime switcher). `BASE_PATH` is the ONE subpath knob (`app/vite.config.js`); at the default
`/` the build is **byte-identical** to pre-Stage-E (verified). All runtime fetches are
`BASE_URL`-relative; the manifest's internals + `<link>` are prefixed by the city-manifest
plugin; committed `/place-img/` URLs are rebased idempotently in `normalizePlace`.

### Workflows (`.github/workflows/`)
- **`deploy.yml`** — push-to-main + manual dispatch. Per-city loop (deploy-city → build →
  mount); `finder/deploy.mjs` stays the ONLY `app/public` writer and is validate-then-replace,
  so the committed (deliberately pre-stable-id) `app/public/events.json` can never reach
  Pages. `.nojekyll` at root.
- **`refresh.yml`** — weekly cron (Thu 09:23 UTC) + dispatch. **Events only** (see E4). Runs
  the finder per city (Playwright render → `SKIP_RENDER=1` fallback with a loud `::warning`),
  gates on `npm test` (direct exit code, no grep), then opens an automated PR on
  `bot/data-refresh` — **never pushes to main**. Imagery untouched by contract. Zero secrets
  (`github.token` only).
- **`ci.yml`** — pull_request gate (added at the ship-gate REFUTE's prompting: the bot's
  refresh PRs previously reached the merge button with zero checks): lint · Tampa build ·
  SF build · `npm test`, each step's exit code direct.

### Operational closeout (as-built)
1. ✅ Pages uses the Actions source and the Stage-E deployment completed.
2. ✅ A fresh manual dispatch on 2026-07-14 repaired the repository-rename incident: the old Pages
   artifact still referenced `/cj/*`, so every asset 404'd after `cj` became `wuzup`. The new build
   derives `/wuzup/*`; all emitted Tampa and SF assets returned 200.
3. ✅ Real mobile-browser verification covered Tampa's five tabs, an event-detail/back flow, and the
   SF city build. Both city-specific datasets rendered with no console errors.
4. ⏳ First scheduled refresh-cycle proof remains outstanding: runner Playwright, current live-source
   yields, cron delivery, automated PR creation, and the resulting merge/deploy must be observed as
   one full cycle. The first Thursday schedule after ship is 2026-07-16 09:23 UTC.

## E3 — PWA · dark mode · attribution (landed earlier in the Stage E arc)
PR #9 (⚑X3 attribution page, license-audited, all counts derived + anti-drift tripwire) and
PR #10 (manifest-only PWA — deliberately **no service worker** so `events.json` can never
cache-stale; warm dark ladder `#1b1611/#251d14/#f5efe7`, smoke recomputes dark AA at test
time) shipped from this charter while Stage D data work ran in parallel.

## E4 — The places pipeline cadence (Fable ruling)
`finder/places.mjs` (spots) is **not** in the weekly refresh — deliberately. Places change
slowly; the pipeline's image enrichment (Wikidata/Commons) and gov ArcGIS pulls are the
flaky-in-CI kind; and refresh.yml's "imagery untouched" contract stays simple by keeping the
writer out entirely. Cadence: **operator-run, at need** (config/bbox changes, junk-name
healing, a quarterly freshen) — `CITY=<id> node finder/places.mjs`, eyeball the diff digest,
commit with the ship gates green. The runbook for events refreshes stays REFRESH.md.
*Applied in the merged Stage-E branch:* SF places regenerated post-bbox-widen + post-name-guard — the 13
pure-number junk cards are gone and the Mt. Diablo / east-Concord corridor materialized (see
the commit for exact counts). Tampa untouched (0 junk names, no bbox change).

## E5 — The ship gate (the final REFUTE, run before the v1 PR)
Three independent worktree verifiers against the merged branch:
1. **Tampa path-trace** — every navigable screen, light + dark, headless Chromium (real
   clicks): console/pageerror/request failures, blank screens, `undefined/NaN` text scans,
   computed dark-canvas checks.
2. **SF path-trace** — same walk against a real `VITE_CITY=sf-east-bay` build + multi-tenant
   honesty: zero stray "Tampa" strings, 743 events load, Coverage Card at honest numbers,
   SF attribution, manifest name.
3. **Adversarial shippability audit** — every diff hunk vs main, both workflows traced
   end-to-end, the six binding contracts re-verified in code (imagery fail-closed ·
   never-hide · D.0-R · two stores never merged · `isSparse(0)===false` · stale-artifact
   can't ship), PHASE_3.7 §B.5 item-by-item.
Verdicts: audit **BLOCK→fixed** · Tampa **SHIP-WITH-NOTES** (60+54 screens) · SF
**SHIP-WITH-NOTES** (51 screens ×2 schemes). Every finding + fix is in the v1 ship PR body;
the fixes that landed on this branch:
- the E4 places regeneration (the audit's blocker) + the micro-name guard extension;
- calendar-export identity de-Tampa'd (`share.js`: UID `@wuzup-<cityId>`, PRODID "Wuzup" —
  the SF trace found Tampa-branded UIDs in every SF .ics);
- the DetailPage hero `heroFailed` latch (a dead poster on event A forced the art hero onto
  every event hopped to via More-like-this) — reset on image change, proven live by a
  dead→healthy hop probe;
- **the VSPC image ban (Fable ruling)**: visitstpeteclearwater.com hard-blocks hotlinking
  (403 + CORP; the Tampa trace found 153 events shipping dead posters), so `imageRank` now
  rates it below no-image — those events fall to their next candidate or the honest Aurora
  floor, and the weekly refresh inherits the ban. VSPC remains an event SOURCE; only its
  image CDN is banned. Applied via a full LIVE Tampa refresh (the REFRESH.md operator flow —
  a warm regen can't produce the shipping artifact: killed-fetch sources drop listings), so
  v1 launched on day-fresh data (1,665 → 1,642 events, zero dead posters, benchmarks green
  except the two disclosed ambers). Warm baseline re-proven ×2 deterministic at the new
  stamp — and with every cache fresh, warm == live byte-for-byte again. (hcplc.libnet.info
  deliberately NOT banned: 4/93 posters dead vs 89 healthy — the app fallbacks absorb the 4.)
- the UT non-event guard caught its tenth staff row ("Supplier Invoices/Procurement Cards" —
  the gov-noise-0 benchmark tripped on the fresh pull; regex extended).

## Disclosed deferrals (v1 shipped with these, eyes open)
- Diacritic title-split shared rule (Rosalía class) — shared fix would byte-break Tampa; deferred.
- SF `other`=42 vs the Tampa-tuned ≤40 ratchet — eyeballed, genuine events.
- Tampa place-adapters un-gated (box-drop safe; wasted fetches only).
- Committed `app/public/events.json` is Tampa's pre-stable-id snapshot — CI regenerates via
  deploy.mjs before every build; it can never ship (contract-verified).
- Snapshot semantics: committed artifacts carry generation-day past events; every surface
  filters `>= today` at runtime; weekly refresh rotates them out.
- Watch-guide window: the World Cup guide honestly deactivates 2026-07-19; the shelf empties
  until a new watch guide ships (⚑Josh/Charles: next guide).
- Same-origin localStorage: `/wuzup/` and `/wuzup/sf/` share one github.io origin, so USER-scoped
  state (primer, taste, saves) persists across both cities. Deliberate: taste is the user's,
  not the city's; saves are keyed by city-distinct event keys so they never cross-resolve;
  CITY-scoped data (weather) is already namespaced per city (`wx-{id}-v1`, D4). Revisit only
  if v2 wants per-city profiles.
- Calendar-export UIDs changed once at ship (`@wuzup-<cityId>`, was the hardcoded
  `@whats-hot-tampa-bay` — the SF path-trace's catch): pre-ship exports re-import as new
  entries. Nothing was live; no user impact.

## Post-ship queue
- ⚑**Josh: the supervised SF imagery run** (~30–60 min, MULTICITY_IMAGERY_RUNBOOK.md) — the
  binding image-honesty contract requires human pixels on the Mapillary gates; NON-delegable.
  Until then SF ships photo-light: 175 credited Commons photos + the Aurora floor, zero fakes.
- ⚑**Charles:** the real mark/favicon (placeholder ⚑ ships) · DRAFT copy passes · warmed
  greens · medallion tints · the 9 drawn glyphs.
- First-cycle watches (E2 §post-merge list) + the v2 road: [planning/v2/V2_PLAN.md](planning/v2/V2_PLAN.md).
- Finder fast-mode merge coverage: the former live `buzz >= 2` assertion depended on incidental
  three-source overlap and expired with its July 7–11 events. The full current corpus still proves
  cross-family merging; the handoff branch replaces the brittle canary with a deterministic merge
  fixture and keeps live output as a diagnostic.
