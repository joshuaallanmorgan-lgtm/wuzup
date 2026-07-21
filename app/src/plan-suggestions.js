import { identityRefOf } from './identity.js'
import { daypartOfTime } from '../../shared/city-time.mjs'

export const PLAN_SUGGESTION_MIN = 3
export const PLAN_SUGGESTION_MAX = 6
export const PLAN_SUGGESTION_REASON_CODES = Object.freeze({
  WEATHER_CLEAR: 'WEATHER_CLEAR',
  WEATHER_RAINY: 'WEATHER_RAINY',
  DISTANCE: 'DISTANCE',
  TASTE: 'TASTE',
  FREE: 'FREE',
  COMPLEMENT_CATEGORY: 'COMPLEMENT_CATEGORY',
  COMPLEMENT_DAYPART: 'COMPLEMENT_DAYPART',
})

const MAX_CANDIDATES = 10000
const MAX_CONTEXT_SCORES = 10000
const MAX_TOKEN_LENGTH = 512
const DEFAULT_RADIUS_MILES = 12
const FRESH_WEATHER_RECEIPT = 'fresh-app-weather'
const VERIFIED_LOCATION_RECEIPT = 'provider-granted-in-market'
const VERIFIED_INDOOR_RECEIPT = 'normalized-indoor-setting'
const OUTDOOR_CATEGORIES = new Set(['outdoors', 'nature', 'park', 'parks', 'beach', 'hiking'])
const IDENTITY_FACETS = Object.freeze(['exact', 'canonical', 'series'])
const EXACT_IDENTITY_FACETS = Object.freeze(['exact'])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function read(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function text(value) {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  return clean && clean.length <= MAX_TOKEN_LENGTH ? clean : null
}

function token(value) {
  const clean = text(value)
  return clean ? clean.toLowerCase().replace(/\s+/g, ' ') : null
}

function values(value, limit = 32) {
  if (!Array.isArray(value)) return value == null ? [] : [value]
  try {
    return Array.from(value).slice(0, limit)
  } catch {
    return []
  }
}

function addToken(set, prefix, value) {
  const clean = text(value)
  if (clean && clean !== '|') set.add(`${prefix}:${clean}`)
}

function unwrapped(value) {
  if (!plainObject(value)) return value
  const nested = read(value, 'item')
  if (!plainObject(nested)) return value
  const outerIdentity = text(read(value, 'id')) || text(read(value, 'key')) || text(read(value, 'primary'))
  return outerIdentity ? value : nested
}

function identityEvidence(value) {
  const item = unwrapped(value)
  const exact = new Set()
  const canonical = new Set()
  const series = new Set()
  if (typeof item === 'string') {
    addToken(exact, 'identity', item)
    return { exact, canonical, series, valid: exact.size > 0, item }
  }
  if (!plainObject(item)) return { exact, canonical, series, valid: false, item }

  let ref
  try {
    ref = identityRefOf(item)
  } catch {
    return { exact, canonical, series, valid: false, item }
  }
  addToken(exact, 'identity', ref.primary)
  for (const alias of values(ref.aliases, 64)) addToken(exact, 'identity', alias)
  const id = text(read(item, 'id'))
  const key = text(read(item, 'key'))
  addToken(exact, 'identity', id)
  addToken(exact, 'identity', key)

  const canonicals = [
    ...values(read(item, 'canonicalId')),
    ...values(read(item, 'canonicalKey')),
    ...values(read(item, 'canonicalIds')),
  ]
  for (const value of canonicals) addToken(canonical, 'canonical', value)
  // The runtime rank projection treats the stable row ID as the canonical
  // fallback. Mirror that here so a candidate carrying another row's ID as an
  // explicit canonical cannot leak past a planned/offered reference.
  addToken(canonical, 'canonical', id || key)

  const recurrence = read(item, 'recurrence')
  const seriesValues = [
    ...values(read(item, 'seriesId')),
    ...values(read(item, 'seriesKey')),
    ...values(read(item, 'seriesIds')),
    ...values(read(recurrence, 'seriesId')),
    ...values(read(recurrence, 'seriesKey')),
  ]
  for (const value of seriesValues) addToken(series, 'series', value)
  return { exact, canonical, series, valid: exact.size > 0, item }
}

function overlaps(left, right, facets = IDENTITY_FACETS) {
  for (const facet of facets) {
    const a = left[facet]
    const b = right[facet]
    if (a.size > b.size) {
      if ([...b].some(value => a.has(value))) return true
    } else if ([...a].some(value => b.has(value))) return true
  }
  return false
}

function evidenceUnion(references) {
  const union = { exact: new Set(), canonical: new Set(), series: new Set() }
  const entries = []
  for (const value of references) {
    const evidence = identityEvidence(value)
    if (!evidence.valid) return null
    entries.push(evidence)
    for (const facet of ['exact', 'canonical', 'series']) {
      for (const entry of evidence[facet]) union[facet].add(entry)
    }
  }
  return { union, entries }
}

function firstFacet(item, keys) {
  for (const key of keys) {
    for (const value of values(read(item, key))) {
      const clean = token(value)
      if (clean) return clean
    }
  }
  return null
}

function daypartOf(item) {
  const explicit = firstFacet(item, ['_planDaypart'])
  if (['morning', 'afternoon', 'night'].includes(explicit)) return explicit
  const canonical = read(item, '_time')
  if (!plainObject(canonical) || read(canonical, 'ok') !== true) return null
  try {
    const daypart = daypartOfTime(canonical)
    return ['morning', 'afternoon', 'night'].includes(daypart) ? daypart : null
  } catch {
    return null
  }
}

function facetsOf(item) {
  return {
    category: firstFacet(item, ['category', 'categories', 'rawCategories']),
    daypart: daypartOf(item),
    venue: firstFacet(item, ['venueId', 'venue']),
    source: firstFacet(item, ['sourceFamily', 'sourceFamilies', 'source', 'sources']),
  }
}

function newFacetCounts() {
  return {
    category: new Map(),
    daypart: new Map(),
    venue: new Map(),
    source: new Map(),
  }
}

function addFacets(counts, facets) {
  for (const name of Object.keys(counts)) {
    const value = facets[name]
    if (value) counts[name].set(value, (counts[name].get(value) || 0) + 1)
  }
}

function copyFacetCounts(source) {
  return Object.fromEntries(Object.entries(source).map(([name, count]) => [name, new Map(count)]))
}

function preferenceMap(value) {
  if (value == null) return new Map()
  const entries = value instanceof Map ? [...value.entries()] : plainObject(value) ? Object.entries(value) : null
  if (!entries || entries.length > MAX_CONTEXT_SCORES) return null
  const result = new Map()
  for (const [rawKey, rawScore] of entries) {
    const key = text(rawKey)
    if (!key || UNSAFE_KEYS.has(key) || !Number.isFinite(rawScore) || rawScore < -12 || rawScore > 12) return null
    result.set(key, rawScore)
  }
  return result
}

function normalizeContext(value) {
  if (value == null) return { state: 'valid', weather: null, location: null, preferences: new Map() }
  if (!plainObject(value)) return { state: 'corrupt', weather: null, location: null, preferences: new Map() }

  let weather = null
  const rawWeather = read(value, 'weather')
  if (rawWeather != null) {
    if (
      !plainObject(rawWeather)
      || read(rawWeather, 'state') !== 'available'
      || read(rawWeather, 'fresh') !== true
      || read(rawWeather, 'receipt') !== FRESH_WEATHER_RECEIPT
    ) {
      return { state: 'corrupt', weather: null, location: null, preferences: new Map() }
    }
    const mood = token(read(rawWeather, 'mood'))
    if (mood !== 'clear' && mood !== 'rainy') {
      return { state: 'corrupt', weather: null, location: null, preferences: new Map() }
    }
    weather = Object.freeze({ mood })
  }

  let location = null
  const rawLocation = read(value, 'location')
  if (rawLocation != null) {
    const lat = read(rawLocation, 'lat')
    const lng = read(rawLocation, 'lng')
    const radiusMiles = read(rawLocation, 'radiusMiles') ?? DEFAULT_RADIUS_MILES
    if (
      !plainObject(rawLocation)
      || read(rawLocation, 'state') !== 'available'
      || read(rawLocation, 'permission') !== 'granted'
      || read(rawLocation, 'enabled') !== true
      || read(rawLocation, 'inMarket') !== true
      || read(rawLocation, 'receipt') !== VERIFIED_LOCATION_RECEIPT
      || !Number.isFinite(lat)
      || !Number.isFinite(lng)
      || lat < -90
      || lat > 90
      || lng < -180
      || lng > 180
      || !Number.isFinite(radiusMiles)
      || radiusMiles <= 0
      || radiusMiles > 100
    ) {
      return { state: 'corrupt', weather: null, location: null, preferences: new Map() }
    }
    location = Object.freeze({ lat, lng, radiusMiles })
  }

  const preferences = preferenceMap(read(value, 'preferenceScores'))
  if (!preferences) return { state: 'corrupt', weather: null, location: null, preferences: new Map() }
  return { state: 'valid', weather, location, preferences }
}

function radians(value) {
  return value * Math.PI / 180
}

function distanceMiles(item, location) {
  if (!location) return null
  const lat = read(item, 'lat')
  const lng = read(item, 'lng')
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  const dLat = radians(lat - location.lat)
  const dLng = radians(lng - location.lng)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(location.lat)) * Math.cos(radians(lat)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function weatherFit(item, weather) {
  if (!weather) return null
  const categories = new Set([
    ...values(read(item, 'category')),
    ...values(read(item, 'categories')),
    ...values(read(item, 'rawCategories')),
  ].map(token).filter(Boolean))
  const explicitlyOutdoor = read(item, 'outdoor') === true || [...categories].some(value => OUTDOOR_CATEGORIES.has(value))
  const indoorEvidence = read(item, '_indoorEvidence')
  // Rain changes the deal only when the runtime normalizer has supplied a
  // narrowly verified setting receipt. A category, venue name, description,
  // or unreceipted `indoor: true` is never enough to claim weather fit.
  const explicitlyIndoor = plainObject(indoorEvidence)
    && read(indoorEvidence, 'state') === 'verified'
    && read(indoorEvidence, 'indoor') === true
    && read(indoorEvidence, 'receipt') === VERIFIED_INDOOR_RECEIPT
  if (weather.mood === 'clear' && explicitlyOutdoor) return 'clear-outdoor'
  if (weather.mood === 'rainy' && explicitlyIndoor && !explicitlyOutdoor) return 'rainy-indoor'
  return null
}

function preferenceScore(entry, context) {
  if (context.state !== 'valid' || context.preferences.size === 0) return 0
  const candidates = [text(read(entry.item, 'id')), text(read(entry.item, 'key'))]
  for (const alias of entry.identity.exact) candidates.push(alias.slice('identity:'.length))
  for (const key of candidates) if (key && context.preferences.has(key)) return context.preferences.get(key)
  return 0
}

function contextFacts(entry, context, counts) {
  const weather = weatherFit(entry.item, context.weather)
  const distance = distanceMiles(entry.item, context.location)
  const nearby = distance != null && distance <= context.location?.radiusMiles
  const preference = preferenceScore(entry, context)
  const free = read(entry.item, 'isFree') === true || read(entry.item, '_free') === true
  const categoryNew = Boolean(entry.facets.category && counts.category.size > 0 && !counts.category.has(entry.facets.category))
  const daypartNew = Boolean(entry.facets.daypart && counts.daypart.size > 0 && !counts.daypart.has(entry.facets.daypart))
  const venueNew = Boolean(entry.facets.venue && !counts.venue.has(entry.facets.venue))
  const sourceNew = Boolean(entry.facets.source && !counts.source.has(entry.facets.source))
  const complementScore = (categoryNew ? 3 : 0) + (daypartNew ? 2 : 0) + (venueNew ? 0.5 : 0) + (sourceNew ? 0.5 : 0)
  const weatherScore = weather ? 3 : 0
  const distanceScore = nearby ? 0.5 + 1.5 * (1 - distance / context.location.radiusMiles) : 0
  const tasteScore = preference / 4
  const freeScore = free ? 1 : 0
  return {
    weather,
    distance,
    nearby,
    distanceScore,
    preference,
    free,
    categoryNew,
    daypartNew,
    score: complementScore + weatherScore + distanceScore + tasteScore + freeScore,
  }
}

function distanceLabel(miles) {
  const rounded = miles < 1 ? Math.round(miles * 10) / 10 : Math.round(miles)
  return `${rounded} mi from your location`
}

function reason(code, label, evidence, contribution) {
  return Object.freeze({ code, label, evidence: Object.freeze(evidence), contribution })
}

function reasonsFor(entry, facts) {
  const reasons = []
  if (facts.weather === 'clear-outdoor') {
    reasons.push(reason(
      PLAN_SUGGESTION_REASON_CODES.WEATHER_CLEAR,
      'Fits the clear-day forecast',
      { mood: 'clear', category: entry.facets.category },
      3,
    ))
  } else if (facts.weather === 'rainy-indoor') {
    reasons.push(reason(
      PLAN_SUGGESTION_REASON_CODES.WEATHER_RAINY,
      'An indoor option for a rainy day',
      { mood: 'rainy', indoor: true, receipt: VERIFIED_INDOOR_RECEIPT },
      3,
    ))
  }
  if (facts.nearby) {
    reasons.push(reason(
      PLAN_SUGGESTION_REASON_CODES.DISTANCE,
      distanceLabel(facts.distance),
      { miles: facts.distance },
      facts.distanceScore,
    ))
  }
  if (facts.preference > 0) {
    reasons.push(reason(
      PLAN_SUGGESTION_REASON_CODES.TASTE,
      'Matches your interests',
      { preferenceScore: facts.preference },
      facts.preference / 4,
    ))
  }
  if (facts.free) {
    reasons.push(reason(PLAN_SUGGESTION_REASON_CODES.FREE, 'Free', { isFree: true }, 1))
  }
  if (facts.categoryNew) {
    reasons.push(reason(
      PLAN_SUGGESTION_REASON_CODES.COMPLEMENT_CATEGORY,
      'Adds category variety to your day',
      { facet: 'category', value: entry.facets.category },
      3,
    ))
  } else if (facts.daypartNew) {
    reasons.push(reason(
      PLAN_SUGGESTION_REASON_CODES.COMPLEMENT_DAYPART,
      'Adds a different time of day',
      { facet: 'daypart', value: entry.facets.daypart },
      2,
    ))
  }
  return Object.freeze(reasons)
}

function balancedPageSizes(count) {
  if (count <= 0) return []
  if (count <= PLAN_SUGGESTION_MAX) return [count]
  const pageCount = Math.ceil(count / PLAN_SUGGESTION_MAX)
  const base = Math.floor(count / pageCount)
  const extra = count % pageCount
  return Array.from({ length: pageCount }, (_, index) => base + (index < extra ? 1 : 0))
}

function choosePage(remaining, size, context, baseline) {
  const selected = []
  const counts = copyFacetCounts(baseline)
  while (selected.length < size && remaining.length > 0) {
    // The input is already objective/personal-rank ordered. Context and
    // complementarity may reorder only a bounded two-page window, keeping a
    // thin tail from jumping into the lead merely because it is different.
    const windowSize = Math.min(remaining.length, Math.max(PLAN_SUGGESTION_MAX, size * 2))
    let bestIndex = 0
    let bestFacts = contextFacts(remaining[0], context, counts)
    for (let index = 1; index < windowSize; index += 1) {
      const facts = contextFacts(remaining[index], context, counts)
      if (facts.score > bestFacts.score) {
        bestIndex = index
        bestFacts = facts
      }
    }
    const [entry] = remaining.splice(bestIndex, 1)
    const reasons = reasonsFor(entry, bestFacts)
    selected.push(Object.freeze({
      item: entry.item,
      reasons,
      primaryReason: reasons[0] || null,
      evidence: Object.freeze({
        weatherFit: bestFacts.weather,
        distanceMiles: bestFacts.distance,
        preferenceScore: bestFacts.preference,
        isFree: bestFacts.free,
        complementaryCategory: bestFacts.categoryNew,
        complementaryDaypart: bestFacts.daypartNew,
      }),
    }))
    addFacets(counts, entry.facets)
    addFacets(baseline, entry.facets)
  }
  return Object.freeze(selected)
}

function neutralResult(reasonCode = 'malformed-input') {
  return Object.freeze({
    state: 'neutral',
    reason: reasonCode,
    contextState: 'neutral',
    page: 0,
    pageCount: 0,
    nextPage: null,
    limited: true,
    suggestions: Object.freeze([]),
    previous: Object.freeze([]),
    remainder: Object.freeze([]),
    ordered: Object.freeze([]),
    pages: Object.freeze([]),
    excluded: Object.freeze([]),
    reachability: Object.freeze({
      inputCount: 0,
      eligibleCount: 0,
      excludedCount: 0,
      orderedCount: 0,
      exactPartition: true,
      exactAccounting: true,
    }),
  })
}

function neutralInventory(reason = 'malformed-input') {
  return Object.freeze({
    state: 'neutral',
    reason,
    items: Object.freeze([]),
    excluded: Object.freeze([]),
    inputCount: 0,
    exactAccounting: true,
  })
}

function filterIdentityInventory({
  candidates,
  planned,
  offered,
  exclusionFacets,
  dedupeFacets,
}) {
  try {
    if (
      !Array.isArray(candidates)
      || candidates.length > MAX_CANDIDATES
      || !Array.isArray(planned)
      || !Array.isArray(offered)
    ) return neutralInventory()
    const plannedEvidence = evidenceUnion(planned)
    const offeredEvidence = evidenceUnion(offered)
    if (!plannedEvidence || !offeredEvidence) return neutralInventory()

    const items = []
    const excluded = []
    const acceptedEvidence = { exact: new Set(), canonical: new Set(), series: new Set() }
    for (const rawItem of candidates) {
      const identity = identityEvidence(rawItem)
      if (!identity.valid || !plainObject(identity.item)) return neutralInventory()
      let code = null
      if (overlaps(identity, plannedEvidence.union, exclusionFacets)) code = 'planned'
      else if (overlaps(identity, offeredEvidence.union, exclusionFacets)) code = 'offered'
      else if (dedupeFacets && overlaps(identity, acceptedEvidence, dedupeFacets)) code = 'duplicate'
      if (code) {
        excluded.push(Object.freeze({ item: identity.item, code }))
        continue
      }
      items.push(identity.item)
      if (dedupeFacets) {
        for (const facet of IDENTITY_FACETS) {
          for (const value of identity[facet]) acceptedEvidence[facet].add(value)
        }
      }
    }
    return Object.freeze({
      state: items.length > 0 ? 'ready' : 'empty',
      reason: null,
      items: Object.freeze(items),
      excluded: Object.freeze(excluded),
      inputCount: candidates.length,
      exactAccounting: items.length + excluded.length === candidates.length,
    })
  } catch {
    return neutralInventory()
  }
}

/**
 * Preserve saved-list order while removing anything represented anywhere in
 * the active plan. Family matching is deliberate here: another alias,
 * canonical publication, or recurrence sibling is not an honest saved option
 * after that plan family has already been chosen.
 */
export function filterPlanSavedCandidates({ candidates, planned = [] } = {}) {
  return filterIdentityInventory({
    candidates,
    planned,
    offered: [],
    exclusionFacets: IDENTITY_FACETS,
    dedupeFacets: IDENTITY_FACETS,
  })
}

/**
 * Build the neutral browse catalog. Only exact/alias representations already
 * planned or surfaced in Saved are removed. Canonical and recurrence siblings
 * remain reachable, and catalog rows are never deduplicated or reordered.
 */
export function buildPlanBrowseInventory({ candidates, planned = [], offered = [] } = {}) {
  return filterIdentityInventory({
    candidates,
    planned,
    offered,
    exclusionFacets: EXACT_IDENTITY_FACETS,
    dedupeFacets: null,
  })
}

/**
 * Deal deterministic, complementary planner pages from an already-ranked
 * candidate list. Planned/offered identity, alias, canonical, and series
 * evidence are hard exclusions. Optional weather/location/taste context is
 * atomic: corrupt evidence is ignored while objective inventory remains usable.
 */
export function buildPlanSuggestionPages({
  candidates,
  planned = [],
  offered = [],
  context = null,
  page = 0,
} = {}) {
  try {
    if (
      !Array.isArray(candidates)
      || candidates.length > MAX_CANDIDATES
      || !Array.isArray(planned)
      || !Array.isArray(offered)
      || !Number.isInteger(page)
      || page < 0
    ) return neutralResult()

    const plannedEvidence = evidenceUnion(planned)
    const offeredEvidence = evidenceUnion(offered)
    if (!plannedEvidence || !offeredEvidence) return neutralResult()

    const accepted = []
    const excluded = []
    const acceptedEvidence = { exact: new Set(), canonical: new Set(), series: new Set() }
    for (const rawItem of candidates) {
      const identity = identityEvidence(rawItem)
      if (!identity.valid || !plainObject(identity.item)) return neutralResult()
      let code = null
      if (overlaps(identity, plannedEvidence.union)) code = 'planned'
      else if (overlaps(identity, offeredEvidence.union)) code = 'offered'
      else if (overlaps(identity, acceptedEvidence)) code = 'duplicate'
      if (code) {
        excluded.push(Object.freeze({ item: identity.item, code }))
        continue
      }
      for (const facet of ['exact', 'canonical', 'series']) {
        for (const value of identity[facet]) acceptedEvidence[facet].add(value)
      }
      accepted.push({
        item: identity.item,
        identity,
        facets: facetsOf(identity.item),
        inputIndex: accepted.length,
      })
    }

    let normalizedContext
    try {
      normalizedContext = normalizeContext(context)
    } catch {
      normalizedContext = { state: 'corrupt', weather: null, location: null, preferences: new Map() }
    }
    const baseline = newFacetCounts()
    for (const evidence of [...plannedEvidence.entries, ...offeredEvidence.entries]) {
      if (plainObject(evidence.item)) addFacets(baseline, facetsOf(evidence.item))
    }

    const remaining = [...accepted]
    const sizes = balancedPageSizes(remaining.length)
    const pages = sizes.map(size => choosePage(remaining, size, normalizedContext, baseline))
    const orderedRecords = pages.flat()
    const selected = pages[page] || Object.freeze([])
    const previous = pages.slice(0, page).flat().map(record => record.item)
    const remainder = pages.slice(page + 1).flat().map(record => record.item)
    const ordered = orderedRecords.map(record => record.item)
    const state = pages.length === 0 ? 'empty' : page >= pages.length ? 'exhausted' : 'ready'
    const exactPartition = previous.length + selected.length + remainder.length === ordered.length
      && new Set([...previous, ...selected.map(record => record.item), ...remainder]).size === ordered.length

    return Object.freeze({
      state,
      reason: null,
      contextState: normalizedContext.state,
      page,
      pageCount: pages.length,
      nextPage: page + 1 < pages.length ? page + 1 : null,
      limited: selected.length > 0 && selected.length < PLAN_SUGGESTION_MIN,
      suggestions: selected,
      previous: Object.freeze(previous),
      remainder: Object.freeze(remainder),
      ordered: Object.freeze(ordered),
      pages: Object.freeze(pages),
      excluded: Object.freeze(excluded),
      reachability: Object.freeze({
        inputCount: candidates.length,
        eligibleCount: accepted.length,
        excludedCount: excluded.length,
        orderedCount: ordered.length,
        exactPartition,
        exactAccounting: accepted.length + excluded.length === candidates.length,
      }),
    })
  } catch {
    return neutralResult()
  }
}
