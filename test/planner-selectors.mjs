import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activePlannerDays,
  createPlannerCatalog,
  findPlannedItem,
  isPlannerItemPlanned,
  plannedPrimarySet,
  plannerHistory,
  plannerSlots,
  resolvePlannerSlot,
} from '../app/src/planner-selectors.js'
import {
  emptyPlannerDocument,
  normalizePlannerDocument,
  slotRefOf,
} from '../app/src/planner-core.js'

const event = (id, title, extra = {}) => ({
  id,
  title,
  start: '2026-07-20T19:00:00-04:00',
  url: `https://example.test/${title.toLowerCase().replaceAll(' ', '-')}`,
  ...extra,
})

function documentWith(active, history = []) {
  return normalizePlannerDocument({
    ...emptyPlannerDocument(),
    active,
    history,
  })
}

test('resolves stable-ID drift through a unique retained legacy alias', () => {
  const prior = event('aaaaaaaaaaaaaaaa', 'Original title')
  const current = {
    ...event('bbbbbbbbbbbbbbbb', 'Current title'),
    url: prior.url,
    description: 'Live description',
  }
  const ref = slotRefOf({ ...prior, description: 'Retained description', venue: 'Retained venue' })
  const catalog = createPlannerCatalog({ events: [current] })

  const resolved = resolvePlannerSlot(ref, catalog)

  assert.equal(resolved.status, 'live')
  assert.equal(resolved.item.title, 'Current title')
  assert.equal(resolved.item.description, 'Live description')
  assert.equal(resolved.item.venue, 'Retained venue')
  assert.equal(resolved.ref, ref)
})

test('historical seed aliases bridge drift without becoming live candidates', () => {
  const current = event('bbbbbbbbbbbbbbbb', 'Current title')
  const oldAlias = 'https://old.example.test/listing|2026-07-20'
  const ref = {
    kind: 'event',
    primary: oldAlias,
    aliases: [oldAlias],
    snapshot: { title: 'Historical title', start: '2026-07-20' },
  }
  const catalog = createPlannerCatalog({
    events: [current],
    seeds: [{
      kind: 'event',
      primary: 'e|bbbbbbbbbbbbbbbb',
      aliases: ['e|bbbbbbbbbbbbbbbb', oldAlias],
    }],
  })

  assert.equal(resolvePlannerSlot(ref, catalog).status, 'live')

  const seedOnly = createPlannerCatalog({
    seeds: [{
      kind: 'event',
      primary: 'e|bbbbbbbbbbbbbbbb',
      aliases: ['e|bbbbbbbbbbbbbbbb', oldAlias],
    }],
  })
  assert.equal(resolvePlannerSlot(ref, seedOnly).status, 'retained')
})

