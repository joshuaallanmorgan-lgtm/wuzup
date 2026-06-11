// sim-exhibit-dedupe.mjs — Sprint L3 simulation of the ongoing-exhibit
// cross-day dedupe, with the REAL "REALM Exhibition" records from the
// 2026-06-10 dataset plus negative controls.
//
// Run:  node finder/sim-exhibit-dedupe.mjs   (exit 0 = all checks pass)

import { dedupeOngoingOccurrences } from './finder.mjs';

const mk = (o) => ({
  title: null, start: null, end: null, venue: null, address: null,
  price: null, currency: null, isFree: null, lat: null, lng: null,
  url: null, image: null, description: null,
  source: o.sources?.[0] ?? null, buzz: 1, staffPick: false, promoted: false,
  category: null, ...o,
});

// The real pair (verbatim from finder/output/events.json, 2026-06-10):
const ongoingRealm = mk({
  title: 'REALM Exhibition & Voices in REALM at FloridaRAMA Gallery',
  start: '2026-05-08T19:00:00-04:00',
  end: '2026-06-28T22:00:00-04:00',
  venue: 'FloridaRAMA',
  sources: ['I Love the Burg'],
  isFree: true,
});
const datedRealm = mk({
  title: 'Voices in REALM Exhibit at FloridaRAMA',
  start: '2026-06-11',
  end: null,
  venue: 'FloridaRAMA',
  sources: ['Visit St. Pete/Clearwater'],
  image: 'https://example.test/realm.jpg',
});

// Negative controls:
// 1. same-day-occurrence OUTSIDE the run (after end) — must NOT fold
const outsideSpan = mk({
  title: 'Voices in REALM Exhibit at FloridaRAMA',
  start: '2026-07-15',
  sources: ['Visit St. Pete/Clearwater'],
});
// 2. same family as the ongoing record — must NOT fold (cross-source only)
const sameFamily = mk({
  title: 'REALM Exhibition Voices at FloridaRAMA',
  start: '2026-06-12',
  sources: ['I Love the Burg'],
});
// 3. similar title, totally different venue — must NOT fold
const otherVenue = mk({
  title: 'Voices in REALM Exhibit',
  start: '2026-06-13',
  venue: 'Tampa Museum of Art',
  sources: ['Visit Tampa Bay'],
});
// 4. unrelated single-day event inside the span — must NOT fold
const unrelated = mk({
  title: 'Sunset Music Festival',
  start: '2026-06-12',
  venue: 'Raymond James Stadium',
  sources: ['AllEvents'],
});

const input = [ongoingRealm, datedRealm, outsideSpan, sameFamily, otherVenue, unrelated];
const { events, folded } = dedupeOngoingOccurrences(input);

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

check('exactly 1 occurrence folded', folded === 1);
check('dated REALM occurrence removed', !events.includes(datedRealm));
check('ongoing REALM record kept', events.includes(ongoingRealm));
check('sources unioned', ongoingRealm.sources.includes('Visit St. Pete/Clearwater') && ongoingRealm.sources.includes('I Love the Burg'));
check('buzz recomputed to 2 families', ongoingRealm.buzz === 2);
check('image filled from occurrence', ongoingRealm.image === 'https://example.test/realm.jpg');
check('ongoing start preserved (true start)', ongoingRealm.start === '2026-05-08T19:00:00-04:00');
check('outside-span control kept', events.includes(outsideSpan));
check('same-family control kept', events.includes(sameFamily));
check('different-venue control kept', events.includes(otherVenue));
check('unrelated control kept', events.includes(unrelated));
check('output size 5 (6 in, 1 folded)', events.length === 5);

process.exit(failures ? 1 : 0);
