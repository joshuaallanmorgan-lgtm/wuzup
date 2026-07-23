import { createHash } from 'node:crypto'

import { cityMidnightMs, parseZonedDateTime } from './city-time.mjs'

const SNAPSHOT_VERSION = 1
const CITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const DATE_OR_ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?)?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const EVENT_KEYS = new Set([
  'id', 'canonicalId', 'seriesId', 'sourceFamily', 'sourceFamilies', 'organizer', 'status',
  'start', 'end', 'category', 'rawCategories', 'urlHost', 'actionability', 'firstSeen', 'seenAt',
])

export const SIGNAL_SNAPSHOT_CODES = Object.freeze({
  CITY_INVALID: 'CITY_INVALID',
  TIME_ZONE_INVALID: 'TIME_ZONE_INVALID',
  GENERATED_AT_INVALID: 'GENERATED_AT_INVALID',
  BUILD_ID_INVALID: 'BUILD_ID_INVALID',
  EVENTS_INVALID: 'EVENTS_INVALID',
  EVENT_INVALID: 'EVENT_INVALID',
  EVENT_ID_DUPLICATE: 'EVENT_ID_DUPLICATE',
  EVENTS_NOT_SORTED: 'EVENTS_NOT_SORTED',
  EVENT_FIELD_UNSUPPORTED: 'EVENT_FIELD_UNSUPPORTED',
  COUNTS_INVALID: 'COUNTS_INVALID',
  HASH_INVALID: 'HASH_INVALID',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  CITY_MISMATCH: 'CITY_MISMATCH',
  TIME_ZONE_MISMATCH: 'TIME_ZONE_MISMATCH',
  HISTORY_ORDER_INVALID: 'HISTORY_ORDER_INVALID',
})

const compareText = (left, right) => String(left) < String(right) ? -1 : (String(left) > String(right) ? 1 : 0)
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit
const optionalText = (value, limit, field) => {
  if (value == null) return null
  if (!text(value, limit)) throw new Error(`${field} is invalid`)
  return value.trim()
}

function validTimeZone(value) {
  if (!text(value, 100)) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function validUtc(value) {
  return text(value, 40) && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))
}

function validDateOrIso(value, timeZone) {
  if (!text(value, 40) || !DATE_OR_ISO.test(value) || !validTimeZone(timeZone)) return false
  try {
    if (DATE_ONLY.test(value)) {
      cityMidnightMs(value, timeZone)
      return true
    }
    // Offset values are real instants, while zoneless values are city-local
    // wall times. The shared parser validates both without consulting the
    // host timezone, rejects calendar rollovers and DST gaps, and resolves
    // folds with its established deterministic "earlier" policy.
    return parseZonedDateTime(value, timeZone, { disambiguation: 'earlier' }).ok
  } catch {
    return false
  }
}

function normalizeStringList(value, limit, field) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 32 || !value.every((item) => text(item, limit))) {
    throw new Error(`${field} is invalid`)
  }
  return [...new Set(value.map((item) => item.trim()))].sort(compareText)
}

function urlHost(value) {
  if (value == null || value === '') return null
  if (!text(value, 2048)) return null
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

function normalizeEvent(event, timeZone) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event is invalid')
  const id = optionalText(event.id, 200, 'event.id')
  if (!id) throw new Error('event.id is required')
  const sourceFamily = optionalText(event.sourceFamily, 120, 'event.sourceFamily')
  const sourceFamilies = normalizeStringList(event.sourceFamilies, 120, 'event.sourceFamilies')
  if (sourceFamily && !sourceFamilies.includes(sourceFamily)) sourceFamilies.push(sourceFamily)
  sourceFamilies.sort(compareText)
  const actionability = Object.hasOwn(event, 'actionability') ? event.actionability : event.actionable
  const normalizedActionability = actionability == null ? null : actionability
  if (normalizedActionability !== null && typeof normalizedActionability !== 'boolean') throw new Error('event.actionability is invalid')

  const facts = {
    id,
    canonicalId: optionalText(event.canonicalId, 200, 'event.canonicalId'),
    seriesId: optionalText(event.seriesId, 200, 'event.seriesId'),
    sourceFamily,
    sourceFamilies,
    organizer: optionalText(event.organizer, 200, 'event.organizer'),
    status: optionalText(event.status, 80, 'event.status'),
    start: optionalText(event.start, 40, 'event.start'),
    end: optionalText(event.end, 40, 'event.end'),
    category: optionalText(event.category, 80, 'event.category'),
    rawCategories: normalizeStringList(event.rawCategories, 80, 'event.rawCategories'),
    urlHost: urlHost(event.url),
    actionability: normalizedActionability,
    firstSeen: optionalText(event.firstSeen, 40, 'event.firstSeen'),
    seenAt: optionalText(event.seenAt, 40, 'event.seenAt'),
  }
  for (const field of ['start', 'end']) {
    if (facts[field] != null && !validDateOrIso(facts[field], timeZone)) throw new Error(`event.${field} is invalid`)
  }
  for (const field of ['firstSeen', 'seenAt']) {
    if (facts[field] != null && !validUtc(facts[field])) throw new Error(`event.${field} is invalid`)
  }
  return facts
}

