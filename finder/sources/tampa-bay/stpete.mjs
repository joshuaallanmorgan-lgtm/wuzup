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
import {
  calendarDayDiff,
  daysInMonth,
  parseZonedDateTime,
  weekdayOf,
  zonedDateTimeParts,
} from '../../../shared/city-time.mjs';
import { fetchWithTimeout, cleanText, addDaysStr, sourceWindow } from '../_shared.mjs';
import { cityId } from '../../cities/index.mjs';
import { tz as tampaTimeZone } from '../../cities/tampa-bay.mjs';

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
// D1: lives under the per-city cache dir (finder/cache/<cityId>/).
// '..', '..' — this module sits a level deeper since the Stage D module-
// isolation split (finder/sources/ -> finder/sources/<cityId>/); the single
// '..' was silently writing untracked finder/sources/cache/ (ship-gate catch).
const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cache', cityId, 'stpete-source.json');
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
const civilStamp = (value) => `${value.day}T${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;

function civil(day, hour = 0, minute = 0, second = 0, timed = false) {
  try { addDaysStr(day, 0); } catch { return null; }
  if (
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59 ||
    !Number.isInteger(second) || second < 0 || second > 59
  ) return null;
  return { day, hour, minute, second, timed };
}

function civilAtInstant(epochMs) {
  const parts = zonedDateTimeParts(epochMs, tampaTimeZone);
  return {
    ...civil(
      `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
      parts.hour,
      parts.minute,
      parts.second,
      true,
    ),
    instantMs: epochMs,
  };
}

function civilFromInstant(value, recurrenceBasis = null) {
  const parsed = parseZonedDateTime(value, tampaTimeZone);
  if (!parsed.ok) return null;
  const projected = civilAtInstant(parsed.epochMs);
  return recurrenceBasis ? { ...projected, recurrenceBasis } : projected;
}

function normalizeOffset(value) {
  return value.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
}

