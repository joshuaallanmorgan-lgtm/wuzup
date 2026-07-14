# Wuzup V2 — The Day Engine
### "Give me a Saturday."

> **Plan of record for V2** — synthesized 2026-07-05 by Fable 5 from a 21-agent visioning fleet
> (6 ground recon · 10 visionary concepts · 3 adversarial judges · 2 stress critics; ~1.4M tokens).
> V1 shipped through Stage E; V2 kickoff now depends on the operational/data gates below rather than
> unfinished launch code. Adjudication sheet at the bottom.
> Raw fleet output: workflow `wf_90b6eaba-e15`.

---

## 1. The spine

**V2 in one sentence: Wuzup composes your day, helps you decide it together, and keeps what you did — all with receipts.**

The atomic object of V2 is **the Day** — and its skeleton is already shipped code (DayPage's 3 dayparts,
dayplan.js, the gamify ledger, the deck dealer, the morning-after prompt). Every V2 feature must pass one
admission test, no exceptions:

> **Does this help COMPOSE a day, DECIDE a day, or KEEP a day?** If not, it doesn't ship in V2.

**The stranger test (release acceptance):** a first-time user watches a 30-second demo — one tap, a real
day fills in with real events and real reasons, they flip a card and see the receipts — and says
*"oh, THAT's what this app is."*

**The soul-constraint held:** no fabricated data, ever, presented as real. Every visionary was free to
break any V1 rule; every winning concept instead *weaponized* honesty — receipts, provenance, real-only
stamps. Honesty is the moat; V2 doubles down.

## 2. How the tournament resolved

Ten concepts competed. **The Saturday Engine (concierge lens) was the only concept in all three judges'
top-3** — the uncontested spine. The rest of the verdict:

