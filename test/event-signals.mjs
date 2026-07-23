import test from 'node:test'
import assert from 'node:assert/strict'

import {
  imageHostRank,
  mergeEventStatus,
  normalizeEventStatus,
  normalizeOrganizer,
  normalizeRawCategories,
  recurringSeriesId,
  visibleDescriptionLength,
} from '../finder/event-signals.mjs'

test('organizer and raw categories retain bounded source facts without stringifying false or unknown values', () => {
  assert.equal(normalizeOrganizer({ name: '  Community   Arts Council ' }), 'Community Arts Council')
  assert.equal(normalizeOrganizer(false), null)
  assert.equal(normalizeOrganizer({}), null)
  assert.deepEqual(normalizeRawCategories(['Music', { name: 'music' }, ' Arts '], false, null, undefined), ['Music', 'Arts'])
  assert.deepEqual(normalizeRawCategories([]), [])
  assert.equal(normalizeRawCategories(false, null, undefined), null)
  assert.deepEqual(normalizeRawCategories(false, null, undefined) ?? [], [])
  assert.equal(visibleDescriptionLength(null), null)
})

test('status normalization and merged precedence fail closed', () => {
  assert.equal(normalizeEventStatus('https://schema.org/EventScheduled'), 'scheduled')
  assert.equal(normalizeEventStatus('EventCancelled'), 'cancelled')
  assert.equal(normalizeEventStatus('sold out'), 'sold_out')
  for (const status of ['inactive', 'not active', 'unscheduled', 'unconfirmed']) {
    assert.equal(normalizeEventStatus(status), 'unknown')
  }
  assert.equal(normalizeEventStatus(false), 'unknown')
  assert.equal(mergeEventStatus(['scheduled', 'unknown']), 'unknown')
  assert.equal(mergeEventStatus(['scheduled', 'sold out']), 'sold_out')
  assert.equal(mergeEventStatus(['postponed', 'EventCancelled']), 'cancelled')
})

test('recurring series identity is stable, city-scoped, and omitted for incomplete identity facts', () => {
  const one = recurringSeriesId({
    cityId: 'tampa-bay',
    title: '  Caf\u00e9   Jazz Night ',
    organizer: 'Arts Council',
    sourceFamily: 'Ignored fallback',
  })
  const two = recurringSeriesId({
    cityId: 'tampa-bay',
    title: 'cafe jazz night',
    organizer: 'arts council',
  })
  assert.equal(one, two)
  assert.notEqual(one, recurringSeriesId({ cityId: 'sf-east-bay', title: 'cafe jazz night', organizer: 'arts council' }))
  assert.equal(recurringSeriesId({ cityId: 'tampa-bay', title: 'cafe jazz night' }), null)
})

test('image-host ranking keeps the existing numeric selection contract', () => {
  assert.equal(imageHostRank(null), -1)
  assert.equal(imageHostRank('https://visitstpeteclearwater.com/poster.jpg'), -1)
  assert.equal(imageHostRank('https://images.allevents.in/banner.jpg'), 0)
  assert.equal(imageHostRank('not a url'), 0)
  assert.equal(imageHostRank('https://cdn.example.test/poster.jpg'), 1)
  assert.equal(imageHostRank('https://assets.eventbrite.com/poster.jpg'), 2)
})

test('retained evidence fields have a compact serialized budget', () => {
  const organizer = normalizeOrganizer('x'.repeat(500))
  const rawCategories = normalizeRawCategories(Array.from({ length: 30 }, (_, index) => `category-${index}-${'x'.repeat(100)}`))
  const payload = {
    organizer,
    status: mergeEventStatus(['scheduled']),
    rawCategories,
    descriptionLength: visibleDescriptionLength('described'),
    imageRank: imageHostRank('https://assets.eventbrite.com/poster.jpg'),
    sourceFamily: 'Eventbrite',
    sourceFamilies: ['Eventbrite', 'City calendar'],
    actionability: true,
    canonicalId: '0123456789abcdef',
    seriesId: recurringSeriesId({ cityId: 'tampa-bay', title: 'Weekly event', sourceFamily: 'Eventbrite' }),
    recurrence: { kind: 'recurring' },
    range: { semantics: 'single', start: '2026-07-20T19:00:00-04:00', end: null },
  }
  assert.equal(organizer.length, 160)
  assert.equal(rawCategories.length, 12)
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 2048)
})
