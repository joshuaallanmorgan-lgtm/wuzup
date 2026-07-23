import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { fetchEvents } from '../finder/sources/sf-east-bay/meetup.mjs'

const NOW_MS = Date.parse('2026-03-08T08:30:00Z')
const fixtureText = () => readFileSync(
  new URL('./fixtures/city-time/sources/sf-meetup.html', import.meta.url),
  'utf8',
)
const textResponse = (value) => ({ ok: true, status: 200, text: async () => value })
const titleStarts = (events) => events
  .map(({ title, start, end }) => ({ title, start, end }))
  .sort((a, b) => a.title.localeCompare(b.title))

test('SF Meetup uses one injected city window across six deterministic paced pages', async () => {
  const html = fixtureText()
  const urls = []
  const waits = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('ambient fetch used') }

  try {
    const events = await fetchEvents({
      nowMs: NOW_MS,
      fetchImpl: async (url) => {
        urls.push(String(url))
        return textResponse(html)
      },
      waitImpl: async (ms) => waits.push(ms),
    })

    assert.deepEqual(urls, [
      'https://www.meetup.com/find/?location=us--ca--san-francisco&source=EVENTS',
      'https://www.meetup.com/find/?location=us--ca--oakland&source=EVENTS',
      'https://www.meetup.com/find/?location=us--ca--berkeley&source=EVENTS',
      'https://www.meetup.com/find/?location=us--ca--walnut-creek&source=EVENTS',
      'https://www.meetup.com/find/?location=us--ca--san-francisco&source=EVENTS&categoryId=652',
      'https://www.meetup.com/find/?location=us--ca--san-francisco&source=EVENTS&categoryId=395',
    ])
    assert.deepEqual(waits, [400, 400, 400, 400, 400])
    assert.ok(events.length > 0)
    assert.deepEqual(titleStarts(events), [
      { title: 'Last-day meetup', start: '2026-04-23T06:59:00Z', end: null },
      { title: 'Offset-projected today meetup', start: '2026-03-09T07:00:00+02:00', end: null },
      { title: 'UTC today meetup', start: '2026-03-08T08:00:00Z', end: null },
      { title: 'Zoneless today meetup', start: '2026-03-08T03:30:00', end: null },
    ])

    let invalidFetches = 0
    await assert.rejects(
      fetchEvents({
        nowMs: Number.NaN,
        fetchImpl: async () => {
          invalidFetches += 1
          return textResponse(html)
        },
        waitImpl: async () => {},
      }),
      /nowMs must be finite/,
    )
    assert.equal(invalidFetches, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('SF Meetup fixture is nonempty and byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL(
    './fixtures/city-time/sf-meetup-source-probe.mjs',
    import.meta.url,
  ))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, CITY: 'sf-east-bay', TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })

  assert.ok(JSON.parse(outputs[0]).length > 0)
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})

test('SF Meetup product-calendar logic cannot fall back to host-local Date math', () => {
  const source = readFileSync(
    new URL('../finder/sources/sf-east-bay/meetup.mjs', import.meta.url),
    'utf8',
  )
  const executable = source.replace(/\/\/.*$/gm, '')

  assert.doesNotMatch(executable, /new Date\s*\(/)
  assert.doesNotMatch(
    executable,
    /\.(?:getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|setDate)\s*\(/,
  )
  assert.equal((source.match(/Date\.now\(\)/g) || []).length, 1)
  assert.match(source, /sourceWindow\(CITY_TZ, nowMs, WINDOW_DAYS\)/)
  assert.match(source, /sourceStartDay\(CITY_TZ, v\)/)
  assert.match(source, /fetchWithTimeout\([^]*fetchImpl\)/)
  assert.match(source, /await waitImpl\(FETCH_GAP_MS\)/)
})
