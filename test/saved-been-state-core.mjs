import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SAVED_BEEN_ALIAS_MAX_COUNT,
  SAVED_BEEN_BEEN_CAP,
  SAVED_BEEN_CANDIDATE_MAX_COUNT,
  SAVED_BEEN_COMMAND_MAX_BYTES,
  SAVED_BEEN_DOCUMENT_MAX_BYTES,
  SAVED_BEEN_IMPORT_MAX_BYTES,
  SAVED_BEEN_RECORD_MAX_BYTES,
  SAVED_BEEN_SAVE_CAP,
  SAVED_BEEN_SNAPSHOT_MAX_BYTES,
  SAVED_BEEN_STATE_VERSION,
  SAVED_BEEN_STRING_MAX_BYTES,
  addSaved,
  archiveSaved,
  canonicalizeSavedBeenCommand,
  emptySavedBeenState,
  importSavedBeen,
  markBeen,
  migrateV1SavedBeenState as migrateSavedBeenRaw,
  normalizeSavedBeenState,
  reduceSavedBeenState,
  removeSaved,
  savedBeenRefOf,
  savedBeenRecordsWithoutTokens,
  savedBeenStateBytes,
  toggleSaved,
  unmarkBeen,
} from '../app/src/saved-been-state-core.js'

const CITY_ID = 'tampa-bay'
const OTHER_CITY_ID = 'sf-east-bay'
const EVENT_URL = 'https://fixture.test/night-market'
const EVENT_CURRENT = `${EVENT_URL}|2026-07-20T19:00:00-04:00`
const EVENT_OLD = `${EVENT_URL}|2026-07-20`
const REMOVED = 'https://fixture.test/removed|2026-07-01'
const SHARED = 'https://fixture.test/shared|2026-07-20'
const PLACE_KEY = 'p|riverwalk'
const GUIDE_KEY = 'g|date-night'

const events = [
  {
    id: 'aaaaaaaaaaaaaaaa',
    title: 'Night market',
    url: EVENT_URL,
    start: '2026-07-20T19:00:00-04:00',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    title: 'Shared A',
    url: 'https://fixture.test/shared',
    start: '2026-07-20',
  },
  {
    id: 'cccccccccccccccc',
    title: 'Shared B',
    url: 'https://fixture.test/shared',
    start: '2026-07-20',
  },
  {
    kind: 'custom',
    localId: 'custom-event-0001',
    title: 'Porch show',
    start: '2026-07-21T20:00:00-04:00',
  },
]

const places = [{
  kind: 'place',
  key: PLACE_KEY,
  title: 'Riverwalk',
  placeType: 'park',
}]

const guides = [{
  kind: 'guide',
  id: 'date-night',
  title: 'Date night',
  pov: 'An easy night out.',
}]

const seeds = [{
  kind: 'event',
  primary: 'e|aaaaaaaaaaaaaaaa',
  aliases: ['e|aaaaaaaaaaaaaaaa', EVENT_OLD, EVENT_CURRENT],
}]

const clone = (value) => structuredClone(value)

function strictEvidence(source) {
  return {
    savedEvents: {
      key: 'saved-events-v1',
      status: 'ok',
      source: 'legacy',
      value: JSON.stringify(source?.savedEvents),
    },
    beenThere: {
      key: 'been-there-v1',
      status: 'ok',
      source: 'legacy',
      value: JSON.stringify(source?.beenThere),
    },
  }
}

function migrateV1SavedBeenState(source, options = {}) {
  const evidence = Object.prototype.hasOwnProperty.call(options, 'evidence')
    ? options.evidence
    : strictEvidence(source)
  return migrateSavedBeenRaw(source, { ...options, evidence })
}

function event(id = 'dddddddddddddddd', title = 'Fixture event') {
  return {
    id,
    title,
    start: '2026-07-22T19:00:00-04:00',
  }
}

function savedRecord(ref, token, values = {}) {
  return {
    ref,
    snapshot: values.snapshot || { title: 'Saved' },
    token,
    ...(values.savedAt !== undefined ? { savedAt: values.savedAt } : {}),
  }
}

test('creates a deeply immutable city-bound empty document', () => {
  const document = emptySavedBeenState(CITY_ID)
  assert.deepEqual(document, {
    v: SAVED_BEEN_STATE_VERSION,
    cityId: CITY_ID,
    rev: 0,
    saved: [],
    been: [],
  })
  assert.equal(Object.isFrozen(document), true)
  assert.equal(Object.isFrozen(document.saved), true)
  assert.throws(() => document.saved.push('nope'), TypeError)
  for (const cityId of [undefined, null, '', '../sf', 'SF East Bay']) {
    assert.throws(() => emptySavedBeenState(cityId), TypeError)
  }
})

