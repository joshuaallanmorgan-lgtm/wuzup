// Dark Sprint 13 City Foundry loader. This module deliberately owns no React,
// app store, or compile-time CITY state. One instance may open one location
// session at a time; opening a new session invalidates every late result from
// the previous one before any caller can treat those bytes as current.
import {
  artifactBuildIdentityPayload,
  artifactManifestIdentityPayload,
  inspectArtifactPayload,
  manifestShapeProblems,
  manifestTemporalProblems,
  stableStringify,
} from '../../shared/artifact-contract.mjs'
import {
  artifactLoadPlanFromValidatedIndex,
  canonicalCitiesIndexJson,
  resolveValidatedLocation,
  validateCitiesIndexShape,
} from '../../shared/cities-index-core.mjs'

const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const CITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const JSON_CONTENT_TYPES = new Set(['application/json', 'application/manifest+json'])
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const KIND_FILES = Object.freeze({
  events: 'events.json',
  places: 'places.json',
  guides: 'guides.json',
})

export const CITY_ARTIFACT_LOADER_LIMITS = Object.freeze({
  indexBytes: 1024 * 1024,
  manifestBytes: 512 * 1024,
  totalDeclaredShardBytes: 64 * 1024 * 1024,
  shardBytes: Object.freeze({
    events: 24 * 1024 * 1024,
    places: 32 * 1024 * 1024,
    guides: 4 * 1024 * 1024,
  }),
})

