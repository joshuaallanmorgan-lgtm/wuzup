// stpete.mjs — City of St. Petersburg calendar (stpete.org, Revize CMS).
//
// HOW THE DATA FLOWS (probed 2026-06-10):
// calendar.php is a FullCalendar-style widget (revize_calendar plugin, served
// from cdn1-global.revize.com). The plugin JS reveals its data source:
//   /_assets_/plugins/revizeCalendar/calendar_data_handler.php
//       ?webspace=stpete&relative_revize_url=//cms5.revize.com&protocol=https:
// That handler IGNORES start/end params and dumps the city's ENTIRE event
// table as one JSON array (~5.9 MB, ~5.6k records back to 2020). Records:
//   { title, primary_calendar_name, calendar_displays[], start, end?,
//     url, location, image (an <img> tag), desc (URL-encoded HTML),
//     rrule? (DTSTART/RDATE/RRULE/EXDATE lines), allDay?, id }
// Recurring city programs (e.g. GET FIT yoga/tai chi) exist ONLY as rrule
// records whose base `start` is years old — so we expand rrules ourselves.
//
// EDITORIAL FILTER (deliberate): 'Official City Meetings' / 'Public Meetings'
// calendars are excluded — they are RFP evaluation committees, pension boards
// and appeal hearings, not things-to-do. Coliseum / Mahaffey / Sunken Gardens /
// Woodson / General Events calendars are kept.
//
// The 5.9 MB dump is heavy for the city's server, so results are cached to
// finder/cache/stpete.json (6h TTL) with stale-cache fallback on failure.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchWithTimeout, cleanText } from './_shared.mjs';

export const name = 'City of St. Petersburg';

const FEED =
  'https://www.stpete.org/_assets_/plugins/revizeCalendar/calendar_data_handler.php' +
  '?webspace=stpete&relative_revize_url=//cms5.revize.com&protocol=https:';
