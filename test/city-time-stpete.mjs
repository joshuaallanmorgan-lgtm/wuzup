import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import * as stpete from '../finder/sources/tampa-bay/stpete.mjs'

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/city-time/sources/stpete.json', import.meta.url),
  'utf8',
))
const MAIN_NOW = Date.parse('2026-03-01T05:30:00Z')

const starts = (events, title) => events
  .filter((event) => event.title === title)
  .map((event) => [event.start, event.end])

test('St. Pete exposes strict pure mapping and cache seams', () => {
  assert.equal(typeof stpete.mapStPeteRecords, 'function')
  assert.equal(typeof stpete.isStPeteCacheFresh, 'function')
})

test('St. Pete maps an inclusive city-day window and omits the spring gap', () => {
  const events = stpete.mapStPeteRecords(fixture.main, { nowMs: MAIN_NOW })

  assert.equal(events.length, 12)
  assert.deepEqual(starts(events, 'First boundary'), [['2026-03-01T00:00:00', '2026-03-01T01:00:00']])
  assert.deepEqual(starts(events, 'Last boundary'), [['2026-04-15T23:59:00', '2026-04-16T00:30:00']])
  assert.deepEqual(starts(events, 'Spring weekly'), [
    ['2026-03-01T02:30:00', '2026-03-01T03:30:00'],
    ['2026-03-15T02:30:00', '2026-03-15T03:30:00'],
  ])
  assert.deepEqual(starts(events, 'Third Tuesday'), [['2026-03-17T18:00:00', '2026-03-17T19:00:00']])
  assert.deepEqual(starts(events, 'Last Friday'), [['2026-03-27T17:00:00', '2026-03-27T18:00:00']])
  assert.deepEqual(starts(events, 'All-day last'), [['2026-04-15', null]])
  for (const rejected of ['Before window', 'After window', 'Impossible day', 'Impossible clock', 'Inactive display', 'Meeting']) {
    assert.deepEqual(starts(events, rejected), [])
  }
})

test('St. Pete recurrence honors RDATE, EXDATE, COUNT, and inclusive UNTIL', () => {
  const events = stpete.mapStPeteRecords(fixture.main, { nowMs: MAIN_NOW })

  assert.deepEqual(starts(events, 'Exception series'), [
    ['2026-03-03T10:00:00', '2026-03-03T11:00:00'],
    ['2026-03-03T11:00:00', '2026-03-03T12:00:00'],
  ])
  assert.deepEqual(starts(events, 'Inclusive until'), [
    ['2026-03-30T09:00:00', '2026-03-30T10:00:00'],
    ['2026-03-31T09:00:00', '2026-03-31T10:00:00'],
    ['2026-04-01T09:00:00', '2026-04-01T10:00:00'],
  ])
})

test('St. Pete preserves fold wall clocks and crosses year and leap boundaries', () => {
  const fold = stpete.mapStPeteRecords(fixture.fold, { nowMs: Date.parse('2026-10-20T16:00:00Z') })
  const year = stpete.mapStPeteRecords(fixture.year, { nowMs: Date.parse('2026-12-31T17:00:00Z') })
  const leap = stpete.mapStPeteRecords(fixture.leap, { nowMs: Date.parse('2028-01-20T17:00:00Z') })

  assert.deepEqual(starts(fold, 'Fold weekly'), [
    ['2026-10-25T01:30:00', '2026-10-25T02:30:00'],
    ['2026-11-01T01:30:00', '2026-11-01T02:30:00'],
  ])
  assert.deepEqual(starts(year, 'New year'), [['2027-01-01T00:15:00', '2027-01-01T01:15:00']])
  assert.deepEqual(starts(leap, 'Leap recurrence'), [['2028-02-29T09:00:00', '2028-02-29T10:00:00']])
})

