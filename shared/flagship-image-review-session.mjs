import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  lstat,
  link,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { PRODUCT_UA } from '../finder/ua.mjs'
import {
  buildFlagshipImageReview,
  FLAGSHIP_IMAGE_DECISION_SCHEMA_VERSION,
  flagshipImageReviewSha256,
  readContainedFlagshipImageFile,
  validateFlagshipImageDecisionReceipt,
  validateFlagshipImageReview,
  verifyFlagshipImageReview,
} from './flagship-image-review.mjs'
import { validateImageReference } from './image-reference.mjs'

export const FLAGSHIP_IMAGE_REVIEW_SESSION_SCHEMA_VERSION = 2
export const FLAGSHIP_IMAGE_OWNER_POLICY_SCHEMA_VERSION = 1

const REMOTE_HOST = 'upload.wikimedia.org'
const DEFAULT_CONCURRENCY = 1
const DEFAULT_REQUEST_PACING_MS = 500
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_SESSION_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_PIXELS = 50_000_000
const DEFAULT_MAX_DIMENSION = 20_000
const DEFAULT_RETRY_BASE_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_REVIEW_BYTE_AGE_MS = 24 * 60 * 60 * 1_000
const MAX_REVIEW_NOTES_LENGTH = 4_000
const OWNER_POLICY_STATE = 'owner-policy-ratification'
const OWNER_POLICY_AUTHENTICATION = 'not-cryptographically-authenticated'
const DECISION_HEADER = Object.freeze([
  'sampleIndex',
  'cityId',
  'itemId',
  'evidenceSha256',
  'sourcePageCheckedAt',
  'sourcePageFinalUrl',
  'sourcePageStatus',
  'identity',
  'pixel',
  'creditLicense',
  'resolution',
  'notes',
])
const MIME_BY_FORMAT = Object.freeze({
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
})
const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_FORMAT))
const HASH = /^sha256:[a-f0-9]{64}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function exactKeys(value, keys, label) {
  invariant(plainObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  invariant(actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} must contain exactly: ${expected.join(', ')}`)
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function canonicalInstant(value, label) {
  invariant(typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value)),
    `${label} must be a canonical ISO instant`)
  invariant(new Date(value).toISOString() === value, `${label} must be a canonical ISO instant`)
  return value
}

function clockInstant(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? value : new Date(value)
  invariant(Number.isFinite(date.getTime()), 'review session clock returned an invalid instant')
  return date.toISOString()
}

function canonicalStringList(value, label, allowed = null) {
  invariant(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`)
  const normalized = value.map((entry, index) => {
    invariant(text(entry) && entry === entry.trim(), `${label}[${index}] must be canonical non-empty text`)
    invariant(entry.length <= 200, `${label}[${index}] is too long`)
    if (allowed) invariant(allowed.has(entry), `${label}[${index}] is not allowed`)
    return entry
  })
  invariant(new Set(normalized).size === normalized.length, `${label} cannot contain duplicates`)
  invariant(normalized.every((entry, index) => index === 0 || normalized[index - 1].localeCompare(entry) < 0),
    `${label} must be sorted lexicographically`)
  return normalized
}

/**
 * Validate a report-bound owner policy assertion. The assertion and its
 * externally retained hash make policy changes detectable; they are not a
 * digital signature and do not authenticate who supplied the assertion.
 */
export function validateFlagshipImageOwnerPolicyReceipt({ review, receipt, reviewedAt = null } = {}) {
  validateFlagshipImageReview(review)
  exactKeys(receipt, [
    'schemaVersion', 'state', 'authentication', 'policyId', 'owner', 'ratifiedAt',
    'reportSha256', 'allowedLicenses', 'allowedSourceFamilies', 'allowedDeliveries',
  ], 'owner-policy receipt')
  invariant(receipt.schemaVersion === FLAGSHIP_IMAGE_OWNER_POLICY_SCHEMA_VERSION,
    'owner-policy receipt schemaVersion is invalid')
  invariant(receipt.state === OWNER_POLICY_STATE, `owner-policy receipt state must be ${OWNER_POLICY_STATE}`)
  invariant(receipt.authentication === OWNER_POLICY_AUTHENTICATION,
    `owner-policy receipt authentication must be ${OWNER_POLICY_AUTHENTICATION}`)
  for (const key of ['policyId', 'owner']) {
    invariant(text(receipt[key]) && receipt[key] === receipt[key].trim() && receipt[key].length <= 200,
      `owner-policy receipt ${key} must be canonical non-empty text at most 200 characters`)
  }
  canonicalInstant(receipt.ratifiedAt, 'owner-policy receipt ratifiedAt')
  if (reviewedAt != null) {
    canonicalInstant(reviewedAt, 'reviewedAt')
    invariant(Date.parse(receipt.ratifiedAt) <= Date.parse(reviewedAt),
      'owner-policy receipt ratifiedAt cannot follow the review')
  }
  invariant(receipt.reportSha256 === flagshipImageReviewSha256(review),
    'owner-policy receipt reportSha256 does not match the review population')
  canonicalStringList(receipt.allowedLicenses, 'owner-policy receipt allowedLicenses')
  canonicalStringList(receipt.allowedSourceFamilies, 'owner-policy receipt allowedSourceFamilies')
  canonicalStringList(receipt.allowedDeliveries, 'owner-policy receipt allowedDeliveries',
    new Set(['remote', 'self-hosted']))
  return receipt
}

export function flagshipImageOwnerPolicySha256({ review, receipt } = {}) {
  validateFlagshipImageOwnerPolicyReceipt({ review, receipt })
  return sha256(Buffer.from(JSON.stringify(receipt), 'utf8'))
}

/** The returned seal must be retained outside the mutable session directory. */
export function flagshipImageReviewEvidenceSealSha256({ review, evidence } = {}) {
  validateFlagshipImageReview(review)
  validateSessionEvidence(review, evidence)
  return sha256(Buffer.from(JSON.stringify({ review, evidence }), 'utf8'))
}

