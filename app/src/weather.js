// weather.js — Open-Meteo 16-day daily forecast for Tampa Bay (free, no key).
// getForecast() resolves to { 'YYYY-MM-DD': { emoji, hi, rain } } or null.
//   emoji: WMO weather_code mapped to a condition emoji
//   hi:    daily max temperature, converted to °F (API returns °C), rounded
//   rain:  precipitation_probability_max (0–100) or null
// Cached in localStorage ('wx-tampa-v1', 6h TTL); on fetch failure serves stale
// cache or null so the UI degrades gracefully to "no weather".

import { lsGet, lsSet } from './storage.js'

const WX_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=27.95&longitude=-82.46&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=America%2FNew_York&forecast_days=16'
const CACHE_KEY = 'wx-tampa-v1' // stored as twh:wx-tampa-v1 via storage.js
const TTL = 6 * 60 * 60 * 1000 // 6h
const FETCH_TIMEOUT = 10000 // 10s

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
      const rain = daily.precipitation_probability_max?.[i]
      data[days[i]] = {
        emoji,
        hi: typeof hiC === 'number' ? Math.round((hiC * 9) / 5 + 32) : null,
        rain: typeof rain === 'number' ? Math.round(rain) : null,
      }
    }
    lsSet(CACHE_KEY, JSON.stringify({ fetchedAt: now, data })) // guarded in storage.js — still returns fresh data
    return data
  } catch {
    return cached ? cached.data : null // stale-if-error, else no weather
  }
}
