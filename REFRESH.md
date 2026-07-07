# Refreshing the data (operator runbook)

The app serves `app/public/events.json` + `places.json` + `guides.json`. Those are **staged
copies** — `finder/deploy.mjs` is the ONLY thing that writes them (Stage D1). The real
artifacts live per city in `finder/output/<cityId>/`.

## Events — automatic (the normal path, Stage E)

**`.github/workflows/refresh.yml`** runs weekly (Thu 09:23 UTC) and on manual dispatch:
it re-runs the finder for every city, gates on `npm test`, and opens a PR on
`bot/data-refresh` with the benchmark digests. **Review the PR, merge it, done** — the
merge to main triggers the Pages deploy automatically. It never pushes to main directly
and never touches imagery.

## Events — manual (a local one-off)

From the repo root:

```
node finder/finder.mjs                    # Tampa Bay (the default city)
CITY=sf-east-bay node finder/finder.mjs   # SF & East Bay
```

Takes a few minutes per city — it fetches every source live. Then eyeball the
`finder/output/<cityId>/events.md` digest, run `npm test`, and commit the
`finder/output/<cityId>/` changes (never `git add -A`).

`npm run refresh` is the Tampa shorthand. The old Windows Task Scheduler daily task
(`refresh-task.xml`) is retired — the weekly CI refresh supersedes it.

## Places (spots) — manual only, at need

The places pipeline is deliberately **not** in the weekly workflow (slow-moving data;
flaky-in-CI enrichment; keeps refresh.yml's "imagery untouched" contract trivial —
STAGE_E.md §E4). Run it when a city config/bbox changes or on a quarterly freshen:

```
CITY=<cityId> node finder/places.mjs
```

Eyeball the `places.md` digest diff, run `npm test`, commit.

## What refreshes what

- `finder/output/<cityId>/events.json` / `events.md` — the merged events dataset + digest
- `finder/output/<cityId>/places.json` / `places.md` — the spots dataset + digest
- `app/public/*` — staged ONLY via `CITY=<cityId> node finder/deploy.mjs`
  (`npm run deploy-city`); in CI the deploy workflow re-stages per city on every build,
  so the committed copy never ships stale.

It never invents data: every event comes from a real source, duplicates across sources
are merged (and counted as "buzz"), and stale/ended events are dropped at runtime and
rotated out on refresh. Imagery has its own supervised runbook —
[MULTICITY_IMAGERY_RUNBOOK.md](MULTICITY_IMAGERY_RUNBOOK.md) (human pixels required).
