import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addCorrection,
  correctionExportReceipt,
  emptyCorrectionState,
} from '../app/src/correction-state-core.js'
import { createCorrectionStore, CORRECTION_STORAGE_KEY } from '../app/src/correction-store.js'

const item = { kind: 'event', id: 'e|one', title: 'One', sourceFamily: 'Publisher', sourceUrl: 'https://example.com/one' }

function memory(seed = null, fail = false) {
  const data = new Map(seed == null ? [] : [[CORRECTION_STORAGE_KEY, seed]])
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => { if (fail) return false; data.set(key, value); return true },
  }
}

test('correction creation rejects invalid clocks and receipts fail closed', () => {
  const state = emptyCorrectionState('tampa-bay')
  assert.equal(addCorrection(state, { item, problem: 'other' }, { now: NaN }).code, 'invalid-correction-time')
  assert.equal(correctionExportReceipt(state, NaN), null)
})

test('corrupt stored bytes block submit and merge until explicit replacement', () => {
  const store = createCorrectionStore({ cityId: 'tampa-bay', storage: memory('{bad'), now: () => 1 })
  assert.equal(store.getSnapshot().status, 'corrupt')
  assert.equal(store.submit({ item, problem: 'other' }).code, 'correction-store-corrupt')
  assert.equal(store.import({ schema: 'wuzup-corrections' }).code, 'correction-store-corrupt')
  const recovered = store.replace({ v: 1, cityId: 'tampa-bay', corrections: [] })
  assert.equal(recovered.changed, true)
  assert.equal(store.getSnapshot().status, 'ready')
})

test('correction writes expose exact durability and transfer round-trips', () => {
  const store = createCorrectionStore({ cityId: 'tampa-bay', storage: memory(), now: () => 1721520000000 })
  const saved = store.submit({ item, problem: 'wrong-time', detail: 'Starts at eight.' })
  assert.equal(saved.ok, true)
  assert.equal(saved.persisted, true)
  assert.equal(saved.durability, 'durable')
  const payload = store.exportState()
  assert.equal(payload.v, 1)
  assert.equal(payload.corrections.length, 1)
  const target = createCorrectionStore({ cityId: 'tampa-bay', storage: memory(), now: () => 2 })
  assert.equal(target.replace(payload).code, 'corrections-replaced')
  assert.deepEqual(target.exportState(), payload)
})

test('merge refuses same-id conflicts instead of overwriting current evidence', () => {
  const store = createCorrectionStore({ cityId: 'tampa-bay', storage: memory(), now: () => 1721520000000 })
  const saved = store.submit({ item, problem: 'wrong-time' })
  const receipt = store.export()
  receipt.corrections[0] = { ...saved.correction, detail: 'conflict' }
  assert.equal(store.import(receipt).code, 'correction-identity-conflict')
  assert.equal(store.getSnapshot().corrections[0].detail, '')
})