export class CityArtifactLoaderError extends Error {
  constructor(code, message = code, { retryable = false, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'CityArtifactLoaderError'
    this.code = code
    this.retryable = retryable
  }
}

function invariant(condition, code, message = code) {
  if (!condition) throw new CityArtifactLoaderError(code, message)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizedNow(now) {
  const value = now()
  invariant(Number.isSafeInteger(value) && value >= 0, 'CLOCK_INVALID', 'now() must return non-negative epoch milliseconds')
  return value
}

function normalizeProductRoot(value) {
  invariant(typeof value === 'string' && value.trim().length > 0, 'PRODUCT_ROOT_INVALID', 'productRoot is required')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new CityArtifactLoaderError('PRODUCT_ROOT_INVALID', 'productRoot must be an absolute HTTP(S) URL')
  }
  invariant(
    (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === '',
    'PRODUCT_ROOT_INVALID',
    'productRoot must be a credential-free HTTP(S) URL without query or hash',
  )
  invariant(!url.pathname.includes('\\'), 'PRODUCT_ROOT_INVALID', 'productRoot path is unsafe')
  let decoded
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    throw new CityArtifactLoaderError('PRODUCT_ROOT_INVALID', 'productRoot path is unsafe')
  }
  invariant(
    !decoded.split('/').some((segment) => segment === '.' || segment === '..'),
    'PRODUCT_ROOT_INVALID',
    'productRoot path is unsafe',
  )
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function normalizeLimits(value = {}) {
  invariant(isPlainObject(value), 'LIMITS_INVALID', 'limits must be a plain object')
  const defaults = CITY_ARTIFACT_LOADER_LIMITS
  const positive = (candidate, fallback, label) => {
    const result = candidate ?? fallback
    invariant(Number.isSafeInteger(result) && result > 0, 'LIMITS_INVALID', `${label} must be a positive safe integer`)
    return result
  }
  const requestedShards = value.shardBytes ?? {}
  invariant(isPlainObject(requestedShards), 'LIMITS_INVALID', 'limits.shardBytes must be a plain object')
  return Object.freeze({
    indexBytes: positive(value.indexBytes, defaults.indexBytes, 'limits.indexBytes'),
    manifestBytes: positive(value.manifestBytes, defaults.manifestBytes, 'limits.manifestBytes'),
    totalDeclaredShardBytes: positive(
      value.totalDeclaredShardBytes,
      defaults.totalDeclaredShardBytes,
      'limits.totalDeclaredShardBytes',
    ),
    shardBytes: Object.freeze(Object.fromEntries(Object.keys(KIND_FILES).map((kind) => [
      kind,
      positive(requestedShards[kind], defaults.shardBytes[kind], `limits.shardBytes.${kind}`),
    ]))),
  })
}

function exactResponseUrl(response, expected, label) {
  invariant(response && typeof response.status === 'number', `${label}_INVALID_RESPONSE`)
  invariant(response.status === 200 && response.ok !== false, `${label}_HTTP`, `${label} returned HTTP ${response.status}`)
  invariant(response.redirected !== true, `${label}_REDIRECTED`, `${label} redirected`)
  invariant(typeof response.url === 'string' && response.url === expected.href, `${label}_URL_MISMATCH`, `${label} response URL changed`)
  const contentType = String(response.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  invariant(JSON_CONTENT_TYPES.has(contentType), `${label}_CONTENT_TYPE_INVALID`, `${label} must be JSON`)
}

function forwardedAbort(parentSignal, controller) {
  if (!parentSignal) return () => {}
  const abort = () => controller.abort(parentSignal.reason)
  if (parentSignal.aborted) abort()
  else parentSignal.addEventListener('abort', abort, { once: true })
  return () => parentSignal.removeEventListener('abort', abort)
}

function concatChunks(chunks, total) {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function boundedResponseBytes(response, maximumBytes, label) {
  const encoding = String(response.headers?.get?.('content-encoding') || 'identity').trim().toLowerCase()
  const identityTransfer = encoding === '' || encoding === 'identity'
  const rawLength = response.headers?.get?.('content-length')
  const declaredLength = !identityTransfer || rawLength == null ? null : Number(rawLength)
  if (declaredLength != null) {
    invariant(
      Number.isSafeInteger(declaredLength) && declaredLength >= 0,
      `${label}_CONTENT_LENGTH_INVALID`,
    )
    invariant(declaredLength <= maximumBytes, `${label}_TOO_LARGE`)
  }

  let bytes
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
        total += chunk.byteLength
        if (total > maximumBytes) {
          await reader.cancel()
          throw new CityArtifactLoaderError(`${label}_TOO_LARGE`)
        }
        chunks.push(chunk)
      }
    } finally {
      reader.releaseLock?.()
    }
    bytes = concatChunks(chunks, total)
  } else {
    invariant(typeof response.arrayBuffer === 'function', `${label}_INVALID_RESPONSE`)
    bytes = new Uint8Array(await response.arrayBuffer())
    invariant(bytes.byteLength <= maximumBytes, `${label}_TOO_LARGE`)
  }
  if (declaredLength != null) {
    invariant(declaredLength === bytes.byteLength, `${label}_CONTENT_LENGTH_MISMATCH`)
  }
  return bytes
}

async function requestJsonBytes({
  fetchImpl,
  url,
  signal,
  timeoutMs,
  maximumBytes,
  label,
}) {
  const controller = new AbortController()
  const detachAbort = forwardedAbort(signal, controller)
  let timedOut = false
  let rejectCancellation
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject
  })
  const cancel = () => {
    if (timedOut) return
    rejectCancellation(new CityArtifactLoaderError(
      'SESSION_SUPERSEDED',
      'The city session was superseded',
    ))
  }
  controller.signal.addEventListener('abort', cancel, { once: true })
  if (controller.signal.aborted) cancel()

  let timer
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => {
      timedOut = true
      reject(new CityArtifactLoaderError(
        `${label}_TIMEOUT`,
        `${label} timed out`,
        { retryable: true },
      ))
      controller.abort()
    }, timeoutMs)
  })
  const operation = (async () => {
    const response = await fetchImpl(url.href, {
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    exactResponseUrl(response, url, label)
    return boundedResponseBytes(response, maximumBytes, label)
  })()
  try {
    return await Promise.race([operation, timeout, cancellation])
  } catch (error) {
    if (error instanceof CityArtifactLoaderError) throw error
    if (timedOut) throw new CityArtifactLoaderError(`${label}_TIMEOUT`, `${label} timed out`, { retryable: true, cause: error })
    if (signal?.aborted) throw new CityArtifactLoaderError('SESSION_SUPERSEDED', 'The city session was superseded', { cause: error })
    throw new CityArtifactLoaderError(`${label}_NETWORK`, `${label} could not be fetched`, { retryable: true, cause: error })
  } finally {
    globalThis.clearTimeout(timer)
    controller.signal.removeEventListener('abort', cancel)
    detachAbort()
  }
}

function decodeJson(bytes, label) {
  let source
  try {
    source = textDecoder.decode(bytes)
  } catch (error) {
    throw new CityArtifactLoaderError(`${label}_UTF8_INVALID`, `${label} is not valid UTF-8`, { cause: error })
  }
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new CityArtifactLoaderError(`${label}_JSON_INVALID`, `${label} is not valid JSON`, { cause: error })
  }
}

