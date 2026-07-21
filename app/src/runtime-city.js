const CITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

function normalizedBaseUrl(value = '/') {
  invariant(typeof value === 'string' && value.length > 0, 'baseUrl must be a non-empty string')
  invariant(value.startsWith('/') && !value.startsWith('//'), 'baseUrl must be root-relative')
  invariant(!hasUnsafePathCharacter(value), 'baseUrl must not contain a query, hash, or unsafe character')
  invariant(!hasUnsafeConfiguredSegment(value), 'baseUrl must not contain encoded or dot segments')
  return `${value.endsWith('/') ? value : `${value}/`}`.replace(/\/{2,}/g, '/')
}

function normalizedPathname(value, baseUrl) {
  if (value === undefined || value === null || value === '') return baseUrl
  invariant(typeof value === 'string', 'pathname must be a string')
  invariant(value.startsWith('/') && !value.startsWith('//'), 'pathname must be root-relative')
  invariant(!hasUnsafePathCharacter(value), 'pathname must not contain a query, hash, or unsafe character')
  return value.replace(/\/{2,}/g, '/')
}

function deploymentPath(city) {
  const value = city.runtimePath
  invariant(typeof value === 'string', `${city.id}.runtimePath must be a string`)
  invariant(value === '' || CITY_ID.test(value), `${city.id}.runtimePath must be empty or lowercase kebab-case`)
  return value
}

function registry(cities) {
  invariant(isRecord(cities), 'cities must be an object registry')
  const entries = Object.entries(cities)
  invariant(entries.length > 0, 'cities must not be empty')
  const tokens = new Map()
  let rootCityId = null
  for (const [key, city] of entries) {
    invariant(isRecord(city), `cities.${key} must be an object`)
    invariant(city.id === key && CITY_ID.test(key), `cities.${key}.id must match its lowercase kebab-case key`)
    invariant(typeof city.name === 'string' && city.name.trim(), `${key}.name is required`)
    invariant(typeof city.tz === 'string' && city.tz.trim(), `${key}.tz is required`)
    invariant(typeof city.coverageLabel === 'string' && city.coverageLabel.trim(), `${key}.coverageLabel is required`)
    invariant(typeof city.coverageDetail === 'string' && city.coverageDetail.trim(), `${key}.coverageDetail is required`)
    const route = deploymentPath(city)
    if (route === '') {
      invariant(rootCityId === null, 'only one runtime city may own the product root')
      rootCityId = key
    }
    const aliases = city.runtimeAliases ?? []
    invariant(Array.isArray(aliases), `${key}.runtimeAliases must be an array`)
    const cityTokens = new Set([key, route, ...aliases].filter(Boolean))
    for (const token of cityTokens) {
      invariant(typeof token === 'string' && CITY_ID.test(token), `${key} runtime aliases must be lowercase kebab-case`)
      const owner = tokens.get(token)
      invariant(!owner || owner === key, `runtime city token '${token}' belongs to more than one city`)
      tokens.set(token, key)
    }
  }
  invariant(rootCityId !== null, 'one runtime city must own the product root')
  return { entries, tokens, rootCityId }
}

function querySignal(query) {
  if (query === undefined || query === null || query === '') return { present: false, token: null }
  const params = query instanceof URLSearchParams
    ? query
    : new URLSearchParams(String(query).replace(/^\?/, ''))
  if (!params.has('city')) return { present: false, token: null }
  const values = params.getAll('city')
  if (values.length !== 1) return { present: true, token: null, invalid: true }
  const token = String(values[0] ?? '').trim().toLowerCase()
  return { present: true, token, invalid: !CITY_ID.test(token) }
}

function pathSignal(pathname, productRoot) {
  if (!pathname.startsWith(productRoot)) {
    return { present: true, token: null, invalid: true, outside: true }
  }
  const relative = pathname.slice(productRoot.length).replace(/^\/+|\/+$/g, '')
  const segments = relative ? relative.split('/') : []
  if (segments.at(-1) === 'index.html') segments.pop()
  if (segments.length === 0) return { present: false, token: null, root: true }
  const token = segments[0] === 'cities' ? segments[1] : segments[0]
  if (!token || (segments[0] === 'cities' && segments.length !== 2) || (segments[0] !== 'cities' && segments.length !== 1)) {
    return { present: true, token: null, invalid: true }
  }
  try {
    const decoded = decodeURIComponent(token).trim().toLowerCase()
    return { present: true, token: decoded, invalid: !CITY_ID.test(decoded) }
  } catch {
    return { present: true, token: null, invalid: true }
  }
}

function hrefAt(productRoot, city) {
  const route = deploymentPath(city)
  return route ? `${productRoot}${route}/` : productRoot
}

function frozenDestinations(entries, productRoot, activeCityId, { baseUrl, topologyKnown }) {
  return Object.freeze(entries.map(([, city]) => {
    const active = city.id === activeCityId
    return Object.freeze({
      cityId: city.id,
      name: city.name,
      coverageLabel: city.coverageLabel,
      coverageDetail: city.coverageDetail,
      href: topologyKnown ? hrefAt(productRoot, city) : active ? baseUrl : null,
      available: active || topologyKnown,
      active,
    })
  }))
}

function failure({
  code,
  configured,
  requestedCity = null,
  baseUrl,
  pathname,
  productRoot,
  topologyKnown,
  entries,
}) {
  return Object.freeze({
    ok: false,
    code,
    city: configured,
    cityId: configured?.id ?? null,
    configuredCityId: configured?.id ?? null,
    requestedCity,
    baseUrl,
    pathname,
    productRoot,
    switchingAvailable: topologyKnown,
    destinations: frozenDestinations(entries, productRoot, configured?.id ?? null, {
      baseUrl,
      topologyKnown,
    }),
  })
}

