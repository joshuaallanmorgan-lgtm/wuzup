import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { flagshipImageReviewSha256 } from '../shared/flagship-image-review.mjs'

import {
  assertSafeFlagshipImageReviewSessionRoot,
  fetchFlagshipImageReviewPixel,
  finalizeFlagshipImageReviewSession as finalizeSessionImpl,
  flagshipImageOwnerPolicySha256,
  prepareFlagshipImageReviewSession,
  verifyFlagshipImageDecisionBundle as verifyBundleImpl,
} from '../shared/flagship-image-review-session.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REVIEWED_AT = '2026-07-21T20:00:00.000Z'
const NOW = () => new Date(REVIEWED_AT)
const SESSION_SEALS = new Map()
const DECISION_RECEIPT_HASHES = new Map()
const JPEG = await sharp({
  create: {
    width: 16,
    height: 12,
    channels: 3,
    background: { r: 120, g: 80, b: 180 },
  },
}).jpeg().toBuffer()
const OTHER_JPEG = await sharp({
  create: {
    width: 17,
    height: 13,
    channels: 3,
    background: { r: 10, g: 180, b: 90 },
  },
}).jpeg().toBuffer()

async function temporaryDirectory(t, prefix = 'wuzup-s10-review-test-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function mockResponse(url, {
  bytes = JPEG,
  status = 200,
  finalUrl = url,
  contentType = 'image/jpeg',
  contentLength = bytes.length,
  retryAfter = null,
} = {}) {
  const headers = new Headers()
  if (contentType != null) headers.set('content-type', contentType)
  if (contentLength != null) headers.set('content-length', String(contentLength))
  if (retryAfter != null) headers.set('retry-after', String(retryAfter))
  const response = new Response(bytes, { status, headers })
  Object.defineProperty(response, 'url', { value: finalUrl })
  return response
}

function successfulFetcher(calls = []) {
  return async (url, options) => {
    calls.push({ url, options })
    return mockResponse(url)
  }
}

async function prepareFixture(t, overrides = {}) {
  const parent = await temporaryDirectory(t)
  const sessionDir = path.join(parent, 'session')
  const calls = []
  const result = await prepareFlagshipImageReviewSession({
    repoRoot: ROOT,
    sessionDir,
    fetchImpl: successfulFetcher(calls),
    now: NOW,
    sleepImpl: async () => {},
    timeoutMs: 1_000,
    maxRetries: 0,
    ...overrides,
  })
  SESSION_SEALS.set(result.sessionDir, result.evidenceSealSha256)
  t.after(() => SESSION_SEALS.delete(result.sessionDir))
  t.after(() => DECISION_RECEIPT_HASHES.delete(result.sessionDir))
  return { ...result, calls }
}

function ownerPolicy(review) {
  const sortedUnique = values => [...new Set(values)].sort((left, right) => left.localeCompare(right))
  return {
    schemaVersion: 1,
    state: 'owner-policy-ratification',
    authentication: 'not-cryptographically-authenticated',
    policyId: 'test-owner-policy-v1',
    owner: 'test-owner',
    ratifiedAt: REVIEWED_AT,
    reportSha256: flagshipImageReviewSha256(review),
    allowedLicenses: sortedUnique(review.items.map(item => item.credit.license)),
    allowedSourceFamilies: sortedUnique(review.items.map(item => item.credit.sourceFamily)),
    allowedDeliveries: sortedUnique(review.items.map(item => item.image.delivery)),
  }
}

async function finalizeFlagshipImageReviewSession({ reviewedAt: _reviewedAt, ...options }) {
  const review = JSON.parse(await readFile(path.join(options.sessionDir, 'review.json'), 'utf8'))
  const policy = ownerPolicy(review)
  const result = await finalizeSessionImpl({
    ...options,
    expectedEvidenceSealSha256: SESSION_SEALS.get(options.sessionDir),
    ownerPolicyReceipt: policy,
    expectedOwnerPolicySha256: flagshipImageOwnerPolicySha256({ review, receipt: policy }),
    expectedDecisionReceiptSha256: DECISION_RECEIPT_HASHES.get(options.sessionDir) || null,
    now: NOW,
  })
  DECISION_RECEIPT_HASHES.set(options.sessionDir, result.decisionReceiptSha256)
  return result
}

