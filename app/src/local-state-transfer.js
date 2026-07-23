// Pure export/import contract for Wuzup's supported retained local state.
//
// This module does not read or write localStorage. It validates a portable
// envelope, strips privacy/transient fields when building an export, and
// produces an ordered import plan that runtime providers may execute later.
// A persisted pre-import backup is mandatory because the independent stores
// cannot honestly pretend to be one cross-store transaction.

import {
  ACTIVITY_STATE_VERSION,
  normalizeActivityState,
} from './activity-state-core.js'
import {
  CUSTOM_EVENT_STATE_VERSION,
  normalizeCustomEventState,
} from './custom-event-state-core.js'
import { categoryById } from './categories.js'
import { normalizeCorrectionState } from './correction-state-core.js'
import { createIdentityIndex, resolveIdentity } from './identity.js'
import { PERSONAL_PROFILE_VERSION } from './personal-relevance.js'
import { PLANNER_VERSION, normalizePlannerDocument } from './planner-core.js'
import {
  SAVED_BEEN_STATE_VERSION,
  normalizeSavedBeenState,
} from './saved-been-state-core.js'
import { fmtLocale } from './city.js'

export const LOCAL_STATE_TRANSFER_VERSION = 1
export const LOCAL_STATE_SECTION_VERSION = 1
export const LOCAL_STATE_BACKUP_VERSION = 1
export const LOCAL_STATE_IMPORT_PLAN_VERSION = 1
export const LOCAL_STATE_TRANSFER_FORMAT = 'wuzup-local-state'
export const LOCAL_STATE_TRANSFER_MAX_BYTES = 8 * 1024 * 1024

const KIB = 1024
const MIB = 1024 * KIB
const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TIME_ZONE_RE = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/
const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,159}$/i
const ENCODER = new TextEncoder()
const SECTION_NAMES = Object.freeze([
  'customEvents',
  'corrections',
  'planner',
  'savedBeen',
  'activity',
  'taste',
  'primer',
  'searchRecents',
])

export const LOCAL_STATE_SECTION_CONTRACTS = Object.freeze({
  customEvents: Object.freeze({ stateVersion: CUSTOM_EVENT_STATE_VERSION, maxBytes: 2 * MIB }),
  corrections: Object.freeze({ stateVersion: 1, maxBytes: 512 * KIB }),
  planner: Object.freeze({ stateVersion: PLANNER_VERSION, maxBytes: 3 * MIB }),
  savedBeen: Object.freeze({ stateVersion: SAVED_BEEN_STATE_VERSION, maxBytes: 3 * MIB }),
  activity: Object.freeze({ stateVersion: ACTIVITY_STATE_VERSION, maxBytes: 2 * MIB }),
  taste: Object.freeze({ stateVersion: PERSONAL_PROFILE_VERSION, maxBytes: 128 * KIB }),
  primer: Object.freeze({ stateVersion: 1, maxBytes: 8 * KIB }),
  searchRecents: Object.freeze({ stateVersion: 1, maxBytes: 32 * KIB }),
})

export const LOCAL_STATE_IMPORT_ORDER = Object.freeze([
  'globalProfile',
  'customEvents',
  'corrections',
  'planner',
  'savedBeen',
  'activity',
  'taste',
  'primer',
  'searchRecents',
])

const FORBIDDEN_FIELDS = new Set([
  'proto',
  'prototype',
  'constructor',
  'cache',
  'weather',
  'weathercache',
  'wx',
  'coordinates',
  'coords',
  'currentcoordinates',
  'usercoordinates',
  'geolocation',
  'locationpermission',
  'permissionstate',
  'latitude',
  'longitude',
  'lat',
  'lng',
])

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

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 80 || !TIME_ZONE_RE.test(value)) return false
  try {
    return new Intl.DateTimeFormat(fmtLocale, { timeZone: value }).resolvedOptions().timeZone === value
  } catch {
    return false
  }
}

