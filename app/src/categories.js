// categories.js — THE canonical category registry (Sprint O audit prep #7).
// Before this file, the 12 categories lived in 4 drifting copies: BUBBLES
// (lib.js), CATEGORY_HUES + CATEGORY_EMOJI (cards.jsx) and the Primer's CATS.
// Phase 2 (places) adds classes on top of this taxonomy, so one source first.
//
// hue = the CARD hue (spine/glow/overline tint) — the values
// CATEGORY_HUES has always carried. NOTE: the home-screen bubble tiles tint
// with their own historical hues (lib.js BUBBLES) which deliberately differ
// from these; unifying them would be a visible change, out of scope for the
// zero-behavior-change foundations pass — bubble hues stay declared with the
// bubbles, everything identity-shaped (id/label/emoji/card-hue) lives here.
//
// Plain .js, no React, no imports — Node-importable (smoke harness) and
// dependency-free so lib.js / cards.jsx / Primer can all sit on top of it.

export const CATEGORIES = [
  { id: 'music', label: 'Music', emoji: '🎵', hue: 265 },
  { id: 'nightlife', label: 'Nightlife', emoji: '🪩', hue: 320 },
  { id: 'food', label: 'Food & Drink', emoji: '🍔', hue: 25 },
  { id: 'market', label: 'Markets', emoji: '🛍️', hue: 45 },
  { id: 'outdoors', label: 'Outdoors', emoji: '🌳', hue: 140 },
  { id: 'sports', label: 'Sports', emoji: '🏟️', hue: 210 },
  { id: 'art', label: 'Arts', emoji: '🎨', hue: 285 },
  { id: 'theatre', label: 'Theatre', emoji: '🎭', hue: 350 },
  { id: 'comedy', label: 'Comedy', emoji: '😂', hue: 15 },
  { id: 'family', label: 'Family', emoji: '👨‍👩‍👧', hue: 190 },
  { id: 'community', label: 'Clubs', emoji: '🤝', hue: 170 },
  // 'other' is the honest fallback bucket, not a real category — it gets no
  // bubble, no Primer chip, no feed overline, but cards/pins still need a
  // hue + emoji for it, so it lives in the registry like everything else.
  { id: 'other', label: 'Other', emoji: '⭐', hue: 220 },
]

export const categoryById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))

// the derived lookup maps cards.jsx has always exported (it re-export-shims
// these so DetailPage/etc. keep importing from cards.jsx unchanged)
export const CATEGORY_HUES = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.hue]))
export const CATEGORY_EMOJI = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.emoji]))

// ===== placeType visual identity (3.73a) — places are 96% the 'outdoors'
// category, so a card art floor keyed on CATEGORY alone was a green-on-green,
// same-🌳-emoji wall. These keep the art floor placeType-aware so a beach, a
// trail, a pier and a dog-park each read as a distinct discovery. Distinct hue +
// watermark emoji per placeType; the fallback (140 / 🌳) matches the old
// outdoors look, so any unmapped type degrades gracefully (smoke-tested for full
// coverage). Hues lean on the brand's coastal world: water = blue, sunset
// vantage = gold, nature = green. Plain data — Node-importable for the harness.
export const PLACETYPE_HUE = {
  beach: 200, // ocean blue
  boat_ramp: 195, // water
  pier: 28, // sunset over the water
  viewpoint: 32, // sunset vantage
  trail: 120, // forest
  preserve: 132, // deep nature
  garden: 92, // bloom
  dog_park: 50, // warm amber
  playground: 45, // warm
  courts: 35, // clay court
  cafe: 24, // warm coffee brown
  park: 140, // the classic green — now one of many, not all
}
export const PLACETYPE_EMOJI = {
  beach: '🏖️',
  boat_ramp: '🚤',
  pier: '🎣',
  viewpoint: '🌅',
  trail: '🥾',
  preserve: '🌲',
  garden: '🌷',
  dog_park: '🐕',
  playground: '🛝',
  courts: '🎾',
  cafe: '☕',
  park: '🌳',
}
