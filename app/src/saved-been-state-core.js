// saved-been-state-core.js — pure V2 saved and Been-there state.
//
// This module owns no browser or React behavior. It translates strict retained
// V1 capture into one city-bound destination document and exposes deterministic
// reducers that the generic atomic city store can replay. Stable identity,
// retained aliases, missing rows, and ambiguous rows stay explicit; no
// migration path reads, writes, removes, or otherwise claims V1 bytes.

import {
  createIdentityIndex,
  identityRefOf,
  isCustomEvent,
  resolveIdentity,
} from './identity.js'

export const SAVED_BEEN_STATE_VERSION = 2
export const SAVED_BEEN_SAVE_CAP = 400
export const SAVED_BEEN_BEEN_CAP = 200
export const SAVED_BEEN_COLLECTION_SCAN_MAX = 2048
export const SAVED_BEEN_CATALOG_SCAN_MAX = 16_384
export const SAVED_BEEN_SEED_SCAN_MAX = 2048
export const SAVED_BEEN_ALIAS_SCAN_MAX = 64
export const SAVED_BEEN_ALIAS_MAX_COUNT = 8
export const SAVED_BEEN_CANDIDATE_MAX_COUNT = 8
export const SAVED_BEEN_STRING_MAX_BYTES = 2048
export const SAVED_BEEN_SNAPSHOT_MAX_BYTES = 8192
export const SAVED_BEEN_RECORD_MAX_BYTES = 24 * 1024
export const SAVED_BEEN_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024
export const SAVED_BEEN_MIGRATION_SOURCE_MAX_BYTES = 4 * 1024 * 1024
export const SAVED_BEEN_COMMAND_MAX_BYTES = 64 * 1024
export const SAVED_BEEN_IMPORT_MAX_BYTES = 56 * 1024

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const GUIDE_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,159}$/i
const STABLE_EVENT_RE = /^e\|[0-9a-f]{16}$/
const STABLE_CUSTOM_RE = /^c\|[a-z0-9][a-z0-9_-]{7,63}$/i
const STABLE_PLACE_RE = /^p\|.+/
const V1_SAVED_KEY = 'saved-events-v1'
const V1_BEEN_KEY = 'been-there-v1'
const ENCODER = new TextEncoder()
const KINDS = new Set(['event', 'custom', 'place', 'guide', 'unknown'])
const SAVE_KINDS = new Set(['event', 'custom', 'place', 'guide'])
const BEEN_KINDS = new Set(['event', 'custom', 'place', 'unknown'])
const STATUSES = new Set(['went', 'missed'])
const STRUCTURED_PREFIX_KINDS = Object.freeze({
  'e|': 'event',
  'c|': 'custom',
  'p|': 'place',
  'g|': 'guide',
})

const SNAPSHOT_FIELDS = [
  'id', 'localId', 'kind', 'key', 'title', 'name', 'start', 'end', 'allDay',
  'timeZone', 'venue', 'address', 'neighborhood', 'city', 'lat', 'lng', 'image',
  'imageAlt', 'url', 'category', 'isFree', 'price', 'priceMin', 'priceMax',
  'currency', 'sponsored', 'status', 'source', 'sourceUrl', 'organizer',
  'placeType', 'fee', 'srcCount', 'hidden', 'tags', 'description', 'classes',
  'amenities', 'hours', 'sources', 'emoji', 'hue', 'pov', 'domain', 'plannable',
  'needsPlaces', 'window', 'keywords',
]

