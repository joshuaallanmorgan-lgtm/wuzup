import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPlannerActions,
  createPlannerRuntime,
  filledPlannerDayCount,
  isTerminalArtifactStatus,
  plannerDayModel,
  plannerPublicStatus,
  resolvePlannerReference,
} from '../app/src/planner-runtime.js'
import { createPlannerCatalog } from '../app/src/planner-selectors.js'
import { emptyPlannerDocument, normalizePlannerDocument, slotRefOf } from '../app/src/planner-core.js'
import { createPlannerStore } from '../app/src/planner-store.js'
import { createStorageScope } from '../app/src/storage.js'

const CITY = { id: 'tampa-bay', tz: 'America/New_York' }
const DAY = 1_784_332_800_000
const NEXT_DAY = DAY + 86_400_000

function event(id, title = id) {
  return {
    id,
    title,
    start: '2026-07-18T19:00:00-04:00',
    venue: 'The Hall',
  }
}

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null
  }

  setItem(key, value) {
    this.map.set(String(key), String(value))
  }
}

function fakeStore({ destinationExists = false } = {}) {
  const calls = []
  let snapshot = {
    status: 'idle',
    durability: 'unknown',
    concurrency: 'none',
    document: emptyPlannerDocument(),
    error: null,
    recovery: null,
  }
  return {
    calls,
    initialize: async (options) => {
      calls.push(['initialize', options])
      if (!destinationExists && typeof options.sourceFactory === 'function') {
        await options.sourceFactory()
      }
      snapshot = { ...snapshot, status: 'ready', durability: 'durable' }
      return {
        ok: true,
        code: destinationExists ? 'existing-destination' : 'initialized',
        snapshot,
      }
    },
    dispatch: async (command) => {
      calls.push(['dispatch', command])
      return {
        ok: true,
        code: command.type === 'rollover' ? 'nothing-to-rollover' : command.type,
        command,
        snapshot,
      }
    },
    retryPersistence: async () => {
      calls.push(['retry'])
      return { ok: true, code: 'retried', snapshot }
    },
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    destroy: () => calls.push(['destroy']),
  }
}

test('artifact terminal and public status contracts are explicit', () => {
  assert.equal(isTerminalArtifactStatus('idle'), false)
  assert.equal(isTerminalArtifactStatus('loading'), false)
  assert.equal(isTerminalArtifactStatus('ready'), true)
  assert.equal(isTerminalArtifactStatus('empty'), true)
  assert.equal(isTerminalArtifactStatus('stale'), true)
  assert.equal(isTerminalArtifactStatus('offline'), true)
  assert.equal(isTerminalArtifactStatus('error'), true)
  assert.equal(isTerminalArtifactStatus('unknown'), false)
  assert.equal(isTerminalArtifactStatus(undefined), false)
  assert.equal(plannerPublicStatus({
    artifactStatus: 'loading',
    lifecycle: { phase: 'idle' },
    storeSnapshot: { status: 'idle', durability: 'unknown' },
  }), 'idle')
  assert.equal(plannerPublicStatus({
    artifactStatus: 'ready',
    lifecycle: { phase: 'initializing' },
    storeSnapshot: { status: 'idle', durability: 'unknown' },
  }), 'initializing')
  assert.equal(plannerPublicStatus({
    artifactStatus: 'ready',
    lifecycle: { phase: 'ready' },
    storeSnapshot: { status: 'ready', durability: 'session-only' },
  }), 'session-only')
  assert.equal(plannerPublicStatus({
    artifactStatus: 'ready',
    lifecycle: { phase: 'ready' },
    storeSnapshot: { status: 'ready', durability: 'durable' },
  }), 'durable')
  assert.equal(plannerPublicStatus({
    artifactStatus: 'ready',
    lifecycle: { phase: 'ready' },
    storeSnapshot: { status: 'corrupt', durability: 'unknown' },
  }), 'corrupt')
})

