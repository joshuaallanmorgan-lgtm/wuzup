const STATUS = 'architect-default-awaiting-owner-ratification'
const REQUIRED_RELEVANCE = ['0', '1', '2', '3']
const HARD_DROP_REASONS = [
  'objective-non-product',
  'wrong-market',
  'cancelled',
  'ended',
  'known-false-merge',
]
const DEMOTE_REASONS = [
  'legitimate-low-information',
  'business-promotion',
  'chain',
  'generic-facility',
  'tribute-bill',
  'recurrence-overexposure',
]

export const RELEVANCE_RUBRIC_STATUS = STATUS
export const FROZEN_RELEVANCE_FIXTURE_PINS = Object.freeze([
  Object.freeze({
    cityId: 'tampa-bay',
    fixtureFile: 'tampa-bay.v1.json',
    fixtureId: 'tampa-bay-relevance-v1',
    fixtureSha256: 'ba857c5bcf07ebbf456f20e9c477c3b9e4bb21f58fe72823a14d1f95e525bfa4',
    fixtureJudgmentStatus: 'draft-owner-review',
    manifestId: 'sha256:035cb1eed7e67d143c4b0739d8dd3c2373bd3af2e85562aad0fc4895651615b1',
    buildId: 'sha256:65a75e81823893d24051e99387364d1b1ab450be748f6dc58cc58c14d61d5381',
    eventsSha256: 'a8df0d0cefb461c6e417092b42de20067cf4f1bfb68314e5e91c4f70f875d090',
    placesSha256: '749eed658f2df7c8f9d175391ba06518c7b88168f4e27afab0a63ff647e3a57b',
  }),
  Object.freeze({
    cityId: 'sf-east-bay',
    fixtureFile: 'sf-east-bay.v1.json',
    fixtureId: 'sf-east-bay-relevance-v1',
    fixtureSha256: '901f9a4970d79d67cbb7d9b9f7b9d6269a75a74a2195c9db6093606b79b13125',
    fixtureJudgmentStatus: 'draft-owner-review',
    manifestId: 'sha256:1690a379633d3a7117ee167a8600d27a151d650bfad66ae9efa010af47c2740a',
    buildId: 'sha256:df88fafec557c009b195a845332273f006a074fc12dbe0d97292777e0a1bd4cb',
    eventsSha256: '84981a8ec48f0245e23e168fb63bc2071cceb5e1eda4e115828264a92873b1d8',
    placesSha256: '1f42b49ee860b3ad2a5a887192eaa0b77689ab457f4671b28bdda85c4a39ad78',
  }),
])

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function object(value, name) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`)
  return value
}

function nonEmpty(value, name) {
  invariant(typeof value === 'string' && value.trim().length > 0, `${name} must be a non-empty string`)
}

function sameArray(actual, expected, name) {
  invariant(Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]),
    `${name} must remain ${expected.join(', ')}`)
}

function validateDefinitions(definitions) {
  object(definitions, 'definitions')
  const relevance = object(definitions.relevance, 'definitions.relevance')
  sameArray(Object.keys(relevance).sort(), REQUIRED_RELEVANCE, 'definitions.relevance keys')
  for (const key of REQUIRED_RELEVANCE) nonEmpty(relevance[key], `definitions.relevance.${key}`)

  const actionability = object(definitions.actionable, 'definitions.actionable')
  sameArray(Object.keys(actionability).sort(), ['no', 'yes'], 'definitions.actionable keys')
  nonEmpty(actionability.yes, 'definitions.actionable.yes')
  nonEmpty(actionability.no, 'definitions.actionable.no')

  const gem = object(definitions.gem, 'definitions.gem')
  sameArray(Object.keys(gem).sort(), ['insufficient', 'no', 'yes'], 'definitions.gem keys')
  for (const key of ['yes', 'no', 'insufficient']) nonEmpty(gem[key], `definitions.gem.${key}`)
  invariant(/must not support a gem claim/i.test(gem.insufficient), 'insufficient gem evidence must forbid a claim')

  sameArray(definitions.hardDropReasons, HARD_DROP_REASONS, 'definitions.hardDropReasons')
  sameArray(definitions.demoteReasons, DEMOTE_REASONS, 'definitions.demoteReasons')
  const tiers = object(definitions.evidenceTiers, 'definitions.evidenceTiers')
  sameArray(Object.keys(tiers).sort(), ['candidate', 'recommended', 'top-placement'], 'definitions.evidenceTiers keys')
  for (const key of ['candidate', 'recommended', 'top-placement']) nonEmpty(tiers[key], `definitions.evidenceTiers.${key}`)
}

function validateGates(gates) {
  object(gates, 'proposedGates')
  invariant(gates.evaluationPrefix === 3, 'evaluationPrefix must be 3')
  const firstScreen = object(gates.firstScreen, 'proposedGates.firstScreen')
  invariant(firstScreen.precisionAtLeast === 1, 'first-screen precision gate must be exactly 1.0')
  invariant(typeof firstScreen.ndcgAtLeast === 'number' && firstScreen.ndcgAtLeast >= 0.9 && firstScreen.ndcgAtLeast <= 1,
    'first-screen nDCG gate must be between 0.9 and 1.0')
  for (const key of ['knownBadRateAtMost', 'actionabilityLeakageAtMost', 'duplicateExposureRateAtMost']) {
    invariant(firstScreen[key] === 0, `${key} must remain zero`)
  }
  invariant(typeof firstScreen.sourceMaxShareAtMost === 'number' && firstScreen.sourceMaxShareAtMost >= 0 && firstScreen.sourceMaxShareAtMost <= 0.35,
    'source max-share gate must be between 0 and 0.35')
  invariant(firstScreen.countPreservingReachability === true, 'count-preserving reachability is required')

  const sparse = object(gates.sparseCityLimited, 'proposedGates.sparseCityLimited')
  nonEmpty(sparse.activation, 'proposedGates.sparseCityLimited.activation')
  nonEmpty(sparse.effect, 'proposedGates.sparseCityLimited.effect')
  invariant(/not passed or waived/i.test(sparse.effect), 'limited-city escape must not treat unavailable metrics as a pass')
  sameArray(sparse.nonWaivable, [
    'knownBadRateAtMost',
    'actionabilityLeakageAtMost',
    'duplicateExposureRateAtMost',
    'countPreservingReachability',
  ], 'proposedGates.sparseCityLimited.nonWaivable')
}

function validatePin(pin, expected) {
  object(pin, `fixture pin ${expected.cityId}`)
  for (const [key, value] of Object.entries(expected)) {
    invariant(pin[key] === value, `fixture pin ${expected.cityId}.${key} drifted`)
  }
}

function validateReceipts(receipts, pins) {
  if (receipts == null) return
  invariant(Array.isArray(receipts) && receipts.length === pins.length, 'fixture receipts must include every pinned city')
  const byCity = new Map(receipts.map((receipt) => [receipt && receipt.cityId, receipt]))
  for (const pin of pins) {
    const receipt = byCity.get(pin.cityId)
    object(receipt, `fixture receipt ${pin.cityId}`)
    invariant(receipt.sha256 === pin.fixtureSha256, `${pin.cityId} fixture hash drifted`)
    const fixture = object(receipt.fixture, `${pin.cityId} fixture`)
    invariant(fixture.fixtureId === pin.fixtureId, `${pin.cityId} fixture ID drifted`)
    invariant(fixture.judgmentStatus === 'draft-owner-review', `${pin.cityId} fixture labels must remain draft-owner-review`)
    for (const key of ['manifestId', 'buildId', 'eventsSha256', 'placesSha256']) {
      invariant(fixture.origin?.[key] === pin[key], `${pin.cityId} fixture origin.${key} drifted`)
    }
  }
}

/**
 * Validates the provisional owner-review packet. It intentionally validates
 * frozen labels as draft evidence, never as owner-approved truth.
 */
export function validateRelevanceRubric(rubric, { fixtureReceipts = null } = {}) {
  object(rubric, 'rubric')
  invariant(rubric.schemaVersion === 1, 'rubric.schemaVersion must be 1')
  invariant(rubric.rubricId === 'wuzup-relevance-rubric-v1', 'rubric.rubricId drifted')
  invariant(rubric.status === STATUS, `rubric.status must remain ${STATUS}`)
  nonEmpty(rubric.provisionalUse, 'rubric.provisionalUse')
  invariant(/does not authorize production/i.test(rubric.provisionalUse), 'rubric must not authorize production use')

  invariant(Array.isArray(rubric.fixturePins) && rubric.fixturePins.length === FROZEN_RELEVANCE_FIXTURE_PINS.length,
    'rubric.fixturePins must contain the frozen cities')
  FROZEN_RELEVANCE_FIXTURE_PINS.forEach((expected, index) => validatePin(rubric.fixturePins[index], expected))
  validateDefinitions(rubric.definitions)
  validateGates(rubric.proposedGates)
  validateReceipts(fixtureReceipts, FROZEN_RELEVANCE_FIXTURE_PINS)
  return rubric
}
