import { validImageSha256, validateImageReference } from './image-reference.mjs'

const ROLE_ORDER = ['exact-item', 'verified-venue', 'contextual', 'fallback']
const ROLE_RANK = new Map(ROLE_ORDER.map((role, index) => [role, index]))
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const MAX = Object.freeze({
  itemId: 160,
  image: 2048,
  sourcePage: 2048,
  attribution: 512,
  author: 512,
  license: 128,
  licenseUrl: 2048,
  retrievedAt: 40,
  sha256: 71,
})

export const IMAGE_CANDIDATE_ROLES = Object.freeze([...ROLE_ORDER])

export const IMAGE_CANDIDATE_CODES = Object.freeze({
  ITEM_ID_INVALID: 'ITEM_ID_INVALID',
  ROLE_INVALID: 'ROLE_INVALID',
  IMAGE_INVALID: 'IMAGE_INVALID',
  LOCAL_PATH_UNSAFE: 'LOCAL_PATH_UNSAFE',
  SOURCE_PAGE_INVALID: 'SOURCE_PAGE_INVALID',
  ATTRIBUTION_REQUIRED: 'ATTRIBUTION_REQUIRED',
  AUTHOR_REQUIRED: 'AUTHOR_REQUIRED',
  LICENSE_REQUIRED: 'LICENSE_REQUIRED',
  LICENSE_URL_INVALID: 'LICENSE_URL_INVALID',
  RETRIEVED_AT_INVALID: 'RETRIEVED_AT_INVALID',
  SHA256_INVALID: 'SHA256_INVALID',
  POLICY_UNKNOWN: 'POLICY_UNKNOWN',
  LICENSE_NOT_ALLOWED: 'LICENSE_NOT_ALLOWED',
  REMOTE_HOST_NOT_ALLOWED: 'REMOTE_HOST_NOT_ALLOWED',
  SELF_HOSTED_NOT_ALLOWED: 'SELF_HOSTED_NOT_ALLOWED',
  MIXED_ITEM_IDS: 'MIXED_ITEM_IDS',
  NO_READY_CANDIDATE: 'NO_READY_CANDIDATE',
})

const compareText = (left, right) => String(left) < String(right) ? -1 : (String(left) > String(right) ? 1 : 0)
const nonEmptyString = (value, maximum) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum

function httpsUrl(value, maximum = MAX.image) {
  const reference = validateImageReference(value, { maximumLength: maximum })
  if (reference.kind !== 'remote') return null
  return new URL(reference.url)
}

function completePolicy(policy) {
  return policy && typeof policy === 'object' && !Array.isArray(policy) &&
    Array.isArray(policy.allowedLicenses) && Array.isArray(policy.allowedRemoteHosts) &&
    typeof policy.allowSelfHosted === 'boolean'
}

function normalizePolicy(policy) {
  if (!completePolicy(policy)) return null
  const licenses = policy.allowedLicenses
  const hosts = policy.allowedRemoteHosts
  if (!licenses.every((value) => nonEmptyString(value, MAX.license)) ||
      !hosts.every((value) => nonEmptyString(value, 253))) return null
  return {
    allowedLicenses: new Set(licenses.map((value) => value.trim().toLowerCase())),
    allowedRemoteHosts: new Set(hosts.map((value) => value.trim().toLowerCase())),
    allowSelfHosted: policy.allowSelfHosted,
  }
}

function receiptErrors(candidate) {
  const errors = []
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [IMAGE_CANDIDATE_CODES.ITEM_ID_INVALID]
  if (!nonEmptyString(candidate.itemId, MAX.itemId)) errors.push(IMAGE_CANDIDATE_CODES.ITEM_ID_INVALID)
  if (!ROLE_RANK.has(candidate.role)) errors.push(IMAGE_CANDIDATE_CODES.ROLE_INVALID)

  const imageReference = validateImageReference(candidate.image, { maximumLength: MAX.image })
  const remote = imageReference.kind === 'remote'
  const local = imageReference.kind === 'selfHosted'
  if (!remote && !local) {
    errors.push(typeof candidate.image === 'string' && candidate.image.trim().startsWith('/')
      ? IMAGE_CANDIDATE_CODES.LOCAL_PATH_UNSAFE
      : IMAGE_CANDIDATE_CODES.IMAGE_INVALID)
  }
  if (!httpsUrl(candidate.sourcePage, MAX.sourcePage)) errors.push(IMAGE_CANDIDATE_CODES.SOURCE_PAGE_INVALID)
  if (!nonEmptyString(candidate.attribution, MAX.attribution)) errors.push(IMAGE_CANDIDATE_CODES.ATTRIBUTION_REQUIRED)
  if (!nonEmptyString(candidate.author, MAX.author)) errors.push(IMAGE_CANDIDATE_CODES.AUTHOR_REQUIRED)
  if (!nonEmptyString(candidate.license, MAX.license)) errors.push(IMAGE_CANDIDATE_CODES.LICENSE_REQUIRED)
  if (candidate.licenseUrl != null && !httpsUrl(candidate.licenseUrl, MAX.licenseUrl)) errors.push(IMAGE_CANDIDATE_CODES.LICENSE_URL_INVALID)
  if (!nonEmptyString(candidate.retrievedAt, MAX.retrievedAt) || !ISO_UTC.test(candidate.retrievedAt) ||
      Number.isNaN(Date.parse(candidate.retrievedAt))) {
    errors.push(IMAGE_CANDIDATE_CODES.RETRIEVED_AT_INVALID)
  }
  if ((local && !validImageSha256(candidate.sha256)) ||
      (candidate.sha256 != null && !validImageSha256(candidate.sha256))) {
    errors.push(IMAGE_CANDIDATE_CODES.SHA256_INVALID)
  }
  return errors
}

