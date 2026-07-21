import { eventActionability } from '../../shared/city-time.mjs'
import { rankItems, selectFirstScreen, RANK_REASON_CODES } from '../../shared/rank.mjs'
import { presentLeadImage } from './leadImage.js'

const STATE_CODES = new Map([
  ['florida', 'FL'],
  ['california', 'CA'],
])
const REASON_COPY = Object.freeze({
  [RANK_REASON_CODES.SOURCE_CORROBORATED]: 'Confirmed by multiple sources',
  [RANK_REASON_CODES.DETAIL_RICH]: 'Useful event details available',
  [RANK_REASON_CODES.LOCATION_KNOWN]: 'Location confirmed',
  [RANK_REASON_CODES.TIME_KNOWN]: 'Time confirmed',
  [RANK_REASON_CODES.PRICE_KNOWN]: 'Price details available',
  [RANK_REASON_CODES.ORGANIZER_IDENTIFIED]: 'Organizer identified',
  [RANK_REASON_CODES.PREFERENCE_MATCH]: 'Matches your interests',
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

function clamp(value, min, max) {
  const number = Number.isFinite(value) ? value : 0
  return Math.min(max, Math.max(min, number))
}

function family(value) {
  const source = text(value)
  return source ? source.replace(/\s*\([^)]*\)\s*$/, '').trim() : null
}

function eventSources(event) {
  const sources = Array.isArray(event.sourceFamilies)
    ? event.sourceFamilies
    : Array.isArray(event.sources) ? event.sources : [event.sourceFamily || event.source]
  return [...new Set(sources.map(family).filter(Boolean))]
}

function regionCodes(city) {
  if (Array.isArray(city.regionCodes) && city.regionCodes.length > 0) return city.regionCodes
  const explicit = text(city.regionCode)
  if (explicit) return [explicit]
  const derived = STATE_CODES.get((text(city.region) || '').toLowerCase())
  invariant(derived, 'city.regionCode or city.regionCodes is required for this region')
  return [derived]
}

function market(city) {
  invariant(plainObject(city) && text(city.id), 'city.id is required')
  invariant(text(city.tz), 'city.tz is required')
  const box = city.bbox
  invariant(plainObject(box), 'city.bbox is required')
  const bbox = {
    latMin: box.latMin ?? box.south,
    latMax: box.latMax ?? box.north,
    lngMin: box.lngMin ?? box.west,
    lngMax: box.lngMax ?? box.east,
  }
  return { id: city.id, bbox, regionCodes: regionCodes(city) }
}

/** Shared conversion from current CITY shape to the objective quality contract. */
export function runtimeQualityPolicy({
  kind,
  nowMs,
  city,
  knownJunkIds = [],
  knownFalseMergeIds = [],
} = {}) {
  invariant(kind === 'events' || kind === 'places', 'kind must be events or places')
  invariant(Number.isFinite(nowMs), 'nowMs must be finite')
  invariant(Array.isArray(knownJunkIds), 'knownJunkIds must be an array')
  invariant(Array.isArray(knownFalseMergeIds), 'knownFalseMergeIds must be an array')
  return {
    kind,
    nowMs,
    timeZone: city?.tz,
    market: market(city),
    knownJunkIds: [...knownJunkIds],
    knownFalseMergeIds: [...knownFalseMergeIds],
  }
}

function wrappers(tonightItems) {
  invariant(Array.isArray(tonightItems), 'tonightItems must be an array')
  return tonightItems.map((candidate, index) => {
    invariant(plainObject(candidate), `tonightItems[${index}] must be an object`)
    const wrapped = plainObject(candidate.e) ? candidate : { e: candidate, withDate: false }
    invariant(text(wrapped.e.id), `tonightItems[${index}].e.id is required`)
    return wrapped
  })
}

function projectedEvent(wrapper, { nowMs, city }) {
  const event = wrapper.e
  const sources = eventSources(event)
  const availability = eventActionability(event, { nowMs, timeZone: city.tz })
  // A same-state address is not proof that a coordinate-less event belongs to
  // a metro corridor (for example, Napa is not SF/East Bay coverage). Lead
  // placement therefore needs coordinates, which the bbox gate verifies, or
  // an explicit upstream market attachment. The address remains browseable.
  const hasCoordinates = Number.isFinite(event.lat) && Number.isFinite(event.lng)
  const hasVerifiedMarket = hasCoordinates
    || event.marketId === city.id
    || event.addressMarketId === city.id
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    status: event.status,
    sourceFamily: family(event.sourceFamily || sources[0]),
    sourceFamilies: sources,
    organizer: event.organizer,
    category: event.category,
    rawCategories: event.rawCategories,
    venue: event.venue,
    venueId: event.venueId,
    address: event.address,
    lat: event.lat,
    lng: event.lng,
    description: event.description,
    descriptionLength: Number.isFinite(event.descriptionLength)
      ? event.descriptionLength
      : typeof event.description === 'string' ? event.description.length : null,
    price: event.price,
    priceMin: event.priceMin,
    priceMax: event.priceMax,
    priceState: event.priceState,
    isFree: event.isFree === true || event._free === true
      ? true
      : event.isFree === false ? false : null,
    canonicalId: event.canonicalId || event.canonicalKey || event.id,
    seriesId: event.seriesId || event.seriesKey || event.recurrence?.seriesId || event.recurrence?.seriesKey || null,
    recurrence: event.recurrence,
    actionability: availability.actionable
      && availability.time?.kind === 'timed'
      && event._actionable !== false,
    lowInformation: event.lowInformation === true || !hasVerifiedMarket,
    isBusiness: event.isBusiness === true,
    isGeneric: event.isGeneric === true,
    isChain: event.isChain === true,
    isRecurring: event.isRecurring === true || event.recurrence?.kind === 'recurring',
    marketId: event.marketId,
    rankingEvidence: event.rankingEvidence,
    runtimeStarted: availability.time?.kind === 'timed' && availability.time.startAt < nowMs,
  }
}

