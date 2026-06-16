// imageMode.js — 3.7P-36, the Decision-Layer image quality gate.
//
// The SYNCHRONOUS coarse verdict on what a card should LEAD with, given only what
// is known before any pixels load:
//   'photo'  a usable image URL exists → render the framed image
//   'icon'   a place with no photo → a compact icon/text card (NOT a big hue block)
//   'text'   an event with no photo → text-led (the art floor is a quiet backdrop)
//
// The finer "okay / poster-text-heavy → small thumb" verdict can only be known
// AFTER the image loads (aspect + resolution), so CardImg (cards.jsx) downgrades a
// tall flyer (contain on a blurred backdrop) or a sub-120px thumbnail (→ art
// floor) at runtime. Consumers (DecisionCard/P42, the Spots text rows/P24) call
// imageMode() to pick layout, honoring the rule: bad posters never dominate, and
// the green art floor is never the primary UI. Pure + Node-safe (no JSX/DOM).
export function imageMode(e) {
  if (e && typeof e.image === 'string' && e.image) return 'photo'
  return e?.kind === 'place' ? 'icon' : 'text'
}
