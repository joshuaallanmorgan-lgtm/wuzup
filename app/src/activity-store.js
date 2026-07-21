// activity-store.js — atomic browser persistence for retained activity memory.
//
// The pure document and FIFO rules live in activity-state-core.js. This module
// adapts them to the shared city store, translates strict V1 capture evidence
// into bounded migration context, and keeps replay commands catalog-free.

import {
  ACTIVITY_DOCUMENT_MAX_BYTES,
  ACTIVITY_EVENT_DECK_CAP,
  ACTIVITY_PLACE_DECK_CAP,
  ACTIVITY_RECENTS_CAP,
  activityRefOf,
  activityStateBytes,
  clearActivityCollection,
  clearActivityDecks,
  emptyActivityState,
  migrateV1ActivityState,
  normalizeActivityState,
  recordActivityRef,
} from './activity-state-core.js'
import { createAtomicCityStore } from './atomic-city-store.js'
import { captureRetainedV1Source } from './retained-v1-source.js'

export const ACTIVITY_STORAGE_KEY = 'activity-v2'
export const ACTIVITY_STORE_ID = 'activity'

const ENCODER = new TextEncoder()
const COLLECTIONS = new Set(['recents', 'eventDeck', 'placeDeck'])
const RECOVERABLE_CAPTURE_CODES = new Set([
  'RETAINED_V1_CORRUPT_SOURCE',
  'RETAINED_V1_INVALID_SOURCE',
  'RETAINED_V1_INVALID_RAW',
])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function jsonEqual(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function exactActivityDocument(value, cityId) {
  const normalized = normalizeActivityState(value, { cityId })
  return normalized && jsonEqual(normalized, value) ? normalized : null
}

function collectionKind(collection) {
  if (collection === 'placeDeck') return 'place'
  if (collection === 'eventDeck' || collection === 'recents') return 'event'
  return null
}

function canonicalRecord(collection, value) {
  if (!COLLECTIONS.has(collection)) return null
  const ref = activityRefOf(value, { kind: collectionKind(collection) })
  return ref ? { type: 'record', collection, ref } : null
}

export function activityRecordCommand(collection, item) {
  return canonicalRecord(collection, item)
}

export function activityClearCommand(collection) {
  return COLLECTIONS.has(collection) ? { type: 'clear', collection } : null
}

export function activityClearDecksCommand() {
  return { type: 'clear-decks' }
}

function reduceActivityDocument(cityId, document, command) {
  if (!isObject(command)) {
    return { document, changed: false, code: 'invalid-command' }
  }
  if (command.type === 'clear-decks') {
    const reduced = clearActivityDecks(document, { cityId })
    return {
      ...reduced,
      canonicalCommand: { type: 'clear-decks' },
    }
  }
  if (!COLLECTIONS.has(command.collection)) {
    return { document, changed: false, code: 'invalid-command' }
  }
  if (command.type === 'record') {
    const canonical = canonicalRecord(command.collection, command.ref)
    if (!canonical) return { document, changed: false, code: 'invalid-ref' }
    const reduced = recordActivityRef(document, {
      cityId,
      collection: canonical.collection,
      ref: canonical.ref,
    })
    return {
      ...reduced,
      canonicalCommand: canonical,
    }
  }
  if (command.type === 'clear') {
    const reduced = clearActivityCollection(document, {
      cityId,
      collection: command.collection,
    })
    return {
      ...reduced,
      canonicalCommand: {
        type: 'clear',
        collection: command.collection,
      },
    }
  }
  return { document, changed: false, code: 'invalid-command' }
}

function rawBytes(value) {
  return typeof value === 'string' ? ENCODER.encode(value).byteLength : 0
}

function compactEvidence(evidence = {}) {
  const out = {}
  for (const field of ['recents', 'eventDeck', 'placeDeck']) {
    const row = evidence[field]
    if (!isObject(row)) continue
    out[field] = {
      key: typeof row.key === 'string' ? row.key.slice(0, 160) : null,
      status: row.status === 'ok' ? 'ok' : 'missing',
      source: typeof row.source === 'string' ? row.source.slice(0, 160) : null,
      rawBytes: rawBytes(row.value),
    }
  }
  return out
}

export function captureActivityV1Source({
  city,
  capture = captureRetainedV1Source,
} = {}) {
  if (typeof capture !== 'function') throw new TypeError('capture must be a function')
  const captureDomain = (domain, empty) => {
    try {
      return { ...capture({ city, domain }), error: null }
    } catch (error) {
      if (!RECOVERABLE_CAPTURE_CODES.has(error?.code)) throw error
      return {
        source: empty,
        evidence: {},
        error: {
          domain,
          code: error.code,
        },
      }
    }
  }
  const recents = captureDomain('recents', { recents: [] })
  const eventDeck = captureDomain('eventDeck', { eventDeck: [] })
  const placeDeck = captureDomain('placeDeck', { placeDeck: [] })
  const captureErrors = [recents.error, eventDeck.error, placeDeck.error].filter(Boolean)
  return {
    source: {
      recents: recents.source.recents,
      eventDeck: eventDeck.source.eventDeck,
      placeDeck: placeDeck.source.placeDeck,
    },
    context: {
      evidence: compactEvidence({
        ...recents.evidence,
        ...eventDeck.evidence,
        ...placeDeck.evidence,
      }),
      ...(captureErrors.length > 0 ? { captureErrors } : {}),
    },
  }
}

function activitySource(source) {
  if (!isObject(source)) throw new TypeError('activity migration source must be an object')
  if (activityStateBytes(source) > ACTIVITY_DOCUMENT_MAX_BYTES) {
    throw new RangeError('activity migration source exceeds the byte limit')
  }
  const out = {}
  const overflow = []
  const contracts = [
    ['recents', ACTIVITY_RECENTS_CAP],
    ['eventDeck', ACTIVITY_EVENT_DECK_CAP],
    ['placeDeck', ACTIVITY_PLACE_DECK_CAP],
  ]
  for (const [field, cap] of contracts) {
    const rows = source[field] ?? []
    if (!Array.isArray(rows)) throw new TypeError(`${field} must be an array`)
    if (rows.length > cap) {
      overflow.push({
        field,
        sourceCount: rows.length,
        retainedCap: cap,
      })
    }
    out[field] = rows
  }
  return { input: out, overflow }
}

function migrateActivityDocument(source, context) {
  const { input, overflow } = activitySource(source)
  const cityId = context?.city?.id
  const document = migrateV1ActivityState(input, {
    cityId,
    events: context?.events,
    places: context?.places,
    seeds: context?.seeds,
  })
  if (!document) throw new TypeError('activity migration did not produce a valid document')
  const captureErrors = Array.isArray(context?.captureErrors)
    ? context.captureErrors
        .filter((row) => isObject(row) && typeof row.domain === 'string' && typeof row.code === 'string')
        .slice(0, 3)
        .map((row) => ({
          domain: row.domain.slice(0, 32),
          code: row.code.slice(0, 64),
        }))
    : []
  const partial = captureErrors.length > 0
  const truncated = overflow.length > 0
  return {
    document,
    status: partial && truncated
      ? 'migrated-v1-activity-partial-truncated'
      : partial
        ? 'migrated-v1-activity-partial'
        : truncated
          ? 'migrated-v1-activity-truncated'
          : 'migrated-v1-activity',
    diagnostics: {
      evidence: isObject(context?.evidence) ? context.evidence : {},
      ...(captureErrors.length > 0 ? { captureErrors } : {}),
      ...(overflow.length > 0 ? { overflow } : {}),
    },
    sourceSummary: {
      recents: input.recents.length,
      eventDeck: input.eventDeck.length,
      placeDeck: input.placeDeck.length,
    },
  }
}

export function createActivityStore({
  city,
  storageFactory,
  lockManager,
  eventTarget,
  now,
  createId,
  contextId,
} = {}) {
  const options = {
    city,
    storageKey: ACTIVITY_STORAGE_KEY,
    storeId: ACTIVITY_STORE_ID,
    emptyDocument: () => emptyActivityState(city?.id),
    validateDocument: (value) => exactActivityDocument(value, city?.id),
    documentBytes: activityStateBytes,
    maxBytes: ACTIVITY_DOCUMENT_MAX_BYTES,
    reduceDocument: (document, command) => reduceActivityDocument(city.id, document, command),
    canonicalizeCommand: (_command, reduced) => reduced?.canonicalCommand || null,
    migrate: migrateActivityDocument,
  }
  if (storageFactory !== undefined) options.storageFactory = storageFactory
  if (lockManager !== undefined) options.lockManager = lockManager
  if (eventTarget !== undefined) options.eventTarget = eventTarget
  if (now !== undefined) options.now = now
  if (createId !== undefined) options.createId = createId
  if (contextId !== undefined) options.contextId = contextId
  return createAtomicCityStore(options)
}
