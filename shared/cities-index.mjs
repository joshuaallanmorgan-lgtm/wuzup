import { createHash } from 'node:crypto'

const SCHEMA_VERSION = 1
const COVERAGE_TIERS = new Set(['flagship', 'metro', 'thin', 'not-covered'])
const SOURCE_HEALTH_VALUES = new Set(['healthy', 'degraded', 'failed', 'unknown'])
const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REQUIRED_US_REGIONS = ['contiguous-us', 'alaska', 'hawaii']
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

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

function requireOwnKeys(value, label, keys) {
  for (const key of keys) {
    invariant(hasOwn(value, key), `${label}.${key} must be an own property`)
  }
}

function requireOwnArrayEntries(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    invariant(hasOwn(value, index), `${label}[${index}] must be an own array entry`)
  }
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
    for (let index = 0; index < value.length; index += 1) {
      invariant(hasOwn(value, index), `${path} must not contain sparse arrays or inherited entries`)
    }
    return `[${value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`)).join(',')}]`
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
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false
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

function requireString(value, label) {
  invariant(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string`)
}

function validatePoint(point, label) {
  invariant(isPlainObject(point), `${label} must be a plain object`)
  requireOwnKeys(point, label, ['lat', 'lng'])
  invariant(Number.isFinite(point.lat), `${label}.lat must be a finite latitude`)
  invariant(Number.isFinite(point.lng), `${label}.lng must be a finite longitude`)
  invariant(point.lat >= -90 && point.lat <= 90, `${label}.lat must be between -90 and 90`)
  invariant(point.lng >= -180 && point.lng <= 180, `${label}.lng must be between -180 and 180`)
}

