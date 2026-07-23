import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  artifactLoadPlanFromValidatedIndex,
  artifactLoadPlan,
  calculateCitiesIndexId,
  CITIES_INDEX_LIMITS,
  resolveValidatedLocation,
  resolveLocation,
  validateCitiesIndex,
  validateCitiesIndexShape,
} from '../shared/cities-index.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_PATH = join(ROOT, 'test', 'fixtures', 'location', 'cities-index.v1.json')
const NOW = '2026-07-16T12:00:00.000Z'
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

const clone = (value) => JSON.parse(JSON.stringify(value))

function rehash(index) {
  index.indexId = calculateCitiesIndexId(index)
  return index
}

function city(index, cityId) {
  return index.cities.find((entry) => entry.cityId === cityId)
}

function resolve(input = {}, index = fixture) {
  return resolveLocation({ index, pathname: '/', query: '', coords: null, now: NOW, ...input })
}

function plan(index, resolution, now = NOW) {
  return artifactLoadPlan(index, resolution, { now })
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

test('cities index identity is canonical, deterministic, and excludes indexId', () => {
  const first = {
    beta: [{ z: 3, a: 1 }, 2],
    alpha: { right: true, left: null },
    indexId: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  }
  const reordered = {
    indexId: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    alpha: { left: null, right: true },
    beta: [{ a: 1, z: 3 }, 2],
  }
  const arrayReordered = { ...reordered, beta: [2, { a: 1, z: 3 }] }

  assert.equal(calculateCitiesIndexId(first), calculateCitiesIndexId(reordered))
  assert.notEqual(calculateCitiesIndexId(first), calculateCitiesIndexId(arrayReordered))
  assert.match(calculateCitiesIndexId(first), /^sha256:[a-f0-9]{64}$/)
})

test('the versioned Tampa and SF synthetic fixture validates exactly', () => {
  assert.equal(validateCitiesIndex(fixture), fixture)
  assert.equal(calculateCitiesIndexId(fixture), fixture.indexId)
})

test('unsupported schemas and forged index identities are rejected precisely', () => {
  const unsupported = clone(fixture)
  unsupported.schemaVersion = 2
  assert.throws(() => validateCitiesIndex(unsupported), /index\.schemaVersion must be 1/)

  const forged = clone(fixture)
  forged.cities[0].name = 'Forged Tampa'
  assert.throws(() => validateCitiesIndex(forged), /index\.indexId does not match its canonical contents/)
})

test('validation rejects malformed city, pack, fallback, and US-region fields', () => {
  const cases = [
    [index => { city(index, 'tampa-bay').timeZone = 'Eastern-ish' }, /cities\[0\]\.timeZone must be a valid IANA time zone/],
    [index => { city(index, 'tampa-bay').center.lat = 90 }, /cities\[0\]\.center must be inside cities\[0\]\.bbox/],
    [index => { city(index, 'sf-east-bay').pathAliases[0] = 'tampa' }, /duplicate city id or path alias: tampa/],
    [index => { city(index, 'tampa-bay').coverageTier = 'deep-ish' }, /cities\[0\]\.coverageTier must be flagship, metro, thin, or not-covered/],
    [index => { city(index, 'tampa-bay').artifactPack.sourceHealth = 'fine' }, /cities\[0\]\.artifactPack\.sourceHealth must be healthy, degraded, failed, or unknown/],
    [index => { city(index, 'tampa-bay').artifactPack.expiresAt = '2026-01-01T00:00:00.000Z' }, /generatedAt must be before expiresAt/],
    [index => { city(index, 'tampa-bay').artifactPack.counts.events = -1 }, /counts\.events must be a bounded non-negative safe integer/],
    [index => { city(index, 'tampa-bay').artifactPack.manifestUrl = 'https:\/\/example.com\/manifest.json' }, /manifestUrl must be a root-relative URL/],
    [index => { city(index, 'tampa-bay').artifactPack.shards[0].sha256 = 'not-a-hash' }, /shards\[0\]\.sha256 must be a sha256 identity/],
    [index => { index.fallbacks.nationwideFloor.coverageTier = 'flagship' }, /fallbacks\.nationwideFloor\.coverageTier must be thin/],
    [index => { index.usRegions = index.usRegions.filter(region => region.regionId !== 'hawaii') }, /usRegions must include contiguous-us, alaska, and hawaii/],
  ]

  for (const [mutate, pattern] of cases) {
    const malformed = clone(fixture)
    mutate(malformed)
    assert.throws(() => validateCitiesIndex(malformed), pattern)
  }
})

test('artifact URLs reject decoded traversal, encoded separators, controls, and empty segments', () => {
  const cases = [
    [pack => { pack.manifestUrl = '/cities/tampa-bay/%2e%2e%5csecret.json' }, /manifestUrl must be a root-relative URL/],
    [pack => { pack.shards[0].url = '/%2f%2fserver/share.json' }, /shards\[0\]\.url must be a root-relative URL/],
    [pack => { pack.shards[0].url = '/cities/tampa-bay/%0aevents.json' }, /shards\[0\]\.url must be a root-relative URL/],
    [pack => { pack.shards[0].url = '/cities//events.json' }, /shards\[0\]\.url must be a root-relative URL/],
  ]

  for (const [mutate, pattern] of cases) {
    const malformed = clone(fixture)
    mutate(city(malformed, 'tampa-bay').artifactPack)
    rehash(malformed)
    assert.throws(() => validateCitiesIndex(malformed), pattern)
  }
})

test('hashing and validation reject inherited index roots', () => {
  const inherited = Object.create(fixture)
  inherited.indexId = calculateCitiesIndexId({})

  assert.throws(
    () => calculateCitiesIndexId(inherited),
    /index must be a plain object with own fields/,
  )
  assert.throws(
    () => validateCitiesIndex(inherited),
    /index must be a plain object with own fields/,
  )
})

test('schema validators require consumed fields to be own properties', () => {
  const cases = [
    [index => { delete index.generatedAt }, /index\.generatedAt must be an own property/],
    [index => { delete city(index, 'tampa-bay').name }, /cities\[0\]\.name must be an own property/],
    [index => { delete city(index, 'tampa-bay').center.lat }, /cities\[0\]\.center\.lat must be an own property/],
    [index => { delete city(index, 'tampa-bay').bbox.south }, /cities\[0\]\.bbox\.south must be an own property/],
    [index => { delete city(index, 'tampa-bay').artifactPack.manifestId }, /artifactPack\.manifestId must be an own property/],
    [index => { delete city(index, 'tampa-bay').artifactPack.counts.events }, /counts\.events must be an own property/],
    [index => { delete city(index, 'tampa-bay').artifactPack.shards[0].url }, /shards\[0\]\.url must be an own property/],
    [index => { delete index.fallbacks.nationwideFloor }, /fallbacks\.nationwideFloor must be an own property/],
    [index => { delete index.fallbacks.notCovered.name }, /fallbacks\.notCovered\.name must be an own property/],
    [index => { delete index.usRegions[0].bbox }, /usRegions\[0\]\.bbox must be an own property/],
  ]

  for (const [mutate, pattern] of cases) {
    const malformed = clone(fixture)
    mutate(malformed)
    assert.throws(() => validateCitiesIndex(malformed), pattern)
  }
})

test('version-1 schemas reject unknown, non-enumerable, accessor, and symbol fields', () => {
  const cases = [
    index => { index.extra = true },
    index => { city(index, 'tampa-bay').extra = true },
    index => { city(index, 'tampa-bay').artifactPack.extra = true },
    index => { city(index, 'tampa-bay').artifactPack.shards[0].extra = true },
    index => { index.fallbacks.notCovered.extra = true },
    index => { index.usRegions[0].extra = true },
    index => { Object.defineProperty(index, 'extra', { value: true }) },
    index => { Object.defineProperty(city(index, 'tampa-bay'), 'name', { get: () => 'Accessor Tampa', enumerable: true }) },
    index => { index[Symbol('extra')] = true },
  ]
  for (const mutate of cases) {
    const malformed = clone(fixture)
    mutate(malformed)
    assert.throws(
      () => validateCitiesIndex(malformed),
      /must contain exactly|enumerable data properties|symbol keys/,
    )
  }
})

test('schema arrays are exact standard arrays without prototype, method, symbol, named, or sparse tricks', () => {
  const cases = [
    [index => {
      const prototype = Object.create(Array.prototype)
      prototype.find = () => index.cities[1]
      Object.setPrototypeOf(index.cities, prototype)
    }, /index\.cities must use Array\.prototype/],
    [index => {
      city(index, 'tampa-bay').artifactPack.shards.entries = function* entries() {}
    }, /shards must contain only its own length and contiguous index keys/],
    [index => {
      city(index, 'tampa-bay').artifactPack.shards.map = () => []
    }, /shards must contain only its own length and contiguous index keys/],
    [index => {
      city(index, 'sf-east-bay').pathAliases.note = 'shadow'
    }, /pathAliases must contain only its own length and contiguous index keys/],
    [index => {
      index.usRegions[Symbol('shadow')] = true
    }, /usRegions must not contain symbol keys/],
    [index => {
      delete index.cities[1]
    }, /index\.cities must contain only its own length and contiguous index keys/],
    [index => {
      const aliases = city(index, 'tampa-bay').pathAliases
      Object.defineProperty(aliases, '0', { value: aliases[0], enumerable: false })
    }, /pathAliases\[0\] must be an enumerable data property/],
  ]

  for (const [mutate, pattern] of cases) {
    const malformed = clone(fixture)
    mutate(malformed)
    assert.throws(() => validateCitiesIndex(malformed), pattern)
  }
})

test('stateful shard entry getters cannot swap a validated URL before hashing or planning', () => {
  const malicious = clone(fixture)
  const shards = city(malicious, 'tampa-bay').artifactPack.shards
  const approved = shards[0]
  const swapped = {
    ...approved,
    url: '/cities/sf-east-bay/releases/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/events.json',
  }
  let reads = 0
  Object.defineProperty(shards, '0', {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1
      return reads <= 2 ? approved : swapped
    },
  })

  assert.throws(
    () => validateCitiesIndexShape(malicious),
    /shards\[0\] must be an enumerable data property/,
  )
  assert.throws(
    () => calculateCitiesIndexId(malicious),
    /shards\[0\] must be an enumerable data property/,
  )
  assert.equal(reads, 0, 'validation and hashing must inspect descriptors without invoking the getter')
})

