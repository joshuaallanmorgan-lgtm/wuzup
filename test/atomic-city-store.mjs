import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ATOMIC_CITY_ENVELOPE_VERSION,
  ATOMIC_CITY_METADATA_MAX_BYTES,
  ATOMIC_CITY_MIGRATION_RECEIPT_MAX_BYTES,
  ATOMIC_CITY_RECENT_OPS_CAP,
  createAtomicCityStore,
  validateAtomicCityEnvelope,
} from '../app/src/atomic-city-store.js'
import { createStorageScope, physicalKey } from '../app/src/storage.js'

const TAMPA = { id: 'tampa-bay', tz: 'America/New_York' }
const SF = { id: 'sf-east-bay', tz: 'America/Los_Angeles' }
const STORAGE_KEY = 'synthetic-v2'
const STORE_ID = 'synthetic-list'
const ENCODER = new TextEncoder()

class MemoryStorage {
  constructor() {
    this.map = new Map()
    this.failKeys = new Set()
    this.writes = 0
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null
  }

  setItem(key, value) {
    const selected = String(key)
    this.writes += 1
    if (this.failKeys.has(selected)) throw new Error('quota')
    this.map.set(selected, String(value))
  }

  removeItem(key) {
    this.map.delete(String(key))
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Set()
  }

  addEventListener(type, listener) {
    if (type === 'storage') this.listeners.add(listener)
  }

  removeEventListener(type, listener) {
    if (type === 'storage') this.listeners.delete(listener)
  }

  dispatch(event) {
    for (const listener of [...this.listeners]) listener(event)
  }
}

class SerialLocks {
  constructor() {
    this.tails = new Map()
    this.calls = []
  }

  request(name, options, callback) {
    this.calls.push({ name, options })
    const before = this.tails.get(name) || Promise.resolve()
    let release
    const after = new Promise((resolve) => {
      release = resolve
    })
    this.tails.set(name, before.then(() => after))
    return before.then(callback).finally(release)
  }
}

const SHARED_TEST_LOCKS = new WeakMap()

function locksFor(backend) {
  if (!SHARED_TEST_LOCKS.has(backend)) {
    SHARED_TEST_LOCKS.set(backend, new SerialLocks())
  }
  return SHARED_TEST_LOCKS.get(backend)
}

const emptyDocument = () => ({ v: 1, count: 0, items: [] })

function validateDocument(value) {
  if (!value
      || typeof value !== 'object'
      || Array.isArray(value)
      || value.v !== 1
      || !Number.isSafeInteger(value.count)
      || value.count < 0
      || !Array.isArray(value.items)
      || value.items.length > 1_000) {
    return null
  }
  const items = []
  const ids = new Set()
  for (const item of value.items) {
    if (!item
        || typeof item !== 'object'
        || Array.isArray(item)
        || typeof item.id !== 'string'
        || !/^[a-z0-9-]{1,48}$/i.test(item.id)
        || typeof item.value !== 'string'
        || item.value.length > 20_000
        || ids.has(item.id)) {
      return null
    }
    ids.add(item.id)
    items.push({ id: item.id, value: item.value })
  }
  return { v: 1, count: value.count, items }
}

function documentBytes(value) {
  return ENCODER.encode(JSON.stringify(value)).byteLength
}

function reduceDocument(document, command) {
  if (command?.type === 'increment') {
    const by = Number(command.by)
    if (!Number.isSafeInteger(by) || by === 0 || document.count + by < 0) {
      return { document, changed: false, code: 'invalid-increment' }
    }
    return {
      document: { ...document, count: document.count + by },
      changed: true,
      code: 'incremented',
    }
  }
  if (command?.type === 'add') {
    if (document.items.some((item) => item.id === command.id)) {
      return { document, changed: false, code: 'duplicate-item' }
    }
    return {
      document: {
        ...document,
        items: [...document.items, { id: command.id, value: command.value }],
      },
      changed: true,
      code: 'added',
    }
  }
  if (command?.type === 'remove') {
    const index = document.items.findIndex((item) => item.id === command.id)
    if (index < 0) return { document, changed: false, code: 'missing-item' }
    return {
      document: {
        ...document,
        items: document.items.filter((_, itemIndex) => itemIndex !== index),
      },
      changed: true,
      code: 'removed',
    }
  }
  return { document, changed: false, code: 'invalid-command' }
}

