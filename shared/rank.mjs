import { annotateQualityFloor } from './quality-floor.mjs'

export const RANK_EVIDENCE_TIERS = Object.freeze({
  CANDIDATE: 'candidate',
  RECOMMENDED: 'recommended',
  TOP_PLACEMENT: 'top-placement',
})

export const RANK_REASON_CODES = Object.freeze({
  OBJECTIVE_BLOCKED: 'OBJECTIVE_BLOCKED',
  QUALITY_UNASSESSED: 'QUALITY_UNASSESSED',
  ACTIONABILITY_CONFIRMED: 'ACTIONABILITY_CONFIRMED',
  ACTIONABILITY_UNCONFIRMED: 'ACTIONABILITY_UNCONFIRMED',
  SOURCE_IDENTIFIED: 'SOURCE_IDENTIFIED',
  SOURCE_CORROBORATED: 'SOURCE_CORROBORATED',
  DETAIL_RICH: 'DETAIL_RICH',
  LOCATION_KNOWN: 'LOCATION_KNOWN',
  TIME_KNOWN: 'TIME_KNOWN',
  PRICE_KNOWN: 'PRICE_KNOWN',
  IMAGE_VERIFIED: 'IMAGE_VERIFIED',
  ORGANIZER_IDENTIFIED: 'ORGANIZER_IDENTIFIED',
  CONTEXT_MATCH: 'CONTEXT_MATCH',
  CONTEXT_MISMATCH: 'CONTEXT_MISMATCH',
  PREFERENCE_MATCH: 'PREFERENCE_MATCH',
  PREFERENCE_AVOID: 'PREFERENCE_AVOID',
  LOW_INFORMATION: 'LOW_INFORMATION',
  CHAIN: 'CHAIN',
  GENERIC: 'GENERIC',
  BUSINESS: 'BUSINESS',
  RECURRING: 'RECURRING',
  EVIDENCE_LIMITED: 'EVIDENCE_LIMITED',
})

const KINDS = new Map([
  ['event', 'events'],
  ['events', 'events'],
  ['place', 'places'],
  ['places', 'places'],
])
const MAX_REASONS = 8
const POSITIVE_EVIDENCE = new Set([
  RANK_REASON_CODES.SOURCE_CORROBORATED,
  RANK_REASON_CODES.DETAIL_RICH,
  RANK_REASON_CODES.LOCATION_KNOWN,
  RANK_REASON_CODES.TIME_KNOWN,
  RANK_REASON_CODES.PRICE_KNOWN,
  RANK_REASON_CODES.ORGANIZER_IDENTIFIED,
])
const LEAD_BLOCKING_DEMOTIONS = new Set(['LOW_INFORMATION', 'BUSINESS', 'GENERIC'])
const REASON_ORDER = Object.values(RANK_REASON_CODES)
const DEMOTION_CODES = new Map([
  ['LOW_INFORMATION', RANK_REASON_CODES.LOW_INFORMATION],
  ['CHAIN', RANK_REASON_CODES.CHAIN],
  ['GENERIC', RANK_REASON_CODES.GENERIC],
  ['BUSINESS', RANK_REASON_CODES.BUSINESS],
  ['RECURRING', RANK_REASON_CODES.RECURRING],
])
const FACETS = Object.freeze({
  source: ['sourceFamily', 'source'],
  category: ['category'],
  venue: ['venueId', 'venueOrOperator', 'venue'],
  canonical: ['canonicalId'],
  series: ['seriesId'],
})

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finite(value) {
  return Number.isFinite(value) ? value : 0
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value)))
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizedKind(value) {
  const kind = KINDS.get(value)
  invariant(kind, 'kind must be event, events, place, or places')
  return kind
}

function valueAt(object, key) {
  if (object instanceof Map) return finite(object.get(key))
  if (!plainObject(object) || !Object.hasOwn(object, key)) return 0
  return finite(object[key])
}

function facet(item, name) {
  for (const key of FACETS[name]) {
    const direct = text(item[key])
    if (direct) return direct
  }
  if (name === 'venue') {
    const venue = text(item.venue?.id) || text(item.venue?.name)
    if (venue) return venue
  }
  const fixtureField = name === 'venue' ? 'venueOrOperator' : name === 'source' ? 'sourceFamily' : name
  const nested = text(item.facets?.[fixtureField]) || text(item.groups?.[`${name}Id`])
  return nested || null
}

