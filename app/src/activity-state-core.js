// activity-state-core.js — pure V2 retained activity memory.
//
// Recents and the two calibration-deck FIFOs used to persist bare V1 keys in
// three independent localStorage values. This module gives those values one
// city-bound, versioned destination document without reading or writing
// storage. Stable and legacy evidence travel together; unresolved evidence is
// explicit; event and place catalogs never share a first-wins index.

import {
  createIdentityIndex,
  identityRefOf,
  resolveIdentity,
} from './identity.js'

export const ACTIVITY_STATE_VERSION = 2
export const ACTIVITY_RECENTS_CAP = 12
export const ACTIVITY_EVENT_DECK_CAP = 30
export const ACTIVITY_PLACE_DECK_CAP = 30
export const ACTIVITY_COLLECTION_SCAN_MAX = 512
export const ACTIVITY_ALIAS_SCAN_MAX = 64
export const ACTIVITY_ALIAS_MAX_COUNT = 8
export const ACTIVITY_CANDIDATE_MAX_COUNT = 8
export const ACTIVITY_STRING_MAX_BYTES = 2048
export const ACTIVITY_REF_MAX_BYTES = 20 * 1024
export const ACTIVITY_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
export const ACTIVITY_DOCUMENT_MAX_DEPTH = 4

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CUSTOM_BRIDGE_RE = /^wuzup:custom-bridge:v1:[0-9]+:[0-9a-f]{16}$/
const ENCODER = new TextEncoder()
const KINDS = new Set(['event', 'custom', 'place', 'unknown'])
const EVENT_KINDS = new Set(['event', 'custom'])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function jsonBytes(value) {
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function activityStateBytes(value) {
  return jsonBytes(value)
}

function boundedString(value) {
  return typeof value === 'string'
    && value.length <= ACTIVITY_STRING_MAX_BYTES
    && jsonBytes(value) <= ACTIVITY_STRING_MAX_BYTES
}

function validCityId(value) {
  return boundedString(value) && CITY_ID_RE.test(value)
}

function requireCityId(value) {
  if (!validCityId(value)) throw new TypeError('cityId must be a valid non-empty city id')
  return value
}

function usableString(value) {
  return boundedString(value)
    && value.length > 0
    && value !== '|'
}

function kindOf(value, fallback = 'event') {
  return KINDS.has(value) ? value : fallback
}

function inferKind(key, fallback = 'unknown') {
  if (typeof key !== 'string') return fallback
  if (key.startsWith('p|')) return 'place'
  if (key.startsWith('c|')) return 'custom'
  if (key.startsWith('e|')) return 'event'
  return fallback
}

function orderedStrings(groups, maxCount = ACTIVITY_ALIAS_MAX_COUNT) {
  const out = []
  const seen = new Set()
  let scanned = 0
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    const limit = Math.min(group.length, ACTIVITY_ALIAS_SCAN_MAX - scanned)
    for (let index = 0; index < limit; index += 1) {
      scanned += 1
      const value = group[index]
      if (!usableString(value) || seen.has(value)) continue
      seen.add(value)
      out.push(value)
      if (out.length >= maxCount) return out
    }
    if (scanned >= ACTIVITY_ALIAS_SCAN_MAX) break
  }
  return out
}

