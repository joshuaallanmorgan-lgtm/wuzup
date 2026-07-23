import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { pickerModel } from '../app/src/weekend.js'
import { rankRuntimeItems } from '../app/src/relevance.js'
import { cityMidnightMs } from '../shared/city-time.mjs'

const CITY = {
  id: 'tampa-bay',
  region: 'Florida',
  tz: 'America/New_York',
  bbox: { south: 27.3, north: 28.6, west: -83.3, east: -81.9 },
}
const NOW = Date.parse('2026-07-21T12:00:00-04:00')
const DAY_TS = cityMidnightMs('2026-07-25', CITY.tz)

function event(id, overrides = {}) {
  const start = overrides.start || '2026-07-25T19:00:00-04:00'
  return {
    id,
    title: `Plan candidate ${id}`,
    start,
    end: '2026-07-25T21:00:00-04:00',
    _day: DAY_TS,
    _endDay: DAY_TS,
    _actionable: true,
    status: 'scheduled',
    category: 'music',
    venue: `Venue ${id}`,
    address: '100 Main St, Tampa, FL 33602',
    lat: 27.95,
    lng: -82.46,
    description: 'Specific local event details with enough information to make a confident plan. '.repeat(3),
    source: `Source ${id}`,
    sources: [`Source ${id}`, `Venue ${id}`],
    srcCount: 2,
    priceState: 'known',
    priceMin: 10,
    ...overrides,
  }
}

const trustedSuggestionContext = {
  weather: {
    state: 'available',
    mood: 'clear',
    fresh: true,
    receipt: 'fresh-app-weather',
  },
  location: {
    state: 'available',
    permission: 'granted',
    enabled: true,
    inMarket: true,
    receipt: 'provider-granted-in-market',
    lat: 27.95,
    lng: -82.46,
    radiusMiles: 12,
  },
}

test('slot picker keeps high-scoring noncredible rows out of the lead but reachable in browse-all', () => {
  const credible = [
    event('1111111111111111', { category: 'outdoors' }),
    event('2222222222222222', { category: 'art' }),
    event('3333333333333333', { category: 'comedy' }),
    event('4444444444444444', { category: 'food' }),
    event('5555555555555555', { category: 'family' }),
    event('6666666666666666', { category: 'theater' }),
    event('7777777777777777', { category: 'wellness' }),
  ]
  const noncredible = event('deadbeefdeadbeef', {
    title: 'Thin promoted listing',
    lowInformation: true,
    category: 'outdoors',
  })
  const nonactionable = event('cccccccccccccccc', {
    title: 'Unavailable listing',
    _actionable: false,
  })
  const items = [noncredible, nonactionable, ...credible]
  const ranking = {
    nowMs: NOW,
    city: CITY,
    taste: {},
    context: { itemScores: { deadbeefdeadbeef: 20 } },
    suggestionContext: trustedSuggestionContext,
  }
  const inspected = rankRuntimeItems(items, { kind: 'events', ...ranking })
  const weakRow = inspected.scored.find(row => row.id === noncredible.id)
  assert.equal(weakRow.leadEligible, false)
  assert.ok(weakRow.totalScore > inspected.scored.find(row => row.id === credible[0].id).totalScore)

  const model = pickerModel({
    ts: DAY_TS,
    part: 'night',
    upcoming: items,
    saved: [],
    plan: { slots: { morning: null, afternoon: null, night: null } },
    ranking,
  })
  const suggestedIds = model.suggestionPages.flat().map(record => record.item.id)
  assert.equal(suggestedIds.includes(noncredible.id), false)
  assert.equal(suggestedIds.includes(nonactionable.id), false)
  assert.ok(model.suggestionPages.every(page => page.length >= 3 && page.length <= 6))
  assert.ok(model.browseSuggestions.includes(noncredible))
  assert.ok(model.browseSuggestions.includes(nonactionable))
})

