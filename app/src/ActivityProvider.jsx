/* eslint-disable react-refresh/only-export-components --
   retained-activity pure helpers intentionally live with their context owner. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useArtifact } from './artifacts.js'
import { CITY } from './city.js'
import { useCustomEvents } from './CustomEventsProvider.jsx'
import { identitySeedsForCity } from './identity-seeds.js'
import {
  activityExclusionKeys,
  activityRefOf,
  emptyActivityState,
  normalizeActivityState,
  recordActivityRef,
  resolveActivityRefs as resolveRefs,
} from './activity-state-core.js'
import {
  activityClearDecksCommand,
  activityRecordCommand,
  captureActivityV1Source,
  createActivityStore,
} from './activity-store.js'
import { replaceTransferStoreDocument } from './state-transfer-store.js'

const ActivityContext = createContext(null)
const EMPTY_ROWS = Object.freeze([])
const EMPTY_STORE_SNAPSHOT = Object.freeze({
  status: 'idle',
  cityId: null,
  document: null,
  envelope: null,
  durability: 'unknown',
  concurrency: 'none',
  pendingOps: EMPTY_ROWS,
  error: null,
  recovery: null,
})
const USABLE_STATUSES = new Set(['durable', 'session-only'])
const EVENT_READY_STATUSES = new Set(['ready', 'empty'])
const RECORD_CODES = new Set(['recorded', 'already-current'])
const CLEAR_CODES = new Set(['cleared-decks', 'already-empty'])
const RETRY_REPLAY_CODES = new Set(['recorded', 'cleared-decks'])
const RETRY_CODES = new Set([
  'persisted',
  'session-only',
  'nothing-to-retry',
  ...RETRY_REPLAY_CODES,
])
const RETRY_CHANGED_CODES = new Set([
  'persisted',
  'session-only',
  ...RETRY_REPLAY_CODES,
])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function canonicalJson(value) {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function publicIssue(value, fallbackCode) {
  const code = typeof value?.code === 'string' && value.code ? value.code : fallbackCode
  const detail = typeof value?.detail === 'string' && value.detail
    ? value.detail
    : typeof value?.message === 'string' && value.message
      ? value.message
      : null
  return Object.freeze({ code, ...(detail ? { detail } : {}) })
}

function usableStoreSnapshot(snapshot) {
  const usableDurability = snapshot?.status === 'ready'
    ? ['durable', 'session-only'].includes(snapshot?.durability)
    : snapshot?.status === 'error' && snapshot?.durability === 'session-only'
  return usableDurability
    && isObject(snapshot?.document)
    && Array.isArray(snapshot.document.recents)
    && Array.isArray(snapshot.document.eventDeck)
    && Array.isArray(snapshot.document.placeDeck)
}

function storeSnapshotOrEmpty(store) {
  try {
    return store?.getSnapshot?.() || EMPTY_STORE_SNAPSHOT
  } catch {
    return EMPTY_STORE_SNAPSHOT
  }
}

function currentView(store) {
  const snapshot = storeSnapshotOrEmpty(store)
  return usableStoreSnapshot(snapshot) ? snapshot : null
}

function validStore(store) {
  return isObject(store) && [
    'destroy',
    'dispatch',
    'getSnapshot',
    'initialize',
    'retryPersistence',
    'subscribe',
  ].every((method) => typeof store[method] === 'function')
}

function actionFailure(code, snapshot = EMPTY_STORE_SNAPSHOT, detail = null) {
  return Object.freeze({
    ok: false,
    code,
    changed: false,
    persisted: false,
    durability: typeof snapshot?.durability === 'string' ? snapshot.durability : 'unknown',
    concurrency: typeof snapshot?.concurrency === 'string' ? snapshot.concurrency : 'none',
    applied: false,
    ...(detail ? { error: publicIssue({ code, detail }, code) } : {}),
  })
}

function publicActionResult(value, snapshot, { applied = false } = {}) {
  if (!isObject(value)
      || typeof value.ok !== 'boolean'
      || typeof value.code !== 'string'
      || typeof value.changed !== 'boolean'
      || typeof value.persisted !== 'boolean'
      || typeof value.durability !== 'string'
      || typeof value.concurrency !== 'string') {
    return actionFailure('activity-result-invalid', snapshot)
  }
  return Object.freeze({
    ok: value.ok,
    code: value.code,
    changed: value.changed,
    persisted: value.persisted,
    durability: typeof value.durability === 'string'
      ? value.durability
      : snapshot?.durability || 'unknown',
    concurrency: typeof value.concurrency === 'string'
      ? value.concurrency
      : snapshot?.concurrency || 'none',
    applied,
  })
}

function projectRef(ref) {
  const cloned = cloneJson(ref)
  return cloned ? deepFreeze(cloned) : null
}

export function projectActivityDocument(document, { cityId } = {}) {
  const normalized = normalizeActivityState(document, { cityId })
  if (!normalized) return null
  const project = (rows) => rows.map(projectRef)
  const recents = project(normalized.recents)
  const eventDeck = project(normalized.eventDeck)
  const placeDeck = project(normalized.placeDeck)
  if ([...recents, ...eventDeck, ...placeDeck].some((row) => !row)) return null
  return Object.freeze({
    recents: Object.freeze(recents),
    eventDeck: Object.freeze(eventDeck),
    placeDeck: Object.freeze(placeDeck),
  })
}

export function activityPublicStatus({ lifecycle, storeSnapshot, runtimeError = null } = {}) {
  const snapshot = storeSnapshot || EMPTY_STORE_SNAPSHOT
  if (runtimeError || lifecycle?.phase === 'error') return 'error'
  if (!lifecycle || ['idle', 'initializing'].includes(lifecycle.phase)) return 'initializing'
  if (lifecycle.phase !== 'ready') return 'error'
  if (snapshot.status === 'corrupt') return 'corrupt'
  if (usableStoreSnapshot(snapshot) && snapshot.durability === 'session-only') return 'session-only'
  if (usableStoreSnapshot(snapshot) && snapshot.durability === 'durable') return 'durable'
  return 'error'
}

export function isUsableActivityStatus(status) {
  return USABLE_STATUSES.has(status)
}

export function activityCatalogUnlocked(current, {
  eventStatus,
  customReady,
} = {}) {
  return current === true || (EVENT_READY_STATUSES.has(eventStatus) && customReady === true)
}

function createCatalogLatch(ready) {
  let unlocked = ready === true
  const listeners = new Set()
  return Object.freeze({
    getSnapshot: () => unlocked,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    observe(next) {
      if (unlocked || next !== true) return
      unlocked = true
      for (const listener of [...listeners]) listener()
    },
  })
}

export function activityExclusionReadModel(document, {
  cityId,
  collection,
  items,
  seeds,
  kind,
}) {
  const rawKeys = activityExclusionKeys(document, { cityId, collection })
  const resolved = resolveRefs(document?.[collection], items, { kind, seeds })
  const owners = new Map()
  const addOwner = (alias, primary) => {
    if (!owners.has(alias)) owners.set(alias, new Set())
    owners.get(alias).add(primary)
  }
  for (const item of Array.isArray(items) ? items : EMPTY_ROWS) {
    const ref = activityRefOf(item, { kind })
    if (!ref) continue
    for (const alias of ref.aliases) addOwner(alias, ref.primary)
  }
  const keys = []
  const seen = new Set()
  const primaries = []
  const primarySet = new Set()
  for (const item of resolved) {
    const ref = activityRefOf(item, { kind })
    if (!ref) continue
    if (!primarySet.has(ref.primary)) {
      primarySet.add(ref.primary)
      primaries.push(ref.primary)
    }
    for (const alias of ref?.aliases || []) {
      const aliasOwners = owners.get(alias)
      if (alias !== ref.primary
          && (aliasOwners?.size !== 1 || !aliasOwners.has(ref.primary))) continue
      if (seen.has(alias)) continue
      seen.add(alias)
      keys.push(alias)
    }
  }
  // A retained alias with no live owner is inert today but useful if a later
  // catalog refresh restores that exact identity. Never publish an alias that
  // currently points at multiple rows.
  for (const alias of rawKeys) {
    if (owners.has(alias) || seen.has(alias)) continue
    seen.add(alias)
    keys.push(alias)
  }
  return Object.freeze({
    keys: Object.freeze(keys),
    primaries: Object.freeze(primaries),
  })
}

export function activityItemExcluded(model, item, kind) {
  const ref = activityRefOf(item, { kind })
  return Boolean(ref && model?.primaries?.includes(ref.primary))
}

export function resolveRecentRefs(refs, events, { seeds = EMPTY_ROWS } = {}) {
  return resolveRefs(refs, events, { kind: 'event', seeds })
}

function expectedReduction(document, command, cityId) {
  if (command?.type === 'record') {
    return recordActivityRef(document, {
      cityId,
      collection: command.collection,
      ref: command.ref,
    })
  }
  if (command?.type === 'clear-decks') {
    if (!document.eventDeck.length && !document.placeDeck.length) {
      return { document, changed: false, code: 'already-empty' }
    }
    return {
      document: { ...document, eventDeck: [], placeDeck: [] },
      changed: true,
      code: 'cleared-decks',
    }
  }
  return null
}

function pendingRows(snapshot) {
  return Array.isArray(snapshot?.pendingOps) ? snapshot.pendingOps : EMPTY_ROWS
}

function operationReceipted(snapshot, opIds, { currentCommit = false } = {}) {
  if (!Array.isArray(opIds) || opIds.length === 0 || opIds.some((opId) => typeof opId !== 'string' || !opId)) {
    return false
  }
  const recentOps = snapshot?.envelope?.recentOps
  const commitOps = snapshot?.envelope?.commit?.opIds
  if (!Array.isArray(recentOps) || !opIds.every((opId) => recentOps.includes(opId))) return false
  return !currentCommit || (Array.isArray(commitOps) && opIds.every((opId) => commitOps.includes(opId)))
}

function commandReplayCode(command) {
  if (command?.type === 'record') return 'recorded'
  if (command?.type === 'clear-decks') return 'cleared-decks'
  return null
}

function terminalCode(command) {
  if (command?.type === 'record') return 'already-current'
  if (command?.type === 'clear-decks') return 'already-empty'
  return null
}

function resultMatches(raw, before, after, command, expected) {
  if (!isObject(raw) || !before || !after || !expected) return false
  if (typeof raw.ok !== 'boolean'
      || typeof raw.changed !== 'boolean'
      || typeof raw.persisted !== 'boolean'
      || typeof raw.durability !== 'string'
      || typeof raw.concurrency !== 'string') return false
  if (raw.code !== expected.code || raw.changed !== expected.changed) return false
  const durable = after.durability === 'durable'
  // Reducer success and persistence are different facts. A valid no-op is
  // successful even while an earlier operation is still session-only.
  if (raw.ok !== (expected.changed ? durable : true)) return false
  if (raw.durability !== after.durability
      || raw.persisted !== durable
      || raw.concurrency !== after.concurrency) return false
  if (command.type === 'record' && !RECORD_CODES.has(raw.code)) return false
  if (command.type === 'clear-decks' && !CLEAR_CODES.has(raw.code)) return false
  if (!expected.changed) {
    // Atomic no-ops do not publish. Requiring the complete retained snapshot to
    // stay fixed prevents a forged "already" result from smuggling a mutation.
    return canonicalJson(after.document) === canonicalJson(before.document)
      && canonicalJson(after.envelope) === canonicalJson(before.envelope)
      && canonicalJson(pendingRows(after)) === canonicalJson(pendingRows(before))
  }

  // Every accepted mutation carries the store's exact operation receipt. This
  // single rule covers both the ordinary path and a legitimate cross-tab
  // rebase, whose resulting document may also contain collateral state.
  const opId = typeof raw.opId === 'string' && raw.opId ? raw.opId : null
  const received = opId && operationReceipted(after, [opId], { currentCommit: true })
  const terminal = expectedReduction(after.document, command, before.document.cityId)
  return Boolean(received
    && terminal?.changed === false
    && terminal.code === terminalCode(command))
}

function retryResultMatches(raw, before, after, rememberedCommands) {
  if (!after
      || !isObject(raw)
      || typeof raw.ok !== 'boolean'
      || typeof raw.code !== 'string'
      || typeof raw.changed !== 'boolean'
      || typeof raw.persisted !== 'boolean'
      || typeof raw.durability !== 'string'
      || typeof raw.concurrency !== 'string'
      || !RETRY_CODES.has(raw.code)) return false
  const beforeRows = Array.isArray(before.pendingOps) ? before.pendingOps : null
  const beforePending = beforeRows?.length ?? -1
  const afterRows = Array.isArray(after.pendingOps) ? after.pendingOps : null
  const afterPending = afterRows?.length ?? -1
  // The generic atomic-store snapshot intentionally redacts command payloads,
  // retaining only each pending record's kind and operation ID. A retry of an
  // activity command therefore proves its product code from the store result,
  // bounded to the two activity reducer outcomes, while initialization retries
  // must still use the generic persistence codes.
  const commandRows = beforeRows?.filter((row) => row?.kind === 'command') || EMPTY_ROWS
  const commandsKnown = commandRows.length > 0 && commandRows.every((row) => (
    typeof row?.opId === 'string' && rememberedCommands.has(row.opId)
  ))
  const lastCommand = commandsKnown
    ? rememberedCommands.get(commandRows.at(-1).opId)
    : null
  const expectedCode = lastCommand
    ? commandReplayCode(lastCommand)
    : after.durability === 'durable' ? 'persisted' : 'session-only'
  if (raw.code === 'nothing-to-retry') {
    return beforePending === 0
      && afterPending === 0
      && raw.changed === false
      && raw.ok === (after.durability === 'durable')
      && raw.persisted === (after.durability === 'durable')
      && raw.durability === after.durability
      && raw.concurrency === after.concurrency
      && canonicalJson(before.document) === canonicalJson(after.document)
      && canonicalJson(before.envelope) === canonicalJson(after.envelope)
  }
  const durable = after.durability === 'durable'
  const pendingShapeMatches = durable
    ? afterPending === 0
    : canonicalJson(beforeRows) === canonicalJson(afterRows)
  const baseMatches = before.durability === 'session-only'
    && beforePending > 0
    && raw.code === expectedCode
    && raw.changed === RETRY_CHANGED_CODES.has(raw.code)
    && raw.ok === durable
    && raw.persisted === durable
    && raw.durability === after.durability
    && raw.concurrency === after.concurrency
    && pendingShapeMatches
  if (!baseMatches) return false

  if (commandRows.length === 0) {
    // Initialization-only retries have no replay command to prove; their
    // product document must therefore remain byte-identical.
    return !RETRY_REPLAY_CODES.has(raw.code)
      && canonicalJson(before.document) === canonicalJson(after.document)
  }
  if (!commandsKnown || !RETRY_REPLAY_CODES.has(raw.code)) return false

  const opIds = commandRows.map((row) => row.opId)
  if (raw.code !== commandReplayCode(lastCommand)
      || !operationReceipted(after, opIds, { currentCommit: true })) return false
  const terminal = expectedReduction(after.document, lastCommand, before.document.cityId)
  return terminal?.changed === false && terminal.code === terminalCode(lastCommand)
}

export function createActivityActions(store, {
  cityId,
  isAvailable = null,
  onSessionRecent = null,
} = {}) {
  let tail = Promise.resolve()
  const rememberedCommands = new Map()
  const enqueue = (work) => {
    const run = tail.then(work, work)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
  const availableView = () => {
    if (!validStore(store)) return null
    if (typeof isAvailable === 'function' && isAvailable() !== true) return null
    return currentView(store)
  }
  const unavailable = () => actionFailure('activity-unavailable', storeSnapshotOrEmpty(store))
  const syncRememberedCommands = (after, raw = null, command = null) => {
    const active = new Set(pendingRows(after)
      .filter((row) => row?.kind === 'command' && typeof row.opId === 'string')
      .map((row) => row.opId))
    for (const opId of [...rememberedCommands.keys()]) {
      if (!active.has(opId)) rememberedCommands.delete(opId)
    }
    if (command && typeof raw?.opId === 'string' && active.has(raw.opId)) {
      const cloned = cloneJson(command)
      if (cloned) rememberedCommands.set(raw.opId, deepFreeze(cloned))
    }
  }
  const record = (collection, item) => enqueue(async () => {
    const before = availableView()
    if (!before) return unavailable()
    const command = activityRecordCommand(collection, item)
    if (!command) return actionFailure('activity-command-unavailable', before)
    const expected = expectedReduction(before.document, command, cityId)
    let raw
    try {
      raw = await store.dispatch(command)
    } catch (error) {
      return actionFailure('activity-result-invalid', currentView(store) || before, error?.message)
    }
    const after = currentView(store)
    if (!resultMatches(raw, before, after, command, expected)) {
      return actionFailure('activity-result-inconsistent', after || before)
    }
    syncRememberedCommands(after, raw, command)
    const result = publicActionResult(raw, after, { applied: true })
    if (result.code === 'activity-result-invalid') return result
    if (collection === 'recents' && typeof onSessionRecent === 'function') {
      onSessionRecent(command.ref)
    }
    return result
  })

  return Object.freeze({
    recordView(item) {
      return record('recents', item)
    },
    recordEventDeck(item) {
      return record('eventDeck', item)
    },
    recordPlaceDeck(item) {
      return record('placeDeck', item)
    },
    clearDeckMemories() {
      return enqueue(async () => {
        const before = availableView()
        if (!before) return unavailable()
        const command = activityClearDecksCommand()
        const expected = expectedReduction(before.document, command, cityId)
        let raw
        try {
          raw = await store.dispatch(command)
        } catch (error) {
          return actionFailure('activity-result-invalid', currentView(store) || before, error?.message)
        }
        const after = currentView(store)
        if (!resultMatches(raw, before, after, command, expected)) {
          return actionFailure('activity-result-inconsistent', after || before)
        }
        syncRememberedCommands(after, raw, command)
        return publicActionResult(raw, after, { applied: true })
      })
    },
    retry() {
      return enqueue(async () => {
        const before = availableView()
        if (!before) return unavailable()
        let raw
        try {
          raw = await store.retryPersistence()
        } catch (error) {
          return actionFailure('activity-result-invalid', currentView(store) || before, error?.message)
        }
        const after = currentView(store)
        if (!retryResultMatches(raw, before, after, rememberedCommands)) {
          return actionFailure('activity-result-inconsistent', after || before)
        }
        syncRememberedCommands(after)
        return publicActionResult(raw, after, { applied: raw.changed === true })
      })
    },
  })
}

function createStoreHolder() {
  let snapshot = Object.freeze({
    store: null,
    lifecycle: Object.freeze({ phase: 'initializing', error: null }),
  })
  const listeners = new Set()
  const publish = (store, phase, error = null) => {
    snapshot = Object.freeze({
      store,
      lifecycle: Object.freeze({ phase, error }),
    })
    for (const listener of [...listeners]) listener()
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    begin(store) { publish(store, 'initializing') },
    ready(store) {
      if (snapshot.store === store) publish(store, 'ready')
    },
    fail(store, error) {
      if (snapshot.store === store) publish(store, 'error', error)
    },
    failCreation(error) {
      if (snapshot.store === null) publish(null, 'error', error)
    },
    clear(store) {
      if (snapshot.store === store) publish(null, 'initializing')
    },
  })
}

function CityActivityProvider({
  children,
  city,
  events,
  customEvents,
  places,
  seeds,
  catalogReady,
  catalogError,
  storeFactory,
  sourceCapture,
}) {
  const [holder] = useState(createStoreHolder)
  const [selectedCity] = useState(() => ({ id: city.id, tz: city.tz }))
  const [catalogLatch] = useState(() => createCatalogLatch(catalogReady))
  const [sessionRecentRefs, setSessionRecentRefs] = useState(EMPTY_ROWS)
  const storeFactoryRef = useRef(storeFactory)
  const sourceCaptureRef = useRef(sourceCapture)
  const catalogRef = useRef({ events, customEvents, places, seeds })

  useEffect(() => {
    catalogRef.current = { events, customEvents, places, seeds }
  }, [customEvents, events, places, seeds])

  useEffect(() => {
    catalogLatch.observe(catalogReady)
  }, [catalogLatch, catalogReady])
  const catalogUnlocked = useSyncExternalStore(
    catalogLatch.subscribe,
    catalogLatch.getSnapshot,
    catalogLatch.getSnapshot,
  )

  useEffect(() => {
    if (!catalogUnlocked) return undefined
    let active = true
    let store = null
    try {
      const catalogs = catalogRef.current
      store = storeFactoryRef.current({ city: selectedCity })
      if (!validStore(store)) throw new TypeError('storeFactory must return an activity store')
      holder.begin(store)
      Promise.resolve()
        .then(() => store.initialize({
          sourceFactory: () => sourceCaptureRef.current({ city: selectedCity }),
          migrationContext: catalogs,
        }))
        .then(() => {
          if (!active || holder.getSnapshot().store !== store) return
          const snapshot = store.getSnapshot()
          if (['ready', 'corrupt', 'error'].includes(snapshot.status)) holder.ready(store)
          else holder.fail(store, publicIssue(null, 'activity-initialize-incomplete'))
        })
        .catch((error) => {
          if (!active || holder.getSnapshot().store !== store) return
          holder.fail(store, publicIssue(error, 'activity-provider-initialize-failed'))
        })
    } catch (error) {
      holder.failCreation(publicIssue(error, 'activity-store-create-failed'))
    }
    return () => {
      active = false
      holder.clear(store)
      store?.destroy?.()
    }
  }, [catalogUnlocked, holder, selectedCity])

  const holderSnapshot = useSyncExternalStore(
    holder.subscribe,
    holder.getSnapshot,
    holder.getSnapshot,
  )
  const store = holderSnapshot.store
  const subscribeStore = useCallback(
    (listener) => store ? store.subscribe(listener) : () => {},
    [store],
  )
  const getStoreSnapshot = useCallback(
    () => store ? storeSnapshotOrEmpty(store) : EMPTY_STORE_SNAPSHOT,
    [store],
  )
  const storeSnapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot,
  )
  const dependencyError = !catalogUnlocked && catalogError
    ? publicIssue(catalogError, 'activity-catalog-unavailable')
    : null
  const baseStatus = activityPublicStatus({
    lifecycle: holderSnapshot.lifecycle,
    storeSnapshot,
    runtimeError: holderSnapshot.lifecycle.error || dependencyError,
  })
  const projection = useMemo(() => {
    if (!isUsableActivityStatus(baseStatus)) {
      return { ok: true, recents: EMPTY_ROWS, eventDeck: EMPTY_ROWS, placeDeck: EMPTY_ROWS }
    }
    const projected = projectActivityDocument(storeSnapshot.document, { cityId: selectedCity.id })
    return projected
      ? { ok: true, ...projected }
      : { ok: false, recents: EMPTY_ROWS, eventDeck: EMPTY_ROWS, placeDeck: EMPTY_ROWS }
  }, [baseStatus, selectedCity.id, storeSnapshot.document])
  const status = projection.ok ? baseStatus : 'error'
  const error = !projection.ok
    ? publicIssue(null, 'activity-projection-invalid')
    : dependencyError
      || holderSnapshot.lifecycle.error
      || (!isUsableActivityStatus(status) ? storeSnapshot.error : null)
      || (['corrupt', 'error'].includes(status)
        ? publicIssue(null, `activity-${status}`)
        : null)

  const addSessionRecent = useCallback((ref) => {
    setSessionRecentRefs((current) => {
      const document = {
        ...emptyActivityState(selectedCity.id),
        recents: current,
      }
      const reduced = recordActivityRef(document, {
        cityId: selectedCity.id,
        collection: 'recents',
        ref,
      })
      const projected = projectActivityDocument(reduced.document, { cityId: selectedCity.id })
      return projected?.recents || current
    })
  }, [selectedCity.id])
  const actions = useMemo(() => createActivityActions(store, {
    cityId: selectedCity.id,
    isAvailable: () => {
      const current = holder.getSnapshot()
      return current.store === store && current.lifecycle.phase === 'ready'
    },
    onSessionRecent: addSessionRecent,
  }), [addSessionRecent, holder, selectedCity.id, store])
  const eventCatalog = useMemo(
    () => [...events, ...customEvents],
    [customEvents, events],
  )
  const eventExclusionModel = useMemo(() => activityExclusionReadModel(storeSnapshot.document, {
    cityId: selectedCity.id,
    collection: 'eventDeck',
    items: eventCatalog,
    seeds,
    kind: 'event',
  }), [eventCatalog, seeds, selectedCity.id, storeSnapshot.document])
  const placeExclusionModel = useMemo(() => activityExclusionReadModel(storeSnapshot.document, {
    cityId: selectedCity.id,
    collection: 'placeDeck',
    items: places,
    seeds,
    kind: 'place',
  }), [places, seeds, selectedCity.id, storeSnapshot.document])
  const resolveCurrentRecentRefs = useCallback(
    (refs = projection.recents, catalog = eventCatalog) => (
      resolveRecentRefs(refs, catalog, { seeds })
    ),
    [eventCatalog, projection.recents, seeds],
  )
  const retry = actions.retry
  const replaceDocument = useCallback(
    (document, options) => replaceTransferStoreDocument(store, document, options),
    [store],
  )
  const eventDeckExclusions = eventExclusionModel.keys
  const placeDeckExclusions = placeExclusionModel.keys
  const value = useMemo(() => ({
    phase: isUsableActivityStatus(status) ? 'ready' : status,
    status,
    ready: isUsableActivityStatus(status),
    durability: storeSnapshot.durability,
    error,
    recovery: storeSnapshot.recovery,
    document: storeSnapshot.document,
    transferCommitId: storeSnapshot.durability === 'durable'
      ? storeSnapshot.envelope?.commit?.id || null
      : null,
    retainedRecentRefs: projection.recents,
    recentRefs: projection.recents,
    sessionRecentRefs,
    eventDeckExclusions,
    placeDeckExclusions,
    isEventDeckExcluded: (item) => activityItemExcluded(eventExclusionModel, item, 'event'),
    isPlaceDeckExcluded: (item) => activityItemExcluded(placeExclusionModel, item, 'place'),
    resolveRecentRefs: resolveCurrentRecentRefs,
    recordView: actions.recordView,
    recordEventDeck: actions.recordEventDeck,
    recordPlaceDeck: actions.recordPlaceDeck,
    clearDeckMemories: actions.clearDeckMemories,
    retry,
    retryPersistence: retry,
    replaceDocument,
  }), [
    actions.clearDeckMemories,
    actions.recordEventDeck,
    actions.recordPlaceDeck,
    actions.recordView,
    error,
    eventDeckExclusions,
    eventExclusionModel,
    placeDeckExclusions,
    placeExclusionModel,
    projection.recents,
    resolveCurrentRecentRefs,
    retry,
    replaceDocument,
    sessionRecentRefs,
    status,
    storeSnapshot.document,
    storeSnapshot.durability,
    storeSnapshot.envelope,
    storeSnapshot.recovery,
  ])

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
}

export function ActivityProvider({
  children,
  city = CITY,
  events: eventOverride,
  eventStatus: eventStatusOverride,
  eventError: eventErrorOverride,
  customEvents: customOverride,
  customReady: customReadyOverride,
  customError: customErrorOverride,
  places: placeOverride,
  seeds: seedOverride,
  storeFactory = createActivityStore,
  sourceCapture = captureActivityV1Source,
}) {
  const eventArtifact = useArtifact('events')
  const placeArtifact = useArtifact('places', false)
  const custom = useCustomEvents()
  const events = Array.isArray(eventOverride)
    ? eventOverride
    : Array.isArray(eventArtifact.data) ? eventArtifact.data : EMPTY_ROWS
  const eventStatus = eventStatusOverride || eventArtifact.status
  const eventError = eventErrorOverride === undefined ? eventArtifact.error : eventErrorOverride
  const customEvents = Array.isArray(customOverride) ? customOverride : custom.items
  const customReady = customReadyOverride === undefined ? custom.ready : customReadyOverride
  const customError = customErrorOverride === undefined ? custom.error : customErrorOverride
  const places = Array.isArray(placeOverride)
    ? placeOverride
    : Array.isArray(placeArtifact.data) ? placeArtifact.data : EMPTY_ROWS
  const seeds = useMemo(
    () => Array.isArray(seedOverride) ? seedOverride : identitySeedsForCity(city.id),
    [city.id, seedOverride],
  )
  const unlocked = activityCatalogUnlocked(false, { eventStatus, customReady })
  const catalogError = !EVENT_READY_STATUSES.has(eventStatus)
    && !['idle', 'loading'].includes(eventStatus)
    ? (eventError || { code: `events-${eventStatus}` })
    : !customReady && custom.status !== 'initializing'
      ? (customError || { code: `custom-events-${custom.status}` })
      : null
  const cityKey = `${city.id}:${city.tz}`
  return (
    <CityActivityProvider
      key={cityKey}
      city={city}
      events={events}
      customEvents={customEvents}
      places={places}
      seeds={seeds}
      catalogReady={unlocked}
      catalogError={catalogError}
      storeFactory={storeFactory}
      sourceCapture={sourceCapture}
    >
      {children}
    </CityActivityProvider>
  )
}

export function useActivity() {
  const value = useContext(ActivityContext)
  if (!value) throw new Error('useActivity must be used within ActivityProvider')
  return value
}
