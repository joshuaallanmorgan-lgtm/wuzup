import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVITY_ALIAS_SCAN_MAX,
  ACTIVITY_ALIAS_MAX_COUNT,
  ACTIVITY_DOCUMENT_MAX_BYTES,
  ACTIVITY_DOCUMENT_MAX_DEPTH,
  ACTIVITY_EVENT_DECK_CAP,
  ACTIVITY_PLACE_DECK_CAP,
  ACTIVITY_RECENTS_CAP,
  ACTIVITY_REF_MAX_BYTES,
  ACTIVITY_STATE_VERSION,
  ACTIVITY_STRING_MAX_BYTES,
  activityRefOf,
  activityStateBytes,
  clearActivityDecks,
  emptyActivityState,
  migrateV1ActivityState,
  normalizeActivityState,
  resolveActivityRefs,
} from '../app/src/activity-state-core.js'
import { customIdentityBridgeOf } from '../app/src/identity.js'

const CITY_ID = 'tampa-bay'
const OTHER_CITY_ID = 'sf-east-bay'
const EVENT_LEGACY = 'https://fixture.test/night-market|2026-07-20T19:00:00-04:00'
const EVENT_OLD = 'https://fixture.test/night-market|2026-07-20'
const PLACE_KEY = 'p|riverwalk'
const REMOVED = 'https://fixture.test/removed|2026-07-01'
const SHARED = 'https://fixture.test/shared|2026-07-20'

test('session custom refs retain only bounded opaque bridges and resolve after landing', () => {
  const localId = 'custom-event-0001'
  const bridge = customIdentityBridgeOf(`c|${localId}`)
  const pending = {
    kind: 'custom',
    title: 'Porch show',
    start: '2026-07-21T20:00:00-04:00',
    _keyTitle: 'session-custom-abcdef0123456789',
    _sessionIdentityAliases: [bridge, 'c|must-not-land', 'not-a-bridge'],
  }
  const ref = activityRefOf(pending, { kind: 'event' })
  assert.equal(ref.kind, 'custom')
  assert.equal(ref.primary.startsWith('c|'), false)
  assert.deepEqual(ref.aliases.filter((alias) => alias.startsWith('c|')), [])
  assert.equal(ref.aliases.includes(bridge), true)

  const durable = {
    kind: 'custom',
    localId,
    title: pending.title,
    start: pending.start,
  }
  assert.deepEqual(resolveActivityRefs([ref], [durable], { kind: 'event' }), [durable])
})

test('activity ref resolution preserves order, kind scope, and explicit ambiguity', () => {
  const old = {
    status: 'attached',
    kind: 'event',
    primary: 'e|dddddddddddddddd',
    aliases: ['e|dddddddddddddddd', SHARED],
  }
  const unique = {
    kind: 'event',
    id: 'eeeeeeeeeeeeeeee',
    title: 'Current event',
    url: 'https://fixture.test/shared',
    start: '2026-07-20',
  }
  assert.deepEqual(resolveActivityRefs([old], [unique], { kind: 'event' }), [unique])

  const collision = { ...unique, id: 'ffffffffffffffff', title: 'Collision' }
  assert.deepEqual(resolveActivityRefs([old], [unique, collision], { kind: 'event' }), [])
  assert.deepEqual(resolveActivityRefs([old], [{ kind: 'place', key: SHARED }], {
    kind: 'event',
  }), [])
})

test('clearing both deck memories is one pure all-or-nothing transition', () => {
  const document = {
    ...emptyActivityState(CITY_ID),
    eventDeck: [{
      status: 'attached',
      kind: 'event',
      primary: 'e|aaaaaaaaaaaaaaaa',
      aliases: ['e|aaaaaaaaaaaaaaaa'],
    }],
    placeDeck: [{
      status: 'attached',
      kind: 'place',
      primary: PLACE_KEY,
      aliases: [PLACE_KEY],
    }],
  }
  const before = clone(document)
  const cleared = clearActivityDecks(document, { cityId: CITY_ID })
  assert.equal(cleared.changed, true)
  assert.equal(cleared.code, 'cleared-decks')
  assert.deepEqual(cleared.document.eventDeck, [])
  assert.deepEqual(cleared.document.placeDeck, [])
  assert.deepEqual(document, before)
  assert.equal(clearActivityDecks(cleared.document, { cityId: CITY_ID }).code, 'already-empty')
})

