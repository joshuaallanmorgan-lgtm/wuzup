import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'

import {
  activityRefOf,
  clearActivityDecks,
  emptyActivityState,
  recordActivityRef,
} from '../app/src/activity-state-core.js'
import {
  activityRecordCommand,
  createActivityStore,
} from '../app/src/activity-store.js'
import { dealDeck, deckKeyOf, nextEventsBatch } from '../app/src/deckdeal.js'
import { customIdentityBridgeOf } from '../app/src/identity.js'

const CITY = Object.freeze({ id: 'tampa-bay', tz: 'America/New_York' })
const source = await readFile(
  new URL('../app/src/ActivityProvider.jsx', import.meta.url),
  'utf8',
)
const vite = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)),
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'silent',
})
let providerModule
try {
  providerModule = await vite.ssrLoadModule('/src/ActivityProvider.jsx')
} finally {
  await vite.close()
}

const {
  activityCatalogUnlocked,
  activityExclusionReadModel,
  activityItemExcluded,
  activityPublicStatus,
  createActivityActions,
  isUsableActivityStatus,
  projectActivityDocument,
  resolveRecentRefs,
} = providerModule

function event(id = '0123456789abcdef', overrides = {}) {
  return {
    kind: 'event',
    id,
    title: 'Porch show',
    url: 'https://fixture.test/porch-show',
    start: '2026-08-21T20:00:00-04:00',
    ...overrides,
  }
}

function place(key = 'p|museum', overrides = {}) {
  return { kind: 'place', key, name: 'City museum', ...overrides }
}

function reduce(document, command) {
  if (command?.type === 'record') {
    return recordActivityRef(document, {
      cityId: CITY.id,
      collection: command.collection,
      ref: command.ref,
    })
  }
  if (command?.type === 'clear-decks') return clearActivityDecks(document, { cityId: CITY.id })
  return { document, changed: false, code: 'invalid-command' }
}

function createActionStore({ durability = 'durable', document: initialDocument } = {}) {
  let document = initialDocument || emptyActivityState(CITY.id)
  let currentDurability = durability
  let status = 'ready'
  let dispatchOverride = null
  let retryOverride = null
  let opCounter = 0
  let commitId = 'fixture-commit-0'
  let parentId = null
  let commitOps = []
  let recentOps = []
  let pendingOps = currentDurability === 'durable'
    ? []
    : [{ kind: 'initialize', opId: 'fixture-init-pending' }]
  const listeners = new Set()
  const commands = []
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const snapshot = () => ({
    status,
    cityId: CITY.id,
    document,
    envelope: {
      document,
      commit: { id: commitId, parentId, opIds: [...commitOps] },
      recentOps: [...recentOps],
    },
    durability: currentDurability,
    concurrency: currentDurability === 'durable' ? 'web-lock' : 'session-only-no-lock',
    pendingOps: pendingOps.map(({ kind, opId }) => ({ kind, opId })),
    error: currentDurability === 'durable' ? null : { code: 'storage-unavailable' },
    recovery: currentDurability === 'durable'
      ? null
      : { code: 'retry-persistence', canRetry: true },
  })
  const result = (reduced, { opId = null } = {}) => ({
    ok: currentDurability === 'durable',
    code: reduced.code,
    changed: reduced.changed === true,
    persisted: currentDurability === 'durable',
    durability: currentDurability,
    concurrency: snapshot().concurrency,
    ...(opId ? { opId } : {}),
    snapshot: snapshot(),
  })
  const publishReduction = (reduced, opId, { pending = false } = {}) => {
    if (!reduced.changed) return
    document = reduced.document
    parentId = commitId
    commitId = `fixture-commit-${++opCounter}`
    if (pending) {
      pendingOps.push({ kind: 'command', opId, code: reduced.code })
      commitOps = pendingOps.filter((row) => row.kind === 'command').map((row) => row.opId)
    } else {
      commitOps = [opId]
    }
    recentOps = [...new Set([...recentOps, ...commitOps])]
    emit()
  }
  const apply = (command) => {
    const reduced = reduce(document, command)
    if (reduced.changed) {
      document = reduced.document
      emit()
    }
    return reduced
  }
  return {
    commands,
    initialize: async () => result({ code: 'existing-destination', changed: false }),
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispatch(command) {
      commands.push(command)
      if (dispatchOverride) return dispatchOverride(command, snapshot(), apply)
      const opId = `fixture-op-${++opCounter}`
      const reduced = reduce(document, command)
      publishReduction(reduced, opId, { pending: currentDurability !== 'durable' })
      return result(reduced, { opId })
    },
    async retryPersistence() {
      if (retryOverride) return retryOverride(snapshot(), apply)
      if (currentDurability === 'durable') {
        return result({ code: 'nothing-to-retry', changed: false })
      }
      const lastCommand = pendingOps.filter((row) => row.kind === 'command').at(-1)
      currentDurability = 'durable'
      pendingOps = []
      emit()
      return result({ code: lastCommand?.code || 'persisted', changed: true })
    },
    destroy() {
      listeners.clear()
    },
    setDispatchOverride(value) { dispatchOverride = value },
    setRetryOverride(value) { retryOverride = value },
    setStatus(value) { status = value },
  }
}