test('runtime constructs one city store, delays initialization, and passes exact migration inputs', async () => {
  let stores = 0
  let captures = 0
  const store = fakeStore()
  const runtime = createPlannerRuntime({
    city: CITY,
    storeFactory: ({ city }) => {
      stores += 1
      assert.deepEqual(city, CITY)
      return store
    },
    sourceCapture: ({ city }) => {
      captures += 1
      assert.deepEqual(city, CITY)
      return {
        source: { dayPlans: { legacy: true } },
        sourceTimeZone: 'America/Chicago',
        raw: { untouched: true },
      }
    },
  })

  runtime.createCatalog({ events: [event('aaaaaaaaaaaaaaaa')] })
  runtime.createCatalog({ events: [event('bbbbbbbbbbbbbbbb')] })
  assert.equal(stores, 1, 'catalog refreshes never construct another store')

  const pending = await runtime.initialize({
    artifactStatus: 'loading',
    anchors: { todayTs: DAY, wkStartTs: NEXT_DAY },
    events: [event('aaaaaaaaaaaaaaaa')],
    seeds: [{ kind: 'event', primary: 'e|seed', aliases: ['e|seed'] }],
  })
  assert.equal(pending.code, 'artifact-pending')
  assert.equal(captures, 0)
  assert.equal(store.calls.length, 0)

  const events = [event('aaaaaaaaaaaaaaaa')]
  const seeds = [{ kind: 'event', primary: 'e|seed', aliases: ['e|seed'] }]
  await runtime.initialize({
    artifactStatus: 'offline',
    anchors: { todayTs: DAY, wkStartTs: NEXT_DAY },
    events,
    seeds,
  })
  assert.equal(captures, 1)
  const [, initializeOptions] = store.calls[0]
  assert.equal(typeof initializeOptions.sourceFactory, 'function')
  assert.deepEqual(
    { ...initializeOptions, sourceFactory: undefined },
    {
      city: CITY,
      sourceFactory: undefined,
      todayTs: DAY,
      weekendStartTs: NEXT_DAY,
      catalog: events,
      seeds,
    },
  )

  await runtime.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: NEXT_DAY, wkStartTs: NEXT_DAY },
    events: [],
    seeds: [],
  })
  assert.equal(captures, 1, 'initialization is destination-first and one-shot')
  assert.equal(stores, 1)
})

test('a valid destination wins without invoking a throwing source capture', async () => {
  let captures = 0
  const store = fakeStore({ destinationExists: true })
  const runtime = createPlannerRuntime({
    city: CITY,
    storeFactory: () => store,
    sourceCapture: () => {
      captures += 1
      throw new Error('must stay lazy')
    },
  })

  const initialized = await runtime.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: DAY, wkStartTs: NEXT_DAY },
  })
  assert.equal(initialized.code, 'existing-destination')
  assert.equal(captures, 0)
  assert.equal(typeof store.calls[0][1].sourceFactory, 'function')
})

test('runtime lifecycle is reactive and a cold start rolls the current city day once', async () => {
  const store = fakeStore()
  const runtime = createPlannerRuntime({
    city: CITY,
    storeFactory: () => store,
    sourceCapture: () => ({ source: {}, sourceTimeZone: CITY.tz }),
  })
  const phases = []
  runtime.subscribeLifecycle(() => phases.push(runtime.getLifecycleSnapshot().phase))

  assert.equal((await runtime.rollover(DAY)).code, 'not-initialized')
  await runtime.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: DAY, wkStartTs: NEXT_DAY },
  })
  assert.deepEqual(phases, ['initializing', 'ready'])
  assert.equal((await runtime.rollover(DAY)).code, 'nothing-to-rollover')
  assert.deepEqual(store.calls.at(-1), ['dispatch', { type: 'rollover', todayTs: DAY }])
  assert.equal((await runtime.rollover(DAY)).code, 'already-current')
  const rolled = await runtime.rollover(NEXT_DAY)
  assert.equal(rolled.code, 'nothing-to-rollover')
  assert.deepEqual(store.calls.at(-1), ['dispatch', { type: 'rollover', todayTs: NEXT_DAY }])
})