function sortedCandidates(values) {
  const source = Array.isArray(values) ? values : []
  const out = []
  const seen = new Set()
  const limit = Math.min(source.length, ACTIVITY_ALIAS_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const value = source[index]
    if (!usableString(value) || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out.sort().slice(0, ACTIVITY_CANDIDATE_MAX_COUNT)
}

function boundedRef(value) {
  return jsonBytes(value) <= ACTIVITY_REF_MAX_BYTES ? value : null
}

function attachedRef(kind, primary, groups) {
  if (!usableString(primary)) return null
  const aliases = orderedStrings([[primary], ...groups])
  if (aliases[0] !== primary) return null
  return boundedRef({
    status: 'attached',
    kind: kindOf(kind, inferKind(primary, 'event')),
    primary,
    aliases,
  })
}

function missingRef(kind, legacyKey) {
  if (!usableString(legacyKey)) return null
  return boundedRef({
    status: 'missing',
    kind: kindOf(kind, inferKind(legacyKey)),
    legacyKey,
  })
}

function ambiguousRef(kind, legacyKey, candidates) {
  if (!usableString(legacyKey)) return null
  const bounded = sortedCandidates(candidates)
  if (bounded.length === 0) return null
  return boundedRef({
    status: 'ambiguous',
    kind: kindOf(kind, inferKind(legacyKey)),
    legacyKey,
    candidates: bounded,
  })
}

function normalizeRef(value, fallbackKind) {
  if (!isObject(value) || !KINDS.has(value.kind)) return null
  if (fallbackKind === 'place' && value.kind !== 'place') return null
  if (fallbackKind === 'event' && !['event', 'custom'].includes(value.kind)) return null

  if (value.status === 'attached') {
    if (!usableString(value.primary) || !Array.isArray(value.aliases)) return null
    return attachedRef(value.kind, value.primary, [value.aliases])
  }
  if (value.status === 'missing') return missingRef(value.kind, value.legacyKey)
  if (value.status === 'ambiguous') {
    return ambiguousRef(value.kind, value.legacyKey, value.candidates)
  }
  return null
}

function refFingerprint(ref) {
  if (ref.status === 'attached') return `attached\u0000${ref.kind}\u0000${ref.primary}`
  if (ref.status === 'missing') return `missing\u0000${ref.kind}\u0000${ref.legacyKey}`
  return `ambiguous\u0000${ref.kind}\u0000${ref.legacyKey}\u0000${ref.candidates.join('\u0000')}`
}

function mergeAttached(left, right) {
  return attachedRef(left.kind, left.primary, [left.aliases, right.aliases]) || left
}

function collectionIndexes(source, retention) {
  const count = Math.min(source.length, ACTIVITY_COLLECTION_SCAN_MAX)
  const indexes = []
  if (retention === 'tail') {
    const floor = Math.max(0, source.length - count)
    for (let index = source.length - 1; index >= floor; index -= 1) indexes.push(index)
  } else {
    for (let index = 0; index < count; index += 1) indexes.push(index)
  }
  return indexes
}

function collectionResult(out, retention) {
  return retention === 'tail' ? out.reverse() : out
}

function normalizeCollection(value, {
  cap,
  fallbackKind = null,
  retention = 'head',
} = {}) {
  if (!Array.isArray(value)) return null
  const out = []
  const byFingerprint = new Map()

  for (const index of collectionIndexes(value, retention)) {
    const ref = normalizeRef(value[index], fallbackKind)
    if (!ref) continue
    const fingerprint = refFingerprint(ref)
    if (byFingerprint.has(fingerprint)) {
      const previous = byFingerprint.get(fingerprint)
      if (ref.status === 'attached') {
        const merged = mergeAttached(out[previous], ref)
        out[previous] = merged
      }
      continue
    }
    if (out.length >= cap) continue
    byFingerprint.set(fingerprint, out.length)
    out.push(ref)
  }
  return collectionResult(out, retention)
}

export function emptyActivityState(cityId) {
  return {
    v: ACTIVITY_STATE_VERSION,
    cityId: requireCityId(cityId),
    recents: [],
    eventDeck: [],
    placeDeck: [],
  }
}

export function normalizeActivityState(value, { cityId } = {}) {
  const selectedCityId = requireCityId(cityId)
  if (!isObject(value)
      || value.v !== ACTIVITY_STATE_VERSION
      || value.cityId !== selectedCityId
      || jsonBytes(value) > ACTIVITY_DOCUMENT_MAX_BYTES) {
    return null
  }

  const recents = normalizeCollection(value.recents, { cap: ACTIVITY_RECENTS_CAP })
  const eventDeck = normalizeCollection(value.eventDeck, {
    cap: ACTIVITY_EVENT_DECK_CAP,
    fallbackKind: 'event',
    retention: 'tail',
  })
  const placeDeck = normalizeCollection(value.placeDeck, {
    cap: ACTIVITY_PLACE_DECK_CAP,
    fallbackKind: 'place',
    retention: 'tail',
  })
  if (!recents || !eventDeck || !placeDeck) return null

  const document = {
    v: ACTIVITY_STATE_VERSION,
    cityId: selectedCityId,
    recents,
    eventDeck,
    placeDeck,
  }
  return jsonBytes(document) <= ACTIVITY_DOCUMENT_MAX_BYTES ? document : null
}

function boundedIdentityRefOf(item, forcedKind = null) {
  try {
    const rawPrimary = item.primary
    if (
      typeof rawPrimary === 'string'
      && rawPrimary.length > 0
      && rawPrimary !== '|'
      && Array.isArray(item.aliases)
    ) {
      if (!usableString(rawPrimary)) return null
      const kind = forcedKind || kindOf(item.kind, inferKind(rawPrimary, 'event'))
      const aliases = orderedStrings([[rawPrimary], item.aliases])
      return { kind, primary: rawPrimary, aliases }
    }

    const rawKind = typeof item.kind === 'string' ? item.kind : null
    const projected = {}
    const placeKind = forcedKind === 'place' || rawKind === 'place'
    let customKind = rawKind === 'custom' || item.source === 'Added by you' || item.localId != null

    if (!customKind && Array.isArray(item.tags)) {
      const tagLimit = Math.min(item.tags.length, ACTIVITY_ALIAS_SCAN_MAX)
      for (let index = 0; index < tagLimit; index += 1) {
        if (item.tags[index] === 'added-by-you') {
          customKind = true
          break
        }
      }
      if (!customKind && item.tags.length > ACTIVITY_ALIAS_SCAN_MAX) return null
    }

    projected.kind = placeKind ? 'place' : customKind ? 'custom' : 'event'

    if (placeKind && item.key != null) {
      if (!boundedString(item.key)) return null
      projected.key = item.key
    }

    if (boundedString(item.id)) {
      projected.id = item.id
    }
    if (boundedString(item.localId)) {
      projected.localId = item.localId
    }

    if (!(placeKind && usableString(projected.key))) {
      const legacyField = item.url
        ? 'url'
        : item._keyTitle
          ? '_keyTitle'
          : item.title
            ? 'title'
          : null
      if (legacyField) {
        const value = item[legacyField]
        if (!boundedString(value)) return null
        projected[legacyField] = value
      }
      if (item.start != null) {
        if (!boundedString(item.start)) return null
        projected.start = item.start
      }
    }

    if (Array.isArray(item.identityAliases)) {
      projected.identityAliases = orderedStrings([item.identityAliases])
    }
    if (customKind && Array.isArray(item._sessionIdentityAliases)) {
      projected._sessionIdentityAliases = orderedStrings([item._sessionIdentityAliases])
        .filter((alias) => CUSTOM_BRIDGE_RE.test(alias))
    }

    const ref = identityRefOf(projected)
    if (!usableString(ref.primary)) return null
    return {
      kind: forcedKind || ref.kind,
      primary: ref.primary,
      aliases: orderedStrings([[ref.primary], ref.aliases]),
    }
  } catch {
    return null
  }
}

export function activityRefOf(item, { kind = null } = {}) {
  if (!isObject(item) || ![null, 'event', 'place'].includes(kind)) return null
  const explicitKind = KINDS.has(item.kind) ? item.kind : inferKind(item.key, null)
  if (kind === 'place' && explicitKind !== 'place') return null
  if (kind === 'event' && explicitKind === 'place') return null
  const ref = boundedIdentityRefOf(item, kind === 'place' ? 'place' : null)
  if (!ref) return null
  if (kind === 'event' && !EVENT_KINDS.has(ref.kind)) return null
  if (kind === 'place' && ref.kind !== 'place') return null
  return attachedRef(ref.kind, ref.primary, [ref.aliases])
}

const ACTIVITY_COLLECTIONS = Object.freeze({
  recents: Object.freeze({
    cap: ACTIVITY_RECENTS_CAP,
    position: 'head',
    fallbackKind: null,
  }),
  eventDeck: Object.freeze({
    cap: ACTIVITY_EVENT_DECK_CAP,
    position: 'tail',
    fallbackKind: 'event',
  }),
  placeDeck: Object.freeze({
    cap: ACTIVITY_PLACE_DECK_CAP,
    position: 'tail',
    fallbackKind: 'place',
  }),
})

function sameDocument(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function compatibleKinds(left, right) {
  return left === right
    || left === 'unknown'
    || right === 'unknown'
    || EVENT_KINDS.has(left) && EVENT_KINDS.has(right)
}

function runtimeRefMatch(current, next) {
  if (current.status === 'attached') {
    return current.kind === next.kind
      && (
        current.primary === next.primary
        || current.aliases.includes(next.primary)
        || next.aliases.includes(current.primary)
      )
  }
  if (!compatibleKinds(current.kind, next.kind)) return false
  if (next.aliases.includes(current.legacyKey)) return true
  return current.status === 'ambiguous' && current.candidates.includes(next.primary)
}

export function recordActivityRef(
  value,
  {
    cityId,
    collection,
    ref,
  } = {},
) {
  const document = normalizeActivityState(value, { cityId })
  if (!document) return { document: value, changed: false, code: 'invalid-document' }
  const contract = ACTIVITY_COLLECTIONS[collection]
  if (!contract) return { document, changed: false, code: 'invalid-collection' }
  const normalizedRef = normalizeRef(ref, contract.fallbackKind)
  if (!normalizedRef || normalizedRef.status !== 'attached') {
    return { document, changed: false, code: 'invalid-ref' }
  }

  const fingerprint = refFingerprint(normalizedRef)
  let nextRef = normalizedRef
  const kept = []
  const matchingRows = document[collection].filter((current) => (
    refFingerprint(current) === fingerprint || runtimeRefMatch(current, normalizedRef)
  ))
  const canConsolidate = matchingRows.length === 1
  for (const current of document[collection]) {
    const matches = refFingerprint(current) === fingerprint || runtimeRefMatch(current, normalizedRef)
    if (!matches || !canConsolidate) {
      kept.push(current)
      continue
    }
    nextRef = current.status === 'attached'
      ? current.primary === nextRef.primary
        ? mergeAttached(current, nextRef)
        : attachedRef(nextRef.kind, nextRef.primary, [
            nextRef.aliases,
            current.aliases,
          ]) || nextRef
      : attachedRef(nextRef.kind, nextRef.primary, [
          nextRef.aliases,
          [current.legacyKey],
        ]) || nextRef
  }
  const rows = contract.position === 'head'
    ? [nextRef, ...kept].slice(0, contract.cap)
    : [...kept, nextRef].slice(-contract.cap)
  const next = normalizeActivityState({
    ...document,
    [collection]: rows,
  }, { cityId })
  if (!next) return { document, changed: false, code: 'invalid-document' }
  return {
    document: next,
    changed: !sameDocument(document, next),
    code: sameDocument(document, next) ? 'already-current' : 'recorded',
  }
}

export function clearActivityCollection(
  value,
  {
    cityId,
    collection,
  } = {},
) {
  const document = normalizeActivityState(value, { cityId })
  if (!document) return { document: value, changed: false, code: 'invalid-document' }
  if (!ACTIVITY_COLLECTIONS[collection]) {
    return { document, changed: false, code: 'invalid-collection' }
  }
  if (document[collection].length === 0) {
    return { document, changed: false, code: 'already-empty' }
  }
  const next = normalizeActivityState({
    ...document,
    [collection]: [],
  }, { cityId })
  return next
    ? { document: next, changed: true, code: 'cleared' }
    : { document, changed: false, code: 'invalid-document' }
}

export function clearActivityDecks(value, { cityId } = {}) {
  const document = normalizeActivityState(value, { cityId })
  if (!document) return { document: value, changed: false, code: 'invalid-document' }
  if (document.eventDeck.length === 0 && document.placeDeck.length === 0) {
    return { document, changed: false, code: 'already-empty' }
  }
  const next = normalizeActivityState({
    ...document,
    eventDeck: [],
    placeDeck: [],
  }, { cityId })
  return next
    ? { document: next, changed: true, code: 'cleared-decks' }
    : { document, changed: false, code: 'invalid-document' }
}

export function activityExclusionKeys(
  value,
  {
    cityId,
    collection,
    includeCandidates = true,
  } = {},
) {
  const document = normalizeActivityState(value, { cityId })
  if (!document || !['eventDeck', 'placeDeck'].includes(collection)) return []
  const keys = []
  const seen = new Set()
  const add = (key) => {
    if (!usableString(key) || seen.has(key)) return
    seen.add(key)
    keys.push(key)
  }
  for (const ref of document[collection]) {
    if (ref.status === 'attached') {
      add(ref.primary)
      for (const alias of ref.aliases) add(alias)
      continue
    }
    add(ref.legacyKey)
    if (includeCandidates && ref.status === 'ambiguous') {
      for (const candidate of ref.candidates) add(candidate)
    }
  }
  return keys
}

function catalogRefs(values, forcedKind = null) {
  const out = []
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, ACTIVITY_COLLECTION_SCAN_MAX * 32)
  for (let index = 0; index < limit; index += 1) {
    const item = source[index]
    if (!isObject(item)) continue
    const ref = boundedIdentityRefOf(item, forcedKind)
    if (!ref || (!forcedKind && !EVENT_KINDS.has(ref.kind))) continue
    out.push(ref)
  }
  return out
}

function catalogEntries(values, forcedKind = null) {
  const out = []
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, ACTIVITY_COLLECTION_SCAN_MAX * 32)
  for (let index = 0; index < limit; index += 1) {
    const item = source[index]
    if (!isObject(item)) continue
    const ref = boundedIdentityRefOf(item, forcedKind)
    if (!ref || (!forcedKind && !EVENT_KINDS.has(ref.kind))) continue
    out.push({
      kind: ref.kind,
      primary: ref.primary,
      aliases: ref.aliases,
      catalogItem: item,
    })
  }
  return out
}

function seedRecords(values, domain) {
  const out = []
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, ACTIVITY_COLLECTION_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const seed = source[index]
    if (!isObject(seed)) continue
    const ref = boundedIdentityRefOf(seed)
    if (!ref) continue
    if (domain === 'place' ? ref.kind !== 'place' : !EVENT_KINDS.has(ref.kind)) continue
    out.push({ aliases: ref.aliases })
  }
  return out
}

