import test from 'node:test'
import assert from 'node:assert/strict'
import * as tampaBay from '../finder/cities/tampa-bay.mjs'
import * as sfEastBay from '../finder/cities/sf-east-bay.mjs'
import {
  matchReviewedImageRejection,
  validateReviewedImageRejects,
} from '../finder/reviewed-image-rejections.mjs'

const candidateFor = rejection => ({
  image: rejection.image,
  sourcePage: rejection.sourcePage,
  sourceFamily: rejection.sourceFamily,
})

const fixture = (placeKey = 'p|fixture') => ({
  placeKey,
  image: 'https://images.example.test/fixture.jpg',
  sourcePage: 'https://source.example.test/fixture',
  sourceFamily: 'fixture-source',
  evidence: {
    report: 'planning/v2/fixture.md',
    reportSha256: `sha256:${'a'.repeat(64)}`,
    reviewRow: 1,
  },
  disposition: 'remove-or-replace',
  reason: 'Exact fixture candidate failed review.',
})

const TAMPA_KEYS = [
  'p|banyan-coffee-co',
  'p|beangood-coffee',
  'p|colt-creek-state-park',
  'p|curtis-hixon-waterfront-park',
  'p|del-bello-park',
  'p|dundedin-hammock-park-paddlecraft-access',
  'p|edward-medard-park-boat-ramp',
  'p|edward-medard-park-canoe-kayak-launch',
  'p|fort-hamer-park',
  'p|fort-hamer-public-boat-ramp',
  'p|foundation-coffee-co-ybor-city',
  'p|foundation-coffee-company',
  'p|indian-shores-coffee',
  'p|ken-thompson-park-boat-ramp',
  'p|ken-thompson-park-kayak-beach',
  'p|lower-hillsborough-wilderness-preserve-morris-bridge-park',
  'p|morris-bridge-park',
  'p|palma-sola-botanical-park',
  'p|perry-harvey-sr-park',
  'p|sunset-beach',
  'p|sunset-beach-park-sand-launch-beach-city-permit-required',
  'p|tenth-street-coffee',
  'p|ybor-city-museum-state-park',
].sort()

const SF_KEYS = [
  'p|candlestick-point-state-recreation-area',
  'p|coit-tower-cafe',
  'p|dinosaur-hill-park',
  'p|don-castro-regional-recreation-area',
  'p|lake-chabot-regional-park',
  'p|ocean-beach',
  'p|presidio-of-san-francisco',
  'p|sutro-heights-park',
].sort()

test('city registries pin every audited quarantine to an exact item and candidate', () => {
  assert.deepEqual(Object.keys(tampaBay.imageRejects).sort(), TAMPA_KEYS)
  assert.deepEqual(Object.keys(sfEastBay.imageRejects).sort(), SF_KEYS)

  const combined = [...Object.values(tampaBay.imageRejects), ...Object.values(sfEastBay.imageRejects)]
  assert.equal(combined.filter(row => row.disposition === 'remove-or-replace').length, 28)
  assert.equal(combined.filter(row => row.disposition === 'quarantine-noncanonical-duplicate').length, 1)
  assert.equal(combined.filter(row => row.disposition === 'quarantine-pending-canonical-choice').length, 2)
  assert.deepEqual(
    combined.filter(row => row.disposition === 'quarantine-pending-canonical-choice').map(row => row.placeKey).sort(),
    ['p|lower-hillsborough-wilderness-preserve-morris-bridge-park', 'p|morris-bridge-park'],
  )

  for (const row of combined) {
    assert.ok(Object.isFrozen(row))
    assert.ok(Object.isFrozen(row.evidence))
    assert.equal(row.evidence.report, 'planning/v2/S10_IMAGE_AUDIT_2026-07-21.md')
    assert.equal(row.evidence.reportSha256, 'sha256:4bee54bf0847f6de7a06443ffdf513055abfd85d0f2d6a67110f928518958830')
    assert.match(row.placeKey, /^p\|/)
    assert.ok(row.image)
    assert.ok(row.sourcePage)
    assert.ok(row.sourceFamily)
  }
  assert.ok(Object.isFrozen(tampaBay.imageRejects))
  assert.ok(Object.isFrozen(sfEastBay.imageRejects))
})