test('a real cold restart archives a durable past filled day exactly once', async () => {
  const backend = new MemoryStorage()
  const planned = event('aaaaaaaaaaaaaaaa', 'Durable past plan')
  const pastDocument = normalizePlannerDocument({
    ...emptyPlannerDocument(),
    active: {
      [DAY]: {
        state: null,
        slots: {
          morning: null,
          afternoon: null,
          night: slotRefOf(planned),
        },
        done: false,
      },
    },
  })
  let storeCount = 0
  const storeFactory = ({ city }) => {
    storeCount += 1
    let idCount = 0
    return createPlannerStore({
      city,
      storageFactory: ({ cityId }) => createStorageScope({ backend, cityId }),
      lockManager: null,
      eventTarget: null,
      contextId: `runtime-cold-${storeCount}`,
      createId: () => `runtime-cold-${storeCount}-${++idCount}`,
      now: () => NEXT_DAY,
    })
  }

  const seed = createPlannerStore({
    city: CITY,
    storageFactory: ({ cityId }) => createStorageScope({ backend, cityId }),
    lockManager: null,
    eventTarget: null,
    contextId: 'runtime-cold-seed',
    createId: (() => {
      let count = 0
      return () => `runtime-cold-seed-${++count}`
    })(),
    now: () => DAY,
    migrate: () => ({
      document: pastDocument,
      diagnostics: {},
      sourceSummary: {},
    }),
  })
  assert.equal((await seed.initialize()).persisted, true)
  seed.destroy()

  let captures = 0
  const coldRuntime = createPlannerRuntime({
    city: CITY,
    storeFactory,
    sourceCapture: () => {
      captures += 1
      throw new Error('durable destination must win')
    },
  })
  assert.equal((await coldRuntime.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: NEXT_DAY, wkStartTs: NEXT_DAY },
    events: [planned],
  })).code, 'existing-destination')
  assert.equal(captures, 0)

  const rolled = await coldRuntime.rollover(NEXT_DAY)
  assert.equal(rolled.code, 'rolled-over')
  assert.equal(rolled.persisted, true)
  assert.equal(coldRuntime.store.getSnapshot().document.active[String(DAY)], undefined)
  assert.equal(coldRuntime.store.getSnapshot().document.history.length, 1)
  assert.equal(coldRuntime.store.getSnapshot().document.history[0].dayTs, DAY)
  assert.equal(
    coldRuntime.store.getSnapshot().document.history[0].slots.night.primary,
    slotRefOf(planned).primary,
  )
  assert.equal((await coldRuntime.rollover(NEXT_DAY)).code, 'already-current')
  assert.equal(coldRuntime.store.getSnapshot().document.history.length, 1)
  coldRuntime.destroy()

  const secondRestart = createPlannerRuntime({
    city: CITY,
    storeFactory,
    sourceCapture: () => {
      captures += 1
      throw new Error('durable destination must win')
    },
  })
  await secondRestart.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: NEXT_DAY, wkStartTs: NEXT_DAY },
    events: [planned],
  })
  assert.equal((await secondRestart.rollover(NEXT_DAY)).code, 'nothing-to-rollover')
  assert.equal(secondRestart.store.getSnapshot().document.history.length, 1)
  assert.equal(captures, 0)
  secondRestart.destroy()
})

test('session-only initialization remains usable and is not mislabeled as an initialization error', async () => {
  const store = fakeStore()
  store.initialize = async (options) => {
    store.calls.push(['initialize', options])
    const snapshot = store.getSnapshot()
    Object.assign(snapshot, {
      status: 'ready',
      durability: 'session-only',
      error: { code: 'planner-write-not-durable' },
      recovery: { code: 'retry-persistence' },
    })
    return {
      ok: false,
      code: 'initialized-session-only',
      error: snapshot.error,
      snapshot,
    }
  }
  const runtime = createPlannerRuntime({
    city: CITY,
    storeFactory: () => store,
    sourceCapture: () => ({ source: {}, sourceTimeZone: CITY.tz }),
  })
  await runtime.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: DAY, wkStartTs: NEXT_DAY },
  })
  assert.equal(runtime.getLifecycleSnapshot().phase, 'ready')
  assert.equal(plannerPublicStatus({
    artifactStatus: 'ready',
    lifecycle: runtime.getLifecycleSnapshot(),
    storeSnapshot: store.getSnapshot(),
  }), 'session-only')
})

test('a failed rollover remains retryable for the same new city day', async () => {
  const store = fakeStore()
  let attempts = 0
  store.dispatch = async (command) => {
    store.calls.push(['dispatch', command])
    attempts += 1
    return attempts === 1
      ? { ok: false, code: 'planner-rebase-conflict', changed: false, snapshot: store.getSnapshot() }
      : { ok: true, code: 'nothing-to-rollover', changed: false, snapshot: store.getSnapshot() }
  }
  const runtime = createPlannerRuntime({
    city: CITY,
    storeFactory: () => store,
    sourceCapture: () => ({ source: {}, sourceTimeZone: CITY.tz }),
  })
  await runtime.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: DAY, wkStartTs: NEXT_DAY },
  })
  assert.equal((await runtime.rollover(NEXT_DAY)).code, 'planner-rebase-conflict')
  assert.equal((await runtime.rollover(NEXT_DAY)).code, 'nothing-to-rollover')
  assert.equal(attempts, 2)
})

