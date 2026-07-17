// custom-event-state-core.js — pure V2 user-created event state.
//
// The browser boundary belongs to atomic-city-store.js. This module owns only
// the city-bound document, deterministic V1 translation, optimistic mutation
// rules, stable identity evidence, and exact bounds. It never reads, writes,
// removes, or tombstones V1 storage.

import {
  legacyKeyOf,
  validLocalEventId,
} from './identity.js'
import { eventTime } from '../../shared/city-time.mjs'

export const CUSTOM_EVENT_STATE_VERSION = 2
export const CUSTOM_EVENT_CAP = 256
export const CUSTOM_EVENT_IMPORT_CAP = 32
export const CUSTOM_EVENT_SOURCE_SCAN_MAX = 1024
export const CUSTOM_EVENT_ALIAS_SCAN_MAX = 64
export const CUSTOM_EVENT_ALIAS_MAX_COUNT = 8
export const CUSTOM_EVENT_STRING_MAX_BYTES = 4096
export const CUSTOM_EVENT_TITLE_MAX_BYTES = 512
export const CUSTOM_EVENT_ITEM_MAX_BYTES = 32 * 1024
export const CUSTOM_EVENT_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
export const CUSTOM_EVENT_DIAGNOSTIC_CAP = 64
export const CUSTOM_EVENT_COMMAND_MAX_BYTES = 64 * 1024

const MY_SOURCE = 'Added by you'
const ADDED_TAG = 'added-by-you'
const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const START_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const OFFSET_SUFFIX_RE = /(?:Z|[+-]\d{2}:\d{2})$/
const RESERVED_EVENT_ALIAS_RE = /^(?:c|e|p)\|/
const ENCODER = new TextEncoder()
const TIME_ZONE_VALIDITY = new Map()
const OPTIONAL_STRING_FIELDS = [
  'end',
  'timeZone',
  'venue',
  'address',
  'neighborhood',
  'city',
  'image',
  'imageAlt',
  'url',
  'description',
  'category',
  'currency',
  'organizer',
  'status',
]
const OPTIONAL_NUMBER_FIELDS = [
  'lat',
  'lng',
  'price',
  'priceMin',
  'priceMax',
  'buzz',
  'hotScore',
]
const OPTIONAL_BOOLEAN_FIELDS = [
  'allDay',
  'isFree',
  'sponsored',
]
const EVENT_INPUT_FIELDS = new Set([
  'kind',
  'localId',
  'identityAliases',
  'title',
  'start',
  'source',
  'sources',
  'tags',
  ...OPTIONAL_STRING_FIELDS,
  ...OPTIONAL_NUMBER_FIELDS,
  ...OPTIONAL_BOOLEAN_FIELDS,
])
const DOCUMENT_FIELDS = new Set(['v', 'cityId', 'timeZone', 'rev', 'items'])
const ENTRY_FIELDS = new Set(['primary', 'aliases', 'revision', 'item'])
const CANONICAL_EVENT_FIELDS = new Set(
  [...EVENT_INPUT_FIELDS].filter((field) => field !== 'identityAliases'),
)

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function isPlainJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || seen.has(value)) return false

  const array = Array.isArray(value)
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)
      || Object.getOwnPropertySymbols(value).length > 0) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  seen.add(value)
  try {
    if (array) {
      const keys = Object.keys(value)
      if (keys.length !== value.length) return false
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index)
        const descriptor = descriptors[key]
        if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')
            || keys[index] !== key || !isPlainJson(descriptor.value, seen)) return false
      }
      return Object.getOwnPropertyNames(value).every((key) => key === 'length' || hasOwn(descriptors, key) && descriptors[key].enumerable)
    }

    const names = Object.getOwnPropertyNames(value)
    const keys = Object.keys(value)
    if (names.length !== keys.length) return false
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]
      const descriptor = descriptors[key]
      if (names[index] !== key || !descriptor?.enumerable || !hasOwn(descriptor, 'value')
          || !isPlainJson(descriptor.value, seen)) return false
    }
    return true
  } finally {
    seen.delete(value)
  }
}

function samePlainJson(left, right, { keyOrder = false } = {}) {
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return Object.is(left, right)
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => samePlainJson(value, right[index], { keyOrder }))
  }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  const orderedLeft = keyOrder ? leftKeys : [...leftKeys].sort()
  const orderedRight = keyOrder ? rightKeys : [...rightKeys].sort()
  return orderedLeft.every((key, index) => key === orderedRight[index]
    && samePlainJson(left[key], right[key], { keyOrder }))
}

function exactFields(value, allowed, required = []) {
  if (!isObject(value) || !isPlainJson(value)) return false
  const keys = Object.keys(value)
  return keys.every((key) => allowed.has(key))
    && required.every((key) => hasOwn(value, key))
}

