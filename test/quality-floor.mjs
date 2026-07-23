import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { annotateQualityFloor, assessTopSample } from '../shared/quality-floor.mjs'
import { bbox as tampaBbox, tz as tampaTimeZone } from '../finder/cities/tampa-bay.mjs'
import { bbox as sfBbox, tz as sfTimeZone } from '../finder/cities/sf-east-bay.mjs'

const NOW = Date.parse('2026-07-21T02:00:00.000Z')
const MARKET = {
  id: 'tampa-bay',
  bbox: { latMin: 27, latMax: 28, lngMin: -83, lngMax: -82 },
  regionCodes: ['FL'],
}
const CA_MARKET = {
  id: 'sf-east-bay',
  bbox: { latMin: 37, latMax: 38, lngMin: -123, lngMax: -121 },
  regionCodes: ['CA'],
}

function policy(kind, overrides = {}) {
  return {
    kind,
    nowMs: NOW,
    timeZone: 'America/New_York',
    market: MARKET,
    knownJunkIds: [],
    knownFalseMergeIds: [],
    ...overrides,
  }
}

function event(id, overrides = {}) {
  return {
    id,
    start: '2026-07-20T23:30:00',
    end: '2026-07-21T01:00:00',
    lat: 27.5,
    lng: -82.5,
    ...overrides,
  }
}

function place(id, overrides = {}) {
  return { id, lat: 27.5, lng: -82.5, ...overrides }
}

test('event actionability is anchored to the explicit city timezone, not a device clock', () => {
  const rows = annotateQualityFloor([event('future-local')], policy('events'))
  assert.equal(rows[0].decisionEligible, true)
  assert.deepEqual(rows[0].qualityFloor.blockerCodes, [])

  const blocked = annotateQualityFloor([
    event('bad-time', { start: 'not-a-time' }),
    event('cancelled', { status: 'cancelled' }),
    event('ended', { start: '2026-07-20T18:00:00', end: '2026-07-20T19:00:00' }),
  ], policy('events'))
  assert.deepEqual(blocked.map(row => row.qualityFloor.blockerCodes), [
    ['INVALID_EVENT_TIME'],
    ['EVENT_CANCELLED'],
    ['EVENT_ENDED'],
  ])
})

test('bbox edges are eligible while outside coordinates block and coordless rows remain unknown', () => {
  const rows = annotateQualityFloor([
    place('edge', { lat: 27, lng: -82 }),
    place('outside', { lat: 28.001, lng: -82.5 }),
    place('coordless', { lat: null, lng: null }),
  ], policy('places'))
  assert.deepEqual(rows.map(row => [row.id, row.decisionEligible, row.qualityFloor.blockerCodes]), [
    ['edge', true, []],
    ['outside', false, ['OUTSIDE_MARKET_BBOX']],
    ['coordless', true, []],
  ])
})

test('only explicit market and address-market evidence can block a coordless row', () => {
  const rows = annotateQualityFloor([
    event('explicit-address', { lat: null, lng: null, addressMarketId: 'tampa-bay' }),
    event('address-text-only', { lat: null, lng: null, address: 'Oakland, CA' }),
  ], policy('events', { market: CA_MARKET }))
  assert.deepEqual(rows.map(row => row.qualityFloor.blockerCodes), [
    ['ADDRESS_MARKET_CONFLICT'],
    [],
  ])
})

test('a conservative terminal US-state parser blocks explicit out-of-region addresses only', () => {
  const rows = annotateQualityFloor([
    place('maine', { lat: null, lng: null, address: 'Oakland, ME' }),
    place('california', { lat: null, lng: null, address: 'Oakland, CA 94607, USA' }),
    place('unknown', { lat: null, lng: null, address: 'Oakland' }),
  ], policy('places', { market: CA_MARKET }))
  assert.deepEqual(rows.map(row => row.qualityFloor.blockerCodes), [
    ['ADDRESS_MARKET_CONFLICT'],
    [],
    [],
  ])
})

test('the policy rejects invalid timezone and region declarations before annotation', () => {
  assert.throws(() => annotateQualityFloor([], policy('places', { timeZone: 'Mars/Olympus' })), /timeZone/)
  assert.throws(() => annotateQualityFloor([], policy('places', { market: { ...MARKET, regionCodes: ['XX'] } })), /regionCodes/)
})

