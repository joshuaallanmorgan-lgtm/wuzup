import { randomBytes as secureRandomBytes } from 'node:crypto'
import { link, lstat, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createInterface } from 'node:readline/promises'
import { TextDecoder } from 'node:util'
import { pathToFileURL } from 'node:url'

import {
  inspectS11ExecutedSiteBytes,
  observeS11ParticipantRelease,
  S11_PRODUCTION_ROOT_URL,
} from './beta-production-observation.mjs'
import {
  prepareS11BetaReleaseKit,
  S11_CHECKED_ARTIFACT_ROOTS,
} from './beta-release-kit.mjs'
import {
  BETA_RESEARCH_SCHEMA,
  BETA_RESEARCH_SCHEMA_VERSION,
  normalizeBetaResearchReceipt,
  normalizeBetaResearchReviewConfig,
  readBetaResearchReviewConfigFile,
  S11_BETA_CITY_IDS,
  S11_BETA_RESEARCH_LIMITS,
} from './beta-research.mjs'
import {
  S11_SITE_RELEASE_FILE,
  S11_SITE_RELEASE_LIMITS,
  verifyS11SiteReleaseReceipt,
} from './site-release-contract.mjs'

const SOURCE_COMMIT = /^[a-f0-9]{40}$/
const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const COUNT_KEYS = new Set(['emptySearches', 'duplicateExposures', 'corrections'])
const SOURCE_LINK_OUTCOMES = new Set(['succeeded', 'failed'])
const CORE_PROMISE_OUTCOMES = new Set(['yes', 'no', 'unclear'])
const MAX_SESSION_MS = 8 * 60 * 60 * 1000
const MAX_RECEIPT_BYTES = 64 * 1024
const MAX_PARTICIPANT_SCRIPTS = 256
const COMMANDS = 'option | retain | empty | duplicate | correction | source succeeded|failed | finish new|returning yes|no|unclear | abort'
const PARTICIPANT_IDENTITY_KEYS = Object.freeze([
  'siteReleaseId',
  'manifestId',
  'buildId',
  'cityId',
  'timeZone',
])
const CITY_CONTRACTS = Object.freeze({
  'sf-east-bay': Object.freeze({ path: 'sf/', timeZone: 'America/Los_Angeles' }),
  'tampa-bay': Object.freeze({ path: '', timeZone: 'America/New_York' }),
})

export class BetaSessionError extends Error {
  constructor(code, cause = null) {
    super(code)
    this.name = 'BetaSessionError'
    this.code = code
    if (cause) this.cause = cause
  }
}

