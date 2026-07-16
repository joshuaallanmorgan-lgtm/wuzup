// planner-runtime.js — framework-neutral adapter around the atomic planner.
//
// React owns mounting and subscriptions in PlannerProvider.jsx. This module
// keeps initialization, exact command construction, and read models pure
// enough for deterministic Node tests.
import { PLANNER_PARTS, emptyPlannerDocument } from './planner-core.js'
import {
  activePlannerDays,
  createPlannerCatalog,
  findPlannedItem,
  isPlannerItemPlanned,
  plannerHistory,
  resolvePlannerSlot,
} from './planner-selectors.js'

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const validDayTs = (value) => Number.isInteger(value) && value > 0
const TERMINAL_ARTIFACT_STATUSES = new Set([
  'ready',
  'empty',
  'stale',
  'offline',
  'error',
])

export const EMPTY_PLANNER_STORE_SNAPSHOT = Object.freeze({
  status: 'idle',
  cityId: null,
  timeZone: null,
  document: Object.freeze(emptyPlannerDocument()),
  envelope: null,
  durability: 'unknown',
  concurrency: 'none',
  pendingOps: Object.freeze([]),
  error: null,
  recovery: null,
})

export function isTerminalArtifactStatus(status) {
  return TERMINAL_ARTIFACT_STATUSES.has(status)
}

function publicFailure(code, detail = null) {
  return {
    ok: false,
    code,
    changed: false,
    persisted: false,
    durability: 'unknown',
    concurrency: 'none',
    error: detail ? { code, detail } : { code },
  }
}

export function plannerPublicStatus({
  artifactStatus,
  lifecycle,
  storeSnapshot,
  runtimeError = null,
} = {}) {
  const snapshot = storeSnapshot || EMPTY_PLANNER_STORE_SNAPSHOT
  if (runtimeError || lifecycle?.phase === 'error' || snapshot.status === 'error') return 'error'
  if (snapshot.status === 'corrupt') return 'corrupt'
  if (!isTerminalArtifactStatus(artifactStatus) || !lifecycle || lifecycle.phase === 'idle') return 'idle'
  if (lifecycle.phase === 'initializing') return 'initializing'
  if (snapshot.durability === 'session-only') return 'session-only'
  if (snapshot.durability === 'durable') return 'durable'
  return 'error'
}

export function resolvePlannerReference(ref, catalog) {
  const resolved = resolvePlannerSlot(ref, catalog)
  if (resolved.status === 'retained' && ref?.identity?.status === 'missing') {
    return { ...resolved, status: 'missing' }
  }
  return resolved
}

function dayEntry(document, dayTs) {
  const active = activePlannerDays(document).find((day) => day.dayTs === dayTs)
  if (active) return { source: 'active', entry: active }
  const history = plannerHistory(document).find((day) => day.dayTs === dayTs)
  if (history) return { source: 'history', entry: history }
  return null
}

export function plannerDayModel(document, dayTs, catalog) {
  const found = validDayTs(dayTs) ? dayEntry(document, dayTs) : null
  const entry = found?.entry
  const slots = []
  for (const part of PLANNER_PARTS) {
    const ref = entry?.slots?.[part]
    if (!ref) continue
    const resolved = resolvePlannerReference(ref, catalog)
    slots.push({
      dayTs,
      part,
      ref,
      resolution: resolved.status,
      item: resolved.item,
    })
  }
  return {
    source: found?.source || 'empty',
    dayTs,
    state: entry?.state || null,
    done: entry?.done === true,
    slots,
  }
}

export function filledPlannerDayCount(document) {
  const filled = new Set()
  for (const day of [...activePlannerDays(document), ...plannerHistory(document)]) {
    if (PLANNER_PARTS.some((part) => Boolean(day.slots?.[part]))) filled.add(day.dayTs)
  }
  return filled.size
}

export function createPlannerActions(store, { getTodayTs = () => null } = {}) {
  if (!store
      || typeof store.dispatch !== 'function'
      || typeof store.retryPersistence !== 'function') {
    throw new TypeError('createPlannerActions requires a planner store')
  }
  const rejectPastTarget = (dayTs) => {
    const todayTs = getTodayTs()
    return validDayTs(todayTs) && validDayTs(dayTs) && dayTs < todayTs
      ? Promise.resolve(publicFailure('past-day-target'))
      : null
  }
  return {
    async add(item, { dayTs, part } = {}) {
      const rejected = rejectPastTarget(dayTs)
      if (rejected) return rejected
      return store.dispatch({ type: 'add', item, dayTs, part })
    },
    async move(slot, { dayTs, part } = {}) {
      const rejected = rejectPastTarget(dayTs)
      if (rejected) return rejected
      return store.dispatch({
        type: 'move',
        fromDayTs: slot?.dayTs,
        fromPart: slot?.part,
        toDayTs: dayTs,
        toPart: part,
        expectedPrimary: slot?.ref?.primary,
      })
    },
    async remove(slot) {
      return store.dispatch({
        type: 'remove',
        dayTs: slot?.dayTs,
        part: slot?.part,
        expectedPrimary: slot?.ref?.primary,
      })
    },
    async setRest(dayTs, rest) {
      const rejected = rejectPastTarget(dayTs)
      if (rejected) return rejected
      return store.dispatch({ type: 'rest', dayTs, rest })
    },
    async undo(receipt) {
      return store.dispatch({ type: 'undo', receipt })
    },
    async retryPersistence() {
      return store.retryPersistence()
    },
  }
}

