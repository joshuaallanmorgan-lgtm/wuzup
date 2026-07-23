import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  inspectS11ExecutedSiteBytes,
  inspectS11LoadedJavascript,
  observeS11ParticipantRelease,
  S11_PRODUCTION_ROOT_URL,
} from '../shared/beta-production-observation.mjs'
import { prepareS11BetaReleaseKit } from '../shared/beta-release-kit.mjs'
import { createS11SiteReleaseReceipt } from '../shared/site-release-contract.mjs'

const NOW_MS = Date.parse('2026-07-22T12:00:00.000Z')
const PRODUCT_ROOT = S11_PRODUCTION_ROOT_URL
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_COMMIT = 'a'.repeat(40)
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
  const fixture = {
    sets,
    roots: Object.fromEntries(Object.entries(sets).map(([cityId, set]) => [cityId, set.root])),
    releases: Object.fromEntries(Object.entries(sets).map(([cityId, set]) => [cityId, {
      manifestId: set.manifest.manifestId,
      buildId: set.manifest.buildId,
    }])),
  }
  const files = fixtureParticipantFiles(fixture)
    .map(({ filePath, bytes }) => ({
      path: filePath,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  fixture.sourceCommit = SOURCE_COMMIT
  fixture.siteReceipt = createS11SiteReleaseReceipt({
    sourceCommit: fixture.sourceCommit,
    releases: fixture.releases,
    files,
  })
  return fixture
}

function route(bytes, contentType, overrides = {}) {
  return {
    bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    contentType,
    status: 200,
    ...overrides,
  }
}

function fixtureParticipantFiles(fixture) {
  const files = []
  for (const [cityId, set] of Object.entries(fixture.sets)) {
    const baseUrl = new URL(CITY_PATHS[cityId], PRODUCT_ROOT)
    const prefix = CITY_PATHS[cityId]
    const manifestBytes = readFileSync(path.join(set.root, 'artifact-manifest.json'))
    files.push({
      filePath: `${prefix}artifact-manifest.json`,
      url: new URL('artifact-manifest.json', baseUrl).href,
      bytes: manifestBytes,
      contentType: 'application/json',
    })
    for (const name of ['events.json', 'places.json', 'guides.json']) {
      files.push({
        filePath: `${prefix}${name}`,
        url: new URL(name, baseUrl).href,
        bytes: readFileSync(path.join(set.root, name)),
        contentType: 'application/json',
      })
    }
    files.push({
      filePath: `${prefix}place-img/${set.imageName}`,
      url: new URL(`place-img/${set.imageName}`, baseUrl).href,
      bytes: readFileSync(path.join(set.root, 'place-img', set.imageName)),
      contentType: 'image/jpeg',
    })
    const entryPath = `assets/index-${cityId}.js`
    const pinPath = `assets/nav-${cityId}.js`
    files.push({
      filePath: `${prefix}index.html`,
      url: baseUrl.href,
      bytes: Buffer.from(`<html><head><script type="module" src="${baseUrl.pathname}${entryPath}"></script></head></html>`),
      contentType: 'text/html',
    })
    files.push({
      filePath: `${prefix}${entryPath}`,
      url: new URL(entryPath, baseUrl).href,
      bytes: Buffer.from(`import "./nav-${cityId}.js"; export const ready = true`),
      contentType: 'application/javascript',
    })
    files.push({
      filePath: `${prefix}${pinPath}`,
      url: new URL(pinPath, baseUrl).href,
      bytes: Buffer.from(`export const approvedManifest = "${set.manifest.manifestId}"`),
      contentType: 'application/javascript',
    })
    files.push({
      filePath: `${prefix}assets/app-${cityId}.css`,
      url: new URL(`assets/app-${cityId}.css`, baseUrl).href,
      bytes: Buffer.from('.app { display: block; }'),
      contentType: 'text/css',
    })
    files.push({
      filePath: `${prefix}fonts/inter-${cityId}.woff2`,
      url: new URL(`fonts/inter-${cityId}.woff2`, baseUrl).href,
      bytes: Buffer.from(`fixture font for ${cityId}`),
      contentType: 'font/woff2',
    })
    files.push({
      filePath: `${prefix}manifest.webmanifest`,
      url: new URL('manifest.webmanifest', baseUrl).href,
      bytes: Buffer.from(`{"name":"Wuzup ${cityId}"}\n`),
      contentType: 'application/manifest+json',
    })
    files.push({
      filePath: `${prefix}favicon.svg`,
      url: new URL('favicon.svg', baseUrl).href,
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      contentType: 'image/svg+xml',
    })
  }
  return files
}

function remoteRoutes(fixture) {
  const routes = new Map(fixtureParticipantFiles(fixture).map((entry) => [
    entry.url,
    route(entry.bytes, entry.contentType),
  ]))
  routes.set(
    new URL('site-release.json', PRODUCT_ROOT).href,
    route(`${JSON.stringify(fixture.siteReceipt, null, 2)}\n`, 'application/json'),
  )
  return routes
}

function siteBindings(fixture) {
  return {
    expectedReleases: fixture.releases,
    expectedSiteReleaseId: fixture.siteReceipt.releaseId,
    expectedSourceCommit: fixture.sourceCommit,
  }
}

function fixtureExecutedSiteEvidence(fixture, cityId) {
  const prefix = CITY_PATHS[cityId]
  const belongsToCity = (filePath) => prefix
    ? filePath.startsWith(prefix)
    : !filePath.startsWith(CITY_PATHS['sf-east-bay'])
  const files = fixtureParticipantFiles(fixture).filter((entry) => belongsToCity(entry.filePath))
  const document = files.find((entry) => entry.filePath === `${prefix}index.html`)
  return {
    baseUrl: new URL(prefix, PRODUCT_ROOT),
    documentRecord: {
      bytes: Buffer.from(document.bytes),
      contentType: document.contentType,
      redirected: false,
      status: 200,
      url: document.url,
    },
    scriptRecords: files
      .filter((entry) => entry.filePath.endsWith('.js'))
      .map((entry) => ({
        bytes: Buffer.from(entry.bytes),
        contentType: entry.contentType,
        redirected: false,
        status: 200,
        url: entry.url,
      })),
  }
}

function receiptBoundFixtureBrowserProbe(fixture, mutateEvidence = (evidence) => evidence) {
  return async ({ cityId, baseUrl, timeZone, siteReceipt }) => {
    const evidence = mutateEvidence(fixtureExecutedSiteEvidence(fixture, cityId), cityId)
    const siteProof = inspectS11ExecutedSiteBytes({
      cityId,
      baseUrl,
      siteReceipt,
      documentRecord: evidence.documentRecord,
      scriptRecords: evidence.scriptRecords,
    })
    return {
      cityId,
      baseUrl: baseUrl.href,
      timeZone,
      runtimeStatus: 'ready',
      manifestId: fixture.releases[cityId].manifestId,
      buildId: fixture.releases[cityId].buildId,
      ...siteProof,
    }
  }
}

function fixtureBrowserProbe(fixture, overrides = {}) {
  return async ({ cityId, baseUrl, timeZone, siteReceipt }) => ({
    cityId,
    baseUrl: baseUrl.href,
    timeZone,
    runtimeStatus: 'ready',
    manifestId: fixture.releases[cityId].manifestId,
    buildId: fixture.releases[cityId].buildId,
    javascriptBytes: 256,
    javascriptFiles: 2,
    manifestPinned: true,
    siteBytesVerified: true,
    siteReleaseId: siteReceipt.releaseId,
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

function urlReadNumber(calls, url) {
  return calls.reduce((count, call) => count + Number(call.url === url), 0)
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
    ...siteBindings(fixture),
    fetchImpl,
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })

  assert.equal(observed.status, 'observed')
  assert.equal(observed.schemaVersion, 2)
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
    deployedSiteReleaseId: observed.site.releaseId,
  })
  assert.equal(kit.status, 'release-ready')
})

