import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import {
  aliasesOf,
  assignLocalEventIds,
  createIdentityIndex,
  identityRefOf,
  legacyKeyOf,
  primaryKeyOf,
  resolveIdentity,
  sameIdentity,
} from '../app/src/identity.js'

const FIXTURE = JSON.parse(await readFile(
  join(import.meta.dirname, 'fixtures', 'identity', 'v1-compat.v1.json'),
  'utf8'
))

test('event identity keeps the frozen legacy key beside a valid stable primary', () => {
  const event = {
    id: 'f0d796c582367c85',
    title: 'Clean title',
    _keyTitle: 'ORIGINAL TITLE',
    start: '2026-07-20T19:00:00-04:00',
  }

  assert.equal(legacyKeyOf(event), 'ORIGINAL TITLE|2026-07-20T19:00:00-04:00')
  assert.equal(primaryKeyOf(event), 'e|f0d796c582367c85')
  assert.deepEqual(aliasesOf(event), [
    'e|f0d796c582367c85',
    'ORIGINAL TITLE|2026-07-20T19:00:00-04:00',
  ])
})

test('invalid event IDs fail closed to the byte-compatible legacy recipe', () => {
  for (const id of [null, '', 'ABCDEF0123456789', 'short', 'f0d796c582367c8g']) {
    const event = { id, title: 'Fallback', start: '2026-07-20' }
    assert.equal(primaryKeyOf(event), 'Fallback|2026-07-20')
    assert.doesNotMatch(primaryKeyOf(event), /^e\|/)
  }
})

test('malformed empty identities never become aliases or compare equal', () => {
  const malformed = { title: '', start: '' }
  const current = { id: 'aaaaaaaaaaaaaaaa', title: 'Current', start: '2026-07-20' }
  const index = createIdentityIndex({
    items: [current],
    records: [{ aliases: ['|', ''] }],
  })

  assert.deepEqual(aliasesOf(malformed), [])
  assert.equal(resolveIdentity('|', index).status, 'missing')
  assert.equal(sameIdentity(malformed, { title: '', start: '' }), false)
})

test('places keep their existing p key and retained aliases are ordered and deduped', () => {
  const place = {
    kind: 'place',
    key: 'p|golden-gate-park',
    identityAliases: ['p|golden-gate-park', 'place|old-slug'],
  }
  assert.equal(legacyKeyOf(place), 'p|golden-gate-park')
  assert.equal(primaryKeyOf(place), 'p|golden-gate-park')
  assert.deepEqual(aliasesOf(place), ['p|golden-gate-park', 'place|old-slug'])
})

test('custom events use a persisted local ID and otherwise stay on their usable legacy key', () => {
  const legacy = { source: 'Added by you', title: 'Porch show', start: '2026-07-21T20:00:00' }
  const durable = { ...legacy, localId: '018f9b9d-86f1-7c2f-a832-4b85b61917de' }

  assert.equal(primaryKeyOf(legacy), 'Porch show|2026-07-21T20:00:00')
  assert.equal(primaryKeyOf(durable), 'c|018f9b9d-86f1-7c2f-a832-4b85b61917de')
  assert.deepEqual(aliasesOf(durable), [
    'c|018f9b9d-86f1-7c2f-a832-4b85b61917de',
    'Porch show|2026-07-21T20:00:00',
    'wuzup:custom-bridge:v1:38:098d961675706479',
    'wuzup:custom-bridge:v1:30:57ab4af294806901',
  ])
})

test('local ID assignment is deterministic, collision-safe, and idempotent', () => {
  const rows = [
    { source: 'Added by you', title: 'One', start: '2026-07-20' },
    { source: 'Added by you', title: 'Two', start: '2026-07-21', localId: 'existing-local-id' },
    { source: 'Publisher', title: 'Sourced', start: '2026-07-21' },
  ]
  const ids = ['existing-local-id', 'new-local-id-1']
  const first = assignLocalEventIds(rows, { createId: () => ids.shift() })
  const second = assignLocalEventIds(first.items, { createId: () => { throw new Error('must not remint') } })

  assert.equal(first.changed, true)
  assert.equal(first.complete, true)
  assert.equal(first.items[0].localId, 'new-local-id-1')
  assert.equal(first.items[1].localId, 'existing-local-id')
  assert.equal(first.items[2].localId, undefined)
  assert.deepEqual(second, { items: first.items, changed: false, complete: true })
})

