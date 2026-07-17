import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'

import {
  customEventItems,
  emptyCustomEventState,
  reduceCustomEventState,
} from '../app/src/custom-event-state-core.js'
import {
  customEventAddCommand,
  customEventDeleteCommand,
  customEventImportCommand,
  customEventUpdateCommand,
} from '../app/src/custom-event-store.js'
import { primaryKeyOf } from '../app/src/identity.js'
import {
  createPlannerCatalog,
  findPlannedItem,
  resolvePlannerSlot,
} from '../app/src/planner-selectors.js'
import {
  emptyPlannerDocument,
  normalizePlannerDocument,
  slotRefOf,
} from '../app/src/planner-core.js'

const CITY = Object.freeze({ id: 'tampa-bay', tz: 'America/New_York' })
const source = await readFile(
  new URL('../app/src/CustomEventsProvider.jsx', import.meta.url),
  'utf8',
)
const vite = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})
let providerModule
try {
  providerModule = await vite.ssrLoadModule('/src/CustomEventsProvider.jsx')
} finally {
  await vite.close()
}

const {
  createCustomEventActions,
  customEventsPublicStatus,
  isUsableCustomEventsStatus,
} = providerModule

function event(localId, overrides = {}) {
  return {
    title: 'Porch show',
    start: '2026-08-21T20:00:00',
    ...(localId ? { localId } : {}),
    ...overrides,
  }
}

