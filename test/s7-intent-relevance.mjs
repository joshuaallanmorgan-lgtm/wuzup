import test from 'node:test'
import assert from 'node:assert/strict'

import { makeAnchors, keyOf } from '../app/src/lib.js'
import { searchEvents, searchPlaces } from '../app/src/search.js'
import { resolveGuide } from '../app/src/guides.js'
import { rankRuntimeItems, runtimeRankingId } from '../app/src/relevance.js'
import { pickerModel, whyFits } from '../app/src/weekend.js'
import { cityMidnightMs } from '../shared/city-time.mjs'

const CITY = {
  id: 'tampa-bay',
  region: 'Florida',
  tz: 'America/New_York',
  bbox: { south: 27.3, north: 28.6, west: -83.3, east: -81.9 },
}
const NOW = Date.parse('2026-07-21T17:00:00-04:00')
const ANCHORS = makeAnchors(NOW)

function event(id, overrides = {}) {
  const start = overrides.start || '2026-07-21T20:00:00-04:00'
  const day = cityMidnightMs(start.slice(0, 10), CITY.tz)
  return {
    id,
    title: `Music event ${id}`,
    start,
    end: overrides.end || start.replace('20:00', '22:00'),
    _day: day,
    _endDay: day,
    _t: Date.parse(start),
    _free: false,
    _actionable: true,
    venue: `Venue ${id}`,
    address: '100 Main St, Tampa, FL 33602',
    lat: 27.95,
    lng: -82.46,
    description: 'A specific local event with enough useful detail to make a confident plan for the day. '.repeat(2),
    source: `Source ${id}`,
    sources: [`Source ${id}`],
    category: 'music',
    status: 'scheduled',
    url: `https://events.example.test/${id}`,
    ...overrides,
  }
}

function place(id, overrides = {}) {
  return {
    key: `p|${id}`,
    kind: 'place',
    name: `${id} Park`,
    title: `${id} Park`,
    placeType: 'park',
    category: 'outdoors',
    address: '100 Main St, Tampa, FL 33602',
    lat: 27.95,
    lng: -82.46,
    description: 'A public park with specific visitor details, trails, and useful local context.',
    source: `Source ${id}`,
    sources: [`Source ${id}`],
    srcCount: 1,
    ...overrides,
  }
}

const rankOptions = { nowMs: NOW, city: CITY, taste: {} }

test('id-less custom events receive caller context under their projected runtime identity', () => {
  const custom = event(undefined, {
    kind: 'custom',
    localId: 'custom_context_1',
    title: 'Added music event',
    source: 'Added by you',
    sources: ['Added by you'],
  })
  delete custom.id
  const other = event('other')
  const customId = runtimeRankingId(custom)
  const result = rankRuntimeItems([other, custom], {
    ...rankOptions,
    kind: 'events',
    context: { itemScores: { [customId]: 20 } },
  })

  assert.equal(customId, 'c|custom_context_1')
  assert.equal(result.scored.find(row => row.id === customId).contextScore, 20)
  assert.equal(result.ordered[0], custom)
})

test('Search preserves exact lexical and date membership before shared relevance ordering', () => {
  const credible = event('credible', { sources: ['City Calendar', 'Venue Calendar'], srcCount: 2 })
  const weak = event('weak', {
    hotScore: 999,
    venue: null,
    address: null,
    lat: null,
    lng: null,
    description: '',
  })
  const miss = event('miss', { title: 'Painting workshop', category: 'art' })
  const input = [weak, miss, credible]
  const before = [...input]

  const lexical = searchEvents(input, ANCHORS, 'music')
  const ranked = searchEvents(input, ANCHORS, 'music', rankOptions)
  assert.deepEqual(ranked.map((item) => item.id).sort(), lexical.map((item) => item.id).sort())
  assert.deepEqual(ranked.map((item) => item.id).sort(), ['credible', 'weak'])
  assert.equal(ranked[0], credible)

  const dateMatches = searchEvents(input, ANCHORS, 'tonight')
  const rankedDate = searchEvents(input, ANCHORS, 'tonight', rankOptions)
  assert.deepEqual(rankedDate.map((item) => item.id).sort(), dateMatches.map((item) => item.id).sort())
  assert.deepEqual(input, before, 'search ranking must not mutate the source list')
})

