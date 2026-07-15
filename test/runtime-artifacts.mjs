import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  calculateBuildId,
  calculateManifestId,
  writeManifest,
} from '../finder/artifact-manifest.mjs'
import { createArtifactRepository, recoveryAction } from '../app/src/artifacts.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://example.test/wuzup/'
const GENERATED_AT = '2026-07-15T12:00:00.000Z'
const NOW = Date.parse('2026-07-15T13:00:00.000Z')

function health(runId, rows, checkedAt = GENERATED_AT, status = 'healthy') {
  return {
    status,
    runId,
    checkedAt,
    total: 1,
    healthy: status === 'healthy' ? 1 : 0,
    degraded: status === 'degraded' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    unknown: status === 'unknown' ? 1 : 0,
    sources: [{ name: 'Fixture source', status, rows, cached: false }],
  }
}

function fixture(root, {
  cityId = 'tampa-bay',
  timeZone = 'America/New_York',
  generatedAt = GENERATED_AT,
  eventTitle = 'Fixture event',
  placeName = 'Fixture place',
  emptyEvents = false,
  eventHealth = 'healthy',
} = {}) {
  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'place-img'), { recursive: true })
  const events = emptyEvents
    ? []
    : [{ id: 'e|fixture', title: eventTitle, start: '2026-07-16T19:00:00-04:00' }]
  const places = [{ key: 'p|fixture', name: placeName, lat: 27.95, lng: -82.46 }]
  writeFileSync(join(root, 'events.json'), `${JSON.stringify(events)}\n`)
  writeFileSync(join(root, 'places.json'), `${JSON.stringify({ schemaVersion: 1, places })}\n`)
  writeFileSync(join(root, 'guides.json'), `${JSON.stringify({ schemaVersion: 1, guides: [{ id: 'g|fixture', title: 'Fixture guide' }] })}\n`)
  return writeManifest({
    root,
    cityId,
    timeZone,
    assembledAt: generatedAt,
    componentReceipts: {
      events: {
        runId: 'run-events',
        generatedAt,
        provenance: 'fixture',
        sourceHealth: health('run-events', events.length, generatedAt, eventHealth),
      },
      places: {
        runId: 'run-places',
        generatedAt,
        provenance: 'fixture',
        sourceHealth: health('run-places', places.length, generatedAt),
      },
      guides: { runId: 'run-guides', generatedAt: null, provenance: 'fixture' },
    },
  })
}

function responseFor(root, url, { corrupt = null } = {}) {
  const name = new URL(url).pathname.split('/').pop()
  const body = readFileSync(join(root, name))
  if (corrupt === name) {
    const changed = Buffer.from(body)
    changed[Math.max(0, changed.length - 2)] ^= 1
    return new Response(changed, { status: 200 })
  }
  return new Response(body, { status: 200 })
}