function createActionStore({
  durability = 'durable',
  initial = [],
} = {}) {
  let document = emptyCustomEventState(CITY.id, { timeZone: CITY.tz })
  for (const item of initial) {
    const reduced = reduceCustomEventState(document, { type: 'add', event: item }, {
      cityId: CITY.id,
      timeZone: CITY.tz,
    })
    assert.equal(reduced.changed, true, `invalid fake-store seed: ${reduced.code}`)
    document = reduced.document
  }
  let status = 'ready'
  let currentDurability = durability
  let dispatchOverride = null
  let retryOverride = null
  let destroyed = false
  const commands = []
  const listeners = new Set()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const snapshot = () => ({
    status,
    cityId: CITY.id,
    timeZone: CITY.tz,
    document,
    envelope: { document },
    durability: currentDurability,
    concurrency: currentDurability === 'durable' ? 'web-lock' : 'session-only-no-lock',
    pendingOps: currentDurability === 'durable' ? [] : [{ kind: 'command', opId: 'pending-op' }],
    error: currentDurability === 'durable' ? null : { code: 'storage-unavailable' },
    recovery: currentDurability === 'durable'
      ? null
      : { code: 'retry-persistence', canRetry: true },
  })
  const result = (reduced) => ({
    ok: currentDurability === 'durable'
      && !reduced.conflict
      && !reduced.rejection,
    code: reduced.code,
    changed: reduced.changed === true,
    persisted: currentDurability === 'durable',
    durability: currentDurability,
    concurrency: snapshot().concurrency,
    ...(reduced.conflict ? { conflict: reduced.conflict } : {}),
    ...(reduced.rejection ? { rejection: reduced.rejection } : {}),
    ...(currentDurability === 'session-only'
      ? { error: { code: 'storage-unavailable' } }
      : {}),
    // The real atomic result contains this private backing snapshot. Provider
    // actions must never forward it, especially while it carries unlanded c|.
    snapshot: snapshot(),
  })
  const applyCommand = (command) => {
    const coreCommand = command.type === 'add'
      ? { type: 'add', event: command.event }
      : command
    const reduced = reduceCustomEventState(document, coreCommand, {
      cityId: CITY.id,
      timeZone: CITY.tz,
    })
    if (reduced.changed) {
      document = reduced.document
      emit()
    }
    return result(reduced)
  }
  const store = {
    commands,
    initialize: async () => result({ code: 'existing-destination', changed: false }),
    getSnapshot: snapshot,
    getItems: () => customEventItems(document, {
      cityId: CITY.id,
      timeZone: CITY.tz,
      durability: currentDurability,
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addCommand: (item) => customEventAddCommand(document, item, { city: CITY }),
    updateCommand: (localId, item) => customEventUpdateCommand(
      document,
      localId,
      item,
      { city: CITY },
    ),
    deleteCommand: (localId) => customEventDeleteCommand(document, localId, { city: CITY }),
    importCommand: (items, options) => customEventImportCommand(document, items, {
      ...options,
      city: CITY,
    }),
    async dispatch(command) {
      commands.push(command)
      if (dispatchOverride) return dispatchOverride(command, snapshot())
      return applyCommand(command)
    },
    async retryPersistence() {
      if (retryOverride) return retryOverride(snapshot())
      if (currentDurability === 'durable') {
        return {
          ok: true,
          code: 'nothing-to-retry',
          changed: false,
          persisted: true,
          durability: 'durable',
          concurrency: snapshot().concurrency,
          snapshot: snapshot(),
        }
      }
      currentDurability = 'durable'
      emit()
      return {
        ok: true,
        code: 'persisted',
        changed: true,
        persisted: true,
        durability: 'durable',
        concurrency: 'web-lock',
        snapshot: snapshot(),
      }
    },
    destroy() {
      destroyed = true
      listeners.clear()
    },
    setStatus(value) {
      status = value
    },
    setDispatchOverride(value) {
      dispatchOverride = value
    },
    setRetryOverride(value) {
      retryOverride = value
    },
    applyCommand,
    wasDestroyed: () => destroyed,
  }
  return store
}

test('provider construction is city-keyed, effect-owned, subscribed, and capture-only', () => {
  const effectIndex = source.indexOf('useEffect(() => {')
  const constructionIndex = source.indexOf('store = storeFactoryRef.current({ city: selectedCity })')
  assert.ok(effectIndex >= 0 && constructionIndex > effectIndex)
  assert.match(source, /useSyncExternalStore/g)
  assert.ok((source.match(/useSyncExternalStore/g) || []).length >= 2)
  assert.match(source, /const cityKey = `\$\{city\.id\}:\$\{city\.tz\}`/)
  assert.match(source, /key=\{cityKey\}/)
  assert.match(source, /store\?\.destroy\?\.\(\)/)
  assert.match(
    source,
    /store\.initialize\(\{[\s\S]*sourceFactory:\s*\(\) => sourceCaptureRef\.current\(\{ city: selectedCity \}\)/,
  )
  assert.doesNotMatch(source, /useMemo\([^\n]*createCustomEventStore/)
  assert.doesNotMatch(source, /useState\([^\n]*createCustomEventStore/)
  assert.doesNotMatch(source, /from ['"]\.\/lib\.js['"]|\bloadMyEvents\b|\bsaveMyEvents\b/)
})

test('public status keeps initialization, durability, corruption, and errors distinct', () => {
  const ready = {
    status: 'ready',
    durability: 'durable',
    document: { items: [] },
  }
  assert.equal(customEventsPublicStatus({
    lifecycle: { phase: 'initializing' },
    storeSnapshot: ready,
  }), 'initializing')
  assert.equal(customEventsPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: ready,
  }), 'durable')
  assert.equal(customEventsPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: { ...ready, durability: 'session-only' },
  }), 'session-only')
  assert.equal(customEventsPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: { ...ready, status: 'corrupt', durability: 'unknown' },
  }), 'corrupt')
  assert.equal(customEventsPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: { ...ready, status: 'error', durability: 'unknown' },
  }), 'error')
  assert.equal(customEventsPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: ready,
    runtimeError: { code: 'provider-failed' },
  }), 'error')
  assert.equal(isUsableCustomEventsStatus('durable'), true)
  assert.equal(isUsableCustomEventsStatus('session-only'), true)
  assert.equal(isUsableCustomEventsStatus('initializing'), false)
  assert.equal(isUsableCustomEventsStatus('corrupt'), false)
})

test('add mints against current IDs and returns the canonical post-dispatch projection', async () => {
  const store = createActionStore({
    initial: [event('existing-local-id', { title: 'Existing' })],
  })
  const ids = ['existing-local-id', 'fresh-local-id']
  const actions = createCustomEventActions(store, {
    city: CITY,
    createLocalId: () => ids.shift(),
  })

  const promise = actions.add(event(null, { title: 'New event', start: '2026-08-22' }))
  assert.equal(typeof promise?.then, 'function', 'the public mutation is async')
  const added = await promise
  assert.equal(added.code, 'added')
  assert.equal(added.changed, true)
  assert.equal(added.persisted, true)
  assert.equal(added.item.localId, 'fresh-local-id')
  assert.equal(primaryKeyOf(added.item), 'c|fresh-local-id')
  assert.equal(store.commands[0].event.localId, 'fresh-local-id')
  assert.equal(Object.hasOwn(added, 'snapshot'), false)
})

