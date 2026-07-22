# Refreshing the data (operator runbook)

The app serves `app/public/events.json` + `places.json` + `guides.json`. Those are **staged
copies** — `finder/deploy.mjs` is the ONLY thing that writes them (Stage D1). The real
artifacts live per city in `finder/output/<cityId>/`.

## Verified automatic refresh (the normal path, Stage E/Sprint 11)

**`.github/workflows/refresh.yml`** runs events daily at 09:23 UTC. It refreshes place
facts every Thursday and whenever a manual dispatch selects `refresh_places=true`.
Place enrichment is cache-only in verified-source mode: the workflow can retain already
reviewed imagery and descriptions, but it does not acquire new unsupervised image claims.

The first verified bootstrap must be a manual `refresh_places=true` run because the
legacy place receipts are `sourceHealth: unknown`. The workflow requires live primary
acquisition for Tampa's rendered event source and both cities' OSM place source; cached,
fallback, empty, failed, or out-of-market adapters remain explicitly degraded or failed.
It strictly verifies fresh and fully healthy event and place receipts for both cities,
runs `npm test`, and only then opens or updates `bot/data-refresh`. It never pushes to
main directly.

Review is not “merge and done”:

1. Read the PR's source-health table and every warning/failed benchmark line.
2. Open the PR's Checks/Actions entry. If it says `action_required`, select **Approve and run**.
3. Wait for an actual `gate` job to appear and pass. An empty check list or
   `action_required` is unexecuted, never green.
4. Merge only when both artifact kinds are fresh/healthy and all exceptions are understood.
5. Confirm the resulting Pages run emits a successful postdeploy composed-site attestation.

## Events — manual (a local one-off)

From the repo root:

```
node finder/finder.mjs                    # Tampa Bay (the default city)
CITY=sf-east-bay node finder/finder.mjs   # SF & East Bay
```

Takes a few minutes per city — it fetches every source live. For a publication candidate,
set `REQUIRE_LIVE_SOURCES=1` so rendered acquisition cannot silently fall back. Then eyeball the
`finder/output/<cityId>/events.md` digest, run `npm test`, and commit the
`finder/output/<cityId>/` changes (never `git add -A`).

`npm run refresh` is the Tampa shorthand. The old Windows Task Scheduler daily task
(`refresh-task.xml`) is retired — the daily CI refresh supersedes it.

## Places (spots) — weekly/manual verified facts

The workflow refreshes place facts weekly and on selected manual runs. City configs own
explicit adapter lists, so Tampa never imports SF-only adapters and SF never imports
Florida adapters; only OSM is shared. A zero-result or failed live adapter preserves its
last-good rows as degraded evidence and cannot pass strict publication.

For an operator-run verified refresh, use:

```
REQUIRE_LIVE_SOURCES=1 CITY=<cityId> node finder/places.mjs
```

This bypasses outer and OSM raw caches, refuses OSM's stale fallback endpoint, and keeps
Wikimedia enrichment cache-only. Eyeball the `places.md` digest diff and source-health
receipt, strictly stage both cities, run `npm test`, and commit only the scoped artifacts.

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
