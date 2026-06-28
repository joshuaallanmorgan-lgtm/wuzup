# PREMIUM_PUNCH — the unified premium-feel punch list

This merges Josh's own playtest notes + locked calls with the 7-lens premium diagnostic (typography, spacing, color-surface, depth, imagery, motion, components) into one ranked, deduped list. All 60 diagnostic findings are folded in; file:line refs are the diagnostic's.
The 4 bendable rules are now in play — **imagery**, **depth**, **motion**, **richer content** — so fixes are allowed to add real photos, real elevation, real animation, and richer sample content where it earns premium feel. Honesty bar still holds: nothing fake is presented as real.

Legend: `[src: josh|diag|both]` · `[rule: imagery/depth/motion/content/none]` · `[impact]` `[effort]`. **★ = flagged by BOTH Josh AND the diagnostic — top priority.**

---

## §0 — LOCKED DECISIONS (non-negotiable)

_Reconciled against the live app 2026-06-27 (A5 step 0): A1/A2/A4 verified genuinely shipped — D1 uniform 158px, D2 borderless/shadow-only, D3 2-line tight title clamp, D4 bare stroke-heart top-right (rail gone); --bg #f6f2ec, .num tabular, tab-bar warm-glass+float, --shadow-1/2/3 scale all live. No believed-done-but-not gaps. D5–D8 = the A5 work below._

Josh's firm calls. These override anything below, including the recent card-polish.

- [x] **D1 — Cards (events + spots) MUST all be the SAME SIZE.** Uniform dimensions, no ragged heights. *(He called this the single biggest one.)*
  - How: let the tall left image define one fixed card height; clamp the title to N lines + reserve the meta/chip/CTA rows so every row resolves to identical height regardless of content. Pair with components#1 (tall hero) so image height = card height.
  - Files: `cards.css` (`.gem` :370, `.spotcard--row` :642, `.gem-img` :394, `.spotcard-img` :659), `cards.jsx` GemRow :351-388 / SpotCard :481-502.
