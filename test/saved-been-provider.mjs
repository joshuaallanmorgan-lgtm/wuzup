import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'

import {
  customEventItems,
  emptyCustomEventState,
  reduceCustomEventState,
} from '../app/src/custom-event-state-core.js'
import {
  emptySavedBeenState,
  reduceSavedBeenState,
} from '../app/src/saved-been-state-core.js'
import { customIdentityBridgeOf } from '../app/src/identity.js'
import {
  savedBeenAddCommand,
} from '../app/src/saved-been-store.js'

const CITY = Object.freeze({ id: 'tampa-bay', tz: 'America/New_York' })
const source = await readFile(
  new URL('../app/src/SavedBeenProvider.jsx', import.meta.url),
  'utf8',
)
const vite = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})
const providerModule = await vite.ssrLoadModule('/src/SavedBeenProvider.jsx')
after(() => vite.close())

const {
  createSavedBeenActions,
  hydrateSavedBeenRecords,
  isUsableSavedBeenStatus,
  projectSavedBeenDocument,
  savedBeenCatalogUnlocked,
  savedBeenPublicStatus,
  savedBeenRecordFor,
  savedBeenResolutionFor,
  savedBeenToggleResolutionFor,
} = providerModule

function event(id = '0123456789abcdef', overrides = {}) {
  return {
    id,
    title: 'Porch show',
    start: '2026-08-21T20:00:00',
    ...overrides,
  }
}

function place(key = 'p|museum', overrides = {}) {
  return { kind: 'place', key, name: 'City museum', ...overrides }
}

function guide(id = 'weekend', overrides = {}) {
  return { kind: 'guide', id, title: 'Weekend guide', ...overrides }
}

function customProjections(localId = 'custom-1234', overrides = {}) {
  const base = emptyCustomEventState(CITY.id, { timeZone: CITY.tz })
  const added = reduceCustomEventState(base, {
    type: 'add',
    event: {
      localId,
      title: 'Custom porch show',
      start: '2026-08-22T20:00:00',
      ...overrides,
    },
  }, { cityId: CITY.id, timeZone: CITY.tz })
  assert.equal(added.changed, true, added.code)
  return {
    document: added.document,
    durable: customEventItems(added.document, {
      cityId: CITY.id,
      timeZone: CITY.tz,
      durability: 'durable',
    })[0],
    session: customEventItems(added.document, {
      cityId: CITY.id,
      timeZone: CITY.tz,
      durability: 'session-only',
    })[0],
  }
}

function beenInput(item, status = 'missed', statusAt = 2000) {
  const added = reduceSavedBeenState(
    emptySavedBeenState(CITY.id),
    savedBeenAddCommand(item, { savedAt: 1000 }),
  )
  assert.equal(added.changed, true, added.code)
  const record = added.document.saved[0]
  return {
    ref: record.ref,
    snapshot: record.snapshot,
    status,
    statusAt,
  }
}

function createActionStore({
  durability = 'durable',
  initialSaved = [],
  initialBeen = [],
} = {}) {
  let document = emptySavedBeenState(CITY.id)
  let currentDurability = durability
  let status = 'ready'
  let dispatchOverride = null
  let retryOverride = null
  let destroyed = false
  const listeners = new Set()
  const commands = []
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const apply = (command) => {
    const reduced = reduceSavedBeenState(document, command)
    if (reduced.changed) {
      document = reduced.document
      emit()
    }
    return reduced
  }
  for (const item of initialSaved) {
    const command = savedBeenAddCommand(item, { savedAt: 1000 + document.rev })
    const reduced = apply(command)
    assert.equal(reduced.changed, true, `invalid saved seed: ${reduced.code}`)
  }
  for (const row of initialBeen) {
    const saved = document.saved.find((record) => record.ref.primary === row.ref.primary)
    const reduced = apply({
      type: 'mark-been',
      ref: row.ref,
      snapshot: row.snapshot,
      status: row.status,
      statusAt: row.statusAt,
      expectedSaveToken: saved?.token ?? null,
      expectedBeenToken: null,
    })
    assert.equal(reduced.changed, true, `invalid Been seed: ${reduced.code}`)
  }
  const snapshot = () => ({
    status,
    cityId: CITY.id,
    document,
    envelope: { document },
    durability: currentDurability,
    concurrency: currentDurability === 'durable' ? 'web-lock' : 'session-only-no-lock',
    pendingOps: currentDurability === 'durable' ? [] : [{ kind: 'command', opId: 'pending' }],
    error: currentDurability === 'durable' ? null : { code: 'storage-unavailable' },
    recovery: currentDurability === 'durable'
      ? null
      : { code: 'retry-persistence', canRetry: true },
  })
  const result = (reduced) => ({
    ok: currentDurability === 'durable',
    code: reduced.code,
    changed: reduced.changed === true,
    persisted: currentDurability === 'durable',
    durability: currentDurability,
    concurrency: snapshot().concurrency,
    snapshot: snapshot(),
  })
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
      return result(apply(command))
    },
    async retryPersistence() {
      if (retryOverride) return retryOverride(snapshot(), apply)
      if (currentDurability === 'durable') {
        return result({ code: 'nothing-to-retry', changed: false })
      }
      currentDurability = 'durable'
      emit()
      return result({ code: 'persisted', changed: true })
    },
    destroy() {
      destroyed = true
      listeners.clear()
    },
    setStatus(value) { status = value },
    setDurability(value) { currentDurability = value },
    setDispatchOverride(value) { dispatchOverride = value },
    setRetryOverride(value) { retryOverride = value },
    wasDestroyed: () => destroyed,
  }
}

