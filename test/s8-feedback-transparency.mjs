import assert from 'node:assert/strict'
import test from 'node:test'

import {
  commitCalibrationVerdict,
  exactActivityApplied,
  exactPersonalSignalApplied,
  exactSaveApplied,
} from '../app/src/feedback-transparency.js'

const EVIDENCE = Object.freeze({
  cityId: 'tampa-bay',
  family: 'deck',
  kind: 'event',
  primary: 'event|one',
})

const activity = (overrides = {}) => ({
  applied: true,
  changed: true,
  code: 'recorded',
  persisted: true,
  durability: 'durable',
  ...overrides,
})
const saved = (overrides = {}) => ({
  applied: true,
  changed: true,
  saved: true,
  code: 'saved',
  persisted: true,
  durability: 'durable',
  ...overrides,
})
const signal = (overrides = {}) => ({
  applied: true,
  changed: true,
  code: 'applied',
  persisted: true,
  durability: 'durable',
  evidence: EVIDENCE,
  ...overrides,
})

test('Save failure never records deck history and the same action can retry', async () => {
  const calls = []
  const failed = await commitCalibrationVerdict({
    action: 'save',
    save: async () => { calls.push('save'); return { ...saved(), applied: false, changed: false, saved: false, code: 'save-failed' } },
    retain: async () => { calls.push('activity'); return activity() },
  })
  assert.equal(failed.applied, false)
  assert.equal(failed.stage, 'save')
  assert.deepEqual(calls, ['save'])

  const retried = await commitCalibrationVerdict({
    action: 'save',
    save: async () => { calls.push('save'); return saved() },
    retain: async () => { calls.push('activity'); return activity() },
  })
  assert.equal(retried.applied, true)
  assert.deepEqual(calls, ['save', 'save', 'activity'])
})

test('a saved-but-unretained card retries history without toggling save twice', async () => {
  const calls = []
  const first = await commitCalibrationVerdict({
    action: 'save',
    save: async () => { calls.push('save'); return saved() },
    retain: async () => { calls.push('activity-fail'); return activity({ applied: false, changed: false, code: 'activity-unavailable', persisted: false, durability: 'session-only' }) },
  })
  assert.equal(first.applied, false)
  assert.equal(first.saveApplied, true)

  const retry = await commitCalibrationVerdict({
    action: 'save',
    alreadySaved: true,
    save: async () => { calls.push('unexpected-save'); return saved() },
    retain: async () => { calls.push('activity-retry'); return activity() },
  })
  assert.equal(retry.applied, true)
  assert.deepEqual(calls, ['save', 'activity-fail', 'activity-retry'])
})

test('rating forwards the exact Activity receipt and retries taste after already-current', async () => {
  const retained = activity()
  let received = null
  const first = await commitCalibrationVerdict({
    action: 'yes',
    retain: async () => retained,
    signal: async (value) => { received = value; return signal() },
    expectedEvidence: EVIDENCE,
  })
  assert.equal(first.applied, true)
  assert.equal(received, retained)

  const retried = await commitCalibrationVerdict({
    action: 'no',
    retain: async () => activity({ changed: false, code: 'already-current' }),
    signal: async () => signal({ code: 'applied-session-only', persisted: false, durability: 'session-only' }),
    expectedEvidence: EVIDENCE,
  })
  assert.equal(retried.applied, true)
  assert.equal(retried.durability, 'session-only')
})

test('fresh and duplicate signal receipts must prove the exact card evidence', async () => {
  const wrong = { ...EVIDENCE, primary: 'event|other' }
  assert.equal(exactPersonalSignalApplied(signal({ evidence: wrong }), { expectedEvidence: EVIDENCE }), false)
  assert.equal(exactPersonalSignalApplied({
    applied: false,
    changed: false,
    code: 'duplicate',
    persisted: false,
    durability: 'unknown',
    evidence: wrong,
  }, { expectedEvidence: EVIDENCE }), false)
  assert.equal(exactPersonalSignalApplied({
    applied: false,
    changed: false,
    code: 'duplicate',
    persisted: false,
    durability: 'unknown',
    evidence: EVIDENCE,
  }, { expectedEvidence: EVIDENCE }), true)
})

test('hostile code/change/durability combinations fail closed', () => {
  assert.equal(exactActivityApplied(activity()), true)
  assert.equal(exactActivityApplied(activity({ code: 'recorded', changed: false })), false)
  assert.equal(exactActivityApplied(activity({ code: 'already-current', changed: true })), false)
  assert.equal(exactActivityApplied(activity({ persisted: true, durability: 'session-only' })), false)
  assert.equal(exactPersonalSignalApplied(signal({
    code: 'applied',
    persisted: false,
    durability: 'session-only',
  }), { expectedEvidence: EVIDENCE }), false)
  assert.equal(exactSaveApplied(saved()), true)
  assert.equal(exactSaveApplied(saved({ code: 'removed' })), false)
  assert.equal(exactSaveApplied(saved({ applied: false })), false)
})
