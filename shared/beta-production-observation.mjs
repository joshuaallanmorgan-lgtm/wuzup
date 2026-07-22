import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import {
  calculateBuildId,
  calculateManifestId,
  verifyArtifactSet,
} from '../finder/artifact-manifest.mjs'
import {
  ARTIFACT_SPECS,
  inspectArtifactPayload,
  manifestShapeProblems,
  manifestTemporalProblems,
} from './artifact-contract.mjs'
import {
  prepareS11BetaReleaseKit,
  S11_CHECKED_ARTIFACT_ROOTS,
} from './beta-release-kit.mjs'
import { S11_BETA_CITY_IDS } from './beta-research.mjs'

export const S11_PRODUCTION_OBSERVATION_SCHEMA = 'wuzup-beta-production-observation'
export const S11_PRODUCTION_OBSERVATION_SCHEMA_VERSION = 1
export const S11_PRODUCTION_ROOT_URL = 'https://joshuaallanmorgan-lgtm.github.io/wuzup/'

const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const SAFE_IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/
const CITY_CONTRACTS = Object.freeze({
  'sf-east-bay': Object.freeze({ path: 'sf/', timeZone: 'America/Los_Angeles' }),
  'tampa-bay': Object.freeze({ path: '', timeZone: 'America/New_York' }),
})
const LIMITS = Object.freeze({
  manifestBytes: 512 * 1024,
  artifactBytes: 24 * 1024 * 1024,
  htmlBytes: 1024 * 1024,
  javascriptFileBytes: 4 * 1024 * 1024,
  javascriptTotalBytes: 24 * 1024 * 1024,
  javascriptFiles: 256,
  imageFileBytes: 16 * 1024 * 1024,
  imageTotalBytes: 192 * 1024 * 1024,
  imageFiles: 2000,
})
const JSON_TYPES = new Set(['application/json', 'application/manifest+json'])
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml'])
const JAVASCRIPT_TYPES = new Set([
  'application/javascript',
  'application/x-javascript',
  'text/javascript',
])

class ObservationError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'ObservationError'
    this.code = code
  }
}

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected, label) {
  invariant(plainObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  invariant(
    actual.length === canonical.length && actual.every((key, index) => key === canonical[index]),
    `${label} must contain exactly: ${canonical.join(', ')}`,
  )
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeNowMs(value) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    'S11 production observation requires an explicit nowMs',
  )
  return value
}

function normalizeProductRootUrl(value) {
  invariant(typeof value === 'string' && value.trim().length > 0, 'productRootUrl must be a non-empty URL')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('productRootUrl must be an absolute HTTPS URL')
  }
  invariant(
    url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === '',
    'productRootUrl must be a credential-free HTTPS URL without query or hash',
  )
  invariant(!url.pathname.includes('\\'), 'productRootUrl path is unsafe')
  let decoded
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    throw new TypeError('productRootUrl path is unsafe')
  }
  invariant(
    !decoded.split('/').some((segment) => segment === '.' || segment === '..'),
    'productRootUrl path is unsafe',
  )
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  invariant(
    url.href === S11_PRODUCTION_ROOT_URL,
    `productRootUrl must be the canonical Wuzup production root '${S11_PRODUCTION_ROOT_URL}'`,
  )
  return url
}

function normalizePositiveInteger(value, fallback, label, maximum) {
  const candidate = value ?? fallback
  invariant(
    Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= maximum,
    `${label} is out of range`,
  )
  return candidate
}

function normalizeNonNegativeInteger(value, fallback, label, maximum) {
  const candidate = value ?? fallback
  invariant(
    Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= maximum,
    `${label} is out of range`,
  )
  return candidate
}

function normalizeReleaseBindings(value, label, { optional = false } = {}) {
  if (optional && (value === null || value === undefined)) return null
  exactKeys(value, S11_BETA_CITY_IDS, label)
  const normalized = {}
  for (const cityId of S11_BETA_CITY_IDS) {
    exactKeys(value[cityId], ['manifestId', 'buildId'], `${label}.${cityId}`)
    for (const field of ['manifestId', 'buildId']) {
      invariant(
        typeof value[cityId][field] === 'string' && SHA256_ID.test(value[cityId][field]),
        `${label}.${cityId}.${field} is invalid`,
      )
    }
    normalized[cityId] = {
      manifestId: value[cityId].manifestId,
      buildId: value[cityId].buildId,
    }
  }
  return normalized
}

