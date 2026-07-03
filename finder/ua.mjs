// finder/ua.mjs — the shared PRODUCT User-Agent identity (city-neutral).
//
// Wikimedia API etiquette (and Nominatim's usage policy) require a descriptive
// UA with contact info. The product is multi-city, so the UA must not claim one
// city — this replaces the old per-file 'TampaBayWhatsOn/1.0 (Tampa Bay …)' and
// 'tampabay-events-finder/0.2' literals. Consumers append a purpose token:
//
//   headers: { 'User-Agent': `${PRODUCT_UA} place-image-enrichment` }
//
// Per-city SOURCE modules (finder/sources/*.mjs) keep their own UA strings —
// they are rewritten per city by design (STAGE_D D2/D3).
export const PRODUCT_UA =
  'Wuzup/1.0 (local events+places discovery app; https://github.com/joshuaallanmorgan-lgtm/cj)';
