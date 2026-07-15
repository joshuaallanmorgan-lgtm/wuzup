// Shared city-calendar and event-actionability contract.
//
// This module is browser/Node safe and deliberately avoids the host machine's
// timezone. Calendar identity is always a YYYY-MM-DD string in an explicit IANA
// zone; elapsed milliseconds are used only for real instants and durations.

export const ASSUMED_EVENT_DURATION_MS = 3 * 60 * 60 * 1000
const MAX_INFERRED_OVERNIGHT_MS = 18 * 60 * 60 * 1000

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
const OFFSET_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):?(\d{2}))$/i
const FORMATTERS = new Map()
const OFFSET_CANDIDATES = new Map()

function validTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return true
  } catch {
    return false
  }
}

function requireTimeZone(timeZone) {
  if (!FORMATTERS.has(timeZone) && !validTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA time zone '${String(timeZone)}'`)
  }
  return timeZone
}

function formatter(timeZone) {
  if (FORMATTERS.has(timeZone)) return FORMATTERS.get(timeZone)
  requireTimeZone(timeZone)
  FORMATTERS.set(timeZone, new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }))
  return FORMATTERS.get(timeZone)
}

function validDayId(dayId) {
  if (typeof dayId !== 'string' || !DAY_RE.test(dayId)) return false
  const parsed = new Date(`${dayId}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dayId
}

function requireDayId(dayId) {
  if (!validDayId(dayId)) throw new RangeError(`Invalid calendar day '${String(dayId)}'`)
  return dayId
}

function zonedParts(epochMs, timeZone) {
  if (!Number.isFinite(epochMs)) throw new TypeError('epochMs must be finite')
  const values = {}
  for (const part of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

export function zonedDateTimeParts(epochMs, timeZone) {
  return zonedParts(epochMs, timeZone)
}

function partsDayId(parts) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`
}

function sameWallTime(actual, desired) {
  return actual.year === desired.year
    && actual.month === desired.month
    && actual.day === desired.day
    && actual.hour === desired.hour
    && actual.minute === desired.minute
    && actual.second === desired.second
}

function wallParts(dayId, hour, minute, second, millisecond = 0) {
  requireDayId(dayId)
  const [year, month, day] = dayId.split('-').map(Number)
  if (
    !Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59
    || !Number.isInteger(second) || second < 0 || second > 59
    || !Number.isInteger(millisecond) || millisecond < 0 || millisecond > 999
  ) {
    return null
  }
  return { year, month, day, hour, minute, second, millisecond }
}

function offsetAt(epochMs, timeZone) {
  const actual = zonedParts(epochMs, timeZone)
  const wallEpoch = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
  )
  return wallEpoch - Math.floor(epochMs / 1000) * 1000
}

function resolveWallTime(desired, timeZone, disambiguation) {
  const wallEpoch = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
    desired.millisecond,
  )
  const offsetKey = `${timeZone}|${partsDayId(desired)}`
  if (!OFFSET_CANDIDATES.has(offsetKey)) {
    const offsets = new Set()
    for (let hours = -48; hours <= 48; hours += 6) {
      offsets.add(offsetAt(wallEpoch + hours * 3600_000, timeZone))
    }
    OFFSET_CANDIDATES.set(offsetKey, [...offsets])
  }

  const matches = OFFSET_CANDIDATES.get(offsetKey)
    .map((offset) => wallEpoch - offset)
    .filter((candidate) => sameWallTime(zonedParts(candidate, timeZone), desired))
    .sort((a, b) => a - b)
    .filter((candidate, index, all) => index === 0 || candidate !== all[index - 1])

  if (!matches.length) return { ok: false, error: 'nonexistent-local-time' }
  if (matches.length > 1 && disambiguation === 'reject') {
    return { ok: false, error: 'ambiguous-local-time' }
  }
  const epochMs = disambiguation === 'later' ? matches[matches.length - 1] : matches[0]
  return { ok: true, epochMs, ambiguous: matches.length > 1 }
}

export function addCalendarDays(dayId, amount) {
  requireDayId(dayId)
  if (!Number.isInteger(amount)) throw new TypeError('calendar-day amount must be an integer')
  const date = new Date(`${dayId}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function weekdayOf(dayId) {
  requireDayId(dayId)
  return new Date(`${dayId}T00:00:00Z`).getUTCDay()
}

export function dayIdAt(epochMs, timeZone) {
  return partsDayId(zonedParts(epochMs, timeZone))
}

export function cityHourAt(epochMs, timeZone) {
  return zonedParts(epochMs, timeZone).hour
}

export function formatInstant(epochMs, { timeZone, locale = 'en-US', ...options } = {}) {
  requireTimeZone(timeZone)
  if (!Number.isFinite(epochMs)) throw new TypeError('epochMs must be finite')
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(new Date(epochMs))
}

export function formatDay(dayId, { timeZone, locale = 'en-US', ...options } = {}) {
  requireDayId(dayId)
  return formatInstant(cityMidnightMs(dayId, timeZone), { timeZone, locale, ...options })
}

export function parseZonedDateTime(value, timeZone, { disambiguation = 'earlier' } = {}) {
  requireTimeZone(timeZone)
  if (!['earlier', 'later', 'reject'].includes(disambiguation)) {
    throw new TypeError(`Invalid disambiguation '${String(disambiguation)}'`)
  }
  if (typeof value !== 'string') return { ok: false, error: 'invalid-datetime' }

  const offsetMatch = value.match(OFFSET_TIME_RE)
  if (offsetMatch) {
    const millisecond = Number((offsetMatch[5] || '').padEnd(3, '0') || 0)
    let desired
    try {
      desired = wallParts(
        offsetMatch[1],
        Number(offsetMatch[2]),
        Number(offsetMatch[3]),
        Number(offsetMatch[4] || 0),
        millisecond,
      )
    } catch {
      return { ok: false, error: 'invalid-datetime' }
    }
    if (!desired) return { ok: false, error: 'invalid-datetime' }

    let offsetMinutes = 0
    if (offsetMatch[6].toUpperCase() !== 'Z') {
      const offsetHour = Number(offsetMatch[8])
      const offsetMinute = Number(offsetMatch[9])
      if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
        return { ok: false, error: 'invalid-datetime' }
      }
      offsetMinutes = (offsetHour * 60 + offsetMinute) * (offsetMatch[7] === '+' ? 1 : -1)
    }
    const epochMs = Date.UTC(
      desired.year,
      desired.month - 1,
      desired.day,
      desired.hour,
      desired.minute,
      desired.second,
      desired.millisecond,
    ) - offsetMinutes * 60_000
    return {
      ok: true,
      epochMs,
      dayId: dayIdAt(epochMs, timeZone),
      ambiguous: false,
      source: 'offset',
    }
  }

  const match = value.match(LOCAL_TIME_RE)
  if (!match) return { ok: false, error: 'invalid-datetime' }
  const millisecond = Number((match[5] || '').padEnd(3, '0') || 0)
  let desired
  try {
    desired = wallParts(match[1], Number(match[2]), Number(match[3]), Number(match[4] || 0), millisecond)
  } catch {
    return { ok: false, error: 'invalid-datetime' }
  }
  if (!desired) return { ok: false, error: 'invalid-datetime' }

  const resolved = resolveWallTime(desired, timeZone, disambiguation)
  if (!resolved.ok) return resolved
  return {
    ...resolved,
    dayId: partsDayId(desired),
    source: 'local',
  }
}

export function cityMidnightMs(dayId, timeZone) {
  requireDayId(dayId)
  const parsed = parseZonedDateTime(`${dayId}T00:00:00`, timeZone)
  if (!parsed.ok) throw new RangeError(`Calendar midnight is not representable for ${dayId} in ${timeZone}`)
  return parsed.epochMs
}

function endpoint(value, timeZone, disambiguation) {
  if (typeof value !== 'string' || !value) return { ok: false, error: 'invalid-datetime' }
  if (validDayId(value)) {
    return {
      ok: true,
      epochMs: cityMidnightMs(value, timeZone),
      dayId: value,
      dateOnly: true,
      ambiguous: false,
    }
  }
  const parsed = parseZonedDateTime(value, timeZone, { disambiguation })
  return parsed.ok ? { ...parsed, dateOnly: false } : parsed
}

export function eventTime(event, {
  timeZone,
  assumedDurationMs = ASSUMED_EVENT_DURATION_MS,
  startDisambiguation = 'earlier',
  endDisambiguation = 'later',
} = {}) {
  requireTimeZone(timeZone)
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, error: 'invalid-event' }
  }
  if (!Number.isFinite(assumedDurationMs) || assumedDurationMs <= 0) {
    throw new TypeError('assumedDurationMs must be a positive finite number')
  }

  const start = endpoint(event.start, timeZone, startDisambiguation)
  if (!start.ok) return { ok: false, error: start.error === 'invalid-datetime' ? 'invalid-start' : start.error }

  let endAt
  let endDay
  let assumedEnd = false
  let ambiguousEnd = false
  let inferredOvernightEnd = false

  if (!event.end) {
    if (start.dateOnly) {
      endDay = start.dayId
      endAt = cityMidnightMs(addCalendarDays(start.dayId, 1), timeZone)
    } else {
      endAt = start.epochMs + assumedDurationMs
      endDay = dayIdAt(endAt - 1, timeZone)
      assumedEnd = true
    }
  } else {
    let end = endpoint(event.end, timeZone, endDisambiguation)
    if (!end.ok) return { ok: false, error: end.error === 'invalid-datetime' ? 'invalid-end' : end.error }
    if (start.dateOnly && !end.dateOnly) return { ok: false, error: 'mixed-precision' }

    if (
      !start.dateOnly
      && !end.dateOnly
      && start.source === 'local'
      && end.source === 'local'
      && start.dayId === end.dayId
      && end.epochMs < start.epochMs
    ) {
      const rolledValue = addCalendarDays(end.dayId, 1) + event.end.slice(10)
      const rolled = endpoint(rolledValue, timeZone, endDisambiguation)
      const duration = rolled.ok ? rolled.epochMs - start.epochMs : NaN
      if (duration > 0 && duration <= MAX_INFERRED_OVERNIGHT_MS) {
        end = rolled
        inferredOvernightEnd = true
      }
    }

    ambiguousEnd = end.ambiguous === true
    if (end.dateOnly) {
      endDay = end.dayId
      endAt = cityMidnightMs(addCalendarDays(end.dayId, 1), timeZone)
    } else {
      endAt = end.epochMs
      endDay = dayIdAt(endAt - 1, timeZone)
    }
  }

  if (!start.dateOnly && event.end && endAt === start.epochMs) {
    endAt = start.epochMs + assumedDurationMs
    endDay = dayIdAt(endAt - 1, timeZone)
    assumedEnd = true
  }

  if (endAt < start.epochMs || endDay < start.dayId) {
    return { ok: false, error: 'end-before-start' }
  }

  return {
    ok: true,
    timeZone,
    kind: start.dateOnly ? 'all-day' : 'timed',
    startDay: start.dayId,
    endDay,
    startAt: start.epochMs,
    endAt,
    assumedEnd,
    ambiguousStart: start.ambiguous === true,
    inferredOvernightEnd,
    ambiguousEnd,
  }
}

