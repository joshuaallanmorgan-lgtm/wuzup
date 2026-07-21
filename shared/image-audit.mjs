import { validImageSha256, validateImageReference } from './image-reference.mjs'

const POLICY_STATES = new Set(['ready', 'unknown', 'blocked'])
const CREDIT_FIELDS = ['imageCredit', 'imageAttribution', 'imageProvenance']

export const IMAGE_AUDIT_SCHEMA_VERSION = 1

export const IMAGE_AUDIT_FINDING_CODES = Object.freeze({
  INVALID_IMAGE_REFERENCE: 'INVALID_IMAGE_REFERENCE',
  DUPLICATE_IMAGE_URL: 'DUPLICATE_IMAGE_URL',
  ATTRIBUTION_EVIDENCE_MISSING: 'ATTRIBUTION_EVIDENCE_MISSING',
  LICENSE_EVIDENCE_MISSING: 'LICENSE_EVIDENCE_MISSING',
  POLICY_READINESS_UNKNOWN: 'POLICY_READINESS_UNKNOWN',
  POLICY_READINESS_BLOCKED: 'POLICY_READINESS_BLOCKED',
  SELF_HOSTED_BYTE_BINDING_MISSING: 'SELF_HOSTED_BYTE_BINDING_MISSING',
})

const compareText = (left, right) => String(left).localeCompare(String(right), 'en')
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0

function normalizeHosts(hosts) {
  if (hosts instanceof Set) return hosts
  if (!Array.isArray(hosts)) throw new Error('selfHostedHosts must be an array when provided')
  return new Set(hosts.filter(nonEmptyString).map((host) => host.trim().toLowerCase()))
}

function normalizePolicy(policy = {}) {
  if (policy == null || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('policy must be an object when provided')
  }

  const normalized = {}
  for (const kind of ['selfHosted', 'remote']) {
    const state = policy[kind] == null ? 'unknown' : policy[kind]
    if (!POLICY_STATES.has(state)) {
      throw new Error(`policy.${kind} must be ready, unknown, or blocked`)
    }
    normalized[kind] = state
  }
  return normalized
}

function imageValue(item) {
  return Object.hasOwn(item, 'image') ? item.image : null
}

function creditRecord(item) {
  for (const field of CREDIT_FIELDS) {
    const value = item[field]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return null
}

function hasAttributionEvidence(credit) {
  return Boolean(credit && ['author', 'credit', 'url', 'page', 'source', 'sourceFamily']
    .some((field) => nonEmptyString(credit[field])))
}

function hasLicenseEvidence(credit) {
  return Boolean(credit && nonEmptyString(credit.license))
}

function stableItemId(item, index) {
  for (const field of ['id', 'key']) {
    if (nonEmptyString(item[field])) return item[field]
  }
  return `index:${index}`
}

/**
 * Classify delivery only. A remote host, including a well-known media host, is
 * never evidence that the image is licensed or permitted to be displayed.
 */
export function classifyImageReference(value, { selfHostedHosts = [] } = {}) {
  return validateImageReference(value, { selfHostedHosts })
}

function byteBindingValue(item, credit) {
  return item.imageSha256 ?? credit?.sha256 ?? null
}

function itemAssessment(item, index, hosts, policy) {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`items[${index}] must be an object`)
  }

  const reference = classifyImageReference(imageValue(item), { selfHostedHosts: hosts })
  const credit = creditRecord(item)
  const attributionEvidence = hasAttributionEvidence(credit)
  const licenseEvidence = hasLicenseEvidence(credit)
  const byteBindingRequired = reference.kind === 'selfHosted'
  const byteBindingEvidence = !byteBindingRequired || validImageSha256(byteBindingValue(item, credit))
  let readiness = 'not-applicable'
  if (reference.kind === 'invalid') readiness = 'broken'
  if (reference.kind === 'selfHosted' || reference.kind === 'remote') {
    const configured = policy[reference.kind]
    readiness = configured === 'blocked' || !attributionEvidence || !licenseEvidence || !byteBindingEvidence
      ? 'blocked'
      : configured
  }

  return {
    itemId: stableItemId(item, index),
    index,
    ...reference,
    attributionEvidence,
    licenseEvidence,
    byteBindingRequired,
    byteBindingEvidence,
    readiness,
  }
}

function riskLevel(summary, selectionAvailable) {
  if (!selectionAvailable) return 'not-assessed'
  if (summary.readiness.broken > 0 || summary.readiness.blocked > 0) return 'high'
  if (summary.readiness.unknown > 0 || summary.duplicateReferences > 0 || summary.missingImages > 0) return 'elevated'
  return 'clear'
}

