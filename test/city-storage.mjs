import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  LEGACY_FALLBACK_CITY_ID,
  LEGACY_OWNER_KEY,
  PREFIX,
  createStorageScope,
  physicalKey,
} from '../app/src/storage.js'
import { loadMyEvents } from '../app/src/lib.js'
import { resetTaste } from '../app/src/taste.js'

const ROOT = join(import.meta.dirname, '..')

class MemoryStorage {
  constructor(entries = []) {
    this.map = new Map(entries)
    this.failKeys = new Set()
    this.beforeSet = null
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null
  }

  setItem(key, value) {
    const k = String(key)
    if (this.failKeys.has(k)) throw new Error('quota')
    this.beforeSet?.(k, String(value))
    this.map.set(k, String(value))
  }

  removeItem(key) {
    this.map.delete(String(key))
  }
}

test('physical keys are versioned and city scoped by default', () => {
  assert.equal(LEGACY_FALLBACK_CITY_ID, 'tampa-bay')
  assert.equal(physicalKey('taste-v1', { cityId: 'tampa-bay' }), 'twh:v2:c:tampa-bay:taste-v1')
  assert.equal(physicalKey('taste-v1', { cityId: 'sf-east-bay' }), 'twh:v2:c:sf-east-bay:taste-v1')
  assert.equal(physicalKey('profile-name-v1', { scope: 'global' }), 'twh:v2:g:profile-name-v1')
  assert.equal(PREFIX, 'twh:v2:c:tampa-bay:')
  assert.throws(() => physicalKey('../taste', { cityId: 'tampa-bay' }), /invalid storage key/i)
})

test('literal tombstone and envelope-like strings round-trip as user data', () => {
  const backend = new MemoryStorage()
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  const key = physicalKey('profile-name-v1', { scope: 'global' })

  for (const value of ['__wuzup_v2_deleted__', '__wuzup_v2_value__:"Ada"']) {
    assert.equal(tampa.setGlobal('profile-name-v1', value), true)
    assert.equal(tampa.getGlobal('profile-name-v1'), value)
    assert.notEqual(backend.getItem(key), value, 'V2 user values are stored in an unambiguous envelope')
  }
})

test('the legacy fallback city owns V1 state without copying it into every city', () => {
  const legacyTaste = '{"v":1,"n":4}'
  const backend = new MemoryStorage([
    ['twh:taste-v1', legacyTaste],
    ['twh:profile-name-v1', 'Ada'],
  ])
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  const sf = createStorageScope({ backend, cityId: 'sf-east-bay' })

  assert.equal(tampa.get('taste-v1'), legacyTaste)
  assert.notEqual(backend.getItem(physicalKey('taste-v1', { cityId: 'tampa-bay' })), legacyTaste)
  assert.equal(createStorageScope({ backend, cityId: 'tampa-bay' }).get('taste-v1'), legacyTaste)
  assert.equal(backend.getItem('twh:taste-v1'), legacyTaste, 'rollback bytes stay untouched')
  assert.equal(sf.get('taste-v1'), null, 'another city never inherits the claimed legacy bundle')

  assert.equal(tampa.getGlobal('profile-name-v1'), 'Ada')
  assert.equal(sf.getGlobal('profile-name-v1'), 'Ada')
  assert.equal(backend.getItem('twh:profile-name-v1'), 'Ada', 'global migration is copy-only too')

  assert.equal(tampa.set('saved-events-v1', 'tampa'), true)
  assert.equal(sf.set('saved-events-v1', 'sf'), true)
  assert.equal(tampa.get('saved-events-v1'), 'tampa')
  assert.equal(sf.get('saved-events-v1'), 'sf')

  assert.equal(tampa.remove('taste-v1'), true)
  assert.equal(tampa.get('taste-v1'), null, 'a V2 delete must not resurrect rollback bytes')
  assert.equal(createStorageScope({ backend, cityId: 'tampa-bay' }).get('taste-v1'), null)
  assert.equal(backend.getItem('twh:taste-v1'), legacyTaste, 'rollback still sees the untouched V1 value')
})

