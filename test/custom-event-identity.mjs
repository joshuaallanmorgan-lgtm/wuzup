import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { primaryKeyOf } from '../app/src/identity.js'
import { loadMyEvents, saveMyEvents } from '../app/src/lib.js'
import { createStorageScope, physicalKey } from '../app/src/storage.js'

class MemoryStorage {
  constructor() {
    this.map = new Map()
    this.failKeys = new Set()
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null
  }

  setItem(key, value) {
    const k = String(key)
    if (this.failKeys.has(k)) throw new Error('quota')
    this.map.set(k, String(value))
  }
}

test('custom-event IDs persist before they become primary identities', () => {
  const previous = globalThis.localStorage
  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: 'tampa-bay' })
  const key = physicalKey('my-events-v1', { cityId: 'tampa-bay' })
  const legacy = { source: 'Added by you', title: 'Porch show', start: '2026-07-21T20:00:00' }
  scope.set('my-events-v1', JSON.stringify([legacy]))
  globalThis.localStorage = backend

  try {
    const migrated = loadMyEvents()
    assert.equal(migrated.length, 1)
    assert.match(migrated[0].localId, /^[a-z0-9][a-z0-9_-]{7,63}$/i)
    assert.match(primaryKeyOf(migrated[0]), /^c\|/)

    const landed = scope.readJson('my-events-v1', { fallback: [] })
    assert.equal(landed.status, 'ok')
    assert.equal(landed.value[0].localId, migrated[0].localId)
    const bytes = backend.getItem(key)
    assert.deepEqual(loadMyEvents(), migrated)
    assert.equal(backend.getItem(key), bytes, 'repeat load is byte-idempotent')

    const added = saveMyEvents(migrated.concat({
      source: 'Added by you',
      title: 'Second plan',
      start: '2026-07-22',
    }))
    assert.equal(added.persisted, true)
    assert.equal(added.complete, true)
    assert.equal(added.items.length, 2)
    assert.match(primaryKeyOf(added.items[1]), /^c\|/)
  } finally {
    globalThis.localStorage = previous
  }
})

test('a browser without an ID generator still durably keeps usable legacy rows', () => {
  const previous = globalThis.localStorage
  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: 'tampa-bay' })
  const legacy = { source: 'Added by you', title: 'Legacy-only plan', start: '2026-07-22' }
  globalThis.localStorage = backend

  try {
    const write = saveMyEvents([legacy], { createId: () => null })
    assert.deepEqual(write, { items: [legacy], persisted: true, complete: false })
    assert.deepEqual(scope.readJson('my-events-v1', { fallback: [] }).value, [legacy])
  } finally {
    globalThis.localStorage = previous
  }
})

test('a blocked custom-ID migration keeps the legacy identity and source bytes retryable', () => {
  const previous = globalThis.localStorage
  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: 'tampa-bay' })
  const key = physicalKey('my-events-v1', { cityId: 'tampa-bay' })
  const legacy = { source: 'Added by you', title: 'Quota plan', start: '2026-07-23' }
  scope.set('my-events-v1', JSON.stringify([legacy]))
  const sourceBytes = backend.getItem(key)
  backend.failKeys.add(key)
  globalThis.localStorage = backend

  try {
    const rows = loadMyEvents()
    assert.deepEqual(rows, [legacy])
    assert.equal(primaryKeyOf(rows[0]), 'Quota plan|2026-07-23')
    assert.equal(backend.getItem(key), sourceBytes, 'failed migration cannot overwrite durable source bytes')
    assert.deepEqual(loadMyEvents(), [legacy], 'session fallback also stays on the retryable legacy identity')

    const write = saveMyEvents([legacy])
    assert.deepEqual(write.items, [legacy])
    assert.equal(write.persisted, false)
    assert.equal(write.complete, false, 'an ID is incomplete until it is durable across reload')
    backend.failKeys.delete(key)
    assert.equal(saveMyEvents([legacy]).persisted, true, 'test cleanup clears the module session fallback')
  } finally {
    globalThis.localStorage = previous
  }
})

test('quota failure after duplicate-ID repair keeps the session fallback collision-free', () => {
  const previous = globalThis.localStorage
  const backend = new MemoryStorage()
  const scope = createStorageScope({ backend, cityId: 'tampa-bay' })
  const key = physicalKey('my-events-v1', { cityId: 'tampa-bay' })
  const rows = [
    { source: 'Added by you', title: 'First duplicate', start: '2026-07-24', localId: 'duplicate-local-id' },
    { source: 'Added by you', title: 'Second duplicate', start: '2026-07-25', localId: 'duplicate-local-id' },
  ]
  scope.set('my-events-v1', JSON.stringify(rows))
  const sourceBytes = backend.getItem(key)
  backend.failKeys.add(key)
  globalThis.localStorage = backend

  try {
    const loaded = loadMyEvents()
    assert.deepEqual(loaded.map(primaryKeyOf), [
      'c|duplicate-local-id',
      'Second duplicate|2026-07-25',
    ])
    assert.equal(backend.getItem(key), sourceBytes, 'durable colliding source remains retryable')

    const write = saveMyEvents(rows, { createId: () => 'replacement-local-id' })
    assert.equal(write.persisted, false)
    assert.equal(write.complete, false)
    assert.deepEqual(write.items.map(primaryKeyOf), [
      'c|duplicate-local-id',
      'Second duplicate|2026-07-25',
    ])
    backend.failKeys.delete(key)
    assert.equal(saveMyEvents(rows).persisted, true, 'test cleanup clears the module session fallback')
  } finally {
    globalThis.localStorage = previous
  }
})

test('the add flow uses the canonical write result instead of a pre-ID React copy', async () => {
  const [app, form] = await Promise.all([
    readFile(new URL('../app/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/AddEvent.jsx', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(app, /useEffect\(\(\) => \{\s*saveMyEvents\(myEvents\)/)
  assert.match(app, /const write = saveMyEvents\(\[\.\.\.fresh, candidate\]\)/)
  assert.match(app, /if \(duplicate\) \{\s*const write = saveMyEvents\(fresh\)/)
  assert.match(app, /setMyEvents\(write\.items\)/)
  assert.match(app, /item: write\.items\.at\(-1\)/)
  assert.match(form, /added\?\.code === 'added' && added\.persisted === true && added\.item/)
  assert.match(form, /autoSlot\(added\.item\)/)
  assert.match(form, /browser couldn't save it/)
})