/** Convert the existing taste profile into a bounded signed preference layer. */
export function signedRuntimeTaste(taste = {}) {
  if (!plainObject(taste)) return { categoryScores: {}, freeAffinity: 0 }
  const categoryScores = {}
  const learned = plainObject(taste.catScores) ? taste.catScores : {}
  if (Number(taste.n) > 0) {
    for (const [category, value] of Object.entries(learned)) {
      if (text(category) && Number.isFinite(value) && value > 0) categoryScores[category] = clamp((value / 25) * 6, 0, 6)
    }
  }
  const prefs = plainObject(taste.prefs) ? taste.prefs : {}
  for (const category of Array.isArray(prefs.boost) ? prefs.boost : []) {
    if (text(category)) categoryScores[category] = clamp((categoryScores[category] || 0) + 6, -12, 12)
  }
  // Explicit user-owned mute is a real negative preference, never a filter.
  for (const category of Array.isArray(prefs.mute) ? prefs.mute : []) {
    if (text(category)) categoryScores[category] = -12
  }
  const freeAffinity = Number(taste.n) > 0 ? clamp((Number(taste.freeAffinity) / 25) * 3, 0, 3) : 0
  return { categoryScores, freeAffinity }
}

function whyCopy(scored, wrapper) {
  if (scored.reasons.includes(RANK_REASON_CODES.PREFERENCE_MATCH)) return REASON_COPY[RANK_REASON_CODES.PREFERENCE_MATCH]
  if (scored.reasons.includes(RANK_REASON_CODES.SOURCE_CORROBORATED)) return REASON_COPY[RANK_REASON_CODES.SOURCE_CORROBORATED]
  const time = scored.reasons.includes(RANK_REASON_CODES.TIME_KNOWN)
  const location = scored.reasons.includes(RANK_REASON_CODES.LOCATION_KNOWN)
  if (time && location) return wrapper.withDate ? 'Tomorrow time and location confirmed' : 'Tonight time and location confirmed'
  for (const code of scored.reasons) if (REASON_COPY[code]) return REASON_COPY[code]
  return null
}

function decorated(wrapper, scored, imagePolicy) {
  const why = whyCopy(scored, wrapper)
  const imageSafeEvent = presentLeadImage(wrapper.e, { policy: imagePolicy })
  return {
    ...wrapper,
    e: {
      ...imageSafeEvent,
      _why: why,
    },
    relevance: {
      tier: scored.tier,
      reasonCodes: [...scored.reasons],
      why,
    },
  }
}

/**
 * Rank the exact candidates emitted by tonightModel. Weak/blocked candidates
 * remain in `ordered`; only receipt-backed credible rows can enter `selected`.
 */
export function rankTonightCandidates(tonightItems, { nowMs, city, taste, limit = 3, imagePolicy } = {}) {
  invariant(Number.isFinite(nowMs), 'nowMs must be finite')
  invariant(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer')
  const input = wrappers(tonightItems)
  const projected = input.map(wrapper => projectedEvent(wrapper, { nowMs, city }))
  const context = {
    itemScores: Object.fromEntries(projected.map((event, index) => [
      event.id,
      input[index].withDate ? 0 : event.runtimeStarted ? -12 : 3,
    ])),
  }
  const ranking = rankItems(projected, {
    kind: 'events',
    context,
    preferences: signedRuntimeTaste(taste),
    qualityPolicy: runtimeQualityPolicy({ kind: 'events', nowMs, city }),
  })
  const first = selectFirstScreen(ranking, { limit })
  const wrapperById = new Map(input.map(wrapper => [wrapper.e.id, wrapper]))
  const scoreById = new Map(ranking.scored.map(scored => [scored.id, scored]))
  const selectedIds = new Set(first.selectedScored.map(scored => scored.id))
  const selected = first.selectedScored.map(scored => decorated(wrapperById.get(scored.id), scored, imagePolicy))
  const ordered = first.ordered.map(event => {
    const wrapper = wrapperById.get(event.id)
    return selectedIds.has(event.id) ? decorated(wrapper, scoreById.get(event.id), imagePolicy) : wrapper
  })
  const selectedScored = first.selectedScored.map(scored => ({
    ...scored,
    item: selected.find(wrapper => wrapper.e.id === scored.id),
  }))
  return {
    selected,
    ordered,
    selectedScored,
    scored: ranking.scored,
    limited: first.limited,
    availableLeadCount: first.availableLeadCount,
    reachability: first.reachability,
  }
}
