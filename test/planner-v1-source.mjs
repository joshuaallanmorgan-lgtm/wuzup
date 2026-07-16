import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PLANNER_V1_SOURCE_KEYS,
  PlannerV1SourceError,
  capturePlannerV1Source,
} from '../app/src/planner-v1-source.js'
import { createStorageScope, physicalKey } from '../app/src/storage.js'

const TAMPA = { id: 'tampa-bay', tz: 'America/New_York' }
const SF = { id: 'sf-east-bay', tz: 'America/Los_Angeles' }

class MemoryStorage {
  constructor(entries = []) {
    this.map = new Map(entries)
    this.reads = []
    this.writes = []
    this.removes = []
  }

  getItem(key) {
    this.reads.push(String(key))
    return this.map.has(String(key)) ? this.map.get(String(key)) : null
  }

  setItem(key, value) {
    this.writes.push([String(key), String(value)])
    this.map.set(String(key), String(value))
  }

  removeItem(key) {
    this.removes.push(String(key))
    this.map.delete(String(key))
  }
}

function rawFixture(overrides = {}) {
  return {
    dayPlans: '{"1784260800000":{"v":1,"slots":{"day":"e|show","night":null}}}',
    dayHistory: '[]',
    weekendPlan: 'null',
    savedEvents: '{}',
    beenThere: '[]',
    cityDayKeysBasis: null,
    cityDayKeysReceipt: null,
    ...overrides,
  }
}

function backendFor(cityRows) {
  const entries = []
  for (const [cityId, rows] of Object.entries(cityRows)) {
    for (const [field, raw] of Object.entries(rows)) {
      if (raw === null) continue
      entries.push([
        physicalKey(PLANNER_V1_SOURCE_KEYS[field], { cityId }),
        raw,
      ])
    }
  }
  return new MemoryStorage(entries)
}

const factoryFor = (backend) => ({ cityId }) => createStorageScope({ backend, cityId })

function scopeForRows(rows, calls = null) {
  return {
    peek(key) {
      calls?.push(['peek', key])
      const field = Object.keys(PLANNER_V1_SOURCE_KEYS)
        .find((name) => PLANNER_V1_SOURCE_KEYS[name] === key)
      const value = rows[field]
      return value === null || value === undefined
        ? { status: 'missing', value: null }
        : { status: 'ok', value }
    },
  }
}

function assertSourceError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof PlannerV1SourceError)
    assert.equal(error.code, code)
    return true
  })
}

test('captures only the selected city and applies strict absent defaults', () => {
  const tampaRows = rawFixture({
    dayPlans: '{"1":{"v":1,"slots":{}}}',
    savedEvents: '{"tampa":{"savedAt":1}}',
  })
  const sfRows = rawFixture({
    dayPlans: '{"2":{"v":1,"slots":{}}}',
    savedEvents: '{"sf":{"savedAt":2}}',
  })
  const backend = backendFor({
    [TAMPA.id]: tampaRows,
    [SF.id]: sfRows,
  })

  const tampa = capturePlannerV1Source({
    city: TAMPA,
    storageFactory: factoryFor(backend),
    deviceTimeZone: 'America/Chicago',
  })
  const sf = capturePlannerV1Source({
    city: SF,
    storageFactory: factoryFor(backend),
    deviceTimeZone: 'America/Denver',
  })

  assert.deepEqual(tampa.source.dayPlans, { 1: { v: 1, slots: {} } })
  assert.deepEqual(tampa.source.savedEvents, { tampa: { savedAt: 1 } })
  assert.deepEqual(sf.source.dayPlans, { 2: { v: 1, slots: {} } })
  assert.deepEqual(sf.source.savedEvents, { sf: { savedAt: 2 } })
  assert.equal(tampa.sourceTimeZone, 'America/Chicago')
  assert.equal(sf.sourceTimeZone, 'America/Denver')
  assert.equal(backend.writes.length, 0)
  assert.equal(backend.removes.length, 0)

  const absent = capturePlannerV1Source({
    city: TAMPA,
    storageFactory: () => scopeForRows({}),
    deviceTimeZone: 'America/New_York',
  })
  assert.deepEqual(absent.source, {
    dayPlans: {},
    dayHistory: [],
    weekendPlan: null,
    savedEvents: {},
    beenThere: [],
  })
  assert.deepEqual(absent.raw, {
    dayPlans: null,
    dayHistory: null,
    weekendPlan: null,
    savedEvents: null,
    beenThere: null,
    cityDayKeysBasis: null,
    cityDayKeysReceipt: null,
  })
})

