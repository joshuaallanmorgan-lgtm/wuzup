// planner-store.js — city-scoped durable coordination for the V2 planner.
//
// The reducer stays pure in planner-core.js. This module owns the browser
// boundary: one validated destination envelope, serialized same-tab commands,
// best-effort cross-tab coordination, exact durable-byte verification, and an
// explicit session-only state when persistence fails.
import {
  PLANNER_DOCUMENT_MAX_BYTES,
  addPlannerItem,
  applyPlannerUndo,
  emptyPlannerDocument,
  movePlannerItem,
  normalizePlannerDocument,
  plannerDocumentBytes,
  removePlannerItem,
  rolloverPlanner,
  setPlannerRest,
} from './planner-core.js'
import { migrateV1PlannerState } from './planner-migration.js'
import { createStorageScope, physicalKey } from './storage.js'

export const PLANNER_STORAGE_KEY = 'planner-v2'
export const PLANNER_ENVELOPE_VERSION = 1
export const PLANNER_RECENT_OPS_CAP = 64
export const PLANNER_OPTIMISTIC_ATTEMPTS = 3
export const PLANNER_METADATA_MAX_BYTES = 4096
export const PLANNER_MIGRATION_RECEIPT_MAX_BYTES = 8192

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,159}$/i
const ENCODER = new TextEncoder()
let plannerStoreInstanceCounter = 0

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const validId = (value) => typeof value === 'string' && ID_RE.test(value)
const validPrimary = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096 && value !== '|'
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

function boundedMetadata(value) {
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
  if (!state.truncated && jsonBytes(object) <= PLANNER_METADATA_MAX_BYTES) return object
  const summary = {
    truncated: true,
    byteLimit: PLANNER_METADATA_MAX_BYTES,
    topLevelKeys: isObject(value) ? Object.keys(value).slice(0, 24) : [],
  }
  return jsonBytes(summary) <= PLANNER_METADATA_MAX_BYTES
    ? summary
    : { truncated: true, byteLimit: PLANNER_METADATA_MAX_BYTES }
}

function boundedMigrationReceipt(value) {
  const receipt = {
    status: typeof value?.status === 'string' ? value.status.slice(0, 64) : 'unknown',
    ...(validTime(value?.at) ? { at: value.at } : {}),
    diagnostics: boundedMetadata(value?.diagnostics),
    sourceSummary: boundedMetadata(value?.sourceSummary),
  }
  if (jsonBytes(receipt) <= PLANNER_MIGRATION_RECEIPT_MAX_BYTES) return receipt
  return {
    status: receipt.status,
    ...(receipt.at !== undefined ? { at: receipt.at } : {}),
    truncated: true,
    byteLimit: PLANNER_MIGRATION_RECEIPT_MAX_BYTES,
  }
}

function validCommit(value) {
  return isObject(value)
    && validId(value.id)
    && (value.parentId === null || validId(value.parentId))
    && validTime(value.at)
    && Array.isArray(value.opIds)
    && value.opIds.length <= PLANNER_RECENT_OPS_CAP
    && value.opIds.every(validId)
}

function canonicalDocument(value) {
  if (!isObject(value) || value.v !== 2) return null
  if (plannerDocumentBytes(value) > PLANNER_DOCUMENT_MAX_BYTES) return null
  const normalized = normalizePlannerDocument(value)
  return jsonEqual(normalized, value)
    && plannerDocumentBytes(normalized) <= PLANNER_DOCUMENT_MAX_BYTES
    ? normalized
    : null
}

