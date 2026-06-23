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
import { parseDate, timeOf } from './lib.js'
import { DAYPART } from './weekend.js'

// ===== ICS (RFC 5545) =====
// vevent(e) → the lines of ONE VEVENT (no envelope). Date-only events become
// all-day (VALUE=DATE, exclusive DTEND); timed events use local floating
// wall-clock. Text escaped per RFC (backslash, semicolon, comma, newline) and
// folded at 60 UTF-16 chars (well under RFC's 75 octets even for multi-byte
// text, never lands mid-surrogate-pair in practice). Lifted verbatim from
// DetailPage.icsText's body — same UID derivation, so the same event always
// produces the same UID and calendars never duplicate it.
const esc = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const fold = (line) => {
  let s = line
  let out = ''
  while (s.length > 60) {
    out += s.slice(0, 60) + '\r\n '
    s = s.slice(60)
  }
  return out + s
}
const p2 = (n) => String(n).padStart(2, '0')
const dOf = (d) => '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
const tOf = (d) => dOf(d) + 'T' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds())

function dtStamp() {
  const now = new Date()
  return (
    '' + now.getUTCFullYear() + p2(now.getUTCMonth() + 1) + p2(now.getUTCDate()) +
    'T' + p2(now.getUTCHours()) + p2(now.getUTCMinutes()) + p2(now.getUTCSeconds()) + 'Z'
  )
}

export function vevent(e) {
  // a calendar VEVENT needs a date. A place (Sprint S: kind:'place' slotted via
  // Make-this-my-plan) has none — it's "always there", not a timed event — so
  // it produces NO VEVENT and is simply absent from the .ics (it still appears
  // in the human shareDayText). Guard the dateless/unparseable case: without
  // this, parseDate(undefined).getFullYear() would throw mid-export.
  if (!e || !e.start || !parseDate(e.start)) return null
  // deterministic UID from url|title+start (same event → same UID → no dupes)
  const idKey = (e.url || e.title || 'event') + '|' + (e.start || '')
  let h = 0
  for (let i = 0; i < idKey.length; i++) h = (h * 31 + idKey.charCodeAt(i)) >>> 0
  const lines = ['BEGIN:VEVENT', 'UID:' + h.toString(36) + '@whats-hot-tampa-bay', 'DTSTAMP:' + dtStamp()]
  if (/^\d{4}-\d{2}-\d{2}$/.test(e.start)) {
    const s = parseDate(e.start)
    const last = new Date(e._endDay ?? e._day) // last day the event runs
    const dtend = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) // exclusive
    lines.push('DTSTART;VALUE=DATE:' + dOf(s), 'DTEND;VALUE=DATE:' + dOf(dtend))
  } else {
    const s = parseDate(e.start)
    lines.push('DTSTART:' + tOf(s))
    // timed end → literal; date-only end (timed-start festivals) → midnight
    // after the last day, matching DTSTART's DATE-TIME value type
    const en = e.end
      ? /T\d/.test(e.end)
        ? parseDate(e.end)
        : e._endDay != null && e._endDay > e._day
          ? new Date(new Date(e._endDay).getFullYear(), new Date(e._endDay).getMonth(), new Date(e._endDay).getDate() + 1)
          : null
      : null
    if (en && en.getTime() > s.getTime()) lines.push('DTEND:' + tOf(en))
  }
  lines.push(fold('SUMMARY:' + esc(e.title || 'Event')))
  const loc = [e.venue, e.address].filter(Boolean).join(', ')
  if (loc) lines.push(fold('LOCATION:' + esc(loc)))
  if (e.description) lines.push(fold('DESCRIPTION:' + esc(e.description)))
  if (e.url) lines.push(fold('URL:' + esc(e.url)))
  lines.push('END:VEVENT')
  return lines
}

// wrapIcs(bodies) — the VCALENDAR envelope around any number of VEVENT line
// arrays. The CRLF + trailing CRLF formatting matches the old single-event
// output byte-for-byte when given exactly one body.
export function wrapIcs(bodies) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Whats Hot Tampa Bay//EN', 'CALSCALE:GREGORIAN']
  for (const b of bodies) lines.push(...b)
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// one-event calendar (DetailPage's .ics download — the old icsText, unchanged
// output for any dated event) and a multi-event calendar (the day plan's ICS,
// one VEVENT per slot). vevent returns null for a dateless entry (a place), so
// both filter those out — a place is never a calendar line.
export const eventIcs = (e) => {
  const b = vevent(e)
  return wrapIcs(b ? [b] : [])
}
export const eventsIcs = (list) => wrapIcs(list.map(vevent).filter(Boolean))

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
  const dateLine = new Date(dayTs).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const lines = ['My plan for ' + dateLine + ' 🌴'] // DRAFT for Charles
  for (const { part, e } of picks) {
    const bits = [e.title, timeOf(e.start) || null, e.venue || null].filter(Boolean).join(' · ')
    lines.push((DAYPART[part]?.emoji ?? '🗓️') + ' ' + bits) // ⚑PLAN-P0: shared label map; safe fallback if a stale part slips through
  }
  return lines.join('\n')
}
