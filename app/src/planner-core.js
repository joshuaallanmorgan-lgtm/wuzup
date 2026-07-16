// planner-core.js — pure V2 atomic planner document and reducer.
import { isCustomEvent, legacyKeyOf, primaryKeyOf } from './identity.js'

export const PLANNER_VERSION = 2
export const PLANNER_PARTS = ['morning', 'afternoon', 'night']
export const PLANNER_HISTORY_CAP = 120
export const PLANNER_SNAPSHOT_MAX_BYTES = 4096
export const PLANNER_SNAPSHOT_STRING_MAX_BYTES = 2048
export const PLANNER_SNAPSHOT_MAX_DEPTH = 3
export const PLANNER_SNAPSHOT_MAX_NODES = 128
export const PLANNER_SNAPSHOT_MAX_ARRAY_ITEMS = 16
export const PLANNER_SNAPSHOT_MAX_OBJECT_KEYS = 16
export const PLANNER_ALIAS_MAX_COUNT = 8
export const PLANNER_ALIAS_MAX_BYTES = 2048
export const PLANNER_ALIASES_MAX_BYTES = 4096
export const PLANNER_ALIAS_SCAN_MAX = 64
export const PLANNER_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024

const PLANNER_SNAPSHOT_KEY_MAX_BYTES = 128
const PLANNER_OBJECT_SCAN_MAX = 64
const ENCODER = new TextEncoder()

export const emptyPlannerDocument = () => ({
  v: PLANNER_VERSION,
  rev: 0,
  active: {},
  history: [],
  cells: {},
})

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const isDayTs = (value) => Number.isInteger(value) && value > 0
const usableIdentity = (value) => typeof value === 'string' && value.length > 0 && value !== '|'
const validPlannedAt = (value) => Number.isInteger(value) && value >= 0
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
const validMutationToken = (value, rev = Number.MAX_SAFE_INTEGER) => (
  Number.isSafeInteger(value) && value > 0 && value <= rev
)

const SNAPSHOT_FIELDS = [
  'id', 'localId', 'kind', 'key', 'title', 'name', 'start', 'end', 'allDay', 'timeZone',
  'venue', 'address', 'neighborhood', 'city', 'lat', 'lng', 'image', 'imageAlt', 'url',
  'category', 'isFree', 'price', 'priceMin', 'priceMax', 'currency', 'sponsored', 'status',
  'source', 'sourceUrl', 'organizer', 'placeType', 'fee', 'srcCount', 'hidden', 'tags',
  'description', 'classes', 'amenities', 'hours', 'sources',
]

function jsonBytes(value) {
  try {
    return ENCODER.encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function plannerDocumentBytes(value) {
  return jsonBytes(value)
}

function boundedAliases(primary, groups) {
  if (!usableIdentity(primary) || jsonBytes(primary) > PLANNER_ALIAS_MAX_BYTES) return null
  const aliases = [primary]
  const seen = new Set(aliases)
  let scanned = 0
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!Array.isArray(group)) continue
    const limit = Math.min(group.length, PLANNER_ALIAS_SCAN_MAX - scanned)
    for (let index = 0; index < limit; index += 1) {
      scanned += 1
      const value = group[index]
      if (!usableIdentity(value) || seen.has(value) || jsonBytes(value) > PLANNER_ALIAS_MAX_BYTES) continue
      const candidate = [...aliases, value]
      if (jsonBytes(candidate) > PLANNER_ALIASES_MAX_BYTES) continue
      seen.add(value)
      aliases.push(value)
      if (aliases.length >= PLANNER_ALIAS_MAX_COUNT) return aliases
    }
    if (scanned >= PLANNER_ALIAS_SCAN_MAX) break
  }
  return aliases
}

function boundedIdentityCandidates(values, legacyKey) {
  const candidates = []
  const seen = new Set()
  const source = Array.isArray(values) ? values : []
  const limit = Math.min(source.length, PLANNER_ALIAS_SCAN_MAX)
  for (let index = 0; index < limit; index += 1) {
    const value = source[index]
    if (!usableIdentity(value) || seen.has(value) || jsonBytes(value) > PLANNER_ALIAS_MAX_BYTES) continue
    const next = [...candidates, value]
    if (jsonBytes({ status: 'ambiguous', legacyKey, candidates: next }) > PLANNER_ALIASES_MAX_BYTES) continue
    seen.add(value)
    candidates.push(value)
    if (candidates.length >= PLANNER_ALIAS_MAX_COUNT) break
  }
  return candidates
}

