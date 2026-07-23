import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CITIES } from '../app/src/city.js'
import { isOpenNow } from '../app/src/places.js'
import {
  inspectSpotContext,
  rankSpots,
  SPOT_NEAR_RADIUS_MILES,
  spotHoursConfidence,
} from '../app/src/spot-context.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOW_MS = Date.parse('2026-07-21T16:00:00.000Z')
const CITY = CITIES['tampa-bay']
const COORDS = Object.freeze({ lat: 27.95, lng: -82.46 })

function place(id, overrides = {}) {
  return {
    key: `p|${id}`,
    kind: 'place',
    name: id.replace(/-/g, ' '),
    title: id.replace(/-/g, ' '),
    placeType: 'park',
    category: 'outdoors',
    lat: 27.95,
    lng: -82.46,
    classes: ['park'],
    amenities: [],
    sources: ['OSM'],
    srcCount: 1,
    ...overrides,
  }
}

function keys(rows) {
  return rows.map(row => row.key)
}

test('spot context exposes bounded activity, amenity, hours, and explicit-radius distance facts', () => {
  const activity = { id: 'act-water', match: item => item.amenities.includes('fishing') }
  const rows = [place('pier', {
    lat: 27.99,
    amenities: ['fishing', 'restrooms', 'ada', 'picnic'],
    hours: '24/7',
  })]
  const inspection = inspectSpotContext(rows, {
    coords: COORDS,
    radiusMiles: SPOT_NEAR_RADIUS_MILES,
    activity,
    nowMs: NOW_MS,
    timeZone: CITY.tz,
    mode: 'nearby',
  })
  const fact = inspection.factsById['p|pier']

  assert.equal(fact.activityFit, true)
  assert.equal(fact.amenityCount, 4)
  assert.equal(fact.hours.state, 'open-confirmed')
  assert.equal(fact.withinRadius, true)
  assert.ok(fact.distanceMiles > 0)
  assert.equal(fact.components.activity, 6)
  assert.equal(fact.components.amenities, 3)
  assert.equal(fact.components.hours, 2)
  assert.ok(fact.components.distance <= 3)
  assert.ok(fact.score <= 14)
})

test('unknown or complex hours never become an open claim', () => {
  const unknown = spotHoursConfidence(place('unknown', { hours: '' }), { nowMs: NOW_MS, timeZone: CITY.tz })
  const complex = spotHoursConfidence(place('weekday', { hours: 'Monday - Friday 10 am - 8 pm' }), { nowMs: NOW_MS, timeZone: CITY.tz })
  const always = spotHoursConfidence(place('always', { hours: '24/7' }), { nowMs: NOW_MS, timeZone: CITY.tz })

  assert.deepEqual(unknown, { state: 'unknown', listed: false, openConfirmed: false })
  assert.deepEqual(complex, { state: 'listed-unconfirmed', listed: true, openConfirmed: false })
  assert.deepEqual(always, { state: 'open-confirmed', listed: true, openConfirmed: true })
  assert.equal(isOpenNow({ hours: '' }, { nowMs: NOW_MS, timeZone: CITY.tz }), false)
  assert.equal(isOpenNow({ hours: 'Monday - Friday 10 am - 8 pm' }, { nowMs: NOW_MS, timeZone: CITY.tz }), false)
})

test('quality and useful context beat raw proximity while generic and chain rows remain reachable', () => {
  const rows = [
    place('generic', { name: 'Park', lat: 27.9501 }),
    place('chain', {
      name: 'Chain Cafe',
      placeType: 'cafe',
      category: 'food',
      lat: 27.951,
      isChain: true,
      address: '1 Main Street, Tampa, FL',
      description: 'A fully described cafe with seating, published details, and a stable address for visitors.',
      amenities: ['ada'],
    }),
    place('useful', {
      lat: 28.02,
      address: '100 River Road, Tampa, FL',
      description: 'A substantial public destination with trails, restrooms, picnic areas, and published access information for visitors.',
      amenities: ['hiking', 'restrooms', 'picnic'],
      hours: '24/7',
      sources: ['City Parks', 'OSM'],
      srcCount: 2,
      operator: 'City Parks',
    }),
  ]
  const ranking = rankSpots(rows, {
    nowMs: NOW_MS,
    city: CITY,
    coords: COORDS,
    radiusMiles: SPOT_NEAR_RADIUS_MILES,
    attachDistance: true,
    mode: 'nearby',
  })

  assert.equal(ranking.ordered[0].key, 'p|useful')
  assert.deepEqual(new Set(keys(ranking.ordered)), new Set(keys(rows)))
  assert.equal(ranking.reachability.exactPermutation, true)
  assert.equal(ranking.reachability.inputCount, rows.length)
  assert.equal(ranking.reachability.outputCount, rows.length)
  assert.equal(ranking.withinRadius.length, rows.length)
  assert.equal(ranking.scored.find(row => row.id === 'p|generic').leadEligible, false)
  assert.ok(ranking.scored.find(row => row.id === 'p|chain').reasons.includes('CHAIN'))
  assert.ok(ranking.ordered.every(row => Number.isFinite(row._dist)))
})

