// Shared helpers for finder source modules.
// "_"-prefixed files are skipped by the source loader, so this is never
// treated as an event source itself.
//
// Contract notes for module authors:
// - decodeEntities/stripHtml/truncate/cleanText are pure string helpers.
// - fetchWithTimeout(url, options?, timeoutMs?, fetchImpl?) is plain fetch + AbortController;
//   pass headers (user-agent etc.) through options like a normal fetch call.

import {
  addCalendarDays,
  cityMidnightMs,
  dayIdAt,
  eventTime,
} from '../../shared/city-time.mjs';

export const DEFAULT_TIMEOUT_MS = 20000;

// Superset of the entity tables that had drifted across the 8 modules,
// plus the rest of the commonly seen named HTML entities.
export const NAMED_ENTITIES = {
  // core
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  // quotes / dashes / dots
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  sbquo: '‚', bdquo: '„', prime: '′', Prime: '″',
  ndash: '–', mdash: '—', hellip: '…', shy: '',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '',
  // symbols
  copy: '©', reg: '®', trade: '™', deg: '°',
  bull: '•', middot: '·', sect: '§', para: '¶',
  dagger: '†', Dagger: '‡', permil: '‰',
  laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
  euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤',
  times: '×', divide: '÷', plusmn: '±', minus: '−',
  frac12: '½', frac14: '¼', frac34: '¾',
  sup1: '¹', sup2: '²', sup3: '³',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  le: '≤', ge: '≥', ne: '≠', infin: '∞',
  // accented letters (lowercase)
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã',
  auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô',
  otilde: 'õ', ouml: 'ö', oslash: 'ø', oelig: 'œ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß',
  // accented letters (uppercase)
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã',
  Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô',
  Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', OElig: 'Œ',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
};

// Decode numeric (&#39; / &#x2019;) and named (&amp;) HTML entities.
// Named lookup is exact-case first (Eacute vs eacute), lowercase fallback.
export function decodeEntities(str) {
  if (!str) return str;
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+\d*);/g, (m, n) => NAMED_ENTITIES[n] ?? NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

// Strip tags, decode entities, collapse whitespace.
export function stripHtml(str) {
  if (!str) return str;
  return decodeEntities(String(str).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function truncate(str, max = 250) {
  if (!str) return str;
  return str.length <= max ? str : str.slice(0, max - 1).trimEnd() + '…';
}

// stripHtml + truncate, normalized to null when nothing remains.
export function cleanText(html, maxLen = 250) {
  if (!html) return null;
  const text = stripHtml(html);
  if (!text) return null;
  return truncate(text, maxLen);
}

export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { redirect: 'follow', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- city-timezone helpers (the D2 seam, module side) --------------------
// Source modules must derive "today" / wall-clock stamps in THEIR CITY's
// IANA zone, never the machine's ("every SF event stamped 7 hours early" is
// the D2 bug class). Offsets come from Intl at runtime, so DST is handled.
// Pass the `tz` exported by the module's own city config
// (finder/cities/<cityId>.mjs) — the config stays the single source of truth.

function instantMs(instant) {
  const epochMs = instant instanceof Date ? instant.getTime() : instant;
  if (!Number.isFinite(epochMs)) throw new TypeError('instant must be a valid Date or finite epoch');
  return epochMs;
}

// 'YYYY-MM-DD' of an instant on the tz's wall clock.
export function dayInTz(tz, instant = new Date()) {
  return dayIdAt(instantMs(instant), tz);
}

export function sourceWindow(tz, nowMs, daysAhead) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  if (!Number.isInteger(daysAhead) || daysAhead < 0) {
    throw new TypeError('daysAhead must be a non-negative integer');
  }
  const today = dayInTz(tz, nowMs);
  return {
    today,
    lastDay: addCalendarDays(today, daysAhead),
  };
}

export function sourceStartDay(tz, value) {
  const canonical = eventTime({ start: value }, { timeZone: tz });
  return canonical.ok ? canonical.startDay : null;
}

// UTC offset string ('-07:00' / '-08:00' / ...) in effect in tz at an instant.
export function offsetInTz(tz, instant = new Date()) {
  const epochMs = instantMs(instant);
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(epochMs))
    .find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part?.value || '');
  return m ? m[1] : '+00:00';
}

// Offset in effect in tz on a 'YYYY-MM-DD' calendar day (probed at noon UTC,
// away from the 2 a.m. DST switch hours — mirrors finder.mjs cityOffsetFor).
export function offsetForDay(tz, dayStr) {
  addCalendarDays(dayStr, 0);
  return offsetInTz(tz, new Date(`${dayStr}T12:00:00Z`));
}

// Date instant of midnight (tz wall clock) on a 'YYYY-MM-DD' day. The
// noon-probe offset is re-checked at the constructed instant so a midnight
// across a DST switch resolves to the offset actually in effect.
export function midnightInTz(tz, dayStr) {
  return new Date(cityMidnightMs(dayStr, tz));
}

// Local ISO stamp ('YYYY-MM-DDTHH:MM:SS±HH:MM') of a UTC instant on the tz's
// wall clock — for feeds that publish UTC instants (LiveWhale pubDate).
export function isoInTz(tz, instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offsetInTz(tz, instant)}`;
}

// 'YYYY-MM-DD' + n days, pure UTC math (no local-TZ surprises).
export function addDaysStr(dayStr, days) {
  return addCalendarDays(dayStr, days);
}