function mediaType(headers) {
  return String(headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase()
}

function allowedContentType(headers, expected) {
  const type = mediaType(headers)
  if (expected === 'json') return JSON_TYPES.has(type)
  if (expected === 'html') return HTML_TYPES.has(type)
  if (expected === 'javascript') return JAVASCRIPT_TYPES.has(type)
  if (expected === 'image') return type.startsWith('image/')
  return false
}

async function boundedResponseBytes(response, maximumBytes) {
  // Fetch exposes decoded entity bytes while Content-Length describes the
  // encoded transfer if an intermediary ignores `Accept-Encoding: identity`.
  // Compare lengths only for identity transfers; the streamed decoded-byte
  // limit remains authoritative for every encoding.
  const contentEncoding = String(response.headers?.get?.('content-encoding') || 'identity').toLowerCase()
  const identityTransfer = contentEncoding === '' || contentEncoding === 'identity'
  const rawDeclared = response.headers?.get?.('content-length')
  const declared = !identityTransfer || rawDeclared == null ? null : Number(rawDeclared)
  if (declared != null && (!Number.isSafeInteger(declared) || declared < 0)) {
    throw new ObservationError('CONTENT_LENGTH_INVALID')
  }
  if (declared != null && declared > maximumBytes) {
    throw new ObservationError('RESPONSE_TOO_LARGE')
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        total += chunk.length
        if (total > maximumBytes) {
          await reader.cancel()
          throw new ObservationError('RESPONSE_TOO_LARGE')
        }
        chunks.push(chunk)
      }
    } finally {
      reader.releaseLock?.()
    }
    const bytes = Buffer.concat(chunks, total)
    if (declared != null && declared !== bytes.length) {
      throw new ObservationError('CONTENT_LENGTH_MISMATCH')
    }
    return bytes
  }
  invariant(typeof response.arrayBuffer === 'function', 'fetchImpl must return a Response-compatible object')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maximumBytes) throw new ObservationError('RESPONSE_TOO_LARGE')
  if (declared != null && declared !== bytes.length) {
    throw new ObservationError('CONTENT_LENGTH_MISMATCH')
  }
  return bytes
}

async function fetchBytes(url, {
  fetchImpl,
  timeoutMs,
  maximumBytes,
  expectedType,
  label,
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url.href, {
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        accept: expectedType === 'json'
          ? 'application/json'
          : expectedType === 'html'
            ? 'text/html'
            : expectedType === 'javascript'
              ? 'application/javascript, text/javascript'
              : 'image/avif, image/webp, image/png, image/jpeg',
        'accept-encoding': 'identity',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
      method: 'GET',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!response || typeof response.status !== 'number') {
      throw new ObservationError(`${label}_INVALID_RESPONSE`)
    }
    if (response.status !== 200) throw new ObservationError(`${label}_HTTP_${response.status}`)
    if (response.url !== url.href) throw new ObservationError(`${label}_REDIRECTED`)
    if (!allowedContentType(response.headers, expectedType)) {
      throw new ObservationError(`${label}_CONTENT_TYPE_INVALID`)
    }
    return await boundedResponseBytes(response, maximumBytes)
  } catch (error) {
    if (error instanceof ObservationError) throw error
    throw new ObservationError(`${label}_FETCH_FAILED`)
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ObservationError(`${label}_JSON_INVALID`)
  }
}