const events = [
  {
    id: 'aaaaaaaaaaaaaaaa',
    title: 'Night market',
    url: 'https://fixture.test/night-market',
    start: '2026-07-20T19:00:00-04:00',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    title: 'Shared event A',
    url: 'https://fixture.test/shared',
    start: '2026-07-20',
  },
  {
    id: 'cccccccccccccccc',
    title: 'Shared event B',
    url: 'https://fixture.test/shared',
    start: '2026-07-20',
  },
  {
    kind: 'custom',
    localId: 'custom-event-0001',
    title: 'Porch show',
    start: '2026-07-21T20:00:00-04:00',
  },
]

const places = [
  {
    kind: 'place',
    key: PLACE_KEY,
    title: 'Riverwalk',
  },
  {
    kind: 'place',
    key: SHARED,
    title: 'A maliciously weak place key',
  },
]

const seeds = [{
  kind: 'event',
  primary: 'e|aaaaaaaaaaaaaaaa',
  aliases: ['e|aaaaaaaaaaaaaaaa', EVENT_OLD],
}]

const clone = (value) => structuredClone(value)

function depthOf(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return 0
  if (seen.has(value)) return Number.POSITIVE_INFINITY
  seen.add(value)
  const values = Array.isArray(value) ? value : Object.values(value)
  const child = values.length ? Math.max(...values.map((item) => depthOf(item, seen))) : 0
  seen.delete(value)
  return 1 + child
}

test('creates a city-bound empty V2 document and rejects invalid city ids', () => {
  assert.deepEqual(emptyActivityState(CITY_ID), {
    v: ACTIVITY_STATE_VERSION,
    cityId: CITY_ID,
    recents: [],
    eventDeck: [],
    placeDeck: [],
  })
  for (const cityId of [undefined, null, '', '../sf', 'SF East Bay']) {
    assert.throws(() => emptyActivityState(cityId), TypeError)
  }
})

test('migrates three separate ordered collections with stable and legacy evidence', () => {
  const source = {
    recents: [EVENT_OLD, PLACE_KEY, REMOVED],
    eventDeck: [EVENT_LEGACY, 'Porch show|2026-07-21T20:00:00-04:00'],
    placeDeck: [PLACE_KEY],
  }
  const before = clone(source)

  const document = migrateV1ActivityState(source, {
    cityId: CITY_ID,
    events,
    places,
    seeds,
  })

  assert.deepEqual(source, before, 'migration is pure')
  assert.equal(document.v, 2)
  assert.equal(document.cityId, CITY_ID)
  assert.deepEqual(document.recents.map((row) => row.status), ['attached', 'attached', 'missing'])
  assert.deepEqual(document.recents.map((row) => row.kind), ['event', 'place', 'unknown'])
  assert.deepEqual(document.recents.map((row) => row.primary ?? row.legacyKey), [
    'e|aaaaaaaaaaaaaaaa',
    PLACE_KEY,
    REMOVED,
  ])
  assert.deepEqual(document.recents[0].aliases, [
    'e|aaaaaaaaaaaaaaaa',
    EVENT_OLD,
    EVENT_LEGACY,
  ])
  assert.deepEqual(document.eventDeck.map((row) => row.kind), ['event', 'custom'])
  assert.equal(document.eventDeck[1].primary, 'c|custom-event-0001')
  assert.deepEqual(document.placeDeck, [{
    status: 'attached',
    kind: 'place',
    primary: PLACE_KEY,
    aliases: [PLACE_KEY],
  }])
})

test('historical seeds provide alias edges but cannot invent a live attachment', () => {
  const live = migrateV1ActivityState({ recents: [EVENT_OLD] }, {
    cityId: CITY_ID,
    events,
    seeds,
  })
  const absent = migrateV1ActivityState({ recents: [EVENT_OLD] }, {
    cityId: CITY_ID,
    events: [],
    seeds,
  })

  assert.equal(live.recents[0].status, 'attached')
  assert.equal(live.recents[0].primary, 'e|aaaaaaaaaaaaaaaa')
  assert.deepEqual(absent.recents[0], {
    status: 'missing',
    kind: 'unknown',
    legacyKey: EVENT_OLD,
  })
})

test('ambiguous weak aliases remain explicit and never select the first catalog row', () => {
  const document = migrateV1ActivityState({
    recents: [SHARED],
    eventDeck: [SHARED],
  }, {
    cityId: CITY_ID,
    events,
    places,
  })

  assert.deepEqual(document.recents, [{
    status: 'ambiguous',
    kind: 'unknown',
    legacyKey: SHARED,
    candidates: [
      'e|bbbbbbbbbbbbbbbb',
      'e|cccccccccccccccc',
      SHARED,
    ],
  }])
  assert.deepEqual(document.eventDeck, [{
    status: 'ambiguous',
    kind: 'event',
    legacyKey: SHARED,
    candidates: ['e|bbbbbbbbbbbbbbbb', 'e|cccccccccccccccc'],
  }])
})

