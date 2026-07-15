import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sourceTime from '../finder/sources/_shared.mjs'

const NY = 'America/New_York'

test('source window requires one finite injected epoch and uses calendar-day arithmetic', () => {
  const nowMs = Date.parse('2026-03-08T06:30:00Z')
  assert.equal(typeof sourceTime.sourceWindow, 'function')
  assert.deepEqual(sourceTime.sourceWindow(NY, nowMs, 2), {
    today: '2026-03-08',
    lastDay: '2026-03-10',
  })
  assert.deepEqual(sourceTime.sourceWindow(NY, nowMs, 0), {
    today: '2026-03-08',
    lastDay: '2026-03-08',
  })
  assert.throws(
    () => sourceTime.sourceWindow(NY, undefined, 2),
    /nowMs must be finite/i,
  )
  assert.throws(
    () => sourceTime.sourceWindow(NY, Number.NaN, 2),
    /nowMs must be finite/i,
  )
})

test('source window rejects invalid lookahead values', () => {
  const nowMs = Date.parse('2026-07-15T05:30:00Z')
  for (const daysAhead of [-1, 1.5, Number.NaN, Infinity, undefined]) {
    assert.throws(
      () => sourceTime.sourceWindow(NY, nowMs, daysAhead),
      /daysAhead must be a non-negative integer/i,
    )
  }
})

test('source start day canonicalizes offset and zoneless values in the city zone', () => {
  assert.equal(typeof sourceTime.sourceStartDay, 'function')
  assert.equal(
    sourceTime.sourceStartDay(NY, '2026-07-15T01:00:00+02:00'),
    '2026-07-14',
  )
  assert.equal(
    sourceTime.sourceStartDay(NY, '2026-07-15T23:30:00'),
    '2026-07-15',
  )
  assert.equal(sourceTime.sourceStartDay(NY, '2026-07-15'), '2026-07-15')
})

test('source start day fails closed for malformed or unrepresentable values', () => {
  assert.equal(sourceTime.sourceStartDay(NY, 'July 15, 2026 7:00 PM'), null)
  assert.equal(sourceTime.sourceStartDay(NY, '2026-02-30T19:00:00'), null)
  assert.equal(sourceTime.sourceStartDay(NY, '2026-03-08T02:30:00'), null)
  assert.equal(sourceTime.sourceStartDay(NY, ''), null)
  assert.equal(sourceTime.sourceStartDay(NY, null), null)
})

test('finder propagates its single run epoch to render and module adapters', () => {
  const finderPath = fileURLToPath(new URL('../finder/finder.mjs', import.meta.url))
  const source = readFileSync(finderPath, 'utf8')
  assert.match(source, /scrapeRenderSources\(\{\s*nowMs:\s*runEpoch\s*\}\)/)
  assert.match(source, /mod\.fetchEvents\(\{\s*nowMs:\s*runEpoch\s*\}\)/)
})

test('legacy base-url adapters accept clock options without corrupting their URL', async () => {
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const urls = []
  console.warn = () => {}
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    return {
      ok: true,
      json: async () => ({ events: [], paging: { total_pages: 1 } }),
    }
  }
  try {
    const do813 = await import('../finder/sources/tampa-bay/do813.mjs')
    const dothebay = await import('../finder/sources/sf-east-bay/dothebay.mjs')
    const nowMs = Date.parse('2026-07-15T05:30:00Z')
    await do813.fetchEvents({ nowMs })
    await dothebay.fetchEvents({ nowMs })
  } finally {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
  }
  assert.deepEqual(urls, [
    'https://do813.com/events.json?page=1',
    'https://dothebay.com/events.json?page=1',
  ])
})

test('source clock output is byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/source-probe.mjs', import.meta.url))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })
  assert.ok(outputs[0])
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})