test('near membership requires coordinates and never invents a distance', () => {
  const rows = [place('one'), place('two', { lat: 28.3 })]
  const unlocated = rankSpots(rows, {
    nowMs: NOW_MS,
    city: CITY,
    coords: null,
    attachDistance: true,
    mode: 'nearby',
  })
  const malformedFix = rankSpots(rows, {
    nowMs: NOW_MS,
    city: CITY,
    coords: { lat: '27.95', lng: null },
    attachDistance: true,
    mode: 'nearby',
  })
  const located = rankSpots(rows, {
    nowMs: NOW_MS,
    city: CITY,
    coords: COORDS,
    radiusMiles: 5,
    attachDistance: true,
    mode: 'nearby',
  })

  assert.deepEqual(unlocated.withinRadius, [])
  assert.ok(unlocated.ordered.every(row => row._dist == null))
  assert.deepEqual(malformedFix.withinRadius, [])
  assert.equal(malformedFix.contextInspection.hasLocationFix, false)
  assert.ok(malformedFix.ordered.every(row => row._dist == null))
  assert.deepEqual(keys(located.withinRadius), ['p|one'])
  assert.equal(located.reachability.outputCount, 2)
})

test('activity fit is inspectable context and does not hide mismatches', () => {
  const rows = [
    place('court', { amenities: ['tennis'], address: '1 Court Way, Tampa, FL' }),
    place('trail', { amenities: ['hiking'], address: '2 Trail Way, Tampa, FL' }),
  ]
  const activity = { id: 'act-sports', match: item => item.amenities.includes('tennis') }
  const ranking = rankSpots(rows, {
    nowMs: NOW_MS,
    city: CITY,
    activity,
    mode: 'activity',
  })

  assert.equal(ranking.ordered[0].key, 'p|court')
  assert.equal(ranking.contextInspection.factsById['p|court'].activityFit, true)
  assert.equal(ranking.contextInspection.factsById['p|trail'].activityFit, false)
  assert.equal(ranking.reachability.exactPermutation, true)
})

test('image availability and credit never affect spot order', () => {
  const rows = [
    place('alpha', { address: '1 Alpha Road, Tampa, FL', amenities: ['picnic'] }),
    place('beta', { address: '2 Beta Road, Tampa, FL', amenities: ['hiking', 'restrooms'] }),
    place('gamma', { address: '3 Gamma Road, Tampa, FL', hours: '24/7' }),
  ]
  const photographed = rows.map((row, index) => index === 0
    ? { ...row, image: 'https://images.example.test/alpha.jpg', imageCredit: { license: 'CC0' } }
    : row)
  const swapped = rows.map((row, index) => index === 1
    ? { ...row, image: 'https://images.example.test/beta.jpg', imageCredit: { license: 'CC0' } }
    : row)
  const options = { nowMs: NOW_MS, city: CITY, coords: COORDS, mode: 'browse' }

  assert.deepEqual(keys(rankSpots(photographed, options).ordered), keys(rankSpots(swapped, options).ordered))
})

test('both committed flagship place artifacts preserve every key through shared ranking', () => {
  for (const cityId of ['tampa-bay', 'sf-east-bay']) {
    const document = JSON.parse(fs.readFileSync(path.join(ROOT, 'finder', 'output', cityId, 'places.json'), 'utf8'))
    const rows = document.places
    const ranking = rankSpots(rows, {
      nowMs: NOW_MS,
      city: CITIES[cityId],
      mode: 'browse',
      diversityPolicy: { prefix: 20, sourceMax: 6, categoryMax: 8, venueMax: 1, canonicalMax: 1, seriesMax: 1 },
    })

    assert.equal(ranking.reachability.exactPermutation, true, cityId)
    assert.equal(ranking.ordered.length, rows.length, cityId)
    assert.deepEqual(new Set(keys(ranking.ordered)), new Set(keys(rows)), cityId)
  }
})

test('all existing Spots result paths use shared rank without photo, raw taste, or nearest-first forks', () => {
  const source = name => fs.readFileSync(path.join(ROOT, 'app', 'src', name), 'utf8')
  const locations = source('LocationsView.jsx')
  const bubble = source('PlaceBubblePage.jsx')
  const detail = source('PlaceDetail.jsx')
  const places = source('places.js')

  assert.ok((locations.match(/rankSpots\(/g) || []).length >= 4)
  assert.match(bubble, /rankSpots\(matched/)
  assert.match(detail, /rankSpots\(matched/)
  for (const code of [locations, bubble]) {
    assert.doesNotMatch(code, /photoFirst|tasteNudge|srcCount\s*\|\||\.sort\(/)
  }
  assert.doesNotMatch(detail, /Math\.hypot|\.sort\(\(a, b\) => a\.d - b\.d\)/)
  assert.match(locations, /hasLocationFix \? nearbyRanking\.withinRadius\.slice\(0, 3\) : all\.slice\(0, 3\)/)
  assert.match(locations, /Within \$\{SPOT_NEAR_RADIUS_MILES\} miles/)
  assert.doesNotMatch(locations, /photos shown first|available photos|Worth the drive|Recommended near you/i)
  assert.doesNotMatch(locations, /driveSpots|Sunset Views|Hidden gems/)
  assert.match(bubble, /coords: location\.usableCoords/)
  assert.match(places, /label: 'Hours listed'/)
  assert.doesNotMatch(places, /label: 'Open Now'/i)
})