test('St. Pete projects UTC recurrence stamps into Tampa and honors UTC UNTIL', () => {
  const events = stpete.mapStPeteRecords(fixture.utc, { nowMs: Date.parse('2026-03-07T05:30:00Z') })

  assert.deepEqual(starts(events, 'UTC recurrence'), [
    ['2026-03-07T02:30:00', '2026-03-07T03:30:00'],
    ['2026-03-08T03:30:00', '2026-03-08T04:30:00'],
    ['2026-03-09T03:30:00', '2026-03-09T04:30:00'],
  ])
  assert.deepEqual(starts(events, 'UTC duration'), [
    ['2026-03-08T01:30:00', '2026-03-08T04:30:00'],
    ['2026-03-09T02:30:00', '2026-03-09T04:30:00'],
  ])
})

test('St. Pete cache freshness requires the requested Tampa day and strict elapsed age', () => {
  const nowMs = Date.parse('2026-03-08T05:01:00Z')
  const current = (fetchedAt, windowDay = '2026-03-08', events = [{}]) => ({ fetchedAt, windowDay, events })

  assert.equal(stpete.isStPeteCacheFresh(current(new Date(nowMs - 1).toISOString()), { nowMs }), true)
  assert.equal(stpete.isStPeteCacheFresh(current(new Date(nowMs - 6 * 60 * 60 * 1000).toISOString()), { nowMs }), false)
  assert.equal(stpete.isStPeteCacheFresh(current(new Date(nowMs + 1).toISOString()), { nowMs }), false)
  assert.equal(stpete.isStPeteCacheFresh(current('bad'), { nowMs }), false)
  assert.equal(stpete.isStPeteCacheFresh(current(new Date(nowMs - 2 * 60 * 1000).toISOString(), '2026-03-07'), { nowMs }), false)
  assert.equal(stpete.isStPeteCacheFresh({ fetchedAt: new Date(nowMs - 1).toISOString(), events: [{}] }, { nowMs }), false)
  assert.equal(stpete.isStPeteCacheFresh(current(new Date(nowMs - 1).toISOString(), '2026-03-08', null), { nowMs }), false)
  assert.throws(() => stpete.isStPeteCacheFresh(current(new Date(nowMs).toISOString()), {}), /nowMs must be finite/i)
})

test('St. Pete fetch uses the injected run epoch, transport, and cache receipt', async () => {
  const writes = []
  const urls = []
  const events = await stpete.fetchEvents({
    nowMs: MAIN_NOW,
    readCacheImpl: async () => ({
      fetchedAt: new Date(MAIN_NOW - 1000).toISOString(),
      windowDay: '2026-02-28',
      events: [{ title: 'stale' }],
    }),
    writeCacheImpl: async (...args) => writes.push(args),
    fetchImpl: async (url) => {
      urls.push(String(url))
      return { ok: true, status: 200, json: async () => structuredClone(fixture.main) }
    },
  })

  assert.equal(events.length, 12)
  assert.equal(urls.length, 1)
  assert.match(urls[0], /calendar_data_handler\.php/)
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0].length, 12)
  assert.deepEqual(writes[0][1], { nowMs: MAIN_NOW, windowDay: '2026-03-01' })
})

test('St. Pete fixtures are nonempty and byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/stpete-source-probe.mjs', import.meta.url))
  const outputs = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, CITY: 'tampa-bay', TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })

  const parsed = JSON.parse(outputs[0])
  assert.deepEqual(Object.fromEntries(Object.entries(parsed).map(([key, events]) => [key, events.length])), {
    main: 12,
    fold: 2,
    year: 1,
    leap: 1,
    utc: 5,
  })
  assert.equal(outputs[1], outputs[0])
  assert.equal(outputs[2], outputs[0])
})

test('St. Pete product-calendar logic cannot fall back to host-local Date math', () => {
  const source = readFileSync(new URL('../finder/sources/tampa-bay/stpete.mjs', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /new Date\s*\(\s*\)/)
  assert.doesNotMatch(source, /\.(?:getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|setDate)\s*\(/)
  assert.doesNotMatch(source, /new Date\s*\(\s*rec\.(?:start|end)/)
  assert.equal((source.match(/Date\.now\(\)/g) || []).length, 1)
  assert.match(source, /sourceWindow\(tampaTimeZone, nowMs, WINDOW_DAYS\)/)
  assert.match(source, /fetchWithTimeout\([^]*fetchImpl\)/)
})
