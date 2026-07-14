# v2 spec — Premium UI (the Feel Substrate)

> **Status: spec** (draft for Josh/Charles review). Source: 5-scout research fleet 2026-07-06
> (repo gap audit · V2 commitments audit · benchmark apps · craft literature · platform capability map)
> + V2_VISION rulings #7 and #8. Home: [../../BACKLOG.md](../../BACKLOG.md) (v2). V1 is shipped;
> bounded honesty/accessibility fixes may land during post-ship hardening, while the proposed Feel
> Substrate itself still requires §7.0's threshold ruling.
> Honesty contracts bind everything below: no fake data · never-hide · taste reorders, never filters ·
> calm-not-shouty · zero backend v2.0 · the one-celebration cap (ruling #7) · the Everywhere-mandate
> honesty tiers (ruling #8).

---

## 0. Thesis — what "premium" means HERE

Premium for Wuzup is not decoration; it is **instant response + physical continuity + ruthless
restraint**, applied by one hand. The benchmark apps prove each piece: **Family** shows that craft is a
budget, not a sprinkle — its "delight-impact curve" spends intensity only on rare moments
(benji.org/family-values); **Flighty** shows premium is information hierarchy and shining "when things
go awry," not effects (developer.apple.com/news/?id=970ncww4); **Linear** shows one type family with two
optical voices plus raw speed reads as luxury (linear.app/now/how-we-redesigned-the-linear-ui);
**Headspace** shows motion *tempo* is a brand decision — calm apps decelerate
(blakecrosley.com/guides/design/headspace); **Amie/Vaul** show a web app can carry native-grade sheet
and spring physics (emilkowal.ski/ui/building-a-drawer-component). Wuzup's version: a small tokenized
motion vocabulary, touch-down-instant feedback, Aurora as a zero-spinner materials system no competitor
can copy without faking it, and exactly one sanctioned celebration. The exit test is unchanged from the
takeover mandate: **the app reads as ONE designed app** — and the stranger test's 30-second demo lands
because the presentation is as honest and composed as the data under it.

## 1. Position in the plan — substrate, not feature

"Make the UI premium" does not COMPOSE/DECIDE/KEEP a day, and ruling #1 makes the admission test
binding on every *feature*, no exceptions (V2_VISION.md §1). The precedent is **Layer Zero**: this
workstream enters the same way — **a named cross-cutting substrate, sibling to Layer Zero**. But Layer
Zero is IN the ratified plan of record and this is an analogy, not a ruling — so the exemption is
**asked, not assumed**: open decision #0 (§7) puts the threshold question to Josh before anything
builds. Layer Zero is substrate for the plumbing; the Feel Substrate is substrate for the eyes. Its *clients* are the
admitted features: composer slots + why-lines, the Weekend Brief, the Tonight Board, the Match Deck
reveal, Pass-the-Day plan pages, Day Cards, Passport stamps, Honest Sets, the Vault.

**Sequencing:** rides the dependency gate (V2_VISION.md §5 — data quality is layer one, always; "a
beautiful receipt over a stale duplicate is worse than no receipt"). Builds interleave with Layer Zero
because two items are structurally coupled: the fragment-URL router replaces nav.jsx's `{wzDepth}`
"URL never changes" history scheme (nav.jsx:402-466), so **navigation feel (§3.S1) and the fragment
router must be designed together or the back-button system gets built twice**; and the service worker
(§3.S5) is Layer Zero item 5's PWA substrate wearing its perceived-performance hat. Concretely:
[quality-engine.md](quality-engine.md) is this workstream's data dependency — every defect-amplifying
surface (S9 receipts chrome, composer-slot why-lines, the Coverage-Card evolution) renders that spec's
emitted fields (its §7 Q→app contract) and ships no earlier than they exist. The MUST tier
(S1/S2/S3.1/S5/S8) has no quality-engine dependency and may run parallel.

**Stale-baseline corrections (do NOT re-plan these — all shipped on main):** a complete AA-computed
system-following warm-dark token ladder (index.css:236-331, PR #10) — Dusk v2.1 is re-scoped in §3.S7;
motion duration/easing tokens (index.css:155-163); universal `.pressable` press feedback; the 5-step
warm elevation scale; deck physics with real springs + momentum exits (deckgesture.js); hardware-back
history integration; symmetric sheets with focus traps; card blur-up + shimmer; the VT card→detail
morph; installable PWA. The gap is **missing connective subsystems + uneven application**, not a
missing design system (scout A1 §1-3).

## 2. Governance — two normativity tiers, Charles holds the pen

Per ruling #7's mechanism ("default direction he can override during V2 design"; "none of these block
any engineering"), every line of this spec is one of two tiers:

| Tier | Binding on | Examples |
|---|---|---|
| **HARD** (engineering law, not Charles-overridable) | every build | token discipline (Sunlit only; reserved `--hot`/`--reward`/`--cta`), a11y acceptance rows, payload/boot budgets, honesty/never-hide/calm-not-shouty, the one-celebration cap, `prefers-reduced-motion` resets, compositor-first motion (§3.S8), the never-animate list |
| **⚑ Charles** (buildable default shipped; he refines in place) | aesthetics | easing feel-tuning, Aurora extensions & stamp art, empty-state art, glyph art, ceremony art direction, Dusk ember hues, display-type personality, copy voice |

**Ship-with-defaults doctrine:** every ⚑ item carries a buildable default in this spec — engineering
never waits on art. Anything that would contradict a lock (third Home tenant, second celebration,
non-Sunlit palette before Dusk, un-parking the map, reopening CARD_LOCK/D1-D8) is absent here by
design; if it ever appears in a build, it requires an explicit ruling first.

**Authority model:** every primitive minted below is specced as a **future DESIGN_SYSTEM.md section**
with values destined for `app/src/index.css :root` — extend the canon, never fork it
(DESIGN_SYSTEM.md:4-5 authority split).

## 3. The sub-systems — a designed whole

The order below is the dependency order: S1/S2/S8 are the grammar everything else speaks.

### S1 — The motion language (tokens + choreography + interruption rules)

Corrected grounding (verified against app/src): 86 `transition:` declarations, of which **62 already
speak the shipped tokens** (`var(--dur-*/--ease-*)`); exactly **one** rogue bezier survives
(App.css:414 `.tab-ic`); the three canon easings `--ease-out`/`--ease-emphasis`/`--ease-inout`
(index.css:161-163) carry ~70 uses. So the repo has a young language with ~24 stragglers, not motion
incidents — the fix is a *reconciliation + straggler sweep*, the small cousin of Stage C4, not an
86-wide migration.

**Easing tokens (5, no more)** — new `app/src/styles/motion.css` + DESIGN_SYSTEM §MOTION.
**Reconciliation (HARD, same rule the durations get):** the 3 shipped easings map INTO this family,
they do not coexist with it — `--ease-emphasis`→`--ease-enter` (or is ratified as the enter curve),
`--ease-out`→`--ease-move`, `--ease-inout`→`--ease-loop`'s utility twin; each mapping lands as an
alias-then-retire so no build breaks. Extend the canon, never fork it (§2).

```css
--ease-surface: cubic-bezier(0.32, 0.72, 0, 1); /* THE signature: sheets, detail, large surfaces (Vaul/iOS, 500ms) */
--ease-enter:   cubic-bezier(0.05, 0.7, 0.1, 1); /* M3 emphasized-decelerate */
--ease-exit:    cubic-bezier(0.3, 0, 0.8, 0.15); /* M3 emphasized-accelerate — exits ≈ ⅔ of enters */
--ease-move:    cubic-bezier(0.2, 0, 0, 1);      /* M3 standard, on-screen moves */
--ease-loop:    ease-in-out;                     /* shimmer/breathing only */
```

**Duration tokens (6):** `--dur-instant 0` · `--dur-press 120` · `--dur-quick 200` (the interaction
ceiling, per interfaces.rauno.me) · `--dur-move 300` · `--dur-sheet 500` · `--dur-reveal 700` (rationed
by the delight budget). **Two named tempos, nothing between:** utility ≤300ms ease-out
(emilkowal.ski/ui/great-animations) and ceremony 400-800ms decelerate (Headspace). Reconcile with the
existing `--dur-micro`→`--dur-page` ladder (index.css:155-163) — extend, don't duplicate.

**Spring tokens (3, JS, deck-family only):** `spring-settle` (response .30s / ζ 1.0),
`spring-carry` (.30s / ζ .8, momentum-rewarding), `spring-play` (.20s / ζ .55 — **one bounce, the
sanctioned moments only**). Designer units per WWDC18 §803; Gitter's conversions
(`stiffness=(2π/response)²`). Additionally 2-3 **build-time-generated CSS `linear()` spring curves**
committed as tokens (Baseline since Dec 2023; the "AI at build time, static at runtime" pattern applied
to easing — scout A5 §3).

**Choreography rules (HARD):** a card and its content travel as one composited surface; the world
reacts continuously with drag progress (background dim/scale tied to sheet drag, Vaul pattern);
origin-aware — detail grows from the tapped card; exits reverse entry paths (Apple "symmetric paths");
directional slides match spatial position (Family's directional tabs).

**Interruption rules (HARD):** every animation cancellable by the next input — pointer events never
disabled mid-transition; gesture-attached elements track 1:1 ("the moment touch and content stop
tracking one-to-one, we immediately notice" — asciiwwdc.com/2018/sessions/803); release momentum is
projected to pick destinations; destructive actions commit only on gesture END; ~10pt hysteresis before
a gesture claims direction (the deck must not steal vertical scrolls).

**The never-animate list (HARD, brand law):** next-card browse step · filter chips · tab content swap
(≤150/75ms fade-through max) · all keyboard-initiated actions · text being read (zero layout shift) ·
anything during scroll; loops pause offscreen. `prefers-reduced-motion` collapses every duration token
to 0 except ≤150ms opacity crossfades. This list is calm-not-shouty made enforceable.

**The three connective holes (scout A1 §2.1)** this language must close:
1. **List reorder/swap choreography** — UI_SPEC §2's "never instant-teleport a reorder" is spec'd,
   built nowhere (HotView.jsx:445-459 teleports). Reuse nav.jsx's feature-detected
   `startViewTransition` seam for FLIP swaps.
2. **Subpage-REPLACE transition** — Settings→Interests etc. hard-pop inside the mounted shell
   (nav.jsx:225-231). One small directional cross-fade/slide, tokenized.
3. **One sticky/condensing context-bar pattern** — no scroll-linked context exists anywhere; one
   pattern (condensing detail title bar / pinned LensNav), scroll-driven-animation where supported,
   static where not (§3.S8 tiering).

**Enforcement:** migrate the ~24 untokenized stragglers (App.css:414's rogue bezier first); once the
alias-then-retire reconciliation lands, smoke-grep bans raw `cubic-bezier(` outside motion.css (the
half-pixel-tripwire pattern, again) — the grep ships WITH the reconciliation, not before it, so the
index.css canon never trips its own guard.

### S2 — Touch & tap feedback doctrine

The web defaults to hover-first, touch-up, delayed. Premium is **touch-down-triggered, hover-gated,
delay-free** (Gitter's calculator-button pattern). One global base pass, cheap and app-wide:

- Respond on pointer-down; `.pressable` already exists — audit for touch-up stragglers; menus open on
  `mousedown` (interfaces.rauno.me).
- Press = scale (~0.96-0.98 proportional to size) + release a hair slower than press — the web's
  transliterated impact haptic.
- Kill the tells: `-webkit-tap-highlight-color: transparent` + own `:active` everywhere ·
  `touch-action: manipulation` global · `user-select: none` on chrome, never content · all hover
  styles inside `@media (hover: hover)` · zero dead zones between list targets (padding, not margin) ·
  inputs ≥16px font.
- `overscroll-behavior: contain` on every sheet/overlay (no scroll chaining, no accidental
  pull-to-refresh — developer.chrome.com/blog/overscroll-behavior).
- **`:focus-visible` token**: one box-shadow ring (2px `--accent`, offset 2, respects radius) replacing
  browser-default rings app-wide (today only 4 custom focus sites exist — scout A1 §2.11).
- **Gestures grow from `deckgesture.js`, not a library** (it is pure, Node-simmable, proven): (a)
  **sheet drag-to-dismiss + grab handles** on all bottom sheets — 1:1 translateY, flick-velocity
  dismissal, damped overdrag, `shouldDrag` only at scroll-top; (b) **back, gesture-shaped, without
  fighting the OS**: no custom bezel recognizer — on installed iOS the OS edge-swipe is undisableable
  and already performs history.back (S8's own hygiene fact, w3c/manifest#1041), which nav.jsx:402-466's
  layer-per-history-entry scheme already maps to a sane layer close; a second edge recognizer would
  never fire or double-fire, and Android's system back makes it redundant there. The deliverables are:
  verify every layer lands sanely under the OS gesture (extend the nav.jsx sim), keep the always-present
  in-app back affordance (S8), and — if a dismiss gesture is still wanted on detail — an in-surface
  drag (non-bezel-anchored, e.g. drag the hero/sheet body) that cannot contest the bezel. These close
  the two loudest remaining "webpage tells" (scout A1 §2.3).
- **Haptics posture (needs the ruling — §7):** web haptics on iOS do not exist (WebKit never
  shipped `navigator.vibrate`; the `<input switch>` hack broke in iOS 26.5 — scout A5 §9). Default
  position: **no vibration in v2.0** (UI sound is not an open question — it is struck outright in
  §3.S8); document the visual transliteration
  (squash-release=impact, one-frame tick=selection, settle-with-overshoot=success) so a future native
  wrapper inherits a ready haptic map. "Buzzy haptics or no haptics — choose no haptics" (Android
  haptics principles).

### S3 — Materials, depth & texture — where Aurora extends

The elevation/glass/grain system is complete (scout A1 §1); this subsystem *extends* Aurora from art
floor to materials system:

1. **Aurora-as-placeholder on every slot awaiting a real photo (HARD default):** the seeded Aurora
   mesh renders instantly; the real photo cross-fades in (~200ms), layout-stable. Kills the last
   spinner-class surface and turns the honesty-contract art floor into the loading system — the one
   premium move none of the benchmarks can copy (scout A3 §2.6). Includes killing DetailPage.jsx:413's
   hard-coded `#241c15` dark hero slab (contradicts the cards' warm-cream shimmer language).
   **Scope boundary (HARD):** *permanently photoless THUMBNAIL slots are governed by CARD_LOCK's
   pending medallion amendment (CARD_LOCK.md:17-20, held open at §7.8)* — its re-derivation found an
   aurora blob at thumbnail density reads as a broken photo, not designed art. There, Aurora is a
   loading state only, never a resting state; the resting state is whatever Josh ratifies (medallion
   or revert). Hero/detail-density photoless surfaces keep the Aurora floor.
2. **Content-tinted chrome (⚑ Charles):** detail-view chrome tinted from the place's Aurora/photo
   palette — the Dia "extend content color into the chrome" move. Buildable default: derive a 6%-alpha
   wash from the existing artseed hue.
3. **Aurora-as-ink stamps (⚑ Charles, ruled direction):** Passport stamps derive from artseed hues,
   monochrome ink treatment (ruling #7). This workstream owns the *geometry/rendering substrate*:
   the stamp component renders **at first paint from the artseed key** (the same pure-CSS/SVG
   derivation path as auroraVars) — NOT build-time bitmaps, which would add per-city payload
   (~450 places for Tampa) against the ≤4MB/~800KB gz budget for zero benefit. Charles owns the marks.
4. **Aurora discipline (HARD):** Aurora stays **pure CSS** — that is a design property, not an
   accident (artseed.js:5-9: pure/no-React so the smoke harness asserts determinism, and the
   card→detail VT morph stays continuous). There are no canvas loops, bitmaps, or rAF in this system
   and this spec adds none. Any future *animated* Aurora variant (a living hero, a breathing mesh) is
   **new scoped work requiring its own proposal** with boot-budget and jank lines — it does not ride
   this spec. Under `prefers-reduced-motion`, any Aurora shimmer/breathing (CSS-level) freezes to its
   static frame (scout A5 §8).
5. **Glass budget (HARD):** ≤2-3 small fixed `backdrop-filter` surfaces on screen (tab bar, condensed
   context bar); never animate blur radius; never per-card in a scroller; keep `-webkit-` prefix for
   iOS 17.
6. **A designed empty/sparse primitive (⚑ Charles art, HARD structure):** ONE component (Aurora-language
   mark + title + body + optional CTA) replacing the bare `.empty` paragraph at all ~8 sites
   (App.css:389-390), doubling as **the sparse-city pattern library** Layer Zero item 7 mandates — a
   2-event Tonight must look designed, not broken. Honest floors are a binding deliverable, not polish.

### S4 — Typography refinement

- **Inter variable with `opsz`** (rides the already-approved self-host): single latin-subset
  InterVariable.woff2, `<link rel=preload>`, `font-display: swap`, `size-adjust`/`ascent-override`
  metric fallback to kill CLS (web.dev/articles/css-size-adjust). Display optical cut for headings,
  text cut for body — the Linear one-family-two-voices move.
- **The display tier** — everything ≥16px is today a deliberate literal (17/22/26/28/32 + a 900-weight
  deck kicker off the ladder — scout A1 §2.5). Mint display tokens (stepped now, fluid-ready), the
  explicit **prerequisite for v2.1 big-canvas layouts**. Retire-or-ratify the 900 kicker (⚑ Charles).
- **Free wins, ship immediately:** `text-wrap: balance` on headings; `text-wrap: pretty` on prose
  (verified absent; pure enhancement — Firefox just wraps normally, scout A5 §6). Tabular numerals
  are **already shipped** (PREMIUM A1's `.num` utility + standing numeric selectors,
  index.css:335-343) — the remaining work is a *coverage audit* extending `.num` to any changing
  count/time the A1 pass missed, not a re-plan.
- Half-pixel ban and the 14px exception stand unchanged (DESIGN_SYSTEM.md type scale).

### S5 — Loading, skeleton & perceived-performance choreography

Target: a genuinely **zero-spinner app** whose only visible waits are shaped like the content.

- **The loading/empty/error triad as primitives:** (a) a boot skeleton replacing the bare
  "Loading Wuzup…" text line (App.jsx:451) — **data-shape-agnostic by design** (app chrome + a few
  generic rows, or keyed to the last-known snapshot shape), because a rich Tampa-shaped shimmer on a
  2-event SF Home would be loading-as-dishonesty; (b) SkeletonRow coverage on ALL async surfaces (today 2 of
  ~6 — scout A1 §2.2); (c) **error/offline visually distinct from empty** — today a failed boot fetch
  shows the same "Nothing here right now" as a genuinely empty dataset (App.jsx:140-147 →
  HotView.jsx:462), which is an honesty defect, not just a polish gap. Flighty's rule: shine when
  things go awry.
- **The honest offline/freshness stamp** ("Offline · showing Friday 4:53 PM data") systematized across
  V2 surfaces — the pattern Layer Zero item 5 already names.
- **Service worker + resource hints** (shared with Layer Zero item 5): offline snapshot + instant warm
  boot; `<link rel=preload>` for events.json + the Inter woff2; `modulepreload` for chunks;
  `pointerdown` data warming (Speculation Rules are Chromium-only and N/A for the SPA — scout A5 §13).
  The single biggest perceived-quality-per-hour lever left (scout A1 §2.9).
- **List performance:** `content-visibility: auto` + `contain-intrinsic-size` on below-fold cards
  (Safari 18+, progressive by nature); `contain: layout paint` insurance.
- Content skeletons match the layout system (the boot skeleton, above, is the deliberate exception);
  slow left-to-right shimmer — the direction/tempo choice the perceived-performance literature favors
  (scout A3 §2.6; no quantified claim — the skeleton-perception research is contested).

### S6 — Ceremony (the delight budget, spent deliberately)

Policy (HARD): **Family's delight-impact curve is the arbitration rule** for any proposed animation —
intensity rises only as frequency falls. ~95% of Wuzup motion is productive-register (Carbon's split).
The ledger:

| Moment | Budget | Spec |
|---|---|---|
| **Match Deck overlap reveal** | THE one sanctioned big celebration (ruling #7, locked) | ceremony-tempo (400-800ms decel) + `spring-play`; art direction ⚑ Charles. "Big" must still live inside calm-not-shouty — designed, not confetti-by-default |
| **Install Ceremony** | once, after the first real value beat (timing ruled; form open ⚑ Charles) | a designed sheet, not a nag; ceremony tempo |
| **Plan finish beat** | KEEP (Josh ruling 2026-07-01); the violet one-shot stands | existing reward grammar unchanged; migrating its curve onto `spring-play` is ⚑ Charles feel-tuning of the same beat, not a license to enlarge it |
| **Kind Milestones** | restrained, on the existing `--reward` token only | `savePop`/`slotPop` grammar; never stacked with another beat |
| Everything else | productive register, ≤200ms | no exceptions without a ruling |

Compose-movement corollary (⚑ Charles direction): building your Saturday should *feel* fun the way
Partiful's invite editor does — carried by responsiveness and slot choreography, not particles.

### S7 — Dusk v2.1, re-scoped

The task's original scope is half-pre-empted: the token VALUES shipped — a complete AA-computed
system-following warm-dark ladder on main (index.css:236-331, PR #10, dual theme-color metas), with
its own ⚑ flags outstanding (toggle = Josh call, deck-contrast punch item). Ruling #7's *ember
identity* half has NOT shipped — that is exactly the remaining v2.1 scope, and only this:
1. **In-app toggle** (storage + Settings row + the Josh product call — flagged in code as "not v1").
2. **Charles's ember/taste pass** (⚑ — warm charcoal + ember identity on top of the shipped ladder).
3. **Deck-contrast punch item** — the decks' "different world" contrast softens on a dark app (the ⚑
   already riding in code).
4. **Dark QA** of the ~83 ⚑-flagged sites + dark variants of every primitive this spec mints (empty
   states, skeletons, receipts chrome).

### S8 — The platform substrate (the honest capability table)

**Doctrine (HARD): compositor-first.** Native scroll + scroll-snap for physics; CSS transform/opacity
with `linear()` spring tokens; `@starting-style` + `transition-behavior: allow-discrete` for
enter/exit; View Transitions for navigation. **rAF-loop animation libraries are banned from
feel-critical paths** — iOS caps rAF at 60fps on ProMotion with no programmatic opt-out, while
compositor animation runs at full refresh (scout A5 §10). Dependency posture: **zero new runtime
animation libraries in v2.0** (see §7 open decision for the one candidate exception).

| Capability | iOS floor | Chromium | Firefox | Tier | Use |
|---|---|---|---|---|---|
| Same-doc View Transitions | 18.0 | 111 | 144 | **1** | THE navigation primitive; feature-detected; instant-swap fallback; reduced-motion-guarded |
| `linear()` spring easing | 17.2 | 113 | 112 | **1** | build-time-generated spring tokens |
| `@starting-style` / `transition-behavior` | 17.4-17.5 | 117 | 129 | **1** | CSS enter/exit; no-anim fallback |
| Popover API | 17 | 114 | 125 | **1** | top-layer + light dismiss for free |
| `text-wrap: balance` · variable fonts · `overscroll-behavior` · scroll-snap · `content-visibility` · safe-area env() | ≤18 | ✓ | ✓ | **1** | ship as baseline |
| `backdrop-filter` (small fixed chrome) | 9 (`-webkit-`) | ✓ | ✓ | **1** | inside the glass budget only |
| Scroll-driven animations | **26** | 115 | flagged | **2** | decoration only; static state must look designed |
| CSS anchor positioning | **26** | 125 | 147 | **2** | `@supports`-guarded until the iOS 26 floor covers the fleet (~2027) |
| `navigator.vibrate` | **never** | Android only | — | **2/3** | Android-only garnish at most, behind capability check |
| 120Hz JS/rAF animation | user-flag only | n/a | n/a | **3** | do not build on; compositor-first is the workaround |
| COLRv1 color fonts | **never** | 98 | 107 | **3** | skip; Aurora covers decorative color |
| Speculative prefetch/prerender | flag, off | 109+ | — | **3 on iOS** | N/A for SPA; preload + pointerdown warming instead |

**Struck from every V2 draft (HARD):** iOS haptics in any phrasing · 120Hz JS animation · color-font
branding · speculative prerender on iOS · Lava/3D icon pipelines · Lottie character animation · UI
sound. None survive an honesty review (scouts A3 §3, A5 blunt list).

**Standalone-iOS hygiene block (HARD, mandatory):** `viewport-fit=cover` + `env(safe-area-inset)`
padding · `black-translucent` status bar · `@media (display-mode: standalone)` styling · **history
state always in lockstep with UI** (the OS edge-swipe gesture cannot be disabled — w3c/manifest#1041 —
and must always land somewhere sane) · explicit in-app back affordance always present. PWA identity
assets (manifest icons, splash) are claimed here (⚑ Charles art, buildable Aurora-derived default).

### S9 — Claimed V2 design territory (named-but-undrawn surfaces)

This workstream owns the shared primitives; the movements own their features. Claimed by name, in
priority order (scout A2 §4): **the Receipts-Everywhere primitive's visual definition** (the most
load-bearing unclaimed artifact in V2 — how a claim→source trace renders on a card, why-line, stamp,
Tonight row; named twice in the plan of record, V2_VISION.md:41+150, drawn nowhere) · composer slot
anatomy (per-slot re-roll, the honest "not enough data yet" slot, visible never-hide candidate lists) ·
the Plan-tab concierge room layout · Home's two tenant layouts (inside the hard cap) · the Keep visual
system substrate (Day Card grid, stamp geometry, share-card templates — Sunlit-constrained, alt-text
mandatory) · fragment-era navigation grammar (route transitions, deep-link landing states, back
physics — **including the city switch**, which ruling #8 specs as set-fragment + reload
(V2_VISION.md §10.3.6): a full-page reload is the loudest possible "feels like a website" moment under
§4.1, so this grammar must design the reload seam — pre-reload hold frame, post-reload landing state,
the boot skeleton as the bridge) · **ruling #8's honesty-tier surfaces**: the T0 "Not here yet"
honest-absence page (V2_VISION.md §10.2 — structurally the S3.6 empty/sparse primitive wearing its
biggest job) and the T3 thin-city layout where **the Coverage Card leads the experience** · the
iconography endgame (~8 control glyphs ✕→↗＋⋯, SaveHeart into the two text-heart Save buttons at
cards.jsx:376 + DetailPage.jsx:691, amenity emoji/stroke unification, ratified exempt list — one
mechanical sweep). **The Coverage Card:** v1/Stage D owns the shipped card (STAGE_D.md:87-90), but
ruling #8.8 promotes it to "the binding honesty surface of the whole expansion" — this spec claims its
**V2/tier-era visual evolution** as receipts-chrome territory (it is a receipt about a whole city).
**Explicitly NOT claimed:** the deck *reskin* content (claimed by smart-engine.md:26-27 — this spec
owns the deck's motion/gesture substrate; the smart-engine spec should carry a cross-reference
amendment when promoted) · guides placement (guides-and-rankings.md:27). **Sparse-city behavior of
this section's own primitives (Layer Zero item 7, no exceptions):** receipts chrome degrades to fewer,
plainer receipts — never a fabricated-looking dense trace over thin data; a composer candidate list
whose honest answer is "not enough data yet" renders the S3.6 sparse primitive with the Coverage Card
as its receipt, not an empty scroller.

## 4. Acceptance bar

1. **The stranger test, extended:** the 30-second demo lands *and* — new clause — a stranger handed the
   installed app for 60 seconds cannot name a moment it "feels like a website" (no gray tap-flash, no
   teleporting lists, no spinner, no default focus ring, no hard-pop navigation).
2. **"Reads as ONE designed app"** (the takeover exit test): one easing family, one loading language,
   one icon language, one celebration.
3. **Layer Zero's rows restated as this spec's own acceptance:** every surface ships its sparse-city
   spec · a11y is an acceptance gate (deck keyboard/switch path, focus order, share-card alt text) ·
   per-city payload ≤4MB raw/~800KB gz + the mid-Android boot budget (motion adds no jank inside it).
4. **Smoke guards:** grep-ban raw `cubic-bezier(` outside motion.css · reduced-motion collapses all
   tokens · no new runtime animation-loop dependency · glass budget respected · half-pixel ban stands.
5. **SIMULATE behavioral claims** (the Stage B lesson): deck/gesture/offline claims get Node-simmed or
   scripted checks, not live "it works."

## 5. Release shape

v2.0 vs v2.1 splits by release; **inside v2.0, MUST vs TRAILING splits by sequencing** — Josh-time is
the scarcest currency (V2_VISION §5) and this substrate must interleave with Layer Zero and the Reach
track, not displace them. MUST = the grammar the admitted features build ON (blocks other work if
late); TRAILING = lands any time before the v2.0 acceptance bar is graded. Effort figures are
order-of-magnitude builder-days for kickoff sequencing, not commitments.

| Lands | Contents |
|---|---|
| **v2.0 MUST** (~10-15 builder-days) | S1 tokens + reconciliation + ~24-straggler sweep + the three connective holes (~4d) · S2 base touch pass + focus token (~2d) · S3.1 Aurora-placeholder scope + S3.6 empty/sparse primitive (~3d) · S5 triad + SW/hints, with Layer Zero 5 (~3d) · S8 hygiene block + capability table as law (~1d) |
| **v2.0 TRAILING** (~10-15 builder-days) | S2 sheet-drag system + OS-back verification (~3d) · S3.2/S3.3 tinted chrome + stamp substrate (~2d) · S4 Inter opsz + display tokens + free wins (~2d) · S6 ceremony ledger (reveal + install + finish) (~3d) · S9 receipts chrome, composer slots, nav grammar — drawn WITH their owning features, not ahead of them (~4d) |
| **v2.1** | S7 Dusk (toggle + ember pass + dark QA) · big-canvas layouts (on the S4 display tier) · Year-recap/share-card visual system maturation |

The §4.1 stranger-test clause is graded at v2.0 acceptance, not per-build — TRAILING items are how
its last tells get closed, in whatever order the interleave allows.

## 6. Post-v1 sequencing candidates

**Proposals only unless already admitted as bounded hardening.** Each is small, closes a live defect
or an about-to-be-built-twice seam, and must not silently ratify the whole substrate:

1. **Error ≠ empty state** (App.jsx:140-147) — arguably an *honesty* defect in v1 today: a failed
   fetch masquerades as "nothing on this weekend." Smallest honest fix: one offline/error line + retry.
2. **Detail-hero warm shimmer** — kill the `#241c15` slab (DetailPage.jsx:413); it contradicts the
   ratified card loading language (PREMIUM A4 motion#12) and is a pre-warm-palette literal.
3. **`:focus-visible` token** — one hour, app-wide reach.
4. **Iconography endgame sweep** — mechanical; finishes a system that is 90% shipped.
5. **Motion token file + easing reconciliation + ~24-straggler sweep** — candidate V2 substrate work;
   Stage C4 proved the sweep shape, but Stage E is closed.
6. **Service worker + preload hints** — the manifest/installability half landed. Offline/service-worker
   work belongs to Layer Zero #5 and its freshness contract, not a retroactive Stage-E bar.

Items 1-2 are recommended hardest (honesty-adjacent). None reopen CARD_LOCK/D1-D8; none touch the
Coverage Card or the logbook model (ruling #4's "no V1 churn").

## 7. Open decisions

0. **JOSH — the threshold question this whole document rests on:** ratify the Feel Substrate as a
   substrate workstream — an explicit ruling-#1 exemption on the Layer Zero precedent — and amend
   V2_VISION's plan of record accordingly. §1 argues the analogy; only a ruling makes it true. If
   refused, this spec dissolves into per-feature polish lines owned by the admitted features.
1. **JOSH — in-app dark-mode toggle:** ship in Dusk v2.1, or stay system-following forever? (Storage +
   Settings row; the code comment already flags it as his call.)
2. **JOSH — vibration ruling (close the category by decision, not omission):** recommend **no
   vibration in v2.0** (iOS-dead; Android-only garnish optional behind capability check, off under
   reduced-motion). Either answer is fine; an unruled category is not. (UI *sound* is not part of
   this question — it is already struck HARD in §3.S8.)
3. **JOSH — pull-to-refresh:** a pull affordance that re-fetches the snapshot is a cheap "alive"
   signal but arguably dishonest against a static-snapshot model. Recommend: no, rely on the freshness
   stamp — but it needs the ruling.
4. **JOSH — dependency posture:** this spec's default is zero new animation libraries (compositor-first
   + deckgesture.js growth). The one candidate exception: adopt **Vaul** for sheets vs. build the
   drag-dismiss on deckgesture (recommend: build in-house — the substrate exists and Vaul's physics
   recipe is fully documented). NumberFlow-style animated counts: nice-to-have, decide at build.
5. **JOSH — the sequencing candidates** (§6): rule each into immediate hardening or later V2 substrate work.
6. **⚑ CHARLES — everything soft-tier:** easing feel pass, Aurora extensions (tinted chrome, stamp
   marks, empty-state art), display-type personality + the 900 kicker, Dusk ember hues, ceremony art
   direction, PWA identity assets, glyph art (already his per DESIGN_SYSTEM §9).
7. **SPEC MECHANICS — deck-reskin cross-reference:** amend smart-engine.md's claim (line 26-27) to
   split "deck content/reskin = smart-engine; deck motion/gesture substrate = this spec" when both
   promote to `ready`.
8. **HELD OPEN elsewhere (do not resolve here):** the `--bg` dial's last step to `#fcfbf9`
   (DESIGN_SYSTEM §1) · the photoless-spot 56px medallion (⚑ PENDING JOSH, CARD_LOCK.md:17-20).

---

*Evidence base: scout reports A1–A5, workflow scratchpad `v2-research/`, 2026-07-06. Registry row:
[README.md](README.md).*