test('wrong composed-site release or source identities fail before either city can bind', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const cases = [
    {
      field: 'expectedSiteReleaseId',
      value: `sha256:${'b'.repeat(64)}`,
      problem: 'SITE_RELEASE_ID_MISMATCH',
    },
    {
      field: 'expectedSourceCommit',
      value: 'b'.repeat(40),
      problem: 'SITE_SOURCE_COMMIT_MISMATCH',
    },
  ]
  for (const current of cases) {
    await t.test(current.field, async () => {
      let browserCalls = 0
      const observed = await observeS11ParticipantRelease({
        nowMs: NOW_MS,
        productRootUrl: PRODUCT_ROOT,
        ...siteBindings(fixture),
        [current.field]: current.value,
        fetchImpl: fixtureFetch(remoteRoutes(fixture)),
        browserProbe: async () => {
          browserCalls += 1
          throw new Error('browser must not run for an unbound site receipt')
        },
        attempts: 1,
      })
      assert.equal(observed.status, 'blocked')
      assert.equal(observed.deployedReleases, null)
      assert.deepEqual(observed.site.problems, [current.problem])
      assert.equal(browserCalls, 0)
    })
  }
})

test('missing or tampered participant-facing files invalidate the composed site before city probes', async (t) => {
  const cases = [
    {
      name: 'tampered file',
      problem: 'SITE_FILE_DIGEST_MISMATCH',
      mutate: (routes, target) => {
        const original = routes.get(target)
        routes.set(target, route(Buffer.from(original.bytes).fill(0x20), original.contentType))
      },
    },
    {
      name: 'missing file',
      problem: 'SITE_FILE_HTTP_404',
      mutate: (routes, target) => routes.delete(target),
    },
  ]
  for (const current of cases) {
    await t.test(current.name, async () => {
      const fixture = createTwoCityArtifacts(t)
      const routes = remoteRoutes(fixture)
      current.mutate(routes, new URL('events.json', PRODUCT_ROOT).href)
      const observed = await observeS11ParticipantRelease({
        nowMs: NOW_MS,
        productRootUrl: PRODUCT_ROOT,
        ...siteBindings(fixture),
        fetchImpl: fixtureFetch(routes),
        browserProbe: fixtureBrowserProbe(fixture),
        attempts: 1,
      })
      assert.equal(observed.status, 'blocked')
      assert.equal(observed.deployedReleases, null)
      assert.deepEqual(observed.site.problems, [current.problem])
      assert.equal(observed.cities.every((city) => (
        city.problems[0] === 'SITE_TRANSACTION_NOT_ATTEMPTED'
      )), true)
    })
  }
})

