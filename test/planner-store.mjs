import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLANNER_DOCUMENT_MAX_BYTES,
  emptyPlannerDocument,
  normalizePlannerDocument,
  plannerDocumentBytes,
} from '../app/src/planner-core.js'
import {
  PLANNER_METADATA_MAX_BYTES,
  PLANNER_MIGRATION_RECEIPT_MAX_BYTES,
  PLANNER_STORAGE_KEY,
  createPlannerStore,
  validatePlannerEnvelope,
} from '../app/src/planner-store.js'
import { createStorageScope, physicalKey } from '../app/src/storage.js'

const TAMPA = { id: 'tampa-bay', tz: 'America/New_York' }
const SF = { id: 'sf-east-bay', tz: 'America/Los_Angeles' }
const DAY = 1_784_332_800_000
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

function factoryFor(backend) {
  return ({ cityId }) => createStorageScope({ backend, cityId })
}

function idFactory(prefix = 'id') {
  let count = 0
  return () => `${prefix}-${++count}`
}

function event(hex, title = `Event ${hex}`) {
  return {
    id: hex.repeat(16).slice(0, 16),
    title,
    start: '2026-07-18T19:00:00-04:00',
    venue: 'The Hall',
  }
}

function migration(document = emptyPlannerDocument(), extras = {}) {
  return () => ({
    document,
    diagnostics: extras.diagnostics || { input: 0, recovered: 0 },
    sourceSummary: extras.sourceSummary || { dayPlans: 0 },
  })
}

function makeStore({
  backend = new MemoryStorage(),
  city = TAMPA,
  locks = null,
  eventTarget = null,
  migrate = migration(),
  createId = idFactory(city.id),
  contextId = null,
} = {}) {
  return {
    backend,
    store: createPlannerStore({
      city,
      storageFactory: factoryFor(backend),
      lockManager: locks,
      eventTarget,
      migrate,
      createId,
      ...(contextId ? { contextId } : {}),
      now: () => 1_752_700_000_000,
    }),
  }
}

function durableEnvelope(backend, city = TAMPA) {
  const scope = createStorageScope({ backend, cityId: city.id })
  const raw = scope.readDurable(PLANNER_STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

test('planner destination is city scoped and an existing valid destination wins', async () => {
  const backend = new MemoryStorage()
  const first = makeStore({ backend, city: TAMPA, migrate: migration() }).store
  assert.equal((await first.initialize()).persisted, true)

  let called = 0
  const second = makeStore({
    backend,
    city: TAMPA,
    migrate: () => {
      called += 1
      return migration()()
    },
  }).store
  let sourceCalls = 0
  const existing = await second.initialize({
    sourceFactory: () => {
      sourceCalls += 1
      throw new Error('an existing destination must win')
    },
  })
  assert.equal(existing.code, 'existing-destination')
  assert.equal(called, 0)
  assert.equal(sourceCalls, 0)
  assert.equal(second.getSnapshot().envelope.commit.id, first.getSnapshot().envelope.commit.id)

  const sf = makeStore({ backend, city: SF }).store
  await sf.initialize()
  assert.notEqual(sf.physicalKey, first.physicalKey)
  assert.equal(first.physicalKey, physicalKey(PLANNER_STORAGE_KEY, { cityId: TAMPA.id }))
  assert.equal(sf.getSnapshot().cityId, SF.id)
})

test('strict destination read failures never masquerade as an absent planner', async () => {
  let migrationCalls = 0
  const backend = {
    writes: 0,
    getItem() {
      throw new Error('storage denied')
    },
    setItem() {
      this.writes += 1
    },
  }
  const { store } = makeStore({
    backend,
    migrate: () => {
      migrationCalls += 1
      return migration()()
    },
  })

  const initialized = await store.initialize({
    sourceFactory: () => {
      throw new Error('must not capture')
    },
  })

  assert.equal(initialized.ok, false)
  assert.equal(initialized.code, 'planner-storage-unavailable')
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().recovery.overwriteAllowed, false)
  assert.equal(migrationCalls, 0)
  assert.equal(backend.writes, 0)
})

test('a missing destination invokes the lazy source factory exactly once', async () => {
  let sourceCalls = 0
  let receivedSource = null
  let receivedOptions = null
  const { store } = makeStore({
    migrate: (source, options) => {
      receivedSource = source
      receivedOptions = options
      return migration()()
    },
  })

  const initialized = await store.initialize({
    sourceFactory: async () => {
      sourceCalls += 1
      return {
        source: { dayPlans: { legacy: true } },
        sourceTimeZone: 'America/Chicago',
      }
    },
    todayTs: DAY,
    weekendStartTs: DAY,
  })

  assert.equal(initialized.persisted, true)
  assert.equal(sourceCalls, 1)
  assert.deepEqual(receivedSource, { dayPlans: { legacy: true } })
  assert.equal(receivedOptions.sourceTimeZone, 'America/Chicago')
})

test('legacy planner bytes can never masquerade as a durable V2 destination', async () => {
  const seedBackend = new MemoryStorage()
  const seed = makeStore({ backend: seedBackend, contextId: 'seed-context' }).store
  await seed.initialize()
  const legacyRaw = JSON.stringify(seed.getSnapshot().envelope)

  const backend = new MemoryStorage()
  backend.setItem('twh:planner-v2', legacyRaw)
  const destination = physicalKey(PLANNER_STORAGE_KEY, { cityId: TAMPA.id })
  backend.failKeys.add(destination)
  const { store } = makeStore({ backend, contextId: 'legacy-probe' })
  const initialized = await store.initialize()

  assert.notEqual(initialized.code, 'existing-destination')
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(initialized.persisted, false)
  assert.equal(store.getSnapshot().durability, 'session-only')
  assert.equal(backend.getItem(destination), null)
  assert.equal(backend.getItem('twh:planner-v2'), legacyRaw)
})

test('migration receives a clone and leaves its V1 source untouched', async () => {
  const source = {
    timeZone: TAMPA.tz,
    dayPlans: { [DAY]: { morning: event('a') } },
    dayHistory: [],
    weekendPlan: null,
  }
  const before = JSON.stringify(source)
  const { store } = makeStore({
    migrate: (received) => {
      received.dayPlans[DAY].morning.title = 'mutated clone'
      return migration()()
    },
  })
  await store.initialize({ source })
  assert.equal(JSON.stringify(source), before)
})

test('corrupt destination is reported with explicit recovery and never overwritten', async () => {
  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: TAMPA.id })
  scope.set(PLANNER_STORAGE_KEY, '{')
  const writesBefore = backend.writes
  const { store } = makeStore({ backend })
  const initialized = await store.initialize()

  assert.equal(initialized.ok, false)
  assert.equal(initialized.code, 'corrupt-planner-destination')
  assert.equal(store.getSnapshot().status, 'corrupt')
  assert.equal(store.getSnapshot().recovery.overwriteAllowed, false)
  assert.equal(backend.writes, writesBefore)
  assert.equal(scope.get(PLANNER_STORAGE_KEY), '{')
})

