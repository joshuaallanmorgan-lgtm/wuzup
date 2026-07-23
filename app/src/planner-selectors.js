// planner-selectors.js — pure read models for the V2 atomic planner.
import {
  createIdentityIndex,
  resolveIdentity,
} from './identity.js'
import {
  normalizePlannerDocument,
  PLANNER_ALIAS_MAX_BYTES,
  PLANNER_ALIAS_MAX_COUNT,
  PLANNER_ALIASES_MAX_BYTES,
  PLANNER_ALIAS_SCAN_MAX,
  PLANNER_PARTS,
  slotRefOf,
} from './planner-core.js'

const KINDS = ['event', 'place', 'custom']
const CLONE_MAX_BYTES = 65_536
const CLONE_MAX_DEPTH = 6
const CLONE_MAX_NODES = 512
const CLONE_MAX_ARRAY_ITEMS = 64
const CLONE_MAX_OBJECT_KEYS = 96
const CLONE_MAX_STRING_BYTES = 16_384
const CLONE_MAX_KEY_BYTES = 256
const CLONE_SCAN_MAX = 128
const ENCODER = new TextEncoder()
const CLONE_PRIORITY_FIELDS = [
  'id', 'localId', 'kind', 'key', 'title', 'name', 'start', 'end', 'allDay', 'timeZone',
  'venue', 'address', 'neighborhood', 'city', 'lat', 'lng', 'image', 'imageAlt', 'url',
  'category', 'tags', 'description', 'isFree', 'price', 'priceMin', 'priceMax', 'currency',
  'sponsored', 'status', 'source', 'sourceUrl', 'organizer', 'placeType', 'classes',
  'amenities', 'hours', 'fee', 'sources', 'srcCount', 'hidden', '_day', '_endDay',
  '_time', '_actionable', '_availability', '_lifecycle', '_startMin', '_cityDay',
]

function kindOf(value) {
  if (value?.kind === 'place' || value?.kind === 'custom') return value.kind
  return 'event'
}

function jsonBytes(value) {
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function cloneBoundedValue(value, state, depth = 0) {
  if (depth > CLONE_MAX_DEPTH || state.nodes >= CLONE_MAX_NODES) return undefined
  state.nodes += 1
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return jsonBytes(value) <= CLONE_MAX_STRING_BYTES ? value : undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if ((!Array.isArray(value) && (!value || typeof value !== 'object')) || state.seen.has(value)) {
    return undefined
  }

  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      const copy = []
      const limit = Math.min(value.length, CLONE_MAX_ARRAY_ITEMS)
      for (let index = 0; index < limit; index += 1) {
        const cloned = cloneBoundedValue(value[index], state, depth + 1)
        if (cloned !== undefined) copy.push(cloned)
      }
      return copy
    }

    const copy = {}
    let scanned = 0
    let kept = 0
    for (const key in value) {
      if (scanned >= CLONE_SCAN_MAX || kept >= CLONE_MAX_OBJECT_KEYS) break
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      scanned += 1
      if (jsonBytes(key) > CLONE_MAX_KEY_BYTES) continue
      const cloned = cloneBoundedValue(value[key], state, depth + 1)
      if (cloned === undefined) continue
      copy[key] = cloned
      kept += 1
    }
    return copy
  } finally {
    state.seen.delete(value)
  }
}

function cloneItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const copy = {}
  const state = { nodes: 0, seen: new WeakSet() }
  const seenKeys = new Set()
  const keys = []
  for (const key of CLONE_PRIORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      keys.push(key)
      seenKeys.add(key)
    }
  }
  let scanned = 0
  for (const key in value) {
    if (scanned >= CLONE_SCAN_MAX || keys.length >= CLONE_MAX_OBJECT_KEYS) break
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    scanned += 1
    if (seenKeys.has(key) || jsonBytes(key) > CLONE_MAX_KEY_BYTES) continue
    keys.push(key)
    seenKeys.add(key)
  }
  for (const key of keys) {
    const cloned = cloneBoundedValue(value[key], state)
    if (cloned === undefined) continue
    copy[key] = cloned
    if (jsonBytes(copy) > CLONE_MAX_BYTES) delete copy[key]
  }
  return copy
}

