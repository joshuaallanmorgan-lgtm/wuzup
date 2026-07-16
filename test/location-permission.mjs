import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LOCATION_PERMISSION_LEGACY_KEY,
  LOCATION_PERMISSION_STORAGE_KEY,
  createLocationPermissionController,
} from '../app/src/location-permission.js'

const CITY_ID = 'tampa-bay'

class MemoryScope {
  constructor({ cityId = CITY_ID, entries = [], readFailure = false, writeFailure = false } = {}) {
    this.cityId = cityId
    this.map = new Map(entries)
    this.readFailure = readFailure
    this.writeFailure = writeFailure
    this.writes = []
  }

  peekDurable(key) {
    if (this.readFailure) return { status: 'io-error', error: new Error('read blocked') }
    return this.map.has(key)
      ? { status: 'ok', value: this.map.get(key) }
      : { status: 'missing', value: null }
  }

  peek(key) {
    if (this.readFailure) return { status: 'io-error', error: new Error('read blocked') }
    return this.map.has(key)
      ? { status: 'ok', value: this.map.get(key) }
      : { status: 'missing', value: null }
  }

  set(key, value) {
    this.writes.push([key, value])
    if (this.writeFailure) return false
    this.map.set(key, String(value))
    return true
  }
}

class PermissionStatus {
  constructor(state) {
    this.state = state
    this.listeners = new Set()
  }

  addEventListener(type, listener) {
    if (type === 'change') this.listeners.add(listener)
  }

  removeEventListener(type, listener) {
    if (type === 'change') this.listeners.delete(listener)
  }

  change(state) {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}

class FakeGeolocation {
  constructor() {
    this.calls = []
  }

  getCurrentPosition(success, failure, options) {
    this.calls.push({ success, failure, options })
  }

  succeed(index = 0, coords = { latitude: 27.95, longitude: -82.46 }) {
    this.calls[index].success({ coords })
  }

  fail(index = 0, error = { code: 2, message: 'position unavailable' }) {
    this.calls[index].failure(error)
  }
}

class FakeClock {
  constructor() {
    this.nextId = 1
    this.timers = new Map()
  }

  setTimeout = (callback, delay) => {
    const id = this.nextId
    this.nextId += 1
    this.timers.set(id, { callback, delay })
    return id
  }

  clearTimeout = (id) => {
    this.timers.delete(id)
  }

