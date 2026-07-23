// Pure, serializable guide contracts. A guide is a transparent selection rule,
// never an editorial ranking or a community recommendation.

import { fmtLocale } from './city.js'

const GUIDE_TYPES = new Set(['evergreen', 'watch'])
const DOMAINS = new Set(['events', 'spots', 'mixed'])
const SOURCE_MAX = 16
const KEYWORD_MAX = 24

const text = (value, max = 240) => typeof value === 'string'
  ? value.trim().slice(0, max)
  : ''

const strings = (value, cap, max = 160) => {
  if (!Array.isArray(value)) return []
  if (value.length > cap) return null
  const out = []
  const seen = new Set()
  for (const raw of value) {
    if (typeof raw !== 'string' || raw.length > max || raw !== raw.trim()) return null
    const item = text(raw, max)
    const key = item.toLowerCase()
    if (!item || seen.has(key)) return null
    seen.add(key)
    out.push(item)
    if (out.length >= cap) break
  }
  return out
}

function windowOf(value) {
  if (!value || typeof value !== 'object') return null
  const start = text(value.start, 10)
  const end = text(value.end, 10)
  const validDay = (day) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
    const [year, month, date] = day.split('-').map(Number)
    const probe = new Date(Date.UTC(year, month - 1, date))
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === date
  }
  return validDay(start) && validDay(end) && end >= start
    ? { start, end }
    : null
}

function selectionOf(value, guideType) {
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).some((key) => !['type', 'summary'].includes(key))
        || typeof value.type !== 'string' || value.type.length > 48
        || typeof value.summary !== 'string' || value.summary.length > 280) return null
    const type = text(value.type, 48)
    const summary = text(value.summary, 280)
    if (type && summary) return { type, summary }
  }
  return guideType === 'watch'
    ? { type: 'keyword-match', summary: 'Matches the supplied terms against live listing fields.' }
    : { type: 'field-filter', summary: 'Filters live listing fields using the collection rules shown here.' }
}

// Sprint 9 has no trusted guide-photo receipt source. A snapshot cannot promote
// its own URL by self-declaring credit/license fields, so covers stay decorative.
export function canonicalGuideCover(_value, hue = 30) {
  return { kind: 'decorative', hue: Number.isFinite(Number(hue)) ? Number(hue) : 30 }
}

export function canonicalGuide(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Object.getOwnPropertySymbols(value).length > 0) return null
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null
  }
  if (typeof value.id !== 'string' || value.id.length > 96
      || typeof value.title !== 'string' || value.title.length > 160
      || typeof value.pov !== 'string' || value.pov.length > 320) return null
  const id = text(value.id, 96)
  const title = text(value.title, 160)
  const pov = text(value.pov, 320)
  const guideType = value.guideType || (value.kind === 'watch' ? 'watch' : 'evergreen')
  const domain = DOMAINS.has(value.domain) ? value.domain : 'events'
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !title || !pov || !GUIDE_TYPES.has(guideType)) return null
  const window = guideType === 'watch' ? windowOf(value.window) : null
  const keywords = strings(value.keywords, KEYWORD_MAX, 96)
  const sources = strings(value.sources, SOURCE_MAX, 240)
  const selectionMethod = selectionOf(value.selectionMethod, guideType)
  if (!keywords || !sources || !selectionMethod
      || guideType === 'watch' && (!window || keywords.length === 0)) return null
  return {
    id,
    key: `g|${id}`,
    kind: guideType === 'watch' ? 'watch' : 'guide',
    guideType,
    title,
    pov,
    domain,
    emoji: text(value.emoji, 16) || '✦',
    hue: Number.isFinite(Number(value.hue)) ? Number(value.hue) : 30,
    plannable: value.plannable === true,
    needsPlaces: value.needsPlaces === true || domain === 'spots' || domain === 'mixed',
    keywords,
    window,
    sources,
    selectionMethod,
    cover: canonicalGuideCover(value.cover, value.hue),
    ...(typeof value.select === 'function' ? { select: value.select } : {}),
  }
}

export function guideSnapshot(value) {
  const guide = canonicalGuide(value)
  if (!guide) return null
  return {
    kind: 'guide',
    key: guide.key,
    id: guide.id,
    guideType: guide.guideType,
    emoji: guide.emoji,
    hue: guide.hue,
    title: guide.title,
    pov: guide.pov,
    domain: guide.domain,
    plannable: guide.plannable,
    needsPlaces: guide.needsPlaces,
    keywords: guide.keywords,
    window: guide.window,
    sources: guide.sources,
    selectionMethod: guide.selectionMethod,
    cover: guide.cover,
  }
}

export function rehydrateSavedGuide(snapshot, catalog = []) {
  const id = text(snapshot?.id, 96)
  if (!id) return { available: false, guide: null, source: 'invalid-snapshot' }
  const live = (Array.isArray(catalog) ? catalog : [])
    .map(canonicalGuide)
    .find((guide) => guide?.id === id)
  if (live) return { available: true, guide: live, source: 'live-catalog' }
  const retained = canonicalGuide(snapshot)
  return retained
    ? { available: true, guide: retained, source: 'saved-snapshot' }
    : { available: false, guide: null, source: 'invalid-snapshot' }
}

export function guideFreshness(meta, nowMs = Date.now()) {
  const generatedAt = typeof meta?.generatedAt === 'string' ? Date.parse(meta.generatedAt) : NaN
  const expiresAt = typeof meta?.expiresAt === 'string' ? Date.parse(meta.expiresAt) : NaN
  const health = meta?.sourceHealth?.status
  if (!Number.isFinite(generatedAt)) {
    return { status: 'unknown', generatedAt: null, label: 'Listing refresh time unavailable' }
  }
  let date
  try {
    date = new Intl.DateTimeFormat(fmtLocale, {
      month: 'short',
      day: 'numeric',
      ...(typeof meta?.timeZone === 'string' ? { timeZone: meta.timeZone } : {}),
    }).format(generatedAt)
  } catch {
    date = new Intl.DateTimeFormat(fmtLocale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(generatedAt)
  }
  if (Number.isFinite(expiresAt) && nowMs >= expiresAt) {
    return { status: 'stale', generatedAt: meta.generatedAt, label: `Listings from ${date} are too old to use` }
  }
  if (health === 'degraded') {
    return { status: 'degraded', generatedAt: meta.generatedAt, label: `Refreshed ${date}; some sources were unavailable` }
  }
  if (health === 'failed') {
    return { status: 'unavailable', generatedAt: meta.generatedAt, label: `The ${date} source check failed` }
  }
  if (health !== 'healthy') {
    return { status: 'unknown', generatedAt: meta.generatedAt, label: `Listings were refreshed ${date}; source check unavailable` }
  }
  return { status: 'fresh', generatedAt: meta.generatedAt, label: `Matched against listings refreshed ${date}` }
}

export function guideReason(value) {
  const guide = canonicalGuide(value)
  if (!guide) return null
  if (guide.guideType === 'watch') {
    return `Matches live listing text for ${guide.keywords.slice(0, 4).join(', ')}.`
  }
  return guide.selectionMethod.summary
}

export function searchableGuideText(value) {
  const guide = canonicalGuide(value)
  return guide
    ? [guide.title, guide.pov, guide.guideType, ...guide.keywords, guide.selectionMethod.summary].join(' ')
    : ''
}
