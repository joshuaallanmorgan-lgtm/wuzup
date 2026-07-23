import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const APP_SRC = new URL('../app/src/', import.meta.url)
const read = (file) => readFileSync(new URL(file, APP_SRC), 'utf8')

test('current location is a stable-name switch with state in aria-checked', () => {
  const source = read('SettingsPage.jsx')
  const start = source.indexOf('className="st-row st-row-toggle"')
  assert.ok(start >= 0)
  const control = source.slice(start, start + 500)
  assert.match(control, /role="switch"/)
  assert.match(control, /aria-checked=\{Boolean\(location\.enabled\)\}/)
  assert.match(control, /aria-label="Use current location"/)
  assert.doesNotMatch(control, /aria-pressed|Turn off location/)
})

test('nullable event categories are independent toggle chips, not radios', () => {
  const source = read('AddEvent.jsx')
  assert.match(source, /id="ae-category-label">Category/)
  assert.match(source, /className="ae-cats" role="group" aria-labelledby="ae-category-label"/)
  assert.match(source, /aria-pressed=\{f\.cat === c\.value\}/)
  assert.match(source, /onClick=\{\(\) => set\('cat'\)\(f\.cat === c\.value \? null : c\.value\)\}/)
  assert.doesNotMatch(source, /role="radiogroup"|role="radio"/)
})

test('picker tabs and panels have stable two-way relationships and hide inactivity', () => {
  const source = read('PickerSheet.jsx')
  const modal = read('ModalSheet.jsx')
  assert.match(source, /suggested: 'picker-tab-suggested'/)
  assert.match(source, /saved: 'picker-panel-saved'/)
  assert.match(source, /id=\{PICKER_TAB_IDS\.suggested\}[\s\S]*?role="tab"[\s\S]*?aria-controls=\{PICKER_PANEL_IDS\.suggested\}/)
  assert.match(source, /id=\{PICKER_PANEL_IDS\.suggested\}[\s\S]*?role="tabpanel"[\s\S]*?aria-labelledby=\{PICKER_TAB_IDS\.suggested\}[\s\S]*?hidden=\{tab !== 'suggested'\}/)
  assert.match(source, /id=\{PICKER_PANEL_IDS\.saved\}[\s\S]*?role="tabpanel"[\s\S]*?aria-labelledby=\{PICKER_TAB_IDS\.saved\}[\s\S]*?hidden=\{tab !== 'saved'\}/)
  assert.match(source, /hidden=\{tab !== 'saved'\}[\s\S]*?model\.saved\.map\(pickRow\)/)
  assert.match(source, /tablistArrowKey\(ev, \['suggested', 'saved'\]/)
  assert.match(modal, /!node\.closest\('\[hidden\], \[aria-hidden="true"\], \[inert\]'\)/)
  assert.match(modal, /if \(event\.shiftKey && current <= 0\)[\s\S]*?focusWithoutScroll\(nodes\[nodes\.length - 1\]\)/)
})

test('Saves tabs control stable panels while preserving roving activation', () => {
  const source = read('MySavesPage.jsx')
  assert.match(source, /const savesTabId = \(filter\) => `saves-tab-\$\{filter\.toLowerCase\(\)\}`/)
  assert.match(source, /const savesPanelId = \(filter\) => `saves-panel-\$\{filter\.toLowerCase\(\)\}`/)
  assert.match(source, /id=\{savesTabId\(f\)\}[\s\S]*?role="tab"[\s\S]*?aria-controls=\{savesPanelId\(f\)\}/)
  assert.match(source, /id=\{savesPanelId\(panelFilter\)\}[\s\S]*?role="tabpanel"[\s\S]*?aria-labelledby=\{savesTabId\(panelFilter\)\}[\s\S]*?hidden=\{filter !== panelFilter\}/)
  assert.match(source, /tablistArrowKey\(ev, FILTERS, FILTERS\.indexOf\(filter\), setFilter, tabRefs\)/)
})
