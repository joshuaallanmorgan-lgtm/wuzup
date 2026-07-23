import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  calculateBuildId,
  calculateManifestId,
} from '../finder/artifact-manifest.mjs'
import {
  ARTIFACT_SPECS,
  expiresAt,
} from '../shared/artifact-contract.mjs'
import { canonicalCitiesIndexJson } from '../shared/cities-index-core.mjs'
import {
  CityArtifactLoaderError,
  createCityArtifactLoader,
} from '../app/src/city-artifact-loader.js'

const NOW = '2026-07-22T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const ROOT = 'https://example.test/wuzup/'
const CITY_FACTS = Object.freeze({
  'tampa-bay': Object.freeze({
    name: 'Tampa Bay',
    shortName: 'Tampa',
    region: 'Florida',
    timeZone: 'America/New_York',
    center: { lat: 27.95, lng: -82.46 },
    bbox: { south: 27.3, west: -83.3, north: 28.6, east: -81.9 },
    aliases: ['tampa', 'tpa'],
  }),
  'sf-east-bay': Object.freeze({
    name: 'SF & East Bay',
    shortName: 'SF / East Bay',
    region: 'California',
    timeZone: 'America/Los_Angeles',
    center: { lat: 37.84, lng: -122.25 },
    bbox: { south: 37.68, west: -122.53, north: 38, east: -121.88 },
    aliases: ['sf', 'san-francisco', 'east-bay'],
  }),
})

const jsonBytes = (value) => new TextEncoder().encode(`${JSON.stringify(value)}\n`)
const shaHex = (bytes) => createHash('sha256').update(bytes).digest('hex')
const shaId = (bytes) => `sha256:${shaHex(bytes)}`

function sourceHealth(runId, checkedAt, rows) {
  return {
    status: 'healthy',
    runId,
    checkedAt,
    total: 1,
    healthy: 1,
    degraded: 0,
    failed: 0,
    unknown: 0,
    sources: [{ name: 'Fixture source', status: 'healthy', rows, cached: false }],
  }
}

function artifactEntry(kind, bytes, rows, generatedAt, runId) {
  const spec = ARTIFACT_SPECS[kind]
  return {
    file: spec.file,
    sha256: shaHex(bytes),
    bytes: bytes.byteLength,
    count: rows,
    runId,
    generatedAt,
    expiresAt: expiresAt(generatedAt, spec.maxAgeHours),
    maxAgeHours: spec.maxAgeHours,
    provenance: 'fixture-live',
    ...(spec.maxAgeHours != null ? { sourceHealth: sourceHealth(runId, generatedAt, rows) } : {}),
  }
}

function cityRelease(cityId) {
  const facts = CITY_FACTS[cityId]
  const generatedAt = '2026-07-22T10:00:00.000Z'
  const events = [{
    id: `${cityId}-event-1`,
    title: `${facts.shortName} fixture event`,
    start: cityId === 'tampa-bay' ? '2026-07-23T19:00:00-04:00' : '2026-07-23T19:00:00-07:00',
  }]
  const places = {
    schemaVersion: 1,
    places: [{
      key: `p|${cityId}-fixture`,
      name: `${facts.shortName} fixture place`,
      lat: facts.center.lat,
      lng: facts.center.lng,
      image: '/place-img/shared-name.jpg',
      imageCredit: { license: 'CC0', url: 'https://example.test/source' },
    }],
  }
  const guides = {
    schemaVersion: 1,
    guides: [{ id: `${cityId}-guide-1`, title: `${facts.shortName} guide` }],
  }
  const documents = { events, places, guides }
  const bytes = Object.fromEntries(Object.entries(documents).map(([kind, value]) => [kind, jsonBytes(value)]))
  const eventRunId = `${cityId}-event-run`
  const artifacts = {
    events: artifactEntry('events', bytes.events, events.length, generatedAt, eventRunId),
    places: artifactEntry('places', bytes.places, places.places.length, generatedAt, `${cityId}-place-run`),
    guides: artifactEntry('guides', bytes.guides, guides.guides.length, generatedAt, `${cityId}-guide-run`),
  }
  const manifest = {
    schemaVersion: 1,
    cityId,
    timeZone: facts.timeZone,
    runId: eventRunId,
    generatedAt,
    expiresAt: artifacts.events.expiresAt,
    maxAgeHours: artifacts.events.maxAgeHours,
    assembledAt: '2026-07-22T10:05:00.000Z',
    provenance: artifacts.events.provenance,
    sourceHealth: artifacts.events.sourceHealth,
    artifacts,
    placeImages: {
      dir: 'place-img',
      sha256: shaHex(new Uint8Array()),
      bytes: 0,
      count: 0,
    },
    shards: [],
  }
  manifest.buildId = calculateBuildId(manifest)
  manifest.manifestId = calculateManifestId(manifest)
  const releasePath = `/wuzup/cities/${cityId}/releases/${manifest.manifestId.slice('sha256:'.length)}/`
  return {
    cityId,
    facts,
    documents,
    bytes,
    manifest,
    manifestBytes: jsonBytes(manifest),
    releasePath,
  }
}

