import { readFileSync } from 'node:fs'

import {
  mapListingsForWindow,
  pickTimesForDay,
} from '../../../finder/sources/tampa-bay/vspc.mjs'

const results = JSON.parse(readFileSync(new URL('./sources/vspc.json', import.meta.url), 'utf8'))
console.log(JSON.stringify({
  events: mapListingsForWindow(results, { nowMs: Date.parse('2026-07-15T03:30:00Z') }),
  summer: pickTimesForDay([
    { the_date: '2026-07-15', start_time: '9:00 pm', end_time: '9:30 pm' },
  ], '2026-07-15'),
  fold: pickTimesForDay([
    { the_date: '2026-11-01', start_time: '1:30 am', end_time: '1:45 am' },
  ], '2026-11-01'),
}))
