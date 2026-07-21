import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = globalThis.process?.env?.WUZUP_BUILD_DIR
  ? resolve(globalThis.process.env.WUZUP_BUILD_DIR)
  : join(ROOT, 'app', 'dist')
const MANIFEST_PATH = join(DIST, '.vite', 'manifest.json')
const KIB = 1024

const BUDGETS = Object.freeze({
  app: Object.freeze({ raw: 500 * KIB, gzip: 150 * KIB }),
  eager: Object.freeze({ raw: 720 * KIB, gzip: 215 * KIB }),
  asyncRoute: Object.freeze({ raw: 180 * KIB, gzip: 60 * KIB }),
})

const normalizeSource = (value) => String(value || '').replaceAll('\\', '/')

function readBuildManifest() {
  assert.ok(
    existsSync(MANIFEST_PATH),
    'missing app/dist/.vite/manifest.json; run `npm --prefix app run build` before this contract',
  )
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest))
  return manifest
}

function oneRecord(manifest, predicate, label) {
  const matches = Object.entries(manifest).filter(([, record]) => predicate(record))
  assert.equal(matches.length, 1, `expected one ${label}, found ${matches.length}`)
  return matches[0]
}

function staticGraph(manifest, roots) {
  const seen = new Set()
  const visit = (key) => {
    if (seen.has(key)) return
    const record = manifest[key]
    assert.ok(record, `manifest import '${key}' must resolve to a record`)
    seen.add(key)
    for (const imported of record.imports || []) visit(imported)
  }
  for (const root of roots) visit(root)
  return seen
}

function javascriptFiles(manifest, keys) {
  const files = new Map()
  for (const key of keys) {
    const file = manifest[key]?.file
    if (!file?.endsWith('.js')) continue
    const absolute = join(DIST, file)
    assert.ok(existsSync(absolute), `manifest asset '${file}' must exist`)
    files.set(file, absolute)
  }
  return files
}

function measure(files) {
  let raw = 0
  let gzip = 0
  for (const absolute of files.values()) {
    const bytes = readFileSync(absolute)
    assert.equal(bytes.length, statSync(absolute).size)
    raw += bytes.length
    gzip += gzipSync(bytes).length
  }
  return { raw, gzip }
}

function formatSize(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`
}

function assertBudget(actual, budget, label) {
  assert.ok(
    actual.raw <= budget.raw,
    `${label} raw payload is ${formatSize(actual.raw)}; budget is ${formatSize(budget.raw)}`,
  )
  assert.ok(
    actual.gzip <= budget.gzip,
    `${label} gzip payload is ${formatSize(actual.gzip)}; budget is ${formatSize(budget.gzip)}`,
  )
}

test('Sprint 10 build manifest proves bounded eager and async JavaScript payloads', () => {
  const manifest = readBuildManifest()
  const [entryKey, entry] = oneRecord(
    manifest,
    record => record.isEntry === true && record.file?.endsWith('.js'),
    'JavaScript application entry',
  )
  const [appKey, app] = oneRecord(
    manifest,
    record => normalizeSource(record.src) === 'src/App.jsx',
    'App.jsx record',
  )

  // main.jsx intentionally imports App after runtime-city validation. It is
  // still part of the first-value boot path, so count App and its complete
  // static dependency closure while excluding App's route-only imports.
  assert.ok(entry.dynamicImports?.includes(appKey), 'the manifest entry must name App as its boot import')
  const eager = staticGraph(manifest, [entryKey, appKey])
  const eagerFiles = javascriptFiles(manifest, eager)
  assertBudget(measure(new Map([[app.file, join(DIST, app.file)]])), BUDGETS.app, 'App chunk')
  assertBudget(measure(eagerFiles), BUDGETS.eager, 'eager JavaScript graph')

  const asyncRoots = app.dynamicImports || []
  assert.ok(asyncRoots.length >= 20, `expected broad route splitting; manifest has ${asyncRoots.length} App imports`)
  const failures = []
  for (const root of asyncRoots) {
    assert.ok(!eager.has(root), `route chunk '${root}' must not be in the eager graph`)
    const routeGraph = staticGraph(manifest, [root])
    const incremental = new Set([...routeGraph].filter(key => !eager.has(key)))
    const rootMeasure = measure(javascriptFiles(manifest, new Set([root])))
    const routeMeasure = measure(javascriptFiles(manifest, incremental))
    if (rootMeasure.raw > BUDGETS.asyncRoute.raw || rootMeasure.gzip > BUDGETS.asyncRoute.gzip) {
      failures.push(`${root} chunk ${formatSize(rootMeasure.raw)} raw/${formatSize(rootMeasure.gzip)} gzip`)
    }
    if (routeMeasure.raw > BUDGETS.asyncRoute.raw || routeMeasure.gzip > BUDGETS.asyncRoute.gzip) {
      failures.push(`${root} route graph ${formatSize(routeMeasure.raw)} raw/${formatSize(routeMeasure.gzip)} gzip`)
    }
  }
  assert.deepEqual(failures, [], `async route budget failures:\n${failures.join('\n')}`)
})

test('data-transfer and deck leaves stay outside the eager build graph', () => {
  const manifest = readBuildManifest()
  const [entryKey] = oneRecord(
    manifest,
    record => record.isEntry === true && record.file?.endsWith('.js'),
    'JavaScript application entry',
  )
  const [appKey, app] = oneRecord(
    manifest,
    record => normalizeSource(record.src) === 'src/App.jsx',
    'App.jsx record',
  )
  const eager = staticGraph(manifest, [entryKey, appKey])
  const dynamic = new Set(app.dynamicImports || [])
  const recordForSource = (source) => oneRecord(
    manifest,
    record => normalizeSource(record.src) === source,
    source,
  )[0]

  const dynamicKeys = new Map()
  for (const source of ['src/DataTransferRoute.jsx', 'src/LensDeck.jsx']) {
    const key = recordForSource(source)
    dynamicKeys.set(source, key)
    assert.ok(dynamic.has(key), `${source} must be an App dynamic import`)
    assert.ok(!eager.has(key), `${source} must stay outside the eager graph`)
  }

  const transferGraph = staticGraph(manifest, [dynamicKeys.get('src/DataTransferRoute.jsx')])
  const transferSource = [...javascriptFiles(manifest, transferGraph).values()]
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
  assert.match(
    transferSource,
    /wuzup-local-state/,
    'the dynamic data-transfer graph must contain the local-state transfer contract',
  )

  const calibrationRoot = [...dynamic].find(key => /CalibrationDeck/.test(manifest[key]?.name || manifest[key]?.file || ''))
  assert.ok(calibrationRoot, 'CalibrationDeck must be emitted as an App dynamic import')
  assert.ok(!eager.has(calibrationRoot), 'CalibrationDeck must stay outside the eager graph')

  // The format token is exported only by local-state-transfer.js. Its absence
  // from every eager asset guards against an accidental indirect import even
  // if Rollup later renames or coalesces the provider chunk.
  const eagerSource = [...javascriptFiles(manifest, eager).values()]
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
  assert.doesNotMatch(eagerSource, /wuzup-local-state/, 'local-state-transfer.js must not ship eagerly')
})
