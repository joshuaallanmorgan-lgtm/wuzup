# PHASE 3.7 — Patching · Premium Product Polish · Smart Groups · Planning UX

> ⚠️ **SUPERSEDED as the plan-of-record (Gen 4 naming: 3.71–3.78, polish waves 3.7P-*, addenda A–P).**
> Most of this shipped. This is where "**3.77 / 3.78**" came from — in the live scheme that is **Stage 3 — Multi-City**.
> **One live thing still lives here:** the config-ready multi-city build packet (Addendum I / §15 — SF & East Bay corridor). Its key facts are lifted into [ROADMAP.md](ROADMAP.md) Stage 3; this doc remains the detailed source.
> Current master plan = [ROADMAP.md](ROADMAP.md) · full doc map = [INDEX.md](INDEX.md) · idea intake = [BACKLOG.md](BACKLOG.md).

_2026-06-15 · Scouted read-only against the live code (no app code touched). Branch: master-plan-2. This is the PLAN ONLY — another builder executes it AFTER Phase 3.6 lands. Same contract as every phase: each patch → build → adversarial review → hand-verify → `npm test` → live-verify → push. **No fake data; never-hide holds; taste reorders, never filters.**_

> **Scope note for the executing builder:** Phase 3.6 (the big premium pass — quiet top-nav N1 shipped `378ebd3`, then N2 type/spacing/motion, N3 copy/Charles, N4 Settings, N5 onboarding) is the foundation 3.7 sits on. **Do not start 3.7 until 3.6's tokens, LensNav, premium voice, and Settings have landed** — 3.7 builds on them and would thrash if run in parallel. Where 3.7 touches a surface 3.6 already changed (top nav, Settings, copy), 3.7 *extends*, never *re-does*.

---

## 1. Phase 3.7 thesis

**Phase 4 is the literal ship/launch phase. Phase 3.7 is the patching phase right before it.**

3.5 was cleanup; 3.6 is the big premium foundation pass. 3.7 is different in *kind*: the app is now running and usable enough that Josh is living in it daily. So 3.7 is the **tight feedback loop** — many smaller, highly-visible patches (3.71, 3.72, 3.73 …) rather than one monolith. Some patches are small and visual; some are focused product sprints. The through-line:

> Make the current app feel **premium, shippable, emotionally compelling, and genuinely useful** — much more a **personal local-life companion** than a functional directory.

The loop 3.7 runs on:

```
use the app → notice friction → patch the visible issue →
improve decision-making → improve emotional quality → repeat
```

The product thesis to reinforce everywhere: **Finch, but for planning things to do** — nature spots, beaches, parks, local events, hidden gems, casual activities, date ideas, weekend plans, low-effort outings, and the local opportunities that bigger world events create. Not nightlife-only "going out." The emotional target is *"a beautiful companion that helps me actually live a better local life,"* not *"a clean events database with good intent."*

The core loop every screen should serve: **Discover → Save → Plan → Go → Remember.** The pieces all exist today (feed, saves/shelf, day-planner, share/ICS, been-there logbook) — but they read as **separate tabs**, not one emotional loop. 3.7's job is to make that loop feel like one thing.

The single biggest shift in mindset: the app currently **shows a lot of things**. 3.7 should make it **help the user decide what to do.**

---

## 2. Current product diagnosis (audited)

This is what actually exists today (read from the code, 2026-06-15), screen by screen. Where something is genuinely unclear I say so.

### App shell / navigation
- 5 tabs, indices derived from one roster: **Events · Spots · Map · Calendar · Profile** (`nav.jsx:51`). Bottom `TabBar` (`App.jsx:32`), horizontal scroll-snap pager with lazy per-tab mounting.
- `nav.jsx` owns ALL navigation (active tab, the subpage *union*, the detail layer + View-Transition morph, detail→map handoff). `App.jsx` owns DATA (events fetch/normalize, anchors, weather, my-events, geolocation, primer gate).
- Subpage union (one slot, slides over the active tab): `bubble · placebubble · search · add · weekend · day · settings · interests · taste · deck · lensdeck`. Detail layer is a separate higher layer (`DetailPage` for events, `PlaceDetail` for places).
- **Phase 3.6 N1 already shipped `LensNav`** (`LensNav.jsx`, `topnav.css`) — replaced the loud, clipping 16-bubble strip with a calm lens-pill row + an "All categories/All spots" bottom-sheet menu. This is good and recent; **3.7 builds on it.**

### Events feed (Home / `HotView.jsx`)
- Cinematic-ish hero: real Tampa skyline image, parallax + scrim ramp, time-aware kicker (`heroKicker`, e.g. "MONDAY AFTERNOON — 9 STILL TO COME TODAY"), `CITY.name`, and the sub **"1,198 events across Tampa Bay."** The count IS the emotional center right now — the audits flag this.
- The kicker is **heavy condensed uppercase** (`heroKicker` returns ALL-CAPS) — flagged by both the ChatGPT and Gemini audits as aggressive.
- Magazine sections, in order: Saved shelf → Tonight → "Your kind of night" (taste rail, gated on 6+ real taps) → The Big One → Hidden Gems → Free → Recently viewed → Everything (curated front-page + "See all N events" escape).
- The "Your kind of night" section literally prints **"from your taps — not an algorithm cloud"** in the feed (`HotView.jsx:324`) — the Gemini audit's "show, don't tell" note lands here.
- The sections are real but **filter-shaped, not editorial** — they map 1:1 to data buckets (tonight, free, hidden-gem, taste), exactly the "obvious filter duplicate" problem Josh wants to move past.

### Event cards (`cards.jsx` + `cards.css`)
- One shared image component, `CardImg`, with a genuinely good fallback: no-image events render `imgbox-art` — a category-hue gradient + oversized rotated category emoji watermark (`cards.css:50`). `object-fit: cover` is already used; titles already `-webkit-line-clamp`.
- **BUT image aspect ratios are per-card-type, not unified:** `tcard` 280×157 (≈16:9), `fcard` 160×160 (square), `gem` 72×72, `Row` 110px, agenda `card-thumb` 58×58, `BigOne` 4:5. There's no single "card image ratio" token — the audits' "enforce a strict aspect ratio" note is about *consistency across the feed*, less about any one card.
- Posters: events are 94% real images (see §10), and they're raw third-party flyers — the "aspect-ratio chaos / loud posters hijack the feed" critique is real. The art-fallback floor is good; the *real-photo* path has no framing system (no consistent overlay/scrim, no crop discipline beyond `cover`).

### Spots (`LocationsView.jsx` + `places.js`)
- Structural twin of Events over the places store: real Spots hero (Bayshore), LensNav (Free/Hidden/Dog pills + "All spots" menu), sections: Near you (needs location) → Hidden spots → The classics (`srcCount ≥ 3`) → Free → Everything.
- **The core problem the audits hammer is real and quantified:** only **22 of 1,832 places (1.2%) have a real image** (`places.js` → Wikidata P18 only). The other 98.8% render the `imgbox-art` floor — and because places are 96% `outdoors` (hue 140 = green), the Spots feed reads as **a wall of near-identical green tiles.** This is *exactly* the "green placeholder cards feel unfinished" critique.
- Spots are also data-thin: **6.5% have a description, 23.7% hours, 47.5% a URL.** placeType is 72% `park`. There's currently **no ranking, no sourced "best of," no compare** — just an alphabetical-ish taste-reordered list.

### Map (`MapView.jsx`)
- Leaflet, cluster bubbles, top filters, a bottom count. The audits' "too many teal number bubbles / Zillow-clinical / no best-next-action" critique matches the cluster-heavy default. *(Read MapView in full before the map patch — this scout did not deep-read its interaction model; treat the map plan in §8 as directional until confirmed.)*

### Calendar / planning (`CalendarView.jsx` + `DayPage.jsx`)
- Calendar is a **pure personal logbook** (Phase 3.5 W2 — Model C): morning-after conversion card, a gentle "N days out in {month}" ledger, a month grid showing ONLY your shape (planned underline / rest crescent / did-day check), and a per-day caption. No supply/event-counts on the calendar by design.
- Tapping a day → `DayPage`: weather line, two slots (☀️ Day / 🌙 Night), a "Fill this day" deck (`DayFillDeck`), "+ Add your own," share-this-day (text + multi-VEVENT ICS), rest toggle, and the day's agenda.
- **The exact strings the Gemini audit flagged exist:** the empty slot reads **"Open — tap to plan"** (`DayPage.jsx:286`), and the calendar caption reads **"Open — tap to plan this day" / "A quiet page."** (`CalendarView.jsx:218-220`). All are marked DRAFT for Charles. The planning surface is *functional and clean* but **under-emotional** — it's a slot-filler, not yet "let's build a good day."
- Note: dayparts today are a binary ☀️/🌙. The audits want richer dayparts (morning / afternoon / evening) + energy/vibe cues — that's net-new.

