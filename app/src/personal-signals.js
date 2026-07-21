// personal-signals.js — one truthful handoff from retained product actions to
// the bounded on-device taste model.
//
// Saved/Been, Planner, and Activity remain the owners of durable product
// state. This module owns no storage and never invents a second history.
// It accepts only an exact successful provider result, projects a small stable
// piece of preference evidence, and applies that evidence at most once per
// signal family/item/city during the current session. The injected gate keeps
// the contract deterministic in Node; the singleton at the bottom is only the
// browser adapter to taste.js.
import { activityRefOf } from './activity-state-core.js'
import { CITY } from './city.js'
import { recordCalibration, recordSignal } from './taste.js'

export const PERSONAL_SIGNAL_VERSION = 1
export const PERSONAL_SIGNAL_SESSION_CAP = 256

const CITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SIGNAL_TYPES = new Set(['open', 'save', 'plan', 'went', 'deck-yes', 'deck-no'])
const DAYPARTS = new Set(['morning', 'afternoon', 'night'])
const DURABILITIES = new Set(['durable', 'session-only'])
const MAX_LABEL_LENGTH = 160
const MAX_ACTIVITY_COUNT = 8
const MAX_ACTIVITY_SCAN = 32

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasControl = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function boundedLabel(value) {
  if (typeof value !== 'string') return null
  const label = value.trim()
  return label.length > 0
    && label.length <= MAX_LABEL_LENGTH
    && !hasControl(label)
    && !['__proto__', 'prototype', 'constructor'].includes(label)
    ? label
    : null
}

function safeItemFacts(item) {
  try {
    const activities = []
    const seen = new Set()
    const groups = [
      typeof item.activity === 'string' ? [item.activity] : [],
      item.activityIds,
      item.activities,
      item.amenities,
    ]
    let scanned = 0
    for (const group of groups) {
      if (!Array.isArray(group)) continue
      for (const value of group) {
        if (scanned >= MAX_ACTIVITY_SCAN || activities.length >= MAX_ACTIVITY_COUNT) break
        scanned += 1
        const activity = boundedLabel(value)
        if (!activity || seen.has(activity)) continue
        seen.add(activity)
        activities.push(activity)
      }
      if (scanned >= MAX_ACTIVITY_SCAN || activities.length >= MAX_ACTIVITY_COUNT) break
    }
    return {
      category: boundedLabel(item.category),
      placeType: boundedLabel(item.placeType),
      activityIds: Object.freeze(activities),
      isFree: item.isFree === true || item._free === true
        ? true
        : item.isFree === false || item._free === false
          ? false
          : null,
    }
  } catch {
    return null
  }
}

function contextProjection(context) {
  if (!isObject(context)) return null
  try {
    const out = {}
    if (DAYPARTS.has(context.daypart)) out.daypart = context.daypart
    if (context.distanceObserved === true
        && typeof context.distanceMiles === 'number'
        && Number.isFinite(context.distanceMiles)
        && context.distanceMiles >= 0
        && context.distanceMiles <= 500) {
      out.distanceMiles = Math.round(context.distanceMiles * 10) / 10
    }
    if (context.weatherObserved === true) {
      const weather = boundedLabel(context.weather)
      if (weather) out.weather = weather
    }
    return Object.keys(out).length > 0 ? Object.freeze(out) : null
  } catch {
    return null
  }
}

function signalFamily(type) {
  return type === 'deck-yes' || type === 'deck-no' ? 'deck' : type
}

/**
 * Project only bounded, inspectable evidence. Stable identity comes from the
 * same retained identity seam Activity uses, so aliases/custom rows/places do
 * not acquire a second identity system here.
 */
export function projectPersonalEvidence(type, item, {
  cityId = CITY.id,
  context = null,
} = {}) {
  if (!SIGNAL_TYPES.has(type)
      || typeof cityId !== 'string'
      || !CITY_ID_RE.test(cityId)
      || !isObject(item)) return null

  let forcedKind
  try {
    forcedKind = item.kind === 'place' ? 'place' : 'event'
  } catch {
    return null
  }
  const ref = activityRefOf(item, { kind: forcedKind })
  const facts = safeItemFacts(item)
  if (!ref || ref.status !== 'attached' || !facts) return null

  const projectedContext = contextProjection(context)
  return Object.freeze({
    v: PERSONAL_SIGNAL_VERSION,
    type,
    family: signalFamily(type),
    cityId,
    kind: ref.kind,
    primary: ref.primary,
    category: facts.category,
    placeType: facts.placeType,
    activityIds: facts.activityIds,
    isFree: facts.isFree,
    ...(projectedContext ? { context: projectedContext } : {}),
  })
}

function persistenceTruth(result) {
  if (!DURABILITIES.has(result?.durability) || typeof result?.persisted !== 'boolean') return null
  if (result.persisted !== (result.durability === 'durable')) return null
  return Object.freeze({
    persisted: result.persisted,
    durability: result.durability,
  })
}

/**
 * Validate the exact product mutation that makes a preference signal honest.
 * A provider no-op is not a fresh signal, even if its product state is valid.
 */
export function validateSignalMutation(type, result, { source } = {}) {
  if (!SIGNAL_TYPES.has(type) || !isObject(result)) return null
  const persistence = persistenceTruth(result)
  if (!persistence) return null

  let accepted = false
  if (source === 'activity') {
    accepted = result.applied === true
      && result.changed === true
      && result.code === 'recorded'
  } else if (source === 'saved-been' && type === 'save') {
    accepted = result.changed === true
      && result.applied === true
      && result.code === 'saved'
      && result.saved === true
  } else if (source === 'saved-been' && type === 'went') {
    accepted = result.changed === true
      && result.applied === true
      && result.code === 'marked-been'
      && result.status === 'went'
  } else if (source === 'planner' && type === 'plan') {
    accepted = result.changed === true && result.code === 'added' && !result.conflict
  }
  return accepted ? persistence : null
}

