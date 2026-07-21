import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(ROOT, 'app/src/index.css'), 'utf8')

test('every interactive primitive receives one high-contrast focus-visible grammar', () => {
  assert.match(css, /--focus-ring:\s*#7a3108/)
  assert.match(css, /@media \(prefers-color-scheme:\s*dark\)[\s\S]*--focus-ring:\s*#ffd19d/)
  assert.match(css, /:is\([\s\S]*button,[\s\S]*input,[\s\S]*\[role='switch'\],[\s\S]*\[role='tab'\],[\s\S]*\[tabindex\]:not\(\[tabindex='-1'\]\)[\s\S]*\):focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\);[^}]*outline-offset:\s*3px/s)
})

test('reduced-motion preference disables incidental animation and smooth scrolling', () => {
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*scroll-behavior:\s*auto !important;[\s\S]*animation-duration:\s*0\.01ms !important;[\s\S]*animation-iteration-count:\s*1 !important;[\s\S]*transition-duration:\s*0\.01ms !important;/)
})