function indexCity(release, overrides = {}) {
  const { cityId, facts, manifest, releasePath } = release
  return {
    cityId,
    name: facts.name,
    shortName: facts.shortName,
    region: facts.region,
    countryCode: 'US',
    timeZone: facts.timeZone,
    center: { ...facts.center },
    bbox: { ...facts.bbox },
    coverageTier: 'flagship',
    pathAliases: [...facts.aliases],
    artifactPack: {
      manifestUrl: `${releasePath}artifact-manifest.json`,
      manifestId: manifest.manifestId,
      buildId: manifest.buildId,
      generatedAt: manifest.generatedAt,
      expiresAt: manifest.expiresAt,
      counts: Object.fromEntries(Object.entries(manifest.artifacts).map(([kind, entry]) => [kind, entry.count])),
      sourceHealth: manifest.sourceHealth.status,
      shards: Object.entries(manifest.artifacts).map(([kind, entry]) => ({
        kind,
        url: `${releasePath}${entry.file}`,
        sha256: `sha256:${entry.sha256}`,
        bytes: entry.bytes,
        count: entry.count,
      })),
      ...overrides,
    },
  }
}

function rehashIndex(index) {
  index.indexId = shaId(new TextEncoder().encode(canonicalCitiesIndexJson(index)))
  return index
}

function fixture() {
  const releases = {
    'tampa-bay': cityRelease('tampa-bay'),
    'sf-east-bay': cityRelease('sf-east-bay'),
  }
  const index = rehashIndex({
    schemaVersion: 1,
    generatedAt: '2026-07-22T10:10:00.000Z',
    indexId: `sha256:${'0'.repeat(64)}`,
    defaultCityId: 'tampa-bay',
    cities: [indexCity(releases['tampa-bay']), indexCity(releases['sf-east-bay'])],
    fallbacks: {
      nationwideFloor: {
        fallbackId: 'nationwide-floor',
        name: 'Nationwide floor',
        coverageTier: 'thin',
        countryCode: 'US',
        artifactPack: null,
      },
      notCovered: {
        fallbackId: 'not-covered',
        name: 'Not covered',
        coverageTier: 'not-covered',
        countryCode: null,
        artifactPack: null,
      },
    },
    usRegions: [
      { regionId: 'contiguous-us', bbox: { south: 24.396308, west: -124.848974, north: 49.384358, east: -66.885444 } },
      { regionId: 'alaska', bbox: { south: 51.214183, west: -179.148909, north: 71.365162, east: -129.9795 } },
      { regionId: 'hawaii', bbox: { south: 18.910361, west: -160.2471, north: 22.2356, east: -154.806773 } },
    ],
  })
  return { index, releases }
}

