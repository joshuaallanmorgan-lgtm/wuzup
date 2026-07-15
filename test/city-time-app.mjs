import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  addDayTs,
  calendarDayDistance,
  currentEvents,
  cityHour,
  dayLabelLoose,
  dayNumber,
  dayTs,
  daysInCityMonth,
  eventLifecycle,
  formatDayTs,
  makeAnchors,
  monthStartTs,
  normalize,
  timeOf,
  weekdayIndex,
} from '../app/src/lib.js'
import { daypartOf, fitsDay } from '../app/src/weekend.js'
import { isOpenNow } from '../app/src/places.js'
import { dateKey } from '../app/src/weather.js'

const NOW_MS = Date.parse('2026-07-15T16:00:00Z')

test('app anchors and normalization project canonical Tampa city time', () => {
  const anchors = makeAnchors(NOW_MS)
  assert.equal(anchors.nowMs, NOW_MS)
  assert.equal(anchors.todayDay, '2026-07-15')
  assert.equal(anchors.tomorrowDay, '2026-07-16')
  assert.equal(new Date(anchors.todayTs).toISOString(), '2026-07-15T04:00:00.000Z')

  const active = normalize({
    id: 'evt_active',
    title: 'City-local evening',
    start: '2026-07-15T19:00:00',
  }, anchors)
  assert.equal(active._time.ok, true)
  assert.equal(active._time.startDay, '2026-07-15')
  assert.equal(new Date(active._t).toISOString(), '2026-07-15T23:00:00.000Z')
  assert.equal(active._day, anchors.todayTs)
  assert.equal(active._tonight, true)
  assert.equal(daypartOf(active), 'night')
  assert.equal(fitsDay(active, anchors.todayTs), true)
  assert.equal(active._actionable, true)
  assert.equal(timeOf(active.start), '7:00 PM')
  assert.equal(dayLabelLoose(active), 'Wed, Jul 15')

  const ended = normalize({
    id: 'evt_ended',
    title: 'Already over',
    start: '2026-07-15T07:00:00',
    end: '2026-07-15T08:00:00',
  }, anchors)
  assert.equal(ended._availability.code, 'ended')
  assert.equal(ended._actionable, false)
  assert.deepEqual(currentEvents([ended, active]).map((event) => event.id), ['evt_active'])
})

test('Tonight requires credible same-night evidence instead of range coverage alone', () => {
  const anchors = makeAnchors(NOW_MS)
  const allDay = normalize({ id: 'single-day', title: 'Today', start: '2026-07-15' }, anchors)
  const longDateRange = normalize({
    id: 'long-date',
    title: 'Long listing',
    start: '2026-07-01',
    end: '2026-09-01',
  }, anchors)
  const longTimedRange = normalize({
    id: 'long-timed',
    title: 'Aggregator range',
    start: '2026-07-01T09:00:00',
    end: '2026-09-01T17:00:00',
  }, anchors)
  const overnight = normalize({
    id: 'overnight',
    title: 'Late set',
    start: '2026-07-14T22:00:00',
    end: '2026-07-15T02:00:00',
  }, anchors)
  assert.equal(allDay._tonight, true)
  assert.equal(longDateRange._tonight, false)
  assert.equal(longTimedRange._tonight, false)
  assert.equal(overnight._tonight, true)
})
test('offset-bearing events use their city-projected day in app normalization', () => {
  const anchors = makeAnchors(NOW_MS)
  const event = normalize({
    id: 'evt_offset',
    title: 'Offset event',
    start: '2026-07-15T01:00:00+02:00',
  }, anchors)
  assert.equal(event._time.startDay, '2026-07-14')
  assert.equal(event._tonight, false)
  assert.equal(new Date(event._day).toISOString(), '2026-07-14T04:00:00.000Z')
})

test('app calendar helpers keep legacy numeric keys city-local across DST and month grids', () => {
  const anchors = makeAnchors(NOW_MS)
  assert.equal(addDayTs(anchors.todayTs, 1), anchors.tomorrowTs)
  assert.equal(formatDayTs(anchors.todayTs, { weekday: 'long', month: 'short', day: 'numeric' }), 'Wednesday, Jul 15')
  assert.equal(weekdayIndex(anchors.todayTs), 3)
  assert.equal(dayNumber(anchors.todayTs), 15)
  assert.equal(cityHour(NOW_MS), 12)
  assert.equal(new Date(monthStartTs(anchors.todayTs)).toISOString(), '2026-07-01T04:00:00.000Z')
  assert.equal(daysInCityMonth(anchors.todayTs), 31)
  const springStart = dayTs('2026-03-08')
  const springEnd = addDayTs(springStart, 1)
  assert.equal(calendarDayDistance(springStart, springEnd), 1)
  assert.equal(springEnd - springStart, 23 * 3600_000)
})