| Concept | Fate |
|---|---|
| **The Saturday Engine** | **THE SPINE** — Movement I (Compose) |
| **Stamped** + **The Kept City** | Judges' #1s on brand + feasibility — but "the same spine wearing two coats." **Merged into ONE ledger system** — Movement III (Keep) |
| **Both In** (social) | Won user-value. All three judges independently extracted the same piece: **couch-mode pass-the-phone Match Deck** (zero backend). That + shareable day links = Movement II (Decide) |
| **Golden Hour** (live/now) | **Folded into the spine** — the Tonight Board becomes the composer's after-4pm scope on the existing daily snapshot. The hourly "Freshness Engine" is CUT (an ops backend in disguise) |
| **Move-In Day** (craft/PWA) | Re-read as **Layer Zero substrate**, not a concept — PWA, real URLs, on-device notifications feed every other movement |
| **The Regular** (editorial) | **CUT as a workstream** — permanent human editorial labor that doubles per city. Its *claim-compiler + Receipts-Everywhere* survive as a design-system primitive |
| **The Sunlit Atlas** (map) | **Map stays parked.** Grafts taken mapless: honest crow-flies distance labels + the "couldn't place these" shelf |
| **Wuzup Passport** (traveler) | Deferred to v2.x; its **Coverage Card** ("what we know here · N sources · updated 6:04 PM") landed in Stage D and is now the Reach honesty surface |
| **Ground Truth** (city OS) | v3 horizon. (Scoring-integrity note: the judges scored 9 of 10 — this one's digest truncated; reviewed in synthesis, its near-term pieces overlap grafts already taken, its Vouches network is a v3 question) |

## 3. The three movements

### Movement I — COMPOSE (the spine: The Saturday Engine)
*"Ask for a Saturday. Get a real one — with receipts."*

- **Give Me a Saturday** — the killer feature. One tap composes a full real day into the existing
  Morning/Afternoon/Night skeleton: weather-fit (real forecast), taste-reordered (never filtered),
  distance-sane, every slot wearing a why-line whose every claim traces to data. Per-slot re-roll;
  never-hide candidate lists behind every slot.
- **The Ingredient Foundry** — the enabling pipeline, and the proven pattern at scale: **AI at build
  time, static at runtime.** Agents pre-compute per-item daypart-fit, weather-fit, evidence-cited vibe
  tags, and a distance-bounded pairing graph. (The imagery pipeline already proved this pattern with
  sign-verification; the Foundry is its generalization.) Its **proposed first stage is corpus quality**
  — spec'd in [quality-engine.md](quality-engine.md), pending ratification. The dependency is binding
  even while the mechanism is not: enriching a stale duplicate amplifies the defect, so an accepted
  quality gate must run before every other Foundry enrichment.
- **The Weekend Brief** — Home's calm-morning tenant: the weather call, the 2–3 genuinely scarce things
  this weekend, three day-shapes. Generated at data refresh, personalized on-device.
- **Tonight scope** (Golden Hour, folded in) — after ~4pm the composer answers "give me a *tonight*":
  the Tonight Board (next-3-hours starts, doors times where sources list them, Last Call closers) as
  Home's evening tenant — **computed from the existing daily snapshot, honestly stamped** ("data from
  4:53 PM"), no hourly ops. + the sunset/golden-hour line grafted into DayPage's Night slot.
- **Plan, Promoted** — resolves ruling #4's open question: the Plan tab becomes the concierge's home
  room; DayPage grows into the true itinerary composer. The Pacing Loop feeds the morning-after journal
  back into composer defaults.

### Movement II — DECIDE (together, with zero backend)
*"Two swipes make a plan."*

- **Match Deck, couch mode (v2.0)** — pass the phone: two people swipe the same seeded deal on one
  device; the app ceremonially reveals the overlap → one tap turns it into a plan. Rides the existing
  deck machinery + its proven coverage guarantees. The single best social moment, zero infrastructure.
- **Pass the Day (v2.0)** — a composed day becomes a shareable artifact: state encoded in a URL
  **fragment** (never reaches a server), rendered by the same static app as a clean plan page.
- **Async link-mode co-swipe + Who's In? (v2.1)** — the full Both In flow once the fragment router and
  stable IDs are proven (a snapshot-skew guard is required: sender/receiver may hold different data days).
- Explicitly NOT in v2: accounts, rooms, feeds. The Crew Relay (a tiny E2E-encrypted blob relay) is a
  **v2.x decision with its own future ruling** — v2.0 ships zero backend.

### Movement III — KEEP (the merged ledger: Passport + journal, one system)
*"Plan the weekend. Keep the year."*

- **Close the Day** — the existing morning-after prompt upgraded to a 15-second ritual: went/skipped/
  rest, one-tap mood, optional photo (IndexedDB). One system feeding everything below. (Three concepts
  depended on this prompt — it gets specced as a first-class system: in-app delivery, decay rules.)
- **The City Passport** — every place you *really* went gets a unique ink-stamp: **the Aurora per-place
  art restyled as stamp marks** — the 94% art-floor becomes a collectible system no competitor can copy
  without faking it. Neighborhood/activity/set pages.
- **Honest Sets + Kind Milestones** — pure-predicate collections with provably complete rosters ("The
  7 Piers of Pinellas", "All 22 Beaches", "The Verified 35") + restrained celebration on the existing
  reward token. Seasonal Quests ride the watch-guide machinery (windowed, from real event data).
- **Day Cards + Your Year Here** — every closed day becomes a designed card; monthly postcards + the
  annual recap story, computed 100% on-device. Wrapped-style emotion, built from deliberate diary taps
  instead of surveillance — honesty IS the flex. Canvas share-card PNGs via the share sheet.
- **The Vault (non-negotiable for v2.0)** — full export (JSON + photos), import/restore, print-ready
  year book. The moment memories become the product, data loss becomes betrayal — see Layer Zero
  (storage durability). Memory Sync (E2EE) is a v2.x ruling, not v2.0.

## 4. Layer Zero — the substrate (named workstream, sequenced FIRST)

The completeness critic's verdict: *"all ten concepts design the Saturday-morning demo and skip the
Tuesday-3am product."* Layer Zero is the non-optional workstream that precedes every killer feature:

1. **Public hosting + CI deploy — LANDED in Stage E.** GitHub Pages, PR CI, and the weekly refresh-PR
   workflow are merged. The post-rename production repair is verified; the first full scheduled
   refresh → PR → merge → deploy cycle is the remaining operational proof.
2. **The fragment-URL router — PENDING.** Spend the inert-URL break **exactly once**, as shared substrate:
   real addresses for tabs/events/spots/guides/day-plans; share-sheet + deep links + notification taps
   + PWA shortcuts all ride it. Privacy posture: payload lives in the `#fragment`, which never reaches
   a server.
3. **Stable event IDs — LANDED in Stage D.** Deterministic content-derived IDs are emitted,
   collision-checked, and enforced by smoke tests. Runtime persisted stores still use the legacy
   `keyOf` identity seam; migrating those stores is separate work and must preserve existing saves.
4. **Event-image posture — PENDING.** Most event images are hotlinked third-party URLs (privacy leak + link
   rot). Build-time proxy/resize into self-hosted assets, like place-img already does.
5. **PWA substrate — PARTIAL.** Manifest/installability landed in Stage E. Service worker + offline
   shell ("Offline · showing Friday 4:53 PM data") + the install ceremony + **House
   Calls** on-device notifications, **honestly tiered** (the Notification Triggers API is dead:
   periodic-background-sync best-effort on Chromium/Android, badge + in-app fallback on iOS, stated
   plainly in Settings).
6. **Durability + containment — PENDING.** `navigator.storage.persist()` (Safari ITP purges localStorage after
   7 days idle — fatal to a memory product), ErrorBoundaries (today one exception white-screens the
   app), the Vault as the backstop.
7. **Budgets + floors — PARTIAL.** The Coverage Card and sparse-city groundwork landed; per-city
   payload/boot budgets and per-feature floors remain. Target: ≤4MB raw / ~800KB gz plus a mid-Android boot budget;
   **every V2 feature ships a sparse-city spec** (SF-week-one floor: a 2-event Tonight, an 8-card deck,
   composer slots that admit "not enough data yet" honestly).
8. **A11y as acceptance — V2 EXTENSION PENDING.** Keyboard/switch alternative for the deck (now a primary door), focus order
   on new sheets, share-card alt text. Extends the existing discipline, not polish.
9. **The privacy amendment — RATIFIED by ruling #2; implementation extensions pending.** What leaves
   the phone: nothing by default; a link carries only what you chose to share, encoded in a fragment;
   photos never leave the device without the Vault export.

**The Feel Substrate (proposed sibling — pending ruling):** [premium-ui.md](premium-ui.md) proposes a
second cross-cutting substrate workstream beside Layer Zero — the motion/touch/materials/loading/
ceremony grammar every admitted feature speaks. It interleaves with Layer Zero by construction (the
fragment router (item 2) and navigation feel must be designed together or the back-button system gets
built twice; the service worker rides item 5), and its defect-amplifying surfaces (receipts chrome,
composer slots) sit downstream of an accepted quality gate per §5. Status: spec, awaiting the threshold
ruling (premium-ui §7.0) — this paragraph is a pointer, not a ruling; §8's rulings stand unmodified.

## 5. The dependency gate

Every V2 honesty surface — receipts, stamps, freshness chips, "Confirmed ×3" — **amplifies data
defects**: a beautiful receipt over a stale duplicate is worse than no receipt. Stage D/E supplied the
initial floor; V2 kickoff is now gated on production/refresh proof plus a ratified, measurable
data-quality mechanism. The Quality Engine spec is the current proposal, not a silently ratified
workstream. Per the premium-gap diagnosis: data quality is layer one, always.

**Recurring-ops honesty** (the scarcest currency is Josh-time, not code): v2.0 is designed to add
**zero standing human ops** — no hourly builds, no editorial pipeline, no moderation queue. The only
recurring costs that remain are the ones v1 already carries (per-city imagery REFUTE gates, gazetteer
review at city onboarding).

## 6. Release shape

- **v2.0 — "Give me a Saturday"**: Layer Zero + Movement I core (Foundry, composer, Brief, Tonight
  scope) + couch-mode Match Deck + Pass-the-Day links + the merged Ledger v1 (Close the Day, Passport,
  2–3 Honest Sets, the Vault) + Receipts-Everywhere primitive.
- **The Reach track (§10 — the Everywhere mandate) runs in PARALLEL to the feature releases**: the
  City Foundry's preparatory audits/design can start now; implementation begins at R1 only after
  R0 and §5's kickoff gates clear. Reach milestones R1–R4 then land on their own cadence, gated in
  Josh-hours, independent of v2.0/v2.1 feature scope.
- **v2.1**: async co-swipe + Who's In? · Seasonal Quests · Your Year Here recaps + share cards ·
  Reality Ledger insights · Dusk (warm dark mode) · big-canvas layouts.
- **v2.x rulings (each needs its own future decision)**: Crew Relay (3+ person, E2EE, the first
  backend) · Memory Sync (E2EE) · the runtime Concierge Sheet (LLM ask-box) · push digests · Trip Mode
  (traveler) · the Explorer's Atlas / any map revival · Vouches (v3).

## 7. Rules reopened vs. rules kept

**Deliberately reopened (each spent once, deliberately):** the inert URL (→ fragment router, the one
substrate spend) · Home's thinness (→ exactly two tenants: calm morning Brief / evening Tonight — no
third, ever) · ruling #4's open planner-as-tab-root (→ answered: the Plan tab is the concierge's home) ·
the morning-after prompt's modesty (→ promoted to the Close-the-Day system) · "PWA as a Stage-E
checkbox" (→ promoted to substrate) · the Dice retirement (→ its *spirit* returns as Tonight's Roll
inside the Ledger, grown up).