test('legacy-only capture is exact and performs no copy or ownership write', () => {
  const rows = rawFixture({
    dayPlans: '{\n  "1": { "v": 1, "slots": {} }\n}',
    savedEvents: '{ "legacy": { "savedAt": 4 } }',
  })
  const backend = new MemoryStorage(
    Object.entries(rows)
      .filter(([, raw]) => raw !== null)
      .map(([field, raw]) => [`twh:${PLANNER_V1_SOURCE_KEYS[field]}`, raw]),
  )

  const captured = capturePlannerV1Source({
    city: TAMPA,
    storageFactory: factoryFor(backend),
    deviceTimeZone: TAMPA.tz,
  })

  assert.deepEqual(captured.raw, rows)
  assert.equal(backend.writes.length, 0)
  assert.equal(backend.removes.length, 0)
  assert.equal(backend.map.has('twh:v2:g:legacy-city-migration-v1'), false)
  for (const key of Object.values(PLANNER_V1_SOURCE_KEYS)) {
    assert.equal(backend.map.has(physicalKey(key, { cityId: TAMPA.id })), false)
  }
})

test('storage read failures are distinct from absent V1 data', () => {
  const backend = {
    getItem() {
      throw new Error('privacy mode')
    },
  }
  assertSourceError(
    () => capturePlannerV1Source({
      city: TAMPA,
      storageFactory: factoryFor(backend),
      deviceTimeZone: TAMPA.tz,
    }),
    'PLANNER_V1_STORAGE_READ',
  )
})

test('uses valid city metadata with basis precedence and requires agreement', () => {
  const metadata = {
    v: 1,
    cityId: TAMPA.id,
    timeZone: TAMPA.tz,
    sourceDeviceTimeZone: 'America/Los_Angeles',
  }
  const both = rawFixture({
    cityDayKeysBasis: JSON.stringify(metadata),
    cityDayKeysReceipt: JSON.stringify(metadata),
  })
  const result = capturePlannerV1Source({
    city: TAMPA,
    storageFactory: () => scopeForRows(both),
    deviceTimeZone: 'America/Chicago',
  })
  assert.equal(result.sourceTimeZone, 'America/Los_Angeles')

  const receiptOnly = rawFixture({
    cityDayKeysReceipt: JSON.stringify({
      ...metadata,
      sourceDeviceTimeZone: 'America/Denver',
    }),
  })
  const receipt = capturePlannerV1Source({
    city: TAMPA,
    storageFactory: () => scopeForRows(receiptOnly),
  })
  assert.equal(receipt.sourceTimeZone, 'America/Denver')

  const conflict = rawFixture({
    cityDayKeysBasis: JSON.stringify(metadata),
    cityDayKeysReceipt: JSON.stringify({
      ...metadata,
      sourceDeviceTimeZone: 'America/Denver',
    }),
  })
  assertSourceError(
    () => capturePlannerV1Source({
      city: TAMPA,
      storageFactory: () => scopeForRows(conflict),
    }),
    'PLANNER_V1_METADATA_CONFLICT',
  )
})