export function flagshipImageDecisionReceiptSha256({ review, receipt } = {}) {
  validateFlagshipImageDecisionReceipt({ review, receipt })
  return sha256(canonicalJsonBytes(receipt))
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function existingRealPath(value) {
  let cursor = path.resolve(value)
  const suffix = []
  while (true) {
    try {
      const existing = await realpath(cursor)
      return path.resolve(existing, ...suffix.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(cursor)
      invariant(parent !== cursor, `cannot resolve review session path ${value}`)
      suffix.push(path.basename(cursor))
      cursor = parent
    }
  }
}

export async function assertSafeFlagshipImageReviewSessionRoot({ repoRoot, sessionDir } = {}) {
  invariant(text(repoRoot), 'repoRoot is required')
  invariant(text(sessionDir), 'sessionDir is required')
  const root = await existingRealPath(repoRoot)
  const session = await existingRealPath(sessionDir)
  const protectedRoots = await Promise.all([
    path.join(root, 'app', 'public'),
    path.join(root, 'finder', 'output'),
    path.join(root, 'finder', 'cache'),
  ].map(existingRealPath))

  invariant(session !== root, 'review session directory cannot be the repository root')
  for (const protectedRoot of protectedRoots) {
    invariant(!inside(protectedRoot, session),
      `review session directory cannot be inside protected shipping/data path ${protectedRoot}`)
  }
  return session
}

async function createSessionDir({ repoRoot, sessionDir }) {
  const resolved = sessionDir
    ? path.resolve(sessionDir)
    : await mkdtemp(path.join(os.tmpdir(), 'wuzup-s10-image-review-'))
  await assertSafeFlagshipImageReviewSessionRoot({ repoRoot, sessionDir: resolved })
  await mkdir(resolved, { recursive: true })
  const real = await realpath(resolved)
  await assertSafeFlagshipImageReviewSessionRoot({ repoRoot, sessionDir: real })
  return real
}

async function resolveSessionPixelDirectory({ repoRoot, sessionDir, create = false }) {
  const session = await realpath(sessionDir)
  const candidate = path.join(session, 'pixels')
  let entry
  try {
    entry = await lstat(candidate)
  } catch (error) {
    if (error?.code !== 'ENOENT' || !create) {
      throw new TypeError(`session pixel directory is unavailable: ${error?.message || error}`)
    }
    try {
      await mkdir(candidate)
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') throw mkdirError
    }
    entry = await lstat(candidate)
  }
  invariant(entry.isDirectory() && !entry.isSymbolicLink(),
    'session pixel directory must be a real directory, not a symlink or junction')
  const pixels = await realpath(candidate)
  invariant(pixels !== session && inside(session, pixels),
    'session pixel directory must resolve inside the review session')
  await assertSafeFlagshipImageReviewSessionRoot({ repoRoot, sessionDir: pixels })
  return pixels
}

async function atomicWrite(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, filePath)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function atomicWriteJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readCanonicalJson(filePath, label) {
  let bytes
  let value
  try {
    const entry = await lstat(filePath)
    invariant(entry.isFile() && !entry.isSymbolicLink(), `${label} must be a regular file, not a symlink`)
    bytes = await readFile(filePath)
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new TypeError(`${label} cannot be read: ${error?.message || error}`)
  }
  invariant(bytes.equals(canonicalJsonBytes(value)), `${label} is not in canonical JSON form`)
  return { value, bytes }
}

async function maybeReadCanonicalJson(filePath, label) {
  try {
    await lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  return readCanonicalJson(filePath, label)
}

async function publishCanonicalJsonExclusive(filePath, value, label) {
  const bytes = canonicalJsonBytes(value)
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await link(temporary, filePath)
      return { bytes, created: true }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const entry = await lstat(filePath)
      invariant(entry.isFile() && !entry.isSymbolicLink(),
        `${label} must be a regular file, not a symlink`)
      const existing = await readFile(filePath)
      invariant(existing.equals(bytes), `${label} already exists with conflicting content`)
      return { bytes: existing, created: false }
    }
  } finally {
    if (handle) await handle.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function normalizeContentType(value) {
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : ''
}

async function inspectImageBytes(bytes, {
  contentType,
  maxPixels = DEFAULT_MAX_PIXELS,
  maxDimension = DEFAULT_MAX_DIMENSION,
  label = 'review image',
} = {}) {
  invariant(Buffer.isBuffer(bytes) && bytes.length > 0, `${label} bytes are empty`)
  const declaredMime = normalizeContentType(contentType)
  invariant(ALLOWED_MIME_TYPES.has(declaredMime), `${label} content type is not an allowed review image`)
  let metadata
  try {
    metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: maxPixels }).metadata()
  } catch {
    throw new TypeError(`${label} cannot be decoded safely`)
  }
  const width = metadata.width
  const height = metadata.height
  invariant(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0,
    `${label} dimensions are unavailable`)
  invariant(width <= maxDimension && height <= maxDimension && width * height <= maxPixels,
    `${label} exceeds review pixel limits`)
  invariant(!Number.isInteger(metadata.pages) || metadata.pages <= 1, `${label} must not be animated`)
  const decodedMime = MIME_BY_FORMAT[metadata.format]
  invariant(decodedMime && decodedMime === declaredMime, `${label} decoded format does not match content type`)
  try {
    // metadata() alone accepts some header-valid truncated JPEGs. Materialize
    // the bounded raw frame so the reviewed bytes have actually decoded.
    await sharp(bytes, { failOn: 'error', limitInputPixels: maxPixels }).raw().toBuffer()
  } catch {
    throw new TypeError(`${label} cannot be decoded safely`)
  }
  return { width, height, mimeType: decodedMime, format: metadata.format }
}

async function boundedResponseBytes(response, { maxBytes, label }) {
  const contentLengthHeader = response.headers?.get?.('content-length')
  if (contentLengthHeader != null && contentLengthHeader !== '') {
    const contentLength = Number(contentLengthHeader)
    invariant(Number.isInteger(contentLength) && contentLength >= 0, `${label} content-length is invalid`)
    invariant(contentLength <= maxBytes, `${label} exceeds the review byte limit`)
  }
  invariant(response.body && typeof response.body.getReader === 'function', `${label} response body is not streamable`)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      invariant(total <= maxBytes, `${label} exceeds the review byte limit`)
      chunks.push(chunk)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  invariant(total > 0, `${label} response body is empty`)
  return Buffer.concat(chunks, total)
}

function retryDelay(response, attempt, now) {
  const raw = response?.headers?.get?.('retry-after')?.trim()
  if (raw && /^\d+$/.test(raw)) {
    const delay = Number(raw) * 1_000
    invariant(Number.isSafeInteger(delay), 'Retry-After is too large; review fetch stopped')
    invariant(delay <= MAX_RETRY_DELAY_MS,
      `Retry-After exceeds the ${MAX_RETRY_DELAY_MS}ms safe wait; review fetch stopped`)
    return delay
  }
  if (raw) {
    const retryAt = Date.parse(raw)
    const current = (typeof now === 'function' ? now() : now)
    const currentMs = current instanceof Date ? current.getTime() : Date.parse(current)
    if (Number.isFinite(retryAt) && Number.isFinite(currentMs)) {
      const delay = Math.max(0, retryAt - currentMs)
      invariant(delay <= MAX_RETRY_DELAY_MS,
        `Retry-After exceeds the ${MAX_RETRY_DELAY_MS}ms safe wait; review fetch stopped`)
      return delay
    }
    throw new TypeError('Retry-After is invalid; review fetch stopped')
  }
  return Math.min(DEFAULT_RETRY_BASE_MS * (2 ** attempt), MAX_RETRY_DELAY_MS)
}

const defaultSleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Fetch and inspect one immutable review candidate. This never follows a
 * redirect: a different final URL is a different candidate and requires a new
 * artifact review population.
 */
export async function fetchFlagshipImageReviewPixel({
  reference,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  sleepImpl = defaultSleep,
  paceRequest = async () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  maxPixels = DEFAULT_MAX_PIXELS,
  maxDimension = DEFAULT_MAX_DIMENSION,
} = {}) {
  const parsed = validateImageReference(reference)
  invariant(parsed.kind === 'remote' && parsed.host === REMOTE_HOST,
    `review image must be an HTTPS ${REMOTE_HOST} URL`)
  invariant(typeof fetchImpl === 'function', 'fetchImpl is required')
  invariant(typeof paceRequest === 'function', 'paceRequest is required')
  invariant(Number.isInteger(timeoutMs) && timeoutMs > 0, 'timeoutMs must be positive')
  invariant(Number.isInteger(maxRetries) && maxRetries >= 0 && maxRetries <= 5, 'maxRetries must be between 0 and 5')
  invariant(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= DEFAULT_MAX_BYTES,
    `maxBytes must be between 1 and ${DEFAULT_MAX_BYTES}`)
  invariant(Number.isInteger(maxPixels) && maxPixels > 0 && maxPixels <= DEFAULT_MAX_PIXELS,
    `maxPixels must be between 1 and ${DEFAULT_MAX_PIXELS}`)
  invariant(Number.isInteger(maxDimension) && maxDimension > 0 && maxDimension <= DEFAULT_MAX_DIMENSION,
    `maxDimension must be between 1 and ${DEFAULT_MAX_DIMENSION}`)

  const label = `review image ${reference}`
  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequest()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`${label} request timed out`)), timeoutMs)
    let response
    try {
      response = await fetchImpl(reference, {
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg',
          'User-Agent': `${PRODUCT_UA} flagship-image-independent-review`,
        },
        redirect: 'manual',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })
      invariant(response && Number.isInteger(response.status), `${label} returned an invalid response`)
      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt < maxRetries) {
        clearTimeout(timer)
        await response.body?.cancel?.().catch(() => {})
        await sleepImpl(retryDelay(response, attempt, now))
        continue
      }
      invariant(response.status === 200, `${label} returned HTTP ${response.status}`)
      invariant(response.url === reference, `${label} final URL does not match the audited reference`)
      const contentType = normalizeContentType(response.headers?.get?.('content-type'))
      invariant(ALLOWED_MIME_TYPES.has(contentType), `${label} content type is not an allowed review image`)
      const bytes = await boundedResponseBytes(response, { maxBytes, label })
      const inspected = await inspectImageBytes(bytes, { contentType, maxPixels, maxDimension, label })
      clearTimeout(timer)
      return {
        bytes,
        evidence: {
          sha256: sha256(bytes),
          bytes: bytes.length,
          width: inspected.width,
          height: inspected.height,
          mimeType: inspected.mimeType,
          retrievedAt: clockInstant(now),
          finalUrl: reference,
        },
      }
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      const retryableNetwork = !response && attempt < maxRetries
      if (retryableNetwork) {
        await sleepImpl(retryDelay(null, attempt, now))
        continue
      }
      throw error
    }
  }
  throw lastError || new TypeError(`${label} fetch failed`)
}

