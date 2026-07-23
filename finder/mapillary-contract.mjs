const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function currentOrLegacy(crop, currentKey, legacyKey) {
  return hasOwn(crop, currentKey) ? crop[currentKey] : crop[legacyKey]
}

export function normalizeMapillaryCropGuard(value) {
  const crop = value && typeof value === 'object' ? value : {}
  return {
    isDirectoryOrPylon: currentOrLegacy(crop, 'isDirectoryOrPylon', 'rjPylon'),
    cafeIsDominantSubject: currentOrLegacy(crop, 'cafeIsDominantSubject', 'rjDominant'),
    otherBusinessNameOnSign: currentOrLegacy(crop, 'otherBusinessNameOnSign', 'rjOtherBiz'),
  }
}

export function hasSpecificBusinessName(value) {
  const name = value == null ? '' : String(value).trim()
  return name.length > 0 && !/^(none|null|n\/?a|no|na)$/i.test(name)
}

export function hasMapillaryGuardSignals(crop) {
  const guard = normalizeMapillaryCropGuard(crop)
  return typeof guard.isDirectoryOrPylon === 'boolean' &&
    typeof guard.cafeIsDominantSubject === 'boolean'
}

export function mapillaryCropFailsClosed(crop) {
  const guard = normalizeMapillaryCropGuard(crop)
  return !hasMapillaryGuardSignals(crop) ||
    guard.isDirectoryOrPylon === true ||
    (guard.cafeIsDominantSubject === false && hasSpecificBusinessName(guard.otherBusinessNameOnSign))
}
