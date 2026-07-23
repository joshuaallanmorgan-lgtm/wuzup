import {
  aggregateLocalStateImport,
  importStepPayload,
  parseLocalStateBundle,
  planLocalStateImport,
  serializeLocalStateBundle,
  verifyLocalStateImportOutcome,
  verifyPersistedLocalStateBackup,
} from './local-state-transfer.js'

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,159}$/i

const failed = (code, extras = {}) => Object.freeze({ ok: false, code, ...extras })

export async function prepareStateTransferImport(raw, {
  activeCity,
  currentBundle,
  currentCustomState = null,
  mode = 'replace',
  persistBackup,
  now = Date.now,
  createBackupId = (at) => `backup-${at.toString(36)}`,
} = {}) {
  const parsed = parseLocalStateBundle(raw)
  if (!parsed.ok) return failed(parsed.code)
  if (parsed.bundle.activeCity.id !== activeCity?.id
      || parsed.bundle.activeCity.timeZone !== activeCity?.timeZone) {
    return failed('STATE_IMPORT_CITY_MISMATCH')
  }
  let currentRaw
  try {
    currentRaw = serializeLocalStateBundle(currentBundle)
  } catch {
    return failed('STATE_BACKUP_SOURCE_INVALID')
  }
  const createdAt = Number(now())
  const backupId = createBackupId(createdAt)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0
      || typeof backupId !== 'string' || !ID_RE.test(backupId)
      || typeof persistBackup !== 'function') {
    return failed('STATE_BACKUP_CONTEXT_INVALID')
  }
  let persistedRaw
  try {
    persistedRaw = await persistBackup(currentRaw, { backupId, createdAt })
  } catch {
    // Persistence failures are represented by the missing durable backup receipt below.
  }
  const backupReceipt = verifyPersistedLocalStateBackup({
    backupId,
    createdAt,
    sourceRaw: currentRaw,
    persistedRaw,
    expectedCityId: activeCity.id,
    expectedTimeZone: activeCity.timeZone,
  })
  if (!backupReceipt) return failed('STATE_IMPORT_BACKUP_REQUIRED')
  const plan = planLocalStateImport(parsed.bundle, {
    mode,
    backupReceipt,
    currentCustomState,
    activeCity,
  })
  return plan.ready
    ? Object.freeze({ ok: true, code: 'STATE_IMPORT_PREPARED', bundle: parsed.bundle, plan, backupReceipt })
    : failed(plan.code, { plan, backupReceipt })
}

/** Execute in contract order and stop mutations after the first failed step. */
export async function executeStateTransferImport(plan, { applyStep } = {}) {
  if (!plan?.ready || !Array.isArray(plan.steps) || typeof applyStep !== 'function') {
    return failed('STATE_IMPORT_RUNTIME_INVALID')
  }
  const receipts = []
  let stopped = false
  for (const step of plan.steps) {
    if (stopped) {
      receipts.push(verifyLocalStateImportOutcome(plan, {
        stepId: step.id,
        status: 'skipped',
        code: 'prior-step-failed',
      }))
      continue
    }
    const payload = importStepPayload(plan, step.id)
    if (step.hasPayload && payload === null) {
      receipts.push(verifyLocalStateImportOutcome(plan, {
        stepId: step.id,
        status: 'failed',
        code: 'payload-unavailable',
      }))
      stopped = true
      continue
    }
    let outcome
    try {
      outcome = await applyStep(step, payload)
    } catch {
      outcome = null
    }
    if (!outcome?.ok || typeof outcome.raw !== 'string') {
      receipts.push(verifyLocalStateImportOutcome(plan, {
        stepId: step.id,
        status: 'failed',
        code: typeof outcome?.code === 'string' && ID_RE.test(outcome.code)
          ? outcome.code
          : 'step-write-failed',
      }))
      stopped = true
      continue
    }
    receipts.push(verifyLocalStateImportOutcome(plan, {
      stepId: step.id,
      status: outcome.changed === false ? 'unchanged' : 'applied',
      expectedRaw: outcome.raw,
      persistedRaw: outcome.raw,
    }))
  }
  if (receipts.some((receipt) => receipt === null)) {
    return failed('STATE_IMPORT_RECEIPT_INVALID')
  }
  const summary = aggregateLocalStateImport(plan, receipts)
  return Object.freeze({
    ok: summary.fullSuccess,
    code: summary.code,
    summary,
    receipts: Object.freeze(receipts),
  })
}
