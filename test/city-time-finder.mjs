import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  calendarDistance,
  canonicalDayOf,
  finderEventState,
  finderEventTime,
  generationContext,
  publishedDayOf,
  selectLatestExplicitEnd,
} from '../finder/time.mjs'
import {
  addDaysStr,
  dayInTz,
  midnightInTz,
} from '../finder/sources/_shared.mjs'

const NY = 'America/New_York'

test('generation context requires one injected epoch and derives the city weekend', () => {
  const nowMs = Date.parse('2026-07-15T05:30:00Z')
  assert.deepEqual(generationContext({ timeZone: NY, nowMs }), {
    nowMs,
    generatedAt: '2026-07-15T05:30:00.000Z',
    today: '2026-07-15',
    weekendDays: ['2026-07-17', '2026-07-18', '2026-07-19'],
  })
  assert.throws(() => generationContext({ timeZone: NY }), /nowMs must be finite/i)
  assert.throws(
    () => finderEventState({ start: '2026-07-15T19:00:00' }, { timeZone: NY }),
    /nowMs must be finite/i,
  )
})

test('equal timed endpoints use three hours and change state at the exact boundary', () => {
  const event = {
    start: '2026-07-15T19:00:00',
    end: '2026-07-15T19:00:00',
  }
  const time = finderEventTime(event, { timeZone: NY })
  assert.equal(time.ok, true)
  assert.equal(time.assumedEnd, true)
  assert.equal(time.endAt - time.startAt, 3 * 3600_000)
  assert.equal(
    finderEventState(event, { timeZone: NY, nowMs: time.endAt - 1 }).code,
    'actionable',
  )
  assert.equal(
    finderEventState(event, { timeZone: NY, nowMs: time.endAt }).code,
    'ended',
  )
})

test('a reversed explicit end is preserved by merging and fails closed afterward', () => {
  const event = {
    start: '2026-07-15T19:00:00-04:00',
    end: '2026-07-15T18:59:59-04:00',
  }
  assert.equal(selectLatestExplicitEnd([event], NY), event.end)
  assert.deepEqual(finderEventTime(event, { timeZone: NY }), {
    ok: false,
    error: 'end-before-start',
  })
  assert.equal(
    finderEventState(event, { timeZone: NY, nowMs: Date.parse('2026-07-15T20:00:00Z') }).code,
    'invalid',
  )
})

test('fuzzy merge cannot launder an invalid member or poison a valid interval', async () => {
  const { fuzzyMerge } = await import('../finder/finder.mjs')
  const listing = (source, start, end) => ({
    title: 'Clock Contract Concert',
    venue: 'Trust Hall',
    source,
    start,
    end,
  })

  const invalid = fuzzyMerge([
    listing('Publisher A', '2026-07-15T18:00:00-04:00', null),
    listing('Publisher B', '2026-07-15T19:00:00-04:00', '2026-07-15T18:00:00-04:00'),
  ])
  assert.equal(invalid.length, 1)
  assert.deepEqual(finderEventTime(invalid[0], { timeZone: NY }), {
    ok: false,
    error: 'end-before-start',
  })

  const valid = fuzzyMerge([
    listing('Publisher A', '2026-07-15T19:00:00-04:00', '2026-07-15T20:00:00-04:00'),
    listing('Publisher B', '2026-07-15T18:00:00-04:00', '2026-07-15T18:00:00-04:00'),
  ])
  assert.equal(valid.length, 1)
  assert.equal(valid[0].start, '2026-07-15T19:00:00-04:00')
  assert.equal(valid[0].end, '2026-07-15T20:00:00-04:00')
  assert.equal(finderEventTime(valid[0], { timeZone: NY }).ok, true)

  const preserved = fuzzyMerge([
    listing('Publisher A', '2026-07-15T22:00:00-04:00', '2026-07-15T19:00:00-04:00'),
    listing('Publisher B', '2026-07-15T18:00:00-04:00', '2026-07-15T20:00:00-04:00'),
  ])
  assert.equal(preserved.length, 1)
  assert.equal(preserved[0].start, '2026-07-15T18:00:00-04:00')
  assert.equal(preserved[0].end, '2026-07-15T20:00:00-04:00')
  assert.equal(finderEventTime(preserved[0], { timeZone: NY }).ok, true)
})

