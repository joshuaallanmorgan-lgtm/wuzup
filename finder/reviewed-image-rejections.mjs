const DISPOSITIONS = new Set([
  'remove-or-replace',
  'quarantine-noncanonical-duplicate',
  'quarantine-pending-canonical-choice',
])

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty, exact string`)
  }
  return value
}

function normalizeEvidence(evidence, label) {
  if (!isRecord(evidence)) throw new TypeError(`${label} must be an object`)

  const keys = Object.keys(evidence).sort()
  const expected = ['report', 'reportSha256', 'reviewRow']
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly report, reportSha256, and reviewRow`)
  }

  const report = exactText(evidence.report, `${label}.report`)
  const reportSha256 = exactText(evidence.reportSha256, `${label}.reportSha256`)
  if (!/^sha256:[a-f0-9]{64}$/.test(reportSha256)) {
    throw new TypeError(`${label}.reportSha256 must be a lowercase sha256 digest`)
  }
  if (!Number.isSafeInteger(evidence.reviewRow) || evidence.reviewRow < 1) {
    throw new TypeError(`${label}.reviewRow must be a positive integer`)
  }

  return Object.freeze({ report, reportSha256, reviewRow: evidence.reviewRow })
}

function normalizeRejection(entry, { cityId, keyedPlaceKey = null, index = null } = {}) {
  const label = index === null ? `image rejection '${keyedPlaceKey || 'unknown'}'` : `image rejection ${index}`
  if (!isRecord(entry)) throw new TypeError(`${label} must be an object`)

  const expected = [
    'cityId', 'disposition', 'evidence', 'image', 'placeKey', 'reason', 'sourceFamily', 'sourcePage',
  ]
  const keys = Object.keys(entry).sort()
  const permittedInput = cityId
    ? expected.filter(key => key !== 'cityId')
    : expected
  if (keys.length !== permittedInput.length || keys.some((key, keyIndex) => key !== permittedInput[keyIndex])) {
    throw new TypeError(`${label} contains missing or unknown fields`)
  }

  const resolvedCityId = cityId
    ? exactText(cityId, `${label}.cityId`)
    : exactText(entry.cityId, `${label}.cityId`)
  const placeKey = exactText(entry.placeKey, `${label}.placeKey`)
  if (!placeKey.startsWith('p|')) throw new TypeError(`${label}.placeKey must start with 'p|'`)
  if (keyedPlaceKey !== null && placeKey !== keyedPlaceKey) {
    throw new TypeError(`${label}.placeKey must match its registry key`)
  }

  const disposition = exactText(entry.disposition, `${label}.disposition`)
  if (!DISPOSITIONS.has(disposition)) throw new TypeError(`${label}.disposition is unsupported`)

  return Object.freeze({
    cityId: resolvedCityId,
    placeKey,
    image: exactText(entry.image, `${label}.image`),
    sourcePage: exactText(entry.sourcePage, `${label}.sourcePage`),
    sourceFamily: exactText(entry.sourceFamily, `${label}.sourceFamily`),
    evidence: normalizeEvidence(entry.evidence, `${label}.evidence`),
    disposition,
    reason: exactText(entry.reason, `${label}.reason`),
  })
}

/**
 * Validate and canonicalize an image-rejection registry.
 *
 * City configs pass an array plus `cityId`; correction writers may revalidate
 * the keyed object exported by the active city. The returned registry and every
 * nested value are frozen. Shared candidate URLs across different place keys
 * are intentionally allowed: rejection authority is exact-item scoped.
 */
export function validateReviewedImageRejects(input, options = {}) {
  const entries = []

  if (Array.isArray(input)) {
    const cityId = exactText(options.cityId, 'image rejection registry cityId')
    input.forEach((entry, index) => {
      entries.push(normalizeRejection(entry, { cityId, index }))
    })
  } else if (isRecord(input)) {
    if (options.cityId !== undefined) {
      throw new TypeError('keyed image rejection registries carry their own cityId')
    }
    Object.entries(input).forEach(([placeKey, entry]) => {
      entries.push(normalizeRejection(entry, { keyedPlaceKey: placeKey }))
    })
  } else {
    throw new TypeError('image rejection registry must be an array or keyed object')
  }

  const registry = Object.create(null)
  for (const entry of entries) {
    if (Object.hasOwn(registry, entry.placeKey)) {
      throw new TypeError(`duplicate image rejection for '${entry.placeKey}'`)
    }
    registry[entry.placeKey] = entry
  }

  return Object.freeze(registry)
}

export function defineReviewedImageRejects(cityId, entries) {
  return validateReviewedImageRejects(entries, { cityId })
}

function exactCandidate(candidate) {
  if (!isRecord(candidate)) throw new TypeError('image candidate must be an object')
  return {
    image: exactText(candidate.image, 'image candidate.image'),
    sourcePage: exactText(candidate.sourcePage, 'image candidate.sourcePage'),
    sourceFamily: exactText(candidate.sourceFamily, 'image candidate.sourceFamily'),
  }
}

/**
 * Match only the audited candidate on the audited exact item.
 *
 * `drift` is deliberately distinct from `reject`: a newly selected image or a
 * changed provenance tuple is never stripped under an older review decision.
 */
export function matchReviewedImageRejection(place, candidate, rejects) {
  if (!isRecord(place)) throw new TypeError('place must be an object')
  const placeKey = exactText(place.key, 'place.key')
  const normalizedCandidate = exactCandidate(candidate)
  const validated = validateReviewedImageRejects(rejects)
  const rejection = validated[placeKey] || null

  if (!rejection) return Object.freeze({ state: 'allow', rejection: null })

  const exact = rejection.image === normalizedCandidate.image
    && rejection.sourcePage === normalizedCandidate.sourcePage
    && rejection.sourceFamily === normalizedCandidate.sourceFamily

  return Object.freeze({ state: exact ? 'reject' : 'drift', rejection })
}
