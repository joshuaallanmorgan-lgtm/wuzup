import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

import { writeManifest } from '../finder/artifact-manifest.mjs'
import {
  buildS11ProductionAttestation,
  inspectS11LoadedJavascript,
  observeS11ParticipantRelease,
  S11_PRODUCTION_ROOT_URL,
} from '../shared/beta-production-observation.mjs'
import { prepareS11BetaReleaseKit } from '../shared/beta-release-kit.mjs'

const NOW_MS = Date.parse('2026-07-22T12:00:00.000Z')
const PRODUCT_ROOT = S11_PRODUCTION_ROOT_URL
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CITY_TIME_ZONES = Object.freeze({
  'sf-east-bay': 'America/Los_Angeles',
  'tampa-bay': 'America/New_York',
})
const CITY_PATHS = Object.freeze({
  'sf-east-bay': 'sf/',
  'tampa-bay': '',
})

function sourceHealth(runId, status = 'healthy', checkedAt = '2026-07-22T10:00:00.000Z') {
  const healthy = status === 'healthy' ? 1 : 0
  const unknown = status === 'unknown' ? 1 : 0
  return {
    status,
    runId,
    checkedAt,
    total: 1,
    healthy,
    degraded: 0,
    failed: 0,
    unknown,
    sources: [{ name: 'Fixture source', status, rows: 1, cached: false }],
  }
}

function createArtifactRoot(base, cityId, {
  generatedAt = '2026-07-22T10:00:00.000Z',
  assembledAt = '2026-07-22T10:05:00.000Z',
  healthStatus = 'healthy',
} = {}) {
  const root = path.join(base, cityId)
  const imageName = `${cityId}.jpg`
  const imageBytes = Buffer.from(`fixture image for ${cityId}`)
  mkdirSync(path.join(root, 'place-img'), { recursive: true })
  writeFileSync(path.join(root, 'place-img', imageName), imageBytes)
  writeFileSync(path.join(root, 'events.json'), `${JSON.stringify([{
    id: `${cityId}-event`,
    title: `${cityId} event`,
    start: '2026-07-23T18:00:00.000Z',
  }])}\n`)
  writeFileSync(path.join(root, 'places.json'), `${JSON.stringify({
    schemaVersion: 1,
    places: [{
      key: `${cityId}-place`,
      name: `${cityId} place`,
      image: `/place-img/${imageName}`,
    }],
  })}\n`)
  writeFileSync(path.join(root, 'guides.json'), `${JSON.stringify({
    schemaVersion: 1,
    guides: [{ id: `${cityId}-guide`, title: `${cityId} guide` }],
  })}\n`)
  const eventsRunId = `fixture-${cityId}-events`
  const placesRunId = `fixture-${cityId}-places`
  const manifest = writeManifest({
    root,
    cityId,
    timeZone: CITY_TIME_ZONES[cityId],
    assembledAt,
    componentReceipts: {
      events: {
        runId: eventsRunId,
        generatedAt,
        provenance: 'deterministic-test-fixture',
        sourceHealth: sourceHealth(eventsRunId, healthStatus, generatedAt),
      },
      places: {
        runId: placesRunId,
        generatedAt,
        provenance: 'deterministic-test-fixture',
        sourceHealth: sourceHealth(placesRunId, healthStatus, generatedAt),
      },
    },
  })
  return { root, manifest, imageName }
}

function createTwoCityArtifacts(t, options = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-s11-production-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const sets = Object.fromEntries(Object.keys(CITY_TIME_ZONES).map((cityId) => [
    cityId,
    createArtifactRoot(base, cityId, options[cityId]),
  ]))
  return {
    sets,
    roots: Object.fromEntries(Object.entries(sets).map(([cityId, set]) => [cityId, set.root])),
    releases: Object.fromEntries(Object.entries(sets).map(([cityId, set]) => [cityId, {
      manifestId: set.manifest.manifestId,
      buildId: set.manifest.buildId,
    }])),
  }
}

