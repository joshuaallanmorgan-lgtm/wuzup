# Wuzup Adversarial Product Audit

**Audit date:** July 14, 2026  
**Audited snapshot:** branch codex/handoff-closeout at f3a9589, including the working tree present during the review  
**Scope:** product value, first-run experience, UI/visual design, core journeys, accessibility, data quality, ranking claims, city/time correctness, reliability, performance, privacy, testing, refresh/deploy operations, competitive position, and roadmap direction

## Executive verdict

Wuzup is not an ugly app. At phone width it has a coherent, warm visual system, attractive detail pages, and more polish than a typical prototype. The problem is more serious than aesthetics: the product repeatedly makes confident claims that its data and behavior cannot currently support.

The dominant launch risk is **loss of trust**.

A user can see a newly refreshed timestamp on week-old data, be told that an event is a “best bet” because it is free and has an image, see already-ended events in same-day recommendations, get an incorrect “Open now” result, apply three filters while only one is honored, add something to a plan and then find an empty My Plans page, or be told a place is “near you” before sharing a location. Once any two of those happen, the product’s recommendations stop carrying authority.

The current app also spreads itself over too many jobs:

- event discovery;
- a large place directory;
- taste calibration;
- swipe-based browsing;
- guides;
- a day planner;
- a calendar;
- memories/history;
- notifications;
- profile mechanics;
- multi-city expansion.

None is yet strong enough to beat the obvious substitute on its home turf. Eventbrite has event inventory and ticketing, Meetup has actual communities, Google Maps has richer place data and collaborative saved lists, and Wanderlog has mature itinerary and route planning. Wuzup’s defensible space is not “more listings.” It is:

> **The fastest, most trustworthy way to turn fragmented local calendars into a good, shareable day.**

The next direction should therefore be a **2–4 week Trust and First Value stabilization**, not more cities or more surface area. Prove one hero loop in Tampa and SF:

> intent → three credible options → a feasible plan → save/share → successful follow-through

Until that loop is truthful and reliable, more premium UI, more guide tiles, more personalization, and 50–300 city expansion will amplify the defects rather than create product-market fit.

## The short answer: why people would not use it

| Abandonment reason | What the user experiences | Why it is damaging |
|---|---|---|
| “I cannot trust what it says.” | Ended events, false freshness, weak “best” rankings, heuristic “Open now,” and inflated inventory counts | Trust is the product for a recommendation app. A polished card cannot rescue a wrong recommendation. |
| “It makes me work before it helps me.” | A multi-step primer appears before value, followed by another taste tuner in Events and Spots | Cold users are asked to configure a product whose usefulness they have not seen. |
| “There is too much, but little feels chosen.” | Repetitive shelves, recurring library programs, a giant swipe module, dozens of planner suggestions, and the same item appearing repeatedly | The app behaves like a decorated directory rather than a decisive local concierge. |
| “Planning does not work the way I expect.” | Quick-add silently chooses a date/daypart, planned items are suggested again, and My Plans can show a badge but no plan | Planning is the most differentiated promise and currently contains a guaranteed blank-state bug. |
| “The labels are marketing, not evidence.” | “Recommended near you” without location, “Worth the drive” without a quality signal, “Hidden gem” records with almost no content | Overclaiming turns ordinary data limitations into credibility failures. |
| “I cannot take the value with me.” | Saves, plans, taste, history, and custom events live only in localStorage; no complete export/import or optional sync | A cleared browser or new device destroys the retention loop. |
| “I cannot share the thing I found.” | Tabs and detail pages do not have durable URLs or browser history | Discovery loses its natural send-to-a-friend acquisition loop. |
| “It feels like a phone demo on my computer.” | A fixed roughly 460 px column sits between very large empty gutters | The design is attractive on mobile but unfinished on desktop/tablet. |
| “It does not work for me.” | Keyboard and screen-reader users can reach controls on invisible tabs and behind full-screen pages | The navigation architecture is a release-blocking accessibility defect, not a minor audit item. |
| “It is not really local to my part of town.” | Highly concentrated source coverage and broad regional labels disguise sparse or repetitive inventory | Breadth claims do not match decision-ready supply. |

## Recommended product decision

### Do now

1. Freeze city expansion and nonessential V2 feature work.
2. Make freshness, expiry, time, location, filter, and ranking claims truthful.
3. Repair the complete plan lifecycle, including My Plans and add-to-plan semantics.
4. Reduce the product to one decisive feed and one excellent planning flow.
5. Add full-data quality and end-to-end release gates.
6. Run a two-city beta only after the gates in this document pass.

### Do not do yet

- Do not expand from 2 cities to 50 or 300.
- Do not invest heavily in premium animation or more card variants.
- Do not add more heuristic recommendation labels.
- Do not make the current place directory a primary acquisition promise.
- Do not add more guide categories without actual editorial evidence.
- Do not treat an hourly/daily freshness system as optional “ops backend.” For events, freshness is inventory.

## Severity model

- **P0 — release blocker:** can make the product materially wrong, lose user data, break a core journey, or exclude a user.
- **P1 — must fix before growth:** undermines repeat use, differentiation, comprehension, or operational scale.
- **P2 — polish/quality debt:** makes the product feel unfinished or creates avoidable friction, but is not independently catastrophic.

## P0 findings: fix before inviting growth

### P0-01 — The freshness indicator is false

**Evidence**

- app/src/App.jsx:63-69 and 112-139 derives the displayed data time from the HTTP Last-Modified header.
- .github/workflows/deploy.yml:50-69 re-stages city artifacts during an app deploy.
- A UI-only deploy therefore updates the host modification time without refreshing the event source data.
- Both production city responses reported a July 14 Last-Modified time while Tampa’s artifact was generated July 7 and SF’s was generated July 5.
- The local Settings screen similarly showed “Updated Tuesday” after the test/deploy process touched the file, even though the data generation date was older.
- The weekly refresh workflow opens a pull request and still requires a human merge. There had been no recorded run of that workflow at the time of this audit.

**User impact**

The strongest reassurance in Settings and Coverage can be wrong by construction. A user has no way to distinguish “the app was deployed today” from “the local inventory was fetched today.”

**Required fix**

- Write immutable generatedAt metadata into every city artifact or a signed/hashed city manifest.
- Also record source-level fetchedAt, success/failure, and usable-row counts.
- Display generatedAt, never a web-host file header.
- Define a maximum data age and fail the deploy if it is exceeded.
- Refresh time-sensitive event sources at least daily.
- Make stale state explicit in the UI rather than cosmetically current.

**Acceptance**

- A UI-only deploy cannot change the displayed data date.
- CI tests a deliberately old artifact and blocks deployment.
- The user can see the difference between city generation time and a partially stale/failed source.

### P0-02 — The deployed data is not the same data CI proves

**Evidence**

