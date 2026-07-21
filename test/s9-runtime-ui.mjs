import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (name) => readFileSync(new URL(`../app/src/${name}`, import.meta.url), 'utf8')

test('the app exposes one city-bound, backup-gated full-state replacement surface', () => {
  const app = read('App.jsx')
  const route = read('DataTransferRoute.jsx')
  const provider = read('StateTransferProvider.jsx')
  const page = read('DataTransferPage.jsx')
  const settings = read('SettingsPage.jsx')

  assert.match(app, /lazy\(\(\) => import\('\.\/DataTransferRoute\.jsx'\)\)/)
  assert.match(app, /<DataTransferRoute city=\{city\}/)
  assert.match(route, /<StateTransferProvider city=\{city\}>/)
  assert.match(route, /<DataTransferPage/)
  assert.match(app, /page\.type === 'datatransfer'/)
  assert.match(settings, /openDataTransfer/)
  for (const section of [
    'customEvents', 'corrections', 'planner', 'savedBeen', 'activity',
    'taste', 'primer', 'searchRecents',
  ]) assert.match(provider, new RegExp(`${section}:`), section)
  assert.match(provider, /globalProfile/)
  assert.match(provider, /expectedCommitId/)
  assert.doesNotMatch(provider, /allowCorrupt: true/)
  assert.match(provider, /STATE_TRANSFER_BACKUP_VERSION/)
  assert.match(provider, /lsReadDurable\(STATE_TRANSFER_BACKUP_KEY\)/)
  assert.match(provider, /mode !== 'replace'/)
  assert.match(page, /Current location, permission state, weather, listings, and caches are never included/)
  assert.match(page, /Review and restore backup/)
})

test('durable route, share, edit, shared-plan, and correction seams are reachable and honest', () => {
  const app = read('App.jsx')
  const nav = read('nav.jsx')
  const detail = read('DetailPage.jsx')
  const place = read('PlaceDetail.jsx')
  const day = read('DayPage.jsx')
  const shared = read('SharedPlanPage.jsx')
  const correction = read('CorrectionSheet.jsx')

  assert.match(app, /currentEvents\(normalized\.slice\(0, events\.length\)\)/)
  assert.match(app, /currentEvents\(normalized\.slice\(events\.length\)\)/)
  assert.match(app, /directPlaceRequested/)
  assert.match(app, /RouteUnavailablePage/)
  assert.match(nav, /return route\.target \? absoluteHref\(route\) : null/)
  assert.match(detail, /writeText\(url \|\| text\)/)
  assert.match(place, /writeText\(url \|\| text\)/)
  assert.match(day, /planCapsuleFragment/)
  assert.match(shared, /Opening it did not change your plans/i)
  assert.match(detail, /Edit this event/)
  assert.match(detail, /Suggest a correction/)
  assert.match(place, /Suggest a correction/)
  assert.match(correction, /does not claim automatic delivery or monitoring/)
})
