import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const APP_SRC = new URL('../app/src/', import.meta.url)
const source = (file) => readFileSync(new URL(file, APP_SRC), 'utf8')
const withoutComments = (value) => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const CUTOVER_SURFACES = [
  'cards.jsx',
  'AddEvent.jsx',
  'GuidePage.jsx',
  'DetailPage.jsx',
  'PlaceDetail.jsx',
  'DayPage.jsx',
  'CalendarView.jsx',
  'NextDays.jsx',
  'ProfileView.jsx',
  'MyPlansPage.jsx',
]

const V1_PLANNER_CALL = /\b(?:loadDayPlans|saveDayPlans|loadDayHistory|saveDayHistory|dayEntryFor|plannedItemKeys|findPlannedItem|planItem|withSlot|withClearedSlot|withRest)\s*\(/
const V1_PLANNER_KEY = /\b(?:day-plans-v1|day-history-v1|weekend-plan-v1)\b/

function plannerBindings(file) {
  const value = withoutComments(source(file))
  const match = value.match(/const\s*\{([\s\S]*?)\}\s*=\s*usePlanner\(\)/)
  assert.ok(match, `${file} must read the reactive PlannerProvider contract`)
  return match[1]
}

test('App owns one planner provider around every planner entry surface', () => {
  const app = withoutComments(source('App.jsx'))
  assert.match(app, /import\s+\{\s*PlannerProvider\s*\}\s+from\s+'\.\/PlannerProvider\.jsx'/)
  const providerTag = app.match(/<PlannerProvider\b[\s\S]*?>/)?.[0]
  assert.ok(providerTag, 'App must mount PlannerProvider')
  assert.match(providerTag, /anchors=\{anchors\}/)
  assert.match(providerTag, /events=\{normalized\}/)
  assert.match(providerTag, /artifactStatus=\{eventArtifact\.status\}/)
  assert.ok(
    app.indexOf('<PlannerProvider') < app.indexOf('<WxContext.Provider')
      && app.lastIndexOf('</PlannerProvider>') > app.indexOf('<DetailPage'),
    'provider must enclose tabs, subpages, cards, and both detail planners',
  )
  assert.match(app, /<ProfileView\s*\/>/)
})

test('the atomic cutover leaves no V1 reader, writer, or physical key in any planner surface', () => {
  for (const file of CUTOVER_SURFACES) {
    const value = withoutComments(source(file))
    assert.doesNotMatch(value, V1_PLANNER_CALL, `${file} must not call a V1 planner API`)
    assert.doesNotMatch(value, V1_PLANNER_KEY, `${file} must not reach a V1 planner key`)
  }
})

test('cards, custom-event creation, and guides are planner doorways instead of silent writers', () => {
  const cards = withoutComments(source('cards.jsx'))
  assert.match(cards, /const\s*\{\s*openDay,\s*openDetail\s*\}\s*=\s*useNav\(\)/)
  assert.match(cards, /const\s*\{\s*isPlanned,\s*placement\s*\}\s*=\s*usePlanner\(\)/)
  assert.match(cards, /if\s*\(planned && plannedPlacement\)\s*openDay\(plannedPlacement\.dayTs\)/)
  assert.match(cards, /else\s*openDetail\(e\)/)
  assert.doesNotMatch(cards, /const\s*\{[^}]*\badd\b[^}]*\}\s*=\s*usePlanner\(\)/)

  const addEvent = withoutComments(source('AddEvent.jsx'))
  assert.doesNotMatch(addEvent, /PlannerProvider|usePlanner/)
  assert.match(addEvent, /const added = editing \? await onUpdate\(editEvent, raw\) : await onAdd\(raw\)/)
  assert.match(addEvent, /if \(added\?\.changed !== true\)/)
  assert.doesNotMatch(addEvent, /\b(?:add|move|remove|setRest)\s*\(\s*raw/)

  const guide = withoutComments(source('GuidePage.jsx'))
  assert.doesNotMatch(guide, /PlannerProvider|usePlanner/)
  assert.match(guide, /const planDay = \(\) => openDay\(Math\.max\(anchors\.todayTs,\s*anchors\.wkStartTs\)\)/)
  assert.match(guide, /onClick=\{planDay\}/)
  assert.doesNotMatch(guide, /\b(?:add|move|remove|setRest)\s*\(/)
})

test('event and place details require visible exact placement and expose planned state', () => {
  for (const file of ['DetailPage.jsx', 'PlaceDetail.jsx']) {
    const value = withoutComments(source(file))
    const bindings = plannerBindings(file)
    for (const binding of ['add', 'getDay', 'isPlanned', 'placement']) {
      assert.match(bindings, new RegExp(`\\b${binding}\\b`), `${file} needs planner.${binding}`)
    }
    assert.match(value, /const planned = isPlanned\(e\)/)
    assert.match(value, /const plannedPlacement = placement\(e\)/)
    assert.match(value, /const day = getDay\(/)
    assert.match(value, /await add\(e,\s*\{\s*dayTs:\s*\w+,\s*part\s*\}\)/)
    assert.match(value, /onClick=\{\(\) => sel && addToPlan\(sel\)\}/)
    assert.match(value, /openDay\(plannedPlacement\.dayTs\)/)
    assert.match(value, />\s*View plan\s*</)
    assert.match(value, /planned && plannedPlacement/)
    assert.match(value, /code === 'slot-occupied'/)
    assert.match(value, /code === 'rest-conflict'/)
    assert.doesNotMatch(value, /add\(e,\s*\{\s*dayTs[^}]*\}\)\s*;\s*add\(/)
  }
})

test('planner detail dialogs block the covered UI, serialize writes, and announce results', () => {
  for (const file of ['DetailPage.jsx', 'PlaceDetail.jsx']) {
    const value = withoutComments(source(file))
    assert.match(value, /role="dialog"/)
    assert.match(value, /aria-modal="true"/)
    assert.match(value, /aria-busy=\{planPending \|\| undefined\}/)
    assert.match(value, /disabled=\{!sel \|\| planPending \|\| planClosing\}/)
    assert.match(value, /planPendingRef\.current = true/)
    assert.match(value, /planPendingRef\.current = false/)
    assert.match(value, /inert=\{planning \|\| planClosing \|\| correcting \? true : undefined\}/)
    assert.match(value, /aria-hidden=\{planning \|\| planClosing \|\| correcting \|\| undefined\}/)
    assert.match(value, /<CorrectionSheet item=\{e\} onClose=\{closeCorrection\} \/>/)
    assert.match(value, /role="status"\s+aria-live="polite"/)
    assert.match(value, /querySelectorAll\('button:not\(:disabled\)'\)/)
  }
})

test('planner terminal states never turn into an enabled false-success detail action', () => {
  for (const file of ['DetailPage.jsx', 'PlaceDetail.jsx']) {
    const value = withoutComments(source(file))
    assert.match(value, /plannerStatus === 'durable' \|\| plannerStatus === 'session-only'/)
    assert.match(value, /plannerStatus === 'idle' \|\| plannerStatus === 'initializing'/)
    assert.match(value, /Loading plans/)
    assert.match(value, /Plans unavailable/)
    assert.match(value, /plannerReady \? \(/)
    assert.match(value, /plannerUnavailableLabel/)
    assert.match(value, /if \(!plannerReady \|\|/)
  }
})

test('day, calendar, next-days, profile, and My Plans read and mutate through the provider', () => {
  const expected = {
    'DayPage.jsx': ['status', 'durability', 'getDay', 'isPlanned', 'add', 'move', 'remove', 'setRest'],
    'CalendarView.jsx': ['activeDays', 'history', 'getDay', 'remove', 'durability'],
    'NextDays.jsx': ['getDay'],
    'ProfileView.jsx': ['filledDayCount'],
    'MyPlansPage.jsx': [
      'status',
      'durability',
      'error',
      'activeDays',
      'history',
      'filledDayCount',
      'getDay',
      'retryPersistence',
    ],
  }
  for (const [file, bindings] of Object.entries(expected)) {
    const actual = plannerBindings(file)
    for (const binding of bindings) {
      assert.match(actual, new RegExp(`\\b${binding}\\b`), `${file} needs planner.${binding}`)
    }
  }

  const day = withoutComments(source('DayPage.jsx'))
  assert.match(day, /const day = getDay\(ts\)/)
  assert.match(day, /await add\(e,\s*\{\s*dayTs:\s*ts,\s*part\s*\}\)/)
  assert.match(day, /await move\(\{\s*\.\.\.slot,\s*dayTs:\s*ts\s*\},\s*\{\s*dayTs:\s*ts,\s*part:\s*to\s*\}\)/)
  assert.match(day, /await remove\(\{\s*\.\.\.slot,\s*dayTs:\s*ts\s*\}\)/)
  assert.match(day, /await setRest\(ts,\s*nextRest\)/)

  const calendar = withoutComments(source('CalendarView.jsx'))
  assert.match(calendar, /const selectedDay = selKey != null \? getDay\(selKey\) : null/)
  assert.match(calendar, /await remove\(\{\s*\.\.\.slot,\s*dayTs\s*\}\)/)

  const nextDays = withoutComments(source('NextDays.jsx'))
  assert.match(nextDays, /const day = getDay\(d\.ts\)/)
  assert.match(nextDays, /const n = day\.slots\.length/)

  const profile = withoutComments(source('ProfileView.jsx'))
  assert.match(profile, /filledDayCount:\s*planCount/)
})

test('My Plans renders current and future active days before its bounded history', () => {
  const plans = withoutComments(source('MyPlansPage.jsx'))
  assert.match(plans, /const upcomingDays = useMemo\(/)
  assert.match(plans, /\(\) => activeDays[\s\S]*?\.map\(\(\{\s*dayTs\s*\}\) => getDay\(dayTs\)\)/)
  assert.match(plans, /\.filter\(\(day\) => day\.state === 'rest' \|\| day\.slots\.length > 0\)/)
  assert.match(plans, />Coming up</)
  assert.match(plans, /\{upcomingDays\.map\(\(day\) => \(/)
  assert.match(plans, /onClick=\{\(\) => openDay\(day\.dayTs\)\}/)
  assert.ok(
    plans.indexOf('>Coming up<') < plans.indexOf('>Past days<'),
    'current/future plans must render before historical days',
  )
  assert.match(plans, /plannerHistory[\s\S]*?\.slice\(0,\s*10\)[\s\S]*?getDay\(dayTs\)/)
})

test('retained, missing, and ambiguous planner references stay visible and labeled', () => {
  for (const file of ['DayPage.jsx', 'CalendarView.jsx', 'MyPlansPage.jsx']) {
    const value = withoutComments(source(file))
    assert.match(value, /resolution === 'missing'/, `${file} must label missing references`)
    assert.match(value, /resolution === 'ambiguous'/, `${file} must label ambiguous references`)
    assert.match(value, /resolution === 'retained'/, `${file} must label retained snapshots`)
    assert.match(value, /[Nn]eeds review/)
    assert.match(value, /[Ss]aved copy/)
  }
  const plans = withoutComments(source('MyPlansPage.jsx'))
  assert.match(plans, /slot\?\.item\?\.title \|\| slot\?\.item\?\.name \|\| 'Saved plan'/)
  assert.match(plans, /no longer listed/)
})

test('planner edge paths stay non-crashing, current-day safe, and retryable', () => {
  const day = withoutComments(source('DayPage.jsx'))
  assert.match(day, /const openable = slot\?\.resolution === 'live' && Boolean\(e\)/)
  assert.match(day, /disabled=\{!openable\}/)
  assert.match(day, /onClick=\{\(ev\) => openable && onSelect\(e,\s*ev\.currentTarget\)\}/)

  const detail = withoutComments(source('DetailPage.jsx'))
  assert.match(detail, /const curDay = planDays\.some\(\(day\) => day\.ts === planDayTs\)[\s\S]*?\? planDayTs[\s\S]*?: planDays\[0\]\?\.ts \?\? null/)
  assert.match(detail, /await add\(e,\s*\{\s*dayTs:\s*curDay,\s*part\s*\}\)/)

  const place = withoutComments(source('PlaceDetail.jsx'))
  assert.match(place, /const currentPlanDay = days\.some\(\(day\) => day\.ts === planDay\)/)
  assert.match(place, /const day = getDay\(currentPlanDay\)/)
  assert.match(place, /await add\(e,\s*\{\s*dayTs:\s*currentPlanDay,\s*part\s*\}\)/)

  const calendar = withoutComments(source('CalendarView.jsx'))
  assert.match(calendar, /if \(!plannerReady \|\| dayTs < anchors\.todayTs \|\| !slot/)
  assert.match(calendar, /plannerReady && !selPast && selectedDay\?\.source === 'active'/)

  const plans = withoutComments(source('MyPlansPage.jsx'))
  assert.match(plans, /\.filter\(\(\{\s*dayTs\s*\}\) => dayTs >= anchors\.todayTs\)/)
  assert.match(plans, /plannerUnavailable[\s\S]*?onClick=\{retryPersistence\}>Try again</)
})

test('the app and day action modal keep covered layers out of navigation order', () => {
  const app = withoutComments(source('App.jsx'))
  assert.match(app, /const baseCovered = !primer \|\| Boolean\(page\) \|\| Boolean\(detail\)/)
  assert.match(app, /inert=\{baseInert\}\s+aria-hidden=\{baseCovered \|\| undefined\}/)
  assert.match(app, /inert=\{active !== \d \? true : undefined\}/)
  assert.match(app, /inert=\{detail \? true : undefined\}/)

  const day = withoutComments(source('DayPage.jsx'))
  assert.match(day, /role="dialog"\s+aria-modal="true"\s+aria-label="Plan item options"/)
  assert.match(day, /querySelectorAll\('button:not\(:disabled\)'\)/)
  assert.match(day, /window\.addEventListener\('keydown', onKey, true\)/)
  assert.match(day, /role="status"/)
})
