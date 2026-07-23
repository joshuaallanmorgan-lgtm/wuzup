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
// Honest rule: only the same receipt-gated image CardImg can display counts as a
// photo; raw URLs cannot silently change layout while rendering as Aurora.
// Pure + Node-safe (no JSX/DOM).
import { presentRuntimeImage, RUNTIME_EVENT_IMAGE_POLICY } from './leadImage.js'

export function imageMode(e) {
  try {
    if (presentRuntimeImage(e, { policy: RUNTIME_EVENT_IMAGE_POLICY }).image) return 'photo'
  } catch {
    // Invalid/missing event identity fails closed to the text presentation.
  }
  return e?.kind === 'place' ? 'icon' : 'text'
}

// WS4 (cohesion/aurora): the count-preserving "photos first" order the Spots
// rails/sections were always MEANT to have. imageMode has never returned 'none',
// so the old `imageMode(p) !== 'none'` rail filter was a tautology (always true)
// and "closest with real photos first" (SP-L3 / SPOTS P1b) silently never
// happened. This is the intended predicate as a STABLE PARTITION: photo-bearing
// items lead, art-floor items follow in their incoming order, nothing is dropped
// (never-hide: reorder only) — so a thin photo supply still fills every rail
// from the general pool. Pure + Node-safe (smoke harness imports it).
export function photoFirst(list) {
  const photos = []
  const rest = []
  for (const e of list || []) (imageMode(e) === 'photo' ? photos : rest).push(e)
  return photos.concat(rest)
}