function extensionForMime(mimeType) {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length)
}

function safePixelPath(value, label) {
  invariant(typeof value === 'string' && /^pixels\/[a-f0-9]{64}\.(?:avif|jpg|png|webp)$/.test(value),
    `${label} is not a safe review pixel path`)
  return value
}

async function storePixel(sessionDir, pixelsRoot, bytes, evidence) {
  const extension = extensionForMime(evidence.mimeType)
  const relativePath = `pixels/${evidence.sha256.slice('sha256:'.length)}.${extension}`
  safePixelPath(relativePath, 'pixel path')
  const currentPixelsRoot = await realpath(path.join(sessionDir, 'pixels'))
  invariant(currentPixelsRoot === pixelsRoot, 'session pixel directory changed during review preparation')
  const entry = await lstat(path.join(sessionDir, 'pixels'))
  invariant(entry.isDirectory() && !entry.isSymbolicLink(),
    'session pixel directory changed into a symlink or junction')
  const target = path.join(pixelsRoot, path.basename(relativePath))
  try {
    await atomicWrite(target, bytes)
  } catch (error) {
    let existing
    try {
      existing = await readFile(target)
    } catch {
      throw error
    }
    invariant(sha256(existing) === evidence.sha256 && existing.length === evidence.bytes,
      `existing review pixel ${relativePath} does not match its content address`)
  }
  return relativePath
}

async function localPixel(item, repoRoot, now, limits) {
  const source = path.resolve(repoRoot, ...item.image.localByte.path.split('/'))
  const localRoot = path.resolve(repoRoot, 'finder', 'output', item.cityId, 'place-img')
  invariant(inside(localRoot, source), `${item.cityId}:${item.itemId} local review pixel escapes place-img`)
  const bytes = await readContainedFlagshipImageFile({
    containmentRoot: repoRoot,
    fileRoot: localRoot,
    filePath: source,
    maxBytes: limits.maxBytes,
    label: `${item.cityId}:${item.itemId} local review image`,
  })
  const mimeType = MIME_BY_FORMAT[item.image.localByte.format]
  invariant(mimeType, `${item.cityId}:${item.itemId} local review pixel format is unsupported`)
  const inspected = await inspectImageBytes(bytes, {
    contentType: mimeType,
    maxPixels: limits.maxPixels,
    maxDimension: limits.maxDimension,
    label: `local review image ${item.cityId}:${item.itemId}`,
  })
  const evidence = {
    sha256: sha256(bytes),
    bytes: bytes.length,
    width: inspected.width,
    height: inspected.height,
    mimeType: inspected.mimeType,
    retrievedAt: clockInstant(now),
    finalUrl: null,
  }
  invariant(evidence.sha256 === item.image.localByte.sha256, `${item.cityId}:${item.itemId} local image hash drifted`)
  invariant(evidence.bytes === item.image.localByte.bytes, `${item.cityId}:${item.itemId} local image byte count drifted`)
  invariant(evidence.width === item.image.localByte.width && evidence.height === item.image.localByte.height,
    `${item.cityId}:${item.itemId} local image dimensions drifted`)
  invariant(evidence.mimeType === `image/${item.image.localByte.format}`,
    `${item.cityId}:${item.itemId} local image MIME drifted`)
  return { bytes, evidence }
}

