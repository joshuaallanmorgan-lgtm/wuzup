// Immutable artifact envelope shared by generation, deploy verification, and
// focused contract tests. Runtime consumption lands in Sprint 2; this Node
// module is the authoritative byte-level contract for Sprint 1.
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const MANIFEST_FILE = 'artifact-manifest.json';
export const PENDING_MANIFEST_FILE = '.artifact-manifest.pending.json';
export const MANIFEST_SCHEMA_VERSION = 1;

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
});

const HEALTH_STATUSES = new Set(['healthy', 'degraded', 'failed', 'unknown']);
const FALLBACK_REASONS = new Set(['live-empty', 'live-error', 'source-error', 'processing-error']);
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function atomicWriteFileSync(path, contents) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, contents);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

// Writers remove the trust pointer before changing any member. A failed run
// may leave recoverable member bytes, but it can never leave an old manifest
// claiming that a mixed set is valid.
export function invalidateManifest(root, { expectedCityId, expectedTimeZone, preservePending = false } = {}) {
  const previous = readTrustedPrevious(root, expectedCityId, expectedTimeZone);
  if (preservePending && previous) {
    atomicWriteFileSync(join(root, PENDING_MANIFEST_FILE), `${JSON.stringify(previous, null, 2)}\n`);
  }
  rmSync(join(root, MANIFEST_FILE), { force: true });
  return previous;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function summarizeSourceHealth(report, { runId, checkedAt }) {
  const sources = (Array.isArray(report) ? report : []).map((row) => {
    const cached = row?.cached === true || typeof row?.cached === 'string';
    const explicitStatus = HEALTH_STATUSES.has(row?.status) ? row.status : null;
    const rows = validCount(row?.found) ? row.found : 0;
    const status = explicitStatus ?? (cached ? 'degraded' : row?.ok === true ? (rows > 0 ? 'healthy' : 'degraded') : 'failed');
    return {
      name: String(row?.source || 'Unknown source'),
      status,
      rows,
      cached,
      ...(FALLBACK_REASONS.has(row?.fallbackReason) ? { fallbackReason: row.fallbackReason } : {}),
      ...(row?.error ? { error: String(row.error) } : {}),
    };
  });
  const counts = { healthy: 0, degraded: 0, failed: 0, unknown: 0 };
  for (const source of sources) counts[source.status] += 1;
  const status = aggregateHealthStatus(counts, sources.length);
  return {
    status,
    runId,
    checkedAt,
    total: sources.length,
    ...counts,
    sources,
  };
}

function readJsonArtifact(root, spec) {
  const path = join(root, spec.file);
  const bytes = readFileSync(path);
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (spec.schemaVersion != null && parsed?.schemaVersion !== spec.schemaVersion) {
    throw new Error(`${spec.file} schemaVersion must be ${spec.schemaVersion}`);
  }
  const rows = spec.collection == null ? parsed : parsed?.[spec.collection];
  if (!Array.isArray(rows)) {
    throw new Error(`${spec.file} must contain ${spec.collection == null ? 'an array' : `a ${spec.collection}[] array`}`);
  }
  const invalidIndex = rows.findIndex((row) => !spec.validRow(row));
  if (invalidIndex !== -1) throw new Error(`${spec.file} row ${invalidIndex} fails the minimum runtime schema`);
  return {
    file: spec.file,
    sha256: sha256(bytes),
    bytes: bytes.length,
    count: rows.length,
  };
}

function readImageDirectory(root) {
  const dir = join(root, 'place-img');
  const files = readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort();
  let bytes = 0;
  const digestRows = [];
  for (const name of files) {
    const path = join(dir, name);
    const info = statSync(path);
    if (!info.isFile()) throw new Error(`place-img/${name} is not a file`);
    const body = readFileSync(path);
    bytes += body.length;
    digestRows.push(`${name}\0${body.length}\0${sha256(body)}`);
  }
  return {
    dir: 'place-img',
    sha256: sha256(Buffer.from(digestRows.join('\n'))),
    bytes,
    count: files.length,
  };
}

function localImageReferenceProblems(root) {
  const problems = [];
  const doc = JSON.parse(readFileSync(join(root, 'places.json'), 'utf8'));
  const available = new Set(readdirSync(join(root, 'place-img')).filter((name) => !name.startsWith('.')));
  for (const [index, place] of (doc.places || []).entries()) {
    const image = place?.image;
    if (typeof image !== 'string' || !image.startsWith('/place-img/')) continue;
    const name = image.slice('/place-img/'.length);
    if (!name || name.includes('/') || name.includes('\\') || !available.has(name)) {
      problems.push(`places.json row ${index} references missing local image '${image}'`);
    }
  }
  return problems;
}

function zonedParts(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter.formatToParts(new Date(epochMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}

// Convert the finder markdown's city-local timestamp to an immutable UTC ISO
// instant without relying on the machine's timezone. The short iteration also
// handles DST offsets for the date being converted.
export function cityLocalTimestampToIso(value, timeZone) {
  const match = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return null;
  const [, month, day, year, hourText, minute, second, meridiem] = match;
  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === 'PM') hour += 12;
  const desired = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour,
    minute: Number(minute),
    second: Number(second),
  };
  const desiredUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second);
  let candidate = desiredUtc;
  for (let i = 0; i < 3; i += 1) {
    const seen = zonedParts(candidate, timeZone);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    candidate += desiredUtc - seenUtc;
  }
  return new Date(candidate).toISOString();
}