const SNAPSHOT_MAX_DEPTH = 3
const SNAPSHOT_MAX_NODES = 192
const SNAPSHOT_MAX_ARRAY_ITEMS = 24
const SNAPSHOT_MAX_OBJECT_KEYS = 24
const SNAPSHOT_KEY_MAX_BYTES = 128
const OBJECT_SCAN_MAX = 96

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function jsonBytes(value) {
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function savedBeenStateBytes(value) {
  return jsonBytes(value)
}

function boundedString(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '|'
    && jsonBytes(value) <= SAVED_BEEN_STRING_MAX_BYTES
}

function validCityId(value) {
  return boundedString(value) && CITY_ID_RE.test(value)
}

function requireCityId(value) {
  if (!validCityId(value)) throw new TypeError('cityId must be a valid non-empty city id')
  return value
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function orderedStrings(groups, maxCount = SAVED_BEEN_ALIAS_MAX_COUNT) {
  const out = []
  const seen = new Set()
  let scanned = 0
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    const limit = Math.min(group.length, SAVED_BEEN_ALIAS_SCAN_MAX - scanned)
    for (let index = 0; index < limit; index += 1) {
      scanned += 1
      const value = group[index]
      if (!boundedString(value) || seen.has(value)) continue
      seen.add(value)
      out.push(value)
      if (out.length >= maxCount) return out
    }
    if (scanned >= SAVED_BEEN_ALIAS_SCAN_MAX) break
  }
  return out
}

function sortedCandidates(values) {
  const out = []
  const seen = new Set()
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, SAVED_BEEN_ALIAS_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const value = source[index]
    if (!boundedString(value) || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out.sort().slice(0, SAVED_BEEN_CANDIDATE_MAX_COUNT)
}

function validAttachedPrimary(kind, primary) {
  if (!boundedString(primary)) return false
  if (kind === 'event') return STABLE_EVENT_RE.test(primary)
  if (kind === 'custom') return STABLE_CUSTOM_RE.test(primary)
  if (kind === 'place') return STABLE_PLACE_RE.test(primary)
  return kind === 'guide'
    && primary.startsWith('g|')
    && GUIDE_ID_RE.test(primary.slice(2))
}

function structuredKeyMatchesKind(kind, value) {
  if (!boundedString(value)) return false
  if (kind === 'unknown') return true
  const structuredKind = STRUCTURED_PREFIX_KINDS[value.slice(0, 2)]
  return structuredKind === undefined || structuredKind === kind
}

function attachedRef(kind, primary, groups = []) {
  if (!SAVE_KINDS.has(kind) || !validAttachedPrimary(kind, primary)) return null
  const aliases = orderedStrings([[primary], ...groups])
  if (aliases.some((alias) => !structuredKeyMatchesKind(kind, alias))) return null
  const ref = aliases[0] === primary
    ? { status: 'attached', kind, primary, aliases }
    : null
  return ref && jsonBytes(ref) <= SAVED_BEEN_RECORD_MAX_BYTES ? ref : null
}

function missingRef(kind, legacyKey) {
  if (!KINDS.has(kind)
      || !boundedString(legacyKey)
      || !structuredKeyMatchesKind(kind, legacyKey)
      || kind === 'guide' && !legacyKey.startsWith('g|')) {
    return null
  }
  const ref = { status: 'missing', kind, legacyKey }
  return jsonBytes(ref) <= SAVED_BEEN_RECORD_MAX_BYTES ? ref : null
}

function ambiguousRef(kind, legacyKey, candidates) {
  if (!KINDS.has(kind) || !structuredKeyMatchesKind(kind, legacyKey)) return null
  const bounded = sortedCandidates(candidates)
  if (bounded.some((candidate) => !structuredKeyMatchesKind(kind, candidate))) return null
  if (bounded.length === 0) return null
  const ref = { status: 'ambiguous', kind, legacyKey, candidates: bounded }
  return jsonBytes(ref) <= SAVED_BEEN_RECORD_MAX_BYTES ? ref : null
}

function normalizeRef(value, { allowGuide = true, allowUnknown = true } = {}) {
  if (!isObject(value) || !KINDS.has(value.kind)) return null
  if (!allowGuide && value.kind === 'guide') return null
  if (!allowUnknown && value.kind === 'unknown') return null

  if (value.status === 'attached') {
    if (!Array.isArray(value.aliases)) return null
    return attachedRef(value.kind, value.primary, [value.aliases])
  }
  if (value.status === 'missing') return missingRef(value.kind, value.legacyKey)
  if (value.status === 'ambiguous') {
    return ambiguousRef(value.kind, value.legacyKey, value.candidates)
  }
  return null
}

function refFingerprint(ref) {
  if (ref.status === 'attached') return `a\u0000${ref.kind}\u0000${ref.primary}`
  if (ref.status === 'missing') return `m\u0000${ref.kind}\u0000${ref.legacyKey}`
  return `x\u0000${ref.kind}\u0000${ref.legacyKey}\u0000${ref.candidates.join('\u0000')}`
}

function cloneSnapshotValue(value, state, depth = 0) {
  if (depth > SNAPSHOT_MAX_DEPTH || state.nodes >= SNAPSHOT_MAX_NODES) return undefined
  state.nodes += 1

  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    return jsonBytes(value) <= SAVED_BEEN_STRING_MAX_BYTES ? value : undefined
  }
  if (!Array.isArray(value) && !isObject(value)) return undefined
  if (state.seen.has(value)) return undefined

  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      const out = []
      const limit = Math.min(value.length, SNAPSHOT_MAX_ARRAY_ITEMS)
      for (let index = 0; index < limit; index += 1) {
        const cloned = cloneSnapshotValue(value[index], state, depth + 1)
        if (cloned !== undefined) out.push(cloned)
      }
      return out
    }

    const out = {}
    let scanned = 0
    let kept = 0
    for (const key in value) {
      if (scanned >= OBJECT_SCAN_MAX || kept >= SNAPSHOT_MAX_OBJECT_KEYS) break
      if (!hasOwn(value, key)) continue
      scanned += 1
      if (jsonBytes(key) > SNAPSHOT_KEY_MAX_BYTES) continue
      const cloned = cloneSnapshotValue(value[key], state, depth + 1)
      if (cloned === undefined) continue
      out[key] = cloned
      kept += 1
    }
    return out
  } finally {
    state.seen.delete(value)
  }
}

function snapshotOf(value, kind) {
  const source = isObject(value) ? value : {}
  const snapshot = {}
  const state = { nodes: 0, seen: new WeakSet() }
  for (const field of SNAPSHOT_FIELDS) {
    if (!hasOwn(source, field)) continue
    const cloned = cloneSnapshotValue(source[field], state)
    if (cloned === undefined) continue
    snapshot[field] = cloned
    if (jsonBytes(snapshot) > SAVED_BEEN_SNAPSHOT_MAX_BYTES) delete snapshot[field]
  }

  if (kind === 'place' || kind === 'guide' || kind === 'custom') snapshot.kind = kind
  else if (snapshot.kind === 'place' || snapshot.kind === 'guide' || snapshot.kind === 'custom') {
    delete snapshot.kind
  }
  if (kind === 'guide' && !boundedString(snapshot.id)) {
    const primary = typeof source.primary === 'string'
      ? source.primary
      : typeof source.key === 'string'
        ? source.key
        : null
    if (primary?.startsWith('g|') && boundedString(primary.slice(2))) {
      snapshot.id = primary.slice(2)
    }
  }
  return jsonBytes(snapshot) <= SAVED_BEEN_SNAPSHOT_MAX_BYTES ? snapshot : {}
}

function guideRefOf(item) {
  const primaryInput = boundedString(item.primary)
    ? item.primary
    : boundedString(item.key) && item.key.startsWith('g|')
      ? item.key
      : boundedString(item.id) && GUIDE_ID_RE.test(item.id)
        ? `g|${item.id}`
        : null
  if (!primaryInput || !primaryInput.startsWith('g|') || !GUIDE_ID_RE.test(primaryInput.slice(2))) {
    return null
  }
  return attachedRef('guide', primaryInput, [
    Array.isArray(item.aliases) ? item.aliases : [],
    Array.isArray(item.identityAliases) ? item.identityAliases : [],
  ])
}

