// Pure Sprint 5 source/corpus observability contract. This deliberately does
// not infer health from live requests, source names, or event IDs: ingestion
// must retain those facts explicitly before a report can call them ready.

export const SOURCE_HEALTH_SCHEMA_VERSION = 1

const HEALTH_STATUSES = new Set(['healthy', 'degraded', 'failed', 'unknown'])
const RECURRENCE_KINDS = new Set(['one-off', 'recurring'])
const RANGE_SEMANTICS = new Set(['all-day', 'continuous', 'occurrence', 'single'])
const SIGNALS = [
  'sourceFamily',
  'organizer',
  'status',
  'rawCategories',
  'description',
  'imageRank',
  'osmProvenance',
  'brand',
  'governmentBacking',
]

function array(value) {
  return Array.isArray(value) ? value : []
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

function aggregateStatus(statuses) {
  if (statuses.length === 0 || statuses.includes('unknown')) return 'unknown'
  if (statuses.every((status) => status === 'failed')) return 'failed'
  if (statuses.includes('failed') || statuses.includes('degraded')) return 'degraded'
  return 'healthy'
}

function familyOfReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null
  return nonEmptyString(receipt.sourceFamily)
    ? receipt.sourceFamily.trim()
    : nonEmptyString(receipt.source)
      ? receipt.source.trim()
      : nonEmptyString(receipt.name)
        ? receipt.name.trim()
        : null
}

function familyOfEvent(event) {
  return event && typeof event === 'object' && !Array.isArray(event) && nonEmptyString(event.sourceFamily)
    ? event.sourceFamily.trim()
    : null
}

function receiptStatus(receipt) {
  return HEALTH_STATUSES.has(receipt?.status) ? receipt.status : 'unknown'
}

