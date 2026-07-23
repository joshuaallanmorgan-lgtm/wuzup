import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BETA_CYCLE_COMPARISON_CONFIG_SCHEMA,
  BETA_CYCLE_COMPARISON_LIMITS,
  BETA_CYCLE_COMPARISON_SCHEMA,
  BETA_CYCLE_COMPARISON_SCHEMA_VERSION,
  betaResearchCycleReportId,
  compareBetaResearchCycleFiles,
  compareBetaResearchCycles,
  normalizeBetaCycleComparisonConfig,
  normalizeBetaResearchCycleReport,
} from '../shared/beta-cycle-comparison.mjs'
import {
  aggregateBetaResearch,
  BETA_RESEARCH_SCHEMA,
  BETA_RESEARCH_SCHEMA_VERSION,
} from '../shared/beta-research.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(ROOT, 'shared', 'beta-cycle-comparison.mjs')
const CITY_IDS = Object.freeze(['sf-east-bay', 'tampa-bay'])
const hash = character => `sha256:${character.repeat(64)}`
const clone = value => structuredClone(value)

const CYCLE_IDENTITIES = Object.freeze([
  Object.freeze({
    siteReleaseId: hash('a'),
    releases: Object.freeze({
      'sf-east-bay': Object.freeze({ manifestId: hash('b'), buildId: hash('c') }),
      'tampa-bay': Object.freeze({ manifestId: hash('d'), buildId: hash('e') }),
    }),
  }),
  Object.freeze({
    siteReleaseId: hash('f'),
    releases: Object.freeze({
      'sf-east-bay': Object.freeze({ manifestId: hash('1'), buildId: hash('2') }),
      'tampa-bay': Object.freeze({ manifestId: hash('3'), buildId: hash('4') }),
    }),
  }),
])

function receipt(cycleIndex, cityId, sequence, overrides = {}) {
  const identity = CYCLE_IDENTITIES[cycleIndex]
  const cityIdentity = identity.releases[cityId]
  const base = {
    schema: BETA_RESEARCH_SCHEMA,
    schemaVersion: BETA_RESEARCH_SCHEMA_VERSION,
    sessionReceiptId: `r-${(cycleIndex * 100 + sequence).toString(16).padStart(32, '0')}`,
    siteReleaseId: identity.siteReleaseId,
    cityId,
    manifestId: cityIdentity.manifestId,
    buildId: cityIdentity.buildId,
    durationMs: 600000,
    milestones: {
      credibleOptionMs: 120000,
      firstRetainedValueMs: 240000,
    },
    sourceLinkOutcome: 'succeeded',
    counts: {
      emptySearches: 0,
      duplicateExposures: 0,
      corrections: 0,
    },
    returningUse: false,
    corePromise: 'yes',
  }
  return {
    ...base,
    ...overrides,
    milestones: { ...base.milestones, ...(overrides.milestones || {}) },
    counts: { ...base.counts, ...(overrides.counts || {}) },
  }
}

function researchConfig(cycleIndex, minimumSessionsPerCity = 3) {
  const identity = CYCLE_IDENTITIES[cycleIndex]
  return {
    requiredCityIds: [...CITY_IDS],
    minimumSessionsPerCity,
    expectedSiteReleaseId: identity.siteReleaseId,
    expectedReleases: clone(identity.releases),
  }
}

