import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BETA_RESEARCH_SCHEMA = 'wuzup-beta-research-session'
export const BETA_RESEARCH_SCHEMA_VERSION = 1
export const S11_BETA_CITY_IDS = Object.freeze(['sf-east-bay', 'tampa-bay'])

const RECEIPT_KEYS = Object.freeze([
  'schema',
  'schemaVersion',
  'sessionReceiptId',
  'cityId',
  'manifestId',
  'buildId',
  'durationMs',
  'milestones',
  'sourceLinkOutcome',
  'counts',
  'returningUse',
  'corePromise',
])
const MILESTONE_KEYS = Object.freeze(['credibleOptionMs', 'firstRetainedValueMs'])
const COUNT_KEYS = Object.freeze(['emptySearches', 'duplicateExposures', 'corrections'])
const REVIEW_CONFIG_KEYS = Object.freeze(['requiredCityIds', 'minimumSessionsPerCity', 'expectedReleases'])
const RELEASE_KEYS = Object.freeze(['manifestId', 'buildId'])
const SOURCE_LINK_OUTCOMES = new Set(['not-attempted', 'succeeded', 'failed'])
const CORE_PROMISE_OUTCOMES = new Set(['yes', 'no', 'unclear'])
const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const SESSION_RECEIPT_ID = /^r-[a-f0-9]{32}$/
const MAX_SESSION_MS = 8 * 60 * 60 * 1000
const MAX_SESSION_COUNT = 1000

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function exactKeys(value, expected, label) {
  invariant(plainObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  invariant(
    actual.length === canonical.length && actual.every((key, index) => key === canonical[index]),
    `${label} must contain exactly: ${canonical.join(', ')}`,
  )
}

function boundedInteger(value, minimum, maximum, label) {
  invariant(Number.isInteger(value) && value >= minimum && value <= maximum, `${label} is out of range`)
  return value
}

function nullableElapsed(value, durationMs, label) {
  if (value === null) return null
  return boundedInteger(value, 0, durationMs, label)
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6))
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function nearestRank(values, percentile) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
}

function freezeReceipt(receipt) {
  Object.freeze(receipt.milestones)
  Object.freeze(receipt.counts)
  return Object.freeze(receipt)
}

/**
 * Validate one observer-recorded beta session without accepting identifiers,
 * wall-clock timestamps, free text, listing facts, queries, or location data.
 */
export function normalizeBetaResearchReceipt(value) {
  exactKeys(value, RECEIPT_KEYS, 'beta research receipt')
  invariant(value.schema === BETA_RESEARCH_SCHEMA, 'beta research receipt schema is invalid')
  invariant(value.schemaVersion === BETA_RESEARCH_SCHEMA_VERSION, 'beta research receipt version is invalid')
  invariant(
    typeof value.sessionReceiptId === 'string' && SESSION_RECEIPT_ID.test(value.sessionReceiptId),
    'beta research receipt sessionReceiptId is invalid',
  )
  invariant(S11_BETA_CITY_IDS.includes(value.cityId), 'beta research receipt cityId is not an S11 flagship')
  invariant(
    typeof value.manifestId === 'string' && SHA256_ID.test(value.manifestId),
    'beta research receipt manifestId is invalid',
  )
  invariant(
    typeof value.buildId === 'string' && SHA256_ID.test(value.buildId),
    'beta research receipt buildId is invalid',
  )

  const durationMs = boundedInteger(value.durationMs, 1, MAX_SESSION_MS, 'beta research receipt durationMs')
  exactKeys(value.milestones, MILESTONE_KEYS, 'beta research receipt milestones')
  const credibleOptionMs = nullableElapsed(
    value.milestones.credibleOptionMs,
    durationMs,
    'beta research receipt credibleOptionMs',
  )
  const firstRetainedValueMs = nullableElapsed(
    value.milestones.firstRetainedValueMs,
    durationMs,
    'beta research receipt firstRetainedValueMs',
  )
  invariant(
    firstRetainedValueMs === null || credibleOptionMs !== null,
    'beta research receipt cannot retain value before a credible option',
  )
  invariant(
    firstRetainedValueMs === null || credibleOptionMs <= firstRetainedValueMs,
    'beta research receipt milestones are not monotonic',
  )

  invariant(
    SOURCE_LINK_OUTCOMES.has(value.sourceLinkOutcome),
    'beta research receipt sourceLinkOutcome is invalid',
  )
  invariant(
    value.sourceLinkOutcome === 'not-attempted' || credibleOptionMs !== null,
    'beta research receipt cannot attempt a source link before a credible option',
  )
  exactKeys(value.counts, COUNT_KEYS, 'beta research receipt counts')
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [
    key,
    boundedInteger(value.counts[key], 0, MAX_SESSION_COUNT, `beta research receipt counts.${key}`),
  ]))
  invariant(typeof value.returningUse === 'boolean', 'beta research receipt returningUse must be boolean')
  invariant(CORE_PROMISE_OUTCOMES.has(value.corePromise), 'beta research receipt corePromise is invalid')
  invariant(
    value.corePromise !== 'yes' || (
      credibleOptionMs !== null &&
      firstRetainedValueMs !== null &&
      value.sourceLinkOutcome === 'succeeded'
    ),
    'beta research receipt cannot mark the core promise yes without credible, retained, and followed value',
  )

  return freezeReceipt({
    schema: BETA_RESEARCH_SCHEMA,
    schemaVersion: BETA_RESEARCH_SCHEMA_VERSION,
    sessionReceiptId: value.sessionReceiptId,
    cityId: value.cityId,
    manifestId: value.manifestId,
    buildId: value.buildId,
    durationMs,
    milestones: {
      credibleOptionMs,
      firstRetainedValueMs,
    },
    sourceLinkOutcome: value.sourceLinkOutcome,
    counts,
    returningUse: value.returningUse,
    corePromise: value.corePromise,
  })
}

