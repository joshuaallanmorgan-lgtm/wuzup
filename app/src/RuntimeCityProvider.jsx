/* eslint-disable react-refresh/only-export-components -- the runtime city hook
   intentionally lives beside its one bootstrap-owned context provider. */
import { createContext, useContext, useMemo } from 'react'
import { runtimeCityHref } from './runtime-city.js'
import './runtime-city.css'

const RuntimeCityContext = createContext(null)

export function RuntimeCityProvider({ selection, children }) {
  if (!selection?.ok) throw new Error('RuntimeCityProvider requires a ready city selection')
  const value = useMemo(() => ({
    ...selection,
    hrefForCity: (cityId) => runtimeCityHref(selection, cityId),
  }), [selection])

  return (
    <RuntimeCityContext.Provider value={value}>
      {children}
    </RuntimeCityContext.Provider>
  )
}

export function useRuntimeCity() {
  const value = useContext(RuntimeCityContext)
  if (!value) throw new Error('useRuntimeCity must be used within RuntimeCityProvider')
  return value
}

function failureMessage(selection) {
  if (selection?.code === 'CITY_APP_LOAD_FAILED') {
    return 'The verified coverage area is ready, but the Wuzup app could not finish loading.'
  }
  if (selection?.code === 'CITY_BUILD_MISMATCH') {
    const requested = selection.destinations?.find((entry) => entry.cityId === selection.requestedCity)
    return requested
      ? `This address asks for ${requested.name}, but the loaded listing pack belongs to ${selection.city?.name}.`
      : 'This address and its listing pack do not identify the same coverage area.'
  }
  if (selection?.code === 'CITY_UNKNOWN' || selection?.code === 'CITY_REQUEST_INVALID') {
    return 'That coverage area is not available in this version of Wuzup.'
  }
  return 'This Wuzup address could not be matched to a verified coverage area.'
}

export function RuntimeCityFailure({ selection }) {
  const requested = selection?.destinations?.find((entry) => entry.cityId === selection.requestedCity)
  const current = selection?.destinations?.find((entry) => entry.active)
  const destination = requested || current || selection?.destinations?.[0]
  const loadFailed = selection?.code === 'CITY_APP_LOAD_FAILED'
  return (
    <main className="runtime-city-failure" role="alert" data-city-runtime-status="blocked">
      <div className="runtime-city-failure-card">
        <div className="runtime-city-kicker">Coverage check</div>
        <h1>We stopped before loading listings.</h1>
        <p>{failureMessage(selection)}</p>
        <p className="runtime-city-failure-detail">
          Wuzup never substitutes another city&apos;s events, plans, or saved activity.
        </p>
        {destination?.href && (
          <a href={destination.href}>
            {loadFailed ? 'Try loading Wuzup again' : `Open ${destination.coverageLabel}`}
          </a>
        )}
      </div>
    </main>
  )
}