test('provider is city-keyed, effect-owned, catalog-gated, and StrictMode-cleaned', () => {
  const effectIndex = source.indexOf('useEffect(() => {')
  const constructionIndex = source.indexOf('store = storeFactoryRef.current({ city: selectedCity, ...catalogs })')
  assert.ok(effectIndex >= 0 && constructionIndex > effectIndex)
  assert.match(source, /useSyncExternalStore/g)
  assert.match(source, /const cityKey = `\$\{city\.id\}:\$\{timeZone\}`/)
  assert.match(source, /key=\{cityKey\}/)
  assert.match(source, /createCatalogLatch/)
  assert.match(source, /if \(!catalogUnlocked\) return undefined/)
  assert.match(source, /store\.initialize\(\)/)
  assert.match(source, /store\.destroy\(\)/)
  assert.doesNotMatch(source, /useMemo\([^\n]*createSavedBeenStore/)
  assert.doesNotMatch(source, /useState\([^\n]*createSavedBeenStore/)
  assert.doesNotMatch(source, /captureSavedBeenV1Source|saved-events-v1|been-there-v1/)
})

test('public status distinguishes initialization, durability, corruption, and errors', () => {
  const ready = { status: 'ready', durability: 'durable', document: { saved: [], been: [] } }
  assert.equal(savedBeenPublicStatus({ lifecycle: { phase: 'initializing' }, storeSnapshot: ready }), 'initializing')
  assert.equal(savedBeenPublicStatus({ lifecycle: { phase: 'ready' }, storeSnapshot: ready }), 'durable')
  assert.equal(savedBeenPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: { ...ready, durability: 'session-only' },
  }), 'session-only')
  assert.equal(savedBeenPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: { ...ready, status: 'corrupt', durability: 'unknown' },
  }), 'corrupt')
  assert.equal(savedBeenPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: ready,
    runtimeError: { code: 'provider-failed' },
  }), 'error')
  assert.equal(isUsableSavedBeenStatus('durable'), true)
  assert.equal(isUsableSavedBeenStatus('session-only'), true)
  assert.equal(isUsableSavedBeenStatus('corrupt'), false)

  assert.equal(savedBeenCatalogUnlocked(false, { ready: false }), false)
  assert.equal(savedBeenCatalogUnlocked(false, { ready: true }), true)
  assert.equal(
    savedBeenCatalogUnlocked(true, { ready: false, error: { code: 'refresh-failed' } }),
    true,
    'later catalog churn cannot relock or destroy an initialized city store',
  )

  assert.equal(savedBeenPublicStatus({
    lifecycle: { phase: 'ready' },
    storeSnapshot: {
      ...ready,
      status: 'error',
      durability: 'session-only',
      pendingOps: [{ kind: 'command' }],
    },
  }), 'session-only', 'a retained session document remains visible after transient read failure')
})