test('planner actions require explicit placement and derive conflicts from the stored ref', async () => {
  const store = fakeStore()
  const actions = createPlannerActions(store)
  const item = event('aaaaaaaaaaaaaaaa')
  await actions.add(item, { dayTs: DAY, part: 'night' })
  await actions.add(item)
  const slot = {
    dayTs: DAY,
    part: 'night',
    ref: { primary: 'e|aaaaaaaaaaaaaaaa' },
  }
  await actions.move(slot, { dayTs: NEXT_DAY, part: 'morning' })
  await actions.remove(slot)
  await actions.setRest(NEXT_DAY, true)
  await actions.undo({ kind: 'planner-undo', operation: 'add' })
  await actions.retryPersistence()

  assert.deepEqual(store.calls, [
    ['dispatch', { type: 'add', item, dayTs: DAY, part: 'night' }],
    ['dispatch', { type: 'add', item, dayTs: undefined, part: undefined }],
    ['dispatch', {
      type: 'move',
      fromDayTs: DAY,
      fromPart: 'night',
      toDayTs: NEXT_DAY,
      toPart: 'morning',
      expectedPrimary: 'e|aaaaaaaaaaaaaaaa',
    }],
    ['dispatch', {
      type: 'remove',
      dayTs: DAY,
      part: 'night',
      expectedPrimary: 'e|aaaaaaaaaaaaaaaa',
    }],
    ['dispatch', { type: 'rest', dayTs: NEXT_DAY, rest: true }],
    ['dispatch', { type: 'undo', receipt: { kind: 'planner-undo', operation: 'add' } }],
    ['retry'],
  ])
})

test('runtime rejects add, move, and rest targets before the current city day', async () => {
  const store = fakeStore()
  const runtime = createPlannerRuntime({
    city: CITY,
    storeFactory: () => store,
    sourceCapture: () => ({ source: {}, sourceTimeZone: CITY.tz }),
  })
  await runtime.initialize({
    artifactStatus: 'ready',
    anchors: { todayTs: DAY, wkStartTs: NEXT_DAY },
  })

  const item = event('aaaaaaaaaaaaaaaa')
  const slot = {
    dayTs: DAY,
    part: 'night',
    ref: { primary: 'e|aaaaaaaaaaaaaaaa' },
  }
  assert.equal((await runtime.actions.add(item, {
    dayTs: DAY - 86_400_000,
    part: 'night',
  })).code, 'past-day-target')
  assert.equal((await runtime.actions.move(slot, {
    dayTs: DAY - 86_400_000,
    part: 'morning',
  })).code, 'past-day-target')
  assert.equal((await runtime.actions.setRest(DAY - 86_400_000, true)).code, 'past-day-target')
  assert.equal(store.calls.filter(([kind]) => kind === 'dispatch').length, 0)

  assert.equal((await runtime.actions.add(item, { dayTs: DAY, part: 'night' })).code, 'add')
  await runtime.rollover(NEXT_DAY)
  assert.equal((await runtime.actions.add(item, { dayTs: DAY, part: 'night' })).code, 'past-day-target')
  assert.equal(
    store.calls.filter(([kind, command]) => kind === 'dispatch' && command.type === 'add').length,
    1,
  )
})

