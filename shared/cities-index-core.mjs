// Browser-safe half of the runtime cities-index contract. This module owns
// canonical JSON, the exact version-1 shape, deterministic resolution, and
// fail-closed load planning. Authorization and SHA-256 calculation stay with
// the caller: Node uses shared/cities-index.mjs; browsers use Web Crypto and a
// separately pinned index identity.

const SCHEMA_VERSION = 1
const COVERAGE_TIERS = new Set(['flagship', 'metro', 'thin', 'not-covered'])
const SOURCE_HEALTH_VALUES = new Set(['healthy', 'degraded', 'failed', 'unknown'])
const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REQUIRED_US_REGIONS = ['contiguous-us', 'alaska', 'hawaii']
const REQUIRED_SHARD_KINDS = ['events', 'places', 'guides']
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const validatedCitiesIndexSnapshots = new WeakSet()

export const CITIES_INDEX_LIMITS = Object.freeze({
  aliasesPerCity: 16,
  cities: 512,
  idLength: 64,
  nameLength: 160,
  regions: 16,
  rowCount: 10_000_000,
  shardBytes: 128 * 1024 * 1024,
  shardsPerCity: REQUIRED_SHARD_KINDS.length,
  urlLength: 768,
})

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPlainObject(value) {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactStandardArrayDescriptors(value, label) {
  invariant(Array.isArray(value), `${label} must be an array`)
  invariant(Object.getPrototypeOf(value) === Array.prototype, `${label} must use Array.prototype`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const ownKeys = Reflect.ownKeys(descriptors)
  invariant(ownKeys.every(key => typeof key === 'string'), `${label} must not contain symbol keys`)

  const lengthDescriptor = descriptors.length
  invariant(
    lengthDescriptor
      && hasOwn(lengthDescriptor, 'value')
      && lengthDescriptor.enumerable === false
      && Number.isSafeInteger(lengthDescriptor.value)
      && lengthDescriptor.value >= 0,
    `${label}.length must be an own non-enumerable data property`,
  )
  const length = lengthDescriptor.value
  invariant(
    ownKeys.length === length + 1,
    `${label} must contain only its own length and contiguous index keys`,
  )
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index]
    invariant(descriptor, `${label}[${index}] must be an own array entry`)
    invariant(
      descriptor.enumerable === true && hasOwn(descriptor, 'value'),
      `${label}[${index}] must be an enumerable data property`,
    )
  }
  return { descriptors, length }
}