- test/smoke.mjs:45-53 validates the full app/public event artifact.
- .github/workflows/ci.yml:49-61 builds/tests the committed bytes already in app/public as Tampa without first staging the freshly generated Tampa artifact. It then stages SF and gives that artifact build-only validation.
- .github/workflows/deploy.yml:50-69 stages Tampa and then SF in sequence.
- finder/deploy.mjs:39-49 and 72-83 validates existence/JSON parsing rather than byte identity and the full behavioral suite.
- The audited app/public/events.json contained 1,665 rows with no stable IDs, while the current Tampa finder artifact contained 1,642 rows with stable IDs. These are observably different product inputs.
- The deploy workflow can run on main without the same smoke gate used for pull requests.

**User impact**

A green CI run does not prove the bytes users receive. Data-specific regressions can pass review and appear only in production.

**Required fix**

- Build an immutable manifest for every city containing artifact hash, generatedAt, schema version, source health, and row-quality metrics.
- Run the full suite against the exact artifact hashes that will be deployed.
- Make deployment consume only those approved hashes.
- Validate both cities independently; do not rely on sequential staging in one mutable path.
- Add a post-deploy hash comparison and smoke journey.

**Acceptance**

- CI prints and approves the production hash for each city.
- Deploy fails on any byte mismatch.
- A test that mutates an artifact between CI and deployment is caught.

### P0-03 — Expired inventory materially inflates the product

Two snapshots expose both the size of the problem and the artifact drift. Calendar-day counts are measured before the start of July 14 in each artifact’s city timezone—America/New_York for Tampa and America/Los_Angeles for SF—so the numbers do not change while the audit is being read:

- The bundled app/public Tampa data contained 1,665 rows; 717, or 43.1%, had ended before the July 14 Tampa calendar day. Same-day expirations increased that number throughout the audit.
- The newer Tampa finder artifact contained 1,642 rows; 529 had ended before the July 14 Tampa calendar day, leaving 1,113 current-day-or-future rows.
- The SF finder artifact contained 743 rows; 216 had ended before the July 14 SF calendar day, leaving 527 current-day-or-future rows.

coverageStats(), Coverage Card, Settings, and Search count all loaded rows even though feeds later filter some past items. A user can be told there are 1,665 events while the searchable/useful number is far smaller. Some same-day surfaces only compare the end date, so an event that ended earlier today can still appear.

**Required fix**

- Remove ended rows before publishing the primary artifact, not only during individual render paths.
- Define one city-time-aware isActionable predicate and use it for counts, search, sections, ranking, and planner suggestions.
- Keep historical rows in a separate artifact if memories/history needs them.
- Never advertise raw row count as current event supply.

**Acceptance**

- Expired-at-render rate is under 0.5% and never appears in Tonight or recommendation shelves.
- Search, Settings, Coverage, and feed counts agree.
- Tests run at before-start, during-event, exact-end, and after-end boundaries in both city and device timezones.

### P0-04 — My Plans can show “1” and render a blank page

This is a directly reproduced core-journey failure.

- A future event was added to Tomorrow night.
- Profile correctly showed Plans = 1.
- My Plans showed a “1” badge and an entirely blank body.
- The blank state persisted after waiting/reload.

The cause is structural: app/src/MyPlansPage.jsx:48 reads dayPlans and lines 55-63 count them, so hasAnything becomes true. The page then suppresses its empty state, but the render path only displays month reality, history, prompts, and attended items. It never renders current/future dayPlans.

**Required fix**

- Make future/current plans the first content in My Plans.
- Add edit, move, remove, and share actions.
- Reconcile Profile count, Calendar markers, Day page, and My Plans from the same selector.
- Add an end-to-end test from event card → add to tomorrow night → My Plans → exact event visible.

**Acceptance**

- Every nonzero plan badge has visible, actionable content.
- The same item/date/daypart is consistent on all four plan surfaces.

### P0-05 — Quick-add silently creates surprising plans

Generic quick-add logic chooses an event date or today for a place, uses the first available daypart, and can fall back to a different daypart if the expected one is occupied. A 7 PM event can land in morning; a place can silently land today; duplicate add attempts can announce success even when deduped.

In the live walkthrough:

- Adding the Chicago concert to Tomorrow night worked.
- The detail CTA still read “Add to Tomorrow night” after the item was already planned.
- The Plan page immediately recommended the exact same event and its near-duplicate again.
- Planner suggestions were labeled “Based on the day’s weather” even when they were unrelated concerts/civic events.

**Required fix**

- For an event with a known time, infer a proposed slot but confirm the date/daypart.
- For a place, always ask for date and daypart.
- Never silently fall back to a semantically wrong slot.
- Make planned state visible on cards/details; offer “View plan,” “Move,” or “Remove.”
- Exclude planned, saved-as-dismissed, ended, and canonical duplicates from suggestions.
- Return explicit duplicate feedback instead of a false “Added.”

**Acceptance**

- No plan mutation occurs without a visible date/daypart confirmation.
- A planned event cannot be suggested again on the same plan.
- Add state survives reload and all CTAs reflect it.

### P0-06 — Tampa and SF share user state

Tampa is served at /wuzup/ and SF at /wuzup/sf/ on the same origin. All durable state uses the global twh: prefix in app/src/storage.js:19 and 55-76. Taste, primer completion, name, saves, visited items, plans, custom events, recents, and location preference therefore bleed across cities. Only weather is scoped.

Consequences include:

- Tampa saves appearing as snapshots in SF;
- unresolved Tampa plans in SF;
- SF recommendations tuned by Tampa behavior;
- custom events appearing in the wrong city;
- location permission preference being reused across city context.

The generated stable event ID is also ignored by keyOf(), which uses URL/title and start time. URL or dedupe changes can orphan saved/planned references.

**Required fix**

- Namespace every city-specific store by CITY.id.
- Define which state is global, such as display name, and which is city-bound.
- Add a versioned migration that does not destroy existing user data.
- Use stable event/place IDs as the primary identity and retain aliases for migrated keys.
- Test switching cities, then switching back, with plans/saves/custom events in both.

### P0-07 — City-time correctness is not established

Event parsing, display, weekend/daypart logic, plan stepping, “Open now,” and ICS generation generally use the device-local Date environment. CITY.tz is mainly used for weather. The event corpus contains:

- 536 date-only starts;
- 823 timed values without an explicit offset;
- 306 offset-bearing values.

This mix is ambiguous. A user in Los Angeles viewing Tampa can see a different day or daypart. Day stepping by 86,400,000 milliseconds can break across daylight-saving transitions. ICS export parses an instant and then emits floating local fields without a TZID or UTC marker.

**Required fix**

- Establish a canonical event-time schema: local date, optional local time, city IANA timezone, and explicit all-day/range semantics.
- Convert only at presentation boundaries, with a stated product choice about city time versus viewer time.
- Use calendar-day arithmetic rather than millisecond stepping.
- Emit RFC-compliant ICS with TZID or UTC.
- Include city-time tests while running the browser in several device timezones.

