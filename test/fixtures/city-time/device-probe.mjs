import {
  cityClock,
  daypartOfTime,
  eventAvailability,
  eventTime,
} from '../../../shared/city-time.mjs'

const timeZone = 'America/New_York'
const nowMs = Date.parse('2026-07-15T05:30:00Z')
const dateOnly = eventTime({ start: '2026-03-08' }, { timeZone })
const zoneless = eventTime({ start: '2026-07-15T19:00:00' }, { timeZone })
const offset = eventTime({ start: '2026-07-15T01:00:00+02:00' }, { timeZone })

process.stdout.write(JSON.stringify({
  clock: cityClock({ timeZone, nowMs }),
  dateOnly,
  zoneless,
  zonelessPart: daypartOfTime(zoneless),
  offset,
  availability: eventAvailability(zoneless, { nowMs }),
}))