test('saved options honor full cross-day plan-family exclusions', () => {
  const planned = event('aaaaaaaaaaaaaaaa', {
    start: '2026-07-24T19:00:00-04:00',
    canonicalId: 'shared-canonical',
    seriesId: 'shared-series',
  })
  const canonicalSavedSibling = event('bbbbbbbbbbbbbbbb', { canonicalId: 'shared-canonical' })
  const seriesSavedSibling = event('dddddddddddddddd', { seriesId: 'shared-series' })
  const ordinarySaved = event('eeeeeeeeeeeeeeee')
  const ordinary = [
    event('1111111111111111'),
    event('2222222222222222'),
    event('3333333333333333'),
  ]
  const model = pickerModel({
    ts: DAY_TS,
    part: 'night',
    upcoming: ordinary,
    saved: [canonicalSavedSibling, seriesSavedSibling, ordinarySaved],
    plan: { slots: { morning: null, afternoon: null, night: null } },
    planned: [planned],
    ranking: { nowMs: NOW, city: CITY, taste: {}, context: {} },
  })
  assert.deepEqual(model.saved, [ordinarySaved])
})

test('lead dedupes plan families while browse keeps every unplanned fitting sibling reachable', () => {
  const planned = event('aaaaaaaaaaaaaaaa', {
    start: '2026-07-24T19:00:00-04:00',
    canonicalId: 'shared-canonical',
    seriesId: 'shared-series',
  })
  const canonicalSibling = event('bbbbbbbbbbbbbbbb', { canonicalId: 'shared-canonical' })
  const seriesSibling = event('dddddddddddddddd', { seriesId: 'shared-series' })
  const catalogSiblingA = event('1111111111111111', { seriesId: 'catalog-series' })
  const catalogSiblingB = event('2222222222222222', { seriesId: 'catalog-series' })
  const ordinary = event('3333333333333333')
  const upcoming = [canonicalSibling, seriesSibling, catalogSiblingA, catalogSiblingB, ordinary]
  const model = pickerModel({
    ts: DAY_TS,
    part: 'night',
    upcoming,
    saved: [],
    plan: { slots: { morning: null, afternoon: null, night: null } },
    planned: [planned],
    ranking: { nowMs: NOW, city: CITY, taste: {}, context: {} },
  })
  const suggested = model.suggestionPages.flat().map(record => record.item)
  assert.equal(suggested.includes(canonicalSibling), false)
  assert.equal(suggested.includes(seriesSibling), false)
  assert.equal(suggested.filter(item => item.seriesId === 'catalog-series').length, 1)
  assert.deepEqual(new Set(model.browseSuggestions), new Set(upcoming))
})

test('Day and picker UI expose bounded nonwrapping rerolls, full browse, and trusted reasons', async () => {
  const [day, picker] = await Promise.all([
    readFile(new URL('../app/src/DayPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/PickerSheet.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(day, /buildPlanSuggestionPages/)
  assert.match(day, /activeDays\.flatMap/)
  assert.match(day, /resolve\(ref\)\?\.item \|\| ref/)
  assert.match(day, /plannerDocument\.rev/)
  assert.match(day, /row\.leadEligible/)
  assert.match(day, /More options · \{suggestionRemaining\} left/)
  assert.match(day, /Browse every listing · \{agenda\.length\}/)
  assert.match(day, /fresh-app-weather/)
  assert.match(day, /provider-granted-in-market/)
  assert.match(day, /location\.status === 'granted'/)
  assert.match(day, /location\.inMarket === true/)
  assert.doesNotMatch(day, /%\s*\w*page|suggestionPage\s*%/)

  assert.match(picker, /suggestionPages\s*\.slice\(suggestionPage \+ 1\)/)
  assert.match(picker, /More options · \{suggestionRemaining\} left/)
  assert.match(picker, /All suggestions shown/)
  assert.match(picker, /Browse every fitting listing · \{browseSuggestions\.length\}/)
  assert.doesNotMatch(picker, /Suggested first/)
  assert.doesNotMatch(picker, /suggestionPage\s*%/)
})
