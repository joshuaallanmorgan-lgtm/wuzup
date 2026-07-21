import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { createStorageScope, physicalKey } from '../app/src/storage.js'

const [main, app, settings, editor, selector, provider, styles, viteConfig] = await Promise.all([
  readFile(new URL('../app/src/main.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/SettingsPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/EditProfilePage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/CityCoverageSelector.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/RuntimeCityProvider.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/runtime-city.css', import.meta.url), 'utf8'),
  readFile(new URL('../app/vite.config.js', import.meta.url), 'utf8'),
])

const vite = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})
const providerModule = await vite.ssrLoadModule('/src/RuntimeCityProvider.jsx')
after(() => vite.close())

function memoryBackend() {
  const rows = new Map()
  return {
    getItem: (key) => rows.has(key) ? rows.get(key) : null,
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: (key) => rows.delete(key),
    key: (index) => [...rows.keys()][index] ?? null,
    get length() { return rows.size },
  }
}

test('runtime city provider and failure surface load through Vite', () => {
  assert.equal(typeof providerModule.RuntimeCityProvider, 'function')
  assert.equal(typeof providerModule.RuntimeCityFailure, 'function')
  assert.equal(typeof providerModule.useRuntimeCity, 'function')
})

test('bootstrap refuses bad runtime identity before mounting the application', () => {
  assert.doesNotMatch(main, /import App from/)
  assert.match(main, /if \(RUNTIME_CITY\.ok\)/)
  assert.match(main, /import\('\.\/App\.jsx'\)/)
  assert.match(main, /<RuntimeCityProvider selection=\{RUNTIME_CITY\}>/)
  assert.match(main, /<RuntimeCityFailure selection=\{RUNTIME_CITY\}/)
  assert.match(provider, /CITY_APP_LOAD_FAILED/)
  assert.match(provider, /Try loading Wuzup again/)
})

test('every active city-scoped provider receives the runtime city explicitly', () => {
  for (const provider of [
    'CustomEventsProvider',
    'ActivityProvider',
    'LocationProvider',
    'SavedBeenProvider',
    'PlannerProvider',
  ]) {
    assert.match(app, new RegExp(`<${provider}[\\s\\S]{0,180}city=\\{city\\}`), `${provider} must receive runtime city`)
  }
  assert.match(app, /data-city-id=\{city\.id\}/)
  assert.match(app, /data-manifest-id=\{artifactBinding\.ok \? artifactBinding\.manifestId/)
  assert.match(app, /bindRuntimeCityArtifact\(runtimeCity, eventArtifact\.meta\)/)
})

test('coverage selection is real navigation with literal current-area truth', () => {
  assert.match(settings, /<CityCoverageSelector \/>/)
  assert.match(editor, /<CityCoverageSelector compact \/>/)
  assert.doesNotMatch(editor, /Preferred city|Profile visibility|Coming soon/)
  assert.match(selector, /href=\{destination\.href\}/)
  assert.match(selector, /destination\.available && destination\.href/)
  assert.match(selector, /Not available from this local build/)
  assert.match(selector, /aria-current="location"/)
  assert.match(selector, /Plans, saves, taste, and location settings stay separate/)
  assert.match(selector, /destination\.coverageDetail/)
  assert.match(styles, /color:\s*var\(--accent-ink, #ad5116\)/)
  assert.doesNotMatch(styles, /is-unavailable\s*\{[^}]*opacity:/s)
  assert.match(viteConfig, /globalThis\.__WUZUP_PRODUCT_ROOT__/)
})

test('Tampa to SF to Tampa preserves separate retained domains on one origin', () => {
  const backend = memoryBackend()
  const tampa = createStorageScope({ backend, cityId: 'tampa-bay' })
  const sf = createStorageScope({ backend, cityId: 'sf-east-bay' })
  const domains = [
    'planner-v2',
    'custom-events-v2',
    'saved-been-v2',
    'activity-v2',
    'taste-v1',
    'location-permission-v2',
    'primer-v1',
  ]

  for (const domain of domains) {
    assert.equal(tampa.set(domain, `tampa:${domain}`), true)
    assert.equal(sf.get(domain, null), null)
    assert.equal(sf.set(domain, `sf:${domain}`), true)
    assert.equal(tampa.get(domain, null), `tampa:${domain}`)
    assert.equal(sf.get(domain, null), `sf:${domain}`)
    assert.notEqual(
      physicalKey(domain, { cityId: 'tampa-bay' }),
      physicalKey(domain, { cityId: 'sf-east-bay' }),
    )
  }
})
