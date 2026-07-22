import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeManifest } from '../finder/artifact-manifest.mjs'
import { buildS11SiteRelease } from '../finder/build-site-release.mjs'
import {
  calculateS11SiteReleaseId,
  calculateS11SiteTreeSha256,
  createS11SiteReleaseReceipt,
  S11_SITE_RELEASE_CONTROLS,
  S11_SITE_RELEASE_EXCLUDED_PATHS,
  S11_SITE_RELEASE_FILE,
  S11_SITE_RELEASE_LIMITS,
  s11SitePathIsCanonical,
  verifyS11SiteReleaseReceipt,
} from '../shared/site-release-contract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_COMMIT = 'a'.repeat(40)
const GENERATED_AT = '2026-07-22T10:00:00.000Z'
const ASSEMBLED_AT = '2026-07-22T10:05:00.000Z'
const CITY_CONTRACTS = Object.freeze({
  'sf-east-bay': Object.freeze({ directory: 'sf', timeZone: 'America/Los_Angeles' }),
  'tampa-bay': Object.freeze({ directory: '', timeZone: 'America/New_York' }),
})

function sourceHealth(runId) {
  return {
    status: 'healthy',
    runId,
    checkedAt: GENERATED_AT,
    total: 1,
    healthy: 1,
    degraded: 0,
    failed: 0,
    unknown: 0,
    sources: [{ name: 'Fixture source', status: 'healthy', rows: 1, cached: false }],
  }
}

function writeEntries(root, entries, reverse = false) {
  const ordered = reverse ? [...entries].reverse() : entries
  for (const [relative, contents] of ordered) {
    const target = path.join(root, ...relative.split('/'))
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
}

function createCity(root, cityId, { reverse = false } = {}) {
  const imageName = `${cityId}.jpg`
  writeEntries(root, [
    ['events.json', `${JSON.stringify([{
      id: `${cityId}-event`,
      title: `${cityId} event`,
      start: '2026-07-23T18:00:00.000Z',
    }])}\n`],
    ['places.json', `${JSON.stringify({
      schemaVersion: 1,
      places: [{
        key: `${cityId}-place`,
        name: `${cityId} place`,
        image: `/place-img/${imageName}`,
      }],
    })}\n`],
    ['guides.json', `${JSON.stringify({
      schemaVersion: 1,
      guides: [{ id: `${cityId}-guide`, title: `${cityId} guide` }],
    })}\n`],
    [`place-img/${imageName}`, Buffer.from(`fixture image for ${cityId}`)],
  ], reverse)

  const eventRunId = `fixture-${cityId}-events`
  const placeRunId = `fixture-${cityId}-places`
  return writeManifest({
    root,
    cityId,
    timeZone: CITY_CONTRACTS[cityId].timeZone,
    assembledAt: ASSEMBLED_AT,
    componentReceipts: {
      events: {
        runId: eventRunId,
        generatedAt: GENERATED_AT,
        provenance: 'deterministic-test-fixture',
        sourceHealth: sourceHealth(eventRunId),
      },
      places: {
        runId: placeRunId,
        generatedAt: GENERATED_AT,
        provenance: 'deterministic-test-fixture',
        sourceHealth: sourceHealth(placeRunId),
      },
    },
  })
}

function createSite(t, { reverse = false } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-s11-site-release-'))
  const root = path.join(base, 'site')
  mkdirSync(root, { recursive: true })
  t.after(() => rmSync(base, { recursive: true, force: true }))

  writeEntries(root, [
    ['.nojekyll', ''],
    ['index.html', '<!doctype html><div id="root"></div>\n'],
    ['assets/app.js', 'export const city = "tampa-bay"\n'],
    ['assets/app.css', ':root { color-scheme: light; }\n'],
    ['manifest.webmanifest', '{"name":"Wuzup"}\n'],
    ['sf/index.html', '<!doctype html><div id="root"></div>\n'],
    ['sf/assets/app.js', 'export const city = "sf-east-bay"\n'],
    ['sf/assets/app.css', ':root { color-scheme: light; }\n'],
  ], reverse)

  const manifests = {}
  for (const cityId of Object.keys(CITY_CONTRACTS)) {
    const cityRoot = path.join(root, CITY_CONTRACTS[cityId].directory)
    manifests[cityId] = createCity(cityRoot, cityId, { reverse })
  }
  const releases = Object.fromEntries(Object.entries(manifests).map(([cityId, manifest]) => [
    cityId,
    { manifestId: manifest.manifestId, buildId: manifest.buildId },
  ]))
  return { root, manifests, releases }
}

function createBareSite(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'wuzup-s11-site-bounds-'))
  const root = path.join(base, 'site')
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, '.nojekyll'), '')
  t.after(() => rmSync(base, { recursive: true, force: true }))
  return root
}

function clone(value) {
  return structuredClone(value)
}