function validateManifest(manifest, bytes, { cityId, timeZone, nowMs }) {
  const problems = [
    ...manifestShapeProblems(manifest, cityId, timeZone),
    ...manifestTemporalProblems(manifest, nowMs),
  ]
  if (problems.length > 0) throw new ObservationError('MANIFEST_CONTRACT_INVALID')
  if (manifest.shards.length > 0) throw new ObservationError('MANIFEST_SHARDS_UNSUPPORTED')
  if (calculateBuildId(manifest) !== manifest.buildId) {
    throw new ObservationError('MANIFEST_BUILD_ID_INVALID')
  }
  if (calculateManifestId(manifest) !== manifest.manifestId) {
    throw new ObservationError('MANIFEST_ID_INVALID')
  }
  return {
    bytes,
    manifest,
    release: { manifestId: manifest.manifestId, buildId: manifest.buildId },
  }
}

function exactMemberUrl(baseUrl, relativePath, label) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.startsWith('/')
    || relativePath.includes('\\')
    || relativePath.includes('?')
    || relativePath.includes('#')
  ) {
    throw new ObservationError(`${label}_PATH_INVALID`)
  }
  let decoded
  try {
    decoded = decodeURIComponent(relativePath)
  } catch {
    throw new ObservationError(`${label}_PATH_INVALID`)
  }
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ObservationError(`${label}_PATH_INVALID`)
  }
  const url = new URL(relativePath, baseUrl)
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) {
    throw new ObservationError(`${label}_PATH_ESCAPES_CITY`)
  }
  return url
}

async function observeArtifacts({ baseUrl, manifest, fetchImpl, timeoutMs }) {
  let places = null
  let artifactBytes = 0
  for (const [kind, spec] of Object.entries(ARTIFACT_SPECS)) {
    const entry = manifest.artifacts[kind]
    if (entry.bytes > LIMITS.artifactBytes) throw new ObservationError(`${kind.toUpperCase()}_DECLARED_TOO_LARGE`)
    const bytes = await fetchBytes(exactMemberUrl(baseUrl, spec.file, kind.toUpperCase()), {
      fetchImpl,
      timeoutMs,
      maximumBytes: Math.min(LIMITS.artifactBytes, entry.bytes + 1),
      expectedType: 'json',
      label: kind.toUpperCase(),
    })
    if (bytes.length !== entry.bytes) throw new ObservationError(`${kind.toUpperCase()}_BYTE_COUNT_MISMATCH`)
    if (sha256(bytes) !== entry.sha256) throw new ObservationError(`${kind.toUpperCase()}_DIGEST_MISMATCH`)
    const parsed = parseJson(bytes, kind.toUpperCase())
    const inspected = inspectArtifactPayload(kind, parsed, entry.count)
    if (inspected.problems.length > 0) throw new ObservationError(`${kind.toUpperCase()}_SCHEMA_INVALID`)
    if (kind === 'places') places = inspected.rows
    artifactBytes += bytes.length
  }
  return { places, artifactBytes }
}

function localImageNames(places) {
  const names = new Set()
  for (const place of places || []) {
    const image = place?.image
    if (typeof image !== 'string' || !image.startsWith('/place-img/')) continue
    const name = image.slice('/place-img/'.length)
    if (!SAFE_IMAGE_NAME.test(name) || name.includes('..')) {
      throw new ObservationError('PLACE_IMAGE_REFERENCE_INVALID')
    }
    names.add(name)
  }
  return [...names].sort()
}

async function observePlaceImages({ baseUrl, manifest, places, fetchImpl, timeoutMs }) {
  const names = localImageNames(places)
  const expected = manifest.placeImages
  if (names.length !== expected.count) throw new ObservationError('PLACE_IMAGE_COUNT_MISMATCH')
  if (names.length > LIMITS.imageFiles || expected.bytes > LIMITS.imageTotalBytes) {
    throw new ObservationError('PLACE_IMAGE_TREE_TOO_LARGE')
  }
  const digestRows = []
  let totalBytes = 0
  for (const name of names) {
    const bytes = await fetchBytes(exactMemberUrl(baseUrl, `place-img/${name}`, 'PLACE_IMAGE'), {
      fetchImpl,
      timeoutMs,
      maximumBytes: Math.min(LIMITS.imageFileBytes, expected.bytes + 1),
      expectedType: 'image',
      label: 'PLACE_IMAGE',
    })
    totalBytes += bytes.length
    if (totalBytes > LIMITS.imageTotalBytes) throw new ObservationError('PLACE_IMAGE_TREE_TOO_LARGE')
    digestRows.push(`${name}\0${bytes.length}\0${sha256(bytes)}`)
  }
  if (totalBytes !== expected.bytes) throw new ObservationError('PLACE_IMAGE_BYTE_COUNT_MISMATCH')
  if (sha256(Buffer.from(digestRows.join('\n'))) !== expected.sha256) {
    throw new ObservationError('PLACE_IMAGE_DIGEST_MISMATCH')
  }
  return { imageCount: names.length, imageBytes: totalBytes }
}

