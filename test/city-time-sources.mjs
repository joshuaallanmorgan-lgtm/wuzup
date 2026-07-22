import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sourceTime from '../finder/sources/_shared.mjs'

const NY = 'America/New_York'
const DST_NOW_MS = Date.parse('2026-03-08T05:30:00Z')
const YEAR_END_NOW_MS = Date.parse('2026-12-31T05:30:00Z')

function fixtureText(name) {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/city-time/sources/${name}`, import.meta.url)),
    'utf8',
  )
}

function fixtureJson(name) {
  return JSON.parse(fixtureText(name))
}

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => structuredClone(value) }
}

function textResponse(value) {
  return { ok: true, status: 200, text: async () => value }
}

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
  assert.match(source, /scrapeRenderSourcesWithReceipt\(\{[^}]*nowMs:\s*runEpoch,[^}]*force:\s*requireLiveSources,[^}]*requireLive:\s*requireLiveSources/s)
  assert.match(source, /loadEventSources\(\{[^}]*moduleIds:\s*eventSourceModules,[^}]*nowMs:\s*runEpoch,[^}]*requireLive:\s*requireLiveSources/s)
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

test('Do813 uses the injected Tampa calendar window at both inclusive boundaries', async () => {
  const { fetchEvents } = await import('../finder/sources/tampa-bay/do813.mjs')
  const fixture = fixtureJson('do813.json')
  const urls = []
  const events = await fetchEvents({
    nowMs: DST_NOW_MS,
    fetchImpl: async (url) => {
      urls.push(String(url))
      return jsonResponse(fixture)
    },
  })

  assert.deepEqual(urls, ['https://do813.com/events.json?page=1'])
  assert.deepEqual(events.map(({ title, start }) => ({ title, start })), [
    { title: 'Today boundary', start: '2026-03-08T03:30:00' },
    { title: 'Last-day boundary', start: '2026-04-22T19:00:00' },
  ])
})

test("Don't Tell Comedy resolves yearless dates from one injected Tampa day", async () => {
  const { fetchEvents } = await import('../finder/sources/tampa-bay/donttellcomedy.mjs')
  const html = fixtureText('donttellcomedy.html')
  const urls = []
  const events = await fetchEvents({
    nowMs: YEAR_END_NOW_MS,
    fetchImpl: async (url) => {
      urls.push(String(url))
      return textResponse(html)
    },
  })

  assert.equal(urls.length, 2)
  assert.deepEqual(events.map(({ title, start }) => ({ title, start })), [
    { title: "Don't Tell Comedy — Ybor City", start: '2026-12-31T20:00:00' },
    { title: "Don't Tell Comedy — Downtown", start: '2027-01-01T19:30:00' },
  ])
})

test("Don't Tell Comedy validates a yearless leap day after rolling into the next year", async () => {
  const { fetchEvents } = await import('../finder/sources/tampa-bay/donttellcomedy.mjs')
  const html = fixtureText('donttellcomedy.html')
  const events = await fetchEvents({
    nowMs: Date.parse('2027-12-31T05:30:00Z'),
    fetchImpl: async () => textResponse(html),
  })

  assert.deepEqual(
    events.filter(({ url }) => url.endsWith('/leap-day/')).map(({ start }) => start),
    ['2028-02-29T20:30:00'],
  )
})

test('Hillsborough Libraries requests the city day and filters with city calendar semantics', async () => {
  const { fetchEvents } = await import('../finder/sources/tampa-bay/hcplc.mjs')
  const fixture = fixtureJson('hcplc.json')
  let requestedUrl = null
  const events = await fetchEvents({
    nowMs: DST_NOW_MS,
    fetchImpl: async (url) => {
      requestedUrl = String(url)
      return jsonResponse(fixture)
    },
  })

  const parsed = new URL(requestedUrl)
  const req = JSON.parse(parsed.searchParams.get('req'))
  assert.equal(req.date, '2026-03-08')
  assert.equal(req.days, 30)
  assert.deepEqual(events.map(({ title, start, end }) => ({ title, start, end })), [
    { title: 'Today library event', start: '2026-03-08T03:30:00', end: '2026-03-08T04:30:00' },
    { title: 'Last-day exhibit', start: '2026-04-22', end: '2026-04-23' },
  ])
})

test('Pinellas requests the city day, preserves paging, and includes the last city day', async () => {
  const { fetchEvents } = await import('../finder/sources/tampa-bay/pinellas.mjs')
  const pages = fixtureJson('pinellas.json')
  const urls = []
  const events = await fetchEvents({
    nowMs: DST_NOW_MS,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url))
      urls.push(parsed)
      return jsonResponse(pages[Number(parsed.searchParams.get('page')) - 1])
    },
  })

  assert.equal(urls.length, 2)
  assert.equal(urls[0].searchParams.get('start_date'), '2026-03-08')
  assert.equal(urls[1].origin + urls[1].pathname, 'https://pinellas.gov/wp-json/tribe/events/v1/events')
  assert.equal(urls[1].searchParams.get('page'), '2')
  assert.deepEqual(events.map(({ title, start }) => ({ title, start })), [
    { title: 'Today county event', start: '2026-03-08T03:30:00' },
    { title: 'Last-day county event', start: '2026-04-22T19:00:00' },
  ])
})

test('Tampa HTTP adapter output is byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/tampa-source-probe.mjs', import.meta.url))
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

test('DoTheBay consumes the injected SF day while preserving corridor and base contracts', async () => {
  const { fetchEvents } = await import('../finder/sources/sf-east-bay/dothebay.mjs')
  const urls = []
  const events = await fetchEvents({
    nowMs: Date.parse('2026-03-08T08:30:00Z'),
    fetchImpl: async (url) => {
      urls.push(String(url))
      return jsonResponse(fixtureJson('dothebay.json'))
    },
    waitImpl: async () => {},
  })

  assert.deepEqual(urls, ['https://dothebay.com/events.json?page=1'])
  assert.deepEqual(events.map(({ title, start }) => ({ title, start })), [
    { title: 'Today SF boundary', start: '2026-03-08T03:30:00' },
    { title: 'Last SF boundary', start: '2026-04-22T19:00:00' },
  ])
})

test('DoTheBay fixture output is byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/dothebay-source-probe.mjs', import.meta.url))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })
  assert.ok(outputs[0])
  assert.equal(JSON.parse(outputs[0]).length, 2)
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})
