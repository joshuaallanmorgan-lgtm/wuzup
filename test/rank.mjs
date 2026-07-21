import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RANK_EVIDENCE_TIERS,
  RANK_REASON_CODES,
  rankItems,
  selectFirstScreen,
} from '../shared/rank.mjs'

function item(id, overrides = {}) {
  return {
    id,
    sourceFamily: `source-${id}`,
    category: `category-${id}`,
    venueId: `venue-${id}`,
    canonicalId: `canonical-${id}`,
    seriesId: null,
    actionability: true,
    decisionEligible: true,
    qualityFloor: { blockerCodes: [], demotionCodes: [] },
    start: '2026-07-21T19:00:00-04:00',
    address: 'Tampa, FL',
    descriptionLength: 180,
    ...overrides,
  }
}

function rank(items, overrides = {}) {
  return rankItems(items, { kind: 'events', ...overrides })
}

test('rankItems is an exact count-preserving permutation and never mutates inputs', () => {
  const items = [item('c'), item('a'), item('b')]
  const snapshot = structuredClone(items)
  const result = rank(items)
  assert.deepEqual(items, snapshot)
  assert.deepEqual(result.ordered.map(row => row.id), ['a', 'b', 'c'])
  assert.deepEqual(result.scored.map(row => row.id), ['a', 'b', 'c'])
  assert.deepEqual(result.reachability, { inputCount: 3, outputCount: 3, exactPermutation: true })
})

test('stable ID tie-breaking makes rank independent of input order', () => {
  const forward = [item('alpha'), item('beta'), item('gamma')]
  const reverse = [...forward].reverse()
  assert.deepEqual(rank(forward).ordered.map(row => row.id), rank(reverse).ordered.map(row => row.id))
})

test('objective blockers and non-actionable rows remain reachable but never leak into the lead', () => {
  const rows = [
    item('blocked', {
      decisionEligible: false,
      qualityFloor: { blockerCodes: ['EVENT_CANCELLED'], demotionCodes: [] },
    }),
    item('unknown-action', { actionability: null }),
    item('good'),
  ]
  const result = rank(rows, {
    context: { itemScores: { blocked: 20, 'unknown-action': 20 } },
    preferences: { itemScores: { blocked: 12 } },
  })
  const first = selectFirstScreen(result)
  assert.deepEqual(first.selected.map(row => row.id), ['good'])
  assert.equal(first.limited, true)
  assert.deepEqual(first.ordered.map(row => row.id).sort(), ['blocked', 'good', 'unknown-action'])
  assert.equal(first.reachability.exactPermutation, true)
  assert.ok(result.scored.find(row => row.id === 'blocked').reasons.includes(RANK_REASON_CODES.OBJECTIVE_BLOCKED))
})

test('unassessed quality fails closed for lead placement while preserving browse reachability', () => {
  const unassessed = item('unassessed')
  delete unassessed.decisionEligible
  delete unassessed.qualityFloor
  const result = rank([unassessed])
  const first = selectFirstScreen(result)
  assert.equal(first.selected.length, 0)
  assert.equal(first.remainder[0], unassessed)
  assert.ok(result.scored[0].reasons.includes(RANK_REASON_CODES.QUALITY_UNASSESSED))
  const bare = item('bare-assertion')
  delete bare.qualityFloor
  assert.equal(selectFirstScreen(rank([bare])).selected.length, 0)
})

test('qualityPolicy can provide objective eligibility without mutating returned inventory', () => {
  const rows = [
    item('inside', { lat: 27.95, lng: -82.46 }),
    item('outside', { lat: 40.7, lng: -74 }),
  ].map(row => {
    const copy = { ...row }
    delete copy.decisionEligible
    delete copy.qualityFloor
    return copy
  })
  const result = rank(rows, {
    qualityPolicy: {
      nowMs: Date.parse('2026-07-21T16:00:00Z'),
      timeZone: 'America/New_York',
      market: {
        id: 'tampa-bay',
        bbox: { latMin: 27, latMax: 29, lngMin: -83, lngMax: -82 },
        regionCodes: ['FL'],
      },
    },
  })
  const first = selectFirstScreen(result)
  assert.deepEqual(first.selected.map(row => row.id), ['inside'])
  assert.deepEqual(Object.keys(rows[0]).includes('qualityFloor'), false)
  assert.deepEqual(result.ordered.map(row => row.id).sort(), ['inside', 'outside'])
})