function replaceReleaseShard(current, cityId, kind, replacement, count) {
  const release = current.releases[cityId]
  release.bytes[kind] = replacement
  const entry = release.manifest.artifacts[kind]
  entry.sha256 = shaHex(replacement)
  entry.bytes = replacement.byteLength
  entry.count = count
  if (entry.sourceHealth) {
    entry.sourceHealth.sources[0].rows = count
    if (kind === 'events') release.manifest.sourceHealth = entry.sourceHealth
  }
  release.manifest.buildId = calculateBuildId(release.manifest)
  release.manifest.manifestId = calculateManifestId(release.manifest)
  release.manifestBytes = jsonBytes(release.manifest)
  release.releasePath = `/wuzup/cities/${cityId}/releases/${release.manifest.manifestId.slice('sha256:'.length)}/`
  const position = current.index.cities.findIndex((city) => city.cityId === cityId)
  current.index.cities[position] = indexCity(release)
  rehashIndex(current.index)
}

function response(url, body, {
  status = 200,
  contentType = 'application/json',
  redirected = false,
  responseUrl = url,
  headers = {},
} = {}) {
  const bytes = body instanceof Uint8Array ? body : jsonBytes(body)
  const web = new Response(bytes, {
    status,
    headers: {
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
      ...headers,
    },
  })
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected,
    url: responseUrl,
    headers: web.headers,
    body: web.body,
    arrayBuffer: () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

function streamedResponse(url, chunks, { endless = false } = {}) {
  let cursor = 0
  let cancelled = false
  return {
    status: 200,
    ok: true,
    redirected: false,
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {
      getReader() {
        return {
          async read() {
            if (cursor < chunks.length) return { done: false, value: chunks[cursor++] }
            if (endless) return new Promise(() => {})
            return { done: true, value: undefined }
          },
          async cancel() {
            cancelled = true
          },
          releaseLock() {},
        }
      },
    },
    get cancelled() {
      return cancelled
    },
  }
}

function routesFor(current) {
  const routes = new Map([[`${ROOT}cities/index.json`, jsonBytes(current.index)]])
  for (const release of Object.values(current.releases)) {
    const base = new URL(release.releasePath.slice(1), 'https://example.test/').href
    routes.set(`${base}artifact-manifest.json`, release.manifestBytes)
    for (const [kind, file] of Object.entries(KIND_FILES)) routes.set(`${base}${file}`, release.bytes[kind])
  }
  return routes
}

const KIND_FILES = Object.freeze({ events: 'events.json', places: 'places.json', guides: 'guides.json' })

function fetchFixture(routes, { mutate } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const body = routes.get(url)
    if (!body) return response(url, new Uint8Array(), { status: 404 })
    const original = response(url, body)
    return mutate ? await mutate({ url, options, original, calls }) ?? original : original
  }
  return { fetchImpl, calls }
}

function loader(current, fetchImpl, overrides = {}) {
  return createCityArtifactLoader({
    productRoot: ROOT.slice(0, -1),
    expectedIndexId: current.index.indexId,
    fetchImpl,
    cryptoImpl: webcrypto,
    now: () => NOW_MS,
    timeoutMs: 100,
    ...overrides,
  })
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof CityArtifactLoaderError, true)
    assert.equal(error.code, code)
    return true
  })
}

test('pinned index opens one immutable city manifest and leaves every shard lazy', async () => {
  const current = fixture()
  const remote = fetchFixture(routesFor(current))
  const foundry = loader(current, remote.fetchImpl)
  const session = await foundry.openLocation({ query: '?city=tampa-bay' })

  assert.equal(foundry.productRoot, ROOT)
  assert.equal(foundry.indexUrl, `${ROOT}cities/index.json`)
  assert.equal(session.cityId, 'tampa-bay')
  assert.match(session.releaseBaseUrl, /\/wuzup\/cities\/tampa-bay\/releases\/[a-f0-9]{64}\/$/)
  assert.deepEqual(remote.calls.map((entry) => entry.url), [
    `${ROOT}cities/index.json`,
    session.manifestUrl,
  ])

  const loaded = await session.load('events')
  assert.equal(loaded.cityId, 'tampa-bay')
  assert.equal(loaded.count, 1)
  assert.equal(loaded.data[0].title, 'Tampa fixture event')
  assert.equal(remote.calls.at(-1).url, `${session.releaseBaseUrl}events.json`)
  for (const { options } of remote.calls) {
    assert.equal(options.cache, 'no-store')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.equal(options.referrerPolicy, 'no-referrer')
  }
})

