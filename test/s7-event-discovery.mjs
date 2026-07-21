import assert from 'node:assert/strict'
import test from 'node:test'

import { curateFeed, seriesKey } from '../app/src/curate.js'
import {
  dealDeck,
  dealPlaceDeck,
  deckKeyOf,
  nextEventsBatch,
  nextPlacesBatch,
} from '../app/src/deckdeal.js'
import { dealLens } from '../app/src/lensdeal.js'
import { rankRuntimeItems } from '../app/src/relevance.js'

const NOW_MS = Date.parse('2026-07-21T16:00:00Z')
const TODAY_TS = Date.parse('2026-07-21T04:00:00Z')
const TOMORROW_TS = Date.parse('2026-07-22T04:00:00Z')
const ANCHORS = {
  nowMs: NOW_MS,
  todayTs: TODAY_TS,
  tomorrowTs: TOMORROW_TS,
}
const CITY = {
  id: 'tampa-bay',
  tz: 'America/New_York',
  region: 'Florida',
  regionCode: 'FL',
  bbox: { south: 27.3, north: 28.6, west: -83.3, east: -81.9 },
}

function event(id, {
  day = TODAY_TS,
  hour = 18,
  category = 'music',
  source = `Source ${id}`,
  venue = `Venue ${id}`,
  canonicalId = `canonical-${id}`,
  seriesId = `series-${id}`,
  sponsored = false,
} = {}) {
  const date = day === TODAY_TS ? '2026-07-21' : '2026-07-22'
  const start = `${date}T${String(hour).padStart(2, '0')}:00:00-04:00`
  const end = `${date}T${String(hour + 1).padStart(2, '0')}:00:00-04:00`
  return {
    id,
    title: `Event ${id}`,
    start,
    end,
    status: 'scheduled',
    _day: day,
    _endDay: day,
    _t: Date.parse(start),
    _free: true,
    isFree: true,
    source,
    sourceFamily: source,
    sources: [source],
    sourceFamilies: [source],
    category,
    venue,
    venueId: venue.toLowerCase().replaceAll(' ', '-'),
    address: '100 Water Street, Tampa, FL 33602',
    lat: 27.95,
    lng: -82.46,
    description: `A decision-ready local event with a confirmed time, place, organizer, and useful details for ${id}.`.repeat(2),
    organizer: `Organizer ${id}`,
    canonicalId,
    seriesId,
    marketId: CITY.id,
    sponsored,
  }
}

function place(id, {
  category = 'outdoors',
  placeType = 'park',
  source = `Place source ${id}`,
} = {}) {
  return {
    id,
    key: id,
    kind: 'place',
    title: `Place ${id}`,
    name: `Place ${id}`,
    category,
    placeType,
    source,
    sourceFamily: source,
    sources: [source],
    sourceFamilies: [source],
    canonicalId: `canonical-${id}`,
    venueId: `operator-${id}`,
    address: '100 Water Street, Tampa, FL 33602',
    lat: 27.95,
    lng: -82.46,
    description: `A well-described local place with useful activity and amenity evidence for ${id}.`.repeat(2),
    marketId: CITY.id,
  }
}

function ids(items) {
  return items.map(item => item.id).sort()
}

test('curation is a bounded shared-ranked prefix and full preserves every series instance', () => {
  const recurringFirst = event('story-1', {
    category: 'family',
    source: 'Library',
    seriesId: 'story-time',
  })
  const recurringNext = event('story-2', {
    day: TOMORROW_TS,
    category: 'family',
    source: 'Library',
    seriesId: 'story-time',
  })
  const input = [
    recurringFirst,
    event('concert', { source: 'Venue calendar', category: 'music' }),
    event('market', { day: TOMORROW_TS, source: 'Market guild', category: 'market' }),
    recurringNext,
    event('gallery', { day: TOMORROW_TS, source: 'Museum', category: 'art' }),
  ]
  const feed = curateFeed(input, {
    dayOf: item => item._day,
    labelOf: dayTs => ({ dayTs, label: String(dayTs) }),
    order: items => rankRuntimeItems(items, {
      kind: 'events',
      nowMs: NOW_MS,
      city: CITY,
      diversityPolicy: {
        prefix: Math.min(3, items.length),
        sourceMax: 1,
        categoryMax: 1,
        venueMax: 1,
        canonicalMax: 1,
        seriesMax: 1,
      },
    }).ordered,
    curatedLimit: 2,
  })

  assert.equal(feed.fullEventCount, input.length)
  assert.equal(feed.fullCount, 4, 'two recurrence instances collapse into one of four cards')
  assert.equal(feed.curatedCount, 2, 'the lead is the configured prefix, not an admission gate')

  const fullGroups = feed.full.flatMap(section => section.items)
  const leadGroups = feed.curated.flatMap(section => section.items)
  const fullGroupIds = new Set(fullGroups.map(group => group.id))
  assert.ok(leadGroups.every(group => fullGroupIds.has(group.id)), 'curated is a subset of full')

  const reached = fullGroups.flatMap(group => group._series)
  assert.deepEqual(ids(reached), ids(input), 'See all reaches each input instance exactly once')
  assert.equal(new Set(reached.map(item => item.id)).size, input.length)
  assert.deepEqual(
    fullGroups.find(group => group.seriesId === 'story-time')._series.map(item => item.id),
    ['story-1', 'story-2'],
  )

  const untitled = { id: 'stable-untitled', title: '', start: '2026-07-21', venue: 'Somewhere' }
  assert.equal(seriesKey(untitled), seriesKey({ ...untitled }), 'untitled grouping has no random fallback')
})

