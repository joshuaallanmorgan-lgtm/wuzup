import {
  addCorrection,
  correctionExportReceipt,
  correctionImportDocument,
  emptyCorrectionState,
  normalizeCorrectionState,
} from './correction-state-core.js'

export const CORRECTION_STORAGE_KEY = 'corrections-v1'

export function createCorrectionStore({ cityId, storage, now = () => Date.now() }) {
  if (!cityId || !storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new TypeError('cityId and storage are required')
  }
  let durability = 'durable'
  let status = 'ready'
  let state = emptyCorrectionState(cityId)
  let snapshot
  const listeners = new Set()
  try {
    const raw = storage.get(CORRECTION_STORAGE_KEY)
    if (raw) {
      const parsed = normalizeCorrectionState(JSON.parse(raw), cityId)
      if (parsed) state = parsed
      else { durability = 'session-only'; status = 'corrupt' }
    }
  } catch {
    durability = 'session-only'
    status = 'corrupt'
  }
  const refreshSnapshot = () => {
    snapshot = Object.freeze({ state, corrections: state.corrections, durability, status })
  }
  refreshSnapshot()
  const emit = () => { refreshSnapshot(); [...listeners].forEach((listener) => listener()) }
  const persist = (next) => {
    try {
      const ok = storage.set(CORRECTION_STORAGE_KEY, JSON.stringify(next)) === true
      durability = ok ? 'durable' : 'session-only'
      return ok
    } catch {
      durability = 'session-only'
      return false
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    submit(input) {
      if (status !== 'ready') return { ok: false, changed: false, code: 'correction-store-corrupt', persisted: false, durability }
      const reduced = addCorrection(state, input, { now: now() })
      if (!reduced.changed) return { ok: false, ...reduced, persisted: durability === 'durable', durability }
      state = reduced.state
      const persisted = persist(state)
      emit()
      return { ok: true, ...reduced, persisted, durability }
    },
    export() {
      return correctionExportReceipt(state, now())
    },
    import(value) {
      if (status !== 'ready') return { ok: false, changed: false, code: 'correction-store-corrupt', persisted: false, durability }
      const incoming = correctionImportDocument(value, cityId)
      if (!incoming) return { changed: false, code: 'invalid-correction-import', persisted: false, durability }
      const byId = new Map(state.corrections.map((row) => [row.id, row]))
      for (const row of incoming.corrections) {
        const current = byId.get(row.id)
        if (current && JSON.stringify(current) !== JSON.stringify(row)) {
          return { ok: false, changed: false, code: 'correction-identity-conflict', persisted: false, durability }
        }
        if (!current) byId.set(row.id, row)
      }
      if (byId.size > 128) return { ok: false, changed: false, code: 'correction-cap-reached', persisted: false, durability }
      const merged = normalizeCorrectionState({ ...state, corrections: [...byId.values()] }, cityId)
      const changed = JSON.stringify(merged) !== JSON.stringify(state)
      if (!changed) return { ok: true, changed: false, code: 'corrections-unchanged', persisted: durability === 'durable', durability }
      state = merged
      status = 'ready'
      const persisted = persist(state)
      emit()
      return { ok: true, changed: true, code: 'corrections-imported', persisted, durability }
    },
    exportState() {
      return { v: 1, cityId, corrections: state.corrections.map((row) => ({ ...row, item: { ...row.item } })) }
    },
    replace(value) {
      if (!value || value.v !== 1 || value.cityId !== cityId
          || Object.keys(value).some((key) => !['v', 'cityId', 'corrections'].includes(key))) {
        return { ok: false, changed: false, code: 'invalid-correction-state', persisted: false, durability }
      }
      const next = normalizeCorrectionState({ version: 1, cityId, corrections: value.corrections }, cityId)
      if (!next) return { ok: false, changed: false, code: 'invalid-correction-state', persisted: false, durability }
      const changed = JSON.stringify(next) !== JSON.stringify(state) || status !== 'ready'
      if (!changed) return { ok: true, changed: false, code: 'corrections-unchanged', persisted: durability === 'durable', durability }
      state = next
      status = 'ready'
      const persisted = persist(state)
      emit()
      return { ok: true, changed: true, code: 'corrections-replaced', persisted, durability }
    },
  }
}
