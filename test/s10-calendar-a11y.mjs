import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calendarDayAriaLabel,
  listboxIndexForKey,
  monthStartTs,
} from '../app/src/lib.js'

const APP_SRC = new URL('../app/src/', import.meta.url)
const read = (file) => readFileSync(new URL(file, APP_SRC), 'utf8')

test('calendar day labels use the city date and enumerate every applicable state', () => {
  const ts = monthStartTs(Date.parse('2026-07-15T16:00:00Z'))
  const label = calendarDayAriaLabel(ts, {
    todayTs: ts,
    selected: true,
    planned: true,
    quiet: true,
    went: true,
    disabled: true,
  })
  assert.match(label, /2026/)
  assert.match(label, /\. today, selected, planned, quiet day, went, disabled\.$/)
  assert.doesNotMatch(calendarDayAriaLabel(ts), /selected|planned|quiet|went|disabled/)
})

test('bounded listbox navigation handles arrows and endpoints deterministically', () => {
  assert.equal(listboxIndexForKey(1, 'ArrowDown', 3), 2)
  assert.equal(listboxIndexForKey(2, 'ArrowDown', 3), 2)
  assert.equal(listboxIndexForKey(1, 'ArrowUp', 3), 0)
  assert.equal(listboxIndexForKey(0, 'ArrowUp', 3), 0)
  assert.equal(listboxIndexForKey(1, 'Home', 3), 0)
  assert.equal(listboxIndexForKey(1, 'End', 3), 2)
  assert.equal(listboxIndexForKey(1, 'Enter', 3), null)
  assert.equal(listboxIndexForKey(0, 'ArrowDown', 0), null)
})

test('Plan month selector is one-focus listbox with selection and focus return', () => {
  const source = read('CalendarView.jsx')
  assert.match(source, /role="listbox"/)
  assert.match(source, /aria-activedescendant=\{`plan-month-option-\$\{pickerActiveIndex\}`\}/)
  assert.match(source, /onKeyDown=\{onMonthPickerKeyDown\}/)
  assert.match(source, /listboxIndexForKey\(pickerActiveIndex, ev\.key, monthOptions\.length\)/)
  assert.match(source, /ev\.key === 'Enter' \|\| ev\.key === ' '/)
  assert.match(source, /ev\.key === 'Escape' \|\| ev\.key === 'Tab'/)
  assert.match(source, /role="option"[\s\S]*?aria-selected=\{m\.off === monthOff\}[\s\S]*?tabIndex=\{-1\}/)
  assert.match(source, /m\.off === monthOff \? ' on' : ''[\s\S]*?index === pickerActiveIndex \? ' active' : ''/)
  const css = read('calendar.css')
  assert.match(css, /\.mon-opt\.active\s*\{[\s\S]*?outline:\s*2px solid var\(--cta-ink\)/)
  assert.match(source, /monthBtnRef\.current\?\.focus\(\)/)
  assert.match(source, /window\.addEventListener\('keydown', onKey, true\)/)
})

test('both calendar surfaces expose grouped city-local dates and separate today from selection', () => {
  const calendar = read('CalendarView.jsx')
  assert.match(calendar, /className="mgrid" role="group" aria-label=\{`\$\{monthTitle\} plan calendar`\}/)
  assert.match(calendar, /aria-label=\{calendarDayAriaLabel\(ts, \{[\s\S]*?planned,[\s\S]*?quiet: restful,[\s\S]*?went,/)
  assert.match(calendar, /aria-current=\{ts === anchors\.todayTs \? 'date' : undefined\}/)
  assert.match(calendar, /aria-pressed=\{selected\}/)

  const picker = read('CalendarPickerPage.jsx')
  assert.match(picker, /className="calpick-grid" role="group" aria-label=\{`\$\{monthLabel\} date picker`\}/)
  assert.match(picker, /aria-label=\{calendarDayAriaLabel\(t, \{[\s\S]*?disabled: t < anchors\.todayTs/)
  assert.match(picker, /aria-current=\{t === anchors\.todayTs \? 'date' : undefined\}/)
  assert.match(picker, /aria-pressed=\{t === cur\}/)
  assert.doesNotMatch(picker, /aria-current=\{t === cur/)
})
