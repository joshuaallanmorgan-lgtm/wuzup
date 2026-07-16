import assert from 'node:assert/strict'
import test from 'node:test'

const planner = await import('../app/src/planner-core.js').catch(() => ({}))
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength

test('creates an empty versioned atomic planner document', () => {
  assert.equal(typeof planner.emptyPlannerDocument, 'function')
  assert.deepEqual(planner.emptyPlannerDocument(), {
    v: 2,
    rev: 0,
    active: {},
    history: [],
    cells: {},
  })
})

test('builds a retained slot reference from stable and legacy identity evidence', () => {
  const item = {
    id: 'aaaaaaaaaaaaaaaa',
    title: 'Night market',
    start: '2026-07-20T19:00:00-04:00',
    identityAliases: ['old-market|2026-07-20'],
    _computedRank: 99,
    oversizedInternalPayload: { shouldNotPersist: true },
  }

  const ref = planner.slotRefOf(item)

  assert.deepEqual(ref, {
    kind: 'event',
    primary: 'e|aaaaaaaaaaaaaaaa',
    aliases: [
      'e|aaaaaaaaaaaaaaaa',
      'Night market|2026-07-20T19:00:00-04:00',
      'old-market|2026-07-20',
    ],
    snapshot: {
      id: 'aaaaaaaaaaaaaaaa',
      title: 'Night market',
      start: '2026-07-20T19:00:00-04:00',
    },
  })
  assert.notEqual(ref.snapshot, item)
  assert.equal('_computedRank' in ref.snapshot, false)
  assert.equal('oversizedInternalPayload' in ref.snapshot, false)
})

test('plannedAt is retained only from a deterministic caller-injected timestamp', () => {
  const item = {
    id: 'aaaaaaaaaaaaaaa0',
    title: 'Timestamped',
    start: '2026-07-22T19:00:00-04:00',
  }
  const injected = planner.slotRefOf(item, { plannedAt: 123456 })
  const omitted = planner.slotRefOf(item)

  assert.equal(injected.plannedAt, 123456)
  assert.equal('plannedAt' in omitted, false)
})

test('retained snapshots are cycle-safe and capped by exact serialized UTF-8 bytes', () => {
  const hours = { monday: ['09:00', '17:00'] }
  hours.self = hours
  const shared = { label: 'shared' }
  const item = {
    primary: 'e|bounded-snapshot',
    aliases: ['e|bounded-snapshot', 'legacy|bounded'],
    title: 'Bounded 😀 snapshot',
    start: '2026-07-22T19:00:00-04:00',
    status: 'scheduled',
    tags: Array.from({ length: 100_000 }, (_, index) => `tag-${index}`),
    description: '😀\\"'.repeat(700_000),
    hours,
    sources: [shared, shared, { nested: { deeper: { beyond: { ignored: true } } } }],
  }

  let ref
  assert.doesNotThrow(() => {
    ref = planner.slotRefOf(item)
  })

  assert.ok(ref)
  assert.equal(ref.snapshot.title, item.title)
  assert.equal(ref.snapshot.start, item.start)
  assert.equal(ref.snapshot.status, 'scheduled')
  assert.ok(jsonBytes(ref.snapshot) <= planner.PLANNER_SNAPSHOT_MAX_BYTES)
  assert.ok(ref.snapshot.tags.length <= planner.PLANNER_SNAPSHOT_MAX_ARRAY_ITEMS)
  assert.equal(ref.snapshot.description, undefined)
  assert.equal(ref.snapshot.hours.self, undefined)
  assert.equal(ref.snapshot.sources[2].nested.deeper.beyond, undefined)
})

test('retained aliases are bounded without truncating identity strings', () => {
  const overlong = `legacy|${'😀'.repeat(1_100)}`
  const aliases = [
    'e|bounded-aliases',
    'legacy|one',
    'legacy|one',
    overlong,
    ...Array.from({ length: 100 }, (_, index) => `legacy|${index + 2}`),
  ]
  const ref = planner.slotRefOf({
    primary: 'e|bounded-aliases',
    aliases,
    title: 'Alias bounds',
  })

  assert.ok(ref)
  assert.equal(ref.aliases[0], 'e|bounded-aliases')
  assert.ok(ref.aliases.length <= planner.PLANNER_ALIAS_MAX_COUNT)
  assert.ok(jsonBytes(ref.aliases) <= planner.PLANNER_ALIASES_MAX_BYTES)
  assert.equal(ref.aliases.includes(overlong), false)
  assert.equal(ref.aliases.some((alias) => alias.endsWith('😀')), false)
})

