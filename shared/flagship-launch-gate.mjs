import { validIso } from './artifact-contract.mjs'
import { observeS11ParticipantRelease, S11_PRODUCTION_OBSERVATION_SCHEMA, S11_PRODUCTION_OBSERVATION_SCHEMA_VERSION } from './beta-production-observation.mjs'
import { S11_BETA_CITY_IDS } from './beta-research.mjs'
import { evaluateCityLaunchGate } from './city-launch-gate.mjs'

// This module deliberately consumes CI-produced city receipts and a
// participant-facing deployment observation. It does not authenticate, create,
// or ratify either kind of evidence: that trusted CI evidence-producer remains
// outside this contract.
export const FLAGSHIP_LAUNCH_GATE_SCHEMA = 'wuzup-flagship-launch-gate'
export const FLAGSHIP_LAUNCH_GATE_SCHEMA_VERSION = 1
export const FLAGSHIP_LAUNCH_GATE_VERSION = 'wuzup-flagship-launch-gate/v1'

const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const SOURCE_COMMIT = /^[a-f0-9]{40}$/
const OBSERVATION_REASONS = Object.freeze([
  'PRODUCTION_OBSERVATION_UNAVAILABLE',
  'PRODUCTION_OBSERVATION_SCHEMA_INVALID',
  'PRODUCTION_OBSERVATION_EVALUATED_AT_MISMATCH',
  'PRODUCTION_OBSERVATION_NOT_OBSERVED',
  'PRODUCTION_OBSERVATION_HAS_BLOCKERS',
  'PRODUCTION_OBSERVATION_SITE_BINDING_MISMATCH',
  'PRODUCTION_OBSERVATION_CITY_BINDING_MISMATCH',
])
const TRUSTED_OBSERVER_REASON = 'TRUSTED_PRODUCTION_OBSERVER_REQUIRED'

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value, expected, label) {
  invariant(plainObject(value), `${label} must be an object`)
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} must not contain symbol keys`)
  const names = Object.getOwnPropertyNames(value).sort()
  const wanted = [...expected].sort()
  invariant(names.join('|') === wanted.join('|'), `${label} must contain exactly: ${wanted.join(', ')}`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const name of names) {
    invariant(
      Object.hasOwn(descriptors[name], 'value') && descriptors[name].enumerable,
      `${label}.${name} must be an enumerable data property`,
    )
  }
}

function inputKeys(value, { allowObserver }) {
  invariant(plainObject(value), 'input must be an object')
  invariant(Object.getOwnPropertySymbols(value).length === 0, 'input must not contain symbol keys')
  const allowed = new Set(['asOf', 'expectedSiteReleaseId', 'expectedSourceCommit', 'cityGateInputs'])
  if (allowObserver) allowed.add('observer')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const name of Object.getOwnPropertyNames(value)) {
    invariant(allowed.has(name), `input contains unsupported key '${name}'`)
    invariant(Object.hasOwn(descriptors[name], 'value') && descriptors[name].enumerable, `input.${name} must be an enumerable data property`)
  }
  for (const name of ['asOf', 'expectedSiteReleaseId', 'expectedSourceCommit', 'cityGateInputs']) {
    invariant(Object.hasOwn(value, name), `input.${name} is required`)
  }
  if (allowObserver) invariant(Object.hasOwn(value, 'observer'), 'input.observer is required')
}

function denseArray(value, label, length) {
  invariant(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `${label} must be an array`)
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} must not contain symbol keys`)
  invariant(value.length === length, `${label} must contain exactly ${length} entries`)
  const names = Object.getOwnPropertyNames(value)
  invariant(names.length === value.length + 1 && names.includes('length'), `${label} must be dense and contain no extra properties`)
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    invariant(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, `${label}[${index}] must be an enumerable data property`)
  }
}

function canonicalIso(value, label) {
  invariant(validIso(value), `${label} must be a canonical ISO timestamp`)
  return value
}

function releaseId(value, label) {
  invariant(typeof value === 'string' && SHA256_ID.test(value), `${label} must be a sha256 identity`)
  return value
}

