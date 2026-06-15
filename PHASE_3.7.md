# PHASE 3.7 — Patching · Premium Product Polish · Smart Groups · Planning UX
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
