import assert from 'node:assert/strict'
import test from 'node:test'
import { dayTs } from '../app/src/lib.js'
import { eventIcs, eventsIcs, shareDayText, vevent } from '../app/src/share.js'

const NOW_MS = Date.parse('2026-07-15T16:00:00Z')

const timed = {
  id: 'evt-vinyl',
  title: 'Vinyl Night',
  start: '2026-06-13T19:00:00',
  venue: 'The Attic',
}

test('timed ICS uses the city TZID, canonical end, stable id, and injected stamp', () => {
  const ics = eventIcs(timed, { nowMs: NOW_MS })
  assert.match(ics, /UID:evt-vinyl@wuzup-tampa-bay/)
  assert.match(ics, /DTSTAMP:20260715T160000Z/)
  assert.match(ics, /DTSTART;TZID=America\/New_York:20260613T190000/)
  assert.match(ics, /DTEND;TZID=America\/New_York:20260613T220000/)
  assert.match(ics, /SUMMARY:Vinyl Night/)

  const changed = eventIcs({ ...timed, title: 'Changed', start: '2026-06-14T20:00:00' }, { nowMs: NOW_MS })
  assert.match(changed, /UID:evt-vinyl@wuzup-tampa-bay/)
})

test('ICS projects offsets and canonical explicit or inferred timed ends into the city', () => {
  const offset = eventIcs({
    id: 'evt-offset',
    title: 'Offset',
    start: '2026-06-13T23:00:00Z',
    end: '2026-06-14T01:00:00Z',
  }, { nowMs: NOW_MS })
  assert.match(offset, /DTSTART;TZID=America\/New_York:20260613T190000/)
  assert.match(offset, /DTEND;TZID=America\/New_York:20260613T210000/)

  const overnight = eventIcs({
    id: 'evt-overnight',
    title: 'Late set',
    start: '2026-06-13T22:00:00',
    end: '2026-06-13T02:00:00',
  }, { nowMs: NOW_MS })
  assert.match(overnight, /DTEND;TZID=America\/New_York:20260614T020000/)
})

test('all-day ICS uses an exclusive day after the canonical inclusive end', () => {
  const one = eventIcs({ id: 'evt-day', title: 'Art Walk', start: '2026-06-14' }, { nowMs: NOW_MS })
  assert.match(one, /DTSTART;VALUE=DATE:20260614/)
  assert.match(one, /DTEND;VALUE=DATE:20260615/)

  const many = eventIcs({ id: 'evt-days', title: 'Festival', start: '2026-06-14', end: '2026-06-16' }, { nowMs: NOW_MS })
  assert.match(many, /DTEND;VALUE=DATE:20260617/)
})

test('invalid or dateless inventory fails closed and multi-event stamps are coherent', () => {
  const invalid = [
    null,
    { kind: 'place', title: 'Park' },
    { title: 'Gap', start: '2026-03-08T02:30:00' },
    { title: 'Mixed', start: '2026-06-13', end: '2026-06-13T19:00:00' },
    { title: 'Reversed', start: '2026-06-13T20:00:00Z', end: '2026-06-13T19:00:00Z' },
  ]
  for (const event of invalid) assert.equal(vevent(event, { nowMs: NOW_MS }), null)
  for (const event of invalid) assert.doesNotMatch(eventIcs(event, { nowMs: NOW_MS }), /BEGIN:VEVENT/)

  const ics = eventsIcs([timed, { id: 'evt-day', title: 'Art Walk', start: '2026-06-14' }, ...invalid], { nowMs: NOW_MS })
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2)
  assert.equal((ics.match(/DTSTAMP:20260715T160000Z/g) || []).length, 2)
  assert.doesNotMatch(eventsIcs(null, { nowMs: NOW_MS }), /BEGIN:VEVENT/)
})

test('fallback UIDs remain deterministic and UTF-8 lines fold at 75 octets', () => {
  const bare = { title: 'No id', start: '2026-06-13T19:00:00' }
  const first = eventIcs(bare, { nowMs: NOW_MS })
  const again = eventIcs({ ...bare }, { nowMs: NOW_MS })
  assert.equal(first.match(/UID:([^\r\n]+)/)[1], again.match(/UID:([^\r\n]+)/)[1])
  const moved = eventIcs({ ...bare, start: '2026-06-13T20:00:00' }, { nowMs: NOW_MS })
  assert.notEqual(first.match(/UID:([^\r\n]+)/)[1], moved.match(/UID:([^\r\n]+)/)[1])

  const title = 'X' + '\u{1F3AD}'.repeat(40) + ' Caf?'
  const ics = eventIcs({ id: 'evt-long', title, start: '2026-06-13T19:00:00' }, { nowMs: NOW_MS })
  const physical = ics.split('\r\n')
  assert.ok(physical.some((line) => line.startsWith(' ')))
  for (const line of physical) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line)
  const summary = physical.slice(physical.findIndex((line) => line.startsWith('SUMMARY:')))
    .reduce((out, line, index) => index && line.startsWith(' ') ? out + line.slice(1) : index ? out : line, '')
  assert.equal(summary, 'SUMMARY:' + title)
})

test('day share headers use the city calendar rather than the device timezone', () => {
  const text = shareDayText(dayTs('2026-06-13'), [{ part: 'night', e: timed }])
  assert.match(text, /^My plan for Saturday, Jun 13/)
  assert.equal(shareDayText(dayTs('2026-06-13'), []), null)
})