test('public records are detached, legacy-friendly, and kind-correctly hydrated', () => {
  let document = emptySavedBeenState(CITY.id)
  const inputs = [
    event(),
    { ...event(null, { id: undefined }), kind: 'custom', localId: 'custom-1234' },
    place(),
    guide(),
  ]
  for (let index = 0; index < inputs.length; index += 1) {
    const command = savedBeenAddCommand(inputs[index], { savedAt: 1000 + index })
    const reduced = reduceSavedBeenState(document, command)
    assert.equal(reduced.changed, true, reduced.code)
    document = reduced.document
  }
  const projected = projectSavedBeenDocument(document)
  assert.equal(projected.saved.length, 4)
  assert.equal(projected.saved.every((record) => typeof record.key === 'string'), true)
  assert.equal(projected.saved.every((record) => !Object.hasOwn(record, 'token')), true)
  assert.notEqual(projected.saved, document.saved)
  assert.notEqual(projected.saved[0], document.saved[0])

  inputs[0].tags = ['music']
  const catalogBytes = JSON.stringify(inputs[0])
  const hydrated = hydrateSavedBeenRecords(projected.saved, {
    events: [inputs[0]],
    customEvents: [inputs[1]],
    places: [inputs[2]],
    guides: [inputs[3]],
  })
  assert.deepEqual(hydrated.map((row) => row.kind), ['event', 'custom', 'place', 'guide'])
  assert.equal(hydrated.every((row) => row.source === 'live' && row.available), true)
  assert.equal(Object.isFrozen(inputs[0]), false)
  assert.equal(Object.isFrozen(inputs[0].tags), false)
  assert.equal(JSON.stringify(inputs[0]), catalogBytes, 'hydration cannot mutate borrowed catalogs')

  const snapshotOnly = hydrateSavedBeenRecords(projected.saved, {})
  assert.equal(snapshotOnly.every((row) => row.source === 'snapshot' && row.available), true)
})

test('event ID drift resolves through unique kind-scoped aliases and current actions remove the retained row', async () => {
  const oldTrain = event('36ec15d158ebe5f0', {
    title: 'Train',
    url: 'https://example.com/events/train',
    start: '2026-09-12T20:00:00-04:00',
  })
  const currentTrain = event('e742c347c9f31d72', {
    kind: 'event',
    status: 'scheduled',
    title: 'Train',
    url: oldTrain.url,
    start: oldTrain.start,
  })
  const store = createActionStore({ initialSaved: [oldTrain] })
  const projected = projectSavedBeenDocument(store.getSnapshot().document)

  const resolution = savedBeenResolutionFor(projected.saved, currentTrain)
  assert.equal(resolution.status, 'resolved')
  assert.equal(resolution.record, projected.saved[0])
  assert.equal(savedBeenRecordFor(projected.saved, currentTrain), projected.saved[0])

  const hydrated = hydrateSavedBeenRecords(projected.saved, { events: [currentTrain] })
  assert.equal(hydrated[0].source, 'live')
  assert.equal(hydrated[0].item, currentTrain)
  assert.equal(hydrated[0].identityStatus, 'attached')

  const removed = await createSavedBeenActions(store).toggleSaved(currentTrain)
  assert.equal(removed.code, 'removed')
  assert.equal(removed.saved, false)
  assert.equal(store.commands.length, 1)
  assert.equal(store.commands[0].ref.primary, `e|${oldTrain.id}`)
  assert.equal(store.getSnapshot().document.saved.length, 0)

  const markStore = createActionStore({ initialSaved: [oldTrain] })
  const marked = await createSavedBeenActions(markStore).markBeen(currentTrain, {
    status: 'went',
    statusAt: 12_000,
  })
  assert.equal(marked.code, 'marked-been')
  assert.equal(marked.status, 'went')
  assert.equal(markStore.getSnapshot().document.saved.length, 0)
  assert.equal(markStore.getSnapshot().document.been[0].ref.primary, `e|${oldTrain.id}`)
})

test('historical seeds bridge chained ID drift but never become live candidates', async () => {
  const first = event('1111111111111111', {
    url: 'https://example.com/events/train-v1',
    start: '2026-09-12T20:00:00-04:00',
  })
  const current = event('2222222222222222', {
    url: 'https://example.com/events/train-v2',
    start: '2026-09-12T20:00:00-04:00',
  })
  const store = createActionStore({ initialSaved: [first] })
  const projected = projectSavedBeenDocument(store.getSnapshot().document)
  const seeds = [{
    kind: 'event',
    primary: `e|${current.id}`,
    aliases: [`e|${current.id}`, `e|${first.id}`],
  }]

  assert.equal(
    savedBeenResolutionFor(projected.saved, current, { seeds }).record,
    projected.saved[0],
  )
  assert.equal(
    savedBeenResolutionFor(projected.saved, current, { seeds: [], evidenceRecords: seeds }).status,
    'resolved',
    'retained alias-ledger evidence can bridge identities without becoming a candidate',
  )
  const hydrated = hydrateSavedBeenRecords(projected.saved, {
    events: [current],
    seeds,
  })
  assert.equal(hydrated[0].source, 'live')
  assert.equal(hydrated[0].item, current)

  const withoutInventory = hydrateSavedBeenRecords(projected.saved, { seeds })
  assert.equal(withoutInventory[0].source, 'snapshot')
  assert.equal(withoutInventory[0].item.id, first.id)

  const removed = await createSavedBeenActions(store, { seeds }).toggleSaved(current)
  assert.equal(removed.code, 'removed')
  assert.equal(store.commands[0].ref.primary, `e|${first.id}`)
})