function route(bytes, contentType, overrides = {}) {
  return {
    bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    contentType,
    status: 200,
    ...overrides,
  }
}

function remoteRoutes(fixture) {
  const routes = new Map()
  for (const [cityId, set] of Object.entries(fixture.sets)) {
    const baseUrl = new URL(CITY_PATHS[cityId], PRODUCT_ROOT)
    const manifestBytes = readFileSync(path.join(set.root, 'artifact-manifest.json'))
    routes.set(new URL('artifact-manifest.json', baseUrl).href, route(manifestBytes, 'application/json'))
    for (const name of ['events.json', 'places.json', 'guides.json']) {
      routes.set(new URL(name, baseUrl).href, route(readFileSync(path.join(set.root, name)), 'application/json'))
    }
    routes.set(
      new URL(`place-img/${set.imageName}`, baseUrl).href,
      route(readFileSync(path.join(set.root, 'place-img', set.imageName)), 'image/jpeg'),
    )
    const entryPath = `assets/index-${cityId}.js`
    const pinPath = `assets/nav-${cityId}.js`
    routes.set(baseUrl.href, route(
      `<html><head><script type="module" src="${baseUrl.pathname}${entryPath}"></script></head></html>`,
      'text/html',
    ))
    routes.set(new URL(entryPath, baseUrl).href, route(
      `import "./nav-${cityId}.js"; export const ready = true`,
      'application/javascript',
    ))
    routes.set(new URL(pinPath, baseUrl).href, route(
      `export const approvedManifest = "${set.manifest.manifestId}"`,
      'application/javascript',
    ))
  }
  return routes
}

function fixtureBrowserProbe(fixture, overrides = {}) {
  return async ({ cityId, baseUrl, timeZone }) => ({
    cityId,
    baseUrl: baseUrl.href,
    timeZone,
    runtimeStatus: 'ready',
    manifestId: fixture.releases[cityId].manifestId,
    buildId: fixture.releases[cityId].buildId,
    javascriptBytes: 256,
    javascriptFiles: 2,
    manifestPinned: true,
    ...(overrides[cityId] || {}),
  })
}

function fixtureFetch(routes, { mutate } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const original = routes.get(url)
    if (!original) return response(url, route('not found', 'text/plain', { status: 404 }))
    const selected = mutate ? (mutate({ url, call: calls.length, original, calls }) || original) : original
    return response(url, selected)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

function response(requestUrl, entry) {
  const bytes = Buffer.from(entry.bytes)
  const headers = new Map([
    ['content-type', entry.contentType],
    ['content-length', String(entry.contentLength ?? bytes.length)],
    ...(entry.contentEncoding ? [['content-encoding', entry.contentEncoding]] : []),
  ])
  return {
    status: entry.status,
    url: entry.responseUrl ?? requestUrl,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

test('observes exact two-city participant bytes and feeds only that complete release into the beta kit', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const fetchImpl = fixtureFetch(remoteRoutes(fixture))
  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl,
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })

  assert.equal(observed.status, 'observed')
  assert.deepEqual(observed.deployedReleases, fixture.releases)
  assert.equal(observed.cities.every((city) => city.status === 'observed'), true)
  assert.equal(observed.cities.every((city) => city.evidence.placeImageCount === 1), true)
  assert.equal(Object.isFrozen(observed.cities[0].evidence), true)
  assert.equal(fetchImpl.calls.every(({ options }) => (
    options.cache === 'no-store'
      && options.redirect === 'manual'
      && options.credentials === 'omit'
  )), true)

  const kit = prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: fixture.roots,
    deployedReleases: observed.deployedReleases,
  })
  assert.equal(kit.status, 'release-ready')
})

test('one tampered city blocks the complete deployed-release binding', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const routes = remoteRoutes(fixture)
  const target = new URL('events.json', PRODUCT_ROOT).href
  const original = routes.get(target)
  routes.set(target, route(Buffer.from(original.bytes).fill(0x20), 'application/json'))

  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl: fixtureFetch(routes),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })

  assert.equal(observed.status, 'blocked')
  assert.equal(observed.deployedReleases, null)
  assert.deepEqual(observed.blockers, ['CITY_NOT_OBSERVED:tampa-bay'])
  assert.deepEqual(
    observed.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['EVENTS_DIGEST_MISMATCH'],
  )
})

