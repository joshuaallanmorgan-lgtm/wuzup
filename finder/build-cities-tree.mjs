// Compose the current two verified flagship artifact sets into a dark,
// immutable City Foundry tree. This builder has no production destination and
// refuses to replace an existing path. Members publish first, each city
// manifest publishes after its members, and the global cities index publishes
// last. Existing app/public and the current flat deployment remain untouched.
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  MANIFEST_FILE,
  ARTIFACT_SPECS,
  validIso,
} from '../shared/artifact-contract.mjs'
import {
  calculateCitiesIndexId,
  canonicalCitiesIndexJson,
  validateCitiesIndex,
} from '../shared/cities-index.mjs'
import {
  sha256,
  verifyArtifactSet,
} from './artifact-manifest.mjs'

const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const SAFE_IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const WINDOWS_RESERVED = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/i

export const S13_FOUNDRY_LIMITS = Object.freeze({
  artifactBytes: 128 * 1024 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  imageFiles: 4096,
  imageFileBytes: 16 * 1024 * 1024,
  imagePackBytes: 512 * 1024 * 1024,
  indexBytes: 4 * 1024 * 1024,
})

export const S13_FOUNDRY_CITIES = Object.freeze([
  Object.freeze({
    cityId: 'tampa-bay',
    name: 'Tampa Bay',
    shortName: 'Tampa',
    region: 'Florida',
    countryCode: 'US',
    timeZone: 'America/New_York',
    center: Object.freeze({ lat: 27.95, lng: -82.46 }),
    bbox: Object.freeze({ south: 27.3, west: -83.3, north: 28.6, east: -81.9 }),
    coverageTier: 'flagship',
    pathAliases: Object.freeze(['tampa']),
  }),
  Object.freeze({
    cityId: 'sf-east-bay',
    name: 'SF & East Bay',
    shortName: 'SF',
    region: 'California',
    countryCode: 'US',
    timeZone: 'America/Los_Angeles',
    center: Object.freeze({ lat: 37.84, lng: -122.25 }),
    bbox: Object.freeze({ south: 37.68, west: -122.53, north: 38, east: -121.88 }),
    coverageTier: 'flagship',
    pathAliases: Object.freeze(['sf']),
  }),
])

const FALLBACKS = Object.freeze({
  nationwideFloor: Object.freeze({
    fallbackId: 'nationwide-floor',
    name: 'Nationwide floor',
    coverageTier: 'thin',
    countryCode: 'US',
    artifactPack: null,
  }),
  notCovered: Object.freeze({
    fallbackId: 'not-covered',
    name: 'Not covered',
    coverageTier: 'not-covered',
    countryCode: null,
    artifactPack: null,
  }),
})

const US_REGIONS = Object.freeze([
  Object.freeze({
    regionId: 'contiguous-us',
    bbox: Object.freeze({ south: 24.396308, west: -124.848974, north: 49.384358, east: -66.885444 }),
  }),
  Object.freeze({
    regionId: 'alaska',
    bbox: Object.freeze({ south: 51.214183, west: -179.148909, north: 71.365162, east: -129.9795 }),
  }),
  Object.freeze({
    regionId: 'hawaii',
    bbox: Object.freeze({ south: 18.910361, west: -160.2471, north: 22.2356, east: -154.806773 }),
  }),
])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === ''
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function inspectRealDirectory(candidate, label) {
  const resolved = path.resolve(candidate)
  const info = lstatSync(resolved)
  invariant(info.isDirectory() && !info.isSymbolicLink(), `${label} must be a real directory`)
  const real = realpathSync(resolved)
  invariant(path.resolve(real) === resolved, `${label} must not traverse a symlink or junction`)
  return { resolved, real }
}

function directoryIdentity(candidate, label) {
  const inspected = inspectRealDirectory(candidate, label)
  const info = lstatSync(inspected.resolved, { bigint: true })
  return Object.freeze({
    resolved: inspected.resolved,
    real: inspected.real,
    dev: info.dev,
    ino: info.ino,
    mode: info.mode,
  })
}

function sameIdentity(info, identity) {
  return info.dev === identity.dev
    && info.ino === identity.ino
    && info.mode === identity.mode
}

function assertOwnedDirectory(identity, label = 'staging root') {
  const info = lstatSync(identity.resolved, { bigint: true })
  invariant(info.isDirectory() && !info.isSymbolicLink(), `${label} identity changed`)
  invariant(sameIdentity(info, identity), `${label} identity changed`)
  invariant(
    path.resolve(realpathSync(identity.resolved)) === path.resolve(identity.real),
    `${label} became a symlink or junction`,
  )
}