test('e, c, and p prefixed recents still detect cross-domain catalog collisions', () => {
  const eventPrimary = 'e|dddddddddddddddd'
  const customPrimary = 'c|custom-event-0001'
  const hostileEvent = {
    id: 'eeeeeeeeeeeeeeee',
    title: 'p',
    start: 'riverwalk',
  }
  const document = migrateV1ActivityState({
    recents: [PLACE_KEY, eventPrimary, customPrimary],
  }, {
    cityId: CITY_ID,
    events: [
      ...events,
      {
        id: 'dddddddddddddddd',
        title: 'Exact prefixed event',
        start: '2026-07-23',
      },
      hostileEvent,
    ],
    places: [
      ...places,
      { kind: 'place', key: eventPrimary, title: 'Event-prefixed place' },
      { kind: 'place', key: customPrimary, title: 'Custom-prefixed place' },
    ],
  })

  assert.deepEqual(document.recents.map((row) => ({
    status: row.status,
    kind: row.kind,
    legacyKey: row.legacyKey,
  })), [
    { status: 'ambiguous', kind: 'unknown', legacyKey: PLACE_KEY },
    { status: 'ambiguous', kind: 'unknown', legacyKey: eventPrimary },
    { status: 'ambiguous', kind: 'unknown', legacyKey: customPrimary },
  ])
  assert.deepEqual(document.recents[0].candidates, ['e|eeeeeeeeeeeeeeee', PLACE_KEY])
  assert.deepEqual(document.recents[1].candidates, [eventPrimary])
  assert.deepEqual(document.recents[2].candidates, [customPrimary])
})

test('event and place deck resolution stays kind-separated even under hostile aliases', () => {
  const hostileEvent = {
    id: 'dddddddddddddddd',
    title: 'Not the place',
    url: 'p',
    start: 'riverwalk',
  }
  const document = migrateV1ActivityState({
    eventDeck: [PLACE_KEY],
    placeDeck: [PLACE_KEY],
  }, {
    cityId: CITY_ID,
    events: [...events, hostileEvent],
    places,
  })

  assert.equal(document.eventDeck[0].kind, 'event')
  assert.equal(document.eventDeck[0].primary, 'e|dddddddddddddddd')
  assert.equal(document.placeDeck[0].kind, 'place')
  assert.equal(document.placeDeck[0].primary, PLACE_KEY)
})

test('scoped deck misses retain their domain even when the legacy key has another prefix', () => {
  const document = migrateV1ActivityState({
    eventDeck: ['p|removed-event'],
    placeDeck: ['e|removed-place'],
  }, {
    cityId: CITY_ID,
  })

  assert.deepEqual(document.eventDeck, [{
    status: 'missing',
    kind: 'event',
    legacyKey: 'p|removed-event',
  }])
  assert.deepEqual(document.placeDeck, [{
    status: 'missing',
    kind: 'place',
    legacyKey: 'e|removed-place',
  }])
})

test('preserves legitimate source order and dedupes only exact identity repetitions', () => {
  const unique = Array.from({ length: 15 }, (_, index) => ({
    id: index.toString(16).padStart(16, '0'),
    title: `Event ${index}`,
    start: `2026-08-${String(index + 1).padStart(2, '0')}`,
  }))
  const keys = unique.map((row) => `${row.title}|${row.start}`)
  const source = {
    recents: [keys[3], keys[1], keys[3], keys[8], keys[2]],
    eventDeck: [keys[5], keys[0], keys[5], keys[4]],
  }

  const document = migrateV1ActivityState(source, {
    cityId: CITY_ID,
    events: unique,
  })

  assert.deepEqual(
    document.recents.map((row) => row.primary),
    ['e|0000000000000003', 'e|0000000000000001', 'e|0000000000000008', 'e|0000000000000002'],
  )
  assert.deepEqual(
    document.eventDeck.map((row) => row.primary),
    ['e|0000000000000000', 'e|0000000000000005', 'e|0000000000000004'],
  )
})

