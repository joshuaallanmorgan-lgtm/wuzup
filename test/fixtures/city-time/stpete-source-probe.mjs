import { readFileSync } from 'node:fs'

import { mapStPeteRecords } from '../../../finder/sources/tampa-bay/stpete.mjs'

const fixture = JSON.parse(readFileSync(new URL('./sources/stpete.json', import.meta.url), 'utf8'))
const cases = {
  main: Date.parse('2026-03-01T05:30:00Z'),
  fold: Date.parse('2026-10-20T16:00:00Z'),
  year: Date.parse('2026-12-31T17:00:00Z'),
  leap: Date.parse('2028-01-20T17:00:00Z'),
  utc: Date.parse('2026-03-07T05:30:00Z'),
}

console.log(JSON.stringify(Object.fromEntries(
  Object.entries(cases).map(([key, nowMs]) => [key, mapStPeteRecords(fixture[key], { nowMs })]),
)))
