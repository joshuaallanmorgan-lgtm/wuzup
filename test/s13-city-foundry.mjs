import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildCitiesTree,
  S13_FOUNDRY_CITIES,
} from '../finder/build-cities-tree.mjs'
import { verifyArtifactSet } from '../finder/artifact-manifest.mjs'
import {
  artifactLoadPlan,
  resolveLocation,
  validateCitiesIndex,
} from '../shared/cities-index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIVE_SOURCE_ROOT = path.join(ROOT, 'finder', 'output')
const SOURCE_SNAPSHOT_ROOT = mkdtempSync(path.join(tmpdir(), 'wuzup-s13-foundry-fixture-'))
const SOURCE_ROOT = path.join(SOURCE_SNAPSHOT_ROOT, 'output')
const NOW = '2026-07-22T12:00:00.000Z'

try {
  mkdirSync(SOURCE_ROOT)
  for (const city of S13_FOUNDRY_CITIES) {
    cpSync(path.join(LIVE_SOURCE_ROOT, city.cityId), path.join(SOURCE_ROOT, city.cityId), { recursive: true })
  }
} catch (error) {
  rmSync(SOURCE_SNAPSHOT_ROOT, { recursive: true, force: true })
  throw error
}

test.after(() => rmSync(SOURCE_SNAPSHOT_ROOT, { recursive: true, force: true }))