**Kept, by choice:** the honesty contract (weaponized, not strained) · never-hide (the composer carries
candidate lists; the deck keeps its coverage proof) · no pay-for-placement, ever · the map stays parked
(the Atlas didn't earn un-parking; mapless grafts only) · sponsored-exclusion from decks · calm-not-
shouty (zero-is-silence survives everywhere; milestones are Kind) · taste reorders, never filters ·
**zero backend in v2.0** · no accounts.

## 8. Adjudication — ✅ EIGHT RULINGS (2026-07-05; first seven delegated to Fable, #8 issued directly by Josh)

1. **The spine — RATIFIED.** V2 = Compose / Decide / Keep; the Day is the atomic object; the admission
   test is binding on every feature, no exceptions. *(Basis: the only triple-consensus verdict in a
   10-concept tournament — this is the strongest signal the fleet produced.)*
2. **The fragment-URL substrate — APPROVED.** The inert-URL break is spent exactly once, in Layer
   Zero, as shared substrate for sharing/deep-links/notifications/PWA. Privacy posture is binding:
   **all shared state rides the `#fragment`** (never transmitted to any server). The one-page privacy
   amendment is drafted at §9 below and ratified with this ruling.
3. **Home's two tenants — RATIFIED, with a hard cap.** Calm morning (Weekend Brief + the
   Give-me-a-Saturday door) / evening (the snapshot Tonight Board). **No third tenant, ever** — any
   future feature wanting Home real estate must displace one of these two by ruling, not squeeze in.
   The name-free greeting and zero-is-silence survive both tenants.
