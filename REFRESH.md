# Refreshing the events data

The app reads `app/public/events.json`. That file is produced by the finder pipeline, which pulls every event source (static JSON-LD sites, the Playwright-rendered sites, and the modules in `finder/sources/`), merges duplicates, geocodes venues, and writes fresh output. Run it once a day and the app always shows current events.

## Install the daily 6:00 AM task (one time, 3 steps)

1. Press the Windows key, type **Task Scheduler**, and open it.
2. In the right-hand "Actions" panel, click **Import Task...**
3. Pick `C:\Users\daonl\Desktop\cj\refresh-task.xml`, then click **OK** in the dialog that opens.

That's it — the task "CJ Events Refresh" now runs every day at 6:00 AM. If the PC was asleep at 6:00, it runs as soon as the machine is back (the task is set to "run as soon as possible after a missed start").

## Run it manually any time

From a terminal in `C:\Users\daonl\Desktop\cj`:

```
npm run refresh
```

(Equivalent to `node finder/finder.mjs`. Takes a few minutes — it fetches every source live.)

## What it refreshes

- `finder/output/events.json` — the full merged dataset (machine-readable)
- `finder/output/events.md` — the same data as a human-readable digest
- `app/public/events.json` — the copy the app actually serves

It never invents data: every event comes from a real source, duplicates across sources are merged (and counted as "buzz"), and stale/ended events are dropped.