function validCity(city) {
  return exactFields(city, ['id', 'timeZone'])
    && typeof city.id === 'string'
    && CITY_ID_RE.test(city.id)
    && validTimeZone(city.timeZone)
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function forbiddenField(key) {
  return FORBIDDEN_FIELDS.has(String(key).replace(/[-_\s]/g, '').toLowerCase())
}

function hasForbiddenField(value, state = { nodes: 0, seen: new WeakSet() }, depth = 0) {
  if (depth > 16 || state.nodes > 100_000) return true
  if (value === null || typeof value !== 'object') return false
  if (state.seen.has(value)) return true
  state.seen.add(value)
  state.nodes += 1
  try {
    if (Array.isArray(value)) {
      return value.some((item) => hasForbiddenField(item, state, depth + 1))
    }
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenField(key) || hasForbiddenField(child, state, depth + 1)) return true
    }
    return false
  } finally {
    state.seen.delete(value)
  }
}

function sanitizeValue(value, state = { nodes: 0, seen: new WeakSet() }, depth = 0) {
  if (depth > 16 || state.nodes > 100_000) throw new TypeError('state section is too complex')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('state section contains a non-finite number')
    return value
  }
  if (!value || typeof value !== 'object' || state.seen.has(value)) {
    throw new TypeError('state section must be acyclic JSON')
  }
  state.seen.add(value)
  state.nodes += 1
  try {
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, state, depth + 1))
    const out = {}
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenField(key)) continue
      out[key] = sanitizeValue(child, state, depth + 1)
    }
    return out
  } finally {
    state.seen.delete(value)
  }
}

function profileText(value, maxLength) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') throw new TypeError('global profile text must be a string')
  return value.trim().slice(0, maxLength)
}