function sourceFamilyCounts(events) {
  const counts = new Map()
  for (const event of events) {
    for (const sourceFamily of event.sourceFamilies) {
      counts.set(sourceFamily, (counts.get(sourceFamily) || 0) + 1)
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => compareText(left, right)))
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareText).map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function payload(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    cityId: snapshot.cityId,
    timeZone: snapshot.timeZone,
    generatedAt: snapshot.generatedAt,
    buildId: snapshot.buildId,
    events: snapshot.events,
    counts: snapshot.counts,
  }
}

function contentHash(snapshot) {
  return `sha256:${createHash('sha256').update(canonicalJson(payload(snapshot))).digest('hex')}`
}

function validFact(event, timeZone) {
  try {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return false
    if (Object.keys(event).some((key) => !EVENT_KEYS.has(key))) return false
    if (!text(event.id, 200) || !Array.isArray(event.sourceFamilies) ||
        !event.sourceFamilies.every((value) => text(value, 120)) ||
        [...event.sourceFamilies].sort(compareText).join('\u0000') !== [...new Set(event.sourceFamilies)].sort(compareText).join('\u0000')) return false
    if (event.sourceFamily != null && (!text(event.sourceFamily, 120) || !event.sourceFamilies.includes(event.sourceFamily))) return false
    for (const field of ['canonicalId', 'seriesId']) if (event[field] != null && !text(event[field], 200)) return false
    if (event.organizer != null && !text(event.organizer, 200)) return false
    if (event.status != null && !text(event.status, 80)) return false
    for (const field of ['start', 'end']) if (event[field] != null && !validDateOrIso(event[field], timeZone)) return false
    if (event.category != null && !text(event.category, 80)) return false
    if (!Array.isArray(event.rawCategories) || !event.rawCategories.every((value) => text(value, 80))) return false
    if (event.urlHost != null && (!text(event.urlHost, 253) || /[/:@]/.test(event.urlHost))) return false
    if (event.actionability !== null && typeof event.actionability !== 'boolean') return false
    for (const field of ['firstSeen', 'seenAt']) if (event[field] != null && !validUtc(event[field])) return false
    return true
  } catch {
    return false
  }
}

export function buildSignalSnapshot({ cityId, timeZone, generatedAt, buildId, events } = {}) {
  if (!text(cityId, 80) || !CITY_ID.test(cityId)) throw new Error('cityId is invalid')
  if (!validTimeZone(timeZone)) throw new Error('timeZone is invalid')
  if (!validUtc(generatedAt)) throw new Error('generatedAt is invalid')
  if (!text(buildId, 256)) throw new Error('buildId is invalid')
  if (!Array.isArray(events)) throw new Error('events must be an array')

  const facts = events.map((event) => normalizeEvent(event, timeZone)).sort((left, right) => compareText(left.id, right.id))
  if (new Set(facts.map((event) => event.id)).size !== facts.length) throw new Error('event IDs must be unique')
  const snapshot = {
    schemaVersion: SNAPSHOT_VERSION,
    cityId,
    timeZone,
    generatedAt,
    buildId,
    events: facts,
    counts: { events: facts.length, sourceFamilyCounts: sourceFamilyCounts(facts) },
  }
  return { ...snapshot, contentSha256: contentHash(snapshot) }
}

