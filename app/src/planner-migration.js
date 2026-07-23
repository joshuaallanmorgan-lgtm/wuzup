// planner-migration.js — pure V1 day/weekend planner projection into the V2
// atomic planner document. Storage, retries, and destination-first persistence
// belong to planner-store.js; this module only translates explicit inputs.

import {
  addCalendarDays,
  cityMidnightMs,
  dayIdAt,
} from '../../shared/city-time.mjs'
import { fmtLocale } from './city.js'
import { identityRefOf, isCustomEvent } from './identity.js'
import { migrateV1IdentityState } from './identity-migration.js'
import {
  PLANNER_DOCUMENT_MAX_BYTES,
  PLANNER_HISTORY_CAP,
  PLANNER_PARTS,
  normalizePlannerDocument,
  plannerDocumentBytes,
  rolloverPlanner,
  slotRefOf,
} from './planner-core.js'

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const isDayTs = (value) => Number.isInteger(value) && value > 0
const usableKey = (value) => typeof value === 'string' && value.length > 0 && value !== '|'
const emptySlots = () => ({ morning: null, afternoon: null, night: null })
const blankEntry = () => ({ state: null, slots: emptySlots(), done: false })

function requireTimeZone(value, label, locale = fmtLocale) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} must be an IANA time zone`)
  try {
    new Intl.DateTimeFormat(locale, { timeZone: value }).format(0)
  } catch {
    throw new RangeError(`${label} must be a valid IANA time zone`)
  }
  return value
}

function requireCity(city) {
  if (!isObject(city) || typeof city.id !== 'string' || !city.id) {
    throw new TypeError('city must include a non-empty id')
  }
  const locale = typeof city.locale === 'string' && city.locale ? city.locale : fmtLocale
  return { id: city.id, tz: requireTimeZone(city.tz, 'city.tz', locale), locale }
}

function requireCityMidnight(value, timeZone, label) {
  if (!isDayTs(value)) throw new TypeError(`${label} must be a positive integer`)
  const dayId = dayIdAt(value, timeZone)
  if (cityMidnightMs(dayId, timeZone) !== value) {
    throw new RangeError(`${label} must be midnight in city.tz`)
  }
  return value
}

function projectDayTs(value, cityTimeZone, sourceTimeZone) {
  const sourceTs = Number(value)
  if (!isDayTs(sourceTs)) return null
  try {
    const cityDay = dayIdAt(sourceTs, cityTimeZone)
    if (cityMidnightMs(cityDay, cityTimeZone) === sourceTs) {
      return { sourceTs, targetTs: sourceTs, canonical: true }
    }
    const sourceDay = dayIdAt(sourceTs, sourceTimeZone)
    if (cityMidnightMs(sourceDay, sourceTimeZone) !== sourceTs) return null
    return {
      sourceTs,
      targetTs: cityMidnightMs(sourceDay, cityTimeZone),
      canonical: false,
    }
  } catch {
    return null
  }
}

function slotKey(value) {
  return usableKey(value) ? value : null
}

function normalizeLegacyEntry(value) {
  if (!isObject(value) || value.v !== 1 || !isObject(value.slots)) return null
  const morning = slotKey(value.slots.morning)
  const explicitAfternoon = slotKey(value.slots.afternoon)
  const legacyDay = slotKey(value.slots.day)
  const afternoon = explicitAfternoon || legacyDay
  const night = slotKey(value.slots.night)
  const slots = { morning, afternoon, night }
  const hasSlot = PLANNER_PARTS.some((part) => slots[part])
  const state = value.state === 'rest' && !hasSlot ? 'rest' : null
  const done = value.done === true
  if (!state && !hasSlot && !done) return null
  return {
    entry: { state, slots, done },
    binaryDay: Boolean(legacyDay),
    binaryConflict: Boolean(legacyDay && explicitAfternoon && legacyDay !== explicitAfternoon),
  }
}

function mergeRows(rows, store, diagnostics) {
  const entry = blankEntry()
  const provenance = {}
  for (const row of rows) {
    entry.done ||= row.entry.done
    if (!entry.state && row.entry.state === 'rest') entry.state = 'rest'
    for (const part of PLANNER_PARTS) {
      const incoming = row.entry.slots[part]
      if (!incoming) continue
      if (!entry.slots[part]) {
        entry.slots[part] = incoming
        provenance[part] = row
        continue
      }
      if (entry.slots[part] === incoming) continue
      const kept = provenance[part]
      diagnostics.collisions.push({
        store,
        dayTs: row.targetTs,
        part,
        kept: entry.slots[part],
        dropped: incoming,
        keptCanonical: kept?.canonical === true,
        droppedCanonical: row.canonical === true,
      })
    }
  }
  if (PLANNER_PARTS.some((part) => entry.slots[part])) entry.state = null
  return entry
}

function sortProjectedRows(left, right) {
  return left.targetTs - right.targetTs
    || Number(right.canonical) - Number(left.canonical)
    || left.index - right.index
}

function projectPlanMap(value, cityTimeZone, sourceTimeZone, diagnostics) {
  const source = isObject(value) ? value : {}
  const summary = {
    input: Object.keys(source).length,
    accepted: 0,
    invalid: 0,
    projected: 0,
    binaryEntries: 0,
    binaryConflicts: 0,
    collisions: 0,
  }
  const rows = []
  Object.entries(source).forEach(([key, value], index) => {
    const projected = projectDayTs(key, cityTimeZone, sourceTimeZone)
    const normalized = normalizeLegacyEntry(value)
    if (!projected || !normalized) {
      summary.invalid += 1
      diagnostics.invalidDays.push({ store: 'dayPlans', path: [key], dayTs: key })
      return
    }
    summary.accepted += 1
    if (!projected.canonical) summary.projected += 1
    if (normalized.binaryDay) summary.binaryEntries += 1
    if (normalized.binaryConflict) summary.binaryConflicts += 1
    rows.push({ ...projected, ...normalized, index })
  })
  rows.sort(sortProjectedRows)

  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.targetTs)) grouped.set(row.targetTs, [])
    grouped.get(row.targetTs).push(row)
  }
  const out = {}
  const before = diagnostics.collisions.length
  for (const [dayTs, group] of grouped) {
    out[String(dayTs)] = mergeRows(group, 'dayPlans', diagnostics)
  }
  summary.collisions = diagnostics.collisions.length - before
  return { value: out, summary }
}

function projectHistory(value, cityTimeZone, sourceTimeZone, diagnostics) {
  const source = Array.isArray(value) ? value : []
  const summary = {
    input: source.length,
    accepted: 0,
    invalid: 0,
    projected: 0,
    binaryEntries: 0,
    binaryConflicts: 0,
    collisions: 0,
  }
  const rows = []
  source.forEach((value, index) => {
    const projected = projectDayTs(value?.dayTs, cityTimeZone, sourceTimeZone)
    const normalized = normalizeLegacyEntry(value)
    if (!projected || !normalized) {
      summary.invalid += 1
      diagnostics.invalidDays.push({ store: 'dayHistory', path: [index], dayTs: value?.dayTs ?? null })
      return
    }
    summary.accepted += 1
    if (!projected.canonical) summary.projected += 1
    if (normalized.binaryDay) summary.binaryEntries += 1
    if (normalized.binaryConflict) summary.binaryConflicts += 1
    rows.push({ ...projected, ...normalized, index })
  })
  rows.sort(sortProjectedRows)

  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.targetTs)) grouped.set(row.targetTs, [])
    grouped.get(row.targetTs).push(row)
  }
  const out = []
  const before = diagnostics.collisions.length
  for (const [dayTs, group] of grouped) {
    out.push({ dayTs, ...mergeRows(group, 'dayHistory', diagnostics) })
  }
  summary.collisions = diagnostics.collisions.length - before
  return { value: out, summary }
}

function foldWeekendPlan(
  active,
  value,
  { cityTimeZone, sourceTimeZone, weekendStartTs },
  diagnostics,
) {
  const summary = {
    status: value == null ? 'absent' : 'invalid',
    sourceWeekendStartTs: null,
    targetWeekendStartTs: null,
    projected: false,
    inputSlots: 0,
    foldedSlots: 0,
    occupiedSlots: 0,
    discardedSlots: 0,
    done: false,
  }
  if (value == null) return summary
  if (!isObject(value) || value.v !== 1 || !isObject(value.slots)) return summary

  const projected = projectDayTs(value.weekendStartTs, cityTimeZone, sourceTimeZone)
  if (!projected) return summary
  summary.sourceWeekendStartTs = projected.sourceTs
  summary.targetWeekendStartTs = projected.targetTs
  summary.projected = !projected.canonical
  summary.done = value.done === true

  const dayIds = ['fri', 'sat', 'sun']
  const slotMap = { day: 'afternoon', night: 'night' }
  const sourceSlots = []
  for (let dayIndex = 0; dayIndex < dayIds.length; dayIndex += 1) {
    for (const [legacyPart, part] of Object.entries(slotMap)) {
      const key = slotKey(value.slots[`${dayIds[dayIndex]}_${legacyPart}`])
      if (key) sourceSlots.push({ dayIndex, legacyPart, part, key })
    }
  }
  summary.inputSlots = sourceSlots.length

  if (projected.targetTs < weekendStartTs) {
    summary.status = 'discarded-past'
    summary.discardedSlots = sourceSlots.length
    return summary
  }

  summary.status = 'folded'
  const startDay = dayIdAt(projected.targetTs, cityTimeZone)
  for (const sourceSlot of sourceSlots) {
    const dayId = addCalendarDays(startDay, sourceSlot.dayIndex)
    const dayTs = cityMidnightMs(dayId, cityTimeZone)
    const key = String(dayTs)
    const current = active[key] || blankEntry()
    if (current.slots[sourceSlot.part]) {
      summary.occupiedSlots += 1
      diagnostics.collisions.push({
        store: 'weekendPlan',
        dayTs,
        part: sourceSlot.part,
        kept: current.slots[sourceSlot.part],
        dropped: sourceSlot.key,
        keptCanonical: true,
        droppedCanonical: projected.canonical,
      })
      continue
    }
    active[key] = {
      ...current,
      state: null,
      slots: { ...current.slots, [sourceSlot.part]: sourceSlot.key },
    }
    summary.foldedSlots += 1
  }
  return summary
}

function buildLiveCatalog(catalog) {
  const byPrimary = new Map()
  for (const item of Array.isArray(catalog) ? catalog : []) {
    const ref = identityRefOf(item)
    if (!usableKey(ref.primary)) continue
    if (!byPrimary.has(ref.primary)) byPrimary.set(ref.primary, [])
    byPrimary.get(ref.primary).push(item)
  }
  return byPrimary
}

function orderedUnique(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    if (!usableKey(value) || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function buildSeedAliasGraph(seeds) {
  const graph = new Map()
  const roots = new Map()
  const ensure = (alias) => {
    if (!graph.has(alias)) graph.set(alias, new Set())
    if (!roots.has(alias)) roots.set(alias, new Set())
  }
  for (const seed of Array.isArray(seeds) ? seeds : []) {
    const ref = identityRefOf(seed)
    const aliases = orderedUnique([ref.primary, ...ref.aliases])
    if (!usableKey(ref.primary) || aliases.length === 0) continue
    for (const alias of aliases) {
      ensure(alias)
      roots.get(alias).add(ref.primary)
    }
    const head = aliases[0]
    for (let index = 1; index < aliases.length; index += 1) {
      graph.get(head).add(aliases[index])
      graph.get(aliases[index]).add(head)
    }
  }
  return { graph, roots }
}

function unambiguousAliasComponent(key, aliasGraph) {
  if (!aliasGraph.graph.has(key)) return null
  const aliases = new Set([key])
  const roots = new Set()
  const queue = [key]
  while (queue.length) {
    const current = queue.shift()
    for (const root of aliasGraph.roots.get(current) || []) roots.add(root)
    for (const next of aliasGraph.graph.get(current) || []) {
      if (aliases.has(next)) continue
      aliases.add(next)
      queue.push(next)
    }
  }
  return roots.size === 1 ? aliases : null
}

function buildSnapshotRecovery(source, seeds) {
  const records = []
  const recovered = new Map()
  const add = (key, snapshot, origin) => {
    if (!usableKey(key) || recovered.has(key) || !isObject(snapshot)) return
    const record = { key, snapshot, origin }
    recovered.set(key, record)
    records.push(record)
  }
  if (isObject(source.savedEvents)) {
    for (const [key, value] of Object.entries(source.savedEvents)) {
      add(key, value?.snapshot, 'savedEvents')
    }
  }
  if (Array.isArray(source.beenThere)) {
    for (const row of source.beenThere) add(row?.key, row?.snapshot, 'beenThere')
  }
  records.sort((left, right) => {
    const origin = Number(left.origin === 'beenThere') - Number(right.origin === 'beenThere')
    return origin || left.key.localeCompare(right.key)
  })
  const aliasGraph = buildSeedAliasGraph(seeds)
  return (legacyKey) => {
    const exact = recovered.get(legacyKey)
    if (exact) return { ...exact, matchedBy: 'exact' }
    const aliases = unambiguousAliasComponent(legacyKey, aliasGraph)
    if (!aliases) return null
    const candidate = records.find((record) => aliases.has(record.key))
    return candidate ? { ...candidate, matchedBy: 'seed-alias' } : null
  }
}

function unresolvedKind(snapshot, legacyKey) {
  if (snapshot?.kind === 'place' || legacyKey.startsWith('p|')) return 'place'
  if (snapshot?.kind === 'custom' || legacyKey.startsWith('c|') || isCustomEvent(snapshot)) return 'custom'
  return 'event'
}

function slotConverter(source, catalog, seeds, diagnostics) {
  const liveByPrimary = buildLiveCatalog(catalog)
  const recoverSnapshot = buildSnapshotRecovery(source, seeds)
  const summary = {
    total: 0,
    attached: 0,
    missing: 0,
    ambiguous: 0,
    invalid: 0,
    snapshots: { savedEvents: 0, beenThere: 0, none: 0 },
  }

  const convert = (identity, path) => {
    if (identity == null) return null
    summary.total += 1
    let ref = null
    if (isObject(identity) && identity.status === 'attached' && usableKey(identity.primary)) {
      summary.attached += 1
      const live = liveByPrimary.get(identity.primary) || []
      if (live.length === 1) {
        ref = slotRefOf({
          ...live[0],
          primary: identity.primary,
          aliases: Array.isArray(identity.aliases) ? identity.aliases : [identity.primary],
        })
      }
    } else if (
      isObject(identity)
      && (identity.status === 'missing' || identity.status === 'ambiguous')
      && usableKey(identity.legacyKey)
    ) {
      summary[identity.status] += 1
      const found = recoverSnapshot(identity.legacyKey)
      if (found) summary.snapshots[found.origin] += 1
      else summary.snapshots.none += 1
      diagnostics.snapshotRecovery.push({
        path,
        legacyKey: identity.legacyKey,
        matchedKey: found?.key ?? null,
        origin: found?.origin ?? null,
        matchedBy: found?.matchedBy ?? 'none',
      })
      const snapshot = found?.snapshot || {}
      const item = {
        ...snapshot,
        kind: unresolvedKind(snapshot, identity.legacyKey),
        primary: identity.legacyKey,
        aliases: [identity.legacyKey],
      }
      ref = slotRefOf(item, { identity })
    }
    if (ref) return ref
    summary.invalid += 1
    diagnostics.invalidSlots.push({
      path,
      status: isObject(identity) && typeof identity.status === 'string' ? identity.status : 'invalid',
    })
    return null
  }
  return { convert, summary }
}

function convertEntries(active, history, converter) {
  const nextActive = {}
  for (const [dayKey, entry] of Object.entries(active)) {
    const slots = emptySlots()
    for (const part of PLANNER_PARTS) {
      slots[part] = converter(entry.slots[part], ['dayPlans', dayKey, 'slots', part])
    }
    nextActive[dayKey] = { state: entry.state, slots, done: entry.done === true }
  }
  const nextHistory = history.map((entry, index) => {
    const slots = emptySlots()
    for (const part of PLANNER_PARTS) {
      slots[part] = converter(entry.slots[part], ['dayHistory', index, 'slots', part])
    }
    return { dayTs: entry.dayTs, state: entry.state, slots, done: entry.done === true }
  })
  return { active: nextActive, history: nextHistory }
}

function countSlots(document) {
  let count = 0
  for (const entry of Object.values(document.active)) {
    for (const part of PLANNER_PARTS) if (entry.slots[part]) count += 1
  }
  for (const entry of document.history) {
    for (const part of PLANNER_PARTS) if (entry.slots[part]) count += 1
  }
  return count
}

function assertDocumentWithinLimit(document, phase) {
  const bytes = plannerDocumentBytes(document)
  if (bytes <= PLANNER_DOCUMENT_MAX_BYTES) return bytes
  const error = new RangeError(
    `Planner document exceeds ${PLANNER_DOCUMENT_MAX_BYTES} bytes`,
  )
  error.code = 'ERR_PLANNER_DOCUMENT_TOO_LARGE'
  error.details = {
    phase,
    bytes,
    maxBytes: PLANNER_DOCUMENT_MAX_BYTES,
  }
  throw error
}

function migrateExistingDocument(source, { todayTs, historyCap, cityId, sourceTimeZone }) {
  const normalized = normalizePlannerDocument(source, { historyCap })
  const rolled = rolloverPlanner(normalized, { todayTs, historyCap })
  const document = rolled.document
  const bytes = assertDocumentWithinLimit(document, 'retry')
  return {
    document,
    diagnostics: {
      identity: null,
      invalidDays: [],
      collisions: [],
      invalidSlots: [],
      snapshotRecovery: [],
      weekend: { status: 'not-applicable' },
      rollover: { code: rolled.code, changed: rolled.changed },
    },
    sourceSummary: {
      mode: 'v2',
      cityId,
      sourceTimeZone,
      output: {
        activeDays: Object.keys(document.active).length,
        historyDays: document.history.length,
        slots: countSlots(document),
        bytes,
      },
    },
  }
}

// Translate exact V1 planner state using only the supplied clock and location
// basis. The source object is never mutated. Passing an already-V2 planner
// document is supported so destination-first retry paths are idempotent.
export function migrateV1PlannerState(source, {
  city,
  sourceTimeZone,
  todayTs,
  weekendStartTs,
  catalog = [],
  seeds = [],
  historyCap = PLANNER_HISTORY_CAP,
} = {}) {
  const selectedCity = requireCity(city)
  const sourceZone = requireTimeZone(sourceTimeZone, 'sourceTimeZone')
  const today = requireCityMidnight(todayTs, selectedCity.tz, 'todayTs')
  const weekendStart = requireCityMidnight(weekendStartTs, selectedCity.tz, 'weekendStartTs')
  if (!Number.isInteger(historyCap) || historyCap < 0) {
    throw new TypeError('historyCap must be a non-negative integer')
  }
  const v1 = isObject(source) ? source : {}
  if (v1.v === 2 && isObject(v1.active) && Array.isArray(v1.history)) {
    return migrateExistingDocument(v1, {
      todayTs: today,
      historyCap,
      cityId: selectedCity.id,
      sourceTimeZone: sourceZone,
    })
  }

  const diagnostics = {
    identity: null,
    invalidDays: [],
    collisions: [],
    invalidSlots: [],
    snapshotRecovery: [],
    weekend: null,
    rollover: null,
  }
  const plans = projectPlanMap(v1.dayPlans, selectedCity.tz, sourceZone, diagnostics)
  const history = projectHistory(v1.dayHistory, selectedCity.tz, sourceZone, diagnostics)
  const weekend = foldWeekendPlan(plans.value, v1.weekendPlan, {
    cityTimeZone: selectedCity.tz,
    sourceTimeZone: sourceZone,
    weekendStartTs: weekendStart,
  }, diagnostics)
  diagnostics.weekend = weekend

  const migratedIdentity = migrateV1IdentityState({
    savedEvents: v1.savedEvents,
    beenThere: v1.beenThere,
    recents: [],
    deck: [],
    dayPlans: plans.value,
    dayHistory: history.value,
  }, { catalog, seeds })
  diagnostics.identity = migratedIdentity.diagnostics

  const slots = slotConverter(v1, catalog, seeds, diagnostics)
  const converted = convertEntries(
    migratedIdentity.dayPlans,
    migratedIdentity.dayHistory,
    slots.convert,
  )
  const base = normalizePlannerDocument({
    v: 2,
    rev: 0,
    active: converted.active,
    history: converted.history,
    cells: {},
  }, { historyCap })

  const historyDays = new Set(base.history.map((entry) => entry.dayTs))
  const pastActiveDays = Object.keys(base.active)
    .map(Number)
    .filter((dayTs) => dayTs < today)
  const historyCollisions = pastActiveDays.filter((dayTs) => historyDays.has(dayTs)).length
  const rolled = rolloverPlanner(base, { todayTs: today, historyCap })
  const document = rolled.document
  const bytes = assertDocumentWithinLimit(document, 'migration')
  diagnostics.rollover = { code: rolled.code, changed: rolled.changed }

  return {
    document,
    diagnostics,
    sourceSummary: {
      mode: 'v1',
      cityId: selectedCity.id,
      sourceTimeZone: sourceZone,
      dayPlans: plans.summary,
      dayHistory: history.summary,
      weekendPlan: weekend,
      identity: slots.summary,
      rollover: {
        pastActiveDays: pastActiveDays.length,
        archivedDays: pastActiveDays.length - historyCollisions,
        historyCollisions,
        code: rolled.code,
      },
      output: {
        activeDays: Object.keys(document.active).length,
        historyDays: document.history.length,
        slots: countSlots(document),
        bytes,
      },
    },
  }
}
