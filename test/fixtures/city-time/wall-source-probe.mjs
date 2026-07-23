import { readFileSync } from 'node:fs'

import { fetchEvents as fetchTampa } from '../../../finder/sources/tampa-bay/visittampabay.mjs'
import { fetchEvents as fetchOakland } from '../../../finder/sources/sf-east-bay/visitoakland.mjs'
import { fetchEvents as fetchRecParks } from '../../../finder/sources/sf-east-bay/sfrecparks.mjs'

const tampaDocs = JSON.parse(readFileSync(new URL('./sources/visittampabay.json', import.meta.url), 'utf8'))
const oaklandDocs = JSON.parse(readFileSync(new URL('./sources/visitoakland.json', import.meta.url), 'utf8'))
const recParksXml = readFileSync(new URL('./sources/sfrecparks.xml', import.meta.url), 'utf8')

function simpleviewFetch(docs) {
  return async (url) => {
    if (String(url).includes('get_simple_token')) {
      return { ok: true, text: async () => 'fixture-token' }
    }
    return {
      ok: true,
      json: async () => ({ docs: { docs, count: docs.length } }),
    }
  }
}

const tampa = await fetchTampa({
  nowMs: Date.parse('2026-03-08T05:30:00Z'),
  fetchImpl: simpleviewFetch(tampaDocs),
})
const oakland = await fetchOakland({
  nowMs: Date.parse('2026-03-08T08:30:00Z'),
  fetchImpl: simpleviewFetch(oaklandDocs),
})
const recParks = await fetchRecParks({
  nowMs: Date.parse('2026-03-08T08:30:00Z'),
  fetchImpl: async () => ({ ok: true, text: async () => recParksXml }),
})

console.log(JSON.stringify({ tampa, oakland, recParks }))
