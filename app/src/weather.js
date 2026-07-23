// weather.js — Open-Meteo 16-day daily forecast for the active city (free, no key).
// getForecast() resolves an explicit {status,data,fetchedAt,source,error} state.
// Only `fresh` data is eligible for recommendation/ranking reasons. A failed
// refresh may expose a bounded `stale` display fallback; caches at/over the hard
// maximum age, malformed receipts, and future-dated receipts are never exposed.

import { lsGet, lsSet, lsRemove } from './storage.js'
import { CITY, Icon } from './lib.js'
import { dayIdAt } from '../../shared/city-time.mjs'

// query location + timezone come from the city config (D4) — for Tampa the URL
// is byte-identical to the old hardcoded one (America/New_York encodes the same).
const WX_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${CITY.center.lat}&longitude=${CITY.center.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(CITY.tz)}&forecast_days=16`
const CACHE_KEY = `wx-${CITY.id}-v1` // stored as twh:wx-<cityId>-v1 via storage.js
export const WEATHER_FRESH_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const WEATHER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const WEATHER_FETCH_TIMEOUT_MS = 10000
export const WEATHER_STATUS = Object.freeze({
  FRESH: 'fresh',
  STALE: 'stale',
  OFFLINE: 'offline',
  ERROR: 'error',
})

// D4 one-shot key migration: the cache lived under 'wx-tampa-v1' before the key
// was city-parameterized ('wx-tampa-bay-v1' for the reference city). Same
// pattern as storage.js's prefix migration (which has already module-evaluated —
// we import it): copy old → new only when the new key is absent (an
// already-migrated value never gets clobbered), then remove the old key.
// Idempotent; a fresh install finds nothing and no-ops. Chained migrations
// still work: an ancient unprefixed 'wx-tampa-v1' first becomes
// 'twh:wx-tampa-v1' in storage.js (it stays on that LEGACY_KEYS list), then
// lands here. Cache payload shape is unchanged — only the key moved.
const LEGACY_WX_KEY = 'wx-tampa-v1'
if (CITY.id === 'tampa-bay' && CACHE_KEY !== LEGACY_WX_KEY) {
  const old = lsGet(LEGACY_WX_KEY)
  if (old !== null) {
    // storage.js's destructive-sequence rule (REFUTE nit): remove the legacy
    // key ONLY once the copy verifiably landed — lsSet returns false on quota/
    // private-mode failure, and removing anyway would orphan the cache (cost:
    // one extra weather fetch, but the rule is the rule).
    const landed = lsGet(CACHE_KEY) !== null ? true : lsSet(CACHE_KEY, old)
    if (landed) lsRemove(LEGACY_WX_KEY)
  }
}

// WMO weather_code → emoji (unknown codes → null, day simply shows no weather)
export function wmoEmoji(code) {
  if (typeof code !== 'number') return null
  if (code <= 1) return '☀️'
  if (code === 2) return '⛅'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌧️'
  if (code >= 95 && code <= 99) return '⛈️'
  return null
}

// friendly condition words per emoji, for the selected-day summary line
export const CONDITION = {
  '☀️': 'Sunny',
  '⛅': 'Partly cloudy',
  '☁️': 'Cloudy',
  '🌫️': 'Foggy',
  '🌦️': 'Light drizzle',
  '🌧️': 'Showers likely',
  '❄️': 'Snow',
  '⛈️': 'Storms likely',
}

// Cohesion WS3 (§9): the CHROME face per condition — the emoji above stays the
// DATA key (cache shape unchanged, every CONDITION consumer untouched); chrome
// surfaces (NextDays' tinted disc) render the engineered Icon.* stroke glyph
// instead of the raw emoji. k doubles as the tint-class suffix (.nd-wx--{k}).
export const WX_GLYPH = {
  '☀️': { k: 'sun', Ic: Icon.sun },
  '⛅': { k: 'cloud', Ic: Icon.cloud },
  '☁️': { k: 'cloud', Ic: Icon.cloud },
  '🌫️': { k: 'cloud', Ic: Icon.cloud },
  '🌦️': { k: 'rain', Ic: Icon.rain },
  '🌧️': { k: 'rain', Ic: Icon.rain },
  '❄️': { k: 'cloud', Ic: Icon.cloud }, // Tampa snow: honest-but-unlikely — calm cloud face
  '⛈️': { k: 'storm', Ic: Icon.storm },
}

// local-time day timestamp → 'YYYY-MM-DD' (matches the API's daily.time keys)
export function dateKey(ts) {
  return dayIdAt(ts, CITY.tz)
}

// "🌧️ Showers likely · high 93° · 47% rain" — null when no forecast for the
// day. Shared by CalendarView's selected-day line and the U-a day screen.
export function wxSummary(w) {
  if (!w) return null
  const parts = [w.emoji + ' ' + (CONDITION[w.emoji] || 'Forecast')]
  if (w.hi != null) parts.push('high ' + w.hi + '°')
  if (w.rain != null) parts.push(w.rain + '% rain')
  return parts.join(' · ')
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function optionalNumber(value, { min = -Infinity, max = Infinity } = {}) {
  if (value == null) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined
}

function normalizeForecastData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = {}
  for (const [day, entry] of Object.entries(value)) {
    if (!DAY_KEY.test(day) || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    if (!Object.hasOwn(CONDITION, entry.emoji)) return null
    const hi = optionalNumber(entry.hi)
    const lo = optionalNumber(entry.lo)
    const rain = optionalNumber(entry.rain, { min: 0, max: 100 })
    if (hi === undefined || lo === undefined || rain === undefined) return null
    data[day] = { emoji: entry.emoji, hi, lo, rain }
  }
  return Object.keys(data).length > 0 ? data : null
}

function decodeCache(raw, now) {
  if (raw == null) return { kind: 'missing', cache: null }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', cache: null }
  }
  const data = normalizeForecastData(value?.data)
  if (!Number.isFinite(value?.fetchedAt) || !data) return { kind: 'invalid', cache: null }
  const age = now - value.fetchedAt
  if (age < 0) return { kind: 'future', cache: null }
  if (age >= WEATHER_CACHE_MAX_AGE_MS) return { kind: 'expired', cache: null }
  return {
    kind: age < WEATHER_FRESH_MAX_AGE_MS ? 'fresh' : 'stale',
    cache: { fetchedAt: value.fetchedAt, data },
  }
}

function weatherException(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function failure(code, message) {
  return { code, message, retryable: true }
}

export function ageForecastState(state, nowMs = Date.now()) {
  if (!state || !Number.isFinite(state.fetchedAt) || !state.data) return state
  const age = nowMs - state.fetchedAt
  if (age >= 0 && age < WEATHER_FRESH_MAX_AGE_MS) return state
  if (age >= WEATHER_FRESH_MAX_AGE_MS && age < WEATHER_CACHE_MAX_AGE_MS) {
    if (state.status !== WEATHER_STATUS.FRESH) return state
    return {
      ...state,
      status: WEATHER_STATUS.STALE,
      source: 'cache',
      error: failure('WEATHER_REFRESHING', 'Checking for a current forecast'),
    }
  }
  const offline = state.error?.code === 'WEATHER_OFFLINE'
  return {
    status: offline ? WEATHER_STATUS.OFFLINE : WEATHER_STATUS.ERROR,
    data: null,
    fetchedAt: null,
    source: null,
    error: age < 0
      ? failure('WEATHER_CACHE_FUTURE', 'Saved weather has an invalid timestamp')
      : failure('WEATHER_CACHE_EXPIRED', 'Saved weather is too old to show'),
  }
}

function safelyOnline(isOnline) {
  try {
    return isOnline() !== false
  } catch {
    return true
  }
}

function failureState(cache, problem) {
  if (cache) {
    return {
      status: WEATHER_STATUS.STALE,
      data: cache.data,
      fetchedAt: cache.fetchedAt,
      source: 'cache',
      error: problem,
    }
  }
  return {
    status: problem.code === 'WEATHER_OFFLINE' ? WEATHER_STATUS.OFFLINE : WEATHER_STATUS.ERROR,
    data: null,
    fetchedAt: null,
    source: null,
    error: problem,
  }
}

function parsePayload(json) {
  const daily = json?.daily
  const fields = [
    daily?.time,
    daily?.weather_code,
    daily?.temperature_2m_max,
    daily?.temperature_2m_min,
    daily?.precipitation_probability_max,
  ]
  if (fields.some((field) => !Array.isArray(field)) || daily.time.length === 0) {
    throw weatherException('WEATHER_PAYLOAD_INVALID', 'Weather response was malformed')
  }
  if (fields.some((field) => field.length < daily.time.length)) {
    throw weatherException('WEATHER_PAYLOAD_INVALID', 'Weather response was incomplete')
  }

  const data = {}
  for (let i = 0; i < daily.time.length; i++) {
    const day = daily.time[i]
    const emoji = wmoEmoji(daily.weather_code[i])
    const hiC = optionalNumber(daily.temperature_2m_max[i])
    const loC = optionalNumber(daily.temperature_2m_min[i])
    const rain = optionalNumber(daily.precipitation_probability_max[i], { min: 0, max: 100 })
    if (!DAY_KEY.test(day) || Object.hasOwn(data, day) || !emoji || hiC === undefined || loC === undefined || rain === undefined) {
      throw weatherException('WEATHER_PAYLOAD_INVALID', 'Weather response contained invalid daily data')
    }
    data[day] = {
      emoji,
      hi: hiC == null ? null : Math.round((hiC * 9) / 5 + 32),
      lo: loC == null ? null : Math.round((loC * 9) / 5 + 32),
      rain: rain == null ? null : Math.round(rain),
    }
  }
  return data
}

// Dependency injection keeps the trust/failure matrix deterministic in Node
// while getForecast() below remains the single browser entry point.
export function createForecastClient({
  fetchImpl = (...args) => globalThis.fetch(...args),
  cacheGet = () => lsGet(CACHE_KEY),
  cacheSet = (value) => lsSet(CACHE_KEY, value),
  cacheRemove = () => lsRemove(CACHE_KEY),
  now = () => Date.now(),
  isOnline = () => globalThis.navigator?.onLine !== false,
  setTimeoutImpl = (...args) => globalThis.setTimeout(...args),
  clearTimeoutImpl = (...args) => globalThis.clearTimeout(...args),
  timeoutMs = WEATHER_FETCH_TIMEOUT_MS,
  url = WX_URL,
} = {}) {
  let inFlight = null

  return async function loadForecast() {
    const checkedAt = now()
    let raw = null
    try {
      raw = cacheGet()
    } catch {
      // Storage failure must not block a live forecast.
    }
    const decoded = decodeCache(raw, checkedAt)
    if (decoded.kind === 'fresh') {
      return {
        status: WEATHER_STATUS.FRESH,
        data: decoded.cache.data,
        fetchedAt: decoded.cache.fetchedAt,
        source: 'cache',
        error: null,
      }
    }
    if (['invalid', 'future', 'expired'].includes(decoded.kind)) {
      try {
        cacheRemove()
      } catch {
        // The invalid bytes remain harmless because every read revalidates them.
      }
    }

    const staleCache = decoded.kind === 'stale' ? decoded.cache : null
    if (!safelyOnline(isOnline)) {
      return failureState(staleCache, failure('WEATHER_OFFLINE', 'Forecast is unavailable offline'))
    }
    if (inFlight) return inFlight

    inFlight = (async () => {
      const ctrl = new AbortController()
      const timer = setTimeoutImpl(() => ctrl.abort(), timeoutMs)
      try {
        const response = await fetchImpl(url, { signal: ctrl.signal })
        if (!response?.ok) {
          throw weatherException('WEATHER_HTTP', `Weather request failed (${response?.status || 'unknown'})`)
        }
        let json
        try {
          json = await response.json()
        } catch {
          throw weatherException('WEATHER_INVALID_JSON', 'Weather response was not valid JSON')
        }
        const data = parsePayload(json)
        const fetchedAt = now()
        try {
          cacheSet(JSON.stringify({ fetchedAt, data }))
        } catch {
          // A live response remains useful for this session even if persistence fails.
        }
        return {
          status: WEATHER_STATUS.FRESH,
          data,
          fetchedAt,
          source: 'network',
          error: null,
        }
      } catch (error) {
        const offline = !safelyOnline(isOnline)
        const timedOut = ctrl.signal.aborted
        const code = offline
          ? 'WEATHER_OFFLINE'
          : timedOut
            ? 'WEATHER_TIMEOUT'
            : error?.code || 'WEATHER_NETWORK'
        const message = offline
          ? 'Forecast is unavailable offline'
          : timedOut
            ? 'Weather request timed out'
            : error?.message || 'Weather request failed'
        return failureState(staleCache, failure(code, message))
      } finally {
        clearTimeoutImpl(timer)
      }
    })()

    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  }
}

const loadForecast = createForecastClient()

export function getForecast() {
  return loadForecast()
}