test('duplicate and concurrent conflict codes survive without a false success claim', async () => {
  const original = event('existing-local-id')
  const store = createActionStore({ initial: [original] })
  const actions = createCustomEventActions(store, {
    city: CITY,
    createLocalId: () => 'different-local-id',
  })

  const duplicate = await actions.add(event(null))
  assert.equal(duplicate.code, 'duplicate-identity')
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.item.localId, 'existing-local-id')
  assert.equal(store.commands.length, 0, 'a rejected builder is never announced as dispatched')

  store.setDispatchOverride((_command, snapshot) => ({
    ok: true,
    code: 'item-revision-conflict',
    changed: false,
    persisted: true,
    durability: 'durable',
    concurrency: 'web-lock',
    conflict: { code: 'item-revision-conflict', primary: 'c|private-local-id' },
    snapshot,
  }))
  const conflict = await actions.update(store.getItems()[0], {
    ...store.getItems()[0],
    title: 'Concurrent edit',
  })
  assert.equal(conflict.code, 'item-revision-conflict')
  assert.equal(conflict.ok, false)
  assert.deepEqual(conflict.conflict, { code: 'item-revision-conflict' })
  assert.equal(Object.hasOwn(conflict, 'snapshot'), false)

  store.setDispatchOverride((_command, snapshot) => ({
    ok: true,
    code: 'added',
    changed: false,
    persisted: true,
    durability: 'durable',
    concurrency: 'web-lock',
    snapshot,
  }))
  const inconsistent = await actions.add(event(null, {
    title: 'False success',
    start: '2026-08-23',
  }))
  assert.equal(inconsistent.code, 'custom-event-result-inconsistent')
  assert.equal(inconsistent.ok, false)

  store.setDispatchOverride((_command, snapshot) => ({
    ok: true,
    code: 'item-revision-conflict',
    changed: true,
    persisted: true,
    durability: 'durable',
    concurrency: 'web-lock',
    snapshot,
  }))
  const falseUpdate = await actions.update(store.getItems()[0], {
    ...store.getItems()[0],
    title: 'Never landed',
  })
  assert.equal(falseUpdate.code, 'custom-event-result-inconsistent')
  assert.equal(falseUpdate.changed, false)

  store.setDispatchOverride((_command, snapshot) => ({
    ok: true,
    code: 'deleted',
    changed: true,
    persisted: true,
    durability: 'durable',
    concurrency: 'web-lock',
    snapshot,
  }))
  const falseDelete = await actions.remove(store.getItems()[0])
  assert.equal(falseDelete.code, 'custom-event-result-inconsistent')
  assert.equal(falseDelete.changed, false)
  assert.equal(store.getItems().length, 1)

  store.setDispatchOverride(() => Object.defineProperty({}, 'code', {
    enumerable: true,
    get() { throw new Error('hostile result') },
  }))
  const hostile = await actions.remove(store.getItems()[0])
  assert.equal(hostile.code, 'custom-event-result-invalid')
  assert.equal(hostile.changed, false)
})

