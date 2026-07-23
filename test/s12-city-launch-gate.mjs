import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CITY_LAUNCH_GATE_LIMITS,
  CITY_LAUNCH_GATE_SCHEMA_VERSION,
  CITY_LAUNCH_SAMPLE_ALGORITHM,
  CITY_LAUNCH_GATE_VERSION,
  PROPOSED_CITY_LAUNCH_THRESHOLDS,
  cityLaunchEvidenceSha256,
  cityLaunchPolicyId,
  deterministicCityLaunchSample,
  evaluateCityLaunchGate,
} from '../shared/city-launch-gate.mjs'

const CITY_ID = 'tampa-bay'
const AS_OF = '2026-07-22T12:00:00.000Z'
const ARTIFACT_SHA = 'a'.repeat(64)
const QUALITY_SHA = 'b'.repeat(64)
const MANIFEST_ID = `sha256:${'c'.repeat(64)}`
const BUILD_ID = `sha256:${'d'.repeat(64)}`

function seal(value) {
  const payload = { ...value }
  delete payload.evidenceSha256
  return { ...payload, evidenceSha256: cityLaunchEvidenceSha256(payload) }
}

function thresholds(ratified = true) {
  const policyId = cityLaunchPolicyId(PROPOSED_CITY_LAUNCH_THRESHOLDS)
  return {
    ...PROPOSED_CITY_LAUNCH_THRESHOLDS,
    ratification: ratified
      ? {
          state: 'ratified',
          authority: 'owner',
          gateVersion: CITY_LAUNCH_GATE_VERSION,
          policyId,
          decisionId: 'owner-decision-city-gates-v1',
          decidedAt: '2026-07-22T09:00:00.000Z',
        }
      : { ...PROPOSED_CITY_LAUNCH_THRESHOLDS.ratification },
  }
}

function family(index, overrides = {}) {
  return {
    family: `source-${index}`,
    active: true,
    independent: true,
    status: 'healthy',
    rows: 10,
    ...overrides,
  }
}

function selectionRow(index, overrides = {}) {
  const recommended = index < 2
  return {
    cityId: CITY_ID,
    id: `event-${index}`,
    sourceFamily: `source-${index % 10}`,
    expiredAtRender: false,
    actionableTime: true,
    decisionReadyLocation: true,
    knownPriceOrFree: true,
    recommended,
    provenance: recommended
      ? {
          kind: 'healthy-source-link',
          sourceFamily: `source-${index % 10}`,
          url: `https://source-${index % 10}.example.test/event-${index}`,
          recordId: null,
        }
      : null,
    claimEvidence: index === 0
      ? [
          { ref: 'rubric:quality', kind: 'objective-quality', receiptSha256: '1'.repeat(64) },
          { ref: 'rubric:distinctive', kind: 'distinctiveness', receiptSha256: '2'.repeat(64) },
          { ref: 'source:provenance', kind: 'source-provenance', receiptSha256: '3'.repeat(64) },
        ]
      : [],
    claims: index === 0
      ? [{
          id: 'claim-0',
          type: 'gem',
          requiredEvidenceRefs: ['rubric:quality', 'rubric:distinctive', 'source:provenance'],
          evidenceRefs: ['rubric:quality', 'rubric:distinctive', 'source:provenance'],
        }]
      : [],
    ...overrides,
  }
}

function sampleRow(index, overrides = {}) {
  return {
    cityId: CITY_ID,
    id: `event-${index}`,
    severeError: false,
    errorCodes: [],
    ...overrides,
  }
}

