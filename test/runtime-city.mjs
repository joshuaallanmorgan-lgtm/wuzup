import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bindRuntimeCityArtifact,
  resolveRuntimeCity,
  runtimeCityHref,
} from '../app/src/runtime-city.js'
import { runtimeDeploymentPlan } from '../app/runtime-deployment.mjs'

const CITIES = Object.freeze({
  'tampa-bay': Object.freeze({
    id: 'tampa-bay',
    name: 'Tampa Bay',
    tz: 'America/New_York',
    runtimePath: '',
    runtimeAliases: ['tampa'],
    coverageLabel: 'Tampa Bay area',
    coverageDetail: 'Tampa and St. Petersburg.',
  }),
  'sf-east-bay': Object.freeze({
    id: 'sf-east-bay',
    name: 'SF & East Bay',
    tz: 'America/Los_Angeles',
    runtimePath: 'sf',
    runtimeAliases: [],
    coverageLabel: 'SF to the East Bay',
    coverageDetail: 'San Francisco through Concord.',
  }),
})

function resolve(overrides = {}) {
  return resolveRuntimeCity({
    cities: CITIES,
    configuredCityId: 'tampa-bay',
    baseUrl: '/wuzup/',
    productRoot: '/wuzup/',
    pathname: '/wuzup/',
    ...overrides,
  })
}

test('runtime city binds Tampa and SF standalone builds to their production paths', () => {
  const tampa = resolve()
  assert.equal(tampa.ok, true)
  assert.equal(tampa.cityId, 'tampa-bay')
  assert.equal(tampa.reason, 'explicit-path')
  assert.equal(tampa.canonicalHref, '/wuzup/')
  assert.equal(runtimeCityHref(tampa, 'sf-east-bay'), '/wuzup/sf/')

  const sf = resolve({
    configuredCityId: 'sf-east-bay',
    baseUrl: '/wuzup/sf/',
    pathname: '/wuzup/sf/',
  })
  assert.equal(sf.ok, true)
  assert.equal(sf.cityId, 'sf-east-bay')
  assert.equal(sf.reason, 'explicit-path')
  assert.equal(sf.productRoot, '/wuzup/')
  assert.equal(runtimeCityHref(sf, 'tampa-bay'), '/wuzup/')
})

test('the build contract enables switching only for an explicit canonical product root', () => {
  const tampa = runtimeDeploymentPlan({
    basePath: '/wuzup/',
    productRoot: '/wuzup/',
    city: CITIES['tampa-bay'],
  })
  const sf = runtimeDeploymentPlan({
    basePath: '/wuzup/sf/',
    productRoot: '/wuzup/',
    city: CITIES['sf-east-bay'],
  })
  assert.equal(tampa.ok, true)
  assert.equal(sf.ok, true)
  assert.equal(tampa.switchingAvailable, true)
  assert.equal(sf.switchingAvailable, true)

  const wrongTampa = runtimeDeploymentPlan({
    basePath: '/wuzup/sf/',
    productRoot: '/wuzup/',
    city: CITIES['tampa-bay'],
  })
  assert.equal(wrongTampa.ok, false)
  assert.equal(wrongTampa.code, 'CITY_DEPLOYMENT_PATH_MISMATCH')
  assert.equal(wrongTampa.expectedBaseUrl, '/wuzup/')

  const generic = runtimeDeploymentPlan({
    basePath: '/acme/',
    city: CITIES['sf-east-bay'],
  })
  assert.equal(generic.ok, true)
  assert.equal(generic.productRoot, null)
  assert.equal(generic.switchingAvailable, false)
})

