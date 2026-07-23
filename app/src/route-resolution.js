// Strict city-bound resolution for durable query routes.
//
// Public links carry stable primary identities only. Resolution deliberately
// does not fall back to titles, URLs, first-wins aliases, or a different city:
// unavailable and ambiguous inventory stay explicit instead of opening the
// wrong detail page.

import { primaryKeyOf } from './identity.js'
import { normalizePlanCapsule } from './plan-capsule.js'
import { normalizeRouteState } from './route-state.js'
import { fmtLocale } from './city.js'

export const ROUTE_CATALOG_SCAN_MAX = 50_000

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TIME_ZONE_RE = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 80 || !TIME_ZONE_RE.test(value)) return false
  try {
    return new Intl.DateTimeFormat(fmtLocale, { timeZone: value }).resolvedOptions().timeZone === value
  } catch {
    return false
  }
}

function outcome(status, code, extras = {}) {
  return Object.freeze({ status, code, ...extras })
}

function itemPrimary(item, kind) {
  try {
    if (kind === 'guide') {
      if (!isObject(item)) return null
      const id = typeof item.id === 'string' ? item.id : null
      if (!id) return null
      return id.startsWith('g|') ? id : `g|${id}`
    }
    return primaryKeyOf(item)
  } catch {
    return null
  }
}

function catalogFor(target, catalogs) {
  if (target.kind === 'place') return catalogs.places
  if (target.kind === 'guide') return catalogs.guides
  if (target.id.startsWith('c|')) return catalogs.customEvents
  return catalogs.events
}

function resolveCatalogItem(target, catalogs) {
  const catalog = catalogFor(target, catalogs)
  if (!Array.isArray(catalog)) {
    return outcome('unavailable', 'ROUTE_CATALOG_UNAVAILABLE', { target })
  }
  if (catalog.length > ROUTE_CATALOG_SCAN_MAX) {
    return outcome('unavailable', 'ROUTE_CATALOG_TOO_LARGE', { target })
  }
  const matches = []
  for (let index = 0; index < catalog.length; index += 1) {
    const item = catalog[index]
    if (itemPrimary(item, target.kind) === target.id) matches.push(item)
  }
  if (matches.length === 0) return outcome('unavailable', 'ROUTE_ITEM_UNAVAILABLE', { target })
  if (matches.length > 1) {
    return outcome('ambiguous', 'ROUTE_ITEM_AMBIGUOUS', {
      target,
      candidateCount: matches.length,
    })
  }
  return outcome('resolved', 'ROUTE_ITEM_RESOLVED', { target, item: matches[0] })
}

function validCatalogBinding(catalogs, cityId, timeZone) {
  return isObject(catalogs)
    && catalogs.cityId === cityId
    && catalogs.timeZone === timeZone
}

/**
 * Resolve a normalized route against one manifest-bound city catalog.
 * `capsule` is the decoded payload itself, not a Planner command or document.
 */
export function resolveRouteState(value, {
  activeCityId,
  timeZone,
  catalogs = null,
  capsule = null,
} = {}) {
  const route = normalizeRouteState(value)
  if (!route
      || typeof activeCityId !== 'string'
      || !CITY_ID_RE.test(activeCityId)
      || !validTimeZone(timeZone)) {
    return outcome('invalid', 'ROUTE_RESOLUTION_INVALID')
  }
  if (route.cityId !== activeCityId) {
    return outcome('unavailable', 'ROUTE_CITY_UNAVAILABLE', {
      requestedCityId: route.cityId,
      activeCityId,
    })
  }

  const target = route.target
  if (target === null) {
    return outcome('resolved', 'ROUTE_TAB_RESOLVED', {
      route,
      value: Object.freeze({ kind: 'tab', tab: route.tab }),
    })
  }
  if (target.kind === 'day') {
    return outcome('resolved', 'ROUTE_DAY_RESOLVED', {
      route,
      value: Object.freeze({ kind: 'day', day: target.day }),
    })
  }
  if (target.kind === 'shared-plan') {
    const normalized = normalizePlanCapsule(capsule, { cityId: activeCityId, timeZone })
    return normalized
      ? outcome('resolved', 'ROUTE_SHARED_PLAN_RESOLVED', {
        route,
        value: Object.freeze({ kind: 'shared-plan', mode: 'read-only', capsule: normalized }),
      })
      : outcome('unavailable', 'ROUTE_SHARED_PLAN_UNAVAILABLE', { route })
  }

  if (!validCatalogBinding(catalogs, activeCityId, timeZone)) {
    return outcome('unavailable', 'ROUTE_CATALOG_BINDING_MISMATCH', { route })
  }
  const resolution = resolveCatalogItem(target, catalogs)
  return Object.freeze({ ...resolution, route })
}
