/* eslint-disable react-refresh/only-export-components --
   the provider contract intentionally co-locates pure status/action helpers
   with its context owner, matching the existing provider seams. */
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
import { CITY } from './city.js'
import { validLocalEventId } from './identity.js'
import {
  captureCustomEventV1Source,
  createCustomEventStore,
} from './custom-event-store.js'
import { reduceCustomEventState } from './custom-event-state-core.js'

const CustomEventsContext = createContext(null)
const EMPTY_ITEMS = Object.freeze([])
const EMPTY_STORE_SNAPSHOT = Object.freeze({
  status: 'idle',
  cityId: null,
  timeZone: null,
  document: null,
  envelope: null,
  durability: 'unknown',
  concurrency: 'none',
  pendingOps: EMPTY_ITEMS,
  error: null,
  recovery: null,
})
const USABLE_STATUSES = new Set(['durable', 'session-only'])
const SUCCESSFUL_NO_CHANGE_CODES = new Set([
  'already-current',
  'duplicate-op',
  'nothing-to-retry',
  'unchanged',
])
const CHANGED_RESULT_CODES = new Set([
  'added',
  'deleted',
  'import-merged',
  'import-replaced',
  'updated',
])
const RETRY_CHANGED_RESULT_CODES = new Set([
  ...CHANGED_RESULT_CODES,
  'persisted',
  'session-only',
])
const LOCAL_ID_ATTEMPTS = 32
const PROJECTION_ONLY_FIELDS = new Set([
  '_keyTitle',
  '_sessionLegacyIdentity',
  '_sessionIdentityAliases',
])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function dataField(value, key) {
  if (!isObject(value)) return { present: false, ok: false, value: undefined }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return { present: false, ok: false, value: undefined }
    return descriptor.enumerable === true
      && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? { present: true, ok: true, value: descriptor.value }
      : { present: true, ok: false, value: undefined }
  } catch {
    return { present: true, ok: false, value: undefined }
  }
}

function copyEventForCommand(value, localId) {
  if (!isObject(value)) return null
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype
        || Object.getOwnPropertySymbols(value).length > 0) return null
    const names = Object.getOwnPropertyNames(value)
    const event = {}
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (descriptor?.enumerable !== true
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null
      if (name === 'localId' || PROJECTION_ONLY_FIELDS.has(name)) continue
      Object.defineProperty(event, name, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    event.localId = localId
    return event
  } catch {
    return null
  }
}

function publicIssue(value, fallbackCode) {
  const code = typeof value?.code === 'string' && value.code
    ? value.code
    : fallbackCode
  const detail = typeof value?.detail === 'string' && value.detail
    ? value.detail
    : null
  return Object.freeze({ code, ...(detail ? { detail } : {}) })
}

function actionFailure(code, snapshot = EMPTY_STORE_SNAPSHOT, detail = null) {
  return Object.freeze({
    ok: false,
    code,
    changed: false,
    persisted: false,
    durability: typeof snapshot?.durability === 'string'
      ? snapshot.durability
      : 'unknown',
    concurrency: typeof snapshot?.concurrency === 'string'
      ? snapshot.concurrency
      : 'none',
    ...(detail ? { error: publicIssue({ code, detail }, code) } : {}),
  })
}

function publicActionResult(value, snapshot = EMPTY_STORE_SNAPSHOT) {
  if (!isObject(value)
      || typeof value.code !== 'string'
      || typeof value.changed !== 'boolean'
      || typeof value.persisted !== 'boolean') {
    return actionFailure('custom-event-result-invalid', snapshot)
  }
  const changed = value.changed === true
  if (CHANGED_RESULT_CODES.has(value.code) && !changed) {
    return actionFailure('custom-event-result-inconsistent', snapshot)
  }
  const ok = value.ok === true
    && (changed || SUCCESSFUL_NO_CHANGE_CODES.has(value.code))
  const result = {
    ok,
    code: value.code,
    changed,
    persisted: value.persisted === true,
    durability: typeof value.durability === 'string'
      ? value.durability
      : snapshot.durability,
    concurrency: typeof value.concurrency === 'string'
      ? value.concurrency
      : snapshot.concurrency,
  }
  if (typeof value.opId === 'string') result.opId = value.opId
  if (value.error) result.error = publicIssue(value.error, value.code)
  if (value.conflict) result.conflict = publicIssue(value.conflict, value.code)
  if (value.rejection) result.rejection = publicIssue(value.rejection, value.code)
  return Object.freeze(result)
}

