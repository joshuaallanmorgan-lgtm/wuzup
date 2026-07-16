// atomic-city-store.js — reusable city-scoped durable document coordination.
//
// Product stores provide a pure document validator, reducer, command
// canonicalizer, and migration. This module owns the unsafe browser boundary:
// destination-first initialization, exact-byte durability verification,
// serialized commands, cross-tab coordination, bounded metadata, and explicit
// session-only recovery when durable storage is unavailable.
import { createStorageScope, physicalKey } from './storage.js'

export const ATOMIC_CITY_ENVELOPE_VERSION = 1
export const ATOMIC_CITY_RECENT_OPS_CAP = 64
export const ATOMIC_CITY_METADATA_MAX_BYTES = 4096
export const ATOMIC_CITY_MIGRATION_RECEIPT_MAX_BYTES = 8192
export const ATOMIC_CITY_DEFAULT_MAX_BYTES = 512 * 1024
export const ATOMIC_CITY_COMMAND_MAX_BYTES = 64 * 1024

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,159}$/i
const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ENCODER = new TextEncoder()
let storeInstanceCounter = 0

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const validId = (value) => typeof value === 'string' && ID_RE.test(value)
const validCityId = (value) => typeof value === 'string' && CITY_ID_RE.test(value)
const validTime = (value) => Number.isSafeInteger(value) && value >= 0

function defaultId() {
  try {
    return globalThis.crypto?.randomUUID?.() || null
  } catch {
    return null
  }
}