function cycleReport(cycleIndex, minimumSessionsPerCity = 3) {
  const candidate = cycleIndex === 1
  const receipts = [
    receipt(cycleIndex, 'sf-east-bay', 1, {
      milestones: { credibleOptionMs: candidate ? 60000 : 120000, firstRetainedValueMs: candidate ? 150000 : 240000 },
      returningUse: true,
    }),
    receipt(cycleIndex, 'sf-east-bay', 2, {
      milestones: { credibleOptionMs: candidate ? 90000 : 180000, firstRetainedValueMs: candidate ? 180000 : null },
      sourceLinkOutcome: candidate ? 'succeeded' : 'failed',
      counts: { emptySearches: candidate ? 0 : 1, duplicateExposures: candidate ? 0 : 1 },
      corePromise: candidate ? 'yes' : 'no',
    }),
    receipt(cycleIndex, 'sf-east-bay', 3, {
      milestones: { credibleOptionMs: candidate ? 120000 : null, firstRetainedValueMs: candidate ? 210000 : null },
      sourceLinkOutcome: candidate ? 'succeeded' : 'not-attempted',
      counts: { emptySearches: candidate ? 0 : 1, corrections: candidate ? 0 : 1 },
      corePromise: candidate ? 'yes' : 'unclear',
    }),
    receipt(cycleIndex, 'tampa-bay', 4, {
      milestones: { credibleOptionMs: candidate ? 45000 : 90000, firstRetainedValueMs: candidate ? 120000 : 210000 },
      returningUse: true,
    }),
    receipt(cycleIndex, 'tampa-bay', 5, {
      milestones: { credibleOptionMs: candidate ? 75000 : 150000, firstRetainedValueMs: candidate ? 165000 : null },
      sourceLinkOutcome: candidate ? 'succeeded' : 'failed',
      counts: { duplicateExposures: candidate ? 0 : 1 },
      corePromise: candidate ? 'yes' : 'no',
    }),
    receipt(cycleIndex, 'tampa-bay', 6, {
      milestones: { credibleOptionMs: candidate ? 105000 : null, firstRetainedValueMs: candidate ? 195000 : null },
      sourceLinkOutcome: candidate ? 'succeeded' : 'not-attempted',
      counts: { corrections: candidate ? 0 : 1 },
      corePromise: candidate ? 'yes' : 'unclear',
    }),
  ]
  return aggregateBetaResearch(receipts, {
    reviewConfig: researchConfig(cycleIndex, minimumSessionsPerCity),
  })
}

const REPORTS = Object.freeze([cycleReport(0), cycleReport(1)])

function comparisonConfig(thresholdOverrides = {}) {
  return {
    schema: BETA_CYCLE_COMPARISON_CONFIG_SCHEMA,
    schemaVersion: BETA_CYCLE_COMPARISON_SCHEMA_VERSION,
    requiredCityIds: [...CITY_IDS],
    expectedCycles: CYCLE_IDENTITIES.map((identity, cycleIndex) => ({
      reportId: betaResearchCycleReportId(REPORTS[cycleIndex]),
      siteReleaseId: identity.siteReleaseId,
      releases: CITY_IDS.map(cityId => ({
        cityId,
        siteReleaseId: identity.siteReleaseId,
        ...identity.releases[cityId],
      })),
    })),
    readinessThresholds: {
      minimumSessionsPerCity: 3,
      minimumCredibleOptionObservationsPerCity: 2,
      minimumRetainedValueObservationsPerCity: 1,
      minimumSourceLinkAttemptsPerCity: 1,
      minimumRepeatUseResponsesPerCity: 3,
      ...thresholdOverrides,
    },
  }
}

