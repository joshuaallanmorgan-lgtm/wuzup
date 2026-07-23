import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CITY_LAUNCH_GATE_SCHEMA_VERSION,
  CITY_LAUNCH_GATE_VERSION,
  CITY_LAUNCH_SAMPLE_ALGORITHM,
  PROPOSED_CITY_LAUNCH_THRESHOLDS,
  cityLaunchEvidenceSha256,
  cityLaunchPolicyId,
  deterministicCityLaunchSample,
} from '../shared/city-launch-gate.mjs'
import {
  evaluateFlagshipLaunchGate,
  evaluateUntrustedFlagshipLaunchGate,
} from '../shared/flagship-launch-gate.mjs'
import { S11_PRODUCTION_OBSERVATION_SCHEMA, S11_PRODUCTION_OBSERVATION_SCHEMA_VERSION } from '../shared/beta-production-observation.mjs'

const AS_OF = '2026-07-22T12:00:00.000Z'
const SITE = `sha256:${'9'.repeat(64)}`
const COMMIT = 'a'.repeat(40)
const IDS = Object.freeze({
  'sf-east-bay': Object.freeze({ manifestId: `sha256:${'b'.repeat(64)}`, buildId: `sha256:${'c'.repeat(64)}` }),
  'tampa-bay': Object.freeze({ manifestId: `sha256:${'d'.repeat(64)}`, buildId: `sha256:${'e'.repeat(64)}` }),
})

function seal(value) {
  const copy = { ...value }
  delete copy.evidenceSha256
  return { ...copy, evidenceSha256: cityLaunchEvidenceSha256(copy) }
}

function cityInput(cityId, { ratified = true, healthy = true } = {}) {
  const artifactSha256 = cityId === 'sf-east-bay' ? '1'.repeat(64) : '2'.repeat(64)
  const quality = cityId === 'sf-east-bay' ? '3'.repeat(64) : '4'.repeat(64)
  const rows = Array.from({ length: 50 }, (_, index) => ({
    cityId,
    id: `${cityId}-${index}`,
    sourceFamily: `family-${index % 10}`,
    expiredAtRender: false,
    actionableTime: true,
    decisionReadyLocation: true,
    knownPriceOrFree: true,
    recommended: index < 2,
    provenance: index < 2 ? { kind: 'healthy-source-link', sourceFamily: `family-${index % 10}`, url: `https://example.test/${cityId}/${index}`, recordId: null } : null,
    claimEvidence: index === 0 ? [
      { ref: 'quality', kind: 'objective-quality', receiptSha256: '5'.repeat(64) },
      { ref: 'distinctive', kind: 'distinctiveness', receiptSha256: '6'.repeat(64) },
      { ref: 'source', kind: 'source-provenance', receiptSha256: '7'.repeat(64) },
    ] : [],
    claims: index === 0 ? [{ id: 'claim', type: 'gem', requiredEvidenceRefs: ['quality', 'distinctive', 'source'], evidenceRefs: ['quality', 'distinctive', 'source'] }] : [],
  }))
  const policyId = cityLaunchPolicyId(PROPOSED_CITY_LAUNCH_THRESHOLDS)
  const input = {
    schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
    cityId,
    asOf: AS_OF,
    thresholds: {
      ...PROPOSED_CITY_LAUNCH_THRESHOLDS,
      ratification: ratified
        ? { state: 'ratified', authority: 'owner', gateVersion: CITY_LAUNCH_GATE_VERSION, policyId, decisionId: 'owner-decision', decidedAt: '2026-07-22T09:00:00.000Z' }
        : { ...PROPOSED_CITY_LAUNCH_THRESHOLDS.ratification },
    },
    evidence: {
      artifact: { schemaVersion: 1, cityId, artifactKind: 'events', ...IDS[cityId], artifactSha256, generatedAt: '2026-07-22T11:00:00.000Z', expiresAt: '2026-07-24T11:00:00.000Z', totalRows: 100, expiredRows: 1, qualityComplete: true, qualityReportSha256: quality },
      sourceHealth: { schemaVersion: 1, cityId, artifactSha256, checkedAt: '2026-07-22T11:30:00.000Z', status: healthy ? 'healthy' : 'degraded', complete: true, families: Array.from({ length: 10 }, (_, index) => ({ family: `family-${index}`, active: true, independent: true, status: healthy ? 'healthy' : 'degraded', rows: 10 })) },
      selection: { schemaVersion: 1, cityId, artifactSha256, observedAt: AS_OF, scope: 'decision-ready', complete: true, populationCount: 50, claimEnumerationComplete: true, rows },
      sample: { schemaVersion: 1, cityId, artifactSha256, selectionEvidenceSha256: null, method: 'human', periodStart: '2026-07-15T12:00:00.000Z', periodEnd: AS_OF, reviewedAt: AS_OF, populationCount: 50, reviewComplete: true, samplingAlgorithm: CITY_LAUNCH_SAMPLE_ALGORITHM, samplingId: null, targetRows: 50, rows: [] },
      ciReceipt: { schemaVersion: 1, cityId, artifactSha256, artifactEvidenceSha256: null, manifestId: IDS[cityId].manifestId, buildId: IDS[cityId].buildId, artifactCount: 100, qualityReportSha256: quality, sourceHealthEvidenceSha256: null, artifactApprovedByCi: true, qualityReportApprovedByCi: true, sourceHealthApprovedByCi: true, checkRunId: `ci-${cityId}`, checkedAt: '2026-07-22T11:45:00.000Z' },
    },
  }
  input.evidence.artifact = seal(input.evidence.artifact)
  input.evidence.sourceHealth = seal(input.evidence.sourceHealth)
  input.evidence.selection = seal(input.evidence.selection)
  const sample = deterministicCityLaunchSample({ cityId, artifactSha256, selectionEvidenceSha256: input.evidence.selection.evidenceSha256, periodStart: input.evidence.sample.periodStart, periodEnd: AS_OF, targetRows: 50, populationIds: rows.map(row => row.id) })
  input.evidence.sample.selectionEvidenceSha256 = input.evidence.selection.evidenceSha256
  input.evidence.sample.samplingId = sample.samplingId
  input.evidence.sample.rows = sample.selectedIds.map(id => ({ cityId, id, severeError: false, errorCodes: [] }))
  input.evidence.sample = seal(input.evidence.sample)
  input.evidence.ciReceipt.artifactEvidenceSha256 = input.evidence.artifact.evidenceSha256
  input.evidence.ciReceipt.sourceHealthEvidenceSha256 = input.evidence.sourceHealth.evidenceSha256
  input.evidence.ciReceipt = seal(input.evidence.ciReceipt)
  return input
}

