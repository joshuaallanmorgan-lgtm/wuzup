import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { fetchEvents as tampaMeetup } from '../finder/sources/tampa-bay/meetup.mjs'
import { fetchEvents as do813 } from '../finder/sources/tampa-bay/do813.mjs'
import { fetchEvents as dothebay } from '../finder/sources/sf-east-bay/dothebay.mjs'
import { fetchEvents as visitTampaBay } from '../finder/sources/tampa-bay/visittampabay.mjs'
import { fetchEvents as visitOakland } from '../finder/sources/sf-east-bay/visitoakland.mjs'
import { fetchEvents as ucBerkeley } from '../finder/sources/sf-east-bay/ucberkeley.mjs'
import { mapListingsForWindow } from '../finder/sources/tampa-bay/vspc.mjs'
import { fetchEvents as pinellas } from '../finder/sources/tampa-bay/pinellas.mjs'

const NOW = Date.parse('2026-03-08T08:30:00Z')
const textResponse = (text) => ({ ok: true, status: 200, text: async () => text })
const jsonResponse = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) })

test('fixture-backed Meetup, LiveWhale, and VSPC mappings retain native organizer/category evidence', async () => {
  const meetupFixture = await readFile(new URL('./fixtures/city-time/sources/meetup.html', import.meta.url), 'utf8')
  const meetupHtml = meetupFixture.replace(
    '"title":"Today meetup"',
    '"group":{"name":"Tampa Signal Group"},"title":"Today meetup"',
  )
  const meetupEvents = await tampaMeetup({
    nowMs: NOW,
    fetchImpl: async () => textResponse(meetupHtml),
    waitImpl: async () => {},
  })
  assert.equal(meetupEvents.find(event => event.title === 'Today meetup').organizer, 'Tampa Signal Group')

  const ucFixture = await readFile(new URL('./fixtures/city-time/sources/ucberkeley.xml', import.meta.url), 'utf8')
  const ucEvents = await ucBerkeley({ nowMs: NOW, fetchImpl: async () => textResponse(ucFixture) })
  assert.deepEqual(ucEvents.find(event => event.title === 'First boundary').rawCategories, ['Lectures'])

  const vspcFixture = JSON.parse(await readFile(new URL('./fixtures/city-time/sources/vspc.json', import.meta.url), 'utf8'))
  const vspcEvents = mapListingsForWindow(vspcFixture, { nowMs: Date.parse('2026-07-15T03:30:00Z') })
  assert.deepEqual(vspcEvents.map(event => event.rawCategories), [
    ['Sports & Recreation'],
    ['Civic'],
    ['Festivals'],
  ])
})

test('DoStuff, Simpleview, and Pinellas mappings retain bounded native categories', async () => {
  const tampaDo = await do813({
    nowMs: NOW,
    fetchImpl: async () => jsonResponse({
      events: [{ title: 'Do813 signal', begin_date: '2026-03-08', tz_adjusted_begin_date: '2026-03-08T12:00:00-04:00', permalink: '/signal', category: 'Live Music' }],
      paging: { total_pages: 1 },
    }),
  })
  assert.deepEqual(tampaDo[0].rawCategories, ['Live Music'])

  const sfDo = await dothebay({
    nowMs: NOW,
    fetchImpl: async () => jsonResponse({
      events: [{ title: 'DoTheBay signal', begin_date: '2026-03-08', tz_adjusted_begin_date: '2026-03-08T12:00:00-07:00', permalink: '/signal', category: 'Comedy', venue: { latitude: 37.77, longitude: -122.42 } }],
      paging: { total_pages: 1 },
    }),
  })
  assert.deepEqual(sfDo[0].rawCategories, ['Comedy'])

  const simpleviewFetch = (doc) => async (url) => String(url).includes('get_simple_token')
    ? textResponse('signal-token')
    : jsonResponse({ docs: { docs: [doc], count: 1 } })
  const tampaSimpleview = await visitTampaBay({
    nowMs: NOW,
    fetchImpl: simpleviewFetch({ title: 'Tampa Simpleview signal', date: '2026-03-10T03:59:59Z', startTime: '19:00:00', recurType: 1, categories: [{ catName: 'Concerts' }, { catName: 'Family Friendly' }] }),
  })
  assert.deepEqual(tampaSimpleview[0].rawCategories, ['Concerts', 'Family Friendly'])

  const oaklandSimpleview = await visitOakland({
    nowMs: NOW,
    fetchImpl: simpleviewFetch({ title: 'Oakland Simpleview signal', date: '2026-03-09T07:59:59Z', startTime: '19:00:00', recurType: 1, categories: [{ catName: 'Arts & Culture' }, { catName: 'FREE' }] }),
  })
  assert.deepEqual(oaklandSimpleview[0].rawCategories, ['Arts & Culture', 'FREE'])

  const pinellasEvents = await pinellas({
    nowMs: NOW,
    fetchImpl: async () => jsonResponse({
      events: [{ title: 'Pinellas signal', start_date: '2026-03-08 12:00:00', end_date: '2026-03-08 13:00:00', url: 'https://pinellas.gov/signal', categories: [{ name: 'Parks &amp; Recreation' }] }],
      total_pages: 1,
    }),
  })
  assert.deepEqual(pinellasEvents[0].rawCategories, ['Parks & Recreation'])
})

test('signal capture does not synthesize scheduled status', async () => {
  const events = await do813({
    nowMs: NOW,
    fetchImpl: async () => jsonResponse({
      events: [{ title: 'No status signal', begin_date: '2026-03-08', tz_adjusted_begin_date: '2026-03-08T12:00:00-04:00', permalink: '/no-status', category: 'Music' }],
      paging: { total_pages: 1 },
    }),
  })
  assert.equal(Object.hasOwn(events[0], 'status'), false)
})