export function createPlannerRuntime({
  city,
  storeFactory,
  sourceCapture,
} = {}) {
  if (!isObject(city) || typeof city.id !== 'string' || typeof city.tz !== 'string') {
    throw new TypeError('createPlannerRuntime requires a city')
  }
  if (typeof storeFactory !== 'function' || typeof sourceCapture !== 'function') {
    throw new TypeError('storeFactory and sourceCapture must be functions')
  }

  const selected = { ...city }
  const store = storeFactory({ city: selected })
  if (!store
      || typeof store.initialize !== 'function'
      || typeof store.dispatch !== 'function'
      || typeof store.destroy !== 'function') {
    throw new TypeError('storeFactory must return a planner store')
  }

  const listeners = new Set()
  let lifecycle = Object.freeze({ phase: 'idle', error: null })
  let initializePromise = null
  let initialized = false
  let destroyed = false
  let lastTodayTs = null
  let currentTodayTs = null
  const actions = createPlannerActions(store, {
    getTodayTs: () => currentTodayTs,
  })

  const publish = (phase, error = null) => {
    lifecycle = Object.freeze({ phase, error })
    for (const listener of [...listeners]) listener()
  }

  const initialize = ({
    artifactStatus,
    anchors,
    events = [],
    seeds = [],
  } = {}) => {
    if (destroyed) return Promise.resolve(publicFailure('destroyed'))
    if (!isTerminalArtifactStatus(artifactStatus)) {
      return Promise.resolve(publicFailure('artifact-pending'))
    }
    if (!validDayTs(anchors?.todayTs) || !validDayTs(anchors?.wkStartTs)) {
      return Promise.resolve(publicFailure('planner-anchors-invalid'))
    }
    currentTodayTs = anchors.todayTs
    if (initializePromise) return initializePromise

    publish('initializing')
    initializePromise = Promise.resolve()
      .then(() => {
        if (destroyed) return publicFailure('destroyed')
        return store.initialize({
          city: selected,
          sourceFactory: () => sourceCapture({ city: selected }),
          todayTs: anchors.todayTs,
          weekendStartTs: anchors.wkStartTs,
          catalog: Array.isArray(events) ? events : [],
          seeds: Array.isArray(seeds) ? seeds : [],
        })
      })
      .then((result) => {
        if (destroyed) return result
        initialized = true
        const snapshot = store.getSnapshot?.()
        if (snapshot?.status !== 'ready' && snapshot?.status !== 'corrupt') {
          publish('error', result?.error || snapshot?.error || { code: result?.code || 'planner-initialize-failed' })
        } else {
          publish('ready')
        }
        return result
      })
      .catch((error) => {
        if (!destroyed) publish('error', {
          code: 'planner-provider-initialize-failed',
          detail: error?.message || null,
        })
        return publicFailure('planner-provider-initialize-failed', error?.message || null)
      })
    return initializePromise
  }

  const rollover = async (todayTs) => {
    if (destroyed) return publicFailure('destroyed')
    if (!initialized || store.getSnapshot?.().status !== 'ready') {
      return publicFailure('not-initialized')
    }
    if (!validDayTs(todayTs)) return store.dispatch({ type: 'rollover', todayTs })
    currentTodayTs = todayTs
    if (todayTs === lastTodayTs) return publicFailure('already-current')
    const result = await store.dispatch({ type: 'rollover', todayTs })
    if (result?.changed === true || result?.code === 'nothing-to-rollover') {
      lastTodayTs = todayTs
    }
    return result
  }

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    listeners.clear()
    store.destroy()
  }

  return {
    store,
    actions,
    initialize,
    rollover,
    getLifecycleSnapshot: () => lifecycle,
    subscribeLifecycle(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    createCatalog(values) {
      return createPlannerCatalog(values)
    },
    getDay(document, dayTs, catalog) {
      return plannerDayModel(document, dayTs, catalog)
    },
    resolve(ref, catalog) {
      return resolvePlannerReference(ref, catalog)
    },
    placement(document, item, catalog) {
      return findPlannedItem(document, item, catalog)
    },
    isPlanned(document, item, catalog) {
      return isPlannerItemPlanned(document, item, catalog)
    },
    activeDays(document) {
      return activePlannerDays(document)
    },
    history(document) {
      return plannerHistory(document)
    },
    filledDayCount(document) {
      return filledPlannerDayCount(document)
    },
    destroy,
  }
}