test('simultaneous Tampa and SF migration cannot expose one legacy value to both cities', () => {
  const legacyTaste = '{"v":1,"n":4}'
  const backend = new MemoryStorage([['twh:taste-v1', legacyTaste]])
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  const sf = createStorageScope({ backend, cityId: 'sf-east-bay' })
  let interleaved = false

  backend.beforeSet = (key) => {
    if (key !== LEGACY_OWNER_KEY || interleaved) return
    interleaved = true
    assert.equal(sf.get('taste-v1'), null, 'SF must fail closed during owner initialization')
  }

  assert.equal(tampa.get('taste-v1'), legacyTaste)
  assert.equal(interleaved, true, 'the regression must exercise a re-entrant first-load race')
  assert.equal(sf.get('taste-v1'), null)
  assert.equal(backend.getItem(physicalKey('taste-v1', { cityId: 'sf-east-bay' })), null)
  assert.equal(JSON.parse(backend.getItem(LEGACY_OWNER_KEY)).ownerCityId, LEGACY_FALLBACK_CITY_ID)
  assert.equal(backend.getItem('twh:taste-v1'), legacyTaste)
})

test('a valid existing SF owner receipt remains authoritative', () => {
  const legacyTaste = '{"v":1,"n":4}'
  const backend = new MemoryStorage([
    ['twh:taste-v1', legacyTaste],
    [LEGACY_OWNER_KEY, JSON.stringify({ v: 1, ownerCityId: 'sf-east-bay' })],
  ])
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  const sf = createStorageScope({ backend, cityId: 'sf-east-bay' })

  assert.equal(tampa.get('taste-v1'), null)
  assert.equal(sf.get('taste-v1'), legacyTaste)
})

test('corrupt and unknown legacy-owner receipts repair to the deterministic fallback', () => {
  for (const badReceipt of [
    '{',
    '{"v":99,"ownerCityId":"sf-east-bay"}',
    '{"v":1,"ownerCityId":"unknown-city"}',
  ]) {
    const legacyTaste = '{"v":1,"n":4}'
    const backend = new MemoryStorage([
      ['twh:taste-v1', legacyTaste],
      [LEGACY_OWNER_KEY, badReceipt],
    ])
    const sf = createStorageScope({ backend, cityId: 'sf-east-bay' })
    const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })

    assert.equal(sf.get('taste-v1'), null)
    assert.equal(tampa.get('taste-v1'), legacyTaste)
    assert.equal(JSON.parse(backend.getItem(LEGACY_OWNER_KEY)).ownerCityId, LEGACY_FALLBACK_CITY_ID)
    assert.equal(backend.getItem('twh:taste-v1'), legacyTaste)
  }
})

test('legacy migration is idempotent, destination-first, and quota retryable', () => {
  const backend = new MemoryStorage([
    ['twh:recents-v1', '["legacy"]'],
    [physicalKey('recents-v1', { cityId: 'tampa-bay' }), '["current"]'],
  ])
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  assert.equal(tampa.get('recents-v1'), '["current"]', 'an existing V2 destination wins')
  const before = JSON.stringify([...backend.map])
  assert.equal(tampa.get('recents-v1'), '["current"]')
  assert.equal(JSON.stringify([...backend.map]), before)

  backend.setItem('twh:day-plans-v1', '{"1":{"v":1}}')
  const destination = physicalKey('day-plans-v1', { cityId: 'tampa-bay' })
  backend.failKeys.add(destination)
  assert.equal(tampa.get('day-plans-v1'), '{"1":{"v":1}}', 'the owner can dual-read after a copy failure')
  assert.equal(backend.getItem(destination), null)
  assert.equal(JSON.parse(backend.getItem(LEGACY_OWNER_KEY)).ownerCityId, 'tampa-bay')
  backend.failKeys.delete(destination)
  assert.equal(tampa.get('day-plans-v1'), '{"1":{"v":1}}')
  assert.notEqual(backend.getItem(destination), '{"1":{"v":1}}')
  assert.equal(createStorageScope({ backend, cityId: 'tampa-bay' }).get('day-plans-v1'), '{"1":{"v":1}}')
})

test('an unpersisted legacy claim fails closed and quota writes remain session-readable', () => {
  const backend = new MemoryStorage([['twh:taste-v1', '{"v":1}']])
  backend.failKeys.add(LEGACY_OWNER_KEY)
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  const sf = createStorageScope({ backend, cityId: 'sf-east-bay' })
  assert.equal(tampa.get('taste-v1'), null)
  assert.equal(sf.get('taste-v1'), null)

  backend.failKeys.delete(LEGACY_OWNER_KEY)
  assert.equal(tampa.get('taste-v1'), '{"v":1}', 'a persisted repair makes the fallback owner readable')

  const key = physicalKey('my-events-v1', { cityId: 'tampa-bay' })
  backend.failKeys.add(key)
  assert.equal(tampa.set('my-events-v1', '[{"title":"Session plan"}]'), false)
  assert.equal(tampa.get('my-events-v1'), '[{"title":"Session plan"}]')
  assert.equal(tampa.readDurable('my-events-v1'), null, 'physical reads bypass the session fallback')
  assert.equal(createStorageScope({ backend, cityId: 'tampa-bay' }).get('my-events-v1'), null)
})