function normalizeGlobalProfile(value) {
  if (!exactFields(value, ['v', 'name', 'bio'])
      || value.v !== 1
      || typeof value.name !== 'string'
      || typeof value.bio !== 'string'
      || value.name.length > 40
      || value.bio.length > 120
      || jsonBytes(value) > 16 * KIB) return null
  return Object.freeze({ v: 1, name: value.name, bio: value.bio })
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function exactScoreMap(value) {
  if (!isObject(value) || Object.keys(value).length > 128) return false
  return Object.entries(value).every(([key, score]) => (
    key.length > 0
    && key.length <= 80
    && !['__proto__', 'prototype', 'constructor'].includes(key)
    && Number.isFinite(score)
    && score > 0
    && score <= 25
  ))
}

function exactStringSet(value, { categoriesOnly = false } = {}) {
  return Array.isArray(value)
    && value.length <= 32
    && value.every((item) => typeof item === 'string'
      && item.length > 0
      && item.length <= 80
      && (!categoriesOnly || hasOwn(categoryById, item)))
    && new Set(value).size === value.length
}

function validTasteAnswers(value) {
  if (value === null) return true
  return exactFields(value, [
    'cats', 'indoorOutdoor', 'free', 'energy', 'company', 'dayparts', 'explore',
  ])
    && exactStringSet(value.cats, { categoriesOnly: true })
    && [null, 'indoor', 'outdoor'].includes(value.indoorOutdoor)
    && [null, true, false].includes(value.free)
    && [null, 'chill', 'wild'].includes(value.energy)
    && [null, 'solo', 'social'].includes(value.company)
    && (value.dayparts === null || typeof value.dayparts === 'string')
    && (value.explore === null || Number.isFinite(value.explore)
      && value.explore >= 0 && value.explore <= 1)
}

function validTasteInterview(value) {
  if (value === null) return true
  return exactFields(value, ['deltas', 'free', 'n', 'exploreSet', 'dayparts', 'answers'])
    && exactScoreMap(value.deltas)
    && Number.isFinite(value.free) && value.free >= 0 && value.free <= 25
    && Number.isInteger(value.n) && value.n >= 0 && value.n <= 5
    && typeof value.exploreSet === 'boolean'
    && (value.dayparts === null || typeof value.dayparts === 'string')
    && validTasteAnswers(value.answers)
}

function validTastePrimer(value) {
  if (value === null) return true
  return exactFields(value, ['deltas', 'free', 'n'])
    && exactScoreMap(value.deltas)
    && Number.isFinite(value.free) && value.free >= 0 && value.free <= 25
    && Number.isInteger(value.n) && value.n >= 0 && value.n <= 3
}

function validTasteDocument(data) {
  if (!exactFields(data, [
    'catScores', 'avoidScores', 'freeAffinity', 'n', 'organicN', 'explore',
    '_interview', '_primer', 'prefs', 'v',
  ])
      || data.v !== PERSONAL_PROFILE_VERSION
      || !exactScoreMap(data.catScores)
      || !exactScoreMap(data.avoidScores)
      || !Number.isFinite(data.freeAffinity)
      || data.freeAffinity < 0
      || data.freeAffinity > 25
      || !Number.isInteger(data.n)
      || data.n < 0
      || !Number.isInteger(data.organicN)
      || data.organicN < 0
      || data.organicN > data.n
      || !Number.isFinite(data.explore)
      || data.explore < 0
      || data.explore > 1
      || !validTasteInterview(data._interview)
      || !validTastePrimer(data._primer)
      || !exactFields(data.prefs, ['boost', 'mute', 'when'])
      || !exactStringSet(data.prefs.boost, { categoriesOnly: true })
      || !exactStringSet(data.prefs.mute, { categoriesOnly: true })
      || data.prefs.boost.some((item) => data.prefs.mute.includes(item))
      || ![null, 'weeknights', 'weekends', 'whenever'].includes(data.prefs.when)) return false
  return true
}

function validPrimerDocument(data) {
  if (!isObject(data)
      || data.v !== 1
      || Object.keys(data).some((key) => !['v', 'done', 'skipped', 'when'].includes(key))) return false
  const done = data.done === true
  const skipped = data.skipped === true
  return done !== skipped
    && (data.when === undefined || data.when === null
      || ['weeknights', 'weekends', 'whenever'].includes(data.when))
}

function validSearchRecents(data) {
  if (!exactFields(data, ['v', 'items']) || data.v !== 1
      || !Array.isArray(data.items) || data.items.length > 8) return false
  const seen = new Set()
  for (const value of data.items) {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 80) return false
    const folded = value.toLowerCase()
    if (seen.has(folded)) return false
    seen.add(folded)
  }
  return true
}

function validCorrectionTransfer(data, city) {
  if (!exactFields(data, ['v', 'cityId', 'corrections'])
      || data.v !== 1
      || data.cityId !== city.id) return false
  const normalized = normalizeCorrectionState({
    version: data.v,
    cityId: data.cityId,
    corrections: data.corrections,
  }, city.id)
  return normalized !== null && sameJson(normalized.corrections, data.corrections)
}

function strictSectionDocument(name, data, city) {
  try {
    if (name === 'customEvents') {
      const normalized = normalizeCustomEventState(data, { cityId: city.id, timeZone: city.timeZone })
      return normalized !== null && sameJson(sanitizeValue(normalized), data)
    }
    if (name === 'planner') return sameJson(normalizePlannerDocument(data), data)
    if (name === 'savedBeen') {
      const normalized = normalizeSavedBeenState(data, { cityId: city.id })
      return normalized !== null && sameJson(normalized, data)
    }
    if (name === 'activity') {
      const normalized = normalizeActivityState(data, { cityId: city.id })
      return normalized !== null && sameJson(normalized, data)
    }
    if (name === 'taste') return validTasteDocument(data)
    if (name === 'primer') return validPrimerDocument(data)
    if (name === 'searchRecents') return validSearchRecents(data)
    if (name === 'corrections') return validCorrectionTransfer(data, city)
    return false
  } catch {
    return false
  }
}