### Plan builder (`PickerSheet.jsx` + `DayFillDeck.jsx`)
- The slot picker is a bottom sheet listing candidate events/places; the day-fill deck is a swipe surface. Functional, utilitarian. *(Scout did not deep-read PickerSheet's row layout — confirm before the bottom-sheet patch.)* The audits want each pick to **show why it fits** (free / nearby / rainy-day-friendly / matches taste / low-effort) and to distinguish top picks from the rest.

### Event detail (`DetailPage.jsx`) — the strongest screen
- Confirmed strongest: hero (real image or art floor, same morph target), honest When/Where/Price/Weather fact rows, a **"Why this is here"** trust block (`whyReasons` — only TRUE chips), mini-map (tap → Map tab), "All dates & venues" for collapsed series, "More like this" rail, demoted "Found via {sources}" footer, and a context-aware CTA ("Get Tickets" only when there's something to buy). This is the template the whole app's visual quality should rise to.
- Polish gaps: the fact rows use raw emoji icons (📅📍🎟️), the CTA is a flat full-width button, "Why this is here" is a row not yet a distinct *card*.

### Place detail (`PlaceDetail.jsx`)
- Event-detail's twin in place semantics: amenities chips, hours/fee, an honest weather-fit line ("Great beach day Saturday" — derived only from the real forecast), a **"＋ Make this my plan"** day-plan bridge (the strongest Discover→Plan link in the app), mini-map, "More spots like this," and a **"Sourced from {sources}"** footer. Sources are already disclosed — the foundation for "show the sources" rankings is here.

### Profile / taste (`ProfileView.jsx`)
- Taste-identity-first: a vibe header (top-category chips, free-leaning badge, when-you-go-out line, confidence-aware copy, all from real local taps), tappable chips → InterestEditor, a "Your taste" hub (why-feed + calibration deck), Your list (saves), Your plans (weekend + day history), Been there (self-reported went-list + variety firsts), Recently viewed. Logic is excellent and privacy-first. Visually it still reads closer to a long settings-ish scroll than a "rewarding, alive" identity card.

### Add event (`AddEvent.jsx`)
- One long plain form (title/date/time/venue/address/category/free/price/link/desc) → real schema-v2 event tagged "Added by you," persisted locally, merged through the same `normalize` path. **Reads exactly like CMS/admin software** — the audits' note is dead-on. Entry point is literally "Add event."

### Design system / tokens (`index.css`, `cards.css`, `modes.css`)
- Tokens exist: `--accent #0d9488` + `--accent-2 #06b6d4` (this IS the "generic Tailwind teal" both audits flag), reserved `--hot` / `--reward` (violet, 6 sanctioned moments only) / `--free`, and cool neutrals `--ink #15171c / --muted #6b7280 / --line #eceef1 / --card #fff / --bg #f7f8fa`.
- **No warm neutrals** (ivory / sand / soft stone) exist yet — the audits' single biggest visual recommendation.
- Phase 3.6 N2 added a spacing scale (`--sp-xs..lg`), motion tokens, line-height 1.5, Inter. So the *plumbing* for a premium pass is partly in; the *palette/world* is not.
- One canonical category registry (`categories.js`): 12 event categories with hue+emoji. Places map to only 3 of them (outdoors/family/sports).

### Imagery handling (pipeline — see §10 for numbers)
- Events: source-native image URLs (94% coverage), shipped as-is (no CDN/resize/framing).
- Places: `places-images.mjs` (Wikidata P18 → Commons, 1.2% coverage) + `places-descriptions.mjs` (Wikipedia, 6.5%). **The honest image contract is load-bearing: a place only ever shows a REAL photo of THAT place, or the category-art floor. No type-photos** (a generic park photo on a specific park = soft fabrication, already rejected in 3.5). Any spots-imagery plan must live inside this rule.

**Net diagnosis:** the foundations are unusually strong and unusually *honest*. The gap is (a) a premium **brand world** (warm palette, editorial type, framed imagery), (b) **spots feeling collectible** despite thin photos, (c) the planning loop feeling **emotional and decision-supporting** instead of slot-filling, and (d) the magazine sections becoming **smart/curated** instead of filter-shaped.

---

## 3. Core product gap

**Today the app answers "what's listed?" Phase 3.7 should make it answer "what should I do?"**

Everything in 3.7 should push on one axis: **decision support.** Concretely the app should get visibly better at helping the user answer:

- What can I do **tonight**?
- What should I do **this weekend**?
- Where should I go if I want a **beach day**?
- **Where should I watch this game?**
- What are the best local options **around this bigger event**?
- What should I do with a **free afternoon**?
- What's good if I want something **low-effort** / **healthy & outdoorsy** / **for a date** / **if it rains**?
- **What's worth my time?**

The levers, in priority order:

1. **Curation & smart grouping** — bundle scattered listings into meaningful, decision-shaped units (§4, §5).
2. **Emotional motivation** — copy + hierarchy that says "there's still time to make today good," not "1,198 rows."
3. **Trust & sourced recommendations** — where we rank or recommend, *show why and show the source* (the app already discloses sources; lean into it).
4. **Connect spots/events to actual day planning** — the Discover→Plan bridge exists on PlaceDetail ("Make this my plan"); make it pervasive and obvious.

The honesty contract is the *constraint that makes this credible*: never-hide, no fake data, real-or-art images, taste-reorders-never-filters. A "best beaches" ranking is only allowed if it's built on real signal (source corroboration `srcCount`, real amenities, real designations) and shows its sources. That constraint is a **feature** here — it's the trust moat.

---

## 4. Smart Groups / Smart Planning Groups (deep dive)

This is the headline new direction. The concept: instead of disconnected listings, the app understands **intentions and moments**, and bundles the relevant local options around them.

> "There's a World Cup game. Want to watch it? Here are all your options in Tampa." — that's the target experience.

### 4.1 The mental model: three flavors of group

The single word "group" is hiding **three structurally different things**. Naming and data both get easier if we separate them:

1. **Intention groups** (evergreen, derivable today): "Beach day," "Low-effort tonight," "Rainy-day backup," "Free outdoor reset," "First-date friendly," "Solo reset." These are **derived from existing fields** (category, tags, `isFree`, `placeType`, `srcCount`, weather) — zero new data. They're durable; they never go stale.
2. **Moment / world-event groups** (timely, mostly curated): "Where to watch the World Cup," "Gasparilla weekend," "Fourth of July." These hang off a **bigger external event** that the app's data doesn't model yet. They are **time-boxed** and need a thin editorial/curation layer (and/or keyword matching) — see §10.
3. **Place "best-of" / ranked guides** (sourced): "Best beaches under 30 minutes," "Top dog parks." These rank **spots** using real signal + display sources (§6).

Calling all three "Smart Groups" is fine as an umbrella, but **build them as three pipelines** (derivable now / curated timely / sourced ranking). They share one *UI primitive* (a tappable guide card → a guide page) but different *data sources*.

### 4.2 Naming — options & tradeoffs (don't pick instantly)

| Candidate | Reads as | Tradeoff |
|---|---|---|
| **Smart Groups / Smart Event Groups** | what they are internally | "smart" is a tell-on-yourself word; sounds like a settings feature, not editorial. Fine as the *internal* name, weak as a *user-facing* one. |
| **Smart Planning Groups** | planning-forward | accurate but clunky; "planning groups" implies people, not plans. |
| **Plan Packs / Day Packs** | bundled, actionable | friendly, ownable, app-y; "pack" nicely implies "everything you need for X." Slightly gamic. |
| **Guides / Local Guides / City Guides** | editorial, premium | matches the "field guide for your city" brand world best; timeless. Risk: generic if everything is a "guide." |
| **Field Guide Sections / Moment Guides** | the brand thesis | "Field guide" is the strongest brand fit (warm, local, nostalgic). "Moment Guides" captures the timely flavor well. |
| **Watch Guides / Watch Parties** | the World-Cup case specifically | perfect for #2, too narrow as the umbrella. |
| **Hubs (Event/Moment/Occasion Hubs)** | aggregation around a thing | "hub" reads techy/dashboard — against the premium-warm direction. |
| **Situation Cards** | decision-shaped | captures "what do I do if it rains" well; a little clinical. |

**Recommendation (for Josh/Charles to ratify, not a lock):** lean into the brand world. Use **"Guides"** as the user-facing umbrella (it carries the field-guide premium feel and covers all three flavors), with **the World-Cup-style ones surfaced as "Watch Guides"** when relevant. Keep **"Smart Groups"** purely as the internal/engineering term. Avoid "hub"/"smart" in UI copy. This is a **⚑ Charles/Josh brand decision** (§12).

### 4.3 What groups cover (the catalog)

Intentions (derivable): tonight / this weekend / beach day / rainy day / date night / low-effort evening / free outdoor reset / healthy Saturday / solo reset / good with a group / morning outside / after-work decompression / three-hour adventure / Sunday reset / nature without a full hike / hidden nature resets / local classics.

Moments (curated/timely): sports watch parties (World Cup, Super Bowl, local teams) / festivals & seasonal (Gasparilla, holidays) / recurring community happenings (markets, first-Friday).

Sourced rankings (spots): best beaches / best parks / best dog parks / best sunset spots / best trails — each ranked on real signal, sources shown.

### 4.4 The key principle (repeat it in every patch)

> Groups are **not filters with nicer names.** A filter says "here are the 1,130 free things." A guide says **"here's a free afternoon worth leaving the house for, and why."** The difference is *editorial intent + decision support + a plan you can act on*, not a query result.

Practically that means a guide card should usually carry: a **point of view** (one editorial line), a **small curated set** (not the full N), a **reason each pick belongs**, and ideally a **plan action** ("Build this beach day" → seeds a DayPage). If a "guide" is just `events.filter(free)`, it has failed and should stay a lens, not a guide.

---

## 5. Magazine / editorial expansion

The original magazine idea (tappable pop-up sections) was right; 3.7 makes it **smarter and more intentional**. Today's sections (Tonight/Free/Hidden/Big One) are the *v1 magazine* — they work but are filter-shaped. The evolution: **editorial planning modules** that double as **planning primitives**.

### Better sections (replace generic with meaningful)
Retire filter-echo titles like "$0 well spent / Free." Move toward decision-shaped editorial:

- **"Still time to make today feel like something"** (the hero's emotional center — see §8 Home)
- **"Best ways to spend a free afternoon"**
- **"Where to watch the match"** (Watch Guide, timely)
- **"Build a beach day"** (sourced + plan action)
- **"Low-effort plans near you"**
- **"Worth leaving the house for"**
- **"Hidden nature resets"** · **"Rainy-day backups"** · **"First-date friendly"** · **"Good with a group"** · **"Solo reset"** · **"Healthy Saturday"** · **"After-work decompression"** · **"Sunday reset"** · **"Three-hour adventure"** · **"Free outdoor reset"** · **"Local classics"** · **"Trending this weekend"**

### As UI modules (two shapes, reuse what exists)
1. **Inline section** — a `SecHead` + a carousel/rows, same as today's magazine sections (`cards.jsx` `SecHead` + `.carousel` + `RowFeed`). The cheapest upgrade: swap a filter section for an *editorial* one (better title, a one-line POV in `sub`, a curated subset).
2. **Guide card → Guide page** — a distinct **GuideCard** (tappable, editorial, image/art + title + POV + count) that opens a **GuidePage** (a new subpage type, mirroring `BubblePage`). The GuidePage shows the curated set, per-pick reasons, sources where relevant, and a plan CTA. Reuse the `BubblePage`/`PlaceBubblePage` machinery (it's the proven "tap a thing → a filtered destination page" pattern).

### As planning primitives
A guide should be **plannable**, not just browsable. Wire guides into the existing Discover→Plan bridge:
- A beach-day guide → "Build this day" seeds a `DayPage` (`☀️`/`🌙` slots) with the top picks pre-suggested (reuse `PlaceDetail`'s `withSlot` / `dayplan.js` seam).
- A watch guide → "Add to my [Saturday]" drops the chosen watch spot into a day slot.
This is what makes a guide a *planning* group, not a magazine read.

### Where the magazine lives (a real decision — §12)
The magazine currently lives only on Home. Candidates: Home (discovery), a dedicated guides surface, Spots (place-based guides), and the planning flow (a guide as a day-seed). **Recommendation:** start by **upgrading Home's existing sections in place** (lowest risk, highest visibility) and **add guide entry points into the planning flow** (DayPage "need ideas? → a guide"). Defer a whole new "Guides" tab until guides prove themselves (don't add a tab speculatively — §11).

---

## 6. Spots improvement plan

Spots are core and currently the weakest surface. The fix is two-pronged: **make them beautiful despite thin photos**, and **make them informative enough to decide on.**

### 6.1 The imagery problem (and the honest fix)
- Reality: **1.2% real photos (22/1,832); 96% are `outdoors` → a green-on-green wall.**
- **Forbidden (honesty contract): type-photos** — no generic beach/park stock on a specific named place. Already rejected in 3.5; do not reopen it.
- **Allowed, in priority order:**
  1. **Make the art floor genuinely premium and *varied*** (3.71/3.73). Today every outdoors place shares hue 140. Differentiate the fallback by **placeType, not just category** — beach vs trail vs pier vs dog-park vs garden each get a distinct hue + a distinct icon/terrain motif (`imgbox-art` already takes `--ch`; extend it to read placeType). Add map/terrain-inspired generative texture (contour lines, coastline, a subtle topo pattern) so a no-photo spot card looks *designed*, not *empty*. This alone fixes most of the "green wall."
  2. **Expand the *honest* photo path.** `places-images.mjs` only resolves Wikidata P18 (65 places have a Q-id; 22 have a photo). Headroom: more Wikidata/Commons matching, plus **government/park-agency open-data photos** (many county/city park datasets include official photos with clear licensing) — still real-photo-of-the-actual-place, still attributed. Target: lift the marquee places (beaches, the 24 hidden spots, the classics) to real photos first; the long tail keeps the upgraded art floor.
  3. **User/operator photos — later, gated.** Out of scope for early 3.7; note as a Phase-4 path (needs moderation + provenance labeling, same "Added by you" discipline as events).

### 6.2 Make spots informative (decide-on, not just list)
- **Sourced rankings (the "best beaches" idea), honestly.** The data already carries `srcCount` (corroboration across 3+ GIS/authority sources = "The classics" today) and real `amenities`/`designation`/`hidden`. A ranked guide can compose these into an honest score AND **show the sources** (PlaceDetail already renders "Sourced from {sources}"). Rule: **never invent a ranking we can't source.** "Ranked by how many local authorities list it + amenities + your distance" is honest; "the #1 best beach" with no basis is not.
- **External sourced lists (the "here's a list we found" idea).** This is powerful and on-brand *if* it stays honest: cite the actual external list ("Per [source]'s 10 Best Tampa Beaches…") and link it, rather than laundering it into our own opaque ranking. This likely starts as a **thin curated/editorial layer** (§10), not auto-scraped — small and honest first.
- **Compare & decide.** For a "beach day" intention, show 3–5 ranked options with the *differentiator* surfaced per card (free vs fee, dog-friendly, has restrooms/parking, distance, sunset-facing). The amenity vocabulary already exists (`PlaceDetail.jsx` `AMENITY_LABELS`).
- **Build-a-day from a spot.** The "Make this my plan" bridge is the best Discover→Plan link in the app — make it more prominent on spot cards/detail, and extend it ("plan a beach day around this" → seeds a DayPage).

### 6.3 Premium, collectible spot cards
- A bespoke **SpotCard** treatment so spots feel like *discoveries*, not database rows: the upgraded placeType-aware art, a designation/"hidden gem 💎" badge, the key differentiator chip, distance when known. "Hidden spots" especially should feel earned (they already have `hiddenScore`).

---

## 7. Premium visual system sprint

The thesis (from the audits, ratified in spirit by Josh): **warm, local, outdoorsy, lightly nostalgic, editorial, premium, modern — a personal field guide / weekend companion / hidden-gem journal**, NOT a default white-card Tailwind/shadcn utility app.

> Note: Phase 3.6 N2 already added a spacing scale, motion tokens, and line-height. 3.7's visual sprint should *extend* that token set into a **brand world**, not re-pour the foundation.

### Color
- **Add warm neutrals** (the headline change): ivory / sand / soft stone / warm charcoal / muted green. Replace the cool `--bg #f7f8fa` / `--card #fff` defaults with warmer ivory/sand surfaces and warm-charcoal ink. This single move does the most to shed the "prototype" feel.
- **Re-evaluate teal.** `--accent #0d9488` + `--accent-2 #06b6d4` is the flagged "generic teal." Either warm it (toward a deep teal/forest-green or a muted ocean tone) or demote it to a small accent. Tampa = water, so *some* blue/teal is on-brand — just not the default Tailwind tone. **⚑ Charles owns the exact palette.**
- Keep the reserved-token discipline (`--hot`, `--reward` violet/6-moments, `--free`) — it's a real asset; just retune the values to the warm world.

### Typography
- A stronger, more editorial **type scale**: distinct steps for hero / section header / card title / metadata / label / helper. Consider a refined sans (Inter is fine) or a sans+serif pairing for a lifestyle/field-guide feel (a serif for hero/section titles, sans for body) — **⚑ Charles**.
- **Reduce uppercase.** The hero kicker is heavy ALL-CAPS condensed (`heroKicker`); the audits call it aggressive. Move hierarchy to *size + weight*, not caps. Keep small caps/overlines only where intentional (`sec-overline`).
- Apply the 3.6 line-height/body-size work consistently to the thin spots (`detail-desc`, `pf-empty`, etc.).

### Spacing / radii / shadows
- Use the 3.6 spacing scale everywhere (card padding → `--sp-md`, section gaps → `--sp-lg`); kill remaining ad-hoc px.
- Settle a small radius band (cards already cluster 13–20px) and a **soft diffused shadow** language instead of hairline borders where appropriate (the Gemini "remove card borders, use soft shadow" note) — applied tastefully; some borders (LensNav pills) are intentional.

### Icons
- The app mixes raw color emoji (category chips, fact-row icons, amenity chips) with clean stroke SVG (the Profile gear, nav chevrons). For premium feel, move **functional** icons (fact rows 📅📍🎟️, amenity chips, the category modal) toward **single-color stroke SVG** (Lucide/Heroicons-style), and reserve **emoji** for *identity/category/badge* moments where they read as intentional. Don't purge emoji wholesale — they're load-bearing in the art-fallback and category system — just stop using them as functional UI glyphs.

### Image treatments
- A **consistent framing system** for real photos: a shared aspect-ratio approach per context, `object-fit: cover` (already in), a subtle bottom gradient/scrim so overlaid text stays legible, and the art floor as the universal fallback (already in). The goal is that a chaotic third-party poster sits *inside* our design language instead of hijacking it.

### Empty states / CTAs / sheets
- Empty states: warm + motivating, never cutesy (3.6 N3/Charles owns the copy; the *visual* of empty states is 3.7's — give them a small piece of art + an invitation, not a bare line).
- CTAs: the flat full-width teal button (DetailPage CTA, AddEvent submit) → a more premium treatment (the warm accent, better weight/shadow).
- Bottom sheets: `LensNav`'s sheet + `PickerSheet` already have backdrop scrim + spring-up. Standardize the sheet language (radius, scrim, blur) and consider `backdrop-filter: blur()` on overlays (the audits' "feels integrated into the OS" note).

---

## 8. Screen-by-screen Phase 3.7 plan

### Home / Events feed (`HotView.jsx`)
- Make the hero **emotionally useful, not count-centered.** Keep the count available but demote it; lead with "there's still time to make today good." Soften the ALL-CAPS kicker to size/weight hierarchy.
- Upgrade the magazine sections from filter-echo to **editorial** (§5): better titles, a one-line POV in `sub`, curated subsets, and 1–2 real **guides** introduced carefully (don't flood — one strong guide beats five weak ones).
- Improve event cards (below); enforce **consistent image framing** across the feed; keep line-clamping; tighten metadata hierarchy; reduce info-density.
- Move the in-feed **"not an algorithm cloud"** explainer toward Profile (show-don't-tell) — coordinate with 3.6 N5/onboarding & §12.

### Event cards (`cards.jsx`)
- Settle a consistent image aspect approach per card family; keep `object-fit: cover`.
- Frame real posters: subtle gradient/scrim, no distortion, consistent radius; soft shadow over harsh borders where it suits.
- Cleaner title/time/venue hierarchy; keep `-webkit-line-clamp`; keep the (good) art fallback as the universal floor.

### Event detail (`DetailPage.jsx`) — build on the strongest screen
- Polish the hero framing; upgrade fact-row icons to stroke SVG; add dividers/spacing rhythm.
- Promote **"Why this is here"** from a row to a distinct **trust card** (it's the product's value-prop in miniature).
- Premium CTA; ensure "More like this" rail uses the consistent image framing.

### Spots (`LocationsView.jsx`, `PlaceDetail.jsx`, `places.js`) — the big one
- Replace the green-wall feeling: **placeType-aware art floor** + premium **SpotCard** (§6.3).
- Add **sourced/ranked guides** (best beaches/parks) with sources shown (§6.2).
- Make spots feel like **discoveries**; make **"Make this my plan"** prominent and extend it to "build a day around this."

### Calendar / planning (`CalendarView.jsx`, `DayPage.jsx`)
- Shift DayPage from "slot filler" to **"build a good day."** Replace "Open — tap to plan" with warmer, motivating copy (Charles) + a more inviting empty-slot *visual*.
- Richer dayparts: today's binary ☀️/🌙 → morning / afternoon / evening (a real model decision — keep the store migration honest; `dayplan.js` currently has `day`/`night`).
- Use weather + energy/vibe as **decision cues** in the planner ("clear Saturday — good for the beach"; the weather-fit logic already exists on PlaceDetail).
- Make **"Fill this day"** feel like the magical primary action (it exists as `FillDayButton`/`DayFillDeck` — elevate it).
- Calendar grid: give it journal-like whitespace; keep the logbook purity (no supply leaking back in — that was a deliberate 3.5 decision).

### Plan builder bottom sheet (`PickerSheet.jsx`, `DayFillDeck.jsx`)
- Make picks feel **curated for this daypart**, not a raw list.
- Show **why each pick fits**: free / nearby / rainy-day-friendly / matches taste / low-effort (compose from existing fields + `tasteNudge` + weather).
- Visually distinguish **top picks** from normal listings.

### Map (`MapView.jsx`)
- Reduce cluster overload; refine cluster styling away from clinical teal number bubbles; simplify top filters.
- Add a **bottom-sheet preview / curated nearby picks** so the map always suggests a next action (less analytics, more exploration). *(Confirm MapView internals before building.)*

### Category modal (`LensNav.jsx` sheet) — light touch
- 3.6 N1 already made this a premium bottom sheet with the taxonomy grid. 3.7's only adds: consider single-color stroke icons over raw emoji in the grid, slightly more generous padding, and `backdrop-filter: blur()` on the scrim. **Do not rebuild it** — 3.6 owns it.

### Add event (`AddEvent.jsx`)
- Reframe the entry from "Add event" → **"Save something you found" / "Add your own plan" / "Drop a pin"** (warmer, consumer).
- Keep the form, but **calmer and grouped** (What / When / Where / Details) instead of one long flat stack; better spacing; lighter first screen.

### Profile / taste (`ProfileView.jsx`)
- Make **"Your taste" feel alive and rewarding** — cards/badges/clear sections, not a settings scroll.
- Bring the privacy/"tap-based, not an algorithm cloud" explanation *here* (its canonical home) so the main feed can feel magical.
- Keep the excellent honest logic; this is a *visual* elevation.

### App shell / navigation (`App.jsx`, `nav.jsx`, `LensNav.jsx`)
- Ensure nav visibly supports **Discover → Save → Plan → Go → Remember** (the tabs roughly are Events/Spots = Discover, saves = Save, Calendar/Day = Plan/Go, Profile/Been-there = Remember — make those relationships legible).
- Visual consistency pass on the tab bar.
- **Do not add tabs** unless strongly justified (a "Guides" tab only if guides prove out — §5, §11).

---

## 9. Patch sprint breakdown (3.71 → 3.76)

Each sub-sprint is narrow, shippable, and live-tested before the next. Order can shift after the executing builder re-confirms against the post-3.6 code.

**3.71 — Brand/visual foundation + component audit**
- Audit reusable visual components (cards, SecHead, sheets, fact rows) and catalog what's reusable vs bespoke.
- Establish the **warm token set** (warm neutrals, retuned accent — extends 3.6's tokens), type scale, finalize radii/shadow language.
- App-shell/nav visual consistency; apply tokens to the highest-traffic surfaces.

**3.72 — Cards, imagery, home feed polish**
- Consistent image framing system; poster scrim/crop discipline.
- Hero de-counts + softer kicker; section headers go editorial; filter chips polish.
- Card title/meta hierarchy; keep line-clamp + art fallback.

**3.73 — Spots become premium / collectible / informative**
- placeType-aware art floor + SpotCard.
- Honest photo-coverage lift for marquee spots (Wikidata + gov open-data).
- Sourced/ranked beach/park guide v1 (sources shown); prominent "Make this my plan" + "build a day around this."

**3.74 — Calendar & planning emotional pass**
- DayPage "build a good day" reframe; warm empty states; richer dayparts (model decision).
- Plan-builder bottom sheet: curated-for-daypart + "why it fits" + top-pick distinction.
- Elevate "Fill this day"; weather/vibe/energy cues.

**3.75 — Smart Groups / editorial modules prototype**
- GuideCard + GuidePage primitive (reuse BubblePage machinery).
- Ship the **derivable** intention guides first (beach day / rainy day / low-effort / free outdoor reset) — zero new data.
- Prototype ONE timely Watch Guide (World Cup) on a thin curated layer; define data/UI/source/trust requirements (§10).
- Wire guides → planning (build-a-day seed).

**3.76 — Map / profile / add-event polish + shippability QA**
- Map declutter + curated bottom sheet.
- Profile "alive" pass; move privacy explainer here.
- Add-event reframe (calmer, grouped, warmer entry).
- Final cross-screen consistency + the Phase-4 shippability checklist (§12 open question).

---

## 10. Data / model implications

The discipline: **smallest useful version first; prototype guides without derailing the app; never overbuild.** Today there is **no groups/collections/editorial data model** — the only "smart" layer is `curate.js` (front-page predicate + recurring-collapse). That's the seed.

### What each group flavor needs

**Intention guides (derivable — start here, zero new data):**
- Pure UI/data *composition* over existing fields: `category`, `tags` (free/one-off/hidden-gem/staff-pick), `isFree`, `placeType`, `classes`, `srcCount`, `amenities`, `hotScore`/`buzz`, plus live weather + `tasteNudge`.
- Implement as **pure selector functions** (the `curate.js` / `places.js` selector pattern), exactly like `classics()` / `nearest()` / `placesForBrief()` already do. A "beach day" guide is `places.filter(beach-ish)` ranked by `srcCount` + amenities + distance — already 90% expressible.
- **No schema change, no pipeline change.** This is the bulk of the value and the safest.

**Sourced rankings (mostly derivable + thin curation):**
- Honest score from existing signal (`srcCount` corroboration, amenity richness, `designation`, distance) + **display the sources** (already rendered on PlaceDetail).
- For "here's an external best-of list we found," start with a **hand-curated editorial file** citing the real source — do NOT auto-scrape early.

**Moment / world-event groups (need a thin new layer):**
- This is the only flavor that needs data the pipeline lacks. Events have `category: 'sports'` (only 58 events) but **no concept of a parent world-event, no "watch party" tag, no team/competition entity.** A World-Cup watch guide can't be fully derived from current data.
- **Smallest useful version:** a hand-authored **`guides.json` editorial layer** (a new static file, like a tiny CMS): each guide = `{ id, kind, title, pov, window:{start,end}, query/keywords, manualPicks[], sources[] }`. The app loads it lazily (the `places.js` singleton pattern) and resolves picks against the live events/places stores. Manual `manualPicks` for the curated case; `keywords` (e.g. "world cup", "watch party", bar/venue names) for a semi-derived case that matches event titles/descriptions.
- **Progression:** (1) hand-authored `guides.json`, (2) keyword/entity matching to auto-populate candidates the editor approves, (3) — only if it earns it in Phase 4+ — a real group entity in `finder` with sourced external-event calendars (sports schedules, festival calendars).

### Avoiding overbuild
- **Do not** build a generic CMS, a groups admin UI, or auto-scraping in 3.7.
- **Do** ship derivable guides as selectors (no new data), and a single thin `guides.json` for the timely ones. One static file + one lazy loader + one GuidePage = the whole MVP.
- Keep the never-hide contract: a guide is a *curated view*, and any guide must offer a path to "see all" of its underlying set (same discipline as the Everything feed's "See all N").

### Source/trust display (keep it light)
- Reuse the existing demoted-footer pattern ("Found via {sources}" / "Sourced from {sources}"). For ranked guides, one quiet line ("Ranked by local-authority listings + your distance · sources ↓") with sources tucked, not a heavy citation block. Trust should feel *present*, not *academic*.

---

## 11. Implementation guardrails for the later builder

- **Mobile-first.** The app is a 460px phone frame (`index.css #root`). Design and test at phone width first.
- **No heavy animations / no complex new dependencies** unless absolutely necessary. Motion restraint is already a strength; keep it. Prefer CSS + the existing motion tokens.
- **Polish existing flows before adding tabs/surfaces.** No speculative "Guides" tab; earn it.
- **Do not make the app more complex.** Make what exists feel more intentional, premium, decision-supporting. Fewer, better.
- **Preserve existing functionality and the honesty contract:** never-hide, no fake data, real-or-art images (NO type-photos), taste-reorders-never-filters, sources disclosed, sponsored/added-by-you always labeled, the reserved `--hot`/`--reward` token discipline, the ban-list (no guilt copy, zero-is-silence, user-initiated only).
- **Make visual primitives reusable.** New components (SpotCard, GuideCard, GuidePage) should slot into the existing `cards.jsx` / `SecHead` / `RowFeed` / BubblePage patterns, not fork them.
- **Respect 3.6's work.** Build on LensNav, the 3.6 tokens/spacing/motion, the premium voice, and the Settings redesign — extend, don't re-do.
- **Each patch:** narrow scope → build → adversarial review → hand-verify → `npm test` (the smoke harness; many modules are pure/Node-importable specifically so it can assert them) → live-verify in the preview → push. No giant rewrites.
- **Progressive enhancement.** Guides start as composition; imagery degrades to the art floor; weather/coords degrade silently — keep every feature graceful when data is absent.
- **Source display elegant + lightweight** — quiet footers, not citation walls.
- **Josh + Charles own brand/taste calls** (palette, voice, guide naming, type pairing) — surface options, don't unilaterally pick.

---

## 12. Open questions / decisions needed

1. **Guide naming.** "Guides" (recommended umbrella) vs Plan Packs vs Field Guide Sections vs keep "Smart Groups" internal-only? (⚑ Charles/Josh — §4.2.)
2. **Curated vs derived first.** Confirm: ship derivable intention guides first (recommended), curated/timely Watch Guides second?
3. **World-Cup / watch-party representation.** Hand-authored `guides.json` + keyword matching (recommended MVP) — acceptable, or wait for a real sourced sports-calendar layer?
4. **Spot images.** How aggressively to chase honest real photos (Wikidata + government open-data) vs leaning on a richer placeType-aware art floor? What licensing bar for gov photos?
5. **Fallback imagery system.** Approve placeType-aware art (distinct hue/motif per beach/trail/pier/etc.) as the universal floor?
6. **Sourced rankings in 3.7 or later?** Best-beaches v1 in 3.73, or defer ranking until Phase 4?
7. **Magazine placement.** Upgrade Home sections in place + seed guides into planning (recommended) vs a dedicated Guides surface/tab?
8. **"Why your feed looks like this"** — move fully out of the main feed into Profile (coordinate with 3.6 N5)?
9. **Brand direction specifics** — the exact warm palette, teal's fate, and the type pairing (⚑ Charles).
10. **Dayparts model** — keep ☀️/🌙 binary or migrate `dayplan.js` to morning/afternoon/evening (a store migration — weigh value vs churn)?
11. **What counts as "shippable enough" for Phase 4?** Define the QA bar/checklist that closes 3.7.

---

## 13. Final recommended execution order

Inspect the post-3.6 code and adjust, but the likely priority:

1. **Brand / design system** — warm tokens, type scale, shadow/radius language (3.71). *Everything else rides on this; do it first.*
2. **Cards & imagery** — consistent framing, poster discipline, the art floor (3.72).
3. **Home feed hierarchy** — de-count the hero, editorial sections, reduced density (3.72).
4. **Spots visual + fallback + informative** — placeType art, SpotCard, honest photo lift, sourced guide v1, prominent plan bridge (3.73). *Highest user-value single sprint.*
5. **Calendar / planning emotional pass** — "build a good day," richer dayparts, curated plan-builder, "Fill this day" (3.74).
6. **Smart Groups / editorial modules prototype** — GuideCard/GuidePage, derivable guides, one Watch Guide, plan wiring (3.75).
7. **Map / profile / add-event polish** — declutter, alive profile, warm add-event (3.76).
8. **Final shippability QA before Phase 4** — cross-screen consistency, the §12 #11 checklist.

The product idea is strong and the foundations are honest and solid. 3.7 isn't about new tabs — it's about a **stronger visual thesis, smarter curation, and a planning loop that helps the user decide.** Tighten what exists until it feels final.

---

# ADDENDUM A (2026-06-15) — Profile/Settings split · Profile-as-memory · Multi-city · Patch workflow
_Added per Josh's direction (additive, not a rewrite). Backed by a read-only research workflow (Profile/Settings audit · Profile-as-memory · multi-city event-source portability · multi-city places/geo portability · external best-practice → synthesis). All file:line refs verified against the post-3.6 tree. Note: one research agent referred to an old "Find My Night" product name — that feature (the dice/FMN) was removed in Phase 3.5; the app's working masthead is "Tampa Bay — What's On · early build (v0)" (`SettingsPage.jsx:199`). Ignore that name._

## 14. Profile ↔ Settings — clarify the split + expand Profile into a real "memory"

### 14.1 The actual problem (confirmed in code)
The 3.6 N4 Settings redesign is good and intentional (the clean 5 groups), and a "⚑W5 dedup" was applied — BUT **the dedup was cosmetic, not structural.** The same three taste tools are reachable from BOTH surfaces, just relabeled:

| Tool (one component) | Profile entry | Settings entry |
|---|---|---|
| TastePanel (why-feed + mute/boost) | "Why your feed looks like this" (`ProfileView.jsx:307`, `openTaste()`) | "See your taste details" (`SettingsPage.jsx:110`, `openTaste('settings')`) |
| CalibrationDeck | "Rate a few to sharpen it" (`ProfileView.jsx:315`, `openDeck('profile')`) | "Rate & refine" (`SettingsPage.jsx:133`, `openDeck()`) |
| InterestEditor | tappable vibe chips (`ProfileView.jsx:267-289`, `openInterests()`) | "Customize interests" (`SettingsPage.jsx:124`, `openInterests('settings')`) |
| Taste summary + top-3 chips | live vibe header (`ProfileView.jsx:261`) | static read-only card + chips (`SettingsPage.jsx:96-105`) |

That's the overlap Josh is feeling: identical destinations, different words. The fix is **structural ownership**, not more relabeling.

### 14.2 The clean split (recommended)
**Principle (matches premium-app best practice from the research): Profile = identity / taste / memory ("who you are, where you've been"). Settings = maintenance ("the knobs, your data, the reset").** A profile should feel *alive and rewarding*; a settings page should be *boring on purpose*. Today Settings is doing identity work (the static chip card) and Profile is doing some maintenance work — untangle them.

| Item | Today | Owner | Action |
|---|---|---|---|
| Vibe header (chips, free-leaning, when-line, confidence copy) | Profile | **Profile** | Keep + expand (§14.3) |
| Taste chips → edit (InterestEditor) | Profile (implicit) | **Profile** | Keep — the fast implicit door |
| TastePanel ("why your feed") | both | **Profile (canonical)** | Profile owns it; Settings drops the row OR keeps ONE quiet deep-link |
| CalibrationDeck | both | **Profile (canonical)** | same — Profile owns; Settings deep-links at most |
| Static read-only chip grid in Settings | Settings (`:96-105`) | **remove** | Adds zero affordance; replace with one line "Your taste lives in Profile →" |
| "Customize interests" row | Settings | **Settings keeps (maintenance verb)** | Editing interests is a legit maintenance action; fine to keep here AND on Profile |
| Primer retake | Settings only | **Settings** | Keep |
| Reset ("Start fresh") | Settings only | **Settings** | Keep (destructive belongs in maintenance) |
| Data & privacy card | Settings only | **Settings** | Keep |
| About / attribution | Settings only | **Settings** | Keep (⚑X3 attribution lands here) |
| When-preference | Profile only | **Profile** | Keep + expand into a card (§14.3 concept C) |

**Two dial settings for Josh (§14.5 decision):**
- **Clean split (recommended):** Settings drops the duplicate taste-tool rows entirely; one quiet "Manage your taste in Profile →" deep-link replaces them. Profile becomes the *single* home for taste + identity + memory. Settings shrinks to genuine maintenance (interests-edit + primer + reset + data + about). This is what makes the two "useful and split," per Josh.
- **Minimal (conservative fallback):** just remove the static chip grid; keep the relabeled secondary doors. Safer, smaller, but leaves the "same place, two doors" feeling Josh flagged.

### 14.3 Get creative with Profile — make it a "memory" surface (Josh's "hold the events you've been in")
**Every concept below uses data the app ALREADY persists — zero new tracking, fully inside the ban-list (zero-is-silence, no vanity counts, no guilt, user-initiated).** The signal catalog the app already stores: saved shelf (`saves-v1`), been-there / went-list (`been-there-v1`), did-days + variety firsts + day history (`day-history-v1`, `day-converted-v1`), weekend history (`weekend-history-v1`), recents (`recents-v1`), and the taste profile (`taste-v1`: per-category counts, free-affinity, when-preference, confidence). A lot of this is stored but never *celebrated*.

**Top 3 to ship (small, compounding):**
1. **"Your Passport" — a real logbook of where you've been.** A chronological went-list with date · venue · category, built from `been-there-v1` + `day-history-v1` (the went-list rendering already exists at `ProfileView.jsx:473-489` — expand it from a flat list into a dated journal). Optional: lazy-load `places.json` to drop tiny map pins for places you actually went — a "your Tampa" map of real visits. *This directly answers Josh's ask.*
2. **"Plans → Reality" — planned vs. went, no guilt.** From `day-history-v1` + `day-converted-v1`: "June: 8 days planned, 6 went" — fact-only, zero-is-silence (a month with nothing renders nothing), never a streak or a shame metric. Celebrates follow-through honestly.
3. **"When do you go?" — stated vs. actual rhythm.** Expand the one-line when-preference (`ProfileView.jsx:291`) into a small card: "You said: weekends · your last outings: mostly weekend afternoons" — derived from `taste.prefs.when` + the did-day daypart distribution. Surfaces data already stored, teaches the taste→behavior link.

**More to consider (same data, pick per Charles's eye):** category-breadth "explorer" stamps (variety firsts already exist), a quiet season/year-in-review, a been-there map view, a calm timeline of did-days. Avoid anything that needs new capture or implies a score.

### 14.4 Reconcile with the in-flight 3.6 work
3.6 N4 (Settings) and N3 (copy) are landing now. **Do NOT touch Settings/Profile until both land and commit.** Then 14.2's split is a small, safe edit (mostly deletions on the Settings side + one deep-link), and 14.3 is purely additive to Profile. No data migration; no breaking change. This work belongs in **3.76** (which already had a "Profile alive pass" line) — expand that sub-sprint to include the split + the Passport/Plans/When trio.

### 14.5 Decisions (Josh)
- **D-PS1:** Clean split (Settings drops duplicate taste rows → one deep-link; Profile is the sole taste/identity/memory home) — recommended — or minimal (just drop the static chip grid)?
- **D-PS2:** Ship all three memory concepts (Passport + Plans→Reality + When) in 3.76, or Passport first and the other two later?

---

## 15. Multi-city / multiple locations — the Phase-4 bridge (the last thing before launch)

Josh: add **Tampa Bay (current) · New York City · Austin TX (the UT-Austin angle) · Puerto Rico · Seattle** as the last thing before Phase 4 — "hopefully easy now that we built all the ways we populated Tampa." Here's the honest reality.

### 15.1 The honest verdict
**Partly easy, mostly real work.** The *bootstrap* ports cheaply and the *refactor* is modest. The *richness* that makes Tampa feel good does NOT port — each city needs its own sourcing discovery. So "easy" is true for getting a thin city stood up; "not that bad" undersells the per-city sourcing tail.

- **The portable floor (free per city):** Eventbrite + AllEvents + Meetup (events, all geo-parameterized) and OSM/Overpass + Wikidata/Wikipedia (places, bbox/entity-driven). Stand up any city on these alone.
- **What does NOT port (Tampa-locked):** Creative Loafing (`render.mjs`), Don't Tell Comedy, I Love the Burg (St. Pete), the Hillsborough library system (`hcplc.mjs`, 32 branches hardcoded — Tampa's crown jewel), and all the FL county/state GIS (`hillsborough-parks`, `pinellas-parks`, `fdep`, `swfwmd`, `fwc-ramps`). Each city needs its own equivalents (NYC Parks, Austin/Travis, Seattle/King County, WA/NY/TX state parks) — same boilerplate, new endpoints + field mapping.
- **Counter-intuitive:** bigger markets get *more* from the free floor than Tampa (NYC Meetup alone dwarfs Tampa); the curated local sources matter *most* for mid/small markets.

### 15.2 The one-time refactor (modest — ~12 touch points)
There is **no multi-city seam today** — it's single-city throughout, and `lib.js:7` even says so ("Per-city hero art is a future, multi-city feature; hardcoded to Tampa for now"). The refactor extracts hardcoded Tampa into a **city registry** (`finder/cities.json`: `{ id, name, bbox, center, timezone, hero, spotsHero, sourceSet, touristCentroids }`), and the app's `CITY` (`lib.js:8-15`) becomes a lookup.

Hardcoded-Tampa audit to parameterize:
- `finder/finder.mjs:37` `TB_BOX` · `:207-208` city-suffix regex (27-city list) · `:1634` Nominatim viewbox · `:1673` geocode fallback city list
- `finder/places.mjs:38` `TB_BOX` (dup) · `:459-461` `TOURIST_CENTROIDS` (3 Tampa landmarks, drives `hiddenScore`)
- `finder/places-sources/osm.mjs:26` bbox · `finder/render.mjs:33` `cltampa.com` base · `:54-63` 38-city array
- `app/src/lib.js:8-15` `CITY` object (name + hero images)
- **Timezone:** finder hardcodes Eastern (e.g. `visittampabay.mjs`, `allevents.mjs`); Seattle = Pacific, PR = Atlantic/no-DST → make `timezone` a registry field.
- **App routing:** there's no URL/city-picker today — multi-city UI (a `<CitySwitcher>` + how the app knows "which city") is its own small piece and can be deferred (single-deployment-per-city or a localStorage picker first).

### 15.3 Per-city reality (events + places)
- **NYC — easiest, highest value.** Floor alone ≈ 3,000–5,000 events/wk + ~2,400 OSM places; NYC Parks/NY DEC GIS available. Comparable to or richer than Tampa immediately. **The proof-of-concept city.**
- **Austin — solid, lighter.** ≈ 400–800 events/wk + ~800–1,000 places (Austin/Travis/TX GIS good). **UT-Austin angle:** the existing `trumba-ut.mjs` adapter is a generic Trumba-calendar scraper (currently University of Tampa) — if UT Austin uses a Trumba/Localist-style calendar, that adapter likely re-points with little code (⚑ verify). A concrete Austin win.
- **Seattle — rich, similar to Tampa.** ≈ 600–1,200 events/wk + ~1,500 places (Seattle/King County/WA GIS strong; Puget Sound water access). KEXP as a possible WMNF-style flavor source.
- **Puerto Rico — hardest; beta/proof-of-concept only.** ≈ 200–400 events/wk (English-skewed, resort-biased) + ~400 places (thin urban OSM). **Real blockers:** sparse open GIS, Spanish-first government data (DRNA), no English DMO API parity, cultural fit (events live on Facebook, beach > park culture). Needs a dedicated Spanish-source + bilingual-QA effort. **Do it last, honestly labeled, likely in Phase 4 — don't ship it half-baked.**

### 15.4 Recommended sequencing (as the 3.7 capstone / Phase-4 opener)
This is explicitly "the last thing before Phase 4," so it runs AFTER the visual/spots/planning/guides patches (3.71–3.76):
1. **3.77 — Geo-config refactor** (the registry + the ~12 touch points). One-time, ~one small sprint. Outcome: `CITY_ID=nyc npm run finder` works.
2. **3.78 — Walnut Creek, CA** (East Bay / Contra Costa; events + places discovery + validation). The proof the refactor holds — a small market Josh has lived in, so he can personally QA recommendation quality (dogfood). NYC → Phase 4. **See §I for the full rationale + Walnut Creek source mapping.**
3. **Then Austin + Seattle** in parallel (same template, faster) — can be the tail of 3.7 or the first Phase-4 patches.
4. **Puerto Rico last** (Phase 4) — with the Spanish-source + bilingual work it actually needs.

Honest effort scale: refactor ≈ small sprint; NYC ≈ small sprint; Austin/Seattle ≈ small each; PR ≈ medium (research + language). All four + refactor ≈ a few sprints — real, but not a rewrite.

### 15.5 Honesty-contract notes for multi-city
- **Never fake parity.** Per-city coverage differs a lot; the app should be transparent ("Austin: fewer events than Tampa for now") rather than imply uniform richness. This matches the reality-layer Josh wants.
- **The art floor saves the thin cities.** A new city with few real photos still looks designed if the placeType-aware art floor (§6.1) shipped first — another reason the visual/spots sprints come *before* multi-city.
- **OSM/Wikidata attribution** scales per city (⚑X3 attribution page must list per-source/per-city credits).

### 15.6 Decisions (Josh)
- **D-MC1:** Is multi-city the **tail end of 3.7** (refactor + NYC as 3.77/3.78) or the **opener of Phase 4**? (Recommend: refactor + NYC close out 3.7 as the bridge; Austin/Seattle/PR roll into Phase 4.)
- **D-MC2:** How many cities at first public launch — Tampa-only, Tampa + NYC (recommended proof), or all five?
- **D-MC3:** Puerto Rico — accept "beta, thinner, Spanish work pending," or hold it entirely until the Spanish-source effort is funded?
- **D-MC4:** App-side city selection — single-deployment-per-city, a localStorage picker, or URL routing (`/nyc/`)? (Can defer; doesn't block the data refactor.)

---

## 16. Patch workflow & git/branch strategy (for the 3.7 loop)

Josh wants: commit all of N1–N5, then a fresh branch for patches, patches committed one-by-one for easy revert, but pushed aggressively.

**Important caution:** as of this writing the other session is mid-flight on **N3 (copy) and N5 (onboarding)** — there are uncommitted changes in the tree (`SettingsPage.jsx`, `settings.css`). **Do not commit N1–N5 from a second session** — you'd capture half-finished work and risk clobbering the active session. The committing/branching happens **at the gate**, once 3.6 fully lands.

**The process (execute at the 3.6→3.7 gate):**
1. **Gate:** the 3.6 session finishes + commits N3/N5 → `master-plan-2` holds all of N1–N5, `npm test` green, build/lint clean.
2. **Branch:** cut `phase-3.7-patches` (or similar) off that commit. `master-plan-2` and `main` stay untouched as safe restore points.
3. **One commit per patch** (3.71, 3.72, … each self-contained) → each patch is a single revertable unit. Push after each (aggressive pushes, as Josh wants).
4. **Revert = drop one commit**, never unwind a tangle. If a patch regresses, `git revert <sha>` that one patch.
5. Keep the per-patch contract: build → adversarial review → hand-verify → `npm test` → live-verify → commit → push.

**On who runs 3.7 (Josh deferred this — noted for later):** cleanest hand-off is a fresh builder session pointed at `PHASE_3.7.md`, executing patch-by-patch, with Josh/Charles ratifying the open ⚑ decisions between patches (esp. the brand palette, guide naming, and the split/multi-city calls). This scout session stays plan-only.

---

## 17. FINAL NOTES FOR JOSH (the short version)

1. **The plan is additive and ready.** §1–13 = the original 3.7 plan; §14–16 = today's additions (Profile/Settings split, Profile-as-memory, multi-city, git workflow). Nothing was rewritten.
2. **Profile/Settings, the real issue:** the 3.6 dedup only *renamed* the duplicate rows — the same taste tools still open from both places. The fix is **ownership**: make **Profile the single home for taste + identity + memory**, shrink **Settings to maintenance** (data/privacy/reset/about/primer). (§14.2 — pick clean vs minimal: **D-PS1**.)
3. **Profile gets creative for free:** a **"Passport"** logbook of where you've actually been, a no-guilt **"Plans → Reality,"** and a **"when do you go"** rhythm card — all from data already stored, all ban-list-clean. (§14.3 — **D-PS2**.) This lives in **3.76**.
4. **Multi-city is real but not scary.** Refactor is ~12 touch points + a city registry. NYC is the easy, high-value proof; Austin/Seattle are solid (and your **UT-Austin angle** may reuse the existing `trumba-ut` adapter); **Puerto Rico is genuinely hard** (Spanish + thin open data) — do it last and label it honestly. Recommend **refactor + NYC close out 3.7 (3.77/3.78); the rest opens Phase 4.** (§15 — **D-MC1..4**.)
5. **The honest caveat you'll want to hear:** "easy now that we built Tampa" is *half* true. The portable floor (Eventbrite/Meetup + OSM/Wikidata) ports for free; the *local richness* (Creative Loafing, the library system, county GIS) does not — every city needs its own sourcing pass. Ship the **art floor and spots polish before multi-city** so thin cities still look premium.
6. **Git:** don't commit anything yet — the other session is mid-N3/N5. At the gate: commit N1–N5 on `master-plan-2`, branch `phase-3.7-patches`, one commit per patch, push aggressively, revert-by-patch. (§16.)
7. **What I need from you to unblock the build:** the brand palette + guide naming (Charles), **D-PS1** (how hard to split Profile/Settings), and **D-MC1/D-MC2** (is multi-city the tail of 3.7 or the start of 4, and how many cities at launch). Everything else can proceed on the recommendations.

---

# ADDENDUM B (2026-06-15) — North star · the "Wuzup" brand · resolved decisions · kickoff
_Added per Josh's final direction: he greenlit resolving the open questions ourselves ("run the patches, then Charles and I patch if you got something wrong"). So this addendum CLOSES the ⚑ decisions with rulings, names the app, and hands the builder a ready prompt. Git/commit is handled by the 3.6 session (it's pausing to commit, finishing 3.6, committing again) — the builder does NOT manage 3.6 commits._

## B.0 The north star (say it on every patch)

**Move it from a "white app" to an actual app.** This is the single most important framing (Josh's words). Today it reads as a clean web prototype / white-card directory. Every 3.7 patch should push it toward a real, premium, *branded* product.

**The acceptance bar for the visual sprints:** by the end of the planned 3.7 patches — especially the branding pass — the app should look **"vastly different but very recognizable."** You should recognize *every* element (same screens, same components, same flows), yet it should feel dramatically more premium, fleshed-out, app-like, and branded. If a screen is unrecognizable, we overshot; if it looks basically the same, we undershot. The target is a confident re-skin + polish of a structure we already trust — not a rebuild.

## B.1 The brand name: **Wuzup** (working name)

The app's working brand name is **Wuzup** (a friendly, energetic riff on "what's up"). It is **not** currently in the codebase and must be threaded through as part of **3.71** (the branding sprint).

**Critical distinction — app name vs. location name:**
- **"Wuzup" = the APP/brand name** (masthead identity, title, splash, About, onboarding welcome).
- **`CITY.name` = the LOCATION** (currently `'Tampa Bay'`, `lib.js:9`). **Do NOT rename `CITY.name` to "Wuzup."** It stays the city, and with multi-city (§15) it becomes per-city. The hero keeps showing the *city*; "Wuzup" is the *brand* around it. Mental model: **"Wuzup · Tampa Bay."**

**Exact rename targets (do at the gate, after 3.6 commits — some of these files are mid-edit by the 3.6 session):**
- `app/index.html:10` — `<title>Tampa Bay — What's On</title>` → `Wuzup` (or `Wuzup · Tampa Bay`).
- `app/src/SettingsPage.jsx:199` — `"Tampa Bay — What's On · early build (v0)"` → `"Wuzup · Tampa Bay · early build (v0)"`. *(SettingsPage is being edited by 3.6 now — apply after it commits.)*
- `app/src/Primer.jsx:214` — onboarding `"WELCOME TO TAMPA BAY"` → fold the brand in (`"WELCOME TO WUZUP"` or `"WUZUP · TAMPA BAY"`). *(Primer is N5 onboarding — actively in flight; coordinate.)*
- `app/src/App.jsx:388` — boot loader `Loading {CITY.name}…` → optional `Loading Wuzup…` (minor; keep city if preferred).
- Add a brand wordmark/lockup treatment in 3.71 (the masthead is the highest-value branded moment — a real wordmark, not just a swapped string). PWA manifest / app icon / splash get the name too when Phase 4 deploy work lands (⚑ carry-forward).

This is small and surgical (≈4 strings + a wordmark), and it's the *first* visible "this is a real app now" win — do it at the very top of 3.71 alongside the brand tokens.

## B.2 Decisions — RESOLVED (run with these; patch later if wrong)

Every open ⚑ from §12 + the Addendum-A decisions, ruled. Rationale is terse; the relevant section has the full reasoning. Brand palette/type is the one resolved by a dedicated design panel — see **§B.3**.

| # | Question | RULING | Why |
|---|---|---|---|
| 1 | Guide naming (§12.1) | **User-facing umbrella = "Guides"** (e.g. "Beach Day," "Where to Watch"); the sports/world-event ones = **"Watch Guides"**; keep **"Smart Groups" as the internal/eng term only**. Avoid "smart"/"hub" in UI. | Premium, timeless, brand-neutral, covers all 3 flavors; Charles can rename in a copy patch. |
| 2 | Curated vs derived first (§12.2) | **Derivable intention guides first** (zero new data), timely/curated Watch Guides second. | Safest, highest-value-per-effort; pure selectors. |
| 3 | World-Cup representation (§12.3) | **Hand-authored `guides.json` + keyword matching MVP.** No sports-calendar data model in 3.7. | Smallest useful version; the data model doesn't exist yet. |
| 4 | Spot-image aggressiveness (§12.4) | **Two-track: ship the placeType-aware art floor first (fixes the green wall for all), AND pursue honest real photos only for marquee spots** (beaches, the 24 hidden, the classics) via Wikidata expansion + government/park open-data. **Licensing bar: public-domain / gov-open or CC-BY with attribution** on the ⚑X3 page. Don't chase the long tail. | Honest, no type-photos, immediate visual win regardless of photo coverage. |
| 5 | placeType-aware art floor (§12.5) | **APPROVED as the universal fallback.** Distinct hue + motif per beach/trail/pier/dog-park/garden/etc. | Kills the green-on-green wall; pure CSS, no assets. |
| 6 | Sourced rankings in 3.7 (§12.6) | **YES — best-beaches/parks v1 in 3.73**, honest score (srcCount + amenities + distance), sources shown. | Decision-support core; data already supports it honestly. |
| 7 | Magazine placement (§12.7) | **Upgrade Home sections in place + seed guides into the planning flow. NO dedicated "Guides" tab yet.** | Earn the tab; lowest risk, highest visibility. |
| 8 | "Why your feed" → Profile (§12.8) | **YES — move it out of the main feed into Profile** (Profile is the canonical taste/identity home, §14). | Show-don't-tell; reinforced by the Profile/Settings split. |
| 9 | Brand palette / teal / type (§12.9) | **Resolved by the brand panel → see §B.3** (final tokens + type). | Taste-heavy; given dedicated fan-out + judging. |
| 10 | Dayparts model (§12.10) | **Keep the day/night binary store; enrich it emotionally** (richer "build a good day" framing, weather/energy cues). Do NOT migrate `dayplan.js` to a 3-way store now. Revisit only if playtest demands it. | A 3-way migration touches DayPage/PickerSheet/WeekendBuilder/PlaceDetail/auto-slot for uncertain value; the emotional win doesn't require it. |
| 11 | Shippable bar for Phase 4 (§12.11) | **Defined — see §B.5 (the Phase-4 readiness checklist).** | Need a concrete gate to close 3.7. |
| D-PS1 | Profile/Settings split (§14.5) | **CLEAN split.** Profile = sole home for taste + identity + memory; Settings shrinks to maintenance (data/privacy/reset/about/primer). Drop the static chip grid + collapse Settings' duplicate taste rows to one "Manage your taste in Profile →" deep-link. | Matches Josh's "split them up and make them useful"; the 3.6 dedup was only cosmetic. |
| D-PS2 | Profile-memory scope (§14.5) | **Ship all 3** (Passport + Plans→Reality + When) in 3.76. | Small, compounding, existing data. |
| D-MC1 | Multi-city timing (§15.6) | **Refactor + NYC close out 3.7 (3.77/3.78) as the Phase-4 bridge; Austin/Seattle/PR open Phase 4.** | Matches Josh's "last thing before Phase 4"; NYC proves the refactor. |
| D-MC2 | Cities at first launch (§15.6) | **Tampa Bay + Walnut Creek, CA** as the proof/dogfood pairing (Josh knows Walnut Creek firsthand); NYC + Austin + Seattle + PR all open Phase 4. | A small, known market is a more honest QA test than data-rich NYC. See §I. |
| D-MC3 | Puerto Rico (§15.6) | **Hold for Phase 4** with the Spanish-source + bilingual effort it needs. Don't ship half-baked. | Genuinely data-poor + language barrier; deserves a real pass. |
| D-MC4 | City-selection UI (§15.6) | **Defer.** localStorage city-picker (or single-deployment) for the bridge; URL routing is Phase-4 polish. | Doesn't block the data refactor. |

## B.3 Brand direction — RESOLVED via design panel: **"Sunlit Coastal Pop"**

A 3-direction design panel (generate → judge on premium/name-fit/feasibility → synthesize) converged on **Direction 2 — "Sunlit Coastal Pop."** It's the one direction that makes the playful name **Wuzup** feel *native* instead of retrofitted: warm editorial neutrals for premium calm + an **ownable Sunset Gold signature accent** for energy. It's a **CSS-token-only swap** (≈90 min, zero new deps beyond one webfont) that unmistakably moves the app from "white prototype" to "branded premium app" while keeping every element recognizable.

**The boldest call (⚑ Charles eyeball this one first):** it **retires the teal** (`--accent #0d9488`, the flagged "generic Tailwind teal") for **Sunset Gold `#ff8c42`**. Rationale: teal was the un-premium tell; sunset-gold is ownable, carries Wuzup's energy, and is still on-brand for Tampa/Gulf (coastal dusk). This is the single most opinionated brand move — if anything gets vetoed, it's this; easy to retune the hex if Charles wants a different signature.

**FINAL TOKEN SET (for `app/src/index.css` — 3.71):**
```css
/* warm neutrals — the editorial spine (replaces the cool white/gray world) */
--bg:    #faf8f5;  /* Aged Linen   — warmth anchor (was #f7f8fa) */
--card:  #fefdfb;  /* Parchment    — creamy premium surface (was #ffffff) */
--ink:   #1a1410;  /* Sun-baked Clay — warm charcoal (was #15171c) */
--muted: #756b61;  /* Warm Taupe   — secondary text (was #6b7280) */
--line:  #ede8e2;  /* Sandy Whisper — warm divider (was #eceef1) */
/* brand accent — the signature */
--accent:   #ff8c42; /* Sunset Gold — buttons/links/section heads (was #0d9488 teal) */
--accent-2: #ffa754; /* Sunset Pale — gradients/overlays (was #06b6d4) */
/* reserved tokens — retuned warm, roles UNCHANGED (scarce/semantic) */
--hot:    #ff3b5f; /* Warm Magenta — save-hearts + heat (was #ff5a3c) */
--hot-2:  #ff2d78; /* unchanged (gradient pair) */
--reward: #d966f5; /* Muted Violet — the 6 sanctioned moments only (was #a855f7) */
--free:   #0fa86d; /* Tropical Sage — free badges (was #0a9d6e) */
```
- **Type:** titles → **Kumbh Sans** (Google Fonts, weights 700/800, `font-display: swap`, ~15KB, `letter-spacing: -0.3px`) on `h1/h2/.sec-title/.bigone-title`; **body stays Inter** at `line-height: 1.6`. Humanist-geometric titles add personality; Inter keeps the legibility spine. (Sheds the "default Inter everywhere" prototype feel.)
- **Texture (graft from the Field-Guide direction):** a subliminal paper grain on `.card` / `.imgbox-art`: `background-image: radial-gradient(circle, rgba(0,0,0,.008) 1px, transparent 1px); background-size: 2px 2px;` — invisible at arm's length, "craft" up close, zero perf cost.
- **Shadows:** warm-cast the existing soft shadows (`rgba(26,20,16,…)` instead of cool black); keep the radius band (14–20px) and `999px` pills. BigOne scrim → warm-ink `rgba(26,20,16,.82)`.
- **First 5 surfaces to apply it to (highest impact):** hero/BigOne · card deck (+ grain) · the full-width CTA (now sunset-gold) · tab bar active state · LensNav + section headers (Kumbh 800).
- **Voice:** "warm, approachable, sun-lit — local knowledge with a friendly shrug." Fits Wuzup; coordinate with 3.6 N3 copy (don't re-do Charles's pass, just align tone).
- **Live-validate:** contrast/a11y on ink-on-parchment + text-on-sunset-gold (target AA); confirm the reserved tokens still *read* (magenta = urgency/love, violet = special, sage = free) and that Sunset Gold (brand) and Warm Magenta (hot) stay visually distinct since both are warm.

This is **3.71's centerpiece**, applied alongside the Wuzup rename (§B.1). It's the "vastly different but recognizable" moment.

## B.4 The builder kickoff prompt (copy-paste when 3.6 is committed)

> **Begin implementing Phase 3.7.** The full plan is in `PHASE_3.7.md` — read it end to end; it is the source of truth. Phase 3.6 is committed; honor everything it landed (LensNav, the 3.6 tokens/spacing/motion, the premium copy voice, the 5-group Settings) — **extend, never re-do.**
>
> **Branch:** cut `phase-3.7-patches` off `master-plan-2` first. **One commit per patch** (3.71, 3.72, …), each self-contained and individually revertable; **push after each** (aggressive pushes). Per-patch contract: build → adversarial review → hand-verify → `npm test` → live-verify in the preview → commit → push. No giant rewrites.
>
> **Decisions are RESOLVED in `PHASE_3.7.md` §B.2 — build with them.** Josh + Charles will patch anything that's wrong afterward; don't re-litigate, just ship the rulings. Honor the honesty contract throughout (never-hide, no fake data, no type-photos, taste-reorders-never-filters, sources disclosed, the ban-list, the reserved `--hot`/`--reward`/`--free` discipline).
>
> **Start with 3.71 (brand foundation), in this order:**
> 1. **Rename to "Wuzup"** (the working brand name) — the exact targets in §B.1 (`index.html` title, `SettingsPage.jsx` About, `Primer.jsx` welcome, optional boot loader) + a real masthead wordmark. **Do NOT rename `CITY.name`** — "Wuzup" is the app; "Tampa Bay" stays the location. Mental model: "Wuzup · Tampa Bay."
> 2. **Apply the "Sunlit Coastal Pop" brand tokens** from §B.3 (warm neutrals + Sunset Gold accent + Kumbh Sans titles + grain + warm shadows). Apply to the 5 highest-impact surfaces first; live-verify contrast/a11y and that the reserved tokens still read.
> 3. Then the rest of 3.71 (component audit, type scale, radii/shadow language).
>
> Then proceed 3.72 → 3.76 (cards/imagery → spots → planning → smart-groups/"Guides" → map/profile/add-event + the Profile/Settings clean split + the Profile-as-memory trio), and finish with the **multi-city Phase-4 bridge** (3.77 geo-refactor + 3.78 Walnut Creek, CA) per §15/§B.2/§I.
>
> **Acceptance bar (the north star, §B.0):** by the end of the branding pass the app should look **"vastly different but very recognizable"** — every element recognizable, dramatically more premium/branded. Move it from a "white app" to a real app.
>
> **Note:** Josh will hand you additional patches before/while you build — fold them into the sequence as they come. Flag the ⚑ items in §B.3 (the teal→Sunset-Gold call) for Charles's eyeball early, but don't block on it — ship and let him patch the hex if he wants a different signature.

## B.5 Phase-4 readiness checklist (closes §12.11 — "shippable enough")

3.7 is "done / ready for Phase 4" when:
- **Brand:** Wuzup name + "Sunlit Coastal Pop" tokens applied app-wide; no stray teal/cool-gray; masthead wordmark in place; the app reads "branded," not "prototype."
- **Imagery:** consistent card framing; the placeType-aware art floor live (no green-on-green wall); marquee spots have honest real photos where sourced.
- **Decision-support:** Home leads with emotion not the raw count; ≥1 derivable Guide + ≥1 Watch Guide prototype shipped; a sourced beach/park ranking with sources shown; the Discover→Plan bridge prominent.
- **Planning:** DayPage reads "build a good day" (warm empty states, "Fill this day" elevated, weather/energy cues).
- **Profile/Settings:** the clean split done (Profile = identity/taste/memory; Settings = maintenance); the Passport + Plans→Reality + When memory surfaces live; "why your feed" lives in Profile.
- **Multi-city bridge:** geo-config refactored to a city registry; **Tampa Bay + Walnut Creek, CA** both build and render correctly (the D-MC2 proof set; see §I).
- **Quality:** `npm test` green; lint + `vite build` clean; mobile-first verified on the 460px frame; a11y (contrast, focus, reduced-motion) holds; honesty contract intact on every new surface; ⚑X3 source-attribution page exists (Wikidata/OSM/gov per-source, per-city).
- **No regressions:** every existing flow still works; each patch shipped as its own revertable commit.

---

# ADDENDUM C (living) — Feedback intake & next-patch backlog
_The home for playtest feedback (Josh + Charles) that turns into NEW patches, captured WHILE the builder runs the planned 3.74→3.78. Append-only; this section never edits the planned-patch specs above, so it can't collide with the active builder. Dump raw — I structure + triage it here, then promote items into build-ready patch specs._

## C.0 How to dump feedback (when Charles is over)
Just say it however it comes out — one big list, screen-by-screen, or stream-of-consciousness. Helpful if easy (not required): **who** said it (J/C), **which screen**, and whether it's a *bug* / *looks-wrong* / *idea*. I'll capture each verbatim in C.2, then triage. Don't self-edit or pre-prioritize — raw is better; sorting is my job.

## C.1 Triage rules (how each note becomes a patch)
For every note I assign:
- **Type:** `quick-fix` (minutes, mechanical) · `patch` (one focused commit) · `sprint` (multi-step) · `finder-data` (pipeline/data, not UI) · `copy→Charles` · `brand→Charles` (hex/type/taste).
- **Target:** *folds into* a not-yet-built planned patch (3.74–3.78) · *new patch* (numbered **3.79+**, continuing the sequence) · *backlog* (good idea, not now) · *Phase 4*.
- **Effort:** S / M / L. **Flags:** ⚠️honesty-contract · 🔁builder-collision (touches a file the builder is mid-patch on) · ⛓depends-on.
- **Status:** `captured → speced → queued → building → done`.

**Builder-safety convention (important):** new feedback patches are **QUEUED, not auto-started.** The builder keeps running the planned sequence (3.74→3.78); Josh greenlights when a queued feedback patch jumps the line. Anything touching a file the builder is currently in gets a 🔁 flag and waits for that patch to commit (avoids merge pain on `phase-3.7-patches`). Genuinely urgent regressions can interleave — I'll mark those `HOTFIX`.

**Parallel-track idea (Josh's):** while the builder executes, I can (a) turn fresh feedback into build-ready specs, and/or (b) deepen the upcoming planned specs (3.74 planning, 3.75 Guides) so they're drop-in when the builder arrives. Say the word and I'll scout/spec ahead.

## C.2 Intake log — Charles + Josh session (2026-06-15)
Verbatim notes captured, each triaged. IDs `FB-01+` (the seeded `FB-A/B/C` are in C.3).

- **FB-01 · Map · spot hover/tap preview.** "Whenever you hover over a dot/spot on the map, the dot should slightly open up and zoom into a small feature showing what that spot is — a photo of the actual beach/area if findable; if no photo, another fun, interactive visual that zooms in to show what the spot is about." → `sprint` · **3.76 (map)** · M · ⛓depends-on FB-04 imagery · ⚠️honesty (real photo of the actual place or the art floor; no type-photos) · note: hover is desktop — mobile (the 460px target) needs **tap/long-press**, design both.
- **FB-02 · Map · filter pills cut off.** "The 'any day / today / tomorrow / weekend / free' filters on the map cut off at the end — apply the same treatment we used for the tabs on the events page." → `quick-fix` · **3.76 (map)** (or sooner) · S · reuse the LensNav wrap/quiet pattern; mechanical.
- **FB-03 · Guides · keep events vs spots separate.** "The guides on the events page and the spots page — we always want to separate events and spots. Right now there are a lot of spots showing in the events guide. Clarify the difference." → `patch` · **3.75 (Guides)** · M · architectural rule: events and places are **two separate stores** — guides must respect that boundary (an Events guide pulls events; a Spots guide pulls places; a day-plan guide may blend but must label). Bake into the GuidePage spec.
- **FB-04 · App-wide (esp. Spots) · real per-place images.** "We need good images for everything, especially spots. Find the easiest/best way to have a different image for everyone — hopefully grab pictures of the actual location from the internet." → `finder-data`+`sprint` · **image initiative (new patch)** · L · **⚠️ DECISION + honesty/licensing** (see ⚑D-IMG): real photo OF the actual place, licensed; no type-photos, no unlicensed scraping. Candidate for a dedicated scout.
- **FB-05 · App-wide · one consistent image lens; maybe replace Eventbrite posters.** "The real-photo approach may be better than the Eventbrite thing and could replace what we have in events — apply a consistent lens across the entire app. Worth looking into." → `sprint` · **image initiative (new patch)** · L · **⚠️ DECISION** (⚑D-IMG): event posters are legit source images (94% coverage) — decide augment/frame vs replace. Pairs with FB-04.
- **FB-06 · Home/Spots hero · interactive + swipeable city photos.** "Make the city-hero background more interactive — slight zoom in/out, or swipe through multiple photos of the city (a slideshow) so you're not stuck on one photo a person might not like." → `patch`/`sprint` · **new patch (cinematic hero)** · M · pairs with FB-08.
- **FB-07 · Home · move the search bar down by 'Near me'.** "Move the search bar out of the hero, down next to the 'Near me' button — it'll fit perfectly there." → `quick-fix`/`patch` · **new patch (cinematic hero)** · S · search is the hero 🔎 today; 'Near me' is a LensNav pill — move search into/beside the lens row.
- **FB-08 · Home hero · make the top a cinematic visual treat.** "The top area should be more cinematic (multiple images, per Charles) — our real visual-treat aspect. Move search out of it." → `sprint` · **new patch (cinematic hero)** · M/L · combines FB-06 + FB-07. The marquee visual moment; 3.72 de-counted the hero, this elevates it.
- **FB-09 · Gamification · streaks + satisfying button effects.** "We're going to implement a gamification layer with some sort of streaks — logging either what you did OR doing nothing. And whenever you click the buttons, the effects need to be very satisfying and intriguing to click." → `sprint` · **new patch (gamification) — GATED** · L · **⚠️⚠️ MAJOR DECISION + ban-list conflict** (see ⚑D-GAME). Do NOT build until ratified.
- **FB-10 · Calendar/Profile · retire 'Plan Your Weekend'.** "Retire the 'Plan Your Weekend' feature — it was the early version of what became the calendar; park it." → `patch` · **3.76 (profile)** · S/M · WeekendBuilder is reached from Profile→Your plans (the Calendar weekend pill was already retired in 3.5 W6). ⚑ decide: keep past weekend-history read-only, or drop it?
- **FB-11 · Calendar · remove the little weather icons.** "Remove the little weather icons — they don't serve much purpose anymore." → `quick-fix` · **3.74 (planning)** · S · ⚑ confirm scope: just the **calendar month-grid** emojis? Recommend KEEP the decision-useful weather (DayPage forecast line, PlaceDetail beach-day fit, event-day weather) — those help users decide.
- **FB-12 · Calendar · future-day quick preview.** "Clicking a future day opens a little preview so you can parse through each day, see at a glance what's scheduled, add/remove at a glance, and click to get the full day page." → `patch`/`sprint` · **3.74 (planning)** · M · a day-peek popover before the full DayPage.
- **FB-13 · Calendar · use the blank space; gamify + insights; can leak into Profile.** "Removing 'Plan Your Weekend' (top) and the 'Open Day' stuff (bottom) frees space — use it better without making it busy. The calendar looks boring; make this page super gamified and cool, with insights that could leak into the Profile section. Draw from the whole Finch + gamification idea." → `sprint` · **3.74 (planning)** · L · connects to FB-09 (gamification) + the Profile-as-memory insights (§14.3). The "make the calendar feel alive" sprint.
- **FB-14 · Event detail · "View event" CTA overlaps content.** "When you open an event, the 'View event' button (the bottom CTA to the event page) always covers either the map or the About section. Slot it so it doesn't cover anything." → `quick-fix` · **its own small patch (or fold into any DetailPage-touch patch)** · S · **Cause:** `.detail-cta` is a fixed/overlay bottom button (`DetailPage.jsx` ~line 429 `<a className="detail-cta">`; styles in `detail.css`) and `.detail-body` lacks enough bottom clearance, so it sits over the mini-map / About / More-like-this / "Found via" footer. **Fix:** add `padding-bottom` to `.detail-body` ≥ the CTA height + `env(safe-area-inset-bottom)` (and/or render the CTA as a fixed bar with a matching spacer rather than floating over content). **Accept:** the CTA never obscures the map, About, More-like-this, or the sources footer — on any event (image/no-image, coords/no-coords); safe-area + reduced-motion respected; `npm test` green. Note: this is event-detail-specific (PlaceDetail's primary CTA sits at the top of the body, not as a bottom overlay). **⚠️ RE-OPENED (2026-06-16): P16 claimed to fix this but Josh still sees the overlap → proper re-fix is now SPEC 3.7P-22 (Addendum J), with mandatory live screenshot-verification.**
- **FB-15 · Event detail · collapse sources behind a tiny "Sources" toggle.** "The source list at the bottom — keep it, but hide it behind a tiny 'Sources' you tap to expand. Most people won't care, but it's there if you want it. Don't display it live." → `quick-fix` · S · `.detail-via` ("Found via …", `DetailPage.jsx` ~line 418) becomes a small collapsed disclosure (a `<details>`/tap-to-expand with a quiet "Sources" summary → the list on expand; default collapsed). **Honesty note: still fully disclosed** — a one-tap reveal that's always present satisfies the sources-disclosed contract; this is *quiet*, not *hidden* (it's provenance, not data being withheld). Apply the same to **PlaceDetail's "Sourced from …"** for consistency, and align with the evidence-layer's "present, not academic" ethos (§G.5). **Accept:** sources collapsed behind a tiny tappable "Sources"; expand shows the same list; present on every event/place; tests green.
- **FB-16 · Event detail · rail header "Keep the night going" → "More like this".** "Drop the 'Keep the night going' overline on the More-like-this rail — it shows events on OTHER days too, so that line is misleading. Just 'More like this.'" → `quick-fix` · S · `<SecHead overline="Keep the night going" title="More like this" />` (`DetailPage.jsx` ~line 406) → remove the overline; keep the title. **VERIFIED the intent matches the code:** the `similar` rail already spans the whole upcoming window (cards use `withDate`; the code comment says *"picks span the whole upcoming window — a July event must never read as tonight"*), so multi-day IS the intent — this is a pure copy fix, no logic change. **Accept:** no "Keep the night going" overline; rail titled "More like this"; multi-day behavior unchanged; tests green.

### Sequencing at a glance
| Folds into a planned patch | New patches (queued, greenlight to schedule) |
|---|---|
| **3.74 (planning, NEXT up):** FB-11, FB-12, FB-13 | **Cinematic hero:** FB-06 + FB-07 + FB-08 |
| **3.75 (Guides):** FB-03 | **Image initiative (likely 2 patches: finder sourcing + app-wide lens):** FB-04 + FB-05 — ⚑D-IMG |
| **3.76 (map/profile):** FB-01, FB-02, FB-10 | **Gamification layer:** FB-09 (+ the gamified side of FB-13) — ⚑D-GAME, GATED |

> **Timing note:** the builder is heading into **3.74 next**, so FB-11/12/13 should be promoted to build-ready specs (C.4) **soon** so they land in 3.74 instead of becoming a re-do. The new patches stay QUEUED until Josh greenlights + the two ⚑ decisions resolve.

## C.2.1 ⚑ Decisions this session surfaced (need Josh/Charles)
- **⚑D-GAME — Streaks vs. the ban-list (the big one).** FB-09 asks for **streaks**, but the app's load-bearing ban-list (CALENDAR_BRIEF §7, honored everywhere) explicitly forbids **streaks / guilt / vanity counts** and mandates **zero-is-silence**. This is a direct reversal of a core contract. The "log what you did OR nothing" framing is a *clever* reconciliation — a rest/"nothing" day still counts, so there's no broken-streak punishment — but a classic streak that *breaks* and shames is exactly what was banned. **Recommendation:** ratify a **reframed** version — a calm "rhythm / your year of showing up" that celebrates logging (including rest) and **never punishes a gap** (a missed day is silent, not a broken flame), keeping zero-is-silence. The satisfying button effects are great and on-brand — but mind the reserved `--reward` violet discipline (6 sanctioned moments); a juice pass may expand it. **Do not build FB-09 until Josh explicitly ratifies the reframed model.**
- **⚑D-IMG — Real per-place photos at scale + a consistent app-wide image lens.** FB-04/05 are the most valuable visual lever AND the biggest honesty/licensing risk. "Grab from the internet" must stay inside the contract: a **real photo OF the actual place**, **licensed** (public-domain / government-open / CC-BY with attribution on the ⚑X3 page), **no type-photos**, **no unlicensed scraping**. Real sourcing options to weigh: expand Wikidata/Commons matching, government/park open-data photo fields, or a licensed API (e.g. Google Places Photos — note ToS, attribution, and cost). And FB-05's "replace Eventbrite posters with a consistent lens" is a real call — augment/frame the posters vs. replace them. **Recommendation:** spin a dedicated **scout** on honest-image sourcing (coverage % + licensing + cost per option) before committing; ship the placeType-art floor (already done in 3.73a) as the safe baseline meanwhile.
- **⚑D-WX (small) — Weather-icon scope (FB-11).** Confirm we only remove the **calendar month-grid** emojis and KEEP the decision-useful weather elsewhere (DayPage forecast, PlaceDetail beach-day fit, event-day weather).
- **⚑D-WKND (small) — Plan-Your-Weekend retirement (FB-10).** Keep past weekend plans as **read-only history** in Profile, or drop them entirely?

## C.3 Seeded flags (already surfaced by the builder — candidates for next patches)
Real items the 3.71–3.73 work turned up, parked here so they're not lost:

- **FB-A · Sourced spot rankings are DATA-BLOCKED.** ⚠️honesty · `finder-data` · M. The §B.2-row-6 "best beaches ranked by sources & amenities" was found to be *fabricated on real data* (all 22 beaches have `srcCount 1` + 0 amenities → a flat score), so 3.73b honestly shipped a beach-day *browse* instead and added a reality-guard. **To unlock real rankings (§6.2), the finder must first enrich beach amenities/designation** (a `finder-data` patch) — or wait for the 3.75 curated layer. Decision for Josh: enrich the finder, or keep honest browse + lean on curated Guides for "best of." **→ RESOLVED by Addendum G (the Activity Evidence Layer):** rankings become honest once a subject hits the 3-independent-source-family tier; until then it stays a browse. That's the principled unblock.
- **FB-B · Map markers need the gold-on-light AA sweep.** `quick-fix` · S · already *targeted at 3.76*. `map.css:24/88/270` marker colors were deferred from 3.73's white-on-gold contrast fix — fold into 3.76 (map polish) as planned.
- **FB-C · ⚑X3 source-attribution page still owed.** `patch` · M · Phase-4 gate item. Wikidata/OSM/gov per-source (and per-city once multi-city lands) attribution page; referenced by the §B.5 readiness checklist. Charles/Josh: lives in Settings → About.

## C.4 Promoted patch specs (build-ready)
**Resolutions (Josh, 2026-06-15):** ⚑D-GAME **RATIFIED — gamification is GO** (the anti-streak/anti-gamification ban-list clauses are superseded; see **Addendum E**). ⚑D-IMG **scout launched** (workflow `wy6r1j0e0`) — FB-04/05 specs land when it returns; placeType art floor (3.73a) is the shipped baseline. ⚑D-WX **confirmed** — remove the calendar-grid weather emojis only; keep decision-useful weather elsewhere. ⚑D-WKND **resolved — DROP it entirely**, including past weekend history.

Each spec below is build-ready: surface · the change · files · acceptance · contract notes. The **data-honesty pillars stay sacred everywhere** (never-hide, no fake data, no type-photos, taste-reorders-never-filters, sources disclosed, sponsored/added-by-you labeled) — those are untouched by the gamification ratification.

> ### ⚠️ C.4.0 STATUS CORRECTION + re-sequencing (the builder raced ahead)
> By the time this feedback came in, **the builder had already shipped all app-side patches 3.71–3.76** (head `a61ebad`, 59/59 tests) and is moving into the **multi-city capstone (3.77 geo-refactor → 3.78 NYC)**. So the "→ 3.74 / 3.75 / 3.76" routings in the specs below are **SUPERSEDED** — those patches are done. **Treat every spec below as a NEW post-3.76 patch** (a "3.7 polish wave," suggested numbering **3.7P-1, 3.7P-2…** so it doesn't collide with the multi-city 3.77/3.78). The spec *content* still stands; only the target changes.
>
> **What already-shipped work partially covers (avoid re-doing):**
> - **3.74** already shipped the "build a good day" pass (whyFits chips, a DayPage weather cue, warmer empty slot/caption). FB-12 (day-peek) + FB-13 (gamified calendar/insights) were **not** done → still fresh. FB-11 (remove calendar-grid weather emojis) → still fresh (3.74 *added* a DayPage cue, didn't remove the grid emojis).
> - **3.76b** shipped Profile-as-memory (Plans→Reality + actual-rhythm mirror; the dated Passport journal already existed) — so FB-13's "insights" overlap this; **share those derivations, don't duplicate**.
> - **3.76 map declutter + curated bottom-sheet was DEFERRED** pending a Charles/Josh visual direction — **FB-01 (spot hover/tap preview) + FB-02 (filter cutoff) ARE that direction.** Bundle them with the deferred map work into one **map patch**.
> - **3.75 Guides** shipped (derivable + Watch Guides). FB-03 (events/spots separation) is now a **Guides follow-up fix**, not part of the original build.
> - **Sourced rankings** never shipped (pulled, data-blocked) — FB-04/05 image work + the rankings unblock remain open (scout `wy6r1j0e0` running).
>
> **⚑ SEQUENCING DECISION FOR JOSH (real, and time-sensitive):** the builder is about to start multi-city. Per **Addendum D.4** ("if 3.71–3.76 reveal major polish debt, finish Tampa polish before starting NYC"), this Charles/Josh playtest feedback **is** that polish debt. **Recommendation: run the 3.7 polish wave BEFORE the multi-city capstone** — finish making Tampa genuinely premium, then stand up NYC on a polished base (so new cities inherit the good version, not a mid-polish one). If you'd rather the builder keep going on multi-city and batch the polish after, that's fine too — but **tell the builder which**, since it's mid-stream. (My lean: polish wave first.)

### → 3.74 (planning) — the builder's NEXT patch; these three land here
**SPEC FB-11 · Remove calendar-grid weather emojis** · `quick-fix` · S
- Remove the per-day weather emoji from the month grid (`CalendarView.jsx` ~`{w && <span className="mwx">…}` near line 341, the `wxFor` helper, `.mwx` in `calendar.css`). If the `wx` prop to CalendarView is now unused, drop it cleanly (App.jsx passes it).
- **Keep weather where it aids a decision:** DayPage forecast line, PlaceDetail beach-day fit, event-day weather in DetailPage. Do NOT touch those.
- **Accept:** month grid shows only personal marks (planned/rest/did); no weather emoji; other weather intact; no console warnings; `npm test` green.

**SPEC FB-12 · Future-day quick-preview popover** · `patch` · M
- Tapping a today-or-later cell currently calls `openDay(ts)` → instead open a lightweight **day-peek** (popover/small sheet) summarizing that day at a glance: the ☀️ Day / 🌙 Night slots (filled titles or "open"), rest state, an inline **remove** per filled slot, and **"Open full day →"** to the DayPage. Past days stay browse-only (unchanged).
- Reuse `dayplan.js` seams — `loadDayPlans`, `dayEntryFor`, slot resolution, `withClearedSlot`; **do not duplicate** DayPage logic. "Add at a glance" routes into the full day (its picker lives there) — keep the peek read-mostly + remove + open.
- Files: `CalendarView.jsx`, `calendar.css` (new peek styles). 
- **Accept:** tap future day → peek with slots at a glance + inline remove + open-full-day; past days unchanged; reduced-motion respected; tests green. Pairs with FB-13.

**SPEC FB-13 · Calendar feels alive (gamified + insights), using the freed space** · `sprint` · L
- With "Plan Your Weekend" gone (FB-10) and the grid de-cluttered (FB-11), redesign the Calendar tab to feel **premium and alive, not boring** — the month grid stays the anchor, plus a **calm insights/rhythm strip** from EXISTING data (did-days, days-out-this-month, variety firsts, and the new rhythm/streak per Addendum E). Satisfying micro-interactions on plan/log actions. **Not busy** — Josh: don't overload the page.
- Insights may mirror Profile-memory (§14.3) — **share the derivations, don't duplicate the surface**: Calendar = this-month rhythm at a glance; Profile = the full logbook/passport.
- Files: `CalendarView.jsx`, `calendar.css`; derive from `dayplan.js`; coordinate with the gamification module (FB-09 / Addendum E).
- **Accept:** calendar reads premium/alive; insights from real local data (zero-data → silent, as tone); satisfying interactions; not cluttered; data-honesty intact; tests green.

### → 3.75 (Guides)
**SPEC FB-03 · Events and Spots stay separate in Guides** · `patch` · M
- A Guide respects the two-store boundary: an **Events** guide resolves from the events store; a **Spots** guide from places; a blended **day-plan** guide must clearly **label** which items are events vs spots. Add `domain: 'events' | 'spots' | 'mixed'` to the guide schema (`guides.json`) + GuideCard/GuidePage; Events-page guides pull events, Spots-page guides pull places. Fix the current leak (spots appearing in an events guide).
- **Accept:** no spots in an events-page guide (and vice-versa); mixed guides label each item's domain; never-hide preserved (each guide → see-all of its underlying set). Bake into the 3.75 GuidePage build.

### → 3.76 (map / profile / add-event)
**SPEC FB-01 · Map spot hover/tap preview ("zoom into what it is")** · `sprint` · M · ⛓ richer with FB-04
- Interacting with a spot marker opens a small preview that reveals what the spot is: a **real photo of the actual place** when available (from the D-IMG pipeline), else the **placeType art preview** (reuse 3.73a `PLACETYPE_HUE/EMOJI` + SpotCard bits) + name/type/differentiator. Tapping through → PlaceDetail.
- **Interaction:** hover on desktop, **tap/long-press on the 460px mobile target** — design both; a hover-only feature is invisible on phones.
- Files: `MapView.jsx`, `map.css` (read MapView's marker model first — scout hasn't deep-read it). 
- **Accept:** marker interaction shows a photo-or-art preview (honest: real photo of THIS place or art; no type-photos); works on touch; → PlaceDetail; not janky; tests green. Ships with the art preview regardless of photo coverage.

**SPEC FB-02 · Map filter pills no longer cut off** · `quick-fix` · S
- The map filter row (any day / today / tomorrow / weekend / free) clips at the edge — apply the LensNav wrap/quiet treatment (`flex-wrap`, no clip, ≥44px targets) used on the events/spots pages. Reuse LensNav or its CSS pattern.
- Files: `MapView.jsx`, `map.css`. **Accept:** no cutoff; wraps gracefully; matches the events-page lens look; tests green.

**SPEC FB-10 · Drop "Plan Your Weekend" entirely (incl. history)** · `patch` · M · ⚠️builder-collision with the Profile pass
- Retire the WeekendBuilder feature AND drop weekend history (Josh: "just drop it"). Remove from `ProfileView.jsx` the "Your plans → This weekend" card + the `HistoryCard` + `loadHistory()`/`weekend-history-v1` reads. Retire `openWeekend` + the `weekend` subpage case (`nav.jsx`), the WeekendBuilder render (`App.jsx`), `WeekendBuilder.jsx`, `weekend.css`.
- **CRITICAL — do NOT remove shared helpers:** `weekend.js` exports `pickerModel`, `fitsDay`, `daypartOf`, `PARTS`, etc. used by **DayPage / PickerSheet / AddEvent**. Audit imports before deleting anything; keep the shared selectors, retire only the WeekendBuilder *view* + weekend-history surfacing. **Keep the day-history "Past days" journal** in Profile (that's the §14.3 Passport foundation).
- **Accept:** no Plan-Your-Weekend entry anywhere; no weekend history surfaced; **DayPage planning fully intact**; no dead imports; tests green. Sequence alongside the Profile/Settings split + memory work (all 3.76, same files).

### → New queued patches (greenlight to schedule; QUEUED, builder finishes 3.74→3.76 first)
**SPEC FB-07 · Move search down beside "Near me"** · `quick-fix` · S — *can ship early*
- Move the hero 🔎 search out of the hero and into/beside the LensNav lens row (next to "Near me"). Independent of the bigger hero work; small win.
- Files: `HotView.jsx` (remove hero search button), `LensNav.jsx` (host a search affordance in the lens row) or place it adjacent; `topnav.css`/`App.css`. **Accept:** search lives by Near me, works, ≥44px target; hero loses the search button; tests green.

**SPEC FB-06 + FB-08 · Cinematic, swipeable hero (the visual treat)** · `sprint` · M/L · ⛓ needs licensed city photos (D-IMG)
- Turn the Home (and Spots) hero into a cinematic, **swipeable multi-photo** treat (so no single disliked photo dominates) with subtle zoom/parallax (HotView already has parallax). The hero becomes pure visual treat + the Wuzup wordmark + the soft kicker (3.72 already de-counted it). Search is gone from here (FB-07).
- Data: `CITY.hero` (one URL) → `CITY.heroes[]` (array of **real, licensed** city photos — ties to the D-IMG licensing plan). Spots hero too.
- Files: `lib.js` (CITY.heroes), `HotView.jsx`, `LocationsView.jsx`, `App.css`. **Accept:** swipeable multi-photo hero; reduced-motion disables auto-advance; images licensed/attributed; recognizable but elevated; tests green.

**SPEC FB-09 · Gamification layer** (RATIFIED — see Addendum E) · `sprint` · L
- A cohesive Finch-style gamification layer: (1) a **rhythm/streak** counting days you logged what you did OR a **rest/"nothing" day** (rest counts — there is no breakable, punishing streak; a gap is **gentle**, never shaming — Finch-kind); (2) **satisfying, juicy effects** on the key actions (planning a day, "I went", saving, completing a day/plan); (3) surfaces on **Calendar** (this-month rhythm, with FB-13) + **Profile** (the longer arc / logbook, §14.3).
- Files: a new `gamify.js` (pure selectors over existing stores: been-there, day-history, converted ledger, taste), `CalendarView.jsx`, `ProfileView.jsx`, micro-interaction CSS. The reserved `--reward` violet scarcity is **relaxed for sanctioned gamification moments** (Addendum E) — but keep effects tasteful/premium, not slot-machine.
- **Sequencing:** lay the calendar/profile *structure* in 3.74/3.76, then apply this gamification + juice pass on the **finalized** surfaces (so juice lands on final layouts, not moving targets).
- **Accept:** rhythm/streak reads motivating + kind (never punishing; rest counts; gaps silent); interactions feel satisfying; built ONLY on honest self-reported local data; no fake-data/never-hide violations; reduced-motion respected; tests green.

**SPEC FB-04 + FB-05 · Real per-place images + consistent app-wide lens** · `finder-data`+`sprint` · L · **scout `wy6r1j0e0` DONE**
- **The hard truth (reality layer):** "just grab pictures of the actual location from the internet" mostly **can't be done honestly at scale.** The honesty contract (real photo OF the actual place, licensed — no type-photos, no scraping) caps the **free** path at **~2% coverage in Tampa** (~24 today → ~30–37 with the free layers below). Stock/geosearch/Google all fail honesty or licensing. So the headline reframe: **the win is the LENS, not the coverage.**
- **Patch 1 — finder enrichment** (`finder-data`, ~S/M): extend `places-images.mjs` with **Wikidata P373** (curated Commons categories, +8–12 places) + **OSM `image=`/`wikimedia_commons=` tags** (validated + license-checked, +5–10) + an **`attributions.json`** cache (author/license/url, feeds ⚑X3). Honest, free, tracked, idempotent. Net: ~+12–17 real photos.
- **Patch 2 — the consistent app-wide lens (the real prize, answers FB-05)** (`sprint`, ~S/M): a shared **`FramedImage`** component + aspect-ratio tokens (`--ar-card 16/9 · --ar-detail 4/5 · --ar-thumb 1/1`) so **every image — chaotic Eventbrite poster, real place photo, or the placeType art floor — sits in ONE premium visual language** (fixed ratio, `object-fit:cover`, optional scrim, art-floor fallback). **Verdict on "replace Eventbrite": FRAME, don't replace** — posters are legitimate source images; the chaos is a *framing* problem, not a coverage problem. Refactor `CardImg`→`FramedImage`; apply to event detail + place detail + SpotCards. (This is the single highest-value image patch and it costs nothing.)
- **Multi-city changes the math (good news):** NYC/Austin/Seattle have **2–5× denser** Wikidata/OSM, so the free layers scale to **~6–19%** there — don't pay to photograph Tampa when denser cities won't need it.
- **Honesty guardrails:** P18/P373 = safe (curated); OSM tags = HEAD-validate + license-check; **REJECT** Unsplash/stock (type-photo), Commons raw geosearch w/o name-match, and Google Places (can't cache per ToS + unvetted stock). 
- **⚑ D-IMG-PAID (decision for Josh):** ship the **free-honest path (~2% Tampa, rec)** now, OR add a paid API in **Phase 4** for more coverage — Foursquare ~$50–100/mo → ~3–4%; Google ~$100–200/mo + a verification service (**not recommended**, honesty risk). **Recommendation: ship free in 3.7; revisit paid only if user feedback demands it.** The art floor (3.73a) + the framing lens make ~2% feel intentional, not empty.
- Files: `finder/places-images.mjs`, `finder/places-sources/osm.mjs`, `finder/cache/attributions.json` (new) · `app/src/FramedImage.jsx` (new), `cards.jsx`, `index.css` (ar tokens), `cards.css`, `DetailPage.jsx`, `PlaceDetail.jsx`. **Accept:** ~36+ real photos; one unified frame across posters/photos/art; no broken-image glyphs; licenses captured for ⚑X3; tests green.

---

# ADDENDUM E (2026-06-15) — Gamification RATIFIED + ban-list amendment
_Josh, this session: "We do want this gamified… that [ban-list] was before we really discussed the Finch aspect. If anything we're saying now coincides with that, you're free to ignore that from the ban-list." This addendum records that ratification precisely so the builder knows what changed — and, just as importantly, what did NOT._

## E.1 What is now SANCTIONED (the override)
The Finch-style **gamification layer is GO.** Specifically un-blocked:
- **Streaks / a rhythm** — including the "log what you did **or** a rest/nothing day" model. Rest counts.
- **Satisfying, juicy micro-interactions** — plan/log/save/complete actions should feel great to tap.
- **Insights / progress surfaces** on Calendar and Profile (the logbook/passport, §14.3).
- The reserved **`--reward` violet** scarcity (the old "6 sanctioned moments only" rule in `index.css`) is **relaxed** for sanctioned gamification moments — keep it tasteful, but it's no longer capped at six.

## E.2 What in the ban-list is SUPERSEDED
The CALENDAR_BRIEF §7 ban-list clauses that **conflict with gamification are lifted**: the prohibitions on **streaks**, on **gamification restraint**, and on **"zero-is-silence" as a hard prohibition** (it stays available as a *tone* choice where it reads well, but it's no longer a rule that blocks progress/insight surfaces). "User-initiated only / no push cadence" can also flex if a gentle in-app nudge serves the loop — Josh's call per feature.

## E.3 What STAYS sacred (do NOT let the override bleed here)
The override is about **how we present the user's OWN behavior** — it does **not** touch the data-honesty contract. These remain fully in force on every surface:
- **never-hide** (curation-by-quality + see-all) · **no fake data** · **no type-photos** · **taste reorders, never filters** · **sources disclosed** · **sponsored / added-by-you always labeled.**
- Gamification is honest **by construction**: it's built on the user's **self-reported, on-device** data (been-there, did-days, plans, taste) — counting your own real actions is not fabrication. So streaks/insights are fine *because* they ride on honest local data; never invent activity, never infer a "went" the user didn't confirm.

## E.4 The recommended spirit (Finch-kind — Josh's call to keep or drop)
Finch is gamified **and gentle** — its bird never shames you for an off day. Recommend we keep that spirit so the layer feels premium, not manipulative: **motivating, not punishing.** Concretely — a missed day is **quiet, not a broken-flame failure**; rest is a valid logged choice; celebrate showing up rather than punishing gaps. This isn't the old ban-list creeping back; it's just what makes gamification feel like a *companion* instead of a *dark pattern*. If Josh wants a harder/competitive streak instead, that's his call — flag it and build it. (Build-ready details in **SPEC FB-09**, C.4.)

_End of amendment._

---

# ADDENDUM F (2026-06-15) — The 3.7 polish wave + the "Elite Visual Polish" guide
_Josh ratified: **ship the free-honest image path** (revisit paid only later) and **run the polish wave BEFORE multi-city** (builder does NOT start 3.77 yet). This addendum sequences the polish wave and folds in Gemini's aesthetic blueprint._

## F.0 Sequencing — RULED
- **D-IMG-PAID → ship FREE** (Wikidata P373 + OSM tags + the framing lens + art floor). Revisit paid APIs in Phase 4 only if user feedback demands it.
- **Polish wave runs BEFORE the multi-city capstone** (per Addendum D.4 — finish Tampa polish first; new cities inherit the good version). The builder finishes 3.7P-* below, THEN does 3.77 (geo-refactor) → 3.78 (NYC).

## F.1 Polish-wave order (new patches; 1 commit each; screenshot-QA per D.5)
Front-load the shared visual foundation; the rest can flex/parallelize.
1. **3.7P-1 · Elite visual polish foundation** (Gemini guide §F.2 + the `FramedImage` lens from SPEC FB-04/05 patch-2). Lifts every surface. **End with the Addendum-D.1 9-screen screenshot checkpoint** before rolling further. Commit in logical chunks (typography · buttons/icons · depth/glass · framing).
2. **3.7P-2 · Image finder enrichment** (SPEC FB-04 patch-1: Wikidata P373 + OSM `image=` tags + `attributions.json`). Finder-data, parallel-safe.
3. **3.7P-3 · Calendar polish** (FB-11 remove grid weather · FB-12 day-peek popover · FB-13 gamified/insightful calendar).
4. **3.7P-4 · Gamification layer** (FB-09 — ratified, Addendum E). After the calendar/profile surfaces settle so juice lands on final layouts.
5. **3.7P-5 · Map** (FB-01 spot hover/tap preview · FB-02 filter cutoff · + the **deferred** 3.76 declutter + curated bottom-sheet — this feedback is its direction).
6. **3.7P-6 · Cinematic hero + search move** (FB-06/08 swipeable hero · FB-07 search → beside Near-me). Needs licensed city photos (ties to F.3).
7. **3.7P-7 · Guides: events/spots separation** (FB-03 follow-up fix).
8. **3.7P-8 · Retire Plan Your Weekend** (FB-10 — keep `weekend.js` shared helpers!).
→ then **3.77 geo-refactor → 3.78 Walnut Creek, CA** (was NYC — see §I).

## F.2 "Elite Visual Polish" guide (Gemini) — as 3.7P-1, triaged [DONE]/[NEW]/[REFINE]
Faithful capture with concrete values; flagged against what 3.71–3.76 already shipped so the builder doesn't re-do.

**1 · Typography & hierarchy**
- [NEW] **Eradicate ALL-CAPS as a hierarchy device** app-wide — replace with size+weight. 3.72 de-shouted the `heroKicker`, but overlines/kickers/section labels still lean uppercase (e.g. `sec-overline`, "ALWAYS HERE · NO SCHEDULE", Primer "WELCOME TO…"). Use Kumbh Sans (semibold/bold) for emotional headers/section titles/hero; Inter strictly for data/body.
- [REFINE] body **`line-height: 1.6`** (3.6 set 1.5 — bump to 1.6); tighten tracking on large Kumbh headers (`-0.02em` / `-0.5px`) so they read engineered.
- [DONE] warm-tinted ink/muted (never stark `#000`/`#fff`) — `--ink`/`--muted` already warm (3.71).

**2 · Buttons & interactive**
- [NEW] **Primary CTAs get tactile depth:** soft glow `box-shadow: 0 4px 14px rgba(255,140,66,0.3)` (the `--accent`) + a 1px semi-transparent white top inner-highlight. (Applies to "Make this my plan", "Fill this day", "Get Tickets", etc. — keep dark-ink-on-gold per the AA fix.)
- [DONE/REFINE] press state `scale(0.97–0.98)`, 120ms down / 200ms release — exists (N2 used 0.98; Gemini suggests 0.97 — builder's call, keep consistent).
- [NEW/REFINE] **chips:** unselected = transparent + 1px border; selected = fills `--accent` with inverse text via a 200ms crossfade.

**3 · Icons — stroke SVG > emoji for UTILITY**
- [NEW] **Replace functional emojis with 1.5px single-color stroke SVGs** (Lucide/Heroicons): the fact-row icons 📅 (When) 📍 (Where) 🎟️ (Price) on DetailPage/PlaceDetail, amenity-row icons, and any utility glyphs. SVGs inherit `--muted`.
- [KEEP] **emoji stays for IDENTITY only** — category badges, placeType art floor, the deck — intentional colorful stamps, not UI glyphs.

**4 · Depth, shadows & glass**
- [NEW] **Kill harsh 1px card borders → multi-layer diffused shadow:** `box-shadow: 0 2px 10px rgba(26,20,16,0.04), 0 8px 24px rgba(26,20,16,0.06)` to lift cards off the Aged-Linen bg. (Reconcile: the `.imgbox` image-frame hairline from 3.72 is on the *image*, not the card border — keep or convert to scrim per below; this item targets CARD borders.)
- [NEW] **Glassmorphism (the single most "elite" detail):** `backdrop-filter: blur(20px) saturate(180%)` + a semi-transparent surface tint on the **LensNav** sticky header and the bottom sheets (**PickerSheet**, the LensNav category sheet, day-peek). Verify iOS Safari + reduced-transparency fallback.
- [NEW/REFINE] **Image framing:** consistent `14px` radius + a **dark bottom scrim** `linear-gradient(transparent → rgba(0,0,0,0.6))` so overlaid white text stays legible on any poster. **Build this INTO `FramedImage`** (it's the same component as SPEC FB-05) — one home for framing.

**5 · "Sunlit Coastal Pop" color polish**
- [DONE] `--bg #faf8f5`, `--card #fefdfb`, paper grain — shipped 3.71.
- [DONE] `--accent #ff8c42` for active/links/selection; **`--accent-ink #b35418` enforced for small accent-text** (AA) — shipped 3.71/3.73.
- [DONE] **`--hot #ff3b5f` reserved** for heat badges + save-hearts ONLY — existing contract; don't dilute.

## F.3 Design principle (Josh) — lean LESS on images where they're weak
Since honest photo coverage is thin (~2% free in Tampa), **don't build layouts that look broken or empty without a photo.** Make the photo an *enhancement*, not a *requirement*: lean on strong editorial typography, the warm palette, the placeType art floor, generous spacing, and the framing lens so a no-photo card/detail still reads premium. This both fits the honesty reality AND is good design — and it lowers the pressure to source images we can't get honestly. Apply across cards, detail heroes, spot cards, and the map preview (FB-01 already degrades to art).

_End of amendment._

---

# ADDENDUM G (2026-06-15) — The Activity Evidence Layer (the honest popularity engine)

> **PROPOSED SUCCESSOR (2026-07-06):** [planning/v2/quality-engine.md](planning/v2/quality-engine.md)
> proposes absorbing this addendum's spine (incl. the G.7 builder prompt) and resolving ⚑D-EVID in
> §13.1. Pending Josh's ruling, this remains the historical source and neither doc is build authority.

_From GPT's read-only research (verified against the code). This is the **honest mechanism that unblocks sourced rankings** (FB-A / §6.2 / §B.2-row-6, which the builder correctly pulled as fabricated). Premise: don't stuff more into the finder (it's already strong) — add a **separate, deterministic evidence layer beside it** that records "what public evidence says this is worth considering," so the UI can say "guide-backed" / "mentioned by 3 local guides" without pretending Wuzup personally knows "the best." **Ambitious underneath, humble on the surface.**_

## G.1 Why it fits (verified)
- The app already has the honesty posture: best-of starts as a curated file (§10 / PHASE_3.7 line 365), and it already **caught itself faking authority** (the flat "best beaches" selector was pulled, `places.js:189`). This layer is the principled way to earn ranking back.
- **Clean reuse of existing primitives:** `sourceFamily(e)` already exists (`lib.js:58`, strips pagination so "Eventbrite (Tampa p2)" == "Eventbrite") → GPT's **"same source family counts once"** maps onto it directly. `guides.json` already has a `sources[]` provenance field (`{id,kind,title,pov,window,keywords,sources[]}`) → the ledger feeds/extends it. No conflict with `events.json`/`places.json` (untouched fact layers) or `curate.js`.

## G.2 Architecture
- **`finder/activity-evidence.json`** — the evidence ledger. One record per public signal:
  `{ cityId, subjectKey, subjectKind:'place'|'event', sourceUrl, sourceName, sourceFamily, evidenceType:'guide_mention'|'official_listing'|…, claimLabel, fetchedAt, confidence, productionScoringAllowed }`.
- **`finder/activity-intel.mjs`** (later) — scores from the ledger. `events.json`/`places.json` stay untouched.
- **Deterministic scoring tiers (the gate for what the UI may claim):**
  - *Candidate (raw universe):* **1** real source.
  - *Recommended tier:* **≥2 independent** positive signals.
  - *Top placement:* **≥3 independent source families.**
  - Same publisher/network/domain family **counts once** (use `sourceFamily`). OSM/Wikidata confirm **identity/coords/photos/notability — NOT popularity.**
  - **Flat signal → render BROWSE, not ranking** ("Good beach options," "Worth considering," "Guide-backed picks"). This is exactly what 3.73b already did by hand — now formalized.

## G.3 Claim-safe UI language (hard rule — extends the honesty contract)
- **Allowed:** "Guide-backed," "Mentioned by 3 local guides," "Worth considering," "Official calendar listing."
- **Forbidden unless strictly proven (≥3 independent families):** "best," "#1," "most popular," "locals love," "must-do," "Wuzup recommends."

## G.4 Tampa source registry (tiered — also the multi-city source map)
Baseline identity (OSM, Wikidata/Wikimedia, city/county open data) · Official/DMO (Visit Tampa Bay, Visit St. Pete/Clearwater, Tampa.gov, HCPLC, county/city calendars) · Venues/districts (Downtown Partnership, Ybor, Water Street, Armature Works, Straz, Tampa Theatre, museums, sports venues, markets) · Local editorial (Creative Loafing, Axios Tampa Bay, That's So Tampa + I Love the Burg as **one family**, Tampa Magazine, Tampa Bay Parenting) · Specialist/national corroboration (Michelin, Eater, Florida Rambler, Florida Hikes, Atlas Obscura, Visit Florida, Southern Living, Time Out) · Aggregators (Eventbrite, AllEvents, UNATION — recall, **not popularity alone**).
**Exclude v1:** Google Places API, Yelp API, Ticketmaster API, social scraping, login/paywall/captcha, Reddit/forums for production scoring.

## G.5 Compliance guardrails
Public pages only; obey robots; **fail closed** on auth/paywall/captcha/429/blocked-robots; store **facts + short evidence only, never article bodies**; extract Schema.org `Event`/`ItemList`/`ListItem` + headings/lists; use sitemaps/RSS for discovery; OSM needs ODbL attribution; Google/Yelp/Ticketmaster need keys/billing → violate the free/keyless v1 constraint (and the ⚑D-IMG-PAID "free first" ruling).

## G.6 Sequencing + the decision (⚑D-EVID)
This is `finder-data`, multi-phase, and **shares the per-city source-registry with the multi-city refactor** (§15) — they're synergistic. It is NOT part of the UI polish wave. Recommended:
- **Phase 1 (ledger, NO crawler)** — load current events/places + `guides.json` + a small **hand-curated public-guide evidence file**; emit normalized evidence records with `sourceFamily` + provenance. Small, high-honesty; makes Guides legitimately **"guide-backed."** → **slot as a late-3.7 patch (3.7P-9), after the polish wave.**
- **Phase 2 (deterministic scoring)** — the candidate/recommended/top tiers; **this is what re-enables honest rankings** (FB-A unblocked: ranking allowed only at the 3-family tier, browse otherwise). → **Phase 4** (or interleave with multi-city, shared registry).
- **Phase 3 (allowlisted public-guide extraction)** — robots/sitemaps/RSS/JSON-LD, store facts not text. → **Phase 4.**
- **⚑ Decision for Josh:** confirm Phase-1 = late-3.7 (3.7P-9) and Phases 2–3 = Phase 4 (shared infra with multi-city) — or pull scoring earlier. (My rec: as stated; Phase 1 is a cheap honesty win, scoring/extraction ride with multi-city's source work.)
- **Effect on FB-A:** the "best beaches" stays an honest **browse** until the ledger reaches the 3-family tier for those subjects; then ranking is *earned*, with sources shown.

## G.7 Build-ready paste-to-builder (GPT's, verbatim — for when 3.7P-9 / Phase 4 starts)
```
Build a read-only-first activity evidence layer beside the existing finder.
Do not rewrite finder/finder.mjs. Do not merge events and places. Existing events.json and places.json remain fact layers.
Add: finder/activity/source-registry.json · finder/activity/config/tampa-bay.json · finder/activity-evidence.mjs · finder/activity/identity.mjs · finder/activity/signals.mjs · finder/activity/rank.mjs · finder/output/activity-evidence.json · finder/output/activity-health.md
Phase 1: no crawler. Load current events, places, app/public/guides.json, and a small hand-curated public-guide evidence file. Emit normalized evidence records with sourceFamily and provenance.
Phase 2: deterministic scoring: candidate = real source exists; recommended = 2 independent signals; topPlacementEligible = 3 independent source families; same family/domain/network counts once; OSM/Wikidata identity signals do not count as popularity.
Phase 3: allowlisted public guide extraction only after the ledger works. Use robots, sitemaps/RSS, JSON-LD, Schema.org Event/ItemList/ListItem, headings/lists. Store facts, not article text.
UI language: Allowed: "Guide-backed," "Mentioned by 3 local guides," "Worth considering," "Official calendar listing." Forbidden unless strictly proven: "best," "#1," "most popular," "locals love," "must-do," "Wuzup recommends."
Tests: no best/top/most-popular label with fewer than 3 independent signals; no commercial venue admitted from name/category/coords alone; every surfaced claim has provenance URL/source/fetchedAt/evidenceType; same source family cannot double-count; flat-signal categories render browse guides, not rankings; deterministic output with frozen inputs.
```

_End of amendment._

---

# ADDENDUM H (2026-06-15) — Events / Spots / Map UX re-vision (the P10+ wave)
_From a 5-pass read-only UX audit (Events · Spots · Map · daily-journey · external best-practice → synthesis, workflow `wshlxnwj4`). Josh's ask: zoom out, form a cohesive vision of what the Events & Spots pages should BE; reorganize what's built (reorder/merge/remove/tweak), reject anything already in Wave 2 (P1–P9). This is the **P10+ sub-wave (3.7P-10…15)**, scheduled AFTER the current polish wave + multi-city (or interleaved — Josh's call)._

## H.0 The thesis
**Wuzup = one "what should I do?" app with two discovery paths: WHEN (Events, time-bound) and WHERE (Spots, place-bound) — both organized by INTENTION first, not data type.** Keep them as two tabs (the data stores stay separate), but give them the **same IA grammar**: Hero → Intent (Guides as the primary entry, not a buried carousel) → a lean scope row → 2–3 editorial picks → Everything (browse/see-all). The **Map is the spatial companion** ("what's around me right now"), not a third rival. And the **five overlapping "ways to find things"** (LensNav pills · Guides · magazine sections · search · map) collapse into ONE model: **Intention → Scope → Result → Detail.**

## H.1 Events page — target IA (mostly collapse + reorder)
Today: Hero → LensNav → Shelf → Tonight → Your-kind-of-night → Guides carousel → Big One → Hidden Gems → Free → Recently viewed → Everything. **That's ~7 carousels stacked — the "wall of sections," with heavy overlap** (a free hidden gem tonight can repeat in 4 sections).
**Target:** Hero → **Guides as intent pills** (moved up from the buried carousel) → Shelf (if any) → **2–3 editorial picks** (The Big One + Hidden Gems) → **Everything** (date-grouped + category subheaders + taste-ordered).
- **Biggest single change:** collapse ~7 carousels → ~4 sections. Nothing is lost — "Your kind of night" folds into Everything's taste ordering (with P9 showing *why*), "Free" becomes a scope toggle (it's a filter, not editorial), "Recently viewed" moves down next to Everything. Page becomes scannable in seconds.

## H.2 Spots page — target IA (the headline win: ACTIVITY-FIRST)
Today: a generic "browse parks by placeType" feed (Hidden / Classics / Free / Everything) — and since 72% are parks, it reads as a wall of similar tiles even with the art floor.
**Target:** reorganize around **what you want to DO**, not the data shape: an Intent frame of **Beach day · Trails & nature · Dog-friendly · Family · Scenic views · Sports & courts · Water activities · Hidden** → distance-aware → editorial spotlight → an **activity carousel** (each shows the 2–3 nearest, "see all") → Everything grouped by type.
- **Biggest single change:** activity-intent replaces placeType browsing. This is the real fix for the "green wall" — *activity* becomes the differentiator, not the emoji. Add a **Saved-places shelf** (mirrors Events; doesn't exist today). Drop "The classics" (weak signal) and fold "Hidden" into an activity. **All from existing data** (placeType, classes, amenities, hiddenScore, isFree, distance) — reorg, not new collection.

## H.3 Map — its role (beyond the P5 declutter)
Make it the **"right now, right here" companion**: default to Both layers, add a **"📍 Near me"** affordance (MapView gets coords today it doesn't receive — `App.jsx:264`), reorder the toolbar so the date row is sticky, and add a **back-to-map** button on detail pages (the `focusMap` callback already exists, `nav.jsx:304`). KEEP the layer toggle, clustering, and pin-sheet (all good). Not a third browse surface — the spatial view of the same content.

## H.4 The "five ways to find things" → one model
**Intention (Guides/pills) → Scope (a lean row: Time · Distance · Free) → Result (editorial picks + Everything, taste-ordered) → Detail (save/plan) → back.** Search stays for known-item lookup. Map is the spatial alt-view. LensNav simplifies to the few contextual lenses (Tonight / This-weekend / Free / Near-me); long-tail categories live behind the menu/scope, not as a competing pill row.

## H.5 P10+ patch breakdown (3.7P-10 … 15) — with my reorg-vs-net-new read
| Patch | Scope | Effort | My read |
|---|---|---|---|
| **3.7P-10 · Events: collapse carousels + Guides→intent pills** | merge Your-kind + Free into Everything; move Guides up; move Recently-viewed down; "why" header lines | M | ✅ **Solid reorg, highest scannability win — do first.** |
| **3.7P-11 · Events: scope row** | a persistent Time/Distance/Free row below the intent pills | M | ⚠️ **The most NET-NEW / riskiest.** A full filter system drifts past "reorg" and partly duplicates LensNav + cuts against "taste reorders, never filters." **Recommend: scope it down to RELOCATING the existing LensNav lenses as the row (not a new Time/Vibe/Distance/Type/Free engine); DEFER "Vibe."** Decide with Josh. |
| **3.7P-12 · Spots: activity-first redesign** | Intent frame + activity carousel + Saved shelf; drop Classics, fold Hidden | L | ✅ **The headline win.** Mostly reorg of existing data; biggest user value. |
| **3.7P-13 · Spots: richer card meta** | show 3 amenities (was 2) + activity-aware icons | S | ✅ Small, solid. |
| **3.7P-14 · Map: Near-me + toolbar reorder** | pass coords to MapView; "Near me" button; sticky date row | M | ✅ Good; modest net-new (coords prop). Orthogonal to P5. |
| **3.7P-15 · Map: back-to-map from detail** | a "Map" button on detail/place-detail → `focusMap` | S | ✅ Small, solid (callback exists). |
| _(Phase 2)_ Events magazine⇄map toggle | swap feed/spatial view in-page | L | Defer — net-new; revisit post-3.7. |

**Rejected as already-in-Wave-2 (per your note):** visual polish (P1) · images (P2) · calendar (P3) · gamification (P4) · map declutter/cluster-sheet/filter-cutoff (P5) · cinematic hero + search-move (P6) · guides events/spots separation (P7) · retire weekend (P8) · evidence layer (P9). None re-proposed.

## H.6 Decisions for Josh / Charles
1. **Two tabs vs unify?** → **Keep two** (Events=WHEN, Spots=WHERE), identical grammar for a unified *feel*. (Recommend; low-risk.)
2. **Spots by activity-intent vs placeType?** → **Activity-intent.** (Strong recommend — it's the green-wall fix.)
3. **How aggressive on the Events cut?** → merge "Your kind of night" + "Free" into Everything. (Recommend — but "Your kind of night" is a nice taste-*reward* moment; consider keeping a lightweight version rather than fully cutting. Your call.)
4. **Guides mandatory (intent pills) vs carousel?** → **Mandatory pills**, with Tonight staying the default scope. (Recommend.)
5. **How much filter system to build (the 3.7P-11 question)?** → my rec: **relocate existing lenses, don't build a new filter engine**; keep the app's "reorder-not-filter" soul. (The genuine over-build risk in this wave — decide before P11.)

## H.7 My critical read (reality layer)
The audit is right that the pages are **structurally sound but organizationally bloated** — the collapse (P10) and the activity-first Spots (P12) are genuinely strong, mostly-reorg wins that match your "keep what's built, reorganize it" mandate. **The one thing to watch:** the synthesis keeps reaching for a **new filter/sort system** (sticky filter row, user-facing Trending/Newest/Closest/Taste sort). That's the part that crosses from *reorganizing* into *building*, and it lightly fights the app's honesty soul (taste reorders, never filters; never-hide). I'd keep P10/P12/P13/P15 as the core of this wave (high value, low risk), treat **P11 as scope-it-down-or-defer**, and let P14 (near-me) ride if it's cheap. That keeps the wave true to "reorganize, don't rebuild."

## H.8 RATIFIED + build-ready specs (Josh, 2026-06-15)
**Decisions (H.6) — all ratified:** ① keep TWO tabs (distinct but very similar grammar). ② Spots = ACTIVITY-FIRST (green-wall fix). ③ *(deferred to me)* → **cut the "Free" carousel, KEEP a SLIM "Your kind of night" rail** (it's a taste-*reward*, not mere redundancy). ④ Guides = mandatory intent pills, Tonight stays the default scope. ⑤ **scope P11 DOWN** — relocate existing lenses, do NOT build a filter/sort engine.

Recommended order in this wave: **P12 (biggest value) → P10 → P13 → P14 → P15**; P11 folds in (see below). Each: 1 commit, screenshot-QA (D.5), data-honesty pillars sacred. **P10/P6 both touch the Events hero/top — sequence P10 after P6** (the cinematic hero) so it reorders the final top.

**SPEC 3.7P-10 · Events: collapse carousels + Guides→intent pills** · M · mostly reorg
- Move the **Guides carousel UP** to sit directly under the hero as the **intent frame** (pills), before the sections (`HotView.jsx` — relocate the Guides block from mid-page to top).
- **CUT the "Free this week" carousel** (`HotView.jsx` Free section). Free stays as the LensNav "Free" lens + the FREE badge in Everything — **never-hide intact** (see-all + the Free lens reach every free event).
- **KEEP a SLIM "Your kind of night" rail** — only when `railReady` (6+ organic taps), ~6 cards, moved lower (after the editorial picks) so it doesn't echo Everything's taste order. Do NOT fully cut it.
- Move **Recently viewed** down to just above Everything. Keep Shelf · Tonight · The Big One · Hidden Gems · Everything.
- Add **"why" lines** to section headers (`SecHead` sub). Target order: Hero → Guides pills → Shelf → Tonight → Big One → Hidden Gems → [slim Your-kind] → Recently viewed → Everything.
- **Accept:** Guides are first under the hero; no Free carousel; "your kind" only when railReady; taste still reorders (never filters); every free event still reachable; tests green.

**SPEC 3.7P-11 · Lean scope row (SCOPED DOWN — likely folds into P10/P6)** · S · reorg only
- Do **NOT** build a new Time/Distance/Type/Vibe filter engine or a user-facing sort. Just present the **existing** LensNav lenses (Events: Tonight/This-weekend/Free/Near-me; Spots: Free/Hidden/Dog) as the lean persistent scope row beneath the intent pills, with clear copy. "All categories/All spots" stays in the menu.
- Since P6 already relocates search into the lens row and P10 moves Guides up, **P11 may reduce to a copy/relationship clarification or drop entirely** — builder's call once P6/P10 land. **Defer all new filter dimensions + sort to Phase 2.**
- **Accept:** no new filter system; existing lenses read as one coherent scope row; honesty soul intact.

**SPEC 3.7P-12 · Spots: activity-first redesign (the headline win)** · L · mostly reorg
- Replace placeType-browse with **activity intents**: Beach day · Trails & nature · Dog-friendly · Family · Scenic views · Sports & courts · Water activities · Hidden. **Reuse the predicates that already exist** — `PLACE_BUBBLES[].match` in `places.js:53–62` (beaches/parks/courts/nature/views/dog/hidden/free) — so each activity is a pure predicate over `placeType`/`classes`/`amenities`/`hidden`; no new data.
- Structure: Hero → activity intent frame → editorial spotlight (1–2 curated) → **activity carousel** (each activity shows 2–3 nearest + "See all") → Everything grouped by type. Make **"Near you" a persistent distance scope** (reuse `nearest()`), not a mid-page section.
- **ADD a Saved-places shelf** (mirror Events; `saves.js` + `normalizePlace` key aliases already support places). **DROP "The classics"** (srcCount≥3 = weak signal). **FOLD "Hidden"** into the Hidden activity.
- Ordering stays honest: nearest → taste → free → srcCount (taste reorders, never filters). Reuse `SpotCard` + the placeType art floor (P1/3.73).
- **Accept:** activity-first IA; Saved shelf present; no Classics section; Hidden is an activity; the green-wall visibly breaks (activity is the hook); never-hide (Everything sees-all); tests green; screenshot-QA.

**SPEC 3.7P-13 · Spots: richer cards** · S · reorg
- `spotMeta` shows up to **3 amenities** (was 2) as icon+label; use the P1 stroke-SVG language for utility icons, keep the placeType emoji as identity; keep differentiator + 💎 hidden badge + distance. Files: `cards.jsx` (SpotCard), reuse `PlaceDetail` amenity vocab. **Accept:** cards more self-descriptive; consistent with P1 icons; tests green.

**SPEC 3.7P-14 · Map: Near-me + toolbar reorder** · M · small net-new (coords)
- Pass `coords` + `requestCoords` from App into MapView (`App.jsx:264` doesn't today). Add a **"📍 Near me"** button: `requestCoords` if null → `setView(coords, ~13–14)`. Reorder the toolbar so the **date row is sticky/primary**. Files: `App.jsx`, `MapView.jsx`, `map.css`. Coordinate with **P5** (declutter/cluster-sheet — same files; sequence P14 with/after P5). **Accept:** near-me recenters; denied → graceful "Anywhere"; date row sticky; tests green.

**SPEC 3.7P-15 · Map: back-to-map from detail (VERIFY — likely mostly done)** · S
- **Reality check:** DetailPage + PlaceDetail already have a mini-map **"Open in Map ↗"** that calls `onFocusMap(e)` (→ `nav.jsx:304` `focusMap`, which jumps to the Map tab + focuses the pin). So this is **largely already shipped.** P15 = verify it lands on the right pin + opens the pin-sheet, and optionally make the affordance a touch more prominent. **If it already works well, mark P15 done and skip.** Don't rebuild what exists.

_End of amendment._

---

# ADDENDUM I (2026-06-15) — Multi-city: the 3.78 proof city = **Walnut Creek, CA** (was NYC)
_Josh: make the second city (3.78) **Walnut Creek, CA** — a place he's lived, so he can personally QA whether the recommendations are actually good (dogfood). **NYC moves to Phase 4.** This SUPERSEDES every "NYC as the 3.78 / second / proof city" reference in §15 and §B (NYC's facts there still hold — it's just a Phase-4 city now)._

## I.1 The change
- **3.78 = Walnut Creek, CA** (East Bay / Contra Costa County) — not NYC.
- **NYC → Phase 4** (joins Austin · Seattle · Puerto Rico).
- **D-MC2 proof set = Tampa Bay + Walnut Creek.**
- **Why it's a good swap:** a small market Josh knows firsthand is a *better* honesty/QA test than NYC. NYC is so data-rich it would mask thin-coverage problems; Walnut Creek surfaces them early, and Josh can eyeball whether the recs feel right. (NYC stays the eventual "big-splash" launch city — a Phase-4 marketing call.)

## I.2 Honest reality — Walnut Creek is small; plan for it
- **~70k people, an East Bay suburb near Oakland/SF.** Consequences:
  - **Region = the SF → Walnut Creek corridor** (Josh's call, 2026-06-15): San Francisco + Walnut Creek + everything in between — the NE slice through Oakland / Berkeley / Emeryville / Orinda / Lafayette / Pleasant Hill — **NOT the whole Bay Area.** Same idea as "Tampa Bay" spanning St. Pete/Clearwater, just a diagonal slice. **This flips EVENTS from thin to RICH** — SF is a top-tier Eventbrite/Meetup/local-feed market — while Walnut Creek stays the suburb Josh QAs firsthand. ⚑ bbox = SF↔WC corridor (the endpoint scout `wfdlr6y23` drafts exact coords + the city list → §I.5).
  - **Places/nature will be STRONG — and that plays to the app's core.** **East Bay Regional Park District (EBRPD)** is a premier open-data parks agency (~73 parks / 125k acres) — the Walnut Creek analog to Hillsborough's crown-jewel GIS. Plus **Mt. Diablo State Park** (marquee), California State Parks, Contra Costa County, dense Bay-Area OSM + Wikidata. Expect a rich trails/parks/views story.
  - **Net (with SF in the slice): rich on BOTH** — SF brings the event volume, the East Bay brings the parks/nature (EBRPD + Mt. Diablo + GGNRA). Walnut Creek proper is the QA lens (Josh judges suburban rec quality); the corridor gives a real metro to test on. Label per-area coverage honestly (§15.5).
- **Timezone:** America/Los_Angeles (Pacific + DST). The city-registry `timezone` field (§15.2) earns its keep here — the finder hardcodes Eastern today, so Walnut Creek is the first real timezone test.
- **Hero images:** real licensed photos (Walnut Creek / Mt. Diablo / East Bay) — ties to the D-IMG licensing plan.

## I.3 Source mapping for 3.78 (SF → Walnut Creek corridor)
_Concrete endpoints being scouted (`wfdlr6y23`) → the build-ready packet lands in **§I.5**. Outline:_
- **Portable (free, immediate):** Eventbrite · AllEvents · Meetup (events — RICH for SF) · OSM/Overpass · Wikidata/Wikipedia (places).
- **Strong regional GIS:** **East Bay Regional Park District (EBRPD)** · **SF Rec & Parks** (DataSF) · **GGNRA / NPS** (Golden Gate NRA) · **California State Parks** (incl. Mt. Diablo) · Contra Costa + Alameda County. Same `_arcgis.mjs` boilerplate as the FL sources — new endpoints + field mapping.
- **Local/civic events:** SF feeds (DoTheBay, Funcheap SF, SF Station, SF Rec & Parks) · Visit Walnut Creek / city calendars · East Bay DMO sources.
- Same §15.1 shape: portable floor + new regional GIS; no Tampa-locked source ports. (UC Berkeley is in-corridor — the existing `trumba-ut` adapter pattern may port to its calendar.)

## I.4 Net effect
3.77 (geo-refactor) is unchanged. 3.78 builds the **SF → Walnut Creek corridor** instead of NYC. NYC's §15.3 assessment still holds — just deferred to Phase 4. 3.78 is a **dogfood/proof** pairing (rich SF events + East Bay nature), not a marketing splash.

## I.5 Build-ready 3.78 packet (from endpoint scout `wfdlr6y23`)
Plug-and-play so the builder fills config + writes a few adapters instead of doing discovery. (Discovery confidence ~75%; the gov endpoints need one live-verify pass before building — paths included.)

**Draft `finder/cities.json` entry** (⚑ Josh: name + heroes):
```json
{
  "id": "sf-east-bay",
  "name": "SF & East Bay",
  "bbox": { "latMin": 37.68, "latMax": 38.00, "lngMin": -122.53, "lngMax": -122.00 },
  "center": { "lat": 37.84, "lng": -122.25 }, "defaultZoom": 10,
  "timezone": "America/Los_Angeles",
  "hero": "Golden Gate Bridge (Commons)", "spotsHero": "Mt. Diablo Summit (Commons)",
  "sources": { "events": ["eventbrite","allevents","meetup"],
               "places": ["osm","ebrpd-parks","sf-parks"] }   // ca-state-parks DROPPED (license); alameda/contra-costa OPTIONAL
}
```

**⚠️ CRITICAL refactor flags (belong in 3.77, confirmed by the scout):**
- **Bbox is hardcoded** `TB_BOX` at `finder.mjs:37` (+ `places.mjs:38`, `osm.mjs:26`) → must read `cityConfig.bbox`, else SF items get silently dropped.
- **Timezone is hardcoded** `America/New_York` in the eastern-offset helpers (`finder.mjs` ~294–310) → must read `cityConfig.timezone`, **else every SF event is stamped 7 hours early (a real display bug).** This is THE reason the registry needs a `timezone` field (§15.2) — Walnut Creek is the first to exercise it. **Validate Tampa stays byte-identical when run with `cityId=tampa-bay`.**

**EVENTS — plug-and-play (ready now, just config):**
- **Meetup** (`sources/meetup.mjs`): add `?location=us--ca--san-francisco` / `oakland` / `berkeley` / `walnut-creek`. **AllEvents** (`sources/allevents.mjs`): add `allevents.in/{san-francisco,oakland,berkeley,walnut-creek}` (+ `/free`). **Eventbrite** (`sources.json`): append `eventbrite.com/d/ca--{city}/all-events/` (+ free variants). SF is a Tier-1 market → **~5–6× Tampa's event volume.**

**PLACES — OSM ready + 5 new gov adapters:**
- **OSM/Overpass — ready now:** copy `osm.mjs`, swap the bbox constant → ~3,500–4,000 raw features (Bay Area is exceptionally well-mapped).
- **5 new adapters (discovery paths in the packet; model on `_arcgis.mjs` except SF):** `ebrpd-parks` (East Bay Regional Park District, ~73 — the crown jewel; ArcGIS Hub `q=ebparks`) · `sf-parks` (**Socrata/DataSF — NOT `_arcgis.mjs`; custom fetch**; `data.sfgov.org` parks) · `ca-state-parks` (ArcGIS, expect slow → 90s timeout, like FDEP) · `alameda-county-parks` + `contra-costa-county-parks` (ArcGIS; **dedupe carefully — they overlap EBRPD**, reuse the existing 2.5km/1km spatial+name merge). **GGNRA/NPS has NO unified API → editorial-seed a handful (Lands End, Crissy Field, Fort Mason…) or let OSM/Wikidata cover it; do NOT scrape nps.gov** (honesty contract).
- Honest coverage: **events rich (~5–6× Tampa); gov-park places FEWER than Tampa** (~300–450 after dedupe vs Tampa's 1,830 — SF is more urban/private land), but OSM (~3,500) + EBRPD + Mt. Diablo marquee carry a strong nature story. Label per-area coverage honestly (§15.5).

**Ordered build checklist (after 3.77's refactor):** ① live-verify the 5 gov endpoints (ArcGIS Hub fallback if a URL moved) ② fill `cities.json` ③ OSM bbox swap ④ write the 5 adapters ⑤ event-source URL adds ⑥ app reads active city from the registry (`lib.js:8` CITY → lookup) ⑦ validate: Tampa byte-identical + corridor renders + **SF timestamps correct (later, not 7h early)** + 5 benchmark spots generate (Mt. Diablo, Lands End, Briones, Tilden, Crissy Field) + `npm test`/build green. **Effort ≈ 2.5–3.5 sprint-units** (discovery + refactor + 5 adapters + validation).

**⚑ Decisions — RESOLVED (Josh, 2026-06-16):** name = **"SF & East Bay"** (id `sf-east-bay`) · heroes = **Golden Gate Bridge + Mt. Diablo** ✓ · **bbox = 37.68–38.00 N, −122.53 to −122.00 W** (scout-resolved: SF through the East Bay to Walnut Creek/Concord + a buffer; excludes San Jose / far South Bay / North Bay, so it's "SF & East Bay," not the whole Bay Area; center 37.84,−122.25, zoom 10) · **CA State Parks = DROPPED** (license — see §I.5a). **3.78 is config-ready.**

### I.5a — VERIFIED endpoints (scout `wvdk5k5ca`; confidence 75% → **85%**)
Live-confirmed where reachable, so 3.78's places stack is genuinely plug-and-play. **Field-gap (all sources): none carry hours or fee** → curate manually or show an honest "check online" (same as Tampa).

| Source | Endpoint (verified) | Type → adapter | Live | Conf |
|---|---|---|---|---|
| **OSM/Overpass** | `overpass-api.de/api/interpreter` · bbox `(37.70,-122.52,37.95,-122.06)` | Overpass → copy `osm.mjs`, swap bbox | ✓ | 85% |
| **SF Parks (DataSF)** | `data.sfgov.org/resource/gtr9-ntp6.json` (256 properties) + `ib5c-xgwu.json` (2,612 facilities), merge on `property_name` | **Socrata — custom fetch, NOT `_arcgis.mjs`** | ✓ | **100%** |
| **EBRPD parks** | `gis.sanramon.ca.gov/server/rest/services/Planning/EBRPD_ACCP_DATE/FeatureServer/0` (`?where=1=1&outFields=*&outSR=4326&f=geojson`; ~73 parks statewide → bbox-filter) | ArcGIS → `_arcgis.mjs` | ✓ | 90% |
| ~~CA State Parks~~ **DROPPED** | (license — Crown-copyright, commercial needs approval) | — | — | n/a |
| **EBRPD trails** | hosted item `6a6209d423d24451a5d584b840f0867a` (ebrpd.maps.arcgis.com) — REST URL needs reverse-lookup | ArcGIS → `_arcgis.mjs` | ⚠️ find URL | 55% |
| **Alameda County** | `data.acgov.org/api/v3/views/4842a70247ee493eb1d523f176c04483/query.json` | Socrata — custom | ⚠️ test | 65% |
| **Contra Costa** | `gis.cccounty.us/arcgis/rest/services` (directory live; parks layer not located — try Walnut Creek city GIS) | ArcGIS → TBD | ⚠️ find layer | 40% |
| **GGNRA/NPS** | no API — **editorial-seed ~8–10** (Lands End, Crissy Field, Fort Mason, Fort Point, Baker Beach, Sutro Heights, Hawk Hill, Rodeo Lagoon) + nps.gov/goga links | seed (no scrape) | ✓ | 25% |

- **Core build = 4 adapters** (CA State Parks dropped): OSM (15 min) · EBRPD parks (1h) · SF Parks Socrata (1.5h) · the dedupe layer (1.5h; EBRPD/county overlap — reuse Tampa's 2.5km+name merge). Alameda/Contra-Costa/EBRPD-trails are **nice-to-have** (EBRPD parks + OSM already cover most); GGNRA seed is a 30-min add.
- **✅ LICENSING — RESOLVED (Josh, 2026-06-16): DROP CA State Parks.** It was the only source with a commercial-use landmine (Crown-copyright / CC-custom). Mt. Diablo (the only marquee unit) is already in **OSM** (clean ODbL), so coverage barely changes and the whole stack stays open-licensed: EBRPD/SF = open (PDDL/public), OSM = ODbL (attribution). Revisit CA State Parks only if we later want richer state-park data AND secure written approval.
- **Must curl-confirm before building:** EBRPD-trails REST URL (reverse-lookup the hosted item) · Alameda `…/query.json?$limit=1` · Contra-Costa parks layer (or Walnut Creek city GIS). None block the core 5.
- **⚑X3 attribution lines:** EBRPD (ebparks.org) · SF Rec&Parks/DataSF (PDDL) · CA State Parks (parks.ca.gov — personal-use note) · GGNRA/NPS (public domain) · OSM (© OpenStreetMap contributors, ODbL) · Wikidata/Commons (CC0).

_End of amendment._

---

# ADDENDUM J (2026-06-16) — Wave 2c: playtest round 2 (3.7P-17…21)
_Josh's 2nd playtest pass after Wave 2 + 2b shipped. These are **Tampa polish** → run BEFORE multi-city (per Addendum D.4, "finish Tampa polish first"). Build-ready specs; data-honesty pillars unchanged. A couple intentionally iterate on earlier patches — noted._

**Recommended order:** P22 (bug — fast) · P17 · P19 · P21 (quick wins) → P18 (map, now incl. the day-filter bug) → **P20 (the headline: events↔spots unification)**.

## SPEC 3.7P-17 · Calendar cleanup · M
- **(a) Remove the leftover "Plan your weekend" card** on the Calendar (the 3.6-N5b re-entry pull card). P8 retired the WeekendBuilder, so this card is now a dead end — remove it; if `openWeekend` / the `weekend` subpage are now fully unused, retire them too (verify nothing else calls them).
- **(b) Day selection → INLINE bottom panel, not a popover** (iterates FB-12/P3): tapping a day cell updates the info in the **blank space at the bottom** of the calendar inline, so tapping 17 → 18 → 19 just swaps the bottom content — no popover opening/closing, never blocks clicking the next day.
- **(c) Remove the default caption** (`selCaption` "Open — tap to plan this day" / "{day} — an open day…"). Default (nothing tapped, or a blank day) = **leave the bottom blank** — no nagging "tap to plan" line. The bottom fills only when a tapped day has a plan/slots to show.
- Files: `CalendarView.jsx` (swap the peek popover for an inline bottom panel; drop the default caption), `calendar.css`; `nav.jsx`/`App.jsx` if retiring `openWeekend`. **Accept:** rapid day-tapping just swaps the bottom panel (no popover, never blocks); blank/unselected = blank bottom; the "Plan your weekend" card is gone; no dead `openWeekend`; tests green.

## SPEC 3.7P-18 · Map: collapse filters behind buttons · M
- The map filters take up too much screen. **Hide them behind a compact button bar that opens to reveal the options** — the same pattern as the events/spots LensNav (compact bar → sheet/dropdown). Reclaim the map real estate.
- **(c) Fix the day-filter bug + make filter dependencies clear** (Josh: today/tomorrow/weekend "don't work well — seem blocked depending on what's selected"). Root cause is almost certainly the **events-vs-spots layer**: spots have NO dates, so a day filter is meaningless when the Spots layer is active → it reads as broken. Fix the logic so day filters reliably filter EVENTS, and make the dependency **legible**: the date filter applies to events only — when the layer is Spots-only, hide/disable it with a clear reason (e.g. greyed + "dates apply to events"), rather than letting it silently no-op. A clean model: **layer (events/spots/both) → date (events only) → category/free.** (Josh's "pick day first, then events-vs-spots, then filters" is the same idea — enforce a sensible order/hierarchy so you always know what's selectable.)
- Files: `MapView.jsx`, `map.css` — reuse the LensNav / bottom-sheet mechanics (`topnav.css`) for consistency. Builds on P5/P14 (declutter + date row + near-me); this collapses the remaining filter bulk.
- **Accept:** map filters collapse into compact button(s) → tap opens the full options; the map gains significant screen; **today/tomorrow/weekend reliably filter events, and the date control is clearly disabled/hidden (with a reason) when it can't apply (Spots-only)** — no silent dead filters; reads consistent with the events/spots nav language; tests green.

## SPEC 3.7P-19 · Events/Spots top-row fit + filter polish · S/M
- **(a) Events search → icon-only, beside "Near me"** (refines FB-07/P6): the search affordance becomes just the 🔎 icon (no "Search" text), positioned to the right of the "Near me" lens, so **all the lenses fit on one row.**
- **(b) Both pages: a light positioning/cleanup pass** on the top filters — spacing, alignment, wrapping; make them display cleanly. Not significant; a tidy.
- Files: `HotView.jsx`, `LocationsView.jsx`, `LensNav.jsx`, `topnav.css`. **Accept:** events lenses + search-icon fit one row; search is icon-only beside Near me; both pages' top filters look clean + aligned; tests green.

## SPEC 3.7P-20 · Unify Events ↔ Spots (format parity) · L · the headline
- **(a) Events "Guides" (incl. Watch Guides / "Where to watch the World Cup") get the SAME widget look as the Spots "What are you up for?" activity widgets** (P12). Build/reuse **ONE shared widget component** for both pages' intent/guide/activity tiles — different content + function, identical format.
- **(b) Activity/guide widgets ALL-VISIBLE (magazine grid), not a horizontal-scroll carousel** — wrap them into a grid so every one is visible at once, even if the section grows taller (Josh's explicit preference — it's the magazine goal). Prefer all-visible; a "show more" only if the count is unreasonable. Never-hide intact (see-all still reaches everything).
- **(c) Format parity across the two pages:** `HotView` (events) and `LocationsView` (spots) should share the same skeleton/section-format/button styles so they read as one system — reconciling the divergence from P10 (events collapse) vs P12 (spots activity-first). Same structure, recognizable; only content/function differs.
- Files: `HotView.jsx`, `LocationsView.jsx`, `cards.jsx` (unify GuideCard + the activity widget into one shared component), `guides.js`. **Accept:** events Guides + spots activity widgets render via the same component/look; both shown as an all-visible grid (no horizontal scroll); the two pages read as visual twins (same format, different content); tests green; **screenshot-QA both pages side-by-side.**

## SPEC 3.7P-21 · Spots location: remove the gate → Settings "Allow location" · M
- Remove the inline **"📍 Use my location"** gate on the Spots "Near you" section. Instead, add a one-time **"Allow location"** control in **Settings → Data & privacy**; once granted, "Near you" surfaces automatically, proximity-sorted, everywhere it's useful (Spots, Map near-me, events near-me) — no repeated inline gate.
- Files: `LocationsView.jsx` (drop the gate; render Near-you when coords exist), `SettingsPage.jsx` (add the toggle), `App.jsx` (`requestCoords` already exists — wire the toggle to it; persist a "location allowed" pref + cached fix). **Accept:** no inline "use my location" button on Spots; Settings has "Allow location"; granting it shows proximity-sorted "Near you" without re-prompting each visit; denied/unset = "Near you" simply absent (honest, no nag); location stays on-device; tests green.
- **Honesty note:** opt-in, on-device only — fits the privacy-first ethos; the browser prompt fires once at "allow."

## SPEC 3.7P-22 · Event detail: the "View event" CTA STILL overlaps content (FB-14 re-open) · S · bug
- **P16 claimed to fix this (FB-14 "CTA clearance") but it did NOT** — Josh still sees the "View event" / "Get Tickets" button covering the **mini-map and the detail rows/About** on event detail. Treat it as an open bug and fix it for real.
- **Root-cause it properly:** `.detail-cta` is a fixed bottom button; `.detail-body` must reserve bottom space **≥ the CTA's height + `env(safe-area-inset-bottom)`** so the LAST content (mini-map · About · More-like-this · the Sources disclosure) scrolls fully clear. P16's clearance was evidently too small or not applied to all the trailing content. Confirm whether the CTA is truly `position: fixed` with a matching spacer, vs. floating over a short body.
- **Verify LIVE in the preview** (this is the lesson — don't assume the patch worked): scroll to the very bottom on (a) an event with image + coords (mini-map present), (b) a no-coords event, (c) one with a long About, (d) one with a More-like-this rail, (e) the Sources disclosure expanded — confirm the CTA never obscures any of them.
- Files: `DetailPage.jsx`, `detail.css`. **Accept:** the CTA never covers the map, About, More-like-this, or Sources on ANY event; **screenshot-verified at the scroll bottom**; tests green.

_End of amendment._

---

# ADDENDUM K (2026-06-16) — Wave 2d: density & scannability (3.7P-23…26)
_Gemini's playtest notes on the now-shipped build. Diagnosis: the brand transformation is "massive" / "premium native app" ✓ — but there's an **information-density problem**: every event + spot is forced into a heavy image-first card, so lists are exhausting to parse. The governing principle for this wave: **DISCOVER = visual (big cards stay on Home); COMPARE/DECIDE = dense text (lists/guides go text-forward + scannable).** This is more Tampa polish → still before multi-city. GPT notes pending — will append here. Data-honesty pillars unchanged._

**Recommended order:** **P24 (Spots green-wall-in-lists — the biggest drag) → P23 (event compact rows) → P25 (guide chips) → P26 (home density).**

## SPEC 3.7P-24 · Spots lists → text-rich rows (drop the art placeholder in LISTS) · M · biggest drag
- In Spots **list / browse / activity-result views**, **drop the `imgbox-art` green placeholder when there's no real photo** — it eats screen without adding info (the "green wall"). Replace with a **text-rich SpotRow**: **Spot name** (lead) → **distance** (e.g. "3.2 mi") → a row of **high-contrast amenity chips** (🅿️ Parking · 🚻 Restrooms · 🐕 Dog-friendly…). Utility-first; when a real photo exists, show it as a small **48×48** thumb.
- **Reconciliation (do NOT undo P12 or the art floor):** the split is **discovery stays visual** (the Home spot cards + the activity *intent tiles* Josh loved keep their look) — **only the spots LISTED under an activity / in browse go text-forward.** This is layout-by-context, not removing the art floor (the floor still backs any image context). Honesty: a text row leading with name + amenities is *richer*, not an empty box, so the "never a flat box" contract is honored.
- Files: `cards.jsx` (a `SpotRow`, or a list-context mode of `SpotCard`), `LocationsView.jsx`, the activity/guide list rendering, reuse `PlaceDetail` amenity labels. **Accept:** spots in lists are text-forward (name · distance · amenity chips), no green placeholder; real photos render as small thumbs; discovery cards + intent tiles unchanged; amenities high-contrast + scannable; tests green; screenshot-QA.

## SPEC 3.7P-23 · Compact text-forward rows for event guide/list views · M
- Inside drill-in lists (**GuidePage**, e.g. "Where to watch the World Cup"; **BubblePage**; focused "see all" lists) switch from big image cards to a **high-density CompactRow**: **Event title** (semibold) + **time · venue** (muted, smaller) stacked left; a small **48×48 rounded thumbnail** on the right (or none if no image). Target **8+ events visible per screen** for fast compare.
- **Reserve big image cards for the Home discovery feed** (Tonight / The Big One / editorial picks) — they stay visual. Discover = visual; decide = dense.
- Files: `cards.jsx` (a `CompactRow`, or tighten the editorial `Row` — currently a 110px image; shrink to 48×48 + text-forward in list contexts), `GuidePage.jsx`, `BubblePage.jsx`. **Accept:** guide/bubble/list views show compact text-forward rows (8+ visible); Home discovery keeps big cards; line-clamp intact; never-hide intact; tests green.

## SPEC 3.7P-25 · Guides as editorial chips (not floating circular icons) · S/M
- The top Guides / intent tiles → **rectangular editorial mini-cards with a warm-palette tint** (not floating circular icons), so they read as **actionable plans** ("Date night," "Beach day") and are visually distinct from the "All categories" filter row below.
- Files: `cards.jsx` (the shared `IntentTile`/`GuideCard` from P20), `HotView.jsx`, `LocationsView.jsx`, `cards.css`/`topnav.css`. **Accept:** guides render as warm-tinted editorial chips/mini-cards; clearly distinct from category filters; consistent across Events + Spots (same shared component); tests green. _Iterates on P10/P20 — a visual refinement._

## SPEC 3.7P-26 · Home feed density: spacing + carousel peek · S
- **Tighten the vertical spacing** between Home sections (kill the "vertical endlessness"). For horizontal carousels (Tonight, etc.), **reduce card width slightly so part of the next card peeks** — signals horizontal scroll + pulls the eye sideways.
- Files: `cards.jsx` (carousel widths), `HotView.jsx`, `cards.css` (section margins). **Accept:** tighter section rhythm; carousels show a next-card peek; no breakage at the 460px frame; tests green.

## GPT notes → folded into **Addendum M (Wave 2f — the Decision Layer)**, the governing frame for the whole final push.

_End of amendment._

---

# ADDENDUM L (2026-06-16) — Wave 2e: systemic / architectural fixes (3.7P-27…33)
_Gemini's two batches of systemic critiques. **The first 4 (tab bar · map curated-default · planner empty state · Profile/Settings split) were VERIFIED against the current code** (workflow `w2nv8un0g`) — and the check paid off: 3 of the 4 were already partly-built, and one re-introduces a bug we just fixed. Accurate verdicts + specs below. The 5 newer items are specced after. Honesty contract holds (reorder-not-hide; never-hide). Still Tampa polish → before multi-city. GPT notes still pending._

## VERIFIED against current code (`w2nv8un0g`) — the 4 systemic claims
**Combined Wave-2e order (verified):** P30 → P29 → P32 → P33 → (map round: P28b + P31; P28a optional) → **P27 (Josh decision).**

**SPEC 3.7P-30 · Profile/Settings — finish the split (SHIP — top priority) · S · zero risk**
- VERIFIED: 3.76a moved the taste *display* to Profile, but Settings **still has the *editing* surfaces** — "Customize interests" (`SettingsPage.jsx:98-104` → `openInterests('settings')`) + "Retake the quick primer" (`:106-113` → `setRetaking`). So Settings is still half-taste — Gemini's right.
- Fix: **delete those two from Settings.** Interests-edit already works from Profile's tappable vibe chips (`ProfileView.jsx:298-321` → `openInterests()`); **add a "Retake primer" row to Profile** (same `setRetaking` handler, Profile scope). Optionally drop/retitle the "Your taste" deep-link. Result: **Settings = Location + Data/Privacy + Reset + About only.**
- Files: `SettingsPage.jsx` (−~20 lines), `ProfileView.jsx` (+ primer row). **Accept:** Settings is maintenance-only; interests + primer live on Profile; no functional loss; tests green.

**SPEC 3.7P-29 · Planner empty-day guide fallback (SHIP) · S/M**
- VERIFIED: an empty day is **NOT** a dead end — it already shows the prominent **"Build this day" deck hero** (N5c) + **whyFits** cues (3.74) + the weather line. Gemini's "blank slots" critique is partly stale. Remaining gap: no inline **"Quick Ideas"** guide cards.
- Fix: on empty/thin days, render **1–2 guide cards** from `GUIDES` via `resolveGuide(g, {events: upcoming, places, anchors})` — only guides with REAL matches; weather-gate (surface the rainy-day guide when `wxMood`='rainy'). **Honesty:** `resolveGuide` returns real matches only; the new-user fallback is a *derivable* guide (beach/rainy/free-outdoor), NOT the taste rail (that needs 6+ taps).
- Files: `DayPage.jsx` (import `GUIDES`/`resolveGuide`; render top 1–2 when `slotsEmpty`). **Accept:** empty days show 1–2 honest guide "Quick Ideas" alongside the deck; weather-appropriate; never-hide intact; tests green.

**SPEC 3.7P-28a · Map curated-default + "Show All" toggle (PARTLY DONE — ⚑ DEFER unless prioritized) · M**
- VERIFIED: P5/P18 calmed the **visual** loudness (cream discs, smaller clusters, filters in a sheet) but the map **still shows ALL** events+spots by default (`MapView.jsx:132` `dateF='any'`, `:136` `cat='all'`) — no curated default, no Show-All toggle, no saved/guide layer.
- Gemini wants a **curated default** (saved + active-guide + top hidden-gems + today) + a one-tap **"Show All"** toggle. Allowed under never-hide (the toggle is the escape). **But the current "show all" is honest + intentional**, and P28b (emoji markers) + P18 (filter sheet) already improve legibility a lot.
- **Recommendation: DEFER unless Josh prioritizes** — it's a real ~80-line state/logic change for a map that's already honest, just busy. ⚑ Josh: build it, or rely on P28b + P18? Files (if built): `MapView.jsx` (`showAllMode` state + curated pin set + toggle pill).

**SPEC 3.7P-27 · Persistent tab bar on detail (⚑ ARCHITECT — Josh decision; real cost) · M–L · moderate-high risk**
- VERIFIED: STILL VALID — `.detail` (`App.css` z2000, `height:100svh`) covers the TabBar (z1100), so it vanishes on detail. **BUT making it persistent conflicts with two things we just got right:** (1) raising the TabBar above detail **re-introduces the FB-14 CTA overlap we fixed in 3.7P-22**; (2) shrinking the detail height **breaks the card→detail View-Transition morph** (tuned for 100svh) + the detail-cta flex layout + the slide-up animation. The full-screen detail is **intentional** (cinematic 42svh hero, immersion, disposable-detail flow).
- **Two paths (Josh picks):** **(A, lighter/low-risk)** a sticky **detail-top mini-nav** (Map/Calendar/Profile icons) for quick-escape — doesn't touch the morph or the CTA, but duplicates the TabBar affordance; **(B, riskier, M–L)** redesign the detail height + re-tune the VT morph + retest thoroughly. 
- **My lean:** Option A if you want the quick-escape, OR accept the current full-screen detail (pushing a full-screen detail over the tab bar is a legit, common native pattern). **Don't ship a version that re-breaks FB-14 or the morph.** Honesty note: the hidden tab bar is *immersion*, not data-hiding — never-hide is untouched.
- **✅ JOSH'S CALL (2026-06-16): KEEP the current full-screen detail** — the tab-bar behavior is fine as-is. **Optional, LOW priority: the small Option-A detail-top mini-nav** (quick-escape icons). **Do NOT do the risky Option-B height/morph redesign.** P27 is effectively closed (optional nicety only).

## Specced now (clear additions)
**SPEC 3.7P-28b · Map: emoji-pill markers (kill the "mystery meat" dots)** · M · bundle with P28a
- Replace abstract colored dots with **small pill markers showing the category/placeType emoji** (🎵 🌳 🍔 🏖️…) — instant recognition, no legend needed. **Reuse the emoji we already have:** `CATEGORY_EMOJI` (events) + `PLACETYPE_EMOJI` (spots, from 3.73a `categories.js`). Leaflet `divIcon` with the emoji in a warm pill.
- Files: `MapView.jsx` (marker render), `map.css`. **Accept:** zoomed-in markers show the category/placeType emoji in a pill; no legend needed; clustering still works; tests green. (Do alongside P28a so the map gets one coherent pass.)

**SPEC 3.7P-31 · "Near me" → spatial localized view (not a list + permission wall)** · M/L · ⚑ reconcile with P21
- Tapping the **Near-me** lens shouldn't dump a 1,154-item vertical list behind a permission banner. Instead: **if location is allowed → crossfade to a localized mini-map + a bottom-sheet list bound to ~3-mi radius, sorted by distance** (reuse `nearest()`). If not allowed → trigger the prompt / point to the Settings toggle gracefully, never a wall.
- **Reconcile with P21** (which moved location to a Settings opt-in): allowed → spatial near-me directly; unset → one prompt, not a roadblock. This redesigns the near-me *destination* (today it opens a BubblePage list).
- Files: `nav.jsx` (the near lens → a near-me spatial mode), `MapView.jsx`/a near-me sheet, `places.js`/`lib.js` (radius + distance sort). **Accept:** near-me opens a ~3-mi map+list sorted by distance (not a chronological dump); graceful when location is off; tests green. _Meatiest of the 5 — flag effort._

**SPEC 3.7P-32 · Guide/list feed-end → pivot CTA (no dead ends)** · S/M
- Replace the dead-end "You've reached the end" at the bottom of **guide/list feeds** with a **dynamic pivot CTA** ("Explore all {category} events" / "Browse the map nearby") to keep discovery active.
- **Reuse what exists:** `RowFeed` already takes an `endSlot` prop (Home uses it for the session recap) — add a contextual pivot endSlot for GuidePage/BubblePage. Files: `cards.jsx`, `GuidePage.jsx`, `BubblePage.jsx`. **Accept:** guide/list ends show a contextual pivot, not a dead line; never-hide intact; tests green.

**SPEC 3.7P-33 · Weather-conditional Guide/activity ordering** · M · on-brand decision-support
- Reorder the **Guides + activity intent tiles** by today's REAL forecast: if rain is forecast, push **"Rainy-day backup" + indoor** intents to the front and demote **"Beach day"/outdoors**; clear day → normal order. The app already owns `wx` (16-day forecast) + the guides (`guides.js`); reuse the existing `wxMood`/`wxFit` logic.
- **Honesty:** this is **weather-*reorders*, never hides** (same shape as taste-reorders) — degrade gracefully to default order when no forecast. Files: `guides.js` (a weather-aware order selector), `HotView.jsx`/`LocationsView.jsx`. **Accept:** rainy forecast → rainy/indoor guides lead, outdoors demoted; clear → normal; based only on real forecast; reorders never hides; tests green.

## ✅ Already done (no patch)
- **"Share Plan" at the Day level** (Gemini #1, 2nd batch) — **already shipped:** `DayPage.shareDay` / "📤 Share this day" compiles the day's slotted events+spots into shareable text + a multi-VEVENT `.ics` (Sprint U-c), via `navigator.share` w/ copy fallback. It only appears once a slot is filled (`canShare`) — that's why the empty-day video didn't show it. Optional micro-tweak: make the affordance a touch more prominent; otherwise nothing to build.

_End of amendment._

---

# ADDENDUM M (2026-06-16) — Wave 2f: the Events + Spots **Decision Layer** (GPT) — the governing frame
_GPT's capstone note (the LAST feedback batch before the builder resumes). It names the thesis the prior waves were circling: **stop presenting a feed/directory; present a planning companion.** Treat Waves **2d + 2e + 2f as ONE coherent "Decision Layer" push**, not 20 loose patches. Still Tampa polish → before multi-city. Data-honesty pillars hold (reorder/group ≠ hide)._

## M.0 The thesis
**Goal: a user opens Events or Spots and understands the best options in under 10 seconds.** Every card/section answers: **what is it · when can I do it · where · how much effort · why me · what next.** Less "show more," more "help choose."

**The key distinction (don't make them the same logic):**
- **Events = TIME-first.** Lead with date/time · venue/area · distance · free/paid · indoor-outdoor/weather-fit · one-off vs recurring · why-it-fits → **Add to day / Save.**
- **Spots = ACTIVITY/UTILITY-first.** Lead with activity-fit · distance · free/paid · time-needed · amenities · weather-fit · best-for · caution note → **Add to day / Save.**

## M.1 Reconciliation — this is ONE push with 2d + 2e
The Decision Layer IS the umbrella over what's already specced — build it as one thing, don't double-build:
- 2d (P23 compact rows · P24 spot text-rows · P25 guide chips · P26 density) = the **card** half.
- 2e (P28b markers · P31 near-me · P32 feed-end pivot · P33 weather-order · P30 settings split · P29 empty-day guides) = the **systemic** half.
- **Nuance to hold:** P20 (shipped) made Events & Spots *look* the same (shared component). GPT says their *logic/metadata* must differ. **Both are right:** build ONE shared **`DecisionCard`**, feed it **event metadata (time-first)** on Events and **spot metadata (activity-first)** on Spots. Same component, different content + ordering.

## M.2 Net-new patches (Wave 2f, 3.7P-34…43)
- **3.7P-42 · DecisionCard component system** (the spine — do FIRST): one shared `DecisionCard` + `CompactListRow` · `SectionHeader` · `FilterChip` · `BottomSheet` · `PrimaryCTA`, reused across Events / Spots / Calendar suggestions / Search / Map sheets. Text-first; image is supporting context, not the structure. (Absorbs/unifies P23/P24/P20.)
- **3.7P-34 · Event-detail CTA → "Add to day"** (planner-first): make the primary sticky action **Add to day** (mirror PlaceDetail's "Make this my plan," which events lack today); demote **Official event page** + Directions/Save/Share to secondary. "View event" while you're viewing it is the wrong verb for a *planner*. [strong, clear]
- **3.7P-35 · Title normalization util:** ALL-CAPS → Title Case · clean excess parentheses · drop duplicated venue/source text from titles · consistent clamp. (Raw scraped titles read "scraped.")
- **3.7P-36 · imageMode quality gate:** `high → large image · okay/poster-text-heavy → small thumb · bad/missing → text-only · spot-no-photo → text/icon card`. **Bad posters never dominate; no green placeholder as primary UI.** (Extends FramedImage/P1 + P24.)
- **3.7P-37 · Series-grouping inside Guides:** the World Cup guide shows ~5 near-identical cards (same poster/venue, dates buried). **`curate.js` already collapses recurring series for the Everything feed — apply that same collapse inside guide/bubble lists** → one "Watch parties at Wild Rover · 5 matches · next Wed" series card, expandable to dates. [reuse curate.js]
- **3.7P-38 · Dedup-within-screen + multi-fit badges:** no item appears more than once on a screen unless intentionally grouped; a spot that fits Beach-day + On-the-water + Park shows **once** with fit-tag badges, not three duplicate cards.
- **3.7P-39 · Section-label honesty:** tighten section promises — "Hidden Gems" must not contain a job fair. Likely the finder hidden-gem/curation criteria + UI label discipline (safer labels: "Tonight's best bets," "Free & low-effort," "Good rainy backup," "Under the radar" only when true). [honesty/curation — may be finder-side]
- **3.7P-40 · Calendar "Your next days" + clear state legend:** add a **day-first planning-card stack** above the month grid (Today/Friday/Saturday → weather + "Build today"/"Plan Friday night"); the month grid stays but isn't the default focus. Fix the confusing date states (today / selected / planned / completed) with a clear, distinct system. (Builds on P17.)
- **3.7P-41 · Search as the events↔spots bridge:** NL example prompts in the empty state ("free things tonight," "rainy date idea," "dog-friendly walk," "sports bar for the World Cup") + **grouped results** (Best match · Events that fit · Spots that fit). Don't force "event or spot?" first.
- **3.7P-43 · Transition/overflow ghost-overlay bug:** the profile↔settings transition shows a visible side/ghost overlay. Clamp `overflow-x` at the shell, audit z-index/transform states, ensure sheets/drawers only render when intentionally open. [bug]
- **Map (enrich P28a):** GPT's map fix = a **decision BOTTOM-SHEET** ("What's good in this area" → top pick · best event soon · best free spot · best outdoor · "Show list for this area"), not a curated-default toggle. Fold this into the map round (P28a/P28b/P31) so the map answers a question instead of dumping counts.

## M.3 Combined Decision-Layer build order (Waves 2d + 2e + 2f as one sprint)
- **Phase A — primitives:** P42 (DecisionCard system) · P35 (title-norm) · P36 (imageMode). *Everything else reuses these.*
- **Phase B — Events surface (time-first):** P23 compact rows · P34 detail CTA→Add-to-day · P37 guide series-group · P25 guide chips · P33 weather-order · P39 section honesty · P26 home density.
- **Phase C — Spots surface (activity-first):** P24 text rows · P38 dedup + fit-badges.
- **Phase D — cross / map / calendar:** P41 search bridge · (map round) P28b markers + P28a decision bottom-sheet + P31 near-me spatial · P40 calendar next-days + legend · P30 settings split · P29 empty-day guides.
- **Phase E — bugs / optional:** P43 transition bug · P27 optional mini-nav (low).

## M.4 Acceptance (GPT) — the sprint is "done" when
Events read text + date-first · Spots read activity + utility-first · bad images no longer dominate · duplicates grouped or removed · every card explains *why it's worth considering* · every discovery path leads to **Save or Add-to-day** · a user grasps the best options in **<10s**. (GPT's full 14-point prompt is a complete builder brief — Josh can paste it directly alongside this addendum; the net-new patches + order above are the plan-of-record.)

_End of amendment._

---

# ADDENDUM N (2026-06-16) — The VISUAL BENCHMARK (Wave 2.5): "match this reference"
_Josh provided a ChatGPT-generated **"UI Polish Reference"** mockup (10 screens + a components/styles row). It is now the **visual north-star** for the Decision Layer (Waves 2d/2e/2f) + the final polish — **the builder should screenshot-compare each patch against it.** Crucially, the mockup **crystallizes the Decision Layer we already specced** (it confirms P34, P23/P42, P24, P28a, P29, P40, P41, P12) — so it's a benchmark, not a redirect. **The builder almost certainly can't see the image — Josh should also paste the image to the builder; this addendum captures it textually so the plan carries it regardless.** A few genuine divergences are flagged in §N.3 (don't auto-adopt those — they're decisions)._

Reference goals (verbatim): _easier to scan · more inspiring · decision-first design · better hierarchy · consistent components · delight in the details · "a more beautiful, consistent, intuitive experience without a full rework."_

## N.1 Component & style benchmark (the consistency target)
- **Chips:** pill; **selected = filled Sunset Gold**, unselected = hairline outline. One chip style everywhere.
- **Buttons:** **Primary = filled Sunset Gold**; **Secondary = outline**. (Keep the dark-ink-on-gold AA rule.)
- **DecisionCard** (the spine, P42): title → location 📍 → category/tag chips → **[Save] [Add to day]** actions. Text-first; thumbnail optional.
- **Bottom sheet:** title + "list of great things in this area" + ✕ (the map/plan results surface).
- **Colors:** Sunset Gold (primary) · sage green · cream/tan · warm dark · warm gray — i.e. our "Sunlit Coastal Pop" palette. ✓ matches.
- **Icons:** single-color **line icons** (heart, bookmark, share, clock…) — confirms P1/3.7P-1c stroke-SVG direction.
- **Typography:** the ref labels "Inter, clean/friendly" — ⚑ note: we shipped **Kumbh Sans** titles (3.71). See §N.3.

## N.2 Screen-by-screen benchmark (maps to our patches — mostly CONFIRMS)
1. **Home dashboard** — "Good morning, Alex ☀️ · Storms this afternoon · 93°" → **"Your next days"** planning cards (Today: Storms likely / No plan yet / [Build today]; Friday: 2 ideas / [Plan Friday night]; Saturday: great for outdoors / →) → "Tonight's top picks · Curated · See all" featured card. ⇒ confirms **P40** day-first planning cards. (But it's a *separate Home tab* — see §N.3 nav.)
2. **Events** — search ("free tonight, live music") → Today/Tomorrow/Weekend/Free/Near-me chips → **"Tonight's best bets"** featured DecisionCard (World Cup: tags Sports·Bar·Indoor·Free-ish, **[Save] [Add to tonight]**) → "This weekend" compact rows. ⇒ confirms **P23/P34/P39** + the time-first event surface.
3. **Events list / guide** — back-header "Events" → **compact rows** (Tampa Bay Market: SAT JUN 21 · 7:30 PM · Armature Works · Outdoor·Market·Free · 12 min · small thumb; Sunset Yoga; Yoga on the Pier) → "Worth planning around" (Gasparilla). ⇒ confirms **P23/P42 CompactRow** (time-first, distance, tags, 48px thumb).
4. **Event detail** — hero + ♥/share → "Fri Jun 19 · 7:00 PM" → title → venue+address → tags (Sports·Bar·Indoor·Good for groups·Free-ish) → **"Why you'll like it"** trust block → Official event page ↗ · Directions (18 min) · Share → **bottom: [Save] [Add to Friday night]** (gold primary). ⇒ confirms **P34** exactly (planner-first CTA; official-page demoted).
5. **Events map** — Events/Spots/Both toggle + filter icon → map w/ pins → **bottom sheet "370 things around Tampa · Top picks in this area"** → list (World Cup · 18 min · Tonight 7PM; Cockroach Bay · Park · 31 min · Free; Tampa Bay Market) → **"View all in this area."** ⇒ confirms **P28a decision bottom-sheet** + Events/Spots/Both + P28b markers.
6. **Spots** — search → **activity-tile grid** (Quick reset · Water views · Easy walk · Dog-friendly · Sports & courts · Half-day nature · Date-worthy · Free w/ parking) → "Recommended near you" spot card. ⇒ confirms **P12** (shipped) + activity-first.
7. **Spot detail** — hero + ♥/share → "Cockroach Bay Preserve State Park" → "31 min · Free · Park" → tags (Water views·Boat launch·Quiet) → **"Best for: low-spend afternoon · solo walk · on the water · sunset"** (icon row) → **"Watch out: 🐛 buggy after rain."** ⇒ confirms **P24** field-guide spot card.
8. **Plan your day** — "Friday Jun 20 ▾" → weather ("93° · storms likely, high rain pm") → "Your plan: Add an event or spot · tap + to start" (dashed) → **"Suggestions for you · based on weather + your likes"** (World Cup, +). ⇒ confirms **P29 empty-day quick-ideas** + the day screen.
9. **Calendar** — "June 2025 ▾ · Today" → clean month grid with **distinct date states** (today outlined, planned/completed dotted/filled) → **"Upcoming"** day cards (Today: no plan / [Build today]; Fri Jun 20: 2 ideas / View plan). ⇒ confirms **P40** (next-days + a clear state legend).
10. **Search** — "free things tonight ✕" → tabs **All · Events · Spots · Guides** → **"Best matches"** → "Other events" (Trivia Night, Live Music) → **"Spots that fit."** ⇒ confirms **P41** grouped search bridge.
11. **Profile** — Alex, Tampa FL → **stats: 47 Plans · 128 Saves · 23 Days out** → rows: My plans · My saves · My likes · **Settings & preferences** · Help & feedback. ⇒ confirms the alive-Profile + **P30** (Settings as a row) + a new **stats strip** (see §N.4).

## N.3 ⚑ Divergences — DON'T auto-adopt; these are decisions
- **NAV / IA (the big one):** the reference uses **Home · Events · Spots · Plan · Profile** — i.e. it **adds a dedicated Home dashboard tab, renames Calendar→"Plan", and demotes Map to an Events sub-view** (no Map tab). Current app = **Events · Spots · Map · Calendar · Profile**. **This is IA surgery, not "polish without a full rework"** — and our current Events tab already acts as the home (greeting hero + sections). **⚑ Josh decision:** (A) adopt the reference nav (real work: new Home tab + Map-as-subview + Calendar→Plan); (B) **keep the current 5-tab IA and just match the per-screen visuals** (my recommendation — it's the "polish, not rework" path and gets ~95% of the benchmark); (C) hybrid (e.g. rename Calendar→"Plan" only). **My rec: B for this push; treat the nav restructure as a separate explicit decision (maybe Phase 4).** **✅ JOSH (2026-06-16) — REVISED: ADOPT the image's nav as part of Stage R; REMOVED from Phase 4.** Josh loves the original image and is matching it exactly, **nav included.** So Stage R now also restructures the nav to **Home · Events · Spots · Plan · Profile**: split the Phase-B dashboard (NextDays + greeting + FeaturedCard) onto a **new Home tab**, keep **Events** as the browse, rename **Calendar → "Plan"**, and demote **Map** from a top tab to a **sub-view** (reached from Events/Spots — the image's "Events map"). **⚠️ This is the single riskiest surface** (it rewires the tab roster + the detail→Map handoff) — execution + safety in §P.5.
- **Typography:** reference says **Inter**; we shipped **Kumbh Sans** titles. ⚑ Josh likes both, can't decide. **✅ RESOLVED: ship a temporary font A/B-compare pill (3.7P-44) by end of 3.7** so Josh can flip Kumbh↔Inter live in the real app and pick before Phase 4.
- **Profile stats (47 Plans · 128 Saves · 23 Days out):** these are count metrics — **fine now** that gamification is ratified (Addendum E), but keep them honest (real counts; "Days out" = the did-days ledger). Not a violation post-E.

## N.4 Net-new the reference reveals (beyond 2d/2e/2f)
- **Profile stats strip** (Plans · Saves · Days-out) — small, from existing data (day-plans, saves, did-days). Fold into **P30/Profile** (a stats row atop Profile). Honest counts only.
- **Home dashboard** (greeting + your-next-days + tonight's-top-picks) — only if §N.3 nav decision = A; otherwise the current Events-tab hero + P40 cards cover most of it.
- **3.7P-44 · Font A/B-compare pill** (by end of 3.7): a small **temporary** toggle (in Settings, or a quiet dev pill) that swaps the title font-family **Kumbh Sans ↔ Inter** app-wide via a single CSS variable, so Josh can compare them live and decide. Tiny effort (one var + a toggle). **Remove after the decision** (don't ship the toggle to users).
- Otherwise the reference is **covered by the existing Decision-Layer patches** — it's the *visual acceptance target* for them.

## N.5 Acceptance — the visual gate before 3.77
The Decision Layer (2d/2e/2f) is "done enough" when **the live app screenshots match this reference** (within the current IA per §N.3-B): consistent chips/buttons/cards, the DecisionCard everywhere, the detail "Add to day" CTA, the map bottom-sheet, the day-first plan/calendar, grouped search, activity-first Spots, and no bad-image dominance. **This is the last big visual push** — after it, expect only tiny patches → then 3.77 (multi-city). The benchmark is what lets us stop "big patches" and converge.

_End of amendment._

---

# ADDENDUM O (2026-06-16) — FINAL VISUAL REWORK: safe-execution plan
_Josh: "the most significant step yet… we're basically changing the entire UX path… significant time must be spent making sure all the paths don't get broken." This is the **execution-safety** plan for matching the §N benchmark across every surface — from planning workflow `whoqzwytj` (full 52k synthesis in that task output; essence captured here). **Principle: apply the (already-built) DecisionCard spine ONE SURFACE PER COMMIT, verify the nav paths after each, with checkpoint/rollback commits between phases. No big-bang.**_

## O.1 The "DO NOT BREAK" path checklist (re-run after EVERY surface change)
The 8 load-bearing flows + their wiring — if any regresses, revert that surface's commit immediately:
1. **Home → card → Detail → back** — VT morph: card `[data-vt]` names `'evt-hero'` (`nav.jsx:260`), cleared in the transition; detail keyed `keyOf(detail)` (`App.jsx:399`).
2. **Lens → Bubble → Detail → back to Bubble → Home** — `openBubble` taste seam fires once (`nav.jsx:135`); BubblePage uses CompactRow; `closePage` 400ms.
3. **Spots → PlaceBubble → PlaceDetail → "Make this my plan" → DayPage → slot fills** — place routes to `PlaceDetail` via `detail.kind==='place'` (`App.jsx:398`); no taste signal on place-bubble.
4. **Calendar → DayPage (subpage) → PickerSheet → Detail → back** — DayPage keyed `ts + anchors.todayTs` (`App.jsx:337`, midnight remount); PickerSheet Escape is **capture-phase** (closes sheet, not detail).
5. **Detail → mini-map → focusMap → Map tab + pin focused** — `focusMap` atomically closes detail+page, sets a **fresh** `{lat,lng,key,kind}` object, jumps to Map (`nav.jsx:298-313`).
6. **Settings → Interests → Taste → Deck → back to Settings → Profile** — single-slot replace; `from` param routes back (`nav.jsx:203-227`); Deck `onClose`.
7. **Search → grouped results → Detail (event OR place) → back** — place results must open `PlaceDetail` (kind check); grouped tabs.
8. **Escape layering** — `nav.jsx:317` bubble-phase closes detail-before-page; PickerSheet/MapView sheets use **capture-phase + stopPropagation** so Escape closes the sheet first.

**The 10 wiring contracts (do not reorder/split):** VT name `evt-hero` · detail keyed by `keyOf` · day keyed by `ts+todayTs` · `openDetail` records signal+view atomically · `focusMap` closes-detail+page+sets-focus+jumps-to-map · PickerSheet capture-phase Escape · subpage single-slot (open=replace) · CompactRow in drill-in lists / Row on Home · Settings/Interests/Taste/Deck `from`-routing · `focusMap` fresh object every call.

## O.2 Risk register (the high-breakage ones)
- **Detail "Add to day" CTA (P34) vs the VT morph + the FB-14 fix (P22)** — set/clear the morph name inside `startViewTransition`; keep the CTA a flex sibling (don't re-introduce the overlap). *Verify: tap card → smooth morph; rail-swap remounts; close reverses.*
- **`focusMap` (P34/P31)** — must close detail (not overlay it on Map) + carry `kind`. *Verify: detail → mini-map → detail gone + Map active + pin focused.*
- **Escape inversion (P34 + map/calendar)** — sheet handlers must stay capture-phase. *Hand-test: detail+sheet open → Escape closes sheet, not detail.*
- **Day key (P40)** — must keep `anchors.todayTs`. **CompactRow kind-awareness (P24/P42)** — events time-first, places activity-first. **PlaceDetail renderer** present. **Settings `from` param** preserved. **imageMode gate** honored (no green placeholder). **Profile stats honest** (computed, not hardcoded).

## O.3 Safe sub-sprint sequence (one surface / commit; checkpoint between phases)
- **Phase A — foundation: ✅ DONE** (P35 title-norm · P36 imageMode · P42 DecisionCard spine; head `9b138a9`). *Gate before B: `npm test` green + the 4 seams verified.*
- **Phase B — Events (time-first):** P34 detail CTA→Add-to-day (riskiest — do isolated) → P23 home compact sections → P25 guide chips + POV headers → P39 section-label honesty. *Checkpoint commit.*
- **Phase C — Spots (activity-first):** P24 spot activity rows (imageMode gate; no green wall) → P38 dedup + fit-badges. *Checkpoint.*
- **Phase D — cross/map/calendar** (P40 first, then P29 + the map round can parallelize): P40 calendar next-days + state legend → P29 empty-day quick-ideas → P28a/P28b/P31 map decision bottom-sheet + emoji markers + near-me (isolate the `focusMap` work). *Checkpoint.*
- **Phase E — search/bugs:** P41 search bridge → P43 transition ghost-overlay bug → P44 font A/B pill. *Final QA.*
- Riskiest, most-coupled changes (P34 detail/morph; P31 focusMap) are **isolated in their own commits**, verified alone. Shared files (`cards.jsx`, `nav.jsx`) force **serial** work; orthogonal surfaces (calendar vs map) can parallelize.

## O.4 Verification gates (every commit) + new smoke asserts
- **Per commit:** `npm --prefix app run lint` → `npm --prefix app run build` → `npm test` → **live-verify via DOM rects** (screenshots wedge on `.pg` overlays; drive nav with `dispatchEvent(new MouseEvent('click',{bubbles:true}))`) → only then push. **Red harness = do not push.** New commits for fixes (never amend).
- **Lock the seams (add to `test/smoke.mjs`):** source-grep asserts that survive refactors — (a) `cards.jsx` exports `CompactRow` (memo) + branches on `kind` + consults `imageMode` + RowFeed switches Row↔CompactRow on `compact`; (b) `nav.jsx` sets `viewTransitionName='evt-hero'`, Escape closes detail-before-page, `focusMap` clears detail+page+sets mapFocus+goTo(map), `openDetail` calls recordSignal+recordView; (c) `App.jsx` detail render-order after subpage, DayPage key includes `anchors.todayTs`, all subpage `page.type` cases present; (d) PickerSheet capture-phase Escape; (e) `imageMode`/`normalizeTitle` unit cases.

## O.5 Effort + go/no-go
- **~56–78 hrs (≈5–10 days)** depending on parallelization — genuinely multiple sub-sprints, as Josh expected. This is THE big push; after it → tiny patches → 3.77.
- **Go/no-go between phases:** each phase's gates must be green + the 8 paths intact before the next starts. If a patch can't gate in 2 attempts → revert it, document, Josh decides re-attempt vs defer.
- **Builder posture:** it's already correctly in this sequence (Phase A done, into B) — this plan **adds the path-safety discipline + the §N target**, it is NOT a restart.

## O.6 Decisions — RESOLVED
- **D1 Nav IA →** keep current 5-tab; nav restructure = Phase-4 candidate (§N.3, Josh ✓).
- **D2 Dayparts →** **keep the ☀️/🌙 binary** (the §N "Plan your day" shows a generic "add an event or spot," not 3 daypart slots; no store migration). (Per §B.2 #10.)
- **D3 Map bottom-sheet →** **top-3 curated** (matches §N screen 5: ~3 picks + "View all in this area").
- **D4 Guide taxonomy →** guides are honest by construction (`resolveGuide` returns real matches only); **P39 audits labels + drops/relabels any thin guide** — builder verifies `guides.json` against real data before P25.
- **D5 Image fallback →** **strict: no green placeholder in lists** — bad/missing image → text-first row (the whole point of P24/P36).
- **D6 Section-label honesty →** **strict** — every label has a true predicate (honesty contract). No aspirational labels over mismatched content.

_End of amendment._

---

# ADDENDUM P (2026-06-16) — The North Star Refine Loop (recursive, Josh-gated)
_Josh: the §N benchmark is THE North Star + the primary continuous focus. A holistic visual rework can't be matched surface-by-surface in one pass — sweep every surface, THEN iterate to cohesion. The builder keeps stopping after each phase declaring "done" (it did Home/Phase-B beautifully, then halted). New rule: the SWEEP covers all surfaces before "done," then we loop to your approval._

## P.1 The structure (supersedes the linear §O phase-end stops)
1. **First full BOLD sweep:** B ✓ (Home matched) → **C (Spots)** → **D (map/calendar/search/profile)**. Every surface gets its bold §N match at Phase-B ambition. **Expect the app to NOT feel fully cohesive until the sweep completes — that's normal**, not a failure.
2. **Stage R — Refine to Benchmark (RECURSIVE, JOSH-GATED)** — sits **between D and E**: screenshot every surface → compare to the reference image → refine the mismatches → repeat. **Loops until Josh personally approves the visual.** This is the convergence stage where it actually starts to *match*; Josh guides each pass.
3. **E — bugs + the §O 8-path safety sweep** (Josh helps guide).
4. Then the **multi-city bridge (3.77/3.78)** — **gated on Josh's Stage-R visual approval.**

## P.2 The image is IN THE REPO (the unlock)
The reference image lives at **`reference/ui-benchmark.png`**. The builder's Read tool **renders images** — so it can now build from the ACTUAL picture, not a text description (this was the missing piece). **Before matching any surface, Read `reference/ui-benchmark.png`.** Replace that file when a newer reference is produced; **Stage R should run against a FRESH image** based on the actual mostly-matched app + Josh's add/remove notes (see P.4).

## P.3 The bar (so it doesn't go timid or stop early)
- "Done" with a surface = **"it looks like the reference image,"** NOT "I made a safe change." If it still looks like the old app with tweaks, it's not done.
- **Do not stop after each phase** — sweep ALL surfaces (C, then D) before reporting the sweep complete.
- Keep §O path-safety (verify the 8 paths, checkpoints, gates) — **boldness AND safety, never boldness traded for safety.**

## P.4 Re-baselining the reference (for Stage R)
The original §N was admittedly inexact (some sections to build, some to remove, some kept). **Recommendation: finish the first sweep (C/D) against the current image, THEN get a fresh ChatGPT reference** reflecting the now-coherent app + Josh's changes — a tighter target for the refine loop. Drop the new image at `reference/ui-benchmark.png` (replacing/versioning the old). The ChatGPT re-baseline prompt carries the locked decisions: 5-tab nav (no Home tab), Sunlit-Coastal-Pop palette, the DecisionCard/CompactRow/FeaturedCard/NextDays patterns already built, what to add vs remove.

## P.5 STAGE R — the aggressive exact-match pass (Josh, 2026-06-16) — GO
Josh's ruling: **this is THE pass that gets us to a shippable app.** Go straight to Stage R now (it **subsumes the C/D sweep** — no separate linear sweep). Take everything we've built and **make every surface match the reference image EXACTLY**, recursive until Josh approves. "Lean too far rather than not enough."
- **Target image:** a FRESH GPT reference, generated from a **screen recording of the current app**, anchored HARD to the original §N vision Josh loves (esp. the Home redesign). Hard guardrails in the GPT prompt: **minimal NEW features · mostly REORGANIZE the existing ones · do NOT cut what we built + like (the home redesign — NextDays/greeting/FeaturedCard — the decision cards, the warm palette, the 5-tab nav).** It must be **exact + buildable** (no phantom sections), every screen using consistent components. Lands at **`reference/ui-benchmark.png`** (builder Reads it).
- **Posture:** **design-timidity safeguards OFF** — match aggressively, reorganize boldly, lean too far. **Path/bug safeguards STAY ON** — verify the §O 8 paths, gate every commit. **Commit every surface** = a clean revert point (the net that lets us lean far: "we can always revert").
- **⚠️ NAV RESTRUCTURE (now IN scope — the single riskiest change; do it EARLY + isolated so the rest builds on the final nav):** adopt the image's nav — **Home · Events · Spots · Plan · Profile**: split the Phase-B dashboard onto a new **Home** tab (Events becomes the browse), rename **Calendar → "Plan"**, demote **Map** to a **sub-view** (reached from Events/Spots, not a tab). It touches the load-bearing nav: `VIEWS`/`viewIndex` (nav.jsx:51) + the lazy-mount `<section>`s (App.jsx pager) + **`focusMap`'s `goTo(viewIndex('map'))`** — Map is no longer a tab, so **`focusMap` must open the Map sub-view instead** (detail→Map handoff, §O.1 path 5). **Own commit + checkpoint; keep path-safety MAX here; verify ALL §O.1 8 paths after it; revert that one commit alone if anything breaks.** This is the one place "match-exactly + design-safeguards-off" can break navigation — so safeguards-off is VISUAL only; the nav wiring stays rigorously verified.
- **Scope, one surface per commit (Read the image first, eyeball-match each):** **nav restructure (above) →** Home → **Events (browse) → Spots → Spot-detail → Map(sub-view) → Plan/Calendar → Search → Event-detail → Profile(+stats).**
- **Recursive + Josh-gated:** after a full pass, screenshot every surface vs the image → refine mismatches → repeat → **loop until Josh personally approves.** THEN E (bugs + the §O 8-path safety sweep) → multi-city (3.77/3.78).
- **The bar:** "looks like the image." If a surface doesn't match, it's not done. Reorganize features to the vision; don't invent or delete wholesale (minimal new / reorganize existing).

_End of amendment._

---

# ADDENDUM D (2026-06-15) — Risk tightening before 3.7 execution
_Additive amendment (Josh). The plan is approved directionally — keep the existing sprint order (§9) and the resolved decisions (§B.2). Goal unchanged: move **Wuzup** from a "white app" / prototype-feeling directory into a real premium branded local-life planning app. These are guardrails layered on top, not rewrites._

## D.0 Contrast directive — Sunset Gold action states (binding)
When replacing teal with **Sunset Gold** (`--accent`), the builder must keep **every action state at ≥ 4.5:1 contrast (WCAG AA)**:
- **White text is FORBIDDEN on standard Sunset Gold.** Inside gold components, use **Sun-baked Clay (`--ink`) text**.
- For **standalone text links / accent-as-text on light**, use a **darker high-contrast gold variant**, not the fill gold.
- _Continuity note (from build progress): 3.71 already introduced `--accent-ink #b35418` for accent-text-on-light and moved CTAs to dark-ink-on-gold — that aligns with this directive. The builder should **complete and verify** that sweep everywhere gold appears as text or under text (incl. the deferred `map.css` markers, FB-B), not treat it as finished._

### D.0-R Primary-button resolution (Stage R — binding; decided by Josh 2026-06-17, Home-pass review)
The reference's primary buttons are **white text on a warm fill**. White on the *light* gold (`--accent #ff8c42`) fails AA — so D.0 forbade it and we shipped dark-ink-on-gold. Resolution that honors **both** the reference look **and** AA:
- **Primary buttons = fill `--accent-ink` (#b35418) + white text.** White-on-#b35418 ≈ **5.0:1** (passes AA for normal text). Verified. This matches the reference's white-on-warm-button look.
- **D.0 is NOT violated:** white is still **forbidden on the light gold `#ff8c42`**. We are using a *darker* warm fill, not the light gold, under the white text.
- **Light gold `#ff8c42`** now serves **accents / highlights / selected chips / active states / non-text fills** only — not primary button fills.
- **This SUPERSEDES** the earlier "keep dark-ink-on-gold for primary CTAs" notes (the §"Primary CTAs get tactile depth" line and §"Buttons: Primary = filled Sunset Gold … keep the dark-ink-on-gold AA rule") **for PRIMARY BUTTONS specifically.** Dark-ink still applies anywhere the *light* gold itself is the fill (e.g. selected chips), and accent-as-text on light still uses `#b35418` text.
- **Builder action:** define one shared primary-button treatment (token/class) = `#b35418` fill + white text, contrast-verify ≥4.5:1, and sweep the primary CTAs (`.nd-cta`, "Add to day", "Get Tickets", "Make this my plan", etc.). Revises R-H4 (which shipped `#b35418`→ keep, but flip text from `--ink` to white). The fill may be nudged *brighter* toward the mock only while white text stays ≥4.5:1.

## D.1 3.71 brand checkpoint (gate before rolling the brand app-wide)
"Sunlit Coastal Pop" + the Wuzup rename + Sunset Gold are approved **as a first pass**, but require an **explicit visual checkpoint** before the builder rolls the brand through the whole app.

After applying the 3.71 brand foundation to the first high-impact surfaces, **capture screenshots of at least:** Home/Events feed · Event detail · Spots feed · Place detail · Calendar/DayPage · Map · Profile · Settings · Add Event.

Review against the bar: **"Vastly different but very recognizable. Premium/playful, not childish. Branded, not orange-washed. Warm and app-like, not theme-skinned."**

If Sunset Gold feels **too loud, cheap, or low-contrast, retune the accent before** rolling it app-wide. **`#ff8c42` is not sacred — the brand direction matters more than the exact hex.** Also verify: AA contrast (esp. text on gold) · Gold and Warm Magenta (`--hot`) are visually distinct · the app still feels **coastal/local, not just orange** · Kumbh Sans titles add personality without hurting readability.

## D.2 Do not force sourced rankings before the data supports them
The plan asked for sourced beach/park rankings in 3.73, but the feedback log (**FB-A**) already shows they're **data-blocked** (the real beach signal was too flat to rank honestly). Execution update:
- Keep **Beach Day / Park Day as honest browse-style Guides** while ranking signal is weak.
- **Do not fabricate "best" rankings.**
- **Promote true sourced rankings into a separate `finder-data` enrichment patch.**
- Ranking ships **only after** the finder has real signal: amenities, designations, source corroboration, distance, official-source labels, or a curated external-source layer.
- If ranking isn't supported, use **"Beach day picks" / "Good beach options" / "Worth considering," not "best beaches."**
- **The honesty contract wins over the feature spec.**

## D.3 Source attribution is a NAMED patch, not just a checklist item
Promote the source-attribution page (⚑X3 / FB-C) from a loose gate item to an **explicit patch.** Target: **3.76** (if it fits the Settings/About/Profile work) **or 3.77** (if it belongs with the multi-city/source-registry work). Requirements:
- **Settings → About exposes source attribution.**
- Include **Wikidata, OSM, government/open-data sources,** and any city-specific sources.
- For multi-city, attribution **scales per city.**
- Keep it **readable and lightweight, not academic.**

## D.4 Multi-city is a bridge, not a blocker (unless Josh says otherwise)
Multi-city is approved directionally (geo-refactor + NYC proof; Austin/Seattle fast-follow; Puerto Rico held for Spanish/bilingual work). Gate clarification:
- **Tampa shippability is its own milestone.**
- **Multi-city must NOT block Phase 4** unless Josh explicitly decides first public launch requires NYC.
- **3.77/3.78 are the Phase-4 bridge.**
- If 3.71–3.76 reveal **major polish debt, finish Tampa polish before starting NYC.**
- **Do not let multi-city turn 3.7 from a patching/polish phase into a second foundational rebuild.**

## D.5 Visual QA after each visual patch (required)
For every visual patch, add a **lightweight screenshot review before commit/push.** Minimum surfaces: Home · Event detail · Spots · Place detail · Calendar/DayPage · Plan-builder sheet (if touched) · Map · Profile · Settings · Add Event. Check:
- visual hierarchy · image cropping · text contrast · touch-target size · no awkward truncation
- **no stale teal/cool-gray leftovers** unless intentionally retained
- **no page feels less premium than before**
- **no new surface violates the honesty contract**

## D.6 Guides stay decision tools, not content bloat
Keep the resolved naming ("Guides" user-facing · "Watch Guides" for sports/world-event · "Smart Groups" internal only). Enforce the rule: **a Guide is not a filter with nicer copy — it must help the user decide or plan.** Each Guide needs at least:
- a clear **intention/moment** · a **point of view** · a **small curated/bounded set** · **"why this fits"** reasoning where possible · a **path to plan/save** · **sources/trust** where ranking or external claims are involved.
- If a Guide is just `events.filter(...)` with a nicer title, **leave it as a lens/filter instead.**

## D.7 Keep patch scope narrow
One patch at a time, **one commit per patch.** If fresh feedback arrives while the builder is active, **capture it in Addendum C first, triage it, and only jump the line if Josh explicitly says it interrupts the current planned sequence.**

_End of amendment._
