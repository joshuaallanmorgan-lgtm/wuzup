import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const APP_DIR = fileURLToPath(new URL('../app/src/', import.meta.url))

function withoutComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function source(file) {
  const path = join(APP_DIR, file)
  return existsSync(path) ? withoutComments(readFileSync(path, 'utf8')) : ''
}

function sourceFiles(dir = APP_DIR) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (['.js', '.jsx', '.mjs'].includes(extname(entry.name))) files.push(path)
  }
  return files
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function customContext(app) {
  const destructured = app.match(/const\s*\{([^}]*)\}\s*=\s*useCustomEvents\s*\(\s*\)/)
  if (destructured) {
    const binding = (name) => {
      const match = destructured[1].match(new RegExp(`(?:^|,)\\s*${name}\\s*(?::\\s*([A-Za-z_$][\\w$]*))?(?=\\s*,|\\s*$)`))
      return match ? match[1] || name : null
    }
    return {
      items: binding('items'),
      ready: binding('ready'),
      error: binding('error'),
    }
  }

  const object = app.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*useCustomEvents\s*\(\s*\)/)?.[1]
  return object
    ? { items: `${object}.items`, ready: `${object}.ready`, error: `${object}.error` }
    : { items: null, ready: null, error: null }
}

function unchangedGuard(outcome) {
  const name = escapeRegExp(outcome)
  return new RegExp(
    `if\\s*\\(\\s*(?:!${name}\\?*\\.changed|${name}\\?*\\.changed\\s*!==\\s*true)(?:\\s*\\|\\|[\\s\\S]{0,200}?)?\\s*\\)[\\s\\S]{0,500}?\\breturn\\b`,
  )
}

function positivelyAppliedGuard(outcome) {
  const name = escapeRegExp(outcome)
  return new RegExp(
    `if\\s*\\(\\s*${name}\\?*\\.changed(?:\\s*===\\s*true)?\\s*\\)\\s*\\{?[\\s\\S]*$`,
  )
}

function assertAppliedGate(value, outcome, message) {
  assert.ok(
    unchangedGuard(outcome).test(value) || positivelyAppliedGuard(outcome).test(value),
    message,
  )
}