function normalizeSection(name, value, city) {
  const contract = LOCAL_STATE_SECTION_CONTRACTS[name]
  if (!contract
      || !exactFields(value, ['v', 'stateVersion', 'cityId', 'timeZone', 'data'])
      || value.v !== LOCAL_STATE_SECTION_VERSION
      || value.stateVersion !== contract.stateVersion
      || value.cityId !== city.id
      || value.timeZone !== city.timeZone
      || !strictSectionDocument(name, value.data, city)
      || hasForbiddenField(value.data)
      || jsonBytes(value) > contract.maxBytes) return null
  return Object.freeze({
    v: LOCAL_STATE_SECTION_VERSION,
    stateVersion: contract.stateVersion,
    cityId: city.id,
    timeZone: city.timeZone,
    data: value.data,
  })
}

function normalizeSections(value, city) {
  if (!exactFields(value, SECTION_NAMES)) return null
  const out = {}
  for (const name of SECTION_NAMES) {
    if (value[name] === null) {
      out[name] = null
      continue
    }
    const section = normalizeSection(name, value[name], city)
    if (!section) return null
    out[name] = section
  }
  return Object.freeze(out)
}

export function normalizeLocalStateBundle(value, {
  expectedCityId = null,
  expectedTimeZone = null,
} = {}) {
  if (!exactFields(value, [
    'format', 'v', 'exportedAt', 'activeCity', 'globalProfile', 'cityState',
  ])
      || value.format !== LOCAL_STATE_TRANSFER_FORMAT
      || value.v !== LOCAL_STATE_TRANSFER_VERSION
      || !validTime(value.exportedAt)
      || !validCity(value.activeCity)
      || !exactFields(value.cityState, ['cityId', 'timeZone', 'sections'])
      || value.cityState.cityId !== value.activeCity.id
      || value.cityState.timeZone !== value.activeCity.timeZone
      || (expectedCityId !== null && value.activeCity.id !== expectedCityId)
      || (expectedTimeZone !== null && value.activeCity.timeZone !== expectedTimeZone)
      || jsonBytes(value) > LOCAL_STATE_TRANSFER_MAX_BYTES) return null

  const globalProfile = normalizeGlobalProfile(value.globalProfile)
  const sections = normalizeSections(value.cityState.sections, value.activeCity)
  if (!globalProfile || !sections) return null
  return Object.freeze({
    format: LOCAL_STATE_TRANSFER_FORMAT,
    v: LOCAL_STATE_TRANSFER_VERSION,
    exportedAt: value.exportedAt,
    activeCity: Object.freeze({ ...value.activeCity }),
    globalProfile,
    cityState: Object.freeze({
      cityId: value.activeCity.id,
      timeZone: value.activeCity.timeZone,
      sections,
    }),
  })
}

function buildSection(name, data, city) {
  if (data === null || data === undefined) return null
  const sanitized = sanitizeValue(name === 'searchRecents' && Array.isArray(data)
    ? { v: 1, items: data }
    : data)
  const contract = LOCAL_STATE_SECTION_CONTRACTS[name]
  const section = {
    v: LOCAL_STATE_SECTION_VERSION,
    stateVersion: contract.stateVersion,
    cityId: city.id,
    timeZone: city.timeZone,
    data: sanitized,
  }
  if (!normalizeSection(name, section, city)) throw new TypeError(`invalid ${name} state section`)
  return section
}

