// custom-event-store.js — unmounted atomic persistence for user-created events.
//
// The pure schema and mutation rules live in custom-event-state-core.js. This
// adapter binds them to one trusted city clock, reserves exact V1 provenance,
// and exposes bounded replay commands without mounting React or touching V1.

import {
  CUSTOM_EVENT_COMMAND_MAX_BYTES,
  CUSTOM_EVENT_DOCUMENT_MAX_BYTES,
  canonicalizeCustomEventCommand,
  customEventItems,
  customEventStateBytes,
  emptyCustomEventState,
  migrateV1CustomEventState,
  normalizeCustomEventState,
  reduceCustomEventState,
} from './custom-event-state-core.js'
import { createAtomicCityStore } from './atomic-city-store.js'
import { captureRetainedV1Source } from './retained-v1-source.js'

export const CUSTOM_EVENT_STORAGE_KEY = 'custom-events-v2'
export const CUSTOM_EVENT_STORE_ID = 'custom-events'

const COMMAND_FIELDS = Object.freeze({
  add: new Set(['type', 'event', 'expectedAbsent']),
  update: new Set(['type', 'localId', 'expectedRevision', 'event']),
  delete: new Set(['type', 'localId', 'expectedRevision']),
  import: new Set(['type', 'mode', 'expectedRevision', 'events']),
})
const ENCODER = new TextEncoder()
const PLAIN_JSON_MAX_DEPTH = 64
const PLAIN_JSON_MAX_NODES = 262_144
const INVALID_PLAIN_JSON = Object.freeze({ ok: false, value: null })

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function jsonPrimitive(value) {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)
}

function defineJsonField(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function inspectContainer(source, remainingNodes) {
  const array = Array.isArray(source)
  if (!source || typeof source !== 'object'
      || Object.getPrototypeOf(source) !== (array ? Array.prototype : Object.prototype)
      || Object.getOwnPropertySymbols(source).length > 0) return null
  const names = Object.getOwnPropertyNames(source)
  if (names.length > remainingNodes + (array ? 1 : 0)) return null

  if (array) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(source, 'length')
    const length = lengthDescriptor?.value
    if (!hasOwn(lengthDescriptor || {}, 'value')
        || lengthDescriptor.enumerable
        || !Number.isSafeInteger(length)
        || length < 0
        || length > remainingNodes
        || names.length !== length + 1
        || names[names.length - 1] !== 'length') return null
    const entries = []
    for (let index = 0; index < length; index += 1) {
      const key = String(index)
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (names[index] !== key
          || descriptor?.enumerable !== true
          || !hasOwn(descriptor || {}, 'value')) return null
      entries.push([key, descriptor.value])
    }
    return { target: new Array(length), entries }
  }

  const entries = []
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (descriptor?.enumerable !== true || !hasOwn(descriptor || {}, 'value')) return null
    entries.push([key, descriptor.value])
  }
  return { target: {}, entries }
}

function detachedPlainJson(value) {
  try {
    if (jsonPrimitive(value)) return { ok: true, value }
    if (!value || typeof value !== 'object') return INVALID_PLAIN_JSON
    const root = inspectContainer(value, PLAIN_JSON_MAX_NODES - 1)
    if (!root) return INVALID_PLAIN_JSON

    const seen = new WeakSet([value])
    const stack = [{ ...root, depth: 0 }]
    let nodes = 1
    while (stack.length > 0) {
      const frame = stack.pop()
      for (const [key, child] of frame.entries) {
        nodes += 1
        if (nodes > PLAIN_JSON_MAX_NODES) return INVALID_PLAIN_JSON
        if (jsonPrimitive(child)) {
          defineJsonField(frame.target, key, child)
          continue
        }
        if (!child || typeof child !== 'object'
            || frame.depth >= PLAIN_JSON_MAX_DEPTH
            || seen.has(child)) return INVALID_PLAIN_JSON
        const inspected = inspectContainer(child, PLAIN_JSON_MAX_NODES - nodes)
        if (!inspected) return INVALID_PLAIN_JSON
        seen.add(child)
        defineJsonField(frame.target, key, inspected.target)
        stack.push({ ...inspected, depth: frame.depth + 1 })
      }
    }
    return { ok: true, value: root.target }
  } catch {
    return INVALID_PLAIN_JSON
  }
}

