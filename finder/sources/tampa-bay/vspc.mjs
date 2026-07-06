// Visit St. Pete/Clearwater (Pinellas DMO) event source — heavy render module.
//
// Site intel (verified live 2026-06):
// - Cloudflare challenge ("Just a moment...") hard-blocks plain fetch/curl (403),
//   but headless Playwright Chromium with a desktop UA passes on first navigation.
// - Drupal 11 site. The /events-festivals landing page embeds the ENTIRE event
//   dataset (~250 events) server-side in drupalSettings.mmg_listings_grid.results:
//   { id, title, dates: ['YYYY-MM-DD', ...occurrence days], json: { title, url,
//     photo, description, categories: ['Festivals', ...], address: {line_1, line_2,
//     city, state, postcode}, venue (rare), website, recurrence, start_date,
//     end_date (M/D/YYYY), event_cancelled, event_postponed, ... } }
//   Pagination on the page is client-side over this blob (cards are hydrated via
//   /listings-grid-data?l=<ids>), so ONE render captures everything. No times or
//   prices are published in the blob; event detail pages carry schema.org JSON-LD
//   but rendering ~180 of them per run is not viable, so starts are date-only.
// - waitUntil:'networkidle' is unreliable on this site (heavy ad/analytics tags);
//   use 'domcontentloaded' + settle wait, then poll for the drupal-settings tag.
//
// Heavy-render contract:
// - SKIP_RENDER=1  -> return cached events (any age) without launching;
//   no cache -> THROW so the orchestrator can serve its own last-good-pull
//   fallback (returning [] would overwrite that fallback with nothing).
// - Module cache finder/cache/vspc-source.json {fetchedAt, events}, 6h TTL.
//   (NOT vspc.json — the orchestrator writes its own normalized fallback
//   there and was silently clobbering this module's cache every run.)
// - On scrape failure, return stale cache; no cache -> throw.
//
// Time enrichment (Sprint L2): the listing blob has NO times. Detail pages DO
// carry per-occurrence times, but NOT in their schema.org JSON-LD — that block
// ships junk epoch dates (startDate "1969-12-31", probed live 2026-06-10).
// The real data sits in drupalSettings.vspc_listings.event_dates:
//   [{ the_date: 'YYYY-MM-DD', start_time: '9:00 pm', end_time: '9:30 pm',
//      times: [{...same per extra showtime}] }]
// (the `timestamp` field there does NOT agree with the displayed start_time —
// verified 1783213200 = 1pm EDT against a shown "9:00 pm" — so we trust the
// human-visible the_date/start_time strings and never the epoch.)
// We render a BUDGETED set of detail pages (soonest events first, same browser
// session, polite pacing, per-page Cloudflare challenge wait) and lift the
// time whose the_date matches the occurrence day we chose. Verdicts — incl.
// "page has no usable time" misses — are cached in finder/cache/vspc-times.json
// so repeat runs cost zero detail renders.
// Honest fallback: no day-matched parseable time -> the event stays date-only.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanText } from '../_shared.mjs';
import { cityId } from '../../cities/index.mjs';

export const name = 'Visit St. Pete/Clearwater';