function rewriteManifest(root, mutate) {
  const path = join(root, 'artifact-manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  mutate(manifest)
  manifest.buildId = calculateBuildId(manifest)
  manifest.manifestId = calculateManifestId(manifest)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function repository(fetchImpl, overrides = {}) {
  return createArtifactRepository({
    baseUrl: BASE,
    expectedCityId: 'tampa-bay',
    expectedTimeZone: 'America/New_York',
    fetchImpl,
    cryptoImpl: webcrypto,
    now: () => NOW,
    attempts: 1,
    retryDelayMs: 0,
    timeoutMs: 100,
    isOnline: () => true,
    ...overrides,
  })
}

function withScratch(run) {
  const scratch = mkdtempSync(join(tmpdir(), 'wuzup-runtime-artifacts-'))
  return Promise.resolve()
    .then(() => run(scratch))
    .finally(() => rmSync(scratch, { recursive: true, force: true }))
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('runtime repository exposes only manifest-verified event and place bytes', () => withScratch(async (scratch) => {
  const manifest = fixture(scratch)
  const calls = []
  const repo = repository(async (url) => {
    calls.push(new URL(url).pathname)
    return responseFor(scratch, url)
  })

  await repo.load('events')
  const events = repo.getSnapshot('events')
  assert.equal(events.status, 'ready')
  assert.equal(events.data[0].title, 'Fixture event')
  assert.equal(events.meta.generatedAt, GENERATED_AT)
  assert.equal(events.meta.sourceHealth.status, 'healthy')
  assert.equal(events.meta.manifestId, manifest.manifestId)
  assert.equal(events.meta.buildId, manifest.buildId)

  await repo.load('places')
  const places = repo.getSnapshot('places')
  assert.equal(places.status, 'ready')
  assert.equal(places.data.places[0].name, 'Fixture place')
  assert.equal(calls.filter((path) => path.endsWith('/artifact-manifest.json')).length, 1)
  assert.deepEqual(calls.map((path) => path.split('/').pop()), [
    'artifact-manifest.json',
    'events.json',
    'places.json',
  ])
}))

test('hash-invalid, wrong-city, and malformed payloads fail closed', () => withScratch(async (scratch) => {
  fixture(scratch)
  const corrupt = repository((url) => responseFor(scratch, url, { corrupt: 'events.json' }))
  await corrupt.load('events')
  assert.equal(corrupt.getSnapshot('events').status, 'error')
  assert.equal(corrupt.getSnapshot('events').error.code, 'PAYLOAD_HASH_MISMATCH')
  assert.equal(corrupt.getSnapshot('events').data, null)

  const wrongCity = repository((url) => responseFor(scratch, url), { expectedCityId: 'sf-east-bay' })
  await wrongCity.load('events')
  assert.equal(wrongCity.getSnapshot('events').status, 'error')
  assert.equal(wrongCity.getSnapshot('events').error.code, 'MANIFEST_INVALID')
  assert.equal(wrongCity.getSnapshot('events').data, null)

  writeFileSync(join(scratch, 'events.json'), '{not json}\n')
  const malformed = repository((url) => responseFor(scratch, url))
  await malformed.load('events')
  assert.equal(malformed.getSnapshot('events').status, 'error')
  assert.equal(malformed.getSnapshot('events').data, null)
}))

test('non-object manifests and future component receipts fail closed as invalid manifests', () => withScratch(async (scratch) => {
  const nullRoot = join(scratch, 'null-manifest')
  fixture(nullRoot)
  writeFileSync(join(nullRoot, 'artifact-manifest.json'), 'null\n')
  const nullManifest = repository((url) => responseFor(nullRoot, url))
  await nullManifest.load('events')
  assert.equal(nullManifest.getSnapshot('events').status, 'error')
  assert.equal(nullManifest.getSnapshot('events').error.code, 'MANIFEST_INVALID')

  const futureRoot = join(scratch, 'future-receipt')
  fixture(futureRoot)
  rewriteManifest(futureRoot, (manifest) => {
    manifest.artifacts.places.sourceHealth.checkedAt = '2026-07-15T13:06:00.000Z'
  })
  const calls = []
  const futureReceipt = repository((url) => {
    calls.push(new URL(url).pathname.split('/').pop())
    return responseFor(futureRoot, url)
  })
  await futureReceipt.load('events')
  assert.equal(futureReceipt.getSnapshot('events').status, 'error')
  assert.equal(futureReceipt.getSnapshot('events').error.code, 'MANIFEST_INVALID')
  assert.deepEqual(calls, ['artifact-manifest.json'])
}))

test('a self-consistent manifest not approved by the build is refused before payload fetch', () => withScratch(async (scratch) => {
  fixture(scratch)
  const calls = []
  const repo = repository((url) => {
    calls.push(new URL(url).pathname.split('/').pop())
    return responseFor(scratch, url)
  }, { expectedManifestId: `sha256:${'0'.repeat(64)}` })

  await repo.load('events')
  assert.equal(repo.getSnapshot('events').status, 'error')
  assert.equal(repo.getSnapshot('events').error.code, 'MANIFEST_UNAPPROVED')
  assert.equal(repo.getSnapshot('events').data, null)
  assert.deepEqual(calls, ['artifact-manifest.json'])
}))

test('verified expired data is explicitly stale and verified zero rows are empty', () => withScratch(async (scratch) => {
  const staleRoot = join(scratch, 'stale')
  fixture(staleRoot, { generatedAt: '2026-07-10T12:00:00.000Z' })
  const staleCalls = []
  const stale = repository((url) => {
    staleCalls.push(new URL(url).pathname.split('/').pop())
    return responseFor(staleRoot, url)
  })
  await stale.load('events')
  assert.equal(stale.getSnapshot('events').status, 'stale')
  assert.equal(stale.getSnapshot('events').data, null)
  assert.equal(stale.getSnapshot('events').meta.generatedAt, '2026-07-10T12:00:00.000Z')
  assert.deepEqual(staleCalls, ['artifact-manifest.json'])

  const emptyRoot = join(scratch, 'empty')
  fixture(emptyRoot, { emptyEvents: true })
  const empty = repository((url) => responseFor(emptyRoot, url))
  await empty.load('events')
  assert.equal(empty.getSnapshot('events').status, 'empty')
  assert.deepEqual(empty.getSnapshot('events').data, [])
}))

test('a ready artifact becomes stale when its immutable expiry passes in-session', () => withScratch(async (scratch) => {
  fixture(scratch)
  let clock = NOW
  let expiryCallback = null
  const repo = repository((url) => responseFor(scratch, url), {
    now: () => clock,
    setTimeoutImpl: (callback) => {
      expiryCallback = callback
      return 1
    },
    clearTimeoutImpl: () => {},
  })

  await repo.load('events')
  assert.equal(repo.getSnapshot('events').status, 'ready')
  assert.equal(typeof expiryCallback, 'function')

  clock = Date.parse('2026-07-17T12:00:00.000Z')
  expiryCallback()
  assert.equal(repo.getSnapshot('events').status, 'stale')
  assert.equal(repo.getSnapshot('events').data, null)
  assert.equal(repo.getSnapshot('events').meta.generatedAt, GENERATED_AT)
}))

test('artifact expiry is rechecked at single-load and atomic-refresh commit time', () => withScratch(async (scratch) => {
  const first = join(scratch, 'first')
  const second = join(scratch, 'second')
  fixture(first)
  fixture(second, { eventTitle: 'Second event', placeName: 'Second place' })
  let clock = Date.parse('2026-07-17T11:59:59.000Z')

  const single = repository((url) => {
    if (new URL(url).pathname.endsWith('/events.json')) {
      clock = Date.parse('2026-07-17T12:00:00.000Z')
    }
    return responseFor(first, url)
  }, { now: () => clock })
  await single.load('events')
  assert.equal(single.getSnapshot('events').status, 'stale')
  assert.equal(single.getSnapshot('events').data, null)

  clock = Date.parse('2026-07-15T13:00:00.000Z')
  let activeRoot = first
  let refreshing = false
  const eventsRead = deferred()
  const atomic = repository(async (url) => {
    const name = new URL(url).pathname.split('/').pop()
    if (refreshing && name === 'events.json') eventsRead.resolve()
    if (refreshing && name === 'places.json') {
      await eventsRead.promise
      clock = Date.parse('2026-07-17T12:00:00.000Z')
    }
    return responseFor(activeRoot, url)
  }, { now: () => clock })
  await atomic.load('events')
  await atomic.load('places')
  activeRoot = second
  refreshing = true
  await atomic.retry()
  assert.equal(atomic.getSnapshot('events').status, 'stale')
  assert.equal(atomic.getSnapshot('places').status, 'ready')
  assert.equal(atomic.getSnapshot('events').data, null)
  assert.equal(atomic.getSnapshot('places').data.places[0].name, 'Second place')
}))

test('recovery distinguishes retry, app reload, and an unsupported browser', () => {
  assert.equal(recoveryAction(null), 'retry')
  assert.equal(recoveryAction({ retryable: true }), 'retry')
  assert.equal(recoveryAction({ code: 'MANIFEST_UNAPPROVED', retryable: false }), 'reload')
  assert.equal(recoveryAction({ code: 'CRYPTO_UNAVAILABLE', retryable: false }), 'none')
})

test('offline is distinct from empty and a retry recovers', () => withScratch(async (scratch) => {
  fixture(scratch)
  let online = false
  const repo = repository(async (url) => {
    if (!online) throw new TypeError('network unavailable')
    return responseFor(scratch, url)
  }, { isOnline: () => online })

  await repo.load('events')
  assert.equal(repo.getSnapshot('events').status, 'offline')
  assert.equal(repo.getSnapshot('events').data, null)
  assert.equal(repo.getSnapshot('events').error.code, 'OFFLINE')

  online = true
  await repo.retry()
  assert.equal(repo.getSnapshot('events').status, 'ready')
  assert.equal(repo.getSnapshot('events').error, null)
}))

test('degraded and unknown sources warn while failed source health refuses rows', () => withScratch(async (scratch) => {
  const degradedRoot = join(scratch, 'degraded')
  fixture(degradedRoot, { eventHealth: 'degraded' })
  const degraded = repository((url) => responseFor(degradedRoot, url))
  await degraded.load('events')
  assert.equal(degraded.getSnapshot('events').status, 'ready')
  assert.deepEqual(degraded.getSnapshot('events').meta.warnings, ['SOURCE_HEALTH_DEGRADED'])

  const unknownRoot = join(scratch, 'unknown')
  fixture(unknownRoot, { eventHealth: 'unknown' })
  const unknown = repository((url) => responseFor(unknownRoot, url))
  await unknown.load('events')
  assert.equal(unknown.getSnapshot('events').status, 'ready')
  assert.deepEqual(unknown.getSnapshot('events').meta.warnings, ['SOURCE_HEALTH_UNKNOWN'])

  const failedRoot = join(scratch, 'failed')
  fixture(failedRoot, { eventHealth: 'failed' })
  const calls = []
  const failed = repository((url) => {
    calls.push(new URL(url).pathname.split('/').pop())
    return responseFor(failedRoot, url)
  })
  await failed.load('events')
  assert.equal(failed.getSnapshot('events').status, 'error')
  assert.equal(failed.getSnapshot('events').error.code, 'SOURCE_HEALTH_FAILED')
  assert.equal(failed.getSnapshot('events').data, null)
  assert.deepEqual(calls, ['artifact-manifest.json'])
}))

test('HTTP failure and bounded timeout are recoverable errors, not empty data', async () => {
  const http = repository(async () => new Response('', { status: 503 }))
  await http.load('events')
  assert.equal(http.getSnapshot('events').status, 'error')
  assert.equal(http.getSnapshot('events').error.code, 'MANIFEST_HTTP')
  assert.equal(http.getSnapshot('events').data, null)

  const timedOut = repository(() => new Promise(() => {}), { timeoutMs: 5 })
  await timedOut.load('events')
  assert.equal(timedOut.getSnapshot('events').status, 'error')
  assert.equal(timedOut.getSnapshot('events').error.code, 'TIMEOUT')
  assert.equal(timedOut.getSnapshot('events').data, null)

  const offlineTimeout = repository(() => new Promise(() => {}), {
    timeoutMs: 5,
    isOnline: () => false,
  })
  await offlineTimeout.load('events')
  assert.equal(offlineTimeout.getSnapshot('events').status, 'offline')
  assert.equal(offlineTimeout.getSnapshot('events').error.code, 'OFFLINE')
})

test('concurrent callers coalesce behind one complete acquisition', () => withScratch(async (scratch) => {
  fixture(scratch)
  const payloadGate = deferred()
  const payloadEntered = deferred()
  let eventFetches = 0
  const repo = repository(async (url) => {
    const name = new URL(url).pathname.split('/').pop()
    if (name === 'events.json') {
      eventFetches += 1
      payloadEntered.resolve()
      await payloadGate.promise
    }
    return responseFor(scratch, url)
  })

  const first = repo.load('events')
  let secondSettled = false
  const second = repo.load('events').then((state) => {
    secondSettled = true
    return state
  })
  await payloadEntered.promise
  assert.equal(eventFetches, 1)
  assert.equal(secondSettled, false)
  payloadGate.resolve()
  const [one, two] = await Promise.all([first, second])
  assert.equal(one.status, 'ready')
  assert.equal(two.status, 'ready')
  assert.equal(eventFetches, 1)
}))

test('a late old response cannot overwrite a newer atomic retry', () => withScratch(async (scratch) => {
  const firstRoot = join(scratch, 'first-late')
  const secondRoot = join(scratch, 'second-late')
  fixture(firstRoot, { eventTitle: 'Old response' })
  const secondManifest = fixture(secondRoot, {
    generatedAt: '2026-07-15T12:30:00.000Z',
    eventTitle: 'New response',
  })
  let activeRoot = firstRoot
  let holdFirstEvent = true
  const firstEventEntered = deferred()
  const firstEventGate = deferred()
  const repo = repository(async (url) => {
    const name = new URL(url).pathname.split('/').pop()
    const requestRoot = activeRoot
    if (name === 'events.json' && holdFirstEvent) {
      holdFirstEvent = false
      firstEventEntered.resolve()
      await firstEventGate.promise
    }
    return responseFor(requestRoot, url)
  })

  const oldLoad = repo.load('events')
  await firstEventEntered.promise
  activeRoot = secondRoot
  await repo.retry()
  assert.equal(repo.getSnapshot('events').status, 'ready')
  assert.equal(repo.getSnapshot('events').data[0].title, 'New response')
  assert.equal(repo.getSnapshot('events').meta.manifestId, secondManifest.manifestId)

  firstEventGate.resolve()
  await oldLoad
  assert.equal(repo.getSnapshot('events').data[0].title, 'New response')
  assert.equal(repo.getSnapshot('events').meta.manifestId, secondManifest.manifestId)
}))

test('retry commits a new build atomically across every active kind', () => withScratch(async (scratch) => {
  const first = join(scratch, 'first')
  const second = join(scratch, 'second')
  const firstManifest = fixture(first, { eventTitle: 'First event', placeName: 'First place' })
  const secondManifest = fixture(second, {
    generatedAt: '2026-07-15T12:30:00.000Z',
    eventTitle: 'Second event',
    placeName: 'Second place',
  })
  let activeRoot = first
  let corruptPlaces = false
  const repo = repository((url) => responseFor(activeRoot, url, {
    corrupt: corruptPlaces ? 'places.json' : null,
  }))

  await repo.load('events')
  await repo.load('places')
  assert.equal(repo.getSnapshot('events').meta.manifestId, firstManifest.manifestId)
  assert.equal(repo.getSnapshot('places').meta.manifestId, firstManifest.manifestId)

  activeRoot = second
  corruptPlaces = true
  await repo.retry()
  const failedEvents = repo.getSnapshot('events')
  const failedPlaces = repo.getSnapshot('places')
  assert.equal(failedEvents.status, 'error')
  assert.equal(failedPlaces.status, 'error')
  assert.equal(failedEvents.data, null)
  assert.equal(failedPlaces.data, null)
  assert.equal(failedEvents.meta.manifestId, firstManifest.manifestId)
  assert.equal(failedPlaces.meta.manifestId, firstManifest.manifestId)

  corruptPlaces = false
  await repo.retry()
  const recoveredEvents = repo.getSnapshot('events')
  const recoveredPlaces = repo.getSnapshot('places')
  assert.equal(recoveredEvents.status, 'ready')
  assert.equal(recoveredPlaces.status, 'ready')
  assert.equal(recoveredEvents.data[0].title, 'Second event')
  assert.equal(recoveredPlaces.data.places[0].name, 'Second place')
  assert.equal(recoveredEvents.meta.manifestId, secondManifest.manifestId)
  assert.equal(recoveredPlaces.meta.manifestId, secondManifest.manifestId)
}))

test('a kind first requested during refresh joins the new manifest generation', () => withScratch(async (scratch) => {
  const first = join(scratch, 'first')
  const second = join(scratch, 'second')
  fixture(first, { eventTitle: 'First event', placeName: 'First place' })
  const secondManifest = fixture(second, {
    generatedAt: '2026-07-15T12:30:00.000Z',
    eventTitle: 'Second event',
    placeName: 'Second place',
  })
  let activeRoot = first
  const refreshEntered = deferred()
  const refreshGate = deferred()
  let holdRefreshManifest = false
  const repo = repository(async (url) => {
    const name = new URL(url).pathname.split('/').pop()
    const requestRoot = activeRoot
    if (name === 'artifact-manifest.json' && holdRefreshManifest) {
      holdRefreshManifest = false
      refreshEntered.resolve()
      await refreshGate.promise
    }
    return responseFor(requestRoot, url)
  })

  await repo.load('events')
  activeRoot = second
  holdRefreshManifest = true
  const refresh = repo.retry()
  await refreshEntered.promise
  const places = repo.load('places')
  refreshGate.resolve()
  await Promise.all([refresh, places])

  assert.equal(repo.getSnapshot('events').meta.manifestId, secondManifest.manifestId)
  assert.equal(repo.getSnapshot('places').meta.manifestId, secondManifest.manifestId)
  assert.equal(repo.getSnapshot('places').data.places[0].name, 'Second place')
}))

test('App and places use the shared repository, never direct fetch or Last-Modified freshness', () => {
  const app = readFileSync(join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  const places = readFileSync(join(ROOT, 'app', 'src', 'places.js'), 'utf8')
  assert.match(app, /useArtifact\('events'/)
  assert.match(places, /useArtifact\('places'/)
  assert.doesNotMatch(app, /fetch\(/)
  assert.doesNotMatch(places, /fetch\(/)
  assert.doesNotMatch(app, /last-modified|Last-Modified/i)
  assert.doesNotMatch(places, /last-modified|Last-Modified/i)
})

test('terminal artifact states remain actionable across event and place UI layers', () => {
  const app = readFileSync(join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  const css = readFileSync(join(ROOT, 'app', 'src', 'App.css'), 'utf8')
  const deck = readFileSync(join(ROOT, 'app', 'src', 'CalibrationDeck.jsx'), 'utf8')
  const locations = readFileSync(join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  const attribution = readFileSync(join(ROOT, 'app', 'src', 'AttributionPage.jsx'), 'utf8')
  const coverage = readFileSync(join(ROOT, 'app', 'src', 'CoverageCard.jsx'), 'utf8')
  const search = readFileSync(join(ROOT, 'app', 'src', 'SearchPage.jsx'), 'utf8')
  const guide = readFileSync(join(ROOT, 'app', 'src', 'GuidePage.jsx'), 'utf8')

  assert.doesNotMatch(app, /className="(?:load|stale)-note"[^>]*(?:inert|aria-hidden)/s)
  assert.match(app, /staleAt != null && primer/)
  assert.match(app, /remoteEventOpen[\s\S]*closeDetail\(\)/)
  assert.match(app, /useArtifact\('places', false\)/)
  assert.match(app, /remotePlaceOpen[\s\S]*closeDetail\(\)/)
  assert.match(app, /recoverEvents && \(<button/)
  assert.match(css, /\.stale-note\.is-layered,[\s\S]*top: calc\(64px/)

  assert.match(deck, /places, status, recover, recoverLabel/)
  for (const status of ['empty', 'stale', 'offline', 'error']) assert.match(deck, new RegExp(`status === '${status}'`))
  assert.match(deck, /onClick=\{recover\}/)

  assert.match(locations, /meta: placeMeta/)
  assert.match(attribution, /meta: placeMeta/)
  assert.match(coverage, /meta: placeMeta/)
  for (const source of [locations, attribution, coverage]) {
    assert.match(source, /placeMeta\?\.generatedAt/)
    assert.match(source, /placeMeta\?\.sourceHealth\?\.status/)
  }

  assert.match(search, /status: placeStatus,[\s\S]*recover: recoverPlaces,[\s\S]*recoverLabel: recoverPlacesLabel/)
  assert.match(search, /placesPending/)
  assert.match(search, /placesUnavailable/)
  assert.match(search, /!placesPending && !placesUnavailable/)
  assert.match(guide, /status: placeStatus,[\s\S]*recover: recoverPlaces,[\s\S]*recoverLabel: recoverPlacesLabel/)
  assert.match(guide, /placesPending/)
  assert.match(guide, /placesUnavailable/)
  assert.match(guide, /!placesPending && !placesUnavailable/)
})