function jsonBytes(value) {
  if (!isPlainJson(value)) return Number.POSITIVE_INFINITY
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function customEventStateBytes(value) {
  return jsonBytes(value)
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function boundedString(value, maxBytes = CUSTOM_EVENT_STRING_MAX_BYTES) {
  return typeof value === 'string'
    && value.length <= maxBytes
    && jsonBytes(value) <= maxBytes
}

function usableString(value, maxBytes = CUSTOM_EVENT_STRING_MAX_BYTES) {
  return boundedString(value, maxBytes) && value.length > 0 && value !== '|'
}

function validCityId(value) {
  return usableString(value, 160) && CITY_ID_RE.test(value)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function requireCityId(value) {
  if (!validCityId(value)) throw new TypeError('cityId must be a valid non-empty city id')
  return value
}

function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
}

function validStart(value) {
  if (!boundedString(value, 256)) return false
  const match = START_RE.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHour, offsetMinute] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const exact = new Date(Date.UTC(year, month - 1, day))
  if (exact.getUTCFullYear() !== year
      || exact.getUTCMonth() !== month - 1
      || exact.getUTCDate() !== day) {
    return false
  }
  if (hourText === undefined) return true
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = secondText === undefined ? 0 : Number(secondText)
  if (hour > 23 || minute > 59 || second > 59) return false
  if (offsetHour !== undefined) {
    const offsetHours = Number(offsetHour)
    const offsetMinutes = Number(offsetMinute)
    if (offsetHours > 14 || offsetMinutes > 59
        || offsetHours === 14 && offsetMinutes !== 0) return false
  }
  return true
}

function validTimeZone(value) {
  if (!usableString(value, 256)) return false
  if (TIME_ZONE_VALIDITY.has(value)) return TIME_ZONE_VALIDITY.get(value)
  let valid
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    valid = true
  } catch {
    valid = false
  }
  TIME_ZONE_VALIDITY.set(value, valid)
  return valid
}

function requireCityContext({ cityId: requestedCityId, timeZone: requestedTimeZone, city } = {}) {
  const configuredCityId = isObject(city) ? city.id : undefined
  const configuredTimeZone = isObject(city) ? (city.tz ?? city.timeZone) : undefined
  if (requestedCityId !== undefined && configuredCityId !== undefined
      && requestedCityId !== configuredCityId) {
    throw new TypeError('city and cityId must select the same city')
  }
  if (requestedTimeZone !== undefined && configuredTimeZone !== undefined
      && requestedTimeZone !== configuredTimeZone) {
    throw new TypeError('city and timeZone must select the same time zone')
  }
  const cityId = requireCityId(requestedCityId ?? configuredCityId)
  const timeZone = requestedTimeZone ?? configuredTimeZone
  if (!validTimeZone(timeZone)) throw new RangeError('timeZone must be a valid IANA time zone')
  return { cityId, timeZone }
}

function temporalPoint(value) {
  if (!validStart(value)) return null
  if (DATE_ONLY_RE.test(value)) return { precision: 'day', value }
  if (OFFSET_SUFFIX_RE.test(value)) {
    const epochMs = Date.parse(value)
    return Number.isFinite(epochMs) ? { precision: 'instant', value: epochMs } : null
  }
  const normalized = value.length === 16 ? `${value}:00` : value
  const [date, time] = normalized.split('T')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute, secondWithFraction = '0'] = time.split(':')
  const second = Number(secondWithFraction)
  const wallClock = Date.UTC(year, month - 1, day, Number(hour), Number(minute), second)
  return Number.isFinite(wallClock) ? { precision: 'local', value: wallClock } : null
}

function validTemporalRange(start, end) {
  if (end === undefined || end === null) return true
  const startPoint = temporalPoint(start)
  const endPoint = temporalPoint(end)
  return !!startPoint
    && !!endPoint
    && startPoint.precision === endPoint.precision
    && endPoint.value >= startPoint.value
}

function orderedStrings(groups, maxCount = CUSTOM_EVENT_ALIAS_MAX_COUNT) {
  const out = []
  const seen = new Set()
  let scanned = 0
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    const limit = Math.min(group.length, CUSTOM_EVENT_ALIAS_SCAN_MAX - scanned)
    for (let index = 0; index < limit; index += 1) {
      scanned += 1
      const value = group[index]
      if (!usableString(value, 2048) || seen.has(value)) continue
      seen.add(value)
      out.push(value)
      if (out.length >= maxCount) return out
    }
    if (scanned >= CUSTOM_EVENT_ALIAS_SCAN_MAX) break
  }
  return out
}

function validIdentityAlias(value, { primary, legacy }) {
  if (!usableString(value, 2048) || !value.includes('|')) return false
  if (value === primary || value === legacy) return true
  return !RESERVED_EVENT_ALIAS_RE.test(value)
}

