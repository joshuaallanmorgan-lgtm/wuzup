import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  aggregateBetaResearch,
  BETA_RESEARCH_SCHEMA,
  BETA_RESEARCH_SCHEMA_VERSION,
  normalizeBetaResearchReceipt,
  S11_BETA_RESEARCH_LIMITS,
} from '../shared/beta-research.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_V1 = JSON.parse(await readFile(
  path.join(ROOT, 'test', 'fixtures', 'beta', 's11-cycle-one.v1.json'),
  'utf8',
))
const SITE_RELEASE_ID = `sha256:${'a'.repeat(64)}`
const FIXTURE = Object.freeze(FIXTURE_V1.map((receipt) => Object.freeze({
  ...receipt,
  schemaVersion: BETA_RESEARCH_SCHEMA_VERSION,
  siteReleaseId: SITE_RELEASE_ID,
})))
const clone = (value) => structuredClone(value)
const EXPECTED_RELEASES = Object.freeze({
  'sf-east-bay': Object.freeze({
    manifestId: FIXTURE.find(receipt => receipt.cityId === 'sf-east-bay').manifestId,
    buildId: FIXTURE.find(receipt => receipt.cityId === 'sf-east-bay').buildId,
  }),
  'tampa-bay': Object.freeze({
    manifestId: FIXTURE.find(receipt => receipt.cityId === 'tampa-bay').manifestId,
    buildId: FIXTURE.find(receipt => receipt.cityId === 'tampa-bay').buildId,
  }),
})
const reviewConfig = (minimumSessionsPerCity) => ({
  requiredCityIds: ['sf-east-bay', 'tampa-bay'],
  minimumSessionsPerCity,
  expectedSiteReleaseId: SITE_RELEASE_ID,
  expectedReleases: EXPECTED_RELEASES,
})

function boundedCycleReceipts(sessionsPerCity) {
  let sequence = 0
  return ['sf-east-bay', 'tampa-bay'].flatMap((cityId) => {
    const template = FIXTURE.find((receipt) => receipt.cityId === cityId)
    return Array.from({ length: sessionsPerCity }, () => {
      sequence += 1
      return {
        ...clone(template),
        sessionReceiptId: `r-${sequence.toString(16).padStart(32, '0')}`,
      }
    })
  })
}

test('normalizes the exact privacy-bounded receipt schema', () => {
  const normalized = normalizeBetaResearchReceipt(clone(FIXTURE[0]))

  assert.equal(normalized.schema, BETA_RESEARCH_SCHEMA)
  assert.equal(normalized.schemaVersion, BETA_RESEARCH_SCHEMA_VERSION)
  assert.deepEqual(Object.keys(normalized).sort(), [
    'buildId',
    'cityId',
    'corePromise',
    'counts',
    'durationMs',
    'manifestId',
    'milestones',
    'returningUse',
    'schema',
    'schemaVersion',
    'sessionReceiptId',
    'siteReleaseId',
    'sourceLinkOutcome',
  ])
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.milestones), true)
  assert.equal(Object.isFrozen(normalized.counts), true)

  for (const [field, value] of [
    ['participantId', 'person-1'],
    ['title', 'A listing title'],
    ['query', 'private search'],
    ['url', 'https://example.test/private'],
    ['coordinates', [27.95, -82.46]],
    ['notes', 'free text'],
  ]) {
    assert.throws(
      () => normalizeBetaResearchReceipt({ ...clone(FIXTURE[0]), [field]: value }),
      /must contain exactly/,
      `${field} must not expand the research receipt`,
    )
  }

  const nestedExpansion = clone(FIXTURE[0])
  nestedExpansion.counts.rawQueries = 1
  assert.throws(() => normalizeBetaResearchReceipt(nestedExpansion), /counts must contain exactly/)
})

