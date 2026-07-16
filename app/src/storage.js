// storage.js — the one durable-state seam.
//
// V2 makes browser state city-scoped by default because Tampa and SF share one
// GitHub Pages origin. Logical callers keep using lsGet/lsSet/lsRemove; this
// module maps them to versioned physical keys and owns migration, quota guards,
// and a session-memory fallback. Profile identity is the only intentional
// global scope and uses the explicit global helpers below.
//
// Legacy `twh:<key>` and ancient bare keys have unknowable city provenance.
// Unowned or invalid migration metadata resolves deterministically to Tampa,
// V1's canonical/root city, so simultaneous city tabs cannot both inherit it.
// Migration is copy-only for one release so rollback can still read the
// untouched V1 bytes. A destination is never overwritten.
import { CITIES, CITY } from './city.js'

export const STORAGE_VERSION = 2
export const LEGACY_PREFIX = 'twh:'
export const LEGACY_FALLBACK_CITY_ID = 'tampa-bay'
export const LEGACY_OWNER_KEY = 'twh:v2:g:legacy-city-migration-v1'

const LOGICAL_KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,159}$/i
const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const KNOWN_CITY_IDS = new Set(Object.keys(CITIES))
const TOMBSTONE = '__wuzup_v2_deleted__'
const VALUE_PREFIX = '__wuzup_v2_value__:'

function encodeValue(value) {
  return VALUE_PREFIX + JSON.stringify(String(value))
}

function decodeValue(value) {
  if (value === TOMBSTONE) return null
  if (typeof value !== 'string' || !value.startsWith(VALUE_PREFIX)) return value
  try {
    const decoded = JSON.parse(value.slice(VALUE_PREFIX.length))
    return typeof decoded === 'string' ? decoded : value
  } catch {
    return value
  }
}

function checkedKey(key) {
  if (typeof key !== 'string' || !LOGICAL_KEY_RE.test(key)) {
    throw new TypeError(`Invalid storage key '${String(key)}'`)
  }
  return key
}

function checkedCityId(cityId) {
  if (typeof cityId !== 'string' || !CITY_ID_RE.test(cityId)) {
    throw new TypeError(`Invalid storage city '${String(cityId)}'`)
  }
  return cityId
}

export function physicalKey(key, { scope = 'city', cityId = CITY.id } = {}) {
  const logical = checkedKey(key)
  if (scope === 'global') return `twh:v${STORAGE_VERSION}:g:${logical}`
  if (scope !== 'city') throw new TypeError(`Invalid storage scope '${String(scope)}'`)
  return `twh:v${STORAGE_VERSION}:c:${checkedCityId(cityId)}:${logical}`
}

export const PREFIX = `twh:v${STORAGE_VERSION}:c:${CITY.id}:`
export const GLOBAL_PREFIX = `twh:v${STORAGE_VERSION}:g:`

function validOwnerReceipt(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.v === 1
    && KNOWN_CITY_IDS.has(value.ownerCityId)
}