function expectInvalid(value, pattern, options) {
  const checked = verifyS11SiteReleaseReceipt(value, options)
  assert.equal(checked.ok, false)
  assert.equal(checked.receipt, null)
  assert.match(checked.problems.join(' | '), pattern)
}

test('site release identity is deterministic across creation order, mtimes, and an existing receipt', (t) => {
  const first = createSite(t)
  const second = createSite(t, { reverse: true })
  utimesSync(path.join(first.root, 'index.html'), new Date(1_000), new Date(2_000))
  utimesSync(path.join(second.root, 'index.html'), new Date(3_000), new Date(4_000))

  const firstReceipt = buildS11SiteRelease({ root: first.root, sourceCommit: SOURCE_COMMIT })
  const secondReceipt = buildS11SiteRelease({ root: second.root, sourceCommit: SOURCE_COMMIT })
  assert.deepEqual(secondReceipt, firstReceipt)
  assert.equal(firstReceipt.releaseId, calculateS11SiteReleaseId(firstReceipt))
  assert.equal(firstReceipt.treeSha256, calculateS11SiteTreeSha256(firstReceipt.files))
  assert.deepEqual(firstReceipt.controls, S11_SITE_RELEASE_CONTROLS)
  assert.deepEqual(firstReceipt.excludedPaths, S11_SITE_RELEASE_EXCLUDED_PATHS)
  assert.equal(firstReceipt.files.some(({ path: filePath }) => filePath === '.nojekyll'), false)
  assert.equal(firstReceipt.files.some(({ path: filePath }) => filePath === S11_SITE_RELEASE_FILE), false)
  assert.equal(Object.isFrozen(firstReceipt), true)
  assert.equal(Object.isFrozen(firstReceipt.files), true)

  writeFileSync(path.join(first.root, S11_SITE_RELEASE_FILE), '{"decoy":true}\n')
  const rebuilt = buildS11SiteRelease({ root: first.root, sourceCommit: SOURCE_COMMIT })
  assert.deepEqual(rebuilt, firstReceipt)
  assert.deepEqual(JSON.parse(readFileSync(path.join(first.root, S11_SITE_RELEASE_FILE), 'utf8')), firstReceipt)
})

test('participant-facing file additions and byte changes produce new site identities', (t) => {
  const fixture = createSite(t)
  const original = buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT })

  writeFileSync(path.join(fixture.root, 'assets', 'new-runtime.js'), 'export const added = true\n')
  const added = buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT })
  assert.notEqual(added.treeSha256, original.treeSha256)
  assert.notEqual(added.releaseId, original.releaseId)
  assert.equal(added.fileCount, original.fileCount + 1)

  writeFileSync(path.join(fixture.root, 'assets', 'app.css'), ':root { color-scheme: dark; }\n')
  const changed = buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT })
  assert.notEqual(changed.treeSha256, added.treeSha256)
  assert.notEqual(changed.releaseId, added.releaseId)
  assert.equal(changed.fileCount, added.fileCount)
})

test('strict receipt verification rejects structural, aggregate, identity, and binding tampering', (t) => {
  const fixture = createSite(t)
  const receipt = buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT })
  const valid = verifyS11SiteReleaseReceipt(receipt, {
    expectedReleaseId: receipt.releaseId,
    expectedReleases: fixture.releases,
    expectedSourceCommit: SOURCE_COMMIT,
  })
  assert.equal(valid.ok, true)
  assert.deepEqual(valid.problems, [])
  assert.equal(Object.isFrozen(valid.receipt), true)

  const mutations = [
    ['extra key', (value) => { value.extra = true }, /must contain exactly/],
    ['omitted key', (value) => { delete value.totalBytes }, /must contain exactly/],
    ['file order', (value) => { value.files.reverse() }, /strictly path-sorted/],
    ['file count', (value) => { value.fileCount += 1 }, /fileCount does not match/],
    ['total bytes', (value) => { value.totalBytes += 1 }, /totalBytes does not match/],
    ['tree digest', (value) => { value.treeSha256 = 'b'.repeat(64) }, /treeSha256 does not match/],
    ['release identity', (value) => { value.releaseId = `sha256:${'b'.repeat(64)}` }, /releaseId does not match/],
    ['source commit', (value) => { value.sourceCommit = 'INVALID' }, /sourceCommit is invalid/],
    ['city base path', (value) => { value.cities['sf-east-bay'].basePath = 'bay/' }, /basePath is invalid/],
    ['control value', (value) => { value.controls.noJekyll = false }, /noJekyll must be true/],
    ['control key', (value) => { value.controls.other = true }, /must contain exactly/],
    ['excluded paths', (value) => { value.excludedPaths.reverse() }, /excludedPaths are invalid/],
    ['file digest', (value) => { value.files[0].sha256 = 'c'.repeat(64) }, /treeSha256 does not match/],
    ['extra file', (value) => {
      value.files.push({ path: 'zz-extra.js', bytes: 0, sha256: 'd'.repeat(64) })
    }, /fileCount does not match/],
    ['omitted file', (value) => { value.files.pop() }, /fileCount does not match/],
  ]
  for (const [label, mutate, problem] of mutations) {
    const value = clone(receipt)
    mutate(value)
    expectInvalid(value, problem, undefined, label)
  }

  expectInvalid(receipt, /expected releaseId/, {
    expectedReleaseId: `sha256:${'e'.repeat(64)}`,
  })
  expectInvalid(receipt, /expected source commit/, {
    expectedSourceCommit: 'f'.repeat(40),
  })
  const wrongReleases = clone(fixture.releases)
  wrongReleases['tampa-bay'].buildId = `sha256:${'e'.repeat(64)}`
  expectInvalid(receipt, /expected tampa-bay identity/, { expectedReleases: wrongReleases })
})