test('live-item alias collection touches at most the bounded candidate prefix', () => {
  let highestIndexRead = -1
  const retained = new Proxy(
    Array.from({ length: 200 }, (_, index) => `legacy|proxy-${index}`),
    {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          const index = Number(property)
          highestIndexRead = Math.max(highestIndexRead, index)
          if (index >= planner.PLANNER_ALIAS_SCAN_MAX) {
            throw new Error(`read alias index ${index} beyond planner cap`)
          }
        }
        return Reflect.get(target, property, receiver)
      },
    }
  )

  let ref
  assert.doesNotThrow(() => {
    ref = planner.slotRefOf({
      id: 'abababababababab',
      title: 'Lazy aliases',
      start: '2026-07-22T19:00:00-04:00',
      identityAliases: retained,
    })
  })

  assert.ok(ref)
  assert.ok(highestIndexRead < planner.PLANNER_ALIAS_SCAN_MAX)
  assert.ok(ref.aliases.length <= planner.PLANNER_ALIAS_MAX_COUNT)
})

test('overbudget primaries fail closed and persisted references are bounded again', () => {
  const overlongPrimary = `e|${'x'.repeat(planner.PLANNER_ALIAS_MAX_BYTES + 1)}`
  assert.equal(planner.slotRefOf({ primary: overlongPrimary, aliases: [], title: 'Nope' }), null)

  const malicious = {
    v: 2,
    rev: 1,
    active: {
      1000: {
        state: null,
        done: false,
        slots: {
          morning: {
            kind: 'event',
            primary: 'e|persisted-bounds',
            aliases: Array.from({ length: 100 }, (_, index) => `legacy|${index}`),
            snapshot: {
              title: 'Persisted',
              description: 'z'.repeat(2_000_000),
              tags: Array.from({ length: 100_000 }, (_, index) => `tag-${index}`),
            },
          },
          afternoon: null,
          night: null,
        },
      },
    },
    history: [],
  }
  let normalized
  assert.doesNotThrow(() => {
    normalized = planner.normalizePlannerDocument(malicious)
  })
  const ref = normalized.active['1000'].slots.morning

  assert.ok(jsonBytes(ref.snapshot) <= planner.PLANNER_SNAPSHOT_MAX_BYTES)
  assert.ok(ref.aliases.length <= planner.PLANNER_ALIAS_MAX_COUNT)
  assert.ok(jsonBytes(ref.aliases) <= planner.PLANNER_ALIASES_MAX_BYTES)
})

test('normalizes corrupt V2 data into a safe retained-reference document', () => {
  const ref = planner.slotRefOf({
    id: 'bbbbbbbbbbbbbbbb',
    title: 'Park concert',
    start: '2026-07-21T18:00:00-04:00',
  })
  const raw = {
    v: 2,
    rev: -4,
    active: {
      1000: {
        done: true,
        state: 'rest',
        slots: { morning: ref, afternoon: { primary: '|' }, night: null, bonus: ref },
      },
      nope: { state: 'rest', slots: {} },
      2000: { done: true, state: null, slots: {} },
      3000: { done: false, state: null, slots: {} },
    },
    history: [
      { dayTs: 500, done: true, state: null, slots: { morning: ref, afternoon: null, night: null } },
      { dayTs: 'bad', state: 'rest', slots: {} },
      { dayTs: 600, done: true, state: null, slots: {} },
      { dayTs: 700, done: false, state: null, slots: {} },
    ],
  }

  const normalized = planner.normalizePlannerDocument(raw)

  assert.equal(normalized.rev, 0)
  assert.deepEqual(Object.keys(normalized.active), ['1000', '2000'])
  assert.equal(normalized.active['1000'].state, null)
  assert.equal(normalized.active['1000'].done, true)
  assert.deepEqual(normalized.active['1000'].slots.morning, ref)
  assert.equal(normalized.active['1000'].slots.afternoon, null)
  assert.equal(normalized.active['1000'].slots.night, null)
  assert.deepEqual(normalized.active['2000'], {
    done: true,
    state: null,
    slots: { morning: null, afternoon: null, night: null },
  })
  assert.deepEqual(normalized.history, [
    {
      dayTs: 500,
      done: true,
      state: null,
      slots: { morning: ref, afternoon: null, night: null },
    },
    {
      dayTs: 600,
      done: true,
      state: null,
      slots: { morning: null, afternoon: null, night: null },
    },
  ])
  assert.notEqual(normalized.active['1000'].slots.morning, ref)
})

