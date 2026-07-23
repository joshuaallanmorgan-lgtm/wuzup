import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { summarizeSourceHealth, writeManifest } from '../finder/artifact-manifest.mjs'
import {
  archiveCitySignals,
  readSignalArchiveIndex,
  readSignalArchiveSnapshot,
  SIGNAL_ARCHIVE_POLICY,
} from '../finder/archive-signals.mjs'

const BASE_TIME = Date.parse('2026-07-20T12:00:00.000Z')
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

function fixture(repoRoot, { cityId = 'tampa-bay', timeZone = 'America/New_York', generation = 0 } = {}) {
  const generatedAt = new Date(BASE_TIME + generation * 60_000).toISOString()
  const cityRoot = join(repoRoot, 'finder', 'cities')
  const outputRoot = join(repoRoot, 'finder', 'output', cityId)
  mkdirSync(cityRoot, { recursive: true })
  mkdirSync(join(outputRoot, 'place-img'), { recursive: true })
  writeFileSync(join(cityRoot, `${cityId}.mjs`), `export const tz = ${JSON.stringify(timeZone)}\n`)
  writeJson(join(outputRoot, 'events.json'), [{
    id: `${cityId}:event:${generation}`, title: `Fixture ${generation}`, start: '2026-07-21T19:00:00-04:00',
    source: 'Fixture', sourceFamily: 'Fixture family', sourceFamilies: ['Fixture family'],
    organizer: 'Fixture organizer', status: 'scheduled', rawCategories: ['music'],
    description: 'This must not enter history', image: 'https://images.example.test/private.jpg',
    address: '123 Private Street', actionability: true, canonicalId: `${cityId}:event:${generation}`,
    url: 'https://events.example.test/fixture-event',
  }])
  writeJson(join(outputRoot, 'places.json'), { schemaVersion: 1, places: [] })
  writeJson(join(outputRoot, 'guides.json'), { schemaVersion: 1, guides: [] })
  const health = (kind) => summarizeSourceHealth([{ source: `Fixture ${kind}`, found: 1, ok: true }], {
    runId: `${kind}-${cityId}-${generation}`, checkedAt: generatedAt,
  })
  const manifest = writeManifest({
    root: outputRoot, cityId, timeZone, assembledAt: generatedAt,
    componentReceipts: {
      events: { generatedAt, runId: `events-${cityId}-${generation}`, provenance: 'fixture', sourceHealth: health('events') },
      places: { generatedAt, runId: `places-${cityId}-${generation}`, provenance: 'fixture', sourceHealth: health('places') },
    },
  })
  return { cityId, timeZone, outputRoot, manifest }
}

async function withRepo(fn) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'wuzup-signal-archive-'))
  try { return await fn(repoRoot) } finally { rmSync(repoRoot, { recursive: true, force: true }) }
}

test('stores one canonical plain signal-only latest plus a small current index', async () => withRepo(async (repoRoot) => {
  const set = fixture(repoRoot)
  const archived = await archiveCitySignals({ repoRoot, cityId: set.cityId })
  assert.deepEqual(readdirSync(archived.historyRoot).sort(), ['index.json', 'latest.json'])
  const latestPath = join(archived.historyRoot, 'latest.json')
  const bytes = readFileSync(latestPath, 'utf8')
  assert.equal(bytes.startsWith('{\n'), true)
  assert.doesNotMatch(bytes, /images\.example\.test|private\.jpg|Private Street|must not enter/)
  const stored = readSignalArchiveSnapshot(latestPath)
  const index = readSignalArchiveIndex(archived.historyRoot, { cityId: set.cityId, timeZone: set.timeZone })
  assert.equal(index.latest.contentSha256, stored.contentSha256)
  assert.equal(index.latest.byteLength, statSync(latestPath).size)
  assert.equal(index.latest.buildId, set.manifest.buildId)
}))

test('25 generations remain bounded to two files and the configured byte budget', async () => withRepo(async (repoRoot) => {
  let archived
  for (let generation = 0; generation < 25; generation += 1) {
    const set = fixture(repoRoot, { generation })
    archived = await archiveCitySignals({ repoRoot, cityId: set.cityId })
    assert.equal(archived.replaced, generation > 0)
    assert.equal(archived.comparison?.state || null, generation > 0 ? 'available' : null)
  }
  const files = readdirSync(archived.historyRoot)
  assert.deepEqual(files.sort(), ['index.json', 'latest.json'])
  const total = files.reduce((sum, file) => sum + statSync(join(archived.historyRoot, file)).size, 0)
  assert.ok(total <= SIGNAL_ARCHIVE_POLICY.maxSnapshotBytes + SIGNAL_ARCHIVE_POLICY.maxIndexBytes)
  assert.equal(archived.snapshot.events[0].id, 'tampa-bay:event:24')
}))

test('identical bytes are idempotent and corrupt current identity fails closed', async () => withRepo(async (repoRoot) => {
  const set = fixture(repoRoot)
  const first = await archiveCitySignals({ repoRoot, cityId: set.cityId })
  const before = readFileSync(join(first.historyRoot, 'latest.json'))
  assert.equal((await archiveCitySignals({ repoRoot, cityId: set.cityId })).created, false)
  assert.deepEqual(readFileSync(join(first.historyRoot, 'latest.json')), before)
  const indexPath = join(first.historyRoot, 'index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  index.latest.byteLength += 1
  writeJson(indexPath, index)
  await assert.rejects(archiveCitySignals({ repoRoot, cityId: set.cityId }), /index\/latest snapshot identity or byte length mismatch/)
}))

test('refuses an oversized snapshot before creating repository history', async () => withRepo(async (repoRoot) => {
  const set = fixture(repoRoot)
  await assert.rejects(
    archiveCitySignals({ repoRoot, cityId: set.cityId, policy: { ...SIGNAL_ARCHIVE_POLICY, maxSnapshotBytes: 100 } }),
    /snapshot exceeds 100 bytes/,
  )
  assert.equal(readdirSync(join(repoRoot, 'finder')).includes('history'), false)
}))

test('history is restricted to two flagship cities and owned files', async () => withRepo(async (repoRoot) => {
  const tampa = fixture(repoRoot)
  const sf = fixture(repoRoot, { cityId: 'sf-east-bay', timeZone: 'America/Los_Angeles' })
  await archiveCitySignals({ repoRoot, cityId: tampa.cityId })
  await archiveCitySignals({ repoRoot, cityId: sf.cityId })
  const historyRoot = join(repoRoot, 'finder', 'history')
  assert.deepEqual(readdirSync(historyRoot).sort(), ['sf-east-bay', 'tampa-bay'])
  const third = fixture(repoRoot, { cityId: 'miami', timeZone: 'America/New_York' })
  await assert.rejects(archiveCitySignals({ repoRoot, cityId: third.cityId }), /not in the repository-history allowlist/)
  writeFileSync(join(historyRoot, 'tampa-bay', 'notes.txt'), 'not owned\n')
  await assert.rejects(archiveCitySignals({ repoRoot, cityId: tampa.cityId }), /exceeds the 2-file policy|unexpected non-owned history file/)
}))

test('refuses sealed-artifact byte tampering', async () => withRepo(async (repoRoot) => {
  const set = fixture(repoRoot)
  writeFileSync(join(set.outputRoot, 'events.json'), '[]\n')
  await assert.rejects(archiveCitySignals({ repoRoot, cityId: set.cityId }), /artifact verification failed/)
}))
