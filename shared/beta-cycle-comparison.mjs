import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  BETA_RESEARCH_SCHEMA_VERSION,
  normalizeBetaResearchReviewConfig,
  S11_BETA_CITY_IDS,
  S11_BETA_RESEARCH_LIMITS,
} from './beta-research.mjs'

export const BETA_CYCLE_COMPARISON_SCHEMA = 'wuzup-beta-cycle-comparison'
export const BETA_CYCLE_COMPARISON_SCHEMA_VERSION = 1
export const BETA_CYCLE_COMPARISON_CONFIG_SCHEMA = 'wuzup-beta-cycle-comparison-config'
export const BETA_CYCLE_COMPARISON_LIMITS = Object.freeze({
  maxCycleReportJsonBytes: 2 * 1024 * 1024,
  maxComparisonConfigJsonBytes: 256 * 1024,
})

const RESEARCH_REPORT_SCHEMA = 'wuzup-beta-research-report'
const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const MAX_SESSION_MS = 8 * 60 * 60 * 1000
const FILE_READ_CHUNK_BYTES = 64 * 1024
const REPORT_KEYS = Object.freeze([
  'schema',
  'schemaVersion',
  'siteReleaseId',
  'releases',
  'aggregate',
  'cities',
  'reviewConfig',
  'decision',
])
const RELEASE_KEYS = Object.freeze(['cityId', 'siteReleaseId', 'manifestId', 'buildId'])
const CITY_REPORT_KEYS = Object.freeze([...RELEASE_KEYS, 'metrics'])
const METRIC_BUNDLE_KEYS = Object.freeze([
  'sessionCount',
  'timeToCredibleOption',
  'timeToFirstRetainedValue',
  'sourceLink',
  'emptySearches',
  'duplicateExposures',
  'corrections',
  'repeatUse',
  'corePromise',
])
const TIMING_KEYS = Object.freeze([
  'observedSessions',
  'sessionDenominator',
  'missingSessions',
  'medianMs',
  'p75Ms',
])
const SOURCE_LINK_KEYS = Object.freeze([
  'successfulAttempts',
  'attemptDenominator',
  'sessionDenominator',
  'successRate',
])
const COUNT_METRIC_KEYS = Object.freeze([
  'totalCount',
  'sessionsWithAny',
  'sessionDenominator',
  'sessionRate',
])
const REPEAT_USE_KEYS = Object.freeze(['returningSessions', 'sessionDenominator', 'rate'])
const CORE_PROMISE_KEYS = Object.freeze([
  'yes',
  'no',
  'unclear',
  'sessionDenominator',
  'yesRate',
  'noRate',
  'unclearRate',
])
const REVIEW_CONFIG_KEYS = Object.freeze([
  'requiredCityIds',
  'minimumSessionsPerCity',
  'expectedSiteReleaseId',
  'expectedReleases',
])
const REVIEW_RELEASE_KEYS = Object.freeze(['manifestId', 'buildId'])
const DECISION_KEYS = Object.freeze(['status', 'configured', 'reasons', 'interpretation'])
const CONFIG_KEYS = Object.freeze([
  'schema',
  'schemaVersion',
  'requiredCityIds',
  'expectedCycles',
  'readinessThresholds',
])
const EXPECTED_CYCLE_KEYS = Object.freeze(['siteReleaseId', 'releases', 'reportId'])
const READINESS_THRESHOLD_KEYS = Object.freeze([
  'minimumSessionsPerCity',
  'minimumCredibleOptionObservationsPerCity',
  'minimumRetainedValueObservationsPerCity',
  'minimumSourceLinkAttemptsPerCity',
  'minimumRepeatUseResponsesPerCity',
])

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function isStrictPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value, expected, label) {
  invariant(isStrictPlainObject(value), `${label} must be a plain object`)
  const actualKeys = Reflect.ownKeys(value)
  invariant(actualKeys.every(key => typeof key === 'string'), `${label} must not contain symbol fields`)
  const actual = [...actualKeys].sort()
  const canonical = [...expected].sort()
  invariant(
    actual.length === canonical.length && actual.every((key, index) => key === canonical[index]),
    `${label} must contain exactly: ${canonical.join(', ')}`,
  )
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    invariant(
      descriptor?.enumerable === true && 'value' in descriptor,
      `${label}.${key} must be an enumerable data field`,
    )
  }
}

