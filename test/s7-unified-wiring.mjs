import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function appSource(name) {
  return readFileSync(join(ROOT, 'app', 'src', name), 'utf8')
}

const EVENT_DISCOVERY = [
  'HotView.jsx',
  'BubblePage.jsx',
  'DetailPage.jsx',
  'deckdeal.js',
  'lensdeal.js',
]

const SPOT_DISCOVERY = [
  'LocationsView.jsx',
  'PlaceBubblePage.jsx',
  'PlaceDetail.jsx',
]

test('Sprint 7 event discovery routes through the shared runtime rank adapter', () => {
  for (const name of EVENT_DISCOVERY) {
    const source = appSource(name)
    assert.match(source, /rankRuntimeItems|rankTonightCandidates/, `${name} must use the shared rank adapter`)
    assert.doesNotMatch(source, /\bhotDesc\b/, `${name} must not keep the legacy hotScore comparator`)
    assert.doesNotMatch(source, /\borderDay\b/, `${name} must not keep the legacy per-shelf quality order`)
    assert.doesNotMatch(source, /\bfrontPagePredicate\b/, `${name} must not keep the legacy front-page quality gate`)
  }
})

test('Sprint 7 Spots surfaces use evidence rank and never image-first quality', () => {
  for (const name of SPOT_DISCOVERY) {
    const source = appSource(name)
    assert.match(source, /rankSpots\(/, `${name} must use the inspectable Spots rank adapter`)
    assert.doesNotMatch(source, /\bphotoFirst\b/, `${name} must not rank a place by image availability`)
    assert.doesNotMatch(source, /\bnearest\s*\(/, `${name} must not rank a place by distance alone`)
  }

  const locations = appSource('LocationsView.jsx')
  assert.doesNotMatch(locations, /Recommended near you|Worth the drive/i)
  assert.match(locations, /withinRadius/, 'the Near shelf must use the explicit radius view')
})

test('Sprint 7 curation is bounded rank, not a hotScore admission gate', () => {
  const curate = appSource('curate.js')
  assert.doesNotMatch(curate, /export function frontPagePredicate/)
  assert.doesNotMatch(curate, /FRONT_HOT|FRONT_BUZZ/)
  assert.match(curate, /curatedLimit/)
  assert.match(curate, /ordered\.slice\(0, remaining\)/)
})

test('Sprint 7 intent surfaces share objective rank without changing membership', () => {
  const intentSources = [
    appSource('search.js'),
    appSource('guides.js'),
    appSource('weekend.js'),
  ]
  for (const source of intentSources) assert.match(source, /rankRuntimeItems/)

  const combined = intentSources.join('\n')
  assert.doesNotMatch(combined, /\bhotDesc\b/)
  assert.doesNotMatch(combined, /\borderDay\b/)
})

test('Sprint 7 visible recommendation reasons cannot fork from legacy taste math', () => {
  for (const name of ['HotView.jsx', 'DayPage.jsx', 'DetailPage.jsx']) {
    const source = appSource(name)
    assert.doesNotMatch(source, /\btasteNudge\b|\bwhyFits\b|\bwhyReasons\b/, `${name} must read shared scored evidence or stay silent`)
  }

  const day = appSource('DayPage.jsx')
  assert.match(day, /const agenda = agendaRanking\.ordered/)
  assert.match(day, /agendaRanking\.scored/)
  assert.doesNotMatch(day, /return rankRuntimeItems\([\s\S]{0,700}?\)\.ordered\s*\n\s*\}, \[availableEvents/)
})

test('Sprint 7 context keys share runtime identity for id-less custom events', () => {
  for (const name of ['BubblePage.jsx', 'DayPage.jsx', 'search.js']) {
    const source = appSource(name)
    assert.match(source, /runtimeRankingId\(event|runtimeRankingId\(item/, `${name} must key context with projected runtime identity`)
  }
})

test('Sprint 7 shelf copy only claims evidence the selector proves', () => {
  const home = appSource('HomeView.jsx')
  const hot = appSource('HotView.jsx')
  assert.doesNotMatch(`${home}\n${hot}`, /varied options|reliable weeklies|you can count on/i)
  assert.match(home, /Three options with enough detail/)
  assert.match(hot, /More dates are listed for these events/)
})