**Acceptance**

- The same Tampa event remains on the same Tampa calendar day from New York, Los Angeles, and London.
- All-day and date-only events never acquire a fake time.
- DST boundary plans and exported calendar entries remain correct.

### P0-08 — Combined filters do not combine

The filter sheet stores When, Price, and Category selections, but Apply resolves category OR when OR price in app/src/FiltersSheet.jsx:21-39. “Tonight + Free + Music” may therefore return all Music regardless of time and price. Selected chips are visual-only and lack pressed-state semantics.

**Required fix**

- Model filters as a single predicate and apply every selected dimension.
- Show an active-filter summary and result count before/after applying.
- Add “Clear all.”
- Add unit and browser tests for every pair and the three-way combination.
- Expose chip selection with aria-pressed.

### P0-09 — Invisible screens remain interactive

All five pager sections stay mounted. Visited pages are translated offscreen rather than removed, inerted, or hidden from assistive technology. Full-screen subpages and details are appended above the pager while the underlying pager and tab bar remain focusable. Only the onboarding primer sets global inert.

Observed consequences:

- DOM queries found duplicate Back buttons and duplicate event controls in visible and hidden layers.
- Keyboard/screen-reader users can travel into controls on invisible tabs or behind an obscuring detail page.
- Detail roots lack dialog/page-transition semantics and consistent focus placement/return.

**Required fix**

- Apply inert and aria-hidden to every inactive pager section.
- Treat full-screen subpages as actual routes or correctly managed modal pages.
- On navigation, move focus to the new page heading and announce it.
- Restore focus to the invoking control on close/back.
- Make the tab bar a labelled navigation region and expose the current page.

**Acceptance**

- A keyboard traversal can reach only visible controls.
- Automated accessibility tests and a manual screen-reader pass cover all five tabs, detail, search, filters, picker, and settings.

### P0-10 — Error and malformed-state paths can look empty or brick startup

Events collapse network failure into an empty array and then show generic “Nothing here.” Places enter a permanent error state with no retry while the UI says to check back. Several large fetches have neither timeout nor AbortController. There is no app-level ErrorBoundary.

Weather failure has a second trust risk: app/src/weather.js:102-147 can serve an arbitrarily old cached forecast without a maximum age or stale label, while the planner describes recommendations as weather-based.

Local persistence is also treated as infallible:

- write failures from quota/private mode are often ignored while success is announced;
- loadMyEvents accepts any array;
- a value such as [null] can reach normalization and dereference raw.tags, crashing launch;
- one corrupted localStorage value can therefore white-screen the app.

**Required fix**

- Separate loading, empty, stale-cache, offline, parse-error, and network-error states.
- Add bounded timeout, abort, retry, and “use last good data” behavior.
- Put a strict age limit on cached weather, visibly label stale fallback data, and do not use stale weather as a recommendation reason.
- Add a root ErrorBoundary with recovery and safe diagnostic export.
- Validate every persisted value with a schema and quarantine only the invalid key.
- Announce storage failure; never claim a save succeeded when it did not.

**Acceptance**

- Offline, 404, invalid JSON, timeout, quota failure, and corrupted storage are browser-tested.
- The app always renders a recoverable state.

### P0-11 — Search can report results while rendering a blank page

Search scope persists across queries, but zero-count scope tabs are removed dynamically. If a user selects Guides for one query and then enters a query with event results but no guide results, the stale selected scope can remain Guides even though that tab no longer exists. The header reports a nonzero total while neither the event list nor the guide empty state renders.

This is deterministic, not an intermittent loading edge case.

**Required fix**

- Reset scope to All whenever the selected scope becomes unavailable.
- Derive the visible count from the active scope.
- Give every valid nonzero state a visible result component and every zero state an explicit message.
- Add a browser regression test that changes from a guide-matching query to an event-only query.

## P1 findings: repair before growth

### P1-01 — The catalog is dominated by repetition and a few sources

The 1,113 current-day-or-future Tampa rows collapse to about 593 recurring-series cards under the project’s recurrence key. Hillsborough Libraries contributes 667 of those rows, or 59.9%. Examples include Baby Time repeated 70 times, Family Story Time 67, Made in Florida 40, and Toddler Time 39.

SF is also concentrated: AllEvents 208, UC Berkeley 166, and Eventbrite 95 account for 89.0% of its 527 current-day-or-future rows. Only six source families had a current item even though planning material refers to “22 sources”; endpoint/page count is being presented as independent local voices.

**Fix**

- Canonicalize recurring series and expose occurrence choice inside one card.
- Measure active independent publishers, not endpoint count.
- Add source diversity constraints to ranked surfaces.
- Keep the full catalog searchable, but gate home/recommendation inventory through a decision-ready quality tier.
- Flag a city as under-covered when concentration exceeds a launch threshold.

### P1-02 — Long ranges create phantom “Tonight” events

Runtime logic marks every day between start and end as tonight-eligible. Aggregator sale windows or recurrence envelopes can therefore behave like continuous events.

Examples included:

- Berkeley Coffee Club spanning 518 days while tagged one-off;
- a 22-day Teen & Mom Night listing;
- a 56-day Power Gals listing;
- several one-off SF rows spanning at least seven days.

**Fix**

- Require explicit continuous-exhibition evidence for long one-off ranges.
- Otherwise split known occurrences, keep only the true start, or quarantine the item from time-critical surfaces.
- Add range plausibility and recurrence tests at ingestion.

### P1-03 — Recommendation language overstates weak ranking evidence

Event hotScore is largely a formula based on cross-source duplication, staff flag, one-off status, image, proximity, and free status. It does not contain attendance, ratings, sell-through, editorial review, organizer reliability, or successful user outcomes.

Nevertheless, it powers language such as:

- “Tonight’s best bets”;
- “Worth planning around”;
- “Big nights”;
- “Recommended”;
- “Local favorites.”

The live top pick was a rehabilitation hospital grand opening. Other high-ranking examples included business expos, service showcases, giveaways, career fairs, and brand activations.

Place labels are similarly unsupported. Without geolocation, “Recommended near you” is photo-first output from a heuristic using taste, free status, source corroboration, and alphabetical tie-breaks—not actual nearness or demonstrated quality. “Worth the drive” is the next unused set rather than evidence that a trip is worthwhile. “Hidden gem” is an inverse-fame heuristic, but the hidden sets had almost no photos/descriptions/hours and included records such as an open-space parcel and a townhomes park.

**Fix**

- Use humble, literal labels for heuristic output: “Free tonight,” “Nearby,” “With photos,” “Matches music.”
- Reserve “best,” “favorite,” “gem,” and “worth the drive” for evidence-backed/editorial selections.
- Show “Why this was selected” using truthful signals.
- Create confidence tiers that prevent low-information rows from flagship surfaces.

