import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addCalendarDays,
  cityMidnightMs,
} from '../shared/city-time.mjs'
import { migrateV1PlannerState } from '../app/src/planner-migration.js'
import {
  PLANNER_DOCUMENT_MAX_BYTES,
  slotRefOf,
} from '../app/src/planner-core.js'

const CITY = { id: 'tampa-bay', tz: 'America/New_York' }
const SOURCE_TZ = 'America/Los_Angeles'
const cityTs = (dayId) => cityMidnightMs(dayId, CITY.tz)
const sourceTs = (dayId) => cityMidnightMs(dayId, SOURCE_TZ)

const CURRENT_URL = 'https://fixture.test/current-show'
const OLD_EVENT = 'https://fixture.test/old-show|2026-07-17T19:00:00-04:00'
const CURRENT_EVENT = `${CURRENT_URL}|2026-07-17T19:00:00-04:00`
const PLACE = 'p|riverwalk-park'
const CUSTOM = 'Backyard vinyl night|2026-07-18T15:00:00-04:00'
const MISSING = 'https://fixture.test/removed|2026-07-17T20:00:00-04:00'
const AMBIGUOUS = 'https://fixture.test/shared|2026-07-19T20:00:00-04:00'
const DROPPED = 'https://fixture.test/dropped|2026-07-17T14:00:00-04:00'

const catalog = [
  {
    id: '1111111111111111',
    title: 'Current live show',
    url: CURRENT_URL,
    start: '2026-07-17T19:00:00-04:00',
    venue: 'The Current',
  },
  {
    kind: 'place',
    key: PLACE,
    name: 'Riverwalk Park',
    title: 'Riverwalk Park',
    category: 'outdoors',
  },
  {
    kind: 'custom',
    localId: 'custom001',
    title: 'Backyard vinyl night',
    start: '2026-07-18T15:00:00-04:00',
    source: 'Added by you',
  },
  {
    id: 'aaaaaaaaaaaaaaaa',
    title: 'Shared listing A',
    url: 'https://fixture.test/shared',
    start: '2026-07-19T20:00:00-04:00',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    title: 'Shared listing B',
    url: 'https://fixture.test/shared',
    start: '2026-07-19T20:00:00-04:00',
  },
]

const seeds = [{
  kind: 'event',
  primary: 'e|1111111111111111',
  aliases: ['e|1111111111111111', OLD_EVENT, CURRENT_EVENT],
}]

const ternary = (slots, extra = {}) => ({
  v: 1,
  state: null,
  slots: { morning: null, afternoon: null, night: null, ...slots },
  done: false,
  ...extra,
})

const binary = (day, night, extra = {}) => ({
  v: 1,
  state: null,
  slots: { day, night },
  done: false,
  ...extra,
})

function sourceFixture() {
  return {
    dayPlans: {
      [String(cityTs('2026-07-17'))]: ternary({
        morning: PLACE,
        afternoon: OLD_EVENT,
      }),
      [String(sourceTs('2026-07-17'))]: binary(DROPPED, MISSING, { done: true }),
      [String(sourceTs('2026-07-16'))]: binary(OLD_EVENT, null),
    },
    dayHistory: [
      {
        dayTs: cityTs('2026-07-15'),
        ...ternary({ afternoon: OLD_EVENT }, { done: true }),
      },
      {
        dayTs: sourceTs('2026-07-15'),
        ...binary(DROPPED, MISSING),
      },
      {
        dayTs: cityTs('2026-07-16'),
        ...binary(MISSING, null, { done: true }),
      },
    ],
    weekendPlan: {
      v: 1,
      weekendStartTs: sourceTs('2026-07-17'),
      slots: {
        fri_day: CUSTOM,
        fri_night: AMBIGUOUS,
        sat_day: CUSTOM,
        sat_night: null,
        sun_day: null,
        sun_night: AMBIGUOUS,
      },
      done: true,
    },
    savedEvents: {
      [MISSING]: {
        savedAt: 10,
        snapshot: {
          title: 'Removed but saved',
          start: '2026-07-17T20:00:00-04:00',
          url: 'https://fixture.test/removed',
          category: 'music',
        },
      },
    },
    beenThere: [{
      key: AMBIGUOUS,
      archivedAt: 20,
      snapshot: {
        title: 'Shared listing snapshot',
        start: '2026-07-19T20:00:00-04:00',
        url: 'https://fixture.test/shared',
      },
    }],
  }
}

