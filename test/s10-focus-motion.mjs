import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(ROOT, 'app/src/index.css'), 'utf8')
const appCss = readFileSync(join(ROOT, 'app/src/App.css'), 'utf8')

function keyframes(name) {
  return appCss.match(new RegExp(`@keyframes\\s+${name}\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`))?.[1] || ''
}

test('every interactive primitive receives one high-contrast focus-visible grammar', () => {
  assert.match(css, /--focus-ring:\s*#7a3108/)
  assert.match(css, /@media \(prefers-color-scheme:\s*dark\)[\s\S]*--focus-ring:\s*#ffd19d/)
  assert.match(css, /:is\([\s\S]*button,[\s\S]*input,[\s\S]*\[role='switch'\],[\s\S]*\[role='tab'\],[\s\S]*\[tabindex\]:not\(\[tabindex='-1'\]\)[\s\S]*\):focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\);[^}]*outline-offset:\s*3px/s)
})

test('reduced-motion preference disables incidental animation and smooth scrolling', () => {
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*scroll-behavior:\s*auto !important;[\s\S]*animation-duration:\s*0\.01ms !important;[\s\S]*animation-iteration-count:\s*1 !important;[\s\S]*transition-duration:\s*0\.01ms !important;/)
})

test('default-motion entrances never lower descendant text contrast', () => {
  for (const name of ['tune-in', 'rise', 'tabSettle', 'pageIn', 'pageOut', 'detailIn', 'detailOut']) {
    const body = keyframes(name)
    assert.ok(body, `${name} keyframes must remain defined`)
    assert.doesNotMatch(
      body,
      /opacity\s*:/,
      `${name} moves a content-bearing ancestor, so it must remain fully opaque`,
    )
  }

  assert.match(appCss, /\.enter\s*\{\s*animation:\s*rise\b/)
  assert.match(appCss, /\.page\.tab-settle\s*\{\s*animation:\s*tabSettle\b/)
  assert.match(appCss, /\.subpage\s*\{[\s\S]*?animation:\s*pageIn\b/)
  assert.match(appCss, /\.subpage-closing\s*\{\s*animation:\s*pageOut\b/)
  assert.match(appCss, /\.detail\s*\{[\s\S]*?animation:\s*detailIn\b/)
  assert.match(appCss, /\.detail-closing\s*\{\s*animation:\s*detailOut\b/)
  assert.match(
    appCss,
    /::view-transition-old\(root\),\s*\n::view-transition-new\(root\)\s*\{\s*animation:\s*none;/,
    'the root snapshot contains text, so its browser-default opacity crossfade must stay disabled',
  )
  assert.match(
    appCss,
    /\.detail-hero-img\s*\{[^}]*opacity:\s*0;[^}]*transition:\s*opacity\b[^}]*\}[\s\S]*?\.detail-hero-img\.on\s*\{\s*opacity:\s*1;/,
    'a leaf image may still crossfade without dimming sibling text',
  )
})