test('day models resolve live, retained missing, and ambiguous references across active and history', () => {
  const live = event('aaaaaaaaaaaaaaaa', 'Live title')
  const missingLegacy = 'Missing title|2026-07-18'
  const ambiguousLegacy = 'Ambiguous title|2026-07-19'
  const missingRef = slotRefOf(
    {
      kind: 'event',
      primary: missingLegacy,
      aliases: [missingLegacy],
      title: 'Missing title',
      start: '2026-07-18',
    },
    {
      identity: {
        status: 'missing',
        legacyKey: missingLegacy,
      },
    }
  )
  const ambiguousRef = slotRefOf(
    {
      kind: 'event',
      primary: ambiguousLegacy,
      aliases: [ambiguousLegacy],
      title: 'Ambiguous title',
      start: '2026-07-19',
    },
    {
      identity: {
        status: 'ambiguous',
        legacyKey: ambiguousLegacy,
        candidates: ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'],
      },
    }
  )
  const liveRef = slotRefOf(live)
  const document = normalizePlannerDocument({
    ...emptyPlannerDocument(),
    active: {
      [DAY]: {
        state: null,
        slots: {
          morning: liveRef,
          afternoon: missingRef,
          night: ambiguousRef,
        },
        done: false,
      },
    },
    history: [{
      dayTs: DAY - 86_400_000,
      state: 'rest',
      slots: { morning: null, afternoon: null, night: null },
      done: true,
    }],
  })
  const catalog = createPlannerCatalog({ events: [live] })
  const active = plannerDayModel(document, DAY, catalog)
  assert.equal(active.source, 'active')
  assert.deepEqual(active.slots.map((slot) => slot.resolution), ['live', 'missing', 'ambiguous'])
  assert.deepEqual(active.slots.map((slot) => slot.dayTs), [DAY, DAY, DAY])
  assert.equal(active.slots[0].item.title, 'Live title')
  assert.equal(active.slots[1].item.title, 'Missing title')
  assert.equal(active.slots[2].item.title, 'Ambiguous title')

  const history = plannerDayModel(document, DAY - 86_400_000, catalog)
  assert.equal(history.source, 'history')
  assert.equal(history.state, 'rest')
  assert.equal(history.done, true)
  assert.deepEqual(history.slots, [])
  assert.equal(filledPlannerDayCount(document), 1)
  assert.equal(resolvePlannerReference(missingRef, catalog).status, 'missing')
})

test('day-model slots round-trip through exact move and remove actions', async () => {
  const item = event('aaaaaaaaaaaaaaaa', 'Round trip')
  const document = normalizePlannerDocument({
    ...emptyPlannerDocument(),
    active: {
      [DAY]: {
        state: null,
        slots: {
          morning: null,
          afternoon: null,
          night: slotRefOf(item),
        },
        done: false,
      },
    },
  })
  const slot = plannerDayModel(
    document,
    DAY,
    createPlannerCatalog({ events: [item] }),
  ).slots[0]
  const store = fakeStore()
  const actions = createPlannerActions(store)

  await actions.move(slot, { dayTs: NEXT_DAY, part: 'morning' })
  await actions.remove(slot)

  assert.deepEqual(store.calls, [
    ['dispatch', {
      type: 'move',
      fromDayTs: DAY,
      fromPart: 'night',
      toDayTs: NEXT_DAY,
      toPart: 'morning',
      expectedPrimary: slot.ref.primary,
    }],
    ['dispatch', {
      type: 'remove',
      dayTs: DAY,
      part: 'night',
      expectedPrimary: slot.ref.primary,
    }],
  ])
})

test('filled-day count is distinct across active and history and ignores rest-only days', () => {
  const first = slotRefOf(event('aaaaaaaaaaaaaaaa'))
  const second = slotRefOf(event('bbbbbbbbbbbbbbbb'))
  const document = normalizePlannerDocument({
    ...emptyPlannerDocument(),
    active: {
      [DAY]: {
        state: null,
        slots: { morning: first, afternoon: null, night: null },
        done: false,
      },
      [NEXT_DAY]: {
        state: 'rest',
        slots: { morning: null, afternoon: null, night: null },
        done: false,
      },
    },
    history: [
      {
        dayTs: DAY,
        state: null,
        slots: { morning: null, afternoon: second, night: null },
        done: true,
      },
      {
        dayTs: DAY - 86_400_000,
        state: null,
        slots: { morning: null, afternoon: null, night: second },
        done: true,
      },
      {
        dayTs: DAY - 172_800_000,
        state: 'rest',
        slots: { morning: null, afternoon: null, night: null },
        done: true,
      },
    ],
  })

  assert.equal(filledPlannerDayCount(document), 2)
})

test('destroy is idempotent and tears down the sole city store', () => {
  const store = fakeStore()
  const runtime = createPlannerRuntime({
    city: CITY,
    storeFactory: () => store,
    sourceCapture: () => ({ source: {} }),
  })
  runtime.destroy()
  runtime.destroy()
  assert.deepEqual(store.calls, [['destroy']])
})
