import assert from 'node:assert/strict'
import test from 'node:test'

import { selectCalibrationCandidates } from '../app/src/feedback-transparency.js'

const NOW = Date.parse('2026-07-21T18:00:00-04:00')
const CITY = {
  id: 'tampa-bay',
  region: 'Florida',
  regionCode: 'FL',
  tz: 'America/New_York',
  bbox: { south: 27.3, north: 28.6, west: -83.3, east: -81.9 },
}

function event(id, overrides = {}) {
  return {
    id,
    title: `Event ${id}`,
    start: '2026-07-21T20:00:00-04:00',
    end: '2026-07-21T22:00:00-04:00',
    status: 'scheduled',
    category: id.startsWith('strong') ? 'music' : 'other',
    source: `Source ${id}`,
    sources: [`Source ${id}`],
    venue: `Venue ${id}`,
    address: '100 Main St, Tampa, FL 33602',
    lat: 27.95,
    lng: -82.46,
    organizer: `Organizer ${id}`,
    description: 'Specific local details with enough information to decide whether this event fits the evening.'.repeat(2),
    marketId: CITY.id,
    ...overrides,
  }
}

test('calibration solicits credible/actionable rows while browse remains lossless', () => {
  const strong = Array.from({ length: 5 }, (_, index) => event(`strong-${index}`))
  const weak = Array.from({ length: 4 }, (_, index) => event(`weak-${index}`, {
    address: null,
    lat: null,
    lng: null,
    marketId: null,
    description: '',
    lowInformation: true,
  }))
  const input = [...weak, ...strong]
  const result = selectCalibrationCandidates(input, {
    kind: 'events', nowMs: NOW, city: CITY, minimum: 3,
  })

  assert.equal(result.preferredCount, strong.length)
  assert.deepEqual(result.candidates.map((item) => item.id).sort(), strong.map((item) => item.id).sort())
  assert.deepEqual(result.browse, input)
  assert.ok(result.browse.every((item, index) => item === input[index]))
})

test('scarce credible supply uses only enough fallback to make a useful deal', () => {
  const strong = event('strong-one')
  const weak = Array.from({ length: 6 }, (_, index) => event(`weak-${index}`, {
    description: '',
    lowInformation: true,
  }))
  const input = [strong, ...weak]
  const result = selectCalibrationCandidates(input, {
    kind: 'events', nowMs: NOW, city: CITY, minimum: 4,
  })
  assert.equal(result.preferredCount, 1)
  assert.equal(result.candidates.length, 4)
  assert.equal(result.fallbackCount, 3)
  assert.equal(result.browse.length, input.length)
  assert.ok(result.candidates.includes(strong))
})
