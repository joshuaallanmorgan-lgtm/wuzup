import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  hasMapillaryGuardSignals,
  mapillaryCropFailsClosed,
  normalizeMapillaryCropGuard,
} from '../finder/mapillary-contract.mjs'
import {
  auditCityImagery,
  IMAGERY_FINDING_CODES,
} from '../shared/imagery-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMAGE_EXTENSIONS = new Set(['.avif', '.jpeg', '.jpg', '.png', '.webp'])
const PINNED_ARTIFACTS = {
  'tampa-bay': {
    buildId: 'sha256:65a75e81823893d24051e99387364d1b1ab450be748f6dc58cc58c14d61d5381',
    events: 'a8df0d0cefb461c6e417092b42de20067cf4f1bfb68314e5e91c4f70f875d090',
    places: '749eed658f2df7c8f9d175391ba06518c7b88168f4e27afab0a63ff647e3a57b',
    receipt: 'dae5b0c8b13b4bfe74db98640a2d82569222a360649e02290af744d70d0fc31b',
  },
  'sf-east-bay': {
    buildId: 'sha256:df88fafec557c009b195a845332273f006a074fc12dbe0d97292777e0a1bd4cb',
    events: '84981a8ec48f0245e23e168fb63bc2071cceb5e1eda4e115828264a92873b1d8',
    places: '1f42b49ee860b3ad2a5a887192eaa0b77689ab457f4671b28bdda85c4a39ad78',
    receipt: null,
  },
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function sha256CanonicalLfText(filePath) {
  const text = await readFile(filePath, 'utf8')
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex')
}

async function readRows(cityId, artifact) {
  const raw = JSON.parse(await readFile(path.join(ROOT, 'finder', 'output', cityId, `${artifact}.json`), 'utf8'))
  return Array.isArray(raw) ? raw : (raw[artifact] || raw.items || [])
}

async function localImageFiles(cityId) {
  const directory = path.join(ROOT, 'finder', 'output', cityId, 'place-img')
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
}

test('current Mapillary guard fields normalize and take precedence over legacy fields', () => {
  const crop = {
    isDirectoryOrPylon: false,
    cafeIsDominantSubject: true,
    otherBusinessNameOnSign: null,
    rjPylon: true,
    rjDominant: false,
    rjOtherBiz: 'Different Business',
  }

  assert.deepEqual(normalizeMapillaryCropGuard(crop), {
    isDirectoryOrPylon: false,
    cafeIsDominantSubject: true,
    otherBusinessNameOnSign: null,
  })
  assert.equal(hasMapillaryGuardSignals(crop), true)
  assert.equal(mapillaryCropFailsClosed(crop), false)
})

test('legacy Mapillary guard fields remain compatible', () => {
  const crop = { rjPylon: false, rjDominant: true, rjOtherBiz: null }

  assert.deepEqual(normalizeMapillaryCropGuard(crop), {
    isDirectoryOrPylon: false,
    cafeIsDominantSubject: true,
    otherBusinessNameOnSign: null,
  })
  assert.equal(hasMapillaryGuardSignals(crop), true)
  assert.equal(mapillaryCropFailsClosed(crop), false)
})

test('missing or invalid boolean Mapillary guard signals fail closed', () => {
  assert.equal(hasMapillaryGuardSignals({ isDirectoryOrPylon: false }), false)
  assert.equal(mapillaryCropFailsClosed({ isDirectoryOrPylon: false }), true)
  assert.equal(mapillaryCropFailsClosed({
    isDirectoryOrPylon: undefined,
    cafeIsDominantSubject: true,
    rjPylon: false,
  }), true)
})

test('a directory or pylon crop fails the guard', () => {
  assert.equal(mapillaryCropFailsClosed({
    isDirectoryOrPylon: true,
    cafeIsDominantSubject: true,
    otherBusinessNameOnSign: null,
  }), true)
})

test('a non-dominant cafe with a named conflicting business fails the guard', () => {
  assert.equal(mapillaryCropFailsClosed({
    isDirectoryOrPylon: false,
    cafeIsDominantSubject: false,
    otherBusinessNameOnSign: 'La Casa Tattoo',
  }), true)
})

test('a non-dominant cafe without a named conflict is not automatically dropped', () => {
  for (const otherBusinessNameOnSign of [null, '', 'none', 'N/A']) {
    assert.equal(mapillaryCropFailsClosed({
      isDirectoryOrPylon: false,
      cafeIsDominantSubject: false,
      otherBusinessNameOnSign,
    }), false)
  }
})

test('the documented Tampa and SF artifact snapshots are pinned', async () => {
  for (const [cityId, pin] of Object.entries(PINNED_ARTIFACTS)) {
    const output = path.join(ROOT, 'finder', 'output', cityId)
    const manifest = JSON.parse(await readFile(path.join(output, 'artifact-manifest.json'), 'utf8'))

    assert.equal(manifest.buildId, pin.buildId)
    assert.equal(await sha256(path.join(output, 'events.json')), pin.events)
    assert.equal(await sha256(path.join(output, 'places.json')), pin.places)
    if (pin.receipt) {
      assert.equal(await sha256CanonicalLfText(
        path.join(ROOT, 'finder', 'cache', cityId, 'place-mapillary-images.json'),
      ), pin.receipt)
    }
  }
})

for (const cityId of ['tampa-bay', 'sf-east-bay']) {
  test(`imagery audit derives ${cityId} totals from pinned artifacts`, async () => {
    const [report, events, places, files] = await Promise.all([
      auditCityImagery({ repoRoot: ROOT, cityId }),
      readRows(cityId, 'events'),
      readRows(cityId, 'places'),
      localImageFiles(cityId),
    ])
    const eventImages = events.map((event) => event.image).filter(Boolean)
    const placeImages = places.map((place) => place.image).filter(Boolean)

    assert.equal(report.events.total, events.length)
    assert.equal(report.events.imageBearing, eventImages.length)
    assert.equal(report.events.uniqueImageUrls, new Set(eventImages).size)
    assert.equal(report.events.selfHosted, eventImages.filter((image) => image.startsWith('/') && !image.startsWith('//')).length)
    assert.equal(report.events.remote, eventImages.filter((image) => /^(?:https?:)?\/\//i.test(image)).length)
    assert.equal(report.places.total, places.length)
    assert.equal(report.places.imageBearing, placeImages.length)
    assert.equal(report.places.local, placeImages.filter((image) => image.startsWith('/') && !image.startsWith('//')).length)
    assert.equal(report.localImages.fileCount, files.length)

    const codes = new Set(report.findings.map((finding) => finding.code))
    assert.ok(codes.has(IMAGERY_FINDING_CODES.EVENT_IMAGE_PROVENANCE_MISSING))
    assert.ok(codes.has(IMAGERY_FINDING_CODES.EVENT_IMAGE_DUPLICATE_PRESSURE))
    assert.ok(codes.has(IMAGERY_FINDING_CODES.PLACE_IMAGE_COVERAGE_LOW))
  })
}

test('pinned event imagery has zero self-hosted URLs', async () => {
  const reports = await Promise.all(['tampa-bay', 'sf-east-bay'].map((cityId) =>
    auditCityImagery({ repoRoot: ROOT, cityId })))

  for (const report of reports) {
    assert.equal(report.events.selfHosted, 0)
    assert.equal(report.events.remote, report.events.imageBearing)
  }
})

test('SF has no shipped local place JPEGs', async () => {
  const report = await auditCityImagery({ repoRoot: ROOT, cityId: 'sf-east-bay' })

  assert.equal(report.places.local, 0)
  assert.equal(report.localImages.fileCount, 0)
  assert.equal(report.mapillaryReceipts.available, false)
})

test('Tampa receipt dimensions disagree with the shipped local JPEGs', async () => {
  const report = await auditCityImagery({ repoRoot: ROOT, cityId: 'tampa-bay' })
  const codes = new Set(report.findings.map((finding) => finding.code))

  assert.ok(report.mapillaryReceipts.entryCount > 0)
  assert.equal(report.mapillaryReceipts.dimensionsChecked, report.mapillaryReceipts.entryCount)
  assert.equal(report.mapillaryReceipts.dimensionMismatches.length, report.mapillaryReceipts.entryCount)
  assert.ok(report.mapillaryReceipts.dimensionMismatches.some((mismatch) =>
    mismatch.expected.width === 1280 && mismatch.actual.width === 900))
  assert.ok(codes.has(IMAGERY_FINDING_CODES.LOCAL_IMAGE_DIMENSION_MISMATCH))
})

test('audit reports stable findings for missing and broken local image files', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'wuzup-imagery-audit-'))
  const cityId = 'fixture-city'
  const output = path.join(repoRoot, 'finder', 'output', cityId)
  const cache = path.join(repoRoot, 'finder', 'cache', cityId)

  try {
    await mkdir(path.join(output, 'place-img'), { recursive: true })
    await mkdir(cache, { recursive: true })
    await writeFile(path.join(output, 'events.json'), '[]')
    await writeFile(path.join(output, 'places.json'), JSON.stringify({
      places: [
        { key: 'p|missing', image: '/place-img/missing.jpg', imageCredit: { sourceFamily: 'fixture' } },
        { key: 'p|broken', image: '/place-img/broken.jpg', imageCredit: { sourceFamily: 'fixture' } },
      ],
    }))
    await writeFile(path.join(output, 'place-img', 'broken.jpg'), 'not a jpeg')
    await writeFile(path.join(cache, 'place-mapillary-images.json'), JSON.stringify({
      byKey: {
        'p|missing': { image: '/place-img/missing.jpg', width: 1280 },
        'p|broken': { image: '/place-img/broken.jpg', width: 1280 },
      },
    }))

    const report = await auditCityImagery({ repoRoot, cityId })
    const codes = new Set(report.findings.map((finding) => finding.code))

    assert.equal(report.localImages.missingReferences.length, 1)
    assert.equal(report.localImages.brokenFiles.length, 1)
    assert.ok(codes.has(IMAGERY_FINDING_CODES.LOCAL_IMAGE_REFERENCE_MISSING))
    assert.ok(codes.has(IMAGERY_FINDING_CODES.LOCAL_IMAGE_FILE_BROKEN))
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
})