test('compares an owner-pinned ordered pair deterministically and preserves denominators', () => {
  const forward = compareBetaResearchCycles(clone(REPORTS), { comparisonConfig: comparisonConfig() })
  const reverse = compareBetaResearchCycles(clone(REPORTS).reverse(), { comparisonConfig: comparisonConfig() })

  assert.deepEqual(reverse, forward)
  assert.equal(forward.schema, BETA_CYCLE_COMPARISON_SCHEMA)
  assert.equal(forward.schemaVersion, BETA_CYCLE_COMPARISON_SCHEMA_VERSION)
  assert.equal(forward.status, 'evidence-ready')
  assert.deepEqual(forward.reasons, [])
  assert.deepEqual(forward.cycles.map(cycle => cycle.position), ['baseline', 'candidate'])
  assert.deepEqual(forward.cycles.map(cycle => cycle.siteReleaseId), [hash('a'), hash('f')])
  assert.deepEqual(forward.cycles.map(cycle => cycle.reportId), REPORTS.map(betaResearchCycleReportId))
  assert.equal(forward.cycles.every(cycle => cycle.releases.length === 2), true)
  assert.equal(forward.cycles.every(cycle => cycle.cities.length === 2), true)
  assert.equal(forward.cycles.every(cycle => cycle.researchDecision.status === 'reviewable'), true)

  assert.deepEqual(forward.deltas.aggregate.sessionCount, { baseline: 6, candidate: 6, delta: 0 })
  assert.deepEqual(forward.deltas.aggregate.timeToCredibleOption.delta, {
    observedSessions: 2,
    sessionDenominator: 0,
    missingSessions: -2,
    medianMs: -52500,
    p75Ms: -45000,
  })
  assert.deepEqual(forward.deltas.aggregate.sourceLink.baseline, {
    successfulAttempts: 2,
    attemptDenominator: 4,
    sessionDenominator: 6,
    successRate: 0.5,
  })
  assert.deepEqual(forward.deltas.aggregate.sourceLink.candidate, {
    successfulAttempts: 6,
    attemptDenominator: 6,
    sessionDenominator: 6,
    successRate: 1,
  })
  assert.equal(forward.deltas.aggregate.sourceLink.delta.successRate, 0.5)
  assert.deepEqual(forward.deltas.cities.map(city => city.cityId), CITY_IDS)
  assert.equal(forward.deltas.cities[0].metrics.repeatUse.baseline.sessionDenominator, 3)
  assert.equal(forward.deltas.cities[0].metrics.repeatUse.candidate.sessionDenominator, 3)
  assert.equal(Object.isFrozen(forward), true)
  assert.equal(Object.isFrozen(forward.deltas.aggregate), true)

  const serialized = JSON.stringify(forward)
  for (const forbiddenKey of [
    'participantId',
    'sessionReceiptId',
    'query',
    'title',
    'url',
    'coordinates',
    'notes',
    'verdict',
    'goNoGo',
    'passed',
  ]) {
    assert.equal(serialized.includes(`"${forbiddenKey}"`), false)
  }
  assert.match(forward.interpretation, /configured comparison denominators/)
  assert.match(forward.interpretation, /no signal pass/)
  assert.match(forward.interpretation, /ratified Tampa and SF launch gates/)
  assert.match(forward.interpretation, /separate mandatory inputs before expansion/)
})

test('all-negative trust signals can be evidence-ready but never become a pass or expansion verdict', () => {
  const negativeReports = CYCLE_IDENTITIES.map((identity, cycleIndex) => {
    const receipts = CITY_IDS.flatMap((cityId, cityIndex) => [1, 2, 3].map(offset => receipt(
      cycleIndex,
      cityId,
      cityIndex * 3 + offset,
      {
        milestones: { credibleOptionMs: 120000, firstRetainedValueMs: null },
        sourceLinkOutcome: 'failed',
        counts: { emptySearches: 1, duplicateExposures: 1, corrections: 1 },
        returningUse: false,
        corePromise: 'no',
      },
    )))
    assert.equal(identity.siteReleaseId, receipts[0].siteReleaseId)
    return aggregateBetaResearch(receipts, { reviewConfig: researchConfig(cycleIndex) })
  })
  const config = comparisonConfig({
    minimumCredibleOptionObservationsPerCity: 3,
    minimumRetainedValueObservationsPerCity: 0,
    minimumSourceLinkAttemptsPerCity: 3,
    minimumRepeatUseResponsesPerCity: 3,
  })
  config.expectedCycles.forEach((cycle, index) => {
    cycle.reportId = betaResearchCycleReportId(negativeReports[index])
  })

  const result = compareBetaResearchCycles(negativeReports, { comparisonConfig: config })
  assert.equal(result.status, 'evidence-ready')
  assert.equal(result.deltas.aggregate.sourceLink.baseline.successRate, 0)
  assert.equal(result.deltas.aggregate.emptySearches.baseline.sessionRate, 1)
  assert.equal(result.deltas.aggregate.duplicateExposures.baseline.sessionRate, 1)
  assert.equal(result.deltas.aggregate.corrections.baseline.sessionRate, 1)
  assert.equal(result.deltas.aggregate.repeatUse.baseline.rate, 0)
  assert.equal(result.deltas.aggregate.corePromise.baseline.yesRate, 0)
  assert.equal(result.deltas.aggregate.corePromise.baseline.noRate, 1)
  assert.match(result.interpretation, /no signal pass, pilot authorization, or expansion decision is inferred/)
  assert.match(result.interpretation, /launch gates.*owner signal and go\/no-go rules are separate mandatory inputs/)
  const serialized = JSON.stringify(result)
  for (const forbiddenKey of ['pass', 'passed', 'verdict', 'goNoGo', 'pilotAuthorized']) {
    assert.equal(serialized.includes(`"${forbiddenKey}"`), false)
  }
})

