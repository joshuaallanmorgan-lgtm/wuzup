import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  addCalendarDays,
  cityClock,
  cityMidnightMs,
  coversDay,
  dayIdAt,
  eventActionability,
  daypartOfTime,
  eventAvailability,
  eventTime,
  parseZonedDateTime,
  weekdayOf,
} from '../shared/city-time.mjs'

const NY = 'America/New_York'
const LA = 'America/Los_Angeles'

test('calendar-day arithmetic is independent of elapsed-hour length', () => {
  assert.equal(addCalendarDays('2026-03-07', 1), '2026-03-08')
  assert.equal(addCalendarDays('2026-03-08', 1), '2026-03-09')
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addCalendarDays('2026-01-01', -1), '2025-12-31')
  assert.equal(weekdayOf('2026-03-08'), 0)
  assert.throws(() => addCalendarDays('2026-02-30', 1), /invalid calendar day/i)
})

test('city clocks use the city zone rather than the device zone', () => {
  const nowMs = Date.parse('2026-07-15T05:30:00Z')
  assert.deepEqual(
    { today: cityClock({ timeZone: NY, nowMs }).today, hour: cityClock({ timeZone: NY, nowMs }).cityHour },
    { today: '2026-07-15', hour: 1 },
  )
  assert.deepEqual(
    { today: cityClock({ timeZone: LA, nowMs }).today, hour: cityClock({ timeZone: LA, nowMs }).cityHour },
    { today: '2026-07-14', hour: 22 },
  )
  assert.equal(dayIdAt(nowMs, NY), '2026-07-15')
  assert.equal(dayIdAt(nowMs, LA), '2026-07-14')
})

test('all-day intervals honor 23-hour and 25-hour DST days', () => {
  const spring = eventTime({ start: '2026-03-08' }, { timeZone: NY })
  const fall = eventTime({ start: '2026-11-01' }, { timeZone: NY })

  assert.equal(spring.ok, true)
  assert.equal(new Date(spring.startAt).toISOString(), '2026-03-08T05:00:00.000Z')
  assert.equal(new Date(spring.endAt).toISOString(), '2026-03-09T04:00:00.000Z')
  assert.equal(spring.endAt - spring.startAt, 23 * 3600_000)

  assert.equal(fall.ok, true)
  assert.equal(new Date(fall.startAt).toISOString(), '2026-11-01T04:00:00.000Z')
  assert.equal(new Date(fall.endAt).toISOString(), '2026-11-02T05:00:00.000Z')
  assert.equal(fall.endAt - fall.startAt, 25 * 3600_000)
})

test('zoneless DST gaps fail closed and folds use explicit disambiguation', () => {
  const gap = parseZonedDateTime('2026-03-08T02:30:00', NY)
  assert.deepEqual(gap, { ok: false, error: 'nonexistent-local-time' })

  const earlier = parseZonedDateTime('2026-11-01T01:30:00', NY, { disambiguation: 'earlier' })
  const later = parseZonedDateTime('2026-11-01T01:30:00', NY, { disambiguation: 'later' })
  assert.equal(earlier.ok, true)
  assert.equal(later.ok, true)
  assert.equal(earlier.ambiguous, true)
  assert.equal(later.ambiguous, true)
  assert.equal(new Date(earlier.epochMs).toISOString(), '2026-11-01T05:30:00.000Z')
  assert.equal(new Date(later.epochMs).toISOString(), '2026-11-01T06:30:00.000Z')
})

test('zoneless and offset-bearing starts project into the city consistently', () => {
  const local = eventTime({ start: '2026-07-15T19:00:00' }, { timeZone: NY })
  assert.equal(local.ok, true)
  assert.equal(new Date(local.startAt).toISOString(), '2026-07-15T23:00:00.000Z')
  assert.equal(local.startDay, '2026-07-15')
  assert.equal(daypartOfTime(local), 'night')

  const offset = eventTime({ start: '2026-07-15T01:00:00+02:00' }, { timeZone: NY })
  assert.equal(offset.ok, true)
  assert.equal(new Date(offset.startAt).toISOString(), '2026-07-14T23:00:00.000Z')
  assert.equal(offset.startDay, '2026-07-14')
  assert.equal(daypartOfTime(offset), 'night')
})

test('missing timed ends use three hours and availability changes at the exact boundary', () => {
  const timed = eventTime({ start: '2026-07-15T19:00:00' }, { timeZone: NY })
  assert.equal(timed.assumedEnd, true)
  assert.equal(timed.endAt - timed.startAt, 3 * 3600_000)
  assert.deepEqual(eventAvailability(timed, { nowMs: timed.endAt - 1 }), {
    code: 'actionable',
    actionable: true,
  })
  assert.deepEqual(eventAvailability(timed, { nowMs: timed.endAt }), {
    code: 'ended',
    actionable: false,
  })
})

