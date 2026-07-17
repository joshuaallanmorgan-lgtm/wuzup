import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CUSTOM_EVENT_ALIAS_MAX_COUNT,
  CUSTOM_EVENT_CAP,
  CUSTOM_EVENT_COMMAND_MAX_BYTES,
  CUSTOM_EVENT_DOCUMENT_MAX_BYTES,
  CUSTOM_EVENT_IMPORT_CAP,
  CUSTOM_EVENT_STATE_VERSION,
  CUSTOM_EVENT_STRING_MAX_BYTES,
  CustomEventStateError,
  canonicalizeCustomEventCommand,
  customEventItems as customEventItemsRaw,
  customEventStateBytes,
  emptyCustomEventState as emptyCustomEventStateRaw,
  migrateV1CustomEventState as migrateV1CustomEventStateRaw,
  normalizeCustomEventState as normalizeCustomEventStateRaw,
  reduceCustomEventState as reduceCustomEventStateRaw,
} from '../app/src/custom-event-state-core.js'
import { activityRefOf } from '../app/src/activity-state-core.js'
import { savedBeenRefOf } from '../app/src/saved-been-state-core.js'
import { createAtomicCityStore } from '../app/src/atomic-city-store.js'
import {
  aliasesOf,
  primaryKeyOf,
} from '../app/src/identity.js'
import {
  createStorageScope,
  physicalKey,
} from '../app/src/storage.js'

const CITY_ID = 'tampa-bay'
const OTHER_CITY_ID = 'sf-east-bay'
const CITY = { id: CITY_ID, tz: 'America/New_York' }
const CITY_TIME_ZONES = {
  [CITY_ID]: CITY.tz,
  [OTHER_CITY_ID]: 'America/Los_Angeles',
}
const clone = (value) => structuredClone(value)

function contextFor(cityId = CITY_ID, timeZone = CITY_TIME_ZONES[cityId] ?? CITY.tz) {
  return { cityId, timeZone }
}

function emptyCustomEventState(cityId, options = {}) {
  return emptyCustomEventStateRaw(cityId, {
    timeZone: options.timeZone ?? CITY_TIME_ZONES[cityId],
    ...(options.city ? { city: options.city } : {}),
  })
}

function normalizeCustomEventState(value, options = {}) {
  const cityId = options.cityId ?? CITY_ID
  return normalizeCustomEventStateRaw(value, {
    ...contextFor(cityId, options.timeZone),
    ...(options.city ? { city: options.city } : {}),
  })
}

function customEventItems(value, options = {}) {
  const cityId = options.cityId ?? CITY_ID
  return customEventItemsRaw(value, {
    ...options,
    ...contextFor(cityId, options.timeZone),
  })
}

function reduceCustomEventState(value, command, options = {}) {
  const cityId = options.cityId ?? value?.cityId ?? CITY_ID
  return reduceCustomEventStateRaw(value, command, contextFor(cityId, options.timeZone))
}

function migrateV1CustomEventState(source, options = {}) {
  const cityId = options.cityId ?? options.city?.id ?? CITY_ID
  return migrateV1CustomEventStateRaw(source, {
    ...options,
    timeZone: options.timeZone ?? options.city?.tz ?? CITY_TIME_ZONES[cityId],
  })
}

class MemoryStorage {
  constructor() {
    this.map = new Map()
    this.failKeys = new Set()
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null
  }

  setItem(key, value) {
    const selected = String(key)
    if (this.failKeys.has(selected)) throw new Error('quota')
    this.map.set(selected, String(value))
  }

  removeItem(key) {
    this.map.delete(String(key))
  }
}

class SerialLocks {
  constructor() {
    this.tail = Promise.resolve()
  }

  request(_name, _options, callback) {
    const before = this.tail
    let release
    this.tail = new Promise((resolve) => {
      release = resolve
    })
    return before.then(callback).finally(release)
  }
}

const event = (overrides = {}) => ({
  title: 'Porch show',
  start: '2026-07-21T20:00:00',
  end: null,
  venue: 'The porch',
  address: '1 Main St',
  price: 0,
  currency: 'USD',
  isFree: true,
  lat: null,
  lng: null,
  url: null,
  image: null,
  description: 'Bring a chair.',
  source: 'Added by you',
  sources: ['Added by you'],
  buzz: 1,
  hotScore: null,
  tags: ['added-by-you', 'free'],
  category: 'music',
  sponsored: false,
  ...overrides,
})

