# UI Build Spec — "What's Hot" feed, chips, motion, calendar

## 🏆 TASTING VERDICT (Josh + Charles, 2026-06-10): **EDITORIAL WINS.**
Editorial is the app's design direction and default. **Fold in** select Poster elements (its density/color energy — e.g. FREE badge overlays, category-hue accents, grid moments where a section is naturally scannable) and keep Cinematic's *vibe* for surfaces that are naturally dark/dramatic (Find My Night already lives there; The Big One; potentially nightlife contexts) — but Cinematic as a whole-feed mode has "tougher applications." Further development continues WITHIN editorial: section displays and naming still need refinement. The 🎨 toggle stays temporarily as a comparison tool; retire it once consolidation lands.

## ⚡⚡ ROUND-3 ADDENDUM (Charles, 2026-06-10 — OVERRIDES round-2 where they conflict)
1. **BUBBLES ARE PAGES.** Tapping a bubble opens a DEDICATED FULL PAGE for that lens (own identity: tinted hero band in the bubble's hue, emoji, title, count, the filtered events grouped by day). Back out to Hot, then into another bubble. The bubble is a meaningful destination, "not just a side note on top" — the in-place lens + sticky lensbar pattern is RETIRED. (This consciously amends round-2's "never navigate" rule: ONE level deep, fast in/out, never deeper.)
2. **THE DICE GROWS UP → "Find My Night."** The bottom-right FAB opens its own full-page guided flow, not a one-shot random event: the app asks questions with big tappable answers ("When are you going out?" → "Who's coming?" → "What's the vibe?" — chill/wild/outdoors/cultured/etc.), then: "Okay, I think I've got you 🔥" → a list of FIVE picks, with Reroll. (Charles offered Tinder-swipe as the alternative; the question-flow is chosen — session-1 research showed swipe-for-events is a failure pattern, and the Q&A format is the better fit for his "guide us" framing.)