test('stable duplicates merge distinct legacy evidence without first-wins data loss', () => {
  const document = migrateV1ActivityState({
    recents: [EVENT_OLD, EVENT_LEGACY],
  }, {
    cityId: CITY_ID,
    events,
    seeds,
  })

  assert.equal(document.recents.length, 1)
  assert.deepEqual(document.recents[0].aliases, [
    'e|aaaaaaaaaaaaaaaa',
    EVENT_OLD,
    EVENT_LEGACY,
  ])
})

test('malformed child rows are bounded away without shifting or mutating valid evidence', () => {
  const source = {
    recents: [null, 17, {}, '|', '', EVENT_OLD, ['nested'], PLACE_KEY],
    eventDeck: [false, { key: EVENT_LEGACY }, EVENT_LEGACY],
    placeDeck: [undefined, PLACE_KEY],
  }
  const recents = [...source.recents]
  const eventDeck = [...source.eventDeck]
  const placeDeck = [...source.placeDeck]

  const document = migrateV1ActivityState(source, {
    cityId: CITY_ID,
    events,
    places,
    seeds,
  })

  assert.deepEqual(document.recents.map((row) => row.primary), [
    'e|aaaaaaaaaaaaaaaa',
    PLACE_KEY,
  ])
  assert.deepEqual(document.eventDeck.map((row) => row.primary), ['e|aaaaaaaaaaaaaaaa'])
  assert.deepEqual(document.placeDeck.map((row) => row.primary), [PLACE_KEY])
  assert.deepEqual(source.recents, recents)
  assert.deepEqual(source.eventDeck, eventDeck)
  assert.deepEqual(source.placeDeck, placeDeck)
})

test('current production caps are enforced independently after invalid rows and duplicates', () => {
  const catalog = Array.from({ length: 80 }, (_, index) => ({
    id: index.toString(16).padStart(16, '0'),
    title: `Bounded ${index}`,
    start: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T19:00:00-04:00`,
  }))
  const keys = catalog.map((row) => `${row.title}|${row.start}`)
  const document = migrateV1ActivityState({
    recents: [null, keys[0], keys[0], ...keys.slice(1)],
    eventDeck: keys,
    placeDeck: Array.from({ length: 80 }, (_, index) => `p|place-${index}`),
  }, {
    cityId: CITY_ID,
    events: catalog,
    places: Array.from({ length: 80 }, (_, index) => ({
      kind: 'place',
      key: `p|place-${index}`,
      title: `Place ${index}`,
    })),
  })

  assert.equal(document.recents.length, ACTIVITY_RECENTS_CAP)
  assert.equal(document.eventDeck.length, ACTIVITY_EVENT_DECK_CAP)
  assert.equal(document.placeDeck.length, ACTIVITY_PLACE_DECK_CAP)
  assert.equal(document.recents[0].primary, 'e|0000000000000000')
  assert.equal(document.recents.at(-1).primary, 'e|000000000000000b')
  assert.equal(document.eventDeck[0].primary, 'e|0000000000000032')
  assert.equal(document.eventDeck.at(-1).primary, 'e|000000000000004f')
  assert.equal(document.placeDeck[0].primary, 'p|place-50')
  assert.equal(document.placeDeck.at(-1).primary, 'p|place-79')
})

test('deck FIFO caps retain the newest tail and the last duplicate position', () => {
  const catalog = Array.from({ length: 40 }, (_, index) => ({
    id: index.toString(16).padStart(16, '0'),
    title: `Tail ${index}`,
    start: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T19:00:00-04:00`,
  }))
  const keys = catalog.map((row) => `${row.title}|${row.start}`)
  const placeCatalog = Array.from({ length: 40 }, (_, index) => ({
    kind: 'place',
    key: `p|tail-${index}`,
    title: `Tail place ${index}`,
  }))
  const placeKeys = placeCatalog.map((row) => row.key)
  const document = migrateV1ActivityState({
    eventDeck: [...keys, keys[0]],
    placeDeck: [...placeKeys, placeKeys[0]],
  }, {
    cityId: CITY_ID,
    events: catalog,
    places: placeCatalog,
  })

  assert.equal(document.eventDeck.length, ACTIVITY_EVENT_DECK_CAP)
  assert.equal(document.eventDeck[0].primary, 'e|000000000000000b')
  assert.equal(document.eventDeck.at(-1).primary, 'e|0000000000000000')
  assert.equal(document.placeDeck.length, ACTIVITY_PLACE_DECK_CAP)
  assert.equal(document.placeDeck[0].primary, 'p|tail-11')
  assert.equal(document.placeDeck.at(-1).primary, 'p|tail-0')
})