test('uses only explicit evidence thresholds to distinguish insufficient from evidence-ready', () => {
  const result = compareBetaResearchCycles(clone(REPORTS), {
    comparisonConfig: comparisonConfig({
      minimumCredibleOptionObservationsPerCity: 3,
      minimumRetainedValueObservationsPerCity: 3,
      minimumSourceLinkAttemptsPerCity: 3,
      minimumRepeatUseResponsesPerCity: 4,
    }),
  })

  assert.equal(result.status, 'insufficient')
  assert.deepEqual(result.reasons, [
    'MINIMUM_CREDIBLE_OPTION_OBSERVATIONS_NOT_MET:cycle-1:sf-east-bay:2/3',
    'MINIMUM_RETAINED_VALUE_OBSERVATIONS_NOT_MET:cycle-1:sf-east-bay:1/3',
    'MINIMUM_SOURCE_LINK_ATTEMPTS_NOT_MET:cycle-1:sf-east-bay:2/3',
    'MINIMUM_REPEAT_USE_RESPONSES_NOT_MET:cycle-1:sf-east-bay:3/4',
    'MINIMUM_CREDIBLE_OPTION_OBSERVATIONS_NOT_MET:cycle-1:tampa-bay:2/3',
    'MINIMUM_RETAINED_VALUE_OBSERVATIONS_NOT_MET:cycle-1:tampa-bay:1/3',
    'MINIMUM_SOURCE_LINK_ATTEMPTS_NOT_MET:cycle-1:tampa-bay:2/3',
    'MINIMUM_REPEAT_USE_RESPONSES_NOT_MET:cycle-1:tampa-bay:3/4',
    'MINIMUM_REPEAT_USE_RESPONSES_NOT_MET:cycle-2:sf-east-bay:3/4',
    'MINIMUM_REPEAT_USE_RESPONSES_NOT_MET:cycle-2:tampa-bay:3/4',
  ])
  assert.match(result.interpretation, /no signal pass, pilot authorization, or expansion decision is inferred/)
  assert.match(result.interpretation, /separate mandatory inputs before expansion/)

  const sourceInsufficient = cycleReport(0, 4)
  const sourceInsufficientConfig = comparisonConfig()
  sourceInsufficientConfig.expectedCycles[0].reportId = betaResearchCycleReportId(sourceInsufficient)
  const sourceInsufficientComparison = compareBetaResearchCycles(
    [sourceInsufficient, clone(REPORTS[1])],
    { comparisonConfig: sourceInsufficientConfig },
  )
  assert.equal(sourceInsufficientComparison.status, 'insufficient')
  assert.deepEqual(sourceInsufficientComparison.reasons, ['SOURCE_REPORT_NOT_REVIEWABLE:cycle-1'])

  assert.throws(
    () => compareBetaResearchCycles(clone(REPORTS)),
    /comparison config is required/,
  )
  assert.throws(
    () => compareBetaResearchCycles(clone(REPORTS), { comparisonConfig: null }),
    /comparison config is required/,
  )
})

