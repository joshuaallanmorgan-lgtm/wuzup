// deckgesture.js — the PURE deck-gesture math (WS2 deck physics). Zero deps,
// Node-importable (deckdeal.js precedent) so smoke.mjs can SIM flicks, drags
// and spring settles without JSX. SwipeDeck.jsx imports everything from here
// and re-exports gestureVerdict, so the component's public contract is
// unchanged; keep this file free of DOM/React so the sims stay honest.

// ===== commit thresholds =====
export const SWIPE_X = 80 // px of horizontal travel that commits left/right (verified Sprint-P value)
export const SWIPE_Y = 90 // px of upward travel that commits up (verified Sprint-P value)
// WS2: a hard flick UNDER the distance threshold must also commit — distance-only
// release was the #1 cheap tell (a confident flick snapped back). Tuning:
export const FLICK_V = 0.6 // px/ms sustained release speed that commits a flick
export const FLICK_TRAVEL = 24 // px minimum same-direction travel — micro-jitter can never flick-commit
export const SAMPLE_WINDOW = 90 // ms of trailing pointer history that counts as "release speed"

// the threshold decision — ONE verdict per call, by construction (first match
// returns). 2-arg calls (dx, dy) behave exactly like the verified Sprint-P
// math: velocity terms default to 0, so every legacy path is unchanged.
//   up:    travel beats SWIPE_Y AND dominates horizontal — OR a genuine upward
//          flick (velocity dominates horizontal velocity, travel agrees).
//   right/left: travel beats SWIPE_X — OR a directional flick whose travel
//          AGREES (≥ FLICK_TRAVEL in the same direction; a rightward flick
//          with net-left travel is a wobble, not a verdict).
//   null:  under both thresholds — the spring settles the card back.
export function gestureVerdict(dx, dy, vx = 0, vy = 0) {
  const upFlick = vy <= -FLICK_V && -vy > Math.abs(vx) && dy <= -FLICK_TRAVEL
  if ((dy < -SWIPE_Y && -dy > Math.abs(dx)) || upFlick) return 'up'
  if (dx > SWIPE_X || (vx >= FLICK_V && dx >= FLICK_TRAVEL)) return 'right'
  if (dx < -SWIPE_X || (vx <= -FLICK_V && dx <= -FLICK_TRAVEL)) return 'left'
  return null
}

// release velocity in px/ms from the drag's trailing samples [{t,x,y}, …]
// (the release point is pushed as the LAST sample). Only the samples inside
// SAMPLE_WINDOW of the release count — so a fast drag followed by a HOLD
// releases at velocity 0 (the stale early samples never read as a live
// flick), and a sub-frame pair (dt < 8ms) is too noisy to trust.
export function releaseVelocity(samples) {
  const n = samples ? samples.length : 0
  if (n < 2) return { vx: 0, vy: 0 }
  const last = samples[n - 1]
  let first = null
  for (let i = n - 2; i >= 0; i--) {
    if (last.t - samples[i].t <= SAMPLE_WINDOW) first = samples[i]
    else break
  }
  if (!first) return { vx: 0, vy: 0 }
  const dt = last.t - first.t
  if (dt < 8) return { vx: 0, vy: 0 }
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
}

// ===== the snap-back spring (under-threshold release) =====
// unit mass, stiffness k, damping c → ζ = c / (2√k) ≈ 0.73: ONE small visible
// overshoot (~5-7% of the release offset), settled in ~400-500ms. Rest gates
// close the rAF loop when both offset and speed are imperceptible.
export const SPRING = { k: 170, c: 19, restDist: 0.4, restSpeed: 25 }

// one semi-implicit-Euler step: x px from rest, v px/s, dt ms (clamped to
// 32ms so a dropped frame never explodes the integration). Pure — smoke.mjs
// sims the whole settle through this exact function.
export function springStep(x, v, dtMs, k = SPRING.k, c = SPRING.c) {
  const dt = Math.min(dtMs, 32) / 1000
  const v2 = v + (-k * x - c * v) * dt
  return { x: x + v2 * dt, v: v2 }
}

// ===== exit-flight momentum =====
// a committed card's flight inherits the release speed: a hard flick flies
// out FASTER than a slow deliberate drag. speed is |v| at release in px/ms;
// clamps keep the flight inside the deck's motion language (and under the
// 420ms last-card→onDone delay).
export const FLY_MS_MAX = 400
export const FLY_MS_MIN = 240
export function flightMs(speed) {
  const s = Math.max(0, Math.min(3, speed || 0))
  return Math.round(Math.max(FLY_MS_MIN, Math.min(FLY_MS_MAX, 410 - 90 * s)))
}

// ===== grab-point rotation =====
// real cards pivot around where you hold them: a top-half grab rotates WITH
// the drag, a bottom-half grab rotates against it (the consumer flips the
// factor's sign). Clamped so a full-width fling can't windmill the card.
export const ROT_FACTOR = 0.05 // deg per px of horizontal travel (verified Sprint-P value)
export const ROT_MAX = 12 // deg
export function grabRotation(dx, rotF = ROT_FACTOR) {
  return Math.max(-ROT_MAX, Math.min(ROT_MAX, dx * rotF))
}