test('a self-consistent but unpinned index is rejected before its manifest is fetched', async () => {
  const current = fixture()
  const remote = fetchFixture(routesFor(current))
  const foundry = createCityArtifactLoader({
    productRoot: ROOT,
    expectedIndexId: `sha256:${'f'.repeat(64)}`,
    fetchImpl: remote.fetchImpl,
    cryptoImpl: webcrypto,
    now: () => NOW_MS,
  })
  await rejectsCode(foundry.openLocation({ query: '?city=tampa-bay' }), 'INDEX_UNAPPROVED')
  assert.deepEqual(remote.calls.map((entry) => entry.url), [`${ROOT}cities/index.json`])
})

test('cross-city or non-derived index URLs cannot choose fetched bytes', async () => {
  const current = fixture()
  const tampa = current.index.cities.find((city) => city.cityId === 'tampa-bay')
  const sf = current.index.cities.find((city) => city.cityId === 'sf-east-bay')
  tampa.artifactPack.manifestUrl = sf.artifactPack.manifestUrl
  tampa.artifactPack.shards[0].url = sf.artifactPack.shards[0].url
  rehashIndex(current.index)
  const remote = fetchFixture(routesFor(current))
  await assert.rejects(
    loader(current, remote.fetchImpl).openLocation({ query: '?city=tampa-bay' }),
    (error) => ['INDEX_SCHEMA_INVALID', 'MANIFEST_URL_MISMATCH'].includes(error.code),
  )
  assert.deepEqual(remote.calls.map((entry) => entry.url), [`${ROOT}cities/index.json`])
})

test('expired and failed packs refuse before any manifest request', async (t) => {
  for (const variant of ['expired', 'failed']) {
    await t.test(variant, async () => {
      const current = fixture()
      const tampa = current.index.cities.find((city) => city.cityId === 'tampa-bay')
      if (variant === 'expired') tampa.artifactPack.expiresAt = '2026-07-22T11:59:59.000Z'
      else tampa.artifactPack.sourceHealth = 'failed'
      rehashIndex(current.index)
      const remote = fetchFixture(routesFor(current))
      await rejectsCode(
        loader(current, remote.fetchImpl).openLocation({ query: '?city=tampa-bay' }),
        variant === 'expired' ? 'ARTIFACT_PACK_EXPIRED' : 'ARTIFACT_PACK_FAILED',
      )
      assert.deepEqual(remote.calls.map((entry) => entry.url), [`${ROOT}cities/index.json`])
    })
  }
})

