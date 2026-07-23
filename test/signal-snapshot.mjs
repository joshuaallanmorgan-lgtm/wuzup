import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildSignalSnapshot,
  compareSignalSnapshots,
  SIGNAL_SNAPSHOT_CODES,
  validateSignalSnapshot,
} from '../shared/signal-snapshot.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function event(id, overrides = {}) {
  return {
    id,
    canonicalId: `canonical:${id}`,
    seriesId: null,
    sourceFamily: 'city-calendar',
    sourceFamilies: ['city-calendar'],
    organizer: 'City Arts',
    status: 'scheduled',
    start: '2026-07-21T19:00:00-04:00',
    end: null,
    category: 'music',
    rawCategories: ['concert'],
    url: `https://events.example.test/${id}`,
    actionable: true,
    ...overrides,
  }
}

function snapshot(events, overrides = {}) {
  return buildSignalSnapshot({
    cityId: 'fixture-city',
    timeZone: 'America/New_York',
    generatedAt: '2026-07-20T12:00:00.000Z',
    buildId: 'sha256:fixture',
    events,
    ...overrides,
  })
}

test('creates a deterministic stable-ID ordered payload and content hash', () => {
  const first = snapshot([event('event:z'), event('event:a')])
  const second = snapshot([event('event:a'), event('event:z')])

  assert.deepEqual(first, second)
  assert.deepEqual(first.events.map((item) => item.id), ['event:a', 'event:z'])
  assert.equal(validateSignalSnapshot(first).valid, true)
})

test('validates date-only, offset, and zoneless city times without the device timezone', () => {
  const synthetic = snapshot([
    event('event:date-only', { start: '2026-07-07', end: null }),
    event('event:offset', { start: '2026-07-07T10:00:00-04:00', end: null }),
    event('event:local', { start: '2026-07-07T10:00:00', end: '2026-07-07T11:05:00' }),
    event('event:fold', { start: '2026-11-01T01:30:00', end: null }),
  ])
  assert.deepEqual(synthetic.events.map((item) => item.start), [
    '2026-07-07',
    '2026-11-01T01:30:00',
    '2026-07-07T10:00:00',
    '2026-07-07T10:00:00-04:00',
  ])
  assert.equal(validateSignalSnapshot(synthetic).valid, true)

  const artifactEvents = JSON.parse(readFileSync(path.join(ROOT, 'app', 'public', 'events.json'), 'utf8'))
  const artifactEvent = artifactEvents.find((candidate) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(candidate.start))
  assert.ok(artifactEvent, 'committed Tampa artifact must retain a zoneless city-local event time')
  const retained = snapshot([event('event:artifact-local', { start: artifactEvent.start, end: artifactEvent.end })])
  assert.equal(retained.events[0].start, artifactEvent.start)
  assert.equal(retained.events[0].end, artifactEvent.end)
  assert.equal(validateSignalSnapshot(retained).valid, true)
  assert.throws(() => snapshot([event('event:invalid-local', { start: '2026-07-07T10:00', end: null })]), /event.start is invalid/)
})

test('rejects calendar rollovers and nonexistent DST wall times during build and validation', () => {
  assert.throws(
    () => snapshot([event('event:invalid-day', { start: '2026-02-30T10:00:00-05:00', end: null })]),
    /event.start is invalid/,
  )
  assert.throws(
    () => snapshot([event('event:dst-gap', { start: '2026-03-08T02:30:00', end: null })]),
    /event.start is invalid/,
  )

  const invalidAfterBuild = structuredClone(snapshot([event('event:valid')]))
  invalidAfterBuild.events[0].start = '2026-02-30'
  const validation = validateSignalSnapshot(invalidAfterBuild)
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.includes(SIGNAL_SNAPSHOT_CODES.EVENT_INVALID))
})

test('retains only bounded signal facts and excludes sensitive presentation fields', () => {
  const result = snapshot([event('event:one', {
    description: 'Private description that must not be copied',
    image: 'https://images.example.test/secret.jpg',
    address: '123 Full Street',
    apiToken: 'not-a-snapshot-field',
    firstSeen: '2026-07-01T00:00:00.000Z',
    seenAt: '2026-07-20T12:00:00.000Z',
  })])
  const facts = result.events[0]

  assert.equal(facts.urlHost, 'events.example.test')
  assert.equal(facts.actionability, true)
  assert.equal(facts.firstSeen, '2026-07-01T00:00:00.000Z')
  assert.equal(facts.seenAt, '2026-07-20T12:00:00.000Z')
  for (const forbidden of ['description', 'image', 'address', 'apiToken', 'url', 'actionable']) {
    assert.equal(Object.hasOwn(facts, forbidden), false)
  }
})