function exactArray(value, length, label) {
  invariant(Array.isArray(value), `${label} must be an array`)
  invariant(Object.getPrototypeOf(value) === Array.prototype, `${label} must use the standard array prototype`)
  invariant(value.length === length, `${label} must contain exactly ${length} entries`)
  const ownKeys = Reflect.ownKeys(value)
  invariant(
    ownKeys.every((key) => (
      typeof key === 'string'
      && (key === 'length' || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < length))
    )),
    `${label} must be a dense array without extra fields`,
  )
  for (let index = 0; index < length; index += 1) {
    invariant(Object.hasOwn(value, index), `${label} must be dense`)
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    invariant(
      descriptor?.enumerable === true && 'value' in descriptor,
      `${label}[${index}] must be an enumerable data entry`,
    )
  }
}

function boundedInteger(value, minimum, maximum, label) {
  invariant(Number.isInteger(value) && value >= minimum && value <= maximum, `${label} is out of range`)
  return value
}

function boundedNumber(value, minimum, maximum, label) {
  invariant(
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum,
    `${label} is out of range`,
  )
  return value
}

function sha256(value, label) {
  invariant(typeof value === 'string' && SHA256_ID.test(value), `${label} is invalid`)
  return value
}

function expectedRatio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6))
}

function exactRatio(value, numerator, denominator, label) {
  const expected = expectedRatio(numerator, denominator)
  invariant(Object.is(value, expected), `${label} does not match its numerator and denominator`)
  return value
}

function nullableTiming(value, observedSessions, label, { allowHalf = false } = {}) {
  if (observedSessions === 0) {
    invariant(value === null, `${label} must be null without observations`)
    return null
  }
  const normalized = boundedNumber(value, 0, MAX_SESSION_MS, label)
  invariant(
    allowHalf ? Number.isInteger(normalized * 2) : Number.isInteger(normalized),
    `${label} is not reproducible from integer elapsed times`,
  )
  return normalized
}

function normalizeTiming(value, sessionCount, label) {
  exactKeys(value, TIMING_KEYS, label)
  const observedSessions = boundedInteger(value.observedSessions, 0, sessionCount, `${label}.observedSessions`)
  const missingSessions = boundedInteger(value.missingSessions, 0, sessionCount, `${label}.missingSessions`)
  invariant(value.sessionDenominator === sessionCount, `${label}.sessionDenominator is inconsistent`)
  invariant(observedSessions + missingSessions === sessionCount, `${label} does not preserve its denominator`)
  const medianMs = nullableTiming(value.medianMs, observedSessions, `${label}.medianMs`, { allowHalf: true })
  const p75Ms = nullableTiming(value.p75Ms, observedSessions, `${label}.p75Ms`)
  invariant(medianMs === null || medianMs <= p75Ms, `${label} timing order is invalid`)
  return Object.freeze({ observedSessions, sessionDenominator: sessionCount, missingSessions, medianMs, p75Ms })
}

function normalizeSourceLink(value, sessionCount, label) {
  exactKeys(value, SOURCE_LINK_KEYS, label)
  const attemptDenominator = boundedInteger(value.attemptDenominator, 0, sessionCount, `${label}.attemptDenominator`)
  const successfulAttempts = boundedInteger(value.successfulAttempts, 0, attemptDenominator, `${label}.successfulAttempts`)
  invariant(value.sessionDenominator === sessionCount, `${label}.sessionDenominator is inconsistent`)
  exactRatio(value.successRate, successfulAttempts, attemptDenominator, `${label}.successRate`)
  return Object.freeze({ successfulAttempts, attemptDenominator, sessionDenominator: sessionCount, successRate: value.successRate })
}

function normalizeCountMetric(value, sessionCount, label) {
  exactKeys(value, COUNT_METRIC_KEYS, label)
  const totalCount = boundedInteger(
    value.totalCount,
    0,
    sessionCount * S11_BETA_RESEARCH_LIMITS.maxSessionsPerCity,
    `${label}.totalCount`,
  )
  const sessionsWithAny = boundedInteger(value.sessionsWithAny, 0, sessionCount, `${label}.sessionsWithAny`)
  invariant(value.sessionDenominator === sessionCount, `${label}.sessionDenominator is inconsistent`)
  invariant(totalCount >= sessionsWithAny, `${label}.totalCount cannot be less than sessionsWithAny`)
  exactRatio(value.sessionRate, sessionsWithAny, sessionCount, `${label}.sessionRate`)
  return Object.freeze({ totalCount, sessionsWithAny, sessionDenominator: sessionCount, sessionRate: value.sessionRate })
}

