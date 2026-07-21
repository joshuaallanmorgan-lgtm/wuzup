import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ageForecastState,
  createForecastClient,
  WEATHER_CACHE_MAX_AGE_MS,
  WEATHER_FRESH_MAX_AGE_MS,
  WEATHER_STATUS,
} from '../app/src/weather.js'

const NOW = Date.parse('2026-07-20T16:00:00.000Z')
const DAY = '2026-07-20'
const DATA = {
  [DAY]: { emoji: '☀️', hi: 86, lo: 70, rain: 10 },
}
const PAYLOAD = {
  daily: {
    time: [DAY],
    weather_code: [0],
    temperature_2m_max: [30],
    temperature_2m_min: [21],
    precipitation_probability_max: [10],
  },
}

function cacheHarness(value = null) {
  let raw = value
  let removals = 0
  return {
    cacheGet: () => raw,
    cacheSet: (next) => {
      raw = next
      return true
    },
    cacheRemove: () => {
      raw = null
      removals += 1
      return true
    },
    raw: () => raw,
    removals: () => removals,
  }
}

function receipt(fetchedAt, data = DATA) {
  return JSON.stringify({ fetchedAt, data })
}

function client(cache, overrides = {}) {
  return createForecastClient({
    ...cache,
    now: () => NOW,
    isOnline: () => true,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => PAYLOAD }),
    ...overrides,
  })
}

test('fresh weather cache is explicit and avoids the network', async () => {
  const cache = cacheHarness(receipt(NOW - WEATHER_FRESH_MAX_AGE_MS + 1))
  let fetches = 0
  const getForecast = client(cache, {
    fetchImpl: async () => {
      fetches += 1
      throw new Error('fresh cache should short-circuit')
    },
  })

  const state = await getForecast()
  assert.equal(state.status, 'fresh')
  assert.equal(state.source, 'cache')
  assert.equal(state.fetchedAt, NOW - WEATHER_FRESH_MAX_AGE_MS + 1)
  assert.deepEqual(state.data, DATA)
  assert.equal(state.error, null)
  assert.equal(fetches, 0)
})

test('a verified network response becomes fresh and refreshes the receipt', async () => {
  const cache = cacheHarness()
  const state = await client(cache)()

  assert.equal(state.status, 'fresh')
  assert.equal(state.source, 'network')
  assert.equal(state.fetchedAt, NOW)
  assert.deepEqual(state.data, DATA)
  assert.deepEqual(JSON.parse(cache.raw()), { fetchedAt: NOW, data: DATA })
})

test('network failure exposes only a bounded, explicitly stale fallback', async () => {
  const fetchedAt = NOW - WEATHER_FRESH_MAX_AGE_MS
  const cache = cacheHarness(receipt(fetchedAt))
  const getForecast = client(cache, {
    fetchImpl: async () => {
      throw new TypeError('network failed')
    },
  })

  const state = await getForecast()
  assert.equal(state.status, 'stale')
  assert.equal(state.source, 'cache')
  assert.equal(state.fetchedAt, fetchedAt)
  assert.deepEqual(state.data, DATA)
  assert.equal(state.error.code, 'WEATHER_NETWORK')
})

test('offline is distinct, with and without a bounded stale fallback', async () => {
  const staleCache = cacheHarness(receipt(NOW - WEATHER_FRESH_MAX_AGE_MS))
  const stale = await client(staleCache, {
    isOnline: () => false,
    fetchImpl: async () => {
      throw new Error('offline preflight must skip fetch')
    },
  })()
  assert.equal(stale.status, 'stale')
  assert.equal(stale.error.code, 'WEATHER_OFFLINE')
  assert.deepEqual(stale.data, DATA)

  const emptyCache = cacheHarness()
  const offline = await client(emptyCache, { isOnline: () => false })()
  assert.equal(offline.status, 'offline')
  assert.equal(offline.error.code, 'WEATHER_OFFLINE')
  assert.equal(offline.data, null)
})