function sourceCommit(value, label) {
  invariant(typeof value === 'string' && SOURCE_COMMIT.test(value), `${label} must be a 40-character lowercase commit`)
  return value
}

function normalizeCityGateInputs(value, asOf) {
  denseArray(value, 'cityGateInputs', S11_BETA_CITY_IDS.length)
  const byCity = new Map()
  for (let index = 0; index < value.length; index += 1) {
    const input = value[index]
    // Validate the fields this composed gate reads before delegating the full
    // receipt contract to evaluateCityLaunchGate.
    exactKeys(input, ['schemaVersion', 'cityId', 'asOf', 'thresholds', 'evidence'], `cityGateInputs[${index}]`)
    invariant(S11_BETA_CITY_IDS.includes(input.cityId), `cityGateInputs[${index}].cityId is not a flagship city`)
    invariant(input.asOf === asOf, `cityGateInputs[${index}].asOf must match asOf`)
    exactKeys(input.evidence, ['artifact', 'sourceHealth', 'selection', 'sample', 'ciReceipt'], `cityGateInputs[${index}].evidence`)
    invariant(plainObject(input.evidence.artifact), `cityGateInputs[${index}].evidence.artifact must be an object`)
    exactKeys(input.evidence.artifact, [
      'schemaVersion', 'cityId', 'artifactKind', 'manifestId', 'buildId', 'artifactSha256',
      'generatedAt', 'expiresAt', 'totalRows', 'expiredRows', 'qualityComplete', 'qualityReportSha256', 'evidenceSha256',
    ], `cityGateInputs[${index}].evidence.artifact`)
    invariant(input.evidence.artifact.cityId === input.cityId, `cityGateInputs[${index}].artifact cityId must match cityId`)
    const binding = Object.freeze({
      manifestId: releaseId(input.evidence.artifact.manifestId, `cityGateInputs[${index}].artifact.manifestId`),
      buildId: releaseId(input.evidence.artifact.buildId, `cityGateInputs[${index}].artifact.buildId`),
    })
    invariant(!byCity.has(input.cityId), `cityGateInputs contains duplicate city '${input.cityId}'`)
    byCity.set(input.cityId, { input, binding })
  }
  invariant(S11_BETA_CITY_IDS.every(cityId => byCity.has(cityId)), 'cityGateInputs must contain sf-east-bay and tampa-bay exactly once')
  return Object.freeze(S11_BETA_CITY_IDS.map(cityId => Object.freeze({ cityId, ...byCity.get(cityId) })))
}

