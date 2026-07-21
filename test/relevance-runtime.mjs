import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  rankRuntimeItems,
  rankTonightCandidates,
  runtimeQualityPolicy,
  signedRuntimeTaste,
} from '../app/src/relevance.js'

const TAMPA = {
  id: 'tampa-bay',
  region: 'Florida',
  tz: 'America/New_York',
  bbox: { south: 27.3, north: 28.6, west: -83.3, east: -81.9 },
}
const SF = {
  id: 'sf-east-bay',
  region: 'California',
  tz: 'America/Los_Angeles',
  bbox: { south: 37.68, north: 38, west: -122.53, east: -121.88 },
}

function event(id, overrides = {}) {
  return {
    id,
    title: `Event ${id}`,
    start: '2026-07-21T20:00:00-04:00',
    end: '2026-07-21T22:00:00-04:00',
    venue: `Venue ${id}`,
    address: '100 Main St, Tampa, FL 33602',
    lat: 27.95,
    lng: -82.46,
    description: 'A specific local event with enough concrete detail for someone to decide whether it fits their evening plans.'.repeat(2),
    source: `Source ${id}`,
    sources: [`Source ${id}`],
    category: `category-${id}`,
    status: 'scheduled',
    price: null,
    isFree: null,
    ...overrides,
  }
}

function wrappers(events) {
  return events.map(e => ({ e, withDate: false }))
}

test('runtime quality policy converts current CITY bbox and region without shared-array mutation', () => {
  const junk = ['junk-1']
  const policy = runtimeQualityPolicy({
    kind: 'events', nowMs: 123, city: TAMPA, knownJunkIds: junk, knownFalseMergeIds: ['merge-1'],
  })
  junk.push('junk-2')
  assert.deepEqual(policy, {
    kind: 'events',
    nowMs: 123,
    timeZone: 'America/New_York',
    market: {
      id: 'tampa-bay',
      bbox: { latMin: 27.3, latMax: 28.6, lngMin: -83.3, lngMax: -81.9 },
      regionCodes: ['FL'],
    },
    knownJunkIds: ['junk-1'],
    knownFalseMergeIds: ['merge-1'],
  })
})

test('generic runtime ranking preserves exact event membership and original object identity', () => {
  const rows = [event('b'), event('a', { description: 'Short detail.' })]
  const result = rankRuntimeItems(rows, {
    kind: 'events',
    nowMs: Date.parse('2026-07-21T18:00:00-04:00'),
    city: TAMPA,
    taste: {},
    context: { itemScores: { b: -4, a: 4 } },
  })

  assert.equal(result.ordered.length, rows.length)
  assert.equal(result.reachability.exactPermutation, true)
  assert.equal(result.ordered[0], rows[1])
  assert.equal(result.scored.find(row => row.id === 'b').item, rows[0])
})

test('generic place ranking reads bounded source arrays and ignores presentation imagery', () => {
  const places = [
    {
      key: 'p|park', name: 'Park', category: 'outdoors', sources: ['OSM'],
      lat: 27.96, lng: -82.47, address: 'Tampa, FL', description: 'A public park with trails and picnic tables.',
      image: null,
    },
    {
      key: 'p|museum', name: 'Museum', category: 'art', sources: ['Wikidata', 'OSM'],
      lat: 27.95, lng: -82.46, address: 'Tampa, FL', description: 'A local museum with rotating exhibitions and visitor information.',
      image: 'https://images.example.test/museum.jpg',
    },
  ]
  const options = {
    kind: 'places',
    nowMs: Date.parse('2026-07-21T18:00:00-04:00'),
    city: TAMPA,
    taste: {},
  }
  const withImages = rankRuntimeItems(places, options)
  const withoutImages = rankRuntimeItems(places.map(place => ({ ...place, image: null, imageCredit: null })), options)

  assert.deepEqual(withImages.ordered.map(place => place.key), withoutImages.ordered.map(place => place.key))
  assert.equal(withImages.reachability.exactPermutation, true)
  assert.ok(withImages.scored.find(row => row.id === 'p|park').reasons.includes('SOURCE_IDENTIFIED'))
  assert.ok(withImages.scored.find(row => row.id === 'p|museum').reasons.includes('SOURCE_CORROBORATED'))
  assert.equal(withImages.scored.find(row => row.id === 'p|museum').leadEligible, true)
  assert.equal(withImages.scored.find(row => row.id === 'p|park').leadEligible, false)
  assert.equal(withImages.ordered.some(place => place.key === 'p|park'), true)
})