test('builds kind-correct stable references for events, custom events, places, and guides', () => {
  assert.deepEqual(savedBeenRefOf(events[0]), {
    status: 'attached',
    kind: 'event',
    primary: 'e|aaaaaaaaaaaaaaaa',
    aliases: ['e|aaaaaaaaaaaaaaaa', EVENT_CURRENT],
  })
  assert.deepEqual(savedBeenRefOf(events[3]), {
    status: 'attached',
    kind: 'custom',
    primary: 'c|custom-event-0001',
    aliases: [
      'c|custom-event-0001',
      'Porch show|2026-07-21T20:00:00-04:00',
      'wuzup:custom-bridge:v1:19:1c878630bb69a3bd',
      'wuzup:custom-bridge:v1:36:342c59d1177e990f',
    ],
  })
  assert.deepEqual(savedBeenRefOf(places[0]), {
    status: 'attached',
    kind: 'place',
    primary: PLACE_KEY,
    aliases: [PLACE_KEY],
  })
  assert.deepEqual(savedBeenRefOf(guides[0]), {
    status: 'attached',
    kind: 'guide',
    primary: GUIDE_KEY,
    aliases: [GUIDE_KEY],
  })
})

test('migrates strict retained V1 evidence without mutating or overwriting it', () => {
  const source = {
    savedEvents: {
      [EVENT_OLD]: {
        savedAt: 10,
        snapshot: { title: 'Old market title', start: '2026-07-20' },
      },
      [REMOVED]: {
        savedAt: 11,
        snapshot: { title: 'Removed listing', start: '2026-07-01' },
      },
      [SHARED]: {
        savedAt: 12,
        snapshot: { title: 'Shared listing', start: '2026-07-20' },
      },
      [PLACE_KEY]: {
        savedAt: 13,
        snapshot: { kind: 'place', key: PLACE_KEY, title: 'Riverwalk' },
      },
      [GUIDE_KEY]: {
        savedAt: 14,
        snapshot: { kind: 'guide', id: 'date-night', title: 'Date night' },
      },
    },
    beenThere: [
      {
        key: EVENT_CURRENT,
        snapshot: { title: 'Night market', start: '2026-07-20T19:00:00-04:00' },
        archivedAt: 20,
        status: 'missed',
        statusAt: 21,
      },
      {
        key: REMOVED,
        snapshot: { title: 'Removed listing', start: '2026-07-01' },
        archivedAt: 22,
      },
    ],
  }
  const before = clone(source)
  const evidence = {
    savedEvents: {
      key: 'saved-events-v1',
      status: 'ok',
      source: 'legacy',
      value: JSON.stringify(source.savedEvents),
    },
    beenThere: {
      key: 'been-there-v1',
      status: 'ok',
      source: 'destination',
      value: JSON.stringify(source.beenThere),
    },
  }

  const migration = migrateV1SavedBeenState(source, {
    cityId: CITY_ID,
    events,
    places,
    guides,
    seeds,
    evidence,
  })
  const { document } = migration

  assert.deepEqual(source, before)
  assert.equal(migration.status, 'migrated-v1')
  assert.deepEqual(migration.sourceSummary.savedEvents, {
    status: 'ok',
    source: 'legacy',
    bytes: new TextEncoder().encode(evidence.savedEvents.value).byteLength,
    tombstone: false,
  })
  assert.deepEqual(document.saved.map((row) => ({
    kind: row.ref.kind,
    status: row.ref.status,
    key: row.ref.primary ?? row.ref.legacyKey,
  })), [
    { kind: 'event', status: 'attached', key: 'e|aaaaaaaaaaaaaaaa' },
    { kind: 'event', status: 'missing', key: REMOVED },
    { kind: 'event', status: 'ambiguous', key: SHARED },
    { kind: 'place', status: 'attached', key: PLACE_KEY },
    { kind: 'guide', status: 'attached', key: GUIDE_KEY },
  ])
  assert.deepEqual(document.saved[0].ref.aliases, [
    'e|aaaaaaaaaaaaaaaa',
    EVENT_OLD,
    EVENT_CURRENT,
  ])
  assert.deepEqual(document.saved[2].ref.candidates, [
    'e|bbbbbbbbbbbbbbbb',
    'e|cccccccccccccccc',
  ])
  assert.equal(document.saved[3].snapshot.kind, 'place')
  assert.equal(document.saved[4].snapshot.kind, 'guide')
  assert.equal(document.been.length, 2)
  assert.equal(document.been[0].ref.primary, 'e|aaaaaaaaaaaaaaaa')
  assert.equal(document.been[0].status, 'missed')
  assert.equal(document.been[1].ref.status, 'missing')
  assert.equal(migration.diagnostics.invalid, 0)
  assert.equal(Object.isFrozen(migration), true)
  assert.equal(Object.isFrozen(document.saved[0].snapshot), true)
})

