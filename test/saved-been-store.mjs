import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SAVED_BEEN_BEEN_CAP,
  SAVED_BEEN_COMMAND_MAX_BYTES,
  SAVED_BEEN_IMPORT_MAX_BYTES,
  addSaved,
  emptySavedBeenState,
  markBeen,
  savedBeenStateBytes,
} from '../app/src/saved-been-state-core.js'
import {
  SAVED_BEEN_STORAGE_KEY,
  SAVED_BEEN_STORE_ID,
  captureSavedBeenV1Source,
  createSavedBeenStore,
  savedBeenAddCommand,
  savedBeenArchiveCommand,
  savedBeenImportCommand,
  savedBeenMarkCommand,
  savedBeenRemoveCommand,
  savedBeenToggleCommand,
  savedBeenUnmarkCommand,
  validateSavedBeenDocument,
} from '../app/src/saved-been-store.js'
import { identityRefOf } from '../app/src/identity.js'

const CITY = Object.freeze({ id: 'tampa-bay', tz: 'America/New_York' })
const OTHER_CITY = Object.freeze({ id: 'sf-east-bay', tz: 'America/Los_Angeles' })

function event(index = 1) {
  return {
    id: index.toString(16).padStart(16, '0'),
    title: `Event ${index}`,
    start: `2026-08-${String((index % 20) + 1).padStart(2, '0')}T19:00:00-04:00`,
    url: `https://example.test/events/${index}`,
  }
}

function customEvent() {
  return {
    kind: 'custom',
    localId: 'custom-event-0001',
    title: 'Porch show',
    start: '2026-08-10T20:00:00-04:00',
    source: 'Added by you',
  }
}

const place = Object.freeze({
  kind: 'place',
  key: 'p|riverwalk',
  title: 'Riverwalk',
})

const guide = Object.freeze({
  kind: 'guide',
  id: 'date-night',
  title: 'Date night',
})

function createMemoryStorage() {
  const values = new Map()
  return {
    values,
    factory: ({ cityId }) => ({
      set(key, value) {
        values.set(`${cityId}:${key}`, value)
        return true
      },
      peekDurable(key) {
        const physical = `${cityId}:${key}`
        return values.has(physical)
          ? { status: 'ok', value: values.get(physical), source: 'durable' }
          : { status: 'missing', value: null, source: null }
      },
    }),
  }
}

function createLockManager() {
  return {
    request(_name, _options, callback) {
      return callback()
    },
  }
}

function createIds(prefix = 'saved-test') {
  let count = 0
  return () => `${prefix}-${++count}`
}

function retainedCapture(source, onCapture = () => {}) {
  const evidence = {
    savedEvents: {
      key: 'saved-events-v1',
      status: 'ok',
      source: 'legacy',
      value: JSON.stringify(source.savedEvents),
    },
    beenThere: {
      key: 'been-there-v1',
      status: 'ok',
      source: 'legacy',
      value: JSON.stringify(source.beenThere),
    },
  }
  return ({ city, domain }) => {
    onCapture({ city, domain })
    return { source, evidence }
  }
}

function makeStore({
  storage = createMemoryStorage(),
  city = CITY,
  capture,
  lockManager = createLockManager(),
  contextId = `context-${city.id}`,
  events = [],
  customEvents = [],
  places = [],
  guides = [],
  seeds = [],
} = {}) {
  return {
    storage,
    store: createSavedBeenStore({
      city,
      events,
      customEvents,
      places,
      guides,
      seeds,
      capture,
      storageFactory: storage.factory,
      lockManager,
      eventTarget: null,
      createId: createIds(contextId),
      contextId,
      now: () => 1_800_000_000_000,
    }),
  }
}