function parseCivil(value) {
  const raw = String(value || '').trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (compact) {
    const day = `${compact[1]}-${compact[2]}-${compact[3]}`;
    if (compact[7]) {
      const offset = normalizeOffset(compact[7]);
      return civilFromInstant(
        `${day}T${compact[4]}:${compact[5]}:${compact[6]}${offset}`,
        {
          day,
          hour: Number(compact[4]),
          minute: Number(compact[5]),
          second: Number(compact[6]),
          offset,
        },
      );
    }
    return civil(
      day,
      Number(compact[4] || 0),
      Number(compact[5] || 0),
      Number(compact[6] || 0),
      compact[4] !== undefined,
    );
  }
  const expanded = raw.match(/^(\d{4}-\d{2}-\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (!expanded) return null;
  if (expanded[5]) {
    const offset = normalizeOffset(expanded[5]);
    return civilFromInstant(
      `${expanded[1]}T${expanded[2]}:${expanded[3]}:${expanded[4] || '00'}${offset}`,
      {
        day: expanded[1],
        hour: Number(expanded[2]),
        minute: Number(expanded[3]),
        second: Number(expanded[4] || 0),
        offset,
      },
    );
  }
  return civil(
    expanded[1],
    Number(expanded[2] || 0),
    Number(expanded[3] || 0),
    Number(expanded[4] || 0),
    expanded[2] !== undefined,
  );
}

function compareCivil(a, b) {
  return civilStamp(a).localeCompare(civilStamp(b));
}

function civilDurationSeconds(start, end) {
  if (!start || !end) return null;
  if (Number.isFinite(start.instantMs) && Number.isFinite(end.instantMs)) {
    const duration = (end.instantMs - start.instantMs) / 1000;
    return duration > 0 ? duration : null;
  }
  const daySeconds = calendarDayDiff(start.day, end.day) * 86400;
  const startSeconds = start.hour * 3600 + start.minute * 60 + start.second;
  const endSeconds = end.hour * 3600 + end.minute * 60 + end.second;
  const duration = daySeconds + endSeconds - startSeconds;
  return duration > 0 ? duration : null;
}

function addCivilSeconds(start, seconds) {
  if (Number.isFinite(start.instantMs)) {
    return civilAtInstant(start.instantMs + seconds * 1000);
  }
  const epochMs = Date.parse(`${civilStamp(start)}Z`) + seconds * 1000;
  if (!Number.isFinite(epochMs)) return null;
  const iso = new Date(epochMs).toISOString();
  return civil(
    iso.slice(0, 10),
    Number(iso.slice(11, 13)),
    Number(iso.slice(14, 16)),
    Number(iso.slice(17, 19)),
    true,
  );
}

function validWallTime(value, disambiguation) {
  return parseZonedDateTime(civilStamp(value), tampaTimeZone, { disambiguation }).ok;
}

// ---------------------------------------------------------------- rrule ----
// Minimal expander for the subset Revize actually emits (verified across all
// 142 rrule records in the dump): FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY,
// BYSETPOS (incl. -1 = last), COUNT, UNTIL, plus RDATE/EXDATE lines.
const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseStamp(s) {
  // '20220118T180000' or '20220118'
  return parseCivil(s);
}

function parseRRuleBlock(block) {
  const out = { dtstart: null, rdates: [], exdates: new Set(), rule: null };
  for (const line of String(block).split(/\n/)) {
    const [key, val] = line.split(/:(.+)/);
    if (!val) continue;
    const bareKey = key.split(';')[0];
    if (bareKey === 'DTSTART') out.dtstart = parseStamp(val);
    else if (bareKey === 'RDATE') for (const v of val.split(',')) { const d = parseStamp(v); if (d) out.rdates.push(d); }
    else if (bareKey === 'EXDATE') for (const v of val.split(',')) { const d = parseStamp(v); if (d) out.exdates.add(d.day); }
    else if (bareKey === 'RRULE') {
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
function matchesMonthlyByDay(day, byday, pos) {
  if (WEEKDAYS[byday] !== weekdayOf(day)) return false;
  const dayOfMonth = Number(day.slice(8, 10));
  if (pos > 0) return Math.ceil(dayOfMonth / 7) === pos;
  if (pos === -1) return dayOfMonth + 7 > daysInMonth(day);
  return false;
}

function monthDistance(fromDay, toDay) {
  const [fromYear, fromMonth] = fromDay.split('-').map(Number);
  const [toYear, toMonth] = toDay.split('-').map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth;
}

function occurrenceOnDay(dtstart, day) {
  const basis = dtstart.recurrenceBasis;
  if (!basis) return { ...dtstart, day };
  return civilFromInstant(
    `${day}T${pad(basis.hour)}:${pad(basis.minute)}:${pad(basis.second)}${basis.offset}`,
    { ...basis, day },
  );
}

// Expand into occurrence Dates within [winStart, winEnd] (day granularity).
function expandRRule(parsed, firstDay, lastDay) {
  const { dtstart, rdates, exdates, rule } = parsed;
  if (!dtstart) return [];
  const hits = [];
  const addIfInWindow = (occurrence) => {
    if (
      occurrence.day >= firstDay && occurrence.day <= lastDay &&
      !exdates.has(occurrence.day)
    ) hits.push(occurrence);
  };

  if (rule) {
    const basis = dtstart.recurrenceBasis || dtstart;
    const freq = rule.FREQ;
    const rawInterval = Number(rule.INTERVAL || 1);
    const interval = Number.isInteger(rawInterval) && rawInterval > 0 ? rawInterval : null;
    const rawCount = rule.COUNT === undefined ? Infinity : Number(rule.COUNT);
    const count = rawCount === Infinity || (Number.isInteger(rawCount) && rawCount > 0) ? rawCount : 0;
    const until = rule.UNTIL ? parseStamp(rule.UNTIL) : null;
    const bydays = rule.BYDAY ? rule.BYDAY.split(',').map((s) => s.trim()) : null;
    const bysetpos = rule.BYSETPOS ? Number(rule.BYSETPOS) : null;
    const cityWindowInBasis = dtstart.recurrenceBasis ? addDaysStr(lastDay, 1) : lastDay;
    const untilDay = until?.recurrenceBasis?.day || until?.day;
    const hardEnd = untilDay && untilDay < cityWindowInBasis ? untilDay : cityWindowInBasis;
    let n = 0;
    // Walk day-by-day from DTSTART so COUNT is honored from the true start.
    // Span is a few years of city programming — tens of k iterations, trivial.
    const span = calendarDayDiff(basis.day, hardEnd);
    for (let offset = 0; interval && offset <= span && n < count; offset++) {
      const day = addDaysStr(basis.day, offset);
      let match = false;
      if (freq === 'DAILY') {
        match = offset % interval === 0;
      } else if (freq === 'WEEKLY') {
        const weekday = weekdayOf(day);
        const wd = Object.keys(WEEKDAYS).find((key) => WEEKDAYS[key] === weekday);
        const inDays = bydays ? bydays.includes(wd) : weekday === weekdayOf(basis.day);
        // Week parity measured from DTSTART's week (Sunday-aligned).
        const weeks = Math.floor((offset + weekdayOf(basis.day)) / 7);
        match = inDays && weeks % interval === 0;
      } else if (freq === 'MONTHLY') {
        const months = monthDistance(basis.day, day);
        if (months % interval === 0) {
          if (bydays && bysetpos != null) match = bydays.some((bd) => matchesMonthlyByDay(day, bd, bysetpos));
          else match = day.slice(8, 10) === basis.day.slice(8, 10);
        }
      }
      if (match) {
        const occurrence = occurrenceOnDay(dtstart, day);
        if (!occurrence) continue;
        if (until) {
          const afterUntil = Number.isFinite(occurrence.instantMs) && Number.isFinite(until.instantMs)
            ? occurrence.instantMs > until.instantMs
            : compareCivil(occurrence, until) > 0;
          if (afterUntil) continue;
        }
        n++;
        addIfInWindow(occurrence);
      }
    }
  }
  // Explicit extra dates (RDATE usually just repeats DTSTART, dedupe below).
  for (const d of rdates) addIfInWindow(d);

  const seen = new Set();
  return hits
    .sort(compareCivil)
    .filter((occurrence) => {
      const key = civilStamp(occurrence);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

function toStartString(value, allDay) {
  return allDay ? value.day : civilStamp(value);
}

function buildEvent(rec, startValue, endValue) {
  const allDay = rec.allDay === true || rec.allDay === 'true';
  const vinfo = CALENDAR_VENUES[rec.primary_calendar_name] || null;
  const location = cleanText(rec.location, 200) || null;
  const description = decodeDesc(rec.desc);
  const title = cleanText(rec.title, 200);
  if (!title) return null;
  return {
    title,
    start: toStartString(startValue, allDay),
    end: endValue && !allDay ? toStartString(endValue, false) : null,
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

export function mapStPeteRecords(records, { nowMs } = {}) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  if (!Array.isArray(records)) return [];
  const { today, lastDay } = sourceWindow(tampaTimeZone, nowMs, WINDOW_DAYS);
  const events = [];
  const seen = new Set();
  for (const rec of records) {
    if (!rec || !rec.title) continue;
    if (EXCLUDED_CALENDARS.has(rec.primary_calendar_name)) continue;
    const displays = Array.isArray(rec.calendar_displays) ? rec.calendar_displays : [];
    if (!displays.some((d) => ACTIVE_DISPLAYS.has(String(d)))) continue;

    let occurrences = [];
    let duration = null;
    const baseStart = parseCivil(rec.start);
    const baseEnd = parseCivil(rec.end);
    if (baseStart && baseEnd) duration = civilDurationSeconds(baseStart, baseEnd);
    if (rec.rrule) {
      occurrences = expandRRule(parseRRuleBlock(rec.rrule), today, lastDay);
    } else if (baseStart && baseStart.day >= today && baseStart.day <= lastDay) {
      occurrences = [baseStart];
    }
    for (const occ of occurrences) {
      const allDay = rec.allDay === true || rec.allDay === 'true';
      if (!allDay && !validWallTime(occ, 'earlier')) continue;
      const end = rec.rrule && duration ? addCivilSeconds(occ, duration) : (!rec.rrule ? baseEnd : null);
      if (end && !allDay && !validWallTime(end, 'later')) continue;
      const ev = buildEvent(rec, occ, end);
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

async function writeCache(events, { nowMs, windowDay }) {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ fetchedAt: new Date(nowMs).toISOString(), windowDay, events }));
  } catch (err) {
    console.warn(`[stpete] cache write failed: ${err.message}`);
  }
}

export function isStPeteCacheFresh(cache, { nowMs } = {}) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const { today } = sourceWindow(tampaTimeZone, nowMs, 0);
  if (!cache || !Array.isArray(cache.events) || cache.windowDay !== today) return false;
  const fetchedAt = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;
  const ageMs = nowMs - fetchedAt;
  return ageMs >= 0 && ageMs < CACHE_TTL_MS;
}

export async function fetchEvents(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const requireLive = options.requireLive === true;
  const { today } = sourceWindow(tampaTimeZone, nowMs, WINDOW_DAYS);
  const readCacheImpl = options.readCacheImpl ?? readCache;
  const writeCacheImpl = options.writeCacheImpl ?? writeCache;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const cache = await readCacheImpl();
  if (!requireLive && !options.force && isStPeteCacheFresh(cache, { nowMs })) {
    return cache.events;
  }

  try {
    const res = await fetchWithTimeout(FEED, { headers: { 'user-agent': UA } }, 60000, fetchImpl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const records = await res.json();
    if (!Array.isArray(records)) throw new Error('unexpected payload shape');
    const events = mapStPeteRecords(records, { nowMs });
    await writeCacheImpl(events, { nowMs, windowDay: today });
    return events;
  } catch (err) {
    if (requireLive) throw err;
    console.warn(`[stpete] feed failed: ${err.message}${cache ? ' — returning stale cache' : ''}`);
    const staleEvents = Array.isArray(cache?.events) ? cache.events : [];
    return staleEvents;
  }
}

// CLI runner: node finder/sources/tampa-bay/stpete.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents().then((evs) => {
    console.log(`City of St. Petersburg: ${evs.length} events`);
    for (const e of evs.sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
      console.log(' -', e.start, '|', e.title.slice(0, 55), '|', e.venue, '|', e.category || '-', '|', e.isFree ? 'FREE' : '');
    }
  });
}