test('normalizes only the canonical two-city owner config and rejects schema drift', () => {
  const normalized = normalizeBetaCycleComparisonConfig(comparisonConfig())
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.expectedCycles), true)
  assert.equal(Object.isFrozen(normalized.readinessThresholds), true)
  assert.deepEqual(normalized.requiredCityIds, CITY_IDS)

  const extra = comparisonConfig()
  extra.passThreshold = 0.9
  assert.throws(() => normalizeBetaCycleComparisonConfig(extra), /must contain exactly/)

  const wrongVersion = comparisonConfig()
  wrongVersion.schemaVersion += 1
  assert.throws(() => normalizeBetaCycleComparisonConfig(wrongVersion), /schema version is invalid/)

  const unpinnedReport = comparisonConfig()
  unpinnedReport.expectedCycles[0].reportId = 'latest'
  assert.throws(() => normalizeBetaCycleComparisonConfig(unpinnedReport), /reportId is invalid/)

  for (const requiredCityIds of [
    ['tampa-bay', 'sf-east-bay'],
    ['sf-east-bay', 'tampa-bay', 'new-york-city'],
  ]) {
    const wrongCities = comparisonConfig()
    wrongCities.requiredCityIds = requiredCityIds
    assert.throws(() => normalizeBetaCycleComparisonConfig(wrongCities), /canonical two flagship cities|exactly 2/)
  }

  const duplicate = comparisonConfig()
  duplicate.expectedCycles[1] = clone(duplicate.expectedCycles[0])
  assert.throws(() => normalizeBetaCycleComparisonConfig(duplicate), /two distinct composed releases/)

  for (const value of [0, 0.5, 1001, Number.NaN, '3']) {
    const invalidThreshold = comparisonConfig({ minimumSessionsPerCity: value })
    assert.throws(() => normalizeBetaCycleComparisonConfig(invalidThreshold), /minimumSessionsPerCity is out of range/)
  }

  const withSymbol = comparisonConfig()
  withSymbol[Symbol('participant')] = 'private'
  assert.throws(() => normalizeBetaCycleComparisonConfig(withSymbol), /must not contain symbol fields/)

  const customPrototype = Object.assign(Object.create({ secret: 'private' }), comparisonConfig())
  assert.throws(() => normalizeBetaCycleComparisonConfig(customPrototype), /must be a plain object/)

  const sparse = comparisonConfig()
  delete sparse.expectedCycles[0]
  assert.throws(() => normalizeBetaCycleComparisonConfig(sparse), /must be dense/)

  const accessorArray = comparisonConfig()
  Object.defineProperty(accessorArray.expectedCycles, '0', {
    enumerable: true,
    get: () => clone(comparisonConfig().expectedCycles[0]),
  })
  assert.throws(() => normalizeBetaCycleComparisonConfig(accessorArray), /enumerable data entry/)
})

