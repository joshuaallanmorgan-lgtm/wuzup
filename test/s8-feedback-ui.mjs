import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (name) => readFileSync(join(ROOT, 'app', 'src', name), 'utf8')

test('calibration Save is save-first and every rejected action stays visibly retryable', () => {
  const deck = source('CalibrationDeck.jsx')
  const savePath = deck.slice(deck.indexOf('const verdictSave'), deck.indexOf('// BATCH 5', deck.indexOf('const verdictSave')))
  assert.ok(savePath.indexOf('save: async () => await toggle(e)') < savePath.indexOf('const retained = await recordDeck(e)'))
  assert.match(deck, /if \(result\?\.applied !== true\) return false/)
  assert.match(deck, /deck-feedback/)
  assert.match(deck, /The same card is ready to retry|deckFeedback\(result\)/)
  assert.match(deck, /capturePersonalSignal\('deck-(?:yes|no)'/)
})

test('deck copy states exact effects and never treats opening as dislike', () => {
  const calibration = source('CalibrationDeck.jsx')
  const lens = source('LensDeck.jsx')
  assert.match(calibration, /More like this/)
  assert.match(calibration, /Less like this/)
  assert.match(calibration, /Your choices are recorded/)
  assert.doesNotMatch(calibration, /Your feed order has new signals|feed just got smarter/)
  assert.match(calibration, /Ratings change order only; every item stays browseable/)
  assert.match(lens, /Open does not rate it/)
  assert.match(lens, /Less like this changes order/)
  assert.doesNotMatch(lens, /recordCalibration\s*\(/)
  assert.match(lens, /capturePersonalSignal\('deck-no'/)
})

test('Taste Profile counts organic evidence and makes no unwired when/explore promise', () => {
  const panel = source('TastePanel.jsx')
  assert.match(panel, /const evidenceN = sum\.organicN/)
  assert.match(panel, /No deliberate activity signals yet/)
  assert.doesNotMatch(panel, /WHEN_LABEL|sum\.when|Weeknights are your nights|Weekends are your nights/)
  assert.doesNotMatch(panel, /sum\.n} tap|explore/i)
})

test('compact tuner describes ordering and preserves the full-list promise', () => {
  const tuner = source('TasteTuner.jsx')
  const css = source('tastetuner.css')
  assert.match(tuner, /Choose what moves up/)
  assert.match(tuner, /full lists stay intact/)
  assert.match(tuner, /Tune my order/)
  assert.doesNotMatch(tuner, /Find your night by swiping|feed tunes as you swipe/)
  assert.match(css, /max-width: 360px/)
  assert.match(css, /focus-visible/)
})