test('retained events expose honest lifecycle labels and cannot be re-planned', () => {
  const anchors = makeAnchors(NOW_MS)
  const active = normalize({ id: 'active', title: 'Active', start: '2026-07-15T19:00:00' }, anchors)
  const ended = normalize({
    id: 'ended',
    title: 'Ended',
    start: '2026-07-15T07:00:00',
    end: '2026-07-15T08:00:00',
  }, anchors)
  const cancelled = normalize({
    id: 'cancelled',
    title: 'Cancelled',
    start: '2026-07-16T19:00:00',
    status: 'cancelled',
  }, anchors)
  assert.deepEqual(eventLifecycle(active), { actionable: true, code: 'actionable', label: null })
  assert.deepEqual(eventLifecycle(ended), { actionable: false, code: 'ended', label: 'Happened' })
  assert.deepEqual(eventLifecycle(cancelled), { actionable: false, code: 'cancelled', label: 'Cancelled' })

  const cards = readFileSync(new URL('../app/src/cards.jsx', import.meta.url), 'utf8')
  assert.ok(cards.includes("e.kind !== 'place' && e._actionable !== true"))
  assert.ok(cards.includes('alreadyPlanned'))
  assert.ok(cards.includes('<span className="gem-lifecycle">'))
  const saves = readFileSync(new URL('../app/src/saves.js', import.meta.url), 'utf8')
  assert.ok(saves.includes('eventLifecycle(e)'))
  assert.ok(saves.includes('addDayTs(anchors.todayTs, -7)'))
  assert.doesNotMatch(saves, /anchors\.todayTs - 7 \* DAY|now - 6 \* DAY|now - DAY/)
  const page = readFileSync(new URL('../app/src/MySavesPage.jsx', import.meta.url), 'utf8')
  assert.ok(page.includes('lifecycle?.label'))
  const dayPage = readFileSync(new URL('../app/src/DayPage.jsx', import.meta.url), 'utf8')
  assert.ok(dayPage.includes('eventLifecycle(e)'))
  assert.ok(dayPage.includes('shareableEntries'))
  const calendar = readFileSync(new URL('../app/src/CalendarView.jsx', import.meta.url), 'utf8')
  assert.ok(calendar.includes('eventLifecycle(e).label'))
})
test('weather keys and Open Now use the city clock, including overnight ranges', () => {
  assert.equal(dateKey(Date.parse('2026-07-15T02:00:00Z')), '2026-07-14')
  const overnight = { hours: '8:00 PM-2:00 AM' }
  assert.equal(isOpenNow(overnight, {
    nowMs: Date.parse('2026-07-15T05:30:00Z'),
  }), true)
  assert.equal(isOpenNow(overnight, {
    nowMs: Date.parse('2026-07-15T07:00:00Z'),
  }), false)
  assert.equal(isOpenNow({ hours: '' }, { nowMs: NOW_MS }), false)
  assert.equal(isOpenNow({ hours: 'Su 10:15-14:00' }, {
    nowMs: Date.parse('2026-07-19T16:30:00Z'),
  }), false)
  assert.equal(isOpenNow({ hours: 'Monday - Friday 10 am - 8:30 pm' }, { nowMs: NOW_MS }), false)
  assert.equal(isOpenNow({ hours: 'Dawn to Dusk, Closed Wednesdays' }, { nowMs: NOW_MS }), false)
  assert.equal(isOpenNow({ hours: '24/7 off closed for summer cleaning' }, { nowMs: NOW_MS }), false)
})

test('app time projections are byte-identical across device timezones', () => {
  const probe = fileURLToPath(new URL('./fixtures/city-time/app-probe.mjs', import.meta.url))
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

test('App uses actionable discovery inventory while retained-value pages keep all events', () => {
  const source = readFileSync(new URL('../app/src/App.jsx', import.meta.url), 'utf8')
  assert.match(source, /const normalized = useMemo/)
  assert.match(source, /currentEvents\(normalized\)/)
  assert.match(source, /clock\.nextMidnightMs/)
  assert.match(source, /nextActionabilityMs/)
  assert.ok(source.includes('event?._actionable !== true'))
  assert.doesNotMatch(source, /endAt > nowMs/)
  assert.ok(source.includes("document.addEventListener('visibilitychange', onVis)\n    refresh()\n    scheduleMidnight()"))
  assert.doesNotMatch(source, /setInterval\(refresh/)
  assert.match(source, /<CalendarView events=\{normalized\}/)
  assert.match(source, /page\.type === 'myplans'.*events=\{normalized\}/s)
  assert.match(source, /<HomeView events=\{norm\}/)
  assert.match(source, /<SearchPage events=\{norm\}/)
  assert.match(source, /<DayPage[^>]*events=\{normalized\}[^>]*availableEvents=\{norm\}/s)
  const dayPage = readFileSync(new URL('../app/src/DayPage.jsx', import.meta.url), 'utf8')
  assert.match(dayPage, /availableEvents\.filter/)
  assert.match(dayPage, /x\.e\.kind === 'place' \|\| x\.e\._actionable === true/)
  assert.match(dayPage, /for \(const e of events\) m\.set/)
  assert.doesNotMatch(dayPage, /const list = events\.filter/)
})

test('city-day UI consumers cannot reintroduce host-local calendar math', () => {
  const files = [
    'AddEvent.jsx', 'CalendarPickerPage.jsx', 'CalendarView.jsx', 'DayPage.jsx', 'DetailPage.jsx', 'ForecastPage.jsx',
    'HomeView.jsx', 'HotView.jsx', 'MyPlansPage.jsx', 'NextDays.jsx', 'NotificationsPage.jsx', 'PlaceDetail.jsx',
    'SettingsPage.jsx', 'cards.jsx', 'coverage.js', 'dayplan.js', 'gamify.js', 'guides.js', 'places.js', 'saves.js', 'search.js', 'share.js', 'weather.js', 'weekend.js',
  ]
  const hostLocal = /new Date\(|\.get(?:Day|Date|Month|FullYear|Hours)\(|\.setHours\(|toLocaleDateString|\+\s*i\s*\*\s*DAY_MS/
  for (const file of files) {
    const source = readFileSync(new URL('../app/src/' + file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, hostLocal, file + ' must use the city calendar contract')
  }
})