test('opaque custom bridges keep session plans attached across persistence and restore', () => {
  const context = { cityId: CITY.id, timeZone: CITY.tz }
  const empty = emptyCustomEventState(CITY.id, { timeZone: CITY.tz })
  const added = reduceCustomEventState(empty, {
    type: 'add',
    event: event('session-local-id'),
  }, context)
  assert.equal(added.changed, true)

  const session = customEventItems(added.document, { ...context, durability: 'session-only' })[0]
  const ref = slotRefOf(session)
  const plan = normalizePlannerDocument({
    ...emptyPlannerDocument(),
    active: { 3000: { state: null, slots: { night: ref } } },
  })
  const assertAttached = (item) => {
    const catalog = createPlannerCatalog({ customEvents: [item] })
    assert.equal(resolvePlannerSlot(ref, catalog).status, 'live')
    assert.deepEqual(findPlannedItem(plan, item, catalog), {
      dayTs: 3000,
      part: 'night',
      ref: plan.active['3000'].slots.night,
    })
  }

  assertAttached(customEventItems(added.document, { ...context, durability: 'durable' })[0])

  const entry = added.document.items[0]
  const updated = reduceCustomEventState(added.document, {
    type: 'update',
    localId: entry.item.localId,
    expectedRevision: entry.revision,
    event: { ...entry.item, title: 'Porch show moved' },
  }, context)
  assert.equal(updated.changed, true)
  assertAttached(customEventItems(updated.document, { ...context, durability: 'session-only' })[0])

  const restored = reduceCustomEventState(empty, {
    type: 'add',
    event: event('replacement-local-id'),
  }, context)
  assert.equal(restored.changed, true)
  assertAttached(customEventItems(restored.document, { ...context, durability: 'session-only' })[0])

  const reserved = reduceCustomEventState(empty, {
    type: 'add',
    event: event('reserved-local-id', { title: 'c', start: '2026-07-21' }),
  }, context)
  const reservedSession = customEventItems(reserved.document, { ...context, durability: 'session-only' })[0]
  const reservedRef = slotRefOf(reservedSession)
  assert.equal(reservedRef.aliases.some((alias) => alias === 'c|2026-07-21'), false)
  const reservedDurable = customEventItems(reserved.document, { ...context, durability: 'durable' })[0]
  assert.equal(resolvePlannerSlot(
    reservedRef,
    createPlannerCatalog({ customEvents: [reservedDurable] }),
  ).status, 'live')
})

test('applied mutations and persistence retry require the exact requested effect', async () => {
  const addedStore = createActionStore()
  const addActions = createCustomEventActions(addedStore, {
    city: CITY,
    createLocalId: () => 'payload-local-id',
  })
  addedStore.setDispatchOverride((command) => addedStore.applyCommand({
    ...command,
    event: { ...command.event, title: 'Substituted add' },
  }))
  const substitutedAdd = await addActions.add(event(null, {
    title: 'Requested add',
    start: '2026-08-25',
  }))
  assert.equal(substitutedAdd.code, 'custom-event-result-inconsistent')
  assert.equal(substitutedAdd.changed, false)

  const updateStore = createActionStore({
    initial: [event('update-local-id', { title: 'Before update' })],
  })
  const updateActions = createCustomEventActions(updateStore, { city: CITY })
  updateStore.setDispatchOverride((command) => updateStore.applyCommand({
    ...command,
    event: { ...command.event, title: 'Substituted update' },
  }))
  const substitutedUpdate = await updateActions.update(updateStore.getItems()[0], {
    ...updateStore.getItems()[0],
    title: 'Requested update',
  })
  assert.equal(substitutedUpdate.code, 'custom-event-result-inconsistent')
  assert.equal(substitutedUpdate.changed, false)

  const importStore = createActionStore()
  const importActions = createCustomEventActions(importStore, { city: CITY })
  importStore.setDispatchOverride((command) => importStore.applyCommand({
    ...command,
    events: command.events.map((item) => ({ ...item, title: 'Substituted import' })),
  }))
  const substitutedImport = await importActions.importEvents([
    event('import-payload-id', { title: 'Requested import', start: '2026-08-26' }),
  ])
  assert.equal(substitutedImport.code, 'custom-event-result-inconsistent')
  assert.equal(substitutedImport.changed, false)

  const retryStore = createActionStore({ durability: 'session-only' })
  const retryActions = createCustomEventActions(retryStore, { city: CITY })
  retryStore.setRetryOverride((snapshot) => ({
    ok: true,
    code: 'rebase-conflict',
    changed: true,
    persisted: false,
    durability: 'session-only',
    concurrency: snapshot.concurrency,
  }))
  const falseRetry = await retryActions.retry()
  assert.equal(falseRetry.code, 'custom-event-result-inconsistent')
  assert.equal(falseRetry.changed, false)

  retryStore.setRetryOverride((snapshot) => ({
    ok: true,
    code: 'persisted',
    changed: true,
    persisted: false,
    durability: 'session-only',
    concurrency: snapshot.concurrency,
  }))
  assert.equal((await retryActions.retry()).code, 'custom-event-result-inconsistent')

  retryStore.setRetryOverride((snapshot) => ({
    ok: true,
    code: 'nothing-to-retry',
    changed: false,
    persisted: false,
    durability: 'session-only',
    concurrency: snapshot.concurrency,
  }))
  assert.equal((await retryActions.retry()).code, 'custom-event-result-inconsistent')

  const durableRetryStore = createActionStore()
  durableRetryStore.setRetryOverride((snapshot) => ({
    ok: true,
    code: 'session-only',
    changed: true,
    persisted: true,
    durability: 'durable',
    concurrency: snapshot.concurrency,
  }))
  const durableRetryActions = createCustomEventActions(durableRetryStore, { city: CITY })
  assert.equal(
    (await durableRetryActions.retry()).code,
    'custom-event-result-inconsistent',
  )
})