### P1-04 — The event feed is over-shelved and under-decided

Events can stack Tonight, Worth planning, Weekend, Guides, Saved, Free, Recurring, Neighborhood, For You, Recent, and More Upcoming. Independent selection functions do not globally dedupe. The same event or series can reappear across shelves and again in the full list.

On a 390 px screen, a large swipe tuner and category controls arrive before the useful feed. The result is long, repetitive, and cognitively expensive. It makes the user evaluate inventory instead of trusting a recommendation.

**Fix**

- Collapse the default into three layers:
  1. three strong “Do this” options;
  2. one chronological/filtered list;
  3. saved/planned state.
- Keep specialty shelves behind explicit intents.
- Globally canonicalize/dedupe the page.
- Put the swipe tuner behind an optional “Tune my picks” action until its lift is measured.

### P1-05 — Onboarding asks for labor before proof

The primer is skippable, but it is the default gate. It says “3 taps” while the happy path requires more interactions across tour, categories, money, timing, and finish. Categories are capped at three, but extra choices remain enabled-looking and simply no-op. The user then sees another taste tuner on Events and Spots.

**Fix**

- Let the user browse immediately.
- Ask one optional intent question at most, such as “Tonight, this weekend, or explore?”
- Learn taste from saves/dismissals and request more preferences after value.
- If the three-category cap remains, disable extras with clear visual and accessible feedback.

### P1-06 — Home shows empty planning before immediate local value

Cold users first encounter “Your next days” planning cards. Empty planning scaffolding appears before the app proves what is happening nearby. Weather copy and event metadata truncate heavily at narrow width.

**Fix**

- Lead with “Tonight near Tampa” or the strongest current option.
- Introduce the planning rail after the first save/add.
- Consolidate weather into one compact, scannable module.
- Use content-aware line lengths and card heights rather than forcing all metadata into a dense row.

### P1-07 — Search has misleading loading, context, and count states

Search problems include:

- a spots-originated search still says “Search events”;
- place loading status is ignored, so no-match can appear before the 1.4 MB place artifact finishes;
- the zero state says “1,665 events. One search bar” even though it searches events, places, and guides and many of those events are expired;
- result counts remain total while a narrower tab is selected;
- cards can remain washed out while images load, temporarily hiding useful text.

**Fix**

- Reset to All when the selected scope becomes invalid.
- Preserve and display the entry context.
- Distinguish loading from no results.
- Count actionable results in the active scope.
- Keep text immediately visible; do not make card legibility depend on image completion.
- Load the place index only when required by query/scope.

### P1-08 — Spots is a large, thin directory with no clear advantage

Tampa’s 2,163 place rows are 61.2% parks and include 78 Starbucks. Only:

- 6.4% have images;
- 5.5% have descriptions;
- 24.5% have hours;
- 47.3% have a URL;
- 63.6% have an address.

SF has 2,888 similarly thin rows, including junk-like numeric or lot names. Across both cities, Wuzup is offering about 5,051 place records without the reviews, ratings, reliable live hours, native routing/navigation, rich photos, synced lists, or collaboration users expect from Google Maps. Place detail does offer a Directions button, but it delegates the user to Google Maps.

The current UI hides this weakness with attractive category art and confident labels. That makes the trust problem worse.

**Recommendation**

Choose one:

1. **De-emphasize Spots** until the event/planning wedge works; or
2. Replace the broad directory with a small verified corpus containing actual reasons to go, amenities, access, fees, hours confidence, local notes, and strong imagery.

Do not compete on raw place count.

### P1-09 — “Open now” is not reliable enough to publish

isOpenNow ignores day-of-week schedules, uses the viewer device time rather than city time, heuristically parses one free-form range, and hardcodes daylight/sunset-like hours. Of 2,163 Tampa places, only 529 have any hours data, often unstructured.

The live Open Now page claimed 461 places and “picked fresh for you,” but entries did not consistently show a trustworthy status or closing time.

**Fix**

- Normalize structured weekly hours with city timezone and exception dates.
- Show “Open until X” only at high confidence.
- Otherwise say “Hours unavailable” or omit the claim.
- Never make “Open now” a primary browse mode from low-confidence input.

### P1-10 — Guides are filters presented as editorial work

Most evergreen guides are broad category/keyword selectors: beaches, markets, rainy-day categories, date-night categories. “Sports bars” includes event keyword matches because the product lacks proper bar data. The sole dynamic World Cup guide is a substring search and produced false/weak matches.

A credible guide needs:

- a scoped promise;
- an author or transparent selection method;
- a reason each item belongs;
- evidence/freshness;
- an ordering rationale;
- a useful plan.

Until those exist, call these “collections” or “filters,” not guides.

### P1-11 — The planner overwhelms rather than composes

The tested day page showed 64 add suggestions and 137 buttons. It repeated the already planned concert and a near-duplicate, while presenting generic recommendations as weather-based. The reference plan mockup showed only two varied suggestions and was materially clearer.

**Fix**

- Return 3–6 complementary suggestions, not dozens.
- Optimize the whole day: time, distance/travel, open hours, meal gaps, weather, budget, and category variety.
- Explain each recommendation in one honest sentence.
- Exclude planned/canonical duplicates.
- Make “more options” an explicit expansion.

### P1-12 — Navigation is not shareable or durable

The URL intentionally does not represent tab/detail state. Refresh does not restore the detail/page, browser history is synthetic, and an event or place cannot be bookmarked as an app route.

This removes the most natural acquisition loop: “send this event/plan to a friend.”

**Fix**

- Give event, place, guide, and plan views durable URLs.
- Make browser back/forward truthful.
- Add shareable read-only plan links or a compact encoded/exported plan.
- Preserve privacy by making sharing explicit, not by making URLs impossible.

### P1-13 — Durable user value is device-local and incomplete

The no-account stance is a valid product choice and can be a strength. The current implementation, however, offers no full export/import. Clearing site data or changing device loses saves, taste, plans, history, and profile. Export covers only self-added events.

**Fix**

- Add one-versioned export/import covering all user state.
- Warn clearly about device-local durability.
- Decide later whether optional encrypted or account-backed sync is necessary.
- Do not say “nothing leaves this phone” while weather, remote images, source links, and other network requests do leave it.

### P1-14 — Geolocation state can be false and repeatedly nag

The preference is persisted before permission success. A denial can leave the feature appearing enabled, and boot can request it again. The request has no explicit timeout. Settings says the app asks once, which is not guaranteed by the implementation.

**Fix**

- Separate desired, requesting, granted, denied, and unavailable states.
- Persist enabled only after success.
- Never re-prompt after denial without an explicit user action.
- Explain the current browser permission and recovery path.

### P1-15 — User-added event management is incomplete