test('encoded transfer length is never confused with the decoded bytes being hashed', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const fetchImpl = fixtureFetch(remoteRoutes(fixture), {
    mutate: ({ original }) => ({
      ...original,
      contentEncoding: 'gzip',
      contentLength: Math.max(1, Math.floor(original.bytes.length / 2)),
    }),
  })
  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl,
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.equal(observed.status, 'observed')
  assert.deepEqual(observed.deployedReleases, fixture.releases)
})

test('redirects, HTTP fallback, wrong-city manifests, and oversized declarations fail closed', async (t) => {
  const cases = [
    {
      name: 'redirect',
      mutate: ({ url, original }) => url.endsWith('/artifact-manifest.json')
        ? { ...original, responseUrl: `${url}?redirected=1` }
        : original,
      problem: 'MANIFEST_REDIRECTED',
    },
    {
      name: 'html fallback',
      mutate: ({ url, original }) => url.endsWith('/artifact-manifest.json')
        ? route('<html>missing</html>', 'text/html', { status: 404 })
        : original,
      problem: 'MANIFEST_HTTP_404',
    },
    {
      name: 'oversize',
      mutate: ({ url, original }) => url.endsWith('/artifact-manifest.json')
        ? { ...original, contentLength: 600 * 1024 }
        : original,
      problem: 'RESPONSE_TOO_LARGE',
    },
    {
      name: 'content length mismatch',
      mutate: ({ url, original }) => url.endsWith('/artifact-manifest.json')
        ? { ...original, contentLength: original.bytes.length - 1 }
        : original,
      problem: 'CONTENT_LENGTH_MISMATCH',
    },
    {
      name: 'unsupported future shards',
      mutate: ({ url, original }) => {
        if (!url.endsWith('/artifact-manifest.json')) return original
        const manifest = JSON.parse(original.bytes.toString('utf8'))
        manifest.shards = ['future-shard.json']
        return route(`${JSON.stringify(manifest)}\n`, 'application/json')
      },
      problem: 'MANIFEST_SHARDS_UNSUPPORTED',
    },
  ]

  for (const current of cases) {
    await t.test(current.name, async () => {
      const fixture = createTwoCityArtifacts(t)
      const observed = await observeS11ParticipantRelease({
        nowMs: NOW_MS,
        productRootUrl: PRODUCT_ROOT,
        fetchImpl: fixtureFetch(remoteRoutes(fixture), { mutate: current.mutate }),
        browserProbe: fixtureBrowserProbe(fixture),
        attempts: 1,
      })
      assert.equal(observed.status, 'blocked')
      assert.equal(observed.deployedReleases, null)
      assert.equal(observed.cities.every((city) => city.problems[0] === current.problem), true)
    })
  }

  const fixture = createTwoCityArtifacts(t)
  const routes = remoteRoutes(fixture)
  const tampaUrl = new URL('artifact-manifest.json', PRODUCT_ROOT).href
  const sfUrl = new URL('artifact-manifest.json', new URL('sf/', PRODUCT_ROOT)).href
  routes.set(tampaUrl, routes.get(sfUrl))
  const wrongCity = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    fetchImpl: fixtureFetch(routes),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.equal(wrongCity.status, 'blocked')
  assert.deepEqual(
    wrongCity.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['MANIFEST_CONTRACT_INVALID'],
  )
})

