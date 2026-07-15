import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterEvents, matchesEventFilters } from '../app/src/eventFilters.js'
import { CAT_BUBBLES } from '../app/src/lib.js'
import { resolveSearchScope } from '../app/src/search.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (file) => readFileSync(join(ROOT, 'app', 'src', file), 'utf8')

test('combined event filters intersect When, Price, and Category', () => {
  const anchors = { tomorrowTs: 200 }
  const rows = [
    { id: 'match', _tonight: true, _weekend: true, _day: 100, _free: true, category: 'music' },
    { id: 'paid', _tonight: true, _weekend: true, _day: 100, _free: false, category: 'music' },
    { id: 'tomorrow', _tonight: false, _weekend: true, _day: 200, _free: true, category: 'music' },
    { id: 'comedy', _tonight: true, _weekend: true, _day: 100, _free: true, category: 'comedy' },
  ]
  const filters = { when: 'tonight', price: 'free', category: 'music' }
  assert.deepEqual(filterEvents(rows, { when: 'tonight' }, anchors).map((row) => row.id), ['match', 'paid', 'comedy'])
  assert.deepEqual(filterEvents(rows, { when: 'weekend' }, anchors).map((row) => row.id), ['match', 'paid', 'tomorrow', 'comedy'])
  assert.deepEqual(filterEvents(rows, { price: 'free' }, anchors).map((row) => row.id), ['match', 'tomorrow', 'comedy'])
  assert.deepEqual(filterEvents(rows, { category: 'music' }, anchors).map((row) => row.id), ['match', 'paid', 'tomorrow'])
  assert.deepEqual(filterEvents(rows, { when: 'tonight', price: 'free' }, anchors).map((row) => row.id), ['match', 'comedy'])
  assert.deepEqual(filterEvents(rows, { price: 'free', category: 'music' }, anchors).map((row) => row.id), ['match', 'tomorrow'])
  assert.deepEqual(filterEvents(rows, { when: 'tonight', category: 'music' }, anchors).map((row) => row.id), ['match', 'paid'])
  assert.deepEqual(filterEvents(rows, filters, anchors).map((row) => row.id), ['match'])
  assert.equal(matchesEventFilters(rows[2], { when: 'tomorrow', price: 'free', category: 'music' }, anchors), true)
  assert.equal(matchesEventFilters({ ...rows[0], category: 'art' }, { category: 'art' }, anchors), true)
  assert.equal(matchesEventFilters(rows[0], { when: 'unsupported' }, anchors), false)
  assert.equal(CAT_BUBBLES.find((bubble) => bubble.id === 'arts')?.value, 'art')
  assert.equal(CAT_BUBBLES.find((bubble) => bubble.id === 'night')?.value, 'nightlife')
})

test('Search resets a disappeared result scope to All without a blank body', () => {
  let scope = resolveSearchScope('spots', { events: 4, spots: 2, guides: 0 })
  assert.equal(scope, 'spots')
  scope = resolveSearchScope(scope, { events: 4, spots: 0, guides: 0 })
  assert.equal(scope, 'all')
  scope = resolveSearchScope(scope, { events: 4, spots: 2, guides: 0 })
  assert.equal(scope, 'all')
  assert.equal(resolveSearchScope('events', { events: 4, spots: 0, guides: 0 }), 'events')
  assert.equal(resolveSearchScope('spots', { events: 4, spots: 0, guides: 0 }), 'all')
  assert.equal(resolveSearchScope('guides', { events: 0, spots: 0, guides: 0 }), 'all')
  assert.equal(resolveSearchScope('not-a-scope', { events: 4 }), 'all')

  const page = source('SearchPage.jsx')
  assert.match(page, /const activeTab = resolveSearchScope\(tab,/)
  assert.match(page, /setTab\(\(current\) => resolveSearchScope\(current, counts\)\)/)
  assert.doesNotMatch(page, /setQ\(value\)\s+setTab\('all'\)/)
  assert.ok(page.includes("key={dq.trim() + '|' + activeTab}"))
})

test('inactive and covered app layers are inert, and unsupported location claims are gone', () => {
  const app = source('App.jsx')
  const filters = source('FiltersSheet.jsx')
  const bubble = source('BubblePage.jsx')
  const locations = source('LocationsView.jsx')

  assert.equal((app.match(/aria-hidden=\{active !== [0-4]\}/g) || []).length, 5)
  assert.equal((app.match(/inert=\{active !== [0-4] \? true : undefined\}/g) || []).length, 5)
  assert.match(app, /const baseCovered = !primer \|\| Boolean\(page\) \|\| Boolean\(detail\)/)
  assert.match(app, /aria-hidden=\{baseCovered \|\| undefined\}/)
  assert.match(app, /inert=\{detail \? true : undefined\}/)
  assert.match(app, /aria-current=\{active === i \? 'page' : undefined\}/)

  assert.match(filters, /aria-pressed=\{value === b\.id\}/)
  assert.match(filters, /kind: 'filters'/)
  assert.match(filters, /category: categoryBubble\?\.value \|\| null/)
  assert.match(filters, /if \(!anySelected\) return closePage\(\)/)
  assert.match(filters, /data-initial-focus/)
  assert.match(filters, /onKeyDown=\{trapFocus\}/)
  assert.match(filters, /tabIndex=\{-1\}/)
  assert.match(bubble, /matchesEventFilters\(e, bubble\.filters, anchors\)/)
  assert.match(app, /pageReturnFocusRef/)
  assert.match(app, /detailReturnFocusRef/)
  assert.match(app, /focusLayer\(pageLayerRef\.current\)/)
  assert.match(app, /restoreLayerFocus\(target, pageLayerRef\.current \|\| appRef\.current\)/)
  assert.match(app, /ref=\{pageLayerRef\}/)
  assert.doesNotMatch(locations, /title="Recommended near you"/)
  assert.doesNotMatch(locations, /title="Worth the drive"/)
  assert.doesNotMatch(locations, /Sorted by distance from your location/)
})