test('first-screen source, category, and venue diversity is used where supply permits', () => {
  const rows = [
    item('a1', { sourceFamily: 'A', category: 'music', venueId: 'arena', descriptionLength: 400 }),
    item('a2', { sourceFamily: 'A', category: 'music', venueId: 'arena', descriptionLength: 300 }),
    item('b1', { sourceFamily: 'B', category: 'art', venueId: 'museum' }),
    item('c1', { sourceFamily: 'C', category: 'food', venueId: 'market' }),
  ]
  const first = selectFirstScreen(rank(rows), { limit: 3 })
  assert.deepEqual(first.selected.map(row => row.id), ['a1', 'b1', 'c1'])
  assert.equal(first.limited, false)
  assert.deepEqual(first.remainder.map(row => row.id), ['a2'])
})

test('ordinary diversity constraints relax to fill a credible screen when supply is narrow', () => {
  const rows = [
    item('a', { sourceFamily: 'only-source', category: 'music' }),
    item('b', { sourceFamily: 'only-source', category: 'music' }),
    item('c', { sourceFamily: 'only-source', category: 'music' }),
  ]
  const first = selectFirstScreen(rank(rows), { limit: 3 })
  assert.deepEqual(first.selected.map(row => row.id), ['a', 'b', 'c'])
  assert.equal(first.limited, false)
})

test('an infeasible source cap does not discard feasible category and venue diversity', () => {
  const rows = [
    item('a', { sourceFamily: 'only-source', category: 'music', venueId: 'venue-1', descriptionLength: 400 }),
    item('b', { sourceFamily: 'only-source', category: 'music', venueId: 'venue-1', descriptionLength: 300 }),
    item('c', { sourceFamily: 'only-source', category: 'art', venueId: 'venue-2' }),
    item('d', { sourceFamily: 'only-source', category: 'food', venueId: 'venue-3' }),
  ]
  const first = selectFirstScreen(rank(rows), { limit: 3 })
  assert.deepEqual(first.selected.map(row => row.id), ['a', 'c', 'd'])
  assert.equal(new Set(first.selected.map(row => row.category)).size, 3)
  assert.equal(new Set(first.selected.map(row => row.venueId)).size, 3)
  assert.equal(first.reachability.exactPermutation, true)
})

test('artifact venue fields participate in diversity and exact selection can skip a greedy first pick', () => {
  const venues = [
    item('a', { venueId: null, venue: 'Same venue', sourceFamily: 'A', category: 'music', descriptionLength: 300 }),
    item('b', { venueId: null, venue: 'Same venue', sourceFamily: 'B', category: 'art' }),
    item('c', { venueId: null, venue: 'Other venue', sourceFamily: 'C', category: 'food' }),
  ]
  assert.deepEqual(selectFirstScreen(rank(venues), { limit: 2 }).selected.map(row => row.id), ['a', 'c'])

  const greedyTrap = [
    item('a', { sourceFamily: 'A', category: 'music', venueId: 'v1', descriptionLength: 300 }),
    item('b', { sourceFamily: 'B', category: 'music', venueId: 'v2' }),
    item('c', { sourceFamily: 'A', category: 'art', venueId: 'v3' }),
  ]
  assert.deepEqual(selectFirstScreen(rank(greedyTrap), { limit: 2 }).selected.map(row => row.id), ['b', 'c'])
})

