import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { fetchEvents } from '../finder/sources/tampa-bay/allevents.mjs'

const NOW_MS = Date.parse('2026-03-08T05:30:00Z')
const fixture = readFileSync(
  new URL('./fixtures/city-time/sources/allevents.html', import.meta.url),
  'utf8',
)
const response = () => ({
  ok: true,
  status: 200,
  text: async () => fixture,
})
const titleStarts = (events) => events
  .map(({ title, start, end }) => ({ title, start, end }))
  .sort((a, b) => a.title.localeCompare(b.title))

test('AllEvents uses one injected Tampa window and transport for every listing', async () => {
  const urls = []
  const events = await fetchEvents({
    nowMs: NOW_MS,
    fetchImpl: async (url) => {
      urls.push(String(url))
      return response()
    },
  })

  assert.deepEqual(urls, [
    'https://allevents.in/tampa',
    'https://allevents.in/tampa/free',
    'https://allevents.in/st-petersburg',
    'https://allevents.in/clearwater',
  ])
  assert.deepEqual(titleStarts(events), [
    { title: 'First boundary', start: '2026-03-08T00:00:00', end: '2026-03-08T01:00:00' },
    { title: 'Last boundary', start: '2026-04-22T23:59:00', end: null },
    { title: 'Lexical after Tampa last', start: '2026-04-23T01:00:00+02:00', end: null },
    { title: 'Lexical prior Tampa today', start: '2026-03-07T23:30:00-10:00', end: null },
    { title: 'UTC Tampa today', start: '2026-03-08T05:30:00Z', end: null },
    { title: 'Zoneless midwindow', start: '2026-03-20T19:00:00', end: null },
  ])
})

test('AllEvents rejects non-finite injected run epochs before fetching', async () => {
  let fetched = false
  await assert.rejects(
    fetchEvents({
      nowMs: Number.NaN,
      fetchImpl: async () => {
        fetched = true
        return response()
      },
    }),
    /nowMs must be finite/i,
  )
  assert.equal(fetched, false)
})

test('AllEvents fixture is nonempty and byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/allevents-source-probe.mjs', import.meta.url))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, CITY: 'tampa-bay', TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })

  assert.equal(JSON.parse(outputs[0]).length, 6)
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})

test('AllEvents source cannot fall back to host-local calendar math', () => {
  const source = readFileSync(new URL('../finder/sources/tampa-bay/allevents.mjs', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /new Date\s*\(\s*\)/)
  assert.doesNotMatch(source, /\.(?:getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|setDate)\s*\(/)
  assert.equal((source.match(/Date\.now\(\)/g) || []).length, 1)
  assert.match(source, /tz as CITY_TZ[^]*cities\/tampa-bay\.mjs/)
  assert.match(source, /sourceWindow\(CITY_TZ, nowMs, DAYS_AHEAD\)/)
  assert.match(source, /sourceStartDay\(CITY_TZ, item\.startDate\)/)
  assert.match(source, /fetchWithTimeout\([^]*fetchImpl\)/)
})
