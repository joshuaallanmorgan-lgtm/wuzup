# Tinder — "Tune your taste" swipe module + decks (Events + Spots) · MVP V1

> **Self-loop grind.** The swipe-to-tune feature. The TOP MODULE pixel-matches `tinder.png` (light theme);
> the swipe DECK reuses the existing **dark** CalibrationDeck look (verify vs `sheet-a.png`'s calibration
> panel; update if out of date). Honesty: real events/places only; taste **reorders, never hides**.

## 1. "Tune your taste" top module — NEW, on BOTH Events + Spots
Placed **between the filter chips and the first content section** (`HotView.jsx` + `LocationsView.jsx`).
Pixel-match `tinder.png`:
- Heading **"Find your night by swiping"** + subtext ("Keep what you like, skip what you don't — your {events/spots} feed tunes as you swipe.") — _reframed backup→primary (Stage B Batch 5); PLACEHOLDER copy ⚑ Charles._
- A **preview** of 2 sample cards — one "I'm into it ✓" (full opacity), one dimmed/blurred "Not for me."
- CTA **"Start swiping"** (`--cta #bb5719` + white, ~50px, rounded, weight 800) — _open-ended; the old "Swipe 12 quick picks" was a bug (the deck deals 15 = DECK_SIZE)._
- **Dismissible** ✕ (top-right). **Session fatigue guard:** after dismiss, hide for the session; on re-entry show "Tune again."
- Light theme (`--bg`/`--card`/`--ink`/`--cta`), card radius ~12-16px, soft shadow, entrance fade (respects reduced-motion).
- **Events module → opens the Events Tinder; Spots module → opens the Spots Tinder.**

## 2. The swipe decks (dark immersive — reuse the deck look)
- **Events Tinder = the existing `CalibrationDeck`** (kind `'events'`). Verify its dark face/stamps/buttons vs `sheet-a` calibration; update if out of date. Pool = stratified `dealDeck` (one hottest per category + diverse high-hotScore). Verdicts: right = into-it (+taste), left = not-for-me (−, floored), up = save. Honest finish tally (kept/passed); **the pre-existing sanctioned violet finish beat STAYS** (ROADMAP §1.3 dark-theme contract; Josh ruling 2026-07-01 — "no reward animation" here means add no NEW reward, not strip the sanctioned #6 beat). LensDeck/DayFill stay reward-free.
- **Spots Tinder = NEW** — parameterize CalibrationDeck to kind `'places'` (or a sibling `PlacesTinderDeck`): swipe place cards (image + placeType label + title + amenity chips, **no date**); same verdicts; honest finish tally.

## 3. Backend — a separate Events + Spots Tinder (the path-careful part)
- **Parameterize the deck by `kind` (events|places):** the pool (`dealDeck` over events vs places, stratified by category), the card face (event vs place), and the verdict→taste mapping. Keep the existing event behavior intact (default kind `'events'`).
- **Two entry points:** Events module → `openDeck({kind:'events', origin:'events'})`; Spots module → `openDeck({kind:'places', origin:'spots'})`. (Extend `openDeck` additively; don't break the existing `origin` routing.)
- **Results → `taste.js`** (`recordCalibration`): events feed event/category taste (exists). **Places must feed place/category taste** — confirm `taste.js` handles place signals; add a place-taste path if missing (honest: same category model, never fabricated).
- **Path-safety:** additive `kind` param on the deck + `openDeck`; reuse the SwipeDeck machinery + `deck.css`; the Escape/close ladder unchanged.

## Build order
1. Parameterize the deck (kind events|places) + the places-taste path (backend).
2. Spots Tinder deck (the new variant).
3. The "Tune your taste" module on both pages (pixel-match `tinder.png`), wired to the right deck.

## Self-loop
Module: light, pixel-match `tinder.png` (screenshot anims+grain disabled). Deck: dark, verify vs `sheet-a` calibration. Iterate ≤6 → gate → commit. Scout backstop-verifies.