function draftInput({ ratified = true } = {}) {
  return {
    schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
    cityId: CITY_ID,
    asOf: AS_OF,
    thresholds: thresholds(ratified),
    evidence: {
      artifact: {
        schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
        cityId: CITY_ID,
        artifactKind: 'events',
        manifestId: MANIFEST_ID,
        buildId: BUILD_ID,
        artifactSha256: ARTIFACT_SHA,
        generatedAt: '2026-07-22T11:00:00.000Z',
        expiresAt: '2026-07-24T11:00:00.000Z',
        totalRows: 100,
        expiredRows: 1,
        qualityComplete: true,
        qualityReportSha256: QUALITY_SHA,
      },
      sourceHealth: {
        schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
        cityId: CITY_ID,
        artifactSha256: ARTIFACT_SHA,
        checkedAt: '2026-07-22T11:30:00.000Z',
        status: 'healthy',
        complete: true,
        families: Array.from({ length: 10 }, (_, index) => family(index)),
      },
      selection: {
        schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
        cityId: CITY_ID,
        artifactSha256: ARTIFACT_SHA,
        observedAt: AS_OF,
        scope: 'decision-ready',
        complete: true,
        populationCount: 50,
        claimEnumerationComplete: true,
        rows: Array.from({ length: 50 }, (_, index) => selectionRow(index)),
      },
      sample: {
        schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
        cityId: CITY_ID,
        artifactSha256: ARTIFACT_SHA,
        selectionEvidenceSha256: null,
        method: 'human',
        periodStart: '2026-07-15T12:00:00.000Z',
        periodEnd: AS_OF,
        reviewedAt: AS_OF,
        populationCount: 50,
        reviewComplete: true,
        samplingAlgorithm: CITY_LAUNCH_SAMPLE_ALGORITHM,
        samplingId: null,
        targetRows: 50,
        rows: Array.from({ length: 50 }, (_, index) => sampleRow(index)),
      },
      ciReceipt: {
        schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
        cityId: CITY_ID,
        artifactSha256: ARTIFACT_SHA,
        artifactEvidenceSha256: null,
        manifestId: MANIFEST_ID,
        buildId: BUILD_ID,
        artifactCount: 100,
        qualityReportSha256: QUALITY_SHA,
        sourceHealthEvidenceSha256: null,
        artifactApprovedByCi: true,
        qualityReportApprovedByCi: true,
        sourceHealthApprovedByCi: true,
        checkRunId: 'github-actions-12345',
        checkedAt: '2026-07-22T11:45:00.000Z',
      },
    },
  }
}

function finalizedInput(options = {}, mutate = () => {}) {
  const input = draftInput(options)
  mutate(input)
  input.evidence.artifact = seal(input.evidence.artifact)
  input.evidence.sourceHealth = seal(input.evidence.sourceHealth)
  input.evidence.selection = seal(input.evidence.selection)
  input.evidence.sample.selectionEvidenceSha256 = input.evidence.selection.evidenceSha256
  if (input.evidence.sample.samplingId === null) {
    input.evidence.sample.targetRows = input.evidence.sample.rows.length
    const expected = deterministicCityLaunchSample({
      cityId: input.cityId,
      artifactSha256: input.evidence.sample.artifactSha256,
      selectionEvidenceSha256: input.evidence.selection.evidenceSha256,
      periodStart: input.evidence.sample.periodStart,
      periodEnd: input.evidence.sample.periodEnd,
      targetRows: input.evidence.sample.targetRows,
      populationIds: input.evidence.selection.rows.map((row) => row.id),
    })
    const templates = input.evidence.sample.rows
    input.evidence.sample.samplingId = expected.samplingId
    input.evidence.sample.rows = expected.selectedIds.map((id, index) => ({
      ...(templates[index] || sampleRow(index)),
      cityId: input.cityId,
      id,
    }))
  }
  input.evidence.sample = seal(input.evidence.sample)
  input.evidence.ciReceipt.artifactEvidenceSha256 = input.evidence.artifact.evidenceSha256
  input.evidence.ciReceipt.sourceHealthEvidenceSha256 = input.evidence.sourceHealth.evidenceSha256
  input.evidence.ciReceipt = seal(input.evidence.ciReceipt)
  return input
}

function check(report, id) {
  const found = report.checks.find((entry) => entry.id === id)
  assert.ok(found, `missing check ${id}`)
  return found
}

test('the published proposal cannot produce a decision-ready result without an owner ratification receipt', () => {
  const input = finalizedInput({ ratified: false })
  const before = structuredClone(input)
  const first = evaluateCityLaunchGate(input)
  const second = evaluateCityLaunchGate(input)

  assert.deepEqual(first, second)
  assert.deepEqual(input, before)
  assert.equal(first.status, 'unratified')
  assert.equal(first.thresholdsRatified, false)
  assert.equal(first.gateVersion, CITY_LAUNCH_GATE_VERSION)
  assert.equal(first.policyId, PROPOSED_CITY_LAUNCH_THRESHOLDS.ratification.policyId)
  assert.equal(first.policyId, cityLaunchPolicyId(PROPOSED_CITY_LAUNCH_THRESHOLDS))
  assert.deepEqual(first.reasonCodes, ['THRESHOLDS_NOT_OWNER_RATIFIED'])
  assert.equal(first.checks.every((entry) => entry.passes === true), true)
})