test('duplicate weak aliases are explicit ambiguity and mutations refuse without first-win', async () => {
  const weak = {
    title: 'Train',
    url: 'https://example.com/events/shared-train',
    start: '2026-09-12T20:00:00-04:00',
  }
  const first = event('3333333333333333', weak)
  const second = event('4444444444444444', weak)
  const current = event('5555555555555555', weak)
  const store = createActionStore({ initialSaved: [first, second] })
  const projected = projectSavedBeenDocument(store.getSnapshot().document)

  assert.equal(savedBeenRecordFor(projected.saved, current), null)
  assert.equal(savedBeenResolutionFor(projected.saved, current).status, 'ambiguous')
  const hydrated = hydrateSavedBeenRecords(projected.saved, { events: [current] })
  assert.equal(hydrated.every((row) => row.source === 'snapshot'), true)
  assert.equal(hydrated.every((row) => row.identityStatus === 'ambiguous'), true)

  const actions = createSavedBeenActions(store)
  const refused = await actions.toggleSaved(current)
  assert.equal(refused.code, 'saved-been-identity-ambiguous')
  assert.equal(refused.changed, false)
  assert.equal(store.commands.length, 0)
  assert.equal(store.getSnapshot().document.saved.length, 2)

  const explicitRemoval = await actions.removeSaved(projected.saved[0])
  assert.equal(explicitRemoval.code, 'removed')
  assert.equal(store.getSnapshot().document.saved.length, 1)
})

test('stale explicit retained refs are exact-only and cannot remove an alias-related replacement', async () => {
  const weak = {
    title: 'Train',
    url: 'https://example.com/events/aba-train',
    start: '2026-09-12T20:00:00-04:00',
  }
  const first = event('8888888888888888', weak)
  const replacement = event('9999999999999999', weak)
  const store = createActionStore({ initialSaved: [first] })
  const stale = projectSavedBeenDocument(store.getSnapshot().document).saved[0]
  const actions = createSavedBeenActions(store, { now: () => 9000 })

  assert.equal((await actions.removeSaved(stale)).code, 'removed')
  assert.equal((await actions.toggleSaved(replacement)).code, 'saved')
  const refused = await actions.removeSaved(stale)
  assert.equal(refused.code, 'not-saved')
  assert.equal(refused.changed, false)
  assert.equal(store.commands.length, 2)
  assert.equal(store.getSnapshot().document.saved[0].ref.primary, `e|${replacement.id}`)
})

test('cross-collection alias disagreement is review-required, never reconciled implicitly', async () => {
  const weak = {
    title: 'Train',
    url: 'https://example.com/events/cross-collection-train',
    start: '2026-09-12T20:00:00-04:00',
  }
  const savedItem = event('aaaaaaaaaaaaaaaa', weak)
  const beenItem = event('bbbbbbbbbbbbbbbb', weak)
  const seedDocument = reduceSavedBeenState(
    emptySavedBeenState(CITY.id),
    savedBeenAddCommand(beenItem, { savedAt: 1000 }),
  ).document
  const beenSeed = seedDocument.saved[0]
  const store = createActionStore({
    initialSaved: [savedItem],
    initialBeen: [{
      ref: beenSeed.ref,
      snapshot: beenSeed.snapshot,
      status: 'missed',
      statusAt: 2000,
    }],
  })
  const explicitSaved = projectSavedBeenDocument(store.getSnapshot().document).saved[0]
  const result = await createSavedBeenActions(store).archiveSaved(explicitSaved, {
    archivedAt: 3000,
  })
  assert.equal(result.code, 'saved-been-identity-ambiguous')
  assert.equal(result.changed, false)
  assert.equal(store.commands.length, 0)
  assert.equal(store.getSnapshot().document.saved.length, 1)
  assert.equal(store.getSnapshot().document.been.length, 1)
})

