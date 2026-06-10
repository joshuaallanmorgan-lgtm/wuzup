# Long-Term Concerns & Active Monitors

Living backlog of things deliberately **out of scope for the MVP** but important later.
Nothing here blocks the MVP. We log it so we don't lose it. Add freely.

_Last updated: 2026-06-06_

---

## ▶️ NEXT SESSION — do this FIRST
Finish the headless/cltampa data source so the **Red Bull benchmark passes** before anything else. Josh wants it really solved before closing out the next night. Path is mapped in the 🎭 Headless section below.

## 🎟️ Ticketing (future)
The event detail page's "Get Tickets" should eventually open an IN-APP ticketing/purchase flow — a separate page/site that pulls up to buy the ticket *through our app* — not just link out. For now it links to the source event URL.

## 🏙️ City selection & per-city hero art (future)
- User determines/selects their city (currently hardcoded Tampa Bay). Needs a city-selection flow.
- Each city's list header shows a memorable landmark behind the city name (SF → Golden Gate Bridge, NYC → Empire State, Tampa → skyline). Needs a per-city hero-image map. MVP hardcodes Tampa.

## 🎚️ Event ranking & tiers (the "infinite list")
The list section should be **endless** — every event around you, ordered by how cool/relevant, best at top, trailing off into everything else.
- Top of list = the standouts: a random Red Bull cliff-diving, a Morgan Wallen concert next weekend, niche-but-cool happenings.
- Bottom/long tail = everything else (e.g. a small-community knitting club), never hidden, just lower.
- Needs a **coolness/relevance ranking model** and event **tiers**. Explicitly a post-MVP exploration. MVP just shows "stuff," converging naturally on the best.

## 🔁 Deduplication
Same event appears across multiple curator sources (Red Bull showed up in all of them). Need fuzzy merge by title + date + venue.
- Not an MVP problem. Required before scale.

## ⏱️ Refresh cadence / re-parsing
MVP can refresh manually. Long-term it should be **daily → hourly**, incremental, with a strategy for how often each source re-parses and how we handle changes/staleness.
- Future problem. Note the architecture should not assume a one-shot pull.

## 🧹 Data quality (discovered while building the MVP finder)
- **Suspect times:** some events carry implausible times (e.g. St Pete Beach Seafood Festival "2:00 AM" — likely a midnight-UTC datetime shifted to local, or junk source time). Need a sanity rule: times between 1-6 AM on non-nightlife events → treat as all-day/no-time.
Real issues surfaced by the first live run (2026-06-06), all deferred:
- **Price semantics.** A single offer's `price`/`lowPrice` can be a class package, membership, or "from" price — e.g. "Yoga Poolside" parsed as $520. Need to distinguish per-ticket vs. package vs. donation vs. free, and label it.
- **Price coverage gaps.** Eventbrite & Tampa Bay Events often omit price in their structured data → many events show unknown ("—"). May need a secondary lookup per event page.
- **Cross-source dedup, concrete example:** "Red Sox vs. Tampa Bay Rays" vs. "Tampa Bay Rays vs. Boston Red Sox" = same game, word order flipped. Exact-title dedup misses it; needs fuzzy match on date+venue+teams.
- **Source depth / pagination.** Currently ~20 events per source (page 1 only). Eventbrite alone had 40+ in the HTML. Crawl deeper later.
- **JS-rendered sources.** Creative Loafing, Visit St. Pete/Clearwater, City of Tampa load events via JavaScript → a simple fetch sees nothing. Needs a headless browser or their hidden JSON endpoints to unlock.
- **Prose sources.** That's So Tampa, Date Night Guide, etc. hide events in article text → need an LLM extraction pass (costs money; deferred).

