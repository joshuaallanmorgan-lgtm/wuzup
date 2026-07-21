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

function importNames(value, moduleName) {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return value.match(new RegExp(
    `import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['"]${escaped}['"]`,
  ))?.[1] || ''
}

const PROVIDER_MODULE = './SavedBeenProvider.jsx'
const SAVE_CONSUMERS = [
  'CalendarView.jsx',
  'cards.jsx',
  'CalibrationDeck.jsx',
  'DayPage.jsx',
  'DetailPage.jsx',
  'GuidePage.jsx',
  'HotView.jsx',
  'LensDeck.jsx',
  'LocationsView.jsx',
  'MyPlansPage.jsx',
  'MySavesPage.jsx',
  'NotificationsPage.jsx',
  'PlaceDetail.jsx',
  'ProfileView.jsx',
]

test('App mounts exactly one catalog-gated SavedBeenProvider around every consumer', () => {
  const app = source('App.jsx')
  const provider = source('SavedBeenProvider.jsx')

  const names = importNames(app, PROVIDER_MODULE)
  assert.match(names, /\bSavedBeenProvider\b/)
  assert.match(provider, /export\s+function\s+SavedBeenProvider\s*\(/)
  assert.match(provider, /export\s+function\s+useSavedBeen\s*\(/)
  assert.equal((app.match(/<SavedBeenProvider\b/g) || []).length, 1)

  const savedOpen = app.indexOf('<SavedBeenProvider')
  const plannerOpen = app.indexOf('<PlannerProvider')
  const plannerClose = app.indexOf('</PlannerProvider>')
  const savedClose = app.indexOf('</SavedBeenProvider>')
  assert.ok(
    savedOpen >= 0
      && savedOpen < plannerOpen
      && plannerOpen < plannerClose
      && plannerClose < savedClose,
    'saved/Been state must enclose PlannerProvider and all rendered save/Been consumers',
  )

  const providerTag = app.match(/<SavedBeenProvider\b[\s\S]*?>/)?.[0] || ''
  for (const prop of [
    'events',
    'customEvents',
    'places',
    'guides',
    'seeds',
    'catalogReady',
    'catalogError',
  ]) {
    assert.match(providerTag, new RegExp(`\\b${prop}=\\{`), `provider needs ${prop} migration evidence`)
  }

  assert.match(provider, /createSavedBeenStore\s*\(/)
  assert.match(provider, /useSyncExternalStore\s*\(/)
  assert.match(provider, /useEffect\s*\(/)
  assert.match(provider, /\.destroy\s*\(\s*\)/)
  assert.match(provider, /(?:cityKey|CITY\.id|city\.id)[\s\S]{0,160}(?:CITY\.tz|city\.tz|timeZone)/)
  assert.match(provider, /createCatalogLatch\s*\(\s*\{\s*ready:\s*catalogReady,\s*error:\s*catalogError\s*\}\s*\)/)
  assert.match(provider, /if\s*\(\s*!catalogUnlocked\s*\)\s*return/)
  assert.doesNotMatch(
    provider,
    /^(?:const|let|var)\s+\w*[Ss]tore\w*\s*=\s*createSavedBeenStore\s*\(/m,
    'the browser store cannot be a cross-city module singleton',
  )
})

test('the active runtime has no V1 save/Been reader, writer, or singleton', () => {
  const legacy = source('saves.js')
  assert.match(legacy, /from\s+['"]\.\/SavedBeenProvider\.jsx['"]/)
  assert.doesNotMatch(legacy, /\b(?:lsGet|lsSet|physicalKey)\b/)
  assert.doesNotMatch(legacy, /\b(?:saved-events-v1|been-there-v1)\b/)
  assert.doesNotMatch(legacy, /window\.addEventListener\s*\(\s*['"]storage['"]/)
  assert.doesNotMatch(legacy, /(?:const|let)\s+(?:listeners|beenListeners|store|been)\s*=\s*/)

  const activeV1 = sourceFiles().flatMap((path) => {
    const file = relative(APP_DIR, path).replaceAll('\\', '/')
    if ([
      'retained-v1-source.js',
      'planner-v1-source.js',
      'identity-migration.js',
      'planner-migration.js',
      'saved-been-store.js',
      'saved-been-state-core.js',
    ].includes(file)) return []
    const value = withoutComments(readFileSync(path, 'utf8'))
    return /\b(?:saved-events-v1|been-there-v1)\b|\b(?:loadMap|loadBeen|commitBeen)\s*\(/.test(value)
      ? [file]
      : []
  })
  assert.deepEqual(activeV1, [], 'V1 keys and singleton helpers may exist only behind migration capture')
})

test('all save and Been consumers cross the atomic provider seam', () => {
  const bridge = source('saves.js')
  assert.match(importNames(bridge, PROVIDER_MODULE), /\buseSavedBeen\b/)
  assert.match(bridge, /useSavedBeen\s*\(\s*\)/)

  for (const file of SAVE_CONSUMERS) {
    const value = source(file)
    assert.doesNotMatch(
      value,
      /\b(?:toggleSave|markBeen)\s*\([^)]*,[^)]*,\s*['"](?:went|missed)['"]\s*\)/,
      `${file} cannot call a V1 mutation signature`,
    )
    const importsBridge = /from\s+['"]\.\/saves\.js['"]/.test(value)
    const importsProvider = /from\s+['"]\.\/SavedBeenProvider\.jsx['"]/.test(value)
    assert.ok(importsBridge || importsProvider, `${file} must consume the provider or its provider-only UI bridge`)
  }

  const plans = source('MyPlansPage.jsx')
  assert.match(importNames(plans, PROVIDER_MODULE), /\buseSavedBeen\b/)
  assert.match(plans, /\bmarkBeen\b/)
})

test('provider publishes usable status separately from a legitimate empty document', () => {
  const provider = source('SavedBeenProvider.jsx')
  assert.match(provider, /new\s+Set\s*\(\s*\[\s*['"]durable['"]\s*,\s*['"]session-only['"]\s*\]\s*\)/)
  assert.match(provider, /ready:\s*[^,\n]*(?:status|isUsable)/)
  assert.match(provider, /status:\s*[^,\n]+/)
  assert.match(provider, /durability:\s*[^,\n]+/)
  assert.match(provider, /error:\s*[^,\n]+/)
  assert.match(provider, /saved(?:Records)?:\s*[^,\n]+/)
  assert.match(provider, /been(?:Records)?:\s*[^,\n]+/)
  assert.match(provider, /retry(?:Persistence)?:\s*[^,\n]+/)
  assert.match(
    provider,
    /(?:!isUsableSavedBeenStatus\s*\([^)]*\)|!ready)[\s\S]{0,180}?(?:EMPTY|\[\])/,
    'an unusable destination must not project corrupt data as a valid collection',
  )

  const savesPage = source('MySavesPage.jsx')
  assert.match(savesPage, /\b(?:status|ready)\b/)
  assert.match(savesPage, /Loading (?:your )?saves|Checking (?:your )?saves/i)
  assert.match(savesPage, /Saves (?:are )?unavailable|Couldn.t load (?:your )?saves/i)
  const unavailableAt = Math.max(
    savesPage.search(/Loading (?:your )?saves|Checking (?:your )?saves/i),
    savesPage.search(/Saves (?:are )?unavailable|Couldn.t load (?:your )?saves/i),
  )
  const emptyAt = savesPage.indexOf('No saves yet')
  assert.ok(unavailableAt >= 0 && emptyAt > unavailableAt, 'unavailable state must be decided before empty copy')
})

test('save actions await exact outcomes and taste runs only after a changed save-on', () => {
  const bridge = source('saves.js')
  assert.match(bridge, /const\s+toggle\s*=\s*(?:useCallback\s*\(\s*)?async\s*\(/)
  assert.match(bridge, /await\s+toggleSaved\s*\(/)
  assert.match(bridge, /result\?*\.changed\s*===\s*true|result\?*\.changed/)
  const awaitedAt = bridge.search(/await\s+toggleSaved\s*\(/)
  const tasteAt = bridge.indexOf("capturePersonalSignal('save'", awaitedAt)
  assert.ok(awaitedAt >= 0 && tasteAt > awaitedAt, 'save taste must follow the provider outcome')
  assert.match(
    bridge.slice(awaitedAt, tasteAt),
    /(?:result\?*\.changed\s*!==\s*true|!result\?*\.changed|result\?*\.changed\s*===\s*true)/,
    'taste must be guarded by an applied provider outcome',
  )
  assert.match(
    bridge.slice(awaitedAt, tasteAt),
    /(?:wasSaved|previouslySaved|!on|!before|savingOn)/,
    'un-saving must never record a fresh positive signal',
  )

  assert.match(bridge, /const\s*\[\s*pending[\w$]*\s*,\s*setPending[\w$]*\s*\]\s*=\s*useState\s*\(/i)
  assert.match(bridge, /(?:aria-busy=\{|['"]aria-busy['"]\s*:)\s*[^,}\n]*pending/i)
  assert.match(bridge, /(?:(?:aria-disabled|disabled)=\{|['"]aria-disabled['"]\s*:)\s*[^,}\n]*pending/i)

  for (const file of ['cards.jsx', 'DetailPage.jsx', 'PlaceDetail.jsx', 'CalibrationDeck.jsx', 'LensDeck.jsx']) {
    const value = source(file)
    assert.match(value, /\bawait\s+\w*(?:toggle|save)\w*\s*\(/i, `${file} must await save mutation outcomes`)
    assert.match(
      value,
      /\b(?:isPending|canToggle|savePending|saving)\b/i,
      `${file} must serialize repeated save mutations`,
    )
  }
})

test('save-toggle reasons fail closed with distinct review and Been truth across every direct control', () => {
  const bridge = source('saves.js')
  assert.match(bridge, /\bsavedToggleResolutionFor\b/)
  assert.match(bridge, /savedToggleResolutionFor\s*\(\s*item\s*\)/)
  assert.match(bridge, /toggleResolution\s*\(\s*item\s*\)\?*\.status\s*===\s*['"]ambiguous['"]/)
  assert.match(bridge, /toggleResolution\s*\(\s*item\s*\)\?*\.status\s*===\s*['"]went['"]/)
  assert.match(bridge, /const\s+identitySafe\s*=\s*resolution\?*\.canToggle\s*===\s*true/)
  assert.match(bridge, /resolution\?*\.status\s*===\s*['"]went['"][\s\S]{0,100}?['"]saved-been-went-conflict['"]/)
  assert.match(bridge, /resolution\?*\.status\s*===\s*['"]ambiguous['"][\s\S]{0,100}?['"]saved-been-identity-ambiguous['"]/)
  assert.match(bridge, /_sessionIdentityAliases[\s\S]{0,180}?!toggleResolution\s*\(\s*item\s*\)\?*\.beenRecord/)
  assert.match(bridge, /identityNeedsReview[\s\S]{0,500}?needs review before it can be changed/i)
  assert.match(bridge, /identityCompleted[\s\S]{0,500}?Already in your Been history/)

  for (const file of ['cards.jsx', 'DetailPage.jsx', 'PlaceDetail.jsx', 'CalibrationDeck.jsx', 'LensDeck.jsx']) {
    const value = source(file)
    assert.match(value, /\bidentityAmbiguous\b/, `${file} must read ambiguity from the save seam`)
    assert.match(value, /\bidentityWent\b/, `${file} must read Been completion from the save seam`)
    assert.match(value, /Needs review/, `${file} must show honest ambiguity copy`)
    assert.match(value, /Completed/, `${file} must distinguish a completed item from identity review`)
    assert.match(value, /Already in your Been history/, `${file} must expose honest Been copy to assistive tech`)
    assert.match(value, /disabled=\{[^}]*canToggle/, `${file} must disable blocked save mutation through canToggle`)
  }
})

test('Been answers are awaited, unfarmable, and preserve planner follow-through truth', () => {
  const plans = source('MyPlansPage.jsx')
  assert.match(plans, /const\s+\w*(?:answer|mark|respond)\w*\s*=\s*async\s*\(/i)
  const awaited = plans.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+\w*markBeen\w*\s*\(/i)
  assert.ok(awaited, 'I went: the provider mutation must be awaited')
  const awaitedAt = plans.indexOf(awaited[0])
  const tasteAt = plans.indexOf("capturePersonalSignal('went'", awaitedAt)
  assert.ok(tasteAt > awaitedAt, 'I went: taste must follow the provider outcome')
  assert.match(
    plans.slice(awaitedAt, tasteAt),
    new RegExp(`${awaited[1]}\\?*\\.changed\\s*!==\\s*true[^\n]*return`),
    'I went: a failed or unchanged mutation must return before taste changes',
  )
  assert.match(plans, /markBeen\w*\s*\([^)]*,\s*\{\s*status\s*,\s*statusAt(?:\s*[:,])/)
  assert.match(plans, /answerBeen\s*\([^)]*,\s*['"]went['"]\s*(?:,\s*[^)]*)?\)/)
  assert.match(plans, /answerBeen\s*\([^)]*,\s*['"]missed['"]\s*(?:,\s*[^)]*)?\)/)
  assert.match(plans, /\b(?:answerPending|beenPending|pendingAnswer|pendingBeen(?:Ref|Keys)?)\b/i)
  assert.match(plans, /disabled=\{[^}]*pending/i)
  assert.match(plans, /aria-busy=\{[^}]*pending/i)
  assert.doesNotMatch(plans, /(?:recordSignal|capturePersonalSignal)\s*\(\s*['"]went['"][\s\S]{0,160}?await\s+markBeen/)

  const provider = source('SavedBeenProvider.jsx')
  assert.match(provider, /async\s+markBeen\s*\(/)
  assert.match(provider, /savedBeenMarkCommand\s*\(/)
  assert.match(provider, /await\s+store\.dispatch\s*\(/)
  assert.match(provider, /return\s+dispatch\s*\(\s*command\s*,\s*before\s*,\s*['"]marked-been['"]\s*\)/)
})

test('expiry archival is effect-owned, awaited, and never mutates during render', () => {
  const bridge = source('saves.js')
  assert.doesNotMatch(bridge, /setTimeout\s*\(\s*\(\)\s*=>[\s\S]{0,900}?(?:archiveSaved|commit)/)
  assert.match(bridge, /useEffect\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?archiveSaved\s*\(/)
  assert.match(bridge, /await\s+archiveSaved\s*\(/)
  assert.match(bridge, /\b(?:archivePending|archiving|archiveAttempt|cancelled)\b/i)
  for (const file of ['DayPage.jsx', 'MyPlansPage.jsx', 'MySavesPage.jsx']) {
    assert.match(
      source(file),
      /useSaves\s*\(\s*\{\s*events\s*,\s*anchors\s*\}\s*\)/,
      `${file} must supply the actionable catalog clock to effect-owned expiry archival`,
    )
  }
})

test('event, custom, place, and guide saves remain kind-correct and reopenable', () => {
  const provider = source('SavedBeenProvider.jsx')
  for (const kind of ['event', 'custom', 'place', 'guide']) {
    assert.match(provider, new RegExp(`['"]${kind}['"]`), `provider must preserve ${kind} references`)
  }
  assert.match(provider, /\b(?:events|eventCatalog)\b/)
  assert.match(provider, /\b(?:customEvents|customCatalog)\b/)
  assert.match(provider, /\b(?:places|placeCatalog)\b/)
  assert.match(provider, /\b(?:guides|guideCatalog|GUIDES)\b/)

  const guide = source('GuidePage.jsx')
  assert.match(importNames(guide, './saves.js'), /\bSaveHeart\b/)
  assert.match(guide, /kind:\s*['"]guide['"]/)
  assert.match(guide, /key:\s*[`'"]g\|/)
  assert.match(guide, /<SaveHeart\b/)

  const savesPage = source('MySavesPage.jsx')
  assert.match(savesPage, /\bopenGuide\b/)
  assert.match(savesPage, /kind\s*===\s*['"]guide['"]/)
  assert.match(savesPage, /kind\s*===\s*['"]place['"]|<ResultCard\b/)
  assert.match(savesPage, /resolution\s*===\s*['"](?:missing|ambiguous)['"]|No longer (?:listed|available)/)
  assert.match(savesPage, /\{\s*e\s*,\s*record\s*,\s*unavailable\b/)
  assert.match(savesPage, /unavailable\s*\?\s*\(\s*<div\b/)
  assert.match(savesPage, /await\s+remove\s*\(\s*record\s*\)/)
  assert.match(savesPage, /disabled=\{!canRemove\s*\(\s*record\s*\)\}/)
  assert.match(savesPage, /aria-busy=\{removing\s*\|\|\s*undefined\}/)
  assert.doesNotMatch(savesPage, /No saves yet[^\n]*(?:events only|on events)/i)

  const bridge = source('saves.js')
  assert.match(bridge, /const\s+remove\s*=\s*useCallback\s*\(\s*async\s*\(\s*record\s*\)/)
  assert.match(bridge, /const\s+key\s*=\s*recordKey\s*\(\s*record\s*\)/)
  assert.match(bridge, /await\s+removeSaved\s*\(\s*record\s*\)/)
})

test('session-only and terminal saved-state failures remain visible and retryable', () => {
  const app = source('App.jsx')
  assert.match(app, /savedBeen\.(?:status|durability)/)
  assert.match(app, /session-only/)
  assert.match(app, /(?:saves|saved)[\s\S]{0,220}?(?:this visit|haven.t been saved|not saved yet)/i)
  assert.match(app, /savedBeen\.retry(?:Persistence)?\s*\(/)
  assert.match(app, /(?:corrupt|error)/)
  assert.match(app, /(?:saves|saved)[\s\S]{0,220}?(?:could not be loaded|unavailable|couldn.t load)/i)
  assert.match(app, /role=\{[^}]*session-only[^}]*['"]status['"][^}]*['"]alert['"]/)

  const provider = source('SavedBeenProvider.jsx')
  assert.match(provider, /async\s+retry(?:Persistence)?\s*\(/)
  assert.match(provider, /await\s+store\.retryPersistence\s*\(/)
  assert.match(provider, /['"]session-only['"]/)
  assert.match(provider, /['"](?:corrupt|error)['"]/)
})