function normalizedCandidate(candidate) {
  const reference = validateImageReference(candidate.image, { maximumLength: MAX.image })
  const remote = reference.kind === 'remote'
  return {
    itemId: candidate.itemId.trim(),
    role: candidate.role,
    image: candidate.image.trim(),
    delivery: remote ? 'remote' : 'self-hosted',
    host: remote ? reference.host : null,
    sourcePage: candidate.sourcePage.trim(),
    attribution: candidate.attribution.trim(),
    author: candidate.author.trim(),
    license: candidate.license.trim(),
    licenseUrl: candidate.licenseUrl == null ? null : candidate.licenseUrl.trim(),
    retrievedAt: candidate.retrievedAt.trim(),
    sha256: candidate.sha256 == null ? null : candidate.sha256.trim().toLowerCase(),
  }
}

/**
 * Validates captured receipt metadata only. It never fetches an image and never
 * derives a license or permission from an image host.
 */
export function validateImageCandidate(candidate, { policy } = {}) {
  const errors = receiptErrors(candidate)
  if (errors.length > 0) return { state: 'rejected', errors, candidate: null }

  const normalized = normalizedCandidate(candidate)
  const normalizedPolicy = normalizePolicy(policy)
  if (!normalizedPolicy) {
    return { state: 'unknown', errors: [IMAGE_CANDIDATE_CODES.POLICY_UNKNOWN], candidate: normalized }
  }
  if (!normalizedPolicy.allowedLicenses.has(normalized.license.toLowerCase())) {
    return { state: 'rejected', errors: [IMAGE_CANDIDATE_CODES.LICENSE_NOT_ALLOWED], candidate: normalized }
  }
  if (normalized.delivery === 'self-hosted' && !normalizedPolicy.allowSelfHosted) {
    return { state: 'rejected', errors: [IMAGE_CANDIDATE_CODES.SELF_HOSTED_NOT_ALLOWED], candidate: normalized }
  }
  if (normalized.delivery === 'remote' && !normalizedPolicy.allowedRemoteHosts.has(normalized.host)) {
    return { state: 'rejected', errors: [IMAGE_CANDIDATE_CODES.REMOTE_HOST_NOT_ALLOWED], candidate: normalized }
  }
  return { state: 'ready', errors: [], candidate: normalized }
}

function candidateOrder(left, right) {
  return ROLE_RANK.get(left.candidate.role) - ROLE_RANK.get(right.candidate.role) ||
    compareText(left.candidate.image, right.candidate.image) ||
    compareText(left.candidate.sourcePage, right.candidate.sourcePage) ||
    compareText(left.candidate.sha256 || '', right.candidate.sha256 || '')
}

/**
 * Selects only a ready receipt. The returned role is the candidate's recorded
 * role, so a venue, contextual, or fallback image is never promoted to exact.
 */
export function selectImageCandidate(candidates, { policy } = {}) {
  if (!Array.isArray(candidates)) throw new Error('candidates must be an array')
  const assessments = candidates.map((candidate) => validateImageCandidate(candidate, { policy }))
  const itemIds = new Set(candidates
    .filter((candidate) => candidate && typeof candidate === 'object' && nonEmptyString(candidate.itemId, MAX.itemId))
    .map((candidate) => candidate.itemId.trim()))
  if (itemIds.size > 1) {
    return {
      state: 'none',
      role: null,
      candidate: null,
      reasons: [IMAGE_CANDIDATE_CODES.MIXED_ITEM_IDS],
      assessments,
    }
  }
  const ready = assessments.filter((assessment) => assessment.state === 'ready').sort(candidateOrder)
  if (ready.length > 0) {
    const chosen = ready[0].candidate
    return {
      state: chosen.role === 'fallback' ? 'fallback' : 'selected',
      role: chosen.role,
      candidate: chosen,
      reasons: [],
      assessments,
    }
  }

  const reasons = [...new Set(assessments.flatMap((assessment) => assessment.errors))].sort(compareText)
  return {
    state: 'none',
    role: null,
    candidate: null,
    reasons: [IMAGE_CANDIDATE_CODES.NO_READY_CANDIDATE, ...reasons],
    assessments,
  }
}
