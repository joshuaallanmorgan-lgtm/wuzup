import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FROZEN_RELEVANCE_FIXTURE_PINS,
  RELEVANCE_RUBRIC_STATUS,
  validateRelevanceRubric,
} from '../shared/relevance-rubric.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEVANCE_DIR = path.join(ROOT, 'test', 'fixtures', 'relevance')

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function fixtureReceipts() {
  return Promise.all(FROZEN_RELEVANCE_FIXTURE_PINS.map(async (pin) => {
    const raw = await readFile(path.join(RELEVANCE_DIR, pin.fixtureFile))
    return {
      cityId: pin.cityId,
      sha256: createHash('sha256').update(raw).digest('hex'),
      fixture: JSON.parse(raw),
    }
  }))
}

test('the provisional owner-review rubric pins fixture provenance without ratifying labels', async () => {
  const rubric = await json(path.join(RELEVANCE_DIR, 'rubric.v1.json'))
  const receipts = await fixtureReceipts()

  assert.equal(rubric.status, RELEVANCE_RUBRIC_STATUS)
  assert.equal(rubric.proposedGates.firstScreen.precisionAtLeast, 1)
  assert.equal(rubric.proposedGates.firstScreen.ndcgAtLeast, 0.9)
  assert.equal(validateRelevanceRubric(rubric, { fixtureReceipts: receipts }), rubric)
  assert.ok(receipts.every(({ fixture }) => fixture.judgmentStatus === 'draft-owner-review'))
  assert.ok(rubric.provisionalUse.includes('does not authorize production'))
})

test('validator rejects status changes and weakened safety or diversity gates', async () => {
  const rubric = await json(path.join(RELEVANCE_DIR, 'rubric.v1.json'))

  const ratified = structuredClone(rubric)
  ratified.status = 'owner-ratified'
  assert.throws(() => validateRelevanceRubric(ratified), /status/)

  const weakPrecision = structuredClone(rubric)
  weakPrecision.proposedGates.firstScreen.precisionAtLeast = 0.99
  assert.throws(() => validateRelevanceRubric(weakPrecision), /precision/)

  const weakNdcg = structuredClone(rubric)
  weakNdcg.proposedGates.firstScreen.ndcgAtLeast = 0.89
  assert.throws(() => validateRelevanceRubric(weakNdcg), /nDCG/)

  const impossibleNdcg = structuredClone(rubric)
  impossibleNdcg.proposedGates.firstScreen.ndcgAtLeast = 1.01
  assert.throws(() => validateRelevanceRubric(impossibleNdcg), /nDCG/)

  const weakSourceDiversity = structuredClone(rubric)
  weakSourceDiversity.proposedGates.firstScreen.sourceMaxShareAtMost = 0.5
  assert.throws(() => validateRelevanceRubric(weakSourceDiversity), /source max-share/)

  const leakage = structuredClone(rubric)
  leakage.proposedGates.firstScreen.actionabilityLeakageAtMost = 0.01
  assert.throws(() => validateRelevanceRubric(leakage), /actionabilityLeakageAtMost/)
})

test('validator rejects contradictory hard drops, false limited passes, and fixture drift', async () => {
  const rubric = await json(path.join(RELEVANCE_DIR, 'rubric.v1.json'))

  const chainDrop = structuredClone(rubric)
  chainDrop.definitions.hardDropReasons.push('chain')
  assert.throws(() => validateRelevanceRubric(chainDrop), /hardDropReasons/)

  const falseLimitedPass = structuredClone(rubric)
  falseLimitedPass.proposedGates.sparseCityLimited.effect = 'Source share is waived and the limited state passes.'
  assert.throws(() => validateRelevanceRubric(falseLimitedPass), /limited-city escape/)

  const receipts = await fixtureReceipts()
  receipts[0].sha256 = '0'.repeat(64)
  assert.throws(() => validateRelevanceRubric(rubric, { fixtureReceipts: receipts }), /fixture hash drifted/)
})