function timingMetric(receipts, key) {
  const values = receipts.map((receipt) => receipt.milestones[key]).filter((value) => value !== null)
  return Object.freeze({
    observedSessions: values.length,
    sessionDenominator: receipts.length,
    missingSessions: receipts.length - values.length,
    medianMs: median(values),
    p75Ms: nearestRank(values, 0.75),
  })
}

function countMetric(receipts, key) {
  const totalCount = receipts.reduce((total, receipt) => total + receipt.counts[key], 0)
  const sessionsWithAny = receipts.filter((receipt) => receipt.counts[key] > 0).length
  return Object.freeze({
    totalCount,
    sessionsWithAny,
    sessionDenominator: receipts.length,
    sessionRate: ratio(sessionsWithAny, receipts.length),
  })
}

function metricBundle(receipts) {
  const attemptedLinks = receipts.filter((receipt) => receipt.sourceLinkOutcome !== 'not-attempted')
  const successfulLinks = attemptedLinks.filter((receipt) => receipt.sourceLinkOutcome === 'succeeded').length
  const returningSessions = receipts.filter((receipt) => receipt.returningUse).length
  const promise = {
    yes: receipts.filter((receipt) => receipt.corePromise === 'yes').length,
    no: receipts.filter((receipt) => receipt.corePromise === 'no').length,
    unclear: receipts.filter((receipt) => receipt.corePromise === 'unclear').length,
  }

  return Object.freeze({
    sessionCount: receipts.length,
    timeToCredibleOption: timingMetric(receipts, 'credibleOptionMs'),
    timeToFirstRetainedValue: timingMetric(receipts, 'firstRetainedValueMs'),
    sourceLink: Object.freeze({
      successfulAttempts: successfulLinks,
      attemptDenominator: attemptedLinks.length,
      sessionDenominator: receipts.length,
      successRate: ratio(successfulLinks, attemptedLinks.length),
    }),
    emptySearches: countMetric(receipts, 'emptySearches'),
    duplicateExposures: countMetric(receipts, 'duplicateExposures'),
    corrections: countMetric(receipts, 'corrections'),
    repeatUse: Object.freeze({
      returningSessions,
      sessionDenominator: receipts.length,
      rate: ratio(returningSessions, receipts.length),
    }),
    corePromise: Object.freeze({
      ...promise,
      sessionDenominator: receipts.length,
      yesRate: ratio(promise.yes, receipts.length),
      noRate: ratio(promise.no, receipts.length),
      unclearRate: ratio(promise.unclear, receipts.length),
    }),
  })
}

function normalizeReviewConfig(value) {
  if (value === null || value === undefined) return null
  exactKeys(value, REVIEW_CONFIG_KEYS, 'beta research review config')
  invariant(Array.isArray(value.requiredCityIds), 'beta research requiredCityIds must be an array')
  const cityIds = [...new Set(value.requiredCityIds)]
  invariant(cityIds.length === value.requiredCityIds.length, 'beta research requiredCityIds must be unique')
  invariant(
    cityIds.length === S11_BETA_CITY_IDS.length
      && S11_BETA_CITY_IDS.every((cityId) => cityIds.includes(cityId)),
    'beta research review config must require both S11 flagship cities',
  )
  exactKeys(value.expectedReleases, S11_BETA_CITY_IDS, 'beta research expectedReleases')
  const expectedReleases = {}
  for (const cityId of S11_BETA_CITY_IDS) {
    const release = value.expectedReleases[cityId]
    exactKeys(release, RELEASE_KEYS, `beta research expectedReleases.${cityId}`)
    for (const key of RELEASE_KEYS) {
      invariant(
        typeof release[key] === 'string' && SHA256_ID.test(release[key]),
        `beta research expectedReleases.${cityId}.${key} is invalid`,
      )
    }
    expectedReleases[cityId] = Object.freeze({ manifestId: release.manifestId, buildId: release.buildId })
  }
  return Object.freeze({
    requiredCityIds: Object.freeze([...S11_BETA_CITY_IDS]),
    minimumSessionsPerCity: boundedInteger(
      value.minimumSessionsPerCity,
      1,
      MAX_SESSION_COUNT,
      'beta research minimumSessionsPerCity',
    ),
    expectedReleases: Object.freeze(expectedReleases),
  })
}