  fire(id = [...this.timers.keys()][0]) {
    const timer = this.timers.get(id)
    if (!timer) return
    this.timers.delete(id)
    timer.callback()
  }
}

function permissionsFor(status) {
  return {
    calls: 0,
    async query(input) {
      this.calls += 1
      assert.deepEqual(input, { name: 'geolocation' })
      return status
    },
  }
}

function record(scope) {
  const raw = scope.map.get(LOCATION_PERMISSION_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

function controller({
  scope = new MemoryScope(),
  permission = new PermissionStatus('prompt'),
  geolocation = new FakeGeolocation(),
  clock = new FakeClock(),
  ...options
} = {}) {
  return {
    scope,
    permission,
    geolocation,
    clock,
    value: createLocationPermissionController({
      cityId: CITY_ID,
      storage: scope,
      permissions: permissionsFor(permission),
      geolocation,
      timeoutMs: 5000,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      ...options,
    }),
  }
}

test('prompt permission starts disabled and keeps a stable immutable snapshot', async () => {
  const { value, geolocation } = controller()
  const initial = value.getSnapshot()
  assert.equal(Object.isFrozen(initial), true)
  assert.equal(value.getSnapshot(), initial)

  let notifications = 0
  const unsubscribe = value.subscribe(() => {
    notifications += 1
  })
  await value.initialize()
  const ready = value.getSnapshot()
  assert.deepEqual(ready, {
    status: 'disabled',
    cityId: CITY_ID,
    desired: false,
    enabled: false,
    coords: null,
    permission: 'prompt',
    durability: 'durable',
    error: null,
  })
  assert.equal(geolocation.calls.length, 0)
  assert.equal(value.getSnapshot(), ready)
  assert.equal((await value.initialize()), ready)
  assert.equal(notifications, 1)

  unsubscribe()
  value.destroy()
})

test('legacy true is preserved as unverified intent and prompt never auto-requests', async () => {
  const legacy = '1'
  const scope = new MemoryScope({ entries: [[LOCATION_PERMISSION_LEGACY_KEY, legacy]] })
  const { value, geolocation } = controller({ scope })

  await value.initialize()
  assert.equal(value.getSnapshot().status, 'desired')
  assert.equal(value.getSnapshot().desired, true)
  assert.equal(value.getSnapshot().enabled, false)
  assert.equal(geolocation.calls.length, 0)
  assert.deepEqual(record(scope), {
    v: 1,
    cityId: CITY_ID,
    desired: true,
    enabled: false,
  })
  assert.equal(scope.map.get(LOCATION_PERMISSION_LEGACY_KEY), legacy)
})

test('a prior desire with granted permission may refresh silently and only then enables', async () => {
  const scope = new MemoryScope({
    entries: [[
      LOCATION_PERMISSION_STORAGE_KEY,
      JSON.stringify({ v: 1, cityId: CITY_ID, desired: true, enabled: true }),
    ]],
  })
  const permission = new PermissionStatus('granted')
  const { value, geolocation } = controller({ scope, permission })

  const pending = value.initialize()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(value.getSnapshot().status, 'requesting')
  assert.equal(value.getSnapshot().enabled, false)
  assert.equal(geolocation.calls.length, 1)
  assert.equal(record(scope).enabled, false, 'requesting must not remain durably enabled')

  geolocation.succeed()
  await pending
  assert.equal(value.getSnapshot().status, 'granted')
  assert.equal(value.getSnapshot().enabled, true)
  assert.deepEqual(value.getSnapshot().coords, { lat: 27.95, lng: -82.46 })
  assert.equal(record(scope).enabled, true)
})

test('disable during a deferred permission query wins over stale initialized intent', async () => {
  const scope = new MemoryScope({
    entries: [[
      LOCATION_PERMISSION_STORAGE_KEY,
      JSON.stringify({ v: 1, cityId: CITY_ID, desired: true, enabled: false }),
    ]],
  })
  const permission = new PermissionStatus('prompt')
  let resolveQuery
  const queryPending = new Promise((resolve) => {
    resolveQuery = resolve
  })
  const geolocation = new FakeGeolocation()
  const value = createLocationPermissionController({
    cityId: CITY_ID,
    storage: scope,
    permissions: { query: () => queryPending },
    geolocation,
  })

  const initializing = value.initialize()
  await Promise.resolve()
  const disabled = value.disable()
  assert.equal(disabled.status, 'disabled')
  assert.equal(disabled.desired, false)

  resolveQuery(permission)
  assert.equal(await initializing, value.getSnapshot())
  assert.equal(value.getSnapshot().status, 'disabled')
  assert.equal(value.getSnapshot().desired, false)
  assert.equal(value.getSnapshot().permission, 'prompt')
  assert.equal(geolocation.calls.length, 0)
  assert.deepEqual(record(scope), {
    v: 1,
    cityId: CITY_ID,
    desired: false,
    enabled: false,
  })
})

test('denied permission never calls geolocation, including after explicit action', async () => {
  const scope = new MemoryScope({
    entries: [[LOCATION_PERMISSION_LEGACY_KEY, '1']],
  })
  const permission = new PermissionStatus('denied')
  const { value, geolocation } = controller({ scope, permission })

  await value.initialize()
  assert.equal(value.getSnapshot().status, 'denied')
  const first = value.getSnapshot()
  const result = await value.request()
  assert.equal(result.status, 'denied')
  assert.equal(value.getSnapshot(), first)
  assert.equal(geolocation.calls.length, 0)
  assert.equal(record(scope).enabled, false)
})

test('missing or failing Permissions API support keeps intent idle until explicit action', async () => {
  const permissionInputs = [
    null,
    {
      async query() {
        throw new Error('Permissions API blocked')
      },
    },
  ]

  for (const permissions of permissionInputs) {
    const scope = new MemoryScope({
      entries: [[LOCATION_PERMISSION_LEGACY_KEY, '1']],
    })
    const geolocation = new FakeGeolocation()
    const value = createLocationPermissionController({
      cityId: CITY_ID,
      storage: scope,
      permissions,
      geolocation,
    })

    await value.initialize()
    assert.equal(value.getSnapshot().status, 'desired')
    assert.equal(value.getSnapshot().permission, 'unknown')
    assert.equal(value.getSnapshot().enabled, false)
    assert.equal(geolocation.calls.length, 0)

    const pending = value.request()
    assert.equal(geolocation.calls.length, 1)
    geolocation.succeed()
    assert.equal((await pending).status, 'granted')
    value.destroy()
  }
})

test('explicit prompt action dedupes concurrent requests and persists enabled after success', async () => {
  const { value, scope, geolocation } = controller()
  await value.initialize()

  const first = value.request()
  const second = value.request()
  assert.equal(second, first)
  assert.equal(geolocation.calls.length, 1)
  assert.equal(value.getSnapshot().status, 'requesting')
  assert.equal(record(scope).desired, true)
  assert.equal(record(scope).enabled, false)

  geolocation.succeed()
  const result = await first
  assert.equal(result, value.getSnapshot())
  assert.equal(result.status, 'granted')
  assert.equal(result.permission, 'granted')
  assert.equal(record(scope).enabled, true)
})

test('refresh and a granted permission change preserve and dedupe an active request', async () => {
  const permission = new PermissionStatus('prompt')
  const { value, geolocation } = controller({ permission })
  await value.initialize()

  const pending = value.request()
  assert.equal(value.refresh(), pending)
  permission.change('granted')
  assert.equal(value.getSnapshot().status, 'requesting')
  assert.equal(value.getSnapshot().permission, 'granted')
  assert.equal(value.refresh(), pending)
  assert.equal(geolocation.calls.length, 1)

  geolocation.succeed()
  assert.equal((await pending).status, 'granted')
})

test('the controller enforces its own bounded timeout', async () => {
  const { value, geolocation, clock, scope } = controller()
  await value.initialize()

  const pending = value.request()
  assert.equal(geolocation.calls[0].options.timeout, 5000)
  assert.equal([...clock.timers.values()][0].delay, 5000)
  clock.fire()
  const result = await pending
  assert.equal(result.status, 'error')
  assert.equal(result.error.code, 'location-timeout')
  assert.equal(result.enabled, false)
  assert.equal(record(scope).enabled, false)
})

test('disable cancels a request and ignores a late success from its old generation', async () => {
  const { value, geolocation, scope, clock } = controller()
  await value.initialize()

  const pending = value.request()
  assert.equal(value.getSnapshot().status, 'requesting')
  const disabled = value.disable()
  assert.equal(disabled.status, 'disabled')
  assert.equal(disabled.desired, false)
  assert.equal(disabled.coords, null)
  assert.equal(clock.timers.size, 0)
  assert.equal(await pending, disabled)

  geolocation.succeed()
  assert.equal(value.getSnapshot(), disabled)
  assert.deepEqual(record(scope), {
    v: 1,
    cityId: CITY_ID,
    desired: false,
    enabled: false,
  })
})

test('permission revocation cancels an active request and ignores its late callback', async () => {
  const permission = new PermissionStatus('prompt')
  const { value, geolocation, scope, clock } = controller({ permission })
  await value.initialize()

  const pending = value.request()
  assert.equal(value.getSnapshot().status, 'requesting')
  permission.change('denied')
  const denied = await pending
  assert.equal(denied.status, 'denied')
  assert.equal(denied.desired, true)
  assert.equal(denied.enabled, false)
  assert.equal(denied.coords, null)
  assert.equal(clock.timers.size, 0)

  geolocation.succeed()
  assert.equal(value.getSnapshot(), denied)
  assert.deepEqual(record(scope), {
    v: 1,
    cityId: CITY_ID,
    desired: true,
    enabled: false,
  })
})

test('permission revocation clears coordinates and disables effective location', async () => {
  const permission = new PermissionStatus('prompt')
  const { value, geolocation, scope } = controller({ permission })
  await value.initialize()
  const pending = value.request()
  geolocation.succeed()
  await pending
  assert.equal(value.getSnapshot().status, 'granted')

  permission.change('denied')
  assert.equal(value.getSnapshot().status, 'denied')
  assert.equal(value.getSnapshot().desired, true)
  assert.equal(value.getSnapshot().enabled, false)
  assert.equal(value.getSnapshot().coords, null)
  assert.equal(record(scope).enabled, false)
  assert.equal(geolocation.calls.length, 1)
})

test('a permission change to granted refreshes desired intent without another prompt', async () => {
  const scope = new MemoryScope({
    entries: [[LOCATION_PERMISSION_LEGACY_KEY, 'true']],
  })
  const permission = new PermissionStatus('prompt')
  const { value, geolocation } = controller({ scope, permission })
  await value.initialize()
  assert.equal(value.getSnapshot().status, 'desired')
  assert.equal(geolocation.calls.length, 0)

  permission.change('granted')
  assert.equal(value.getSnapshot().status, 'requesting')
  assert.equal(geolocation.calls.length, 1)
  geolocation.succeed()
  await Promise.resolve()
  assert.equal(value.getSnapshot().status, 'granted')
})

test('storage write failure keeps successful coordinates but tells the truth about session durability', async () => {
  const scope = new MemoryScope({ writeFailure: true })
  const { value, geolocation } = controller({ scope })
  await value.initialize()

  const pending = value.request()
  geolocation.succeed()
  const result = await pending
  assert.equal(result.status, 'granted')
  assert.equal(result.enabled, true)
  assert.deepEqual(result.coords, { lat: 27.95, lng: -82.46 })
  assert.equal(result.durability, 'session-only')
  assert.equal(result.error.code, 'location-storage-not-durable')
  assert.equal(scope.map.has(LOCATION_PERMISSION_STORAGE_KEY), false)
})

test('storage read failure is explicit and the controller remains session-usable', async () => {
  const scope = new MemoryScope({ readFailure: true, writeFailure: true })
  const { value, geolocation } = controller({ scope })
  await value.initialize()
  assert.equal(value.getSnapshot().status, 'error')
  assert.equal(value.getSnapshot().durability, 'session-only')
  assert.equal(value.getSnapshot().error.code, 'location-storage-unavailable')

  const pending = value.request()
  geolocation.succeed()
  const result = await pending
  assert.equal(result.status, 'granted')
  assert.equal(result.durability, 'session-only')
})

test('a synchronous geolocation exception settles the request and clears its timer', async () => {
  const geolocation = {
    calls: 0,
    getCurrentPosition() {
      this.calls += 1
      throw new Error('geolocation exploded')
    },
  }
  const { value, scope, clock } = controller({ geolocation })
  await value.initialize()

  const result = await value.request()
  assert.equal(geolocation.calls, 1)
  assert.equal(result.status, 'error')
  assert.equal(result.enabled, false)
  assert.equal(result.coords, null)
  assert.equal(result.error.code, 'location-request-failed')
  assert.equal(result.error.detail, 'geolocation exploded')
  assert.equal(clock.timers.size, 0)
  assert.deepEqual(record(scope), {
    v: 1,
    cityId: CITY_ID,
    desired: true,
    enabled: false,
  })
})

test('missing geolocation is unavailable and never claims effective enablement', async () => {
  const scope = new MemoryScope({
    entries: [[LOCATION_PERMISSION_LEGACY_KEY, '1']],
  })
  const { value } = controller({ scope, geolocation: null })
  await value.initialize()
  assert.equal(value.getSnapshot().status, 'unavailable')
  assert.equal(value.getSnapshot().desired, true)
  assert.equal(value.getSnapshot().enabled, false)
  assert.equal(value.getSnapshot().permission, 'unavailable')
  assert.equal((await value.request()).status, 'unavailable')
  assert.equal(record(scope).enabled, false)
})

test('invalid coordinates and browser errors never become granted', async () => {
  const first = controller()
  await first.value.initialize()
  const invalid = first.value.request()
  first.geolocation.succeed(0, { latitude: 1000, longitude: -82 })
  assert.equal((await invalid).error.code, 'location-invalid-coordinates')
  assert.equal(first.value.getSnapshot().enabled, false)

  const second = controller()
  await second.value.initialize()
  const denied = second.value.request()
  second.geolocation.fail(0, { code: 1, message: 'denied' })
  assert.equal((await denied).status, 'denied')
  assert.equal(second.value.getSnapshot().permission, 'denied')
  await second.value.request()
  assert.equal(second.geolocation.calls.length, 1, 'a known denial blocks later requests')
})

test('storage construction and records are scoped to the selected city', async () => {
  const scopes = new Map()
  const factory = ({ cityId }) => {
    const scope = new MemoryScope({ cityId })
    scopes.set(cityId, scope)
    return scope
  }
  const tampa = createLocationPermissionController({
    cityId: 'tampa-bay',
    storageFactory: factory,
    permissions: permissionsFor(new PermissionStatus('prompt')),
    geolocation: new FakeGeolocation(),
  })
  const sf = createLocationPermissionController({
    cityId: 'sf-east-bay',
    storageFactory: factory,
    permissions: permissionsFor(new PermissionStatus('prompt')),
    geolocation: new FakeGeolocation(),
  })
  await Promise.all([tampa.initialize(), sf.initialize()])
  tampa.disable()
  sf.disable()

  assert.equal(record(scopes.get('tampa-bay')).cityId, 'tampa-bay')
  assert.equal(record(scopes.get('sf-east-bay')).cityId, 'sf-east-bay')
  assert.notEqual(scopes.get('tampa-bay'), scopes.get('sf-east-bay'))
  assert.throws(
    () => createLocationPermissionController({
      cityId: 'tampa-bay',
      storage: new MemoryScope({ cityId: 'sf-east-bay' }),
    }),
    /scope does not match cityId/,
  )
})

test('destroy removes permission observation and settles an active request', async () => {
  const permission = new PermissionStatus('prompt')
  const { value, geolocation } = controller({ permission })
  await value.initialize()
  assert.equal(permission.listeners.size, 1)

  const pending = value.request()
  const beforeDestroy = value.getSnapshot()
  value.destroy()
  assert.equal(permission.listeners.size, 0)
  assert.equal(await pending, beforeDestroy)
  geolocation.succeed()
  permission.change('denied')
  assert.equal(value.getSnapshot(), beforeDestroy)
  value.destroy()
})