function resolutionProbe(ref) {
  if (ref.status === 'attached') return ref
  if (ref.status === 'ambiguous') {
    return {
      kind: ref.kind,
      primary: ref.legacyKey,
      aliases: [ref.legacyKey, ...ref.candidates],
    }
  }
  return ref.legacyKey
}

export function resolveActivityRefs(
  refs,
  items,
  {
    kind = 'event',
    seeds = [],
  } = {},
) {
  if (!['event', 'place'].includes(kind)) return []
  const entries = catalogEntries(items, kind === 'place' ? 'place' : null)
  const index = createIdentityIndex({
    items: entries,
    records: seedRecords(seeds, kind),
  })
  const source = Array.isArray(refs) ? refs : []
  const out = []
  const seen = new Set()
  const limit = Math.min(source.length, ACTIVITY_COLLECTION_SCAN_MAX)
  for (let row = 0; row < limit; row += 1) {
    const ref = normalizeRef(source[row], null)
    if (!ref) continue
    if (kind === 'place' && !['place', 'unknown'].includes(ref.kind)) continue
    if (kind === 'event' && ref.kind === 'place') continue
    let resolution
    try {
      const exact = ref.status === 'attached'
        ? index.byPrimary.get(ref.primary) || []
        : []
      if (exact.length > 1) continue
      resolution = exact.length === 1
        ? {
            status: 'resolved',
            primary: exact[0].primary,
            item: exact[0].item,
            matchedBy: 'primary',
          }
        : resolveIdentity(resolutionProbe(ref), index)
    } catch {
      continue
    }
    if (resolution.status !== 'resolved' || seen.has(resolution.primary)) continue
    const item = resolution.item?.catalogItem
    if (!isObject(item)) continue
    seen.add(resolution.primary)
    out.push(item)
  }
  return out
}