function createRealStoreBackend() {
  const values = new Map()
  let failWrites = false
  let nextId = 0
  const scope = {
    set(key, value) {
      if (failWrites) return false
      values.set(key, value)
      return true
    },
    peekDurable(key) {
      return values.has(key)
        ? { status: 'ok', value: values.get(key), source: 'durable' }
        : { status: 'missing', value: null, source: null }
    },
  }
  const lockManager = {
    request(_name, _options, callback) {
      return callback()
    },
  }
  return {
    create(contextId) {
      return createActivityStore({
        city: CITY,
        storageFactory: () => scope,
        lockManager,
        eventTarget: null,
        createId: () => `${contextId}-${++nextId}`,
        contextId,
        now: () => 1_800_000_000_000 + nextId,
      })
    },
    failWrites(value) {
      failWrites = value === true
    },
  }
}

async function initializeRealStore(store) {
  return store.initialize({
    source: { recents: [], eventDeck: [], placeDeck: [] },
  })
}

function dispatchProxy(store, beforeDispatch) {
  return {
    destroy: () => store.destroy(),
    dispatch: async (command) => {
      await beforeDispatch(command)
      return store.dispatch(command)
    },
    getSnapshot: () => store.getSnapshot(),
    initialize: (...args) => store.initialize(...args),
    retryPersistence: (...args) => store.retryPersistence(...args),
    subscribe: (...args) => store.subscribe(...args),
  }
}