test('normalization applies the same newest-tail contract to oversized deck documents', () => {
  const missing = (kind, index) => ({
    status: 'missing',
    kind,
    legacyKey: `${kind}|${index}`,
  })
  const normalized = normalizeActivityState({
    v: 2,
    cityId: CITY_ID,
    recents: [],
    eventDeck: [
      ...Array.from({ length: 40 }, (_, index) => missing('event', index)),
      missing('event', 0),
    ],
    placeDeck: [
      ...Array.from({ length: 40 }, (_, index) => missing('place', index)),
      missing('place', 0),
    ],
  }, { cityId: CITY_ID })

  assert.equal(normalized.eventDeck[0].legacyKey, 'event|11')
  assert.equal(normalized.eventDeck.at(-1).legacyKey, 'event|0')
  assert.equal(normalized.placeDeck[0].legacyKey, 'place|11')
  assert.equal(normalized.placeDeck.at(-1).legacyKey, 'place|0')
})

test('catalog and seed alias scans are bounded before generic identity expansion', () => {
  const catalogAliases = Array.from(
    { length: ACTIVITY_ALIAS_SCAN_MAX + 1 },
    (_, index) => `catalog-alias-${index}`,
  )
  Object.defineProperty(catalogAliases, ACTIVITY_ALIAS_SCAN_MAX, {
    get() {
      throw new Error('catalog alias scan escaped its bound')
    },
  })
  const seedAliases = [
    'e|aaaaaaaaaaaaaaaa',
    EVENT_OLD,
    ...Array.from({ length: 62 }, (_, index) => `seed-alias-${index}`),
  ]
  Object.defineProperty(seedAliases, ACTIVITY_ALIAS_SCAN_MAX - 1, {
    get() {
      throw new Error('seed alias scan escaped its bound')
    },
  })

  const document = migrateV1ActivityState({
    recents: ['catalog-alias-0', EVENT_OLD],
  }, {
    cityId: CITY_ID,
    events: [
      {
        id: 'eeeeeeeeeeeeeeee',
        title: 'Bounded aliases',
        start: '2026-07-25',
        identityAliases: catalogAliases,
      },
      events[0],
    ],
    seeds: [{
      kind: 'event',
      primary: 'e|aaaaaaaaaaaaaaaa',
      aliases: seedAliases,
    }],
  })

  assert.deepEqual(document.recents.map((row) => row.primary), [
    'e|eeeeeeeeeeeeeeee',
    'e|aaaaaaaaaaaaaaaa',
  ])
})

test('overlong catalog strings fail closed without blocking later bounded candidates', () => {
  const document = migrateV1ActivityState({
    recents: [EVENT_OLD],
  }, {
    cityId: CITY_ID,
    events: [
      {
        id: 'ffffffffffffffff',
        title: 'x'.repeat(ACTIVITY_STRING_MAX_BYTES + 1),
        start: '2026-07-25',
      },
      events[0],
    ],
    seeds,
  })

  assert.equal(document.recents.length, 1)
  assert.equal(document.recents[0].status, 'attached')
  assert.equal(document.recents[0].primary, 'e|aaaaaaaaaaaaaaaa')
})

test('normalization rejects wrong city, wrong version, wrong roots, and oversized raw bytes', () => {
  const valid = migrateV1ActivityState({ recents: [EVENT_OLD] }, {
    cityId: CITY_ID,
    events,
    seeds,
  })

  assert.deepEqual(normalizeActivityState(valid, { cityId: CITY_ID }), valid)
  assert.equal(normalizeActivityState(valid, { cityId: OTHER_CITY_ID }), null)
  assert.equal(normalizeActivityState({ ...valid, v: 1 }, { cityId: CITY_ID }), null)
  assert.equal(normalizeActivityState({ ...valid, recents: {} }, { cityId: CITY_ID }), null)
  const cyclic = { ...valid }
  cyclic.self = cyclic
  assert.equal(normalizeActivityState(cyclic, { cityId: CITY_ID }), null)
  assert.equal(normalizeActivityState({
    ...valid,
    ignored: 'x'.repeat(ACTIVITY_DOCUMENT_MAX_BYTES),
  }, { cityId: CITY_ID }), null)
  assert.throws(() => normalizeActivityState(valid, { cityId: '../sf' }), TypeError)
})

