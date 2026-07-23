// Bounded, read-only plan sharing for static deployments.
//
// The payload lives after `#`, so GitHub Pages never receives or routes it.
// It intentionally carries only three display-safe planner slots and stable
// identity evidence. Parsing this module never writes to Planner or storage;
// a recipient may inspect the shared day without silently importing it.

import { fmtLocale } from './city.js'
import { validRouteIdentity } from './route-state.js'

export const PLAN_CAPSULE_VERSION = 1
export const PLAN_CAPSULE_FRAGMENT_KEY = 'wuzup-plan'
export const PLAN_CAPSULE_MAX_SLOTS = 3
export const PLAN_CAPSULE_MAX_BYTES = 4096
export const PLAN_CAPSULE_MAX_FRAGMENT_BYTES = 6144

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_ZONE_RE = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/
const SLOT_PARTS = Object.freeze(['morning', 'afternoon', 'night'])
const SLOT_KINDS = Object.freeze(['event', 'custom', 'place'])
const ENCODER = new TextEncoder()
const DECODER = new TextDecoder('utf-8', { fatal: true })

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function exactFields(value, allowed, required = allowed) {
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key)) && required.every((key) => hasOwn(value, key))
}

function jsonBytes(value) {
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 80 || !TIME_ZONE_RE.test(value)) return false
  try {
    return new Intl.DateTimeFormat(fmtLocale, { timeZone: value }).resolvedOptions().timeZone === value
  } catch {
    return false
  }
}

function boundedText(value, maxBytes, { optional = false } = {}) {
  if (value === null && optional) return null
  if (typeof value !== 'string') return null
  let printable = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    printable += code <= 31 || code === 127 ? ' ' : character
  }
  const cleaned = printable.replace(/\s+/g, ' ').trim()
  if (!cleaned) return optional ? null : null
  let result = ''
  for (const character of cleaned) {
    if (ENCODER.encode(result + character).byteLength > maxBytes) break
    result += character
  }
  return result || (optional ? null : null)
}

function validSlotIdentity(kind, primary) {
  if (kind === 'custom') return validRouteIdentity('event', primary) && primary.startsWith('c|')
  if (kind === 'event') return validRouteIdentity('event', primary) && primary.startsWith('e|')
  return kind === 'place' && validRouteIdentity('place', primary)
}

function normalizeSlot(value) {
  if (!exactFields(value, ['part', 'kind', 'primary', 'title', 'time', 'venue'])) return null
  if (!SLOT_PARTS.includes(value.part)
      || !SLOT_KINDS.includes(value.kind)
      || !validSlotIdentity(value.kind, value.primary)) return null
  const title = boundedText(value.title, 240)
  const time = boundedText(value.time, 64, { optional: true })
  const venue = boundedText(value.venue, 240, { optional: true })
  if (!title || (value.time !== null && !time) || (value.venue !== null && !venue)) return null
  return Object.freeze({
    part: value.part,
    kind: value.kind,
    primary: value.primary,
    title,
    time,
    venue,
  })
}

export function normalizePlanCapsule(value, { cityId = null, timeZone = null } = {}) {
  if (!exactFields(value, ['v', 'cityId', 'timeZone', 'day', 'slots'])
      || value.v !== PLAN_CAPSULE_VERSION
      || typeof value.cityId !== 'string'
      || !CITY_ID_RE.test(value.cityId)
      || !validTimeZone(value.timeZone)
      || !validDay(value.day)
      || !Array.isArray(value.slots)
      || value.slots.length === 0
      || value.slots.length > PLAN_CAPSULE_MAX_SLOTS
      || (cityId !== null && value.cityId !== cityId)
      || (timeZone !== null && value.timeZone !== timeZone)) return null

  const slots = value.slots.map(normalizeSlot)
  if (slots.some((slot) => slot === null)) return null
  const parts = slots.map((slot) => slot.part)
  const primaries = slots.map((slot) => slot.primary)
  if (new Set(parts).size !== parts.length || new Set(primaries).size !== primaries.length) return null
  slots.sort((left, right) => SLOT_PARTS.indexOf(left.part) - SLOT_PARTS.indexOf(right.part))
  const capsule = {
    v: PLAN_CAPSULE_VERSION,
    cityId: value.cityId,
    timeZone: value.timeZone,
    day: value.day,
    slots: Object.freeze(slots),
  }
  if (jsonBytes(capsule) > PLAN_CAPSULE_MAX_BYTES) return null
  return Object.freeze(capsule)
}