test('rejects unknown cities, forged release identity, and invalid timelines', () => {
  const unknownCity = { ...clone(FIXTURE[0]), cityId: 'new-york-city' }
  assert.throws(() => normalizeBetaResearchReceipt(unknownCity), /not an S11 flagship/)

  const badManifest = { ...clone(FIXTURE[0]), manifestId: 'latest' }
  assert.throws(() => normalizeBetaResearchReceipt(badManifest), /manifestId is invalid/)

  const missingSiteRelease = clone(FIXTURE[0])
  delete missingSiteRelease.siteReleaseId
  assert.throws(() => normalizeBetaResearchReceipt(missingSiteRelease), /must contain exactly/)

  const badSiteRelease = { ...clone(FIXTURE[0]), siteReleaseId: 'latest' }
  assert.throws(() => normalizeBetaResearchReceipt(badSiteRelease), /siteReleaseId is invalid/)

  for (const field of ['siteReleaseId', 'manifestId', 'buildId']) {
    const hash = FIXTURE[0][field]
    for (const value of [[hash], { privateNote: 'sensitive', toString: () => hash }]) {
      const coercible = { ...clone(FIXTURE[0]), [field]: value }
      assert.throws(() => normalizeBetaResearchReceipt(coercible), new RegExp(`${field} is invalid`))
    }
  }

  const badReceiptId = { ...clone(FIXTURE[0]), sessionReceiptId: ['r-00000000000000000000000000000001'] }
  assert.throws(() => normalizeBetaResearchReceipt(badReceiptId), /sessionReceiptId is invalid/)

  const afterSession = clone(FIXTURE[0])
  afterSession.milestones.credibleOptionMs = afterSession.durationMs + 1
  assert.throws(() => normalizeBetaResearchReceipt(afterSession), /credibleOptionMs is out of range/)

  const retainedWithoutOption = clone(FIXTURE[0])
  retainedWithoutOption.milestones.credibleOptionMs = null
  assert.throws(() => normalizeBetaResearchReceipt(retainedWithoutOption), /cannot retain value/)

  const reversed = clone(FIXTURE[0])
  reversed.milestones.firstRetainedValueMs = reversed.milestones.credibleOptionMs - 1
  assert.throws(() => normalizeBetaResearchReceipt(reversed), /not monotonic/)

  const fractionalCount = clone(FIXTURE[0])
  fractionalCount.counts.emptySearches = 0.5
  assert.throws(() => normalizeBetaResearchReceipt(fractionalCount), /counts.emptySearches is out of range/)

  const followedWithoutOption = clone(FIXTURE[4])
  followedWithoutOption.sourceLinkOutcome = 'succeeded'
  assert.throws(() => normalizeBetaResearchReceipt(followedWithoutOption), /cannot attempt a source link/)

  const claimedPromiseWithoutValue = clone(FIXTURE[4])
  claimedPromiseWithoutValue.corePromise = 'yes'
  assert.throws(() => normalizeBetaResearchReceipt(claimedPromiseWithoutValue), /cannot mark the core promise yes/)

  for (const sourceLinkOutcome of ['not-attempted', 'failed']) {
    const claimedPromiseWithoutFollowThrough = clone(FIXTURE[0])
    claimedPromiseWithoutFollowThrough.sourceLinkOutcome = sourceLinkOutcome
    assert.throws(
      () => normalizeBetaResearchReceipt(claimedPromiseWithoutFollowThrough),
      /cannot mark the core promise yes without credible, retained, and followed value/,
    )
  }
})

test('aggregates the frozen fixture deterministically with explicit denominators', () => {
  const forward = aggregateBetaResearch(clone(FIXTURE))
  const reverse = aggregateBetaResearch(clone(FIXTURE).reverse())

  assert.deepEqual(reverse, forward)
  assert.equal(forward.schemaVersion, 2)
  assert.equal(forward.siteReleaseId, SITE_RELEASE_ID)
  assert.deepEqual(forward.releases.map((release) => release.cityId), ['sf-east-bay', 'tampa-bay'])
  assert.equal(forward.releases.every((release) => release.siteReleaseId === SITE_RELEASE_ID), true)
  assert.equal(forward.aggregate.sessionCount, 6)
  assert.deepEqual(forward.aggregate.timeToCredibleOption, {
    observedSessions: 5,
    sessionDenominator: 6,
    missingSessions: 1,
    medianMs: 90000,
    p75Ms: 120000,
  })
  assert.deepEqual(forward.aggregate.timeToFirstRetainedValue, {
    observedSessions: 4,
    sessionDenominator: 6,
    missingSessions: 2,
    medianMs: 240000,
    p75Ms: 300000,
  })
  assert.deepEqual(forward.aggregate.sourceLink, {
    successfulAttempts: 3,
    attemptDenominator: 4,
    sessionDenominator: 6,
    successRate: 0.75,
  })
  assert.deepEqual(forward.aggregate.emptySearches, {
    totalCount: 3,
    sessionsWithAny: 2,
    sessionDenominator: 6,
    sessionRate: 0.333333,
  })
  assert.deepEqual(forward.aggregate.duplicateExposures, {
    totalCount: 2,
    sessionsWithAny: 2,
    sessionDenominator: 6,
    sessionRate: 0.333333,
  })
  assert.deepEqual(forward.aggregate.corrections, {
    totalCount: 1,
    sessionsWithAny: 1,
    sessionDenominator: 6,
    sessionRate: 0.166667,
  })
  assert.deepEqual(forward.aggregate.repeatUse, {
    returningSessions: 3,
    sessionDenominator: 6,
    rate: 0.5,
  })
  assert.deepEqual(forward.aggregate.corePromise, {
    yes: 2,
    no: 2,
    unclear: 2,
    sessionDenominator: 6,
    yesRate: 0.333333,
    noRate: 0.333333,
    unclearRate: 0.333333,
  })
  assert.equal(forward.cities.every((city) => city.metrics.sessionCount === 3), true)
})

