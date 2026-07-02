# Sprint Plan — "Everything Catches Up to the Data"

> ⚠️ **SUPERSEDED — HISTORICAL (Gen 1 naming: Sprints A–F).** Do not plan or execute from this doc.
> Current master plan = [ROADMAP.md](ROADMAP.md) · full doc map = [INDEX.md](INDEX.md) · idea intake = [BACKLOG.md](BACKLOG.md). Retained for history only.
_v1 · 2026-06-10 · drafted solo-Josh day 3. Audit-patched, then executed._

## ✅ EXECUTION STATUS (end of day 3, all adversarially reviewed + live-verified)
- **Sprint A — DONE** → `main` (e815c41). 738→1,331 events at the time; staleness/merge/category/noise/coords fixed; `npm run refresh` + Task Scheduler XML (Josh: import once, see REFRESH.md).
- **DTC benchmark — DONE** → branch (6f3968f). Don't Tell Comedy captured naturally (10 secret shows), standing benchmark added.
- **Sprint B — DONE** → branch (b5c3ca8). Detail page v2.
- **Sprint C — DONE** → branch (8fdd042). ♥ saves + Add Event.
- **Sprint E — DONE** → branch (e0b3c88). VSPC cracked (+176 Pinellas events), stpete.org, Meetup 3.4x; do813 dormant (auto-revives). **1,603 events.**
- **Sprint D — DONE** → branch (4d6cf58). FMN v2 (2.6x distinct), time-awareness, calendar clamp, Editorial consolidation.
- **Sprint F — STILL GATED on Josh** (hosting account + Ticketmaster key).
- Known leftovers: 'other' category = 128 (benchmark prints ❌ honestly); library share of feed = 60% (ranking-diversity question for Josh+Charles); do813 dormant; cltampa promoted details still CF-blocked some runs.

## Ground rules (from Josh, day 3)
- **No new creative initiatives.** Every sprint expands something Josh & Charles already asked for — each task cites its sanction.
- Sprints run **autonomously** (multi-agent workflows + live verification + push), minimal Josh intervention.
- Every sprint ends with a **Charles checkpoint list**: the things he reviews and rules good/bad next time he's here.
- Standing invariants: never hide events · sponsored always labeled · no fake data · teal identity, --hot reserved for hot-ness · scroll > click except bubbles/FMN pages · build green + pushed = done.