function text(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ObservationError(`${label}_UTF8_INVALID`)
  }
}

export function inspectS11LoadedJavascript(records, manifestId) {
  invariant(Array.isArray(records), 'loaded JavaScript records must be an array')
  invariant(typeof manifestId === 'string' && SHA256_ID.test(manifestId), 'manifestId is invalid')
  if (records.length === 0) throw new ObservationError('APP_SCRIPT_MISSING')
  if (records.length > LIMITS.javascriptFiles) throw new ObservationError('APP_SCRIPT_GRAPH_TOO_LARGE')
  let javascriptBytes = 0
  let manifestPinned = false
  for (const record of records) {
    if (!plainObject(record) || !Buffer.isBuffer(record.bytes)) {
      throw new ObservationError('APP_SCRIPT_EVIDENCE_INVALID')
    }
    if (record.redirected === true) throw new ObservationError('APP_SCRIPT_REDIRECTED')
    if (record.status !== 200) throw new ObservationError(`APP_SCRIPT_HTTP_${record.status}`)
    const contentType = String(record.contentType || '').split(';', 1)[0].trim().toLowerCase()
    if (!JAVASCRIPT_TYPES.has(contentType)) throw new ObservationError('APP_SCRIPT_CONTENT_TYPE_INVALID')
    if (record.bytes.length > LIMITS.javascriptFileBytes) {
      throw new ObservationError('APP_SCRIPT_GRAPH_TOO_LARGE')
    }
    javascriptBytes += record.bytes.length
    if (javascriptBytes > LIMITS.javascriptTotalBytes) {
      throw new ObservationError('APP_SCRIPT_GRAPH_TOO_LARGE')
    }
    if (text(record.bytes, 'APP_SCRIPT').includes(manifestId)) manifestPinned = true
  }
  return {
    javascriptFiles: records.length,
    javascriptBytes,
    manifestPinned,
  }
}

async function playwrightBrowserProbe({ cityId, baseUrl, timeZone, expectedRelease, timeoutMs }) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.origin === baseUrl.origin) await route.continue()
      else await route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    const assetRoot = `${baseUrl.pathname}assets/`.replaceAll('//', '/')
    const scriptUrls = new Set()
    const scriptRecords = []
    page.on('response', (response) => {
      const request = response.request()
      if (request.resourceType() !== 'script') return
      let responseUrl
      try {
        responseUrl = new URL(response.url())
      } catch {
        return
      }
      if (
        responseUrl.origin !== baseUrl.origin
        || !responseUrl.pathname.startsWith(assetRoot)
        || !responseUrl.pathname.endsWith('.js')
        || responseUrl.search
        || responseUrl.hash
        || scriptUrls.has(responseUrl.href)
      ) return
      scriptUrls.add(responseUrl.href)
      scriptRecords.push((async () => {
        try {
          return {
            bytes: Buffer.from(await response.body()),
            contentType: response.headers()['content-type'] || '',
            redirected: request.redirectedFrom() !== null,
            status: response.status(),
          }
        } catch {
          return { problem: 'APP_SCRIPT_BODY_FAILED' }
        }
      })())
    })
    const response = await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    if (!response || response.status() !== 200 || page.url() !== baseUrl.href) {
      throw new Error('participant page did not load at its exact canonical URL')
    }
    const app = page.locator('.app[data-city-runtime-status="ready"][data-manifest-id][data-build-id]')
    await app.waitFor({ state: 'attached', timeout: timeoutMs })
    const observed = await app.evaluate((element) => ({
      cityId: element.dataset.cityId,
      timeZone: element.dataset.cityTimeZone,
      runtimeStatus: element.dataset.cityRuntimeStatus,
      manifestId: element.dataset.manifestId,
      buildId: element.dataset.buildId,
    }))
    const loadedRecords = await Promise.all(scriptRecords)
    if (loadedRecords.some((record) => record.problem)) {
      throw new Error('participant JavaScript response could not be read')
    }
    const loadedJavascript = inspectS11LoadedJavascript(loadedRecords, expectedRelease.manifestId)
    return {
      ...observed,
      ...loadedJavascript,
      baseUrl: baseUrl.href,
      expectedRelease,
      expectedCityId: cityId,
      expectedTimeZone: timeZone,
    }
  } finally {
    await browser.close()
  }
}

