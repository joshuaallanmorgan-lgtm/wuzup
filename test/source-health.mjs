import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { SOURCE_HEALTH_SCHEMA_VERSION, summarizeSourceHealth } from '../shared/source-health.mjs'

function completeEvent(overrides = {}) {
  return {
    sourceFamily: 'City calendar',
    sourceFamilies: ['City calendar'],
    canonicalId: 'event:city:1',
    seriesId: null,
    actionability: true,
    recurrence: { kind: 'one-off' },
    range: { semantics: 'single', start: '2026-07-20T19:00:00-04:00', end: null },
    organizer: 'Parks Department',
    status: 'scheduled',
    rawCategories: ['music'],
    descriptionLength: 120,
    imageRank: 'official',
    osmProvenance: 'node/123',
    brand: 'City Parks',
    governmentBacking: true,
    ...overrides,
  }
}

test('source health reports receipt coverage and concentration without inventing a missing family', () => {
  const report = summarizeSourceHealth({
    expectedSourceFamilies: ['Independent calendar', 'City calendar'],
    sourceReceipts: [
      { source: 'City calendar', status: 'healthy' },
      { source: 'Independent calendar', status: 'degraded' },
    ],
    events: [
      completeEvent(),
      completeEvent({ canonicalId: 'event:city:2' }),
      completeEvent({ sourceFamily: 'Independent calendar', sourceFamilies: ['Independent calendar'], canonicalId: 'event:independent:1' }),
    ],
  })

  assert.equal(report.schemaVersion, SOURCE_HEALTH_SCHEMA_VERSION)
  assert.equal(report.sourceHealth.status, 'degraded')
  assert.deepEqual(report.sourceHealth.receiptCoverage, {
    expected: 2,
    receipted: 2,
    missing: [],
    complete: true,
  })
  assert.equal(report.sourceConcentration.maxShare, 2 / 3)
  assert.deepEqual(report.sourceConcentration.dominantFamilies, ['City calendar'])
  assert.deepEqual(report.primaryPlacementConcentration, report.sourceConcentration)
  assert.equal(report.corroboratingSourceConcentration.maxShare, 2 / 3)
  assert.equal(report.readiness.state, 'limited')
  assert.deepEqual(report.readiness.blockers, ['SOURCE_HEALTH_DEGRADED'])
})

test('reports primary placement separately from explicit corroborating source families', () => {
  const report = summarizeSourceHealth({
    events: [
      completeEvent({ sourceFamily: 'A', sourceFamilies: ['A', 'B'] }),
      completeEvent({ sourceFamily: 'B', sourceFamilies: ['B'] }),
      completeEvent({ sourceFamily: 'A', sourceFamilies: undefined }),
    ],
  })
  assert.equal(report.primaryPlacementConcentration.observedMaxShare, 2 / 3)
  assert.equal(report.corroboratingSourceConcentration.identifiedEvents, 2)
  assert.equal(report.corroboratingSourceConcentration.multiFamilyEvents, 1)
  assert.equal(report.corroboratingSourceConcentration.totalAssignments, 3)
  assert.equal(report.corroboratingSourceConcentration.observedMaxShare, 1)
  assert.equal(report.corroboratingSourceConcentration.maxShare, null)
  assert.deepEqual(report.corroboratingSourceConcentration.familyCounts, { A: 1, B: 2 })
})

test('real legacy manifest receipt names remain unknown rather than being upgraded', async () => {
  for (const cityId of ['tampa-bay', 'sf-east-bay']) {
    const manifest = JSON.parse(await readFile(`finder/output/${cityId}/artifact-manifest.json`, 'utf8'))
    const events = JSON.parse(await readFile(`finder/output/${cityId}/events.json`, 'utf8'))
    const receipts = manifest.sourceHealth.sources
    const report = summarizeSourceHealth({
      expectedSourceFamilies: receipts.map((receipt) => receipt.name),
      sourceReceipts: receipts,
      events,
    })
    assert.equal(report.sourceHealth.receiptCoverage.complete, true, cityId)
    assert.equal(report.sourceHealth.status, 'unknown', cityId)
    assert.equal(report.readiness.rankable, false, cityId)
    assert.equal(report.primaryPlacementConcentration.sourceFamilyCoverage, 0, cityId)
    assert.equal(report.corroboratingSourceConcentration.sourceFamiliesCoverage, 0, cityId)
  }
})