4. **Planner-as-tab-root — RESOLVED YES, scoped to V2.** In V2 the Plan tab becomes the concierge's
   home room (composer + the Keep ledger in one room). **No V1 churn occurred** — the shipped logbook
   model stood untouched through Stage E; this ruling activates at V2 kickoff.
5. **Zero-backend v2.0 — CONFIRMED.** No accounts, no server state, no push infrastructure in v2.0.
   Standing posture for later: the first backend Wuzup ever buys should be the *smallest possible*
   (the E2EE Crew Relay blob is the likeliest candidate) and only after v2.0's couch-mode + link
   sharing proves the demand. Each candidate gets its own ruling.
6. **Both grafts — APPROVED AND LANDED IN STAGE D.** The original audit found neither capability;
   the resulting work shipped before v1:
   - **Coverage Card:** the honest "what we know here" surface (events · sources · freshness · imagery)
     now doubles as SF's sparse-data answer and the binding Reach honesty surface.
   - **Stable event IDs:** the finder emits deterministic, collision-checked IDs. V1 made no routing
     change; the IDs exist so V2 share/link/ledger features have stable ground.
7. **Charles's lanes — DIRECTION SET, non-blocking, Charles holds the refinement pen.** Ratified as
   *default direction* he can override during V2 design: Aurora-as-ink for Passport stamps (derive
   from the existing per-place artseed hues; monochrome ink treatment); Day Cards / share cards /
   Year recap speak the Sunlit token language (no new palette); the Install Ceremony fires once,
   after the first real value beat (not on load); Dusk ships v2.1 (warm charcoal + ember, a second
   ratified token set); the Match Deck overlap reveal is **the one sanctioned big celebration moment**
   in the app (everything else stays Kind-Milestone restrained). None of these block Layer Zero or
   any engineering.