test('receipt-byte flips retry the complete site and both city probes as one transaction', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const routes = remoteRoutes(fixture)
  const receiptUrl = new URL('site-release.json', PRODUCT_ROOT).href
  const browserCalls = []
  const baseProbe = fixtureBrowserProbe(fixture)
  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    ...siteBindings(fixture),
    fetchImpl: fixtureFetch(routes, {
      mutate: ({ url, original, calls }) => (
        url === receiptUrl && urlReadNumber(calls, url) === 2
          ? { ...original, bytes: Buffer.concat([original.bytes, Buffer.from(' ')]) }
          : original
      ),
    }),
    browserProbe: async (options) => {
      browserCalls.push(options.cityId)
      return baseProbe(options)
    },
    attempts: 2,
  })
  assert.equal(observed.status, 'observed')
  assert.equal(observed.site.attemptsUsed, 2)
  assert.equal(observed.cities.every((city) => city.attemptsUsed === 2), true)
  assert.deepEqual(browserCalls, [
    'sf-east-bay',
    'tampa-bay',
    'sf-east-bay',
    'tampa-bay',
  ])
})

test('one tampered city blocks the complete deployed-release binding', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const routes = remoteRoutes(fixture)
  const target = new URL('events.json', PRODUCT_ROOT).href
  const fetchImpl = fixtureFetch(routes, {
    mutate: ({ url, original, calls }) => (
      url === target && urlReadNumber(calls, url) === 2
        ? route(Buffer.from(original.bytes).fill(0x20), 'application/json')
        : original
    ),
  })

  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    ...siteBindings(fixture),
    fetchImpl,
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
    ...siteBindings(fixture),
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
      mutate: ({ url, original, calls }) => (
        url.endsWith('/artifact-manifest.json') && urlReadNumber(calls, url) === 2
        ? { ...original, responseUrl: `${url}?redirected=1` }
        : original
      ),
      problem: 'MANIFEST_REDIRECTED',
    },
    {
      name: 'html fallback',
      mutate: ({ url, original, calls }) => (
        url.endsWith('/artifact-manifest.json') && urlReadNumber(calls, url) === 2
        ? route('<html>missing</html>', 'text/html', { status: 404 })
        : original
      ),
      problem: 'MANIFEST_HTTP_404',
    },
    {
      name: 'oversize',
      mutate: ({ url, original, calls }) => (
        url.endsWith('/artifact-manifest.json') && urlReadNumber(calls, url) === 2
        ? { ...original, contentLength: 600 * 1024 }
        : original
      ),
      problem: 'RESPONSE_TOO_LARGE',
    },
    {
      name: 'content length mismatch',
      mutate: ({ url, original, calls }) => (
        url.endsWith('/artifact-manifest.json') && urlReadNumber(calls, url) === 2
        ? { ...original, contentLength: original.bytes.length - 1 }
        : original
      ),
      problem: 'CONTENT_LENGTH_MISMATCH',
    },
    {
      name: 'unsupported future shards',
      mutate: ({ url, original, calls }) => {
        if (!url.endsWith('/artifact-manifest.json') || urlReadNumber(calls, url) !== 2) return original
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
  const wrongCity = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    fetchImpl: fixtureFetch(routes, {
      mutate: ({ url, original, calls }) => (
        url === tampaUrl && urlReadNumber(calls, url) === 2 ? routes.get(sfUrl) : original
      ),
    }),
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
  const imageResult = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    fetchImpl: fixtureFetch(imageRoutes, {
      mutate: ({ url, original, calls }) => (
        url === tampaImageUrl && urlReadNumber(calls, url) === 2
          ? route(Buffer.from(original.bytes).fill(0x78), 'image/jpeg')
          : original
      ),
    }),
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
    ...siteBindings(fixture),
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
    ...siteBindings(fixture),
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
  const prepopulated = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    ...siteBindings(fixture),
    fetchImpl: fixtureFetch(prepopulatedRoutes, {
      mutate: ({ url, original, calls }) => (
        url === PRODUCT_ROOT && urlReadNumber(calls, url) === 2
          ? route(
            `<html><body><div class="app" data-city-runtime-status="ready" data-manifest-id="${manifestId}" data-build-id="${fixture.releases['tampa-bay'].buildId}"></div></body></html>`,
            'text/html',
          )
          : original
      ),
    }),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.deepEqual(
    prepopulated.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['APP_RUNTIME_MARKER_PREPOPULATED'],
  )
})

