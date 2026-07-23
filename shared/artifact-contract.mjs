// Browser-safe half of Wuzup's immutable city-artifact contract. Generation,
// deployment, runtime loading, and tests all share these shapes and identity
// payloads so the browser cannot silently reinterpret finder output.

export const MANIFEST_FILE = 'artifact-manifest.json'
export const MANIFEST_SCHEMA_VERSION = 1
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

export const ARTIFACT_SPECS = Object.freeze({
  events: Object.freeze({
    file: 'events.json', collection: null, schemaVersion: null, maxAgeHours: 48,
    validRow: (row) => row && typeof row === 'object'
      && typeof row.id === 'string' && row.id.length > 0
      && typeof row.title === 'string' && row.title.trim().length > 0
      && typeof row.start === 'string' && row.start.length > 0,
  }),
  places: Object.freeze({
    file: 'places.json', collection: 'places', schemaVersion: 1, maxAgeHours: 30 * 24,
    validRow: (row) => row && typeof row === 'object'
      && typeof row.key === 'string' && row.key.length > 0
      && typeof row.name === 'string' && row.name.trim().length > 0,
  }),
  guides: Object.freeze({
    file: 'guides.json', collection: 'guides', schemaVersion: 1, maxAgeHours: null,
    validRow: (row) => row && typeof row === 'object'
      && typeof row.id === 'string' && row.id.length > 0
      && typeof row.title === 'string' && row.title.trim().length > 0,
  }),
})

export const HEALTH_STATUSES = new Set(['healthy', 'degraded', 'failed', 'unknown'])
export const FALLBACK_REASONS = new Set(['live-empty', 'live-error', 'source-error', 'processing-error'])

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function validIso(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

export function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''))
}

export function validCount(value) {
  return Number.isInteger(value) && value >= 0
}

export function expiresAt(generatedAt, maxAgeHours) {
  if (!generatedAt || maxAgeHours == null) return null
  const epoch = Date.parse(generatedAt)
  if (Number.isNaN(epoch)) return null
  return new Date(epoch + maxAgeHours * 3600 * 1000).toISOString()
}

export function aggregateHealthStatus(counts, total) {
  if (total === 0 || counts.unknown > 0) return 'unknown'
  if (counts.failed > 0 && counts.healthy === 0 && counts.degraded === 0) return 'failed'
  if (counts.failed > 0 || counts.degraded > 0) return 'degraded'
  return 'healthy'
}

export function sourceHealthProblems(health, expectedRunId, label) {
  const problems = []
  if (!health || !HEALTH_STATUSES.has(health.status)) return [`${label} is missing or has an invalid status`]
  if (health.runId !== expectedRunId) problems.push(`${label}.runId must match its artifact runId`)
  if (!validIso(health.checkedAt)) problems.push(`${label}.checkedAt is missing or invalid`)
  if (!Array.isArray(health.sources)) problems.push(`${label}.sources must be an array`)
  for (const field of ['total', 'healthy', 'degraded', 'failed', 'unknown']) {
    if (!validCount(health[field])) problems.push(`${label}.${field} must be a non-negative integer`)
  }
  if (Array.isArray(health.sources)) {
    if (health.total !== health.sources.length) problems.push(`${label}.total must equal sources.length`)
    const counts = { healthy: 0, degraded: 0, failed: 0, unknown: 0 }
    for (const [index, source] of health.sources.entries()) {
      if (!source || typeof source.name !== 'string' || !source.name.trim()) problems.push(`${label}.sources[${index}].name is missing`)
      if (!source || !HEALTH_STATUSES.has(source.status)) problems.push(`${label}.sources[${index}].status is invalid`)
      else counts[source.status] += 1
      if (source?.rows != null && !validCount(source.rows)) problems.push(`${label}.sources[${index}].rows is invalid`)
      if (source?.cached != null && typeof source.cached !== 'boolean') problems.push(`${label}.sources[${index}].cached is invalid`)
      if (source?.fallbackReason != null && !FALLBACK_REASONS.has(source.fallbackReason)) problems.push(`${label}.sources[${index}].fallbackReason is invalid`)
    }
    for (const field of ['healthy', 'degraded', 'failed', 'unknown']) {
      if (health[field] !== counts[field]) problems.push(`${label}.${field} does not match source receipts`)
    }
    const aggregate = aggregateHealthStatus(counts, health.sources.length)
    if (health.status !== aggregate) problems.push(`${label}.status '${health.status}' contradicts source receipts ('${aggregate}')`)
  }
  return problems
}