test('duplicate persisted custom IDs are repaired without changing the first owner', () => {
  const rows = [
    { source: 'Added by you', title: 'First', start: '2026-07-20', localId: 'duplicate-local-id' },
    { source: 'Added by you', title: 'Second', start: '2026-07-21', localId: 'duplicate-local-id' },
  ]
  const result = assignLocalEventIds(rows, { createId: () => 'replacement-local-id' })

  assert.equal(result.complete, true)
  assert.equal(result.changed, true)
  assert.equal(result.items[0].localId, 'duplicate-local-id')
  assert.equal(result.items[1].localId, 'replacement-local-id')
})

test('an unremintable duplicate custom ID falls back to a distinct legacy identity', () => {
  const rows = [
    { source: 'Added by you', title: 'First', start: '2026-07-20', localId: 'duplicate-local-id' },
    { source: 'Added by you', title: 'Second', start: '2026-07-21', localId: 'duplicate-local-id' },
  ]
  const result = assignLocalEventIds(rows, { createId: () => null })

  assert.equal(result.complete, false)
  assert.equal(result.changed, true)
  assert.equal(primaryKeyOf(result.items[0]), 'c|duplicate-local-id')
  assert.equal(result.items[1].localId, undefined)
  assert.equal(primaryKeyOf(result.items[1]), 'Second|2026-07-21')
})

test('real Tampa drift resolves through stable or legacy evidence without conflating new or removed rows', () => {
  const cases = FIXTURE.cases
  const current = [
    cases.stableSurvives.current,
    cases.legacySurvives.current,
    cases.bothSurvive.current,
    cases.newSf.current,
  ]
  const registry = [
    { aliases: aliasesOf(cases.stableSurvives.prior) },
    { aliases: aliasesOf(cases.legacySurvives.prior) },
    { aliases: aliasesOf(cases.bothSurvive.prior) },
    { aliases: aliasesOf(cases.removed.prior) },
  ]
  const index = createIdentityIndex({ items: current, records: registry })

  assert.equal(resolveIdentity(identityRefOf(cases.stableSurvives.prior), index).primary, 'e|4f083c10296600fa')
  assert.equal(resolveIdentity(identityRefOf(cases.legacySurvives.prior), index).primary, 'e|e742c347c9f31d72')
  assert.equal(resolveIdentity(identityRefOf(cases.bothSurvive.prior), index).primary, 'e|f0d796c582367c85')
  assert.equal(resolveIdentity(identityRefOf(cases.removed.prior), index).status, 'missing')
  assert.equal(resolveIdentity(identityRefOf(cases.newSf.current), index).primary, 'e|b86a5eb04847b0b4')
  assert.equal(resolveIdentity(legacyKeyOf(cases.removed.prior), index).status, 'missing')
})

test('duplicate weak aliases and conflicting stable/legacy evidence are ambiguous, never first-wins', () => {
  const shared = 'https://fixture.test/shared|2026-07-10T19:00:00-04:00'
  const a = {
    id: 'aaaaaaaaaaaaaaaa',
    title: 'A current',
    url: 'https://fixture.test/a',
    start: '2026-07-10T19:00:00-04:00',
  }
  const b = {
    id: 'bbbbbbbbbbbbbbbb',
    title: 'B current',
    url: 'https://fixture.test/shared',
    start: '2026-07-10T19:00:00-04:00',
  }
  const index = createIdentityIndex({
    items: [a, b],
    records: [{ aliases: ['e|aaaaaaaaaaaaaaaa', shared] }],
  })

  assert.deepEqual(resolveIdentity('e|aaaaaaaaaaaaaaaa', index), {
    status: 'resolved',
    primary: 'e|aaaaaaaaaaaaaaaa',
    item: a,
    matchedBy: 'primary',
  })
  const weak = resolveIdentity(shared, index)
  assert.equal(weak.status, 'ambiguous')
  assert.deepEqual(weak.candidates, ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'])

  const conflictingRef = resolveIdentity({
    primary: 'e|aaaaaaaaaaaaaaaa',
    aliases: ['e|aaaaaaaaaaaaaaaa', shared],
  }, index)
  assert.equal(conflictingRef.status, 'ambiguous')
  assert.equal(sameIdentity(a, b, index), false)
})

test('current artifact IDs produce unique stable primary keys', async () => {
  for (const city of ['tampa-bay', 'sf-east-bay']) {
    const events = JSON.parse(await readFile(join(import.meta.dirname, '..', 'finder', 'output', city, 'events.json'), 'utf8'))
    const keys = events.map(primaryKeyOf)
    assert.equal(new Set(keys).size, events.length, `${city} stable identities must be unique`)
    assert.ok(keys.every((key) => /^e\|[0-9a-f]{16}$/.test(key)))
  }
})