function canonicalizeCommand(command) {
  if (command?.type === 'increment') return { type: 'increment', by: command.by }
  if (command?.type === 'add') {
    return { type: 'add', id: command.id, value: command.value }
  }
  if (command?.type === 'remove') return { type: 'remove', id: command.id }
  return null
}

function migrate(source = {}) {
  return {
    document: {
      v: 1,
      count: Number.isSafeInteger(source.count) && source.count >= 0 ? source.count : 0,
      items: Array.isArray(source.items) ? source.items : [],
    },
    diagnostics: { received: Array.isArray(source.items) ? source.items.length : 0 },
    sourceSummary: { kind: 'synthetic' },
  }
}

function factoryFor(backend) {
  return ({ cityId }) => createStorageScope({ backend, cityId })
}

function idFactory(prefix = 'id') {
  let count = 0
  return () => `${prefix}-${++count}`
}

function makeStore({
  backend = new MemoryStorage(),
  city = TAMPA,
  storageKey = STORAGE_KEY,
  storeId = STORE_ID,
  locks = undefined,
  eventTarget = null,
  migration = migrate,
  createId = idFactory(storeId),
  contextId = `${storeId}-context`,
  maxBytes = 32 * 1024,
  storageFactory = factoryFor(backend),
} = {}) {
  return {
    backend,
    store: createAtomicCityStore({
      city,
      storageKey,
      storeId,
      emptyDocument,
      validateDocument,
      documentBytes,
      maxBytes,
      reduceDocument,
      canonicalizeCommand,
      migrate: migration,
      storageFactory,
      lockManager: locks === undefined ? locksFor(backend) : locks,
      eventTarget,
      createId,
      contextId,
      now: () => 1_752_700_000_000,
    }),
  }
}

function durableEnvelope(backend, {
  city = TAMPA,
  storageKey = STORAGE_KEY,
} = {}) {
  const scope = createStorageScope({ backend, cityId: city.id })
  const raw = scope.readDurable(storageKey)
  return raw === null ? null : JSON.parse(raw)
}

test('missing destination migrates once and valid destination wins before source capture', async () => {
  const backend = new MemoryStorage()
  let migrationCalls = 0
  let sourceCalls = 0
  const first = makeStore({
    backend,
    migration: (source, options) => {
      migrationCalls += 1
      assert.equal(options.city.id, TAMPA.id)
      assert.equal(options.label, 'legacy')
      return migrate(source)
    },
  }).store
  const initialized = await first.initialize({
    sourceFactory: async () => {
      sourceCalls += 1
      return {
        source: { count: 4, items: [{ id: 'a', value: 'A' }] },
        context: { label: 'legacy' },
      }
    },
  })
  assert.equal(initialized.persisted, true)
  assert.equal(sourceCalls, 1)
  assert.equal(migrationCalls, 1)
  assert.equal(first.getSnapshot().document.count, 4)

  const second = makeStore({
    backend,
    migration: () => {
      throw new Error('valid destination must win')
    },
  }).store
  const existing = await second.initialize({
    sourceFactory: () => {
      throw new Error('source must not be captured')
    },
  })
  assert.equal(existing.code, 'existing-destination')
  assert.equal(second.getSnapshot().envelope.commit.id, first.getSnapshot().envelope.commit.id)
})

test('a physical destination tombstone is authoritative and is never overwritten by migration', async () => {
  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: TAMPA.id })
  assert.equal(scope.remove(STORAGE_KEY), true)
  const before = backend.getItem(physicalKey(STORAGE_KEY, { cityId: TAMPA.id }))
  let migrationCalls = 0
  let sourceCalls = 0
  const { store } = makeStore({
    backend,
    migration: () => {
      migrationCalls += 1
      return migrate({ count: 9 })
    },
  })
  const initialized = await store.initialize({
    sourceFactory: () => {
      sourceCalls += 1
      return { source: { count: 9 } }
    },
  })
  assert.equal(initialized.code, 'corrupt-destination')
  assert.equal(store.getSnapshot().status, 'corrupt')
  assert.equal(store.getSnapshot().recovery.overwriteAllowed, false)
  assert.equal(sourceCalls, 0)
  assert.equal(migrationCalls, 0)
  assert.equal(
    backend.getItem(physicalKey(STORAGE_KEY, { cityId: TAMPA.id })),
    before,
  )
})

