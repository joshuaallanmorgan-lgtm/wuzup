import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildS11RefreshReport,
  refreshEvidenceHasFailures,
  S11_REFRESH_REPORT_LIMITS,
} from '../shared/refresh-report.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function health(status, source) {
  return {
    status,
    sources: [source],
  }
}

function manifest(cityId, suffix, eventHealth, placeHealth) {
  return {
    cityId,
    manifestId: `sha256:${suffix.repeat(64)}`,
    buildId: `sha256:${suffix.repeat(64)}`,
    artifacts: {
      events: {
        runId: `${cityId}-events`,
        generatedAt: '2026-07-22T12:00:00.000Z',
        expiresAt: '2026-07-24T12:00:00.000Z',
        sourceHealth: eventHealth,
      },
      places: {
        runId: `${cityId}-places`,
        generatedAt: '2026-07-22T12:00:00.000Z',
        expiresAt: '2026-08-21T12:00:00.000Z',
        sourceHealth: placeHealth,
      },
    },
  }
}

test('refresh report exposes source-health and benchmark exceptions without declaring green', () => {
  const healthy = health('healthy', { name: 'Live source', status: 'healthy', rows: 10, cached: false })
  const degraded = health('degraded', {
    name: 'Eventbrite | cached',
    status: 'degraded',
    rows: 12,
    cached: true,
    fallbackReason: 'live-error',
    error: 'HTTP 405\nprivate detail',
  })
  const report = buildS11RefreshReport({
    placesRefreshed: true,
    cityRuns: {
      'tampa-bay': {
        manifest: manifest('tampa-bay', 'a', degraded, healthy),
        eventLog: '✅ one pass\n⚠️ render fallback',
        placeLog: '✅ source count\n❌ address coverage: 44 | unsafe',
      },
      'sf-east-bay': {
        manifest: manifest('sf-east-bay', 'b', healthy, healthy),
        eventLog: '✅ all event checks',
        placeLog: '✅ all place checks',
      },
    },
  })

  assert.match(report, /Places: refreshed live in this run/)
  assert.match(report, /degraded/)
  assert.match(report, /Eventbrite \\| cached/)
  assert.match(report, /live-error/)
  assert.match(report, /HTTP 405 private detail/)
  assert.match(report, /\[events\] ⚠️ render fallback/)
  assert.match(report, /\[places\] ❌ address coverage: 44 \\| unsafe/)
  assert.match(report, /Evidence verdict: BLOCKED/)
  assert.match(report, /action_required/)
  assert.doesNotMatch(report, /green on this run/i)
})

test('refresh report is deterministic, bounded, and requires the exact city pair', () => {
  const healthy = health('healthy', { name: 'Live', status: 'healthy', rows: 1, cached: false })
  const cityRuns = {
    'sf-east-bay': {
      manifest: manifest('sf-east-bay', 'b', healthy, healthy),
      eventLog: Array.from({ length: 200 }, (_, index) => `❌ event diagnostic ${index} ${'x'.repeat(500)}`).join('\n'),
      placeLog: Array.from({ length: 200 }, (_, index) => `❌ place diagnostic ${index} ${'x'.repeat(500)}`).join('\n'),
    },
    'tampa-bay': {
      manifest: manifest('tampa-bay', 'a', healthy, healthy),
      eventLog: '',
      placeLog: '',
    },
  }
  const first = buildS11RefreshReport({ cityRuns, placesRefreshed: true })
  const second = buildS11RefreshReport({ cityRuns: { ...cityRuns }, placesRefreshed: true })
  assert.equal(first, second)
  assert.equal((first.match(/^- \[events\] ❌ event diagnostic /gm) || []).length, S11_REFRESH_REPORT_LIMITS.diagnosticLinesPerArtifact)
  assert.equal((first.match(/^- \[places\] ❌ place diagnostic /gm) || []).length, S11_REFRESH_REPORT_LIMITS.diagnosticLinesPerArtifact)
  assert.equal(
    S11_REFRESH_REPORT_LIMITS.diagnosticLinesPerArtifact * 2,
    S11_REFRESH_REPORT_LIMITS.diagnosticLinesPerCity,
  )
  assert.ok(first.length <= S11_REFRESH_REPORT_LIMITS.reportCharacters)
  assert.throws(() => buildS11RefreshReport({
    placesRefreshed: false,
    cityRuns: { 'tampa-bay': cityRuns['tampa-bay'] },
  }), /exactly the two/)
})

