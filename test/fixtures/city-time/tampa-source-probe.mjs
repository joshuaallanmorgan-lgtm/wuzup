import { readFileSync } from 'node:fs'

import { fetchEvents as fetchDo813 } from '../../../finder/sources/tampa-bay/do813.mjs'
import { fetchEvents as fetchDontTell } from '../../../finder/sources/tampa-bay/donttellcomedy.mjs'
import { fetchEvents as fetchHcplc } from '../../../finder/sources/tampa-bay/hcplc.mjs'
import { fetchEvents as fetchPinellas } from '../../../finder/sources/tampa-bay/pinellas.mjs'

const read = (name) => readFileSync(new URL(`./sources/${name}`, import.meta.url), 'utf8')
const json = (name) => JSON.parse(read(name))
const responseJson = (value) => ({ ok: true, status: 200, json: async () => structuredClone(value) })
const responseText = (value) => ({ ok: true, status: 200, text: async () => value })
const dstNowMs = Date.parse('2026-03-08T05:30:00Z')

const originalWarn = console.warn
console.warn = () => {}
try {
  const do813 = await fetchDo813({
    nowMs: dstNowMs,
    fetchImpl: async () => responseJson(json('do813.json')),
  })
  const dontTellHtml = read('donttellcomedy.html')
  const dontTell = await fetchDontTell({
    nowMs: Date.parse('2026-12-31T05:30:00Z'),
    fetchImpl: async () => responseText(dontTellHtml),
  })
  const hcplc = await fetchHcplc({
    nowMs: dstNowMs,
    fetchImpl: async () => responseJson(json('hcplc.json')),
  })
  const pinellasPages = json('pinellas.json')
  const pinellas = await fetchPinellas({
    nowMs: dstNowMs,
    fetchImpl: async (url) => {
      const page = Number(new URL(String(url)).searchParams.get('page'))
      return responseJson(pinellasPages[page - 1])
    },
  })
  console.log(JSON.stringify({ do813, dontTell, hcplc, pinellas }))
} finally {
  console.warn = originalWarn
}