test('Search place results keep exact matches and original object identity', () => {
  const weak = place('weak', { lat: null, lng: null, address: null, description: '', srcCount: 9 })
  const credible = place('credible', { sources: ['OSM', 'City Parks'], srcCount: 2 })
  const miss = place('museum', {
    name: 'City Museum',
    title: 'City Museum',
    placeType: 'museum',
    category: 'art',
    description: 'Rotating exhibitions and visitor information.',
  })

  const lexical = searchPlaces([weak, miss, credible], ANCHORS, 'park')
  const ranked = searchPlaces([weak, miss, credible], ANCHORS, 'park', rankOptions)
  assert.deepEqual(ranked.map((item) => item.key).sort(), lexical.map((item) => item.key).sort())
  assert.deepEqual(ranked.map((item) => item.key).sort(), ['p|credible', 'p|weak'])
  assert.equal(ranked[0], credible)
})

test('Guide resolution remains a count-preserving collection and ranks only inside it', () => {
  const weak = event('guide-weak', { lat: null, lng: null, address: null, description: '', hotScore: 1000 })
  const credible = event('guide-credible', { sources: ['City Calendar', 'Venue Calendar'], srcCount: 2 })
  const outside = event('outside', { category: 'art' })
  const guide = {
    id: 'music-only',
    select: ({ events }) => events.filter((item) => item.category === 'music'),
  }

  const plain = resolveGuide(guide, { events: [weak, outside, credible] })
  const ranked = resolveGuide(guide, { events: [weak, outside, credible] }, rankOptions)
  assert.deepEqual(ranked.map((item) => item.id).sort(), plain.map((item) => item.id).sort())
  assert.deepEqual(ranked.map((item) => item.id).sort(), ['guide-credible', 'guide-weak'])
  assert.equal(ranked[0], credible)
})

test('Plan picker preserves daypart and user exclusions, de-duplicates, then ranks suggestions', () => {
  const ts = cityMidnightMs('2026-07-25', CITY.tz)
  const saved = event('saved', { start: '2026-07-25T19:00:00-04:00' })
  const slotted = event('slotted', { start: '2026-07-25T20:00:00-04:00' })
  const weak = event('plan-weak', {
    start: '2026-07-25T21:00:00-04:00',
    lat: null,
    lng: null,
    address: null,
    description: '',
    hotScore: 1000,
  })
  const credible = event('plan-credible', {
    start: '2026-07-25T18:00:00-04:00',
    sources: ['City Calendar', 'Venue Calendar'],
    srcCount: 2,
  })
  const duplicate = { ...credible, id: 'plan-credible-copy' }
  const morning = event('morning', { start: '2026-07-25T09:00:00-04:00' })
  const plan = { slots: { morning: null, afternoon: null, night: keyOf(slotted) } }

  const model = pickerModel({
    ts,
    part: 'night',
    upcoming: [saved, slotted, weak, credible, duplicate, morning],
    saved: [saved],
    plan,
    nudge: () => 0,
    ranking: {
      ...rankOptions,
      context: { itemScores: { 'plan-credible': 6, 'plan-credible-copy': 6 } },
    },
  })

  assert.deepEqual(model.saved, [saved])
  assert.equal(model.suggestions[0], credible)
  assert.equal(model.suggestions.some((item) => keyOf(item) === keyOf(saved)), false)
  assert.equal(model.suggestions.some((item) => keyOf(item) === keyOf(slotted)), false)
  assert.equal(model.suggestions.some((item) => item.id === 'morning'), false)
  assert.equal(new Set(model.suggestions.map(keyOf)).size, model.suggestions.length)
})

test('Plan weather reasons require an explicit weather ranking contribution', () => {
  const clear = { emoji: '☀️', rain: 10 }
  const outdoor = { category: 'outdoors', isFree: true }
  assert.equal(
    whyFits(outdoor, { w: clear, weatherContributed: false }),
    'Free',
    'weather copy must not appear when weather did not score the item',
  )
  assert.match(
    whyFits(outdoor, { w: clear, weatherContributed: true }),
    /Clear/,
    'weather copy may appear when the same signal contributed to ranking',
  )
})