function normalizeIdentityMetadata(value) {
  if (!isObject(value)
      || !usableIdentity(value.legacyKey)
      || jsonBytes(value.legacyKey) > PLANNER_ALIAS_MAX_BYTES) {
    return null
  }
  if (value.status === 'missing') {
    return { status: 'missing', legacyKey: value.legacyKey }
  }
  if (value.status === 'ambiguous') {
    const candidates = boundedIdentityCandidates(value.candidates, value.legacyKey)
    return candidates.length > 0
      ? { status: 'ambiguous', legacyKey: value.legacyKey, candidates }
      : null
  }
  return null
}

function plannerIdentityOf(item) {
  if (usableIdentity(item.primary) && Array.isArray(item.aliases)) {
    return {
      kind: item.kind === 'place' ? 'place' : item.kind === 'custom' ? 'custom' : 'event',
      primary: item.primary,
      aliasGroups: [item.aliases],
    }
  }

  return {
    kind: item.kind === 'place' ? 'place' : isCustomEvent(item) ? 'custom' : 'event',
    primary: primaryKeyOf(item),
    aliasGroups: [
      [legacyKeyOf(item)],
      Array.isArray(item.identityAliases) ? item.identityAliases : [],
    ],
  }
}

function cloneJsonValue(value, state, depth = 0) {
  if (depth > PLANNER_SNAPSHOT_MAX_DEPTH || state.nodes >= PLANNER_SNAPSHOT_MAX_NODES) return undefined
  state.nodes += 1

  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return jsonBytes(value) <= PLANNER_SNAPSHOT_STRING_MAX_BYTES ? value : undefined
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (!Array.isArray(value) && !isObject(value)) return undefined
  if (state.seen.has(value)) return undefined

  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      const out = []
      const limit = Math.min(value.length, PLANNER_SNAPSHOT_MAX_ARRAY_ITEMS)
      for (let index = 0; index < limit; index += 1) {
        const cloned = cloneJsonValue(value[index], state, depth + 1)
        if (cloned !== undefined) out.push(cloned)
      }
      return out
    }

    const out = {}
    let scanned = 0
    let kept = 0
    for (const key in value) {
      if (scanned >= PLANNER_OBJECT_SCAN_MAX || kept >= PLANNER_SNAPSHOT_MAX_OBJECT_KEYS) break
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      scanned += 1
      if (jsonBytes(key) > PLANNER_SNAPSHOT_KEY_MAX_BYTES) continue
      const cloned = cloneJsonValue(value[key], state, depth + 1)
      if (cloned === undefined) continue
      out[key] = cloned
      kept += 1
    }
    return out
  } finally {
    state.seen.delete(value)
  }
}

function snapshotOf(item) {
  const snapshot = {}
  const state = { nodes: 0, seen: new WeakSet() }
  for (const field of SNAPSHOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(item, field)) continue
    const cloned = cloneJsonValue(item[field], state)
    if (cloned === undefined) continue
    snapshot[field] = cloned
    if (jsonBytes(snapshot) > PLANNER_SNAPSHOT_MAX_BYTES) delete snapshot[field]
  }
  return snapshot
}

export function slotRefOf(item, { plannedAt, identity: identityMetadataInput } = {}) {
  if (!isObject(item)) return null
  const identity = plannerIdentityOf(item)
  if (!usableIdentity(identity.primary)) return null
  const identityMetadata = normalizeIdentityMetadata(identityMetadataInput)
  if (identityMetadata && identity.primary !== identityMetadata.legacyKey) return null
  const aliases = identityMetadata
    ? [identity.primary]
    : boundedAliases(identity.primary, identity.aliasGroups)
  if (!aliases) return null
  const ref = {
    kind: identity.kind,
    primary: identity.primary,
    aliases,
    snapshot: snapshotOf(item),
  }
  if (identityMetadata) ref.identity = identityMetadata
  if (validPlannedAt(plannedAt)) ref.plannedAt = plannedAt
  return ref
}

