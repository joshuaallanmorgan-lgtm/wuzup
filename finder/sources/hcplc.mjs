// Hillsborough County Public Library Cooperative events (libnet calendar API).
import { pathToFileURL } from 'node:url';
import { decodeEntities, stripHtml, truncate, fetchWithTimeout } from './_shared.mjs';

export const name = 'Hillsborough Libraries';

const API_BASE = 'https://hcplc.libnet.info/eeventcaldata';
const IMAGE_BASE = 'https://hcplc.libnet.info/images/events/hcplc/';
const WINDOW_DAYS = 45;
const USER_AGENT = 'tampabay-events-finder/0.1';

// Static branch -> location table for the Hillsborough library system.
// Extracted 2026-06 from https://www.hcplc.org/locations (each branch's
// Google-Maps "Directions" destination pin + printed street address), then
// bounds-checked to Tampa Bay (lat 27.3–28.6, lng -83.3 – -81.9).
// Library2Go (the bookmobile) has no fixed location and is intentionally absent.
const BRANCHES = {
  '78th street community library': { lat: 27.940401, lng: -82.37159, address: '7625 Palm River Rd., Tampa, FL 33619' },
  'arthenia l. joyner university area community library': { lat: 28.0719347, lng: -82.4327273, address: '13619 N. 22nd St., Tampa, FL 33613' },
  'austin davis public library': { lat: 28.134772, lng: -82.576546, address: '17808 Wayne Rd., Odessa, FL 33556' },
  'bloomingdale regional public library': { lat: 27.894455, lng: -82.252413, address: '1906 Bloomingdale Ave., Valrico, FL 33596' },
  'brandon regional library': { lat: 27.929844, lng: -82.287219, address: '619 Vonderburg Dr., Brandon, FL 33511' },
  'bruton memorial library': { lat: 28.018461, lng: -82.126019, address: '302 W. McLendon St., Plant City, FL 33563' },
  'c. blythe andrews, jr. public library': { lat: 27.981193, lng: -82.430349, address: '2607 E. Dr. MLK, Jr. Blvd., Tampa, FL 33610' },
  'charles j. fendig public library': { lat: 27.930804, lng: -82.508672, address: '3909 W. Neptune St., Tampa, FL 33629' },
  'egypt lake partnership library': { lat: 28.007213, lng: -82.498778, address: '3403 W. Lambright St., Tampa, FL 33614' },
  'florida history & genealogy library': { lat: 27.950733, lng: -82.462724, address: '900 N. Ashley Dr., Tampa, FL 33602' },
  'james j. lunsford law library': { lat: 27.950733, lng: -82.462724, address: '900 N. Ashley Dr., Tampa, FL 33602' },
  'jan kaminis platt regional library': { lat: 27.907396, lng: -82.517458, address: '3910 S. Manhattan Ave., Tampa, FL 33611' },
  'jimmie b. keel regional library': { lat: 28.087, lng: -82.492047, address: '2902 W. Bearss Ave., Tampa, FL 33618' },
  'john f. germany public library': { lat: 27.950733, lng: -82.462724, address: '900 N. Ashley Dr., Tampa, FL 33602' },
  'lutz branch library': { lat: 28.151409, lng: -82.462591, address: '101 Lutz-Lake Fern Rd. W., Lutz, FL 33548' },
  'maureen b. gauzza public library': { lat: 28.062456, lng: -82.623023, address: '11211 Countryway Blvd., Tampa, FL 33626' },
  'new tampa regional library': { lat: 28.14117, lng: -82.328015, address: '10001 Cross Creek Blvd., Tampa, FL 33647' },
  'north tampa branch library': { lat: 28.032396, lng: -82.468373, address: '8916 North Blvd., Tampa, FL 33604' },
  'port tampa city library': { lat: 27.864059, lng: -82.527942, address: '4902 W. Commerce St., Tampa, FL 33616' },
  'riverview public library': { lat: 27.8566139, lng: -82.315869, address: '9951 Balm Riverview Rd., Riverview, FL 33569' },
  'robert w. saunders, sr. public library': { lat: 27.958163, lng: -82.450735, address: '1505 N. Nebraska Ave., Tampa, FL 33602' },
  'ruskin branch library': { lat: 27.71873, lng: -82.433631, address: '26 Dickman Dr. S.E., Ruskin, FL 33570' },
  'seffner-mango branch library': { lat: 28.000958, lng: -82.278469, address: '410 N. Kingsway Rd., Seffner, FL 33584' },
  'seminole heights branch library': { lat: 27.988444, lng: -82.45504, address: '4711 Central Ave., Tampa, FL 33603' },
  'southshore regional library': { lat: 27.737092, lng: -82.36944, address: '15816 Beth Shields Way, Ruskin, FL 33573' },
  'temple terrace public library': { lat: 28.032918, lng: -82.391233, address: '202 Bullard Pkwy., Temple Terrace, FL 33617' },
  'thonotosassa branch library': { lat: 28.05764, lng: -82.294842, address: '10715 Main St., Thonotosassa, FL 33592' },
  "town 'n country regional public library": { lat: 27.998985, lng: -82.565888, address: '7606 Paula Dr., Suite 120, Tampa, FL 33615' },
  'west tampa branch library': { lat: 27.95774, lng: -82.483272, address: '2312 W. Union St., Tampa, FL 33607' },
  'wimauma public library': { lat: 27.7161427, lng: -82.3031849, address: '5714 North Street, Wimauma, FL 33598' },
};