function fail(code, cause = null) {
  throw new BetaSessionError(code, cause)
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function participantIdentityMatches(actual, expected) {
  return plainObject(actual)
    && Object.keys(actual).length === PARTICIPANT_IDENTITY_KEYS.length
    && PARTICIPANT_IDENTITY_KEYS.every((key) => actual[key] === expected[key])
}

function normalizeParticipantIdentity(value) {
  if (!plainObject(value)) fail('SESSION_PARTICIPANT_IDENTITY_INVALID')
  const cityId = normalizeCityId(value.cityId)
  const contract = CITY_CONTRACTS[cityId]
  if (
    typeof value.siteReleaseId !== 'string'
    || !SHA256_ID.test(value.siteReleaseId)
    || typeof value.manifestId !== 'string'
    || !SHA256_ID.test(value.manifestId)
    || typeof value.buildId !== 'string'
    || !SHA256_ID.test(value.buildId)
    || value.timeZone !== contract.timeZone
  ) {
    fail('SESSION_PARTICIPANT_IDENTITY_INVALID')
  }
  const normalized = Object.fromEntries(PARTICIPANT_IDENTITY_KEYS.map((key) => [key, value[key]]))
  if (Object.keys(value).length !== PARTICIPANT_IDENTITY_KEYS.length) {
    fail('SESSION_PARTICIPANT_IDENTITY_INVALID')
  }
  return Object.freeze(normalized)
}

export function createS11ParticipantIdentityLatch(expectedIdentity) {
  const expected = normalizeParticipantIdentity(expectedIdentity)
  let problem = null

  function latch(nextProblem) {
    if (
      problem === null
      && typeof nextProblem === 'string'
      && /^SESSION_PARTICIPANT_[A-Z_]+$/.test(nextProblem)
    ) problem = nextProblem
    return problem
  }

  function assertCurrent(identity) {
    if (problem !== null) {
      const error = new BetaSessionError('SESSION_PARTICIPANT_SESSION_LATCHED')
      error.problem = problem
      throw error
    }
    let normalized
    try {
      normalized = normalizeParticipantIdentity(identity)
    } catch (error) {
      latch('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
      throw error
    }
    if (!participantIdentityMatches(normalized, expected)) {
      latch('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
      fail('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
    }
    return expected
  }

  return Object.freeze({
    expected,
    get problem() {
      return problem
    },
    latch,
    assertCurrent,
  })
}

export function guardS11AdditionalParticipantPage({ page, identityLatch } = {}) {
  if (
    !plainObject(page)
    || typeof page.on !== 'function'
    || typeof page.url !== 'function'
    || typeof page.mainFrame !== 'function'
    || typeof page.close !== 'function'
    || !plainObject(identityLatch)
    || typeof identityLatch.latch !== 'function'
  ) fail('SESSION_PARTICIPANT_POPUP_GUARD_INVALID')

  const wuzupOrigin = new URL(S11_PRODUCTION_ROOT_URL).origin
  let blocked = false
  let closePromise = Promise.resolve()

  function reachesWuzup(value) {
    let url
    try {
      url = new URL(value)
    } catch {
      return false
    }
    if (url.origin !== wuzupOrigin) return false
    if (!blocked) {
      blocked = true
      identityLatch.latch('SESSION_PARTICIPANT_ADDITIONAL_WUZUP_PAGE')
      closePromise = Promise.resolve().then(() => page.close()).catch(() => {})
    }
    return true
  }

  page.on('request', (request) => {
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) {
      reachesWuzup(request.url())
    }
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) reachesWuzup(frame.url())
  })
  reachesWuzup(page.url())

  return Object.freeze({
    get blocked() {
      return blocked
    },
    inspectUrl: reachesWuzup,
    settled: () => closePromise,
  })
}

function normalizeCityId(value) {
  if (!S11_BETA_CITY_IDS.includes(value)) fail('SESSION_CITY_INVALID')
  return value
}

function normalizeSourceCommit(value) {
  if (typeof value !== 'string' || !SOURCE_COMMIT.test(value)) {
    fail('SESSION_SOURCE_COMMIT_INVALID')
  }
  return value
}

function normalizeRequiredReviewConfig(value) {
  try {
    const normalized = normalizeBetaResearchReviewConfig(value)
    if (normalized === null) fail('SESSION_REVIEW_CONFIG_INVALID')
    return normalized
  } catch (error) {
    if (error instanceof BetaSessionError) throw error
    fail('SESSION_REVIEW_CONFIG_INVALID', error)
  }
}

function normalizeWallNow(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('SESSION_WALL_CLOCK_INVALID')
  return value
}

function normalizeMonotonicTick(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('SESSION_MONOTONIC_CLOCK_INVALID')
  }
  return value
}

function releaseMatches(actual, expected) {
  return plainObject(actual)
    && plainObject(expected)
    && actual.manifestId === expected.manifestId
    && actual.buildId === expected.buildId
}

function releasesMatch(actual, expected) {
  return plainObject(actual) && S11_BETA_CITY_IDS.every((cityId) => (
    releaseMatches(actual[cityId], expected[cityId])
  ))
}

function freezeBinding(reviewConfig) {
  return Object.freeze({
    siteReleaseId: reviewConfig.expectedSiteReleaseId,
    cityReleases: Object.freeze(Object.fromEntries(S11_BETA_CITY_IDS.map((cityId) => [
      cityId,
      Object.freeze({ ...reviewConfig.expectedReleases[cityId] }),
    ]))),
  })
}

/**
 * Re-observe the canonical participant site and then apply the strict local
 * freshness/source-health policy to those exact deployed identities. A prior
 * attestation or a release kit is input identity only, never authorization.
 */
export async function attestS11BetaSessionRelease({
  nowMs,
  reviewConfig,
  expectedSourceCommit,
  artifactRoots = S11_CHECKED_ARTIFACT_ROOTS,
  observeRelease = observeS11ParticipantRelease,
  prepareReleaseKit = prepareS11BetaReleaseKit,
} = {}) {
  const evaluatedMs = normalizeWallNow(nowMs)
  const config = normalizeRequiredReviewConfig(reviewConfig)
  const sourceCommit = normalizeSourceCommit(expectedSourceCommit)
  if (typeof observeRelease !== 'function' || typeof prepareReleaseKit !== 'function') {
    fail('SESSION_ATTESTATION_DEPENDENCY_INVALID')
  }

  let observation
  try {
    observation = await observeRelease({
      nowMs: evaluatedMs,
      productRootUrl: S11_PRODUCTION_ROOT_URL,
      expectedReleases: config.expectedReleases,
      expectedSiteReleaseId: config.expectedSiteReleaseId,
      expectedSourceCommit: sourceCommit,
    })
  } catch (error) {
    fail('SESSION_PRODUCTION_OBSERVATION_FAILED', error)
  }
  if (
    observation?.status !== 'observed'
    || observation?.site?.releaseId !== config.expectedSiteReleaseId
    || observation?.site?.sourceCommit !== sourceCommit
    || !releasesMatch(observation?.deployedReleases, config.expectedReleases)
  ) {
    fail('SESSION_RELEASE_NOT_OBSERVED')
  }

  let readiness
  try {
    readiness = prepareReleaseKit({
      nowMs: evaluatedMs,
      artifactRoots,
      deployedReleases: observation.deployedReleases,
      deployedSiteReleaseId: observation.site.releaseId,
    })
  } catch (error) {
    fail('SESSION_RELEASE_POLICY_FAILED', error)
  }
  if (readiness?.status !== 'release-ready' || !readiness.kit) {
    fail('SESSION_RELEASE_NOT_READY')
  }
  if (
    readiness.kit.releaseBindings?.siteReleaseId !== config.expectedSiteReleaseId
    || !releasesMatch(readiness.kit.releaseBindings?.cityReleases, config.expectedReleases)
  ) {
    fail('SESSION_RELEASE_BINDING_MISMATCH')
  }
  return freezeBinding(config)
}

async function boundedResponseBody(response, maximumBytes) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes) fail('SESSION_PARTICIPANT_SITE_RECEIPT_INVALID')
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maximumBytes) fail('SESSION_PARTICIPANT_SITE_RECEIPT_INVALID')
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) fail('SESSION_PARTICIPANT_SITE_RECEIPT_INVALID')
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

