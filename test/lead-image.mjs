import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  LEAD_IMAGE_CODES,
  LEAD_IMAGE_ROLES,
  presentLeadImage,
} from '../app/src/leadImage.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const policy = Object.freeze({
  allowedLicenses: ['CC BY 4.0', 'CC0'],
  allowedRemoteHosts: ['images.example.test'],
  allowSelfHosted: true,
})

function candidate(overrides = {}) {
  return {
    itemId: 'event:one',
    role: LEAD_IMAGE_ROLES.EXACT,
    image: 'https://images.example.test/exact.jpg',
    sourcePage: 'https://source.example.test/exact',
    attribution: 'Photo credit: Example Author',
    author: 'Example Author',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    retrievedAt: '2026-07-21T12:00:00.000Z',
    sha256: 'a'.repeat(64),
    ...overrides,
  }
}

function event(overrides = {}) {
  return {
    id: 'event:one',
    title: 'Credible event',
    image: 'https://untrusted.example.test/raw.jpg',
    imageCredit: { author: 'Unverified Raw Credit' },
    imageCandidate: { state: 'ready', role: 'exact-item' },
    imageEvidence: { verified: true },
    ...overrides,
  }
}

test('selects exact before verified venue and contextual receipts', () => {
  const presented = presentLeadImage(event({
    imageCandidates: [
      candidate({ role: LEAD_IMAGE_ROLES.CONTEXTUAL, image: 'https://images.example.test/context.jpg' }),
      candidate({ role: LEAD_IMAGE_ROLES.VENUE, image: 'https://images.example.test/venue.jpg' }),
      candidate(),
    ],
  }), { policy })

  assert.equal(presented.image, 'https://images.example.test/exact.jpg')
  assert.equal(presented._imageRole, LEAD_IMAGE_ROLES.EXACT)
  assert.equal(presented._imageSelection.state, 'selected')
  assert.equal(presented.imageCandidate.state, 'ready')
  assert.equal(presented.imageCandidate.candidate.image, presented.image)
  assert.equal(presented.imageCredit.role, LEAD_IMAGE_ROLES.EXACT)
  assert.equal(presented.imageCredit.author, 'Example Author')
  assert.equal(presented.imageEvidence.verified, true)
})

test('uses a verified venue receipt when an exact candidate is rejected', () => {
  const presented = presentLeadImage(event({
    imageCandidates: [
      candidate({ image: 'https://unapproved.example.test/exact.jpg' }),
      candidate({ role: LEAD_IMAGE_ROLES.VENUE, image: 'https://images.example.test/venue.jpg' }),
    ],
  }), { policy })

  assert.equal(presented.image, 'https://images.example.test/venue.jpg')
  assert.equal(presented._imageRole, LEAD_IMAGE_ROLES.VENUE)
  assert.equal(presented.imageCredit.role, LEAD_IMAGE_ROLES.VENUE)
})

test('preserves contextual role metadata instead of presenting it as exact', () => {
  const presented = presentLeadImage(event({
    imageCandidates: [candidate({
      role: LEAD_IMAGE_ROLES.CONTEXTUAL,
      image: 'https://images.example.test/context.jpg',
      attribution: 'Context photo by Example Author',
    })],
  }), { policy })

  assert.equal(presented.image, 'https://images.example.test/context.jpg')
  assert.equal(presented._imageRole, LEAD_IMAGE_ROLES.CONTEXTUAL)
  assert.equal(presented.imageCandidate.role, LEAD_IMAGE_ROLES.CONTEXTUAL)
  assert.equal(presented.imageCredit.role, LEAD_IMAGE_ROLES.CONTEXTUAL)
  assert.equal(presented.imageCredit.attribution, 'Context photo by Example Author')
})

