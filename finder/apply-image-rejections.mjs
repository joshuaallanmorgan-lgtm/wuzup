// Apply one reviewed place-image correction batch without rerunning acquisition.
//
// This is deliberately narrower than places-images.mjs: it removes only the
// exact city/item/candidate tuples bound to a reviewed artifact preimage. A
// changed candidate is a new review decision, not permission to mutate it under
// an older audit.

import { fileURLToPath } from 'node:url'
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'

import {
  MANIFEST_FILE,
  PENDING_MANIFEST_FILE,
  atomicWriteFileSync,
  buildManifest,
  invalidateManifest,
  sha256,
  stableStringify,
  verifyArtifactSet,
} from './artifact-manifest.mjs'
import { s10ImageRejectionBatchFor } from './image-rejection-batches.mjs'
import {
  matchReviewedImageRejection,
  validateReviewedImageRejects,
} from './reviewed-image-rejections.mjs'

const IMAGE_CLAIM_FIELDS = Object.freeze([
  'image',
  'imageCredit',
  'imageCandidate',
  'imageEvidence',
  'imageProvenance',
  'imageAttribution',
  'imageSha256',
])

export const IMAGE_REJECTION_RECEIPT_FILE = 'reviewed-image-rejections.receipt.json'
export const IMAGE_REJECTION_JOURNAL_FILE = 'reviewed-image-rejections.pending.json'

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${error.message})`)
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function jsonBytes(value, { newline = false } = {}) {
  return `${JSON.stringify(value, null, 2)}${newline ? '\n' : ''}`
}

function fileSnapshot(file) {
  if (!existsSync(file)) return { exists: false }
  const bytes = readFileSync(file)
  return {
    exists: true,
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString('base64'),
  }
}

function snapshotBytes(snapshot, label) {
  invariant(snapshot && typeof snapshot === 'object', `${label} recovery snapshot is missing`)
  if (snapshot.exists === false) return null
  invariant(snapshot.exists === true, `${label} recovery snapshot existence is invalid`)
  invariant(Number.isSafeInteger(snapshot.bytes) && snapshot.bytes >= 0, `${label} recovery byte count is invalid`)
  invariant(/^[a-f0-9]{64}$/.test(snapshot.sha256 || ''), `${label} recovery digest is invalid`)
  invariant(typeof snapshot.base64 === 'string', `${label} recovery bytes are missing`)
  const bytes = Buffer.from(snapshot.base64, 'base64')
  invariant(bytes.length === snapshot.bytes, `${label} recovery byte count drifted`)
  invariant(sha256(bytes) === snapshot.sha256, `${label} recovery digest drifted`)
  return bytes
}

function restoreSnapshot(file, snapshot, label) {
  const bytes = snapshotBytes(snapshot, label)
  if (bytes === null) {
    rmSync(file, { force: true })
    return
  }
  atomicWriteFileSync(file, bytes)
}

function assertSnapshot(file, snapshot, label) {
  const actual = fileSnapshot(file)
  invariant(sameValue(actual, snapshot), `${label} recovery write did not verify byte-for-byte`)
}

function pathIdentity(value) {
  const normalized = path.normalize(value).replace(/^\\\\\?\\/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function assertRegularContainedDirectory(directory, label) {
  const absolute = path.resolve(directory)
  const info = lstatSync(absolute)
  invariant(info.isDirectory() && !info.isSymbolicLink(), `${label} must be a regular directory`)
  invariant(pathIdentity(realpathSync.native(absolute)) === pathIdentity(absolute),
    `${label} path must not contain a symlink or junction`)
}

function assertSafeMutationRoots(artifactRoot, cacheRoot) {
  assertRegularContainedDirectory(artifactRoot, 'artifact root')
  assertRegularContainedDirectory(cacheRoot, 'cache root')
  assertRegularContainedDirectory(path.join(artifactRoot, 'place-img'), 'place image root')
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right)
}

function receiptFields(entry) {
  return {
    runId: entry.runId,
    generatedAt: entry.generatedAt,
    provenance: entry.provenance,
    sourceHealth: entry.sourceHealth,
  }
}

function componentReceiptIdentity(entry) {
  return {
    runId: entry.runId,
    generatedAt: entry.generatedAt,
    expiresAt: entry.expiresAt,
    maxAgeHours: entry.maxAgeHours,
    provenance: entry.provenance,
    sourceHealth: entry.sourceHealth,
    count: entry.count,
  }
}

function candidateFor(place) {
  return {
    image: place.image,
    sourcePage: place.imageCredit?.url,
    sourceFamily: place.imageCredit?.sourceFamily,
  }
}

function stripRejectedClaims(place, rejection) {
  const next = clone(place)
  for (const field of IMAGE_CLAIM_FIELDS) delete next[field]

  if (Array.isArray(next.imageCandidates)) {
    next.imageCandidates = next.imageCandidates.filter(candidate => {
      const image = candidate?.image
      const sourcePage = candidate?.sourcePage ?? candidate?.url
      const sourceFamily = candidate?.sourceFamily
      return image !== rejection.image
        || sourcePage !== rejection.sourcePage
        || sourceFamily !== rejection.sourceFamily
    })
    if (!next.imageCandidates.length) delete next.imageCandidates
  }

  return next
}

function localImageName(image) {
  invariant(
    /^\/place-img\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/i.test(String(image || '')),
    `unsafe reviewed local image path '${image}'`,
  )
  return image.slice('/place-img/'.length)
}

function registryDigest(rejects) {
  return `sha256:${sha256(Buffer.from(stableStringify(rejects)))}`
}

function journalDigest(payload) {
  return `sha256:${sha256(Buffer.from(stableStringify(payload)))}`
}

function buildRecoveryJournal({ cityId, timeZone, rejects, batch, previousManifest, placesPath, attribution, local, appliedAt }) {
  const payload = {
    cityId,
    timeZone,
    auditReportSha256: batch.auditReportSha256,
    registrySha256: registryDigest(rejects),
    createdAt: appliedAt,
    preimageManifest: previousManifest,
    original: {
      places: fileSnapshot(placesPath),
      attributions: attribution.changed ? fileSnapshot(attribution.file) : null,
      mapillary: local.mapChanged ? fileSnapshot(local.mapFile) : null,
      localImages: local.deletions.map(({ key, file, image }) => ({
        key,
        image,
        name: localImageName(image),
        snapshot: fileSnapshot(file),
      })),
    },
  }
  return {
    schemaVersion: 1,
    payload,
    payloadSha256: journalDigest(payload),
  }
}

function readRecoveryJournal(journalPath, { cityId, timeZone, batch }) {
  const journal = readJson(journalPath, 'reviewed image rejection recovery journal')
  invariant(journal?.schemaVersion === 1, `${cityId} recovery journal schema is unsupported`)
  invariant(journal.payloadSha256 === journalDigest(journal.payload), `${cityId} recovery journal digest drifted`)
  const payload = journal.payload
  invariant(payload?.cityId === cityId, `${cityId} recovery journal city drifted`)
  invariant(payload.timeZone === timeZone, `${cityId} recovery journal timezone drifted`)
  invariant(payload.auditReportSha256 === batch.auditReportSha256, `${cityId} recovery journal audit drifted`)
  invariant(payload.preimageManifest?.manifestId === batch.expectedPreimage.manifestId,
    `${cityId} recovery journal preimage manifest drifted`)
  invariant(payload.preimageManifest?.artifacts?.places?.sha256 === batch.expectedPreimage.placesSha256,
    `${cityId} recovery journal preimage places drifted`)
  invariant(payload.original?.places?.sha256 === batch.expectedPreimage.placesSha256,
    `${cityId} recovery journal places snapshot drifted`)

  const localEntries = Array.isArray(payload.original?.localImages) ? payload.original.localImages : []
  invariant(localEntries.length === Object.keys(batch.localImages).length,
    `${cityId} recovery journal local image set drifted`)
  const seen = new Set()
  for (const entry of localEntries) {
    invariant(entry && typeof entry.key === 'string' && !seen.has(entry.key),
      `${cityId} recovery journal has a duplicate local image key`)
    seen.add(entry.key)
    const binding = batch.localImages[entry.key]
    invariant(binding && entry.image === binding.image && entry.name === localImageName(binding.image),
      `${cityId}:${entry.key} recovery journal local image binding drifted`)
    const bytes = snapshotBytes(entry.snapshot, `${cityId}:${entry.key} local image`)
    invariant(bytes !== null && bytes.length === binding.bytes && sha256(bytes) === binding.sha256,
      `${cityId}:${entry.key} recovery journal local image bytes drifted`)
  }
  return journal
}

function assertCurrentMatchesJournal({ artifactRoot, cacheRoot, cityId, payload }) {
  assertSnapshot(path.join(artifactRoot, 'places.json'), payload.original.places, `${cityId} places`)
  if (payload.original.attributions) {
    assertSnapshot(path.join(cacheRoot, 'attributions.json'), payload.original.attributions, `${cityId} attributions`)
  }
  if (payload.original.mapillary) {
    assertSnapshot(path.join(cacheRoot, 'place-mapillary-images.json'), payload.original.mapillary, `${cityId} Mapillary receipt`)
  }
  for (const entry of payload.original.localImages) {
    assertSnapshot(
      path.join(artifactRoot, 'place-img', entry.name),
      entry.snapshot,
      `${cityId}:${entry.key} local image`,
    )
  }
}

function recoverInterruptedCorrection({
  artifactRoot,
  cacheRoot,
  cityId,
  timeZone,
  batch,
  journalPath,
  receiptPath,
  interruptAfter,
}) {
  // This path is entered only when there is no valid public manifest. Restore
  // exact member bytes while the trust pointer remains absent. The embedded
  // preimage manifest is validation evidence only; it is never republished.
  rmSync(path.join(artifactRoot, MANIFEST_FILE), { force: true })
  const { payload } = readRecoveryJournal(journalPath, { cityId, timeZone, batch })
  const placesPath = path.join(artifactRoot, 'places.json')
  restoreSnapshot(placesPath, payload.original.places, `${cityId} places`)
  if (payload.original.attributions) {
    restoreSnapshot(path.join(cacheRoot, 'attributions.json'), payload.original.attributions, `${cityId} attributions`)
  }
  if (payload.original.mapillary) {
    restoreSnapshot(path.join(cacheRoot, 'place-mapillary-images.json'), payload.original.mapillary, `${cityId} Mapillary receipt`)
  }
  for (const entry of payload.original.localImages) {
    restoreSnapshot(
      path.join(artifactRoot, 'place-img', entry.name),
      entry.snapshot,
      `${cityId}:${entry.key} local image`,
    )
  }
  assertCurrentMatchesJournal({ artifactRoot, cacheRoot, cityId, payload })
  if (interruptAfter === 'recovery-members') {
    throw new Error('injected image-rejection interruption after recovery member writes')
  }

  const restored = buildManifest({
    root: artifactRoot,
    cityId,
    timeZone,
    previousManifest: payload.preimageManifest,
  })
  invariant(restored.manifestId === payload.preimageManifest.manifestId,
    `${cityId} recovered members do not match the journal preimage`)
  invariant(restored.buildId === payload.preimageManifest.buildId,
    `${cityId} recovered build does not match the journal preimage`)
  invariant(restored.artifacts.places.sha256 === batch.expectedPreimage.placesSha256,
    `${cityId} recovered places do not match the reviewed preimage`)
  if (interruptAfter === 'recovery-validated') {
    throw new Error('injected image-rejection interruption after off-pointer recovery validation')
  }
  rmSync(receiptPath, { force: true })
  return payload.preimageManifest
}

function assertBatch(batch, cityId) {
  invariant(batch?.schemaVersion === 1, `${cityId} image-rejection batch schema is unsupported`)
  invariant(/^sha256:[a-f0-9]{64}$/.test(batch?.auditReportSha256 || ''), `${cityId} audit report digest is invalid`)
  invariant(/^sha256:[a-f0-9]{64}$/.test(batch?.expectedPreimage?.manifestId || ''), `${cityId} preimage manifest is invalid`)
  invariant(/^sha256:[a-f0-9]{64}$/.test(batch?.expectedPreimage?.buildId || ''), `${cityId} preimage build is invalid`)
  invariant(/^[a-f0-9]{64}$/.test(batch?.expectedPreimage?.placesSha256 || ''), `${cityId} preimage places digest is invalid`)
  invariant(Array.isArray(batch?.expectedRemoved?.attributionEntries), `${cityId} expected attribution removals are missing`)
  invariant(batch.expectedRemoved.attributionEntries.every(key => typeof key === 'string' && key),
    `${cityId} expected attribution removal key is invalid`)
  invariant(new Set(batch.expectedRemoved.attributionEntries).size === batch.expectedRemoved.attributionEntries.length,
    `${cityId} expected attribution removals contain duplicates`)
  invariant(sameValue(batch.expectedRemoved.attributionEntries, batch.expectedRemoved.attributionEntries.slice().sort()),
    `${cityId} expected attribution removals are not canonical`)
  invariant(batch.localImages && typeof batch.localImages === 'object', `${cityId} local image bindings are missing`)
}

function targetRows(places, rejects, { requireClaims }) {
  const byKey = new Map()
  places.forEach((place, index) => {
    if (!place?.key) return
    const rows = byKey.get(place.key) || []
    rows.push({ place, index })
    byKey.set(place.key, rows)
  })

  const targets = []
  for (const rejection of Object.values(rejects)) {
    const rows = byKey.get(rejection.placeKey) || []
    invariant(rows.length === 1, `${rejection.cityId}:${rejection.placeKey} must resolve to exactly one place row`)
    const [{ place, index }] = rows
    if (requireClaims) {
      const match = matchReviewedImageRejection(place, candidateFor(place), rejects)
      invariant(
        match.state === 'reject',
        `${rejection.cityId}:${rejection.placeKey} candidate drifted from the reviewed image; refusing stale correction`,
      )
    } else {
      invariant(place.image === undefined, `${rejection.cityId}:${rejection.placeKey} still ships an image after correction`)
      invariant(place.imageCredit === undefined, `${rejection.cityId}:${rejection.placeKey} still ships image credit after correction`)
    }
    targets.push({ index, place, rejection })
  }
  return targets.sort((left, right) => left.index - right.index)
}

function prepareAttributionChange(cacheRoot, nextPlaces, targets) {
  const file = path.join(cacheRoot, 'attributions.json')
  if (!existsSync(file)) return { file, changed: false, value: null, removed: [] }
  const original = readJson(file, 'image attribution ledger')
  invariant(original && typeof original === 'object' && original.byFile && typeof original.byFile === 'object',
    'image attribution ledger must contain byFile')
  const next = clone(original)
  const rejectedPages = new Set(targets.map(({ rejection }) => rejection.sourcePage))
  const retainedPages = new Set(nextPlaces.map(place => place?.imageCredit?.url).filter(Boolean))
  const removed = []

  for (const [key, entry] of Object.entries(next.byFile)) {
    if (rejectedPages.has(entry?.fileUrl) && !retainedPages.has(entry.fileUrl)) {
      delete next.byFile[key]
      removed.push(key)
    }
  }
  invariant(next.fetchedAt === original.fetchedAt, 'policy-only attribution cleanup changed fetchedAt')
  return { file, changed: !sameValue(original, next), value: next, removed: removed.sort() }
}

function prepareLocalChanges({ artifactRoot, cacheRoot, nextPlaces, targets, batch }) {
  const expected = batch.localImages
  const localTargets = targets.filter(({ rejection }) => rejection.image.startsWith('/place-img/'))
  invariant(localTargets.length === Object.keys(expected).length,
    'local image batch bindings do not match the reviewed local targets')

  const mapFile = path.join(cacheRoot, 'place-mapillary-images.json')
  const originalMap = localTargets.length ? readJson(mapFile, 'Mapillary image receipt') : null
  if (localTargets.length) {
    invariant(originalMap?.byKey && typeof originalMap.byKey === 'object', 'Mapillary image receipt must contain byKey')
  }
  const nextMap = originalMap ? clone(originalMap) : null
  const retainedLocal = new Set(nextPlaces.map(place => place?.image).filter(image => String(image || '').startsWith('/place-img/')))
  const deletions = []

  for (const { rejection } of localTargets) {
    const binding = expected[rejection.placeKey]
    invariant(binding, `${rejection.placeKey} is missing its local byte binding`)
    invariant(binding.image === rejection.image, `${rejection.placeKey} local binding image drifted`)
    const cached = originalMap.byKey[rejection.placeKey]
    invariant(cached, `${rejection.placeKey} is missing its Mapillary receipt`)
    invariant(String(cached.id) === binding.mapillaryId, `${rejection.placeKey} Mapillary pKey drifted`)
    invariant(cached.image === binding.image, `${rejection.placeKey} Mapillary image path drifted`)
    invariant(cached.mapillaryUrl === rejection.sourcePage, `${rejection.placeKey} Mapillary source page drifted`)
    invariant(!retainedLocal.has(binding.image), `${rejection.placeKey} local image still has a retained consumer`)

    const name = localImageName(binding.image)
    const file = path.join(artifactRoot, 'place-img', name)
    invariant(existsSync(file), `${rejection.placeKey} reviewed local image is missing`)
    const info = lstatSync(file)
    invariant(info.isFile() && !info.isSymbolicLink(), `${rejection.placeKey} reviewed local image is not a regular file`)
    const bytes = readFileSync(file)
    invariant(bytes.length === binding.bytes, `${rejection.placeKey} reviewed local image byte count drifted`)
    invariant(sha256(bytes) === binding.sha256, `${rejection.placeKey} reviewed local image digest drifted`)
    deletions.push({ key: rejection.placeKey, file, image: binding.image, bytes: binding.bytes, sha256: binding.sha256 })
    delete nextMap.byKey[rejection.placeKey]
  }

  if (nextMap) invariant(nextMap.fetchedAt === originalMap.fetchedAt, 'policy-only Mapillary cleanup changed fetchedAt')
  return {
    mapFile,
    mapChanged: nextMap ? !sameValue(originalMap, nextMap) : false,
    mapValue: nextMap,
    deletions,
  }
}

function assertReceiptBatchIdentity({ receipt, cityId, rejects, batch }) {
  invariant(receipt?.schemaVersion === 1 && receipt.cityId === cityId, `${cityId} correction receipt is invalid`)
  invariant(!Number.isNaN(Date.parse(receipt.appliedAt)), `${cityId} correction receipt appliedAt is invalid`)
  invariant(receipt.auditDocument === batch.auditDocument, `${cityId} correction receipt audit document drifted`)
  invariant(receipt.auditReportSha256 === batch.auditReportSha256, `${cityId} correction receipt audit drifted`)
  invariant(receipt.registrySha256 === registryDigest(rejects), `${cityId} correction receipt registry drifted`)
  invariant(receipt.preimage?.manifestId === batch.expectedPreimage.manifestId,
    `${cityId} correction receipt preimage manifest drifted`)
  invariant(receipt.preimage?.placesSha256 === batch.expectedPreimage.placesSha256,
    `${cityId} correction receipt preimage places drifted`)
  invariant(receipt.preimage?.buildId === batch.expectedPreimage.buildId,
    `${cityId} correction receipt preimage build drifted`)
}

function verifyIdempotentState({ artifactRoot, cacheRoot, cityId, timeZone, rejects, batch, receipt }) {
  const verified = verifyArtifactSet({ root: artifactRoot, expectedCityId: cityId, expectedTimeZone: timeZone })
  invariant(verified.ok, `corrected ${cityId} artifact is not trusted (${verified.problems.join(' · ')})`)
  assertReceiptBatchIdentity({ receipt, cityId, rejects, batch })
  invariant(verified.manifest.manifestId !== receipt.preimage.manifestId,
    `${cityId} correction receipt does not describe a changed artifact`)
  invariant(receipt.result?.manifestId === verified.manifest.manifestId, `${cityId} corrected manifest drifted from its receipt`)
  invariant(receipt.result?.buildId === verified.manifest.buildId, `${cityId} corrected build drifted from its receipt`)
  invariant(receipt.result?.placesSha256 === verified.manifest.artifacts.places.sha256,
    `${cityId} corrected places drifted from its receipt`)
  invariant(receipt.result?.placeImagesSha256 === verified.manifest.placeImages.sha256,
    `${cityId} corrected image tree drifted from its receipt`)
  invariant(receipt.result?.placeImagesCount === verified.manifest.placeImages.count,
    `${cityId} corrected image count drifted from its receipt`)

  const placesDoc = readJson(path.join(artifactRoot, 'places.json'), 'corrected places artifact')
  const targets = targetRows(placesDoc.places || [], rejects, { requireClaims: false })
  const expectedPlaceClaims = targets.map(({ rejection }) => rejection.placeKey)
  invariant(sameValue(receipt.removed?.placeClaims, expectedPlaceClaims),
    `${cityId} correction receipt place-claim set drifted`)
  const expectedLocal = targets
    .filter(({ rejection }) => Object.hasOwn(batch.localImages, rejection.placeKey))
    .map(({ rejection }) => {
      const binding = batch.localImages[rejection.placeKey]
      return {
        key: rejection.placeKey,
        image: binding.image,
        bytes: binding.bytes,
        sha256: binding.sha256,
      }
    })
  invariant(sameValue(receipt.removed?.mapillaryEntries, expectedLocal.map(entry => entry.key)),
    `${cityId} correction receipt Mapillary set drifted`)
  invariant(sameValue(receipt.removed?.localImages, expectedLocal),
    `${cityId} correction receipt local-image set drifted`)
  for (const binding of Object.values(batch.localImages)) {
    const name = localImageName(binding.image)
    invariant(!existsSync(path.join(artifactRoot, 'place-img', name)), `${binding.image} returned after correction`)
  }
  if (Object.keys(batch.localImages).length) {
    const map = readJson(path.join(cacheRoot, 'place-mapillary-images.json'), 'corrected Mapillary receipt')
    for (const key of Object.keys(batch.localImages)) {
      invariant(!Object.hasOwn(map.byKey || {}, key), `${key} returned to the Mapillary receipt after correction`)
    }
  }
  invariant(sameValue(receipt.removed?.attributionEntries, batch.expectedRemoved.attributionEntries),
    `${cityId} correction receipt attribution set drifted`)
  const attributionFile = path.join(cacheRoot, 'attributions.json')
  invariant(receipt.removed.attributionEntries.length === 0 || existsSync(attributionFile),
    `${cityId} corrected attribution ledger is missing`)
  if (existsSync(attributionFile)) {
    const attributions = readJson(attributionFile, 'corrected image attribution ledger')
    for (const key of receipt.removed.attributionEntries) {
      invariant(!Object.hasOwn(attributions.byFile || {}, key), `${key} returned to the attribution ledger after correction`)
    }
    const retainedPages = new Set((placesDoc.places || []).map(place => place?.imageCredit?.url).filter(Boolean))
    const rejectedUnretainedPages = new Set(Object.values(rejects)
      .map(rejection => rejection.sourcePage)
      .filter(sourcePage => !retainedPages.has(sourcePage)))
    for (const entry of Object.values(attributions.byFile || {})) {
      invariant(!rejectedUnretainedPages.has(entry?.fileUrl),
        `${cityId} rejected unretained attribution remains in the corrected ledger`)
    }
  }
  return { status: 'unchanged', manifest: verified.manifest, receipt }
}

function restoreUntrustedState(artifactRoot, previousManifest) {
  rmSync(path.join(artifactRoot, MANIFEST_FILE), { force: true })
  if (previousManifest) {
    atomicWriteFileSync(
      path.join(artifactRoot, PENDING_MANIFEST_FILE),
      jsonBytes(previousManifest, { newline: true }),
    )
  }
}

export function applyReviewedImageRejections({
  artifactRoot,
  cacheRoot,
  cityId,
  timeZone,
  imageRejects,
  batch,
  appliedAt = new Date().toISOString(),
  interruptAfter = null,
}) {
  invariant(typeof artifactRoot === 'string' && artifactRoot, 'artifactRoot is required')
  invariant(typeof cacheRoot === 'string' && cacheRoot, 'cacheRoot is required')
  invariant(typeof cityId === 'string' && cityId, 'cityId is required')
  invariant(typeof timeZone === 'string' && timeZone, 'timeZone is required')
  assertSafeMutationRoots(artifactRoot, cacheRoot)
  assertBatch(batch, cityId)
  const rejects = validateReviewedImageRejects(imageRejects)
  invariant(Object.values(rejects).every(entry => entry.cityId === cityId), 'image rejection registry city does not match the batch')
  invariant(Object.values(rejects).every(entry => entry.evidence.reportSha256 === batch.auditReportSha256),
    'image rejection registry is not bound to the batch audit report')

  const receiptPath = path.join(cacheRoot, IMAGE_REJECTION_RECEIPT_FILE)
  const journalPath = path.join(cacheRoot, IMAGE_REJECTION_JOURNAL_FILE)
  let recoveredPreimage = null
  if (existsSync(journalPath)) {
    const current = verifyArtifactSet({ root: artifactRoot, expectedCityId: cityId, expectedTimeZone: timeZone })
    if (existsSync(receiptPath)) {
      try {
        const committed = verifyIdempotentState({
          artifactRoot,
          cacheRoot,
          cityId,
          timeZone,
          rejects,
          batch,
          receipt: readJson(receiptPath, 'reviewed image rejection receipt'),
        })
        rmSync(path.join(artifactRoot, PENDING_MANIFEST_FILE), { force: true })
        rmSync(journalPath, { force: true })
        return committed
      } catch {
        // A receipt alone is not a commit. Classify the current trusted
        // artifact before deciding whether journal recovery is authorized.
      }
    }
    if (current.ok) {
      if (current.manifest.manifestId !== batch.expectedPreimage.manifestId) {
        throw new Error(`${cityId} recovery journal is stale beside a different trusted artifact; refusing mutation`)
      }
      const { payload } = readRecoveryJournal(journalPath, { cityId, timeZone, batch })
      assertCurrentMatchesJournal({ artifactRoot, cacheRoot, cityId, payload })
      if (existsSync(receiptPath)) {
        assertReceiptBatchIdentity({
          receipt: readJson(receiptPath, 'reviewed image rejection receipt'),
          cityId,
          rejects,
          batch,
        })
        rmSync(receiptPath, { force: true })
      }
      // The exact preimage is still fully trusted, so no mutation began.
      // Discard the stale journal and start a fresh transaction normally.
      rmSync(path.join(artifactRoot, PENDING_MANIFEST_FILE), { force: true })
      rmSync(journalPath, { force: true })
    } else {
      recoveredPreimage = recoverInterruptedCorrection({
        artifactRoot,
        cacheRoot,
        cityId,
        timeZone,
        batch,
        journalPath,
        receiptPath,
        interruptAfter,
      })
    }
  }
  if (existsSync(receiptPath)) {
    return verifyIdempotentState({
      artifactRoot,
      cacheRoot,
      cityId,
      timeZone,
      rejects,
      batch,
      receipt: readJson(receiptPath, 'reviewed image rejection receipt'),
    })
  }

  const verified = recoveredPreimage
    ? { ok: true, problems: [], manifest: recoveredPreimage }
    : verifyArtifactSet({ root: artifactRoot, expectedCityId: cityId, expectedTimeZone: timeZone })
  invariant(verified.ok, `${cityId} artifact preimage is not trusted (${verified.problems.join(' · ')})`)
  const previousManifest = verified.manifest
  invariant(previousManifest.manifestId === batch.expectedPreimage.manifestId, `${cityId} artifact manifest is not the reviewed preimage`)
  invariant(previousManifest.artifacts.places.sha256 === batch.expectedPreimage.placesSha256,
    `${cityId} places artifact is not the reviewed preimage`)

  const placesPath = path.join(artifactRoot, 'places.json')
  const originalPlacesDoc = readJson(placesPath, 'places artifact')
  invariant(Array.isArray(originalPlacesDoc.places), 'places artifact must contain places[]')
  const targets = targetRows(originalPlacesDoc.places, rejects, { requireClaims: true })
  const nextPlacesDoc = clone(originalPlacesDoc)
  for (const { index, rejection } of targets) {
    nextPlacesDoc.places[index] = stripRejectedClaims(originalPlacesDoc.places[index], rejection)
  }

  const targetIndexes = new Set(targets.map(({ index }) => index))
  originalPlacesDoc.places.forEach((place, index) => {
    if (!targetIndexes.has(index)) {
      invariant(sameValue(place, nextPlacesDoc.places[index]), `non-target place row ${index} changed during correction planning`)
    }
  })
  invariant(nextPlacesDoc.places.length === originalPlacesDoc.places.length, 'place count changed during correction planning')

  const attribution = prepareAttributionChange(cacheRoot, nextPlacesDoc.places, targets)
  invariant(sameValue(attribution.removed, batch.expectedRemoved.attributionEntries),
    `${cityId} attribution removals drifted from the reviewed preimage`)
  const local = prepareLocalChanges({ artifactRoot, cacheRoot, nextPlaces: nextPlacesDoc.places, targets, batch })
  const beforeComponents = Object.fromEntries(Object.entries(previousManifest.artifacts)
    .map(([kind, entry]) => [kind, componentReceiptIdentity(entry)]))
  const beforeMemberHashes = Object.fromEntries(Object.entries(previousManifest.artifacts)
    .map(([kind, entry]) => [kind, entry.sha256]))
  const journal = buildRecoveryJournal({
    cityId,
    timeZone,
    rejects,
    batch,
    previousManifest,
    placesPath,
    attribution,
    local,
    appliedAt,
  })

  let transactionStarted = false
  try {
    if (recoveredPreimage) {
      invariant(existsSync(journalPath), 'recovered correction lost its recovery journal')
      invariant(!existsSync(path.join(artifactRoot, MANIFEST_FILE)),
        'recovered correction must remain off-pointer until commit')
      transactionStarted = true
    } else {
      // Atomic replacement plus the journal covers ordinary process
      // interruption. This code does not fsync files/directories and therefore
      // makes no sudden-power-loss durability guarantee.
      atomicWriteFileSync(journalPath, jsonBytes(journal, { newline: true }))
      transactionStarted = true
      if (interruptAfter === 'journal') throw new Error('injected image-rejection interruption after journal write')
      const captured = invalidateManifest(artifactRoot, {
        expectedCityId: cityId,
        expectedTimeZone: timeZone,
        preservePending: true,
      })
      invariant(captured?.manifestId === previousManifest.manifestId, 'manifest changed between preflight and invalidation')
      if (interruptAfter === 'invalidate') throw new Error('injected image-rejection interruption after invalidation')
    }

    atomicWriteFileSync(placesPath, jsonBytes(nextPlacesDoc, { newline: true }))
    if (attribution.changed) atomicWriteFileSync(attribution.file, jsonBytes(attribution.value))
    if (local.mapChanged) atomicWriteFileSync(local.mapFile, jsonBytes(local.mapValue))
    if (interruptAfter === 'json') throw new Error('injected image-rejection interruption after JSON writes')

    for (const deletion of local.deletions) rmSync(deletion.file)
    if (interruptAfter === 'files') throw new Error('injected image-rejection interruption after local image deletion')

    const nextManifest = buildManifest({
      root: artifactRoot,
      cityId,
      timeZone,
      assembledAt: appliedAt,
      previousManifest,
      componentReceipts: {
        places: receiptFields(previousManifest.artifacts.places),
      },
    })
    invariant(nextManifest.artifacts.places.count === previousManifest.artifacts.places.count, 'places count changed')
    invariant(nextManifest.artifacts.places.sha256 !== previousManifest.artifacts.places.sha256, 'places bytes did not change')

    for (const [kind, before] of Object.entries(beforeComponents)) {
      invariant(sameValue(componentReceiptIdentity(nextManifest.artifacts[kind]), before),
        `${kind} generation/source receipt changed during image correction`)
      if (kind !== 'places') {
        invariant(nextManifest.artifacts[kind].sha256 === beforeMemberHashes[kind], `${kind} bytes changed during image correction`)
      }
    }
    invariant(sameValue(nextManifest.sourceHealth, previousManifest.sourceHealth), 'manifest source health changed during image correction')

    const receipt = {
      schemaVersion: 1,
      cityId,
      appliedAt,
      auditDocument: batch.auditDocument,
      auditReportSha256: batch.auditReportSha256,
      registrySha256: registryDigest(rejects),
      preimage: {
        manifestId: previousManifest.manifestId,
        buildId: previousManifest.buildId,
        placesSha256: previousManifest.artifacts.places.sha256,
      },
      result: {
        manifestId: nextManifest.manifestId,
        buildId: nextManifest.buildId,
        placesSha256: nextManifest.artifacts.places.sha256,
        placeImagesSha256: nextManifest.placeImages.sha256,
        placeImagesCount: nextManifest.placeImages.count,
      },
      removed: {
        placeClaims: targets.map(({ rejection }) => rejection.placeKey),
        attributionEntries: attribution.removed,
        mapillaryEntries: local.deletions.map(({ key }) => key),
        localImages: local.deletions.map(({ key, image, bytes, sha256: digest }) => ({
          key,
          image,
          bytes,
          sha256: digest,
        })),
      },
    }
    atomicWriteFileSync(receiptPath, jsonBytes(receipt, { newline: true }))
    if (interruptAfter === 'receipt') throw new Error('injected image-rejection interruption after receipt write')
    atomicWriteFileSync(
      path.join(artifactRoot, MANIFEST_FILE),
      jsonBytes(nextManifest, { newline: true }),
    )
    if (interruptAfter === 'manifest') throw new Error('injected image-rejection interruption after manifest write')
    const final = verifyArtifactSet({ root: artifactRoot, expectedCityId: cityId, expectedTimeZone: timeZone })
    invariant(final.ok, `corrected ${cityId} artifact failed verification (${final.problems.join(' · ')})`)
    invariant(final.manifest.manifestId === nextManifest.manifestId, 'written correction manifest did not verify byte-for-byte')
    rmSync(path.join(artifactRoot, PENDING_MANIFEST_FILE), { force: true })
    rmSync(journalPath, { force: true })
    transactionStarted = false
    return { status: 'applied', manifest: final.manifest, receipt }
  } catch (error) {
    if (transactionStarted) {
      restoreUntrustedState(artifactRoot, previousManifest)
      rmSync(receiptPath, { force: true })
    }
    throw error
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const city = await import('./cities/index.mjs')
  const batch = s10ImageRejectionBatchFor(city.cityId)
  const result = applyReviewedImageRejections({
    artifactRoot: path.join(root, 'finder', 'output', city.cityId),
    cacheRoot: path.join(root, 'finder', 'cache', city.cityId),
    cityId: city.cityId,
    timeZone: city.tz,
    imageRejects: city.imageRejects,
    batch,
  })
  console.log(`${city.cityId}: reviewed image correction ${result.status}; manifest ${result.manifest.manifestId}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