8. **The Everywhere mandate — ISSUED BY JOSH DIRECTLY (2026-07-05).** V2 must expand to at minimum
   the full United States, eventually global — ≥50% honest coverage minimum, as close to 100% as
   possible, with non-covered locations clearly marked. Design + feasibility verified by a 5-agent
   fleet (`wf_cef30911-863`); the full mechanism is §10. Two consequences ruled with it: **D-DEP is
   superseded at V2 scale** (one app + runtime city resolution — kept as-ruled through v1), and the
   **Coverage Card (D-G1) is promoted from a nice-to-have to the binding honesty surface** of the
   whole expansion.

## 9. The privacy amendment (one page, ratified with ruling #2)

**What Wuzup knows stays on your phone.** All state — plans, saves, taste, journal, photos, streaks —
lives on-device (localStorage/IndexedDB). No account exists. No analytics or telemetry ship in the app.
The app talks to exactly one party: its own static host, to fetch the city's public data snapshot.

**Sharing is explicit and self-contained.** When you share a plan, deck, or day, the shared state is
encoded in the link's `#fragment`. Browsers do not transmit fragments in HTTP requests — the link's
content is readable only by a person who holds the link. Nothing you share is stored, logged, or
observable by any server, including ours. A link carries only what you chose to put in it, at the
moment you made it.

**Photos never leave the device** except by your explicit act: a share-card you render, or the Vault
export you download. **The Vault** (full export/restore) is the durability promise that replaces a
cloud: your data is yours to carry, back up, and move.

**Future exceptions require their own ruling** and must be: opt-in, end-to-end encrypted, and
zero-knowledge (the server, if any ever exists, can never read what it relays). Any feature that
cannot meet that bar doesn't ship.

## 10. The Everywhere mandate (ruling #8 — Josh, 2026-07-05)

> **"V2 has to expand locations. At minimum full United States. Eventually global. Ideally at minimum
> 50% honest coverage and clearly marked locations we are not in — ideally as close to 100% as possible."**

Designed + feasibility-verified by a 5-agent fleet against the actual repo (`wf_cef30911-863`).
The one-line verdict: **feasible, static-first, and the honesty contract is what makes it scalable —
"clearly marked where we're not" isn't the compromise, it's the mechanism.** The Coverage Card (D-G1)
becomes the binding honesty surface of the whole expansion: every locale visibly declares what Wuzup
knows there (sources · counts · freshness · imagery), so a thin city ships proudly instead of lying.

### 10.1 The coverage math (Census CBSA vintage-2024, computed — not eyeballed)

US population 340.1M. Cumulative MSA shares: **top 50 metros = 55.2%** · top 100 ≈ 65–70% · top 300 =
83.6% · + 538 micropolitans = 94.7% · rural outside any CBSA ≈ 5.3%. Today (Tampa + SF) = **2.4%**.
So: **the 50% bar = ONE automated metro stack run ~50 times** — not hundreds of hand-built cities.
"Close to 100%" = tiered: T2 top-300 (83.6%) + T3 floor over all CBSAs (94.7%) + T3 any-US-point
(100% geographic, with the below-floor honestly marked). Population-honest caveat, stated plainly:
~100% means everyone gets *something honest*; the share who get something *rich* is the T1+T2 band.

### 10.2 The tier ladder (what "honest coverage" means at each rung)

