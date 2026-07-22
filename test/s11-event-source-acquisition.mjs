import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { fetchEvents as fetchAllEvents } from '../finder/sources/tampa-bay/allevents.mjs'
import { fetchEvents as fetchDo813 } from '../finder/sources/tampa-bay/do813.mjs'
import { fetchEvents as fetchDontTell } from '../finder/sources/tampa-bay/donttellcomedy.mjs'
import { fetchEvents as fetchTampaMeetup } from '../finder/sources/tampa-bay/meetup.mjs'
import { fetchEvents as fetchPinellas } from '../finder/sources/tampa-bay/pinellas.mjs'
import { fetchEvents as fetchStPete } from '../finder/sources/tampa-bay/stpete.mjs'
import { fetchEvents as fetchTampaGov } from '../finder/sources/tampa-bay/tampagov.mjs'
import { fetchEvents as fetchVisitTampa } from '../finder/sources/tampa-bay/visittampabay.mjs'
import { fetchEvents as fetchVspc } from '../finder/sources/tampa-bay/vspc.mjs'
import { fetchEvents as fetchWmnf } from '../finder/sources/tampa-bay/wmnf.mjs'
import { fetchEvents as fetchDoTheBay } from '../finder/sources/sf-east-bay/dothebay.mjs'
import { fetchEvents as fetchRecParks } from '../finder/sources/sf-east-bay/sfrecparks.mjs'
import { fetchEvents as fetchUcBerkeley } from '../finder/sources/sf-east-bay/ucberkeley.mjs'
import { fetchEvents as fetchVisitOakland } from '../finder/sources/sf-east-bay/visitoakland.mjs'

const TAMPA_NOW = Date.parse('2026-03-08T05:30:00Z')
const SF_NOW = Date.parse('2026-03-08T08:30:00Z')
const fixture = (name) => readFileSync(
  new URL(`./fixtures/city-time/sources/${name}`, import.meta.url),
  'utf8',
)
const okText = (body) => ({ ok: true, status: 200, text: async () => body })
const okJson = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) })
const failed = (status = 503) => ({ ok: false, status, text: async () => '' })

const ucEpoch = (iso) => Math.floor(Date.parse(iso) / 1000)
const ucRow = (id, iso, title = `UC event ${id}`) => ({
  id,
  title,
  date_ts: ucEpoch(iso),
})
const ucPage = ({ page, totalResults, perPage, rows, totalPages = Math.max(1, Math.ceil(totalResults / perPage)) }) => ({
  meta: {
    total_results: totalResults,
    per_page: perPage,
    page,
    total_pages: totalPages,
  },
  data: rows,
})
const ucRssItem = ({ id, iso, title = `UC event ${id}` }) => `
  <item>
    <title>${title}</title>
    <link>https://events.berkeley.edu/event/${id}</link>
    <pubDate>${new Date(iso).toUTCString()}</pubDate>
    <livewhale:id>${id}</livewhale:id>
    <georss:featurename>Durant Hall</georss:featurename>
    <livewhale:categories>Lectures</livewhale:categories>
    <livewhale:categories_audience>Public</livewhale:categories_audience>
    <livewhale:image_full>https://events.berkeley.edu/image/${id}.jpg</livewhale:image_full>
    <description><![CDATA[<p>Rich description ${id}</p>]]></description>
  </item>`
const ucRss = (rows) => `<rss><channel>${rows.map(ucRssItem).join('')}</channel></rss>`
const ucStrictFetch = ({ pages, rss, requests = [] }) => async (url) => {
  const href = String(url)
  requests.push(href)
  if (href.includes('/live/json/events')) {
    const page = Number(new URL(href).searchParams.get('page'))
    const body = pages[page - 1]
    return body ? okJson(body) : failed(404)
  }
  if (href.includes('/live/rss/events')) return okText(rss)
  return failed(404)
}