const capture = (rows, { status = 'ok' } = {}) => ({
  source: { customEvents: rows },
  evidence: {
    customEvents: {
      key: 'my-events-v1',
      status,
      value: status === 'ok' ? JSON.stringify(rows) : null,
      source: status === 'ok' ? 'v2' : null,
    },
  },
})

function migrate(rows, options = {}) {
  const retained = capture(rows)
  return migrateV1CustomEventState(retained.source, {
    city: CITY,
    evidence: retained.evidence,
    ...options,
  })
}

function add(document, raw) {
  return reduceCustomEventState(document, { type: 'add', event: raw })
}

function atomicStore(backend) {
  let id = 0
  return createAtomicCityStore({
    city: CITY,
    storageKey: 'custom-events-v2',
    storeId: 'custom-events',
    emptyDocument: () => emptyCustomEventState(CITY_ID),
    validateDocument: (value) => normalizeCustomEventState(value, { cityId: CITY_ID }),
    documentBytes: customEventStateBytes,
    maxBytes: CUSTOM_EVENT_DOCUMENT_MAX_BYTES,
    reduceDocument: reduceCustomEventState,
    canonicalizeCommand: canonicalizeCustomEventCommand,
    migrate: (source, context) => migrateV1CustomEventState(source, context),
    storageFactory: ({ cityId }) => createStorageScope({ backend, cityId }),
    lockManager: new SerialLocks(),
    eventTarget: null,
    createId: () => `custom-operation-${++id}`,
    contextId: 'custom-event-test-context',
    now: () => 1_752_700_000_000,
    commandMaxBytes: CUSTOM_EVENT_COMMAND_MAX_BYTES,
  })
}

test('empty state is city-bound, versioned, bounded, and deeply immutable', () => {
  const document = emptyCustomEventState(CITY_ID)
  assert.deepEqual(document, {
    v: CUSTOM_EVENT_STATE_VERSION,
    cityId: CITY_ID,
    timeZone: CITY.tz,
    rev: 0,
    items: [],
  })
  assert.equal(Object.isFrozen(document), true)
  assert.equal(Object.isFrozen(document.items), true)
  assert.ok(customEventStateBytes(document) <= CUSTOM_EVENT_DOCUMENT_MAX_BYTES)
  for (const cityId of [undefined, null, '', '../sf', 'SF East Bay']) {
    assert.throws(() => emptyCustomEventState(cityId), TypeError)
  }
})

test('strict retained migration preserves stable and legacy evidence without touching V1', () => {
  const rows = [
    event(),
    event({
      title: 'Existing identity',
      start: '2026-07-22',
      localId: 'existing-local-id',
      identityAliases: ['Existing identity|2026-07-20'],
    }),
  ]
  const retained = capture(rows)
  const before = clone(retained)
  let createCalls = 0
  const first = migrateV1CustomEventState(retained.source, {
    city: CITY,
    evidence: retained.evidence,
    createId: () => {
      createCalls += 1
      return 'caller-random-id'
    },
  })
  const second = migrateV1CustomEventState(clone(retained.source), {
    cityId: CITY_ID,
    evidence: clone(retained.evidence),
    createId: () => 'different-random-id',
  })

  assert.deepEqual(retained, before, 'migration is pure and cannot overwrite V1')
  assert.deepEqual(second, first, 'migration IDs do not drift across blocked-write retries')
  assert.equal(createCalls, 0, 'deterministic migration does not consume caller entropy')
  assert.equal(first.status, 'migrated')
  assert.deepEqual(first.diagnostics, {
    received: 2,
    imported: 2,
    rejected: 0,
    reminted: 1,
    invalidSource: false,
    counts: {},
    issues: [],
    issuesTruncated: false,
  })
  assert.equal(first.sourceSummary.key, 'my-events-v1')
  assert.equal(first.sourceSummary.status, 'ok')
  assert.equal(first.sourceSummary.rawBytes, Buffer.byteLength(JSON.stringify(rows)))
  assert.match(first.document.items[0].primary, /^c\|migrated-[0-9a-f]{16}$/)
  assert.deepEqual(first.document.items[0].aliases, [
    first.document.items[0].primary,
    'Porch show|2026-07-21T20:00:00',
  ])
  assert.deepEqual(first.document.items[1].aliases, [
    'c|existing-local-id',
    'Existing identity|2026-07-22',
    'Existing identity|2026-07-20',
  ])
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.document.items[0].item), true)
})