test('adapter constants and validator enforce the exact city-bound document contract', () => {
  assert.equal(SAVED_BEEN_STORAGE_KEY, 'saved-been-v2')
  assert.equal(SAVED_BEEN_STORE_ID, 'saved-been')
  const empty = emptySavedBeenState(CITY.id)
  assert.deepEqual(validateSavedBeenDocument(empty, CITY.id), empty)
  assert.equal(validateSavedBeenDocument(empty, OTHER_CITY.id), null)
  assert.equal(validateSavedBeenDocument({ ...empty, ignored: true }, CITY.id), null)

  const disguised = { ...empty, ignored: true }
  Object.defineProperty(disguised, 'toJSON', {
    enumerable: false,
    value: () => empty,
  })
  assert.equal(validateSavedBeenDocument(disguised, CITY.id), null)

  let accessorReads = 0
  const accessor = { ...empty }
  Object.defineProperty(accessor, 'rev', {
    enumerable: true,
    get() {
      accessorReads += 1
      return 0
    },
  })
  assert.equal(validateSavedBeenDocument(accessor, CITY.id), null)
  assert.equal(accessorReads, 0)
  assert.equal(validateSavedBeenDocument(
    Object.assign(Object.create({ inherited: true }), empty),
    CITY.id,
  ), null)
})

test('strict saved capture returns exact source plus raw evidence without mutation', () => {
  const source = { savedEvents: {}, beenThere: [] }
  const before = structuredClone(source)
  const calls = []
  const captured = captureSavedBeenV1Source({
    city: CITY,
    capture: retainedCapture(source, (call) => calls.push(call)),
  })

  assert.deepEqual(calls, [{ city: CITY, domain: 'saved' }])
  assert.equal(captured.source, source)
  assert.equal(captured.context.evidence.savedEvents.value, '{}')
  assert.deepEqual(source, before)
  assert.throws(() => captureSavedBeenV1Source({
    city: CITY,
    capture: () => ({ source }),
  }), /source and evidence/)
})

test('command builders emit bounded kind-correct item evidence and exact optimistic tokens', () => {
  const items = [event(1), customEvent(), place, guide]
  const commands = items.map((item, index) => savedBeenAddCommand(item, {
    savedAt: index + 1,
  }))
  assert.deepEqual(
    commands.map((command) => command.ref.kind),
    ['event', 'custom', 'place', 'guide'],
  )
  assert.ok(commands.every((command) => savedBeenStateBytes(command) < SAVED_BEEN_COMMAND_MAX_BYTES))
  assert.ok(commands.every((command) => !('catalog' in command)))

  const record = { ref: commands[0].ref, snapshot: commands[0].snapshot, token: 7 }
  assert.deepEqual(savedBeenRemoveCommand(record), {
    type: 'remove',
    ref: commands[0].ref,
    expectedToken: 7,
  })
  assert.equal(savedBeenRemoveCommand({ ...record, token: 0 }), null)
  assert.equal(savedBeenToggleCommand(event(2), { savedAt: 9 }).type, 'toggle')
  assert.deepEqual(savedBeenArchiveCommand(record, { archivedAt: 10 }), {
    type: 'archive-saved',
    ref: commands[0].ref,
    archivedAt: 10,
    expectedSaveToken: 7,
    expectedBeenToken: null,
  })
  assert.equal(savedBeenArchiveCommand(
    { ref: commands[3].ref, token: 8 },
    { archivedAt: 10 },
  ), null)

  const mark = savedBeenMarkCommand(event(1), {
    status: 'went',
    statusAt: 11,
    savedRecord: record,
  })
  assert.equal(mark.expectedSaveToken, 7)
  assert.equal(mark.expectedBeenToken, null)
  assert.equal('item' in mark, false)
  assert.equal(savedBeenMarkCommand(event(1), {
    status: 'went',
    statusAt: 11,
    savedRecord: {
      ref: savedBeenAddCommand(event(2), { savedAt: 1 }).ref,
      token: 7,
    },
  }), null)
  const beenRecord = { ref: commands[0].ref, token: 12 }
  assert.equal(savedBeenUnmarkCommand(beenRecord).expectedToken, 12)
})

