import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as sfEastBay from '../finder/cities/sf-east-bay.mjs'
import * as tampaBay from '../finder/cities/tampa-bay.mjs'
import { normalizePlaceSourceModules } from '../finder/place-source-contract.mjs'
import { loadSources } from '../finder/places.mjs'
import { fetchOsmClass } from '../finder/places-sources/osm.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = path.join(ROOT, 'finder', 'places-sources')

function scratchSources(t, prefix) {
  const base = mkdtempSync(path.join(tmpdir(), prefix))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const sourceDir = path.join(base, 'sources')
  const cacheDir = path.join(base, 'cache')
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  return { sourceDir, cacheDir }
}

function cache(cacheDir, moduleId, places) {
  writeFileSync(path.join(cacheDir, `places-${moduleId}.json`), JSON.stringify({
    fetchedAt: '2026-07-20T12:00:00.000Z',
    source: `${moduleId} cache`,
    places,
  }))
}

const quiet = { log: () => {}, warn: () => {} }

test('city configs partition every place adapter and share only OSM', () => {
  const tampa = normalizePlaceSourceModules(tampaBay.placeSourceModules, 'Tampa place sources')
  const sf = normalizePlaceSourceModules(sfEastBay.placeSourceModules, 'SF place sources')
  assert.deepEqual(tampa, [
    'fdep',
    'fwc-ramps',
    'hillsborough-parks',
    'osm',
    'pinellas-parks',
    'swfwmd',
    'tampa-parks',
  ])
  assert.deepEqual(sf, ['ebrpd-parks', 'ggnra-seed', 'osm', 'sf-parks'])
  assert.deepEqual(tampa.filter((moduleId) => sf.includes(moduleId)), ['osm'])

  const discovered = readdirSync(SOURCE_DIR)
    .filter((file) => file.endsWith('.mjs') && !file.startsWith('_'))
    .map((file) => file.replace(/\.mjs$/, ''))
    .sort()
  assert.deepEqual([...new Set([...tampa, ...sf])].sort(), discovered)
})

test('place module lists reject empty, unsafe, and duplicate identifiers', () => {
  assert.throws(() => normalizePlaceSourceModules(undefined), /non-empty array/)
  assert.throws(() => normalizePlaceSourceModules([]), /non-empty array/)
  for (const unsafe of ['../osm', 'osm.mjs', 'OSM', '', '_helper']) {
    assert.throws(() => normalizePlaceSourceModules([unsafe]), /unsafe module ID/)
  }
  assert.throws(() => normalizePlaceSourceModules(['osm', 'osm']), /duplicate module ID/)
})

test('unconfigured adapters are never imported, cached, or reported', async (t) => {
  const { sourceDir, cacheDir } = scratchSources(t, 'wuzup-place-partition-')
  writeFileSync(path.join(sourceDir, 'local.mjs'), [
    "export const name = 'Local source'",
    "export async function fetchPlaces() { return [{ name: 'Local place' }] }",
  ].join('\n'))
  writeFileSync(path.join(sourceDir, 'foreign.mjs'), "throw new Error('foreign adapter imported')\n")
  cache(cacheDir, 'foreign', [{ name: 'Foreign cached place' }])

  const result = await loadSources({
    moduleIds: ['local'],
    sourceDir,
    cacheDir,
    forceLive: true,
    nowMs: Date.parse('2026-07-22T12:00:00.000Z'),
    logger: quiet,
  })
  assert.deepEqual(result.raws, [{ name: 'Local place' }])
  assert.deepEqual(result.report, [{ source: 'Local source', found: 1, ok: true }])
})

test('a missing or broken configured adapter cannot hide behind a fresh cache', async (t) => {
  const { sourceDir, cacheDir } = scratchSources(t, 'wuzup-place-missing-')
  cache(cacheDir, 'missing', [{ name: 'Untrusted cached place' }])
  const result = await loadSources({
    moduleIds: ['missing'],
    sourceDir,
    cacheDir,
    nowMs: Date.parse('2026-07-20T12:30:00.000Z'),
    logger: quiet,
  })
  assert.deepEqual(result.raws, [])
  assert.equal(result.report.length, 1)
  assert.equal(result.report[0].ok, false)
})