function normalizeRepeatUse(value, sessionCount, label) {
  exactKeys(value, REPEAT_USE_KEYS, label)
  const returningSessions = boundedInteger(value.returningSessions, 0, sessionCount, `${label}.returningSessions`)
  invariant(value.sessionDenominator === sessionCount, `${label}.sessionDenominator is inconsistent`)
  exactRatio(value.rate, returningSessions, sessionCount, `${label}.rate`)
  return Object.freeze({ returningSessions, sessionDenominator: sessionCount, rate: value.rate })
}

function normalizeCorePromise(value, sessionCount, label) {
  exactKeys(value, CORE_PROMISE_KEYS, label)
  const yes = boundedInteger(value.yes, 0, sessionCount, `${label}.yes`)
  const no = boundedInteger(value.no, 0, sessionCount, `${label}.no`)
  const unclear = boundedInteger(value.unclear, 0, sessionCount, `${label}.unclear`)
  invariant(value.sessionDenominator === sessionCount, `${label}.sessionDenominator is inconsistent`)
  invariant(yes + no + unclear === sessionCount, `${label} does not preserve its denominator`)
  exactRatio(value.yesRate, yes, sessionCount, `${label}.yesRate`)
  exactRatio(value.noRate, no, sessionCount, `${label}.noRate`)
  exactRatio(value.unclearRate, unclear, sessionCount, `${label}.unclearRate`)
  return Object.freeze({
    yes,
    no,
    unclear,
    sessionDenominator: sessionCount,
    yesRate: value.yesRate,
    noRate: value.noRate,
    unclearRate: value.unclearRate,
  })
}

function normalizeMetricBundle(value, maximumSessions, label) {
  exactKeys(value, METRIC_BUNDLE_KEYS, label)
  const sessionCount = boundedInteger(value.sessionCount, 1, maximumSessions, `${label}.sessionCount`)
  const normalized = {
    sessionCount,
    timeToCredibleOption: normalizeTiming(value.timeToCredibleOption, sessionCount, `${label}.timeToCredibleOption`),
    timeToFirstRetainedValue: normalizeTiming(
      value.timeToFirstRetainedValue,
      sessionCount,
      `${label}.timeToFirstRetainedValue`,
    ),
    sourceLink: normalizeSourceLink(value.sourceLink, sessionCount, `${label}.sourceLink`),
    emptySearches: normalizeCountMetric(value.emptySearches, sessionCount, `${label}.emptySearches`),
    duplicateExposures: normalizeCountMetric(value.duplicateExposures, sessionCount, `${label}.duplicateExposures`),
    corrections: normalizeCountMetric(value.corrections, sessionCount, `${label}.corrections`),
    repeatUse: normalizeRepeatUse(value.repeatUse, sessionCount, `${label}.repeatUse`),
    corePromise: normalizeCorePromise(value.corePromise, sessionCount, `${label}.corePromise`),
  }
  invariant(
    normalized.timeToFirstRetainedValue.observedSessions <= normalized.timeToCredibleOption.observedSessions,
    `${label} cannot contain more retained-value observations than credible-option observations`,
  )
  invariant(
    normalized.sourceLink.attemptDenominator <= normalized.timeToCredibleOption.observedSessions,
    `${label} cannot contain more source-link attempts than credible-option observations`,
  )
  invariant(
    normalized.corePromise.yes <= normalized.timeToFirstRetainedValue.observedSessions
      && normalized.corePromise.yes <= normalized.sourceLink.successfulAttempts,
    `${label} core-promise yes count is inconsistent with retained and followed value`,
  )
  return Object.freeze(normalized)
}

function normalizeRelease(value, expectedSiteReleaseId, label) {
  exactKeys(value, RELEASE_KEYS, label)
  invariant(S11_BETA_CITY_IDS.includes(value.cityId), `${label}.cityId is not an S11 flagship`)
  invariant(value.siteReleaseId === expectedSiteReleaseId, `${label}.siteReleaseId is inconsistent`)
  return Object.freeze({
    cityId: value.cityId,
    siteReleaseId: sha256(value.siteReleaseId, `${label}.siteReleaseId`),
    manifestId: sha256(value.manifestId, `${label}.manifestId`),
    buildId: sha256(value.buildId, `${label}.buildId`),
  })
}