function trustedJsonBytes(value) {
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function exactFieldClone(value, fields) {
  const detached = detachedPlainJson(value)
  if (!detached.ok || !isObject(detached.value)) return null
  const keys = Object.keys(detached.value)
  return keys.length === fields.size && keys.every((field) => fields.has(field))
    ? detached.value
    : null
}

function ownDataField(value, key) {
  try {
    if (!isObject(value)) return { present: false, ok: false, value: undefined }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return { present: false, ok: false, value: undefined }
    return descriptor.enumerable === true && hasOwn(descriptor, 'value')
      ? { present: true, ok: true, value: descriptor.value }
      : { present: true, ok: false, value: undefined }
  } catch {
    return { present: true, ok: false, value: undefined }
  }
}

function selectedCity(city) {
  if (!isObject(city)) throw new TypeError('city must include a trusted id and time zone')
  const id = ownDataField(city, 'id')
  const timeZone = ownDataField(city, 'tz')
  if (!id.ok || !timeZone.ok) {
    throw new TypeError('city must expose id and tz as trusted data fields')
  }
  // The core performs the IANA and city-id validation and produces no side effects.
  emptyCustomEventState(id.value, { timeZone: timeZone.value })
  return Object.freeze({ id: id.value, tz: timeZone.value })
}

function contextOf(city) {
  return { cityId: city.id, timeZone: city.tz }
}

function exactDocument(value, city) {
  try {
    const detached = detachedPlainJson(value)
    return detached.ok
      ? normalizeCustomEventState(detached.value, contextOf(city))
      : null
  } catch {
    return null
  }
}

function exactCommandShape(command) {
  if (!isObject(command)) return false
  const fields = COMMAND_FIELDS[command.type]
  return fields instanceof Set
    && Object.keys(command).length === fields.size
    && Object.keys(command).every((field) => fields.has(field))
    && (command.type !== 'add' || command.expectedAbsent === true)
}

function detachedCommand(command) {
  const detached = detachedPlainJson(command)
  return detached.ok
    && exactCommandShape(detached.value)
    && trustedJsonBytes(detached.value) < CUSTOM_EVENT_COMMAND_MAX_BYTES
    ? detached.value
    : null
}

function adapterReduce(city, document, command) {
  const safeCommand = detachedCommand(command)
  if (!safeCommand) {
    return { document, changed: false, code: 'invalid-command' }
  }
  const coreCommand = safeCommand.type === 'add'
    ? { type: 'add', event: safeCommand.event }
    : safeCommand
  const reduced = reduceCustomEventState(document, coreCommand, contextOf(city))
  if (reduced.changed !== true) return reduced
  const canonical = canonicalizeCustomEventCommand(coreCommand, reduced)
  if (!isObject(canonical)) return { document, changed: false, code: 'invalid-command' }
  const canonicalCommand = safeCommand.type === 'add'
    ? { ...canonical, expectedAbsent: true }
    : canonical
  if (!detachedCommand(canonicalCommand)) {
    return { document, changed: false, code: 'command-too-large' }
  }
  return { ...reduced, canonicalCommand }
}

function buildCommand(city, document, command) {
  const canonical = exactDocument(document, city)
  if (!canonical) return null
  const reduced = adapterReduce(city, canonical, command)
  return reduced.changed === true && isObject(reduced.canonicalCommand)
    ? reduced.canonicalCommand
    : null
}

export function customEventAddCommand(document, event, { city } = {}) {
  const selected = selectedCity(city)
  return buildCommand(selected, document, {
    type: 'add',
    event,
    expectedAbsent: true,
  })
}

export function customEventUpdateCommand(document, localId, event, { city } = {}) {
  const selected = selectedCity(city)
  const canonical = exactDocument(document, selected)
  const current = canonical?.items.find((entry) => entry.item.localId === localId)
  if (!current) return null
  return buildCommand(selected, canonical, {
    type: 'update',
    localId,
    expectedRevision: current.revision,
    event,
  })
}

export function customEventDeleteCommand(document, localId, { city } = {}) {
  const selected = selectedCity(city)
  const canonical = exactDocument(document, selected)
  const current = canonical?.items.find((entry) => entry.item.localId === localId)
  if (!current) return null
  return buildCommand(selected, canonical, {
    type: 'delete',
    localId,
    expectedRevision: current.revision,
  })
}

export function customEventImportCommand(document, events, {
  city,
  mode = 'merge',
} = {}) {
  const selected = selectedCity(city)
  const canonical = exactDocument(document, selected)
  if (!canonical) return null
  return buildCommand(selected, canonical, {
    type: 'import',
    mode,
    expectedRevision: canonical.rev,
    events,
  })
}

function sourcePacket(source, evidence) {
  const detached = detachedPlainJson({ source, evidence })
  if (!detached.ok) {
    throw new TypeError('custom-event source and evidence must be plain JSON data')
  }
  return detached.value
}

function capturedPacket(value) {
  const source = ownDataField(value, 'source')
  const evidence = ownDataField(value, 'evidence')
  if (!source.ok || !evidence.ok) {
    throw new TypeError('custom-event sourceFactory must return { source, evidence }')
  }
  return sourcePacket(source.value, evidence.value)
}

export function captureCustomEventV1Source({
  city,
  capture = captureRetainedV1Source,
} = {}) {
  if (typeof capture !== 'function') throw new TypeError('capture must be a function')
  const retained = capture({ city, domain: 'custom' })
  return capturedPacket(retained)
}

function migrationPacket(value, city) {
  const packet = exactFieldClone(value, new Set(['source', 'evidence']))
  if (!packet) {
    throw new TypeError('custom-event migration packet is malformed')
  }
  return migrateV1CustomEventState(packet.source, {
    city,
    evidence: packet.evidence,
  })
}

function initializationSource(options, city, capture) {
  return async () => {
    const source = ownDataField(options, 'source')
    const evidence = ownDataField(options, 'evidence')
    const factory = ownDataField(options, 'sourceFactory')
    const hasSource = source.present
    const hasEvidence = evidence.present
    const hasFactory = factory.present
    if (hasSource || hasEvidence) {
      if (!hasSource || !hasEvidence || hasFactory || !source.ok || !evidence.ok) {
        throw new TypeError('explicit custom-event source requires evidence and no sourceFactory')
      }
      return { source: sourcePacket(source.value, evidence.value) }
    }
    if (hasFactory) {
      if (!factory.ok || typeof factory.value !== 'function') {
        throw new TypeError('sourceFactory must be a function')
      }
      return { source: capturedPacket(await factory.value()) }
    }
    return {
      source: captureCustomEventV1Source({ city, capture }),
    }
  }
}

export function createCustomEventStore({
  city,
  capture = captureRetainedV1Source,
  storageFactory,
  lockManager,
  eventTarget,
  now,
  createId,
  contextId,
} = {}) {
  const selected = selectedCity(city)
  if (typeof capture !== 'function') throw new TypeError('capture must be a function')
  const atomicOptions = {
    city: selected,
    storageKey: CUSTOM_EVENT_STORAGE_KEY,
    storeId: CUSTOM_EVENT_STORE_ID,
    emptyDocument: () => emptyCustomEventState(selected.id, { timeZone: selected.tz }),
    validateDocument: (value) => exactDocument(value, selected),
    documentBytes: customEventStateBytes,
    maxBytes: CUSTOM_EVENT_DOCUMENT_MAX_BYTES,
    reduceDocument: (document, command) => adapterReduce(selected, document, command),
    canonicalizeCommand: (_command, reduced) => reduced?.canonicalCommand || null,
    migrate: (packet) => migrationPacket(packet, selected),
    commandMaxBytes: CUSTOM_EVENT_COMMAND_MAX_BYTES,
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
      return atomic.initialize({
        sourceFactory: initializationSource(options, selected, capture),
        // Deliberately do not forward migrationContext. In particular,
        // evidence is reserved inside the source packet and cannot be replaced.
      })
    },
    getItems() {
      const snapshot = atomic.getSnapshot()
      return customEventItems(snapshot.document, {
        ...contextOf(selected),
        durability: snapshot.durability,
      })
    },
    dispatch(command) {
      return atomic.dispatch(detachedCommand(command) || { type: 'invalid' })
    },
    addCommand(event) {
      return customEventAddCommand(atomic.getSnapshot().document, event, { city: selected })
    },
    updateCommand(localId, event) {
      return customEventUpdateCommand(
        atomic.getSnapshot().document,
        localId,
        event,
        { city: selected },
      )
    },
    deleteCommand(localId) {
      return customEventDeleteCommand(
        atomic.getSnapshot().document,
        localId,
        { city: selected },
      )
    },
    importCommand(events, options = {}) {
      return customEventImportCommand(
        atomic.getSnapshot().document,
        events,
        { ...options, city: selected },
      )
    },
  }
}