test('validates normalized research reports and rejects identity, decision, and privacy drift', () => {
  const normalized = normalizeBetaResearchCycleReport(clone(REPORTS[0]))
  assert.equal(normalized.siteReleaseId, hash('a'))
  assert.deepEqual(normalized.cities.map(city => city.cityId), CITY_IDS)
  assert.equal(Object.isFrozen(normalized.aggregate), true)
  const reordered = Object.fromEntries(Object.entries(clone(REPORTS[0])).reverse())
  assert.equal(betaResearchCycleReportId(reordered), betaResearchCycleReportId(REPORTS[0]))

  for (const [field, value] of [
    ['participantId', 'person-1'],
    ['sessionReceiptId', 'r-00000000000000000000000000000001'],
    ['notes', 'private free text'],
  ]) {
    const expanded = clone(REPORTS[0])
    expanded[field] = value
    assert.throws(() => normalizeBetaResearchCycleReport(expanded), /must contain exactly/)
  }

  const nestedPii = clone(REPORTS[0])
  nestedPii.aggregate.query = 'private'
  assert.throws(() => normalizeBetaResearchCycleReport(nestedPii), /aggregate must contain exactly/)

  const oldSchema = clone(REPORTS[0])
  oldSchema.schemaVersion -= 1
  assert.throws(() => normalizeBetaResearchCycleReport(oldSchema), /schema version is invalid/)

  const oneCity = clone(REPORTS[0])
  oneCity.cities.pop()
  assert.throws(() => normalizeBetaResearchCycleReport(oneCity), /must contain exactly 2/)

  const duplicateCity = clone(REPORTS[0])
  duplicateCity.cities[1] = clone(duplicateCity.cities[0])
  assert.throws(() => normalizeBetaResearchCycleReport(duplicateCity), /each flagship city once/)

  const mixedSite = clone(REPORTS[0])
  mixedSite.releases[0].siteReleaseId = hash('9')
  assert.throws(() => normalizeBetaResearchCycleReport(mixedSite), /siteReleaseId is inconsistent/)

  const mixedManifest = clone(REPORTS[0])
  mixedManifest.cities[0].manifestId = hash('9')
  assert.throws(() => normalizeBetaResearchCycleReport(mixedManifest), /release identity mismatch/)

  const unconfigured = clone(REPORTS[0])
  unconfigured.reviewConfig = null
  assert.throws(() => normalizeBetaResearchCycleReport(unconfigured), /explicit review config/)

  const forgedDecision = clone(REPORTS[0])
  forgedDecision.decision.status = 'passed'
  assert.throws(() => normalizeBetaResearchCycleReport(forgedDecision), /status is inconsistent/)

  const forgedReason = clone(REPORTS[0])
  forgedReason.decision.reasons = ['OWNER_SAYS_GO']
  assert.throws(() => normalizeBetaResearchCycleReport(forgedReason), /reasons.*exactly|reasons are inconsistent/)
})

test('rejects denominator, rate, arithmetic, and aggregate consistency drift', () => {
  const mutations = [
    [report => { report.cities[0].metrics.timeToCredibleOption.sessionDenominator += 1 }, /sessionDenominator is inconsistent/],
    [report => { report.cities[0].metrics.timeToCredibleOption.missingSessions += 1 }, /does not preserve its denominator/],
    [report => { report.cities[0].metrics.timeToCredibleOption.medianMs = null }, /must be null without observations|is out of range/],
    [report => { report.cities[0].metrics.timeToCredibleOption.medianMs = 90000.25 }, /not reproducible/],
    [report => { report.cities[0].metrics.timeToCredibleOption.p75Ms = 120000.5 }, /not reproducible/],
    [report => { report.cities[0].metrics.timeToCredibleOption.medianMs = 999999 }, /timing order is invalid/],
    [report => { report.cities[0].metrics.sourceLink.successfulAttempts = 3 }, /successfulAttempts is out of range/],
    [report => { report.cities[0].metrics.sourceLink.successRate = 0.500001 }, /does not match its numerator and denominator/],
    [report => { report.cities[0].metrics.emptySearches.totalCount = 0 }, /cannot be less than sessionsWithAny/],
    [report => { report.cities[0].metrics.repeatUse.rate = 0.5 }, /does not match its numerator and denominator/],
    [report => { report.cities[0].metrics.corePromise.unclear += 1 }, /does not preserve its denominator/],
    [report => {
      report.cities[0].metrics.timeToFirstRetainedValue.observedSessions = 3
      report.cities[0].metrics.timeToFirstRetainedValue.missingSessions = 0
    }, /more retained-value observations than credible-option observations/],
    [report => {
      report.cities[0].metrics.sourceLink.attemptDenominator = 3
      report.cities[0].metrics.sourceLink.successRate = 0.333333
    }, /more source-link attempts than credible-option observations/],
    [report => {
      report.cities[0].metrics.corePromise.yes = 2
      report.cities[0].metrics.corePromise.no = 0
      report.cities[0].metrics.corePromise.yesRate = 0.666667
      report.cities[0].metrics.corePromise.noRate = 0
    }, /core-promise yes count is inconsistent/],
    [report => { report.aggregate.emptySearches.totalCount += 1 }, /aggregate.emptySearches.totalCount is inconsistent/],
  ]

  for (const [mutate, expected] of mutations) {
    const report = clone(REPORTS[0])
    mutate(report)
    assert.throws(() => normalizeBetaResearchCycleReport(report), expected)
  }
})