function normalizeReleaseArray(value, expectedSiteReleaseId, label) {
  exactArray(value, S11_BETA_CITY_IDS.length, label)
  const releases = value.map((release, index) => normalizeRelease(release, expectedSiteReleaseId, `${label}[${index}]`))
  const byCity = new Map(releases.map(release => [release.cityId, release]))
  invariant(byCity.size === S11_BETA_CITY_IDS.length, `${label} must contain each flagship city once`)
  invariant(S11_BETA_CITY_IDS.every(cityId => byCity.has(cityId)), `${label} must contain both flagship cities`)
  return Object.freeze(S11_BETA_CITY_IDS.map(cityId => byCity.get(cityId)))
}

function assertAdditiveMetrics(aggregate, cities, label) {
  const sum = selector => cities.reduce((total, city) => total + selector(city.metrics), 0)
  invariant(aggregate.sessionCount === sum(metrics => metrics.sessionCount), `${label}.aggregate session count is inconsistent`)
  for (const timingKey of ['timeToCredibleOption', 'timeToFirstRetainedValue']) {
    invariant(
      aggregate[timingKey].observedSessions === sum(metrics => metrics[timingKey].observedSessions),
      `${label}.aggregate.${timingKey}.observedSessions is inconsistent`,
    )
    invariant(
      aggregate[timingKey].missingSessions === sum(metrics => metrics[timingKey].missingSessions),
      `${label}.aggregate.${timingKey}.missingSessions is inconsistent`,
    )
  }
  for (const key of ['successfulAttempts', 'attemptDenominator']) {
    invariant(
      aggregate.sourceLink[key] === sum(metrics => metrics.sourceLink[key]),
      `${label}.aggregate.sourceLink.${key} is inconsistent`,
    )
  }
  for (const metricKey of ['emptySearches', 'duplicateExposures', 'corrections']) {
    for (const key of ['totalCount', 'sessionsWithAny']) {
      invariant(
        aggregate[metricKey][key] === sum(metrics => metrics[metricKey][key]),
        `${label}.aggregate.${metricKey}.${key} is inconsistent`,
      )
    }
  }
  invariant(
    aggregate.repeatUse.returningSessions === sum(metrics => metrics.repeatUse.returningSessions),
    `${label}.aggregate.repeatUse.returningSessions is inconsistent`,
  )
  for (const key of ['yes', 'no', 'unclear']) {
    invariant(
      aggregate.corePromise[key] === sum(metrics => metrics.corePromise[key]),
      `${label}.aggregate.corePromise.${key} is inconsistent`,
    )
  }
}

function validateReviewConfigShape(value, label) {
  exactKeys(value, REVIEW_CONFIG_KEYS, label)
  exactArray(value.requiredCityIds, S11_BETA_CITY_IDS.length, `${label}.requiredCityIds`)
  exactKeys(value.expectedReleases, S11_BETA_CITY_IDS, `${label}.expectedReleases`)
  for (const cityId of S11_BETA_CITY_IDS) {
    exactKeys(value.expectedReleases[cityId], REVIEW_RELEASE_KEYS, `${label}.expectedReleases.${cityId}`)
  }
}

function normalizeResearchDecision(value, cities, reviewConfig, label) {
  exactKeys(value, DECISION_KEYS, label)
  invariant(value.configured === true, `${label}.configured must be true`)
  const expectedReasons = []
  for (const cityId of S11_BETA_CITY_IDS) {
    const count = cities.find(city => city.cityId === cityId).metrics.sessionCount
    if (count < reviewConfig.minimumSessionsPerCity) {
      expectedReasons.push(`MINIMUM_SESSIONS_NOT_MET:${cityId}:${count}/${reviewConfig.minimumSessionsPerCity}`)
    }
  }
  const expectedStatus = expectedReasons.length === 0 ? 'reviewable' : 'insufficient'
  invariant(value.status === expectedStatus, `${label}.status is inconsistent`)
  exactArray(value.reasons, expectedReasons.length, `${label}.reasons`)
  invariant(
    value.reasons.every((reason, index) => reason === expectedReasons[index]),
    `${label}.reasons are inconsistent`,
  )
  invariant(
    value.interpretation === 'Reviewable is not a beta pass or fail decision.',
    `${label}.interpretation is invalid`,
  )
  return Object.freeze({
    status: expectedStatus,
    configured: true,
    reasons: Object.freeze([...expectedReasons]),
    interpretation: value.interpretation,
  })
}