test('pack freshness is re-evaluated across manifest and lazy shard boundaries', async (t) => {
  await t.test('expiry during manifest verification refuses the session', async () => {
    const current = fixture()
    const expiresAtMs = Date.parse(current.releases['tampa-bay'].manifest.expiresAt)
    let clockReads = 0
    const remote = fetchFixture(routesFor(current))

    await rejectsCode(
      loader(current, remote.fetchImpl, {
        now: () => ++clockReads === 1 ? NOW_MS : expiresAtMs,
      }).openLocation({ query: '?city=tampa-bay' }),
      'ARTIFACT_PACK_EXPIRED',
    )

    assert.equal(clockReads, 2)
    assert.equal(remote.calls.length, 2)
    assert.equal(remote.calls.at(-1).url.endsWith('/artifact-manifest.json'), true)
  })

  await t.test('expiry before the first shard prevents its request', async () => {
    const current = fixture()
    let clock = NOW_MS
    const remote = fetchFixture(routesFor(current))
    const session = await loader(current, remote.fetchImpl, {
      now: () => clock,
    }).openLocation({ query: '?city=tampa-bay' })

    clock = Date.parse(current.releases['tampa-bay'].manifest.expiresAt)
    await rejectsCode(session.load('events'), 'ARTIFACT_PACK_EXPIRED')
    await rejectsCode(session.load('events'), 'ARTIFACT_PACK_EXPIRED')

    assert.equal(remote.calls.length, 2)
    assert.equal(remote.calls.some(({ url }) => url.endsWith('/events.json')), false)
  })

  await t.test('expiry during a shard refuses its newly fetched rows and closes the session', async () => {
    const current = fixture()
    let clock = NOW_MS
    const expiresAtMs = Date.parse(current.releases['tampa-bay'].manifest.expiresAt)
    const remote = fetchFixture(routesFor(current), {
      mutate: ({ url, original }) => {
        if (url.endsWith('/events.json')) clock = expiresAtMs
        return original
      },
    })
    const session = await loader(current, remote.fetchImpl, {
      now: () => clock,
    }).openLocation({ query: '?city=tampa-bay' })

    await rejectsCode(session.load('events'), 'ARTIFACT_PACK_EXPIRED')
    await rejectsCode(session.load('places'), 'ARTIFACT_PACK_EXPIRED')

    assert.equal(remote.calls.filter(({ url }) => url.endsWith('/events.json')).length, 1)
    assert.equal(remote.calls.some(({ url }) => url.endsWith('/places.json')), false)
  })

  await t.test('a cached shard cannot return after expiry', async () => {
    const current = fixture()
    let clock = NOW_MS
    const remote = fetchFixture(routesFor(current))
    const session = await loader(current, remote.fetchImpl, {
      now: () => clock,
    }).openLocation({ query: '?city=tampa-bay' })

    const fresh = await session.load('events')
    assert.equal(fresh.data[0].title, 'Tampa fixture event')
    clock = Date.parse(current.releases['tampa-bay'].manifest.expiresAt)
    await rejectsCode(session.load('events'), 'ARTIFACT_PACK_EXPIRED')

    assert.equal(remote.calls.filter(({ url }) => url.endsWith('/events.json')).length, 1)
  })

  await t.test('the post-cache clock read closes an expiry-edge return', async () => {
    const current = fixture()
    const expiresAtMs = Date.parse(current.releases['tampa-bay'].manifest.expiresAt)
    let clockReads = 0
    const remote = fetchFixture(routesFor(current))
    const session = await loader(current, remote.fetchImpl, {
      now: () => ++clockReads === 6 ? expiresAtMs : NOW_MS,
    }).openLocation({ query: '?city=tampa-bay' })

    await session.load('events')
    await rejectsCode(session.load('events'), 'ARTIFACT_PACK_EXPIRED')
    await rejectsCode(session.load('places'), 'ARTIFACT_PACK_EXPIRED')

    assert.equal(clockReads, 6)
    assert.equal(remote.calls.filter(({ url }) => url.endsWith('/events.json')).length, 1)
    assert.equal(remote.calls.some(({ url }) => url.endsWith('/places.json')), false)
  })
})