/** Build a privacy-bounded bundle from already-read logical store documents. */
export function createLocalStateBundle({
  exportedAt,
  activeCity,
  globalProfile = {},
  sections = {},
} = {}) {
  if (!validCity(activeCity) || !validTime(exportedAt) || !isObject(sections)) {
    throw new TypeError('local state export context is invalid')
  }
  const unknown = Object.keys(sections).filter((name) => !SECTION_NAMES.includes(name))
  if (unknown.length > 0) throw new TypeError(`unsupported state section '${unknown[0]}'`)
  const builtSections = {}
  for (const name of SECTION_NAMES) builtSections[name] = buildSection(name, sections[name], activeCity)
  const bundle = {
    format: LOCAL_STATE_TRANSFER_FORMAT,
    v: LOCAL_STATE_TRANSFER_VERSION,
    exportedAt,
    activeCity: { id: activeCity.id, timeZone: activeCity.timeZone },
    globalProfile: {
      v: 1,
      name: profileText(globalProfile.name, 40),
      bio: profileText(globalProfile.bio, 120),
    },
    cityState: {
      cityId: activeCity.id,
      timeZone: activeCity.timeZone,
      sections: builtSections,
    },
  }
  const normalized = normalizeLocalStateBundle(bundle)
  if (!normalized) throw new TypeError('local state export exceeds its contract')
  return normalized
}

export function serializeLocalStateBundle(value) {
  const bundle = normalizeLocalStateBundle(value)
  if (!bundle) throw new TypeError('local state bundle is invalid')
  return JSON.stringify(bundle)
}

function parseFailure(code) {
  return Object.freeze({ ok: false, code, bundle: null })
}

export function parseLocalStateBundle(raw, options = {}) {
  if (typeof raw !== 'string' || ENCODER.encode(raw).byteLength > LOCAL_STATE_TRANSFER_MAX_BYTES) {
    return parseFailure('STATE_BUNDLE_TOO_LARGE')
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return parseFailure('STATE_BUNDLE_INVALID_JSON')
  }
  const bundle = normalizeLocalStateBundle(parsed, options)
  return bundle
    ? Object.freeze({ ok: true, code: 'STATE_BUNDLE_READY', bundle })
    : parseFailure('STATE_BUNDLE_INVALID')
}

const VERIFIED_BACKUP_RECEIPTS = new WeakSet()
const VERIFIED_IMPORT_PLANS = new WeakMap()
const VERIFIED_IMPORT_OUTCOMES = new WeakMap()

function backupChecksum(raw) {
  let left = 2166136261
  let right = 2246822519
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    left ^= code
    left = Math.imul(left, 16777619)
    right ^= code + index
    right = Math.imul(right, 3266489917)
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Mint an in-session import capability only after exact backup bytes were read
 * back from durable storage. A structurally similar caller object is rejected.
 */
export function verifyPersistedLocalStateBackup({
  backupId,
  createdAt,
  sourceRaw,
  persistedRaw,
  expectedCityId,
  expectedTimeZone,
} = {}) {
  if (typeof sourceRaw !== 'string'
      || persistedRaw !== sourceRaw
      || typeof backupId !== 'string'
      || !ID_RE.test(backupId)
      || !validTime(createdAt)) return null
  const parsed = parseLocalStateBundle(sourceRaw, { expectedCityId, expectedTimeZone })
  if (!parsed.ok) return null
  const receipt = Object.freeze({
    v: LOCAL_STATE_BACKUP_VERSION,
    status: 'persisted',
    backupId,
    createdAt,
    cityId: parsed.bundle.activeCity.id,
    timeZone: parsed.bundle.activeCity.timeZone,
    bytes: ENCODER.encode(sourceRaw).byteLength,
    checksum: backupChecksum(sourceRaw),
  })
  VERIFIED_BACKUP_RECEIPTS.add(receipt)
  return receipt
}

function validBackupReceipt(value, city) {
  return exactFields(value, [
    'v', 'status', 'backupId', 'createdAt', 'cityId', 'timeZone', 'bytes', 'checksum',
  ])
    && value.v === LOCAL_STATE_BACKUP_VERSION
    && value.status === 'persisted'
    && typeof value.backupId === 'string'
    && ID_RE.test(value.backupId)
    && validTime(value.createdAt)
    && value.cityId === city.id
    && value.timeZone === city.timeZone
    && Number.isSafeInteger(value.bytes)
    && value.bytes > 0
    && typeof value.checksum === 'string'
    && /^[0-9a-f]{16}$/.test(value.checksum)
    && VERIFIED_BACKUP_RECEIPTS.has(value)
}

function freezeJson(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item)
  } else {
    for (const item of Object.values(value)) freezeJson(item)
  }
  return Object.freeze(value)
}

