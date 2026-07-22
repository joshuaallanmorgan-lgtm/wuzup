import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  attestS11BetaSessionRelease,
  beginS11BetaSession,
  createS11ParticipantIdentityLatch,
  guardS11AdditionalParticipantPage,
  runS11BetaSessionCli,
} from '../shared/beta-session.mjs'
import { normalizeBetaResearchReceipt } from '../shared/beta-research.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOW_MS = Date.parse('2026-07-22T12:00:00.000Z')
const SOURCE_COMMIT = 'a'.repeat(40)
const SITE_RELEASE_ID = `sha256:${'b'.repeat(64)}`
const RELEASES = Object.freeze({
  'sf-east-bay': Object.freeze({
    manifestId: `sha256:${'c'.repeat(64)}`,
    buildId: `sha256:${'d'.repeat(64)}`,
  }),
  'tampa-bay': Object.freeze({
    manifestId: `sha256:${'e'.repeat(64)}`,
    buildId: `sha256:${'f'.repeat(64)}`,
  }),
})
const REVIEW_CONFIG = Object.freeze({
  requiredCityIds: Object.freeze(['sf-east-bay', 'tampa-bay']),
  minimumSessionsPerCity: 2,
  expectedSiteReleaseId: SITE_RELEASE_ID,
  expectedReleases: RELEASES,
})

function observedRelease(overrides = {}) {
  return {
    status: 'observed',
    site: { releaseId: SITE_RELEASE_ID, sourceCommit: SOURCE_COMMIT },
    deployedReleases: RELEASES,
    ...overrides,
  }
}

function readyKit({ deployedReleases, deployedSiteReleaseId }) {
  return {
    status: 'release-ready',
    kit: {
      releaseBindings: {
        siteReleaseId: deployedSiteReleaseId,
        cityReleases: deployedReleases,
      },
    },
  }
}

function participantIdentity(cityId = 'tampa-bay', overrides = {}) {
  return {
    siteReleaseId: SITE_RELEASE_ID,
    manifestId: RELEASES[cityId].manifestId,
    buildId: RELEASES[cityId].buildId,
    cityId,
    timeZone: cityId === 'sf-east-bay' ? 'America/Los_Angeles' : 'America/New_York',
    ...overrides,
  }
}

function goodParticipantSessionFactory(metrics = null) {
  return async ({ cityId }) => ({
    async assertBound() {
      if (metrics) metrics.assertions += 1
      return participantIdentity(cityId)
    },
    async close() {
      if (metrics) metrics.closes += 1
    },
  })
}

function sequence(values) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

function fixtureDirectory(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'wuzup-s11-beta-session-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function sessionOptions(overrides = {}) {
  return {
    reviewConfig: REVIEW_CONFIG,
    cityId: 'tampa-bay',
    expectedSourceCommit: SOURCE_COMMIT,
    wallNow: sequence([NOW_MS, NOW_MS + 1_000]),
    monotonicNow: sequence([1_000, 1_100, 1_300, 1_600]),
    randomBytesImpl: () => Buffer.alloc(16, 1),
    observeRelease: async () => observedRelease(),
    prepareReleaseKit: readyKit,
    participantSessionFactory: goodParticipantSessionFactory(),
    ...overrides,
  }
}

