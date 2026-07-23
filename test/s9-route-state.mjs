import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { primaryKeyOf } from '../app/src/identity.js'
import { createPlanCapsule } from '../app/src/plan-capsule.js'
import { resolveRouteState } from '../app/src/route-resolution.js'
import {
  NAV_ID_TO_ROUTE_TAB,
  ROUTE_STATE_VERSION,
  ROUTE_TAB_TO_NAV_ID,
  navIdToRouteTab,
  normalizeRouteState,
  parseRouteQuery,
  routeTabToNavId,
  serializeRouteHref,
  serializeRouteQuery,
  validRouteIdentity,
} from '../app/src/route-state.js'

const CITY = { id: 'tampa-bay', timeZone: 'America/New_York' }
const EVENT_ID = 'e|0123456789abcdef'
const CUSTOM_ID = 'c|custom_123'
const PLACE_ID = 'p|baker-beach'
const GUIDE_ID = 'g|beach-day'

const route = (tab, target = null, cityId = CITY.id) => ({
  v: ROUTE_STATE_VERSION,
  cityId,
  tab,
  target,
})

const catalogs = {
  cityId: CITY.id,
  timeZone: CITY.timeZone,
  events: [{ id: EVENT_ID.slice(2), title: 'Night market' }],
  customEvents: [{ kind: 'custom', localId: CUSTOM_ID.slice(2), title: 'Porch show' }],
  places: [{ kind: 'place', key: PLACE_ID, name: 'Baker Beach' }],
  guides: [{ id: 'beach-day', title: 'Beach day' }],
}

test('public route tabs map explicitly and reversibly to the existing nav ids', () => {
  assert.deepEqual(ROUTE_TAB_TO_NAV_ID, {
    home: 'home',
    events: 'hot',
    spots: 'locations',
    plan: 'calendar',
    profile: 'profile',
  })
  assert.deepEqual(NAV_ID_TO_ROUTE_TAB, {
    home: 'home',
    hot: 'events',
    locations: 'spots',
    calendar: 'plan',
    profile: 'profile',
  })
  for (const [publicTab, navId] of Object.entries(ROUTE_TAB_TO_NAV_ID)) {
    assert.equal(routeTabToNavId(publicTab), navId)
    assert.equal(navIdToRouteTab(navId), publicTab)
  }
  assert.equal(routeTabToNavId('hot'), null)
  assert.equal(navIdToRouteTab('events'), null)

  const navSource = readFileSync(new URL('../app/src/nav.jsx', import.meta.url), 'utf8')
  for (const navId of Object.values(ROUTE_TAB_TO_NAV_ID)) {
    assert.match(navSource, new RegExp(`id: ['"]${navId}['"]`))
  }
})

test('every durable target round-trips through one deterministic query contract', () => {
  const values = [
    route('home'),
    route('events', { kind: 'event', id: EVENT_ID }),
    route('events', { kind: 'event', id: CUSTOM_ID }),
    route('spots', { kind: 'place', id: PLACE_ID }),
    route('events', { kind: 'guide', id: GUIDE_ID }),
    route('plan', { kind: 'day', day: '2026-07-25' }),
    route('plan', { kind: 'shared-plan' }),
  ]
  for (const value of values) {
    const query = serializeRouteQuery(value)
    const parsed = parseRouteQuery(query)
    assert.equal(parsed.ok, true)
    assert.deepEqual(parsed.route, value)
    assert.equal(serializeRouteQuery(parsed.route), query)
    assert.equal(serializeRouteHref(value, { baseUrl: '/wuzup/sf/' }), `/wuzup/sf/${query}`)
  }
  assert.equal(
    serializeRouteQuery(route('events', { kind: 'guide', id: GUIDE_ID })),
    '?city=tampa-bay&tab=events&guide=g%7Cbeach-day',
  )
})

test('route parsing defaults target tabs, coexists with unrelated query keys, and fails closed', () => {
  const inferred = parseRouteQuery(`?utm_source=friend&city=${CITY.id}&place=p%7Cbaker-beach`)
  assert.equal(inferred.ok, true)
  assert.equal(inferred.route.tab, 'spots')

  for (const query of [
    '?tab=events',
    '?city=../sf&tab=events',
    '?city=tampa-bay&city=sf-east-bay',
    '?city=tampa-bay&event=e%7C0123456789abcdef&place=p%7Cbaker-beach',
    '?city=tampa-bay&shared=yes',
    '?city=tampa-bay&event=title%7C2026-07-25',
    '?city=tampa-bay&day=2026-02-30',
    '?city=tampa-bay&event=%ZZ',
  ]) assert.equal(parseRouteQuery(query).ok, false, query)

  assert.equal(normalizeRouteState({ ...route('home'), extra: true }), null)
  assert.throws(() => serializeRouteHref(route('home'), { baseUrl: '/wuzup/../admin' }), TypeError)
  assert.throws(() => serializeRouteHref(route('home'), { baseUrl: '//evil.test/' }), TypeError)
})