test('getSnapshot is stable and subscribers emit only for observable state changes', async () => {
  const { store, backend } = makeStore()
  let emissions = 0
  store.subscribe(() => {
    emissions += 1
  })
  await store.initialize()
  const afterInitialize = emissions
  const first = store.getSnapshot()
  assert.equal(store.getSnapshot(), first)

  const writesBefore = backend.writes
  const noOp = await store.dispatch({ type: 'rest', dayTs: DAY, rest: false })
  assert.equal(noOp.code, 'already-active')
  assert.equal(backend.writes, writesBefore)
  assert.equal(emissions, afterInitialize)
  assert.equal(store.getSnapshot(), first)

  const changed = await store.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'night',
    item: event('a'),
  })
  assert.equal(changed.persisted, true)
  assert.equal(emissions, afterInitialize + 1)
  assert.notEqual(store.getSnapshot(), first)
  assert.equal(Object.isFrozen(store.getSnapshot()), true)
  assert.equal(Object.isFrozen(store.getSnapshot().document), true)
})

test('quota failure is explicit session-only state and retry preserves retained refs byte-for-byte', async () => {
  const backend = new MemoryStorage()
  const { store } = makeStore({ backend })
  await store.initialize()
  const key = physicalKey(PLANNER_STORAGE_KEY, { cityId: TAMPA.id })
  backend.failKeys.add(key)
  const retained = {
    kind: 'event',
    primary: 'https://legacy.example/event|2026-07-18',
    aliases: [
      'https://legacy.example/event|2026-07-18',
      'e|aaaaaaaaaaaaaaaa',
    ],
    snapshot: {
      title: 'Recovered event',
      start: '2026-07-18',
      venue: 'Archive Hall',
    },
    identity: {
      status: 'missing',
      legacyKey: 'https://legacy.example/event|2026-07-18',
    },
    plannedAt: 1_752_700_000_000,
  }

  const added = await store.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'morning',
    item: retained,
  })
  assert.equal(added.persisted, false)
  assert.equal(added.durability, 'session-only')
  assert.equal(store.getSnapshot().durability, 'session-only')
  assert.equal(store.getSnapshot().pendingOps.length, 1)
  const normalizedRetained = { ...retained, aliases: [retained.primary] }
  assert.deepEqual(store.getSnapshot().document.active[DAY].slots.morning, normalizedRetained)
  assert.equal(durableEnvelope(backend).document.active[DAY], undefined)

  backend.failKeys.delete(key)
  const retried = await store.retryPersistence()
  assert.equal(retried.persisted, true)
  assert.equal(retried.durability, 'durable')
  assert.equal(store.getSnapshot().pendingOps.length, 0)
  assert.deepEqual(durableEnvelope(backend).document.active[DAY].slots.morning, normalizedRetained)
})