function orderedAliases(groups, identity) {
  const out = []
  const seen = new Set()
  let scanned = 0
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    if (scanned + group.length > CUSTOM_EVENT_ALIAS_SCAN_MAX) return null
    for (const value of group) {
      scanned += 1
      if (!validIdentityAlias(value, identity)) return null
      if (seen.has(value)) continue
      if (out.length >= CUSTOM_EVENT_ALIAS_MAX_COUNT) return null
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

function stringArray(value, {
  required = [],
  maxCount = 16,
} = {}) {
  if (value !== undefined && !Array.isArray(value)) return null
  const source = value || []
  if (source.length > CUSTOM_EVENT_ALIAS_SCAN_MAX
      || source.some((item) => !usableString(item, 2048))) {
    return null
  }
  const out = orderedStrings([required, source], maxCount + 1)
  return out.length <= maxCount ? out : null
}

function copyOptionalString(out, input, field) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return true
  const value = input[field]
  if (value === null) {
    out[field] = null
    return true
  }
  if (!boundedString(value)) return false
  out[field] = value
  return true
}

function copyOptionalNumber(out, input, field) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return true
  const value = input[field]
  if (value === null) {
    out[field] = null
    return true
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  out[field] = value
  return true
}

function copyOptionalBoolean(out, input, field) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return true
  if (typeof input[field] !== 'boolean') return false
  out[field] = input[field]
  return true
}

function canonicalEvent(value, { localId = value?.localId, timeZone } = {}) {
  if (!isObject(value)
      || !isPlainJson(value)
      || Object.keys(value).some((field) => !EVENT_INPUT_FIELDS.has(field))
      || value.kind !== undefined && value.kind !== 'custom'
      || value.source !== undefined && value.source !== MY_SOURCE
      || value.identityAliases !== undefined && !Array.isArray(value.identityAliases)
      || !validLocalEventId(localId)
      || !usableString(value.title, CUSTOM_EVENT_TITLE_MAX_BYTES)
      || value.title.trim().length === 0
      || !validStart(value.start)
      || !validTimeZone(timeZone)
      || value.timeZone !== undefined && value.timeZone !== null && value.timeZone !== timeZone) {
    return null
  }

  const event = {
    kind: 'custom',
    localId,
    title: value.title,
    start: value.start,
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (!copyOptionalString(event, value, field)) return null
  }
  for (const field of OPTIONAL_NUMBER_FIELDS) {
    if (!copyOptionalNumber(event, value, field)) return null
  }
  for (const field of OPTIONAL_BOOLEAN_FIELDS) {
    if (!copyOptionalBoolean(event, value, field)) return null
  }
  if (event.end !== undefined && event.end !== null && !validStart(event.end)) return null
  if (!validTemporalRange(event.start, event.end)) return null
  const dateOnly = DATE_ONLY_RE.test(event.start)
  if (value.allDay !== undefined && value.allDay !== dateOnly) return null
  event.timeZone = timeZone
  event.allDay = dateOnly
  let canonicalTime
  try {
    canonicalTime = eventTime(event, {
      timeZone,
      startDisambiguation: 'reject',
      endDisambiguation: 'reject',
    })
  } catch {
    return null
  }
  if (!canonicalTime.ok) return null
  for (const field of ['url', 'image']) {
    if (event[field] === undefined || event[field] === null || event[field] === '') continue
    try {
      const relative = event[field].startsWith('/')
      const parsed = relative
        ? new URL(event[field], 'https://wuzup.invalid')
        : new URL(event[field])
      if (!relative && !['http:', 'https:'].includes(parsed.protocol)) return null
    } catch {
      return null
    }
  }
  if (event.lat !== undefined && event.lat !== null && (event.lat < -90 || event.lat > 90)) return null
  if (event.lng !== undefined && event.lng !== null && (event.lng < -180 || event.lng > 180)) return null
  for (const field of ['price', 'priceMin', 'priceMax']) {
    if (event[field] !== undefined && event[field] !== null && event[field] < 0) return null
  }
  event.source = MY_SOURCE
  event.sources = stringArray(value.sources, { required: [MY_SOURCE], maxCount: 16 })
  event.tags = stringArray(value.tags, { required: [ADDED_TAG], maxCount: 16 })
  if (!event.sources || !event.tags) return null

  return jsonBytes(event) <= CUSTOM_EVENT_ITEM_MAX_BYTES ? event : null
}

function canonicalAliases(item, groups = []) {
  const primary = `c|${item.localId}`
  const legacy = legacyKeyOf(item)
  const aliases = orderedAliases([
    [primary],
    [legacy],
    ...groups,
  ], { primary, legacy })
  return aliases?.[0] === primary && aliases.includes(legacy) ? aliases : null
}