test('finder span guards use the canonical interval end day', async () => {
  const { dedupeOngoingOccurrences, fuzzyMerge } = await import('../finder/finder.mjs')

  const midnightRun = {
    title: 'Midnight Market',
    start: '2026-07-15T20:00:00-04:00',
    end: '2026-07-16T00:00:00-04:00',
    venue: 'Trust Hall',
    source: 'Publisher A',
    sources: ['Publisher A', 'Publisher B'],
    buzz: 2,
  }
  const sameDayOccurrence = {
    ...midnightRun,
    start: '2026-07-15T21:00:00-04:00',
    end: '2026-07-15T22:00:00-04:00',
    source: 'Publisher C',
    sources: ['Publisher C'],
    buzz: 1,
  }
  const folded = dedupeOngoingOccurrences([midnightRun, sameDayOccurrence])
  assert.equal(folded.folded, 0, 'a midnight-exclusive end must remain a one-day event')
  assert.equal(folded.events.length, 2)

  const lateAssumed = {
    title: 'Sunset Concert',
    start: '2026-07-15T23:00:00-04:00',
    end: '2026-07-15T23:00:00-04:00',
    venue: 'Trust Hall',
    source: 'Publisher A',
  }
  const lateSameDay = {
    title: 'Sunset Workshop',
    start: '2026-07-15T23:00:00-04:00',
    end: '2026-07-15T23:30:00-04:00',
    venue: 'Trust Hall',
    source: 'Publisher B',
  }
  assert.equal(
    fuzzyMerge([lateAssumed, lateSameDay]).length,
    2,
    'a canonical cross-midnight range must not venue-merge with a same-day range',
  )
})

test('inclusive all-day ranges expire at city midnight after the final day', () => {
  const event = { start: '2026-03-07', end: '2026-03-08' }
  const time = finderEventTime(event, { timeZone: NY })
  assert.equal(time.ok, true)
  assert.equal(time.endDay, '2026-03-08')
  assert.equal(new Date(time.endAt).toISOString(), '2026-03-09T04:00:00.000Z')
  assert.equal(
    finderEventState(event, { timeZone: NY, nowMs: time.endAt - 1 }).actionable,
    true,
  )
  assert.equal(
    finderEventState(event, { timeZone: NY, nowMs: time.endAt }).code,
    'ended',
  )
})

test('finder calendar distance ignores 23-hour and 25-hour device elapsed days', () => {
  assert.equal(calendarDistance('2026-03-08', '2026-03-09'), 1)
  assert.equal(calendarDistance('2026-11-01', '2026-11-02'), 1)
  assert.equal(calendarDistance('2026-11-02', '2026-11-01'), -1)
})

test('published identity day remains distinct from the canonical city day', async () => {
  const start = '2026-07-15T01:00:00+02:00'
  assert.equal(publishedDayOf(start), '2026-07-15')
  assert.equal(canonicalDayOf(start, NY), '2026-07-14')

  const { eventIdCanonical } = await import('../finder/finder.mjs')
  assert.match(eventIdCanonical({ title: 'Night Market', start }, 'tampa-bay'), /\|2026-07-15$/)
})

test('non-ISO starts have no published day and stable identity uses tbd', async () => {
  assert.equal(publishedDayOf('July 15, 2026 7:00 PM'), null)
  assert.equal(publishedDayOf(''), null)

  const { eventIdCanonical } = await import('../finder/finder.mjs')
  assert.match(
    eventIdCanonical({ title: 'Unscheduled Event', start: 'July 15, 2026 7:00 PM' }, 'tampa-bay'),
    /\|tbd$/,
  )
})

test('source city-time helpers share strict calendar semantics', () => {
  const nowMs = Date.parse('2026-07-15T05:30:00Z')
  assert.equal(dayInTz(NY, nowMs), '2026-07-15')
  assert.equal(dayInTz('America/Los_Angeles', new Date(nowMs)), '2026-07-14')
  assert.equal(midnightInTz(NY, '2026-03-08').toISOString(), '2026-03-08T05:00:00.000Z')
  assert.equal(addDaysStr('2026-03-08', 1), '2026-03-09')
  assert.throws(() => midnightInTz(NY, '2026-02-30'), /invalid calendar day/i)
  assert.throws(() => addDaysStr('2026-02-30', 1), /invalid calendar day/i)
})

test('finder main uses the shared city-time seam and captures Date.now once', () => {
  const finderPath = fileURLToPath(new URL('../finder/finder.mjs', import.meta.url))
  const source = readFileSync(finderPath, 'utf8')
  assert.match(source, /from ['"]\.\/time\.mjs['"]/)
  assert.equal((source.match(/\bDate\.now\(\)/g) || []).length, 1)
  assert.match(source, /const generatedAt = new Date\(runEpoch\)\.toISOString\(\)/)
  assert.doesNotMatch(source, /function cityMidnightMs\s*\(/)
  assert.doesNotMatch(source, /function startMs\s*\(/)
  assert.doesNotMatch(source, /function endedAtMs\s*\(/)
  assert.doesNotMatch(source, /function dayOf\s*\(/)
})

test('finder time output is byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/finder-probe.mjs', import.meta.url))
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
