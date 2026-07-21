import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (name) => readFileSync(new URL(`../app/src/${name}`, import.meta.url), 'utf8')

test('Home and Events share one credible first-screen selector and keep the full Tonight escape', () => {
  const home = source('HomeView.jsx')
  const hot = source('HotView.jsx')

  for (const [name, code] of [['HomeView', home], ['HotView', hot]]) {
    assert.match(code, /import \{[^}]*\brankTonightCandidates\b[^}]*\} from '\.\/relevance\.js'/, `${name} must use the shared runtime adapter`)
    assert.match(code, /rankTonightCandidates\(tonight\.items, \{ nowMs, city: CITY, taste \}\)/, `${name} must use the same inputs`)
    assert.doesNotMatch(code, /tonight\.items\.slice\(0,\s*3\)/, `${name} must not retain an independent first-three path`)
    assert.match(code, /tonightRanked\.selected\.map\(\(\{ e \}\) => e\)/, `${name} must render the selected event, not its evidence wrapper`)
    assert.match(code, /tonightRanked\.limited/, `${name} must disclose constrained credible supply`)
  }

  assert.match(home, /TONIGHT_BUBBLE[\s\S]*onSeeAll=\{\(\) => openBubble\(TONIGHT_BUBBLE\)\}/)
  assert.match(hot, /onSeeAll=\{\(\) => seeAll\('tonight'\)\}/)
})

test('Home keeps the full Tonight catalog reachable when no candidate clears the lead bar', () => {
  const home = source('HomeView.jsx')

  assert.match(home, /zeroCredibleTonight = tonight\.items\.length > 0 && topPicks\.length === 0/)
  assert.match(home, /\{tonight\.items\.length > 0 && \(\s*<section className="sec">/)
  assert.doesNotMatch(home, /\{topPicks\.length > 0 && \(\s*<section className="sec">/)
  assert.match(home, /zeroCredibleTonight\s*\? 'No listings have enough detail to recommend yet'/)
  assert.match(home, /onSeeAll=\{\(\) => openBubble\(TONIGHT_BUBBLE\)\}/)
  assert.match(home, /zeroCredibleTonight \? \([\s\S]*role="status"[\s\S]*Nothing clears our recommendation checks yet\.[\s\S]*\) : \(\s*<div className="home-picks">/)
  assert.match(home, /<div className="home-picks">\s*\{topPicks\.map/)
})

test('credible first-screen reason copy avoids superlatives and unsupported proximity claims', () => {
  const relevance = source('relevance.js')
  assert.doesNotMatch(relevance, /best|favorite|locals love|worth the drive|near you/i)
  assert.match(relevance, /with enough|reason|confirmed|available/i)
})
