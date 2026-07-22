import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { CITIES } from '../app/src/city.js'
import { rankRuntimeItems } from '../app/src/relevance.js'
import {
  compareFirstScreens,
  firstScreenGate,
  movementGate,
  TOP_N,
} from '../app/src/tastequality.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/personal-relevance/sprint8.v2.json', import.meta.url), 'utf8'))

function profile(evidence = {}) {
  return {
    v: 1,
    catScores: evidence.catScores || {},
    avoidScores: evidence.avoidScores || {},
    freeAffinity: 0,
    n: 40,
    organicN: 40,
    explore: 0.5,
    _interview: null,
    _primer: null,
    prefs: { boost: [], mute: [], when: null },
  }
}

function artifactFor(entry) {
  const url = new URL(`../${entry.artifact}`, import.meta.url)
  const bytes = readFileSync(url)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.caseId} artifact drifted`)
  const parsed = JSON.parse(bytes)
  return entry.kind === 'places' ? parsed.places : parsed
}

function ranking(entry, items, taste) {
  return rankRuntimeItems(items, {
    kind: entry.kind,
    nowMs: Date.parse(entry.asOf),
    city: CITIES[entry.cityId],
    taste,
    diversityPolicy: fixture.diversityPolicy,
  })
}

test('frozen production replays meet actual-first-20 movement and diversity gates', t => {
  assert.equal(fixture.schemaVersion, 1)
  const results = []
  for (const entry of fixture.cases) {
    const items = artifactFor(entry)
    const neutral = ranking(entry, items, null)
    const neutralGate = firstScreenGate(neutral)
    assert.equal(neutralGate.passed, true, `${entry.caseId} neutral: ${neutralGate.violations.join(', ')}`)
    assert.equal(neutralGate.metrics.n, TOP_N)

    for (const direction of entry.directions) {
      const evidence = direction === 'into' ? entry.positive : entry.negative
      const personalized = ranking(entry, items, profile(evidence))
      const gate = movementGate(neutral, personalized, {
        match: entry.match,
        direction,
      })
      assert.equal(gate.passed, true, `${entry.caseId} ${direction}: ${gate.violations.join(', ')}`)
      assert.ok(gate.movement >= 4)
      assert.ok(gate.screen.categoryMaxShare <= 0.5)
      assert.ok(gate.screen.sourceMaxShare <= 0.5)
      assert.equal(gate.comparison.objectiveStable, true)
      assert.equal(gate.comparison.exactPermutation, true)
      assert.equal(personalized.scored.every(row => row.preferenceScore >= -12 && row.preferenceScore <= 12), true)
      results.push(`${entry.caseId}/${direction}=${gate.movement};cat=${gate.screen.categoryMaxShare.toFixed(2)};src=${gate.screen.sourceMaxShare.toFixed(2)}`)
    }
  }
  t.diagnostic(results.join(' | '))
})

test('absent, corrupt, and wrong-version taste reproduce neutral objective order', () => {
  for (const entry of fixture.cases) {
    const items = artifactFor(entry)
    const neutral = ranking(entry, items, null)
    for (const taste of [
      undefined,
      { v: 1, catScores: 'bad', avoidScores: {}, freeAffinity: 0, n: 1, prefs: {} },
      { v: 999, catScores: { music: 25 }, avoidScores: {}, freeAffinity: 25, n: 40, prefs: { boost: ['music'] } },
    ]) {
      const fallback = ranking(entry, items, taste)
      assert.deepEqual(fallback.ordered.map(item => item.id || item.key), neutral.ordered.map(item => item.id || item.key), entry.caseId)
      assert.equal(compareFirstScreens(neutral, fallback, { match: entry.match }).objectiveStable, true)
      assert.equal(fallback.reachability.exactPermutation, true)
    }
  }
})

test('explicit mute moves matching rows down but leaves every item reachable', () => {
  const entry = fixture.cases.find(row => row.caseId === 'tampa-events-music')
  const items = artifactFor(entry)
  const neutral = ranking(entry, items, null)
  const muted = ranking(entry, items, profile({ catScores: { music: 25 } }))
  const explicit = ranking(entry, items, {
    ...profile({ catScores: { music: 25 } }),
    prefs: { boost: [], mute: ['music'], when: null },
  })
  const comparison = compareFirstScreens(neutral, explicit, { match: entry.match })
  assert.ok(comparison.leftMatchingIds.length >= 4)
  assert.equal(explicit.reachability.exactPermutation, true)
  assert.equal(explicit.ordered.length, items.length)
  assert.equal(explicit.scored.filter(row => row.item.category === 'music').every(row => row.preferenceScore === -12), true)
  assert.equal(muted.reachability.exactPermutation, true)
})

test('monocultural self-test proves the first-screen metric can fail', () => {
  const items = Array.from({ length: 24 }, (_, index) => ({
    id: `mono-${index}`,
    category: 'music',
    source: 'One source',
  }))
  const rankingResult = {
    scored: items.map((item, index) => ({ id: item.id, item, objectiveScore: 100 - index })),
    reachability: { exactPermutation: true },
  }
  const gate = firstScreenGate(rankingResult)
  assert.equal(gate.passed, false)
  assert.deepEqual(gate.violations, ['category-concentration', 'source-concentration'])
  assert.equal(gate.metrics.categoryMaxShare, 1)
  assert.equal(gate.metrics.sourceMaxShare, 1)
})