function withResultItem(result, item) {
  return item ? Object.freeze({ ...result, item }) : result
}

function usableStoreSnapshot(snapshot) {
  return snapshot?.status === 'ready'
    && USABLE_STATUSES.has(snapshot?.durability)
    && isObject(snapshot?.document)
    && Array.isArray(snapshot.document.items)
}

function projectedView(store, snapshot = store?.getSnapshot?.()) {
  if (!usableStoreSnapshot(snapshot) || typeof store?.getItems !== 'function') return null
  try {
    const items = store.getItems()
    return Array.isArray(items) && items.length === snapshot.document.items.length
      ? { snapshot, items }
      : null
  } catch {
    return null
  }
}

function plainStringArray(value) {
  if (!Array.isArray(value)) return []
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype
        || Object.getOwnPropertySymbols(value).length > 0
        || Object.keys(value).length !== value.length) return []
    const out = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor?.enumerable !== true
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || typeof descriptor.value !== 'string') return []
      out.push(descriptor.value)
    }
    return out
  } catch {
    return []
  }
}

function identityEvidence(value) {
  if (typeof value === 'string' && value) {
    return {
      localId: validLocalEventId(value) ? value : null,
      sessionLegacy: null,
      aliases: new Set([value, ...(validLocalEventId(value) ? [`c|${value}`] : [])]),
    }
  }
  if (!isObject(value)) return { localId: null, sessionLegacy: null, aliases: new Set() }

  const localIdField = dataField(value, 'localId')
  const localId = localIdField.ok && validLocalEventId(localIdField.value)
    ? localIdField.value
    : null
  const sessionField = dataField(value, '_sessionLegacyIdentity')
  const sessionLegacy = sessionField.ok
    && typeof sessionField.value === 'string'
    && sessionField.value
    ? sessionField.value
    : null
  const aliases = new Set()
  if (localId) {
    aliases.add(localId)
    aliases.add(`c|${localId}`)
  }
  if (sessionLegacy) aliases.add(sessionLegacy)

  const url = dataField(value, 'url')
  const keyTitle = dataField(value, '_keyTitle')
  const title = dataField(value, 'title')
  const start = dataField(value, 'start')
  const aliasTitle = typeof url.value === 'string' && url.value
    || typeof keyTitle.value === 'string' && keyTitle.value
    || typeof title.value === 'string' && title.value
    || ''
  const aliasStart = typeof start.value === 'string' ? start.value : ''
  if (aliasTitle || aliasStart) aliases.add(`${aliasTitle}|${aliasStart}`)

  const retained = dataField(value, 'identityAliases')
  if (retained.ok) {
    for (const alias of plainStringArray(retained.value)) aliases.add(alias)
  }
  return { localId, sessionLegacy, aliases }
}

function evidenceForEntry(entry, projected) {
  const out = new Set([entry.primary, entry.item.localId, ...entry.aliases])
  const evidence = identityEvidence(projected)
  if (evidence.sessionLegacy) out.add(evidence.sessionLegacy)
  for (const alias of evidence.aliases) out.add(alias)
  return out
}

function uniqueTarget(matches) {
  if (matches.length === 1) return { status: 'resolved', ...matches[0] }
  return matches.length > 1
    ? { status: 'ambiguous' }
    : { status: 'missing' }
}