async function observeRuntimeIdentity({
  cityId,
  baseUrl,
  timeZone,
  expectedRelease,
  timeoutMs,
  browserProbe,
}) {
  let observed
  try {
    observed = await browserProbe({ cityId, baseUrl, timeZone, expectedRelease, timeoutMs })
  } catch (error) {
    if (error instanceof ObservationError) throw error
    throw new ObservationError('APP_RUNTIME_PROBE_FAILED')
  }
  if (!plainObject(observed)) throw new ObservationError('APP_RUNTIME_IDENTITY_MISMATCH')
  if (observed.manifestPinned !== true) throw new ObservationError('APP_MANIFEST_PIN_MISSING')
  if (
    observed.cityId !== cityId
    || observed.timeZone !== timeZone
    || observed.runtimeStatus !== 'ready'
    || observed.manifestId !== expectedRelease.manifestId
    || observed.buildId !== expectedRelease.buildId
  ) throw new ObservationError('APP_RUNTIME_IDENTITY_MISMATCH')
  if (
    !Number.isSafeInteger(observed.javascriptFiles)
    || observed.javascriptFiles < 1
    || observed.javascriptFiles > LIMITS.javascriptFiles
    || !Number.isSafeInteger(observed.javascriptBytes)
    || observed.javascriptBytes < 1
    || observed.javascriptBytes > LIMITS.javascriptTotalBytes
  ) throw new ObservationError('APP_SCRIPT_EVIDENCE_INVALID')
  return {
    runtimeIdentity: 'verified',
    javascriptFiles: observed.javascriptFiles,
    javascriptBytes: observed.javascriptBytes,
  }
}

async function observeAppShell({ baseUrl, fetchImpl, timeoutMs }) {
  const htmlBytes = await fetchBytes(baseUrl, {
    fetchImpl,
    timeoutMs,
    maximumBytes: LIMITS.htmlBytes,
    expectedType: 'html',
    label: 'APP_HTML',
  })
  const html = text(htmlBytes, 'APP_HTML')
  if (/\bdata-(?:city-runtime-status|manifest-id|build-id)\s*=/i.test(html)) {
    throw new ObservationError('APP_RUNTIME_MARKER_PREPOPULATED')
  }
  return { htmlBytes: htmlBytes.length }
}