async function verifyFlagshipImageDecisionBundle(options) {
  const review = JSON.parse(await readFile(path.join(options.sessionDir, 'review.json'), 'utf8'))
  const policy = ownerPolicy(review)
  return verifyBundleImpl({
    ...options,
    expectedEvidenceSealSha256: SESSION_SEALS.get(options.sessionDir),
    expectedDecisionReceiptSha256: DECISION_RECEIPT_HASHES.get(options.sessionDir),
    ownerPolicyReceipt: policy,
    expectedOwnerPolicySha256: flagshipImageOwnerPolicySha256({ review, receipt: policy }),
  })
}

function csvField(value) {
  const string = String(value ?? '')
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string
}

async function writeDecisions(sessionDir, mutate = rows => rows) {
  const review = JSON.parse(await readFile(path.join(sessionDir, 'review.json'), 'utf8'))
  const template = await readFile(path.join(sessionDir, 'decisions.csv'), 'utf8')
  const lines = template.split(/\r?\n/).filter(Boolean)
  const keys = lines[0].split(',')
  assert.deepEqual(keys, [
    'sampleIndex', 'cityId', 'itemId', 'evidenceSha256', 'sourcePageCheckedAt', 'sourcePageFinalUrl',
    'sourcePageStatus', 'identity', 'pixel', 'creditLicense', 'resolution', 'notes',
  ])
  let rows = lines.slice(1).map((line, index) => {
    const fields = line.split(',')
    const row = Object.fromEntries(keys.map((key, index) => [key, fields[index]]))
    return {
      ...row,
      sourcePageCheckedAt: REVIEWED_AT,
      sourcePageFinalUrl: review.items[index].credit.sourcePage,
      sourcePageStatus: '200',
      identity: 'pass',
      pixel: 'pass',
      creditLicense: 'pass',
      resolution: 'keep',
      notes: 'Reviewed cached bytes and the exact source page.',
    }
  })
  rows = mutate(rows)
  const csv = `${keys.join(',')}\r\n${rows.map(row => keys.map(key => csvField(row[key])).join(',')).join('\r\n')}\r\n`
  await writeFile(path.join(sessionDir, 'decisions.csv'), csv)
  return review
}

async function readEvidence(sessionDir) {
  return JSON.parse(await readFile(path.join(sessionDir, 'evidence.json'), 'utf8'))
}

