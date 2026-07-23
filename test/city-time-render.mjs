import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  createCreativeLoafingParser,
  isRenderCacheFresh,
  scrapeRenderSourcesWithReceipt,
} from '../finder/render.mjs'

const card = (dateLine) => [
  'Fixture Event',
  dateLine,
  'Fixture Hall',
  '123 Main St, Tampa',
].join('\n')

test('Creative Loafing parser resolves New Year and ranges from the fixed Tampa day', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('./fixtures/city-time/sources/cltampa-card.json', import.meta.url),
    'utf8',
  ))
  const parseCard = createCreativeLoafingParser({ nowMs: Date.parse('2027-01-01T02:30:00Z') })

  assert.deepEqual(parseCard(fixture.cardText, fixture.title), {
    start: '2027-01-01T19:00:00',
    end: '2027-01-01T21:00:00',
    venue: 'Boundary Hall',
    address: '123 Main St, Tampa',
    price: 20,
    isFree: false,
    description: 'A carefully described Creative Loafing event used for city-calendar regression coverage.',
  })
})

test('Creative Loafing year rollover keeps the exact 14-day cutoff in the current year', () => {
  const parseCard = createCreativeLoafingParser({ nowMs: Date.parse('2026-07-15T16:00:00Z') })

  assert.equal(parseCard(card('July 1, 7 p.m.'), 'Fixture Event').start, '2026-07-01T19:00:00')
  assert.equal(parseCard(card('June 30, 7 p.m.'), 'Fixture Event').start, '2027-06-30T19:00:00')
})

test('Creative Loafing parser chooses the first future occurrence and rejects impossible dates', () => {
  const parseCard = createCreativeLoafingParser({ nowMs: Date.parse('2026-07-15T16:00:00Z') })

  assert.equal(
    parseCard(card('July 14, 6 p.m. and July 16, 8 p.m.'), 'Fixture Event').start,
    '2026-07-16T20:00:00',
  )
  assert.equal(parseCard(card('Feb. 30, 7 p.m.'), 'Fixture Event').start, null)
})

test('Creative Loafing parser requires one finite run instant', () => {
  assert.throws(() => createCreativeLoafingParser(), /nowMs must be finite/i)
  assert.throws(() => createCreativeLoafingParser({ nowMs: Number.NaN }), /nowMs must be finite/i)
})

test('render cache freshness is elapsed-time strict and rejects future or malformed stamps', () => {
  const nowMs = Date.parse('2026-07-15T16:00:00Z')
  const maxAgeMs = 6 * 60 * 60 * 1000
  const cache = (fetchedAt) => ({ fetchedAt, events: [{}] })

  assert.equal(isRenderCacheFresh(cache(new Date(nowMs - maxAgeMs + 1).toISOString()), { nowMs, maxAgeMs }), true)
  assert.equal(isRenderCacheFresh(cache(new Date(nowMs - maxAgeMs).toISOString()), { nowMs, maxAgeMs }), false)
  assert.equal(isRenderCacheFresh(cache(new Date(nowMs + 1).toISOString()), { nowMs, maxAgeMs }), false)
  assert.equal(isRenderCacheFresh(cache('not-a-date'), { nowMs, maxAgeMs }), false)
  assert.equal(isRenderCacheFresh(null, { nowMs, maxAgeMs }), false)
  assert.throws(() => isRenderCacheFresh(cache(new Date(nowMs).toISOString()), { maxAgeMs }), /nowMs must be finite/i)
})

test('render acquisition receipts distinguish live, fresh-cache, and stale fallback', async () => {
  const nowMs = Date.parse('2026-07-15T16:00:00Z')
  const events = [{ title: 'Fixture event' }]
  let scrapeCalls = 0
  const fresh = await scrapeRenderSourcesWithReceipt({
    nowMs,
    readCacheImpl: () => ({ fetchedAt: new Date(nowMs - 1000).toISOString(), events }),
    scrapeImpl: async () => {
      scrapeCalls += 1
      return events
    },
    logger: { error: () => {} },
  })
  assert.deepEqual(fresh, { events, acquisition: 'fresh-cache', error: null })
  assert.equal(scrapeCalls, 0)

  let written = null
  const live = await scrapeRenderSourcesWithReceipt({
    nowMs,
    force: true,
    scrapeImpl: async () => {
      scrapeCalls += 1
      return events
    },
    writeCacheImpl: (rows, instant) => { written = { rows, instant } },
    logger: { error: () => {} },
  })
  assert.deepEqual(live, { events, acquisition: 'live', error: null })
  assert.deepEqual(written, { rows: events, instant: nowMs })

  const stale = await scrapeRenderSourcesWithReceipt({
    nowMs,
    force: true,
    scrapeImpl: async () => { throw new Error('blocked') },
    readCacheImpl: () => ({ fetchedAt: '2026-07-01T00:00:00.000Z', events }),
    logger: { error: () => {} },
  })
  assert.deepEqual(stale, { events, acquisition: 'stale-cache', error: 'blocked' })
})

test('require-live render bypasses caches and refuses empty or failed acquisition', async () => {
  const nowMs = Date.parse('2026-07-15T16:00:00Z')
  const cache = { fetchedAt: new Date(nowMs - 1000).toISOString(), events: [{ title: 'Cached' }] }
  let cacheReads = 0
  const options = {
    nowMs,
    requireLive: true,
    readCacheImpl: () => {
      cacheReads += 1
      return cache
    },
    logger: { error: () => {} },
  }

  await assert.rejects(
    () => scrapeRenderSourcesWithReceipt({
      ...options,
      scrapeImpl: async () => { throw new Error('transport failed') },
    }),
    /required live render acquisition failed: transport failed/,
  )
  await assert.rejects(
    () => scrapeRenderSourcesWithReceipt({
      ...options,
      scrapeImpl: async () => [],
    }),
    /required live render acquisition failed: zero events extracted/,
  )
  assert.equal(cacheReads, 0)
})

test('render parser output is byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/render-probe.mjs', import.meta.url))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, CITY: 'tampa-bay', TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })

  assert.ok(outputs[0])
  assert.equal(JSON.parse(outputs[0]).start, '2027-01-01T19:00:00')
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})

test('Tampa render parsing is invariant to the active finder city', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/render-probe.mjs', import.meta.url))
  const outputs = ['tampa-bay', 'sf-east-bay'].map((CITY) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CITY,
        RENDER_NOW: '2027-01-01T05:30:00Z',
        TZ: 'Asia/Tokyo',
      },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })

  assert.equal(JSON.parse(outputs[0]).start, '2027-12-17T18:00:00')
  assert.equal(outputs[1], outputs[0])
})

test('render calendar parsing has no host-local Date path and every scrape parse uses its run parser', () => {
  const source = readFileSync(new URL('../finder/render.mjs', import.meta.url), 'utf8')
  const parserSection = source.slice(
    source.indexOf('// Date / text parsing helpers'),
    source.indexOf('// Cache'),
  )
  const scrapeSection = source.slice(
    source.indexOf('async function scrapeCreativeLoafing'),
    source.indexOf('// Public API'),
  )

  assert.doesNotMatch(parserSection, /new Date\s*\(/)
  assert.doesNotMatch(parserSection, /\.get(?:FullYear|Month|Date)\s*\(/)
  assert.equal((scrapeSection.match(/parseCard\(/g) || []).length, 3)
  assert.doesNotMatch(scrapeSection, /parseEventText\(/)
})
