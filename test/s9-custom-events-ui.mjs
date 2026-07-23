import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyCustomEventState, reduceCustomEventState } from '../app/src/custom-event-state-core.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'app/src/AddEvent.jsx'), 'utf8')

test('AddEvent exposes an isolated edit mode with canonical prefill and provider update target', () => {
  assert.match(source, /editEvent = null, onUpdate = null/)
  assert.match(source, /title: editing \? editEvent\.title/)
  assert.match(source, /date: editing \? String\(editEvent\.start/)
  assert.match(source, /const added = editing \? await onUpdate\(editEvent, raw\) : await onAdd\(raw\)/)
  assert.match(source, /editing && added\?\.code === 'unchanged'/)
  assert.match(source, /if \(!editing\) recordSignal\('add'/)
  assert.match(source, /editing \? 'Save changes' : 'Add event'/)
})

test('custom event update preserves local identity and prior aliases', () => {
  const context = { cityId: 'tampa-bay', timeZone: 'America/New_York' }
  const empty = emptyCustomEventState('tampa-bay', { timeZone: context.timeZone })
  const added = reduceCustomEventState(empty, {
    type: 'add',
    event: {
      kind: 'custom', localId: 'local-one', title: 'Original', start: '2026-08-01T19:00:00',
      timeZone: context.timeZone, source: 'Added by you', sources: ['Added by you'], tags: ['added-by-you'],
    },
  }, context)
  assert.equal(added.changed, true)
  const current = added.document.items[0]
  const updated = reduceCustomEventState(added.document, {
    type: 'update',
    localId: 'local-one',
    expectedRevision: current.revision,
    event: { ...current.item, title: 'Updated' },
  }, context)
  assert.equal(updated.changed, true)
  assert.equal(updated.document.items[0].item.localId, 'local-one')
  for (const alias of current.aliases) assert.equal(updated.document.items[0].aliases.includes(alias), true)
})