test('provider is city-keyed, effect-owned, catalog-gated, and never activates places', () => {
  const effectIndex = source.indexOf('useEffect(() => {')
  const constructionIndex = source.indexOf('store = storeFactoryRef.current({ city: selectedCity })')
  assert.ok(effectIndex >= 0 && constructionIndex > effectIndex)
  assert.match(source, /useArtifact\('events'\)/)
  assert.match(source, /useArtifact\('places', false\)/)
  assert.match(source, /useCustomEvents\(\)/)
  assert.match(source, /createCatalogLatch/)
  assert.match(source, /if \(!catalogUnlocked\) return undefined/)
  assert.match(source, /sourceFactory: \(\) => sourceCaptureRef\.current/)
  assert.match(source, /store\.initialize\(/)
  assert.match(source, /store\?\.destroy\?\.\(\)/)
  assert.match(source, /const cityKey = `\$\{city\.id\}:\$\{city\.tz\}`/)
  assert.match(source, /key=\{cityKey\}/)
  assert.doesNotMatch(source, /lsGet|lsSet|recents-v1|deck-last-v1/)
})

test('catalog unlock is monotonic and requires trustworthy events plus custom rows', () => {
  assert.equal(activityCatalogUnlocked(false, {
    eventStatus: 'loading',
    customReady: true,
  }), false)
  assert.equal(activityCatalogUnlocked(false, {
    eventStatus: 'ready',
    customReady: false,
  }), false)
  assert.equal(activityCatalogUnlocked(false, {
    eventStatus: 'empty',
    customReady: true,
  }), true)
  assert.equal(activityCatalogUnlocked(true, {
    eventStatus: 'error',
    customReady: false,
  }), true)
})

test('public status keeps usable session-only documents visible through transient errors', () => {
  const ready = {
    status: 'ready',
    durability: 'durable',
    document: emptyActivityState(CITY.id),
  }
  assert.equal(activityPublicStatus({
    lifecycle: { phase: 'initializing' },
    storeSnapshot: ready,
  }), 'initializing')
  assert.equal(activityPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: ready,
  }), 'durable')
  assert.equal(activityPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: { ...ready, durability: 'session-only' },
  }), 'session-only')
  assert.equal(activityPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: {
      ...ready,
      status: 'error',
      durability: 'session-only',
      pendingOps: [{ kind: 'command' }],
    },
  }), 'session-only')
  assert.equal(activityPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: { ...ready, status: 'corrupt', durability: 'unknown' },
  }), 'corrupt')
  assert.equal(isUsableActivityStatus('durable'), true)
  assert.equal(isUsableActivityStatus('session-only'), true)
  assert.equal(isUsableActivityStatus('corrupt'), false)
})

test('public projections are detached, deeply frozen, and kind-correct', () => {
  let document = emptyActivityState(CITY.id)
  document = recordActivityRef(document, {
    cityId: CITY.id,
    collection: 'recents',
    ref: activityRefOf(event()),
  }).document
  document = recordActivityRef(document, {
    cityId: CITY.id,
    collection: 'placeDeck',
    ref: activityRefOf(place(), { kind: 'place' }),
  }).document
  const projection = projectActivityDocument(document, { cityId: CITY.id })
  assert.equal(Object.isFrozen(projection), true)
  assert.equal(Object.isFrozen(projection.recents), true)
  assert.equal(Object.isFrozen(projection.recents[0]), true)
  assert.notEqual(projection.recents, document.recents)
  assert.notEqual(projection.recents[0], document.recents[0])
  assert.equal(projection.recents[0].kind, 'event')
  assert.equal(projection.placeDeck[0].kind, 'place')
})

test('recent resolution follows unique aliases, refuses ambiguity, and bridges pending custom identity', () => {
  const old = event('36ec15d158ebe5f0')
  const current = event('e742c347c9f31d72')
  const oldRef = activityRefOf(old)
  assert.deepEqual(resolveRecentRefs([oldRef], [current]), [current])
  assert.deepEqual(resolveRecentRefs([oldRef], [
    current,
    event('aaaaaaaaaaaaaaaa'),
  ]), [])
  assert.deepEqual(resolveRecentRefs([oldRef], [place(oldRef.aliases[1])]), [])

  const localId = 'custom-event-0001'
  const bridge = customIdentityBridgeOf(`c|${localId}`)
  const pending = {
    kind: 'custom',
    title: 'Pending custom',
    start: '2026-08-22T20:00:00-04:00',
    _keyTitle: 'session-custom-0123456789abcdef',
    _sessionIdentityAliases: [bridge],
  }
  const pendingRef = activityRefOf(pending, { kind: 'event' })
  assert.equal(pendingRef.aliases.includes(bridge), true)
  assert.equal(pendingRef.aliases.some((alias) => alias.startsWith('c|')), false)
  const landed = { ...pending, localId }
  delete landed._keyTitle
  delete landed._sessionIdentityAliases
  assert.deepEqual(resolveRecentRefs([pendingRef], [landed]), [landed])
})