async function writeEvidence(sessionDir, evidence) {
  await writeFile(path.join(sessionDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
}

function evidenceBinding(row) {
  return `sha256:${createHash('sha256').update(JSON.stringify({
    sampleIndex: row.sampleIndex,
    cityId: row.cityId,
    itemId: row.itemId,
    imageReference: row.imageReference,
    delivery: row.delivery,
    pixelPath: row.pixelPath,
    reviewedBytes: row.reviewedBytes,
  })).digest('hex')}`
}

test('prepares one non-shipping bundle with unique remote fetches and deterministic reviewer artifacts', async (t) => {
  const pacingSleeps = []
  const prepared = await prepareFixture(t, {
    sleepImpl: async milliseconds => pacingSleeps.push(milliseconds),
  })
  assert.equal(prepared.itemCount, 100)
  assert.equal(prepared.uniqueRemoteReferences, 79)
  assert.match(prepared.evidenceSealSha256, /^sha256:[a-f0-9]{64}$/)
  assert.equal(prepared.calls.length, 79)
  assert.equal(new Set(prepared.calls.map(call => call.url)).size, 79)
  assert.equal(prepared.calls.every(call => call.url.startsWith('https://upload.wikimedia.org/')), true)
  assert.equal(prepared.calls.every(call => call.options.redirect === 'manual'), true)
  assert.equal(prepared.calls.every(call => call.options.headers['User-Agent'].includes('Wuzup/1.0')), true)
  assert.equal(pacingSleeps.length, 78)
  assert.equal(pacingSleeps.every(milliseconds => milliseconds === 500), true)

  const evidence = await readEvidence(prepared.sessionDir)
  assert.equal(evidence.state, 'review-only-not-for-shipping')
  assert.deepEqual(evidence.counts, {
    items: 100,
    remoteRows: 85,
    uniqueRemoteReferences: 79,
    localRows: 15,
  })
  assert.equal(evidence.items.length, 100)
  assert.equal(new Set(evidence.items.filter(item => item.delivery === 'remote')
    .map(item => item.pixelPath)).size, 1, 'identical mocked bytes share one content-addressed file')
  assert.equal(evidence.items.filter(item => item.delivery === 'self-hosted')
    .every(item => item.reviewedBytes.finalUrl === null), true)

  const decisions = await readFile(path.join(prepared.sessionDir, 'decisions.csv'), 'utf8')
  const contactSheet = await readFile(path.join(prepared.sessionDir, 'index.html'), 'utf8')
  assert.match(decisions, /^sampleIndex,cityId,itemId,evidenceSha256,sourcePageCheckedAt,sourcePageFinalUrl,sourcePageStatus,identity,pixel,creditLicense,resolution,notes\r?$/m)
  assert.equal(decisions.split(/\r?\n/).filter(Boolean).length, 101)
  assert.match(contactSheet, /Inspect all 100 cached byte sets/)
  assert.match(contactSheet, /rel="noopener noreferrer"/)
  assert.doesNotMatch(contactSheet, /src="https:\/\//)
})

test('defaults to an OS temporary session and refuses protected shipping and data paths', async (t) => {
  for (const protectedPath of [
    path.join(ROOT, 'app', 'public', 'review-only'),
    path.join(ROOT, 'finder', 'output', 'review-only'),
    path.join(ROOT, 'finder', 'cache', 'review-only'),
  ]) {
    await assert.rejects(
      assertSafeFlagshipImageReviewSessionRoot({ repoRoot: ROOT, sessionDir: protectedPath }),
      /protected shipping\/data path/,
    )
  }

  const result = await prepareFlagshipImageReviewSession({
    repoRoot: ROOT,
    fetchImpl: successfulFetcher(),
    now: NOW,
    sleepImpl: async () => {},
    timeoutMs: 1_000,
    maxRetries: 0,
  })
  t.after(() => rm(result.sessionDir, { recursive: true, force: true }))
  assert.equal(path.relative(os.tmpdir(), result.sessionDir).startsWith('..'), false)
  assert.match(path.basename(result.sessionDir), /^wuzup-s10-image-review-/)
})

test('refuses a pre-existing pixels symlink or junction before any network request', async (t) => {
  const parent = await temporaryDirectory(t)
  const sessionDir = path.join(parent, 'session')
  const pixelPath = path.join(sessionDir, 'pixels')
  await mkdir(sessionDir)
  try {
    await symlink(path.join(ROOT, 'app', 'public'), pixelPath, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip(`platform cannot create a review-path symlink: ${error.code}`)
      return
    }
    throw error
  }
  let fetchCalls = 0
  await assert.rejects(
    prepareFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir,
      fetchImpl: async url => {
        fetchCalls++
        return mockResponse(url)
      },
      now: NOW,
      maxRetries: 0,
    }),
    /real directory|resolve inside|protected shipping\/data path/,
  )
  assert.equal(fetchCalls, 0)
})

test('fetches with bounded retry and rejects redirect, final-URL, byte, MIME, decode, pixel, and timeout failures', async () => {
  const reference = 'https://upload.wikimedia.org/wikipedia/commons/test.jpg'
  let attempts = 0
  let pacedAttempts = 0
  const sleeps = []
  const retried = await fetchFlagshipImageReviewPixel({
    reference,
    fetchImpl: async (url, options) => {
      attempts++
      assert.match(options.headers['User-Agent'], /flagship-image-independent-review/)
      return attempts === 1
        ? mockResponse(url, { status: 429, retryAfter: 2 })
        : mockResponse(url)
    },
    now: NOW,
    sleepImpl: async milliseconds => sleeps.push(milliseconds),
    paceRequest: async () => { pacedAttempts++ },
    maxRetries: 1,
  })
  assert.equal(attempts, 2)
  assert.equal(pacedAttempts, 2, 'every initial or retry attempt passes through the shared pacer')
  assert.deepEqual(sleeps, [2_000])
  assert.equal(retried.evidence.finalUrl, reference)
  assert.equal(retried.evidence.mimeType, 'image/jpeg')
  assert.equal(retried.evidence.width, 16)

  let dateAttempts = 0
  const dateSleeps = []
  await fetchFlagshipImageReviewPixel({
    reference,
    fetchImpl: async url => {
      dateAttempts++
      return dateAttempts === 1
        ? mockResponse(url, { status: 503, retryAfter: 'Tue, 21 Jul 2026 20:00:12 GMT' })
        : mockResponse(url)
    },
    now: NOW,
    sleepImpl: async milliseconds => dateSleeps.push(milliseconds),
    maxRetries: 1,
  })
  assert.deepEqual(dateSleeps, [12_000])

  let cappedAttempts = 0
  const cappedSleeps = []
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => {
        cappedAttempts++
        return cappedAttempts === 1
          ? mockResponse(url, { status: 429, retryAfter: 120 })
          : mockResponse(url)
      },
      now: NOW,
      sleepImpl: async milliseconds => cappedSleeps.push(milliseconds),
      maxRetries: 1,
    }),
    /Retry-After exceeds.*safe wait/,
  )
  assert.equal(cappedAttempts, 1)
  assert.deepEqual(cappedSleeps, [])

  let fallbackAttempts = 0
  const fallbackSleeps = []
  await fetchFlagshipImageReviewPixel({
    reference,
    fetchImpl: async url => {
      fallbackAttempts++
      return fallbackAttempts === 1
        ? mockResponse(url, { status: 500, retryAfter: null })
        : mockResponse(url)
    },
    now: NOW,
    sleepImpl: async milliseconds => fallbackSleeps.push(milliseconds),
    maxRetries: 1,
  })
  assert.deepEqual(fallbackSleeps, [1_000])

  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference: 'https://example.test/image.jpg',
      fetchImpl: async () => assert.fail('wrong host must fail before fetch'),
    }),
    /HTTPS upload\.wikimedia\.org/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url, { status: 302 }),
      maxRetries: 0,
    }),
    /HTTP 302/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url, { finalUrl: `${url}?redirected=1` }),
      maxRetries: 0,
    }),
    /final URL does not match/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url, { contentLength: JPEG.length + 1 }),
      maxBytes: JPEG.length,
      maxRetries: 0,
    }),
    /byte limit/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url, { contentLength: null }),
      maxBytes: JPEG.length - 1,
      maxRetries: 0,
    }),
    /byte limit/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url, { contentType: 'image/png' }),
      maxRetries: 0,
    }),
    /decoded format does not match/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url, { bytes: Buffer.from('not-an-image') }),
      maxRetries: 0,
    }),
    /cannot be decoded safely/,
  )
  const truncated = JPEG.subarray(0, JPEG.length - 2)
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url, { bytes: truncated }),
      maxRetries: 0,
    }),
    /cannot be decoded safely/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async url => mockResponse(url),
      maxPixels: 100,
      maxRetries: 0,
    }),
    /cannot be decoded safely|pixel limits/,
  )
  await assert.rejects(
    fetchFlagshipImageReviewPixel({
      reference,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      }),
      timeoutMs: 5,
      maxRetries: 0,
    }),
    /timed out/,
  )
})