test('manifest city, immutable identity, and shard bindings all fail closed', async (t) => {
  const cases = [
    {
      name: 'wrong city manifest',
      mutate: ({ url, original }, current) => url.includes('/tampa-bay/') && url.endsWith('artifact-manifest.json')
        ? response(url, current.releases['sf-east-bay'].manifestBytes)
        : original,
      code: 'MANIFEST_SCHEMA_INVALID',
    },
    {
      name: 'manifest byte identity',
      mutate: ({ url, original }, current) => {
        if (!url.includes('/tampa-bay/') || !url.endsWith('artifact-manifest.json')) return original
        const manifest = structuredClone(current.releases['tampa-bay'].manifest)
        manifest.provenance = 'mutated-after-index'
        manifest.manifestId = calculateManifestId(manifest)
        return response(url, manifest)
      },
      code: 'MANIFEST_ID_MISMATCH',
    },
  ]
  for (const currentCase of cases) {
    await t.test(currentCase.name, async () => {
      const current = fixture()
      const remote = fetchFixture(routesFor(current), {
        mutate: (input) => currentCase.mutate(input, current),
      })
      await rejectsCode(
        loader(current, remote.fetchImpl).openLocation({ query: '?city=tampa-bay' }),
        currentCase.code,
      )
    })
  }

  const current = fixture()
  const tampa = current.index.cities.find((city) => city.cityId === 'tampa-bay')
  tampa.artifactPack.shards.find((shard) => shard.kind === 'events').count += 1
  tampa.artifactPack.counts.events += 1
  rehashIndex(current.index)
  const remote = fetchFixture(routesFor(current))
  await rejectsCode(
    loader(current, remote.fetchImpl).openLocation({ query: '?city=tampa-bay' }),
    'MANIFEST_SHARD_BINDING_MISMATCH',
  )
})

test('lazy shards reject changed bytes, invalid JSON, and minimum-schema failures', async (t) => {
  await t.test('changed digest', async () => {
    const current = fixture()
    const changed = new Uint8Array(current.releases['tampa-bay'].bytes.events)
    changed[10] ^= 1
    const remote = fetchFixture(routesFor(current), {
      mutate: ({ url, original }) => url.includes('/tampa-bay/') && url.endsWith('/events.json')
        ? response(url, changed)
        : original,
    })
    const session = await loader(current, remote.fetchImpl).openLocation({ query: '?city=tampa-bay' })
    await rejectsCode(session.load('events'), 'SHARD_DIGEST_MISMATCH')
  })

  for (const currentCase of [
    {
      name: 'invalid JSON with exact declared bytes and digest',
      body: new TextEncoder().encode('{not-json}\n'),
      code: 'SHARD_EVENTS_JSON_INVALID',
    },
    {
      name: 'invalid UTF-8 with exact declared bytes and digest',
      body: new Uint8Array([0xff, 0xfe, 0xfd]),
      code: 'SHARD_EVENTS_UTF8_INVALID',
    },
    {
      name: 'minimum schema failure with exact declared bytes and digest',
      body: jsonBytes([{ id: 'missing-required-fields' }]),
      code: 'SHARD_SCHEMA_INVALID',
    },
  ]) {
    await t.test(currentCase.name, async () => {
      const current = fixture()
      replaceReleaseShard(current, 'tampa-bay', 'events', currentCase.body, 1)
      const remote = fetchFixture(routesFor(current))
      const session = await loader(current, remote.fetchImpl).openLocation({ query: '?city=tampa-bay' })
      await rejectsCode(session.load('events'), currentCase.code)
    })
  }
})

