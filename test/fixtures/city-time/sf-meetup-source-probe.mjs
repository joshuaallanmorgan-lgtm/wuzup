import { readFileSync } from 'node:fs'

import { fetchEvents } from '../../../finder/sources/sf-east-bay/meetup.mjs'

const html = readFileSync(new URL('./sources/sf-meetup.html', import.meta.url), 'utf8')
const textResponse = (value) => ({ ok: true, status: 200, text: async () => value })
const nowMs = Date.parse('2026-03-08T08:30:00Z')
const originalFetch = globalThis.fetch
const originalWarn = console.warn

globalThis.fetch = async () => textResponse(html)
console.warn = () => {}
try {
  const events = await fetchEvents({
    nowMs,
    fetchImpl: async () => textResponse(html),
    waitImpl: async () => {},
  })
  console.log(JSON.stringify(events))
} finally {
  globalThis.fetch = originalFetch
  console.warn = originalWarn
}