/**
 * Validate a privacy-bounded aggregateBetaResearch report without accepting
 * receipts, participant identifiers, free text, timestamps, or unknown fields.
 */
export function normalizeBetaResearchCycleReport(value) {
  exactKeys(value, REPORT_KEYS, 'beta cycle report')
  invariant(value.schema === RESEARCH_REPORT_SCHEMA, 'beta cycle report schema is invalid')
  invariant(value.schemaVersion === BETA_RESEARCH_SCHEMA_VERSION, 'beta cycle report schema version is invalid')
  const siteReleaseId = sha256(value.siteReleaseId, 'beta cycle report siteReleaseId')
  const releases = normalizeReleaseArray(value.releases, siteReleaseId, 'beta cycle report releases')

  exactArray(value.cities, S11_BETA_CITY_IDS.length, 'beta cycle report cities')
  const cityReports = value.cities.map((city, index) => {
    const label = `beta cycle report cities[${index}]`
    exactKeys(city, CITY_REPORT_KEYS, label)
    const release = normalizeRelease({
      cityId: city.cityId,
      siteReleaseId: city.siteReleaseId,
      manifestId: city.manifestId,
      buildId: city.buildId,
    }, siteReleaseId, label)
    return Object.freeze({
      ...release,
      metrics: normalizeMetricBundle(city.metrics, S11_BETA_RESEARCH_LIMITS.maxSessionsPerCity, `${label}.metrics`),
    })
  })
  const cityById = new Map(cityReports.map(city => [city.cityId, city]))
  invariant(cityById.size === S11_BETA_CITY_IDS.length, 'beta cycle report cities must contain each flagship city once')
  invariant(S11_BETA_CITY_IDS.every(cityId => cityById.has(cityId)), 'beta cycle report must contain both flagship cities')
  const cities = Object.freeze(S11_BETA_CITY_IDS.map(cityId => cityById.get(cityId)))
  for (const release of releases) {
    const city = cityById.get(release.cityId)
    invariant(
      city.manifestId === release.manifestId && city.buildId === release.buildId,
      `beta cycle report release identity mismatch for ${release.cityId}`,
    )
  }

  const aggregate = normalizeMetricBundle(
    value.aggregate,
    S11_BETA_RESEARCH_LIMITS.maxTotalSessions,
    'beta cycle report aggregate',
  )
  assertAdditiveMetrics(aggregate, cities, 'beta cycle report')

  invariant(value.reviewConfig !== null, 'beta cycle report requires an explicit review config')
  validateReviewConfigShape(value.reviewConfig, 'beta cycle report reviewConfig')
  const reviewConfig = normalizeBetaResearchReviewConfig(value.reviewConfig)
  invariant(reviewConfig.expectedSiteReleaseId === siteReleaseId, 'beta cycle report review release identity mismatch')
  for (const release of releases) {
    const expected = reviewConfig.expectedReleases[release.cityId]
    invariant(
      expected.manifestId === release.manifestId && expected.buildId === release.buildId,
      `beta cycle report review release identity mismatch for ${release.cityId}`,
    )
  }
  const decision = normalizeResearchDecision(value.decision, cities, reviewConfig, 'beta cycle report decision')

  return Object.freeze({
    schema: RESEARCH_REPORT_SCHEMA,
    schemaVersion: BETA_RESEARCH_SCHEMA_VERSION,
    siteReleaseId,
    releases,
    aggregate,
    cities,
    reviewConfig,
    decision,
  })
}

function normalizedReportId(normalizedReport) {
  return `sha256:${createHash('sha256').update(JSON.stringify(normalizedReport)).digest('hex')}`
}

/**
 * Produce the semantic identity owner configuration must pin. The digest is
 * over the canonical normalized report, so JSON whitespace and input key order
 * cannot change it while any accepted metric, denominator, or identity does.
 */
export function betaResearchCycleReportId(value) {
  return normalizedReportId(normalizeBetaResearchCycleReport(value))
}

function normalizeExpectedCycle(value, label) {
  exactKeys(value, EXPECTED_CYCLE_KEYS, label)
  const siteReleaseId = sha256(value.siteReleaseId, `${label}.siteReleaseId`)
  const releases = normalizeReleaseArray(value.releases, siteReleaseId, `${label}.releases`)
  const reportId = sha256(value.reportId, `${label}.reportId`)
  return Object.freeze({ siteReleaseId, releases, reportId })
}