export function eventAvailability(canonical, { nowMs = Date.now(), status = 'unknown' } = {}) {
  if (!canonical?.ok || !Number.isFinite(canonical.endAt) || !Number.isFinite(nowMs)) {
    return { code: 'invalid', actionable: false }
  }
  const folded = String(status || 'unknown').toLowerCase().replace(/[\s_]+/g, '-')
  if (/eventcancelled|cancell?ed/.test(folded)) return { code: 'cancelled', actionable: false }
  if (/eventpostponed|postponed/.test(folded)) return { code: 'postponed', actionable: false }
  if (/eventsoldout|sold-?out/.test(folded)) return { code: 'sold-out', actionable: false }
  if (nowMs >= canonical.endAt) return { code: 'ended', actionable: false }
  return { code: 'actionable', actionable: true }
}

export function eventActionability(event, options = {}) {
  const {
    nowMs = Date.now(),
    status = event?.status,
    ...timeOptions
  } = options
  const time = eventTime(event, timeOptions)
  return {
    time,
    ...eventAvailability(time, { nowMs, status }),
  }
}

export function coversDay(canonical, dayId) {
  if (!canonical?.ok || !validDayId(dayId)) return false
  return canonical.startDay <= dayId && dayId <= canonical.endDay
}

export function daypartOfTime(canonical) {
  if (!canonical?.ok || canonical.kind === 'all-day') return 'any'
  const hour = zonedParts(canonical.startAt, canonical.timeZone).hour
  if (hour >= 5 && hour < 13) return 'morning'
  if (hour >= 13 && hour < 17) return 'afternoon'
  return 'night'
}

