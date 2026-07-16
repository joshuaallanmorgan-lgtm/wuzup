import { readFileSync } from 'node:fs'

import { fetchEvents as fetchMeetup } from '../../../finder/sources/tampa-bay/meetup.mjs'
import { fetchEvents as fetchTampaGov } from '../../../finder/sources/tampa-bay/tampagov.mjs'
import { fetchEvents as fetchTrumba } from '../../../finder/sources/tampa-bay/trumba-ut.mjs'
import { fetchEvents as fetchWmnf } from '../../../finder/sources/tampa-bay/wmnf.mjs'

const text = (name) => readFileSync(new URL(`./sources/${name}`, import.meta.url), 'utf8')
const json = (name) => JSON.parse(text(name))
const jsonResponse = (value) => ({ ok: true, status: 200, json: async () => structuredClone(value) })
const textResponse = (value) => ({ ok: true, status: 200, text: async () => value })
const nowMs = Date.parse('2026-03-08T05:30:00Z')

const originalWarn = console.warn
console.warn = () => {}
try {
  const meetupHtml = text('meetup.html')
  const meetup = await fetchMeetup({
    nowMs,
    fetchImpl: async () => textResponse(meetupHtml),
    waitImpl: async () => {},
  })
  const tampagov = await fetchTampaGov({
    nowMs,
    fetchImpl: async () => textResponse(text('tampagov.xml')),
  })
  const trumba = await fetchTrumba({
    nowMs,
    fetchImpl: async () => jsonResponse(json('trumba-ut.json')),
  })
  const wmnfFixture = json('wmnf.json')
  const wmnf = await fetchWmnf({
    nowMs,
    fetchImpl: async (url) => String(url).endsWith('/events/42/datetimes')
      ? jsonResponse(wmnfFixture.detailsByEventId['42'])
      : jsonResponse(wmnfFixture.list),
  })
  console.log(JSON.stringify({ meetup, tampagov, trumba, wmnf }))
} finally {
  console.warn = originalWarn
}
