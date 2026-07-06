# Tampa Bay Event Data Sources — verified intel
_Data scout report, 2026-06-09. All top-8 fetched live and returned real event data. Implementation modules live in `finder/sources/tampa-bay/` (source modules are per-city inputs — the loader resolves `finder/sources/<cityId>/` only; SF & East Bay's set is scouted in STAGE_D_SF_EVENTS.md)._

## Top 8 (ranked by value-per-effort)

| # | Source | Method | Adds | Est/wk |
|---|--------|--------|------|--------|
| 1 | **Visit Tampa Bay** (Simpleview) | JSON API + free self-serve token | festivals, markets, hidden gems, DMO-curated | ~54 |
| 2 | **AllEvents.in** (tampa, tampa/free, st-petersburg, clearwater) | JSON-LD, plain fetch | hidden gems, popups, bar crawls, brand activations | 100–200 |
| 3 | **HCPLC libraries** (Library Market) | JSON endpoint | FREE community firehose, recurring programs | 100+ |
| 4 | **Pinellas County** | The Events Calendar REST | FREE civic/community, Pinellas-wide | 30–60 |
| 5 | **City of Tampa** | Drupal RSS `tampa.gov/calendar/rss.xml` | FREE city/rec | 20–40 |
| 6 | **Univ. of Tampa** (Trumba) | `trumba.com/calendars/ut-events.json` | lectures, galleries, campus-open-to-public | 10–30 |
| 7 | **Meetup** | `__NEXT_DATA__` JSON in HTML, plain fetch | **RECURRING CLUBS** (our weakest area) | 50–100 |
| 8 | **WMNF 88.5** | Event Espresso WP REST | community music, grassroots | 10–30 |

Weak-area coverage: **Free** → 3,4,5 + allevents/free · **Hidden gems/brand stuff** → 2,1 · **Recurring clubs** → 7,3.

## Key gotchas (condensed)
1. **VTB:** GET `/plugins/core/get_simple_token/` → bare token; then `includes/rest_v2/plugins_events_events_by_date/find/?json=<urlencoded>&token=<t>`; date_range `$date` values MUST be midnight ET (04:00Z in DST) or it errors; response nests `docs.docs`; token per-session.
2. **AllEvents:** ~56 JSON-LD Events/page; listing startDate is date-only; some mirror Eventbrite (cross-source merge dedupes).
3. **HCPLC:** `hcplc.libnet.info/eeventcaldata?event_type=0&req=<urlencoded {"private":false,"date":"YYYY-MM-DD","days":30,...}>`.
4. **Pinellas:** `pinellas.gov/wp-json/tribe/events/v1/events?per_page=50` (+start_date); filter service noise (mobile medical etc.); ICS variant empty — use REST.
5. **tampa.gov RSS:** datetimes inside description HTML `<time datetime="...">`; filter board/commission meeting noise.
6. **Trumba:** location field has HTML anchors; skip year-long "Ongoing" allDay items; pattern reusable for other Trumba sites.
7. **Meetup:** parse `__NEXT_DATA__` defensively (brittle across deploys); polite rate.
8. **WMNF:** datetimes in related resource — `events/<ID>/datetimes` or `?include=Datetime.*`.

## Verified dead ends (don't re-litigate)
- `pubsvc.tampagov.net TampaAlerts.svc` → returns [] for all params; decommissioned. RSS supersedes.
- **USF events.usf.edu** (Localist) → 500 privateModeException even on homepage. Skip.
- **Venue sites swept (9):** Jannus, Ritz, Crowbar, Orpheum, Hooch & Hive, Skipper's, Ruth Eckerd, Straz, Amalie — NONE expose Event JSON-LD. They sell via Eventbrite (already covered), AXS, Prekindle, Etix. Best big-venue path = activate the free **Ticketmaster Discovery key** (future).
- **Akamai-blocked to curl, Playwright backlog:** visitstpeteclearwater.com (the Pinellas DMO — worth a Playwright pass), myclearwater.com, Bandsintown, Songkick, do813.com (JS-only; decent gem aggregator later), stpete.org calendar.
