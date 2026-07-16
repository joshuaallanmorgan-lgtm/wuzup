import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTIVITY_EVENT_DECK_CAP,
  ACTIVITY_RECENTS_CAP,
  activityExclusionKeys,
  activityRefOf,
  clearActivityCollection,
  emptyActivityState,
  recordActivityRef,
} from '../app/src/activity-state-core.js'
import {
  activityClearCommand,
  activityRecordCommand,
  captureActivityV1Source,
  createActivityStore,
} from '../app/src/activity-store.js'
import { identityRefOf } from '../app/src/identity.js'

const CITY = Object.freeze({ id: 'tampa-bay', tz: 'America/New_York' })

function event(index) {
  return {
    kind: 'event',
    id: `event-${index}`,
    title: `Event ${index}`,
    start: `2026-08-${String((index % 20) + 1).padStart(2, '0')}T19:00:00-04:00`,
    url: `https://example.test/events/${index}`,
  }
}

function place(index) {
  return {
    kind: 'place',
    key: `p|place-${index}`,
    title: `Place ${index}`,
  }
}

function createMemoryStorage() {
  const values = new Map()
  const scope = {
    set(key, value) {
      values.set(key, value)
      return true
    },
    peekDurable(key) {
      return values.has(key)
        ? { status: 'ok', value: values.get(key), source: 'durable' }
        : { status: 'missing', value: null, source: null }
    },
  }
  return {
    values,
    factory: () => scope,
  }
}

function createLockManager() {
  return {
    request(_name, _options, callback) {
      return callback()
    },
  }
}

function createIds() {
  let count = 0
  return () => `test-id-${++count}`
}

function legacyKey(item) {
  const ref = identityRefOf(item)
  return ref.aliases.find((alias) => alias !== ref.primary) || ref.primary
}

test('pure activity commands keep recent-first and deck-tail contracts with alias reachability', () => {
  let document = emptyActivityState(CITY.id)
  for (let index = 0; index < ACTIVITY_RECENTS_CAP + 2; index += 1) {
    const ref = activityRefOf(event(index))
    const result = recordActivityRef(document, {
      cityId: CITY.id,
      collection: 'recents',
      ref,
    })
    assert.equal(result.changed, true)
    document = result.document
  }
  assert.equal(document.recents.length, ACTIVITY_RECENTS_CAP)
  assert.equal(document.recents[0].primary, activityRefOf(event(13)).primary)
  assert.equal(document.recents.at(-1).primary, activityRefOf(event(2)).primary)

  for (let index = 0; index < ACTIVITY_EVENT_DECK_CAP + 2; index += 1) {
    document = recordActivityRef(document, {
      cityId: CITY.id,
      collection: 'eventDeck',
      ref: activityRefOf(event(index)),
    }).document
  }
  assert.equal(document.eventDeck.length, ACTIVITY_EVENT_DECK_CAP)
  assert.equal(document.eventDeck[0].primary, activityRefOf(event(2)).primary)
  assert.equal(document.eventDeck.at(-1).primary, activityRefOf(event(31)).primary)

  const remembered = activityExclusionKeys(document, {
    cityId: CITY.id,
    collection: 'eventDeck',
  })
  const firstRetained = identityRefOf(event(2))
  assert.ok(remembered.includes(firstRetained.primary))
  assert.ok(firstRetained.aliases.every((alias) => remembered.includes(alias)))

  const repeated = recordActivityRef(document, {
    cityId: CITY.id,
    collection: 'eventDeck',
    ref: activityRefOf(event(31)),
  })
  assert.equal(repeated.changed, false)
  assert.equal(repeated.code, 'already-current')

  const cleared = clearActivityCollection(document, {
    cityId: CITY.id,
    collection: 'eventDeck',
  })
  assert.equal(cleared.changed, true)
  assert.deepEqual(cleared.document.eventDeck, [])
})

