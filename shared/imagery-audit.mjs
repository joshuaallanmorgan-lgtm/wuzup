import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

export const IMAGERY_FINDING_CODES = Object.freeze({
  EVENT_IMAGE_PROVENANCE_MISSING: 'EVENT_IMAGE_PROVENANCE_MISSING',
  EVENT_IMAGE_DUPLICATE_PRESSURE: 'EVENT_IMAGE_DUPLICATE_PRESSURE',
  PLACE_IMAGE_COVERAGE_LOW: 'PLACE_IMAGE_COVERAGE_LOW',
  LOCAL_IMAGE_REFERENCE_MISSING: 'LOCAL_IMAGE_REFERENCE_MISSING',
  LOCAL_IMAGE_FILE_BROKEN: 'LOCAL_IMAGE_FILE_BROKEN',
  LOCAL_IMAGE_DIMENSION_MISMATCH: 'LOCAL_IMAGE_DIMENSION_MISMATCH',
})

const IMAGE_EXTENSIONS = new Set(['.avif', '.jpeg', '.jpg', '.png', '.webp'])
const LOW_PLACE_COVERAGE = 0.1
const REMOTE_IMAGE = /^(?:https?:)?\/\//i
const LOCAL_PLACE_IMAGE = /^\/place-img\//

const repoPath = (value) => value.replace(/\\/g, '/')
const ratio = (numerator, denominator) => denominator ? Number((numerator / denominator).toFixed(6)) : 0
const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value
const compareText = (a, b) => String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0)

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function artifactRows(raw, key, filePath) {
  const rows = Array.isArray(raw) ? raw : (raw && (raw[key] || raw.items))
  if (!Array.isArray(rows)) throw new Error(`${repoPath(filePath)} does not contain an ${key} array`)
  return rows
}

function imageUrl(row) {
  return typeof row.image === 'string' && row.image.trim() ? row.image : null
}

function hasValue(value) {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return value != null && typeof value === 'object' && Object.keys(value).length > 0
}

function hasImageProvenance(row) {
  return ['imageCredit', 'imageProvenance', 'imageAttribution'].some((key) => hasValue(row[key]))
}

function analyzeImages(rows) {
  const imageRows = rows.filter((row) => imageUrl(row))
  const counts = new Map()
  for (const row of imageRows) {
    const image = imageUrl(row)
    counts.set(image, (counts.get(image) || 0) + 1)
  }
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([image, count]) => ({ image, count }))
    .sort((a, b) => b.count - a.count || compareText(a.image, b.image))
  const duplicateReferenceCount = duplicates.reduce((sum, item) => sum + item.count - 1, 0)
  const selfHosted = imageRows.filter((row) => {
    const image = imageUrl(row)
    return image.startsWith('/') && !image.startsWith('//')
  }).length
  const remote = imageRows.filter((row) => REMOTE_IMAGE.test(imageUrl(row))).length
  const provenanceOrCredit = imageRows.filter(hasImageProvenance).length

  return {
    imageBearing: imageRows.length,
    uniqueImageUrls: counts.size,
    selfHosted,
    remote,
    unknownLocation: imageRows.length - selfHosted - remote,
    provenanceOrCredit,
    missingProvenance: imageRows.length - provenanceOrCredit,
    duplicateUrlCount: duplicates.length,
    duplicateReferenceCount,
    duplicatePressure: ratio(duplicateReferenceCount, imageRows.length),
    duplicates,
  }
}