test('an initialization blocked by quota remains explicit and can persist later', async () => {
  const backend = new MemoryStorage()
  const key = physicalKey(PLANNER_STORAGE_KEY, { cityId: TAMPA.id })
  backend.failKeys.add(key)
  const migrated = normalizePlannerDocument({
    ...emptyPlannerDocument(),
    active: {
      [DAY]: {
        state: 'rest',
        slots: { morning: null, afternoon: null, night: null },
        done: false,
      },
    },
  })
  const { store } = makeStore({ backend, migrate: migration(migrated) })
  let emissions = 0
  store.subscribe(() => {
    emissions += 1
  })
  const initialized = await store.initialize()
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(initialized.persisted, false)
  assert.equal(store.getSnapshot().durability, 'session-only')
  assert.equal(store.getSnapshot().pendingOps[0].kind, 'initialize')
  assert.equal(durableEnvelope(backend), null)
  assert.equal(emissions, 1, 'session-only initialization publishes exactly once')

  backend.failKeys.delete(key)
  const retried = await store.retryPersistence()
  assert.equal(retried.persisted, true)
  assert.equal(durableEnvelope(backend).document.active[DAY].state, 'rest')
})

test('reloadFromDurable and storage events synchronize external commits', async () => {
  const backend = new MemoryStorage()
  const eventTarget = new FakeEventTarget()
  const first = makeStore({ backend, eventTarget, createId: idFactory('first') }).store
  const second = makeStore({ backend, eventTarget, createId: idFactory('second') }).store
  await first.initialize()
  await second.initialize()

  await second.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'afternoon',
    item: event('b'),
  })
  assert.equal(first.getSnapshot().document.active[DAY], undefined)
  const reloaded = await first.reloadFromDurable()
  assert.equal(reloaded.code, 'reloaded')
  assert.equal(first.getSnapshot().document.active[DAY].slots.afternoon.snapshot.title, 'Event b')

  await second.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'night',
    item: event('c'),
  })
  eventTarget.dispatch({ key: first.physicalKey })
  await Promise.all([first.whenIdle(), second.whenIdle()])
  assert.equal(first.getSnapshot().document.active[DAY].slots.night.snapshot.title, 'Event c')
})

test('operation IDs dedupe retries without writes and repeated generators cannot dedupe new work', async () => {
  const backend = new MemoryStorage()
  const repeated = makeStore({ backend, createId: () => 'same' }).store
  await repeated.initialize()

  const first = await repeated.dispatch({
    type: 'add',
    opId: 'caller-op',
    dayTs: DAY,
    part: 'morning',
    item: event('a'),
  })
  const writes = backend.writes
  const duplicate = await repeated.dispatch({
    type: 'add',
    opId: 'caller-op',
    dayTs: DAY,
    part: 'morning',
    item: event('a'),
  })
  assert.equal(first.persisted, true)
  assert.equal(duplicate.code, 'duplicate-op')
  assert.equal(backend.writes, writes)

  const second = await repeated.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'afternoon',
    item: event('b'),
  })
  const third = await repeated.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'night',
    item: event('c'),
  })
  assert.notEqual(second.opId, third.opId)
  assert.equal(third.persisted, true)
  assert.equal(Object.values(repeated.getSnapshot().document.active[DAY].slots).filter(Boolean).length, 3)
})

