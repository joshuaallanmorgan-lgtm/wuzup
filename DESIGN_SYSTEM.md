# DESIGN_SYSTEM — the locked design-system canon

> **What this is:** the authority for Wuzup's **design tokens + visual contracts** — palette, elevation, radius, chip, eyebrow, type, motion, and the bent-rules policy. Established **Stage A6** (the premium-feel codification that closes Stage A).
> **Authority split:** [ROADMAP.md](ROADMAP.md) wins on *plan*; this doc wins on *design primitives*. All values live in `app/src/index.css` `:root` — this is the prose that explains them.
> **Supersedes** [UI_SPEC.md](UI_SPEC.md) §Round-2's teal `--accent: #0d9488` identity — the app's base color is the **warm Sunset Gold** palette below. (UI_SPEC.md remains the feed/chips/calendar *build* reference.)

The honesty bar is unconditional and overrides everything here: **nothing fake is ever presented as real.**

---

## §1 — Palette (warm "Sunlit Coastal Pop")

| Token | Value | Role |
|---|---|---|
| `--bg` | `#faf6f1` | airy warm canvas (ruling 2026-07-01 #5: lightened toward the refs off A1's `#f6f2ec`; the A4 shadow scale carries card-lift; one more step to `#fcfbf9` on the dial) |
| `--card` | `#fefdfb` | near-white surface — the figure against `--bg` ground |
| `--ink` | `#1a1410` | warm charcoal, primary text (16.95:1 on bg) |
| `--muted` | `#6b6157` | secondary text (5.62:1 on bg, AA) |
| `--line` | `#ede8e2` | warm hairline divider |
| `--accent` | `#ff8c42` | Sunset Gold — **fills/borders/marks/selection only** |
| `--accent-ink` | `#ad5116` | AA-safe accent **text** on light (4.92:1 on bg) |
| `--cta` | `#bb5719` | the one shared primary-button fill (white text passes AA) |
| `--hot` | `#ff3b5f` | **reserved** for hot-ness + save-hearts (never decorative) |
| `--reward` | `#d966f5` | **reserved** violet, sanctioned one-shot reward beats only |
| `--free` | `#0fa86d` | "free" sage badge |

`*-rgb` companions (`--accent-rgb`, `--hot-rgb`, `--cta-rgb`, `--reward-rgb`) exist for `rgba()` tints/glows.

**Accent restraint (A6):** Sunset Gold is over-spendable. Accent is for **real actions, selection, focus** — not editorial micro-labels. Overlines, "Best for", "Why", group headers, type/area labels read `--muted` (or `--ink` if a value). _Done in A6: section-overline family (`.st-over`/`.tp-over`/`.ie-over`/`.ae-group`/`.wkb-group`) + `.fc-best-title`. **Completed in the Cohesion Pass (WS3)** — the deferred sweep landed: the went/record family (`.cal-sel-went`, `.pf-dayh-went` border, `.pf-dayh-went-tag` → muted/ink-hairline; `.pf-reality-went` → `--ink`, it's a value), the Sponsored-twin `.sp-label.my-label` → muted, the `.wkb-pick-*` emphasis ladder → chip-neutral (ink "Top pick" still outranks the muted fit pill), and the `.shelf-count` pill → chip-neutral. All AA-verified (muted ≥5.2:1 on every fill used). Note the tension, honored: ruling 2026-07-01 #2 spends orange on NAVIGATION (See-all) and true action/selection moments — these four families are passive labels, exactly what restraint covers._

---

## §2 — The four bent rules (+ the honesty bar)

Stage A unlocked four rules that the old "flat, art-floor-everywhere, restrained-motion" stance forbade. Each carries its honesty clause.

- **IMAGERY** — real/curated photos are the default wherever a card/hero shows a place or event. Art-floor (the Aurora mesh) is a true *fallback*, upgraded (muted, warm, textured), never a "missing image." Curated category/mood images are clearly generic; **never imply a stock photo is this venue's own.**
- **DEPTH** — a ranked elevation scale on every floating surface (§3); figure/ground via the `--bg`↔`--card` step; press-answer (scale + shadow tighten). All under `prefers-reduced-motion`.
- **MOTION** — press feedback is universal; reveals (skeleton, carousel stagger, image settle, tab settle) and conversion beats (Add toast/morph) are real; sheets ease symmetrically (§8).
- **CONTENT** — richer copy at designed dead-ends (end-caps, empty states) + photo-backed Guides. Restraint elsewhere: one accent emphasis per card, tight 3-line meta. **Sample/seed content is never dressed up as live data.**

---

## §3 — Elevation scale (depth)

One ranked system, assigned by importance, all warm `rgba(26,20,16,…)`.

| Token | Use |
|---|---|
| `--shadow-1` | numerous rows/tiles — result cards, `.pf-row`, carousel tiles, agenda `.card` (soft) |
| `--shadow-2` | contained cards/panels (`= --shadow-card` alias) |
| `--shadow-3` | featured / hero (`.featc`, detail panels) |
| `--shadow-sheet` | bottom sheets (upward throw) |
| `--shadow-press` | the pressed (tightened) contact step on `:active` |

Borderless + shadow is the card language (D2): drop the `--line` hairline, lean on elevation.

---

## §4 — Radius scale (A6)

One 4-step corner system; off-grid literals snap to the nearest step.

| Token | Value | Use |
|---|---|---|
| `--r-sm` | `10px` | badges, small buttons, on-image pills |
| `--r-md` | `14px` | **thumbs (event + spot share this)**, tiles, inputs, most buttons |
| `--r-lg` | `18px` | **cards (gem/spot/agenda/featured all share this)**, panels |
| `--r-pill` | `999px` | fully-rounded pills + chips |
| `--r-circle` | `50%` | true circles — icon buttons, avatars, knobs, dots |
| `--r-xl` | `22px` | deck swipe cards + bottom-sheet top corners |

`2px`/`6px` micro-bars stay literal (below the scale floor). A6 tokenized **193** declarations; the only deliberate visual snaps are the thumb unification (12→14), card unification (16→18), the stray imgbadge (7→10), and `.flt-chip` (20→18).

---

## §5 — Chip primitive (A6)

One `.chip` — hairline warm pill, `--t-micro (11px)/600` ink (Cohesion type snap: was the off-scale 11.5), `4×9` padding, `--r-pill`, optional 12px stroke-icon. Surface is tokenized (`--chip-fill #f3ede5`, `--chip-border rgba(26,20,16,0.07)`) so chips theme per-city.

- `.chip-free` — sage tint (free badges)
- `.chip-accent` — warm accent tint (e.g. detail "why this is here")
- `.chip-lg` — the LARGER label pill (`6×11` padding, ink, nowrap) — shared geometry only; consumers keep their own fill/border/ink-size (Stage C C5)
- `.chip-dark` — the deck-family chip on dark card surfaces (`3×9` white-on-glass, no hairline) — a sibling primitive, not `.chip` + overrides (Stage C C5)

`.gem-chip`/`.featc-chip`/`.spot-amen` are aliases on the primitive; `.loc-tag-chip`/`.loc-amen-chip` alias onto `.chip-lg`'s shared geometry (their fills genuinely differ — accent tint vs bg-fill hairline — and stay per-class; the Cohesion type snap converged both inks on `--t-meta` 13); the decks' amenity chip is `.chip-dark` outright (the old `.deck-chip` class is gone; its icon slot `.deck-chip-ic` stays in deck.css). _Still deferred, with reasons (C5 audit): `.dpg-chip` (11px ink, `2×9`, `--line` fill — matches no variant's rendered pixels; an alias would need more overrides than it saves), `.srch-recent-chip` (a structural run-button+✕ wrapper on `.srch-sug-btn`, not a label chip), `.detail-catchip` (already rides `.chip` as a hue-tint modifier)._ Interactive pills (`.flt-chip`, `.ie-chip`, `.primer-chip`, `.lens-pill`) are **controls, not label chips** — they stay distinct by design.

---

## §6 — Eyebrow / overline (A6)

One contract: `--eyebrow-size 11px` · `--eyebrow-weight 700` · `--eyebrow-track 0.06em` · **UPPERCASE** (applied at the use-site).

Applied in A6 to the already-uppercase section-label family (`.home-title`, `.weekend-day-label`, `.flt-section-label`, `.fc-list-head`, `.calpick-listhead`).

**RESOLVED (Cohesion Pass, ruling 2026-07-01 #7 — delegated to Fable, executed WS3):**
- **METADATA eyebrows = full contract + UPPERCASE** — labels that name a type/category/group of content: `.spotcard-type` ("COFFEE SHOP"), `.nbhd-area`, `.d-k` (When/Where/Price/About/What's here…), `.pf-hist-label` (Past days/Been there), `.ms-group-label` (Upcoming/Yesterday/…), `.st-over` (Settings groups), `.ie-over` (Interest groups), `.srch-recents-title` (Recent).
- **EDITORIAL/authored lines stay sentence case** — anything with a voice: why-lines (`.gem-why`, the "Why this fits" card), the detail date eyebrow (`.detail-eyebrow`, deliberately 14px accent — not an 11px overline), guide/section subtitles, `.tp-over` "Tune it yourself", `.recap-over` "Before you go", `.pf-ask-q` "Did you make it?", `.ae-group` (mixed authored form groups), form field labels (`.ae-label`, `.ep-label`).

---

## §7 — Type scale

| Token | Value | Use |
|---|---|---|
| `--t-card` (`-size/-weight/-track/-line`) | `15 / 700 / -0.2px / 1.16` | every standard result/tile/row card title |
| `--t-card-lg` (`…-lg-*`, incl. `-line 1.15`) | `19 / 800 / -0.3px / 1.15` | featured + deck card titles |
| `--t-body` | `15px` | body/prose + row-label text |
| `--t-meta` | `13px` | meta lines (the Cohesion snap folded 12.5/13.5 here) |
| `--t-meta-sm` | `12px` | small meta |
| `--t-micro` | `11px` | micro labels, badges, chips (11.5 folded here) |
| `--card-row-h` | `158px` | the one result-card height (D1) |
| section title | `22 / 800` | `.sec-title` outranks card titles |
| `.num` | `font-variant-numeric: tabular-nums` | times/stats/distances/counts |

A6 retired the orphan `600`/`750` weights and migrated the last literal titles (`.card-title`, `.deck-title`, `.dpg-card-title`, `.wkb-pick-title`) onto the tokens. Font is Inter everywhere.
**Cohesion type snap:** every sub-16px literal now rides the C4 secondary scale above (display sizes ≥16 stay literal by design); half-pixel font sizes are banned app-wide (smoke tripwire); the last `650`/`750` orphan weights (forecast/nextdays/notifications) retired onto `600`/`700` (`550` stays — a deliberate mid-weight, forecast). `14px` is the one sanctioned off-scale text size (the detail date eyebrow + the button/label tier).

---

## §8 — Motion

Tokens: `--dur-micro 120` / `--dur-fast 200` / `--dur-base 400` / `--dur-page 400` / `--dur-emphasis 300`; `--ease-out`, `--ease-emphasis` (the "Apple curve"), `--ease-inout`. **Reduced-motion always resets.**

Universal press feedback (lens pills 0.96, tn-items 0.97, cards 0.985); reveals (skeleton shimmer, carousel left-to-right stagger, image scale/blur settle, tab-settle on tap); conversion beats (Add toast + button morph, bottom-CTA tactile); swipe-deck under-card rise. Sheets ease symmetrically (open `--ease-emphasis`, close `--ease-inout`) — _the last two slam-closers (`filters.css` + the loc-plan sheet) were converted to the `.closing` path in Stage C C5 (`84f019a`); §F is CLOSED._ Reward grammar: `savePop`/`slotPop` gold overshoots only at sanctioned beats. The deck adds physics (Cohesion WS2): velocity flicks + spring settles + momentum exits — knobs live in `deckgesture.js`; reduced-motion = buttons-only, unchanged.

---

## §9 — Emoji = identity only

Emoji are reserved for **identity**: category badges, the placeType art floor + medallions, intent tiles, the primer tour, the deck's intentional stamps, and 💎 as a deliberate accent. **All UI control glyphs use the engineered 2.1-stroke `Icon.*` family** — never raw `♥`/`🔥`/`📍`. The family (grown in Cohesion WS3): heart/heartFill/sparkle/flame/pin/chevron/calendar/tag/hot + the drawn set sun/cloud/rain/storm (the NextDays weather discs) + moon/dots/burst/sprout/shuffle (⚑ Charles owns final glyph art). _Known stragglers, deliberate for now: the 🔎 search-bar glyph, the "🃏 Deck this" pill (arguably deck identity), Notification row icons — sweep or exempt-list in a later pass._

---

## §10 — Locked decisions D1–D8 (Stage A)

| # | Decision | Status |
|---|---|---|
| D1 | Cards (events + spots) all the SAME height (`--card-row-h` 158px) | ✅ |
| D2 | Lower contrast — soften/drop card hairlines, lean on shadow | ✅ |
| D3 | Maximize the title (2-line tight clamp, controls off the title band) | ✅ |
| D4 | Heart → top-right corner, thin stroke (rail dropped) | ✅ |
| D5 | Filter chips fit ONE line on Events + Spots | ✅ |
| D6 | The opened (dark) Tinder deck matches the premium visuals | ✅ |
| D7 | Settings: only the quick-primer entry (taste rows removed), primer premium-ified | ✅ |
| D8 | Map PARKED for v1 — removed everywhere; location → Google Maps (Directions) | ✅ |

---

_Source prose for §2 lives historically in `PREMIUM_PUNCH.md` §2; the D1–D8 anchors + file:line refs live in `PREMIUM_PUNCH.md` §0. This doc is the durable promotion of both._