A user can add an event but cannot edit it from detail; only remove it. Deduping is silent while AddEvent always reports success. City is not part of the custom-event schema/state.

**Fix**

- Add edit/duplicate detection and city ownership.
- Preserve imported/manual provenance.
- Confirm the chosen plan date/daypart.
- Include custom events in complete export/import.

### P1-16 — Support and correction flows are placeholders

HelpFeedbackPage routes FAQ, support, report, feature request, and feedback rows to the same placeholder mailto address. There is no structured “wrong time,” “canceled,” “duplicate,” or “closed” report carrying item ID/source context.

For scraped/aggregated inventory, corrections are core trust infrastructure.

**Fix**

- Establish a monitored endpoint/inbox.
- Add item-level correction actions with ID, source URL, city, and problem type.
- Feed correction rate into source health and ranking confidence.

### P1-17 — Privacy language and network behavior do not match

Settings says “Everything lives on this phone — no account, nothing leaves it.” User state is local, but the app still makes weather/data requests, loads remote images from roughly 13 external domains, and sends users to source sites. Remote images lack a consistent referrerPolicy and there is no content security policy.

**Fix**

- Say exactly what stays local and what network requests occur.
- Add a privacy/data-flow page.
- Self-host or cache imagery only where licensing and source terms permit. Otherwise use referrerPolicy=no-referrer, tight CSP allowlists, reliable fallbacks, and accurate disclosure.
- Add a restrictive CSP compatible with the required sources.
- Keep the strong no-tracker/no-account intent, but make it accurate.

### P1-18 — Performance front-loads data the user may never need

Measured artifacts:

- events.json: about 1.566 MB raw and roughly 256 KB gzip;
- places.json: about 1.413 MB raw;
- CSS: about 132 KB raw / 23 KB gzip;
- vendor JS: about 190 KB raw / 60 KB gzip;
- app JS: about 255 KB raw / 71 KB gzip.

Initial code is roughly 154 KB gzip before the event artifact. Search can trigger the entire place index immediately. Routes are not split.

**Fix**

- Publish a small ranked “now” index and fetch fuller results on demand.
- Lazy-load Search, Plan, Profile, guides, and place data.
- Partition or query place data rather than shipping all records.
- Keep card text independent from image loading.
- Measure low-end mobile on a constrained network, not only desktop localhost.

### P1-19 — Accessibility needs a system-level pass

Beyond the invisible-page P0:

- the bottom nav exposes active state visually only;
- calendar days are announced as bare numbers, not full dates/states;
- single-letter weekdays and an aria-hidden legend remove meaning;
- pseudo-listbox month control lacks expected keyboard behavior;
- save controls are interactively nested inside clickable cards;
- several sheets lack focus placement/trap/return;
- toasts and state changes are not live regions;
- validation errors do not move focus;
- there is no consistent focus-visible system;
- inputs remove native outlines;
- token comments acknowledge small-text contrast near 3.23:1 and 2.88:1;
- several controls/text labels are very small, and the taste-tuner dismiss control is only about 26 × 26 px.

**Fix**

- Treat WCAG 2.2 AA as a release gate.
- Build shared primitives for Page, Dialog/Sheet, Toast, Tabs/Nav, Chip, Calendar, and Card-with-actions.
- Add axe plus keyboard-focused Playwright journeys.
- Complete a manual VoiceOver/NVDA pass.

### P1-20 — City selection is a build/route property presented as a preference

Tampa and SF are separate build paths; there is no in-app city switcher or coverage browser. Edit Profile nevertheless displays a static “Preferred city,” implying a choice the user cannot make. This is awkward for travel, moving, or simply discovering whether another area is covered.

The label “SF & East Bay” also exceeds the configured geographic promise: the finder explicitly covers the SF-to-Walnut Creek/Concord corridor and excludes San Jose and the North Bay. Users outside that corridor can reasonably assume broader Bay Area coverage than exists.

**Fix**

- For the two-city pilot, add an explicit coverage/city selector that preserves isolated state.
- If runtime switching is not intended yet, label the field “Current coverage area” and link to a clear coverage explanation/waitlist.
- Do not call build-time configuration a user preference.

### P1-21 — Expansion economics are undefined

Daily refreshes, brittle source adapters, quality enrichment, correction support, image handling, and city-specific operations have continuing cost. The roadmap parks monetization while discussing 50–300 cities, but multiplying the current pipeline without a sustainability model would either degrade freshness or force a later business model that conflicts with the privacy/trust position.

**Fix**

- Estimate per-city ingestion, review, support, storage, and failure-recovery cost.
- Define a trust-compatible business model before geographic expansion.
- Preserve a hard separation between ranking and paid placement.
- Treat operational quality as a funded product capability, not free infrastructure.

## P2 findings: visible polish and completeness debt

### UI/visual issues by surface

#### Global and desktop

- The phone-width visual language is polished, but #root is capped around 460 px. On a 1440 px screen, enormous empty black gutters make the app look like a prototype embedded in a page.
- The app must choose: explicitly be a mobile/PWA-only product and communicate that, or support a real tablet/desktop layout.
- Repeated white rounded cards, similar overlines, and large inter-section gaps cause sections to blur together.
- Wuzup’s brand identity largely disappears after onboarding; Home begins with a generic greeting.

#### Onboarding

- The primer is aesthetically good but too long before value.
- “Five tabs, one bay” explains the information architecture rather than the user outcome.
- The “3 taps” claim is inaccurate.
- Category cap feedback is unclear and inaccessible.

#### Home

- Weather and metadata truncate on a 390 px screen.
- Empty planning cards come before discovery.
- “Top pick” quality is undermined by examples such as a hospital grand opening.
- Compared with the reference home, the current page is denser, less editorial, and lacks an obvious “see all” hierarchy.

#### Events

- The large swipe tuner blocks the core feed.
- The horizontal filter row clips at the right edge with little overflow affordance.
- Small cards compress title, venue, date, heart, and Add controls into too little width.
- Directly observed duplicate listings:
  - “Chicago and Styx” at MidFlorida Credit Union Amphitheatre;
  - “Chicago & Styx – Windy Cities 2026 Tour” at Florida State Fairgrounds;
  - same date/time, shown as 7–7 PM.
- A zero-duration 7–7 PM label is nonsensical and should fail ingestion/display validation.

#### Search and detail

- Search result cards briefly wash out while imagery loads, making the whole result feel disabled.
- Addresses can repeat or misorder locality, such as “..., US, Tampa, FL.”
- Aggregator links can be labeled “Official event page.”
- “Why this fits: 2 local sources list it” can treat aggregator duplication as local validation.
- After planning an item, the primary detail action does not switch to the planned state.

#### Spots