function summarize(assessments, { selectionAvailable }) {
  const imageAssessments = assessments.filter((item) => item.kind !== 'missing')
  const usableImages = imageAssessments.filter((item) => item.kind !== 'invalid')
  const counts = new Map()
  for (const item of usableImages) counts.set(item.url, (counts.get(item.url) || 0) + 1)
  const duplicateUrls = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([url, count]) => ({ url, count }))
    .sort((left, right) => right.count - left.count || compareText(left.url, right.url))
  const duplicateReferences = duplicateUrls.reduce((total, duplicate) => total + duplicate.count - 1, 0)
  const readiness = { ready: 0, unknown: 0, blocked: 0, broken: 0 }
  for (const item of imageAssessments) {
    if (Object.hasOwn(readiness, item.readiness)) readiness[item.readiness]++
  }

  const summary = {
    itemCount: assessments.length,
    imageBearing: imageAssessments.length,
    missingImages: assessments.filter((item) => item.kind === 'missing').length,
    invalidReferences: assessments.filter((item) => item.kind === 'invalid').length,
    selfHosted: usableImages.filter((item) => item.kind === 'selfHosted').length,
    remote: usableImages.filter((item) => item.kind === 'remote').length,
    remoteHosts: [...new Set(usableImages.filter((item) => item.kind === 'remote').map((item) => item.host))].sort(compareText),
    missingAttributionEvidence: usableImages.filter((item) => !item.attributionEvidence).length,
    missingLicenseEvidence: usableImages.filter((item) => !item.licenseEvidence).length,
    missingByteBindingEvidence: usableImages.filter((item) => item.byteBindingRequired && !item.byteBindingEvidence).length,
    duplicateUrlCount: duplicateUrls.length,
    duplicateReferences,
    duplicateUrls,
    readiness,
  }
  return { ...summary, risk: riskLevel(summary, selectionAvailable) }
}

function findingsFor(scope, summary) {
  const findings = []
  const add = (code, count) => {
    if (count > 0) findings.push({ code, scope, count })
  }
  add(IMAGE_AUDIT_FINDING_CODES.INVALID_IMAGE_REFERENCE, summary.invalidReferences)
  add(IMAGE_AUDIT_FINDING_CODES.DUPLICATE_IMAGE_URL, summary.duplicateReferences)
  add(IMAGE_AUDIT_FINDING_CODES.ATTRIBUTION_EVIDENCE_MISSING, summary.missingAttributionEvidence)
  add(IMAGE_AUDIT_FINDING_CODES.LICENSE_EVIDENCE_MISSING, summary.missingLicenseEvidence)
  add(IMAGE_AUDIT_FINDING_CODES.SELF_HOSTED_BYTE_BINDING_MISSING, summary.missingByteBindingEvidence)
  add(IMAGE_AUDIT_FINDING_CODES.POLICY_READINESS_UNKNOWN, summary.readiness.unknown)
  add(IMAGE_AUDIT_FINDING_CODES.POLICY_READINESS_BLOCKED, summary.readiness.blocked + summary.readiness.broken)
  return findings
}

/**
 * Audits serialized row metadata without fetching URLs or inferring licenses.
 * `firstScreenItemIds` is intentionally explicit: an omitted selection is
 * reported as not assessed rather than silently treating corpus order as UI order.
 */
export function auditImageTruth({
  items,
  firstScreenItemIds = null,
  selfHostedHosts = [],
  policy = {},
} = {}) {
  if (!Array.isArray(items)) throw new Error('items must be an array')
  if (firstScreenItemIds != null && !Array.isArray(firstScreenItemIds)) {
    throw new Error('firstScreenItemIds must be an array or null')
  }

  const hosts = normalizeHosts(selfHostedHosts)
  const normalizedPolicy = normalizePolicy(policy)
  const assessments = items.map((item, index) => itemAssessment(item, index, hosts, normalizedPolicy))
  const firstScreenIds = firstScreenItemIds == null ? null : new Set(firstScreenItemIds.map(String))
  const firstScreen = firstScreenIds == null
    ? []
    : assessments.filter((item) => firstScreenIds.has(String(item.itemId)))
  const unresolvedFirstScreenItemIds = firstScreenIds == null
    ? []
    : [...firstScreenIds].filter((id) => !firstScreen.some((item) => String(item.itemId) === id)).sort(compareText)
  const fullCorpus = summarize(assessments, { selectionAvailable: true })
  const firstScreenSummary = summarize(firstScreen, { selectionAvailable: firstScreenIds != null })
  const incompleteFirstScreen = firstScreenIds != null && unresolvedFirstScreenItemIds.length > 0
  if (incompleteFirstScreen && firstScreenSummary.risk === 'clear') firstScreenSummary.risk = 'elevated'

  return {
    schemaVersion: IMAGE_AUDIT_SCHEMA_VERSION,
    policy: normalizedPolicy,
    licenseStatement: 'URL hosts and captured metadata are evidence only; this audit does not verify or claim a remote URL is licensed.',
    fullCorpus,
    firstScreen: {
      selectionAvailable: firstScreenIds != null,
      selectionComplete: !incompleteFirstScreen,
      unresolvedItemIds: unresolvedFirstScreenItemIds,
      ...firstScreenSummary,
    },
    findings: [
      ...findingsFor('full-corpus', fullCorpus),
      ...(firstScreenIds == null ? [] : findingsFor('first-screen', firstScreenSummary)),
    ],
  }
}