function legacyMetadata(root, kind, timeZone) {
  const path = join(root, `${kind}.md`);
  if (!existsSync(path)) return { generatedAt: null, sources: [] };
  const text = readFileSync(path, 'utf8');
  const match = text.match(/_Generated\s+(.+?)\s+[·Â]+\s+sources:\s*(.+?)_\s*$/m);
  if (!match) return { generatedAt: null, sources: [] };
  return {
    generatedAt: cityLocalTimestampToIso(match[1], timeZone),
    sources: match[2].split(/\s*,\s*/).map((name) => name.trim()).filter(Boolean),
  };
}

function aggregateHealthStatus(counts, total) {
  if (total === 0 || counts.unknown > 0) return 'unknown';
  if (counts.failed > 0 && counts.healthy === 0 && counts.degraded === 0) return 'failed';
  if (counts.failed > 0 || counts.degraded > 0) return 'degraded';
  return 'healthy';
}

function legacySourceHealth(metadata, runId, generatedAt) {
  if (!generatedAt) return null;
  const sources = metadata.sources.map((name) => ({ name, status: 'unknown', rows: null, cached: null }));
  return {
    status: 'unknown',
    runId,
    checkedAt: generatedAt,
    total: sources.length,
    healthy: 0,
    degraded: 0,
    failed: 0,
    unknown: sources.length,
    sources,
    note: 'Legacy artifact predates persisted per-source run receipts.',
  };
}

function expiresAt(generatedAt, maxAgeHours) {
  if (!generatedAt || maxAgeHours == null) return null;
  const epoch = Date.parse(generatedAt);
  if (Number.isNaN(epoch)) return null;
  return new Date(epoch + maxAgeHours * 3600 * 1000).toISOString();
}

function priorArtifact(previous, kind, inspected) {
  const old = previous?.artifacts?.[kind];
  return old?.sha256 === inspected.sha256 && old?.bytes === inspected.bytes && old?.count === inspected.count ? old : null;
}

export function calculateBuildId(manifest) {
  // Content identity deliberately excludes run/seal receipts. A successful
  // refresh can produce the same payload bytes with a new runId/generatedAt;
  // those exact manifest bytes are separately bound by manifestId.
  const payload = {
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
  };
  return `sha256:${sha256(Buffer.from(stableStringify(payload)))}`;
}

export function calculateManifestId(manifest) {
  const { manifestId: _ignored, ...payload } = manifest;
  return `sha256:${sha256(Buffer.from(stableStringify(payload)))}`;
}

function trustPrevious(previous, cityId, timeZone) {
  try {
    const expectedCityId = cityId ?? previous?.cityId;
    const expectedTimeZone = timeZone ?? previous?.timeZone;
    if (manifestShapeProblems(previous, expectedCityId, expectedTimeZone).length) return null;
    if (calculateBuildId(previous) !== previous.buildId) return null;
    if (calculateManifestId(previous) !== previous.manifestId) return null;
    return previous;
  } catch {
    return null;
  }
}

function readTrustedPrevious(root, cityId, timeZone) {
  for (const file of [MANIFEST_FILE, PENDING_MANIFEST_FILE]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    try {
      const trusted = trustPrevious(JSON.parse(readFileSync(path, 'utf8')), cityId, timeZone);
      if (trusted) return trusted;
    } catch {
      // Try the recovery receipt when the public pointer is malformed.
    }
  }
  return null;
}