test('a failed prepare never publishes review or evidence markers', async (t) => {
  const parent = await temporaryDirectory(t)
  let concurrentFetches = 0
  await assert.rejects(
    prepareFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: path.join(parent, 'concurrency-session'),
      concurrency: 2,
      fetchImpl: async () => { concurrentFetches++; return assert.fail('concurrency must fail before fetch') },
      now: NOW,
    }),
    /concurrency must be exactly 1/,
  )
  assert.equal(concurrentFetches, 0)
  const sessionDir = path.join(parent, 'session')
  await mkdir(sessionDir)
  await writeFile(path.join(sessionDir, 'caller-owned.txt'), 'retain me')
  await assert.rejects(
    prepareFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir,
      fetchImpl: async url => mockResponse(url, { status: 404 }),
      now: NOW,
      maxRetries: 0,
    }),
    /HTTP 404/,
  )
  await assert.rejects(access(path.join(sessionDir, 'review.json')), /ENOENT/)
  await assert.rejects(access(path.join(sessionDir, 'evidence.json')), /ENOENT/)
  assert.equal(await readFile(path.join(sessionDir, 'caller-owned.txt'), 'utf8'), 'retain me')
  await access(path.join(sessionDir, 'pixels'))

  const beforeAutoSessions = new Set((await readdir(os.tmpdir()))
    .filter(name => name.startsWith('wuzup-s10-image-review-')))
  await assert.rejects(
    prepareFlagshipImageReviewSession({
      repoRoot: ROOT,
      fetchImpl: async url => mockResponse(url, { status: 404 }),
      now: NOW,
      sleepImpl: async () => {},
      maxRetries: 0,
    }),
    /HTTP 404/,
  )
  const afterAutoSessions = new Set((await readdir(os.tmpdir()))
    .filter(name => name.startsWith('wuzup-s10-image-review-')))
  assert.deepEqual(afterAutoSessions, beforeAutoSessions,
    'failed auto-created sessions must be removed without touching caller-owned sessions')

  const budgetSession = path.join(parent, 'budget-session')
  await assert.rejects(
    prepareFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: budgetSession,
      fetchImpl: successfulFetcher(),
      now: NOW,
      maxRetries: 0,
      maxSessionBytes: JPEG.length - 1,
    }),
    /total byte budget/,
  )
  await assert.rejects(access(path.join(budgetSession, 'evidence.json')), /ENOENT/)
})