test('browser-executed HTML and scripts must be exact members of receipt A while the site bracket stays A', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  for (const cityId of Object.keys(CITY_PATHS)) {
    const evidence = fixtureExecutedSiteEvidence(fixture, cityId)
    const proof = inspectS11ExecutedSiteBytes({
      cityId,
      baseUrl: evidence.baseUrl,
      siteReceipt: fixture.siteReceipt,
      documentRecord: evidence.documentRecord,
      scriptRecords: evidence.scriptRecords,
    })
    assert.equal(proof.siteBytesVerified, true)
    assert.equal(proof.siteReleaseId, fixture.siteReceipt.releaseId)
    assert.equal(proof.manifestPinned, true)
  }

  const cases = [
    {
      name: 'HTML B',
      problem: 'APP_HTML_SITE_DIGEST_MISMATCH',
      mutate: (evidence) => ({
        ...evidence,
        documentRecord: {
          ...evidence.documentRecord,
          bytes: Buffer.from(evidence.documentRecord.bytes).fill(0x78),
        },
      }),
    },
    {
      name: 'loaded script B',
      problem: 'APP_SCRIPT_SITE_DIGEST_MISMATCH',
      mutate: (evidence) => ({
        ...evidence,
        scriptRecords: evidence.scriptRecords.map((record, index) => index === 0
          ? { ...record, bytes: Buffer.from(record.bytes).fill(0x78) }
          : record),
      }),
    },
    {
      name: 'unexpected same-origin script',
      problem: 'APP_SCRIPT_NOT_IN_SITE_RELEASE',
      mutate: (evidence) => ({
        ...evidence,
        scriptRecords: [
          ...evidence.scriptRecords,
          {
            bytes: Buffer.from('export const unexpected = true'),
            contentType: 'application/javascript',
            redirected: false,
            status: 200,
            url: new URL('assets/unexpected.js', PRODUCT_ROOT).href,
          },
        ],
      }),
    },
  ]

  for (const current of cases) {
    await t.test(current.name, async () => {
      const observed = await observeS11ParticipantRelease({
        nowMs: NOW_MS,
        productRootUrl: PRODUCT_ROOT,
        ...siteBindings(fixture),
        fetchImpl: fixtureFetch(remoteRoutes(fixture)),
        browserProbe: receiptBoundFixtureBrowserProbe(fixture, (evidence, cityId) => (
          cityId === 'tampa-bay' ? current.mutate(evidence) : evidence
        )),
        attempts: 1,
      })
      assert.equal(observed.status, 'blocked')
      assert.equal(observed.site.status, 'observed')
      assert.deepEqual(
        observed.cities.find((city) => city.cityId === 'tampa-bay').problems,
        [current.problem],
      )
    })
  }

  for (const override of [
    { siteBytesVerified: false },
    { siteReleaseId: `sha256:${'f'.repeat(64)}` },
  ]) {
    const observed = await observeS11ParticipantRelease({
      nowMs: NOW_MS,
      productRootUrl: PRODUCT_ROOT,
      ...siteBindings(fixture),
      fetchImpl: fixtureFetch(remoteRoutes(fixture)),
      browserProbe: fixtureBrowserProbe(fixture, { 'tampa-bay': override }),
      attempts: 1,
    })
    assert.deepEqual(
      observed.cities.find((city) => city.cityId === 'tampa-bay').problems,
      ['APP_SITE_BYTES_MISMATCH'],
    )
  }
})

