// UC Berkeley events (LiveWhale Calendar) — lectures, exhibits, films,
// performances open to the public (STAGE_D_SF_EVENTS.md row 5; the
// Trumba-UT analog, and the LiveWhale pattern is reusable for other schools).
//
// ENDPOINT CHOICE (live-verified 2026-07-05): the scouted JSON API
// (events.berkeley.edu/live/json/events) pages 100/pp BUT its item payload
// is THIN — no venue, no description, no image, and crucially no AUDIENCE
// field (meta.supported_fields lists them; no documented query param
// actually returns them — every fields[]/response_fields[] syntax probed
// came back empty). The RSS twin (/live/rss/events) carries everything in
// ONE request: georss:featurename (venue), livewhale:categories,
// livewhale:categories_audience (the campus-internal filter the scout
// called for), livewhale:all_day, livewhale:ends, livewhale:image_full,
// description. 1,000 items ≈ 2.6MB, July→December. One polite fetch/run.
//
// Cross-calendar duplication is real (the same event syndicates to dept
// calendars under different livewhale:ids — 246 title+day dupe keys in
// today's feed): deduped here by normalized title + city-day.
import { decodeEntities, stripHtml, truncate, fetchWithTimeout, isoInTz, sourceStartDay, sourceWindow } from '../_shared.mjs';
// D2 seam: the campus clock is the city config's zone.
import { tz as CITY_TZ } from '../../cities/sf-east-bay.mjs';

export const name = 'UC Berkeley';

const FEED_URL = 'https://events.berkeley.edu/live/rss/events';
const WINDOW_DAYS = 45;
const UA = 'wuzup-events-finder/0.1';

// Campus-internal filter (scout requirement): when an item DECLARES its
// audience and 'Public' is not among the values, it's campus-only
// (Students/Staff/Faculty rows — 88 in today's feed). Items with NO
// audience tag stay: the untagged mass is the public-facing exhibits/films
// programming (703 of 1,000 today).
const AUDIENCE_TAG = 'livewhale:categories_audience';

// Online/virtual rows aren't attendable local events (45 in today's window).
const ONLINE_RE = /\bzoom\b|\bonline\b|\bvirtual\b|\bwebinar\b/i;

// LiveWhale category → app category (live vocabulary 2026-07-05: Exhibits
// 423 · Other 138 · Films 136 · Academic 116 · Lectures 89 · Performing
// Arts 53 · 'Exclude from Main Calendar' 2 · NULL 1). 'Other' carries no
// sense — unmapped, the pipeline text classifier decides.
const CATEGORY_MAP = [
  [/exhibit/i, 'art'],
  [/film/i, 'art'],
  [/performing/i, 'theatre'],
  [/lecture|academic/i, 'community'],
];

function mapCategory(cats) {
  if (!cats) return undefined;
  for (const [re, val] of CATEGORY_MAP) if (re.test(cats)) return val;
  return undefined;
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

// <description> holds CDATA-wrapped HTML (an 80px <picture> thumb + the
// real paragraphs) — unwrap, then stripHtml drops the markup.
function descriptionText(item) {
  let d = tagText(item, 'description');
  if (!d) return null;
  d = d.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  const text = stripHtml(d);
  return text ? truncate(text) : null;
}

// Merge-key title: lowercase, punctuation folded (the cross-calendar copies
// sometimes differ only in trailing whitespace/entity spelling).
function titleKey(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseExplicitInstant(value) {
  const stamp = String(value || '').trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(stamp)) return null;
  const epochMs = Date.parse(stamp);
  return Number.isFinite(epochMs) ? epochMs : null;
}

export async function fetchEvents(options = {}) {
  const config = options || {};
  const nowMs = config.nowMs ?? Date.now();
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const { today, lastDay } = sourceWindow(CITY_TZ, nowMs, WINDOW_DAYS);
  const res = await fetchWithTimeout(
    FEED_URL,
    { headers: { 'user-agent': UA } },
    30000,
    fetchImpl,
  );
  if (!res.ok) throw new Error(`UC Berkeley: HTTP ${res.status}`);
  const xml = await res.text();

  const items = xml.split(/<item>/).slice(1);
  if (!items.length) {
    console.warn('UC Berkeley: no <item> entries found in RSS feed');
    return [];
  }

  const seen = new Set();
  const events = [];
  for (const item of items) {
    const title = decodeEntities((tagText(item, 'title') || '').trim());
    if (!title) continue;

    // audience declared without 'Public' = campus-internal
    const audience = tagText(item, AUDIENCE_TAG);
    if (audience && !/\bPublic\b/.test(audience)) continue;

    const cats = tagText(item, 'livewhale:categories') || '';
    if (/Exclude from Main Calendar/i.test(cats)) continue;
    if (/<livewhale:is_canceled>1</.test(item)) continue;
    // editors cancel by title prefix too (live find: "CANCELED: Complete
    // Streets…" carried no is_canceled flag)
    if (/^\s*(?:canceled|cancelled|postponed)\b/i.test(title)) continue;

    const venueRaw = tagText(item, 'georss:featurename');
    const venue = venueRaw ? stripHtml(decodeEntities(venueRaw)) : null;
    if (ONLINE_RE.test(venue || '') || ONLINE_RE.test(title)) continue;
    if (/<livewhale:is_online>1</.test(item)) continue;

    // pubDate is the start INSTANT in UTC ('Mon, 06 Jul 2026 22:00:00 +0000'
    // = 3 PM PT); all-day items encode midnight-PT. City wall clock below.
    const pubDate = tagText(item, 'pubDate');
    const startMs = parseExplicitInstant(pubDate);
    if (startMs == null) continue;
    const startInstant = new Date(startMs);
    const day = sourceStartDay(CITY_TZ, startInstant.toISOString());
    if (!day || day < today || day > lastDay) continue;

    const allDay = /<livewhale:all_day>1</.test(item);
    const start = allDay ? day : isoInTz(CITY_TZ, startInstant);

    // ends: only trusted on TIMED items (an all-day "ends" is exclusive-
    // midnight bookkeeping, not an event end — date-only stays date-only).
    let end = null;
    if (!allDay) {
      const endsMs = parseExplicitInstant(tagText(item, 'livewhale:ends'));
      if (endsMs != null && endsMs > startMs) end = isoInTz(CITY_TZ, new Date(endsMs));
    }

    // cross-calendar dedupe (same real event, different livewhale:id)
    const key = titleKey(title) + '|' + day;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      title,
      start,
      end,
      venue,
      address: null, // campus locations publish no street address — never fabricate one
      price: null,   // the RSS twin carries no cost field — unknown, not "free"
      isFree: null,
      lat: null,
      lng: null,
      url: tagText(item, 'link') || null,
      image: tagText(item, 'livewhale:image_full') || null,
      description: descriptionText(item),
      category: mapCategory(cats),
      source: name,
    });
  }

  if (events.length === 0) {
    console.warn('UC Berkeley: 0 events after filtering — feed shape may have changed (expect dozens)');
  }
  return events;
}

// CLI runner: node finder/sources/sf-east-bay/ucberkeley.mjs
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents()
    .then((events) => {
      console.log(`count: ${events.length}`);
      console.log(`timed: ${events.filter((e) => /T/.test(e.start)).length}, date-only: ${events.filter((e) => !/T/.test(e.start)).length}`);
      console.log(`categorized: ${events.filter((e) => e.category).length}, with venue: ${events.filter((e) => e.venue).length}, with image: ${events.filter((e) => e.image).length}`);
      for (const e of events.slice(0, 3)) console.log(JSON.stringify(e));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
