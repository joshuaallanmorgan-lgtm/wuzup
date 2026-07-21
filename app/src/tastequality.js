// Sprint 8 personal-relevance quality gate. The primary APIs below inspect the
// actual `rankRuntimeItems` first 20. They never reconstruct the retired
// score-proxy path.

import { buildPersonalPreferences, normalizePersonalProfile } from './personal-relevance.js'

export const TOP_N = 20
export const MAX_FIRST_SCREEN_SHARE = 0.5
export const MIN_MATCH_MOVEMENT = 4

// Compatibility exports retained for the older smoke receipt. New gates use
// MAX_FIRST_SCREEN_SHARE directly.
export const DIVERSITY_FLOOR = 0.2
export const DIVERSITY_DROP_TOL = 0.1
export const MATCH_MIN_LIFT = 1
export const MATCH_MAX = 0.85

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function itemId(item) {
  return typeof item?.id === 'string' && item.id
    ? item.id
    : typeof item?.key === 'string' && item.key ? item.key : null
}

function sourceFamily(item) {
  const source = (Array.isArray(item?.sources) && item.sources.length > 0
    ? item.sources[0]
    : item?.sourceFamily || item?.source) || ''
  return String(source).replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase() || 'unknown'
}

function category(item) {
  return typeof item?.category === 'string' && item.category.trim()
    ? item.category.trim().toLowerCase()
    : 'other'
}

function maxShare(items, keyFn) {
  if (items.length === 0) return 0
  const counts = new Map()
  for (const item of items) {
    const key = keyFn(item)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Math.max(...counts.values()) / items.length
}

export function diversityScore(items) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array')
  return 1 - Math.max(maxShare(items, category), maxShare(items, sourceFamily))
}

export function matchRate(items, leanValues) {
  if (!Array.isArray(items) || !Array.isArray(leanValues)) throw new TypeError('match inputs must be arrays')
  if (items.length === 0) return 0
  const values = new Set(leanValues.map(value => String(value).toLowerCase()))
  return items.filter(item => values.has(category(item))).length / items.length
}

function fieldValues(item, field) {
  const raw = item?.[field]
  const values = Array.isArray(raw) ? raw : [raw]
  return values
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim().toLowerCase())
}

export function matchesPreference(item, match) {
  if (!plainObject(match) || typeof match.field !== 'string') return false
  const expected = typeof match.value === 'string' ? match.value.trim().toLowerCase() : null
  if (!expected) return false
  const aliases = match.field === 'category'
    ? ['category', 'categories', 'rawCategories']
    : match.field === 'placeType'
      ? ['placeType', 'placeTypes', 'classes']
      : match.field === 'activity'
        ? ['activity', 'activities', 'activityIds', 'amenities']
        : [match.field]
  return aliases.some(field => fieldValues(item, field).includes(expected))
}

function rankingTop(ranking, topN) {
  if (!plainObject(ranking) || !Array.isArray(ranking.scored)) throw new TypeError('ranking must be a rank result')
  if (!Number.isInteger(topN) || topN < 1) throw new TypeError('topN must be a positive integer')
  return ranking.scored.slice(0, topN).map(row => row.item)
}

/** Inspect the literal first screen returned by the production rank adapter. */
export function firstScreenMetrics(ranking, { topN = TOP_N, match = null } = {}) {
  const items = rankingTop(ranking, topN)
  const matching = match ? items.filter(item => matchesPreference(item, match)) : []
  return Object.freeze({
    n: items.length,
    ids: Object.freeze(items.map(itemId)),
    matchingIds: Object.freeze(matching.map(itemId)),
    categoryMaxShare: maxShare(items, category),
    sourceMaxShare: maxShare(items, sourceFamily),
    diversity: diversityScore(items),
    exactPermutation: ranking.reachability?.exactPermutation === true,
  })
}

export function firstScreenGate(ranking, {
  topN = TOP_N,
  maxCategoryShare = MAX_FIRST_SCREEN_SHARE,
  maxSourceShare = MAX_FIRST_SCREEN_SHARE,
} = {}) {
  const metrics = firstScreenMetrics(ranking, { topN })
  const violations = []
  if (metrics.n < topN) violations.push('insufficient-first-screen-supply')
  if (metrics.categoryMaxShare > maxCategoryShare) violations.push('category-concentration')
  if (metrics.sourceMaxShare > maxSourceShare) violations.push('source-concentration')
  if (!metrics.exactPermutation) violations.push('inventory-not-permutation')
  return Object.freeze({ passed: violations.length === 0, violations: Object.freeze(violations), metrics })
}

function objectiveMap(ranking) {
  return new Map(ranking.scored.map(row => [row.id, row.objectiveScore]))
}