export function createStorageScope({ backend = null, backendProvider = null, cityId } = {}) {
  const selectedCity = checkedCityId(cityId)
  const memory = new Map()

  const getBackend = () => {
    try {
      return backend || backendProvider?.() || globalThis.localStorage || null
    } catch {
      return null
    }
  }

  const rawGet = (key) => {
    try {
      return getBackend()?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  const rawSet = (key, value) => {
    try {
      const storage = getBackend()
      if (!storage) return false
      storage.setItem(key, String(value))
      return storage.getItem(key) === String(value)
    } catch {
      return false
    }
  }

  const legacyValue = (key) => {
    const prefixed = rawGet(LEGACY_PREFIX + key)
    return prefixed !== null ? prefixed : rawGet(key)
  }

  const legacyOwner = () => {
    const raw = rawGet(LEGACY_OWNER_KEY)
    if (raw !== null) {
      try {
        const receipt = JSON.parse(raw)
        if (validOwnerReceipt(receipt)) return receipt.ownerCityId
      } catch {
        // Invalid control metadata is repaired below. V1 ignores this receipt,
        // while its actual user payloads remain untouched for rollback.
      }
    }
    const receipt = JSON.stringify({ v: 1, ownerCityId: LEGACY_FALLBACK_CITY_ID })
    if (!rawSet(LEGACY_OWNER_KEY, receipt)) return null
    try {
      const landed = JSON.parse(rawGet(LEGACY_OWNER_KEY))
      return validOwnerReceipt(landed) ? landed.ownerCityId : null
    } catch {
      return null
    }
  }

  const getFor = (key, scope) => {
    const logical = checkedKey(key)
    const destination = physicalKey(logical, { scope, cityId: selectedCity })
    if (memory.has(destination)) return decodeValue(memory.get(destination))
    const current = rawGet(destination)
    if (current !== null) return decodeValue(current)

    const legacy = legacyValue(logical)
    if (legacy === null) return null
    if (scope === 'city' && legacyOwner() !== selectedCity) return null

    // Copy-only and destination-first. Every V2 write is enveloped so a user
    // string can never collide with the tombstone. When quota blocks the copy,
    // the owner still dual-reads legacy bytes and the next boot retries.
    rawSet(destination, encodeValue(legacy))
    const migrated = rawGet(destination)
    return migrated === null ? legacy : decodeValue(migrated)
  }

  const readDurableFor = (key, scope) => {
    const destination = physicalKey(key, { scope, cityId: selectedCity })
    return decodeValue(rawGet(destination))
  }

  const setFor = (key, value, scope) => {
    const destination = physicalKey(key, { scope, cityId: selectedCity })
    const encoded = encodeValue(value)
    if (rawSet(destination, encoded)) {
      memory.delete(destination)
      return true
    }
    memory.set(destination, encoded)
    return false
  }

  const removeFor = (key, scope) => {
    const destination = physicalKey(key, { scope, cityId: selectedCity })
    // A physical absence is ambiguous while copy-only rollback data remains:
    // it could mean "not migrated yet" or "the user deleted it in V2". Keep a
    // tiny V2 tombstone so reset/remove never resurrects the legacy value.
    if (rawSet(destination, TOMBSTONE)) {
      memory.delete(destination)
      return true
    }
    memory.set(destination, TOMBSTONE)
    return false
  }

  const readJsonFor = (key, { scope = 'city', validate = null, fallback = null } = {}) => {
    const raw = getFor(key, scope)
    if (raw === null) return { status: 'missing', value: fallback }
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      return { status: 'corrupt', value: fallback }
    }
    if (validate && !validate(value)) return { status: 'invalid', value: fallback }
    return { status: 'ok', value }
  }

  return {
    cityId: selectedCity,
    prefix: `twh:v${STORAGE_VERSION}:c:${selectedCity}:`,
    get: (key) => getFor(key, 'city'),
    // Physical V2 bytes only: no session-memory fallback, legacy read/copy, or
    // ownership claim. Atomic stores use this to verify that a write actually
    // landed durably rather than merely becoming session-readable.
    readDurable: (key) => readDurableFor(key, 'city'),
    set: (key, value) => setFor(key, value, 'city'),
    remove: (key) => removeFor(key, 'city'),
    getGlobal: (key) => getFor(key, 'global'),
    setGlobal: (key, value) => setFor(key, value, 'global'),
    removeGlobal: (key) => removeFor(key, 'global'),
    readJson: readJsonFor,
  }
}

// Resolve globalThis.localStorage per operation rather than at module import so
// Node tests, privacy modes, and late test shims remain safe.
const activeStorage = createStorageScope({
  cityId: CITY.id,
  backendProvider: () => globalThis.localStorage,
})

export const lsGet = (key) => activeStorage.get(key)
export const lsSet = (key, value) => activeStorage.set(key, value)
export const lsRemove = (key) => activeStorage.remove(key)
export const globalGet = (key) => activeStorage.getGlobal(key)
export const globalSet = (key, value) => activeStorage.setGlobal(key, value)
export const globalRemove = (key) => activeStorage.removeGlobal(key)
export const lsReadJson = (key, options) => activeStorage.readJson(key, options)