test('toggle anchors to unique Been identity and refuses went or ambiguous cross-collection truth', async () => {
  const weak = {
    title: 'Train',
    url: 'https://example.com/events/toggle-been-train',
    start: '2026-09-12T20:00:00-04:00',
  }
  const retained = event('1212121212121212', weak)
  const current = event('3434343434343434', weak)

  const missedStore = createActionStore({
    initialBeen: [beenInput(retained, 'missed')],
  })
  const missedProjection = projectSavedBeenDocument(missedStore.getSnapshot().document)
  const missedUi = savedBeenToggleResolutionFor(
    missedProjection.saved,
    missedProjection.been,
    current,
  )
  assert.equal(missedUi.status, 'missing')
  assert.equal(missedUi.canToggle, true)
  assert.equal(missedUi.beenStatus, 'missed')
  const saved = await createSavedBeenActions(missedStore).toggleSaved(current, {
    savedAt: 5000,
  })
  assert.equal(saved.code, 'saved')
  assert.equal(saved.saved, true)
  assert.equal(missedStore.commands.length, 1)
  assert.equal(missedStore.commands[0].ref.primary, `e|${retained.id}`)
  assert.equal(missedStore.getSnapshot().document.saved[0].ref.primary, `e|${retained.id}`)
  assert.equal(missedStore.getSnapshot().document.saved[0].snapshot.id, current.id)

  const wentStore = createActionStore({
    initialBeen: [beenInput(retained, 'went')],
  })
  const wentProjection = projectSavedBeenDocument(wentStore.getSnapshot().document)
  const wentUi = savedBeenToggleResolutionFor(
    wentProjection.saved,
    wentProjection.been,
    current,
  )
  assert.equal(wentUi.status, 'went')
  assert.equal(wentUi.canToggle, false)
  const went = await createSavedBeenActions(wentStore).toggleSaved(current, {
    savedAt: 5000,
  })
  assert.equal(went.code, 'saved-been-went-conflict')
  assert.equal(went.changed, false)
  assert.equal(wentStore.commands.length, 0)
  assert.equal(wentStore.getSnapshot().document.saved.length, 0)

  const ambiguousStore = createActionStore({
    initialBeen: [
      beenInput(event('5656565656565656', weak), 'missed'),
      beenInput(event('7878787878787878', weak), 'missed'),
    ],
  })
  const ambiguousProjection = projectSavedBeenDocument(ambiguousStore.getSnapshot().document)
  const ambiguousUi = savedBeenToggleResolutionFor(
    ambiguousProjection.saved,
    ambiguousProjection.been,
    current,
  )
  assert.equal(ambiguousUi.status, 'ambiguous')
  assert.equal(ambiguousUi.canToggle, false)
  const ambiguous = await createSavedBeenActions(ambiguousStore).toggleSaved(current, {
    savedAt: 5000,
  })
  assert.equal(ambiguous.code, 'saved-been-identity-ambiguous')
  assert.equal(ambiguous.changed, false)
  assert.equal(ambiguousStore.commands.length, 0)

  const conflictingStore = createActionStore({
    initialSaved: [event('9090909090909090', weak)],
    initialBeen: [beenInput(retained, 'missed')],
  })
  const conflictingProjection = projectSavedBeenDocument(conflictingStore.getSnapshot().document)
  const conflictingUi = savedBeenToggleResolutionFor(
    conflictingProjection.saved,
    conflictingProjection.been,
    current,
  )
  assert.equal(conflictingUi.status, 'ambiguous')
  assert.equal(conflictingUi.canToggle, false)
  const conflicting = await createSavedBeenActions(conflictingStore).toggleSaved(current, {
    savedAt: 5000,
  })
  assert.equal(conflicting.code, 'saved-been-identity-ambiguous')
  assert.equal(conflictingStore.commands.length, 0)

  const newItem = event('abababababababab', {
    url: 'https://example.com/events/truly-new',
    start: '2026-11-01T18:00:00-05:00',
  })
  const newStore = createActionStore()
  const newProjection = projectSavedBeenDocument(newStore.getSnapshot().document)
  const newUi = savedBeenToggleResolutionFor(
    newProjection.saved,
    newProjection.been,
    newItem,
  )
  assert.equal(newUi.status, 'missing')
  assert.equal(newUi.canToggle, true)
  const normal = await createSavedBeenActions(newStore).toggleSaved(newItem, {
    savedAt: 5000,
  })
  assert.equal(normal.code, 'saved')
  assert.equal(newStore.getSnapshot().document.saved[0].ref.primary, `e|${newItem.id}`)
})

test('weak aliases never cross event and custom identity domains', () => {
  const weak = {
    title: 'Shared title',
    url: 'https://example.com/events/shared',
    start: '2026-10-01T19:00:00-04:00',
  }
  const retainedEvent = event('6666666666666666', weak)
  const retainedCustom = {
    ...weak,
    kind: 'custom',
    localId: 'custom-domain-1234',
    source: 'Added by you',
  }
  const currentEvent = event('7777777777777777', weak)
  const store = createActionStore({ initialSaved: [retainedEvent, retainedCustom] })
  const projected = projectSavedBeenDocument(store.getSnapshot().document)

  const resolution = savedBeenResolutionFor(projected.saved, currentEvent)
  assert.equal(resolution.status, 'resolved')
  assert.equal(resolution.record.ref.kind, 'event')
  assert.equal(resolution.record.ref.primary, `e|${retainedEvent.id}`)
})