function entryOf(value, {
  revision,
  localId = value?.localId,
  aliasGroups = [],
  timeZone,
} = {}) {
  if (!validRevision(revision)) return null
  const item = canonicalEvent(value, { localId, timeZone })
  if (!item) return null
  const aliases = canonicalAliases(item, [value.identityAliases, ...aliasGroups])
  if (!aliases) return null
  const entry = {
    primary: `c|${item.localId}`,
    aliases,
    revision,
    item,
  }
  return jsonBytes(entry) <= CUSTOM_EVENT_ITEM_MAX_BYTES ? entry : null
}

function hydratedItem(entry) {
  return {
    ...entry.item,
    identityAliases: entry.aliases.slice(1),
  }
}

function projectedItem(entry, durability) {
  if (durability === 'durable') return hydratedItem(entry)
  const legacy = legacyKeyOf(entry.item)
  const sessionKeyTitle = `session-custom-${stableHash(`${entry.primary}\u0000${legacy}`)}`
  const item = {
    ...entry.item,
    _keyTitle: sessionKeyTitle,
    _sessionLegacyIdentity: legacy,
    // A pending c| ID is not durable evidence. Project only legacy aliases so
    // another durable store cannot make the unlanded identity permanent.
    identityAliases: entry.aliases.filter((alias) => (
      alias !== legacy && alias !== entry.primary && !RESERVED_EVENT_ALIAS_RE.test(alias)
    )),
  }
  delete item.localId
  return item
}

function canonicalEntry(value, documentRevision, timeZone) {
  if (!exactFields(value, ENTRY_FIELDS, ['primary', 'aliases', 'revision', 'item'])
      || !validRevision(value.revision)
      || value.revision > documentRevision
      || !Array.isArray(value.aliases)
      || !exactFields(value.item, CANONICAL_EVENT_FIELDS, [
        'kind', 'localId', 'title', 'start', 'timeZone', 'allDay', 'source', 'sources', 'tags',
      ])
      || value.primary !== `c|${value.item.localId}`) {
    return null
  }
  const entry = entryOf(value.item, {
    revision: value.revision,
    aliasGroups: [value.aliases],
    timeZone,
  })
  return entry?.primary === value.primary && samePlainJson(entry, value) ? entry : null
}

function overlappingAlias(entry, entries, ignoredPrimary = null) {
  const claimed = new Map()
  for (const current of entries) {
    if (current.primary === ignoredPrimary) continue
    for (const alias of current.aliases) claimed.set(alias, current.primary)
  }
  for (const alias of entry.aliases) {
    if (claimed.has(alias)) {
      return { alias, existingPrimary: claimed.get(alias) }
    }
  }
  return null
}

function sameEntryContent(left, right) {
  return JSON.stringify({
    primary: left.primary,
    aliases: left.aliases,
    item: left.item,
  }) === JSON.stringify({
    primary: right.primary,
    aliases: right.aliases,
    item: right.item,
  })
}

function reject(document, code, detail = {}) {
  return deepFreeze({
    document,
    changed: false,
    code,
    rejection: { code, ...detail },
  })
}

function rejectUntrustedDocument(document) {
  return Object.freeze({
    document,
    changed: false,
    code: 'invalid-document',
    rejection: Object.freeze({ code: 'invalid-document' }),
  })
}

function conflict(document, code, detail = {}) {
  return deepFreeze({
    document,
    changed: false,
    code,
    conflict: { code, ...detail },
  })
}

function nextRevision(document) {
  return document.rev < Number.MAX_SAFE_INTEGER - 1 ? document.rev + 1 : null
}

export function emptyCustomEventState(cityId, { timeZone, city } = {}) {
  const selected = requireCityContext({ cityId, timeZone, city })
  return deepFreeze({
    v: CUSTOM_EVENT_STATE_VERSION,
    cityId: selected.cityId,
    timeZone: selected.timeZone,
    rev: 0,
    items: [],
  })
}

export function normalizeCustomEventState(value, options = {}) {
  const selected = requireCityContext(options)
  if (!exactFields(value, DOCUMENT_FIELDS, ['v', 'cityId', 'timeZone', 'rev', 'items'])
      || value.v !== CUSTOM_EVENT_STATE_VERSION
      || value.cityId !== selected.cityId
      || value.timeZone !== selected.timeZone
      || !validRevision(value.rev)
      || !Array.isArray(value.items)
      || value.items.length > CUSTOM_EVENT_CAP
      || jsonBytes(value) > CUSTOM_EVENT_DOCUMENT_MAX_BYTES) {
    return null
  }

  const items = []
  const primaries = new Set()
  const aliases = new Set()
  for (const valueEntry of value.items) {
    const entry = canonicalEntry(valueEntry, value.rev, selected.timeZone)
    if (!entry || primaries.has(entry.primary)) return null
    for (const alias of entry.aliases) {
      if (aliases.has(alias)) return null
    }
    primaries.add(entry.primary)
    for (const alias of entry.aliases) aliases.add(alias)
    items.push(entry)
  }

  const document = {
    v: CUSTOM_EVENT_STATE_VERSION,
    cityId: selected.cityId,
    timeZone: selected.timeZone,
    rev: value.rev,
    items,
  }
  return jsonBytes(document) <= CUSTOM_EVENT_DOCUMENT_MAX_BYTES
    ? deepFreeze(document)
    : null
}