function usableIdentity(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '|'
    && value.length <= PLANNER_ALIAS_MAX_BYTES
    && jsonBytes(value) <= PLANNER_ALIAS_MAX_BYTES
}

function cappedAliases(values, primary = null) {
  const aliases = []
  const seen = new Set()
  if (usableIdentity(primary)) {
    aliases.push(primary)
    seen.add(primary)
  }
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, PLANNER_ALIAS_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const alias = source[index]
    if (!usableIdentity(alias) || seen.has(alias)) continue
    const next = [...aliases, alias]
    if (jsonBytes(next) > PLANNER_ALIASES_MAX_BYTES) continue
    aliases.push(alias)
    seen.add(alias)
    if (aliases.length >= PLANNER_ALIAS_MAX_COUNT) break
  }
  return aliases
}

function boundedIdentityRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref) || !usableIdentity(ref.primary)) return null
  return {
    kind: kindOf(ref),
    primary: ref.primary,
    aliases: cappedAliases(ref.aliases, ref.primary),
  }
}

function catalogItem(item, kind) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const normalized = item.kind === kind ? { ...item } : { ...item, kind }
  if (Array.isArray(normalized.identityAliases)) {
    normalized.identityAliases = cappedAliases(normalized.identityAliases)
  }
  return normalized
}

function seedRecord(seed, kind) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return null
  if (kindOf(seed) !== kind) return null
  const aliases = cappedAliases(seed.aliases, seed.primary)
  return { aliases }
}

export function createPlannerCatalog({
  events = [],
  places = [],
  customEvents = [],
  seeds = [],
} = {}) {
  const items = {
    event: (Array.isArray(events) ? events : []).map((item) => catalogItem(item, 'event')).filter(Boolean),
    place: (Array.isArray(places) ? places : []).map((item) => catalogItem(item, 'place')).filter(Boolean),
    custom: (Array.isArray(customEvents) ? customEvents : []).map((item) => catalogItem(item, 'custom')).filter(Boolean),
  }
  const indexes = {}
  for (const kind of KINDS) {
    indexes[kind] = createIdentityIndex({
      items: items[kind],
      records: (Array.isArray(seeds) ? seeds : [])
        .map((seed) => seedRecord(seed, kind))
        .filter(Boolean),
    })
  }
  return { indexes }
}

function indexFor(catalog, kind) {
  const index = catalog?.indexes?.[kind]
  return index?.graph instanceof Map && index?.byPrimary instanceof Map ? index : null
}

function retainedItem(ref) {
  const snapshot = ref?.snapshot && typeof ref.snapshot === 'object' && !Array.isArray(ref.snapshot)
    ? cloneItem(ref.snapshot)
    : {}
  return { ...snapshot, kind: kindOf(ref) }
}

function mergedLiveItem(ref, live) {
  const retained = retainedItem(ref)
  const current = cloneItem(live)
  return { ...retained, ...current, kind: kindOf(ref) }
}

function retainedAmbiguity(ref) {
  if (ref?.identity?.status !== 'ambiguous' || !Array.isArray(ref.identity.candidates)) return null
  const candidates = cappedAliases(ref.identity.candidates)
  return candidates.length > 0 ? candidates : null
}

export function resolvePlannerSlot(ref, catalog) {
  const retained = retainedItem(ref)
  const index = indexFor(catalog, kindOf(ref))
  const identityRef = boundedIdentityRef(ref)
  if (!index || !identityRef) {
    const candidates = retainedAmbiguity(ref)
    if (candidates) return { status: 'ambiguous', item: retained, ref, candidates }
    return { status: 'retained', item: retained, ref }
  }

  const resolution = resolveIdentity(identityRef, index)
  if (resolution.status === 'resolved') {
    return {
      status: 'live',
      item: mergedLiveItem(ref, resolution.item),
      ref,
    }
  }
  if (resolution.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      item: retained,
      ref,
      candidates: [...resolution.candidates],
    }
  }
  const candidates = retainedAmbiguity(ref)
  if (candidates) return { status: 'ambiguous', item: retained, ref, candidates }
  return { status: 'retained', item: retained, ref }
}

