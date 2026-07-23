// finder/render.mjs
// Playwright-rendered scraper for JS-only sources (no structured data even after render).
// Currently: Creative Loafing Tampa community calendar — highest-value "hidden gems" source.
//
// Exports: scrapeRenderSources(opts) -> Promise<Array<event>> and
// scrapeRenderSourcesWithReceipt(opts) -> live/cache acquisition evidence.
// Event shape: { title, start, end, venue, address, price, isFree, url, image,
//                description, staffPick, promoted, source: 'Creative Loafing' }
//
// Caching: finder/cache/<cityId>/cltampa.json { fetchedAt, events }. Cache < 6h old is
// returned without launching a browser. On scrape failure, stale cache (or []) is returned.
//
// IMPORTANT site quirks (verified live):
// - waitUntil:'networkidle' hangs — use 'domcontentloaded' + settle wait.
// - /event/<slug>-<id> detail pages are HARD-BLOCKED by a Cloudflare WAF rule
//   (403 even for plain curl). Promoted-strip cards carry no inline date, so we
//   enrich them via the EventSearch keyword search (NOT blocked), matching the
//   result card by exact event href. Same Playwright page, same parser.
// - Listing results live in li.fdn-pres-item; the promoted strip is
//   a.fdn-promo-teaser-link inside .fdn-event-promo-block ("promo", not "promoted").
// - Card line order: Title / date phrase / venue / "street, City" / neighborhood /
//   GET TICKETS / price (often a BARE number like "20", or "$26.99", or "Free") /
//   categories / description snippet. Stale dates can appear inside description
//   text, so dates are only read from date-shaped lines above the address.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cityId } from './cities/index.mjs';
import { tz as tampaTimeZone } from './cities/tampa-bay.mjs';
import { addDaysStr, sourceWindow } from './sources/_shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CITY GATE (Stage D module-isolation): this scraper is Tampa-only — cltampa
// is a Tampa publication. finder.mjs checks this export and skips the render
// step for every other city (Tampa events must never enter another city's
// artifact). A future city's render scraper is a NEW module, not a BASE swap.
export const city = 'tampa-bay';

// D1: per-city cache dir (finder/cache/<cityId>/)
const CACHE_FILE = path.join(__dirname, 'cache', cityId, 'cltampa.json');
const SOURCE = 'Creative Loafing';
const BASE = 'https://community.cltampa.com';

const LISTING_URLS = [
  `${BASE}/tampa/EventSearch?narrowByDate=This+Weekend&sortType=date&v=d`,
  `${BASE}/tampa/EventSearch?narrowByDate=today&sortType=date&v=d`,
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Date / text parsing helpers
// ---------------------------------------------------------------------------

const MONTH_RX_SRC =
  '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const MONTH_NUM = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const CITIES = [
  'St. Petersburg', 'Saint Petersburg', 'St Petersburg', 'St. Pete Beach', 'Saint Pete Beach',
  'Tampa', 'Ybor City', 'Temple Terrace', 'Clearwater Beach', 'Clearwater', 'Largo', 'Dunedin',
  'Sarasota', 'Bradenton', 'Brandon', 'Riverview', 'Wesley Chapel', 'Lutz', "Land O' Lakes",
  'Land O Lakes', 'Palm Harbor', 'Tarpon Springs', 'Safety Harbor', 'Oldsmar', 'Seminole',
  'Pinellas Park', 'Plant City', 'Gulfport', 'Treasure Island', 'Madeira Beach', 'Ruskin',
  'Apollo Beach', 'New Port Richey', 'Port Richey', 'Trinity', 'Odessa', 'Valrico', 'Seffner',
  'Zephyrhills', 'Indian Rocks Beach', 'Belleair', 'Holiday', 'Spring Hill', 'Brooksville',
  'Tierra Verde', 'Palmetto', 'Ellenton', 'Wimauma', 'Dade City',
];
const CITY_RX_SRC = '(' + CITIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
const ADDRESS_RX = new RegExp(
  "(\\d{1,6}\\s+[A-Za-z0-9][A-Za-z0-9 .'#/&-]{2,70}?),?\\s+" + CITY_RX_SRC + '\\b',
  'i'
);