## ⚡ ROUND-2 FEEDBACK ADDENDUM (Josh + Charles, live review 2026-06-09 — OVERRIDES anything below that conflicts)
1. **PALETTE SHIFT (Charles):** the app's base color moves OFF red/orange → an **inviting, light, bluish-greenish** identity (Tampa = water). New tokens: `--accent: #0d9488`-family teal/aqua for interactive elements, links, section overlines, selected states; keep `--hot: #ff5a3c` coral RESERVED for hot-ness only (Hot tab active state, flame icon, heat badges, The Big One overline). Light-first like Apple. **Dark mode = future (logged).**
2. **BUBBLE GRID (Charles):** the Hot page opens with a scrollable strip/grid of **uniform "bubbles"** — top filters people actually want: Tonight, This Weekend, Free, Near Me, then general categories (Music, Food & Drink, Outdoors, Sports, Arts, Nightlife, Family, Markets, Clubs & Meetups). Enough to scroll. Emoji/icon + label, soft per-category tinted backgrounds. Tapping applies the lens IN PLACE (absorbs the old chip row's job). When a lens is active: compact sticky bar with the active bubble + ✕ to clear.
3. **SCROLL > CLICK (Josh):** scrolling is good, clicking into new pages is bad. Filters/lenses/"see all" must never navigate away — they transform the feed in place.
4. **LESS LIST, MORE ALIVE (Josh):** the feed still reads too list-like. Spice: per-category color accents, 🔥 heat badges driven by buzz (e.g. 🔥×buzz on hot cards), playful microcopy, and light gamification with zero account infra: a **"Surprise me" dice button** (random high-hot-score event, fun reveal), optionally localStorage ♥ saves if time allows. Gamified social feed (comments/likes/friends) stays parked in LONG_TERM.
5. **MAP QUICK FIX (Josh):** in the Map tab the bottom tab bar disappears (Leaflet panes z-index 400–1000 vs tabbar — raise tabbar above Leaflet) and event pins/detail interaction is broken — fix both, then map development stays parked.
6. Calendar: parked (month grid is loved, keep it).
_Source: UI scout research (App Store Today, Netflix, Spotify, Airbnb, Fever, Fantastical, Apple HIG, NN/g), 2026-06-09. This is the implementation reference for the Hot-tab rebuild._

## TL;DR — the 5 highest-impact moves
1. **Vary the section rhythm App-Store-Today-style:** carousel → full-width feature card → compact 3-row list → carousel → infinite list. Identical row-after-row reads as "template"; the alternation IS the polish.
2. **One chip row: sorts = radio, filters = toggles, sticky with backdrop blur** once the hero scrolls away. The sticky-blur pin is the single most "Apple" detail we can ship.
3. **No framer-motion.** Vanilla CSS + 4 motion tokens + View Transitions API (feature-detected) for card→detail morph and re-sort. ~0kb.
4. **Animate only transform+opacity, entrances ONCE (max 6 staggered), `scale(0.97)` press state on every card.** Smooth = restraint at 60fps, not more animation.
5. **Calendar month grid: heat-tinted cells (density) + tap-day → list below grid** (Apple Calendar pattern). Dots can't show hot-Saturday vs quiet-Tuesday; heat shading literally displays "what nights are hot" = the product thesis.

## 1. Section layouts (460px container, 20px gutters, 420px content)
| Section | Pattern | Spec |
|---|---|---|
| **Hero** | Static full-bleed header | 220px tall, bottom scrim rgba(0,0,0,0)→0.55, title bottom-left 20px inset. Parallax `translateY(scrollY*0.4)`, scrim 0.3→0.7 over first 180px. Chip row pins at its bottom edge. |
| **Tonight** | Horizontal carousel, landscape | Card 280×210 (img 280×157 16:9, r14), title 15/600, meta 13 muted. Gap 12, inset 20, scroll-snap x mandatory, next card peeks ~120px. Max 8 + "See all →" end-cap (dashed border). |
| **The Big One** | ONE full-width feature card | 420w, aspect 4/5, r20, full-bleed img + scrim. Overline "THE BIG ONE" 11/700 uppercase 0.08em accent; title 26/800 white; meta 13. Image scale-in from 1.04 on first reveal. Singular on purpose. |
| **Hidden Gems** | Compact vertical list, exactly 3 rows | 72×72 thumb r12 left; title 15/600 + meta 13; 12px row gap. "More gems" text link below. Rhythm break is deliberate. |
| **Free This Week** | Horizontal carousel, small square | 160×160 img r14 + meta below; FREE badge pill top-left (11/700, 4×8 pad). Gap 12, max 10 + end-cap. |
| **Everything** | Vertical infinite list, date headers | 32px gap + "Everything" header; date sub-headers 13/700 uppercase muted ("Today", "Tomorrow", "Sat, Jun 13"). Rows: 96×96 thumb, 16px gap. IntersectionObserver sentinel ~600px early. NO entrance animation here. |

**Section headers:** optional overline 11 uppercase accent + title 21/700 (-0.01em) + optional 13 muted sub. 36px above section, 14px header→content. "See all" 14/600 accent, right-aligned.
**Rule:** "See all" does NOT push a screen — it sets the matching chip/filter and scrolls to Everything. One list, many lenses.

## 2. Chip row
- `Hot`, `Near me` = SORTS (radio, one always on; tapping active sort = no-op). `Free`, `Tonight` = FILTERS (independent toggles; tap active = clear).
- Row: overflow-x auto, no scrollbar, 20px inset, 8px gaps. Chip: 36px tall, 14/600, 16px pad, radius 999. Unselected: 1px hairline, transparent. Selected: ink-filled, inverse text. 200ms bg transition.
- Sticky: `position: sticky; top: 0`; when pinned (1px IntersectionObserver sentinel toggles `.pinned`): `backdrop-filter: blur(20px) saturate(180%)`, semi-transparent bg, 1px hairline fade-in.
- Re-order feedback (tonight's version): fade list out 120ms (+8px translateY), swap, fade in 180ms with 30ms stagger ×5. Upgrade: `document.startViewTransition` FLIP. Never instant-teleport a reorder.

## 3. Motion tokens
```css
--dur-micro: 120ms;  /* press, chip fill */
--dur-fast: 200ms;   /* toggles, crossfades, tab switch */
--dur-base: 320ms;   /* entrances, list swaps */
--dur-page: 400ms;   /* detail open, sheets, view toggle */
--ease-out: cubic-bezier(0.165, 0.84, 0.44, 1);
--ease-emphasis: cubic-bezier(0.16, 1, 0.3, 1);  /* "the Apple curve" */
--ease-inout: cubic-bezier(0.65, 0, 0.35, 1);
```
- Card press: scale(0.97) :active 120ms; release 200ms. Everywhere.
- Section entrance: first paint only, opacity+14px rise, 400ms ease-out, 50ms stagger, MAX 6, never re-animate on scroll-back.
- Detail open: View Transitions name-pair card-img ↔ detail-hero (App Store morph); fallback slide-up 400ms ease-emphasis + backdrop 250ms.
- Tab switch: 150ms crossfade or instant. NO sliding.
- Images: 300ms fade-in over dark placeholder. Never pop.
- Skeletons: only after 300ms delay; pulse opacity 0.45↔1 1.4s; must match final layout; crossfade out 200ms.
- DON'T animate: scroll re-entrances, infinite-list rows, the map, width/height/top/left, anything under prefers-reduced-motion (kill parallax+entrances, keep crossfades).

## 4. Calendar tab
- Segmented control "List | Month": 32px, pill, sliding thumb 200ms ease-inout, right of month title. Selected date persists across toggle. Strip↔grid crossfade 250ms.
- List view: pinned week strip (7 cells 44×56, weekday 11 over date 16, selected = 36px filled circle, week-paged swipe) over infinite agenda.
- Month grid: 7×60px cols, 56px cells, ≤6 rows (~336px) + selected day's event list BELOW grid (never leave screen). Date numeral 15px. Today = accent ring; selected = 32px accent circle.
- **Density = heat shading:** cell bg = accent at `min(count/p90, 1) * 0.20` opacity, quantized to 4 buckets. (Dots reserved for future "saved event" marker only.)
- Month paging: horizontal scroll-snap, 3-month window, title crossfade 150ms; day-tap list crossfade 200ms, no scroll jump.
