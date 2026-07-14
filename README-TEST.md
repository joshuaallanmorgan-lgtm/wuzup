# README-TEST — the smoke harness (Sprint M3)

**Run it:** `npm test` (repo root). Target: under ~90s on a warm cache. Zero test
dependencies — `node:test` + `node:assert` only (Node 20+; repo runs 24).
**Every sprint runs this before landing.** A red harness = do not push.

## What it checks (5 blocks, in order)

| # | Block | What a failure means |
|---|-------|----------------------|
| 1 | **finder fast-mode** — spawns `SKIP_RENDER=1 SKIP_EXTRA=1 node finder/finder.mjs`; asserts exit 0, parses stable benchmarks, reports live buzz≥2 and fast-source `other` as diagnostics, requires total events ≥ 150, and schema-validates 20 random events. Deterministic fixtures prove cross-family merge, same-family collapse, and venue veto; current full artifacts must keep `other` at ≤8% per city. | The pipeline itself broke: a source/cache failure, benchmark regression, schema drift, deterministic merge regression, or full-corpus taxonomy regression. Read the printed line in the assert message — it names the exact gate. |
| 2 | **data invariants** — on the **current full** `app/public/events.json` (captured before block 1 can touch it): every event has title+start+source; zero junk-hours (non-nightlife 01:00–05:59 starts); zero events already ended **as of the dataset's generation time**; `sponsored` is a boolean on every event (the labeling invariant needs the field to exist); hidden-gems ≤ 24; full-file schema pass. | The shipped dataset violates a trust invariant. Re-run the finder; if it reproduces, the finder's filtering/tagging regressed — fix data, never hide it in the app. |
| 3 | **app build** — `npm --prefix app run build` exits 0. | The app doesn't compile. Assert message carries the build tail. |
| 4 | **app lint** — `npm --prefix app run lint` exits 0 (runs in parallel with 3). | Lint debt landed. Fix it, don't disable rules silently. |
| 5 | **pure-logic units** — imports `app/src/lib.js`, `weekend.js`, `taste.js` straight into Node: `orderDay` count-preservation + de-flood on 3 synthetic shapes, `tonightModel` ordering (future-first, started-sink, late-night fold-in), `daypartOf` boundaries (05:00/17:00/date-only), `tasteNudge` hard bounds 0–18 (+200-case fuzz), weekend Fri–Sun window from 3 different start days. | Core ordering/window/bounds math changed. If intentional, update the test WITH the contract comment; if not, you just caught a regression before a human did. |

## Notes & gotchas

- **Your data files are safe.** Block 1 backs up `app/public/events.json`,
  `finder/output/<cityId>/events.json` and `events.md` (D1: outputs are
  per-city) plus every committed cache in memory and restores them in a
  `finally` — and then asserts the restore was byte-for-byte. A test run never
  leaves the app pointing at the small fast-mode dataset.
- **Network:** block 1 hits the live static sources (falling back to
  `finder/cache/<cityId>/` per source) and may geocode a few new venues via
  Nominatim (~1 req/s). First run after a long gap can be slower. The finder
  refreshes its own `finder/cache/<cityId>/*.json` — that churn is by design,
  not harness damage (and the backup/restore above undoes it).
- **buzz ≥ 2 in fast mode is a live-corpus diagnostic,** because current source
  sets can be healthy without publishing an overlapping future listing. The
  merge fixture pins cross-family consensus, same-family collapse, and the
  unrelated-venue veto; full-run corpus targets stay visible in finder output.
- **`other` is ratio-gated on full artifacts (≤8% per city).** Fast mode's
  reduced source mix is not representative and is diagnostic only. The current
  baselines are Tampa 47/1,642 (2.86%) and SF 42/743 (5.65%); the gate keeps
  useful drift headroom while the deterministic guide fixture pins canonical `art` behavior.
- **"Ended" is measured against the dataset's generation time,** not the
  clock: the invariant is "the finder never *writes* an already-over event".
  Events that ended since the last refresh are the stale-data banner's job
  (App.jsx), not a data bug. The generation time is parsed from
  `finder/output/<cityId>/events.md`'s `_Generated …_` stamp (file mtime is useless —
  any restore, including this harness's own, rewrites identical content with
  a fresh mtime); it applies only while the app copy and finder output are
  byte-identical, with a loud mtime fallback otherwise.
- Build (3) and lint (4) start together and only read `app/`; they start after
  block 1 has restored the data files, so `dist/` is always built from the
  full dataset.
- Run a single block while iterating:
  `node --test --test-name-pattern "tasteNudge" test/smoke.mjs`
