import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILE,
  PENDING_MANIFEST_FILE,
  calculateBuildId,
  calculateManifestId,
  invalidateManifest,
  sha256,
  summarizeSourceHealth,
  verifyArtifactSet,
  writeManifest,
} from '../finder/artifact-manifest.mjs';
import { verifyAppBuild } from '../finder/verify-app-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXED_ASSEMBLED_AT = '2026-07-14T14:00:00.000Z';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(parent, cityId = 'tampa-bay', timeZone = 'America/New_York', assembledAt = FIXED_ASSEMBLED_AT) {
  const root = join(parent, cityId);
  mkdirSync(join(root, 'place-img'), { recursive: true });
  writeJson(join(root, 'events.json'), [{ id: `${cityId}:event:1`, title: 'Fixture', start: '2026-07-15T19:00:00-04:00', source: 'Fixture Source' }]);
  writeJson(join(root, 'places.json'), {
    schemaVersion: 1,
    places: [{ key: `${cityId}:place:1`, name: 'Fixture Place', image: '/place-img/fixture.jpg' }],
  });
  writeJson(join(root, 'guides.json'), { schemaVersion: 1, guides: [] });
  writeFileSync(join(root, 'events.md'), '# Events\n\n_Generated 7/14/2026, 9:00:00 AM · sources: Fixture Source_\n');
  writeFileSync(join(root, 'places.md'), '# Places\n\n_Generated 7/1/2026, 9:00:00 AM · sources: Fixture Places_\n');
  writeFileSync(join(root, 'place-img', 'fixture.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const manifest = writeManifest({ root, cityId, timeZone, assembledAt });
  return { root, manifest, cityId, timeZone };
}

function withScratch(fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'wuzup-artifact-'));
  try { return fn(scratch); } finally { rmSync(scratch, { recursive: true, force: true }); }
}

test('artifact manifest is deterministic and verifies exact selected-city bytes', () => withScratch((scratch) => {
  const set = fixture(join(scratch, 'first'));
  const independent = fixture(join(scratch, 'independent'), 'tampa-bay', 'America/New_York', '2026-07-15T00:00:00.000Z');
  assert.equal(independent.manifest.buildId, set.manifest.buildId, 'identical member bytes have one content build id across clean seals');
  assert.notEqual(independent.manifest.manifestId, set.manifest.manifestId, 'exact sidecar identity still binds its seal receipt');
  const repeated = writeManifest({ root: set.root, cityId: set.cityId, timeZone: set.timeZone, assembledAt: '2026-07-15T00:00:00.000Z' });
  assert.equal(repeated.buildId, set.manifest.buildId, 'unchanged bytes keep one immutable build id');
  assert.equal(repeated.assembledAt, FIXED_ASSEMBLED_AT, 'resealing unchanged bytes cannot fake freshness');
  const checked = verifyArtifactSet({ root: set.root, expectedCityId: set.cityId, expectedTimeZone: set.timeZone });
  assert.equal(checked.ok, true, checked.problems.join(' · '));
  assert.equal(checked.manifest.sourceHealth.status, 'unknown', 'legacy source health is explicit, never relabeled healthy');
}));

test('source-health receipts preserve why a cached fallback was used', () => {
  const health = summarizeSourceHealth([
    { source: 'Transport failure', found: 20, ok: false, cached: true, fallbackReason: 'live-error', error: 'fetch failed' },
    { source: 'Parser returned zero', found: 12, ok: false, cached: true, fallbackReason: 'live-empty' },
    { source: 'Live source', found: 8, ok: true },
  ], { runId: 'events-fixture-run', checkedAt: '2026-07-15T12:00:00.000Z' });

  assert.equal(health.sources[0].fallbackReason, 'live-error');
  assert.equal(health.sources[0].error, 'fetch failed');
  assert.equal(health.sources[1].fallbackReason, 'live-empty');
  assert.equal(health.sources[2].fallbackReason, undefined);
});

