import {
  lstatSync,
  opendirSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  atomicWriteFileSync,
  sha256,
  verifyArtifactSet,
} from './artifact-manifest.mjs'
import {
  createS11SiteReleaseReceipt,
  S11_SITE_RELEASE_EXCLUDED_PATHS,
  S11_SITE_RELEASE_FILE,
  S11_SITE_RELEASE_LIMITS,
  s11SitePathIsCanonical,
} from '../shared/site-release-contract.mjs'

const CITY_CONTRACTS = Object.freeze({
  'sf-east-bay': Object.freeze({ path: 'sf', timeZone: 'America/Los_Angeles' }),
  'tampa-bay': Object.freeze({ path: '', timeZone: 'America/New_York' }),
})

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function inspectRoot(root) {
  const resolved = path.resolve(root)
  const rootInfo = lstatSync(resolved)
  invariant(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'site root must be a real directory')
  const realRoot = realpathSync(resolved)
  invariant(path.resolve(realRoot) === resolved, 'site root must not traverse a symlink or junction')
  return { resolved, realRoot }
}

function sameFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

function registerTreePath({ relative, directory, canonicalSpellings, directoryPaths, filePaths }) {
  const segments = relative.split('/')
  let prefix = ''
  for (let length = 1; length <= segments.length; length += 1) {
    prefix = prefix ? `${prefix}/${segments[length - 1]}` : segments[length - 1]
    const collisionKey = prefix.toLowerCase()
    const priorSpelling = canonicalSpellings.get(collisionKey)
    invariant(
      priorSpelling === undefined || priorSpelling === prefix,
      `site tree path collision at '${prefix}'`,
    )
    canonicalSpellings.set(collisionKey, prefix)
    if (length < segments.length || directory) {
      invariant(!filePaths.has(collisionKey), `site tree file/directory topology conflict at '${prefix}'`)
      directoryPaths.add(collisionKey)
    } else {
      invariant(!directoryPaths.has(collisionKey), `site tree file/directory topology conflict at '${prefix}'`)
      invariant(!filePaths.has(collisionKey), `site tree path collision at '${prefix}'`)
      filePaths.add(collisionKey)
    }
  }
}

function walkSiteFiles(root) {
  const { resolved, realRoot } = inspectRoot(root)
  const candidates = []
  const canonicalSpellings = new Map()
  const directoryPaths = new Set()
  const filePaths = new Set()
  let directoryCount = 0
  // Reserve one root entry for the receipt before enumeration so first-time
  // sealing and rebuilding an existing receipt have the same boundary.
  let entryCount = 1
  let fileCount = 0
  let totalBytes = 0
  const visit = (directory) => {
    const handle = opendirSync(directory)
    try {
      while (true) {
        const entry = handle.readSync()
        if (entry === null) break
        const absolute = path.join(directory, entry.name)
        const relative = path.relative(resolved, absolute).split(path.sep).join('/')
        if (relative !== S11_SITE_RELEASE_FILE) {
          entryCount += 1
          invariant(entryCount <= S11_SITE_RELEASE_LIMITS.entries, 'site tree has too many entries')
        }
        invariant(!entry.isSymbolicLink(), `site tree contains a symlink or junction at '${relative}'`)
        const info = lstatSync(absolute)
        invariant(!info.isSymbolicLink(), `site tree contains a symlink or junction at '${relative}'`)
        if (S11_SITE_RELEASE_EXCLUDED_PATHS.includes(relative)) {
          invariant(info.isFile(), `excluded site control is not a regular file at '${relative}'`)
          continue
        }
        const real = realpathSync(absolute)
        invariant(insideRoot(realRoot, real), `site tree member escapes the root at '${relative}'`)
        invariant(s11SitePathIsCanonical(relative), `site tree path is unsafe at '${relative}'`)
        const directoryEntry = info.isDirectory()
        registerTreePath({
          relative,
          directory: directoryEntry,
          canonicalSpellings,
          directoryPaths,
          filePaths,
        })
        if (directoryEntry) {
          directoryCount += 1
          invariant(directoryCount <= S11_SITE_RELEASE_LIMITS.directories, 'site tree has too many directories')
          visit(absolute)
          continue
        }
        invariant(info.isFile(), `site tree member is not a regular file at '${relative}'`)
        invariant(Number.isSafeInteger(info.size) && info.size >= 0, `site tree file size is invalid at '${relative}'`)
        invariant(info.size <= S11_SITE_RELEASE_LIMITS.fileBytes, `site tree file is too large at '${relative}'`)
        fileCount += 1
        invariant(fileCount <= S11_SITE_RELEASE_LIMITS.files, 'site tree has too many files')
        totalBytes += info.size
        invariant(totalBytes <= S11_SITE_RELEASE_LIMITS.totalBytes, 'site tree total bytes exceed the limit')
        candidates.push({ absolute, relative, info })
      }
    } finally {
      handle.closeSync()
    }
  }
  visit(resolved)
  candidates.sort((left, right) => compareText(left.relative, right.relative))
  return candidates.map(({ absolute, relative, info }) => {
    const beforeRead = lstatSync(absolute)
    invariant(
      beforeRead.isFile() && !beforeRead.isSymbolicLink() && sameFile(info, beforeRead),
      `site tree file changed before reading at '${relative}'`,
    )
    const real = realpathSync(absolute)
    invariant(insideRoot(realRoot, real), `site tree member escapes the root at '${relative}'`)
    const bytes = readFileSync(absolute)
    const afterRead = lstatSync(absolute)
    invariant(
      bytes.length === beforeRead.size && sameFile(beforeRead, afterRead),
      `site tree file changed while reading at '${relative}'`,
    )
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }
  })
}