test('a wrong planner version fails closed to an empty V2 document', () => {
  assert.deepEqual(
    planner.normalizePlannerDocument({ v: 1, rev: 50, active: { 1000: {} } }),
    planner.emptyPlannerDocument()
  )
})

const event = (id, title, aliases = []) => ({
  id,
  title,
  start: '2026-07-22T19:00:00-04:00',
  identityAliases: aliases,
})

test('adds only to the requested slot and retains an undo receipt', () => {
  const item = event('cccccccccccccccc', 'Jazz outside')
  const result = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item,
    plannedAt: 654321,
  })

  assert.equal(result.code, 'added')
  assert.equal(result.changed, true)
  assert.equal(result.document.rev, 1)
  assert.equal(result.document.active['1000'].slots.morning, null)
  assert.equal(result.document.active['1000'].slots.afternoon, null)
  assert.deepEqual(result.document.active['1000'].slots.night, planner.slotRefOf(item, { plannedAt: 654321 }))
  assert.equal(result.undo.kind, 'planner-undo')
})

test('an occupied exact slot never falls back to another daypart', () => {
  const first = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('dddddddddddddddd', 'First'),
  })
  const second = planner.addPlannerItem(first.document, {
    dayTs: 1000,
    part: 'night',
    item: event('eeeeeeeeeeeeeeee', 'Second'),
  })

  assert.equal(second.code, 'slot-occupied')
  assert.equal(second.changed, false)
  assert.equal(second.document.rev, 1)
  assert.equal(second.document.active['1000'].slots.morning, null)
  assert.equal(second.document.active['1000'].slots.afternoon, null)
  assert.equal(second.document.active['1000'].slots.night.primary, 'e|dddddddddddddddd')
})

test('duplicate identity aliases are rejected across all active slots', () => {
  const legacy = 'https://fixture.test/show|2026-07-22T19:00:00-04:00'
  const first = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('ffffffffffffffff', 'Prior title', [legacy]),
  })
  const duplicate = planner.addPlannerItem(first.document, {
    dayTs: 2000,
    part: 'morning',
    item: event('1111111111111111', 'Enriched title', [legacy]),
  })

  assert.equal(duplicate.code, 'duplicate')
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.document.rev, first.document.rev)
  assert.deepEqual(Object.keys(duplicate.document.active), ['1000'])
})

test('rest and planned slots conflict without changing the revision', () => {
  const resting = planner.setPlannerRest(planner.emptyPlannerDocument(), { dayTs: 1000, rest: true })
  assert.equal(resting.code, 'rest-set')
  assert.equal(resting.document.rev, 1)

  const blockedAdd = planner.addPlannerItem(resting.document, {
    dayTs: 1000,
    part: 'afternoon',
    item: event('2222222222222222', 'Blocked'),
  })
  assert.equal(blockedAdd.code, 'rest-conflict')
  assert.equal(blockedAdd.document.rev, 1)

  const planned = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 2000,
    part: 'morning',
    item: event('3333333333333333', 'Planned'),
  })
  const blockedRest = planner.setPlannerRest(planned.document, { dayTs: 2000, rest: true })
  assert.equal(blockedRest.code, 'slot-conflict')
  assert.equal(blockedRest.document.rev, 1)
})

test('repeating a rest state is an idempotent no-op', () => {
  const first = planner.setPlannerRest(planner.emptyPlannerDocument(), { dayTs: 1000, rest: true })
  const second = planner.setPlannerRest(first.document, { dayTs: 1000, rest: true })
  const cleared = planner.setPlannerRest(first.document, { dayTs: 1000, rest: false })
  const clearedAgain = planner.setPlannerRest(cleared.document, { dayTs: 1000, rest: false })

  assert.equal(second.code, 'already-resting')
  assert.equal(second.changed, false)
  assert.equal(second.document.rev, 1)
  assert.equal(cleared.code, 'rest-cleared')
  assert.equal(cleared.document.rev, 2)
  assert.equal(clearedAgain.code, 'already-active')
  assert.equal(clearedAgain.document.rev, 2)
})