test('missing policy fails raw image and self-declared ready state to Aurora', () => {
  const presented = presentLeadImage(event({ imageCandidates: [candidate()] }))

  assert.equal(presented.image, null)
  assert.equal(presented.imageCredit, null)
  assert.equal(presented.imageCandidate, null)
  assert.equal(presented.imageEvidence.verified, false)
  assert.equal(presented._imageRole, LEAD_IMAGE_ROLES.AURORA)
  assert.equal(presented._imageSelection.state, 'fallback')
  assert.ok(presented._imageSelection.reasons.includes('POLICY_UNKNOWN'))
})

test('raw image and legacy image claims never display without candidate receipts', () => {
  const presented = presentLeadImage(event(), { policy })

  assert.equal(presented.image, null)
  assert.equal(presented.imageCredit, null)
  assert.equal(presented.imageCandidate, null)
  assert.equal(presented._imageRole, LEAD_IMAGE_ROLES.AURORA)
  assert.ok(presented._imageSelection.reasons.includes('NO_READY_CANDIDATE'))
})

test('fallback candidates, bad licenses, and mixed identities remain Aurora', () => {
  const fallback = presentLeadImage(event({
    imageCandidates: [candidate({ role: 'fallback', image: '/place-img/wuzup.jpg' })],
  }), { policy })
  const badLicense = presentLeadImage(event({
    imageCandidates: [candidate({ license: 'Unknown proprietary terms' })],
  }), { policy })
  const mismatch = presentLeadImage(event({
    imageCandidates: [candidate(), candidate({ itemId: 'event:two' })],
  }), { policy })

  assert.equal(fallback._imageRole, LEAD_IMAGE_ROLES.AURORA)
  assert.equal(badLicense._imageRole, LEAD_IMAGE_ROLES.AURORA)
  assert.ok(badLicense._imageSelection.reasons.includes('LICENSE_NOT_ALLOWED'))
  assert.equal(mismatch._imageRole, LEAD_IMAGE_ROLES.AURORA)
  assert.ok(mismatch._imageSelection.reasons.includes(LEAD_IMAGE_CODES.ITEM_ID_MISMATCH))
})

test('candidate receipts must target the event receiving the image', () => {
  const presented = presentLeadImage(event({
    id: 'event:different',
    imageCandidates: [candidate()],
  }), { policy })

  assert.equal(presented.image, null)
  assert.equal(presented._imageRole, LEAD_IMAGE_ROLES.AURORA)
  assert.ok(presented._imageSelection.reasons.includes(LEAD_IMAGE_CODES.ITEM_ID_MISMATCH))
})

test('invalid lead items are rejected before image assessment', () => {
  assert.throws(() => presentLeadImage(null, { policy }), new RegExp(LEAD_IMAGE_CODES.ITEM_INVALID))
  assert.throws(() => presentLeadImage({ title: 'Missing id' }, { policy }), new RegExp(LEAD_IMAGE_CODES.ITEM_INVALID))
})

test('current flagship event artifacts have no compatible receipts and fail to Aurora', () => {
  for (const cityId of ['tampa-bay', 'sf-east-bay']) {
    const events = JSON.parse(fs.readFileSync(path.join(ROOT, 'finder', 'output', cityId, 'events.json'), 'utf8'))
    const imageBearing = events.filter(row => typeof row.image === 'string' && row.image)
    const candidateBearing = events.filter(row => Array.isArray(row.imageCandidates) && row.imageCandidates.length > 0)
    const dedicatedCredit = events.filter(row => row.imageCredit || row.imageProvenance || row.imageAttribution)

    assert.ok(imageBearing.length > 0, `${cityId} fixture must exercise raw image rejection`)
    assert.equal(candidateBearing.length, 0, `${cityId} must not silently gain unreviewed candidate receipts`)
    assert.equal(dedicatedCredit.length, 0, `${cityId} raw event images remain uncredited inventory evidence`)

    for (const row of imageBearing) {
      const presented = presentLeadImage(row, { policy })
      assert.equal(presented.image, null, `${cityId}:${row.id}`)
      assert.equal(presented._imageRole, LEAD_IMAGE_ROLES.AURORA, `${cityId}:${row.id}`)
    }
  }
})