export function activePlannerDays(document) {
  const normalized = normalizePlannerDocument(document)
  return Object.entries(normalized.active)
    .map(([dayTs, entry]) => ({ dayTs: Number(dayTs), ...entry }))
    .sort((left, right) => left.dayTs - right.dayTs)
}

export function plannerHistory(document) {
  const normalized = normalizePlannerDocument(document)
  return normalized.history.map((row) => ({ ...row }))
}

export function plannerSlots(document) {
  const slots = []
  for (const day of activePlannerDays(document)) {
    for (const part of PLANNER_PARTS) {
      const ref = day.slots[part]
      if (ref) slots.push({ dayTs: day.dayTs, part, ref })
    }
  }
  return slots
}

function aliasesOverlap(left, right) {
  const leftRef = boundedIdentityRef(left)
  const rightRef = boundedIdentityRef(right)
  if (!leftRef || !rightRef) return false
  const aliases = new Set(leftRef.aliases)
  return rightRef.aliases.some((alias) => aliases.has(alias))
}

export function plannerIdentityKey(kind, primary) {
  return `${kind === 'place' || kind === 'custom' ? kind : 'event'}:${primary}`
}

function chooseWeakMatch(matches) {
  const distinct = new Set(matches.map((slot) => plannerIdentityKey(slot.ref.kind, slot.ref.primary)))
  return distinct.size === 1 ? matches[0] : null
}

export function findPlannedItem(document, item, catalog) {
  const queryRef = slotRefOf(item)
  if (!queryRef) return null
  const query = {
    kind: queryRef.kind,
    primary: queryRef.primary,
    aliases: queryRef.aliases,
  }
  const index = indexFor(catalog, kindOf(query))
  const queryResolution = index ? resolveIdentity(query, index) : null
  if (queryResolution?.status === 'ambiguous') return null
  const queryHasStablePrimary = queryResolution?.status === 'resolved'
    && queryResolution.matchedBy === 'primary'
    && queryResolution.primary === query.primary
  const exact = []
  const resolved = []
  const weak = []

  for (const slot of plannerSlots(document)) {
    if (kindOf(slot.ref) !== kindOf(query)) continue
    let slotResolution = null
    const slotIdentityRef = boundedIdentityRef(slot.ref)
    if (index && slotIdentityRef) slotResolution = resolveIdentity(slotIdentityRef, index)
    const storedAmbiguity = retainedAmbiguity(slot.ref)
    if (storedAmbiguity && slotResolution?.status !== 'resolved') continue

    if (slot.ref.primary === query.primary) {
      if (!index || queryHasStablePrimary) exact.push(slot)
      continue
    }
    if (!index) {
      if (aliasesOverlap(query, slot.ref)) weak.push(slot)
      continue
    }

    if (!slotResolution || slotResolution.status === 'ambiguous') continue
    if (queryResolution?.status === 'resolved' && slotResolution.status === 'resolved') {
      if (queryResolution.primary === slotResolution.primary) resolved.push(slot)
      continue
    }
    if (queryResolution?.status === 'missing'
        && slotResolution.status === 'missing'
        && aliasesOverlap(query, slot.ref)) {
      weak.push(slot)
    }
  }
  return exact[0] || resolved[0] || chooseWeakMatch(weak)
}

export function isPlannerItemPlanned(document, item, catalog) {
  return findPlannedItem(document, item, catalog) !== null
}

export function plannedPrimarySet(document, catalog) {
  const primaries = new Set()
  for (const { ref } of plannerSlots(document)) {
    const index = indexFor(catalog, kindOf(ref))
    if (!index) {
      if (!retainedAmbiguity(ref)) primaries.add(plannerIdentityKey(ref.kind, ref.primary))
      continue
    }
    const identityRef = boundedIdentityRef(ref)
    if (!identityRef) continue
    const resolution = resolveIdentity(identityRef, index)
    if (resolution.status === 'resolved') primaries.add(plannerIdentityKey(ref.kind, resolution.primary))
    else if (resolution.status === 'missing' && !retainedAmbiguity(ref)) {
      primaries.add(plannerIdentityKey(ref.kind, ref.primary))
    }
  }
  return primaries
}
