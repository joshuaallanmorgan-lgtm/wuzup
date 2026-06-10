# MASTER PLAN — from "impressive prototype" to "the app we'd actually release"
_v1 · 2026-06-10, day 3 part 2 · Fable driving, Josh+Charles supporting. Branch: autonomous-dev-pt2._
_This supersedes PLAN.md (day-3, executed) as the active roadmap. Sprint F (deploy) parked by Josh._

## NORTH STAR
**"Open this and immediately find the move."** Not a database of events — an opinionated, alive, premium guide that feels curated like App Store Today, fast like TikTok, useful like Google Maps, warm like a friend who knows the city. The #1 unsolved usability problem in Josh's own words: *"there are so many events but I'm having a hard time parsing through and trying to find exactly what I want."* Every wave below serves that sentence.

## INPUTS SYNTHESIZED
1. Everything Josh+Charles have directed across 3 days (UI_SPEC.md + addendums, tasting verdict, invariants).
2. Josh's GPT UI-research report (attention loops, salience, variable reward, color discipline). **Honest delta: ~60% of it is already shipped** — teal/hot palette split, bubble grid, heat badges, varied feed rhythm, dice→Find-My-Night, saves, motion discipline, no fake urgency. **Adopted as new work:** reward-accent token, coral budget audit (hot ≤ 5-10% of any screen), "why it's hot" composed line, recently-viewed, session recap, gentle stopping cues, image-fallback upgrade, map pin semantics + bottom-sheet preview, calendar teal polish, found-via demotion, first-screen "playability." **Rejected/parked (report agrees):** likes/comments/leaderboards/streaks/public counts — account-gated social stays parked.
3. The standing invariants: never hide (reorder only) · sponsored & added-by-you always labeled · no fake data, no fake urgency · benchmarks must stay green · hot coral reserved for heat.

## THE FIVE PROBLEMS BETWEEN HERE AND RELEASE
P1. **Parseability** — 1,603 events, no taste model; libraries are 60% of the feed; Everything is honest but endless.
P2. **Premium gap** — strong bones, but image fallbacks, color budget, micro-reward moments, and first-screen energy are below release bar.
P3. **Trust at scale** — 'other'=128, VSPC has no times, prices mostly unknown, ongoing-exhibit near-dupes, venue names unnormalized.
P4. **Utility ceilings** — map is 1,534 undifferentiated pins; calendar palette dated; no plan-building from saves.
P5. **Release hygiene** — no regression harness, no perf audit, unknown behavior on weak devices/networks.

---

