import assert from 'node:assert/strict'
import test from 'node:test'

import { createLocalStateBundle, serializeLocalStateBundle } from '../app/src/local-state-transfer.js'
import { executeStateTransferImport, prepareStateTransferImport } from '../app/src/state-transfer-runtime.js'

const CITY = Object.freeze({ id: 'tampa-bay', timeZone: 'America/New_York' })
const NOW = Date.UTC(2026, 6, 21, 18)

function bundle(name, exportedAt = NOW) {
  return createLocalStateBundle({
    exportedAt,
    activeCity: CITY,
    globalProfile: { name, bio: `${name} profile` },
    sections: {},
  })
}

async function preparedImport({ badBackup = false, activeCity = CITY } = {}) {
  const currentBundle = bundle('Before', NOW - 1)
  const targetBundle = bundle('After')
  const durable = []
  const result = await prepareStateTransferImport(serializeLocalStateBundle(targetBundle), {
    activeCity,
    currentBundle,
    now: () => NOW + 1,
    createBackupId: () => 'backup-runtime-test',
    persistBackup: async (raw) => {
      durable.push(raw)
      return badBackup ? `${raw} ` : raw
    },
  })
  return { currentBundle, durable, result }
}

test('runtime prepares replacement only after exact durable pre-import backup', async () => {
  const ready = await preparedImport()
  assert.equal(ready.result.ok, true)
  assert.deepEqual(ready.durable, [serializeLocalStateBundle(ready.currentBundle)])

  const bad = await preparedImport({ badBackup: true })
  assert.equal(bad.result.code, 'STATE_IMPORT_BACKUP_REQUIRED')

  const wrongCity = await preparedImport({
    activeCity: { id: 'sf-east-bay', timeZone: 'America/Los_Angeles' },
  })
  assert.equal(wrongCity.result.code, 'STATE_IMPORT_CITY_MISMATCH')
  assert.deepEqual(wrongCity.durable, [], 'wrong-city input fails before a backup write')
})

test('runtime verifies every replacement readback and completes omitted-section clears', async () => {
  const { result: prepared } = await preparedImport()
  const applied = []
  const result = await executeStateTransferImport(prepared.plan, {
    applyStep: async (step, payload) => {
      applied.push(step.section)
      return {
        ok: true,
        code: 'durably-replaced',
        raw: payload === null ? 'null' : JSON.stringify(payload),
      }
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.summary, {
    status: 'complete',
    code: 'STATE_IMPORT_COMPLETE',
    fullSuccess: true,
    succeeded: prepared.plan.steps.length,
    failed: 0,
    skipped: 0,
    pending: 0,
  })
  assert.deepEqual(applied, prepared.plan.steps.map((step) => step.section))
})

test('runtime stops at the first failed store and reports later stores as skipped', async () => {
  const { result: prepared } = await preparedImport()
  const called = []
  const failedAt = prepared.plan.steps[2].id
  const result = await executeStateTransferImport(prepared.plan, {
    applyStep: async (step, payload) => {
      called.push(step.id)
      if (step.id === failedAt) return { ok: false, code: 'quota-failed', raw: null }
      return { ok: true, code: 'durably-replaced', raw: payload === null ? 'null' : JSON.stringify(payload) }
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.summary.status, 'partial')
  assert.equal(result.summary.failed, 1)
  assert.equal(result.summary.skipped, prepared.plan.steps.length - 3)
  assert.deepEqual(called, prepared.plan.steps.slice(0, 3).map((step) => step.id))
})

test('runtime rejects plan-divergent readback and copied plan capabilities', async () => {
  const { result: prepared } = await preparedImport()
  const divergent = await executeStateTransferImport(prepared.plan, {
    applyStep: async (step, payload) => ({
      ok: true,
      code: 'claimed-success',
      raw: step.section === 'globalProfile'
        ? JSON.stringify({ v: 1, name: 'Wrong', bio: 'Wrong profile' })
        : payload === null ? 'null' : JSON.stringify(payload),
    }),
  })
  assert.deepEqual(divergent, { ok: false, code: 'STATE_IMPORT_RECEIPT_INVALID' })

  let mutations = 0
  const copied = await executeStateTransferImport({ ...prepared.plan }, {
    applyStep: async () => { mutations += 1 },
  })
  assert.equal(copied.code, 'STATE_IMPORT_RECEIPT_INVALID')
  assert.equal(mutations, 0)
})