test('a new explicit view safely upgrades matching missing and ambiguous migration evidence', () => {
  const item = event(7)
  const attached = activityRefOf(item)
  const legacy = legacyKey(item)
  const missing = {
    ...emptyActivityState(CITY.id),
    recents: [{
      status: 'missing',
      kind: 'event',
      legacyKey: legacy,
    }],
  }
  const upgradedMissing = recordActivityRef(missing, {
    cityId: CITY.id,
    collection: 'recents',
    ref: attached,
  })
  assert.equal(upgradedMissing.changed, true)
  assert.equal(upgradedMissing.document.recents.length, 1)
  assert.equal(upgradedMissing.document.recents[0].status, 'attached')
  assert.ok(upgradedMissing.document.recents[0].aliases.includes(legacy))

  const ambiguous = {
    ...emptyActivityState(CITY.id),
    eventDeck: [{
      status: 'ambiguous',
      kind: 'event',
      legacyKey: 'e|shared',
      candidates: [attached.primary, activityRefOf(event(8)).primary],
    }],
  }
  const upgradedAmbiguous = recordActivityRef(ambiguous, {
    cityId: CITY.id,
    collection: 'eventDeck',
    ref: attached,
  })
  assert.equal(upgradedAmbiguous.changed, true)
  assert.equal(upgradedAmbiguous.document.eventDeck.length, 1)
  assert.equal(upgradedAmbiguous.document.eventDeck[0].primary, attached.primary)
  assert.ok(upgradedAmbiguous.document.eventDeck[0].aliases.includes('e|shared'))
  assert.deepEqual(activityExclusionKeys(missing, {
    cityId: CITY.id,
    collection: 'recents',
  }), [])

  const rotated = {
    ...emptyActivityState(CITY.id),
    recents: [{
      status: 'attached',
      kind: 'event',
      primary: 'e|old-primary',
      aliases: ['e|old-primary', 'e|new-primary'],
    }],
  }
  const upgradedPrimary = recordActivityRef(rotated, {
    cityId: CITY.id,
    collection: 'recents',
    ref: {
      status: 'attached',
      kind: 'event',
      primary: 'e|new-primary',
      aliases: ['e|new-primary', 'e|old-primary'],
    },
  })
  assert.equal(upgradedPrimary.document.recents.length, 1)
  assert.equal(upgradedPrimary.document.recents[0].primary, 'e|new-primary')

  const upgradedDeckPrimary = recordActivityRef({
    ...emptyActivityState(CITY.id),
    eventDeck: [{
      status: 'attached',
      kind: 'event',
      primary: 'e|deck-old',
      aliases: ['e|deck-old'],
    }],
  }, {
    cityId: CITY.id,
    collection: 'eventDeck',
    ref: {
      status: 'attached',
      kind: 'event',
      primary: 'e|deck-new',
      aliases: ['e|deck-new', 'e|deck-old'],
    },
  })
  assert.equal(upgradedDeckPrimary.document.eventDeck.length, 1)
  assert.equal(upgradedDeckPrimary.document.eventDeck[0].primary, 'e|deck-new')

  const weakOverlap = recordActivityRef({
    ...emptyActivityState(CITY.id),
    recents: [{
      status: 'attached',
      kind: 'event',
      primary: 'e|first',
      aliases: ['e|first', 'e|weak'],
    }],
  }, {
    cityId: CITY.id,
    collection: 'recents',
    ref: {
      status: 'attached',
      kind: 'event',
      primary: 'e|second',
      aliases: ['e|second', 'e|weak'],
    },
  })
  assert.equal(weakOverlap.document.recents.length, 2)

  const multipleDirectMatches = recordActivityRef({
    ...emptyActivityState(CITY.id),
    recents: [
      {
        status: 'attached',
        kind: 'event',
        primary: 'e|candidate-one',
        aliases: ['e|candidate-one', 'e|incoming'],
      },
      {
        status: 'attached',
        kind: 'event',
        primary: 'e|candidate-two',
        aliases: ['e|candidate-two', 'e|incoming'],
      },
    ],
  }, {
    cityId: CITY.id,
    collection: 'recents',
    ref: {
      status: 'attached',
      kind: 'event',
      primary: 'e|incoming',
      aliases: ['e|incoming'],
    },
  })
  assert.equal(multipleDirectMatches.document.recents.length, 3)
  assert.deepEqual(
    new Set(multipleDirectMatches.document.recents.map((ref) => ref.primary)),
    new Set(['e|candidate-one', 'e|candidate-two', 'e|incoming']),
  )
})

