/* eslint-disable react-refresh/only-export-components --
   the provider intentionally co-locates the useLocationPermission hook with
   its context owner, matching the existing navigation and planner seams. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { CITY } from './city.js'
import { coordsInCityMarket } from './location-market.js'
import { createLocationPermissionController } from './location-permission.js'
import { createStorageScope } from './storage.js'

const LocationContext = createContext(null)

function emptySnapshot(cityId) {
  return Object.freeze({
    status: 'disabled',
    cityId,
    desired: false,
    enabled: false,
    coords: null,
    permission: 'unknown',
    durability: 'unknown',
    error: null,
  })
}

function createControllerHolder() {
  let snapshot = Object.freeze({ controller: null, error: null })
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(controller, error = null) {
      snapshot = Object.freeze({ controller, error })
      for (const listener of [...listeners]) listener()
    },
    clear(controller) {
      if (snapshot.controller !== controller) return
      snapshot = Object.freeze({ controller: null, error: null })
      for (const listener of [...listeners]) listener()
    },
  }
}

function providerFailure(cityId, error) {
  return Object.freeze({
    status: 'error',
    cityId,
    desired: false,
    enabled: false,
    coords: null,
    permission: 'unknown',
    durability: 'unknown',
    error: Object.freeze({
      code: 'location-controller-unavailable',
      ...(error?.message ? { detail: error.message } : {}),
    }),
  })
}

function CityLocationProvider({
  children,
  city,
  controllerFactory,
  storageFactory,
}) {
  const [holder] = useState(createControllerHolder)
  const [selectedCity] = useState(() => ({ ...city }))
  const [empty] = useState(() => emptySnapshot(selectedCity.id))
  const controllerFactoryRef = useState(() => controllerFactory)[0]
  const storageFactoryRef = useState(() => storageFactory)[0]

  useEffect(() => {
    let controller = null
    let active = true
    try {
      controller = controllerFactoryRef({
        cityId: selectedCity.id,
        storageFactory: storageFactoryRef,
      })
      holder.set(controller)
      controller.initialize().catch((error) => {
        if (!active || holder.getSnapshot().controller !== controller) return
        holder.set(controller, error)
      })
    } catch (error) {
      holder.set(null, error)
    }
    return () => {
      active = false
      holder.clear(controller)
      controller?.destroy()
    }
  }, [controllerFactoryRef, holder, selectedCity, storageFactoryRef])

  const holderSnapshot = useSyncExternalStore(
    holder.subscribe,
    holder.getSnapshot,
    holder.getSnapshot,
  )
  const controller = holderSnapshot.controller
  const subscribe = useCallback(
    (listener) => controller ? controller.subscribe(listener) : () => {},
    [controller],
  )
  const getSnapshot = useCallback(
    () => controller ? controller.getSnapshot() : empty,
    [controller, empty],
  )
  const controllerSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  )
  const snapshot = holderSnapshot.error
    ? providerFailure(selectedCity.id, holderSnapshot.error)
    : controllerSnapshot
  const inMarket = snapshot.enabled && coordsInCityMarket(snapshot.coords, selectedCity)
  const usableCoords = inMarket ? snapshot.coords : null

  const request = useCallback(
    () => controller ? controller.request() : Promise.resolve(snapshot),
    [controller, snapshot],
  )
  const refresh = useCallback(
    () => controller ? controller.refresh() : Promise.resolve(snapshot),
    [controller, snapshot],
  )
  const disable = useCallback(
    () => controller ? controller.disable() : snapshot,
    [controller, snapshot],
  )
  const setDesired = useCallback(
    (on) => controller ? controller.setDesired(on) : Promise.resolve(snapshot),
    [controller, snapshot],
  )

  const value = useMemo(() => ({
    ...snapshot,
    inMarket,
    usableCoords,
    request,
    enable: request,
    refresh,
    disable,
    setDesired,
  }), [disable, inMarket, refresh, request, setDesired, snapshot, usableCoords])

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  )
}

export function LocationProvider({
  children,
  city = CITY,
  controllerFactory = createLocationPermissionController,
  storageFactory = createStorageScope,
}) {
  const cityKey = `${city.id}:${city.tz}`
  return (
    <CityLocationProvider
      key={cityKey}
      city={city}
      controllerFactory={controllerFactory}
      storageFactory={storageFactory}
    >
      {children}
    </CityLocationProvider>
  )
}

export function useLocationPermission() {
  const value = useContext(LocationContext)
  if (!value) {
    throw new Error('useLocationPermission must be used within LocationProvider')
  }
  return value
}