test('stable retained keys attach without eagerly loading their live catalogs', () => {
  const stableEvent = 'e|dddddddddddddddd'
  const stableCustom = 'c|custom-event-0002'
  const stablePlace = 'p|lazy-place'
  const stableGuide = 'g|retired-guide'
  const source = {
    savedEvents: {
      [stableEvent]: { snapshot: { title: 'Retained event' } },
      [stableCustom]: { snapshot: { kind: 'custom', title: 'Retained custom event' } },
      [stablePlace]: { snapshot: { kind: 'place', key: stablePlace, title: 'Retained place' } },
      [stableGuide]: { snapshot: { kind: 'guide', id: 'retired-guide', title: 'Retained guide' } },
    },
    beenThere: [],
  }

  const migration = migrateV1SavedBeenState(source, {
    cityId: CITY_ID,
    events: [],
    places: [],
    guides: [],
    seeds: [],
  })

  assert.deepEqual(
    migration.document.saved.map((record) => ({
      kind: record.ref.kind,
      status: record.ref.status,
      primary: record.ref.primary,
    })),
    [
      { kind: 'event', status: 'attached', primary: stableEvent },
      { kind: 'custom', status: 'attached', primary: stableCustom },
      { kind: 'place', status: 'attached', primary: stablePlace },
      { kind: 'guide', status: 'attached', primary: stableGuide },
    ],
  )
  assert.equal(migration.diagnostics.attached, 4)
  assert.equal(migration.diagnostics.missing, 0)
})

test('historical alias seeds cannot invent a live attachment', () => {
  const migration = migrateV1SavedBeenState({
    savedEvents: {
      [EVENT_OLD]: { snapshot: { title: 'Gone market' } },
    },
    beenThere: [],
  }, {
    cityId: CITY_ID,
    seeds,
  })

  assert.deepEqual(migration.document.saved[0].ref, {
    status: 'missing',
    kind: 'event',
    legacyKey: EVENT_OLD,
  })
})

