import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { emptyActivityState } from '../app/src/activity-state-core.js'
import {
  emptyCustomEventState,
  normalizeCustomEventState,
  reduceCustomEventState,
} from '../app/src/custom-event-state-core.js'
import {
  LOCAL_STATE_IMPORT_ORDER,
  LOCAL_STATE_SECTION_CONTRACTS,
  LOCAL_STATE_TRANSFER_MAX_BYTES,
  aggregateLocalStateImport,
  createLocalStateBundle,
  importStepPayload,
  parseLocalStateBundle,
  planLocalStateImport,
  serializeLocalStateBundle,
  verifyLocalStateImportOutcome,
  verifyPersistedLocalStateBackup,
} from '../app/src/local-state-transfer.js'
import { addPlannerItem, emptyPlannerDocument } from '../app/src/planner-core.js'
import { emptySavedBeenState } from '../app/src/saved-been-state-core.js'

const CITY = { id: 'tampa-bay', timeZone: 'America/New_York' }
const EXPORTED_AT = Date.UTC(2026, 6, 21, 12)

function sectionData() {
  const custom = reduceCustomEventState(
    emptyCustomEventState(CITY.id, { timeZone: CITY.timeZone }),
    {
      type: 'add',
      event: {
        kind: 'custom',
        localId: 'transfer-local-id',
        title: 'Porch show',
        start: '2026-07-25T20:00:00',
        end: null,
        venue: 'The porch',
        address: '1 Main St',
        price: 0,
        currency: 'USD',
        isFree: true,
        lat: 27.95,
        lng: -82.46,
        url: null,
        image: null,
        sources: ['Added by you'],
        tags: ['added-by-you'],
      },
    },
    { cityId: CITY.id, timeZone: CITY.timeZone },
  )
  assert.equal(custom.changed, true)
  return {
    customEvents: custom.document,
    corrections: { v: 1, cityId: CITY.id, corrections: [] },
    planner: emptyPlannerDocument(),
    savedBeen: emptySavedBeenState(CITY.id),
    activity: emptyActivityState(CITY.id),
    taste: {
      v: 1,
      n: 1,
      organicN: 1,
      catScores: { music: 3 },
      avoidScores: {},
      freeAffinity: 0,
      explore: 0.5,
      _interview: null,
      _primer: null,
      prefs: { boost: [], mute: [], when: null },
    },
    primer: { v: 1, done: true, when: 'weekends' },
    searchRecents: ['jazz'],
  }
}

function bundle(options = {}) {
  return createLocalStateBundle({
    exportedAt: EXPORTED_AT,
    activeCity: CITY,
    globalProfile: { name: ' Josh ', bio: 'Weekend explorer' },
    sections: sectionData(),
    ...options,
  })
}

function backup(value = bundle(), overrides = {}) {
  const raw = serializeLocalStateBundle(value)
  const receipt = verifyPersistedLocalStateBackup({
    backupId: 'backup-20260721',
    createdAt: EXPORTED_AT + 1,
    sourceRaw: raw,
    persistedRaw: raw,
    expectedCityId: CITY.id,
    expectedTimeZone: CITY.timeZone,
  })
  return Object.keys(overrides).length > 0 ? Object.freeze({ ...receipt, ...overrides }) : receipt
}

function planImport(value = bundle(), options = {}) {
  return planLocalStateImport(value, { activeCity: CITY, ...options })
}

function expectedStepRaw(plan, step) {
  return JSON.stringify(importStepPayload(plan, step.id))
}

function persistedOutcome(plan, step, status = 'applied') {
  const raw = expectedStepRaw(plan, step)
  return verifyLocalStateImportOutcome(plan, {
    stepId: step.id,
    status,
    expectedRaw: raw,
    persistedRaw: raw,
  })
}