test('an alias with two live candidates is ambiguous and never first-wins', () => {
  const shared = 'https://example.test/shared|2026-07-20T19:00:00-04:00'
  const first = event('aaaaaaaaaaaaaaaa', 'First', { identityAliases: [shared] })
  const second = event('bbbbbbbbbbbbbbbb', 'Second', { identityAliases: [shared] })
  const ref = {
    kind: 'event',
    primary: 'e|cccccccccccccccc',
    aliases: ['e|cccccccccccccccc', shared],
    snapshot: { title: 'Retained choice', tags: ['retained'] },
  }
  const catalog = createPlannerCatalog({ events: [first, second] })

  const resolved = resolvePlannerSlot(ref, catalog)

  assert.equal(resolved.status, 'ambiguous')
  assert.equal(resolved.item.title, 'Retained choice')
  assert.deepEqual(resolved.candidates, ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'])
  assert.notEqual(resolved.item.title, first.title)
  assert.notEqual(resolved.item.title, second.title)
})

test('stored ambiguity remains explicit without a usable live catalog', () => {
  const ref = {
    kind: 'event',
    primary: 'Old listing|2026-07-20',
    aliases: ['Old listing|2026-07-20'],
    snapshot: { title: 'Retained choice', start: '2026-07-20' },
    identity: {
      status: 'ambiguous',
      legacyKey: 'Old listing|2026-07-20',
      candidates: ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'],
    },
  }
  const expected = {
    status: 'ambiguous',
    item: { title: 'Retained choice', start: '2026-07-20', kind: 'event' },
    ref,
    candidates: ['e|aaaaaaaaaaaaaaaa', 'e|bbbbbbbbbbbbbbbb'],
  }

  assert.deepEqual(resolvePlannerSlot(ref), expected)
  assert.deepEqual(resolvePlannerSlot(ref, createPlannerCatalog({
    events: [event('cccccccccccccccc', 'Unrelated')],
  })), expected)

  const document = documentWith({
    1000: { state: null, slots: { morning: ref } },
  })
  assert.equal(findPlannedItem(document, {
    title: 'Old listing',
    start: '2026-07-20',
  }), null)
  assert.equal(findPlannedItem(document, {
    title: 'Old listing',
    start: '2026-07-20',
  }, createPlannerCatalog({
    events: [event('cccccccccccccccc', 'Unrelated')],
  })), null)
  assert.deepEqual([...plannedPrimarySet(document)], [])
})

test('a missing event stays retained without a false live claim', () => {
  const ref = slotRefOf(event('aaaaaaaaaaaaaaaa', 'Removed listing', {
    tags: ['archived'],
  }), { plannedAt: 123 })
  const resolved = resolvePlannerSlot(ref, createPlannerCatalog())

  assert.deepEqual(resolved, {
    status: 'retained',
    item: {
      id: 'aaaaaaaaaaaaaaaa',
      kind: 'event',
      title: 'Removed listing',
      start: '2026-07-20T19:00:00-04:00',
      url: 'https://example.test/removed-listing',
      tags: ['archived'],
    },
    ref,
  })
  assert.equal(Object.hasOwn(resolved, 'live'), false)
})

test('place and custom-event refs resolve in separate kind catalogs', () => {
  const place = {
    kind: 'place',
    key: 'p|riverwalk',
    name: 'Riverwalk',
    address: '100 Water St',
  }
  const custom = {
    kind: 'custom',
    localId: 'local-event-123',
    title: 'Porch show',
    start: '2026-07-20T20:00:00',
    source: 'Added by you',
  }
  const catalog = createPlannerCatalog({
    places: [{ ...place, name: 'Tampa Riverwalk' }],
    customEvents: [{ ...custom, title: 'Porch show tonight' }],
  })

  const resolvedPlace = resolvePlannerSlot(slotRefOf(place), catalog)
  const resolvedCustom = resolvePlannerSlot(slotRefOf(custom), catalog)

  assert.equal(resolvedPlace.status, 'live')
  assert.equal(resolvedPlace.item.kind, 'place')
  assert.equal(resolvedPlace.item.name, 'Tampa Riverwalk')
  assert.equal(resolvedCustom.status, 'live')
  assert.equal(resolvedCustom.item.kind, 'custom')
  assert.equal(resolvedCustom.item.title, 'Porch show tonight')
})

test('planned lookup follows unique aliases and fails closed on ambiguity', () => {
  const prior = event('aaaaaaaaaaaaaaaa', 'Old listing')
  const current = {
    ...event('bbbbbbbbbbbbbbbb', 'New listing'),
    url: prior.url,
  }
  const ref = slotRefOf(prior)
  const document = documentWith({
    3000: { state: null, slots: { night: ref } },
  })
  const catalog = createPlannerCatalog({ events: [current] })

  assert.deepEqual(findPlannedItem(document, current, catalog), {
    dayTs: 3000,
    part: 'night',
    ref: document.active['3000'].slots.night,
  })
  assert.equal(isPlannerItemPlanned(document, current, catalog), true)
  assert.deepEqual([...plannedPrimarySet(document, catalog)], ['event:e|bbbbbbbbbbbbbbbb'])

  const shared = ref.aliases[1]
  const collision = event('cccccccccccccccc', 'Collision', { identityAliases: [shared] })
  const ambiguousCatalog = createPlannerCatalog({ events: [current, collision] })
  assert.equal(findPlannedItem(document, current, ambiguousCatalog), null)
  assert.deepEqual([...plannedPrimarySet(document, ambiguousCatalog)], [])
})

test('planned lookup prefers exact primary and fails closed on multiple weak primaries', () => {
  const shared = 'https://example.test/shared-weak|2026-07-20T19:00:00-04:00'
  const query = event('aaaaaaaaaaaaaaaa', 'Exact target', { identityAliases: [shared] })
  const wrong = event('bbbbbbbbbbbbbbbb', 'Earlier weak match', { identityAliases: [shared] })
  const exact = slotRefOf(query)
  const weak = slotRefOf(wrong)
  const exactDocument = documentWith({
    1000: { state: null, slots: { morning: weak } },
    2000: { state: null, slots: { night: exact } },
  })

  assert.deepEqual(findPlannedItem(exactDocument, query), {
    dayTs: 2000,
    part: 'night',
    ref: exactDocument.active['2000'].slots.night,
  })

  const first = slotRefOf({
    kind: 'event',
    primary: 'legacy|first',
    aliases: ['legacy|first', shared],
    title: 'First weak',
  })
  const second = slotRefOf({
    kind: 'event',
    primary: 'legacy|second',
    aliases: ['legacy|second', shared],
    title: 'Second weak',
  })
  const weakDocument = documentWith({
    1000: { state: null, slots: { morning: first } },
    2000: { state: null, slots: { night: second } },
  })
  assert.equal(findPlannedItem(weakDocument, {
    kind: 'event',
    primary: 'legacy|query',
    aliases: ['legacy|query', shared],
    title: 'Weak query',
  }), null)
})

test('an equal unresolved legacy primary cannot bypass current catalog ambiguity', () => {
  const shared = 'shared|x'
  const legacy = 'legacy|same'
  const first = event('aaaaaaaaaaaaaaaa', 'First', { identityAliases: [shared] })
  const second = event('bbbbbbbbbbbbbbbb', 'Second', { identityAliases: [shared] })
  const ref = {
    kind: 'event',
    primary: legacy,
    aliases: [legacy, shared],
    snapshot: { title: 'Retained ambiguous listing' },
  }
  const document = documentWith({
    1000: { state: null, slots: { morning: ref } },
  })
  const catalog = createPlannerCatalog({ events: [first, second] })

  assert.equal(resolvePlannerSlot(ref, catalog).status, 'ambiguous')
  assert.equal(findPlannedItem(document, {
    kind: 'event',
    primary: legacy,
    aliases: [legacy],
    title: 'Legacy query',
  }, catalog), null)
})

test('raw identity evidence is bounded before resolution and ambiguity return', () => {
  const primary = 'legacy|bounded'
  const aliases = Array.from({ length: 500_000 }, (_, index) => `alias|${index}`)
  const candidates = Array.from({ length: 100_000 }, (_, index) => `e|candidate-${index}`)
  const ref = {
    kind: 'event',
    primary,
    aliases: [primary, ...aliases],
    snapshot: { title: 'Bounded retained listing' },
    identity: {
      status: 'ambiguous',
      legacyKey: primary,
      candidates,
    },
  }

  const retained = resolvePlannerSlot(ref)
  assert.equal(retained.status, 'ambiguous')
  assert.ok(retained.candidates.length <= 8)
  assert.ok(Buffer.byteLength(JSON.stringify(retained.candidates), 'utf8') <= 4096)

  const catalog = createPlannerCatalog({
    events: [event('aaaaaaaaaaaaaaaa', 'Unrelated')],
  })
  let resolved
  assert.doesNotThrow(() => {
    resolved = resolvePlannerSlot(ref, catalog)
  })
  assert.equal(resolved.status, 'ambiguous')
  assert.ok(resolved.candidates.length <= 8)
})

test('planned selectors are deterministic and primary sets dedupe malformed duplicate slots', () => {
  const item = event('aaaaaaaaaaaaaaaa', 'Repeated')
  const ref = slotRefOf(item)
  const document = documentWith({
    3000: { state: null, slots: { night: ref } },
    1000: { state: null, slots: { morning: ref } },
  })

  assert.deepEqual(plannerSlots(document).map(({ dayTs, part }) => [dayTs, part]), [
    [1000, 'morning'],
    [3000, 'night'],
  ])
  assert.deepEqual(findPlannedItem(document, item), {
    dayTs: 1000,
    part: 'morning',
    ref: document.active['1000'].slots.morning,
  })
  assert.deepEqual([...plannedPrimarySet(document)], ['event:e|aaaaaaaaaaaaaaaa'])
})

test('planned identity sets keep event and custom legacy primaries kind-qualified', () => {
  const eventRef = slotRefOf({
    kind: 'event',
    primary: 'shared-legacy',
    aliases: ['shared-legacy'],
    title: 'Event',
  })
  const customRef = slotRefOf({
    kind: 'custom',
    primary: 'shared-legacy',
    aliases: ['shared-legacy'],
    title: 'Custom',
  })
  const document = documentWith({
    1000: { state: null, slots: { morning: eventRef, afternoon: customRef } },
  })

  assert.deepEqual([...plannedPrimarySet(document)], [
    'event:shared-legacy',
    'custom:shared-legacy',
  ])
})

test('active and history selectors retain rest and done-only lifecycle rows in date order', () => {
  const ref = slotRefOf(event('aaaaaaaaaaaaaaaa', 'Planned'))
  const document = documentWith({
    3000: { state: null, slots: { afternoon: ref }, done: false },
    1000: { state: 'rest', slots: {}, done: false },
    2000: { state: null, slots: {}, done: true },
  }, [
    { dayTs: 900, state: 'rest', slots: {}, done: false },
    { dayTs: 700, state: null, slots: { night: ref }, done: true },
    { dayTs: 800, state: null, slots: {}, done: true },
  ])

  assert.deepEqual(activePlannerDays(document).map((day) => [
    day.dayTs,
    day.state,
    day.done,
    Boolean(day.slots.afternoon),
  ]), [
    [1000, 'rest', false, false],
    [2000, null, true, false],
    [3000, null, false, true],
  ])
  assert.deepEqual(plannerHistory(document).map((day) => [day.dayTs, day.state, day.done]), [
    [700, null, true],
    [800, null, true],
    [900, 'rest', false],
  ])
})

test('live merge and retained fallback do not mutate catalog items or snapshots', () => {
  const live = event('aaaaaaaaaaaaaaaa', 'Live title', {
    tags: ['live'],
    venue: { name: 'Live venue' },
  })
  const ref = slotRefOf(event('aaaaaaaaaaaaaaaa', 'Retained title', {
    tags: ['retained'],
    venue: { name: 'Retained venue' },
  }))
  const originalRef = structuredClone(ref)
  const originalLive = structuredClone(live)
  const resolved = resolvePlannerSlot(ref, createPlannerCatalog({ events: [live] }))

  resolved.item.tags.push('changed')
  resolved.item.venue.name = 'Changed venue'

  assert.deepEqual(ref, originalRef)
  assert.deepEqual(live, originalLive)
})

test('live and retained resolution bound hostile depth instead of overflowing the stack', () => {
  const deep = {}
  let cursor = deep
  for (let index = 0; index < 15_000; index += 1) {
    cursor.next = {}
    cursor = cursor.next
  }
  const live = event('aaaaaaaaaaaaaaaa', 'Deep live', { hostile: deep })
  const ref = slotRefOf(event('aaaaaaaaaaaaaaaa', 'Retained'))
  let resolved
  assert.doesNotThrow(() => {
    resolved = resolvePlannerSlot(ref, createPlannerCatalog({ events: [live] }))
  })
  assert.equal(resolved.status, 'live')
  assert.equal(resolved.item.title, 'Deep live')

  const rawRetained = {
    kind: 'event',
    primary: 'legacy|deep',
    aliases: ['legacy|deep'],
    snapshot: { title: 'Deep retained', hostile: deep },
  }
  assert.doesNotThrow(() => resolvePlannerSlot(rawRetained))
  assert.equal(resolvePlannerSlot(rawRetained).item.title, 'Deep retained')
})
