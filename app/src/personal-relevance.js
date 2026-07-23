// Pure, on-device personal relevance. This module translates the existing
// taste-v1 document into the shared ranker's bounded preference input. It does
// not decide objective quality, context, membership, or eligibility.

export const PERSONAL_PROFILE_VERSION = 1
export const PERSONAL_SCORE_LIMIT = 12

const LEARNED_SCORE_LIMIT = 25
const LEARNED_WEIGHT = 6
const EXPLICIT_WEIGHT = 6
const FREE_WEIGHT = 3
const MAX_PROFILE_MAP_KEYS = 128
const MAX_PROFILE_LIST_ITEMS = 32
const MAX_TOKEN_LENGTH = 80
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const WHEN_VALUES = new Set(['weeknights', 'weekends', 'whenever', null])

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function text(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized && normalized.length <= MAX_TOKEN_LENGTH ? normalized : null
}

function identifier(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function neutral(reason) {
  return Object.freeze({
    state: 'neutral',
    reason,
    version: PERSONAL_PROFILE_VERSION,
    n: 0,
    categoryScores: Object.freeze({}),
    avoidScores: Object.freeze({}),
    placeTypeScores: Object.freeze({}),
    activityScores: Object.freeze({}),
    freeAffinity: 0,
    boost: Object.freeze([]),
    mute: Object.freeze([]),
  })
}

function validNumber(value, { min = 0, max = LEARNED_SCORE_LIMIT, integer = false } = {}) {
  return Number.isFinite(value)
    && value >= min
    && value <= max
    && (!integer || Number.isInteger(value))
}

function scoreMap(value, { signed = false } = {}) {
  if (value == null) return {}
  if (!plainObject(value)) return null
  const entries = Object.entries(value)
  if (entries.length > MAX_PROFILE_MAP_KEYS) return null
  const result = {}
  for (const [rawKey, rawScore] of entries) {
    const key = text(rawKey)
    const min = signed ? -LEARNED_SCORE_LIMIT : 0
    if (!key || UNSAFE_KEYS.has(key) || !validNumber(rawScore, { min })) return null
    if (rawScore !== 0) result[key] = rawScore
  }
  return result
}

function stringList(value) {
  if (value == null) return []
  if (!Array.isArray(value)) return null
  if (value.length > MAX_PROFILE_LIST_ITEMS) return null
  const result = []
  const seen = new Set()
  for (const raw of value) {
    const item = text(raw)
    if (!item || seen.has(item)) return null
    seen.add(item)
    result.push(item)
  }
  return result
}

function recognizedLegacyProfile(value) {
  // Early callers and deterministic tests used the same taste-v1 payload
  // before carrying its explicit `v` member. Keep that exact, bounded shape
  // readable; an arbitrary unversioned object still fails neutral.
  return !own(value, 'v')
    && own(value, 'catScores')
    && own(value, 'freeAffinity')
    && own(value, 'n')
    && own(value, 'prefs')
}

/**
 * Strictly validate a taste-v1 document. Missing, malformed, and explicitly
 * wrong-version values become a neutral profile as one atomic decision; valid
 * fragments from a corrupt document are never partially trusted.
 */
export function normalizePersonalProfile(value) {
  if (value == null) return neutral('absent')
  if (!plainObject(value)) return neutral('corrupt')
  const legacy = recognizedLegacyProfile(value)
  if (!legacy && value.v !== PERSONAL_PROFILE_VERSION) {
    return neutral(own(value, 'v') ? 'wrong-version' : 'corrupt')
  }
  if (!validNumber(value.n, { max: Number.MAX_SAFE_INTEGER, integer: true })) return neutral('corrupt')
  if (value.organicN != null && !validNumber(value.organicN, { max: value.n, integer: true })) return neutral('corrupt')
  if (value.freeAffinity == null || !validNumber(value.freeAffinity)) return neutral('corrupt')
  const categoryScores = scoreMap(value.catScores)
  const avoidScores = scoreMap(value.avoidScores)
  const placeTypeScores = scoreMap(value.placeTypeScores, { signed: true })
  const activityScores = scoreMap(value.activityScores, { signed: true })
  if (!categoryScores || !avoidScores || !placeTypeScores || !activityScores) return neutral('corrupt')

  const prefs = value.prefs == null ? {} : value.prefs
  if (!plainObject(prefs)) return neutral('corrupt')
  const boost = stringList(prefs.boost)
  const mute = stringList(prefs.mute)
  if (!boost || !mute || !WHEN_VALUES.has(prefs.when ?? null)) return neutral('corrupt')
  const boosted = new Set(boost)
  if (mute.some(item => boosted.has(item))) return neutral('corrupt')

  return Object.freeze({
    state: 'valid',
    reason: legacy ? 'legacy-v1' : 'valid',
    version: PERSONAL_PROFILE_VERSION,
    n: value.n,
    categoryScores: Object.freeze(categoryScores),
    avoidScores: Object.freeze(avoidScores),
    placeTypeScores: Object.freeze(placeTypeScores),
    activityScores: Object.freeze(activityScores),
    freeAffinity: value.freeAffinity,
    boost: Object.freeze(boost),
    mute: Object.freeze(mute),
  })
}

function learnedScore(value, n) {
  if (n <= 0 || !Number.isFinite(value)) return 0
  return clamp((value / LEARNED_SCORE_LIMIT) * LEARNED_WEIGHT, -LEARNED_WEIGHT, LEARNED_WEIGHT)
}

function tokenScore(token, map, profile, storageKey = null) {
  const key = text(token)
  if (!key) return 0
  if (profile.mute.includes(key)) return -PERSONAL_SCORE_LIMIT
  const explicit = profile.boost.includes(key) ? EXPLICIT_WEIGHT : 0
  const learned = learnedScore(own(map, key) ? map[key] : 0, profile.n)
  const avoidKey = storageKey || key
  const avoided = learnedScore(own(profile.avoidScores, avoidKey) ? profile.avoidScores[avoidKey] : 0, profile.n)
  return clamp(learned - avoided + explicit, -PERSONAL_SCORE_LIMIT, PERSONAL_SCORE_LIMIT)
}

function namespacedTokenScore(token, namespace, map, profile) {
  const key = text(token)
  if (!key) return 0
  const storageKey = `${namespace}:${key}`
  const score = own(map, key) ? map[key] : profile.categoryScores[storageKey]
  const combined = { [key]: score }
  return tokenScore(key, combined, profile, storageKey)
}

function evidenceTokens(item, keys) {
  const tokens = new Set()
  for (const key of keys) {
    const raw = item?.[key]
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      const token = text(value)
      if (token) tokens.add(token)
    }
  }
  return [...tokens]
}

