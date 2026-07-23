import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMAGE_CANDIDATE_CODES,
  selectImageCandidate,
  validateImageCandidate,
} from '../shared/image-candidate.mjs'

const policy = Object.freeze({
  allowedLicenses: ['CC BY 4.0', 'CC0'],
  allowedRemoteHosts: ['images.example.test'],
  allowSelfHosted: true,
})

function candidate(overrides = {}) {
  return {
    itemId: 'event:one',
    role: 'exact-item',
    image: 'https://images.example.test/exact.jpg',
    sourcePage: 'https://source.example.test/image-page',
    attribution: 'Photo credit: Example Author',
    author: 'Example Author',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    retrievedAt: '2026-07-20T12:00:00.000Z',
    sha256: 'a'.repeat(64),
    ...overrides,
  }
}

test('selects the highest truth ready role without rewriting its role', () => {
  const selection = selectImageCandidate([
    candidate({ role: 'contextual', image: 'https://images.example.test/context.jpg' }),
    candidate({ role: 'verified-venue', image: 'https://images.example.test/venue.jpg' }),
    candidate({ role: 'exact-item', image: 'https://images.example.test/exact.jpg' }),
  ], { policy })

  assert.equal(selection.state, 'selected')
  assert.equal(selection.role, 'exact-item')
  assert.equal(selection.candidate.image, 'https://images.example.test/exact.jpg')
})

test('fails closed when policy is absent or incomplete', () => {
  const assessment = validateImageCandidate(candidate())
  const selection = selectImageCandidate([candidate()], { policy: { allowedLicenses: ['CC BY 4.0'] } })

  assert.equal(assessment.state, 'unknown')
  assert.deepEqual(assessment.errors, [IMAGE_CANDIDATE_CODES.POLICY_UNKNOWN])
  assert.equal(selection.state, 'none')
  assert.ok(selection.reasons.includes(IMAGE_CANDIDATE_CODES.POLICY_UNKNOWN))
})

test('rejects license and credit gaps rather than inferring permission from a host', () => {
  const missingCredit = validateImageCandidate(candidate({ attribution: '', author: '' }), { policy })
  const missingLicense = validateImageCandidate(candidate({ license: '' }), { policy })

  assert.equal(missingCredit.state, 'rejected')
  assert.ok(missingCredit.errors.includes(IMAGE_CANDIDATE_CODES.ATTRIBUTION_REQUIRED))
  assert.ok(missingCredit.errors.includes(IMAGE_CANDIDATE_CODES.AUTHOR_REQUIRED))
  assert.equal(missingLicense.state, 'rejected')
  assert.ok(missingLicense.errors.includes(IMAGE_CANDIDATE_CODES.LICENSE_REQUIRED))
})

test('rejects host mismatch, non-HTTPS remote URLs, and local traversal', () => {
  const mismatchedHost = validateImageCandidate(candidate({ image: 'https://other.example.test/image.jpg' }), { policy })
  const insecure = validateImageCandidate(candidate({ image: 'http://images.example.test/image.jpg' }), { policy })
  const traversal = validateImageCandidate(candidate({ image: '/place-img/../private.jpg' }), { policy })

  assert.deepEqual(mismatchedHost.errors, [IMAGE_CANDIDATE_CODES.REMOTE_HOST_NOT_ALLOWED])
  assert.ok(insecure.errors.includes(IMAGE_CANDIDATE_CODES.IMAGE_INVALID))
  assert.ok(traversal.errors.includes(IMAGE_CANDIDATE_CODES.LOCAL_PATH_UNSAFE))
})

test('uses the canonical safe reference validator for encoded traversal and controls', () => {
  for (const image of [
    '/%2e%2e%5cprivate.jpg',
    '/place-img/%2e%2e/private.jpg',
    '/place-img/%00private.jpg',
    '/place-img/%ZZprivate.jpg',
  ]) {
    const assessment = validateImageCandidate(candidate({ image }), { policy })
    assert.equal(assessment.state, 'rejected', image)
    assert.ok(assessment.errors.includes(IMAGE_CANDIDATE_CODES.LOCAL_PATH_UNSAFE), image)
  }
})

test('requires a valid byte hash for self-hosted receipts and accepts a safe bound path', () => {
  const missing = validateImageCandidate(candidate({ image: '/place-img/missing.jpg', sha256: null }), { policy })
  const malformed = validateImageCandidate(candidate({ image: '/place-img/malformed.jpg', sha256: 'not-a-hash' }), { policy })
  const valid = validateImageCandidate(candidate({ image: '/place-img/valid.jpg', sha256: `sha256:${'e'.repeat(64)}` }), { policy })

  assert.equal(missing.state, 'rejected')
  assert.deepEqual(missing.errors, [IMAGE_CANDIDATE_CODES.SHA256_INVALID])
  assert.equal(malformed.state, 'rejected')
  assert.deepEqual(malformed.errors, [IMAGE_CANDIDATE_CODES.SHA256_INVALID])
  assert.equal(valid.state, 'ready')
  assert.equal(valid.candidate.image, '/place-img/valid.jpg')
  assert.equal(valid.candidate.sha256, `sha256:${'e'.repeat(64)}`)
})

test('breaks equal-role ties deterministically by receipt content', () => {
  const first = candidate({ role: 'verified-venue', image: 'https://images.example.test/z.jpg' })
  const second = candidate({ role: 'verified-venue', image: 'https://images.example.test/a.jpg' })

  const forward = selectImageCandidate([first, second], { policy })
  const reverse = selectImageCandidate([second, first], { policy })

  assert.equal(forward.candidate.image, 'https://images.example.test/a.jpg')
  assert.equal(reverse.candidate.image, forward.candidate.image)
})

test('fails closed rather than mixing candidate receipts from different items', () => {
  const selection = selectImageCandidate([
    candidate({ itemId: 'event:one', role: 'exact-item' }),
    candidate({ itemId: 'event:two', role: 'verified-venue', image: 'https://images.example.test/two.jpg' }),
  ], { policy })

  assert.equal(selection.state, 'none')
  assert.equal(selection.candidate, null)
  assert.deepEqual(selection.reasons, [IMAGE_CANDIDATE_CODES.MIXED_ITEM_IDS])
})

test('returns an honest fallback instead of falsely promoting a rejected exact image', () => {
  const selection = selectImageCandidate([
    candidate({ role: 'exact-item', image: 'https://unapproved.example.test/exact.jpg' }),
    candidate({
      role: 'fallback',
      image: '/place-img/aurora-fallback.jpg',
      sourcePage: 'https://source.example.test/aurora',
    }),
  ], { policy })

  assert.equal(selection.state, 'fallback')
  assert.equal(selection.role, 'fallback')
  assert.equal(selection.candidate.image, '/place-img/aurora-fallback.jpg')
  assert.equal(selection.assessments[0].state, 'rejected')
})
