# v2 spec — The Quality Engine (corpus quality: the Foundry's first stage)

> **Status: spec · pending ratification** (scoped, decisions flagged). Source: 6-scout research fleet,
> synthesized 2026-07-06. Home: [../../BACKLOG.md](../../BACKLOG.md) (v2). V1 is shipped; §12 lists
> bounded immediate post-ship candidates versus work that waits for the full V2 workstream decision.
> Proposes becoming the successor home of **PHASE_3.7 Addendum G** (Activity Evidence Layer) and a
> resolution to its dangling ⚑D-EVID sequencing decision; neither is authoritative until Josh
> ratifies §13.1. Honesty contracts bind throughout: **never-hide (tiers reorder
> and badge, NEVER filter)** · no fake data/signals · rankings honest and sourced · no pay-for-placement ·
> zero-backend · zero standing human ops.

## 0. What this is, and the three-way seam

The V2 dependency gate says it plainly (V2_VISION.md §5): *"a beautiful receipt over a stale duplicate
is worse than no receipt … data quality is layer one, always."* This spec is layer one made real: the
build-time system that keeps junk out of what a user sees **first** and surfaces the genuinely best
things — popular AND hidden — as the substrate under the Day Engine. It is the **first stage of the
Ingredient Foundry** ("AI at build time, static at runtime," V2_VISION.md §3-I): every other Foundry
enrichment (daypart-fit, vibe tags, pairing graph) layers on items, and enriching a duplicate amplifies
the defect — so quality runs first. Admission-test legitimacy: this is Movement I's enabling pipeline —
COMPOSE's why-lines and receipts stand on it, same route as the Foundry itself.

Three specs, one seam — this table is the contract; no future doc may re-blur it:

| Layer | One-liner | Runs | Subjectivity |
|---|---|---|---|
| **CORPUS QUALITY** (this spec) | "Is this item real, clean, corroborated — how good/hidden is it, objectively?" | Build time, finder/Foundry | Objective; deterministic with frozen inputs; provenance on every claim-enabling score |
| **PERSONALIZATION** ([smart-engine.md](smart-engine.md)) | "Which of these clean items rise for THIS user?" | Runtime, on-device only | Subjective; bounded reorder, never filter (v1 bound: `taste.js` nudge ≤ +18, fuzz-tested — the v2 bound is smart-engine's to set); nothing leaves the phone |
| **CURATION** ([guides-and-rankings.md](guides-and-rankings.md)) | "Editorial lists with a POV, composed FROM quality evidence" | Build-time membership + runtime render | Editorial POV allowed; every ranking claim gated by this spec's evidence tier |

A v0 already ships, scattered and unnamed: `buzz` (finder.mjs:836), `hotScore` (:1435), `hiddenScore`
(places.mjs:470), junk caps, dedup, venue canonicalization. This workstream is **formalize + extract +
extend**, not greenfield — and its formal spec already existed once, as the never-built Addendum G
(PHASE_3.7.md:908–957), complete with a build-ready builder prompt (G.7). We adopt it as the spine.

## 1. The junk taxonomy (all examples are REAL shipped rows)

Named because the acceptance audit (§11) checks against these classes, and because the shipped snapshot
is the argument for this spec existing. Two classes are **posture-pending, not settled junk**: J7
(tributes — a taste judgment wearing a quality hat) and P1 (chains — real places) are inventoried here
because the audit needs the classes named, but their *treatment* waits on rulings §13.2/§13.3; nothing
in §3 or §11 encodes their demotion before those rulings land.

**Events** (tampa-bay/events.json gen 2026-07-02; sf-east-bay gen 2026-07-05 — scout b1):

| Class | Shipped example | Mechanism of entry |
|---|---|---|
| J1 Training-mill spam | "Secure DevOps Strategy 2 Days Workshop in Walnut Creek, CA" **$1,348.85**; "AI Threat Intelligence Forum" $934.05 | No organizer check, no price-plausibility check, no cross-market-signature check exists |
| J2 Buzz backfire | SF's **#1 and #2** events are "SF Startups, Investors, Professionals: Pitch & Networking" and "SF Women in Tech Networking Night" (hot 73) | Meetup+Eventbrite cross-posting = buzz 2 in a corpus where only 13/747 (1.7%) reach buzz≥2 — cross-posting IS the spam signature and the scorer rewards it |
| J3 Out-of-market leak | "Alison Krauss at Bowl in the Pines" — address literally **"Oakland, ME"** (Maine) shipped in the SF snapshot; a Napa resort concert via DoTheBay | bbox guards only fire on records that HAVE coords; coordless records pass |
| J4 Placeholder/status | "Tampa Bay Buccaneers vs … **(Date: TBD)**" shipped on three fabricated consecutive dates; "Rainwater Guardian Webinar" ×3 (sources/tampa-bay/stpete.mjs has no virtual filter); Pinellas "Pre-Proposal Conference … 26-0375-RFN" procurement row (evades the NOISE regex AND a benchmark that prints a false PASS); schema.org `eventStatus` (cancelled/postponed) never read | Per-module filter inconsistency + unparsed title disclaimers |
| J5 Price poisoning | "☕ The Art of Coffee: A Tasting Journey" **$510, tied for the highest hotScore in all of Tampa (98)** — level with the actual July-4 headliners; $520 poolside yoga | mergeCluster keeps MIN price with zero category sanity; emoji survives title hygiene |
| J6 Surviving dupes | "Castro Art Mart: Queens, Cream, and Chaos" ships twice (same AllEvents family — venue-equality strictness); Temescal Street Fair twice (address-as-venue vs "Temescal District"; SF venue table = 22 rows vs Tampa's 50) | Two known merge seams |
| J7 Tribute filler | 11 Tampa / 15 SF rows — Retro Junkie's weekly double-tribute bills, Wild Rover's Nirvana/RHCP tributes | Honestly sourced, but scores identically to original-artist shows; the word "Tribute" is a free unused signal |
| J8 Staleness | 16% (269/1,665) of the shipped Tampa snapshot had fully ended by 7/6 | Refresh cadence, not code — the single biggest "junk" the user actually sees |
| J9 Gem-shelf pollution | Tampa gems include "Book Discussion" and "Movie Screening: Monsters vs. Aliens" (categorized *sports*); SF gems include "Soccer Viewing" and "Trivia Night" | The gem predicate can't tell a gallery opening from bar trivia |

**Places** (tampa-bay/places.json, 2,163 rows; sf-east-bay, 2,700 — scout b2, real keys):

| Class | Shipped example | Count |
|---|---|---|
| P1 Chains | **78 records literally named "Starbucks"** (23% of Tampa's cafe class; 13 with sign-verified photos); SF: 1,113 cafes = **41% of its whole corpus** incl. 29 Starbucks + 25 Peet's. OSM's `brand`/`brand:wikidata` tag — the free chain detector — is never read (places-sources/osm.mjs:57) | 78+ / 54+ |
| P2 Non-places | `p\|29-rbs`, `p\|45-rbm` (navigation range beacons as "piers"); `p\|giraffe-feeding-viewing` (inside ZooTampa, paid) ; `p\|gwazi-field` (inside Busch Gardens); `p\|washington-borrow-pit-park`; `p\|mcdonald-s-playplace` as a family playground | ~7 named |
| P3 Generic filler | 17 color-route "Red/Blue/Yellow Trail" records; 11 bare canoe/kayak launches; ~dozens of Hillsborough inventory name-stubs (`p\|bakas`, `p\|balm`, `p\|bealsville`) | ~40+ |
| P4 Name+dot cards | 563 single-source OSM records (26% of Tampa) with zero amenities/hours/url/description | 26% |
| P5 Mis-scored gems | A bare "Starbucks" and a generic "Red Trail" each score hiddenScore **3** (gem-eligible) while **Gladys E. Douglas Preserve** — a genuinely new 17-OSM-tag preserve — scores **1** | — |
| P6 Over/under-merge | `p\|a-dock` = three distinct marina docks merged; `p\|upper-tampa-bay-trail` + `-2` = one trail split (one half is ON the gem shelf); "Carrollwood **Villiage** Park" ships the source typo on the curated shelf | — |
| P7 Defunct risk | Every gov source has a liveness gate; **OSM has none** — no check_date/edit-recency read; a closed cafe ships until a volunteer retags it | structural |

The contrast set the engine must make WIN: Pee-Pa's Open Mic Night, Hot Dog Party 20 at Crowbar, Don't
Tell Comedy, the buzz-4 St. Pete Opera July-4 Pops, Mosswood Meltdown; Fort De Soto, Sunken Gardens,
Gladys E. Douglas Preserve, Chito Branch Reserve, Bandit Coffee / Blind Tiger (sign-verified locals).
The pipeline already captures the good stuff; it just can't rank it above a tech mixer.

## 2. Signal inventory

**2a. Already have (shipped or computed-then-discarded).** Shipped: `sources[]`/`buzz`/`srcCount`,
price/isFree, coords, category, tags, `sponsored`, `staffPick` (Tampa-only), image + `imageCredit`
verification tier (`mapillary-sign`/P18/commons — an honest per-item confidence artifact nobody scores
on), `designation`, `amenities`, `hours`, `wikidata`, `hiddenScore`. **Computed then thrown away —
emit these first, they're one-line changes:** events: organizer (Meetup group squashed into desc text;
Eventbrite JSON-LD `organizer` never read), schema.org `eventStatus`, full pre-truncation description
(19% of Tampa descs end mid-sentence — cap applied at INGEST), raw multi-category lists, `imageRank`,
Meetup RSVP counts, listing-page position (b1 §2); places: `_osmTags`, `_hasWiki`, `_govBacked`,
`_touristM`, `phone`, and the spec'd-but-missing `osm:{type,id}` provenance (PLACES_SOURCES.md:88) —
the stable join key any evidence ledger needs (places.mjs:582–614).

**2b. Derivable free** (b2 §2, b5 §2–3):

| Signal | Source | Cost |
|---|---|---|
| Chain detection | OSM `brand`/`brand:wikidata` | one tag read |
| Fame | **Wikidata QRank** — 12-month all-language pageviews per Q-id, bulk file, spike-resilient; Q-ids already attached | one join |
| Article substance | Wikimedia's published 6-feature quality formula (length .395, refs .181, sections .123, links .115, media .114, cats .070, P95-capped) — offline-computable | fetch we already make |
| Commons photo count | already fetched for imagery | reuse |
| Gov designations | already have City/County/State/Water-Mgmt; add **NPS National Register** bulk dataset ("on the Register since 1974" — citable) | one dataset |
| OSM care signals | tag richness (have), `check_date`/edit recency, `cuisine`, acreage (FDEP/EBRPD already fetched) | reads |
| Cross-source corroboration | `buzz`/`srcCount` — but re-semantized: independent-publisher families count; aggregator cross-posting dedup'd; **identical-title multi-metro cross-posting counts NEGATIVE only with spam correlates** (same organizer + non-venue-anchored + workshop/price-band pattern, or single-family corroboration) — national tours legitimately post identical titles, and the Everywhere mandate makes multi-metro presence normal for exactly the biggest legitimate events | code |
| Events↔places join | build-venues.mjs already canonicalizes venue coords → "N listed events at/near this place" — the only honest activity signal needing zero external crawl | code |
| Organizer/source track record | retain prior snapshots: past listings, "page survived its date" — the offline analog of the Eventbrite fraud dataset's killer feature (`num_previous_payouts`: junk ≈ 0, legit ≈ 10+) | keep history |
| Listing-completeness lint | the Luma featuring rubric + RA title hygiene, fully machine-checkable: length/specificity, emoji/CAPS density, venue-name-in-title, image present, in-region | code |
| Velocity | snapshot-over-snapshot deltas of pageviews / event-frequency / OSM edits — **requires starting the signals archive NOW** (§12) | archive |

**2c. Will NEVER have — and the honest substitutes** (b5 §7, verbatim posture for the spec's rationale):

| Never | Why | Honest substitute |
|---|---|---|
| Review corpus / star ratings | no accounts, ever; synthesizing = fabrication | Bayesian shrinkage applied only to derived proportions (corroboration rates, verification pass-rates via Wilson LB) — never a pseudo-rating |
| Review velocity | no review stream | snapshot-delta velocity (§2b) |
| Clicks / engagement / CF / learning-to-rank | no analytics (ratified); no labels; opacity violates "honest and sourced"; a trained model is a standing op | decomposable hand-weighted formula + a 50–100-pair human pairwise-judgment set as a regression smoke test (LTR's loss function as a test, no model) |
| Demand measurement generally | free signals measure **institutional care and documentation**, not demand | named honestly: a great 2-year-old informal taqueria may have near-zero footprint everywhere. No scoring fixes this — so never gate on a single signal family, and say so in-product |

## 3. Scoring architecture (ONE recommendation, composed from the scouts' candidates)

**Shape: FLOOR → CAPTURE → DETERMINISTIC CORE → LLM GATE → TIER ASSEMBLY.** The deterministic core is
scout b5's Architecture A skeleton (gates → two axes → assembly) with Architecture B's rank fusion (RRF)
as the fusion operator inside each axis, and C's empirical-Bayes shrinkage reserved for proportion-type
evidence only. It bolts on at the seams that already exist: events at finder.mjs:2139–2196 (the map
where categorize/tagsFor/hotScore run — after merging, before the gem shelf and emit); places as a
sibling of `hiddenScoreOf` at places.mjs:551.

1. **The quality FLOOR** (defect removal — dedup, canonicalization, junk-class drops, freshness) is
   **v1-road work under the dependency gate**, largely shipped; this spec documents and pins it as named
   invariants but adds nothing to a v1 Stage. Remaining floor gaps are §12 graft *proposals*. Hard drops
   remain legitimate ONLY for non-listings/non-places (procurement rows, beacons, zoo interiors) and
   out-of-PRODUCT-scope records (virtual webinars, out-of-market leaks — scoping calls, named as such,
   folded into the §13.2 ruling) — existing precedent (schedule-page drop finder.mjs:2001; brewery/school
   filters places-sources/osm.mjs:216–261). **Placeholder-date rows are NOT drops**: a real Bucs game
   wearing a fabricated date is a no-fake-data defect in the DATE, not a non-event — the honest fix is
   strip-the-date → ship the date-unknown state the code already supports (fmtDateKey renders "Date TBD",
   finder.mjs:1467), with R3's `dateSpecific` check capping promotion (R2 forbids hiding).
2. **Signal capture** — the normalization-contract change (the real work; the scorer is the easy half):
   add organizer, eventStatus, raw category list, pre-truncation descLen, RSVP counts to `normalize()`/
   `normalizeModuleEvent()`/mergeCluster; emit the discarded place signals (§2a).
3. **Deterministic core — two axes, never pre-blended** (the load-bearing decision, b5 §2):
   - **SUBSTANCE** = RRF over the category's *declared signal menu* (museums: article quality +
     designation; taco stands: longevity + OSM richness + locals-asymmetry — don't score a taco stand
     on article length), percentiled **within category**, small categories shrunk toward the citywide
     distribution (IMDb-m). **FAME** = citywide percentile over QRank ⊕ Commons count ⊕ srcCount.
     Both ship as separate fields so surfaces choose the mix and gem detection stays possible.
   - **Events**: CONFIDENCE = authority-weighted corroboration (source-family dedup'd; multi-metro
     identical-title negative per §2b's qualified signature) × organizer track record × venue prior (an event at a place the scored
     places layer trusts inherits trust — the offline DICE partner gate; with a public-space resolution
     path so parks/pop-ups aren't unfairly demoted) × completeness lint (weight capped — sloppy listings
     for great events exist). RANK ∝ CONFIDENCE / (hours-to-start + 2)^g with staleness decay on
     last-corroborated. `hotScore` is **decomposed, not patched**: corroboration → CONFIDENCE; imminence
     → render-time heat; staff-pick stays a separate editorial flag; the +8 image bonus is dropped
     (a data-coverage artifact that biases against the ~95%-photoless honest majority Aurora serves).
     This re-orders every ranked surface → a mandatory ordering-simulation gate before any "verified"
     claim (Stage B lesson).
   - **Junk-class caps**, generalizing the one right embryo in the codebase (ANCILLARY_TITLE_RE capping
     parking listings at 40): generic-name classes, unresolvable venues, first-seen organizers get
     *score ceilings with logged reasons* — demotions, never drops. Chain and tribute-bill caps are
     CONDITIONAL on rulings §13.2/§13.3, and any ratified demotion is badged in-product ("chain",
     "tribute") so the reorder stays visible — an evidence-defying invisible ceiling would strain
     "rankings honest and sourced."
4. **The LLM gate** (§5) contributes per-criterion binary checks; it can only **cap or fail-to-promote**.
5. **Tier assembly** — two distinct emitted vocabularies, deliberately not one:
   - **`qualityTier`: `top` / `solid` / `listed`** — orders and badges every surface. Computed
     deterministically in pipeline code from the axes + caps + LLM checks. `top` requires: passes all
     LLM checks + no junk-cap + evidence ≥ recommended. `listed` is a floor, not a hole: every row keeps
     full reachability (see-all, search, deck cumulative re-deal) — **count-preserving is a smoke-asserted
     invariant** (rows in == rows out).
   - **`evidenceTier`: `candidate` / `recommended` / `top-placement`** — Addendum G verbatim (1 source /
     ≥2 independent signals / ≥3 independent source families; same family counts once; OSM/Wikidata =
     identity not popularity). This gates **claim language** only: "best"/"#1"/"most popular"/"locals
     love" forbidden below top-placement; flat signal renders BROWSE, not ranking (G.2/G.3).
   - Surface assembly: order by tier → score; MMR re-rank (λ≈0.7) for category/neighborhood diversity;
     k reserved gem slots per shelf; ISO-week-seeded gem rotation (deterministic, testable).

**Designed for SF's poverty, not Tampa's richness** (the Stage-D lesson): buzz is near-dead in SF
(1.7% ≥2, max 2), srcCount maxes at 2 (`classics()` srcCount≥3 returns an EMPTY shelf there), price
coverage 21%, zero editorial source — so weights are config with per-TIER defaults (hand-tuned only
for T1 flagships — §9's Everywhere-scale posture), percentiles/ranks self-calibrate per city (RRF's
free portability), and organizer/venue/text signals must carry the score. A buzz-weighted design
would silently degrade city #2. Signal menus are GLOBAL, not per-city; the initial menu set is the
shipped category vocabularies of events.json/places.json, and the menu owner is this spec — changes
are spec amendments, not config drift.

**Build phasing** (the adopted spine was explicitly phased; a solo builder ships this in cuts, not one
mega-build):

| Phase | Scope |
|---|---|
| P1 | G-Q2/G-Q3 floor + signal capture (§3.2) + junk-class caps + simple within-category percentile tiers + count-preserving smoke |
| P2 | RRF fusion + shrinkage + MMR + quadrant gems + blocked fuzzy dedup (§6) |
| P3 | LLM gate + verdict ledger + golden set (§5) |
| P4 | Series entities + organizer/venue ID tables + velocity/track record (needs G-Q4 history) |

## 4. Hidden-gem detection (honest and sourced)

Replace/absorb `hiddenScore` v1 — it currently gem-qualifies Starbucks (3) over Gladys E. Douglas
Preserve (1). Definition: **gem ≔ tier ≥ solid ∧ SUBSTANCE ≥ P75 (within category) ∧ FAME ≤ P40
(citywide)** — the quadrant gate — with the residual variant (gems = large negative residuals of fame
regressed on substance) as the per-city auto-calibrating upgrade. Requirements beyond the quadrant:
a **positive distinguishing signal** (niche amenity, preserve designation, evidence mention, imagery
verification tier) AND a chain/generic hard exclusion from the *gem badge* (not from listing). Locals
proxies: `_touristM` distance (already computed), source-mix asymmetry (in OSM/gov but absent from
tourism-board feeds), photo-source asymmetry (Mapillary-present/Commons-thin leans local — **T1-only
evidence**: Mapillary doesn't run at T2+, so absence there is OUR coverage choice, not a fact about
the place). **One
vocabulary**: today "gem" means two different things (event shelf = single-family buzz; place
hiddenScore = name heuristics) — this spec unifies both under the quadrant definition, or the
divergence leaks into guide copy. Every gem badge decomposes into named sourced signals ("17 OSM
tags · county preserve · 8mi from tourist center") — the "why this is here" chip converts the honesty
contract into a product differentiator. The existing Josh/Charles eyeball pass before a gem shelf
ships stays (episodic, not standing).

## 5. The LLM quality gate (the third instance of a proven pattern)

Modeled on the shipped Mapillary sign-verification gate (mapillary-stageb.mjs:139–141, 266–291):
deterministic guard → LLM verifier → receipt → **fail-closed** ship/no-ship — applied to text at ~1/10
the per-item cost. Production precedent: Bing LLM relevance labeling (more accurate than human labelers
at a fraction of the cost, arXiv:2309.10621), OpenAI rubric moderation, Prometheus (a rubric lets a
13B-class model match GPT-4 judge quality, 0.897 vs 0.882 Pearson — the rubric does the work, so
Haiku-class suffices for bulk).

**Binding rules (b6 §8, adopted):**
- **R1 Evidence-grounded**: the judge grades the structured record and may only assert what it quotes
  verbatim; the pipeline **substring-verifies every evidence span** (~5 lines, deterministic);
  unverifiable verdicts are discarded fail-closed. This is also the sycophancy/injection defense — a
  4-word adversarial suffix inflates absolute judge scores 3.73→4.74/5 (arXiv:2402.14016) and venue
  marketing copy is attacker-controlled input (R7: item text is untrusted data-not-instructions).
- **R2 Tier, never filter**: the gate may block *promotion* fail-closed (an item can't claim `top`
  without receipts) but never reachability. No hidden-by-AI state exists, in code or spec language.
- **R3 Pointwise, rubric-anchored, per-criterion BINARY checks** (realVenue / dateSpecific / descHonest /
  priceplausible / isEvent …) — no 1–10 holistic scores, no pairwise at corpus time (position bias,
  O(n²)). Tier is computed deterministically in pipeline code from the booleans, never emitted by the model.
- **R4 Determinism by ledger, not sampler**: temp-0 is NOT deterministic (batch-variant kernels; newer
  Anthropic models drop the param). Cache key = sha256(item) × rubricVersion × modelId × promptHash;
  the **verdict ledger commits to the repo** like the Mapillary cache; unchanged items replay
  byte-identically; Tampa fixture regression per the imagery-lock discipline. Verdicts key on **D-G2
  stable event IDs** / place keys — D-G2 is a hard prerequisite.
- **R5 Versioned rubric + pinned model + golden-set promotion gate**: ~100–200 Josh-labeled items
  (events + places, per criterion); a rubric/model bump forces full re-judge + golden re-run;
  promotion blocked below precision/recall thresholds; disagreements fix the rubric text, never
  individual verdicts (the OpenAI loop — keeps humans episodic, zero standing ops). Rubric is
  city-agnostic from day one; the golden gate runs per capture-REGIME, not per city — SF (a new
  regime) will surface criteria Tampa never exercised; T2+ cities reuse the frozen set (§9). Judge-model retirement is routine maintenance with a written runbook (deprecation →
  rubric bump → re-judge → golden re-run).
- **R6 Fail-closed everywhere**: parse/schema/API/timeout/budget failure → default tier, visible,
  logged. An outage degrades to "no quality tiers," never "missing items" or "unearned promotions" —
  the exact inversion of the fail-OPEN bug behind the 4 Tampa imagery false positives.
- **R8 Escalate, don't gold-plate**: Haiku-class single-pass bulk; k=3 / small cross-family panel
  (PoLL: 3 small judges beat one GPT-4 at ~1/7 cost) only on `top`-tier promotions (~5% of items).
- **R9 Build-time only**; **R10** every "verified" claim gets an independent adversarial REFUTE sample
  (eyeball the items, not just the labels — the adversarial-verification lesson).

**Cost math** (Haiku 4.5 $1/$5 per MTok; worst case 8,000 items/city × ~4.8K in / 250 out): ~$48 naive
→ ~$20 with prompt caching (rubric prefix must be ≥4,096 tokens or Haiku caching silently no-ops) →
**~$10 with Batch API** → **~$1–2 incremental** at 10–20% churn under the ledger; panel adds ~$1–3;
Sonnet-class full corpus ~$30–60. Two cities weekly ≈ a couple hundred dollars/year. **Cost is a
non-issue and may never be cited to cut an honesty mechanism**; per-refresh cost telemetry with an
order-of-magnitude alarm.

## 6. Dedup & canonicalization upgrades

- **Blocked fuzzy dedup**: block by (date-bucket ±1 × venue-ID-or-geohash), then token_set_ratio
  (~85–90, fuzzball.js) with tiebreakers (start-time proximity, ticket-URL host, image hash) — the
  SeatGeek playbook (naive edit distance scores the WRONG pair higher: ratio('NEW YORK METS','NEW YORK
  YANKEES')=75 > ratio('YANKEES','NEW YORK YANKEES')=60). Closes both known seams from §1-J6: relax
  same-family venue-equality inside a title-block, and canonicalize address-as-venue records (grow the
  SF venue table — 22 rows is too thin; it is fb00c77's hand-culled build-venues.mjs output, and that
  commit documents the generator's Tampa-flavored GENERIC token list shipping real poison, e.g. a bare
  "San Francisco" alias — city-config the token list before re-running, then re-cull).
- **Canonical venue + organizer ID tables** — first-class entities with stable IDs (Bandsintown's
  venue-DB-admission model), seeded from the places snapshot; unresolvable venue = a scored demerit,
  never a drop. Extends **D-G2 stable event IDs (already a ratified Stage-D graft)** from events to
  venues/organizers — D-G2 is the identity substrate for score caching, the verdict ledger, and any
  cross-run learning.
- **Recurring-series collapse** — same canonical venue + organizer + near-identical title at a cadence
  → one series entity with instance children (Google eventSchedule canon); stops weekly trivia/tribute
  bills wallpapering the weekend deck while keeping every instance reachable. Supersedes the boolean
  `recurring` (VSPC `dates[]` and stpete rrules are currently collapsed to a bool).
- **Cross-snapshot memory**: retain prior snapshots (organizer track record, per-source per-field
  reliability, "page survived its date"); SF starts history-less → seed priors by source TYPE
  (institutional calendar > ticketing platform > open aggregator).

## 7. Data contracts (what each consumer gets)

**Q→app** (the only new data surface; the evidence ledger stays finder-side, the app ships tiers +
counts + a few receipt strings): per-row fields keyed on D-G2 `id` / place `key`: `qualityTier`,
`gem`, `fame`, `substance`, `evidenceTier`, `receipts[]` (short sourced why-strings), plus
`buzz`/`srcCount` formalized. The ≤4MB/city budget gets arithmetic, not a hand-wave: Tampa ships
2.98MB raw today, so the new fields carry a byte budget — `receipts[]` ≤2 strings × ≤80 chars, emitted
on `top`/`recommended` rows only — and share the 4MB with later Foundry enrichments (daypart-fit, vibe
tags, pairing graph); a raw payload-size smoke assertion joins §11 (gzip headroom is fine; raw, which
mid-Android must parse, is not). Invariants: count-preserving; deterministic with frozen inputs (new
fields amend the Tampa byte-identical baseline the D-G2 way — named, once, collision-checked).
**"Frozen inputs" is enumerated, not implied**: the signals archive (§2b velocity/track-record,
~3MB/snapshot/city raw), the verdict ledger, and every external bulk join (QRank file, Wikimedia
quality fetches, NPS dataset) are named, versioned, hash-pinned inputs of the deterministic baseline,
committed like the Mapillary cache — the finder runs on one logged-in Windows PC (V2_VISION Layer
Zero #1), so an un-pinned archive dies or migrates silently and re-ranks every surface with no test
failing, and mid-run re-fetches shift fame percentiles on an unchanged corpus. Degraded mode when
history is absent = the seeded source-type priors (§6), logged and visible. `events.json`/`places.json`
remain fact layers, ledger beside them (G.7 verbatim); sponsored can be capped, never boosted.
Primary renderer: [premium-ui.md](premium-ui.md) §3.S9's receipts chrome — the visual definition is
that spec's territory; the fields, tier vocabulary, and byte budget are this one's.

**Q→personalization** (smart-engine): quality order = the base sort AND the cold-start answer;
taste applies its bounded nudge (≤ +18) on top; muted categories still appear; **nothing flows P→Q**
(taste never reaches the build — zero-backend makes per-user builds impossible anyway).

**Q→curation** (guides): guides may only make ranking claims at the granted `evidenceTier`; per-pick
reasoning cites `receipts[]`; the FB-A blocker resolves to "unblocked BY the quality engine per topic"
(ranking language unlocks when a topic hits top-placement — "ranking is earned, with sources shown").
The `places.js:242–250` beach-ranking fossil (pulled before commit because any score over flat signal =
fabricated authority, smoke-guarded) is exactly what this contract re-enables honestly.

**Q→Coverage Card (D-G1)**: per-tier honest inventory counts become one deterministic derivation of the
same ledger — one honesty surface, one source of truth. D-G1 LANDED with smoke-pinned derivations on
coverage.js (PR #12), and V2_VISION §8.8 promotes the card to the binding honesty surface of the whole
expansion — so this re-derivation amends those pins the D-G2 way (named, once, collision-checked), not
as a free change.

**One-line amendments the two stubs need** (done in the fold-in pass):
- *smart-engine.md*: add a does-NOT-own fence (objective scoring = quality's lane); resolve open
  decision "cold-start" → the quality-ordered feed; resolve "re-ranking vs influencing the finder" →
  influencing = quality, re-ranking = smart-engine; line 21's "feed taste back into generation" →
  per-user ordering only — **NOT a silent stub edit**: this narrows the stated ambition of the v2
  centerpiece (smart-engine.md:21/:33; BACKLOG.md:57 calls the tie-back "the real point of v2"),
  forced by zero-backend, and is flagged as ruling §13.10; repoint the Addendum G prior-art line here.
- *guides-and-rankings.md*: move the evidence/corroboration mechanism here (guides keep topic, POV,
  per-pick reasoning, page design); repoint the FB-A blocker; import G.3's claim-language gate verbatim;
  mark community rankings as needing their own future ruling (collides with zero-backend AND
  zero-standing-ops moderation).
- Also touch: README.md registry row; V2_VISION Foundry bullet (name quality as its first stage);
  BACKLOG v2 table third row; banner PHASE_3.7 Addendum G as absorbed.

## 8. Sparse-city floor (SF week one — the mandatory Layer-Zero answer)

By construction, honest: with few sources most SF items land `evidenceTier: candidate` → **browse
language everywhere**, no superlatives — matching the D-G1 Coverage Card posture ("what we know here").
`qualityTier` still functions because it leans on signals SF has (Wikidata 6× denser than Tampa,
organizer/venue/text quality, gov layers); rank-based fusion self-calibrates to the thinner
distribution. The empty-`classics()` shelf gets replaced by tier-ordered selection. STAGE_D's honesty
skips (FunCheapSF/SF Station — "aggregating an aggregator's curation is not honest sourcing") stand:
quality is COMPUTED at SF's poverty level, never borrowed from an editor.

## 9. Ops honesty (zero standing human ops)

**Runs unattended at every refresh**: full pipeline incl. floor, scoring, LLM gate (ledger-cached,
$1–5 incremental), anti-junk benchmarks, count-preserving smoke, cost telemetry. **One-time per T1
flagship city only** (see the scale posture below): golden-set gate run (+ SF-delta labels — bounded
to city #2, a new capture-regime, not a per-city ritual), source-registry review, gazetteer review
(existing v1 cost), seeded source-type priors. **One-time ever**: Josh golden-set labeling session (~100–200 items, the
critical path — engineering is not), the 50–100-pair pairwise-judgment set (Josh/Charles, ~1 hour),
the rubric. **Episodic, not standing**: rubric edits on golden-set disagreement; judge-model retirement
runbook. **Explicitly forbidden**: any human scoring queue, per-item review, moderation — the engine
must not become The Regular in disguise (V2_VISION §2). Yelp Events is the empirical warning: quality
performed by headcount died with the headcount; quality encoded in the pipeline is the only durable
posture available to us.

**At Everywhere scale (V2_VISION §8.8/§10 — the binding 50→300-city mandate).** The per-city
ceremonies above are T1-flagship onboarding, not the growth path: at 300 cities "one-time per city"
IS a standing human op — or it silently stops running and mints unearned "verified" claims (the
Stage-B failure mode). Tier posture, pinned here so no mechanism leaks past its tier:
- **T1 (flagships)**: the full protocol — golden gate run, Josh/Charles gem-shelf eyeball, local
  vouch (§11.2), hand-tunable weights.
- **T2 (top ~50→300)**: ledger-cached LLM gate + the FROZEN city-agnostic golden set (re-run per
  capture-regime, never per city; zero per-city labels), per-tier default weight configs, sampled
  golden audit per V2_VISION §10.3.5 — all inside the 30–45 Josh-minute onboarding budget (§10.3.7).
- **T3 (floor)**: deterministic core + caps only.
T1-only mechanisms, named so they can't masquerade as city-N facts: the local-vouch test (no local
exists for city N — not an acceptance gate below T1), the eyeball pass, and §4's Mapillary-asymmetry
gem proxy. Cost at mandate scale is unresolved: ~$1–5 incremental/city/refresh naively extrapolates
to ~$15k–78k/yr at 300 weekly cities. Tiered cadence, thinner T2/T3 corpora, and ledger cache hits may
change that materially, but no lower band is claimed without per-tier corpus sizes, cadence, cache-hit
assumptions, and measured N=2 runs. §13.8 requires that formula at N=50/300; judge-model retirement is
an N-city re-judge event, so the runbook carries an N-city cost line. Everything here stays under the
ratified Josh gates: standing audit ≤2 hrs/week with auto-pause.

## 10. What we will NOT do (rationale on the record)

No synthetic ratings · no collaborative filtering · no learning-to-rank · no engagement signals ·
no Google/Yelp/Ticketmaster review APIs (fail-closed compliance, G.5) · no pay-for-placement inputs ·
no crawler until Evidence Phase 3, last-sequenced exactly as G.6 ordered (ledger → scoring →
allowlisted extraction). The structural blind spot is named honestly: our signals measure institutional
care, not demand; a beloved informal newcomer can be invisible to every source — mitigated by never
gating on a single signal family, and accepted as the cost of the no-fabrication contract.

## 11. Acceptance metrics (REFUTE-style, per the adversarial-verification lesson)

1. **Zero-junk audit**: an independent (non-self) pass samples 50 `top`-tier events + 50 `top`-tier
   places per city; **zero items from the §1 taxonomy classes** = pass (J7/P1 count only after rulings
   §13.2/§13.3 land, and only as ratified — badged demotion, not absence). Eyeball every item,
   including the obvious ones.
2. **Gem vouch test** (T1 flagships only — NOT an acceptance gate below T1, per §9): for a home city,
   ≥10 gems a local (Josh for Tampa) would vouch for unprompted; for non-home cities, an adversarial
   agent pass over gem receipts replaces the vouch. Gem slots (§3.5) are a cap, not a quota — a sparse
   city's shelf shrinks honestly below k (the empty-`classics()` lesson). Zero chains/generics wearing
   the gem badge; Gladys E. Douglas Preserve class beats Starbucks class — asserted as a named fixture
   test.
3. **Dedup spot-check**: 100 sampled clusters; FP (wrong-merge) and FN (surviving dupe) rates measured;
   the two named seams (Castro Art Mart, Temescal) become regression fixtures.
4. **Ordering simulation gate**: the hotScore decomposition ships only after a full ordering/coverage
   simulation (Stage B lesson — the live "it works" once missed a 45/453 deck-coverage bug).
5. **Pairwise-agreement smoke**: scoring changes must not degrade agreement with the 50–100 human
   pairwise-judgment set.
6. **Count-preserving assertion**: rows in == rows out, every run, smoke-asserted — plus the §7 raw
   payload-size assertion (bytes/city under budget).
7. **Anti-junk benchmarks** in the places.mjs benchmark block: 0 color-trail records above `listed` or
   on the gem shelf; 0 chain cafes above `listed` (conditional on ruling §13.2); no gem-shelf record
   below an amenity floor; SF cafe-share ceiling — plus a fix for the gov-noise benchmark that
   currently prints a false PASS.
8. **Claim-language test**: no best/#1/most-popular string renders below top-placement (G.7's test,
   inherited verbatim).
9. **LLM-gate calibration**: precision/recall per criterion vs the golden set clears thresholds before
   any ledger promotion; adversarial REFUTE sample on every promotion.

## 12. Post-v1 sequencing candidates (proposals ONLY — each needs a ruling)

V1 shipped the thin version (hotScore/hiddenScore/buzz plus floor machinery), and D-G2 stable IDs
landed. The table below is now a triage choice: bounded H0/Layer-Zero hardening that can start
immediately versus work that waits for this full workstream to be ratified.

| # | Graft proposal | Why now | Size |
|---|---|---|---|
| G-Q1 | **Stale-snapshot deploy guard** — refuse deploy if generated > N hours; surface generation age | A redeploy currently refreshes HTTP `Last-Modified` even when the underlying artifact is old. V2_VISION §5 gates kickoff on truthful freshness and production/refresh proof. | tiny |
| G-Q2 | **Quality-floor punch list** (b1 §6): price-plausibility on min-price merge · stpete virtual filter · coordless out-of-region address check · "Pre-Proposal"/RFN noise terms + benchmark fix · (Date: TBD)/Rescheduled title parse · "Overview" chrome strip · emoji strip · read `eventStatus` | Each is a shipped named defect; deterministic, independently fixable | small |
| G-Q3 | **Emit the discarded signals** (organizer, descLen, raw categories, `_osmTags`, `_govBacked`, `osm:{type,id}`, imageRank) | One-line emits; every V2 scorer/ledger joins on them; retrofitting is expensive | small |
| G-Q4 | **Start the per-snapshot signals archive + snapshot retention** | Every velocity/track-record feature depends on history that doesn't exist until we keep it — start NOW | tiny |
| G-Q5 | **Read OSM `brand`** → chain cap + badge + gem-shelf exclusion, per §3.3's posture (drops stay reserved for the §13.2 ruling — chains are in-scope real places, 13 with sign-verified photos) · extend GENERIC_PLACE_NAME's gem-exclusion + amenity-chip demotion to color-trail/launch/dock *facility-geometry* names (the W7 pattern, places.mjs:474/:506 — the existing drop precedent covers bare facility nouns, never destination records) · city-config build-venues.mjs's Tampa-flavored GENERIC token list (fb00c77's documented "San Francisco"-alias poison; its 22-row SF table is already that commit's hand-culled output), then re-run + re-cull | Demotes the 78-Starbucks and Red-Trail classes off every curated surface with zero never-hide breach | small |

## 13. Open decisions (flagged for Josh / Charles)

1. **⚑D-EVID formally resolved?** Proposal: yes — this spec is Addendum G's home; Phases 1–3 absorbed
   as §3/§7/§10 with the crawler last. Needs Josh's nod since ⚑D-EVID was never ruled.
2. **Chain posture + the drop boundary** (never-hide tension): chains are real places. Proposal:
   `listed` tier + a "chain" badge, gem-excluded; hard drop only for non-places (beacons,
   in-attraction POIs). The same ruling covers placeholder-date rows (demote to the date-TBD state,
   never drop — §3.1) and the virtual-webinar scoping drop (out-of-PRODUCT-scope, not "non-event").
   Josh to confirm demote-vs-drop for each class.
3. **Tribute-bill demotion** — a taste judgment wearing a quality hat. Proposal: junk-cap on prominence,
   badge honest ("tribute"), never hidden. Josh to ratify it's a call we're allowed to encode.
4. **Tier vocabulary** (`top/solid/listed` working names; gem badge naming) — Charles holds the art/
   language pen (non-blocking, per the standing ruling).
5. **Golden-set session scheduling** — ~2 Josh-hours labeling 100–200 items + ~1 hour (with Charles)
   for the pairwise set. The critical path of the whole LLM gate.
6. **Sequencing rulings** G-Q1…G-Q5 (§12) — which are immediate post-ship/Layer-Zero hardening versus later V2 Quality Engine work.
7. **Evidence Phase 3** (allowlisted public-guide extraction) — the only crawler-shaped piece; ToS/
   compliance posture ruling before it starts (aligns with the Everywhere-mandate ToS ruling).
8. **Judge model + budget ratification** — Haiku-class bulk + panel escalation, ~$10–30/city full,
   ~$1–5 incremental as unverified starting estimates. Ratify only after measured N=2 runs and an
   explicit tier-weighted N=50/300 formula; the mandate-scale budget remains open until then.
9. **Community-influenced rankings** — out of v2.0 (zero-backend + zero-standing-ops); needs its own
   future ruling per the V2_VISION §6 pattern. Recorded here so the guides stub can point at it.
10. **Smart-engine rescope** — zero-backend makes per-user builds impossible, so smart-engine.md:21's
    "feed the taste model back into event and spot selection… change WHICH things surface" (BACKLOG.md:57
    calls the tie-back "the real point of v2") narrows to per-user ordering only. The seam table (§0)
    assumes this. Josh to ratify the narrowing of the v2 centerpiece's stated ambition.

## Prior art (don't reinvent)

PHASE_3.7 Addendum G (:908–957, incl. the G.7 builder prompt — the spine, absorbed) · the Mapillary
sign gate (mapillary-stageb.mjs — the proven fail-closed LLM-gate pattern) · finder.mjs hotScore/buzz/
gem shelf + places.mjs hiddenScore (the v0 to formalize) · taste.js (the bounded-personalization fence) ·
build-venues.mjs (venue canonicalization + the free events↔places join) · sim-exhibit-dedupe.mjs
(dedup simulation harness) · D-G1 Coverage Card + D-G2 stable IDs (ratified Stage-D grafts this spec
stands on) · the places.js:242 beach-ranking fossil (the smoke-guarded proof that honest rankings are
blocked on exactly this layer).