const BASE = 'https://www.visitstpeteclearwater.com';
const LISTING_URL = `${BASE}/events-festivals`;
// D1: module caches live under the per-city cache dir (finder/cache/<cityId>/)
const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache', cityId, 'vspc-source.json');
const TIMES_CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache', cityId, 'vspc-times.json');
const MAX_AGE_HOURS = 6;
const DAYS_AHEAD = 45;
const ENRICH_BUDGET = 40;          // detail pages per run, soonest events first
const ENRICH_PACE_MS = 1500;       // polite gap between detail renders
const ENRICH_WALL_CLOCK_MS = 5 * 60 * 1000; // hard stop for the whole pass
const NEG_RECHECK_MS = 7 * 24 * 3600 * 1000; // re-probe no-time pages weekly
// Festivals/exhibits spanning more than this many days from the chosen start get
// end=null — emitting a months-long "end" for an exhibit run is more misleading
// than no end at all.
const MAX_END_SPAN_DAYS = 7;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Site category -> our vocabulary. Iteration order IS priority: specific signals
// (music/film/food) beat broad buckets (Festivals, Annual Festivals & Events).
// Full live vocabulary as of 2026-06: Annual Festivals & Events, Arts & Crafts,
// Civic, Cultural, Festivals, Film Events, Food + Drink, Kids, LGBTQ+,
// Music & Concerts, Nature, Sports & Recreation.
// Order notes (fixer pass 2026-06-10): LGBTQ+/Nature/Kids now outrank
// Sports & Recreation and Arts & Crafts/Cultural — the site tags pride events
// Cultural-first (they were landing "art") and nature programs ride the
// "Recreation" half of Sports & Recreation (a sea-turtle conservation
// ride-along was landing "sports").
const CATEGORY_MAP = new Map([
  ['Music & Concerts', 'music'],
  ['Film Events', 'art'],
  ['Food + Drink', 'food'],
  ['LGBTQ+', 'community'],
  ['Nature', 'outdoors'],
  ['Kids', 'family'],
  ['Sports & Recreation', 'sports'],
  ['Arts & Crafts', 'art'],
  ['Cultural', 'art'],
  ['Civic', 'community'],
  ['Festivals', 'market'],
  ['Annual Festivals & Events', 'market'],
]);

// ---------------------------------------------------------------------------
// Date helpers (local time, per contract)
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

function localDayStr(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(dayStr, days) {
  const [y, m, d] = dayStr.split('-').map(Number);
  return localDayStr(new Date(y, m - 1, d + days));
}

// 'M/D/YYYY' (site format for start_date/end_date) -> 'YYYY-MM-DD' | null.
function usDateToISO(str) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str || '').trim());
  if (!m) return null;
  return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
}

function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapCategory(categories) {
  if (!Array.isArray(categories)) return null;
  const present = new Set(categories.map((c) => String(c || '').trim()).filter(Boolean));
  for (const [siteCat, ours] of CATEGORY_MAP) {
    if (present.has(siteCat)) return ours;
  }
  return null;
}

