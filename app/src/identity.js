// identity.js — pure, versioned browser identity rules.
//
// V1 persisted event references as `(url || originalTitle || title)|start`.
// V2 finder rows also carry a 16-hex stable ID, but neither identifier is
// independently durable across every observed refresh. Keep both as evidence,
// retain learned historical aliases, and fail closed when evidence points at
// more than one live item. This module deliberately knows nothing about React,
// localStorage, or the finder so it can be exercised with frozen fixtures.

const EVENT_ID_RE = /^[0-9a-f]{16}$/
const LOCAL_ID_RE = /^[a-z0-9][a-z0-9_-]{7,63}$/i
const MAX_ID_ATTEMPTS = 32

const cleanAlias = (value) => typeof value === 'string' && value.length > 0 && value !== '|' ? value : null

export const validEventId = (value) => typeof value === 'string' && EVENT_ID_RE.test(value)
export const validLocalEventId = (value) => typeof value === 'string' && LOCAL_ID_RE.test(value)

export function isCustomEvent(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  if (item.kind === 'place') return false
  return item.kind === 'custom'
    || item.source === 'Added by you'
    || item.localId != null
    || (Array.isArray(item.tags) && item.tags.includes('added-by-you'))
}

// Frozen V1 recipe. Do not "improve" this normalization: byte compatibility
// is the point. In particular, `_keyTitle` preserves the pre-cleanup title.
export function legacyKeyOf(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '|'
  if (item.kind === 'place' && cleanAlias(item.key)) return item.key
  return (item.url || item._keyTitle || item.title || '') + '|' + (item.start || '')
}

export function primaryKeyOf(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '|'
  if (item.kind === 'place' && cleanAlias(item.key)) return item.key
  if (isCustomEvent(item)) {
    return validLocalEventId(item.localId) ? `c|${item.localId}` : legacyKeyOf(item)
  }
  return validEventId(item.id) ? `e|${item.id}` : legacyKeyOf(item)
}

function orderedAliases(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const alias = cleanAlias(value)
    if (!alias || seen.has(alias)) continue
    seen.add(alias)
    out.push(alias)
  }
  return out
}

export function aliasesOf(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return []
  const retained = Array.isArray(item.identityAliases) ? item.identityAliases : []
  return orderedAliases([primaryKeyOf(item), legacyKeyOf(item), ...retained])
}

export function identityRefOf(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)
      && cleanAlias(item.primary) && Array.isArray(item.aliases)) {
    return {
      kind: item.kind || 'event',
      primary: item.primary,
      aliases: orderedAliases([item.primary, ...item.aliases]),
    }
  }
  const primary = primaryKeyOf(item)
  return {
    kind: item?.kind === 'place' ? 'place' : isCustomEvent(item) ? 'custom' : 'event',
    primary,
    aliases: aliasesOf(item),
  }
}

function connect(graph, aliases) {
  if (!aliases.length) return
  for (const alias of aliases) {
    if (!graph.has(alias)) graph.set(alias, new Set())
  }
  const head = aliases[0]
  for (let i = 1; i < aliases.length; i++) {
    graph.get(head).add(aliases[i])
    graph.get(aliases[i]).add(head)
  }
}

// `records` are retained alias-ledger rows shaped as `{ aliases: string[] }`.
// They create equivalence edges but never become live resolution candidates.
export function createIdentityIndex({ items = [], records = [] } = {}) {
  const graph = new Map()
  const entries = []
  const byPrimary = new Map()

  for (const record of Array.isArray(records) ? records : []) {
    connect(graph, orderedAliases(Array.isArray(record?.aliases) ? record.aliases : []))
  }
  for (const item of Array.isArray(items) ? items : []) {
    const ref = identityRefOf(item)
    if (!cleanAlias(ref.primary) || ref.primary === '|') continue
    const entry = { primary: ref.primary, aliases: ref.aliases, item }
    entries.push(entry)
    if (!byPrimary.has(ref.primary)) byPrimary.set(ref.primary, [])
    byPrimary.get(ref.primary).push(entry)
    connect(graph, ref.aliases)
  }

  return { graph, entries, byPrimary }
}