test('moves the expected item atomically between exact slots', () => {
  const item = event('4444444444444444', 'Move me')
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item,
  })
  const moved = planner.movePlannerItem(added.document, {
    fromDayTs: 1000,
    fromPart: 'night',
    toDayTs: 2000,
    toPart: 'morning',
    expectedPrimary: 'e|4444444444444444',
  })

  assert.equal(moved.code, 'moved')
  assert.equal(moved.changed, true)
  assert.equal(moved.document.rev, 2)
  assert.equal(moved.document.active['1000'], undefined)
  assert.equal(moved.document.active['2000'].slots.morning.primary, 'e|4444444444444444')
  assert.deepEqual(moved.undo, {
    kind: 'planner-undo',
    operation: 'move',
    fromDayTs: 2000,
    fromPart: 'morning',
    toDayTs: 1000,
    toPart: 'night',
    expectedPrimary: 'e|4444444444444444',
    expectedFromToken: 2,
    expectedToToken: 2,
  })
})

test('a stale move expectation or occupied target leaves both slots untouched', () => {
  const source = event('5555555555555555', 'Source')
  const target = event('6666666666666666', 'Target')
  let doc = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: source,
  }).document
  doc = planner.addPlannerItem(doc, { dayTs: 2000, part: 'morning', item: target }).document

  const stale = planner.movePlannerItem(doc, {
    fromDayTs: 1000,
    fromPart: 'night',
    toDayTs: 3000,
    toPart: 'afternoon',
    expectedPrimary: 'e|7777777777777777',
  })
  assert.equal(stale.code, 'item-conflict')
  assert.equal(stale.document.rev, 2)

  const occupied = planner.movePlannerItem(doc, {
    fromDayTs: 1000,
    fromPart: 'night',
    toDayTs: 2000,
    toPart: 'morning',
    expectedPrimary: 'e|5555555555555555',
  })
  assert.equal(occupied.code, 'slot-occupied')
  assert.equal(occupied.document.rev, 2)
  assert.equal(occupied.document.active['1000'].slots.night.primary, 'e|5555555555555555')
  assert.equal(occupied.document.active['2000'].slots.morning.primary, 'e|6666666666666666')
})

test('moving to a resting day or the same slot is a no-op', () => {
  const item = event('7777777777777777', 'Still here')
  let doc = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item,
  }).document
  doc = planner.setPlannerRest(doc, { dayTs: 2000, rest: true }).document

  const resting = planner.movePlannerItem(doc, {
    fromDayTs: 1000,
    fromPart: 'night',
    toDayTs: 2000,
    toPart: 'night',
    expectedPrimary: 'e|7777777777777777',
  })
  assert.equal(resting.code, 'rest-conflict')
  assert.equal(resting.document.rev, 2)

  const same = planner.movePlannerItem(doc, {
    fromDayTs: 1000,
    fromPart: 'night',
    toDayTs: 1000,
    toPart: 'night',
    expectedPrimary: 'e|7777777777777777',
  })
  assert.equal(same.code, 'already-there')
  assert.equal(same.document.rev, 2)
})

test('removes only the expected item and retains the removed snapshot for undo', () => {
  const item = event('8888888888888888', 'Remove me')
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'afternoon',
    item,
  })
  const stale = planner.removePlannerItem(added.document, {
    dayTs: 1000,
    part: 'afternoon',
    expectedPrimary: 'e|9999999999999999',
  })
  assert.equal(stale.code, 'item-conflict')
  assert.equal(stale.document.rev, 1)

  const removed = planner.removePlannerItem(added.document, {
    dayTs: 1000,
    part: 'afternoon',
    expectedPrimary: 'e|8888888888888888',
  })
  assert.equal(removed.code, 'removed')
  assert.equal(removed.changed, true)
  assert.equal(removed.document.rev, 2)
  assert.deepEqual(removed.document.active, {})
  assert.deepEqual(removed.undo.restore, planner.slotRefOf(item))
})

test('undo compares the affected slot and never overwrites a newer item', () => {
  const original = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('aaaaaaaaaaaaaaa1', 'Original'),
  })
  const removed = planner.removePlannerItem(original.document, {
    dayTs: 1000,
    part: 'night',
    expectedPrimary: 'e|aaaaaaaaaaaaaaa1',
  })
  const replacement = planner.addPlannerItem(removed.document, {
    dayTs: 1000,
    part: 'night',
    item: event('aaaaaaaaaaaaaaa2', 'Replacement'),
  })

  const staleUndo = planner.applyPlannerUndo(replacement.document, original.undo)

  assert.equal(staleUndo.code, 'undo-conflict')
  assert.equal(staleUndo.changed, false)
  assert.equal(staleUndo.document.rev, 3)
  assert.equal(staleUndo.document.active['1000'].slots.night.primary, 'e|aaaaaaaaaaaaaaa2')
})