test('a genuine run receipt refreshes unchanged content without changing its build id', () => withScratch((scratch) => {
  const set = fixture(scratch);
  const runId = 'events-tampa-bay-test-run';
  const placesRunId = 'places-tampa-bay-test-run';
  const generatedAt = '2026-07-15T12:00:00.000Z';
  const sourceHealth = summarizeSourceHealth([{ source: 'Fixture Source', found: 1, ok: true }], { runId, checkedAt: generatedAt });
  const placesHealth = summarizeSourceHealth([{ source: 'Fixture Places', found: 1, ok: true }], { runId: placesRunId, checkedAt: generatedAt });
  const refreshed = writeManifest({
    root: set.root,
    cityId: set.cityId,
    timeZone: set.timeZone,
    assembledAt: generatedAt,
    componentReceipts: {
      events: { generatedAt, runId, provenance: 'finder-run', sourceHealth },
      places: { generatedAt, runId: placesRunId, provenance: 'finder-run', sourceHealth: placesHealth },
    },
  });
  assert.equal(refreshed.buildId, set.manifest.buildId);
  assert.notEqual(refreshed.manifestId, set.manifest.manifestId);
  assert.equal(refreshed.runId, runId);
  assert.equal(refreshed.generatedAt, generatedAt);
  assert.equal(refreshed.sourceHealth.status, 'healthy');
  const checked = verifyArtifactSet({
    root: set.root,
    expectedCityId: set.cityId,
    expectedTimeZone: set.timeZone,
    requireFresh: true,
    requireVerifiedSources: true,
    now: Date.parse('2026-07-16T00:00:00.000Z'),
  });
  assert.equal(checked.ok, true, checked.problems.join(' · '));

  const captured = invalidateManifest(set.root, { expectedCityId: set.cityId, expectedTimeZone: set.timeZone });
  const nextRunId = 'events-tampa-bay-next-run';
  const nextGeneratedAt = '2026-07-15T13:00:00.000Z';
  const nextHealth = summarizeSourceHealth([{ source: 'Fixture Source', found: 1, ok: true }], { runId: nextRunId, checkedAt: nextGeneratedAt });
  const sequential = writeManifest({
    root: set.root,
    cityId: set.cityId,
    timeZone: set.timeZone,
    assembledAt: nextGeneratedAt,
    previousManifest: captured,
    componentReceipts: {
      events: { generatedAt: nextGeneratedAt, runId: nextRunId, provenance: 'finder-run', sourceHealth: nextHealth },
    },
  });
  assert.equal(sequential.artifacts.places.runId, placesRunId, 'event-only refresh retains the untouched place receipt');
  assert.equal(sequential.artifacts.places.sourceHealth.status, 'healthy');
  const sequentialCheck = verifyArtifactSet({
    root: set.root,
    expectedCityId: set.cityId,
    expectedTimeZone: set.timeZone,
    requireFresh: true,
    requireVerifiedSources: true,
    now: Date.parse('2026-07-16T00:00:00.000Z'),
  });
  assert.equal(sequentialCheck.ok, true, sequentialCheck.problems.join(' · '));
}));

test('wrong-city, missing-manifest, expired, and hash-invalid sets fail closed', () => withScratch((scratch) => {
  const set = fixture(scratch);
  const wrongCity = verifyArtifactSet({ root: set.root, expectedCityId: 'sf-east-bay', expectedTimeZone: 'America/Los_Angeles' });
  assert.equal(wrongCity.ok, false);
  assert.match(wrongCity.problems.join(' '), /cityId.*sf-east-bay/);

  const stale = verifyArtifactSet({ root: set.root, expectedCityId: set.cityId, expectedTimeZone: set.timeZone, requireFresh: true, now: Date.parse('2026-07-17T14:00:01.000Z') });
  assert.equal(stale.ok, false);
  assert.match(stale.problems.join(' '), /past its manifest max age/);

  writeFileSync(join(set.root, 'events.json'), `${readFileSync(join(set.root, 'events.json'), 'utf8')} `);
  const changed = verifyArtifactSet({ root: set.root, expectedCityId: set.cityId, expectedTimeZone: set.timeZone });
  assert.equal(changed.ok, false);
  assert.match(changed.problems.join(' '), /events\.json (sha256|bytes) does not match manifest/);

  const absent = join(scratch, 'no-manifest');
  mkdirSync(absent);
  assert.deepEqual(verifyArtifactSet({ root: absent, expectedCityId: set.cityId }).problems, [`missing ${MANIFEST_FILE}`]);

  const partial = fixture(join(scratch, 'partial'));
  rmSync(join(partial.root, 'guides.json'));
  const partialCheck = verifyArtifactSet({ root: partial.root, expectedCityId: partial.cityId, expectedTimeZone: partial.timeZone });
  assert.equal(partialCheck.ok, false);
  assert.match(partialCheck.problems.join(' '), /guides\.json could not be verified/);
}));

