import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPersonalPreferences,
  normalizePersonalProfile,
  personalScoreFor,
  PERSONAL_SCORE_LIMIT,
} from '../app/src/personal-relevance.js'
import {
  getProfile,
  recordCalibration,
  recordSignal,
  resetTaste,
  tasteSummary,
  topCategories,
  whyReasons,
} from '../app/src/taste.js'

function profile(overrides = {}) {
  return {
    v: 1,
    catScores: {},
    avoidScores: {},
    freeAffinity: 0,
    n: 40,
    organicN: 40,
    explore: 0.5,
    _interview: null,
    _primer: null,
    prefs: { boost: [], mute: [], when: null },
    ...overrides,
    prefs: { boost: [], mute: [], when: null, ...(overrides.prefs || {}) },
  }
}

test('strict profile normalization fails atomically to neutral', () => {
  const cases = [
    [null, 'absent'],
    ['not-an-object', 'corrupt'],
    [{ v: 2, catScores: {}, freeAffinity: 0, n: 0, prefs: {} }, 'wrong-version'],
    [profile({ catScores: { music: Number.NaN } }), 'corrupt'],
    [profile({ organicN: 41 }), 'corrupt'],
    [profile({ prefs: { boost: ['music'], mute: ['music'] } }), 'corrupt'],
    [JSON.parse('{"v":1,"catScores":{"__proto__":10},"avoidScores":{},"freeAffinity":0,"n":1,"organicN":1,"prefs":{"boost":[],"mute":[],"when":null}}'), 'corrupt'],
    [profile({ catScores: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`cat-${index}`, 1])) }), 'corrupt'],
    [profile({ prefs: { boost: Array.from({ length: 33 }, (_, index) => `cat-${index}`) } }), 'corrupt'],
  ]
  for (const [input, reason] of cases) {
    const normalized = normalizePersonalProfile(input)
    assert.equal(normalized.state, 'neutral')
    assert.equal(normalized.reason, reason)
    assert.deepEqual(normalized.categoryScores, {})
    assert.deepEqual(normalized.avoidScores, {})
  }
})

test('normalization copies and freezes validated profile evidence', () => {
  const input = profile({ catScores: { Music: 25 }, avoidScores: { art: 4 } })
  const normalized = normalizePersonalProfile(input)
  input.catScores.Music = 1
  input.avoidScores.art = 20
  assert.equal(normalized.state, 'valid')
  assert.equal(normalized.categoryScores.music, 25)
  assert.equal(normalized.avoidScores.art, 4)
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.categoryScores), true)
})

test('event preference is signed, bounded, and explicit mute remains reachable math', () => {
  const positive = profile({ catScores: { music: 25 }, prefs: { boost: ['music'] } })
  const negative = profile({ avoidScores: { music: 25 } })
  const muted = profile({ catScores: { music: 25 }, prefs: { mute: ['music'] } })
  const event = { id: 'event-music', category: 'music', isFree: false }

  assert.equal(personalScoreFor(event, { kind: 'events', profile: positive }), 12)
  assert.equal(personalScoreFor(event, { kind: 'events', profile: negative }), -6)
  assert.equal(personalScoreFor(event, { kind: 'events', profile: muted }), -12)
  for (const value of [positive, negative, muted]) {
    const score = personalScoreFor(event, { kind: 'events', profile: value })
    assert.ok(score >= -PERSONAL_SCORE_LIMIT && score <= PERSONAL_SCORE_LIMIT)
  }
})

test('place preference reads category, place type, class, activity, and amenity evidence', () => {
  const taste = profile({
    catScores: { outdoors: 25, 'place:garden': 25, 'activity:picnic': 25 },
    avoidScores: { 'activity:tennis': 25 },
  })
  const places = [
    { id: 'garden', category: 'outdoors', placeType: 'garden', amenities: ['picnic'] },
    { id: 'court', category: 'sports', classes: ['courts'], activityIds: ['tennis'] },
  ]
  const preferences = buildPersonalPreferences(taste, { kind: 'places', items: places })

  assert.equal(preferences.itemScores.garden, 12)
  assert.equal(preferences.itemScores.court, -6)
  assert.deepEqual(preferences.categoryScores, {})
  assert.equal(preferences.profileState, 'valid')
})

test('Taste Profile transparency uses the same signed category evidence as live relevance', () => {
  const mixed = profile({
    catScores: { art: 10, music: 9, food: 3 },
    avoidScores: { art: 2, music: 12, food: 3 },
  })
  assert.ok(personalScoreFor({ id: 'art', category: 'art' }, { kind: 'events', profile: mixed }) > 0)
  assert.ok(personalScoreFor({ id: 'music', category: 'music' }, { kind: 'events', profile: mixed }) < 0)
  assert.deepEqual(topCategories(mixed, 4), ['art'])

  const summary = tasteSummary(mixed, { k: 4 })
  assert.deepEqual(summary.leans, [{ id: 'art', score: 8, weight: 1 }])
  assert.deepEqual(summary.lowers, [{ id: 'music', score: -3, weight: 1 }])
  assert.equal(summary.leans.some(row => row.id === 'music' || row.id === 'food'), false)
  assert.equal(whyReasons({ category: 'music' }, mixed).some(reason => reason.includes('Your taps lean')), false)

  const explicitlyMuted = profile({
    catScores: { art: 25 },
    prefs: { mute: ['art'] },
  })
  assert.deepEqual(topCategories(explicitlyMuted, 4), [])
  assert.deepEqual(tasteSummary(explicitlyMuted).leans, [])
  assert.deepEqual(tasteSummary(explicitlyMuted).mute, ['art'])
})

test('taste mutations return exact durability receipts without mutating caller evidence', () => {
  resetTaste()
  const categories = ['music', 'art']
  const fmn = recordSignal('fmn', { categories })
  assert.deepEqual(categories, ['music', 'art'])
  assert.deepEqual(fmn, {
    applied: true,
    changed: true,
    persisted: false,
    durability: 'session-only',
    code: 'recorded',
  })

  const before = JSON.stringify(getProfile())
  assert.deepEqual(recordSignal('plan', { title: 'Sparse row' }), {
    applied: false,
    changed: false,
    persisted: false,
    durability: 'unchanged',
    code: 'no-ranking-evidence',
  })
  assert.equal(JSON.stringify(getProfile()), before)

  const plan = recordSignal('plan', {
    category: 'outdoors',
    placeType: 'garden',
    activity: 'picnic',
  })
  assert.equal(plan.applied, true)
  assert.ok(getProfile().catScores.outdoors > 0)
  assert.ok(getProfile().catScores['place:garden'] > 0)
  assert.ok(getProfile().catScores['activity:picnic'] > 0)
})

test('repeated deck No creates bounded learned-negative evidence and never filters', () => {
  resetTaste()
  const place = { id: 'p|garden', category: 'outdoors', placeType: 'garden', activity: 'picnic' }
  for (let index = 0; index < 12; index += 1) {
    const receipt = recordCalibration('no', place)
    assert.equal(receipt.applied, true)
  }
  const learned = buildPersonalPreferences(getProfile(), { kind: 'places', items: [place] })
  assert.ok(learned.itemScores[place.id] < 0)
  assert.ok(learned.itemScores[place.id] >= -PERSONAL_SCORE_LIMIT)

  const beforeAvoid = { ...getProfile().avoidScores }
  const yes = recordCalibration('yes', place)
  assert.equal(yes.changed, true)
  assert.ok(getProfile().avoidScores.outdoors < beforeAvoid.outdoors)
})