function validateBbox(bbox, label) {
  invariant(isPlainObject(bbox), `${label} must be a plain object`)
  requireOwnKeys(bbox, label, ['south', 'west', 'north', 'east'])
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

function validateArtifactPack(pack, label) {
  invariant(isPlainObject(pack), `${label} must be a plain object`)
  requireOwnKeys(pack, label, [
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
  invariant(SHA256_ID.test(String(pack.manifestId || '')), `${label}.manifestId must be a sha256 identity`)
  invariant(SHA256_ID.test(String(pack.buildId || '')), `${label}.buildId must be a sha256 identity`)
  invariant(validIsoTimestamp(pack.generatedAt), `${label}.generatedAt must be an ISO timestamp`)
  invariant(validIsoTimestamp(pack.expiresAt), `${label}.expiresAt must be an ISO timestamp`)
  invariant(Date.parse(pack.generatedAt) < Date.parse(pack.expiresAt), `${label}.generatedAt must be before expiresAt`)
  invariant(isPlainObject(pack.counts), `${label}.counts must be a plain object`)
  requireOwnKeys(pack.counts, `${label}.counts`, ['events', 'places', 'guides'])
  for (const key of ['events', 'places', 'guides']) {
    invariant(Number.isInteger(pack.counts[key]) && pack.counts[key] >= 0, `${label}.counts.${key} must be a non-negative integer`)
  }
  for (const [key, count] of Object.entries(pack.counts)) {
    invariant(Number.isInteger(count) && count >= 0, `${label}.counts.${key} must be a non-negative integer`)
  }
  invariant(
    SOURCE_HEALTH_VALUES.has(pack.sourceHealth),
    `${label}.sourceHealth must be healthy, degraded, failed, or unknown`,
  )
  invariant(Array.isArray(pack.shards) && pack.shards.length > 0, `${label}.shards must be a non-empty array`)
  requireOwnArrayEntries(pack.shards, `${label}.shards`)

  const shardKinds = new Set()
  const shardUrls = new Set()
  for (const [index, shard] of pack.shards.entries()) {
    const shardLabel = `${label}.shards[${index}]`
    invariant(isPlainObject(shard), `${shardLabel} must be a plain object`)
    requireOwnKeys(shard, shardLabel, ['kind', 'url', 'sha256', 'count'])
    invariant(typeof shard.kind === 'string' && KEBAB_ID.test(shard.kind), `${shardLabel}.kind must be lowercase kebab-case`)
    invariant(!shardKinds.has(shard.kind), `${label} has duplicate shard kind: ${shard.kind}`)
    shardKinds.add(shard.kind)
    invariant(hasOwn(pack.counts, shard.kind), `${shardLabel}.kind must have a declared count`)
    invariant(validRootRelativeUrl(shard.url), `${shardLabel}.url must be a root-relative URL`)
    invariant(!shardUrls.has(shard.url), `${label} has duplicate shard URL: ${shard.url}`)
    shardUrls.add(shard.url)
    invariant(SHA256_ID.test(String(shard.sha256 || '')), `${shardLabel}.sha256 must be a sha256 identity`)
    invariant(Number.isInteger(shard.count) && shard.count >= 0, `${shardLabel}.count must be a non-negative integer`)
    invariant(shard.count === pack.counts[shard.kind], `${shardLabel}.count must match counts.${shard.kind}`)
  }
  for (const kind of Object.keys(pack.counts)) {
    invariant(shardKinds.has(kind), `${label}.counts.${kind} must have exactly one shard`)
  }
}

function validateFallback(fallback, key, expected) {
  const label = `fallbacks.${key}`
  invariant(isPlainObject(fallback), `${label} must be a plain object`)
  requireOwnKeys(fallback, label, ['fallbackId', 'name', 'coverageTier', 'countryCode', 'artifactPack'])
  invariant(fallback.fallbackId === expected.fallbackId, `${label}.fallbackId must be ${expected.fallbackId}`)
  requireString(fallback.name, `${label}.name`)
  invariant(fallback.coverageTier === expected.coverageTier, `${label}.coverageTier must be ${expected.coverageTier}`)
  invariant(fallback.countryCode === expected.countryCode, `${label}.countryCode must be ${expected.countryLabel}`)
  invariant(fallback.artifactPack === null, `${label}.artifactPack must be null in the L0 synthetic index`)
}

/**
 * Return a content identity for a JSON-compatible cities index. Object keys are
 * sorted recursively, array order is preserved, and the root indexId is omitted.
 */
export function calculateCitiesIndexId(index) {
  invariant(isPlainObject(index), 'index must be a plain object with own fields')
  const payload = Object.fromEntries(Object.entries(index).filter(([key]) => key !== 'indexId'))
  const digest = createHash('sha256').update(canonicalJson(payload)).digest('hex')
  return `sha256:${digest}`
}

/** Validate the complete version-1 cities index and return the original object. */
export function validateCitiesIndex(index) {
  invariant(isPlainObject(index), 'index must be a plain object with own fields')
  requireOwnKeys(index, 'index', [
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
  invariant(SHA256_ID.test(String(index.indexId || '')), 'index.indexId must be a sha256 identity')
  invariant(typeof index.defaultCityId === 'string' && KEBAB_ID.test(index.defaultCityId), 'index.defaultCityId must be lowercase kebab-case')
  invariant(Array.isArray(index.cities) && index.cities.length > 0, 'index.cities must be a non-empty array')
  requireOwnArrayEntries(index.cities, 'index.cities')

  const cityIds = new Set()
  const locationTokens = new Set()
  for (const [position, city] of index.cities.entries()) {
    const label = `cities[${position}]`
    invariant(isPlainObject(city), `${label} must be a plain object`)
    requireOwnKeys(city, label, [
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
    invariant(typeof city.cityId === 'string' && KEBAB_ID.test(city.cityId), `${label}.cityId must be lowercase kebab-case`)
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
    invariant(Array.isArray(city.pathAliases), `${label}.pathAliases must be an array`)
    requireOwnArrayEntries(city.pathAliases, `${label}.pathAliases`)

    for (const token of [city.cityId, ...city.pathAliases]) {
      invariant(typeof token === 'string' && KEBAB_ID.test(token), `${label} city id and path aliases must be lowercase kebab-case`)
      invariant(!locationTokens.has(token), `duplicate city id or path alias: ${token}`)
      locationTokens.add(token)
    }
    validateArtifactPack(city.artifactPack, `${label}.artifactPack`)
  }
  invariant(cityIds.has(index.defaultCityId), 'index.defaultCityId must identify a city in index.cities')

  invariant(isPlainObject(index.fallbacks), 'index.fallbacks must be a plain object')
  requireOwnKeys(index.fallbacks, 'fallbacks', ['nationwideFloor', 'notCovered'])
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

  invariant(Array.isArray(index.usRegions) && index.usRegions.length > 0, 'index.usRegions must be a non-empty array')
  requireOwnArrayEntries(index.usRegions, 'index.usRegions')
  const regionIds = new Set()
  for (const [position, region] of index.usRegions.entries()) {
    const label = `usRegions[${position}]`
    invariant(isPlainObject(region), `${label} must be a plain object`)
    requireOwnKeys(region, label, ['regionId', 'bbox'])
    invariant(typeof region.regionId === 'string' && KEBAB_ID.test(region.regionId), `${label}.regionId must be lowercase kebab-case`)
    invariant(!regionIds.has(region.regionId), `duplicate US region id: ${region.regionId}`)
    regionIds.add(region.regionId)
    validateBbox(region.bbox, `${label}.bbox`)
  }
  invariant(
    REQUIRED_US_REGIONS.every(regionId => regionIds.has(regionId)),
    'index.usRegions must include contiguous-us, alaska, and hawaii',
  )

  invariant(calculateCitiesIndexId(index) === index.indexId, 'index.indexId does not match its canonical contents')
  return index
}

function parseNow(now) {
  const epoch = now instanceof Date ? now.getTime()
    : typeof now === 'number' ? now
      : typeof now === 'string' ? Date.parse(now)
        : Number.NaN
  invariant(Number.isFinite(epoch), 'now must be an injected valid Date, timestamp, or epoch milliseconds')
  return epoch
}

function queryCitySignal(query) {
  if (query === undefined || query === null) return { present: false, value: null }
  if (typeof query === 'string') {
    const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
    return params.has('city')
      ? { present: true, value: String(params.get('city') ?? '').trim().toLowerCase() }
      : { present: false, value: null }
  }
  if (query instanceof URLSearchParams) {
    return query.has('city')
      ? { present: true, value: String(query.get('city') ?? '').trim().toLowerCase() }
      : { present: false, value: null }
  }
  invariant(isRecord(query), 'query must be a string, URLSearchParams, or object')
  if (!hasOwn(query, 'city')) return { present: false, value: null }
  const raw = Array.isArray(query.city) ? query.city[0] : query.city
  return { present: true, value: String(raw ?? '').trim().toLowerCase() }
}

function pathCitySignal(pathname) {
  if (pathname === undefined || pathname === null || pathname === '') return { present: false, value: null }
  invariant(typeof pathname === 'string', 'pathname must be a string')
  const match = pathname.match(/^\/cities\/([^/?#]+)(?:[/?#]|$)/i)
  if (!match) return { present: false, value: null }
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

/** Resolve one request without reading global clocks, location, storage, or files. */
export function resolveLocation({ index, pathname = '', query = '', coords = null, now } = {}) {
  validateCitiesIndex(index)
  const nowMs = parseNow(now)
  const querySignal = queryCitySignal(query)
  if (querySignal.present) {
    const city = cityForToken(index, querySignal.value)
    return city
      ? cityResolution(index, city, 'explicit-query', nowMs, { requestedCity: querySignal.value })
      : fallbackResolution(index, index.fallbacks.notCovered, 'unknown-query-city', nowMs, { requestedCity: querySignal.value })
  }

  const pathSignal = pathCitySignal(pathname)
  if (pathSignal.present) {
    const city = cityForToken(index, pathSignal.value)
    return city
      ? cityResolution(index, city, 'explicit-path', nowMs, { requestedCity: pathSignal.value })
      : fallbackResolution(index, index.fallbacks.notCovered, 'unknown-path-city', nowMs, { requestedCity: pathSignal.value })
  }

  const point = normalizeCoords(coords)
  if (point) {
    const city = index.cities.find(entry => pointInBbox(point, entry.bbox))
    if (city) return cityResolution(index, city, 'coordinates-city', nowMs, { coordinates: point })
    const region = index.usRegions.find(entry => pointInBbox(point, entry.bbox))
    if (region) {
      return fallbackResolution(index, index.fallbacks.nationwideFloor, 'coordinates-nationwide-floor', nowMs, {
        coordinates: point,
        matchedRegionId: region.regionId,
      })
    }
    return fallbackResolution(index, index.fallbacks.notCovered, 'coordinates-not-covered', nowMs, { coordinates: point })
  }

  const defaultCity = index.cities.find(city => city.cityId === index.defaultCityId)
  return cityResolution(index, defaultCity, 'default-city', nowMs)
}

/**
 * Convert a resolution into a closed load plan. Refused plans contain no URLs;
 * allowed plans copy only URLs and identities that are present in the index.
 */
export function artifactLoadPlan(index, resolution, { now } = {}) {
  validateCitiesIndex(index)
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
