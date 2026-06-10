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
// - SKIP_RENDER=1  -> return cached events (any age) or [] without launching.
// - Cache finder/cache/vspc.json {fetchedAt, events}, 6h TTL.
// - On scrape failure, return stale cache (or []).

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanText } from './_shared.mjs';

export const name = 'Visit St. Pete/Clearwater';

const BASE = 'https://www.visitstpeteclearwater.com';
const LISTING_URL = `${BASE}/events-festivals`;
const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache', 'vspc.json');
const MAX_AGE_HOURS = 6;
const DAYS_AHEAD = 45;
// Festivals/exhibits spanning more than this many days from the chosen start get
// end=null — emitting a months-long "end" for an exhibit run is more misleading
// than no end at all.
const MAX_END_SPAN_DAYS = 7;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Site category -> our vocabulary. Iteration order IS priority: specific signals
// (music/sports/film/food) beat broad buckets (Festivals, Annual Festivals & Events).
// Full live vocabulary as of 2026-06: Annual Festivals & Events, Arts & Crafts,
// Civic, Cultural, Festivals, Film Events, Food + Drink, Kids, LGBTQ+,
// Music & Concerts, Nature, Sports & Recreation.
const CATEGORY_MAP = new Map([
  ['Music & Concerts', 'music'],
  ['Sports & Recreation', 'sports'],
  ['Film Events', 'art'],
  ['Food + Drink', 'food'],
  ['Arts & Crafts', 'art'],
  ['Cultural', 'art'],
  ['Nature', 'outdoors'],
  ['Kids', 'family'],
  ['LGBTQ+', 'community'],
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

async function scrapeListingsGrid() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
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
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchEvents() {
  const cache = readCache();

  if (process.env.SKIP_RENDER === '1') {
    if (!cache) console.warn('[vspc] SKIP_RENDER=1 and no cache; returning 0 events');
    return cache ? cache.events : [];
  }

  if (cache && Date.now() - Date.parse(cache.fetchedAt) < MAX_AGE_HOURS * 3600 * 1000) {
    return cache.events;
  }

  const todayDay = localDayStr(new Date());
  const lastDay = addDays(todayDay, DAYS_AHEAD);

  try {
    const results = await scrapeListingsGrid();
    const events = [];
    for (const result of results) {
      try {
        const event = mapResult(result, todayDay, lastDay);
        if (event) events.push(event);
      } catch (e) {
        console.warn(`[vspc] skipping result ${result?.id ?? '?'}: ${e.message}`);
      }
    }
    if (!events.length) throw new Error('grid rendered but zero events mapped');
    writeCache(events);
    return events;
  } catch (e) {
    console.error('[vspc] scrape failed:', e.message);
    if (cache) {
      console.error(`[vspc] returning stale cache from ${cache.fetchedAt} (${cache.events.length} events)`);
      return cache.events;
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Standalone runner: node finder/sources/vspc.mjs
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await fetchEvents();
  console.log(`count: ${events.length}`);
  console.log(`categorized: ${events.filter((e) => e.category).length}`);
  console.log(`with address: ${events.filter((e) => e.address).length}`);
  console.log(`with end: ${events.filter((e) => e.end).length}`);
  console.log(`starting within 7 days: ${events.filter((e) => e.start <= addDays(localDayStr(new Date()), 7)).length}`);
  for (const sample of events.slice(0, 3)) console.log(JSON.stringify(sample));
}
