import {
  addCalendarDays,
  calendarDayDiff,
  cityClock,
  eventActionability,
  eventTime,
} from '../shared/city-time.mjs'

function requireNowMs(nowMs) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite')
  return nowMs
}

// Stable-id v1 is deliberately based on the literal day a publisher emitted,
// not the day that instant projects onto in a city's timezone. Keep this seam
// narrow so product calendar semantics can evolve without churning identity.
export function publishedDayOf(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/)
  if (!match) return null
  try {
    addCalendarDays(match[1], 0)
    return match[1]
  } catch {
    return null
  }
}

export function finderEventTime(event, { timeZone } = {}) {
  return eventTime(event, { timeZone })
}

export function canonicalDayOf(value, timeZone) {
  const canonical = finderEventTime({ start: value }, { timeZone })
  return canonical.ok ? canonical.startDay : null
}

export function finderEventState(event, { timeZone, nowMs } = {}) {
  requireNowMs(nowMs)
  return eventActionability(event, { timeZone, nowMs })
}

export function generationContext({ timeZone, nowMs } = {}) {
  requireNowMs(nowMs)
  const clock = cityClock({ timeZone, nowMs })
  return {
    nowMs,
    generatedAt: new Date(nowMs).toISOString(),
    today: clock.today,
    weekendDays: [
      clock.weekendStart,
      addCalendarDays(clock.weekendStart, 1),
      clock.weekendEnd,
    ],
  }
}

export function calendarDistance(fromDay, toDay) {
  return calendarDayDiff(fromDay, toDay)
}

function explicitEndEvents(events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.end !== null && event?.end !== undefined && event.end !== '')
}

function compareEventFacts(a, b) {
  const keyOf = (event) => [event.end, event.start, event.source, event.url]
    .map((value) => String(value ?? ''))
    .join('\u0000')
  const aKey = keyOf(a)
  const bKey = keyOf(b)
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

// Start and end facts from different publishers must form one valid interval
// before they can be combined. If no explicit end is valid against both its
// own start and the selected merged start, keep the latest valid member pair.
// Only when every explicit member is invalid do we retain one deterministic
// invalid pair so the final actionability gate rejects it. Keeping only its
// raw end could turn a reversed range into an equal-time assumed range.
export function selectMergedInterval(events, timeZone, preferredStart) {
  const explicit = (Array.isArray(events) ? events : [])
  const selectedStart = preferredStart
    ?? explicit.find((event) => event?.start)?.start
    ?? null
  const ends = explicitEndEvents(explicit)

  let latest = null
  let latestAt = -Infinity
  const ownValid = []
  for (const event of ends) {
    const own = finderEventTime(event, { timeZone })
    if (!own.ok) continue
    ownValid.push({ event, canonical: own })
    const canonical = finderEventTime({ start: selectedStart, end: event.end }, { timeZone })
    if (canonical.ok && canonical.endAt > latestAt) {
      latest = event.end
      latestAt = canonical.endAt
    }
  }
  if (latest !== null) return { start: selectedStart, end: latest }

  if (ownValid.length) {
    ownValid.sort((a, b) =>
      b.canonical.endAt - a.canonical.endAt || compareEventFacts(a.event, b.event))
    return { start: ownValid[0].event.start, end: ownValid[0].event.end }
  }

  const fallback = ends.slice().sort(compareEventFacts)[0]
  if (fallback) return { start: fallback.start ?? selectedStart, end: fallback.end }
  return { start: selectedStart, end: null }
}

export function selectLatestExplicitEnd(events, timeZone) {
  return selectMergedInterval(events, timeZone).end
}
