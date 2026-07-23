import { createHash } from 'node:crypto'

import {
  MAX_CLOCK_SKEW_MS,
  stableStringify,
  validDigest,
  validIso,
} from './artifact-contract.mjs'

export const CITY_LAUNCH_GATE_SCHEMA_VERSION = 1
export const CITY_LAUNCH_GATE_VERSION = 'wuzup-city-launch-gate/v1'
export const CITY_LAUNCH_SAMPLE_ALGORITHM = 'sha256-order-v1'

export const CITY_LAUNCH_GATE_LIMITS = Object.freeze({
  artifactRows: 100_000,
  sourceFamilies: 500,
  selectionRows: 50_000,
  sampleRows: 2_000,
  claimsPerRow: 12,
  evidenceRefsPerClaim: 32,
  stringCharacters: 512,
  urlCharacters: 2_048,
})

const POLICY_KEYS = Object.freeze([
  'schemaVersion',
  'minimumActiveIndependentSourceFamilies',
  'maximumDecisionReadySourceFamilyShare',
  'maximumArtifactExpiredShare',
  'maximumVisibleExpiredShare',
  'minimumActionableTimeShare',
  'minimumDecisionReadyLocationShare',
  'minimumKnownPriceOrFreeShare',
  'maximumSevereSampleErrorShare',
  'minimumRecommendationProvenanceShare',
  'minimumClaimEvidenceReceiptShare',
  'maximumArtifactAgeHours',
  'maximumSourceHealthAgeHours',
  'maximumHumanSampleAgeHours',
  'minimumHumanSampleRows',
])

const PROPOSED_POLICY = Object.freeze({
  schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
  minimumActiveIndependentSourceFamilies: 10,
  maximumDecisionReadySourceFamilyShare: 0.35,
  maximumArtifactExpiredShare: 0.05,
  maximumVisibleExpiredShare: 0.005,
  minimumActionableTimeShare: 0.8,
  minimumDecisionReadyLocationShare: 0.8,
  minimumKnownPriceOrFreeShare: 0.7,
  maximumSevereSampleErrorShare: 0.02,
  minimumRecommendationProvenanceShare: 1,
  minimumClaimEvidenceReceiptShare: 1,
  maximumArtifactAgeHours: 48,
  maximumSourceHealthAgeHours: 48,
  maximumHumanSampleAgeHours: 7 * 24,
  // The audit specifies a weekly human sample but not its minimum size. Fifty
  // is an explicitly proposed evidence floor and remains owner-ratified policy.
  minimumHumanSampleRows: 50,
})

const PROPOSED_RATIFICATION = Object.freeze({
  state: 'proposed',
  authority: 'owner',
  gateVersion: CITY_LAUNCH_GATE_VERSION,
  policyId: cityLaunchPolicyId(PROPOSED_POLICY),
  decisionId: null,
  decidedAt: null,
})

// These are the audit's proposed city thresholds, plus bounded freshness
// windows needed to evaluate its freshness requirement. Exporting them does
// not ratify them; the proposal still exposes the exact policy identity an
// eventual owner decision must carry.
export const PROPOSED_CITY_LAUNCH_THRESHOLDS = Object.freeze({
  ...PROPOSED_POLICY,
  ratification: PROPOSED_RATIFICATION,
})

const HEALTH_STATUSES = new Set(['healthy', 'degraded', 'failed', 'unknown'])
const CLAIM_TYPES = new Set([
  'best',
  'favorite',
  'gem',
  'near-you',
  'open-now',
  'weather-based',
  'worth-the-drive',
])
const CLAIM_EVIDENCE_KINDS = new Set([
  'city-time-evaluation',
  'comparative-quality',
  'current-hours',
  'distance-calculation',
  'distinctiveness',
  'location-currentness',
  'location-fix',
  'objective-quality',
  'quality-distance-comparison',
  'source-provenance',
  'user-preference',
  'weather-currentness',
  'weather-fit-evaluation',
  'weather-observation',
])
const REQUIRED_CLAIM_EVIDENCE_KINDS = Object.freeze({
  best: Object.freeze(['comparative-quality', 'source-provenance']),
  favorite: Object.freeze(['user-preference']),
  gem: Object.freeze(['objective-quality', 'distinctiveness', 'source-provenance']),
  'near-you': Object.freeze(['location-fix', 'location-currentness', 'distance-calculation', 'source-provenance']),
  'open-now': Object.freeze(['current-hours', 'city-time-evaluation', 'source-provenance']),
  'weather-based': Object.freeze(['weather-observation', 'weather-currentness', 'weather-fit-evaluation', 'source-provenance']),
  'worth-the-drive': Object.freeze(['objective-quality', 'distance-calculation', 'quality-distance-comparison', 'source-provenance']),
})
const SEVERE_ERROR_CODES = new Set(['SEVERE_DATE', 'SEVERE_CATEGORY', 'SEVERE_LOCATION'])
const HOURS_MS = 60 * 60 * 1000

const REASON_ORDER = Object.freeze([
  'THRESHOLDS_MISSING',
  'EVIDENCE_ARTIFACT_MISSING',
  'EVIDENCE_SOURCE_HEALTH_MISSING',
  'EVIDENCE_SELECTION_MISSING',
  'EVIDENCE_SAMPLE_MISSING',
  'EVIDENCE_CI_RECEIPT_MISSING',
  'ARTIFACT_POPULATION_EMPTY',
  'ARTIFACT_EXPIRY_EVIDENCE_INCOMPLETE',
  'SOURCE_HEALTH_EVIDENCE_INCOMPLETE',
  'SELECTION_EVIDENCE_INCOMPLETE',
  'SELECTION_POPULATION_EMPTY',
  'SELECTION_SOURCE_FAMILY_INCOMPLETE',
  'SELECTION_OBSERVATION_NOT_CURRENT',
  'CLAIM_ENUMERATION_INCOMPLETE',
  'HUMAN_SAMPLE_EVIDENCE_INCOMPLETE',
  'HUMAN_SAMPLE_EMPTY',
  'THRESHOLDS_NOT_OWNER_RATIFIED',
  'ARTIFACT_NOT_APPROVED_BY_CI',
  'QUALITY_REPORT_NOT_APPROVED_BY_CI',
  'SOURCE_HEALTH_NOT_APPROVED_BY_CI',
  'SOURCE_HEALTH_NOT_HEALTHY',
  'ARTIFACT_EXPIRED',
  'ARTIFACT_AGE_ABOVE_MAXIMUM',
  'SOURCE_HEALTH_AGE_ABOVE_MAXIMUM',
  'HUMAN_SAMPLE_AGE_ABOVE_MAXIMUM',
  'HUMAN_SAMPLE_ROWS_BELOW_MINIMUM',
  'ACTIVE_INDEPENDENT_SOURCE_FAMILIES_BELOW_MINIMUM',
  'DECISION_READY_SOURCE_FAMILY_SHARE_ABOVE_MAXIMUM',
  'ARTIFACT_EXPIRED_SHARE_NOT_BELOW_MAXIMUM',
  'VISIBLE_EXPIRED_SHARE_NOT_BELOW_MAXIMUM',
  'ACTIONABLE_TIME_SHARE_BELOW_MINIMUM',
  'DECISION_READY_LOCATION_SHARE_BELOW_MINIMUM',
  'KNOWN_PRICE_OR_FREE_SHARE_BELOW_MINIMUM',
  'SEVERE_SAMPLE_ERROR_SHARE_NOT_BELOW_MAXIMUM',
  'RECOMMENDATION_PROVENANCE_SHARE_BELOW_MINIMUM',
  'CLAIM_EVIDENCE_RECEIPT_SHARE_BELOW_MINIMUM',
])

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value, keys, label) {
  invariant(plainObject(value), `${label} must be an object`)
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} must not contain symbol keys`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const actual = Object.getOwnPropertyNames(value).sort()
  const expected = [...keys].sort()
  invariant(actual.join('|') === expected.join('|'), `${label} must contain exactly: ${expected.join(', ')}`)
  for (const key of actual) {
    const descriptor = descriptors[key]
    invariant(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, `${label}.${key} must be an enumerable data property`)
  }
}

function denseArray(value, label, maximum) {
  invariant(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `${label} must be an array`)
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} must not contain symbol keys`)
  if (maximum != null) invariant(value.length <= maximum, `${label} exceeds its item limit`)
  const names = Object.getOwnPropertyNames(value)
  invariant(names.length === value.length + 1 && names.includes('length'), `${label} must be dense and contain no extra properties`)
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    invariant(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, `${label}[${index}] must be an enumerable data property`)
  }
  return value
}

