// Final production-byte proof: the generated city set, Vite's copied public
// bytes, and the manifest identity embedded in browser JavaScript must all
// name the same immutable manifest before a build can be published.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cityId, tz as CITY_TZ } from './cities/index.mjs'
import { verifyArtifactSet } from './artifact-manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

function javascriptFiles(root) {
  if (!existsSync(root)) return []
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...javascriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

export function verifyAppBuild({
  sourceRoot,
  builtRoot,
  expectedCityId,
  expectedTimeZone,
} = {}) {
  const problems = []
  const source = verifyArtifactSet({
    root: sourceRoot,
    expectedCityId,
    expectedTimeZone,
  })
  const built = verifyArtifactSet({
    root: builtRoot,
    expectedCityId,
    expectedTimeZone,
  })
  problems.push(...source.problems.map((problem) => `source: ${problem}`))
  problems.push(...built.problems.map((problem) => `build: ${problem}`))

  const sourceId = source.manifest?.manifestId
  const builtId = built.manifest?.manifestId
  if (sourceId && builtId && sourceId !== builtId) {
    problems.push(`built manifestId '${builtId}' does not match source '${sourceId}'`)
  }
  if (sourceId) {
    const scripts = javascriptFiles(join(builtRoot, 'assets'))
    if (!scripts.length) problems.push('build has no JavaScript assets to prove the approved manifest identity')
    else if (!scripts.some((path) => readFileSync(path, 'utf8').includes(sourceId))) {
      problems.push(`browser JavaScript does not embed approved manifestId '${sourceId}'`)
    }
  }
  return { ok: problems.length === 0, problems, source: source.manifest, built: built.manifest }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const builtRoot = resolve(process.argv[2] || join(ROOT, 'app', 'dist'))
  const sourceRoot = resolve(process.env.WUZUP_ARTIFACT_SOURCE || join(HERE, 'output', cityId))
  const result = verifyAppBuild({
    sourceRoot,
    builtRoot,
    expectedCityId: cityId,
    expectedTimeZone: CITY_TZ,
  })
  if (!result.ok) {
    console.error(`verify-app-build: REFUSING '${cityId}' — ${result.problems.join(' · ')}`)
    process.exit(1)
  }
  console.log(`verify-app-build: '${cityId}' approved ${result.built.manifestId}`)
}