test('stable route identity patterns match real event, custom, and place identities', () => {
  assert.equal(primaryKeyOf(catalogs.events[0]), EVENT_ID)
  assert.equal(primaryKeyOf(catalogs.customEvents[0]), CUSTOM_ID)
  assert.equal(primaryKeyOf(catalogs.places[0]), PLACE_ID)
  assert.equal(validRouteIdentity('event', EVENT_ID), true)
  assert.equal(validRouteIdentity('event', CUSTOM_ID), true)
  assert.equal(validRouteIdentity('place', PLACE_ID), true)
  assert.equal(validRouteIdentity('guide', GUIDE_ID), true)
  for (const value of ['e|short', 'c|tiny', 'p|../sf', 'g|beach/day', 'Night market|2026']) {
    assert.equal(
      validRouteIdentity(value.startsWith('p|') ? 'place' : value.startsWith('g|') ? 'guide' : 'event', value),
      false,
    )
  }
})

test('strict resolution opens exact live identities, including prefixed current guide ids', () => {
  const cases = [
    [route('events', { kind: 'event', id: EVENT_ID }), 'Night market'],
    [route('events', { kind: 'event', id: CUSTOM_ID }), 'Porch show'],
    [route('spots', { kind: 'place', id: PLACE_ID }), 'Baker Beach'],
    [route('events', { kind: 'guide', id: GUIDE_ID }), 'Beach day'],
  ]
  for (const [value, title] of cases) {
    const result = resolveRouteState(value, {
      activeCityId: CITY.id,
      timeZone: CITY.timeZone,
      catalogs,
    })
    assert.equal(result.status, 'resolved')
    assert.equal(result.item.title ?? result.item.name, title)
  }

  const day = resolveRouteState(route('plan', { kind: 'day', day: '2026-07-25' }), {
    activeCityId: CITY.id,
    timeZone: CITY.timeZone,
  })
  assert.deepEqual(day.value, { kind: 'day', day: '2026-07-25' })
})

test('resolution exposes unavailable and ambiguous states instead of weak or cross-city matches', () => {
  const crossCity = resolveRouteState(route('events', { kind: 'event', id: EVENT_ID }, 'sf-east-bay'), {
    activeCityId: CITY.id,
    timeZone: CITY.timeZone,
    catalogs,
  })
  assert.equal(crossCity.code, 'ROUTE_CITY_UNAVAILABLE')

  const wrongBinding = resolveRouteState(route('events', { kind: 'event', id: EVENT_ID }), {
    activeCityId: CITY.id,
    timeZone: CITY.timeZone,
    catalogs: { ...catalogs, cityId: 'sf-east-bay' },
  })
  assert.equal(wrongBinding.code, 'ROUTE_CATALOG_BINDING_MISMATCH')

  const weakAlias = resolveRouteState(route('events', { kind: 'event', id: EVENT_ID }), {
    activeCityId: CITY.id,
    timeZone: CITY.timeZone,
    catalogs: {
      ...catalogs,
      events: [{ id: 'fedcba9876543210', identityAliases: [EVENT_ID] }],
    },
  })
  assert.equal(weakAlias.code, 'ROUTE_ITEM_UNAVAILABLE')

  const ambiguous = resolveRouteState(route('events', { kind: 'event', id: EVENT_ID }), {
    activeCityId: CITY.id,
    timeZone: CITY.timeZone,
    catalogs: { ...catalogs, events: [catalogs.events[0], { ...catalogs.events[0] }] },
  })
  assert.equal(ambiguous.status, 'ambiguous')
  assert.equal(ambiguous.candidateCount, 2)
})

test('shared-plan routes accept only a same-city, same-timezone read-only capsule', () => {
  const capsule = createPlanCapsule({
    cityId: CITY.id,
    timeZone: CITY.timeZone,
    day: '2026-07-25',
    slots: [{ part: 'night', kind: 'event', primary: EVENT_ID, title: 'Night market' }],
  })
  const value = route('plan', { kind: 'shared-plan' })
  const resolved = resolveRouteState(value, {
    activeCityId: CITY.id,
    timeZone: CITY.timeZone,
    capsule,
  })
  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.value.mode, 'read-only')

  assert.equal(resolveRouteState(value, {
    activeCityId: CITY.id,
    timeZone: CITY.timeZone,
    capsule: { ...capsule, timeZone: 'America/Los_Angeles' },
  }).code, 'ROUTE_SHARED_PLAN_UNAVAILABLE')
})