function sourceFamilies(item) {
  const values = Array.isArray(item.sourceFamilies) ? item.sourceFamilies : []
  const primary = facet(item, 'source')
  return [...new Set([primary, ...values.map(text)].filter(Boolean))]
}

function knownLocation(item) {
  return (Number.isFinite(item.lat) && Number.isFinite(item.lng))
    || Boolean(text(item.address) || text(item.venue?.address))
}

function knownTime(item, kind) {
  if (kind !== 'events') return false
  return Boolean(text(item.start) || text(item.range?.start))
}

function knownPrice(item) {
  if (typeof item.isFree === 'boolean') return true
  if (Number.isFinite(item.price) || Number.isFinite(item.priceMin) || Number.isFinite(item.priceMax)) return true
  const state = text(item.priceState) || text(item.price?.state)
  return Boolean(state && state !== 'unknown')
}

function verifiedImage(item) {
  return item.imageEvidence?.verified === true
    || item.imageCredit?.verified === true
    || item.imageCandidate?.state === 'ready'
}

function explicitActionability(item, kind) {
  if (typeof item.actionability === 'boolean') return item.actionability
  if (plainObject(item.actionability)) {
    if (typeof item.actionability.actionable === 'boolean') return item.actionability.actionable
    if (typeof item.actionability.decisionEligible === 'boolean') return item.actionability.decisionEligible
    const code = text(item.actionability.code)
    if (code) return ['actionable', 'upcoming', 'ongoing', 'available'].includes(code.toLowerCase())
  }
  if (typeof item.actionable === 'boolean') return item.actionable
  if (typeof item.labels?.actionable === 'boolean') return item.labels.actionable
  if (kind === 'places') return knownLocation(item)
  return false
}

function qualityAssessment(item) {
  const blockers = Array.isArray(item.qualityFloor?.blockerCodes)
    ? [...new Set(item.qualityFloor.blockerCodes.filter(text))]
    : null
  const demotions = Array.isArray(item.qualityFloor?.demotionCodes)
    ? [...new Set(item.qualityFloor.demotionCodes.filter(text))]
    : []
  const assessed = blockers !== null
  const eligible = assessed && item.decisionEligible !== false && (blockers?.length || 0) === 0
  return { assessed, eligible, blockers: blockers || [], demotions }
}

function objective(item, kind, actionability, quality) {
  const reasons = new Set()
  let score = 0
  const sources = sourceFamilies(item)
  const descriptionLength = Number.isFinite(item.descriptionLength)
    ? item.descriptionLength
    : typeof item.description === 'string' ? item.description.length : 0

  if (!quality.assessed) reasons.add(RANK_REASON_CODES.QUALITY_UNASSESSED)
  if (!quality.eligible && quality.assessed) reasons.add(RANK_REASON_CODES.OBJECTIVE_BLOCKED)
  if (actionability) {
    score += 8
    reasons.add(RANK_REASON_CODES.ACTIONABILITY_CONFIRMED)
  } else {
    reasons.add(RANK_REASON_CODES.ACTIONABILITY_UNCONFIRMED)
  }
  if (sources.length > 0) {
    score += 2
    reasons.add(RANK_REASON_CODES.SOURCE_IDENTIFIED)
  }
  if (sources.length > 1 || Number(item.srcCount) > 1) {
    score += 5
    reasons.add(RANK_REASON_CODES.SOURCE_CORROBORATED)
  }
  if (descriptionLength >= 120) {
    score += 3
    reasons.add(RANK_REASON_CODES.DETAIL_RICH)
  } else if (descriptionLength >= 40) {
    score += 1
  }
  if (knownLocation(item)) {
    score += 3
    reasons.add(RANK_REASON_CODES.LOCATION_KNOWN)
  }
  if (knownTime(item, kind)) {
    score += 3
    reasons.add(RANK_REASON_CODES.TIME_KNOWN)
  }
  if (knownPrice(item)) {
    score += 1
    reasons.add(RANK_REASON_CODES.PRICE_KNOWN)
  }
  if (verifiedImage(item)) {
    reasons.add(RANK_REASON_CODES.IMAGE_VERIFIED)
  }
  if (text(item.organizer)) {
    score += 1
    reasons.add(RANK_REASON_CODES.ORGANIZER_IDENTIFIED)
  }
  for (const code of quality.demotions) {
    const reason = DEMOTION_CODES.get(code)
    if (reason) {
      score -= 4
      reasons.add(reason)
    }
  }
  if (![...reasons].some(reason => POSITIVE_EVIDENCE.has(reason))) reasons.add(RANK_REASON_CODES.EVIDENCE_LIMITED)
  return { score, reasons }
}

