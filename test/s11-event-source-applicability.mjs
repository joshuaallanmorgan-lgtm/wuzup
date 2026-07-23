import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as sfEastBay from '../finder/cities/sf-east-bay.mjs'
import * as tampaBay from '../finder/cities/tampa-bay.mjs'
import { loadEventSources, normalizeEventSourceModules } from '../finder/event-source-contract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const quiet = { log: () => {}, warn: () => {} }

function scratch(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'wuzup-event-sources-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceDir = path.join(root, 'sources')
  const cacheDir = path.join(root, 'cache')
  mkdirSync(sourceDir)
  mkdirSync(cacheDir)
  return { sourceDir, cacheDir }
}

test('city configs activate every proven event adapter and preserve only Do813 as dormant', () => {
  const tampa = normalizeEventSourceModules(tampaBay.eventSourceModules, 'Tampa event sources')
  const sf = normalizeEventSourceModules(sfEastBay.eventSourceModules, 'SF event sources')
  assert.deepEqual(tampa, [
    'allevents',
    'donttellcomedy',
    'hcplc',
    'meetup',
    'pinellas',
    'stpete',
    'tampagov',
    'trumba-ut',
    'visittampabay',
    'vspc',
    'wmnf',
  ])
  assert.deepEqual(sf, ['dothebay', 'meetup', 'sfrecparks', 'ucberkeley', 'visitoakland'])

  const discovered = (cityId) => readdirSync(path.join(ROOT, 'finder', 'sources', cityId))
    .filter((file) => file.endsWith('.mjs') && !file.startsWith('_'))
    .map((file) => file.replace(/\.mjs$/, ''))
    .sort()
  assert.deepEqual(discovered('tampa-bay').filter((id) => !tampa.includes(id)), ['do813'])
  assert.deepEqual(discovered('sf-east-bay').filter((id) => !sf.includes(id)), [])
})

test('event module rosters reject empty, unsafe, and duplicate identifiers', () => {
  assert.throws(() => normalizeEventSourceModules(undefined), /non-empty array/)
  assert.throws(() => normalizeEventSourceModules([]), /non-empty array/)
  for (const unsafe of ['../meetup', 'meetup.mjs', 'Meetup', '', '_helper']) {
    assert.throws(() => normalizeEventSourceModules([unsafe]), /unsafe module ID/)
  }
  assert.throws(() => normalizeEventSourceModules(['meetup', 'meetup']), /duplicate module ID/)
})

test('inactive event adapters are not imported, reported, or cached', async (t) => {
  const { sourceDir, cacheDir } = scratch(t)
  writeFileSync(path.join(sourceDir, 'active.mjs'), [
    "export const name = 'Active source'",
    "export async function fetchEvents() { return [{ title: 'Live', start: '2026-07-22' }] }",
  ].join('\n'))
  writeFileSync(path.join(sourceDir, 'inactive.mjs'), "throw new Error('inactive adapter imported')\n")
  const inactiveCache = path.join(cacheDir, 'inactive.json')
  writeFileSync(inactiveCache, JSON.stringify([{ title: 'Dormant', start: '2026-07-22' }]))

  const result = await loadEventSources({
    moduleIds: ['active'],
    sourceDir,
    cacheDir,
    nowMs: Date.parse('2026-07-22T12:00:00.000Z'),
    requireLive: true,
    logger: quiet,
  })
  assert.deepEqual(result.events, [{ title: 'Live', start: '2026-07-22' }])
  assert.deepEqual(result.report, [{ source: 'Active source', found: 1, ok: true, status: 'healthy' }])
  assert.deepEqual(JSON.parse(readFileSync(inactiveCache, 'utf8')), [{ title: 'Dormant', start: '2026-07-22' }])
})

test('a missing configured event adapter fails and cannot hide behind cache', async (t) => {
  const { sourceDir, cacheDir } = scratch(t)
  const cacheFile = path.join(cacheDir, 'missing.json')
  writeFileSync(cacheFile, JSON.stringify([{ title: 'Untrusted cache', start: '2026-07-22' }]))
  const result = await loadEventSources({
    moduleIds: ['missing'],
    sourceDir,
    cacheDir,
    nowMs: Date.parse('2026-07-22T12:00:00.000Z'),
    logger: quiet,
  })
  assert.deepEqual(result.events, [])
  assert.equal(result.report.length, 1)
  assert.equal(result.report[0].source, 'missing')
  assert.equal(result.report[0].ok, false)
  assert.match(result.report[0].error, /cannot find module/i)
  assert.deepEqual(JSON.parse(readFileSync(cacheFile, 'utf8')), [{ title: 'Untrusted cache', start: '2026-07-22' }])
})