function sanitizedSlot(value) {
  if (!isObject(value)) return null
  const kind = value.kind === 'custom' ? 'custom' : value.kind === 'place' ? 'place' : 'event'
  return normalizeSlot({
    part: value.part,
    kind,
    primary: value.primary,
    title: boundedText(value.title ?? value.name, 240),
    time: boundedText(value.time ?? value.timeLabel, 64, { optional: true }),
    venue: boundedText(value.venue, 240, { optional: true }),
  })
}

/** Build a canonical capsule while discarding every field outside the allowlist. */
export function createPlanCapsule({ cityId, timeZone, day, slots } = {}) {
  if (!Array.isArray(slots) || slots.length === 0 || slots.length > PLAN_CAPSULE_MAX_SLOTS) {
    throw new TypeError('shared plan requires one to three slots')
  }
  const sanitized = slots.map(sanitizedSlot)
  if (sanitized.some((slot) => slot === null)) throw new TypeError('shared plan contains an invalid slot')
  const capsule = normalizePlanCapsule({
    v: PLAN_CAPSULE_VERSION,
    cityId,
    timeZone,
    day,
    slots: sanitized,
  })
  if (!capsule) throw new TypeError('shared plan capsule is invalid')
  return capsule
}

function base64UrlEncode(value) {
  const octets = ENCODER.encode(value)
  let binary = ''
  for (const octet of octets) binary += String.fromCharCode(octet)
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  try {
    const binary = globalThis.atob(padded)
    const octets = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return DECODER.decode(octets)
  } catch {
    return null
  }
}

export function encodePlanCapsule(value) {
  const capsule = normalizePlanCapsule(value)
  if (!capsule) throw new TypeError('shared plan capsule is invalid')
  return base64UrlEncode(JSON.stringify(capsule))
}

export function planCapsuleFragment(value) {
  const fragment = `#${PLAN_CAPSULE_FRAGMENT_KEY}=${encodePlanCapsule(value)}`
  if (ENCODER.encode(fragment).byteLength > PLAN_CAPSULE_MAX_FRAGMENT_BYTES) {
    throw new TypeError('shared plan fragment is too large')
  }
  return fragment
}

function failure(code) {
  return Object.freeze({
    ok: false,
    code,
    mode: 'read-only',
    writable: false,
    capsule: null,
  })
}

/** Decode a fragment into a display-only capsule; never an import command. */
export function parsePlanCapsuleFragment(value, options = {}) {
  if (typeof value !== 'string'
      || ENCODER.encode(value).byteLength > PLAN_CAPSULE_MAX_FRAGMENT_BYTES) {
    return failure('PLAN_CAPSULE_FRAGMENT_INVALID')
  }
  const raw = value.replace(/^#/, '')
  if (/%(?![0-9a-f]{2})/i.test(raw)) return failure('PLAN_CAPSULE_FRAGMENT_INVALID')
  const params = new URLSearchParams(raw)
  if ([...params.keys()].some((key) => key !== PLAN_CAPSULE_FRAGMENT_KEY)
      || params.getAll(PLAN_CAPSULE_FRAGMENT_KEY).length !== 1) {
    return failure('PLAN_CAPSULE_FRAGMENT_INVALID')
  }
  const decoded = base64UrlDecode(params.get(PLAN_CAPSULE_FRAGMENT_KEY))
  if (decoded === null || ENCODER.encode(decoded).byteLength > PLAN_CAPSULE_MAX_BYTES) {
    return failure('PLAN_CAPSULE_PAYLOAD_INVALID')
  }
  let parsed
  try {
    parsed = JSON.parse(decoded)
  } catch {
    return failure('PLAN_CAPSULE_PAYLOAD_INVALID')
  }
  const capsule = normalizePlanCapsule(parsed, options)
  if (!capsule) return failure('PLAN_CAPSULE_PAYLOAD_INVALID')
  return Object.freeze({
    ok: true,
    code: 'PLAN_CAPSULE_READY',
    mode: 'read-only',
    writable: false,
    capsule,
  })
}