function string(value, label, max = CITY_LAUNCH_GATE_LIMITS.stringCharacters) {
  invariant(typeof value === 'string' && value.length > 0 && value === value.trim(), `${label} must be a non-empty trimmed string`)
  invariant(value.length <= max, `${label} exceeds its character limit`)
  return value
}

function nullableString(value, label) {
  if (value === null) return null
  return string(value, label)
}

function cityId(value, label) {
  string(value, label, 100)
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), `${label} must be a lowercase kebab-case city ID`)
  return value
}

function iso(value, label) {
  invariant(validIso(value), `${label} must be a canonical ISO timestamp`)
  return value
}

function digest(value, label) {
  invariant(validDigest(value), `${label} must be a lowercase SHA-256 digest`)
  return value
}

function prefixedDigest(value, label) {
  invariant(/^sha256:[a-f0-9]{64}$/.test(String(value || '')), `${label} must be a sha256 identity`)
  return value
}

function bool(value, label) {
  invariant(typeof value === 'boolean', `${label} must be boolean`)
  return value
}

function count(value, label, maximum = CITY_LAUNCH_GATE_LIMITS.artifactRows) {
  invariant(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`)
  invariant(value <= maximum, `${label} exceeds its limit`)
  return value
}

function ratioThreshold(value, label) {
  invariant(Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be between 0 and 1`)
  return value
}

function ageThreshold(value, label) {
  invariant(Number.isFinite(value) && value > 0 && value <= 365 * 24, `${label} must be a positive bounded hour count`)
  return value
}

function uniqueStrings(value, label, { nonEmpty = false, maximum = CITY_LAUNCH_GATE_LIMITS.evidenceRefsPerClaim } = {}) {
  denseArray(value, label, maximum)
  if (nonEmpty) invariant(value.length > 0, `${label} must not be empty`)
  const result = value.map((entry, index) => string(entry, `${label}[${index}]`))
  invariant(new Set(result).size === result.length, `${label} contains duplicates`)
  return result
}

/** Canonical identity for every numeric/schema policy value, excluding its authorization receipt. */
export function cityLaunchPolicyId(value) {
  invariant(plainObject(value), 'policy must be an object')
  const hasRatification = Object.hasOwn(value, 'ratification')
  exactKeys(value, hasRatification ? [...POLICY_KEYS, 'ratification'] : POLICY_KEYS, 'policy')
  const thresholds = Object.fromEntries(POLICY_KEYS.map((key) => [key, value[key]]))
  const digestValue = createHash('sha256')
    .update(stableStringify({ gateVersion: CITY_LAUNCH_GATE_VERSION, thresholds }))
    .digest('hex')
  return `sha256:${digestValue}`
}

/**
 * Derive an exact sample prefix from release-bound identities and the review
 * period. The hash supplies deterministic ordering, not authenticity.
 */
export function deterministicCityLaunchSample({
  cityId: expectedCityId,
  artifactSha256,
  selectionEvidenceSha256,
  periodStart,
  periodEnd,
  targetRows,
  populationIds,
}) {
  cityId(expectedCityId, 'sample.cityId')
  digest(artifactSha256, 'sample.artifactSha256')
  digest(selectionEvidenceSha256, 'sample.selectionEvidenceSha256')
  iso(periodStart, 'sample.periodStart')
  iso(periodEnd, 'sample.periodEnd')
  invariant(Date.parse(periodEnd) >= Date.parse(periodStart), 'sample.periodEnd must not precede periodStart')
  count(targetRows, 'sample.targetRows', CITY_LAUNCH_GATE_LIMITS.sampleRows)
  denseArray(populationIds, 'sample.populationIds', CITY_LAUNCH_GATE_LIMITS.selectionRows)
  const ids = populationIds.map((id, index) => string(id, `sample.populationIds[${index}]`))
  invariant(new Set(ids).size === ids.length, 'sample.populationIds contains duplicate IDs')
  invariant(targetRows <= ids.length, 'sample.targetRows exceeds the population')
  const seedPayload = {
    algorithm: CITY_LAUNCH_SAMPLE_ALGORITHM,
    gateVersion: CITY_LAUNCH_GATE_VERSION,
    cityId: expectedCityId,
    artifactSha256,
    selectionEvidenceSha256,
    periodStart,
    periodEnd,
    targetRows,
  }
  const samplingId = `sha256:${createHash('sha256').update(stableStringify(seedPayload)).digest('hex')}`
  const selectedIds = ids
    .map((id) => ({
      id,
      score: createHash('sha256').update(`${samplingId}\0${id}`).digest('hex'),
    }))
    .sort((left, right) => left.score.localeCompare(right.score) || left.id.localeCompare(right.id))
    .slice(0, targetRows)
    .map((entry) => entry.id)
  return { algorithm: CITY_LAUNCH_SAMPLE_ALGORITHM, samplingId, selectedIds }
}

/** Hash a receipt payload after omitting its top-level evidenceSha256 field. */
export function cityLaunchEvidenceSha256(value) {
  invariant(plainObject(value), 'evidence must be an object')
  invariant(Object.getOwnPropertySymbols(value).length === 0, 'evidence must not contain symbol keys')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    invariant(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, `evidence.${key} must be an enumerable data property`)
  }
  const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'evidenceSha256'))
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