test('shared Web Locks preserve concurrent commits from separate store instances', async () => {
  const backend = new MemoryStorage()
  const locks = new SerialLocks()
  const first = makeStore({
    backend,
    locks,
    createId: () => 'repeated',
  }).store
  const second = makeStore({
    backend,
    locks,
    createId: () => 'repeated',
  }).store
  await Promise.all([first.initialize(), second.initialize()])

  const [left, right] = await Promise.all([
    first.dispatch({
      type: 'add',
      dayTs: DAY,
      part: 'morning',
      item: event('a'),
    }),
    second.dispatch({
      type: 'add',
      dayTs: DAY,
      part: 'night',
      item: event('b'),
    }),
  ])
  assert.equal(left.persisted, true)
  assert.equal(right.persisted, true)
  assert.notEqual(left.opId, right.opId)
  assert.equal(left.concurrency, 'web-lock')
  assert.equal(right.concurrency, 'web-lock')
  assert.ok(locks.calls.every((call) => call.name === 'wuzup:planner-v2:tampa-bay'))
  assert.ok(locks.calls.every((call) => call.options.mode === 'exclusive'))
  const durable = durableEnvelope(backend)
  assert.equal(durable.document.active[DAY].slots.morning.snapshot.title, 'Event a')
  assert.equal(durable.document.active[DAY].slots.night.snapshot.title, 'Event b')
})

test('cross-tab commits remain unique with repeated entropy and explicit operation IDs', async () => {
  const backend = new MemoryStorage()
  const locks = new SerialLocks()
  const first = makeStore({
    backend,
    locks,
    createId: () => 'same',
    contextId: 'realm-one',
  }).store
  const second = makeStore({
    backend,
    locks,
    createId: () => 'same',
    contextId: 'realm-two',
  }).store
  await Promise.all([first.initialize(), second.initialize()])

  await first.dispatch({
    type: 'add',
    opId: 'caller-one',
    dayTs: DAY,
    part: 'morning',
    item: event('a'),
  })
  const firstCommit = first.getSnapshot().envelope.commit.id
  await second.dispatch({
    type: 'add',
    opId: 'caller-two',
    dayTs: DAY,
    part: 'night',
    item: event('b'),
  })
  const secondCommit = second.getSnapshot().envelope.commit

  assert.notEqual(secondCommit.id, firstCommit)
  assert.equal(secondCommit.parentId, firstCommit)
  assert.notEqual(secondCommit.id, secondCommit.parentId)
  await first.reloadFromDurable()
  assert.equal(first.getSnapshot().document.active[DAY].slots.night.snapshot.title, 'Event b')
})

test('pending retry rebases safely and reports a conflict instead of clobbering', async () => {
  const backend = new MemoryStorage()
  const first = makeStore({ backend, createId: idFactory('offline') }).store
  const second = makeStore({ backend, createId: idFactory('online') }).store
  await first.initialize()
  await second.initialize()
  const key = physicalKey(PLANNER_STORAGE_KEY, { cityId: TAMPA.id })

  backend.failKeys.add(key)
  await first.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'morning',
    item: event('a', 'Session choice'),
  })
  backend.failKeys.delete(key)
  await second.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'morning',
    item: event('b', 'Durable choice'),
  })

  const retry = await first.retryPersistence()
  assert.equal(retry.ok, false)
  assert.equal(retry.code, 'planner-rebase-conflict')
  assert.equal(retry.conflict.reducerCode, 'slot-occupied')
  assert.equal(first.getSnapshot().durability, 'session-only')
  assert.equal(first.getSnapshot().document.active[DAY].slots.morning.snapshot.title, 'Session choice')
  assert.equal(durableEnvelope(backend).document.active[DAY].slots.morning.snapshot.title, 'Durable choice')
})

test('pending retry rebases non-conflicting commands onto the latest durable commit', async () => {
  const backend = new MemoryStorage()
  const first = makeStore({ backend, createId: idFactory('offline-ok') }).store
  const second = makeStore({ backend, createId: idFactory('online-ok') }).store
  await first.initialize()
  await second.initialize()
  const key = physicalKey(PLANNER_STORAGE_KEY, { cityId: TAMPA.id })

  backend.failKeys.add(key)
  await first.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'morning',
    item: event('a', 'Session choice'),
  })
  backend.failKeys.delete(key)
  await second.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'night',
    item: event('b', 'External choice'),
  })

  const retry = await first.retryPersistence()
  assert.equal(retry.persisted, true)
  const durable = durableEnvelope(backend)
  assert.equal(durable.document.active[DAY].slots.morning.snapshot.title, 'Session choice')
  assert.equal(durable.document.active[DAY].slots.night.snapshot.title, 'External choice')
})