function frozenJsonClone(raw) {
  try {
    return freezeJson(JSON.parse(raw))
  } catch {
    return null
  }
}

function blockedImport(code, bundle, mode) {
  return Object.freeze({
    status: 'blocked',
    code,
    ready: false,
    requiresBackup: true,
    cityId: bundle?.activeCity?.id ?? null,
    timeZone: bundle?.activeCity?.timeZone ?? null,
    mode,
    steps: Object.freeze([]),
  })
}

function stepFor(section, bundle, mode, included) {
  const customIncluded = mode === 'replace' || bundle.cityState.sections.customEvents !== null
  const dependsOnCustom = section === 'planner' || section === 'savedBeen' || section === 'activity'
  return Object.freeze({
    id: `import-${section}`,
    scope: section === 'globalProfile' ? 'global' : 'city',
    section,
    operation: mode,
    hasPayload: included,
    dependsOn: Object.freeze(dependsOnCustom && customIncluded ? ['import-customEvents'] : []),
  })
}

function customEntries(document, city) {
  if (document === null || document === undefined) return []
  const normalized = normalizeCustomEventState(document, {
    cityId: city.id,
    timeZone: city.timeZone,
  })
  return normalized && sameJson(normalized, document) ? normalized.items : null
}

function plannerCustomRefs(document) {
  const refs = []
  const rows = [
    ...Object.values(document.active || {}),
    ...(Array.isArray(document.history) ? document.history : []),
  ]
  for (const row of rows) {
    for (const ref of Object.values(row?.slots || {})) {
      if (!isObject(ref)) continue
      if (ref.kind === 'custom' || String(ref.primary || '').startsWith('c|')) refs.push(ref)
    }
  }
  return refs
}

function validPlannerCustomGraph(bundle, { mode, currentCustomState }) {
  const planner = bundle.cityState.sections.planner?.data
  if (!planner) return true
  const city = bundle.activeCity
  const importedRaw = bundle.cityState.sections.customEvents?.data ?? null
  // Transfer custom documents omit private coordinates. Re-canonicalize them
  // before building the identity graph; the equality was already checked by
  // normalizeSection against its privacy-sanitized canonical form.
  const imported = importedRaw
    ? normalizeCustomEventState(importedRaw, { cityId: city.id, timeZone: city.timeZone })?.items ?? null
    : []
  if (imported === null) return false
  const current = mode === 'merge' ? customEntries(currentCustomState, city) : []
  if (current === null) return false

  const byPrimary = new Map()
  for (const entry of current || []) byPrimary.set(entry.primary, entry)
  for (const entry of imported) byPrimary.set(entry.primary, entry)
  const index = createIdentityIndex({ items: [...byPrimary.values()] })
  for (const ref of plannerCustomRefs(planner)) {
    const resolution = resolveIdentity(ref, index)
    if (resolution.status !== 'resolved') return false
  }
  return true
}

/**
 * Produce an executable ordering only after a same-city backup was persisted.
 * The returned object is an in-session capability: private metadata binds its
 * identity to exact canonical bundle bytes, runtime city, backup capability,
 * mode, and per-step payload fingerprints. A structural clone is inert.
 */
