import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyArtifactSet } from '../finder/artifact-manifest.mjs'

export const S11_REFRESH_REPORT_LIMITS = Object.freeze({
  logBytes: 4 * 1024 * 1024,
  diagnosticLinesPerCity: 80,
  diagnosticLinesPerArtifact: 40,
  diagnosticLineCharacters: 300,
  reportCharacters: 60_000,
})

const CITY_CONTRACTS = Object.freeze({
  'sf-east-bay': Object.freeze({ name: 'SF & East Bay', timeZone: 'America/Los_Angeles' }),
  'tampa-bay': Object.freeze({ name: 'Tampa Bay', timeZone: 'America/New_York' }),
})

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function cell(value) {
  return String(value ?? 'unknown')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .slice(0, S11_REFRESH_REPORT_LIMITS.diagnosticLineCharacters)
}

function sourceDiagnostics(health) {
  if (!health || !Array.isArray(health.sources)) return ['- source-health receipt missing']
  const rows = health.sources.filter((source) => source.status !== 'healthy')
  if (rows.length === 0) return ['- all declared sources are healthy']
  return rows.map((source) => {
    const details = [
      `rows=${source.rows}`,
      source.cached ? 'cached' : 'live',
      source.fallbackReason || null,
      source.error || null,
    ].filter(Boolean).map(cell).join(' · ')
    return `- **${cell(source.status)}** ${cell(source.name)} — ${details}`
  })
}

function diagnosticLines(log, artifact) {
  const lines = String(log || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /[❌⚠️]/u.test(line))
    .slice(0, S11_REFRESH_REPORT_LIMITS.diagnosticLinesPerArtifact)
    .map((line) => `- [${artifact}] ${cell(line)}`)
  return lines.length > 0 ? lines : ['- no warning/failure diagnostic lines emitted']
}

function logHasFailure(log) {
  return String(log || '')
    .split(/\r?\n/)
    .some((line) => /^\s*❌/u.test(line))
}

export function refreshEvidenceHasFailures({ cityRuns, placesRefreshed }) {
  invariant(typeof placesRefreshed === 'boolean', 'placesRefreshed must be boolean')
  invariant(cityRuns && typeof cityRuns === 'object', 'cityRuns must be an object')
  return Object.values(cityRuns).some((run) => (
    logHasFailure(run?.eventLog)
    || (placesRefreshed && logHasFailure(run?.placeLog))
  ))
}

function artifactRow(cityId, kind, artifact) {
  const health = artifact?.sourceHealth
  return `| ${cell(cityId)} | ${kind} | ${cell(health?.status)} | ${cell(artifact?.runId)} | ${cell(artifact?.generatedAt)} | ${cell(artifact?.expiresAt)} |`
}

