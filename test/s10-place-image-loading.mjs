import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = Object.fromEntries(await Promise.all([
  ['cards', '../app/src/cards.jsx'],
  ['placeDetail', '../app/src/PlaceDetail.jsx'],
].map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), 'utf8')])))

test('CardImg keeps Aurora visible until its exact source loads', () => {
  assert.match(source.cards, /const imageToken = useMemo\(\(\) => \(\{ imageSrc \}\), \[imageSrc\]\)/)
  assert.match(source.cards, /const loadedSrc = imageLoad\.token === imageToken && imageLoad\.state === 'loaded'/)
  assert.match(source.cards, /const failedSrc = imageLoad\.token === imageToken && imageLoad\.state === 'failed'/)
  assert.match(source.cards, /key=\{imageSrc\}[\s\S]*?className=\{'imgbox-img' \+ \(ok \? ' on' : ''\)\}/)
  assert.match(source.cards, /onLoad=\{\(\) => setImageLoad\(\{ token: imageToken, state: 'loaded' \}\)\}/)
  assert.match(source.cards, /onError=\{\(\) => setImageLoad\(\{ token: imageToken, state: 'failed' \}\)\}/)
  assert.match(source.cards, /\{showArt \|\| !ok \? \([\s\S]*?className="imgbox-mark"/)
  assert.match(source.cards, /const photoReady = Boolean\(imageSrc\) && !failed && ok/)
  assert.match(source.cards, /\{photoReady && <span className="img-scrim"/)
  assert.doesNotMatch(source.cards, /\{imageSrc && !failed && <span className="img-scrim"/)
})

test('PlaceDetail mounts a pending request without claiming a ready photo', () => {
  assert.match(source.placeDetail, /const heroImageToken = useMemo\(\(\) => \(\{ heroImage \}\), \[heroImage\]\)/)
  assert.match(source.placeDetail, /const loadedSrc = heroImageLoad\.token === heroImageToken && heroImageLoad\.state === 'loaded'/)
  assert.match(source.placeDetail, /const failedSrc = heroImageLoad\.token === heroImageToken && heroImageLoad\.state === 'failed'/)
  assert.match(source.placeDetail, /const photoReady = Boolean\(heroImage\) && !heroArt && imgOk/)
  assert.match(source.placeDetail, /\{heroImage && !heroArt && \(\s*<img[\s\S]*?key=\{heroImage\}/)
  assert.match(source.placeDetail, /\{\(heroArt \|\| heroLoading\) && \(\s*<span className="imgbox-mark"/)
  assert.match(source.placeDetail, /\{photoReady && <div className="detail-hero-grad" \/>\}/)
  assert.match(source.placeDetail, /\{photoReady && presentedImage\.imageCredit && \(/)
})

test('PlaceDetail load events remain no-referrer, async, and current-source scoped', () => {
  assert.match(source.placeDetail, /key=\{heroImage\}[\s\S]*?src=\{heroImage\}/)
  assert.match(source.placeDetail, /decoding="async"/)
  assert.match(source.placeDetail, /referrerPolicy="no-referrer"/)
  assert.match(source.placeDetail, /onLoad=\{\(\) => setHeroImageLoad\(\{ token: heroImageToken, state: 'loaded' \}\)\}/)
  assert.match(source.placeDetail, /onError=\{\(\) => setHeroImageLoad\(\{ token: heroImageToken, state: 'failed' \}\)\}/)
})
