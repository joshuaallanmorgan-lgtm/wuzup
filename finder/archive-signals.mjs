// Keep only the current, bounded signal snapshot for the two supervised
// flagship cities. Git history must never grow by one file per refresh.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { verifyArtifactSet } from './artifact-manifest.mjs'
import { buildSignalSnapshot, compareSignalSnapshots, validateSignalSnapshot } from '../shared/signal-snapshot.mjs'

const INDEX_FILE = 'index.json'
const LATEST_FILE = 'latest.json'
const INDEX_SCHEMA_VERSION = 2
const CITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256 = /^sha256:[a-f0-9]{64}$/
const OWNED_FILES = new Set([INDEX_FILE, LATEST_FILE])

export const SIGNAL_ARCHIVE_POLICY = Object.freeze({
  allowedCities: Object.freeze({
    'tampa-bay': 'America/New_York',
    'sf-east-bay': 'America/Los_Angeles',
  }),
  maxSnapshotBytes: 1_500_000,
  maxIndexBytes: 4_096,
  maxFilesPerCity: 2,
})

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

function atomicWrite(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, contents, { flag: 'wx' })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

function assertPolicy(policy) {
  if (!policy || typeof policy !== 'object' || !policy.allowedCities || typeof policy.allowedCities !== 'object' ||
      !Number.isSafeInteger(policy.maxSnapshotBytes) || policy.maxSnapshotBytes < 1 ||
      !Number.isSafeInteger(policy.maxIndexBytes) || policy.maxIndexBytes < 1 || policy.maxFilesPerCity !== 2) {
    throw new TypeError('signal archive policy is invalid')
  }
}

function validEntry(entry, maxSnapshotBytes) {
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).sort().join(',') === 'buildId,byteLength,contentSha256,file,generatedAt'
    && typeof entry.generatedAt === 'string' && !Number.isNaN(Date.parse(entry.generatedAt))
    && typeof entry.buildId === 'string' && entry.buildId.length > 0
    && SHA256.test(entry.contentSha256 || '')
    && entry.file === LATEST_FILE
    && Number.isSafeInteger(entry.byteLength) && entry.byteLength > 0 && entry.byteLength <= maxSnapshotBytes
}

function assertOwnedHistoryTree(historyBase, policy) {
  if (!existsSync(historyBase)) return
  for (const cityEntry of readdirSync(historyBase, { withFileTypes: true })) {
    if (!cityEntry.isDirectory() || !Object.hasOwn(policy.allowedCities, cityEntry.name)) {
      throw new Error(`REFUSING signal archive: unexpected non-owned history entry '${cityEntry.name}'`)
    }
    const entries = readdirSync(join(historyBase, cityEntry.name), { withFileTypes: true })
    if (entries.length > policy.maxFilesPerCity) {
      throw new Error(`REFUSING signal archive: '${cityEntry.name}' exceeds the ${policy.maxFilesPerCity}-file policy`)
    }
    for (const entry of entries) {
      if (!entry.isFile() || !OWNED_FILES.has(entry.name)) {
        throw new Error(`REFUSING signal archive: unexpected non-owned history file '${cityEntry.name}/${entry.name}'`)
      }
    }
  }
}

export function validateSignalArchiveIndex(index, { cityId, timeZone, policy = SIGNAL_ARCHIVE_POLICY } = {}) {
  assertPolicy(policy)
  const errors = []
  if (!index || typeof index !== 'object' || Array.isArray(index) || index.schemaVersion !== INDEX_SCHEMA_VERSION) errors.push('INDEX_SCHEMA_INVALID')
  if (!CITY_ID.test(String(index?.cityId || ''))) errors.push('INDEX_CITY_INVALID')
  if (cityId && index?.cityId !== cityId) errors.push('INDEX_CITY_MISMATCH')
  if (typeof index?.timeZone !== 'string' || !index.timeZone) errors.push('INDEX_TIME_ZONE_INVALID')
  if (timeZone && index?.timeZone !== timeZone) errors.push('INDEX_TIME_ZONE_MISMATCH')
  if (!validEntry(index?.latest, policy.maxSnapshotBytes)) errors.push('INDEX_LATEST_INVALID')
  if (!index || Object.keys(index).sort().join(',') !== 'cityId,latest,schemaVersion,timeZone') errors.push('INDEX_FIELDS_INVALID')
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() }
}

