import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyArtifactSet } from '../finder/artifact-manifest.mjs'
import {
  BETA_RESEARCH_SCHEMA,
  BETA_RESEARCH_SCHEMA_VERSION,
  S11_BETA_CITY_IDS,
} from './beta-research.mjs'

export const S11_BETA_RELEASE_KIT_SCHEMA = 'wuzup-beta-release-research-kit'
export const S11_BETA_RELEASE_KIT_SCHEMA_VERSION = 2

const SHA256_ID = /^sha256:[a-f0-9]{64}$/
const CITY_CONTRACTS = Object.freeze({
  'sf-east-bay': Object.freeze({ timeZone: 'America/Los_Angeles' }),
  'tampa-bay': Object.freeze({ timeZone: 'America/New_York' }),
})
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const S11_CHECKED_ARTIFACT_ROOTS = Object.freeze({
  'sf-east-bay': path.join(REPO_ROOT, 'finder', 'output', 'sf-east-bay'),
  'tampa-bay': path.join(REPO_ROOT, 'finder', 'output', 'tampa-bay'),
})

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected, label) {
  invariant(plainObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  invariant(
    actual.length === canonical.length && actual.every((key, index) => key === canonical[index]),
    `${label} must contain exactly: ${canonical.join(', ')}`,
  )
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function normalizeNowMs(nowMs) {
  invariant(Number.isSafeInteger(nowMs) && nowMs >= 0, 'S11 beta release readiness requires an explicit nowMs')
  return nowMs
}

function normalizeArtifactRoots(value) {
  exactKeys(value, S11_BETA_CITY_IDS, 'S11 beta artifact roots')
  return Object.fromEntries(S11_BETA_CITY_IDS.map((cityId) => {
    invariant(
      typeof value[cityId] === 'string' && value[cityId].trim().length > 0,
      `S11 beta artifact root for ${cityId} must be a non-empty path`,
    )
    return [cityId, path.resolve(value[cityId])]
  }))
}

function normalizeDeployedReleases(value) {
  if (value === null || value === undefined) return null
  exactKeys(value, S11_BETA_CITY_IDS, 'S11 beta deployed releases')
  const normalized = {}
  for (const cityId of S11_BETA_CITY_IDS) {
    exactKeys(value[cityId], ['manifestId', 'buildId'], `S11 beta deployed release for ${cityId}`)
    for (const field of ['manifestId', 'buildId']) {
      invariant(
        typeof value[cityId][field] === 'string' && SHA256_ID.test(value[cityId][field]),
        `S11 beta deployed release ${cityId}.${field} is invalid`,
      )
    }
    normalized[cityId] = {
      manifestId: value[cityId].manifestId,
      buildId: value[cityId].buildId,
    }
  }
  return normalized
}

function normalizeDeployedSiteReleaseId(value) {
  if (value === null || value === undefined) return null
  invariant(
    typeof value === 'string' && SHA256_ID.test(value),
    'S11 beta deployed site release ID is invalid',
  )
  return value
}

function releaseIdentity(manifest) {
  return manifest
    ? { manifestId: manifest.manifestId, buildId: manifest.buildId }
    : null
}

function identityProblems(actual, deployed, cityId) {
  if (!deployed || !actual) return []
  const problems = []
  if (actual.manifestId !== deployed.manifestId) {
    problems.push(`deployed manifestId does not match verified bytes for ${cityId}`)
  }
  if (actual.buildId !== deployed.buildId) {
    problems.push(`deployed buildId does not match verified bytes for ${cityId}`)
  }
  return problems
}

function policyOnlyProblem(problem) {
  return problem === 'events artifact is past its manifest max age'
    || problem === 'places artifact is past its manifest max age'
    || problem === 'events source health is not fully verified and healthy'
    || problem === 'places source health is not fully verified and healthy'
}

function emptySessionTemplate(cityId, release, siteReleaseId) {
  return {
    schema: BETA_RESEARCH_SCHEMA,
    schemaVersion: BETA_RESEARCH_SCHEMA_VERSION,
    sessionReceiptId: null,
    siteReleaseId,
    cityId,
    manifestId: release.manifestId,
    buildId: release.buildId,
    durationMs: null,
    milestones: {
      credibleOptionMs: null,
      firstRetainedValueMs: null,
    },
    sourceLinkOutcome: null,
    counts: {
      emptySearches: null,
      duplicateExposures: null,
      corrections: null,
    },
    returningUse: null,
    corePromise: null,
  }
}

function researchKit(nowMs, releases, siteReleaseId) {
  const expectedReleases = Object.fromEntries(S11_BETA_CITY_IDS.map((cityId) => [
    cityId,
    {
      manifestId: releases[cityId].manifestId,
      buildId: releases[cityId].buildId,
    },
  ]))
  return {
    schema: S11_BETA_RELEASE_KIT_SCHEMA,
    schemaVersion: S11_BETA_RELEASE_KIT_SCHEMA_VERSION,
    evaluatedAt: new Date(nowMs).toISOString(),
    releaseBindings: {
      siteReleaseId,
      cityReleases: expectedReleases,
    },
    reviewConfigTemplate: {
      requiredCityIds: [...S11_BETA_CITY_IDS],
      minimumSessionsPerCity: null,
      expectedSiteReleaseId: siteReleaseId,
      expectedReleases,
    },
    sessionTemplates: S11_BETA_CITY_IDS.map((cityId) => (
      emptySessionTemplate(cityId, releases[cityId], siteReleaseId)
    )),
    interpretation: 'Technical release readiness is not a beta pass or fail decision.',
  }
}

/**
 * Verify both checked artifact sets at one caller-supplied instant and prepare
 * research inputs only when every byte, freshness, source-health, and optional
 * expected-release binding is valid. This function never writes or performs
 * network access, and it deliberately supplies no research outcome threshold.
 */
export function prepareS11BetaReleaseKit({
  nowMs,
  artifactRoots = S11_CHECKED_ARTIFACT_ROOTS,
  deployedReleases = null,
  deployedSiteReleaseId = null,
} = {}) {
  const evaluatedMs = normalizeNowMs(nowMs)
  const roots = normalizeArtifactRoots(artifactRoots)
  // This read-only module cannot observe production. A caller must supply the
  // exact manifest/build identities independently read from the participant-
  // facing deployment; local finder output alone never authorizes sessions.
  const deployed = normalizeDeployedReleases(deployedReleases)
  const siteReleaseId = normalizeDeployedSiteReleaseId(deployedSiteReleaseId)
  const deploymentBound = deployed !== null && siteReleaseId !== null
  const releases = {}

  const cities = S11_BETA_CITY_IDS.map((cityId) => {
    const { timeZone } = CITY_CONTRACTS[cityId]
    // One strict verification is the release snapshot. A second read here can
    // cross an atomic manifest publication and accidentally bind set A while
    // certifying set B. Recognized freshness/health failures remain separately
    // reportable, but every identity comes from this exact verified read.
    const strict = verifyArtifactSet({
      root: roots[cityId],
      expectedCityId: cityId,
      expectedTimeZone: timeZone,
      now: evaluatedMs,
      requireFresh: true,
      requireVerifiedSources: true,
    })
    const integrityProblems = strict.problems.filter((problem) => !policyOnlyProblem(problem))
    const integrityVerified = strict.manifest !== null && integrityProblems.length === 0
    const observedRelease = integrityVerified ? releaseIdentity(strict.manifest) : null
    const problems = [
      ...strict.problems,
      ...identityProblems(observedRelease, deployed?.[cityId], cityId),
    ]
    const artifactReady = problems.length === 0
    if (artifactReady && deploymentBound) releases[cityId] = observedRelease
    return {
      cityId,
      timeZone,
      status: artifactReady ? (deploymentBound ? 'release-ready' : 'artifact-ready') : 'blocked',
      artifactIntegrity: integrityVerified ? 'verified' : 'untrusted',
      observedRelease,
      problems,
    }
  })

  const blocked = cities.filter((city) => city.status === 'blocked')
  const kit = blocked.length === 0 && deploymentBound
    ? researchKit(evaluatedMs, releases, siteReleaseId)
    : null
  return deepFreeze({
    schema: 'wuzup-beta-release-readiness',
    schemaVersion: S11_BETA_RELEASE_KIT_SCHEMA_VERSION,
    evaluatedAt: new Date(evaluatedMs).toISOString(),
    status: kit ? 'release-ready' : 'blocked',
    cities,
    kit,
    blockers: [
      ...blocked.map((city) => `CITY_NOT_RELEASE_READY:${city.cityId}`),
      ...(deployed === null ? ['DEPLOYED_RELEASE_BINDING_REQUIRED'] : []),
      ...(siteReleaseId === null ? ['DEPLOYED_SITE_RELEASE_BINDING_REQUIRED'] : []),
    ],
    interpretation: 'Release-ready means local artifact bytes match caller-supplied deployed identities and technical gates; it is not a beta pass or fail decision.',
  })
}