test('migration receives a clone and cannot mutate captured source bytes', async () => {
  const source = {
    count: 2,
    items: [{ id: 'legacy', value: 'Original' }],
  }
  const before = JSON.stringify(source)
  const { store } = makeStore({
    migration: (received) => {
      received.items[0].value = 'Mutated clone'
      return migrate(received)
    },
  })
  await store.initialize({ source })
  assert.equal(JSON.stringify(source), before)
  assert.equal(store.getSnapshot().document.items[0].value, 'Mutated clone')
})

test('migration context cannot override the selected city binding', async () => {
  let receivedCity = null
  const { store } = makeStore({
    migration: (source, context) => {
      receivedCity = context.city
      return migrate(source)
    },
  })
  await store.initialize({
    source: { count: 2 },
    migrationContext: {
      city: SF,
      label: 'untrusted-context',
    },
  })
  assert.deepEqual(receivedCity, TAMPA)
  assert.equal(store.getSnapshot().cityId, TAMPA.id)
})

test('strict read failures and invalid destinations require explicit non-overwrite recovery', async (t) => {
  await t.test('storage failure is not absence', async () => {
    let writes = 0
    let migrations = 0
    const backend = {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        writes += 1
      },
    }
    const { store } = makeStore({
      backend,
      migration: () => {
        migrations += 1
        return migrate()
      },
    })
    const result = await store.initialize({
      sourceFactory: () => {
        throw new Error('must not capture')
      },
    })
    assert.equal(result.code, 'storage-unavailable')
    assert.equal(store.getSnapshot().status, 'error')
    assert.equal(store.getSnapshot().recovery.overwriteAllowed, false)
    assert.equal(migrations, 0)
    assert.equal(writes, 0)
  })

  for (const [label, mutate] of [
    ['corrupt JSON', () => '{'],
    ['wrong version', (envelope) => JSON.stringify({ ...envelope, v: 99 })],
    ['wrong city', (envelope) => JSON.stringify({ ...envelope, cityId: SF.id })],
    ['wrong store', (envelope) => JSON.stringify({ ...envelope, storeId: 'other-store' })],
  ]) {
    await t.test(label, async () => {
      const seedBackend = new MemoryStorage()
      const seed = makeStore({ backend: seedBackend }).store
      await seed.initialize()
      const original = seed.getSnapshot().envelope

      const backend = new MemoryStorage()
      const scope = createStorageScope({ backend, cityId: TAMPA.id })
      const raw = mutate(original)
      scope.set(STORAGE_KEY, raw)
      const writesBefore = backend.writes
      const { store } = makeStore({ backend })
      const result = await store.initialize()
      assert.equal(result.code, 'corrupt-destination')
      assert.equal(store.getSnapshot().status, 'corrupt')
      assert.equal(store.getSnapshot().recovery.overwriteAllowed, false)
      assert.equal(scope.get(STORAGE_KEY), raw)
      assert.equal(backend.writes, writesBefore)
    })
  }
})

test('city and store bindings isolate durable documents', async () => {
  const backend = new MemoryStorage()
  const tampa = makeStore({ backend, city: TAMPA }).store
  const sf = makeStore({ backend, city: SF }).store
  await tampa.initialize({ source: { count: 1 } })
  await sf.initialize({ source: { count: 8 } })
  assert.notEqual(tampa.physicalKey, sf.physicalKey)
  assert.equal(tampa.physicalKey, physicalKey(STORAGE_KEY, { cityId: TAMPA.id }))
  assert.equal(tampa.getSnapshot().document.count, 1)
  assert.equal(sf.getSnapshot().document.count, 8)

  const other = makeStore({
    backend,
    city: TAMPA,
    storageKey: 'other-synthetic-v2',
    storeId: 'other-synthetic-list',
  }).store
  await other.initialize({ source: { count: 12 } })
  assert.equal(other.getSnapshot().document.count, 12)
  assert.equal(tampa.getSnapshot().document.count, 1)
})

