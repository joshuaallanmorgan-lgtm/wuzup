// One browser repository for every immutable city artifact. The manifest is
// the session trust pointer: no event or place row becomes visible until its
// exact bytes, hash, count, minimum schema, city, timezone, and manifest/build
// identities agree. Places remain lazy; retry refreshes all active kinds as one
// transaction so a deployment can never mix generations in one running app.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  ARTIFACT_SPECS,
  MANIFEST_FILE,
  artifactBuildIdentityPayload,
  artifactManifestIdentityPayload,
  artifactWarnings,
  inspectArtifactPayload,
  manifestShapeProblems,
  manifestTemporalProblems,
  stableStringify,
} from '../../shared/artifact-contract.mjs'
import { CITY } from './city.js'

const BASE = import.meta.env?.BASE_URL ?? '/'
const EXPECTED_MANIFEST_ID = import.meta.env?.VITE_ARTIFACT_MANIFEST_ID ?? null
const DEVELOPMENT_EXPIRED_PREVIEW = import.meta.env?.DEV === true
  && import.meta.env?.VITE_ALLOW_EXPIRED_ARTIFACT_PREVIEW === '1'
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const textEncoder = new TextEncoder()

class ArtifactError extends Error {
  constructor(code, message, retryable = true) {
    super(message)
    this.name = 'ArtifactError'
    this.code = code
    this.retryable = retryable
  }
}

const idleState = (kind) => ({
  kind,
  status: 'idle',
  data: null,
  meta: null,
  error: null,
})

const publicError = (error) => ({
  code: error.code,
  message: error.message,
  retryable: error.retryable !== false,
})