test('export separates global profile from one bound city and removes transient/private fields', () => {
  const value = bundle()
  assert.deepEqual(value.activeCity, CITY)
  assert.deepEqual(value.globalProfile, { v: 1, name: 'Josh', bio: 'Weekend explorer' })
  assert.equal(value.cityState.cityId, CITY.id)
  assert.equal(value.cityState.timeZone, CITY.timeZone)
  assert.equal(value.cityState.sections.customEvents.stateVersion, 2)
  assert.equal(value.cityState.sections.planner.stateVersion, 2)
  assert.deepEqual(value.cityState.sections.searchRecents.data, { v: 1, items: ['jazz'] })
  assert.doesNotMatch(JSON.stringify(value), /weatherCache|"lat"|"lng"|coordinates|locationPermission/)
  assert.deepEqual(Object.keys(value.cityState.sections), Object.keys(LOCAL_STATE_SECTION_CONTRACTS))

  const raw = serializeLocalStateBundle(value)
  const parsed = parseLocalStateBundle(raw, {
    expectedCityId: CITY.id,
    expectedTimeZone: CITY.timeZone,
  })
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.bundle, value)
  const custom = parsed.bundle.cityState.sections.customEvents.data
  assert.ok(normalizeCustomEventState(custom, { cityId: CITY.id, timeZone: CITY.timeZone }))
})

test('bundle validation rejects unknown sections, wrong versions, city/timezone drift, and forbidden fields', () => {
  assert.throws(() => bundle({ sections: { ...sectionData(), weather: { v: 1 } } }), /unsupported/i)
  const value = JSON.parse(serializeLocalStateBundle(bundle()))
  const mutations = [
    (copy) => { copy.v = 2 },
    (copy) => { copy.cityState.cityId = 'sf-east-bay' },
    (copy) => { copy.cityState.sections.activity.cityId = 'sf-east-bay' },
    (copy) => { copy.cityState.sections.planner.stateVersion = 1 },
    (copy) => { copy.cityState.sections.taste.data.v = 2 },
    (copy) => { copy.cityState.sections.planner.data.coords = { lat: 1, lng: 2 } },
    (copy) => { copy.cityState.sections.corrections.data.corrections.push({ id: 'malformed' }) },
    (copy) => { copy.globalProfile.extra = true },
  ]
  for (const mutate of mutations) {
    const copy = structuredClone(value)
    mutate(copy)
    assert.equal(parseLocalStateBundle(JSON.stringify(copy)).ok, false)
  }
  assert.equal(parseLocalStateBundle(JSON.stringify(value), {
    expectedCityId: 'sf-east-bay',
    expectedTimeZone: CITY.timeZone,
  }).ok, false)
})

test('total and per-section byte ceilings fail closed', () => {
  assert.equal(parseLocalStateBundle('x'.repeat(LOCAL_STATE_TRANSFER_MAX_BYTES + 1)).code, 'STATE_BUNDLE_TOO_LARGE')
  const sections = sectionData()
  sections.taste.padding = 'x'.repeat(LOCAL_STATE_SECTION_CONTRACTS.taste.maxBytes)
  assert.throws(() => bundle({ sections }), /taste/i)
})

test('import is blocked until an exact same-city backup is durably persisted', () => {
  const value = bundle()
  assert.equal(planLocalStateImport(value, {
    mode: 'merge',
    backupReceipt: backup(),
  }).code, 'STATE_IMPORT_CITY_MISMATCH')
  assert.equal(planImport(value, {
    mode: 'merge',
    backupReceipt: backup(),
    activeCity: { id: 'sf-east-bay', timeZone: 'America/Los_Angeles' },
  }).code, 'STATE_IMPORT_CITY_MISMATCH')
  assert.equal(planImport(value, { mode: 'merge' }).code, 'STATE_IMPORT_BACKUP_REQUIRED')
  assert.equal(planImport(value, {
    mode: 'merge',
    backupReceipt: backup(bundle(), { status: 'session-only' }),
  }).code, 'STATE_IMPORT_BACKUP_REQUIRED')
  assert.equal(planImport(value, {
    mode: 'merge',
    backupReceipt: backup(bundle(), { cityId: 'sf-east-bay' }),
  }).code, 'STATE_IMPORT_BACKUP_REQUIRED')
  assert.equal(planImport(value, {
    mode: 'append',
    backupReceipt: backup(),
  }).code, 'STATE_IMPORT_MODE_INVALID')

  const real = backup()
  assert.equal(planImport(value, {
    mode: 'merge',
    backupReceipt: { ...real },
  }).code, 'STATE_IMPORT_BACKUP_REQUIRED')
  const raw = serializeLocalStateBundle(value)
  assert.equal(verifyPersistedLocalStateBackup({
    backupId: 'backup-mismatch',
    createdAt: EXPORTED_AT,
    sourceRaw: raw,
    persistedRaw: `${raw} `,
    expectedCityId: CITY.id,
    expectedTimeZone: CITY.timeZone,
  }), null)
})

