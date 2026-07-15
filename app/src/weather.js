// weather.js — Open-Meteo 16-day daily forecast for the active city (free, no key).
// getForecast() resolves to { 'YYYY-MM-DD': { emoji, hi, lo, rain } } or null.
//   emoji: WMO weather_code mapped to a condition emoji
//   hi:    daily max temperature, converted to °F (API returns °C), rounded
//   lo:    daily min temperature, °F (TOUCHUP P2 — additive; older callers ignore it)
//   rain:  precipitation_probability_max (0–100) or null
// Cached in localStorage ('wx-<cityId>-v1', 6h TTL); on fetch failure serves
// stale cache or null so the UI degrades gracefully to "no weather".

import { lsGet, lsSet, lsRemove } from './storage.js'
import { CITY, Icon } from './lib.js'

// query location + timezone come from the city config (D4) — for Tampa the URL
// is byte-identical to the old hardcoded one (America/New_York encodes the same).
const WX_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${CITY.center.lat}&longitude=${CITY.center.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(CITY.tz)}&forecast_days=16`
const CACHE_KEY = `wx-${CITY.id}-v1` // stored as twh:wx-<cityId>-v1 via storage.js
const TTL = 6 * 60 * 60 * 1000 // 6h
const FETCH_TIMEOUT = 10000 // 10s

// D4 one-shot key migration: the cache lived under 'wx-tampa-v1' before the key
// was city-parameterized ('wx-tampa-bay-v1' for the reference city). Same
// pattern as storage.js's prefix migration (which has already module-evaluated —
// we import it): copy old → new only when the new key is absent (an
// already-migrated value never gets clobbered), then remove the old key.
// Idempotent; a fresh install finds nothing and no-ops. Chained migrations
// still work: an ancient unprefixed 'wx-tampa-v1' first becomes
// 'twh:wx-tampa-v1' in storage.js (it stays on that LEGACY_KEYS list), then
// lands here. Cache payload shape + TTL are unchanged — only the key moved.
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
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
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

function readCache() {
  try {
    const c = JSON.parse(lsGet(CACHE_KEY))
    return c && typeof c.fetchedAt === 'number' && c.data ? c : null
  } catch {
    return null
  }
}

export async function getForecast() {
  const now = Date.now()
  const cached = readCache()
  if (cached && now - cached.fetchedAt < TTL) return cached.data

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
    let res
    try {
      res = await fetch(WX_URL, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error('weather http ' + res.status)
    const json = await res.json()
    const daily = json?.daily || {}
    const days = Array.isArray(daily.time) ? daily.time : []
    const data = {}
    for (let i = 0; i < days.length; i++) {
      const emoji = wmoEmoji(daily.weather_code?.[i])
      if (!emoji) continue
      const hiC = daily.temperature_2m_max?.[i]
      const loC = daily.temperature_2m_min?.[i]
      const rain = daily.precipitation_probability_max?.[i]
      data[days[i]] = {
        emoji,
        hi: typeof hiC === 'number' ? Math.round((hiC * 9) / 5 + 32) : null,
        // additive (TOUCHUP P2): daily low, °F — existing {emoji,hi,rain} consumers ignore it
        lo: typeof loC === 'number' ? Math.round((loC * 9) / 5 + 32) : null,
        rain: typeof rain === 'number' ? Math.round(rain) : null,
      }
    }
    lsSet(CACHE_KEY, JSON.stringify({ fetchedAt: now, data })) // guarded in storage.js — still returns fresh data
    return data
  } catch {
    return cached ? cached.data : null // stale-if-error, else no weather
  }
}