test('record commands are kind-safe and serialize only bounded identity evidence', () => {
  const eventCommand = activityRecordCommand('eventDeck', event(1))
  assert.equal(eventCommand.type, 'record')
  assert.equal(eventCommand.ref.status, 'attached')
  assert.equal('title' in eventCommand.ref, false)
  assert.equal(activityRecordCommand('eventDeck', place(1)), null)
  assert.equal(activityRecordCommand('placeDeck', event(1)), null)
  assert.equal(activityRecordCommand('placeDeck', place(1)).ref.kind, 'place')
  assert.deepEqual(activityClearCommand('recents'), {
    type: 'clear',
    collection: 'recents',
  })
  assert.equal(activityClearCommand('unknown'), null)
})

test('strict recents and deck capture merge source while context keeps compact provenance', () => {
  const calls = []
  const captured = captureActivityV1Source({
    city: CITY,
    capture({ domain }) {
      calls.push(domain)
      if (domain === 'recents') {
        return {
          source: { recents: ['e|one'] },
          evidence: {
            recents: {
              key: 'recents-v1',
              status: 'ok',
              source: 'city',
              value: '["e|one"]',
            },
          },
        }
      }
      if (domain === 'eventDeck') {
        return {
          source: { eventDeck: ['e|two'] },
          evidence: { eventDeck: {
            key: 'deck-last-v1',
            status: 'ok',
            source: 'legacy',
            value: '["e|two"]',
          } },
        }
      }
      return {
        source: { placeDeck: ['p|three'] },
        evidence: { placeDeck: {
            key: 'deck-last-places-v1',
            status: 'missing',
            source: null,
            value: null,
        } },
      }
    },
  })
  assert.deepEqual(calls, ['recents', 'eventDeck', 'placeDeck'])
  assert.deepEqual(captured.source, {
    recents: ['e|one'],
    eventDeck: ['e|two'],
    placeDeck: ['p|three'],
  })
  assert.equal(captured.context.evidence.recents.rawBytes, 9)
  assert.equal(captured.context.evidence.eventDeck.rawBytes, 9)
  assert.equal('value' in captured.context.evidence.recents, false)
})

test('recoverable capture corruption is isolated while storage failures remain fatal', () => {
  const captured = captureActivityV1Source({
    city: CITY,
    capture({ domain }) {
      if (domain === 'recents') {
        throw Object.assign(new Error('bad JSON'), {
          code: 'RETAINED_V1_CORRUPT_SOURCE',
        })
      }
      if (domain === 'eventDeck') {
        throw Object.assign(new Error('bad event deck'), {
          code: 'RETAINED_V1_CORRUPT_SOURCE',
        })
      }
      return { source: { placeDeck: ['p|valid'] }, evidence: {} }
    },
  })
  assert.deepEqual(captured.source, {
    recents: [],
    eventDeck: [],
    placeDeck: ['p|valid'],
  })
  assert.deepEqual(captured.context.captureErrors, [
    {
      domain: 'recents',
      code: 'RETAINED_V1_CORRUPT_SOURCE',
    },
    {
      domain: 'eventDeck',
      code: 'RETAINED_V1_CORRUPT_SOURCE',
    },
  ])

  const validEventDeck = captureActivityV1Source({
    city: CITY,
    capture({ domain }) {
      if (domain === 'recents') return { source: { recents: [] }, evidence: {} }
      if (domain === 'eventDeck') {
        return { source: { eventDeck: ['e|survives'] }, evidence: {} }
      }
      throw Object.assign(new Error('bad place deck'), {
        code: 'RETAINED_V1_INVALID_SOURCE',
      })
    },
  })
  assert.deepEqual(validEventDeck.source, {
    recents: [],
    eventDeck: ['e|survives'],
    placeDeck: [],
  })
  assert.deepEqual(validEventDeck.context.captureErrors, [{
    domain: 'placeDeck',
    code: 'RETAINED_V1_INVALID_SOURCE',
  }])

  assert.throws(() => captureActivityV1Source({
    city: CITY,
    capture() {
      throw Object.assign(new Error('unreadable'), {
        code: 'RETAINED_V1_STORAGE_READ',
      })
    },
  }), /unreadable/)
})