test('image-tree tampering and loaded browser scripts without the manifest pin both block', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const imageRoutes = remoteRoutes(fixture)
  const tampaImageUrl = new URL(
    `place-img/${fixture.sets['tampa-bay'].imageName}`,
    PRODUCT_ROOT,
  ).href
  const originalImage = imageRoutes.get(tampaImageUrl)
  imageRoutes.set(tampaImageUrl, route(Buffer.from(originalImage.bytes).fill(0x78), 'image/jpeg'))
  const imageResult = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    fetchImpl: fixtureFetch(imageRoutes),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.deepEqual(
    imageResult.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['PLACE_IMAGE_DIGEST_MISMATCH'],
  )

  const scriptResult = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture, {
      'tampa-bay': { manifestPinned: false },
    }),
    attempts: 1,
  })
  assert.deepEqual(
    scriptResult.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['APP_MANIFEST_PIN_MISSING'],
  )
})

test('actual loaded script bytes handle minified imports while static decoys and runtime mismatches fail closed', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const manifestId = fixture.releases['tampa-bay'].manifestId
  const scriptRecord = (source) => ({
    bytes: Buffer.from(source),
    contentType: 'application/javascript',
    redirected: false,
    status: 200,
  })
  const minified = inspectS11LoadedJavascript([
    scriptRecord('import{pin}from"./nav.js";export{pin};'),
    scriptRecord(`export const pin="${manifestId}";`),
  ], manifestId)
  assert.equal(minified.manifestPinned, true)
  assert.equal(minified.javascriptFiles, 2)

  const decoy = inspectS11LoadedJavascript([
    scriptRecord('/* import x from "./nav.js" */ const value="import x from ./nav.js";'),
  ], manifestId)
  assert.equal(decoy.manifestPinned, false)

  const decoyResult = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture, {
      'tampa-bay': { manifestPinned: decoy.manifestPinned },
    }),
    attempts: 1,
  })
  assert.deepEqual(
    decoyResult.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['APP_MANIFEST_PIN_MISSING'],
  )

  const wrongRuntimeManifest = `sha256:${'d'.repeat(64)}`
  const runtimeResult = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture, {
      'tampa-bay': { manifestId: wrongRuntimeManifest },
    }),
    attempts: 1,
  })
  assert.deepEqual(
    runtimeResult.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['APP_RUNTIME_IDENTITY_MISMATCH'],
  )

  const prepopulatedRoutes = remoteRoutes(fixture)
  prepopulatedRoutes.set(PRODUCT_ROOT, route(
    `<html><body><div class="app" data-city-runtime-status="ready" data-manifest-id="${manifestId}" data-build-id="${fixture.releases['tampa-bay'].buildId}"></div></body></html>`,
    'text/html',
  ))
  const prepopulated = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl: fixtureFetch(prepopulatedRoutes),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.deepEqual(
    prepopulated.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['APP_RUNTIME_MARKER_PREPOPULATED'],
  )
})

test('a manifest flip retries the whole city and never binds mixed generations', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const routes = remoteRoutes(fixture)
  const tampaManifestUrl = new URL('artifact-manifest.json', PRODUCT_ROOT).href
  let tampaManifestReads = 0
  const fetchImpl = fixtureFetch(routes, {
    mutate: ({ url, original }) => {
      if (url !== tampaManifestUrl) return original
      tampaManifestReads += 1
      if (tampaManifestReads === 2) {
        return { ...original, bytes: Buffer.concat([original.bytes, Buffer.from(' ')]) }
      }
      return original
    },
  })

  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl,
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 2,
  })

  assert.equal(observed.status, 'observed')
  assert.equal(observed.cities.find((city) => city.cityId === 'tampa-bay').attemptsUsed, 2)
  assert.deepEqual(observed.deployedReleases, fixture.releases)
})

test('exact production bytes without the approved two-city release pair remain unbound', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })

  assert.equal(observed.status, 'observed-unbound')
  assert.equal(observed.deployedReleases, null)
  assert.deepEqual(observed.blockers, ['EXPECTED_RELEASE_BINDING_REQUIRED'])
  assert.equal(observed.cities.every((city) => city.status === 'observed'), true)
})

