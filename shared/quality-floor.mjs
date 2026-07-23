import { eventActionability } from './city-time.mjs'

const KINDS = new Set(['events', 'places'])
const BLOCKER_ORDER = [
  'KNOWN_JUNK',
  'KNOWN_FALSE_MERGE',
  'INVALID_EVENT_TIME',
  'EVENT_CANCELLED',
  'EVENT_POSTPONED',
  'EVENT_SOLD_OUT',
  'EVENT_ENDED',
  'OUTSIDE_MARKET_BBOX',
  'MARKET_CONFLICT',
  'ADDRESS_MARKET_CONFLICT',
]
const DEMOTION_FACTS = [
  ['lowInformation', 'LOW_INFORMATION'],
  ['isChain', 'CHAIN'],
  ['isGeneric', 'GENERIC'],
  ['isBusiness', 'BUSINESS'],
  ['isRecurring', 'RECURRING'],
]
const US_STATES = new Map([
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['DC', 'District of Columbia'],
])
const STATE_SUFFIX = [...US_STATES.entries()]
  .flatMap(([code, name]) => [code, name])
  .sort((left, right) => right.length - left.length)
  .map(value => value.replace(/ /g, '\\s+'))
  .join('|')
const TERMINAL_US_STATE = new RegExp(`,\\s*(${STATE_SUFFIX})(?:\\s+\\d{5}(?:-\\d{4})?)?(?:\\s*,?\\s*(?:USA|United\\s+States(?:\\s+of\\s+America)?))?\\s*$`, 'i')

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function idSet(value, label) {
  invariant(Array.isArray(value), `${label} must be an array`)
  const ids = new Set()
  for (const id of value) {
    invariant(nonEmptyString(id), `${label} must contain non-empty string IDs`)
    ids.add(id)
  }
  return ids
}

function bbox(value) {
  invariant(plainObject(value), 'market.bbox must be an object')
  for (const key of ['latMin', 'latMax', 'lngMin', 'lngMax']) invariant(Number.isFinite(value[key]), `market.bbox.${key} must be finite`)
  invariant(value.latMin >= -90 && value.latMax <= 90 && value.latMin < value.latMax, 'market.bbox latitude bounds are invalid')
  invariant(value.lngMin >= -180 && value.lngMax <= 180 && value.lngMin < value.lngMax, 'market.bbox longitude bounds are invalid')
  return value
}