function resolveTarget(view, target) {
  const evidence = identityEvidence(target)
  const entries = view.snapshot.document.items

  if (evidence.localId) {
    const exact = []
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].item.localId === evidence.localId) {
        exact.push({ entry: entries[index], item: view.items[index], index })
      }
    }
    if (exact.length > 0) return uniqueTarget(exact)
  }

  if (evidence.sessionLegacy) {
    const exact = []
    for (let index = 0; index < entries.length; index += 1) {
      const projected = identityEvidence(view.items[index])
      if (projected.sessionLegacy === evidence.sessionLegacy
          || entries[index].aliases.includes(evidence.sessionLegacy)) {
        exact.push({ entry: entries[index], item: view.items[index], index })
      }
    }
    if (exact.length > 0) return uniqueTarget(exact)
  }

  const matches = []
  for (let index = 0; index < entries.length; index += 1) {
    const current = evidenceForEntry(entries[index], view.items[index])
    if ([...evidence.aliases].some((alias) => current.has(alias))) {
      matches.push({ entry: entries[index], item: view.items[index], index })
    }
  }
  return uniqueTarget(matches)
}

function projectedByPrimary(view, primary) {
  if (typeof primary !== 'string') return null
  const index = view.snapshot.document.items.findIndex((entry) => entry.primary === primary)
  return index >= 0 ? view.items[index] || null : null
}

function projectedByLocalId(view, localId) {
  if (!validLocalEventId(localId)) return null
  const index = view.snapshot.document.items.findIndex(
    (entry) => entry.item.localId === localId,
  )
  return index >= 0 ? view.items[index] || null : null
}

function entryByLocalId(view, localId) {
  if (!validLocalEventId(localId)) return null
  return view?.snapshot?.document?.items?.find(
    (entry) => entry?.item?.localId === localId,
  ) || null
}

function landedMutation(before, after) {
  const beforeRevision = before?.document?.rev
  const afterRevision = after?.snapshot?.document?.rev
  return Number.isSafeInteger(beforeRevision)
    && Number.isSafeInteger(afterRevision)
    && afterRevision > beforeRevision
}