test('an old add undo cannot delete a same-primary item re-added later', () => {
  const item = event('aaaaaaaaaaaaaaa3', 'Same primary')
  const first = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item,
    plannedAt: 1,
  })
  const removed = planner.removePlannerItem(first.document, {
    dayTs: 1000,
    part: 'night',
    expectedPrimary: 'e|aaaaaaaaaaaaaaa3',
  })
  const readded = planner.addPlannerItem(removed.document, {
    dayTs: 1000,
    part: 'night',
    item: { ...item, title: 'Same primary, enriched' },
    plannedAt: 2,
  })

  const staleUndo = planner.applyPlannerUndo(readded.document, first.undo)

  assert.equal(staleUndo.code, 'undo-conflict')
  assert.equal(staleUndo.document.active['1000'].slots.night.plannedAt, 2)
  assert.equal(staleUndo.document.active['1000'].slots.night.snapshot.title, 'Same primary, enriched')
})

test('an old remove undo cannot resurrect into an empty slot changed in between', () => {
  const original = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('aaaaaaaaaaaaaaa4', 'Original removal'),
  })
  const removed = planner.removePlannerItem(original.document, {
    dayTs: 1000,
    part: 'night',
    expectedPrimary: 'e|aaaaaaaaaaaaaaa4',
  })
  const intervening = planner.addPlannerItem(removed.document, {
    dayTs: 1000,
    part: 'night',
    item: event('aaaaaaaaaaaaaaa5', 'Intervening'),
  })
  const emptyAgain = planner.removePlannerItem(intervening.document, {
    dayTs: 1000,
    part: 'night',
    expectedPrimary: 'e|aaaaaaaaaaaaaaa5',
  })

  const staleUndo = planner.applyPlannerUndo(emptyAgain.document, removed.undo)

  assert.equal(staleUndo.code, 'undo-conflict')
  assert.equal(staleUndo.document.active['1000'], undefined)
})

test('an old rest undo cannot clear a newer identical rest state', () => {
  const first = planner.setPlannerRest(planner.emptyPlannerDocument(), { dayTs: 1000, rest: true })
  const cleared = planner.setPlannerRest(first.document, { dayTs: 1000, rest: false })
  const reset = planner.setPlannerRest(cleared.document, { dayTs: 1000, rest: true })

  const staleUndo = planner.applyPlannerUndo(reset.document, first.undo)

  assert.equal(staleUndo.code, 'undo-conflict')
  assert.equal(staleUndo.document.active['1000'].state, 'rest')
})

test('an old move undo cannot reverse a newer move-away and back ABA cycle', () => {
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'morning',
    item: event('aaaaaaaaaaaaaaa6', 'Move ABA'),
  })
  const firstMove = planner.movePlannerItem(added.document, {
    fromDayTs: 1000,
    fromPart: 'morning',
    toDayTs: 2000,
    toPart: 'night',
    expectedPrimary: 'e|aaaaaaaaaaaaaaa6',
  })
  const movedBack = planner.movePlannerItem(firstMove.document, {
    fromDayTs: 2000,
    fromPart: 'night',
    toDayTs: 1000,
    toPart: 'morning',
    expectedPrimary: 'e|aaaaaaaaaaaaaaa6',
  })
  const movedAwayAgain = planner.movePlannerItem(movedBack.document, {
    fromDayTs: 1000,
    fromPart: 'morning',
    toDayTs: 2000,
    toPart: 'night',
    expectedPrimary: 'e|aaaaaaaaaaaaaaa6',
  })

  const staleUndo = planner.applyPlannerUndo(movedAwayAgain.document, firstMove.undo)

  assert.equal(staleUndo.code, 'undo-conflict')
  assert.equal(staleUndo.document.active['2000'].slots.night.primary, 'e|aaaaaaaaaaaaaaa6')
})