test('invalid expiry and untrusted prior receipts cannot launder freshness', () => withScratch((scratch) => {
  const invalid = fixture(join(scratch, 'invalid-expiry'));
  const invalidPath = join(invalid.root, MANIFEST_FILE);
  const invalidManifest = JSON.parse(readFileSync(invalidPath, 'utf8'));
  invalidManifest.expiresAt = 'not-a-date';
  invalidManifest.artifacts.events.expiresAt = 'not-a-date';
  invalidManifest.manifestId = calculateManifestId(invalidManifest);
  writeJson(invalidPath, invalidManifest);
  const invalidCheck = verifyArtifactSet({
    root: invalid.root,
    expectedCityId: invalid.cityId,
    expectedTimeZone: invalid.timeZone,
    requireFresh: true,
    now: Date.parse('2026-07-14T12:00:00.000Z'),
  });
  assert.equal(invalidCheck.ok, false);
  assert.match(invalidCheck.problems.join(' '), /expiresAt/);

  const impossible = fixture(join(scratch, 'impossible-times'));
  const impossiblePath = join(impossible.root, MANIFEST_FILE);
  const impossibleManifest = JSON.parse(readFileSync(impossiblePath, 'utf8'));
  const futureGeneratedAt = '2099-01-01T00:00:00.000Z';
  const futureExpiresAt = '2099-01-03T00:00:00.000Z';
  impossibleManifest.generatedAt = futureGeneratedAt;
  impossibleManifest.expiresAt = futureExpiresAt;
  impossibleManifest.artifacts.events.generatedAt = futureGeneratedAt;
  impossibleManifest.artifacts.events.expiresAt = futureExpiresAt;
  impossibleManifest.sourceHealth.checkedAt = futureGeneratedAt;
  impossibleManifest.artifacts.events.sourceHealth = impossibleManifest.sourceHealth;
  impossibleManifest.artifacts.places.generatedAt = '2025-01-01T00:00:00.000Z';
  impossibleManifest.artifacts.places.expiresAt = '2025-01-31T00:00:00.000Z';
  impossibleManifest.artifacts.places.sourceHealth.checkedAt = '2025-01-01T00:00:00.000Z';
  impossibleManifest.manifestId = calculateManifestId(impossibleManifest);
  writeJson(impossiblePath, impossibleManifest);
  const impossibleCheck = verifyArtifactSet({
    root: impossible.root,
    expectedCityId: impossible.cityId,
    expectedTimeZone: impossible.timeZone,
    requireFresh: true,
    now: Date.parse('2026-07-14T15:00:00.000Z'),
  });
  assert.equal(impossibleCheck.ok, false);
  assert.match(impossibleCheck.problems.join(' '), /implausibly in the future/);
  assert.match(impossibleCheck.problems.join(' '), /places artifact is past/);

  const contradictory = fixture(join(scratch, 'contradictory-health'));
  const contradictoryPath = join(contradictory.root, MANIFEST_FILE);
  const contradictoryManifest = JSON.parse(readFileSync(contradictoryPath, 'utf8'));
  contradictoryManifest.sourceHealth.status = 'healthy';
  contradictoryManifest.artifacts.events.sourceHealth = contradictoryManifest.sourceHealth;
  contradictoryManifest.manifestId = calculateManifestId(contradictoryManifest);
  writeJson(contradictoryPath, contradictoryManifest);
  const contradictoryCheck = verifyArtifactSet({
    root: contradictory.root,
    expectedCityId: contradictory.cityId,
    expectedTimeZone: contradictory.timeZone,
    requireVerifiedSources: true,
  });
  assert.equal(contradictoryCheck.ok, false);
  assert.match(contradictoryCheck.problems.join(' '), /contradicts source receipts/);

  const malformedTime = fixture(join(scratch, 'malformed-time'));
  const malformedTimePath = join(malformedTime.root, MANIFEST_FILE);
  const malformedTimeManifest = JSON.parse(readFileSync(malformedTimePath, 'utf8'));
  malformedTimeManifest.generatedAt = 'not-a-date';
  malformedTimeManifest.expiresAt = null;
  malformedTimeManifest.artifacts.events.generatedAt = 'not-a-date';
  malformedTimeManifest.artifacts.events.expiresAt = null;
  malformedTimeManifest.sourceHealth.checkedAt = 'not-a-date';
  malformedTimeManifest.artifacts.events.sourceHealth = malformedTimeManifest.sourceHealth;
  malformedTimeManifest.manifestId = calculateManifestId(malformedTimeManifest);
  writeJson(malformedTimePath, malformedTimeManifest);
  let malformedTimeCheck;
  assert.doesNotThrow(() => {
    malformedTimeCheck = verifyArtifactSet({ root: malformedTime.root, expectedCityId: malformedTime.cityId, expectedTimeZone: malformedTime.timeZone });
  });
  assert.equal(malformedTimeCheck.ok, false);
  assert.match(malformedTimeCheck.problems.join(' '), /generatedAt/);

  const forged = fixture(join(scratch, 'forged-prior'));
  const forgedPath = join(forged.root, MANIFEST_FILE);
  const forgedManifest = JSON.parse(readFileSync(forgedPath, 'utf8'));
  const fakeGeneratedAt = '2099-01-01T00:00:00.000Z';
  const fakeExpiresAt = '2099-01-03T00:00:00.000Z';
  forgedManifest.generatedAt = fakeGeneratedAt;
  forgedManifest.expiresAt = fakeExpiresAt;
  forgedManifest.assembledAt = fakeGeneratedAt;
  forgedManifest.artifacts.events.generatedAt = fakeGeneratedAt;
  forgedManifest.artifacts.events.expiresAt = fakeExpiresAt;
  forgedManifest.sourceHealth.checkedAt = fakeGeneratedAt;
  forgedManifest.sourceHealth.status = 'healthy';
  forgedManifest.sourceHealth.healthy = forgedManifest.sourceHealth.total;
  forgedManifest.sourceHealth.unknown = 0;
  forgedManifest.sourceHealth.sources = forgedManifest.sourceHealth.sources.map((source) => ({ ...source, status: 'healthy' }));
  forgedManifest.artifacts.events.sourceHealth = forgedManifest.sourceHealth;
  // Deliberately leave manifestId unchanged: resealing must reject this prior
  // receipt and recover provenance from the immutable legacy Markdown stamp.
  writeJson(forgedPath, forgedManifest);
  const recovered = writeManifest({ root: forged.root, cityId: forged.cityId, timeZone: forged.timeZone, assembledAt: '2026-07-15T00:00:00.000Z' });
  assert.equal(recovered.generatedAt, '2026-07-14T13:00:00.000Z');
  assert.equal(recovered.sourceHealth.status, 'unknown');
}));