async function sha256Id(bytes, cryptoImpl) {
  invariant(typeof cryptoImpl?.subtle?.digest === 'function', 'CRYPTO_UNAVAILABLE', 'WebCrypto SHA-256 is required')
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes))
  return `sha256:${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function releaseBaseUrl(productRoot, cityId, manifestId) {
  invariant(CITY_ID.test(String(cityId || '')), 'CITY_ID_INVALID')
  invariant(SHA256_ID.test(String(manifestId || '')), 'MANIFEST_ID_INVALID')
  return new URL(`cities/${cityId}/releases/${manifestId.slice('sha256:'.length)}/`, productRoot)
}

function exactDerivedUrl(value, expected, label) {
  invariant(typeof value === 'string' && value.length > 0, `${label}_URL_INVALID`)
  let actual
  try {
    actual = new URL(value, expected)
  } catch {
    throw new CityArtifactLoaderError(`${label}_URL_INVALID`)
  }
  invariant(
    actual.origin === expected.origin && actual.href === expected.href,
    `${label}_URL_MISMATCH`,
    `${label} must use its exact immutable derived URL`,
  )
  return expected
}

function exactShardMap(plan, releaseBase, limits) {
  invariant(Array.isArray(plan.shards), 'SHARD_PLAN_INVALID')
  invariant(plan.shards.length === Object.keys(KIND_FILES).length, 'SHARD_PLAN_INVALID')
  const shards = new Map()
  let totalBytes = 0
  for (const shard of plan.shards) {
    invariant(isPlainObject(shard) && Object.hasOwn(KIND_FILES, shard.kind), 'SHARD_PLAN_INVALID')
    invariant(!shards.has(shard.kind), 'SHARD_PLAN_INVALID')
    invariant(SHA256_ID.test(String(shard.sha256 || '')), 'SHARD_PLAN_INVALID')
    invariant(Number.isSafeInteger(shard.bytes) && shard.bytes >= 0, 'SHARD_PLAN_INVALID')
    invariant(Number.isSafeInteger(shard.count) && shard.count >= 0, 'SHARD_PLAN_INVALID')
    invariant(shard.bytes <= limits.shardBytes[shard.kind], 'SHARD_DECLARED_TOO_LARGE')
    totalBytes += shard.bytes
    invariant(Number.isSafeInteger(totalBytes), 'SHARD_PLAN_INVALID')
    const url = new URL(KIND_FILES[shard.kind], releaseBase)
    exactDerivedUrl(shard.url, url, `SHARD_${shard.kind.toUpperCase()}`)
    shards.set(shard.kind, Object.freeze({ ...shard, url: url.href }))
  }
  invariant(totalBytes <= limits.totalDeclaredShardBytes, 'SHARD_PACK_DECLARED_TOO_LARGE')
  invariant(Object.keys(KIND_FILES).every((kind) => shards.has(kind)), 'SHARD_PLAN_INVALID')
  return shards
}

async function verifiedIndex({
  bytes,
  expectedIndexId,
  cryptoImpl,
}) {
  const parsed = decodeJson(bytes, 'INDEX')
  let index
  try {
    index = validateCitiesIndexShape(parsed)
  } catch (error) {
    throw new CityArtifactLoaderError('INDEX_SCHEMA_INVALID', String(error?.message || error), { cause: error })
  }
  let canonical
  try {
    canonical = canonicalCitiesIndexJson(index)
  } catch (error) {
    throw new CityArtifactLoaderError('INDEX_CANONICAL_INVALID', String(error?.message || error), { cause: error })
  }
  const calculated = await sha256Id(textEncoder.encode(canonical), cryptoImpl)
  invariant(index.indexId === calculated, 'INDEX_ID_INVALID', 'indexId does not match canonical contents')
  invariant(calculated === expectedIndexId, 'INDEX_UNAPPROVED', 'cities index does not match the pinned index identity')
  return index
}

async function verifiedManifest({
  bytes,
  plan,
  resolution,
  pack,
  cryptoImpl,
  nowMs,
}) {
  const manifest = decodeJson(bytes, 'MANIFEST')
  const problems = [
    ...manifestShapeProblems(manifest, resolution.cityId, resolution.timeZone),
    ...manifestTemporalProblems(manifest, nowMs),
  ]
  if (problems.length) {
    throw new CityArtifactLoaderError('MANIFEST_SCHEMA_INVALID', problems.join(' · '))
  }
  invariant(Array.isArray(manifest.shards) && manifest.shards.length === 0, 'MANIFEST_SHARDS_UNSUPPORTED')
  invariant(
    Object.keys(manifest.artifacts || {}).length === Object.keys(KIND_FILES).length
      && Object.keys(KIND_FILES).every((kind) => Object.hasOwn(manifest.artifacts, kind)),
    'MANIFEST_ARTIFACT_SET_INVALID',
  )
  const buildId = await sha256Id(
    textEncoder.encode(stableStringify(artifactBuildIdentityPayload(manifest))),
    cryptoImpl,
  )
  const manifestId = await sha256Id(
    textEncoder.encode(stableStringify(artifactManifestIdentityPayload(manifest))),
    cryptoImpl,
  )
  invariant(buildId === manifest.buildId && buildId === plan.buildId, 'MANIFEST_BUILD_ID_MISMATCH')
  invariant(manifestId === manifest.manifestId && manifestId === plan.manifestId, 'MANIFEST_ID_MISMATCH')
  invariant(pack.generatedAt === manifest.generatedAt, 'MANIFEST_GENERATED_AT_MISMATCH')
  invariant(pack.expiresAt === manifest.expiresAt, 'MANIFEST_EXPIRES_AT_MISMATCH')
  invariant(pack.sourceHealth === manifest.sourceHealth?.status, 'MANIFEST_SOURCE_HEALTH_MISMATCH')

  const planShards = new Map(plan.shards.map((shard) => [shard.kind, shard]))
  for (const [kind, file] of Object.entries(KIND_FILES)) {
    const shard = planShards.get(kind)
    const entry = manifest.artifacts[kind]
    invariant(entry.file === file, 'MANIFEST_SHARD_BINDING_MISMATCH')
    invariant(`sha256:${entry.sha256}` === shard.sha256, 'MANIFEST_SHARD_BINDING_MISMATCH')
    invariant(entry.bytes === shard.bytes, 'MANIFEST_SHARD_BINDING_MISMATCH')
    invariant(entry.count === shard.count, 'MANIFEST_SHARD_BINDING_MISMATCH')
    invariant(pack.counts?.[kind] === shard.count, 'MANIFEST_SHARD_BINDING_MISMATCH')
  }
  return manifest
}

function refusalError(plan) {
  const code = Array.isArray(plan?.refusalReasons) && plan.refusalReasons[0]
    ? plan.refusalReasons[0]
    : 'ARTIFACT_PACK_REFUSED'
  return new CityArtifactLoaderError(code, `City artifact plan refused: ${code}`)
}

export function createCityArtifactLoader({
  productRoot,
  expectedIndexId,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
  timeoutMs = 10_000,
  limits: requestedLimits = {},
} = {}) {
  invariant(SHA256_ID.test(String(expectedIndexId || '')), 'EXPECTED_INDEX_ID_REQUIRED')
  invariant(typeof fetchImpl === 'function', 'FETCH_REQUIRED')
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'TIMEOUT_INVALID')
  const root = normalizeProductRoot(productRoot)
  const indexUrl = new URL('cities/index.json', root)
  const limits = normalizeLimits(requestedLimits)
  let indexPromise = null
  let activeController = null
  let epoch = 0
  let disposed = false

  function current(token, signal) {
    invariant(!disposed, 'LOADER_DISPOSED')
    invariant(token === epoch && !signal.aborted, 'SESSION_SUPERSEDED')
  }

  function loadIndex() {
    invariant(!disposed, 'LOADER_DISPOSED')
    if (indexPromise) return indexPromise
    const request = requestJsonBytes({
      fetchImpl,
      url: indexUrl,
      timeoutMs,
      maximumBytes: limits.indexBytes,
      label: 'INDEX',
    })
      .then((bytes) => verifiedIndex({ bytes, expectedIndexId, cryptoImpl }))
      .catch((error) => {
        if (indexPromise === request) indexPromise = null
        throw error
      })
    indexPromise = request
    return request
  }

  async function openLocation({ pathname = '', query = '', coords = null } = {}) {
    invariant(!disposed, 'LOADER_DISPOSED')
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const token = ++epoch
    const index = await loadIndex()
    current(token, controller.signal)
    const nowMs = normalizedNow(now)
    let resolution
    let plan
    try {
      resolution = resolveValidatedLocation({ index, pathname, query, coords, now: nowMs })
      plan = artifactLoadPlanFromValidatedIndex(index, resolution, { now: nowMs })
    } catch (error) {
      throw error instanceof CityArtifactLoaderError
        ? error
        : new CityArtifactLoaderError('LOCATION_PLAN_INVALID', String(error?.message || error), { cause: error })
    }
    current(token, controller.signal)
    if (!plan.canLoad) {
      const error = refusalError(plan)
      controller.abort(error)
      throw error
    }
    invariant(plan.indexId === index.indexId && plan.cityId === resolution.cityId, 'LOCATION_PLAN_IDENTITY_MISMATCH')
    invariant(plan.manifestId && plan.buildId, 'LOCATION_PLAN_IDENTITY_MISMATCH')
    const pack = index.cities.find((city) => city.cityId === resolution.cityId)?.artifactPack
    invariant(pack, 'LOCATION_PLAN_IDENTITY_MISMATCH')
    const packBase = releaseBaseUrl(root, resolution.cityId, plan.manifestId)
    const manifestUrl = new URL('artifact-manifest.json', packBase)
    exactDerivedUrl(plan.manifestUrl, manifestUrl, 'MANIFEST')
    const shards = exactShardMap(plan, packBase, limits)

    const manifestBytes = await requestJsonBytes({
      fetchImpl,
      url: manifestUrl,
      signal: controller.signal,
      timeoutMs,
      maximumBytes: limits.manifestBytes,
      label: 'MANIFEST',
    })
    current(token, controller.signal)
    const manifest = await verifiedManifest({
      bytes: manifestBytes,
      plan: { ...plan, shards: [...shards.values()] },
      resolution,
      pack,
      cryptoImpl,
      nowMs,
    })
    current(token, controller.signal)
    let terminalRefusal = null

    function currentSession() {
      if (terminalRefusal && !disposed) throw terminalRefusal
      current(token, controller.signal)
    }

    function requireFreshPack() {
      currentSession()
      let freshPlan
      try {
        freshPlan = artifactLoadPlanFromValidatedIndex(index, resolution, {
          now: normalizedNow(now),
        })
      } catch (error) {
        throw error instanceof CityArtifactLoaderError
          ? error
          : new CityArtifactLoaderError('LOCATION_PLAN_INVALID', String(error?.message || error), { cause: error })
      }
      if (!freshPlan.canLoad) {
        terminalRefusal = refusalError(freshPlan)
        controller.abort(terminalRefusal)
        throw terminalRefusal
      }
    }

    requireFreshPack()
    const inflight = new Map()
    const loaded = new Map()

    async function load(kind) {
      currentSession()
      invariant(Object.hasOwn(KIND_FILES, kind), 'SHARD_KIND_UNSUPPORTED')
      requireFreshPack()
      if (loaded.has(kind)) {
        const cached = loaded.get(kind)
        requireFreshPack()
        return cached
      }
      if (inflight.has(kind)) return inflight.get(kind)
      const shard = shards.get(kind)
      const operation = requestJsonBytes({
        fetchImpl,
        url: new URL(KIND_FILES[kind], packBase),
        signal: controller.signal,
        timeoutMs,
        maximumBytes: shard.bytes,
        label: `SHARD_${kind.toUpperCase()}`,
      })
        .then(async (bytes) => {
          currentSession()
          invariant(bytes.byteLength === shard.bytes, 'SHARD_BYTE_COUNT_MISMATCH')
          invariant(await sha256Id(bytes, cryptoImpl) === shard.sha256, 'SHARD_DIGEST_MISMATCH')
          const parsed = decodeJson(bytes, `SHARD_${kind.toUpperCase()}`)
          const inspected = inspectArtifactPayload(kind, parsed, shard.count)
          invariant(inspected.problems.length === 0, 'SHARD_SCHEMA_INVALID', inspected.problems.join(' · '))
          requireFreshPack()
          const result = Object.freeze({
            kind,
            cityId: resolution.cityId,
            timeZone: resolution.timeZone,
            indexId: index.indexId,
            manifestId: manifest.manifestId,
            buildId: manifest.buildId,
            sha256: shard.sha256,
            bytes: shard.bytes,
            count: shard.count,
            data: parsed,
          })
          loaded.set(kind, result)
          return result
        })
        .catch((error) => {
          if (terminalRefusal) throw terminalRefusal
          throw error
        })
        .finally(() => {
          if (inflight.get(kind) === operation) inflight.delete(kind)
        })
      inflight.set(kind, operation)
      return operation
    }

    return Object.freeze({
      indexId: index.indexId,
      cityId: resolution.cityId,
      timeZone: resolution.timeZone,
      coverageTier: resolution.coverageTier,
      manifestId: manifest.manifestId,
      buildId: manifest.buildId,
      productRoot: root.href,
      releaseBaseUrl: packBase.href,
      manifestUrl: manifestUrl.href,
      warnings: Object.freeze([...(plan.warnings || [])]),
      load,
      close() {
        if (token === epoch) controller.abort()
      },
    })
  }

  return Object.freeze({
    productRoot: root.href,
    indexUrl: indexUrl.href,
    expectedIndexId,
    openLocation,
    dispose() {
      if (disposed) return
      disposed = true
      epoch += 1
      activeController?.abort()
      activeController = null
      indexPromise = null
    },
  })
}