test('whole-bundle preflight rejects a malformed later store before exposing step one', () => {
  const valid = bundle()
  const malformed = JSON.parse(serializeLocalStateBundle(valid))
  malformed.cityState.sections.activity.data.recents = {}
  assert.equal(malformed.cityState.sections.activity.stateVersion, 2)
  const blocked = planImport(malformed, {
    mode: 'replace',
    backupReceipt: backup(),
  })
  assert.equal(blocked.code, 'STATE_IMPORT_BUNDLE_INVALID')
  assert.equal(blocked.ready, false)
  assert.deepEqual(blocked.steps, [])

  const badTaste = JSON.parse(serializeLocalStateBundle(valid))
  badTaste.cityState.sections.taste.data.placeTypeScores = { park: 4 }
  assert.equal(planImport(badTaste, {
    mode: 'replace',
    backupReceipt: backup(),
  }).code, 'STATE_IMPORT_BUNDLE_INVALID')
})

test('planner custom references resolve against imported or current strict identity state', () => {
  const sections = sectionData()
  const entry = sections.customEvents.items[0]
  const planned = addPlannerItem(emptyPlannerDocument(), {
    dayTs: 2_000,
    part: 'night',
    plannedAt: EXPORTED_AT,
    item: {
      kind: 'custom',
      primary: entry.primary,
      aliases: entry.aliases,
      title: entry.item.title,
      start: entry.item.start,
    },
  })
  assert.equal(planned.changed, true)
  sections.planner = planned.document
  const withImportedCustom = bundle({ sections })
  assert.equal(planImport(withImportedCustom, {
    mode: 'replace',
    backupReceipt: backup(),
  }).status, 'ready')

  const missing = { ...sections, customEvents: emptyCustomEventState(CITY.id, { timeZone: CITY.timeZone }) }
  const withoutImportedCustom = bundle({ sections: missing })
  assert.equal(planImport(withoutImportedCustom, {
    mode: 'replace',
    backupReceipt: backup(),
  }).code, 'STATE_IMPORT_PREFLIGHT_FAILED')
  assert.equal(planImport(withoutImportedCustom, {
    mode: 'merge',
    backupReceipt: backup(),
    currentCustomState: sections.customEvents,
  }).status, 'ready')
})

test('merge and replace plans are ordered with custom events before dependent planner state', () => {
  const value = bundle()
  for (const mode of ['merge', 'replace']) {
    const plan = planImport(value, { mode, backupReceipt: backup() })
    assert.equal(plan.status, 'ready')
    assert.equal(plan.mode, mode)
    assert.deepEqual(plan.steps.map((step) => step.section), LOCAL_STATE_IMPORT_ORDER)
    const customIndex = plan.steps.findIndex((step) => step.section === 'customEvents')
    const plannerIndex = plan.steps.findIndex((step) => step.section === 'planner')
    assert.ok(customIndex < plannerIndex)
    assert.deepEqual(plan.steps[plannerIndex].dependsOn, ['import-customEvents'])
  }

  const sparse = bundle({ sections: { planner: sectionData().planner } })
  const merged = planImport(sparse, { mode: 'merge', backupReceipt: backup() })
  assert.deepEqual(merged.steps.map((step) => step.section), ['globalProfile', 'planner'])
  const replaced = planImport(sparse, { mode: 'replace', backupReceipt: backup() })
  assert.deepEqual(replaced.steps.map((step) => step.section), LOCAL_STATE_IMPORT_ORDER)
  assert.equal(replaced.steps.find((step) => step.section === 'customEvents').hasPayload, false)
  assert.deepEqual(replaced.steps.find((step) => step.section === 'planner').dependsOn, ['import-customEvents'])
})