function boundedIdentityRefOf(item, forcedKind = null) {
  if (!isObject(item)) return null
  if (item.status && item.kind) {
    return normalizeRef(item, {
      allowGuide: true,
      allowUnknown: false,
    })
  }
  if (forcedKind === 'guide' || item.kind === 'guide') return guideRefOf(item)

  try {
    if (boundedString(item.primary) && Array.isArray(item.aliases)) {
      const kind = forcedKind || (
        item.kind === 'place'
          ? 'place'
          : item.kind === 'custom'
            ? 'custom'
            : 'event'
      )
      return attachedRef(kind, item.primary, [item.aliases])
    }

    const rawKind = typeof item.kind === 'string' ? item.kind : null
    const placeKind = forcedKind === 'place' || rawKind === 'place'
    let customKind = forcedKind === 'custom'
      || rawKind === 'custom'
      || item.source === 'Added by you'
      || item.localId != null

    if (!customKind && Array.isArray(item.tags)) {
      const limit = Math.min(item.tags.length, SAVED_BEEN_ALIAS_SCAN_MAX)
      for (let index = 0; index < limit; index += 1) {
        if (item.tags[index] === 'added-by-you') {
          customKind = true
          break
        }
      }
      if (!customKind && item.tags.length > SAVED_BEEN_ALIAS_SCAN_MAX) return null
    }

    const projected = {
      kind: placeKind ? 'place' : customKind ? 'custom' : 'event',
    }
    if (placeKind && item.key != null) {
      if (!boundedString(item.key)) return null
      projected.key = item.key
    }
    if (item.id != null) {
      if (!boundedString(item.id)) return null
      projected.id = item.id
    }
    if (item.localId != null) {
      if (!boundedString(item.localId)) return null
      projected.localId = item.localId
    }

    if (!(placeKind && boundedString(projected.key))) {
      const legacyField = item.url
        ? 'url'
        : item._keyTitle
          ? '_keyTitle'
          : item.title
            ? 'title'
            : null
      if (legacyField) {
        if (!boundedString(item[legacyField])) return null
        projected[legacyField] = item[legacyField]
      }
      if (item.start != null) {
        if (!boundedString(item.start)) return null
        projected.start = item.start
      }
    }
    if (Array.isArray(item.identityAliases)) {
      projected.identityAliases = orderedStrings([item.identityAliases])
    }

    const identity = identityRefOf(projected)
    const kind = forcedKind || identity.kind
    return attachedRef(kind, identity.primary, [identity.aliases])
  } catch {
    return null
  }
}

export function savedBeenRefOf(item) {
  return boundedIdentityRefOf(item)
}

function normalizeSavedRecord(value, rev) {
  if (!isObject(value) || jsonBytes(value) > SAVED_BEEN_RECORD_MAX_BYTES) return null
  const ref = normalizeRef(value.ref, { allowGuide: true, allowUnknown: true })
  if (!ref || ref.status === 'attached' && !SAVE_KINDS.has(ref.kind)) return null
  if (!validRevision(value.token) || value.token === 0 || value.token > rev) return null
  const record = {
    ref,
    snapshot: snapshotOf(value.snapshot, ref.kind),
    token: value.token,
  }
  if (validTime(value.savedAt)) record.savedAt = value.savedAt
  return jsonBytes(record) <= SAVED_BEEN_RECORD_MAX_BYTES ? record : null
}

function normalizeBeenRecord(value, rev) {
  if (!isObject(value) || jsonBytes(value) > SAVED_BEEN_RECORD_MAX_BYTES) return null
  const ref = normalizeRef(value.ref, { allowGuide: false, allowUnknown: true })
  if (!ref || !BEEN_KINDS.has(ref.kind)) return null
  if (!validRevision(value.token) || value.token === 0 || value.token > rev) return null
  if (value.status !== undefined && !STATUSES.has(value.status)) return null
  if (value.status !== undefined && !validTime(value.statusAt)) return null

  const record = {
    ref,
    snapshot: snapshotOf(value.snapshot, ref.kind),
    token: value.token,
  }
  if (validTime(value.savedAt)) record.savedAt = value.savedAt
  if (validTime(value.archivedAt)) record.archivedAt = value.archivedAt
  if (value.status !== undefined) {
    record.status = value.status
    record.statusAt = value.statusAt
  }
  return jsonBytes(record) <= SAVED_BEEN_RECORD_MAX_BYTES ? record : null
}

function normalizeCollection(value, { cap, normalizeRecord }) {
  if (!Array.isArray(value) || value.length > cap) return null
  const out = []
  const seen = new Set()
  for (let index = 0; index < value.length; index += 1) {
    const record = normalizeRecord(value[index])
    if (!record) return null
    const fingerprint = refFingerprint(record.ref)
    if (seen.has(fingerprint)) return null
    seen.add(fingerprint)
    out.push(record)
  }
  return out
}

export function emptySavedBeenState(cityId) {
  return deepFreeze({
    v: SAVED_BEEN_STATE_VERSION,
    cityId: requireCityId(cityId),
    rev: 0,
    saved: [],
    been: [],
  })
}

export function normalizeSavedBeenState(value, { cityId } = {}) {
  const selectedCityId = requireCityId(cityId)
  if (!isObject(value)
      || value.v !== SAVED_BEEN_STATE_VERSION
      || value.cityId !== selectedCityId
      || !validRevision(value.rev)
      || jsonBytes(value) > SAVED_BEEN_DOCUMENT_MAX_BYTES) {
    return null
  }

  const saved = normalizeCollection(value.saved, {
    cap: SAVED_BEEN_SAVE_CAP,
    normalizeRecord: (record) => normalizeSavedRecord(record, value.rev),
  })
  const been = normalizeCollection(value.been, {
    cap: SAVED_BEEN_BEEN_CAP,
    normalizeRecord: (record) => normalizeBeenRecord(record, value.rev),
  })
  if (!saved || !been) return null
  const went = new Set(
    been
      .filter((record) => record.status === 'went')
      .map((record) => refFingerprint(record.ref)),
  )
  if (saved.some((record) => went.has(refFingerprint(record.ref)))) return null

  const document = {
    v: SAVED_BEEN_STATE_VERSION,
    cityId: selectedCityId,
    rev: value.rev,
    saved,
    been,
  }
  return jsonBytes(document) <= SAVED_BEEN_DOCUMENT_MAX_BYTES
    ? deepFreeze(document)
    : null
}