function createIndexes({ events, places, seeds }) {
  return {
    event: createIdentityIndex({
      items: catalogRefs(events),
      records: seedRecords(seeds, 'event'),
    }),
    place: createIdentityIndex({
      items: catalogRefs(places, 'place'),
      records: seedRecords(seeds, 'place'),
    }),
  }
}

function scopedResolution(legacyKey, index, fallbackKind) {
  const resolution = resolveIdentity(legacyKey, index)
  if (resolution.status === 'resolved') {
    const current = identityRefOf(resolution.item)
    return {
      status: 'resolved',
      ref: attachedRef(current.kind, resolution.primary, [
        [legacyKey],
        current.aliases,
      ]),
    }
  }
  if (resolution.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      kind: fallbackKind,
      candidates: resolution.candidates,
    }
  }
  return { status: 'missing', kind: fallbackKind }
}

function migrateScopedKey(legacyKey, index, fallbackKind) {
  if (!usableString(legacyKey)) return null
  const resolution = scopedResolution(legacyKey, index, fallbackKind)
  if (resolution.status === 'resolved') return resolution.ref
  if (resolution.status === 'ambiguous') {
    return ambiguousRef(resolution.kind, legacyKey, resolution.candidates)
  }
  return missingRef(fallbackKind, legacyKey)
}

