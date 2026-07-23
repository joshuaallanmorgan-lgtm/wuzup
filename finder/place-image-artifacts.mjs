import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './artifact-manifest.mjs'

const LOCAL_PLACE_IMAGE = /^\/place-img\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp))$/i
const LOCAL_PLACE_IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/i

function localImageTreeSnapshot(rows) {
  const sorted = rows.slice().sort((a, b) => a.name.localeCompare(b.name))
  return {
    count: sorted.length,
    bytes: sorted.reduce((total, row) => total + row.bytes, 0),
    sha256: sha256(Buffer.from(sorted.map((row) => `${row.name}\0${row.bytes}\0${row.sha256}`).join('\n'))),
  }
}

function readRegularImage(path, name) {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`place-img/${name} is not a regular file`)
  }
  const body = readFileSync(path)
  return { name, bytes: body.length, sha256: sha256(body) }
}

// A place writer may stop referring to a Mapillary crop because its place
// disappeared, its key changed, or the image receipt expired. The local image
// directory is part of the immutable artifact, so retaining that crop would
// either make the next manifest unverifiable or silently ship stale bytes.
// Reconcile it to the exact final places[] consumer set before reseal.
//
// The deletion surface is deliberately narrow: only safe image basenames and
// only regular files are candidates. All consumers and directory entries are
// preflighted before mutation, and each deletion is bound to the bytes hashed
// during preflight. Dotfiles and non-image files remain untouched;
// writeManifest stays the final authority over the complete artifact member.
export function reconcileLocalPlaceImages(root, places) {
  if (!Array.isArray(places)) throw new Error('places must be an array')

  const consumers = new Map()
  for (const place of places) {
    const image = place?.image
    if (typeof image !== 'string' || !image.startsWith('/place-img/')) continue
    const match = image.match(LOCAL_PLACE_IMAGE)
    if (!match) throw new Error(`${place?.key || 'unknown place'} has unsafe local image path '${image}'`)
    const rows = consumers.get(match[1]) || []
    rows.push(place?.key || null)
    consumers.set(match[1], rows)
  }

  const imageRoot = join(root, 'place-img')
  mkdirSync(imageRoot, { recursive: true })
  const rootInfo = lstatSync(imageRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('place-img is not a regular directory')
  }

  const entries = readdirSync(imageRoot, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  for (const name of consumers.keys()) {
    const entry = byName.get(name)
    if (!entry) throw new Error(`places.json references missing local image '/place-img/${name}'`)
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`place-img/${name} is not a regular file`)
    }
  }

  const beforeRows = []
  for (const entry of entries) {
    if (!LOCAL_PLACE_IMAGE_FILE.test(entry.name)) continue
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`place-img/${entry.name} is not a regular file`)
    }
    beforeRows.push(readRegularImage(join(imageRoot, entry.name), entry.name))
  }

  const removed = []
  for (const row of beforeRows) {
    if (consumers.has(row.name)) continue
    const current = readRegularImage(join(imageRoot, row.name), row.name)
    if (current.bytes !== row.bytes || current.sha256 !== row.sha256) {
      throw new Error(`place-img/${row.name} changed during reconciliation`)
    }
    rmSync(join(imageRoot, row.name))
    removed.push(row)
  }

  const retained = beforeRows.filter((row) => consumers.has(row.name))
  return {
    before: localImageTreeSnapshot(beforeRows),
    after: localImageTreeSnapshot(retained),
    removed,
    consumers: [...consumers.entries()]
      .map(([name, keys]) => ({ name, keys: keys.slice().sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