function normalizeSlotRef(value) {
  if (!isObject(value) || !usableIdentity(value.primary) || !isObject(value.snapshot)) return null
  const kind = value.kind === 'place' || value.kind === 'custom' ? value.kind : 'event'
  const identityMetadata = normalizeIdentityMetadata(value.identity)
  if (identityMetadata && value.primary !== identityMetadata.legacyKey) return null
  const aliases = identityMetadata
    ? [value.primary]
    : boundedAliases(value.primary, [value.aliases])
  if (!aliases) return null
  const ref = {
    kind,
    primary: value.primary,
    aliases,
    snapshot: snapshotOf(value.snapshot),
  }
  if (identityMetadata) ref.identity = identityMetadata
  if (validPlannedAt(value.plannedAt)) ref.plannedAt = value.plannedAt
  return ref
}

function emptySlots() {
  return { morning: null, afternoon: null, night: null }
}

function emptyCellTokens() {
  return { state: 0, slots: { morning: 0, afternoon: 0, night: 0 } }
}

function normalizeCellTokens(value, rev) {
  if (!isObject(value)) return null
  const cell = emptyCellTokens()
  if (validMutationToken(value.state, rev)) cell.state = value.state
  if (isObject(value.slots)) {
    for (const part of PLANNER_PARTS) {
      if (validMutationToken(value.slots[part], rev)) cell.slots[part] = value.slots[part]
    }
  }
  return cell.state || PLANNER_PARTS.some((part) => cell.slots[part]) ? cell : null
}

function normalizeEntry(value) {
  if (!isObject(value) || !isObject(value.slots)) return null
  const slots = emptySlots()
  for (const part of PLANNER_PARTS) slots[part] = normalizeSlotRef(value.slots[part])
  const hasSlot = PLANNER_PARTS.some((part) => slots[part] !== null)
  const state = value.state === 'rest' && !hasSlot ? 'rest' : null
  const done = value.done === true
  return state || hasSlot || done ? { state, slots, done } : null
}

export function normalizePlannerDocument(value, { historyCap = PLANNER_HISTORY_CAP } = {}) {
  if (!isObject(value) || value.v !== PLANNER_VERSION) return emptyPlannerDocument()
  const rev = validRevision(value.rev) ? value.rev : 0
  const active = {}
  if (isObject(value.active)) {
    for (const [key, stored] of Object.entries(value.active)) {
      const dayTs = Number(key)
      if (!isDayTs(dayTs) || String(dayTs) !== key) continue
      const entry = normalizeEntry(stored)
      if (entry) active[key] = entry
    }
  }

  const history = []
  const seenDays = new Set()
  if (Array.isArray(value.history)) {
    for (const stored of value.history) {
      if (!isObject(stored) || !isDayTs(stored.dayTs) || seenDays.has(stored.dayTs)) continue
      const entry = normalizeEntry(stored)
      if (!entry) continue
      seenDays.add(stored.dayTs)
      history.push({ dayTs: stored.dayTs, ...entry })
    }
  }
  history.sort((left, right) => left.dayTs - right.dayTs)
  const cap = Number.isInteger(historyCap) && historyCap >= 0 ? historyCap : PLANNER_HISTORY_CAP
  const cells = {}
  if (isObject(value.cells)) {
    for (const [key, stored] of Object.entries(value.cells)) {
      const dayTs = Number(key)
      if (!isDayTs(dayTs) || String(dayTs) !== key) continue
      const cell = normalizeCellTokens(stored, rev)
      if (cell) cells[key] = cell
    }
  }

  return {
    v: PLANNER_VERSION,
    rev,
    active,
    history: cap === 0 ? [] : history.slice(-cap),
    cells,
  }
}

function result(document, code, changed = false, undo = null) {
  const out = { document, code, changed }
  if (undo) out.undo = undo
  return out
}

function validTarget(dayTs, part) {
  return isDayTs(dayTs) && PLANNER_PARTS.includes(part)
}

function blankEntry() {
  return { state: null, slots: emptySlots(), done: false }
}

function referencesOverlap(left, right) {
  const aliases = new Set(left.aliases)
  return right.aliases.some((alias) => aliases.has(alias))
}

function findDuplicate(active, ref, except = null) {
  for (const [dayKey, entry] of Object.entries(active)) {
    for (const part of PLANNER_PARTS) {
      if (except && except.dayKey === dayKey && except.part === part) continue
      const stored = entry.slots[part]
      if (stored && referencesOverlap(stored, ref)) return { dayTs: Number(dayKey), part, ref: stored }
    }
  }
  return null
}