async function fetchExpectedSiteReceipt({
  releaseBindings,
  expectedSourceCommit,
  fetchImpl,
  timeoutMs,
}) {
  const url = new URL(S11_SITE_RELEASE_FILE, S11_PRODUCTION_ROOT_URL)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(url.href, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    })
    if (
      response.status !== 200
      || response.url !== url.href
      || !String(response.headers?.get?.('content-type') || '').toLowerCase().startsWith('application/json')
    ) fail('SESSION_PARTICIPANT_SITE_RECEIPT_INVALID')
    const bytes = await boundedResponseBody(response, S11_SITE_RELEASE_LIMITS.receiptBytes)
    let parsed
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      parsed = JSON.parse(text)
    } catch (error) {
      fail('SESSION_PARTICIPANT_SITE_RECEIPT_INVALID', error)
    }
    const verified = verifyS11SiteReleaseReceipt(parsed, {
      expectedReleaseId: releaseBindings.siteReleaseId,
      expectedSourceCommit,
      expectedReleases: releaseBindings.cityReleases,
    })
    if (!verified.ok) fail('SESSION_PARTICIPANT_SITE_RECEIPT_INVALID')
    return { bytes, receipt: verified.receipt }
  } catch (error) {
    if (error instanceof BetaSessionError) throw error
    fail('SESSION_PARTICIPANT_SITE_RECEIPT_FETCH_FAILED', error)
  } finally {
    clearTimeout(timer)
  }
}

function participantResponseRecord(response) {
  const request = response.request()
  return (async () => ({
    bytes: Buffer.from(await response.body()),
    contentType: response.headers()['content-type'] || '',
    redirected: request.redirectedFrom() !== null,
    status: response.status(),
    url: response.url(),
  }))()
}

/**
 * Launch the actual participant surface. Its isolated visible page is bound
 * to the exact receipt document/script bytes and remains owned until the
 * session finishes or aborts.
 */