test('unknown and malformed evidence fail closed instead of being relabeled healthy or complete', () => {
  const report = summarizeSourceHealth({
    expectedSourceFamilies: ['City calendar', 'Missing receipt'],
    sourceReceipts: [{ source: 'City calendar', status: 'healthy' }],
    events: [
      completeEvent({
        sourceFamily: undefined,
        actionability: 'probably',
        canonicalId: undefined,
        recurrence: { kind: 'weekly' },
        range: { semantics: 'continuous', start: '2026-07-20' },
      }),
    ],
  })

  assert.equal(report.sourceHealth.status, 'unknown')
  assert.deepEqual(report.sourceHealth.receiptCoverage.missing, ['Missing receipt'])
  assert.equal(report.sourceConcentration.sourceFamilyCoverage, 0)
  assert.equal(report.sourceConcentration.maxShare, null)
  assert.deepEqual(report.actionability, {
    actionable: 0,
    notActionable: 0,
    unknown: 0,
    invalid: 1,
    known: 0,
    knownCompleteness: 0,
  })
  assert.deepEqual(report.readiness.blockers, [
    'SOURCE_HEALTH_UNKNOWN',
    'SOURCE_FAMILY_UNKNOWN',
    'ACTIONABILITY_INVALID',
    'CANONICAL_ID_INVALID',
    'SERIES_ID_INVALID',
    'RECURRENCE_INVALID',
    'RANGE_INVALID',
  ])
  assert.equal(report.readiness.rankable, false)
})

test('retained signal completeness distinguishes a retained empty value from missing or invalid data', () => {
  const report = summarizeSourceHealth({
    events: [
      completeEvent({ rawCategories: [], descriptionLength: 0, governmentBacking: false, status: 'unknown' }),
      completeEvent({
        organizer: undefined,
        status: 404,
        rawCategories: 'music',
        descriptionLength: -1,
        imageRank: null,
        osmProvenance: null,
        brand: '',
        governmentBacking: 'yes',
      }),
    ],
  })

  assert.deepEqual(report.retainedSignals.fields.rawCategories, {
    known: 0,
    recorded: 1,
    missing: 0,
    invalid: 1,
    retained: 1,
    completeness: 0.5,
    knownCompleteness: 0,
  })
  assert.deepEqual(report.retainedSignals.fields.description, {
    known: 0,
    recorded: 1,
    missing: 0,
    invalid: 1,
    retained: 1,
    completeness: 0.5,
    knownCompleteness: 0,
  })
  assert.deepEqual(report.retainedSignals.fields.status, {
    known: 0,
    recorded: 1,
    missing: 0,
    invalid: 1,
    retained: 1,
    completeness: 0.5,
    knownCompleteness: 0,
  })
  assert.equal(report.retainedSignals.fields.organizer.invalid, 1)
  assert.equal(report.retainedSignals.fields.governmentBacking.known, 1)
  assert.equal(report.retainedSignals.fields.governmentBacking.invalid, 1)
})

test('recurrence, range, and canonical/series readiness treats one-off series IDs as not applicable', () => {
  const report = summarizeSourceHealth({
    expectedSourceFamilies: ['City calendar'],
    sourceReceipts: [{ source: 'City calendar', status: 'healthy' }],
    events: [
      completeEvent(),
      completeEvent({
        canonicalId: 'event:city:series:1',
        seriesId: 'series:city:weekly:1',
        recurrence: { kind: 'recurring', rule: 'FREQ=WEEKLY' },
        range: { semantics: 'occurrence', start: '2026-07-27T19:00:00-04:00', end: null },
      }),
    ],
  })

  assert.deepEqual(report.identity, {
    canonical: { identified: 2, unknown: 0, invalid: 0 },
    series: { identified: 1, notApplicable: 1, unknown: 0, invalid: 0 },
    recurrence: { oneOff: 1, recurring: 1, unknown: 0, invalid: 0, recurringWithRule: 1 },
    range: { normalized: 2, unknown: 0, invalid: 0 },
  })
  assert.equal(report.readiness.state, 'ready')
  assert.equal(report.readiness.rankable, true)
})

test('the summary is pure and stable for empty or non-array inputs', () => {
  const input = { expectedSourceFamilies: null, sourceReceipts: null, events: null }
  const first = summarizeSourceHealth(input)
  const second = summarizeSourceHealth(input)

  assert.deepEqual(first, second)
  assert.deepEqual(input, { expectedSourceFamilies: null, sourceReceipts: null, events: null })
  assert.equal(first.sourceHealth.status, 'unknown')
  assert.equal(first.sourceConcentration.maxShare, null)
  assert.equal(first.readiness.state, 'unknown')
  assert.deepEqual(first.readiness.blockers, ['NO_EVENTS', 'SOURCE_HEALTH_UNKNOWN', 'SOURCE_FAMILY_UNKNOWN'])
})