export function recoveryAction(error) {
  if (error?.code === 'CRYPTO_UNAVAILABLE') return 'none'
  return error?.retryable === false ? 'reload' : 'retry'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const TRANSPORT_ERROR_CODES = new Set(['NETWORK', 'TIMEOUT', 'MANIFEST_HTTP', 'PAYLOAD_HTTP'])

function normalizeError(error, isOnline) {
  if (!isOnline() && (
    !(error instanceof ArtifactError) || TRANSPORT_ERROR_CODES.has(error.code)
  )) {
    return new ArtifactError('OFFLINE', 'No network connection is available.')
  }
  if (error instanceof ArtifactError) return error
  if (error?.name === 'AbortError') return new ArtifactError('TIMEOUT', 'The data request timed out.')
  if (error instanceof TypeError) return new ArtifactError('NETWORK', 'The data request could not reach the server.')
  return new ArtifactError('UNEXPECTED', error?.message || 'The data request failed.')
}

function joinUrl(baseUrl, file) {
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${file}`
}

async function sha256Hex(bytes, cryptoImpl) {
  if (!cryptoImpl?.subtle?.digest) {
    throw new ArtifactError('CRYPTO_UNAVAILABLE', 'This browser cannot verify city data.', false)
  }
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function requestBytes({ fetchImpl, url, timeoutMs, phase }) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ArtifactError('TIMEOUT', `${phase} request timed out.`))
    }, timeoutMs)
  })
  try {
    const response = await Promise.race([
      fetchImpl(url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }),
      timeout,
    ])
    if (!response?.ok) {
      throw new ArtifactError(`${phase}_HTTP`, `${phase} request returned HTTP ${response?.status ?? 'unknown'}.`)
    }
    return new Uint8Array(await Promise.race([response.arrayBuffer(), timeout]))
  } finally {
    clearTimeout(timer)
  }
}

async function parseManifest(bytes, options) {
  let manifest
  try {
    manifest = JSON.parse(textDecoder.decode(bytes))
  } catch {
    throw new ArtifactError('MANIFEST_INVALID', 'The city manifest is not valid JSON.')
  }
  const problems = manifestShapeProblems(
    manifest,
    options.expectedCityId,
    options.expectedTimeZone
  )
  problems.push(...manifestTemporalProblems(manifest, options.now()))
  if (problems.length) {
    throw new ArtifactError('MANIFEST_INVALID', `The city manifest failed verification: ${problems.join(' · ')}`, false)
  }
  const buildId = `sha256:${await sha256Hex(
    textEncoder.encode(stableStringify(artifactBuildIdentityPayload(manifest))),
    options.cryptoImpl
  )}`
  const manifestId = `sha256:${await sha256Hex(
    textEncoder.encode(stableStringify(artifactManifestIdentityPayload(manifest))),
    options.cryptoImpl
  )}`
  if (buildId !== manifest.buildId) problems.push('manifest buildId does not match its contents')
  if (manifestId !== manifest.manifestId) problems.push('manifest manifestId does not match its contents')
  if (problems.length) {
    throw new ArtifactError('MANIFEST_INVALID', `The city manifest failed verification: ${problems.join(' · ')}`, false)
  }
  if (options.expectedManifestId && manifest.manifestId !== options.expectedManifestId) {
    throw new ArtifactError('MANIFEST_UNAPPROVED', 'The live city data is not the build-approved manifest.', false)
  }
  return manifest
}

function artifactMeta(manifest, kind, developmentExpired = false) {
  const entry = manifest.artifacts[kind]
  return {
    cityId: manifest.cityId,
    timeZone: manifest.timeZone,
    buildId: manifest.buildId,
    manifestId: manifest.manifestId,
    runId: entry.runId,
    generatedAt: entry.generatedAt,
    expiresAt: entry.expiresAt,
    maxAgeHours: entry.maxAgeHours,
    provenance: entry.provenance,
    sourceHealth: entry.sourceHealth ?? null,
    sha256: entry.sha256,
    bytes: entry.bytes,
    count: entry.count,
    warnings: artifactWarnings(entry),
    developmentExpired,
  }
}

export function createArtifactRepository({
  baseUrl = '/',
  expectedCityId,
  expectedTimeZone,
  expectedManifestId = null,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
  isOnline = () => globalThis.navigator?.onLine !== false,
  timeoutMs = 10_000,
  attempts = 2,
  retryDelayMs = 350,
  setTimeoutImpl = (callback, delay) => {
    const timer = globalThis.setTimeout(callback, delay)
    timer?.unref?.()
    return timer
  },
  clearTimeoutImpl = (timer) => globalThis.clearTimeout(timer),
  allowDevelopmentExpiredPreview = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createArtifactRepository requires fetchImpl')
  if (!expectedCityId || !expectedTimeZone) throw new TypeError('city id and timezone are required')
  const options = {
    baseUrl,
    expectedCityId,
    expectedTimeZone,
    expectedManifestId,
    fetchImpl,
    cryptoImpl,
    now,
    isOnline,
    timeoutMs,
    allowDevelopmentExpiredPreview: allowDevelopmentExpiredPreview === true,
  }
  const active = new Set()
  const listeners = new Set()
  const states = new Map(Object.keys(ARTIFACT_SPECS).map((kind) => [kind, idleState(kind)]))
  const inflight = new Map()
  let manifest = null
  let manifestInflight = null
  let refreshInflight = null
  let expiryTimer = null
  let epoch = 0

  const emit = () => listeners.forEach((listener) => listener())
  const setState = (kind, state, shouldEmit = true) => {
    states.set(kind, state)
    rescheduleExpiry()
    if (shouldEmit) emit()
  }

  function expireReadyArtifacts() {
    expiryTimer = null
    let changed = false
    for (const [kind, state] of states) {
      if (
        ['ready', 'empty'].includes(state.status)
        && state.meta?.expiresAt
        && Date.parse(state.meta.expiresAt) <= now()
      ) {
        states.set(kind, options.allowDevelopmentExpiredPreview
          ? { ...state, meta: { ...state.meta, developmentExpired: true } }
          : { ...state, status: 'stale', data: null, error: null })
        changed = true
      }
    }
    rescheduleExpiry()
    if (changed) emit()
  }

  function rescheduleExpiry() {
    if (expiryTimer != null) clearTimeoutImpl(expiryTimer)
    expiryTimer = null
    const expiries = [...states.values()]
      .filter((state) => (
        ['ready', 'empty'].includes(state.status)
        && state.meta?.expiresAt
        && !(options.allowDevelopmentExpiredPreview && state.meta.developmentExpired)
      ))
      .map((state) => Date.parse(state.meta.expiresAt))
      .filter(Number.isFinite)
    if (!expiries.length) return
    const delay = Math.min(Math.max(0, Math.min(...expiries) - now()), 2_147_483_647)
    expiryTimer = setTimeoutImpl(expireReadyArtifacts, delay)
  }
  const failureState = (kind, error, previous) => ({
    kind,
    status: error.code === 'OFFLINE' ? 'offline' : 'error',
    data: null,
    meta: previous?.meta ?? null,
    error: publicError(error),
  })
  const recheckCandidateExpiry = (candidate) => {
    if (
      ['ready', 'empty'].includes(candidate.status)
      && candidate.meta?.expiresAt
      && Date.parse(candidate.meta.expiresAt) <= now()
    ) {
      if (options.allowDevelopmentExpiredPreview) {
        return {
          ...candidate,
          meta: { ...candidate.meta, developmentExpired: true },
        }
      }
      return { ...candidate, status: 'stale', data: null, error: null }
    }
    return candidate
  }

  async function withAttempts(operation) {
    let lastError
    const total = Math.max(1, attempts)
    for (let attempt = 0; attempt < total; attempt += 1) {
      try {
        return await operation(attempt)
      } catch (error) {
        lastError = normalizeError(error, isOnline)
        if (attempt + 1 >= total || lastError.retryable === false) throw lastError
        if (retryDelayMs > 0) await sleep(retryDelayMs)
      }
    }
    throw lastError
  }

  async function fetchManifest() {
    const bytes = await requestBytes({
      fetchImpl,
      url: joinUrl(baseUrl, MANIFEST_FILE),
      timeoutMs,
      phase: 'MANIFEST',
    })
    return parseManifest(bytes, options)
  }

  function getManifest() {
    if (manifest) return Promise.resolve(manifest)
    if (manifestInflight) return manifestInflight
    const requestEpoch = epoch
    const request = fetchManifest()
      .then((next) => {
        if (requestEpoch === epoch) manifest = next
        return next
      })
      .finally(() => {
        if (manifestInflight === request) manifestInflight = null
      })
    manifestInflight = request
    return request
  }

  async function candidateFor(kind, trustedManifest) {
    const entry = trustedManifest.artifacts[kind]
    const expired = Boolean(entry.expiresAt && Date.parse(entry.expiresAt) <= now())
    const meta = artifactMeta(
      trustedManifest,
      kind,
      expired && options.allowDevelopmentExpiredPreview
    )
    if (entry.sourceHealth?.status === 'failed') {
      throw new ArtifactError('SOURCE_HEALTH_FAILED', `${kind} sources failed their last verified run.`, false)
    }
    if (expired && !options.allowDevelopmentExpiredPreview) {
      return { kind, status: 'stale', data: null, meta, error: null }
    }
    const bytes = await requestBytes({
      fetchImpl,
      url: joinUrl(baseUrl, entry.file),
      timeoutMs,
      phase: 'PAYLOAD',
    })
    if (bytes.byteLength !== entry.bytes) {
      throw new ArtifactError('PAYLOAD_BYTES_MISMATCH', `${entry.file} byte count does not match its manifest.`)
    }
    const digest = await sha256Hex(bytes, cryptoImpl)
    if (digest !== entry.sha256) {
      throw new ArtifactError('PAYLOAD_HASH_MISMATCH', `${entry.file} hash does not match its manifest.`)
    }
    let parsed
    try {
      parsed = JSON.parse(textDecoder.decode(bytes))
    } catch {
      throw new ArtifactError('PAYLOAD_INVALID_JSON', `${entry.file} is not valid JSON.`, false)
    }
    const inspected = inspectArtifactPayload(kind, parsed, entry.count)
    if (inspected.problems.length) {
      throw new ArtifactError('PAYLOAD_SCHEMA_INVALID', inspected.problems.join(' · '), false)
    }
    if (inspected.rows.length === 0) {
      return { kind, status: 'empty', data: [], meta, error: null }
    }
    return { kind, status: 'ready', data: parsed, meta, error: null }
  }

  async function load(kind) {
    if (!ARTIFACT_SPECS[kind]) throw new TypeError(`unsupported artifact kind '${kind}'`)
    active.add(kind)
    if (refreshInflight) return refreshInflight.then(() => load(kind))
    if (inflight.has(kind)) return inflight.get(kind)
    const current = states.get(kind)
    if (!['idle', 'error', 'offline'].includes(current.status)) return current
    const loadEpoch = epoch
    setState(kind, { ...current, status: 'loading', data: null, error: null })
    const operation = withAttempts(async (attempt) => {
      if (attempt > 0 && ![...states.values()].some((state) => ['ready', 'empty', 'stale'].includes(state.status))) {
        manifest = null
      }
      return candidateFor(kind, await getManifest())
    })
      .then((candidate) => {
        if (loadEpoch !== epoch) return states.get(kind)
        const committed = recheckCandidateExpiry(candidate)
        setState(kind, committed)
        return committed
      })
      .catch((error) => {
        if (loadEpoch !== epoch) return states.get(kind)
        const normalized = normalizeError(error, isOnline)
        const failed = failureState(kind, normalized, current)
        setState(kind, failed)
        return failed
      })
      .finally(() => {
        if (inflight.get(kind) === operation) inflight.delete(kind)
      })
    inflight.set(kind, operation)
    return operation
  }

  async function retry() {
    if (refreshInflight) return refreshInflight
    const kinds = [...active]
    if (!kinds.length) return []
    const previousManifest = manifest
    const previous = new Map(kinds.map((kind) => [kind, states.get(kind)]))
    epoch += 1
    manifestInflight = null
    inflight.clear()
    for (const kind of kinds) {
      setState(kind, { ...states.get(kind), status: 'loading', data: null, error: null }, false)
    }
    emit()
    refreshInflight = withAttempts(async () => {
      const nextManifest = await fetchManifest()
      const candidates = await Promise.all(kinds.map((kind) => candidateFor(kind, nextManifest)))
      return { nextManifest, candidates }
    })
      .then(({ nextManifest, candidates }) => {
        manifest = nextManifest
        const committed = candidates.map(recheckCandidateExpiry)
        for (const candidate of committed) states.set(candidate.kind, candidate)
        rescheduleExpiry()
        emit()
        return committed
      })
      .catch((error) => {
        manifest = previousManifest
        const normalized = normalizeError(error, isOnline)
        for (const kind of kinds) states.set(kind, failureState(kind, normalized, previous.get(kind)))
        rescheduleExpiry()
        emit()
        return kinds.map((kind) => states.get(kind))
      })
      .finally(() => {
        refreshInflight = null
      })
    return refreshInflight
  }

  return {
    getSnapshot(kind) {
      if (!states.has(kind)) throw new TypeError(`unsupported artifact kind '${kind}'`)
      return states.get(kind)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load,
    retry,
  }
}

export const runtimeArtifacts = createArtifactRepository({
  baseUrl: BASE,
  expectedCityId: CITY.id,
  expectedTimeZone: CITY.tz,
  expectedManifestId: EXPECTED_MANIFEST_ID,
  allowDevelopmentExpiredPreview: DEVELOPMENT_EXPIRED_PREVIEW,
})

const subscribeRuntime = (listener) => runtimeArtifacts.subscribe(listener)
export const retryArtifacts = () => runtimeArtifacts.retry()
const reloadApplication = () => globalThis.location?.reload?.()

export function useArtifact(kind, enabled = true) {
  const getSnapshot = useCallback(() => runtimeArtifacts.getSnapshot(kind), [kind])
  const state = useSyncExternalStore(subscribeRuntime, getSnapshot, getSnapshot)
  useEffect(() => {
    if (enabled) runtimeArtifacts.load(kind)
  }, [kind, enabled])
  const recovery = recoveryAction(state.error)
  return {
    ...state,
    retry: retryArtifacts,
    recover: recovery === 'reload'
      ? reloadApplication
      : recovery === 'retry'
        ? retryArtifacts
        : null,
    recoverLabel: recovery === 'reload'
      ? 'Reload Wuzup'
      : recovery === 'retry'
        ? 'Try again'
        : null,
  }
}
