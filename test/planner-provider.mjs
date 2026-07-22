import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'

const source = await readFile(new URL('../app/src/PlannerProvider.jsx', import.meta.url), 'utf8')
const vite = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)),
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'silent',
})
let providerModule
try {
  providerModule = await vite.ssrLoadModule('/src/PlannerProvider.jsx')
} finally {
  await vite.close()
}
const {
  plannerRolloverSucceeded,
  plannerStatusAfterCatalog,
  plannerStatusAfterRollover,
} = providerModule

test('PlannerProvider uses external-store subscriptions and a StrictMode-safe effect lifetime', () => {
  assert.match(source, /useSyncExternalStore/)
  assert.match(source, /createRuntimeHolder/)
  assert.match(source, /runtime\?\.destroy\(\)/)
  assert.match(source, /key=\{cityKey\}/)
  assert.doesNotMatch(source, /useMemo\(\(\) => createPlannerRuntime/)
})

test('PlannerProvider subscribes to places without activating the place artifact', () => {
  assert.match(source, /usePlaces\(false\)/)
  assert.doesNotMatch(source, /usePlaces\(\)/)
  assert.match(source, /events: remoteEvents/)
  assert.match(source, /customEvents/)
  assert.match(source, /places: placeList/)
})

test('PlannerProvider crosses V1 only through the capture seam', () => {
  assert.match(source, /capturePlannerV1Source/)
  assert.doesNotMatch(source, /from ['"]\.\/dayplan\.js['"]/)
  assert.doesNotMatch(source, /from ['"]\.\/weekend\.js['"]/)
  assert.doesNotMatch(source, /\bloadDayPlans\b|\bsaveDayPlans\b|\bplanItem\b/)
})

test('current-day rollover is a prerequisite for a durable public status', () => {
  const firstRuntime = {}
  const replacementRuntime = {}
  const idle = { runtime: null, dayTs: null, phase: 'idle', error: null }
  const pending = { runtime: firstRuntime, dayTs: 100, phase: 'pending', error: null }
  const failed = {
    runtime: firstRuntime,
    dayTs: 100,
    phase: 'error',
    error: { code: 'planner-rollover-failed' },
  }
  const ready = { runtime: firstRuntime, dayTs: 100, phase: 'ready', error: null }

  assert.equal(plannerStatusAfterRollover('durable', idle, 100, firstRuntime), 'initializing')
  assert.equal(plannerStatusAfterRollover('session-only', pending, 100, firstRuntime), 'initializing')
  assert.equal(plannerStatusAfterRollover('durable', failed, 100, firstRuntime), 'error')
  assert.equal(plannerStatusAfterRollover('durable', ready, 100, firstRuntime), 'durable')
  assert.equal(plannerStatusAfterRollover('session-only', ready, 100, firstRuntime), 'session-only')
  assert.equal(
    plannerStatusAfterRollover('durable', ready, 101, firstRuntime),
    'initializing',
    'a new city day requires its own rollover',
  )
  assert.equal(
    plannerStatusAfterRollover('durable', ready, 100, replacementRuntime),
    'initializing',
    'a replacement runtime cannot inherit another runtime rollover',
  )
  assert.equal(plannerStatusAfterRollover('corrupt', idle, 100, firstRuntime), 'corrupt')
})

test('rollover success classification clears only successful or applied outcomes', () => {
  assert.equal(plannerRolloverSucceeded({ ok: true, code: 'persisted' }), true)
  assert.equal(
    plannerRolloverSucceeded({
      ok: false,
      code: 'session-only',
      changed: true,
      persisted: false,
    }),
    true,
    'an applied session-only rollover is complete even while persistence needs retrying',
  )
  assert.equal(plannerRolloverSucceeded({ ok: false, code: 'nothing-to-rollover' }), true)
  assert.equal(plannerRolloverSucceeded({ ok: false, code: 'already-current' }), true)
  assert.equal(
    plannerRolloverSucceeded({ ok: false, code: 'planner-rebase-conflict', changed: false }),
    false,
  )
  assert.equal(plannerRolloverSucceeded(null), false)
})

test('custom-event catalog readiness gates planner initialization and public actions', () => {
  assert.equal(plannerStatusAfterCatalog('idle', { ready: false }), 'initializing')
  assert.equal(plannerStatusAfterCatalog('durable', { ready: true }), 'durable')
  assert.equal(
    plannerStatusAfterCatalog('durable', {
      ready: false,
      error: { code: 'custom-events-corrupt' },
    }),
    'error',
  )
  assert.equal(
    plannerStatusAfterCatalog('corrupt', {
      ready: false,
      error: { code: 'custom-events-corrupt' },
    }),
    'corrupt',
    'a known corrupt planner destination remains the strongest failure state',
  )

  assert.match(
    source,
    /if \(!runtime \|\| !catalogReady \|\| catalogError\) return[\s\S]*runtime\.initialize/,
  )
  assert.match(source, /const plannerAvailable = catalogReady === true && !catalogError/)
  assert.match(source, /runtimeError: holderSnapshot\.error \|\| rolloverError \|\| catalogError/)
  assert.match(source, /catalogReady=\{catalogReady\}[\s\S]*catalogError=\{catalogError\}/)
})

test('failed rollover is explicit, same-day retryable, and stale completions cannot publish', () => {
  assert.doesNotMatch(source, /runtime\.rollover\([^)]*\)\.catch\(\(\) => \{\}\)/)
  assert.match(source, /phase:\s*'error',[\s\S]*rolloverFailure\(result,\s*rejected,\s*dayTs\)/)
  assert.match(source, /runtimeError:\s*holderSnapshot\.error \|\| rolloverError/)
  assert.match(source, /code:\s*'retry-rollover',[\s\S]*canRetry:\s*true/)
  assert.match(
    source,
    /failed\.phase === 'error'[\s\S]*failed\.dayTs === anchors\?\.todayTs[\s\S]*await attemptRollover\(failed\.dayTs\)/,
  )
  assert.match(
    source,
    /if \(!mountedRef\.current \|\| rolloverAttemptRef\.current !== attempt\) return result/,
  )
  assert.match(
    source,
    /mountedRef\.current = false[\s\S]*rolloverAttemptRef\.current \+= 1/,
  )
})
