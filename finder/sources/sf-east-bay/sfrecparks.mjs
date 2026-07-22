// SF Recreation & Parks calendar RSS (CivicPlus), parsed with string ops
// only — FREE city/rec programming, the tampa.gov-RSS class
// (STAGE_D_SF_EVENTS.md row 6).
//
// Live-verified 2026-07-05: RSSFeed.aspx?ModID=58&CID=All-calendar.xml →
// 200 text/xml, 40 items over a rolling ~2-week window. Each item carries
// the event facts in namespaced tags (calendarEvent:EventDates /
// EventTimes / Location) AND a <description> whose escaped HTML holds the
// same fields with <br> separators — the description is the better parse
// target for location (the Location tag squashes street+city with no
// separator: "Post and StocktonSan Francisco, CA 94108").
//
// SCHEMA-BAR CALL (the scout left it open): RSS-only fields DO clear the
// bar — title, real date+times, venue line, city+zip, description, image
// enclosure. The 228 Calendar.aspx?EID= detail pages are NOT fetched
// (politeness; nothing needed lives only there).
import { pathToFileURL } from 'node:url';
import {
  addDaysStr,
  decodeEntities,
  fetchWithTimeout,
  sourceWallTime,
  sourceWindow,
  stripHtml,
  truncate,
} from '../_shared.mjs';
// D2 seam: Pacific from the city config.
import { tz as CITY_TZ } from '../../cities/sf-east-bay.mjs';

export const name = 'SF Rec & Parks';

const FEED_URL = 'https://sfrecpark.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml';
const WINDOW_DAYS = 45;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Government-meeting / admin noise (live in today's feed: "PROSAC",
// "Joint Zoo Committee", "Recreation and Park Commission Meeting").
const NOISE = /\bboard\b|commission|committee|council|hearing|advisory|authority|task force|\bprosac\b/i;

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

// 'July 6, 2026' → '2026-07-06' (null on anything else — never guess).
function parseUsDate(s) {
  const m = String(s || '').match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  const day = `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  try {
    return addDaysStr(day, 0);
  } catch {
    return null;
  }
}

// '04:00 PM' → '16:00:00' (null when it isn't a clock time).
function to24h(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const rawHour = Number(m[1]);
  const minute = Number(m[2]);
  if (rawHour < 1 || rawHour > 12 || minute > 59) return null;
  let h = rawHour % 12;
  if (/pm/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}:00`;
}

export async function fetchEvents(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const requireLive = options.requireLive === true;
  const { today: todayDay, lastDay } = sourceWindow(CITY_TZ, nowMs, WINDOW_DAYS);
  const res = await fetchWithTimeout(FEED_URL, { headers: { 'user-agent': UA } }, undefined, fetchImpl);
  if (!res.ok) throw new Error(`SF Rec & Parks: HTTP ${res.status}`);
  const xml = await res.text();

  const items = xml.split(/<item>/).slice(1);
  if (!items.length) {
    if (requireLive) throw new Error('SF Rec & Parks: live RSS contained no <item> entries');
    console.warn('SF Rec & Parks: no <item> entries found in RSS feed');
    return [];
  }

  const events = [];
  for (const item of items) {
    const title = decodeEntities((tagText(item, 'title') || '').trim());
    if (!title || NOISE.test(title)) continue;

    // Event day from the calendarEvent tag ('July 6, 2026'), NOT pubDate
    // (pubDate is the row's CMS creation date, months off the event).
    const day = parseUsDate(tagText(item, 'calendarEvent:EventDates'));
    if (!day || day < todayDay || day > lastDay) continue;

    // '10:00 AM - 11:30 AM' → timed start/end with the city offset;
    // no parseable time → date-only (never invent one).
    const timesRaw = tagText(item, 'calendarEvent:EventTimes') || '';
    const [startRaw, endRaw] = timesRaw.split(/\s*-\s*/);
    const startT = to24h(startRaw);
    const endT = to24h(endRaw);
    const start = startT ? sourceWallTime(CITY_TZ, day, startT) : day;
    if (!start) continue;
    const end = startT && endT && endT !== startT
      ? sourceWallTime(CITY_TZ, day, endT, { disambiguation: 'later' })
      : null;

    // <description> holds XML-escaped HTML; decode once to get real markup.
    // Shape: 'Event date:… <br><strong>Event Time: </strong>…<br><strong>
    // Location:</strong> <br>LINE<br>LINE<br><strong>Description:</strong><br>…'
    const descHtml = decodeEntities(tagText(item, 'description') || '');
    let venue = null;
    let address = null;
    const locM = descHtml.match(/Location:\s*<\/strong>\s*(?:<br\s*\/?>)?([\s\S]*?)(?:<strong>\s*Description:|$)/i);
    if (locM) {
      const lines = locM[1]
        .split(/<br\s*\/?>/i)
        .map((l) => stripHtml(l))
        .filter(Boolean);
      if (lines.length) {
        venue = lines[0];
        address = lines.join(', ');
      }
    }
    let description = null;
    const dM = descHtml.match(/Description:\s*<\/strong>\s*(?:<br\s*\/?>)?([\s\S]*)$/i);
    if (dM) description = truncate(stripHtml(dM[1])) || null;

    // Price honesty: most Rec & Parks programming is free but the feed
    // never says so structurally — claim free only on the word, price only
    // on a dollar amount, otherwise unknown.
    let price = null;
    let isFree = null;
    const priceM = (description || '').match(/\$\s?(\d+(?:\.\d{1,2})?)/);
    if (priceM) {
      price = Number(priceM[1]);
      isFree = price === 0;
    } else if (/\bfree\b/i.test(description || '')) {
      price = 0;
      isFree = true;
    }

    const encM = item.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image\//);

    events.push({
      title,
      start,
      end,
      venue,
      address,
      price,
      isFree,
      lat: null,
      lng: null,
      url: tagText(item, 'link') || null,
      image: encM ? encM[1] : null,
      description,
      source: name,
    });
  }
  if (events.length === 0) {
    console.warn('SF Rec & Parks: 0 events after filtering — feed shape may have changed (40 items live 2026-07-05)');
  }
  return events;
}

// CLI runner: node finder/sources/sf-east-bay/sfrecparks.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents()
    .then((events) => {
      console.log(`count: ${events.length}`);
      console.log(`timed: ${events.filter((e) => /T/.test(e.start)).length}, with venue: ${events.filter((e) => e.venue).length}, free: ${events.filter((e) => e.isFree === true).length}`);
      for (const e of events.slice(0, 3)) console.log(JSON.stringify(e));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