test('an explicit zero-length timed range uses the bounded assumed duration', () => {
  const timed = eventTime(
    { start: '2026-07-15T19:00:00', end: '2026-07-15T19:00:00' },
    { timeZone: NY },
  )
  assert.equal(timed.ok, true)
  assert.equal(timed.assumedEnd, true)
  assert.equal(timed.endAt - timed.startAt, 3 * 3600_000)

  const reversed = eventTime(
    { start: '2026-07-15T19:00:00', end: '2026-07-15T18:59:59' },
    { timeZone: NY },
  )
  assert.deepEqual(reversed, { ok: false, error: 'end-before-start' })
})

test('same-day reversed local clocks infer a bounded overnight end', () => {
  const overnight = eventTime(
    { start: '2026-07-15T22:30:00', end: '2026-07-15T03:00:00' },
    { timeZone: NY },
  )
  assert.equal(overnight.ok, true)
  assert.equal(overnight.inferredOvernightEnd, true)
  assert.equal(overnight.endDay, '2026-07-16')
  assert.equal(overnight.endAt - overnight.startAt, 4.5 * 3600_000)

  const reversedOffset = eventTime(
    { start: '2026-07-15T22:30:00-04:00', end: '2026-07-15T03:00:00-04:00' },
    { timeZone: NY },
  )
  assert.deepEqual(reversedOffset, { ok: false, error: 'end-before-start' })
})

test('offset timestamps use strict clock and offset grammar', () => {
  assert.equal(parseZonedDateTime('2026-07-15T19:00:00-04:00', NY).ok, true)
  assert.equal(parseZonedDateTime('2026-07-15T19:00:00-0400', NY).ok, true)
  assert.deepEqual(
    parseZonedDateTime('2026-07-15T24:00:00-04:00', NY),
    { ok: false, error: 'invalid-datetime' },
  )
  assert.deepEqual(
    parseZonedDateTime('2026-07-15T19:00:00+14:30', NY),
    { ok: false, error: 'invalid-datetime' },
  )
})

test('event fold policy is caller-selectable and mixed start precision fails closed', () => {
  assert.deepEqual(
    eventTime(
      { start: '2026-11-01T01:30:00' },
      { timeZone: NY, startDisambiguation: 'reject' },
    ),
    { ok: false, error: 'ambiguous-local-time' },
  )
  assert.deepEqual(
    eventTime(
      { start: '2026-07-15', end: '2026-07-15T12:00:00' },
      { timeZone: NY },
    ),
    { ok: false, error: 'mixed-precision' },
  )
})

test('timed ranges use half-open day coverage and define date-only ends as inclusive', () => {
  const midnightEnd = eventTime(
    { start: '2026-07-15T23:00:00', end: '2026-07-16T00:00:00' },
    { timeZone: NY },
  )
  assert.equal(midnightEnd.endDay, '2026-07-15')
  assert.equal(coversDay(midnightEnd, '2026-07-16'), false)

  const inclusiveEnd = eventTime(
    { start: '2026-07-15T19:00:00', end: '2026-07-16' },
    { timeZone: NY },
  )
  assert.equal(inclusiveEnd.endDay, '2026-07-16')
  assert.equal(coversDay(inclusiveEnd, '2026-07-16'), true)
  assert.equal(inclusiveEnd.endAt, cityMidnightMs('2026-07-17', NY))
})

test('one event actionability wrapper carries raw status into the canonical predicate', () => {
  const result = eventActionability(
    {
      start: '2026-07-15T19:00:00',
      status: 'https://schema.org/EventCancelled',
    },
    { timeZone: NY, nowMs: Date.parse('2026-07-15T18:00:00Z') },
  )
  assert.equal(result.time.ok, true)
  assert.deepEqual(
    { code: result.code, actionable: result.actionable },
    { code: 'cancelled', actionable: false },
  )
})

test('inclusive date ranges cover literal city days and expire after the last midnight', () => {
  const range = eventTime(
    { start: '2026-07-17', end: '2026-07-19' },
    { timeZone: NY },
  )
  assert.equal(range.ok, true)
  assert.equal(range.startDay, '2026-07-17')
  assert.equal(range.endDay, '2026-07-19')
  assert.equal(coversDay(range, '2026-07-17'), true)
  assert.equal(coversDay(range, '2026-07-18'), true)
  assert.equal(coversDay(range, '2026-07-19'), true)
  assert.equal(coversDay(range, '2026-07-20'), false)
  assert.equal(range.endAt, cityMidnightMs('2026-07-20', NY))
})

test('status and parse failures remain separate from ended inventory', () => {
  const timed = eventTime({ start: '2026-07-15T19:00:00' }, { timeZone: NY })
  assert.deepEqual(eventAvailability(timed, { nowMs: timed.startAt, status: 'cancelled' }), {
    code: 'cancelled',
    actionable: false,
  })
  assert.deepEqual(eventAvailability(timed, { nowMs: timed.startAt, status: 'postponed' }), {
    code: 'postponed',
    actionable: false,
  })
  assert.deepEqual(eventAvailability(timed, { nowMs: timed.startAt, status: 'sold_out' }), {
    code: 'sold-out',
    actionable: false,
  })
  assert.deepEqual(
    eventAvailability({ ok: false, error: 'invalid-start' }, { nowMs: timed.startAt }),
    { code: 'invalid', actionable: false },
  )
})

test('serialized city-time results are byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/device-probe.mjs', import.meta.url))
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
