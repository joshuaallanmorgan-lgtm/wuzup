# Wuzup V2 — The Day Engine
### "Give me a Saturday."

> **Plan of record for V2** — synthesized 2026-07-05 by Fable 5 from a 21-agent visioning fleet
> (6 ground recon · 10 visionary concepts · 3 adversarial judges · 2 stress critics; ~1.4M tokens).
> Plan-only: nothing here is scheduled until v1 ships (Stage D → E). Adjudication sheet at the bottom.
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
| **Wuzup Passport** (traveler) | Deferred to v2.x — but its **Coverage Card** ("what we know here · N sources · updated 6:04 PM") should be pulled INTO Stage D now |
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
  sign-verification; the Foundry is its generalization.)
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

1. **Public hosting + CI deploy** — there is NO deploy target in the repo today; the finder runs on a
   scheduled task on Josh's logged-in Windows PC. Move builds+finder to CI cron; resolves with Stage D's
   ⚑D-DEP. **This is also v1-ship work (Stage E) — V2 just makes it existential.**
2. **The fragment-URL router** — spend the inert-URL break **exactly once**, as shared substrate:
   real addresses for tabs/events/spots/guides/day-plans; share-sheet + deep links + notification taps
   + PWA shortcuts all ride it. Privacy posture: payload lives in the `#fragment`, which never reaches
   a server.
3. **Stable event IDs** — events.json rows have no `id`; every share/link/ledger feature needs one.
   Cheap to mint now in the finder, expensive to retrofit. **Recommend pulling into Stage D/E.**
4. **Event-image posture** — 95% of event images are hotlinked third-party URLs (privacy leak + link
   rot). Build-time proxy/resize into self-hosted assets, like place-img already does.
5. **PWA substrate** (Move-In Day, re-read): manifest + service worker + offline shell ("Offline ·
   showing Friday 4:53 PM data" — the honest pattern already exists) + the install ceremony + **House
   Calls** on-device notifications, **honestly tiered** (the Notification Triggers API is dead:
   periodic-background-sync best-effort on Chromium/Android, badge + in-app fallback on iOS, stated
   plainly in Settings).
6. **Durability + containment** — `navigator.storage.persist()` (Safari ITP purges localStorage after
   7 days idle — fatal to a memory product), ErrorBoundaries (today one exception white-screens the
   app), the Vault as the backstop.
7. **Budgets + floors** — per-city payload budget (≤4MB raw / ~800KB gz) + a mid-Android boot budget;
   **every V2 feature ships a sparse-city spec** (SF-week-one floor: a 2-event Tonight, an 8-card deck,
   composer slots that admit "not enough data yet" honestly).
8. **A11y as acceptance** — keyboard/switch alternative for the deck (now a primary door), focus order
   on new sheets, share-card alt text. Extends the existing discipline, not polish.
9. **The privacy amendment, drafted with content** — what leaves the phone: nothing by default; a link
   carries only what you chose to share, encoded in a fragment; photos never leave the device without
   the Vault export. One page, Josh-ratified.

## 5. The dependency gate

Every V2 honesty surface — receipts, stamps, freshness chips, "Confirmed ×3" — **amplifies data
defects**: a beautiful receipt over a stale duplicate is worse than no receipt. So V2 kickoff is gated
on the data-quality bar holding through Stage D/E (venue canonicalization, dedup, freshness ops on CI).
Per the premium-gap diagnosis: data quality is layer one, always.

**Recurring-ops honesty** (the scarcest currency is Josh-time, not code): v2.0 is designed to add
**zero standing human ops** — no hourly builds, no editorial pipeline, no moderation queue. The only
recurring costs that remain are the ones v1 already carries (per-city imagery REFUTE gates, gazetteer
review at city onboarding).

## 6. Release shape

- **v2.0 — "Give me a Saturday"**: Layer Zero + Movement I core (Foundry, composer, Brief, Tonight
  scope) + couch-mode Match Deck + Pass-the-Day links + the merged Ledger v1 (Close the Day, Passport,
  2–3 Honest Sets, the Vault) + Receipts-Everywhere primitive.
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

## 8. Adjudication — ✅ RESOLVED 2026-07-05 (Josh delegated all 7 to Fable; rulings below are binding for V2 planning)

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
   home room (composer + the Keep ledger in one room). **No V1 churn** — the shipped logbook model
   stands untouched through Stage E; this ruling activates at V2 kickoff.
5. **Zero-backend v2.0 — CONFIRMED.** No accounts, no server state, no push infrastructure in v2.0.
   Standing posture for later: the first backend Wuzup ever buys should be the *smallest possible*
   (the E2EE Crew Relay blob is the likeliest candidate) and only after v2.0's couch-mode + link
   sharing proves the demand. Each candidate gets its own ruling.
6. **Both grafts — APPROVED AND PULLED INTO THE ROAD** (verified against the repo 2026-07-05: events
   carry NO id field; STAGE_D.md has no coverage scope — both are real):
   - **Coverage Card → Stage D**: a small honest "what we know here" surface (N events · M sources ·
     updated <time> · imagery coverage) — doubling as SF's week-one sparse-data answer. Slots into the
     remaining D3 work.
   - **Stable event IDs → the finder, before v1 ships**: mint a deterministic `id` per event at emit
     (content-derived hash — stable across re-runs, collision-checked), carried into events.json.
     Zero UI change in v1; it exists so every V2 share/link/ledger feature has ground to stand on.
7. **Charles's lanes — DIRECTION SET, non-blocking, Charles holds the refinement pen.** Ratified as
   *default direction* he can override during V2 design: Aurora-as-ink for Passport stamps (derive
   from the existing per-place artseed hues; monochrome ink treatment); Day Cards / share cards /
   Year recap speak the Sunlit token language (no new palette); the Install Ceremony fires once,
   after the first real value beat (not on load); Dusk ships v2.1 (warm charcoal + ember, a second
   ratified token set); the Match Deck overlap reveal is **the one sanctioned big celebration moment**
   in the app (everything else stays Kind-Milestone restrained). None of these block Layer Zero or
   any engineering.

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

---

*Appendix — the full fleet output (all 10 concepts, 3 judge scorecards, 2 stress reports) lives in the
workflow record `wf_90b6eaba-e15`. Scoring-integrity note, recorded honestly: 9 of 10 concepts reached
the judges (one digest truncation); two arrived truncated; the verdict stands on triple-consensus of
the three independent judges, and the unscored concept was reviewed in synthesis.*
