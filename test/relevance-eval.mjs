import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluateRanking, validateRelevanceFixture } from '../shared/relevance-eval.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'relevance');
const ROOT = join(FIXTURES, '..', '..', '..');

const ARTIFACTS = {
  'tampa-bay': {
    events: join(ROOT, 'finder', 'output', 'tampa-bay', 'events.json'),
    places: join(ROOT, 'finder', 'output', 'tampa-bay', 'places.json'),
  },
  'sf-east-bay': {
    events: join(ROOT, 'finder', 'output', 'sf-east-bay', 'events.json'),
    places: join(ROOT, 'finder', 'output', 'sf-east-bay', 'places.json'),
  },
};

function item(id, relevance, overrides = {}) {
  return {
    id,
    facets: {
      sourceFamily: Object.hasOwn(overrides, 'sourceFamily') ? overrides.sourceFamily : id,
      category: overrides.category ?? 'other',
      venueOrOperator: overrides.venueOrOperator ?? id,
    },
    groups: {
      canonicalId: overrides.canonicalId ?? null,
      seriesId: overrides.seriesId ?? null,
    },
    labels: {
      relevance,
      actionable: overrides.actionable ?? true,
      knownBad: overrides.knownBad ?? false,
      gem: overrides.gem ?? 'no',
    },
  };
}

async function loadFixture(name) {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8'));
}

async function readRawArtifact(path) {
  const raw = await readFile(path, 'utf8');
  return {
    sha256: createHash('sha256').update(raw).digest('hex'),
    parsed: JSON.parse(raw),
  };
}

function primarySourceFamily(raw) {
  const source = Array.isArray(raw.sources) ? raw.sources[0] : raw.source;
  if (typeof source !== 'string' || source.length === 0) return 'unknown';
  if (source.startsWith('Eventbrite')) return 'Eventbrite';
  if (source.startsWith('AllEvents')) return 'AllEvents';
  if (source === 'GGNRA (editorial seed)') return 'GGNRA editorial seed';
  return source;
}

async function assertPinnedArtifactFacts(fixture) {
  const artifact = ARTIFACTS[fixture.origin.cityId];
  assert.ok(artifact, `artifact paths missing for ${fixture.origin.cityId}`);

  const [events, places] = await Promise.all([
    readRawArtifact(artifact.events),
    readRawArtifact(artifact.places),
  ]);

  if (events.sha256 !== fixture.origin.eventsSha256 || places.sha256 !== fixture.origin.placesSha256) return;

  const eventsById = new Map(events.parsed.map(row => [row.id, row]));
  const placesByKey = new Map(places.parsed.places.map(row => [row.key, row]));
  for (const entry of fixture.cases) {
    const rawById = entry.context.kind === 'place' ? placesByKey : eventsById;
    for (const candidate of entry.candidates) {
      const raw = rawById.get(candidate.id);
      assert.ok(raw, `${entry.caseId}:${candidate.id} missing from pinned ${entry.context.kind} artifact`);
      assert.equal(candidate.facets.category, raw.category, `${entry.caseId}:${candidate.id} category drifted`);
      assert.equal(candidate.facets.sourceFamily, primarySourceFamily(raw), `${entry.caseId}:${candidate.id} source family drifted`);
    }
  }
}

function evaluateCase(entry) {
  return evaluateRanking({
    candidates: entry.candidates,
    rankedIds: entry.baseline.rankedIds,
    prefix: entry.context.prefix,
    gemClaimIds: entry.baseline.gemClaimIds,
  });
}

test('core metrics are deterministic and nDCG handles zero gain', () => {
  const candidates = [item('a', 3), item('b', 2), item('c', 1), item('d', 0)];
  const input = { candidates, rankedIds: ['a', 'b', 'c', 'd'], prefix: 3 };
  const report = evaluateRanking(input);
  assert.deepEqual(report, evaluateRanking(input));
  assert.equal(report.metrics.ndcg, 1);
  assert.equal(report.metrics.precision, 2 / 3);
  assert.equal(report.metrics.knownBadRate, 0);
  assert.equal(report.metrics.actionabilityLeakage, 0);

  const zero = [item('zero-a', 0), item('zero-b', 0)];
  assert.equal(evaluateRanking({ candidates: zero, rankedIds: zero.map(row => row.id), prefix: 2 }).metrics.ndcg, null);
});

test('invalid judgments and claims fail loudly', () => {
  const valid = item('a', 2);
  assert.throws(() => evaluateRanking({ candidates: [valid, valid], rankedIds: ['a', 'a'], prefix: 1 }), /duplicate candidate/);
  assert.throws(() => evaluateRanking({ candidates: [{ ...valid, labels: { ...valid.labels, relevance: 4 } }], rankedIds: ['a'], prefix: 1 }), /relevance/);
  assert.throws(() => evaluateRanking({ candidates: [valid], rankedIds: ['a'], prefix: 0 }), /prefix/);
  assert.throws(() => evaluateRanking({ candidates: [valid], rankedIds: ['a'], prefix: 1, gemClaimIds: ['missing'] }), /unknown gem claim/);
  assert.throws(() => evaluateRanking({
    candidates: [item('a', 2, { gem: 'yes' }), item('b', 2, { gem: 'yes' })],
    rankedIds: ['a', 'b'],
    prefix: 1,
    gemClaimIds: ['b'],
  }), /gem claim outside evaluated prefix/);
});