const options = {
  city: CITY,
  sourceTimeZone: SOURCE_TZ,
  todayTs: cityTs('2026-07-17'),
  weekendStartTs: cityTs('2026-07-17'),
  catalog,
  seeds,
}

test('projects device-midnight days, keeps canonical slots, folds the current weekend, and rolls past plans safely', () => {
  const result = migrateV1PlannerState(sourceFixture(), options)
  const friday = result.document.active[String(cityTs('2026-07-17'))]
  const saturday = result.document.active[String(cityTs('2026-07-18'))]
  const sunday = result.document.active[String(cityTs('2026-07-19'))]

  assert.equal(result.document.v, 2)
  assert.equal(result.document.rev, 1)
  assert.deepEqual(Object.keys(result.document.active), [
    String(cityTs('2026-07-17')),
    String(cityTs('2026-07-18')),
    String(cityTs('2026-07-19')),
  ])

  assert.equal(friday.done, true)
  assert.equal(friday.slots.morning.kind, 'place')
  assert.equal(friday.slots.morning.primary, PLACE)
  assert.equal(friday.slots.morning.snapshot.name, 'Riverwalk Park')
  assert.equal(friday.slots.afternoon.primary, 'e|1111111111111111')
  assert.equal(friday.slots.afternoon.snapshot.title, 'Current live show')
  assert.ok(friday.slots.afternoon.aliases.includes(OLD_EVENT))
  assert.equal(friday.slots.afternoon.aliases.includes(DROPPED), false)
  assert.equal(friday.slots.night.primary, MISSING)
  assert.deepEqual(friday.slots.night.identity, { status: 'missing', legacyKey: MISSING })
  assert.equal(friday.slots.night.snapshot.title, 'Removed but saved')

  assert.equal(saturday.slots.afternoon.kind, 'custom')
  assert.equal(saturday.slots.afternoon.primary, 'c|custom001')
  assert.equal(saturday.slots.afternoon.snapshot.title, 'Backyard vinyl night')
  assert.equal(sunday.slots.night.primary, AMBIGUOUS)
  assert.deepEqual(sunday.slots.night.identity, {
    status: 'ambiguous',
    legacyKey: AMBIGUOUS,
    candidates: ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'],
  })
  assert.equal(sunday.slots.night.snapshot.title, 'Shared listing snapshot')

  assert.deepEqual(result.document.history.map((entry) => entry.dayTs), [
    cityTs('2026-07-15'),
    cityTs('2026-07-16'),
  ])
  const wednesday = result.document.history[0]
  assert.equal(wednesday.slots.afternoon.primary, 'e|1111111111111111')
  assert.equal(wednesday.slots.night.primary, MISSING)
  const thursday = result.document.history[1]
  assert.equal(
    thursday.slots.afternoon.primary,
    MISSING,
    'existing history wins when rollover finds the same past day',
  )
  assert.equal(thursday.slots.night, null)

  assert.deepEqual(result.sourceSummary.dayPlans, {
    input: 3,
    accepted: 3,
    invalid: 0,
    projected: 2,
    binaryEntries: 2,
    binaryConflicts: 0,
    collisions: 1,
  })
  assert.deepEqual(result.sourceSummary.dayHistory, {
    input: 3,
    accepted: 3,
    invalid: 0,
    projected: 1,
    binaryEntries: 2,
    binaryConflicts: 0,
    collisions: 1,
  })
  assert.deepEqual(result.sourceSummary.weekendPlan, {
    status: 'folded',
    sourceWeekendStartTs: sourceTs('2026-07-17'),
    targetWeekendStartTs: cityTs('2026-07-17'),
    projected: true,
    inputSlots: 4,
    foldedSlots: 2,
    occupiedSlots: 2,
    discardedSlots: 0,
    done: true,
  })
  assert.deepEqual(result.sourceSummary.identity, {
    total: 9,
    attached: 5,
    missing: 3,
    ambiguous: 1,
    invalid: 0,
    snapshots: { savedEvents: 3, beenThere: 1, none: 0 },
  })
  assert.deepEqual(result.sourceSummary.rollover, {
    pastActiveDays: 1,
    archivedDays: 0,
    historyCollisions: 1,
    code: 'rolled-over',
  })
  assert.equal(result.diagnostics.collisions.length, 4)
})

