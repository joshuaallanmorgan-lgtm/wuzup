// Node facade for the browser-safe cities-index contract. Keep cryptographic
// hashing here so shared/cities-index-core.mjs can enter a browser bundle
// without a Node builtin while preserving every existing public API.
import { createHash } from 'node:crypto'

import {
  artifactLoadPlanFromValidatedIndex,
  canonicalCitiesIndexJson,
  resolveValidatedLocation,
  validateCitiesIndexShape,
} from './cities-index-core.mjs'

export {
  artifactLoadPlanFromValidatedIndex,
  canonicalCitiesIndexJson,
  CITIES_INDEX_LIMITS,
  resolveValidatedLocation,
  validateCitiesIndexShape,
} from './cities-index-core.mjs'

export function calculateCitiesIndexId(index) {
  const digest = createHash('sha256').update(canonicalCitiesIndexJson(index)).digest('hex')
  return `sha256:${digest}`
}

function validatedCitiesIndexSnapshot(index) {
  const snapshot = validateCitiesIndexShape(index)
  if (calculateCitiesIndexId(snapshot) !== snapshot.indexId) {
    throw new TypeError('index.indexId does not match its canonical contents')
  }
  return snapshot
}

export function validateCitiesIndex(index) {
  validatedCitiesIndexSnapshot(index)
  return index
}

export function resolveLocation(input = {}) {
  const index = validatedCitiesIndexSnapshot(input.index)
  return resolveValidatedLocation({ ...input, index })
}

export function artifactLoadPlan(index, resolution, options = {}) {
  const snapshot = validatedCitiesIndexSnapshot(index)
  return artifactLoadPlanFromValidatedIndex(snapshot, resolution, options)
}