function canonicalJson(value) {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

function hydratedEntry(entry) {
  try {
    return isObject(entry?.item) && Array.isArray(entry.aliases)
      ? { ...entry.item, identityAliases: entry.aliases.slice(1) }
      : null
  } catch {
    return null
  }
}

function changedDurabilityMatches(result, after) {
  const durability = after?.snapshot?.durability
  return result.changed !== true || (
    result.durability === durability
    && result.persisted === (durability === 'durable')
  )
}

function noPendingOperations(snapshot) {
  try {
    return Array.isArray(snapshot?.pendingOps) && snapshot.pendingOps.length === 0
  } catch {
    return false
  }
}

function retryResultMatches(result, before, after) {
  if (result.code === 'persisted') {
    return result.changed === true
      && result.persisted === true
      && result.durability === 'durable'
      && after?.durability === 'durable'
  }
  if (result.code === 'session-only') {
    return result.changed === true
      && result.persisted === false
      && result.durability === 'session-only'
      && after?.durability === 'session-only'
  }
  if (result.code === 'nothing-to-retry') {
    return result.changed === false
      && noPendingOperations(before)
      && noPendingOperations(after)
      && result.durability === after?.durability
      && result.persisted === (after?.durability === 'durable')
  }
  return result.changed !== true || (
    RETRY_CHANGED_RESULT_CODES.has(result.code)
    && changedDurabilityMatches(result, { snapshot: after })
  )
}

function reductionResult(reduced, snapshot) {
  if (!isObject(reduced) || typeof reduced.code !== 'string') {
    return actionFailure('custom-event-command-unavailable', snapshot)
  }
  return publicActionResult({
    ok: reduced.code === 'unchanged',
    code: reduced.code,
    changed: false,
    persisted: snapshot.durability === 'durable',
    durability: snapshot.durability,
    concurrency: snapshot.concurrency,
    ...(reduced.conflict ? { conflict: reduced.conflict } : {}),
    ...(reduced.rejection ? { rejection: reduced.rejection } : {}),
  }, snapshot)
}

function diagnose(snapshot, command, city) {
  try {
    return reduceCustomEventState(snapshot.document, command, {
      cityId: city.id,
      timeZone: city.tz,
    })
  } catch {
    return null
  }
}

function duplicateItem(view, reduced, fallbackLocalId = null) {
  const primary = reduced?.conflict?.existingPrimary
    || reduced?.conflict?.primary
    || (validLocalEventId(fallbackLocalId) ? `c|${fallbackLocalId}` : null)
  return projectedByPrimary(view, primary)
}

function validStore(store) {
  const methods = [
    'addCommand',
    'deleteCommand',
    'destroy',
    'dispatch',
    'getItems',
    'getSnapshot',
    'importCommand',
    'initialize',
    'retryPersistence',
    'subscribe',
    'updateCommand',
  ]
  return isObject(store) && methods.every((method) => typeof store[method] === 'function')
}

export function createCustomEventLocalId() {
  try {
    return globalThis.crypto?.randomUUID?.() || null
  } catch {
    return null
  }
}

function eventWithLocalId(event, snapshot, createLocalId) {
  const supplied = dataField(event, 'localId')
  if (supplied.ok && validLocalEventId(supplied.value)) {
    return copyEventForCommand(event, supplied.value)
  }
  const reserved = new Set(snapshot.document.items.map((entry) => entry.item.localId))
  for (let attempt = 0; attempt < LOCAL_ID_ATTEMPTS; attempt += 1) {
    let localId
    try {
      localId = createLocalId()
    } catch {
      continue
    }
    if (!validLocalEventId(localId) || reserved.has(localId)) continue
    return copyEventForCommand(event, localId)
  }
  return null
}

export function customEventsPublicStatus({
  lifecycle,
  storeSnapshot,
  runtimeError = null,
} = {}) {
  const snapshot = storeSnapshot || EMPTY_STORE_SNAPSHOT
  if (runtimeError || lifecycle?.phase === 'error') return 'error'
  if (!lifecycle || lifecycle.phase === 'initializing' || lifecycle.phase === 'idle') {
    return 'initializing'
  }
  if (lifecycle.phase !== 'ready') return 'error'
  if (snapshot.status === 'corrupt') return 'corrupt'
  if (snapshot.status === 'error') return 'error'
  if (snapshot.status === 'ready' && snapshot.durability === 'session-only') {
    return 'session-only'
  }
  if (snapshot.status === 'ready' && snapshot.durability === 'durable') return 'durable'
  return 'error'
}

export function isUsableCustomEventsStatus(status) {
  return USABLE_STATUSES.has(status)
}

export function createCustomEventActions(store, {
  city,
  createLocalId = createCustomEventLocalId,
  isAvailable = null,
} = {}) {
  const available = () => {
    if (!validStore(store)) return false
    if (typeof isAvailable === 'function' && isAvailable() !== true) return false
    return usableStoreSnapshot(store.getSnapshot())
  }
  const currentView = () => available() ? projectedView(store) : null
  const unavailable = () => actionFailure(
    'custom-events-unavailable',
    store?.getSnapshot?.() || EMPTY_STORE_SNAPSHOT,
  )
  const dispatch = async (command, snapshot) => {
    try {
      const result = await store.dispatch(command)
      return publicActionResult(result, store.getSnapshot?.() || snapshot)
    } catch (error) {
      return actionFailure(
        'custom-event-result-invalid',
        store.getSnapshot?.() || snapshot,
        error?.message || null,
      )
    }
  }

  return Object.freeze({
    async add(event) {
      const view = currentView()
      if (!view) return unavailable()
      const candidate = eventWithLocalId(event, view.snapshot, createLocalId)
      if (!candidate) return actionFailure('custom-event-id-unavailable', view.snapshot)

      let command
      try {
        command = store.addCommand(candidate)
      } catch (error) {
        return actionFailure('custom-event-command-failed', view.snapshot, error?.message || null)
      }
      if (!command) {
        const reduced = diagnose(view.snapshot, { type: 'add', event: candidate }, city)
        return withResultItem(
          reductionResult(reduced, view.snapshot),
          duplicateItem(view, reduced, candidate.localId),
        )
      }

      const expectedEvent = canonicalJson(command.event)
      if (!expectedEvent) return actionFailure('custom-event-command-failed', view.snapshot)
      const result = await dispatch(command, view.snapshot)
      const after = projectedView(store)
      const afterEntry = entryByLocalId(after, candidate.localId)
      if (result.changed && (
        result.code !== 'added'
        || !landedMutation(view.snapshot, after)
        || !changedDurabilityMatches(result, after)
        || canonicalJson(hydratedEntry(afterEntry)) !== expectedEvent
      )) {
        return actionFailure('custom-event-result-inconsistent', after?.snapshot || view.snapshot)
      }
      let item = after ? projectedByLocalId(after, candidate.localId) : null
      if (!item && after && result.code.startsWith('duplicate-')) {
        const reduced = diagnose(after.snapshot, { type: 'add', event: command.event }, city)
        item = duplicateItem(after, reduced, candidate.localId)
      }
      if (result.changed && !item) {
        return actionFailure('custom-event-result-item-unavailable', after?.snapshot || view.snapshot)
      }
      return withResultItem(result, item)
    },

    async update(target, event = target) {
      const view = currentView()
      if (!view) return unavailable()
      const resolved = resolveTarget(view, target)
      if (resolved.status !== 'resolved') {
        return actionFailure(`custom-event-target-${resolved.status}`, view.snapshot)
      }
      const candidate = copyEventForCommand(event, resolved.entry.item.localId)
      if (!candidate) return actionFailure('invalid-event', view.snapshot)

      let command
      try {
        command = store.updateCommand(resolved.entry.item.localId, candidate)
      } catch (error) {
        return actionFailure('custom-event-command-failed', view.snapshot, error?.message || null)
      }
      if (!command) {
        const reduced = diagnose(view.snapshot, {
          type: 'update',
          localId: resolved.entry.item.localId,
          expectedRevision: resolved.entry.revision,
          event: candidate,
        }, city)
        return reductionResult(reduced, view.snapshot)
      }

      const expectedEvent = canonicalJson(command.event)
      if (!expectedEvent) return actionFailure('custom-event-command-failed', view.snapshot)
      const result = await dispatch(command, view.snapshot)
      const after = projectedView(store)
      const afterEntry = entryByLocalId(after, resolved.entry.item.localId)
      if (result.changed && (
        result.code !== 'updated'
        || !landedMutation(view.snapshot, after)
        || !changedDurabilityMatches(result, after)
        || !afterEntry
        || afterEntry.revision <= resolved.entry.revision
        || canonicalJson(hydratedEntry(afterEntry)) !== expectedEvent
      )) {
        return actionFailure('custom-event-result-inconsistent', after?.snapshot || view.snapshot)
      }
      const item = after
        ? projectedByLocalId(after, resolved.entry.item.localId)
        : null
      if (result.changed && !item) {
        return actionFailure('custom-event-result-item-unavailable', after?.snapshot || view.snapshot)
      }
      return withResultItem(result, item)
    },

    async remove(target) {
      const view = currentView()
      if (!view) return unavailable()
      const resolved = resolveTarget(view, target)
      if (resolved.status !== 'resolved') {
        return actionFailure(`custom-event-target-${resolved.status}`, view.snapshot)
      }

      let command
      try {
        command = store.deleteCommand(resolved.entry.item.localId)
      } catch (error) {
        return actionFailure('custom-event-command-failed', view.snapshot, error?.message || null)
      }
      if (!command) {
        const reduced = diagnose(view.snapshot, {
          type: 'delete',
          localId: resolved.entry.item.localId,
          expectedRevision: resolved.entry.revision,
        }, city)
        return reductionResult(reduced, view.snapshot)
      }

      const result = await dispatch(command, view.snapshot)
      const after = projectedView(store)
      if (result.changed && (
        result.code !== 'deleted'
        || !landedMutation(view.snapshot, after)
        || !changedDurabilityMatches(result, after)
        || entryByLocalId(after, resolved.entry.item.localId)
      )) {
        return actionFailure('custom-event-result-inconsistent', after?.snapshot || view.snapshot)
      }
      return withResultItem(result, result.changed ? resolved.item : null)
    },

    async importEvents(events, options = {}) {
      const view = currentView()
      if (!view) return unavailable()
      let command
      try {
        command = store.importCommand(events, options)
      } catch (error) {
        return actionFailure('custom-event-command-failed', view.snapshot, error?.message || null)
      }
      if (!command) {
        const reduced = diagnose(view.snapshot, {
          type: 'import',
          mode: options?.mode || 'merge',
          expectedRevision: view.snapshot.document.rev,
          events,
        }, city)
        return reductionResult(reduced, view.snapshot)
      }
      const expected = diagnose(view.snapshot, command, city)
      const expectedDocument = expected?.changed === true
        ? canonicalJson(expected.document)
        : null
      if (!expectedDocument) return actionFailure('custom-event-command-failed', view.snapshot)
      const result = await dispatch(command, view.snapshot)
      const after = projectedView(store)
      if (result.changed && (
        result.code !== expected.code
        || !landedMutation(view.snapshot, after)
        || !changedDurabilityMatches(result, after)
        || canonicalJson(after?.snapshot?.document) !== expectedDocument
      )) {
        return actionFailure('custom-event-result-inconsistent', after?.snapshot || view.snapshot)
      }
      return result
    },

    async retry() {
      const view = currentView()
      if (!view) return unavailable()
      try {
        const result = await store.retryPersistence()
        const snapshot = store.getSnapshot?.() || view.snapshot
        const publicResult = publicActionResult(result, snapshot)
        if (!retryResultMatches(publicResult, view.snapshot, snapshot)) {
          return actionFailure('custom-event-result-inconsistent', snapshot)
        }
        return publicResult
      } catch (error) {
        return actionFailure(
          'custom-event-result-invalid',
          store.getSnapshot?.() || view.snapshot,
          error?.message || null,
        )
      }
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
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    begin(store) {
      publish(store, 'initializing')
    },
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
  }
}

function providerError(code, error = null) {
  return Object.freeze({
    code,
    ...(error?.message ? { detail: error.message } : {}),
  })
}

function CityCustomEventsProvider({
  children,
  city,
  storeFactory,
  sourceCapture,
  createLocalId,
}) {
  const [holder] = useState(createStoreHolder)
  const [selectedCity] = useState(() => ({ id: city.id, tz: city.tz }))
  const storeFactoryRef = useRef(storeFactory)
  const sourceCaptureRef = useRef(sourceCapture)
  const [createLocalIdForCity] = useState(() => createLocalId)

  useEffect(() => {
    let active = true
    let store = null
    try {
      // StrictMode must receive a genuinely fresh instance for every effect
      // setup. No render-time memo or state cell owns this browser resource.
      store = storeFactoryRef.current({ city: selectedCity })
      if (!validStore(store)) throw new TypeError('storeFactory must return a custom-event store')
      holder.begin(store)
      Promise.resolve()
        .then(() => store.initialize({
          sourceFactory: () => sourceCaptureRef.current({ city: selectedCity }),
        }))
        .then(() => {
          if (!active || holder.getSnapshot().store !== store) return
          const snapshot = store.getSnapshot()
          if (snapshot.status === 'ready'
              || snapshot.status === 'corrupt'
              || snapshot.status === 'error') {
            holder.ready(store)
          } else {
            holder.fail(store, providerError('custom-event-initialize-incomplete'))
          }
        })
        .catch((error) => {
          if (!active || holder.getSnapshot().store !== store) return
          holder.fail(store, providerError('custom-event-provider-initialize-failed', error))
        })
    } catch (error) {
      holder.failCreation(providerError('custom-event-store-create-failed', error))
    }
    return () => {
      active = false
      holder.clear(store)
      store?.destroy?.()
    }
  }, [holder, selectedCity])

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
    () => store ? store.getSnapshot() : EMPTY_STORE_SNAPSHOT,
    [store],
  )
  const storeSnapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot,
  )
  const baseStatus = customEventsPublicStatus({
    lifecycle: holderSnapshot.lifecycle,
    storeSnapshot,
    runtimeError: holderSnapshot.lifecycle.error,
  })
  const projection = useMemo(() => {
    if (!isUsableCustomEventsStatus(baseStatus)) {
      return { ok: true, items: EMPTY_ITEMS, error: null }
    }
    try {
      const items = store.getItems()
      return Array.isArray(items)
        && items.length === storeSnapshot.document.items.length
        ? { ok: true, items, error: null }
        : {
            ok: false,
            items: EMPTY_ITEMS,
            error: providerError('custom-event-projection-invalid'),
          }
    } catch (error) {
      return {
        ok: false,
        items: EMPTY_ITEMS,
        error: providerError('custom-event-projection-failed', error),
      }
    }
  }, [baseStatus, store, storeSnapshot])
  const status = projection.ok ? baseStatus : 'error'
  const phase = isUsableCustomEventsStatus(status) ? 'ready' : status
  const error = projection.error
    || holderSnapshot.lifecycle.error
    || (!isUsableCustomEventsStatus(status) ? storeSnapshot.error : null)
    || (status === 'corrupt' || status === 'error'
      ? providerError(`custom-events-${status}`)
      : null)
  const actions = useMemo(() => createCustomEventActions(store, {
    city: selectedCity,
    createLocalId: createLocalIdForCity,
    isAvailable: () => {
      const current = holder.getSnapshot()
      return current.store === store && current.lifecycle.phase === 'ready'
    },
  }), [createLocalIdForCity, holder, selectedCity, store])
  const importEvents = actions.importEvents
  const retry = actions.retry

  const value = useMemo(() => ({
    phase,
    status,
    ready: isUsableCustomEventsStatus(status),
    durability: storeSnapshot.durability,
    error,
    recovery: storeSnapshot.recovery,
    items: projection.items,
    add: actions.add,
    update: actions.update,
    remove: actions.remove,
    import: importEvents,
    importEvents,
    retry,
    retryPersistence: retry,
  }), [
    actions.add,
    actions.remove,
    actions.update,
    error,
    importEvents,
    phase,
    projection.items,
    retry,
    status,
    storeSnapshot.durability,
    storeSnapshot.recovery,
  ])

  return (
    <CustomEventsContext.Provider value={value}>
      {children}
    </CustomEventsContext.Provider>
  )
}

export function CustomEventsProvider({
  children,
  city = CITY,
  storeFactory = createCustomEventStore,
  sourceCapture = captureCustomEventV1Source,
  createLocalId = createCustomEventLocalId,
}) {
  const cityKey = `${city.id}:${city.tz}`
  return (
    <CityCustomEventsProvider
      key={cityKey}
      city={city}
      storeFactory={storeFactory}
      sourceCapture={sourceCapture}
      createLocalId={createLocalId}
    >
      {children}
    </CityCustomEventsProvider>
  )
}

export function useCustomEvents() {
  const value = useContext(CustomEventsContext)
  if (!value) throw new Error('useCustomEvents must be used within CustomEventsProvider')
  return value
}