test('normalization rejects malformed, cross-city, and oversized destination data', () => {
  const migrated = migrateV1SavedBeenState({
    savedEvents: {
      [EVENT_CURRENT]: { savedAt: 1, snapshot: { title: 'Night market' } },
    },
    beenThere: [],
  }, { cityId: CITY_ID, events }).document

  assert.deepEqual(normalizeSavedBeenState(migrated, { cityId: CITY_ID }), migrated)
  assert.equal(normalizeSavedBeenState(migrated, { cityId: OTHER_CITY_ID }), null)
  assert.equal(normalizeSavedBeenState({ ...migrated, v: 1 }, { cityId: CITY_ID }), null)
  assert.equal(normalizeSavedBeenState({ ...migrated, saved: {} }, { cityId: CITY_ID }), null)
  assert.equal(normalizeSavedBeenState({
    ...migrated,
    saved: [{ ...migrated.saved[0], token: migrated.rev + 1 }],
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeSavedBeenState({
    ...migrated,
    saved: [savedRecord({
      status: 'missing',
      kind: 'event',
      legacyKey: 'p|cross-kind-place',
    }, 1)],
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeSavedBeenState({
    ...migrated,
    saved: [savedRecord({
      status: 'attached',
      kind: 'event',
      primary: 'e|aaaaaaaaaaaaaaaa',
      aliases: ['e|aaaaaaaaaaaaaaaa', 'p|cross-kind-alias'],
    }, 1)],
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeSavedBeenState({
    ...migrated,
    been: [{
      ref: { status: 'attached', kind: 'guide', primary: GUIDE_KEY, aliases: [GUIDE_KEY] },
      snapshot: { kind: 'guide' },
      token: 1,
    }],
  }, { cityId: CITY_ID }), null)
  assert.equal(normalizeSavedBeenState({
    ...migrated,
    ignored: 'x'.repeat(SAVED_BEEN_DOCUMENT_MAX_BYTES),
  }, { cityId: CITY_ID }), null)
  const cyclic = { ...migrated }
  cyclic.self = cyclic
  assert.equal(normalizeSavedBeenState(cyclic, { cityId: CITY_ID }), null)
  assert.throws(() => normalizeSavedBeenState(migrated, { cityId: '../sf' }), TypeError)
})

test('add, toggle, and remove are immutable, deterministic, and conflict-aware', () => {
  const empty = emptySavedBeenState(CITY_ID)
  const item = event()
  const itemBefore = clone(item)
  const added = addSaved(empty, { item, savedAt: 100 })

  assert.equal(added.code, 'saved')
  assert.equal(added.changed, true)
  assert.equal(added.document.rev, 1)
  assert.equal(added.document.saved[0].token, 1)
  assert.equal(added.document.saved[0].ref.primary, 'e|dddddddddddddddd')
  assert.deepEqual(empty.saved, [])
  assert.deepEqual(item, itemBefore)
  assert.equal(Object.isFrozen(item), false)
  assert.equal(Object.isFrozen(added.document.saved[0]), true)

  const duplicate = addSaved(added.document, { item, savedAt: 101 })
  assert.equal(duplicate.code, 'already-saved')
  assert.equal(duplicate.document.rev, 1)

  const toggled = toggleSaved(added.document, { item, savedAt: 102 })
  assert.equal(toggled.code, 'removed')
  assert.equal(toggled.document.rev, 2)
  assert.deepEqual(toggled.document.saved, [])
  assert.equal(canonicalizeSavedBeenCommand({}, toggled).type, 'remove')

  const readded = addSaved(toggled.document, { item, savedAt: 103 })
  const stale = reduceSavedBeenState(readded.document, toggled.canonical)
  assert.equal(stale.code, 'save-conflict')
  assert.equal(stale.document.saved.length, 1)

  const removed = removeSaved(readded.document, {
    ref: readded.document.saved[0].ref,
    expectedToken: readded.document.saved[0].token,
  })
  assert.equal(removed.code, 'removed')
  assert.equal(removed.document.saved.length, 0)
})

test('event, custom, place, and guide saves remain kind-correct in one document', () => {
  let document = emptySavedBeenState(CITY_ID)
  document = addSaved(document, {
    item: { id: 'eeeeeeeeeeeeeeee', title: 'Event', start: '2026-07-22' },
    savedAt: 1,
  }).document
  document = addSaved(document, {
    item: events[3],
    savedAt: 2,
  }).document
  document = addSaved(document, {
    item: { kind: 'place', key: 'p|fixture-place', title: 'Place' },
    savedAt: 3,
  }).document
  document = addSaved(document, {
    item: guides[0],
    savedAt: 4,
  }).document

  assert.deepEqual(
    document.saved.map((row) => row.ref.kind),
    ['event', 'custom', 'place', 'guide'],
  )
  assert.equal(document.saved[1].snapshot.kind, 'custom')
  assert.equal(document.saved[2].snapshot.kind, 'place')
  assert.equal(document.saved[3].snapshot.kind, 'guide')
})

test('an unlanded session custom identity cannot become a saved primary', () => {
  const sessionCustom = {
    kind: 'custom',
    title: 'Session-only porch show',
    start: '2026-07-22T20:00:00-04:00',
    _keyTitle: 'session-custom-fixture',
    _sessionLegacyIdentity: 'Porch show|2026-07-22T20:00:00-04:00',
    _sessionIdentityAliases: ['wuzup:custom-bridge:v1:36:342c59d1177e990f'],
  }

  assert.equal(savedBeenRefOf(sessionCustom), null)
  const result = addSaved(emptySavedBeenState(CITY_ID), {
    item: sessionCustom,
    savedAt: 1,
  })
  assert.equal(result.changed, false)
  assert.equal(result.code, 'invalid-item')
  assert.deepEqual(result.document.saved, [])
})

test('marking Been preserves unfarmable status semantics and went removes only the matching save', () => {
  const item = event('ffffffffffffffff', 'Went event')
  const saved = addSaved(emptySavedBeenState(CITY_ID), { item, savedAt: 10 })
  const marked = markBeen(saved.document, {
    item,
    status: 'went',
    statusAt: 20,
  })

  assert.equal(marked.code, 'marked-been')
  assert.equal(marked.document.saved.length, 0)
  assert.equal(marked.document.been.length, 1)
  assert.equal(marked.document.been[0].status, 'went')
  assert.equal(marked.document.been[0].savedAt, 10)
  assert.equal(marked.document.been[0].archivedAt, 20)

  const replay = markBeen(marked.document, {
    item,
    status: 'went',
    statusAt: 21,
  })
  const changedAnswer = markBeen(marked.document, {
    item,
    status: 'missed',
    statusAt: 22,
  })
  assert.equal(replay.code, 'already-marked')
  assert.equal(changedAnswer.code, 'already-marked')
  assert.equal(replay.document.rev, marked.document.rev)

  const unmarked = unmarkBeen(marked.document, {
    ref: marked.document.been[0].ref,
    expectedToken: marked.document.been[0].token,
  })
  assert.equal(unmarked.code, 'unmarked-been')
  assert.deepEqual(unmarked.document.been, [])
})

test('missed leaves the save in place and guides cannot enter Been', () => {
  const item = event('1111111111111111', 'Missed event')
  const saved = addSaved(emptySavedBeenState(CITY_ID), { item, savedAt: 10 })
  const missed = markBeen(saved.document, {
    item,
    status: 'missed',
    statusAt: 20,
  })

  assert.equal(missed.document.saved.length, 1)
  assert.equal(missed.document.been[0].status, 'missed')
  assert.equal(markBeen(missed.document, {
    item: guides[0],
    status: 'went',
    statusAt: 30,
  }).code, 'invalid-item')
})

test('expiry archives a save atomically without overwriting an existing Been answer', () => {
  const item = event('1212121212121212', 'Expired save')
  const saved = addSaved(emptySavedBeenState(CITY_ID), { item, savedAt: 10 })
  const archived = archiveSaved(saved.document, {
    item,
    archivedAt: 20,
  })

  assert.equal(archived.code, 'archived')
  assert.equal(archived.document.saved.length, 0)
  assert.deepEqual(archived.document.been[0], {
    ref: saved.document.saved[0].ref,
    snapshot: saved.document.saved[0].snapshot,
    token: 2,
    savedAt: 10,
    archivedAt: 20,
  })

  const replayed = addSaved(archived.document, { item, savedAt: 30 })
  const answered = markBeen(replayed.document, {
    item,
    status: 'missed',
    statusAt: 40,
  })
  const savedAgain = addSaved(answered.document, { item, savedAt: 50 })
  const existingToken = savedAgain.document.been[0].token
  const archivedAgain = archiveSaved(savedAgain.document, {
    item,
    archivedAt: 60,
  })

  assert.equal(archivedAgain.document.saved.length, 0)
  assert.equal(archivedAgain.document.been.length, 1)
  assert.equal(archivedAgain.document.been[0].status, 'missed')
  assert.equal(archivedAgain.document.been[0].statusAt, 40)
  assert.equal(archivedAgain.document.been[0].token, existingToken)

  const staleReplay = reduceSavedBeenState(
    addSaved(saved.document, { item: event('1313131313131313', 'Other'), savedAt: 70 }).document,
    { ...archived.canonical, expectedSaveToken: 999 },
  )
  assert.equal(staleReplay.code, 'save-conflict')
})

test('archive and mark fail explicitly instead of evicting Been history at its cap', () => {
  const target = event('1414141414141414', 'Cap target')
  const source = {
    savedEvents: {
      'e|1414141414141414': {
        savedAt: 1,
        snapshot: target,
      },
    },
    beenThere: Array.from({ length: SAVED_BEEN_BEEN_CAP }, (_, index) => ({
      key: `e|${(index + 1000).toString(16).padStart(16, '0')}`,
      snapshot: { title: `Retained ${index}` },
      archivedAt: index,
    })),
  }
  const full = migrateV1SavedBeenState(source, {
    cityId: CITY_ID,
    events: [target],
  }).document

  const archived = archiveSaved(full, {
    item: target,
    archivedAt: 20,
  })
  const marked = markBeen(full, {
    item: event('1515151515151515', 'New answer'),
    status: 'went',
    statusAt: 30,
  })

  assert.equal(archived.code, 'been-cap-reached')
  assert.equal(marked.code, 'been-cap-reached')
  assert.equal(archived.document.rev, full.rev)
  assert.equal(archived.document.saved.length, 1)
  assert.equal(archived.document.been.length, SAVED_BEEN_BEEN_CAP)
  assert.equal(marked.document.been[0].snapshot.title, 'Retained 0')
})

test('canonical mark commands replay after unrelated changes and reject target ABA changes', () => {
  const target = event('2222222222222222', 'Target')
  const other = event('3333333333333333', 'Other')
  const saved = addSaved(emptySavedBeenState(CITY_ID), { item: target, savedAt: 1 })
  const localMark = markBeen(saved.document, {
    item: target,
    status: 'went',
    statusAt: 2,
  })
  const withUnrelated = addSaved(saved.document, { item: other, savedAt: 3 })
  const replayed = reduceSavedBeenState(withUnrelated.document, localMark.canonical)

  assert.equal(replayed.code, 'marked-been')
  assert.equal(replayed.document.saved.length, 1)
  assert.equal(replayed.document.saved[0].ref.primary, 'e|3333333333333333')

  const removed = removeSaved(saved.document, {
    ref: saved.document.saved[0].ref,
    expectedToken: saved.document.saved[0].token,
  })
  const readded = addSaved(removed.document, { item: target, savedAt: 4 })
  const conflict = reduceSavedBeenState(readded.document, localMark.canonical)
  assert.equal(conflict.code, 'been-conflict')
  assert.equal(conflict.document.been.length, 0)
})

test('canonical archive commands bind both save and Been tokens during replay', () => {
  const target = event('2323232323232323', 'Archive replay target')
  const saved = addSaved(emptySavedBeenState(CITY_ID), { item: target, savedAt: 1 })
  const localArchive = archiveSaved(saved.document, {
    item: target,
    archivedAt: 2,
  })
  assert.equal(localArchive.canonical.expectedSaveToken, 1)
  assert.equal(localArchive.canonical.expectedBeenToken, null)

  const concurrentAnswer = markBeen(saved.document, {
    item: target,
    status: 'missed',
    statusAt: 3,
  })
  const conflicted = reduceSavedBeenState(
    concurrentAnswer.document,
    localArchive.canonical,
  )
  assert.equal(conflicted.code, 'been-conflict')
  assert.equal(conflicted.document.saved.length, 1)
  assert.equal(conflicted.document.been[0].status, 'missed')

  const archiveWithAnswer = archiveSaved(concurrentAnswer.document, {
    item: target,
    archivedAt: 4,
  })
  const removedAnswer = unmarkBeen(concurrentAnswer.document, {
    ref: concurrentAnswer.document.been[0].ref,
    expectedToken: concurrentAnswer.document.been[0].token,
  })
  const replacementAnswer = markBeen(removedAnswer.document, {
    item: target,
    status: 'missed',
    statusAt: 5,
  })
  const abaConflict = reduceSavedBeenState(
    replacementAnswer.document,
    archiveWithAnswer.canonical,
  )
  assert.equal(abaConflict.code, 'been-conflict')
  assert.equal(abaConflict.document.saved.length, 1)
})

test('same-city imports add only missing records and preserve current duplicates', () => {
  const shared = event('4444444444444444', 'Current title')
  const importedOnly = event('5555555555555555', 'Imported only')
  let base = addSaved(emptySavedBeenState(CITY_ID), { item: shared, savedAt: 10 }).document
  let incoming = addSaved(emptySavedBeenState(CITY_ID), {
    item: { ...shared, title: 'Imported title' },
    savedAt: 20,
  }).document
  incoming = addSaved(incoming, { item: importedOnly, savedAt: 21 }).document
  incoming = markBeen(incoming, {
    item: event('6666666666666666', 'Imported Been'),
    status: 'went',
    statusAt: 22,
  }).document

  const imported = importSavedBeen(base, { incoming })
  assert.equal(imported.code, 'imported')
  assert.equal(imported.document.saved.length, 2)
  assert.equal(imported.document.saved[0].snapshot.title, 'Current title')
  assert.equal(imported.document.saved[1].snapshot.title, 'Imported only')
  assert.equal(imported.document.been.length, 1)

  base = imported.document
  assert.equal(importSavedBeen(base, { incoming }).code, 'nothing-imported')
  assert.equal(importSavedBeen(base, {
    incoming: { ...incoming, cityId: OTHER_CITY_ID },
  }).code, 'import-city-mismatch')
  assert.equal(importSavedBeen(base, {
    incoming: { ...incoming, saved: {} },
  }).code, 'invalid-import')
})

test('imports reconcile went truth and reject partial cap or command-size overflow', () => {
  const target = event('6767676767676767', 'Import went target')
  const base = addSaved(emptySavedBeenState(CITY_ID), {
    item: target,
    savedAt: 1,
  }).document
  const incomingWent = markBeen(emptySavedBeenState(CITY_ID), {
    item: target,
    status: 'went',
    statusAt: 2,
  }).document
  const reconciled = importSavedBeen(base, { incoming: incomingWent })

  assert.equal(reconciled.code, 'imported')
  assert.equal(reconciled.document.saved.length, 0)
  assert.equal(reconciled.document.been[0].status, 'went')

  const redundantSaved = addSaved(emptySavedBeenState(CITY_ID), {
    item: target,
    savedAt: 9,
  }).document
  const beforeRedundantRev = reconciled.document.rev
  const redundant = importSavedBeen(reconciled.document, {
    incoming: redundantSaved,
  })
  assert.equal(redundant.code, 'nothing-imported')
  assert.equal(redundant.changed, false)
  assert.equal(redundant.document.rev, beforeRedundantRev)

  const fullSavedEvents = {}
  for (let index = 0; index < SAVED_BEEN_SAVE_CAP; index += 1) {
    fullSavedEvents[`e|${index.toString(16).padStart(16, '0')}`] = {
      savedAt: index,
      snapshot: { title: `Full ${index}` },
    }
  }
  const full = migrateV1SavedBeenState({
    savedEvents: fullSavedEvents,
    beenThere: [],
  }, { cityId: CITY_ID }).document
  const incomingExtra = addSaved(emptySavedBeenState(CITY_ID), {
    item: event('6868686868686868', 'Over cap import'),
    savedAt: 3,
  }).document
  const capped = importSavedBeen(full, { incoming: incomingExtra })
  assert.equal(capped.code, 'import-cap-exceeded')
  assert.equal(capped.document.saved.length, SAVED_BEEN_SAVE_CAP)

  const oversized = importSavedBeen(base, {
    incoming: {
      ...incomingWent,
      ignored: 'x'.repeat(SAVED_BEEN_IMPORT_MAX_BYTES),
    },
  })
  assert.equal(oversized.code, 'import-too-large')
  assert.equal(oversized.document.saved.length, 1)
  assert.ok(SAVED_BEEN_IMPORT_MAX_BYTES < SAVED_BEEN_COMMAND_MAX_BYTES)
  assert.ok(savedBeenStateBytes(reconciled.canonical) < SAVED_BEEN_COMMAND_MAX_BYTES)
})

test('Been import status merge is deterministic and current answers win conflicts', () => {
  const target = event('6969696969696969', 'Status merge target')
  const archived = archiveSaved(
    addSaved(emptySavedBeenState(CITY_ID), { item: target, savedAt: 1 }).document,
    { item: target, archivedAt: 2 },
  ).document
  const incomingMissed = markBeen(emptySavedBeenState(CITY_ID), {
    item: target,
    status: 'missed',
    statusAt: 3,
  }).document
  const merged = importSavedBeen(archived, { incoming: incomingMissed })
  assert.equal(merged.code, 'imported')
  assert.equal(merged.document.been[0].status, 'missed')

  const incomingWent = markBeen(emptySavedBeenState(CITY_ID), {
    item: target,
    status: 'went',
    statusAt: 4,
  }).document
  const conflict = importSavedBeen(merged.document, { incoming: incomingWent })
  assert.equal(conflict.code, 'nothing-imported')
  assert.equal(conflict.document.rev, merged.document.rev)
  assert.equal(conflict.document.been[0].status, 'missed')
})

test('migration enforces explicit caps and keeps the last duplicate position', () => {
  const savedEvents = {}
  for (let index = 0; index < SAVED_BEEN_SAVE_CAP; index += 1) {
    const id = index.toString(16).padStart(16, '0')
    savedEvents[`e|${id}`] = {
      savedAt: index,
      snapshot: { title: `Saved ${index}` },
    }
  }
  const beenThere = Array.from({ length: SAVED_BEEN_BEEN_CAP - 1 }, (_, index) => {
    const id = (index + 1000).toString(16).padStart(16, '0')
    return {
      key: `e|${id}`,
      snapshot: { title: `Been ${index}` },
      archivedAt: index,
    }
  })
  beenThere.push({
    key: `e|${(1000).toString(16).padStart(16, '0')}`,
    snapshot: { title: 'Newest duplicate' },
    archivedAt: 999,
    status: 'went',
    statusAt: 1000,
  })

  const migration = migrateV1SavedBeenState({
    savedEvents,
    beenThere,
  }, { cityId: CITY_ID })
  const { document } = migration

  assert.equal(document.saved.length, SAVED_BEEN_SAVE_CAP)
  assert.equal(document.saved[0].ref.status, 'attached')
  assert.equal(document.saved[0].ref.primary, 'e|0000000000000000')
  assert.equal(document.saved.at(-1).ref.primary, `e|${(SAVED_BEEN_SAVE_CAP - 1).toString(16).padStart(16, '0')}`)
  assert.equal(document.been.length, SAVED_BEEN_BEEN_CAP - 1)
  assert.equal(document.been.at(-1).ref.primary, `e|${(1000).toString(16).padStart(16, '0')}`)
  assert.equal(document.been.at(-1).snapshot.title, 'Newest duplicate')
  assert.equal(document.been.at(-1).status, 'went')
  assert.equal(migration.diagnostics.duplicates, 1)

  const overSaved = {
    ...savedEvents,
    'e|ffffffffffffffff': { savedAt: 999, snapshot: { title: 'Over cap' } },
  }
  assert.equal(migrateV1SavedBeenState({
    savedEvents: overSaved,
    beenThere,
  }, { cityId: CITY_ID }), null)
  assert.equal(migrateV1SavedBeenState({
    savedEvents,
    beenThere: [
      ...beenThere,
      { key: 'e|ffffffffffffffff', snapshot: { title: 'Over cap' } },
    ],
  }, { cityId: CITY_ID }), null)
})

test('aliases, candidates, snapshots, records, and strings are bounded without partial identities', () => {
  const aliases = [
    'e|7777777777777777',
    ...Array.from({ length: 100 }, (_, index) => `legacy|${index}`),
    `legacy|${'x'.repeat(SAVED_BEEN_STRING_MAX_BYTES + 1)}`,
  ]
  const item = {
    primary: 'e|7777777777777777',
    aliases,
    title: 'Bounded snapshot',
    description: 'z'.repeat(SAVED_BEEN_SNAPSHOT_MAX_BYTES * 2),
    tags: Array.from({ length: 1000 }, (_, index) => `tag-${index}`),
  }
  const added = addSaved(emptySavedBeenState(CITY_ID), { item, savedAt: 1 })

  assert.equal(added.code, 'saved')
  const record = added.document.saved[0]
  assert.ok(record.ref.aliases.length <= SAVED_BEEN_ALIAS_MAX_COUNT)
  assert.ok(savedBeenStateBytes(record.snapshot) <= SAVED_BEEN_SNAPSHOT_MAX_BYTES)
  assert.ok(savedBeenStateBytes(record) <= SAVED_BEEN_RECORD_MAX_BYTES)
  assert.equal(record.snapshot.description, undefined)

  const normalized = normalizeSavedBeenState({
    v: 2,
    cityId: CITY_ID,
    rev: 1,
    saved: [savedRecord({
      status: 'ambiguous',
      kind: 'event',
      legacyKey: SHARED,
      candidates: Array.from({ length: 100 }, (_, index) => `e|candidate-${index}`),
    }, 1)],
    been: [],
  }, { cityId: CITY_ID })
  assert.ok(normalized.saved[0].ref.candidates.length <= SAVED_BEEN_CANDIDATE_MAX_COUNT)

  assert.equal(addSaved(emptySavedBeenState(CITY_ID), {
    item: {
      primary: `e|${'x'.repeat(SAVED_BEEN_STRING_MAX_BYTES + 1)}`,
      aliases: [],
    },
    savedAt: 1,
  }).code, 'invalid-item')
})

test('V1 migration rejects malformed roots, cross-city requests, and oversized sources', () => {
  assert.equal(migrateV1SavedBeenState([], { cityId: CITY_ID }), null)
  assert.equal(migrateV1SavedBeenState({
    savedEvents: [],
    beenThere: [],
  }, { cityId: CITY_ID }), null)
  assert.equal(migrateV1SavedBeenState({
    savedEvents: {},
    beenThere: {},
  }, { cityId: CITY_ID }), null)
  assert.equal(migrateV1SavedBeenState({
    savedEvents: { bad: null },
    beenThere: [],
  }, { cityId: CITY_ID }), null)
  assert.equal(migrateV1SavedBeenState({
    savedEvents: {},
    beenThere: [null],
  }, { cityId: CITY_ID }), null)
  assert.equal(migrateV1SavedBeenState({
    savedEvents: {},
    beenThere: [{ key: GUIDE_KEY, snapshot: { kind: 'guide' } }],
  }, { cityId: CITY_ID }), null)
  assert.equal(migrateV1SavedBeenState({
    savedEvents: {},
    beenThere: [],
    huge: 'x'.repeat(SAVED_BEEN_DOCUMENT_MAX_BYTES * 2),
  }, { cityId: CITY_ID }), null)
  assert.throws(() => migrateV1SavedBeenState({
    savedEvents: {},
    beenThere: [],
  }, {
    cityId: CITY_ID,
    city: { id: OTHER_CITY_ID },
  }), TypeError)
})

test('strict capture evidence must match both exact parsed V1 sources', () => {
  const source = {
    savedEvents: {
      [REMOVED]: { savedAt: 1, snapshot: { title: 'Removed' } },
    },
    beenThere: [],
  }
  const evidence = {
    savedEvents: {
      key: 'saved-events-v1',
      status: 'ok',
      source: 'legacy',
      value: JSON.stringify(source.savedEvents),
    },
    beenThere: {
      key: 'been-there-v1',
      status: 'ok',
      source: 'legacy',
      value: '[]',
    },
  }
  assert.equal(migrateSavedBeenRaw(source, { cityId: CITY_ID }), null)
  assert.equal(migrateSavedBeenRaw(source, {
    cityId: CITY_ID,
    evidence: {
      savedEvents: {
        key: 'saved-events-v1',
        status: 'ok',
        source: 'legacy',
        rawBytes: JSON.stringify(source.savedEvents).length,
      },
      beenThere: evidence.beenThere,
    },
  }), null)
  assert.ok(migrateV1SavedBeenState(source, {
    cityId: CITY_ID,
    evidence,
  }))
  assert.equal(migrateV1SavedBeenState(source, {
    cityId: CITY_ID,
    evidence: {
      ...evidence,
      savedEvents: { ...evidence.savedEvents, key: 'wrong-key' },
    },
  }), null)
  assert.equal(migrateV1SavedBeenState(source, {
    cityId: CITY_ID,
    evidence: {
      ...evidence,
      savedEvents: { ...evidence.savedEvents, value: '{}' },
    },
  }), null)

  const tombstones = migrateV1SavedBeenState({
    savedEvents: {},
    beenThere: [],
  }, {
    cityId: CITY_ID,
    evidence: {
      savedEvents: {
        key: 'saved-events-v1',
        status: 'ok',
        source: 'destination',
        value: null,
      },
      beenThere: {
        key: 'been-there-v1',
        status: 'ok',
        source: 'destination',
        value: null,
      },
    },
  })
  assert.equal(tombstones.sourceSummary.savedEvents.tombstone, true)
  assert.equal(tombstones.document.saved.length, 0)
})

test('an already-valid V2 source is idempotent and token-free export records remain immutable', () => {
  const saved = addSaved(emptySavedBeenState(CITY_ID), {
    item: event('8888888888888888', 'V2 source'),
    savedAt: 1,
  }).document
  const migration = migrateV1SavedBeenState(saved, { cityId: CITY_ID })
  const exported = savedBeenRecordsWithoutTokens(saved)

  assert.equal(migration.status, 'existing-v2')
  assert.deepEqual(migration.document, saved)
  assert.deepEqual(exported.saved[0], {
    ref: saved.saved[0].ref,
    snapshot: saved.saved[0].snapshot,
    savedAt: 1,
  })
  assert.equal(Object.isFrozen(exported), true)
  assert.equal('token' in exported.saved[0], false)
})
