// Framework-neutral geolocation permission controller.
//
// The durable preference deliberately separates user intent (`desired`) from
// effective use (`enabled`). A legacy "on" value is only intent until a fresh
// coordinate request succeeds. Coordinates themselves remain session-only.

export const LOCATION_PERMISSION_STORAGE_KEY = 'location-permission-v2'
export const LOCATION_PERMISSION_LEGACY_KEY = 'location-allowed-v1'
export const LOCATION_PERMISSION_RECORD_VERSION = 1
export const LOCATION_PERMISSION_STATES = Object.freeze([
  'disabled',
  'desired',
  'requesting',
  'granted',
  'denied',
  'unavailable',
  'error',
])

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PERMISSION_STATES = new Set(['granted', 'denied', 'prompt', 'unknown', 'unavailable'])
const PUBLIC_STATES = new Set(LOCATION_PERMISSION_STATES)

const frozenError = (code, detail = null) => Object.freeze({
  code,
  ...(detail ? { detail } : {}),
})

function normalizedPermission(value) {
  return PERMISSION_STATES.has(value) ? value : 'unknown'
}

function validCoords(value) {
  return value
    && Number.isFinite(value.lat)
    && value.lat >= -90
    && value.lat <= 90
    && Number.isFinite(value.lng)
    && value.lng >= -180
    && value.lng <= 180
}

function coordsFromPosition(position) {
  const coords = {
    lat: Number(position?.coords?.latitude),
    lng: Number(position?.coords?.longitude),
  }
  return validCoords(coords) ? Object.freeze(coords) : null
}

function equalCoords(left, right) {
  return left === right
    || Boolean(left && right && left.lat === right.lat && left.lng === right.lng)
}

function equalError(left, right) {
  return left === right
    || Boolean(left && right && left.code === right.code && left.detail === right.detail)
}

function freezeSnapshot(value) {
  const coords = value.coords && !Object.isFrozen(value.coords)
    ? Object.freeze({ ...value.coords })
    : value.coords
  const error = value.error && !Object.isFrozen(value.error)
    ? Object.freeze({ ...value.error })
    : value.error
  return Object.freeze({ ...value, coords, error })
}

function sameSnapshot(left, right) {
  return left.status === right.status
    && left.cityId === right.cityId
    && left.desired === right.desired
    && left.enabled === right.enabled
    && left.permission === right.permission
    && left.durability === right.durability
    && equalCoords(left.coords, right.coords)
    && equalError(left.error, right.error)
}

function preferenceRecord(cityId, desired, enabled) {
  return {
    v: LOCATION_PERMISSION_RECORD_VERSION,
    cityId,
    desired: desired === true,
    enabled: desired === true && enabled === true,
  }
}

function parsePreference(raw, cityId) {
  if (typeof raw !== 'string') return null
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value
      || typeof value !== 'object'
      || Array.isArray(value)
      || value.v !== LOCATION_PERMISSION_RECORD_VERSION
      || value.cityId !== cityId
      || typeof value.desired !== 'boolean'
      || typeof value.enabled !== 'boolean'
      || value.enabled && !value.desired) {
    return null
  }
  return {
    desired: value.desired,
    enabled: value.enabled,
  }
}

function legacyDesired(raw) {
  if (raw === true || raw === 1) return true
  if (typeof raw !== 'string') return false
  return ['1', 'true'].includes(raw.trim().toLowerCase())
}

function readResult(scope, method, key) {
  try {
    const reader = scope?.[method]
    if (typeof reader !== 'function') return null
    const result = reader.call(scope, key)
    if (result && typeof result === 'object' && typeof result.status === 'string') {
      return result
    }
    return result === null || result === undefined
      ? { status: 'missing', value: null }
      : { status: 'ok', value: result }
  } catch (error) {
    return { status: 'io-error', error }
  }
}

function strictRead(scope, key, { legacy = false } = {}) {
  const methods = legacy
    ? ['peek', 'get']
    : ['peekDurable', 'peek', 'get']
  for (const method of methods) {
    const result = readResult(scope, method, key)
    if (result) return result
  }
  return {
    status: 'io-error',
    error: new Error('Location storage is unavailable'),
  }
}

function loadPreference(scope, cityId) {
  const destination = strictRead(scope, LOCATION_PERMISSION_STORAGE_KEY)
  if (destination.status === 'io-error') return destination
  if (destination.status === 'ok') {
    const parsed = parsePreference(destination.value, cityId)
    return parsed
      ? { status: 'ok', ...parsed, source: 'destination' }
      : { status: 'invalid', desired: false, enabled: false }
  }

  const legacy = strictRead(scope, LOCATION_PERMISSION_LEGACY_KEY, { legacy: true })
  if (legacy.status === 'io-error') return legacy
  return {
    status: 'ok',
    desired: legacy.status === 'ok' && legacyDesired(legacy.value),
    enabled: false,
    source: legacy.status === 'ok' ? 'legacy' : 'default',
  }
}