function reviewDecision(cityReports, config) {
  if (config === null) {
    return Object.freeze({
      status: 'insufficient',
      configured: false,
      reasons: Object.freeze(['REVIEW_CONFIG_REQUIRED']),
      interpretation: 'No beta pass or fail is inferred.',
    })
  }

  const byCity = new Map(cityReports.map((report) => [report.cityId, report]))
  const reasons = []
  for (const cityId of config.requiredCityIds) {
    const count = byCity.get(cityId)?.metrics.sessionCount || 0
    if (count < config.minimumSessionsPerCity) {
      reasons.push(`MINIMUM_SESSIONS_NOT_MET:${cityId}:${count}/${config.minimumSessionsPerCity}`)
    }
  }
  return Object.freeze({
    status: reasons.length === 0 ? 'reviewable' : 'insufficient',
    configured: true,
    reasons: Object.freeze(reasons),
    interpretation: 'Reviewable is not a beta pass or fail decision.',
  })
}

/**
 * Aggregate one S11 release cycle. Each city may contribute sessions from one
 * exact manifest/build pair only; mixed release bytes are a hard error.
 */
export function aggregateBetaResearch(receipts, { reviewConfig = null } = {}) {
  invariant(Array.isArray(receipts), 'beta research receipts must be an array')
  const normalized = receipts.map(normalizeBetaResearchReceipt)
  const receiptIds = new Set()
  for (const receipt of normalized) {
    invariant(!receiptIds.has(receipt.sessionReceiptId),
      `beta research receipt replay detected: ${receipt.sessionReceiptId}`)
    receiptIds.add(receipt.sessionReceiptId)
  }
  const releaseByCity = new Map()

  for (const receipt of normalized) {
    const release = releaseByCity.get(receipt.cityId)
    if (release && (release.manifestId !== receipt.manifestId || release.buildId !== receipt.buildId)) {
      throw new TypeError(`beta research receipts mix release bytes for ${receipt.cityId}`)
    }
    releaseByCity.set(receipt.cityId, {
      cityId: receipt.cityId,
      manifestId: receipt.manifestId,
      buildId: receipt.buildId,
    })
  }

  const cityReports = [...releaseByCity.values()]
    .sort((left, right) => left.cityId.localeCompare(right.cityId, 'en'))
    .map((release) => Object.freeze({
      ...release,
      metrics: metricBundle(normalized.filter((receipt) => receipt.cityId === release.cityId)),
    }))
  const config = normalizeReviewConfig(reviewConfig)
  if (config) {
    const reportsByCity = new Map(cityReports.map(report => [report.cityId, report]))
    for (const cityId of config.requiredCityIds) {
      const actual = reportsByCity.get(cityId)
      const expected = config.expectedReleases[cityId]
      invariant(
        actual && actual.manifestId === expected.manifestId && actual.buildId === expected.buildId,
        `beta research release identity mismatch for ${cityId}`,
      )
    }
  }

  return Object.freeze({
    schema: 'wuzup-beta-research-report',
    schemaVersion: BETA_RESEARCH_SCHEMA_VERSION,
    releases: Object.freeze(cityReports.map(({ cityId, manifestId, buildId }) => Object.freeze({
      cityId,
      manifestId,
      buildId,
    }))),
    aggregate: metricBundle(normalized),
    cities: Object.freeze(cityReports),
    reviewConfig: config,
    decision: reviewDecision(cityReports, config),
  })
}

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const receiptsPath = process.argv[2]
  const reviewConfigPath = process.argv[3] || null
  if (!receiptsPath) {
    process.stderr.write('Usage: node shared/beta-research.mjs <receipts.json> [review-config.json]\n')
    process.exitCode = 1
  } else {
    try {
      const receipts = JSON.parse(await readFile(path.resolve(receiptsPath), 'utf8'))
      const reviewConfig = reviewConfigPath
        ? JSON.parse(await readFile(path.resolve(reviewConfigPath), 'utf8'))
        : null
      const report = aggregateBetaResearch(receipts, { reviewConfig })
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } catch (error) {
      process.stderr.write(`${error?.message || error}\n`)
      process.exitCode = 1
    }
  }
}