test('canonical and recurring-series duplicates are never used as first-screen padding', () => {
  const rows = [
    item('a', { canonicalId: 'same-canonical', seriesId: 'same-series' }),
    item('b', { canonicalId: 'same-canonical', seriesId: 'other-series' }),
    item('c', { canonicalId: 'other-canonical', seriesId: 'same-series' }),
    item('d', { canonicalId: 'unique', seriesId: 'unique-series' }),
  ]
  const first = selectFirstScreen(rank(rows), { limit: 3 })
  assert.deepEqual(first.selected.map(row => row.id), ['b', 'c', 'd'])
  assert.equal(first.limited, false)
  assert.deepEqual(first.ordered.map(row => row.id).sort(), ['a', 'b', 'c', 'd'])
})

test('signed personal preference is clamped to [-12, 12] and cannot hide muted inventory', () => {
  const rows = [item('avoid', { category: 'nightlife' }), item('match', { category: 'music' }), item('neutral')]
  const result = rank(rows, {
    preferences: {
      itemScores: { avoid: -1_000, match: 1_000 },
      categoryScores: { nightlife: -1_000, music: 1_000 },
    },
  })
  const avoid = result.scored.find(row => row.id === 'avoid')
  const match = result.scored.find(row => row.id === 'match')
  assert.equal(avoid.preferenceScore, -12)
  assert.equal(match.preferenceScore, 12)
  assert.ok(avoid.reasons.includes(RANK_REASON_CODES.PREFERENCE_AVOID))
  assert.ok(match.reasons.includes(RANK_REASON_CODES.PREFERENCE_MATCH))
  assert.equal(result.reachability.exactPermutation, true)
  assert.deepEqual(result.ordered.map(row => row.id).sort(), ['avoid', 'match', 'neutral'])
})

test('objective, context, and preference scores remain separate and bounded', () => {
  const result = rank([item('one', { category: 'music', isFree: true })], {
    context: { itemScores: { one: 500 }, desiredCategories: ['music'], free: true },
    preferences: { itemScores: { one: 500 }, freeAffinity: 500 },
  })
  const scored = result.scored[0]
  assert.equal(scored.contextScore, 20)
  assert.equal(scored.preferenceScore, 12)
  assert.equal(scored.totalScore, scored.objectiveScore + 32)
})

test('reason codes are bounded, stable, and never manufacture missing positive evidence', () => {
  const sparse = item('sparse', {
    sourceFamily: null,
    category: null,
    venueId: null,
    canonicalId: null,
    seriesId: null,
    start: null,
    address: null,
    descriptionLength: null,
    actionability: true,
  })
  const result = rank([sparse])
  const scored = result.scored[0]
  assert.ok(scored.reasons.length <= 8)
  assert.equal(scored.tier, RANK_EVIDENCE_TIERS.CANDIDATE)
  assert.ok(scored.reasons.includes(RANK_REASON_CODES.EVIDENCE_LIMITED))
  for (const unsupported of [
    RANK_REASON_CODES.SOURCE_IDENTIFIED,
    RANK_REASON_CODES.SOURCE_CORROBORATED,
    RANK_REASON_CODES.DETAIL_RICH,
    RANK_REASON_CODES.LOCATION_KNOWN,
    RANK_REASON_CODES.TIME_KNOWN,
    RANK_REASON_CODES.PRICE_KNOWN,
    RANK_REASON_CODES.IMAGE_VERIFIED,
  ]) assert.equal(scored.reasons.includes(unsupported), false, unsupported)
  assert.equal(scored.reasons.some(reason => /best|gem|favorite|popular/i.test(reason)), false)
  assert.equal(selectFirstScreen(result).selected.length, 0)
})