function canonicalDocument(value) {
  if (!isObject(value) || !validCityId(value.cityId)) return null
  return normalizeSavedBeenState(value, { cityId: value.cityId })
}

function operationResult(document, code, changed = false, canonical = null) {
  const result = { document, code, changed }
  if (canonical) result.canonical = canonical
  return deepFreeze(result)
}

function invalidDocumentResult() {
  return deepFreeze({ document: null, code: 'invalid-document', changed: false })
}

function nextRevision(base) {
  return base.rev < Number.MAX_SAFE_INTEGER - 1 ? base.rev + 1 : null
}

function findRecord(records, ref) {
  const fingerprint = refFingerprint(ref)
  const index = records.findIndex((record) => refFingerprint(record.ref) === fingerprint)
  return index < 0 ? null : { index, record: records[index] }
}

function commandRef(command, { allowGuide = true, allowUnknown = true } = {}) {
  const supplied = command?.ref ?? command?.identity
  if (supplied !== undefined) {
    return normalizeRef(supplied, { allowGuide, allowUnknown })
  }
  const item = command?.item
  if (!isObject(item)) return null
  const ref = boundedIdentityRefOf(item)
  if (!ref || !allowGuide && ref.kind === 'guide' || !allowUnknown && ref.kind === 'unknown') return null
  return ref
}

function declaredSnapshotKind(value) {
  if (!isObject(value)) return null
  if (value.kind === 'guide') return 'guide'
  if (value.kind === 'place') return 'place'
  if (value.kind === 'custom' || isCustomEvent(value)) return 'custom'
  return 'event'
}

function snapshotMatchesKind(value, kind) {
  const declared = declaredSnapshotKind(value)
  if (declared === null || kind === 'unknown') return true
  return declared === kind
}

function addRecord(document, command) {
  const base = canonicalDocument(document)
  if (!base) return invalidDocumentResult()
  const ref = commandRef(command, { allowGuide: true, allowUnknown: false })
  if (!ref || ref.status !== 'attached') return operationResult(base, 'invalid-item')
  if (!validTime(command.savedAt)) return operationResult(base, 'invalid-time')
  if (hasOwn(command, 'expectedAbsent') && command.expectedAbsent !== true) {
    return operationResult(base, 'invalid-command')
  }
  if (findRecord(base.saved, ref)) return operationResult(base, 'already-saved')
  if (base.saved.length >= SAVED_BEEN_SAVE_CAP) {
    return operationResult(base, 'save-cap-reached')
  }
  const rev = nextRevision(base)
  if (rev === null) return operationResult(base, 'revision-exhausted')

  const snapshotSource = isObject(command.snapshot) ? command.snapshot : command.item
  if (!snapshotMatchesKind(snapshotSource, ref.kind)) {
    return operationResult(base, 'snapshot-kind-mismatch')
  }
  const record = normalizeSavedRecord({
    ref,
    snapshot: snapshotOf(snapshotSource, ref.kind),
    savedAt: command.savedAt,
    token: rev,
  }, rev)
  if (!record) return operationResult(base, 'invalid-item')

  const saved = [...base.saved, record]
  const next = normalizeSavedBeenState({ ...base, rev, saved }, { cityId: base.cityId })
  if (!next) return operationResult(base, 'invalid-document')
  return operationResult(next, 'saved', true, {
    type: 'add-record',
    ref,
    snapshot: record.snapshot,
    savedAt: record.savedAt,
    expectedAbsent: true,
  })
}

export function addSaved(document, command = {}) {
  return addRecord(document, command)
}

export function removeSaved(document, command = {}) {
  const base = canonicalDocument(document)
  if (!base) return invalidDocumentResult()
  const ref = commandRef(command, { allowGuide: true, allowUnknown: true })
  if (!ref) return operationResult(base, 'invalid-item')
  const found = findRecord(base.saved, ref)
  if (!found) return operationResult(base, 'not-saved')
  if (hasOwn(command, 'expectedToken') && command.expectedToken !== found.record.token) {
    return operationResult(base, 'save-conflict')
  }
  const rev = nextRevision(base)
  if (rev === null) return operationResult(base, 'revision-exhausted')
  const saved = base.saved.filter((_, index) => index !== found.index)
  const next = normalizeSavedBeenState({ ...base, rev, saved }, { cityId: base.cityId })
  if (!next) return operationResult(base, 'invalid-document')
  return operationResult(next, 'removed', true, {
    type: 'remove',
    ref,
    expectedToken: found.record.token,
  })
}

export function toggleSaved(document, command = {}) {
  const base = canonicalDocument(document)
  if (!base) return invalidDocumentResult()
  const ref = commandRef(command, { allowGuide: true, allowUnknown: false })
  if (!ref || ref.status !== 'attached') return operationResult(base, 'invalid-item')
  const found = findRecord(base.saved, ref)
  return found
    ? removeSaved(base, { ref, expectedToken: found.record.token })
    : addSaved(base, command)
}