function detachedPlainData(value, path = 'index', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), `${path} must contain only finite JSON numbers`)
    return value
  }
  invariant(value !== null && typeof value === 'object', `${path} must contain only JSON-compatible values`)
  invariant(!ancestors.has(value), `${path} must not contain circular references`)

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const { descriptors, length } = exactStandardArrayDescriptors(value, path)
      const snapshot = []
      for (let index = 0; index < length; index += 1) {
        snapshot[index] = detachedPlainData(descriptors[index].value, `${path}[${index}]`, ancestors)
      }
      return Object.freeze(snapshot)
    }

    const prototype = Object.getPrototypeOf(value)
    invariant(
      prototype === Object.prototype || prototype === null,
      `${path} must contain only plain JSON objects`,
    )
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const ownKeys = Reflect.ownKeys(descriptors)
    invariant(ownKeys.every(key => typeof key === 'string'), `${path} must not contain symbol keys`)
    invariant(
      ownKeys.every(key => descriptors[key].enumerable === true && hasOwn(descriptors[key], 'value')),
      `${path} must contain only enumerable data properties`,
    )

    const snapshot = Object.create(prototype === null ? null : Object.prototype)
    for (const key of ownKeys) {
      Object.defineProperty(snapshot, key, {
        value: detachedPlainData(descriptors[key].value, `${path}.${key}`, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return Object.freeze(snapshot)
  } finally {
    ancestors.delete(value)
  }
}

function requireOwnKeys(value, label, keys) {
  for (const key of keys) {
    invariant(hasOwn(value, key), `${label}.${key} must be an own property`)
  }
}

function requireExactKeys(value, label, keys) {
  requireOwnKeys(value, label, keys)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const ownKeys = Reflect.ownKeys(value)
  invariant(ownKeys.every(key => typeof key === 'string'), `${label} must not contain symbol keys`)
  const actual = ownKeys.sort()
  const expected = [...keys].sort()
  invariant(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} must contain exactly: ${expected.join(', ')}`,
  )
  invariant(
    expected.every(key => descriptors[key]?.enumerable === true && hasOwn(descriptors[key], 'value')),
    `${label} must contain only enumerable data properties`,
  )
}

function canonicalJson(value, path = 'index') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), `${path} must contain only finite JSON numbers`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    const { descriptors, length } = exactStandardArrayDescriptors(value, path)
    const entries = []
    for (let index = 0; index < length; index += 1) {
      entries.push(canonicalJson(descriptors[index].value, `${path}[${index}]`))
    }
    return `[${entries.join(',')}]`
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], `${path}.${key}`)}`)
      .join(',')}}`
  }
  if (isRecord(value)) throw new TypeError(`${path} must contain only plain JSON objects`)
  throw new TypeError(`${path} must contain only JSON-compatible values`)
}

export function canonicalCitiesIndexJson(index) {
  let snapshot = index
  if (!validatedCitiesIndexSnapshots.has(snapshot)) {
    invariant(isPlainObject(snapshot), 'index must be a plain object with own fields')
    snapshot = detachedPlainData(snapshot)
  }
  const payload = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'indexId'))
  return canonicalJson(payload)
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function validIanaTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

function validRootRelativeUrl(value) {
  if (
    typeof value !== 'string'
    || value.length > CITIES_INDEX_LIMITS.urlLength
    || !value.startsWith('/')
    || value.startsWith('//')
  ) return false
  if (/[\\\s?#\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c)/i.test(value)) return false
  try {
    const decoded = decodeURIComponent(value)
    if (!decoded.startsWith('/') || decoded.startsWith('//')) return false
    if (/[\\\s?#\u0000-\u001f\u007f]/.test(decoded)) return false
    const segments = decoded.split('/').slice(1)
    return segments.length > 0
      && !segments.some(segment => segment === '' || segment === '.' || segment === '..')
  } catch {
    return false
  }
}

function requireString(value, label, maxLength = CITIES_INDEX_LIMITS.nameLength) {
  invariant(
    typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength,
    `${label} must be a non-empty bounded string`,
  )
}

function validKebabId(value) {
  return typeof value === 'string'
    && value.length <= CITIES_INDEX_LIMITS.idLength
    && KEBAB_ID.test(value)
}

function validatePoint(point, label) {
  invariant(isPlainObject(point), `${label} must be a plain object`)
  requireExactKeys(point, label, ['lat', 'lng'])
  invariant(Number.isFinite(point.lat), `${label}.lat must be a finite latitude`)
  invariant(Number.isFinite(point.lng), `${label}.lng must be a finite longitude`)
  invariant(point.lat >= -90 && point.lat <= 90, `${label}.lat must be between -90 and 90`)
  invariant(point.lng >= -180 && point.lng <= 180, `${label}.lng must be between -180 and 180`)
}

function validateBbox(bbox, label) {
  invariant(isPlainObject(bbox), `${label} must be a plain object`)
  requireExactKeys(bbox, label, ['south', 'west', 'north', 'east'])
  for (const key of ['south', 'west', 'north', 'east']) {
    invariant(Number.isFinite(bbox[key]), `${label}.${key} must be finite`)
  }
  invariant(bbox.south >= -90 && bbox.south <= 90, `${label}.south must be between -90 and 90`)
  invariant(bbox.north >= -90 && bbox.north <= 90, `${label}.north must be between -90 and 90`)
  invariant(bbox.west >= -180 && bbox.west <= 180, `${label}.west must be between -180 and 180`)
  invariant(bbox.east >= -180 && bbox.east <= 180, `${label}.east must be between -180 and 180`)
  invariant(bbox.south < bbox.north, `${label}.south must be less than north`)
  invariant(bbox.west < bbox.east, `${label}.west must be less than east`)
}

function pointInBbox(point, bbox) {
  return point.lat >= bbox.south && point.lat <= bbox.north
    && point.lng >= bbox.west && point.lng <= bbox.east
}

function releaseBaseUrl(catalogRoot, cityId, manifestId) {
  return `${catalogRoot}/cities/${cityId}/releases/${manifestId.slice('sha256:'.length)}`
}

function catalogRootFromManifestUrl(manifestUrl, cityId, manifestId, label) {
  const suffix = `/cities/${cityId}/releases/${manifestId.slice('sha256:'.length)}/artifact-manifest.json`
  invariant(manifestUrl.endsWith(suffix), `${label}.manifestUrl must be derived from its cityId and manifestId`)
  const root = manifestUrl.slice(0, -suffix.length)
  invariant(root === '' || validRootRelativeUrl(`${root}/catalog`), `${label}.manifestUrl has an invalid product root`)
  return root
}

function validateArtifactPack(pack, label, cityId) {
  invariant(isPlainObject(pack), `${label} must be a plain object`)
  requireExactKeys(pack, label, [
    'manifestUrl',
    'manifestId',
    'buildId',
    'generatedAt',
    'expiresAt',
    'counts',
    'sourceHealth',
    'shards',
  ])
  invariant(validRootRelativeUrl(pack.manifestUrl), `${label}.manifestUrl must be a root-relative URL`)
  invariant(
    typeof pack.manifestId === 'string' && SHA256_ID.test(pack.manifestId),
    `${label}.manifestId must be a sha256 identity`,
  )
  invariant(
    typeof pack.buildId === 'string' && SHA256_ID.test(pack.buildId),
    `${label}.buildId must be a sha256 identity`,
  )
  const catalogRoot = catalogRootFromManifestUrl(pack.manifestUrl, cityId, pack.manifestId, label)
  invariant(validIsoTimestamp(pack.generatedAt), `${label}.generatedAt must be an ISO timestamp`)
  invariant(validIsoTimestamp(pack.expiresAt), `${label}.expiresAt must be an ISO timestamp`)
  invariant(Date.parse(pack.generatedAt) < Date.parse(pack.expiresAt), `${label}.generatedAt must be before expiresAt`)
  invariant(isPlainObject(pack.counts), `${label}.counts must be a plain object`)
  requireExactKeys(pack.counts, `${label}.counts`, REQUIRED_SHARD_KINDS)
  for (const key of REQUIRED_SHARD_KINDS) {
    invariant(
      Number.isSafeInteger(pack.counts[key])
        && pack.counts[key] >= 0
        && pack.counts[key] <= CITIES_INDEX_LIMITS.rowCount,
      `${label}.counts.${key} must be a bounded non-negative safe integer`,
    )
  }
  invariant(
    SOURCE_HEALTH_VALUES.has(pack.sourceHealth),
    `${label}.sourceHealth must be healthy, degraded, failed, or unknown`,
  )
  const { length: shardCount } = exactStandardArrayDescriptors(pack.shards, `${label}.shards`)
  invariant(
    shardCount === CITIES_INDEX_LIMITS.shardsPerCity,
    `${label}.shards must contain exactly ${CITIES_INDEX_LIMITS.shardsPerCity} entries`,
  )

  const shardKinds = new Set()
  const shardUrls = new Set()
  const baseUrl = releaseBaseUrl(catalogRoot, cityId, pack.manifestId)
  for (const [index, shard] of pack.shards.entries()) {
    const shardLabel = `${label}.shards[${index}]`
    invariant(isPlainObject(shard), `${shardLabel} must be a plain object`)
    requireExactKeys(shard, shardLabel, ['kind', 'url', 'sha256', 'bytes', 'count'])
    invariant(REQUIRED_SHARD_KINDS.includes(shard.kind), `${shardLabel}.kind is unsupported`)
    invariant(!shardKinds.has(shard.kind), `${label} has duplicate shard kind: ${shard.kind}`)
    shardKinds.add(shard.kind)
    invariant(validRootRelativeUrl(shard.url), `${shardLabel}.url must be a root-relative URL`)
    invariant(shard.url === `${baseUrl}/${shard.kind}.json`, `${shardLabel}.url must be derived from its city release`)
    invariant(!shardUrls.has(shard.url), `${label} has duplicate shard URL: ${shard.url}`)
    shardUrls.add(shard.url)
    invariant(
      typeof shard.sha256 === 'string' && SHA256_ID.test(shard.sha256),
      `${shardLabel}.sha256 must be a sha256 identity`,
    )
    invariant(
      Number.isSafeInteger(shard.bytes)
        && shard.bytes >= 0
        && shard.bytes <= CITIES_INDEX_LIMITS.shardBytes,
      `${shardLabel}.bytes must be a bounded non-negative safe integer`,
    )
    invariant(
      Number.isSafeInteger(shard.count)
        && shard.count >= 0
        && shard.count <= CITIES_INDEX_LIMITS.rowCount,
      `${shardLabel}.count must be a bounded non-negative safe integer`,
    )
    invariant(shard.count === pack.counts[shard.kind], `${shardLabel}.count must match counts.${shard.kind}`)
  }
  for (const kind of REQUIRED_SHARD_KINDS) {
    invariant(shardKinds.has(kind), `${label}.counts.${kind} must have exactly one shard`)
  }
  return catalogRoot
}

function validateFallback(fallback, key, expected) {
  const label = `fallbacks.${key}`
  invariant(isPlainObject(fallback), `${label} must be a plain object`)
  requireExactKeys(fallback, label, ['fallbackId', 'name', 'coverageTier', 'countryCode', 'artifactPack'])
  invariant(fallback.fallbackId === expected.fallbackId, `${label}.fallbackId must be ${expected.fallbackId}`)
  requireString(fallback.name, `${label}.name`)
  invariant(fallback.coverageTier === expected.coverageTier, `${label}.coverageTier must be ${expected.coverageTier}`)
  invariant(fallback.countryCode === expected.countryCode, `${label}.countryCode must be ${expected.countryLabel}`)
  invariant(fallback.artifactPack === null, `${label}.artifactPack must be null in the version-1 index`)
}

function validateCitiesIndexSnapshot(index) {
  invariant(isPlainObject(index), 'index must be a plain object with own fields')
  requireExactKeys(index, 'index', [
    'schemaVersion',
    'generatedAt',
    'indexId',
    'defaultCityId',
    'cities',
    'fallbacks',
    'usRegions',
  ])
  invariant(index.schemaVersion === SCHEMA_VERSION, 'index.schemaVersion must be 1')
  invariant(validIsoTimestamp(index.generatedAt), 'index.generatedAt must be an ISO timestamp')
  invariant(
    typeof index.indexId === 'string' && SHA256_ID.test(index.indexId),
    'index.indexId must be a sha256 identity',
  )
  invariant(validKebabId(index.defaultCityId), 'index.defaultCityId must be bounded lowercase kebab-case')
  const { length: cityCount } = exactStandardArrayDescriptors(index.cities, 'index.cities')
  invariant(
    cityCount > 0 && cityCount <= CITIES_INDEX_LIMITS.cities,
    `index.cities must contain between 1 and ${CITIES_INDEX_LIMITS.cities} entries`,
  )

  const cityIds = new Set()
  const locationTokens = new Set()
  const catalogRoots = new Set()
  for (const [position, city] of index.cities.entries()) {
    const label = `cities[${position}]`
    invariant(isPlainObject(city), `${label} must be a plain object`)
    requireExactKeys(city, label, [
      'cityId',
      'name',
      'shortName',
      'region',
      'countryCode',
      'timeZone',
      'center',
      'bbox',
      'coverageTier',
      'pathAliases',
      'artifactPack',
    ])
    invariant(validKebabId(city.cityId), `${label}.cityId must be bounded lowercase kebab-case`)
    invariant(!cityIds.has(city.cityId), `duplicate city id: ${city.cityId}`)
    cityIds.add(city.cityId)
    requireString(city.name, `${label}.name`)
    requireString(city.shortName, `${label}.shortName`)
    requireString(city.region, `${label}.region`)
    invariant(typeof city.countryCode === 'string' && /^[A-Z]{2}$/.test(city.countryCode), `${label}.countryCode must be a two-letter uppercase code`)
    invariant(validIanaTimeZone(city.timeZone), `${label}.timeZone must be a valid IANA time zone`)
    validatePoint(city.center, `${label}.center`)
    validateBbox(city.bbox, `${label}.bbox`)
    invariant(pointInBbox(city.center, city.bbox), `${label}.center must be inside ${label}.bbox`)
    invariant(
      COVERAGE_TIERS.has(city.coverageTier),
      `${label}.coverageTier must be flagship, metro, thin, or not-covered`,
    )
    const { length: aliasCount } = exactStandardArrayDescriptors(city.pathAliases, `${label}.pathAliases`)
    invariant(aliasCount <= CITIES_INDEX_LIMITS.aliasesPerCity, `${label}.pathAliases must be a bounded array`)

    for (const token of [city.cityId, ...city.pathAliases]) {
      invariant(validKebabId(token), `${label} city id and path aliases must be bounded lowercase kebab-case`)
      invariant(!locationTokens.has(token), `duplicate city id or path alias: ${token}`)
      locationTokens.add(token)
    }
    const catalogRoot = validateArtifactPack(city.artifactPack, `${label}.artifactPack`, city.cityId)
    catalogRoots.add(catalogRoot)
    invariant(
      Date.parse(city.artifactPack.generatedAt) <= Date.parse(index.generatedAt),
      `${label}.artifactPack.generatedAt must not be later than index.generatedAt`,
    )
  }
  invariant(cityIds.has(index.defaultCityId), 'index.defaultCityId must identify a city in index.cities')
  invariant(catalogRoots.size === 1, 'all city artifact packs must share one catalog product root')

  invariant(isPlainObject(index.fallbacks), 'index.fallbacks must be a plain object')
  requireExactKeys(index.fallbacks, 'fallbacks', ['nationwideFloor', 'notCovered'])
  validateFallback(index.fallbacks.nationwideFloor, 'nationwideFloor', {
    fallbackId: 'nationwide-floor',
    coverageTier: 'thin',
    countryCode: 'US',
    countryLabel: 'US',
  })
  validateFallback(index.fallbacks.notCovered, 'notCovered', {
    fallbackId: 'not-covered',
    coverageTier: 'not-covered',
    countryCode: null,
    countryLabel: 'null',
  })

  const { length: regionCount } = exactStandardArrayDescriptors(index.usRegions, 'index.usRegions')
  invariant(
    regionCount > 0 && regionCount <= CITIES_INDEX_LIMITS.regions,
    `index.usRegions must contain between 1 and ${CITIES_INDEX_LIMITS.regions} entries`,
  )
  const regionIds = new Set()
  for (const [position, region] of index.usRegions.entries()) {
    const label = `usRegions[${position}]`
    invariant(isPlainObject(region), `${label} must be a plain object`)
    requireExactKeys(region, label, ['regionId', 'bbox'])
    invariant(validKebabId(region.regionId), `${label}.regionId must be bounded lowercase kebab-case`)
    invariant(!regionIds.has(region.regionId), `duplicate US region id: ${region.regionId}`)
    regionIds.add(region.regionId)
    validateBbox(region.bbox, `${label}.bbox`)
  }
  invariant(
    REQUIRED_US_REGIONS.every(regionId => regionIds.has(regionId)),
    'index.usRegions must include contiguous-us, alaska, and hawaii',
  )
  return index
}

export function validateCitiesIndexShape(index) {
  if (validatedCitiesIndexSnapshots.has(index)) return index
  invariant(isPlainObject(index), 'index must be a plain object with own fields')
  const snapshot = validateCitiesIndexSnapshot(detachedPlainData(index))
  validatedCitiesIndexSnapshots.add(snapshot)
  return snapshot
}

function parseNow(now) {
  const epoch = now instanceof Date ? now.getTime()
    : typeof now === 'number' ? now
      : typeof now === 'string' ? Date.parse(now)
        : Number.NaN
  invariant(Number.isFinite(epoch), 'now must be an injected valid Date, timestamp, or epoch milliseconds')
  return epoch
}

function oneQueryCity(params) {
  if (!params.has('city')) return { present: false, value: null }
  const values = params.getAll('city')
  invariant(values.length === 1, 'query must contain at most one city parameter')
  return { present: true, value: String(values[0] ?? '').trim().toLowerCase() }
}

function queryCitySignal(query) {
  if (query === undefined || query === null) return { present: false, value: null }
  if (typeof query === 'string') {
    return oneQueryCity(new URLSearchParams(query.startsWith('?') ? query.slice(1) : query))
  }
  if (query instanceof URLSearchParams) return oneQueryCity(query)
  invariant(isRecord(query), 'query must be a string, URLSearchParams, or object')
  if (!hasOwn(query, 'city')) return { present: false, value: null }
  if (Array.isArray(query.city)) {
    invariant(query.city.length === 1, 'query must contain at most one city parameter')
    return { present: true, value: String(query.city[0] ?? '').trim().toLowerCase() }
  }
  return { present: true, value: String(query.city ?? '').trim().toLowerCase() }
}

function catalogRootForIndex(index) {
  const city = index.cities[0]
  return catalogRootFromManifestUrl(
    city.artifactPack.manifestUrl,
    city.cityId,
    city.artifactPack.manifestId,
    'cities[0].artifactPack',
  )
}

function pathCitySignal(pathname, catalogRoot) {
  if (pathname === undefined || pathname === null || pathname === '') return { present: false, value: null }
  invariant(typeof pathname === 'string', 'pathname must be a string')
  const prefix = `${catalogRoot}/cities/`
  if (!pathname.startsWith(prefix)) return { present: false, value: null }
  const relative = pathname.slice(prefix.length)
  const match = relative.match(/^([^/?#]+)(?:[/?#]|$)/)
  if (!match) return { present: true, value: '' }
  let value = match[1]
  try {
    value = decodeURIComponent(value)
  } catch {
    // A malformed explicit segment remains explicit and resolves not-covered.
  }
  return { present: true, value: value.trim().toLowerCase() }
}

function normalizeCoords(coords) {
  if (coords === undefined || coords === null) return null
  invariant(isRecord(coords), 'coords must be an object')
  const latitude = hasOwn(coords, 'latitude') ? coords.latitude : coords.lat
  const longitude = hasOwn(coords, 'longitude')
    ? coords.longitude
    : hasOwn(coords, 'lng') ? coords.lng : coords.lon
  invariant(Number.isFinite(latitude) && Number.isFinite(longitude), 'coords must provide finite latitude and longitude')
  invariant(latitude >= -90 && latitude <= 90, 'coords.latitude must be between -90 and 90')
  invariant(longitude >= -180 && longitude <= 180, 'coords.longitude must be between -180 and 180')
  return { lat: latitude, lng: longitude }
}

function artifactPackStatus(pack, nowMs) {
  if (!pack) return 'none'
  if (nowMs >= Date.parse(pack.expiresAt)) return 'expired'
  if (pack.sourceHealth === 'failed') return 'failed'
  if (pack.sourceHealth === 'degraded') return 'degraded'
  if (pack.sourceHealth === 'unknown') return 'unknown'
  return 'ready'
}

function cityForToken(index, token) {
  return index.cities.find(city => city.cityId === token || city.pathAliases.includes(token)) || null
}

function cityResolution(index, city, reason, nowMs, details = {}) {
  return {
    indexId: index.indexId,
    resolvedAt: new Date(nowMs).toISOString(),
    reason,
    coverageTier: city.coverageTier,
    cityId: city.cityId,
    cityName: city.name,
    shortName: city.shortName,
    region: city.region,
    countryCode: city.countryCode,
    timeZone: city.timeZone,
    fallbackId: null,
    fallbackName: null,
    artifactPackStatus: artifactPackStatus(city.artifactPack, nowMs),
    requestedCity: details.requestedCity ?? null,
    coordinates: details.coordinates ? { ...details.coordinates } : null,
    matchedRegionId: null,
  }
}

function fallbackResolution(index, fallback, reason, nowMs, details = {}) {
  return {
    indexId: index.indexId,
    resolvedAt: new Date(nowMs).toISOString(),
    reason,
    coverageTier: fallback.coverageTier,
    cityId: null,
    cityName: null,
    shortName: null,
    region: null,
    countryCode: fallback.countryCode,
    timeZone: null,
    fallbackId: fallback.fallbackId,
    fallbackName: fallback.name,
    artifactPackStatus: 'none',
    requestedCity: details.requestedCity ?? null,
    coordinates: details.coordinates ? { ...details.coordinates } : null,
    matchedRegionId: details.matchedRegionId ?? null,
  }
}

export function resolveValidatedLocation({ index, pathname = '', query = '', coords = null, now } = {}) {
  const nowMs = parseNow(now)
  const querySignal = queryCitySignal(query)
  const pathSignal = pathCitySignal(pathname, catalogRootForIndex(index))
  if (querySignal.present && pathSignal.present) {
    const queryCity = cityForToken(index, querySignal.value)
    const pathCity = cityForToken(index, pathSignal.value)
    invariant(
      (queryCity && pathCity && queryCity.cityId === pathCity.cityId)
        || (!queryCity && !pathCity && querySignal.value === pathSignal.value),
      'query and path city signals conflict',
    )
  }
  if (querySignal.present) {
    const city = cityForToken(index, querySignal.value)
    return city
      ? cityResolution(index, city, 'explicit-query', nowMs, { requestedCity: querySignal.value })
      : fallbackResolution(index, index.fallbacks.notCovered, 'unknown-query-city', nowMs, { requestedCity: querySignal.value })
  }
  if (pathSignal.present) {
    const city = cityForToken(index, pathSignal.value)
    return city
      ? cityResolution(index, city, 'explicit-path', nowMs, { requestedCity: pathSignal.value })
      : fallbackResolution(index, index.fallbacks.notCovered, 'unknown-path-city', nowMs, { requestedCity: pathSignal.value })
  }

  const point = normalizeCoords(coords)
  if (point) {
    const matches = index.cities.filter(entry => pointInBbox(point, entry.bbox))
    invariant(matches.length <= 1, 'coordinates match overlapping city bounding boxes')
    if (matches.length === 1) return cityResolution(index, matches[0], 'coordinates-city', nowMs, { coordinates: point })
    const regions = index.usRegions.filter(entry => pointInBbox(point, entry.bbox))
    invariant(regions.length <= 1, 'coordinates match overlapping US region bounding boxes')
    if (regions.length === 1) {
      return fallbackResolution(index, index.fallbacks.nationwideFloor, 'coordinates-nationwide-floor', nowMs, {
        coordinates: point,
        matchedRegionId: regions[0].regionId,
      })
    }
    return fallbackResolution(index, index.fallbacks.notCovered, 'coordinates-not-covered', nowMs, { coordinates: point })
  }

  const defaultCity = index.cities.find(city => city.cityId === index.defaultCityId)
  return cityResolution(index, defaultCity, 'default-city', nowMs)
}

export function artifactLoadPlanFromValidatedIndex(index, resolution, { now } = {}) {
  invariant(isRecord(resolution), 'resolution must be an object')
  invariant(resolution.indexId === index.indexId, 'resolution.indexId must match index.indexId')
  const nowMs = parseNow(now)
  const evaluatedAt = new Date(nowMs).toISOString()

  if (resolution.cityId === null) {
    const fallback = Object.values(index.fallbacks).find(entry => entry.fallbackId === resolution.fallbackId)
    invariant(fallback, 'resolution.fallbackId must identify an index fallback')
    invariant(resolution.coverageTier === fallback.coverageTier, 'resolution.coverageTier must match its fallback')
    return {
      indexId: index.indexId,
      cityId: null,
      fallbackId: fallback.fallbackId,
      coverageTier: fallback.coverageTier,
      artifactPackStatus: 'none',
      evaluatedAt,
      sourceHealth: null,
      canLoad: false,
      manifestUrl: null,
      manifestId: null,
      buildId: null,
      shards: [],
      warnings: [],
      refusalReasons: ['NO_ARTIFACT_PACK'],
    }
  }

  const city = index.cities.find(entry => entry.cityId === resolution.cityId)
  invariant(city, 'resolution.cityId must identify an index city')
  invariant(resolution.coverageTier === city.coverageTier, 'resolution.coverageTier must match its city')
  const resolvedAtMs = parseNow(resolution.resolvedAt)
  const snapshotStatus = artifactPackStatus(city.artifactPack, resolvedAtMs)
  invariant(
    resolution.artifactPackStatus === snapshotStatus,
    'resolution.artifactPackStatus does not match its city pack at resolvedAt',
  )
  const status = artifactPackStatus(city.artifactPack, nowMs)

  const warnings = []
  const refusalReasons = []
  if (status === 'degraded') warnings.push('SOURCE_HEALTH_DEGRADED')
  if (status === 'unknown') warnings.push('SOURCE_HEALTH_UNKNOWN')
  if (status === 'expired') refusalReasons.push('ARTIFACT_PACK_EXPIRED')
  if (status === 'failed') refusalReasons.push('ARTIFACT_PACK_FAILED')
  const canLoad = refusalReasons.length === 0
  const pack = city.artifactPack

  return {
    indexId: index.indexId,
    cityId: city.cityId,
    fallbackId: null,
    coverageTier: city.coverageTier,
    artifactPackStatus: status,
    evaluatedAt,
    sourceHealth: pack.sourceHealth,
    canLoad,
    manifestUrl: canLoad ? pack.manifestUrl : null,
    manifestId: canLoad ? pack.manifestId : null,
    buildId: canLoad ? pack.buildId : null,
    shards: canLoad ? pack.shards.map(shard => ({ ...shard })) : [],
    warnings,
    refusalReasons,
  }
}
