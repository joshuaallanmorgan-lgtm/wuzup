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

test('App mounts one ActivityProvider outside navigation and every activity consumer', () => {
  const app = source('App.jsx')
  const provider = source('ActivityProvider.jsx')

  assert.match(provider, /export\s+function\s+ActivityProvider\s*\(/)
  assert.match(provider, /export\s+function\s+useActivity\s*\(/)
  assert.equal((app.match(/<ActivityProvider\b/g) || []).length, 1)

  const activityOpen = app.indexOf('<ActivityProvider')
  const navOpen = app.indexOf('<NavProvider')
  const navClose = app.indexOf('</NavProvider>')
  const activityClose = app.indexOf('</ActivityProvider>')
  assert.ok(
    activityOpen >= 0
      && activityOpen < navOpen
      && navOpen < navClose
      && navClose < activityClose,
    'ActivityProvider must enclose NavProvider so openDetail can retain activity',
  )
})

test('the active runtime has no V1 recents or deck storage behavior', () => {
  const recents = source('recents.js')
  assert.match(recents, /from\s+['"]\.\/ActivityProvider\.jsx['"]/)
  assert.match(recents, /useActivity\s*\(\s*\)/)
  assert.doesNotMatch(recents, /\b(?:lsGet|lsSet|physicalKey|useSyncExternalStore)\b/)
  assert.doesNotMatch(recents, /window\.addEventListener\s*\(\s*['"]storage['"]/)

  const allowed = new Set([
    'activity-state-core.js',
    'activity-store.js',
    'retained-v1-source.js',
  ])
  const activeV1 = sourceFiles().flatMap((path) => {
    const file = relative(APP_DIR, path).replaceAll('\\', '/')
    if (allowed.has(file)) return []
    const value = withoutComments(readFileSync(path, 'utf8'))
    return /['"](?:recents-v1|deck-last-v1|deck-last-places-v1)['"]/.test(value) ? [file] : []
  })
  assert.deepEqual(activeV1, [], 'V1 activity keys may exist only behind migration capture')
})

test('navigation records detail views through the provider without delaying navigation', () => {
  const nav = source('nav.jsx')
  assert.match(nav, /from\s+['"]\.\/ActivityProvider\.jsx['"]/)
  assert.match(nav, /useActivity\s*\(\s*\)/)
  assert.match(nav, /const\s+openDetail\s*=\s*useCallback\s*\(\s*\(e,\s*cardEl\)\s*=>\s*\{[\s\S]{0,420}?void\s+recordView\s*\(\s*e\s*\)/)
  assert.match(nav, /e\?\.kind\s*!==\s*['"]place['"][\s\S]{0,180}?void\s+recordView\s*\(\s*e\s*\)/)
  const retainedAt = nav.indexOf('void recordView(e)')
  const personalAt = nav.indexOf("capturePersonalSignal('open'", retainedAt)
  assert.ok(retainedAt >= 0 && personalAt > retainedAt, 'open taste must follow the retained Activity outcome')
  assert.doesNotMatch(nav, /from\s+['"]\.\/recents\.js['"]/)
})

test('HotView resolves durable and tab-local recent refs against the live event catalog', () => {
  const hot = source('HotView.jsx')
  assert.match(hot, /from\s+['"]\.\/ActivityProvider\.jsx['"]/)
  assert.match(hot, /useActivity\s*\(\s*\)/)
  assert.match(hot, /recentRefs/)
  assert.match(hot, /sessionRecentRefs/)
  assert.match(hot, /resolveRecentRefs\s*\(/)
  assert.match(hot, /resolveRecentRefs\s*\([^)]*(?:upcoming|events)/)
  assert.doesNotMatch(hot, /useRecents\s*\(/)
  assert.doesNotMatch(hot, /new\s+Map\s*\([^)]*keyOf/)
})

test('calibration decks wait for activity readiness and await exact retained outcomes', () => {
  const deck = source('CalibrationDeck.jsx')
  assert.match(deck, /from\s+['"]\.\/ActivityProvider\.jsx['"]/)
  assert.match(deck, /useActivity\s*\(\s*\)/)
  assert.match(deck, /eventDeckExclusions/)
  assert.match(deck, /placeDeckExclusions/)
  assert.match(deck, /isEventDeckExcluded/)
  assert.match(deck, /isPlaceDeckExcluded/)
  assert.match(deck, /if\s*\(\s*!activity\.ready\s*\)/)
  assert.match(deck, /await\s+recordEventDeck\s*\(|await\s+recordPlaceDeck\s*\(|await\s+recordDeck\s*\(/)
  assert.match(deck, /result\?*\.applied\s*!==\s*true[^\n]*return\s+false/)
  assert.doesNotMatch(deck, /result\?*\.ok\s*!==\s*true/)
  assert.doesNotMatch(deck, /\b(?:lsGet|lsSet|loadLastDeal|pushLastDeal|lastKeyFor)\b/)
  assert.doesNotMatch(deck, /\b(?:deck-last-v1|deck-last-places-v1)\b/)
})

test('Settings atomically clears both deck memories and reports exact durability', () => {
  const settings = source('SettingsPage.jsx')
  assert.match(settings, /from\s+['"]\.\/ActivityProvider\.jsx['"]/)
  assert.match(settings, /useActivity\s*\(\s*\)/)
  assert.match(settings, /const\s+doReset\s*=\s*async\s*\(/)
  assert.match(settings, /await\s+clearDeckMemories\s*\(/)
  assert.match(settings, /result\?*\.applied\s*!==\s*true/)
  assert.doesNotMatch(settings, /result\?*\.ok\s*!==\s*true/)
  assert.match(settings, /resetStatus[^\n]*(?:failed|error)|setResetStatus\s*\(\s*['"]failed['"]\s*\)/)
  assert.match(settings, /resetPending/)
  assert.match(settings, /aria-busy=\{resetPending/)
  assert.doesNotMatch(settings, /\b(?:lsRemove|deck-last-v1|deck-last-places-v1|fmn-seen-v1)\b/)
})

test('activity recovery and recap copy are gated by actionable runtime evidence', () => {
  const app = source('App.jsx')
  const hot = source('HotView.jsx')
  assert.match(app, /activity\.recovery\?\.canRetry\s*===\s*true/)
  assert.match(hot, /recapRows\.length\s*>=\s*3/)
  assert.match(hot, /You eyed \{recapRows\.length\} ideas/)
  assert.doesNotMatch(hot, /sessionRecentRefs\.length\s*>=\s*3/)
})