export function normalizeBetaCycleComparisonConfig(value) {
  exactKeys(value, CONFIG_KEYS, 'beta cycle comparison config')
  invariant(value.schema === BETA_CYCLE_COMPARISON_CONFIG_SCHEMA, 'beta cycle comparison config schema is invalid')
  invariant(
    value.schemaVersion === BETA_CYCLE_COMPARISON_SCHEMA_VERSION,
    'beta cycle comparison config schema version is invalid',
  )
  exactArray(value.requiredCityIds, S11_BETA_CITY_IDS.length, 'beta cycle comparison requiredCityIds')
  invariant(
    value.requiredCityIds.every((cityId, index) => cityId === S11_BETA_CITY_IDS[index]),
    'beta cycle comparison config must require the canonical two flagship cities',
  )
  exactArray(value.expectedCycles, 2, 'beta cycle comparison expectedCycles')
  const expectedCycles = Object.freeze(value.expectedCycles.map((cycle, index) => (
    normalizeExpectedCycle(cycle, `beta cycle comparison expectedCycles[${index}]`)
  )))
  invariant(
    expectedCycles[0].siteReleaseId !== expectedCycles[1].siteReleaseId,
    'beta cycle comparison expectedCycles must identify two distinct composed releases',
  )

  exactKeys(value.readinessThresholds, READINESS_THRESHOLD_KEYS, 'beta cycle comparison readinessThresholds')
  const readinessThresholds = Object.freeze(Object.fromEntries(READINESS_THRESHOLD_KEYS.map((key) => {
    const minimum = key === 'minimumSessionsPerCity' || key === 'minimumRepeatUseResponsesPerCity' ? 1 : 0
    return [
      key,
      boundedInteger(
        value.readinessThresholds[key],
        minimum,
        S11_BETA_RESEARCH_LIMITS.maxSessionsPerCity,
        `beta cycle comparison readinessThresholds.${key}`,
      ),
    ]
  })))

  return Object.freeze({
    schema: BETA_CYCLE_COMPARISON_CONFIG_SCHEMA,
    schemaVersion: BETA_CYCLE_COMPARISON_SCHEMA_VERSION,
    requiredCityIds: Object.freeze([...S11_BETA_CITY_IDS]),
    expectedCycles,
    readinessThresholds,
  })
}

function sameRelease(left, right) {
  return left.cityId === right.cityId
    && left.siteReleaseId === right.siteReleaseId
    && left.manifestId === right.manifestId
    && left.buildId === right.buildId
}

function cycleMatchesExpected(cycle, expected) {
  return cycle.siteReleaseId === expected.siteReleaseId
    && cycle.releases.every((release, index) => sameRelease(release, expected.releases[index]))
    && normalizedReportId(cycle) === expected.reportId
}

function numericDelta(baseline, candidate) {
  return Number((candidate - baseline).toFixed(6))
}

function nullableDelta(baseline, candidate) {
  return baseline === null || candidate === null ? null : numericDelta(baseline, candidate)
}

function scalarComparison(baseline, candidate) {
  return Object.freeze({ baseline, candidate, delta: numericDelta(baseline, candidate) })
}

function timingComparison(baseline, candidate) {
  return Object.freeze({
    baseline,
    candidate,
    delta: Object.freeze({
      observedSessions: candidate.observedSessions - baseline.observedSessions,
      sessionDenominator: candidate.sessionDenominator - baseline.sessionDenominator,
      missingSessions: candidate.missingSessions - baseline.missingSessions,
      medianMs: nullableDelta(baseline.medianMs, candidate.medianMs),
      p75Ms: nullableDelta(baseline.p75Ms, candidate.p75Ms),
    }),
  })
}

function fieldComparison(baseline, candidate, keys) {
  return Object.freeze({
    baseline,
    candidate,
    delta: Object.freeze(Object.fromEntries(keys.map(key => [key, nullableDelta(baseline[key], candidate[key])]))),
  })
}

