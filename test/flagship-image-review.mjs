import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildFlagshipImageReview,
  FLAGSHIP_IMAGE_DECISION_SCHEMA_VERSION,
  flagshipImageReviewSha256,
  readContainedFlagshipImageFile,
  validateFlagshipImageDecisionReceipt,
  validateFlagshipImageReview,
  verifyFlagshipImageReview,
} from '../shared/flagship-image-review.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = JSON.parse(await readFile(
  new URL('./fixtures/imagery/flagship-image-review.v2.json', import.meta.url),
  'utf8',
))
const REVIEW = buildFlagshipImageReview({ repoRoot: ROOT })

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function idsByCity(review) {
  return Object.fromEntries(['tampa-bay', 'sf-east-bay'].map(cityId => [
    cityId,
    review.items.filter(item => item.cityId === cityId).map(item => item.itemId),
  ]))
}

test('contained local image reads reject file symlinks and Windows-aware junction roots', async (t) => {
  const containmentRoot = await mkdtemp(path.join(os.tmpdir(), 'wuzup-contained-image-test-'))
  t.after(() => rm(containmentRoot, { recursive: true, force: true }))
  const realRoot = path.join(containmentRoot, 'real-root')
  const outsideRoot = path.join(containmentRoot, 'outside')
  await mkdir(realRoot)
  await mkdir(outsideRoot)
  const outsideFile = path.join(outsideRoot, 'outside.jpg')
  await writeFile(outsideFile, Buffer.from('outside'))

  const linkedFile = path.join(realRoot, 'linked.jpg')
  try {
    await symlink(outsideFile, linkedFile, 'file')
    await assert.rejects(
      readContainedFlagshipImageFile({
        containmentRoot,
        fileRoot: realRoot,
        filePath: linkedFile,
        maxBytes: 100,
      }),
      /regular file, not a symlink|resolves outside/,
    )
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
  }

  const linkedRoot = path.join(containmentRoot, 'linked-root')
  try {
    await symlink(outsideRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip(`platform cannot create a directory symlink or junction: ${error.code}`)
      return
    }
    throw error
  }
  await assert.rejects(
    readContainedFlagshipImageFile({
      containmentRoot,
      fileRoot: linkedRoot,
      filePath: path.join(linkedRoot, 'outside.jpg'),
      maxBytes: 100,
    }),
    /root must be a real directory, not a symlink or junction|root escapes/,
  )
})

test('builds the pinned deterministic 50/50 flagship review manifest', async () => {
  const review = await REVIEW

  assert.equal(review.schemaVersion, FIXTURE.schemaVersion)
  assert.deepEqual(review.artifacts, FIXTURE.artifacts)
  assert.deepEqual(review.summary, FIXTURE.summary)
  assert.deepEqual(idsByCity(review), FIXTURE.sampleItemIds)
  assert.equal(flagshipImageReviewSha256(review), FIXTURE.reportSha256)
  assert.equal(validateFlagshipImageReview(review), review)
  assert.equal(review.items.length, 100)
  assert.equal(new Set(review.items.map(item => `${item.cityId}|${item.itemId}`)).size, 100)
})

test('binds every review to current manifest, artifact, and selected local image bytes', async () => {
  const review = await REVIEW

  for (const binding of review.artifacts) {
    const [manifestBytes, placesBytes] = await Promise.all([
      readFile(path.join(ROOT, binding.manifestPath)),
      readFile(path.join(ROOT, binding.placesPath)),
    ])
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    assert.equal(sha256(manifestBytes), binding.manifestSha256)
    assert.equal(sha256(placesBytes), binding.placesSha256)
    assert.equal(manifest.manifestId, binding.manifestId)
    assert.equal(manifest.buildId, binding.buildId)
    assert.equal(`sha256:${manifest.artifacts.places.sha256}`, binding.placesSha256)
    assert.equal(manifest.artifacts.places.bytes, binding.placesBytes)
    assert.equal(manifest.artifacts.places.count, binding.placesCount)
  }

  const local = review.items.filter(item => item.image.delivery === 'self-hosted')
  const expectedLocal = FIXTURE.summary.cities
    .flatMap(city => city.delivery)
    .filter(row => row.value === 'self-hosted')
    .reduce((sum, row) => sum + row.count, 0)
  assert.equal(local.length, expectedLocal)
  for (const item of local) {
    const bytes = await readFile(path.join(ROOT, item.image.localByte.path))
    assert.equal(sha256(bytes), item.image.localByte.sha256)
    assert.equal(bytes.length, item.image.localByte.bytes)
    assert.ok(item.image.localByte.width > 0)
    assert.ok(item.image.localByte.height > 0)
    assert.equal(item.image.localByte.format, 'jpeg')
  }

  assert.equal(review.items.filter(item => item.image.delivery === 'remote').length, 100 - expectedLocal)
  assert.equal(review.items.filter(item => item.image.delivery === 'remote')
    .every(item => item.image.host === 'upload.wikimedia.org' && item.image.localByte == null), true)

  const verification = await verifyFlagshipImageReview({ repoRoot: ROOT, review })
  assert.deepEqual(verification, { ok: true, sha256: FIXTURE.reportSha256, itemCount: 100 })
})