test('core validation returns one detached deeply frozen snapshot for browser hashing and use', () => {
  const source = clone(fixture)
  const snapshot = validateCitiesIndexShape(source)

  assert.notEqual(snapshot, source)
  assert.notEqual(snapshot.cities, source.cities)
  assert.notEqual(snapshot.cities[0].artifactPack.shards, source.cities[0].artifactPack.shards)
  assert.equal(validateCitiesIndexShape(snapshot), snapshot)
  assert.equal(Object.getPrototypeOf(snapshot.cities), Array.prototype)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.cities), true)
  assert.equal(Object.isFrozen(snapshot.cities[0].artifactPack.shards[0]), true)

  source.cities[0].artifactPack.shards[0].url = '/swapped-after-validation.json'
  const resolution = resolveValidatedLocation({
    index: snapshot,
    pathname: '/',
    query: '?city=tampa-bay',
    coords: null,
    now: NOW,
  })
  const loadPlan = artifactLoadPlanFromValidatedIndex(snapshot, resolution, { now: NOW })
  assert.equal(
    loadPlan.shards[0].url,
    '/cities/tampa-bay/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/events.json',
  )
})

test('all SHA-256 identities must be primitive strings rather than coercible arrays or objects', () => {
  const cases = [
    [index => { index.indexId = [index.indexId] }, /index\.indexId must be a sha256 identity/],
    [index => {
      const pack = city(index, 'tampa-bay').artifactPack
      pack.manifestId = [pack.manifestId]
    }, /artifactPack\.manifestId must be a sha256 identity/],
    [index => {
      const pack = city(index, 'tampa-bay').artifactPack
      pack.buildId = [pack.buildId]
    }, /artifactPack\.buildId must be a sha256 identity/],
    [index => {
      const shard = city(index, 'tampa-bay').artifactPack.shards[0]
      shard.sha256 = [shard.sha256]
    }, /shards\[0\]\.sha256 must be a sha256 identity/],
  ]

  for (const [mutate, pattern] of cases) {
    const malformed = clone(fixture)
    mutate(malformed)
    assert.throws(() => validateCitiesIndex(malformed), pattern)
  }

  const coercible = clone(fixture)
  const digest = city(coercible, 'tampa-bay').artifactPack.buildId
  city(coercible, 'tampa-bay').artifactPack.buildId = { toString: () => digest }
  assert.throws(
    () => validateCitiesIndex(coercible),
    /must contain only JSON-compatible values|must be a sha256 identity/,
  )
})

