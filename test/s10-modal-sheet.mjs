import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const APP_SRC = new URL('../app/src/', import.meta.url)
const read = (file) => readFileSync(new URL(file, APP_SRC), 'utf8')

test('shared modal sheet owns the complete keyboard and focus contract', () => {
  const source = read('ModalSheet.jsx')
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /aria-label=\{label\}/)
  assert.match(source, /aria-labelledby=\{labelledBy\}/)
  assert.match(source, /querySelector\('\[data-modal-initial-focus\]'\)/)
  assert.match(source, /!node\.matches\(':disabled'\)/)
  assert.match(source, /!node\.closest\('\[hidden\], \[aria-hidden="true"\], \[inert\]'\)/)
  assert.match(source, /window\.addEventListener\('keydown', onEscape, true\)/)
  assert.match(source, /event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?dismiss\(\)/)
  assert.match(source, /current <= 0[\s\S]*?nodes\[nodes\.length - 1\]/)
  assert.match(source, /current === -1 \|\| current === nodes\.length - 1[\s\S]*?nodes\[0\]/)
  assert.match(source, /document\.addEventListener\('focusin', onFocusIn, true\)/)
  assert.match(source, /queueMicrotask\([\s\S]*?const target = trigger\?\.isConnected \? trigger : resolveFallbackFocus\?\.\(\)[\s\S]*?target\?\.isConnected[\s\S]*?focusWithoutScroll\(target\)/)
  assert.match(source, /data-modal-sheet-layer/)
  assert.match(source, /tabIndex=\{-1\}[\s\S]*?aria-hidden="true"[\s\S]*?onClick=\{dismiss\}/)
})

test('Day picker and item menu share semantics without exposing covered content', () => {
  const day = read('DayPage.jsx')
  const picker = read('PickerSheet.jsx')
  assert.match(day, /const dayModalOpen = canEdit && Boolean\(\(picker && model\) \|\| menuPart\)/)
  assert.match(day, /className="dpg-content"[\s\S]*?inert=\{dayModalOpen \? true : undefined\}[\s\S]*?aria-hidden=\{dayModalOpen \|\| undefined\}/)
  assert.match(day, /onClick=\{\(ev\) => openSheet\(part, ev\.currentTarget\)\}/)
  assert.match(day, /pickerBtnRef\.current = btn \|\| null/)
  assert.match(day, /returnFocusRef=\{pickerBtnRef\}/)
  assert.match(day, /resolveFallbackFocus=\{resolvePickerFallbackFocus\}/)
  assert.match(day, /label="Plan item options"[\s\S]*?focusKey=\{moveMode \? 'move' : 'actions'\}[\s\S]*?returnFocusRef=\{menuBtnRef\}/)
  assert.match(day, /resolveFallbackFocus=\{resolveMenuFallbackFocus\}/)
  assert.match(day, /pendingPickerFocusPartRef\.current = part[\s\S]*?pendingMenuFocusPartRef\.current = to[\s\S]*?pendingMenuFocusPartRef\.current = part/)
  assert.match(day, /ref=\{registerResultFocus\} className="dpg-more"/)
  assert.match(day, /ref=\{registerResultFocus\} className="dpg-empty pressable"/)
  assert.match(day, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)[\s\S]*?setPicker\(null\)[\s\S]*?}, 200\)/)
  assert.match(picker, /<ModalSheet[\s\S]*?label=\{heading\}[\s\S]*?closing=\{closing\}[\s\S]*?returnFocusRef=\{returnFocusRef\}[\s\S]*?resolveFallbackFocus=\{resolveFallbackFocus\}/)
  assert.match(picker, /data-modal-initial-focus/)

  const modalStart = day.indexOf('{canEdit && picker && model && (')
  const toastStart = day.indexOf('{toast && <div className="detail-toast wkb-toast"')
  assert.ok(modalStart >= 0 && toastStart > modalStart, 'Day outcome live region must remain outside the inert content wrapper')
})

test('Day menu scrim remains pointer-operable but outside sequential focus', () => {
  const css = read('day.css')
  const modal = read('ModalSheet.jsx')
  assert.match(css, /\.dpg-menu-scrim\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/)
  assert.match(modal, /className=\{`modal-sheet-scrim/)
  assert.match(modal, /tabIndex=\{-1\}/)
})