export function buildManifest({
  root,
  cityId,
  timeZone,
  assembledAt = new Date().toISOString(),
  componentReceipts = {},
  previousManifest = null,
}) {
  const previous = trustPrevious(previousManifest, cityId, timeZone) ?? readTrustedPrevious(root, cityId, timeZone);

  const inspected = Object.fromEntries(
    Object.entries(ARTIFACT_SPECS).map(([kind, spec]) => [kind, readJsonArtifact(root, spec)]),
  );
  const images = readImageDirectory(root);
  const referenceProblems = localImageReferenceProblems(root);
  if (referenceProblems.length) throw new Error(referenceProblems.join(' · '));

  const artifacts = {};
  for (const [kind, spec] of Object.entries(ARTIFACT_SPECS)) {
    const prior = priorArtifact(previous, kind, inspected[kind]);
    const receipt = componentReceipts[kind] || null;
    const legacy = receipt || prior ? null : legacyMetadata(root, kind, timeZone);
    const generatedAt = receipt?.generatedAt ?? prior?.generatedAt ?? legacy?.generatedAt ?? null;
    const runId = receipt?.runId ?? prior?.runId ?? `legacy-${cityId}-${kind}-${inspected[kind].sha256.slice(0, 16)}`;
    const sourceHealth = receipt?.sourceHealth ?? prior?.sourceHealth ?? (legacy ? legacySourceHealth(legacy, runId, generatedAt) : null);
    artifacts[kind] = {
      ...inspected[kind],
      runId,
      generatedAt,
      expiresAt: expiresAt(generatedAt, spec.maxAgeHours),
      maxAgeHours: spec.maxAgeHours,
      provenance: receipt?.provenance ?? prior?.provenance ?? (generatedAt ? 'legacy-markdown' : 'unknown'),
      ...(sourceHealth ? { sourceHealth } : {}),
    };
  }

  const previousEventManifest = priorArtifact(previous, 'events', inspected.events) ? previous : null;
  const eventReceipt = componentReceipts.events || null;
  const eventRunId = artifacts.events.runId;
  const sourceHealth = eventReceipt?.sourceHealth ?? previousEventManifest?.sourceHealth ?? artifacts.events.sourceHealth;
  artifacts.events.sourceHealth = sourceHealth;
  const sameMembers = previous && Object.entries(inspected).every(([kind, entry]) => priorArtifact(previous, kind, entry))
    && previous.placeImages?.sha256 === images.sha256
    && previous.placeImages?.bytes === images.bytes
    && previous.placeImages?.count === images.count;
  const generatedAt = artifacts.events.generatedAt;
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    cityId,
    timeZone,
    runId: eventRunId,
    generatedAt,
    expiresAt: artifacts.events.expiresAt,
    maxAgeHours: artifacts.events.maxAgeHours,
    assembledAt: sameMembers && Object.keys(componentReceipts).length === 0
      ? previous.assembledAt
      : assembledAt,
    provenance: artifacts.events.provenance,
    sourceHealth,
    artifacts,
    placeImages: images,
    shards: [],
  };
  manifest.buildId = calculateBuildId(manifest);
  manifest.manifestId = calculateManifestId(manifest);
  return manifest;
}