function sourceReport(expectedSourceFamilies, sourceReceipts, events) {
  const expected = [...new Set(array(expectedSourceFamilies).filter(nonEmptyString).map((value) => value.trim()))].sort()
  const receiptsByFamily = new Map()
  for (const receipt of array(sourceReceipts)) {
    const family = familyOfReceipt(receipt)
    if (!family) continue
    if (!receiptsByFamily.has(family)) receiptsByFamily.set(family, [])
    receiptsByFamily.get(family).push(receipt)
  }

  const eventCounts = new Map()
  let unknownFamilyEvents = 0
  for (const event of events) {
    const family = familyOfEvent(event)
    if (!family) unknownFamilyEvents += 1
    else eventCounts.set(family, (eventCounts.get(family) || 0) + 1)
  }

  const families = [...new Set([...expected, ...receiptsByFamily.keys(), ...eventCounts.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((family) => {
      const receipts = receiptsByFamily.get(family) || []
      const statuses = receipts.map(receiptStatus)
      return {
        family,
        expected: expected.includes(family),
        receiptCount: receipts.length,
        status: aggregateStatus(statuses),
        eventCount: eventCounts.get(family) || 0,
      }
    })

  const expectedRows = families.filter((row) => row.expected)
  const statuses = expectedRows.map((row) => row.status)
  const receipted = expectedRows.filter((row) => row.receiptCount > 0).map((row) => row.family)
  const missing = expectedRows.filter((row) => row.receiptCount === 0).map((row) => row.family)
  const sourceHealth = {
    status: expected.length === 0 ? 'unknown' : aggregateStatus(statuses),
    expectedFamilies: expected,
    receiptCoverage: {
      expected: expected.length,
      receipted: receipted.length,
      missing,
      complete: expected.length > 0 && missing.length === 0,
    },
    families,
  }

  const identifiedEvents = events.length - unknownFamilyEvents
  const maxCount = eventCounts.size === 0 ? 0 : Math.max(...eventCounts.values())
  const dominantFamilies = [...eventCounts.entries()]
    .filter(([, count]) => count === maxCount)
    .map(([family]) => family)
    .sort((a, b) => a.localeCompare(b))
  const primaryPlacementConcentration = {
    totalEvents: events.length,
    identifiedEvents,
    unknownFamilyEvents,
    sourceFamilyCoverage: ratio(identifiedEvents, events.length),
    distinctFamilies: eventCounts.size,
    observedMaxShare: ratio(maxCount, identifiedEvents),
    // A launch gate must not treat partial source attribution as a complete
    // concentration measurement.
    maxShare: unknownFamilyEvents === 0 ? ratio(maxCount, events.length) : null,
    dominantFamilies,
    familyCounts: Object.fromEntries([...eventCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  }

  const corroboratingCounts = new Map()
  let corroboratedEvents = 0
  let unknownSourceFamiliesEvents = 0
  let invalidSourceFamiliesEvents = 0
  let multiFamilyEvents = 0
  for (const event of events) {
    const families = event?.sourceFamilies
    if (!Array.isArray(families) || families.length === 0) {
      unknownSourceFamiliesEvents += 1
      continue
    }
    if (!families.every(nonEmptyString)) {
      invalidSourceFamiliesEvents += 1
      continue
    }
    const unique = [...new Set(families.map((family) => family.trim()))]
    corroboratedEvents += 1
    if (unique.length > 1) multiFamilyEvents += 1
    for (const family of unique) corroboratingCounts.set(family, (corroboratingCounts.get(family) || 0) + 1)
  }
  const corroboratingMaxCount = corroboratingCounts.size === 0 ? 0 : Math.max(...corroboratingCounts.values())
  const corroboratingSourceConcentration = {
    totalEvents: events.length,
    identifiedEvents: corroboratedEvents,
    unknownSourceFamiliesEvents,
    invalidSourceFamiliesEvents,
    sourceFamiliesCoverage: ratio(corroboratedEvents, events.length),
    multiFamilyEvents,
    totalAssignments: [...corroboratingCounts.values()].reduce((total, count) => total + count, 0),
    distinctFamilies: corroboratingCounts.size,
    observedMaxShare: ratio(corroboratingMaxCount, corroboratedEvents),
    maxShare: unknownSourceFamiliesEvents === 0 && invalidSourceFamiliesEvents === 0
      ? ratio(corroboratingMaxCount, events.length)
      : null,
    dominantFamilies: [...corroboratingCounts.entries()]
      .filter(([, count]) => count === corroboratingMaxCount)
      .map(([family]) => family)
      .sort((a, b) => a.localeCompare(b)),
    familyCounts: Object.fromEntries([...corroboratingCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  }
  return {
    sourceHealth,
    sourceConcentration: primaryPlacementConcentration,
    primaryPlacementConcentration,
    corroboratingSourceConcentration,
  }
}

function signalState(event, signal) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'invalid'
  const own = (key) => Object.hasOwn(event, key)
  if (signal === 'description') {
    if (typeof event.description === 'string') return event.description.trim() ? 'known' : 'recorded'
    if (Number.isInteger(event.descriptionLength) && event.descriptionLength >= 0) {
      return event.descriptionLength > 0 ? 'known' : 'recorded'
    }
    return own('description') || own('descriptionLength') ? 'invalid' : 'missing'
  }
  if (signal === 'rawCategories') {
    if (!own(signal)) return 'missing'
    if (!Array.isArray(event[signal])) return 'invalid'
    return event[signal].some(nonEmptyString) ? 'known' : 'recorded'
  }
  if (signal === 'governmentBacking') {
    if (!own(signal)) return 'missing'
    return typeof event[signal] === 'boolean' ? 'known' : 'invalid'
  }
  if (signal === 'osmProvenance') {
    if (!own(signal)) return 'missing'
    if (nonEmptyString(event[signal])) return 'known'
    return event[signal] && typeof event[signal] === 'object' && !Array.isArray(event[signal]) ? 'known' : 'invalid'
  }
  if (signal === 'imageRank') {
    if (!own(signal)) return 'missing'
    return nonEmptyString(event[signal]) || Number.isFinite(event[signal]) ? 'known' : 'invalid'
  }
  if (signal === 'status') {
    if (!own(signal)) return 'missing'
    if (event[signal] === 'unknown') return 'recorded'
    return ['scheduled', 'cancelled', 'postponed', 'sold_out'].includes(event[signal]) ? 'known' : 'invalid'
  }
  if (!own(signal)) return 'missing'
  return nonEmptyString(event[signal]) ? 'known' : 'invalid'
}

function retainedSignals(events) {
  const fields = {}
  for (const signal of SIGNALS) {
    const counts = { known: 0, recorded: 0, missing: 0, invalid: 0 }
    for (const event of events) counts[signalState(event, signal)] += 1
    fields[signal] = {
      ...counts,
      retained: counts.known + counts.recorded,
      completeness: ratio(counts.known + counts.recorded, events.length),
      knownCompleteness: ratio(counts.known, events.length),
    }
  }
  return { totalEvents: events.length, fields }
}

function actionability(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'invalid'
  if (!Object.hasOwn(event, 'actionability')) return 'unknown'
  if (event.actionability === true) return 'actionable'
  if (event.actionability === false) return 'notActionable'
  return 'invalid'
}

function recurrence(event) {
  const value = event?.recurrence
  if (value == null) return { kind: 'unknown', ruleBacked: false }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !RECURRENCE_KINDS.has(value.kind)) {
    return { kind: 'invalid', ruleBacked: false }
  }
  return {
    kind: value.kind,
    ruleBacked: value.kind === 'recurring' && nonEmptyString(value.rule),
  }
}

function range(event) {
  const value = event?.range
  if (value == null) return 'unknown'
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid'
  if (!RANGE_SEMANTICS.has(value.semantics) || !nonEmptyString(value.start)) return 'invalid'
  if (value.semantics === 'continuous' && !nonEmptyString(value.end)) return 'invalid'
  if (value.end != null && !nonEmptyString(value.end)) return 'invalid'
  return 'normalized'
}

function identityAndRecurrence(events) {
  const canonical = { identified: 0, unknown: 0, invalid: 0 }
  const series = { identified: 0, notApplicable: 0, unknown: 0, invalid: 0 }
  const recurrenceCounts = { oneOff: 0, recurring: 0, unknown: 0, invalid: 0, recurringWithRule: 0 }
  const ranges = { normalized: 0, unknown: 0, invalid: 0 }
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) canonical.invalid += 1
    else if (!Object.hasOwn(event, 'canonicalId')) canonical.unknown += 1
    else if (nonEmptyString(event.canonicalId)) canonical.identified += 1
    else canonical.invalid += 1

    const recurrenceState = recurrence(event)
    if (recurrenceState.kind === 'one-off') recurrenceCounts.oneOff += 1
    else if (recurrenceState.kind === 'recurring') {
      recurrenceCounts.recurring += 1
      if (recurrenceState.ruleBacked) recurrenceCounts.recurringWithRule += 1
    } else recurrenceCounts[recurrenceState.kind] += 1

    if (recurrenceState.kind === 'one-off') series.notApplicable += 1
    else if (!event || typeof event !== 'object' || Array.isArray(event)) series.invalid += 1
    else if (!Object.hasOwn(event, 'seriesId')) series.unknown += 1
    else if (nonEmptyString(event.seriesId)) series.identified += 1
    else series.invalid += 1
    ranges[range(event)] += 1
  }
  return { canonical, series, recurrence: recurrenceCounts, range: ranges }
}

function readiness(events, sourceHealth, concentration, actionabilityCounts, identity) {
  const blockers = []
  if (events.length === 0) blockers.push('NO_EVENTS')
  if (sourceHealth.status !== 'healthy') blockers.push(`SOURCE_HEALTH_${sourceHealth.status.toUpperCase()}`)
  if (concentration.sourceFamilyCoverage !== 1) blockers.push('SOURCE_FAMILY_UNKNOWN')
  if (actionabilityCounts.unknown > 0) blockers.push('ACTIONABILITY_UNKNOWN')
  if (actionabilityCounts.invalid > 0) blockers.push('ACTIONABILITY_INVALID')
  if (actionabilityCounts.notActionable > 0) blockers.push('NON_ACTIONABLE_ROWS')
  if (identity.canonical.unknown > 0) blockers.push('CANONICAL_ID_UNKNOWN')
  if (identity.canonical.invalid > 0) blockers.push('CANONICAL_ID_INVALID')
  if (identity.series.unknown > 0) blockers.push('SERIES_ID_UNKNOWN')
  if (identity.series.invalid > 0) blockers.push('SERIES_ID_INVALID')
  if (identity.recurrence.unknown > 0) blockers.push('RECURRENCE_UNKNOWN')
  if (identity.recurrence.invalid > 0) blockers.push('RECURRENCE_INVALID')
  if (identity.range.unknown > 0) blockers.push('RANGE_UNKNOWN')
  if (identity.range.invalid > 0) blockers.push('RANGE_INVALID')
  const unknown = blockers.some((code) => /UNKNOWN|NO_EVENTS/.test(code))
  return {
    state: blockers.length === 0 ? 'ready' : unknown ? 'unknown' : 'limited',
    rankable: blockers.length === 0,
    blockers,
  }
}

/**
 * Summarize normalized source receipts and retained event signals without
 * fetching, ranking, or rewriting data. `sourceFamily`, `canonicalId`,
 * `seriesId`, `actionability`, `recurrence`, and `range` are intentionally
 * explicit integration seams; legacy event fields are not silently promoted.
 */
export function summarizeSourceHealth({
  expectedSourceFamilies = [],
  sourceReceipts = [],
  events = [],
} = {}) {
  const rows = array(events)
  const source = sourceReport(expectedSourceFamilies, sourceReceipts, rows)
  const signals = retainedSignals(rows)
  const actionabilityCounts = { actionable: 0, notActionable: 0, unknown: 0, invalid: 0 }
  for (const event of rows) actionabilityCounts[actionability(event)] += 1
  const identity = identityAndRecurrence(rows)
  return {
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    ...source,
    actionability: {
      ...actionabilityCounts,
      known: actionabilityCounts.actionable + actionabilityCounts.notActionable,
      knownCompleteness: ratio(actionabilityCounts.actionable + actionabilityCounts.notActionable, rows.length),
    },
    retainedSignals: signals,
    identity,
    readiness: readiness(rows, source.sourceHealth, source.sourceConcentration, actionabilityCounts, identity),
  }
}