- **T1 — Flagship (5–15 cities):** the current hand-built model — full source scouting, human-reviewed
  gazetteer, Mapillary sign-verified imagery, editorial seeds. Tampa + SF are T1.
- **T2 — Metro (the top ~50→300):** the automated national stack + platform adapters + auto-gazetteer +
  agent-fleet gates with sampled human audit. **No Mapillary** (the manual-heavy gate is a flagship
  luxury — Commons/Wikidata + Aurora are already fail-closed automated; skipping Mapillary below T1
  loses ~5–15% cafe-photo yield and zero honesty).
- **T3 — Floor (any US point):** config-only national sources — OSM places (global by construction) +
  Ticketmaster/SeatGeek radius + AllEvents/Meetup/Eventbrite-pages + weather + Aurora. Thin but honest;
  the Coverage Card leads the experience ("New here: 87 events from 3 sources · updated Tuesday").
- **T0 — Not here yet:** the clearly-marked honest absence — works anywhere on Earth (weather still
  renders), names the nearest covered cities, and carries a "raise your city" demand signal. (The
  demand *counter* would be the one tiny infra exception — a v2.x ruling per rule #5; v2.0 ships a
  share/mailto signal instead.)

### 10.3 The mechanism (why this is real, verified against the repo)

1. **Platform adapters, not city modules.** Of Tampa's 17 event sources, only ~4 are true one-offs —
   the rest are instances of ~10 national PLATFORM patterns (Simpleview DMO ≈500+ "Visit X" bureaus ·
   The Events Calendar WP-REST, the most common events plugin in America · LibraryMarket/BiblioCommons/
   LibCal library platforms — Tampa's **#1 source by volume is a library platform** · CivicPlus RSS,
   the dominant small-town municipal CMS · DoStuff network (~20 metros) · Trumba/Localist/LiveWhale
   universities · ArcGIS/Socrata open-data · Meetup/AllEvents/Eventbrite JSON-LD). SF already proved
   the inversion: 3 of its 7 sources were pure config swaps, 1 a base-URL swap, 1 a same-platform port.
   Invert `finder/sources/<city>/` into `finder/platforms/` + per-metro endpoint configs.
2. **Two free national APIs we already identified but don't use:** Ticketmaster Discovery (free key,
   lat/lng radius — the only honest path into big-venue inventory) + SeatGeek Platform. These cover
   exactly the big-ticket gap the platform adapters don't.
3. **The agentic metro scout** — the STAGE_D endpoint-verification method, industrialized: given a
   metro, an agent fleet fingerprints its platform stack (which CMS runs city hall, which platform the
   libraries use, which DMO), verifies endpoints live, and emits the config. Proven at n=2 in ~1–2
   days each; automatable because it's exactly what agents already did by hand.