function validateObservation(observation, { asOf, expectedSiteReleaseId, expectedSourceCommit, expectedReleases }) {
  const reasons = new Set()
  try {
    invariant(plainObject(observation), 'production observation must be an object')
    exactKeys(observation, ['schema', 'schemaVersion', 'evaluatedAt', 'status', 'site', 'cities', 'deployedReleases', 'blockers', 'interpretation'], 'production observation')
    invariant(observation.schema === S11_PRODUCTION_OBSERVATION_SCHEMA, 'production observation schema is invalid')
    invariant(observation.schemaVersion === S11_PRODUCTION_OBSERVATION_SCHEMA_VERSION, 'production observation schemaVersion is invalid')
    canonicalIso(observation.evaluatedAt, 'production observation evaluatedAt')
    invariant(observation.evaluatedAt === asOf, 'production observation evaluatedAt does not match asOf')
    invariant(observation.status === 'observed', 'production observation status is not observed')
    denseArray(observation.blockers, 'production observation blockers', 0)
    exactKeys(observation.site, ['status', 'releaseId', 'sourceCommit', 'attemptsUsed', 'evidence', 'problems'], 'production observation site')
    invariant(observation.site.status === 'observed', 'production observation site is not observed')
    invariant(observation.site.releaseId === expectedSiteReleaseId, 'production observation site release does not match')
    invariant(observation.site.sourceCommit === expectedSourceCommit, 'production observation source commit does not match')
    invariant(plainObject(observation.site.evidence), 'production observation site evidence is invalid')
    denseArray(observation.site.problems, 'production observation site problems', 0)
    denseArray(observation.cities, 'production observation cities', S11_BETA_CITY_IDS.length)
    exactKeys(observation.deployedReleases, S11_BETA_CITY_IDS, 'production observation deployedReleases')
    const citySeen = new Set()
    for (const city of observation.cities) {
      exactKeys(city, ['cityId', 'baseUrl', 'status', 'release', 'attemptsUsed', 'evidence', 'problems'], 'production observation city')
      invariant(S11_BETA_CITY_IDS.includes(city.cityId) && !citySeen.has(city.cityId), 'production observation cities must contain each flagship city once')
      citySeen.add(city.cityId)
      invariant(city.status === 'observed', `production observation city ${city.cityId} is not observed`)
      exactKeys(city.release, ['manifestId', 'buildId'], `production observation city ${city.cityId} release`)
      invariant(plainObject(city.evidence), `production observation city ${city.cityId} evidence is invalid`)
      denseArray(city.problems, `production observation city ${city.cityId} problems`, 0)
      exactKeys(observation.deployedReleases[city.cityId], ['manifestId', 'buildId'], `production observation deployed release ${city.cityId}`)
      for (const key of ['manifestId', 'buildId']) {
        invariant(city.release[key] === expectedReleases[city.cityId][key], `production observation city ${city.cityId} ${key} does not match`)
        invariant(observation.deployedReleases[city.cityId][key] === expectedReleases[city.cityId][key], `production observation deployed release ${city.cityId} ${key} does not match`)
      }
    }
    // This is the only observation-derived value that may leave validation.
    // Construct it after every untrusted object has been fully checked so a
    // hostile accessor or Proxy cannot be read again on a failure path.
    return {
      reasons: [],
      binding: Object.freeze({
        evaluatedAt: asOf,
        status: 'observed',
        siteReleaseId: expectedSiteReleaseId,
        sourceCommit: expectedSourceCommit,
        deployedReleases: Object.freeze(Object.fromEntries(S11_BETA_CITY_IDS.map(cityId => [cityId, Object.freeze({
          manifestId: expectedReleases[cityId].manifestId,
          buildId: expectedReleases[cityId].buildId,
        })]))),
      }),
    }
  } catch (error) {
    const message = String(error?.message || '')
    if (message.includes('evaluatedAt')) reasons.add('PRODUCTION_OBSERVATION_EVALUATED_AT_MISMATCH')
    else if (message.includes('site release') || message.includes('source commit')) reasons.add('PRODUCTION_OBSERVATION_SITE_BINDING_MISMATCH')
    else if (message.includes('manifestId') || message.includes('buildId') || message.includes('deployed release')) reasons.add('PRODUCTION_OBSERVATION_CITY_BINDING_MISMATCH')
    else if (message.includes('blockers')) reasons.add('PRODUCTION_OBSERVATION_HAS_BLOCKERS')
    else if (message.includes('status') || message.includes('not observed')) reasons.add('PRODUCTION_OBSERVATION_NOT_OBSERVED')
    else reasons.add('PRODUCTION_OBSERVATION_SCHEMA_INVALID')
  }
  return { reasons: OBSERVATION_REASONS.filter(reason => reasons.has(reason)), binding: null }
}

function freezeReport(value) {
  return Object.freeze(value)
}

/**
 * Compose the two city gates with one exact participant-facing production
 * observation. `evidence-ready` is strictly an evidence state: it is neither
 * pilot authorization nor a go/no-go decision.
 */