test('denylisted rows are retained and independently annotated', () => {
  const rows = annotateQualityFloor([
    place('junk'),
    place('false-merge'),
    place('both'),
  ], policy('places', { knownJunkIds: ['junk', 'both'], knownFalseMergeIds: ['false-merge', 'both'] }))
  assert.deepEqual(rows.map(row => row.qualityFloor.blockerCodes), [
    ['KNOWN_JUNK'],
    ['KNOWN_FALSE_MERGE'],
    ['KNOWN_JUNK', 'KNOWN_FALSE_MERGE'],
  ])
  assert.equal(rows.length, 3)
})

test('annotation preserves count, order, identity, and explicit demotion evidence without ranking', () => {
  const input = [
    Object.freeze(place('first', { isChain: true, isRecurring: true })),
    Object.freeze(place('second', { lowInformation: true, isGeneric: true, isBusiness: true })),
  ]
  const rows = annotateQualityFloor(input, policy('places'))
  assert.equal(rows.length, input.length)
  assert.deepEqual(rows.map(row => row.id), input.map(row => row.id))
  assert.notEqual(rows[0], input[0])
  assert.deepEqual(rows.map(row => row.qualityFloor.demotionCodes), [
    ['CHAIN', 'RECURRING'],
    ['LOW_INFORMATION', 'GENERIC', 'BUSINESS'],
  ])
  assert.equal(rows.every(row => row.decisionEligible), true)
})

test('top-sample reporting passes only with zero blockers or explicit limited-city truth', () => {
  const rows = annotateQualityFloor([place('good'), place('bad', { lat: 30 })], policy('places'))
  assert.deepEqual(assessTopSample(rows, { limit: 2 }), {
    limit: 2,
    sampleCount: 2,
    cityLimited: false,
    blockers: [{ id: 'bad', codes: ['OUTSIDE_MARKET_BBOX'] }],
    blockerIds: ['bad'],
    state: 'blocked',
    passes: false,
  })
  const limited = assessTopSample(rows, { limit: 2, cityLimited: true })
  assert.equal(limited.state, 'blocked')
  assert.equal(limited.passes, false)
})

function frozenKnownBadIds(fixture, kind) {
  return [...new Set(fixture.cases
    .filter((entry) => entry.context.kind === kind)
    .flatMap((entry) => entry.candidates)
    .filter((candidate) => candidate.labels.knownBad)
    .map((candidate) => candidate.id))]
}

test('pinned Tampa and SF event/place decision prefixes have zero objective blocker leakage', async () => {
  const cities = [
    { id: 'tampa-bay', timeZone: tampaTimeZone, bbox: tampaBbox, regionCodes: ['FL'] },
    { id: 'sf-east-bay', timeZone: sfTimeZone, bbox: sfBbox, regionCodes: ['CA'] },
  ]
  for (const city of cities) {
    const manifest = JSON.parse(await readFile(`finder/output/${city.id}/artifact-manifest.json`, 'utf8'))
    const fixture = JSON.parse(await readFile(`test/fixtures/relevance/${city.id}.v1.json`, 'utf8'))
    const artifacts = {
      events: JSON.parse(await readFile(`finder/output/${city.id}/events.json`, 'utf8')),
      places: JSON.parse(await readFile(`finder/output/${city.id}/places.json`, 'utf8')).places
        .map((row) => ({ ...row, id: row.id || row.key })),
    }
    for (const kind of ['events', 'places']) {
      const fixtureKind = kind === 'events' ? 'event' : 'place'
      const knownBadIds = frozenKnownBadIds(fixture, fixtureKind)
      const annotated = annotateQualityFloor(artifacts[kind], {
        kind,
        nowMs: Date.parse(manifest.artifacts[kind].generatedAt || manifest.generatedAt),
        timeZone: city.timeZone,
        market: { id: city.id, bbox: city.bbox, regionCodes: city.regionCodes },
        knownJunkIds: knownBadIds,
        knownFalseMergeIds: [],
      })
      const top = annotated.filter((row) => row.decisionEligible).slice(0, 50)
      const report = assessTopSample(top, { limit: 50, cityLimited: top.length < 50 })
      assert.equal(report.passes, true, `${city.id} ${kind}`)
      assert.deepEqual(report.blockerIds, [], `${city.id} ${kind}`)
      assert.equal(top.some((row) => knownBadIds.includes(row.id)), false, `${city.id} ${kind}`)
      for (const id of knownBadIds) {
        const present = annotated.find((row) => row.id === id)
        if (present) assert.equal(present.decisionEligible, false, `${city.id} ${kind} ${id}`)
      }
    }
  }
})