function combinedCandidates(resolutions) {
  const candidates = []
  for (const resolution of resolutions) {
    if (resolution.status === 'resolved') candidates.push(resolution.ref.primary)
    else if (resolution.status === 'ambiguous') candidates.push(...resolution.candidates)
  }
  return sortedCandidates(candidates)
}

function migrateRecentKey(legacyKey, indexes) {
  if (!usableString(legacyKey)) return null
  const inferred = inferKind(legacyKey)
  const event = scopedResolution(legacyKey, indexes.event, 'event')
  const place = scopedResolution(legacyKey, indexes.place, 'place')
  const resolved = [event, place].filter((row) => row.status === 'resolved')
  const ambiguous = [event, place].filter((row) => row.status === 'ambiguous')

  if (resolved.length === 1 && ambiguous.length === 0) return resolved[0].ref
  if (resolved.length === 0 && ambiguous.length === 0) return missingRef(inferred, legacyKey)

  const candidates = combinedCandidates([event, place])
  const candidateKinds = new Set([
    ...resolved.map((row) => row.ref.kind),
    ...(event.status === 'ambiguous' ? ['event'] : []),
    ...(place.status === 'ambiguous' ? ['place'] : []),
  ])
  const kind = candidateKinds.size === 1 ? [...candidateKinds][0] : 'unknown'
  return ambiguousRef(kind, legacyKey, candidates)
}