/**
 * Bind one standalone city build to its browser address. Explicit query/path
 * signals may confirm that build, but can never relabel its verified bytes.
 */
export function resolveRuntimeCity({
  cities,
  configuredCityId,
  baseUrl = '/',
  productRoot: requestedProductRoot = null,
  pathname = null,
  query = '',
} = {}) {
  const { entries, tokens, rootCityId } = registry(cities)
  const configured = cities[configuredCityId]
  invariant(configured, `unknown configured city '${configuredCityId}'`)
  const base = normalizedBaseUrl(baseUrl)
  const path = normalizedPathname(pathname, base)
  const topologyKnown = requestedProductRoot !== null && requestedProductRoot !== undefined
  const productRoot = topologyKnown ? normalizedBaseUrl(requestedProductRoot) : base
  invariant(base.startsWith(productRoot), 'baseUrl must be inside productRoot')
  const queryChoice = querySignal(query)
  const pathChoice = pathSignal(path, productRoot)

  const invalid = [queryChoice, pathChoice].find((choice) => choice.present && choice.invalid)
  if (invalid) {
    return failure({
      code: invalid.outside ? 'CITY_PATH_OUTSIDE_DEPLOYMENT' : 'CITY_REQUEST_INVALID',
      configured,
      baseUrl: base,
      pathname: path,
      productRoot,
      topologyKnown,
      entries,
    })
  }

  const pathPresent = pathChoice.present || (topologyKnown && pathChoice.root === true)
  const queryId = queryChoice.present ? tokens.get(queryChoice.token) : null
  const pathId = pathChoice.present
    ? tokens.get(pathChoice.token)
    : topologyKnown && pathChoice.root ? rootCityId : null
  const unknown = queryChoice.present && !queryId
    ? queryChoice
    : pathPresent && !pathId ? pathChoice : null
  if (unknown) {
    return failure({
      code: 'CITY_UNKNOWN',
      configured,
      requestedCity: unknown.token,
      baseUrl: base,
      pathname: path,
      productRoot,
      topologyKnown,
      entries,
    })
  }
  if (queryId && pathId && queryId !== pathId) {
    return failure({
      code: 'CITY_SIGNAL_CONFLICT',
      configured,
      requestedCity: queryId,
      baseUrl: base,
      pathname: path,
      productRoot,
      topologyKnown,
      entries,
    })
  }

  const requestedId = queryId || pathId || configured.id
  if (requestedId !== configured.id) {
    return failure({
      code: 'CITY_BUILD_MISMATCH',
      configured,
      requestedCity: requestedId,
      baseUrl: base,
      pathname: path,
      productRoot,
      topologyKnown,
      entries,
    })
  }
  const canonicalHref = topologyKnown ? hrefAt(productRoot, configured) : base
  if (topologyKnown && base !== canonicalHref) {
    return failure({
      code: 'CITY_BASE_MISMATCH',
      configured,
      baseUrl: base,
      pathname: path,
      productRoot,
      topologyKnown,
      entries,
    })
  }

  return Object.freeze({
    ok: true,
    code: 'CITY_READY',
    reason: queryChoice.present || pathPresent
      ? queryChoice.present ? 'explicit-query' : 'explicit-path'
      : 'configured-build',
    city: configured,
    cityId: configured.id,
    configuredCityId: configured.id,
    requestedCity: queryChoice.present
      ? queryChoice.token
      : pathPresent ? pathChoice.token || rootCityId : null,
    baseUrl: base,
    pathname: path,
    productRoot,
    switchingAvailable: topologyKnown,
    canonicalHref,
    destinations: frozenDestinations(entries, productRoot, configured.id, {
      baseUrl: base,
      topologyKnown,
    }),
  })
}

export function runtimeCityHref(selection, cityId) {
  invariant(isRecord(selection) && typeof selection.productRoot === 'string', 'runtime city selection is required')
  const destination = selection.destinations?.find((entry) => entry.cityId === cityId)
  invariant(destination, `unknown runtime city destination '${cityId}'`)
  invariant(destination.available && destination.href, `runtime city destination '${cityId}' is unavailable in this deployment`)
  return destination.href
}

/** Confirm that manifest-verified artifact metadata still names the active city. */
export function bindRuntimeCityArtifact(selection, meta) {
  if (!selection?.ok) return Object.freeze({ ok: false, code: 'CITY_RUNTIME_UNAVAILABLE' })
  if (!isRecord(meta)) return Object.freeze({ ok: false, code: 'CITY_ARTIFACT_PENDING' })
  if (meta.cityId !== selection.cityId) {
    return Object.freeze({ ok: false, code: 'CITY_ARTIFACT_MISMATCH' })
  }
  if (meta.timeZone !== selection.city.tz) {
    return Object.freeze({ ok: false, code: 'CITY_TIMEZONE_MISMATCH' })
  }
  if (typeof meta.manifestId !== 'string' || typeof meta.buildId !== 'string') {
    return Object.freeze({ ok: false, code: 'CITY_ARTIFACT_IDENTITY_MISSING' })
  }
  return Object.freeze({
    ok: true,
    code: 'CITY_ARTIFACT_BOUND',
    cityId: selection.cityId,
    timeZone: selection.city.tz,
    manifestId: meta.manifestId,
    buildId: meta.buildId,
  })
}
