// retained-v1-source.js — strict, read-only capture for retained V1 browser
// state. Atomic V2 stores can inspect and translate these bytes without
// triggering storage.js's legacy copy, ownership claim, tombstone, or
// session-fallback behavior.

import { createStorageScope } from './storage.js'

export const RETAINED_V1_SOURCE_KEYS = Object.freeze({
  customEvents: 'my-events-v1',
  savedEvents: 'saved-events-v1',
  beenThere: 'been-there-v1',
  recents: 'recents-v1',
  eventDeck: 'deck-last-v1',
  placeDeck: 'deck-last-places-v1',
})

export const RETAINED_V1_SOURCE_DOMAINS = Object.freeze({
  custom: Object.freeze(['customEvents']),
  saved: Object.freeze(['savedEvents', 'beenThere']),
  recents: Object.freeze(['recents']),
  decks: Object.freeze(['eventDeck', 'placeDeck']),
  eventDeck: Object.freeze(['eventDeck']),
  placeDeck: Object.freeze(['placeDeck']),
})

const SOURCE_SHAPES = Object.freeze({
  customEvents: { empty: () => [], accepts: Array.isArray },
  savedEvents: { empty: () => ({}), accepts: isObject },
  beenThere: { empty: () => [], accepts: Array.isArray },
  recents: { empty: () => [], accepts: Array.isArray },
  eventDeck: { empty: () => [], accepts: Array.isArray },
  placeDeck: { empty: () => [], accepts: Array.isArray },
})

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class RetainedV1SourceError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'RetainedV1SourceError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new RetainedV1SourceError(code, message, details)
}

function requireCity(city) {
  if (!isObject(city) || typeof city.id !== 'string' || !CITY_ID_RE.test(city.id)) {
    fail(
      'RETAINED_V1_INVALID_CITY',
      'city must include a valid non-empty id',
      { cityId: city?.id },
    )
  }
  return city
}

function captureReads(scope, fields) {
  if (!scope || typeof scope.peek !== 'function') {
    fail(
      'RETAINED_V1_STORAGE_INIT',
      'storageFactory must return a city storage scope with strict peek support',
    )
  }
  if (typeof scope.cityId === 'string' && scope.cityId !== fields.cityId) {
    fail('RETAINED_V1_STORAGE_CITY_MISMATCH', 'storage scope does not match the selected city', {
      expectedCityId: fields.cityId,
      actualCityId: scope.cityId,
    })
  }

  const raw = {}
  const evidence = {}
  for (const field of fields.names) {
    const key = RETAINED_V1_SOURCE_KEYS[field]
    let read
    try {
      read = scope.peek(key)
    } catch (cause) {
      fail('RETAINED_V1_STORAGE_READ', `Could not read ${key}`, {
        field,
        key,
        cause,
      })
    }
    if (!read || !['ok', 'missing'].includes(read.status)) {
      fail('RETAINED_V1_STORAGE_READ', `Could not read ${key}`, {
        field,
        key,
        cause: read?.error,
      })
    }

    const value = read.status === 'missing' ? null : read.value
    if (read.status === 'ok' && value !== null && typeof value !== 'string') {
      fail('RETAINED_V1_INVALID_RAW', `${key} must contain raw string bytes`, {
        field,
        key,
        actualType: value === null ? 'null' : typeof value,
      })
    }

    raw[field] = value
    evidence[field] = Object.freeze({
      key,
      status: read.status,
      value,
      source: read.status === 'ok' ? (read.source ?? null) : null,
    })
  }

  return {
    raw: Object.freeze(raw),
    evidence: Object.freeze(evidence),
  }
}

function parseSource(raw, fields) {
  const source = {}
  for (const field of fields) {
    const contract = SOURCE_SHAPES[field]
    const value = raw[field]
    if (value === null) {
      source[field] = contract.empty()
      continue
    }

    let parsed
    try {
      parsed = JSON.parse(value)
    } catch (cause) {
      const key = RETAINED_V1_SOURCE_KEYS[field]
      fail('RETAINED_V1_CORRUPT_SOURCE', `${key} contains malformed JSON`, {
        field,
        key,
        cause,
      })
    }
    if (!contract.accepts(parsed)) {
      const key = RETAINED_V1_SOURCE_KEYS[field]
      fail('RETAINED_V1_INVALID_SOURCE', `${key} has the wrong top-level shape`, {
        field,
        key,
      })
    }

    // Deliberately do not validate or filter child rows here. In particular,
    // malformed custom-event rows are migration evidence that the destination
    // store must retain or diagnose rather than silently erase.
    source[field] = parsed
  }
  return source
}

export function captureRetainedV1Source({
  city,
  domain,
  storageFactory = createStorageScope,
} = {}) {
  const selected = requireCity(city)
  const fields = RETAINED_V1_SOURCE_DOMAINS[domain]
  if (!fields) {
    fail(
      'RETAINED_V1_INVALID_DOMAIN',
      'domain must select a retained V1 source group',
      { domain },
    )
  }
  let scope
  try {
    scope = storageFactory({ cityId: selected.id })
  } catch (cause) {
    fail('RETAINED_V1_STORAGE_INIT', 'Could not create the city storage scope', {
      cause,
    })
  }

  const { raw, evidence } = captureReads(scope, {
    cityId: selected.id,
    names: fields,
  })
  return {
    source: parseSource(raw, fields),
    raw,
    evidence,
  }
}