export function planLocalStateImport(value, {
  mode = 'merge',
  backupReceipt = null,
  currentCustomState = null,
  activeCity = null,
} = {}) {
  const normalized = normalizeLocalStateBundle(value)
  if (!normalized) return blockedImport('STATE_IMPORT_BUNDLE_INVALID', null, mode)
  if (!validCity(activeCity)
      || normalized.activeCity.id !== activeCity.id
      || normalized.activeCity.timeZone !== activeCity.timeZone) {
    return blockedImport('STATE_IMPORT_CITY_MISMATCH', normalized, mode)
  }
  const bundleRaw = serializeLocalStateBundle(normalized)
  const reparsed = parseLocalStateBundle(bundleRaw, {
    expectedCityId: activeCity.id,
    expectedTimeZone: activeCity.timeZone,
  })
  if (!reparsed.ok) return blockedImport('STATE_IMPORT_BUNDLE_INVALID', null, mode)
  const bundle = reparsed.bundle
  if (mode !== 'merge' && mode !== 'replace') return blockedImport('STATE_IMPORT_MODE_INVALID', bundle, mode)
  if (!validPlannerCustomGraph(bundle, { mode, currentCustomState })) {
    return blockedImport('STATE_IMPORT_PREFLIGHT_FAILED', bundle, mode)
  }
  if (!validBackupReceipt(backupReceipt, bundle.activeCity)) {
    return blockedImport('STATE_IMPORT_BACKUP_REQUIRED', bundle, mode)
  }

  const steps = []
  for (const section of LOCAL_STATE_IMPORT_ORDER) {
    const included = section === 'globalProfile' || bundle.cityState.sections[section] !== null
    if (mode === 'merge' && !included) continue
    steps.push(stepFor(section, bundle, mode, included))
  }
  const plan = Object.freeze({
    status: 'ready',
    code: 'STATE_IMPORT_READY',
    ready: true,
    requiresBackup: true,
    v: LOCAL_STATE_IMPORT_PLAN_VERSION,
    cityId: bundle.activeCity.id,
    timeZone: bundle.activeCity.timeZone,
    mode,
    backupId: backupReceipt.backupId,
    steps: Object.freeze(steps),
  })
  const privateSteps = new Map(steps.map((step) => {
    const payload = step.section === 'globalProfile'
      ? bundle.globalProfile
      : bundle.cityState.sections[step.section]?.data ?? null
    const payloadRaw = JSON.stringify(payload)
    return [step.id, Object.freeze({
      ...step,
      payloadRaw,
      payloadFingerprint: backupChecksum(payloadRaw),
    })]
  }))
  VERIFIED_IMPORT_PLANS.set(plan, Object.freeze({
    bundleRaw,
    bundleFingerprint: backupChecksum(bundleRaw),
    city: Object.freeze({ ...bundle.activeCity }),
    backupReceipt,
    mode,
    steps: privateSteps,
  }))
  return plan
}

/** Return a detached, deeply frozen payload only for a genuine plan step. */
export function importStepPayload(plan, stepId) {
  const metadata = VERIFIED_IMPORT_PLANS.get(plan)
  const step = metadata?.steps.get(stepId)
  return step ? frozenJsonClone(step.payloadRaw) : null
}

function canonicalStepState(section, raw, city) {
  if (typeof raw !== 'string' || ENCODER.encode(raw).byteLength > LOCAL_STATE_TRANSFER_MAX_BYTES) return null
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (JSON.stringify(value) !== raw) return null
  if (section === 'globalProfile') {
    const normalized = normalizeGlobalProfile(value)
    return normalized && sameJson(normalized, value) ? value : null
  }
  const contract = LOCAL_STATE_SECTION_CONTRACTS[section]
  return contract
    && ENCODER.encode(raw).byteLength <= contract.maxBytes
    && !hasForbiddenField(value)
    && strictSectionDocument(section, value, city)
    ? value
    : null
}

/**
 * Mint a plan-bound outcome. For applied/unchanged steps this proves exact
 * canonical persistence only: semantic merge correctness remains the owning
 * provider's responsibility and must be tested by that provider.
 */
