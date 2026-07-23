/* eslint-disable react-refresh/only-export-components -- provider and hook share one contract. */
import { createContext, useCallback, useContext, useMemo } from 'react'
import { useActivity } from './ActivityProvider.jsx'
import { emptyActivityState } from './activity-state-core.js'
import { useCustomEvents } from './CustomEventsProvider.jsx'
import { emptyCustomEventState } from './custom-event-state-core.js'
import { exportCorrectionState, useCorrections } from './corrections.js'
import { createLocalStateBundle, serializeLocalStateBundle } from './local-state-transfer.js'
import { emptyPlannerDocument } from './planner-core.js'
import { usePlanner } from './PlannerProvider.jsx'
import { clearPrimerState, exportPrimerState, replacePrimerState } from './Primer.jsx'
import { exportProfileState, importProfileState } from './profile-state.js'
import { useSavedBeen } from './SavedBeenProvider.jsx'
import { emptySavedBeenState } from './saved-been-state-core.js'
import { exportSearchRecents, replaceSearchRecents } from './search.js'
import { executeStateTransferImport, prepareStateTransferImport } from './state-transfer-runtime.js'
import { lsReadDurable, lsSet } from './storage.js'
import { emptyTasteState, exportTasteState, replaceTasteState } from './taste.js'

export const STATE_TRANSFER_BACKUP_KEY = 'state-transfer-backup-v1'
export const STATE_TRANSFER_BACKUP_VERSION = 1

const StateTransferContext = createContext(null)
const rawOf = (value) => JSON.stringify(value)

function publicProfile() {
  const state = exportProfileState()
  return { v: 1, name: state.name, bio: state.bio }
}

function stepResult(ok, code, raw, changed = true) {
  return Object.freeze({ ok, code, raw: ok ? raw : null, changed: ok && changed })
}

function unchangedSince(expected, actual) {
  return typeof expected === 'string' && rawOf(actual) === expected
}

