import assert from 'node:assert/strict'
import test from 'node:test'

import { migrateV1IdentityState } from '../app/src/identity-migration.js'

const GULFPORT_URL = 'https://www.visitstpeteclearwater.com/event/gulfport-tuesday-fresh-market/1596'
const GULFPORT_OLD = `${GULFPORT_URL}|2026-07-07`
const GULFPORT_CURRENT = `${GULFPORT_URL}|2026-07-07T09:00:00-04:00`
const TRAIN_URL = 'https://www.visittampabay.com/tampa-events/details/train/99194/'
const TRAIN = `${TRAIN_URL}|2026-07-10T18:45:00-04:00`
const REMOVED_URL = 'https://www.eventbrite.com/e/ke-friends-just-be-doin-shxt-tickets-1992070100295'
const REMOVED = `${REMOVED_URL}|2026-07-02`
const AMBIGUOUS = 'https://fixture.test/shared|2026-07-10T19:00:00-04:00'

const catalog = [
  {
    id: '4f083c10296600fa',
    title: 'Gulfport Tuesday Fresh Market',
    url: GULFPORT_URL,
    start: '2026-07-07T09:00:00-04:00',
  },
  {
    id: 'e742c347c9f31d72',
    title: 'Train, Barenaked Ladies & Matt Nathanson',
    url: TRAIN_URL,
    start: '2026-07-10T18:45:00-04:00',
  },
  {
    id: 'aaaaaaaaaaaaaaaa',
    title: 'Shared listing A',
    url: 'https://fixture.test/shared',
    start: '2026-07-10T19:00:00-04:00',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    title: 'Shared listing B',
    url: 'https://fixture.test/shared',
    start: '2026-07-10T19:00:00-04:00',
  },
]

const seeds = [
  {
    kind: 'event',
    primary: 'e|4f083c10296600fa',
    aliases: ['e|4f083c10296600fa', GULFPORT_OLD, GULFPORT_CURRENT],
  },
]

function v1State() {
  return {
    savedEvents: {
      [GULFPORT_OLD]: {
        savedAt: 101,
        snapshot: {
          title: 'Gulfport Tuesday Fresh Market',
          start: '2026-07-07',
          url: GULFPORT_URL,
          category: 'food',
        },
      },
      [REMOVED]: {
        savedAt: 102,
        snapshot: {
          title: 'KE & Friends Just Be Doin Shxt',
          start: '2026-07-02',
          url: REMOVED_URL,
          category: 'music',
        },
      },
    },
    beenThere: [
      {
        key: TRAIN,
        snapshot: { title: 'Train', start: '2026-07-10T18:45:00-04:00', url: TRAIN_URL },
        archivedAt: 201,
        status: 'went',
        statusAt: 202,
      },
      {
        key: AMBIGUOUS,
        snapshot: { title: 'Shared listing', start: '2026-07-10T19:00:00-04:00' },
        archivedAt: 203,
        status: 'missed',
        statusAt: 204,
      },
    ],
    recents: [TRAIN, GULFPORT_OLD, REMOVED],
    deck: [REMOVED, TRAIN],
    dayPlans: {
      1784001600000: {
        state: null,
        slots: { morning: GULFPORT_OLD, afternoon: AMBIGUOUS, night: null },
        done: false,
      },
    },
    dayHistory: [
      {
        dayTs: 1783915200000,
        state: null,
        slots: { morning: null, afternoon: TRAIN, night: REMOVED },
        done: true,
        note: 'keep this history metadata',
      },
    ],
  }
}

const assertAttached = (ref, primary, legacyKey) => {
  assert.equal(ref.status, 'attached')
  assert.equal(ref.primary, primary)
  assert.ok(ref.aliases.includes(primary))
  assert.ok(ref.aliases.includes(legacyKey))
}

