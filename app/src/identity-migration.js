// Pure V1 browser-identity migration. This module only translates values; it
// neither reads nor writes storage. Callers own destination-first persistence,
// receipts, rollback, and the decision to retire V1 data.

import {
  createIdentityIndex,
  identityRefOf,
  resolveIdentity,
} from './identity.js'

const STORES = [
  'savedEvents',
  'beenThere',
  'recents',
  'deck',
  'dayPlans',
  'dayHistory',
]

const emptyCounts = () => ({ total: 0, attached: 0, missing: 0, ambiguous: 0 })

function orderedUnique(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    if (typeof value !== 'string' || !value || value === '|' || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function buildIndex(catalog, seeds) {
  const candidates = []

  for (const item of Array.isArray(catalog) ? catalog : []) {
    const ref = identityRefOf(item)
    if (!ref.primary || ref.primary === '|') continue
    candidates.push(ref)
  }

  const records = []
  for (const seed of Array.isArray(seeds) ? seeds : []) {
    const ref = identityRefOf(seed)
    if (!ref.primary || ref.primary === '|') continue
    records.push({ aliases: ref.aliases })
  }

  return createIdentityIndex({ items: candidates, records })
}

function diagnosticsCollector() {
  const byStore = Object.fromEntries(STORES.map((store) => [store, emptyCounts()]))
  const totals = emptyCounts()
  const unresolved = []

  return {
    record(store, path, legacyKey, identity) {
      totals.total++
      totals[identity.status]++
      byStore[store].total++
      byStore[store][identity.status]++
      if (identity.status === 'attached') return
      const row = { store, path, legacyKey, status: identity.status }
      if (identity.status === 'ambiguous') row.candidates = identity.candidates
      unresolved.push(row)
    },
    result() {
      return { ...totals, byStore, unresolved }
    },
  }
}

function identityMigrator(index, diagnostics) {
  return (legacyKey, store, path) => {
    const resolution = resolveIdentity(legacyKey, index)
    let identity
    if (resolution.status === 'resolved') {
      const current = identityRefOf(resolution.item)
      identity = {
        status: 'attached',
        primary: resolution.primary,
        aliases: orderedUnique([resolution.primary, legacyKey, ...current.aliases]),
      }
    } else if (resolution.status === 'ambiguous') {
      identity = {
        status: 'ambiguous',
        legacyKey,
        candidates: resolution.candidates,
      }
    } else {
      identity = { status: 'missing', legacyKey }
    }
    diagnostics.record(store, path, legacyKey, identity)
    return identity
  }
}

function migrateSlots(slots, store, basePath, migrateIdentity) {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return slots
  return Object.fromEntries(Object.entries(slots).map(([part, value]) => [
    part,
    typeof value === 'string'
      ? migrateIdentity(value, store, [...basePath, 'slots', part])
      : value,
  ]))
}

function migrateDayEntry(entry, store, basePath, migrateIdentity) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  return {
    ...entry,
    slots: migrateSlots(entry.slots, store, basePath, migrateIdentity),
  }
}

// Destination collections use explicit identity objects instead of bare V1
// strings. Missing and ambiguous references intentionally have no `primary`:
// retaining the row is safe, guessing which current item it means is not.
export function migrateV1IdentityState(source, { catalog = [], seeds = [] } = {}) {
  if (source && typeof source === 'object' && source.v === 2) return source

  const v1 = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  const diagnostics = diagnosticsCollector()
  const migrateIdentity = identityMigrator(buildIndex(catalog, seeds), diagnostics)

  const savedEvents = Object.entries(
    v1.savedEvents && typeof v1.savedEvents === 'object' && !Array.isArray(v1.savedEvents)
      ? v1.savedEvents
      : {}
  ).map(([legacyKey, value]) => ({
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { value }),
    identity: migrateIdentity(legacyKey, 'savedEvents', [legacyKey]),
  }))

  const beenThere = (Array.isArray(v1.beenThere) ? v1.beenThere : []).map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.key !== 'string') return row
    const { key, ...payload } = row
    return {
      ...payload,
      identity: migrateIdentity(key, 'beenThere', [index]),
    }
  })

  const migrateKeyArray = (value, store) => (Array.isArray(value) ? value : []).map(
    (key, index) => typeof key === 'string' ? migrateIdentity(key, store, [index]) : key
  )
  const recents = migrateKeyArray(v1.recents, 'recents')
  const deck = migrateKeyArray(v1.deck, 'deck')

  const dayPlans = Object.fromEntries(Object.entries(
    v1.dayPlans && typeof v1.dayPlans === 'object' && !Array.isArray(v1.dayPlans)
      ? v1.dayPlans
      : {}
  ).map(([dayTs, entry]) => [
    dayTs,
    migrateDayEntry(entry, 'dayPlans', [dayTs], migrateIdentity),
  ]))

  const dayHistory = (Array.isArray(v1.dayHistory) ? v1.dayHistory : []).map(
    (entry, index) => migrateDayEntry(entry, 'dayHistory', [index], migrateIdentity)
  )

  return {
    v: 2,
    savedEvents,
    beenThere,
    recents,
    deck,
    dayPlans,
    dayHistory,
    diagnostics: diagnostics.result(),
  }
}