test('exact primary authority survives weak-alias collisions without over-excluding neighbors', () => {
  const exact = event('aaaaaaaaaaaaaaaa')
  const neighbor = event('bbbbbbbbbbbbbbbb')
  const exactRef = activityRefOf(exact)
  assert.ok(exactRef.aliases.some((alias) => activityRefOf(neighbor).aliases.includes(alias)))
  assert.deepEqual(resolveRecentRefs([exactRef], [exact, neighbor]), [exact])

  const document = recordActivityRef(emptyActivityState(CITY.id), {
    cityId: CITY.id,
    collection: 'eventDeck',
    ref: exactRef,
  }).document
  const model = activityExclusionReadModel(document, {
    cityId: CITY.id,
    collection: 'eventDeck',
    items: [exact, neighbor],
    seeds: [],
    kind: 'event',
  })
  assert.equal(activityItemExcluded(model, exact, 'event'), true)
  assert.equal(activityItemExcluded(model, neighbor, 'event'), false)

  const drifted = event('cccccccccccccccc')
  assert.deepEqual(resolveRecentRefs([exactRef], [drifted]), [drifted])
})

test('deck sampling excludes the retained primary while keeping its weak-alias neighbor reachable', () => {
  const day = Date.parse('2026-08-21T00:00:00-04:00')
  const exact = event('aaaaaaaaaaaaaaaa', {
    _day: day,
    _endDay: day,
    _t: day,
    category: 'music',
    hotScore: 90,
  })
  const neighbor = event('bbbbbbbbbbbbbbbb', {
    _day: day,
    _endDay: day,
    _t: day + 1,
    category: 'music',
    hotScore: 80,
  })
  assert.notEqual(deckKeyOf(exact), deckKeyOf(neighbor))
  const document = recordActivityRef(emptyActivityState(CITY.id), {
    cityId: CITY.id,
    collection: 'eventDeck',
    ref: activityRefOf(exact),
  }).document
  const model = activityExclusionReadModel(document, {
    cityId: CITY.id,
    collection: 'eventDeck',
    items: [exact, neighbor],
    seeds: [],
    kind: 'event',
  })
  const excludeItem = (item) => activityItemExcluded(model, item, 'event')
  const anchors = { todayTs: day }
  const initial = dealDeck([exact, neighbor], anchors, {
    exclude: new Set(model.keys),
    excludeItem,
    rng: () => 0,
  })
  assert.equal(initial.some((item) => item.id === exact.id), false)
  assert.equal(initial.some((item) => item.id === neighbor.id), true)

  const seen = new Set(initial.map(deckKeyOf))
  const redealt = nextEventsBatch([exact, neighbor], anchors, seen, {
    persisted: model.keys,
    excludeItem,
    rng: () => 0,
  })
  assert.equal(redealt.some((item) => item.id === exact.id), false)
  assert.equal(redealt.some((item) => item.id === neighbor.id), true)
})

test('record actions serialize exact outcomes and update session recents only after validation', async () => {
  const store = createActionStore()
  const session = []
  const actions = createActivityActions(store, {
    cityId: CITY.id,
    onSessionRecent: (ref) => session.push(ref),
  })
  const first = await actions.recordView(event())
  assert.equal(first.code, 'recorded')
  assert.equal(first.changed, true)
  assert.equal(first.applied, true)
  assert.equal(session.length, 1)
  const repeated = await actions.recordView(event())
  assert.equal(repeated.code, 'already-current')
  assert.equal(repeated.changed, false)
  assert.equal(repeated.applied, true)
  assert.equal(session.length, 2, 'a re-view still promotes the tab-local session list')

  const eventDeck = await actions.recordEventDeck(event())
  const placeDeck = await actions.recordPlaceDeck(place())
  assert.equal(eventDeck.code, 'recorded')
  assert.equal(placeDeck.code, 'recorded')
  const cleared = await actions.clearDeckMemories()
  assert.equal(cleared.code, 'cleared-decks')
  assert.equal(cleared.applied, true)
  assert.deepEqual(store.getSnapshot().document.eventDeck, [])
  assert.deepEqual(store.getSnapshot().document.placeDeck, [])
  assert.equal(store.commands.at(-1).type, 'clear-decks')
})

