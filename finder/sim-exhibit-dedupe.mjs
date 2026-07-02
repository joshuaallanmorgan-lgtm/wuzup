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

// ---- WS1 dedup 1d: short-run (weekend) folds — the PAVA Cool Art Show case.
// After the same-day merge, the Sat record carries City+VSPC and VSPC's 7/19
// span end; the Sun record is a same-family repeat WITH a same-day end. Both
// relaxations (multi-family umbrella accepts carried-family repeats; same-day
// ends don't disqualify an occurrence) are needed for it to fold.
const pavaMerged = mk({
  title: 'PAVA Cool Art Show',
  start: '2026-07-18T10:00:00',
  end: '2026-07-19', // max-end merge keeps VSPC's published span end
  venue: 'The Coliseum',
  sources: ['City of St. Petersburg', 'Visit St. Pete/Clearwater'],
  buzz: 2,
});
const pavaSunday = mk({
  title: 'PAVA Cool Art Show',
  start: '2026-07-19T10:00:00',
  end: '2026-07-19T16:00:00', // same-day end — still an occurrence record
  venue: 'The Coliseum',
  sources: ['City of St. Petersburg'],
});
// negative control: SINGLE-family 2-day umbrella + same-family repeat must
// NOT fold (a publisher's own repeats are often deliberate separate sessions)
const singleFamSpan = mk({
  title: 'Summer Reading Kickoff Weekend',
  start: '2026-07-18',
  end: '2026-07-19',
  venue: 'Main Library',
  sources: ['Hillsborough Libraries'],
});
const singleFamRepeat = mk({
  title: 'Summer Reading Kickoff Weekend',
  start: '2026-07-19T10:00:00',
  end: '2026-07-19T11:00:00',
  venue: 'Main Library',
  sources: ['Hillsborough Libraries'],
});

// negative control: an aggregator's SERIES listing (single-family, short
// "vs." span) must never umbrella the real per-game record inside it —
// AllEvents publishes "Rays vs. Guardians" as one 7/23–7/25 span while VTB
// lists the actual 7/24 game (both the short-span-needs-multiFam rule and
// the vs.-title rule independently block this).
const seriesSpan = mk({
  title: 'Tampa Bay Rays vs. Cleveland Guardians',
  start: '2026-07-23',
  end: '2026-07-25',
  venue: 'Tropicana Field',
  sources: ['AllEvents'],
});
const realGame = mk({
  title: 'Tampa Bay Rays vs. Cleveland Guardians',
  start: '2026-07-24',
  venue: 'Tropicana Field',
  sources: ['Visit Tampa Bay'],
  description: 'Come cheer on the Rays!',
});

const input = [
  ongoingRealm, datedRealm, outsideSpan, sameFamily, otherVenue, unrelated,
  pavaMerged, pavaSunday, singleFamSpan, singleFamRepeat,
  seriesSpan, realGame,
];
const { events, folded } = dedupeOngoingOccurrences(input);

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

check('exactly 2 occurrences folded (REALM + PAVA Sunday)', folded === 2);
check('dated REALM occurrence removed', !events.includes(datedRealm));
check('ongoing REALM record kept', events.includes(ongoingRealm));
check('sources unioned', ongoingRealm.sources.includes('Visit St. Pete/Clearwater') && ongoingRealm.sources.includes('I Love the Burg'));
check('buzz recomputed to 2 families', ongoingRealm.buzz === 2);
check('image filled from occurrence', ongoingRealm.image === 'https://example.test/realm.jpg');
check('ongoing start preserved (true start)', ongoingRealm.start === '2026-05-08T19:00:00-04:00');
check('outside-span control kept', events.includes(outsideSpan));
check('same-family control kept (single-family umbrella stays strict)', events.includes(sameFamily));
check('different-venue control kept', events.includes(otherVenue));
check('unrelated control kept', events.includes(unrelated));
check('PAVA Sunday folded into the merged weekend run', !events.includes(pavaSunday));
check('PAVA merged record kept', events.includes(pavaMerged));
check('PAVA buzz still 2 (repeat adds no family)', pavaMerged.buzz === 2);
check('PAVA true start preserved', pavaMerged.start === '2026-07-18T10:00:00');
check('single-family weekend umbrella kept', events.includes(singleFamSpan));
check('single-family repeat NOT folded', events.includes(singleFamRepeat));
check('aggregator series span kept (not an umbrella)', events.includes(seriesSpan));
check('real game NOT folded into the series span', events.includes(realGame));
check('output size 10 (12 in, 2 folded)', events.length === 10);

process.exit(failures ? 1 : 0);