export function archiveSaved(document, command = {}) {
  const base = canonicalDocument(document)
  if (!base) return invalidDocumentResult()
  if (!validTime(command.archivedAt)) return operationResult(base, 'invalid-time')
  const ref = commandRef(command, { allowGuide: false, allowUnknown: true })
  if (!ref) return operationResult(base, 'invalid-item')
  const foundSave = findRecord(base.saved, ref)
  if (!foundSave) return operationResult(base, 'not-saved')
  if (hasOwn(command, 'expectedSaveToken')
      && command.expectedSaveToken !== foundSave.record.token) {
    return operationResult(base, 'save-conflict')
  }

  const foundBeen = findRecord(base.been, ref)
  if (!expectedTokenMatches(command, 'expectedBeenToken', foundBeen?.record.token ?? null)) {
    return operationResult(base, 'been-conflict')
  }
  if (!foundBeen && base.been.length >= SAVED_BEEN_BEEN_CAP) {
    return operationResult(base, 'been-cap-reached')
  }
  const rev = nextRevision(base)
  if (rev === null) return operationResult(base, 'revision-exhausted')
  let been = base.been
  if (!foundBeen) {
    const record = normalizeBeenRecord({
      ref,
      snapshot: foundSave.record.snapshot,
      ...(foundSave.record.savedAt !== undefined ? { savedAt: foundSave.record.savedAt } : {}),
      archivedAt: command.archivedAt,
      token: rev,
    }, rev)
    if (!record) return operationResult(base, 'invalid-item')
    been = [...been, record]
  }
  const saved = base.saved.filter((_, index) => index !== foundSave.index)
  const next = normalizeSavedBeenState({ ...base, rev, saved, been }, { cityId: base.cityId })
  if (!next) return operationResult(base, 'invalid-document')
  return operationResult(next, 'archived', true, {
    type: 'archive-saved',
    ref,
    archivedAt: command.archivedAt,
    expectedSaveToken: foundSave.record.token,
    expectedBeenToken: foundBeen?.record.token ?? null,
  })
}

function expectedTokenMatches(command, name, actual) {
  return !hasOwn(command, name) || command[name] === actual
}

export function markBeen(document, command = {}) {
  const base = canonicalDocument(document)
  if (!base) return invalidDocumentResult()
  if (!STATUSES.has(command.status) || !validTime(command.statusAt)) {
    return operationResult(base, 'invalid-command')
  }
  const ref = commandRef(command, { allowGuide: false, allowUnknown: true })
  if (!ref) return operationResult(base, 'invalid-item')

  const foundBeen = findRecord(base.been, ref)
  const foundSave = findRecord(base.saved, ref)
  if (!expectedTokenMatches(command, 'expectedBeenToken', foundBeen?.record.token ?? null)
      || !expectedTokenMatches(command, 'expectedSaveToken', foundSave?.record.token ?? null)) {
    return operationResult(base, 'been-conflict')
  }
  if (foundBeen?.record.status) return operationResult(base, 'already-marked')
  if (!foundBeen && base.been.length >= SAVED_BEEN_BEEN_CAP) {
    return operationResult(base, 'been-cap-reached')
  }

  const rev = nextRevision(base)
  if (rev === null) return operationResult(base, 'revision-exhausted')
  const sourceSnapshot = foundBeen?.record.snapshot
    ?? foundSave?.record.snapshot
    ?? command.snapshot
    ?? command.item
  if (!snapshotMatchesKind(sourceSnapshot, ref.kind)) {
    return operationResult(base, 'snapshot-kind-mismatch')
  }
  const record = normalizeBeenRecord({
    ref,
    snapshot: snapshotOf(sourceSnapshot, ref.kind),
    savedAt: foundBeen?.record.savedAt ?? foundSave?.record.savedAt ?? command.savedAt,
    archivedAt: foundBeen?.record.archivedAt
      ?? (validTime(command.archivedAt) ? command.archivedAt : command.statusAt),
    status: command.status,
    statusAt: command.statusAt,
    token: rev,
  }, rev)
  if (!record) return operationResult(base, 'invalid-item')

  const been = foundBeen
    ? base.been.map((value, index) => index === foundBeen.index ? record : value)
    : [...base.been, record]
  const saved = command.status === 'went' && foundSave
    ? base.saved.filter((_, index) => index !== foundSave.index)
    : base.saved
  const next = normalizeSavedBeenState({ ...base, rev, saved, been }, { cityId: base.cityId })
  if (!next) return operationResult(base, 'invalid-document')
  return operationResult(next, 'marked-been', true, {
    type: 'mark-been',
    ref,
    snapshot: record.snapshot,
    ...(record.savedAt !== undefined ? { savedAt: record.savedAt } : {}),
    ...(record.archivedAt !== undefined ? { archivedAt: record.archivedAt } : {}),
    status: record.status,
    statusAt: record.statusAt,
    expectedBeenToken: foundBeen?.record.token ?? null,
    expectedSaveToken: foundSave?.record.token ?? null,
  })
}

export function unmarkBeen(document, command = {}) {
  const base = canonicalDocument(document)
  if (!base) return invalidDocumentResult()
  const ref = commandRef(command, { allowGuide: false, allowUnknown: true })
  if (!ref) return operationResult(base, 'invalid-item')
  const found = findRecord(base.been, ref)
  if (!found) return operationResult(base, 'not-been')
  if (hasOwn(command, 'expectedToken') && command.expectedToken !== found.record.token) {
    return operationResult(base, 'been-conflict')
  }
  const rev = nextRevision(base)
  if (rev === null) return operationResult(base, 'revision-exhausted')
  const been = base.been.filter((_, index) => index !== found.index)
  const next = normalizeSavedBeenState({ ...base, rev, been }, { cityId: base.cityId })
  if (!next) return operationResult(base, 'invalid-document')
  return operationResult(next, 'unmarked-been', true, {
    type: 'unmark-been',
    ref,
    expectedToken: found.record.token,
  })
}