export async function openS11ParticipantBrowser({
  releaseBindings,
  cityId,
  expectedSourceCommit,
  fetchImpl = globalThis.fetch,
  launchBrowser = null,
  timeoutMs = 15_000,
} = {}) {
  const normalizedCityId = normalizeCityId(cityId)
  const sourceCommit = normalizeSourceCommit(expectedSourceCommit)
  if (
    !plainObject(releaseBindings)
    || typeof releaseBindings.siteReleaseId !== 'string'
    || !SHA256_ID.test(releaseBindings.siteReleaseId)
    || !releasesMatch(releaseBindings.cityReleases, releaseBindings.cityReleases)
    || typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 120_000
  ) fail('SESSION_PARTICIPANT_BROWSER_INPUT_INVALID')
  const city = CITY_CONTRACTS[normalizedCityId]
  const release = releaseBindings.cityReleases[normalizedCityId]
  const expectedIdentity = normalizeParticipantIdentity({
    siteReleaseId: releaseBindings.siteReleaseId,
    manifestId: release.manifestId,
    buildId: release.buildId,
    cityId: normalizedCityId,
    timeZone: city.timeZone,
  })
  const identityLatch = createS11ParticipantIdentityLatch(expectedIdentity)
  const baseUrl = new URL(city.path, S11_PRODUCTION_ROOT_URL)
  const firstReceipt = await fetchExpectedSiteReceipt({
    releaseBindings,
    expectedSourceCommit: sourceCommit,
    fetchImpl,
    timeoutMs,
  })

  let browser
  let context
  let page
  let armed = false
  let closing = false
  let siteProof = null
  const scriptRecordPromises = []
  const pendingChecks = new Set()
  try {
    if (launchBrowser) {
      if (typeof launchBrowser !== 'function') fail('SESSION_PARTICIPANT_BROWSER_INPUT_INVALID')
      browser = await launchBrowser({ headless: false })
    } else {
      const { chromium } = await import('playwright')
      browser = await chromium.launch({ headless: false })
    }
    context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
    })
    page = await context.newPage()
    context.on('page', (additionalPage) => {
      if (additionalPage !== page) {
        guardS11AdditionalParticipantPage({ page: additionalPage, identityLatch })
      }
    })
    // Restrict only the owned Wuzup page. Source links open unrestricted
    // popups, so their real ticket/organizer sites remain testable.
    await page.route('**/*', async (route) => {
      const request = route.request()
      let requestUrl
      try {
        requestUrl = new URL(request.url())
      } catch {
        await route.abort('blockedbyclient')
        return
      }
      if (
        request.resourceType() === 'worker'
        || (requestUrl.origin !== baseUrl.origin && request.resourceType() === 'script')
      ) await route.abort('blockedbyclient')
      else await route.continue()
    })
    await page.setExtraHTTPHeaders({
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    })
    await page.exposeBinding('__wuzupBetaParticipantLatch', (_source, problem) => {
      identityLatch.latch(problem)
    })

    page.on('request', (request) => {
      if (
        armed
        && request.resourceType() === 'document'
        && request.frame() === page.mainFrame()
      ) identityLatch.latch('SESSION_PARTICIPANT_NAVIGATION')
    })
    page.on('close', () => {
      if (!closing) identityLatch.latch('SESSION_PARTICIPANT_PAGE_CLOSED')
    })
    page.on('crash', () => identityLatch.latch('SESSION_PARTICIPANT_PAGE_CRASHED'))
    browser.on('disconnected', () => {
      if (!closing) identityLatch.latch('SESSION_PARTICIPANT_BROWSER_CLOSED')
    })
    page.on('response', (response) => {
      if (response.request().resourceType() !== 'script') return
      let responseUrl
      try {
        responseUrl = new URL(response.url())
      } catch {
        return
      }
      if (responseUrl.origin !== baseUrl.origin) return
      if (scriptRecordPromises.length >= MAX_PARTICIPANT_SCRIPTS) {
        identityLatch.latch('SESSION_PARTICIPANT_SCRIPT_MISMATCH')
        return
      }
      const record = participantResponseRecord(response)
      scriptRecordPromises.push(record)
      if (armed && siteProof) {
        const check = Promise.all(scriptRecordPromises)
          .then((records) => inspectS11ExecutedSiteBytes({
            cityId: normalizedCityId,
            baseUrl,
            siteReceipt: firstReceipt.receipt,
            documentRecord: siteProof.documentRecord,
            scriptRecords: records,
          }))
          .catch(() => identityLatch.latch('SESSION_PARTICIPANT_SCRIPT_MISMATCH'))
        pendingChecks.add(check)
        void check.finally(() => pendingChecks.delete(check))
      }
    })

    const response = await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    if (!response || response.status() !== 200 || page.url() !== baseUrl.href) {
      fail('SESSION_PARTICIPANT_PAGE_LOAD_FAILED')
    }
    const documentRecord = {
      bytes: Buffer.from(await response.body()),
      contentType: response.headers()['content-type'] || '',
      redirected: response.request().redirectedFrom() !== null,
      status: response.status(),
      url: response.url(),
    }
    const app = page.locator('.app[data-city-runtime-status="ready"][data-manifest-id][data-build-id]')
    await app.waitFor({ state: 'visible', timeout: timeoutMs })
    const scriptRecords = await Promise.all(scriptRecordPromises)
    const executed = inspectS11ExecutedSiteBytes({
      cityId: normalizedCityId,
      baseUrl,
      siteReceipt: firstReceipt.receipt,
      documentRecord,
      scriptRecords,
    })
    siteProof = { documentRecord, executed }
    const mounted = await app.evaluate((element) => ({
      cityId: element.dataset.cityId,
      timeZone: element.dataset.cityTimeZone,
      manifestId: element.dataset.manifestId,
      buildId: element.dataset.buildId,
    }))
    identityLatch.assertCurrent({
      siteReleaseId: executed.siteReleaseId,
      ...mounted,
    })
    const secondReceipt = await fetchExpectedSiteReceipt({
      releaseBindings,
      expectedSourceCommit: sourceCommit,
      fetchImpl,
      timeoutMs,
    })
    if (!firstReceipt.bytes.equals(secondReceipt.bytes)) {
      fail('SESSION_PARTICIPANT_SITE_RECEIPT_CHANGED')
    }

    await page.evaluate((expected) => {
      const root = document.querySelector('.app')
      if (!root) {
        window.__wuzupBetaParticipantLatch('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
        return
      }
      const attributes = {
        'data-city-id': expected.cityId,
        'data-city-time-zone': expected.timeZone,
        'data-manifest-id': expected.manifestId,
        'data-build-id': expected.buildId,
        'data-city-runtime-status': 'ready',
      }
      const identityObserver = new MutationObserver((records) => {
        for (const record of records) {
          const expectedValue = attributes[record.attributeName]
          if (record.oldValue !== expectedValue || root.getAttribute(record.attributeName) !== expectedValue) {
            window.__wuzupBetaParticipantLatch('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
            break
          }
        }
      })
      identityObserver.observe(root, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: Object.keys(attributes),
      })
      const removalObserver = new MutationObserver((records) => {
        if (records.some((record) => [...record.removedNodes].some((node) => (
          node === root || (node.nodeType === Node.ELEMENT_NODE && node.contains(root))
        )))) window.__wuzupBetaParticipantLatch('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
      })
      removalObserver.observe(document.documentElement, { childList: true, subtree: true })
    }, expectedIdentity)
    armed = true

    async function assertBound() {
      await Promise.all([...pendingChecks])
      if (page.isClosed()) identityLatch.latch('SESSION_PARTICIPANT_PAGE_CLOSED')
      if (identityLatch.problem) identityLatch.assertCurrent(expectedIdentity)
      let mountedNow
      try {
        const currentScripts = await Promise.all([...scriptRecordPromises])
        const currentProof = inspectS11ExecutedSiteBytes({
          cityId: normalizedCityId,
          baseUrl,
          siteReceipt: firstReceipt.receipt,
          documentRecord: siteProof.documentRecord,
          scriptRecords: currentScripts,
        })
        if (currentProof.manifestPinned !== true || currentProof.siteReleaseId !== expectedIdentity.siteReleaseId) {
          identityLatch.latch('SESSION_PARTICIPANT_SCRIPT_MISMATCH')
        }
        mountedNow = await page.locator('.app').evaluate((element) => ({
          siteReleaseId: executed.siteReleaseId,
          cityId: element.dataset.cityId,
          timeZone: element.dataset.cityTimeZone,
          manifestId: element.dataset.manifestId,
          buildId: element.dataset.buildId,
        }))
      } catch (error) {
        identityLatch.latch('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
        fail('SESSION_PARTICIPANT_IDENTITY_MISMATCH', error)
      }
      return identityLatch.assertCurrent(mountedNow)
    }

    return Object.freeze({
      assertBound,
      async close() {
        if (closing) return
        closing = true
        armed = false
        await browser.close()
      },
    })
  } catch (error) {
    closing = true
    armed = false
    if (browser) await browser.close().catch(() => {})
    if (error instanceof BetaSessionError) throw error
    fail('SESSION_PARTICIPANT_BROWSER_FAILED', error)
  }
}

function receiptId(randomBytesImpl) {
  if (typeof randomBytesImpl !== 'function') fail('SESSION_RANDOM_SOURCE_INVALID')
  let entropy
  try {
    entropy = randomBytesImpl(16)
  } catch (error) {
    fail('SESSION_RANDOM_SOURCE_FAILED', error)
  }
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== 16) {
    fail('SESSION_RANDOM_SOURCE_INVALID')
  }
  return `r-${Buffer.from(entropy.buffer, entropy.byteOffset, entropy.byteLength).toString('hex')}`
}