function normalizeBranch(s) {
  return decodeEntities(String(s || ''))
    .toLowerCase()
    .replace(/\s*\/\s*biblioteca.*$/, '') // "Wimauma Public Library / Biblioteca Pública…"
    .replace(/\s+/g, ' ')
    .trim();
}

function branchLocation(...candidates) {
  for (const c of candidates) {
    const hit = BRANCHES[normalizeBranch(c)];
    if (hit) return hit;
  }
  return null;
}

function localYmd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "2026-06-10 00:00:00" -> "2026-06-10T00:00:00" (local library time)
function toIso(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : null;
}

// The API marks all-day programs (gallery exhibits etc.) with
// time_string "All day" and a 00:00–23:59 span; timed events carry real
// clock times. Only genuinely all-day items get date-only strings.
function isAllDay(item) {
  return /^all\s*day$/i.test(String(item.time_string || '').trim());
}

export async function fetchEvents() {
  const today = new Date();
  const req = JSON.stringify({
    private: false,
    date: localYmd(today),
    days: 30,
    locations: '',
    ages: '',
    types: '',
  });
  const url = `${API_BASE}?event_type=0&req=${encodeURIComponent(req)}`;
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Hillsborough Libraries: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Hillsborough Libraries: unexpected response shape (not an array)');

  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS * 86400000);

  const events = [];
  for (const item of data) {
    const title = decodeEntities((item.title || '').trim());
    if (!title) continue;

    let start = toIso(item.event_start);
    if (!start) continue;
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) continue;
    if (startDate < windowStart || startDate > windowEnd) continue;

    // Skip purely-virtual programs when identifiable.
    const place = `${item.location || ''} ${item.library || ''} ${item.venues || ''}`;
    if (/\b(virtual|online|zoom|webinar)\b/i.test(place)) continue;

    let end = toIso(item.event_end);
    if (isAllDay(item)) {
      // Date-only strings for all-day items, so the app shows a date,
      // not a junk "12:00 AM" time.
      const startDay = start.slice(0, 10);
      const endDay = end ? end.slice(0, 10) : null;
      start = startDay;
      end = endDay && endDay > startDay ? endDay : null;
    }

    const loc = branchLocation(item.location, item.library);
    const rawDesc = item.description || item.long_description || '';
    events.push({
      title,
      start,
      end,
      venue: item.location || item.library || null,
      address: loc ? loc.address : null,
      price: 0,
      isFree: true,
      lat: loc ? loc.lat : null,
      lng: loc ? loc.lng : null,
      url: item.url ? item.url.replace(/([^:])\/\//g, '$1/') : null,
      image: item.image ? IMAGE_BASE + encodeURIComponent(item.image) : null,
      description: truncate(stripHtml(rawDesc)) || null,
      source: name,
    });
  }
  return events;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchEvents()
    .then((events) => {
      console.log(`count: ${events.length}`);
      console.log(`with coords: ${events.filter((e) => e.lat != null && e.lng != null).length}`);
      console.log(`date-only starts: ${events.filter((e) => !e.start.includes('T')).length}`);
      console.log(`midnight T00:00 starts remaining: ${events.filter((e) => /T00:00/.test(e.start)).length}`);
      for (const e of events.slice(0, 3)) console.log(JSON.stringify(e));
    })
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