function reachableFrom(seed, graph) {
  const seen = new Set([seed])
  const queue = [seed]
  while (queue.length) {
    const current = queue.shift()
    for (const next of graph.get(current) || []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

function candidatesFor(aliases, index) {
  const reachable = new Set()
  for (const alias of aliases) {
    for (const value of reachableFrom(alias, index.graph)) reachable.add(value)
  }
  const candidates = []
  for (const entry of index.entries) {
    if (entry.aliases.some((alias) => reachable.has(alias))) candidates.push(entry)
  }
  return candidates
}

function ambiguous(entries) {
  return {
    status: 'ambiguous',
    candidates: [...new Set(entries.map((entry) => entry.primary))].sort(),
  }
}

export function resolveIdentity(value, index) {
  if (!index || !(index.graph instanceof Map) || !(index.byPrimary instanceof Map)) {
    throw new TypeError('resolveIdentity requires an identity index')
  }

  // An exact current primary is stronger than a weak alias edge. A retained
  // ref containing multiple pieces of evidence is handled below and may still
  // be ambiguous when those pieces disagree.
  if (typeof value === 'string') {
    const exact = index.byPrimary.get(value) || []
    if (exact.length === 1) {
      return { status: 'resolved', primary: exact[0].primary, item: exact[0].item, matchedBy: 'primary' }
    }
    if (exact.length > 1) return ambiguous(exact)
    const candidates = candidatesFor([value], index)
    if (candidates.length === 0) return { status: 'missing' }
    if (candidates.length > 1) return ambiguous(candidates)
    return {
      status: 'resolved',
      primary: candidates[0].primary,
      item: candidates[0].item,
      matchedBy: 'alias',
    }
  }

  const ref = identityRefOf(value)
  const candidates = candidatesFor(ref.aliases, index)
  if (candidates.length === 0) return { status: 'missing' }
  if (candidates.length > 1) return ambiguous(candidates)
  return {
    status: 'resolved',
    primary: candidates[0].primary,
    item: candidates[0].item,
    matchedBy: candidates[0].primary === ref.primary ? 'primary' : 'alias',
  }
}

export function sameIdentity(left, right, index) {
  if (!index) {
    const a = primaryKeyOf(left)
    const b = primaryKeyOf(right)
    return a !== '|' && b !== '|' && a === b
  }
  const a = resolveIdentity(identityRefOf(left), index)
  const b = resolveIdentity(identityRefOf(right), index)
  return a.status === 'resolved' && b.status === 'resolved' && a.primary === b.primary
}

// Pure custom-event migration. Callers decide whether the returned list was
// durably written; if persistence fails they must keep using the source rows,
// whose legacy identities remain valid for the session and next retry.
export function assignLocalEventIds(items, { createId } = {}) {
  const source = Array.isArray(items) ? items : []
  const mint = typeof createId === 'function' ? createId : () => globalThis.crypto?.randomUUID?.()
  const reserved = new Set()
  for (const item of source) {
    if (isCustomEvent(item) && validLocalEventId(item.localId)) reserved.add(item.localId)
  }

  let changed = false
  let complete = true
  const claimed = new Set()
  const next = source.map((item) => {
    if (!isCustomEvent(item)) return item
    if (validLocalEventId(item.localId) && !claimed.has(item.localId)) {
      claimed.add(item.localId)
      return item
    }
    let localId = null
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      let candidate
      try {
        candidate = mint()
      } catch {
        candidate = null
      }
      if (!validLocalEventId(candidate) || reserved.has(candidate) || claimed.has(candidate)) continue
      localId = candidate
      break
    }
    if (!localId) {
      complete = false
      return item
    }
    claimed.add(localId)
    changed = true
    return { ...item, localId }
  })

  return { items: changed ? next : source, changed, complete }
}