test('city, alias, count, byte, and collection bounds fail closed', () => {
  const cases = [
    [index => { city(index, 'tampa-bay').name = 'x'.repeat(CITIES_INDEX_LIMITS.nameLength + 1) }, /bounded string/],
    [index => {
      city(index, 'tampa-bay').pathAliases = Array.from(
        { length: CITIES_INDEX_LIMITS.aliasesPerCity + 1 },
        (_, position) => `alias-${position}`,
      )
    }, /pathAliases must be a bounded array/],
    [index => { city(index, 'tampa-bay').artifactPack.counts.events = CITIES_INDEX_LIMITS.rowCount + 1 }, /bounded non-negative safe integer/],
    [index => { city(index, 'tampa-bay').artifactPack.shards[0].bytes = CITIES_INDEX_LIMITS.shardBytes + 1 }, /bytes must be a bounded non-negative safe integer/],
    [index => { index.cities = Array.from({ length: CITIES_INDEX_LIMITS.cities + 1 }, () => clone(index.cities[0])) }, /index\.cities must contain between/],
  ]
  for (const [mutate, pattern] of cases) {
    const malformed = clone(fixture)
    mutate(malformed)
    assert.throws(() => validateCitiesIndex(malformed), pattern)
  }
})

test('artifact URLs are immutable city-and-manifest-derived paths under one product root', () => {
  const crossCityManifest = clone(fixture)
  const tampa = city(crossCityManifest, 'tampa-bay').artifactPack
  tampa.manifestUrl = tampa.manifestUrl.replace('/tampa-bay/', '/sf-east-bay/')
  rehash(crossCityManifest)
  assert.throws(() => validateCitiesIndex(crossCityManifest), /manifestUrl must be derived from its cityId and manifestId/)

  const crossCityShard = clone(fixture)
  const shard = city(crossCityShard, 'tampa-bay').artifactPack.shards[0]
  shard.url = shard.url.replace('/tampa-bay/', '/sf-east-bay/')
  rehash(crossCityShard)
  assert.throws(() => validateCitiesIndex(crossCityShard), /shards\[0\]\.url must be derived from its city release/)

  const splitRoot = clone(fixture)
  const sfPack = city(splitRoot, 'sf-east-bay').artifactPack
  sfPack.manifestUrl = `/other${sfPack.manifestUrl}`
  sfPack.shards = sfPack.shards.map(entry => ({ ...entry, url: `/other${entry.url}` }))
  rehash(splitRoot)
  assert.throws(() => validateCitiesIndex(splitRoot), /all city artifact packs must share one catalog product root/)
})

