// saved-been-store.js — atomic browser persistence for Saves and Been.
//
// The pure state contract lives in saved-been-state-core.js. This adapter owns
// only strict V1 capture, city-store configuration, migration catalog routing,
// and bounded replay-safe command construction.

import {
  SAVED_BEEN_COMMAND_MAX_BYTES,
  SAVED_BEEN_DOCUMENT_MAX_BYTES,
  SAVED_BEEN_IMPORT_MAX_BYTES,
  addSaved,
  canonicalizeSavedBeenCommand,
  emptySavedBeenState,
  migrateV1SavedBeenState,
  normalizeSavedBeenState,
  reduceSavedBeenState,
  savedBeenRefOf,
  savedBeenStateBytes,
} from './saved-been-state-core.js'
import { createAtomicCityStore } from './atomic-city-store.js'
import { captureRetainedV1Source } from './retained-v1-source.js'

export const SAVED_BEEN_STORAGE_KEY = 'saved-been-v2'
export const SAVED_BEEN_STORE_ID = 'saved-been'

const BUILDER_CITY_ID = 'command-builder'
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const validTime = (value) => Number.isSafeInteger(value) && value >= 0
const validToken = (value) => Number.isSafeInteger(value) && value > 0

function jsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

const JSON_DOMAIN_NODE_MAX = 200_000

function isPlainJsonDomain(value, state = { nodes: 0, seen: new WeakSet() }) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || state.seen.has(value)) return false
  state.nodes += 1
  if (state.nodes > JSON_DOMAIN_NODE_MAX) return false

  let prototype
  let keys
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return false
  }
  const array = Array.isArray(value)
  if (prototype !== (array ? Array.prototype : Object.prototype)) return false
  if (keys.some((key) => typeof key !== 'string')) return false

  if (array) {
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false
    for (let index = 0; index < value.length; index += 1) {
      if (!keys.includes(String(index))) return false
    }
  } else if (keys.includes('toJSON')) {
    return false
  }

  state.seen.add(value)
  try {
    for (const key of keys) {
      if (array && key === 'length') continue
      let descriptor
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key)
      } catch {
        return false
      }
      if (!descriptor
          || !hasOwn(descriptor, 'value')
          || descriptor.enumerable !== true
          || !isPlainJsonDomain(descriptor.value, state)) return false
    }
    return true
  } finally {
    state.seen.delete(value)
  }
}

function plainJsonEqual(left, right) {
  if (left === right) return true
  if (left === null || right === null || typeof left !== typeof right) return false
  if (typeof left !== 'object') return Object.is(left, right)
  if (Array.isArray(left) !== Array.isArray(right)) return false

  const leftKeys = Reflect.ownKeys(left)
    .filter((key) => !(Array.isArray(left) && key === 'length'))
    .sort()
  const rightKeys = Reflect.ownKeys(right)
    .filter((key) => !(Array.isArray(right) && key === 'length'))
    .sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false
    const leftValue = Object.getOwnPropertyDescriptor(left, leftKeys[index])?.value
    const rightValue = Object.getOwnPropertyDescriptor(right, rightKeys[index])?.value
    if (!plainJsonEqual(leftValue, rightValue)) return false
  }
  return true
}

function boundedCommand(command, maxBytes = SAVED_BEEN_COMMAND_MAX_BYTES) {
  if (!isObject(command) || savedBeenStateBytes(command) > maxBytes) return null
  return jsonClone(command)
}

export function validateSavedBeenDocument(value, cityId) {
  try {
    if (!isPlainJsonDomain(value)) return null
    const normalized = normalizeSavedBeenState(value, { cityId })
    return normalized && plainJsonEqual(normalized, value) ? normalized : null
  } catch {
    return null
  }
}

function canonicalAdd(item, savedAt) {
  if (!validTime(savedAt)) return null
  try {
    const supplied = isObject(item?.ref)
      ? { ref: item.ref, snapshot: item.snapshot, savedAt }
      : { item, savedAt }
    const reduced = addSaved(emptySavedBeenState(BUILDER_CITY_ID), supplied)
    return canonicalizeSavedBeenCommand(supplied, reduced)
  } catch {
    return null
  }
}