function changedDocument(base, active, history = base.history, cells = base.cells) {
  return { ...base, rev: base.rev + 1, active, history, cells }
}

function undoReceipt(operation, values) {
  return { kind: 'planner-undo', operation, ...values }
}

function cellToken(cells, dayTs, type, part = null) {
  const cell = cells[String(dayTs)]
  return type === 'state' ? cell?.state || 0 : cell?.slots[part] || 0
}

function withCellTokens(cells, updates, token) {
  const next = { ...cells }
  for (const update of updates) {
    const key = String(update.dayTs)
    const current = next[key] || emptyCellTokens()
    if (update.type === 'state') {
      next[key] = { ...current, state: token, slots: { ...current.slots } }
      continue
    }
    next[key] = {
      ...current,
      slots: { ...current.slots, [update.part]: token },
    }
  }
  return next
}

export function addPlannerItem(document, { dayTs, part, item, plannedAt } = {}) {
  const base = normalizePlannerDocument(document)
  if (!validTarget(dayTs, part)) return result(base, 'invalid-command')
  const ref = slotRefOf(item, { plannedAt })
  if (!ref) return result(base, 'invalid-item')
  if (findDuplicate(base.active, ref)) return result(base, 'duplicate')

  const key = String(dayTs)
  const entry = base.active[key] || blankEntry()
  if (entry.state === 'rest') return result(base, 'rest-conflict')
  if (entry.slots[part]) return result(base, 'slot-occupied')

  const nextEntry = { ...entry, state: null, slots: { ...entry.slots, [part]: ref } }
  const mutation = base.rev + 1
  const cells = withCellTokens(base.cells, [{ dayTs, type: 'slot', part }], mutation)
  const next = changedDocument(base, { ...base.active, [key]: nextEntry }, base.history, cells)
  return result(next, 'added', true, undoReceipt('add', {
    dayTs,
    part,
    expectedPrimary: ref.primary,
    expectedToken: mutation,
  }))
}

export function setPlannerRest(document, { dayTs, rest } = {}) {
  const base = normalizePlannerDocument(document)
  if (!isDayTs(dayTs) || typeof rest !== 'boolean') return result(base, 'invalid-command')
  const key = String(dayTs)
  const entry = base.active[key]

  if (rest) {
    if (entry?.state === 'rest') return result(base, 'already-resting')
    if (entry && PLANNER_PARTS.some((part) => entry.slots[part])) return result(base, 'slot-conflict')
    const mutation = base.rev + 1
    const active = {
      ...base.active,
      [key]: { state: 'rest', slots: emptySlots(), done: entry?.done === true },
    }
    const cells = withCellTokens(base.cells, [{ dayTs, type: 'state' }], mutation)
    const next = changedDocument(base, active, base.history, cells)
    return result(next, 'rest-set', true, undoReceipt('rest', {
      dayTs,
      expectedState: 'rest',
      restoreState: null,
      expectedToken: mutation,
    }))
  }

  if (entry?.state !== 'rest') return result(base, 'already-active')
  const active = { ...base.active }
  if (entry.done) active[key] = { state: null, slots: emptySlots(), done: true }
  else delete active[key]
  const mutation = base.rev + 1
  const cells = withCellTokens(base.cells, [{ dayTs, type: 'state' }], mutation)
  const next = changedDocument(base, active, base.history, cells)
  return result(next, 'rest-cleared', true, undoReceipt('rest', {
    dayTs,
    expectedState: null,
    restoreState: 'rest',
    expectedToken: mutation,
  }))
}

function withoutSlot(active, dayTs, part) {
  const key = String(dayTs)
  const entry = active[key]
  const slots = { ...entry.slots, [part]: null }
  const next = { ...active }
  if (PLANNER_PARTS.some((candidate) => slots[candidate]) || entry.done) {
    next[key] = { ...entry, state: null, slots }
  }
  else delete next[key]
  return next
}

