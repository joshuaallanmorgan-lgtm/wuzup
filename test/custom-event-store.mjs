import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CUSTOM_EVENT_CAP,
  CUSTOM_EVENT_COMMAND_MAX_BYTES,
  emptyCustomEventState,
} from '../app/src/custom-event-state-core.js'
import {
  CUSTOM_EVENT_STORAGE_KEY,
  captureCustomEventV1Source,
  createCustomEventStore,
  customEventAddCommand,
  customEventDeleteCommand,
  customEventImportCommand,
  customEventUpdateCommand,
} from '../app/src/custom-event-store.js'
import { primaryKeyOf } from '../app/src/identity.js'
import { captureRetainedV1Source } from '../app/src/retained-v1-source.js'
import {
  createStorageScope,
  physicalKey,
} from '../app/src/storage.js'

const TAMPA = Object.freeze({ id: 'tampa-bay', tz: 'America/New_York' })
const SF = Object.freeze({ id: 'sf-east-bay', tz: 'America/Los_Angeles' })
const ENCODER = new TextEncoder()
const clone = (value) => structuredClone(value)

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null
  }

  setItem(key, value) {
    this.values.set(String(key), String(value))
  }

  removeItem(key) {
    this.values.delete(String(key))
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

function ids(prefix = 'custom-store') {
  let value = 0
  return () => `${prefix}-${++value}`
}

function storageHarness() {
  const backend = new MemoryStorage()
  return {
    backend,
    factory: ({ cityId }) => createStorageScope({ backend, cityId }),
  }
}

function customEvent(index = 1, overrides = {}) {
  return {
    title: `Custom event ${index}`,
    start: `2026-08-${String(index % 20 + 1).padStart(2, '0')}T19:00:00`,
    localId: `custom-event-${String(index).padStart(4, '0')}`,
    source: 'Added by you',
    sources: ['Added by you'],
    tags: ['added-by-you'],
    ...overrides,
  }
}

function retained(rows, {
  status = 'ok',
  source = 'destination',
} = {}) {
  return {
    source: { customEvents: rows },
    evidence: {
      customEvents: {
        key: 'my-events-v1',
        status,
        value: status === 'ok' ? JSON.stringify(rows) : null,
        source: status === 'ok' ? source : null,
      },
    },
  }
}

function deeplyNested(depth) {
  let value = 'leaf'
  for (let index = 0; index < depth; index += 1) value = { value }
  return value
}

function makeStore({
  city = TAMPA,
  storage = storageHarness(),
  capture,
  lockManager = new SerialLocks(),
  suffix = city.id,
} = {}) {
  return {
    storage,
    store: createCustomEventStore({
      city,
      capture,
      storageFactory: storage.factory,
      lockManager,
      eventTarget: null,
      createId: ids(`operation-${suffix}`),
      contextId: `context-${suffix}`,
      now: () => 1_800_000_000_000,
    }),
  }
}

test('strict capture is domain-bound and retains exact raw evidence', () => {
  const rows = [customEvent(1)]
  const expected = retained(rows)
  const before = clone(expected)
  const calls = []
  const captured = captureCustomEventV1Source({
    city: TAMPA,
    capture({ city, domain }) {
      calls.push({ city, domain })
      return expected
    },
  })

  assert.deepEqual(calls, [{ city: TAMPA, domain: 'custom' }])
  assert.deepEqual(captured, expected)
  assert.deepEqual(expected, before)
  assert.equal(captured.evidence.customEvents.value, JSON.stringify(rows))
})

test('default initialization reserves captured provenance against migrationContext override', async () => {
  const rows = [customEvent(1)]
  const captured = retained(rows)
  const before = clone(captured)
  const { store } = makeStore({
    capture: () => captured,
    suffix: 'provenance',
  })
  const result = await store.initialize({
    migrationContext: {
      evidence: {
        customEvents: {
          key: 'forged',
          status: 'missing',
          value: null,
          source: null,
        },
      },
    },
  })

  assert.equal(result.persisted, true)
  assert.equal(store.getSnapshot().document.items.length, 1)
  assert.equal(
    store.getSnapshot().envelope.migration.sourceSummary.key,
    'my-events-v1',
  )
  assert.equal(
    store.getSnapshot().envelope.migration.sourceSummary.rawBytes,
    ENCODER.encode(JSON.stringify(rows)).byteLength,
  )
  assert.deepEqual(captured, before)
  store.destroy()
})

test('strict retained V1 bytes remain exact and an existing destination skips capture', async () => {
  const storage = storageHarness()
  const scope = createStorageScope({ backend: storage.backend, cityId: TAMPA.id })
  const rows = [customEvent(2)]
  const raw = JSON.stringify(rows)
  assert.equal(scope.set('my-events-v1', raw), true)
  const legacyPhysical = physicalKey('my-events-v1', { cityId: TAMPA.id })
  const before = storage.backend.getItem(legacyPhysical)
  let captures = 0
  const capture = (options) => {
    captures += 1
    return captureRetainedV1Source({ ...options, storageFactory: storage.factory })
  }
  const first = makeStore({ storage, capture, suffix: 'existing-first' }).store
  assert.equal((await first.initialize()).persisted, true)
  assert.equal(storage.backend.getItem(legacyPhysical), before)
  assert.equal(captures, 1)
  first.destroy()

  const second = makeStore({
    storage,
    capture() {
      captures += 1
      throw new Error('existing destination must win')
    },
    suffix: 'existing-second',
  }).store
  const existing = await second.initialize({
    source: { malicious: true },
    evidence: { malicious: true },
  })
  assert.equal(existing.code, 'existing-destination')
  assert.equal(captures, 1)
  second.destroy()
})

test('explicit source and sourceFactory both require their own exact evidence', async () => {
  const valid = retained([])
  const explicit = makeStore({ suffix: 'explicit-source' }).store
  assert.equal((await explicit.initialize(valid)).persisted, true)
  explicit.destroy()

  const factory = makeStore({ suffix: 'explicit-factory' }).store
  assert.equal((await factory.initialize({
    sourceFactory: async () => valid,
    migrationContext: { evidence: { customEvents: { key: 'forged' } } },
  })).persisted, true)
  factory.destroy()

  const missingEvidence = makeStore({ suffix: 'missing-evidence' }).store
  const failed = await missingEvidence.initialize({
    sourceFactory: () => ({ source: valid.source, context: { evidence: valid.evidence } }),
  })
  assert.equal(failed.code, 'migration-source-unavailable')
  assert.equal(missingEvidence.getSnapshot().status, 'error')
  missingEvidence.destroy()
})

test('canonical add, update, delete, and import commands bind conflict evidence', async () => {
  const { store } = makeStore({ suffix: 'commands' })
  assert.equal((await store.initialize(retained([]))).persisted, true)

  const add = store.addCommand(customEvent(1))
  assert.equal(add.expectedAbsent, true)
  assert.ok(ENCODER.encode(JSON.stringify(add)).byteLength < CUSTOM_EVENT_COMMAND_MAX_BYTES)
  assert.equal((await store.dispatch(add)).code, 'added')
  assert.match(primaryKeyOf(store.getItems()[0]), /^c\|/)
  assert.equal((await store.dispatch(add)).code, 'duplicate-local-id')
  assert.equal((await store.dispatch({ type: 'add', event: customEvent(2) })).code, 'invalid-command')

  const staleDelete = store.deleteCommand(customEvent(1).localId)
  const current = store.getItems()[0]
  const update = store.updateCommand(current.localId, {
    ...current,
    title: 'Updated title',
  })
  assert.equal(update.expectedRevision, 1)
  assert.equal((await store.dispatch(update)).code, 'updated')
  assert.equal((await store.dispatch(staleDelete)).code, 'item-revision-conflict')
  const deleted = await store.dispatch(store.deleteCommand(current.localId))
  assert.equal(deleted.code, 'deleted')
  assert.deepEqual(store.getItems(), [])

  await store.dispatch(store.addCommand(customEvent(3)))
  const staleImport = store.importCommand([customEvent(4)])
  assert.equal(staleImport.expectedRevision, store.getSnapshot().document.rev)
  await store.dispatch(store.addCommand(customEvent(5)))
  assert.equal((await store.dispatch(staleImport)).code, 'document-revision-conflict')
  const imported = await store.dispatch(store.importCommand([customEvent(4)]))
  assert.equal(imported.code, 'import-merged')
  store.destroy()
})

test('standalone builders are deterministic, city-bound, capped, and hook-proof', () => {
  const empty = emptyCustomEventState(TAMPA.id, { timeZone: TAMPA.tz })
  const added = customEventAddCommand(empty, customEvent(1), { city: TAMPA })
  assert.ok(added)
  assert.equal(customEventAddCommand(empty, {
    ...customEvent(2),
    timeZone: SF.tz,
  }, { city: TAMPA }), null)
  assert.equal(customEventUpdateCommand(empty, 'missing-local-id', customEvent(1), {
    city: TAMPA,
  }), null)
  assert.equal(customEventDeleteCommand(empty, 'missing-local-id', { city: TAMPA }), null)

  let hookCalls = 0
  const hooked = customEvent(3)
  Object.defineProperty(hooked, 'toJSON', {
    enumerable: false,
    value() {
      hookCalls += 1
      return customEvent(3)
    },
  })
  assert.equal(customEventAddCommand(empty, hooked, { city: TAMPA }), null)
  assert.equal(hookCalls, 0)
  assert.equal(customEventAddCommand(empty, customEvent(4, {
    description: 'x'.repeat(CUSTOM_EVENT_COMMAND_MAX_BYTES),
  }), { city: TAMPA }), null)
  assert.throws(
    () => createCustomEventStore({ city: { id: TAMPA.id, tz: 'Mars/Olympus' } }),
    RangeError,
  )
})

test('replace import reaches the document cap without eviction and refuses overflow', async () => {
  const { store } = makeStore({ suffix: 'cap' })
  await store.initialize(retained([]))
  const rows = Array.from({ length: CUSTOM_EVENT_CAP }, (_, index) => ({
    title: `R${index}`,
    start: `2026-09-${String(index % 20 + 1).padStart(2, '0')}`,
    localId: `replacement-${String(index).padStart(4, '0')}`,
  }))
  const command = store.importCommand(rows, { mode: 'replace' })
  assert.ok(command)
  assert.ok(ENCODER.encode(JSON.stringify(command)).byteLength < CUSTOM_EVENT_COMMAND_MAX_BYTES)
  assert.equal((await store.dispatch(command)).code, 'import-replaced')
  assert.equal(store.getSnapshot().document.items.length, CUSTOM_EVENT_CAP)
  assert.equal(store.addCommand(customEvent(999)), null)
  assert.equal(store.importCommand([...rows, customEvent(999)], { mode: 'replace' }), null)
  assert.equal(store.getSnapshot().document.items[0].item.title, 'R0')
  store.destroy()
})

test('session-only projection never exposes an unlanded c| identity', async () => {
  const storage = storageHarness()
  const { store } = makeStore({
    storage,
    lockManager: null,
    suffix: 'no-lock',
  })
  const source = retained([customEvent(1, {
    title: 'c',
    start: '2026-07-21',
  })])
  const initialized = await store.initialize(source)
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(initialized.persisted, false)
  assert.equal(initialized.concurrency, 'session-only-no-lock')
  assert.doesNotMatch(primaryKeyOf(store.getItems()[0]), /^c\|/)
  assert.equal(
    storage.backend.getItem(physicalKey(CUSTOM_EVENT_STORAGE_KEY, { cityId: TAMPA.id })),
    null,
  )
  store.destroy()
})

test('plain-JSON guards reject toJSON and accessor source forgery before atomic cloning', async () => {
  let hookCalls = 0
  const row = customEvent(1, { title: 'Mutated' })
  Object.defineProperty(row, 'toJSON', {
    enumerable: false,
    value() {
      hookCalls += 1
      return customEvent(1, { title: 'Evidence' })
    },
  })
  const forged = makeStore({ suffix: 'forged-source' }).store
  const result = await forged.initialize({
    source: { customEvents: [row] },
    evidence: retained([customEvent(1, { title: 'Evidence' })]).evidence,
  })
  assert.equal(result.code, 'migration-source-unavailable')
  assert.equal(hookCalls, 0)
  forged.destroy()

  const accessor = customEvent(2)
  Object.defineProperty(accessor, 'title', {
    enumerable: true,
    get() {
      hookCalls += 1
      return 'Accessor'
    },
  })
  const accessorStore = makeStore({ suffix: 'accessor-source' }).store
  const accessorResult = await accessorStore.initialize({
    source: { customEvents: [accessor] },
    evidence: retained([customEvent(2, { title: 'Accessor' })]).evidence,
  })
  assert.equal(accessorResult.code, 'migration-source-unavailable')
  assert.equal(hookCalls, 0)
  accessorStore.destroy()

  const topLevel = makeStore({ suffix: 'top-level-accessor' }).store
  const topLevelOptions = { evidence: retained([]).evidence }
  Object.defineProperty(topLevelOptions, 'source', {
    enumerable: true,
    get() {
      hookCalls += 1
      return { customEvents: [] }
    },
  })
  assert.equal((await topLevel.initialize(topLevelOptions)).code, 'migration-source-unavailable')
  assert.equal(hookCalls, 0)
  topLevel.destroy()

  const dispatchStore = makeStore({ suffix: 'dispatch-accessor' }).store
  await dispatchStore.initialize(retained([]))
  const command = { type: 'add', expectedAbsent: true }
  Object.defineProperty(command, 'event', {
    enumerable: true,
    get() {
      hookCalls += 1
      return customEvent(3)
    },
  })
  assert.equal((await dispatchStore.dispatch(command)).code, 'invalid-command')
  assert.equal(hookCalls, 0)
  dispatchStore.destroy()
})

test('deep hostile input is bounded at every public command and source boundary', async () => {
  const deep = deeplyNested(20_000)
  const empty = emptyCustomEventState(TAMPA.id, { timeZone: TAMPA.tz })
  assert.equal(customEventAddCommand(empty, {
    ...customEvent(1),
    description: deep,
  }, { city: TAMPA }), null)
  assert.equal(customEventAddCommand({ ...empty, extra: deep }, customEvent(1), {
    city: TAMPA,
  }), null)
  assert.equal(customEventImportCommand(empty, [{
    ...customEvent(2),
    description: deep,
  }], { city: TAMPA }), null)

  const direct = makeStore({ suffix: 'deep-dispatch' }).store
  await direct.initialize(retained([]))
  assert.equal((await direct.dispatch({
    type: 'add',
    expectedAbsent: true,
    event: { ...customEvent(3), description: deep },
  })).code, 'invalid-command')
  direct.destroy()

  const explicit = makeStore({ suffix: 'deep-source' }).store
  const result = await explicit.initialize({
    source: { customEvents: [{ ...customEvent(4), description: deep }] },
    evidence: retained([]).evidence,
  })
  assert.equal(result.code, 'migration-source-unavailable')
  explicit.destroy()

  assert.throws(() => captureCustomEventV1Source({
    city: TAMPA,
    capture: () => ({
      source: { customEvents: [{ ...customEvent(5), description: deep }] },
      evidence: retained([]).evidence,
    }),
  }), TypeError)
})

test('captured source and evidence detach before a queued mutation can add hooks', async () => {
  let hookCalls = 0
  const row = customEvent(1)
  const packet = retained([row])
  const originalEvidence = clone(packet.evidence)
  const { store } = makeStore({
    suffix: 'source-race',
    capture() {
      queueMicrotask(() => {
        row.title = 'Mutated after capture'
        packet.evidence.customEvents.key = 'forged-after-capture'
        Object.defineProperty(row, 'toJSON', {
          enumerable: false,
          value() {
            hookCalls += 1
            return customEvent(1)
          },
        })
      })
      return packet
    },
  })

  const result = await store.initialize()
  assert.equal(result.persisted, true)
  assert.equal(hookCalls, 0)
  assert.equal(store.getItems()[0].title, 'Custom event 1')
  assert.equal(
    store.getSnapshot().envelope.migration.sourceSummary.key,
    originalEvidence.customEvents.key,
  )
  assert.equal(packet.evidence.customEvents.key, 'forged-after-capture')
  store.destroy()
})

test('one backend keeps Tampa and SF destinations isolated', async () => {
  const storage = storageHarness()
  const tampa = makeStore({ storage, city: TAMPA, suffix: 'tampa' }).store
  const sf = makeStore({ storage, city: SF, suffix: 'sf' }).store
  await tampa.initialize(retained([]))
  await sf.initialize(retained([]))
  await tampa.dispatch(tampa.addCommand(customEvent(1)))

  assert.equal(tampa.getSnapshot().document.items.length, 1)
  assert.equal(sf.getSnapshot().document.items.length, 0)
  assert.notEqual(
    physicalKey(CUSTOM_EVENT_STORAGE_KEY, { cityId: TAMPA.id }),
    physicalKey(CUSTOM_EVENT_STORAGE_KEY, { cityId: SF.id }),
  )
  assert.equal(sf.getSnapshot().document.timeZone, SF.tz)
  tampa.destroy()
  sf.destroy()
})