function mapResult(result, todayDay, lastDay) {
  const j = result?.json || {};
  if (j.event_cancelled || j.event_postponed) return null;

  const title = cleanText(j.title || result.title, 300);
  if (!title) return null;

  // Occurrence days: union of the grid-level and json-level arrays (they can
  // differ by a day at the boundary). Keep valid 'YYYY-MM-DD' only, sorted.
  const dayRx = /^\d{4}-\d{2}-\d{2}$/;
  const days = [...new Set([...(result.dates || []), ...(j.dates || [])])]
    .filter((d) => typeof d === 'string' && dayRx.test(d))
    .sort();
  const start = days.find((d) => d >= todayDay && d <= lastDay);
  if (!start) return null; // no occurrence inside the window -> skip (no vague annuals)

  // end: only for short, non-recurring multi-day runs (e.g. a weekend festival).
  // Long exhibit runs and weekly recurrences get end=null.
  let end = null;
  if (!j.recurrence) {
    const endDay = usDateToISO(j.end_date);
    if (endDay && endDay > start && diffDays(start, endDay) <= MAX_END_SPAN_DAYS) end = endDay;
  }

  const a = j.address || {};
  const addressParts = [a.line_1, a.line_2, a.city, a.state, a.postcode]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  // join street/city/state with commas, but 'FL 33701' without one
  let address = null;
  if (addressParts.length) {
    address = addressParts.join(', ').replace(/, (\d{5}(?:-\d{4})?)$/, ' $1');
  }

  // Venue fallback chain (merge-integrity fix): 167/176 events ship venue-null,
  // which lets the pipeline's title-only same-day merge collapse DISTINCT events
  // ("Largo 4th of July Fireworks" swallowed "Treasure Island 4th of July
  // Fireworks"). A trailing "at <Venue>" in the title is the site's own venue
  // convention; the street line is the last resort. Non-null venue makes the
  // merge's venue-equality rules live again.
  let venue = cleanText(j.venue, 200);
  if (!venue) {
    const atMatch = title.match(/\bat\s+(?:the\s+)?([A-Z][\w'’.& -]{2,60})\s*$/);
    if (atMatch) venue = cleanText(atMatch[1], 200);
    else if (a.line_1) venue = cleanText(a.line_1, 200);
  }
  const event = {
    title,
    start,
    end,
    venue,
    address,
    price: null, // not published in the listing dataset
    isFree: null,
    lat: null, // not published; address geocodes downstream
    lng: null,
    url: typeof j.url === 'string' && j.url.startsWith('/') ? `${BASE}${j.url}` : null,
    image: typeof j.photo === 'string' && /^https?:/.test(j.photo) ? j.photo : null,
    description: cleanText(j.description),
    source: name,
  };
  const category = mapCategory(j.categories);
  if (category) event.category = category;
  // Recurring hint for the pipeline: the blob's recurrence field, or 3+
  // occurrence days. We ship ONE instance, so the pipeline's own 3-distinct-
  // dates detection can never fire — without this, a month-long attraction
  // poses as a one-night event (one-off heat bonus, Tonight-rail filler).
  if (j.recurrence || days.length >= 3) event.recurring = true;
  return event;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw && Array.isArray(raw.events)) return raw;
  } catch {
    /* missing or corrupt cache */
  }
  return null;
}

function writeCache(events) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: new Date().toISOString(), events }, null, 2));
  } catch (e) {
    console.error('[vspc] cache write failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Scrape
// ---------------------------------------------------------------------------

async function scrapeListingsGrid(page) {
  await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Poll for a parseable drupal-settings blob with grid results. The Cloudflare
  // interstitial ("Just a moment...") renders first on a challenged session and
  // is replaced after the JS challenge solves, so keep retrying for a while.
  const deadline = Date.now() + 45000;
  let results = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const rawSettings = await page
      .evaluate(() => {
        const el = document.querySelector('script[data-drupal-selector="drupal-settings-json"]');
        return el ? el.textContent : null;
      })
      .catch(() => null);
    if (rawSettings) {
      try {
        const grid = JSON.parse(rawSettings)?.mmg_listings_grid;
        if (grid && grid.results && Object.keys(grid.results).length) {
          results = Object.values(grid.results);
          break;
        }
      } catch {
        /* settings tag present but truncated mid-hydration; retry */
      }
    }
    const challenged = await page
      .evaluate(() => /just a moment|access denied|verify you are human/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 400)))
      .catch(() => false);
    if (challenged) console.error('[vspc] anti-bot interstitial showing; waiting it out');
  }
  if (!results) throw new Error('mmg_listings_grid results never appeared (blocked or markup change)');
  return results;
}

// ---------------------------------------------------------------------------
// Detail-page time enrichment (Sprint L2)
// ---------------------------------------------------------------------------

function readTimesCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(TIMES_CACHE_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch { /* missing or corrupt */ }
  return {};
}

function writeTimesCache(cache) {
  try {
    fs.mkdirSync(path.dirname(TIMES_CACHE_FILE), { recursive: true });
    fs.writeFileSync(TIMES_CACHE_FILE, JSON.stringify(cache, null, 1));
  } catch (e) {
    console.error('[vspc] times-cache write failed:', e.message);
  }
}

// UTC offset in effect in Tampa on a given local day ('-04:00' / '-05:00').
function easternOffsetFor(day) {
  const probe = new Date(`${day}T12:00:00Z`);
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'longOffset',
  }).formatToParts(probe).find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part?.value || '');
  return m ? m[1] : '-04:00';
}