test('finder strict mode loads only the configured event roster and never accepts its outer cache', () => {
  const finder = readFileSync(new URL('../finder/finder.mjs', import.meta.url), 'utf8')
  assert.match(finder, /loadEventSources\(\{[^}]*moduleIds: eventSourceModules,[^}]*requireLive: requireLiveSources/s)
  assert.doesNotMatch(finder, /readdirSync/)
  assert.equal((finder.match(/if \(!requireLiveSources && existsSync\(cacheFile\)\)/g) || []).length, 1)
  assert.match(finder, /requireLiveSources && nodes\.length === 0/)
  const contract = readFileSync(new URL('../finder/event-source-contract.mjs', import.meta.url), 'utf8')
  assert.match(contract, /requireLive && raw\.length === 0/)
  assert.match(contract, /requireLive && mapped\.length === 0/)
  const trumba = readFileSync(new URL('../finder/sources/tampa-bay/trumba-ut.mjs', import.meta.url), 'utf8')
  assert.match(trumba, /if \(requireLive\) throw new Error\(`\[\$\{name\}\] required item mapping failed/)
})

test('St Pete strict acquisition bypasses a fresh internal cache and rejects live failure', async () => {
  const fresh = {
    fetchedAt: new Date(TAMPA_NOW - 1000).toISOString(),
    windowDay: '2026-03-08',
    events: [{ title: 'cached row' }],
  }
  let calls = 0
  await assert.rejects(
    fetchStPete({
      nowMs: TAMPA_NOW,
      requireLive: true,
      readCacheImpl: async () => fresh,
      writeCacheImpl: async () => {},
      fetchImpl: async () => {
        calls++
        return failed()
      },
    }),
    /HTTP 503/,
  )
  assert.equal(calls, 1)

  const ordinary = await fetchStPete({
    nowMs: TAMPA_NOW,
    readCacheImpl: async () => fresh,
    fetchImpl: async () => {
      throw new Error('fresh cache should avoid transport')
    },
  })
  assert.deepEqual(ordinary, fresh.events)
})

test('strict multi-listing adapters reject a later failed request instead of returning partial rows', async () => {
  const allEventsHtml = fixture('allevents.html')
  let allEventsCalls = 0
  await assert.rejects(
    fetchAllEvents({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => (++allEventsCalls === 2 ? failed() : okText(allEventsHtml)),
    }),
    /required listing failed/,
  )
  assert.equal(allEventsCalls, 2)

  const meetupHtml = fixture('meetup.html')
  let meetupCalls = 0
  await assert.rejects(
    fetchTampaMeetup({
      nowMs: TAMPA_NOW,
      requireLive: true,
      waitImpl: async () => {},
      fetchImpl: async () => (++meetupCalls === 2 ? failed() : okText(meetupHtml)),
    }),
    /required listing failed/,
  )
  assert.equal(meetupCalls, 2)

  const dontTellHtml = fixture('donttellcomedy.html')
  let dontTellCalls = 0
  await assert.rejects(
    fetchDontTell({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => (++dontTellCalls === 2 ? failed() : okText(dontTellHtml)),
    }),
    /required city page failed/,
  )
  assert.equal(dontTellCalls, 2)
})

test('strict paginated DoStuff adapters reject page-two failure after page-one success', async () => {
  const tampaPage = {
    events: [{ title: 'Tampa live row', begin_date: '2026-03-08', tz_adjusted_begin_date: '2026-03-08T12:00:00-04:00', permalink: '/live' }],
    paging: { count: 26, total_pages: 2 },
  }
  let tampaCalls = 0
  await assert.rejects(
    fetchDo813({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => (++tampaCalls === 1 ? okJson(tampaPage) : failed()),
    }),
    /required page 2 failed/,
  )

  await assert.rejects(
    fetchDo813({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => okJson({ events: tampaPage.events }),
    }),
    /missing valid paging\.total_pages/,
  )

  const sfPage = {
    events: [{ title: 'SF live row', begin_date: '2026-03-08', tz_adjusted_begin_date: '2026-03-08T12:00:00-07:00', permalink: '/live' }],
    paging: { count: 26, total_pages: 2 },
  }
  let sfCalls = 0
  await assert.rejects(
    fetchDoTheBay({
      nowMs: SF_NOW,
      requireLive: true,
      waitImpl: async () => {},
      fetchImpl: async () => (++sfCalls === 1 ? okJson(sfPage) : failed()),
    }),
    /required page 2 failed/,
  )

  const repeatedRows = Array.from({ length: 25 }, (_, index) => ({
    title: `Row ${index}`,
    begin_date: '2026-03-08',
    tz_adjusted_begin_date: '2026-03-08T12:00:00-04:00',
    permalink: `/row-${index}`,
  }))
  let repeatedCalls = 0
  await assert.rejects(
    fetchDo813({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => {
        repeatedCalls++
        return okJson({
          events: repeatedCalls === 1 ? repeatedRows : [repeatedRows[0]],
          paging: { count: 26, total_pages: 2 },
        })
      },
    }),
    /duplicate raw row across live pages/,
  )
})

test('strict Pinellas acquisition rejects a failed later page', async () => {
  let calls = 0
  await assert.rejects(
    fetchPinellas({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => {
        calls++
        return calls === 1
          ? okJson({ events: [], total_pages: 2, next_rest_url: '/page/2' })
          : failed()
      },
    }),
    /HTTP 503 on page 2/,
  )
  assert.equal(calls, 2)

  await assert.rejects(
    fetchPinellas({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => okJson({ events: [], total_pages: 2 }),
    }),
    /omitted next_rest_url/,
  )
})

function incompleteSimpleviewFetch() {
  const docs = Array.from({ length: 50 }, (_, index) => ({ recid: index }))
  let calls = 0
  return {
    count: () => calls,
    fetchImpl: async (url) => {
      calls++
      if (String(url).includes('get_simple_token')) return okText('fixture-token')
      return okJson({ docs: { docs, count: 501 } })
    },
  }
}

test('strict Simpleview adapters reject capped partial result sets', async () => {
  const tampa = incompleteSimpleviewFetch()
  await assert.rejects(
    fetchVisitTampa({ nowMs: TAMPA_NOW, requireLive: true, fetchImpl: tampa.fetchImpl }),
    /live result incomplete \(500 of 501 docs\)/,
  )
  assert.equal(tampa.count(), 11)

  const oakland = incompleteSimpleviewFetch()
  await assert.rejects(
    fetchVisitOakland({ nowMs: SF_NOW, requireLive: true, fetchImpl: oakland.fetchImpl }),
    /live result incomplete \(500 of 501 docs\)/,
  )
  assert.equal(oakland.count(), 11)

  const missingCount = async (url) => String(url).includes('get_simple_token')
    ? okText('fixture-token')
    : okJson({ docs: { docs: [{ recid: 1 }] } })
  await assert.rejects(
    fetchVisitTampa({ nowMs: TAMPA_NOW, requireLive: true, fetchImpl: missingCount }),
    /missing a valid docs\.count/,
  )
  await assert.rejects(
    fetchVisitOakland({ nowMs: SF_NOW, requireLive: true, fetchImpl: missingCount }),
    /missing a valid docs\.count/,
  )
})

test('strict UC Berkeley pages the authoritative inventory and keeps rich RSS fields', async () => {
  const first = { id: 91, iso: '2026-03-08T10:00:00Z', title: 'First occurrence' }
  const repeat = { id: 91, iso: '2026-03-09T10:00:00Z', title: 'First occurrence' }
  const third = { id: 92, iso: '2026-03-10T18:30:00Z', title: 'Third occurrence' }
  const requests = []
  const events = await fetchUcBerkeley({
    nowMs: SF_NOW,
    requireLive: true,
    fetchImpl: ucStrictFetch({
      pages: [
        ucPage({ page: 1, totalResults: 3, perPage: 2, rows: [ucRow(first.id, first.iso, first.title), ucRow(repeat.id, repeat.iso, repeat.title)] }),
        ucPage({ page: 2, totalResults: 3, perPage: 2, rows: [ucRow(third.id, third.iso, third.title)] }),
      ],
      rss: ucRss([first, repeat, third]),
      requests,
    }),
  })

  assert.deepEqual(requests, [
    'https://events.berkeley.edu/live/json/events?page=1',
    'https://events.berkeley.edu/live/json/events?page=2',
    'https://events.berkeley.edu/live/rss/events',
  ])
  assert.equal(events.length, 3)
  assert.deepEqual(events[0], {
    title: 'First occurrence',
    start: '2026-03-08T03:00:00-07:00',
    end: null,
    venue: 'Durant Hall',
    address: null,
    price: null,
    isFree: null,
    lat: null,
    lng: null,
    url: 'https://events.berkeley.edu/event/91',
    image: 'https://events.berkeley.edu/image/91.jpg',
    description: 'Rich description 91',
    category: 'community',
    source: 'UC Berkeley',
    rawCategories: ['Lectures'],
  })
})

test('strict UC Berkeley rejects oversized metadata, pagination drift, incomplete pages, and duplicate occurrences', async () => {
  const first = ucRow(101, '2026-03-08T12:00:00Z')
  const second = ucRow(102, '2026-03-09T12:00:00Z')
  const third = ucRow(103, '2026-03-10T12:00:00Z')

  const oversizedRequests = []
  await assert.rejects(
    fetchUcBerkeley({
      nowMs: SF_NOW,
      requireLive: true,
      fetchImpl: ucStrictFetch({
        pages: [ucPage({
          page: 1,
          totalResults: 5001,
          perPage: 100,
          totalPages: 51,
          rows: [],
        })],
        rss: '<rss></rss>',
        requests: oversizedRequests,
      }),
    }),
    /metadata exceeded acquisition bounds \(51 pages, 5001 rows\)/,
  )
  assert.deepEqual(oversizedRequests, ['https://events.berkeley.edu/live/json/events?page=1'])

  await assert.rejects(
    fetchUcBerkeley({
      nowMs: SF_NOW,
      requireLive: true,
      fetchImpl: ucStrictFetch({
        pages: [
          ucPage({ page: 1, totalResults: 3, perPage: 2, rows: [first, second] }),
          ucPage({ page: 2, totalResults: 4, perPage: 2, rows: [third, ucRow(104, '2026-03-11T12:00:00Z')] }),
        ],
        rss: '<rss></rss>',
      }),
    }),
    /meta\/count drift/,
  )

  await assert.rejects(
    fetchUcBerkeley({
      nowMs: SF_NOW,
      requireLive: true,
      fetchImpl: ucStrictFetch({
        pages: [
          ucPage({ page: 1, totalResults: 3, perPage: 2, rows: [first, second] }),
          ucPage({ page: 2, totalResults: 3, perPage: 2, rows: [] }),
        ],
        rss: '<rss></rss>',
      }),
    }),
    /page 2 was incomplete \(0 of 1 rows\)/,
  )

  await assert.rejects(
    fetchUcBerkeley({
      nowMs: SF_NOW,
      requireLive: true,
      fetchImpl: ucStrictFetch({
        pages: [
          ucPage({ page: 1, totalResults: 3, perPage: 2, rows: [first, second] }),
          ucPage({ page: 2, totalResults: 3, perPage: 2, rows: [first] }),
        ],
        rss: '<rss></rss>',
      }),
    }),
    /duplicate occurrence .* across live JSON pages/,
  )
})

test('strict UC Berkeley fails closed when capped RSS omits an authoritative in-window occurrence', async () => {
  const first = { id: 201, iso: '2026-03-08T12:00:00Z' }
  const missing = { id: 202, iso: '2026-03-09T12:00:00Z' }
  await assert.rejects(
    fetchUcBerkeley({
      nowMs: SF_NOW,
      requireLive: true,
      fetchImpl: ucStrictFetch({
        pages: [ucPage({
          page: 1,
          totalResults: 2,
          perPage: 2,
          rows: [ucRow(first.id, first.iso), ucRow(missing.id, missing.iso)],
        })],
        rss: ucRss([first]),
      }),
    }),
    /live RSS omitted authoritative in-window occurrence 202:/,
  )
})

test('strict UC Berkeley accepts a 1000-row RSS cap when its whole product window reconciles', async () => {
  const occurrences = Array.from({ length: 1000 }, (_, index) => ({
    id: 1000 + index,
    iso: new Date(Date.parse('2026-03-08T09:00:00Z') + (index * 60000)).toISOString(),
  }))
  const events = await fetchUcBerkeley({
    nowMs: SF_NOW,
    requireLive: true,
    fetchImpl: ucStrictFetch({
      pages: [ucPage({
        page: 1,
        totalResults: 1000,
        perPage: 1000,
        rows: occurrences.map(({ id, iso }) => ucRow(id, iso)),
      })],
      rss: ucRss(occurrences),
    }),
  })
  assert.equal(events.length, 1000)
})

test('strict RSS adapters reject an unrecognized empty document', async () => {
  const fetchImpl = async () => okText('<html>not an RSS feed</html>')
  await assert.rejects(
    fetchTampaGov({ nowMs: TAMPA_NOW, requireLive: true, fetchImpl }),
    /live RSS contained no <item>/,
  )
  await assert.rejects(
    fetchRecParks({ nowMs: SF_NOW, requireLive: true, fetchImpl }),
    /live RSS contained no <item>/,
  )
  await assert.rejects(
    fetchUcBerkeley({
      nowMs: SF_NOW,
      requireLive: true,
      fetchImpl: ucStrictFetch({
        pages: [ucPage({ page: 1, totalResults: 0, perPage: 100, rows: [] })],
        rss: '<html>not an RSS feed</html>',
      }),
    }),
    /live RSS contained no <item>/,
  )
})

test('strict WMNF acquisition rejects a failed required datetime detail request', async () => {
  let calls = 0
  await assert.rejects(
    fetchWmnf({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => {
        calls++
        return calls === 1
          ? okJson([{ EVT_ID: 7, EVT_name: 'Live event', datetimes: [] }])
          : failed()
      },
    }),
    /required event mapping failed.*HTTP 503/s,
  )
  assert.equal(calls, 2)

  await assert.rejects(
    fetchWmnf({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => okJson(Array.from({ length: 50 }, () => ({}))),
    }),
    /saturated its 50-row request cap/,
  )

  calls = 0
  await assert.rejects(
    fetchWmnf({
      nowMs: TAMPA_NOW,
      requireLive: true,
      fetchImpl: async () => {
        calls++
        return calls === 1
          ? okJson([{ EVT_ID: 8, EVT_name: 'Bad detail shape', datetimes: [] }])
          : okJson({ dates: [] })
      },
    }),
    /datetime response for EVT 8 was not an array/,
  )
})

test('VSPC refuses its cache-only switch when live acquisition is required', async () => {
  const previous = process.env.SKIP_RENDER
  process.env.SKIP_RENDER = '1'
  try {
    await assert.rejects(
      fetchVspc({ nowMs: TAMPA_NOW, requireLive: true }),
      /cannot satisfy requireLive/,
    )
  } finally {
    if (previous === undefined) delete process.env.SKIP_RENDER
    else process.env.SKIP_RENDER = previous
  }
})