test('lens ordering diversifies the lead while preserving source/category/canonical reachability', () => {
  const candidates = [
    event('a', { source: 'Source A', category: 'music', venue: 'Venue A', canonicalId: 'shared' }),
    event('b', { source: 'Source A', category: 'music', venue: 'Venue B', canonicalId: 'shared' }),
    event('c', { source: 'Source C', category: 'food', venue: 'Venue C' }),
    event('d', { source: 'Source D', category: 'art', venue: 'Venue D' }),
    event('e', { source: 'Source E', category: 'sports', venue: 'Venue E' }),
  ]
  const lens = { kind: 'bubble', bubble: { id: 'near', kind: 'sort', value: 'near' } }
  const ordered = dealLens(candidates, ANCHORS, lens, {
    n: 10,
    prefs: { boost: ['food'], mute: ['music'] },
  })

  assert.deepEqual(ids(ordered), ids(candidates), 'taste and diversity only reorder; they never hide')
  const lead = ordered.slice(0, 4)
  assert.equal(new Set(lead.map(item => item.sourceFamily)).size, 4, 'source-diverse supply leads')
  assert.equal(new Set(lead.map(item => item.category)).size, 4, 'category-diverse supply leads')
  assert.equal(new Set(lead.map(item => item.canonicalId)).size, 4, 'canonical duplicates cannot consume the lead')
  assert.equal(ordered.at(-1).canonicalId, 'shared', 'the duplicate remains reachable after the lead')
})

test('event deals cumulatively reach every eligible event without sponsored or retained leakage', () => {
  const categories = ['music', 'food', 'outdoors', 'sports', 'art', 'comedy']
  const catalog = Array.from({ length: 26 }, (_, index) => event(`deck-${index}`, {
    category: categories[index % categories.length],
    source: `Deck source ${index % 9}`,
    venue: `Deck venue ${index}`,
  }))
  catalog[24].sponsored = true
  const retainedId = catalog[25].id
  const excludeItem = item => item.id === retainedId
  const eligible = catalog.filter(item => !item.sponsored && !excludeItem(item))

  const first = dealDeck(catalog, ANCHORS, {
    size: 5,
    rng: () => 0,
    nowMs: NOW_MS,
    city: CITY,
    excludeItem,
  })
  assert.equal(first.length, 5)
  assert.ok(first.every(item => !item.sponsored && item.id !== retainedId))

  const seen = new Set()
  const served = new Set()
  const bound = Math.ceil(eligible.length / 5)
  for (let deal = 0; deal < bound && served.size < eligible.length; deal += 1) {
    const batch = nextEventsBatch(catalog, ANCHORS, seen, {
      size: 5,
      rng: () => 0,
      nowMs: NOW_MS,
      city: CITY,
      excludeItem,
    })
    assert.ok(batch.length > 0)
    assert.ok(batch.every(item => !item.sponsored && item.id !== retainedId))
    for (const item of batch) served.add(item.id)
  }
  assert.deepEqual([...served].sort(), ids(eligible), 'the cumulative walk reaches the complete eligible catalog')
})

test('place deals use the shared ranker and retain cumulative catalog coverage', () => {
  const catalog = [
    place('park-a', { placeType: 'park', source: 'Parks department' }),
    place('trail-a', { placeType: 'trail', source: 'Trails group' }),
    place('cafe-a', { category: 'food', placeType: 'cafe', source: 'Cafe guide' }),
    place('beach-a', { placeType: 'beach', source: 'County beaches' }),
    place('garden-a', { placeType: 'garden', source: 'Garden society' }),
  ]

  assert.deepEqual(dealPlaceDeck([], { nowMs: NOW_MS, city: CITY }), [])
  const first = dealPlaceDeck(catalog, {
    size: catalog.length,
    rng: () => 0,
    nowMs: NOW_MS,
    city: CITY,
  })
  assert.deepEqual(ids(first), ids(catalog))

  const seen = new Set()
  const served = new Set()
  for (let deal = 0; deal < 3 && served.size < catalog.length; deal += 1) {
    const batch = nextPlacesBatch(catalog, seen, {
      size: 2,
      rng: () => 0,
      nowMs: NOW_MS,
      city: CITY,
    })
    for (const item of batch) served.add(deckKeyOf(item))
  }
  assert.deepEqual([...served].sort(), catalog.map(deckKeyOf).sort())
})