test('index generation cannot claim a time before its bound city data', () => {
  const malformed = clone(fixture)
  malformed.generatedAt = '2026-07-15T07:59:59.000Z'
  rehash(malformed)
  assert.throws(
    () => validateCitiesIndex(malformed),
    /artifactPack\.generatedAt must not be later than index\.generatedAt/,
  )
})

test('artifact-pack counts and shards must form one exact bounded closed set', () => {
  const missingShard = clone(fixture)
  const missingPack = city(missingShard, 'tampa-bay').artifactPack
  missingPack.shards = missingPack.shards.filter(shard => shard.kind !== 'places')
  rehash(missingShard)
  assert.throws(
    () => validateCitiesIndex(missingShard),
    /artifactPack\.shards must contain exactly 3 entries/,
  )

  const undeclaredShard = clone(fixture)
  city(undeclaredShard, 'tampa-bay').artifactPack.shards.push({
    kind: 'extras',
    url: '/cities/tampa-bay/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extras.json',
    sha256: 'sha256:6666666666666666666666666666666666666666666666666666666666666666',
    bytes: 10,
    count: 0,
  })
  rehash(undeclaredShard)
  assert.throws(
    () => validateCitiesIndex(undeclaredShard),
    /artifactPack\.shards must contain exactly 3 entries/,
  )

  const extraCount = clone(fixture)
  city(extraCount, 'tampa-bay').artifactPack.counts.extras = 0
  rehash(extraCount)
  assert.throws(() => validateCitiesIndex(extraCount), /counts must contain exactly/)
})