function verifyEvidenceHash(value, label) {
  digest(value.evidenceSha256, `${label}.evidenceSha256`)
  invariant(value.evidenceSha256 === cityLaunchEvidenceSha256(value), `${label}.evidenceSha256 does not match its payload`)
}

function validateRatification(value, asOfMs, expectedPolicyId) {
  exactKeys(
    value,
    ['state', 'authority', 'gateVersion', 'policyId', 'decisionId', 'decidedAt'],
    'thresholds.ratification',
  )
  invariant(value.state === 'proposed' || value.state === 'ratified', 'thresholds.ratification.state must be proposed or ratified')
  invariant(value.authority === 'owner', 'thresholds.ratification.authority must be owner')
  invariant(value.gateVersion === CITY_LAUNCH_GATE_VERSION, 'thresholds.ratification.gateVersion does not match this evaluator')
  prefixedDigest(value.policyId, 'thresholds.ratification.policyId')
  invariant(value.policyId === expectedPolicyId, 'thresholds.ratification.policyId does not match the threshold policy')
  if (value.state === 'ratified') {
    string(value.decisionId, 'thresholds.ratification.decisionId')
    iso(value.decidedAt, 'thresholds.ratification.decidedAt')
    invariant(Date.parse(value.decidedAt) <= asOfMs + MAX_CLOCK_SKEW_MS, 'thresholds.ratification.decidedAt is in the future')
  } else {
    invariant(value.decisionId === null, 'proposed thresholds.ratification.decisionId must be null')
    invariant(value.decidedAt === null, 'proposed thresholds.ratification.decidedAt must be null')
  }
  return value
}

function validateThresholds(value, asOfMs) {
  exactKeys(value, [...POLICY_KEYS, 'ratification'], 'thresholds')
  invariant(value.schemaVersion === CITY_LAUNCH_GATE_SCHEMA_VERSION, 'thresholds.schemaVersion is unsupported')
  invariant(
    Number.isInteger(value.minimumActiveIndependentSourceFamilies)
      && value.minimumActiveIndependentSourceFamilies > 0
      && value.minimumActiveIndependentSourceFamilies <= CITY_LAUNCH_GATE_LIMITS.sourceFamilies,
    'thresholds.minimumActiveIndependentSourceFamilies must be a positive bounded integer',
  )
  for (const key of [
    'maximumDecisionReadySourceFamilyShare',
    'maximumArtifactExpiredShare',
    'maximumVisibleExpiredShare',
    'minimumActionableTimeShare',
    'minimumDecisionReadyLocationShare',
    'minimumKnownPriceOrFreeShare',
    'maximumSevereSampleErrorShare',
    'minimumRecommendationProvenanceShare',
    'minimumClaimEvidenceReceiptShare',
  ]) ratioThreshold(value[key], `thresholds.${key}`)
  for (const key of ['maximumArtifactAgeHours', 'maximumSourceHealthAgeHours', 'maximumHumanSampleAgeHours']) {
    ageThreshold(value[key], `thresholds.${key}`)
  }
  invariant(
    Number.isInteger(value.minimumHumanSampleRows)
      && value.minimumHumanSampleRows > 0
      && value.minimumHumanSampleRows <= CITY_LAUNCH_GATE_LIMITS.sampleRows,
    'thresholds.minimumHumanSampleRows must be a positive bounded integer',
  )
  validateRatification(value.ratification, asOfMs, cityLaunchPolicyId(value))
  return value
}

function validateArtifact(value, expectedCityId, asOfMs) {
  exactKeys(value, [
    'schemaVersion', 'cityId', 'artifactKind', 'manifestId', 'buildId', 'artifactSha256',
    'generatedAt', 'expiresAt', 'totalRows', 'expiredRows', 'qualityComplete',
    'qualityReportSha256', 'evidenceSha256',
  ], 'evidence.artifact')
  invariant(value.schemaVersion === CITY_LAUNCH_GATE_SCHEMA_VERSION, 'evidence.artifact.schemaVersion is unsupported')
  cityId(value.cityId, 'evidence.artifact.cityId')
  invariant(value.cityId === expectedCityId, 'evidence.artifact.cityId does not match cityId')
  invariant(value.artifactKind === 'events', 'evidence.artifact.artifactKind must be events')
  prefixedDigest(value.manifestId, 'evidence.artifact.manifestId')
  prefixedDigest(value.buildId, 'evidence.artifact.buildId')
  digest(value.artifactSha256, 'evidence.artifact.artifactSha256')
  iso(value.generatedAt, 'evidence.artifact.generatedAt')
  iso(value.expiresAt, 'evidence.artifact.expiresAt')
  const generatedMs = Date.parse(value.generatedAt)
  const expiresMs = Date.parse(value.expiresAt)
  invariant(generatedMs <= asOfMs + MAX_CLOCK_SKEW_MS, 'evidence.artifact.generatedAt is implausibly in the future')
  invariant(expiresMs > generatedMs, 'evidence.artifact.expiresAt must be after generatedAt')
  count(value.totalRows, 'evidence.artifact.totalRows')
  bool(value.qualityComplete, 'evidence.artifact.qualityComplete')
  if (value.expiredRows === null) {
    invariant(value.qualityComplete === false, 'evidence.artifact.expiredRows is required when qualityComplete is true')
  } else {
    count(value.expiredRows, 'evidence.artifact.expiredRows')
    invariant(value.expiredRows <= value.totalRows, 'evidence.artifact.expiredRows exceeds totalRows')
  }
  digest(value.qualityReportSha256, 'evidence.artifact.qualityReportSha256')
  verifyEvidenceHash(value, 'evidence.artifact')
  return value
}

function aggregateHealth(families) {
  if (families.length === 0 || families.some((family) => family.status === 'unknown')) return 'unknown'
  if (families.every((family) => family.status === 'failed')) return 'failed'
  if (families.some((family) => family.status === 'failed' || family.status === 'degraded')) return 'degraded'
  return 'healthy'
}

