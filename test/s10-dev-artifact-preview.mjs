import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('dev-city grants the expired preview flag only to Vite serve', () => {
  const source = read('finder/dev-city.mjs')
  assert.match(source, /const EXPIRED_PREVIEW_FLAG = 'VITE_ALLOW_EXPIRED_ARTIFACT_PREVIEW'/)
  assert.match(source, /delete env\[EXPIRED_PREVIEW_FLAG\]/)
  assert.match(source, /const viteServe = process\.env\.DEV_LAUNCH_PROBE !== '1' && \['serve', 'dev'\]\.includes\(viteCommand\)/)
  assert.match(source, /if \(viteServe\) \{[\s\S]*?viteEnv\[EXPIRED_PREVIEW_FLAG\] = '1'/)
  assert.match(source, /DEVELOPMENT-ONLY EXPIRED ARTIFACT PREVIEW ENABLED/)
  assert.match(source, /env: viteEnv/)
})

test('browser runtime requires both Vite DEV and the explicit preview flag', () => {
  const source = read('app/src/artifacts.js')
  assert.match(source, /const DEVELOPMENT_EXPIRED_PREVIEW = import\.meta\.env\?\.DEV === true[\s\S]*?VITE_ALLOW_EXPIRED_ARTIFACT_PREVIEW === '1'/)
  assert.match(source, /allowDevelopmentExpiredPreview = false/)
  assert.match(source, /expired && !options\.allowDevelopmentExpiredPreview/)
  assert.match(source, /developmentExpired: true/)
  assert.match(source, /allowDevelopmentExpiredPreview: DEVELOPMENT_EXPIRED_PREVIEW/)
})

test('Settings identifies expired development bytes without freshness claims', () => {
  const source = read('app/src/SettingsPage.jsx')
  assert.match(source, /dataMeta\?\.developmentExpired/)
  assert.match(source, /Development preview only: these listings are expired/)
  assert.match(source, /artifact hashes were verified/)
  assert.match(source, /production Wuzup still refuses these bytes/)
})