test('schema validation still rejects malformed payloads when their new hash is recorded', () => withScratch((scratch) => {
  const set = fixture(scratch);
  const malformed = Buffer.from('{"schemaVersion":1,"places":{}}\n');
  writeFileSync(join(set.root, 'places.json'), malformed);
  const manifestPath = join(set.root, MANIFEST_FILE);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.artifacts.places.sha256 = sha256(malformed);
  manifest.artifacts.places.bytes = malformed.length;
  manifest.artifacts.places.count = 0;
  manifest.buildId = calculateBuildId(manifest);
  manifest.manifestId = calculateManifestId(manifest);
  writeJson(manifestPath, manifest);
  const checked = verifyArtifactSet({ root: set.root, expectedCityId: set.cityId, expectedTimeZone: set.timeZone });
  assert.equal(checked.ok, false);
  assert.match(checked.problems.join(' '), /places\.json could not be verified/);

  const nullRows = fixture(join(scratch, 'null-rows'));
  const payloads = {
    events: Buffer.from('[null]\n'),
    places: Buffer.from('{"schemaVersion":999,"places":[null]}\n'),
    guides: Buffer.from('{"schemaVersion":999,"guides":[null]}\n'),
  };
  const nullManifestPath = join(nullRows.root, MANIFEST_FILE);
  const nullManifest = JSON.parse(readFileSync(nullManifestPath, 'utf8'));
  for (const [kind, body] of Object.entries(payloads)) {
    writeFileSync(join(nullRows.root, `${kind}.json`), body);
    nullManifest.artifacts[kind].sha256 = sha256(body);
    nullManifest.artifacts[kind].bytes = body.length;
    nullManifest.artifacts[kind].count = 1;
  }
  nullManifest.buildId = calculateBuildId(nullManifest);
  nullManifest.manifestId = calculateManifestId(nullManifest);
  writeJson(nullManifestPath, nullManifest);
  const nullCheck = verifyArtifactSet({ root: nullRows.root, expectedCityId: nullRows.cityId, expectedTimeZone: nullRows.timeZone });
  assert.equal(nullCheck.ok, false);
  assert.match(nullCheck.problems.join(' '), /(minimum runtime schema|schemaVersion)/);
}));