test('malformed, future-dated, and hard-expired caches are quarantined, never shown', async (t) => {
  const cases = [
    ['malformed', '{not json'],
    ['future', receipt(NOW + 1)],
    ['expired', receipt(NOW - WEATHER_CACHE_MAX_AGE_MS)],
  ]

  for (const [name, raw] of cases) {
    await t.test(name, async () => {
      const cache = cacheHarness(raw)
      const state = await client(cache, { isOnline: () => false })()
      assert.equal(state.status, 'offline')
      assert.equal(state.data, null)
      assert.equal(state.fetchedAt, null)
      assert.equal(cache.removals(), 1)
      assert.equal(cache.raw(), null)
    })
  }
})

test('network errors and malformed responses fail explicitly without cache', async () => {
  const failed = await client(cacheHarness(), {
    fetchImpl: async () => {
      throw new TypeError('connection reset')
    },
  })()
  assert.equal(failed.status, 'error')
  assert.equal(failed.error.code, 'WEATHER_NETWORK')
  assert.equal(failed.data, null)

  const malformed = await client(cacheHarness(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ daily: {} }) }),
  })()
  assert.equal(malformed.status, 'error')
  assert.equal(malformed.error.code, 'WEATHER_PAYLOAD_INVALID')
  assert.equal(malformed.data, null)
})

test('App keeps stale bytes out of recommendation and weather-fit consumers', () => {
  const app = readFileSync(new URL('../app/src/App.jsx', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../app/src/HomeView.jsx', import.meta.url), 'utf8')

  assert.match(app, /const wx = weatherState\.status === WEATHER_STATUS\.FRESH \? weatherState\.data : null/)
  assert.match(app, /<WxContext\.Provider value=\{wx\}>/)
  assert.doesNotMatch(app, /<WxContext\.Provider value=\{weatherState\.data\}>/)
  assert.doesNotMatch(app, /\bwx=\{weatherState\.data\}/)
  assert.match(app, /data-weather-status=\{weatherState\.status\}/)
  assert.match(app, /WEATHER_FRESH_MAX_AGE_MS[\s\S]*WEATHER_CACHE_MAX_AGE_MS/)
  assert.match(app, /visibilitychange[\s\S]*pageshow/)
  assert.match(app, /ageForecastState\(current, Date\.now\(\)\)/)
  assert.match(app, /<HomeView events=\{norm\} anchors=\{anchors\} wx=\{wx\} dataMeta=\{eventArtifact\.meta\}/)
  assert.match(app, /weatherState=\{weatherState\}/)

  assert.match(home, /weatherState\?\.status === WEATHER_STATUS\.STALE \? weatherState\.data : null/)
  assert.match(home, /may be out of date/)
  assert.match(home, /<NextDays anchors=\{anchors\} wx=\{wx\}/)
  assert.doesNotMatch(home, /<NextDays[^>]+(?:staleWx|weatherState)/)
})

test('resume-age revalidation demotes or clears suspended weather synchronously', () => {
  const fresh = {
    status: WEATHER_STATUS.FRESH,
    data: DATA,
    fetchedAt: NOW - WEATHER_FRESH_MAX_AGE_MS,
    source: 'cache',
    error: null,
  }
  const stale = ageForecastState(fresh, NOW)
  assert.equal(stale.status, WEATHER_STATUS.STALE)
  assert.equal(stale.data, DATA)
  assert.equal(stale.error.code, 'WEATHER_REFRESHING')

  const expired = ageForecastState({
    ...stale,
    fetchedAt: NOW - WEATHER_CACHE_MAX_AGE_MS,
  }, NOW)
  assert.equal(expired.status, WEATHER_STATUS.ERROR)
  assert.equal(expired.data, null)
  assert.equal(expired.error.code, 'WEATHER_CACHE_EXPIRED')

  const future = ageForecastState({ ...fresh, fetchedAt: NOW + 1 }, NOW)
  assert.equal(future.status, WEATHER_STATUS.ERROR)
  assert.equal(future.data, null)
  assert.equal(future.error.code, 'WEATHER_CACHE_FUTURE')
})