test('runtime adapter is an exact permutation and selects three credible diverse Tampa candidates', () => {
  const input = wrappers([
    event('music', { category: 'music', source: 'Eventbrite (Tampa)', sources: ['Eventbrite (Tampa)'], venue: 'The Ritz' }),
    event('art', { category: 'art', source: 'City Arts', sources: ['City Arts'], venue: 'Art Center' }),
    event('food', { category: 'food', source: 'Market Calendar', sources: ['Market Calendar'], venue: 'Public Market' }),
    event('more', { category: 'music', source: 'Eventbrite (Free)', sources: ['Eventbrite (Free)'], venue: 'The Ritz' }),
  ])
  const result = rankTonightCandidates(input, {
    nowMs: Date.parse('2026-07-21T18:00:00-04:00'),
    city: TAMPA,
    taste: {},
  })
  assert.equal(result.limited, false)
  assert.equal(result.selected.length, 3)
  assert.equal(result.reachability.exactPermutation, true)
  assert.deepEqual(result.ordered.map(row => row.e.id).sort(), input.map(row => row.e.id).sort())
  assert.equal(new Set(result.selected.map(row => row.e.category)).size, 3)
  assert.equal(new Set(result.selected.map(row => row.e.source)).size, 3)
  assert.equal(new Set(result.selected.map(row => row.e.venue)).size, 3)
  assert.equal(result.selected.every(row => row.withDate === false && typeof row.e._why === 'string'), true)
})

test('sparse SF supply returns an explicit limited state without padding weak rows', () => {
  const credible = [
    event('sf-music', {
      start: '2026-07-21T20:00:00-07:00', end: '2026-07-21T22:00:00-07:00',
      category: 'music', source: 'SF Calendar', sources: ['SF Calendar'], venue: 'SFJAZZ',
      address: '201 Franklin St, San Francisco, CA 94102', lat: 37.776, lng: -122.421,
    }),
    event('oak-art', {
      start: '2026-07-21T19:30:00-07:00', end: '2026-07-21T21:30:00-07:00',
      category: 'art', source: 'Oakland Arts', sources: ['Oakland Arts'], venue: 'Oakland Museum',
      address: '1000 Oak St, Oakland, CA 94607', lat: 37.798, lng: -122.264,
    }),
  ]
  const weak = event('weak', {
    start: '2026-07-21T20:30:00-07:00', end: '2026-07-21T21:00:00-07:00',
    category: 'other', source: 'Unknown feed', sources: ['Unknown feed'], venue: null,
    address: null, lat: null, lng: null, description: '',
  })
  const result = rankTonightCandidates(wrappers([...credible, weak]), {
    nowMs: Date.parse('2026-07-21T18:00:00-07:00'), city: SF, taste: {},
  })
  assert.equal(result.limited, true)
  assert.equal(result.availableLeadCount, 2)
  assert.deepEqual(result.selected.map(row => row.e.id).sort(), ['oak-art', 'sf-music'])
  assert.equal(result.ordered.some(row => row.e.id === 'weak'), true)
  assert.equal(result.reachability.exactPermutation, true)
})

test('explicit mute becomes a negative bounded score but never filters inventory', () => {
  const taste = { n: 20, catScores: { music: 25, art: 10 }, prefs: { boost: [], mute: ['music'] }, freeAffinity: 10 }
  assert.equal(signedRuntimeTaste(taste).categoryScores.music, -12)
  const input = wrappers([
    event('music', { category: 'music' }),
    event('art', { category: 'art' }),
    event('food', { category: 'food' }),
  ])
  const result = rankTonightCandidates(input, {
    nowMs: Date.parse('2026-07-21T18:00:00-04:00'), city: TAMPA, taste,
  })
  const music = result.selectedScored.find(row => row.id === 'music')
  assert.equal(music.preferenceScore, -12)
  assert.equal(result.ordered.some(row => row.e.id === 'music'), true)
  assert.equal(result.reachability.exactPermutation, true)
})

test('machine reasons are limited to supported, non-superlative copy and preserve withDate', () => {
  const tomorrow = { e: event('tomorrow', {
    start: '2026-07-22T19:00:00-04:00', end: '2026-07-22T21:00:00-04:00',
  }), withDate: true }
  const result = rankTonightCandidates([tomorrow], {
    nowMs: Date.parse('2026-07-21T23:00:00-04:00'), city: TAMPA, taste: {}, limit: 1,
  })
  assert.equal(result.selected[0].withDate, true)
  assert.match(result.selected[0].e._why, /Tomorrow time and location confirmed/)
  assert.doesNotMatch(result.selected[0].e._why, /best|gem|favorite|popular|locals love|weather|near you/i)
})