test('quality metrics are withheld unless output preserves every candidate exactly once', () => {
  const candidates = [item('a', 3), item('b', 2), item('c', 1)];
  const cases = [
    { rankedIds: ['a', 'a', 'c'], missing: ['b'], extra: [], duplicated: [{ id: 'a', count: 2 }] },
    { rankedIds: ['a', 'b', 'x'], missing: ['c'], extra: ['x'], duplicated: [] },
    { rankedIds: ['a', 'b'], missing: ['c'], extra: [], duplicated: [] },
  ];
  for (const expected of cases) {
    const report = evaluateRanking({ candidates, rankedIds: expected.rankedIds, prefix: 2 });
    assert.equal(report.reachability.exactPermutation, false);
    assert.deepEqual(report.reachability.missing, expected.missing);
    assert.deepEqual(report.reachability.extra, expected.extra);
    assert.deepEqual(report.reachability.duplicated, expected.duplicated);
    assert.equal(report.metrics, null);
  }
});

test('diversity, duplicate, and gem evidence stay separate', () => {
  const candidates = [
    item('a', 3, { sourceFamily: 'A', canonicalId: 'same', seriesId: 'series', gem: 'yes' }),
    item('b', 2, { sourceFamily: 'A', canonicalId: 'same', seriesId: 'series', gem: 'no' }),
    item('c', 1, { sourceFamily: 'B', canonicalId: 'same', seriesId: 'series', gem: 'insufficient' }),
    item('d', 0, { sourceFamily: null }),
  ];
  const report = evaluateRanking({
    candidates,
    rankedIds: candidates.map(row => row.id),
    prefix: 4,
    gemClaimIds: ['a', 'b', 'c'],
  });
  assert.deepEqual(report.metrics.diversity.source, {
    distinct: 3,
    counts: { A: 2, B: 1, unknown: 1 },
    maxCount: 2,
    maxShare: 0.5,
    dominant: ['A'],
  });
  assert.equal(report.metrics.duplication.canonical.duplicateRows, 2);
  assert.equal(report.metrics.duplication.series.duplicateRows, 2);
  assert.deepEqual(report.metrics.gems, {
    claimed: 3,
    counts: { yes: 1, no: 1, insufficient: 1 },
    precision: 1 / 3,
    noRate: 1 / 3,
    insufficientRate: 1 / 3,
  });
});

test('frozen city fixtures are pinned, complete, and explicitly awaiting owner review', async () => {
  const tampa = await loadFixture('tampa-bay.v1.json');
  const sf = await loadFixture('sf-east-bay.v1.json');
  assert.equal(tampa.judgmentStatus, 'draft-owner-review');
  assert.equal(sf.judgmentStatus, 'draft-owner-review');
  assert.equal(tampa.origin.eventsSha256, 'a8df0d0cefb461c6e417092b42de20067cf4f1bfb68314e5e91c4f70f875d090');
  assert.equal(tampa.origin.placesSha256, '749eed658f2df7c8f9d175391ba06518c7b88168f4e27afab0a63ff647e3a57b');
  assert.equal(sf.origin.eventsSha256, '84981a8ec48f0245e23e168fb63bc2071cceb5e1eda4e115828264a92873b1d8');
  assert.equal(sf.origin.placesSha256, '1f42b49ee860b3ad2a5a887192eaa0b77689ab457f4671b28bdda85c4a39ad78');
  for (const city of [tampa, sf]) {
    validateRelevanceFixture(city);
    assert.ok(city.limitations.some(note => note.includes('expired artifact replay')));
    assert.ok(city.cases.every(entry => ['surface-order', 'defect-projection'].includes(entry.context.caseType)));
    for (const entry of city.cases) assert.equal(evaluateCase(entry).reachability.exactPermutation, true, entry.caseId);
    await assertPinnedArtifactFacts(city);
  }
});

test('Tampa receipt exposes weak lead choices, photo-first ramps, and recurrence', async () => {
  const tampa = await loadFixture('tampa-bay.v1.json');
  const [home, spots, repeats] = tampa.cases.map(evaluateCase);
  assert.deepEqual(tampa.cases[0].baseline.rankedIds.slice(0, 3), ['88f35f96991ea446', 'e7f09c78fa4ae916', 'bed42d23cc766fa0']);
  assert.equal(home.metrics.precision, 1 / 3);
  assert.equal(home.metrics.actionabilityLeakage, 1);
  assert.equal(home.metrics.diversity.source.maxShare, 2 / 3);
  assert.equal(home.metrics.diversity.category.maxShare, 1 / 3);
  assert.ok(home.metrics.ndcg < 0.5);
  assert.equal(spots.metrics.precision, 2 / 3);
  assert.equal(spots.metrics.diversity.category.maxShare, 1);
  assert.ok(spots.metrics.ndcg < 1);
  assert.equal(repeats.metrics.duplication.canonical.duplicateRows, 1);
  assert.equal(repeats.metrics.duplication.series.duplicateRows, 2);
});

test('SF receipt exposes wrong-market leakage, phantom ranges, and concentration', async () => {
  const sf = await loadFixture('sf-east-bay.v1.json');
  const [home, spots, defects] = sf.cases.map(evaluateCase);
  assert.deepEqual(sf.cases[0].baseline.rankedIds.slice(0, 4), ['d0bdff0e770df0c5', 'f33085f86ddb2cf4', 'a078fca643e19132', '9fc70f7fd8a6a08d']);
  assert.equal(home.metrics.precision, 0.5);
  assert.equal(home.metrics.knownBadRate, 0.5);
  assert.equal(home.metrics.actionabilityLeakage, 1);
  assert.ok(home.metrics.ndcg < 0.5);
  assert.equal(spots.metrics.precision, 1);
  assert.equal(spots.metrics.diversity.source.maxShare, 1);
  assert.equal(spots.metrics.diversity.venueOrOperator.maxShare, 1);
  assert.equal(defects.metrics.knownBadRate, 1);
  assert.equal(defects.metrics.gems.precision, 0);
});
