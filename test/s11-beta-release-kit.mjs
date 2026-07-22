import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  prepareS11BetaReleaseKit,
  S11_CHECKED_ARTIFACT_ROOTS,
} from '../shared/beta-release-kit.mjs'
import { normalizeBetaResearchReceipt } from '../shared/beta-research.mjs'
import { writeManifest } from '../finder/artifact-manifest.mjs'

const NOW_MS = Date.parse('2026-07-22T12:00:00.000Z')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENERATED_AT = '2026-07-22T10:00:00.000Z'
const ASSEMBLED_AT = '2026-07-22T10:05:00.000Z'
const CITY_TIME_ZONES = Object.freeze({
  'sf-east-bay': 'America/Los_Angeles',
  'tampa-bay': 'America/New_York',
})

function sourceHealth(runId, status = 'healthy') {
  const healthy = status === 'healthy' ? 1 : 0
  const unknown = status === 'unknown' ? 1 : 0
  return {
    status,
    runId,
    checkedAt: GENERATED_AT,
    total: 1,
    healthy,
    degraded: 0,
    failed: 0,
    unknown,
    sources: [{ name: 'Fixture source', status, rows: 1, cached: false }],
  }
}

function createArtifactRoot(base, cityId, { healthStatus = 'healthy' } = {}) {
  const root = path.join(base, cityId)
  mkdirSync(path.join(root, 'place-img'), { recursive: true })
  writeFileSync(path.join(root, 'events.json'), `${JSON.stringify([{
    id: `${cityId}-event`,
    title: `${cityId} event`,
    start: '2026-07-23T18:00:00.000Z',
  }])}\n`)
  writeFileSync(path.join(root, 'places.json'), `${JSON.stringify({
    schemaVersion: 1,
    places: [{ key: `${cityId}-place`, name: `${cityId} place` }],
  })}\n`)
  writeFileSync(path.join(root, 'guides.json'), `${JSON.stringify({
    schemaVersion: 1,
    guides: [{ id: `${cityId}-guide`, title: `${cityId} guide` }],
  })}\n`)
  const eventsRunId = `fixture-${cityId}-events`
  const placesRunId = `fixture-${cityId}-places`
  return {
    root,
    manifest: writeManifest({
      root,
      cityId,
      timeZone: CITY_TIME_ZONES[cityId],
      assembledAt: ASSEMBLED_AT,
      componentReceipts: {
        events: {
          runId: eventsRunId,
          generatedAt: GENERATED_AT,
          provenance: 'deterministic-test-fixture',
          sourceHealth: sourceHealth(eventsRunId, healthStatus),
        },
        places: {
          runId: placesRunId,
          generatedAt: GENERATED_AT,
          provenance: 'deterministic-test-fixture',
          sourceHealth: sourceHealth(placesRunId, healthStatus),
        },
      },
    }),
  }
}

function createTwoCityArtifacts(t, options = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-beta-release-kit-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const sets = Object.fromEntries(Object.keys(CITY_TIME_ZONES).map((cityId) => [
    cityId,
    createArtifactRoot(base, cityId, options[cityId]),
  ]))
  return {
    roots: Object.fromEntries(Object.entries(sets).map(([cityId, set]) => [cityId, set.root])),
    releases: Object.fromEntries(Object.entries(sets).map(([cityId, set]) => [cityId, {
      manifestId: set.manifest.manifestId,
      buildId: set.manifest.buildId,
    }])),
  }
}

test('checked flagship artifacts are honestly blocked at the explicit Sprint 11 assessment instant', () => {
  const result = prepareS11BetaReleaseKit({ nowMs: NOW_MS })

  assert.equal(result.status, 'blocked')
  assert.equal(result.kit, null)
  assert.deepEqual(result.blockers, [
    'CITY_NOT_RELEASE_READY:sf-east-bay',
    'CITY_NOT_RELEASE_READY:tampa-bay',
    'DEPLOYED_RELEASE_BINDING_REQUIRED',
  ])
  for (const city of result.cities) {
    const checkedManifest = JSON.parse(readFileSync(
      path.join(S11_CHECKED_ARTIFACT_ROOTS[city.cityId], 'artifact-manifest.json'),
      'utf8',
    ))
    assert.equal(city.artifactIntegrity, 'verified')
    assert.deepEqual(city.observedRelease, {
      manifestId: checkedManifest.manifestId,
      buildId: checkedManifest.buildId,
    })
    assert.equal(city.problems.some((problem) => problem.includes('events artifact is past its manifest max age')), true)
    assert.equal(city.problems.some((problem) => problem.includes('source health is not fully verified and healthy')), true)
  }
})

test('prepares exact owner-fillable research inputs only for two release-ready artifact sets', (t) => {
  const fixture = createTwoCityArtifacts(t)
  const result = prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: fixture.roots,
    deployedReleases: fixture.releases,
  })

  assert.equal(result.status, 'release-ready')
  assert.deepEqual(result.blockers, [])
  assert.equal(result.kit.evaluatedAt, '2026-07-22T12:00:00.000Z')
  assert.deepEqual(result.kit.releaseBindings, fixture.releases)
  assert.deepEqual(result.kit.reviewConfigTemplate, {
    requiredCityIds: ['sf-east-bay', 'tampa-bay'],
    minimumSessionsPerCity: null,
    expectedReleases: fixture.releases,
  })
  assert.equal('passThreshold' in result.kit.reviewConfigTemplate, false)
  assert.equal(result.kit.sessionTemplates.length, 2)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.kit.sessionTemplates[0].milestones), true)

  const receipt = structuredClone(result.kit.sessionTemplates[0])
  Object.assign(receipt, {
    sessionReceiptId: 'r-00000000000000000000000000000001',
    durationMs: 300000,
    sourceLinkOutcome: 'succeeded',
    returningUse: false,
    corePromise: 'yes',
  })
  receipt.milestones.credibleOptionMs = 60000
  receipt.milestones.firstRetainedValueMs = 180000
  receipt.counts = { emptySearches: 0, duplicateExposures: 0, corrections: 0 }
  assert.doesNotThrow(() => normalizeBetaResearchReceipt(receipt))
})