export function artifactBuildIdentityPayload(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    cityId: manifest.cityId,
    timeZone: manifest.timeZone,
    artifacts: Object.fromEntries(Object.entries(manifest.artifacts || {}).map(([kind, entry]) => [kind, {
      file: entry.file,
      sha256: entry.sha256,
      bytes: entry.bytes,
      count: entry.count,
    }])),
    placeImages: manifest.placeImages && {
      dir: manifest.placeImages.dir,
      sha256: manifest.placeImages.sha256,
      bytes: manifest.placeImages.bytes,
      count: manifest.placeImages.count,
    },
    shards: manifest.shards || [],
  }
}

export function artifactManifestIdentityPayload(manifest) {
  const { manifestId: _ignored, ...payload } = manifest
  return payload
}

export function manifestShapeProblems(manifest, expectedCityId, expectedTimeZone) {
  const problems = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return [`${MANIFEST_FILE} must contain an object`]
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) problems.push(`unsupported manifest schemaVersion ${manifest.schemaVersion}`)
  if (manifest.cityId !== expectedCityId) problems.push(`manifest cityId '${manifest.cityId}' does not match '${expectedCityId}'`)
  if (expectedTimeZone && manifest.timeZone !== expectedTimeZone) problems.push(`manifest timeZone '${manifest.timeZone}' does not match '${expectedTimeZone}'`)
  if (!/^sha256:[a-f0-9]{64}$/.test(String(manifest.buildId || ''))) problems.push('manifest buildId is missing or malformed')
  if (!/^sha256:[a-f0-9]{64}$/.test(String(manifest.manifestId || ''))) problems.push('manifest manifestId is missing or malformed')
  if (!validIso(manifest.generatedAt)) problems.push('manifest generatedAt is missing or invalid')
  if (!validIso(manifest.assembledAt)) problems.push('manifest assembledAt is missing or invalid')
  if (!manifest.runId || typeof manifest.runId !== 'string') problems.push('manifest runId is missing')
  if (!Array.isArray(manifest.shards)) problems.push('manifest shards must be an array')

  problems.push(...sourceHealthProblems(manifest.sourceHealth, manifest.runId, 'sourceHealth'))

  for (const [kind, spec] of Object.entries(ARTIFACT_SPECS)) {
    const entry = manifest.artifacts?.[kind]
    if (!entry) problems.push(`manifest is missing artifacts.${kind}`)
    else {
      if (entry.file !== spec.file) problems.push(`artifacts.${kind}.file must be '${spec.file}'`)
      if (!validDigest(entry.sha256)) problems.push(`artifacts.${kind}.sha256 is missing or malformed`)
      if (!validCount(entry.bytes)) problems.push(`artifacts.${kind}.bytes must be a non-negative integer`)
      if (!validCount(entry.count)) problems.push(`artifacts.${kind}.count must be a non-negative integer`)
      if (!entry.runId || typeof entry.runId !== 'string') problems.push(`artifacts.${kind}.runId is missing`)
      if (spec.maxAgeHours == null) {
        if (entry.generatedAt != null && !validIso(entry.generatedAt)) problems.push(`artifacts.${kind}.generatedAt is invalid`)
      } else if (!validIso(entry.generatedAt)) problems.push(`artifacts.${kind}.generatedAt is missing or invalid`)
      if (entry.maxAgeHours !== spec.maxAgeHours) problems.push(`artifacts.${kind}.maxAgeHours must be ${spec.maxAgeHours}`)
      const expectedExpiry = expiresAt(entry.generatedAt, spec.maxAgeHours)
      if (entry.expiresAt !== expectedExpiry) problems.push(`artifacts.${kind}.expiresAt does not match generatedAt + maxAgeHours`)
      if (!entry.provenance || typeof entry.provenance !== 'string') problems.push(`artifacts.${kind}.provenance is missing`)
      if (spec.maxAgeHours != null || entry.sourceHealth) {
        problems.push(...sourceHealthProblems(entry.sourceHealth, entry.runId, `artifacts.${kind}.sourceHealth`))
      }
    }
  }
  const eventEntry = manifest.artifacts?.events
  if (eventEntry) {
    if (manifest.runId !== eventEntry.runId) problems.push('manifest runId must match artifacts.events.runId')
    if (manifest.generatedAt !== eventEntry.generatedAt) problems.push('manifest generatedAt must match artifacts.events.generatedAt')
    if (manifest.expiresAt !== eventEntry.expiresAt) problems.push('manifest expiresAt must match artifacts.events.expiresAt')
    if (manifest.maxAgeHours !== eventEntry.maxAgeHours) problems.push('manifest maxAgeHours must match artifacts.events.maxAgeHours')
    if (stableStringify(manifest.sourceHealth) !== stableStringify(eventEntry.sourceHealth)) problems.push('manifest sourceHealth must match artifacts.events.sourceHealth')
  }
  const images = manifest.placeImages
  if (!images || images.dir !== 'place-img') problems.push("manifest placeImages.dir must be 'place-img'")
  else {
    if (!validDigest(images.sha256)) problems.push('placeImages.sha256 is missing or malformed')
    if (!validCount(images.bytes)) problems.push('placeImages.bytes must be a non-negative integer')
    if (!validCount(images.count)) problems.push('placeImages.count must be a non-negative integer')
  }
  return problems
}