function combinedEvidenceScore(groups) {
  const scores = groups.flat().filter(score => Number.isFinite(score) && score !== 0)
  // An explicit "less" on any exact evidence token must remain a real signed
  // signal; unrelated positive evidence cannot silently erase it.
  if (scores.includes(-PERSONAL_SCORE_LIMIT)) return -PERSONAL_SCORE_LIMIT
  return clamp(scores.reduce((total, score) => total + score, 0), -PERSONAL_SCORE_LIMIT, PERSONAL_SCORE_LIMIT)
}

export function personalScoreFor(item, { kind, profile } = {}) {
  if (kind !== 'events' && kind !== 'places') throw new TypeError('kind must be events or places')
  const normalized = profile?.state ? profile : normalizePersonalProfile(profile)
  if (normalized.state !== 'valid') return 0
  const categories = evidenceTokens(item, ['category', 'categories', 'rawCategories'])
  const category = categories.map(token => tokenScore(token, normalized.categoryScores, normalized))
  if (kind === 'events') {
    const free = item?.isFree === true
      ? learnedScore(normalized.freeAffinity, normalized.n) * (FREE_WEIGHT / LEARNED_WEIGHT)
      : 0
    return combinedEvidenceScore([category, [free]])
  }
  const placeTypes = evidenceTokens(item, ['placeType', 'placeTypes', 'classes'])
  const activities = evidenceTokens(item, ['activity', 'activities', 'activityIds', 'amenities'])
  return combinedEvidenceScore([
    category,
    placeTypes.map(token => namespacedTokenScore(token, 'place', normalized.placeTypeScores, normalized)),
    activities.map(token => namespacedTokenScore(token, 'activity', normalized.activityScores, normalized)),
  ])
}

/**
 * Build the shared ranker's preference policy without exposing profile math to
 * callers. Events use their category facet directly. Places use per-item
 * scores so place type, classes, activity, and amenity evidence can contribute.
 */
export function buildPersonalPreferences(value, { kind = 'events', items = [] } = {}) {
  if (kind !== 'events' && kind !== 'places') throw new TypeError('kind must be events or places')
  if (!Array.isArray(items)) throw new TypeError('items must be an array')
  const profile = normalizePersonalProfile(value)
  if (profile.state !== 'valid') {
    return Object.freeze({
      categoryScores: Object.freeze({}),
      itemScores: Object.freeze({}),
      freeAffinity: 0,
      profileState: profile.state,
      profileReason: profile.reason,
    })
  }

  if (kind === 'events') {
    const categories = new Set(items.flatMap(item => evidenceTokens(item, ['category', 'categories', 'rawCategories'])))
    // Empty `items` is useful to callers that only need the legacy category
    // policy. In that case retain every validated category signal.
    if (categories.size === 0) {
      for (const key of Object.keys(profile.categoryScores)) {
        if (!key.includes(':')) categories.add(key)
      }
      for (const key of Object.keys(profile.avoidScores)) {
        if (!key.includes(':')) categories.add(key)
      }
      for (const key of profile.boost) categories.add(key)
      for (const key of profile.mute) categories.add(key)
    }
    const categoryScores = {}
    for (const category of categories) {
      const score = tokenScore(category, profile.categoryScores, profile)
      if (score !== 0) categoryScores[category] = score
    }
    return Object.freeze({
      categoryScores: Object.freeze(categoryScores),
      itemScores: Object.freeze({}),
      freeAffinity: profile.n > 0
        ? clamp((profile.freeAffinity / LEARNED_SCORE_LIMIT) * FREE_WEIGHT, 0, FREE_WEIGHT)
        : 0,
      profileState: profile.state,
      profileReason: profile.reason,
    })
  }

  const itemScores = {}
  for (const item of items) {
    const id = identifier(item?.id) || identifier(item?.key)
    if (!id) throw new TypeError('place item needs id or key')
    const score = personalScoreFor(item, { kind, profile })
    if (score !== 0) itemScores[id] = score
  }
  return Object.freeze({
    categoryScores: Object.freeze({}),
    itemScores: Object.freeze(itemScores),
    freeAffinity: 0,
    profileState: profile.state,
    profileReason: profile.reason,
  })
}