test('a city manifest flip retries the whole site and never binds mixed generations', async (t) => {
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
  const browserCalls = []
  const baseProbe = fixtureBrowserProbe(fixture)

  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    ...siteBindings(fixture),
    fetchImpl,
    browserProbe: async (options) => {
      browserCalls.push(options.cityId)
      return baseProbe(options)
    },
    attempts: 2,
  })

  assert.equal(observed.status, 'observed')
  assert.equal(observed.site.attemptsUsed, 2)
  assert.equal(observed.cities.find((city) => city.cityId === 'tampa-bay').attemptsUsed, 2)
  assert.deepEqual(observed.deployedReleases, fixture.releases)
  assert.deepEqual(browserCalls, [
    'sf-east-bay',
    'tampa-bay',
    'sf-east-bay',
    'tampa-bay',
  ])
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

test('an unbound receipt still pins each city probe to its own declared release identities', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const rogueReleases = structuredClone(fixture.releases)
  rogueReleases['tampa-bay'].manifestId = `sha256:${'c'.repeat(64)}`
  const rogueReceipt = createS11SiteReleaseReceipt({
    sourceCommit: fixture.sourceCommit,
    releases: rogueReleases,
    files: fixture.siteReceipt.files,
  })
  const routes = remoteRoutes(fixture)
  routes.set(
    new URL('site-release.json', PRODUCT_ROOT).href,
    route(`${JSON.stringify(rogueReceipt, null, 2)}\n`, 'application/json'),
  )
  const observed = await observeS11ParticipantRelease({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    fetchImpl: fixtureFetch(routes),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })

  assert.equal(observed.status, 'blocked')
  assert.equal(observed.deployedReleases, null)
  assert.equal(observed.site.status, 'observed')
  assert.deepEqual(
    observed.cities.find((city) => city.cityId === 'tampa-bay').problems,
    ['EXPECTED_RELEASE_MISMATCH'],
  )
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
    ...siteBindings(fixture),
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.equal(observed.status, 'observed')

  const kit = prepareS11BetaReleaseKit({
    nowMs: NOW_MS,
    artifactRoots: fixture.roots,
    deployedReleases: observed.deployedReleases,
    deployedSiteReleaseId: observed.site.releaseId,
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
    ...siteBindings(fixture),
    expectedReleases: mismatch,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
  })
  assert.equal(observed.deployedReleases, null)
  assert.deepEqual(observed.site.problems, ['SITE_CITY_RELEASE_MISMATCH'])

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

  const missingCliBindings = spawnSync(
    process.execPath,
    [path.join(ROOT, 'shared', 'beta-production-observation.mjs'), ''],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(missingCliBindings.status, 1)
  assert.match(missingCliBindings.stderr, /usage:/)

  const emptyCliRoot = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'shared', 'beta-production-observation.mjs'),
      '',
      fixture.siteReceipt.releaseId,
      fixture.sourceCommit,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(emptyCliRoot.status, 1)
  assert.match(emptyCliRoot.stderr, /productRootUrl must be a non-empty URL/)

  const emptyCliSiteId = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'shared', 'beta-production-observation.mjs'),
      PRODUCT_ROOT,
      '',
      fixture.sourceCommit,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(emptyCliSiteId.status, 1)
  assert.match(emptyCliSiteId.stderr, /expectedSiteReleaseId is invalid/)
})

