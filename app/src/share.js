// share.js — the shared share/calendar builders (Sprint U-c). Pure logic only,
// plain .js with NO JSX and no React, so the Node verification harness can
// import it directly (same rule as lib.js / weekend.js).
//
// This file GENERALIZES two things that already existed as single-event code:
//   · the RFC 5545 ICS builder that lived inline in DetailPage (icsText) —
//     split into vevent(e) (one VEVENT body) + wrapIcs(bodies) (the VCALENDAR
//     envelope), so a day plan can emit ONE calendar file with N VEVENTs and a
//     single event stays a one-VEVENT file. DetailPage now calls eventIcs(e).
//   · the weekend share-text composer (weekend.js shareText) — shareDayText
//     does one day's worth of the SAME ☀️/🌙 lines for the day screen.
//
// Sprint U-c uses these for "Share this day": shareDayText for the human text,
// eventsIcs for the multi-VEVENT download. weekend.js's shareText (the whole
// weekend) is untouched — the Weekend Builder still uses it verbatim.
import { CITY, formatDayTs, timeOf } from './lib.js'
import { DAYPART } from './weekend.js'
import { addCalendarDays, eventTime, zonedDateTimeParts } from '../../shared/city-time.mjs'

// ===== ICS (RFC 5545) =====
// Calendar identity is city-local and deterministic. Timed values carry the
// city's IANA TZID; date-only values use RFC's exclusive DTEND convention.
const esc = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const encoder = new TextEncoder()
const utf8Length = (value) => encoder.encode(value).length

// RFC 5545 content lines are at most 75 octets. Continuation lines begin with
// one space, leaving 74 octets for content; iteration by code point avoids
// splitting surrogate pairs or UTF-8 sequences.
const fold = (line) => {
  let rest = String(line)
  const lines = []
  let limit = 75
  while (utf8Length(rest) > limit) {
    let part = ''
    for (const char of rest) {
      if (utf8Length(part + char) > limit) break
      part += char
    }
    if (!part) part = Array.from(rest)[0]
    lines.push(part)
    rest = rest.slice(part.length)
    limit = 74
  }
  lines.push(rest)
  return lines.map((part, index) => index ? ' ' + part : part).join('\r\n')
}

const p2 = (n) => String(n).padStart(2, '0')
const dayValue = (dayId) => dayId.replaceAll('-', '')
const localValue = (epochMs) => {
  const part = zonedDateTimeParts(epochMs, CITY.tz)
  return String(part.year).padStart(4, '0') + p2(part.month) + p2(part.day)
    + 'T' + p2(part.hour) + p2(part.minute) + p2(part.second)
}
const stampValue = (nowMs) => {
  const part = zonedDateTimeParts(nowMs, 'UTC')
  return String(part.year).padStart(4, '0') + p2(part.month) + p2(part.day)
    + 'T' + p2(part.hour) + p2(part.minute) + p2(part.second) + 'Z'
}

function fallbackUid(e) {
  const key = (e.url || e.title || 'event') + '|' + (e.start || '')
  let hash = 0
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

export function vevent(e, { nowMs = Date.now() } = {}) {
  const canonical = eventTime(e, { timeZone: CITY.tz })
  if (!canonical.ok) return null

  const uid = e.id ? String(e.id).replace(/[^A-Za-z0-9_.-]/g, '-') : fallbackUid(e)
  const lines = [
    'BEGIN:VEVENT',
    'UID:' + uid + '@wuzup-' + CITY.id,
    'DTSTAMP:' + stampValue(nowMs),
  ]

  if (canonical.kind === 'all-day') {
    lines.push(
      'DTSTART;VALUE=DATE:' + dayValue(canonical.startDay),
      'DTEND;VALUE=DATE:' + dayValue(addCalendarDays(canonical.endDay, 1)),
    )
  } else {
    lines.push(
      'DTSTART;TZID=' + CITY.tz + ':' + localValue(canonical.startAt),
      'DTEND;TZID=' + CITY.tz + ':' + localValue(canonical.endAt),
    )
  }

  lines.push(fold('SUMMARY:' + esc(e.title || 'Event')))
  const loc = [e.venue, e.address].filter(Boolean).join(', ')
  if (loc) lines.push(fold('LOCATION:' + esc(loc)))
  if (e.description) lines.push(fold('DESCRIPTION:' + esc(e.description)))
  if (e.url) lines.push(fold('URL:' + esc(e.url)))
  lines.push('END:VEVENT')
  return lines
}

export function wrapIcs(bodies) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//Wuzup ${CITY.name}//EN`, 'CALSCALE:GREGORIAN']
  for (const body of bodies || []) if (Array.isArray(body)) lines.push(...body)
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export function eventIcs(e, options = {}) {
  const body = vevent(e, options)
  return wrapIcs(body ? [body] : [])
}

export function eventsIcs(list, { nowMs = Date.now() } = {}) {
  const events = Array.isArray(list) ? list : []
  return wrapIcs(events.map((event) => vevent(event, { nowMs })).filter(Boolean))
}
// ===== human share text for ONE day =====
// generalizes weekend.js shareText's per-day block. entries = the day's filled
// slots in render order [{ part:'morning'|'afternoon'|'night', e }] (caller
// resolves keys to live events and drops empties); dayTs = local-midnight ms.
// Returns null when there's nothing to share (an empty/rest day has no text —
// U-c: no share affordance is offered there, this is the defensive backstop).
// ALL COPY IS DRAFT for Charles.
export function shareDayText(dayTs, entries) {
  const picks = (entries || []).filter((x) => x && x.e)
  if (!picks.length) return null
  const dateLine = formatDayTs(dayTs, { weekday: 'long', month: 'short', day: 'numeric' })
  const lines = ['My plan for ' + dateLine + ' 🌴'] // DRAFT for Charles
  for (const { part, e } of picks) {
    const bits = [e.title, timeOf(e.start) || null, e.venue || null].filter(Boolean).join(' · ')
    lines.push((DAYPART[part]?.emoji ?? '🗓️') + ' ' + bits) // ⚑PLAN-P0: shared label map; safe fallback if a stale part slips through
  }
  return lines.join('\n')
}