function mappedScore(item, policy) {
  if (!plainObject(policy)) return 0
  const source = facet(item, 'source')
  const category = facet(item, 'category')
  const venue = facet(item, 'venue')
  return valueAt(policy.itemScores || policy.ids, item.id)
    + (source ? valueAt(policy.sourceScores || policy.sources, source) : 0)
    + (category ? valueAt(policy.categoryScores || policy.categories || policy.catScores, category) : 0)
    + (venue ? valueAt(policy.venueScores || policy.venues, venue) : 0)
}

function contextScore(item, context) {
  let score = mappedScore(item, context)
  const category = facet(item, 'category')
  if (category && Array.isArray(context?.desiredCategories) && context.desiredCategories.includes(category)) score += 4
  if (context?.free === true && item.isFree === true) score += 2
  return clamp(score, -20, 20)
}

function preferenceScore(item, preferences) {
  let score = mappedScore(item, preferences)
  if (item.isFree === true) score += finite(preferences?.freeAffinity)
  return clamp(score, -12, 12)
}

function validTopPlacementReceipt(item, id) {
  const receipt = item.rankingEvidence?.topPlacementReceipt
  return plainObject(receipt)
    && receipt.schemaVersion === 1
    && receipt.itemId === id
    && /^sha256:[a-f0-9]{64}$/.test(receipt.artifactHash || '')
    && /^sha256:[a-f0-9]{64}$/.test(receipt.contextHash || '')
    && Boolean(text(receipt.rankerVersion))
    && item.rankingEvidence?.evaluated === true
}

function tierFor(item, id, leadEligible, reasons) {
  const sourceKnown = reasons.includes(RANK_REASON_CODES.SOURCE_IDENTIFIED)
  const evidenceCount = reasons.filter(reason => POSITIVE_EVIDENCE.has(reason)).length
  if (!leadEligible || !sourceKnown || evidenceCount < 2) return RANK_EVIDENCE_TIERS.CANDIDATE
  if (validTopPlacementReceipt(item, id)) return RANK_EVIDENCE_TIERS.TOP_PLACEMENT
  return RANK_EVIDENCE_TIERS.RECOMMENDED
}

function orderedReasons(reasons, context, preference) {
  const all = new Set(reasons)
  if (context > 0) all.add(RANK_REASON_CODES.CONTEXT_MATCH)
  if (context < 0) all.add(RANK_REASON_CODES.CONTEXT_MISMATCH)
  if (preference > 0) all.add(RANK_REASON_CODES.PREFERENCE_MATCH)
  if (preference < 0) all.add(RANK_REASON_CODES.PREFERENCE_AVOID)
  return REASON_ORDER.filter(code => all.has(code)).slice(0, MAX_REASONS)
}

function scoreRows(items, kind, context, preferences) {
  return items.map(item => {
    const id = text(item.id) || (kind === 'places' ? text(item.key) : null)
    const quality = qualityAssessment(item)
    const actionable = explicitActionability(item, kind)
    const objectiveResult = objective(item, kind, actionable, quality)
    const objectiveScore = objectiveResult.score
    const contextValue = contextScore(item, context)
    const preferenceValue = preferenceScore(item, preferences)
    const reasons = orderedReasons(objectiveResult.reasons, contextValue, preferenceValue)
    const credibleEvidence = reasons.includes(RANK_REASON_CODES.SOURCE_IDENTIFIED)
      && reasons.filter(reason => POSITIVE_EVIDENCE.has(reason)).length >= 2
    const leadEligible = quality.eligible
      && actionable
      && credibleEvidence
      && !quality.demotions.some(code => LEAD_BLOCKING_DEMOTIONS.has(code))
    return {
      id,
      key: id,
      item,
      decisionEligible: quality.eligible,
      actionable,
      leadEligible,
      objectiveScore,
      contextScore: contextValue,
      preferenceScore: preferenceValue,
      totalScore: objectiveScore + contextValue + preferenceValue,
      tier: tierFor(item, id, leadEligible, reasons),
      reasons,
      qualityFloor: { blockerCodes: quality.blockers, demotionCodes: quality.demotions },
      facets: Object.fromEntries(Object.keys(FACETS).map(name => [name, facet(item, name)])),
    }
  })
}

function stableOrder(left, right) {
  if (left.leadEligible !== right.leadEligible) return left.leadEligible ? -1 : 1
  if (left.decisionEligible !== right.decisionEligible) return left.decisionEligible ? -1 : 1
  if (left.totalScore !== right.totalScore) return right.totalScore - left.totalScore
  if (left.objectiveScore !== right.objectiveScore) return right.objectiveScore - left.objectiveScore
  return compareText(left.id, right.id)
}