test('fails duplicate stable IDs and validates malformed city, timezone, ISO, and hash inputs', () => {
  assert.throws(() => snapshot([event('event:duplicate'), event('event:duplicate')]), /unique/)

  const invalid = structuredClone(snapshot([event('event:one')]))
  invalid.cityId = 'Invalid city'
  invalid.timeZone = 'Mars/Olympus_Mons'
  invalid.generatedAt = 'not-an-iso-time'
  invalid.contentSha256 = 'sha256:bad'
  const validation = validateSignalSnapshot(invalid)

  assert.equal(validation.valid, false)
  for (const code of [
    SIGNAL_SNAPSHOT_CODES.CITY_INVALID,
    SIGNAL_SNAPSHOT_CODES.TIME_ZONE_INVALID,
    SIGNAL_SNAPSHOT_CODES.GENERATED_AT_INVALID,
    SIGNAL_SNAPSHOT_CODES.HASH_INVALID,
  ]) assert.ok(validation.errors.includes(code))
})

test('refuses cross-city and invalid-order history instead of inventing deltas', () => {
  const previous = snapshot([event('event:one')])
  const crossCity = snapshot([event('event:one')], {
    cityId: 'other-city', generatedAt: '2026-07-21T12:00:00.000Z',
  })
  const reversed = structuredClone(snapshot([event('event:a'), event('event:b')]))
  reversed.events.reverse()

  assert.deepEqual(compareSignalSnapshots(previous, crossCity), {
    state: 'unavailable', reasons: [SIGNAL_SNAPSHOT_CODES.CITY_MISMATCH],
  })
  const unavailable = compareSignalSnapshots(previous, reversed)
  assert.equal(unavailable.state, 'unavailable')
  assert.ok(unavailable.reasons.includes(`CURRENT_${SIGNAL_SNAPSHOT_CODES.EVENTS_NOT_SORTED}`))
  assert.ok(unavailable.reasons.includes(`CURRENT_${SIGNAL_SNAPSHOT_CODES.HASH_INVALID}`))
})

test('refuses equal or reverse snapshot times before producing history deltas', () => {
  const previous = snapshot([event('event:one')])
  const equal = snapshot([event('event:two')])
  const reverse = snapshot([event('event:two')], { generatedAt: '2026-07-19T12:00:00.000Z' })

  for (const current of [equal, reverse]) {
    const comparison = compareSignalSnapshots(previous, current)
    assert.equal(comparison.state, 'unavailable')
    assert.ok(comparison.reasons.includes(SIGNAL_SNAPSHOT_CODES.HISTORY_ORDER_INVALID))
  }
})

test('reports truthful presence, organizer, and source deltas without popularity claims', () => {
  const previous = snapshot([
    event('event:old', { organizer: 'Old Org', sourceFamily: 'source-a', sourceFamilies: ['source-a'] }),
    event('event:keep', { organizer: 'Keep Org', sourceFamily: 'source-a', sourceFamilies: ['source-a'] }),
  ])
  const current = snapshot([
    event('event:keep', { organizer: 'Keep Org', sourceFamily: 'source-b', sourceFamilies: ['source-b'] }),
    event('event:new', { organizer: 'New Org', sourceFamily: 'source-b', sourceFamilies: ['source-b'] }),
  ], { generatedAt: '2026-07-21T12:00:00.000Z' })
  const comparison = compareSignalSnapshots(previous, current)

  assert.equal(comparison.state, 'available')
  assert.deepEqual(comparison.addedIds, ['event:new'])
  assert.deepEqual(comparison.removedIds, ['event:old'])
  assert.deepEqual(comparison.persistedIds, ['event:keep'])
  assert.deepEqual(comparison.organizerDeltas, [
    { organizer: 'New Org', previous: 0, current: 1, delta: 1 },
    { organizer: 'Old Org', previous: 1, current: 0, delta: -1 },
  ])
  assert.deepEqual(comparison.sourceFamilyDeltas, [
    { sourceFamily: 'source-a', previous: 2, current: 0, delta: -2 },
    { sourceFamily: 'source-b', previous: 0, current: 2, delta: 2 },
  ])
  assert.match(comparison.interpretation, /not popularity measurements/)
})