test('keeps source, delivery, risk, credit, and rank-proxy evidence explicit', async () => {
  const review = await REVIEW
  const tampa = review.summary.cities.find(city => city.cityId === 'tampa-bay')
  const sf = review.summary.cities.find(city => city.cityId === 'sf-east-bay')

  assert.deepEqual(tampa.delivery, FIXTURE.summary.cities.find(city => city.cityId === 'tampa-bay').delivery)
  assert.deepEqual(tampa.sourceFamilies.map(row => row.value), [
    'commons-geosearch', 'mapillary-sign', 'wikidata-p18', 'wikidata-p373',
  ])
  assert.deepEqual(sf.sourceFamilies.map(row => row.value), ['wikidata-p18', 'wikidata-p373'])
  assert.deepEqual(tampa.riskFlags, FIXTURE.summary.cities.find(city => city.cityId === 'tampa-bay').riskFlags)
  assert.equal(tampa.riskFlags.some(row => row.value === 'REFERENCE_REUSED'), false,
    'the corrected deterministic sample must not retain a known reused reference')
  assert.ok(tampa.riskFlags.some(row => row.value === 'SELF_HOSTED_BYTES'))
  assert.ok(sf.riskFlags.some(row => row.value === 'LICENSE_URL_MISSING'))

  for (const item of review.items) {
    assert.ok(item.itemId)
    assert.ok(item.name)
    assert.ok(Object.hasOwn(item, 'address'))
    assert.ok(Object.hasOwn(item.coordinates, 'lat'))
    assert.ok(Object.hasOwn(item.coordinates, 'lng'))
    assert.ok(item.rankProxy.position > 0)
    assert.ok(Number.isFinite(item.rankProxy.objectiveScore))
    assert.ok(Number.isFinite(item.rankProxy.totalScore))
    assert.ok(Array.isArray(item.rankProxy.reasonCodes))
    assert.ok(item.image.reference)
    assert.ok(item.credit.sourceFamily)
    assert.ok(item.credit.sourcePage)
    assert.ok(item.credit.author)
    assert.ok(item.credit.license)
    assert.ok(Array.isArray(item.stratification.riskFlags))
  }
})

test('makes no identity, pixel, licensing, legal, or human-pass claim', async () => {
  const review = await REVIEW

  assert.equal(review.reviewState, 'pending-independent-review')
  assert.deepEqual(review.claims, {
    identityReview: 'pending',
    pixelReview: 'pending',
    legalReview: 'pending',
    humanPass: false,
    statement: 'This deterministic evidence manifest is not an identity, pixel-quality, licensing, or legal approval.',
  })
  for (const item of review.items) {
    assert.deepEqual(item.review, {
      identity: 'pending',
      pixel: 'pending',
      legal: 'pending',
      humanPass: false,
    })
  }
})

test('rebuilds byte-for-byte deterministically', async () => {
  const first = await REVIEW
  const second = await buildFlagshipImageReview({ repoRoot: ROOT })

  assert.deepEqual(second, first)
  assert.equal(flagshipImageReviewSha256(second), FIXTURE.reportSha256)
})

test('schema rejects credit omissions, review claims, and undeclared fields', async () => {
  const review = await REVIEW
  const missingAuthor = structuredClone(review)
  missingAuthor.items[0].credit.author = ''
  assert.throws(() => validateFlagshipImageReview(missingAuthor), /credit\.author is required/)

  const falseApproval = structuredClone(review)
  falseApproval.items[0].review.humanPass = true
  assert.throws(() => validateFlagshipImageReview(falseApproval), /review\.humanPass must be false/)

  const undeclared = structuredClone(review)
  undeclared.items[0].reviewerVerdict = 'pass'
  assert.throws(() => validateFlagshipImageReview(undeclared), /must contain exactly/)
})

test('verification rejects syntactically valid artifact and local-byte tampering', async () => {
  const review = await REVIEW
  const artifactTamper = structuredClone(review)
  artifactTamper.artifacts[0].placesSha256 = `sha256:${'f'.repeat(64)}`
  validateFlagshipImageReview(artifactTamper)
  await assert.rejects(
    verifyFlagshipImageReview({ repoRoot: ROOT, review: artifactTamper }),
    /does not match the current pinned artifacts/,
  )

  const byteTamper = structuredClone(review)
  const local = byteTamper.items.find(item => item.image.localByte)
  local.image.localByte.sha256 = `sha256:${'e'.repeat(64)}`
  validateFlagshipImageReview(byteTamper)
  await assert.rejects(
    verifyFlagshipImageReview({ repoRoot: ROOT, review: byteTamper }),
    /does not match the current pinned artifacts/,
  )
})