export function verifyLocalStateImportOutcome(plan, value = {}) {
  const metadata = VERIFIED_IMPORT_PLANS.get(plan)
  if (!metadata || !isObject(value)) return null
  const step = metadata.steps.get(value.stepId)
  if (!step) return null

  let receipt
  let success = false
  if (value.status === 'applied' || value.status === 'unchanged') {
    const verifiedClear = metadata.mode === 'replace'
      && step.hasPayload === false
      && value.expectedRaw === 'null'
      && value.persistedRaw === 'null'
    if (!exactFields(value, ['stepId', 'status', 'expectedRaw', 'persistedRaw'])
        || typeof value.expectedRaw !== 'string'
        || value.persistedRaw !== value.expectedRaw
        || !verifiedClear
          && canonicalStepState(step.section, value.expectedRaw, metadata.city) === null
        || (metadata.mode === 'replace' && step.hasPayload && value.expectedRaw !== step.payloadRaw)) {
      return null
    }
    success = true
    receipt = Object.freeze({
      stepId: step.id,
      status: value.status,
      verified: true,
      bytes: ENCODER.encode(value.expectedRaw).byteLength,
      checksum: backupChecksum(value.expectedRaw),
    })
  } else if (value.status === 'failed' || value.status === 'skipped') {
    if (!exactFields(value, ['stepId', 'status', 'code'])
        || typeof value.code !== 'string'
        || !ID_RE.test(value.code)) return null
    receipt = Object.freeze({
      stepId: step.id,
      status: value.status,
      verified: false,
      code: value.code,
    })
  } else return null

  VERIFIED_IMPORT_OUTCOMES.set(receipt, Object.freeze({
    plan,
    stepId: step.id,
    success,
    status: receipt.status,
    bundleFingerprint: metadata.bundleFingerprint,
    payloadFingerprint: step.payloadFingerprint,
  }))
  return receipt
}

function aggregateFailure(code, extras = {}) {
  return Object.freeze({
    status: 'invalid',
    code,
    fullSuccess: false,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    ...extras,
  })
}

/** Summarize only genuine plan-bound receipts; structural claims are inert. */
export function aggregateLocalStateImport(plan, outcomes) {
  const planMetadata = VERIFIED_IMPORT_PLANS.get(plan)
  if (!planMetadata || !Array.isArray(outcomes)) {
    return aggregateFailure('STATE_IMPORT_OUTCOME_INVALID')
  }
  const byId = new Map()
  for (const result of outcomes) {
    const receipt = VERIFIED_IMPORT_OUTCOMES.get(result)
    if (!receipt
        || receipt.plan !== plan
        || !planMetadata.steps.has(receipt.stepId)
        || byId.has(receipt.stepId)) {
      return aggregateFailure('STATE_IMPORT_OUTCOME_INVALID')
    }
    byId.set(receipt.stepId, receipt)
  }

  let succeeded = 0
  let failed = 0
  let skipped = 0
  let pending = 0
  for (const step of plan.steps) {
    const result = byId.get(step.id)
    if (!result) {
      pending += 1
      continue
    }
    if (result.success) succeeded += 1
    else if (result.status === 'skipped') skipped += 1
    else failed += 1
  }

  if (pending > 0) {
    return Object.freeze({
      status: 'incomplete',
      code: 'STATE_IMPORT_INCOMPLETE',
      fullSuccess: false,
      succeeded,
      failed,
      skipped,
      pending,
    })
  }
  if (failed > 0) {
    return Object.freeze({
      status: succeeded > 0 ? 'partial' : 'failed',
      code: succeeded > 0 ? 'STATE_IMPORT_PARTIAL' : 'STATE_IMPORT_FAILED',
      fullSuccess: false,
      succeeded,
      failed,
      skipped,
      pending: 0,
    })
  }
  return Object.freeze({
    status: 'complete',
    code: 'STATE_IMPORT_COMPLETE',
    fullSuccess: true,
    succeeded,
    failed: 0,
    skipped: 0,
    pending: 0,
  })
}