- The same “Find your night by swiping” language appears for parks/places.
- A large tuner and activity grid push actual recommendations down.
- “Recommended near you” appears without location.
- Raw data leaks into detail, including typos, “8 USD,” free-form hours such as “08:00-sunset,” and generic “Details inside.”
- Entering through Open Now does not consistently show the open-until evidence a user needs.

#### Plan and My Plans

- The navigation tab is “Plan,” but the page title is “Calendar.”
- Home and Calendar/Plan reuse the same upcoming-days component, so the Plan tab duplicates planning content already shown on Home instead of clarifying a distinct task.
- Single-letter weekday headers and number-only date buttons are visually cramped and inaccessible.
- Suggestions repeat planned items and use unjustified weather language.
- The page offers dozens of options instead of composing a day.
- My Plans is blank for the most important state: a current/future plan.

#### Profile and Settings

- Profile looks polished, but its Settings description promises “Account, notifications...” despite there being no account and no meaningful notification controls.
- Edit Profile stores a bio that Profile does not display.
- “Profile visibility coming soon” introduces a social/account concept the product does not otherwise support.
- Notifications are a derived list rather than a real push/read-state system.
- The location toggle lacks switch/pressed semantics.
- Credits are a positive transparency surface, but they visibly reveal the source concentration and 6.4% place-photo coverage.

### Small-but-real content/UI defects

- “No plan...” and other key copy truncate too early.
- Some active tab labels are only 11 px; other stats/credits drop to 8–10 px.
- Filters overflow without a clear scroll affordance.
- Add buttons crowd the card and compete with the card itself.
- Page heading hierarchy is inconsistent; some main views lack an h1.
- The Help page presents repeated mail links as if they were distinct support features.
- Remote/cached weather can be stale without a max-age label; this is treated as a failure-state trust issue above.
- Guide date-window logic has an end-boundary issue.
- ICS line folding counts UTF-16 characters rather than RFC byte length.
- Non-atomic finder writes and non-failing benchmark thresholds increase operational risk.
- There is no service worker. The app has manifest/icons but an installed app is not offline-capable.

## Feature maturity scorecard

Scores are intentionally adversarial: 1 means the feature exists mostly as a shell; 5 means it is trustworthy and differentiating.

| Capability | Score | Assessment |
|---|---:|---|
| Event discovery | 2/5 | Broad enough to demo, but stale, repetitive, weakly ranked, and over-shelved. |
| Event search/filter | 1.5/5 | Search UI is pleasant; counts, loading, scope state, and combined filters can be wrong. |
| Event detail | 3/5 | One of the stronger surfaces visually; source authority, address cleanup, sharing, and planned state lag. |
| Spots | 1/5 | Large directory with very thin records and unsupported recommendation claims. |
| Open Now | 1/5 | Published confidence exceeds the hours/timezone implementation. |
| Planning/day composition | 1.5/5 | Strong product idea; quick-add semantics, duplicates, suggestion volume, and My Plans break the contract. |
| Calendar | 2/5 | Visually coherent, but IA and accessibility are underdeveloped. |
| Saves/history | 2/5 | Useful local behavior; portability, identity stability, and cross-city isolation are missing. |
| Personalization | 1.5/5 | Taste inputs exist, but ranking evidence and demonstrated lift do not. |
| Guides | 1/5 | Mostly rule-based collections presented as editorial guides. |
| Sharing/deep links | 0.5/5 | Source links exist; app state and plans are not durably shareable. |
| Notifications | 0.5/5 | A display surface without real delivery, settings, read state, or timestamps. |
| User-added events | 2/5 | Creation exists; editing, duplicate truth, city scope, and full export do not. |
| Multi-city | 1/5 | Build-time variants exist, but state isolation, data parity, and coverage quality do not. |
| Offline/installability | 1/5 | Manifest only; no service worker or offline recovery. |
| Accessibility | 1/5 | Several component issues plus a system-level hidden-page focus defect. |
| Operational freshness | 1/5 | Weekly human-merge refresh and false timestamps are incompatible with the promise. |
| Visual design | 3.5/5 mobile; 1.5/5 if desktop is in scope, otherwise unsupported | Good phone prototype; hierarchy/density issues and no desktop composition. |

## Data-quality audit

### Events

Current bundled Tampa artifact observations:

| Metric | Count | Implication |
|---|---:|---|
| Total rows | 1,665 | Advertised as inventory even though a large share is expired |
| Ended before the July 14 Tampa calendar day | 717 | At least 43.1% payload waste / false breadth; same-day expirations add more |
| Date-only starts | 536 | Weak for daypart planning |
| Missing end | 441 | Requires careful default semantics |
| Start equals end | 185 | Produces zero-duration labels such as 7–7 PM |
| Missing image | 87 | Better than places, but image presence currently over-rewards rank |
| Missing description | 54 | Usually actionable, though quality varies |
| Missing venue | 34 | Decision field gap |
| Missing address | 19 | Decision/travel gap |
| Unknown free state | 577 | Price claims/filters are incomplete |
| Missing price | 644 | Cost planning is unreliable |

Source distribution in the 1,665-row bundled artifact:

| Source | Rows |
|---|---:|
| Hillsborough Libraries | 888 |
| Eventbrite | 209 |
| Visit Tampa | 174 |
| Visit St. Pete/Clearwater | 137 |
| AllEvents | 76 |
| Meetup | 33 |

The newer current-day-or-future analysis is more important for launch gates: Tampa is 59.9% Hillsborough Libraries; SF is 89.0% AllEvents + UC Berkeley + Eventbrite. This is not diversified local coverage.

SF is also not decision-ready for the planning promise. Among its 527 current-day-or-future rows:

| Missing/weak decision field | Count / share |
|---|---:|
| Date-only, with no actionable time | 400 / 75.9% |
| Unknown price/free status | 445 / 84.4% |
| Missing coordinates | 127 / 24.1% |
| Missing address | 167 / 31.7% |
| Missing description | 196 / 37.2% |

Tampa is materially better but still has 33.7% date-only and 34.1% price-unknown rows in its current-day-or-future set. City #2 should not be expanded into city #3 until this gap is closed or the product clearly labels limited-detail listings.

### Places

Tampa place artifact:

| Metric | Count / share |
|---|---:|
| Total rows | 2,163 |
| Parks | 1,323 / 61.2% |
| Cafes | 332 |
| Boat ramps | 202 |
| Images | 139 / 6.4% |
| Descriptions | 119 / 5.5% |
| Hours | 529 / 24.5% |
| Addresses | 1,376 / 63.6% |
| URLs | 1,024 / 47.3% |

SF is similarly sparse, with only about 6.1% images, 4.5% descriptions, 21.4% hours, 28.7% URLs, and 42.1% addresses. A large catalog magnifies incomplete data; it does not create a recommendation product.

### Proposed city launch gates

A city should not be called launched until it meets all of these:

- at least 10 independent active source families;
- no source family above 35% of decision-ready cards;
- less than 0.5% expired rows visible at render and less than 5% expired rows in the publish artifact;
- at least 80% have an actionable date/time or explicit all-day status;
- at least 80% have a decision-ready location;
- at least 70% have known price/free status;
- less than 2% severe date/category/location errors in a weekly human sample;
- 100% recommendation rows have a healthy source link or explicit first-party record;
- no “best,” “favorite,” “gem,” or “open now” claim without its required evidence;
- full artifact hash, quality report, and source health approved by CI.

## Engineering and delivery audit

### What passed

- Production build passed.
- Lint passed.
- The available dependency audit reported zero known advisories.
- External links generally use noreferrer.
- The finder includes timeouts, cache behavior, a user agent, and fails closed on unknown city.
- Manifest paths and multi-base build behavior have meaningful tests.
- The pure-function/schema smoke suite is broad for a project at this stage.

### What failed or is missing

- npm test failed 1 of 126 checks after roughly 110 seconds. The live fast-finder run produced zero events at buzz score 2 or higher, while the full finder had qualifying results. This may be source variance, reduced-mode coverage, or a pipeline regression; the audit did not establish which. A red main test suite is a release stop.
- The suite is one very large browserless smoke file with several source-regex/seam assertions.
- There is no real end-to-end coverage of the core user journeys, accessibility, multi-city state, device timezones, corrupted storage, network failure, or deployed artifact identity.
- There is no ErrorBoundary.
- Routes are not split.
- Event/place fetches lack consistent abort/timeout/retry behavior.
- Service worker/offline support is explicitly absent.
- Finder writes are not fully atomic and performance benchmarks do not enforce failure thresholds.
- Deployment stages city artifacts sequentially, making mutable-byte mistakes easier.

The fast/live check should be investigated, not weakened. If source variance makes it nondeterministic, use deterministic fixtures for the release assertion and retain a separate live-source health monitor.

### Minimum release suite

1. **Artifact contract**
   - schema, generatedAt, hash, source health, expiry, duplicates, range plausibility, and decision-field completeness;
   - exact production bytes for every city.
2. **Core browser journeys**
   - first visit/skip;
   - filter combination;
   - search event and place;
   - add event to a chosen date/daypart;
   - see it on Day, Calendar, Profile count, and My Plans;
   - save/share/remove;
   - city switch/isolation.
3. **Failure journeys**
   - offline, timeout, 404, invalid JSON, stale cache, storage quota, malformed storage.
4. **Time journeys**
   - device in city timezone and three non-city timezones;
   - DST transition;
   - all-day, timed, open range, exact end, and exported ICS.
5. **Accessibility**
   - automated axe;
   - keyboard traversal;
   - focus return;
   - hidden-page inert check;
   - calendar names/states;
   - live regions.
6. **Responsive visual checks**
   - 320, 390, 768, and 1440 px;
   - no clipped filters, illegible cards, or giant unused desktop gutters.

## Visual verdict against the project’s own references

The reference PNGs are more restrained overall, especially on Events and Plan:

1. **Immediate value:** the Events and Plan references reach stronger content sooner; the Home reference shares the current planning-first hierarchy problem.
2. **Editorial restraint:** references show fewer, larger, more deliberate choices; current pages show more shelves and controls.
3. **Information hierarchy:** references allow title, image, time, and distance to breathe; current cards compress metadata and truncate.
4. **Plan composition:** the reference plan offers two varied suggestions; the current plan can offer 64, including duplicates.

The right response is not to copy the reference styling more literally. The right response is to recover its restraint.

Keep:

- the warm palette;
- rounded but not cartoonish surfaces;
- strong detail-page image treatment;
- compact bottom navigation;
- friendly, non-corporate tone;
- privacy-forward intent.

Change:

- content before configuration;
- three strong choices before catalogs;
- fewer card grammars and fewer shelves;
- responsive desktop/tablet composition;
- larger readable metadata and touch targets;
- honest labels instead of premium-sounding heuristics.

## Competitive reality

Wuzup should assume that users already have substitutes:

- [Eventbrite’s current product](https://www.eventbrite.com/blog/press/newsroom/eventbrite-launches-reimagined-app/) offers personalized discovery, curated lists, listing details, friends/shared saves, and tickets.
- [Meetup](https://www.meetup.com/about/) owns the community/host/group layer rather than merely listing happenings.
- [Google Maps saved lists](https://support.google.com/maps/answer/7280933?hl=en-GB) and [Timeline/location features](https://support.google.com/maps/answer/9948049?hl=en-gb) provide mature place data, directions, account sync, sharing, and collaboration.
- [Wanderlog](https://app.wanderlog.com/) competes on itinerary building, maps, route optimization, offline access, and collaboration.

Trying to match all four creates an expensive, undifferentiated product.

### A more defensible position

Wuzup can own the layer those products do poorly:

- normalize fragmented local calendars;
- remove canceled, duplicate, stale, and low-confidence results;
- connect an event with a meal/spot and realistic timing;
- explain why three options fit this user tonight;
- produce a compact plan that is easy to save or share;
- do this with minimal profiling and transparent data handling.

The product should be optimized for **decision completion**, not catalog exploration.

Suggested promise:

> Tell Wuzup when, budget, and vibe. Get three trustworthy options and a workable local plan in under a minute.

## Recommended immediate roadmap

### Phase 0 — Release blockers (milestone-gated)

- Make CI approve and deploy the exact immutable city artifact hashes.
- Fix My Plans rendering.
- Fix combined filters.
- Fix Search’s stale-scope blank-results state.
- Make inactive pages and covered layers inert; repair focus.
- Add ErrorBoundary and recoverable fetch/storage states.
- Replace Last-Modified freshness with generatedAt.
- Filter ended events from all current counts/surfaces.
- Fix city-scoped storage with migration.
- Establish the canonical city-time/date model and correct ICS.
- Stop publishing low-confidence Open Now and “near you” claims.
- Repair the red test.

**Exit gate:** every P0 has an automated regression test.

### Phase 1 — Data quality and source health (next milestone)

- Immutable per-city manifest and deploy hashes.
- Daily refresh and source-level health/SLOs.
- Recurrence/range normalization.
- Canonical duplicate/series identity.
- Decision-field confidence tier.
- Source diversity and concentration report.
- Per-item correction/reporting flow.
- City-time schema and ICS correction.

**Exit gate:** Tampa and SF meet the city launch gates or are honestly labelled limited coverage.

### Phase 2 — Rebuild the hero loop (week 2–3)

- Browse-first onboarding.
- Home starts with immediate local value.
- One decisive event feed rather than a shelf zoo.
- Three-option intent response.
- Confirmed date/daypart plan add.
- 3–6 complementary planner suggestions.
- Planned-state CTAs and no duplicates.
- Durable event/place/plan routes and share.
- Full export/import.

**Exit gate:** a new user can go from first render to a visible, shareable plan in under 60 seconds without encountering a false claim.

### Phase 3 — Accessibility, responsive UI, and performance (week 3–4)

- Shared accessible navigation/dialog/calendar/toast primitives.
- WCAG 2.2 AA pass.
- 320–1440 px responsive layouts.
- Route/data splitting and place-index deferral.
- Content remains readable while images load.
- Copy/capability audit.

**Exit gate:** keyboard, screen-reader, low-end mobile, and desktop journeys pass.

### Phase 4 — Controlled beta and measurement

Use privacy-preserving product-health measurement or explicit research sessions. The current V2 stance against telemetry leaves the team unable to distinguish taste from failure.

Measure:

- time to first credible option;
- time to first save/plan;
- plan revisit and share rate;
- source-link success;
- correction/bad-result rate;
- empty/no-result searches;
- duplicate exposure;
- planner completion/follow-through;
- seven-day repeat use;
- city/source freshness SLO.

Only after repeat usage and trust SLOs are proven should the team revisit richer personalization, premium UI, place expansion, or new cities.

## Prioritized builder backlog

| ID | Priority | Work item | Suggested owner | Acceptance signal |
|---|---|---|---|---|
| A01 | P0 | Immutable generatedAt + city artifact manifest | Data/platform | UI-only deploy preserves data date |
| A02 | P0 | CI/deploy production-byte identity | Platform | Post-deploy hash equals approved hash |
| A03 | P0 | Global city-time actionable/ended predicate | Data/app | Zero ended items in current surfaces |
| A04 | P0 | Render future/current items in My Plans | App | Add-to-plan E2E sees exact item |
| A05 | P0 | Confirmed plan slot + planned-state CTA | Product/app | No silent fallback or duplicate success |
| A06 | P0 | City-scoped storage and stable-ID migration | App/data | Tampa/SF state isolation test passes |
| A07 | P0 | Canonical timezone/date/ICS model | Data/app | Cross-timezone and DST suite passes |
| A08 | P0 | True multi-dimensional filters | App | Three-way filter test passes |
| A09 | P0 | Inert/focus architecture for tabs/subpages | App/a11y | Only visible controls are tabbable |
| A10 | P0 | ErrorBoundary, fetch recovery, storage schemas | App | Failure matrix remains recoverable |
| A11 | P0 | Reset invalid Search scope and render truthful state | App | Query change cannot report results over a blank body |
| A12 | P1 | Daily refresh + source health SLO | Data/platform | Stale artifact blocks deployment |
| A13 | P1 | Recurrence/series canonicalization | Data | Repeated series becomes one choice |
| A14 | P1 | Source diversity/confidence gates | Data/product | Flagship feed meets launch thresholds |
| A15 | P1 | Rename unsupported recommendation claims | Product/content | Every claim maps to evidence |
| A16 | P1 | Simplify Events to ranked options + one list | Product/design | No repeated canonical item on page |
| A17 | P1 | Browse-first onboarding | Product/design | Useful content before preference labor |
| A18 | P1 | Home immediate-value hierarchy | Product/design | Strong option above empty plans |
| A19 | P1 | Search loading/context/count correctness | App | Loading never masquerades as no results |
| A20 | P1 | Structured hours or remove Open Now | Data/product | Every open claim has weekly-time evidence |
| A21 | P1 | Re-scope Spots to verified corpus | Product/data | Directory size is not the success metric |
| A22 | P1 | 3–6 complementary plan suggestions | Product/app | No planned/duplicate recommendation |
| A23 | P1 | Durable routes and sharing | App | Detail/plan survives refresh and can be sent |
| A24 | P1 | Complete export/import | App | Round-trip all user state |
| A25 | P1 | Geolocation permission state machine | App | Denial never appears enabled/re-prompts |
| A26 | P1 | Truthful runtime city/coverage selection | Product/app | “Preferred city” represents a real choice |
| A27 | P1 | Item correction/support workflow | Product/ops | Reports include ID/source/problem |
| A28 | P1 | Privacy/data-flow truth + CSP/referrer policy | App/legal | Settings matches observed network behavior |
| A29 | P1 | Route/data splitting | App | Places not loaded before needed |
| A30 | P1 | Accessible nav/calendar/sheets/toasts | Design/app | WCAG/keyboard/SR release suite passes |
| A31 | P1 | Define sustainable per-city operating model | Product/business | Expansion budget preserves trust and ranking independence |
| A32 | P2 | Responsive desktop/tablet shell | Design/app | Intentional 768/1440 compositions |
| A33 | P2 | Card density/truncation/touch targets | Design | 320 px content remains readable |
| A34 | P2 | Normalize address/price/hours display | Data/app | No US/Tampa ordering or “8 USD” leaks |
| A35 | P2 | Replace placeholder Help/Notifications copy | Product | No capability promised without feature |
| A36 | P2 | Real guide editorial model or rename | Product/content | Each guide has rationale/freshness |
| A37 | P2 | Offline strategy | Product/app | Either useful offline shell or no resilience claim |

## What is worth preserving

This audit is intentionally adversarial, but the project has real strengths:

- The mobile visual system is coherent and friendly.
- Event and place detail pages are better resolved than many surrounding flows.
- The product instinct—combine events, places, weather, and planning—is more differentiated than another event list.
- The privacy/no-account instinct can become a genuine positioning advantage.
- The source finder has thoughtful fundamentals such as timeouts, caching, user-agent behavior, and city validation.
- Build and lint are clean.
- The smoke suite already contains substantial pure/schema coverage.
- The reference designs point toward the correct level of editorial restraint.
- Credits make source composition visible instead of hiding it.

The best next version is not a rewrite. It is a ruthless narrowing that makes the existing promise true.

## Audit method and limitations

This report was produced from:

- repository and planning-document review;
- source-level inspection across app, finder, tests, workflows, and city configuration;
- production build, lint, test, and dependency-audit execution;
- live mobile and desktop walkthroughs of onboarding, Home, Events, Search, event detail, Spots, Open Now, place detail, Plan/Calendar, Day, My Plans, Profile, Settings, and Credits;
- comparison with the repository’s reference screenshots;
- direct event/place artifact profiling;
- source/freshness/workflow inspection;
- accessibility review of DOM architecture, keyboard/focus semantics, calendar, sheets, live updates, contrast, and touch targets;
- official-product comparison for Eventbrite, Meetup, Google Maps, and Wanderlog.

Important limitations:

- This was an adversarial expert audit, not a substitute for interviews or observed usability sessions with target Tampa/SF users.
- Source inventories change over time; the exact counts are a July 14, 2026 snapshot.
- The working tree contained pre-existing, concurrent changes. This document does not claim those changes were created by the audit.
- No destructive production action was taken.

## Final direction in one sentence

**Stop expanding the catalog and start proving the decision: three truthful choices, one workable plan, under a minute.**