test('session-only records are usable and retry reports durable truth', async () => {
  const store = createActionStore({ durability: 'session-only' })
  const actions = createActivityActions(store, { cityId: CITY.id })
  const recorded = await actions.recordEventDeck(event())
  assert.equal(recorded.ok, false)
  assert.equal(recorded.code, 'recorded')
  assert.equal(recorded.applied, true)
  assert.equal(recorded.persisted, false)
  assert.equal(recorded.durability, 'session-only')
  const retried = await actions.retry()
  assert.equal(retried.code, 'recorded')
  assert.equal(retried.applied, true)
  assert.equal(retried.persisted, true)
  assert.equal(retried.durability, 'durable')
  const repeated = await actions.retry()
  assert.equal(repeated.code, 'nothing-to-retry')
  assert.equal(repeated.changed, false)
})

test('real atomic retry accepts replayed reducer codes and clears pending durability', async () => {
  const backend = createRealStoreBackend()
  const store = backend.create('provider-real-retry')
  await initializeRealStore(store)
  const actions = createActivityActions(store, { cityId: CITY.id })

  backend.failWrites(true)
  const recorded = await actions.recordEventDeck(event('dddddddddddddddd'))
  assert.equal(recorded.code, 'recorded')
  assert.equal(recorded.applied, true)
  assert.equal(recorded.persisted, false)
  assert.equal(store.getSnapshot().pendingOps.length, 1)

  const stillVolatile = await actions.retry()
  assert.equal(stillVolatile.code, 'recorded')
  assert.equal(stillVolatile.applied, true)
  assert.equal(stillVolatile.persisted, false)
  assert.equal(stillVolatile.durability, 'session-only')
  assert.equal(store.getSnapshot().pendingOps.length, 1)

  backend.failWrites(false)
  const retried = await actions.retry()
  assert.equal(retried.code, 'recorded')
  assert.equal(retried.applied, true)
  assert.equal(retried.persisted, true)
  assert.equal(retried.durability, 'durable')
  assert.equal(store.getSnapshot().pendingOps.length, 0)
  assert.equal(store.getSnapshot().document.eventDeck.length, 1)
  store.destroy()
})

test('real session-only no-ops remain applied without claiming persistence', async () => {
  const backend = createRealStoreBackend()
  const deckStore = backend.create('provider-real-noop-deck')
  await initializeRealStore(deckStore)
  const deckActions = createActivityActions(deckStore, { cityId: CITY.id })
  const target = event('abababababababab')

  backend.failWrites(true)
  const first = await deckActions.recordEventDeck(target)
  assert.equal(first.applied, true)
  assert.equal(first.persisted, false)
  const pending = deckStore.getSnapshot().pendingOps.map((row) => ({ ...row }))
  const repeated = await deckActions.recordEventDeck(target)
  assert.equal(repeated.code, 'already-current')
  assert.equal(repeated.ok, true)
  assert.equal(repeated.applied, true)
  assert.equal(repeated.persisted, false)
  assert.deepEqual(deckStore.getSnapshot().pendingOps, pending)
  deckStore.destroy()

  backend.failWrites(false)
  const clearStore = backend.create('provider-real-noop-clear')
  await initializeRealStore(clearStore)
  const clearActions = createActivityActions(clearStore, { cityId: CITY.id })
  backend.failWrites(true)
  await clearActions.recordView(event('cdcdcdcdcdcdcdcd'))
  const clearPending = clearStore.getSnapshot().pendingOps.map((row) => ({ ...row }))
  const cleared = await clearActions.clearDeckMemories()
  assert.equal(cleared.code, 'already-empty')
  assert.equal(cleared.ok, true)
  assert.equal(cleared.applied, true)
  assert.equal(cleared.persisted, false)
  assert.deepEqual(clearStore.getSnapshot().pendingOps, clearPending)
  clearStore.destroy()
})