function validateSourceHealth(value, expectedCityId, asOfMs) {
  exactKeys(value, [
    'schemaVersion', 'cityId', 'artifactSha256', 'checkedAt', 'status', 'complete',
    'families', 'evidenceSha256',
  ], 'evidence.sourceHealth')
  invariant(value.schemaVersion === CITY_LAUNCH_GATE_SCHEMA_VERSION, 'evidence.sourceHealth.schemaVersion is unsupported')
  cityId(value.cityId, 'evidence.sourceHealth.cityId')
  invariant(value.cityId === expectedCityId, 'evidence.sourceHealth.cityId does not match cityId')
  digest(value.artifactSha256, 'evidence.sourceHealth.artifactSha256')
  iso(value.checkedAt, 'evidence.sourceHealth.checkedAt')
  invariant(Date.parse(value.checkedAt) <= asOfMs + MAX_CLOCK_SKEW_MS, 'evidence.sourceHealth.checkedAt is implausibly in the future')
  invariant(HEALTH_STATUSES.has(value.status), 'evidence.sourceHealth.status is invalid')
  bool(value.complete, 'evidence.sourceHealth.complete')
  denseArray(value.families, 'evidence.sourceHealth.families', CITY_LAUNCH_GATE_LIMITS.sourceFamilies)
  const names = []
  for (const [index, family] of value.families.entries()) {
    const label = `evidence.sourceHealth.families[${index}]`
    exactKeys(family, ['family', 'active', 'independent', 'status', 'rows'], label)
    names.push(string(family.family, `${label}.family`))
    bool(family.active, `${label}.active`)
    bool(family.independent, `${label}.independent`)
    invariant(HEALTH_STATUSES.has(family.status), `${label}.status is invalid`)
    count(family.rows, `${label}.rows`)
    invariant(family.active === (family.rows > 0), `${label}.active must equal rows > 0`)
  }
  invariant(new Set(names).size === names.length, 'evidence.sourceHealth.families contains duplicate families')
  if (value.complete) {
    invariant(value.status === aggregateHealth(value.families), 'evidence.sourceHealth.status contradicts family receipts')
  } else {
    invariant(value.status === 'unknown', 'incomplete evidence.sourceHealth must have unknown status')
  }
  verifyEvidenceHash(value, 'evidence.sourceHealth')
  return value
}