async function mapLimit(values, limit, mapper) {
  invariant(limit === 1, 'review decode concurrency must be exactly 1')
  const output = new Array(values.length)
  let cursor = 0
  let failure = null
  async function worker() {
    while (true) {
      if (failure) return
      const index = cursor++
      if (index >= values.length) return
      try {
        output[index] = await mapper(values[index], index)
      } catch (error) {
        failure ||= error
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  if (failure) throw failure
  return output
}

function requestPacer({ intervalMs, sleepImpl }) {
  invariant(Number.isInteger(intervalMs) && intervalMs >= 0 && intervalMs <= MAX_RETRY_DELAY_MS,
    `requestPacingMs must be between 0 and ${MAX_RETRY_DELAY_MS}`)
  let first = true
  let sequence = Promise.resolve()
  return async () => {
    const scheduled = sequence.then(async () => {
      if (first) {
        first = false
        return
      }
      await sleepImpl(intervalMs)
    })
    sequence = scheduled.catch(() => {})
    await scheduled
  }
}

function evidenceRow(item, pixelPath, reviewedBytes) {
  return {
    sampleIndex: item.sampleIndex,
    cityId: item.cityId,
    itemId: item.itemId,
    imageReference: item.image.reference,
    delivery: item.image.delivery,
    pixelPath,
    reviewedBytes,
  }
}

function escapeCsv(value) {
  const string = value == null ? '' : String(value)
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string
}

function decisionEvidenceSha256(row) {
  return sha256(Buffer.from(JSON.stringify({
    sampleIndex: row.sampleIndex,
    cityId: row.cityId,
    itemId: row.itemId,
    imageReference: row.imageReference,
    delivery: row.delivery,
    pixelPath: row.pixelPath,
    reviewedBytes: row.reviewedBytes,
  }), 'utf8'))
}

function decisionCsv(review, evidence) {
  const evidenceByIndex = new Map(evidence.items.map(item => [item.sampleIndex, item]))
  const lines = [DECISION_HEADER.join(',')]
  for (const item of review.items) {
    const row = evidenceByIndex.get(item.sampleIndex)
    invariant(row, `${item.cityId}:${item.itemId} decision evidence is missing`)
    lines.push([
      item.sampleIndex,
      item.cityId,
      item.itemId,
      decisionEvidenceSha256(row),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ].map(escapeCsv).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function contactSheet(review, evidence) {
  const evidenceByIndex = new Map(evidence.items.map(item => [item.sampleIndex, item]))
  const cards = review.items.map(item => {
    const row = evidenceByIndex.get(item.sampleIndex)
    const risk = item.stratification.riskFlags.length ? item.stratification.riskFlags.join(', ') : 'none'
    return `<article id="item-${item.sampleIndex}">
  <img src="${escapeHtml(row.pixelPath)}" alt="Review candidate for ${escapeHtml(item.name)}" loading="lazy">
  <div><strong>${item.sampleIndex}. ${escapeHtml(item.name)}</strong></div>
  <div>${escapeHtml(item.cityId)} / ${escapeHtml(item.itemId)}</div>
  <div>${escapeHtml(item.address || 'Address unavailable')}</div>
  <div>Delivery: ${escapeHtml(item.image.delivery)} / reuse: ${item.image.artifactUsageCount}</div>
  <div>Risk flags: ${escapeHtml(risk)}</div>
  <div>Credit: ${escapeHtml(item.credit.author)} / ${escapeHtml(item.credit.license)}</div>
  <div><a href="${escapeHtml(item.credit.sourcePage)}" target="_blank" rel="noopener noreferrer">Open source page</a>${item.credit.licenseUrl ? ` / <a href="${escapeHtml(item.credit.licenseUrl)}" target="_blank" rel="noopener noreferrer">License</a>` : ''}</div>
</article>`
  }).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wuzup Sprint 10 image review</title>
<style>body{font:15px/1.45 system-ui;margin:0;background:#f5f1e8;color:#241f1a}header{padding:20px;max-width:900px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;padding:16px}article{background:white;border:1px solid #d7cdbf;border-radius:16px;padding:12px;overflow:hidden}img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#ddd;margin-bottom:10px}a{color:#6847b6}</style></head>
<body><header><h1>Wuzup Sprint 10 image review</h1><p>Inspect all 100 cached byte sets and their exact source pages. Record source-page verification, identity, pixel, credit/license, resolution, and non-empty notes in <code>decisions.csv</code>. Use <code>needs-owner</code> when an assessment cannot be completed independently. This contact sheet is review evidence, not approval.</p><p>Report: <code>${escapeHtml(evidence.reportSha256)}</code></p></header><main class="grid">${cards}</main></body></html>
`
}

function evidenceIndex(review, createdAt, items, uniqueRemoteCount) {
  return {
    schemaVersion: FLAGSHIP_IMAGE_REVIEW_SESSION_SCHEMA_VERSION,
    state: 'review-only-not-for-shipping',
    reportSha256: flagshipImageReviewSha256(review),
    createdAt,
    counts: {
      items: items.length,
      remoteRows: items.filter(item => item.delivery === 'remote').length,
      uniqueRemoteReferences: uniqueRemoteCount,
      localRows: items.filter(item => item.delivery === 'self-hosted').length,
    },
    items,
  }
}

/** Build a review-only byte bundle. No fetched byte is written to a shipping path. */
export async function prepareFlagshipImageReviewSession({
  repoRoot,
  sessionDir = null,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  sleepImpl = defaultSleep,
  concurrency = DEFAULT_CONCURRENCY,
  requestPacingMs = DEFAULT_REQUEST_PACING_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  maxSessionBytes = DEFAULT_MAX_SESSION_BYTES,
  maxPixels = DEFAULT_MAX_PIXELS,
  maxDimension = DEFAULT_MAX_DIMENSION,
} = {}) {
  invariant(text(repoRoot), 'repoRoot is required')
  const root = path.resolve(repoRoot)
  const review = await buildFlagshipImageReview({ repoRoot: root })
  await verifyFlagshipImageReview({ repoRoot: root, review })
  const autoCreated = sessionDir == null
  const directory = await createSessionDir({ repoRoot: root, sessionDir })
  try {
    const evidencePath = path.join(directory, 'evidence.json')
    for (const name of ['review.json', 'evidence.json', 'decisions.csv', 'index.html', 'decision-receipt.json']) {
      try {
        await stat(path.join(directory, name))
        throw new TypeError('review session already contains evidence; use a new session directory')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }

  const createdAt = clockInstant(now)
  invariant(Number.isInteger(maxSessionBytes) && maxSessionBytes > 0 &&
    maxSessionBytes <= DEFAULT_MAX_SESSION_BYTES,
  `maxSessionBytes must be between 1 and ${DEFAULT_MAX_SESSION_BYTES}`)
  let sessionBytes = 0
  const reserveSessionBytes = (bytes) => {
    sessionBytes += bytes
    invariant(sessionBytes <= maxSessionBytes, 'review session exceeds its total byte budget')
  }
  const pixelsRoot = await resolveSessionPixelDirectory({ repoRoot: root, sessionDir: directory, create: true })
  const paceRequest = requestPacer({ intervalMs: requestPacingMs, sleepImpl })
  const remoteReferences = [...new Set(review.items
    .filter(item => item.image.delivery === 'remote')
    .map(item => item.image.reference))]
  const remoteResults = await mapLimit(remoteReferences, concurrency, async (reference) => {
    const result = await fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl,
      now,
      sleepImpl,
      paceRequest,
      timeoutMs,
      maxRetries,
      maxBytes,
      maxPixels,
      maxDimension,
    })
    reserveSessionBytes(result.evidence.bytes)
    const pixelPath = await storePixel(directory, pixelsRoot, result.bytes, result.evidence)
    return { reference, pixelPath, reviewedBytes: result.evidence }
  })
  const remoteByReference = new Map()
  for (const result of remoteResults) {
    remoteByReference.set(result.reference, {
      pixelPath: result.pixelPath,
      reviewedBytes: result.reviewedBytes,
    })
  }

  const items = []
  for (const item of review.items) {
    if (item.image.delivery === 'remote') {
      const remote = remoteByReference.get(item.image.reference)
      invariant(remote, `${item.cityId}:${item.itemId} remote review evidence is missing`)
      items.push(evidenceRow(item, remote.pixelPath, remote.reviewedBytes))
      continue
    }
    const local = await localPixel(item, root, now, { maxBytes, maxPixels, maxDimension })
    reserveSessionBytes(local.evidence.bytes)
    const pixelPath = await storePixel(directory, pixelsRoot, local.bytes, local.evidence)
    items.push(evidenceRow(item, pixelPath, local.evidence))
  }

  const evidence = evidenceIndex(review, createdAt, items, remoteReferences.length)
  validateSessionEvidence(review, evidence)
  const evidenceSealSha256 = flagshipImageReviewEvidenceSealSha256({ review, evidence })
  await atomicWriteJson(path.join(directory, 'review.json'), review)
  await atomicWrite(path.join(directory, 'decisions.csv'), decisionCsv(review, evidence))
  await atomicWrite(path.join(directory, 'index.html'), contactSheet(review, evidence))
  // evidence.json is the completion marker. It lands only after every reviewer
  // artifact and every content-addressed pixel is durable.
  await atomicWriteJson(evidencePath, evidence)

    return {
      sessionDir: directory,
      reportSha256: evidence.reportSha256,
      evidenceSealSha256,
      itemCount: items.length,
      uniqueRemoteReferences: remoteReferences.length,
    }
  } catch (error) {
    if (autoCreated) {
      try {
        await rm(directory, { recursive: true, force: true })
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError],
          `review preparation failed and its temporary session could not be removed: ${error?.message || error}`)
      }
    }
    throw error
  }
}

function validateReviewedBytesShape(value, label) {
  exactKeys(value, ['sha256', 'bytes', 'width', 'height', 'mimeType', 'retrievedAt', 'finalUrl'], label)
  invariant(HASH.test(value.sha256 || ''), `${label}.sha256 is invalid`)
  for (const key of ['bytes', 'width', 'height']) {
    invariant(Number.isInteger(value[key]) && value[key] > 0, `${label}.${key} must be positive`)
  }
  invariant(value.bytes <= DEFAULT_MAX_BYTES, `${label}.bytes exceeds the hard per-file limit`)
  invariant(value.width <= DEFAULT_MAX_DIMENSION && value.height <= DEFAULT_MAX_DIMENSION &&
    value.width * value.height <= DEFAULT_MAX_PIXELS,
  `${label} dimensions exceed the hard pixel limit`)
  invariant(ALLOWED_MIME_TYPES.has(value.mimeType), `${label}.mimeType is invalid`)
  canonicalInstant(value.retrievedAt, `${label}.retrievedAt`)
  invariant(value.finalUrl == null || text(value.finalUrl), `${label}.finalUrl must be null or non-empty`)
}

function validateSessionEvidence(review, evidence) {
  exactKeys(evidence, ['schemaVersion', 'state', 'reportSha256', 'createdAt', 'counts', 'items'], 'session evidence')
  invariant(evidence.schemaVersion === FLAGSHIP_IMAGE_REVIEW_SESSION_SCHEMA_VERSION,
    'session evidence schemaVersion is invalid')
  invariant(evidence.state === 'review-only-not-for-shipping', 'session evidence state is invalid')
  invariant(evidence.reportSha256 === flagshipImageReviewSha256(review),
    'session evidence reportSha256 does not match the review')
  canonicalInstant(evidence.createdAt, 'session evidence createdAt')
  exactKeys(evidence.counts, ['items', 'remoteRows', 'uniqueRemoteReferences', 'localRows'], 'session evidence counts')
  invariant(Array.isArray(evidence.items) && evidence.items.length === review.items.length,
    'session evidence must contain every review item')

  const uniqueRemote = new Set()
  const remoteEvidenceByReference = new Map()
  for (const [index, row] of evidence.items.entries()) {
    const item = review.items[index]
    const label = `session evidence items[${index}]`
    exactKeys(row, [
      'sampleIndex', 'cityId', 'itemId', 'imageReference', 'delivery', 'pixelPath', 'reviewedBytes',
    ], label)
    invariant(row.sampleIndex === item.sampleIndex && row.cityId === item.cityId && row.itemId === item.itemId,
      `${label} identity does not match the review`)
    invariant(row.imageReference === item.image.reference && row.delivery === item.image.delivery,
      `${label} image does not match the review`)
    safePixelPath(row.pixelPath, `${label}.pixelPath`)
    validateReviewedBytesShape(row.reviewedBytes, `${label}.reviewedBytes`)
    const expectedExtension = extensionForMime(row.reviewedBytes.mimeType)
    invariant(row.pixelPath === `pixels/${row.reviewedBytes.sha256.slice('sha256:'.length)}.${expectedExtension}`,
      `${label}.pixelPath does not match its content address`)
    if (row.delivery === 'remote') {
      invariant(row.reviewedBytes.finalUrl === row.imageReference,
        `${label}.reviewedBytes.finalUrl does not match the audited reference`)
      const parsed = validateImageReference(row.reviewedBytes.finalUrl)
      invariant(parsed.kind === 'remote' && parsed.host === REMOTE_HOST,
        `${label}.reviewedBytes.finalUrl is not an allowed review URL`)
      const canonicalEvidence = JSON.stringify({ pixelPath: row.pixelPath, reviewedBytes: row.reviewedBytes })
      if (remoteEvidenceByReference.has(row.imageReference)) {
        invariant(remoteEvidenceByReference.get(row.imageReference) === canonicalEvidence,
          `${label} does not reuse the one fetched byte set for its audited reference`)
      } else {
        remoteEvidenceByReference.set(row.imageReference, canonicalEvidence)
      }
      uniqueRemote.add(row.imageReference)
    } else {
      invariant(row.reviewedBytes.finalUrl === null, `${label}.reviewedBytes.finalUrl must be null for local bytes`)
    }
  }
  const expected = {
    items: review.items.length,
    remoteRows: review.items.filter(item => item.image.delivery === 'remote').length,
    uniqueRemoteReferences: uniqueRemote.size,
    localRows: review.items.filter(item => item.image.delivery === 'self-hosted').length,
  }
  invariant(Object.keys(expected).every(key => evidence.counts[key] === expected[key]),
    'session evidence counts do not match its items')
  return evidence
}

async function readJson(filePath, label) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    throw new TypeError(`${label} cannot be read: ${error?.message || error}`)
  }
  return parsed
}

async function readSession({ repoRoot, sessionDir, includeReceipt = false }) {
  const directory = await assertSafeFlagshipImageReviewSessionRoot({ repoRoot, sessionDir })
  const review = await readJson(path.join(directory, 'review.json'), 'review manifest')
  validateFlagshipImageReview(review)
  await verifyFlagshipImageReview({ repoRoot, review })
  const evidence = await readJson(path.join(directory, 'evidence.json'), 'session evidence')
  validateSessionEvidence(review, evidence)
  const receiptResult = includeReceipt
    ? await readCanonicalJson(path.join(directory, 'decision-receipt.json'), 'decision receipt')
    : null
  return {
    directory,
    review,
    evidence,
    receipt: receiptResult?.value || null,
    receiptBytes: receiptResult?.bytes || null,
  }
}

async function verifyEvidenceBytes(repoRoot, directory, review, evidence) {
  const pixelDirectory = await resolveSessionPixelDirectory({ repoRoot, sessionDir: directory })
  const actualEntries = await readdir(pixelDirectory, { withFileTypes: true })
  const actualFiles = actualEntries.map((entry) => {
    invariant(entry.isFile() && !entry.isSymbolicLink(),
      `session pixel directory contains non-regular entry ${entry.name}`)
    return `pixels/${entry.name}`
  }).sort()
  const expectedFiles = [...new Set(evidence.items.map(item => item.pixelPath))].sort()
  invariant(actualFiles.length === expectedFiles.length &&
    actualFiles.every((value, index) => value === expectedFiles[index]),
  'session pixel directory contains missing or unbound cached bytes')
  let totalBytes = 0
  for (const relativePath of actualFiles) {
    const target = path.join(pixelDirectory, path.basename(relativePath))
    const file = await stat(target)
    invariant(file.isFile() && file.size > 0 && file.size <= DEFAULT_MAX_BYTES,
      `cached review pixel ${relativePath} exceeds the hard per-file byte limit`)
    totalBytes += file.size
    invariant(totalBytes <= DEFAULT_MAX_SESSION_BYTES,
      'cached review pixels exceed the hard session byte limit')
  }
  const inspectedByPath = new Map()
  for (const row of evidence.items) {
    if (!inspectedByPath.has(row.pixelPath)) {
      const target = path.join(pixelDirectory, path.basename(row.pixelPath))
      let bytes
      try {
        bytes = await readFile(target)
      } catch (error) {
        throw new TypeError(`review pixel ${row.pixelPath} cannot be read: ${error?.message || error}`)
      }
      const inspected = await inspectImageBytes(bytes, {
        contentType: row.reviewedBytes.mimeType,
        label: `cached review pixel ${row.pixelPath}`,
      })
      inspectedByPath.set(row.pixelPath, {
        sha256: sha256(bytes),
        bytes: bytes.length,
        width: inspected.width,
        height: inspected.height,
        mimeType: inspected.mimeType,
      })
    }
    const actual = inspectedByPath.get(row.pixelPath)
    for (const key of ['sha256', 'bytes', 'width', 'height', 'mimeType']) {
      invariant(actual[key] === row.reviewedBytes[key],
        `cached review pixel ${row.pixelPath} ${key} does not match session evidence`)
    }
  }

  for (const [index, row] of evidence.items.entries()) {
    const item = review.items[index]
    if (item.image.delivery !== 'self-hosted') continue
    for (const key of ['sha256', 'bytes', 'width', 'height']) {
      invariant(row.reviewedBytes[key] === item.image.localByte[key],
        `local cached review pixel ${row.pixelPath} ${key} does not match the review manifest`)
    }
    invariant(row.reviewedBytes.mimeType === `image/${item.image.localByte.format}`,
      `local cached review pixel ${row.pixelPath} MIME does not match the review manifest`)
  }
  return { uniquePixelFiles: inspectedByPath.size }
}

function parseCsv(value) {
  invariant(typeof value === 'string', 'decisions CSV must be text')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let afterQuote = false
  const finishField = () => {
    row.push(field)
    field = ''
    afterQuote = false
  }
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"'
        index++
      } else if (character === '"') {
        quoted = false
        afterQuote = true
      } else {
        field += character
      }
      continue
    }
    if (afterQuote) {
      invariant(character === ',' || character === '\r' || character === '\n',
        'decisions CSV contains characters after a closing quote')
      if (character === ',') {
        finishField()
      } else if (character === '\n') {
        finishField()
        rows.push(row)
        row = []
      }
    } else if (character === '"' && field === '') {
      quoted = true
    } else if (character === '"') {
      invariant(false, 'decisions CSV contains an unexpected quote')
    } else if (character === ',') {
      finishField()
    } else if (character === '\n') {
      field = field.replace(/\r$/, '')
      finishField()
      rows.push(row)
      row = []
    } else {
      field += character
    }
  }
  invariant(!quoted, 'decisions CSV has an unterminated quoted field')
  if (afterQuote || field || row.length) {
    field = field.replace(/\r$/, '')
    finishField()
    rows.push(row)
  }
  return rows.filter(fields => !(fields.length === 1 && fields[0] === ''))
}

function parseDecisionsCsv(value, review, evidence) {
  const rows = parseCsv(value)
  invariant(rows.length > 0, 'decisions CSV is empty')
  invariant(rows[0].length === DECISION_HEADER.length &&
    rows[0].every((field, index) => field === DECISION_HEADER[index]),
  `decisions CSV header must be exactly ${DECISION_HEADER.join(',')}`)
  const decisions = new Map()
  const evidenceByIndex = new Map(evidence.items.map(item => [item.sampleIndex, item]))
  for (const [offset, fields] of rows.slice(1).entries()) {
    const line = offset + 2
    invariant(fields.length === DECISION_HEADER.length, `decisions CSV row ${line} has the wrong field count`)
    const record = Object.fromEntries(DECISION_HEADER.map((key, index) => [key, fields[index]]))
    invariant(/^\d+$/.test(record.sampleIndex), `decisions CSV row ${line} sampleIndex is invalid`)
    const sampleIndex = Number(record.sampleIndex)
    invariant(!decisions.has(sampleIndex), `decisions CSV duplicates sampleIndex ${sampleIndex}`)
    const item = review.items[sampleIndex - 1]
    invariant(item, `decisions CSV row ${line} has unknown sampleIndex ${sampleIndex}`)
    invariant(record.cityId === item.cityId && record.itemId === item.itemId,
      `decisions CSV row ${line} identity does not match sampleIndex ${sampleIndex}`)
    const evidenceRow = evidenceByIndex.get(sampleIndex)
    invariant(evidenceRow && record.evidenceSha256 === decisionEvidenceSha256(evidenceRow),
      `decisions CSV row ${line} evidence binding changed; this row must be reviewed again`)
    canonicalInstant(record.sourcePageCheckedAt, `decisions CSV row ${line} sourcePageCheckedAt`)
    let sourcePageFinalUrl
    let auditedSourcePage
    try {
      sourcePageFinalUrl = new URL(record.sourcePageFinalUrl)
      auditedSourcePage = new URL(item.credit.sourcePage)
    } catch {
      throw new TypeError(`decisions CSV row ${line} sourcePageFinalUrl must be an absolute URL`)
    }
    invariant(sourcePageFinalUrl.protocol === 'https:' && sourcePageFinalUrl.href === auditedSourcePage.href,
      `decisions CSV row ${line} sourcePageFinalUrl must match the exact audited source page`)
    invariant(record.sourcePageStatus === '200',
      `decisions CSV row ${line} sourcePageStatus must be exactly HTTP 200`)
    for (const key of ['identity', 'pixel', 'creditLicense']) {
      invariant(['pass', 'fail', 'needs-owner'].includes(record[key]),
        `decisions CSV row ${line} ${key} must be pass, fail, or needs-owner`)
    }
    invariant(['keep', 'remove', 'replace', 'fallback'].includes(record.resolution),
      `decisions CSV row ${line} resolution is unknown`)
    invariant(text(record.notes) && record.notes === record.notes.trim() &&
      record.notes.length <= MAX_REVIEW_NOTES_LENGTH,
    `decisions CSV row ${line} notes must be canonical non-empty text at most ${MAX_REVIEW_NOTES_LENGTH} characters`)
    decisions.set(sampleIndex, record)
  }
  invariant(decisions.size === review.items.length, 'decisions CSV must contain every review item exactly once')
  return decisions
}

function reviewedBytesEqual(left, right) {
  return ['sha256', 'bytes', 'width', 'height', 'mimeType', 'retrievedAt', 'finalUrl']
    .every(key => left[key] === right[key])
}

function validateEvidenceTiming(evidence, reviewedAt) {
  const reviewTime = Date.parse(reviewedAt)
  for (const [index, row] of evidence.items.entries()) {
    const ageMs = reviewTime - Date.parse(row.reviewedBytes.retrievedAt)
    invariant(ageMs >= 0,
      `session evidence items[${index}].reviewedBytes.retrievedAt cannot follow the review`)
    invariant(ageMs <= MAX_REVIEW_BYTE_AGE_MS,
      `session evidence items[${index}].reviewedBytes.retrievedAt is too old for this review`)
  }
}

function requireExpectedEvidenceSeal(review, evidence, expectedEvidenceSealSha256) {
  invariant(HASH.test(expectedEvidenceSealSha256 || ''),
    'expectedEvidenceSealSha256 must be the externally retained SHA-256 from prepare')
  const actual = flagshipImageReviewEvidenceSealSha256({ review, evidence })
  invariant(actual === expectedEvidenceSealSha256,
    'review session evidence seal does not match the externally retained original seal')
  return actual
}

function validateOwnerPolicyForKeptItems({
  review,
  keptSampleIndexes,
  ownerPolicyReceipt,
  expectedOwnerPolicySha256,
  reviewedAt,
}) {
  if (keptSampleIndexes.length === 0) {
    invariant(ownerPolicyReceipt == null && expectedOwnerPolicySha256 == null,
      'owner-policy evidence must not be attached when no image is kept')
    return null
  }
  invariant(plainObject(ownerPolicyReceipt),
    'keeping an image requires a separately supplied owner-policy receipt')
  invariant(HASH.test(expectedOwnerPolicySha256 || ''),
    'keeping an image requires its separately retained owner-policy SHA-256')
  validateFlagshipImageOwnerPolicyReceipt({ review, receipt: ownerPolicyReceipt, reviewedAt })
  const actual = flagshipImageOwnerPolicySha256({ review, receipt: ownerPolicyReceipt })
  invariant(actual === expectedOwnerPolicySha256,
    'owner-policy receipt does not match the separately retained SHA-256')
  const licenses = new Set(ownerPolicyReceipt.allowedLicenses)
  const sourceFamilies = new Set(ownerPolicyReceipt.allowedSourceFamilies)
  const deliveries = new Set(ownerPolicyReceipt.allowedDeliveries)
  for (const sampleIndex of keptSampleIndexes) {
    const item = review.items[sampleIndex - 1]
    invariant(item && licenses.has(item.credit.license),
      `${item?.cityId || sampleIndex}:${item?.itemId || 'unknown'} kept image license is outside owner policy`)
    invariant(sourceFamilies.has(item.credit.sourceFamily),
      `${item.cityId}:${item.itemId} kept image source family is outside owner policy`)
    invariant(deliveries.has(item.image.delivery),
      `${item.cityId}:${item.itemId} kept image delivery is outside owner policy`)
  }
  return actual
}

/** Construct and persist the exact strict decision receipt after byte re-verification. */
export async function finalizeFlagshipImageReviewSession({
  repoRoot,
  sessionDir,
  reviewer,
  expectedEvidenceSealSha256,
  ownerPolicyReceipt = null,
  expectedOwnerPolicySha256 = null,
  expectedDecisionReceiptSha256 = null,
  now = () => new Date(),
} = {}) {
  invariant(text(reviewer), 'reviewer is required')
  invariant(reviewer === reviewer.trim() && reviewer.length <= 200,
    'reviewer must be canonical non-empty text at most 200 characters')
  const { directory, review, evidence } = await readSession({ repoRoot, sessionDir })
  const evidenceSealSha256 = requireExpectedEvidenceSeal(review, evidence, expectedEvidenceSealSha256)
  await verifyEvidenceBytes(repoRoot, directory, review, evidence)
  const receiptPath = path.join(directory, 'decision-receipt.json')
  const existingReceipt = await maybeReadCanonicalJson(receiptPath, 'decision receipt')
  if (existingReceipt) {
    invariant(HASH.test(expectedDecisionReceiptSha256 || ''),
      'idempotent finalize requires the externally retained decision-receipt SHA-256')
    invariant(sha256(existingReceipt.bytes) === expectedDecisionReceiptSha256,
      'existing decision receipt does not match the externally retained SHA-256')
  } else {
    invariant(expectedDecisionReceiptSha256 == null,
      'expectedDecisionReceiptSha256 cannot be supplied before a decision receipt exists')
  }
  const reviewedAt = existingReceipt?.value.reviewedAt || clockInstant(now)
  canonicalInstant(reviewedAt, 'reviewedAt')
  validateEvidenceTiming(evidence, reviewedAt)
  const decisions = parseDecisionsCsv(
    await readFile(path.join(directory, 'decisions.csv'), 'utf8'),
    review,
    evidence,
  )
  const keptSampleIndexes = [...decisions.values()]
    .filter(decision => decision.resolution === 'keep')
    .map(decision => Number(decision.sampleIndex))
  const ownerPolicySha256 = validateOwnerPolicyForKeptItems({
    review,
    keptSampleIndexes,
    ownerPolicyReceipt,
    expectedOwnerPolicySha256,
    reviewedAt,
  })
  const receipt = {
    schemaVersion: FLAGSHIP_IMAGE_DECISION_SCHEMA_VERSION,
    reportSha256: flagshipImageReviewSha256(review),
    evidenceSealSha256,
    reviewer,
    reviewedAt,
    ownerPolicySha256,
    ownerPolicyAuthentication: OWNER_POLICY_AUTHENTICATION,
    items: evidence.items.map((row) => {
      const decision = decisions.get(row.sampleIndex)
      return {
        sampleIndex: row.sampleIndex,
        cityId: row.cityId,
        itemId: row.itemId,
        imageReference: row.imageReference,
        reviewedBytes: row.reviewedBytes,
        sourcePageVerification: {
          checkedAt: decision.sourcePageCheckedAt,
          finalUrl: decision.sourcePageFinalUrl,
          httpStatus: Number(decision.sourcePageStatus),
        },
        identity: decision.identity,
        pixel: decision.pixel,
        creditLicense: decision.creditLicense,
        resolution: decision.resolution,
        notes: decision.notes,
      }
    }),
  }
  const result = validateFlagshipImageDecisionReceipt({ review, receipt })
  const candidateBytes = canonicalJsonBytes(receipt)
  if (existingReceipt) {
    invariant(existingReceipt.bytes.equals(candidateBytes),
      'decision receipt already exists with conflicting finalized content')
  }
  const published = existingReceipt || await publishCanonicalJsonExclusive(receiptPath, receipt, 'decision receipt')
  const decisionReceiptSha256 = sha256(published.bytes)
  invariant(decisionReceiptSha256 === flagshipImageDecisionReceiptSha256({ review, receipt }),
    'published decision receipt digest is not canonical')
  return {
    sessionDir: directory,
    receiptPath,
    decisionReceiptSha256,
    receiptCreated: !existingReceipt && published.created,
    ...result,
  }
}

/**
 * Composite verification: current artifacts, strict receipt, exact session
 * mapping, and every cached byte set must all agree.
 */
export async function verifyFlagshipImageDecisionBundle({
  repoRoot,
  sessionDir,
  expectedEvidenceSealSha256,
  expectedDecisionReceiptSha256,
  ownerPolicyReceipt = null,
  expectedOwnerPolicySha256 = null,
} = {}) {
  const { directory, review, evidence, receipt, receiptBytes } = await readSession({
    repoRoot,
    sessionDir,
    includeReceipt: true,
  })
  invariant(HASH.test(expectedDecisionReceiptSha256 || ''),
    'expectedDecisionReceiptSha256 must be the externally retained SHA-256 from finalize')
  const decisionReceiptSha256 = sha256(receiptBytes)
  invariant(decisionReceiptSha256 === expectedDecisionReceiptSha256,
    'decision receipt does not match the externally retained finalized SHA-256')
  const evidenceSealSha256 = requireExpectedEvidenceSeal(review, evidence, expectedEvidenceSealSha256)
  const bytes = await verifyEvidenceBytes(repoRoot, directory, review, evidence)
  const result = validateFlagshipImageDecisionReceipt({ review, receipt })
  invariant(receipt.evidenceSealSha256 === evidenceSealSha256,
    'decision receipt evidence seal does not match the externally retained original seal')
  const keptSampleIndexes = receipt.items
    .filter(decision => decision.resolution === 'keep')
    .map(decision => decision.sampleIndex)
  const ownerPolicySha256 = validateOwnerPolicyForKeptItems({
    review,
    keptSampleIndexes,
    ownerPolicyReceipt,
    expectedOwnerPolicySha256,
    reviewedAt: receipt.reviewedAt,
  })
  invariant(receipt.ownerPolicySha256 === ownerPolicySha256,
    'decision receipt owner-policy SHA-256 does not match the separately supplied policy')
  invariant(receipt.items.length === evidence.items.length, 'decision receipt and session evidence length differ')
  for (const [index, decision] of receipt.items.entries()) {
    const row = evidence.items[index]
    invariant(decision.sampleIndex === row.sampleIndex && decision.cityId === row.cityId &&
      decision.itemId === row.itemId && decision.imageReference === row.imageReference,
    `decision receipt items[${index}] does not match session evidence`)
    invariant(reviewedBytesEqual(decision.reviewedBytes, row.reviewedBytes),
      `decision receipt items[${index}].reviewedBytes does not match session evidence`)
  }
  invariant(decisionReceiptSha256 === flagshipImageDecisionReceiptSha256({ review, receipt }),
    'decision receipt digest is not canonical')
  return {
    ...result,
    decisionReceiptSha256,
    sessionDir: directory,
    uniquePixelFiles: bytes.uniquePixelFiles,
  }
}

function parseArguments(argv) {
  const command = argv[0]
  const options = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]
    invariant(flag.startsWith('--'), `unknown argument ${flag}`)
    const key = flag.slice(2)
    invariant([
      'repo-root', 'session-dir', 'reviewer', 'evidence-seal',
      'owner-policy-receipt', 'owner-policy-sha256', 'decision-receipt-sha256',
    ].includes(key), `unknown option ${flag}`)
    invariant(index + 1 < argv.length, `${flag} requires a value`)
    options[key] = argv[++index]
  }
  return { command, options }
}

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const { command, options } = parseArguments(process.argv.slice(2))
    const repoRoot = options['repo-root'] ? path.resolve(options['repo-root']) : path.resolve(path.dirname(modulePath), '..')
    let result
    if (command === 'prepare') {
      result = await prepareFlagshipImageReviewSession({
        repoRoot,
        sessionDir: options['session-dir'] ? path.resolve(options['session-dir']) : null,
      })
    } else if (command === 'finalize') {
      invariant(options['session-dir'], 'finalize requires --session-dir')
      invariant(options.reviewer, 'finalize requires --reviewer')
      invariant(options['evidence-seal'], 'finalize requires --evidence-seal from prepare output')
      const ownerPolicyReceipt = options['owner-policy-receipt']
        ? await readJson(path.resolve(options['owner-policy-receipt']), 'owner-policy receipt')
        : null
      result = await finalizeFlagshipImageReviewSession({
        repoRoot,
        sessionDir: path.resolve(options['session-dir']),
        reviewer: options.reviewer,
        expectedEvidenceSealSha256: options['evidence-seal'],
        ownerPolicyReceipt,
        expectedOwnerPolicySha256: options['owner-policy-sha256'] || null,
        expectedDecisionReceiptSha256: options['decision-receipt-sha256'] || null,
      })
    } else if (command === 'verify') {
      invariant(options['session-dir'], 'verify requires --session-dir')
      invariant(options['evidence-seal'], 'verify requires --evidence-seal from prepare output')
      invariant(options['decision-receipt-sha256'],
        'verify requires --decision-receipt-sha256 from finalize output')
      const ownerPolicyReceipt = options['owner-policy-receipt']
        ? await readJson(path.resolve(options['owner-policy-receipt']), 'owner-policy receipt')
        : null
      result = await verifyFlagshipImageDecisionBundle({
        repoRoot,
        sessionDir: path.resolve(options['session-dir']),
        expectedEvidenceSealSha256: options['evidence-seal'],
        expectedDecisionReceiptSha256: options['decision-receipt-sha256'],
        ownerPolicyReceipt,
        expectedOwnerPolicySha256: options['owner-policy-sha256'] || null,
      })
    } else {
      throw new TypeError('usage: flagship-image-review-session.mjs <prepare|finalize|verify> [options]')
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`)
    process.exitCode = 1
  }
}