test('normalization revalidates rows, kind boundaries, aliases, and exact-repeat dedupe', () => {
  const valid = {
    v: 2,
    cityId: CITY_ID,
    recents: [
      {
        status: 'attached',
        kind: 'event',
        primary: 'e|aaaaaaaaaaaaaaaa',
        aliases: ['e|aaaaaaaaaaaaaaaa', EVENT_OLD],
      },
      {
        status: 'attached',
        kind: 'event',
        primary: 'e|aaaaaaaaaaaaaaaa',
        aliases: ['e|aaaaaaaaaaaaaaaa', EVENT_LEGACY],
      },
      { status: 'missing', kind: 'unknown', legacyKey: REMOVED },
      { status: 'missing', kind: 'unknown', legacyKey: REMOVED },
      { status: 'attached', kind: 'event', primary: '|', aliases: ['|'] },
    ],
    eventDeck: [
      { status: 'missing', kind: 'place', legacyKey: PLACE_KEY },
      { status: 'missing', kind: 'event', legacyKey: REMOVED },
    ],
    placeDeck: [
      { status: 'missing', kind: 'event', legacyKey: REMOVED },
      { status: 'missing', kind: 'place', legacyKey: PLACE_KEY },
    ],
  }

  const normalized = normalizeActivityState(valid, { cityId: CITY_ID })
  assert.equal(normalized.recents.length, 2)
  assert.deepEqual(normalized.recents[0].aliases, [
    'e|aaaaaaaaaaaaaaaa',
    EVENT_OLD,
    EVENT_LEGACY,
  ])
  assert.deepEqual(normalized.eventDeck, [{
    status: 'missing',
    kind: 'event',
    legacyKey: REMOVED,
  }])
  assert.deepEqual(normalized.placeDeck, [{
    status: 'missing',
    kind: 'place',
    legacyKey: PLACE_KEY,
  }])
})

test('string, alias, reference, document-size, and depth bounds are exact and deterministic', () => {
  const exact = 'x'.repeat(ACTIVITY_STRING_MAX_BYTES - 2)
  const overlong = `x${'😀'.repeat(Math.ceil(ACTIVITY_STRING_MAX_BYTES / 4))}`
  const aliases = [
    'e|aaaaaaaaaaaaaaaa',
    exact,
    ...Array.from({ length: 100 }, (_, index) => `legacy-${index}`),
    overlong,
  ]
  const raw = {
    v: 2,
    cityId: CITY_ID,
    recents: [{
      status: 'attached',
      kind: 'event',
      primary: 'e|aaaaaaaaaaaaaaaa',
      aliases,
    }],
    eventDeck: [],
    placeDeck: [],
  }
  const first = normalizeActivityState(raw, { cityId: CITY_ID })
  const second = normalizeActivityState(clone(raw), { cityId: CITY_ID })

  assert.deepEqual(second, first)
  assert.ok(first.recents[0].aliases.length <= ACTIVITY_ALIAS_MAX_COUNT)
  assert.equal(first.recents[0].aliases.includes(exact), true)
  assert.equal(first.recents[0].aliases.includes(overlong), false)
  assert.ok(activityStateBytes(first.recents[0]) <= ACTIVITY_REF_MAX_BYTES)
  assert.ok(activityStateBytes(first) <= ACTIVITY_DOCUMENT_MAX_BYTES)
  assert.ok(depthOf(first) <= ACTIVITY_DOCUMENT_MAX_DEPTH)
})

test('migration is deterministic, copy-safe, and cannot cross-contaminate city documents', () => {
  const source = {
    recents: [EVENT_OLD, PLACE_KEY, REMOVED],
    eventDeck: [EVENT_LEGACY],
    placeDeck: [PLACE_KEY],
  }
  const options = { events, places, seeds }
  const tampaA = migrateV1ActivityState(source, { cityId: CITY_ID, ...options })
  const tampaB = migrateV1ActivityState(clone(source), {
    cityId: CITY_ID,
    events: clone(events),
    places: clone(places),
    seeds: clone(seeds),
  })
  const sf = migrateV1ActivityState(source, { cityId: OTHER_CITY_ID, ...options })

  assert.deepEqual(tampaB, tampaA)
  assert.notStrictEqual(tampaB, tampaA)
  assert.notStrictEqual(tampaB.recents, tampaA.recents)
  assert.equal(sf.cityId, OTHER_CITY_ID)
  assert.equal(normalizeActivityState(sf, { cityId: CITY_ID }), null)
  sf.recents[0].aliases.push('mutated')
  assert.equal(tampaA.recents[0].aliases.includes('mutated'), false)
})
