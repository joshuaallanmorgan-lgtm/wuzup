import { readFileSync } from 'node:fs'

import { fetchEvents } from '../../../finder/sources/sf-east-bay/dothebay.mjs'

const fixture = JSON.parse(readFileSync(new URL('./sources/dothebay.json', import.meta.url), 'utf8'))
const originalWarn = console.warn
console.warn = () => {}
try {
  const events = await fetchEvents({
    nowMs: Date.parse('2026-03-08T08:30:00Z'),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => structuredClone(fixture),
    }),
    waitImpl: async () => {},
  })
  console.log(JSON.stringify(events))
} finally {
  console.warn = originalWarn
}
