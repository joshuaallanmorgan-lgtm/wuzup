import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  isVspcCacheFresh,
  mapListingsForWindow,
  pickTimesForDay,
} from '../finder/sources/tampa-bay/vspc.mjs'

const NOW_MS = Date.parse('2026-07-15T03:30:00Z')

function fixture() {
  return JSON.parse(readFileSync(
    fileURLToPath(new URL('./fixtures/city-time/sources/vspc.json', import.meta.url)),
    'utf8',
  ))
}

test('VSPC maps the first occurrence in its injected inclusive Tampa window', () => {
  const events = mapListingsForWindow(fixture(), { nowMs: NOW_MS })
  assert.deepEqual(events.map(({ title, start, end, recurring }) => ({
    title,
    start,
    end,
    recurring: recurring === true,
  })), [
    {
      title: 'Recurring waterfront yoga',
      start: '2026-07-14',
      end: null,
      recurring: true,
    },
    {
      title: 'Last-day boundary',
      start: '2026-08-28',
      end: null,
      recurring: false,
    },
    {
      title: 'Weekend festival',
      start: '2026-07-16',
      end: '2026-07-18',
      recurring: false,
    },
  ])
})

test('VSPC detail times use the actual city offset at the wall time', () => {
  assert.deepEqual(pickTimesForDay([
    { the_date: '2026-07-15', start_time: '9:00 pm', end_time: '9:30 pm' },
  ], '2026-07-15'), {
    start: '2026-07-15T21:00:00-04:00',
    end: '2026-07-15T21:30:00-04:00',
  })
  assert.deepEqual(pickTimesForDay([
    { the_date: '2026-01-15', start_time: '9:00 pm', end_time: '9:30 pm' },
  ], '2026-01-15'), {
    start: '2026-01-15T21:00:00-05:00',
    end: '2026-01-15T21:30:00-05:00',
  })
})

test('VSPC detail times fail closed on gaps and disambiguate the fall fold', () => {
  assert.equal(pickTimesForDay([
    { the_date: '2026-03-08', start_time: '2:30 am', end_time: '3:30 am' },
  ], '2026-03-08'), null)
  assert.deepEqual(pickTimesForDay([
    { the_date: '2026-11-01', start_time: '1:30 am', end_time: '1:45 am' },
  ], '2026-11-01'), {
    start: '2026-11-01T01:30:00-04:00',
    end: '2026-11-01T01:45:00-05:00',
  })
  assert.equal(pickTimesForDay([
    { the_date: '2026-07-16', start_time: '8:00 pm', end_time: '9:00 pm' },
  ], '2026-07-15'), null)
})

test('VSPC pure mapping is byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/vspc-probe.mjs', import.meta.url))
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

test('VSPC only treats a cache as fresh for the injected Tampa window day', () => {
  const nowMs = Date.parse('2026-07-15T04:15:00Z')
  const base = {
    fetchedAt: '2026-07-15T03:45:00.000Z',
    events: [{ title: 'Prior occurrence' }],
  }
  assert.equal(isVspcCacheFresh({ ...base, windowDay: '2026-07-15' }, { nowMs }), true)
  assert.equal(isVspcCacheFresh({ ...base, windowDay: '2026-07-14' }, { nowMs }), false)
  assert.equal(isVspcCacheFresh(base, { nowMs }), false)
  assert.equal(isVspcCacheFresh({
    ...base,
    windowDay: '2026-07-15',
    fetchedAt: '2026-07-15T05:00:00.000Z',
  }, { nowMs }), false)
  assert.equal(isVspcCacheFresh({
    ...base,
    windowDay: '2026-07-15',
    fetchedAt: 'not-a-date',
  }, { nowMs }), false)
})

test('VSPC cache branches are wired to the window-day receipt', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../finder/sources/tampa-bay/vspc.mjs', import.meta.url)),
    'utf8',
  )
  assert.match(source, /if \(isVspcCacheFresh\(cache, \{ nowMs \}\)\)/)
  assert.match(source, /writeCache\(events, today, nowMs\)/)
  assert.match(source, /SKIP_RENDER returning .*window/i)
})