export function writeManifest(options) {
  const manifest = buildManifest(options);
  atomicWriteFileSync(join(options.root, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(join(options.root, PENDING_MANIFEST_FILE), { force: true });
  return manifest;
}

function validIso(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function validCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function sourceHealthProblems(health, expectedRunId, label) {
  const problems = [];
  if (!health || !HEALTH_STATUSES.has(health.status)) return [`${label} is missing or has an invalid status`];
  if (health.runId !== expectedRunId) problems.push(`${label}.runId must match its artifact runId`);
  if (!validIso(health.checkedAt)) problems.push(`${label}.checkedAt is missing or invalid`);
  if (!Array.isArray(health.sources)) problems.push(`${label}.sources must be an array`);
  for (const field of ['total', 'healthy', 'degraded', 'failed', 'unknown']) {
    if (!validCount(health[field])) problems.push(`${label}.${field} must be a non-negative integer`);
  }
  if (Array.isArray(health.sources)) {
    if (health.total !== health.sources.length) problems.push(`${label}.total must equal sources.length`);
    const counts = { healthy: 0, degraded: 0, failed: 0, unknown: 0 };
    for (const [index, source] of health.sources.entries()) {
      if (!source || typeof source.name !== 'string' || !source.name.trim()) problems.push(`${label}.sources[${index}].name is missing`);
      if (!source || !HEALTH_STATUSES.has(source.status)) problems.push(`${label}.sources[${index}].status is invalid`);
      else counts[source.status] += 1;
      if (source?.rows != null && !validCount(source.rows)) problems.push(`${label}.sources[${index}].rows is invalid`);
      if (source?.cached != null && typeof source.cached !== 'boolean') problems.push(`${label}.sources[${index}].cached is invalid`);
      if (source?.fallbackReason != null && !FALLBACK_REASONS.has(source.fallbackReason)) problems.push(`${label}.sources[${index}].fallbackReason is invalid`);
    }
    for (const field of ['healthy', 'degraded', 'failed', 'unknown']) {
      if (health[field] !== counts[field]) problems.push(`${label}.${field} does not match source receipts`);
    }
    const aggregate = aggregateHealthStatus(counts, health.sources.length);
    if (health.status !== aggregate) problems.push(`${label}.status '${health.status}' contradicts source receipts ('${aggregate}')`);
  }
  return problems;
}

function manifestShapeProblems(manifest, expectedCityId, expectedTimeZone) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return [`${MANIFEST_FILE} must contain an object`];
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) problems.push(`unsupported manifest schemaVersion ${manifest.schemaVersion}`);
  if (manifest.cityId !== expectedCityId) problems.push(`manifest cityId '${manifest.cityId}' does not match '${expectedCityId}'`);
  if (expectedTimeZone && manifest.timeZone !== expectedTimeZone) problems.push(`manifest timeZone '${manifest.timeZone}' does not match '${expectedTimeZone}'`);
  if (!/^sha256:[a-f0-9]{64}$/.test(String(manifest.buildId || ''))) problems.push('manifest buildId is missing or malformed');
  if (!/^sha256:[a-f0-9]{64}$/.test(String(manifest.manifestId || ''))) problems.push('manifest manifestId is missing or malformed');
  if (!validIso(manifest.generatedAt)) problems.push('manifest generatedAt is missing or invalid');
  if (!validIso(manifest.assembledAt)) problems.push('manifest assembledAt is missing or invalid');
  if (!manifest.runId || typeof manifest.runId !== 'string') problems.push('manifest runId is missing');
  if (!Array.isArray(manifest.shards)) problems.push('manifest shards must be an array');

  problems.push(...sourceHealthProblems(manifest.sourceHealth, manifest.runId, 'sourceHealth'));

  for (const [kind, spec] of Object.entries(ARTIFACT_SPECS)) {
    const entry = manifest.artifacts?.[kind];
    if (!entry) problems.push(`manifest is missing artifacts.${kind}`);
    else {
      if (entry.file !== spec.file) problems.push(`artifacts.${kind}.file must be '${spec.file}'`);
      if (!validDigest(entry.sha256)) problems.push(`artifacts.${kind}.sha256 is missing or malformed`);
      if (!validCount(entry.bytes)) problems.push(`artifacts.${kind}.bytes must be a non-negative integer`);
      if (!validCount(entry.count)) problems.push(`artifacts.${kind}.count must be a non-negative integer`);
      if (!entry.runId || typeof entry.runId !== 'string') problems.push(`artifacts.${kind}.runId is missing`);
      if (spec.maxAgeHours == null) {
        if (entry.generatedAt != null && !validIso(entry.generatedAt)) problems.push(`artifacts.${kind}.generatedAt is invalid`);
      } else if (!validIso(entry.generatedAt)) problems.push(`artifacts.${kind}.generatedAt is missing or invalid`);
      if (entry.maxAgeHours !== spec.maxAgeHours) problems.push(`artifacts.${kind}.maxAgeHours must be ${spec.maxAgeHours}`);
      const expectedExpiry = expiresAt(entry.generatedAt, spec.maxAgeHours);
      if (entry.expiresAt !== expectedExpiry) problems.push(`artifacts.${kind}.expiresAt does not match generatedAt + maxAgeHours`);
      if (!entry.provenance || typeof entry.provenance !== 'string') problems.push(`artifacts.${kind}.provenance is missing`);
      if (spec.maxAgeHours != null || entry.sourceHealth) {
        problems.push(...sourceHealthProblems(entry.sourceHealth, entry.runId, `artifacts.${kind}.sourceHealth`));
      }
    }
  }
  const eventEntry = manifest.artifacts?.events;
  if (eventEntry) {
    if (manifest.runId !== eventEntry.runId) problems.push('manifest runId must match artifacts.events.runId');
    if (manifest.generatedAt !== eventEntry.generatedAt) problems.push('manifest generatedAt must match artifacts.events.generatedAt');
    if (manifest.expiresAt !== eventEntry.expiresAt) problems.push('manifest expiresAt must match artifacts.events.expiresAt');
    if (manifest.maxAgeHours !== eventEntry.maxAgeHours) problems.push('manifest maxAgeHours must match artifacts.events.maxAgeHours');
    if (stableStringify(manifest.sourceHealth) !== stableStringify(eventEntry.sourceHealth)) problems.push('manifest sourceHealth must match artifacts.events.sourceHealth');
  }
  const images = manifest.placeImages;
  if (!images || images.dir !== 'place-img') problems.push("manifest placeImages.dir must be 'place-img'");
  else {
    if (!validDigest(images.sha256)) problems.push('placeImages.sha256 is missing or malformed');
    if (!validCount(images.bytes)) problems.push('placeImages.bytes must be a non-negative integer');
    if (!validCount(images.count)) problems.push('placeImages.count must be a non-negative integer');
  }
  return problems;
}

export function verifyArtifactSet({
  root,
  expectedCityId,
  expectedTimeZone,
  now = Date.now(),
  requireFresh = false,
  requireVerifiedSources = false,
} = {}) {
  const problems = [];
  const path = join(root, MANIFEST_FILE);
  if (!existsSync(path)) return { ok: false, problems: [`missing ${MANIFEST_FILE}`], manifest: null };
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    return { ok: false, problems: [`${MANIFEST_FILE} is not valid JSON (${error.message})`], manifest: null };
  }
  problems.push(...manifestShapeProblems(manifest, expectedCityId, expectedTimeZone));
  if (!problems.length && calculateBuildId(manifest) !== manifest.buildId) problems.push('manifest buildId does not match its contents');
  if (!problems.length && calculateManifestId(manifest) !== manifest.manifestId) problems.push('manifest manifestId does not match its contents');

  const futureLimit = now + MAX_CLOCK_SKEW_MS;
  const assembledMs = validIso(manifest.assembledAt) ? Date.parse(manifest.assembledAt) : null;
  const timestampRows = [
    ['manifest generatedAt', manifest.generatedAt],
    ['manifest assembledAt', manifest.assembledAt],
    ['event sourceHealth.checkedAt', manifest.sourceHealth?.checkedAt],
  ];
  for (const [kind] of Object.entries(ARTIFACT_SPECS)) {
    const entry = manifest.artifacts?.[kind];
    if (entry?.generatedAt) timestampRows.push([`${kind} generatedAt`, entry.generatedAt]);
    if (entry?.sourceHealth?.checkedAt) timestampRows.push([`${kind} sourceHealth.checkedAt`, entry.sourceHealth.checkedAt]);
    if (assembledMs != null && validIso(entry?.generatedAt) && Date.parse(entry.generatedAt) > assembledMs + MAX_CLOCK_SKEW_MS) {
      problems.push(`${kind} generatedAt is later than manifest assembledAt`);
    }
  }
  for (const [label, value] of timestampRows) {
    if (validIso(value) && Date.parse(value) > futureLimit) problems.push(`${label} is implausibly in the future`);
  }

  for (const [kind, spec] of Object.entries(ARTIFACT_SPECS)) {
    try {
      const actual = readJsonArtifact(root, spec);
      const expected = manifest.artifacts?.[kind];
      if (!expected) continue;
      for (const field of ['sha256', 'bytes', 'count']) {
        if (actual[field] !== expected[field]) problems.push(`${spec.file} ${field} does not match manifest`);
      }
    } catch (error) {
      problems.push(`${spec.file} could not be verified (${error.message})`);
    }
  }
  try {
    const actualImages = readImageDirectory(root);
    for (const field of ['sha256', 'bytes', 'count']) {
      if (actualImages[field] !== manifest.placeImages?.[field]) problems.push(`place-img/ ${field} does not match manifest`);
    }
  } catch (error) {
    problems.push(`place-img/ could not be verified (${error.message})`);
  }
  try {
    problems.push(...localImageReferenceProblems(root));
  } catch (error) {
    problems.push(`local image references could not be verified (${error.message})`);
  }

  for (const [kind, spec] of Object.entries(ARTIFACT_SPECS)) {
    if (spec.maxAgeHours == null) continue;
    const entry = manifest.artifacts?.[kind];
    if (requireFresh && (!validIso(entry?.expiresAt) || Date.parse(entry.expiresAt) <= now)) problems.push(`${kind} artifact is past its manifest max age`);
    if (requireVerifiedSources && entry?.sourceHealth?.status !== 'healthy') problems.push(`${kind} source health is not fully verified and healthy`);
  }
  return { ok: problems.length === 0, problems, manifest };
}
