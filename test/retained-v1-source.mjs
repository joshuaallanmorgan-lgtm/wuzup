import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RETAINED_V1_SOURCE_DOMAINS,
  RETAINED_V1_SOURCE_KEYS,
  RetainedV1SourceError,
  captureRetainedV1Source,
} from '../app/src/retained-v1-source.js'
import {
  LEGACY_OWNER_KEY,
  createStorageScope,
  physicalKey,
} from '../app/src/storage.js'

const TAMPA = { id: 'tampa-bay' }
const SF = { id: 'sf-east-bay' }
const DOMAIN_FOR_FIELD = {
  customEvents: 'custom',
  savedEvents: 'saved',
  beenThere: 'saved',
  recents: 'recents',
  eventDeck: 'decks',
  placeDeck: 'decks',
}

function captureDomain(domain, options) {
  return captureRetainedV1Source({ ...options, domain })
}

function captureAll(options) {
  const captures = ['custom', 'saved', 'recents', 'decks']
    .map((domain) => captureDomain(domain, options))
  return {
    source: Object.assign({}, ...captures.map((capture) => capture.source)),
    raw: Object.freeze(Object.assign({}, ...captures.map((capture) => capture.raw))),
    evidence: Object.freeze(Object.assign({}, ...captures.map((capture) => capture.evidence))),
  }
}

class MemoryStorage {
  constructor(entries = []) {
    this.map = new Map(entries)
    this.reads = []
    this.writes = []
    this.removes = []
  }

  getItem(key) {
    const normalized = String(key)
    this.reads.push(normalized)
    return this.map.has(normalized) ? this.map.get(normalized) : null
  }

  setItem(key, value) {
    const normalized = String(key)
    this.writes.push([normalized, String(value)])
    this.map.set(normalized, String(value))
  }

  removeItem(key) {
    const normalized = String(key)
    this.removes.push(normalized)
    this.map.delete(normalized)
  }
}

function rawFixture(overrides = {}) {
  return {
    customEvents: '[]',
    savedEvents: '{}',
    beenThere: '[]',
    recents: '[]',
    eventDeck: '[]',
    placeDeck: '[]',
    ...overrides,
  }
}

function scopeForRows(rows, calls = null) {
  return {
    peek(key) {
      calls?.push(['peek', key])
      const field = Object.keys(RETAINED_V1_SOURCE_KEYS)
        .find((name) => RETAINED_V1_SOURCE_KEYS[name] === key)
      const value = rows[field]
      return value === null || value === undefined
        ? { status: 'missing', value: null }
        : { status: 'ok', value, source: 'fixture' }
    },
  }
}

const factoryFor = (backend) => ({ cityId }) => createStorageScope({ backend, cityId })

function assertSourceError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof RetainedV1SourceError)
    assert.equal(error.code, code)
    return true
  })
}

test('captures the selected city with typed missing defaults and frozen read evidence', () => {
  const tampaCustom = '[{"title":"Tampa","start":"2026-07-17"}]'
  const sfCustom = '[{"title":"SF","start":"2026-07-18"}]'
  const backend = new MemoryStorage([
    [physicalKey(RETAINED_V1_SOURCE_KEYS.customEvents, { cityId: TAMPA.id }), tampaCustom],
    [physicalKey(RETAINED_V1_SOURCE_KEYS.customEvents, { cityId: SF.id }), sfCustom],
  ])

  const tampa = captureAll({
    city: TAMPA,
    storageFactory: factoryFor(backend),
  })
  const sf = captureAll({
    city: SF,
    storageFactory: factoryFor(backend),
  })

  assert.equal(tampa.raw.customEvents, tampaCustom)
  assert.equal(sf.raw.customEvents, sfCustom)
  assert.equal(tampa.source.customEvents[0].title, 'Tampa')
  assert.equal(sf.source.customEvents[0].title, 'SF')
  assert.deepEqual(tampa.source.savedEvents, {})
  assert.deepEqual(tampa.source.beenThere, [])
  assert.deepEqual(tampa.source.recents, [])
  assert.deepEqual(tampa.source.eventDeck, [])
  assert.deepEqual(tampa.source.placeDeck, [])
  assert.deepEqual(tampa.raw, {
    customEvents: tampaCustom,
    savedEvents: null,
    beenThere: null,
    recents: null,
    eventDeck: null,
    placeDeck: null,
  })
  assert.deepEqual(tampa.evidence.savedEvents, {
    key: 'saved-events-v1',
    status: 'missing',
    value: null,
    source: null,
  })
  assert.equal(tampa.evidence.customEvents.source, 'destination')
  assert.equal(Object.isFrozen(tampa.evidence), true)
  assert.equal(Object.isFrozen(tampa.evidence.customEvents), true)
  assert.throws(() => {
    tampa.evidence.customEvents.status = 'missing'
  }, TypeError)
  assert.equal(backend.writes.length, 0)
  assert.equal(backend.removes.length, 0)
})