function metricComparison(baseline, candidate) {
  return Object.freeze({
    sessionCount: scalarComparison(baseline.sessionCount, candidate.sessionCount),
    timeToCredibleOption: timingComparison(baseline.timeToCredibleOption, candidate.timeToCredibleOption),
    timeToFirstRetainedValue: timingComparison(
      baseline.timeToFirstRetainedValue,
      candidate.timeToFirstRetainedValue,
    ),
    sourceLink: fieldComparison(baseline.sourceLink, candidate.sourceLink, SOURCE_LINK_KEYS),
    emptySearches: fieldComparison(baseline.emptySearches, candidate.emptySearches, COUNT_METRIC_KEYS),
    duplicateExposures: fieldComparison(
      baseline.duplicateExposures,
      candidate.duplicateExposures,
      COUNT_METRIC_KEYS,
    ),
    corrections: fieldComparison(baseline.corrections, candidate.corrections, COUNT_METRIC_KEYS),
    repeatUse: fieldComparison(baseline.repeatUse, candidate.repeatUse, REPEAT_USE_KEYS),
    corePromise: fieldComparison(baseline.corePromise, candidate.corePromise, CORE_PROMISE_KEYS),
  })
}

function readinessReasons(cycles, thresholds) {
  const reasons = []
  const checks = Object.freeze([
    ['minimumSessionsPerCity', metrics => metrics.sessionCount, 'MINIMUM_SESSIONS_NOT_MET'],
    [
      'minimumCredibleOptionObservationsPerCity',
      metrics => metrics.timeToCredibleOption.observedSessions,
      'MINIMUM_CREDIBLE_OPTION_OBSERVATIONS_NOT_MET',
    ],
    [
      'minimumRetainedValueObservationsPerCity',
      metrics => metrics.timeToFirstRetainedValue.observedSessions,
      'MINIMUM_RETAINED_VALUE_OBSERVATIONS_NOT_MET',
    ],
    [
      'minimumSourceLinkAttemptsPerCity',
      metrics => metrics.sourceLink.attemptDenominator,
      'MINIMUM_SOURCE_LINK_ATTEMPTS_NOT_MET',
    ],
    [
      'minimumRepeatUseResponsesPerCity',
      metrics => metrics.repeatUse.sessionDenominator,
      'MINIMUM_REPEAT_USE_RESPONSES_NOT_MET',
    ],
  ])

  cycles.forEach((cycle, cycleIndex) => {
    if (cycle.decision.status !== 'reviewable') {
      reasons.push(`SOURCE_REPORT_NOT_REVIEWABLE:cycle-${cycleIndex + 1}`)
    }
    for (const city of cycle.cities) {
      for (const [thresholdKey, readActual, reason] of checks) {
        const actual = readActual(city.metrics)
        const required = thresholds[thresholdKey]
        if (actual < required) reasons.push(`${reason}:cycle-${cycleIndex + 1}:${city.cityId}:${actual}/${required}`)
      }
    }
  })
  return Object.freeze(reasons)
}

function cycleSummary(cycle, position) {
  return Object.freeze({
    position,
    reportId: normalizedReportId(cycle),
    siteReleaseId: cycle.siteReleaseId,
    releases: cycle.releases,
    researchDecision: cycle.decision,
    researchMinimumSessionsPerCity: cycle.reviewConfig.minimumSessionsPerCity,
    aggregate: cycle.aggregate,
    cities: cycle.cities,
  })
}

/**
 * Compare exactly two owner-pinned research cycles. Evidence-ready means only
 * that the configured evidence denominators exist; it is never a signal pass,
 * pilot authorization, or go/no-go decision. Evidence against the currently
 * ratified Tampa and SF launch gates and the owner's signal/go-no-go rules are
 * separate mandatory inputs before expansion. Same-release equivalent cycles
 * are outside this contract and require a new owner-ratified protocol.
 */