test('an unselected place refresh needs no place log and cannot contribute stale failures', () => {
  const healthy = health('healthy', { name: 'Live', status: 'healthy', rows: 1, cached: false })
  const cityRuns = Object.fromEntries(['tampa-bay', 'sf-east-bay'].map((cityId, index) => [cityId, {
    manifest: manifest(cityId, index === 0 ? 'a' : 'b', healthy, healthy),
    eventLog: '✅ all event checks',
    placeLog: '❌ stale place benchmark from an earlier run',
  }]))

  const report = buildS11RefreshReport({ cityRuns, placesRefreshed: false })
  assert.match(report, /place refresh not selected; no place execution log expected/)
  assert.match(report, /Evidence verdict: REVIEWABLE/)
  assert.doesNotMatch(report, /stale place benchmark/)
  assert.equal(refreshEvidenceHasFailures({ cityRuns, placesRefreshed: false }), false)
  assert.equal(refreshEvidenceHasFailures({ cityRuns, placesRefreshed: true }), true)

  const withoutPlaceLogs = Object.fromEntries(Object.entries(cityRuns).map(([cityId, run]) => [cityId, {
    manifest: run.manifest,
    eventLog: run.eventLog,
  }]))
  assert.doesNotThrow(() => buildS11RefreshReport({ cityRuns: withoutPlaceLogs, placesRefreshed: false }))
  assert.throws(
    () => buildS11RefreshReport({ cityRuns: withoutPlaceLogs, placesRefreshed: true }),
    /place log missing/,
  )
})

test('refresh workflow requires live two-kind evidence before it can open a PR', () => {
  const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'refresh.yml'), 'utf8')
  const runbook = readFileSync(path.join(ROOT, 'REFRESH.md'), 'utf8')
  const places = readFileSync(path.join(ROOT, 'finder', 'places.mjs'), 'utf8')

  assert.match(workflow, /refresh_places:[\s\S]*?type: boolean[\s\S]*?default: true/)
  assert.match(workflow, /timeout-minutes: 90/)
  assert.match(workflow, /Install Playwright Chromium[\s\S]*?run: npx playwright install --with-deps chromium/)
  assert.doesNotMatch(workflow, /Install Playwright Chromium[\s\S]{0,160}continue-on-error: true/)
  assert.equal((workflow.match(/REQUIRE_LIVE_SOURCES: '1'/g) || []).length, 4)
  assert.match(workflow, /Places — Tampa Bay[\s\S]*?if: steps\.cadence\.outputs\.refresh_places == 'true'/)
  assert.match(workflow, /Places — SF & East Bay[\s\S]*?if: steps\.cadence\.outputs\.refresh_places == 'true'/)
  assert.match(workflow, /CITY=tampa-bay node finder\/places\.mjs \| tee "\$RUNNER_TEMP\/tampa-places\.log"/)
  assert.match(workflow, /CITY=sf-east-bay node finder\/places\.mjs \| tee "\$RUNNER_TEMP\/sf-places\.log"/)
  assert.match(workflow, /shared\/refresh-report\.mjs[\s\S]*?tampa\.log[\s\S]*?sf\.log[\s\S]*?tampa-places\.log[\s\S]*?sf-places\.log/)
  assert.match(workflow, /REPORT_STATUS=\$\?[\s\S]*?cat "\$RUNNER_TEMP\/refresh-report\.md" >> "\$GITHUB_STEP_SUMMARY"[\s\S]*?exit "\$REPORT_STATUS"/)
  assert.match(workflow, /REQUIRE_FRESH_ARTIFACTS: '1'[\s\S]*?REQUIRE_VERIFIED_SOURCES: '1'[\s\S]*?CITY=tampa-bay node finder\/deploy\.mjs/)
  assert.match(workflow, /CITY=sf-east-bay DEPLOY_DEST="\$RUNNER_TEMP\/sf-public" node finder\/deploy\.mjs/)
  assert.ok(workflow.indexOf('Publish bounded refresh evidence') < workflow.indexOf('Open the data-refresh PR'))
  assert.ok(workflow.indexOf('Strictly verify SF & East Bay') < workflow.indexOf('Gate — npm test'))
  assert.match(workflow, /git switch -c "\$BRANCH"/)
  assert.doesNotMatch(workflow, /git push origin main/)

  assert.match(runbook, /runs events daily/)
  assert.match(runbook, /every Thursday/)
  assert.match(runbook, /action_required/)
  assert.match(runbook, /Approve and run/)
  assert.match(runbook, /empty check list.*never green/s)
  assert.match(places, /cacheOnly: REQUIRE_LIVE_SOURCES/)
})
