import { useSyncExternalStore } from 'react'
import { CITY, keyOf } from './lib.js'
import { lsGet, lsSet } from './storage.js'
import { createCorrectionStore } from './correction-store.js'

const store = createCorrectionStore({
  cityId: CITY.id,
  storage: { get: lsGet, set: lsSet },
})

export function correctionEvidence(item) {
  const kind = item?.kind === 'place' ? 'place' : item?.kind === 'guide' || item?.guideType ? 'guide' : 'event'
  const id = kind === 'guide' ? `g|${item?.id || ''}` : keyOf(item || {})
  const title = item?.title || item?.name || 'Untitled listing'
  const sources = Array.isArray(item?.sources) ? item.sources : []
  const first = sources[0]
  const sourceFamily = typeof first === 'string'
    ? first
    : first?.family || first?.name || item?.source || ''
  const sourceUrl = first?.url || item?.url || null
  return { kind, id, title, sourceFamily, sourceUrl }
}

export function useCorrections() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { ...snapshot, submit: store.submit, export: store.export, import: store.import, replace: store.replace }
}

export const exportCorrectionReceipt = () => store.export()
export const exportCorrectionState = () => store.exportState()
export const importCorrectionState = (value) => store.import(value)
export const replaceCorrectionState = (value) => store.replace(value)