function resolveLocalImage(outputRoot, image) {
  if (typeof image !== 'string' || !LOCAL_PLACE_IMAGE.test(image)) return null
  const withoutQuery = image.split(/[?#]/, 1)[0]
  let decoded
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    return { image, invalid: true, target: null }
  }
  const localRoot = path.resolve(outputRoot, 'place-img')
  const target = path.resolve(outputRoot, decoded.replace(/^\/+/, '').replace(/\//g, path.sep))
  const insideRoot = target.startsWith(`${localRoot}${path.sep}`)
  return { image, invalid: !insideRoot, target: insideRoot ? target : null }
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

async function inspectImage(filePath) {
  const metadata = await sharp(filePath).metadata()
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    throw new Error('image dimensions are unavailable')
  }
  return { width: metadata.width, height: metadata.height, format: metadata.format || null }
}

async function auditLocalImages({ repoRoot, outputRoot, places, receiptEntries }) {
  const directory = path.join(outputRoot, 'place-img')
  const entries = (await directoryEntries(directory))
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .sort((a, b) => compareText(a.name, b.name))
  const metadataByPath = new Map()
  const brokenByPath = new Map()
  const files = []

  async function inspect(target) {
    const key = pathKey(target)
    if (metadataByPath.has(key)) return metadataByPath.get(key)
    if (brokenByPath.has(key)) return null
    try {
      const metadata = await inspectImage(target)
      metadataByPath.set(key, metadata)
      return metadata
    } catch {
      brokenByPath.set(key, {
        path: repoPath(path.relative(repoRoot, target)),
        error: 'image-metadata-unreadable',
      })
      return null
    }
  }

  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    const metadata = await inspect(target)
    if (metadata) files.push({ path: repoPath(path.relative(repoRoot, target)), ...metadata })
  }

  const references = new Map()
  function addReference(image, consumer) {
    const resolved = resolveLocalImage(outputRoot, image)
    if (!resolved) return
    const key = resolved.target ? pathKey(resolved.target) : `invalid:${image}`
    if (!references.has(key)) {
      references.set(key, {
        image,
        path: resolved.target ? repoPath(path.relative(repoRoot, resolved.target)) : null,
        invalid: resolved.invalid,
        target: resolved.target,
        consumers: [],
      })
    }
    references.get(key).consumers.push(consumer)
  }

  places.forEach((place, index) => addReference(place.image, {
    kind: 'place',
    key: place.key || place.id || `index:${index}`,
  }))
  for (const [key, receipt] of receiptEntries) {
    addReference(receipt && receipt.image, { kind: 'mapillary-receipt', key })
  }

  const missingReferences = []
  const sortedReferences = [...references.values()].sort((a, b) =>
    compareText(a.path || a.image, b.path || b.image))
  for (const reference of sortedReferences) {
    reference.consumers.sort((a, b) => compareText(a.kind, b.kind) || compareText(a.key, b.key))
    if (reference.invalid || !reference.target) {
      missingReferences.push({
        image: reference.image,
        path: reference.path,
        consumers: reference.consumers,
      })
      continue
    }
    try {
      const file = await stat(reference.target)
      if (!file.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' })
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        missingReferences.push({
          image: reference.image,
          path: reference.path,
          consumers: reference.consumers,
        })
        continue
      }
      throw error
    }
    await inspect(reference.target)
  }

  const filePathKeys = new Set(entries.map((entry) => pathKey(path.join(directory, entry.name))))
  const referencedPathKeys = new Set([...references.values()].filter((reference) => reference.target)
    .map((reference) => pathKey(reference.target)))
  const unreferencedFiles = files
    .filter((file) => !referencedPathKeys.has(pathKey(path.resolve(repoRoot, file.path))))
    .map((file) => file.path)
  const dimensionMismatches = []
  let dimensionsChecked = 0

  for (const [key, receipt] of receiptEntries) {
    const resolved = resolveLocalImage(outputRoot, receipt && receipt.image)
    if (!resolved || resolved.invalid || !resolved.target) continue
    const expected = {
      width: Number.isFinite(receipt.width) ? receipt.width : null,
      height: Number.isFinite(receipt.height) ? receipt.height : null,
    }
    if (expected.width == null && expected.height == null) continue
    const actual = metadataByPath.get(pathKey(resolved.target))
    if (!actual) continue
    dimensionsChecked++
    if ((expected.width != null && expected.width !== actual.width) ||
        (expected.height != null && expected.height !== actual.height)) {
      dimensionMismatches.push({
        key,
        image: receipt.image,
        path: repoPath(path.relative(repoRoot, resolved.target)),
        expected,
        actual: { width: actual.width, height: actual.height },
      })
    }
  }

  dimensionMismatches.sort((a, b) => compareText(a.key, b.key))
  const brokenFiles = [...brokenByPath.values()].sort((a, b) => compareText(a.path, b.path))

  return {
    localImages: {
      directory: repoPath(path.relative(repoRoot, directory)),
      fileCount: entries.length,
      readableFileCount: files.length,
      referencedFileCount: [...referencedPathKeys].filter((key) => filePathKeys.has(key)).length,
      referenceCount: references.size,
      missingReferences,
      brokenFiles,
      unreferencedFiles,
      files,
    },
    dimensionsChecked,
    dimensionMismatches,
  }
}

function finding(code, severity, count, message) {
  return { code, severity, count, message }
}

export async function auditCityImagery({ repoRoot, cityId }) {
  if (!repoRoot) throw new Error('repoRoot is required')
  if (!/^[a-z0-9-]+$/.test(cityId || '')) throw new Error('cityId must use lowercase kebab-case')

  const root = path.resolve(repoRoot)
  const outputRoot = path.join(root, 'finder', 'output', cityId)
  const eventsPath = path.join(outputRoot, 'events.json')
  const placesPath = path.join(outputRoot, 'places.json')
  const receiptPath = path.join(root, 'finder', 'cache', cityId, 'place-mapillary-images.json')
  const [eventsRaw, placesRaw] = await Promise.all([readJson(eventsPath), readJson(placesPath)])
  const events = artifactRows(eventsRaw, 'events', eventsPath)
  const places = artifactRows(placesRaw, 'places', placesPath)

  let receiptAvailable = true
  let receiptRaw
  try {
    receiptRaw = await readJson(receiptPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      receiptAvailable = false
      receiptRaw = { byKey: {} }
    } else {
      throw error
    }
  }
  const receiptEntries = Object.entries(receiptRaw && receiptRaw.byKey && typeof receiptRaw.byKey === 'object'
    ? receiptRaw.byKey
    : {}).sort(([a], [b]) => compareText(a, b))

  const eventImages = analyzeImages(events)
  const placeImages = analyzeImages(places)
  const { localImages, dimensionsChecked, dimensionMismatches } = await auditLocalImages({
    repoRoot: root,
    outputRoot,
    places,
    receiptEntries,
  })
  const placeCoverage = ratio(placeImages.imageBearing, places.length)
  const findings = []

  if (eventImages.missingProvenance > 0) {
    findings.push(finding(
      IMAGERY_FINDING_CODES.EVENT_IMAGE_PROVENANCE_MISSING,
      'warning',
      eventImages.missingProvenance,
      `${eventImages.missingProvenance} image-bearing events lack dedicated image provenance or credit`,
    ))
  }
  if (eventImages.duplicateReferenceCount > 0) {
    findings.push(finding(
      IMAGERY_FINDING_CODES.EVENT_IMAGE_DUPLICATE_PRESSURE,
      'warning',
      eventImages.duplicateReferenceCount,
      `${eventImages.duplicateReferenceCount} event image references repeat an already-used URL`,
    ))
  }
  if (places.length > 0 && placeCoverage < LOW_PLACE_COVERAGE) {
    findings.push(finding(
      IMAGERY_FINDING_CODES.PLACE_IMAGE_COVERAGE_LOW,
      'warning',
      places.length - placeImages.imageBearing,
      `place image coverage ${placeCoverage} is below the ${LOW_PLACE_COVERAGE} audit threshold`,
    ))
  }
  if (localImages.missingReferences.length > 0) {
    findings.push(finding(
      IMAGERY_FINDING_CODES.LOCAL_IMAGE_REFERENCE_MISSING,
      'error',
      localImages.missingReferences.length,
      `${localImages.missingReferences.length} local image references do not resolve to files`,
    ))
  }
  if (localImages.brokenFiles.length > 0) {
    findings.push(finding(
      IMAGERY_FINDING_CODES.LOCAL_IMAGE_FILE_BROKEN,
      'error',
      localImages.brokenFiles.length,
      `${localImages.brokenFiles.length} local image files cannot be decoded`,
    ))
  }
  if (dimensionMismatches.length > 0) {
    findings.push(finding(
      IMAGERY_FINDING_CODES.LOCAL_IMAGE_DIMENSION_MISMATCH,
      'warning',
      dimensionMismatches.length,
      `${dimensionMismatches.length} Mapillary receipt dimensions disagree with local files`,
    ))
  }

  return {
    schemaVersion: 1,
    cityId,
    thresholds: { lowPlaceCoverage: LOW_PLACE_COVERAGE },
    events: { total: events.length, ...eventImages },
    places: {
      total: places.length,
      ...placeImages,
      local: placeImages.selfHosted,
      coverage: placeCoverage,
    },
    localImages,
    mapillaryReceipts: {
      available: receiptAvailable,
      path: repoPath(path.relative(root, receiptPath)),
      entryCount: receiptEntries.length,
      localReferenceCount: receiptEntries.filter(([, receipt]) =>
        resolveLocalImage(outputRoot, receipt && receipt.image)).length,
      dimensionsChecked,
      dimensionMismatches,
    },
    findings,
  }
}

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const cityId = process.argv[2]
  const repoRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(path.dirname(modulePath), '..')
  if (!cityId) {
    process.stderr.write('Usage: node shared/imagery-audit.mjs <city-id> [repo-root]\n')
    process.exitCode = 1
  } else {
    try {
      const report = await auditCityImagery({ repoRoot, cityId })
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } catch (error) {
      process.stderr.write(`${String(error && error.message ? error.message : error)}\n`)
      process.exitCode = 1
    }
  }
}