test('snapshots are stable and no-op commands neither write nor emit', async () => {
  const { store, backend } = makeStore()
  let emissions = 0
  store.subscribe(() => {
    emissions += 1
  })
  await store.initialize()
  const first = store.getSnapshot()
  const writes = backend.writes
  const noOp = await store.dispatch({ type: 'increment', by: 0 })
  assert.equal(noOp.code, 'invalid-increment')
  assert.equal(backend.writes, writes)
  assert.equal(store.getSnapshot(), first)
  assert.equal(emissions, 1)

  await store.dispatch({ type: 'increment', by: 1 })
  assert.equal(emissions, 2)
  assert.notEqual(store.getSnapshot(), first)
  assert.equal(Object.isFrozen(store.getSnapshot()), true)
  assert.equal(Object.isFrozen(store.getSnapshot().document), true)
})

test('quota failure becomes retryable session-only state with exact durable verification', async () => {
  const backend = new MemoryStorage()
  const { store } = makeStore({ backend })
  await store.initialize()
  const key = physicalKey(STORAGE_KEY, { cityId: TAMPA.id })
  backend.failKeys.add(key)

  const added = await store.dispatch({ type: 'add', id: 'offline', value: 'Session value' })
  assert.equal(added.persisted, false)
  assert.equal(added.durability, 'session-only')
  assert.equal(store.getSnapshot().pendingOps.length, 1)
  assert.equal(store.getSnapshot().document.items[0].value, 'Session value')
  assert.equal(durableEnvelope(backend).document.items.length, 0)

  backend.failKeys.delete(key)
  const retried = await store.retryPersistence()
  assert.equal(retried.persisted, true)
  assert.equal(store.getSnapshot().durability, 'durable')
  assert.equal(store.getSnapshot().pendingOps.length, 0)
  assert.equal(durableEnvelope(backend).document.items[0].value, 'Session value')
})

test('reported writes are session-only until the exact bytes are durably readable', async () => {
  let writes = 0
  const { store } = makeStore({
    storageFactory: () => ({
      set() {
        writes += 1
        return true
      },
      peekDurable() {
        return { status: 'missing', value: null }
      },
    }),
  })
  const initialized = await store.initialize()
  assert.equal(writes, 1)
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(initialized.persisted, false)
  assert.equal(store.getSnapshot().durability, 'session-only')
  assert.equal(store.getSnapshot().error.code, 'write-not-durable')
})

test('initialization blocked by quota remains retryable without recapturing source', async () => {
  const backend = new MemoryStorage()
  const key = physicalKey(STORAGE_KEY, { cityId: TAMPA.id })
  backend.failKeys.add(key)
  let sourceCalls = 0
  const { store } = makeStore({ backend })
  const initialized = await store.initialize({
    sourceFactory: () => {
      sourceCalls += 1
      return { source: { count: 3 } }
    },
  })
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(store.getSnapshot().pendingOps[0].kind, 'initialize')
  assert.equal(durableEnvelope(backend), null)

  backend.failKeys.delete(key)
  assert.equal((await store.retryPersistence()).persisted, true)
  assert.equal(sourceCalls, 1)
  assert.equal(durableEnvelope(backend).document.count, 3)
})

test('same-tab queue and shared Web Locks preserve concurrent commands', async () => {
  const backend = new MemoryStorage()
  const locks = new SerialLocks()
  const first = makeStore({
    backend,
    locks,
    contextId: 'realm-one',
    createId: () => 'same',
  }).store
  const second = makeStore({
    backend,
    locks,
    contextId: 'realm-two',
    createId: () => 'same',
  }).store
  await Promise.all([first.initialize(), second.initialize()])

  const [one, two, three] = await Promise.all([
    first.dispatch({ type: 'increment', by: 1 }),
    first.dispatch({ type: 'add', id: 'same-tab', value: 'Queued' }),
    second.dispatch({ type: 'add', id: 'other-tab', value: 'Locked' }),
  ])
  assert.equal(one.persisted, true)
  assert.equal(two.persisted, true)
  assert.equal(three.persisted, true)
  assert.ok(locks.calls.every((call) => call.name === 'wuzup:synthetic-list:tampa-bay'))
  assert.ok(locks.calls.every((call) => call.options.mode === 'exclusive'))
  const durable = durableEnvelope(backend)
  assert.equal(durable.document.count, 1)
  assert.deepEqual(durable.document.items.map((item) => item.id).sort(), ['other-tab', 'same-tab'])
})