function validateUrl(value, label) {
  string(value, label, CITY_LAUNCH_GATE_LIMITS.urlCharacters)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL`)
  }
  invariant(parsed.protocol === 'https:' || parsed.protocol === 'http:', `${label} must be an absolute HTTP(S) URL`)
}

function validateProvenance(value, label) {
  exactKeys(value, ['kind', 'sourceFamily', 'url', 'recordId'], label)
  invariant(value.kind === 'healthy-source-link' || value.kind === 'first-party-record', `${label}.kind is invalid`)
  if (value.kind === 'healthy-source-link') {
    string(value.sourceFamily, `${label}.sourceFamily`)
    validateUrl(value.url, `${label}.url`)
    invariant(value.recordId === null, `${label}.recordId must be null for a source link`)
  } else {
    invariant(value.sourceFamily === null, `${label}.sourceFamily must be null for a first-party record`)
    invariant(value.url === null, `${label}.url must be null for a first-party record`)
    string(value.recordId, `${label}.recordId`)
  }
}

function validateClaim(value, label) {
  exactKeys(value, ['id', 'type', 'requiredEvidenceRefs', 'evidenceRefs'], label)
  string(value.id, `${label}.id`)
  invariant(CLAIM_TYPES.has(value.type), `${label}.type is invalid`)
  uniqueStrings(value.requiredEvidenceRefs, `${label}.requiredEvidenceRefs`, { nonEmpty: true })
  uniqueStrings(value.evidenceRefs, `${label}.evidenceRefs`)
}

function validateClaimEvidence(value, label) {
  exactKeys(value, ['ref', 'kind', 'receiptSha256'], label)
  string(value.ref, `${label}.ref`)
  invariant(CLAIM_EVIDENCE_KINDS.has(value.kind), `${label}.kind is invalid`)
  digest(value.receiptSha256, `${label}.receiptSha256`)
}

function validateSelection(value, expectedCityId, asOfMs) {
  exactKeys(value, [
    'schemaVersion', 'cityId', 'artifactSha256', 'observedAt', 'scope', 'complete',
    'populationCount', 'claimEnumerationComplete', 'rows', 'evidenceSha256',
  ], 'evidence.selection')
  invariant(value.schemaVersion === CITY_LAUNCH_GATE_SCHEMA_VERSION, 'evidence.selection.schemaVersion is unsupported')
  cityId(value.cityId, 'evidence.selection.cityId')
  invariant(value.cityId === expectedCityId, 'evidence.selection.cityId does not match cityId')
  digest(value.artifactSha256, 'evidence.selection.artifactSha256')
  iso(value.observedAt, 'evidence.selection.observedAt')
  invariant(Date.parse(value.observedAt) <= asOfMs + MAX_CLOCK_SKEW_MS, 'evidence.selection.observedAt is implausibly in the future')
  invariant(value.scope === 'decision-ready', 'evidence.selection.scope must be decision-ready')
  bool(value.complete, 'evidence.selection.complete')
  bool(value.claimEnumerationComplete, 'evidence.selection.claimEnumerationComplete')
  count(value.populationCount, 'evidence.selection.populationCount', CITY_LAUNCH_GATE_LIMITS.selectionRows)
  denseArray(value.rows, 'evidence.selection.rows', CITY_LAUNCH_GATE_LIMITS.selectionRows)
  invariant(
    value.complete ? value.populationCount === value.rows.length : value.populationCount >= value.rows.length,
    'evidence.selection.populationCount contradicts rows',
  )
  const rowIds = []
  const claimIds = []
  for (const [index, row] of value.rows.entries()) {
    const label = `evidence.selection.rows[${index}]`
    exactKeys(row, [
      'cityId', 'id', 'sourceFamily', 'expiredAtRender', 'actionableTime',
      'decisionReadyLocation', 'knownPriceOrFree', 'recommended', 'provenance',
      'claimEvidence', 'claims',
    ], label)
    cityId(row.cityId, `${label}.cityId`)
    invariant(row.cityId === expectedCityId, `${label}.cityId does not match cityId`)
    rowIds.push(string(row.id, `${label}.id`))
    nullableString(row.sourceFamily, `${label}.sourceFamily`)
    bool(row.expiredAtRender, `${label}.expiredAtRender`)
    bool(row.actionableTime, `${label}.actionableTime`)
    bool(row.decisionReadyLocation, `${label}.decisionReadyLocation`)
    bool(row.knownPriceOrFree, `${label}.knownPriceOrFree`)
    bool(row.recommended, `${label}.recommended`)
    if (row.provenance === null) {
      // Explicit absence is measurable. It is not silently promoted.
    } else {
      validateProvenance(row.provenance, `${label}.provenance`)
      invariant(row.recommended, `${label}.provenance is only valid for a recommended row`)
      if (row.provenance.kind === 'healthy-source-link') {
        invariant(row.sourceFamily === row.provenance.sourceFamily, `${label}.provenance.sourceFamily must match row.sourceFamily`)
      }
    }
    denseArray(row.claimEvidence, `${label}.claimEvidence`, CITY_LAUNCH_GATE_LIMITS.claimsPerRow * CITY_LAUNCH_GATE_LIMITS.evidenceRefsPerClaim)
    const evidenceRefs = []
    for (const [evidenceIndex, evidence] of row.claimEvidence.entries()) {
      validateClaimEvidence(evidence, `${label}.claimEvidence[${evidenceIndex}]`)
      evidenceRefs.push(evidence.ref)
    }
    invariant(new Set(evidenceRefs).size === evidenceRefs.length, `${label}.claimEvidence contains duplicate refs`)
    denseArray(row.claims, `${label}.claims`, CITY_LAUNCH_GATE_LIMITS.claimsPerRow)
    for (const [claimIndex, claim] of row.claims.entries()) {
      validateClaim(claim, `${label}.claims[${claimIndex}]`)
      for (const ref of [...claim.requiredEvidenceRefs, ...claim.evidenceRefs]) {
        invariant(evidenceRefs.includes(ref), `${label}.claims[${claimIndex}] references unknown claim evidence '${ref}'`)
      }
      claimIds.push(claim.id)
    }
  }
  invariant(new Set(rowIds).size === rowIds.length, 'evidence.selection.rows contains duplicate IDs')
  invariant(new Set(claimIds).size === claimIds.length, 'evidence.selection.rows contains duplicate claim IDs')
  verifyEvidenceHash(value, 'evidence.selection')
  return value
}

function validateSample(value, expectedCityId, asOfMs) {
  exactKeys(value, [
    'schemaVersion', 'cityId', 'artifactSha256', 'selectionEvidenceSha256', 'method',
    'periodStart', 'periodEnd', 'reviewedAt', 'populationCount', 'reviewComplete',
    'samplingAlgorithm', 'samplingId', 'targetRows', 'rows', 'evidenceSha256',
  ], 'evidence.sample')
  invariant(value.schemaVersion === CITY_LAUNCH_GATE_SCHEMA_VERSION, 'evidence.sample.schemaVersion is unsupported')
  cityId(value.cityId, 'evidence.sample.cityId')
  invariant(value.cityId === expectedCityId, 'evidence.sample.cityId does not match cityId')
  digest(value.artifactSha256, 'evidence.sample.artifactSha256')
  digest(value.selectionEvidenceSha256, 'evidence.sample.selectionEvidenceSha256')
  invariant(value.method === 'human', 'evidence.sample.method must be human')
  iso(value.periodStart, 'evidence.sample.periodStart')
  iso(value.periodEnd, 'evidence.sample.periodEnd')
  iso(value.reviewedAt, 'evidence.sample.reviewedAt')
  const periodStart = Date.parse(value.periodStart)
  const periodEnd = Date.parse(value.periodEnd)
  const reviewedAt = Date.parse(value.reviewedAt)
  invariant(periodEnd >= periodStart, 'evidence.sample.periodEnd must not precede periodStart')
  invariant(periodEnd - periodStart <= 7 * 24 * HOURS_MS, 'evidence.sample period exceeds one week')
  invariant(reviewedAt + MAX_CLOCK_SKEW_MS >= periodEnd, 'evidence.sample.reviewedAt precedes periodEnd')
  invariant(reviewedAt <= asOfMs + MAX_CLOCK_SKEW_MS, 'evidence.sample.reviewedAt is implausibly in the future')
  count(value.populationCount, 'evidence.sample.populationCount', CITY_LAUNCH_GATE_LIMITS.selectionRows)
  bool(value.reviewComplete, 'evidence.sample.reviewComplete')
  invariant(value.samplingAlgorithm === CITY_LAUNCH_SAMPLE_ALGORITHM, 'evidence.sample.samplingAlgorithm is unsupported')
  prefixedDigest(value.samplingId, 'evidence.sample.samplingId')
  count(value.targetRows, 'evidence.sample.targetRows', CITY_LAUNCH_GATE_LIMITS.sampleRows)
  denseArray(value.rows, 'evidence.sample.rows', CITY_LAUNCH_GATE_LIMITS.sampleRows)
  invariant(value.targetRows === value.rows.length, 'evidence.sample.targetRows must equal rows.length')
  const ids = []
  for (const [index, row] of value.rows.entries()) {
    const label = `evidence.sample.rows[${index}]`
    exactKeys(row, ['cityId', 'id', 'severeError', 'errorCodes'], label)
    cityId(row.cityId, `${label}.cityId`)
    invariant(row.cityId === expectedCityId, `${label}.cityId does not match cityId`)
    ids.push(string(row.id, `${label}.id`))
    bool(row.severeError, `${label}.severeError`)
    const codes = uniqueStrings(row.errorCodes, `${label}.errorCodes`, { maximum: 3 })
    invariant(codes.every((code) => SEVERE_ERROR_CODES.has(code)), `${label}.errorCodes contains an unsupported code`)
    invariant(row.severeError ? codes.length > 0 : codes.length === 0, `${label}.severeError contradicts errorCodes`)
  }
  invariant(new Set(ids).size === ids.length, 'evidence.sample.rows contains duplicate IDs')
  verifyEvidenceHash(value, 'evidence.sample')
  return value
}

function validateCiReceipt(value, expectedCityId, asOfMs) {
  exactKeys(value, [
    'schemaVersion', 'cityId', 'artifactSha256', 'artifactEvidenceSha256', 'manifestId',
    'buildId', 'artifactCount', 'qualityReportSha256', 'sourceHealthEvidenceSha256',
    'artifactApprovedByCi', 'qualityReportApprovedByCi', 'sourceHealthApprovedByCi',
    'checkRunId', 'checkedAt', 'evidenceSha256',
  ], 'evidence.ciReceipt')
  invariant(value.schemaVersion === CITY_LAUNCH_GATE_SCHEMA_VERSION, 'evidence.ciReceipt.schemaVersion is unsupported')
  cityId(value.cityId, 'evidence.ciReceipt.cityId')
  invariant(value.cityId === expectedCityId, 'evidence.ciReceipt.cityId does not match cityId')
  digest(value.artifactSha256, 'evidence.ciReceipt.artifactSha256')
  digest(value.artifactEvidenceSha256, 'evidence.ciReceipt.artifactEvidenceSha256')
  prefixedDigest(value.manifestId, 'evidence.ciReceipt.manifestId')
  prefixedDigest(value.buildId, 'evidence.ciReceipt.buildId')
  count(value.artifactCount, 'evidence.ciReceipt.artifactCount')
  digest(value.qualityReportSha256, 'evidence.ciReceipt.qualityReportSha256')
  digest(value.sourceHealthEvidenceSha256, 'evidence.ciReceipt.sourceHealthEvidenceSha256')
  bool(value.artifactApprovedByCi, 'evidence.ciReceipt.artifactApprovedByCi')
  bool(value.qualityReportApprovedByCi, 'evidence.ciReceipt.qualityReportApprovedByCi')
  bool(value.sourceHealthApprovedByCi, 'evidence.ciReceipt.sourceHealthApprovedByCi')
  string(value.checkRunId, 'evidence.ciReceipt.checkRunId')
  iso(value.checkedAt, 'evidence.ciReceipt.checkedAt')
  invariant(Date.parse(value.checkedAt) <= asOfMs + MAX_CLOCK_SKEW_MS, 'evidence.ciReceipt.checkedAt is implausibly in the future')
  verifyEvidenceHash(value, 'evidence.ciReceipt')
  return value
}

function validateBindings({ artifact, sourceHealth, selection, sample, ciReceipt }, expectedCityId) {
  const present = [artifact, sourceHealth, selection, sample, ciReceipt].filter(Boolean)
  for (const value of present) invariant(value.cityId === expectedCityId, 'cross-city evidence is not allowed')
  if (!artifact) return
  if (sourceHealth) {
    invariant(sourceHealth.artifactSha256 === artifact.artifactSha256, 'sourceHealth artifact hash does not match artifact')
    invariant(Date.parse(sourceHealth.checkedAt) + MAX_CLOCK_SKEW_MS >= Date.parse(artifact.generatedAt), 'sourceHealth predates artifact generation')
  }
  if (selection) {
    invariant(selection.artifactSha256 === artifact.artifactSha256, 'selection artifact hash does not match artifact')
    invariant(Date.parse(selection.observedAt) >= Date.parse(artifact.generatedAt), 'selection observedAt predates artifact generation')
  }
  if (sample) {
    invariant(sample.artifactSha256 === artifact.artifactSha256, 'sample artifact hash does not match artifact')
  }
  if (ciReceipt) {
    invariant(ciReceipt.artifactSha256 === artifact.artifactSha256, 'ciReceipt artifact hash does not match artifact')
    invariant(ciReceipt.artifactEvidenceSha256 === artifact.evidenceSha256, 'ciReceipt artifact evidence hash does not match artifact')
    invariant(ciReceipt.manifestId === artifact.manifestId, 'ciReceipt manifestId does not match artifact')
    invariant(ciReceipt.buildId === artifact.buildId, 'ciReceipt buildId does not match artifact')
    invariant(ciReceipt.artifactCount === artifact.totalRows, 'ciReceipt artifactCount does not match artifact')
    invariant(ciReceipt.qualityReportSha256 === artifact.qualityReportSha256, 'ciReceipt quality report hash does not match artifact')
    invariant(Date.parse(ciReceipt.checkedAt) + MAX_CLOCK_SKEW_MS >= Date.parse(artifact.generatedAt), 'ciReceipt predates artifact generation')
    if (sourceHealth) {
      invariant(
        ciReceipt.sourceHealthEvidenceSha256 === sourceHealth.evidenceSha256,
        'ciReceipt source-health evidence hash does not match sourceHealth',
      )
      invariant(Date.parse(ciReceipt.checkedAt) + MAX_CLOCK_SKEW_MS >= Date.parse(sourceHealth.checkedAt), 'ciReceipt predates sourceHealth')
    }
  }
  if (selection && sourceHealth) {
    const families = new Map(sourceHealth.families.map((family) => [family.family, family]))
    for (const row of selection.rows) {
      if (row.sourceFamily === null) continue
      const family = families.get(row.sourceFamily)
      invariant(family, `selection source family '${row.sourceFamily}' has no source-health receipt`)
      invariant(
        family.active && family.rows > 0,
        `selection source family '${row.sourceFamily}' must reference an active source family with rows`,
      )
    }
  }
  if (sample && selection) {
    invariant(sample.selectionEvidenceSha256 === selection.evidenceSha256, 'sample selection evidence hash does not match selection')
    invariant(sample.populationCount === selection.populationCount, 'sample populationCount does not match selection')
    invariant(Date.parse(sample.reviewedAt) >= Date.parse(selection.observedAt), 'sample reviewedAt predates selection observedAt')
    const ids = new Set(selection.rows.map((row) => row.id))
    for (const row of sample.rows) invariant(ids.has(row.id), `sample row '${row.id}' is not present in selection evidence`)
    if (sample.reviewComplete) {
      invariant(selection.complete, 'a complete sample requires complete selection evidence')
      const expected = deterministicCityLaunchSample({
        cityId: expectedCityId,
        artifactSha256: artifact.artifactSha256,
        selectionEvidenceSha256: selection.evidenceSha256,
        periodStart: sample.periodStart,
        periodEnd: sample.periodEnd,
        targetRows: sample.targetRows,
        populationIds: selection.rows.map((row) => row.id),
      })
      invariant(sample.samplingId === expected.samplingId, 'sample samplingId does not match its bound population and period')
      invariant(
        sample.rows.map((row) => row.id).join('|') === expected.selectedIds.join('|'),
        'sample row IDs do not match the deterministic sample',
      )
    }
  }
}

function share(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

function evidenceMetrics(evidence, asOfMs) {
  const { artifact, sourceHealth, selection, sample, ciReceipt } = evidence
  const selectionComplete = selection?.complete === true && selection.rows.length > 0
  const selected = selectionComplete ? selection.rows : []
  const knownFamilies = selected.filter((row) => row.sourceFamily !== null)
  const familyCounts = new Map()
  for (const row of knownFamilies) familyCounts.set(row.sourceFamily, (familyCounts.get(row.sourceFamily) || 0) + 1)
  const maxFamilyCount = familyCounts.size === 0 ? 0 : Math.max(...familyCounts.values())
  const dominantSourceFamilies = [...familyCounts]
    .filter(([, count]) => count === maxFamilyCount)
    .map(([family]) => family)
    .sort((left, right) => left.localeCompare(right))

  const recommendations = selected.filter((row) => row.recommended)
  const healthyFamilies = new Set((sourceHealth?.families || [])
    .filter((family) => family.active && family.status === 'healthy')
    .map((family) => family.family))
  const recommendationsWithProvenance = recommendations.filter((row) => (
    row.provenance?.kind === 'first-party-record'
    || (row.provenance?.kind === 'healthy-source-link' && healthyFamilies.has(row.provenance.sourceFamily))
  ))
  const claimReceipts = selected.flatMap((row) => row.claims.map((claim) => ({
    claim,
    evidence: new Map(row.claimEvidence.map((entry) => [entry.ref, entry])),
  })))
  // This proves only typed, hash-identified receipt completeness. The
  // evaluator deliberately does not claim the underlying facts are true.
  const supportedClaimReceipts = claimReceipts.filter(({ claim, evidence }) => {
    const supplied = new Set(claim.evidenceRefs)
    const suppliedKinds = new Set(claim.evidenceRefs.map((ref) => evidence.get(ref)?.kind))
    return claim.requiredEvidenceRefs.every((ref) => supplied.has(ref) && evidence.has(ref))
      && REQUIRED_CLAIM_EVIDENCE_KINDS[claim.type].every((kind) => suppliedKinds.has(kind))
  })

  return {
    activeIndependentSourceFamilies: sourceHealth?.complete
      ? sourceHealth.families.filter((family) => family.active && family.independent).length
      : null,
    decisionReadySourceFamilyCount: selectionComplete && knownFamilies.length === selected.length ? familyCounts.size : null,
    decisionReadySourceFamilyMaxShare: selectionComplete && knownFamilies.length === selected.length
      ? share(maxFamilyCount, selected.length)
      : null,
    dominantSourceFamilies: selectionComplete && knownFamilies.length === selected.length ? dominantSourceFamilies : [],
    artifactExpiredShare: artifact?.qualityComplete && artifact.totalRows > 0
      ? share(artifact.expiredRows, artifact.totalRows)
      : null,
    visibleExpiredShare: selectionComplete
      ? share(selected.filter((row) => row.expiredAtRender).length, selected.length)
      : null,
    actionableTimeShare: selectionComplete
      ? share(selected.filter((row) => row.actionableTime).length, selected.length)
      : null,
    decisionReadyLocationShare: selectionComplete
      ? share(selected.filter((row) => row.decisionReadyLocation).length, selected.length)
      : null,
    knownPriceOrFreeShare: selectionComplete
      ? share(selected.filter((row) => row.knownPriceOrFree).length, selected.length)
      : null,
    severeSampleErrorShare: sample?.reviewComplete && sample.rows.length > 0
      ? share(sample.rows.filter((row) => row.severeError).length, sample.rows.length)
      : null,
    recommendationProvenanceShare: selectionComplete
      ? recommendations.length === 0 ? 1 : share(recommendationsWithProvenance.length, recommendations.length)
      : null,
    claimEvidenceReceiptShare: selectionComplete && selection.claimEnumerationComplete
      ? claimReceipts.length === 0 ? 1 : share(supportedClaimReceipts.length, claimReceipts.length)
      : null,
    humanSampleRows: sample?.reviewComplete ? sample.rows.length : null,
    artifactAgeHours: artifact ? Math.max(0, asOfMs - Date.parse(artifact.generatedAt)) / HOURS_MS : null,
    sourceHealthAgeHours: sourceHealth ? Math.max(0, asOfMs - Date.parse(sourceHealth.checkedAt)) / HOURS_MS : null,
    selectionAgeHours: selection ? Math.max(0, asOfMs - Date.parse(selection.observedAt)) / HOURS_MS : null,
    humanSampleAgeHours: sample ? Math.max(0, asOfMs - Date.parse(sample.reviewedAt)) / HOURS_MS : null,
    artifactExpiresAt: artifact?.expiresAt || null,
    ciArtifactApproved: ciReceipt?.artifactApprovedByCi ?? null,
    ciQualityReportApproved: ciReceipt?.qualityReportApprovedByCi ?? null,
    ciSourceHealthApproved: ciReceipt?.sourceHealthApprovedByCi ?? null,
    sourceHealthStatus: sourceHealth?.status || null,
  }
}

function addInsufficiencyReasons(reasons, evidence, metrics, thresholds) {
  if (!thresholds) reasons.add('THRESHOLDS_MISSING')
  if (!evidence.artifact) reasons.add('EVIDENCE_ARTIFACT_MISSING')
  if (!evidence.sourceHealth) reasons.add('EVIDENCE_SOURCE_HEALTH_MISSING')
  if (!evidence.selection) reasons.add('EVIDENCE_SELECTION_MISSING')
  if (!evidence.sample) reasons.add('EVIDENCE_SAMPLE_MISSING')
  if (!evidence.ciReceipt) reasons.add('EVIDENCE_CI_RECEIPT_MISSING')
  if (evidence.artifact?.totalRows === 0) reasons.add('ARTIFACT_POPULATION_EMPTY')
  if (evidence.artifact && (!evidence.artifact.qualityComplete || evidence.artifact.expiredRows === null)) {
    reasons.add('ARTIFACT_EXPIRY_EVIDENCE_INCOMPLETE')
  }
  if (evidence.sourceHealth && !evidence.sourceHealth.complete) reasons.add('SOURCE_HEALTH_EVIDENCE_INCOMPLETE')
  if (evidence.selection && !evidence.selection.complete) reasons.add('SELECTION_EVIDENCE_INCOMPLETE')
  if (evidence.selection?.populationCount === 0) reasons.add('SELECTION_POPULATION_EMPTY')
  if (evidence.selection?.complete && metrics.decisionReadySourceFamilyMaxShare === null) {
    reasons.add('SELECTION_SOURCE_FAMILY_INCOMPLETE')
  }
  if (evidence.selection && metrics.selectionAgeHours > MAX_CLOCK_SKEW_MS / HOURS_MS) {
    reasons.add('SELECTION_OBSERVATION_NOT_CURRENT')
  }
  if (evidence.selection && !evidence.selection.claimEnumerationComplete) reasons.add('CLAIM_ENUMERATION_INCOMPLETE')
  if (evidence.sample && !evidence.sample.reviewComplete) reasons.add('HUMAN_SAMPLE_EVIDENCE_INCOMPLETE')
  if (evidence.sample?.rows.length === 0) reasons.add('HUMAN_SAMPLE_EMPTY')
}

function comparisonChecks(metrics, thresholds, evidence, asOfMs) {
  if (!thresholds) return []
  const checks = []
  const add = (id, metric, operator, threshold, passes, reasonCode) => {
    checks.push({ id, metric, operator, threshold, passes: metric === null ? null : passes, reasonCode })
  }
  add(
    'active-independent-source-families',
    metrics.activeIndependentSourceFamilies,
    'at-least',
    thresholds.minimumActiveIndependentSourceFamilies,
    metrics.activeIndependentSourceFamilies >= thresholds.minimumActiveIndependentSourceFamilies,
    'ACTIVE_INDEPENDENT_SOURCE_FAMILIES_BELOW_MINIMUM',
  )
  add(
    'decision-ready-source-family-share',
    metrics.decisionReadySourceFamilyMaxShare,
    'at-most',
    thresholds.maximumDecisionReadySourceFamilyShare,
    metrics.decisionReadySourceFamilyMaxShare <= thresholds.maximumDecisionReadySourceFamilyShare,
    'DECISION_READY_SOURCE_FAMILY_SHARE_ABOVE_MAXIMUM',
  )
  add(
    'artifact-expired-share',
    metrics.artifactExpiredShare,
    'less-than',
    thresholds.maximumArtifactExpiredShare,
    metrics.artifactExpiredShare < thresholds.maximumArtifactExpiredShare,
    'ARTIFACT_EXPIRED_SHARE_NOT_BELOW_MAXIMUM',
  )
  add(
    'visible-expired-share',
    metrics.visibleExpiredShare,
    'less-than',
    thresholds.maximumVisibleExpiredShare,
    metrics.visibleExpiredShare < thresholds.maximumVisibleExpiredShare,
    'VISIBLE_EXPIRED_SHARE_NOT_BELOW_MAXIMUM',
  )
  add(
    'actionable-time-share',
    metrics.actionableTimeShare,
    'at-least',
    thresholds.minimumActionableTimeShare,
    metrics.actionableTimeShare >= thresholds.minimumActionableTimeShare,
    'ACTIONABLE_TIME_SHARE_BELOW_MINIMUM',
  )
  add(
    'decision-ready-location-share',
    metrics.decisionReadyLocationShare,
    'at-least',
    thresholds.minimumDecisionReadyLocationShare,
    metrics.decisionReadyLocationShare >= thresholds.minimumDecisionReadyLocationShare,
    'DECISION_READY_LOCATION_SHARE_BELOW_MINIMUM',
  )
  add(
    'known-price-or-free-share',
    metrics.knownPriceOrFreeShare,
    'at-least',
    thresholds.minimumKnownPriceOrFreeShare,
    metrics.knownPriceOrFreeShare >= thresholds.minimumKnownPriceOrFreeShare,
    'KNOWN_PRICE_OR_FREE_SHARE_BELOW_MINIMUM',
  )
  add(
    'severe-sample-error-share',
    metrics.severeSampleErrorShare,
    'less-than',
    thresholds.maximumSevereSampleErrorShare,
    metrics.severeSampleErrorShare < thresholds.maximumSevereSampleErrorShare,
    'SEVERE_SAMPLE_ERROR_SHARE_NOT_BELOW_MAXIMUM',
  )
  add(
    'recommendation-provenance-share',
    metrics.recommendationProvenanceShare,
    'at-least',
    thresholds.minimumRecommendationProvenanceShare,
    metrics.recommendationProvenanceShare >= thresholds.minimumRecommendationProvenanceShare,
    'RECOMMENDATION_PROVENANCE_SHARE_BELOW_MINIMUM',
  )
  add(
    'claim-evidence-receipt-share',
    metrics.claimEvidenceReceiptShare,
    'at-least',
    thresholds.minimumClaimEvidenceReceiptShare,
    metrics.claimEvidenceReceiptShare >= thresholds.minimumClaimEvidenceReceiptShare,
    'CLAIM_EVIDENCE_RECEIPT_SHARE_BELOW_MINIMUM',
  )
  add(
    'artifact-age-hours',
    metrics.artifactAgeHours,
    'at-most',
    thresholds.maximumArtifactAgeHours,
    metrics.artifactAgeHours <= thresholds.maximumArtifactAgeHours,
    'ARTIFACT_AGE_ABOVE_MAXIMUM',
  )
  add(
    'source-health-age-hours',
    metrics.sourceHealthAgeHours,
    'at-most',
    thresholds.maximumSourceHealthAgeHours,
    metrics.sourceHealthAgeHours <= thresholds.maximumSourceHealthAgeHours,
    'SOURCE_HEALTH_AGE_ABOVE_MAXIMUM',
  )
  add(
    'human-sample-age-hours',
    metrics.humanSampleAgeHours,
    'at-most',
    thresholds.maximumHumanSampleAgeHours,
    metrics.humanSampleAgeHours <= thresholds.maximumHumanSampleAgeHours,
    'HUMAN_SAMPLE_AGE_ABOVE_MAXIMUM',
  )
  add(
    'human-sample-rows',
    metrics.humanSampleRows,
    'at-least',
    thresholds.minimumHumanSampleRows,
    metrics.humanSampleRows >= thresholds.minimumHumanSampleRows,
    'HUMAN_SAMPLE_ROWS_BELOW_MINIMUM',
  )
  const artifactFresh = evidence.artifact ? asOfMs < Date.parse(evidence.artifact.expiresAt) : null
  checks.push({
    id: 'artifact-expiry-time',
    metric: artifactFresh,
    operator: 'is-true',
    threshold: true,
    passes: artifactFresh,
    reasonCode: 'ARTIFACT_EXPIRED',
  })
  return checks
}

/**
 * Evaluate one city against exact, hash-bound artifact and observation
 * receipts. The result is evidence-only: it contains no rollout instruction
 * and cannot become decision-ready under proposed or incomplete policy.
 */
export function evaluateCityLaunchGate(input) {
  exactKeys(input, ['schemaVersion', 'cityId', 'asOf', 'thresholds', 'evidence'], 'input')
  invariant(input.schemaVersion === CITY_LAUNCH_GATE_SCHEMA_VERSION, 'input.schemaVersion is unsupported')
  const expectedCityId = cityId(input.cityId, 'input.cityId')
  iso(input.asOf, 'input.asOf')
  const asOfMs = Date.parse(input.asOf)
  invariant(input.thresholds === null || plainObject(input.thresholds), 'input.thresholds must be an object or null')
  const thresholds = input.thresholds === null ? null : validateThresholds(input.thresholds, asOfMs)

  exactKeys(input.evidence, ['artifact', 'sourceHealth', 'selection', 'sample', 'ciReceipt'], 'input.evidence')
  for (const [key, value] of Object.entries(input.evidence)) {
    invariant(value === null || plainObject(value), `input.evidence.${key} must be an object or null`)
  }
  const evidence = {
    artifact: input.evidence.artifact && validateArtifact(input.evidence.artifact, expectedCityId, asOfMs),
    sourceHealth: input.evidence.sourceHealth && validateSourceHealth(input.evidence.sourceHealth, expectedCityId, asOfMs),
    selection: input.evidence.selection && validateSelection(input.evidence.selection, expectedCityId, asOfMs),
    sample: input.evidence.sample && validateSample(input.evidence.sample, expectedCityId, asOfMs),
    ciReceipt: input.evidence.ciReceipt && validateCiReceipt(input.evidence.ciReceipt, expectedCityId, asOfMs),
  }
  validateBindings(evidence, expectedCityId)

  const metrics = evidenceMetrics(evidence, asOfMs)
  const reasons = new Set()
  addInsufficiencyReasons(reasons, evidence, metrics, thresholds)
  const insufficiency = reasons.size > 0
  const ratified = thresholds?.ratification.state === 'ratified'
  if (thresholds && !ratified) reasons.add('THRESHOLDS_NOT_OWNER_RATIFIED')

  if (evidence.ciReceipt) {
    if (!evidence.ciReceipt.artifactApprovedByCi) reasons.add('ARTIFACT_NOT_APPROVED_BY_CI')
    if (!evidence.ciReceipt.qualityReportApprovedByCi) reasons.add('QUALITY_REPORT_NOT_APPROVED_BY_CI')
    if (!evidence.ciReceipt.sourceHealthApprovedByCi) reasons.add('SOURCE_HEALTH_NOT_APPROVED_BY_CI')
  }
  if (evidence.sourceHealth && evidence.sourceHealth.status !== 'healthy') reasons.add('SOURCE_HEALTH_NOT_HEALTHY')

  const checks = comparisonChecks(metrics, thresholds, evidence, asOfMs)
  for (const check of checks) if (check.passes === false) reasons.add(check.reasonCode)
  const reasonCodes = REASON_ORDER.filter((code) => reasons.has(code))
  invariant(reasonCodes.length === reasons.size, 'internal reason-code ordering is incomplete')

  const status = insufficiency
    ? 'insufficient'
    : !ratified
      ? 'unratified'
      : reasonCodes.length > 0
        ? 'not-ready'
        : 'decision-ready'

  return {
    schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
    gateVersion: CITY_LAUNCH_GATE_VERSION,
    policyId: thresholds ? cityLaunchPolicyId(thresholds) : null,
    cityId: expectedCityId,
    artifactSha256: evidence.artifact?.artifactSha256 || null,
    asOf: input.asOf,
    status,
    thresholdsRatified: ratified,
    reasonCodes,
    metrics,
    checks,
  }
}
