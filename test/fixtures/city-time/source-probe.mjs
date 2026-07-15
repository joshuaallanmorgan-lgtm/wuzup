import {
  sourceStartDay,
  sourceWindow,
} from '../../../finder/sources/_shared.mjs'

const timeZone = 'America/New_York'

console.log(JSON.stringify({
  springWindow: sourceWindow(timeZone, Date.parse('2026-03-08T06:30:00Z'), 2),
  fallWindow: sourceWindow(timeZone, Date.parse('2026-11-01T05:30:00Z'), 2),
  offsetDay: sourceStartDay(timeZone, '2026-07-15T01:00:00+02:00'),
  zonelessDay: sourceStartDay(timeZone, '2026-07-15T23:30:00'),
  dateOnlyDay: sourceStartDay(timeZone, '2026-07-15'),
  invalidDay: sourceStartDay(timeZone, 'July 15, 2026 7:00 PM'),
  nonexistentDay: sourceStartDay(timeZone, '2026-03-08T02:30:00'),
}))