export function cityClock({ timeZone, nowMs = Date.now() } = {}) {
  requireTimeZone(timeZone)
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite')
  const parts = zonedParts(nowMs, timeZone)
  const today = partsDayId(parts)
  const tomorrow = addCalendarDays(today, 1)
  const day = weekdayOf(today)
  const fridayOffset = day === 0 ? -2 : day === 6 ? -1 : 5 - day
  const weekendStart = addCalendarDays(today, fridayOffset)
  const weekendEnd = addCalendarDays(weekendStart, 2)
  return {
    nowMs,
    timeZone,
    today,
    tomorrow,
    weekendStart,
    weekendEnd,
    cityHour: parts.hour,
    cityMinute: parts.minute,
    nextMidnightMs: cityMidnightMs(tomorrow, timeZone),
  }
}

export function monthStart(dayId, offset = 0) {
  requireDayId(dayId)
  if (!Number.isInteger(offset)) throw new TypeError('calendar-month offset must be an integer')
  const [year, month] = dayId.split('-').map(Number)
  const absoluteMonth = year * 12 + month - 1 + offset
  const nextYear = Math.floor(absoluteMonth / 12)
  const nextMonth = ((absoluteMonth % 12) + 12) % 12 + 1
  if (nextYear < 0 || nextYear > 9999) {
    throw new RangeError('calendar-month result is outside supported years')
  }
  return String(nextYear).padStart(4, '0') + '-' + String(nextMonth).padStart(2, '0') + '-01'
}

export function calendarDayDiff(fromDayId, toDayId) {
  requireDayId(fromDayId)
  requireDayId(toDayId)
  const from = Date.parse(fromDayId + 'T00:00:00Z')
  const to = Date.parse(toDayId + 'T00:00:00Z')
  return (to - from) / 86400000
}

export function daysInMonth(dayId) {
  const start = monthStart(dayId)
  return calendarDayDiff(start, monthStart(start, 1))
}