async function observeCityOnce({
  cityId,
  baseUrl,
  timeZone,
  nowMs,
  expectedRelease,
  fetchImpl,
  timeoutMs,
  browserProbe,
}) {
  const manifestUrl = exactMemberUrl(baseUrl, 'artifact-manifest.json', 'MANIFEST')
  const firstBytes = await fetchBytes(manifestUrl, {
    fetchImpl,
    timeoutMs,
    maximumBytes: LIMITS.manifestBytes,
    expectedType: 'json',
    label: 'MANIFEST',
  })
  const first = validateManifest(parseJson(firstBytes, 'MANIFEST'), firstBytes, {
    cityId,
    timeZone,
    nowMs,
  })
  if (
    expectedRelease
    && (
      first.release.manifestId !== expectedRelease.manifestId
      || first.release.buildId !== expectedRelease.buildId
    )
  ) throw new ObservationError('EXPECTED_RELEASE_MISMATCH')

  const artifacts = await observeArtifacts({
    baseUrl,
    manifest: first.manifest,
    fetchImpl,
    timeoutMs,
  })
  const images = await observePlaceImages({
    baseUrl,
    manifest: first.manifest,
    places: artifacts.places,
    fetchImpl,
    timeoutMs,
  })
  const shell = await observeAppShell({
    baseUrl,
    fetchImpl,
    timeoutMs,
  })
  const runtime = await observeRuntimeIdentity({
    cityId,
    baseUrl,
    timeZone,
    expectedRelease: first.release,
    timeoutMs,
    browserProbe,
  })

  const finalBytes = await fetchBytes(manifestUrl, {
    fetchImpl,
    timeoutMs,
    maximumBytes: LIMITS.manifestBytes,
    expectedType: 'json',
    label: 'MANIFEST',
  })
  if (!firstBytes.equals(finalBytes)) throw new ObservationError('MANIFEST_CHANGED_DURING_OBSERVATION')
  validateManifest(parseJson(finalBytes, 'MANIFEST'), finalBytes, { cityId, timeZone, nowMs })

  return {
    cityId,
    baseUrl: baseUrl.href,
    status: 'observed',
    release: first.release,
    attemptsUsed: 1,
    evidence: {
      artifactBytes: artifacts.artifactBytes,
      placeImageCount: images.imageCount,
      placeImageBytes: images.imageBytes,
      htmlBytes: shell.htmlBytes,
      javascriptFiles: runtime.javascriptFiles,
      javascriptBytes: runtime.javascriptBytes,
      runtimeIdentity: runtime.runtimeIdentity,
    },
    problems: [],
  }
}

async function observeCity(options) {
  let lastError = new ObservationError('OBSERVATION_NOT_ATTEMPTED')
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const result = await observeCityOnce(options)
      return { ...result, attemptsUsed: attempt }
    } catch (error) {
      lastError = error instanceof ObservationError
        ? error
        : new ObservationError('OBSERVATION_INTERNAL_ERROR')
      if (attempt < options.attempts && options.retryDelayMs > 0) {
        await options.delay(options.retryDelayMs)
      }
    }
  }
  return {
    cityId: options.cityId,
    baseUrl: options.baseUrl.href,
    status: 'blocked',
    release: null,
    attemptsUsed: options.attempts,
    evidence: null,
    problems: [lastError.code],
  }
}

/**
 * Observe the exact participant-facing GitHub Pages bytes for both Sprint 11
 * cities. This verifies deployment identity only. It neither evaluates beta
 * outcomes nor treats workflow, cache, or HTTP-date metadata as freshness.
 */
export async function observeS11ParticipantRelease({
  nowMs,
  productRootUrl = S11_PRODUCTION_ROOT_URL,
  expectedReleases = null,
  fetchImpl = globalThis.fetch,
  browserProbe = playwrightBrowserProbe,
  timeoutMs = 15_000,
  attempts = 2,
  retryDelayMs = 0,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const evaluatedMs = normalizeNowMs(nowMs)
  const root = normalizeProductRootUrl(productRootUrl)
  const expected = normalizeReleaseBindings(expectedReleases, 'expectedReleases', { optional: true })
  invariant(typeof fetchImpl === 'function', 'fetchImpl must be a function')
  invariant(typeof browserProbe === 'function', 'browserProbe must be a function')
  invariant(typeof delay === 'function', 'delay must be a function')
  const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, 15_000, 'timeoutMs', 120_000)
  const normalizedAttempts = normalizePositiveInteger(attempts, 2, 'attempts', 10)
  const normalizedRetryDelayMs = normalizeNonNegativeInteger(
    retryDelayMs,
    0,
    'retryDelayMs',
    60_000,
  )

  const cities = []
  for (const cityId of S11_BETA_CITY_IDS) {
    const contract = CITY_CONTRACTS[cityId]
    cities.push(await observeCity({
      cityId,
      baseUrl: new URL(contract.path, root),
      timeZone: contract.timeZone,
      nowMs: evaluatedMs,
      expectedRelease: expected?.[cityId] || null,
      fetchImpl,
      browserProbe,
      timeoutMs: normalizedTimeoutMs,
      attempts: normalizedAttempts,
      retryDelayMs: normalizedRetryDelayMs,
      delay,
    }))
  }

  const blocked = cities.filter((city) => city.status !== 'observed')
  const deployedReleases = blocked.length === 0 && expected
    ? Object.fromEntries(cities.map((city) => [city.cityId, city.release]))
    : null
  const unbound = blocked.length === 0 && !expected
  return deepFreeze({
    schema: S11_PRODUCTION_OBSERVATION_SCHEMA,
    schemaVersion: S11_PRODUCTION_OBSERVATION_SCHEMA_VERSION,
    evaluatedAt: new Date(evaluatedMs).toISOString(),
    status: deployedReleases ? 'observed' : unbound ? 'observed-unbound' : 'blocked',
    cities,
    deployedReleases,
    blockers: [
      ...blocked.map((city) => `CITY_NOT_OBSERVED:${city.cityId}`),
      ...(unbound ? ['EXPECTED_RELEASE_BINDING_REQUIRED'] : []),
    ],
    interpretation: 'Observed means exact participant-facing artifact bytes, an actually loaded bundle pin, and executed app identity were verified; it is not a beta pass or refresh/deploy SLO.',
  })
}