test('missing evidence creates an honest empty destination and conflicting city inputs fail', () => {
  const retained = capture([], { status: 'missing' })
  const result = migrateV1CustomEventState(retained.source, {
    city: CITY,
    evidence: retained.evidence,
  })
  assert.equal(result.status, 'empty')
  assert.deepEqual(result.document, emptyCustomEventState(CITY_ID))
  assert.equal(result.sourceSummary.status, 'missing')

  assert.throws(
    () => migrateV1CustomEventState(retained.source, {
      city: CITY,
      cityId: OTHER_CITY_ID,
      evidence: retained.evidence,
    }),
    (error) => error instanceof CustomEventStateError
      && error.code === 'CUSTOM_EVENT_CITY_MISMATCH',
  )
  assert.throws(
    () => migrateV1CustomEventState(retained.source, {
      city: { id: CITY_ID, tz: 'Mars/Olympus' },
      evidence: retained.evidence,
    }),
    (error) => error instanceof CustomEventStateError
      && error.code === 'CUSTOM_EVENT_CITY_MISMATCH',
  )
})

test('generic atomic initialization is destination-first and leaves rejected V1 bytes exact', async () => {
  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: CITY_ID })
  const malformed = [event(), null]
  assert.equal(scope.set('my-events-v1', JSON.stringify(malformed)), true)
  const sourceBytes = backend.getItem(physicalKey('my-events-v1', { cityId: CITY_ID }))
  const retained = capture(malformed)
  const failed = atomicStore(backend)
  const result = await failed.initialize({
    sourceFactory: () => ({
      source: retained.source,
      context: { evidence: retained.evidence },
    }),
  })
  assert.equal(result.code, 'migration-failed')
  assert.equal(
    backend.getItem(physicalKey('custom-events-v2', { cityId: CITY_ID })),
    null,
  )
  assert.equal(
    backend.getItem(physicalKey('my-events-v1', { cityId: CITY_ID })),
    sourceBytes,
  )

  const tombstoneBackend = new MemoryStorage()
  const tombstoneScope = createStorageScope({
    backend: tombstoneBackend,
    cityId: CITY_ID,
  })
  assert.equal(tombstoneScope.remove('custom-events-v2'), true)
  const tombstoneBytes = tombstoneBackend.getItem(
    physicalKey('custom-events-v2', { cityId: CITY_ID }),
  )
  let sourceCalls = 0
  const tombstoned = atomicStore(tombstoneBackend)
  const blocked = await tombstoned.initialize({
    sourceFactory: () => {
      sourceCalls += 1
      return capture([])
    },
  })
  assert.equal(blocked.code, 'corrupt-destination')
  assert.equal(sourceCalls, 0)
  assert.equal(
    tombstoneBackend.getItem(physicalKey('custom-events-v2', { cityId: CITY_ID })),
    tombstoneBytes,
  )
})

test('generic atomic store persists canonical commands and valid destination wins on reload', async () => {
  const backend = new MemoryStorage()
  const retained = capture([event()])
  const first = atomicStore(backend)
  const initialized = await first.initialize({
    sourceFactory: () => ({
      source: retained.source,
      context: { evidence: retained.evidence },
    }),
  })
  assert.equal(initialized.persisted, true)
  assert.equal(first.getSnapshot().document.items.length, 1)

  const added = await first.dispatch({
    type: 'add',
    event: event({
      title: 'Atomic add',
      start: '2026-07-25',
      localId: 'atomic-local-id',
    }),
  })
  assert.equal(added.persisted, true)
  assert.equal(first.getSnapshot().document.items.length, 2)

  let sourceCalls = 0
  const second = atomicStore(backend)
  const existing = await second.initialize({
    sourceFactory: () => {
      sourceCalls += 1
      throw new Error('valid destination must win')
    },
  })
  assert.equal(existing.code, 'existing-destination')
  assert.equal(sourceCalls, 0)
  assert.equal(second.getSnapshot().document.items.length, 2)
})