function scratch(t, label = 'wuzup-s13-foundry-') {
  const root = mkdtempSync(path.join(tmpdir(), label))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function sourceManifest(cityId) {
  return JSON.parse(readFileSync(path.join(SOURCE_ROOT, cityId, 'artifact-manifest.json'), 'utf8'))
}

function releaseRoot(destination, cityId, manifestId) {
  return path.join(destination, cityId, 'releases', manifestId.slice('sha256:'.length))
}

function cloneSources(t) {
  const root = scratch(t, 'wuzup-s13-foundry-source-')
  const output = path.join(root, 'output')
  mkdirSync(output)
  for (const city of S13_FOUNDRY_CITIES) {
    cpSync(path.join(SOURCE_ROOT, city.cityId), path.join(output, city.cityId), { recursive: true })
  }
  return output
}

test('real Tampa and SF artifacts compose into one immutable index-last tree', (t) => {
  const root = scratch(t)
  const destination = path.join(root, 'cities')
  const published = []
  const result = buildCitiesTree({
    sourceRoot: SOURCE_ROOT,
    destinationRoot: destination,
    onPublish: entry => published.push(entry),
  })

  assert.equal(validateCitiesIndex(result.index), result.index)
  assert.deepEqual(result.index.cities.map(city => city.cityId), ['tampa-bay', 'sf-east-bay'])
  assert.deepEqual(result.index.cities.map(city => city.pathAliases), [['tampa'], ['sf']])
  assert.equal(result.index.defaultCityId, 'tampa-bay')
  assert.equal(published.at(-1).phase, 'committed')
  assert.equal(published.filter(entry => entry.phase === 'index').length, 1)
  assert.equal(published.filter(entry => entry.phase === 'committed').length, 1)
  assert.ok(
    published.findIndex(entry => entry.phase === 'index') < published.findIndex(entry => entry.phase === 'committed'),
    'the verified global index must precede the one atomic destination commit',
  )
  assert.equal(result.files.length, 39, 'receipt must enumerate JSON, manifests, all 30 images, and the index')
  assert.equal(result.files.every(file => /^sha256:[a-f0-9]{64}$/.test(file.sha256)), true)
  assert.equal(
    result.files.filter(file => file.path.includes('/place-img/')).length,
    30,
    'every manifest-bound place image must appear in the composition receipt',
  )

  for (const city of S13_FOUNDRY_CITIES) {
    const source = sourceManifest(city.cityId)
    const indexed = result.index.cities.find(entry => entry.cityId === city.cityId)
    const release = releaseRoot(destination, city.cityId, source.manifestId)
    const phases = published.filter(entry => entry.cityId === city.cityId).map(entry => entry.phase)
    const manifestPosition = phases.lastIndexOf('manifest')
    assert.equal(manifestPosition, phases.length - 1, `${city.cityId} manifest must publish after every member`)
    assert.equal(phases.slice(0, manifestPosition).includes('members-complete'), true)
    assert.equal(indexed.artifactPack.manifestId, source.manifestId)
    assert.equal(indexed.artifactPack.buildId, source.buildId)
    assert.equal(indexed.artifactPack.generatedAt, source.generatedAt)
    assert.equal(indexed.artifactPack.expiresAt, source.expiresAt)
    assert.equal(indexed.artifactPack.sourceHealth, 'unknown')
    assert.equal(
      indexed.artifactPack.manifestUrl,
      `/cities/${city.cityId}/releases/${source.manifestId.slice(7)}/artifact-manifest.json`,
    )
    for (const shard of indexed.artifactPack.shards) {
      const manifestEntry = source.artifacts[shard.kind]
      assert.equal(shard.url, `/cities/${city.cityId}/releases/${source.manifestId.slice(7)}/${manifestEntry.file}`)
      assert.equal(shard.sha256, `sha256:${manifestEntry.sha256}`)
      assert.equal(shard.bytes, manifestEntry.bytes)
      assert.equal(shard.count, manifestEntry.count)
      assert.deepEqual(
        readFileSync(path.join(release, manifestEntry.file)),
        readFileSync(path.join(SOURCE_ROOT, city.cityId, manifestEntry.file)),
      )
    }
    assert.equal(existsSync(path.join(release, 'events.md')), false)
    assert.equal(existsSync(path.join(release, 'places.md')), false)
    const checked = verifyArtifactSet({
      root: release,
      expectedCityId: city.cityId,
      expectedTimeZone: city.timeZone,
    })
    assert.equal(checked.ok, true, checked.problems.join(' | '))
    assert.equal(checked.manifest.manifestId, source.manifestId)
  }

  assert.equal(readdirSync(path.join(
    releaseRoot(destination, 'tampa-bay', sourceManifest('tampa-bay').manifestId),
    'place-img',
  )).filter(name => !name.startsWith('.')).length, 30)
  assert.equal(readdirSync(path.join(
    releaseRoot(destination, 'sf-east-bay', sourceManifest('sf-east-bay').manifestId),
    'place-img',
  )).filter(name => !name.startsWith('.')).length, 0)
  assert.equal(JSON.parse(readFileSync(path.join(destination, 'index.json'), 'utf8')).indexId, result.index.indexId)
})

test('the real current index preserves unknown health and refuses both expired packs', (t) => {
  const root = scratch(t)
  const result = buildCitiesTree({ sourceRoot: SOURCE_ROOT, destinationRoot: path.join(root, 'cities') })
  for (const cityId of ['tampa-bay', 'sf-east-bay']) {
    const resolution = resolveLocation({
      index: result.index,
      query: `?city=${cityId}`,
      now: NOW,
    })
    const plan = artifactLoadPlan(result.index, resolution, { now: NOW })
    assert.equal(result.index.cities.find(city => city.cityId === cityId).artifactPack.sourceHealth, 'unknown')
    assert.equal(resolution.artifactPackStatus, 'expired')
    assert.equal(plan.canLoad, false)
    assert.deepEqual(plan.refusalReasons, ['ARTIFACT_PACK_EXPIRED'])
    assert.equal(plan.manifestUrl, null)
    assert.deepEqual(plan.shards, [])
  }
})

test('composition is deterministic and supports an injected product-root-aware public path', (t) => {
  const root = scratch(t)
  const first = buildCitiesTree({
    sourceRoot: SOURCE_ROOT,
    destinationRoot: path.join(root, 'first'),
    publicPath: '/wuzup/cities',
  })
  const second = buildCitiesTree({
    sourceRoot: SOURCE_ROOT,
    destinationRoot: path.join(root, 'second'),
    publicPath: '/wuzup/cities',
    generatedAt: first.index.generatedAt,
  })
  assert.deepEqual(second.index, first.index)
  assert.equal(second.indexSha256, first.indexSha256)
  assert.match(first.index.cities[0].artifactPack.manifestUrl, /^\/wuzup\/cities\/tampa-bay\/releases\//)
  const sf = resolveLocation({
    index: first.index,
    pathname: '/wuzup/cities/sf',
    now: '2026-07-07T13:00:00.000Z',
  })
  assert.equal(sf.cityId, 'sf-east-bay')
})

test('an interrupted staging generation emits no global index or partial destination', (t) => {
  for (const failAfter of [
    'tampa-bay:events.json',
    'tampa-bay:manifest',
    'before-index',
    'after-index',
    'before-commit',
  ]) {
    const root = scratch(t, 'wuzup-s13-foundry-interrupt-')
    const destination = path.join(root, 'cities')
    const published = []
    assert.throws(
      () => buildCitiesTree({
        sourceRoot: SOURCE_ROOT,
        destinationRoot: destination,
        failAfter,
        onPublish: entry => published.push(entry),
      }),
      /injected interruption/,
    )
    assert.equal(published.some(entry => entry.phase === 'committed'), false)
    assert.equal(existsSync(destination), false)
    assert.equal(
      readdirSync(root).some(name => name.startsWith('.cities.staging-')),
      false,
      'owned staging directories must be removed after a catchable pre-commit failure',
    )
  }
})

test('the atomic commit preserves a complete final tree after post-commit failure', (t) => {
  for (const mode of ['injected', 'callback']) {
    const root = scratch(t, 'wuzup-s13-foundry-postcommit-')
    const destination = path.join(root, `cities-${mode}`)
    assert.throws(
      () => buildCitiesTree({
        sourceRoot: SOURCE_ROOT,
        destinationRoot: destination,
        failAfter: mode === 'injected' ? 'after-commit' : null,
        onPublish: mode === 'callback'
          ? (entry) => {
              if (entry.phase === 'committed') throw new Error('injected committed callback failure')
            }
          : null,
      }),
      /injected (?:interruption after-commit|committed callback failure)/,
    )
    assert.equal(existsSync(destination), true)
    const index = JSON.parse(readFileSync(path.join(destination, 'index.json'), 'utf8'))
    assert.equal(validateCitiesIndex(index), index)
    for (const city of S13_FOUNDRY_CITIES) {
      const manifest = sourceManifest(city.cityId)
      const checked = verifyArtifactSet({
        root: releaseRoot(destination, city.cityId, manifest.manifestId),
        expectedCityId: city.cityId,
        expectedTimeZone: city.timeZone,
      })
      assert.equal(checked.ok, true, checked.problems.join(' | '))
    }
  }
})

test('a destination race or staged-byte mutation fails closed without clobbering foreign bytes', (t) => {
  const root = scratch(t, 'wuzup-s13-foundry-race-')
  const occupied = path.join(root, 'occupied')
  assert.throws(
    () => buildCitiesTree({
      sourceRoot: SOURCE_ROOT,
      destinationRoot: occupied,
      onPublish(entry) {
        if (entry.phase !== 'index') return
        mkdirSync(occupied)
        writeFileSync(path.join(occupied, 'decoy.txt'), 'foreign')
      },
    }),
    /destinationRoot appeared before commit/,
  )
  assert.equal(readFileSync(path.join(occupied, 'decoy.txt'), 'utf8'), 'foreign')

  const mutated = path.join(root, 'mutated')
  assert.throws(
    () => buildCitiesTree({
      sourceRoot: SOURCE_ROOT,
      destinationRoot: mutated,
      onPublish(entry) {
        if (entry.phase !== 'index') return
        const stagingName = readdirSync(root).find(name => name.startsWith('.mutated.staging-'))
        assert.ok(stagingName)
        const stagedIndex = path.join(root, stagingName, 'index.json')
        writeFileSync(stagedIndex, `${readFileSync(stagedIndex, 'utf8')} `)
      },
    }),
    /composition file 'index\.json' does not match its expected byte count/,
  )
  assert.equal(existsSync(mutated), false)
})

test('an exclusive publication claim serializes cooperating builders for one destination', (t) => {
  const root = scratch(t, 'wuzup-s13-foundry-claim-')
  const destination = path.join(root, 'cities')
  let nestedError = null
  let attempted = false
  const result = buildCitiesTree({
    sourceRoot: SOURCE_ROOT,
    destinationRoot: destination,
    onPublish(entry) {
      if (attempted || entry.phase !== 'member') return
      attempted = true
      try {
        buildCitiesTree({ sourceRoot: SOURCE_ROOT, destinationRoot: destination })
      } catch (error) {
        nestedError = error
      }
    },
  })
  assert.match(String(nestedError?.message), /publication claim already exists/)
  assert.equal(validateCitiesIndex(result.index), result.index)
  assert.equal(existsSync(path.join(root, '.cities.claim')), false)
})

test('a destination ancestor replaced by a junction is refused and never traversed during cleanup', (t) => {
  const root = scratch(t, 'wuzup-s13-foundry-destination-link-')
  const external = path.join(root, 'external')
  const probe = path.join(root, 'probe-link')
  mkdirSync(external)
  writeFileSync(path.join(external, 'sentinel.txt'), 'outside')
  try {
    symlinkSync(external, probe, 'junction')
    rmSync(probe, { force: true })
  } catch (error) {
    if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
      t.skip(`platform denied junction creation (${error.code})`)
      return
    }
    throw error
  }

  const destination = path.join(root, 'cities')
  let swapped = false
  assert.throws(
    () => buildCitiesTree({
      sourceRoot: SOURCE_ROOT,
      destinationRoot: destination,
      onPublish(entry) {
        if (swapped || entry.phase !== 'member' || entry.cityId !== 'tampa-bay') return
        swapped = true
        const stagingName = readdirSync(root).find(name => name.startsWith('.cities.staging-'))
        assert.ok(stagingName)
        const manifest = sourceManifest('tampa-bay')
        const release = releaseRoot(path.join(root, stagingName), 'tampa-bay', manifest.manifestId)
        rmSync(release, { recursive: true, force: true })
        symlinkSync(external, release, 'junction')
      },
    }),
    /destination directory is not a real directory/,
  )
  assert.equal(readFileSync(path.join(external, 'sentinel.txt'), 'utf8'), 'outside')
  assert.equal(existsSync(destination), false)
})

test('a destination file swapped to a foreign hard link is never overwritten', (t) => {
  const root = scratch(t, 'wuzup-s13-foundry-destination-file-')
  const external = path.join(root, 'external.txt')
  writeFileSync(external, 'outside')
  const destination = path.join(root, 'cities')
  let swapped = false
  assert.throws(
    () => buildCitiesTree({
      sourceRoot: SOURCE_ROOT,
      destinationRoot: destination,
      onPublish(entry) {
        if (swapped || entry.phase !== 'member' || entry.cityId !== 'tampa-bay') return
        swapped = true
        const stagingName = readdirSync(root).find(name => name.startsWith('.cities.staging-'))
        assert.ok(stagingName)
        const manifest = sourceManifest('tampa-bay')
        const release = releaseRoot(path.join(root, stagingName), 'tampa-bay', manifest.manifestId)
        linkSync(external, path.join(release, 'places.json'))
      },
    }),
    /places\.json destination already exists/,
  )
  assert.equal(readFileSync(external, 'utf8'), 'outside')
  assert.equal(existsSync(destination), false)
})

test('callback-added or changed members can never produce a successful incomplete receipt', (t) => {
  const root = scratch(t, 'wuzup-s13-foundry-callback-mutation-')

  const manifestMutation = path.join(root, 'manifest-mutation')
  assert.throws(
    () => buildCitiesTree({
      sourceRoot: SOURCE_ROOT,
      destinationRoot: manifestMutation,
      onPublish(entry) {
        if (entry.phase !== 'manifest' || entry.cityId !== 'tampa-bay') return
        const stagingName = readdirSync(root).find(name => name.startsWith('.manifest-mutation.staging-'))
        assert.ok(stagingName)
        const manifest = sourceManifest('tampa-bay')
        const file = path.join(releaseRoot(path.join(root, stagingName), 'tampa-bay', manifest.manifestId), 'events.json')
        writeFileSync(file, `${readFileSync(file, 'utf8')} `)
      },
    }),
    /composition file '.+events\.json' does not match its expected byte count/,
  )
  assert.equal(existsSync(manifestMutation), false)

  const unexpectedMember = path.join(root, 'unexpected-member')
  assert.throws(
    () => buildCitiesTree({
      sourceRoot: SOURCE_ROOT,
      destinationRoot: unexpectedMember,
      onPublish(entry) {
        if (entry.phase !== 'index') return
        const stagingName = readdirSync(root).find(name => name.startsWith('.unexpected-member.staging-'))
        assert.ok(stagingName)
        writeFileSync(path.join(root, stagingName, 'unexpected.txt'), 'not in the receipt')
      },
    }),
    /unexpected composition file 'unexpected\.txt'/,
  )
  assert.equal(existsSync(unexpectedMember), false)

  const committedMutation = path.join(root, 'committed-mutation')
  assert.throws(
    () => buildCitiesTree({
      sourceRoot: SOURCE_ROOT,
      destinationRoot: committedMutation,
      onPublish(entry) {
        if (entry.phase !== 'committed') return
        const manifest = sourceManifest('tampa-bay')
        const file = path.join(releaseRoot(committedMutation, 'tampa-bay', manifest.manifestId), 'events.json')
        writeFileSync(file, `${readFileSync(file, 'utf8')} `)
      },
    }),
    /composition file '.+events\.json' does not match its expected byte count/,
  )
  assert.equal(existsSync(committedMutation), true, 'post-commit failure must preserve the visible tree for diagnosis')
})

test('staged files stay single-link and bounded before artifact verification', async (t) => {
  await t.test('a callback hard-link swap is refused', (nested) => {
    const root = scratch(nested, 'wuzup-s13-foundry-hard-link-')
    const external = path.join(root, 'external-events.json')
    cpSync(path.join(SOURCE_ROOT, 'tampa-bay', 'events.json'), external)
    const destination = path.join(root, 'cities')
    assert.throws(
      () => buildCitiesTree({
        sourceRoot: SOURCE_ROOT,
        destinationRoot: destination,
        onPublish(entry) {
          if (entry.phase !== 'manifest' || entry.cityId !== 'tampa-bay') return
          const stagingName = readdirSync(root).find(name => name.startsWith('.cities.staging-'))
          assert.ok(stagingName)
          const manifest = sourceManifest('tampa-bay')
          const file = path.join(
            releaseRoot(path.join(root, stagingName), 'tampa-bay', manifest.manifestId),
            'events.json',
          )
          rmSync(file)
          linkSync(external, file)
        },
      }),
      /composition file '.+events\.json' must have exactly one link/,
    )
    assert.equal(existsSync(destination), false)
    assert.equal(readFileSync(external).equals(readFileSync(path.join(SOURCE_ROOT, 'tampa-bay', 'events.json'))), true)
  })

  await t.test('the generated index cannot be replaced by a hard link', (nested) => {
    const root = scratch(nested, 'wuzup-s13-foundry-index-link-')
    const external = path.join(root, 'external-index.json')
    const destination = path.join(root, 'cities')
    assert.throws(
      () => buildCitiesTree({
        sourceRoot: SOURCE_ROOT,
        destinationRoot: destination,
        onPublish(entry) {
          if (entry.phase !== 'index') return
          const stagingName = readdirSync(root).find(name => name.startsWith('.cities.staging-'))
          assert.ok(stagingName)
          const file = path.join(root, stagingName, 'index.json')
          cpSync(file, external)
          rmSync(file)
          linkSync(external, file)
        },
      }),
      /composition file 'index\.json' must have exactly one link/,
    )
    assert.equal(existsSync(destination), false)
    assert.equal(JSON.parse(readFileSync(external, 'utf8')).schemaVersion, 1)
  })

  await t.test('an oversized callback swap is rejected by preflight', (nested) => {
    const root = scratch(nested, 'wuzup-s13-foundry-staged-size-')
    const destination = path.join(root, 'cities')
    assert.throws(
      () => buildCitiesTree({
        sourceRoot: SOURCE_ROOT,
        destinationRoot: destination,
        onPublish(entry) {
          if (entry.phase !== 'manifest' || entry.cityId !== 'tampa-bay') return
          const stagingName = readdirSync(root).find(name => name.startsWith('.cities.staging-'))
          assert.ok(stagingName)
          const manifest = sourceManifest('tampa-bay')
          const file = path.join(
            releaseRoot(path.join(root, stagingName), 'tampa-bay', manifest.manifestId),
            'events.json',
          )
          truncateSync(file, 128 * 1024 * 1024 + 1)
        },
      }),
      /composition file '.+events\.json' exceeds its byte limit/,
    )
    assert.equal(existsSync(destination), false)
  })
})

test('the builder requires a new explicit destination and refuses unsafe topology', (t) => {
  const root = scratch(t)
  assert.throws(() => buildCitiesTree(), /sourceRoot is required/)
  assert.throws(() => buildCitiesTree({ sourceRoot: SOURCE_ROOT }), /destinationRoot is required/)

  const empty = path.join(root, 'empty')
  mkdirSync(empty)
  assert.throws(
    () => buildCitiesTree({ sourceRoot: SOURCE_ROOT, destinationRoot: empty }),
    /must not already exist/,
  )
  writeFileSync(path.join(empty, 'decoy.txt'), 'do not replace')
  assert.throws(
    () => buildCitiesTree({ sourceRoot: SOURCE_ROOT, destinationRoot: empty }),
    /must not already exist/,
  )
  assert.equal(readFileSync(path.join(empty, 'decoy.txt'), 'utf8'), 'do not replace')

  const nestedSourceDestination = path.join(SOURCE_ROOT, 'dark-candidate-must-not-exist')
  assert.equal(existsSync(nestedSourceDestination), false)
  assert.throws(
    () => buildCitiesTree({ sourceRoot: SOURCE_ROOT, destinationRoot: nestedSourceDestination }),
    /must not be inside sourceRoot/,
  )
  assert.equal(existsSync(nestedSourceDestination), false)

  for (const [index, publicPath] of [
    'cities',
    '//example/cities',
    '/cities/../escape',
    '/wuzup/%63ities',
    '/wuzup/artifacts',
  ].entries()) {
    assert.throws(
      () => buildCitiesTree({
        sourceRoot: SOURCE_ROOT,
        destinationRoot: path.join(root, `unsafe-${index}`),
        publicPath,
      }),
      /publicPath/,
    )
  }
})

test('source hash, city, temporal, and unsafe-image tampering fail before publication', async (t) => {
  await t.test('payload hash', (nested) => {
    const source = cloneSources(nested)
    writeFileSync(path.join(source, 'tampa-bay', 'events.json'), `${readFileSync(path.join(source, 'tampa-bay', 'events.json'), 'utf8')} `)
    const destination = path.join(scratch(nested), 'cities')
    assert.throws(
      () => buildCitiesTree({ sourceRoot: source, destinationRoot: destination }),
      /source artifacts are untrusted.*sha256 does not match manifest/,
    )
    assert.equal(existsSync(destination), false)
  })

  await t.test('wrong city manifest', (nested) => {
    const source = cloneSources(nested)
    cpSync(
      path.join(source, 'sf-east-bay', 'artifact-manifest.json'),
      path.join(source, 'tampa-bay', 'artifact-manifest.json'),
    )
    assert.throws(
      () => buildCitiesTree({ sourceRoot: source, destinationRoot: path.join(scratch(nested), 'cities') }),
      /source artifacts are untrusted.*does not match 'tampa-bay'/,
    )
  })

  await t.test('index predates manifest assembly', (nested) => {
    assert.throws(
      () => buildCitiesTree({
        sourceRoot: SOURCE_ROOT,
        destinationRoot: path.join(scratch(nested), 'cities'),
        generatedAt: '2026-07-01T00:00:00.000Z',
      }),
      /must not predate a city manifest assembly/,
    )
  })

  await t.test('unsafe image filename', (nested) => {
    const source = cloneSources(nested)
    writeFileSync(path.join(source, 'sf-east-bay', 'place-img', 'CON.txt'), 'unsafe')
    assert.throws(
      () => buildCitiesTree({ sourceRoot: source, destinationRoot: path.join(scratch(nested), 'cities') }),
      /place-img\/CON\.txt is unsafe/,
    )
  })

  await t.test('unsupported hidden image member', (nested) => {
    const source = cloneSources(nested)
    writeFileSync(path.join(source, 'sf-east-bay', 'place-img', '.shadow'), 'hidden')
    assert.throws(
      () => buildCitiesTree({ sourceRoot: source, destinationRoot: path.join(scratch(nested), 'cities') }),
      /place-img\/\.shadow is an unsupported hidden member/,
    )
  })

  await t.test('oversized sparse artifact', (nested) => {
    const source = cloneSources(nested)
    truncateSync(path.join(source, 'tampa-bay', 'events.json'), 128 * 1024 * 1024 + 1)
    assert.throws(
      () => buildCitiesTree({ sourceRoot: source, destinationRoot: path.join(scratch(nested), 'cities') }),
      /events\.json exceeds its byte limit/,
    )
  })

  await t.test('oversized sparse image', (nested) => {
    const source = cloneSources(nested)
    const image = path.join(source, 'sf-east-bay', 'place-img', 'oversized.jpg')
    writeFileSync(image, '')
    truncateSync(image, 16 * 1024 * 1024 + 1)
    assert.throws(
      () => buildCitiesTree({ sourceRoot: source, destinationRoot: path.join(scratch(nested), 'cities') }),
      /place-img\/oversized\.jpg exceeds its byte limit/,
    )
  })
})

test('symlinked source members are refused when the platform permits links', (t) => {
  const source = cloneSources(t)
  const cityRoot = path.join(source, 'tampa-bay')
  const target = path.join(cityRoot, 'events-target.json')
  const member = path.join(cityRoot, 'events.json')
  cpSync(member, target)
  rmSync(member)
  try {
    symlinkSync(target, member, 'file')
  } catch (error) {
    if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
      t.skip(`platform denied symlink creation (${error.code})`)
      return
    }
    throw error
  }
  assert.throws(
    () => buildCitiesTree({ sourceRoot: source, destinationRoot: path.join(scratch(t), 'cities') }),
    /events\.json must be a regular file/,
  )
})