test('an owner decision cannot be replayed after any policy value changes', () => {
  const mutations = {
    minimumActiveIndependentSourceFamilies: 9,
    maximumDecisionReadySourceFamilyShare: 0.36,
    maximumArtifactExpiredShare: 0.06,
    maximumVisibleExpiredShare: 0.006,
    minimumActionableTimeShare: 0.79,
    minimumDecisionReadyLocationShare: 0.79,
    minimumKnownPriceOrFreeShare: 0.69,
    maximumSevereSampleErrorShare: 0.03,
    minimumRecommendationProvenanceShare: 0.99,
    minimumClaimEvidenceReceiptShare: 0.99,
    maximumArtifactAgeHours: 49,
    maximumSourceHealthAgeHours: 49,
    maximumHumanSampleAgeHours: 169,
    minimumHumanSampleRows: 49,
  }
  for (const [key, value] of Object.entries(mutations)) {
    const input = finalizedInput()
    const approvedPolicyId = input.thresholds.ratification.policyId
    input.thresholds[key] = value
    assert.notEqual(cityLaunchPolicyId(input.thresholds), approvedPolicyId, key)
    assert.throws(
      () => evaluateCityLaunchGate(input),
      /ratification\.policyId does not match the threshold policy/,
      key,
    )
  }

  const unsupportedSchema = finalizedInput()
  const approvedPolicyId = unsupportedSchema.thresholds.ratification.policyId
  unsupportedSchema.thresholds.schemaVersion = 2
  assert.notEqual(cityLaunchPolicyId(unsupportedSchema.thresholds), approvedPolicyId)
  assert.throws(() => evaluateCityLaunchGate(unsupportedSchema), /thresholds\.schemaVersion is unsupported/)
})

test('complete hash-bound evidence can become decision-ready only under the exact owner-ratified thresholds', () => {
  const input = finalizedInput()
  const report = evaluateCityLaunchGate(input)

  assert.equal(report.status, 'decision-ready')
  assert.equal(report.thresholdsRatified, true)
  assert.deepEqual(report.reasonCodes, [])
  assert.equal(report.artifactSha256, ARTIFACT_SHA)
  assert.deepEqual(report.metrics.dominantSourceFamilies, [
    'source-0', 'source-1', 'source-2', 'source-3', 'source-4',
    'source-5', 'source-6', 'source-7', 'source-8', 'source-9',
  ])
  assert.equal(report.metrics.activeIndependentSourceFamilies, 10)
  assert.equal(report.metrics.decisionReadySourceFamilyMaxShare, 0.1)
  assert.equal(report.metrics.artifactExpiredShare, 0.01)
  assert.equal(report.metrics.visibleExpiredShare, 0)
  assert.equal(report.metrics.actionableTimeShare, 1)
  assert.equal(report.metrics.decisionReadyLocationShare, 1)
  assert.equal(report.metrics.knownPriceOrFreeShare, 1)
  assert.equal(report.metrics.severeSampleErrorShare, 0)
  assert.equal(report.metrics.recommendationProvenanceShare, 1)
  assert.equal(report.metrics.claimEvidenceReceiptShare, 1)
  assert.equal(report.checks.every((entry) => entry.passes === true), true)
  assert.equal(Object.hasOwn(report, 'action'), false)
  assert.equal(Object.hasOwn(report, 'message'), false)
})