export function compareBetaResearchCycles(cycleReports, { comparisonConfig } = {}) {
  exactArray(cycleReports, 2, 'beta cycle reports')
  invariant(comparisonConfig !== null && comparisonConfig !== undefined, 'beta cycle comparison config is required')
  const config = normalizeBetaCycleComparisonConfig(comparisonConfig)
  const normalized = cycleReports.map(normalizeBetaResearchCycleReport)
  invariant(
    normalized[0].siteReleaseId !== normalized[1].siteReleaseId,
    'beta cycle comparison received duplicate composed-release cycles',
  )

  const cycles = config.expectedCycles.map((expected, expectedIndex) => {
    const matches = normalized.filter(cycle => cycleMatchesExpected(cycle, expected))
    invariant(matches.length === 1, `beta cycle comparison cycle-${expectedIndex + 1} identity mismatch`)
    return matches[0]
  })
  const reasons = readinessReasons(cycles, config.readinessThresholds)
  const status = reasons.length === 0 ? 'evidence-ready' : 'insufficient'
  const baselineByCity = new Map(cycles[0].cities.map(city => [city.cityId, city]))
  const candidateByCity = new Map(cycles[1].cities.map(city => [city.cityId, city]))

  return Object.freeze({
    schema: BETA_CYCLE_COMPARISON_SCHEMA,
    schemaVersion: BETA_CYCLE_COMPARISON_SCHEMA_VERSION,
    status,
    reasons,
    interpretation: status === 'evidence-ready'
      ? 'Evidence-ready means only that configured comparison denominators are present; no signal pass, pilot authorization, or expansion decision is inferred. Evidence against the currently ratified Tampa and SF launch gates and the owner signal and go/no-go rules are separate mandatory inputs before expansion.'
      : 'Evidence is insufficient under the owner-supplied comparison thresholds; no signal pass, pilot authorization, or expansion decision is inferred. Evidence against the currently ratified Tampa and SF launch gates and the owner signal and go/no-go rules are separate mandatory inputs before expansion.',
    config,
    cycles: Object.freeze([
      cycleSummary(cycles[0], 'baseline'),
      cycleSummary(cycles[1], 'candidate'),
    ]),
    deltas: Object.freeze({
      aggregate: metricComparison(cycles[0].aggregate, cycles[1].aggregate),
      cities: Object.freeze(S11_BETA_CITY_IDS.map(cityId => Object.freeze({
        cityId,
        metrics: metricComparison(baselineByCity.get(cityId).metrics, candidateByCity.get(cityId).metrics),
      }))),
    }),
  })
}

function stableFileIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs]
}

async function readBoundedJsonFile(filePath, maximumBytes, label) {
  invariant(typeof filePath === 'string' && filePath.trim().length > 0, `${label} path must be non-empty`)
  const handle = await open(path.resolve(filePath), 'r')
  try {
    const before = await handle.stat({ bigint: true })
    invariant(before.isFile(), `${label} must be a regular file`)
    invariant(before.size <= BigInt(maximumBytes), `${label} exceeds its byte limit`)

    const chunks = []
    let totalBytes = 0
    while (totalBytes <= maximumBytes) {
      const remaining = maximumBytes + 1 - totalBytes
      const chunk = Buffer.allocUnsafe(Math.min(FILE_READ_CHUNK_BYTES, remaining))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      totalBytes += bytesRead
    }
    invariant(totalBytes <= maximumBytes, `${label} exceeds its byte limit`)

    const after = await handle.stat({ bigint: true })
    invariant(after.isFile(), `${label} must remain a regular file`)
    const beforeIdentity = stableFileIdentity(before)
    const afterIdentity = stableFileIdentity(after)
    invariant(
      beforeIdentity.every((entry, index) => entry === afterIdentity[index]),
      `${label} changed while it was being read`,
    )

    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, totalBytes))
    } catch {
      throw new TypeError(`${label} is not valid UTF-8`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new TypeError(`${label} is not valid JSON`)
    }
  } finally {
    await handle.close()
  }
}

export async function compareBetaResearchCycleFiles(baselinePath, candidatePath, configPath) {
  const [baseline, candidate, comparisonConfig] = await Promise.all([
    readBoundedJsonFile(
      baselinePath,
      BETA_CYCLE_COMPARISON_LIMITS.maxCycleReportJsonBytes,
      'baseline beta cycle report file',
    ),
    readBoundedJsonFile(
      candidatePath,
      BETA_CYCLE_COMPARISON_LIMITS.maxCycleReportJsonBytes,
      'candidate beta cycle report file',
    ),
    readBoundedJsonFile(
      configPath,
      BETA_CYCLE_COMPARISON_LIMITS.maxComparisonConfigJsonBytes,
      'beta cycle comparison config file',
    ),
  ])
  return compareBetaResearchCycles([baseline, candidate], { comparisonConfig })
}

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const [baselinePath, candidatePath, configPath] = process.argv.slice(2)
  if (!baselinePath || !candidatePath || !configPath) {
    process.stderr.write(
      'Usage: node shared/beta-cycle-comparison.mjs <baseline-report.json> <candidate-report.json> <comparison-config.json>\n',
    )
    process.exitCode = 1
  } else {
    try {
      const comparison = await compareBetaResearchCycleFiles(baselinePath, candidatePath, configPath)
      process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`)
    } catch (error) {
      process.stderr.write(`${error?.message || error}\n`)
      process.exitCode = 1
    }
  }
}
