// categoryImages.js — PREMIUM A3: the curated category-image FLOOR picker.
//
// HYBRID imagery contract (this intentionally BENDS the 2026-06-15 honest-images
// rule, per Josh): a REAL verified photo OF THE PLACE (Wikidata P18/P373 →
// place.image) is always PREFERRED. Where a place has none, this returns a
// GENERIC, free-licensed, CREDITED category stock image (finder/category-images.json)
// so the card/hero reads premium instead of a flat hue+emoji block. The stock image
// is a CLEARLY-GENERIC floor — credited as stock in Settings → About, NEVER claimed
// as the specific venue. Same honesty bar the emoji floor met, just prettier.
//
// Pure + Node-importable (no JSON import, no DOM): the app binds the manifest at the
// call site (cards.jsx imports the JSON), the smoke test passes it the parsed file.

// djb2 — small, stable, deterministic. A given place.key always maps to the same
// image (and adjacent places differ), so the floor is consistent across renders.
export function hashStr(s) {
  let h = 5381
  const str = String(s)
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// The stable category-floor ENTRY ({ url, credit, source }) for a place, or null.
// A place is identified by a placeType the manifest covers; events (no placeType)
// and not-yet-curated types fall through to null → the (upgraded) art floor.
export function pickCategoryImage(manifest, place) {
  if (!manifest || !place) return null
  const list = manifest[place.placeType]
  if (!Array.isArray(list) || list.length === 0) return null
  const key = place.key || place.title || place.name || ''
  return list[hashStr(key) % list.length]
}

// Convenience: just the floor URL (or null).
export function categoryImageUrl(manifest, place) {
  return pickCategoryImage(manifest, place)?.url || null
}