test('without Web Locks durable writes fail closed into explicit session-only state', async () => {
  const backend = new MemoryStorage()
  const seed = makeStore({ backend, contextId: 'seed' }).store
  await seed.initialize()
  const durableBefore = createStorageScope({
    backend,
    cityId: TAMPA.id,
  }).readDurable(STORAGE_KEY)
  const writesBefore = backend.writes

  const first = makeStore({
    backend,
    locks: null,
    contextId: 'no-lock-one',
  }).store
  const second = makeStore({
    backend,
    locks: null,
    contextId: 'no-lock-two',
  }).store
  await Promise.all([first.initialize(), second.initialize()])

  const [left, right] = await Promise.all([
    first.dispatch({ type: 'add', id: 'left', value: 'Left' }),
    second.dispatch({ type: 'add', id: 'right', value: 'Right' }),
  ])
  assert.equal(left.persisted, false)
  assert.equal(right.persisted, false)
  assert.equal(left.concurrency, 'session-only-no-lock')
  assert.equal(right.concurrency, 'session-only-no-lock')
  assert.equal(left.error.code, 'coordination-unavailable')
  assert.equal(right.error.code, 'coordination-unavailable')
  assert.deepEqual(first.getSnapshot().document.items.map((item) => item.id), ['left'])
  assert.deepEqual(second.getSnapshot().document.items.map((item) => item.id), ['right'])
  assert.equal(
    createStorageScope({
      backend,
      cityId: TAMPA.id,
    }).readDurable(STORAGE_KEY),
    durableBefore,
  )
  assert.equal(backend.writes, writesBefore)
})

test('no-lock fallback cannot clobber a valid commit injected after its durable read', async () => {
  const backend = new MemoryStorage()
  const seed = makeStore({
    backend,
    contextId: 'race-seed',
  }).store
  await seed.initialize()

  const externalBackend = new MemoryStorage()
  const external = makeStore({
    backend: externalBackend,
    contextId: 'race-external',
  }).store
  await external.initialize()
  await external.dispatch({ type: 'add', id: 'external', value: 'External winner' })
  const externalRaw = createStorageScope({
    backend: externalBackend,
    cityId: TAMPA.id,
  }).readDurable(STORAGE_KEY)

  const scope = createStorageScope({ backend, cityId: TAMPA.id })
  let reads = 0
  let localWrites = 0
  const storageFactory = () => ({
    peekDurable(key) {
      const read = scope.peekDurable(key)
      reads += 1
      if (reads === 2) assert.equal(scope.set(key, externalRaw), true)
      return read
    },
    set(key, value) {
      localWrites += 1
      return scope.set(key, value)
    },
  })
  const local = makeStore({
    backend,
    locks: null,
    contextId: 'race-local',
    storageFactory,
  }).store
  await local.initialize()
  const localResult = await local.dispatch({
    type: 'add',
    id: 'local',
    value: 'Local session state',
  })

  assert.equal(localResult.persisted, false)
  assert.equal(localResult.concurrency, 'session-only-no-lock')
  assert.equal(localResult.error.code, 'coordination-unavailable')
  assert.equal(localWrites, 0)
  assert.equal(
    durableEnvelope(backend).document.items[0].value,
    'External winner',
  )
  assert.equal(local.getSnapshot().document.items[0].value, 'Local session state')
})

test('missing destination also remains session-only when Web Locks are unavailable', async () => {
  const backend = new MemoryStorage()
  const { store } = makeStore({
    backend,
    locks: null,
    contextId: 'no-lock-initialize',
  })
  const initialized = await store.initialize({ source: { count: 3 } })
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(initialized.persisted, false)
  assert.equal(initialized.concurrency, 'session-only-no-lock')
  assert.equal(store.getSnapshot().document.count, 3)
  assert.equal(store.getSnapshot().pendingOps[0].kind, 'initialize')
  assert.equal(durableEnvelope(backend), null)
})