## 🎭 Headless / JS-source extraction (capability BUILT, parser WIP)
Installed **Playwright + Chromium** (root `package.json`) to reach JavaScript-rendered sources — the tier that carries free/brand events like the **Red Bull benchmark**.
**Proven:** we CAN render cltampa & the St. Pete tourism site, and **Red Bull IS present** in the rendered cltampa calendar. Clean detail URL: `community.cltampa.com/event/red-bull-cliff-diving-21291306`.
**The hard part = a robust per-site PARSER**, because these sites expose NO structured data even after JS runs:
- cltampa event anchors are clean (`/event/<slug>-<id>`, ~129), but `.fdn-pres-item-content` cards hold only image+title; the **date/venue live in a sibling container** (climbing up from the anchor yields the rich text: "Sat., June 6 … Venue, Address, City … Free").
- The **Promoted strip** (top ~3, incl. Red Bull) is separate from the dated list and has **no inline date** → its date needs the event DETAIL page rendered.
- First parser pass: 30 cards but only 2 dates (wrong container) + Red Bull missed.
**Path forward (focused, next session):** render listing → per-anchor climb to the rich card text → parse date/venue → render detail pages for date-less promoted events → add as a `render: true` source in the finder, cached aggressively (rendering is slow). Decide: is a brittle per-site scraper worth it, or wait for a paid LLM-extraction pass (cleaner, costs money)?

## 🛡️ Source reliability & resilience
Real outage hit during the first session: **ilovetheburg.com returned persistent 503s** (down for curl, Node, and browser alike), which wiped ALL "free" events and the Red Bull benchmark in one shot — because that one source was load-bearing for those.
- **Done (MVP):** per-source caching (`finder/cache/*.json`) — a failed live fetch falls back to the last good pull so one outage can't drop a source; plus retry-with-backoff.
- **Long-term:** source redundancy so no single site is the only carrier for a category (e.g. "free events" shouldn't hinge on one domain); monitoring/alerts when a source fails; polite rate-limiting / caching so we don't get ourselves blocked; staleness indicators in the UI when data is served from cache.

## 📍 Geocoding accuracy (for the map)
Venue names/addresses → lat-long must eventually be **as accurate as Google Maps**. MVP can be rough/approximate.

## 🌐 True comprehensiveness ("show ALL events")
MVP coverage = our curator sources' coverage (the "best" events). Long-term goal is **literally every event** in an area, which means going beyond curators to primary sources (venue sites, Instagram, user submissions). This is the hard, real version of Charles's "show ALL events" priority.

## 👥 Social layer / gamified feed
User-submitted events, organizers advertising their own community/small-group events, "who's going," friends, permanent-business advertising. The app "sort of acts as social media." **Whole second product — hard parked.** MVP gets only a basic "add an event" form to prove the concept.
Expanded vision (2026-06-09): the Hot tab eventually becomes a **gamified feed** — each event is a post users can **comment on, like, and interact with** (requires accounts); you can **see what friends are interacting with** and link up with them for events. Real popularity signals from this eventually replace the heuristic hot-score.

## 📅 Calendar views (future)
Month-grid toggle shipping now; **year view** and other calendar zoom levels = future. Also: section-specific data pipelines are an anti-pattern — sections are VIEWS over one rich dataset (one finder, many lenses).

## 🎯 Personalization
"Slightly tailored, not heavily algorithmic." Onboarding questions + learned swipe/tap preferences **re-order** events for digestibility but **never hide** them. Post-MVP.

## 🌗 Dark mode
Light theme is the identity (inviting, Apple-ish). A proper dark mode is wanted later — design tokens are already CSS variables, so it's a `prefers-color-scheme` / toggle pass when we get there.

## 🗺️ Three coexisting UI surfaces
Calendar + Map + List as three buttons over one dataset, each opening a shared detail page. The real UX challenge is making them feel like one coherent body. Design work for after the data engine is proven.

## 🏙️ Beyond Tampa Bay
Vision is "drop into any city in the world and find something to do." MVP is Greater Tampa Bay only. Multi-city expansion = later.

## 💸 Paid data (when we choose to spend)
MVP is $0. Later, paid options can add breadth (e.g. SerpAPI Google Events ~$25/mo, other event APIs). Revisit once the free pipeline is proven and there's reason to scale.