test('atomic activity store migrates once, publishes same-tab snapshots, and replays canonical commands', async () => {
  const storage = createMemoryStorage()
  const first = event(1)
  const second = event(2)
  const spot = place(1)
  const store = createActivityStore({
    city: CITY,
    storageFactory: storage.factory,
    lockManager: createLockManager(),
    eventTarget: null,
    createId: createIds(),
    contextId: 'activity-test',
    now: () => 1_800_000_000_000,
  })
  let emissions = 0
  store.subscribe(() => {
    emissions += 1
  })
  const initialized = await store.initialize({
    sourceFactory: () => ({
      source: {
        recents: [legacyKey(first)],
        eventDeck: [legacyKey(first)],
        placeDeck: [legacyKey(spot)],
      },
      context: {
        evidence: {
          recents: { key: 'recents-v1', status: 'ok', rawBytes: 12 },
        },
      },
    }),
    migrationContext: {
      events: [first, second],
      places: [spot],
      seeds: [],
    },
  })
  assert.equal(initialized.ok, true)
  assert.equal(initialized.persisted, true)
  assert.equal(store.getSnapshot().durability, 'durable')
  assert.equal(store.getSnapshot().document.recents[0].status, 'attached')
  assert.equal(
    store.getSnapshot().envelope.migration.diagnostics.evidence.recents.key,
    'recents-v1',
  )

  const recorded = await store.dispatch(activityRecordCommand('recents', second))
  assert.equal(recorded.ok, true)
  assert.equal(recorded.changed, true)
  assert.equal(recorded.persisted, true)
  assert.equal(
    store.getSnapshot().document.recents[0].primary,
    identityRefOf(second).primary,
  )
  const duplicate = await store.dispatch(activityRecordCommand('recents', second))
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.code, 'already-current')
  assert.ok(emissions >= 2)

  const cleared = await store.dispatch(activityClearCommand('eventDeck'))
  assert.equal(cleared.changed, true)
  assert.deepEqual(store.getSnapshot().document.eventDeck, [])
  store.destroy()
})

test('activity migration salvages cap overflow and records explicit truncation evidence', async () => {
  const storage = createMemoryStorage()
  const store = createActivityStore({
    city: CITY,
    storageFactory: storage.factory,
    lockManager: createLockManager(),
    eventTarget: null,
    createId: createIds(),
    contextId: 'activity-overflow',
  })
  const result = await store.initialize({
    source: {
      recents: Array.from({ length: ACTIVITY_RECENTS_CAP + 1 }, (_, index) => `e|${index}`),
      eventDeck: [],
      placeDeck: [],
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.persisted, true)
  assert.equal(store.getSnapshot().document.recents.length, ACTIVITY_RECENTS_CAP)
  assert.equal(
    store.getSnapshot().envelope.migration.status,
    'migrated-v1-activity-truncated',
  )
  assert.deepEqual(
    store.getSnapshot().envelope.migration.diagnostics.overflow,
    [{
      field: 'recents',
      sourceCount: ACTIVITY_RECENTS_CAP + 1,
      retainedCap: ACTIVITY_RECENTS_CAP,
    }],
  )
  assert.equal(storage.values.size, 1)
  store.destroy()
})

test('without Web Locks activity writes remain explicitly session-only', async () => {
  const storage = createMemoryStorage()
  const store = createActivityStore({
    city: CITY,
    storageFactory: storage.factory,
    lockManager: null,
    eventTarget: null,
    createId: createIds(),
    contextId: 'activity-no-lock',
  })
  const initialized = await store.initialize({
    source: {
      recents: [],
      eventDeck: [],
      placeDeck: [],
    },
  })
  assert.equal(initialized.code, 'initialized-session-only')
  assert.equal(initialized.persisted, false)
  assert.equal(initialized.durability, 'session-only')
  assert.equal(initialized.concurrency, 'session-only-no-lock')
  assert.equal(storage.values.size, 0)
  store.destroy()
})