test('rejects duplicate, mixed, unpinned, and malformed cycle pairs', () => {
  assert.throws(
    () => compareBetaResearchCycles([clone(REPORTS[0]), clone(REPORTS[0])], {
      comparisonConfig: comparisonConfig(),
    }),
    /duplicate composed-release cycles/,
  )
  assert.throws(
    () => compareBetaResearchCycles([clone(REPORTS[0])], { comparisonConfig: comparisonConfig() }),
    /exactly 2 entries/,
  )
  assert.throws(
    () => compareBetaResearchCycles([...clone(REPORTS), clone(REPORTS[1])], {
      comparisonConfig: comparisonConfig(),
    }),
    /exactly 2 entries/,
  )

  const unpinned = comparisonConfig()
  unpinned.expectedCycles[1].releases[0].buildId = hash('8')
  assert.throws(
    () => compareBetaResearchCycles(clone(REPORTS), { comparisonConfig: unpinned }),
    /cycle-2 identity mismatch/,
  )

  const substituteReceipts = CITY_IDS.flatMap((cityId, cityIndex) => [1, 2, 3].map(offset => receipt(
    0,
    cityId,
    cityIndex * 3 + offset,
    { returningUse: true },
  )))
  const sameReleaseDifferentReport = aggregateBetaResearch(substituteReceipts, {
    reviewConfig: researchConfig(0),
  })
  assert.equal(sameReleaseDifferentReport.siteReleaseId, REPORTS[0].siteReleaseId)
  assert.notEqual(betaResearchCycleReportId(sameReleaseDifferentReport), betaResearchCycleReportId(REPORTS[0]))
  assert.throws(
    () => compareBetaResearchCycles([sameReleaseDifferentReport, clone(REPORTS[1])], {
      comparisonConfig: comparisonConfig(),
    }),
    /cycle-1 identity mismatch/,
  )

  const mixed = clone(REPORTS[1])
  mixed.reviewConfig.expectedReleases['sf-east-bay'].buildId = hash('8')
  assert.throws(
    () => compareBetaResearchCycles([clone(REPORTS[0]), mixed], { comparisonConfig: comparisonConfig() }),
    /review release identity mismatch for sf-east-bay/,
  )
})

test('keeps nullable deltas explicit instead of fabricating unavailable timing change', () => {
  const baselineReceipts = CITY_IDS.flatMap((cityId, cityIndex) => [1, 2, 3].map((offset) => receipt(
    0,
    cityId,
    cityIndex * 3 + offset,
    {
      milestones: { credibleOptionMs: null, firstRetainedValueMs: null },
      sourceLinkOutcome: 'not-attempted',
      corePromise: 'unclear',
      returningUse: offset === 1,
    },
  )))
  const baseline = aggregateBetaResearch(baselineReceipts, { reviewConfig: researchConfig(0) })
  const config = comparisonConfig({
    minimumCredibleOptionObservationsPerCity: 1,
    minimumRetainedValueObservationsPerCity: 1,
    minimumSourceLinkAttemptsPerCity: 1,
  })
  config.expectedCycles[0].reportId = betaResearchCycleReportId(baseline)
  const result = compareBetaResearchCycles([baseline, clone(REPORTS[1])], {
    comparisonConfig: config,
  })

  assert.equal(result.status, 'insufficient')
  assert.equal(result.deltas.aggregate.timeToCredibleOption.baseline.medianMs, null)
  assert.equal(result.deltas.aggregate.timeToCredibleOption.delta.medianMs, null)
  assert.equal(result.deltas.aggregate.sourceLink.baseline.successRate, null)
  assert.equal(result.deltas.aggregate.sourceLink.delta.successRate, null)
  assert.equal(JSON.stringify(result).includes('NaN'), false)
  assert.equal(JSON.stringify(result).includes('Infinity'), false)
})