test('taste reset reports whether its tombstone persisted', () => {
  const previous = globalThis.localStorage
  const backend = new MemoryStorage([
    [physicalKey('taste-v1', { cityId: 'tampa-bay' }), '{"v":1}'],
  ])
  const key = physicalKey('taste-v1', { cityId: 'tampa-bay' })
  globalThis.localStorage = backend
  try {
    assert.equal(resetTaste(), true)
    backend.setItem(key, '{"v":1}')
    backend.failKeys.add(key)
    assert.equal(resetTaste(), false)
  } finally {
    globalThis.localStorage = previous
  }
})

test('typed reads distinguish missing, corrupt, invalid, and valid values', () => {
  const backend = new MemoryStorage()
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  const options = {
    fallback: [],
    validate: (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
  }
  assert.deepEqual(tampa.readJson('search-recents-v1', options), { status: 'missing', value: [] })
  tampa.set('search-recents-v1', '{')
  assert.deepEqual(tampa.readJson('search-recents-v1', options), { status: 'corrupt', value: [] })
  tampa.set('search-recents-v1', '[null]')
  assert.deepEqual(tampa.readJson('search-recents-v1', options), { status: 'invalid', value: [] })
  tampa.set('search-recents-v1', '["music"]')
  assert.deepEqual(tampa.readJson('search-recents-v1', options), { status: 'ok', value: ['music'] })
})

test('malformed custom-event rows cannot crash app normalization', () => {
  const previous = globalThis.localStorage
  const backend = new MemoryStorage()
  globalThis.localStorage = backend
  try {
    backend.setItem(PREFIX + 'my-events-v1', JSON.stringify([
      null,
      {},
      { title: 'Valid local plan', start: '2026-07-20', tags: ['added-by-you'] },
    ]))
    const loaded = loadMyEvents()
    assert.equal(loaded.length, 1)
    assert.match(loaded[0].localId, /^[a-z0-9][a-z0-9_-]{7,63}$/i)
    const { localId, ...raw } = loaded[0]
    assert.ok(localId)
    assert.deepEqual(raw, { title: 'Valid local plan', start: '2026-07-20', tags: ['added-by-you'] })
  } finally {
    globalThis.localStorage = previous
  }
})

test('storage listeners, profile identity, and session fatigue use canonical scopes', () => {
  const saves = readFileSync(join(ROOT, 'app', 'src', 'saves.js'), 'utf8')
  const recents = readFileSync(join(ROOT, 'app', 'src', 'recents.js'), 'utf8')
  const taste = readFileSync(join(ROOT, 'app', 'src', 'taste.js'), 'utf8')
  const edit = readFileSync(join(ROOT, 'app', 'src', 'EditProfilePage.jsx'), 'utf8')
  const profile = readFileSync(join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  const tuner = readFileSync(join(ROOT, 'app', 'src', 'TasteTuner.jsx'), 'utf8')
  const weather = readFileSync(join(ROOT, 'app', 'src', 'weather.js'), 'utf8')
  const settings = readFileSync(join(ROOT, 'app', 'src', 'SettingsPage.jsx'), 'utf8')

  // Saves/Been now cross the city-bound atomic provider rather than owning a
  // second storage listener. The remaining V1 taste and recents modules still
  // have to use the canonical physical-key seam until their scheduled cutover.
  assert.match(saves, /useSavedBeen\(\)/)
  assert.doesNotMatch(saves, /physicalKey\(|localStorage|addEventListener\(['"]storage/)
  for (const source of [recents, taste]) {
    assert.match(source, /physicalKey\(/)
    assert.doesNotMatch(source, /PREFIX \+ KEY/)
  }
  assert.match(edit, /globalGet/)
  assert.match(edit, /globalSet/)
  assert.match(profile, /globalGet/)
  assert.match(tuner, /CITY\.id/)
  assert.match(weather, /CITY\.id === 'tampa-bay' && CACHE_KEY !== LEGACY_WX_KEY/)
  assert.match(settings, /const outcomes = \[/)
  assert.match(settings, /outcomes\.every\(Boolean\)/)
  assert.match(settings, /setResetStatus\(persisted \? 'persisted' : 'session-only'\)/)
  assert.match(settings, /browser could not save the reset/i)
})