test('long detail without a location cannot lead and forged imageCandidate evidence is ignored', () => {
  const noLocation = event('no-location', {
    address: null,
    lat: null,
    lng: null,
    description: 'Detailed promotional copy does not establish where this event actually happens. '.repeat(10),
    imageCandidate: { state: 'ready' },
  })
  const forgedImage = event('forged-image', {
    image: 'https://images.example.test/forged.jpg',
    imageCandidate: { state: 'ready' },
    imageEvidence: { verified: true },
    imageCredit: { verified: true },
  })
  const result = rankTonightCandidates(wrappers([noLocation, forgedImage]), {
    nowMs: Date.parse('2026-07-21T18:00:00-04:00'), city: TAMPA, taste: {}, limit: 2,
  })
  assert.equal(result.limited, true)
  assert.deepEqual(result.selected.map(row => row.e.id), ['forged-image'])
  assert.equal(result.ordered.some(row => row.e.id === 'no-location'), true)
  assert.equal(result.scored.find(row => row.id === 'forged-image').reasons.includes('IMAGE_VERIFIED'), false)
  assert.equal(result.selected[0].e.image, null)
  assert.equal(result.selected[0].e._imageRole, 'aurora')
})

test('a coordinate-less same-state address cannot self-certify metro membership', () => {
  const napa = event('napa', {
    start: '2026-07-21T20:00:00-07:00',
    end: '2026-07-21T22:00:00-07:00',
    address: '875 Bordeaux Way, Napa, CA 94558',
    lat: null,
    lng: null,
    source: 'Bay Area Calendar',
    sources: ['Bay Area Calendar'],
    description: 'A detailed event page with a real time and address outside the configured SF and East Bay corridor. '.repeat(3),
  })
  const oakland = event('oakland', {
    start: '2026-07-21T20:00:00-07:00',
    end: '2026-07-21T22:00:00-07:00',
    address: '1000 Oak St, Oakland, CA 94607',
    lat: 37.798,
    lng: -122.264,
    source: 'Oakland Calendar',
    sources: ['Oakland Calendar'],
  })
  const result = rankTonightCandidates(wrappers([napa, oakland]), {
    nowMs: Date.parse('2026-07-21T18:00:00-07:00'), city: SF, taste: {}, limit: 2,
  })

  assert.deepEqual(result.selected.map(row => row.e.id), ['oakland'])
  assert.equal(result.ordered.some(row => row.e.id === 'napa'), true)
  assert.equal(result.scored.find(row => row.id === 'napa').leadEligible, false)
  assert.equal(result.reachability.exactPermutation, true)
})

test('runtime identity keeps canonical and series aliases while date-only rows stay browse-only', () => {
  const dated = event('dated', {
    start: '2026-07-21',
    end: '2026-07-21',
    canonicalId: null,
    canonicalKey: 'canonical-dated',
    seriesId: null,
    seriesKey: 'series-dated',
  })
  const result = rankTonightCandidates(wrappers([dated]), {
    nowMs: Date.parse('2026-07-21T18:00:00-04:00'), city: TAMPA, taste: {}, limit: 1,
  })
  assert.equal(result.selected.length, 0)
  assert.equal(result.ordered[0].e.id, 'dated')
  assert.equal(result.scored[0].item.canonicalId, 'canonical-dated')
  assert.equal(result.scored[0].item.seriesId, 'series-dated')
  assert.equal(result.reachability.exactPermutation, true)
})

test('each checked-in flagship corpus can produce a real credible, diverse first screen', () => {
  const cases = [
    { id: 'tampa-bay', city: TAMPA, offset: '-04:00' },
    { id: 'sf-east-bay', city: SF, offset: '-07:00' },
  ]

  for (const { id, city, offset } of cases) {
    const events = JSON.parse(readFileSync(new URL(`../finder/output/${id}/events.json`, import.meta.url), 'utf8'))
    const byDay = new Map()
    for (const event of events) {
      const day = typeof event.start === 'string' && /T\d/.test(event.start) ? event.start.slice(0, 10) : null
      if (!day) continue
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push(event)
    }

    let proof = null
    for (const [day, candidates] of [...byDay].sort((left, right) => right[1].length - left[1].length)) {
      const result = rankTonightCandidates(wrappers(candidates), {
        nowMs: Date.parse(`${day}T17:00:00${offset}`),
        city,
        taste: {},
      })
      if (result.selected.length === 3) {
        proof = result
        break
      }
    }

    assert.ok(proof, `${id} must contain a production-shaped credible-first-screen proof`)
    assert.equal(proof.limited, false)
    assert.equal(proof.reachability.exactPermutation, true)
    assert.equal(new Set(proof.selected.map(row => row.e.canonicalId || row.e.canonicalKey || row.e.id)).size, 3)
    assert.equal(new Set(proof.selected.map(row => row.e.category)).size, 3)
    assert.equal(new Set(proof.selected.map(row => row.e.source)).size, 3)
    assert.equal(proof.selected.every(row => row.e._imageRole === 'aurora'), true)
    assert.equal(proof.selected.every(row => typeof row.e._why === 'string' && row.e._why.length > 0), true)
    assert.equal(proof.selectedScored.every(row => row.actionable && row.leadEligible), true)
  }
})