export function customEventItems(value, { durability = 'unknown', ...context } = {}) {
  const document = normalizeCustomEventState(value, context)
  return deepFreeze(document
    ? document.items.map((entry) => projectedItem(entry, durability))
    : [])
}

function stableHash(value) {
  let left = 2166136261
  let right = 2246822519
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    left ^= code
    left = Math.imul(left, 16777619)
    right ^= code + index
    right = Math.imul(right, 3266489917)
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`
}

function deterministicLocalId(raw, cityId, index, attempt) {
  const legacy = legacyKeyOf(raw)
  return `migrated-${stableHash(`${cityId}\u0000${index}\u0000${attempt}\u0000${legacy}`)}`
}

function mintLocalId(raw, {
  cityId,
  index,
  blocked,
}) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const deterministic = deterministicLocalId(raw, cityId, index, attempt)
    if (validLocalEventId(deterministic) && !blocked.has(`c|${deterministic}`)) {
      return deterministic
    }
  }
  return null
}

function issueCollector() {
  const issues = []
  const counts = {}
  return {
    add(index, code, detail = {}) {
      counts[code] = (counts[code] || 0) + 1
      if (issues.length < CUSTOM_EVENT_DIAGNOSTIC_CAP) {
        issues.push({ index, code, ...detail })
      }
    },
    result(extra) {
      return {
        ...extra,
        counts,
        issues,
        issuesTruncated: Object.values(counts).reduce((sum, count) => sum + count, 0) > issues.length,
      }
    },
  }
}

function sourceEvidenceSummary(evidence) {
  const row = isObject(evidence?.customEvents) ? evidence.customEvents : null
  if (!row) return { domain: 'custom', evidence: 'unavailable' }
  return {
    domain: 'custom',
    key: boundedString(row.key, 256) ? row.key : null,
    status: boundedString(row.status, 64) ? row.status : null,
    source: boundedString(row.source, 64) ? row.source : null,
    rawBytes: typeof row.value === 'string'
      ? ENCODER.encode(row.value).byteLength
      : row.value === null ? 0 : null,
  }
}

export class CustomEventStateError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CustomEventStateError'
    this.code = code
    this.details = details
  }
}

function migrationFail(code, message, details = {}) {
  throw new CustomEventStateError(code, message, details)
}

function verifiedSourceEvidence(rows, evidence) {
  if (!isPlainJson(evidence)
      || !isObject(evidence)
      || !Object.prototype.hasOwnProperty.call(evidence, 'customEvents')) {
    migrationFail(
      'CUSTOM_EVENT_EVIDENCE_REQUIRED',
      'retained custom-event migration requires strict capture evidence',
    )
  }
  const row = evidence.customEvents
  if (!isObject(row)
      || !Object.prototype.hasOwnProperty.call(row, 'key')
      || !Object.prototype.hasOwnProperty.call(row, 'status')
      || !Object.prototype.hasOwnProperty.call(row, 'value')
      || !Object.prototype.hasOwnProperty.call(row, 'source')
      || row.key !== 'my-events-v1'
      || !['ok', 'missing'].includes(row.status)
      || row.source !== null && !boundedString(row.source, 64)) {
    migrationFail(
      'CUSTOM_EVENT_INVALID_EVIDENCE',
      'retained custom-event evidence is malformed',
    )
  }
  if (row.status === 'missing') {
    if (row.value !== null || row.source !== null || rows.length !== 0) {
      migrationFail(
        'CUSTOM_EVENT_EVIDENCE_MISMATCH',
        'missing retained evidence cannot contain custom events',
      )
    }
    return sourceEvidenceSummary(evidence)
  }
  if (typeof row.value !== 'string') {
    migrationFail(
      'CUSTOM_EVENT_INVALID_EVIDENCE',
      'retained custom-event evidence must contain exact raw string bytes',
    )
  }
  let parsed
  try {
    parsed = JSON.parse(row.value)
  } catch {
    migrationFail(
      'CUSTOM_EVENT_INVALID_EVIDENCE',
      'retained custom-event evidence contains malformed JSON',
    )
  }
  if (!isPlainJson(parsed) || !samePlainJson(parsed, rows, { keyOrder: true })) {
    migrationFail(
      'CUSTOM_EVENT_EVIDENCE_MISMATCH',
      'parsed retained source does not match its raw evidence',
    )
  }
  return sourceEvidenceSummary(evidence)
}

export function migrateV1CustomEventState(
  source,
  {
    cityId: requestedCityId,
    timeZone: requestedTimeZone,
    city,
    evidence,
  } = {},
) {
  let selected
  try {
    selected = requireCityContext({
      cityId: requestedCityId,
      timeZone: requestedTimeZone,
      city,
    })
  } catch (cause) {
    migrationFail(
      'CUSTOM_EVENT_CITY_MISMATCH',
      'city, cityId, and timeZone must select one valid city clock',
      { cause },
    )
  }
  const { cityId: selectedCityId, timeZone } = selected
  if (!exactFields(source, new Set(['customEvents']), ['customEvents'])
      || !Array.isArray(source.customEvents)) {
    migrationFail(
      'CUSTOM_EVENT_INVALID_SOURCE',
      'retained source must contain a customEvents array',
    )
  }
  const rows = source.customEvents
  if (rows.length > CUSTOM_EVENT_CAP) {
    migrationFail(
      'CUSTOM_EVENT_SOURCE_OVERFLOW',
      'retained custom-event count exceeds the V2 document cap',
      { count: rows.length, cap: CUSTOM_EVENT_CAP },
    )
  }
  const evidenceSummary = verifiedSourceEvidence(rows, evidence)
  const diagnostics = issueCollector()
  const items = []
  const claimedPrimaries = new Set()
  const reservedPrimaries = new Set(rows
    .filter((row) => isObject(row) && validLocalEventId(row.localId))
    .map((row) => `c|${row.localId}`))
  const claimedAliases = new Set()
  let reminted = 0

  const scanCount = Math.min(rows.length, CUSTOM_EVENT_SOURCE_SCAN_MAX)
  for (let index = 0; index < scanCount; index += 1) {
    const raw = rows[index]
    if (!isObject(raw)
        || !usableString(raw.title, CUSTOM_EVENT_TITLE_MAX_BYTES)
        || raw.title.trim().length === 0
        || !validStart(raw.start)) {
      diagnostics.add(index, 'invalid-event')
      continue
    }
    const probe = canonicalEvent(raw, {
      localId: 'migrated-probe-id',
      timeZone,
    })
    if (!probe) {
      diagnostics.add(index, jsonBytes(raw) > CUSTOM_EVENT_ITEM_MAX_BYTES ? 'event-too-large' : 'invalid-event')
      continue
    }
    if (items.length >= CUSTOM_EVENT_CAP) {
      diagnostics.add(index, 'event-cap-reached')
      continue
    }

    const existingId = validLocalEventId(raw.localId) && !claimedPrimaries.has(`c|${raw.localId}`)
      ? raw.localId
      : null
    const localId = existingId || mintLocalId(raw, {
      cityId: selectedCityId,
      index,
      blocked: new Set([...reservedPrimaries, ...claimedPrimaries]),
    })
    if (!localId) {
      diagnostics.add(index, 'identity-unavailable')
      continue
    }
    if (raw.localId !== localId) reminted += 1

    const aliasGroups = []
    if (Array.isArray(raw.identityAliases)) aliasGroups.push(raw.identityAliases)
    const entry = entryOf(probe, {
      revision: 0,
      localId,
      aliasGroups,
      timeZone,
    })
    if (!entry) {
      diagnostics.add(index, jsonBytes(raw) > CUSTOM_EVENT_ITEM_MAX_BYTES ? 'event-too-large' : 'invalid-event')
      continue
    }
    const duplicate = entry.aliases.find((alias) => claimedAliases.has(alias))
    if (duplicate) {
      diagnostics.add(index, 'duplicate-identity', { alias: duplicate.slice(0, 256) })
      continue
    }

    claimedPrimaries.add(entry.primary)
    for (const alias of entry.aliases) claimedAliases.add(alias)
    items.push(entry)
  }
  if (rows.length > scanCount) {
    diagnostics.add(scanCount, 'source-scan-limit', { omitted: rows.length - scanCount })
  }

  const document = normalizeCustomEventState({
    v: CUSTOM_EVENT_STATE_VERSION,
    cityId: selectedCityId,
    timeZone,
    rev: 0,
    items,
  }, { cityId: selectedCityId, timeZone })
  const rejected = rows.length - items.length
  const migrationDiagnostics = diagnostics.result({
    received: rows.length,
    imported: items.length,
    rejected,
    reminted,
    invalidSource: false,
  })
  if (!document || rejected > 0) {
    migrationFail(
      'CUSTOM_EVENT_MIGRATION_REJECTED',
      'retained custom events could not be migrated without loss',
      migrationDiagnostics,
    )
  }

  return deepFreeze({
    document,
    status: rows.length === 0 ? 'empty' : 'migrated',
    diagnostics: migrationDiagnostics,
    sourceSummary: evidenceSummary,
  })
}

function documentWith(document, items, revision) {
  return normalizeCustomEventState({
    v: CUSTOM_EVENT_STATE_VERSION,
    cityId: document.cityId,
    timeZone: document.timeZone,
    rev: revision,
    items,
  }, { cityId: document.cityId, timeZone: document.timeZone })
}

function eventFromCommand(command, timeZone, localId = command?.event?.localId) {
  if (!isObject(command?.event)) return null
  if (command.event.localId !== undefined && command.event.localId !== localId) return null
  return entryOf(command.event, {
    revision: 0,
    localId,
    aliasGroups: [command.event.identityAliases],
    timeZone,
  })
}

function canonicalImportEntries(events, revision, mode, timeZone) {
  const countCap = mode === 'replace' ? CUSTOM_EVENT_CAP : CUSTOM_EVENT_IMPORT_CAP
  if (!Array.isArray(events)
      || events.length > countCap) {
    return { error: 'invalid-import' }
  }
  const bytes = jsonBytes(events)
  if (bytes > CUSTOM_EVENT_COMMAND_MAX_BYTES) {
    return {
      error: 'import-command-too-large',
      bytes,
      cap: CUSTOM_EVENT_COMMAND_MAX_BYTES,
    }
  }
  const entries = []
  const aliases = new Map()
  for (let index = 0; index < events.length; index += 1) {
    const raw = events[index]
    const entry = entryOf(raw, {
      revision,
      aliasGroups: [raw?.identityAliases],
      timeZone,
    })
    if (!entry) return { error: 'invalid-import-event', index }
    for (const alias of entry.aliases) {
      if (aliases.has(alias)) {
        return {
          error: 'duplicate-import-identity',
          index,
          alias,
          existingIndex: aliases.get(alias),
        }
      }
      aliases.set(alias, index)
    }
    entries.push(entry)
  }
  return { entries }
}

export function reduceCustomEventState(value, command, context = {}) {
  let selected
  try {
    selected = requireCityContext(context)
  } catch {
    return rejectUntrustedDocument(value)
  }
  const document = normalizeCustomEventState(value, selected)
  if (!document) return rejectUntrustedDocument(value)
  const revision = nextRevision(document)
  if (revision === null) return reject(document, 'revision-exhausted')

  if (command?.type === 'add') {
    const entry = eventFromCommand(command, selected.timeZone)
    if (!entry) return reject(document, 'invalid-event')
    if (document.items.some((item) => item.primary === entry.primary)) {
      const existing = document.items.find((item) => item.primary === entry.primary)
      return conflict(document, 'duplicate-local-id', {
        primary: entry.primary,
        actualRevision: existing.revision,
      })
    }
    const overlap = overlappingAlias(entry, document.items)
    if (overlap) return conflict(document, 'duplicate-identity', overlap)
    if (document.items.length >= CUSTOM_EVENT_CAP) return reject(document, 'event-cap-reached')

    const added = { ...entry, revision }
    const next = documentWith(document, [...document.items, added], revision)
    if (!next) return reject(document, 'document-too-large')
    return deepFreeze({
      document: next,
      changed: true,
      code: 'added',
      item: hydratedItem(added),
      canonicalCommand: { type: 'add', event: hydratedItem(added) },
    })
  }

  if (command?.type === 'update') {
    if (!validLocalEventId(command.localId) || !validRevision(command.expectedRevision)) {
      return reject(document, 'invalid-update')
    }
    const primary = `c|${command.localId}`
    const index = document.items.findIndex((item) => item.primary === primary)
    if (index < 0) return conflict(document, 'missing-item', { primary })
    const current = document.items[index]
    if (current.revision !== command.expectedRevision) {
      return conflict(document, 'item-revision-conflict', {
        primary,
        expectedRevision: command.expectedRevision,
        actualRevision: current.revision,
      })
    }
    const candidate = eventFromCommand(command, selected.timeZone, command.localId)
    if (!candidate) return reject(document, 'invalid-event')
    const updated = entryOf(candidate.item, {
      revision,
      aliasGroups: [current.aliases, candidate.aliases],
      timeZone: selected.timeZone,
    })
    if (!updated) return reject(document, 'invalid-event')
    const overlap = overlappingAlias(updated, document.items, primary)
    if (overlap) return conflict(document, 'duplicate-identity', overlap)
    if (sameEntryContent(current, updated)) {
      return deepFreeze({
        document,
        changed: false,
        code: 'unchanged',
        item: hydratedItem(current),
      })
    }

    const items = [...document.items]
    items[index] = updated
    const next = documentWith(document, items, revision)
    if (!next) return reject(document, 'document-too-large')
    return deepFreeze({
      document: next,
      changed: true,
      code: 'updated',
      item: hydratedItem(updated),
      canonicalCommand: {
        type: 'update',
        localId: command.localId,
        expectedRevision: command.expectedRevision,
        event: hydratedItem(updated),
      },
    })
  }

  if (command?.type === 'delete') {
    if (!validLocalEventId(command.localId) || !validRevision(command.expectedRevision)) {
      return reject(document, 'invalid-delete')
    }
    const primary = `c|${command.localId}`
    const index = document.items.findIndex((item) => item.primary === primary)
    if (index < 0) return conflict(document, 'missing-item', { primary })
    const current = document.items[index]
    if (current.revision !== command.expectedRevision) {
      return conflict(document, 'item-revision-conflict', {
        primary,
        expectedRevision: command.expectedRevision,
        actualRevision: current.revision,
      })
    }
    const next = documentWith(
      document,
      document.items.filter((_, itemIndex) => itemIndex !== index),
      revision,
    )
    if (!next) return reject(document, 'invalid-document')
    return deepFreeze({
      document: next,
      changed: true,
      code: 'deleted',
      item: hydratedItem(current),
      canonicalCommand: {
        type: 'delete',
        localId: command.localId,
        expectedRevision: command.expectedRevision,
      },
    })
  }

  if (command?.type === 'import') {
    if (!['merge', 'replace'].includes(command.mode)
        || !validRevision(command.expectedRevision)) {
      return reject(document, 'invalid-import')
    }
    if (command.expectedRevision !== document.rev) {
      return conflict(document, 'document-revision-conflict', {
        expectedRevision: command.expectedRevision,
        actualRevision: document.rev,
      })
    }
    const imported = canonicalImportEntries(
      command.events,
      revision,
      command.mode,
      selected.timeZone,
    )
    if (!imported.entries) {
      return reject(document, imported.error, {
        ...(imported.index === undefined ? {} : { index: imported.index }),
        ...(imported.alias === undefined ? {} : { alias: imported.alias.slice(0, 256) }),
        ...(imported.existingIndex === undefined ? {} : { existingIndex: imported.existingIndex }),
        ...(imported.bytes === undefined ? {} : { bytes: imported.bytes }),
        ...(imported.cap === undefined ? {} : { cap: imported.cap }),
      })
    }

    let items
    if (command.mode === 'merge') {
      items = [...document.items]
      for (const incoming of imported.entries) {
        const index = items.findIndex((item) => item.primary === incoming.primary)
        if (index >= 0) {
          const combined = entryOf(incoming.item, {
            revision: items[index].revision,
            aliasGroups: [items[index].aliases, incoming.aliases],
            timeZone: selected.timeZone,
          })
          if (!combined || !sameEntryContent(items[index], combined)) {
            return conflict(document, 'import-item-conflict', {
              primary: incoming.primary,
              actualRevision: items[index].revision,
            })
          }
          continue
        }
        const overlap = overlappingAlias(incoming, items)
        if (overlap) return conflict(document, 'duplicate-identity', overlap)
        if (items.length >= CUSTOM_EVENT_CAP) return reject(document, 'event-cap-reached')
        items.push(incoming)
      }
    } else {
      const existing = new Map(document.items.map((item) => [item.primary, item]))
      items = []
      for (const incoming of imported.entries) {
        const current = existing.get(incoming.primary)
        const combined = entryOf(incoming.item, {
          revision,
          aliasGroups: [current?.aliases, incoming.aliases],
          timeZone: selected.timeZone,
        })
        if (!combined) return reject(document, 'invalid-import-event')
        items.push(current && sameEntryContent(current, combined) ? current : combined)
      }
    }

    const unchanged = items.length === document.items.length
      && items.every((item, index) => sameEntryContent(item, document.items[index]))
    if (unchanged) return deepFreeze({ document, changed: false, code: 'unchanged' })
    const next = documentWith(document, items, revision)
    if (!next) return reject(document, 'document-too-large')
    const canonicalCommand = {
      type: 'import',
      mode: command.mode,
      expectedRevision: command.expectedRevision,
      events: (command.mode === 'replace' ? next.items : imported.entries).map(hydratedItem),
    }
    const commandBytes = jsonBytes(canonicalCommand)
    if (commandBytes > CUSTOM_EVENT_COMMAND_MAX_BYTES) {
      return reject(document, 'import-command-too-large', {
        bytes: commandBytes,
        cap: CUSTOM_EVENT_COMMAND_MAX_BYTES,
      })
    }
    return deepFreeze({
      document: next,
      changed: true,
      code: command.mode === 'replace' ? 'import-replaced' : 'import-merged',
      canonicalCommand,
    })
  }

  return reject(document, 'invalid-command')
}

export function canonicalizeCustomEventCommand(_command, reducerResult) {
  return isObject(reducerResult?.canonicalCommand)
    ? reducerResult.canonicalCommand
    : null
}