test('default initialization migrates strict V1 provenance and existing destination wins', async () => {
  const listed = event(10)
  const custom = customEvent()
  const listedLegacy = identityRefOf(listed).aliases.find((alias) => alias !== identityRefOf(listed).primary)
  const customLegacy = identityRefOf(custom).aliases.find((alias) => alias !== identityRefOf(custom).primary)
  const source = {
    savedEvents: {
      [listedLegacy]: { savedAt: 1, snapshot: listed },
      [customLegacy]: { savedAt: 2, snapshot: custom },
      [place.key]: { savedAt: 3, snapshot: place },
      'g|date-night': { savedAt: 4, snapshot: guide },
    },
    beenThere: [],
  }
  const before = structuredClone(source)
  const calls = []
  const storage = createMemoryStorage()
  const { store } = makeStore({
    storage,
    capture: retainedCapture(source, (call) => calls.push(call)),
    events: [listed],
    customEvents: [custom],
    places: [place],
    guides: [guide],
    contextId: 'migration-first',
  })
  let emissions = 0
  store.subscribe(() => { emissions += 1 })
  const forgedEvidence = {
    savedEvents: {
      key: 'saved-events-v1',
      status: 'ok',
      source: 'destination',
      value: JSON.stringify(source.savedEvents),
    },
    beenThere: {
      key: 'been-there-v1',
      status: 'ok',
      source: 'destination',
      value: JSON.stringify(source.beenThere),
    },
  }
  const initialized = await store.initialize({
    migrationContext: { evidence: forgedEvidence },
  })

  assert.equal(initialized.ok, true)
  assert.equal(initialized.persisted, true)
  assert.equal(store.getSnapshot().durability, 'durable')
  assert.deepEqual(
    store.getSnapshot().document.saved.map((record) => record.ref.kind),
    ['event', 'custom', 'place', 'guide'],
  )
  assert.equal(store.getSnapshot().envelope.migration.sourceSummary.status, 'verified')
  assert.equal(store.getSnapshot().envelope.migration.sourceSummary.savedEvents.source, 'legacy')
  assert.deepEqual(source, before)
  assert.deepEqual(calls, [{ city: CITY, domain: 'saved' }])
  assert.ok(emissions >= 1)
  store.destroy()

  const second = makeStore({
    storage,
    capture: () => { throw new Error('existing destination must skip capture') },
    contextId: 'migration-second',
  }).store
  const existing = await second.initialize()
  assert.equal(existing.code, 'existing-destination')
  assert.equal(existing.persisted, true)
  assert.equal(second.getSnapshot().document.saved.length, 4)
  second.destroy()
})

test('atomic commands dedupe and mark went removes the matching save in one durable commit', async () => {
  const item = event(20)
  const source = { savedEvents: {}, beenThere: [] }
  const { store } = makeStore({
    capture: retainedCapture(source),
    events: [item],
    contextId: 'atomic-mark',
  })
  let emissions = 0
  store.subscribe(() => { emissions += 1 })
  await store.initialize()
  const add = { ...savedBeenAddCommand(item, { savedAt: 1 }), opId: 'save-once' }
  const saved = await store.dispatch(add)
  assert.equal(saved.changed, true)
  assert.equal(saved.persisted, true)
  const duplicateOp = await store.dispatch(add)
  assert.equal(duplicateOp.code, 'duplicate-op')
  const duplicateSave = await store.dispatch(savedBeenAddCommand(item, { savedAt: 2 }))
  assert.equal(duplicateSave.code, 'already-saved')

  const record = store.getSnapshot().document.saved[0]
  const marked = await store.dispatch(savedBeenMarkCommand(item, {
    status: 'went',
    statusAt: 3,
    savedRecord: record,
  }))
  assert.equal(marked.changed, true)
  assert.equal(marked.persisted, true)
  assert.equal(store.getSnapshot().document.saved.length, 0)
  assert.equal(store.getSnapshot().document.been.length, 1)
  assert.equal(store.getSnapshot().document.been[0].status, 'went')

  const importedItem = event(21)
  const incoming = addSaved(emptySavedBeenState(CITY.id), {
    item: importedItem,
    savedAt: 4,
  }).document
  const importCommand = savedBeenImportCommand(incoming)
  assert.ok(savedBeenStateBytes(importCommand) < SAVED_BEEN_COMMAND_MAX_BYTES)
  const imported = await store.dispatch(importCommand)
  assert.equal(imported.code, 'imported')
  assert.equal(store.getSnapshot().document.saved.length, 1)
  const repeatedImport = await store.dispatch(importCommand)
  assert.equal(repeatedImport.code, 'nothing-imported')
  assert.ok(emissions >= 4)
  store.destroy()
})