async function writeReceiptAtomically(receipt, outputDirectory, shouldAbort) {
  if (typeof outputDirectory !== 'string' || outputDirectory.trim().length === 0) {
    fail('SESSION_OUTPUT_DIRECTORY_INVALID')
  }
  const directory = path.resolve(outputDirectory)
  let directoryStat
  try {
    directoryStat = await lstat(directory)
  } catch (error) {
    fail('SESSION_OUTPUT_DIRECTORY_INVALID', error)
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    fail('SESSION_OUTPUT_DIRECTORY_INVALID')
  }

  const normalized = normalizeBetaResearchReceipt(receipt)
  const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  if (bytes.length > MAX_RECEIPT_BYTES) fail('SESSION_RECEIPT_TOO_LARGE')
  const targetPath = path.join(directory, `${normalized.sessionReceiptId}.json`)
  const temporaryPath = path.join(directory, `.${normalized.sessionReceiptId}.tmp`)
  let handle = null
  let ownsTemporary = false
  let targetCreated = false
  try {
    if (shouldAbort()) fail('SESSION_ABORTED')
    handle = await open(temporaryPath, 'wx', 0o600)
    ownsTemporary = true
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    if (shouldAbort()) fail('SESSION_ABORTED')
    // A same-directory hard link makes the complete synced bytes visible in
    // one no-clobber operation. It cannot replace an existing receipt ID.
    await link(temporaryPath, targetPath)
    targetCreated = true
    if (targetCreated && shouldAbort()) {
      try {
        await unlink(targetPath)
        targetCreated = false
      } catch (error) {
        fail('SESSION_ABORT_CLEANUP_FAILED', error)
      }
      fail('SESSION_ABORTED')
    }
    return targetPath
  } catch (error) {
    if (error instanceof BetaSessionError) throw error
    if (error?.code === 'EEXIST') fail('SESSION_RECEIPT_REPLAY_OR_EXISTS', error)
    fail('SESSION_RECEIPT_WRITE_FAILED', error)
  } finally {
    if (handle) await handle.close().catch(() => {})
    if (ownsTemporary) await unlink(temporaryPath).catch(() => {})
  }
}

