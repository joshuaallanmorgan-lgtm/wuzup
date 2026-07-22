import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileLocalPlaceImages } from '../finder/place-image-artifacts.mjs'
import { writeEnrichedPlacesArtifact } from '../finder/places-images.mjs'
import {
  sha256,
  summarizeSourceHealth,
  verifyArtifactSet,
  writeManifest,
} from '../finder/artifact-manifest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function withScratch(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'wuzup-place-image-reconcile-'))
  mkdirSync(path.join(root, 'place-img'), { recursive: true })
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

test('normal place refresh prunes vanished image consumers and preserves retained and non-image files', () => {
  withScratch((root) => {
    const imageRoot = path.join(root, 'place-img')
    const retainedBytes = Buffer.from('retained image bytes')
    const orphanBytes = Buffer.from('orphaned image bytes')
    writeFileSync(path.join(imageRoot, 'current-place.jpg'), retainedBytes)
    writeFileSync(path.join(imageRoot, 'vanished-place.jpg'), orphanBytes)
    writeFileSync(path.join(imageRoot, '.gitkeep'), 'keep directory')
    writeFileSync(path.join(imageRoot, 'review-notes.txt'), 'not an image artifact')

    const result = reconcileLocalPlaceImages(root, [
      { key: 'p|current-place', image: '/place-img/current-place.jpg' },
      { key: 'p|alias-consumer', image: '/place-img/current-place.jpg' },
      { key: 'p|remote', image: 'https://upload.wikimedia.org/current-place.jpg' },
    ])

    assert.equal(existsSync(path.join(imageRoot, 'vanished-place.jpg')), false)
    assert.deepEqual(readFileSync(path.join(imageRoot, 'current-place.jpg')), retainedBytes)
    assert.equal(readFileSync(path.join(imageRoot, '.gitkeep'), 'utf8'), 'keep directory')
    assert.equal(readFileSync(path.join(imageRoot, 'review-notes.txt'), 'utf8'), 'not an image artifact')
    const retainedSha256 = sha256(retainedBytes)
    const orphanSha256 = sha256(orphanBytes)
    assert.deepEqual(result.before, {
      count: 2,
      bytes: retainedBytes.length + orphanBytes.length,
      sha256: sha256(Buffer.from([
        `current-place.jpg\0${retainedBytes.length}\0${retainedSha256}`,
        `vanished-place.jpg\0${orphanBytes.length}\0${orphanSha256}`,
      ].join('\n'))),
    })
    assert.deepEqual(result.after, {
      count: 1,
      bytes: retainedBytes.length,
      sha256: sha256(Buffer.from(`current-place.jpg\0${retainedBytes.length}\0${retainedSha256}`)),
    })
    assert.notEqual(result.before.sha256, result.after.sha256)
    assert.deepEqual(result.removed, [{
      name: 'vanished-place.jpg',
      bytes: orphanBytes.length,
      sha256: orphanSha256,
    }])
    assert.deepEqual(result.consumers, [{
      name: 'current-place.jpg',
      keys: ['p|alias-consumer', 'p|current-place'],
    }])
  })
})

test('reconciliation refuses unsafe references and non-regular image collisions before deleting', () => {
  withScratch((root) => {
    const imageRoot = path.join(root, 'place-img')
    const orphan = path.join(imageRoot, 'orphan.jpg')
    writeFileSync(orphan, 'must survive failed preflight')

    assert.throws(
      () => reconcileLocalPlaceImages(root, [{ key: 'p|unsafe', image: '/place-img/../escape.jpg' }]),
      /unsafe local image path/,
    )
    assert.equal(existsSync(orphan), true)

    mkdirSync(path.join(imageRoot, 'collision.jpg'))
    assert.throws(
      () => reconcileLocalPlaceImages(root, [{ key: 'p|collision', image: '/place-img/collision.jpg' }]),
      /not a regular file/,
    )
    assert.equal(existsSync(orphan), true)
  })
})