test('query and path signals agree or fail closed while resolving the legacy sf alias', () => {
  assert.throws(
    () => resolve({ query: '?city=tampa-bay', pathname: '/cities/sf-east-bay' }),
    /query and path city signals conflict/,
  )

  const tampa = resolve({ query: '?city=tampa-bay', pathname: '/cities/tampa' })
  assert.equal(tampa.reason, 'explicit-query')
  assert.equal(tampa.cityId, 'tampa-bay')
  assert.equal(tampa.timeZone, 'America/New_York')

  const sfPath = resolve({ pathname: '/cities/sf-east-bay' })
  assert.equal(sfPath.reason, 'explicit-path')
  assert.equal(sfPath.cityId, 'sf-east-bay')
  assert.equal(sfPath.timeZone, 'America/Los_Angeles')

  const sfAlias = resolve({ query: { city: 'sf' } })
  assert.equal(sfAlias.reason, 'explicit-query')
  assert.equal(sfAlias.cityId, 'sf-east-bay')
})

test('duplicate city query parameters fail closed', () => {
  assert.throws(
    () => resolve({ query: '?city=tampa-bay&city=sf' }),
    /at most one city parameter/,
  )
  assert.throws(
    () => resolve({ query: { city: ['tampa-bay', 'sf'] } }),
    /at most one city parameter/,
  )
})

test('flagship bounding boxes resolve Tampa and SF before the nationwide floor', () => {
  const tampa = resolve({ coords: { latitude: 27.95, longitude: -82.46 } })
  assert.equal(tampa.reason, 'coordinates-city')
  assert.equal(tampa.cityId, 'tampa-bay')
  assert.equal(tampa.coverageTier, 'flagship')

  const sf = resolve({ coords: { lat: 37.84, lng: -122.25 } })
  assert.equal(sf.reason, 'coordinates-city')
  assert.equal(sf.cityId, 'sf-east-bay')
})

test('overlapping city bounding boxes fail instead of selecting array order', () => {
  const overlapping = clone(fixture)
  city(overlapping, 'sf-east-bay').bbox = clone(city(overlapping, 'tampa-bay').bbox)
  city(overlapping, 'sf-east-bay').center = clone(city(overlapping, 'tampa-bay').center)
  rehash(overlapping)
  assert.throws(
    () => resolve({ coords: { latitude: 27.95, longitude: -82.46 } }, overlapping),
    /coordinates match overlapping city bounding boxes/,
  )
})