function migrateCollection(value, { cap, migrate, retention = 'head' }) {
  const source = Array.isArray(value) ? value : []
  const out = []
  const byFingerprint = new Map()

  for (const index of collectionIndexes(source, retention)) {
    const legacyKey = source[index]
    if (!usableString(legacyKey)) continue
    const ref = migrate(legacyKey)
    if (!ref) continue
    const fingerprint = refFingerprint(ref)
    if (byFingerprint.has(fingerprint)) {
      const previous = byFingerprint.get(fingerprint)
      if (ref.status === 'attached') out[previous] = mergeAttached(out[previous], ref)
      continue
    }
    if (out.length >= cap) continue
    byFingerprint.set(fingerprint, out.length)
    out.push(ref)
  }
  return collectionResult(out, retention)
}

export function migrateV1ActivityState(
  source,
  {
    cityId,
    events = [],
    places = [],
    seeds = [],
  } = {},
) {
  const selectedCityId = requireCityId(cityId)
  const v1 = isObject(source) ? source : {}
  const indexes = createIndexes({ events, places, seeds })
  const document = {
    v: ACTIVITY_STATE_VERSION,
    cityId: selectedCityId,
    recents: migrateCollection(v1.recents, {
      cap: ACTIVITY_RECENTS_CAP,
      migrate: (key) => migrateRecentKey(key, indexes),
    }),
    eventDeck: migrateCollection(v1.eventDeck, {
      cap: ACTIVITY_EVENT_DECK_CAP,
      migrate: (key) => migrateScopedKey(key, indexes.event, 'event'),
      retention: 'tail',
    }),
    placeDeck: migrateCollection(v1.placeDeck, {
      cap: ACTIVITY_PLACE_DECK_CAP,
      migrate: (key) => migrateScopedKey(key, indexes.place, 'place'),
      retention: 'tail',
    }),
  }

  return normalizeActivityState(document, { cityId: selectedCityId })
}
