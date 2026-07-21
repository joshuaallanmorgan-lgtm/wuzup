import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  buildPlanSuggestionPages,
  PLAN_SUGGESTION_REASON_CODES,
} from '../app/src/plan-suggestions.js'
import { eventTime } from '../shared/city-time.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/plan-suggestions/sprint9.v1.json', import.meta.url)))
const ids = list => list.map(value => value.item?.id || value.id)

test('planner deals deterministic balanced 3-6 suggestion pages with a lossless partition', () => {
  const first = buildPlanSuggestionPages(fixture)
  const again = buildPlanSuggestionPages(fixture)

  assert.equal(first.state, 'ready')
  assert.equal(first.contextState, 'valid')
  assert.deepEqual(first.pages.map(page => page.length), [5, 4, 4])
  assert.deepEqual(ids(first.ordered), ids(again.ordered), 'same evidence must produce the same reroll order')
  assert.equal(first.reachability.eligibleCount, 13)
  assert.equal(first.reachability.orderedCount, 13)
  assert.equal(first.reachability.exactPartition, true)
  assert.equal(first.reachability.exactAccounting, true)
  assert.deepEqual(
    new Set(ids(first.ordered)),
    new Set(ids(fixture.candidates).filter(id => id.startsWith('1')).filter(id => id !== '1000000000000006')),
  )
})

test('planned, offered, alias, canonical, series, and in-catalog duplicates are hard exclusions', () => {
  const result = buildPlanSuggestionPages(fixture)
  const excluded = Object.fromEntries(result.excluded.map(entry => [entry.item.id, entry.code]))

  assert.equal(excluded['0000000000000001'], 'planned')
  assert.equal(excluded['0000000000000002'], 'planned')
  assert.equal(excluded['0000000000000003'], 'planned')
  assert.equal(excluded['0000000000000004'], 'offered')
  assert.equal(excluded['1000000000000006'], 'duplicate')
  assert.equal(ids(result.ordered).some(id => id in excluded), false)

  const retainedRef = {
    kind: 'event',
    primary: 'e|1000000000000001',
    aliases: ['e|1000000000000001', 'old-waterfront-alias'],
    snapshot: {},
  }
  const retainedResult = buildPlanSuggestionPages({
    candidates: fixture.candidates.slice(4),
    planned: [retainedRef],
  })
  assert.equal(retainedResult.ordered.some(item => item.id === '1000000000000001'), false)
  assert.equal(retainedResult.excluded.find(entry => entry.item.id === '1000000000000001')?.code, 'planned')
})

test('reroll pages never repeat and preserve every eligible candidate exactly once', () => {
  const pages = [0, 1, 2].map(page => buildPlanSuggestionPages({ ...fixture, page }))
  assert.deepEqual(pages.map(result => result.state), ['ready', 'ready', 'ready'])
  assert.deepEqual(pages.map(result => ids(result.suggestions)), pages[0].pages.map(ids))
  const rerolled = pages.flatMap(result => ids(result.suggestions))
  assert.equal(new Set(rerolled).size, rerolled.length)
  assert.deepEqual(new Set(rerolled), new Set(ids(pages[0].ordered)))
  assert.equal(pages[1].previous.length, 5)
  assert.equal(pages[1].remainder.length, 4)
  assert.equal(pages[2].nextPage, null)
  assert.equal(buildPlanSuggestionPages({ ...fixture, page: 3 }).state, 'exhausted')
})

