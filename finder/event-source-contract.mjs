import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE_ID = /^[a-z0-9][a-z0-9-]*$/
const FALLBACK_BY_STAGE = Object.freeze({
  'live-fetch': 'live-error',
  'source-adapter': 'source-error',
  processing: 'processing-error',
})

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

export function normalizeEventSourceModules(value, label = 'event source modules') {
  invariant(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`)
  const normalized = value.map((moduleId) => {
    invariant(
      typeof moduleId === 'string' && MODULE_ID.test(moduleId),
      `${label} contains an unsafe module ID`,
    )
    return moduleId
  })
  invariant(new Set(normalized).size === normalized.length, `${label} contains a duplicate module ID`)
  return Object.freeze([...normalized].sort())
}

export function fallbackReasonForStage(stage) {
  const reason = FALLBACK_BY_STAGE[stage]
  if (!reason) throw new Error(`unknown source stage '${stage}'`)
  return reason
}

function cachedRows(cacheFile) {
  try {
    const rows = JSON.parse(readFileSync(cacheFile, 'utf8'))
    return Array.isArray(rows) ? rows : null
  } catch {
    return null
  }
}

export async function loadEventSources({
  moduleIds,
  sourceDir,
  cacheDir,
  nowMs,
  requireLive = false,
  normalizeEvent = (row) => row,
  logger = console,
  importModule = async (modulePath) => import(pathToFileURL(modulePath).href),
} = {}) {
  const activeModules = normalizeEventSourceModules(moduleIds)
  invariant(typeof sourceDir === 'string' && sourceDir, 'event sourceDir must be a non-empty string')
  invariant(typeof cacheDir === 'string' && cacheDir, 'event cacheDir must be a non-empty string')
  invariant(Number.isFinite(nowMs), 'event nowMs must be finite')
  invariant(typeof normalizeEvent === 'function', 'event normalizeEvent must be a function')

  const events = []
  const report = []
  const moduleNames = []

  for (const moduleId of activeModules) {
    const modulePath = join(sourceDir, `${moduleId}.mjs`)
    const cacheFile = join(cacheDir, `${moduleId}.json`)
    let label = moduleId
    let sourceStage = 'source-adapter'
    let adapterReady = false
    try {
      const mod = await importModule(modulePath)
      label = mod.name || moduleId
      if (typeof mod.fetchEvents !== 'function') throw new Error('module has no fetchEvents() export')
      adapterReady = true
      const raw = await mod.fetchEvents({ nowMs, force: requireLive, requireLive })
      sourceStage = 'processing'
      const mapped = (Array.isArray(raw) ? raw : [])
        .map((row) => normalizeEvent(row, label))
        .filter((event) => event && event.title && event.start)

      if (requireLive && !Array.isArray(raw)) throw new Error('source adapter returned a non-array result')
      if (requireLive && raw.length === 0) throw new Error('source adapter returned no live event rows')
      if (requireLive && mapped.length === 0) throw new Error('source adapter returned no usable event rows')

      if (!requireLive && mapped.length === 0 && existsSync(cacheFile)) {
        const cached = cachedRows(cacheFile)
        if (cached && cached.length > 0) {
          events.push(...cached)
          moduleNames.push(label)
          report.push({ source: label, found: cached.length, ok: false, cached: true, fallbackReason: 'live-empty' })
          logger.log(`  ⚠️  ${label.padEnd(26)} ${cached.length} events (cached — live returned 0, cache kept)`)
          continue
        }
      }

      events.push(...mapped)
      try {
        writeFileSync(cacheFile, JSON.stringify(mapped))
      } catch (error) {
        moduleNames.push(label)
        report.push({
          source: label,
          found: mapped.length,
          ok: false,
          status: 'degraded',
          error: `cache write failed: ${error.message || error}`,
        })
        logger.log(`  ⚠️  ${label.padEnd(26)} ${mapped.length} live events (cache write failed: ${error.message || error})`)
        continue
      }

      moduleNames.push(label)
      report.push({
        source: label,
        found: mapped.length,
        ok: true,
        ...(requireLive ? { status: 'healthy' } : {}),
      })
      logger.log(`  ✅ ${label.padEnd(26)} ${mapped.length} events`)
    } catch (error) {
      // A missing/broken configured adapter is a configuration failure. It may
      // never be hidden behind bytes from an older implementation.
      if (adapterReady && !requireLive && existsSync(cacheFile)) {
        const cached = cachedRows(cacheFile)
        if (cached) {
          events.push(...cached)
          moduleNames.push(label)
          report.push({
            source: label,
            found: cached.length,
            ok: false,
            cached: true,
            fallbackReason: fallbackReasonForStage(sourceStage),
            error: String(error.message || error),
          })
          logger.log(`  ⚠️  ${label.padEnd(26)} ${cached.length} events (cached — live failed: ${error.message || error})`)
          continue
        }
      }
      report.push({ source: label, found: 0, ok: false, error: String(error.message || error) })
      logger.warn(`  ❌ ${label.padEnd(26)} failed, no cache — skipped (${error.message || error})`)
    }
  }

  return { events, report, moduleNames }
}