function inputs(options = {}) {
  return ['sf-east-bay', 'tampa-bay'].map(cityId => cityInput(cityId, options[cityId]))
}

function observation({ status = 'observed', evaluatedAt = AS_OF, blockers = [], releases = IDS, siteReleaseId = SITE, sourceCommit = COMMIT } = {}) {
  return {
    schema: S11_PRODUCTION_OBSERVATION_SCHEMA,
    schemaVersion: S11_PRODUCTION_OBSERVATION_SCHEMA_VERSION,
    evaluatedAt,
    status,
    site: { status: 'observed', releaseId: siteReleaseId, sourceCommit, attemptsUsed: 1, evidence: {}, problems: [] },
    cities: ['sf-east-bay', 'tampa-bay'].map(cityId => ({ cityId, baseUrl: `https://example.test/${cityId}`, status: 'observed', release: { ...releases[cityId] }, attemptsUsed: 1, evidence: {}, problems: [] })),
    deployedReleases: { 'sf-east-bay': { ...releases['sf-east-bay'] }, 'tampa-bay': { ...releases['tampa-bay'] } },
    blockers,
    interpretation: 'fixture',
  }
}

function options(overrides = {}) {
  return { asOf: AS_OF, expectedSiteReleaseId: SITE, expectedSourceCommit: COMMIT, cityGateInputs: inputs(), observer: async args => observation(), ...overrides }
}

test('the untrusted harness exposes an evidence-ready candidate but never emits production evidence-ready', async () => {
  let received
  const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer: async args => { received = args; return observation() } }))
  assert.equal(report.status, 'insufficient')
  assert.equal(report.candidateStatus, 'evidence-ready')
  assert.deepEqual(report.reasonCodes, ['TRUSTED_PRODUCTION_OBSERVER_REQUIRED'])
  assert.equal(received.nowMs, Date.parse(AS_OF))
  assert.deepEqual(received.expectedReleases, IDS)
  assert.match(report.interpretation, /not pilot authorization/i)
})

test('rejects missing, duplicate, mixed, and mismatched city inputs', async () => {
  for (const cityGateInputs of [
    [inputs()[0]],
    [inputs()[0], inputs()[0]],
    [inputs()[0], { ...inputs()[1], cityId: 'not-a-flagship' }],
    [inputs()[0], { ...inputs()[1], asOf: '2026-07-22T12:01:00.000Z' }],
  ]) await assert.rejects(() => evaluateUntrustedFlagshipLaunchGate(options({ cityGateInputs })))
})

test('fails closed when the observer throws', async () => {
  const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer: async () => { throw new Error('network') } }))
  assert.equal(report.status, 'insufficient')
  assert.deepEqual(report.reasonCodes, ['PRODUCTION_OBSERVATION_UNAVAILABLE'])
})

test('fails closed for blocked or unbound production observations', async () => {
  for (const status of ['blocked', 'observed-unbound']) {
    const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer: async () => observation({ status }) }))
    assert.equal(report.status, 'insufficient')
    assert.deepEqual(report.reasonCodes, ['PRODUCTION_OBSERVATION_NOT_OBSERVED'])
  }
})