test('runtime deployment configuration rejects encoded and dot-segment paths', () => {
  for (const basePath of ['/safe/../sf/', '/safe/%2e%2e/sf/']) {
    assert.throws(
      () => runtimeDeploymentPlan({
        basePath,
        productRoot: '/safe/',
        city: CITIES['sf-east-bay'],
      }),
      /encoded or dot segments/,
    )
  }
  for (const productRoot of ['/safe/../', '/safe/%2e%2e/']) {
    assert.throws(
      () => runtimeDeploymentPlan({
        basePath: '/safe/sf/',
        productRoot,
        city: CITIES['sf-east-bay'],
      }),
      /encoded or dot segments/,
    )
  }
  assert.throws(
    () => resolve({ baseUrl: '/wuzup/../sf/' }),
    /encoded or dot segments/,
  )
  assert.throws(
    () => resolve({ productRoot: '/wuzup/%2e%2e/' }),
    /encoded or dot segments/,
  )
})

test('root-base local builds retain their configured city without pretending to switch bytes', () => {
  const sf = resolve({
    configuredCityId: 'sf-east-bay',
    baseUrl: '/',
    productRoot: null,
    pathname: '/',
  })
  assert.equal(sf.ok, true)
  assert.equal(sf.reason, 'configured-build')
  assert.equal(sf.switchingAvailable, false)
  assert.equal(runtimeCityHref(sf, 'sf-east-bay'), '/')
  assert.equal(sf.destinations.find((entry) => entry.cityId === 'tampa-bay').available, false)
  assert.throws(() => runtimeCityHref(sf, 'tampa-bay'), /unavailable in this deployment/)
})

test('generic standalone hosting paths stay valid without inventing sibling deployments', () => {
  const sf = resolve({
    configuredCityId: 'sf-east-bay',
    baseUrl: '/acme/',
    productRoot: null,
    pathname: '/acme/',
  })
  assert.equal(sf.ok, true)
  assert.equal(sf.canonicalHref, '/acme/')
  assert.equal(sf.switchingAvailable, false)

  const tampa = resolve({
    baseUrl: '/sf/',
    productRoot: null,
    pathname: '/sf/',
  })
  assert.equal(tampa.ok, true)
  assert.equal(tampa.cityId, 'tampa-bay')
})

test('a non-root SF build must use an SF route and a Tampa build cannot occupy it', () => {
  const wrongSfBase = resolve({
    configuredCityId: 'sf-east-bay',
    baseUrl: '/wuzup/',
    pathname: '/wuzup/',
  })
  assert.equal(wrongSfBase.ok, false)
  assert.equal(wrongSfBase.code, 'CITY_BUILD_MISMATCH')

  const tampaAtSf = resolve({
    baseUrl: '/wuzup/sf/',
    pathname: '/wuzup/sf/',
  })
  assert.equal(tampaAtSf.ok, false)
  assert.equal(tampaAtSf.code, 'CITY_BUILD_MISMATCH')
  assert.equal(tampaAtSf.requestedCity, 'sf-east-bay')
  assert.equal(runtimeCityHref(tampaAtSf, 'tampa-bay'), '/wuzup/')

  const sfAtRoot = resolve({
    configuredCityId: 'sf-east-bay',
    baseUrl: '/wuzup/sf/',
    pathname: '/wuzup/',
  })
  assert.equal(sfAtRoot.ok, false)
  assert.equal(sfAtRoot.code, 'CITY_BUILD_MISMATCH')
  assert.equal(sfAtRoot.requestedCity, 'tampa-bay')

  const contradictorySfAtRoot = resolve({
    configuredCityId: 'sf-east-bay',
    baseUrl: '/wuzup/sf/',
    pathname: '/wuzup/',
    query: '?city=sf',
  })
  assert.equal(contradictorySfAtRoot.ok, false)
  assert.equal(contradictorySfAtRoot.code, 'CITY_SIGNAL_CONFLICT')
})