test('file API and CLI emit the same deterministic comparison and reject oversized inputs', async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-beta-cycle-comparison-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const baselinePath = path.join(base, 'baseline.json')
  const candidatePath = path.join(base, 'candidate.json')
  const configPath = path.join(base, 'config.json')
  writeFileSync(baselinePath, `${JSON.stringify(REPORTS[0], null, 2)}\n`)
  writeFileSync(candidatePath, `${JSON.stringify(REPORTS[1], null, 2)}\n`)
  writeFileSync(configPath, `${JSON.stringify(comparisonConfig(), null, 2)}\n`)

  const api = await compareBetaResearchCycleFiles(baselinePath, candidatePath, configPath)
  const first = spawnSync(process.execPath, [MODULE_PATH, baselinePath, candidatePath, configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const second = spawnSync(process.execPath, [MODULE_PATH, baselinePath, candidatePath, configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(first.status, 0, first.stderr)
  assert.equal(first.stderr, '')
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.stdout, first.stdout)
  assert.deepEqual(JSON.parse(first.stdout), api)

  truncateSync(baselinePath, BETA_CYCLE_COMPARISON_LIMITS.maxCycleReportJsonBytes + 1)
  const oversizedReport = spawnSync(process.execPath, [MODULE_PATH, baselinePath, candidatePath, configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.notEqual(oversizedReport.status, 0)
  assert.match(oversizedReport.stderr, /baseline beta cycle report file exceeds its byte limit/)
  assert.equal(oversizedReport.stdout, '')

  writeFileSync(baselinePath, JSON.stringify(REPORTS[0]))
  truncateSync(configPath, BETA_CYCLE_COMPARISON_LIMITS.maxComparisonConfigJsonBytes + 1)
  const oversizedConfig = spawnSync(process.execPath, [MODULE_PATH, baselinePath, candidatePath, configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.notEqual(oversizedConfig.status, 0)
  assert.match(oversizedConfig.stderr, /comparison config file exceeds its byte limit/)
  assert.equal(oversizedConfig.stdout, '')
})

test('CLI fails closed on missing, malformed, and invalid UTF-8 input without output', (t) => {
  const usage = spawnSync(process.execPath, [MODULE_PATH], { cwd: ROOT, encoding: 'utf8' })
  assert.notEqual(usage.status, 0)
  assert.match(usage.stderr, /Usage:/)
  assert.equal(usage.stdout, '')

  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-beta-cycle-malformed-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const baselinePath = path.join(base, 'baseline.json')
  const candidatePath = path.join(base, 'candidate.json')
  const configPath = path.join(base, 'config.json')
  writeFileSync(baselinePath, '{')
  writeFileSync(candidatePath, JSON.stringify(REPORTS[1]))
  writeFileSync(configPath, JSON.stringify(comparisonConfig()))
  const malformed = spawnSync(process.execPath, [MODULE_PATH, baselinePath, candidatePath, configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.notEqual(malformed.status, 0)
  assert.match(malformed.stderr, /not valid JSON/)
  assert.equal(malformed.stdout, '')

  writeFileSync(baselinePath, Buffer.from([0xff]))
  const invalidUtf8 = spawnSync(process.execPath, [MODULE_PATH, baselinePath, candidatePath, configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.notEqual(invalidUtf8.status, 0)
  assert.match(invalidUtf8.stderr, /not valid UTF-8/)
  assert.equal(invalidUtf8.stdout, '')
})