test('other contiguous-US, Alaska, and Hawaii coordinates resolve to the thin floor', () => {
  for (const coords of [
    { latitude: 39.0119, longitude: -98.4842 },
    { latitude: 61.2181, longitude: -149.9003 },
    { latitude: 21.3099, longitude: -157.8581 },
  ]) {
    const resolution = resolve({ coords })
    assert.equal(resolution.reason, 'coordinates-nationwide-floor')
    assert.equal(resolution.coverageTier, 'thin')
    assert.equal(resolution.fallbackId, 'nationwide-floor')
    assert.equal(resolution.cityId, null)
  }
})

test('outside-US coordinates and unknown explicit cities resolve honestly to not-covered', () => {
  const outside = resolve({ coords: { latitude: 51.5072, longitude: -0.1276 } })
  assert.equal(outside.reason, 'coordinates-not-covered')
  assert.equal(outside.coverageTier, 'not-covered')

  const unknownQuery = resolve({ query: '?city=made-up' })
  assert.equal(unknownQuery.reason, 'unknown-query-city')
  assert.equal(unknownQuery.cityId, null)
  assert.equal(unknownQuery.fallbackId, 'not-covered')

  const unknownPath = resolve({ pathname: '/cities/also-made-up' })
  assert.equal(unknownPath.reason, 'unknown-path-city')
  assert.equal(unknownPath.cityId, null)
  assert.equal(unknownPath.fallbackId, 'not-covered')
})

test('only a request with no explicit location signal uses defaultCityId', () => {
  const defaulted = resolve()
  assert.equal(defaulted.reason, 'default-city')
  assert.equal(defaulted.cityId, 'tampa-bay')

  for (const resolution of [
    resolve({ query: '?city=' }),
    resolve({ query: '?city=unknown' }),
    resolve({ pathname: '/cities/unknown' }),
  ]) {
    assert.equal(resolution.cityId, null, 'an explicit unknown location must never silently become Tampa')
    assert.equal(resolution.coverageTier, 'not-covered')
  }
})

test('invalid coordinate inputs fail clearly', () => {
  assert.throws(
    () => resolve({ coords: { latitude: 91, longitude: -82 } }),
    /coords\.latitude must be between -90 and 90/,
  )
  assert.throws(
    () => resolve({ coords: { latitude: 27.95 } }),
    /coords must provide finite latitude and longitude/,
  )
  assert.throws(
    () => resolve({ coords: { latitude: Number.NaN, longitude: -82 } }),
    /coords must provide finite latitude and longitude/,
  )
})

test('healthy, degraded, and unknown unexpired packs produce deterministic load plans', () => {
  const healthyResolution = resolve({ query: '?city=tampa-bay' })
  const healthy = plan(fixture, healthyResolution)
  assert.equal(healthy.canLoad, true)
  assert.equal(healthy.artifactPackStatus, 'ready')
  assert.equal(healthy.evaluatedAt, NOW)
  assert.equal(healthy.manifestUrl, '/cities/tampa-bay/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/artifact-manifest.json')
  assert.deepEqual(healthy.shards.map(shard => shard.url), [
    '/cities/tampa-bay/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/events.json',
    '/cities/tampa-bay/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/places.json',
    '/cities/tampa-bay/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/guides.json',
  ])
  assert.deepEqual(healthy.warnings, [])
  assert.deepEqual(healthy.refusalReasons, [])

  const degraded = plan(fixture, resolve({ query: '?city=sf' }))
  assert.equal(degraded.canLoad, true)
  assert.equal(degraded.artifactPackStatus, 'degraded')
  assert.deepEqual(degraded.warnings, ['SOURCE_HEALTH_DEGRADED'])

  const unknownIndex = clone(fixture)
  city(unknownIndex, 'tampa-bay').artifactPack.sourceHealth = 'unknown'
  rehash(unknownIndex)
  const unknown = plan(
    unknownIndex,
    resolve({ query: '?city=tampa-bay' }, unknownIndex),
  )
  assert.equal(unknown.canLoad, true)
  assert.equal(unknown.artifactPackStatus, 'unknown')
  assert.deepEqual(unknown.warnings, ['SOURCE_HEALTH_UNKNOWN'])
})