// '9:00 pm' / '6 pm' / '10:30 AM' -> {h, min}; null when ambiguous (no am/pm).
function parseClock(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?m\.?$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function clockToISO(day, clock) {
  return `${day}T${pad(clock.h)}:${pad(clock.min)}:00${easternOffsetFor(day)}`;
}

// From a detail page's vspc_listings.event_dates, pick the start (and end)
// whose the_date matches `day` — the occurrence we actually ship. A time on a
// DIFFERENT day is not evidence about this occurrence; skip it.
function pickTimesForDay(eventDates, day) {
  const entries = [];
  for (const d of Array.isArray(eventDates) ? eventDates : []) {
    if (d && typeof d === 'object') {
      entries.push(d);
      for (const t of Array.isArray(d.times) ? d.times : []) {
        if (t && typeof t === 'object') entries.push(t);
      }
    }
  }
  for (const entry of entries) {
    if (entry.the_date !== day) continue;
    const startClock = parseClock(entry.start_time);
    if (!startClock) continue;
    if (startClock.h === 0 && startClock.min === 0) continue; // midnight placeholder
    const start = clockToISO(day, startClock);
    const endClock = parseClock(entry.end_time);
    let end = endClock ? clockToISO(day, endClock) : null;
    if (end && end <= start) end = null; // past-midnight ends: skip rather than lie
    return { start, end };
  }
  return null;
}

// Render up to ENRICH_BUDGET detail pages (soonest date-only events first)
// and lift the drupalSettings occurrence times. Mutates events in place.
// Each page gets a FRESH browser context: Cloudflare waves the first
// navigation of a clean session through (~2 s) but challenge-loops the 2nd+
// navigation in the same context indefinitely (probed live 2026-06-10).
async function enrichTimes(browser, events) {
  const cache = readTimesCache();
  const now = Date.now();
  let fromCache = 0;

  const dateOnly = events
    .filter((e) => e.url && /^\d{4}-\d{2}-\d{2}$/.test(e.start))
    .sort((a, b) => (a.start < b.start ? -1 : 1));

  // Pass 1 — cached verdicts are free, apply them to EVERY event.
  const needsFetch = [];
  for (const e of dateOnly) {
    const key = `${e.url}#${e.start}`;
    const hit = cache[key];
    if (hit && hit.start) {
      e.start = hit.start;
      if (hit.end && !e.end) e.end = hit.end;
      fromCache++;
    } else if (hit && hit.none && now - (hit.at || 0) < NEG_RECHECK_MS) {
      // known time-less page, checked recently — stays date-only
    } else {
      needsFetch.push(e);
    }
  }

  // Pass 2 — spend the render budget on the soonest unknowns.
  const batch = needsFetch.slice(0, ENRICH_BUDGET);
  let enriched = 0;
  let misses = 0;
  let failures = 0;
  if (batch.length) {
    const deadline = now + ENRICH_WALL_CLOCK_MS;
    for (const e of batch) {
      if (Date.now() > deadline) {
        console.error(`[vspc] enrichment wall clock hit — stopping early (${enriched} enriched)`);
        break;
      }
      // Consecutive failures with zero successes means we're blocked; stop
      // burning the politeness budget.
      if (failures >= 5 && enriched + misses === 0) {
        console.error('[vspc] enrichment aborted — detail pages not settling (blocked?)');
        break;
      }
      const key = `${e.url}#${e.start}`;
      const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
      try {
        const page = await context.newPage();
        await page.goto(e.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Poll for the settled drupal-settings blob (first navigation of a
        // fresh context typically settles in ~2 s; challenges are rare here).
        const pageDeadline = Date.now() + 15000;
        let eventDates = null;
        let settled = false;
        while (Date.now() < pageDeadline) {
          await page.waitForTimeout(1500);
          const settings = await page
            .evaluate(() => {
              const el = document.querySelector('script[data-drupal-selector="drupal-settings-json"]');
              return el ? el.textContent : null;
            })
            .catch(() => null);
          if (!settings) continue;
          try {
            const v = JSON.parse(settings)?.vspc_listings;
            if (v) {
              eventDates = Array.isArray(v.event_dates) ? v.event_dates : [];
              settled = true;
              break;
            }
          } catch { /* truncated mid-hydration; retry */ }
        }
        if (!settled) {
          // challenge never cleared — NOT a verdict about the event; retry
          // next run rather than caching a false "no time".
          failures++;
          console.error(`[vspc] detail page never settled (${e.url})`);
        } else {
          const times = pickTimesForDay(eventDates, e.start);
          if (times) {
            cache[key] = { ...times, at: Date.now() };
            e.start = times.start;
            if (times.end && !e.end) e.end = times.end;
            enriched++;
          } else {
            cache[key] = { none: true, at: Date.now() };
            misses++;
          }
          writeTimesCache(cache); // crash-safe: persist after every page
        }
      } catch (err) {
        failures++;
        console.error(`[vspc] detail render failed (${e.url}): ${err.message}`);
      } finally {
        await context.close().catch(() => {});
      }
      await new Promise((r) => setTimeout(r, ENRICH_PACE_MS));
    }
  }
  console.error(
    `[vspc] times: ${enriched} enriched live, ${fromCache} from cache, ` +
    `${misses} pages without a day-matched time, ${failures} failures ` +
    `(budget ${ENRICH_BUDGET}, ${needsFetch.length} candidates)`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchEvents() {
  const cache = readCache();

  if (process.env.SKIP_RENDER === '1') {
    // No module cache -> throw, so the orchestrator serves ITS last-good-pull
    // fallback instead of us handing it an empty (and cache-clobbering) list.
    if (!cache) throw new Error('SKIP_RENDER=1 and no module cache');
    return cache.events;
  }

  if (cache && Date.now() - Date.parse(cache.fetchedAt) < MAX_AGE_HOURS * 3600 * 1000) {
    return cache.events;
  }

  const todayDay = localDayStr(new Date());
  const lastDay = addDays(todayDay, DAYS_AHEAD);

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    let events;
    try {
      const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      const results = await scrapeListingsGrid(page);
      events = [];
      for (const result of results) {
        try {
          const event = mapResult(result, todayDay, lastDay);
          if (event) events.push(event);
        } catch (e) {
          console.warn(`[vspc] skipping result ${result?.id ?? '?'}: ${e.message}`);
        }
      }
      if (!events.length) throw new Error('grid rendered but zero events mapped');
      // Budgeted detail-page time enrichment, same browser session
      // (fresh context per page — see enrichTimes).
      try {
        await enrichTimes(browser, events);
      } catch (e) {
        console.error('[vspc] time enrichment failed (events stay date-only):', e.message);
      }
    } finally {
      await browser.close().catch(() => {});
    }
    writeCache(events);
    return events;
  } catch (e) {
    console.error('[vspc] scrape failed:', e.message);
    if (cache) {
      console.error(`[vspc] returning stale cache from ${cache.fetchedAt} (${cache.events.length} events)`);
      return cache.events;
    }
    throw e; // orchestrator falls back to its own cached pull
  }
}

// ---------------------------------------------------------------------------
// Standalone runner: node finder/sources/tampa-bay/vspc.mjs
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await fetchEvents();
  console.log(`count: ${events.length}`);
  console.log(`categorized: ${events.filter((e) => e.category).length}`);
  console.log(`with address: ${events.filter((e) => e.address).length}`);
  console.log(`with end: ${events.filter((e) => e.end).length}`);
  console.log(`with timed start: ${events.filter((e) => /T\d{2}:/.test(e.start)).length}`);
  console.log(`starting within 7 days: ${events.filter((e) => e.start <= addDays(localDayStr(new Date()), 7)).length}`);
  for (const sample of events.slice(0, 3)) console.log(JSON.stringify(sample));
}