export function importSavedBeen(document, command = {}) {
  const base = canonicalDocument(document)
  if (!base) return invalidDocumentResult()
  if (isObject(command.incoming)
      && validCityId(command.incoming.cityId)
      && command.incoming.cityId !== base.cityId) {
    return operationResult(base, 'import-city-mismatch')
  }
  if (jsonBytes({ type: 'import', incoming: command.incoming }) > SAVED_BEEN_IMPORT_MAX_BYTES) {
    return operationResult(base, 'import-too-large')
  }
  const incoming = isObject(command.incoming)
    ? normalizeSavedBeenState(command.incoming, { cityId: base.cityId })
    : null
  if (!incoming) {
    return operationResult(base, 'invalid-import')
  }

  const merge = (current, additions, collection) => {
    const records = [...current]
    const byFingerprint = new Map(
      records.map((record, index) => [refFingerprint(record.ref), index]),
    )
    const changedIndexes = new Set()
    for (const incomingRecord of additions) {
      const fingerprint = refFingerprint(incomingRecord.ref)
      const index = byFingerprint.get(fingerprint)
      if (index === undefined) {
        byFingerprint.set(fingerprint, records.length)
        records.push(withoutToken(incomingRecord))
        changedIndexes.add(records.length - 1)
        continue
      }
      const existing = records[index]
      const merged = {
        ...withoutToken(incomingRecord),
        ...withoutToken(existing),
        ref: mergedRef(existing.ref, incomingRecord.ref),
        snapshot: nonEmptySnapshot(existing.snapshot)
          ? existing.snapshot
          : incomingRecord.snapshot,
      }
      if (collection === 'been' && !existing.status && incomingRecord.status) {
        merged.status = incomingRecord.status
        merged.statusAt = incomingRecord.statusAt
      }
      if (!jsonEqual(withoutToken(existing), merged)) {
        records[index] = merged
        changedIndexes.add(index)
      }
    }
    return { records, changedIndexes }
  }

  const beenMerge = merge(base.been, incoming.been, 'been')
  const went = new Set(
    beenMerge.records
      .filter((record) => record.status === 'went')
      .map((record) => refFingerprint(record.ref)),
  )
  // A save cannot materially coexist with a final `went` answer. Ignore an
  // incoming save that reconciliation would immediately remove so repeated
  // imports are true no-ops instead of revision churn.
  const eligibleIncomingSaved = incoming.saved.filter(
    (record) => !went.has(refFingerprint(record.ref)),
  )
  const savedMerge = merge(base.saved, eligibleIncomingSaved, 'saved')
  const saved = savedMerge.records.filter(
    (record) => !went.has(refFingerprint(record.ref)),
  )
  const removedWentSave = saved.length !== savedMerge.records.length
  if (saved.length > SAVED_BEEN_SAVE_CAP
      || beenMerge.records.length > SAVED_BEEN_BEEN_CAP) {
    return operationResult(base, 'import-cap-exceeded')
  }
  if (savedMerge.changedIndexes.size === 0
      && beenMerge.changedIndexes.size === 0
      && !removedWentSave) {
    return operationResult(base, 'nothing-imported')
  }
  const rev = nextRevision(base)
  if (rev === null) return operationResult(base, 'revision-exhausted')
  const retoken = (records, changedIndexes) => records.map((record, index) => (
    changedIndexes.has(index)
      ? { ...record, token: rev }
      : record
  ))
  const savedWithTokens = saved.map((record) => {
    const sourceIndex = savedMerge.records.indexOf(record)
    return savedMerge.changedIndexes.has(sourceIndex)
      ? { ...record, token: rev }
      : record
  })
  const been = retoken(beenMerge.records, beenMerge.changedIndexes)
  const next = normalizeSavedBeenState({
    ...base,
    rev,
    saved: savedWithTokens,
    been,
  }, { cityId: base.cityId })
  if (!next) return operationResult(base, 'invalid-import')
  const canonical = {
    type: 'import',
    incoming,
  }
  if (jsonBytes(canonical) > SAVED_BEEN_IMPORT_MAX_BYTES
      || jsonBytes(canonical) >= SAVED_BEEN_COMMAND_MAX_BYTES) {
    return operationResult(base, 'import-too-large')
  }
  return operationResult(next, 'imported', true, canonical)
}

export function reduceSavedBeenState(document, command = {}) {
  if (!isObject(command)) {
    const base = canonicalDocument(document)
    return base ? operationResult(base, 'invalid-command') : invalidDocumentResult()
  }
  switch (command.type) {
    case 'add':
    case 'add-record':
      return addSaved(document, command)
    case 'remove':
      return removeSaved(document, command)
    case 'toggle':
      return toggleSaved(document, command)
    case 'archive-saved':
      return archiveSaved(document, command)
    case 'mark-been':
      return markBeen(document, command)
    case 'unmark-been':
      return unmarkBeen(document, command)
    case 'import':
      return importSavedBeen(document, command)
    default: {
      const base = canonicalDocument(document)
      return base ? operationResult(base, 'invalid-command') : invalidDocumentResult()
    }
  }
}

export function canonicalizeSavedBeenCommand(_command, reducerResult) {
  if (!isObject(reducerResult) || reducerResult.changed !== true || !isObject(reducerResult.canonical)) {
    return null
  }
  try {
    return JSON.parse(JSON.stringify(reducerResult.canonical))
  } catch {
    return null
  }
}

function catalogRefs(values, forcedKind = null) {
  const out = []
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, SAVED_BEEN_CATALOG_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const item = source[index]
    if (!isObject(item)) continue
    const ref = boundedIdentityRefOf(item, forcedKind)
    if (!ref || ref.status !== 'attached') continue
    if (forcedKind === 'place' && ref.kind !== 'place') continue
    if (forcedKind === 'guide' && ref.kind !== 'guide') continue
    if (!forcedKind && !['event', 'custom'].includes(ref.kind)) continue
    out.push(ref)
  }
  return out
}

function seedRecords(values, domain) {
  const out = []
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, SAVED_BEEN_SEED_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const ref = boundedIdentityRefOf(source[index])
    if (!ref || ref.status !== 'attached') continue
    if (domain === 'place' && ref.kind !== 'place') continue
    if (domain === 'guide' && ref.kind !== 'guide') continue
    if (domain === 'event' && !['event', 'custom'].includes(ref.kind)) continue
    out.push({ aliases: ref.aliases })
  }
  return out
}