function recordRef(record) {
  if (!isObject(record)) return null
  try {
    return savedBeenRefOf(isObject(record.ref) ? record.ref : record)
  } catch {
    return null
  }
}

function refKey(ref) {
  if (!isObject(ref) || typeof ref.kind !== 'string' || typeof ref.status !== 'string') return null
  if (ref.status === 'attached' && typeof ref.primary === 'string') {
    return `attached\u0000${ref.kind}\u0000${ref.primary}`
  }
  if (ref.status === 'missing' && typeof ref.legacyKey === 'string') {
    return `missing\u0000${ref.kind}\u0000${ref.legacyKey}`
  }
  if (ref.status === 'ambiguous'
      && typeof ref.legacyKey === 'string'
      && Array.isArray(ref.candidates)) {
    return `ambiguous\u0000${ref.kind}\u0000${ref.legacyKey}\u0000${ref.candidates.join('\u0000')}`
  }
  return null
}

function recordMatchesRef(record, ref) {
  if (record === null || record === undefined) return true
  return refKey(recordRef(record)) === refKey(ref)
}

function expectedRecordToken(record) {
  if (record === null || record === undefined) return null
  return isObject(record) && validToken(record.token) ? record.token : undefined
}

export function savedBeenAddCommand(item, { savedAt } = {}) {
  return boundedCommand(canonicalAdd(item, savedAt))
}

export function savedBeenToggleCommand(item, { savedAt } = {}) {
  const add = canonicalAdd(item, savedAt)
  return add ? boundedCommand({ ...add, type: 'toggle' }) : null
}

export function savedBeenRemoveCommand(record) {
  const ref = recordRef(record)
  const expectedToken = expectedRecordToken(record)
  return ref && validToken(expectedToken)
    ? boundedCommand({ type: 'remove', ref, expectedToken })
    : null
}

export function savedBeenArchiveCommand(savedRecord, {
  archivedAt,
  beenRecord = null,
} = {}) {
  const ref = recordRef(savedRecord)
  const expectedSaveToken = expectedRecordToken(savedRecord)
  const expectedBeenToken = expectedRecordToken(beenRecord)
  if (!ref
      || ref.kind === 'guide'
      || !validToken(expectedSaveToken)
      || expectedBeenToken === undefined
      || !recordMatchesRef(beenRecord, ref)
      || !validTime(archivedAt)) return null
  return boundedCommand({
    type: 'archive-saved',
    ref,
    archivedAt,
    expectedSaveToken,
    expectedBeenToken,
  })
}

export function savedBeenMarkCommand(item, {
  status,
  statusAt,
  savedAt,
  archivedAt,
  savedRecord = null,
  beenRecord = null,
} = {}) {
  const snapshotSeed = canonicalAdd(item, validTime(savedAt) ? savedAt : 0)
  const expectedSaveToken = expectedRecordToken(savedRecord)
  const expectedBeenToken = expectedRecordToken(beenRecord)
  if (!snapshotSeed
      || snapshotSeed.ref.kind === 'guide'
      || !['went', 'missed'].includes(status)
      || !validTime(statusAt)
      || expectedSaveToken === undefined
      || expectedBeenToken === undefined
      || !recordMatchesRef(savedRecord, snapshotSeed.ref)
      || !recordMatchesRef(beenRecord, snapshotSeed.ref)
      || archivedAt !== undefined && !validTime(archivedAt)) return null
  return boundedCommand({
    type: 'mark-been',
    ref: snapshotSeed.ref,
    snapshot: snapshotSeed.snapshot,
    ...(validTime(savedAt) ? { savedAt } : {}),
    ...(validTime(archivedAt) ? { archivedAt } : {}),
    status,
    statusAt,
    expectedSaveToken,
    expectedBeenToken,
  })
}

export function savedBeenUnmarkCommand(beenRecord) {
  const ref = recordRef(beenRecord)
  const expectedToken = expectedRecordToken(beenRecord)
  return ref && validToken(expectedToken)
    ? boundedCommand({ type: 'unmark-been', ref, expectedToken })
    : null
}

