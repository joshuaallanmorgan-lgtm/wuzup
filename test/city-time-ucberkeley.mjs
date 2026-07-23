import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { fetchEvents } from '../finder/sources/sf-east-bay/ucberkeley.mjs'

const NOW_MS = Date.parse('2026-03-08T08:30:00Z')
const fixture = readFileSync(
  new URL('./fixtures/city-time/sources/ucberkeley.xml', import.meta.url),
  'utf8',
)
const textResponse = (value) => ({ ok: true, status: 200, text: async () => value })
const titleTimes = (events) => events
  .map(({ title, start, end }) => ({ title, start, end }))
  .sort((a, b) => a.title.localeCompare(b.title))

test('UC Berkeley uses one injected request and an inclusive San Francisco city-day window', async () => {
  const requests = []
  const events = await fetchEvents({
    nowMs: NOW_MS,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), userAgent: options.headers['user-agent'] })
      return textResponse(fixture)
    },
  })

  assert.deepEqual(requests, [{
    url: 'https://events.berkeley.edu/live/rss/events',
    userAgent: 'wuzup-events-finder/0.1',
  }])
  assert.deepEqual(titleTimes(events), [
    { title: 'After spring jump', start: '2026-03-08T03:30:00-07:00', end: null },
    { title: 'First boundary', start: '2026-03-08T00:00:00-08:00', end: '2026-03-08T01:00:00-08:00' },
    { title: 'Last boundary', start: '2026-04-22T23:59:00-07:00', end: null },
  ])
})

test('UC Berkeley rejects a non-finite run epoch before requesting the feed', async () => {
  let requested = false
  await assert.rejects(
    fetchEvents({
      nowMs: Number.NaN,
      fetchImpl: async () => {
        requested = true
        return textResponse(fixture)
      },
    }),
    /nowMs must be finite/i,
  )
  assert.equal(requested, false)
})

test('UC Berkeley fixture output is nonempty and byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/ucberkeley-probe.mjs', import.meta.url))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, CITY: 'sf-east-bay', TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })

  assert.equal(JSON.parse(outputs[0]).length, 3)
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})

test('UC Berkeley product time cannot fall back to the host clock', () => {
  const source = readFileSync(
    new URL('../finder/sources/sf-east-bay/ucberkeley.mjs', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /new Date\s*\(\s*\)/)
  assert.doesNotMatch(source, /dayInTz\(CITY_TZ\s*\)/)
  assert.equal((source.match(/Date\.now\(\)/g) || []).length, 1)
  assert.match(source, /sourceWindow\(CITY_TZ, nowMs, WINDOW_DAYS\)/)
  assert.match(source, /sourceStartDay\(CITY_TZ, startInstant\.toISOString\(\)\)/)
  assert.match(source, /fetchWithTimeout\([^]*fetchImpl,\s*\)/)
})