// A line that plausibly carries the event's date/recurrence phrase.
const DATE_LINE_RX = new RegExp(
  '^(?:' +
    '(?:mon|tue(?:s)?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?\\.?,?\\s|' +
    'daily\\b|every\\s|(?:first|second|third|fourth|last)\\s|opens\\s|through\\s|' +
    MONTH_RX_SRC + '\\.?\\s+\\d' +
    ')',
  'i'
);

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateStr(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

// Resolve "June 6" to a concrete year: current year, unless that puts it more
// than 14 days in the past, in which case roll to next year.
function resolveYear(monthIdx, day, today) {
  let year = Number(today.slice(0, 4));
  const cutoff = addDaysStr(today, -14);
  if (dateStr(year, monthIdx, day) < cutoff) year += 1;
  try {
    addDaysStr(dateStr(year, monthIdx, day), 0);
    return year;
  } catch {
    return null;
  }
}

// Parse a single time token like "10 a.m.", "7:30 p.m.", "noon".
function parseTimeToken(str) {
  if (/\bnoon\b/i.test(str)) return { h: 12, m: 0 };
  if (/\bmidnight\b/i.test(str)) return { h: 0, m: 0 };
  const m = str.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3].toLowerCase();
  if (h === 12) h = mer === 'a' ? 0 : 12;
  else if (mer === 'p') h += 12;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

// Extract start/end times from the context text that follows a "Month DD" match.
function timesFromContext(ctx) {
  // Don't read past the next month-day phrase ("... and Sun., June 7, 10 a.m.").
  const nextMonth = ctx.search(new RegExp('\\b' + MONTH_RX_SRC + '\\.?\\s+\\d{1,2}\\b', 'i'));
  if (nextMonth >= 0) ctx = ctx.slice(0, nextMonth);

  // Shared-meridiem range first: "10-11 a.m." / "2-4:30 p.m."
  const shared = ctx.match(/(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i);
  const explicit = /(\d{1,2})(?::\d{2})?\s*([ap])\.?\s*m\b\.?\s*[-–—]/i.test(ctx);
  if (shared && !explicit) {
    const mer = shared[5].toLowerCase();
    const mk = (hRaw, mRaw) => {
      let h = parseInt(hRaw, 10);
      const min = mRaw ? parseInt(mRaw, 10) : 0;
      if (h === 12) h = mer === 'a' ? 0 : 12;
      else if (mer === 'p') h += 12;
      return { h, m: min };
    };
    return { start: mk(shared[1], shared[2]), end: mk(shared[3], shared[4]) };
  }

  // Standard: "10 a.m.-6 p.m." or just "7:30 p.m."
  const tokenRx = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?|noon|midnight/gi;
  const tokens = [];
  let m;
  while ((m = tokenRx.exec(ctx)) && tokens.length < 2) {
    const t = parseTimeToken(m[0]);
    if (t) tokens.push({ ...t, index: m.index, len: m[0].length });
  }
  if (!tokens.length) return { start: null, end: null };
  let end = null;
  if (tokens.length === 2) {
    const between = ctx.slice(tokens[0].index + tokens[0].len, tokens[1].index);
    if (/^\s*[-–—]\s*$|^\s*to\s*$/i.test(between)) end = tokens[1];
  }
  return { start: tokens[0], end };
}

// Find every "MonthName DD" in text; return [{y, m, d, time, endTime, index}].
function collectDates(text, today) {
  const rx = new RegExp(MONTH_RX_SRC + '\\.?\\s+(\\d{1,2})\\b', 'gi');
  const out = [];
  let m;
  while ((m = rx.exec(text))) {
    const key = m[1].slice(0, 3).toLowerCase();
    const monthIdx = MONTH_NUM[key];
    const day = parseInt(m[2], 10);
    if (monthIdx === undefined || day < 1 || day > 31) continue;
    const ctx = text.slice(rx.lastIndex, rx.lastIndex + 70);
    const { start: time, end: endTime } = timesFromContext(ctx);
    const y = resolveYear(monthIdx, day, today);
    if (y !== null) out.push({ y, m: monthIdx, d: day, time, endTime, index: m.index });
  }
  return out;
}

// Pick the start (first occurrence >= today; else first occurrence) and emit ISO strings.
function chooseStart(dates, today) {
  if (!dates.length) return { start: null, end: null };
  const chosen = dates.find((dd) => dateStr(dd.y, dd.m, dd.d) >= today) || dates[0];
  const ds = dateStr(chosen.y, chosen.m, chosen.d);
  const start = chosen.time ? `${ds}T${pad(chosen.time.h)}:${pad(chosen.time.m)}:00` : ds;
  const end = chosen.endTime ? `${ds}T${pad(chosen.endTime.h)}:${pad(chosen.endTime.m)}:00` : null;
  return { start, end };
}

// Parse a card's (or search-result's) innerText into event fields.
function parseEventText(text, title, today) {
  const empty = { start: null, end: null, venue: null, address: null, price: null, isFree: null, description: null };
  const lines = (text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return empty;
  const flat = lines.join(' ');
  if (/you have been blocked/i.test(flat)) return empty;

  // Address line: starts with a street number and ends in a known Tampa Bay city.
  let addrIdx = -1;
  let address = null;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d{1,6}\s/.test(lines[i])) continue;
    const m = lines[i].match(ADDRESS_RX);
    if (m) {
      addrIdx = i;
      address = `${m[1].trim().replace(/,$/, '')}, ${m[2].trim()}`;
      break;
    }
  }

  const ticketsIdx = lines.findIndex((l) => /^(get|buy) tickets/i.test(l));

  // Venue: the line right before the address line.
  let venue = null;
  if (addrIdx > 0) {
    const cand = lines[addrIdx - 1];
    if (cand && cand !== title && cand.length <= 80 && !DATE_LINE_RX.test(cand)) venue = cand;
  }

  // Dates: only from date-shaped lines above the address / GET TICKETS block —
  // description snippets can contain stale dates (e.g. "...on Saturday, Jan. 14...").
  let dateText = '';
  for (let i = 1; i < lines.length; i++) {
    if (addrIdx >= 0 && i >= addrIdx) break;
    if (ticketsIdx >= 0 && i >= ticketsIdx) break;
    const l = lines[i];
    if (l === title || l === venue) continue;
    if (DATE_LINE_RX.test(l)) dateText += l + ' \n ';
  }
  let dates = collectDates(dateText, today);
  if (!dates.length && lines.length <= 2) dates = collectDates(flat, today); // flat-text fallback
  const { start, end } = chooseStart(dates, today);

  // Price: a standalone "Free" line, a "$26.99" line, or a bare number right
  // after the GET TICKETS line ("20").
  let price = null;
  let isFree = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^free(\s+admission)?\.?$/i.test(l)) {
      isFree = true;
      price = 0;
      break;
    }
    const pm = l.match(/^\$?(\d+(?:\.\d{1,2})?)(?:\s*[-–]\s*\$?\d+(?:\.\d{1,2})?)?$/);
    if (pm && (l.startsWith('$') || (ticketsIdx >= 0 && i === ticketsIdx + 1))) {
      price = parseFloat(pm[1]);
      isFree = price === 0;
      break;
    }
  }
  if (price === null && isFree === null) {
    const dm = flat.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
    if (dm) {
      price = parseFloat(dm[1]);
      isFree = price === 0;
    }
  }

  // Description: first substantial line after the address/tickets block;
  // fall back to the categories line ("Theater, Performance, Live Music").
  let description = null;
  const scanFrom = Math.max(addrIdx, ticketsIdx, 0) + 1;
  for (let i = scanFrom; i < lines.length; i++) {
    const l = lines[i];
    if (l.length >= 60 && l !== title && !DATE_LINE_RX.test(l)) {
      description = l;
      break;
    }
  }
  if (!description) {
    for (let i = scanFrom; i < lines.length; i++) {
      const l = lines[i];
      if (l.length <= 60 && /^[A-Z][A-Za-z&' ]+(,\s*[A-Z][A-Za-z&' ]+)+$/.test(l)) {
        description = l;
        break;
      }
    }
  }

  return { start, end, venue, address, price, isFree, description };
}