test('opaque custom bridges preserve reads and removal without persisting pending identity', async () => {
  const projections = customProjections('durable-1234', {
    identityAliases: Array.from(
      { length: 6 },
      (_, index) => `old-custom-alias-${index}|2026-08-22T20:00:00`,
    ),
  })
  const store = createActionStore({ initialSaved: [projections.durable] })
  const projected = projectSavedBeenDocument(store.getSnapshot().document)
  assert.equal(projected.saved[0].ref.aliases.some((alias) => /^wuzup:custom-bridge:/.test(alias)), false)
  assert.equal(savedBeenRecordFor(projected.saved, projections.session), projected.saved[0])

  const hydrated = hydrateSavedBeenRecords(projected.saved, {
    customEvents: [projections.session],
  })
  assert.equal(hydrated[0].source, 'live')
  assert.equal(hydrated[0].item, projections.session)

  const actions = createSavedBeenActions(store, { now: () => 9000 })
  const removed = await actions.toggleSaved(projections.session)
  assert.equal(removed.code, 'removed')
  assert.equal(removed.saved, false)

  const directStore = createActionStore({ initialSaved: [projections.durable] })
  const directRemoved = await createSavedBeenActions(directStore).toggleSaved(projections.durable)
  assert.equal(directRemoved.code, 'removed', 'a landed direct c| target still resolves exactly')

  const pending = customProjections('pending-1234')
  const pendingStore = createActionStore()
  const pendingActions = createSavedBeenActions(pendingStore, { now: () => 9000 })
  assert.equal((await pendingActions.toggleSaved(pending.session)).code, 'saved-been-pending-identity')
  assert.equal((await pendingActions.markBeen(pending.session, {
    status: 'went',
    statusAt: 9000,
  })).code, 'saved-been-pending-identity')
  assert.equal(pendingStore.commands.length, 0)
})

test('opaque bridge ambiguity and spoofed session fields fail closed', () => {
  const first = customProjections('first-1234')
  const second = customProjections('second-1234')
  const records = [
    {
      ref: {
        status: 'attached',
        kind: 'custom',
        primary: 'c|first-1234',
        aliases: ['c|first-1234'],
      },
      snapshot: first.durable,
    },
    {
      ref: {
        status: 'attached',
        kind: 'custom',
        primary: 'c|second-1234',
        aliases: ['c|second-1234'],
      },
      snapshot: second.durable,
    },
  ]
  assert.equal(
    savedBeenRecordFor([records[0]], first.session),
    records[0],
    'a direct-c| fallback with no retained legacy alias resolves by its private primary bridge',
  )
  const ambiguous = {
    ...first.session,
    _sessionIdentityAliases: [
      customIdentityBridgeOf('c|first-1234'),
      customIdentityBridgeOf('c|second-1234'),
    ],
  }
  assert.equal(savedBeenRecordFor(records, ambiguous), null)

  const explicit = {
    ref: records[1].ref,
    _sessionLegacyIdentity: first.session._sessionLegacyIdentity,
    _sessionIdentityAliases: first.session._sessionIdentityAliases,
  }
  assert.equal(
    savedBeenRecordFor(records, explicit),
    records[1],
    'an explicit primary wins before spoofable session metadata is considered',
  )
})

test('toggle and removal await exact durable postconditions', async () => {
  const store = createActionStore()
  const actions = createSavedBeenActions(store, { now: () => 5000 })
  const item = event()

  const saved = await actions.toggleSaved(item)
  assert.equal(saved.code, 'saved')
  assert.equal(saved.changed, true)
  assert.equal(saved.applied, true)
  assert.equal(saved.saved, true)
  assert.equal(saved.persisted, true)
  assert.equal(Object.hasOwn(saved, 'snapshot'), false)

  const removed = await actions.toggleSaved(item)
  assert.equal(removed.code, 'removed')
  assert.equal(removed.changed, true)
  assert.equal(removed.saved, false)

  const absent = await actions.removeSaved(item)
  assert.equal(absent.code, 'not-saved')
  assert.equal(absent.applied, false)
  assert.equal(store.commands.length, 2)
})

test('archive, mark, and unmark preserve exact Been postconditions', async () => {
  const item = event()
  const store = createActionStore({ initialSaved: [item] })
  const actions = createSavedBeenActions(store, { now: () => 6000 })

  const archived = await actions.archiveSaved(item)
  assert.equal(archived.code, 'archived')
  assert.equal(archived.saved, false)
  assert.equal(archived.archived, true)

  const marked = await actions.markBeen(item, { status: 'went', statusAt: 7000 })
  assert.equal(marked.code, 'marked-been')
  assert.equal(marked.status, 'went')
  assert.equal(marked.saved, false)

  const repeated = await actions.markBeen(item, { status: 'went', statusAt: 8000 })
  assert.equal(repeated.code, 'already-marked')
  assert.equal(repeated.changed, false)
  assert.equal(repeated.status, 'went')

  const unmarked = await actions.unmarkBeen(item)
  assert.equal(unmarked.code, 'unmarked-been')
  assert.equal(unmarked.status, null)
})

