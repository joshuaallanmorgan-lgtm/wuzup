/* eslint-disable react-refresh/only-export-components --
   this provider intentionally co-locates pure status/action/projection helpers
   with the context owner, matching the other retained-state providers. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { CITY } from './city.js'
import {
  createIdentityIndex,
  customIdentityBridgeOf,
  resolveIdentity,
} from './identity.js'
import {
  createSavedBeenStore,
  savedBeenAddCommand,
  savedBeenArchiveCommand,
  savedBeenImportCommand,
  savedBeenMarkCommand,
  savedBeenRemoveCommand,
  savedBeenUnmarkCommand,
} from './saved-been-store.js'
import {
  reduceSavedBeenState,
  SAVED_BEEN_CATALOG_SCAN_MAX,
  SAVED_BEEN_COLLECTION_SCAN_MAX,
  SAVED_BEEN_SEED_SCAN_MAX,
  savedBeenRefOf,
} from './saved-been-state-core.js'

const SavedBeenContext = createContext(null)
const EMPTY_RECORDS = Object.freeze([])
const EMPTY_STORE_SNAPSHOT = Object.freeze({
  status: 'idle',
  cityId: null,
  document: null,
  envelope: null,
  durability: 'unknown',
  concurrency: 'none',
  pendingOps: EMPTY_RECORDS,
  error: null,
  recovery: null,
})
const USABLE_STATUSES = new Set(['durable', 'session-only'])
const CHANGED_CODES = new Set([
  'archived',
  'imported',
  'marked-been',
  'removed',
  'saved',
  'unmarked-been',
])
const SUCCESSFUL_NO_CHANGE_CODES = new Set([
  'already-current',
  'already-marked',
  'already-saved',
  'duplicate-op',
  'not-been',
  'not-saved',
  'nothing-imported',
  'nothing-to-retry',
  'unchanged',
])
const RETRY_CHANGED_CODES = new Set([...CHANGED_CODES, 'persisted', 'session-only'])
const PUBLIC_CHANGED_CODES = new Set([...CHANGED_CODES, ...RETRY_CHANGED_CODES])
const CUSTOM_BRIDGE_RE = /^wuzup:custom-bridge:v1:[0-9]+:[0-9a-f]{16}$/
const CUSTOM_BRIDGE_MATCH_MIN = 2
const IDENTITY_REF_STATUSES = new Set(['attached', 'missing', 'ambiguous'])
const MISSING_RECORD_RESOLUTION = Object.freeze({
  status: 'missing',
  record: null,
})
const AMBIGUOUS_RECORD_RESOLUTION = Object.freeze({
  status: 'ambiguous',
  record: null,
})

function isObject(value) {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}
const validTime = (value) => Number.isSafeInteger(value) && value >= 0

function dataField(value, key) {
  if (!isObject(value)) return { present: false, ok: false, value: undefined }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return { present: false, ok: false, value: undefined }
    return descriptor.enumerable === true
      && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? { present: true, ok: true, value: descriptor.value }
      : { present: true, ok: false, value: undefined }
  } catch {
    return { present: true, ok: false, value: undefined }
  }
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function canonicalJson(value) {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

function publicIssue(value, fallbackCode) {
  const codeField = dataField(value, 'code')
  const detailField = dataField(value, 'detail')
  const code = codeField.ok && typeof codeField.value === 'string' && codeField.value
    ? codeField.value
    : fallbackCode
  const detail = detailField.ok && typeof detailField.value === 'string' && detailField.value
    ? detailField.value
    : null
  return Object.freeze({ code, ...(detail ? { detail } : {}) })
}

function actionFailure(code, snapshot = EMPTY_STORE_SNAPSHOT, detail = null) {
  return Object.freeze({
    ok: false,
    code,
    changed: false,
    applied: false,
    persisted: false,
    durability: typeof snapshot?.durability === 'string'
      ? snapshot.durability
      : 'unknown',
    concurrency: typeof snapshot?.concurrency === 'string'
      ? snapshot.concurrency
      : 'none',
    ...(detail ? { error: publicIssue({ code, detail }, code) } : {}),
  })
}

function publicActionResult(value, snapshot = EMPTY_STORE_SNAPSHOT) {
  const code = dataField(value, 'code')
  const changed = dataField(value, 'changed')
  const persisted = dataField(value, 'persisted')
  const ok = dataField(value, 'ok')
  if (!code.ok || typeof code.value !== 'string'
      || !changed.ok || typeof changed.value !== 'boolean'
      || !persisted.ok || typeof persisted.value !== 'boolean'
      || !ok.ok || typeof ok.value !== 'boolean') {
    return actionFailure('saved-been-result-invalid', snapshot)
  }
  if (PUBLIC_CHANGED_CODES.has(code.value) !== changed.value
      && (PUBLIC_CHANGED_CODES.has(code.value) || changed.value)) {
    return actionFailure('saved-been-result-inconsistent', snapshot)
  }
  const durability = dataField(value, 'durability')
  const concurrency = dataField(value, 'concurrency')
  const result = {
    ok: ok.value === true
      && (changed.value || SUCCESSFUL_NO_CHANGE_CODES.has(code.value)),
    code: code.value,
    changed: changed.value,
    applied: changed.value,
    persisted: persisted.value,
    durability: durability.ok && typeof durability.value === 'string'
      ? durability.value
      : snapshot.durability,
    concurrency: concurrency.ok && typeof concurrency.value === 'string'
      ? concurrency.value
      : snapshot.concurrency,
  }
  for (const field of ['error', 'conflict', 'rejection']) {
    const issue = dataField(value, field)
    if (issue.ok && issue.value) result[field] = publicIssue(issue.value, code.value)
  }
  const opId = dataField(value, 'opId')
  if (opId.ok && typeof opId.value === 'string') result.opId = opId.value
  return Object.freeze(result)
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

function identityProbe(ref) {
  return ref?.status === 'attached'
    ? { kind: ref.kind, primary: ref.primary, aliases: ref.aliases }
    : null
}

function targetRef(target) {
  try {
    const nested = isObject(target?.ref)
    const supplied = nested ? target.ref : target
    if (!nested && isObject(supplied)
        && typeof supplied.status === 'string'
        && !IDENTITY_REF_STATUSES.has(supplied.status)) {
      const candidate = { ...supplied }
      delete candidate.status
      return savedBeenRefOf(candidate)
    }
    return savedBeenRefOf(supplied)
  } catch {
    return null
  }
}

function hasExplicitRetainedRef(target) {
  const supplied = isObject(target?.ref) ? target.ref : target
  return isObject(supplied)
    && IDENTITY_REF_STATUSES.has(supplied.status)
    && typeof supplied.kind === 'string'
    && targetRef(supplied) !== null
}

function plainBridgeArray(value) {
  if (!Array.isArray(value)) return null
  try {
    if (Object.getOwnPropertySymbols(value).length > 0
        || Object.keys(value).length !== value.length) return null
    const out = []
    const seen = new Set()
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor?.enumerable !== true
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || typeof descriptor.value !== 'string'
          || !CUSTOM_BRIDGE_RE.test(descriptor.value)) {
        return null
      }
      if (!seen.has(descriptor.value)) {
        seen.add(descriptor.value)
        out.push(descriptor.value)
      }
    }
    return out.length >= CUSTOM_BRIDGE_MATCH_MIN ? out : null
  } catch {
    return null
  }
}

function sessionCustomEvidence(target) {
  if (!isObject(target)) return null
  const legacy = dataField(target, '_sessionLegacyIdentity')
  const bridges = dataField(target, '_sessionIdentityAliases')
  if (!legacy.ok || typeof legacy.value !== 'string' || !legacy.value
      || !bridges.ok) return null
  const aliases = plainBridgeArray(bridges.value)
  return aliases
    ? Object.freeze({ legacy: legacy.value, bridges: Object.freeze(aliases) })
    : null
}

function resolvedRecord(record) {
  return Object.freeze({ status: 'resolved', record })
}

function bridgeResolution(records, evidence) {
  if (!evidence || !Array.isArray(records)) return MISSING_RECORD_RESOLUTION
  if (records.length > SAVED_BEEN_COLLECTION_SCAN_MAX) return AMBIGUOUS_RECORD_RESOLUTION
  const evidenceSet = new Set(evidence.bridges)
  const matches = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const ref = record?.ref
    if (ref?.status !== 'attached' || ref.kind !== 'custom'
        || typeof ref.primary !== 'string') continue
    // The private retained ref owns a landed c| primary. Re-derive only its
    // opaque bridge and compare it to the trusted session projection. This
    // never exposes or guesses c| and remains sound when the bounded retained
    // alias list had no room to store derived bridges.
    const primaryBridge = customIdentityBridgeOf(ref.primary)
    if (primaryBridge && evidenceSet.has(primaryBridge)) matches.push(record)
  }
  if (matches.length === 1) return resolvedRecord(matches[0])
  return matches.length > 1
    ? AMBIGUOUS_RECORD_RESOLUTION
    : MISSING_RECORD_RESOLUTION
}

function identityEvidenceRecords(
  values,
  kind,
  scanMax = SAVED_BEEN_COLLECTION_SCAN_MAX,
) {
  const out = []
  if (!Array.isArray(values)) return out
  const limit = Math.min(values.length, scanMax)
  for (let index = 0; index < limit; index += 1) {
    const value = values[index]
    const ref = targetRef(value)
    if (ref?.status === 'attached' && ref.kind === kind) {
      out.push({ aliases: ref.aliases })
    }
  }
  return out
}

function recordIdentityIndex(records, kind, { seeds, evidenceRecords } = {}) {
  const candidates = []
  const source = Array.isArray(records) ? records : []
  const limit = Math.min(source.length, SAVED_BEEN_COLLECTION_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const record = source[index]
    const ref = targetRef(record)
    if (ref?.status !== 'attached' || ref.kind !== kind) continue
    candidates.push({
      kind,
      primary: ref.primary,
      aliases: ref.aliases,
      retainedRecord: record,
    })
  }
  return createIdentityIndex({
    items: candidates,
    records: [
      ...identityEvidenceRecords(evidenceRecords, kind),
      ...identityEvidenceRecords(seeds, kind, SAVED_BEEN_SEED_SCAN_MAX),
    ],
  })
}

function resolveRecord(records, target, evidence = {}) {
  const ref = targetRef(target)
  const key = refKey(ref)
  if (!Array.isArray(records)) return MISSING_RECORD_RESOLUTION
  if (records.length > SAVED_BEEN_COLLECTION_SCAN_MAX) return AMBIGUOUS_RECORD_RESOLUTION
  if (key) {
    const matches = records.filter((record) => refKey(record?.ref) === key)
    if (hasExplicitRetainedRef(target)) {
      if (matches.length === 1) return resolvedRecord(matches[0])
      return matches.length > 1
        ? AMBIGUOUS_RECORD_RESOLUTION
        : MISSING_RECORD_RESOLUTION
    }
    if (matches.length > 1) return AMBIGUOUS_RECORD_RESOLUTION
    if (ref.status !== 'attached') return MISSING_RECORD_RESOLUTION
    try {
      const resolution = resolveIdentity(
        ref,
        recordIdentityIndex(records, ref.kind, evidence),
      )
      if (resolution.status === 'ambiguous') return AMBIGUOUS_RECORD_RESOLUTION
      if (resolution.status === 'resolved' && resolution.item?.retainedRecord) {
        return resolvedRecord(resolution.item.retainedRecord)
      }
    } catch {
      return MISSING_RECORD_RESOLUTION
    }
    return MISSING_RECORD_RESOLUTION
  }
  return bridgeResolution(records, sessionCustomEvidence(target))
}

function findRecord(records, target, evidence = {}) {
  const resolution = resolveRecord(records, target, evidence)
  return resolution.status === 'resolved' ? resolution.record : null
}

function crossCollectionResolutions(saved, been, target, evidence = {}) {
  let savedResolution = resolveRecord(saved, target, evidence)
  let beenResolution = resolveRecord(been, target, evidence)
  if (hasExplicitRetainedRef(target)
      && savedResolution.status === 'resolved'
      && beenResolution.status === 'missing') {
    beenResolution = resolveRecord(
      been,
      identityProbe(savedResolution.record.ref),
      evidence,
    )
  } else if (hasExplicitRetainedRef(target)
      && beenResolution.status === 'resolved'
      && savedResolution.status === 'missing') {
    savedResolution = resolveRecord(
      saved,
      identityProbe(beenResolution.record.ref),
      evidence,
    )
  }
  return { savedResolution, beenResolution }
}

function crossCollectionConflict(savedResolution, beenResolution) {
  if (savedResolution.status === 'ambiguous'
      || beenResolution.status === 'ambiguous') return 'ambiguous'
  if (savedResolution.status === 'resolved'
      && beenResolution.status === 'resolved'
      && refKey(savedResolution.record.ref) !== refKey(beenResolution.record.ref)) {
    return 'ambiguous'
  }
  if (savedResolution.status === 'missing'
      && beenResolution.status === 'resolved'
      && beenResolution.record.status === 'went') return 'went'
  return null
}

export function savedBeenResolutionFor(records, target, evidence = {}) {
  return resolveRecord(records, target, evidence)
}

export function savedBeenRecordFor(records, target, evidence = {}) {
  return findRecord(records, target, evidence)
}

export function savedBeenToggleResolutionFor(
  saved,
  been,
  target,
  evidence = {},
) {
  const { savedResolution, beenResolution } = crossCollectionResolutions(
    saved,
    been,
    target,
    evidence,
  )
  const conflict = crossCollectionConflict(savedResolution, beenResolution)
  const status = conflict || savedResolution.status
  return Object.freeze({
    status,
    canToggle: conflict === null,
    saved: savedResolution.status === 'resolved',
    savedRecord: savedResolution.record,
    beenRecord: beenResolution.record,
    beenStatus: beenResolution.record?.status || null,
  })
}

function usableStoreSnapshot(snapshot) {
  const usableDurability = snapshot?.status === 'ready'
    ? ['durable', 'session-only'].includes(snapshot?.durability)
    : snapshot?.status === 'error' && snapshot?.durability === 'session-only'
  return usableDurability
    && isObject(snapshot?.document)
    && Array.isArray(snapshot.document.saved)
    && Array.isArray(snapshot.document.been)
}

function currentView(store) {
  if (!store || typeof store.getSnapshot !== 'function') return null
  try {
    const snapshot = store.getSnapshot()
    return usableStoreSnapshot(snapshot) ? snapshot : null
  } catch {
    return null
  }
}

function storeSnapshotOrEmpty(store) {
  try {
    return store?.getSnapshot?.() || EMPTY_STORE_SNAPSHOT
  } catch {
    return EMPTY_STORE_SNAPSHOT
  }
}

function withoutToken(record) {
  if (!isObject(record)) return null
  const copy = { ...record }
  delete copy.token
  return copy
}

function landedMutation(before, after) {
  return Number.isSafeInteger(before?.document?.rev)
    && Number.isSafeInteger(after?.document?.rev)
    && after.document.rev > before.document.rev
}

function changedDurabilityMatches(result, after) {
  return result.changed !== true || (
    result.durability === after?.durability
    && result.persisted === (after?.durability === 'durable')
  )
}

function expectedRecord(document, collection, command) {
  const reduced = reduceSavedBeenState(document, command)
  if (reduced?.changed !== true) return { reduced, record: null }
  const ref = command.ref || command.identity
  return {
    reduced,
    record: findRecord(reduced.document?.[collection], ref),
  }
}

function mutationEffectMatches(command, before, after) {
  if (!isObject(command) || !isObject(after?.document)) return false
  const savedAfter = after.document.saved
  const beenAfter = after.document.been
  if (command.type === 'add-record' || command.type === 'add') {
    const expected = expectedRecord(before.document, 'saved', command)
    const actual = findRecord(savedAfter, command.ref)
    return expected.reduced?.code === 'saved'
      && canonicalJson(withoutToken(actual)) === canonicalJson(withoutToken(expected.record))
  }
  if (command.type === 'remove') return findRecord(savedAfter, command.ref) === null
  if (command.type === 'archive-saved') {
    const expected = expectedRecord(before.document, 'been', command)
    const actual = findRecord(beenAfter, command.ref)
    return findRecord(savedAfter, command.ref) === null
      && expected.reduced?.code === 'archived'
      && canonicalJson(withoutToken(actual)) === canonicalJson(withoutToken(expected.record))
  }
  if (command.type === 'mark-been') {
    const expected = expectedRecord(before.document, 'been', command)
    const actual = findRecord(beenAfter, command.ref)
    return expected.reduced?.code === 'marked-been'
      && canonicalJson(withoutToken(actual)) === canonicalJson(withoutToken(expected.record))
      && (command.status !== 'went' || findRecord(savedAfter, command.ref) === null)
  }
  if (command.type === 'unmark-been') return findRecord(beenAfter, command.ref) === null
  if (command.type === 'import') {
    const replay = reduceSavedBeenState(after.document, command)
    return replay?.changed === false && replay?.code === 'nothing-imported'
  }
  return false
}

function recordsPreserved(beforeRecords, afterRecords, excludedRef = null) {
  const excluded = refKey(excludedRef)
  for (const record of beforeRecords) {
    if (excluded && refKey(record.ref) === excluded) continue
    const landed = findRecord(afterRecords, record.ref)
    if (canonicalJson(withoutToken(landed)) !== canonicalJson(withoutToken(record))) return false
  }
  return true
}

function collateralStatePreserved(command, before, after) {
  if (command.type === 'import') {
    const expected = reduceSavedBeenState(before.document, command)
    return expected?.changed === true
      && canonicalJson(expected.document) === canonicalJson(after.document)
  }
  const savedExclusion = ['remove', 'archive-saved'].includes(command.type)
      || command.type === 'mark-been' && command.status === 'went'
    ? command.ref
    : null
  const beenExclusion = ['archive-saved', 'mark-been', 'unmark-been'].includes(command.type)
    ? command.ref
    : null
  return recordsPreserved(before.document.saved, after.document.saved, savedExclusion)
    && recordsPreserved(before.document.been, after.document.been, beenExclusion)
}

function actionPostcondition(result, command, snapshot) {
  if (!isObject(result) || !isObject(command) || !isObject(snapshot?.document)) return result
  const output = { ...result, applied: result.changed === true }
  if (['add-record', 'add', 'remove', 'archive-saved', 'mark-been'].includes(command.type)) {
    output.saved = Boolean(findRecord(snapshot.document.saved, command.ref))
  }
  if (command.type === 'archive-saved') {
    output.archived = Boolean(findRecord(snapshot.document.been, command.ref))
  }
  if (command.type === 'mark-been' || command.type === 'unmark-been') {
    output.status = findRecord(snapshot.document.been, command.ref)?.status || null
  }
  return Object.freeze(output)
}

function validStore(store) {
  return isObject(store) && [
    'destroy',
    'dispatch',
    'getSnapshot',
    'initialize',
    'retryPersistence',
    'subscribe',
  ].every((method) => typeof store[method] === 'function')
}

function publicRecord(record) {
  const cloned = cloneJson(record)
  if (!cloned) return null
  // Tokens are private compare-and-swap capabilities. Public actions resolve
  // a token-free ref back to the current private record before building a
  // command, so consumers can never replay or forge an internal revision.
  delete cloned.token
  const key = cloned.ref?.status === 'attached'
    ? cloned.ref.primary
    : cloned.ref?.legacyKey
  if (typeof key === 'string' && key) cloned.key = key
  return deepFreeze(cloned)
}

export function projectSavedBeenDocument(document) {
  let saved
  let been
  try {
    if (!isObject(document)
        || !Array.isArray(document.saved)
        || !Array.isArray(document.been)) return null
    saved = document.saved.map(publicRecord)
    been = document.been.map(publicRecord)
  } catch {
    return null
  }
  return saved.some((record) => !record) || been.some((record) => !record)
    ? null
    : Object.freeze({
        saved: Object.freeze(saved),
        been: Object.freeze(been),
      })
}

function catalogKind(item, fallback) {
  if (fallback) return fallback
  if (item?.kind === 'custom' || item?.localId != null || item?.source === 'Added by you') {
    return 'custom'
  }
  return 'event'
}

function catalogIndex(catalogs, retainedRecords = EMPTY_RECORDS) {
  const candidates = new Map()
  const sessionCustom = []
  const add = (values, forcedKind = null) => {
    if (!Array.isArray(values)) return
    const limit = Math.min(values.length, SAVED_BEEN_CATALOG_SCAN_MAX)
    for (let index = 0; index < limit; index += 1) {
      const item = values[index]
      const sessionEvidence = forcedKind === 'custom' || item?.kind === 'custom'
        ? sessionCustomEvidence(item)
        : null
      if (sessionEvidence) {
        sessionCustom.push({ item, evidence: sessionEvidence })
        continue
      }
      let ref
      try {
        ref = targetRef(forcedKind && isObject(item) ? { ...item, kind: forcedKind } : item)
      } catch {
        ref = null
      }
      if (ref?.status !== 'attached' || ref.kind !== catalogKind(item, forcedKind)) continue
      if (!candidates.has(ref.kind)) candidates.set(ref.kind, [])
      candidates.get(ref.kind).push({
        kind: ref.kind,
        primary: ref.primary,
        aliases: ref.aliases,
        catalogItem: item,
      })
    }
  }
  add(catalogs.events)
  add(catalogs.customEvents, 'custom')
  add(catalogs.places, 'place')
  add(catalogs.guides, 'guide')
  const byKind = new Map()
  for (const kind of ['event', 'custom', 'place', 'guide']) {
    byKind.set(kind, createIdentityIndex({
      items: candidates.get(kind) || [],
      records: [
        ...identityEvidenceRecords(retainedRecords, kind),
        ...identityEvidenceRecords(catalogs.seeds, kind, SAVED_BEEN_SEED_SCAN_MAX),
      ],
    }))
  }
  return { byKind, sessionCustom }
}

function liveCatalogResolution(index, record, retainedRecords, seeds) {
  if (record?.ref?.status === 'attached') {
    try {
      const resolution = resolveIdentity(record.ref, index.byKind.get(record.ref.kind))
      if (resolution.status === 'ambiguous') return AMBIGUOUS_RECORD_RESOLUTION
      const item = resolution.status === 'resolved'
        ? resolution.item?.catalogItem
        : null
      if (item) {
        // Resolution must be unique in both directions. Otherwise two retained
        // rows sharing a weak alias could hydrate to the same current card and
        // make the duplicate look safe to mutate.
        const reverse = resolveRecord(retainedRecords, item, {
          seeds,
          evidenceRecords: retainedRecords,
        })
        if (reverse.status !== 'resolved' || reverse.record !== record) {
          return AMBIGUOUS_RECORD_RESOLUTION
        }
        return Object.freeze({ status: 'resolved', item })
      }
    } catch {
      return MISSING_RECORD_RESOLUTION
    }
  }
  if (record?.ref?.kind !== 'custom') return MISSING_RECORD_RESOLUTION
  const matches = []
  for (const candidate of index.sessionCustom) {
    const resolution = bridgeResolution(retainedRecords, candidate.evidence)
    if (resolution.status === 'ambiguous') return AMBIGUOUS_RECORD_RESOLUTION
    if (resolution.status === 'resolved' && resolution.record === record) {
      matches.push(candidate)
    }
  }
  if (matches.length === 1) return Object.freeze({ status: 'resolved', item: matches[0].item })
  return matches.length > 1
    ? AMBIGUOUS_RECORD_RESOLUTION
    : MISSING_RECORD_RESOLUTION
}

function fallbackItem(record) {
  if (!isObject(record?.snapshot) || Object.keys(record.snapshot).length === 0) return null
  const item = cloneJson(record.snapshot)
  if (!item) return null
  const kind = record.ref.kind
  if (['custom', 'place', 'guide'].includes(kind)) item.kind = kind
  return deepFreeze(item)
}

export function hydrateSavedBeenRecords(records, catalogs = {}) {
  if (!Array.isArray(records)) return EMPTY_RECORDS
  const index = catalogIndex(catalogs, records)
  const hydrated = records.map((record) => {
    const liveResolution = liveCatalogResolution(index, record, records, catalogs.seeds)
    const live = liveResolution.status === 'resolved' ? liveResolution.item : null
    const item = live || fallbackItem(record)
    // Live catalog objects remain owned by the artifact/custom providers.
    // Freeze only our wrapper; recursively freezing a borrowed item would
    // mutate the caller's catalog and can break later normalization.
    return Object.freeze({
      record,
      kind: record?.ref?.kind || 'unknown',
      identityStatus: liveResolution.status === 'ambiguous'
        ? 'ambiguous'
        : record?.ref?.status || 'missing',
      source: live ? 'live' : item ? 'snapshot' : 'unavailable',
      available: Boolean(item),
      item: item || null,
    })
  })
  return Object.freeze(hydrated)
}

export function savedBeenPublicStatus({
  lifecycle,
  storeSnapshot,
  runtimeError = null,
} = {}) {
  const snapshot = storeSnapshot || EMPTY_STORE_SNAPSHOT
  if (runtimeError || lifecycle?.phase === 'error') return 'error'
  if (!lifecycle || ['idle', 'initializing'].includes(lifecycle.phase)) return 'initializing'
  if (lifecycle.phase !== 'ready') return 'error'
  if (snapshot.status === 'corrupt') return 'corrupt'
  if (snapshot.durability === 'session-only' && usableStoreSnapshot(snapshot)) {
    return 'session-only'
  }
  if (snapshot.status === 'error') return 'error'
  if (snapshot.status === 'ready' && snapshot.durability === 'durable') return 'durable'
  return 'error'
}

export function isUsableSavedBeenStatus(status) {
  return USABLE_STATUSES.has(status)
}

export function savedBeenCatalogUnlocked(unlocked, {
  ready = false,
  error = null,
} = {}) {
  return unlocked === true || (ready === true && !error)
}

function createCatalogLatch({ ready, error }) {
  let unlocked = savedBeenCatalogUnlocked(false, { ready, error })
  const listeners = new Set()
  return {
    getSnapshot: () => unlocked,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    observe(next) {
      const value = savedBeenCatalogUnlocked(unlocked, next)
      if (value === unlocked) return
      unlocked = value
      for (const listener of [...listeners]) listener()
    },
  }
}

export function createSavedBeenActions(store, {
  now = Date.now,
  isAvailable = null,
  seeds = EMPTY_RECORDS,
} = {}) {
  const availableView = () => {
    if (!validStore(store)) return null
    if (typeof isAvailable === 'function' && isAvailable() !== true) return null
    return currentView(store)
  }
  const unavailable = () => actionFailure(
    'saved-been-unavailable',
    storeSnapshotOrEmpty(store),
  )
  const at = (supplied) => {
    if (validTime(supplied)) return supplied
    if (supplied !== undefined) return null
    try {
      const value = Number(now())
      return validTime(value) ? value : null
    } catch {
      return null
    }
  }
  const localResult = (code, snapshot) => Object.freeze({
    ok: SUCCESSFUL_NO_CHANGE_CODES.has(code),
    code,
    changed: false,
    applied: false,
    persisted: snapshot.durability === 'durable',
    durability: snapshot.durability,
    concurrency: snapshot.concurrency,
  })
  const resolutionFor = (snapshot, collection, target) => resolveRecord(
    snapshot.document[collection],
    target,
    {
      seeds,
      evidenceRecords: [
        ...snapshot.document.saved,
        ...snapshot.document.been,
      ],
    },
  )
  const ambiguousIdentity = (snapshot) => actionFailure(
    'saved-been-identity-ambiguous',
    snapshot,
  )
  const dispatch = async (command, before, expectedCode) => {
    let raw
    try {
      raw = await store.dispatch(command)
    } catch (error) {
      return actionFailure('saved-been-result-invalid', currentView(store) || before, error?.message)
    }
    const after = currentView(store)
    const result = publicActionResult(raw, after || before)
    if (result.code === 'saved-been-result-invalid'
        || result.code === 'saved-been-result-inconsistent') return result
    if (!result.changed) {
      return result.ok
        ? actionFailure('saved-been-result-inconsistent', after || before)
        : actionPostcondition(result, command, after)
    }
    if (!after
        || result.code !== expectedCode
        || !landedMutation(before, after)
        || !changedDurabilityMatches(result, after)
        || !mutationEffectMatches(command, before, after)
        || !collateralStatePreserved(command, before, after)) {
      return actionFailure('saved-been-result-inconsistent', after || before)
    }
    return actionPostcondition(result, command, after)
  }

  return Object.freeze({
    async toggleSaved(item, { savedAt } = {}) {
      const before = availableView()
      if (!before) return unavailable()
      const toggleResolution = savedBeenToggleResolutionFor(
        before.document.saved,
        before.document.been,
        item,
        {
          seeds,
          evidenceRecords: [
            ...before.document.saved,
            ...before.document.been,
          ],
        },
      )
      if (toggleResolution.status === 'ambiguous') return ambiguousIdentity(before)
      if (toggleResolution.status === 'went') {
        return actionFailure('saved-been-went-conflict', before)
      }
      const existing = toggleResolution.savedRecord
      const beenRecord = toggleResolution.beenRecord
      if (!existing && !beenRecord && sessionCustomEvidence(item)) {
        return actionFailure('saved-been-pending-identity', before)
      }
      const time = at(savedAt)
      if (!existing && time === null) return actionFailure('saved-been-invalid-time', before)
      const suppliedSnapshot = dataField(item, 'snapshot')
      const addTarget = beenRecord
        ? {
            ref: beenRecord.ref,
            snapshot: suppliedSnapshot.ok && isObject(suppliedSnapshot.value)
              ? suppliedSnapshot.value
              : item,
          }
        : item
      const command = existing
        ? savedBeenRemoveCommand(existing)
        : savedBeenAddCommand(addTarget, { savedAt: time })
      if (!command) return actionFailure('saved-been-command-unavailable', before)
      return dispatch(command, before, existing ? 'removed' : 'saved')
    },

    async removeSaved(target) {
      const before = availableView()
      if (!before) return unavailable()
      const resolution = resolutionFor(before, 'saved', target)
      if (resolution.status === 'ambiguous') return ambiguousIdentity(before)
      const record = resolution.record
      if (!record) return localResult('not-saved', before)
      const command = savedBeenRemoveCommand(record)
      if (!command) return actionFailure('saved-been-command-unavailable', before)
      return dispatch(command, before, 'removed')
    },

    async archiveSaved(target, { archivedAt } = {}) {
      const before = availableView()
      if (!before) return unavailable()
      const savedResolution = resolutionFor(before, 'saved', target)
      if (savedResolution.status === 'ambiguous') return ambiguousIdentity(before)
      const savedRecord = savedResolution.record
      if (!savedRecord) return localResult('not-saved', before)
      const time = at(archivedAt)
      if (time === null) return actionFailure('saved-been-invalid-time', before)
      const beenResolution = resolutionFor(
        before,
        'been',
        identityProbe(savedRecord.ref),
      )
      if (beenResolution.status === 'ambiguous') return ambiguousIdentity(before)
      const beenRecord = beenResolution.record
      if (beenRecord && refKey(beenRecord.ref) !== refKey(savedRecord.ref)) {
        return ambiguousIdentity(before)
      }
      const command = savedBeenArchiveCommand(savedRecord, {
        archivedAt: time,
        beenRecord,
      })
      if (!command) return actionFailure('saved-been-command-unavailable', before)
      return dispatch(command, before, 'archived')
    },

    async markBeen(item, {
      status,
      statusAt,
      savedAt,
      archivedAt,
    } = {}) {
      const before = availableView()
      if (!before) return unavailable()
      let savedResolution = resolutionFor(before, 'saved', item)
      let beenResolution = resolutionFor(before, 'been', item)
      if (savedResolution.status === 'ambiguous'
          || beenResolution.status === 'ambiguous') return ambiguousIdentity(before)
      if (hasExplicitRetainedRef(item)
          && savedResolution.status === 'resolved'
          && beenResolution.status === 'missing') {
        beenResolution = resolutionFor(
          before,
          'been',
          identityProbe(savedResolution.record.ref),
        )
      } else if (hasExplicitRetainedRef(item)
          && beenResolution.status === 'resolved'
          && savedResolution.status === 'missing') {
        savedResolution = resolutionFor(
          before,
          'saved',
          identityProbe(beenResolution.record.ref),
        )
      }
      if (savedResolution.status === 'ambiguous'
          || beenResolution.status === 'ambiguous') return ambiguousIdentity(before)
      const savedRecord = savedResolution.record
      const beenRecord = beenResolution.record
      if (savedRecord && beenRecord && refKey(savedRecord.ref) !== refKey(beenRecord.ref)) {
        return ambiguousIdentity(before)
      }
      const pendingIdentity = sessionCustomEvidence(item)
      if (pendingIdentity && !savedRecord && !beenRecord) {
        return actionFailure('saved-been-pending-identity', before)
      }
      const ref = savedRecord?.ref || beenRecord?.ref || targetRef(item)
      if (!ref || ref.kind === 'guide') return actionFailure('saved-been-command-unavailable', before)
      if (beenRecord?.status) {
        return Object.freeze({
          ...localResult('already-marked', before),
          status: beenRecord.status,
        })
      }
      const markAt = at(statusAt)
      const saveAt = savedAt === undefined ? undefined : at(savedAt)
      const archiveAt = archivedAt === undefined ? undefined : at(archivedAt)
      if (markAt === null || saveAt === null || archiveAt === null) {
        return actionFailure('saved-been-invalid-time', before)
      }
      const anchor = savedRecord || beenRecord
      const suppliedSnapshot = dataField(item, 'snapshot')
      const commandSeed = anchor
        ? {
            ref: anchor.ref,
            snapshot: pendingIdentity
              ? anchor.snapshot
              : suppliedSnapshot.ok && isObject(suppliedSnapshot.value)
                ? suppliedSnapshot.value
                : item,
          }
        : item
      const command = savedBeenMarkCommand(commandSeed, {
        status,
        statusAt: markAt,
        ...(saveAt !== undefined ? { savedAt: saveAt } : {}),
        ...(archiveAt !== undefined ? { archivedAt: archiveAt } : {}),
        savedRecord,
        beenRecord,
      })
      if (!command) return actionFailure('saved-been-command-unavailable', before)
      return dispatch(command, before, 'marked-been')
    },

    async unmarkBeen(target) {
      const before = availableView()
      if (!before) return unavailable()
      const resolution = resolutionFor(before, 'been', target)
      if (resolution.status === 'ambiguous') return ambiguousIdentity(before)
      const record = resolution.record
      if (!record) return localResult('not-been', before)
      const command = savedBeenUnmarkCommand(record)
      if (!command) return actionFailure('saved-been-command-unavailable', before)
      return dispatch(command, before, 'unmarked-been')
    },

    async importSavedBeen(incoming) {
      const before = availableView()
      if (!before) return unavailable()
      const command = savedBeenImportCommand(incoming)
      if (!command) return actionFailure('saved-been-command-unavailable', before)
      const expected = reduceSavedBeenState(before.document, command)
      if (expected?.changed !== true) return localResult(expected?.code || 'invalid-import', before)
      return dispatch(command, before, 'imported')
    },

    async retry() {
      const before = availableView()
      if (!before) return unavailable()
      let raw
      try {
        raw = await store.retryPersistence()
      } catch (error) {
        return actionFailure('saved-been-result-invalid', currentView(store) || before, error?.message)
      }
      const after = currentView(store)
      const result = publicActionResult(raw, after || before)
      if (!after) return actionFailure('saved-been-result-inconsistent', before)
      const beforePending = Array.isArray(before.pendingOps) ? before.pendingOps.length : -1
      const afterPending = Array.isArray(after.pendingOps) ? after.pendingOps.length : -1
      const documentStable = canonicalJson(before.document) === canonicalJson(after.document)
      const changedCodeMatches = result.code === 'persisted'
        ? after.durability === 'durable' && result.persisted === true
        : result.code === 'session-only'
          ? after.durability === 'session-only' && result.persisted === false
          : CHANGED_CODES.has(result.code)
      const matches = documentStable && (result.changed
        ? RETRY_CHANGED_CODES.has(result.code) && changedCodeMatches
          && result.durability === after.durability
          && result.persisted === (after.durability === 'durable')
          && (after.durability === 'durable' ? afterPending === 0 : afterPending > 0)
        : result.code === 'nothing-to-retry'
          ? beforePending === 0 && afterPending === 0
            && result.durability === after.durability
            && result.persisted === (after.durability === 'durable')
          : result.ok === false)
      return matches ? result : actionFailure('saved-been-result-inconsistent', after)
    },
  })
}

function createStoreHolder() {
  let snapshot = Object.freeze({
    store: null,
    lifecycle: Object.freeze({ phase: 'initializing', error: null }),
  })
  const listeners = new Set()
  const publish = (store, phase, error = null) => {
    snapshot = Object.freeze({
      store,
      lifecycle: Object.freeze({ phase, error }),
    })
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    begin(store) { publish(store, 'initializing') },
    ready(store) {
      if (snapshot.store === store) publish(store, 'ready')
    },
    fail(store, error) {
      if (snapshot.store === store) publish(store, 'error', error)
    },
    failCreation(error) {
      if (snapshot.store === null) publish(null, 'error', error)
    },
    clear(store) {
      if (snapshot.store === store) publish(null, 'initializing')
    },
  }
}

function providerError(code, error = null) {
  return Object.freeze({
    code,
    ...(error?.message ? { detail: error.message } : {}),
  })
}

function defaultSavedBeenStore(options) {
  return createSavedBeenStore(options)
}

function CitySavedBeenProvider({
  children,
  city,
  events,
  customEvents,
  places,
  guides,
  seeds,
  catalogReady,
  catalogError,
  storeFactory,
  now,
}) {
  const [holder] = useState(createStoreHolder)
  const [selectedCity] = useState(() => ({ id: city.id, tz: city.tz }))
  const storeFactoryRef = useRef(storeFactory)
  const catalogRef = useRef({ events, customEvents, places, guides, seeds })
  const [nowForCity] = useState(() => now)
  const [catalogLatch] = useState(
    () => createCatalogLatch({ ready: catalogReady, error: catalogError }),
  )

  useEffect(() => {
    catalogRef.current = { events, customEvents, places, guides, seeds }
  }, [customEvents, events, guides, places, seeds])

  useEffect(() => {
    catalogLatch.observe({
      ready: catalogReady,
      error: catalogError,
    })
  }, [catalogError, catalogLatch, catalogReady])
  const catalogUnlocked = useSyncExternalStore(
    catalogLatch.subscribe,
    catalogLatch.getSnapshot,
    catalogLatch.getSnapshot,
  )

  useEffect(() => {
    // The first trustworthy catalog unlocks migration for this keyed city.
    // Later artifact refreshes affect hydration only; they must never destroy
    // a valid retained-state store or its session-only pending operations.
    if (!catalogUnlocked) return undefined
    let active = true
    let store = null
    try {
      const catalogs = catalogRef.current
      store = storeFactoryRef.current({ city: selectedCity, ...catalogs })
      if (!validStore(store)) throw new TypeError('storeFactory must return a saved/Been store')
      holder.begin(store)
      Promise.resolve()
        // V1 capture is owned exclusively by the store's initialize seam.
        .then(() => store.initialize())
        .then(() => {
          if (!active || holder.getSnapshot().store !== store) return
          const snapshot = store.getSnapshot()
          if (['ready', 'corrupt', 'error'].includes(snapshot.status)) holder.ready(store)
          else holder.fail(store, providerError('saved-been-initialize-incomplete'))
        })
        .catch((error) => {
          if (!active || holder.getSnapshot().store !== store) return
          holder.fail(store, providerError('saved-been-provider-initialize-failed', error))
        })
    } catch (error) {
      holder.failCreation(providerError('saved-been-store-create-failed', error))
    }
    return () => {
      active = false
      holder.clear(store)
      if (typeof store?.destroy === 'function') store.destroy()
    }
  }, [catalogUnlocked, holder, selectedCity])

  const holderSnapshot = useSyncExternalStore(
    holder.subscribe,
    holder.getSnapshot,
    holder.getSnapshot,
  )
  const store = holderSnapshot.store
  const subscribeStore = useCallback(
    (listener) => store ? store.subscribe(listener) : () => {},
    [store],
  )
  const getStoreSnapshot = useCallback(
    () => store ? storeSnapshotOrEmpty(store) : EMPTY_STORE_SNAPSHOT,
    [store],
  )
  const storeSnapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot,
  )
  const dependencyError = !catalogUnlocked && catalogError
    ? publicIssue(catalogError, 'saved-been-catalog-unavailable')
    : null
  const baseStatus = savedBeenPublicStatus({
    lifecycle: holderSnapshot.lifecycle,
    storeSnapshot,
    runtimeError: holderSnapshot.lifecycle.error || dependencyError,
  })
  const projection = useMemo(() => {
    if (!isUsableSavedBeenStatus(baseStatus)) {
      return { ok: true, saved: EMPTY_RECORDS, been: EMPTY_RECORDS, error: null }
    }
    const projected = projectSavedBeenDocument(storeSnapshot.document)
    return projected
      ? { ok: true, ...projected, error: null }
      : {
          ok: false,
          saved: EMPTY_RECORDS,
          been: EMPTY_RECORDS,
          error: providerError('saved-been-projection-invalid'),
        }
  }, [baseStatus, storeSnapshot])
  const status = projection.ok ? baseStatus : 'error'
  const error = projection.error
    || dependencyError
    || holderSnapshot.lifecycle.error
    || (!isUsableSavedBeenStatus(status) ? storeSnapshot.error : null)
    || (status === 'corrupt' || status === 'error'
      ? providerError(`saved-been-${status}`)
      : null)
  const actions = useMemo(() => createSavedBeenActions(store, {
    now: nowForCity,
    seeds,
    isAvailable: () => {
      const current = holder.getSnapshot()
      return current.store === store && current.lifecycle.phase === 'ready'
    },
  }), [holder, nowForCity, seeds, store])
  const catalogValues = useMemo(
    () => ({ events, customEvents, places, guides, seeds }),
    [customEvents, events, guides, places, seeds],
  )
  const savedItems = useMemo(
    () => hydrateSavedBeenRecords(projection.saved, catalogValues),
    [catalogValues, projection.saved],
  )
  const beenItems = useMemo(
    () => hydrateSavedBeenRecords(projection.been, catalogValues),
    [catalogValues, projection.been],
  )
  const retainedIdentityEvidence = useMemo(
    () => [...projection.saved, ...projection.been],
    [projection.been, projection.saved],
  )
  const resolutionEvidence = useMemo(() => ({
    seeds,
    evidenceRecords: retainedIdentityEvidence,
  }), [retainedIdentityEvidence, seeds])
  const savedResolutionFor = useCallback(
    (item) => resolveRecord(projection.saved, item, resolutionEvidence),
    [projection.saved, resolutionEvidence],
  )
  const beenResolutionFor = useCallback(
    (item) => resolveRecord(projection.been, item, resolutionEvidence),
    [projection.been, resolutionEvidence],
  )
  const savedRecordFor = useCallback(
    (item) => savedResolutionFor(item).record,
    [savedResolutionFor],
  )
  const beenRecordFor = useCallback(
    (item) => beenResolutionFor(item).record,
    [beenResolutionFor],
  )
  const hasSaved = useCallback(
    (item) => savedRecordFor(item) !== null,
    [savedRecordFor],
  )
  const toggleResolutionFor = useCallback(
    (item) => savedBeenToggleResolutionFor(
      projection.saved,
      projection.been,
      item,
      resolutionEvidence,
    ),
    [projection.been, projection.saved, resolutionEvidence],
  )
  const canToggleSaved = useCallback(
    (item) => toggleResolutionFor(item).canToggle,
    [toggleResolutionFor],
  )
  const importSavedBeen = actions.importSavedBeen
  const retry = actions.retry

  const value = useMemo(() => ({
    phase: isUsableSavedBeenStatus(status) ? 'ready' : status,
    status,
    ready: isUsableSavedBeenStatus(status),
    durability: storeSnapshot.durability,
    error,
    recovery: storeSnapshot.recovery,
    saved: projection.saved,
    been: projection.been,
    savedRecords: projection.saved,
    beenRecords: projection.been,
    savedItems,
    beenItems,
    hasSaved,
    canToggleSaved,
    savedToggleResolutionFor: toggleResolutionFor,
    savedResolutionFor,
    beenResolutionFor,
    savedRecordFor,
    beenRecordFor,
    toggleSaved: actions.toggleSaved,
    removeSaved: actions.removeSaved,
    archiveSaved: actions.archiveSaved,
    markBeen: actions.markBeen,
    unmarkBeen: actions.unmarkBeen,
    import: importSavedBeen,
    importSavedBeen,
    retry,
    retryPersistence: retry,
  }), [
    actions.archiveSaved,
    actions.markBeen,
    actions.removeSaved,
    actions.toggleSaved,
    actions.unmarkBeen,
    beenItems,
    beenRecordFor,
    beenResolutionFor,
    canToggleSaved,
    error,
    hasSaved,
    importSavedBeen,
    projection.been,
    projection.saved,
    retry,
    savedItems,
    savedRecordFor,
    savedResolutionFor,
    status,
    storeSnapshot.durability,
    storeSnapshot.recovery,
    toggleResolutionFor,
  ])

  return (
    <SavedBeenContext.Provider value={value}>
      {children}
    </SavedBeenContext.Provider>
  )
}

export function SavedBeenProvider({
  children,
  city = CITY,
  events = EMPTY_RECORDS,
  customEvents = EMPTY_RECORDS,
  places = EMPTY_RECORDS,
  guides = EMPTY_RECORDS,
  seeds = EMPTY_RECORDS,
  catalogReady = true,
  catalogError = null,
  storeFactory = defaultSavedBeenStore,
  now = Date.now,
}) {
  const timeZone = city.tz
  const cityKey = `${city.id}:${timeZone}`
  return (
    <CitySavedBeenProvider
      key={cityKey}
      city={city}
      events={events}
      customEvents={customEvents}
      places={places}
      guides={guides}
      seeds={seeds}
      catalogReady={catalogReady}
      catalogError={catalogError}
      storeFactory={storeFactory}
      now={now}
    >
      {children}
    </CitySavedBeenProvider>
  )
}

export function useSavedBeen() {
  const value = useContext(SavedBeenContext)
  if (!value) throw new Error('useSavedBeen must be used within SavedBeenProvider')
  return value
}