test('records one exact release-bound session and atomically publishes only the normalized receipt', async (t) => {
  const directory = fixtureDirectory(t)
  const observationCalls = []
  const readinessCalls = []
  const participantMetrics = { assertions: 0, closes: 0 }
  const session = await beginS11BetaSession(sessionOptions({
    observeRelease: async (options) => {
      observationCalls.push(options)
      return observedRelease()
    },
    prepareReleaseKit: (options) => {
      readinessCalls.push(options)
      return readyKit(options)
    },
    participantSessionFactory: goodParticipantSessionFactory(participantMetrics),
  }))

  assert.equal(session.receiptId, `r-${'01'.repeat(16)}`)
  assert.equal(session.status, 'active')
  assert.deepEqual(session.binding, {
    siteReleaseId: SITE_RELEASE_ID,
    manifestId: RELEASES['tampa-bay'].manifestId,
    buildId: RELEASES['tampa-bay'].buildId,
  })
  assert.equal(await session.markCredibleOption(), 100)
  assert.equal(await session.markCredibleOption(), 100, 'only the first credible option is retained')
  assert.equal(await session.markRetainedValue(), 300)
  await session.increment('emptySearches')
  await session.increment('duplicateExposures')
  await session.increment('corrections')
  await session.setSourceLinkOutcome('succeeded')

  const result = await session.finish({
    returningUse: false,
    corePromise: 'yes',
    outputDirectory: directory,
  })
  assert.equal(session.status, 'finished')
  assert.equal(observationCalls.length, 2)
  assert.equal(readinessCalls.length, 2)
  assert.equal(participantMetrics.assertions, 10, 'initial, every mutation, and both finish brackets bind the same page')
  assert.equal(participantMetrics.closes, 1)
  for (const call of observationCalls) {
    assert.equal(call.productRootUrl, 'https://joshuaallanmorgan-lgtm.github.io/wuzup/')
    assert.equal(call.expectedSiteReleaseId, SITE_RELEASE_ID)
    assert.equal(call.expectedSourceCommit, SOURCE_COMMIT)
    assert.deepEqual(call.expectedReleases, RELEASES)
  }
  assert.deepEqual(readinessCalls.map((call) => call.nowMs), [NOW_MS, NOW_MS + 1_000])
  assert.equal(readinessCalls.every((call) => (
    call.deployedSiteReleaseId === SITE_RELEASE_ID
      && call.deployedReleases === RELEASES
  )), true)

  assert.deepEqual(result.receipt, normalizeBetaResearchReceipt({
    schema: 'wuzup-beta-research-session',
    schemaVersion: 2,
    sessionReceiptId: `r-${'01'.repeat(16)}`,
    siteReleaseId: SITE_RELEASE_ID,
    cityId: 'tampa-bay',
    manifestId: RELEASES['tampa-bay'].manifestId,
    buildId: RELEASES['tampa-bay'].buildId,
    durationMs: 600,
    milestones: { credibleOptionMs: 100, firstRetainedValueMs: 300 },
    sourceLinkOutcome: 'succeeded',
    counts: { emptySearches: 1, duplicateExposures: 1, corrections: 1 },
    returningUse: false,
    corePromise: 'yes',
  }))
  assert.deepEqual(readdirSync(directory), [`${session.receiptId}.json`])
  const persisted = readFileSync(result.filePath, 'utf8')
  assert.deepEqual(JSON.parse(persisted), result.receipt)
  for (const forbidden of [
    'evaluatedAt',
    'sourceCommit',
    'participantId',
    'title',
    'query',
    'url',
    'coordinates',
    'notes',
  ]) {
    assert.equal(persisted.includes(`"${forbidden}"`), false)
  }
})

test('requires the exact review-config release from observation and strict readiness policy', async () => {
  const observationCalls = []
  const binding = await attestS11BetaSessionRelease({
    nowMs: NOW_MS,
    reviewConfig: REVIEW_CONFIG,
    expectedSourceCommit: SOURCE_COMMIT,
    artifactRoots: { fixture: true },
    observeRelease: async (options) => {
      observationCalls.push(options)
      return observedRelease()
    },
    prepareReleaseKit: readyKit,
  })
  assert.equal(observationCalls.length, 1)
  assert.deepEqual(binding, {
    siteReleaseId: SITE_RELEASE_ID,
    cityReleases: RELEASES,
  })
  assert.equal(Object.isFrozen(binding.cityReleases['tampa-bay']), true)

  await assert.rejects(() => attestS11BetaSessionRelease({
    nowMs: NOW_MS,
    reviewConfig: REVIEW_CONFIG,
    expectedSourceCommit: SOURCE_COMMIT,
    observeRelease: async () => observedRelease({
      site: { releaseId: `sha256:${'9'.repeat(64)}`, sourceCommit: SOURCE_COMMIT },
    }),
    prepareReleaseKit: readyKit,
  }), (error) => error.code === 'SESSION_RELEASE_NOT_OBSERVED')

  await assert.rejects(() => attestS11BetaSessionRelease({
    nowMs: NOW_MS,
    reviewConfig: REVIEW_CONFIG,
    expectedSourceCommit: SOURCE_COMMIT,
    observeRelease: async () => observedRelease(),
    prepareReleaseKit: () => ({ status: 'blocked', kit: null }),
  }), (error) => error.code === 'SESSION_RELEASE_NOT_READY')
})