4. **The auto-gazetteer, honesty-safe by asymmetry** (the fleet's decisive discovery): over-promoting
   an area word only demotes a real photo to the Aurora floor (coverage loss — safe); under-promoting
   risks wrong photos (breach). So: generate from Census TIGER + GNIS + OSM place nodes (verified live:
   every tested metro has them), **promote everything**, and run the deterministic roster collision
   check — which mechanically reproduced **11/11** of the traps the human SF review hand-caught. Agent
   review exists only to *recover coverage*, never to protect honesty.
5. **Agent-fleet gates with sampled human audit.** The REFUTE pattern (which caught 4 FPs a self-review
   passed, and the 45/453 deck carousel) becomes the standing gate: two independent name-blind agent
   passes, default-reject, calibrated per capture-regime with 100% human eyeball on the first 2–3
   cities of each regime, then random 20-item Josh samples. Sampling math stated honestly: a 20-item
   sample alone catches a 5% defect rate ~64% of the time — acceptable *only* stacked on the
   default-reject agent gates, and the Coverage Card must frame T2 imagery honestly.
6. **Architecture: one app, N artifact sets.** `/cities/index.json` coverage manifest (~12KB gz) +
   `/cities/<id>/{events,places,city}.json`; a client-side location router (fragment prefix →
   remembered city → optional geolocate → point-in-bbox → nearest → T0); **city switch = set fragment
   + reload** (preserves every single-city module assumption); fragment URLs extend to
   `#/c/<cityId>/e/<stableEventId>` on the D-G2 IDs. **D-DEP is superseded at V2 scale** (ruled in
   §8.8; stands through v1). Economics: ~1.7GB total at 300 cities ≈ **<$5/month** on R2+Pages; CI
   matrix with tiered cadence (T1 daily · T2 2–3×/week · T3 weekly); manifest-flip-last so a failed
   build can never dark-ship a broken city.
7. **The City Foundry** — the one-time machine (~13–18 builder-weeks; the repo's velocity says weeks,
   not quarters): adapter library · auto-scout harness · auto-gazetteer · agent-gate harness · CI
   matrix + rot canaries (expected-volume bands, schema-drift detection, auto tier-demotion — a
   dormant source demotes the city's Coverage Card instead of shipping thin data silently) · config
   generation from Census shapefiles · key vault + per-source politeness scheduler. After the Foundry:
   **T2 metro ≈ 15–25 agent-hours + 30–45 Josh-MINUTES; T3 ≈ 1–3 agent-hours + ~2 Josh-minutes
   amortized** (vs. today's 8–12 builder-days + 4–8 Josh-hours).

### 10.4 The ramp (gated in Josh-hours, the true scarce currency)

**R0** close v1 production/refresh proof plus the supervised SF imagery pass (SF code/data is already
complete; n=2 tells us which abstractions are real — never build the Foundry from n=1) → **R1** Foundry
build → **R2** 10 metros at ~1/week, chosen for platform overlap
(DoStuff cities: Austin, Chicago, Denver, Seattle, Nashville…; strong Simpleview DMOs), 100% human
audit while calibrating → **R3** 50 metros at 3–5/week = **the 50% mandate met** (entry gate: 30 days
green refresh ops at 10 metros) → **R4** 100 → 300 + the T3 floor everywhere (entry gates: rot-SLO
met; Josh standing audit ≤2 hrs/week measured, auto-pause on sustained excess; no city >50%
single-source). **Global = v2.x horizon**: OSM/Commons/Mapillary/Open-Meteo/Meetup/AllEvents are
already global, Ticketmaster covers ~20+ countries — anglosphere first; locale/units/language work is
the real cost, deferred to its own ruling.

### 10.5 The honest risks (recorded, not hidden)

**Eventbrite concentration is THE systemic risk** — the projected volume backbone everywhere, with no
public API since 2020 (city-page JSON-LD reads only); mitigation = source-diversity guard (no city
ships >50% single-source) + the platform-adapter breadth. **ToS posture needs its own ruling** before
R2: AllEvents/Meetup/DoStuff/Eventbrite page-reads are ToS-gray at 50 metros in a way they aren't at
2 — decide the posture (politeness budgets, robots respect, partnership outreach where offered) as a
named V2 ruling. **Public Overpass/Nominatim will rate-limit a 40-city build** — self-hosted Overpass
or Geofabrik planet-extract batch is a hard R2 prerequisite. **n=2 generalization risk** — Tampa and
SF are both rich coastal metros; R2's ten cities are the real test. **Tiered staleness is an honesty
exposure** — a weekly-refresh T3 city will show dead events for up to 7 days; the Coverage Card's
freshness line is the binding mitigation. **Agent-gate self-pass bias** — the standing lesson; hence
default-reject, independence, calibration, and sampled human audit stacked. **Josh-time overload is
the true failure mode** — every gate queues on one human; hence the ramp gates are expressed in
measured Josh-hours with auto-pause.

---

*Appendix — the full fleet output (all 10 concepts, 3 judge scorecards, 2 stress reports) lives in the
workflow record `wf_90b6eaba-e15`; the Everywhere-mandate design fleet in `wf_cef30911-863`.
Scoring-integrity note, recorded honestly: 9 of 10 concepts reached the judges (one digest
truncation); two arrived truncated; the verdict stands on triple-consensus of the three independent
judges, and the unscored concept was reviewed in synthesis.*