test('migrates every V1 identity store without losing rows, order, payloads, or unresolved references', () => {
  const input = v1State()
  const before = structuredClone(input)
  const result = migrateV1IdentityState(input, { catalog, seeds })

  assert.equal(result.v, 2)
  assert.equal(result.savedEvents.length, 2)
  assert.equal(result.beenThere.length, 2)
  assert.equal(result.recents.length, 3)
  assert.equal(result.deck.length, 2)
  assert.equal(Object.keys(result.dayPlans).length, 1)
  assert.equal(result.dayHistory.length, 1)

  assertAttached(result.savedEvents[0].identity, 'e|4f083c10296600fa', GULFPORT_OLD)
  assert.deepEqual(result.savedEvents[0].identity.aliases, [
    'e|4f083c10296600fa',
    GULFPORT_OLD,
    GULFPORT_CURRENT,
  ])
  assert.equal(result.savedEvents[0].savedAt, 101)
  assert.strictEqual(result.savedEvents[0].snapshot, input.savedEvents[GULFPORT_OLD].snapshot)

  assert.deepEqual(result.savedEvents[1].identity, {
    status: 'missing',
    legacyKey: REMOVED,
  })
  assert.equal('primary' in result.savedEvents[1].identity, false)
  assert.strictEqual(result.savedEvents[1].snapshot, input.savedEvents[REMOVED].snapshot)

  assertAttached(result.beenThere[0].identity, 'e|e742c347c9f31d72', TRAIN)
  assert.equal('key' in result.beenThere[0], false)
  assert.equal(result.beenThere[0].status, 'went')
  assert.equal(result.beenThere[0].statusAt, 202)
  assert.strictEqual(result.beenThere[0].snapshot, input.beenThere[0].snapshot)

  assert.deepEqual(result.beenThere[1].identity, {
    status: 'ambiguous',
    legacyKey: AMBIGUOUS,
    candidates: ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'],
  })
  assert.equal('primary' in result.beenThere[1].identity, false)
  assert.equal(result.beenThere[1].status, 'missed')

  assertAttached(result.recents[0], 'e|e742c347c9f31d72', TRAIN)
  assertAttached(result.recents[1], 'e|4f083c10296600fa', GULFPORT_OLD)
  assert.equal(result.recents[2].status, 'missing')
  assert.equal(result.deck[0].legacyKey, REMOVED)
  assertAttached(result.deck[1], 'e|e742c347c9f31d72', TRAIN)

  const active = result.dayPlans['1784001600000']
  assertAttached(active.slots.morning, 'e|4f083c10296600fa', GULFPORT_OLD)
  assert.equal(active.slots.afternoon.status, 'ambiguous')
  assert.equal(active.slots.night, null)
  assert.equal(active.done, false)

  const history = result.dayHistory[0]
  assert.equal(history.dayTs, 1783915200000)
  assert.equal(history.note, 'keep this history metadata')
  assert.equal(history.slots.morning, null)
  assertAttached(history.slots.afternoon, 'e|e742c347c9f31d72', TRAIN)
  assert.equal(history.slots.night.status, 'missing')

  assert.deepEqual(result.diagnostics, {
    total: 13,
    attached: 7,
    missing: 4,
    ambiguous: 2,
    byStore: {
      savedEvents: { total: 2, attached: 1, missing: 1, ambiguous: 0 },
      beenThere: { total: 2, attached: 1, missing: 0, ambiguous: 1 },
      recents: { total: 3, attached: 2, missing: 1, ambiguous: 0 },
      deck: { total: 2, attached: 1, missing: 1, ambiguous: 0 },
      dayPlans: { total: 2, attached: 1, missing: 0, ambiguous: 1 },
      dayHistory: { total: 2, attached: 1, missing: 1, ambiguous: 0 },
    },
    unresolved: [
      { store: 'savedEvents', path: [REMOVED], legacyKey: REMOVED, status: 'missing' },
      {
        store: 'beenThere',
        path: [1],
        legacyKey: AMBIGUOUS,
        status: 'ambiguous',
        candidates: ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'],
      },
      { store: 'recents', path: [2], legacyKey: REMOVED, status: 'missing' },
      { store: 'deck', path: [0], legacyKey: REMOVED, status: 'missing' },
      {
        store: 'dayPlans',
        path: ['1784001600000', 'slots', 'afternoon'],
        legacyKey: AMBIGUOUS,
        status: 'ambiguous',
        candidates: ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'],
      },
      {
        store: 'dayHistory',
        path: [0, 'slots', 'night'],
        legacyKey: REMOVED,
        status: 'missing',
      },
    ],
  })

  assert.deepEqual(input, before, 'pure migration must not mutate V1 state')
})

test('the pure migration is deterministic and an already migrated destination is idempotent', () => {
  const first = migrateV1IdentityState(v1State(), { catalog, seeds })
  const sameInputAgain = migrateV1IdentityState(v1State(), {
    catalog: structuredClone(catalog),
    seeds: structuredClone(seeds),
  })
  const secondPass = migrateV1IdentityState(first, { catalog: [], seeds: [] })

  assert.deepEqual(sameInputAgain, first)
  assert.strictEqual(secondPass, first)
})

test('a historical seed is alias evidence only and cannot invent a live candidate', () => {
  const legacyKey = 'https://fixture.test/removed|2026-07-01'
  const result = migrateV1IdentityState({ recents: [legacyKey] }, {
    catalog: [],
    seeds: [{
      primary: 'e|abababababababab',
      aliases: ['e|abababababababab', legacyKey],
    }],
  })

  assert.deepEqual(result.recents, [{ status: 'missing', legacyKey }])
  assert.equal(result.diagnostics.attached, 0)
  assert.equal(result.diagnostics.missing, 1)
})