test('an existing city destination wins while another city can retain exact legacy bytes', () => {
  const destination = '{\n  "destination": { "savedAt": 11 }\n}'
  const legacy = ' {\n  "legacy": { "savedAt": 22 }\n}\n'
  const owner = ' { "v": 1, "ownerCityId": "sf-east-bay" }\n'
  const backend = new MemoryStorage([
    [physicalKey(RETAINED_V1_SOURCE_KEYS.savedEvents, { cityId: TAMPA.id }), destination],
    [`twh:${RETAINED_V1_SOURCE_KEYS.savedEvents}`, legacy],
    [LEGACY_OWNER_KEY, owner],
  ])
  const before = [...backend.map]

  const tampa = captureDomain('saved', {
    city: TAMPA,
    storageFactory: factoryFor(backend),
  })
  const sf = captureDomain('saved', {
    city: SF,
    storageFactory: factoryFor(backend),
  })

  assert.equal(tampa.raw.savedEvents, destination)
  assert.equal(tampa.evidence.savedEvents.source, 'destination')
  assert.deepEqual(tampa.source.savedEvents, { destination: { savedAt: 11 } })
  assert.equal(sf.raw.savedEvents, legacy)
  assert.equal(sf.evidence.savedEvents.source, 'legacy')
  assert.deepEqual(sf.source.savedEvents, { legacy: { savedAt: 22 } })
  assert.equal(sf.evidence.savedEvents.value, legacy)
  assert.equal(backend.map.get(LEGACY_OWNER_KEY), owner)
  assert.deepEqual([...backend.map], before, 'capture preserves source and owner bytes exactly')
  assert.equal(backend.writes.length, 0)
  assert.equal(backend.removes.length, 0)
})

test('legacy-only capture neither claims ownership nor copies, removes, or tombstones bytes', () => {
  const rows = rawFixture({
    customEvents: '[\n  { "title": "Porch show", "start": "2026-07-17" }\n]',
    savedEvents: '{ "old|key": { "savedAt": 5 } }',
    recents: '[ "old|key" ]',
  })
  const backend = new MemoryStorage(
    Object.entries(rows).map(([field, raw]) => [
      `twh:${RETAINED_V1_SOURCE_KEYS[field]}`,
      raw,
    ]),
  )
  const before = [...backend.map]

  const captured = captureAll({
    city: TAMPA,
    storageFactory: factoryFor(backend),
  })

  assert.deepEqual(captured.raw, rows)
  for (const field of Object.keys(RETAINED_V1_SOURCE_KEYS)) {
    assert.equal(captured.evidence[field].source, 'legacy')
    assert.equal(captured.evidence[field].value, rows[field])
    assert.equal(
      backend.map.has(physicalKey(RETAINED_V1_SOURCE_KEYS[field], { cityId: TAMPA.id })),
      false,
    )
  }
  assert.equal(backend.map.has(LEGACY_OWNER_KEY), false)
  assert.deepEqual([...backend.map], before)
  assert.equal(backend.writes.length, 0)
  assert.equal(backend.removes.length, 0)
})

test('an authoritative city tombstone stays empty and never revives legacy bytes', () => {
  const legacy = '{"old":{"savedAt":22}}'
  const backend = new MemoryStorage([
    [`twh:${RETAINED_V1_SOURCE_KEYS.savedEvents}`, legacy],
  ])
  const scope = createStorageScope({ backend, cityId: TAMPA.id })
  assert.equal(scope.remove(RETAINED_V1_SOURCE_KEYS.savedEvents), true)
  const before = [...backend.map]

  const captured = captureDomain('saved', {
    city: TAMPA,
    storageFactory: factoryFor(backend),
  })

  assert.equal(captured.raw.savedEvents, null)
  assert.deepEqual(captured.source.savedEvents, {})
  assert.deepEqual(captured.evidence.savedEvents, {
    key: RETAINED_V1_SOURCE_KEYS.savedEvents,
    status: 'ok',
    value: null,
    source: 'destination',
  })
  assert.deepEqual([...backend.map], before)
  assert.equal(backend.map.get(`twh:${RETAINED_V1_SOURCE_KEYS.savedEvents}`), legacy)
})

test('preserves invalid custom-event rows and all other child evidence losslessly', () => {
  const customRows = [
    null,
    17,
    'not an event',
    {},
    { title: '', start: 'not-a-date', unknown: { keep: true } },
    { title: 'Valid', start: '2026-07-17', id: 'custom-1' },
  ]
  const rows = rawFixture({
    customEvents: ` \n${JSON.stringify(customRows)}\n`,
    savedEvents: '{"bad":null,"odd":17}',
    beenThere: '[null,17,{"key":false}]',
    recents: '[null,17,{}]',
    eventDeck: '[false,{"key":"odd"}]',
    placeDeck: '[null,"p|one"]',
  })

  const captured = captureAll({
    city: TAMPA,
    storageFactory: () => scopeForRows(rows),
  })

  assert.deepEqual(captured.source.customEvents, customRows)
  assert.deepEqual(captured.source.savedEvents, { bad: null, odd: 17 })
  assert.deepEqual(captured.source.beenThere, [null, 17, { key: false }])
  assert.deepEqual(captured.source.recents, [null, 17, {}])
  assert.deepEqual(captured.source.eventDeck, [false, { key: 'odd' }])
  assert.deepEqual(captured.source.placeDeck, [null, 'p|one'])
  assert.equal(captured.raw.customEvents, rows.customEvents)
})