export function savedBeenImportCommand(incoming) {
  if (!isObject(incoming) || typeof incoming.cityId !== 'string') return null
  const canonical = validateSavedBeenDocument(incoming, incoming.cityId)
  if (!canonical) return null
  return boundedCommand({ type: 'import', incoming: canonical }, SAVED_BEEN_IMPORT_MAX_BYTES)
}

export function captureSavedBeenV1Source({
  city,
  capture = captureRetainedV1Source,
} = {}) {
  if (typeof capture !== 'function') throw new TypeError('capture must be a function')
  const captured = capture({ city, domain: 'saved' })
  if (!isObject(captured)
      || !isObject(captured.source)
      || !isObject(captured.evidence)) {
    throw new TypeError('saved V1 capture must return source and evidence')
  }
  return {
    source: captured.source,
    context: { evidence: captured.evidence },
  }
}

function arrayOrEmpty(value, name) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
  return value
}

function migrateSavedBeenDocument(source, context = {}) {
  const events = [
    ...arrayOrEmpty(context.events, 'events'),
    ...arrayOrEmpty(context.customEvents, 'customEvents'),
  ]
  const migration = migrateV1SavedBeenState(source, {
    cityId: context.city?.id,
    events,
    places: arrayOrEmpty(context.places, 'places'),
    guides: arrayOrEmpty(context.guides, 'guides'),
    seeds: arrayOrEmpty(context.seeds, 'seeds'),
    evidence: context.evidence,
  })
  if (!migration) throw new TypeError('saved/Been migration did not produce a valid document')
  return migration
}

export function createSavedBeenStore({
  city,
  events = [],
  customEvents = [],
  places = [],
  guides = [],
  seeds = [],
  capture = captureRetainedV1Source,
  storageFactory,
  lockManager,
  eventTarget,
  now,
  createId,
  contextId,
} = {}) {
  const atomicOptions = {
    city,
    storageKey: SAVED_BEEN_STORAGE_KEY,
    storeId: SAVED_BEEN_STORE_ID,
    emptyDocument: () => emptySavedBeenState(city?.id),
    validateDocument: (value) => validateSavedBeenDocument(value, city?.id),
    documentBytes: savedBeenStateBytes,
    maxBytes: SAVED_BEEN_DOCUMENT_MAX_BYTES,
    commandMaxBytes: SAVED_BEEN_COMMAND_MAX_BYTES,
    reduceDocument: (document, command) => reduceSavedBeenState(document, command),
    canonicalizeCommand: canonicalizeSavedBeenCommand,
    migrate: migrateSavedBeenDocument,
  }
  if (storageFactory !== undefined) atomicOptions.storageFactory = storageFactory
  if (lockManager !== undefined) atomicOptions.lockManager = lockManager
  if (eventTarget !== undefined) atomicOptions.eventTarget = eventTarget
  if (now !== undefined) atomicOptions.now = now
  if (createId !== undefined) atomicOptions.createId = createId
  if (contextId !== undefined) atomicOptions.contextId = contextId
  const atomic = createAtomicCityStore(atomicOptions)

  return {
    ...atomic,
    initialize(options = {}) {
      const suppliedContext = isObject(options.migrationContext)
        ? options.migrationContext
        : {}
      const hasExplicitSource = options.source !== undefined
        || options.sourceFactory !== undefined
      const usesSourceFactory = options.source === undefined
        && (options.sourceFactory !== undefined || !hasExplicitSource)
      // Source-factory evidence describes the bytes that factory physically
      // captured. Never allow a caller-supplied migration context to replace
      // it after capture. Explicit `source` callers may provide their matching
      // evidence because no source factory participates in that path.
      const migrationContext = { ...suppliedContext }
      if (usesSourceFactory) delete migrationContext.evidence
      return atomic.initialize({
        ...options,
        ...(!hasExplicitSource
          ? { sourceFactory: () => captureSavedBeenV1Source({ city, capture }) }
          : {}),
        migrationContext: {
          events,
          customEvents,
          places,
          guides,
          seeds,
          ...migrationContext,
        },
      })
    },
  }
}
