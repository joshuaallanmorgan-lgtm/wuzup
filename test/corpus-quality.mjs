import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { assessCorpusQuality, assessCountPreservation } from '../shared/corpus-quality.mjs'

function row(id, overrides = {}) {
  return {
    id,
    title: `Title ${id}`,
    start: '2026-08-01T19:00:00.000Z',
    end: '2026-08-01T20:00:00.000Z',
    venue: 'Venue',
    address: '1 Main Street',
    lat: 27.95,
    lng: -82.46,
    price: 0,
    category: 'music',
    rawCategories: ['Music'],
    description: 'A complete description.',
    image: 'https://example.test/event.jpg',
    imageRank: 1,
    organizer: 'Organizer',
    status: 'scheduled',
    sources: ['City calendar'],
    ...overrides,
  }
}

test('reports multi-source concentration and retained-field completeness deterministically', () => {
  const rows = [
    row('a', { sources: ['City calendar', 'Neighborhood association'] }),
    row('b', { source: 'City calendar', sources: [], description: '  ', organizer: null, imageRank: null }),
    row('c', { sources: ['Neighborhood association'], rawCategories: [], lat: null, status: '' }),
  ]
  const report = assessCorpusQuality(rows)

  assert.deepEqual(report, assessCorpusQuality(rows))
  assert.equal(report.rowCount, 3)
  assert.deepEqual(report.sourceConcentration, {
    citedRows: 3,
    uncitedRows: 0,
    multiSourcedRows: 1,
    distinct: 2,
    counts: { 'City calendar': 2, 'Neighborhood association': 2 },
    maxCount: 2,
    maxShare: 2 / 3,
    dominant: ['City calendar', 'Neighborhood association'],
  })
  assert.deepEqual(report.decisionFieldConfidence.description, {
    present: 2,
    missing: 1,
    coverage: 2 / 3,
    meanLength: 23,
    minLength: 23,
    maxLength: 23,
  })
  assert.equal(report.decisionFieldConfidence.coordinates.coverage, 2 / 3)
  assert.equal(report.decisionFieldConfidence.rawCategories.coverage, 2 / 3)
  assert.equal(report.decisionFieldConfidence.organizer.coverage, 2 / 3)
  assert.equal(report.decisionFieldConfidence.status.coverage, 2 / 3)
  assert.equal(report.decisionFieldConfidence.imageRank.coverage, 2 / 3)
  assert.equal(report.decisionFieldConfidence.source.coverage, 1)
})

test('reports empty and unretained signals as unknown rather than inventing a quality result', () => {
  const report = assessCorpusQuality([])
  assert.equal(report.rowCount, 0)
  assert.equal(report.sourceConcentration.maxShare, null)
  assert.deepEqual(report.sourceConcentration.dominant, [])
  for (const field of Object.values(report.decisionFieldConfidence)) {
    assert.equal(field.present, 0)
    assert.equal(field.missing, 0)
    assert.equal(field.coverage, null)
  }

  const missing = assessCorpusQuality([row('a', {
    organizer: null,
    status: null,
    rawCategories: null,
    imageRank: null,
  })])
  for (const field of ['organizer', 'status', 'rawCategories', 'imageRank']) {
    assert.deepEqual(missing.decisionFieldConfidence[field], { present: 0, missing: 1, coverage: 0 })
  }
})

test('explicit free evidence counts as known price without inventing a numeric amount', () => {
  const report = assessCorpusQuality([row('free', { price: null, isFree: true })])
  assert.deepEqual(report.decisionFieldConfidence.price, { present: 1, missing: 0, coverage: 1 })
  assert.equal(report.rowCount, 1)
})

test('count preservation detects loss, substitution, and duplication', () => {
  const input = [row('a'), row('b'), row('c')]
  assert.equal(assessCountPreservation(input, [input[2], input[0], input[1]]).exactPermutation, true)
  assert.deepEqual(assessCountPreservation(input, [input[0], input[1]]), {
    inputCount: 3,
    outputCount: 2,
    missing: ['c'],
    extra: [],
    duplicated: [],
    exactPermutation: false,
  })
  assert.deepEqual(assessCountPreservation(input, [input[0], input[0], row('new')]), {
    inputCount: 3,
    outputCount: 3,
    missing: ['b', 'c'],
    extra: ['new'],
    duplicated: [{ id: 'a', count: 2 }],
    exactPermutation: false,
  })
  assert.throws(() => assessCountPreservation(input, [{ id: '  ' }]), /outputRows\[0\]\.id/)
  assert.throws(() => assessCorpusQuality([null]), /rows\[0\]/)
})

test('current city artifacts can be reported without an implicit quality floor', async () => {
  for (const cityId of ['tampa-bay', 'sf-east-bay']) {
    const path = join('finder', 'output', cityId, 'events.json')
    const rows = JSON.parse(await readFile(path, 'utf8'))
    const report = assessCorpusQuality(rows)
    assert.equal(report.rowCount, rows.length, cityId)
    assert.equal(report.sourceConcentration.citedRows + report.sourceConcentration.uncitedRows, rows.length, cityId)
    assert.equal(report.decisionFieldConfidence.source.present, report.sourceConcentration.citedRows, cityId)
    assert.equal(assessCountPreservation(rows, [...rows]).exactPermutation, true, cityId)
  }
})