test('visible reason copy is bound to the exact signal that influenced the deal', () => {
  const result = buildPlanSuggestionPages(fixture)
  const byId = new Map(result.pages.flat().map(record => [record.item.id, record]))
  const outdoors = byId.get('1000000000000001')
  const art = byId.get('1000000000000002')
  const comedy = byId.get('1000000000000003')

  assert.ok(outdoors.reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.WEATHER_CLEAR))
  assert.ok(outdoors.reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.DISTANCE))
  assert.ok(outdoors.reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.FREE))
  assert.ok(art.reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.TASTE))
  assert.equal(comedy.reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.TASTE), false)
  assert.equal(comedy.reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.WEATHER_CLEAR), false)
  assert.ok(result.pages.flat().some(record => record.reasons.some(reason =>
    reason.code === PLAN_SUGGESTION_REASON_CODES.COMPLEMENT_CATEGORY
      || reason.code === PLAN_SUGGESTION_REASON_CODES.COMPLEMENT_DAYPART)))

  const noEvidence = buildPlanSuggestionPages({ ...fixture, context: null })
  for (const record of noEvidence.pages.flat()) {
    const codes = record.reasons.map(reason => reason.code)
    assert.equal(codes.includes(PLAN_SUGGESTION_REASON_CODES.WEATHER_CLEAR), false)
    assert.equal(codes.includes(PLAN_SUGGESTION_REASON_CODES.WEATHER_RAINY), false)
    assert.equal(codes.includes(PLAN_SUGGESTION_REASON_CODES.DISTANCE), false)
    assert.equal(codes.includes(PLAN_SUGGESTION_REASON_CODES.TASTE), false)
  }
})

test('corrupt optional context fails neutral without hiding valid planner inventory', () => {
  const corrupt = buildPlanSuggestionPages({
    ...fixture,
    context: {
      weather: { state: 'available', mood: 'wishful' },
      location: { state: 'available', lat: 999, lng: -82.46 },
      preferenceScores: { '1000000000000001': Infinity },
    },
  })
  assert.equal(corrupt.state, 'ready')
  assert.equal(corrupt.contextState, 'corrupt')
  assert.equal(corrupt.ordered.length, 13)
  assert.equal(corrupt.pages.flat().some(record => record.reasons.some(reason => [
    PLAN_SUGGESTION_REASON_CODES.WEATHER_CLEAR,
    PLAN_SUGGESTION_REASON_CODES.WEATHER_RAINY,
    PLAN_SUGGESTION_REASON_CODES.DISTANCE,
    PLAN_SUGGESTION_REASON_CODES.TASTE,
  ].includes(reason.code))), false)

  const hostileScores = new Proxy({}, { ownKeys() { throw new Error('hostile context') } })
  const protectedResult = buildPlanSuggestionPages({ ...fixture, context: { preferenceScores: hostileScores } })
  assert.equal(protectedResult.state, 'ready')
  assert.equal(protectedResult.contextState, 'corrupt')
  assert.equal(protectedResult.ordered.length, 13)
})

test('unverified weather and location evidence can never produce recommendation claims', () => {
  const cases = [
    {
      weather: { state: 'available', mood: 'clear', fresh: false, receipt: 'fresh-app-weather' },
    },
    {
      weather: { state: 'available', mood: 'clear', fresh: true, receipt: 'unverified-cache' },
    },
    {
      location: {
        state: 'available',
        permission: 'prompt',
        enabled: true,
        inMarket: true,
        receipt: 'provider-granted-in-market',
        lat: 27.95,
        lng: -82.46,
      },
    },
    {
      location: {
        state: 'available',
        permission: 'granted',
        enabled: true,
        inMarket: false,
        receipt: 'provider-granted-in-market',
        lat: 40.7128,
        lng: -74.006,
      },
    },
    {
      location: {
        state: 'available',
        permission: 'granted',
        enabled: true,
        inMarket: true,
        receipt: 'arbitrary-coordinates',
        lat: 27.95,
        lng: -82.46,
      },
    },
  ]

  for (const context of cases) {
    const result = buildPlanSuggestionPages({ ...fixture, context })
    assert.equal(result.state, 'ready')
    assert.equal(result.contextState, 'corrupt')
    const codes = result.pages.flat().flatMap(record => record.reasons.map(reason => reason.code))
    assert.equal(codes.includes(PLAN_SUGGESTION_REASON_CODES.WEATHER_CLEAR), false)
    assert.equal(codes.includes(PLAN_SUGGESTION_REASON_CODES.WEATHER_RAINY), false)
    assert.equal(codes.includes(PLAN_SUGGESTION_REASON_CODES.DISTANCE), false)
  }
})