test('undo succeeds after unrelated changes and is itself idempotent', () => {
  const first = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('bbbbbbbbbbbbbbb1', 'Undo me'),
  })
  const unrelated = planner.addPlannerItem(first.document, {
    dayTs: 2000,
    part: 'morning',
    item: event('bbbbbbbbbbbbbbb2', 'Keep me'),
  })

  const undone = planner.applyPlannerUndo(unrelated.document, first.undo)
  const replay = planner.applyPlannerUndo(undone.document, first.undo)

  assert.equal(undone.code, 'undone')
  assert.equal(undone.changed, true)
  assert.equal(undone.document.rev, 3)
  assert.equal(undone.document.active['1000'], undefined)
  assert.equal(undone.document.active['2000'].slots.morning.primary, 'e|bbbbbbbbbbbbbbb2')
  assert.equal(replay.code, 'undo-conflict')
  assert.equal(replay.document.rev, 3)
})

test('remove, move, and rest receipts restore only their compared prior state', () => {
  const item = event('ccccccccccccccc1', 'Round trip')
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'afternoon',
    item,
  })
  const removed = planner.removePlannerItem(added.document, {
    dayTs: 1000,
    part: 'afternoon',
    expectedPrimary: 'e|ccccccccccccccc1',
  })
  const removeUndone = planner.applyPlannerUndo(removed.document, removed.undo)
  assert.equal(removeUndone.code, 'undone')
  assert.deepEqual(removeUndone.document.active['1000'].slots.afternoon, planner.slotRefOf(item))

  const moved = planner.movePlannerItem(removeUndone.document, {
    fromDayTs: 1000,
    fromPart: 'afternoon',
    toDayTs: 2000,
    toPart: 'night',
    expectedPrimary: 'e|ccccccccccccccc1',
  })
  const moveUndone = planner.applyPlannerUndo(moved.document, moved.undo)
  assert.equal(moveUndone.code, 'undone')
  assert.equal(moveUndone.document.active['1000'].slots.afternoon.primary, 'e|ccccccccccccccc1')
  assert.equal(moveUndone.document.active['2000'], undefined)

  const resting = planner.setPlannerRest(moveUndone.document, { dayTs: 3000, rest: true })
  const restUndone = planner.applyPlannerUndo(resting.document, resting.undo)
  assert.equal(restUndone.code, 'undone')
  assert.equal(restUndone.document.active['3000'], undefined)
})

test('same-day move preserves the day done marker', () => {
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'morning',
    item: event('ccccccccccccccc2', 'Completed day'),
  })
  const done = planner.normalizePlannerDocument({
    ...added.document,
    active: { 1000: { ...added.document.active['1000'], done: true } },
  })

  const moved = planner.movePlannerItem(done, {
    fromDayTs: 1000,
    fromPart: 'morning',
    toDayTs: 1000,
    toPart: 'night',
    expectedPrimary: 'e|ccccccccccccccc2',
  })

  assert.equal(moved.code, 'moved')
  assert.equal(moved.document.active['1000'].done, true)
})

test('remove undo restores the prior day done marker', () => {
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('ccccccccccccccc3', 'Restore completed day'),
  })
  const done = planner.normalizePlannerDocument({
    ...added.document,
    active: { 1000: { ...added.document.active['1000'], done: true } },
  })
  const removed = planner.removePlannerItem(done, {
    dayTs: 1000,
    part: 'night',
    expectedPrimary: 'e|ccccccccccccccc3',
  })

  assert.deepEqual(removed.document.active['1000'], {
    state: null,
    slots: { morning: null, afternoon: null, night: null },
    done: true,
  })
  const undone = planner.applyPlannerUndo(removed.document, removed.undo)
  assert.equal(undone.code, 'undone')
  assert.equal(undone.document.active['1000'].done, true)
})

test('cross-day move undo restores the source day done marker', () => {
  const item = event('ccccccccccccccc2', 'Move done day')
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'afternoon',
    item,
  })
  const done = planner.normalizePlannerDocument({
    ...added.document,
    active: { 1000: { ...added.document.active['1000'], done: true } },
  })
  const moved = planner.movePlannerItem(done, {
    fromDayTs: 1000,
    fromPart: 'afternoon',
    toDayTs: 2000,
    toPart: 'night',
    expectedPrimary: 'e|ccccccccccccccc2',
  })
  const undone = planner.applyPlannerUndo(moved.document, moved.undo)

  assert.equal(undone.code, 'undone')
  assert.equal(undone.document.active['1000'].done, true)
  assert.equal(undone.document.active['2000'], undefined)
})