test('enforces frozen session limits before normalization and accepts the exact boundary', () => {
  assert.equal(Object.isFrozen(S11_BETA_RESEARCH_LIMITS), true)
  assert.deepEqual(S11_BETA_RESEARCH_LIMITS, {
    maxSessionsPerCity: 1000,
    maxTotalSessions: 2000,
    maxReceiptsJsonBytes: 8 * 1024 * 1024,
    maxReviewConfigJsonBytes: 256 * 1024,
  })

  assert.throws(
    () => aggregateBetaResearch(Array(S11_BETA_RESEARCH_LIMITS.maxTotalSessions + 1).fill(null)),
    /exceed the 2000-session total limit/,
  )

  const tooManyInOneCity = boundedCycleReceipts(
    S11_BETA_RESEARCH_LIMITS.maxSessionsPerCity + 1,
  ).filter((receipt) => receipt.cityId === 'sf-east-bay')
  assert.throws(
    () => aggregateBetaResearch(tooManyInOneCity),
    /exceed the 1000-session limit for sf-east-bay/,
  )

  const boundary = boundedCycleReceipts(S11_BETA_RESEARCH_LIMITS.maxSessionsPerCity)
  const forward = aggregateBetaResearch(boundary, { reviewConfig: reviewConfig(1000) })
  const reverse = aggregateBetaResearch([...boundary].reverse(), { reviewConfig: reviewConfig(1000) })
  assert.equal(forward.aggregate.sessionCount, S11_BETA_RESEARCH_LIMITS.maxTotalSessions)
  assert.equal(forward.decision.status, 'reviewable')
  assert.deepEqual(reverse, forward)
})

test('rejects mixed manifest or build bytes within either city', () => {
  const mixedSiteRelease = clone(FIXTURE)
  mixedSiteRelease[4].siteReleaseId = `sha256:${'d'.repeat(64)}`
  assert.throws(
    () => aggregateBetaResearch(mixedSiteRelease),
    /mix composed-site release bytes/,
  )

  const mixedManifest = clone(FIXTURE)
  mixedManifest[1].manifestId = `sha256:${'e'.repeat(64)}`
  assert.throws(() => aggregateBetaResearch(mixedManifest), /mix release bytes for tampa-bay/)

  const mixedBuild = clone(FIXTURE)
  mixedBuild[4].buildId = `sha256:${'f'.repeat(64)}`
  assert.throws(() => aggregateBetaResearch(mixedBuild), /mix release bytes for sf-east-bay/)

  const replayed = [...clone(FIXTURE), clone(FIXTURE[0])]
  assert.throws(() => aggregateBetaResearch(replayed), /receipt replay detected/)
})

