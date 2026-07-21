import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = Object.fromEntries(await Promise.all([
  ['index', '../app/index.html'],
  ['cards', '../app/src/cards.jsx'],
  ['imageMode', '../app/src/imageMode.js'],
  ['detail', '../app/src/DetailPage.jsx'],
  ['placeDetail', '../app/src/PlaceDetail.jsx'],
  ['settings', '../app/src/SettingsPage.jsx'],
  ['vite', '../app/vite.config.js'],
].map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), 'utf8')])))

test('document policy sends no referrer and narrows network-capable resource types', () => {
  assert.match(source.index, /<meta name="referrer" content="no-referrer"/)
  assert.match(source.index, /default-src 'self'/)
  assert.match(source.index, /object-src 'none'/)
  assert.match(source.index, /frame-src 'none'/)
  assert.match(source.index, /worker-src 'none'/)
  assert.match(source.index, /script-src 'self';/)
  assert.doesNotMatch(source.index, /script-src[^;"]*unsafe-inline/)
  assert.match(source.index, /img-src 'self' data: blob: https:\/\/upload\.wikimedia\.org/)
  assert.match(source.index, /connect-src 'self' https:\/\/api\.open-meteo\.com/)
  assert.doesNotMatch(source.index, /localhost|127\.0\.0\.1|\bws:|\bwss:/)
  assert.doesNotMatch(source.index, /img-src[^;"]+https:\s|img-src[^;"]+https:\*/)
  assert.match(source.index, /online-required and never implies offline cache/)
  assert.match(source.vite, /name: 'development-csp'[\s\S]*?apply: 'serve'/)
  assert.match(source.vite, /script-src 'self' 'unsafe-inline'/)
  assert.match(source.vite, /ws:\/\/localhost:\* ws:\/\/127\.0\.0\.1:\*/)
})

test('all card and detail photo elements decode asynchronously without a referrer', () => {
  for (const name of ['cards', 'detail', 'placeDetail']) {
    assert.match(source[name], /decoding="async"/, `${name} must request async image decode`)
    assert.match(source[name], /referrerPolicy="no-referrer"/, `${name} must suppress referrers explicitly`)
  }
  assert.doesNotMatch(source.detail, /backgroundImage:\s*`url\(/)
  assert.doesNotMatch(source.placeDetail, /backgroundImage:\s*`url\(/)
})

test('event cards and detail use the same explicit image receipt policy', () => {
  for (const name of ['cards', 'detail']) {
    assert.match(source[name], /presentRuntimeImage\(e, \{ policy: RUNTIME_EVENT_IMAGE_POLICY \}\)/)
  }
  assert.match(source.cards, /auroraUnderlay = showArt \|\| !ok/)
  assert.match(source.detail, /heroArt \|\| heroLoading \? ' imgbox-art'/)
  assert.match(source.imageMode, /presentRuntimeImage\(e, \{ policy: RUNTIME_EVENT_IMAGE_POLICY \}\)/)
  assert.doesNotMatch(source.imageMode, /typeof e\.image === 'string'/)
})

test('saved raw image snapshots have no rendering bypass around the shared gate', async () => {
  const saves = await readFile(new URL('../app/src/saves.js', import.meta.url), 'utf8')
  assert.match(saves, /image: e\.image \?\? null/)
  assert.doesNotMatch(saves, /<img|createElement\(['"]img|backgroundImage/)
  assert.match(source.cards, /presentRuntimeImage\(e, \{ policy: RUNTIME_EVENT_IMAGE_POLICY \}\)/)
})

test('place heroes preserve credited imagery and scope failure to the current URL', () => {
  assert.match(source.placeDetail, /presentRuntimeImage\(e\)/)
  assert.match(source.placeDetail, /failedSrc === heroImage/)
  assert.doesNotMatch(source.placeDetail, /useState\(false\)[\s\S]{0,80}heroFailed/)
  assert.match(source.placeDetail, /presentedImage\.imageCredit/)
})

test('privacy and offline copy names real local and remote behavior', () => {
  assert.match(source.settings, /stay in this browser/)
  assert.match(source.settings, /downloads listings from this site/)
  assert.match(source.settings, /forecasts from Open-Meteo/)
  assert.match(source.settings, /Offline mode is not available yet/)
  assert.match(source.settings, /Your browser reports that it is offline/)
})
