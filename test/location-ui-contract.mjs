import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, settings, bubble] = await Promise.all([
  readFile(new URL('../app/src/App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/SettingsPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/BubblePage.jsx', import.meta.url), 'utf8'),
])

test('App uses one shared location provider and only exposes granted coordinates', () => {
  assert.match(app, /<LocationProvider city=\{city\}>[\s\S]*<Shell \/>[\s\S]*<\/LocationProvider>/)
  assert.match(app, /const location = useLocationPermission\(\)/)
  assert.match(app, /const coords = location\.usableCoords/)
  assert.doesNotMatch(app, /navigator\.geolocation/)
  assert.doesNotMatch(app, /location-allowed-v1/)
  assert.doesNotMatch(app, /\brequestCoords\b|\blocAllowed\b|\bsetLocAllowed\b/)
})

test('Settings shows effective permission truth rather than stored intent', () => {
  assert.match(settings, /const location = useLocationPermission\(\)/)
  assert.match(settings, /aria-pressed=\{location\.enabled\}/)
  assert.match(settings, /location\.enabled \? location\.disable\(\) : location\.request\(\)/)
  assert.match(settings, /location\.status === 'denied'/)
  assert.match(settings, /Blocked in browser settings/)
  assert.match(settings, /outside \$\{CITY\.name\}/)
  assert.doesNotMatch(settings, /\blocationAllowed\b|\bonAllowLocation\b/)
})

test('Near Me consumes the shared request state and cannot maintain a second permission truth', () => {
  assert.match(bubble, /const location = useLocationPermission\(\)/)
  assert.match(
    bubble,
    /const locate = \(\) => location\.status === 'granted'[\s\S]*location\.refresh\(\)[\s\S]*location\.request\(\)/,
  )
  assert.match(bubble, /location\.status === 'requesting'/)
  assert.match(bubble, /location\.status === 'denied'/)
  assert.match(bubble, /coords \? 'Events by day and distance' : `Events across \$\{CITY\.name\}`/)
  assert.match(bubble, /Closest within each day/)
  assert.doesNotMatch(bubble, /Good times, walking distance/)
  assert.doesNotMatch(bubble, /near:\s*'Near you'/)
  assert.doesNotMatch(bubble, /near:\s*'Nothing nearby/)
  assert.doesNotMatch(bubble, /\brequestCoords\b|\blocState\b|\bsetLocState\b/)
})
