import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalGuide,
  guideFreshness,
  guideSnapshot,
  rehydrateSavedGuide,
} from '../app/src/guide-model.js'

const base = {
  id: 'rain-plan',
  title: 'Rain plan',
  pov: 'Indoor options from current listings.',
  domain: 'events',
  keywords: ['rain', 'indoor'],
  selectionMethod: { type: 'category-filter', summary: 'Filters current category fields.' },
}

test('guide snapshots retain a transparent, bounded selection contract', () => {
  const guide = canonicalGuide({ ...base, select: () => [], surprise: 'drop-me' })
  const snapshot = guideSnapshot(guide)
  assert.equal(snapshot.guideType, 'evergreen')
  assert.deepEqual(snapshot.keywords, ['rain', 'indoor'])
  assert.deepEqual(snapshot.sources, [])
  assert.equal(snapshot.selectionMethod.type, 'category-filter')
  assert.equal(snapshot.cover.kind, 'decorative')
  assert.equal('surprise' in guide, false)
  assert.equal('select' in snapshot, false)
})

test('guide cover fails closed and hostile identities/windows are rejected', () => {
  const declared = canonicalGuide({
    ...base,
    cover: { kind: 'verified-photo', url: 'https://bad.test/x.jpg', subject: 'X', credit: 'Me', license: 'CC0', sourceUrl: 'https://bad.test' },
  })
  assert.equal(declared.cover.kind, 'decorative')
  assert.equal(canonicalGuide({ ...base, id: 'g|double' }), null)
  assert.equal(canonicalGuide({ ...base, kind: 'watch', window: { start: '2026-02-30', end: '2026-03-01' } }), null)
  assert.equal(canonicalGuide({ ...base, kind: 'watch', window: { start: '2026-02-01', end: '2026-03-01' }, keywords: [] }), null)
})

test('saved guide snapshot remains available without a live catalog row', () => {
  const snapshot = guideSnapshot(canonicalGuide(base))
  const retained = rehydrateSavedGuide(snapshot, [])
  assert.equal(retained.available, true)
  assert.equal(retained.source, 'saved-snapshot')
  assert.equal(retained.guide.id, base.id)
})

test('freshness is artifact-derived and only healthy source evidence is fresh', () => {
  const meta = {
    generatedAt: '2026-07-20T02:00:00.000Z',
    expiresAt: '2026-07-22T02:00:00.000Z',
    timeZone: 'America/New_York',
  }
  assert.equal(guideFreshness(meta, Date.parse('2026-07-21T00:00:00Z')).status, 'unknown')
  assert.match(guideFreshness(meta, Date.parse('2026-07-21T00:00:00Z')).label, /source check unavailable/i)
  assert.equal(guideFreshness({ ...meta, sourceHealth: { status: 'healthy' } }, Date.parse('2026-07-21T00:00:00Z')).status, 'fresh')
  assert.equal(guideFreshness({ ...meta, sourceHealth: { status: 'healthy' } }, Date.parse('2026-07-23T00:00:00Z')).status, 'stale')
})