test('archive replay rejects Been ABA and never removes the newer saved truth', async () => {
  const item = event(30)
  const { store } = makeStore({
    capture: retainedCapture({ savedEvents: {}, beenThere: [] }),
    events: [item],
    contextId: 'archive-aba',
  })
  await store.initialize()
  await store.dispatch(savedBeenAddCommand(item, { savedAt: 1 }))
  const savedRecord = store.getSnapshot().document.saved[0]
  const staleArchive = savedBeenArchiveCommand(savedRecord, { archivedAt: 2 })
  const answered = await store.dispatch(savedBeenMarkCommand(item, {
    status: 'missed',
    statusAt: 3,
    savedRecord,
  }))
  assert.equal(answered.changed, true)

  const conflict = await store.dispatch(staleArchive)
  assert.equal(conflict.code, 'been-conflict')
  assert.equal(store.getSnapshot().document.saved.length, 1)
  assert.equal(store.getSnapshot().document.been[0].status, 'missed')
  store.destroy()
})

test('cap and import bounds fail explicitly without partial state', async () => {
  let full = emptySavedBeenState(CITY.id)
  for (let index = 1; index <= SAVED_BEEN_BEEN_CAP; index += 1) {
    full = markBeen(full, {
      item: event(index + 1000),
      status: 'missed',
      statusAt: index,
    }).document
  }
  const { store } = makeStore({ contextId: 'been-cap' })
  await store.initialize({ source: full })
  const before = store.getSnapshot().document
  const capped = await store.dispatch(savedBeenMarkCommand(event(9999), {
    status: 'went',
    statusAt: 999,
  }))
  assert.equal(capped.code, 'been-cap-reached')
  assert.equal(store.getSnapshot().document.rev, before.rev)
  assert.equal(store.getSnapshot().document.been.length, SAVED_BEEN_BEEN_CAP)
  store.destroy()

  let large = emptySavedBeenState(CITY.id)
  for (let index = 1; savedBeenStateBytes(large) <= SAVED_BEEN_IMPORT_MAX_BYTES; index += 1) {
    large = addSaved(large, {
      item: { ...event(index + 20_000), description: 'x'.repeat(7000) },
      savedAt: index,
    }).document
  }
  assert.ok(savedBeenStateBytes(large) > SAVED_BEEN_IMPORT_MAX_BYTES)
  assert.equal(savedBeenImportCommand(large), null)
})

test('city destinations isolate and no-lock writes remain explicitly session-only', async () => {
  const storage = createMemoryStorage()
  const tampa = makeStore({ storage, contextId: 'city-tampa' }).store
  const sf = makeStore({ storage, city: OTHER_CITY, contextId: 'city-sf' }).store
  await tampa.initialize({ source: emptySavedBeenState(CITY.id) })
  await sf.initialize({ source: emptySavedBeenState(OTHER_CITY.id) })
  assert.notEqual(tampa.physicalKey, sf.physicalKey)
  assert.equal(storage.values.size, 2)
  tampa.destroy()
  sf.destroy()

  const sessionStorage = createMemoryStorage()
  const session = makeStore({
    storage: sessionStorage,
    lockManager: null,
    contextId: 'no-lock',
  }).store
  const initialized = await session.initialize({ source: emptySavedBeenState(CITY.id) })
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(initialized.persisted, false)
  assert.equal(initialized.durability, 'session-only')
  assert.equal(initialized.concurrency, 'session-only-no-lock')
  const added = await session.dispatch(savedBeenAddCommand(event(40), { savedAt: 1 }))
  assert.equal(added.changed, true)
  assert.equal(added.persisted, false)
  assert.equal(added.durability, 'session-only')
  assert.equal(sessionStorage.values.size, 0)
  session.destroy()
})