function createIndexes({ events, places, guides, seeds }) {
  return {
    event: createIdentityIndex({
      items: catalogRefs(events),
      records: seedRecords(seeds, 'event'),
    }),
    place: createIdentityIndex({
      items: catalogRefs(places, 'place'),
      records: seedRecords(seeds, 'place'),
    }),
    guide: createIdentityIndex({
      items: catalogRefs(guides, 'guide'),
      records: seedRecords(seeds, 'guide'),
    }),
  }
}

function snapshotKind(snapshot, legacyKey) {
  if (snapshot?.kind === 'guide' || legacyKey.startsWith('g|')) return 'guide'
  if (snapshot?.kind === 'place' || legacyKey.startsWith('p|')) return 'place'
  if (snapshot?.kind === 'custom' || isCustomEvent(snapshot) || legacyKey.startsWith('c|')) {
    return 'custom'
  }
  return 'event'
}

function migrateLegacyRef(legacyKey, kind, indexes, diagnostics) {
  if (!boundedString(legacyKey)) {
    diagnostics.invalid += 1
    return null
  }
  const domain = kind === 'place' ? 'place' : kind === 'guide' ? 'guide' : 'event'
  const resolution = resolveIdentity(legacyKey, indexes[domain])
  if (resolution.status === 'resolved') {
    const current = identityRefOf(resolution.item)
    const ref = attachedRef(
      current.kind === 'custom' ? 'custom' : kind,
      resolution.primary,
      [[legacyKey], current.aliases],
    )
    if (ref) diagnostics.attached += 1
    return ref
  }
  if (resolution.status === 'ambiguous') {
    diagnostics.ambiguous += 1
    return ambiguousRef(kind, legacyKey, resolution.candidates)
  }
  // A retained structured key is stable identity evidence even when its row
  // is no longer in the current catalog. Resolve catalogs and historical
  // seeds first because an old event primary can legitimately bridge to a
  // newer one; only a genuinely unresolved structured key attaches to itself.
  // This keeps lazy place loading from permanently downgrading p| saves while
  // preserving current availability as a separate runtime concern.
  if (SAVE_KINDS.has(kind) && validAttachedPrimary(kind, legacyKey)) {
    const ref = attachedRef(kind, legacyKey, [[legacyKey]])
    if (ref) diagnostics.attached += 1
    return ref
  }
  diagnostics.missing += 1
  return missingRef(kind, legacyKey)
}

function withoutToken(record) {
  const copy = { ...record }
  delete copy.token
  return copy
}

function mergedRef(left, right) {
  if (left.status !== 'attached'
      || right.status !== 'attached'
      || left.kind !== right.kind
      || left.primary !== right.primary) {
    return right
  }
  return attachedRef(left.kind, left.primary, [left.aliases, right.aliases]) || right
}

function nonEmptySnapshot(value) {
  return isObject(value) && Object.keys(value).length > 0
}

function mergeMigrationRecord(previous, current, collection) {
  const record = {
    ...previous,
    ...current,
    ref: mergedRef(previous.ref, current.ref),
    snapshot: nonEmptySnapshot(current.snapshot)
      ? current.snapshot
      : previous.snapshot,
  }
  if (collection === 'been' && previous.status && !current.status) {
    record.status = previous.status
    record.statusAt = previous.statusAt
  }
  return record
}

function dedupeMigrationRecords(records, diagnostics, collection) {
  const byFingerprint = new Map()
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const fingerprint = refFingerprint(record.ref)
    if (byFingerprint.has(fingerprint)) {
      diagnostics.duplicates += 1
      const previous = byFingerprint.get(fingerprint)
      byFingerprint.delete(fingerprint)
      byFingerprint.set(
        fingerprint,
        mergeMigrationRecord(previous, record, collection),
      )
      continue
    }
    byFingerprint.set(fingerprint, record)
  }
  return [...byFingerprint.values()]
}

function finalizedMigrationDocument(cityId, savedRows, beenRows, diagnostics) {
  const been = dedupeMigrationRecords(beenRows, diagnostics, 'been')
  if (been.length > SAVED_BEEN_BEEN_CAP) return null
  const went = new Set(
    been
      .filter((record) => record.status === 'went')
      .map((record) => refFingerprint(record.ref)),
  )
  const saved = dedupeMigrationRecords(savedRows, diagnostics, 'saved')
    .filter((record) => {
      const retained = !went.has(refFingerprint(record.ref))
      if (!retained) diagnostics.reconciledWent += 1
      return retained
    })
  if (saved.length > SAVED_BEEN_SAVE_CAP) return null
  let token = 0
  const withSavedTokens = saved.map((record) => ({ ...record, token: ++token }))
  const withBeenTokens = been.map((record) => ({ ...record, token: ++token }))
  return normalizeSavedBeenState({
    v: SAVED_BEEN_STATE_VERSION,
    cityId,
    rev: token,
    saved: withSavedTokens,
    been: withBeenTokens,
  }, { cityId })
}

function migrationCityId(options) {
  const explicit = options?.cityId
  const city = options?.city?.id
  if (explicit !== undefined && city !== undefined && explicit !== city) {
    throw new TypeError('cityId and city.id must match')
  }
  return requireCityId(explicit ?? city)
}

function jsonEqual(left, right) {
  const canonicalJson = (value) => {
    if (Array.isArray(value)) return value.map(canonicalJson)
    if (!isObject(value)) return value
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonicalJson(value[key])
    return out
  }
  try {
    return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
  } catch {
    return false
  }
}

