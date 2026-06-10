// donttellcomedy.mjs — Don't Tell Comedy secret-location shows for Tampa Bay.
//
// Why this source exists: DTC is the canonical "hidden event" — pop-up standup
// in a secret venue, revealed only to ticket-holders. It appears on NO
// aggregator we ingest (verified 2026-06-10: zero hits across every cache),
// because they sell exclusively through their own site. Their city pages are
// fully server-rendered Bootstrap HTML, so a plain fetch + regex parse works —
// no headless browser needed.
//
// Page anatomy (verified live): each show is a `show-card-clickable` block:
//   <a href="/shows/st-petersburg-b97f9c9f/" class="stretched-link ...">
//   <div>Saturday, June 13</div>                 ← weekday, month day (no year)
//   <div class="font-weight-bold mb-2"> St. Petersburg - Grand Central District </div>
//   time appears as e.g. "8:00 PM" within the card; price badge like "$30" when shown.
import { fetchWithTimeout, cleanText } from './_shared.mjs';

export const name = "Don't Tell Comedy";

const CITY_PAGES = [
  'https://www.donttellcomedy.com/cities/st-petersburg/',
  'https://www.donttellcomedy.com/cities/tampa/',
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// DTC venues are secret by design — a district-center pin is the honest
// location granularity. Nominatim doesn't know these neighborhood names
// (verified), so known districts carry their approximate centers.
const NEIGHBORHOOD_COORDS = {
  'Grand Central District|St. Petersburg': { lat: 27.7712, lng: -82.6638 },
  'Downtown|St. Petersburg': { lat: 27.7709, lng: -82.6347 },
  'Seminole Heights|Tampa': { lat: 27.9966, lng: -82.4598 },
  'Ybor City|Tampa': { lat: 27.96, lng: -82.436 },
};

// "June 13" → next occurrence on/after today (the page lists upcoming shows only).
function inferDate(monthName, day) {
  const now = new Date();
  const mi = MONTHS.indexOf(monthName.toLowerCase());
  if (mi < 0) return null;
  let d = new Date(now.getFullYear(), mi, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d < today) d = new Date(now.getFullYear() + 1, mi, day);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function to24h(h, m, ap) {
  let hh = Number(h) % 12;
  if (/pm/i.test(ap)) hh += 12;
  return `${String(hh).padStart(2, '0')}:${m}:00`;
}

function parseCards(html, pageUrl) {
  const out = [];
  const chunks = html.split(/show-card-clickable/).slice(1);
  for (const chunk of chunks) {
    const head = chunk.slice(0, 4000); // each card's own markup; avoids bleeding into the next section
    const href = head.match(/href="(\/shows\/[a-z0-9-]+)\/?"/i)?.[1];
    const date = head.match(/<div>\s*(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s*([A-Za-z]+)\s+(\d{1,2})\s*<\/div>/);
    const loc = head.match(/font-weight-bold mb-2[^>]*>\s*([^<]+?)\s*</);
    if (!href || !date) continue;
    const start = inferDate(date[1], Number(date[2]));
    if (!start) continue;
    const time = head.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    const img = head.match(/src="\s*(https:\/\/[^"]*cloudinary[^"]+\.(?:webp|jpg|jpeg|png))/i)?.[1] || null;
    const price = head.match(/\$(\d{1,3})(?:\.\d{2})?\b/)?.[1];
    // "St. Petersburg - Grand Central District" → city + neighborhood
    const locText = cleanText(loc?.[1] || '') || '';
    const [city, hood] = locText.includes(' - ')
      ? locText.split(' - ').map((s) => s.trim())
      : [locText.trim() || 'Tampa Bay', null];
    const where = hood || city;
    const geo = NEIGHBORHOOD_COORDS[`${hood}|${city}`] || null;
    out.push({
      title: `Don't Tell Comedy — ${where}`,
      start: time ? `${start}T${to24h(time[1], time[2], time[3])}` : start,
      end: null,
      venue: `${where} (secret location)`,
      address: hood ? `${hood}, ${city}, FL` : `${city}, FL`,
      price: price ? Number(price) : null,
      isFree: false,
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      url: 'https://www.donttellcomedy.com' + href + '/',
      image: img,
      description:
        'Secret pop-up standup in ' + where + ' — a curated lineup of local and national comics, exact location revealed only to ticket-holders. BYOB.',
      category: 'comedy',
      source: name,
      _page: pageUrl,
    });
  }
  return out;
}

export async function fetchEvents() {
  const seen = new Set();
  const events = [];
  for (const url of CITY_PAGES) {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'user-agent': UA } }, 20000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      for (const e of parseCards(html, url)) {
        if (seen.has(e.url)) continue; // city pages cross-promote each other's shows
        seen.add(e.url);
        delete e._page;
        events.push(e);
      }
    } catch (err) {
      console.warn(`[donttellcomedy] ${url} failed: ${err.message}`);
    }
  }
  return events;
}

// CLI runner: node finder/sources/donttellcomedy.mjs
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents().then((evs) => {
    console.log(`Don't Tell Comedy: ${evs.length} shows`);
    for (const e of evs.slice(0, 6)) console.log(' -', e.start, '|', e.title, '|', e.price ? '$' + e.price : '?');
  });
}