export function movePlannerItem(document, command = {}) {
  const base = normalizePlannerDocument(document)
  const { fromDayTs, fromPart, toDayTs, toPart, expectedPrimary } = command
  if (!validTarget(fromDayTs, fromPart) || !validTarget(toDayTs, toPart) || !usableIdentity(expectedPrimary)) {
    return result(base, 'invalid-command')
  }

  const sourceEntry = base.active[String(fromDayTs)]
  const source = sourceEntry?.slots[fromPart]
  if (!source) return result(base, 'slot-empty')
  if (source.primary !== expectedPrimary) return result(base, 'item-conflict')
  if (fromDayTs === toDayTs && fromPart === toPart) return result(base, 'already-there')
  if (command.kind === 'planner-undo') {
    if (!validMutationToken(command.expectedFromToken, base.rev)
        || !validMutationToken(command.expectedToToken, base.rev)) {
      return result(base, 'invalid-command')
    }
    if (cellToken(base.cells, fromDayTs, 'slot', fromPart) !== command.expectedFromToken
        || cellToken(base.cells, toDayTs, 'slot', toPart) !== command.expectedToToken) {
      return result(base, 'item-conflict')
    }
  }

  const targetEntry = base.active[String(toDayTs)]
  if (targetEntry?.state === 'rest') return result(base, 'rest-conflict')
  if (targetEntry?.slots[toPart]) return result(base, 'slot-occupied')

  let active = withoutSlot(base.active, fromDayTs, fromPart)
  const target = active[String(toDayTs)] || blankEntry()
  active = {
    ...active,
    [String(toDayTs)]: { ...target, state: null, slots: { ...target.slots, [toPart]: source } },
  }
  const mutation = base.rev + 1
  const cells = withCellTokens(base.cells, [
    { dayTs: fromDayTs, type: 'slot', part: fromPart },
    { dayTs: toDayTs, type: 'slot', part: toPart },
  ], mutation)
  const next = changedDocument(base, active, base.history, cells)
  return result(next, 'moved', true, undoReceipt('move', {
    fromDayTs: toDayTs,
    fromPart: toPart,
    toDayTs: fromDayTs,
    toPart: fromPart,
    expectedPrimary: source.primary,
    expectedFromToken: mutation,
    expectedToToken: mutation,
  }))
}

function commandPrimary(command) {
  if (usableIdentity(command.expectedPrimary)) return command.expectedPrimary
  return slotRefOf(command.expectedItem)?.primary || null
}

export function removePlannerItem(document, command = {}) {
  const base = normalizePlannerDocument(document)
  const { dayTs, part } = command
  const expectedPrimary = commandPrimary(command)
  if (!validTarget(dayTs, part) || !expectedPrimary) return result(base, 'invalid-command')
  const sourceEntry = base.active[String(dayTs)]
  const stored = sourceEntry?.slots[part]
  if (!stored) return result(base, 'slot-empty')
  if (stored.primary !== expectedPrimary) return result(base, 'item-conflict')

  const active = withoutSlot(base.active, dayTs, part)
  const mutation = base.rev + 1
  const cells = withCellTokens(base.cells, [{ dayTs, type: 'slot', part }], mutation)
  const next = changedDocument(base, active, base.history, cells)
  return result(next, 'removed', true, undoReceipt('remove', {
    dayTs,
    part,
    expectedEmpty: true,
    restore: stored,
    expectedToken: mutation,
  }))
}

function undoResult(base, document) {
  return result(document, 'undone', true)
}

