function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function hasUnsafePathCharacter(value) {
  return /[\\?#\s]/.test(value)
    || [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
}

function hasUnsafeConfiguredSegment(value) {
  try {
    const decoded = decodeURIComponent(value)
    return decoded !== value
      || decoded.split('/').some((segment) => segment === '.' || segment === '..')
  } catch {
    return true
  }
}

function normalizePath(value, label) {
  invariant(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`)
  invariant(value.startsWith('/') && !value.startsWith('//'), `${label} must be root-relative`)
  invariant(!hasUnsafePathCharacter(value), `${label} contains unsafe characters`)
  invariant(!hasUnsafeConfiguredSegment(value), `${label} must not contain encoded or dot segments`)
  return `${value.endsWith('/') ? value : `${value}/`}`.replace(/\/{2,}/g, '/')
}

/**
 * Validate the build-time relationship between a standalone city's base and
 * an explicitly shared product root. With no product root, the build remains
 * a truthful standalone deployment and cross-city links stay unavailable.
 */
export function runtimeDeploymentPlan({ basePath = '/', productRoot = null, city } = {}) {
  invariant(city && typeof city === 'object', 'city is required')
  invariant(typeof city.id === 'string' && city.id, 'city.id is required')
  invariant(
    typeof city.runtimePath === 'string'
      && (city.runtimePath === '' || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.runtimePath)),
    'city.runtimePath must be empty or lowercase kebab-case',
  )
  const baseUrl = normalizePath(basePath, 'basePath')
  if (productRoot === null || productRoot === undefined) {
    return Object.freeze({
      ok: true,
      code: 'STANDALONE_CITY_BUILD',
      cityId: city.id,
      baseUrl,
      productRoot: null,
      expectedBaseUrl: null,
      switchingAvailable: false,
    })
  }

  const normalizedRoot = normalizePath(productRoot, 'productRoot')
  const expectedBaseUrl = city.runtimePath
    ? `${normalizedRoot}${city.runtimePath}/`
    : normalizedRoot
  const ok = baseUrl === expectedBaseUrl
  return Object.freeze({
    ok,
    code: ok ? 'SHARED_CITY_BUILD' : 'CITY_DEPLOYMENT_PATH_MISMATCH',
    cityId: city.id,
    baseUrl,
    productRoot: normalizedRoot,
    expectedBaseUrl,
    switchingAvailable: ok,
  })
}
