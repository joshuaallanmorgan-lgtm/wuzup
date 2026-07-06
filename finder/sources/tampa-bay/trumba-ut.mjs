// Univ. of Tampa campus events via Trumba public JSON feed.
// Source: https://www.trumba.com/calendars/ut-events.json
import { decodeEntities, stripHtml, truncate, fetchWithTimeout } from '../_shared.mjs';

export const name = 'Univ. of Tampa';

const FEED_URL = 'https://www.trumba.com/calendars/ut-events.json';
const USER_AGENT = 'tampabay-events-finder/0.1';
const WINDOW_DAYS = 45;

// Pull a street address out of the Google Maps link Trumba embeds in `location`.
function extractAddress(locationHtml) {
  if (!locationHtml) return null;
  const m = locationHtml.match(/maps\.google\.com\/\?q=([^"&]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim() || null;
  } catch {
    return null;
  }
}

function parsePrice(customFields) {
  if (!Array.isArray(customFields)) return { price: null, isFree: null };
  const f = customFields.find((c) => /^price$/i.test(c?.label || ''));
  if (!f || !f.value) return { price: null, isFree: null };
  const text = stripHtml(String(f.value));
  if (/free/i.test(text)) return { price: 0, isFree: true };
  const m = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const p = Number(m[1]);
    return { price: p, isFree: p === 0 };
  }
  return { price: null, isFree: null };
}

// 'YYYY-MM-DD' minus n days, pure string/UTC math (no local-TZ surprises).
function minusDays(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

export async function fetchEvents() {
  const res = await fetchWithTimeout(FEED_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Trumba UT feed HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Trumba UT feed: expected a JSON array');

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = new Date(todayStart.getTime() + WINDOW_DAYS * 86400000);
  const events = [];

  for (const ev of data) {
    try {
      if (!ev || typeof ev !== 'object') continue;
      const title = decodeEntities((ev.title || '').trim());
      if (!title) continue;
      if (ev.canceled) continue;

      // Invite-only campus events are not attendable city events.
      if (/invite[\s-]*only/i.test(title) || /invite[\s-]*only/i.test(String(ev.description || ''))) continue;
      // Registrar/admin calendar noise ("grades due", "final registration and
      // payment") — university administrivia, not a thing anyone attends.
      if (/grades due|registration (and|&) payment|drop\/add|withdrawal deadline|tuition/i.test(title)) continue;

      const start = new Date(ev.startDateTime);
      if (Number.isNaN(start.getTime())) continue;
      const end = ev.endDateTime ? new Date(ev.endDateTime) : null;

      // Skip long-running "Ongoing" exhibitions: allDay spanning > 30 days.
      if (ev.allDay && end && !Number.isNaN(end.getTime())) {
        const spanDays = (end.getTime() - start.getTime()) / 86400000;
        if (spanDays > 30) continue;
      }

      if (start < todayStart || start > windowEnd) continue;

      let venue = stripHtml(ev.location) || null;
      // Trumba shows this placeholder when the location is restricted to signed-in users.
      if (venue && /sign in to download the location/i.test(venue)) venue = null;

      // Internal university Zoom/virtual sessions are not city events.
      const VIRTUAL_RE = /zoom|virtual|online|webinar|microsoft teams|drop-in hours|training/i;
      if (VIRTUAL_RE.test(title) || VIRTUAL_RE.test(venue || '') || VIRTUAL_RE.test(String(ev.location || ''))) continue;
      const address = extractAddress(ev.location);
      const { price, isFree } = parsePrice(ev.customFields);

      let image = null;
      if (ev.eventImage) {
        if (typeof ev.eventImage === 'string') image = ev.eventImage;
        else if (typeof ev.eventImage === 'object') {
          image = ev.eventImage.url || ev.eventImage.src || null;
        }
      }

      // Trumba allDay items carry raw T00:00:00 timestamps and a next-day
      // midnight end (e.g. start 07-02T00:00, end 07-03T00:00 = "July 2").
      // Emit date-only strings so the app shows a date, not "12:00 AM".
      let startOut = ev.startDateTime;
      let endOut = ev.endDateTime || null;
      if (ev.allDay) {
        const startDay = String(ev.startDateTime).slice(0, 10);
        startOut = startDay;
        endOut = null;
        if (ev.endDateTime) {
          let endDay = String(ev.endDateTime).slice(0, 10);
          // Midnight end = exclusive bound; the event's last day is the day before.
          if (/T00:00(:00)?/.test(String(ev.endDateTime))) endDay = minusDays(endDay, 1);
          if (endDay > startDay) endOut = endDay;
        }
      }

      events.push({
        title,
        start: startOut,
        end: endOut,
        venue,
        address,
        price,
        isFree,
        lat: null,
        lng: null,
        url: ev.permaLinkUrl || ev.webLink || null,
        image,
        description: truncate(stripHtml(
          typeof ev.description === 'string' ? ev.description : ''
        )) || null,
        source: name,
      });
    } catch (err) {
      console.warn(`[${name}] skipping malformed item: ${err.message}`);
    }
  }

  return events;
}

// Standalone CLI runner
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents()
    .then((events) => {
      console.log(`count: ${events.length}`);
      console.log(`date-only starts: ${events.filter((e) => !String(e.start).includes('T')).length}`);
      console.log(`midnight T00:00 starts remaining: ${events.filter((e) => /T00:00/.test(String(e.start))).length}`);
      for (const ev of events.slice(0, 3)) console.log(JSON.stringify(ev));
    })
    .catch((err) => {
      console.error(`[${name}] FAILED:`, err.message);
      process.exitCode = 1;
    });
}