test('fresh local artifacts cannot authorize sessions without independently observed deployed identities', (t) => {
  const fixture = createTwoCityArtifacts(t)
  const result = prepareS11BetaReleaseKit({ nowMs: NOW_MS, artifactRoots: fixture.roots })

  assert.equal(result.status, 'blocked')
  assert.equal(result.kit, null)
  assert.deepEqual(result.blockers, ['DEPLOYED_RELEASE_BINDING_REQUIRED'])
  assert.equal(result.cities.every((city) => city.status === 'artifact-ready'), true)
})

test('refuses stale, source-unverified, tampered, and wrong-city artifact sets without a kit', (t) => {
  const expired = createTwoCityArtifacts(t)
  const expiredResult = prepareS11BetaReleaseKit({
    nowMs: Date.parse('2026-07-25T10:00:00.000Z'),
    artifactRoots: expired.roots,
  })
  assert.equal(expiredResult.status, 'blocked')
  assert.equal(expiredResult.kit, null)
  assert.match(expiredResult.cities[0].problems.join('\n'), /events artifact is past its manifest max age/)

  const unverified = createTwoCityArtifacts(t, {
    'sf-east-bay': { healthStatus: 'unknown' },
  })
  const unverifiedResult = prepareS11BetaReleaseKit({ nowMs: NOW_MS, artifactRoots: unverified.roots })
  assert.equal(unverifiedResult.status, 'blocked')
  assert.match(
    unverifiedResult.cities.find((city) => city.cityId === 'sf-east-bay').problems.join('\n'),
    /source health is not fully verified and healthy/,
  )

  const tampered = createTwoCityArtifacts(t)
  writeFileSync(path.join(tampered.roots['tampa-bay'], 'events.json'), '[]\n')
  const tamperedResult = prepareS11BetaReleaseKit({ nowMs: NOW_MS, artifactRoots: tampered.roots })
  assert.equal(tamperedResult.status, 'blocked')
  assert.equal(tamperedResult.kit, null)
  assert.equal(
    tamperedResult.cities.find((city) => city.cityId === 'tampa-bay').artifactIntegrity,
    'untrusted',
  )

  const swapped = createTwoCityArtifacts(t)
  const wrongCity = prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: {
      'sf-east-bay': swapped.roots['tampa-bay'],
      'tampa-bay': swapped.roots['sf-east-bay'],
    },
  })
  assert.equal(wrongCity.status, 'blocked')
  assert.equal(wrongCity.kit, null)
  assert.equal(wrongCity.cities.every((city) => city.artifactIntegrity === 'untrusted'), true)
})

test('refuses a deployed release mismatch instead of silently rebinding research', (t) => {
  const fixture = createTwoCityArtifacts(t)
  const deployedReleases = structuredClone(fixture.releases)
  deployedReleases['tampa-bay'].manifestId = `sha256:${'e'.repeat(64)}`

  const result = prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: fixture.roots,
    deployedReleases,
  })

  assert.equal(result.status, 'blocked')
  assert.equal(result.kit, null)
  assert.match(
    result.cities.find((city) => city.cityId === 'tampa-bay').problems.join('\n'),
    /deployed manifestId does not match verified bytes/,
  )
})

test('requires deterministic inputs and rejects partial or malformed release bindings', (t) => {
  const fixture = createTwoCityArtifacts(t)

  assert.throws(() => prepareS11BetaReleaseKit(), /requires an explicit nowMs/)
  assert.throws(() => prepareS11BetaReleaseKit({ nowMs: Number.NaN }), /requires an explicit nowMs/)
  assert.throws(() => prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: { 'tampa-bay': fixture.roots['tampa-bay'] },
  }), /artifact roots must contain exactly/)
  assert.throws(() => prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: fixture.roots,
    deployedReleases: { 'tampa-bay': fixture.releases['tampa-bay'] },
  }), /deployed releases must contain exactly/)

  const first = prepareS11BetaReleaseKit({ nowMs: NOW_MS, artifactRoots: fixture.roots })
  const second = prepareS11BetaReleaseKit({ nowMs: NOW_MS, artifactRoots: fixture.roots })
  assert.deepEqual(second, first)
})

test('each city identity and readiness decision comes from one strict artifact verification', () => {
  const source = readFileSync(
    path.join(ROOT, 'shared', 'beta-release-kit.mjs'),
    'utf8',
  )
  assert.equal(
    source.match(/verifyArtifactSet\(\{/g)?.length,
    1,
    'a second verification can cross manifest publication and bind different release bytes',
  )
  assert.match(source, /const observedRelease = integrityVerified \? releaseIdentity\(strict\.manifest\) : null/)
})