function validTimeZone(value) {
  if (!nonEmptyString(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

function regionCodes(value) {
  invariant(Array.isArray(value) && value.length > 0, 'market.regionCodes must be a non-empty array')
  const codes = [...new Set(value)]
  for (const code of codes) invariant(typeof code === 'string' && US_STATES.has(code), 'market.regionCodes must contain US state abbreviations')
  return codes.sort()
}

function validatePolicy(policy) {
  invariant(plainObject(policy), 'policy must be an object')
  invariant(KINDS.has(policy.kind), 'policy.kind must be events or places')
  invariant(Number.isFinite(policy.nowMs), 'policy.nowMs must be finite')
  invariant(validTimeZone(policy.timeZone), 'policy.timeZone must be a valid IANA timezone')
  invariant(plainObject(policy.market) && nonEmptyString(policy.market.id), 'policy.market.id is required')
  return {
    kind: policy.kind,
    nowMs: policy.nowMs,
    timeZone: policy.timeZone,
    market: { id: policy.market.id, bbox: bbox(policy.market.bbox), regionCodes: regionCodes(policy.market.regionCodes) },
    knownJunkIds: idSet(policy.knownJunkIds || [], 'policy.knownJunkIds'),
    knownFalseMergeIds: idSet(policy.knownFalseMergeIds || [], 'policy.knownFalseMergeIds'),
  }
}

function insideBbox(row, marketBbox) {
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return true
  return row.lat >= marketBbox.latMin && row.lat <= marketBbox.latMax
    && row.lng >= marketBbox.lngMin && row.lng <= marketBbox.lngMax
}

function eventBlocker(row, policy) {
  const availability = eventActionability(row, { nowMs: policy.nowMs, timeZone: policy.timeZone })
  if (availability.code === 'invalid') return 'INVALID_EVENT_TIME'
  if (availability.code === 'cancelled') return 'EVENT_CANCELLED'
  if (availability.code === 'postponed') return 'EVENT_POSTPONED'
  if (availability.code === 'sold-out') return 'EVENT_SOLD_OUT'
  if (availability.code === 'ended') return 'EVENT_ENDED'
  return null
}

function terminalUsState(address) {
  if (!nonEmptyString(address)) return null
  const match = address.trim().match(TERMINAL_US_STATE)
  if (!match) return null
  const token = match[1].replace(/\s+/g, ' ').toLowerCase()
  for (const [code, name] of US_STATES) {
    if (token === code.toLowerCase() || token === name.toLowerCase()) return code
  }
  return null
}

function explicitMarketBlockers(row, market) {
  const codes = []
  if (nonEmptyString(row.marketId) && row.marketId !== market.id) codes.push('MARKET_CONFLICT')
  if (nonEmptyString(row.addressMarketId) && row.addressMarketId !== market.id) codes.push('ADDRESS_MARKET_CONFLICT')
  const state = terminalUsState(row.address)
  if (state && !market.regionCodes.includes(state)) codes.push('ADDRESS_MARKET_CONFLICT')
  return codes
}

function demotions(row) {
  return DEMOTION_FACTS.filter(([field]) => row[field] === true).map(([, code]) => code)
}

/**
 * Annotate every row against an objective, explicit quality floor. The input is
 * not sorted, deleted, or otherwise mutated; demotion evidence is deliberately
 * separate from eligibility so this module cannot become a ranking policy.
 */
export function annotateQualityFloor(rows, policy) {
  invariant(Array.isArray(rows), 'rows must be an array')
  const normalizedPolicy = validatePolicy(policy)
  return rows.map((row, index) => {
    invariant(plainObject(row), `rows[${index}] must be an object`)
    invariant(nonEmptyString(row.id), `rows[${index}].id must be a non-empty string`)
    const blockers = new Set()
    if (normalizedPolicy.knownJunkIds.has(row.id)) blockers.add('KNOWN_JUNK')
    if (normalizedPolicy.knownFalseMergeIds.has(row.id)) blockers.add('KNOWN_FALSE_MERGE')
    if (normalizedPolicy.kind === 'events') {
      const code = eventBlocker(row, normalizedPolicy)
      if (code) blockers.add(code)
    }
    if (!insideBbox(row, normalizedPolicy.market.bbox)) blockers.add('OUTSIDE_MARKET_BBOX')
    for (const code of explicitMarketBlockers(row, normalizedPolicy.market)) blockers.add(code)
    const blockerCodes = BLOCKER_ORDER.filter(code => blockers.has(code))
    return {
      ...row,
      decisionEligible: blockerCodes.length === 0,
      qualityFloor: {
        blockerCodes,
        demotionCodes: demotions(row),
      },
    }
  })
}

/** Report whether a top-ranked sample has any objective quality-floor blocker. */
export function assessTopSample(annotatedOrRanked, { limit = 50, cityLimited = false } = {}) {
  invariant(Array.isArray(annotatedOrRanked), 'annotatedOrRanked must be an array')
  invariant(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer')
  invariant(typeof cityLimited === 'boolean', 'cityLimited must be boolean')
  const sample = annotatedOrRanked.slice(0, limit)
  const blockers = []
  for (const [index, row] of sample.entries()) {
    invariant(plainObject(row) && nonEmptyString(row.id), `sample row ${index} must have an id`)
    const codes = row.qualityFloor?.blockerCodes
    invariant(Array.isArray(codes), `sample row ${row.id} is missing qualityFloor.blockerCodes`)
    if (codes.length > 0) blockers.push({ id: row.id, codes: [...codes] })
  }
  return {
    limit,
    sampleCount: sample.length,
    cityLimited,
    blockers,
    blockerIds: blockers.map(entry => entry.id),
    state: blockers.length > 0 ? 'blocked' : cityLimited ? 'limited' : 'pass',
    passes: blockers.length === 0,
  }
}