test('finalizes exact decisions and composite verification rehashes every cached byte set', async (t) => {
  const prepared = await prepareFixture(t)
  const template = await readFile(path.join(prepared.sessionDir, 'decisions.csv'), 'utf8')
  const templateBindings = template.split(/\r?\n/).filter(Boolean).slice(1).map(line => line.split(',')[3])
  await writeDecisions(prepared.sessionDir)
  const filled = await readFile(path.join(prepared.sessionDir, 'decisions.csv'), 'utf8')
  const filledBindings = filled.split(/\r?\n/).filter(Boolean).slice(1).map(line => line.split(',')[3])
  assert.deepEqual(filledBindings, templateBindings, 'filling the generated template preserves every evidence binding')
  const finalized = await finalizeFlagshipImageReviewSession({
    repoRoot: ROOT,
    sessionDir: prepared.sessionDir,
    reviewer: 'independent-reviewer-test',
    reviewedAt: REVIEWED_AT,
  })
  assert.equal(finalized.complete, true)
  assert.equal(finalized.allItemsKept, true)
  assert.equal(finalized.ownerPolicyAuthentication, 'not-cryptographically-authenticated')
  assert.equal(finalized.kept, 100)
  assert.equal(finalized.actionRequired, 0)
  const receipt = JSON.parse(await readFile(finalized.receiptPath, 'utf8'))
  assert.equal(receipt.reviewedAt, REVIEWED_AT, 'finalization time comes from the trusted clock seam')
  assert.equal(receipt.ownerPolicyAuthentication, 'not-cryptographically-authenticated')
  assert.equal(receipt.items[0].notes, 'Reviewed cached bytes and the exact source page.')
  assert.deepEqual(receipt.items[0].sourcePageVerification, {
    checkedAt: REVIEWED_AT,
    finalUrl: JSON.parse(await readFile(path.join(prepared.sessionDir, 'review.json'), 'utf8'))
      .items[0].credit.sourcePage,
    httpStatus: 200,
  })
  assert.match(finalized.decisionReceiptSha256, /^sha256:[a-f0-9]{64}$/)
  assert.equal(finalized.receiptCreated, true)
  const originalReceiptBytes = await readFile(finalized.receiptPath)
  const repeated = await finalizeFlagshipImageReviewSession({
    repoRoot: ROOT,
    sessionDir: prepared.sessionDir,
    reviewer: 'independent-reviewer-test',
  })
  assert.equal(repeated.receiptCreated, false)
  assert.equal(repeated.decisionReceiptSha256, finalized.decisionReceiptSha256)
  assert.deepEqual(await readFile(finalized.receiptPath), originalReceiptBytes)

  const verified = await verifyFlagshipImageDecisionBundle({ repoRoot: ROOT, sessionDir: prepared.sessionDir })
  assert.equal(verified.ok, true)
  assert.equal(verified.allItemsKept, true)
  assert.ok(verified.uniquePixelFiles >= 16)

  await writeDecisions(prepared.sessionDir, rows => rows.map((row, index) =>
    index === 0 ? { ...row, notes: 'A conflicting second finalization must not replace the receipt.' } : row))
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'independent-reviewer-test',
    }),
    /already exists with conflicting finalized content/,
  )
  assert.deepEqual(await readFile(finalized.receiptPath), originalReceiptBytes)

  const evidence = await readEvidence(prepared.sessionDir)
  const unboundPath = path.join(prepared.sessionDir, 'pixels', `${'a'.repeat(64)}.jpg`)
  await writeFile(unboundPath, JPEG)
  await assert.rejects(
    verifyFlagshipImageDecisionBundle({ repoRoot: ROOT, sessionDir: prepared.sessionDir }),
    /missing or unbound cached bytes/,
  )
  await rm(unboundPath)

  const remote = evidence.items.find(item => item.delivery === 'remote')
  await writeFile(path.join(prepared.sessionDir, ...remote.pixelPath.split('/')), OTHER_JPEG)
  await assert.rejects(
    verifyFlagshipImageDecisionBundle({ repoRoot: ROOT, sessionDir: prepared.sessionDir }),
    /does not match session evidence/,
  )
})