export function readS11CheckedReleaseIdentities({
  artifactRoots = S11_CHECKED_ARTIFACT_ROOTS,
} = {}) {
  exactKeys(artifactRoots, S11_BETA_CITY_IDS, 'artifactRoots')
  const releases = {}
  for (const cityId of S11_BETA_CITY_IDS) {
    const checked = verifyArtifactSet({
      root: artifactRoots[cityId],
      expectedCityId: cityId,
      expectedTimeZone: CITY_CONTRACTS[cityId].timeZone,
    })
    if (!checked.ok || !checked.manifest) {
      throw new Error(`checked artifact root for ${cityId} is untrusted: ${checked.problems.join(' | ')}`)
    }
    releases[cityId] = {
      manifestId: checked.manifest.manifestId,
      buildId: checked.manifest.buildId,
    }
  }
  return deepFreeze(releases)
}

export async function buildS11ProductionAttestation({
  nowMs,
  productRootUrl = S11_PRODUCTION_ROOT_URL,
  artifactRoots = S11_CHECKED_ARTIFACT_ROOTS,
  fetchImpl = globalThis.fetch,
  browserProbe = playwrightBrowserProbe,
  timeoutMs = 15_000,
  attempts = 6,
  retryDelayMs = 10_000,
  delay,
} = {}) {
  const expectedReleases = readS11CheckedReleaseIdentities({ artifactRoots })
  const observation = await observeS11ParticipantRelease({
    nowMs,
    productRootUrl,
    expectedReleases,
    fetchImpl,
    browserProbe,
    timeoutMs,
    attempts,
    retryDelayMs,
    ...(delay ? { delay } : {}),
  })
  const betaReadiness = prepareS11BetaReleaseKit({
    nowMs,
    artifactRoots,
    deployedReleases: observation.deployedReleases,
  })
  return deepFreeze({
    schema: 'wuzup-beta-production-attestation',
    schemaVersion: S11_PRODUCTION_OBSERVATION_SCHEMA_VERSION,
    evaluatedAt: new Date(normalizeNowMs(nowMs)).toISOString(),
    status: observation.status !== 'observed'
      ? 'integrity-blocked'
      : betaReadiness.status === 'release-ready'
        ? 'release-ready'
        : 'production-observed',
    observation,
    betaReadiness,
    interpretation: 'Production observation and beta readiness are separate gates; neither is a beta outcome.',
  })
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  const nowMs = Date.now()
  try {
    const result = await buildS11ProductionAttestation({
      nowMs,
      productRootUrl: process.argv.length >= 3 ? process.argv[2] : S11_PRODUCTION_ROOT_URL,
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.status === 'integrity-blocked') process.exitCode = 1
  } catch (error) {
    process.stderr.write(`S11 production attestation failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