test('pending commands rebase on latest durable state and conflict instead of clobbering', async () => {
  const backend = new MemoryStorage()
  const offline = makeStore({ backend, contextId: 'offline' }).store
  const online = makeStore({ backend, contextId: 'online' }).store
  await offline.initialize()
  await online.initialize()
  const key = physicalKey(STORAGE_KEY, { cityId: TAMPA.id })

  backend.failKeys.add(key)
  await offline.dispatch({ type: 'add', id: 'session', value: 'Offline' })
  backend.failKeys.delete(key)
  await online.dispatch({ type: 'add', id: 'durable', value: 'Online' })
  assert.equal((await offline.retryPersistence()).persisted, true)
  assert.deepEqual(
    durableEnvelope(backend).document.items.map((item) => item.id).sort(),
    ['durable', 'session'],
  )

  backend.failKeys.add(key)
  await offline.dispatch({ type: 'add', id: 'collision', value: 'Session choice' })
  backend.failKeys.delete(key)
  await online.reloadFromDurable()
  await online.dispatch({ type: 'add', id: 'collision', value: 'Durable choice' })
  const conflict = await offline.retryPersistence()
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'rebase-conflict')
  assert.equal(conflict.conflict.reducerCode, 'duplicate-item')
  assert.equal(
    durableEnvelope(backend).document.items.find((item) => item.id === 'collision').value,
    'Durable choice',
  )
  assert.equal(
    offline.getSnapshot().document.items.find((item) => item.id === 'collision').value,
    'Session choice',
  )
})

test('operation IDs dedupe retries and generated IDs remain unique and bounded', async () => {
  const backend = new MemoryStorage()
  const hugeId = `x${'y'.repeat(500)}`
  const { store } = makeStore({
    backend,
    createId: () => hugeId,
    contextId: 'bounded-id-context',
  })
  await store.initialize()
  const first = await store.dispatch({
    type: 'increment',
    by: 1,
    opId: 'caller-operation',
  })
  const writes = backend.writes
  const duplicate = await store.dispatch({
    type: 'increment',
    by: 1,
    opId: 'caller-operation',
  })
  assert.equal(first.persisted, true)
  assert.equal(duplicate.code, 'duplicate-op')
  assert.equal(backend.writes, writes)

  const second = await store.dispatch({ type: 'increment', by: 1 })
  const third = await store.dispatch({ type: 'increment', by: 1 })
  assert.notEqual(second.opId, third.opId)
  assert.ok(second.opId.length <= 160)
  assert.ok(store.getSnapshot().envelope.commit.id.length <= 160)
})

test('storage reload and storage events synchronize external durable commits', async () => {
  const backend = new MemoryStorage()
  const events = new FakeEventTarget()
  const first = makeStore({ backend, eventTarget: events, contextId: 'first' }).store
  const second = makeStore({ backend, eventTarget: events, contextId: 'second' }).store
  await first.initialize()
  await second.initialize()

  await second.dispatch({ type: 'add', id: 'one', value: 'One' })
  assert.equal(first.getSnapshot().document.items.length, 0)
  assert.equal((await first.reloadFromDurable()).code, 'reloaded')
  assert.equal(first.getSnapshot().document.items[0].id, 'one')

  await second.dispatch({ type: 'add', id: 'two', value: 'Two' })
  events.dispatch({ key: first.physicalKey })
  await Promise.all([first.whenIdle(), second.whenIdle()])
  assert.deepEqual(first.getSnapshot().document.items.map((item) => item.id), ['one', 'two'])
})