test('session-only add, update, and remove resolve privately without leaking c|', async () => {
  const store = createActionStore({ durability: 'session-only' })
  const actions = createCustomEventActions(store, {
    city: CITY,
    createLocalId: () => 'session-local-id',
  })

  const added = await actions.add(event(null))
  assert.equal(added.code, 'added')
  assert.equal(added.changed, true)
  assert.equal(added.persisted, false)
  assert.equal(added.durability, 'session-only')
  assert.equal(added.item.localId, undefined)
  assert.doesNotMatch(primaryKeyOf(added.item), /^c\|/)
  assert.equal(Object.hasOwn(added, 'snapshot'), false)
  assert.doesNotMatch(JSON.stringify(added), /c\|session-local-id/)

  const updated = await actions.update(added.item, {
    ...added.item,
    title: 'Porch show moved',
  })
  assert.equal(updated.code, 'updated')
  assert.equal(updated.item.title, 'Porch show moved')
  assert.equal(updated.item.localId, undefined)
  assert.equal(store.commands[1].localId, 'session-local-id')
  assert.doesNotMatch(JSON.stringify(updated), /c\|session-local-id/)

  const removed = await actions.remove(added.item)
  assert.equal(removed.code, 'deleted')
  assert.equal(removed.changed, true)
  assert.equal(removed.item.title, 'Porch show moved')
  assert.equal(removed.item.localId, undefined)
  assert.equal(store.commands[2].localId, 'session-local-id')
  assert.deepEqual(store.getItems(), [])
  assert.doesNotMatch(JSON.stringify(removed), /c\|session-local-id/)
})

test('import and retry await store outcomes while unavailable actions fail explicitly', async () => {
  const store = createActionStore()
  const actions = createCustomEventActions(store, { city: CITY })
  const imported = await actions.importEvents([
    event('imported-local-id', { title: 'Imported', start: '2026-08-24' }),
  ])
  assert.equal(imported.code, 'import-merged')
  assert.equal(imported.changed, true)
  assert.equal(Object.hasOwn(imported, 'snapshot'), false)

  const retried = await actions.retry()
  assert.equal(retried.code, 'nothing-to-retry')
  assert.equal(retried.ok, true)
  assert.equal(Object.hasOwn(retried, 'snapshot'), false)

  store.setStatus('idle')
  const commandCount = store.commands.length
  const unavailable = await actions.remove(store.getItems()[0])
  assert.equal(unavailable.code, 'custom-events-unavailable')
  assert.equal(unavailable.ok, false)
  assert.equal(store.commands.length, commandCount)
})

test('provider source gates projections and builds every command from the live store', () => {
  assert.match(
    source,
    /if \(!isUsableCustomEventsStatus\(baseStatus\)\)[\s\S]*items: EMPTY_ITEMS/,
  )
  assert.match(source, /command = store\.addCommand\(candidate\)/)
  assert.match(source, /command = store\.updateCommand\(resolved\.entry\.item\.localId, candidate\)/)
  assert.match(source, /command = store\.deleteCommand\(resolved\.entry\.item\.localId\)/)
  assert.match(source, /command = store\.importCommand\(events, options\)/)
  assert.match(source, /result = await store\.dispatch\(command\)/)
  assert.match(source, /result = await store\.retryPersistence\(\)/)
  assert.match(
    source,
    /!isUsableCustomEventsStatus\(status\)\s*\?\s*storeSnapshot\.error\s*:\s*null/,
  )
})