function cap(value, fallback, label) {
  if (value == null) return fallback
  invariant(Number.isInteger(value) && value >= 1, `${label} must be a positive integer`)
  return value
}

function selectionPolicy(options = {}) {
  invariant(plainObject(options), 'selection options must be an object')
  const limit = options.limit == null ? 3 : options.limit
  invariant(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer')
  return {
    limit,
    sourceMax: cap(options.sourceMax, 1, 'sourceMax'),
    categoryMax: cap(options.categoryMax, 1, 'categoryMax'),
    venueMax: cap(options.venueMax, 1, 'venueMax'),
    canonicalMax: cap(options.canonicalMax, 1, 'canonicalMax'),
    seriesMax: cap(options.seriesMax, 1, 'seriesMax'),
  }
}

function exceeds(counts, value, maximum) {
  return value ? (counts.get(value) || 0) >= maximum : false
}

function addCount(counts, value) {
  if (value) counts.set(value, (counts.get(value) || 0) + 1)
}

const ORDINARY_DIVERSITY_FACETS = ['source', 'category', 'venue']

function violationIncrement(counts, value, maximum) {
  if (!value) return 0
  const current = counts.get(value) || 0
  return Math.max(0, current + 1 - maximum) - Math.max(0, current - maximum)
}

function minimumFacetViolations(entries, name, target, maximum) {
  let unknown = 0
  const counts = new Map()
  for (const entry of entries) {
    const value = entry.facets[name]
    if (!value) unknown += 1
    else counts.set(value, (counts.get(value) || 0) + 1)
  }
  const noViolationCapacity = unknown + [...counts.values()].reduce((total, count) => total + Math.min(count, maximum), 0)
  return Math.max(0, target - noViolationCapacity)
}

// First-screen selection is small enough to solve exactly. Search budgets from
// zero upward, so the result maximizes safe count first, then minimizes total
// ordinary-facet cap violations, then preserves the existing scored order.
// Canonical and series caps are hard constraints in every search.
function bestEffortSmallLead(entries, policy) {
  const leads = entries.filter(entry => entry.leadEligible)
  for (let target = Math.min(policy.limit, leads.length); target > 0; target -= 1) {
    const maximumViolations = ORDINARY_DIVERSITY_FACETS.reduce((total, name) => (
      total + Math.max(0, target - policy[`${name}Max`])
    ), 0)
    const minimumViolations = ORDINARY_DIVERSITY_FACETS.reduce((total, name) => (
      total + minimumFacetViolations(leads, name, target, policy[`${name}Max`])
    ), 0)
    for (let budget = minimumViolations; budget <= maximumViolations; budget += 1) {
      const search = (start, chosen, counts, usedViolations) => {
        if (chosen.length === target) return chosen
        if (chosen.length + leads.length - start < target) return null
        for (let index = start; index < leads.length; index += 1) {
          const entry = leads[index]
          if (exceeds(counts.canonical, entry.facets.canonical, policy.canonicalMax)) continue
          if (exceeds(counts.series, entry.facets.series, policy.seriesMax)) continue
          const addedViolations = ORDINARY_DIVERSITY_FACETS.reduce((total, name) => (
            total + violationIncrement(counts[name], entry.facets[name], policy[`${name}Max`])
          ), 0)
          if (usedViolations + addedViolations > budget) continue
          const nextCounts = Object.fromEntries(Object.keys(FACETS).map(name => [name, new Map(counts[name])]))
          for (const name of Object.keys(FACETS)) addCount(nextCounts[name], entry.facets[name])
          const result = search(index + 1, [...chosen, entry], nextCounts, usedViolations + addedViolations)
          if (result) return result
        }
        return null
      }
      const result = search(
        0,
        [],
        Object.fromEntries(Object.keys(FACETS).map(name => [name, new Map()])),
        0,
      )
      if (result) return result
    }
  }
  return []
}

function chooseLead(entries, options) {
  const policy = selectionPolicy(options)
  const selected = []
  const selectedIds = new Set()
  const counts = Object.fromEntries(Object.keys(FACETS).map(name => [name, new Map()]))

  const canChoose = (entry, relaxDiversity) => {
    if (!entry.leadEligible || selectedIds.has(entry.id)) return false
    if (exceeds(counts.canonical, entry.facets.canonical, policy.canonicalMax)) return false
    if (exceeds(counts.series, entry.facets.series, policy.seriesMax)) return false
    if (relaxDiversity) return true
    return !exceeds(counts.source, entry.facets.source, policy.sourceMax)
      && !exceeds(counts.category, entry.facets.category, policy.categoryMax)
      && !exceeds(counts.venue, entry.facets.venue, policy.venueMax)
  }

  const add = entry => {
    selected.push(entry)
    selectedIds.add(entry.id)
    for (const name of Object.keys(FACETS)) addCount(counts[name], entry.facets[name])
  }

  if (policy.limit <= 3) {
    for (const entry of bestEffortSmallLead(entries, policy)) add(entry)
    return { selected, selectedIds, policy }
  }
  for (const entry of entries) {
    if (selected.length === policy.limit) break
    if (canChoose(entry, false)) add(entry)
  }
  for (const entry of entries) {
    if (selected.length === policy.limit) break
    if (canChoose(entry, true)) add(entry)
  }
  return { selected, selectedIds, policy }
}

function reachability(input, output) {
  const stableId = item => text(item.id) || text(item.key)
  const inputIds = input.map(stableId).sort(compareText)
  const outputIds = output.map(stableId).sort(compareText)
  return {
    inputCount: input.length,
    outputCount: output.length,
    exactPermutation: inputIds.length === outputIds.length && inputIds.every((id, index) => id === outputIds[index]),
  }
}

/**
 * Produce a deterministic, count-preserving order. Objective safety, context,
 * and signed personal taste stay inspectable instead of being fused upstream.
 */
export function rankItems(items, {
  kind,
  context = {},
  preferences = {},
  qualityPolicy = null,
  diversityPolicy = null,
} = {}) {
  invariant(Array.isArray(items), 'items must be an array')
  const normalized = normalizedKind(kind)
  invariant(plainObject(context), 'context must be an object')
  invariant(plainObject(preferences), 'preferences must be an object')
  const ids = new Set()
  for (const [index, item] of items.entries()) {
    invariant(plainObject(item), `items[${index}] must be an object`)
    const id = text(item.id) || (normalized === 'places' ? text(item.key) : null)
    invariant(id, `items[${index}] must have a non-empty id${normalized === 'places' ? ' or key' : ''}`)
    invariant(!ids.has(id), `duplicate item id: ${id}`)
    ids.add(id)
  }

  const assessable = items.map(item => item.id ? item : { ...item, id: item.key })
  let assessed = assessable
  if (qualityPolicy != null) {
    invariant(plainObject(qualityPolicy), 'qualityPolicy must be an object')
    assessed = annotateQualityFloor(assessable, { ...qualityPolicy, kind: normalized })
  }
  const byId = new Map(items.map(item => [text(item.id) || text(item.key), item]))
  const base = scoreRows(assessed, normalized, context, preferences).map(entry => ({ ...entry, item: byId.get(entry.id) }))
  base.sort(stableOrder)

  let scored = base
  if (diversityPolicy != null) {
    invariant(plainObject(diversityPolicy), 'diversityPolicy must be an object')
    const prefix = diversityPolicy.prefix == null ? 20 : diversityPolicy.prefix
    const { selected, selectedIds } = chooseLead(base, { ...diversityPolicy, limit: prefix })
    scored = [...selected, ...base.filter(entry => !selectedIds.has(entry.id))]
  }
  const ordered = scored.map(entry => entry.item)
  return {
    kind: normalized,
    ordered,
    scored,
    reachability: reachability(items, ordered),
  }
}

/** Select a safe, diverse lead without padding it with blocked or unknown rows. */
export function selectFirstScreen(ranking, options = {}) {
  invariant(plainObject(ranking) && Array.isArray(ranking.scored), 'ranking must be a rankItems result')
  const { selected, selectedIds, policy } = chooseLead(ranking.scored, options)
  const remainderScored = ranking.scored.filter(entry => !selectedIds.has(entry.id))
  const orderedScored = [...selected, ...remainderScored]
  const selectedItems = selected.map(entry => entry.item)
  const remainder = remainderScored.map(entry => entry.item)
  const ordered = orderedScored.map(entry => entry.item)
  return {
    selected: selectedItems,
    remainder,
    ordered,
    selectedScored: selected,
    remainderScored,
    limited: selected.length < policy.limit,
    requested: policy.limit,
    availableLeadCount: ranking.scored.filter(entry => entry.leadEligible).length,
    reachability: reachability(ranking.ordered, ordered),
  }
}