test('local place-image references are verified and image-only transitions stay untrusted', () => withScratch((scratch) => {
  const broken = fixture(join(scratch, 'broken-reference'));
  const placesPath = join(broken.root, 'places.json');
  const placesDoc = JSON.parse(readFileSync(placesPath, 'utf8'));
  placesDoc.places[0].image = '/place-img/missing.jpg';
  writeJson(placesPath, placesDoc);
  const placesBytes = readFileSync(placesPath);
  const manifestPath = join(broken.root, MANIFEST_FILE);
  const forged = JSON.parse(readFileSync(manifestPath, 'utf8'));
  forged.artifacts.places.sha256 = sha256(placesBytes);
  forged.artifacts.places.bytes = placesBytes.length;
  forged.buildId = calculateBuildId(forged);
  forged.manifestId = calculateManifestId(forged);
  writeJson(manifestPath, forged);
  const brokenCheck = verifyArtifactSet({
    root: broken.root,
    expectedCityId: broken.cityId,
    expectedTimeZone: broken.timeZone,
  });
  assert.equal(brokenCheck.ok, false);
  assert.match(brokenCheck.problems.join(' '), /references missing local image/);

  const transition = fixture(join(scratch, 'transition'));
  const captured = invalidateManifest(transition.root, {
    expectedCityId: transition.cityId,
    expectedTimeZone: transition.timeZone,
    preservePending: true,
  });
  assert.equal(existsSync(join(transition.root, MANIFEST_FILE)), false);
  assert.equal(existsSync(join(transition.root, PENDING_MANIFEST_FILE)), true);
  rmSync(join(transition.root, 'place-img', 'fixture.jpg'));
  writeFileSync(join(transition.root, 'place-img', 'replacement.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.throws(
    () => writeManifest({
      root: transition.root,
      cityId: transition.cityId,
      timeZone: transition.timeZone,
      previousManifest: captured,
    }),
    /references missing local image/,
  );
  assert.equal(existsSync(join(transition.root, MANIFEST_FILE)), false, 'an image-only swap cannot publish trust');
  assert.equal(existsSync(join(transition.root, PENDING_MANIFEST_FILE)), true, 'the prior receipt remains available for recovery');

  const transitionPlaces = JSON.parse(readFileSync(join(transition.root, 'places.json'), 'utf8'));
  transitionPlaces.places[0].image = '/place-img/replacement.jpg';
  writeJson(join(transition.root, 'places.json'), transitionPlaces);
  const resealed = writeManifest({
    root: transition.root,
    cityId: transition.cityId,
    timeZone: transition.timeZone,
    previousManifest: captured,
  });
  assert.equal(resealed.placeImages.count, 1);
  assert.equal(existsSync(join(transition.root, PENDING_MANIFEST_FILE)), false, 'successful publication consumes the recovery receipt');
  const transitionCheck = verifyArtifactSet({
    root: transition.root,
    expectedCityId: transition.cityId,
    expectedTimeZone: transition.timeZone,
  });
  assert.equal(transitionCheck.ok, true, transitionCheck.problems.join(' · '));
}));

test('supported derived writers preserve fail-closed publication boundaries', () => {
  const images = readFileSync(join(ROOT, 'finder', 'places-images.mjs'), 'utf8');
  const descriptions = readFileSync(join(ROOT, 'finder', 'places-descriptions.mjs'), 'utf8');
  const mapillary = readFileSync(join(ROOT, 'finder', 'mapillary-stageb.mjs'), 'utf8');
  assert.ok(images.indexOf('invalidateManifest(artifactRoot') < images.indexOf('atomicWriteFileSync(path'), 'places-images must invalidate before its atomic artifact write');
  assert.ok(descriptions.indexOf('invalidateManifest(artifactRoot') < descriptions.indexOf('atomicWriteFileSync(path'), 'places-descriptions must invalidate before its atomic artifact write');
  assert.ok(mapillary.indexOf('invalidateManifest(OUTPUT_ROOT') < mapillary.indexOf('rmSync(PLACE_IMG'), 'Mapillary ship must invalidate before clearing image artifacts');
  assert.ok(images.indexOf('atomicWriteFileSync(path') < images.indexOf('writeManifest({'), 'places-images must reseal after writing');
  assert.ok(descriptions.indexOf('atomicWriteFileSync(path') < descriptions.indexOf('writeManifest({'), 'places-descriptions must reseal after writing');
  assert.match(mapillary, /preservePending:\s*true/, 'Mapillary must retain the prior receipt for the completing places-images stage');
  assert.doesNotMatch(mapillary, /\bwriteManifest\b/, 'Mapillary must not publish a manifest for its intermediate image-only state');
});

test('deploy refuses mutated source bytes before touching destination and stages a valid set byte-identically', () => withScratch((scratch) => {
  const output = join(scratch, 'output');
  const set = fixture(output);
  const dest = join(scratch, 'dest');
  mkdirSync(dest);
  writeFileSync(join(dest, 'sentinel.txt'), 'unchanged');

  writeFileSync(join(set.root, 'events.json'), '[]\n');
  let run = spawnSync(process.execPath, ['finder/deploy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CITY: set.cityId, DEPLOY_SRC: output, DEPLOY_DEST: dest },
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}${run.stderr}`, /REFUSING/);
  assert.equal(readFileSync(join(dest, 'sentinel.txt'), 'utf8'), 'unchanged');

  rmSync(set.root, { recursive: true, force: true });
  const valid = fixture(output);
  run = spawnSync(process.execPath, ['finder/deploy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CITY: valid.cityId, DEPLOY_SRC: output, DEPLOY_DEST: dest },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  for (const file of ['events.json', 'places.json', 'guides.json', MANIFEST_FILE]) {
    assert.deepEqual(readFileSync(join(dest, file)), readFileSync(join(valid.root, file)), `${file} must stage byte-identically`);
  }
  assert.deepEqual(readFileSync(join(dest, 'place-img', 'fixture.jpg')), readFileSync(join(valid.root, 'place-img', 'fixture.jpg')));

  run = spawnSync(process.execPath, ['finder/deploy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CITY: valid.cityId, DEPLOY_SRC: output, DEPLOY_DEST: dest, DEPLOY_FAIL_AFTER: 'events.json' },
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}${run.stderr}`, /injected interruption/);
  assert.equal(existsSync(join(dest, MANIFEST_FILE)), false, 'an interrupted swap must not leave the old trust pointer visible');

  run = spawnSync(process.execPath, ['finder/deploy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CITY: valid.cityId, DEPLOY_SRC: output, DEPLOY_DEST: dest },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
}));

test('selected-city local staging locks CITY and VITE_CITY to one artifact set', () => withScratch((scratch) => {
  const output = join(scratch, 'output');
  const sf = fixture(output, 'sf-east-bay', 'America/Los_Angeles', '2026-07-14T17:00:00.000Z');
  const dest = join(scratch, 'dest');
  mkdirSync(dest);
  let run = spawnSync(process.execPath, ['finder/dev-city.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CITY: sf.cityId, DEPLOY_SRC: output, DEPLOY_DEST: dest, DEV_STAGE_ONLY: '1' },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(JSON.parse(readFileSync(join(dest, MANIFEST_FILE), 'utf8')).cityId, 'sf-east-bay');

  run = spawnSync(process.execPath, ['finder/dev-city.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CITY: sf.cityId, VITE_CITY: 'tampa-bay', DEPLOY_SRC: output, DEPLOY_DEST: dest, DEV_STAGE_ONLY: '1' },
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}${run.stderr}`, /REFUSING conflicting CITY/);

  run = spawnSync(process.execPath, ['finder/dev-city.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      CITY: sf.cityId,
      VITE_CITY: sf.cityId,
      DEPLOY_SRC: output,
      DEPLOY_DEST: dest,
      DEV_LAUNCH_PROBE: '1',
      DEV_PROBE_OUT: join(scratch, 'vite-probe'),
    },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const probeRoot = join(scratch, 'vite-probe');
  assert.equal(existsSync(join(probeRoot, 'index.html')), true, 'probe must build the real app root');
  const probeScripts = readdirSync(join(probeRoot, 'assets'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(probeRoot, 'assets', file), 'utf8'))
    .join('\n');
  assert.match(probeScripts, new RegExp(sf.manifest.manifestId), 'browser JavaScript must embed the staged manifest id');
  const proof = verifyAppBuild({
    sourceRoot: dest,
    builtRoot: probeRoot,
    expectedCityId: sf.cityId,
    expectedTimeZone: sf.timeZone,
  });
  assert.equal(proof.ok, true, proof.problems.join('\n'));

  run = spawnSync(process.execPath, ['finder/dev-city.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      CITY: sf.cityId,
      DEPLOY_SRC: output,
      DEPLOY_DEST: dest,
      DEV_LAUNCH_PROBE: '1',
      DEV_PROBE_OUT: join(scratch, 'vite-refusal'),
      VITE_ARTIFACT_MANIFEST_ID: `sha256:${'0'.repeat(64)}`,
    },
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0, 'a caller-supplied manifest id must not override staged bytes');
  assert.match(`${run.stdout}${run.stderr}`, /Vite refused VITE_ARTIFACT_MANIFEST_ID/);
  const appPackage = JSON.parse(readFileSync(join(ROOT, 'app', 'package.json'), 'utf8'));
  assert.match(appPackage.scripts.dev, /dev-city\.mjs/, 'the legacy app dev command must route through selected-city staging');
}));

test('CI and deploy verify each built city before publication', () => {
  const config = readFileSync(join(ROOT, 'app', 'vite.config.js'), 'utf8');
  assert.match(config, /verifyArtifactSet/);
  assert.match(config, /WUZUP_PUBLIC_DIR/);
  assert.match(config, /VITE_ARTIFACT_MANIFEST_ID/);
  for (const workflow of ['ci.yml', 'deploy.yml']) {
    const source = readFileSync(join(ROOT, '.github', 'workflows', workflow), 'utf8');
    for (const city of ['tampa-bay', 'sf-east-bay']) {
      assert.match(source, new RegExp(`CITY=${city} node finder/verify-app-build\\.mjs app/dist`));
    }
  }
});