export function validatePlannerEnvelope(value, city) {
  if (!isObject(value)
      || value.v !== PLANNER_ENVELOPE_VERSION
      || value.cityId !== city.id
      || value.timeZone !== city.tz
      || !validCommit(value.commit)
      || !Array.isArray(value.recentOps)
      || value.recentOps.length > PLANNER_RECENT_OPS_CAP
      || !value.recentOps.every(validId)
      || new Set(value.recentOps).size !== value.recentOps.length
      || !isObject(value.migration)
      || typeof value.migration.status !== 'string'
      || value.migration.status.length > 64
      || jsonBytes(value.migration) > PLANNER_MIGRATION_RECEIPT_MAX_BYTES) {
    return null
  }
  const document = canonicalDocument(value.document)
  if (!document) return null
  return {
    v: PLANNER_ENVELOPE_VERSION,
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

function publicError(code, detail = null) {
  const error = { code }
  if (detail) error.detail = detail
  return error
}

function emptyPublicSnapshot(city) {
  return deepFreeze({
    status: 'idle',
    cityId: city.id,
    timeZone: city.tz,
    document: emptyPlannerDocument(),
    envelope: null,
    durability: 'unknown',
    concurrency: 'none',
    pendingOps: [],
    error: null,
    recovery: null,
  })
}

function commandType(command) {
  if (!isObject(command)) return null
  if (typeof command.type === 'string') return command.type
  return null
}

function addRetainedRef(document, command, ref) {
  if (!isObject(ref)
      || !validPrimary(ref.primary)
      || !Array.isArray(ref.aliases)
      || !isObject(ref.snapshot)) {
    return { document: normalizePlannerDocument(document), code: 'invalid-item', changed: false }
  }
  const added = addPlannerItem(document, {
    dayTs: command.dayTs,
    part: command.part,
    item: {
      kind: ref.kind,
      primary: ref.primary,
      aliases: ref.aliases,
    },
    plannedAt: ref.plannedAt,
  })
  if (!added.changed) return added
  let retainedRef
  try {
    retainedRef = jsonClone(ref)
  } catch {
    return { document: normalizePlannerDocument(document), code: 'invalid-item', changed: false }
  }
  const dayKey = String(command.dayTs)
  const entry = added.document.active[dayKey]
  const patched = normalizePlannerDocument({
    ...added.document,
    active: {
      ...added.document.active,
      [dayKey]: {
        ...entry,
        slots: { ...entry.slots, [command.part]: retainedRef },
      },
    },
  })
  const retained = patched.active[dayKey]?.slots?.[command.part]
  if (!retained) {
    return { document: normalizePlannerDocument(document), code: 'invalid-item', changed: false }
  }
  return { ...added, document: patched }
}

function reducePlanner(document, command) {
  switch (commandType(command)) {
    case 'add':
      if (isObject(command.item)
          && validPrimary(command.item.primary)
          && Array.isArray(command.item.aliases)
          && isObject(command.item.snapshot)) {
        return addRetainedRef(document, command, command.item)
      }
      return addPlannerItem(document, command)
    case 'add-ref':
      return addRetainedRef(document, command, command.ref)
    case 'remove':
      return removePlannerItem(document, command)
    case 'move':
      return movePlannerItem(document, command)
    case 'rest':
      return setPlannerRest(document, command)
    case 'undo':
      return applyPlannerUndo(document, command.receipt)
    case 'rollover':
      return rolloverPlanner(document, command)
    default:
      return { document: normalizePlannerDocument(document), code: 'invalid-command', changed: false }
  }
}

function canonicalCommand(command, reducerResult) {
  try {
    const type = commandType(command)
    if (type === 'add' || type === 'add-ref') {
      const ref = reducerResult.document.active[String(command.dayTs)]?.slots?.[command.part]
      if (!ref) return null
      return {
        type: 'add-ref',
        dayTs: command.dayTs,
        part: command.part,
        ref: jsonClone(ref),
      }
    }
    if (type === 'remove') {
      return {
        type,
        dayTs: command.dayTs,
        part: command.part,
        expectedPrimary: command.expectedPrimary,
      }
    }
    if (type === 'move') {
      return {
        type,
        fromDayTs: command.fromDayTs,
        fromPart: command.fromPart,
        toDayTs: command.toDayTs,
        toPart: command.toPart,
        expectedPrimary: command.expectedPrimary,
      }
    }
    if (type === 'rest') return { type, dayTs: command.dayTs, rest: command.rest }
    if (type === 'undo') return { type, receipt: jsonClone(command.receipt) }
    if (type === 'rollover') {
      return {
        type,
        todayTs: command.todayTs,
        ...(Number.isInteger(command.historyCap) ? { historyCap: command.historyCap } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

function appendRecent(current, opIds) {
  const next = [...current]
  for (const opId of opIds) {
    const index = next.indexOf(opId)
    if (index >= 0) next.splice(index, 1)
    next.push(opId)
  }
  return next.slice(-PLANNER_RECENT_OPS_CAP)
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

export function createPlannerStore({
  city,
  storageFactory = createStorageScope,
  lockManager = globalThis.navigator?.locks ?? null,
  eventTarget = globalThis.window ?? null,
  now = Date.now,
  createId = defaultId,
  contextId = null,
  migrate = migrateV1PlannerState,
} = {}) {
  if (!isObject(city) || !validId(city.id) || typeof city.tz !== 'string' || city.tz.length === 0) {
    throw new TypeError('createPlannerStore requires a city with valid id and tz')
  }
  if (typeof storageFactory !== 'function') throw new TypeError('storageFactory must be a function')
  if (typeof now !== 'function' || typeof createId !== 'function' || typeof migrate !== 'function') {
    throw new TypeError('now, createId, and migrate must be functions')
  }
  if (contextId !== null && !validId(contextId)) throw new TypeError('contextId must be a valid ID')

  const selected = { id: city.id, tz: city.tz }
  plannerStoreInstanceCounter += 1
  const instanceOrdinal = plannerStoreInstanceCounter
  const generatedContext = contextId || defaultId()
  if (!validId(generatedContext)) {
    throw new TypeError('contextId is required when secure per-instance entropy is unavailable')
  }
  const contextEntropy = compactIdToken(generatedContext, null)
  const destinationKey = physicalKey(PLANNER_STORAGE_KEY, { cityId: selected.id })
  const lockName = `wuzup:planner-v2:${selected.id}`
  const writeScope = storageFactory({ cityId: selected.id })
  if (!writeScope
      || typeof writeScope.set !== 'function'
      || typeof writeScope.peekDurable !== 'function') {
    throw new TypeError('storageFactory must return a storage scope with set/peekDurable')
  }

  let snapshot = emptyPublicSnapshot(selected)
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
        // One subscriber must not block the others.
      }
    }
  }

  const publish = ({
    status = 'ready',
    envelope = sessionEnvelope || durableEnvelope,
    durability = envelope && durableEnvelope?.commit.id === envelope.commit.id ? 'durable' : 'session-only',
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
      cityId: selected.id,
      timeZone: selected.tz,
      document: envelope?.document || emptyPlannerDocument(),
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
      const read = writeScope.peekDurable(PLANNER_STORAGE_KEY)
      if (read?.status === 'missing') return { status: 'ok', raw: null }
      if (read?.status === 'ok') return { status: 'ok', raw: read.value }
      return {
        status: 'io-error',
        raw: null,
        error: read?.error || new Error('Planner storage read failed'),
      }
    } catch (error) {
      return { status: 'io-error', raw: null, error }
    }
  }

  const readDestination = () => {
    const read = durableRaw()
    if (read.status !== 'ok') return read
    if (read.raw === null) return { status: 'missing', raw: null }
    if (typeof read.raw !== 'string') return { status: 'invalid', raw: read.raw }
    let parsed
    try {
      parsed = JSON.parse(read.raw)
    } catch {
      return { status: 'corrupt', raw: read.raw }
    }
    const envelope = validatePlannerEnvelope(parsed, selected)
    return envelope
      ? { status: 'ok', raw: read.raw, envelope }
      : { status: 'invalid', raw: read.raw }
  }

  const writeExact = (raw) => {
    let reported
    try {
      reported = writeScope.set(PLANNER_STORAGE_KEY, raw) === true
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

  const createEnvelope = ({ document, parent = null, opIds = [], migration }) => {
    const normalized = normalizePlannerDocument(document)
    if (plannerDocumentBytes(normalized) > PLANNER_DOCUMENT_MAX_BYTES) return null
    const parentId = parent?.commit.id || null
    let commitId = nextId('commit')
    for (let attempt = 0; commitId === parentId && attempt < 4; attempt += 1) {
      commitId = nextId('commit')
    }
    if (commitId === parentId) return null
    const envelope = {
      v: PLANNER_ENVELOPE_VERSION,
      cityId: selected.id,
      timeZone: selected.tz,
      document: normalized,
      commit: {
        id: commitId,
        parentId,
        at: Math.max(0, Number(now()) || 0),
        opIds: [...opIds],
      },
      recentOps: appendRecent(parent?.recentOps || [], opIds),
      migration: boundedMigrationReceipt(migration),
    }
    return validatePlannerEnvelope(envelope, selected)
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

  const corruptResult = (read, concurrency = snapshot.concurrency) => {
    const error = publicError(
      read.status === 'io-error' ? 'planner-storage-unavailable' : 'corrupt-planner-destination',
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
          optimistic: false,
        }))
      } catch (error) {
        return {
          kind: 'coordination-error',
          concurrency: 'web-lock',
          error: publicError('planner-lock-failed', error?.message || null),
        }
      }
    }
    return task({
      concurrency: 'optimistic-best-effort',
      attempts: PLANNER_OPTIMISTIC_ATTEMPTS,
      optimistic: true,
    })
  }

  const replayRecords = (base, records) => {
    let document = base.document
    const canonical = []
    const appliedOpIds = []
    let finalReducer = null

    for (const record of records) {
      if (base.recentOps.includes(record.opId) || appliedOpIds.includes(record.opId)) continue
      const reduced = reducePlanner(document, record.command)
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
    async ({ concurrency, attempts, optimistic }) => {
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
        if (read.status === 'missing' && records[0]?.kind === 'initialize' && commands.length === 0) {
          candidate = base
        } else if (replayed.appliedOpIds.length > 0) {
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

        if (optimistic) {
          const preflight = durableRaw()
          if (preflight.status !== 'ok') return { kind: 'read-error', read: preflight, concurrency }
          if (preflight.raw !== read.raw) continue
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
        if (write.landed.status === 'ok' && landedRaw !== read.raw && landedRaw !== null) {
          continue
        }
        return {
          kind: 'session-only',
          envelope: candidate,
          records: replayed.canonical,
          reducer: replayed.reducer,
          concurrency,
          error: publicError('planner-write-not-durable'),
        }
      }
      return {
        kind: 'conflict',
        concurrency: 'optimistic-best-effort',
        conflict: { code: 'optimistic-retry-exhausted' },
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
    if (outcome.kind === 'read-error') return corruptResult(outcome.read, outcome.concurrency)

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
        status: 'ready',
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

    const conflict = outcome.conflict || { code: 'planner-rebase-conflict' }
    return result({
      ok: false,
      code: 'planner-rebase-conflict',
      persisted: false,
      durability: snapshot.durability,
      concurrency: outcome.concurrency,
      opId: newOpId,
      conflict,
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
      return corruptResult(existing, 'none')
    }

    let captured
    if (options.source === undefined && options.sourceFactory !== undefined) {
      if (typeof options.sourceFactory !== 'function') {
        initialized = true
        const publicFailure = publicError('planner-migration-source-invalid')
        publish({ status: 'error', error: publicFailure, durability: 'unknown', concurrency: 'none' })
        return result({ ok: false, code: publicFailure.code, error: publicFailure })
      }
      try {
        captured = await options.sourceFactory()
      } catch (error) {
        initialized = true
        const publicFailure = publicError(
          'planner-migration-source-unavailable',
          error?.code || error?.message || null,
        )
        publish({ status: 'error', error: publicFailure, durability: 'unknown', concurrency: 'none' })
        return result({ ok: false, code: publicFailure.code, error: publicFailure })
      }
    }

    let source
    try {
      const input = options.source === undefined ? captured?.source : options.source
      source = input === undefined ? {} : jsonClone(input)
    } catch (error) {
      initialized = true
      const publicFailure = publicError('planner-migration-source-invalid', error?.message || null)
      publish({ status: 'error', error: publicFailure, durability: 'unknown', concurrency: 'none' })
      return result({ ok: false, code: publicFailure.code, error: publicFailure })
    }

    let migration
    try {
      migration = await migrate(source, {
        city,
        sourceTimeZone:
          options.sourceTimeZone
          || captured?.sourceTimeZone
          || source?.timeZone
          || selected.tz,
        todayTs: options.todayTs,
        weekendStartTs: options.weekendStartTs,
        catalog: options.catalog || [],
        seeds: options.seeds || [],
      })
    } catch (error) {
      initialized = true
      const publicFailure = publicError('planner-migration-failed', error?.message || null)
      publish({ status: 'error', error: publicFailure, durability: 'unknown', concurrency: 'none' })
      return result({ ok: false, code: publicFailure.code, error: publicFailure })
    }

    const document = normalizePlannerDocument(migration?.document)
    const envelope = createEnvelope({
      document,
      migration: {
        status: 'migrated',
        at: Math.max(0, Number(now()) || 0),
        diagnostics: migration?.diagnostics,
        sourceSummary: migration?.sourceSummary,
      },
    })
    if (!envelope) {
      initialized = true
      const publicFailure = publicError('planner-migration-invalid')
      publish({ status: 'error', error: publicFailure, durability: 'unknown', concurrency: 'none' })
      return result({ ok: false, code: publicFailure.code, error: publicFailure })
    }

    const initOp = {
      kind: 'initialize',
      opId: nextId('init'),
      envelope,
    }
    const outcome = await persistRecords([initOp], { initializeEnvelope: envelope })
    initialized = true
    const consumed = consumePersistence(outcome, [initOp])
    if (outcome.kind === 'session-only') {
      return { ...consumed, code: 'initialized-session-only' }
    }
    return consumed
  })

  const dispatch = (command) => enqueue(async () => {
    if (!initialized || !sessionEnvelope) {
      return result({ ok: false, code: 'not-initialized' })
    }
    if (snapshot.status === 'corrupt' || snapshot.status === 'error' && !sessionEnvelope) {
      return result({ ok: false, code: 'planner-unavailable' })
    }

    const suppliedOpId = isObject(command) && validId(command.opId) ? command.opId : null
    const opId = suppliedOpId || nextId('op')
    if (sessionEnvelope.recentOps.includes(opId) || pendingOps.some((record) => record.opId === opId)) {
      return result({
        code: 'duplicate-op',
        persisted: snapshot.durability === 'durable',
        opId,
      })
    }

    const local = reducePlanner(sessionEnvelope.document, command)
    if (!local.changed) {
      return result({
        code: local.code,
        persisted: snapshot.durability === 'durable',
        opId,
      })
    }
    const canonical = canonicalCommand(command, local)
    if (!canonical) {
      return result({ ok: false, code: 'unserializable-command', opId })
    }

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

  const replaceDocument = (value, {
    allowCorrupt = false,
    expectedCommitId = null,
  } = {}) => enqueue(async () => {
    if (!initialized) return result({ ok: false, code: 'not-initialized' })
    if (pendingOps.length > 0) {
      return result({
        ok: false,
        code: 'pending-session-state',
        conflict: { code: 'pending-session-state' },
      })
    }
    const document = normalizePlannerDocument(value)
    if (!jsonEqual(document, value)
        || plannerDocumentBytes(document) > PLANNER_DOCUMENT_MAX_BYTES) {
      return result({ ok: false, code: 'invalid-replacement-document' })
    }
    if (expectedCommitId !== null && !validId(expectedCommitId)) {
      return result({ ok: false, code: 'invalid-expected-commit' })
    }

    const outcome = await withCoordination(async ({ concurrency, attempts, optimistic }) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const before = durableRaw()
        if (before.status !== 'ok' || typeof before.raw !== 'string') {
          return { kind: 'failed', code: 'planner-storage-unavailable', concurrency }
        }
        let parent
        try {
          parent = validatePlannerEnvelope(JSON.parse(before.raw), selected)
        } catch {
          // Invalid destinations are handled by the explicit corrupt-state branch below.
        }
        if (!parent && !allowCorrupt) {
          return { kind: 'failed', code: 'corrupt-planner-destination', concurrency }
        }
        if (expectedCommitId !== null && parent?.commit.id !== expectedCommitId) {
          return { kind: 'conflict', code: 'planner-replacement-conflict', concurrency }
        }
        if (parent && jsonEqual(parent.document, document)) {
          return { kind: 'unchanged', envelope: parent, concurrency }
        }
        const envelope = createEnvelope({
          document,
          parent,
          migration: parent?.migration || {
            status: 'state-transfer-recovery',
            at: Math.max(0, Number(now()) || 0),
            diagnostics: { replacedCorruptDestination: !parent },
          },
        })
        const raw = envelope && serialization(envelope)
        if (!envelope || !raw) {
          return { kind: 'failed', code: 'invalid-replacement-envelope', concurrency }
        }
        if (optimistic) {
          const preflight = durableRaw()
          if (preflight.status !== 'ok' || preflight.raw !== before.raw) continue
        }
        const write = writeExact(raw)
        if (write.persisted) return { kind: 'persisted', envelope, concurrency }
        const landed = write.landed.status === 'ok' ? write.landed.raw : null
        if (optimistic && landed !== before.raw && landed !== null) continue
        return { kind: 'failed', code: 'write-not-durable', concurrency }
      }
      return { kind: 'conflict', code: 'planner-replacement-conflict', concurrency: 'optimistic-best-effort' }
    })

    if (outcome.kind === 'persisted' || outcome.kind === 'unchanged') {
      durableEnvelope = outcome.envelope
      pendingOps = []
      publish({
        envelope: outcome.envelope,
        durability: 'durable',
        concurrency: outcome.concurrency,
      })
      return result({
        code: outcome.kind === 'unchanged' ? 'replacement-unchanged' : 'document-replaced',
        changed: outcome.kind === 'persisted',
        persisted: true,
        durability: 'durable',
        concurrency: outcome.concurrency,
      })
    }
    return result({
      ok: false,
      code: outcome.code || outcome.error?.code || 'planner-replacement-failed',
      persisted: false,
      concurrency: outcome.concurrency,
      ...(outcome.kind === 'conflict'
        ? { conflict: { code: outcome.code || 'planner-replacement-conflict' } }
        : { error: outcome.error || publicError(outcome.code || 'planner-replacement-failed') }),
    })
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
        code: 'planner-rebase-conflict',
        persisted: false,
        conflict: { code: 'external-update-with-pending-ops' },
      })
    }

    const read = readDestination()
    if (read.status !== 'ok') return corruptResult(read, snapshot.concurrency)
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
    replaceDocument,
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
