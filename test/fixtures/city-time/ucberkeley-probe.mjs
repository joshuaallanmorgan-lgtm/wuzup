import { readFileSync } from 'node:fs'

import { fetchEvents } from '../../../finder/sources/sf-east-bay/ucberkeley.mjs'

const xml = readFileSync(new URL('./sources/ucberkeley.xml', import.meta.url), 'utf8')
const nowMs = Date.parse('2026-03-08T08:30:00Z')

const originalWarn = console.warn
console.warn = () => {}
try {
  const events = await fetchEvents({
    nowMs,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => xml }),
  })
  console.log(JSON.stringify(events))
} finally {
  console.warn = originalWarn
}
