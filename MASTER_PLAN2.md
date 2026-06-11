# MASTER PLAN 2 — From "great prototype" to "an app people actually use"
_v1 · 2026-06-11 · Fable driving, Josh + Charles supporting. Picks up immediately after Sprint N._
_Supersedes MASTER_PLAN.md as the active roadmap (that document closes when N ships; its "NEXT INITIATIVES" section is absorbed here). Branch: autonomous-dev-pt2. Execution contract unchanged: each sprint = multi-agent workflow → adversarial review → Fable hand-verification → `npm test` (from Sprint M) → push. Concise updates; pause only at ⚑ flags._

---

## 0. CONFIRMED DECISIONS (the 2026-06-11 brainstorm, ratified by Josh + Charles)
1. **Five tabs:** Events · Locations · Map · Calendar · Profile. Each owns one question: *what's happening / what's always here / where / when / who am I here.*
2. **Swipe is scoped, not primary:** a **calibration deck** (settings) + an optional **finite Deck mode** on lists. Endless scroll stays for grazers; the deck serves deciders. Every swipe feeds the taste engine — rejection finally means something.
3. **Locations = Hot's structural twin** (hero, place-bubbles, sections, detail pages) with **"Make this my plan"** bridging into Weekend Builder.
4. **The interview lives in Profile → Settings; home stays ungated.** Primer stays short at first-open; the full interview + calibration deck are re-entry depth. FMN remains the in-the-moment layer.
5. **Sequencing: Profile + tab restructure first** (fast, visible, restructures navigation for everything after), **then the Places pipeline** behind it.
6. The Diaby principle (north-star vibe): *"without this app, how else would you know?"* Every ranking/visibility decision optimizes for surfacing that class of thing — for events AND places.

## 1. WHAT "AN APP PEOPLE ACTUALLY USE" REQUIRES (the engineering-honest gap list)
Beyond features, shipping requires: **(a) availability** — it runs somewhere that isn't Josh's PC, with data that refreshes without a human; **(b) trust** — no stale lies, no broken images, honest labels, fast on a mid phone over LTE; **(c) a retention loop** — reasons to come back Tuesday (taste that improves, plans that live here, the weekend ritual); **(d) feedback circuits** — users can tell us when an event is wrong; we can see what's failing; **(e) hygiene** — accessibility, cross-browser (iOS Safari!), attribution/politeness for every source, schema versioning, regression tests. Phases 1–3 build the product; Phase 4 builds these.

---

# PHASE 1 — THE RESTRUCTURE (Profile, five tabs, swipe) — ~2 sessions

