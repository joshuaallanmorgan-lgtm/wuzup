import { milesBetween } from './lib.js'
import { isOpenNow } from './places.js'
import { rankRuntimeItems } from './relevance.js'

export const SPOT_NEAR_RADIUS_MILES = 12

const GENERIC_NAME = /^(?:park|city park|public park|playground|dog park|boat ramp|trail|public beach|community center|recreation center|sports complex)$/i
const DISTANCE_MODES = new Set(['browse', 'nearby', 'additional', 'theme', 'activity', 'similar'])

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteCoords(value) {
  return plainObject(value) && Number.isFinite(value.lat) && Number.isFinite(value.lng)
}

function placeId(place) {
  return text(place?.id) || text(place?.key)
}

function factCount(place) {
  return [
    typeof place.description === 'string' && place.description.trim().length >= 40,
    Array.isArray(place.amenities) && place.amenities.length > 0,
    Boolean(text(place.hours)),
    Boolean(text(place.address)),
    Boolean(text(place.designation)),
    Boolean(text(place.operator)),
  ].filter(Boolean).length
}

export function spotHoursConfidence(place, { nowMs, timeZone } = {}) {
  const listed = Boolean(text(place?.hours))
  if (!listed) return Object.freeze({ state: 'unknown', listed: false, openConfirmed: false })
  const openConfirmed = Number.isFinite(nowMs) && text(timeZone)
    ? isOpenNow(place, { nowMs, timeZone })
    : false
  return Object.freeze({
    state: openConfirmed ? 'open-confirmed' : 'listed-unconfirmed',
    listed: true,
    openConfirmed,
  })
}

export function spotDistanceMiles(place, coords) {
  if (!finiteCoords(coords) || !finiteCoords(place)) return null
  const distance = milesBetween(coords, place)
  return Number.isFinite(distance) ? distance : null
}

function genericPlace(place) {
  if (place.isGeneric === true) return true
  const name = text(place.name) || text(place.title)
  return Boolean(name && GENERIC_NAME.test(name))
}

function rankingPlace(place, { coords, attachDistance }) {
  const distanceMiles = spotDistanceMiles(place, coords)
  return {
    ...place,
    lowInformation: place.lowInformation === true || factCount(place) === 0,
    isGeneric: genericPlace(place),
    isChain: place.isChain === true || place.brandIsChain === true || place.chain === true,
    isBusiness: place.isBusiness === true,
    ...(attachDistance && distanceMiles != null ? { _dist: distanceMiles } : {}),
  }
}

function activityFit(activity, place) {
  if (!activity) return null
  if (typeof activity.match !== 'function') return false
  try {
    return activity.match(place) === true
  } catch {
    return false
  }
}

function distanceScore(distanceMiles, radiusMiles, mode) {
  if (distanceMiles == null || !Number.isFinite(radiusMiles) || radiusMiles <= 0) return 0
  if (distanceMiles > radiusMiles) return 0
  const closeness = distanceMiles <= radiusMiles / 3 ? 3 : distanceMiles <= radiusMiles * 2 / 3 ? 2 : 1
  // Distance is intentionally smaller than activity + amenity/hour substance.
  // It can refine a credible order; it cannot turn the nearest thin record into
  // an unsupported quality claim.
  return mode === 'browse' || mode === 'additional' ? Math.min(closeness, 1) : closeness
}

/** Build a serializable explanation for every spot-context score. */
export function inspectSpotContext(items, {
  coords = null,
  radiusMiles = SPOT_NEAR_RADIUS_MILES,
  activity = null,
  nowMs,
  timeZone,
  mode = 'browse',
} = {}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array')
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite')
  if (!text(timeZone)) throw new TypeError('timeZone is required')
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) throw new TypeError('radiusMiles must be positive')
  if (!DISTANCE_MODES.has(mode)) throw new TypeError('unsupported spot context mode')

  const factsById = {}
  const itemScores = {}
  for (const [index, place] of items.entries()) {
    const id = placeId(place)
    if (!id) throw new TypeError(`items[${index}] must have an id or key`)
    const distanceMiles = spotDistanceMiles(place, coords)
    const withinRadius = distanceMiles != null && distanceMiles <= radiusMiles
    const fit = activityFit(activity, place)
    const amenities = Array.isArray(place.amenities) ? place.amenities.filter(text) : []
    const hours = spotHoursConfidence(place, { nowMs, timeZone })
    const components = {
      activity: fit === true ? 6 : fit === false ? -6 : 0,
      amenities: Math.min(3, amenities.length),
      hours: hours.openConfirmed ? 2 : hours.listed ? 1 : 0,
      distance: distanceScore(distanceMiles, radiusMiles, mode),
    }
    const score = Object.values(components).reduce((total, value) => total + value, 0)
    itemScores[id] = score
    factsById[id] = Object.freeze({
      id,
      mode,
      activityId: text(activity?.id),
      activityFit: fit,
      amenityCount: amenities.length,
      hours,
      hasCoordinates: finiteCoords(place),
      hasLocationFix: finiteCoords(coords),
      distanceMiles,
      radiusMiles,
      withinRadius,
      lowInformation: place.lowInformation === true,
      isGeneric: place.isGeneric === true,
      isChain: place.isChain === true,
      components: Object.freeze(components),
      score,
    })
  }
  return Object.freeze({
    mode,
    radiusMiles,
    hasLocationFix: finiteCoords(coords),
    activityId: text(activity?.id),
    factsById: Object.freeze(factsById),
    context: Object.freeze({
      itemScores: Object.freeze(itemScores),
      ...(activity?.id === 'free' ? { free: true } : {}),
    }),
  })
}

/**
 * Route a complete place set through the shared objective rank contract.
 * Membership is preserved; `withinRadius` is only a context-specific view.
 */
export function rankSpots(items, {
  nowMs,
  city,
  taste = {},
  coords = null,
  radiusMiles = SPOT_NEAR_RADIUS_MILES,
  activity = null,
  mode = 'browse',
  attachDistance = false,
  diversityPolicy = null,
} = {}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array')
  if (!plainObject(city) || !text(city.tz)) throw new TypeError('city with time zone is required')
  const prepared = items.map(place => rankingPlace(place, { coords, attachDistance }))
  const inspection = inspectSpotContext(prepared, {
    coords,
    radiusMiles,
    activity,
    nowMs,
    timeZone: city.tz,
    mode,
  })
  const ranking = rankRuntimeItems(prepared, {
    kind: 'places',
    nowMs,
    city,
    taste,
    context: inspection.context,
    diversityPolicy,
  })
  return {
    ...ranking,
    contextInspection: inspection,
    withinRadius: ranking.ordered.filter(place => inspection.factsById[placeId(place)]?.withinRadius === true),
  }
}