test('document, receipt, recent-operation, and ID caps fail closed', async () => {
  const hugeMetadata = {
    rows: Array.from({ length: 500 }, (_, index) => ({
      index,
      value: 'x'.repeat(500),
      nested: { value: 'y'.repeat(500) },
    })),
  }
  const backend = new MemoryStorage()
  const { store } = makeStore({
    backend,
    maxBytes: 8 * 1024,
    migration: (source) => ({
      ...migrate(source),
      diagnostics: hugeMetadata,
      sourceSummary: hugeMetadata,
    }),
  })
  await store.initialize()
  const receipt = store.getSnapshot().envelope.migration
  assert.ok(documentBytes(receipt) <= ATOMIC_CITY_MIGRATION_RECEIPT_MAX_BYTES)
  assert.equal(receipt.diagnostics.truncated, true)
  assert.equal(receipt.diagnostics.byteLimit, ATOMIC_CITY_METADATA_MAX_BYTES)

  for (let index = 0; index < ATOMIC_CITY_RECENT_OPS_CAP + 8; index += 1) {
    await store.dispatch({
      type: 'increment',
      by: 1,
      opId: `bounded-op-${index}`,
    })
  }
  assert.equal(store.getSnapshot().envelope.recentOps.length, ATOMIC_CITY_RECENT_OPS_CAP)
  assert.equal(store.getSnapshot().envelope.recentOps[0], 'bounded-op-8')

  const rawBefore = createStorageScope({
    backend,
    cityId: TAMPA.id,
  }).readDurable(STORAGE_KEY)
  const oversized = await store.dispatch({
    type: 'add',
    id: 'oversized',
    value: 'z'.repeat(20_000),
  })
  assert.equal(oversized.ok, false)
  assert.equal(oversized.code, 'invalid-document')
  assert.equal(createStorageScope({
    backend,
    cityId: TAMPA.id,
  }).readDurable(STORAGE_KEY), rawBefore)

  const invalidEnvelope = {
    ...store.getSnapshot().envelope,
    recentOps: Array.from(
      { length: ATOMIC_CITY_RECENT_OPS_CAP + 1 },
      (_, index) => `too-many-${index}`,
    ),
  }
  assert.equal(validateAtomicCityEnvelope(invalidEnvelope, {
    city: TAMPA,
    storeId: STORE_ID,
    validateDocument,
    documentBytes,
    maxBytes: 8 * 1024,
  }), null)
  assert.equal(store.getSnapshot().envelope.v, ATOMIC_CITY_ENVELOPE_VERSION)
})

test('envelope validation rejects broken commit lineage and dedupe invariants', async () => {
  const { store } = makeStore()
  await store.initialize()
  await store.dispatch({
    type: 'increment',
    by: 1,
    opId: 'lineage-operation',
  })
  const envelope = store.getSnapshot().envelope

  assert.equal(validateAtomicCityEnvelope({
    ...envelope,
    commit: {
      ...envelope.commit,
      parentId: envelope.commit.id,
    },
  }, {
    city: TAMPA,
    storeId: STORE_ID,
    validateDocument,
    documentBytes,
    maxBytes: 32 * 1024,
  }), null)

  assert.equal(validateAtomicCityEnvelope({
    ...envelope,
    recentOps: envelope.recentOps.filter(
      (opId) => !envelope.commit.opIds.includes(opId),
    ),
  }, {
    city: TAMPA,
    storeId: STORE_ID,
    validateDocument,
    documentBytes,
    maxBytes: 32 * 1024,
  }), null)

  const reversed = [...envelope.recentOps]
  const suffixStart = reversed.length - envelope.commit.opIds.length
  reversed.splice(
    suffixStart,
    envelope.commit.opIds.length,
    ...[...envelope.commit.opIds].reverse(),
  )
  if (envelope.commit.opIds.length > 1) {
    assert.equal(validateAtomicCityEnvelope({
      ...envelope,
      recentOps: reversed,
    }, {
      city: TAMPA,
      storeId: STORE_ID,
      validateDocument,
      documentBytes,
      maxBytes: 32 * 1024,
    }), null)
  }
})

test('oversized migration is rejected before writing any destination', async () => {
  const backend = new MemoryStorage()
  const { store } = makeStore({
    backend,
    maxBytes: 128,
    migration: () => ({
      document: {
        v: 1,
        count: 0,
        items: [{ id: 'large', value: 'x'.repeat(1_000) }],
      },
    }),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.code, 'migration-invalid')
  assert.equal(durableEnvelope(backend), null)
})

test('destroy unregisters synchronization, clears subscribers, and rejects queued work', async () => {
  const events = new FakeEventTarget()
  const { store } = makeStore({ eventTarget: events })
  let emissions = 0
  store.subscribe(() => {
    emissions += 1
  })
  await store.initialize()
  assert.equal(events.listeners.size, 1)
  store.destroy()
  assert.equal(events.listeners.size, 0)
  assert.equal((await store.dispatch({ type: 'increment', by: 1 })).code, 'destroyed')
  events.dispatch({ key: store.physicalKey })
  await store.whenIdle()
  assert.equal(emissions, 1)
})
