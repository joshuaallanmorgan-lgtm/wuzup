import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  hasMapillaryGuardSignals,
  mapillaryCropFailsClosed,
  normalizeMapillaryCropGuard,
} from '../finder/mapillary-contract.mjs'
import { mapillaryReceiptUsable } from '../finder/places-images.mjs'
import {
  imageRejects as sfImageRejects,
  qidDeny as sfQidDeny,
} from '../finder/cities/sf-east-bay.mjs'
import { imageRejects as tampaImageRejects } from '../finder/cities/tampa-bay.mjs'
import {
  auditCityImagery,
  IMAGERY_FINDING_CODES,
} from '../shared/imagery-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMAGE_EXTENSIONS = new Set(['.avif', '.jpeg', '.jpg', '.png', '.webp'])
const SF_CONTEXTUAL_IMAGE_QIDS = ['Q4116375', 'Q5192966']
const SF_LIFEGUARD_IMAGE = 'East_Bay_Life_Guard_Training.JPG'
const PINNED_ARTIFACTS = {
  'tampa-bay': {
    buildId: 'sha256:37e7b0bcc2ea184faaab0c066a996ef5a6511e15c2d0918725bf01d04187efe9',
    events: 'a8df0d0cefb461c6e417092b42de20067cf4f1bfb68314e5e91c4f70f875d090',
    places: 'e19e10e05780bcb55c88c59ccd1b251354f1652451ae37207b602f7aef144c25',
    receipt: 'f9ea65445cf999415657395cd996ddcbba60bfcc823c337de6dd6abd99fde66b',
  },
  'sf-east-bay': {
    buildId: 'sha256:e209e102c6a821060d8abbd2fe6d475629a7be6b32b0e4a2a46bb52f561bdf04',
    events: '84981a8ec48f0245e23e168fb63bc2071cceb5e1eda4e115828264a92873b1d8',
    places: '6e26e72aab68693ba3d9685503a81b7d8bf6c02b49afb697285dc3fbed338c1d',
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

test('verified cache-only refresh retains expired supervised Mapillary assets without weakening receipt gates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wuzup-mapillary-cache-retention-'))
  const assetPath = path.join(root, 'verified-cafe.jpg')
  const expectedImage = '/place-img/verified-cafe.jpg'
  const place = { name: 'Verified Cafe', lat: 27.9477115, lng: -82.4590567 }
  const reviewedAt = Date.parse('2026-01-01T00:00:00.000Z')
  const dayMs = 24 * 60 * 60 * 1000
  const receipt = {
    id: '123456789',
    image: expectedImage,
    width: 900,
    height: 600,
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    author: 'Mapillary contributor',
    signTextRead: 'VERIFIED CAFE',
    mapillaryUrl: 'https://www.mapillary.com/app/?focus=photo&pKey=123456789',
    tier: 'A',
    matchKind: 'phrase2',
    reVerified: true,
    place,
    imageSha256: null,
    at: new Date(reviewedAt).toISOString(),
  }
  const options = { assetPath, expectedImage, place }

  try {
    await writeFile(assetPath, 'not a jpeg')
    receipt.imageSha256 = `sha256:${await sha256(assetPath)}`
    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), false, 'a hash-matched text file must never count as an approved JPEG')

    await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#4a8060' },
    }).jpeg({ quality: 82 }).toFile(assetPath)
    receipt.imageSha256 = `sha256:${await sha256(assetPath)}`

    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      nowMs: reviewedAt + 30 * dayMs - 1,
    }), true, 'ordinary use remains valid inside the existing 30-day TTL')
    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      nowMs: reviewedAt + 30 * dayMs,
    }), false, 'ordinary and live runs retain the exact existing TTL boundary')
    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), true, 'cache-only refresh reuses the supervised local approval regardless of network age')

    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      place: { ...place, lat: 27.9478115 },
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), false, 'same-name ordinal reuse at different coordinates must not inherit an old storefront')
    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      place: { ...place, name: 'Different Cafe' },
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), false, 'same coordinates with a different normalized name must not inherit an old storefront')

    const approvedBytes = await readFile(assetPath)
    const tamperedBytes = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#804a60' },
    }).jpeg({ quality: 82 }).toBuffer()
    await writeFile(assetPath, tamperedBytes)
    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), false, 'different valid JPEG bytes with the same dimensions must fail the immutable hash')
    await writeFile(assetPath, approvedBytes)

    assert.equal(await mapillaryReceiptUsable({ ...receipt, width: 899 }, {
      ...options,
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), false, 'decoded JPEG dimensions must match the approved receipt')

    const pngBytes = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#4a8060' },
    }).png().toBuffer()
    await writeFile(assetPath, pngBytes)
    assert.equal(await mapillaryReceiptUsable({
      ...receipt,
      imageSha256: `sha256:${await sha256(assetPath)}`,
    }, {
      ...options,
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), false, 'a hash-matched non-JPEG image must fail the decoded format gate')
    await writeFile(assetPath, approvedBytes)

    const invalid = [
      ['shape', { width: '900' }],
      ['approval', { reVerified: false }],
      ['asset binding', { image: '/place-img/a-different-cafe.jpg' }],
      ['credit', { author: '' }],
      ['typed credit', { license: 42 }],
      ['license provenance', { licenseUrl: 'https://example.com/licenses/by-sa/4.0/' }],
      ['source provenance', { mapillaryUrl: 'https://www.mapillary.com/app/?focus=photo&pKey=987654321' }],
      ['review evidence', { signTextRead: '' }],
      ['review timestamp', { at: 'not-a-date' }],
    ]
    for (const [label, mutation] of invalid) {
      assert.equal(await mapillaryReceiptUsable({ ...receipt, ...mutation }, {
        ...options,
        cacheOnly: true,
        nowMs: reviewedAt + 365 * dayMs,
      }), false, `cache-only mode must still reject invalid ${label}`)
    }

    assert.equal(await mapillaryReceiptUsable(receipt, {
      ...options,
      assetPath: path.join(root, 'missing.jpg'),
      cacheOnly: true,
      nowMs: reviewedAt + 365 * dayMs,
    }), false, 'cache-only mode must not retain a receipt whose local asset is missing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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

test('known SF contextual lifeguard images fail closed to the art floor', async () => {
  const places = await readRows('sf-east-bay', 'places')
  const attributions = JSON.parse(await readFile(
    path.join(ROOT, 'finder', 'cache', 'sf-east-bay', 'attributions.json'),
    'utf8',
  ))
  const affected = places.filter((place) => SF_CONTEXTUAL_IMAGE_QIDS.includes(place.wikidata))

  for (const qid of SF_CONTEXTUAL_IMAGE_QIDS) assert.ok(sfQidDeny.includes(qid), `${qid} must remain denied`)
  assert.equal(affected.length, SF_CONTEXTUAL_IMAGE_QIDS.length)
  for (const place of affected) {
    assert.equal(place.image, undefined, `${place.key} must not present a contextual training photo as exact`)
    assert.equal(place.imageCredit, undefined, `${place.key} must not retain credit for an image it no longer ships`)
  }
  assert.equal(places.some((place) => String(place.image || '').includes(SF_LIFEGUARD_IMAGE)), false)
  assert.equal(Object.keys(attributions.byFile).some((file) => file.includes('East Bay Life Guard Training')), false)
  assert.equal(
    attributions.fetchedAt,
    '2026-07-07T11:54:59.649Z',
    'offline attribution pruning must not fabricate a new source-fetch timestamp',
  )
})

test('Tampa Mapillary receipts match local JPEGs and all 30 survive an expired cache-only refresh', async () => {
  const [report, places] = await Promise.all([
    auditCityImagery({ repoRoot: ROOT, cityId: 'tampa-bay' }),
    readRows('tampa-bay', 'places'),
  ])
  const placesByKey = new Map(places.map(place => [place.key, place]))
  const codes = new Set(report.findings.map((finding) => finding.code))
  const receipt = JSON.parse(await readFile(
    path.join(ROOT, 'finder', 'cache', 'tampa-bay', 'place-mapillary-images.json'),
    'utf8',
  ))

  assert.ok(report.mapillaryReceipts.entryCount > 0)
  assert.equal(report.mapillaryReceipts.entryCount, 30)
  assert.equal(report.mapillaryReceipts.dimensionsChecked, report.mapillaryReceipts.entryCount)
  assert.equal(report.mapillaryReceipts.dimensionMismatches.length, 0)
  for (const [key, entry] of Object.entries(receipt.byKey)) {
    const slug = key.replace(/^p\|/, '')
    const place = placesByKey.get(key)
    assert.ok(place, `${key} receipt must still target a reachable place`)
    assert.equal(entry.width, 900, `${key} receipt width must match its local JPEG`)
    assert.equal(entry.height, 600, `${key} receipt height must match its local JPEG`)
    assert.equal(await mapillaryReceiptUsable(entry, {
      assetPath: path.join(ROOT, 'finder', 'output', 'tampa-bay', 'place-img', `${slug}.jpg`),
      cacheOnly: true,
      expectedImage: `/place-img/${slug}.jpg`,
      nowMs: Date.parse('2027-07-22T00:00:00.000Z'),
      place,
    }), true, `${key} supervised local receipt must remain usable after its network TTL`)
  }
  assert.equal(codes.has(IMAGERY_FINDING_CODES.LOCAL_IMAGE_DIMENSION_MISMATCH), false)
})

test('reviewed July failures stay on Aurora with exact correction receipts and no orphaned local bytes', async () => {
  const registries = {
    'tampa-bay': tampaImageRejects,
    'sf-east-bay': sfImageRejects,
  }

  for (const [cityId, rejects] of Object.entries(registries)) {
    const [places, attributions, receipt] = await Promise.all([
      readRows(cityId, 'places'),
      readFile(path.join(ROOT, 'finder', 'cache', cityId, 'attributions.json'), 'utf8').then(JSON.parse),
      readFile(
        path.join(ROOT, 'finder', 'cache', cityId, 'reviewed-image-rejections.receipt.json'),
        'utf8',
      ).then(JSON.parse),
    ])
    const byKey = new Map(places.map(place => [place.key, place]))
    const retainedPages = new Set(places.map(place => place.imageCredit?.url).filter(Boolean))
    const attributedPages = new Set(Object.values(attributions.byFile || {}).map(entry => entry.fileUrl))

    assert.equal(receipt.auditReportSha256, 'sha256:4bee54bf0847f6de7a06443ffdf513055abfd85d0f2d6a67110f928518958830')
    assert.deepEqual(receipt.removed.placeClaims, Object.keys(rejects).sort())
    for (const rejection of Object.values(rejects)) {
      const place = byKey.get(rejection.placeKey)
      assert.ok(place, `${cityId}:${rejection.placeKey} must remain a reachable place`)
      assert.equal(place.image, undefined, `${cityId}:${rejection.placeKey} must stay on Aurora`)
      assert.equal(place.imageCredit, undefined, `${cityId}:${rejection.placeKey} must not retain stale credit`)
      if (!retainedPages.has(rejection.sourcePage)) {
        assert.equal(attributedPages.has(rejection.sourcePage), false,
          `${cityId}:${rejection.placeKey} orphan attribution must be pruned`)
      }
    }
  }

  const tampaPlaces = await readRows('tampa-bay', 'places')
  const tampaByKey = new Map(tampaPlaces.map(place => [place.key, place]))
  assert.ok(tampaByKey.get('p|bro-bowl').image, 'the exact Bro Bowl item keeps its item-scoped candidate')
  assert.ok(tampaByKey.get('p|hammock-park').image, 'the exact Hammock Park item keeps its item-scoped candidate')
  assert.equal(tampaByKey.get('p|morris-bridge-park').image, undefined)
  assert.equal(tampaByKey.get('p|lower-hillsborough-wilderness-preserve-morris-bridge-park').image, undefined)

  const mapillary = JSON.parse(await readFile(
    path.join(ROOT, 'finder', 'cache', 'tampa-bay', 'place-mapillary-images.json'),
    'utf8',
  ))
  const files = await localImageFiles('tampa-bay')
  const localReferences = tampaPlaces.filter(place => place.image?.startsWith('/place-img/'))
  assert.equal(Object.keys(mapillary.byKey).length, 30)
  assert.equal(files.length, 30)
  assert.equal(localReferences.length, 30)
  for (const key of Object.keys(tampaImageRejects)) {
    if (!tampaImageRejects[key].image.startsWith('/place-img/')) continue
    assert.equal(mapillary.byKey[key], undefined)
    assert.equal(files.some(file => `/place-img/${file.name}` === tampaImageRejects[key].image), false)
  }
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
