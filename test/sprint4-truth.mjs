import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const files = Object.fromEntries(await Promise.all([
  'HomeView.jsx',
  'HotView.jsx',
  'SearchPage.jsx',
  'SettingsPage.jsx',
  'BubblePage.jsx',
  'PlaceBubblePage.jsx',
  'PickerSheet.jsx',
  'cards.jsx',
  'places.js',
  'taste.js',
].map(async (name) => [name, await readFile(new URL(`../app/src/${name}`, import.meta.url), 'utf8')])))

test('recommendation surfaces use evidence-bounded labels', () => {
  assert.match(files['HomeView.jsx'], /<SecHead title="Tonight's events"/)
  assert.doesNotMatch(files['HomeView.jsx'], /<SecHead title="Tonight's top picks"/)
  assert.match(files['HotView.jsx'], /title="Tonight's events"/)
  assert.match(files['HotView.jsx'], /<SecHead title="Plan ahead" sub="Upcoming events to consider\."/)
  assert.doesNotMatch(files['PickerSheet.jsx'], />★ Top pick</)
  assert.match(files['PickerSheet.jsx'], />Suggested first</)
})

test('place UI does not publish unsupported open, gem, or best claims', () => {
  assert.match(files['places.js'], /label: 'Hours listed'/)
  assert.doesNotMatch(files['places.js'], /label: 'Open Now'/)
  assert.match(files['places.js'], /label: 'More to explore'/)
  assert.doesNotMatch(files['cards.jsx'], /aria-label="Hidden gem"|> Best for:/)
  assert.match(files['cards.jsx'], /> Good for: \{bestFor\}/)
  assert.doesNotMatch(files['taste.js'], /r\.push\('💎 Hidden gem'\)/)
  assert.match(files['PlaceBubblePage.jsx'], /Browse this collection\./)
  assert.doesNotMatch(files['PlaceBubblePage.jsx'], /Picked fresh for you\./)
})

test('Search count follows its active scope and names every searchable kind', () => {
  assert.match(files['SearchPage.jsx'], /const visibleTotal = activeTab === 'events'/)
  assert.match(files['SearchPage.jsx'], /\{visibleTotal\.toLocaleString\(fmtLocale\)\} result/)
  assert.doesNotMatch(files['SearchPage.jsx'], /verified result/)
  assert.match(files['SearchPage.jsx'], /aria-label="Search events, spots, and guides"/)
  assert.match(files['SearchPage.jsx'], /label: 'Event matches'/)
})

test('local-state copy distinguishes retained value from remote resources', () => {
  assert.match(files['SettingsPage.jsx'], /Plans, saves, and taste stay on this device/)
  assert.match(files['SettingsPage.jsx'], /Listings, weather, and images load from credited sources/)
  assert.doesNotMatch(files['SettingsPage.jsx'], /nothing leaves it/)
})

test('daily refresh cadence fits inside the immutable 48-hour artifact window', async () => {
  const workflow = await readFile(new URL('../.github/workflows/refresh.yml', import.meta.url), 'utf8')
  assert.match(workflow, /name: Daily data refresh/)
  assert.match(workflow, /cron: '23 9 \* \* \*'/)
  assert.match(workflow, /ref: main[\s\S]*fetch-depth: 0/)
  assert.match(workflow, /git fetch origin main[\s\S]*git rev-parse origin\/main/)
  assert.match(workflow, /cancel-in-progress: true/)
  assert.doesNotMatch(workflow, /Weekly data refresh|Automated weekly data refresh/)
})