test('explicit canonical IDs, aliases, and query signals confirm only the configured build', () => {
  assert.equal(resolve({ query: '?city=tampa' }).reason, 'explicit-query')
  assert.equal(resolve({ pathname: '/wuzup/cities/tampa-bay/' }).reason, 'explicit-path')

  const mismatch = resolve({ query: '?city=sf-east-bay' })
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.code, 'CITY_SIGNAL_CONFLICT')
  assert.equal(mismatch.requestedCity, 'sf-east-bay')
  assert.equal(runtimeCityHref(mismatch, 'sf-east-bay'), '/wuzup/sf/')

  const pathMismatch = resolve({ pathname: '/wuzup/sf/' })
  assert.equal(pathMismatch.ok, false)
  assert.equal(pathMismatch.code, 'CITY_BUILD_MISMATCH')

  const sfIndex = resolve({
    configuredCityId: 'sf-east-bay',
    baseUrl: '/wuzup/sf/',
    pathname: '/wuzup/sf/index.html',
  })
  assert.equal(sfIndex.ok, true)
  assert.equal(sfIndex.reason, 'explicit-path')

  const conflict = resolve({ pathname: '/wuzup/sf/', query: '?city=tampa' })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'CITY_SIGNAL_CONFLICT')
})

test('unknown, malformed, duplicate, and outside explicit locations fail closed', () => {
  for (const selection of [
    resolve({ query: '?city=unknown-place' }),
    resolve({ query: '?city=tampa&city=sf' }),
    resolve({ pathname: '/wuzup/cities/%2e%2e/' }),
    resolve({ pathname: '/somewhere-else/' }),
  ]) {
    assert.equal(selection.ok, false)
  }
  assert.equal(resolve({ query: '?city=unknown-place' }).code, 'CITY_UNKNOWN')
  assert.equal(resolve({ pathname: '/somewhere-else/' }).code, 'CITY_PATH_OUTSIDE_DEPLOYMENT')
})

test('configured city identity is mandatory and duplicate route tokens are rejected', () => {
  assert.throws(
    () => resolve({ configuredCityId: 'nope' }),
    /unknown configured city/,
  )
  const duplicate = {
    ...CITIES,
    'other-city': {
      ...CITIES['tampa-bay'],
      id: 'other-city',
      name: 'Other',
      runtimePath: 'sf',
      runtimeAliases: [],
    },
  }
  assert.throws(
    () => resolveRuntimeCity({ cities: duplicate, configuredCityId: 'tampa-bay' }),
    /belongs to more than one city/,
  )
  const noRoot = {
    ...CITIES,
    'tampa-bay': { ...CITIES['tampa-bay'], runtimePath: 'tampa' },
  }
  assert.throws(
    () => resolveRuntimeCity({ cities: noRoot, configuredCityId: 'tampa-bay' }),
    /must own the product root/,
  )
})

test('verified artifact metadata must preserve city, timezone, and immutable identities', () => {
  const tampa = resolve()
  const good = bindRuntimeCityArtifact(tampa, {
    cityId: 'tampa-bay',
    timeZone: 'America/New_York',
    manifestId: 'sha256:manifest',
    buildId: 'sha256:build',
  })
  assert.equal(good.ok, true)
  assert.equal(good.code, 'CITY_ARTIFACT_BOUND')
  assert.equal(bindRuntimeCityArtifact(tampa, null).code, 'CITY_ARTIFACT_PENDING')
  assert.equal(bindRuntimeCityArtifact(tampa, { ...good, cityId: 'sf-east-bay' }).code, 'CITY_ARTIFACT_MISMATCH')
  assert.equal(bindRuntimeCityArtifact(tampa, { ...good, timeZone: 'UTC' }).code, 'CITY_TIMEZONE_MISMATCH')
  assert.equal(bindRuntimeCityArtifact(tampa, {
    cityId: 'tampa-bay',
    timeZone: 'America/New_York',
  }).code, 'CITY_ARTIFACT_IDENTITY_MISSING')
})

test('runtime resolution is deterministic and does not mutate the registry', () => {
  const before = JSON.stringify(CITIES)
  const first = resolve()
  const second = resolve()
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(CITIES), before)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.destinations), true)
})