test('real retry rebases record and clear commands without losing external collateral', async () => {
  const recordBackend = createRealStoreBackend()
  const recordLocal = recordBackend.create('provider-retry-record-local')
  const recordExternal = recordBackend.create('provider-retry-record-external')
  await initializeRealStore(recordLocal)
  await initializeRealStore(recordExternal)
  const target = event('1212121212121212', { title: 'Pending deck target' })
  const collateral = event('3434343434343434', { title: 'External recent' })
  const recordActions = createActivityActions(recordLocal, { cityId: CITY.id })

  recordBackend.failWrites(true)
  assert.equal((await recordActions.recordEventDeck(target)).persisted, false)
  recordBackend.failWrites(false)
  await recordExternal.dispatch(activityRecordCommand('recents', collateral))
  const retriedRecord = await recordActions.retry()
  assert.equal(retriedRecord.code, 'recorded')
  assert.equal(retriedRecord.applied, true)
  assert.equal(retriedRecord.persisted, true)
  assert.equal(recordLocal.getSnapshot().pendingOps.length, 0)
  assert.equal(recordLocal.getSnapshot().document.eventDeck[0].primary, activityRefOf(target).primary)
  assert.equal(recordLocal.getSnapshot().document.recents[0].primary, activityRefOf(collateral).primary)
  recordLocal.destroy()
  recordExternal.destroy()

  const clearBackend = createRealStoreBackend()
  const clearLocal = clearBackend.create('provider-retry-clear-local')
  const clearExternal = clearBackend.create('provider-retry-clear-external')
  await initializeRealStore(clearLocal)
  await initializeRealStore(clearExternal)
  await clearLocal.dispatch(activityRecordCommand('eventDeck', target))
  await clearLocal.dispatch(activityRecordCommand('placeDeck', place('p|retry-clear')))
  await clearExternal.reloadFromDurable()
  const clearActions = createActivityActions(clearLocal, { cityId: CITY.id })

  clearBackend.failWrites(true)
  assert.equal((await clearActions.clearDeckMemories()).persisted, false)
  clearBackend.failWrites(false)
  await clearExternal.dispatch(activityRecordCommand('recents', collateral))
  const retriedClear = await clearActions.retry()
  assert.equal(retriedClear.code, 'cleared-decks')
  assert.equal(retriedClear.applied, true)
  assert.equal(retriedClear.persisted, true)
  assert.deepEqual(clearLocal.getSnapshot().document.eventDeck, [])
  assert.deepEqual(clearLocal.getSnapshot().document.placeDeck, [])
  assert.equal(clearLocal.getSnapshot().document.recents[0].primary, activityRefOf(collateral).primary)
  clearLocal.destroy()
  clearExternal.destroy()
})