# WAVE 1 — FIND THE MOVE (parseability war) 🎯
### Sprint G — Ranking 2.0 & the local taste engine
The centerpiece. All signals LOCAL (no accounts): saves, event opens, FMN answers, bubble taps, add-event categories → a lightweight on-device taste profile (category affinities + free-preference + time-of-day patterns, localStorage, fully inspectable).
- G1 **Diversity-aware feed ordering** ⚑FLAG-1: within each day, interleave so no single source-family or category floods a screen (libraries de-flooded); pure reordering, nothing hidden.
- G2 **Taste re-ranking**: profile nudges (bounded: taste can add ≤15 pts equivalent — flavor, never a filter bubble; Charles's "slightly tailored, not heavily algorithmic" is the spec).
- G3 **"Why this is here" transparency**: detail page line composing real reasons ("🔥 3 local sources · Free · Tonight · You save a lot of music") — trust through honesty, also the GPT report's "why hot" ask.
- G4 **Top of feed: "Your kind of night"** — a small personalized rail (clearly labeled "For you, from your taps") once profile has signal; absent before that. Never replaces the editorial sections.
### Sprint H — Onboarding & first-screen playability
- H1 **3-tap mood primer** ⚑FLAG-2: first open only, skippable in one tap ("What gets you out? 🎵🍔🌳… / Free-leaning or whatever? / Weeknights or weekends?") → seeds the taste profile + bubble emphasis. Local-only. Copy drafted for Charles's review at next session.
- H2 **Hero alive**: time-aware greeting line ("Wednesday night in Tampa Bay — 31 still to come"), count ticks on data refresh; subtle.
- H3 **Recently viewed** rail (local) + **session recap** moment ("You eyed 3 ideas for Friday — compare?") with the GPT report's gentle-stopping-cue placement at Everything's end.
### Sprint I — Visual system v3 (the premium pass)
- I1 **Reward accent token** (--reward pink/purple): save pop, FMN reveal, recap moments ONLY.
- I2 **Coral budget audit**: hot appears ≤ ~10% per screen; demote anything diluting it.
- I3 **Image fallback upgrade**: no more dark blocks — per-category illustrated gradient compositions (hue + oversized emoji watermark + texture), consistent and intentional.
- I4 First-screen polish per H2; found-via demoted to detail footer; type scale audit.

# WAVE 2 — UTILITY CEILINGS 🗺️
### Sprint J — Map utility pass ⚑FLAG-3
- J1 Pins colored by category hue, sized/tinted by heat; J2 clustering at low zoom (1,534 pins is soup); J3 pin tap → bottom-sheet PREVIEW card (full detail one more tap); J4 "N in view" live count; tab bar stays.
### Sprint K — Calendar polish + Weekend Builder
- K1 Calendar teal-base polish; coral strictly for hot-density days; tappable-day affordance.
- K2 **Weekend Builder** ⚑FLAG-4 (creative expansion of the original "Monday plans Friday" hook): from the Saved shelf — "Build my weekend" → Fri/Sat/Sun slots, drag/tap saved events in, fill gaps with suggestions, output a shareable plan card. The Charles demo moment. (Evergreen-places "make your own event from a spot" is its future extension — parked in LONG_TERM.)

# WAVE 3 — TRUST AT SCALE 🧹
### Sprint L — Data v3
- L1 'other' ≤ 60 (classifier round 3 + per-source mappings); L2 selective VSPC time-enrichment (detail JSON-LD renders for the top ~40 by hotScore, budgeted); L3 ongoing-exhibit cross-day dedupe; L4 venue canonicalization table (one venue, one name, one coord); L5 price coverage probe (Eventbrite detail fetch experiment, budgeted); L6 image-quality scoring (kill broken/tiny images → fallback system).
### Sprint M — Performance, resilience & the regression harness
- M1 Perf audit at 1,600+ events (memo coverage, list virtualization if needed, bundle size, image loading discipline); M2 weak-network behavior + stale-data banner ("events from Tuesday — refreshing"); M3 **smoke-test harness**: one `npm test` that runs finder fast-mode + invariant checks (benchmarks, schema, no-ended-events, label presence) + app build — every future sprint runs it.

# WAVE 4 — THE CHARLES CUT 🎬
### Sprint N — Demo polish
Fresh data run → walk every surface → embarrassment list → fix → rehearse the demo path (open → mood primer → bubbles → FMN → save 3 → Weekend Builder → detail → map). PLAN: this is where we pause and present.

# POST-V1 PARKING LOT (logged, not scheduled)
Deploy + PWA (Sprint F, Josh-gated) · accounts/social layer · public submissions pipeline · evergreen Places layer + make-your-own-event · multi-city + city selection + per-city heroes · native wrap · Ticketmaster key · dark mode · year calendar view.

---

## EXECUTION RULES (this is the contract)
- Each sprint = one multi-agent workflow (build ∥ → adversarial review → Fable hand-verification → push to `autonomous-dev-pt2`). Smoke harness runs from Sprint M onward.
- **Concise updates only** — a few lines per sprint landing: what shipped, what the reviewer caught, what's next. Long reports only at wave boundaries or when something needs Josh.
- **Pause ONLY on the ⚑ flags below + anything destructive/outward-facing.** Everything else: full autonomy.
- Order: G → H → I → (J∥L) → K → M → N. Ambition over completion — if Charles arrives mid-wave, we present from wherever we are with N pulled forward.

## ⚑ THE FLAGS — defaults applied (Josh was asked 2026-06-10, no answer; proceeding per the driver's-seat contract. OVERRIDE ANY OF THESE ANY TIME — all work is on the revertable pt2 branch.)
1. **FLAG-1 Diversity quotas → YES + bounded taste engine.** Interleaving is pure reordering ("never hide" intact); Charles's "slightly tailored, not heavily algorithmic" is the bound spec.
2. **FLAG-2 Mood primer → BUILD, skippable, local-only.** Josh himself floated the start-survey idea; Charles reviews copy at his next session.
3. **FLAG-3 Map pass → UN-PARKED for one utility pass** (Josh's pasted research includes the map asks).
4. **FLAG-4 Weekend Builder → PROTOTYPE when Sprint K is reached** (it's an expansion of Charles's own weekend-planning framing + today's "people plan their weekend from events" note; built last in its wave, trivially cut if Charles vetoes).