test('discards a past legacy weekend instead of manufacturing retired weekend history', () => {
  const result = migrateV1PlannerState({
    weekendPlan: {
      v: 1,
      weekendStartTs: sourceTs('2026-07-17'),
      slots: { fri_day: OLD_EVENT, sat_night: MISSING },
      done: true,
    },
  }, {
    ...options,
    todayTs: cityTs('2026-07-20'),
    weekendStartTs: cityTs('2026-07-24'),
  })

  assert.deepEqual(result.document.active, {})
  assert.deepEqual(result.document.history, [])
  assert.deepEqual(result.sourceSummary.weekendPlan, {
    status: 'discarded-past',
    sourceWeekendStartTs: sourceTs('2026-07-17'),
    targetWeekendStartTs: cityTs('2026-07-17'),
    projected: true,
    inputSlots: 2,
    foldedSlots: 0,
    occupiedSlots: 0,
    discardedSlots: 2,
    done: true,
  })
  assert.equal(result.sourceSummary.identity.total, 0)
})

test('history remains first-write-wins and capped after active-day rollover', () => {
  const source = {
    dayPlans: {
      [String(sourceTs('2026-07-14'))]: ternary({}, { done: true }),
    },
    dayHistory: [
      { dayTs: sourceTs('2026-07-13'), ...ternary({}, { done: true }) },
      { dayTs: sourceTs('2026-07-14'), ...ternary({}, { done: true }) },
      { dayTs: sourceTs('2026-07-15'), ...ternary({}, { done: true }) },
    ],
  }
  const result = migrateV1PlannerState(source, { ...options, historyCap: 2 })

  assert.deepEqual(result.document.active, {})
  assert.deepEqual(result.document.history.map((entry) => entry.dayTs), [
    cityTs('2026-07-14'),
    cityTs('2026-07-15'),
  ])
  assert.equal(result.sourceSummary.rollover.historyCollisions, 1)
  assert.equal(result.sourceSummary.rollover.archivedDays, 0)
})

test('rejects wrong-version active and history entries instead of laundering them into V2', () => {
  const result = migrateV1PlannerState({
    dayPlans: {
      [String(cityTs('2026-07-17'))]: {
        v: 2,
        state: null,
        slots: { morning: OLD_EVENT, afternoon: null, night: null },
        done: false,
      },
    },
    dayHistory: [{
      dayTs: cityTs('2026-07-16'),
      v: 0,
      state: null,
      slots: { morning: null, afternoon: OLD_EVENT, night: null },
      done: true,
    }],
  }, options)

  assert.deepEqual(result.document.active, {})
  assert.deepEqual(result.document.history, [])
  assert.equal(result.sourceSummary.dayPlans.invalid, 1)
  assert.equal(result.sourceSummary.dayHistory.invalid, 1)
  assert.deepEqual(result.diagnostics.invalidDays, [
    {
      store: 'dayPlans',
      path: [String(cityTs('2026-07-17'))],
      dayTs: String(cityTs('2026-07-17')),
    },
    {
      store: 'dayHistory',
      path: [0],
      dayTs: cityTs('2026-07-16'),
    },
  ])
})