test('add undo removes only its item and preserves a newer done marker', () => {
  const added = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('ccccccccccccccc4', 'Later completed'),
  })
  const marked = planner.normalizePlannerDocument({
    ...added.document,
    active: {
      ...added.document.active,
      1000: { ...added.document.active['1000'], done: true },
    },
  })

  const undone = planner.applyPlannerUndo(marked, added.undo)

  assert.equal(undone.code, 'undone')
  assert.deepEqual(undone.document.active['1000'], {
    state: null,
    slots: { morning: null, afternoon: null, night: null },
    done: true,
  })
})

test('move undo preserves current source and target done markers instead of receipt-time values', () => {
  const firstAdded = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'morning',
    item: event('ccccccccccccccc5', 'Newer true'),
  })
  const firstMoved = planner.movePlannerItem(firstAdded.document, {
    fromDayTs: 1000,
    fromPart: 'morning',
    toDayTs: 2000,
    toPart: 'night',
    expectedPrimary: 'e|ccccccccccccccc5',
  })
  const sourceMarkedLater = planner.normalizePlannerDocument({
    ...firstMoved.document,
    active: {
      ...firstMoved.document.active,
      1000: { state: null, slots: {}, done: true },
    },
  })
  const firstUndone = planner.applyPlannerUndo(sourceMarkedLater, firstMoved.undo)

  assert.equal(firstUndone.document.active['1000'].done, true)
  assert.equal(firstUndone.document.active['1000'].slots.morning.primary, 'e|ccccccccccccccc5')
  assert.equal(firstUndone.document.active['2000'], undefined)

  const secondAdded = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 3000,
    part: 'afternoon',
    item: event('ccccccccccccccc6', 'Newer false'),
  })
  const originallyDone = planner.normalizePlannerDocument({
    ...secondAdded.document,
    active: {
      3000: { ...secondAdded.document.active['3000'], done: true },
    },
  })
  const secondMoved = planner.movePlannerItem(originallyDone, {
    fromDayTs: 3000,
    fromPart: 'afternoon',
    toDayTs: 4000,
    toPart: 'night',
    expectedPrimary: 'e|ccccccccccccccc6',
  })
  const markersChangedLater = planner.normalizePlannerDocument({
    ...secondMoved.document,
    active: {
      4000: { ...secondMoved.document.active['4000'], done: true },
    },
  })
  const secondUndone = planner.applyPlannerUndo(markersChangedLater, secondMoved.undo)

  assert.equal(secondUndone.document.active['3000'].done, false)
  assert.equal(secondUndone.document.active['3000'].slots.afternoon.primary, 'e|ccccccccccccccc6')
  assert.deepEqual(secondUndone.document.active['4000'], {
    state: null,
    slots: { morning: null, afternoon: null, night: null },
    done: true,
  })
})

test('remove undo preserves done markers changed after the removal', () => {
  const firstAdded = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 5000,
    part: 'night',
    item: event('ccccccccccccccc7', 'Remove then finish'),
  })
  const firstRemoved = planner.removePlannerItem(firstAdded.document, {
    dayTs: 5000,
    part: 'night',
    expectedPrimary: 'e|ccccccccccccccc7',
  })
  const markedLater = planner.normalizePlannerDocument({
    ...firstRemoved.document,
    active: {
      5000: { state: null, slots: {}, done: true },
    },
  })
  const firstUndone = planner.applyPlannerUndo(markedLater, firstRemoved.undo)
  assert.equal(firstUndone.document.active['5000'].done, true)

  const secondAdded = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 6000,
    part: 'night',
    item: event('ccccccccccccccc8', 'Remove then reopen'),
  })
  const originallyDone = planner.normalizePlannerDocument({
    ...secondAdded.document,
    active: {
      6000: { ...secondAdded.document.active['6000'], done: true },
    },
  })
  const secondRemoved = planner.removePlannerItem(originallyDone, {
    dayTs: 6000,
    part: 'night',
    expectedPrimary: 'e|ccccccccccccccc8',
  })
  const clearedLater = planner.normalizePlannerDocument({
    ...secondRemoved.document,
    active: {},
  })
  const secondUndone = planner.applyPlannerUndo(clearedLater, secondRemoved.undo)
  assert.equal(secondUndone.document.active['6000'].done, false)
})