/**
 * Begin one non-resumable observer session. All mutable evidence remains in
 * this process; only finish() can publish the exact privacy-bounded receipt.
 */
export async function beginS11BetaSession({
  reviewConfig,
  cityId,
  expectedSourceCommit,
  artifactRoots = S11_CHECKED_ARTIFACT_ROOTS,
  wallNow = Date.now,
  monotonicNow = () => performance.now(),
  randomBytesImpl = secureRandomBytes,
  observeRelease = observeS11ParticipantRelease,
  prepareReleaseKit = prepareS11BetaReleaseKit,
  participantSessionFactory,
} = {}) {
  const config = normalizeRequiredReviewConfig(reviewConfig)
  const normalizedCityId = normalizeCityId(cityId)
  const sourceCommit = normalizeSourceCommit(expectedSourceCommit)
  if (typeof wallNow !== 'function' || typeof monotonicNow !== 'function') {
    fail('SESSION_CLOCK_DEPENDENCY_INVALID')
  }
  const preflightNowMs = normalizeWallNow(wallNow())
  const attestationOptions = {
    reviewConfig: config,
    expectedSourceCommit: sourceCommit,
    artifactRoots,
    observeRelease,
    prepareReleaseKit,
  }
  const initialBinding = await attestS11BetaSessionRelease({
    nowMs: preflightNowMs,
    ...attestationOptions,
  })
  const release = initialBinding.cityReleases[normalizedCityId]
  const expectedParticipantIdentity = normalizeParticipantIdentity({
    siteReleaseId: initialBinding.siteReleaseId,
    manifestId: release.manifestId,
    buildId: release.buildId,
    cityId: normalizedCityId,
    timeZone: CITY_CONTRACTS[normalizedCityId].timeZone,
  })
  if (typeof participantSessionFactory !== 'function') {
    fail('SESSION_PARTICIPANT_SESSION_REQUIRED')
  }
  let participantSession
  try {
    participantSession = await participantSessionFactory({
      releaseBindings: initialBinding,
      cityId: normalizedCityId,
      expectedSourceCommit: sourceCommit,
    })
    if (
      !plainObject(participantSession)
      || typeof participantSession.assertBound !== 'function'
      || typeof participantSession.close !== 'function'
    ) fail('SESSION_PARTICIPANT_SESSION_INVALID')
    const mounted = await participantSession.assertBound()
    if (!participantIdentityMatches(normalizeParticipantIdentity(mounted), expectedParticipantIdentity)) {
      fail('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
    }
  } catch (error) {
    if (participantSession?.close) await participantSession.close().catch(() => {})
    if (error instanceof BetaSessionError) throw error
    fail('SESSION_PARTICIPANT_SESSION_FAILED', error)
  }
  let sessionReceiptId
  let startedAt
  try {
    sessionReceiptId = receiptId(randomBytesImpl)
    startedAt = normalizeMonotonicTick(monotonicNow())
  } catch (error) {
    await participantSession.close().catch(() => {})
    throw error
  }

  let state = 'active'
  let abortRequested = false
  let participantClosePromise = null
  let lastElapsedMs = 0
  let credibleOptionMs = null
  let firstRetainedValueMs = null
  let sourceLinkOutcome = 'not-attempted'
  const counts = {
    emptySearches: 0,
    duplicateExposures: 0,
    corrections: 0,
  }

  function requireActive() {
    if (state !== 'active') fail('SESSION_NOT_ACTIVE')
  }

  function closeParticipant() {
    if (!participantClosePromise) {
      participantClosePromise = Promise.resolve().then(() => participantSession.close())
    }
    return participantClosePromise
  }

  async function assertParticipantBound() {
    let mounted
    try {
      mounted = await participantSession.assertBound()
      mounted = normalizeParticipantIdentity(mounted)
    } catch (error) {
      if (error instanceof BetaSessionError) throw error
      fail('SESSION_PARTICIPANT_SESSION_FAILED', error)
    }
    if (!participantIdentityMatches(mounted, expectedParticipantIdentity)) {
      fail('SESSION_PARTICIPANT_IDENTITY_MISMATCH')
    }
    return mounted
  }

  async function guardedMutation(mutation) {
    requireActive()
    try {
      await assertParticipantBound()
      requireActive()
      return mutation()
    } catch (error) {
      state = abortRequested ? 'aborted' : 'invalid'
      await closeParticipant().catch(() => {})
      throw error
    }
  }

  function elapsedMs() {
    let current
    try {
      current = normalizeMonotonicTick(monotonicNow())
    } catch (error) {
      state = 'invalid'
      throw error
    }
    const elapsed = Math.floor(current - startedAt)
    if (!Number.isSafeInteger(elapsed) || elapsed < lastElapsedMs || elapsed > MAX_SESSION_MS) {
      state = 'invalid'
      fail('SESSION_MONOTONIC_CLOCK_INVALID')
    }
    lastElapsedMs = elapsed
    return elapsed
  }

  const controller = {
    get receiptId() {
      return sessionReceiptId
    },
    get cityId() {
      return normalizedCityId
    },
    get status() {
      return state
    },
    binding: Object.freeze({
      siteReleaseId: initialBinding.siteReleaseId,
      manifestId: release.manifestId,
      buildId: release.buildId,
    }),
    async markCredibleOption() {
      return guardedMutation(() => {
        if (credibleOptionMs === null) credibleOptionMs = elapsedMs()
        return credibleOptionMs
      })
    },
    async markRetainedValue() {
      return guardedMutation(() => {
        if (credibleOptionMs === null) fail('SESSION_CREDIBLE_OPTION_REQUIRED')
        if (firstRetainedValueMs === null) firstRetainedValueMs = elapsedMs()
        return firstRetainedValueMs
      })
    },
    async increment(key) {
      return guardedMutation(() => {
        if (!COUNT_KEYS.has(key)) fail('SESSION_COUNT_KEY_INVALID')
        if (counts[key] >= S11_BETA_RESEARCH_LIMITS.maxSessionsPerCity) {
          fail('SESSION_COUNT_LIMIT_REACHED')
        }
        counts[key] += 1
        return counts[key]
      })
    },
    async setSourceLinkOutcome(outcome) {
      return guardedMutation(() => {
        if (!SOURCE_LINK_OUTCOMES.has(outcome)) fail('SESSION_SOURCE_LINK_OUTCOME_INVALID')
        if (credibleOptionMs === null) fail('SESSION_CREDIBLE_OPTION_REQUIRED')
        if (sourceLinkOutcome !== 'not-attempted' && sourceLinkOutcome !== outcome) {
          fail('SESSION_SOURCE_LINK_OUTCOME_ALREADY_SET')
        }
        sourceLinkOutcome = outcome
        return sourceLinkOutcome
      })
    },
    async abort() {
      abortRequested = true
      if (state === 'active') state = 'aborted'
      await closeParticipant().catch(() => {})
      return state
    },
    async finish({ returningUse, corePromise, outputDirectory } = {}) {
      requireActive()
      state = 'finishing'
      try {
        if (typeof returningUse !== 'boolean') fail('SESSION_RETURNING_USE_INVALID')
        if (!CORE_PROMISE_OUTCOMES.has(corePromise)) fail('SESSION_CORE_PROMISE_INVALID')
        const durationMs = Math.max(1, elapsedMs())
        const candidate = normalizeBetaResearchReceipt({
          schema: BETA_RESEARCH_SCHEMA,
          schemaVersion: BETA_RESEARCH_SCHEMA_VERSION,
          sessionReceiptId,
          siteReleaseId: initialBinding.siteReleaseId,
          cityId: normalizedCityId,
          manifestId: release.manifestId,
          buildId: release.buildId,
          durationMs,
          milestones: { credibleOptionMs, firstRetainedValueMs },
          sourceLinkOutcome,
          counts,
          returningUse,
          corePromise,
        })
        await assertParticipantBound()
        const finalNowMs = normalizeWallNow(wallNow())
        if (finalNowMs < preflightNowMs) fail('SESSION_WALL_CLOCK_REGRESSED')
        const finalBinding = await attestS11BetaSessionRelease({
          nowMs: finalNowMs,
          ...attestationOptions,
        })
        if (
          finalBinding.siteReleaseId !== initialBinding.siteReleaseId
          || !releasesMatch(finalBinding.cityReleases, initialBinding.cityReleases)
        ) {
          fail('SESSION_DEPLOYMENT_CHANGED')
        }
        await assertParticipantBound()
        if (abortRequested) fail('SESSION_ABORTED')
        await closeParticipant()
        if (abortRequested) fail('SESSION_ABORTED')
        const filePath = await writeReceiptAtomically(candidate, outputDirectory, () => abortRequested)
        state = 'finished'
        return Object.freeze({ receipt: candidate, filePath })
      } catch (error) {
        state = abortRequested ? 'aborted' : 'invalid'
        await closeParticipant().catch(() => {})
        throw error
      }
    },
  }
  return Object.freeze(controller)
}

function parseCliArguments(argv) {
  const parsed = {}
  const supported = new Set(['--review-config', '--source-commit', '--city', '--out-dir'])
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!supported.has(key) || value === undefined || Object.hasOwn(parsed, key)) {
      fail('SESSION_CLI_ARGUMENTS_INVALID')
    }
    parsed[key] = value
  }
  if (Object.keys(parsed).length !== supported.size) fail('SESSION_CLI_ARGUMENTS_INVALID')
  return {
    reviewConfigPath: parsed['--review-config'],
    expectedSourceCommit: parsed['--source-commit'],
    cityId: parsed['--city'],
    outputDirectory: parsed['--out-dir'],
  }
}