export function StateTransferProvider({ city, children }) {
  const custom = useCustomEvents()
  const planner = usePlanner()
  const savedBeen = useSavedBeen()
  const activity = useActivity()
  const corrections = useCorrections()
  const activeCity = useMemo(() => ({ id: city.id, timeZone: city.tz }), [city.id, city.tz])
  const transferBlockers = useMemo(() => [
    custom.durability !== 'durable' || typeof custom.transferCommitId !== 'string'
      || custom.document === null || typeof custom.document !== 'object'
      ? `custom:${custom.durability || 'unknown'}:${custom.transferCommitId ? 'commit' : 'no-commit'}` : null,
    planner.durability !== 'durable' || typeof planner.transferCommitId !== 'string'
      || planner.document === null || typeof planner.document !== 'object'
      ? `planner:${planner.durability || 'unknown'}:${planner.transferCommitId ? 'commit' : 'no-commit'}` : null,
    savedBeen.durability !== 'durable' || typeof savedBeen.transferCommitId !== 'string'
      || savedBeen.document === null || typeof savedBeen.document !== 'object'
      ? `saved:${savedBeen.durability || 'unknown'}:${savedBeen.transferCommitId ? 'commit' : 'no-commit'}` : null,
    activity.durability !== 'durable' || typeof activity.transferCommitId !== 'string'
      || activity.document === null || typeof activity.document !== 'object'
      ? `activity:${activity.durability || 'unknown'}:${activity.transferCommitId ? 'commit' : 'no-commit'}` : null,
    corrections.status !== 'ready' || corrections.durability !== 'durable'
      ? `corrections:${corrections.status || 'unknown'}:${corrections.durability || 'unknown'}` : null,
  ].filter(Boolean), [
    activity.document,
    activity.durability,
    activity.transferCommitId,
    corrections.durability,
    corrections.status,
    custom.document,
    custom.durability,
    custom.transferCommitId,
    planner.document,
    planner.durability,
    planner.transferCommitId,
    savedBeen.document,
    savedBeen.durability,
    savedBeen.transferCommitId,
  ])
  const transferReady = transferBlockers.length === 0

  const captureState = useCallback((exportedAt = Date.now()) => {
    if (!transferReady) throw new Error('state transfer is not ready')
    const globalProfile = publicProfile()
    const sections = {
      customEvents: custom.document,
      corrections: exportCorrectionState(),
      planner: planner.document,
      savedBeen: savedBeen.document,
      activity: activity.document,
      taste: exportTasteState(),
      primer: exportPrimerState(),
      searchRecents: exportSearchRecents(),
    }
    const bundle = createLocalStateBundle({ exportedAt, activeCity, globalProfile, sections })
    return Object.freeze({
      bundle,
      currentCustomState: sections.customEvents,
      preconditions: Object.freeze({
        commits: Object.freeze({
          customEvents: custom.transferCommitId,
          planner: planner.transferCommitId,
          savedBeen: savedBeen.transferCommitId,
          activity: activity.transferCommitId,
        }),
        direct: Object.freeze({
          globalProfile: rawOf(globalProfile),
          corrections: rawOf(sections.corrections),
          taste: rawOf(sections.taste),
          primer: rawOf(sections.primer),
          searchRecents: rawOf(sections.searchRecents),
        }),
      }),
    })
  }, [
    activeCity,
    activity.document,
    activity.transferCommitId,
    custom.document,
    custom.transferCommitId,
    planner.document,
    planner.transferCommitId,
    savedBeen.document,
    savedBeen.transferCommitId,
    transferReady,
  ])

  const exportJson = useCallback(() => {
    try {
      const bundle = captureState().bundle
      return Object.freeze({
        ok: true,
        code: 'STATE_EXPORT_READY',
        bundle,
        raw: serializeLocalStateBundle(bundle),
      })
    } catch {
      return Object.freeze({ ok: false, code: 'STATE_EXPORT_UNAVAILABLE', bundle: null, raw: null })
    }
  }, [captureState])

  const applyStep = useCallback(async (step, payload, preconditions) => {
    if (step.operation !== 'replace') return stepResult(false, 'merge-not-supported', null)
    if (step.section === 'globalProfile') {
      if (!unchangedSince(preconditions?.direct.globalProfile, publicProfile())) {
        return stepResult(false, 'state-changed-before-import', null)
      }
      const result = importProfileState({ version: 1, name: payload.name, bio: payload.bio })
      const raw = rawOf(publicProfile())
      return stepResult(result.ok === true && raw === rawOf(payload), result.code, raw)
    }
    if (step.section === 'customEvents') {
      const document = payload || emptyCustomEventState(city.id, { timeZone: city.tz })
      const result = await custom.replaceDocument(document, {
        expectedCommitId: preconditions?.commits.customEvents,
      })
      return stepResult(result.ok === true, result.code, result.raw, result.changed)
    }
    if (step.section === 'corrections') {
      if (!unchangedSince(preconditions?.direct.corrections, exportCorrectionState())) {
        return stepResult(false, 'state-changed-before-import', null)
      }
      const document = payload || { v: 1, cityId: city.id, corrections: [] }
      const result = corrections.replace(document)
      const raw = rawOf(exportCorrectionState())
      return stepResult(result.persisted === true && raw === rawOf(document), result.code, raw, result.changed)
    }
    if (step.section === 'planner') {
      const document = payload || emptyPlannerDocument()
      const result = await planner.replaceDocument(document, {
        expectedCommitId: preconditions?.commits.planner,
      })
      return stepResult(result.ok === true, result.code, result.raw, result.changed)
    }
    if (step.section === 'savedBeen') {
      const document = payload || emptySavedBeenState(city.id)
      const result = await savedBeen.replaceDocument(document, {
        expectedCommitId: preconditions?.commits.savedBeen,
      })
      return stepResult(result.ok === true, result.code, result.raw, result.changed)
    }
    if (step.section === 'activity') {
      const document = payload || emptyActivityState(city.id)
      const result = await activity.replaceDocument(document, {
        expectedCommitId: preconditions?.commits.activity,
      })
      return stepResult(result.ok === true, result.code, result.raw, result.changed)
    }
    if (step.section === 'taste') {
      if (!unchangedSince(preconditions?.direct.taste, exportTasteState())) {
        return stepResult(false, 'state-changed-before-import', null)
      }
      const document = payload || emptyTasteState()
      const result = replaceTasteState(document)
      const raw = rawOf(exportTasteState())
      return stepResult(result.persisted === true && raw === rawOf(document), result.code, raw)
    }
    if (step.section === 'primer') {
      if (!unchangedSince(preconditions?.direct.primer, exportPrimerState())) {
        return stepResult(false, 'state-changed-before-import', null)
      }
      const result = payload === null ? clearPrimerState() : replacePrimerState(payload)
      return stepResult(result.persisted === true, result.code, result.raw, true)
    }
    if (step.section === 'searchRecents') {
      if (!unchangedSince(preconditions?.direct.searchRecents, exportSearchRecents())) {
        return stepResult(false, 'state-changed-before-import', null)
      }
      const document = payload || { v: 1, items: [] }
      const result = replaceSearchRecents(document)
      const raw = rawOf(exportSearchRecents())
      return stepResult(result.ok === true && raw === rawOf(document), result.code, raw)
    }
    return stepResult(false, 'unsupported-state-section', null)
  }, [activity, city.id, city.tz, corrections, custom, planner, savedBeen])

  const importJson = useCallback(async (raw, { mode = 'replace' } = {}) => {
    if (mode !== 'replace') {
      return Object.freeze({ ok: false, code: 'STATE_IMPORT_MODE_UNSUPPORTED' })
    }
    let captured
    try {
      captured = captureState()
    } catch {
      return Object.freeze({ ok: false, code: 'STATE_BACKUP_SOURCE_INVALID' })
    }
    const prepared = await prepareStateTransferImport(raw, {
      activeCity,
      currentBundle: captured.bundle,
      currentCustomState: captured.currentCustomState,
      mode,
      persistBackup: async (backupRaw, { backupId, createdAt }) => {
        const envelope = {
          v: STATE_TRANSFER_BACKUP_VERSION,
          backupId,
          createdAt,
          cityId: activeCity.id,
          timeZone: activeCity.timeZone,
          raw: backupRaw,
        }
        const encoded = rawOf(envelope)
        const wrote = lsSet(STATE_TRANSFER_BACKUP_KEY, encoded) === true
        const landed = lsReadDurable(STATE_TRANSFER_BACKUP_KEY)
        if (!wrote || landed !== encoded) return null
        try {
          const verified = JSON.parse(landed)
          return rawOf(verified) === encoded ? verified.raw : null
        } catch {
          return null
        }
      },
    })
    if (!prepared.ok) return prepared
    return executeStateTransferImport(prepared.plan, {
      applyStep: (step, payload) => applyStep(step, payload, captured.preconditions),
    })
  }, [activeCity, applyStep, captureState])

  const value = useMemo(() => ({
    activeCity,
    ready: transferReady,
    status: transferReady ? 'ready' : 'unavailable',
    blockers: transferBlockers,
    exportJson,
    importJson,
  }), [activeCity, exportJson, importJson, transferBlockers, transferReady])

  return <StateTransferContext.Provider value={value}>{children}</StateTransferContext.Provider>
}

export function useStateTransfer() {
  const value = useContext(StateTransferContext)
  if (!value) throw new Error('useStateTransfer must be used within StateTransferProvider')
  return value
}