function verifyEvidenceField(field, key, sourceValue, evidence) {
  const row = evidence[field]
  if (!isObject(row)
      || row.key !== key
      || !['ok', 'missing'].includes(row.status)
      || !hasOwn(row, 'value')
      || !hasOwn(row, 'source')) {
    return null
  }
  const empty = field === 'savedEvents'
    ? Object.keys(sourceValue).length === 0
    : sourceValue.length === 0
  if (row.status === 'missing') {
    return row.value === null && row.source === null && empty
      ? { status: 'missing', source: null, bytes: 0, tombstone: false }
      : null
  }
  if (!['destination', 'legacy'].includes(row.source)) return null
  if (row.value === null) {
    return empty
      ? { status: 'ok', source: row.source ?? null, bytes: 0, tombstone: true }
      : null
  }
  if (typeof row.value !== 'string') return null
  const rawBytes = ENCODER.encode(row.value).byteLength
  if (rawBytes > SAVED_BEEN_MIGRATION_SOURCE_MAX_BYTES) return null
  let parsed
  try {
    parsed = JSON.parse(row.value)
  } catch {
    return null
  }
  if (!jsonEqual(parsed, sourceValue)) return null
  return {
    status: 'ok',
    source: typeof row.source === 'string' && jsonBytes(row.source) <= 256
      ? row.source
      : null,
    bytes: rawBytes,
    tombstone: false,
  }
}

function verifiedEvidence(source, evidence) {
  if (!isObject(evidence)) return null
  const savedEvents = verifyEvidenceField(
    'savedEvents',
    V1_SAVED_KEY,
    source.savedEvents,
    evidence,
  )
  const beenThere = verifyEvidenceField(
    'beenThere',
    V1_BEEN_KEY,
    source.beenThere,
    evidence,
  )
  return savedEvents && beenThere
    ? { status: 'verified', savedEvents, beenThere }
    : null
}

export function migrateV1SavedBeenState(source, options = {}) {
  const cityId = migrationCityId(options)
  if (!isObject(source) || jsonBytes(source) > SAVED_BEEN_MIGRATION_SOURCE_MAX_BYTES) {
    return null
  }
  if (source.v === SAVED_BEEN_STATE_VERSION) {
    const document = normalizeSavedBeenState(source, { cityId })
    return document
      ? deepFreeze({
          document,
          status: 'existing-v2',
          diagnostics: {},
          sourceSummary: { status: 'v2', count: document.saved.length + document.been.length },
        })
      : null
  }
  if (!isObject(source.savedEvents) || !Array.isArray(source.beenThere)) return null
  const evidence = verifiedEvidence(source, options.evidence)
  if (!evidence) return null

  const indexes = createIndexes(options)
  const diagnostics = {
    savedRows: 0,
    beenRows: 0,
    attached: 0,
    missing: 0,
    ambiguous: 0,
    invalid: 0,
    duplicates: 0,
    capped: 0,
    reconciledWent: 0,
  }
  const savedRows = []
  const savedEntries = Object.entries(source.savedEvents)
  if (savedEntries.length > SAVED_BEEN_SAVE_CAP
      || savedEntries.length > SAVED_BEEN_COLLECTION_SCAN_MAX) {
    return null
  }
  for (let index = 0; index < savedEntries.length; index += 1) {
    const [legacyKey, rawValue] = savedEntries[index]
    if (!isObject(rawValue)
        || hasOwn(rawValue, 'savedAt') && !validTime(rawValue.savedAt)
        || hasOwn(rawValue, 'snapshot')
          && rawValue.snapshot !== null
          && !isObject(rawValue.snapshot)) {
      return null
    }
    const payload = rawValue
    const rawSnapshot = isObject(payload.snapshot) ? payload.snapshot : {}
    const kind = snapshotKind(rawSnapshot, legacyKey)
    const ref = migrateLegacyRef(legacyKey, kind, indexes, diagnostics)
    if (!ref) return null
    diagnostics.savedRows += 1
    const record = {
      ref,
      snapshot: snapshotOf(rawSnapshot, ref.kind),
    }
    if (hasOwn(payload, 'savedAt')) record.savedAt = payload.savedAt
    savedRows.push(record)
  }

  const sourceBeen = source.beenThere
  if (sourceBeen.length > SAVED_BEEN_BEEN_CAP
      || sourceBeen.length > SAVED_BEEN_COLLECTION_SCAN_MAX) {
    return null
  }
  const beenRows = []
  for (let index = 0; index < sourceBeen.length; index += 1) {
    const row = sourceBeen[index]
    if (!isObject(row)
        || !boundedString(row.key)
        || hasOwn(row, 'savedAt') && !validTime(row.savedAt)
        || hasOwn(row, 'archivedAt') && !validTime(row.archivedAt)
        || hasOwn(row, 'snapshot')
          && row.snapshot !== null
          && !isObject(row.snapshot)
        || hasOwn(row, 'status') && (
          !STATUSES.has(row.status)
          || !validTime(row.statusAt)
        )
        || !hasOwn(row, 'status') && hasOwn(row, 'statusAt')) {
      return null
    }
    const rawSnapshot = isObject(row.snapshot) ? row.snapshot : {}
    const kind = snapshotKind(rawSnapshot, row.key)
    if (kind === 'guide') return null
    const ref = migrateLegacyRef(row.key, kind, indexes, diagnostics)
    if (!ref) return null
    const record = {
      ref,
      snapshot: snapshotOf(rawSnapshot, ref.kind),
    }
    if (hasOwn(row, 'savedAt')) record.savedAt = row.savedAt
    if (hasOwn(row, 'archivedAt')) record.archivedAt = row.archivedAt
    if (hasOwn(row, 'status')) {
      record.status = row.status
      record.statusAt = row.statusAt
    }
    diagnostics.beenRows += 1
    beenRows.push(record)
  }

  const document = finalizedMigrationDocument(cityId, savedRows, beenRows, diagnostics)
  if (!document) return null
  return deepFreeze({
    document,
    status: 'migrated-v1',
    diagnostics,
    sourceSummary: {
      ...evidence,
      savedInputCount: savedEntries.length,
      beenInputCount: sourceBeen.length,
    },
  })
}

export function savedBeenRecordsWithoutTokens(document) {
  const base = canonicalDocument(document)
  if (!base) return null
  return deepFreeze({
    saved: base.saved.map(withoutToken),
    been: base.been.map(withoutToken),
  })
}