test('an expired or otherwise blocked preflight cannot allocate a receipt ID', async () => {
  let randomCalls = 0
  await assert.rejects(() => beginS11BetaSession(sessionOptions({
    randomBytesImpl: () => {
      randomCalls += 1
      return Buffer.alloc(16, 2)
    },
    prepareReleaseKit: () => ({ status: 'blocked', kit: null }),
  })), (error) => error.code === 'SESSION_RELEASE_NOT_READY')
  assert.equal(randomCalls, 0)
})

test('programmatic sessions require an owned participant surface before allocating an ID', async () => {
  let randomCalls = 0
  await assert.rejects(() => beginS11BetaSession(sessionOptions({
    participantSessionFactory: null,
    randomBytesImpl: () => {
      randomCalls += 1
      return Buffer.alloc(16, 3)
    },
  })), (error) => error.code === 'SESSION_PARTICIPANT_SESSION_REQUIRED')
  assert.equal(randomCalls, 0)
})

test('a stale initial participant page is rejected and closed before timer or ID creation', async () => {
  let closes = 0
  let randomCalls = 0
  await assert.rejects(() => beginS11BetaSession(sessionOptions({
    participantSessionFactory: async () => ({
      assertBound: async () => participantIdentity('tampa-bay', {
        siteReleaseId: `sha256:${'7'.repeat(64)}`,
      }),
      close: async () => { closes += 1 },
    }),
    randomBytesImpl: () => {
      randomCalls += 1
      return Buffer.alloc(16, 4)
    },
  })), (error) => error.code === 'SESSION_PARTICIPANT_IDENTITY_MISMATCH')
  assert.equal(closes, 1)
  assert.equal(randomCalls, 0)
})

test('participant identity latches A-to-B-to-A, reload, and page-close evidence irreversibly', () => {
  const expected = participantIdentity()
  const identityFlip = createS11ParticipantIdentityLatch(expected)
  assert.deepEqual(identityFlip.assertCurrent(expected), expected)
  assert.throws(() => identityFlip.assertCurrent({
    ...expected,
    buildId: `sha256:${'6'.repeat(64)}`,
  }), (error) => error.code === 'SESSION_PARTICIPANT_IDENTITY_MISMATCH')
  assert.throws(() => identityFlip.assertCurrent(expected), (error) => (
    error.code === 'SESSION_PARTICIPANT_SESSION_LATCHED'
      && error.problem === 'SESSION_PARTICIPANT_IDENTITY_MISMATCH'
  ))

  for (const problem of ['SESSION_PARTICIPANT_NAVIGATION', 'SESSION_PARTICIPANT_PAGE_CLOSED']) {
    const latch = createS11ParticipantIdentityLatch(expected)
    latch.latch(problem)
    assert.throws(() => latch.assertCurrent(expected), (error) => (
      error.code === 'SESSION_PARTICIPANT_SESSION_LATCHED' && error.problem === problem
    ))
  }
})

