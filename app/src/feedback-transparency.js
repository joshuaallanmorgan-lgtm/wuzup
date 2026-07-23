// Pure contracts for the two deck surfaces. This module intentionally owns no
// storage or React state: callers inject each effect so tests can prove order,
// exact result admission, and retry behavior without rendering the app.
import { rankRuntimeItems } from './relevance.js'

const ACTIVITY_CODES = new Set(['recorded', 'already-current'])
const DURABILITY = new Set(['durable', 'session-only'])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export function exactActivityApplied(result) {
  if (!isObject(result)
      || result.applied !== true
      || !ACTIVITY_CODES.has(result.code)
      || !DURABILITY.has(result.durability)
      || typeof result.persisted !== 'boolean'
      || result.persisted !== (result.durability === 'durable')) return false
  return result.code === 'recorded'
    ? result.changed === true
    : result.changed === false
}

export function exactPersonalSignalApplied(result, { expectedEvidence = null } = {}) {
  if (!isObject(result)) return false
  const evidenceMatches = !isObject(expectedEvidence) || (
    isObject(result.evidence)
    && ['cityId', 'family', 'kind', 'primary'].every((key) => (
      result.evidence[key] === expectedEvidence[key]
    ))
  )
  const signalPersistenceMatches = result.code === 'applied'
    ? result.durability === 'durable' && result.persisted === true
    : result.code === 'applied-session-only'
      && result.durability === 'session-only'
      && result.persisted === false
  if (result.applied === true
      && result.changed === true
      && ['applied', 'applied-session-only'].includes(result.code)
      && DURABILITY.has(result.durability)
      && typeof result.persisted === 'boolean'
      && signalPersistenceMatches
      && evidenceMatches) return true
  if (result.code !== 'duplicate'
      || result.applied !== false
      || result.changed !== false
      || !isObject(result.evidence)
      || !isObject(expectedEvidence)) return false
  return evidenceMatches
}

export function exactSaveApplied(result) {
  return isObject(result)
    && result.applied === true
    && result.changed === true
    && result.saved === true
    && result.code === 'saved'
    && DURABILITY.has(result.durability)
    && typeof result.persisted === 'boolean'
    && result.persisted === (result.durability === 'durable')
}

function durabilityOf(results) {
  return results.some((result) => result?.durability === 'session-only')
    ? 'session-only'
    : results.some((result) => result?.durability === 'durable') ? 'durable' : 'unknown'
}

function rejected(action, stage, result, extra = {}) {
  return Object.freeze({ applied: false, action, stage, result, ...extra })
}

async function safely(effect) {
  try {
    return await effect()
  } catch (error) {
    return { applied: false, changed: false, code: 'effect-threw', error }
  }
}

/**
 * Commit one explicit calibration verdict.
 *
 * Save is deliberately save-first: a failed save must never write the deck
 * exclusion that would make its card disappear on reopen. Saves already emit
 * their positive signal at the save seam, so pre-saved and save-retry cards do
 * not manufacture another taste signal here.
 */
export async function commitCalibrationVerdict({
  action,
  alreadySaved = false,
  save,
  retain,
  signal,
  expectedEvidence = null,
} = {}) {
  if (!['yes', 'no', 'save'].includes(action) || typeof retain !== 'function') {
    return rejected(action || 'unknown', 'input', null)
  }

  let saveResult = null
  if (action === 'save' && !alreadySaved) {
    if (typeof save !== 'function') return rejected(action, 'save', null)
    saveResult = await safely(save)
    if (!exactSaveApplied(saveResult)) return rejected(action, 'save', saveResult)
  }

  const activityResult = await safely(retain)
  if (!exactActivityApplied(activityResult)) {
    return rejected(action, 'activity', activityResult, {
      saveApplied: exactSaveApplied(saveResult),
      saveResult,
    })
  }

  let tasteResult = null
  if (action !== 'save') {
    if (typeof signal !== 'function') return rejected(action, 'taste', null)
    tasteResult = await safely(() => signal(activityResult))
    if (!exactPersonalSignalApplied(tasteResult, { expectedEvidence })) {
      return rejected(action, 'taste', tasteResult, { activityResult })
    }
  }

  return Object.freeze({
    applied: true,
    action,
    stage: 'complete',
    saveApplied: exactSaveApplied(saveResult),
    saveResult,
    activityResult,
    tasteResult,
    durability: durabilityOf([saveResult, activityResult, tasteResult].filter(Boolean)),
  })
}

