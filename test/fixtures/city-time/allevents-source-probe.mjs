import { readFileSync } from 'node:fs'

import { fetchEvents } from '../../../finder/sources/tampa-bay/allevents.mjs'

const html = readFileSync(new URL('./sources/allevents.html', import.meta.url), 'utf8')
const events = await fetchEvents({
  nowMs: Date.parse('2026-03-08T05:30:00Z'),
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => html,
  }),
})

console.log(JSON.stringify(events))
