// planner-v1-source.js — a read-only capture seam for the planner's retained
// V1 inputs. It deliberately reads raw city-scoped values instead of calling
// the legacy loaders, whose migration and rollover side effects would mutate
// the evidence before the atomic V2 planner can translate it.

import { createStorageScope } from './storage.js'
import { fmtLocale } from './city.js'

export const PLANNER_V1_SOURCE_KEYS = Object.freeze({
  dayPlans: 'day-plans-v1',
  dayHistory: 'day-history-v1',
  weekendPlan: 'weekend-plan-v1',
  savedEvents: 'saved-events-v1',
  beenThere: 'been-there-v1',
  cityDayKeysBasis: 'city-day-keys-basis-v1',
  cityDayKeysReceipt: 'city-day-keys-v1',
})

const SOURCE_SHAPES = Object.freeze({
  dayPlans: { empty: () => ({}), accepts: isObject },
  dayHistory: { empty: () => [], accepts: Array.isArray },
  weekendPlan: { empty: () => null, accepts: (value) => value === null || isObject(value) },
  savedEvents: { empty: () => ({}), accepts: isObject },
  beenThere: { empty: () => [], accepts: Array.isArray },
})

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validTimeZone(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    new Intl.DateTimeFormat(fmtLocale, { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export class PlannerV1SourceError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'PlannerV1SourceError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new PlannerV1SourceError(code, message, details)
}

function requireCity(city) {
  if (!isObject(city) || typeof city.id !== 'string' || !city.id || !validTimeZone(city.tz)) {
    fail(
      'PLANNER_V1_INVALID_CITY',
      'city must include a non-empty id and valid IANA time zone',
    )
  }
  return city
}

function readRaw(scope) {
  if (!scope || typeof scope.peek !== 'function') {
    fail(
      'PLANNER_V1_STORAGE_INIT',
      'storageFactory must return a city storage scope with strict peek support',
    )
  }

  const raw = {}
  for (const [field, key] of Object.entries(PLANNER_V1_SOURCE_KEYS)) {
    let read
    try {
      read = scope.peek(key)
    } catch (cause) {
      fail('PLANNER_V1_STORAGE_READ', `Could not read ${key}`, {
        field,
        key,
        cause,
      })
    }
    if (!read || !['ok', 'missing'].includes(read.status)) {
      fail('PLANNER_V1_STORAGE_READ', `Could not read ${key}`, {
        field,
        key,
        cause: read?.error,
      })
    }
    const value = read.status === 'missing' ? null : read.value
    if (value !== null && typeof value !== 'string') {
      fail('PLANNER_V1_INVALID_RAW', `${key} must be a string or null`, {
        field,
        key,
        actualType: typeof value,
      })
    }
    raw[field] = value
  }
  return raw
}

function parseJson(raw, field, key, family) {
  let value
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    fail(`PLANNER_V1_CORRUPT_${family}`, `${key} contains malformed JSON`, {
      field,
      key,
      cause,
    })
  }
  return value
}

function parseSource(raw) {
  const source = {}
  for (const [field, contract] of Object.entries(SOURCE_SHAPES)) {
    const value = raw[field]
    if (value === null) {
      source[field] = contract.empty()
      continue
    }
    const parsed = parseJson(value, field, PLANNER_V1_SOURCE_KEYS[field], 'SOURCE')
    if (!contract.accepts(parsed)) {
      fail(
        'PLANNER_V1_INVALID_SOURCE',
        `${PLANNER_V1_SOURCE_KEYS[field]} has the wrong top-level shape`,
        { field, key: PLANNER_V1_SOURCE_KEYS[field] },
      )
    }
    source[field] = parsed
  }
  return source
}

function parseTimeMetadata(raw, field, city) {
  if (raw === null) return null
  const key = PLANNER_V1_SOURCE_KEYS[field]
  const value = parseJson(raw, field, key, 'METADATA')
  if (
    !isObject(value)
    || value.v !== 1
    || value.cityId !== city.id
    || value.timeZone !== city.tz
    || !validTimeZone(value.sourceDeviceTimeZone)
  ) {
    fail('PLANNER_V1_INVALID_METADATA', `${key} does not match the selected city`, {
      field,
      key,
      expectedCityId: city.id,
      expectedTimeZone: city.tz,
    })
  }
  return value
}

function sourceTimeZoneFor(raw, city, deviceTimeZone) {
  const basis = parseTimeMetadata(raw.cityDayKeysBasis, 'cityDayKeysBasis', city)
  const receipt = parseTimeMetadata(raw.cityDayKeysReceipt, 'cityDayKeysReceipt', city)

  if (basis && receipt && basis.sourceDeviceTimeZone !== receipt.sourceDeviceTimeZone) {
    fail(
      'PLANNER_V1_METADATA_CONFLICT',
      'The city day-key basis and receipt disagree about the source device time zone',
      {
        basisTimeZone: basis.sourceDeviceTimeZone,
        receiptTimeZone: receipt.sourceDeviceTimeZone,
      },
    )
  }
  if (basis) return basis.sourceDeviceTimeZone
  if (receipt) return receipt.sourceDeviceTimeZone
  if (!validTimeZone(deviceTimeZone)) {
    fail(
      'PLANNER_V1_INVALID_DEVICE_TIME_ZONE',
      'deviceTimeZone must be a valid IANA time zone when migration metadata is absent',
      { deviceTimeZone },
    )
  }
  return deviceTimeZone
}

export function capturePlannerV1Source({
  city,
  storageFactory = createStorageScope,
  deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
} = {}) {
  const selected = requireCity(city)
  let scope
  try {
    scope = storageFactory({ cityId: selected.id })
  } catch (cause) {
    fail('PLANNER_V1_STORAGE_INIT', 'Could not create the city storage scope', { cause })
  }

  const raw = readRaw(scope)
  const source = parseSource(raw)
  const sourceTimeZone = sourceTimeZoneFor(raw, selected, deviceTimeZone)
  return { source, sourceTimeZone, raw }
}