test('matcher rejects only the exact audited item and provenance tuple', () => {
  const rejected = tampaBay.imageRejects['p|perry-harvey-sr-park']
  const exact = matchReviewedImageRejection(
    { key: rejected.placeKey }, candidateFor(rejected), tampaBay.imageRejects,
  )
  assert.equal(exact.state, 'reject')
  assert.equal(exact.rejection.placeKey, rejected.placeKey)
  assert.ok(Object.isFrozen(exact))

  const sameBytesDifferentItem = matchReviewedImageRejection(
    { key: 'p|bro-bowl' }, candidateFor(rejected), tampaBay.imageRejects,
  )
  assert.deepEqual(sameBytesDifferentItem, { state: 'allow', rejection: null })

  const hammock = tampaBay.imageRejects['p|dundedin-hammock-park-paddlecraft-access']
  assert.equal(matchReviewedImageRejection(
    { key: hammock.placeKey }, candidateFor(hammock), tampaBay.imageRejects,
  ).state, 'reject')
  assert.equal(matchReviewedImageRejection(
    { key: 'p|hammock-park' }, candidateFor(hammock), tampaBay.imageRejects,
  ).state, 'allow')
})

test('candidate drift is explicit and is never covered by an older rejection', () => {
  const rejection = sfEastBay.imageRejects['p|ocean-beach']
  const place = { key: rejection.placeKey }

  for (const field of ['image', 'sourcePage', 'sourceFamily']) {
    const candidate = candidateFor(rejection)
    candidate[field] = `${candidate[field]}-replacement`
    const result = matchReviewedImageRejection(place, candidate, sfEastBay.imageRejects)
    assert.equal(result.state, 'drift', field)
    assert.deepEqual(result.rejection, rejection)
    assert.ok(Object.isFrozen(result.rejection))
  }
})

test('both unresolved Morris Bridge identities quarantine while no canonical target is chosen', () => {
  const short = tampaBay.imageRejects['p|morris-bridge-park']
  const long = tampaBay.imageRejects['p|lower-hillsborough-wilderness-preserve-morris-bridge-park']
  assert.deepEqual(candidateFor(short), candidateFor(long))
  assert.equal(matchReviewedImageRejection({ key: short.placeKey }, candidateFor(short), tampaBay.imageRejects).state, 'reject')
  assert.equal(matchReviewedImageRejection({ key: long.placeKey }, candidateFor(long), tampaBay.imageRejects).state, 'reject')
})

test('validator detects duplicate place authority and malformed evidence', () => {
  assert.throws(
    () => validateReviewedImageRejects([fixture(), fixture()], { cityId: 'fixture-city' }),
    /duplicate image rejection/,
  )
  assert.throws(
    () => validateReviewedImageRejects([
      { ...fixture(), evidence: { ...fixture().evidence, reviewRow: 0 } },
    ], { cityId: 'fixture-city' }),
    /positive integer/,
  )
  assert.throws(
    () => validateReviewedImageRejects([
      { ...fixture(), unexpected: true },
    ], { cityId: 'fixture-city' }),
    /missing or unknown fields/,
  )
})

test('validator allows shared candidates across distinct exact-item keys and freezes normalized output', () => {
  const registry = validateReviewedImageRejects(
    [fixture('p|one'), fixture('p|two')],
    { cityId: 'fixture-city' },
  )
  assert.equal(Object.getPrototypeOf(registry), null)
  assert.ok(Object.isFrozen(registry))
  assert.equal(registry['p|one'].cityId, 'fixture-city')
  assert.deepEqual(candidateFor(registry['p|one']), candidateFor(registry['p|two']))

  const revalidated = validateReviewedImageRejects(registry)
  assert.ok(Object.isFrozen(revalidated))
  assert.deepEqual(revalidated, registry)
})