function assertOwnedPath(identity, candidate, label) {
  assertOwnedDirectory(identity)
  const resolved = path.resolve(candidate)
  invariant(inside(identity.resolved, resolved) && resolved !== identity.resolved, `${label} escapes staging root`)
  const relative = path.relative(identity.resolved, path.dirname(resolved))
  let current = identity.resolved
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const info = lstatSync(current)
    invariant(info.isDirectory() && !info.isSymbolicLink(), `${label} ancestor is not a real directory`)
    invariant(path.resolve(realpathSync(current)) === path.resolve(current), `${label} ancestor became a symlink or junction`)
  }
  assertOwnedDirectory(identity)
  return resolved
}

function ensureOwnedDirectory(identity, candidate, label) {
  assertOwnedDirectory(identity)
  const resolved = path.resolve(candidate)
  invariant(inside(identity.resolved, resolved), `${label} escapes staging root`)
  const relative = path.relative(identity.resolved, resolved)
  let current = identity.resolved
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (!existsSync(current)) mkdirSync(current, { recursive: false })
    const info = lstatSync(current)
    invariant(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a real directory`)
    invariant(path.resolve(realpathSync(current)) === path.resolve(current), `${label} became a symlink or junction`)
  }
  assertOwnedDirectory(identity)
  return resolved
}

function cleanupOwnedStaging(identity) {
  if (!identity || !existsSync(identity.resolved)) return
  assertOwnedDirectory(identity, 'cleanup staging root')
  const removeContents = (directory) => {
    while (true) {
      const handle = opendirSync(directory)
      const entries = []
      try {
        let entry
        while (entries.length < 64 && (entry = handle.readSync()) !== null) entries.push(entry.name)
      } finally {
        handle.closeSync()
      }
      if (entries.length === 0) return
      for (const name of entries) {
        assertOwnedDirectory(identity, 'cleanup staging root')
        const candidate = path.join(directory, name)
        invariant(inside(identity.resolved, candidate), 'cleanup member escapes staging root')
        const info = lstatSync(candidate)
        if (info.isSymbolicLink()) {
          unlinkSync(candidate)
          continue
        }
        if (info.isDirectory()) {
          invariant(
            path.resolve(realpathSync(candidate)) === path.resolve(candidate),
            'cleanup directory became a junction',
          )
          removeContents(candidate)
          rmdirSync(candidate)
          continue
        }
        invariant(info.isFile(), 'cleanup member must be a regular file, directory, or removable link')
        unlinkSync(candidate)
      }
    }
  }
  removeContents(identity.resolved)
  assertOwnedDirectory(identity, 'cleanup staging root')
  rmdirSync(identity.resolved)
}

function acquirePublicationClaim(destination, parentRoot) {
  const claimPath = path.join(parentRoot, `.${path.basename(destination)}.claim`)
  const nonce = randomBytes(16).toString('hex')
  const contents = `${JSON.stringify({ schemaVersion: 1, destination, nonce })}\n`
  let descriptor
  try {
    descriptor = openSync(
      claimPath,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (constants.O_NOFOLLOW || 0),
      0o600,
    )
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('a publication claim already exists for destinationRoot')
    throw error
  }
  let info
  try {
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
    info = fstatSync(descriptor, { bigint: true })
  } finally {
    closeSync(descriptor)
  }
  const claim = Object.freeze({
    path: claimPath,
    contents,
    dev: info.dev,
    ino: info.ino,
    mode: info.mode,
  })
  assertPublicationClaim(claim)
  return claim
}

function assertPublicationClaim(claim) {
  const info = lstatSync(claim.path, { bigint: true })
  invariant(info.isFile() && !info.isSymbolicLink(), 'publication claim identity changed')
  invariant(sameIdentity(info, claim), 'publication claim identity changed')
  invariant(path.resolve(realpathSync(claim.path)) === path.resolve(claim.path), 'publication claim became a link')
  invariant(info.size <= 1024n, 'publication claim exceeds its byte limit')
  invariant(readFileSync(claim.path, 'utf8') === claim.contents, 'publication claim contents changed')
}

function releasePublicationClaim(claim) {
  if (!claim || !existsSync(claim.path)) return
  assertPublicationClaim(claim)
  unlinkSync(claim.path)
}

function inspectSourceFile(root, candidate, label, maximumBytes = null) {
  const resolved = path.resolve(candidate)
  invariant(inside(root, resolved) && resolved !== root, `${label} escapes its city root`)
  const info = lstatSync(resolved, { bigint: true })
  invariant(info.isFile() && !info.isSymbolicLink(), `${label} must be a regular file`)
  if (maximumBytes !== null) {
    invariant(
      info.size >= 0n && info.size <= BigInt(maximumBytes),
      `${label} exceeds its byte limit`,
    )
  }
  const real = realpathSync(resolved)
  invariant(inside(root, real), `${label} resolves outside its city root`)
  return { resolved, info }
}

function sameFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

function copyStableFile(sourceRoot, source, destination, label, stagingIdentity, maximumBytes) {
  const inspected = inspectSourceFile(sourceRoot, source, label, maximumBytes)
  ensureOwnedDirectory(stagingIdentity, path.dirname(destination), `${label} destination directory`)
  const target = assertOwnedPath(stagingIdentity, destination, `${label} destination`)
  invariant(!existsSync(target), `${label} destination already exists`)
  copyFileSync(inspected.resolved, target, constants.COPYFILE_EXCL)
  const after = lstatSync(inspected.resolved, { bigint: true })
  invariant(sameFile(inspected.info, after), `${label} changed while composing the city tree`)
  assertOwnedPath(stagingIdentity, target, `${label} destination`)
  const destinationInfo = lstatSync(target, { bigint: true })
  invariant(destinationInfo.isFile() && !destinationInfo.isSymbolicLink(), `${label} destination is not a regular file`)
  invariant(destinationInfo.nlink === 1n, `${label} destination must have exactly one link`)
  invariant(destinationInfo.size === inspected.info.size, `${label} destination byte count changed`)
  invariant(path.resolve(realpathSync(target)) === path.resolve(target), `${label} destination became a symlink or junction`)
}

function normalizePublicPath(value) {
  invariant(typeof value === 'string' && value.startsWith('/') && !value.startsWith('//'), 'publicPath must be root-relative')
  invariant(!/[\\?#\s\u0000-\u001f\u007f]/.test(value), 'publicPath contains unsafe characters')
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new Error('publicPath contains invalid encoding')
  }
  invariant(decoded === value, 'publicPath must not contain encoded path segments')
  const normalized = value.replace(/\/+$/, '')
  const segments = normalized.split('/').slice(1)
  invariant(segments.length >= 1 && !segments.some(segment => !segment || segment === '.' || segment === '..'), 'publicPath is unsafe')
  invariant(segments.at(-1) === 'cities', "publicPath must end in '/cities'")
  return normalized
}

function normalizeGeneratedAt(value, manifests) {
  const latestAssembly = Math.max(...manifests.map(manifest => Date.parse(manifest.assembledAt)))
  invariant(Number.isFinite(latestAssembly), 'city manifests require valid assembledAt timestamps')
  const generatedAt = value ?? new Date(latestAssembly).toISOString()
  invariant(validIso(generatedAt), 'generatedAt must be a canonical ISO timestamp')
  invariant(Date.parse(generatedAt) >= latestAssembly, 'index generatedAt must not predate a city manifest assembly')
  for (const manifest of manifests) {
    invariant(Date.parse(generatedAt) >= Date.parse(manifest.generatedAt), 'index generatedAt must not predate city data')
  }
  return generatedAt
}

function safeReleaseId(manifest) {
  invariant(SHA256_ID.test(String(manifest.manifestId || '')), 'city manifestId is malformed')
  return manifest.manifestId.slice('sha256:'.length)
}

function imageFiles(cityRoot) {
  const imageRoot = path.join(cityRoot, 'place-img')
  const inspected = inspectRealDirectory(imageRoot, 'place-img source')
  invariant(inside(cityRoot, inspected.real), 'place-img source escapes its city root')
  const spellings = new Map()
  const names = []
  const bytesByName = {}
  let totalBytes = 0
  let directoryEntries = 0
  const directory = opendirSync(inspected.resolved)
  try {
    let entry
    while ((entry = directory.readSync()) !== null) {
      directoryEntries += 1
      invariant(
        directoryEntries <= S13_FOUNDRY_LIMITS.imageFiles + 1,
        'place-img source exceeds its directory-entry limit',
      )
      if (entry.name === '.gitkeep') {
        const marker = inspectSourceFile(cityRoot, path.join(inspected.resolved, entry.name), 'place-img/.gitkeep', 0)
        invariant(marker.info.size === 0n, 'place-img/.gitkeep must be empty')
        continue
      }
      invariant(!entry.name.startsWith('.'), `place-img/${entry.name} is an unsupported hidden member`)
      invariant(entry.isFile() && !entry.isSymbolicLink(), `place-img/${entry.name} must be a regular file`)
      invariant(
        SAFE_IMAGE_NAME.test(entry.name)
          && entry.name !== '.'
          && entry.name !== '..'
          && !entry.name.endsWith('.')
          && !WINDOWS_RESERVED.test(entry.name),
        `place-img/${entry.name} is unsafe`,
      )
      const key = entry.name.toLowerCase()
      invariant(!spellings.has(key), `place-img path collision between '${spellings.get(key)}' and '${entry.name}'`)
      spellings.set(key, entry.name)
      const image = inspectSourceFile(
        cityRoot,
        path.join(inspected.resolved, entry.name),
        `place-img/${entry.name}`,
        S13_FOUNDRY_LIMITS.imageFileBytes,
      )
      names.push(entry.name)
      bytesByName[entry.name] = Number(image.info.size)
      invariant(names.length <= S13_FOUNDRY_LIMITS.imageFiles, 'place-img source exceeds its file-count limit')
      totalBytes += Number(image.info.size)
      invariant(
        Number.isSafeInteger(totalBytes) && totalBytes <= S13_FOUNDRY_LIMITS.imagePackBytes,
        'place-img source exceeds its aggregate byte limit',
      )
    }
  } finally {
    directory.closeSync()
  }
  names.sort()
  return Object.freeze({
    names: Object.freeze(names),
    bytesByName: Object.freeze(bytesByName),
    totalBytes,
  })
}

function readVerifiedCities(sourceRoot) {
  return S13_FOUNDRY_CITIES.map((city) => {
    const cityRoot = path.join(sourceRoot, city.cityId)
    const inspected = inspectRealDirectory(cityRoot, `${city.cityId} source`)
    invariant(inside(sourceRoot, inspected.real), `${city.cityId} source escapes sourceRoot`)
    for (const spec of Object.values(ARTIFACT_SPECS)) {
      inspectSourceFile(
        inspected.real,
        path.join(inspected.resolved, spec.file),
        `${city.cityId}/${spec.file}`,
        S13_FOUNDRY_LIMITS.artifactBytes,
      )
    }
    const manifestFile = inspectSourceFile(
      inspected.real,
      path.join(inspected.resolved, MANIFEST_FILE),
      `${city.cityId}/${MANIFEST_FILE}`,
      S13_FOUNDRY_LIMITS.manifestBytes,
    )
    const images = imageFiles(inspected.real)
    const checked = verifyArtifactSet({
      root: inspected.resolved,
      expectedCityId: city.cityId,
      expectedTimeZone: city.timeZone,
    })
    invariant(checked.ok && checked.manifest, `${city.cityId} source artifacts are untrusted: ${checked.problems.join(' | ')}`)
    invariant(checked.manifest.shards.length === 0, `${city.cityId} source manifest contains unsupported internal shards`)
    invariant(checked.manifest.placeImages.count === images.names.length, `${city.cityId} image count changed during verification`)
    invariant(checked.manifest.placeImages.bytes === images.totalBytes, `${city.cityId} image bytes changed during verification`)
    return {
      city,
      root: inspected.real,
      manifest: checked.manifest,
      manifestBytes: Number(manifestFile.info.size),
      images,
    }
  })
}

function artifactPack(city, manifest, publicPath) {
  const releaseId = safeReleaseId(manifest)
  const releaseUrl = `${publicPath}/${city.cityId}/releases/${releaseId}`
  const shards = Object.entries(ARTIFACT_SPECS).map(([kind, spec]) => {
    const entry = manifest.artifacts[kind]
    invariant(entry.file === spec.file, `${city.cityId} ${kind} manifest filename drifted`)
    return {
      kind,
      url: `${releaseUrl}/${spec.file}`,
      sha256: `sha256:${entry.sha256}`,
      bytes: entry.bytes,
      count: entry.count,
    }
  })
  return {
    manifestUrl: `${releaseUrl}/${MANIFEST_FILE}`,
    manifestId: manifest.manifestId,
    buildId: manifest.buildId,
    generatedAt: manifest.generatedAt,
    expiresAt: manifest.expiresAt,
    counts: Object.fromEntries(shards.map(shard => [shard.kind, shard.count])),
    sourceHealth: manifest.sourceHealth.status,
    shards,
  }
}

function cityIndexEntry(release, publicPath) {
  const { city, manifest } = release
  return {
    cityId: city.cityId,
    name: city.name,
    shortName: city.shortName,
    region: city.region,
    countryCode: city.countryCode,
    timeZone: city.timeZone,
    center: { ...city.center },
    bbox: { ...city.bbox },
    coverageTier: city.coverageTier,
    pathAliases: [...city.pathAliases],
    artifactPack: artifactPack(city, manifest, publicPath),
  }
}

function buildIndex(releases, { generatedAt, publicPath }) {
  const index = {
    schemaVersion: 1,
    generatedAt,
    indexId: `sha256:${'0'.repeat(64)}`,
    defaultCityId: 'tampa-bay',
    cities: releases.map(release => cityIndexEntry(release, publicPath)),
    fallbacks: {
      nationwideFloor: { ...FALLBACKS.nationwideFloor },
      notCovered: { ...FALLBACKS.notCovered },
    },
    usRegions: US_REGIONS.map(region => ({ regionId: region.regionId, bbox: { ...region.bbox } })),
  }
  index.indexId = calculateCitiesIndexId(index)
  validateCitiesIndex(index)
  return index
}

function publishRelease({ release, destinationRoot, stagingIdentity, onPublish, failAfter }) {
  const { city, root, manifest, images } = release
  const releaseId = safeReleaseId(manifest)
  const destination = path.join(destinationRoot, city.cityId, 'releases', releaseId)
  ensureOwnedDirectory(stagingIdentity, destination, `${city.cityId} release directory`)
  for (const spec of Object.values(ARTIFACT_SPECS)) {
    copyStableFile(
      root,
      path.join(root, spec.file),
      path.join(destination, spec.file),
      `${city.cityId}/${spec.file}`,
      stagingIdentity,
      S13_FOUNDRY_LIMITS.artifactBytes,
    )
    onPublish?.(Object.freeze({ phase: 'member', cityId: city.cityId, path: spec.file }))
    if (failAfter === `${city.cityId}:${spec.file}`) throw new Error(`injected interruption after ${city.cityId}:${spec.file}`)
  }
  ensureOwnedDirectory(stagingIdentity, path.join(destination, 'place-img'), `${city.cityId} image directory`)
  for (const name of images.names) {
    copyStableFile(
      root,
      path.join(root, 'place-img', name),
      path.join(destination, 'place-img', name),
      `${city.cityId}/place-img/${name}`,
      stagingIdentity,
      S13_FOUNDRY_LIMITS.imageFileBytes,
    )
    onPublish?.(Object.freeze({ phase: 'member', cityId: city.cityId, path: `place-img/${name}` }))
  }
  onPublish?.(Object.freeze({ phase: 'members-complete', cityId: city.cityId, path: null }))
  if (failAfter === `${city.cityId}:members`) throw new Error(`injected interruption after ${city.cityId}:members`)

  copyStableFile(
    root,
    path.join(root, MANIFEST_FILE),
    path.join(destination, MANIFEST_FILE),
    `${city.cityId}/${MANIFEST_FILE}`,
    stagingIdentity,
    S13_FOUNDRY_LIMITS.manifestBytes,
  )
  assertOwnedDirectory(stagingIdentity)
  assertExactBoundedTree(stagingIdentity, destination, expectedReleaseTree(release))
  const checked = verifyArtifactSet({
    root: destination,
    expectedCityId: city.cityId,
    expectedTimeZone: city.timeZone,
  })
  invariant(checked.ok, `${city.cityId} composed release failed verification: ${checked.problems.join(' | ')}`)
  invariant(checked.manifest.manifestId === manifest.manifestId, `${city.cityId} composed manifest identity changed`)
  invariant(checked.manifest.buildId === manifest.buildId, `${city.cityId} composed build identity changed`)
  onPublish?.(Object.freeze({ phase: 'manifest', cityId: city.cityId, path: MANIFEST_FILE }))
  if (failAfter === `${city.cityId}:manifest`) throw new Error(`injected interruption after ${city.cityId}:manifest`)
}

function receiptForFile(stagingIdentity, stagingRoot, file, maximumBytes, label) {
  const target = assertOwnedPath(stagingIdentity, file, label)
  const before = lstatSync(target, { bigint: true })
  invariant(before.isFile() && !before.isSymbolicLink(), `${label} is not a regular file`)
  invariant(before.nlink === 1n, `${label} must have exactly one link`)
  invariant(before.size <= BigInt(maximumBytes), `${label} exceeds its byte limit`)
  const bytes = readFileSync(target)
  const after = lstatSync(target, { bigint: true })
  invariant(sameFile(before, after), `${label} changed while creating the receipt`)
  return Object.freeze({
    path: path.relative(stagingRoot, target).replaceAll(path.sep, '/'),
    bytes: bytes.length,
    sha256: `sha256:${sha256(bytes)}`,
  })
}

function buildCompositionReceipt(stagingIdentity, stagingRoot, releases, indexBytes) {
  const files = []
  for (const release of releases) {
    const releaseId = safeReleaseId(release.manifest)
    const root = path.join(stagingRoot, release.city.cityId, 'releases', releaseId)
    for (const spec of Object.values(ARTIFACT_SPECS)) {
      files.push(receiptForFile(
        stagingIdentity,
        stagingRoot,
        path.join(root, spec.file),
        S13_FOUNDRY_LIMITS.artifactBytes,
        `${release.city.cityId}/${spec.file}`,
      ))
    }
    for (const name of release.images.names) {
      files.push(receiptForFile(
        stagingIdentity,
        stagingRoot,
        path.join(root, 'place-img', name),
        S13_FOUNDRY_LIMITS.imageFileBytes,
        `${release.city.cityId}/place-img/${name}`,
      ))
    }
    files.push(receiptForFile(
      stagingIdentity,
      stagingRoot,
      path.join(root, MANIFEST_FILE),
      S13_FOUNDRY_LIMITS.manifestBytes,
      `${release.city.cityId}/${MANIFEST_FILE}`,
    ))
  }
  files.push(receiptForFile(
    stagingIdentity,
    stagingRoot,
    path.join(stagingRoot, 'index.json'),
    S13_FOUNDRY_LIMITS.indexBytes,
    'index.json',
  ))
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return Object.freeze({
    files: Object.freeze(files),
    indexSha256: `sha256:${sha256(indexBytes)}`,
  })
}

function validateWrittenIndex(identity, root, intendedIndex) {
  const indexPath = assertOwnedPath(identity, path.join(root, 'index.json'), 'index.json')
  const info = lstatSync(indexPath, { bigint: true })
  invariant(info.isFile() && !info.isSymbolicLink(), 'index.json is not a regular file')
  invariant(info.nlink === 1n, 'index.json must have exactly one link')
  invariant(info.size <= BigInt(S13_FOUNDRY_LIMITS.indexBytes), 'index.json exceeds its byte limit')
  const bytes = readFileSync(indexPath)
  const published = JSON.parse(bytes.toString('utf8'))
  validateCitiesIndex(published)
  invariant(
    canonicalCitiesIndexJson(published) === canonicalCitiesIndexJson(intendedIndex)
      && published.indexId === intendedIndex.indexId,
    'published index canonical contents changed',
  )
  return bytes
}

function sameReceipt(left, right) {
  return left.indexSha256 === right.indexSha256
    && left.files.length === right.files.length
    && left.files.every((file, index) => {
      const other = right.files[index]
      return file.path === other.path && file.bytes === other.bytes && file.sha256 === other.sha256
    })
}

function addReleasePaths(expected, release, releaseRoot = '') {
  const imageRoot = releaseRoot ? `${releaseRoot}/place-img` : 'place-img'
  expected.directories.add(imageRoot)
  for (const [kind, spec] of Object.entries(ARTIFACT_SPECS)) {
    const relative = releaseRoot ? `${releaseRoot}/${spec.file}` : spec.file
    expected.files.set(relative, Object.freeze({
      expectedBytes: release.manifest.artifacts[kind].bytes,
      maximumBytes: S13_FOUNDRY_LIMITS.artifactBytes,
      imagePackId: null,
    }))
  }
  for (const name of release.images.names) {
    expected.files.set(`${imageRoot}/${name}`, Object.freeze({
      expectedBytes: release.images.bytesByName[name],
      maximumBytes: S13_FOUNDRY_LIMITS.imageFileBytes,
      imagePackId: release.city.cityId,
    }))
  }
  const manifestPath = releaseRoot ? `${releaseRoot}/${MANIFEST_FILE}` : MANIFEST_FILE
  expected.files.set(manifestPath, Object.freeze({
    expectedBytes: release.manifestBytes,
    maximumBytes: S13_FOUNDRY_LIMITS.manifestBytes,
    imagePackId: null,
  }))
  expected.imagePacks.set(release.city.cityId, Object.freeze({
    count: release.images.names.length,
    bytes: release.images.totalBytes,
  }))
}

function expectedReleaseTree(release) {
  const expected = { files: new Map(), directories: new Set(), imagePacks: new Map() }
  addReleasePaths(expected, release)
  return expected
}

function expectedCompositionTree(releases, indexBytes) {
  const expected = {
    files: new Map([['index.json', Object.freeze({
      expectedBytes: indexBytes,
      maximumBytes: S13_FOUNDRY_LIMITS.indexBytes,
      imagePackId: null,
    })]]),
    directories: new Set(),
    imagePacks: new Map(),
  }
  for (const release of releases) {
    const releaseId = safeReleaseId(release.manifest)
    const cityRoot = release.city.cityId
    const releasesRoot = `${cityRoot}/releases`
    const releaseRoot = `${releasesRoot}/${releaseId}`
    for (const directory of [cityRoot, releasesRoot, releaseRoot]) expected.directories.add(directory)
    addReleasePaths(expected, release, releaseRoot)
  }
  return expected
}

function assertExactBoundedTree(identity, root, expected) {
  const seenFiles = new Set()
  const seenDirectories = new Set()
  const imageTotals = new Map(
    [...expected.imagePacks].map(([packId]) => [packId, { count: 0, bytes: 0n }]),
  )
  const maximumMembers = expected.files.size + expected.directories.size
  let visitedMembers = 0
  const visit = (directory) => {
    assertOwnedDirectory(identity)
    const handle = opendirSync(directory)
    try {
      let entry
      while ((entry = handle.readSync()) !== null) {
        visitedMembers += 1
        const candidate = path.join(directory, entry.name)
        const relative = path.relative(root, candidate).replaceAll(path.sep, '/')
        invariant(!relative.startsWith('../') && relative !== '..', 'composition member escapes its root')
        const info = lstatSync(candidate, { bigint: true })
        invariant(!info.isSymbolicLink(), `composition member '${relative}' must not be a link`)
        if (info.isDirectory()) {
          invariant(expected.directories.has(relative), `unexpected composition directory '${relative}'`)
          invariant(visitedMembers <= maximumMembers, 'composition exceeds its member-count limit')
          invariant(
            path.resolve(realpathSync(candidate)) === path.resolve(candidate),
            `composition directory '${relative}' became a junction`,
          )
          seenDirectories.add(relative)
          visit(candidate)
          continue
        }
        invariant(info.isFile(), `composition member '${relative}' must be a regular file`)
        const fileContract = expected.files.get(relative)
        invariant(fileContract, `unexpected composition file '${relative}'`)
        invariant(visitedMembers <= maximumMembers, 'composition exceeds its member-count limit')
        invariant(info.nlink === 1n, `composition file '${relative}' must have exactly one link`)
        invariant(
          info.size <= BigInt(fileContract.maximumBytes),
          `composition file '${relative}' exceeds its byte limit`,
        )
        invariant(
          info.size === BigInt(fileContract.expectedBytes),
          `composition file '${relative}' does not match its expected byte count`,
        )
        if (fileContract.imagePackId) {
          const total = imageTotals.get(fileContract.imagePackId)
          invariant(total, `composition file '${relative}' has no image-pack contract`)
          total.count += 1
          total.bytes += info.size
          invariant(total.count <= S13_FOUNDRY_LIMITS.imageFiles, 'composition image pack exceeds its file-count limit')
          invariant(
            total.bytes <= BigInt(S13_FOUNDRY_LIMITS.imagePackBytes),
            'composition image pack exceeds its aggregate byte limit',
          )
        }
        seenFiles.add(relative)
      }
    } finally {
      handle.closeSync()
    }
  }
  visit(root)
  invariant(seenFiles.size === expected.files.size, 'composition is missing an expected file')
  invariant(seenDirectories.size === expected.directories.size, 'composition is missing an expected directory')
  for (const [packId, contract] of expected.imagePacks) {
    const total = imageTotals.get(packId)
    invariant(total.count === contract.count, `${packId} composition image count changed`)
    invariant(total.bytes === BigInt(contract.bytes), `${packId} composition image bytes changed`)
  }
}

function assertExactCompositionTree(identity, root, releases, indexBytes) {
  assertExactBoundedTree(identity, root, expectedCompositionTree(releases, indexBytes))
}

function verifyComposedReleases(identity, root, releases, indexBytes) {
  assertExactCompositionTree(identity, root, releases, indexBytes)
  for (const release of releases) {
    const releaseId = safeReleaseId(release.manifest)
    const checked = verifyArtifactSet({
      root: path.join(root, release.city.cityId, 'releases', releaseId),
      expectedCityId: release.city.cityId,
      expectedTimeZone: release.city.timeZone,
    })
    invariant(checked.ok, `${release.city.cityId} composed release changed: ${checked.problems.join(' | ')}`)
    invariant(checked.manifest.manifestId === release.manifest.manifestId, `${release.city.cityId} manifest identity changed`)
    invariant(checked.manifest.buildId === release.manifest.buildId, `${release.city.cityId} build identity changed`)
  }
}

export function buildCitiesTree({
  sourceRoot,
  destinationRoot,
  publicPath = '/cities',
  generatedAt = null,
  failAfter = null,
  onPublish = null,
} = {}) {
  invariant(typeof sourceRoot === 'string' && sourceRoot.length > 0, 'sourceRoot is required')
  invariant(typeof destinationRoot === 'string' && destinationRoot.length > 0, 'destinationRoot is required')
  invariant(onPublish === null || typeof onPublish === 'function', 'onPublish must be a function')
  const source = inspectRealDirectory(sourceRoot, 'sourceRoot')
  const destination = path.resolve(destinationRoot)
  invariant(!existsSync(destination), 'destinationRoot must not already exist')
  const parent = inspectRealDirectory(path.dirname(destination), 'destinationRoot parent')
  invariant(inside(parent.real, destination) && destination !== parent.real, 'destinationRoot escapes its parent')
  invariant(!inside(source.real, destination), 'destinationRoot must not be inside sourceRoot')
  const normalizedPublicPath = normalizePublicPath(publicPath)
  const releases = readVerifiedCities(source.real)
  const indexGeneratedAt = normalizeGeneratedAt(generatedAt, releases.map(release => release.manifest))
  const index = buildIndex(releases, {
    generatedAt: indexGeneratedAt,
    publicPath: normalizedPublicPath,
  })

  const claim = acquirePublicationClaim(destination, parent.real)
  let stagingIdentity = null
  let committed = false
  let intendedIndexBytes
  let receipt
  try {
    assertPublicationClaim(claim)
    invariant(!existsSync(destination), 'destinationRoot appeared after acquiring its publication claim')
    const staging = mkdtempSync(path.join(parent.real, `.${path.basename(destination)}.staging-`))
    stagingIdentity = directoryIdentity(staging, 'staging root')
    const indexPath = path.join(stagingIdentity.resolved, 'index.json')
    for (const release of releases) {
      publishRelease({
        release,
        destinationRoot: stagingIdentity.resolved,
        stagingIdentity,
        onPublish,
        failAfter,
      })
    }
    if (failAfter === 'before-index') throw new Error('injected interruption before index')
    assertOwnedDirectory(stagingIdentity)
    intendedIndexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8')
    invariant(intendedIndexBytes.length <= S13_FOUNDRY_LIMITS.indexBytes, 'index.json exceeds its byte limit')
    writeFileSync(indexPath, intendedIndexBytes, { flag: 'wx' })
    assertOwnedPath(stagingIdentity, indexPath, 'index.json')
    verifyComposedReleases(stagingIdentity, stagingIdentity.resolved, releases, intendedIndexBytes.length)
    const indexBytes = validateWrittenIndex(stagingIdentity, stagingIdentity.resolved, index)
    invariant(indexBytes.equals(intendedIndexBytes), 'published index bytes changed')
    receipt = buildCompositionReceipt(stagingIdentity, stagingIdentity.resolved, releases, indexBytes)
    onPublish?.(Object.freeze({ phase: 'index', cityId: null, path: 'index.json' }))
    if (failAfter === 'after-index' || failAfter === 'before-commit') {
      throw new Error(`injected interruption ${failAfter}`)
    }
    assertOwnedDirectory(stagingIdentity)
    verifyComposedReleases(stagingIdentity, stagingIdentity.resolved, releases, intendedIndexBytes.length)
    const finalIndexBytes = validateWrittenIndex(stagingIdentity, stagingIdentity.resolved, index)
    const finalReceipt = buildCompositionReceipt(
      stagingIdentity,
      stagingIdentity.resolved,
      releases,
      finalIndexBytes,
    )
    invariant(sameReceipt(receipt, finalReceipt), 'staged composition changed before commit')
    assertPublicationClaim(claim)
    invariant(!existsSync(destination), 'destinationRoot appeared before commit')
    renameSync(stagingIdentity.resolved, destination)
    committed = true
  } catch (error) {
    if (!committed && stagingIdentity) cleanupOwnedStaging(stagingIdentity)
    if (!committed) releasePublicationClaim(claim)
    throw error
  }

  const committedIdentity = Object.freeze({ ...stagingIdentity, resolved: destination, real: destination })
  assertOwnedDirectory(committedIdentity, 'committed destination')
  verifyComposedReleases(committedIdentity, destination, releases, intendedIndexBytes.length)
  const committedIndexBytes = validateWrittenIndex(committedIdentity, destination, index)
  const committedReceipt = buildCompositionReceipt(committedIdentity, destination, releases, committedIndexBytes)
  invariant(sameReceipt(receipt, committedReceipt), 'committed composition changed')
  if (failAfter === 'after-commit') throw new Error('injected interruption after-commit')
  onPublish?.(Object.freeze({ phase: 'committed', cityId: null, path: null }))
  verifyComposedReleases(committedIdentity, destination, releases, intendedIndexBytes.length)
  const returnedIndexBytes = validateWrittenIndex(committedIdentity, destination, index)
  const returnedReceipt = buildCompositionReceipt(committedIdentity, destination, releases, returnedIndexBytes)
  invariant(sameReceipt(receipt, returnedReceipt), 'committed composition changed before return')
  releasePublicationClaim(claim)
  return Object.freeze({
    destinationRoot: destination,
    index,
    files: receipt.files,
    indexSha256: receipt.indexSha256,
  })
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  try {
    const result = buildCitiesTree({
      sourceRoot: process.argv[2],
      destinationRoot: process.argv[3],
      publicPath: process.argv[4] || '/cities',
      generatedAt: process.argv[5] || null,
    })
    process.stdout.write(`index_id=${result.index.indexId}\n`)
  } catch (error) {
    process.stderr.write(`build-cities-tree: ${error.message || error}\n`)
    process.exitCode = 1
  }
}
