// lib.js — shared data helpers, constants, and (JSX-free) icon components.
// NOTE: this file is plain .js, so NO JSX here — icons use createElement.
import { createElement as h } from 'react'

// Per-city hero art is a future, multi-city feature; hardcoded to Tampa for now.
export const CITY = {
  name: 'Tampa Bay',
  hero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/1920px-Tampa_Skyline_-_Eric_Statzer.jpg',
}
export const DAY = 86400000

// bubble destinations: every bubble opens a full BubblePage (round-3)
export const BUBBLES = [
  { id: 'tonight', emoji: '🌙', label: 'Tonight', kind: 'time', value: 'tonight', hue: 250 },
  { id: 'weekend', emoji: '🎉', label: 'This Weekend', kind: 'time', value: 'weekend', hue: 35 },
  { id: 'free', emoji: '🆓', label: 'Free', kind: 'free', value: true, hue: 145 },
  { id: 'near', emoji: '📍', label: 'Near Me', kind: 'sort', value: 'near', hue: 200 },
  { id: 'music', emoji: '🎵', label: 'Music', kind: 'cat', value: 'music', hue: 285 },
  { id: 'food', emoji: '🍔', label: 'Food & Drink', kind: 'cat', value: 'food', hue: 15 },
  { id: 'outdoors', emoji: '🌳', label: 'Outdoors', kind: 'cat', value: 'outdoors', hue: 110 },
  { id: 'sports', emoji: '🏟️', label: 'Sports', kind: 'cat', value: 'sports', hue: 220 },
  { id: 'arts', emoji: '🎨', label: 'Arts', kind: 'cat', value: 'art', hue: 330 },
  { id: 'night', emoji: '🪩', label: 'Nightlife', kind: 'cat', value: 'nightlife', hue: 265 },
  { id: 'comedy', emoji: '😂', label: 'Comedy', kind: 'cat', value: 'comedy', hue: 50 },
  { id: 'theatre', emoji: '🎭', label: 'Theatre', kind: 'cat', value: 'theatre', hue: 350 },
  { id: 'family', emoji: '👨‍👩‍👧', label: 'Family', kind: 'cat', value: 'family', hue: 190 },
  { id: 'markets', emoji: '🛍️', label: 'Markets', kind: 'cat', value: 'market', hue: 80 },
  { id: 'clubs', emoji: '🤝', label: 'Clubs', kind: 'cat', value: 'community', hue: 175 },
]

// hotScore desc, nulls last, ties by start time
export const hotDesc = (x, y) => (y.hotScore ?? -Infinity) - (x.hotScore ?? -Infinity) || x._t - y._t

// --- date / formatting helpers ---
export function parseDate(iso) {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d) // local midnight, NOT UTC
  }
  const d = new Date(iso)
  return isNaN(d) ? null : d
}
export function dayTs(iso) {
  const d = parseDate(iso)
  return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null
}
export function dayKey(iso) {
  const d = parseDate(iso)
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : null
}
export function timeOf(iso) {
  if (!iso || !/T\d/.test(iso)) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
export function dayLabel(ts, anchors) {
  if (ts === anchors.todayTs) return 'Today'
  if (ts === anchors.tomorrowTs) return 'Tomorrow'
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
export function priceLabel(e) {
  if (e.isFree === true) return 'Free'
  if (e.price > 0) return '$' + e.price
  return null
}
// deterministic gradient for events without an image (keeps the UI colorful)
export function gradFor(s) {
  let h2 = 0
  for (let i = 0; i < (s || '').length; i++) h2 = (h2 * 31 + s.charCodeAt(i)) % 360
  return `linear-gradient(135deg, hsl(${h2} 68% 52%), hsl(${(h2 + 45) % 360} 72% 42%))`
}
export function keyOf(e) {
  return (e.url || e.title || '') + '|' + (e.start || '')
}
export function milesBetween(a, b) {
  const R = 3958.8
  const toR = (x) => (x * Math.PI) / 180
  const dLat = toR(b.lat - a.lat)
  const dLng = toR(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// today/tomorrow/weekend anchors; weekend = Fri–Sun window containing or after today
export function makeAnchors(now = new Date()) {
  const at = (off) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off).getTime()
  const dow = now.getDay()
  const friOff = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow
  return { todayTs: at(0), tomorrowTs: at(1), wkStartTs: at(friOff), wkEndTs: at(friOff + 2) }
}

// --- schema v2 normalization (defensive: fields may be absent in the file on disk) ---
export function normalize(raw, anchors) {
  const tags = Array.isArray(raw.tags) ? raw.tags : []
  const sources = Array.isArray(raw.sources) && raw.sources.length ? raw.sources : raw.source ? [raw.source] : []
  const hotScore = typeof raw.hotScore === 'number' ? raw.hotScore : null
  const buzz = typeof raw.buzz === 'number' ? raw.buzz : Math.max(sources.length, 1)
  const category = typeof raw.category === 'string' && raw.category ? raw.category : 'other'
  const sponsored = raw.sponsored === true
  const _ongoing = tags.includes('ongoing')
  const _day = dayTs(raw.start)
  const _endDay = dayTs(raw.end) ?? _day
  const _t = parseDate(raw.start)?.getTime() ?? Number.MAX_SAFE_INTEGER
  const _free = raw.isFree === true || tags.includes('free')
  // computed from the live anchors only — baked _tonight/_weekend tags in the
  // snapshot can be a day old and must never override the runtime range math
  const _tonight = _day != null && anchors.todayTs >= _day && anchors.todayTs <= (_endDay ?? _day)
  const _weekend = _day != null && _day <= anchors.wkEndTs && (_endDay ?? _day) >= anchors.wkStartTs
  return { ...raw, tags, sources, hotScore, buzz, category, sponsored, _day, _endDay, _t, _free, _tonight, _weekend, _ongoing }
}
// 'ongoing' events show "Ongoing" instead of a stale start date/time
export function startLabel(e) {
  return e._ongoing ? 'Ongoing' : timeOf(e.start)
}
export function dayLabelLoose(e) {
  return e._day != null ? new Date(e._day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null
}
export function dayLoose(e) {
  return e._ongoing ? 'Ongoing' : dayLabelLoose(e)
}

// --- icons (createElement, since this is a .js file) ---
export const Icon = {
  hot: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M12.6 2.5c.5 3.2-.9 5.1-2.5 6.9C8.6 11 7 12.7 7 15a5.4 5.4 0 0 0 10.8 0c0-2-.9-3.5-2-4.7-.3 1.2-1 2.2-2.2 2.7.7-2.6.3-7-1-10.5Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  map: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('path', {
        d: 'M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Zm0 0v15m6-12v15',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      })
    ),
  calendar: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', ...p },
      h('rect', { x: 3, y: 5, width: 18, height: 16, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1 }),
      h('path', { d: 'M3 9.5h18M8 3v4M16 3v4', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' })
    ),
  // back chevron used by detail + subpage headers
  chevron: (p) =>
    h(
      'svg',
      { viewBox: '0 0 24 24', width: 20, height: 20, ...p },
      h('path', {
        d: 'M15 18l-6-6 6-6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    ),
}
