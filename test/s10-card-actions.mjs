import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cards = await readFile(new URL('../app/src/cards.jsx', import.meta.url), 'utf8')
const saves = await readFile(new URL('../app/src/saves.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../app/src/cards.css', import.meta.url), 'utf8')
const dayPage = await readFile(new URL('../app/src/DayPage.jsx', import.meta.url), 'utf8')

function section(start, end) {
  const from = cards.indexOf(start)
  const to = cards.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `missing section ${start}`)
  return cards.slice(from, to)
}

test('SaveHeart is one native toggle with browser-owned keyboard behavior', () => {
  const heart = saves.slice(saves.indexOf('export function SaveHeart'))
  assert.match(heart, /return h\(\s*'button'/)
  assert.match(heart, /type: 'button'/)
  assert.match(heart, /'aria-pressed': on/)
  assert.match(heart, /'aria-busy': pending \|\| undefined/)
  assert.match(heart, /disabled: !ready \|\| pending \|\| identityUnavailable/)
  assert.match(heart, /onClick: activate/)
  assert.match(heart, /ev\.stopPropagation\(\)/)
  assert.doesNotMatch(heart, /role: 'button'|tabIndex:|onKeyDown:|ev\.preventDefault\(\)/)
})

test('TonightCard composes open-detail and save as sibling buttons', () => {
  const card = section('export function TonightCard', '// 3.7P-23c')
  assert.match(card, /<div className="tcard">\s*<button className="tcard-open pressable"/)
  assert.match(card, /onSelect\(e, ev\.currentTarget\)/)
  assert.match(card, /<\/button>\s*<SaveHeart e=\{e\} \/>\s*<\/div>/)
  assert.doesNotMatch(card, /<button className="tcard[^>]*>[\s\S]*<SaveHeart[\s\S]*<\/button>/)
})

test('NbhdCard composes open-detail and save as sibling buttons', () => {
  const card = section('export function NbhdCard', '// SpotCard')
  assert.match(card, /<div className="nbhd-card">\s*<button className="nbhd-open pressable"/)
  assert.match(card, /onSelect\(e, ev\.currentTarget\)/)
  assert.match(card, /<\/button>\s*<SaveHeart e=\{e\} \/>\s*<\/div>/)
  assert.match(card, /<CardImg e=\{e\} className="nbhd-img" \/>/)
})

test('carousel SpotCard composes open-detail and save as sibling buttons', () => {
  const card = section('export function SpotCard', '// CARD_LOCK — the canonical VERTICAL result card')
  assert.match(card, /<div className="spotcard">\s*<button className="spotcard-tile-open pressable"/)
  assert.match(card, /onSelect\(p, ev\.currentTarget\)/)
  assert.match(card, /<\/button>\s*<SaveHeart e=\{p\} \/>\s*<\/div>/)
  assert.doesNotMatch(card, /<button className="spotcard pressable"/)
})

test('sibling-card CSS preserves the full open target and overlay save geometry', () => {
  assert.match(css, /\.tcard\s*\{[^}]*position: relative/s)
  assert.match(css, /\.spotcard\s*\{[^}]*position: relative/s)
  assert.match(css, /\.nbhd-card\s*\{[^}]*position: relative/s)
  for (const selector of ['tcard-open', 'spotcard-tile-open', 'nbhd-open']) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*width: 100%`, 's'))
  }
  assert.match(css, /\.save-btn\s*\{[^}]*border: 0;[^}]*padding: 0;[^}]*font: inherit/s)
})

test('event-card time is readable once with photo and Aurora parity', () => {
  const image = section('export function CardImg', 'export function SecHead')
  assert.doesNotMatch(image, /startLabel\(|imgbox-fall/)
  assert.doesNotMatch(css, /\.imgbox-fall|\.gem-time(?:-stack|-day)?/)

  const gem = section('export function GemRow', '// NbhdCard')
  assert.match(gem, /const timeRange =[\s\S]*timeOf\(e\.start\)[\s\S]*timeOf\(e\.end\)/)
  assert.match(gem, /const when = \[dayLoose\(e\), timeRange\]/)
  assert.match(gem, /<div className="gem-when">\{when\}<\/div>/)
  assert.doesNotMatch(gem, /gem-time|imgbadge/)

  const neighborhood = section('export function NbhdCard', '// SpotCard')
  assert.match(neighborhood, /\[dayLoose\(e\), startLabel\(e\), e\.venue\]/)

  assert.match(dayPage, /const whenLine =[\s\S]*timeOf\(e\.start\)[\s\S]*timeOf\(e\.end\)/)
  assert.match(css, /\.imgbox > \.dpg-thumb-time\s*\{\s*display: none;\s*\}/)
})