test('rainy-day fit requires a trusted normalized indoor receipt, never category inference', () => {
  const base = {
    start: '2026-07-25T19:00:00-04:00',
    category: 'music',
  }
  const categoryOnly = { ...base, id: '2100000000000001', title: 'Category-only concert' }
  const unreceipted = { ...base, id: '2100000000000002', title: 'Unreceipted indoor claim', indoor: true }
  const verified = {
    ...base,
    id: '2100000000000003',
    title: 'Verified indoor concert',
    _indoorEvidence: {
      state: 'verified',
      indoor: true,
      receipt: 'normalized-indoor-setting',
    },
  }
  const result = buildPlanSuggestionPages({
    candidates: [categoryOnly, unreceipted, verified],
    context: {
      weather: {
        state: 'available',
        mood: 'rainy',
        fresh: true,
        receipt: 'fresh-app-weather',
      },
    },
  })
  const byId = new Map(result.pages.flat().map(record => [record.item.id, record]))

  assert.equal(result.ordered[0], verified, 'verified indoor evidence may influence the deal')
  assert.ok(byId.get(verified.id).reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.WEATHER_RAINY))
  assert.equal(byId.get(categoryOnly.id).reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.WEATHER_RAINY), false)
  assert.equal(byId.get(unreceipted.id).reasons.some(reason => reason.code === PLAN_SUGGESTION_REASON_CODES.WEATHER_RAINY), false)
})

test('daypart complement uses canonical city-local time across offsets and DST and fails neutral without it', () => {
  const planned = [{
    id: '2200000000000000',
    title: 'Afternoon baseline',
    category: 'music',
    _planDaypart: 'afternoon',
  }]
  const cases = [
    {
      id: '2200000000000001',
      start: '2026-07-25T13:30:00Z',
      end: '2026-07-25T15:00:00Z',
      label: 'summer UTC offset',
    },
    {
      id: '2200000000000002',
      start: '2026-11-01T17:30:00Z',
      end: '2026-11-01T18:30:00Z',
      label: 'fall-back DST offset',
    },
  ]

  for (const row of cases) {
    const candidate = {
      ...row,
      title: row.label,
      category: 'music',
    }
    candidate._time = eventTime(candidate, { timeZone: 'America/New_York' })
    const result = buildPlanSuggestionPages({ candidates: [candidate], planned })
    const complement = result.suggestions[0].reasons.find(reason =>
      reason.code === PLAN_SUGGESTION_REASON_CODES.COMPLEMENT_DAYPART)
    assert.equal(complement?.evidence.value, 'morning', row.label)
  }

  const rawOnly = {
    id: '2200000000000003',
    title: 'Raw ISO is not city-local evidence',
    category: 'music',
    start: '2026-07-25T13:30:00Z',
  }
  const rawResult = buildPlanSuggestionPages({ candidates: [rawOnly], planned })
  assert.equal(rawResult.suggestions[0].reasons.some(reason =>
    reason.code === PLAN_SUGGESTION_REASON_CODES.COMPLEMENT_DAYPART), false)
})

test('malformed inventory is atomic-neutral and sparse supply remains honest', () => {
  assert.equal(buildPlanSuggestionPages({ candidates: null }).state, 'neutral')
  assert.equal(buildPlanSuggestionPages({ candidates: [{}] }).state, 'neutral')
  assert.equal(buildPlanSuggestionPages({ candidates: fixture.candidates, planned: [null] }).state, 'neutral')
  assert.equal(buildPlanSuggestionPages({ candidates: fixture.candidates, page: -1 }).state, 'neutral')

  const hostile = {}
  Object.defineProperty(hostile, 'id', { get() { throw new Error('hostile getter') } })
  assert.doesNotThrow(() => buildPlanSuggestionPages({ candidates: [hostile] }))
  assert.equal(buildPlanSuggestionPages({ candidates: [hostile] }).state, 'neutral')

  const sparse = buildPlanSuggestionPages({ candidates: fixture.candidates.slice(4, 6) })
  assert.equal(sparse.state, 'ready')
  assert.equal(sparse.suggestions.length, 2)
  assert.equal(sparse.limited, true)
})
