import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../app/src/HotView.jsx', import.meta.url), 'utf8')
const helperStart = source.indexOf('function eventsFirstValue(')
const helperBodyStart = source.indexOf(') {', helperStart) + 2
let helperEnd = -1
let helperDepth = 0
for (let i = helperBodyStart; i < source.length; i++) {
  if (source[i] === '{') helperDepth += 1
  if (source[i] === '}' && --helperDepth === 0) {
    helperEnd = i + 1
    break
  }
}
const helperSource = source.slice(helperStart, helperEnd)
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'HotView must define its first-value runtime model')
const context = vm.createContext({ Object, Array })
vm.runInContext(`${helperSource}\nthis.eventsFirstValue = eventsFirstValue`, context)
const { eventsFirstValue } = context

const item = (id) => Object.freeze({ id, title: id })

test('zero-Tonight runtime selects the first actual ranked shelf before tuning', () => {
  const rankedUpcoming = [item('first'), item('second'), item('third'), item('fourth')]
  const planning = eventsFirstValue({
    tonightItems: [],
    planningItems: [item('plan-1'), item('plan-2')],
    weekendDays: [{ evs: [item('weekend')] }],
    rankedUpcoming,
    tuneSamples: rankedUpcoming.slice(0, 2),
  })
  assert.equal(planning.kind, 'planning')
  assert.equal(planning.canTune, true)

  const weekend = eventsFirstValue({
    weekendDays: [{ evs: [item('weekend')] }],
    rankedUpcoming,
    tuneSamples: rankedUpcoming.slice(0, 2),
  })
  assert.equal(weekend.kind, 'weekend')

  const upcoming = eventsFirstValue({
    rankedUpcoming,
    tuneSamples: rankedUpcoming.slice(0, 2),
  })
  assert.equal(upcoming.kind, 'upcoming')

  const withTonight = eventsFirstValue({
    tonightItems: [item('tonight')],
    rankedUpcoming,
    tuneSamples: rankedUpcoming.slice(0, 2),
  })
  assert.equal(withTonight.kind, 'tonight')
})

test('zero inventory cannot produce a sampleless tuner ahead of empty or error truth', () => {
  const empty = eventsFirstValue()
  assert.equal(empty.kind, 'empty')
  assert.equal(empty.canTune, false)
  assert.equal(eventsFirstValue({
    rankedUpcoming: [item('future')],
    tuneSamples: [],
  }).canTune, false)
})

test('Events source renders the deterministic lead before its guarded tuner', () => {
  const tonightLead = source.indexOf("firstValue.kind === 'tonight'")
  const planningLead = source.indexOf("firstValue.kind === 'planning'")
  const weekendLead = source.indexOf("firstValue.kind === 'weekend'")
  const upcomingLead = source.indexOf("firstValue.kind === 'upcoming'")
  const tuner = source.indexOf('firstValue.canTune && <TasteTuner')
  const empty = source.indexOf('!loading && !loadError && upcoming.length === 0')

  assert.ok(tonightLead >= 0 && planningLead > tonightLead)
  assert.ok(weekendLead > planningLead && upcomingLead > weekendLead)
  assert.ok(tuner > upcomingLead, 'the tuner must follow every first-value lead')
  assert.ok(empty > tuner, 'the successful-empty state remains reachable after the guarded tuner slot')
  assert.match(source, /rankedUpcomingLead[\s\S]*sharedEventOrder\(upcoming, \{ nowMs, taste \}\)/)
  assert.doesNotMatch(source, /^\s*<TasteTuner kind="events"/m)
})