test('real atomic record and clear accept safe cross-tab rebases with collateral state', async () => {
  const recordBackend = createRealStoreBackend()
  const recordLocal = recordBackend.create('provider-record-local')
  const recordExternal = recordBackend.create('provider-record-external')
  await initializeRealStore(recordLocal)
  await initializeRealStore(recordExternal)
  const collateral = event('eeeeeeeeeeeeeeee', { title: 'External collateral' })
  const target = event('ffffffffffffffff', { title: 'Local target' })
  let injectRecord = true
  const recordActions = createActivityActions(dispatchProxy(recordLocal, async () => {
    if (!injectRecord) return
    injectRecord = false
    await recordExternal.dispatch(activityRecordCommand('recents', collateral))
  }), { cityId: CITY.id })
  const recorded = await recordActions.recordEventDeck(target)
  assert.equal(recorded.code, 'recorded')
  assert.equal(recorded.applied, true)
  assert.equal(recordLocal.getSnapshot().document.recents[0].primary, activityRefOf(collateral).primary)
  assert.equal(recordLocal.getSnapshot().document.eventDeck[0].primary, activityRefOf(target).primary)
  recordLocal.destroy()
  recordExternal.destroy()

  const clearBackend = createRealStoreBackend()
  const clearLocal = clearBackend.create('provider-clear-local')
  const clearExternal = clearBackend.create('provider-clear-external')
  await initializeRealStore(clearLocal)
  await initializeRealStore(clearExternal)
  await clearLocal.dispatch(activityRecordCommand('eventDeck', target))
  await clearLocal.dispatch(activityRecordCommand('placeDeck', place('p|clear-target')))
  await clearExternal.reloadFromDurable()
  let injectClear = true
  const clearActions = createActivityActions(dispatchProxy(clearLocal, async () => {
    if (!injectClear) return
    injectClear = false
    await clearExternal.dispatch(activityRecordCommand('recents', collateral))
  }), { cityId: CITY.id })
  const cleared = await clearActions.clearDeckMemories()
  assert.equal(cleared.code, 'cleared-decks')
  assert.equal(cleared.applied, true)
  assert.deepEqual(clearLocal.getSnapshot().document.eventDeck, [])
  assert.deepEqual(clearLocal.getSnapshot().document.placeDeck, [])
  assert.equal(clearLocal.getSnapshot().document.recents[0].primary, activityRefOf(collateral).primary)
  clearLocal.destroy()
  clearExternal.destroy()
})

test('hostile dispatch results fail closed without publishing a false session view', async () => {
  const store = createActionStore()
  let sessionWrites = 0
  store.setDispatchOverride((command, snapshot) => ({
    ok: true,
    code: command.type === 'record' ? 'recorded' : 'cleared-decks',
    changed: true,
    persisted: true,
    durability: snapshot.durability,
    concurrency: snapshot.concurrency,
  }))
  const actions = createActivityActions(store, {
    cityId: CITY.id,
    onSessionRecent: () => { sessionWrites += 1 },
  })
  const result = await actions.recordView(event())
  assert.equal(result.code, 'activity-result-inconsistent')
  assert.equal(result.applied, false)
  assert.equal(sessionWrites, 0)
  assert.deepEqual(store.getSnapshot().document.recents, [])

  store.setDispatchOverride((command, _snapshot, apply) => {
    const reduced = apply(command)
    return {
      ok: false,
      code: reduced.code,
      changed: reduced.changed,
      persisted: true,
      durability: 'durable',
      concurrency: 'web-lock',
    }
  })
  const forged = await actions.recordView(event('9999999999999999'))
  assert.equal(forged.code, 'activity-result-inconsistent')
  assert.equal(forged.applied, false)
  assert.equal(sessionWrites, 0)
  assert.equal(store.getSnapshot().document.recents.length, 1, 'the hostile store did mutate')
})

test('wrong-kind inputs and unavailable stores never dispatch', async () => {
  const store = createActionStore()
  const actions = createActivityActions(store, { cityId: CITY.id })
  const eventAsPlace = await actions.recordPlaceDeck(event())
  const placeAsEvent = await actions.recordEventDeck(place())
  const placeAsRecent = await actions.recordView(place('p|recent-place'))
  assert.equal(eventAsPlace.code, 'activity-command-unavailable')
  assert.equal(placeAsEvent.code, 'activity-command-unavailable')
  assert.equal(placeAsRecent.code, 'activity-command-unavailable')
  assert.equal(store.commands.length, 0)

  const unavailable = createActivityActions(null, { cityId: CITY.id })
  assert.equal((await unavailable.recordView(event())).code, 'activity-unavailable')
})