test('session-only mutations are usable, explicit, and retry to durable truth', async () => {
  const store = createActionStore({ durability: 'session-only' })
  const actions = createSavedBeenActions(store, { now: () => 5000 })
  const saved = await actions.toggleSaved(event())
  assert.equal(saved.code, 'saved')
  assert.equal(saved.changed, true)
  assert.equal(saved.saved, true)
  assert.equal(saved.persisted, false)
  assert.equal(saved.durability, 'session-only')

  const retried = await actions.retry()
  assert.equal(retried.code, 'persisted')
  assert.equal(retried.changed, true)
  assert.equal(retried.persisted, true)
  assert.equal(retried.durability, 'durable')
})

test('concurrency conflicts and substituted effects never become success', async () => {
  const item = event()
  const store = createActionStore()
  const actions = createSavedBeenActions(store, { now: () => 5000 })
  store.setDispatchOverride((_command, snapshot) => ({
    ok: true,
    code: 'save-conflict',
    changed: false,
    persisted: true,
    durability: 'durable',
    concurrency: snapshot.concurrency,
  }))
  const conflict = await actions.toggleSaved(item)
  assert.equal(conflict.code, 'save-conflict')
  assert.equal(conflict.ok, false)
  assert.equal(conflict.applied, false)
  assert.equal(conflict.saved, false)

  store.setDispatchOverride((_command, snapshot, apply) => {
    const other = savedBeenAddCommand(event('fedcba9876543210', { title: 'Substituted' }), {
      savedAt: 5000,
    })
    apply(other)
    return {
      ok: true,
      code: 'saved',
      changed: true,
      persisted: true,
      durability: 'durable',
      concurrency: snapshot.concurrency,
    }
  })
  const substituted = await actions.toggleSaved(item)
  assert.equal(substituted.code, 'saved-been-result-inconsistent')
  assert.equal(substituted.applied, false)

  store.setDispatchOverride(() => Object.defineProperty({}, 'code', {
    enumerable: true,
    get() { throw new Error('hostile result') },
  }))
  const hostile = await actions.toggleSaved(event('aaaaaaaaaaaaaaaa'))
  assert.equal(hostile.code, 'saved-been-result-invalid')

  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  store.setDispatchOverride(() => revoked.proxy)
  const revokedResult = await actions.toggleSaved(event('bbbbbbbbbbbbbbbb'))
  assert.equal(revokedResult.code, 'saved-been-result-invalid')
})

test('successful no-change claims require the exact requested postcondition', async () => {
  const absentStore = createActionStore()
  absentStore.setDispatchOverride((_command, snapshot) => ({
    ok: true,
    code: 'already-saved',
    changed: false,
    persisted: true,
    durability: 'durable',
    concurrency: snapshot.concurrency,
  }))
  const falseSaved = await createSavedBeenActions(absentStore, { now: () => 5000 })
    .toggleSaved(event())
  assert.equal(falseSaved.code, 'saved-been-result-inconsistent')
  assert.equal(falseSaved.applied, false)

  const presentStore = createActionStore({ initialSaved: [event()] })
  presentStore.setDispatchOverride((_command, snapshot) => ({
    ok: true,
    code: 'not-saved',
    changed: false,
    persisted: true,
    durability: 'durable',
    concurrency: snapshot.concurrency,
  }))
  const falseRemoved = await createSavedBeenActions(presentStore).removeSaved(event())
  assert.equal(falseRemoved.code, 'saved-been-result-inconsistent')
  assert.equal(falseRemoved.applied, false)
})