test('corruption is isolated to its migration domain', () => {
  const rows = rawFixture({
    customEvents: '[{"title":"Keep me","start":"2026-07-17"}]',
    eventDeck: '[}',
  })
  const custom = captureDomain('custom', {
    city: TAMPA,
    storageFactory: () => scopeForRows(rows),
  })

  assert.equal(custom.source.customEvents[0].title, 'Keep me')
  assert.deepEqual(Object.keys(custom.source), ['customEvents'])
  assertSourceError(
    () => captureDomain('decks', {
      city: TAMPA,
      storageFactory: () => scopeForRows(rows),
    }),
    'RETAINED_V1_CORRUPT_SOURCE',
  )
})

test('uses only strict peeks and never calls a writer or legacy loader seam', () => {
  const rows = rawFixture()
  const calls = []
  const scope = {
    ...scopeForRows(rows, calls),
    get() {
      calls.push(['get'])
      throw new Error('must not use side-effecting get')
    },
    set() {
      calls.push(['set'])
      throw new Error('must not write')
    },
    remove() {
      calls.push(['remove'])
      throw new Error('must not remove')
    },
  }

  captureAll({
    city: TAMPA,
    storageFactory: ({ cityId }) => {
      assert.equal(cityId, TAMPA.id)
      return scope
    },
  })

  assert.deepEqual(
    calls,
    Object.values(RETAINED_V1_SOURCE_KEYS).map((key) => ['peek', key]),
  )
})

test('storage initialization and backend read failures are explicit and never look absent', () => {
  assertSourceError(
    () => captureDomain('custom', {
      city: TAMPA,
      storageFactory: () => {
        throw new Error('no storage')
      },
    }),
    'RETAINED_V1_STORAGE_INIT',
  )
  assertSourceError(
    () => captureDomain('custom', {
      city: TAMPA,
      storageFactory: () => ({}),
    }),
    'RETAINED_V1_STORAGE_INIT',
  )
  assertSourceError(
    () => captureDomain('custom', {
      city: TAMPA,
      storageFactory: () => ({
        peek() {
          throw new Error('privacy mode')
        },
      }),
    }),
    'RETAINED_V1_STORAGE_READ',
  )
  assertSourceError(
    () => captureDomain('custom', {
      city: TAMPA,
      storageFactory: () => ({
        peek: () => ({ status: 'io-error', error: new Error('denied') }),
      }),
    }),
    'RETAINED_V1_STORAGE_READ',
  )
  assertSourceError(
    () => captureDomain('custom', {
      city: TAMPA,
      storageFactory: () => ({
        peek: () => ({ status: 'ok', value: 17 }),
      }),
    }),
    'RETAINED_V1_INVALID_RAW',
  )
})

test('malformed JSON and every wrong top-level shape fail with typed errors', () => {
  assertSourceError(
    () => captureDomain('custom', {
      city: TAMPA,
      storageFactory: () => scopeForRows(rawFixture({ customEvents: '[}' })),
    }),
    'RETAINED_V1_CORRUPT_SOURCE',
  )

  const wrongShapes = {
    customEvents: '{}',
    savedEvents: '[]',
    beenThere: '{}',
    recents: '{}',
    eventDeck: '{}',
    placeDeck: 'null',
  }
  for (const [field, value] of Object.entries(wrongShapes)) {
    assertSourceError(
      () => captureDomain(DOMAIN_FOR_FIELD[field], {
        city: TAMPA,
        storageFactory: () => scopeForRows(rawFixture({ [field]: value })),
      }),
      'RETAINED_V1_INVALID_SOURCE',
    )
  }

  for (const city of [undefined, null, {}, { id: '' }, { id: '../sf' }]) {
    assertSourceError(
      () => captureDomain('custom', {
        city,
        storageFactory: () => scopeForRows(rawFixture()),
      }),
      'RETAINED_V1_INVALID_CITY',
    )
  }

  assertSourceError(
    () => captureRetainedV1Source({
      city: TAMPA,
      domain: 'everything',
      storageFactory: () => scopeForRows(rawFixture()),
    }),
    'RETAINED_V1_INVALID_DOMAIN',
  )
  assertSourceError(
    () => captureDomain('custom', {
      city: TAMPA,
      storageFactory: () => ({
        cityId: SF.id,
        peek: () => ({ status: 'missing', value: null }),
      }),
    }),
    'RETAINED_V1_STORAGE_CITY_MISMATCH',
  )
})
