import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSearchState, searchGuides } from '../app/src/search.js'
import { normalizeProfileState } from '../app/src/profile-state.js'
import { canonicalGuide } from '../app/src/guide-model.js'

test('search transfer shape is exact and never silently truncates', () => {
  assert.deepEqual(normalizeSearchState({ v: 1, items: ['jazz', 'parks'] }), { v: 1, items: ['jazz', 'parks'] })
  assert.equal(normalizeSearchState({ v: 1, items: Array.from({ length: 9 }, (_, i) => `q${i}`) }), null)
  assert.equal(normalizeSearchState({ v: 1, items: ['Jazz', 'jazz'] }), null)
  assert.equal(normalizeSearchState({ v: 1, items: [' padded '] }), null)
  assert.equal(normalizeSearchState({ v: 1, items: ['x'], extra: true }), null)
})

test('guide search includes the disclosed keywords and selection method', () => {
  const guide = canonicalGuide({
    id: 'field-guide', title: 'Indoor backup', pov: 'Current options.', domain: 'events',
    keywords: ['ceramics'], selectionMethod: { type: 'category-filter', summary: 'Matches gallery categories.' },
  })
  assert.deepEqual(searchGuides([guide], 'ceramic', {}), [guide])
  assert.deepEqual(searchGuides([guide], 'gallery', {}), [guide])
})

test('profile transfer keeps bounded device-local name and note', () => {
  assert.deepEqual(normalizeProfileState({ version: 1, name: ' Ada ', bio: ' Quiet patios ' }), {
    version: 1, name: 'Ada', bio: 'Quiet patios',
  })
  assert.equal(normalizeProfileState({ version: 1, name: 'Ada' }), null)
  assert.equal(normalizeProfileState({ version: 1, name: 'Ada', bio: '', social: true }), null)
})
