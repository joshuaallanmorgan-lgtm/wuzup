// WMNF 88.5 FM community/grassroots music events via the Event Espresso WP REST API.
// List endpoint supports relation includes (Datetime, Venue) and `where` filters,
// so one request usually suffices; per-event datetime fetches are a capped fallback.

import { decodeEntities, stripHtml, truncate, fetchWithTimeout } from '../_shared.mjs';

export const name = 'WMNF 88.5';

const API_BASE = 'https://www.wmnf.org/wp-json/ee/v4.8.36';
const USER_AGENT = 'tampabay-events-finder/0.1';
const WINDOW_DAYS = 45;
const MAX_DETAIL_CALLS = 20;

async function fetchJson(url) {
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
}

export async function fetchEvents() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = new Date(todayStart.getTime() + WINDOW_DAYS * 86400000);

  // Filter server-side to events with a datetime starting after today,
  // soonest first; include Datetime + Venue relations inline.
  const listUrl =
    `${API_BASE}/events?limit=50` +
    `&include=${encodeURIComponent('Datetime.*,Venue.*')}` +
    `&order_by=${encodeURIComponent('Datetime.DTT_EVT_start')}&order=ASC` +
    `&where[Datetime.DTT_EVT_start][]=${encodeURIComponent('>')}` +
    `&where[Datetime.DTT_EVT_start][]=${encodeURIComponent(localIso(todayStart))}`;

  const data = await fetchJson(listUrl);
  if (!Array.isArray(data)) {
    throw new Error(`WMNF EE API: expected array, got ${typeof data}`);
  }

  let detailCalls = 0;
  const events = [];

  for (const ev of data) {
    try {
      if (!ev || typeof ev !== 'object') continue;
      const title = decodeEntities((ev.EVT_name || '').trim());
      if (!title) continue;
      if (ev.status?.raw && ev.status.raw !== 'publish') continue;

      // Datetimes: prefer the included relation; fall back to a per-event call.
      let datetimes = Array.isArray(ev.datetimes) ? ev.datetimes : null;
      if ((!datetimes || datetimes.length === 0) && ev.EVT_ID && detailCalls < MAX_DETAIL_CALLS) {
        detailCalls++;
        try {
          const dts = await fetchJson(`${API_BASE}/events/${ev.EVT_ID}/datetimes`);
          if (Array.isArray(dts)) datetimes = dts;
        } catch (err) {
          console.warn(`[${name}] datetime fetch failed for EVT ${ev.EVT_ID}: ${err.message}`);
        }
      }
      if (!datetimes || datetimes.length === 0) continue;

      // Earliest upcoming datetime within the window.
      const upcoming = datetimes
        .map((dt) => ({ dt, d: new Date(dt?.DTT_EVT_start) }))
        .filter((x) => !Number.isNaN(x.d.getTime()) && x.d >= todayStart && x.d <= windowEnd)
        .sort((a, b) => a.d - b.d);
      if (upcoming.length === 0) continue;
      const { dt } = upcoming[0];

      // Venue relation (singular `venue` when included).
      const v = ev.venue && typeof ev.venue === 'object' ? ev.venue : null;
      const venue = v ? decodeEntities((v.VNU_name || '').trim()) || null : null;
      let address = null;
      if (v) {
        const parts = [v.VNU_address, v.VNU_address2, v.VNU_city, v.VNU_zip ? `FL ${v.VNU_zip}` : '']
          .map((p) => (typeof p === 'string' ? p.trim() : ''))
          .filter(Boolean);
        address = parts.length ? parts.join(', ') : null;
      }

      const descHtml =
        (ev.EVT_desc && typeof ev.EVT_desc === 'object' ? ev.EVT_desc.rendered : ev.EVT_desc) ||
        ev.EVT_short_desc || '';

      events.push({
        title,
        start: dt.DTT_EVT_start,
        end: dt.DTT_EVT_end || null,
        venue,
        address,
        price: null,
        isFree: null,
        lat: null,
        lng: null,
        url: ev.link || ev.EVT_external_URL || null,
        // No image: the <img> URLs inside the API's stored description HTML
        // point at www.wmnf.org/wp-content/uploads/, which 404s since the
        // site moved uploads to cdn.wmnf.org (probed 2026-06-10: 4/4 dead on
        // origin, 3/4 still dead after a CDN-host rewrite). Fallback art
        // beats a broken <img>.
        image: null,
        description: truncate(stripHtml(typeof descHtml === 'string' ? descHtml : '')) || null,
        source: name,
      });
    } catch (err) {
      console.warn(`[${name}] skipping malformed event: ${err.message}`);
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
      for (const ev of events.slice(0, 3)) console.log(JSON.stringify(ev));
    })
    .catch((err) => {
      console.error(`[${name}] FAILED:`, err.message);
      process.exitCode = 1;
    });
}