test('recovers unresolved snapshots through one seed identity without promoting the legacy primary', () => {
  const oldSaved = 'https://fixture.test/old-saved|2026-07-17'
  const currentSaved = 'https://fixture.test/current-saved|2026-07-17'
  const oldBeen = 'https://fixture.test/old-been|2026-07-17'
  const currentBeen = 'https://fixture.test/current-been|2026-07-17'
  const exact = 'https://fixture.test/exact-old|2026-07-17'
  const currentExact = 'https://fixture.test/current-exact|2026-07-17'
  const aliasSeeds = [
    {
      primary: 'e|2222222222222222',
      aliases: ['e|2222222222222222', oldSaved, currentSaved],
    },
    {
      primary: 'e|3333333333333333',
      aliases: ['e|3333333333333333', oldBeen, currentBeen],
    },
    {
      primary: 'e|4444444444444444',
      aliases: ['e|4444444444444444', exact, currentExact],
    },
  ]
  const source = {
    dayPlans: {
      [String(cityTs('2026-07-17'))]: ternary({
        morning: oldSaved,
        afternoon: oldBeen,
        night: exact,
      }),
    },
    savedEvents: {
      [currentSaved]: { snapshot: { title: 'Recovered from current save' } },
      [exact]: { snapshot: { title: 'Exact snapshot wins' } },
      [currentExact]: { snapshot: { title: 'Alias snapshot must lose' } },
    },
    beenThere: [{
      key: currentBeen,
      snapshot: { title: 'Recovered from current Been there' },
    }],
  }

  const result = migrateV1PlannerState(source, {
    ...options,
    catalog: [],
    seeds: aliasSeeds,
  })
  const slots = result.document.active[String(cityTs('2026-07-17'))].slots

  assert.equal(slots.morning.primary, oldSaved)
  assert.deepEqual(slots.morning.identity, { status: 'missing', legacyKey: oldSaved })
  assert.equal(slots.morning.snapshot.title, 'Recovered from current save')
  assert.equal(slots.afternoon.primary, oldBeen)
  assert.deepEqual(slots.afternoon.identity, { status: 'missing', legacyKey: oldBeen })
  assert.equal(slots.afternoon.snapshot.title, 'Recovered from current Been there')
  assert.equal(slots.night.primary, exact)
  assert.deepEqual(slots.night.identity, { status: 'missing', legacyKey: exact })
  assert.equal(slots.night.snapshot.title, 'Exact snapshot wins')
  assert.deepEqual(result.diagnostics.snapshotRecovery, [
    {
      path: ['dayPlans', String(cityTs('2026-07-17')), 'slots', 'morning'],
      legacyKey: oldSaved,
      matchedKey: currentSaved,
      origin: 'savedEvents',
      matchedBy: 'seed-alias',
    },
    {
      path: ['dayPlans', String(cityTs('2026-07-17')), 'slots', 'afternoon'],
      legacyKey: oldBeen,
      matchedKey: currentBeen,
      origin: 'beenThere',
      matchedBy: 'seed-alias',
    },
    {
      path: ['dayPlans', String(cityTs('2026-07-17')), 'slots', 'night'],
      legacyKey: exact,
      matchedKey: exact,
      origin: 'savedEvents',
      matchedBy: 'exact',
    },
  ])
})

test('does not cross an ambiguous seed component while recovering a snapshot', () => {
  const legacy = 'https://fixture.test/ambiguous-old|2026-07-17'
  const current = 'https://fixture.test/ambiguous-current|2026-07-17'
  const result = migrateV1PlannerState({
    dayPlans: {
      [String(cityTs('2026-07-17'))]: ternary({ morning: legacy }),
    },
    savedEvents: {
      [current]: { snapshot: { title: 'Must not be guessed' } },
    },
  }, {
    ...options,
    catalog: [],
    seeds: [
      { primary: 'e|5555555555555555', aliases: ['e|5555555555555555', legacy, current] },
      { primary: 'e|6666666666666666', aliases: ['e|6666666666666666', legacy, current] },
    ],
  })
  const ref = result.document.active[String(cityTs('2026-07-17'))].slots.morning

  assert.equal(ref.primary, legacy)
  assert.deepEqual(ref.snapshot, { kind: 'event' })
  assert.deepEqual(result.diagnostics.snapshotRecovery, [{
    path: ['dayPlans', String(cityTs('2026-07-17')), 'slots', 'morning'],
    legacyKey: legacy,
    matchedKey: null,
    origin: null,
    matchedBy: 'none',
  }])
})