test('migration receipts are bounded before they share the planner envelope', async () => {
  const huge = {
    rows: Array.from({ length: 500 }, (_, index) => ({
      index,
      title: 'x'.repeat(500),
      nested: { more: 'y'.repeat(500) },
    })),
  }
  const { store } = makeStore({
    migrate: migration(emptyPlannerDocument(), {
      diagnostics: huge,
      sourceSummary: huge,
    }),
  })
  await store.initialize()
  const receipt = store.getSnapshot().envelope.migration
  assert.ok(ENCODER.encode(JSON.stringify(receipt)).byteLength <= PLANNER_MIGRATION_RECEIPT_MAX_BYTES)
  assert.equal(receipt.diagnostics.truncated, true)
  assert.equal(receipt.diagnostics.byteLimit, PLANNER_METADATA_MAX_BYTES)
  assert.equal(receipt.sourceSummary.truncated, true)
})

test('oversized existing and candidate documents fail closed before any overwrite', async () => {
  const slots = (ref) => ({ morning: ref, afternoon: null, night: null })
  const buildDocument = (count) => {
    const active = {}
    for (let index = 1; index <= count; index += 1) {
      const ref = {
        kind: 'event',
        primary: `legacy-${index}`,
        aliases: [`legacy-${index}`],
        snapshot: {
          title: `Archived ${index}`,
          description: 'x'.repeat(1_500),
        },
      }
      active[index] = { state: null, slots: slots(ref), done: false }
    }
    return { ...emptyPlannerDocument(), active }
  }
  let low = 0
  let high = 3_000
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (plannerDocumentBytes(buildDocument(middle)) < PLANNER_DOCUMENT_MAX_BYTES) low = middle
    else high = middle
  }
  const document = buildDocument(low)
  const index = low + 1
  assert.ok(plannerDocumentBytes(document) < PLANNER_DOCUMENT_MAX_BYTES)
  const base = {
    v: 1,
    cityId: TAMPA.id,
    timeZone: TAMPA.tz,
    document,
    commit: { id: 'commit-base', parentId: null, at: 1, opIds: [] },
    recentOps: [],
    migration: { status: 'test' },
  }
  assert.ok(validatePlannerEnvelope(base, TAMPA))

  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: TAMPA.id })
  scope.set(PLANNER_STORAGE_KEY, JSON.stringify(base))
  const { store } = makeStore({ backend })
  await store.initialize()
  const rawBefore = scope.get(PLANNER_STORAGE_KEY)
  const oversized = await store.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'night',
    item: {
      ...event('f'),
      description: 'z'.repeat(2_040),
      address: 'q'.repeat(1_000),
    },
  })
  assert.equal(oversized.ok, false)
  assert.equal(oversized.conflict.code, 'invalid-candidate-envelope')
  assert.equal(scope.get(PLANNER_STORAGE_KEY), rawBefore)

  const invalid = {
    ...base,
    document: {
      ...document,
      active: {
        ...document.active,
        [index]: {
          state: null,
          slots: slots({
            kind: 'event',
            primary: `legacy-${index}`,
            aliases: [`legacy-${index}`],
            snapshot: {
              title: 'Too large',
              description: 'y'.repeat(2_040),
              address: 'a'.repeat(1_500),
            },
          }),
          done: false,
        },
      },
    },
  }
  assert.ok(plannerDocumentBytes(invalid.document) > PLANNER_DOCUMENT_MAX_BYTES)
  assert.equal(validatePlannerEnvelope(invalid, TAMPA), null)
})

test('destroy unregisters storage synchronization and rejects later work', async () => {
  const eventTarget = new FakeEventTarget()
  const { store } = makeStore({ eventTarget })
  await store.initialize()
  assert.equal(eventTarget.listeners.size, 1)
  store.destroy()
  assert.equal(eventTarget.listeners.size, 0)
  assert.equal((await store.dispatch({ type: 'rest', dayTs: DAY, rest: true })).code, 'destroyed')
})

test('planner replacement rejects a durable commit that changed after backup capture', async () => {
  const backend = new MemoryStorage()
  const locks = new SerialLocks()
  const first = makeStore({ backend, locks, contextId: 'transfer-first' }).store
  const second = makeStore({ backend, locks, contextId: 'transfer-second' }).store
  await first.initialize()
  await second.initialize()
  const expectedCommitId = first.getSnapshot().envelope.commit.id

  const external = await second.dispatch({
    type: 'add',
    dayTs: DAY,
    part: 'night',
    item: event('e', 'Newer external plan'),
  })
  assert.equal(external.persisted, true)
  const replacement = await first.replaceDocument(emptyPlannerDocument(), { expectedCommitId })
  assert.equal(replacement.ok, false)
  assert.equal(replacement.code, 'planner-replacement-conflict')
  assert.equal(durableEnvelope(backend).document.active[DAY].slots.night.snapshot.title, 'Newer external plan')
})
