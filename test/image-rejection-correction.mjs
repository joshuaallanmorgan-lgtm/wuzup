import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  IMAGE_REJECTION_JOURNAL_FILE,
  IMAGE_REJECTION_RECEIPT_FILE,
  applyReviewedImageRejections,
} from '../finder/apply-image-rejections.mjs'
import {
  MANIFEST_FILE,
  PENDING_MANIFEST_FILE,
  summarizeSourceHealth,
  verifyArtifactSet,
  writeManifest,
} from '../finder/artifact-manifest.mjs'
import { defineReviewedImageRejects } from '../finder/reviewed-image-rejections.mjs'

const CITY_ID = 'fixture-city'
const TIME_ZONE = 'America/New_York'
const GENERATED_AT = '2026-07-21T12:00:00.000Z'
const APPLIED_AT = '2026-07-21T13:00:00.000Z'
const REPORT_SHA = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const LOCAL_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const GOOD_BYTES = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9])
const LOCAL_IMAGE = '/place-img/rejected-local.jpg'
const LOCAL_PAGE = 'https://www.mapillary.com/app/?focus=photo&pKey=12345'
const SHARED_IMAGE = 'https://upload.wikimedia.org/example/shared.jpg'
const SHARED_PAGE = 'https://commons.wikimedia.org/wiki/File:Shared.jpg'