test('canonical paths reject traversal, excluded controls, platform aliases, dot directories, and case collisions', (t) => {
  const fixture = createSite(t)
  const files = [{ path: 'index.html', bytes: 0, sha256: '0'.repeat(64) }]
  assert.equal(s11SitePathIsCanonical('assets/app.js'), true)
  for (const unsafe of [
    '../escape.js',
    '/absolute.js',
    'assets\\app.js',
    'assets/',
    '.vite/manifest.json',
    'assets/../escape.js',
    'CON.txt',
    '.nojekyll',
    '.NOJEKYLL',
    S11_SITE_RELEASE_FILE,
    'Site-Release.json',
    'site-release.json/child.js',
    'Site-Release.json/child.js',
    'a'.repeat(513),
  ]) {
    assert.equal(s11SitePathIsCanonical(unsafe), false, unsafe)
    assert.throws(() => createS11SiteReleaseReceipt({
      sourceCommit: SOURCE_COMMIT,
      releases: fixture.releases,
      files: [{ ...files[0], path: unsafe }],
    }), /unsafe|excluded|too long/)
  }

  assert.throws(() => createS11SiteReleaseReceipt({
    sourceCommit: SOURCE_COMMIT,
    releases: fixture.releases,
    files: [
      { path: 'Assets/app.js', bytes: 0, sha256: '0'.repeat(64) },
      { path: 'assets/app.js', bytes: 0, sha256: '1'.repeat(64) },
    ],
  }), /path collision/)

  assert.throws(() => createS11SiteReleaseReceipt({
    sourceCommit: SOURCE_COMMIT,
    releases: fixture.releases,
    files: [
      { path: 'Assets/a.js', bytes: 0, sha256: '0'.repeat(64) },
      { path: 'assets/b.js', bytes: 0, sha256: '1'.repeat(64) },
    ],
  }), /path collision/)

  assert.throws(() => createS11SiteReleaseReceipt({
    sourceCommit: SOURCE_COMMIT,
    releases: fixture.releases,
    files: [
      { path: 'assets', bytes: 0, sha256: '0'.repeat(64) },
      { path: 'assets/app.js', bytes: 0, sha256: '1'.repeat(64) },
    ],
  }), /file\/directory topology conflict/)

  assert.throws(() => createS11SiteReleaseReceipt({
    sourceCommit: SOURCE_COMMIT,
    releases: fixture.releases,
    files: [{
      path: 'oversized.bin',
      bytes: S11_SITE_RELEASE_LIMITS.fileBytes + 1,
      sha256: '0'.repeat(64),
    }],
  }), /bytes is out of range/)

  assert.throws(() => createS11SiteReleaseReceipt({
    sourceCommit: SOURCE_COMMIT,
    releases: fixture.releases,
    files: Array.from({ length: 9 }, (_, index) => ({
      path: `payload-${index}.bin`,
      bytes: S11_SITE_RELEASE_LIMITS.fileBytes,
      sha256: String(index).repeat(64),
    })),
  }), /total bytes exceed the limit/)
})

test('builder refuses dot-prefixed build metadata instead of silently omitting it', (t) => {
  const fixture = createSite(t)
  mkdirSync(path.join(fixture.root, '.vite'))
  writeFileSync(path.join(fixture.root, '.vite', 'manifest.json'), '{}\n')
  assert.throws(
    () => buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT }),
    /site tree path is unsafe at '\.vite'/,
  )
})

test('builder reserves its excluded root controls case-insensitively', (t) => {
  const fixture = createSite(t)
  writeFileSync(path.join(fixture.root, 'Site-Release.json'), 'decoy\n')
  assert.throws(
    () => buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT }),
    /site tree path is unsafe at 'Site-Release\.json'/,
  )
})