export async function runS11BetaSessionCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  signalHost = process,
  readReviewConfig = readBetaResearchReviewConfigFile,
  beginSession = beginS11BetaSession,
  participantSessionFactory = openS11ParticipantBrowser,
  createInput = createInterface,
  productionRootUrl = S11_PRODUCTION_ROOT_URL,
} = {}) {
  const options = parseCliArguments(argv)
  const reviewConfig = await readReviewConfig(options.reviewConfigPath)
  let session = null
  let input = null
  let completed = false
  const onSignal = () => {
    signalHost.exitCode = 130
    void session?.abort().finally(() => input?.close())
  }
  try {
    session = await beginSession({
      reviewConfig,
      cityId: options.cityId,
      expectedSourceCommit: options.expectedSourceCommit,
      participantSessionFactory,
    })
    const cityUrl = options.cityId === 'sf-east-bay'
      ? new URL('sf/', productionRootUrl).href
      : productionRootUrl
    stdout.write(`READY ${session.receiptId} ${cityUrl}\n${COMMANDS}\n`)

    input = createInput({ input: stdin, output: stdout, terminal: stdout.isTTY })
    signalHost.once('SIGINT', onSignal)
    for await (const rawLine of input) {
      const command = rawLine.trim()
      if (command === 'option') await session.markCredibleOption()
      else if (command === 'retain') await session.markRetainedValue()
      else if (command === 'empty') await session.increment('emptySearches')
      else if (command === 'duplicate') await session.increment('duplicateExposures')
      else if (command === 'correction') await session.increment('corrections')
      else if (command === 'source succeeded') await session.setSourceLinkOutcome('succeeded')
      else if (command === 'source failed') await session.setSourceLinkOutcome('failed')
      else if (command === 'abort') {
        await session.abort()
        fail('SESSION_ABORTED')
      } else {
        const match = /^finish (new|returning) (yes|no|unclear)$/.exec(command)
        if (!match) fail('SESSION_COMMAND_INVALID')
        const result = await session.finish({
          returningUse: match[1] === 'returning',
          corePromise: match[2],
          outputDirectory: options.outputDirectory,
        })
        completed = true
        stdout.write(`WROTE ${result.filePath}\n`)
        break
      }
    }
  } finally {
    try {
      signalHost.removeListener('SIGINT', onSignal)
      input?.close()
    } finally {
      if (session && !completed) await session.abort().catch(() => {})
    }
  }
  if (!completed && signalHost.exitCode !== 130) fail('SESSION_ENDED_WITHOUT_RECEIPT')
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  try {
    await runS11BetaSessionCli()
  } catch (error) {
    process.stderr.write(`S11 beta session failed: ${error?.code || 'SESSION_INTERNAL_ERROR'}\n`)
    process.exitCode = process.exitCode || 1
  }
}