test('plans and exact-readback outcomes are opaque bundle-bound capabilities', () => {
  const value = bundle()
  const plan = planImport(value, { mode: 'replace', backupReceipt: backup(value) })
  assert.equal(plan.status, 'ready')
  const searchStep = plan.steps.find((step) => step.section === 'searchRecents')
  const payload = importStepPayload(plan, searchStep.id)
  assert.deepEqual(payload, { v: 1, items: ['jazz'] })
  assert.equal(Object.isFrozen(payload), true)
  assert.equal(Object.isFrozen(payload.items), true)
  assert.throws(() => payload.items.push('mutable'))

  value.cityState.sections.searchRecents.data.items.push('caller mutation')
  assert.deepEqual(importStepPayload(plan, searchStep.id), { v: 1, items: ['jazz'] })
  assert.equal(importStepPayload({ ...plan }, searchStep.id), null)

  const expectedRaw = expectedStepRaw(plan, searchStep)
  assert.equal(verifyLocalStateImportOutcome(plan, {
    stepId: searchStep.id,
    status: 'applied',
    expectedRaw,
    persistedRaw: `${expectedRaw} `,
  }), null)
  const wrongButValid = JSON.stringify({ v: 1, items: ['other'] })
  assert.equal(verifyLocalStateImportOutcome(plan, {
    stepId: searchStep.id,
    status: 'applied',
    expectedRaw: wrongButValid,
    persistedRaw: wrongButValid,
  }), null, 'replace readback must equal the plan-bound payload')

  const receipt = persistedOutcome(plan, searchStep)
  assert.ok(receipt)
  assert.equal(aggregateLocalStateImport({ ...plan }, [receipt]).status, 'invalid')
  assert.equal(aggregateLocalStateImport(plan, [{ ...receipt }]).status, 'invalid')

  const second = planImport(bundle(), { mode: 'replace', backupReceipt: backup() })
  assert.equal(aggregateLocalStateImport(second, [receipt]).status, 'invalid')
})

test('aggregate receipts can never report full success after a partial or unverified write', () => {
  const plan = planImport(bundle(), { mode: 'merge', backupReceipt: backup() })
  const success = plan.steps.map((step) => persistedOutcome(plan, step))
  assert.deepEqual(aggregateLocalStateImport(plan, success), {
    status: 'complete',
    code: 'STATE_IMPORT_COMPLETE',
    fullSuccess: true,
    succeeded: plan.steps.length,
    failed: 0,
    skipped: 0,
    pending: 0,
  })

  const partial = success.slice()
  partial[2] = verifyLocalStateImportOutcome(plan, {
    stepId: plan.steps[2].id,
    status: 'failed',
    code: 'write-failed',
  })
  assert.equal(aggregateLocalStateImport(plan, partial).status, 'partial')
  assert.equal(aggregateLocalStateImport(plan, partial).fullSuccess, false)

  const unverified = success.slice()
  unverified[0] = { ...unverified[0] }
  assert.equal(aggregateLocalStateImport(plan, unverified).status, 'invalid')
  assert.equal(aggregateLocalStateImport(plan, unverified).fullSuccess, false)

  assert.equal(aggregateLocalStateImport(plan, success.slice(1)).status, 'incomplete')
  assert.equal(aggregateLocalStateImport(plan, success.slice(1)).fullSuccess, false)
  assert.equal(aggregateLocalStateImport(plan, [success[0], success[0]]).status, 'invalid')
})

test('the transfer foundation owns no browser storage or provider mutation', () => {
  const source = readFileSync(new URL('../app/src/local-state-transfer.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ['"].*storage|\.setItem\s*\(|lsSet|globalSet/)
  assert.doesNotMatch(source, /createActivityStore|createPlannerStore|createCustomEventStore|createSavedBeenStore/)
  assert.match(source, /requiresBackup: true/)
})
