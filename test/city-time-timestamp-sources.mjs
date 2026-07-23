import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { fetchEvents as fetchMeetup } from '../finder/sources/tampa-bay/meetup.mjs'
import { fetchEvents as fetchTampaGov } from '../finder/sources/tampa-bay/tampagov.mjs'
import { fetchEvents as fetchTrumba } from '../finder/sources/tampa-bay/trumba-ut.mjs'
import { fetchEvents as fetchWmnf } from '../finder/sources/tampa-bay/wmnf.mjs'

const NOW_MS = Date.parse('2026-03-08T05:30:00Z')
const fixtureUrl = (name) => new URL(`./fixtures/city-time/sources/${name}`, import.meta.url)
const fixtureText = (name) => readFileSync(fileURLToPath(fixtureUrl(name)), 'utf8')
const fixtureJson = (name) => JSON.parse(fixtureText(name))
const jsonResponse = (value) => ({ ok: true, status: 200, json: async () => structuredClone(value) })
const textResponse = (value) => ({ ok: true, status: 200, text: async () => value })
const titleStarts = (events) => events
  .map(({ title, start, end }) => ({ title, start, end }))
  .sort((a, b) => a.title.localeCompare(b.title))

test('Meetup filters six listing pages with one injected Tampa window and no host dates', async () => {
  const html = fixtureText('meetup.html')
  const urls = []
  const waits = []
  const events = await fetchMeetup({
    nowMs: NOW_MS,
    fetchImpl: async (url) => {
      urls.push(String(url))
      return textResponse(html)
    },
    waitImpl: async (ms) => waits.push(ms),
  })

  assert.equal(urls.length, 6)
  assert.equal(urls[0], 'https://www.meetup.com/find/?location=us--fl--tampa&source=EVENTS')
  assert.deepEqual(waits, [400, 400, 400, 400, 400])
  assert.deepEqual(titleStarts(events), [
    { title: 'Last-day meetup', start: '2026-04-22T23:59:00-04:00', end: null },
    { title: 'Today meetup', start: '2026-03-08T03:30:00-04:00', end: null },
  ])
})

test('City of Tampa projects offset starts into the injected city window and validates ends', async () => {
  const urls = []
  const events = await fetchTampaGov({
    nowMs: NOW_MS,
    fetchImpl: async (url) => {
      urls.push(String(url))
      return textResponse(fixtureText('tampagov.xml'))
    },
  })

  assert.deepEqual(urls, ['https://www.tampa.gov/calendar/rss.xml'])
  assert.deepEqual(titleStarts(events), [
    { title: 'Last-day city event', start: '2026-04-23T01:00:00+02:00', end: '2026-04-23T02:00:00+02:00' },
    { title: 'Offset-projected city event', start: '2026-03-09T01:00:00+02:00', end: null },
    { title: 'Today city event', start: '2026-03-08T03:30:00-04:00', end: null },
  ])
})

test('Trumba uses calendar spans and preserves eligible publisher timestamps', async () => {
  const urls = []
  const events = await fetchTrumba({
    nowMs: NOW_MS,
    fetchImpl: async (url) => {
      urls.push(String(url))
      return jsonResponse(fixtureJson('trumba-ut.json'))
    },
  })

  assert.deepEqual(urls, ['https://www.trumba.com/calendars/ut-events.json'])
  assert.deepEqual(titleStarts(events), [
    { title: 'Last UT', start: '2026-04-23T01:00:00+02:00', end: null },
    { title: 'Short exhibit', start: '2026-03-08', end: '2026-03-09' },
    { title: 'Thirty day exhibit', start: '2026-03-08', end: '2026-04-06' },
    { title: 'Today & UT', start: '2026-03-08T03:30:00', end: '2026-03-08T04:30:00' },
  ])
})

test('WMNF binds its list query and detail fallback to the injected Tampa window', async () => {
  const fixture = fixtureJson('wmnf.json')
  const urls = []
  const events = await fetchWmnf({
    nowMs: NOW_MS,
    fetchImpl: async (url) => {
      const value = String(url)
      urls.push(value)
      if (value.endsWith('/events/42/datetimes')) return jsonResponse(fixture.detailsByEventId['42'])
      return jsonResponse(fixture.list)
    },
  })

  assert.equal(urls.length, 2)
  const listUrl = new URL(urls[0])
  assert.deepEqual(listUrl.searchParams.getAll('where[Datetime.DTT_EVT_start][]'), [
    '>',
    '2026-03-08T00:00:00',
  ])
  assert.equal(urls[1], 'https://www.wmnf.org/wp-json/ee/v4.8.36/events/42/datetimes')
  assert.deepEqual(titleStarts(events), [
    { title: 'Detail WMNF', start: '2026-03-08T19:00:00', end: null },
    { title: 'Last WMNF', start: '2026-04-23T01:00:00+02:00', end: null },
    { title: 'Mixed offset WMNF', start: '2026-03-09T01:00:00+02:00', end: null },
    { title: 'Today & WMNF', start: '2026-03-08T03:30:00', end: '2026-03-08T04:30:00' },
  ])
})

test('timestamp-source fixtures are byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/timestamp-source-probe.mjs', import.meta.url))
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