test('stays insufficient until an exact two-city review configuration is supplied', () => {
  const unconfigured = aggregateBetaResearch(clone(FIXTURE))
  assert.equal(unconfigured.reviewConfig, null)
  assert.deepEqual(unconfigured.decision, {
    status: 'insufficient',
    configured: false,
    reasons: ['REVIEW_CONFIG_REQUIRED'],
    interpretation: 'No beta pass or fail is inferred.',
  })

  const underSampled = aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: reviewConfig(4),
  })
  assert.equal(underSampled.decision.status, 'insufficient')
  assert.deepEqual(underSampled.decision.reasons, [
    'MINIMUM_SESSIONS_NOT_MET:sf-east-bay:3/4',
    'MINIMUM_SESSIONS_NOT_MET:tampa-bay:3/4',
  ])

  const reviewable = aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: reviewConfig(3),
  })
  assert.equal(reviewable.decision.status, 'reviewable')
  assert.deepEqual(reviewable.decision.reasons, [])
  assert.match(reviewable.decision.interpretation, /not a beta pass or fail/)

  assert.throws(() => aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: {
      requiredCityIds: ['tampa-bay'],
      minimumSessionsPerCity: 3,
      expectedSiteReleaseId: SITE_RELEASE_ID,
      expectedReleases: EXPECTED_RELEASES,
    },
  }), /must require both S11 flagship cities/)

  assert.throws(() => aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: {
      requiredCityIds: ['sf-east-bay', 'tampa-bay'],
      minimumSessionsPerCity: 3,
      expectedSiteReleaseId: SITE_RELEASE_ID,
      expectedReleases: EXPECTED_RELEASES,
      passThreshold: 0.9,
    },
  }), /review config must contain exactly/)

  const wrongRelease = clone(EXPECTED_RELEASES)
  wrongRelease['tampa-bay'].manifestId = `sha256:${'e'.repeat(64)}`
  assert.throws(() => aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: {
      requiredCityIds: ['sf-east-bay', 'tampa-bay'],
      minimumSessionsPerCity: 3,
      expectedSiteReleaseId: SITE_RELEASE_ID,
      expectedReleases: wrongRelease,
    },
  }), /release identity mismatch for tampa-bay/)

  assert.throws(() => aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: {
      requiredCityIds: ['sf-east-bay', 'tampa-bay'],
      minimumSessionsPerCity: 3,
      expectedReleases: EXPECTED_RELEASES,
    },
  }), /review config must contain exactly/)

  assert.throws(() => aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: {
      requiredCityIds: ['sf-east-bay', 'tampa-bay'],
      minimumSessionsPerCity: 3,
      expectedSiteReleaseId: `sha256:${'b'.repeat(64)}`,
      expectedReleases: EXPECTED_RELEASES,
    },
  }), /composed-site release identity mismatch/)

  assert.throws(() => aggregateBetaResearch(clone(FIXTURE), {
    reviewConfig: {
      requiredCityIds: ['sf-east-bay', 'tampa-bay'],
      minimumSessionsPerCity: 3,
      expectedSiteReleaseId: 'latest',
      expectedReleases: EXPECTED_RELEASES,
    },
  }), /expectedSiteReleaseId is invalid/)
})

test('CLI emits only a deterministic privacy-bounded report to stdout', (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-beta-research-cli-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const receiptsPath = path.join(base, 'receipts.json')
  writeFileSync(receiptsPath, `${JSON.stringify(FIXTURE, null, 2)}\n`)
  const args = [
    path.join(ROOT, 'shared', 'beta-research.mjs'),
    receiptsPath,
  ]
  const run = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
  const replay = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })

  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stderr, '')
  assert.equal(replay.status, 0, replay.stderr)
  assert.equal(replay.stderr, '')
  assert.equal(replay.stdout, run.stdout)
  const report = JSON.parse(run.stdout)
  assert.equal(report.aggregate.sessionCount, FIXTURE.length)
  assert.equal(report.siteReleaseId, SITE_RELEASE_ID)
  assert.equal(report.decision.status, 'insufficient')
  for (const forbidden of ['participantId', 'title', 'query', 'url', 'coordinates', 'notes']) {
    assert.equal(run.stdout.includes(`"${forbidden}"`), false)
  }
})

test('CLI rejects sparse receipts and review-config files beyond their byte limits', (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-beta-research-limits-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const modulePath = path.join(ROOT, 'shared', 'beta-research.mjs')
  const receiptsPath = path.join(base, 'receipts.json')
  const configPath = path.join(base, 'review-config.json')

  writeFileSync(receiptsPath, '[]')
  truncateSync(receiptsPath, S11_BETA_RESEARCH_LIMITS.maxReceiptsJsonBytes + 1)
  const oversizedReceipts = spawnSync(process.execPath, [modulePath, receiptsPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.notEqual(oversizedReceipts.status, 0)
  assert.match(oversizedReceipts.stderr, /receipts file exceeds its byte limit/)
  assert.equal(oversizedReceipts.stdout, '')

  writeFileSync(receiptsPath, `${JSON.stringify(FIXTURE)}\n`)
  writeFileSync(configPath, '{}')
  truncateSync(configPath, S11_BETA_RESEARCH_LIMITS.maxReviewConfigJsonBytes + 1)
  const oversizedConfig = spawnSync(process.execPath, [modulePath, receiptsPath, configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.notEqual(oversizedConfig.status, 0)
  assert.match(oversizedConfig.stderr, /review config file exceeds its byte limit/)
  assert.equal(oversizedConfig.stdout, '')
})
