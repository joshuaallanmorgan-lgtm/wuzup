// app/src/artseed.js — deterministic "Aurora mesh" art-floor seed.
//
// The no-photo floor backs the MAJORITY of cards (most places + the ~6% photoless
// events). Keying it on placeType/category alone made every cafe identical (the
// "coffee wall"). This derives a UNIQUE soft gradient field per ITEM from a stable
// hash of its key, while staying pure CSS, honest (an obviously-designed abstract
// field, never a photo), and scale-invariant.
//
// Pure / no React so the smoke harness can import it and assert determinism.
//
// FNV-1a 32-bit hash → a 0..1 value stream (re-salted by index). No Math.random and
// no per-render state: the SAME key ALWAYS yields the SAME field — which also keeps
// the card-thumb → detail-hero View-Transition morph continuous (both derive from
// the one key).
const fnv1a = (str) => {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
// a stable 0..1 value for (key, channel-index)
export const seedFloat = (key, i) => (fnv1a(key + ':' + i) % 1000000) / 1000000

// the per-place CSS custom props for the aurora field: a muted base wash in the
// place's hue band (--ch) + 3 soft radial "blobs", each SEED-PLACED (x / y / radius)
// and hue-jittered within the band — base ±12°, a +22° companion, a −16° companion.
// Saturation + lightness live in the CSS (Sunlit Coastal Pop, S~40% since WS4) so
// Charles can re-tune the look without touching the seed math. All outputs are
// plain CSS values.
export function auroraVars(key, baseHue) {
  const jit = (i, amp) => Math.round((seedFloat(key, i) - 0.5) * 2 * amp) // ±amp degrees
  const pct = (i, lo, span) => (lo + seedFloat(key, i) * span).toFixed(1) + '%'
  return {
    '--ch': baseHue,
    '--ah1': baseHue + jit(1, 12), '--ax1': pct(2, 12, 46), '--ay1': pct(3, 8, 42), '--ar1': pct(4, 54, 38),
    '--ah2': baseHue + 22 + jit(5, 8), '--ax2': pct(6, 42, 50), '--ay2': pct(7, 40, 50), '--ar2': pct(8, 46, 34),
    '--ah3': baseHue - 16 + jit(9, 8), '--ax3': pct(10, 18, 56), '--ay3': pct(11, 8, 40), '--ar3': pct(12, 42, 34),
  }
}

// the featured place-no-photo medallion shares the field's base-blob hue jitter, so a
// row of featured cafes varies in hue too (not one identical brown medallion).
export const medallionHue = (key, baseHue) => baseHue + Math.round((seedFloat(key, 1) - 0.5) * 2 * 12)