const SITE = 'https://www.stpete.org';
const WINDOW_DAYS = 45;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// NOT cache/stpete.json — the orchestrator writes its own normalized fallback
// there and was silently clobbering this module's {fetchedAt, events} cache
// every run (so the 6h TTL never hit and the 5.9 MB dump re-downloaded).
const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'cache', 'stpete-source.json');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Calendars the site itself displays (ACTIVE_CALENDAR_IDS in calendar.php is
// "|2|9|6|4|15|16|"); display "9" is the meetings feed and "1" is the Master/
// test calendar — both excluded here.
const ACTIVE_DISPLAYS = new Set(['2', '4', '6', '15', '16']);
const EXCLUDED_CALENDARS = new Set(['Official City Meetings', 'Public Meetings', 'Master']);

// Fixed city venues that own whole calendars. Coordinates are the venues'
// real, permanent locations (saves a geocoder round-trip downstream).
const CALENDAR_VENUES = {
  Coliseum: {
    venue: 'The Coliseum', address: '535 4th Ave N, St. Petersburg, FL 33701',
    lat: 27.7757, lng: -82.6442, category: undefined,
  },
  'Mahaffey Theater': {
    venue: 'Mahaffey Theater', address: '400 1st St S, St. Petersburg, FL 33701',
    lat: 27.7679, lng: -82.6330, category: 'theatre',
  },
  'Sunken Gardens': {
    venue: 'Sunken Gardens', address: '1825 4th St N, St. Petersburg, FL 33704',
    lat: 27.7916, lng: -82.6388, category: 'outdoors',
  },
  'Woodson African American Museum of Florida': {
    venue: 'Woodson African American Museum of Florida', address: '2240 9th Ave S, St. Petersburg, FL 33712',
    lat: 27.7647, lng: -82.6664, category: 'art',
  },
};

// Light title-keyword categorizer for the General Events grab-bag.
function inferCategory(title) {
  const t = String(title || '');
  if (/\b(market|flea)\b/i.test(t)) return 'market';
  if (/\b(concert|jazz|symphony|pops|music)\b/i.test(t)) return 'music';
  if (/\bart\b/i.test(t)) return 'art';
  if (/\b(festival|pride|juneteenth|parade|celebration)\b/i.test(t)) return 'community';
  if (/\b(workshop|class|session)\b/i.test(t)) return 'community';
  if (/\b(yoga|tai chi|fitness|run|walk)\b/i.test(t)) return 'outdoors';
  return undefined;
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ---------------------------------------------------------------- rrule ----
// Minimal expander for the subset Revize actually emits (verified across all
// 142 rrule records in the dump): FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY,
// BYSETPOS (incl. -1 = last), COUNT, UNTIL, plus RDATE/EXDATE lines.
const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseStamp(s) {
  // '20220118T180000' or '20220118'
  const m = String(s).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function parseRRuleBlock(block) {
  const out = { dtstart: null, rdates: [], exdates: new Set(), rule: null };
  for (const line of String(block).split(/\n/)) {
    const [key, val] = line.split(/:(.+)/);
    if (!val) continue;
    if (key === 'DTSTART') out.dtstart = parseStamp(val);
    else if (key === 'RDATE') for (const v of val.split(',')) { const d = parseStamp(v); if (d) out.rdates.push(d); }
    else if (key === 'EXDATE') for (const v of val.split(',')) { const d = parseStamp(v); if (d) out.exdates.add(ymd(d)); }
    else if (key === 'RRULE') {
      const r = {};
      for (const part of val.split(';')) {
        const [k, v] = part.split('=');
        if (k && v) r[k] = v;
      }
      out.rule = r;
    }
  }
  return out;
}

// Is `date` the BYSETPOS-th BYDAY weekday of its month? (pos -1 = last)
function matchesMonthlyByDay(date, byday, pos) {
  if (WEEKDAYS[byday] !== date.getDay()) return false;
  if (pos > 0) return Math.ceil(date.getDate() / 7) === pos;
  if (pos === -1) return date.getDate() + 7 > new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return false;
}

// Expand into occurrence Dates within [winStart, winEnd] (day granularity).
function expandRRule(parsed, winStart, winEnd) {
  const { dtstart, rdates, exdates, rule } = parsed;
  if (!dtstart) return [];
  const hits = [];
  const addIfInWindow = (d) => {
    if (d >= winStart && d <= winEnd && !exdates.has(ymd(d))) hits.push(d);
  };

  if (rule) {
    const freq = rule.FREQ;
    const interval = Math.max(1, Number(rule.INTERVAL || 1));
    const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
    const until = rule.UNTIL ? parseStamp(rule.UNTIL) : null;
    const bydays = rule.BYDAY ? rule.BYDAY.split(',').map((s) => s.trim()) : null;
    const bysetpos = rule.BYSETPOS ? Number(rule.BYSETPOS) : null;
    const hardEnd = until && until < winEnd ? until : winEnd;
    const base = dayStart(dtstart);
    let n = 0;
    // Walk day-by-day from DTSTART so COUNT is honored from the true start.
    // Span is a few years of city programming — tens of k iterations, trivial.
    for (let d = new Date(base); d <= hardEnd && n < count; d.setDate(d.getDate() + 1)) {
      let match = false;
      const days = Math.round((d - base) / 86400000);
      if (freq === 'DAILY') {
        match = days % interval === 0;
      } else if (freq === 'WEEKLY') {
        const wd = Object.keys(WEEKDAYS).find((k) => WEEKDAYS[k] === d.getDay());
        const inDays = bydays ? bydays.includes(wd) : d.getDay() === dtstart.getDay();
        // Week parity measured from DTSTART's week (Sunday-aligned).
        const weeks = Math.floor((days + dtstart.getDay()) / 7);
        match = inDays && weeks % interval === 0;
      } else if (freq === 'MONTHLY') {
        const months = (d.getFullYear() - base.getFullYear()) * 12 + (d.getMonth() - base.getMonth());
        if (months % interval === 0) {
          if (bydays && bysetpos != null) match = bydays.some((bd) => matchesMonthlyByDay(d, bd, bysetpos));
          else match = d.getDate() === base.getDate();
        }
      }
      if (match) {
        n++;
        const occ = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dtstart.getHours(), dtstart.getMinutes(), dtstart.getSeconds());
        addIfInWindow(occ);
      }
    }
  }
  // Explicit extra dates (RDATE usually just repeats DTSTART, dedupe below).
  for (const d of rdates) addIfInWindow(d);

  const seen = new Set();
  return hits.filter((d) => { const k = +d; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ----------------------------------------------------------------- map -----
function absolutize(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return SITE + '/' + u.replace(/^\.?\//, '');
}

function extractImage(imgHtml) {
  const src = String(imgHtml || '').match(/src="([^"]+)"/)?.[1];
  if (!src || /placeholder\.png/i.test(src)) return null;
  return absolutize(src.replace(/\\\//g, '/'));
}

function decodeDesc(desc) {
  if (!desc) return null;
  let raw = String(desc);
  try { raw = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { /* keep raw */ }
  return cleanText(raw, 300);
}

function toStartString(date, allDay) {
  return allDay ? ymd(date) : `${ymd(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildEvent(rec, startDate, endDate) {
  const allDay = rec.allDay === true || rec.allDay === 'true';
  const vinfo = CALENDAR_VENUES[rec.primary_calendar_name] || null;
  const location = cleanText(rec.location, 200) || null;
  const description = decodeDesc(rec.desc);
  const title = cleanText(rec.title, 200);
  if (!title) return null;
  return {
    title,
    start: toStartString(startDate, allDay),
    end: endDate && !allDay ? toStartString(endDate, false) : null,
    venue: vinfo ? vinfo.venue : (location ? location.split(',')[0].trim() : 'St. Petersburg'),
    address: location || (vinfo ? vinfo.address : 'St. Petersburg, FL'),
    price: null, // the city feed publishes no price field; not guessing from prose
    isFree: /\bfree\b/i.test(`${title} ${description || ''}`),
    lat: vinfo ? vinfo.lat : null, // non-venue calendars: pipeline geocodes from address
    lng: vinfo ? vinfo.lng : null,
    url: absolutize(rec.url) || SITE + '/calendar.php',
    image: extractImage(rec.image),
    description,
    category: (vinfo && vinfo.category) || inferCategory(title),
    source: name,
  };
}

function parseRecords(records, winStart, winEnd) {
  const events = [];
  const seen = new Set();
  for (const rec of records) {
    if (!rec || !rec.title) continue;
    if (EXCLUDED_CALENDARS.has(rec.primary_calendar_name)) continue;
    const displays = Array.isArray(rec.calendar_displays) ? rec.calendar_displays : [];
    if (!displays.some((d) => ACTIVE_DISPLAYS.has(String(d)))) continue;

    let occurrences = [];
    let duration = null;
    if (rec.start && rec.end) {
      const s = new Date(rec.start), e = new Date(rec.end);
      if (!isNaN(s) && !isNaN(e) && e > s) duration = e - s;
    }
    if (rec.rrule) {
      occurrences = expandRRule(parseRRuleBlock(rec.rrule), winStart, winEnd);
    } else if (rec.start) {
      const d = new Date(rec.start);
      if (!isNaN(d) && d >= winStart && d <= winEnd) occurrences = [d];
    }
    for (const occ of occurrences) {
      const end = duration ? new Date(occ.getTime() + duration) : (rec.end && !rec.rrule ? new Date(rec.end) : null);
      const ev = buildEvent(rec, occ, end && !isNaN(end) ? end : null);
      if (!ev) continue;
      const key = `${ev.title}|${ev.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
  }
  return events;
}

// ----------------------------------------------------------------- cache ---
async function readCache() {
  try { return JSON.parse(await readFile(CACHE_FILE, 'utf8')); } catch { return null; }
}

async function writeCache(events) {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ fetchedAt: new Date().toISOString(), events }));
  } catch (err) {
    console.warn(`[stpete] cache write failed: ${err.message}`);
  }
}

export async function fetchEvents() {
  const cache = await readCache();
  if (cache && Date.now() - new Date(cache.fetchedAt).getTime() < CACHE_TTL_MS) {
    return cache.events;
  }

  const now = new Date();
  const winStart = dayStart(now);
  const winEnd = new Date(winStart.getTime() + WINDOW_DAYS * 86400000);

  try {
    const res = await fetchWithTimeout(FEED, { headers: { 'user-agent': UA } }, 60000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const records = await res.json();
    if (!Array.isArray(records)) throw new Error('unexpected payload shape');
    const events = parseRecords(records, winStart, winEnd);
    await writeCache(events);
    return events;
  } catch (err) {
    console.warn(`[stpete] feed failed: ${err.message}${cache ? ' — returning stale cache' : ''}`);
    return cache ? cache.events : [];
  }
}

// CLI runner: node finder/sources/stpete.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents().then((evs) => {
    console.log(`City of St. Petersburg: ${evs.length} events`);
    for (const e of evs.sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
      console.log(' -', e.start, '|', e.title.slice(0, 55), '|', e.venue, '|', e.category || '-', '|', e.isFree ? 'FREE' : '');
    }
  });
}