test('production attestation distinguishes observed publication from release-ready policy', async (t) => {
  const fixture = createTwoCityArtifacts(t)
  const result = await buildS11ProductionAttestation({
    nowMs: NOW_MS,
    productRootUrl: PRODUCT_ROOT,
    artifactRoots: fixture.roots,
    expectedSiteReleaseId: fixture.siteReceipt.releaseId,
    expectedSourceCommit: fixture.sourceCommit,
    fetchImpl: fixtureFetch(remoteRoutes(fixture)),
    browserProbe: fixtureBrowserProbe(fixture),
    attempts: 1,
    retryDelayMs: 0,
  })
  assert.equal(result.status, 'release-ready')
  assert.equal(result.schemaVersion, 2)
  assert.equal(result.observation.status, 'observed')
  assert.equal(result.betaReadiness.status, 'release-ready')
})

test('Pages deploy is main-only and retains a post-deploy observation without widening build permissions', () => {
  const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8')
  assert.match(workflow, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /git rev-parse HEAD.*GITHUB_SHA/s)
  assert.match(workflow, /build:\s+runs-on: ubuntu-latest\s+timeout-minutes: 45/)
  assert.match(workflow, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'[\s\S]*?npm ci[\s\S]*?npm --prefix app ci/)
  assert.match(workflow, /Gate the exact deployment commit\s+run: npm test/)
  assert.match(workflow, /Run exact-deployment browser journeys[\s\S]*?npm run test:browser\s+npm run test:browser-s9\s+npm run test:browser-s10/)
  assert.match(workflow, /REQUIRE_FRESH_ARTIFACTS=1 REQUIRE_VERIFIED_SOURCES=1 CITY=tampa-bay node finder\/deploy\.mjs/)
  assert.match(workflow, /REQUIRE_FRESH_ARTIFACTS=1 REQUIRE_VERIFIED_SOURCES=1 CITY=sf-east-bay node finder\/deploy\.mjs/)
  assert.match(workflow, /WUZUP_BUILD_DIR: _site\s+run: npm run test:s10-performance/)
  assert.match(workflow, /WUZUP_BUILD_DIR: _site\/sf\s+run: npm run test:s10-performance/)
  assert.ok(
    workflow.indexOf('Gate the exact deployment commit') < workflow.indexOf('Stage + build Tampa Bay'),
    'the exact-SHA gate must complete before final release assembly',
  )
  assert.ok(
    workflow.indexOf('Run exact-deployment browser journeys') < workflow.indexOf('Stage + build Tampa Bay'),
    'the exact-SHA browser journeys must complete before final release assembly',
  )
  assert.match(workflow, /deploy:\s+needs: build[\s\S]*?permissions:\s+contents: read\s+pages: write\s+id-token: write/)
  assert.match(workflow, /attest:\s+needs: \[build, deploy\]/)
  assert.match(workflow, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'[\s\S]*?npm ci --ignore-scripts/)
  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /PRODUCT_ROOT="\$\{\{ needs\.deploy\.outputs\.page_url \}\}"/)
  assert.match(workflow, /if \[ -z "\$PRODUCT_ROOT" \]/)
  assert.match(workflow, /Observe participant-facing release bytes[\s\S]*?set -o pipefail[\s\S]*?\| tee/)
  assert.match(workflow, /node shared\/beta-production-observation\.mjs/)
  assert.match(workflow, /"\$PRODUCT_ROOT" "\$SITE_RELEASE_ID" "\$SOURCE_COMMIT"/)
  assert.match(workflow, /retention-days: 90/)
  const globalPermissions = workflow.match(/^permissions:\s*\n((?:  .+\n)+)/m)?.[1] || ''
  assert.equal(globalPermissions.includes('pages: write'), false)
  assert.equal(globalPermissions.includes('id-token: write'), false)
})