test('normal places writer reconciles local images after invalidation and before manifest reseal', () => {
  const source = readFileSync(path.join(ROOT, 'finder', 'places.mjs'), 'utf8')
  const main = source.slice(source.indexOf('async function main()'))
  const invalidated = main.indexOf('const previousManifest = invalidateManifest(OUT')
  const placesWritten = main.indexOf("atomicWriteFileSync(join(OUT, 'places.json')")
  const reconciled = main.indexOf('const imageReconciliation = reconcileLocalPlaceImages(OUT, places)')
  const resealed = main.indexOf('const manifest = writeManifest({')

  assert.ok(invalidated >= 0)
  assert.ok(invalidated < placesWritten)
  assert.ok(placesWritten < reconciled)
  assert.ok(reconciled < resealed)
})

test('derived image writer prunes a cleared local image and reseals the exact artifact tree', () => {
  withScratch((root) => {
    const cityId = 'fixture-city'
    const timeZone = 'America/New_York'
    const generatedAt = new Date().toISOString()
    const imageRoot = path.join(root, 'place-img')
    const retainedBytes = Buffer.from('retained derived image')
    const staleBytes = Buffer.from('cleared derived image')
    writeFileSync(path.join(imageRoot, 'retained.jpg'), retainedBytes)
    writeFileSync(path.join(imageRoot, 'cleared.jpg'), staleBytes)
    writeJson(path.join(root, 'events.json'), [{
      id: 'fixture:event:1',
      title: 'Fixture event',
      start: generatedAt,
    }])
    writeJson(path.join(root, 'guides.json'), { schemaVersion: 1, guides: [] })
    const placesPath = path.join(root, 'places.json')
    writeJson(placesPath, {
      schemaVersion: 1,
      places: [
        { key: 'p|retained', name: 'Retained', image: '/place-img/retained.jpg' },
        { key: 'p|cleared', name: 'Cleared', image: '/place-img/cleared.jpg' },
      ],
    })
    const eventRunId = 'events-fixture-run'
    const placesRunId = 'places-fixture-run'
    const eventHealth = summarizeSourceHealth(
      [{ source: 'Fixture events', found: 1, ok: true }],
      { runId: eventRunId, checkedAt: generatedAt },
    )
    const placesHealth = summarizeSourceHealth(
      [{ source: 'Fixture places', found: 2, ok: true }],
      { runId: placesRunId, checkedAt: generatedAt },
    )
    const initial = writeManifest({
      root,
      cityId,
      timeZone,
      componentReceipts: {
        events: { generatedAt, runId: eventRunId, provenance: 'fixture', sourceHealth: eventHealth },
        places: { generatedAt, runId: placesRunId, provenance: 'fixture', sourceHealth: placesHealth },
      },
    })

    const result = writeEnrichedPlacesArtifact({
      artifactPath: placesPath,
      expectedCityId: cityId,
      expectedTimeZone: timeZone,
      doc: {
        schemaVersion: 1,
        places: [
          { key: 'p|retained', name: 'Retained', image: '/place-img/retained.jpg' },
          { key: 'p|cleared', name: 'Cleared' },
        ],
      },
    })

    assert.equal(existsSync(path.join(imageRoot, 'cleared.jpg')), false)
    assert.deepEqual(readFileSync(path.join(imageRoot, 'retained.jpg')), retainedBytes)
    assert.deepEqual(result.imageReconciliation.removed, [{
      name: 'cleared.jpg',
      bytes: staleBytes.length,
      sha256: sha256(staleBytes),
    }])
    assert.equal(result.manifest.artifacts.places.runId, initial.artifacts.places.runId)
    assert.equal(result.manifest.artifacts.places.generatedAt, initial.artifacts.places.generatedAt)
    assert.equal(result.manifest.placeImages.count, 1)
    const verified = verifyArtifactSet({
      root,
      expectedCityId: cityId,
      expectedTimeZone: timeZone,
    })
    assert.equal(verified.ok, true, verified.problems.join(' · '))
    assert.equal(verified.manifest.manifestId, result.manifest.manifestId)
  })
})