test('separate decision receipts bind every reviewed remote and local byte set', async () => {
  const review = await REVIEW
  const retrievedAt = '2026-07-21T20:00:00.000Z'
  const receipt = {
    schemaVersion: FLAGSHIP_IMAGE_DECISION_SCHEMA_VERSION,
    reportSha256: flagshipImageReviewSha256(review),
    evidenceSealSha256: `sha256:${'a'.repeat(64)}`,
    reviewer: 'independent-reviewer-fixture',
    reviewedAt: retrievedAt,
    ownerPolicySha256: null,
    ownerPolicyAuthentication: 'not-cryptographically-authenticated',
    items: review.items.map(item => ({
      sampleIndex: item.sampleIndex,
      cityId: item.cityId,
      itemId: item.itemId,
      imageReference: item.image.reference,
      reviewedBytes: item.image.localByte
        ? {
            sha256: item.image.localByte.sha256,
            bytes: item.image.localByte.bytes,
            width: item.image.localByte.width,
            height: item.image.localByte.height,
            mimeType: `image/${item.image.localByte.format}`,
            retrievedAt,
            finalUrl: null,
          }
        : {
            sha256: sha256(Buffer.from(`synthetic-review-byte:${item.itemId}`)),
            bytes: 1,
            width: 1,
            height: 1,
            mimeType: 'image/jpeg',
            retrievedAt,
            finalUrl: item.image.reference,
          },
      sourcePageVerification: {
        checkedAt: retrievedAt,
        finalUrl: item.credit.sourcePage,
        httpStatus: 200,
      },
      identity: 'fail',
      pixel: 'fail',
      creditLicense: 'fail',
      resolution: 'fallback',
      notes: 'Reviewed the cached bytes and exact source page.',
    })),
  }

  assert.deepEqual(validateFlagshipImageDecisionReceipt({ review, receipt }), {
    ok: true,
    complete: true,
    allItemsKept: false,
    kept: 0,
    actionRequired: 100,
    reportSha256: receipt.reportSha256,
    evidenceSealSha256: receipt.evidenceSealSha256,
    ownerPolicySha256: null,
    ownerPolicyAuthentication: 'not-cryptographically-authenticated',
  })

  const missingRemoteBinding = structuredClone(receipt)
  const remote = missingRemoteBinding.items.find(item => item.reviewedBytes.finalUrl)
  remote.reviewedBytes.sha256 = null
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: missingRemoteBinding }),
    /sha256 must bind the reviewed bytes/,
  )

  const unrelatedRemote = structuredClone(receipt)
  unrelatedRemote.items.find(item => item.reviewedBytes.finalUrl).reviewedBytes.finalUrl =
    'https://upload.wikimedia.org/unrelated-review-pixels.jpg'
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: unrelatedRemote }),
    /finalUrl must match the audited image reference/,
  )

  const futureRetrieval = structuredClone(receipt)
  futureRetrieval.items[0].reviewedBytes.retrievedAt = '2026-07-21T20:00:01.000Z'
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: futureRetrieval }),
    /retrievedAt cannot follow the review/,
  )

  const staleRetrieval = structuredClone(receipt)
  staleRetrieval.items[0].reviewedBytes.retrievedAt = '2026-07-20T19:59:59.000Z'
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: staleRetrieval }),
    /retrievedAt is too old for this review/,
  )

  const wrongLocalBinding = structuredClone(receipt)
  const local = wrongLocalBinding.items.find(item => item.reviewedBytes.finalUrl === null)
  local.reviewedBytes.sha256 = `sha256:${'d'.repeat(64)}`
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: wrongLocalBinding }),
    /does not match local reviewed bytes/,
  )

  const falseKeep = structuredClone(receipt)
  falseKeep.items[0].resolution = 'keep'
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: falseKeep }),
    /cannot keep a failed image/,
  )

  const needsOwner = structuredClone(receipt)
  needsOwner.items[0].creditLicense = 'needs-owner'
  assert.equal(validateFlagshipImageDecisionReceipt({ review, receipt: needsOwner }).kept, 0)

  const wrongSourcePage = structuredClone(receipt)
  wrongSourcePage.items[0].sourcePageVerification.finalUrl =
    new URL('/different-source-page', review.items[0].credit.sourcePage).href
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: wrongSourcePage }),
    /exact audited source page/,
  )

  const noContentSourcePage = structuredClone(receipt)
  noContentSourcePage.items[0].sourcePageVerification.httpStatus = 204
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: noContentSourcePage }),
    /exactly HTTP 200/,
  )

  const legacyReceipt = structuredClone(receipt)
  legacyReceipt.schemaVersion = 1
  assert.throws(
    () => validateFlagshipImageDecisionReceipt({ review, receipt: legacyReceipt }),
    /schemaVersion is invalid/,
  )
})