async function evaluate(input, { observer, trustedObserver }) {
  inputKeys(input, { allowObserver: !trustedObserver })
  const {
    asOf,
    expectedSiteReleaseId,
    expectedSourceCommit,
    cityGateInputs,
  } = input
  canonicalIso(asOf, 'asOf')
  const siteReleaseId = releaseId(expectedSiteReleaseId, 'expectedSiteReleaseId')
  const commit = sourceCommit(expectedSourceCommit, 'expectedSourceCommit')
  invariant(typeof observer === 'function', 'observer must be a function')
  const normalizedCities = normalizeCityGateInputs(cityGateInputs, asOf)
  const cityReports = normalizedCities.map(({ input }) => freezeReport(evaluateCityLaunchGate(input)))
  const expectedReleases = Object.freeze(Object.fromEntries(normalizedCities.map(({ cityId, binding }) => [cityId, binding])))

  let observed = null
  let observedBinding = null
  let observationReasons = []
  try {
    observed = await observer({
      nowMs: Date.parse(asOf),
      expectedReleases,
      expectedSiteReleaseId: siteReleaseId,
      expectedSourceCommit: commit,
    })
    const validation = validateObservation(observed, {
      asOf,
      expectedSiteReleaseId: siteReleaseId,
      expectedSourceCommit: commit,
      expectedReleases,
    })
    observationReasons = validation.reasons
    observedBinding = validation.binding
  } catch {
    observationReasons = ['PRODUCTION_OBSERVATION_UNAVAILABLE']
  }

  const cityReasons = []
  for (const report of cityReports) {
    if (report.status === 'insufficient') cityReasons.push(`CITY_INSUFFICIENT:${report.cityId}`)
    else if (report.status === 'unratified') cityReasons.push(`CITY_UNRATIFIED:${report.cityId}`)
    else if (report.status === 'not-ready') cityReasons.push(`CITY_NOT_READY:${report.cityId}`)
  }
  const reasons = [...observationReasons, ...cityReasons]
  const cityStatus = cityReports.some(report => report.status === 'insufficient')
    ? 'insufficient'
    : cityReports.some(report => report.status === 'unratified')
      ? 'unratified'
      : cityReports.some(report => report.status === 'not-ready')
        ? 'not-ready'
        : 'evidence-ready'
  const candidateStatus = observationReasons.length > 0 ? 'insufficient' : cityStatus
  if (!trustedObserver && candidateStatus === 'evidence-ready') reasons.push(TRUSTED_OBSERVER_REASON)
  const status = !trustedObserver && candidateStatus === 'evidence-ready' ? 'insufficient' : candidateStatus

  return freezeReport({
    schema: FLAGSHIP_LAUNCH_GATE_SCHEMA,
    schemaVersion: FLAGSHIP_LAUNCH_GATE_SCHEMA_VERSION,
    gateVersion: FLAGSHIP_LAUNCH_GATE_VERSION,
    asOf,
    status,
    reasonCodes: Object.freeze(reasons),
    releaseBinding: Object.freeze({
      expectedSiteReleaseId: siteReleaseId,
      expectedSourceCommit: commit,
      expectedReleases,
      observed: observedBinding,
    }),
    cityReports: Object.freeze(cityReports),
    ...(trustedObserver ? {} : { candidateStatus }),
    interpretation: trustedObserver
      ? 'Evidence-ready means the imported trusted production observer was invoked for the exact live two-city release and both trusted-CI-produced city gates are decision-ready. It is not pilot authorization, go/no-go authorization, or a launch decision; trusted CI evidence production remains external to this gate.'
      : 'This untrusted observer harness is diagnostic only and cannot produce production evidence-ready status. It is not pilot authorization, go/no-go authorization, or a launch decision. Trusted CI evidence production and invocation of the imported trusted production observer remain mandatory.',
  })
}

/** Production entrypoint: only the imported trusted participant observer may run. */
export async function evaluateFlagshipLaunchGate(input = {}) {
  return evaluate(input, { observer: observeS11ParticipantRelease, trustedObserver: true })
}

/**
 * Test-only diagnostic harness. A caller-supplied observer is intentionally
 * untrusted and an otherwise-ready simulation is downgraded to insufficient.
 */
export async function evaluateUntrustedFlagshipLaunchGate(input = {}) {
  inputKeys(input, { allowObserver: true })
  invariant(typeof input.observer === 'function', 'input.observer must be a function')
  return evaluate(input, { observer: input.observer, trustedObserver: false })
}