test('raw evidence must exactly match the parsed retained source', () => {
  const retained = capture([event()])
  retained.source.customEvents[0].title = 'Changed after capture'
  assert.throws(
    () => migrateV1CustomEventState(retained.source, {
      city: CITY,
      evidence: retained.evidence,
    }),
    (error) => error.code === 'CUSTOM_EVENT_EVIDENCE_MISMATCH',
  )

  retained.evidence.customEvents.key = 'wrong-key'
  assert.throws(
    () => migrateV1CustomEventState(retained.source, {
      city: CITY,
      evidence: retained.evidence,
    }),
    (error) => error.code === 'CUSTOM_EVENT_INVALID_EVIDENCE',
  )

  const compact = capture([event()])
  const rawBytes = Buffer.byteLength(compact.evidence.customEvents.value)
  delete compact.evidence.customEvents.value
  compact.evidence.customEvents.rawBytes = rawBytes
  assert.throws(
    () => migrateV1CustomEventState(compact.source, {
      city: CITY,
      evidence: compact.evidence,
    }),
    (error) => error.code === 'CUSTOM_EVENT_INVALID_EVIDENCE',
  )
  assert.throws(
    () => migrateV1CustomEventState({ customEvents: [event()] }, {
      city: CITY,
      evidence: null,
    }),
    (error) => error.code === 'CUSTOM_EVENT_EVIDENCE_REQUIRED',
  )

  const exactRow = capture([event()]).evidence.customEvents
  for (const evidence of [false, 'evidence', [], exactRow]) {
    assert.throws(
      () => migrateV1CustomEventState({ customEvents: [event()] }, {
        city: CITY,
        evidence,
      }),
      (error) => error.code === 'CUSTOM_EVENT_EVIDENCE_REQUIRED',
    )
  }
  for (const customEvents of [null, false, 'evidence', []]) {
    assert.throws(
      () => migrateV1CustomEventState({ customEvents: [event()] }, {
        city: CITY,
        evidence: { customEvents },
      }),
      (error) => error.code === 'CUSTOM_EVENT_INVALID_EVIDENCE',
    )
  }
  for (const source of [null, false, 'source', [], { customEvents: null }]) {
    assert.throws(
      () => migrateV1CustomEventState(source, {
        city: CITY,
        evidence: capture([]).evidence,
      }),
      (error) => error.code === 'CUSTOM_EVENT_INVALID_SOURCE',
    )
  }
})

test('malformed, oversized, and duplicate V1 rows block destination creation without partial loss', () => {
  for (const bad of [
    null,
    {},
    event({ title: '' }),
    event({ start: '2026-02-30' }),
    event({ end: 'not-a-date' }),
    event({ url: 'javascript:alert(1)' }),
    event({ lat: 91 }),
    event({ price: -1 }),
    event({ source: 'Eventbrite' }),
    event({ secretNote: 'must not disappear' }),
    event({ identityAliases: ['kept|2026-07-20', 'x'.repeat(3000)] }),
    event({ identityAliases: ['kept|2026-07-20', 42] }),
    event({ identityAliases: 'not-an-array' }),
    event({ identityAliases: ['not-an-identity'] }),
    event({ identityAliases: ['e|0123456789abcdef'] }),
    event({ identityAliases: ['p|forged-place'] }),
    event({ identityAliases: ['c|another-local-id'] }),
    event({ tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) }),
    event({ sources: Array.from({ length: 21 }, (_, index) => `source-${index}`) }),
    event({ description: 'x'.repeat(33 * 1024) }),
  ]) {
    const retained = capture([event(), bad])
    const before = clone(retained)
    assert.throws(
      () => migrateV1CustomEventState(retained.source, {
        city: CITY,
        evidence: retained.evidence,
      }),
      (error) => error.code === 'CUSTOM_EVENT_MIGRATION_REJECTED'
        && error.details.received === 2
        && error.details.imported === 1,
    )
    assert.deepEqual(retained, before)
  }

  const duplicate = [event(), event({ localId: 'different-local-id' })]
  assert.throws(
    () => migrate(duplicate),
    (error) => error.code === 'CUSTOM_EVENT_MIGRATION_REJECTED'
      && error.details.counts['duplicate-identity'] === 1,
  )
  assert.throws(
    () => migrateV1CustomEventState({}, { city: CITY }),
    (error) => error.code === 'CUSTOM_EVENT_INVALID_SOURCE',
  )
  assert.throws(
    () => migrateV1CustomEventState({ customEvents: [] }, { city: CITY }),
    (error) => error.code === 'CUSTOM_EVENT_EVIDENCE_REQUIRED',
  )
  assert.throws(
    () => migrate(Array.from({ length: CUSTOM_EVENT_CAP + 1 }, (_, index) => event({
      title: `Event ${index}`,
      start: `2026-08-${String(index % 28 + 1).padStart(2, '0')}`,
    }))),
    (error) => error.code === 'CUSTOM_EVENT_SOURCE_OVERFLOW',
  )
})