export function validateSignalSnapshot(snapshot) {
  const errors = []
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.schemaVersion !== SNAPSHOT_VERSION) {
    errors.push(SIGNAL_SNAPSHOT_CODES.SCHEMA_INVALID)
  }
  if (!text(snapshot && snapshot.cityId, 80) || !CITY_ID.test(snapshot.cityId)) errors.push(SIGNAL_SNAPSHOT_CODES.CITY_INVALID)
  if (!validTimeZone(snapshot && snapshot.timeZone)) errors.push(SIGNAL_SNAPSHOT_CODES.TIME_ZONE_INVALID)
  if (!validUtc(snapshot && snapshot.generatedAt)) errors.push(SIGNAL_SNAPSHOT_CODES.GENERATED_AT_INVALID)
  if (!text(snapshot && snapshot.buildId, 256)) errors.push(SIGNAL_SNAPSHOT_CODES.BUILD_ID_INVALID)
  if (!Array.isArray(snapshot && snapshot.events)) errors.push(SIGNAL_SNAPSHOT_CODES.EVENTS_INVALID)
  else {
    const ids = snapshot.events.map((event) => event && event.id)
    if (!snapshot.events.every((event) => validFact(event, snapshot.timeZone))) errors.push(SIGNAL_SNAPSHOT_CODES.EVENT_INVALID)
    if (new Set(ids).size !== ids.length) errors.push(SIGNAL_SNAPSHOT_CODES.EVENT_ID_DUPLICATE)
    if (ids.some((id, index) => index > 0 && compareText(ids[index - 1], id) >= 0)) errors.push(SIGNAL_SNAPSHOT_CODES.EVENTS_NOT_SORTED)
    if (snapshot.events.some((event) => event && Object.keys(event).some((key) => !EVENT_KEYS.has(key)))) {
      errors.push(SIGNAL_SNAPSHOT_CODES.EVENT_FIELD_UNSUPPORTED)
    }
  }
  const expectedCounts = Array.isArray(snapshot && snapshot.events)
    ? { events: snapshot.events.length, sourceFamilyCounts: sourceFamilyCounts(snapshot.events.filter((event) => validFact(event, snapshot.timeZone))) }
    : null
  if (!snapshot || canonicalJson(snapshot.counts) !== canonicalJson(expectedCounts)) errors.push(SIGNAL_SNAPSHOT_CODES.COUNTS_INVALID)
  if (!snapshot || !/^sha256:[a-f0-9]{64}$/.test(snapshot.contentSha256 || '') || contentHash(snapshot) !== snapshot.contentSha256) {
    errors.push(SIGNAL_SNAPSHOT_CODES.HASH_INVALID)
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort(compareText) }
}

function countBy(events, field) {
  const counts = new Map()
  for (const event of events) {
    const values = field === 'sourceFamily' ? event.sourceFamilies : (event.organizer ? [event.organizer] : [])
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return counts
}

function deltas(previous, current, field, label) {
  const before = countBy(previous.events, field)
  const after = countBy(current.events, field)
  return [...new Set([...before.keys(), ...after.keys()])].sort(compareText)
    .map((value) => ({ [label]: value, previous: before.get(value) || 0, current: after.get(value) || 0,
      delta: (after.get(value) || 0) - (before.get(value) || 0) }))
    .filter((entry) => entry.delta !== 0)
}

export function compareSignalSnapshots(previous, current) {
  const previousValidation = validateSignalSnapshot(previous)
  const currentValidation = validateSignalSnapshot(current)
  const reasons = [
    ...previousValidation.errors.map((code) => `PREVIOUS_${code}`),
    ...currentValidation.errors.map((code) => `CURRENT_${code}`),
  ]
  if (previousValidation.valid && currentValidation.valid && previous.cityId !== current.cityId) reasons.push(SIGNAL_SNAPSHOT_CODES.CITY_MISMATCH)
  if (previousValidation.valid && currentValidation.valid && previous.timeZone !== current.timeZone) reasons.push(SIGNAL_SNAPSHOT_CODES.TIME_ZONE_MISMATCH)
  if (previousValidation.valid && currentValidation.valid && Date.parse(current.generatedAt) <= Date.parse(previous.generatedAt)) {
    reasons.push(SIGNAL_SNAPSHOT_CODES.HISTORY_ORDER_INVALID)
  }
  if (reasons.length > 0) return { state: 'unavailable', reasons: [...new Set(reasons)].sort(compareText) }

  const previousIds = new Set(previous.events.map((event) => event.id))
  const currentIds = new Set(current.events.map((event) => event.id))
  return {
    state: 'available',
    cityId: current.cityId,
    addedIds: [...currentIds].filter((id) => !previousIds.has(id)).sort(compareText),
    removedIds: [...previousIds].filter((id) => !currentIds.has(id)).sort(compareText),
    persistedIds: [...currentIds].filter((id) => previousIds.has(id)).sort(compareText),
    organizerDeltas: deltas(previous, current, 'organizer', 'organizer'),
    sourceFamilyDeltas: deltas(previous, current, 'sourceFamily', 'sourceFamily'),
    interpretation: 'Presence and source/organizer count changes are history signals, not popularity measurements.',
  }
}