test('ratified evidence reports every measured trust and numeric failure with stable codes', () => {
  const input = finalizedInput({}, (draft) => {
    draft.evidence.artifact.generatedAt = '2026-07-19T12:00:00.000Z'
    draft.evidence.artifact.expiresAt = '2026-07-25T12:00:00.000Z'
    draft.evidence.artifact.expiredRows = 5

    draft.evidence.sourceHealth.checkedAt = '2026-07-19T13:00:00.000Z'
    draft.evidence.sourceHealth.families = Array.from({ length: 9 }, (_, index) => family(index))

    draft.evidence.selection.populationCount = 20
    draft.evidence.selection.rows = draft.evidence.selection.rows.slice(0, 20)
    draft.evidence.selection.rows.forEach((row, index) => {
      const familyIndex = index < 10 ? 0 : 1 + ((index - 10) % 8)
      row.sourceFamily = `source-${familyIndex}`
      if (row.provenance?.kind === 'healthy-source-link') row.provenance.sourceFamily = row.sourceFamily
      row.expiredAtRender = index === 0
      row.actionableTime = index < 15
      row.decisionReadyLocation = index < 15
      row.knownPriceOrFree = index < 13
    })
    draft.evidence.selection.rows[0].provenance = null
    draft.evidence.selection.rows[0].claims[0].evidenceRefs = []

    draft.evidence.sample.populationCount = 20
    draft.evidence.sample.rows = Array.from({ length: 20 }, (_, index) => sampleRow(index, index === 0
      ? { severeError: true, errorCodes: ['SEVERE_DATE'] }
      : {}))
    draft.evidence.ciReceipt.artifactApprovedByCi = false
    draft.evidence.ciReceipt.qualityReportApprovedByCi = false
    draft.evidence.ciReceipt.sourceHealthApprovedByCi = false
    draft.evidence.ciReceipt.checkedAt = '2026-07-19T14:00:00.000Z'
  })

  const report = evaluateCityLaunchGate(input)
  assert.equal(report.status, 'not-ready')
  assert.deepEqual(report.reasonCodes, [
    'ARTIFACT_NOT_APPROVED_BY_CI',
    'QUALITY_REPORT_NOT_APPROVED_BY_CI',
    'SOURCE_HEALTH_NOT_APPROVED_BY_CI',
    'ARTIFACT_AGE_ABOVE_MAXIMUM',
    'SOURCE_HEALTH_AGE_ABOVE_MAXIMUM',
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
  assert.equal(report.metrics.decisionReadySourceFamilyMaxShare, 0.5)
  assert.equal(report.metrics.recommendationProvenanceShare, 0.5)
  assert.equal(report.metrics.claimEvidenceReceiptShare, 0)
})

test('strict and inclusive numeric boundaries match the proposed audit wording', () => {
  const input = finalizedInput({}, (draft) => {
    draft.evidence.artifact.expiredRows = 4
    draft.evidence.selection.populationCount = 200
    draft.evidence.selection.rows = Array.from({ length: 200 }, (_, index) => {
      const familyIndex = index < 70 ? 0 : 1 + ((index - 70) % 9)
      return selectionRow(index, {
        sourceFamily: `source-${familyIndex}`,
        actionableTime: index < 160,
        decisionReadyLocation: index < 160,
        knownPriceOrFree: index < 140,
        recommended: false,
        provenance: null,
        claims: [],
      })
    })
    draft.evidence.sample.populationCount = 200
    draft.evidence.sample.rows = Array.from({ length: 50 }, (_, index) => sampleRow(index, index === 0
      ? { severeError: true, errorCodes: ['SEVERE_LOCATION'] }
      : {}))
  })
  const report = evaluateCityLaunchGate(input)

  assert.equal(report.status, 'not-ready')
  assert.deepEqual(report.reasonCodes, ['SEVERE_SAMPLE_ERROR_SHARE_NOT_BELOW_MAXIMUM'])
  assert.equal(check(report, 'decision-ready-source-family-share').metric, 0.35)
  assert.equal(check(report, 'decision-ready-source-family-share').passes, true)
  assert.equal(check(report, 'actionable-time-share').metric, 0.8)
  assert.equal(check(report, 'actionable-time-share').passes, true)
  assert.equal(check(report, 'decision-ready-location-share').passes, true)
  assert.equal(check(report, 'known-price-or-free-share').metric, 0.7)
  assert.equal(check(report, 'known-price-or-free-share').passes, true)
  assert.equal(check(report, 'severe-sample-error-share').metric, 0.02)
  assert.equal(check(report, 'severe-sample-error-share').passes, false)
})

test('a well-formed empty envelope is insufficient rather than silently evaluated', () => {
  const report = evaluateCityLaunchGate({
    schemaVersion: CITY_LAUNCH_GATE_SCHEMA_VERSION,
    cityId: CITY_ID,
    asOf: AS_OF,
    thresholds: null,
    evidence: {
      artifact: null,
      sourceHealth: null,
      selection: null,
      sample: null,
      ciReceipt: null,
    },
  })

  assert.equal(report.status, 'insufficient')
  assert.equal(report.thresholdsRatified, false)
  assert.equal(report.artifactSha256, null)
  assert.deepEqual(report.reasonCodes, [
    'THRESHOLDS_MISSING',
    'EVIDENCE_ARTIFACT_MISSING',
    'EVIDENCE_SOURCE_HEALTH_MISSING',
    'EVIDENCE_SELECTION_MISSING',
    'EVIDENCE_SAMPLE_MISSING',
    'EVIDENCE_CI_RECEIPT_MISSING',
  ])
  assert.deepEqual(report.checks, [])
})

test('partial quality, source, selection, and human-review receipts remain insufficient', () => {
  const input = finalizedInput({}, (draft) => {
    draft.evidence.artifact.qualityComplete = false
    draft.evidence.artifact.expiredRows = null
    draft.evidence.sourceHealth.complete = false
    draft.evidence.sourceHealth.status = 'unknown'
    draft.evidence.selection.complete = false
    draft.evidence.selection.rows[0].sourceFamily = null
    draft.evidence.selection.rows[0].provenance = null
    draft.evidence.sample.reviewComplete = false
    draft.evidence.sample.rows = []
  })
  const report = evaluateCityLaunchGate(input)

  assert.equal(report.status, 'insufficient')
  assert.deepEqual(report.reasonCodes.slice(0, 5), [
    'ARTIFACT_EXPIRY_EVIDENCE_INCOMPLETE',
    'SOURCE_HEALTH_EVIDENCE_INCOMPLETE',
    'SELECTION_EVIDENCE_INCOMPLETE',
    'HUMAN_SAMPLE_EVIDENCE_INCOMPLETE',
    'HUMAN_SAMPLE_EMPTY',
  ])
  assert.equal(report.metrics.artifactExpiredShare, null)
  assert.equal(report.metrics.activeIndependentSourceFamilies, null)
  assert.equal(report.metrics.visibleExpiredShare, null)
  assert.equal(report.metrics.severeSampleErrorShare, null)
})

test('explicitly having no recommendations or governed claims is vacuously complete, not fabricated evidence', () => {
  const input = finalizedInput({}, (draft) => {
    for (const row of draft.evidence.selection.rows) {
      row.recommended = false
      row.provenance = null
      row.claimEvidence = []
      row.claims = []
    }
  })
  const report = evaluateCityLaunchGate(input)
  assert.equal(report.status, 'decision-ready')
  assert.equal(report.metrics.recommendationProvenanceShare, 1)
  assert.equal(report.metrics.claimEvidenceReceiptShare, 1)
})

test('the proposed minimum sample size prevents a one-row review from passing a weekly error-rate gate', () => {
  const input = finalizedInput({}, (draft) => {
    draft.evidence.sample.rows = [sampleRow(0)]
  })
  const report = evaluateCityLaunchGate(input)
  assert.equal(report.status, 'not-ready')
  assert.deepEqual(report.reasonCodes, ['HUMAN_SAMPLE_ROWS_BELOW_MINIMUM'])
  assert.equal(report.metrics.humanSampleRows, 1)
  assert.equal(report.metrics.severeSampleErrorShare, 0)
  assert.equal(check(report, 'human-sample-rows').threshold, 50)
  assert.equal(check(report, 'human-sample-rows').passes, false)
})

test('human samples are the exact deterministic prefix of the sealed selection population', () => {
  const input = finalizedInput()
  const sample = input.evidence.sample
  const expected = deterministicCityLaunchSample({
    cityId: input.cityId,
    artifactSha256: input.evidence.artifact.artifactSha256,
    selectionEvidenceSha256: input.evidence.selection.evidenceSha256,
    periodStart: sample.periodStart,
    periodEnd: sample.periodEnd,
    targetRows: sample.targetRows,
    populationIds: input.evidence.selection.rows.map((row) => row.id),
  })
  assert.equal(sample.samplingId, expected.samplingId)
  assert.deepEqual(sample.rows.map((row) => row.id), expected.selectedIds)

  const substituted = finalizedInput()
  const selected = new Set(substituted.evidence.sample.rows.map((row) => row.id))
  const favorableReplacement = substituted.evidence.selection.rows.find((row) => !selected.has(row.id))
  // Use a 60-row population so there is a legitimate but unselected row to substitute.
  if (!favorableReplacement) {
    const larger = finalizedInput({}, (draft) => {
      draft.evidence.selection.populationCount = 60
      draft.evidence.selection.rows = Array.from({ length: 60 }, (_, index) => selectionRow(index))
      draft.evidence.sample.populationCount = 60
    })
    const largerSelected = new Set(larger.evidence.sample.rows.map((row) => row.id))
    const replacement = larger.evidence.selection.rows.find((row) => !largerSelected.has(row.id))
    larger.evidence.sample.rows[0].id = replacement.id
    larger.evidence.sample = seal(larger.evidence.sample)
    assert.throws(() => evaluateCityLaunchGate(larger), /row IDs do not match the deterministic sample/)
  } else {
    substituted.evidence.sample.rows[0].id = favorableReplacement.id
    substituted.evidence.sample = seal(substituted.evidence.sample)
    assert.throws(() => evaluateCityLaunchGate(substituted), /row IDs do not match the deterministic sample/)
  }
})

test('healthy-link provenance requires an active as well as healthy source family', () => {
  const input = finalizedInput({}, (draft) => {
    draft.evidence.sourceHealth.families.push(family(10, { active: false, rows: 0 }))
    const row = draft.evidence.selection.rows[0]
    row.sourceFamily = 'source-10'
    row.provenance.sourceFamily = 'source-10'
  })
  assert.throws(
    () => evaluateCityLaunchGate(input),
    /must reference an active source family with rows/,
  )
})

test('inactive zero-row source families cannot dilute decision-ready source concentration', () => {
  assert.throws(() => evaluateCityLaunchGate(finalizedInput({}, (draft) => {
    draft.evidence.sourceHealth.families.push(...Array.from(
      { length: 10 },
      (_, index) => family(index + 10, { active: false, rows: 0 }),
    ))
    draft.evidence.selection.rows.forEach((row, index) => {
      if (index < 2) return
      row.sourceFamily = `source-${10 + (index % 10)}`
    })
  })), /must reference an active source family with rows/)
})

test('selection and sample observations cannot precede the evidence they claim to assess', () => {
  const earlySelection = finalizedInput({}, (draft) => {
    draft.evidence.selection.observedAt = '2026-07-22T10:59:59.000Z'
    draft.evidence.sample.periodEnd = '2026-07-22T11:00:00.000Z'
    draft.evidence.sample.reviewedAt = '2026-07-22T11:00:00.000Z'
  })
  assert.throws(() => evaluateCityLaunchGate(earlySelection), /selection observedAt predates artifact generation/)

  const earlySample = finalizedInput({}, (draft) => {
    draft.evidence.sample.periodStart = '2026-07-15T11:59:00.000Z'
    draft.evidence.sample.periodEnd = '2026-07-22T11:59:00.000Z'
    draft.evidence.sample.reviewedAt = '2026-07-22T11:59:00.000Z'
  })
  assert.throws(() => evaluateCityLaunchGate(earlySample), /sample reviewedAt predates selection observedAt/)
})

test('claim support means typed hash-receipt completeness, not self-matching reference strings', () => {
  const input = finalizedInput({}, (draft) => {
    draft.evidence.selection.rows[0].claimEvidence[0].kind = 'comparative-quality'
  })
  const report = evaluateCityLaunchGate(input)
  assert.equal(report.status, 'not-ready')
  assert.deepEqual(report.reasonCodes, ['CLAIM_EVIDENCE_RECEIPT_SHARE_BELOW_MINIMUM'])
  assert.equal(report.metrics.claimEvidenceReceiptShare, 0)
  assert.equal(check(report, 'claim-evidence-receipt-share').passes, false)
})

test('location, distance, and weather claims require their typed evidence receipts', () => {
  const claimKinds = {
    'near-you': ['location-fix', 'location-currentness', 'distance-calculation', 'source-provenance'],
    'worth-the-drive': ['objective-quality', 'distance-calculation', 'quality-distance-comparison', 'source-provenance'],
    'weather-based': ['weather-observation', 'weather-currentness', 'weather-fit-evaluation', 'source-provenance'],
  }
  const input = finalizedInput({}, (draft) => {
    const row = draft.evidence.selection.rows[2]
    let receiptIndex = 0
    row.claimEvidence = []
    row.claims = Object.entries(claimKinds).map(([type, kinds]) => {
      const refs = kinds.map((kind) => {
        const ref = `${type}:${kind}`
        const digit = '456789abcdef'[receiptIndex]
        receiptIndex += 1
        row.claimEvidence.push({ ref, kind, receiptSha256: digit.repeat(64) })
        return ref
      })
      return { id: `claim-${type}`, type, requiredEvidenceRefs: refs, evidenceRefs: refs }
    })
  })
  assert.equal(evaluateCityLaunchGate(input).status, 'decision-ready')

  const missingCurrentWeather = finalizedInput({}, (draft) => {
    const row = draft.evidence.selection.rows[2]
    const kinds = claimKinds['weather-based']
    row.claimEvidence = kinds.map((kind, index) => ({
      ref: `weather-based:${kind}`,
      kind,
      receiptSha256: '4567'[index].repeat(64),
    }))
    const refs = row.claimEvidence.map((entry) => entry.ref)
    row.claims = [{
      id: 'claim-weather-based',
      type: 'weather-based',
      requiredEvidenceRefs: refs,
      evidenceRefs: refs.filter((ref) => !ref.endsWith(':weather-currentness')),
    }]
  })
  const report = evaluateCityLaunchGate(missingCurrentWeather)
  assert.equal(report.status, 'not-ready')
  assert.deepEqual(report.reasonCodes, ['CLAIM_EVIDENCE_RECEIPT_SHARE_BELOW_MINIMUM'])
})

test('a producer must explicitly attest complete enumeration of displayed governed claims', () => {
  const input = finalizedInput({}, (draft) => {
    draft.evidence.selection.claimEnumerationComplete = false
  })
  const report = evaluateCityLaunchGate(input)
  assert.equal(report.status, 'insufficient')
  assert.deepEqual(report.reasonCodes, ['CLAIM_ENUMERATION_INCOMPLETE'])
  assert.equal(report.metrics.claimEvidenceReceiptShare, null)
  assert.equal(check(report, 'claim-evidence-receipt-share').passes, null)
})

test('cross-city and cross-artifact evidence is rejected before it can affect a result', () => {
  const wrongCity = finalizedInput({}, (draft) => {
    draft.evidence.sourceHealth.cityId = 'sf-east-bay'
  })
  assert.throws(() => evaluateCityLaunchGate(wrongCity), /sourceHealth\.cityId does not match/)

  const wrongHash = finalizedInput({}, (draft) => {
    draft.evidence.selection.artifactSha256 = 'e'.repeat(64)
    draft.evidence.sample.artifactSha256 = 'e'.repeat(64)
  })
  assert.throws(() => evaluateCityLaunchGate(wrongHash), /selection artifact hash does not match/)

  const foreignRow = finalizedInput({}, (draft) => {
    draft.evidence.selection.rows[0].cityId = 'sf-east-bay'
  })
  assert.throws(() => evaluateCityLaunchGate(foreignRow), /rows\[0\]\.cityId does not match/)
})

test('duplicate source, selection, sample, claim, and evidence-reference identities are rejected', () => {
  const cases = [
    [
      (draft) => { draft.evidence.sourceHealth.families[1].family = draft.evidence.sourceHealth.families[0].family },
      /duplicate families/,
    ],
    [
      (draft) => { draft.evidence.selection.rows[1].id = draft.evidence.selection.rows[0].id },
      /duplicate IDs/,
    ],
    [
      (draft) => {
        draft.evidence.selection.rows[1].claimEvidence = structuredClone(draft.evidence.selection.rows[0].claimEvidence)
        draft.evidence.selection.rows[1].claims = [structuredClone(draft.evidence.selection.rows[0].claims[0])]
      },
      /duplicate claim IDs/,
    ],
    [
      (draft) => { draft.evidence.selection.rows[0].claims[0].evidenceRefs.push('rubric:quality') },
      /evidenceRefs contains duplicates/,
    ],
  ]
  for (const [mutate, pattern] of cases) {
    assert.throws(() => evaluateCityLaunchGate(finalizedInput({}, mutate)), pattern)
  }
  const duplicateSample = finalizedInput()
  duplicateSample.evidence.sample.rows[1].id = duplicateSample.evidence.sample.rows[0].id
  duplicateSample.evidence.sample = seal(duplicateSample.evidence.sample)
  assert.throws(() => evaluateCityLaunchGate(duplicateSample), /sample\.rows contains duplicate IDs/)
})

test('oversized collections and forged or ambiguous receipts fail closed', () => {
  const tooManySources = finalizedInput()
  tooManySources.evidence.sourceHealth.families = Array.from(
    { length: CITY_LAUNCH_GATE_LIMITS.sourceFamilies + 1 },
    (_, index) => family(index),
  )
  assert.throws(() => evaluateCityLaunchGate(tooManySources), /families exceeds its item limit/)

  const tooManyRows = finalizedInput()
  tooManyRows.evidence.selection.populationCount = CITY_LAUNCH_GATE_LIMITS.selectionRows + 1
  tooManyRows.evidence.selection.rows = Array(CITY_LAUNCH_GATE_LIMITS.selectionRows + 1).fill(null)
  assert.throws(() => evaluateCityLaunchGate(tooManyRows), /populationCount exceeds its limit|rows exceeds its item limit/)

  const forged = finalizedInput()
  forged.evidence.artifact.expiredRows = 0
  assert.throws(() => evaluateCityLaunchGate(forged), /artifact\.evidenceSha256 does not match/)

  const ambiguous = finalizedInput()
  ambiguous.evidence.artifact.unreviewedMetric = 1
  assert.throws(() => evaluateCityLaunchGate(ambiguous), /artifact must contain exactly/)
})

test('sample membership, source-family receipts, CI identities, and temporal ordering are exact', () => {
  const unknownFamily = finalizedInput({}, (draft) => {
    draft.evidence.selection.rows[0].sourceFamily = 'unreceipted-source'
    draft.evidence.selection.rows[0].provenance = null
  })
  assert.throws(() => evaluateCityLaunchGate(unknownFamily), /has no source-health receipt/)

  const unknownSample = finalizedInput()
  unknownSample.evidence.sample.rows[0].id = 'not-in-selection'
  unknownSample.evidence.sample = seal(unknownSample.evidence.sample)
  assert.throws(() => evaluateCityLaunchGate(unknownSample), /not present in selection evidence/)

  const wrongReceipt = finalizedInput()
  wrongReceipt.evidence.ciReceipt = seal({
    ...wrongReceipt.evidence.ciReceipt,
    artifactEvidenceSha256: 'f'.repeat(64),
  })
  assert.throws(() => evaluateCityLaunchGate(wrongReceipt), /artifact evidence hash does not match/)

  const backwards = finalizedInput({}, (draft) => {
    draft.evidence.ciReceipt.checkedAt = '2026-07-22T10:00:00.000Z'
  })
  assert.throws(() => evaluateCityLaunchGate(backwards), /ciReceipt predates artifact generation/)
})

test('malformed thresholds and envelopes are rejected rather than downgraded to missing evidence', () => {
  const extra = finalizedInput()
  extra.unexpected = true
  assert.throws(() => evaluateCityLaunchGate(extra), /input must contain exactly/)

  const nonOwner = finalizedInput()
  nonOwner.thresholds.ratification.authority = 'release-bot'
  assert.throws(() => evaluateCityLaunchGate(nonOwner), /authority must be owner/)

  const missingThreshold = finalizedInput()
  delete missingThreshold.thresholds.maximumArtifactExpiredShare
  assert.throws(() => evaluateCityLaunchGate(missingThreshold), /thresholds must contain exactly/)

  const futureDecision = finalizedInput()
  futureDecision.thresholds.ratification.decidedAt = '2026-07-23T12:00:00.000Z'
  assert.throws(() => evaluateCityLaunchGate(futureDecision), /decidedAt is in the future/)
})

test('non-JSON prototypes, accessors, symbols, sparse arrays, and array properties are rejected', () => {
  const customPrototype = finalizedInput()
  Object.setPrototypeOf(customPrototype.evidence.artifact, { inherited: true })
  assert.throws(() => evaluateCityLaunchGate(customPrototype), /artifact must be an object/)

  const accessor = finalizedInput()
  Object.defineProperty(accessor.evidence.artifact, 'expiredRows', {
    enumerable: true,
    configurable: true,
    get: () => 0,
  })
  assert.throws(() => evaluateCityLaunchGate(accessor), /expiredRows must be an enumerable data property/)

  const symbol = finalizedInput()
  symbol.evidence.sourceHealth[Symbol('hidden')] = true
  assert.throws(() => evaluateCityLaunchGate(symbol), /sourceHealth must not contain symbol keys/)

  const sparse = finalizedInput()
  sparse.evidence.selection.rows = new Array(50)
  assert.throws(() => evaluateCityLaunchGate(sparse), /rows must be dense/)

  const decorated = finalizedInput()
  decorated.evidence.sample.rows.note = 'not JSON array data'
  assert.throws(() => evaluateCityLaunchGate(decorated), /rows must be dense and contain no extra properties/)
})
