# SF & East Bay Event Data Sources — verified intel

_Stage D3 scout report, 2026-07-03, applying the DATA_SOURCES.md method to the
SF → Walnut Creek corridor. Every "✅" was live-probed today with 1–3 polite
sample fetches; "⚠️" records exactly what blocked verification. **NO source
modules ship yet** — they land after D1 (multi-tenant artifacts) + D2 (events
de-Tampa: the tz + geocode hardcodes) merge; this report is the deliverable.
Reminder for the builder: every module here must derive days in
`America/Los_Angeles` via the city config — the Tampa modules' `easternToday()`
helpers are exactly the D2 hardcode class._

## Recommended v1 set (ranked by value-per-effort)

| # | Source | Method | Verified | Adds | Est/wk |
|---|--------|--------|----------|------|--------|
| 1 | **AllEvents.in** (san-francisco, +/free, oakland, berkeley, walnut-creek) | JSON-LD, plain fetch — **existing adapter, PAGES swap** | ✅ 72–86 LD events/page | hidden gems, popups, the WC dogfood slice | 200–300 |
| 2 | **DoTheBay** (DoStuff network) | `dothebay.com/events.json` `.json` twin — **do813.mjs ports with a BASE swap** | ✅ 25/page × 4 pages, coords + `is_free` + category on every record | curated local culture — the do813 gem-aggregator class, but ACTIVE (do813 is dormant) | 40–80 |
| 3 | **Visit Oakland** (Simpleview DMO) | token + `rest_v2/plugins_events_events_by_date` — **visittampabay.mjs ports** (new TZ + category-map sense pass) | ✅ token OK; midnight-**PT** date_range returns `docs.count=55`/7-days; same nested `docs.docs`, `catName`, `admission`, `loc.coordinates` shape | DMO-curated festivals/markets, East Bay anchor | 40–60 |
| 4 | **Eventbrite** (`ca--san-francisco`, `ca--oakland`, `ca--berkeley`, `ca--walnut-creek`, + free variants) | JSON-LD listing pages via `sources.json` URL adds — the Tampa pattern verbatim | ⚠️ **429 on every probe today** (burst rate-limit on this IP; the identical Tampa pattern runs in production daily) — VERIFY on the first real run | the Tier-1 volume backbone (packet: ~5–6× Tampa) | 300–500 raw |
| 5 | **UC Berkeley** (LiveWhale Calendar) | `events.berkeley.edu/live/json/events?max=N` — clean public JSON API, paged 100/pp | ✅ `total_results=1064` | lectures, galleries, campus-open-to-public (the Trumba-UT analog; LiveWhale pattern reusable for other schools) | 50–100 after campus-only filtering |
| 6 | **SF Rec & Parks** (CivicPlus) | RSS `sfrecpark.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml` (+ 228 `Calendar.aspx?EID=` detail links) | ✅ 200 text/xml, real RSS, 45KB | FREE city/rec programming — the tampa.gov-RSS class | 20–40 |
| 7 | **Meetup** (`?location=us--ca--san-francisco` / oakland / berkeley / walnut-creek) | `__NEXT_DATA__` JSON — **existing adapter, location adds** | ✅ NEXT_DATA present + 10 LD events on the find page | RECURRING CLUBS (still our weakest area) | 50–100 |

**Corridor coverage check:** SF (1,2,4,7) · Oakland/East Bay (2,3,4,5,7) ·
Walnut Creek dogfood (1,4,7 + the city calendar below). Free events: AllEvents
/free, Eventbrite free variants, SFRP, library systems (v1.1), LiveWhale.

## Effort estimate (after D1/D2 merge)
- Config-only ports: Eventbrite `sources.json` adds, AllEvents PAGES, Meetup
  locations — **~0.5 day** (incl. the Eventbrite 429 verification + backoff check).