test('fails closed for stale or malformed production observations', async () => {
  for (const observer of [
    async () => observation({ evaluatedAt: '2026-07-22T11:59:59.000Z' }),
    async () => ({ schema: 'wrong' }),
  ]) {
    const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer }))
    assert.equal(report.status, 'insufficient')
    assert.ok(report.reasonCodes.length > 0)
  }
})

test('fails closed with stable reason codes for site, source, manifest, and build identity mixes', async () => {
  const mixed = structuredClone(IDS)
  mixed['tampa-bay'].buildId = `sha256:${'f'.repeat(64)}`
  for (const [observed, reason] of [
    [observation({ siteReleaseId: `sha256:${'0'.repeat(64)}` }), 'PRODUCTION_OBSERVATION_SITE_BINDING_MISMATCH'],
    [observation({ sourceCommit: '0'.repeat(40) }), 'PRODUCTION_OBSERVATION_SITE_BINDING_MISMATCH'],
    [observation({ releases: mixed }), 'PRODUCTION_OBSERVATION_CITY_BINDING_MISMATCH'],
  ]) {
    const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer: async () => observed }))
    assert.equal(report.status, 'insufficient')
    assert.deepEqual(report.reasonCodes, [reason])
  }
})

test('city status precedence is insufficient, unratified, then not-ready', async () => {
  const variants = [
    [{ 'sf-east-bay': { ratified: false } }, 'unratified'],
    [{ 'sf-east-bay': { healthy: false } }, 'not-ready'],
  ]
  for (const [perCity, expected] of variants) {
    const report = await evaluateUntrustedFlagshipLaunchGate(options({ cityGateInputs: inputs(perCity) }))
    assert.equal(report.status, expected)
  }
})

test('rejects prototype, accessor, and symbol attacks in caller-owned input', async () => {
  const prototype = Object.create({})
  Object.assign(prototype, options())
  await assert.rejects(() => evaluateUntrustedFlagshipLaunchGate(prototype))
  const accessor = options()
  Object.defineProperty(accessor.cityGateInputs[0].evidence.artifact, 'buildId', { enumerable: true, get: () => IDS['sf-east-bay'].buildId })
  await assert.rejects(() => evaluateUntrustedFlagshipLaunchGate(accessor))
  const symbol = options()
  symbol.cityGateInputs[0][Symbol('extra')] = true
  await assert.rejects(() => evaluateUntrustedFlagshipLaunchGate(symbol))
})

test('the production API rejects a caller-supplied observer', async () => {
  await assert.rejects(() => evaluateFlagshipLaunchGate(options()), /unsupported key 'observer'/)
})

test('hostile accessor and proxy observer results fail closed without a second raw read', async () => {
  const accessor = observation()
  Object.defineProperty(accessor.site, 'releaseId', { enumerable: true, get: () => { throw new Error('hostile') } })
  const proxy = new Proxy(observation(), { ownKeys: () => { throw new Error('hostile') } })
  for (const value of [accessor, proxy]) {
    const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer: async () => value }))
    assert.equal(report.status, 'insufficient')
    assert.deepEqual(report.releaseBinding.observed, null)
  }
})

test('a chameleon proxy cannot alter the sanitized successful observation binding on a later read', async () => {
  const raw = observation()
  const reads = new Map()
  const chameleon = new Proxy(raw, {
    get(target, key, receiver) {
      const count = (reads.get(key) || 0) + 1
      reads.set(key, count)
      if (key === 'evaluatedAt' && count > 2) return '2026-07-22T11:59:59.000Z'
      if (key === 'status' && count > 1) return 'blocked'
      return Reflect.get(target, key, receiver)
    },
  })
  const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer: async () => chameleon }))
  assert.equal(report.status, 'insufficient')
  assert.equal(report.candidateStatus, 'evidence-ready')
  assert.deepEqual(report.releaseBinding.observed, {
    evaluatedAt: AS_OF,
    status: 'observed',
    siteReleaseId: SITE,
    sourceCommit: COMMIT,
    deployedReleases: IDS,
  })
})

test('nonempty blockers, non-observed records, problem lists, and city/deployed disagreement fail closed', async () => {
  const blocked = observation({ blockers: ['SITE_NOT_OBSERVED'] })
  const siteBlocked = observation()
  siteBlocked.site.status = 'blocked'
  const cityBlocked = observation()
  cityBlocked.cities[0].status = 'blocked'
  const problems = observation()
  problems.cities[0].problems = ['RUNTIME_IDENTITY_MISMATCH']
  const disagreement = observation()
  disagreement.deployedReleases['tampa-bay'].buildId = `sha256:${'0'.repeat(64)}`
  for (const value of [blocked, siteBlocked, cityBlocked, problems, disagreement]) {
    const report = await evaluateUntrustedFlagshipLaunchGate(options({ observer: async () => value }))
    assert.equal(report.status, 'insufficient')
    assert.equal(report.releaseBinding.observed, null)
  }
})
