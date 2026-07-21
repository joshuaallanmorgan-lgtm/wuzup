// Pure durable-route contract for the static GitHub Pages deployment.
//
// Wuzup deliberately keeps product state in the query string instead of
// inventing server-rewritten paths. A refresh therefore requests the real
// deployment directory while the browser still carries enough stable identity
// to reopen a tab, item, day, or read-only shared plan.

export const ROUTE_STATE_VERSION = 1
export const ROUTE_QUERY_MAX_BYTES = 2048

export const ROUTE_TABS = Object.freeze(['home', 'events', 'spots', 'plan', 'profile'])
export const ROUTE_TARGET_KINDS = Object.freeze(['event', 'place', 'guide', 'day', 'shared-plan'])
export const ROUTE_TAB_TO_NAV_ID = Object.freeze({
  home: 'home',
  events: 'hot',
  spots: 'locations',
  plan: 'calendar',
  profile: 'profile',
})
export const NAV_ID_TO_ROUTE_TAB = Object.freeze(Object.fromEntries(
  Object.entries(ROUTE_TAB_TO_NAV_ID).map(([routeTab, navId]) => [navId, routeTab]),
))

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EVENT_ID_RE = /^e\|[0-9a-f]{16}$/
const CUSTOM_ID_RE = /^c\|[a-z0-9][a-z0-9_-]{7,63}$/i
const PLACE_ID_RE = /^p\|[a-z0-9][a-z0-9._:-]{0,159}$/i
const GUIDE_ID_RE = /^g\|[a-z0-9][a-z0-9._:-]{0,159}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const ENCODER = new TextEncoder()
const OWNED_QUERY_KEYS = Object.freeze(['city', 'tab', 'event', 'place', 'guide', 'day', 'shared'])
const TARGET_QUERY_KEYS = Object.freeze(['event', 'place', 'guide', 'day', 'shared'])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const bytes = (value) => ENCODER.encode(String(value)).byteLength

function exactFields(value, allowed, required = allowed) {
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key)) && required.every((key) => hasOwn(value, key))
}

function validDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function validRouteIdentity(kind, value) {
  if (typeof value !== 'string') return false
  if (kind === 'event') return EVENT_ID_RE.test(value) || CUSTOM_ID_RE.test(value)
  if (kind === 'place') return PLACE_ID_RE.test(value)
  if (kind === 'guide') return GUIDE_ID_RE.test(value)
  return false
}

export function routeTabToNavId(value) {
  return ROUTE_TAB_TO_NAV_ID[value] ?? null
}

export function navIdToRouteTab(value) {
  return NAV_ID_TO_ROUTE_TAB[value] ?? null
}

function defaultTab(kind) {
  if (kind === 'event' || kind === 'guide') return 'events'
  if (kind === 'place') return 'spots'
  if (kind === 'day' || kind === 'shared-plan') return 'plan'
  return 'home'
}

function normalizeTarget(value) {
  if (value === null) return null
  if (!isObject(value) || !ROUTE_TARGET_KINDS.includes(value.kind)) return null
  if (value.kind === 'shared-plan') {
    return exactFields(value, ['kind']) ? Object.freeze({ kind: 'shared-plan' }) : null
  }
  if (value.kind === 'day') {
    return exactFields(value, ['kind', 'day']) && validDay(value.day)
      ? Object.freeze({ kind: 'day', day: value.day })
      : null
  }
  return exactFields(value, ['kind', 'id']) && validRouteIdentity(value.kind, value.id)
    ? Object.freeze({ kind: value.kind, id: value.id })
    : null
}

export function normalizeRouteState(value) {
  if (!exactFields(value, ['v', 'cityId', 'tab', 'target'])) return null
  if (value.v !== ROUTE_STATE_VERSION
      || typeof value.cityId !== 'string'
      || !CITY_ID_RE.test(value.cityId)
      || !ROUTE_TABS.includes(value.tab)) return null
  const target = normalizeTarget(value.target)
  if (value.target !== null && target === null) return null
  return Object.freeze({
    v: ROUTE_STATE_VERSION,
    cityId: value.cityId,
    tab: value.tab,
    target,
  })
}

function failure(code) {
  return Object.freeze({ ok: false, code, route: null })
}

function queryString(value) {
  if (value === undefined || value === null || value === '') return ''
  if (value instanceof URLSearchParams) return value.toString()
  if (typeof value !== 'string') return null
  return value.replace(/^\?/, '')
}

/** Parse only Wuzup-owned keys; unrelated campaign parameters remain harmless. */
export function parseRouteQuery(value) {
  const raw = queryString(value)
  if (raw === null || bytes(raw) > ROUTE_QUERY_MAX_BYTES) return failure('ROUTE_QUERY_TOO_LARGE')
  if (/%(?![0-9a-f]{2})/i.test(raw)) return failure('ROUTE_QUERY_INVALID_ENCODING')

  let params
  try {
    params = new URLSearchParams(raw)
  } catch {
    return failure('ROUTE_QUERY_INVALID_ENCODING')
  }
  for (const key of OWNED_QUERY_KEYS) {
    if (params.getAll(key).length > 1) return failure('ROUTE_QUERY_DUPLICATE_KEY')
  }

  const cityId = params.get('city')
  if (typeof cityId !== 'string' || !CITY_ID_RE.test(cityId)) return failure('ROUTE_CITY_INVALID')
  const targets = TARGET_QUERY_KEYS.filter((key) => params.has(key))
  if (targets.length > 1) return failure('ROUTE_TARGET_CONFLICT')

  let target = null
  const targetKey = targets[0]
  if (targetKey === 'shared') {
    if (params.get('shared') !== 'plan') return failure('ROUTE_TARGET_INVALID')
    target = { kind: 'shared-plan' }
  } else if (targetKey === 'day') {
    target = { kind: 'day', day: params.get('day') }
  } else if (targetKey) {
    target = { kind: targetKey, id: params.get(targetKey) }
  }

  const tab = params.get('tab') || defaultTab(target?.kind)
  const route = normalizeRouteState({ v: ROUTE_STATE_VERSION, cityId, tab, target })
  return route
    ? Object.freeze({ ok: true, code: 'ROUTE_READY', route })
    : failure('ROUTE_TARGET_INVALID')
}

export function serializeRouteQuery(value) {
  const route = normalizeRouteState(value)
  if (!route) throw new TypeError('route state is invalid')
  const params = new URLSearchParams()
  params.set('city', route.cityId)
  params.set('tab', route.tab)
  if (route.target?.kind === 'shared-plan') params.set('shared', 'plan')
  else if (route.target?.kind === 'day') params.set('day', route.target.day)
  else if (route.target) params.set(route.target.kind, route.target.id)
  const query = `?${params.toString()}`
  if (bytes(query) > ROUTE_QUERY_MAX_BYTES) throw new TypeError('route query is too large')
  return query
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
      || /[\\?#\s]/.test(value)) throw new TypeError('baseUrl must be a safe root-relative path')
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new TypeError('baseUrl contains invalid encoding')
  }
  if (decoded !== value || decoded.split('/').some((part) => part === '.' || part === '..')) {
    throw new TypeError('baseUrl contains an encoded or dot segment')
  }
  const collapsed = value.replace(/\/{2,}/g, '/')
  return collapsed.endsWith('/') ? collapsed : `${collapsed}/`
}

/** Return a refresh-safe href rooted at the real static deployment directory. */
export function serializeRouteHref(value, { baseUrl = '/' } = {}) {
  return `${normalizeBaseUrl(baseUrl)}${serializeRouteQuery(value)}`
}