- BASE-swap port: DoTheBay from do813.mjs — **~0.5 day**.
- Full port: Visit Oakland from visittampabay.mjs (PT-midnight helper from the
  city config tz + a live category-sense pass like VTB's) — **~1 day**.
- New small adapters: SFRP CivicPlus RSS — **~0.5 day**; UC Berkeley LiveWhale —
  **~0.5–1 day** (field mapping + campus-only noise filter).
- Cross-source QA + category-map sampling + honesty pass — **~1 day**.
- **Total ≈ 4–4.5 builder-days** for a stack that comfortably exceeds Tampa's
  weekly volume (SF Tier-1 confirmed by the AllEvents/DoTheBay/Eventbrite counts).

## Key gotchas (probe-verified)
1. **Visit Oakland:** date_range MUST be midnight **Pacific** (`00:00 in the
   client's timezone` — the API literally errors with that message; same class
   as VTB's midnight-ET rule). Token is per-session, 32 chars, same
   `get_simple_token` flow. Response nests `docs.docs`; `loc.coordinates` is
   GeoJSON order (lng,lat).
2. **DoTheBay:** same Rails `.json` twin as do813 (`?page=N`, single-day
   `events/YYYY/M/D.json`); robots.txt allows /events (disallows /search,
   /latest); category strings differ slightly from do312/do813 — resample the
   CATEGORY_MAP on live data.
3. **Eventbrite 429:** cold bursts from a fresh IP get rate-limited before the
   first byte of HTML. The Tampa production pattern (paged, daily cadence)
   passes — space the SF pages out and inherit the backoff; do NOT add more
   than the Tampa-standard 3 pages/city.
4. **LiveWhale:** `?max=` caps per_page at 100 with `total_pages` paging; the
   1,064 upcoming events include many campus-internal items — filter on
   audience/location fields during the build.
5. **SFRP RSS:** CivicPlus RSS carries titles/dates/links; detail pages
   (`Calendar.aspx?EID=`) have the venue text — decide during the build whether
   RSS-only fields clear the schema bar or a detail fetch is needed (politeness:
   228 links, cache hard).

## Feasible but deferred (v1.1 spike candidates)
- **Library systems — SFPL / Oakland PL / Contra Costa Lib (ALL BiblioCommons):**
  the Tampa-HCPLC-class FREE community firehose, and one adapter would cover
  three systems (`{sfpl,oaklandlibrary,ccclib}.bibliocommons.com/v2/events`).
  BUT: pages are client-rendered (0 JSON-LD events); the embedded 248KB
  `application/json` state block doesn't expose a clean events array; the
  frontend's `gateway.bibliocommons.com/v2/libraries/sfpl/events` API returns
  **403** without the page's session context. **Budget a 1-day spike**; do not
  block v1 on it. Berkeley PL is a separate platform (probe hit a bot-block
  marker — respect it, skip).
- **Walnut Creek city calendar** (walnut-creek.org, CivicPlus): calendar page +
  `/Home/Components/Calendar/Event/<id>` items verified live; my guessed RSS
  ModID 404'd — a 15-minute hunt for the right `RSSFeed.aspx` ModID (or an HTML
  parse) gets the dogfood city's civic feed. Small volume, high Josh-QA value.
- **sf.gov events** (Next.js, NEXT_DATA present) + **oaklandca.gov events**:
  civic notices, parseable embedded state, modest event value — defer.

## Skips — honesty/licensing bar (do not re-litigate without new facts)
- **FunCheapSF** (sf.funcheap.com): robots.txt only disallows /search, BUT the
  site IS an editorial curation product (WordPress, ad-supported) — wholesale
  republishing their picks takes their work, not public data. Their listings
  also largely mirror Eventbrite/venue sources we already ingest. **FAILS the
  honesty bar for scraping; revisit only as a partnership.** (Same reasoning
  class as the image-honesty contract: aggregating an aggregator's curation is
  not honest sourcing.)
- **SF Station**: robots allows listing pages, but no JSON-LD / no API — JS-only
  (the do813-Playwright-backlog class) and it's likewise a curated commercial
  guide. Skip.
- **KQED events**: client-rendered `__INITIAL_STATE__`, low volume, press
  property. Skip.
- **Visit Walnut Creek** (`/local-events`): JS-rendered, no JSON-LD, no feed
  hints. Playwright-backlog class; AllEvents-WC + the city calendar cover WC.

## Dead ends (verified today)
- `sfrecpark.org/events` → 404 (the calendar lives at `/calendar.aspx`).
- `events.berkeley.edu/api/2/events` (Localist guess) → 404 — Berkeley is
  LiveWhale, not Localist (the correct API is #5 above).
- BiblioCommons `events/rss/all` → returns the SPA HTML, not RSS.
- `data.acgov.org` Socrata API — gone entirely (see STAGE_D_SF_ENDPOINTS.md §5).