test('builder rejects case-aliased empty directory prefixes when the platform can represent them', (t) => {
  const fixture = createSite(t)
  const upper = path.join(fixture.root, 'EmptyAlias')
  const lower = path.join(fixture.root, 'emptyalias')
  mkdirSync(upper)
  try {
    mkdirSync(lower)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      t.skip('platform filesystem is case-insensitive')
      return
    }
    throw error
  }
  assert.throws(
    () => buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT }),
    /site tree path collision/,
  )
})

test('builder preflights cumulative sparse bytes before reading any participant file', (t) => {
  const root = createBareSite(t)
  const fileCount = Math.floor(S11_SITE_RELEASE_LIMITS.totalBytes / S11_SITE_RELEASE_LIMITS.fileBytes) + 1
  for (let index = 0; index < fileCount; index += 1) {
    const target = path.join(root, `sparse-${String(index).padStart(2, '0')}.bin`)
    writeFileSync(target, '')
    truncateSync(target, S11_SITE_RELEASE_LIMITS.fileBytes)
  }
  assert.throws(
    () => buildS11SiteRelease({ root, sourceCommit: SOURCE_COMMIT }),
    /site tree total bytes exceed the limit/,
  )
})

test('builder bounds directory and total-entry fanout during streaming enumeration', async (t) => {
  await t.test('directory budget', (nested) => {
    const root = createBareSite(nested)
    for (let index = 0; index <= S11_SITE_RELEASE_LIMITS.directories; index += 1) {
      mkdirSync(path.join(root, `directory-${String(index).padStart(5, '0')}`))
    }
    assert.throws(
      () => buildS11SiteRelease({ root, sourceCommit: SOURCE_COMMIT }),
      /site tree has too many directories/,
    )
  })

  await t.test('entry budget', (nested) => {
    const root = createBareSite(nested)
    for (let index = 0; index < S11_SITE_RELEASE_LIMITS.entries; index += 1) {
      writeFileSync(path.join(root, `entry-${String(index).padStart(5, '0')}.bin`), '')
    }
    assert.throws(
      () => buildS11SiteRelease({ root, sourceCommit: SOURCE_COMMIT }),
      /site tree has too many entries/,
    )
  })
})

test('builder requires a zero-byte regular .nojekyll control', async (t) => {
  await t.test('missing', (nested) => {
    const fixture = createSite(nested)
    rmSync(path.join(fixture.root, '.nojekyll'))
    assert.throws(
      () => buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT }),
      /ENOENT|nojekyll/i,
    )
  })

  await t.test('nonzero', (nested) => {
    const fixture = createSite(nested)
    writeFileSync(path.join(fixture.root, '.nojekyll'), 'not empty')
    assert.throws(
      () => buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT }),
      /must be zero bytes/,
    )
  })

  await t.test('not a file', (nested) => {
    const fixture = createSite(nested)
    rmSync(path.join(fixture.root, '.nojekyll'))
    mkdirSync(path.join(fixture.root, '.nojekyll'))
    assert.throws(
      () => buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT }),
      /must be a regular file/,
    )
  })
})

test('builder rejects symlinked tree members when the platform permits creating them', (t) => {
  const fixture = createSite(t)
  const target = path.join(fixture.root, 'assets', 'link-target.js')
  const link = path.join(fixture.root, 'assets', 'alias.js')
  writeFileSync(target, 'export const target = true\n')
  try {
    symlinkSync(target, link, 'file')
  } catch (error) {
    if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
      t.skip(`platform denied symlink creation (${error.code})`)
      return
    }
    throw error
  }
  assert.throws(
    () => buildS11SiteRelease({ root: fixture.root, sourceCommit: SOURCE_COMMIT }),
    /contains a symlink or junction/,
  )
})

test('builder CLI writes the exact receipt and emits only its release output', (t) => {
  const fixture = createSite(t)
  const command = spawnSync(
    process.execPath,
    [path.join(ROOT, 'finder', 'build-site-release.mjs'), fixture.root, SOURCE_COMMIT],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(command.status, 0, command.stderr)
  assert.match(command.stdout, /^release_id=sha256:[a-f0-9]{64}\r?\n$/)
  assert.equal(command.stderr, '')

  const receipt = JSON.parse(readFileSync(path.join(fixture.root, S11_SITE_RELEASE_FILE), 'utf8'))
  assert.equal(command.stdout.trim(), `release_id=${receipt.releaseId}`)
  assert.equal(verifyS11SiteReleaseReceipt(receipt, {
    expectedReleaseId: receipt.releaseId,
    expectedReleases: fixture.releases,
    expectedSourceCommit: SOURCE_COMMIT,
  }).ok, true)

  const missingRoot = spawnSync(
    process.execPath,
    [path.join(ROOT, 'finder', 'build-site-release.mjs')],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(missingRoot.status, 1)
  assert.match(missingRoot.stderr, /site release root is required/)
})
