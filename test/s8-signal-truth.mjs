import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createPersonalSignalGate,
  projectPersonalEvidence,
  validateSignalMutation,
} from '../app/src/personal-signals.js'

const event = (id = '1234567890abcdef', extra = {}) => ({
  id,
  title: 'Neighborhood art walk',
  start: '2026-07-21T19:00:00-04:00',
  category: 'art',
  isFree: true,
  ...extra,
})

const place = (key = 'p|riverwalk', extra = {}) => ({
  kind: 'place',
  key,
  name: 'Riverwalk',
  category: 'outdoors',
  placeType: 'trail',
  amenities: ['hiking'],
  ...extra,
})

const activityResult = (extra = {}) => ({
  code: 'recorded',
  changed: true,
  applied: true,
  persisted: true,
  durability: 'durable',
  ...extra,
})

const saveResult = (extra = {}) => ({
  code: 'saved',
  changed: true,
  applied: true,
  saved: true,
  persisted: true,
  durability: 'durable',
  ...extra,
})

const tasteResult = (extra = {}) => ({
  code: 'recorded',
  changed: true,
  applied: true,
  persisted: true,
  durability: 'durable',
  ...extra,
})

test('S8 signal evidence shares retained identity and projects only bounded observed facts', () => {
  const input = place('p|kayak-launch', {
    activity: ' paddling ',
    activityIds: ['paddling', '__proto__', 'birding'],
    activities: ['walking', 'cycling', 'fishing'],
    amenities: ['picnic', 'restroom', 'parking', 'playground', 'overflow'],
  })
  const evidence = projectPersonalEvidence('plan', input, {
    cityId: 'tampa-bay',
    context: {
      daypart: 'afternoon',
      distanceMiles: 4.26,
      distanceObserved: true,
      weather: 'clear',
      weatherObserved: false,
    },
  })

  assert.equal(evidence.primary, 'p|kayak-launch')
  assert.equal(evidence.kind, 'place')
  assert.equal(evidence.placeType, 'trail')
  assert.deepEqual(evidence.activityIds, [
    'paddling', 'birding', 'walking', 'cycling', 'fishing', 'picnic', 'restroom', 'parking',
  ])
  assert.deepEqual(evidence.context, { daypart: 'afternoon', distanceMiles: 4.3 })
  assert.equal(Object.isFrozen(evidence), true)
  assert.equal(Object.isFrozen(evidence.activityIds), true)
  assert.equal(Object.isFrozen(evidence.context), true)
})

test('S8 signal evidence is city scoped and corrupt input degrades to neutral', () => {
  const item = event()
  const tampa = projectPersonalEvidence('open', item, { cityId: 'tampa-bay' })
  const sf = projectPersonalEvidence('open', item, { cityId: 'sf-east-bay' })
  assert.equal(tampa.primary, sf.primary)
  assert.notEqual(tampa.cityId, sf.cityId)

  assert.equal(projectPersonalEvidence('open', null, { cityId: 'tampa-bay' }), null)
  assert.equal(projectPersonalEvidence('open', item, { cityId: 'Tampa Bay' }), null)
  assert.equal(projectPersonalEvidence('unknown', item, { cityId: 'tampa-bay' }), null)
  assert.doesNotThrow(() => projectPersonalEvidence('open', new Proxy({}, {
    get() { throw new Error('hostile getter') },
  }), { cityId: 'tampa-bay' }))
})

test('S8 provider outcome validation distinguishes durable, session-only, no-op, and failure truth', () => {
  assert.deepEqual(validateSignalMutation('open', activityResult(), { source: 'activity' }), {
    persisted: true,
    durability: 'durable',
  })
  assert.deepEqual(validateSignalMutation('save', saveResult({
    persisted: false,
    durability: 'session-only',
  }), { source: 'saved-been' }), {
    persisted: false,
    durability: 'session-only',
  })
  assert.deepEqual(validateSignalMutation('plan', {
    code: 'added',
    changed: true,
    persisted: true,
    durability: 'durable',
  }, { source: 'planner' }), {
    persisted: true,
    durability: 'durable',
  })
  assert.deepEqual(validateSignalMutation('went', {
    code: 'marked-been',
    status: 'went',
    changed: true,
    applied: true,
    persisted: true,
    durability: 'durable',
  }, { source: 'saved-been' }), {
    persisted: true,
    durability: 'durable',
  })

  assert.equal(validateSignalMutation('open', activityResult({ changed: false, code: 'already-current' }), { source: 'activity' }), null)
  assert.equal(validateSignalMutation('deck-no', activityResult({ changed: false, code: 'already-current' }), { source: 'activity' }), null)
  assert.equal(validateSignalMutation('save', saveResult({ saved: false }), { source: 'saved-been' }), null)
  assert.equal(validateSignalMutation('went', {
    code: 'marked-been',
    status: 'missed',
    changed: true,
    applied: true,
    persisted: true,
    durability: 'durable',
  }, { source: 'saved-been' }), null)
  assert.equal(validateSignalMutation('plan', {
    code: 'added',
    changed: true,
    persisted: false,
    durability: 'durable',
  }, { source: 'planner' }), null)
})

