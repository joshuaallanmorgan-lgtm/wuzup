/* eslint-disable react-refresh/only-export-components --
   the provider contract intentionally co-locates its usePlanner hook with the
   context owner, matching the established NavProvider/useNav seam. */
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
import { identitySeedsForCity } from './identity-seeds.js'
import { isCustomEvent } from './identity.js'
import { usePlaces } from './places.js'
import { capturePlannerV1Source } from './planner-v1-source.js'
import { createPlannerStore } from './planner-store.js'
import {
  EMPTY_PLANNER_STORE_SNAPSHOT,
  createPlannerRuntime,
  plannerPublicStatus,
} from './planner-runtime.js'

const PlannerContext = createContext(null)
const EMPTY_LIST = Object.freeze([])
const EMPTY_LIFECYCLE = Object.freeze({ phase: 'idle', error: null })
const EMPTY_ROLLOVER = Object.freeze({
  runtime: null,
  dayTs: null,
  phase: 'idle',
  error: null,
})
const ROLLOVER_SUCCESS_CODES = new Set([
  'nothing-to-rollover',
  'already-current',
])

export function plannerRolloverSucceeded(result) {
  return result?.ok === true
    || result?.changed === true
    || ROLLOVER_SUCCESS_CODES.has(result?.code)
}

export function plannerStatusAfterRollover(
  baseStatus,
  rollover,
  todayTs,
  runtime,
) {
  if (baseStatus !== 'durable' && baseStatus !== 'session-only') return baseStatus
  if (rollover?.runtime !== runtime || rollover?.dayTs !== todayTs) return 'initializing'
  if (rollover.phase === 'error') return 'error'
  if (rollover.phase !== 'ready') return 'initializing'
  return baseStatus
}

function rolloverFailure(result, error, dayTs) {
  const cause = result?.error?.code
    || result?.conflict?.code
    || result?.code
    || error?.code
    || 'planner-rollover-failed'
  return {
    code: 'planner-rollover-failed',
    detail: error?.message || result?.error?.detail || cause,
    cause,
    dayTs,
  }
}

function rejectedRolloverResult(error, snapshot) {
  const failure = rolloverFailure(null, error, null)
  return {
    ok: false,
    code: failure.code,
    changed: false,
    persisted: false,
    durability: snapshot.durability,
    concurrency: snapshot.concurrency,
    error: failure,
    snapshot,
  }
}

function createRuntimeHolder() {
  let snapshot = Object.freeze({ runtime: null, error: null })
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(runtime, error = null) {
      snapshot = Object.freeze({ runtime, error })
      for (const listener of [...listeners]) listener()
    },
    clear(runtime) {
      if (snapshot.runtime !== runtime) return
      snapshot = Object.freeze({ runtime: null, error: null })
      for (const listener of [...listeners]) listener()
    },
  }
}

function unavailableResult(snapshot) {
  return Promise.resolve({
    ok: false,
    code: 'planner-unavailable',
    changed: false,
    persisted: false,
    durability: snapshot.durability,
    concurrency: snapshot.concurrency,
    snapshot,
  })
}