function writeJson(file, value, newline = false) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}${newline ? '\n' : ''}`)
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'wuzup-image-rejection-'))
  const artifactRoot = path.join(parent, 'output', CITY_ID)
  const cacheRoot = path.join(parent, 'cache', CITY_ID)
  mkdirSync(path.join(artifactRoot, 'place-img'), { recursive: true })
  mkdirSync(cacheRoot, { recursive: true })

  writeJson(path.join(artifactRoot, 'events.json'), [{
    id: 'fixture:event:1',
    title: 'Fixture event',
    start: '2026-07-22T19:00:00-04:00',
  }], true)
  writeJson(path.join(artifactRoot, 'places.json'), {
    schemaVersion: 1,
    places: [
      {
        key: 'p|rejected-local',
        name: 'Rejected Local',
        image: LOCAL_IMAGE,
        imageCredit: {
          url: LOCAL_PAGE,
          sourceFamily: 'mapillary-sign',
          license: 'CC BY-SA 4.0',
        },
      },
      {
        key: 'p|rejected-shared',
        name: 'Rejected Shared',
        image: SHARED_IMAGE,
        imageCredit: {
          url: SHARED_PAGE,
          sourceFamily: 'commons-geosearch',
          license: 'CC BY 4.0',
        },
      },
      {
        key: 'p|retained-shared',
        name: 'Retained Shared',
        image: SHARED_IMAGE,
        imageCredit: {
          url: SHARED_PAGE,
          sourceFamily: 'commons-geosearch',
          license: 'CC BY 4.0',
        },
      },
      {
        key: 'p|retained-local',
        name: 'Retained Local',
        image: '/place-img/retained-local.jpg',
      },
    ],
  }, true)
  writeJson(path.join(artifactRoot, 'guides.json'), { schemaVersion: 1, guides: [] }, true)
  writeFileSync(path.join(artifactRoot, 'place-img', 'rejected-local.jpg'), LOCAL_BYTES)
  writeFileSync(path.join(artifactRoot, 'place-img', 'retained-local.jpg'), GOOD_BYTES)

  writeJson(path.join(cacheRoot, 'attributions.json'), {
    fetchedAt: '2026-07-20T00:00:00.000Z',
    byFile: {
      'Mapillary:12345': {
        fileUrl: LOCAL_PAGE,
        sourceFamily: 'mapillary-sign',
      },
      'File:Shared.jpg': {
        fileUrl: SHARED_PAGE,
        sourceFamily: 'commons-geosearch',
      },
    },
  })
  writeJson(path.join(cacheRoot, 'place-mapillary-images.json'), {
    fetchedAt: '2026-07-20T00:00:00.000Z',
    byKey: {
      'p|rejected-local': {
        id: '12345',
        image: LOCAL_IMAGE,
        mapillaryUrl: LOCAL_PAGE,
      },
    },
  })

  const eventHealth = summarizeSourceHealth(
    [{ source: 'Fixture events', found: 1, ok: true }],
    { runId: 'fixture-events-run', checkedAt: GENERATED_AT },
  )
  const placeHealth = summarizeSourceHealth(
    [{ source: 'Fixture places', found: 4, ok: true }],
    { runId: 'fixture-places-run', checkedAt: GENERATED_AT },
  )
  const manifest = writeManifest({
    root: artifactRoot,
    cityId: CITY_ID,
    timeZone: TIME_ZONE,
    assembledAt: GENERATED_AT,
    componentReceipts: {
      events: {
        runId: 'fixture-events-run',
        generatedAt: GENERATED_AT,
        provenance: 'fixture',
        sourceHealth: eventHealth,
      },
      places: {
        runId: 'fixture-places-run',
        generatedAt: GENERATED_AT,
        provenance: 'fixture',
        sourceHealth: placeHealth,
      },
    },
  })
  const imageRejects = defineReviewedImageRejects(CITY_ID, [
    {
      placeKey: 'p|rejected-local',
      image: LOCAL_IMAGE,
      sourcePage: LOCAL_PAGE,
      sourceFamily: 'mapillary-sign',
      evidence: { report: 'fixture.md', reportSha256: REPORT_SHA, reviewRow: 1 },
      disposition: 'remove-or-replace',
      reason: 'mobile pixels fail',
    },
    {
      placeKey: 'p|rejected-shared',
      image: SHARED_IMAGE,
      sourcePage: SHARED_PAGE,
      sourceFamily: 'commons-geosearch',
      evidence: { report: 'fixture.md', reportSha256: REPORT_SHA, reviewRow: 2 },
      disposition: 'remove-or-replace',
      reason: 'wrong item',
    },
  ])
  const batch = {
    schemaVersion: 1,
    auditDocument: 'fixture.md',
    auditReportSha256: REPORT_SHA,
    expectedPreimage: {
      manifestId: manifest.manifestId,
      buildId: manifest.buildId,
      placesSha256: manifest.artifacts.places.sha256,
    },
    expectedRemoved: {
      attributionEntries: ['Mapillary:12345'],
    },
    localImages: {
      'p|rejected-local': {
        image: LOCAL_IMAGE,
        mapillaryId: '12345',
        bytes: LOCAL_BYTES.length,
        sha256: digest(LOCAL_BYTES),
      },
    },
  }

  return { parent, artifactRoot, cacheRoot, manifest, imageRejects, batch }
}

function apply(set, overrides = {}) {
  return applyReviewedImageRejections({
    artifactRoot: set.artifactRoot,
    cacheRoot: set.cacheRoot,
    cityId: CITY_ID,
    timeZone: TIME_ZONE,
    imageRejects: set.imageRejects,
    batch: set.batch,
    appliedAt: APPLIED_AT,
    ...overrides,
  })
}

test('reviewed image correction changes only exact claims and preserves artifact receipts', () => {
  const set = fixture()
  try {
    const beforeEvents = readFileSync(path.join(set.artifactRoot, 'events.json'))
    const beforeGuides = readFileSync(path.join(set.artifactRoot, 'guides.json'))
    const beforePlaces = JSON.parse(readFileSync(path.join(set.artifactRoot, 'places.json'), 'utf8'))
    const result = apply(set)

    assert.equal(result.status, 'applied')
    const afterPlaces = JSON.parse(readFileSync(path.join(set.artifactRoot, 'places.json'), 'utf8'))
    for (const key of ['p|rejected-local', 'p|rejected-shared']) {
      const place = afterPlaces.places.find(row => row.key === key)
      assert.equal(place.image, undefined)
      assert.equal(place.imageCredit, undefined)
    }
    assert.deepEqual(afterPlaces.places.slice(2), beforePlaces.places.slice(2))
    assert.deepEqual(readFileSync(path.join(set.artifactRoot, 'events.json')), beforeEvents)
    assert.deepEqual(readFileSync(path.join(set.artifactRoot, 'guides.json')), beforeGuides)
    assert.equal(existsSync(path.join(set.artifactRoot, 'place-img', 'rejected-local.jpg')), false)
    assert.equal(existsSync(path.join(set.artifactRoot, 'place-img', 'retained-local.jpg')), true)

    const attributions = JSON.parse(readFileSync(path.join(set.cacheRoot, 'attributions.json'), 'utf8'))
    assert.equal(attributions.fetchedAt, '2026-07-20T00:00:00.000Z')
    assert.equal(attributions.byFile['Mapillary:12345'], undefined)
    assert.ok(attributions.byFile['File:Shared.jpg'], 'a shared attribution must survive its retained consumer')
    const map = JSON.parse(readFileSync(path.join(set.cacheRoot, 'place-mapillary-images.json'), 'utf8'))
    assert.equal(map.fetchedAt, '2026-07-20T00:00:00.000Z')
    assert.equal(map.byKey['p|rejected-local'], undefined)

    const verified = verifyArtifactSet({
      root: set.artifactRoot,
      expectedCityId: CITY_ID,
      expectedTimeZone: TIME_ZONE,
    })
    assert.equal(verified.ok, true, verified.problems.join(' · '))
    assert.equal(verified.manifest.artifacts.events.sha256, set.manifest.artifacts.events.sha256)
    assert.equal(verified.manifest.artifacts.guides.sha256, set.manifest.artifacts.guides.sha256)
    assert.equal(verified.manifest.artifacts.places.runId, set.manifest.artifacts.places.runId)
    assert.equal(verified.manifest.artifacts.places.generatedAt, set.manifest.artifacts.places.generatedAt)
    assert.deepEqual(verified.manifest.artifacts.places.sourceHealth, set.manifest.artifacts.places.sourceHealth)
    assert.notEqual(verified.manifest.artifacts.places.sha256, set.manifest.artifacts.places.sha256)
    assert.notEqual(verified.manifest.manifestId, set.manifest.manifestId)
    assert.notEqual(verified.manifest.buildId, set.manifest.buildId)
    assert.equal(verified.manifest.placeImages.count, 1)

    const receipt = JSON.parse(readFileSync(path.join(set.cacheRoot, IMAGE_REJECTION_RECEIPT_FILE), 'utf8'))
    assert.equal(receipt.preimage.manifestId, set.manifest.manifestId)
    assert.equal(receipt.result.manifestId, verified.manifest.manifestId)
    assert.deepEqual(receipt.removed.mapillaryEntries, ['p|rejected-local'])
    assert.equal(apply(set).status, 'unchanged', 'an exact replay must be byte-idempotent')

    const receiptPath = path.join(set.cacheRoot, IMAGE_REJECTION_RECEIPT_FILE)
    const tampered = structuredClone(receipt)
    tampered.result.placesSha256 = 'f'.repeat(64)
    writeJson(receiptPath, tampered, true)
    assert.throws(() => apply(set), /corrected places drifted from its receipt/)

    const tamperedPreimage = structuredClone(receipt)
    tamperedPreimage.preimage.buildId = `sha256:${'e'.repeat(64)}`
    writeJson(receiptPath, tamperedPreimage, true)
    assert.throws(() => apply(set), /preimage build drifted/)

    const tamperedAttributions = structuredClone(receipt)
    tamperedAttributions.removed.attributionEntries = []
    writeJson(receiptPath, tamperedAttributions, true)
    assert.throws(() => apply(set), /attribution set drifted/)

    writeJson(receiptPath, receipt, true)
    assert.equal(apply(set).status, 'unchanged', 'restoring the exact receipt must restore replay authority')
  } finally {
    rmSync(set.parent, { recursive: true, force: true })
  }
})

test('candidate drift refuses stale audit authority without invalidating trusted bytes', () => {
  const set = fixture()
  try {
    const placesPath = path.join(set.artifactRoot, 'places.json')
    const doc = JSON.parse(readFileSync(placesPath, 'utf8'))
    doc.places[0].imageCredit.url = 'https://www.mapillary.com/app/?focus=photo&pKey=replacement'
    writeJson(placesPath, doc, true)
    const driftManifest = writeManifest({
      root: set.artifactRoot,
      cityId: CITY_ID,
      timeZone: TIME_ZONE,
      assembledAt: GENERATED_AT,
      previousManifest: set.manifest,
      componentReceipts: {
        places: {
          runId: set.manifest.artifacts.places.runId,
          generatedAt: set.manifest.artifacts.places.generatedAt,
          provenance: set.manifest.artifacts.places.provenance,
          sourceHealth: set.manifest.artifacts.places.sourceHealth,
        },
      },
    })
    set.batch.expectedPreimage.manifestId = driftManifest.manifestId
    set.batch.expectedPreimage.buildId = driftManifest.buildId
    set.batch.expectedPreimage.placesSha256 = driftManifest.artifacts.places.sha256

    assert.throws(() => apply(set), /candidate drifted/)
    assert.equal(existsSync(path.join(set.artifactRoot, MANIFEST_FILE)), true)
    assert.equal(existsSync(path.join(set.artifactRoot, PENDING_MANIFEST_FILE)), false)
    assert.equal(existsSync(path.join(set.cacheRoot, IMAGE_REJECTION_RECEIPT_FILE)), false)
  } finally {
    rmSync(set.parent, { recursive: true, force: true })
  }
})

for (const boundary of ['journal', 'invalidate', 'json', 'files', 'receipt', 'manifest']) {
  test(`an interruption after ${boundary} fails closed and the next invocation completes`, () => {
    const set = fixture()
    try {
      assert.throws(() => apply(set, { interruptAfter: boundary }), /injected image-rejection interruption/)
      assert.equal(existsSync(path.join(set.artifactRoot, MANIFEST_FILE)), false)
      assert.equal(existsSync(path.join(set.artifactRoot, PENDING_MANIFEST_FILE)), true)
      assert.equal(existsSync(path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)), true)
      assert.equal(existsSync(path.join(set.cacheRoot, IMAGE_REJECTION_RECEIPT_FILE)), false)
      const pending = JSON.parse(readFileSync(path.join(set.artifactRoot, PENDING_MANIFEST_FILE), 'utf8'))
      assert.equal(pending.manifestId, set.manifest.manifestId)

      const resumed = apply(set)
      assert.equal(resumed.status, 'applied')
      assert.deepEqual(resumed.receipt.removed.attributionEntries, ['Mapillary:12345'])
      assert.deepEqual(resumed.receipt.removed.mapillaryEntries, ['p|rejected-local'])
      assert.equal(existsSync(path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)), false)
      assert.equal(existsSync(path.join(set.artifactRoot, PENDING_MANIFEST_FILE)), false)
      const verified = verifyArtifactSet({
        root: set.artifactRoot,
        expectedCityId: CITY_ID,
        expectedTimeZone: TIME_ZONE,
      })
      assert.equal(verified.ok, true, verified.problems.join(' · '))
      assert.equal(verified.manifest.manifestId, resumed.manifest.manifestId)
    } finally {
      rmSync(set.parent, { recursive: true, force: true })
    }
  })
}

for (const boundary of ['recovery-members', 'recovery-validated']) {
  test(`a second crash at ${boundary} never republishes the rejected preimage`, () => {
    const set = fixture()
    try {
      assert.throws(() => apply(set, { interruptAfter: 'files' }), /injected image-rejection interruption/)
      assert.throws(() => apply(set, { interruptAfter: boundary }), /injected image-rejection interruption/)
      assert.equal(existsSync(path.join(set.artifactRoot, MANIFEST_FILE)), false)
      assert.equal(existsSync(path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)), true)

      const resumed = apply(set)
      assert.equal(resumed.status, 'applied')
      assert.notEqual(resumed.manifest.manifestId, set.manifest.manifestId)
      assert.equal(existsSync(path.join(set.artifactRoot, PENDING_MANIFEST_FILE)), false)
      assert.equal(existsSync(path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)), false)
    } finally {
      rmSync(set.parent, { recursive: true, force: true })
    }
  })
}

test('a journal beside the exact trusted preimage is discarded without rollback', () => {
  const set = fixture()
  try {
    assert.throws(() => apply(set, { interruptAfter: 'journal' }), /injected image-rejection interruption/)
    const pendingPath = path.join(set.artifactRoot, PENDING_MANIFEST_FILE)
    writeFileSync(path.join(set.artifactRoot, MANIFEST_FILE), readFileSync(pendingPath))
    rmSync(pendingPath)

    const resumed = apply(set)
    assert.equal(resumed.status, 'applied')
    assert.notEqual(resumed.manifest.manifestId, set.manifest.manifestId)
    assert.equal(existsSync(path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)), false)
  } finally {
    rmSync(set.parent, { recursive: true, force: true })
  }
})

test('a stale journal cannot roll a newer trusted artifact back', () => {
  const set = fixture()
  try {
    assert.throws(() => apply(set, { interruptAfter: 'files' }), /injected image-rejection interruption/)
    const journalPath = path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)
    const staleJournal = readFileSync(journalPath)
    const corrected = apply(set)

    const eventsPath = path.join(set.artifactRoot, 'events.json')
    const events = JSON.parse(readFileSync(eventsPath, 'utf8'))
    events[0].title = 'Newer fixture event'
    writeJson(eventsPath, events, true)
    const newerHealth = summarizeSourceHealth(
      [{ source: 'Newer fixture events', found: 1, ok: true }],
      { runId: 'newer-events-run', checkedAt: '2026-07-21T14:00:00.000Z' },
    )
    const newer = writeManifest({
      root: set.artifactRoot,
      cityId: CITY_ID,
      timeZone: TIME_ZONE,
      assembledAt: '2026-07-21T14:00:00.000Z',
      previousManifest: corrected.manifest,
      componentReceipts: {
        events: {
          runId: 'newer-events-run',
          generatedAt: '2026-07-21T14:00:00.000Z',
          provenance: 'fixture',
          sourceHealth: newerHealth,
        },
      },
    })
    writeFileSync(journalPath, staleJournal)
    const before = {
      manifest: readFileSync(path.join(set.artifactRoot, MANIFEST_FILE)),
      events: readFileSync(eventsPath),
      places: readFileSync(path.join(set.artifactRoot, 'places.json')),
      receipt: readFileSync(path.join(set.cacheRoot, IMAGE_REJECTION_RECEIPT_FILE)),
      journal: readFileSync(journalPath),
    }

    assert.throws(() => apply(set), /journal is stale beside a different trusted artifact/)
    assert.deepEqual(readFileSync(path.join(set.artifactRoot, MANIFEST_FILE)), before.manifest)
    assert.deepEqual(readFileSync(eventsPath), before.events)
    assert.deepEqual(readFileSync(path.join(set.artifactRoot, 'places.json')), before.places)
    assert.deepEqual(readFileSync(path.join(set.cacheRoot, IMAGE_REJECTION_RECEIPT_FILE)), before.receipt)
    assert.deepEqual(readFileSync(journalPath), before.journal)
    assert.equal(JSON.parse(before.manifest).manifestId, newer.manifestId)
  } finally {
    rmSync(set.parent, { recursive: true, force: true })
  }
})

test('a hard stop after the trust pointer lands is recognized as a committed transaction', () => {
  const set = fixture()
  try {
    assert.throws(() => apply(set, { interruptAfter: 'files' }), /injected image-rejection interruption/)
    const journalPath = path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)
    const journalBytes = readFileSync(journalPath)
    assert.equal(apply(set).status, 'applied')

    // Recreate the only hard-stop window that a caught test exception cannot:
    // the manifest and receipt reached their atomic paths, but journal cleanup
    // did not run. This simulates process interruption, not sudden power loss.
    writeFileSync(journalPath, journalBytes)
    const resumed = apply(set)
    assert.equal(resumed.status, 'unchanged')
    assert.equal(existsSync(journalPath), false)
    assert.equal(existsSync(path.join(set.artifactRoot, PENDING_MANIFEST_FILE)), false)
  } finally {
    rmSync(set.parent, { recursive: true, force: true })
  }
})

test('a corrupted recovery journal cannot republish either preimage or partial bytes', () => {
  const set = fixture()
  try {
    assert.throws(() => apply(set, { interruptAfter: 'files' }), /injected image-rejection interruption/)
    const journalPath = path.join(set.cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.payload.original.places.base64 = 'AA=='
    writeJson(journalPath, journal, true)

    assert.throws(() => apply(set), /recovery journal digest drifted/)
    assert.equal(existsSync(path.join(set.artifactRoot, MANIFEST_FILE)), false)
    assert.equal(existsSync(journalPath), true)
  } finally {
    rmSync(set.parent, { recursive: true, force: true })
  }
})

test('destructive correction refuses an artifact root reached through a symlink or junction', (t) => {
  const set = fixture()
  try {
    const alias = path.join(set.parent, 'artifact-root-alias')
    try {
      symlinkSync(set.artifactRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`platform cannot create a directory link: ${error.code}`)
      return
    }

    assert.throws(() => apply(set, { artifactRoot: alias }), /artifact root must be a regular directory|symlink or junction/)
    const verified = verifyArtifactSet({
      root: set.artifactRoot,
      expectedCityId: CITY_ID,
      expectedTimeZone: TIME_ZONE,
    })
    assert.equal(verified.ok, true, verified.problems.join(' · '))
    assert.equal(verified.manifest.manifestId, set.manifest.manifestId)
  } finally {
    rmSync(set.parent, { recursive: true, force: true })
  }
})