test('S8 gate is city scoped, idempotent, bounded, and reports session-only taste exactly', () => {
  const applied = []
  const gate = createPersonalSignalGate({
    maxEntries: 2,
    apply(evidence) {
      applied.push(evidence)
      return evidence.cityId === 'sf-east-bay'
        ? tasteResult({ persisted: false, durability: 'session-only' })
        : tasteResult()
    },
  })

  const first = gate.capture('save', event(), {
    cityId: 'tampa-bay',
    source: 'saved-been',
    result: saveResult(),
  })
  const replay = gate.capture('save', event(), {
    cityId: 'tampa-bay',
    source: 'saved-been',
    result: saveResult(),
  })
  const otherCity = gate.capture('save', event(), {
    cityId: 'sf-east-bay',
    source: 'saved-been',
    result: saveResult(),
  })

  assert.equal(first.code, 'applied')
  assert.equal(replay.code, 'duplicate')
  assert.equal(replay.applied, false)
  assert.equal(otherCity.code, 'applied-session-only')
  assert.equal(otherCity.persisted, false)
  assert.equal(otherCity.durability, 'session-only')
  assert.equal(applied.length, 2)
  assert.equal(gate.size(), 2)

  gate.capture('save', event('aaaaaaaaaaaaaaaa'), {
    cityId: 'tampa-bay',
    source: 'saved-been',
    result: saveResult(),
  })
  assert.equal(gate.size(), 2, 'the in-memory anti-farming ledger stays capped')
})

test('S8 gate does not reserve failed taste writes and deck retry cannot get stranded', () => {
  let writes = 0
  const gate = createPersonalSignalGate({
    maxEntries: 1,
    apply() {
      writes += 1
      return writes === 1
        ? { code: 'storage-failed', applied: false, changed: false, persisted: false, durability: 'unchanged' }
        : tasteResult()
    },
  })
  const item = event()
  const failed = gate.capture('deck-no', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: activityResult(),
  })
  const retried = gate.capture('deck-no', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: activityResult({ changed: false, code: 'already-current' }),
  })
  const oppositeReplay = gate.capture('deck-yes', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: activityResult({ changed: false, code: 'already-current' }),
  })

  assert.equal(failed.code, 'taste-unavailable')
  assert.equal(retried.code, 'applied')
  assert.equal(oppositeReplay.code, 'duplicate', 'yes/no share one deck signal family')
  assert.equal(writes, 2)
})

