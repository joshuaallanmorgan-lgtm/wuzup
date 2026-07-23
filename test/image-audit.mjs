import assert from 'node:assert/strict'
import test from 'node:test'

import { auditImageTruth, classifyImageReference, IMAGE_AUDIT_FINDING_CODES } from '../shared/image-audit.mjs'

test('classifies delivery without treating a remote host as licensing evidence', () => {
  assert.equal(classifyImageReference('/place-img/venue.jpg').kind, 'selfHosted')
  assert.equal(classifyImageReference('https://cdn.example.test/image.jpg', {
    selfHostedHosts: ['cdn.example.test'],
  }).kind, 'selfHosted')
  assert.equal(classifyImageReference('https://upload.wikimedia.org/image.jpg').kind, 'remote')
  assert.equal(classifyImageReference('//upload.wikimedia.org/image.jpg').kind, 'invalid')
  assert.equal(classifyImageReference('http://upload.wikimedia.org/image.jpg').kind, 'invalid')
  assert.equal(classifyImageReference('/%2e%2e%5cprivate.jpg').kind, 'invalid')
  assert.equal(classifyImageReference('/place-img/%00private.jpg').kind, 'invalid')
  assert.equal(classifyImageReference('/place-img/%ZZprivate.jpg').kind, 'invalid')
  assert.equal(classifyImageReference('data:image/png;base64,AA==').kind, 'invalid')
})

test('reports duplicate URLs and missing evidence independently for each screen scope', () => {
  const report = auditImageTruth({
    items: [
      { id: 'one', image: 'https://media.example.test/a.jpg' },
      { id: 'two', image: 'https://media.example.test/a.jpg', imageCredit: { author: 'A', license: 'CC BY 4.0' } },
      { id: 'three', image: '/place-img/three.jpg', imageCredit: { sourceFamily: 'first-party', license: 'All rights reserved', sha256: 'a'.repeat(64) } },
    ],
    firstScreenItemIds: ['two', 'one'],
    policy: { remote: 'ready', selfHosted: 'ready' },
  })
  assert.equal(report.fullCorpus.duplicateReferences, 1)
  assert.equal(report.firstScreen.duplicateReferences, 1)
  assert.equal(report.firstScreen.missingAttributionEvidence, 1)
  assert.equal(report.firstScreen.missingLicenseEvidence, 1)
  assert.equal(report.firstScreen.risk, 'high')
  assert.ok(report.findings.some((finding) =>
    finding.code === IMAGE_AUDIT_FINDING_CODES.DUPLICATE_IMAGE_URL && finding.scope === 'first-screen'))
})

test('uses broken, blocked, and unknown readiness rather than licensing claims', () => {
  const report = auditImageTruth({
    items: [
      { id: 'invalid', image: 'javascript:alert(1)' },
      { id: 'blocked', image: 'https://licensed-looking.example.test/a.jpg', imageCredit: { author: 'A', license: 'CC BY 4.0' } },
      { id: 'unknown', image: '/place-img/a.jpg', imageCredit: { author: 'B', license: 'CC0', sha256: 'b'.repeat(64) } },
    ],
    firstScreenItemIds: ['invalid', 'blocked', 'unknown', 'missing'],
    policy: { remote: 'blocked', selfHosted: 'unknown' },
  })
  assert.deepEqual(report.fullCorpus.readiness, { ready: 0, unknown: 1, blocked: 1, broken: 1 })
  assert.equal(report.fullCorpus.risk, 'high')
  assert.deepEqual(report.firstScreen.unresolvedItemIds, ['missing'])
  assert.match(report.licenseStatement, /does not verify or claim a remote URL is licensed/)
})

test('does not invent a first-screen assessment without a supplied selection', () => {
  const report = auditImageTruth({
    items: [{
      key: 'event:1',
      image: 'https://remote.example.test/a.jpg',
      imageCredit: { author: 'Example', license: 'CC BY 4.0' },
    }],
  })
  assert.equal(report.fullCorpus.readiness.unknown, 1)
  assert.equal(report.firstScreen.selectionAvailable, false)
  assert.equal(report.firstScreen.risk, 'not-assessed')
  assert.equal(report.findings.some((finding) => finding.scope === 'first-screen'), false)
})

test('treats unresolved supplied first-screen IDs as elevated rather than clear', () => {
  const report = auditImageTruth({
    items: [{
      id: 'ready',
      image: '/place-img/ready.jpg',
      imageCredit: { author: 'Example', license: 'CC0', sha256: 'c'.repeat(64) },
    }],
    firstScreenItemIds: ['missing'],
    policy: { remote: 'ready', selfHosted: 'ready' },
  })

  assert.equal(report.fullCorpus.risk, 'clear')
  assert.equal(report.firstScreen.selectionComplete, false)
  assert.deepEqual(report.firstScreen.unresolvedItemIds, ['missing'])
  assert.equal(report.firstScreen.risk, 'elevated')
})

test('blocks self-hosted bytes without a valid sha256 binding', () => {
  const report = auditImageTruth({
    items: [
      { id: 'missing', image: '/place-img/missing.jpg', imageCredit: { author: 'A', license: 'CC0' } },
      { id: 'valid', image: '/place-img/valid.jpg', imageSha256: `sha256:${'d'.repeat(64)}`, imageCredit: { author: 'B', license: 'CC0' } },
    ],
    firstScreenItemIds: ['missing', 'valid'],
    policy: { remote: 'ready', selfHosted: 'ready' },
  })

  assert.equal(report.fullCorpus.missingByteBindingEvidence, 1)
  assert.equal(report.fullCorpus.readiness.blocked, 1)
  assert.equal(report.fullCorpus.readiness.ready, 1)
  assert.ok(report.findings.some((finding) =>
    finding.code === IMAGE_AUDIT_FINDING_CODES.SELF_HOSTED_BYTE_BINDING_MISSING))
})