test('expired and failed packs refuse loads with stable codes and no loadable URLs', () => {
  const expiredIndex = clone(fixture)
  city(expiredIndex, 'tampa-bay').artifactPack.expiresAt = '2026-07-16T00:00:00.000Z'
  rehash(expiredIndex)
  const expired = plan(
    expiredIndex,
    resolve({ query: '?city=tampa-bay' }, expiredIndex),
  )
  assert.equal(expired.canLoad, false)
  assert.equal(expired.artifactPackStatus, 'expired')
  assert.deepEqual(expired.refusalReasons, ['ARTIFACT_PACK_EXPIRED'])
  assert.equal(expired.manifestUrl, null)
  assert.deepEqual(expired.shards, [])

  const failedIndex = clone(fixture)
  city(failedIndex, 'tampa-bay').artifactPack.sourceHealth = 'failed'
  rehash(failedIndex)
  const failed = plan(
    failedIndex,
    resolve({ query: '?city=tampa-bay' }, failedIndex),
  )
  assert.equal(failed.canLoad, false)
  assert.equal(failed.artifactPackStatus, 'failed')
  assert.deepEqual(failed.refusalReasons, ['ARTIFACT_PACK_FAILED'])
  assert.equal(failed.manifestUrl, null)
  assert.deepEqual(failed.shards, [])
})

test('load planning requires a valid injected evaluation time', () => {
  const resolution = resolve({ query: '?city=tampa-bay' })
  assert.throws(
    () => artifactLoadPlan(fixture, resolution),
    /now must be an injected valid Date, timestamp, or epoch milliseconds/,
  )
  assert.throws(
    () => artifactLoadPlan(fixture, resolution, { now: 'not-a-time' }),
    /now must be an injected valid Date, timestamp, or epoch milliseconds/,
  )
})

test('load planning re-evaluates a resolution against injected current time', () => {
  const resolution = resolve({ query: '?city=tampa-bay' })
  assert.equal(resolution.artifactPackStatus, 'ready')

  const replayed = plan(fixture, resolution, '2026-07-19T12:00:00.000Z')
  assert.equal(replayed.evaluatedAt, '2026-07-19T12:00:00.000Z')
  assert.equal(replayed.canLoad, false)
  assert.equal(replayed.artifactPackStatus, 'expired')
  assert.deepEqual(replayed.refusalReasons, ['ARTIFACT_PACK_EXPIRED'])
  assert.equal(replayed.manifestUrl, null)
  assert.deepEqual(replayed.shards, [])
})

test('fallback resolutions are honest no-pack plans and never invent URLs', () => {
  const floor = plan(
    fixture,
    resolve({ coords: { latitude: 39.0119, longitude: -98.4842 } }),
  )
  assert.equal(floor.canLoad, false)
  assert.equal(floor.coverageTier, 'thin')
  assert.equal(floor.artifactPackStatus, 'none')
  assert.deepEqual(floor.refusalReasons, ['NO_ARTIFACT_PACK'])
  assert.equal(floor.manifestUrl, null)
  assert.deepEqual(floor.shards, [])
})

test('resolution and load planning are pure and do not mutate inputs', () => {
  const frozenIndex = deepFreeze(clone(fixture))
  const input = deepFreeze({
    index: frozenIndex,
    pathname: '/cities/tampa-bay',
    query: { city: 'tampa-bay' },
    coords: { latitude: 37.84, longitude: -122.25 },
    now: NOW,
  })
  const before = JSON.stringify(input)
  const resolution = resolveLocation(input)
  const first = plan(frozenIndex, resolution)
  const second = plan(frozenIndex, resolveLocation(input))

  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(first, second)
})