test('CLI participant surface is visible, isolated, byte-bound, and latches post-ready changes', () => {
  const source = readFileSync(path.join(ROOT, 'shared', 'beta-session.mjs'), 'utf8')
  assert.match(source, /chromium\.launch\(\{ headless: false \}\)/)
  assert.match(source, /serviceWorkers: 'block'[\s\S]*?viewport: \{ width: 390, height: 844 \}/)
  assert.match(source, /await page\.route\('\*\*\/\*'/)
  assert.doesNotMatch(source, /await context\.route\('/)
  assert.match(source, /inspectS11ExecutedSiteBytes\(\{/)
  assert.match(source, /request\.resourceType\(\) === 'document'/)
  assert.match(source, /new MutationObserver/)
  assert.match(source, /page\.on\('close'/)
  assert.match(source, /page\.on\('crash'/)
  assert.match(source, /browser\.on\('disconnected'/)
  assert.match(source, /scriptRecordPromises\.length >= MAX_PARTICIPANT_SCRIPTS/)
  assert.match(source, /context\.on\('page'/)
  assert.match(source, /guardS11AdditionalParticipantPage\(\{ page: additionalPage, identityLatch \}\)/)
})

test('additional-page guard allows foreign popups but closes every path back into Wuzup', async () => {
  function fakePage(initialUrl) {
    const handlers = new Map()
    const frame = { url: () => initialUrl }
    let closeCalls = 0
    return {
      page: {
        on(event, handler) {
          const values = handlers.get(event) || []
          values.push(handler)
          handlers.set(event, values)
        },
        url: () => initialUrl,
        mainFrame: () => frame,
        close: async () => { closeCalls += 1 },
      },
      emitRequest(url, resourceType = 'document') {
        for (const handler of handlers.get('request') || []) {
          handler({ frame: () => frame, resourceType: () => resourceType, url: () => url })
        }
      },
      emitNavigation(url) {
        frame.url = () => url
        for (const handler of handlers.get('framenavigated') || []) handler(frame)
      },
      get closeCalls() {
        return closeCalls
      },
    }
  }

  const foreign = fakePage('https://tickets.example/show')
  const foreignLatch = createS11ParticipantIdentityLatch(participantIdentity())
  const foreignGuard = guardS11AdditionalParticipantPage({
    page: foreign.page,
    identityLatch: foreignLatch,
  })
  foreign.emitRequest('https://tickets.example/runtime.js')
  foreign.emitNavigation('https://tickets.example/checkout')
  await foreignGuard.settled()
  assert.equal(foreignGuard.blocked, false)
  assert.equal(foreign.closeCalls, 0)
  assert.equal(foreignLatch.problem, null)

  foreign.emitRequest('https://joshuaallanmorgan-lgtm.github.io/wuzup/favicon.svg', 'image')
  await foreignGuard.settled()
  assert.equal(foreignGuard.blocked, false, 'a Wuzup subresource is not a second Wuzup participant page')
  assert.equal(foreign.closeCalls, 0)

  foreign.emitRequest('https://joshuaallanmorgan-lgtm.github.io/wuzup/sf/', 'document')
  await foreignGuard.settled()
  assert.equal(foreignGuard.blocked, true)
  assert.equal(foreign.closeCalls, 1)
  assert.equal(foreignLatch.problem, 'SESSION_PARTICIPANT_ADDITIONAL_WUZUP_PAGE')

  const blank = fakePage('about:blank')
  const blankLatch = createS11ParticipantIdentityLatch(participantIdentity())
  const blankGuard = guardS11AdditionalParticipantPage({ page: blank.page, identityLatch: blankLatch })
  blank.emitRequest('https://joshuaallanmorgan-lgtm.github.io/wuzup/')
  await blankGuard.settled()
  assert.equal(blank.closeCalls, 1)
  assert.equal(blankLatch.problem, 'SESSION_PARTICIPANT_ADDITIONAL_WUZUP_PAGE')

  const immediate = fakePage('https://joshuaallanmorgan-lgtm.github.io/wuzup/')
  const immediateLatch = createS11ParticipantIdentityLatch(participantIdentity())
  const immediateGuard = guardS11AdditionalParticipantPage({
    page: immediate.page,
    identityLatch: immediateLatch,
  })
  await immediateGuard.settled()
  assert.equal(immediate.closeCalls, 1)
  assert.equal(immediateLatch.problem, 'SESSION_PARTICIPANT_ADDITIONAL_WUZUP_PAGE')
})

test('missing review configuration is rejected with the session contract error', async () => {
  await assert.rejects(() => beginS11BetaSession({
    ...sessionOptions(),
    reviewConfig: null,
  }), (error) => error.code === 'SESSION_REVIEW_CONFIG_INVALID')
  await assert.rejects(() => attestS11BetaSessionRelease({
    nowMs: NOW_MS,
    reviewConfig: null,
    expectedSourceCommit: SOURCE_COMMIT,
  }), (error) => error.code === 'SESSION_REVIEW_CONFIG_INVALID')
})

test('a deployment flip or natural expiry during the session emits no receipt', async (t) => {
  const deploymentDirectory = fixtureDirectory(t)
  let observations = 0
  const deploymentSession = await beginS11BetaSession(sessionOptions({
    observeRelease: async () => {
      observations += 1
      return observations === 1
        ? observedRelease()
        : observedRelease({
          site: { releaseId: `sha256:${'8'.repeat(64)}`, sourceCommit: SOURCE_COMMIT },
        })
    },
  }))
  await assert.rejects(() => deploymentSession.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: deploymentDirectory,
  }), (error) => error.code === 'SESSION_RELEASE_NOT_OBSERVED')
  assert.equal(deploymentSession.status, 'invalid')
  assert.deepEqual(readdirSync(deploymentDirectory), [])

  const expiryDirectory = fixtureDirectory(t)
  let readinessChecks = 0
  const expirySession = await beginS11BetaSession(sessionOptions({
    prepareReleaseKit: (options) => {
      readinessChecks += 1
      return readinessChecks === 1
        ? readyKit(options)
        : { status: 'blocked', kit: null }
    },
  }))
  await assert.rejects(() => expirySession.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: expiryDirectory,
  }), (error) => error.code === 'SESSION_RELEASE_NOT_READY')
  assert.deepEqual(readdirSync(expiryDirectory), [])
})

test('an A-to-B-to-A participant reload during final attestation is latched before publication', async (t) => {
  const directory = fixtureDirectory(t)
  const expected = participantIdentity()
  const participantLatch = createS11ParticipantIdentityLatch(expected)
  let observations = 0
  let closes = 0
  const session = await beginS11BetaSession(sessionOptions({
    observeRelease: async () => {
      observations += 1
      if (observations === 2) participantLatch.latch('SESSION_PARTICIPANT_NAVIGATION')
      return observedRelease()
    },
    participantSessionFactory: async () => ({
      assertBound: async () => participantLatch.assertCurrent(expected),
      close: async () => { closes += 1 },
    }),
  }))

  await assert.rejects(() => session.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => (
    error.code === 'SESSION_PARTICIPANT_SESSION_LATCHED'
      && error.problem === 'SESSION_PARTICIPANT_NAVIGATION'
  ))
  assert.equal(observations, 2, 'the final remote returns release A again')
  assert.equal(closes, 1)
  assert.equal(session.status, 'invalid')
  assert.deepEqual(readdirSync(directory), [])
})

test('abort, clock regression, and invalid milestone order fail closed in process', async (t) => {
  const directory = fixtureDirectory(t)
  const aborted = await beginS11BetaSession(sessionOptions())
  assert.equal(await aborted.abort(), 'aborted')
  await assert.rejects(() => aborted.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => error.code === 'SESSION_NOT_ACTIVE')

  const reversed = await beginS11BetaSession(sessionOptions({
    monotonicNow: sequence([1_000, 999]),
  }))
  await assert.rejects(() => reversed.markCredibleOption(), (error) => (
    error.code === 'SESSION_MONOTONIC_CLOCK_INVALID'
  ))
  assert.equal(reversed.status, 'invalid')

  const invalidOrder = await beginS11BetaSession(sessionOptions())
  await assert.rejects(() => invalidOrder.markRetainedValue(), (error) => (
    error.code === 'SESSION_CREDIBLE_OPTION_REQUIRED'
  ))
  assert.deepEqual(readdirSync(directory), [])
})

test('the first finish attempt consumes the controller even when its input is invalid', async (t) => {
  const directory = fixtureDirectory(t)
  const session = await beginS11BetaSession(sessionOptions())
  await assert.rejects(() => session.finish({
    returningUse: 'no',
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => error.code === 'SESSION_RETURNING_USE_INVALID')
  assert.equal(session.status, 'invalid')
  await assert.rejects(() => session.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => error.code === 'SESSION_NOT_ACTIVE')
  assert.deepEqual(readdirSync(directory), [])
})

test('wall-clock regression at finish invalidates the session without output', async (t) => {
  const directory = fixtureDirectory(t)
  const session = await beginS11BetaSession(sessionOptions({
    wallNow: sequence([NOW_MS, NOW_MS - 1]),
  }))
  await assert.rejects(() => session.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => error.code === 'SESSION_WALL_CLOCK_REGRESSED')
  assert.equal(session.status, 'invalid')
  assert.deepEqual(readdirSync(directory), [])
})

test('an output collision preserves foreign bytes and leaves no final or partial receipt', async (t) => {
  const directory = fixtureDirectory(t)
  const session = await beginS11BetaSession(sessionOptions())
  const temporaryPath = path.join(directory, `.${session.receiptId}.tmp`)
  const targetPath = path.join(directory, `${session.receiptId}.json`)
  writeFileSync(temporaryPath, 'foreign file\n')

  await assert.rejects(() => session.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => error.code === 'SESSION_RECEIPT_REPLAY_OR_EXISTS')
  assert.equal(session.status, 'invalid')
  assert.equal(existsSync(targetPath), false)
  assert.equal(readFileSync(temporaryPath, 'utf8'), 'foreign file\n')
  assert.deepEqual(readdirSync(directory), [`.${session.receiptId}.tmp`])
})

test('an abort requested during final attestation prevents publication', async (t) => {
  const directory = fixtureDirectory(t)
  let session
  let observationNumber = 0
  session = await beginS11BetaSession(sessionOptions({
    observeRelease: async () => {
      observationNumber += 1
      if (observationNumber === 2) void session.abort()
      return observedRelease()
    },
  }))
  await assert.rejects(() => session.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => error.code === 'SESSION_ABORTED')
  assert.equal(session.status, 'aborted')
  assert.deepEqual(readdirSync(directory), [])
})

test('a repeated CSPRNG nonce cannot overwrite an existing atomic receipt', async (t) => {
  const directory = fixtureDirectory(t)
  const first = await beginS11BetaSession(sessionOptions())
  const firstResult = await first.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  })
  const original = readFileSync(firstResult.filePath)

  const replay = await beginS11BetaSession(sessionOptions())
  await assert.rejects(() => replay.finish({
    returningUse: false,
    corePromise: 'unclear',
    outputDirectory: directory,
  }), (error) => error.code === 'SESSION_RECEIPT_REPLAY_OR_EXISTS')
  assert.deepEqual(readFileSync(firstResult.filePath), original)
  assert.deepEqual(readdirSync(directory), [`${first.receiptId}.json`])
})

test('CLI rejects incomplete operator arguments before network access', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'shared', 'beta-session.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(run.status, 1)
  assert.equal(run.stdout, '')
  assert.match(run.stderr, /SESSION_CLI_ARGUMENTS_INVALID/)
})

test('CLI aborts its owned browser session after command and READY failures without a receipt', async (t) => {
  const directory = fixtureDirectory(t)
  const argv = [
    '--review-config', 'review.json',
    '--source-commit', SOURCE_COMMIT,
    '--city', 'tampa-bay',
    '--out-dir', directory,
  ]

  async function exercise({ lines = [], write, makeInput, expectedCode, expectedMessage }) {
    const signalHost = new EventEmitter()
    signalHost.exitCode = 0
    let aborts = 0
    let closes = 0
    const session = {
      receiptId: 'session_receipt_for_cleanup_test',
      status: 'active',
      async abort() {
        aborts += 1
        this.status = 'aborted'
      },
    }
    const input = {
      async *[Symbol.asyncIterator]() {
        yield * lines
      },
      close() {
        closes += 1
      },
    }
    await assert.rejects(() => runS11BetaSessionCli({
      argv,
      stdin: {},
      stdout: { isTTY: false, write },
      signalHost,
      readReviewConfig: async () => REVIEW_CONFIG,
      beginSession: async () => session,
      participantSessionFactory: async () => null,
      createInput: makeInput || (() => input),
    }), (error) => expectedCode
      ? error.code === expectedCode
      : error.message === expectedMessage)
    return { aborts, closes }
  }

  const typo = await exercise({
    lines: ['typo'],
    write() {},
    expectedCode: 'SESSION_COMMAND_INVALID',
  })
  assert.deepEqual(typo, { aborts: 1, closes: 1 })

  const readyFailure = await exercise({
    write() {
      throw new Error('READY_WRITE_FAILED')
    },
    expectedMessage: 'READY_WRITE_FAILED',
  })
  assert.deepEqual(readyFailure, { aborts: 1, closes: 0 })

  const readlineFailure = await exercise({
    write() {},
    makeInput() {
      throw new Error('READLINE_SETUP_FAILED')
    },
    expectedMessage: 'READLINE_SETUP_FAILED',
  })
  assert.deepEqual(readlineFailure, { aborts: 1, closes: 0 })
  assert.deepEqual(readdirSync(directory), [])
})
