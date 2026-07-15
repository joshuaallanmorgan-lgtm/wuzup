import {
  calendarDistance,
  canonicalDayOf,
  finderEventState,
  finderEventTime,
  generationContext,
  publishedDayOf,
  selectLatestExplicitEnd,
} from '../../../finder/time.mjs'
import {
  addDaysStr,
  dayInTz,
  midnightInTz,
} from '../../../finder/sources/_shared.mjs'

const timeZone = 'America/New_York'
const nowMs = Date.parse('2026-07-15T05:30:00Z')
const equalRange = {
  start: '2026-07-15T19:00:00',
  end: '2026-07-15T19:00:00',
}
const reversed = {
  start: '2026-07-15T19:00:00-04:00',
  end: '2026-07-15T18:59:59-04:00',
}
const equalTime = finderEventTime(equalRange, { timeZone })

console.log(JSON.stringify({
  context: generationContext({ timeZone, nowMs }),
  equalTime,
  beforeEqualEnd: finderEventState(equalRange, { timeZone, nowMs: equalTime.endAt - 1 }),
  atEqualEnd: finderEventState(equalRange, { timeZone, nowMs: equalTime.endAt }),
  reversedEnd: selectLatestExplicitEnd([reversed], timeZone),
  reversedState: finderEventState(reversed, { timeZone, nowMs }),
  publishedDay: publishedDayOf('2026-07-15T01:00:00+02:00'),
  canonicalDay: canonicalDayOf('2026-07-15T01:00:00+02:00', timeZone),
  invalidPublishedDay: publishedDayOf('July 15, 2026 7:00 PM'),
  springDistance: calendarDistance('2026-03-08', '2026-03-09'),
  sourceDay: dayInTz(timeZone, nowMs),
  sourceMidnight: midnightInTz(timeZone, '2026-03-08').toISOString(),
  sourceTomorrow: addDaysStr('2026-03-08', 1),
}))