export function readSignalArchiveIndex(historyRoot, { cityId, timeZone, policy = SIGNAL_ARCHIVE_POLICY } = {}) {
  assertPolicy(policy)
  const path = join(historyRoot, INDEX_FILE)
  if (!existsSync(path)) return null
  if (statSync(path).size > policy.maxIndexBytes) throw new Error(`signal archive index exceeds ${policy.maxIndexBytes} bytes`)
  let index
  try {
    index = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`signal archive index is invalid JSON (${error.message})`)
  }
  const validation = validateSignalArchiveIndex(index, { cityId, timeZone, policy })
  if (!validation.valid) throw new Error(`signal archive index is invalid (${validation.errors.join(', ')})`)
  return index
}

export function readSignalArchiveSnapshot(path, { maxBytes = SIGNAL_ARCHIVE_POLICY.maxSnapshotBytes } = {}) {
  if (statSync(path).size > maxBytes) throw new Error(`signal archive snapshot exceeds ${maxBytes} bytes`)
  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`signal archive snapshot is unreadable (${error.message})`)
  }
  const validation = validateSignalSnapshot(snapshot)
  if (!validation.valid) throw new Error(`signal archive snapshot is invalid (${validation.errors.join(', ')})`)
  return snapshot
}

async function cityTimeZone(repoRoot, cityId) {
  const modulePath = join(repoRoot, 'finder', 'cities', `${cityId}.mjs`)
  try {
    const city = await import(pathToFileURL(modulePath).href)
    if (typeof city.tz !== 'string' || !city.tz) throw new Error('missing tz export')
    return city.tz
  } catch (error) {
    throw new Error(`city '${cityId}' cannot supply an archive timezone (${error.message})`)
  }
}

function entryFor(snapshot, snapshotBytes) {
  return {
    generatedAt: snapshot.generatedAt,
    buildId: snapshot.buildId,
    contentSha256: snapshot.contentSha256,
    file: LATEST_FILE,
    byteLength: Buffer.byteLength(snapshotBytes, 'utf8'),
  }
}

function readCurrentState(historyRoot, { cityId, timeZone, policy }) {
  const indexExists = existsSync(join(historyRoot, INDEX_FILE))
  const latestExists = existsSync(join(historyRoot, LATEST_FILE))
  if (!indexExists && !latestExists) return null
  if (indexExists !== latestExists) {
    throw new Error('REFUSING signal archive: incomplete current archive (latest.json and index.json must coexist)')
  }
  const index = readSignalArchiveIndex(historyRoot, { cityId, timeZone, policy })
  const latestPath = join(historyRoot, LATEST_FILE)
  const snapshot = readSignalArchiveSnapshot(latestPath, { maxBytes: policy.maxSnapshotBytes })
  if (index.latest.contentSha256 !== snapshot.contentSha256 || index.latest.generatedAt !== snapshot.generatedAt ||
      index.latest.buildId !== snapshot.buildId || index.latest.byteLength !== statSync(latestPath).size) {
    throw new Error('REFUSING signal archive: index/latest snapshot identity or byte length mismatch')
  }
  return { index, snapshot }
}