test('live empty and live errors preserve last-good rows as explicit degraded evidence', async (t) => {
  const { sourceDir, cacheDir } = scratchSources(t, 'wuzup-place-fallback-')
  writeFileSync(path.join(sourceDir, 'empty.mjs'), [
    "export const name = 'Empty live source'",
    'export async function fetchPlaces() { return [] }',
  ].join('\n'))
  writeFileSync(path.join(sourceDir, 'error.mjs'), [
    "export const name = 'Error live source'",
    "export async function fetchPlaces() { throw new Error('transport failed') }",
  ].join('\n'))
  cache(cacheDir, 'empty', [{ name: 'Last good empty-source row' }])
  cache(cacheDir, 'error', [{ name: 'Last good error-source row' }])

  const result = await loadSources({
    moduleIds: ['empty', 'error'],
    sourceDir,
    cacheDir,
    forceLive: true,
    nowMs: Date.parse('2026-07-22T12:00:00.000Z'),
    logger: quiet,
  })
  assert.deepEqual(result.raws.map((place) => place.name), [
    'Last good empty-source row',
    'Last good error-source row',
  ])
  assert.deepEqual(result.report.map(({ source, found, ok, cached, fallbackReason }) => ({
    source,
    found,
    ok,
    cached,
    fallbackReason,
  })), [
    {
      source: 'empty cache',
      found: 1,
      ok: false,
      cached: 'stale',
      fallbackReason: 'live-empty',
    },
    {
      source: 'error cache',
      found: 1,
      ok: false,
      cached: 'stale',
      fallbackReason: 'live-error',
    },
  ])
  assert.match(result.report[1].error, /transport failed/)
})

test('require-live OSM bypasses raw cache and refuses fallback endpoints', async (t) => {
  const { cacheDir } = scratchSources(t, 'wuzup-osm-live-')
  const cachePath = path.join(cacheDir, 'osm-fixture.json')
  writeFileSync(cachePath, JSON.stringify([{ id: 'cached' }]))
  const cls = { id: 'fixture', filter: 'nwr["leisure"="park"]' }
  const endpoints = []

  await assert.rejects(() => fetchOsmClass(cls, {
    cacheDir,
    forceLive: true,
    requireLive: true,
    queryImpl: async (endpoint) => {
      endpoints.push(endpoint)
      throw new Error('primary unavailable')
    },
    logger: quiet,
  }), /primary unavailable/)
  assert.equal(endpoints.length, 1)
  assert.deepEqual(JSON.parse(readFileSync(cachePath, 'utf8')), [{ id: 'cached' }])

  const live = await fetchOsmClass(cls, {
    cacheDir,
    forceLive: true,
    requireLive: true,
    queryImpl: async (endpoint) => {
      endpoints.push(endpoint)
      return { elements: [{ id: 'live' }] }
    },
    logger: quiet,
  })
  assert.deepEqual(live, { elements: [{ id: 'live' }], from: 'live' })
  assert.deepEqual(JSON.parse(readFileSync(cachePath, 'utf8')), [{ id: 'live' }])
})

test('require-live OSM cannot be weakened by a contradictory forceLive option', async (t) => {
  const { cacheDir } = scratchSources(t, 'wuzup-osm-require-live-')
  const cachePath = path.join(cacheDir, 'osm-fixture.json')
  writeFileSync(cachePath, JSON.stringify([{ id: 'cached' }]))
  const cls = { id: 'fixture', filter: 'nwr["leisure"="park"]' }
  let queryCalls = 0

  await assert.rejects(() => fetchOsmClass(cls, {
    cacheDir,
    forceLive: false,
    requireLive: true,
    queryImpl: async () => {
      queryCalls += 1
      throw new Error('primary unavailable')
    },
    logger: quiet,
  }), /primary unavailable/)
  assert.equal(queryCalls, 1)
  assert.deepEqual(JSON.parse(readFileSync(cachePath, 'utf8')), [{ id: 'cached' }])
})

test('require-live OSM rejects partial Overpass responses with a runtime remark', async (t) => {
  const { cacheDir } = scratchSources(t, 'wuzup-osm-partial-')
  const cls = { id: 'fixture', filter: 'nwr["leisure"="park"]' }

  await assert.rejects(() => fetchOsmClass(cls, {
    cacheDir,
    requireLive: true,
    queryImpl: async () => ({
      remark: 'runtime error: Query timed out',
      elements: [{ id: 'partial' }],
    }),
    logger: quiet,
  }), /primary response was partial: runtime error: Query timed out/)
  assert.equal(existsSync(path.join(cacheDir, 'osm-fixture.json')), false)
})

test('ordinary OSM mode retains the explicit stale fallback path', async (t) => {
  const { cacheDir } = scratchSources(t, 'wuzup-osm-fallback-')
  const cls = { id: 'fixture', filter: 'nwr["leisure"="park"]' }
  const endpoints = []
  const result = await fetchOsmClass(cls, {
    cacheDir,
    forceLive: true,
    requireLive: false,
    queryImpl: async (endpoint) => {
      endpoints.push(endpoint)
      if (endpoints.length === 1) throw new Error('primary unavailable')
      return { elements: [{ id: 'fallback' }] }
    },
    logger: quiet,
  })
  assert.equal(endpoints.length, 2)
  assert.deepEqual(result, {
    elements: [{ id: 'fallback' }],
    from: 'fallback (kumi, possibly stale)',
  })
})