export function createCreativeLoafingParser({ nowMs } = {}) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const { today } = sourceWindow(tampaTimeZone, nowMs, 0);
  return (text, title) => parseEventText(text, title, today);
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

export function isRenderCacheFresh(cache, { nowMs, maxAgeMs } = {}) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new TypeError('maxAgeMs must be a non-negative finite number');
  }
  if (!cache || !Array.isArray(cache.events)) return false;
  const fetchedAt = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;
  const ageMs = nowMs - fetchedAt;
  return ageMs >= 0 && ageMs < maxAgeMs;
}

function writeCache(events, nowMs) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: new Date(nowMs).toISOString(), events }, null, 2));
  } catch (e) {
    console.error('[render] cache write failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// In-page extraction (runs inside the browser)
// ---------------------------------------------------------------------------

function extractListingCards() {
  const eventPathRx = /\/event\/[a-z0-9-]+-\d+$/i;
  const mediaRx = /media\d*\.cltampa\.com/;
  const cards = [];

  const isEventHref = (href) => {
    try {
      return eventPathRx.test(new URL(href).pathname);
    } catch {
      return false;
    }
  };
  const cleanHref = (href) => href.split('?')[0].split('#')[0];
  const findImage = (root) => {
    for (const img of root.querySelectorAll('img')) {
      const src = img.src || img.getAttribute('data-src') || '';
      if (mediaRx.test(src)) return src;
    }
    return null;
  };

  // Promoted strip (top slider; image + title only, no inline date).
  for (const a of document.querySelectorAll('a.fdn-promo-teaser-link')) {
    if (!isEventHref(a.href)) continue;
    const h3 = a.querySelector('h3');
    cards.push({
      href: cleanHref(a.href),
      title: ((h3 && h3.innerText) || a.innerText || '').replace(/\s+/g, ' ').trim(),
      cardText: '',
      promoted: true,
      staffPick: false,
      image: findImage(a),
    });
  }

  // Regular search-result cards.
  for (const li of document.querySelectorAll('li.fdn-pres-item')) {
    const anchors = Array.from(li.querySelectorAll('a[href*="/event/"]')).filter((a) => isEventHref(a.href));
    if (!anchors.length) continue;
    let best = anchors[0];
    let bestLen = -1;
    for (const a of anchors) {
      const t = (a.innerText || '').trim();
      if (t.length > bestLen) {
        best = a;
        bestLen = t.length;
      }
    }
    cards.push({
      href: cleanHref(best.href),
      title: (best.innerText || '').replace(/\s+/g, ' ').trim(),
      cardText: (li.innerText || '').trim(),
      promoted: false,
      staffPick: !!li.querySelector('[class*="staff-pick"], [title="Staff Pick"]'),
      image: findImage(li),
    });
  }

  // Generic fallback (markup change resilience): climb from event anchors until
  // the text is substantially richer than the title, without crossing into a
  // container that holds other events.
  if (!cards.length) {
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/event/"]')).filter((a) => isEventHref(a.href));
    const eventLinkCount = (el) => {
      const hrefs = new Set();
      for (const x of el.querySelectorAll('a[href*="/event/"]')) {
        if (isEventHref(x.href)) hrefs.add(cleanHref(x.href));
      }
      return hrefs.size;
    };
    for (const a of anchors) {
      const href = cleanHref(a.href);
      if (seen.has(href)) continue;
      seen.add(href);
      const title = (a.innerText || '').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      let el = a.parentElement;
      let card = null;
      let scope = a;
      for (let i = 0; i < 7 && el && el !== document.body; i++) {
        if (eventLinkCount(el) > 1) break;
        scope = el;
        const t = (el.innerText || '').trim();
        if (t.length > title.length + 20) {
          card = el;
          break;
        }
        el = el.parentElement;
      }
      let promoted = false;
      let anc = a;
      for (let i = 0; i < 12 && anc && anc !== document.documentElement; i++) {
        const cls = (anc.getAttribute && anc.getAttribute('class')) || '';
        if (/promo/i.test(cls)) {
          promoted = true;
          break;
        }
        anc = anc.parentElement;
      }
      cards.push({
        href,
        title,
        cardText: card ? (card.innerText || '').trim() : '',
        promoted,
        staffPick: !!scope.querySelector('[class*="staff-pick"], [title="Staff Pick"]'),
        image: findImage(scope),
      });
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Browser navigation
// ---------------------------------------------------------------------------

async function renderListing(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // networkidle hangs on this site; settle wait + results selector instead.
  await page.waitForSelector('li.fdn-pres-item', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(5000);
  return page.evaluate(extractListingCards);
}

// Delay between detail-enrichment navigations: 3-5s with a "randomized feel" —
// the base varies deterministically by navigation index (so consecutive waits
// differ) plus real jitter. Rapid-fire or metronome-regular requests trip the
// Cloudflare WAF mid-run ("Sorry, you have been blocked").
function detailDelayMs(i) {
  return 3000 + ((i * 977) % 1400) + Math.floor(Math.random() * 600);
}

// Enrich a promoted (date-less) event via the keyword search listing — the
// /event/ detail pages are Cloudflare-blocked, but EventSearch is not, and the
// search-result card carries the full date/venue/address/price block.
// Politeness: paced navs (detailDelayMs), listing-page referer, shared budget
// (max 5 navs/run), and a hard stop for the rest of the run on any block page.
async function searchLookup(page, ev, budget) {
  const cleanTitle = ev.title.replace(/['"’‘“”]/g, '').replace(/\s+/g, ' ').trim();
  const queries = [`"${cleanTitle}"`, cleanTitle];
  for (const q of queries) {
    if (budget.blocked || budget.navsLeft <= 0) return null;
    budget.navsLeft -= 1;
    const url = `${BASE}/tampa/EventSearch?keywords=${encodeURIComponent(q)}&sortType=date&v=d`;
    try {
      await page.waitForTimeout(detailDelayMs(budget.navsUsed));
      budget.navsUsed += 1;
      // Referer = the listing page the promoted card actually came from,
      // matching how a human would reach this search.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, referer: budget.referer });
      await page.waitForSelector('li.fdn-pres-item', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const blocked = await page.evaluate(
        () =>
          /blocked|attention required/i.test(document.title || '') ||
          /you have been blocked/i.test((document.body && document.body.innerText) || '')
      );
      if (blocked) {
        // IP is flagged — do NOT hammer; no more detail fetches this run.
        budget.blocked = true;
        console.error(`[render] CF block during search lookup (${ev.title}); stopping detail fetches for this run`);
        return null;
      }
      const cards = await page.evaluate(extractListingCards);
      const match = cards.find((c) => !c.promoted && c.href === ev.url && c.cardText);
      if (match) return match;
    } catch (e) {
      console.error(`[render] search lookup failed (${ev.title}):`, e.message);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main scrape
// ---------------------------------------------------------------------------

function mergeParsed(ev, parsed) {
  if (!ev.start && parsed.start) {
    ev.start = parsed.start;
    ev.end = parsed.end;
  }
  ev.venue = ev.venue || parsed.venue;
  ev.address = ev.address || parsed.address;
  if (ev.price === null && parsed.price !== null) ev.price = parsed.price;
  if (ev.isFree === null && parsed.isFree !== null) ev.isFree = parsed.isFree;
  ev.description = ev.description || parsed.description;
}

async function scrapeCreativeLoafing(opts, parseCard) {
  // Detail-render budget: hard cap of 5 per run regardless of opts — the CF
  // WAF flags this IP when we dig harder than that.
  const budget = {
    navsLeft: Math.min(opts.maxDetailRenders ?? 5, 5),
    navsUsed: 0,
    blocked: false,
    referer: LISTING_URLS[0],
  };
  const browser = await chromium.launch({
    headless: opts.headless ?? true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    // One context + one page reused for every navigation this run (cookies /
    // CF clearance persist across listing renders and detail lookups).
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();

    // 1. Listing pages (this weekend + tonight).
    const seen = new Map(); // href -> event
    let first = true;
    for (const url of LISTING_URLS) {
      if (!first) await page.waitForTimeout(5000 + Math.floor(Math.random() * 3000));
      first = false;
      let cards = [];
      try {
        cards = await renderListing(page, url);
        if (opts.requireLive && cards.length === 0) {
          throw new Error('required live listing returned zero cards');
        }
      } catch (e) {
        console.error(`[render] listing failed (${url}):`, e.message);
        if (opts.requireLive) {
          throw new Error(`required live listing failed for ${url}: ${e.message || e}`);
        }
        continue;
      }
      for (const c of cards) {
        if (!c.title) continue;
        const existing = seen.get(c.href);
        if (existing) {
          existing.promoted = existing.promoted || c.promoted;
          existing.staffPick = existing.staffPick || c.staffPick;
          if (!existing.image && c.image) existing.image = c.image;
          if (c.cardText) {
            mergeParsed(existing, parseCard(c.cardText, c.title));
            existing._hadCard = true;
          }
          continue;
        }
        const parsed = parseCard(c.cardText, c.title);
        seen.set(c.href, {
          title: c.title,
          start: parsed.start,
          end: parsed.end,
          venue: parsed.venue,
          address: parsed.address,
          price: parsed.price,
          isFree: parsed.isFree,
          url: c.href,
          image: c.image || null,
          description: parsed.description,
          staffPick: c.staffPick,
          promoted: c.promoted,
          source: SOURCE,
          _hadCard: !!c.cardText,
        });
      }
    }

    // 2. Enrichment for events that never had a real card (the promoted strip).
    //    Events WITH a card but no parseable date are recurring ("Second Saturday
    //    of every month") — a lookup would just return the same card, so skip.
    const needsLookup = [...seen.values()].filter((e) => !e.start && !e._hadCard);
    needsLookup.sort((a, b) => (b.promoted - a.promoted) || (b.staffPick - a.staffPick));
    for (let pass = 0; pass < 2; pass++) {
      const pending = needsLookup.filter((e) => !e.start);
      if (!pending.length || budget.navsLeft <= 0 || budget.blocked) break;
      if (pass > 0) await page.waitForTimeout(20000); // back off before retrying (CF cool-down)
      for (const ev of pending) {
        if (budget.navsLeft <= 0 || budget.blocked) break;
        const match = await searchLookup(page, ev, budget);
        if (match) {
          mergeParsed(ev, parseCard(match.cardText, match.title));
          ev.image = ev.image || match.image;
          ev.staffPick = ev.staffPick || match.staffPick;
        }
      }
    }

    const events = [...seen.values()];
    for (const ev of events) delete ev._hadCard;
    return events;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scrapeRenderSourcesWithReceipt(opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const maxAgeMs = (opts.maxAgeHours ?? 6) * 3600 * 1000;
  const parseCard = createCreativeLoafingParser({ nowMs });
  const readCacheImpl = opts.readCacheImpl || readCache;
  const writeCacheImpl = opts.writeCacheImpl || writeCache;
  const scrapeImpl = opts.scrapeImpl || scrapeCreativeLoafing;
  const logger = opts.logger || console;

  if (!opts.force && !opts.requireLive) {
    const cache = readCacheImpl();
    if (isRenderCacheFresh(cache, { nowMs, maxAgeMs })) {
      return Object.freeze({ events: cache.events, acquisition: 'fresh-cache', error: null });
    }
  }

  try {
    const events = await scrapeImpl(opts, parseCard);
    if (!events.length) throw new Error('zero events extracted');
    writeCacheImpl(events, nowMs);
    return Object.freeze({ events, acquisition: 'live', error: null });
  } catch (e) {
    logger.error('[render] scrape failed:', e.message);
    if (opts.requireLive) {
      throw new Error(`required live render acquisition failed: ${e.message || e}`);
    }
    const stale = readCacheImpl();
    return Object.freeze({
      events: stale ? stale.events : [],
      acquisition: stale ? 'stale-cache' : 'failed',
      error: String(e.message || e),
    });
  }
}

export async function scrapeRenderSources(opts = {}) {
  const receipt = await scrapeRenderSourcesWithReceipt(opts);
  return receipt.events;
}

// ---------------------------------------------------------------------------
// Standalone runner: node finder/render.mjs [--cached]
// ---------------------------------------------------------------------------

const isMain = (() => {
  try {
    return (
      process.argv[1] &&
      import.meta.url.toLowerCase() === pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase()
    );
  } catch {
    return false;
  }
})();

if (isMain) {
  const force = !process.argv.includes('--cached');
  scrapeRenderSources({ force })
    .then((events) => {
      const withDates = events.filter((e) => e.start);
      const promoted = events.filter((e) => e.promoted);
      const promotedDated = promoted.filter((e) => e.start);
      const picks = events.filter((e) => e.staffPick);
      console.log('--- Creative Loafing scrape summary ---');
      console.table([
        {
          events: events.length,
          withDates: withDates.length,
          promoted: promoted.length,
          promotedDated: promotedDated.length,
          staffPicks: picks.length,
          venues: events.filter((e) => e.venue).length,
          addresses: events.filter((e) => e.address).length,
        },
      ]);
      console.log('--- first 5 events ---');
      console.log(JSON.stringify(events.slice(0, 5), null, 2));
    })
    .catch((e) => {
      console.error('fatal:', e);
      process.exitCode = 1;
    });
}