test('S8 deck already-current is admitted only for this gate exact failed write', () => {
  const item = event()
  const retry = activityResult({ changed: false, code: 'already-current' })
  const directGate = createPersonalSignalGate({ apply: () => tasteResult() })
  assert.equal(directGate.capture('deck-no', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: retry,
  }).code, 'source-unavailable', 'persisted Activity state is not preference evidence after reload')

  let writes = 0
  const gate = createPersonalSignalGate({
    maxEntries: 1,
    apply() {
      writes += 1
      return writes === 1
        ? { code: 'storage-failed', applied: false, changed: false, persisted: false, durability: 'unchanged' }
        : tasteResult()
    },
  })
  assert.equal(gate.capture('deck-no', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: activityResult(),
  }).code, 'taste-unavailable')

  assert.equal(gate.capture('deck-no', item, {
    cityId: 'sf-east-bay',
    source: 'activity',
    result: retry,
  }).code, 'source-unavailable', 'pending retry is city scoped')
  assert.equal(gate.capture('deck-no', event('aaaaaaaaaaaaaaaa'), {
    cityId: 'tampa-bay',
    source: 'activity',
    result: retry,
  }).code, 'source-unavailable', 'pending retry is identity scoped')
  assert.equal(gate.capture('deck-yes', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: retry,
  }).code, 'source-unavailable', 'pending retry keeps the exact deck verdict')
  assert.equal(writes, 1, 'rejected retry shapes never reach taste storage')

  assert.equal(gate.capture('deck-no', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: retry,
  }).code, 'applied')
  assert.equal(writes, 2)
  assert.equal(gate.capture('deck-no', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: retry,
  }).code, 'duplicate', 'success consumes retry authority and the seen ledger blocks replay')
  assert.equal(writes, 2)

  assert.equal(gate.capture('deck-no', event('bbbbbbbbbbbbbbbb'), {
    cityId: 'tampa-bay',
    source: 'activity',
    result: activityResult(),
  }).code, 'applied')
  assert.equal(gate.capture('deck-no', item, {
    cityId: 'tampa-bay',
    source: 'activity',
    result: retry,
  }).code, 'source-unavailable', 'consumed retry stays unavailable after the seen entry is evicted')
  assert.equal(writes, 3)
})

test('S8 gate never applies provider failure, replay, corrupt evidence, or missed attendance', () => {
  let writes = 0
  const gate = createPersonalSignalGate({
    apply() {
      writes += 1
      return tasteResult()
    },
  })

  assert.equal(gate.capture('open', event(), {
    source: 'activity',
    result: activityResult({ changed: false, code: 'already-current' }),
  }).code, 'source-unavailable')
  assert.equal(gate.capture('save', {}, {
    source: 'saved-been',
    result: saveResult(),
  }).code, 'invalid-evidence')
  assert.equal(gate.capture('went', event(), {
    source: 'saved-been',
    result: {
      code: 'marked-been',
      status: 'missed',
      changed: true,
      applied: true,
      persisted: true,
      durability: 'durable',
    },
  }).code, 'source-unavailable')
  assert.equal(writes, 0)
})

test('S8 runtime seams apply preference only after authoritative provider outcomes', async () => {
  const files = Object.fromEntries(await Promise.all([
    'app/src/nav.jsx',
    'app/src/saves.js',
    'app/src/MyPlansPage.jsx',
    'app/src/DetailPage.jsx',
    'app/src/PlaceDetail.jsx',
    'app/src/DayPage.jsx',
  ].map(async file => [file, await readFile(file, 'utf8')])))

  assert.equal(files['app/src/nav.jsx'].includes("recordSignal('open'"), false)
  assert.equal(files['app/src/nav.jsx'].includes("recordSignal('bubble'"), false)
  assert.equal(files['app/src/saves.js'].includes("recordSignal('save'"), false)
  assert.equal(files['app/src/MyPlansPage.jsx'].includes("recordSignal('went'"), false)

  const navRecord = files['app/src/nav.jsx'].indexOf('recordView(e)')
  const navSignal = files['app/src/nav.jsx'].indexOf("capturePersonalSignal('open'")
  assert.ok(navRecord >= 0 && navSignal > navRecord)

  const saveWrite = files['app/src/saves.js'].indexOf('await toggleSaved(item')
  const saveSignal = files['app/src/saves.js'].indexOf("capturePersonalSignal('save'")
  assert.ok(saveWrite >= 0 && saveSignal > saveWrite)

  const wentWrite = files['app/src/MyPlansPage.jsx'].indexOf('await markBeenAction(target')
  const wentSignal = files['app/src/MyPlansPage.jsx'].indexOf("capturePersonalSignal('went'")
  assert.ok(wentWrite >= 0 && wentSignal > wentWrite)
  assert.equal(files['app/src/MyPlansPage.jsx'].includes("capturePersonalSignal('missed'"), false)

  for (const file of ['app/src/DetailPage.jsx', 'app/src/PlaceDetail.jsx', 'app/src/DayPage.jsx']) {
    const plannerWrite = files[file].indexOf('await add(e,')
    const planSignal = files[file].indexOf("capturePersonalSignal('plan'")
    assert.ok(plannerWrite >= 0 && planSignal > plannerWrite, `${file} captures only after planner add`)
  }
})