test('recommended and top-placement tiers require positive evidence and an explicit evaluated receipt', () => {
  const recommended = item('recommended')
  const unverifiedTop = item('unverified-top', { rankingEvidence: { topPlacementReceipt: 'receipt-1' } })
  const verifiedTop = item('verified-top', {
    rankingEvidence: {
      evaluated: true,
      topPlacementReceipt: {
        schemaVersion: 1,
        itemId: 'verified-top',
        artifactHash: `sha256:${'a'.repeat(64)}`,
        contextHash: `sha256:${'b'.repeat(64)}`,
        rankerVersion: 'rank-v1',
      },
    },
  })
  const result = rank([recommended, unverifiedTop, verifiedTop])
  assert.equal(result.scored.find(row => row.id === 'recommended').tier, RANK_EVIDENCE_TIERS.RECOMMENDED)
  assert.equal(result.scored.find(row => row.id === 'unverified-top').tier, RANK_EVIDENCE_TIERS.RECOMMENDED)
  assert.equal(result.scored.find(row => row.id === 'verified-top').tier, RANK_EVIDENCE_TIERS.TOP_PLACEMENT)
})

test('verified imagery stays presentation evidence and cannot earn recommendation quality', () => {
  const row = item('image-only', {
    descriptionLength: 0,
    start: null,
    address: null,
    imageEvidence: { verified: true },
  })
  const result = rank([row])
  assert.ok(result.scored[0].reasons.includes(RANK_REASON_CODES.IMAGE_VERIFIED))
  assert.equal(result.scored[0].tier, RANK_EVIDENCE_TIERS.CANDIDATE)
  assert.equal(selectFirstScreen(result).selected.length, 0)
})

test('code-unit IDs remain deterministic and canonically equivalent IDs preserve reachability', () => {
  const rows = [item('\u00e9', { descriptionLength: 120 }), item('e\u0301', { descriptionLength: 300 })]
  assert.deepEqual(rank(rows).ordered.map(row => row.id), ['e\u0301', '\u00e9'])
  assert.equal(rank(rows).reachability.exactPermutation, true)
  assert.deepEqual(rank([...rows].reverse()).ordered.map(row => row.id), ['e\u0301', '\u00e9'])
})

test('production-shaped places accept key identity and infer only destination actionability', () => {
  const place = {
    key: 'p|park',
    name: 'Park',
    sourceFamily: 'City parks',
    category: 'outdoors',
    address: 'Tampa, FL',
    descriptionLength: 200,
  }
  const result = rankItems([place], {
    kind: 'places',
    qualityPolicy: {
      nowMs: Date.parse('2026-07-21T16:00:00Z'),
      timeZone: 'America/New_York',
      market: {
        id: 'tampa-bay',
        bbox: { latMin: 27, latMax: 29, lngMin: -83, lngMax: -82 },
        regionCodes: ['FL'],
      },
    },
  })
  assert.equal(result.scored[0].id, 'p|park')
  assert.equal(selectFirstScreen(result).selected[0], place)
})

test('unknown demotion codes never change objective score invisibly', () => {
  const baseline = rank([item('base')]).scored[0].objectiveScore
  const unknown = rank([item('unknown', { qualityFloor: { blockerCodes: [], demotionCodes: ['UNRECOGNIZED'] } })]).scored[0]
  assert.equal(unknown.objectiveScore, baseline)
})

test('rank-level diversity reorders a lead prefix but keeps a full exact permutation', () => {
  const rows = [
    item('a1', { sourceFamily: 'A', descriptionLength: 300 }),
    item('a2', { sourceFamily: 'A', descriptionLength: 250 }),
    item('b1', { sourceFamily: 'B' }),
  ]
  const result = rank(rows, { diversityPolicy: { prefix: 2, sourceMax: 1 } })
  assert.deepEqual(result.ordered.map(row => row.id), ['a1', 'b1', 'a2'])
  assert.equal(result.reachability.exactPermutation, true)
})

test('invalid and duplicate inputs fail closed', () => {
  assert.throws(() => rank([item('same'), item('same')]), /duplicate item id/)
  assert.throws(() => rankItems([], { kind: 'guide' }), /kind must be/)
  assert.throws(() => selectFirstScreen(rank([item('a')]), { limit: 0 }), /limit must be/)
})
