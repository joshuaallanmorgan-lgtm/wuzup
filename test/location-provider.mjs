import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'

const source = await readFile(new URL('../app/src/LocationProvider.jsx', import.meta.url), 'utf8')
const vite = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})
const providerModule = await vite.ssrLoadModule('/src/LocationProvider.jsx')
after(() => vite.close())

test('LocationProvider loads through Vite and exports the provider contract', () => {
  assert.equal(typeof providerModule.LocationProvider, 'function')
  assert.equal(typeof providerModule.useLocationPermission, 'function')
})

test('controller construction is effect-owned and StrictMode-cleaned', () => {
  assert.match(source, /useSyncExternalStore/)
  assert.match(source, /createControllerHolder/)
  assert.match(source, /controller = controllerFactoryRef\(/)
  assert.match(source, /controller\?\.destroy\(\)/)
  assert.match(source, /key=\{cityKey\}/)
  assert.doesNotMatch(source, /useMemo\(\(\) => createLocationPermissionController/)
})

test('the provider exposes one shared controller instead of browser permission logic', () => {
  assert.match(source, /controller\.initialize\(\)/)
  assert.match(source, /controller\.request\(\)/)
  assert.match(source, /controller\.refresh\(\)/)
  assert.match(source, /controller\.disable\(\)/)
  assert.match(source, /controller\.setDesired\(on\)/)
  assert.doesNotMatch(source, /navigator\.(?:geolocation|permissions)/)
  assert.doesNotMatch(source, /location-allowed-v1/)
})

test('provider failures never claim location is enabled', () => {
  assert.match(
    source,
    /status:\s*'error',[\s\S]*desired:\s*false,[\s\S]*enabled:\s*false,[\s\S]*coords:\s*null/,
  )
  assert.match(source, /code:\s*'location-controller-unavailable'/)
})

test('the provider exposes only active-market coordinates to product sorting', () => {
  assert.match(source, /coordsInCityMarket\(snapshot\.coords,\s*selectedCity\)/)
  assert.match(source, /const usableCoords = inMarket \? snapshot\.coords : null/)
  assert.match(source, /\binMarket,\s*\n\s*usableCoords,/)
})

test('late initialization rejection cannot overwrite a replacement controller', () => {
  assert.match(source, /let active = true/)
  assert.match(
    source,
    /if \(!active \|\| holder\.getSnapshot\(\)\.controller !== controller\) return/,
  )
  assert.match(source, /active = false[\s\S]*holder\.clear\(controller\)/)
})