export function applyPlannerUndo(document, receipt) {
  const base = normalizePlannerDocument(document)
  if (!isObject(receipt) || receipt.kind !== 'planner-undo') return result(base, 'invalid-undo')

  if (receipt.operation === 'add') {
    if (!validTarget(receipt.dayTs, receipt.part)
        || !usableIdentity(receipt.expectedPrimary)
        || !validMutationToken(receipt.expectedToken, base.rev)) {
      return result(base, 'invalid-undo')
    }
    const stored = base.active[String(receipt.dayTs)]?.slots[receipt.part]
    if (!stored
        || stored.primary !== receipt.expectedPrimary
        || cellToken(base.cells, receipt.dayTs, 'slot', receipt.part) !== receipt.expectedToken) {
      return result(base, 'undo-conflict')
    }
    const active = withoutSlot(base.active, receipt.dayTs, receipt.part)
    const mutation = base.rev + 1
    const cells = withCellTokens(base.cells, [{
      dayTs: receipt.dayTs,
      type: 'slot',
      part: receipt.part,
    }], mutation)
    return undoResult(base, changedDocument(base, active, base.history, cells))
  }

  if (receipt.operation === 'remove') {
    if (!validTarget(receipt.dayTs, receipt.part)
        || receipt.expectedEmpty !== true
        || !validMutationToken(receipt.expectedToken, base.rev)) {
      return result(base, 'invalid-undo')
    }
    const restore = normalizeSlotRef(receipt.restore)
    if (!restore) return result(base, 'invalid-undo')
    const key = String(receipt.dayTs)
    const entry = base.active[key]
    if (entry?.state === 'rest'
        || entry?.slots[receipt.part]
        || findDuplicate(base.active, restore)
        || cellToken(base.cells, receipt.dayTs, 'slot', receipt.part) !== receipt.expectedToken) {
      return result(base, 'undo-conflict')
    }
    const target = entry || blankEntry()
    const active = {
      ...base.active,
      [key]: { ...target, state: null, slots: { ...target.slots, [receipt.part]: restore } },
    }
    const mutation = base.rev + 1
    const cells = withCellTokens(base.cells, [{
      dayTs: receipt.dayTs,
      type: 'slot',
      part: receipt.part,
    }], mutation)
    return undoResult(base, changedDocument(base, active, base.history, cells))
  }

  if (receipt.operation === 'move') {
    const moved = movePlannerItem(base, receipt)
    if (moved.code === 'invalid-command') return result(base, 'invalid-undo')
    if (!moved.changed) return result(base, 'undo-conflict')
    return undoResult(base, moved.document)
  }

  if (receipt.operation === 'rest') {
    if (!isDayTs(receipt.dayTs) || !validMutationToken(receipt.expectedToken, base.rev)) {
      return result(base, 'invalid-undo')
    }
    const key = String(receipt.dayTs)
    const entry = base.active[key]
    if (cellToken(base.cells, receipt.dayTs, 'state') !== receipt.expectedToken) {
      return result(base, 'undo-conflict')
    }
    if (receipt.expectedState === 'rest' && receipt.restoreState === null) {
      if (entry?.state !== 'rest') return result(base, 'undo-conflict')
      const active = { ...base.active }
      if (entry.done) active[key] = { state: null, slots: emptySlots(), done: true }
      else delete active[key]
      const mutation = base.rev + 1
      const cells = withCellTokens(base.cells, [{ dayTs: receipt.dayTs, type: 'state' }], mutation)
      return undoResult(base, changedDocument(base, active, base.history, cells))
    }
    if (receipt.expectedState === null && receipt.restoreState === 'rest') {
      if (entry?.state || PLANNER_PARTS.some((part) => entry?.slots[part])) {
        return result(base, 'undo-conflict')
      }
      const active = {
        ...base.active,
        [key]: { state: 'rest', slots: emptySlots(), done: entry?.done === true },
      }
      const mutation = base.rev + 1
      const cells = withCellTokens(base.cells, [{ dayTs: receipt.dayTs, type: 'state' }], mutation)
      return undoResult(base, changedDocument(base, active, base.history, cells))
    }
    return result(base, 'invalid-undo')
  }

  return result(base, 'invalid-undo')
}

export function rolloverPlanner(document, { todayTs, historyCap = PLANNER_HISTORY_CAP } = {}) {
  const base = normalizePlannerDocument(document)
  if (!isDayTs(todayTs) || !Number.isInteger(historyCap) || historyCap < 0) {
    return result(base, 'invalid-command')
  }

  const past = Object.entries(base.active)
    .filter(([dayKey]) => Number(dayKey) < todayTs)
    .sort(([left], [right]) => Number(left) - Number(right))
  const pastCellKeys = Object.keys(base.cells).filter((dayKey) => Number(dayKey) < todayTs)
  if (past.length === 0 && pastCellKeys.length === 0) return result(base, 'nothing-to-rollover')

  const active = { ...base.active }
  const cells = { ...base.cells }
  for (const dayKey of pastCellKeys) delete cells[dayKey]
  const history = [...base.history]
  const archived = new Set(history.map((row) => row.dayTs))
  for (const [dayKey, entry] of past) {
    const dayTs = Number(dayKey)
    delete active[dayKey]
    if (archived.has(dayTs)) continue
    archived.add(dayTs)
    history.push({ dayTs, ...entry })
  }
  history.sort((left, right) => left.dayTs - right.dayTs)
  const capped = historyCap === 0 ? [] : history.slice(-historyCap)
  const next = changedDocument(base, active, capped, cells)
  return result(next, 'rolled-over', true)
}