export async function archiveCitySignals({ repoRoot, cityId, timeZone, policy = SIGNAL_ARCHIVE_POLICY } = {}) {
  if (!repoRoot || typeof repoRoot !== 'string') throw new TypeError('repoRoot is required')
  if (!CITY_ID.test(String(cityId || ''))) throw new TypeError('cityId is invalid')
  assertPolicy(policy)
  if (!Object.hasOwn(policy.allowedCities, cityId)) {
    throw new Error(`REFUSING signal archive: city '${cityId}' is not in the repository-history allowlist`)
  }
  const moduleTimeZone = await cityTimeZone(repoRoot, cityId)
  const expectedTimeZone = timeZone || moduleTimeZone
  if (expectedTimeZone !== moduleTimeZone || expectedTimeZone !== policy.allowedCities[cityId]) {
    throw new Error(`REFUSING signal archive: city '${cityId}' timezone does not match repository-history policy`)
  }

  const historyBase = join(repoRoot, 'finder', 'history')
  assertOwnedHistoryTree(historyBase, policy)
  const artifactRoot = join(repoRoot, 'finder', 'output', cityId)
  const checked = verifyArtifactSet({ root: artifactRoot, expectedCityId: cityId, expectedTimeZone })
  if (!checked.ok) throw new Error(`REFUSING signal archive: artifact verification failed (${checked.problems.join(' · ')})`)
  const manifest = checked.manifest
  const events = JSON.parse(readFileSync(join(artifactRoot, 'events.json'), 'utf8'))
  const snapshot = buildSignalSnapshot({ cityId, timeZone: expectedTimeZone, generatedAt: manifest.generatedAt, buildId: manifest.buildId, events })
  const validation = validateSignalSnapshot(snapshot)
  if (!validation.valid) throw new Error(`REFUSING signal archive: snapshot invalid (${validation.errors.join(', ')})`)
  const snapshotBytes = canonicalJson(snapshot)
  if (Buffer.byteLength(snapshotBytes, 'utf8') > policy.maxSnapshotBytes) {
    throw new Error(`REFUSING signal archive: snapshot exceeds ${policy.maxSnapshotBytes} bytes`)
  }

  const historyRoot = join(historyBase, cityId)
  mkdirSync(historyRoot, { recursive: true })
  const current = readCurrentState(historyRoot, { cityId, timeZone: expectedTimeZone, policy })
  const entry = entryFor(snapshot, snapshotBytes)
  if (current && current.index.latest.generatedAt === entry.generatedAt && current.index.latest.buildId === entry.buildId) {
    if (current.index.latest.contentSha256 !== entry.contentSha256 || current.index.latest.byteLength !== entry.byteLength) {
      throw new Error('REFUSING signal archive: conflicting snapshot for identical generatedAt/build identity')
    }
    return { created: false, replaced: false, historyRoot, entry: current.index.latest, snapshot: current.snapshot, comparison: null }
  }

  const comparison = current ? compareSignalSnapshots(current.snapshot, snapshot) : null
  if (comparison && comparison.state !== 'available') {
    throw new Error(`REFUSING signal archive: current snapshot cannot replace latest (${comparison.reasons.join(', ')})`)
  }
  const index = { schemaVersion: INDEX_SCHEMA_VERSION, cityId, timeZone: expectedTimeZone, latest: entry }
  const indexValidation = validateSignalArchiveIndex(index, { cityId, timeZone: expectedTimeZone, policy })
  if (!indexValidation.valid) throw new Error(`REFUSING signal archive: index invalid (${indexValidation.errors.join(', ')})`)
  const indexBytes = canonicalJson(index)
  if (Buffer.byteLength(indexBytes, 'utf8') > policy.maxIndexBytes) {
    throw new Error(`REFUSING signal archive: index exceeds ${policy.maxIndexBytes} bytes`)
  }

  // latest is replaced first and index last as the commit marker. Each write
  // is rename-atomic; an interrupted pair fails closed on the next run.
  atomicWrite(join(historyRoot, LATEST_FILE), snapshotBytes)
  atomicWrite(join(historyRoot, INDEX_FILE), indexBytes)
  return {
    created: true,
    replaced: Boolean(current),
    historyRoot,
    entry,
    snapshot,
    previousSnapshot: current?.snapshot || null,
    comparison,
  }
}

async function main() {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const result = await archiveCitySignals({ repoRoot, cityId: process.env.CITY })
  console.log(`${result.created ? (result.replaced ? 'Replaced' : 'Archived') : 'Archive already contains'} ${result.entry.contentSha256}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