function verifyNoJekyllControl(root) {
  const controlPath = path.join(root, '.nojekyll')
  const info = lstatSync(controlPath)
  invariant(info.isFile() && !info.isSymbolicLink(), 'site .nojekyll control must be a regular file')
  invariant(info.size === 0, 'site .nojekyll control must be zero bytes')
}

function readCityReleases(root) {
  const releases = {}
  for (const cityId of Object.keys(CITY_CONTRACTS).sort()) {
    const contract = CITY_CONTRACTS[cityId]
    const cityRoot = path.join(root, contract.path)
    const checked = verifyArtifactSet({
      root: cityRoot,
      expectedCityId: cityId,
      expectedTimeZone: contract.timeZone,
    })
    invariant(checked.ok && checked.manifest, `${cityId} site artifacts are untrusted: ${checked.problems.join(' | ')}`)
    invariant(checked.manifest.shards.length === 0, `${cityId} site manifest contains unsupported shards`)
    releases[cityId] = {
      manifestId: checked.manifest.manifestId,
      buildId: checked.manifest.buildId,
    }
  }
  return releases
}

export function buildS11SiteRelease({ root, sourceCommit }) {
  invariant(typeof root === 'string' && root.length > 0, 'site release root is required')
  const resolved = path.resolve(root)
  inspectRoot(resolved)
  verifyNoJekyllControl(resolved)
  const files = walkSiteFiles(resolved)
  const releases = readCityReleases(resolved)
  const receipt = createS11SiteReleaseReceipt({ sourceCommit, releases, files })
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`
  invariant(
    Buffer.byteLength(serialized) <= S11_SITE_RELEASE_LIMITS.receiptBytes,
    'site release receipt exceeds the size limit',
  )
  atomicWriteFileSync(
    path.join(resolved, S11_SITE_RELEASE_FILE),
    serialized,
  )
  return receipt
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  try {
    const receipt = buildS11SiteRelease({
      root: process.argv[2],
      sourceCommit: process.argv[3],
    })
    process.stdout.write(`release_id=${receipt.releaseId}\n`)
  } catch (error) {
    process.stderr.write(`build-site-release: ${error.message || error}\n`)
    process.exitCode = 1
  }
}
