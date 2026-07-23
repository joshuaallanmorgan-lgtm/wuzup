import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  IDENTITY_SEED_VERSION,
  identitySeedsForCity,
} from '../app/src/identity-seeds.js'
import { migrateV1IdentityState } from '../app/src/identity-migration.js'

const artifact = async (cityId) => JSON.parse(await readFile(
  new URL(`../finder/output/${cityId}/events.json`, import.meta.url),
  'utf8'
))

const legacyKeyOf = (event) => (event.url || event.title || '') + '|' + (event.start || '')

const canonicalPayload = () => ({
  version: IDENTITY_SEED_VERSION,
  cities: {
    'sf-east-bay': identitySeedsForCity('sf-east-bay').map((seed) => [seed.aliases[1], seed.primary]),
    'tampa-bay': identitySeedsForCity('tampa-bay').map((seed) => [seed.aliases[1], seed.primary]),
  },
})

test('historical identity seeds pin the audited count, uniqueness, order, and canonical hash', () => {
  const tampa = identitySeedsForCity('tampa-bay')
  const sf = identitySeedsForCity('sf-east-bay')

  assert.equal(IDENTITY_SEED_VERSION, 1)
  assert.equal(tampa.length, 25)
  assert.equal(sf.length, 0)
  assert.equal(new Set(tampa.map((seed) => seed.primary)).size, tampa.length)
  assert.equal(new Set(tampa.map((seed) => seed.aliases[1])).size, tampa.length)
  assert.deepEqual(
    tampa.map((seed) => seed.aliases[1]),
    tampa.map((seed) => seed.aliases[1]).toSorted(),
    'historical aliases must remain bytewise sorted'
  )

  const canonical = JSON.stringify(canonicalPayload()) + '\n'
  assert.equal(Buffer.byteLength(canonical), 3036)
  assert.equal(
    createHash('sha256').update(canonical).digest('hex'),
    '15a205356736c7e196ee333b307637dd70bb46748df8d13816f56beed4d342c3'
  )
})

test('Gulfport V1 identity maps to its stable event primary', () => {
  const old = 'https://www.visitstpeteclearwater.com/event/gulfport-tuesday-fresh-market/1596|2026-07-07'
  const seed = identitySeedsForCity('tampa-bay').find((row) => row.aliases.includes(old))

  assert.deepEqual(seed, {
    kind: 'event',
    primary: 'e|4f083c10296600fa',
    aliases: ['e|4f083c10296600fa', old],
  })
})

test('city seeds are directly consumable by the pure V1 identity migrator', async () => {
  const old = 'https://www.visitstpeteclearwater.com/event/gulfport-tuesday-fresh-market/1596|2026-07-07'
  const migrated = migrateV1IdentityState(
    { recents: [old] },
    {
      catalog: await artifact('tampa-bay'),
      seeds: identitySeedsForCity('tampa-bay'),
    }
  )

  assert.equal(migrated.recents[0].status, 'attached')
  assert.equal(migrated.recents[0].primary, 'e|4f083c10296600fa')
  assert.ok(migrated.recents[0].aliases.includes(old))
})

test('seed lookup is city-isolated and returns copy-safe identity refs', () => {
  const first = identitySeedsForCity('tampa-bay')
  first[0].aliases.push('mutated')
  first.push({ kind: 'event', primary: 'e|bad', aliases: [] })

  const second = identitySeedsForCity('tampa-bay')
  assert.equal(second.length, 25)
  assert.equal(second[0].aliases.includes('mutated'), false)
  assert.deepEqual(identitySeedsForCity('sf-east-bay'), [])
  assert.deepEqual(identitySeedsForCity('not-a-city'), [])
  assert.deepEqual(identitySeedsForCity(null), [])
})

test('every historical seed targets exactly one current primary and differs from its current legacy key', async () => {
  for (const cityId of ['tampa-bay', 'sf-east-bay']) {
    const events = await artifact(cityId)
    const byPrimary = new Map()
    for (const event of events) {
      const primary = `e|${event.id}`
      if (!byPrimary.has(primary)) byPrimary.set(primary, [])
      byPrimary.get(primary).push(event)
    }

    for (const seed of identitySeedsForCity(cityId)) {
      assert.equal(seed.kind, 'event')
      assert.deepEqual(seed.aliases, [seed.primary, seed.aliases[1]])
      const matches = byPrimary.get(seed.primary) || []
      assert.equal(matches.length, 1, `${seed.primary} must identify one current ${cityId} event`)
      assert.notEqual(
        seed.aliases[1],
        legacyKeyOf(matches[0]),
        `${seed.primary} needs no historical seed when its V1 legacy key is still current`
      )
    }
  }
})