export function buildS11RefreshReport({ cityRuns, placesRefreshed }) {
  invariant(typeof placesRefreshed === 'boolean', 'placesRefreshed must be boolean')
  invariant(cityRuns && typeof cityRuns === 'object', 'cityRuns must be an object')
  const cityIds = Object.keys(CITY_CONTRACTS).sort()
  invariant(
    Object.keys(cityRuns).sort().join('|') === cityIds.join('|'),
    'cityRuns must contain exactly the two S11 flagship cities',
  )
  for (const cityId of cityIds) {
    invariant(typeof cityRuns[cityId]?.eventLog === 'string', `event log missing for ${cityId}`)
    if (placesRefreshed) {
      invariant(typeof cityRuns[cityId]?.placeLog === 'string', `place log missing for ${cityId}`)
    }
  }
  const hasFailures = refreshEvidenceHasFailures({ cityRuns, placesRefreshed })

  const lines = [
    '# Verified refresh candidate',
    '',
    `- Places: ${placesRefreshed ? 'refreshed live in this run' : 'reused from the previously sealed receipt'}`,
    `- Evidence verdict: ${hasFailures ? 'BLOCKED — a refresh run emitted a failure diagnostic' : 'REVIEWABLE — no failure diagnostic was emitted'}`,
    '- A green test command does not erase source-health or benchmark exceptions below.',
    '- Merge only after an actual CI gate job appears and passes; `action_required` or an empty check list is unexecuted.',
    '',
    '| City | Artifact | Source health | Run ID | Generated | Expires |',
    '| --- | --- | --- | --- | --- | --- |',
  ]

  for (const cityId of cityIds) {
    const { manifest } = cityRuns[cityId]
    invariant(manifest?.cityId === cityId, `refresh report manifest city mismatch for ${cityId}`)
    lines.push(artifactRow(cityId, 'events', manifest.artifacts?.events))
    lines.push(artifactRow(cityId, 'places', manifest.artifacts?.places))
  }

  for (const cityId of cityIds) {
    const { name } = CITY_CONTRACTS[cityId]
    const { manifest, eventLog, placeLog } = cityRuns[cityId]
    lines.push(
      '',
      `## ${name}`,
      '',
      `- Manifest: \`${cell(manifest.manifestId)}\``,
      `- Build: \`${cell(manifest.buildId)}\``,
      '',
      '### Nonhealthy source evidence',
      '',
      ...sourceDiagnostics(manifest.artifacts?.events?.sourceHealth),
      ...sourceDiagnostics(manifest.artifacts?.places?.sourceHealth),
      '',
      '### Event finder warnings and failed benchmarks',
      '',
      ...diagnosticLines(eventLog, 'events'),
      '',
      '### Place finder warnings and failed benchmarks',
      '',
      ...(placesRefreshed
        ? diagnosticLines(placeLog, 'places')
        : ['- place refresh not selected; no place execution log expected']),
    )
  }

  lines.push(
    '',
    '## Operator gate',
    '',
    'If GitHub marks the bot PR `action_required`, open its Checks/Actions entry and choose **Approve and run**. '
      + 'Wait for a real `gate` job to pass before merge. Merging triggers Pages; confirm the postdeploy site receipt.',
    '',
  )
  const report = lines.join('\n')
  invariant(report.length <= S11_REFRESH_REPORT_LIMITS.reportCharacters, 'refresh report exceeds its character limit')
  return report
}

function readBoundedLog(filePath) {
  const absolute = path.resolve(filePath)
  const stat = statSync(absolute)
  invariant(stat.isFile(), `refresh log is not a regular file: ${absolute}`)
  invariant(stat.size <= S11_REFRESH_REPORT_LIMITS.logBytes, `refresh log exceeds its byte limit: ${absolute}`)
  return readFileSync(absolute, 'utf8')
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const placesRefreshed = process.argv[2] === 'true'
      ? true
      : process.argv[2] === 'false'
        ? false
        : null
    const usage = 'usage: refresh-report.mjs <true|false> <tampa-event.log> <sf-event.log> <tampa-place.log> <sf-place.log>'
    invariant(placesRefreshed !== null, usage)
    invariant(process.argv.length === 7, usage)
    const eventLogs = {
      'tampa-bay': readBoundedLog(process.argv[3]),
      'sf-east-bay': readBoundedLog(process.argv[4]),
    }
    const placeLogs = placesRefreshed
      ? {
          'tampa-bay': readBoundedLog(process.argv[5]),
          'sf-east-bay': readBoundedLog(process.argv[6]),
        }
      : {}
    const cityRuns = {}
    for (const [cityId, contract] of Object.entries(CITY_CONTRACTS)) {
      const checked = verifyArtifactSet({
        root: path.resolve('finder', 'output', cityId),
        expectedCityId: cityId,
        expectedTimeZone: contract.timeZone,
      })
      invariant(checked.manifest !== null && checked.problems.length === 0, `untrusted ${cityId} artifact set: ${checked.problems.join(' | ')}`)
      cityRuns[cityId] = {
        manifest: checked.manifest,
        eventLog: eventLogs[cityId],
        placeLog: placeLogs[cityId],
      }
    }
    process.stdout.write(`${buildS11RefreshReport({ cityRuns, placesRefreshed })}\n`)
    if (refreshEvidenceHasFailures({ cityRuns, placesRefreshed })) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`)
    process.exitCode = 1
  }
}