### Sprint O — Five-tab re-architecture + Profile foundation
*The navigation spine for everything that follows.*
**AUDIT PREP (pre-expansion audit, 2026-06-11 — verdict GO; items in execution order):** ✅ archive-before-prune (saves → 'been-there-v1') and archive-before-overwrite (weekend → 'weekend-history-v1') LANDED same-day (data was being destroyed daily); then in O: (1) de-literalize the four tab-index checks (App.jsx goTo(1)/active===1/active===0 ×2 → id-derived indices) as O1's first commit; (2) **O6 NavContext BEFORE O1/O3** (smaller diff at 3 tabs); (3) dynamic-import Leaflet in DetailPage's mini-map (it's statically pulled into the boot chunk via DetailPage even if MapView lazies — this is what makes the boot-perf assertion real); (4) namespace all ~10 localStorage keys (twh: prefix + one-shot migration — GH Pages shares origin across repos, do it while the user count is 2); (5) two new tab Icons + the tab-hot special-case touches ⚑O1; (6) primer inert covers only the pager — extend to tabbar/FABs while rebuilding the bar; (7) one canonical category registry (BUBBLES/HUES/EMOJI/Primer CATS are 4 copies today) before S1 adds place classes.
**Phase-2 schema decision (write into R2 before places.mjs):** places get kind:'place' + a singular category mapped into the 12-category taxonomy + prefixed keys ('p|' in keyOf) — the one choice that keeps cards/search/taste/saves un-forked. places.json = second lazy fetch on first Locations visit; do NOT concat into norm.
**Orphans slotted (audit lens 2):** iOS first-save jolt → X1 checklist · FMN daytime-tonight thinness → T4 (places answer thin nights) · WB picker chips → owner decision at O5 · price-coverage probe + price-semantics labeling → real slot in Phase 2 data work (40% of events have unknown price) · library-share watch → V4's metric asserts family share in top-N numerically · 'other' benchmark ratcheted 60→40 (landed) · W3 sleeper: 6h-cron commits ≈1.7GB/yr of git history — plan an orphan data branch or artifact hosting when W3 lands.
- **O1 Tab bar v2:** five tabs. Pager grows to five pages with **lazy mounting** (only visited tabs mount — MapView's pattern generalized; Events eager, rest on first visit). Perf assertion in the smoke harness: boot renders ≤ what today's three-tab boot renders.
- **O2 Tab naming** ⚑FLAG-O1: "Hot" → "Events"? (Josh: "home page should be the events page.") Locations tab label ("Spots"? "Places"? "Around"?). Charles names them — build with placeholders Events/Spots, swap on his word.
- **O3 Profile shell (Josh's B1 track):** taste-identity first — a "your vibe" header derived from the live taste profile (top categories as bubble-chips, free-leaning badge, when-you-go-out), NOT settings-first. Sections: **Your list** (saved, full page — the shelf graduates here too), **Your plans** (Weekend Builder relocates here + plan history), **Been there** (attended — see O4), **Recently viewed**. Empty states with charm (a new profile should look inviting, not barren).
- **O4 "Been there" mechanic** ⚑FLAG-O2: we can't know attendance without accounts — proposal: saved events that have passed get a one-tap "I went 🎉 / missed it" prompt on the profile; "went" events build the history + feed taste (+2 category). Confirm the mechanic (it's honest — self-reported, zero tracking).
- **O5 Weekend Builder relocation** (entries: Profile primary, calendar header stays, Saved-shelf button follows the shelf to Profile; HotView keeps a slim "Your list ❤️ → Profile" pointer rail).
- **O6 Shell hygiene (engineering):** App.jsx state has outgrown prop-drilling — extract a light NavContext (page/subpage/detail控制) + move the subpage union there. No behavior change; the smoke harness guards it.
- DoD: five tabs live, profile renders all four sections from real local data, WB fully functional from Profile, build/lint/test green, all surfaces verified live.

### Sprint P — Settings & the calibration deck (Charles's B2 track)
- **P1 Settings page** (inside Profile): display-mode toggle finds its real home (the floating 🎨 pill retires), primer re-entry ("Tune your taste" — finally), data freshness line ("events updated {when}"), about/credits stub (Phase 4 fills it), reduced-motion respect note. NO email/account fields — nothing to configure that we don't have.
- **P2 The full interview:** the primer's grown-up sibling — 6–8 questions in the same one-tap style (activity types, indoor/outdoor lean, paid/free, active/chill, solo/social, dayparts) writing weighted taste seeds (documented math, capped like the primer; real taps still dominate).
- **P3 Calibration deck:** "Rate 15 → we dial you in." Full-screen card stack of taste-spanning upcoming events (diverse sampler, not top-N): swipe right = into it (+3), left = not for me (−1, floor 0), up = save it (♥ +3). Progress dots, skippable anytime, ends with "got it — your feed just got smarter" (--reward sanctioned moment #6 ⚑FLAG-P1: confirm) and a visible before/after ("your top vibes: 🎵🌳"). Writes through the existing taste engine ONLY — no second profile store.
- **P4 Negative signal support in taste.js:** the engine currently only adds; the deck needs subtraction (bounded at 0, never filters, decay unchanged). Adversarial review target: a hostile swiper can't poison ordering beyond the ±15 nudge cap.
- DoD: settings real, interview + deck end-to-end, taste math sim-verified (incl. negative bounds), copy inventoried for Charles.

### Sprint Q — Deck mode (the scoped Tinder)
- **Q1 Reusable SwipeDeck component** (pointer-events, no deps; spring-feel transforms within UI_SPEC motion rules; reduced-motion = button fallbacks always visible: ✕ / ♥ / open).
- **Q2 Entry points:** "🃏 Deck this" on Everything day-headers and bubble pages → a **finite** deck ("18 for Friday"), drawn from that exact lens, diversity-interleaved. End card: summary ("kept 4 ♥") + into-the-feed return. Never autoplays, never the default.
- **Q3 Signals:** right = save, left = pass (−1 taste, also FMN-seen so rerolls respect it), up/tap = detail (counts as open). End-of-deck recap is a stopping cue, not a loop — no infinite re-deal (the research's fatigue warning, honored).
- DoD: deck works from both entry points, signal flow verified, fatigue guard (one deck per lens per session unless explicitly re-dealt).

# PHASE 2 — THE PLACES LAYER (the heavy lift) — ~3 sessions

### Sprint R — Places pipeline v1 (data first, UI later)
*The "huge plan" sprint — begins with an in-sprint research scout before any code.*
- **R1 Source research scout:** OpenStreetMap Overpass API (free, the backbone: parks, beaches, trails, courts, dog parks, viewpoints, gardens, piers), Florida State Parks registry, Hillsborough + Pinellas county park directories, SWFWMD preserves, water-access points. Deliverable: verified endpoints + coverage test against the benchmark roster BEFORE building.
- **R2 `finder/places.mjs` pipeline** → `places.json` (separate artifact, schema v1: name, placeType, categories[], lat/lng, address, description, amenities[] [courts/ramps/dog-friendly/free-parking…], isFree, hours?, images?, sources[], hiddenScore). Same engineering standards as events: per-source modules, caching, merge/dedupe (spatial + name), bounded geocoding, benchmarks block, smoke-harness schema asserts.
- **R3 THE BENCHMARK ROSTER (Josh's research — pass by GENERATION, never hardcoding):** Moonlight Beach · Caladesi Island State Park · Fort De Soto · Weedon Island Preserve · Davis Islands dog park beach. Plus rosters to be built for other classes ⚑FLAG-R1: Josh/Charles supply 3–5 names each for courts/rec and urban-basics classes (Riverwalk, Julian B. Lane, Bayshore are the seeds).
- **R4 Hidden-gem scoring for places** (the creative-hard part): proxies for "under the radar" — amenity niche-ness, distance from tourist centroids, OSM tag richness vs. chain/POI-density, absence from mainstream "top 10" lists (inverted popularity). Honest tag like events' gems; capped shelf.
- DoD: places.json with 300+ real places, all 5 nature benchmarks green by generation, hidden-tier defensible, refresh path documented (places change slowly — weekly refresh is plenty).

### Sprint S — The Locations tab
- **S1 Hot's structural twin:** hero (different Tampa image — water/park energy ⚑FLAG-S1 Charles picks), place-bubbles (🏖️ Beaches · 🌳 Parks & trails · 🎾 Courts & rec · 🥾 Nature paths · 🌅 Views · 🐕 Dog-friendly · 💎 Hidden spots · 🆓 Free forever), magazine sections (Near you / Hidden spots / The classics / Free forever), Everything-style browse.
- **S2 Place detail page:** mini-map, amenities chips, free/hours, weather-fit line ("☀️ great beach day Saturday" — the wx map already in App), directions/share/save (saves coexist with event saves — typed), **"Make this my plan"** → Weekend Builder slot picker (place + chosen daypart = a personal plan entry; the place→event bridge, finally real).
- **S3 Taste + places:** category affinities map across (outdoors lover sees trails first); place interactions feed the same profile.
- DoD: Locations tab indistinguishable in polish from Events, benchmarks visible in the UI, plan-bridge works end-to-end.

### Sprint T — Cross-layer integration
- **T1 Map v2:** layer toggle (Events / Spots / both), **filters** (Josh's ask): date strip for events, category chips, free toggle; place pins styled distinctly (square vs round?); clustering handles the union.
- **T2 Search across both** (one search, two result groups); **T3 Weekend Builder place-slots** polish + plan cards render mixed entries; **T4 FMN learns places** ("chill + outdoors" can answer with a sunset spot when tonight's events are thin — honestly labeled "always there, no schedule").
- DoD: the two layers feel like one app, not two glued apps.

# PHASE 3 — DISCOVERY DEEPENING — ~1–2 sessions

### Sprint U — Calendar v2 + the endless-list rethink
- **U1** Calendar absorbs structured day-browsing: week-strip nav, day click-through (prev/next day arrows on day headers — Josh's "shouldn't scroll forever" answered with *chaptered* navigation as the alternative to infinite scroll), month grid keeps heat+weather+saved dots.
- **U2** Everything list gets **day-chapter controls** (jump-to-day, collapse-day) while infinite scroll remains for grazers; Deck mode (Q) is its third lens. The calendar/list overlap finally resolves: list = discovery order, calendar = date order, deck = decision mode.
- **U3** Year-view stub if cheap; else parked.

### Sprint V — Taste engine v2 + transparency
- **V1** Interview/deck/primer weights unified + documented; **V2** profile shows "why your feed looks like this" (the inspectable promise, user-facing); **V3** per-category mute/boost chips in settings (explicit control beats inference — never filters, only ordering, the invariant holds); **V4** recommendation quality benchmark: a sim-able metric (top-20 feed diversity + taste-match rate) asserted in the harness so regressions get caught numerically.

# PHASE 4 — SHIP IT (availability, trust, feedback) — ~2 sessions + Josh gates

### Sprint W — Deploy + PWA + automated data ⚑FLAG-W1 (the Josh-gated sprint, un-parks Sprint F)
- **W1** Static deploy (Netlify/Vercel/GH Pages — Josh picks + creates the free account). **W2** PWA: manifest, icons, installability, offline shell (last events.json cached by a service worker — stale-data banner already exists). **W3 THE BIG ONE — data automation: GitHub Actions cron** runs the finder (Playwright included) on schedule (6h?), commits fresh events/places JSON, triggers redeploy. The app stops depending on any human or any PC. Requires: Actions enabled on the repo (free tier covers it), secrets none (all sources keyless). **W4** Event deep links (#/e/{key}) so Share actually shares a thing that opens.
- DoD: a URL on Charles's phone, installable, with data that refreshes itself.

### Sprint X — Hardening for strangers
- **X1** iOS Safari pass (100svh/safe-areas/backdrop-filter/scroll-snap quirks — real device); **X2** accessibility sweep (focus order, traps, labels, contrast — the AA debt); **X3** attribution & politeness page (every source credited, OSM ODbL attribution REQUIRED once places ship, scraping cadence documented); **X4** failure-mode UX (offline, slow, partial data); **X5** privacy one-pager in-app (everything is local — say it proudly); **X6** dark mode ⚑FLAG-X1 if Charles wants it this phase (tokens make it ~cheap).

### Sprint Y — The feedback circuit + beta
- **Y1** "Something off?" on event/place detail (wrong time/place/dead link → local queue → exportable report; the no-backend version of user feedback feeding data ops). **Y2** Data-ops dashboard: finder writes a health report (per-source counts/failures/benchmark history) as `finder/output/health.md` — reviewed each session. **Y3** Beta: Charles + a handful of friends on the PWA, a feedback capture doc, one week of real usage → the findings drive the next plan. **Y4** Demo-path rehearsal (N's checklist re-run on the five-tab app).

---

## ALWAYS-OPEN LEDGER (workstreams, not sprints)
- **Data quality continuations:** 'other' ≤ 60 → ≤ 40 over time; cltampa CF block retry strategy; do813 dormancy watch; Meetup depth; price coverage experiment; VSPC times expansion beyond top-40; library-share ranking watch.
- **Charles copy pass:** every DRAFT string (primer, FMN, recap, WB, deck, interview) in one sit-down review session — schedule when he's next hands-on. ⚑standing
- **Benchmark roster growth:** every new source/class adds a must-catch; benchmarks never satisfied by hardcoding.

## PARKED (unchanged, conscious)
Accounts + social layer (comments/likes/friends/public counts) · public submissions pipeline (Add-Event's export is the seed) · multi-city + city selection + per-city heroes · native wrap (Capacitor — only if PWA proves insufficient) · monetization/ticketing-in-app · Ticketmaster key (Josh, 5 min, anytime — unlocks arena tier) · year view (unless U3 was free).

## RISKS — NAMED HONESTLY
1. **Places hidden-gem scoring may be genuinely hard** — proxies can misfire (an OSM-rich place isn't automatically "hidden"). Mitigation: benchmark roster + capped shelf + Josh/Charles eyeball the first generation.
2. **OSM data quality varies** (missing hours, stale amenities) — never fabricate; show what's sourced, omit what isn't.
3. **Five-tab perf on weak phones** — lazy mounting is the answer; harness asserts it.
4. **GH Actions + Playwright runtime** (cltampa/VSPC renders in CI) — budget ~10-min runs; cache aggressively; degrade to cached sources on CI flake.
5. **Swipe scope creep** — Deck mode stays bounded by contract; any "make it infinite" impulse goes through Josh+Charles.
6. **Plan size vs. attention** — this document is the single source of truth; MASTER_PLAN.md closes at N; LONG_TERM.md absorbs only true parking.

## FLAG INDEX (the only pause points)
⚑O1 tab names (Charles) · ⚑O2 "Been there" self-report mechanic · ⚑P1 reward moment #6 (calibration finish) · ⚑R1 benchmark rosters for courts/urban classes (Josh) · ⚑S1 Locations hero image (Charles) · ⚑W1 hosting account + Actions enablement (Josh) · ⚑X1 dark mode now-or-later (Charles) · ⚑standing copy pass scheduling.

## SEQUENCE AT A GLANCE
N (in flight) → **O → P → Q** → **R → S → T** → **U → V** → **W → X → Y** → next plan from beta findings.
Ambition over completion: if a Charles session lands mid-phase, we demo from wherever we are — every sprint leaves the app shippable.