/** Keep in a lens saves once; skipping/opening carry no negative taste signal. */
export async function commitLensChoice({ action, alreadySaved = false, save } = {}) {
  if (action === 'skip' || action === 'open') {
    return Object.freeze({ applied: true, action, stage: 'complete', durability: 'unchanged' })
  }
  if (action !== 'keep') return rejected(action || 'unknown', 'input', null)
  if (alreadySaved) {
    return Object.freeze({ applied: true, action, stage: 'complete', durability: 'unchanged' })
  }
  if (typeof save !== 'function') return rejected(action, 'save', null)
  const saveResult = await safely(save)
  if (!exactSaveApplied(saveResult)) return rejected(action, 'save', saveResult)
  return Object.freeze({
    applied: true,
    action,
    stage: 'complete',
    saveApplied: true,
    saveResult,
    durability: saveResult.durability || 'unknown',
  })
}

export function deckFeedback(result, { surface = 'calibration' } = {}) {
  if (result?.applied === true) {
    if (result.durability === 'session-only') {
      return Object.freeze({
        tone: 'notice',
        text: 'Applied for this session. Device storage still needs another try.',
      })
    }
    return null
  }
  if (result?.stage === 'save') {
    return Object.freeze({ tone: 'error', text: 'Could not save this yet. The same card is ready to retry.' })
  }
  if (result?.stage === 'activity' && result?.saveApplied === true) {
    return Object.freeze({ tone: 'error', text: 'Saved, but deck history did not update. The same card is ready to retry.' })
  }
  if (result?.stage === 'activity') {
    return Object.freeze({ tone: 'error', text: 'Could not record that choice. The same card is ready to retry.' })
  }
  if (result?.stage === 'taste') {
    return Object.freeze({ tone: 'error', text: 'That rating did not apply. The same card is ready to retry.' })
  }
  return Object.freeze({
    tone: 'error',
    text: surface === 'lens'
      ? 'That choice did not apply. The same card is ready to retry.'
      : 'Could not apply that choice. The same card is ready to retry.',
  })
}

/**
 * Produce the bounded solicitation pool for calibration only. Full browse uses
 * `browse` unchanged, so weak inventory stays reachable without asking users
 * to train taste on it. Credible/actionable rows are preferred; when supply is
 * short, actionable decision-eligible rows fill first, then only enough of the
 * remaining ranked inventory to avoid an empty or misleadingly tiny deal.
 */
export function selectCalibrationCandidates(items, {
  kind,
  nowMs,
  city,
  taste = {},
  minimum = 15,
} = {}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array')
  if (!['events', 'places'].includes(kind)) throw new TypeError('kind must be events or places')
  if (!Number.isInteger(minimum) || minimum < 1) throw new TypeError('minimum must be a positive integer')
  if (items.length === 0) {
    return Object.freeze({ candidates: Object.freeze([]), browse: Object.freeze([]), preferredCount: 0, fallbackCount: 0 })
  }

  const ranking = rankRuntimeItems(items, { kind, nowMs, city, taste })
  const preferred = ranking.scored.filter((row) => row.leadEligible && row.actionable)
  const preferredIds = new Set(preferred.map((row) => row.id))
  const supporting = ranking.scored.filter((row) => (
    !preferredIds.has(row.id) && row.actionable && row.decisionEligible
  ))
  const supportingIds = new Set(supporting.map((row) => row.id))
  const remaining = ranking.scored.filter((row) => (
    !preferredIds.has(row.id) && !supportingIds.has(row.id) && row.actionable
  ))
  const selectedRows = [...preferred]
  if (selectedRows.length < minimum) {
    selectedRows.push(...supporting.slice(0, minimum - selectedRows.length))
  }
  if (selectedRows.length < minimum) {
    selectedRows.push(...remaining.slice(0, minimum - selectedRows.length))
  }

  return Object.freeze({
    candidates: Object.freeze(selectedRows.map((row) => row.item)),
    browse: Object.freeze([...items]),
    preferredCount: preferred.length,
    fallbackCount: Math.max(0, selectedRows.length - preferred.length),
  })
}
