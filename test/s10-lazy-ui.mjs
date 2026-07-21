import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')

test('non-Home tabs and route-only surfaces use dynamic imports', () => {
  const app = read('app/src/App.jsx')
  const directLazy = [
    'HotView',
    'LocationsView',
    'CalendarView',
    'ProfileView',
    'MyPlansPage',
    'MySavesPage',
    'EditProfilePage',
    'HelpFeedbackPage',
    'ForecastPage',
    'NotificationsPage',
    'FiltersSheet',
    'DetailPage',
    'PlaceDetail',
    'BubblePage',
    'PlaceBubblePage',
    'GuidePage',
    'SearchPage',
    'AddEvent',
    'DayPage',
    'CalendarPickerPage',
    'SettingsPage',
    'AttributionPage',
    'SharedPlanPage',
    'DataTransferRoute',
    'InterestEditor',
    'TastePanel',
    'CalibrationDeck',
    'LensDeck',
  ]
  for (const name of directLazy) {
    assert.match(
      app,
      new RegExp(`const\\s+${name}\\s*=\\s*lazy\\(\\(\\)\\s*=>\\s*import\\(['\"]\\./${name}\\.jsx['\"]\\)\\)`),
      `${name} must remain a direct React.lazy route boundary`,
    )
    assert.doesNotMatch(
      app,
      new RegExp(`import\\s+(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s+from\\s+['\"]\\./${name}\\.jsx['\"]`),
      `${name} must not also be imported eagerly`,
    )
  }
  assert.match(
    app,
    /const\s+PlacesDeck\s*=\s*lazy\(\(\)\s*=>\s*import\(['"]\.\/CalibrationDeck\.jsx['"]\)\.then\(/,
    'the named PlacesDeck export must share the lazy calibration chunk',
  )
  assert.match(app, /import HomeView from ['"]\.\/HomeView\.jsx['"]/, 'Home remains the sole eager tab surface')
})

test('lazy surfaces retain honest loading, first-focus, and focus-return contracts', () => {
  const app = read('app/src/App.jsx')
  assert.match(app, /import\s*\{[^}]*\blazy\b[^}]*\bSuspense\b[^}]*\}\s*from ['"]react['"]/)
  assert.match(app, /function SurfaceLoading\(\{ detail = false \}\)/)
  assert.match(app, /role=['"]status['"]/)
  assert.match(app, /aria-live=['"]polite['"]/)
  assert.match(app, /aria-label=['"]Loading this view['"]/)
  assert.match(app, /tabIndex=\{detail \? -1 : undefined\}/, 'detail loading fallback must receive focus')

  for (const tab of ['HotView', 'LocationsView', 'CalendarView', 'ProfileView']) {
    assert.match(
      app,
      new RegExp(`<Suspense\\s+fallback=\\{<SurfaceLoading\\s*/>\\}>[\\s\\S]{0,220}<${tab}\\b`),
      `${tab} must render under an honest loading fallback`,
    )
  }
  assert.match(
    app,
    /className=\{'subpage'[\s\S]{0,350}<Suspense fallback=\{<SurfaceLoading \/>\}>/,
    'route subpages must keep a stable focusable shell around Suspense',
  )
  assert.match(
    app,
    /<Suspense fallback=\{detail \? <SurfaceLoading detail \/> : null\}>/,
    'details must expose a focusable loading layer',
  )

  assert.match(app, /const focusReadyPage = \(\) =>/)
  assert.match(app, /const focusReadyDetail = \(\) =>/)
  assert.match(app, /new MutationObserver\(/, 'focus must react when a suspended route resolves')
  assert.match(app, /\.detail:not\(\.detail-loading-layer\)/)
  assert.match(app, /observer\?\.disconnect\(\)/, 'route focus observer must clean up')
  assert.match(app, /restoreLayerFocus\(target, appRef\.current\)/, 'page close must restore base focus')
  assert.match(
    app,
    /restoreLayerFocus\(target, pageLayerRef\.current \|\| appRef\.current\)/,
    'detail close must restore the launching layer',
  )
})

test('place data and full local-state transfer remain request-driven', () => {
  const app = read('app/src/App.jsx')
  const activity = read('app/src/ActivityProvider.jsx')
  const planner = read('app/src/PlannerProvider.jsx')
  const transferRoute = read('app/src/DataTransferRoute.jsx')

  assert.match(app, /const directPlaceRequested = routeIntent\?\.route\?\.target\?\.kind === ['"]place['"]/)
  assert.match(app, /useArtifact\(['"]places['"], directPlaceRequested\)/)
  assert.match(activity, /useArtifact\(['"]places['"], false\)/)
  assert.match(planner, /usePlaces\(false\)/)
  assert.doesNotMatch(app, /import\s+\{?\s*StateTransferProvider/)
  assert.match(transferRoute, /import\s+\{\s*StateTransferProvider\s*\}\s+from ['"]\.\/StateTransferProvider\.jsx['"]/)
  assert.match(transferRoute, /<StateTransferProvider city=\{city\}>[\s\S]*<DataTransferPage \/>/)
})