test('App mounts one CustomEventsProvider and consumes its reactive contract', () => {
  const app = source('App.jsx')
  const provider = source('CustomEventsProvider.jsx')

  const providerImport = app.match(
    /import\s*\{([^}]*)\}\s*from\s*['"]\.\/CustomEventsProvider\.jsx['"]/,
  )?.[1] || ''
  assert.match(providerImport, /\bCustomEventsProvider\b/)
  assert.match(providerImport, /\buseCustomEvents\b/)
  assert.match(provider, /export\s+function\s+CustomEventsProvider\s*\(/)
  assert.match(provider, /export\s+function\s+useCustomEvents\s*\(/)
  assert.match(provider, /\bitems\s*[:,]/)
  assert.match(provider, /new\s+Set\s*\(\s*\[\s*['"]durable['"]\s*,\s*['"]session-only['"]\s*\]\s*\)/)
  assert.match(provider, /ready:\s*isUsableCustomEventsStatus\s*\(\s*status\s*\)/)
  assert.match(app, /\buseCustomEvents\s*\(\s*\)/)

  const providerOpen = app.indexOf('<CustomEventsProvider')
  const navOpen = app.indexOf('<NavProvider')
  const shell = app.indexOf('<Shell />')
  const navClose = app.indexOf('</NavProvider>')
  const providerClose = app.indexOf('</CustomEventsProvider>')
  assert.ok(
    providerOpen >= 0
      && providerOpen < navOpen
      && navOpen < shell
      && shell < navClose
      && navClose < providerClose,
    'the city-bound custom provider must enclose NavProvider and every Shell consumer',
  )
})

test('the coherent App cutover leaves no active V1 custom reader, writer, or local mirror', () => {
  const app = source('App.jsx')
  assert.doesNotMatch(app, /\b(?:loadMyEvents|saveMyEvents)\b/)
  assert.doesNotMatch(app, /const\s*\[\s*myEvents\s*,\s*setMyEvents\s*\]\s*=\s*useState\s*\(/)
  assert.doesNotMatch(app, /\bsetMyEvents\b/)

  const activeV1Calls = sourceFiles()
    .filter((path) => relative(APP_DIR, path).replaceAll('\\', '/') !== 'lib.js')
    .flatMap((path) => {
      const code = withoutComments(readFileSync(path, 'utf8'))
      return /\b(?:loadMyEvents|saveMyEvents)\s*\(/.test(code)
        ? [relative(APP_DIR, path).replaceAll('\\', '/')]
        : []
    })
  assert.deepEqual(
    activeV1Calls,
    [],
    'loadMyEvents/saveMyEvents may remain rollback helpers in lib.js, but no runtime may call them',
  )
})

test('provider-projected custom items feed every passive event surface', () => {
  const app = source('App.jsx')
  const { items } = customContext(app)
  assert.ok(items, 'App must read items from useCustomEvents')

  const itemExpression = escapeRegExp(items)
  assert.match(
    app,
    new RegExp(
      `const\\s+normalized\\s*=\\s*useMemo\\(\\s*\\(\\)\\s*=>\\s*\\[\\s*\\.\\.\\.events\\s*,\\s*\\.\\.\\.${itemExpression}\\s*\\]\\.map\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>\\s*normalize\\(\\s*\\1\\s*,\\s*anchors\\s*\\)`,
    ),
    'remote and provider-projected custom rows must share the one normalization path',
  )

  const passiveSurfaces = [
    ['HomeView', /<HomeView\b[^>]*\bevents=\{norm\}/s],
    ['HotView', /<HotView\b[^>]*\bevents=\{norm\}[^>]*\bretainedEvents=\{normalized\}/s],
    ['CalendarView', /<CalendarView\b[^>]*\bevents=\{normalized\}/s],
    ['BubblePage', /<BubblePage\b[^>]*\bevents=\{norm\}/s],
    ['GuidePage', /<GuidePage\b[^>]*\bevents=\{norm\}/s],
    ['SearchPage', /<SearchPage\b[^>]*\bevents=\{norm\}/s],
    ['DayPage', /<DayPage\b[^>]*\bevents=\{normalized\}[^>]*\bavailableEvents=\{norm\}/s],
    ['SettingsPage', /<SettingsPage\b[^>]*\bevents=\{norm\}/s],
    ['MyPlansPage', /<MyPlansPage\b[^>]*\bevents=\{normalized\}/s],
    ['MySavesPage', /<MySavesPage\b[^>]*\bevents=\{normalized\}/s],
    ['NotificationsPage', /<NotificationsPage\b[^>]*\bevents=\{norm\}[^>]*\bretainedEvents=\{normalized\}/s],
    ['AttributionPage', /<AttributionPage\b[^>]*\bevents=\{norm\}/s],
    ['CalibrationDeck', /<CalibrationDeck\b[^>]*\bevents=\{norm\}/s],
    ['LensDeck', /<LensDeck\b[^>]*\bevents=\{norm\}/s],
    ['DetailPage', /<DetailPage\b[^>]*\bevents=\{norm\}/s],
  ]
  for (const [name, pattern] of passiveSurfaces) {
    assert.match(app, pattern, `${name} must consume the merged custom-aware catalog`)
  }
})

test('PlannerProvider waits for a usable custom catalog and publishes catalog failure', () => {
  const app = source('App.jsx')
  const planner = source('PlannerProvider.jsx')
  const context = customContext(app)
  assert.ok(context.ready, 'App must read provider readiness')
  assert.ok(context.error, 'App must read provider catalog failure')

  const plannerTag = app.match(/<PlannerProvider\b[\s\S]*?>/)?.[0] || ''
  assert.match(plannerTag, new RegExp(`catalogReady=\\{${escapeRegExp(context.ready)}\\}`))
  assert.match(plannerTag, new RegExp(`catalogError=\\{${escapeRegExp(context.error)}\\}`))
  assert.match(
    planner,
    /useEffect\s*\(\s*\(\)\s*=>\s*\{\s*if\s*\(\s*!runtime\s*\|\|\s*!catalogReady(?:\s*\|\|\s*catalogError)?\s*\)\s*return[\s\S]{0,500}?runtime\.initialize\s*\(/,
    'planner migration cannot initialize against a missing custom catalog',
  )
  assert.match(planner, /\[anchors,\s*artifactStatus,\s*catalogReady,\s*(?:catalogError,\s*)?eventList,\s*runtime,\s*seeds\]/)
  assert.match(
    planner,
    /plannerStatusAfterCatalog\s*\(\s*baseStatus\s*,\s*\{\s*ready:\s*catalogReady\s*,\s*error:\s*catalogError\s*\}\s*\)/,
  )
  assert.match(planner, /error:\s*[\s\S]{0,120}?catalogError/)
  assert.match(
    planner,
    /export\s+function\s+PlannerProvider\s*\(\s*\{[\s\S]{0,300}?catalogReady[\s\S]{0,100}?catalogError/,
  )
  assert.match(planner, /<CityPlannerProvider\b[\s\S]{0,500}?catalogReady=\{catalogReady\}[\s\S]{0,200}?catalogError=\{catalogError\}/)
})

test('Add Event serializes and awaits submit, then records taste only for an applied add', () => {
  const addEvent = source('AddEvent.jsx')
  assert.match(addEvent, /const\s+submit\s*=\s*async\s*\(\s*ev\s*\)\s*=>/)

  const pending = addEvent.match(
    /const\s*\[\s*((?:[A-Za-z_$][\w$]*)?(?:pending|submitting|saving)[\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\s*\(\s*false\s*\)/i,
  )
  assert.ok(pending, 'Add Event needs rendered pending state')
  const [, pendingName, setPending] = pending
  const submitButton = addEvent.match(/<button\b(?=[^>]*className="ae-submit")[^>]*>/)?.[0] || ''
  assert.match(submitButton, new RegExp(`disabled=\\{[^}]*\\b${escapeRegExp(pendingName)}\\b[^}]*\\}`))
  assert.match(addEvent, new RegExp(`aria-busy=\\{[^}]*\\b${escapeRegExp(pendingName)}\\b[^}]*\\}`))

  const awaited = addEvent.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+onAdd\s*\(\s*raw\s*\)/)
  assert.ok(awaited, 'submit must await the provider add outcome')
  const outcome = awaited[1]
  const awaitAt = addEvent.indexOf(awaited[0])
  const tasteAt = addEvent.indexOf("recordSignal('add'", awaitAt)
  assert.ok(tasteAt > awaitAt, 'taste may be recorded only after the awaited add outcome')
  assertAppliedGate(
    addEvent.slice(awaitAt, tasteAt),
    outcome,
    'a no-change or failed add must return before the taste signal',
  )
  assert.match(addEvent.slice(0, awaitAt), new RegExp(`${escapeRegExp(setPending)}\\(true\\)`))
  assert.match(addEvent.slice(awaitAt), new RegExp(`${escapeRegExp(setPending)}\\(false\\)`))
  assert.match(addEvent.slice(awaitAt), /\bcatch\b/)
})

test('Add Event distinguishes failed, durable, and session-only outcomes and exports provider items', () => {
  const app = source('App.jsx')
  const addEvent = source('AddEvent.jsx')
  const { items } = customContext(app)
  assert.ok(items, 'App must expose provider items to Add Event')

  const exported = addEvent.match(/JSON\.stringify\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*null\s*,\s*2\s*\)/)?.[1]
  assert.ok(exported, 'the JSON export must serialize an explicit items prop')
  assert.match(
    app,
    new RegExp(`<AddEvent\\b[^>]*\\b${escapeRegExp(exported)}=\\{${escapeRegExp(items)}\\}`, 's'),
    'the export prop must be the live provider projection, not an App mirror',
  )

  assert.match(addEvent, /done\?*\.changed|done\?*\.(?:kind|status|outcome|code)[\s\S]{0,500}?fail/)
  assert.match(addEvent, /done\?*\.persisted|done\?*\.(?:kind|status|outcome|code)[\s\S]{0,500}?(?:durable|session-only)/)
  assert.match(addEvent, /(?:Couldn.t|Could not|Failed to) add|Add failed/i)
  assert.match(addEvent, /this visit|session-only/i)
  assert.match(addEvent, /My Events|your feed|saved/i)
  assert.match(addEvent, /role="alert"/)
})

test('Add Event gates unavailable catalog states and ignores late async completions', () => {
  const app = source('App.jsx')
  const addEvent = source('AddEvent.jsx')

  assert.match(app, /<AddEvent\b[\s\S]*?status=\{customEvents\.status\}[\s\S]*?\/>/)
  assert.match(addEvent, /status\s*=\s*['"]durable['"]/)
  assert.match(
    addEvent,
    /const\s+catalogReady\s*=\s*status\s*===\s*['"]durable['"]\s*\|\|\s*status\s*===\s*['"]session-only['"]/,
  )
  const unavailableAt = addEvent.indexOf('!catalogReady ?')
  const formAt = addEvent.indexOf('<form className="ae-form"')
  assert.ok(unavailableAt >= 0 && unavailableAt < formAt, 'an unusable catalog must replace the form')
  assert.match(addEvent, /status === ['"]initializing['"] \? ['"]status['"] : ['"]alert['"]/)
  assert.match(addEvent, /Loading your events/)
  assert.match(addEvent, /Adding is unavailable/)

  assert.match(addEvent, /const\s+mountedRef\s*=\s*useRef\(true\)/)
  assert.match(addEvent, /mountedRef\.current\s*=\s*false[\s\S]*clearTimeout\(doneTRef\.current\)/)
  assert.match(
    addEvent,
    /const\s+scheduleClose\s*=\s*\(\)\s*=>\s*\{[\s\S]*if\s*\(!mountedRef\.current\)\s*return[\s\S]*setTimeout\(\(\)\s*=>\s*\{[\s\S]*if\s*\(mountedRef\.current\)\s*onClose\(\)/,
  )
  const awaitedAt = addEvent.indexOf('await onAdd(raw)')
  assert.ok(awaitedAt >= 0)
  assert.ok(
    (addEvent.slice(awaitedAt).match(/if\s*\(!mountedRef\.current\)\s*return/g) || []).length >= 2,
    'duplicate and changed outcomes must both stop before rendered state after unmount',
  )
  assert.match(addEvent.slice(awaitedAt), /if\s*\(mountedRef\.current\)\s*setSubmitting\(false\)/)
})

test('custom persistence truth remains visible beside independent artifact failures', () => {
  const app = source('App.jsx')
  const css = source('App.css')
  const customStatusGate = "['session-only', 'corrupt', 'error'].includes(customEvents.status)"
  const customNoticeAt = app.indexOf(customStatusGate)
  assert.ok(customNoticeAt >= 0, 'the custom-event notice must gate its own provider status')
  const customNotice = app.slice(Math.max(0, customNoticeAt - 120), customNoticeAt + 900)
  const gate = customNotice.slice(0, customNotice.indexOf(customStatusGate))
  assert.match(gate, /primer\s*&&\s*$/)
  assert.doesNotMatch(gate, /remotePageBlocked|!transportError|staleAt\s*==\s*null/)
  assert.match(
    customNotice,
    /transportError\s*\|\|\s*staleAt\s*!=\s*null\s*\?\s*['"] is-stacked['"]/,
  )
  assert.match(customNotice, /customEvents\.status === ['"]session-only['"]/)
  assert.match(customNotice, /Your added events are here for this visit/)
  assert.match(customNotice, /customEvents\.retryPersistence\(\)/)
  assert.match(css, /\.load-note\.is-stacked\s*\{[\s\S]*?top:/)
  assert.match(css, /\.load-note\.is-layered\.is-stacked\s*\{[\s\S]*?top:/)
})

test('custom detail delete and undo await applied outcomes before claiming success', () => {
  const detail = source('DetailPage.jsx')

  assert.match(detail, /const\s+removeMine\s*=\s*async\s*\(\s*\)\s*=>/)
  const removed = detail.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+onRemoveMine\s*\(\s*e\s*\)/,
  )
  assert.ok(removed, 'delete must await the provider outcome')
  const removedOutcome = removed[1]
  const removedAt = detail.indexOf(removed[0])
  const showUndoAt = detail.indexOf('setUndoVis(true)', removedAt)
  assert.ok(showUndoAt > removedAt, 'Undo can appear only after deletion resolves')
  assertAppliedGate(
    detail.slice(removedAt, showUndoAt),
    removedOutcome,
    'an unapplied delete must return before showing Undo',
  )
  assert.match(
    detail.slice(removedAt, showUndoAt),
    new RegExp(`set[A-Za-z_$][\\w$]*\\(\\s*${escapeRegExp(removedOutcome)}\\?*\\.item\\s*\\)`),
    'undo must retain the exact item returned by the applied delete',
  )

  assert.match(detail, /const\s+undoRemove\s*=\s*async\s*\(\s*\)\s*=>/)
  const restored = detail.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+onRestoreMine\s*\(\s*([^)]*?)\s*\)/,
  )
  assert.ok(restored, 'undo must await the provider restore outcome')
  assert.notEqual(restored[2].trim(), 'e', 'undo must restore the delete receipt item, not the display projection')
  const restoredOutcome = restored[1]
  const restoredAt = detail.indexOf(restored[0])
  const hideUndoAt = detail.indexOf('setUndoVis(false)', restoredAt)
  const restoredToastMatch = detail.slice(restoredAt).match(/flash\s*\(\s*['"]Restored/)
  const restoredToastAt = restoredToastMatch ? restoredAt + restoredToastMatch.index : -1
  assert.ok(hideUndoAt > restoredAt, 'failed restore must keep Undo available')
  assert.ok(restoredToastAt > restoredAt, 'restore success copy must follow the awaited outcome')
  assertAppliedGate(
    detail.slice(restoredAt, Math.min(hideUndoAt, restoredToastAt)),
    restoredOutcome,
    'an unapplied restore must return before hiding Undo or claiming restoration',
  )
  assert.match(detail, /Couldn.t (?:restore|undo)|Could not (?:restore|undo)|Restore failed/i)
})

test('custom detail keeps failed undo retryable, live, and terminally removed after expiry', () => {
  const detail = source('DetailPage.jsx')
  const css = source('detail.css')
  const undoAt = detail.indexOf('const undoRemove = async () =>')
  const restoreAt = detail.indexOf('await onRestoreMine(undoReceipt)', undoAt)
  assert.ok(undoAt >= 0 && restoreAt > undoAt)
  assert.match(
    detail.slice(undoAt, restoreAt),
    /clearTimeout\(undoTRef\.current\)[\s\S]*removePendingRef\.current\s*=\s*true/,
    'the expiry clock must stop before restore can wait',
  )
  assert.match(
    detail,
    /const\s+keepUndoAfterFailure\s*=\s*\(\)\s*=>\s*\{[\s\S]*setUndoError\([\s\S]*setUndoVis\(true\)[\s\S]*scheduleUndoExpiry\(\)/,
  )
  assert.ok(
    (detail.slice(restoreAt).match(/keepUndoAfterFailure\(\)/g) || []).length >= 2,
    'resolved failure and rejection must both restore a fresh undo window',
  )
  const restoreFlow = detail.slice(restoreAt, detail.indexOf('\n  return (', restoreAt))
  assert.doesNotMatch(
    restoreFlow,
    /flash\(\s*["']Couldn.t restore/,
    'restore failure belongs in the persistent undo live region, not an overlapping transient toast',
  )
  assert.match(detail, /const\s*\[removedMine,\s*setRemovedMine\]\s*=\s*useState\(false\)/)
  assert.match(detail, /disabled=\{removedMine\s*\|\|\s*removePending\}/)
  assert.match(detail, /removedMine\s*\?\s*['"]Removed from my feed['"]/)
  assert.match(
    detail,
    /className="detail-toast undo-toast"[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-atomic="true"/,
  )
  assert.match(detail, /\{undoError\s*\|\|\s*['"]Removed from your feed['"]\}/)
  assert.match(css, /\.detail-toast\.undo-toast\s*\{[\s\S]*?bottom:/)

  const deleteAt = detail.indexOf('await onRemoveMine(e)')
  assert.match(detail.slice(deleteAt, deleteAt + 300), /if\s*\(!mountedRef\.current\)\s*return/)
  assert.match(detail.slice(restoreAt, restoreAt + 300), /if\s*\(!mountedRef\.current\)\s*return/)
  assert.match(
    detail,
    /setTimeout\(\(\)\s*=>\s*\{\s*if\s*\(!mountedRef\.current\)\s*return[\s\S]*setUndoVis\(false\)/,
  )
  const expiry = detail.match(/const\s+scheduleUndoExpiry[\s\S]*?\n\s*\}/)?.[0] || ''
  assert.doesNotMatch(expiry, /setRemovedMine\(false\)/, 'expiry must not resurrect the remove action')
})