function compactIdToken(value, fallback) {
  if (!validId(value)) return fallback
  if (value.length <= 48) return value
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${value.slice(0, 32)}-${(hash >>> 0).toString(36)}`
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function jsonClone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function jsonEqual(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function jsonBytes(value) {
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function serialization(value) {
  try {
    const raw = JSON.stringify(value)
    if (typeof raw !== 'string' || ENCODER.encode(raw).byteLength === 0) return null
    return raw
  } catch {
    return null
  }
}

function boundedMetadata(value, maxBytes) {
  const state = { nodes: 0, seen: new WeakSet(), truncated: false }
  const clone = (input, depth = 0) => {
    if (state.nodes >= 128 || depth > 3) {
      state.truncated = true
      return undefined
    }
    state.nodes += 1
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined
    if (typeof input === 'string') {
      if (ENCODER.encode(input).byteLength <= 256) return input
      state.truncated = true
      return `${input.slice(0, 240)}…`
    }
    if (!input || typeof input !== 'object' || state.seen.has(input)) {
      if (input && typeof input === 'object') state.truncated = true
      return undefined
    }
    state.seen.add(input)
    try {
      if (Array.isArray(input)) {
        if (input.length > 24) state.truncated = true
        return input.slice(0, 24)
          .map((item) => clone(item, depth + 1))
          .filter((item) => item !== undefined)
      }
      const out = {}
      const entries = Object.entries(input)
      if (entries.length > 24) state.truncated = true
      for (const [key, child] of entries.slice(0, 24)) {
        if (ENCODER.encode(key).byteLength > 96) {
          state.truncated = true
          continue
        }
        const cloned = clone(child, depth + 1)
        if (cloned !== undefined) out[key] = cloned
      }
      return out
    } finally {
      state.seen.delete(input)
    }
  }

  const cloned = clone(value)
  const object = isObject(cloned) ? cloned : {}
  if (!state.truncated && jsonBytes(object) <= maxBytes) return object
  const summary = {
    truncated: true,
    byteLimit: maxBytes,
    topLevelKeys: isObject(value) ? Object.keys(value).slice(0, 24) : [],
  }
  return jsonBytes(summary) <= maxBytes
    ? summary
    : { truncated: true, byteLimit: maxBytes }
}

function boundedMigrationReceipt(value, { metadataMaxBytes, receiptMaxBytes }) {
  const receipt = {
    status: typeof value?.status === 'string' ? value.status.slice(0, 64) : 'unknown',
    ...(validTime(value?.at) ? { at: value.at } : {}),
    diagnostics: boundedMetadata(value?.diagnostics, metadataMaxBytes),
    sourceSummary: boundedMetadata(value?.sourceSummary, metadataMaxBytes),
  }
  if (jsonBytes(receipt) <= receiptMaxBytes) return receipt
  return {
    status: receipt.status,
    ...(receipt.at !== undefined ? { at: receipt.at } : {}),
    truncated: true,
    byteLimit: receiptMaxBytes,
  }
}

function validCommit(value, recentOpsCap) {
  return isObject(value)
    && validId(value.id)
    && (value.parentId === null || validId(value.parentId))
    && value.parentId !== value.id
    && validTime(value.at)
    && Array.isArray(value.opIds)
    && value.opIds.length <= recentOpsCap
    && value.opIds.every(validId)
    && new Set(value.opIds).size === value.opIds.length
}

function commitOpsMatchRecentSuffix(commit, recentOps) {
  if (commit.opIds.length > recentOps.length) return false
  const start = recentOps.length - commit.opIds.length
  return commit.opIds.every((opId, index) => recentOps[start + index] === opId)
}

function checkedDocumentBytes(documentBytes, value) {
  try {
    const bytes = Number(documentBytes(value))
    return Number.isSafeInteger(bytes) && bytes >= 0
      ? bytes
      : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function canonicalizeDocument(value, {
  validateDocument,
  documentBytes,
  maxBytes,
  requireCanonical = false,
}) {
  let input
  try {
    input = jsonClone(value)
  } catch {
    return null
  }
  let validated
  try {
    validated = validateDocument(input)
  } catch {
    return null
  }
  const document = validated === true ? input : validated
  if (!isObject(document)) return null
  let cloned
  try {
    cloned = jsonClone(document)
  } catch {
    return null
  }
  if (requireCanonical && !jsonEqual(cloned, value)) return null
  return checkedDocumentBytes(documentBytes, cloned) <= maxBytes ? cloned : null
}

function publicError(code, detail = null) {
  const error = { code }
  if (detail !== null && detail !== undefined) {
    error.detail = String(detail).slice(0, 512)
  }
  return error
}

function appendRecent(current, opIds, cap) {
  const next = [...current]
  for (const opId of opIds) {
    const index = next.indexOf(opId)
    if (index >= 0) next.splice(index, 1)
    next.push(opId)
  }
  return next.slice(-cap)
}

function envelopeValidator(config) {
  return (value) => {
    const {
      city,
      storeId,
      validateDocument,
      documentBytes,
      maxBytes,
      recentOpsCap,
      migrationReceiptMaxBytes,
    } = config
    if (!isObject(value)
        || value.v !== ATOMIC_CITY_ENVELOPE_VERSION
        || value.storeId !== storeId
        || value.cityId !== city.id
        || value.timeZone !== city.tz
        || !validCommit(value.commit, recentOpsCap)
        || !Array.isArray(value.recentOps)
        || value.recentOps.length > recentOpsCap
        || !value.recentOps.every(validId)
        || new Set(value.recentOps).size !== value.recentOps.length
        || !commitOpsMatchRecentSuffix(value.commit, value.recentOps)
        || !isObject(value.migration)
        || typeof value.migration.status !== 'string'
        || value.migration.status.length > 64
        || jsonBytes(value.migration) > migrationReceiptMaxBytes) {
      return null
    }
    const document = canonicalizeDocument(value.document, {
      validateDocument,
      documentBytes,
      maxBytes,
      requireCanonical: true,
    })
    if (!document) return null
    return {
      v: ATOMIC_CITY_ENVELOPE_VERSION,
      storeId,
      cityId: city.id,
      timeZone: city.tz,
      document,
      commit: {
        id: value.commit.id,
        parentId: value.commit.parentId,
        at: value.commit.at,
        opIds: [...value.commit.opIds],
      },
      recentOps: [...value.recentOps],
      migration: jsonClone(value.migration),
    }
  }
}

export function validateAtomicCityEnvelope(value, {
  city,
  storeId,
  validateDocument,
  documentBytes = jsonBytes,
  maxBytes = ATOMIC_CITY_DEFAULT_MAX_BYTES,
  recentOpsCap = ATOMIC_CITY_RECENT_OPS_CAP,
  migrationReceiptMaxBytes = ATOMIC_CITY_MIGRATION_RECEIPT_MAX_BYTES,
} = {}) {
  if (!isObject(city)
      || !validCityId(city.id)
      || typeof city.tz !== 'string'
      || !validId(storeId)
      || typeof validateDocument !== 'function') {
    return null
  }
  return envelopeValidator({
    city,
    storeId,
    validateDocument,
    documentBytes,
    maxBytes,
    recentOpsCap,
    migrationReceiptMaxBytes,
  })(value)
}

export function createAtomicCityStore({
  city,
  storageKey,
  storeId,
  emptyDocument,
  validateDocument,
  documentBytes = jsonBytes,
  maxBytes = ATOMIC_CITY_DEFAULT_MAX_BYTES,
  reduceDocument,
  canonicalizeCommand,
  migrate,
  storageFactory = createStorageScope,
  lockManager = globalThis.navigator?.locks ?? null,
  eventTarget = globalThis.window ?? null,
  now = Date.now,
  createId = defaultId,
  contextId = null,
  recentOpsCap = ATOMIC_CITY_RECENT_OPS_CAP,
  metadataMaxBytes = ATOMIC_CITY_METADATA_MAX_BYTES,
  migrationReceiptMaxBytes = ATOMIC_CITY_MIGRATION_RECEIPT_MAX_BYTES,
  commandMaxBytes = ATOMIC_CITY_COMMAND_MAX_BYTES,
} = {}) {
  if (!isObject(city)
      || !validCityId(city.id)
      || typeof city.tz !== 'string'
      || city.tz.length === 0) {
    throw new TypeError('createAtomicCityStore requires a city with valid id and tz')
  }
  if (!validId(storageKey) || !validId(storeId)) {
    throw new TypeError('storageKey and storeId must be valid IDs')
  }
  if (typeof validateDocument !== 'function'
      || typeof documentBytes !== 'function'
      || typeof reduceDocument !== 'function'
      || typeof canonicalizeCommand !== 'function'
      || typeof migrate !== 'function'
      || typeof storageFactory !== 'function') {
    throw new TypeError('store document, reducer, migration, and storage functions are required')
  }
  if (typeof now !== 'function' || typeof createId !== 'function') {
    throw new TypeError('now and createId must be functions')
  }
  if (contextId !== null && !validId(contextId)) {
    throw new TypeError('contextId must be a valid ID')
  }
  for (const [name, value] of Object.entries({
    maxBytes,
    recentOpsCap,
    metadataMaxBytes,
    migrationReceiptMaxBytes,
    commandMaxBytes,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`)
    }
  }

  const selected = { id: city.id, tz: city.tz }
  const rawEmpty = typeof emptyDocument === 'function' ? emptyDocument() : emptyDocument
  const canonicalEmpty = canonicalizeDocument(rawEmpty, {
    validateDocument,
    documentBytes,
    maxBytes,
  })
  if (!canonicalEmpty) throw new TypeError('emptyDocument must be a valid bounded document')

  storeInstanceCounter += 1
  const instanceOrdinal = storeInstanceCounter
  const generatedContext = contextId || defaultId()
  if (!validId(generatedContext)) {
    throw new TypeError('contextId is required when secure per-instance entropy is unavailable')
  }
  const contextEntropy = compactIdToken(generatedContext, null)
  const destinationKey = physicalKey(storageKey, { cityId: selected.id })
  const lockName = `wuzup:${storeId}:${selected.id}`
  const writeScope = storageFactory({ cityId: selected.id })
  if (!writeScope
      || typeof writeScope.set !== 'function'
      || typeof writeScope.peekDurable !== 'function') {
    throw new TypeError('storageFactory must return a storage scope with set/peekDurable')
  }

  const validateEnvelope = envelopeValidator({
    city: selected,
    storeId,
    validateDocument,
    documentBytes,
    maxBytes,
    recentOpsCap,
    migrationReceiptMaxBytes,
  })
  const frozenEmpty = deepFreeze(jsonClone(canonicalEmpty))

  let snapshot = deepFreeze({
    status: 'idle',
    storeId,
    cityId: selected.id,
    timeZone: selected.tz,
    document: frozenEmpty,
    envelope: null,
    durability: 'unknown',
    concurrency: 'none',
    pendingOps: [],
    error: null,
    recovery: null,
  })
  let durableEnvelope = null
  let sessionEnvelope = null
  let pendingOps = []
  let initialized = false
  let destroyed = false
  let queue = Promise.resolve()
  let idCounter = 0
  const issuedIds = new Set()
  const listeners = new Set()

  const nextId = (kind) => {
    idCounter += 1
    let candidate
    try {
      candidate = createId()
    } catch {
      candidate = null
    }
    const fallback = Math.max(0, Number(now()) || 0).toString(36)
    const candidateToken = compactIdToken(candidate, fallback)
    const prefix = `${kind}:${contextEntropy}:${instanceOrdinal.toString(36)}:${idCounter.toString(36)}:`
    let id = `${prefix}${candidateToken}`.slice(0, 160)
    if (!issuedIds.has(id)) {
      issuedIds.add(id)
      return id
    }
    let fallbackId
    do {
      idCounter += 1
      const stamp = Math.max(0, Number(now()) || 0)
      fallbackId = `${kind}:${contextEntropy}:${instanceOrdinal.toString(36)}:${idCounter.toString(36)}:${stamp.toString(36)}`.slice(0, 160)
    } while (issuedIds.has(fallbackId))
    issuedIds.add(fallbackId)
    return fallbackId
  }

  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A broken observer cannot block persistence or other subscribers.
      }
    }
  }

  const publish = ({
    status = 'ready',
    envelope = sessionEnvelope || durableEnvelope,
    durability = envelope && durableEnvelope?.commit.id === envelope.commit.id
      ? 'durable'
      : 'session-only',
    concurrency = snapshot.concurrency,
    error = null,
    recovery = null,
    shouldEmit = true,
  } = {}) => {
    sessionEnvelope = envelope
    if (envelope) {
      issuedIds.add(envelope.commit.id)
      for (const opId of envelope.recentOps) issuedIds.add(opId)
    }
    snapshot = deepFreeze({
      status,
      storeId,
      cityId: selected.id,
      timeZone: selected.tz,
      document: envelope?.document || frozenEmpty,
      envelope,
      durability,
      concurrency,
      pendingOps: pendingOps.map(({ kind = 'command', opId }) => ({ kind, opId })),
      error,
      recovery,
    })
    if (shouldEmit) emit()
    return snapshot
  }

  const durableRaw = () => {
    try {
      const read = writeScope.peekDurable(storageKey)
      if (read?.status === 'missing') return { status: 'missing', raw: null }
      if (read?.status === 'ok' && read.value === null) {
        return { status: 'tombstone', raw: null }
      }
      if (read?.status === 'ok') return { status: 'ok', raw: read.value }
      return {
        status: 'io-error',
        raw: null,
        error: read?.error || new Error('Storage read failed'),
      }
    } catch (error) {
      return { status: 'io-error', raw: null, error }
    }
  }

  const readDestination = () => {
    const read = durableRaw()
    if (read.status === 'missing') return read
    if (read.status !== 'ok') return read
    if (typeof read.raw !== 'string') return { status: 'invalid', raw: read.raw }
    let parsed
    try {
      parsed = JSON.parse(read.raw)
    } catch {
      return { status: 'corrupt', raw: read.raw }
    }
    const envelope = validateEnvelope(parsed)
    return envelope
      ? { status: 'ok', raw: read.raw, envelope }
      : { status: 'invalid', raw: read.raw }
  }

  const writeExact = (raw) => {
    let reported
    try {
      reported = writeScope.set(storageKey, raw) === true
    } catch {
      reported = false
    }
    const landed = durableRaw()
    return {
      persisted: landed.status === 'ok' && landed.raw === raw,
      reported,
      landed,
    }
  }

  const createEnvelope = ({ document, parent = null, opIds = [], migration: receipt }) => {
    const canonical = canonicalizeDocument(document, {
      validateDocument,
      documentBytes,
      maxBytes,
    })
    if (!canonical) return null
    const parentId = parent?.commit.id || null
    let commitId = nextId('commit')
    for (let attempt = 0; commitId === parentId && attempt < 4; attempt += 1) {
      commitId = nextId('commit')
    }
    if (commitId === parentId) return null
    const envelope = {
      v: ATOMIC_CITY_ENVELOPE_VERSION,
      storeId,
      cityId: selected.id,
      timeZone: selected.tz,
      document: canonical,
      commit: {
        id: commitId,
        parentId,
        at: Math.max(0, Number(now()) || 0),
        opIds: [...opIds],
      },
      recentOps: appendRecent(parent?.recentOps || [], opIds, recentOpsCap),
      migration: boundedMigrationReceipt(receipt, {
        metadataMaxBytes,
        receiptMaxBytes: migrationReceiptMaxBytes,
      }),
    }
    return validateEnvelope(envelope)
  }

  const result = (values = {}) => ({
    ok: values.ok ?? !values.error,
    code: values.code || 'ok',
    changed: values.changed === true,
    persisted: values.persisted === true,
    durability: values.durability || snapshot.durability,
    concurrency: values.concurrency || snapshot.concurrency,
    ...(values.opId ? { opId: values.opId } : {}),
    ...(values.undo ? { undo: values.undo } : {}),
    ...(values.conflict ? { conflict: values.conflict } : {}),
    ...(values.error ? { error: values.error } : {}),
    snapshot,
  })

  const unavailableResult = (read, concurrency = snapshot.concurrency) => {
    const error = publicError(
      read.status === 'io-error' ? 'storage-unavailable' : 'corrupt-destination',
      read.status,
    )
    const recovery = {
      code: 'explicit-recovery-required',
      physicalKey: destinationKey,
      canReload: true,
      overwriteAllowed: false,
    }
    publish({
      status: read.status === 'io-error' ? 'error' : 'corrupt',
      envelope: sessionEnvelope || durableEnvelope,
      durability: sessionEnvelope && pendingOps.length > 0 ? 'session-only' : 'unknown',
      concurrency,
      error,
      recovery,
    })
    return result({ ok: false, code: error.code, error, concurrency })
  }

  const withCoordination = async (task) => {
    if (lockManager && typeof lockManager.request === 'function') {
      try {
        return await lockManager.request(lockName, { mode: 'exclusive' }, () => task({
          concurrency: 'web-lock',
          attempts: 1,
          writeAllowed: true,
        }))
      } catch (error) {
        return {
          kind: 'coordination-error',
          concurrency: 'web-lock',
          error: publicError('lock-failed', error?.message || null),
        }
      }
    }
    return task({
      concurrency: 'session-only-no-lock',
      attempts: 1,
      writeAllowed: false,
    })
  }

  const reduce = (document, command) => {
    let reduced
    try {
      reduced = reduceDocument(jsonClone(document), jsonClone(command))
    } catch (error) {
      return {
        document,
        changed: false,
        code: 'reducer-failed',
        error: publicError('reducer-failed', error?.message || null),
      }
    }
    if (!isObject(reduced) || reduced.changed !== true) {
      return {
        document,
        changed: false,
        code: typeof reduced?.code === 'string' ? reduced.code : 'unchanged',
        ...(reduced?.undo !== undefined ? { undo: reduced.undo } : {}),
      }
    }
    const canonical = canonicalizeDocument(reduced.document, {
      validateDocument,
      documentBytes,
      maxBytes,
    })
    if (!canonical) {
      return {
        document,
        changed: false,
        code: 'invalid-document',
        error: publicError('invalid-document'),
      }
    }
    return {
      ...reduced,
      document: canonical,
      changed: true,
    }
  }

  const canonicalCommand = (command, reducerResult) => {
    let canonical
    try {
      canonical = canonicalizeCommand(jsonClone(command), jsonClone(reducerResult))
    } catch {
      return null
    }
    if (!isObject(canonical) || jsonBytes(canonical) > commandMaxBytes) return null
    try {
      return jsonClone(canonical)
    } catch {
      return null
    }
  }

  const replayRecords = (base, records) => {
    let document = base.document
    const canonical = []
    const appliedOpIds = []
    let finalReducer = null

    for (const record of records) {
      if (base.recentOps.includes(record.opId) || appliedOpIds.includes(record.opId)) continue
      const reduced = reduce(document, record.command)
      if (!reduced.changed) {
        return {
          ok: false,
          conflict: {
            opId: record.opId,
            reducerCode: reduced.code,
          },
          reducer: reduced,
        }
      }
      const command = canonicalCommand(record.command, reduced)
      if (!command) {
        return {
          ok: false,
          conflict: {
            opId: record.opId,
            reducerCode: 'unserializable-command',
          },
          reducer: reduced,
        }
      }
      document = reduced.document
      canonical.push({ kind: 'command', opId: record.opId, command })
      appliedOpIds.push(record.opId)
      finalReducer = reduced
    }

    return {
      ok: true,
      document,
      canonical,
      appliedOpIds,
      reducer: finalReducer,
    }
  }

  const persistRecords = async (records, { initializeEnvelope = null } = {}) => withCoordination(
    async ({ concurrency, attempts, writeAllowed }) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const read = readDestination()
        if (!['ok', 'missing'].includes(read.status)) {
          return { kind: 'read-error', read, concurrency }
        }

        let base = read.envelope || null
        let startIndex = 0
        if (records[0]?.kind === 'initialize') {
          startIndex = 1
          if (!base) base = initializeEnvelope || records[0].envelope
        } else if (!base) {
          return {
            kind: 'conflict',
            concurrency,
            conflict: { code: 'durable-destination-missing' },
          }
        }
        if (!base) {
          return {
            kind: 'conflict',
            concurrency,
            conflict: { code: 'missing-initial-envelope' },
          }
        }

        const commands = records.slice(startIndex)
        const replayed = replayRecords(base, commands)
        if (!replayed.ok) {
          return {
            kind: 'conflict',
            concurrency,
            conflict: replayed.conflict,
            reducer: replayed.reducer,
          }
        }

        const skipped = commands.length > 0
          && replayed.appliedOpIds.length === 0
          && commands.every((record) => base.recentOps.includes(record.opId))
        if (read.status === 'ok' && records[0]?.kind === 'initialize' && commands.length === 0) {
          return { kind: 'existing-wins', envelope: base, concurrency }
        }
        if (skipped) return { kind: 'deduped', envelope: base, concurrency }

        let candidate = base
        if (replayed.appliedOpIds.length > 0) {
          candidate = createEnvelope({
            document: replayed.document,
            parent: base,
            opIds: replayed.appliedOpIds,
            migration: base.migration,
          })
        }
        if (!candidate) {
          return {
            kind: 'conflict',
            concurrency,
            conflict: { code: 'invalid-candidate-envelope' },
          }
        }

        const raw = serialization(candidate)
        if (!raw) {
          return {
            kind: 'conflict',
            concurrency,
            conflict: { code: 'unserializable-candidate' },
          }
        }

        if (!writeAllowed) {
          return {
            kind: 'session-only',
            envelope: candidate,
            records: replayed.canonical,
            reducer: replayed.reducer,
            concurrency,
            error: publicError('coordination-unavailable'),
          }
        }

        const write = writeExact(raw)
        if (write.persisted) {
          return {
            kind: 'persisted',
            envelope: candidate,
            records: replayed.canonical,
            reducer: replayed.reducer,
            concurrency,
          }
        }

        const landedRaw = write.landed.status === 'ok' ? write.landed.raw : null
        if (write.landed.status === 'ok' && landedRaw !== read.raw && landedRaw !== null) continue
        return {
          kind: 'session-only',
          envelope: candidate,
          records: replayed.canonical,
          reducer: replayed.reducer,
          concurrency,
          error: publicError('write-not-durable'),
        }
      }
      return {
        kind: 'conflict',
        concurrency,
        conflict: { code: 'persistence-retry-exhausted' },
      }
    },
  )

  const consumePersistence = (outcome, records, { newOpId = null } = {}) => {
    if (outcome.kind === 'coordination-error') {
      return result({
        ok: false,
        code: outcome.error.code,
        error: outcome.error,
        opId: newOpId,
        concurrency: outcome.concurrency,
      })
    }
    if (outcome.kind === 'read-error') return unavailableResult(outcome.read, outcome.concurrency)

    if (outcome.kind === 'persisted') {
      durableEnvelope = outcome.envelope
      pendingOps = []
      publish({
        envelope: outcome.envelope,
        durability: 'durable',
        concurrency: outcome.concurrency,
      })
      return result({
        code: outcome.reducer?.code || 'persisted',
        changed: Boolean(outcome.reducer?.changed || records[0]?.kind === 'initialize'),
        persisted: true,
        durability: 'durable',
        concurrency: outcome.concurrency,
        opId: newOpId,
        undo: outcome.reducer?.undo,
      })
    }

    if (outcome.kind === 'existing-wins' || outcome.kind === 'deduped') {
      durableEnvelope = outcome.envelope
      pendingOps = []
      publish({
        envelope: outcome.envelope,
        durability: 'durable',
        concurrency: outcome.concurrency,
      })
      return result({
        code: outcome.kind === 'deduped' ? 'duplicate-op' : 'existing-destination',
        persisted: true,
        durability: 'durable',
        concurrency: outcome.concurrency,
        opId: newOpId,
      })
    }

    if (outcome.kind === 'session-only') {
      pendingOps = records[0]?.kind === 'initialize'
        ? [records[0], ...outcome.records]
        : outcome.records
      publish({
        envelope: outcome.envelope,
        durability: 'session-only',
        concurrency: outcome.concurrency,
        error: outcome.error,
        recovery: {
          code: 'retry-persistence',
          pendingCount: pendingOps.length,
          canRetry: true,
        },
      })
      return result({
        code: outcome.reducer?.code || 'session-only',
        changed: true,
        persisted: false,
        durability: 'session-only',
        concurrency: outcome.concurrency,
        opId: newOpId,
        undo: outcome.reducer?.undo,
        error: outcome.error,
      })
    }

    return result({
      ok: false,
      code: 'rebase-conflict',
      persisted: false,
      durability: snapshot.durability,
      concurrency: outcome.concurrency,
      opId: newOpId,
      conflict: outcome.conflict || { code: 'rebase-conflict' },
    })
  }

  const enqueue = (task) => {
    const run = queue.then(async () => {
      if (destroyed) return result({ ok: false, code: 'destroyed' })
      return task()
    })
    queue = run.catch(() => {})
    return run
  }

  const initialize = (options = {}) => enqueue(async () => {
    if (initialized) {
      return result({
        code: 'already-initialized',
        persisted: snapshot.durability === 'durable',
      })
    }

    const existing = readDestination()
    if (existing.status === 'ok') {
      initialized = true
      durableEnvelope = existing.envelope
      pendingOps = []
      publish({
        envelope: existing.envelope,
        durability: 'durable',
        concurrency: 'none',
      })
      return result({
        code: 'existing-destination',
        persisted: true,
        durability: 'durable',
        concurrency: 'none',
      })
    }
    if (existing.status !== 'missing') {
      initialized = true
      return unavailableResult(existing, 'none')
    }

    let captured
    if (options.source === undefined && options.sourceFactory !== undefined) {
      if (typeof options.sourceFactory !== 'function') {
        initialized = true
        const error = publicError('migration-source-invalid')
        publish({ status: 'error', error, durability: 'unknown', concurrency: 'none' })
        return result({ ok: false, code: error.code, error })
      }
      try {
        captured = await options.sourceFactory()
      } catch (cause) {
        initialized = true
        const error = publicError(
          'migration-source-unavailable',
          cause?.code || cause?.message || null,
        )
        publish({ status: 'error', error, durability: 'unknown', concurrency: 'none' })
        return result({ ok: false, code: error.code, error })
      }
    }

    let source
    let migrationContext
    try {
      const capturedHasSource = isObject(captured)
        && Object.prototype.hasOwnProperty.call(captured, 'source')
      const input = options.source === undefined
        ? (capturedHasSource ? captured.source : captured)
        : options.source
      source = jsonClone(input === undefined ? {} : input)
      const capturedContext = capturedHasSource && isObject(captured.context)
        ? captured.context
        : {}
      migrationContext = jsonClone({
        ...capturedContext,
        ...(isObject(options.migrationContext) ? options.migrationContext : {}),
      })
    } catch (cause) {
      initialized = true
      const error = publicError('migration-source-invalid', cause?.message || null)
      publish({ status: 'error', error, durability: 'unknown', concurrency: 'none' })
      return result({ ok: false, code: error.code, error })
    }

    let migration
    try {
      migration = await migrate(source, {
        ...migrationContext,
        city: { ...selected },
      })
    } catch (cause) {
      initialized = true
      const error = publicError('migration-failed', cause?.message || null)
      publish({ status: 'error', error, durability: 'unknown', concurrency: 'none' })
      return result({ ok: false, code: error.code, error })
    }

    const document = canonicalizeDocument(migration?.document, {
      validateDocument,
      documentBytes,
      maxBytes,
    })
    const envelope = document && createEnvelope({
      document,
      migration: {
        status: typeof migration?.status === 'string' ? migration.status : 'migrated',
        at: Math.max(0, Number(now()) || 0),
        diagnostics: migration?.diagnostics,
        sourceSummary: migration?.sourceSummary,
      },
    })
    if (!envelope) {
      initialized = true
      const error = publicError('migration-invalid')
      publish({ status: 'error', error, durability: 'unknown', concurrency: 'none' })
      return result({ ok: false, code: error.code, error })
    }

    const initOp = {
      kind: 'initialize',
      opId: nextId('init'),
      envelope,
    }
    const outcome = await persistRecords([initOp], { initializeEnvelope: envelope })
    initialized = true
    const consumed = consumePersistence(outcome, [initOp])
    return outcome.kind === 'session-only'
      ? { ...consumed, code: 'initialized-session-only' }
      : consumed
  })

  const dispatch = (command) => enqueue(async () => {
    if (!initialized || !sessionEnvelope) {
      return result({ ok: false, code: 'not-initialized' })
    }
    if (snapshot.status === 'corrupt'
        || snapshot.status === 'error' && !sessionEnvelope) {
      return result({ ok: false, code: 'unavailable' })
    }

    const suppliedOpId = isObject(command) && validId(command.opId) ? command.opId : null
    const opId = suppliedOpId || nextId('op')
    if (sessionEnvelope.recentOps.includes(opId)
        || pendingOps.some((record) => record.opId === opId)) {
      return result({
        code: 'duplicate-op',
        persisted: snapshot.durability === 'durable',
        opId,
      })
    }

    const local = reduce(sessionEnvelope.document, command)
    if (!local.changed) {
      return result({
        ok: !local.error,
        code: local.code,
        persisted: snapshot.durability === 'durable',
        opId,
        ...(local.error ? { error: local.error } : {}),
      })
    }
    const canonical = canonicalCommand(command, local)
    if (!canonical) return result({ ok: false, code: 'unserializable-command', opId })

    const record = { kind: 'command', opId, command: canonical }
    const records = [...pendingOps, record]
    const initEnvelope = records[0]?.kind === 'initialize' ? records[0].envelope : null
    const outcome = await persistRecords(records, { initializeEnvelope: initEnvelope })
    return consumePersistence(outcome, records, { newOpId: opId })
  })

  const retryPersistence = () => enqueue(async () => {
    if (!initialized || !sessionEnvelope) return result({ ok: false, code: 'not-initialized' })
    if (pendingOps.length === 0) {
      return result({
        code: 'nothing-to-retry',
        persisted: snapshot.durability === 'durable',
      })
    }
    const records = [...pendingOps]
    const initEnvelope = records[0]?.kind === 'initialize' ? records[0].envelope : null
    const outcome = await persistRecords(records, { initializeEnvelope: initEnvelope })
    return consumePersistence(outcome, records)
  })

  const reloadFromDurable = ({ discardPending = false } = {}) => enqueue(async () => {
    if (!initialized) return result({ ok: false, code: 'not-initialized' })
    if (pendingOps.length > 0 && !discardPending) {
      const read = readDestination()
      if (read.status === 'ok' && durableEnvelope?.commit.id === read.envelope.commit.id) {
        return result({ ok: false, code: 'pending-session-state', persisted: false })
      }
      return result({
        ok: false,
        code: 'rebase-conflict',
        persisted: false,
        conflict: { code: 'external-update-with-pending-ops' },
      })
    }

    const read = readDestination()
    if (read.status !== 'ok') return unavailableResult(read, snapshot.concurrency)
    const unchanged = durableEnvelope?.commit.id === read.envelope.commit.id
    durableEnvelope = read.envelope
    pendingOps = []
    if (!unchanged || sessionEnvelope?.commit.id !== read.envelope.commit.id) {
      publish({
        envelope: read.envelope,
        durability: 'durable',
        concurrency: snapshot.concurrency,
      })
    }
    return result({
      code: unchanged ? 'already-current' : 'reloaded',
      changed: !unchanged,
      persisted: true,
      durability: 'durable',
    })
  })

  const onStorage = (event) => {
    if (destroyed || (event?.key !== destinationKey && event?.key !== null)) return
    reloadFromDurable().catch(() => {})
  }
  if (eventTarget && typeof eventTarget.addEventListener === 'function') {
    eventTarget.addEventListener('storage', onStorage)
  }

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    if (eventTarget && typeof eventTarget.removeEventListener === 'function') {
      eventTarget.removeEventListener('storage', onStorage)
    }
    listeners.clear()
  }

  return {
    physicalKey: destinationKey,
    initialize,
    dispatch,
    retryPersistence,
    reloadFromDurable,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    whenIdle: () => queue,
    destroy,
  }
}
