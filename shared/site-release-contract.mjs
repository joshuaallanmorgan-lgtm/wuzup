import { createHash } from 'node:crypto'

import { stableStringify } from './artifact-contract.mjs'

export const S11_SITE_RELEASE_FILE = 'site-release.json'
export const S11_SITE_RELEASE_SCHEMA = 'wuzup-site-release'
export const S11_SITE_RELEASE_SCHEMA_VERSION = 1
export const S11_SITE_RELEASE_EXCLUDED_PATHS = Object.freeze([
  '.nojekyll',
  S11_SITE_RELEASE_FILE,
])
export const S11_SITE_RELEASE_CONTROLS = Object.freeze({
  noJekyll: true,
})
export const S11_SITE_RELEASE_LIMITS = Object.freeze({
  directories: 1024,
  entries: 4096,
  fileBytes: 32 * 1024 * 1024,
  files: 4096,
  pathBytes: 512,
  receiptBytes: 2 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
})

const SHA256 = /^[a-f0-9]{64}$/
const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const SOURCE_COMMIT = /^[a-f0-9]{40}$/
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
const WINDOWS_RESERVED = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/i
const CITY_CONTRACTS = Object.freeze({
  'sf-east-bay': Object.freeze({ basePath: 'sf/' }),
  'tampa-bay': Object.freeze({ basePath: '' }),
})
const CITY_IDS = Object.freeze(Object.keys(CITY_CONTRACTS).sort())
const EXCLUDED_ROOT_KEYS = new Set(
  S11_SITE_RELEASE_EXCLUDED_PATHS
    .filter((value) => !value.includes('/'))
    .map((value) => value.toLowerCase()),
)
const TOP_LEVEL_KEYS = Object.freeze([
  'cities',
  'controls',
  'excludedPaths',
  'fileCount',
  'files',
  'releaseId',
  'schema',
  'schemaVersion',
  'sourceCommit',
  'totalBytes',
  'treeSha256',
])

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value, expected, label) {
  invariant(plainObject(value), `${label} must be a plain object`)
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

function canonicalPath(value, label = 'site release file path') {
  invariant(typeof value === 'string' && value.length > 0, `${label} must be non-empty`)
  invariant(Buffer.byteLength(value, 'utf8') <= S11_SITE_RELEASE_LIMITS.pathBytes, `${label} is too long`)
  invariant(!value.includes('\\') && !value.startsWith('/') && !value.endsWith('/'), `${label} is unsafe`)
  const segments = value.split('/')
  invariant(!EXCLUDED_ROOT_KEYS.has(segments[0].toLowerCase()), `${label} is excluded from the tree`)
  invariant(segments.every((segment) => (
    SEGMENT.test(segment)
      && segment !== '.'
      && segment !== '..'
      && !segment.endsWith('.')
      && !WINDOWS_RESERVED.test(segment)
  )), `${label} is unsafe`)
  return value
}

function registerPathTopology({ filePath, canonicalSpellings, directoryPaths, filePaths }) {
  const segments = filePath.split('/')
  let prefix = ''
  for (let length = 1; length <= segments.length; length += 1) {
    prefix = prefix ? `${prefix}/${segments[length - 1]}` : segments[length - 1]
    const collisionKey = prefix.toLowerCase()
    const priorSpelling = canonicalSpellings.get(collisionKey)
    invariant(
      priorSpelling === undefined || priorSpelling === prefix,
      `site release path collision at '${prefix}'`,
    )
    canonicalSpellings.set(collisionKey, prefix)
    if (length < segments.length) {
      invariant(!filePaths.has(collisionKey), `site release file/directory topology conflict at '${prefix}'`)
      directoryPaths.add(collisionKey)
    } else {
      invariant(!directoryPaths.has(collisionKey), `site release file/directory topology conflict at '${prefix}'`)
      invariant(!filePaths.has(collisionKey), `site release path collision at '${prefix}'`)
      filePaths.add(collisionKey)
    }
  }
}

function normalizeRelease(value, label) {
  exactKeys(value, ['buildId', 'manifestId'], label)
  invariant(SHA256_ID.test(value.manifestId), `${label}.manifestId is invalid`)
  invariant(SHA256_ID.test(value.buildId), `${label}.buildId is invalid`)
  return { manifestId: value.manifestId, buildId: value.buildId }
}

function normalizeCities(value) {
  exactKeys(value, CITY_IDS, 'site release cities')
  return Object.fromEntries(CITY_IDS.map((cityId) => {
    const label = `site release cities.${cityId}`
    exactKeys(value[cityId], ['basePath', 'buildId', 'manifestId'], label)
    invariant(value[cityId].basePath === CITY_CONTRACTS[cityId].basePath, `${label}.basePath is invalid`)
    const release = normalizeRelease({
      manifestId: value[cityId].manifestId,
      buildId: value[cityId].buildId,
    }, label)
    return [cityId, { basePath: CITY_CONTRACTS[cityId].basePath, ...release }]
  }))
}

function normalizeExpectedReleases(value) {
  if (value === null || value === undefined) return null
  exactKeys(value, CITY_IDS, 'expected site releases')
  return Object.fromEntries(CITY_IDS.map((cityId) => [
    cityId,
    normalizeRelease(value[cityId], `expected site releases.${cityId}`),
  ]))
}

function normalizeControls(value) {
  exactKeys(value, ['noJekyll'], 'site release controls')
  invariant(value.noJekyll === true, 'site release controls.noJekyll must be true')
  return { noJekyll: true }
}

function normalizeFiles(value) {
  invariant(Array.isArray(value), 'site release files must be an array')
  invariant(value.length >= 1 && value.length <= S11_SITE_RELEASE_LIMITS.files, 'site release file count is out of range')
  const files = []
  const canonicalSpellings = new Map()
  const directoryPaths = new Set()
  const filePaths = new Set()
  let previousPath = null
  let totalBytes = 0
  for (const [index, entry] of value.entries()) {
    const label = `site release files[${index}]`
    exactKeys(entry, ['bytes', 'path', 'sha256'], label)
    const filePath = canonicalPath(entry.path, `${label}.path`)
    invariant(previousPath === null || previousPath < filePath, 'site release files must be strictly path-sorted')
    previousPath = filePath
    registerPathTopology({ filePath, canonicalSpellings, directoryPaths, filePaths })
    invariant(
      directoryPaths.size <= S11_SITE_RELEASE_LIMITS.directories,
      'site release directory count is out of range',
    )
    invariant(
      filePaths.size + directoryPaths.size + S11_SITE_RELEASE_EXCLUDED_PATHS.length
        <= S11_SITE_RELEASE_LIMITS.entries,
      'site release entry count is out of range',
    )
    invariant(
      Number.isSafeInteger(entry.bytes)
        && entry.bytes >= 0
        && entry.bytes <= S11_SITE_RELEASE_LIMITS.fileBytes,
      `${label}.bytes is out of range`,
    )
    invariant(typeof entry.sha256 === 'string' && SHA256.test(entry.sha256), `${label}.sha256 is invalid`)
    totalBytes += entry.bytes
    invariant(totalBytes <= S11_SITE_RELEASE_LIMITS.totalBytes, 'site release total bytes exceed the limit')
    files.push({ path: filePath, bytes: entry.bytes, sha256: entry.sha256 })
  }
  return { files, totalBytes }
}

export function calculateS11SiteTreeSha256(files) {
  const normalized = normalizeFiles(files)
  const rows = normalized.files.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`)
  return sha256(Buffer.from(rows.join('\n')))
}

export function calculateS11SiteReleaseId(receipt) {
  const payload = {
    schema: receipt.schema,
    schemaVersion: receipt.schemaVersion,
    sourceCommit: receipt.sourceCommit,
    cities: receipt.cities,
    controls: receipt.controls,
    excludedPaths: receipt.excludedPaths,
    files: receipt.files,
    fileCount: receipt.fileCount,
    totalBytes: receipt.totalBytes,
    treeSha256: receipt.treeSha256,
  }
  return `sha256:${sha256(Buffer.from(stableStringify(payload)))}`
}

export function createS11SiteReleaseReceipt({ sourceCommit, releases, files }) {
  invariant(typeof sourceCommit === 'string' && SOURCE_COMMIT.test(sourceCommit), 'site release sourceCommit is invalid')
  const expectedReleases = normalizeExpectedReleases(releases)
  invariant(expectedReleases !== null, 'site release releases are required')
  const cities = Object.fromEntries(CITY_IDS.map((cityId) => [
    cityId,
    { basePath: CITY_CONTRACTS[cityId].basePath, ...expectedReleases[cityId] },
  ]))
  const normalizedFiles = normalizeFiles(files)
  const receipt = {
    schema: S11_SITE_RELEASE_SCHEMA,
    schemaVersion: S11_SITE_RELEASE_SCHEMA_VERSION,
    sourceCommit,
    cities,
    controls: { ...S11_SITE_RELEASE_CONTROLS },
    excludedPaths: [...S11_SITE_RELEASE_EXCLUDED_PATHS],
    files: normalizedFiles.files,
    fileCount: normalizedFiles.files.length,
    totalBytes: normalizedFiles.totalBytes,
    treeSha256: calculateS11SiteTreeSha256(normalizedFiles.files),
  }
  receipt.releaseId = calculateS11SiteReleaseId(receipt)
  return deepFreeze(receipt)
}

export function verifyS11SiteReleaseReceipt(value, {
  expectedReleaseId = null,
  expectedReleases = null,
  expectedSourceCommit = null,
} = {}) {
  try {
    exactKeys(value, TOP_LEVEL_KEYS, 'site release receipt')
    invariant(value.schema === S11_SITE_RELEASE_SCHEMA, 'site release schema is invalid')
    invariant(value.schemaVersion === S11_SITE_RELEASE_SCHEMA_VERSION, 'site release schemaVersion is invalid')
    invariant(typeof value.sourceCommit === 'string' && SOURCE_COMMIT.test(value.sourceCommit), 'site release sourceCommit is invalid')
    const controls = normalizeControls(value.controls)
    invariant(
      Array.isArray(value.excludedPaths)
        && value.excludedPaths.length === S11_SITE_RELEASE_EXCLUDED_PATHS.length
        && value.excludedPaths.every((entry, index) => entry === S11_SITE_RELEASE_EXCLUDED_PATHS[index]),
      'site release excludedPaths are invalid',
    )
    const cities = normalizeCities(value.cities)
    const normalizedFiles = normalizeFiles(value.files)
    invariant(value.fileCount === normalizedFiles.files.length, 'site release fileCount does not match files')
    invariant(value.totalBytes === normalizedFiles.totalBytes, 'site release totalBytes does not match files')
    const treeSha256 = calculateS11SiteTreeSha256(normalizedFiles.files)
    invariant(value.treeSha256 === treeSha256, 'site release treeSha256 does not match files')
    invariant(typeof value.releaseId === 'string' && SHA256_ID.test(value.releaseId), 'site release releaseId is invalid')
    const normalized = {
      schema: S11_SITE_RELEASE_SCHEMA,
      schemaVersion: S11_SITE_RELEASE_SCHEMA_VERSION,
      sourceCommit: value.sourceCommit,
      cities,
      controls,
      excludedPaths: [...S11_SITE_RELEASE_EXCLUDED_PATHS],
      files: normalizedFiles.files,
      fileCount: normalizedFiles.files.length,
      totalBytes: normalizedFiles.totalBytes,
      treeSha256,
      releaseId: value.releaseId,
    }
    invariant(calculateS11SiteReleaseId(normalized) === value.releaseId, 'site release releaseId does not match contents')
    if (expectedReleaseId !== null) {
      invariant(expectedReleaseId === value.releaseId, 'site release does not match the expected releaseId')
    }
    if (expectedSourceCommit !== null) {
      invariant(SOURCE_COMMIT.test(expectedSourceCommit), 'expected site source commit is invalid')
      invariant(expectedSourceCommit === value.sourceCommit, 'site release does not match the expected source commit')
    }
    const expected = normalizeExpectedReleases(expectedReleases)
    if (expected) {
      for (const cityId of CITY_IDS) {
        invariant(
          expected[cityId].manifestId === cities[cityId].manifestId
            && expected[cityId].buildId === cities[cityId].buildId,
          `site release does not match expected ${cityId} identity`,
        )
      }
    }
    return { ok: true, problems: [], receipt: deepFreeze(normalized) }
  } catch (error) {
    return {
      ok: false,
      problems: [String(error?.message || error)],
      receipt: null,
    }
  }
}

export function s11SitePathIsCanonical(value) {
  try {
    canonicalPath(value)
    return true
  } catch {
    return false
  }
}