test('rest transitions and their undo receipts preserve the current done marker', () => {
  const doneOnly = planner.normalizePlannerDocument({
    v: 2,
    rev: 0,
    active: {
      7000: { state: null, slots: {}, done: true },
    },
    history: [],
  })
  const resting = planner.setPlannerRest(doneOnly, { dayTs: 7000, rest: true })
  assert.equal(resting.document.active['7000'].done, true)

  const setUndone = planner.applyPlannerUndo(resting.document, resting.undo)
  assert.deepEqual(setUndone.document.active['7000'], {
    state: null,
    slots: { morning: null, afternoon: null, night: null },
    done: true,
  })

  const restingAgain = planner.setPlannerRest(setUndone.document, { dayTs: 7000, rest: true })
  const cleared = planner.setPlannerRest(restingAgain.document, { dayTs: 7000, rest: false })
  assert.equal(cleared.document.active['7000'].done, true)
  const clearUndone = planner.applyPlannerUndo(cleared.document, cleared.undo)
  assert.equal(clearUndone.document.active['7000'].state, 'rest')
  assert.equal(clearUndone.document.active['7000'].done, true)
})

test('rollover archives a done-only day exactly once', () => {
  const doneOnly = planner.normalizePlannerDocument({
    v: 2,
    rev: 4,
    active: {
      1000: { state: null, slots: {}, done: true },
    },
    history: [],
  })
  const rolled = planner.rolloverPlanner(doneOnly, { todayTs: 2000 })
  const repeated = planner.rolloverPlanner(rolled.document, { todayTs: 2000 })

  assert.equal(rolled.code, 'rolled-over')
  assert.deepEqual(rolled.document.history, [{
    dayTs: 1000,
    state: null,
    slots: { morning: null, afternoon: null, night: null },
    done: true,
  }])
  assert.equal(repeated.code, 'nothing-to-rollover')
  assert.deepEqual(repeated.document.history, rolled.document.history)
})

test('rollover moves every past active day to retained history in one revision', () => {
  let doc = planner.addPlannerItem(planner.emptyPlannerDocument(), {
    dayTs: 1000,
    part: 'night',
    item: event('ddddddddddddddd1', 'Past plan'),
    plannedAt: 777,
  }).document
  doc = planner.setPlannerRest(doc, { dayTs: 2000, rest: true }).document
  doc = planner.addPlannerItem(doc, {
    dayTs: 3000,
    part: 'morning',
    item: event('ddddddddddddddd2', 'Future plan'),
  }).document
  doc = planner.normalizePlannerDocument({
    ...doc,
    active: {
      ...doc.active,
      1000: { ...doc.active['1000'], done: true },
    },
  })

  const rolled = planner.rolloverPlanner(doc, { todayTs: 2500 })

  assert.equal(rolled.code, 'rolled-over')
  assert.equal(rolled.changed, true)
  assert.equal(rolled.document.rev, 4)
  assert.deepEqual(Object.keys(rolled.document.active), ['3000'])
  assert.deepEqual(rolled.document.history.map((row) => row.dayTs), [1000, 2000])
  assert.equal(rolled.document.history[0].slots.night.primary, 'e|ddddddddddddddd1')
  assert.equal(rolled.document.history[0].slots.night.plannedAt, 777)
  assert.equal(rolled.document.history[0].done, true)
  assert.equal(rolled.document.history[1].state, 'rest')
})

test('rollover is first-write-wins by day and caps history to the newest rows', () => {
  const original = planner.slotRefOf(event('eeeeeeeeeeeeeee1', 'Already archived'))
  let doc = planner.normalizePlannerDocument({
    v: 2,
    rev: 7,
    active: {
      1000: { state: 'rest', slots: {} },
      2000: { state: 'rest', slots: {} },
      3000: { state: 'rest', slots: {} },
    },
    history: [{
      dayTs: 1000,
      state: null,
      slots: { morning: original, afternoon: null, night: null },
    }],
  })

  const rolled = planner.rolloverPlanner(doc, { todayTs: 4000, historyCap: 2 })

  assert.equal(rolled.document.rev, 8)
  assert.deepEqual(rolled.document.history.map((row) => row.dayTs), [2000, 3000])
  assert.deepEqual(rolled.document.active, {})
})

test('rollover with no past day is an idempotent no-op', () => {
  const doc = planner.setPlannerRest(planner.emptyPlannerDocument(), { dayTs: 3000, rest: true }).document
  const first = planner.rolloverPlanner(doc, { todayTs: 3000 })
  const second = planner.rolloverPlanner(first.document, { todayTs: 3000 })

  assert.equal(first.code, 'nothing-to-rollover')
  assert.equal(first.changed, false)
  assert.equal(first.document.rev, 1)
  assert.deepEqual(second, first)
})