test('refuses corrupt, mismatched, or invalid time metadata instead of guessing', () => {
  const valid = {
    v: 1,
    cityId: TAMPA.id,
    timeZone: TAMPA.tz,
    sourceDeviceTimeZone: 'America/New_York',
  }
  const cases = [
    ['{', 'PLANNER_V1_CORRUPT_METADATA'],
    [JSON.stringify({ ...valid, v: 2 }), 'PLANNER_V1_INVALID_METADATA'],
    [JSON.stringify({ ...valid, cityId: SF.id }), 'PLANNER_V1_INVALID_METADATA'],
    [JSON.stringify({ ...valid, timeZone: SF.tz }), 'PLANNER_V1_INVALID_METADATA'],
    [JSON.stringify({ ...valid, sourceDeviceTimeZone: 'Mars/Olympus' }), 'PLANNER_V1_INVALID_METADATA'],
  ]
  for (const [basis, code] of cases) {
    const rows = rawFixture({ cityDayKeysBasis: basis })
    assertSourceError(
      () => capturePlannerV1Source({
        city: TAMPA,
        storageFactory: () => scopeForRows(rows),
      }),
      code,
    )
  }

  assertSourceError(
    () => capturePlannerV1Source({
      city: TAMPA,
      storageFactory: () => scopeForRows({}),
      deviceTimeZone: 'Not/AZone',
    }),
    'PLANNER_V1_INVALID_DEVICE_TIME_ZONE',
  )
})

test('refuses malformed JSON and every wrong source top-level shape', () => {
  const malformed = rawFixture({ dayPlans: '{"broken"' })
  assertSourceError(
    () => capturePlannerV1Source({
      city: TAMPA,
      storageFactory: () => scopeForRows(malformed),
    }),
    'PLANNER_V1_CORRUPT_SOURCE',
  )

  const wrongShapes = {
    dayPlans: '[]',
    dayHistory: '{}',
    weekendPlan: '[]',
    savedEvents: 'null',
    beenThere: '{}',
  }
  for (const [field, value] of Object.entries(wrongShapes)) {
    const rows = rawFixture({ [field]: value })
    assertSourceError(
      () => capturePlannerV1Source({
        city: TAMPA,
        storageFactory: () => scopeForRows(rows),
      }),
      'PLANNER_V1_INVALID_SOURCE',
    )
  }
})

test('preserves exact raw bytes, never invokes writers, and keeps weekend data intact', () => {
  const weekend = {
    v: 1,
    weekendStartTs: 1_784_332_800_000,
    slots: {
      fri_day: 'event|one',
      fri_night: null,
      sat_day: 'place|two',
      sat_night: null,
      sun_day: null,
      sun_night: 'event|three',
    },
    done: true,
    retainedUnknownField: { exact: true },
  }
  const rows = rawFixture({
    dayPlans: '{\n  "1": { "v": 1, "slots": {} }\n}',
    dayHistory: '[\n]',
    weekendPlan: `  ${JSON.stringify(weekend)}\n`,
    savedEvents: '{ "event|one": { "savedAt": 7 } }',
    beenThere: '[ { "key": "old" } ]',
  })
  const calls = []
  const scope = {
    ...scopeForRows(rows, calls),
    set() {
      calls.push(['set'])
      throw new Error('must not write')
    },
    remove() {
      calls.push(['remove'])
      throw new Error('must not remove')
    },
  }

  const result = capturePlannerV1Source({
    city: TAMPA,
    storageFactory: ({ cityId }) => {
      assert.equal(cityId, TAMPA.id)
      return scope
    },
    deviceTimeZone: 'America/New_York',
  })

  assert.deepEqual(result.raw, rows)
  assert.deepEqual(result.source.weekendPlan, weekend)
  assert.deepEqual(
    calls,
    Object.values(PLANNER_V1_SOURCE_KEYS).map((key) => ['peek', key]),
  )
  assert.equal(result.raw.weekendPlan, `  ${JSON.stringify(weekend)}\n`)
})