test('duplicate local IDs are repaired deterministically while the first owner remains stable', () => {
  const result = migrate([
    event({ title: 'First', localId: 'duplicate-local-id' }),
    event({
      title: 'Second',
      start: '2026-07-22',
      localId: 'duplicate-local-id',
    }),
  ])
  assert.equal(result.document.items[0].primary, 'c|duplicate-local-id')
  assert.match(result.document.items[1].primary, /^c\|migrated-[0-9a-f]{16}$/)
  assert.notEqual(result.document.items[1].primary, result.document.items[0].primary)
  assert.equal(result.diagnostics.reminted, 1)

  const missing = event({ title: 'Missing identity owner' })
  const wouldClaim = migrate([missing]).document.items[0].item.localId
  const reserved = migrate([
    missing,
    event({
      title: 'Existing future owner',
      start: '2026-07-22',
      localId: wouldClaim,
    }),
  ])
  assert.notEqual(reserved.document.items[0].item.localId, wouldClaim)
  assert.equal(reserved.document.items[1].item.localId, wouldClaim)
})

test('normalization rejects cross-city, duplicate identity, bad revision, and oversize state', () => {
  const document = migrate([event()]).document
  assert.deepEqual(normalizeCustomEventState(document, { cityId: CITY_ID }), document)
  assert.equal(normalizeCustomEventState(document, { cityId: OTHER_CITY_ID }), null)
  assert.equal(normalizeCustomEventState({
    ...document,
    items: [...document.items, clone(document.items[0])],
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeCustomEventState({
    ...document,
    items: document.items.map((item) => ({ ...item, revision: document.rev + 1 })),
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeCustomEventState({
    ...document,
    items: Array.from({ length: CUSTOM_EVENT_CAP + 1 }, () => document.items[0]),
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeCustomEventState({
    ...document,
    items: document.items.map((item) => ({
      ...item,
      item: { ...item.item, title: 'x'.repeat(CUSTOM_EVENT_STRING_MAX_BYTES) },
    })),
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeCustomEventState({
    ...document,
    items: document.items.map((item) => ({
      ...item,
      item: { ...item.item, identityAliases: ['silently-dropped|2026-07-20'] },
    })),
  }, { cityId: CITY_ID }), null)
})

test('projection exposes c| identity only after exact durable persistence', () => {
  const document = migrate([event()]).document
  const durable = customEventItems(document, {
    cityId: CITY_ID,
    durability: 'durable',
  })[0]
  const pending = customEventItems(document, {
    cityId: CITY_ID,
    durability: 'session-only',
  })[0]
  const unknown = customEventItems(document, { cityId: CITY_ID })[0]

  assert.match(primaryKeyOf(durable), /^c\|/)
  assert.equal(durable.identityAliases.includes(document.items[0].primary), false)
  assert.match(primaryKeyOf(pending), /^session-custom-[0-9a-f]{16}\|/)
  assert.equal(pending._sessionLegacyIdentity, 'Porch show|2026-07-21T20:00:00')
  assert.equal(aliasesOf(pending).some((alias) => alias.startsWith('c|')), false)
  assert.equal(pending.identityAliases.some((alias) => alias.startsWith('c|')), false)
  assert.equal(primaryKeyOf(unknown), primaryKeyOf(pending))
  assert.equal(Object.isFrozen(durable), true)
  assert.deepEqual(customEventItems(document, { cityId: OTHER_CITY_ID }), [])
})

test('add is deterministic, immutable, bounded, and rejects identity collisions', () => {
  const empty = emptyCustomEventState(CITY_ID)
  const raw = event({ localId: 'new-local-id-0001' })
  const added = add(empty, raw)
  assert.equal(added.code, 'added')
  assert.equal(added.changed, true)
  assert.equal(added.document.rev, 1)
  assert.equal(added.document.items[0].revision, 1)
  assert.deepEqual(empty, emptyCustomEventState(CITY_ID))
  assert.equal(Object.isFrozen(added), true)
  assert.deepEqual(
    canonicalizeCustomEventCommand({ type: 'ignored' }, added),
    added.canonicalCommand,
  )

  const duplicateId = add(added.document, event({
    title: 'Different event',
    start: '2026-07-22',
    localId: 'new-local-id-0001',
  }))
  assert.equal(duplicateId.code, 'duplicate-local-id')
  assert.deepEqual(duplicateId.document, added.document)

  const duplicateLegacy = add(added.document, event({ localId: 'other-local-id' }))
  assert.equal(duplicateLegacy.code, 'duplicate-identity')
  assert.deepEqual(duplicateLegacy.document, added.document)
  assert.equal(add(empty, event({ localId: null })).code, 'invalid-event')
})

test('update retains prior aliases and rejects stale or colliding revisions', () => {
  const first = add(
    emptyCustomEventState(CITY_ID),
    event({ localId: 'first-local-id' }),
  )
  const second = add(first.document, event({
    title: 'Second',
    start: '2026-07-22',
    localId: 'second-local-id',
  }))
  const updatedEvent = {
    ...first.item,
    title: 'Porch show moved',
    start: '2026-07-23T20:00:00',
  }
  const updated = reduceCustomEventState(second.document, {
    type: 'update',
    localId: 'first-local-id',
    expectedRevision: 1,
    event: updatedEvent,
  })
  assert.equal(updated.code, 'updated')
  assert.equal(updated.document.rev, 3)
  assert.equal(updated.document.items[0].revision, 3)
  assert.deepEqual(updated.document.items[0].aliases, [
    'c|first-local-id',
    'Porch show moved|2026-07-23T20:00:00',
    'Porch show|2026-07-21T20:00:00',
  ])

  const stale = reduceCustomEventState(updated.document, {
    type: 'update',
    localId: 'first-local-id',
    expectedRevision: 1,
    event: { ...updated.item, title: 'Stale edit' },
  })
  assert.equal(stale.code, 'item-revision-conflict')
  assert.equal(stale.conflict.actualRevision, 3)

  const collision = reduceCustomEventState(second.document, {
    type: 'update',
    localId: 'second-local-id',
    expectedRevision: 2,
    event: {
      ...second.item,
      title: 'Porch show',
      start: '2026-07-21T20:00:00',
      allDay: false,
    },
  })
  assert.equal(collision.code, 'duplicate-identity')
})

test('alias history fails closed at its cap instead of dropping current identity', () => {
  let current = add(
    emptyCustomEventState(CITY_ID),
    event({ localId: 'history-local-id' }),
  )
  for (let count = 2; count < CUSTOM_EVENT_ALIAS_MAX_COUNT; count += 1) {
    const entry = current.document.items[0]
    const updated = reduceCustomEventState(current.document, {
      type: 'update',
      localId: 'history-local-id',
      expectedRevision: entry.revision,
      event: {
        ...current.item,
        title: `Porch revision ${count}`,
      },
    })
    assert.equal(updated.changed, true)
    current = updated
  }
  assert.equal(current.document.items[0].aliases.length, CUSTOM_EVENT_ALIAS_MAX_COUNT)
  const entry = current.document.items[0]
  const overflow = reduceCustomEventState(current.document, {
    type: 'update',
    localId: 'history-local-id',
    expectedRevision: entry.revision,
    event: { ...current.item, title: 'One revision too many' },
  })
  assert.equal(overflow.code, 'invalid-event')
  assert.deepEqual(overflow.document, current.document)
  assert.ok(current.document.items[0].aliases.includes(
    `${current.item.title}|${current.item.start}`,
  ))
})

test('delete is revision-bound and never guesses a stale target', () => {
  const added = add(
    emptyCustomEventState(CITY_ID),
    event({ localId: 'delete-local-id' }),
  )
  const stale = reduceCustomEventState(added.document, {
    type: 'delete',
    localId: 'delete-local-id',
    expectedRevision: 0,
  })
  assert.equal(stale.code, 'item-revision-conflict')

  const removed = reduceCustomEventState(added.document, {
    type: 'delete',
    localId: 'delete-local-id',
    expectedRevision: 1,
  })
  assert.equal(removed.code, 'deleted')
  assert.equal(removed.document.rev, 2)
  assert.deepEqual(removed.document.items, [])
  assert.equal(Object.isFrozen(removed), true)
})

test('merge and replace import are atomic, revision-bound, and command-bounded', () => {
  const base = add(
    emptyCustomEventState(CITY_ID),
    event({ localId: 'base-local-id' }),
  )
  const importedEvent = event({
    title: 'Imported',
    start: '2026-07-24',
    localId: 'import-local-id',
  })
  const merged = reduceCustomEventState(base.document, {
    type: 'import',
    mode: 'merge',
    expectedRevision: 1,
    events: [importedEvent],
  })
  assert.equal(merged.code, 'import-merged')
  assert.equal(merged.document.items.length, 2)
  assert.equal(merged.canonicalCommand.events.length, 1)
  assert.ok(customEventStateBytes(merged.canonicalCommand) <= CUSTOM_EVENT_COMMAND_MAX_BYTES)

  const stale = reduceCustomEventState(merged.document, {
    type: 'import',
    mode: 'replace',
    expectedRevision: 1,
    events: [importedEvent],
  })
  assert.equal(stale.code, 'document-revision-conflict')

  const replaced = reduceCustomEventState(merged.document, {
    type: 'import',
    mode: 'replace',
    expectedRevision: 2,
    events: [importedEvent],
  })
  assert.equal(replaced.code, 'import-replaced')
  assert.deepEqual(replaced.document.items.map((item) => item.primary), ['c|import-local-id'])

  const duplicate = reduceCustomEventState(base.document, {
    type: 'import',
    mode: 'merge',
    expectedRevision: 1,
    events: [importedEvent, clone(importedEvent)],
  })
  assert.equal(duplicate.code, 'duplicate-import-identity')

  const fullReplacement = Array.from({ length: CUSTOM_EVENT_CAP }, (_, index) => ({
    title: `R${index}`,
    start: `2026-08-${String(index % 28 + 1).padStart(2, '0')}`,
    localId: `replacement-${String(index).padStart(3, '0')}`,
  }))
  const documentSized = reduceCustomEventState(emptyCustomEventState(CITY_ID), {
    type: 'import',
    mode: 'replace',
    expectedRevision: 0,
    events: fullReplacement,
  })
  assert.equal(documentSized.code, 'import-replaced')
  assert.equal(documentSized.document.items.length, CUSTOM_EVENT_CAP)
  assert.ok(customEventStateBytes(documentSized.canonicalCommand) <= CUSTOM_EVENT_COMMAND_MAX_BYTES)

  const overflow = reduceCustomEventState(base.document, {
    type: 'import',
    mode: 'merge',
    expectedRevision: 1,
    events: Array.from({ length: CUSTOM_EVENT_IMPORT_CAP + 1 }, (_, index) => event({
      title: `Import ${index}`,
      start: `2026-08-${String(index % 28 + 1).padStart(2, '0')}`,
      localId: `import-local-${String(index).padStart(3, '0')}`,
    })),
  })
  assert.equal(overflow.code, 'invalid-import')
})

test('event time contracts reject backwards, mixed, impossible-offset, and fake-zone input', () => {
  const document = emptyCustomEventState(CITY_ID)
  for (const raw of [
    event({ localId: 'backward-day', start: '2026-07-22', end: '2026-07-21' }),
    event({ localId: 'backward-local', start: '2026-07-22T20:00:00', end: '2026-07-22T19:59:59' }),
    event({ localId: 'backward-offset', start: '2026-07-22T20:00:00-04:00', end: '2026-07-22T20:30:00-03:00' }),
    event({ localId: 'mixed-precision', start: '2026-07-22', end: '2026-07-22T20:00:00' }),
    event({ localId: 'bad-offset', start: '2026-07-22T20:00:00+14:30' }),
    event({ localId: 'fake-zone', timeZone: 'Mars/Olympus' }),
    event({ localId: 'wrong-zone', timeZone: 'America/Los_Angeles' }),
    event({ localId: 'timed-all-day', allDay: true }),
    event({ localId: 'date-not-all-day', start: '2026-07-22', allDay: false }),
    event({ localId: 'dst-gap-time', start: '2026-03-08T02:30:00' }),
  ]) {
    assert.equal(add(document, raw).code, 'invalid-event')
  }

  assert.equal(add(document, event({
    localId: 'valid-zone',
    end: '2026-07-21T22:00:00',
    timeZone: 'America/New_York',
  })).code, 'added')
})

test('persisted schema rejects missing, malformed, and silently droppable identity fields', () => {
  const document = migrate([event()]).document
  const entry = document.items[0]
  for (const malformed of [
    { ...entry, aliases: undefined },
    { ...entry, aliases: entry.aliases[0] },
    { ...entry, extraIdentity: 'forged' },
    { ...entry, item: { ...entry.item, identityAliases: ['old|2026-07-20'] } },
    { ...entry, item: { ...entry.item, unexpectedIdentityAliases: [] } },
  ]) {
    assert.equal(normalizeCustomEventState({
      ...document,
      items: [malformed],
    }, contextFor()), null)
  }
  assert.equal(normalizeCustomEventState({
    ...document,
    unexpectedIdentityLedger: [],
  }, contextFor()), null)
  assert.equal(normalizeCustomEventState(document, {
    cityId: CITY_ID,
    timeZone: 'America/Los_Angeles',
  }), null)
})

test('source evidence cannot be forged with toJSON, accessors, or custom prototypes', () => {
  const source = { customEvents: [event({ title: 'Mutated' })] }
  const evidenceRows = [event({ title: 'Evidence' })]
  Object.defineProperty(source.customEvents[0], 'toJSON', {
    enumerable: false,
    value: () => evidenceRows[0],
  })
  assert.throws(
    () => migrateV1CustomEventState(source, {
      city: CITY,
      evidence: capture(evidenceRows).evidence,
    }),
    (error) => error.code === 'CUSTOM_EVENT_INVALID_SOURCE',
  )

  const accessor = event()
  Object.defineProperty(accessor, 'title', {
    enumerable: true,
    get: () => 'Accessor title',
  })
  assert.throws(
    () => migrateV1CustomEventState({ customEvents: [accessor] }, {
      city: CITY,
      evidence: capture([event({ title: 'Accessor title' })]).evidence,
    }),
    (error) => error.code === 'CUSTOM_EVENT_INVALID_SOURCE',
  )
})

test('session projection never exposes a reserved c| identity to durable downstream stores', () => {
  const document = migrate([event({
    title: 'c',
    start: '2026-07-21',
  })]).document
  const pending = customEventItems(document, {
    cityId: CITY_ID,
    durability: 'session-only',
  })[0]
  const activityRef = activityRefOf(pending, { kind: 'event' })

  assert.equal(pending._sessionLegacyIdentity, 'c|2026-07-21')
  assert.doesNotMatch(primaryKeyOf(pending), /^c\|/)
  assert.equal(aliasesOf(pending).some((alias) => alias.startsWith('c|')), false)
  assert.equal(savedBeenRefOf(pending), null)
  assert.ok(activityRef)
  assert.doesNotMatch(activityRef.primary, /^c\|/)
  assert.equal(activityRef.aliases.some((alias) => alias.startsWith('c|')), false)
})

test('invalid-document rejection does not freeze or mutate caller-owned input', () => {
  const nested = { retained: true }
  const input = {
    v: CUSTOM_EVENT_STATE_VERSION,
    cityId: CITY_ID,
    rev: 0,
    items: [nested],
  }
  const before = clone(input)
  const result = reduceCustomEventState(input, { type: 'delete' })
  assert.equal(result.code, 'invalid-document')
  assert.deepEqual(input, before)
  assert.equal(Object.isFrozen(input), false)
  assert.equal(Object.isFrozen(nested), false)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.rejection), true)
})

test('invalid commands and unsafe event fields return explicit immutable rejections', () => {
  const document = emptyCustomEventState(CITY_ID)
  for (const command of [
    null,
    {},
    { type: 'add', event: event({ localId: 'safe-local-id', url: 'javascript:alert(1)' }) },
    { type: 'add', event: event({ localId: 'safe-local-id', url: 'not-an-absolute-url' }) },
    { type: 'add', event: event({ localId: 'safe-local-id', end: 'invalid-end' }) },
    { type: 'add', event: event({ localId: 'safe-local-id', lng: 181 }) },
    {
      type: 'add',
      event: event({
        localId: 'safe-local-id',
        title: 'x'.repeat(CUSTOM_EVENT_STRING_MAX_BYTES),
      }),
    },
  ]) {
    const result = reduceCustomEventState(document, command)
    assert.equal(result.changed, false)
    assert.ok(result.rejection)
    assert.deepEqual(result.document, document)
    assert.equal(Object.isFrozen(result), true)
  }
  assert.equal(canonicalizeCustomEventCommand({}, {}), null)
})
