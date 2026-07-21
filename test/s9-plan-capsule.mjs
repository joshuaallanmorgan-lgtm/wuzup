import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  PLAN_CAPSULE_MAX_FRAGMENT_BYTES,
  createPlanCapsule,
  parsePlanCapsuleFragment,
  planCapsuleFragment,
} from '../app/src/plan-capsule.js'

const CITY = { id: 'tampa-bay', timeZone: 'America/New_York' }

function rawFragment(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `#wuzup-plan=${token}`
}

test('a plan capsule is deterministic, unicode-safe, sanitized, and capped at three slots', () => {
  const capsule = createPlanCapsule({
    cityId: CITY.id,
    timeZone: CITY.timeZone,
    day: '2026-07-25',
    slots: [
      {
        part: 'night',
        kind: 'event',
        primary: 'e|0123456789abcdef',
        title: '  Música   al fresco 🎺  ',
        timeLabel: '7:00 PM',
        venue: '  Riverwalk  ',
        lat: 27.95,
        lng: -82.46,
        url: 'https://private.invalid',
        note: 'do not share',
      },
      {
        part: 'morning',
        kind: 'place',
        primary: 'p|baker-beach',
        name: 'Beach walk',
      },
      {
        part: 'afternoon',
        kind: 'custom',
        primary: 'c|custom_123',
        title: 'Picnic',
      },
    ],
  })
  assert.deepEqual(capsule.slots.map((slot) => slot.part), ['morning', 'afternoon', 'night'])
  assert.equal(capsule.slots[2].title, 'Música al fresco 🎺')
  assert.deepEqual(Object.keys(capsule.slots[2]), ['part', 'kind', 'primary', 'title', 'time', 'venue'])
  assert.doesNotMatch(JSON.stringify(capsule), /private|note|lat|lng/)

  const fragment = planCapsuleFragment(capsule)
  const decoded = parsePlanCapsuleFragment(fragment, {
    cityId: CITY.id,
    timeZone: CITY.timeZone,
  })
  assert.equal(decoded.ok, true)
  assert.equal(decoded.mode, 'read-only')
  assert.equal(decoded.writable, false)
  assert.deepEqual(decoded.capsule, capsule)
  assert.equal(planCapsuleFragment(decoded.capsule), fragment)
})

test('capsules reject overflow, duplicate slots, unstable identity, and invalid dates', () => {
  const base = {
    cityId: CITY.id,
    timeZone: CITY.timeZone,
    day: '2026-07-25',
  }
  assert.throws(() => createPlanCapsule({
    ...base,
    slots: Array.from({ length: 4 }, (_, index) => ({
      part: ['morning', 'afternoon', 'night', 'night'][index],
      kind: 'event',
      primary: 'e|0123456789abcdef',
      title: `Slot ${index}`,
    })),
  }), /one to three/i)
  assert.throws(() => createPlanCapsule({
    ...base,
    slots: [
      { part: 'night', kind: 'event', primary: 'e|0123456789abcdef', title: 'One' },
      { part: 'night', kind: 'place', primary: 'p|baker-beach', title: 'Two' },
    ],
  }), /invalid/i)
  assert.throws(() => createPlanCapsule({
    ...base,
    slots: [
      { part: 'morning', kind: 'event', primary: 'e|0123456789abcdef', title: 'Same event' },
      { part: 'night', kind: 'event', primary: 'e|0123456789abcdef', title: 'Same event again' },
    ],
  }), /invalid/i)
  assert.throws(() => createPlanCapsule({
    ...base,
    slots: [{ part: 'night', kind: 'event', primary: 'title|2026-07-25', title: 'Legacy' }],
  }), /invalid/i)
  assert.throws(() => createPlanCapsule({
    ...base,
    day: '2026-02-30',
    slots: [{ part: 'night', kind: 'event', primary: 'e|0123456789abcdef', title: 'Bad day' }],
  }), /invalid/i)
})

test('fragment parsing fails closed on tampering, foreign city/timezone, and excess bytes', () => {
  const valid = createPlanCapsule({
    cityId: CITY.id,
    timeZone: CITY.timeZone,
    day: '2026-07-25',
    slots: [{ part: 'night', kind: 'event', primary: 'e|0123456789abcdef', title: 'Show' }],
  })
  for (const fragment of [
    '#wuzup-plan=not+base64',
    '#wuzup-plan=abc&wuzup-plan=def',
    '#wuzup-plan=abc&other=def',
    rawFragment({ ...valid, v: 2 }),
    rawFragment({ ...valid, writeToPlanner: true }),
    rawFragment({ ...valid, cityId: 'sf-east-bay' }),
    rawFragment({
      ...valid,
      slots: [
        valid.slots[0],
        { ...valid.slots[0], part: 'morning' },
      ],
    }),
    `#wuzup-plan=${'a'.repeat(PLAN_CAPSULE_MAX_FRAGMENT_BYTES)}`,
  ]) assert.equal(parsePlanCapsuleFragment(fragment, {
    cityId: CITY.id,
    timeZone: CITY.timeZone,
  }).ok, false, fragment.slice(0, 80))

  assert.equal(parsePlanCapsuleFragment(planCapsuleFragment(valid), {
    cityId: CITY.id,
    timeZone: 'America/Los_Angeles',
  }).ok, false)
})

test('the capsule module owns no planner, provider, or storage write seam', () => {
  const source = readFileSync(new URL('../app/src/plan-capsule.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /PlannerProvider|planner-store|localStorage|lsSet|\.setItem\s*\(/)
  assert.doesNotMatch(source, /addPlannerItem|movePlannerItem|removePlannerItem/)
  assert.match(source, /mode: 'read-only'/)
  assert.match(source, /writable: false/)
})