// `already-current` is only trustworthy as a continuation of work this exact
// gate instance began. It is deliberately rejected by validateSignalMutation
// above so a persisted Activity row cannot be replayed after reload to farm
// preference. capture() admits this shape only when its bounded pending ledger
// contains the exact failed deck write.
function validateActivityRetry(type, result, { source } = {}) {
  if ((type !== 'deck-yes' && type !== 'deck-no')
      || source !== 'activity'
      || !isObject(result)) return null
  const persistence = persistenceTruth(result)
  return persistence
    && result.applied === true
    && result.changed === false
    && result.code === 'already-current'
    ? persistence
    : null
}

function publicResult({
  code,
  evidence = null,
  source = null,
  taste = null,
} = {}) {
  const applied = code === 'applied' || code === 'applied-session-only'
  return Object.freeze({
    ok: applied,
    code,
    applied,
    changed: applied,
    persisted: applied ? taste.persisted : false,
    durability: applied ? taste.durability : 'unknown',
    sourcePersisted: source?.persisted === true,
    sourceDurability: source?.durability || 'unknown',
    ...(evidence ? { evidence } : {}),
    ...(taste?.code ? { tasteCode: taste.code } : {}),
  })
}

function validTasteReceipt(value) {
  const persistence = persistenceTruth(value)
  return persistence
    && value.applied === true
    && value.changed === true
    && boundedLabel(value.code)
    ? { ...persistence, code: value.code }
    : null
}

/**
 * A bounded session ledger is farming resistance, not a persistence silo. It
 * stores only opaque keys in memory and is discarded on reload. Durable facts
 * remain in the existing provider documents; the taste writer reports its own
 * durable/session-only result separately.
 */
export function createPersonalSignalGate({
  apply,
  maxEntries = PERSONAL_SIGNAL_SESSION_CAP,
} = {}) {
  if (typeof apply !== 'function') throw new TypeError('apply must be a function')
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) {
    throw new TypeError('maxEntries must be an integer from 1 to 4096')
  }
  const seen = new Set()
  const order = []
  const pending = new Map()
  const pendingOrder = []

  const rememberPending = (key, type) => {
    if (pending.has(key)) {
      pending.set(key, type)
      return
    }
    pending.set(key, type)
    pendingOrder.push(key)
    if (pendingOrder.length > maxEntries) {
      pending.delete(pendingOrder.shift())
    }
  }

  const consumePending = (key) => {
    if (!pending.delete(key)) return
    const index = pendingOrder.indexOf(key)
    if (index >= 0) pendingOrder.splice(index, 1)
  }

  const capture = (type, item, {
    cityId = CITY.id,
    context = null,
    source,
    result,
  } = {}) => {
    let sourceTruth = validateSignalMutation(type, result, { source })
    const retryTruth = sourceTruth ? null : validateActivityRetry(type, result, { source })
    if (!sourceTruth && !retryTruth) return publicResult({ code: 'source-unavailable' })
    const evidence = projectPersonalEvidence(type, item, { cityId, context })
    if (!evidence) return publicResult({ code: 'invalid-evidence', source: sourceTruth || retryTruth })
    const key = `${evidence.cityId}\u0000${evidence.family}\u0000${evidence.kind}\u0000${evidence.primary}`
    if (seen.has(key)) return publicResult({ code: 'duplicate', evidence, source: sourceTruth || retryTruth })

    if (retryTruth) {
      // Keep both the shared deck family in the key and the exact verdict in
      // the value. A failed "less" cannot be turned into a fresh "more" by
      // swapping the caller's retry payload.
      if (pending.get(key) !== type) {
        return publicResult({ code: 'source-unavailable', evidence, source: retryTruth })
      }
      sourceTruth = retryTruth
    }

    let rawTaste
    try {
      rawTaste = apply(evidence)
    } catch {
      if (!retryTruth && source === 'activity' && evidence.family === 'deck') {
        rememberPending(key, type)
      }
      return publicResult({ code: 'taste-unavailable', evidence, source: sourceTruth })
    }
    const taste = validTasteReceipt(rawTaste)
    if (!taste) {
      if (!retryTruth && source === 'activity' && evidence.family === 'deck') {
        rememberPending(key, type)
      }
      return publicResult({ code: 'taste-unavailable', evidence, source: sourceTruth })
    }

    consumePending(key)
    seen.add(key)
    order.push(key)
    if (order.length > maxEntries) seen.delete(order.shift())
    return publicResult({
      code: taste.persisted ? 'applied' : 'applied-session-only',
      evidence,
      source: sourceTruth,
      taste,
    })
  }

  return Object.freeze({
    capture,
    size: () => seen.size,
  })
}

function applyTasteEvidence(evidence) {
  if (evidence.type === 'deck-yes') return recordCalibration('yes', evidence)
  if (evidence.type === 'deck-no') return recordCalibration('no', evidence)
  return recordSignal(evidence.type, evidence)
}

const runtimeGate = createPersonalSignalGate({ apply: applyTasteEvidence })

export function capturePersonalSignal(type, item, options) {
  return runtimeGate.capture(type, item, options)
}
