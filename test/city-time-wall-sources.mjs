import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { sourceWallTime } from '../finder/sources/_shared.mjs'
import { fetchEvents as fetchTampa } from '../finder/sources/tampa-bay/visittampabay.mjs'
import { fetchEvents as fetchOakland } from '../finder/sources/sf-east-bay/visitoakland.mjs'
import { fetchEvents as fetchRecParks } from '../finder/sources/sf-east-bay/sfrecparks.mjs'

const TAMPA_NOW = Date.parse('2026-03-08T05:30:00Z')
const SF_NOW = Date.parse('2026-03-08T08:30:00Z')

const fixture = (name, encoding = 'utf8') => readFileSync(
  new URL(`./fixtures/city-time/sources/${name}`, import.meta.url),
  encoding,
)

function simpleviewFetch(docs, calls = []) {
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(String(url))
      if (String(url).includes('get_simple_token')) {
        return { ok: true, text: async () => 'fixture-token' }
      }
      return {
        ok: true,
        json: async () => ({ docs: { docs, count: docs.length } }),
      }
    },
  }
}

function requestRange(url) {
  const parsed = new URL(url)
  return JSON.parse(parsed.searchParams.get('json')).filter.date_range
}

test('shared source wall clocks use the offset at the exact local time', () => {
  assert.equal(sourceWallTime('America/New_York', '2026-03-08', '01:30:00'), '2026-03-08T01:30:00-05:00')
  assert.equal(sourceWallTime('America/New_York', '2026-03-08', '03:30:00'), '2026-03-08T03:30:00-04:00')
  assert.equal(sourceWallTime('America/New_York', '2026-03-08', '02:30:00'), null)
  assert.equal(sourceWallTime('America/Los_Angeles', '2026-11-01', '01:30:00'), '2026-11-01T01:30:00-07:00')
  assert.equal(
    sourceWallTime('America/Los_Angeles', '2026-11-01', '01:30:00', { disambiguation: 'later' }),
    '2026-11-01T01:30:00-08:00',
  )
  assert.equal(sourceWallTime('America/New_York', '2026-02-30', '12:00:00'), null)
  assert.equal(sourceWallTime('America/New_York', '2026-03-08', '25:00:00'), null)
})

test('Visit Tampa Bay uses one injected inclusive city window and rejects the spring gap', async () => {
  const docs = JSON.parse(fixture('visittampabay.json'))
  const transport = simpleviewFetch(docs)
  const events = await fetchTampa({ nowMs: TAMPA_NOW, fetchImpl: transport.fetchImpl })

  assert.deepEqual(events.map(({ title, start, end }) => ({ title, start, end })), [
    { title: 'Tampa before the jump', start: '2026-03-08T01:30:00-05:00', end: '2026-03-08T03:30:00-04:00' },
    { title: 'Tampa after the jump', start: '2026-03-08T03:30:00-04:00', end: null },
    { title: 'Tampa last day', start: '2026-04-22', end: null },
  ])
  assert.equal(transport.calls.length, 2)
  assert.deepEqual(requestRange(transport.calls[1]), {
    start: { $date: '2026-03-08T05:00:00.000Z' },
    end: { $date: '2026-04-22T04:00:00.000Z' },
  })
})

test('Visit Oakland uses one injected inclusive city window and rejects the spring gap', async () => {
  const docs = JSON.parse(fixture('visitoakland.json'))
  const transport = simpleviewFetch(docs)
  const events = await fetchOakland({ nowMs: SF_NOW, fetchImpl: transport.fetchImpl })

  assert.deepEqual(events.map(({ title, start, end }) => ({ title, start, end })), [
    { title: 'Oakland before the jump', start: '2026-03-08T01:30:00-08:00', end: '2026-03-08T03:30:00-07:00' },
    { title: 'Oakland after the jump', start: '2026-03-08T03:30:00-07:00', end: null },
    { title: 'Oakland last day', start: '2026-04-22', end: null },
  ])
  assert.equal(transport.calls.length, 2)
  assert.deepEqual(requestRange(transport.calls[1]), {
    start: { $date: '2026-03-08T08:00:00.000Z' },
    end: { $date: '2026-04-22T07:00:00.000Z' },
  })
})

test('SF Rec & Parks validates city dates and resolves clocks across the DST jump', async () => {
  const xml = fixture('sfrecparks.xml')
  const calls = []
  const events = await fetchRecParks({
    nowMs: SF_NOW,
    fetchImpl: async (url) => {
      calls.push(String(url))
      return { ok: true, text: async () => xml }
    },
  })

  assert.deepEqual(events.map(({ title, start, end }) => ({ title, start, end })), [
    { title: 'SF before the jump', start: '2026-03-08T01:30:00-08:00', end: '2026-03-08T03:30:00-07:00' },
    { title: 'SF last day', start: '2026-04-22', end: null },
  ])
  assert.equal(calls.length, 1)
})

test('wall-time source fixtures are nonempty and byte-identical across worker timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/wall-source-probe.mjs', import.meta.url))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })

  const parsed = JSON.parse(outputs[0])
  assert.equal(parsed.tampa.length, 3)
  assert.equal(parsed.oakland.length, 3)
  assert.equal(parsed.recParks.length, 2)
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})

test('wall-time sources cannot consult host-local calendar state', () => {
  for (const file of [
    '../finder/sources/tampa-bay/visittampabay.mjs',
    '../finder/sources/sf-east-bay/visitoakland.mjs',
    '../finder/sources/sf-east-bay/sfrecparks.mjs',
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /new Date\s*\(\s*\)/)
    assert.doesNotMatch(source, /\.(?:getFullYear|getMonth|getDate|getDay|getHours|setDate)\s*\(/)
    assert.doesNotMatch(source, /new Intl\.DateTimeFormat/)
  }
})