test('decoded-byte caps and transport metadata are enforced before parsing', async (t) => {
  const cases = [
    {
      name: 'index cap',
      mutate: null,
      overrides: { limits: { indexBytes: 16 } },
      code: 'INDEX_TOO_LARGE',
    },
    {
      name: 'redirect',
      mutate: ({ url, original }) => url.endsWith('/index.json')
        ? { ...original, redirected: true, url: `${ROOT}elsewhere.json` }
        : original,
      code: 'INDEX_REDIRECTED',
    },
    {
      name: 'content type',
      mutate: ({ url, original }) => url.endsWith('/index.json')
        ? { ...original, headers: new Headers({ 'content-type': 'text/html' }) }
        : original,
      code: 'INDEX_CONTENT_TYPE_INVALID',
    },
    {
      name: 'lying identity content length',
      mutate: ({ url, original }) => url.endsWith('/index.json')
        ? {
            ...original,
            headers: new Headers({
              'content-type': 'application/json',
              'content-length': String(Number(original.headers.get('content-length')) + 1),
            }),
          }
        : original,
      code: 'INDEX_CONTENT_LENGTH_MISMATCH',
    },
  ]
  for (const currentCase of cases) {
    await t.test(currentCase.name, async () => {
      const current = fixture()
      const remote = fetchFixture(routesFor(current), { mutate: currentCase.mutate })
      await rejectsCode(
        loader(current, remote.fetchImpl, currentCase.overrides).openLocation({ query: '?city=tampa-bay' }),
        currentCase.code,
      )
    })
  }

  await t.test('timeout aborts the request', async () => {
    const current = fixture()
    const fetchImpl = () => new Promise(() => {})
    await rejectsCode(
      loader(current, fetchImpl, { timeoutMs: 5 }).openLocation({ query: '?city=tampa-bay' }),
      'INDEX_TIMEOUT',
    )
  })

  await t.test('timeout also bounds an endless response body', async () => {
    const current = fixture()
    const fetchImpl = async (url) => streamedResponse(url, [], { endless: true })
    await rejectsCode(
      loader(current, fetchImpl, { timeoutMs: 5 }).openLocation({ query: '?city=tampa-bay' }),
      'INDEX_TIMEOUT',
    )
  })

  await t.test('decoded chunked bytes are bounded without Content-Length', async () => {
    const current = fixture()
    const oversized = streamedResponse(`${ROOT}cities/index.json`, [
      new Uint8Array(10),
      new Uint8Array(10),
    ])
    const fetchImpl = async () => oversized
    await rejectsCode(
      loader(current, fetchImpl, {
        limits: { indexBytes: 16 },
      }).openLocation({ query: '?city=tampa-bay' }),
      'INDEX_TOO_LARGE',
    )
    assert.equal(oversized.cancelled, true)
  })
})

test('a late response from a superseded city session cannot become current', async () => {
  const current = fixture()
  let releaseTampa
  let tampaEntered
  const entered = new Promise((resolve) => { tampaEntered = resolve })
  const hold = new Promise((resolve) => { releaseTampa = resolve })
  const remote = fetchFixture(routesFor(current), {
    mutate: async ({ url, original }) => {
      if (url.includes('/tampa-bay/') && url.endsWith('artifact-manifest.json')) {
        tampaEntered()
        await hold
      }
      return original
    },
  })
  const foundry = loader(current, remote.fetchImpl)
  const tampa = rejectsCode(
    foundry.openLocation({ query: '?city=tampa-bay' }),
    'SESSION_SUPERSEDED',
  )
  await entered
  const sf = await foundry.openLocation({ query: '?city=sf-east-bay' })
  releaseTampa()
  await tampa
  assert.equal(sf.cityId, 'sf-east-bay')
  assert.equal((await sf.load('events')).data[0].title, 'SF / East Bay fixture event')
})

test('a verified session exposes no image or asset URL authorization capability', async () => {
  const current = fixture()
  const remote = fetchFixture(routesFor(current))
  const session = await loader(current, remote.fetchImpl).openLocation({ query: '?city=tampa-bay' })

  assert.equal(Object.hasOwn(session, 'resolveAssetUrl'), false)
  assert.deepEqual(Object.keys(session).filter((key) => /asset|image/i.test(key)), [])
})

test('the dark loader bundles through Vite without a node builtin', async () => {
  const appRoot = path.resolve('app')
  const requireFromApp = createRequire(path.join(appRoot, 'package.json'))
  const { build } = await import(pathToFileURL(requireFromApp.resolve('vite')).href)
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'wuzup-s13-loader-'))
  try {
    const output = await build({
      configFile: false,
      root: appRoot,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        lib: {
          entry: path.join(appRoot, 'src', 'city-artifact-loader.js'),
          formats: ['es'],
          fileName: 'city-artifact-loader',
        },
        outDir: scratch,
      },
    })
    const outputs = Array.isArray(output) ? output.flatMap((entry) => entry.output) : output.output
    const javascript = outputs
      .filter((entry) => entry.type === 'chunk')
      .map((entry) => entry.code)
      .join('\n')
    assert.ok(javascript.length > 0)
    assert.doesNotMatch(javascript, /(?:from\s*['"]node:|require\(['"]node:)/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