function publicStateFor({ desired, permission, available }) {
  if (!available) return 'unavailable'
  if (!desired) return 'disabled'
  if (permission === 'denied') return 'denied'
  return 'desired'
}

function geolocationError(error) {
  if (error?.code === 1) {
    return {
      status: 'denied',
      permission: 'denied',
      error: frozenError('location-permission-denied'),
    }
  }
  if (error?.code === 2) {
    return {
      status: 'error',
      error: frozenError('location-position-unavailable', error?.message || null),
    }
  }
  if (error?.code === 3) {
    return {
      status: 'error',
      error: frozenError('location-timeout'),
    }
  }
  return {
    status: 'error',
    error: frozenError('location-request-failed', error?.message || null),
  }
}

export function createLocationPermissionController({
  cityId,
  storage = null,
  storageFactory = null,
  permissions = globalThis.navigator?.permissions ?? null,
  geolocation = globalThis.navigator?.geolocation ?? null,
  timeoutMs = 10_000,
  setTimeoutImpl = (callback, delay) => {
    const timer = globalThis.setTimeout(callback, delay)
    timer?.unref?.()
    return timer
  },
  clearTimeoutImpl = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  if (typeof cityId !== 'string' || !CITY_ID_RE.test(cityId)) {
    throw new TypeError('createLocationPermissionController requires a valid cityId')
  }
  if (storageFactory !== null && typeof storageFactory !== 'function') {
    throw new TypeError('storageFactory must be a function')
  }
  if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    throw new TypeError('timer dependencies must be functions')
  }

  const selectedCityId = cityId
  const scope = storage || storageFactory?.({ cityId: selectedCityId }) || null
  if (scope?.cityId && scope.cityId !== selectedCityId) {
    throw new TypeError('location storage scope does not match cityId')
  }
  const requestTimeoutMs = Math.min(
    60_000,
    Math.max(1, Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 10_000),
  )
  const listeners = new Set()
  let snapshot = freezeSnapshot({
    status: 'disabled',
    cityId: selectedCityId,
    desired: false,
    enabled: false,
    coords: null,
    permission: 'unknown',
    durability: 'unknown',
    error: null,
  })
  let permissionStatus = null
  let permissionChangeCleanup = null
  let initializePromise = null
  let initialized = false
  let destroyed = false
  let generation = 0
  let requestPromise = null
  let queuedRequestPromise = null
  let requestContext = null

  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // One subscriber must not prevent the others from observing state.
      }
    }
  }

  const publish = (patch = {}) => {
    const status = patch.status ?? snapshot.status
    const coords = patch.coords === undefined ? snapshot.coords : patch.coords
    const next = freezeSnapshot({
      status: PUBLIC_STATES.has(status) ? status : 'error',
      cityId: selectedCityId,
      desired: patch.desired ?? snapshot.desired,
      enabled: status === 'granted' && validCoords(coords),
      coords: validCoords(coords) ? coords : null,
      permission: normalizedPermission(patch.permission ?? snapshot.permission),
      durability: patch.durability ?? snapshot.durability,
      error: patch.error === undefined ? snapshot.error : patch.error,
    })
    if (sameSnapshot(snapshot, next)) return snapshot
    snapshot = next
    emit()
    return snapshot
  }

  const persist = (desired, enabled) => {
    const raw = JSON.stringify(preferenceRecord(selectedCityId, desired, enabled))
    let reported
    try {
      reported = scope?.set?.(LOCATION_PERMISSION_STORAGE_KEY, raw) === true
    } catch {
      reported = false
    }
    if (!reported) {
      return {
        durability: 'session-only',
        error: frozenError('location-storage-not-durable'),
      }
    }

    const landed = readResult(scope, 'peekDurable', LOCATION_PERMISSION_STORAGE_KEY)
    if (landed && (landed.status !== 'ok' || landed.value !== raw)) {
      return {
        durability: 'session-only',
        error: frozenError('location-storage-not-durable'),
      }
    }
    return { durability: 'durable', error: null }
  }

  const detachPermissionChange = () => {
    permissionChangeCleanup?.()
    permissionChangeCleanup = null
    permissionStatus = null
  }

  const cancelRequest = () => {
    generation += 1
    const context = requestContext
    requestContext = null
    requestPromise = null
    if (context?.timer !== null && context?.timer !== undefined) {
      clearTimeoutImpl(context.timer)
    }
    return context?.resolve || null
  }

  const settleRequest = (token, transform) => {
    if (destroyed || token !== generation || requestContext?.token !== token) return
    const context = requestContext
    requestContext = null
    requestPromise = null
    if (context.timer !== null && context.timer !== undefined) {
      clearTimeoutImpl(context.timer)
    }
    const next = transform()
    context.resolve(next)
  }

  const runPositionRequest = ({ force = false } = {}) => {
    if (destroyed) return Promise.resolve(snapshot)
    if (requestPromise) return requestPromise
    const available = typeof geolocation?.getCurrentPosition === 'function'
    if (!available) {
      const saved = persist(snapshot.desired, false)
      return Promise.resolve(publish({
        status: 'unavailable',
        coords: null,
        permission: 'unavailable',
        ...saved,
      }))
    }
    if (snapshot.permission === 'denied') {
      const saved = persist(snapshot.desired, false)
      return Promise.resolve(publish({
        status: snapshot.desired ? 'denied' : 'disabled',
        coords: null,
        ...saved,
      }))
    }
    if (!snapshot.desired) return Promise.resolve(snapshot)
    if (!force && snapshot.status === 'granted' && snapshot.coords) {
      return Promise.resolve(snapshot)
    }

    const intentSaved = persist(true, false)
    publish({
      status: 'requesting',
      desired: true,
      coords: null,
      ...intentSaved,
    })
    const token = ++generation
    let resolveRequest
    requestPromise = new Promise((resolve) => {
      resolveRequest = resolve
    })
    const pendingRequest = requestPromise
    requestContext = { token, resolve: resolveRequest, timer: null }
    requestContext.timer = setTimeoutImpl(() => {
      settleRequest(token, () => {
        const saved = persist(true, false)
        return publish({
          status: 'error',
          coords: null,
          ...saved,
          error: frozenError('location-timeout'),
        })
      })
    }, requestTimeoutMs)

    try {
      geolocation.getCurrentPosition(
        (position) => {
          settleRequest(token, () => {
            const coords = coordsFromPosition(position)
            if (!coords) {
              const saved = persist(true, false)
              return publish({
                status: 'error',
                coords: null,
                ...saved,
                error: frozenError('location-invalid-coordinates'),
              })
            }
            const saved = persist(true, true)
            return publish({
              status: 'granted',
              desired: true,
              coords,
              permission: 'granted',
              ...saved,
            })
          })
        },
        (error) => {
          settleRequest(token, () => {
            const failure = geolocationError(error)
            const saved = persist(true, false)
            return publish({
              ...failure,
              desired: true,
              coords: null,
              ...saved,
              error: failure.error,
            })
          })
        },
        {
          enableHighAccuracy: false,
          maximumAge: 0,
          timeout: requestTimeoutMs,
        },
      )
    } catch (error) {
      settleRequest(token, () => {
        const saved = persist(true, false)
        return publish({
          status: 'error',
          coords: null,
          ...saved,
          error: frozenError('location-request-failed', error?.message || null),
        })
      })
    }
    return pendingRequest
  }

  const refresh = () => {
    if (requestPromise) return requestPromise
    if (!snapshot.desired) return Promise.resolve(snapshot)
    if (snapshot.permission === 'denied') return Promise.resolve(snapshot)
    if (!['granted'].includes(snapshot.permission)) {
      return Promise.resolve(publish({
        status: publicStateFor({
          desired: snapshot.desired,
          permission: snapshot.permission,
          available: typeof geolocation?.getCurrentPosition === 'function',
        }),
        coords: null,
      }))
    }
    return runPositionRequest({ force: true })
  }

  const handlePermissionChange = () => {
    if (destroyed) return
    const permission = normalizedPermission(permissionStatus?.state)
    if (permission === 'granted') {
      publish({
        status: requestPromise
          ? 'requesting'
          : snapshot.desired ? 'desired' : 'disabled',
        permission,
        coords: null,
        error: null,
      })
      if (snapshot.desired && !requestPromise) refresh()
      return
    }

    const resolvePending = cancelRequest()
    const saved = persist(snapshot.desired, false)
    const next = publish({
      status: publicStateFor({
        desired: snapshot.desired,
        permission,
        available: typeof geolocation?.getCurrentPosition === 'function',
      }),
      coords: null,
      permission,
      ...saved,
    })
    resolvePending?.(next)
  }

  const attachPermissionChange = (nextStatus) => {
    detachPermissionChange()
    permissionStatus = nextStatus
    if (!nextStatus || typeof nextStatus !== 'object') return
    if (typeof nextStatus.addEventListener === 'function'
        && typeof nextStatus.removeEventListener === 'function') {
      nextStatus.addEventListener('change', handlePermissionChange)
      permissionChangeCleanup = () => {
        nextStatus.removeEventListener('change', handlePermissionChange)
      }
      return
    }
    const previous = nextStatus.onchange
    nextStatus.onchange = handlePermissionChange
    permissionChangeCleanup = () => {
      if (nextStatus.onchange === handlePermissionChange) nextStatus.onchange = previous || null
    }
  }

  const initialize = () => {
    if (destroyed) return Promise.resolve(snapshot)
    if (initializePromise) return initializePromise
    const initializeGeneration = generation
    initializePromise = Promise.resolve().then(async () => {
      const loaded = loadPreference(scope, selectedCityId)
      if (destroyed) return snapshot
      if (loaded.status === 'io-error') {
        initialized = true
        return publish({
          status: 'error',
          desired: false,
          coords: null,
          durability: 'session-only',
          error: frozenError('location-storage-unavailable'),
        })
      }
      if (loaded.status === 'invalid') {
        initialized = true
        return publish({
          status: 'error',
          desired: false,
          coords: null,
          durability: 'unknown',
          error: frozenError('location-preference-corrupt'),
        })
      }

      const desired = loaded.desired === true
      const available = typeof geolocation?.getCurrentPosition === 'function'
      if (!available) {
        initialized = true
        const saved = desired ? persist(true, false) : { durability: 'durable', error: null }
        return publish({
          status: 'unavailable',
          desired,
          coords: null,
          permission: 'unavailable',
          ...saved,
        })
      }

      let queried = null
      if (typeof permissions?.query === 'function') {
        try {
          queried = await permissions.query({ name: 'geolocation' })
        } catch {
          queried = null
        }
      }
      if (destroyed) return snapshot
      attachPermissionChange(queried)
      const permission = normalizedPermission(queried?.state)
      initialized = true
      if (initializeGeneration !== generation) {
        return publish({
          status: publicStateFor({
            desired: snapshot.desired,
            permission,
            available,
          }),
          coords: null,
          permission,
        })
      }

      if (desired && permission === 'granted') {
        publish({
          status: 'desired',
          desired: true,
          coords: null,
          permission,
          durability: loaded.source === 'destination' ? 'durable' : 'unknown',
          error: null,
        })
        return runPositionRequest({ force: true })
      }

      const saved = desired
        ? persist(true, false)
        : { durability: 'durable', error: null }
      return publish({
        status: publicStateFor({ desired, permission, available }),
        desired,
        coords: null,
        permission,
        ...saved,
      })
    })
    return initializePromise
  }

  const request = () => {
    if (destroyed) return Promise.resolve(snapshot)
    if (requestPromise) return requestPromise
    if (queuedRequestPromise) return queuedRequestPromise
    const start = () => {
      if (destroyed) return snapshot
      const available = typeof geolocation?.getCurrentPosition === 'function'
      if (!available) {
        const saved = persist(true, false)
        return publish({
          status: 'unavailable',
          desired: true,
          coords: null,
          permission: 'unavailable',
          ...saved,
        })
      }
      if (snapshot.permission === 'denied') {
        const saved = persist(true, false)
        return publish({
          status: 'denied',
          desired: true,
          coords: null,
          ...saved,
        })
      }
      publish({ desired: true, error: null })
      return runPositionRequest()
    }
    if (!initialized) {
      const token = generation
      queuedRequestPromise = initialize()
        .then(() => token === generation ? start() : snapshot)
        .finally(() => {
          queuedRequestPromise = null
        })
      return queuedRequestPromise
    }
    const started = start()
    return started && typeof started.then === 'function'
      ? started
      : Promise.resolve(started)
  }

  const disable = () => {
    if (destroyed) return snapshot
    const resolvePending = cancelRequest()
    const saved = persist(false, false)
    const next = publish({
      status: 'disabled',
      desired: false,
      coords: null,
      ...saved,
    })
    resolvePending?.(next)
    return next
  }

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    const resolvePending = cancelRequest()
    resolvePending?.(snapshot)
    queuedRequestPromise = null
    detachPermissionChange()
    listeners.clear()
  }

  return {
    cityId: selectedCityId,
    initialize,
    request,
    enable: request,
    refresh,
    disable,
    setDesired(on) {
      return on ? request() : disable()
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    destroy,
  }
}