/** Compare two actual first screens and prove preference did not alter quality. */
export function compareFirstScreens(neutral, personalized, { topN = TOP_N, match } = {}) {
  const before = firstScreenMetrics(neutral, { topN, match })
  const after = firstScreenMetrics(personalized, { topN, match })
  const beforeIds = new Set(before.matchingIds)
  const afterIds = new Set(after.matchingIds)
  const enteredMatchingIds = after.matchingIds.filter(id => !beforeIds.has(id))
  const leftMatchingIds = before.matchingIds.filter(id => !afterIds.has(id))
  const neutralObjective = objectiveMap(neutral)
  const personalObjective = objectiveMap(personalized)
  const objectiveStable = neutralObjective.size === personalObjective.size
    && [...neutralObjective].every(([id, score]) => personalObjective.get(id) === score)
  return Object.freeze({
    before,
    after,
    enteredMatchingIds: Object.freeze(enteredMatchingIds),
    leftMatchingIds: Object.freeze(leftMatchingIds),
    objectiveStable,
    exactPermutation: before.exactPermutation && after.exactPermutation,
  })
}

export function movementGate(neutral, personalized, {
  topN = TOP_N,
  match,
  direction,
  minimum = MIN_MATCH_MOVEMENT,
} = {}) {
  if (direction !== 'into' && direction !== 'out-of') throw new TypeError('direction must be into or out-of')
  const comparison = compareFirstScreens(neutral, personalized, { topN, match })
  const movement = direction === 'into'
    ? comparison.enteredMatchingIds.length
    : comparison.leftMatchingIds.length
  const screen = firstScreenGate(personalized, { topN })
  const violations = [...screen.violations]
  if (movement < minimum) violations.push('insufficient-personal-movement')
  if (!comparison.objectiveStable) violations.push('objective-score-mutated')
  if (!comparison.exactPermutation) violations.push('inventory-not-permutation')
  return Object.freeze({
    passed: violations.length === 0,
    violations: Object.freeze([...new Set(violations)]),
    movement,
    comparison,
    screen: screen.metrics,
  })
}

// Compatibility metric for the old smoke receipt. The input order is treated
// as its objective order, then the same bounded profile projection reorders it.
// It intentionally does not read either retired ranking signal.
function compatibilityOrder(events, profile) {
  const preferences = buildPersonalPreferences(profile, { kind: 'events', items: events })
  const scored = events.map((item, index) => ({
    item,
    index,
    score: -index * 0.25
      + (preferences.categoryScores[category(item)] || 0)
      + (item?.isFree === true ? preferences.freeAffinity : 0),
  })).sort((left, right) => right.score - left.score || left.index - right.index)

  const selected = []
  const remainder = [...scored]
  const counts = { category: new Map(), source: new Map() }
  while (selected.length < Math.min(TOP_N, scored.length)) {
    let index = remainder.findIndex(row => (
      (counts.category.get(category(row.item)) || 0) < TOP_N * MAX_FIRST_SCREEN_SHARE
      && (counts.source.get(sourceFamily(row.item)) || 0) < TOP_N * MAX_FIRST_SCREEN_SHARE
    ))
    if (index < 0) index = 0
    const [row] = remainder.splice(index, 1)
    selected.push(row)
    counts.category.set(category(row.item), (counts.category.get(category(row.item)) || 0) + 1)
    counts.source.set(sourceFamily(row.item), (counts.source.get(sourceFamily(row.item)) || 0) + 1)
  }
  return [...selected, ...remainder].map(row => row.item)
}
export function topFeed(events, profile = null, n = TOP_N) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array')
  const normalized = profile == null ? null : normalizePersonalProfile(profile)
  const ordered = normalized?.state === 'valid' ? compatibilityOrder(events, profile) : [...events]
  return ordered.slice(0, n)
}

export function feedQuality(upcoming, profile) {
  const normalized = normalizePersonalProfile(profile)
  const leanCats = normalized.state === 'valid'
    ? Object.entries(normalized.categoryScores)
      .filter(([key, value]) => !key.includes(':') && value > 0)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 2)
      .map(([key]) => key)
    : []
  const neutralTop = [...upcoming].slice(0, TOP_N)
  const tastedTop = compatibilityOrder(upcoming, profile).slice(0, TOP_N)
  const neutralMatch = matchRate(neutralTop, leanCats)
  const tastedMatch = matchRate(tastedTop, leanCats)
  return {
    n: tastedTop.length,
    leanCats,
    diversity: diversityScore(tastedTop),
    neutralDiversity: diversityScore(neutralTop),
    matchRate: tastedMatch,
    neutralMatchRate: neutralMatch,
    matchLift: Math.round((tastedMatch - neutralMatch) * tastedTop.length),
  }
}