- [x] **D2 — LOWER CONTRAST on cards + borders.** Softer, matching the mockups (current runs too hot).
  - How: drop/soften the 1px `var(--line)` card hairlines (lean on shadow, components#9), demote over-spent orange micro-labels to muted (color#4), warm the chip fills (color#5).
  - Files: `cards.css` (`.gem` border :370, `.spotcard--row` border :633-644, `.gem-chip` :420, `.chip` :566), `index.css` tokens :49-53.
- [x] **D3 — MAXIMIZE the TITLE.** Show the full event/spot title; relocate corner controls off the title's horizontal band; build a graceful truncation fallback for genuinely-long titles.
  - How: move heart out of the text column (→ D4), free full width for the title; clamp to 2 lines tight (typo#7) with ellipsis as the last-resort fallback.
  - Files: `cards.jsx` gem-main :363-388 / spotcard-body :481-502, `cards.css` `.gem-title` :404 / `.spotcard-title` :178 / `.tcard-title` :147.
- [x] **D4 — HEART → TOP-RIGHT CORNER of the card.** REVERSES the recent mid-right rail; refine the heart (currently reads underdeveloped). The **"★ Best for"** spot-card line moves lower/near the CTA to free title width.
  - How: absolutely position a thin stroke-heart (no circle border) top-right of `.gem-main`/`.spotcard-body`; drop `.gem-rail`/`.spotcard-rail`; relocate `.spotcard-bestfor` near the CTA. (= components#2.)
  - Files: `cards.jsx` :380-385 / :492-500, `cards.css` `.gem-rail`/`.spotcard-rail` :421-454, `.spotcard-bestfor` :197.
- [x] **D5 — Filter chips (LensNav row) must fit ONE LINE on Events + Spots.** They overflow today.
  - How: `.lens-row` currently has `flex-wrap: wrap` (topnav.css:14) so it spills to a 2nd line; removing the Map pill (D8) frees one slot, then tighten pill padding/gap or icon-only the secondary pills so the set fits without wrapping.
  - Files: `topnav.css` `.lens-row` :12-16 / `.lens-pill` :17, `LensNav.jsx` `.lens-row` :88-117.
- [x] **D6 — The opened TINDER deck (dark) must MATCH the app's premium visuals.**
  - How: premium-ify the deck card surface — warm gradient + inner top-sheen + real layered shadow (= depth#6); choreograph the under-card rise (motion#8); align stamp/button/text to the app's icon + type system.
  - Files: `deck.css` `.deck-card` :56-60 / `.deck-top`, `swipedeck.css` `.sd-under1/2` :26-27, `lensdeck.css` (shared DeckFace).
- [x] **D7 — SETTINGS: remove "Customize interests" AND "Manage your taste in Profile" rows; keep ONLY the quick-primer entry, and premium-ify that primer.**
  - How: delete the two `.st-row` buttons; keep the "Take/Retake the quick primer" row; bring the primer chrome up to the target feel (premium type/depth/icons).
  - Files: `SettingsPage.jsx` "Customize interests" :83-89, "Manage your taste in Profile" :108-114 (whole "Your taste" section :105-116), keep primer row :91-98; `Primer.jsx`, `primer.css`.
- [x] **D8 — MAP: PARK it for v1.** Remove the map feature everywhere; the card "Open map" action just ROUTES TO GOOGLE MAPS (a duplicate of Directions); document the parked map for a v2 revisit.
  - How: remove the LensNav Map pill (LensNav.jsx:107-111) + `onMap`/`openMap` wiring (nav.jsx:365), drop the `map` sub-view (App.jsx:345 `<MapView>`) and the detail mini-maps; point any "Open map"/`mapsUrl` at `https://www.google.com/maps/search/?api=1&query=…` exactly like Directions already does (DetailPage.jsx:100-102/515, PlaceDetail.jsx:115-117/463).
  - Files: `LensNav.jsx`, `nav.jsx`, `App.jsx:345`, `MapView.jsx` + `map.css` + `leaflet-lazy.js` (retire), `detail.css` `.mini-map` :63. Note the parked map in the v2 backlog.

---

## §1 — RANKED PUNCH LIST

Deduped; grouped by theme; within each theme sorted impact (high→low) then effort (S→L). ★ = both Josh + diagnostic.

### (A) Imagery

- [ ] ★ **Build a real place-imagery pipeline — places are 99% flat color blocks (26/2163 photos; cafes 0/332; beaches 0/22).** Tier it: widen Wikimedia P18 to category/Geograph/Mapillary for parks/beaches/trails/piers; curated stock for cafes; ship an 8-12-shot curated category set keyed by placeType + stable id-hash. Target 80%+ coverage before v1. `cards.jsx:146-188`, `places.json`, SpotCard `cards.jsx:473-524`. *(Josh: "place imagery gap" + "icons/emoji look cheap.")* `[src: both]` `[rule: imagery]` `[high]` `[L]`
- [ ] ★ **Place DETAIL hero is a 250px+ flat color slab for ~99% of places.** Spend imagery budget on heroes first; until coverage lands, upgrade the art-floor hero (duotone texture, larger low-opacity watermark, top-light + bottom vignette). `PlaceDetail.jsx:111,312-339`, `App.css:490`. *(Josh: opened detail pages "look great" — keep, but flat hero undercuts them.)* `[src: both]` `[rule: imagery]` `[high]` `[M]`
- [ ] **Tall result-card image, not a 76/84px square thumb** (the biggest card-proportion tell). Bump `.gem-img`/`.spotcard-img` to a tall left hero (flex 0 0 96-104px, stretch to card height or aspect 4/5). `cards.css:394,659`. *(Also drives D1 uniform height.)* `[src: diag]` `[rule: imagery]` `[high]` `[M]`
- [ ] **Add a gradient-over-photo scrim on card thumbs** so white badges/heart stay legible and the 1447 multi-host event photos read color-graded. `.imgbox` ::before top→transparent + bottom→rgba(0,0,0,.45), matching the hero. `cards.css:471` + CardImg children. `[src: diag]` `[rule: imagery]` `[med]` `[S]`
- [ ] **Subdivide the "green wall" (1323/2163 parks, hue 140 + 🌳).** Interim: hash park hue within 130-150 and rotate 3-4 park emoji; real fix is photos (parks have best Commons coverage). `categories.js:49-62`, `cards.jsx:99`. `[src: diag]` `[rule: imagery]` `[med]` `[S]`
- [ ] **Art-floor emoji watermark reads as a flat sticker.** Prefer the compact text-forward medallion (`featc-noimg`, `cards.jsx:282-297`) for photoless SpotCard thumbs; add a shared paper/canvas texture + soft inner glow to the art-floor itself. `cards.css:61-87`. *(Josh: emojis look cheap → engineered icons.)* `[src: both]` `[rule: imagery]` `[med]` `[M]`
- [ ] **Guides/IntentTiles use emoji discs; refs show photo-backed collection cards.** Give each Guide a real cover image + "GUIDE" overline + scrim (per ref-spots-full-3); keep emoji-disc IntentTile only for the small all-visible activity grid. `cards.jsx:541-551`, `cards.css:209-268`, `LocationsView.jsx:271`. `[src: diag]` `[rule: imagery]` `[med]` `[M]`
- [ ] **89 photoless events fall to the art floor inside a photographic feed.** Fall back to a curated category stock image (music/comedy/market) keyed by category — clearly a mood image, same honesty bar. `cards.jsx:160-184`, `events.json`. `[src: diag]` `[rule: imagery]` `[low]` `[M]`

### (B) Cards & components

- [ ] ★ **Heart → top-right outline, kill the action-rail.** Absolutely position a thin stroke heart top-right of the text block (no circle border); CTA pinned bottom-right; drop `.gem-rail`/`.spotcard-rail`. `cards.jsx:380-385,495-500`, `cards.css:421-454`. *(= D4.)* `[src: both]` `[rule: depth]` `[high]` `[M]`
- [x] **One `.chip` primitive — four divergent treatments today.** Hairline-outlined pill, subtle tint, 11.5px/600 ink, optional 12px stroke-icon; migrate `.gem-chip` (flat gray), `.featc-chip`, `.crow-chip`, price `.chip`, and the border-less `.spot-amen`; add `--free` (sage) + `--accent` variants. `cards.css:420,328-335,566,192`, `modes.css:165-178`. *(= D2 softer + Quick Win.)* `[src: diag]` `[rule: none]` `[high]` `[M]`
- [ ] **Add-to-plan/Add-to-day CTA is a tiny 11px tinted micro-pill, not a button.** Raise to ~28-30px height, 12.5px/700, 1px `rgba(--cta,.5)` border on faint tint, keep CalIcon 13-14px. `cards.css:435-454`, `cards.jsx:382-384,497-499`. *(Josh: CTA buttons "look good" — this is the card micro-CTA, distinct.)* `[src: diag]` `[rule: none]` `[high]` `[S]`
- [ ] ★ **Heart/flame/pin are raw emoji (♥ 🔥 📍 ★), not the engineered 2.1-stroke family.** Add stroke heart (outline+filled)/flame/pin/sparkle to the Icon set (`lib.js:419-670`) and swap into SaveHeart, HeatBadge, `.gem-venue`, `.spotcard-bestfor`. Keep 💎 as a deliberate accent. `saves.js:313`, `cards.jsx:120,365,492,520,289`. *(Josh: "emojis look cheap → engineered stroke icons.")* `[src: both]` `[rule: none]` `[high]` `[M]`
- [x] **Add a radius token scale (8 ad-hoc radii today: 7/10/12/14/15/16/17/18px).** Define `--r-sm 10 / --r-md 14 / --r-lg 18 / --r-pill 999`; map all cards/thumbs/badges; one thumb radius (14) so gem + spot match; fix the 7px imgbadge. `cards.css` many + `modes.css:182`. `[src: diag]` `[rule: none]` `[med]` `[S]`
- [ ] **Heat badge is a loud solid-gradient pill + 🔥 + count.** Make it a frosted glass pill with a stroke flame, OR demote buzz to an inline "Buzzing" chip — frees the corner the heart now wants. `cards.css:90-106`, `cards.jsx:116-123`. `[src: diag]` `[rule: depth]` `[med]` `[S]`
- [ ] **Pressable feedback is scale-only; no shadow lift on press/hover.** On `.gem`/`.spotcard--row`/`.featc`/`.intent-tile` :active scale(0.985) AND tighten shadow (or hover-raise), within `--dur-micro`. `cards.css:6-7,228,592`. `[src: diag]` `[rule: motion]` `[med]` `[S]`
- [ ] **Card surfaces are hairline-bordered + flat; refs read borderless + lifted.** Drop the 1px `var(--line)` border (or reduce to ~4% inset via box-shadow), lean on `--shadow-card`. `cards.css:370-379,633-644,272-279`. *(= D2; index.css:82 already endorses float-over-shadow.)* `[src: both]` `[rule: depth]` `[med]` `[S]`
- [ ] **Empty/end-of-feed is a bare gray sentence.** Replace `.feed-end` with a designed end-cap: soft medallion/compass glyph + warm one-liner + secondary action (change filters / explore Spots). `cards.jsx:617`, `cards.css:556,621`. `[src: diag]` `[rule: content]` `[med]` `[S]`
- [ ] **Venue/best-for/series micro-lines compete (up to 6 same-weight rows, 2 accent-bold).** Make venue muted; keep ONE accent emphasis per card (why OR series, not both); consider merging venue+when into one line; cap visible meta lines. `cards.jsx:363-377`, `cards.css:407-420,469,627`. *(Supports D3 title focus.)* `[src: diag]` `[rule: none]` `[low]` `[S]`

### (C) Typography

- [x] **Card-title weight/size is a five-way sprawl (9 classes, 4 weights, 4 sizes).** Define `--t-card: 15/700/-0.2px` (every standard card title) + `--t-card-lg: 19-20/800/-0.3px` (featured only); kill orphan 600/750. `cards.css:147,178,316,396,465,515,596`, `modes.css:48,119`. *(Josh: "text + subtext not premium everywhere.")* `[src: both]` `[rule: none]` `[high]` `[M]`
- [ ] **No tabular numerals anywhere — times/stats/distances/counts jitter.** Add a `.num` utility (`font-variant-numeric: tabular-nums`) on `.pf-stat-num`, `.cal-stat-num`, `.sec-count`, `.imgbadge`, `.row-dist`, `.spotcard-dist`, `.crow-price`, `.chip`, time/date metas. `profile.css:328`, `calendar.css:27`, `cards.css:471,547`, `App.css:299`. *(Cheapest big win.)* `[src: diag]` `[rule: none]` `[high]` `[S]`
- [ ] **Section title (21/700) doesn't outrank card titles (some are 800).** Bump `.sec-title` to 22px/800/-0.02em. `App.css:297`. `[src: diag]` `[rule: none]` `[high]` `[S]`
- [ ] **Eyebrow/overline is fragmented (5 trackings, half not uppercase).** One `--eyebrow` token: 11px/700/UPPERCASE/0.06em on `.home-title`, `.weekend-day-label`, `.spotcard-type`, `.nbhd-area`, `.row-cat`, `.d-k`, `.ms-group-label`, `.pf-hist-label`. `App.css:37,104`, `cards.css:177,464,550,627`, `modes.css:41`, `profile.css:188/207/366`. *(Josh: "subtext not premium everywhere.")* `[src: both]` `[rule: none]` `[med]` `[M]`
- [ ] **Title↔meta tonal contrast too low on the gem card** (`.gem-venue` 12.5/600 in --ink reads as dark as the title). Drop `.gem-venue` to --muted/600 or a #5f574e mid-gray; reserve full --ink for the title. `cards.css:417,606,157,407`. `[src: diag]` `[rule: none]` `[med]` `[S]`
- [ ] **Heaviest weights (900) spent on detail/calendar; feed stalls at 700.** Nudge `.featc-title` to 20/800 and `.sec-title` to 800 so each browse band has one heavy anchor; keep 900 for detail/name. `App.css:522`, `profile.css:84`, `locations.css:90`, `calendar.css:16`. `[src: diag]` `[rule: depth]` `[med]` `[S]`
- [ ] **Line-height too loose on 2-line clamped titles (1.25).** Tighten clamped card titles to 1.15-1.18; reserve 1.25+ for meta/prose. `cards.css:152,404,465,523`. *(Supports D3 truncation feel.)* `[src: diag]` `[rule: none]` `[low]` `[S]`

### (D) Color · surface · depth

- [ ] ★ **--bg and --card are ~1% apart — cards never lift as distinct surfaces.** Warm/darken `--bg` one real step (~#f6f2ec / #faf7f2), keep `--card` near-white; re-verify muted clears AA. `index.css:51-53`. *(Drives the whole "flat → premium-warm" jump; compounds with depth#8.)* `[src: diag]` `[rule: depth]` `[high]` `[S]`
- [ ] **The 3-layer `--shadow-card` exists but isn't on the hero surfaces.** Give the editorial Row + agenda `.card` the same fill+shadow as GemRow; add a soft drop to bare carousel image tiles. `index.css:83-84`, `modes.css:16`, `cards.css:584,134,488,175,462`. `[src: diag]` `[rule: depth]` `[high]` `[M]`
- [ ] **Tab bar + inactive tabs are cold-gray (#fff glass, #aab0ba slate) in a warm app.** Warm the bar to `rgba(254,253,251,0.85)` and inactive `--tab` to a warm gray (~#a89e92). `App.css:371,377`. `[src: diag]` `[rule: none]` `[high]` `[S]`
- [ ] ★ **Carousel image tiles sit dead-flat on the cream (only a 6% inset hairline).** Add a soft drop to the tile wrapper (`0 1px 2px / 0 4px 14px rgba(26,20,16,.06-.07)`) + press-raise on `:active`. `cards.css:19-26,146,176,394,463,501`. *(Josh: "little circles don't fade right" — same dead-flat / no-lift family.)* `[src: both]` `[rule: depth]` `[high]` `[S]`
- [ ] ★ **Bottom tab bar is a cold pure-white slab with no shadow — doesn't float.** Warm glass `rgba(254,253,251,0.82)` + upward lift `0 -8px 24px rgba(26,20,16,.06)`. `App.css:363-376`. *(Josh: chrome/fade feel.)* `[src: both]` `[rule: depth]` `[high]` `[S]`
- [ ] **Accent is over-spent — orange on overlines, chips, distances, micro-labels everywhere.** Demote editorial micro-labels (overline, "Best for", "Why this fits", series, area, type) to muted/ink; reserve orange for real actions/selection. `cards.css:177,197,464,469,627`, `App.css:301,464`, `modes.css:42`, `detail.css:52`. *(= D2 lower-contrast.)* `[src: both]` `[rule: none]` `[high]` `[M]`
- [ ] **One flat --shadow-card token everywhere — no elevation hierarchy.** Introduce `--shadow-1` (rows/tiles) / `--shadow-2` (= current, cards) / `--shadow-3` (featured/hero) / `--shadow-sheet`; assign by importance. `index.css:83-84`, `cards.css:222,277,378,642,690`. `[src: diag]` `[rule: depth]` `[high]` `[M]`
- [ ] **Neutral chips are washed-out divider-colored fills.** Warmer tinted fill (#f3ede5) + 1px `rgba(26,20,16,.06)` border or inset hairline so chips read as objects. `cards.css:420,566`, `App.css:245`. *(= D2 + chip primitive.)* `[src: diag]` `[rule: depth]` `[med]` `[S]`
- [ ] **Detail hero is a flat image + single linear scrim — no top vignette.** Layer a top vignette + richer bottom + slight radial focus so chrome stays legible and the hero gains depth. `App.css:490-522`. *(Josh: detail pages great — protect chrome legibility.)* `[src: diag]` `[rule: depth]` `[med]` `[S]`
- [ ] **Detail/subpage canvas misses the warm-surface ladder (all on flat --bg).** After widening --bg/--card, give detail's grouped sections (fact rows, About, mini-map) a `--card` panel + `--shadow-card` to float. `App.css:419,467,542`, `detail.css:63`. *(Mini-map removed under D8.)* `[src: diag]` `[rule: depth]` `[med]` `[M]`
- [ ] **Art-floor gradient tiles are vivid/saturated — fight the muted palette.** Real photos (imagery rule) first; where the gradient stays, drop S to ~40-50%, lift the dark stop, warm hues toward sunset. `cards.css:61-72`. `[src: diag]` `[rule: imagery]` `[med]` `[M]`
- [ ] **Primary CTAs are mostly flat fills — the glow/top-sheen recipe is on only 2 of ~8.** Promote `.featc-add`/`.loc-plan-cta` recipe to a shared `.btn-primary` (ambient glow + inset top-highlight + optional vertical gradient); apply to `.ep-save`, `.pf-ask-yes`, `.loc-plan-add`, `.flt-submit`, `.tune-cta`, `.ms-tab-sel`. `cards.css:357-363`, `locations.css:60-77`, `App.css:203-216`, `profile.css:299,377-383`. *(Josh: CTAs "look good" — this unifies the laggards.)* `[src: diag]` `[rule: depth]` `[med]` `[M]`
- [ ] **No-image FeaturedCard / art tiles / deck card are flat HSL blocks.** Deck card: warm gradient + inner top sheen + layered shadow (= D6/depth#6); medallion: inset top-highlight so it reads embossed. `cards.css:61-72,295-311`, `deck.css:56-60`. *(Josh: deck must match app.)* `[src: both]` `[rule: depth]` `[med]` `[M]`
- [ ] **Map water is cold sky-blue (#aadaff) — the one full-bleed cold surface.** MOOT under D8 (map parked/removed). If any residual basemap survives, warm the water + filter the tiles. `App.css:360`. `[src: diag]` `[rule: none]` `[med]` `[M]`
- [ ] **Sticky headers/search don't elevate on scroll.** Make lens/search row sticky with a transparent→elevated `.scrolled` transition (or at least a stronger resting search shadow). `App.css:35`, `locations.css:12-50`, `topnav.css:6-11`. `[src: diag]` `[rule: depth]` `[med]` `[M]`
- [ ] **Inline save-heart/Add pill hardcode rgba(187,87,25,…) instead of a token.** Add `--cta-rgb` and rewrite as `rgba(var(--cta-rgb),…)`. `cards.css:429,443`. *(Hygiene; supports D4 heart refine.)* `[src: diag]` `[rule: none]` `[low]` `[S]`
- [ ] **--muted is right at the AA edge (≈4.6:1) and needs per-spot patches.** Nudge one step darker (~#6b6157), re-verify on the newly-warmed --bg, retire the patches. `index.css:49`, `cards.css:259-262`. `[src: diag]` `[rule: none]` `[low]` `[S]`
- [ ] **App canvas is depth-uniform (--card vs --bg ~1-2%).** Same lever as color#1 — nudge --bg warmer/darker (~#faf7f2) so cards lift before shadow even applies. `index.css:51-53`. `[src: diag]` `[rule: depth]` `[low]` `[S]`

### (E) Iconography

*(Engineered stroke-icons live in the "Heart/flame/pin are raw emoji" item under (B); the related "icon discs / little circles look cheap and don't fade right" is Josh's framing of the dead-flat tiles (color/depth carousel + tab-bar items above) and the embossed-medallion fix in (D). No separate diagnostic lens — see cross-refs.)*

- [ ] ★ **"Icon discs / little circles look cheap and don't fade right; emojis look cheap → move to engineered stroke icons."** Two prongs: (1) swap emoji controls to the stroke-icon family (see (B) item); (2) give the medallion/disc surfaces real depth — embossed inset highlight + soft drop, not a flat painted disc (`.featc-medallion` `cards.css:295-311,309`, `.intent-tile` disc, profile icon disc `profile.css:123`). `[src: both]` `[rule: depth]` `[high]` `[M]`
- [ ] **Profile menu icon disc is 40px in denser rows.** Bump to 44px with taller rows (see Plan/Profile per-screen item). `profile.css:123`. `[src: diag]` `[rule: none]` `[low]` `[S]`

### (F) Motion

- [ ] **Lens-nav filter chips have transition wiring but NO press feedback.** Add `.lens-pill:active,.lens-more:active{transform:scale(0.96)}` and `.tn-item:active{transform:scale(0.97)}` (transitions + reduced-motion resets already exist). `topnav.css:30,66,146`. `[src: diag]` `[rule: motion]` `[high]` `[S]`
- [ ] **First data load hard-pops — no skeleton/shimmer.** Add a `.skel` shimmer keyframe; render 3 skeleton GemRows while `loading`; kill under reduced-motion. `App.jsx:455`, `HotView.jsx:41,470`, `LocationsView.jsx`. `[src: diag]` `[rule: motion]` `[high]` `[M]`
- [ ] ★ **Add-to-plan toast has NO entrance motion + the button never confirms success.** Give `.card-toast` the existing `toastIn` animation (unify with the detail toast); on success morph the Add button to "✓ Added" with a slotPop gold overshoot. `cards.css:676,435-454`. *(Josh: "the Add to plan pop-up animation is poor — redo it.")* `[src: both]` `[rule: motion]` `[high]` `[M]`
- [ ] **Primary bottom (detail) CTA is motion-dead.** Add `:active{transform:scale(0.985)}` + resting micro-elevation glow that tightens on press + success slotPop "✓ Added to your plan." `detail.css` action bar, `locations.css:422`. *(Josh: CTAs good — add the tactile answer.)* `[src: diag]` `[rule: motion]` `[high]` `[S]`
- [ ] **Tab switching is an instant jump, no cross-fade.** On TAP nav (not swipe), replay a fast content settle (`rise` 260ms, translateY 8px); keep scroll `behavior:'instant'`; respect reduced-motion. `nav.jsx:104-113`, `App.css:377`. `[src: diag]` `[rule: motion]` `[med]` `[M]`
- [ ] **Carousel reveals are a single block — no per-card stagger on horizontal rows.** Apply left-to-right `rowIn` stagger (`--i * 45ms`, capped ~6) to first-paint carousels (Tonight, Free, shelf). `cards.css:121,563,624`. `[src: diag]` `[rule: motion]` `[med]` `[M]`
- [ ] **Image fade-in is opacity-only over a #241c15 dark flash.** Add scale(1.04→1) + blur(8→0) settle on `.imgbox-img.on`; tint the placeholder to the card hue (no black flash). `cards.css:27-36,14`, `detail.css:497`. `[src: diag]` `[rule: motion]` `[med]` `[M]`
- [ ] **Swipe-deck under-cards snap-promote instead of rising as the top card leaves.** Choreograph under1 scale(.95)/translateY(16)→scale(1)/translateY(0) over the 400ms fly-out. `swipedeck.css:26-27`. *(= D6 deck polish.)* `[src: both]` `[rule: motion]` `[med]` `[M]`
- [ ] **Sheets spring open but slam closed (asymmetric easing).** Route every close through `var(--dur-fast) var(--ease-inout)`; fade scrim on the same duration. `topnav.css:106,157`, `weekend.css:74,78`, `filters.css`, `locations.css`. `[src: diag]` `[rule: motion]` `[low]` `[S]`

### (G) Per-screen

- [x] ★ **SETTINGS — remove "Customize interests" + "Manage your taste" rows; keep only the quick-primer entry; premium-ify the primer.** (= D7.) `SettingsPage.jsx:83-89,105-116`; `Primer.jsx`, `primer.css`. *(Josh D7.)* `[src: both]` `[rule: depth]` `[high]` `[S]`
- [x] ★ **MAP — park for v1: remove everywhere; "Open map" → Google Maps (= Directions); document for v2.** (= D8.) `LensNav.jsx:107-111`, `nav.jsx:365`, `App.jsx:345`, `MapView.jsx`/`map.css`/`leaflet-lazy.js`, `detail.css:63`. *(Josh D8.)* `[src: both]` `[rule: none]` `[high]` `[M]`
- [x] ★ **TINDER deck (dark) — match the app's premium visuals.** Deck surface gradient+sheen+shadow (depth#6), under-card rise (motion#8), align icons/type. `deck.css:56-60`, `swipedeck.css:26-27`, `lensdeck.css`. *(Josh D6.)* `[src: both]` `[rule: depth]` `[high]` `[M]`
- [x] **Filter chips (LensNav) fit ONE line on Events + Spots.** (= D5.) `topnav.css:12-17`, `LensNav.jsx:88-117`. *(Josh D5; eased by removing the Map pill.)* `[src: josh]` `[rule: none]` `[high]` `[S]`
- [ ] **QUICK ACTIONS tiles — cramped side spacing.** Widen tile/section side padding to the unified body gutter (= gutter fix). `App.css` quick-actions/intent-tile section, `cards.css:209-268`. *(Josh.)* `[src: josh]` `[rule: none]` `[med]` `[S]`
- [x] **PLAN / CALENDAR — agenda card on its own tighter padding (9px) + 14px gutter + 58px thumb + weaker one-layer shadow.** Align `.card` to canonical: padding `--sp-md`, body gutter, thumb 58→64px, `--shadow-card`. `cards.css:570-594,584`. *(Josh: "Plan/Calendar doesn't look right — same icon/circle/fade/text issues" → also gets the icon + depth fixes above.)* `[src: both]` `[rule: depth]` `[med]` `[S]`
- [x] **TASTE PROFILE + CUSTOMIZE INTERESTS — way off the mockups, borders too contrasty.** Soften borders to the new low-contrast spec (= D2), apply the type/eyebrow/depth tokens, route paddings through the scale. `tastepanel.css`, `interests.css`, `InterestEditor.jsx`, `TastePanel.jsx`. *(Josh; Interests screen also reached from Settings before D7 removal — keep its Profile entry.)* `[src: josh]` `[rule: depth]` `[med]` `[M]`
- [ ] **PROFILE menu rows denser than the ref's tall tiles.** Raise `.pf-row` padding to 15-16px vertical, icon disc 40→44px. `profile.css:104-113,123`. `[src: diag]` `[rule: none]` `[low]` `[S]`
- [x] **HEADER pattern — app uses a big left-aligned title; refs use a centered nav-bar + muted subtitle + right action.** Decide per typo/spacing findings; at minimum align header h-padding to the body gutter (`.home-head`/`.loc-head` 18→20px, `.pg-head`/`.pg-band` 14→20px) so title shares one left ruler. Adopt Title Case for page titles (refs use Title Case). `App.css:35,435,453`, `locations.css:13`. *(FLOWS §1.)* `[src: both]` `[rule: none]` `[med]` `[S]`
- [x] **BUBBLEPAGE chrome — hue-gradient + emoji title vs the refs' clean white centered header.** Move toward the clean white centered header; drop/soften the hue gradient + emoji title to match the page-header pattern decision above. `BubblePage.jsx`, `PlaceBubblePage.jsx`, `bubble.css`. *(FLOWS §1.)* `[src: diag]` `[rule: none]` `[med]` `[M]`

### (H) Spacing & rhythm (system-wide; supports D1/D2)

- [ ] **Primary list cards cramped at 10px padding (#1 cheap tell).** Bump `.gem`/`.spotcard--row` padding 10→`--sp-md` (16px), image-to-body gap 12→14px. `cards.css:378,642`. *(Quick Win; supports D1.)* `[src: diag]` `[rule: none]` `[high]` `[S]`
- [ ] **Page gutter silently flips 20→16px mid-scroll.** Unify on one `--gutter` (~20px): move `.feed--cards` (`cards.css:617`) + `.tune` (`App.css:154`) to 20px. `[src: diag]` `[rule: none]` `[high]` `[S]`
- [ ] **The --sp scale is defined but never used (off-grid 9/10/11/13/15px everywhere).** Snap card paddings/gaps to tokens; add `--sp-2xs:4`. `index.css:73-78`, `cards.css`/`profile.css` paddings. `[src: diag]` `[rule: depth]` `[high]` `[M]`
- [ ] **Calendar agenda card on its own tighter padding + gutter.** (Folded into the Plan/Calendar per-screen item.) `cards.css:570-594`. `[src: diag]` `[rule: none]` `[med]` `[S]`
- [ ] **Section header sits too close to its first card (14px ≈ inter-card gap).** Raise `.sec-head` margin-bottom 14→16-20px; optionally `.sec` margin-top 36→32px. `App.css:294,146`. `[src: diag]` `[rule: none]` `[med]` `[S]`
- [ ] **Chip clusters/metas use sub-grid micro-gaps (1/3/5/6px).** Standardize: meta line spacing 4px, chip-row margin-top 8px, chip gap 6px everywhere. `cards.css:419,417,411,327,467`. `[src: diag]` `[rule: none]` `[med]` `[M]`
- [x] **Subpage/header top areas use 14/18px gutter vs 20px body.** Align `.home-head`/`.loc-head` 18→20, `.pg-head`/`.pg-band` 14→20. `App.css:435,453,35`, `locations.css:13`. *(= Header item.)* `[src: diag]` `[rule: none]` `[med]` `[S]`

---

## §2 — NEW CONTRACTS (post-bending)

> **Promoted to the canon → [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (Stage A6).** This section is the historical source text; the durable design-system authority is that doc.

The 4 rules unlocked. Re-codified policy; honesty bar unchanged (nothing fake presented as real).

### IMAGERY policy
- **Real/curated photos are the default everywhere a card or hero shows a place or event.** What changed: the old "art-floor everywhere for places" stance is retired — the data proves it's the *default*, not a fallback (places 26/2163 photo, cafes 0/332, beaches 0/22; events 1447/1536 ≈ 94%).
- **Pipeline (place-imagery gap — the single biggest lever):** (1) Wikimedia Commons P18 + category/Geograph/Mapillary for parks/beaches/trails/piers; (2) curated stock for cafes (worst gap); (3) a shared 8-12-shot curated category set per `placeType`, keyed by `placeType` + stable id-hash so adjacent places differ. **Target ≥80% place coverage before v1; heroes get budget first.**
- **Art-floor stays only as a true fallback** (sub-20% of places, 5.8% of events) and must be *upgraded*: muted/desaturated hue (S ~40-50%), warm-shifted, paper texture, no giant sticker emoji — an intentional "kraft" empty state, never a "missing image."
- **Honesty:** curated category/mood images are clearly generic (same honesty bar the emoji floor met); never imply a stock photo is *this* venue's own.

### DEPTH policy (elevation scale)
- **3-step + sheet scale** (replaces the single flat `--shadow-card`): `--shadow-1` rows/tiles (`.gem`, `.pf-row`, carousel image tiles) · `--shadow-2` = current `--shadow-card` (contained cards, `.intent-tile`, `.spotcard--row`) · `--shadow-3` featured/hero (`.featc`, detail panels) · `--shadow-sheet` (the `0 -10px 40px`).
- **Figure/ground:** widen `--bg` vs `--card` to a real step so cards lift even before shadow. What changed: depth was a real but *single-token* investment applied flatly and skipped on the highest-traffic surfaces (carousel tiles, tab bar, hero) — now it's a ranked system applied to *every floating surface*.
- **Press answer:** scale + shadow tighten on `:active` on all main cards/CTAs (was scale-only). Tab bar floats (warm glass + upward lift). All gated under `prefers-reduced-motion`.

### MOTION policy
- **Tokens stay:** `--dur-micro/fast/base/emphasis` + Apple curve (`--ease-out`/`--ease-emphasis`/`--ease-inout`). Reduced-motion always resets.
- **Press feedback is universal** — every interactive surface answers the finger (lens pills 0.96, tn-items 0.97, cards 0.985). What changed: motion was good but *patchy*; it's now required on the most-tapped controls (filters), the conversion moments (Add toast + button morph, bottom CTA), and reveals (skeleton shimmer on first load, left-to-right carousel stagger, image scale/blur-up settle, tab content settle on tap).
- **Sheets:** symmetric easing — opens on `--ease-emphasis`, closes on `--ease-inout` (no more slam-close). Durations: micro press ~`--dur-micro`, toasts/settles `--dur-fast`, image settle `--dur-emphasis`, sheet open 280ms / close `--dur-fast`.
- **Reward grammar:** reuse `savePop`/`slotPop` gold overshoots only at sanctioned beats (save, add-success, deck finish).

### CONTENT policy (richer sample content)
- **Richer content allowed at designed dead-ends and editorial surfaces:** end-of-feed/empty states get a real end-cap (glyph + warm one-liner + secondary action) instead of one gray sentence; Guides become photo-backed editorial cards with a "GUIDE" overline.
- **Restraint elsewhere:** card meta still capped to a tight 3-line rhythm (title · one meta line · one chip row) and ONE accent emphasis per card — richer ≠ denser. Honesty unchanged: sample/seed content is never dressed up as live data.

---

## §3 — QUICK WINS (highest impact × lowest effort — pull these first)

A fast, visible lift; almost all are find-and-replace / token edits.

1. **Tabular numerals** — `.num` utility on all stat/time/distance/count strings. `[high][S]` (typo#2)
2. **Card padding 10→16px** on `.gem`/`.spotcard--row` (+ image gap 12→14). `[high][S]` (spacing#1; supports D1)
3. **Unify the page gutter** — `.feed--cards` + `.tune` → 20px via one `--gutter` token. `[high][S]` (spacing#2)
4. **Warm + darken --bg one step** (~#faf7f2/#f6f2ec) so every card lifts. `[high][S]` (color#1)
5. **Warm the tab bar + inactive tabs** (cream glass + warm-gray icons) and add the upward float shadow. `[high][S]` (color#3 + depth#2)
6. **Carousel tiles get a soft drop shadow** (no longer dead-flat). `[high][S]` (depth#1)
7. **Lens-pill / tn-item press feedback** — three missing `:active{scale}` rules. `[high][S]` (motion#1)
8. **Section title → 22/800** so it outranks card titles. `[high][S]` (typo#3)
9. **(bonus) Accent restraint** — demote editorial micro-labels to muted (also serves D2). `[high][M]` (color#4)
10. **(bonus) Chip primitive** — one outlined-pill `.chip` (serves D2 + consistency). `[high][M]` (components#3)