test('verification rejects any canonical post-finalization receipt mutation by external digest', async (t) => {
  const prepared = await prepareFixture(t)
  await writeDecisions(prepared.sessionDir)
  const finalized = await finalizeFlagshipImageReviewSession({
    repoRoot: ROOT,
    sessionDir: prepared.sessionDir,
    reviewer: 'independent-reviewer-test',
  })
  await assert.rejects(
    verifyBundleImpl({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      expectedEvidenceSealSha256: prepared.evidenceSealSha256,
    }),
    /expectedDecisionReceiptSha256 must be the externally retained SHA-256/,
  )
  const receipt = JSON.parse(await readFile(finalized.receiptPath, 'utf8'))
  receipt.items[0].notes = 'Mutated after finalization.'
  await writeFile(finalized.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  await assert.rejects(
    verifyFlagshipImageDecisionBundle({ repoRoot: ROOT, sessionDir: prepared.sessionDir }),
    /does not match the externally retained finalized SHA-256/,
  )
})

test('seal and owner-policy evidence are mandatory for keep while needs-owner remains non-keeping', async (t) => {
  const prepared = await prepareFixture(t)
  const review = await writeDecisions(prepared.sessionDir)

  await assert.rejects(
    finalizeSessionImpl({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      now: NOW,
    }),
    /expectedEvidenceSealSha256/,
  )
  await assert.rejects(
    finalizeSessionImpl({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      expectedEvidenceSealSha256: prepared.evidenceSealSha256,
      now: NOW,
    }),
    /separately supplied owner-policy receipt/,
  )

  const policy = ownerPolicy(review)
  await assert.rejects(
    finalizeSessionImpl({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      expectedEvidenceSealSha256: prepared.evidenceSealSha256,
      ownerPolicyReceipt: policy,
      expectedOwnerPolicySha256: `sha256:${'f'.repeat(64)}`,
      now: NOW,
    }),
    /does not match the separately retained SHA-256/,
  )

  await writeDecisions(prepared.sessionDir, rows => rows.map(row => ({
    ...row,
    creditLicense: 'needs-owner',
    resolution: 'fallback',
    notes: 'License needs owner review; the image remains on fallback.',
  })))
  const finalized = await finalizeSessionImpl({
    repoRoot: ROOT,
    sessionDir: prepared.sessionDir,
    reviewer: 'reviewer',
    expectedEvidenceSealSha256: prepared.evidenceSealSha256,
    now: NOW,
  })
  assert.equal(finalized.allItemsKept, false)
  assert.equal(finalized.kept, 0)
  assert.equal(finalized.ownerPolicySha256, null)
})

test('finalize rejects missing, duplicate, unknown, stale, future, and artifact-drift evidence', async (t) => {
  const prepared = await prepareFixture(t)
  const originalEvidence = await readEvidence(prepared.sessionDir)
  const originalReviewText = await readFile(path.join(prepared.sessionDir, 'review.json'), 'utf8')

  await writeDecisions(prepared.sessionDir, rows => rows.slice(0, -1))
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /must contain every review item/,
  )

  await writeDecisions(prepared.sessionDir, rows => [...rows, { ...rows[0] }])
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /duplicates sampleIndex/,
  )

  await writeDecisions(prepared.sessionDir, rows => rows.map((row, index) =>
    index === 0 ? { ...row, resolution: 'maybe' } : row))
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /resolution is unknown/,
  )

  await writeDecisions(prepared.sessionDir, rows => rows.map((row, index) =>
    index === 0 ? { ...row, sourcePageStatus: '205' } : row))
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /sourcePageStatus must be exactly HTTP 200/,
  )

  await writeDecisions(prepared.sessionDir)
  const validCsv = await readFile(path.join(prepared.sessionDir, 'decisions.csv'), 'utf8')
  const malformedCsv = validCsv.replace(/\r\n1,/, '\r\n"1"x,')
  await writeFile(path.join(prepared.sessionDir, 'decisions.csv'), malformedCsv)
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /characters after a closing quote/,
  )

  await writeFile(path.join(prepared.sessionDir, 'decisions.csv'), validCsv)
  const stale = structuredClone(originalEvidence)
  stale.items.forEach(item => { item.reviewedBytes.retrievedAt = '2026-07-20T19:59:59.000Z' })
  await writeEvidence(prepared.sessionDir, stale)
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /evidence seal does not match.*original seal/,
  )

  const future = structuredClone(originalEvidence)
  future.items.forEach(item => { item.reviewedBytes.retrievedAt = '2026-07-21T20:00:01.000Z' })
  await writeEvidence(prepared.sessionDir, future)
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /evidence seal does not match.*original seal/,
  )

  await writeEvidence(prepared.sessionDir, originalEvidence)
  const drifted = JSON.parse(originalReviewText)
  drifted.artifacts[0].placesSha256 = `sha256:${'f'.repeat(64)}`
  await writeFile(path.join(prepared.sessionDir, 'review.json'), `${JSON.stringify(drifted, null, 2)}\n`)
  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /does not match the current pinned artifacts/,
  )
})

