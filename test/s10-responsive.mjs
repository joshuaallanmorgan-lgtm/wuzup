import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')

const OWNED_CSS = [
  'app/src/index.css',
  'app/src/App.css',
  'app/src/cards.css',
  'app/src/addevent.css',
  'app/src/filters.css',
  'app/src/primer.css',
  'app/src/topnav.css',
  'app/src/weekend.css',
  'app/src/locations.css',
  'app/src/profile.css',
  'app/src/calendar.css',
  'app/src/settings.css',
  'app/src/data-transfer.css',
  'app/src/attribution.css',
  'app/src/forecast.css',
  'app/src/notifications.css',
  'app/src/day.css',
]

test('one centered mobile-shell token replaces duplicated phone-frame constants', () => {
  const index = read('app/src/index.css')
  const app = read('app/src/App.css')
  const primer = read('app/src/primer.css')
  const filters = read('app/src/filters.css')
  const topnav = read('app/src/topnav.css')
  const weekend = read('app/src/weekend.css')
  const day = read('app/src/day.css')

  assert.match(index, /--canvas-max:\s*460px/)
  assert.match(index, /--reading-max:\s*460px/)
  assert.match(index, /--detail-max:\s*460px/)
  assert.match(index, /--sheet-max:\s*460px/)
  assert.match(index, /#root\s*\{[^}]*max-width:\s*var\(--canvas-max\)[^}]*margin:\s*0 auto/s)

  assert.match(app, /\.tabbar\s*\{[^}]*max-width:\s*var\(--canvas-max\)/s)
  assert.match(app, /\.subpage\s*\{[^}]*max-width:\s*var\(--canvas-max\)/s)
  assert.match(app, /\.detail\s*\{[^}]*max-width:\s*var\(--detail-max\)/s)
  assert.match(primer, /\.primer\s*\{[^}]*max-width:\s*var\(--reading-max\)/s)
  assert.match(filters, /\.flt-sheet\s*\{[^}]*max-width:\s*var\(--sheet-max\)/s)
  assert.match(topnav, /\.tn-sheet-wrap\s*\{[^}]*max-width:\s*var\(--canvas-max\)/s)
  assert.match(topnav, /\.tn-sheet\s*\{[^}]*max-width:\s*var\(--sheet-max\)/s)
  assert.match(weekend, /\.wkb-sheet-wrap\s*\{[^}]*max-width:\s*var\(--canvas-max\)/s)
  assert.match(weekend, /\.wkb-sheet\s*\{[^}]*max-width:\s*var\(--sheet-max\)/s)
  assert.match(day, /\.dpg-menu\s*\{[^}]*max-width:\s*var\(--sheet-max\)/s)

  for (const file of OWNED_CSS) {
    assert.doesNotMatch(read(file), /max-width:\s*460px/, `${file} must use the shared mobile-shell tokens`)
  }
})

test('320/390 layouts protect readable cards, forms, and transient UI', () => {
  const index = read('app/src/index.css')
  const app = read('app/src/App.css')
  const cards = read('app/src/cards.css')
  const addEvent = read('app/src/addevent.css')

  assert.match(index, /@media \(max-width:\s*359px\)[\s\S]*--gutter:\s*14px/)
  assert.match(index, /@media \(max-width:\s*359px\)[\s\S]*--card-row-h:\s*150px/)
  assert.match(cards, /\.gem\s*\{[^}]*min-height:\s*var\(--card-row-h\)[^}]*height:\s*auto/s)
  assert.match(cards, /\.gem-main\s*\{[^}]*padding-bottom:\s*52px/s)
  assert.match(cards, /@media \(max-width:\s*359px\)[\s\S]*\.gem-img,[\s\S]*flex-basis:\s*88px/)
  assert.match(addEvent, /@media \(max-width:\s*479px\)[\s\S]*\.ae-2col\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(cards, /\.card-toast\s*\{[^}]*width:\s*min\(var\(--toast-max\),\s*calc\(100vw - \(2 \* var\(--gutter\)\)\)\)/s)
  assert.match(cards, /\.card-toast\s*\{[^}]*white-space:\s*normal/s)
  assert.match(cards, /\.card-toast\s*\{[^}]*overflow-wrap:\s*anywhere/s)
  assert.match(app, /@media \(max-width:\s*359px\)[\s\S]*\.tune-preview\s*\{\s*display:\s*none/)
  assert.doesNotMatch(app, /\.tune-pc-no\s*\{[^}]*opacity:/s)
  assert.match(app, /\.tune-pc-no \.tune-pc-img\s*\{[^}]*filter:\s*grayscale\(0\.65\)[^}]*opacity:\s*0\.62/s)
  const tuneEntrance = app.match(/@keyframes tune-in\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const rowEntrance = cards.match(/@keyframes rowIn\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.doesNotMatch(tuneEntrance, /opacity\s*:/, 'taste content must remain fully opaque while entering')
  assert.doesNotMatch(rowEntrance, /opacity\s*:/, 'event rows must remain fully opaque while entering')
})

test('larger viewports preserve the centered single-column mobile product', () => {
  const index = read('app/src/index.css')
  const app = read('app/src/App.css')
  const cards = read('app/src/cards.css')

  assert.doesNotMatch(index, /--gutter:\s*(?:28|32)px/)
  assert.doesNotMatch(cards, /@media \(min-width:\s*(?:768|1120)px\)/)
  assert.match(app, /\.home-picks\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/s)
  assert.match(cards, /\.gems\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/s)
  assert.match(cards, /\.carousel\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto/s)
  assert.match(cards, /\.nbhd-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s)
  assert.doesNotMatch(cards, /grid-template-columns:\s*repeat\(3,/)
  assert.match(app, /\.tabbar\s*\{[^}]*max-width:\s*var\(--canvas-max\)/s)
})

test('reading surfaces stay bounded and primary mobile controls meet 44px targets', () => {
  const app = read('app/src/App.css')
  const addEvent = read('app/src/addevent.css')
  const calendar = read('app/src/calendar.css')
  const filters = read('app/src/filters.css')
  const locations = read('app/src/locations.css')
  const profile = read('app/src/profile.css')
  const topnav = read('app/src/topnav.css')
  const weekend = read('app/src/weekend.css')
  const settings = read('app/src/settings.css')
  const transfer = read('app/src/data-transfer.css')
  const attribution = read('app/src/attribution.css')
  const forecast = read('app/src/forecast.css')
  const notifications = read('app/src/notifications.css')

  assert.match(addEvent, /\.ae-form\s*\{[^}]*max-width:\s*var\(--reading-max\)/s)
  assert.match(calendar, /\.cal-wrap\s*\{[^}]*max-width:\s*var\(--reading-max\)/s)
  assert.match(profile, /\.pf-head\s*\{[^}]*max-width:\s*var\(--reading-max\)/s)
  assert.match(profile, /\.ep-body\s*\{[^}]*max-width:\s*var\(--reading-max\)/s)
  assert.match(locations, /\.loc-plan-sheet\s*\{[^}]*max-width:\s*var\(--sheet-max\)/s)
  assert.match(settings, /\.st-body\s*\{[^}]*max-width:\s*var\(--reading-max\)[^}]*margin-inline:\s*auto/s)
  assert.match(transfer, /\.data-transfer-body\s*\{[^}]*max-width:\s*var\(--reading-max\)[^}]*margin-inline:\s*auto/s)
  assert.match(attribution, /\.at-body\s*\{[^}]*max-width:\s*var\(--reading-max\)[^}]*margin-inline:\s*auto/s)
  assert.match(forecast, /\.fc-pg \.pg-body\s*\{[^}]*max-width:\s*var\(--reading-max\)[^}]*margin-inline:\s*auto/s)
  assert.match(notifications, /\.notif-list\s*\{[^}]*max-width:\s*var\(--reading-max\)[^}]*margin-inline:\s*auto/s)

  for (const [label, source, contract] of [
    ['Home notification', app, /\.home-search\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
    ['Page back', app, /\.pg-back\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
    ['Detail back', app, /\.detail-back\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
    ['Filter close', filters, /\.flt-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
    ['Category sheet close', topnav, /\.tn-sheet-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
    ['Picker close', weekend, /\.wkb-sheet-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
    ['Place share', locations, /\.detail-share\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
    ['Profile edit', profile, /\.pf-edit\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s],
  ]) {
    assert.match(source, contract, `${label} target must remain at least 44px square`)
  }
})

test('responsive work preserves pager, safe-area, and reduced-motion contracts', () => {
  const app = read('app/src/App.css')
  const primer = read('app/src/primer.css')
  const topnav = read('app/src/topnav.css')
  const weekend = read('app/src/weekend.css')

  assert.match(app, /\.pager\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory/s)
  assert.match(app, /\.page\s*\{[^}]*overflow-x:\s*hidden/s)
  assert.match(app, /env\(safe-area-inset-bottom\)/)
  assert.match(app, /@media \(prefers-reduced-motion:\s*reduce\)/)
  assert.match(primer, /@media \(prefers-reduced-motion:\s*reduce\)/)
  assert.match(topnav, /@media \(prefers-reduced-motion:\s*reduce\)/)
  assert.match(weekend, /@media \(prefers-reduced-motion:\s*reduce\)/)

  for (const file of OWNED_CSS) {
    const css = read(file)
    assert.equal(
      (css.match(/\{/g) || []).length,
      (css.match(/\}/g) || []).length,
      `${file} must keep balanced rule blocks`,
    )
  }
})
