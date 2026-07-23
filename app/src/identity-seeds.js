// Historical V1 event aliases that cannot be recovered from the current
// catalog's legacy keys alone. Rows are an audited, versioned compatibility
// seam: old legacy alias -> current stable event primary.

export const IDENTITY_SEED_VERSION = 1

const TAMPA_BAY_V1 = Object.freeze([
  Object.freeze([
    'https://allevents.in/clearwater/aew-dynamite-beach-break-at-the-baycare-sound-coachman-park/2400030123913836|2026-07-08',
    'e|9b59b496f15b7d71',
  ]),
  Object.freeze([
    'https://www.eventbrite.com/e/barre-with-the-bar-method-tickets-1991911393599|2026-07-16T18:30:00-04:00',
    'e|eb0f9b7946ab7c9f',
  ]),
  Object.freeze([
    'https://www.eventbrite.com/e/kidpreneur-summer-enrichment-day-tickets-1986485963993|2026-07-11',
    'e|5329a46dcb4e24f9',
  ]),
  Object.freeze([
    'https://www.healthystpetefl.com/get-fit/|2026-07-09T18:00:00',
    'e|7b5b8851dfb140f8',
  ]),
  Object.freeze([
    'https://www.highanddryfest.com/|2026-07-11T14:00:00',
    'e|ea104e59a88da34a',
  ]),
  Object.freeze([
    'https://www.tampa.gov/events/back-2-school-health-clinic-north/192016|2026-07-11T08:00:00-04:00',
    'e|3b694000d32d2c70',
  ]),
  Object.freeze([
    'https://www.tampa.gov/events/studio55-ceramics/188601|2026-07-11T10:00:00-04:00',
    'e|994e526c68c7bc4f',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/10-tuesday-nights-imagine-museum/62646|2026-07-07',
    'e|65b9ec8b0f416474',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/108-summer-salutations-yoga-class/59306|2026-07-11',
    'e|a37cf99d877a0072',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/5-thursday-special/48171|2026-07-07',
    'e|e7b5e7108c7dc141',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/american-stage-presents-beach-please/51186|2026-07-11',
    'e|7d7649d19a64eb05',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/back-to-school-donation-event-imagine-museum/61441|2026-07-08',
    'e|aa25fa07bdfc3092',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/beginner-wheel-6-week-pottery-workshop-clay-co-op/63015|2026-07-08',
    'e|086c822fbf415f7a',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/free-pilates-pier/57391|2026-07-08',
    'e|955a98ad18e5a8d8',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/free-sunset-yoga-st-pete-pier/47356|2026-08-05',
    'e|9279876acda2d196',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/graphic-worlds-anime-comic-book-exhibit-imagine-museum/55361|2026-07-24',
    'e|1193c55b578e6f36',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/gulfport-tuesday-fresh-market/1596|2026-07-07',
    'e|4f083c10296600fa',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/happy-hour-historian-florida-women-social-change/50326|2026-07-09',
    'e|608d26e26e074107',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/prime-time-wednesdays-imagine-museum/62661|2026-07-08',
    'e|b4a8f911eb31177e',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/sesame-street-live-mahaffey/59021|2026-08-02',
    'e|6d2b08cb4d697420',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/trivia-tuesday-central-park-st-pete/63084|2026-07-07',
    'e|1a190c7aea86fbb1',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/weekly-trivia-night-voodoo-brewing-co/62881|2026-07-08',
    'e|68cbe4e998a26763',
  ]),
  Object.freeze([
    'https://www.visitstpeteclearwater.com/event/wine-down-tuesdays-melting-pot-st-pete/59756|2026-07-07',
    'e|b53671a8812c4204',
  ]),
  Object.freeze([
    'https://www.visittampabay.com/tampa-events/details/broadway-miscast-the-sequel/100273/|2026-07-10',
    'e|153a0483f3de45e5',
  ]),
  Object.freeze([
    'https://www.visittampabay.com/tampa-events/details/kym-whitley/101000/|2026-07-10T18:30:00-04:00',
    'e|842fb8e3670722c0',
  ]),
])

const SEEDS_BY_CITY = Object.freeze({
  'sf-east-bay': Object.freeze([]),
  'tampa-bay': TAMPA_BAY_V1,
})

export function identitySeedsForCity(cityId) {
  const rows = SEEDS_BY_CITY[cityId]
  if (!rows) return []
  return rows.map(([legacyAlias, primary]) => ({
    kind: 'event',
    primary,
    aliases: [primary, legacyAlias],
  }))
}