function CityPlannerProvider({
  children,
  city,
  anchors,
  events,
  artifactStatus,
  storeFactory,
  sourceCapture,
}) {
  const [holder] = useState(createRuntimeHolder)
  const [rollover, setRollover] = useState(EMPTY_ROLLOVER)
  const mountedRef = useRef(false)
  const rolloverRef = useRef(EMPTY_ROLLOVER)
  const rolloverAttemptRef = useRef(0)
  const storeFactoryRef = useRef(storeFactory)
  const sourceCaptureRef = useRef(sourceCapture)
  // The outer provider is keyed by city id/timezone, so this captures the
  // full config once for that city without coupling the store to object-identity
  // churn from a parent render.
  const [selectedCity] = useState(() => ({ ...city }))

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      rolloverAttemptRef.current += 1
      rolloverRef.current = EMPTY_ROLLOVER
    }
  }, [])

  useEffect(() => {
    let runtime = null
    try {
      runtime = createPlannerRuntime({
        city: selectedCity,
        storeFactory: storeFactoryRef.current,
        sourceCapture: sourceCaptureRef.current,
      })
      holder.set(runtime)
    } catch (error) {
      holder.set(null, {
        code: 'planner-runtime-create-failed',
        detail: error?.message || null,
      })
    }
    return () => {
      holder.clear(runtime)
      runtime?.destroy()
    }
  }, [holder, selectedCity])

  const holderSnapshot = useSyncExternalStore(
    holder.subscribe,
    holder.getSnapshot,
    holder.getSnapshot
  )
  const runtime = holderSnapshot.runtime
  const store = runtime?.store || null
  const subscribeStore = useCallback(
    (listener) => store ? store.subscribe(listener) : () => {},
    [store]
  )
  const getStoreSnapshot = useCallback(
    () => store ? store.getSnapshot() : EMPTY_PLANNER_STORE_SNAPSHOT,
    [store]
  )
  const storeSnapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot
  )
  const subscribeLifecycle = useCallback(
    (listener) => runtime ? runtime.subscribeLifecycle(listener) : () => {},
    [runtime]
  )
  const getLifecycleSnapshot = useCallback(
    () => runtime ? runtime.getLifecycleSnapshot() : EMPTY_LIFECYCLE,
    [runtime]
  )
  const lifecycle = useSyncExternalStore(
    subscribeLifecycle,
    getLifecycleSnapshot,
    getLifecycleSnapshot
  )

  const eventList = Array.isArray(events) ? events : EMPTY_LIST
  const { places } = usePlaces(false)
  const placeList = Array.isArray(places) ? places : EMPTY_LIST
  const seeds = useMemo(() => identitySeedsForCity(city.id), [city.id])
  const remoteEvents = useMemo(
    () => eventList.filter((item) => !isCustomEvent(item)),
    [eventList]
  )
  const customEvents = useMemo(
    () => eventList.filter(isCustomEvent),
    [eventList]
  )
  const catalog = useMemo(
    () => runtime?.createCatalog({
      events: remoteEvents,
      customEvents,
      places: placeList,
      seeds,
    }) || null,
    [customEvents, placeList, remoteEvents, runtime, seeds]
  )

  useEffect(() => {
    if (!runtime) return
    runtime.initialize({
      artifactStatus,
      anchors,
      events: eventList,
      seeds,
    }).catch(() => {})
  }, [anchors, artifactStatus, eventList, runtime, seeds])

  const publishRollover = useCallback((next) => {
    rolloverRef.current = next
    if (mountedRef.current) setRollover(next)
  }, [])

  const attemptRollover = useCallback(async (dayTs) => {
    if (!runtime) return unavailableResult(EMPTY_PLANNER_STORE_SNAPSHOT)
    const attempt = rolloverAttemptRef.current + 1
    rolloverAttemptRef.current = attempt
    publishRollover({
      runtime,
      dayTs,
      phase: 'pending',
      error: null,
    })

    let result
    let rejected = null
    try {
      result = await runtime.rollover(dayTs)
    } catch (error) {
      rejected = error
      result = rejectedRolloverResult(
        error,
        runtime.store?.getSnapshot?.() || EMPTY_PLANNER_STORE_SNAPSHOT,
      )
    }

    if (!mountedRef.current || rolloverAttemptRef.current !== attempt) return result
    if (plannerRolloverSucceeded(result)) {
      publishRollover({
        runtime,
        dayTs,
        phase: 'ready',
        error: null,
      })
    } else {
      publishRollover({
        runtime,
        dayTs,
        phase: 'error',
        error: rolloverFailure(result, rejected, dayTs),
      })
    }
    return result
  }, [publishRollover, runtime])

  useEffect(() => {
    if (!runtime || lifecycle.phase !== 'ready') return
    attemptRollover(anchors?.todayTs)
    return () => {
      rolloverAttemptRef.current += 1
    }
  }, [anchors?.todayTs, attemptRollover, lifecycle.phase, runtime])

  const document = storeSnapshot.document
  const activeDays = useMemo(
    () => runtime?.activeDays(document) || EMPTY_LIST,
    [document, runtime]
  )
  const history = useMemo(
    () => runtime?.history(document) || EMPTY_LIST,
    [document, runtime]
  )
  const filledDayCount = useMemo(
    () => runtime?.filledDayCount(document) || 0,
    [document, runtime]
  )
  const getDay = useCallback(
    (dayTs) => runtime?.getDay(document, dayTs, catalog) || {
      source: 'empty',
      dayTs,
      state: null,
      done: false,
      slots: [],
    },
    [catalog, document, runtime]
  )
  const resolve = useCallback(
    (ref) => runtime?.resolve(ref, catalog) || null,
    [catalog, runtime]
  )
  const placement = useCallback(
    (item) => runtime?.placement(document, item, catalog) || null,
    [catalog, document, runtime]
  )
  const isPlanned = useCallback(
    (item) => runtime?.isPlanned(document, item, catalog) || false,
    [catalog, document, runtime]
  )

  const add = useCallback(
    (item, options) => runtime?.actions.add(item, options) || unavailableResult(storeSnapshot),
    [runtime, storeSnapshot]
  )
  const move = useCallback(
    (slot, options) => runtime?.actions.move(slot, options) || unavailableResult(storeSnapshot),
    [runtime, storeSnapshot]
  )
  const remove = useCallback(
    (slot) => runtime?.actions.remove(slot) || unavailableResult(storeSnapshot),
    [runtime, storeSnapshot]
  )
  const setRest = useCallback(
    (dayTs, rest) => runtime?.actions.setRest(dayTs, rest) || unavailableResult(storeSnapshot),
    [runtime, storeSnapshot]
  )
  const undo = useCallback(
    (receipt) => runtime?.actions.undo(receipt) || unavailableResult(storeSnapshot),
    [runtime, storeSnapshot]
  )
  const retryPersistence = useCallback(async () => {
    if (!runtime) return unavailableResult(storeSnapshot)
    const failed = rolloverRef.current
    if (failed.runtime === runtime
        && failed.phase === 'error'
        && failed.dayTs === anchors?.todayTs) {
      const rolloverResult = await attemptRollover(failed.dayTs)
      if (!plannerRolloverSucceeded(rolloverResult)) return rolloverResult
      if (rolloverResult?.durability === 'session-only'
          || rolloverResult?.changed === true && rolloverResult?.persisted === false) {
        return runtime.actions.retryPersistence()
      }
      return rolloverResult
    }
    return runtime.actions.retryPersistence()
  }, [anchors?.todayTs, attemptRollover, runtime, storeSnapshot])

  const rolloverError = rollover.runtime === runtime
    && rollover.dayTs === anchors?.todayTs
    && rollover.phase === 'error'
    ? rollover.error
    : null
  const baseStatus = plannerPublicStatus({
    artifactStatus,
    lifecycle,
    storeSnapshot,
    runtimeError: holderSnapshot.error || rolloverError,
  })
  const status = plannerStatusAfterRollover(
    baseStatus,
    rollover,
    anchors?.todayTs,
    runtime,
  )
  const value = useMemo(() => ({
    status,
    durability: storeSnapshot.durability,
    error: holderSnapshot.error || rolloverError || lifecycle.error || storeSnapshot.error,
    recovery: rolloverError
      ? {
          code: 'retry-rollover',
          canRetry: true,
          dayTs: rolloverError.dayTs,
        }
      : storeSnapshot.recovery,
    document,
    catalog,
    getDay,
    resolve,
    placement,
    isPlanned,
    activeDays,
    history,
    filledDayCount,
    add,
    move,
    remove,
    setRest,
    undo,
    retryPersistence,
  }), [
    activeDays,
    add,
    catalog,
    document,
    filledDayCount,
    getDay,
    history,
    holderSnapshot.error,
    isPlanned,
    lifecycle.error,
    move,
    placement,
    remove,
    resolve,
    retryPersistence,
    rolloverError,
    setRest,
    status,
    storeSnapshot.durability,
    storeSnapshot.error,
    storeSnapshot.recovery,
    undo,
  ])

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>
}

export function PlannerProvider({
  children,
  city = CITY,
  anchors,
  events = EMPTY_LIST,
  artifactStatus,
  storeFactory = createPlannerStore,
  sourceCapture = capturePlannerV1Source,
}) {
  const cityKey = `${city.id}:${city.tz}`
  return (
    <CityPlannerProvider
      key={cityKey}
      city={city}
      anchors={anchors}
      events={events}
      artifactStatus={artifactStatus}
      storeFactory={storeFactory}
      sourceCapture={sourceCapture}
    >
      {children}
    </CityPlannerProvider>
  )
}

export function usePlanner() {
  const value = useContext(PlannerContext)
  if (!value) throw new Error('usePlanner must be used within PlannerProvider')
  return value
}