test('stale or source-unverified exact production remains observed but cannot authorize beta', async (t) => {
  const fixture = createTwoCityArtifacts(t, {
    'sf-east-bay': {
      generatedAt: '2026-07-01T10:00:00.000Z',
      assembledAt: '2026-07-01T10:05:00.000Z',
      healthStatus: 'unknown',
    },
    'tampa-bay': {
      generatedAt: '2026-07-01T10:00:00.000Z',
      assembledAt: '2026-07-01T10:05:00.000Z',
      healthStatus: 'unknown',
    },
  })
  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: fixture.releases,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.equal(observed.status, 'observed')

  const kit = prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: fixture.roots,
    deployedReleases: observed.deployedReleases,
  })
  assert.equal(kit.status, 'blocked')
  assert.equal(kit.kit, null)
  assert.equal(kit.cities.every((city) => city.problems.some((problem) => (
    problem.includes('past its manifest max age')
      || problem.includes('source health is not fully verified')
  ))), true)
})

test('expected-release mismatch and malformed observer inputs never silently rebind', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const mismatch = structuredClone(fixture.releases)
  mismatch['tampa-bay'].manifestId = `sha256:${'e'.repeat(64)}`
  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: mismatch,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.equal(observed.deployedReleases, null)
  assert.deepEqual(
    observed.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['EXPECTED_RELEASE_MISMATCH'],
  )

  await assert.rejects(() => observeS11ParticipantRelease(), /requires an explicit nowMs/)
  await assert.rejects(() => observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: 'http://participant.example/wuzup/',
  }), /credential-free HTTPS/)
  await assert.rejects(() => observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: 'https://participant.example/wuzup/',
  }), /canonical Wuzup production root/)
  await assert.rejects(() => observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    expectedReleases: { 'tampa-bay': fixture.releases['tampa-bay'] },
  }), /must contain exactly/)

  const emptyCliRoot = spawnSync(
    process.execPath,
    [path.join(ROOT, 'shared', 'beta-production-observation.mjs'), ''],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(emptyCliRoot.status, 1)
  assert.match(emptyCliRoot.stderr, /productRootUrl must be a non-empty URL/)
})

test('production attestation distinguishes observed publication from release-ready policy', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const result = await buildS11ProductionAttestation({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    artifactRoots: fixture.roots,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
    retryDelayMs: 0,
  })
  assert.equal(result.status, 'release-ready')
  assert.equal(result.observation.status, 'observed')
  assert.equal(result.betaReadiness.status, 'release-ready')
})

test('Pages deploy is main-only and retains a post-deploy observation without widening build permissions', () => {
  const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8')
  assert.match(workflow, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /git rev-parse HEAD.*GITHUB_SHA/s)
  assert.match(workflow, /REQUIRE_FRESH_ARTIFACTS=1 REQUIRE_VERIFIED_SOURCES=1 CITY=tampa-bay node finder\/deploy\.mjs/)
  assert.match(workflow, /REQUIRE_FRESH_ARTIFACTS=1 REQUIRE_VERIFIED_SOURCES=1 CITY=sf-east-bay node finder\/deploy\.mjs/)
  assert.match(workflow, /deploy:\s+needs: build[\s\S]*?permissions:\s+contents: read\s+pages: write\s+id-token: write/)
  assert.match(workflow, /attest:\s+needs: deploy/)
  assert.match(workflow, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'[\s\S]*?npm ci --ignore-scripts/)
  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /PRODUCT_ROOT="\$\{\{ needs\.deploy\.outputs\.page_url \}\}"/)
  assert.match(workflow, /if \[ -z "\$PRODUCT_ROOT" \]/)
  assert.match(workflow, /Observe participant-facing release bytes[\s\S]*?set -o pipefail[\s\S]*?\| tee/)
  assert.match(workflow, /node shared\/beta-production-observation\.mjs/)
  assert.match(workflow, /retention-days: 90/)
  const globalPermissions = workflow.match(/^permissions:\s*\n((?:  .+\n)+)/m)?.[1] || ''
  assert.equal(globalPermissions.includes('pages: write'), false)
  assert.equal(globalPermissions.includes('id-token: write'), false)
})
