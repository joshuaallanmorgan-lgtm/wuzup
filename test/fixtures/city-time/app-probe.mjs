import {
  dayLabelLoose,
  dayTs,
  makeAnchors,
  normalize,
  timeOf,
} from '../../../app/src/lib.js'
import { daypartOf, fitsDay } from '../../../app/src/weekend.js'
import { isOpenNow } from '../../../app/src/places.js'
import { dateKey } from '../../../app/src/weather.js'
import { eventIcs, shareDayText } from '../../../app/src/share.js'

import { parseQuery } from '../../../app/src/search.js'
const anchors = makeAnchors(Date.parse('2026-07-15T16:00:00Z'))
const local = normalize({
  id: 'local',
  title: 'Local',
  start: '2026-07-15T19:00:00',
}, anchors)
const offset = normalize({
  id: 'offset',
  title: 'Offset',
  start: '2026-07-15T01:00:00+02:00',
}, anchors)

process.stdout.write(JSON.stringify({
  anchors,
  weatherDay: dateKey(Date.parse('2026-07-15T02:00:00Z')),
  saturday: parseQuery('saturday', anchors).days[0],
  overnightOpen: isOpenNow({ hours: '8:00 PM-2:00 AM' }, { nowMs: Date.parse('2026-07-15T05:30:00Z') }),
  ics: eventIcs(local, { nowMs: Date.parse('2026-07-15T16:00:00Z') }),
  share: shareDayText(dayTs('2026-07-15'), [{ part: 'night', e: local }]),
  local: {
    time: local._time,
    day: local._day,
    part: daypartOf(local),
    fitsToday: fitsDay(local, anchors.todayTs),
    t: local._t,
    tonight: local._tonight,
    label: dayLabelLoose(local),
    clock: timeOf(local.start),
  },
  offset: {
    time: offset._time,
    part: daypartOf(offset),
    fitsToday: fitsDay(offset, anchors.todayTs),
    day: offset._day,
    t: offset._t,
    tonight: offset._tonight,
    label: dayLabelLoose(offset),
    clock: timeOf(offset.start),
  },
}))
