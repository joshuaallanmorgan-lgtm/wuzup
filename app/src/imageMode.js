// imageMode.js — 3.7P-36, the Decision-Layer image quality gate.
//
// The pre-load SYNCHRONOUS verdict on what a card should LEAD with, from what is
// known before any pixels load:
//   'photo'  a usable image URL exists → render the framed image (a small thumb in
//            compare/decide lists, a big card on the Home discovery feed)
//   'icon'   a place with no photo → a compact icon/text card (NOT a big hue block)
//   'text'   an event with no photo → text-led (the art floor is a quiet backdrop)
//
// This is a PRIMITIVE: it changes no rendering on its own. Its consumers pick
// layout from it — the spine being P42's CompactRow (compare/decide lists), then
// P24 (Spots rows) — so the green art floor is never the PRIMARY UI and a poster
// shows as a small thumb that can't dominate. (3.7P-36 review: an earlier CardImg
// runtime "contain a tall poster" + sub-120px crop was dropped — it hid small-but-
// real photos and mismatched the cover detail-hero it View-Transitions into.
// Honest rule: a successfully-loaded photo is real content and is always shown;
// the art floor is for no-image + load-error only.) Pure + Node-safe (no JSX/DOM).
export function imageMode(e) {
  if (e && typeof e.image === 'string' && e.image) return 'photo'
  return e?.kind === 'place' ? 'icon' : 'text'
}