export function manifestTemporalProblems(manifest, now = Date.now()) {
  const problems = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return problems
  const futureLimit = now + MAX_CLOCK_SKEW_MS
  const assembledMs = validIso(manifest.assembledAt) ? Date.parse(manifest.assembledAt) : null
  const timestamps = [
    ['manifest generatedAt', manifest.generatedAt],
    ['manifest assembledAt', manifest.assembledAt],
    ['event sourceHealth.checkedAt', manifest.sourceHealth?.checkedAt],
  ]
  for (const [kind] of Object.entries(ARTIFACT_SPECS)) {
    const entry = manifest.artifacts?.[kind]
    if (entry?.generatedAt) timestamps.push([`${kind} generatedAt`, entry.generatedAt])
    if (entry?.sourceHealth?.checkedAt) {
      timestamps.push([`${kind} sourceHealth.checkedAt`, entry.sourceHealth.checkedAt])
    }
    if (
      assembledMs != null
      && validIso(entry?.generatedAt)
      && Date.parse(entry.generatedAt) > assembledMs + MAX_CLOCK_SKEW_MS
    ) {
      problems.push(`${kind} generatedAt is later than manifest assembledAt`)
    }
  }
  for (const [label, value] of timestamps) {
    if (validIso(value) && Date.parse(value) > futureLimit) {
      problems.push(`${label} is implausibly in the future`)
    }
  }
  return problems
}

export function inspectArtifactPayload(kind, parsed, expectedCount) {
  const spec = ARTIFACT_SPECS[kind]
  if (!spec) return { rows: null, problems: [`unsupported artifact kind '${kind}'`] }
  const problems = []
  if (spec.schemaVersion != null && parsed?.schemaVersion !== spec.schemaVersion) {
    problems.push(`${spec.file} schemaVersion must be ${spec.schemaVersion}`)
  }
  const rows = spec.collection == null ? parsed : parsed?.[spec.collection]
  if (!Array.isArray(rows)) {
    problems.push(`${spec.file} must contain ${spec.collection == null ? 'an array' : `a ${spec.collection}[] array`}`)
    return { rows: null, problems }
  }
  if (expectedCount != null && rows.length !== expectedCount) {
    problems.push(`${spec.file} count ${rows.length} does not match manifest count ${expectedCount}`)
  }
  const invalidIndex = rows.findIndex((row) => !spec.validRow(row))
  if (invalidIndex !== -1) problems.push(`${spec.file} row ${invalidIndex} fails the minimum runtime schema`)
  return { rows, problems }
}

export function artifactWarnings(entry) {
  const status = entry?.sourceHealth?.status
  if (status === 'degraded') return ['SOURCE_HEALTH_DEGRADED']
  if (status === 'unknown') return ['SOURCE_HEALTH_UNKNOWN']
  return []
}