test('session evidence rejects missing rows and decision receipts cannot detach from cached evidence', async (t) => {
  const prepared = await prepareFixture(t)
  await writeDecisions(prepared.sessionDir)
  await finalizeFlagshipImageReviewSession({
    repoRoot: ROOT,
    sessionDir: prepared.sessionDir,
    reviewer: 'independent-reviewer-test',
    reviewedAt: REVIEWED_AT,
  })

  const evidence = await readEvidence(prepared.sessionDir)
  const remote = evidence.items.find(item => item.delivery === 'remote')
  const remotePath = path.join(prepared.sessionDir, ...remote.pixelPath.split('/'))
  const originalBytes = await readFile(remotePath)
  const handle = await open(remotePath, 'r+')
  await handle.truncate(20 * 1024 * 1024 + 1)
  await handle.close()
  await assert.rejects(
    verifyFlagshipImageDecisionBundle({ repoRoot: ROOT, sessionDir: prepared.sessionDir }),
    /hard per-file byte limit/,
  )
  await writeFile(remotePath, originalBytes)

  evidence.items.pop()
  await writeEvidence(prepared.sessionDir, evidence)
  await assert.rejects(
    verifyFlagshipImageDecisionBundle({ repoRoot: ROOT, sessionDir: prepared.sessionDir }),
    /must contain every review item/,
  )
})

test('externally retained seal rejects coordinated remote byte, evidence, and CSV replacement', async (t) => {
  const prepared = await prepareFixture(t)
  await writeDecisions(prepared.sessionDir)
  const evidence = await readEvidence(prepared.sessionDir)
  const referenceCounts = new Map()
  evidence.items.filter(item => item.delivery === 'remote').forEach((item) => {
    referenceCounts.set(item.imageReference, (referenceCounts.get(item.imageReference) || 0) + 1)
  })
  const row = evidence.items.find(item =>
    item.delivery === 'remote' && referenceCounts.get(item.imageReference) === 1)
  assert.ok(row)
  const originalBinding = evidenceBinding(row)
  const replacementHash = `sha256:${createHash('sha256').update(OTHER_JPEG).digest('hex')}`
  const replacementPath = `pixels/${replacementHash.slice('sha256:'.length)}.jpg`
  await writeFile(path.join(prepared.sessionDir, ...replacementPath.split('/')), OTHER_JPEG)
  row.pixelPath = replacementPath
  row.reviewedBytes = {
    ...row.reviewedBytes,
    sha256: replacementHash,
    bytes: OTHER_JPEG.length,
    width: 17,
    height: 13,
  }
  await writeEvidence(prepared.sessionDir, evidence)
  const decisionPath = path.join(prepared.sessionDir, 'decisions.csv')
  const decisions = await readFile(decisionPath, 'utf8')
  const updatedDecisions = decisions.replace(
    `${row.sampleIndex},${row.cityId},${row.itemId},${originalBinding}`,
    `${row.sampleIndex},${row.cityId},${row.itemId},${evidenceBinding(row)}`,
  )
  assert.notEqual(updatedDecisions, decisions, 'test must coordinate the CSV evidence binding too')
  await writeFile(decisionPath, updatedDecisions)

  await assert.rejects(
    finalizeFlagshipImageReviewSession({
      repoRoot: ROOT,
      sessionDir: prepared.sessionDir,
      reviewer: 'reviewer',
      reviewedAt: REVIEWED_AT,
    }),
    /evidence seal does not match.*original seal/,
  )
})