test('refuses an oversized migrated or retried document atomically without mutating its source', () => {
  const dayPlans = {}
  const savedEvents = {}
  const longTail = 'k'.repeat(1_350)
  const description = 'd'.repeat(1_900)
  for (let index = 0; index < 300; index += 1) {
    const dayId = addCalendarDays('2026-07-17', index)
    const slots = {}
    for (const part of ['morning', 'afternoon', 'night']) {
      const key = `https://fixture.test/${index}/${part}/${longTail}|${dayId}`
      slots[part] = key
      savedEvents[key] = {
        snapshot: {
          title: `Large retained item ${index} ${part}`,
          start: dayId,
          description,
        },
      }
    }
    dayPlans[String(cityTs(dayId))] = ternary(slots)
  }
  const source = { dayPlans, savedEvents }
  const before = JSON.stringify(source)
  let migrationError
  try {
    migrateV1PlannerState(source, { ...options, catalog: [], seeds: [] })
  } catch (error) {
    migrationError = error
  }

  assert.ok(migrationError instanceof RangeError)
  assert.equal(migrationError.code, 'ERR_PLANNER_DOCUMENT_TOO_LARGE')
  assert.equal(migrationError.details.phase, 'migration')
  assert.equal(migrationError.details.maxBytes, PLANNER_DOCUMENT_MAX_BYTES)
  assert.ok(migrationError.details.bytes > PLANNER_DOCUMENT_MAX_BYTES)
  assert.equal(JSON.stringify(source), before)

  const oversizedRef = slotRefOf({
    primary: `https://fixture.test/retry/${longTail}`,
    aliases: [`https://fixture.test/retry/${longTail}`],
    title: 'Retained retry item',
    description,
  })
  const active = {}
  for (let index = 0; index < 800; index += 1) {
    active[String(cityTs(addCalendarDays('2026-07-17', index)))] = {
      state: null,
      slots: { morning: oversizedRef, afternoon: oversizedRef, night: oversizedRef },
      done: false,
    }
  }
  const existing = { v: 2, rev: 0, active, history: [], cells: {} }
  const existingBefore = JSON.stringify(existing)
  let retryError
  try {
    migrateV1PlannerState(existing, options)
  } catch (error) {
    retryError = error
  }

  assert.ok(retryError instanceof RangeError)
  assert.equal(retryError.code, 'ERR_PLANNER_DOCUMENT_TOO_LARGE')
  assert.deepEqual(retryError.details, {
    phase: 'retry',
    bytes: retryError.details.bytes,
    maxBytes: PLANNER_DOCUMENT_MAX_BYTES,
  })
  assert.ok(retryError.details.bytes > PLANNER_DOCUMENT_MAX_BYTES)
  assert.equal(JSON.stringify(existing), existingBefore)
})

test('is deterministic, leaves V1 bytes untouched, retries an existing V2 document idempotently, and uses no ambient clock or storage', () => {
  const source = sourceFixture()
  const before = structuredClone(source)
  const originalNow = Date.now
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Date.now = () => {
    throw new Error('ambient Date.now access')
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('ambient storage access')
    },
  })

  try {
    const first = migrateV1PlannerState(source, options)
    const sameInput = migrateV1PlannerState(structuredClone(source), {
      ...options,
      city: { ...CITY },
      catalog: structuredClone(catalog),
      seeds: structuredClone(seeds),
    })
    const retry = migrateV1PlannerState(first.document, options)

    assert.deepEqual(sameInput, first)
    assert.deepEqual(retry.document, first.document)
    assert.equal(retry.sourceSummary.mode, 'v2')
    assert.deepEqual(source, before)
  } finally {
    Date.now = originalNow
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else delete globalThis.localStorage
  }
})
