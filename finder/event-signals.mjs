// Retained event-evidence helpers. They operate only on supplied values so
// ingestion can report unknown facts without guessing from source names or
// network state.
import { createHash } from 'node:crypto'

export const EVENT_SERIES_ID_VERSION = 'v1'

const MAX_ORGANIZER_LENGTH = 160
const MAX_CATEGORY_LENGTH = 80
const MAX_RAW_CATEGORIES = 12
const SCHEDULED_STATUS_TOKENS = new Set(['scheduled', 'confirmed', 'active', 'eventscheduled', 'httpsschemaorgeventscheduled'])

const IMAGE_AGGREGATOR_HOST_RE = /(?:^|\.)allevents\.in$/i
const IMAGE_DEAD_HOST_RE = /(?:^|\.)visitstpeteclearwater\.com$/i
const IMAGE_OFFICIAL_HOST_RE = /(?:^|\.)(?:simpleviewinc\.com|visittampabay\.com|evbuc\.com|eventbrite\.com|libnet\.info|ilovetheburg\.com|wmnf\.org|cltampa\.com)$|\.gov$/i

function boundedText(value, maxLength) {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function nameOf(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const key of ['name', 'title', 'label']) {
    if (typeof value[key] === 'string') return value[key]
  }
  return null
}

export function normalizeOrganizer(value) {
  const candidate = Array.isArray(value) ? value.map(nameOf).find(Boolean) : nameOf(value)
  return boundedText(candidate, MAX_ORGANIZER_LENGTH)
}

export function normalizeEventStatus(value) {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!normalized) return 'unknown'
  if (/(?:cancelled|canceled)/.test(normalized)) return 'cancelled'
  if (/(?:postponed|rescheduled)/.test(normalized)) return 'postponed'
  if (/soldout/.test(normalized)) return 'sold_out'
  if (SCHEDULED_STATUS_TOKENS.has(normalized)) return 'scheduled'
  return 'unknown'
}

// A known cancelled/postponed/sold-out member must prevent a merged listing
// from being relabelled scheduled. Unknown also outranks scheduled because a
// cluster with an unclassified member has incomplete status evidence.
export function mergeEventStatus(values) {
  const statuses = (Array.isArray(values) ? values : [])
    .map((value) => normalizeEventStatus(value && typeof value === 'object' ? value.status : value))
  if (statuses.includes('cancelled')) return 'cancelled'
  if (statuses.includes('postponed')) return 'postponed'
  if (statuses.includes('sold_out')) return 'sold_out'
  if (statuses.includes('unknown') || statuses.length === 0) return 'unknown'
  return 'scheduled'
}

function categoryValues(value, output) {
  if (Array.isArray(value)) {
    for (const entry of value) categoryValues(entry, output)
    return
  }
  const category = boundedText(nameOf(value), MAX_CATEGORY_LENGTH)
  if (category) output.push(category)
}

export function normalizeRawCategories(...values) {
  const supplied = values.some((value) => Array.isArray(value) || nameOf(value) != null)
  if (!supplied) return null
  const candidates = []
  for (const value of values) categoryValues(value, candidates)
  const seen = new Set()
  const output = []
  for (const candidate of candidates) {
    const key = candidate.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    output.push(candidate)
    if (output.length === MAX_RAW_CATEGORIES) break
  }
  return output
}

export function visibleDescriptionLength(value) {
  return typeof value === 'string' ? value.length : null
}

// This is intentionally the exact numeric contract previously held in
// finder.mjs. `pickImage` delegates here, preserving both selection order and
// the rank emitted for the winning image.
export function imageHostRank(url) {
  if (!url) return -1
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return 0 }
  if (IMAGE_DEAD_HOST_RE.test(host)) return -1
  if (IMAGE_AGGREGATOR_HOST_RE.test(host)) return 0
  if (IMAGE_OFFICIAL_HOST_RE.test(host)) return 2
  return 1
}

function seriesTitle(value) {
  const title = boundedText(value, 500)
  if (!title) return null
  return title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    || null
}

/**
 * Deterministic recurring-series identity. It intentionally has no occurrence
 * time, so one-off occurrences of the same retained series share a series id.
 */
export function recurringSeriesId({ cityId, title, organizer, sourceFamily } = {}) {
  const city = boundedText(cityId, 120)
  const normalizedTitle = seriesTitle(title)
  const owner = normalizeOrganizer(organizer) || boundedText(sourceFamily, MAX_ORGANIZER_LENGTH)
  if (!city || !normalizedTitle || !owner) return null
  const canonical = `${EVENT_SERIES_ID_VERSION}|${city}|${normalizedTitle}|${owner.toLocaleLowerCase('en-US')}`
  return `series-${EVENT_SERIES_ID_VERSION}-${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16)}`
}