test('import and retry reject malformed or contradictory store results', async () => {
  const sourceStore = createActionStore({ initialSaved: [event()] })
  const incoming = sourceStore.getSnapshot().document
  const store = createActionStore()
  const actions = createSavedBeenActions(store, { now: () => 5000 })
  const imported = await actions.importSavedBeen(incoming)
  assert.equal(imported.code, 'imported')
  assert.equal(imported.changed, true)
  assert.equal(Object.hasOwn(imported, 'document'), false)
  assert.equal(Object.hasOwn(imported, 'envelope'), false)

  const collateralImportStore = createActionStore({
    initialSaved: [event('aaaaaaaaaaaaaaaa', { title: 'Keep me' })],
  })
  collateralImportStore.setDispatchOverride((command, snapshot, apply) => {
    apply(command)
    const retained = snapshot.document.saved[0]
    apply({ type: 'remove', ref: retained.ref, expectedToken: retained.token })
    return {
      ok: true,
      code: 'imported',
      changed: true,
      persisted: true,
      durability: 'durable',
      concurrency: snapshot.concurrency,
    }
  })
  assert.equal(
    (await createSavedBeenActions(collateralImportStore).importSavedBeen(incoming)).code,
    'saved-been-result-inconsistent',
    'import cannot hide collateral deletion behind a valid imported row',
  )

  const volatile = createActionStore({ durability: 'session-only' })
  volatile.setRetryOverride((snapshot) => ({
    ok: true,
    code: 'persisted',
    changed: true,
    persisted: false,
    durability: 'session-only',
    concurrency: snapshot.concurrency,
  }))
  const falseRetry = await createSavedBeenActions(volatile).retry()
  assert.equal(falseRetry.code, 'saved-been-result-inconsistent')

  const reducerCodeStore = createActionStore({
    durability: 'session-only',
    initialSaved: [event()],
  })
  reducerCodeStore.setRetryOverride((snapshot) => {
    reducerCodeStore.setDurability('durable')
    return {
      ok: true,
      code: 'saved',
      changed: true,
      persisted: true,
      durability: 'durable',
      concurrency: snapshot.concurrency,
    }
  })
  const landedReducerCode = await createSavedBeenActions(reducerCodeStore).retry()
  assert.equal(landedReducerCode.code, 'saved')
  assert.equal(landedReducerCode.persisted, true)

  const repeatedSessionStore = createActionStore({
    durability: 'session-only',
    initialSaved: [event()],
  })
  repeatedSessionStore.setRetryOverride((snapshot) => ({
    ok: false,
    code: 'saved',
    changed: true,
    persisted: false,
    durability: 'session-only',
    concurrency: snapshot.concurrency,
  }))
  const repeatedSession = await createSavedBeenActions(repeatedSessionStore).retry()
  assert.equal(repeatedSession.code, 'saved')
  assert.equal(repeatedSession.changed, true)
  assert.equal(repeatedSession.durability, 'session-only')

  const collateralStore = createActionStore({
    durability: 'session-only',
    initialSaved: [event()],
  })
  collateralStore.setRetryOverride((snapshot, apply) => {
    apply(savedBeenAddCommand(event('fedcba9876543210'), { savedAt: 7000 }))
    collateralStore.setDurability('durable')
    return {
      ok: true,
      code: 'saved',
      changed: true,
      persisted: true,
      durability: 'durable',
      concurrency: snapshot.concurrency,
    }
  })
  assert.equal(
    (await createSavedBeenActions(collateralStore).retry()).code,
    'saved-been-result-inconsistent',
    'retry cannot silently substitute or add unrelated retained state',
  )
})

test('a transient retry read error preserves the session document and remains recoverable', async () => {
  const store = createActionStore({ durability: 'session-only', initialSaved: [event()] })
  store.setStatus('error')
  store.setRetryOverride((snapshot) => ({
    ok: false,
    code: 'destination-read-failed',
    changed: false,
    persisted: false,
    durability: 'session-only',
    concurrency: snapshot.concurrency,
  }))
  const actions = createSavedBeenActions(store)
  const first = await actions.retry()
  assert.equal(first.code, 'destination-read-failed')
  assert.equal(first.changed, false)

  store.setRetryOverride((snapshot) => {
    store.setStatus('ready')
    store.setDurability('durable')
    return {
      ok: true,
      code: 'saved',
      changed: true,
      persisted: true,
      durability: 'durable',
      concurrency: snapshot.concurrency,
    }
  })
  const recovered = await actions.retry()
  assert.equal(recovered.code, 'saved')
  assert.equal(recovered.persisted, true)
  assert.equal(store.getSnapshot().document.saved.length, 1)
})

test('terminal stores fail closed and source exposes no raw store snapshot', async () => {
  const store = createActionStore()
  const actions = createSavedBeenActions(store)
  store.setStatus('corrupt')
  const unavailable = await actions.toggleSaved(event())
  assert.equal(unavailable.code, 'saved-been-unavailable')
  assert.equal(unavailable.changed, false)
  assert.equal(store.commands.length, 0)

  assert.doesNotMatch(source, /\bstoreSnapshot:\s*storeSnapshot\b/)
  assert.doesNotMatch(source, /\bdocument:\s*storeSnapshot\.document\b/)
  assert.doesNotMatch(source, /\benvelope:\s*storeSnapshot\.envelope\b/)
})