## Where we honestly stand
**Strong:** event generation (738 real events, 13+ sources, buzz/hot-score/tags, benchmarks green).
**Lagging (Josh's list):** UI/display, UX/utility ("still a chore"), gamification depth, data *quality* (vs. quantity), freshness (manual refresh only), and the detail page is thin against Charles's "as much information as you can find" directive.

---

## Sprint A — Data You Can Trust 🧹
_The embarrassment-removal sprint. Everything else sits on this._
**Sanctioned by:** "no fake data / has to be based in reality" (Josh, night 1); data warts logged in LONG_TERM; Josh's refresh-cadence note. _Audit-sharpened 2026-06-10 with exact targets (full audit in session log):_
- **#1 STALENESS (audit's top finding):** baked `tonight` tags rot within a day AND app-side `lib.js:105-108` ORs the stale tags back in, defeating its own correct runtime date check — on 6/10 all 21 "tonight" tags pointed at 6/9. Fix both halves: delete the `tags.includes('tonight'/'weekend')` fallbacks in lib.js (runtime range checks are sufficient), and ship `npm run refresh` + daily Task Scheduler XML (Josh double-clicks to install).
- **Library branch over-merge (240 lost branch records, 121 groups):** in `sameEvent()` (finder.mjs:403), same-source-family pairs must ALSO match venue (one publisher never lists one event at two venues); cross-family keeps title-Jaccard (preserves the Rays merge). Belt-and-braces: veto title-only merges when both venues present and share zero non-generic tokens.
- **2AM-festival root cause found:** mergeCluster (finder.mjs:419) prefers ANY timed start; I Love the Burg carried junk `T02:00`. Fix: only prefer timed starts in 06:00–23:59; demote 1–6 AM times to date-only when a date-only alternative exists. Also: 30 events show "12:00 AM" — hcplc.mjs + trumba-ut.mjs must emit date-only for all-day items.
- **Recurring overfire (54 false positives):** finder.mjs:547 regex — require plural `days\b` (kill the optional `s`); keep `weekly`/`every <weekday>`. Un-buries 54 one-offs from gem/hot scoring.
- **Category 'other' is self-inflicted:** Visit Tampa Bay's API returns `categories[].catName` but visittampabay.mjs doesn't request the field; Pinellas drops `categories` AND `is_virtual` (which also kills the Teams-meeting junk); Eventbrite's `eventAttendanceMode` (online filter) dropped in normalize(). Wire all three + keyword/venue map v2. Target: 'other' ≤ 90.
- **Residual noise:** add "agency"+webinar filters to tampagov.mjs, invite-only filter to trumba-ut.mjs, virtual filter to meetup.mjs, `is_virtual` to pinellas.mjs.
- **Coords:** purge the 41 permanently-cached null geocodes (finder.mjs:814 never retries); static branch→coords table for the ~30 library branches (wipes half the 88-missing gap); retry the 19 with addresses.
- **Code health bundle:** guard the unguarded cache JSON.parse (finder.mjs:668); lazy-create Leaflet on first Map activation + preferCanvas (650 SVG nodes built at boot today); extract `finder/sources/_shared.mjs` (8 drifted copies of decodeEntities etc., loader skips `_`-prefixed); delete dead `.pg-band-main/.pg-title/.pg-search-input` CSS; Escape-effect dependency array; recompute date anchors on visibilitychange (app open past midnight shows yesterday's "Today"); user-facing empty-state copy (no "re-run the finder").
- Benchmarks extended: time-sanity count = 0 in 1–6 AM window (non-nightlife), library same-title-multi-branch preserved-count, 'other' ≤ 90, noise sweep = 0, no fully-ended events in output.
**Charles checkpoint:** nothing visual — he should simply *stop seeing* 2 AM times, duplicate-ish rows, and "other" everywhere.

## Sprint B — The Event Page Deserves the Event 📄
_Most-tapped surface, thinnest implementation._
**Sanctioned by:** Charles night 1: detail must be "a full page that opens up and gives you as much information as you can find"; round-2 #5: "outdoor event, rain%" hint; Charles's weather directive (extend to events).
- Detail v2 layout: hero (existing) + richer info rows; show **buzz** ("Listed by 3 local sources" — trust signal), all sources, category chip, ongoing/through dates.
- **Mini-map** on detail (small static Leaflet, non-interactive, tap → Map tab centered on pin).
- **Weather for the event's day** (within 16-day window): "🌧️ 47% rain that day" — and the sanctioned outdoor-rain hint on outdoor-category cards.
- **More like this**: 4 same-category/nearby upcoming events (horizontal rail) — keeps the scroll going, no dead ends.
- Utility row: **Add to calendar** (.ics download), **Directions** (maps link), **Share/copy link**.
- Get Tickets stays the big CTA (in-app ticketing remains future/parked) — but copy becomes conditional ("View event ↗" for free/ticketless events; a library storytime shouldn't say Get Tickets).
- _Audit specifics:_ show **end dates/times** (39 multi-day events currently render as a single moment — the Seafood Festival looks like one 2 AM instant); **address fallback** when venue is null (18 events currently show NO location); surface category chip + heat badge + hidden-gem/staff-pick tag lines on detail; address links to a maps URL.
**Charles checkpoint:** open any event — does it now feel like the event's *home page*?

## Sprint C — Saves + Add Event ❤️➕
_Both explicitly sanctioned, never built._
**Sanctioned by:** round-2 #4 "optionally localStorage ♥ saves"; Josh night 1: "the MVP does need to include a feature where you add an event, a very basic version."
- ♥ on every card + detail → localStorage; a **Saved shelf** (top of Hot when non-empty: "Your list") + saved-count on the heart; never expires silently (past saved events grey out).
- Calendar: saved events get the reserved dot (the month-grid design already left a slot for exactly this).
- **Add Event form** (basic, proving the concept): title/date/time/venue/category/free-or-price/link → stored locally, appears in the feed with a "Added by you" tag, exportable JSON (the future submission pipeline's seed). No accounts, no moderation — it's the concept proof Josh specified.
**Charles checkpoint:** save 3 events, add 1 fake-real event of his own, feel the loop.

## Sprint D — Feel & Fairness ✨
_The "fun, not a chore" + Apple-smooth mandate, applied where it's still rough._
**Sanctioned by:** Josh round-2 ("fun and lively... it's a chore"); Charles's Apple/Tesla bar; FMN is Charles's directive — tuning it is expansion, not new creative.
- **FMN scoring v2** _(audit-quantified: max match bonus 45 < hotScore spread 78, so only 14 distinct events appear across all 24 answer combos; Rays game lands in "date night + wild")_: vibe/who dominate (halve hotScore weight or +40 vibe), hard-prefer matching categories when ≥5 exist, per-session jitter so reveals differ, avoid repeating last session's picks (localStorage), and an honesty state — picks that matched neither answer wear a small "wildcard" tag instead of being presented as confident wins (no-fake-data spirit).
- **Tonight time-awareness everywhere** _(audit: at 11 PM the Tonight carousel is 100% already-started events presented as plans)_: past-start events sink and get a "Started 7:00 PM" label (never hidden); late at night Tonight becomes "Late tonight + Tomorrow"; date anchors recompute at midnight/visibilitychange (app open past midnight currently shows yesterday's "Today").
- **Calendar correctness:** clamp in-progress events to today (REALM currently lives only under a May 8 pill; rail starts with past days); Seafood-Fest-style multi-day events absent from days 2–3 — minimal clamp fix now, full multi-day spanning = Charles question (changes heat-map semantics).
- **Consistency sweep:** heat badges on FreeCard + calendar cards + detail; distance pills for Search/FMN when coords exist; map pins filtered to upcoming (21 expired events still have live pins with Get Tickets CTAs); sponsored disclosure in map tooltips.
- **Editorial consolidation (tasting verdict is IN: Editorial won):** make Editorial the polished default design system; fold in Poster's best elements (FREE overlays, category-hue energy, grid moments where natural) and apply Cinematic's vibe only to naturally-dark surfaces (FMN, Big One); refine section displays/naming within editorial. Toggle stays as comparison tool until consolidation lands, then retires.
- Performance pass at 738+ events (memoization, image lazy-loading discipline, mounted-tabs cost) + micro-interaction sweep (every tap answers in ≤120ms).
**Charles checkpoint:** run FMN 5 times with different answers — do the picks feel *listened to*? Flip modes — crown the winner.

## Sprint E — Deeper City 🏙️
_More of what made night 2 work: real events, hidden-gem tier first._
**Sanctioned by:** Charles: "really really really go deep into as much data as we can"; DATA_SOURCES.md backlog (researched + intended, just unbuilt).
- **visitstpeteclearwater.com via Playwright** (the Pinellas DMO — biggest gem source still untapped; Akamai-blocked to curl, needs headless).
- **do813.com via Playwright** (gem aggregator, JS-only).
- stpete.org calendar (Playwright), Meetup depth (only 14 events came through — category pages), deeper Eventbrite pagination (p3+).
- Retry the cltampa promoted-detail blocking with politer pacing.
- Buzz gets richer → Big One/heat badges get more honest.
**Charles checkpoint:** the Hidden Gems shelf and St. Pete coverage should feel noticeably juicier.

## Sprint F — In Charles's Pocket 📱 _(GATED: needs Josh)_
**Sanctioned in spirit by** "next time Charles sees this" — but deploying is outward-facing, so it waits for Josh's explicit OK + a free hosting account (Netlify/Vercel/GitHub Pages).
- Static deploy of the app (events.json ships with the build; refresh = re-deploy script).
- PWA manifest + icon so it installs to a phone home screen like a real app (the stated end-vision is a phone app; this is the free bridge).
- **Also needs Josh:** free Ticketmaster Discovery key (5-min signup) — unlocks the arena/venue tier the venue-site scrape can't reach (DATA_SOURCES verdict).

---

## Quick wins (fold into Sprint A's run — tiny, all sanctioned, all audit-flagged)
- **Add the missing Family bubble** (Charles's round-2 list includes it verbatim; 48 family events have no destination; hue already defined).
- Hide the literal "OTHER" category overline (22% of events wear it) — show nothing or "Event".
- Hero count says "738 events near you" while 21 are over → count upcoming only.
- Hide the 🎨 mode pill over Find My Night (floats dead on the dark flow).
- Poster-mode no-image tiles: category emoji fallback instead of printing the time as artwork.
- "More gems →" link mislabeled (just scrolls to Everything) → retitle, and consider a Gems bubble (flag below).

## Decisions parked for Josh/Charles (not blocking A–E)
1. **Multi-day calendar spanning** — should a 3-day festival appear on all 3 days (changes month heat semantics)? Minimal clamp ships now either way.
2. **Gems bubble** — the curated 24-gem shelf could be a bubble destination ("More gems" currently underdelivers). Pure expansion of an approved concept; cheap. Recommend yes.
3. **Sprint F gates** — deploy approval + hosting account; Ticketmaster key signup.

## Execution order & cadence
**A → B → C → D → E**, F whenever Josh unblocks it. A+B are one day's work; C+D another; E a third. Each sprint = one workflow (parallel agents, disjoint files) + adversarial review + my live verification + push. Plan updated as audits land; deviations logged here.
