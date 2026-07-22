import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { validateImageReference } from './image-reference.mjs'
import { rankItems } from './rank.mjs'

export const FLAGSHIP_IMAGE_REVIEW_SCHEMA_VERSION = 1
export const FLAGSHIP_IMAGE_DECISION_SCHEMA_VERSION = 1

const SAMPLE_PER_CITY = 50
const ALLOWED_REMOTE_IMAGE_HOSTS = new Set(['upload.wikimedia.org'])
const HASH = /^sha256:[a-f0-9]{64}$/
const REVIEW_STATE = 'pending-independent-review'
const REVIEW_PENDING = 'pending'
const STRATEGY = 'risk-source-delivery-round-robin-v1'
const RANK_PROXY = 'shared-rank-place-projection-v1'
const REVIEW_VERDICTS = new Set(['pass', 'fail'])
const REVIEW_RESOLUTIONS = new Set(['keep', 'remove', 'replace', 'fallback'])
const REVIEW_MIME_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_REVIEW_BYTE_AGE_MS = 24 * 60 * 60 * 1000

const CITY_POLICIES = Object.freeze([
  Object.freeze({
    cityId: 'tampa-bay',
    timeZone: 'America/New_York',
    regionCodes: Object.freeze(['FL']),
    bbox: Object.freeze({ latMin: 27.3, latMax: 28.6, lngMin: -83.3, lngMax: -81.9 }),
  }),
  Object.freeze({
    cityId: 'sf-east-bay',
    timeZone: 'America/Los_Angeles',
    regionCodes: Object.freeze(['CA']),
    bbox: Object.freeze({ latMin: 37.68, latMax: 38, lngMin: -122.53, lngMax: -121.88 }),
  }),
])

const RISK_ORDER = Object.freeze([
  'REFERENCE_REUSED',
  'LICENSE_URL_MISSING',
  'SELF_HOSTED_BYTES',
  'ADDRESS_MISSING',
])
const RISK_WEIGHT = Object.freeze({
  REFERENCE_REUSED: 8,
  LICENSE_URL_MISSING: 4,
  SELF_HOSTED_BYTES: 2,
  ADDRESS_MISSING: 1,
})

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function compareText(left, right) {
  return String(left) < String(right) ? -1 : (String(left) > String(right) ? 1 : 0)
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function exactKeys(value, keys, label) {
  invariant(plainObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort(compareText)
  const expected = [...keys].sort(compareText)
  invariant(actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} must contain exactly: ${expected.join(', ')}`)
}

function httpsUrl(value, label) {
  const reference = validateImageReference(value)
  invariant(reference.kind === 'remote', `${label} must be an HTTPS URL`)
  return reference
}

function httpOrHttpsUrl(value, label) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    invariant(false, `${label} must be an HTTP(S) URL`)
  }
  invariant((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname &&
    !parsed.username && !parsed.password, `${label} must be an HTTP(S) URL`)
  return parsed
}

function artifactRows(raw, label) {
  const rows = Array.isArray(raw) ? raw : raw?.places || raw?.items
  invariant(Array.isArray(rows), `${label} must contain a places array`)
  return rows
}

function sourceValue(value) {
  const source = plainObject(value) ? value.family || value.name || value.source : value
  const normalized = text(source)
  return normalized ? normalized.replace(/\s*\([^)]*\)\s*$/, '').trim() : null
}

function placeSources(place) {
  const raw = Array.isArray(place.sourceFamilies)
    ? place.sourceFamilies
    : Array.isArray(place.sources) ? place.sources : [place.sourceFamily || place.source]
  return [...new Set(raw.map(sourceValue).filter(Boolean))]
}

function projectedPlace(place, city) {
  const sources = placeSources(place)
  const hasCoordinates = Number.isFinite(place.lat) && Number.isFinite(place.lng)
  const hasVerifiedMarket = hasCoordinates || place.marketId === city.cityId || place.addressMarketId === city.cityId
  return {
    id: place.key,
    key: place.key,
    title: place.title || place.name,
    sourceFamily: sourceValue(place.sourceFamily || sources[0]),
    sourceFamilies: sources,
    category: place.category,
    placeType: place.placeType,
    classes: Array.isArray(place.classes) ? place.classes : [],
    activities: Array.isArray(place.activities) ? place.activities : [],
    activityIds: Array.isArray(place.activityIds) ? place.activityIds : [],
    amenities: Array.isArray(place.amenities) ? place.amenities : [],
    venueId: place.venueId || place.operatorId || null,
    venueOrOperator: place.venueOrOperator || place.operator || place.brand || place.title || place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    description: place.description,
    descriptionLength: Number.isFinite(place.descriptionLength)
      ? place.descriptionLength
      : typeof place.description === 'string' ? place.description.length : null,
    price: place.price,
    priceMin: place.priceMin,
    priceMax: place.priceMax,
    priceState: place.priceState,
    isFree: place.isFree === true ? true : place.isFree === false ? false : null,
    canonicalId: place.canonicalId || place.canonicalKey || place.key,
    actionability: hasVerifiedMarket,
    lowInformation: place.lowInformation === true || !hasVerifiedMarket,
    isBusiness: place.isBusiness === true,
    isGeneric: place.isGeneric === true,
    isChain: place.isChain === true,
    marketId: place.marketId,
    addressMarketId: place.addressMarketId,
  }
}

function rankProxyByItem(places, city, manifest) {
  const projected = places.map(place => projectedPlace(place, city))
  const nowMs = Date.parse(manifest.generatedAt)
  invariant(Number.isFinite(nowMs), `${city.cityId} manifest.generatedAt must be valid`)
  const ranking = rankItems(projected, {
    kind: 'places',
    qualityPolicy: {
      kind: 'places',
      nowMs,
      timeZone: city.timeZone,
      market: {
        id: city.cityId,
        bbox: city.bbox,
        regionCodes: city.regionCodes,
      },
    },
  })
  return new Map(ranking.scored.map((scored, index) => [scored.id, {
    position: index + 1,
    tier: scored.tier,
    leadEligible: scored.leadEligible,
    objectiveScore: scored.objectiveScore,
    totalScore: scored.totalScore,
    reasonCodes: [...scored.reasons],
  }]))
}

function runtimeCreditedPlace(place) {
  return place?.kind === 'place' && text(place.key) && text(place.name) && text(place.image) &&
    plainObject(place.imageCredit) && text(place.imageCredit.license) && text(place.imageCredit.url)
}

function validateCandidate(place, cityId) {
  invariant(runtimeCreditedPlace(place), `${cityId}:${place?.key || 'unknown'} is not a credited renderable place`)
  const credit = place.imageCredit
  invariant(text(credit.author), `${cityId}:${place.key} image credit author is required`)
  invariant(text(credit.sourceFamily), `${cityId}:${place.key} image credit sourceFamily is required`)
  httpsUrl(credit.url, `${cityId}:${place.key} image credit url`)
  if (credit.licenseUrl != null) httpOrHttpsUrl(credit.licenseUrl, `${cityId}:${place.key} image credit licenseUrl`)

  const reference = validateImageReference(place.image)
  invariant(reference.kind === 'selfHosted' || reference.kind === 'remote',
    `${cityId}:${place.key} image reference is invalid`)
  if (reference.kind === 'selfHosted') {
    invariant(reference.url.startsWith('/place-img/'), `${cityId}:${place.key} local image must be under /place-img/`)
  } else {
    invariant(ALLOWED_REMOTE_IMAGE_HOSTS.has(reference.host),
      `${cityId}:${place.key} image host is not currently renderable`)
  }
  return reference
}

function riskFlags({ place, reference, usageCount }) {
  const flags = []
  if (usageCount > 1) flags.push('REFERENCE_REUSED')
  if (!text(place.imageCredit.licenseUrl)) flags.push('LICENSE_URL_MISSING')
  if (reference.kind === 'selfHosted') flags.push('SELF_HOSTED_BYTES')
  if (!text(place.address)) flags.push('ADDRESS_MISSING')
  return RISK_ORDER.filter(flag => flags.includes(flag))
}

function riskScore(flags) {
  return flags.reduce((sum, flag) => sum + RISK_WEIGHT[flag], 0)
}

function stratumKey(candidate) {
  return `${candidate.delivery}|${candidate.sourceFamily}`
}

function sampleCandidates(candidates, count, cityId) {
  const groups = new Map()
  for (const candidate of candidates) {
    const key = stratumKey(candidate)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(candidate)
  }
  const strata = [...groups.entries()].sort(([left], [right]) => {
    const leftLocal = left.startsWith('self-hosted|') ? 0 : 1
    const rightLocal = right.startsWith('self-hosted|') ? 0 : 1
    return leftLocal - rightLocal || compareText(left, right)
  })
  for (const [, group] of strata) {
    group.sort((left, right) => right.riskScore - left.riskScore ||
      left.rankProxy.position - right.rankProxy.position || compareText(left.place.key, right.place.key))
  }

  const selected = []
  let cursor = 0
  while (selected.length < count && strata.some(([, group]) => cursor < group.length)) {
    for (const [, group] of strata) {
      if (selected.length >= count) break
      if (cursor < group.length) selected.push(group[cursor])
    }
    cursor++
  }
  invariant(selected.length === count, `${cityId} has only ${selected.length} eligible review rows; ${count} required`)
  return selected
}

async function localByteEvidence({ repoRoot, cityId, image }) {
  const outputRoot = path.resolve(repoRoot, 'finder', 'output', cityId)
  const localRoot = path.resolve(outputRoot, 'place-img')
  const target = path.resolve(outputRoot, image.replace(/^\/+/, '').replace(/\//g, path.sep))
  invariant(target.startsWith(`${localRoot}${path.sep}`), `${cityId}:${image} local image escapes place-img`)
  const bytes = await readFile(target)
  const metadata = await sharp(bytes).metadata()
  invariant(Number.isInteger(metadata.width) && Number.isInteger(metadata.height),
    `${cityId}:${image} image dimensions are unavailable`)
  return {
    path: path.relative(repoRoot, target).replace(/\\/g, '/'),
    sha256: sha256(bytes),
    bytes: bytes.length,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format || null,
  }
}

async function readCity(repoRoot, city) {
  const outputRoot = path.resolve(repoRoot, 'finder', 'output', city.cityId)
  const manifestPath = path.join(outputRoot, 'artifact-manifest.json')
  const placesPath = path.join(outputRoot, 'places.json')
  const [manifestBytes, placesBytes] = await Promise.all([readFile(manifestPath), readFile(placesPath)])
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const placesRaw = JSON.parse(placesBytes.toString('utf8'))
  const places = artifactRows(placesRaw, `${city.cityId} places.json`)
  const placesReceipt = manifest?.artifacts?.places

  invariant(manifest.cityId === city.cityId, `${city.cityId} manifest city mismatch`)
  invariant(manifest.timeZone === city.timeZone, `${city.cityId} manifest timezone mismatch`)
  invariant(HASH.test(manifest.buildId || ''), `${city.cityId} manifest buildId is invalid`)
  invariant(HASH.test(manifest.manifestId || ''), `${city.cityId} manifest manifestId is invalid`)
  invariant(plainObject(placesReceipt), `${city.cityId} manifest places receipt is missing`)
  invariant(`sha256:${placesReceipt.sha256}` === sha256(placesBytes), `${city.cityId} places hash mismatch`)
  invariant(placesReceipt.bytes === placesBytes.length, `${city.cityId} places byte count mismatch`)
  invariant(placesReceipt.count === places.length, `${city.cityId} places row count mismatch`)

  return {
    manifest,
    places,
    binding: {
      cityId: city.cityId,
      manifestPath: path.relative(repoRoot, manifestPath).replace(/\\/g, '/'),
      manifestSha256: sha256(manifestBytes),
      manifestId: manifest.manifestId,
      buildId: manifest.buildId,
      placesPath: path.relative(repoRoot, placesPath).replace(/\\/g, '/'),
      placesSha256: sha256(placesBytes),
      placesBytes: placesBytes.length,
      placesCount: places.length,
    },
  }
}

function countValues(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts.entries()].sort(([left], [right]) => compareText(left, right))
    .map(([value, count]) => ({ value, count }))
}

function citySummary(cityId, pool, items) {
  return {
    cityId,
    candidatePool: pool.length,
    selected: items.length,
    delivery: countValues(items.map(item => item.image.delivery)),
    sourceFamilies: countValues(items.map(item => item.credit.sourceFamily)),
    riskFlags: countValues(items.flatMap(item => item.stratification.riskFlags)),
  }
}

async function buildCityItems({ repoRoot, city, cityData, startingIndex }) {
  const rankByItem = rankProxyByItem(cityData.places, city, cityData.manifest)
  const imagePlaces = cityData.places.filter(place => place?.kind === 'place' && text(place.image))
  for (const place of imagePlaces) validateCandidate(place, city.cityId)
  const usage = new Map()
  for (const place of imagePlaces) {
    usage.set(place.image, (usage.get(place.image) || 0) + 1)
  }

  const candidates = imagePlaces.map(place => {
    const reference = validateCandidate(place, city.cityId)
    const rankProxy = rankByItem.get(place.key)
    invariant(rankProxy, `${city.cityId}:${place.key} rank proxy is missing`)
    const flags = riskFlags({ place, reference, usageCount: usage.get(place.image) })
    return {
      place,
      reference,
      delivery: reference.kind === 'selfHosted' ? 'self-hosted' : 'remote',
      sourceFamily: place.imageCredit.sourceFamily.trim(),
      rankProxy,
      riskFlags: flags,
      riskScore: riskScore(flags),
      usageCount: usage.get(place.image),
    }
  })
  invariant(candidates.length >= SAMPLE_PER_CITY,
    `${city.cityId} needs at least ${SAMPLE_PER_CITY} credited renderable place rows`)

  const selected = sampleCandidates(candidates, SAMPLE_PER_CITY, city.cityId)
  const items = []
  for (const [offset, candidate] of selected.entries()) {
    const { place, reference } = candidate
    const localByte = candidate.delivery === 'self-hosted'
      ? await localByteEvidence({ repoRoot, cityId: city.cityId, image: reference.url })
      : null
    items.push({
      sampleIndex: startingIndex + offset,
      cityId: city.cityId,
      itemId: place.key,
      name: place.name.trim(),
      address: text(place.address),
      coordinates: {
        lat: Number.isFinite(place.lat) ? place.lat : null,
        lng: Number.isFinite(place.lng) ? place.lng : null,
      },
      rankProxy: candidate.rankProxy,
      image: {
        reference: reference.url,
        delivery: candidate.delivery,
        host: reference.host,
        artifactUsageCount: candidate.usageCount,
        localByte,
      },
      credit: {
        sourceFamily: candidate.sourceFamily,
        sourcePage: place.imageCredit.url.trim(),
        author: place.imageCredit.author.trim(),
        license: place.imageCredit.license.trim(),
        licenseUrl: text(place.imageCredit.licenseUrl),
      },
      stratification: {
        stratum: stratumKey(candidate),
        riskScore: candidate.riskScore,
        riskFlags: candidate.riskFlags,
      },
      review: {
        identity: REVIEW_PENDING,
        pixel: REVIEW_PENDING,
        legal: REVIEW_PENDING,
        humanPass: false,
      },
    })
  }
  return { candidates, items }
}

export async function buildFlagshipImageReview({ repoRoot } = {}) {
  invariant(text(repoRoot), 'repoRoot is required')
  const root = path.resolve(repoRoot)
  const artifacts = []
  const items = []
  const summaries = []

  for (const city of CITY_POLICIES) {
    const cityData = await readCity(root, city)
    const built = await buildCityItems({
      repoRoot: root,
      city,
      cityData,
      startingIndex: items.length + 1,
    })
    artifacts.push(cityData.binding)
    items.push(...built.items)
    summaries.push(citySummary(city.cityId, built.candidates, built.items))
  }

  const review = {
    schemaVersion: FLAGSHIP_IMAGE_REVIEW_SCHEMA_VERSION,
    reviewState: REVIEW_STATE,
    claims: {
      identityReview: REVIEW_PENDING,
      pixelReview: REVIEW_PENDING,
      legalReview: REVIEW_PENDING,
      humanPass: false,
      statement: 'This deterministic evidence manifest is not an identity, pixel-quality, licensing, or legal approval.',
    },
    selectionPolicy: {
      strategy: STRATEGY,
      rankProxy: RANK_PROXY,
      samplePerCity: SAMPLE_PER_CITY,
      totalSample: SAMPLE_PER_CITY * CITY_POLICIES.length,
    },
    artifacts,
    summary: {
      total: items.length,
      cities: summaries,
    },
    items,
  }
  validateFlagshipImageReview(review)
  return review
}

function validateCountRows(rows, label) {
  invariant(Array.isArray(rows), `${label} must be an array`)
  let previous = null
  for (const [index, row] of rows.entries()) {
    exactKeys(row, ['value', 'count'], `${label}[${index}]`)
    invariant(text(row.value), `${label}[${index}].value is required`)
    invariant(Number.isInteger(row.count) && row.count > 0, `${label}[${index}].count must be positive`)
    invariant(previous == null || compareText(previous, row.value) < 0, `${label} must be sorted and unique`)
    previous = row.value
  }
}

function validateBinding(binding, index) {
  const label = `artifacts[${index}]`
  exactKeys(binding, [
    'cityId', 'manifestPath', 'manifestSha256', 'manifestId', 'buildId', 'placesPath', 'placesSha256',
    'placesBytes', 'placesCount',
  ], label)
  invariant(CITY_POLICIES[index]?.cityId === binding.cityId, `${label}.cityId is out of order`)
  for (const key of ['manifestPath', 'placesPath']) invariant(text(binding[key]), `${label}.${key} is required`)
  for (const key of ['manifestSha256', 'manifestId', 'buildId', 'placesSha256']) {
    invariant(HASH.test(binding[key] || ''), `${label}.${key} must be sha256`)
  }
  invariant(Number.isInteger(binding.placesBytes) && binding.placesBytes > 0, `${label}.placesBytes must be positive`)
  invariant(Number.isInteger(binding.placesCount) && binding.placesCount > 0, `${label}.placesCount must be positive`)
}

function validateItem(item, index) {
  const label = `items[${index}]`
  exactKeys(item, [
    'sampleIndex', 'cityId', 'itemId', 'name', 'address', 'coordinates', 'rankProxy', 'image', 'credit',
    'stratification', 'review',
  ], label)
  invariant(item.sampleIndex === index + 1, `${label}.sampleIndex must be sequential`)
  invariant(CITY_POLICIES.some(city => city.cityId === item.cityId), `${label}.cityId is invalid`)
  for (const key of ['itemId', 'name']) invariant(text(item[key]), `${label}.${key} is required`)
  invariant(item.address == null || text(item.address), `${label}.address must be null or non-empty`)

  exactKeys(item.coordinates, ['lat', 'lng'], `${label}.coordinates`)
  invariant(item.coordinates.lat == null || Number.isFinite(item.coordinates.lat), `${label}.coordinates.lat is invalid`)
  invariant(item.coordinates.lng == null || Number.isFinite(item.coordinates.lng), `${label}.coordinates.lng is invalid`)

  exactKeys(item.rankProxy, [
    'position', 'tier', 'leadEligible', 'objectiveScore', 'totalScore', 'reasonCodes',
  ], `${label}.rankProxy`)
  invariant(Number.isInteger(item.rankProxy.position) && item.rankProxy.position > 0,
    `${label}.rankProxy.position must be positive`)
  invariant(['candidate', 'recommended', 'top-placement'].includes(item.rankProxy.tier),
    `${label}.rankProxy.tier is invalid`)
  invariant(typeof item.rankProxy.leadEligible === 'boolean', `${label}.rankProxy.leadEligible must be boolean`)
  invariant(Number.isFinite(item.rankProxy.objectiveScore), `${label}.rankProxy.objectiveScore must be finite`)
  invariant(Number.isFinite(item.rankProxy.totalScore), `${label}.rankProxy.totalScore must be finite`)
  invariant(Array.isArray(item.rankProxy.reasonCodes) && item.rankProxy.reasonCodes.every(text),
    `${label}.rankProxy.reasonCodes must be strings`)

  exactKeys(item.image, [
    'reference', 'delivery', 'host', 'artifactUsageCount', 'localByte',
  ], `${label}.image`)
  const reference = validateImageReference(item.image.reference)
  invariant(['self-hosted', 'remote'].includes(item.image.delivery), `${label}.image.delivery is invalid`)
  invariant(Number.isInteger(item.image.artifactUsageCount) && item.image.artifactUsageCount > 0,
    `${label}.image.artifactUsageCount must be positive`)
  if (item.image.delivery === 'self-hosted') {
    invariant(reference.kind === 'selfHosted' && item.image.host == null, `${label}.image local delivery is inconsistent`)
    exactKeys(item.image.localByte, ['path', 'sha256', 'bytes', 'width', 'height', 'format'], `${label}.image.localByte`)
    invariant(text(item.image.localByte.path), `${label}.image.localByte.path is required`)
    invariant(HASH.test(item.image.localByte.sha256 || ''), `${label}.image.localByte.sha256 is invalid`)
    for (const key of ['bytes', 'width', 'height']) {
      invariant(Number.isInteger(item.image.localByte[key]) && item.image.localByte[key] > 0,
        `${label}.image.localByte.${key} must be positive`)
    }
    invariant(text(item.image.localByte.format), `${label}.image.localByte.format is required`)
  } else {
    invariant(reference.kind === 'remote' && ALLOWED_REMOTE_IMAGE_HOSTS.has(reference.host),
      `${label}.image remote reference is not allowed`)
    invariant(item.image.host === reference.host, `${label}.image.host mismatch`)
    invariant(item.image.localByte == null, `${label}.image.localByte must be null for remote images`)
  }

  exactKeys(item.credit, ['sourceFamily', 'sourcePage', 'author', 'license', 'licenseUrl'], `${label}.credit`)
  for (const key of ['sourceFamily', 'sourcePage', 'author', 'license']) {
    invariant(text(item.credit[key]), `${label}.credit.${key} is required`)
  }
  httpsUrl(item.credit.sourcePage, `${label}.credit.sourcePage`)
  if (item.credit.licenseUrl != null) httpOrHttpsUrl(item.credit.licenseUrl, `${label}.credit.licenseUrl`)

  exactKeys(item.stratification, ['stratum', 'riskScore', 'riskFlags'], `${label}.stratification`)
  invariant(item.stratification.stratum === `${item.image.delivery}|${item.credit.sourceFamily}`,
    `${label}.stratification.stratum mismatch`)
  invariant(Number.isInteger(item.stratification.riskScore) && item.stratification.riskScore >= 0,
    `${label}.stratification.riskScore must be non-negative`)
  invariant(Array.isArray(item.stratification.riskFlags), `${label}.stratification.riskFlags must be an array`)
  invariant(item.stratification.riskFlags.every(flag => RISK_ORDER.includes(flag)),
    `${label}.stratification.riskFlags contains an unknown flag`)
  invariant(item.stratification.riskFlags.every((flag, flagIndex, flags) =>
    flagIndex === 0 || RISK_ORDER.indexOf(flags[flagIndex - 1]) < RISK_ORDER.indexOf(flag)),
  `${label}.stratification.riskFlags must be ordered and unique`)
  invariant(item.stratification.riskScore === riskScore(item.stratification.riskFlags),
    `${label}.stratification.riskScore mismatch`)

  exactKeys(item.review, ['identity', 'pixel', 'legal', 'humanPass'], `${label}.review`)
  for (const key of ['identity', 'pixel', 'legal']) {
    invariant(item.review[key] === REVIEW_PENDING, `${label}.review.${key} must remain pending`)
  }
  invariant(item.review.humanPass === false, `${label}.review.humanPass must be false`)
}

export function validateFlagshipImageReview(review) {
  exactKeys(review, [
    'schemaVersion', 'reviewState', 'claims', 'selectionPolicy', 'artifacts', 'summary', 'items',
  ], 'review')
  invariant(review.schemaVersion === FLAGSHIP_IMAGE_REVIEW_SCHEMA_VERSION, 'review.schemaVersion is invalid')
  invariant(review.reviewState === REVIEW_STATE, 'review.reviewState must remain pending-independent-review')

  exactKeys(review.claims, [
    'identityReview', 'pixelReview', 'legalReview', 'humanPass', 'statement',
  ], 'review.claims')
  for (const key of ['identityReview', 'pixelReview', 'legalReview']) {
    invariant(review.claims[key] === REVIEW_PENDING, `review.claims.${key} must remain pending`)
  }
  invariant(review.claims.humanPass === false, 'review.claims.humanPass must be false')
  invariant(text(review.claims.statement) && /not an identity, pixel-quality, licensing, or legal approval/.test(review.claims.statement),
    'review.claims.statement must preserve the non-claim')

  exactKeys(review.selectionPolicy, ['strategy', 'rankProxy', 'samplePerCity', 'totalSample'], 'review.selectionPolicy')
  invariant(review.selectionPolicy.strategy === STRATEGY, 'review.selectionPolicy.strategy is invalid')
  invariant(review.selectionPolicy.rankProxy === RANK_PROXY, 'review.selectionPolicy.rankProxy is invalid')
  invariant(review.selectionPolicy.samplePerCity === SAMPLE_PER_CITY, 'review.selectionPolicy.samplePerCity is invalid')
  invariant(review.selectionPolicy.totalSample === SAMPLE_PER_CITY * CITY_POLICIES.length,
    'review.selectionPolicy.totalSample is invalid')

  invariant(Array.isArray(review.artifacts) && review.artifacts.length === CITY_POLICIES.length,
    'review.artifacts must bind both flagship cities')
  review.artifacts.forEach(validateBinding)

  exactKeys(review.summary, ['total', 'cities'], 'review.summary')
  invariant(review.summary.total === SAMPLE_PER_CITY * CITY_POLICIES.length, 'review.summary.total is invalid')
  invariant(Array.isArray(review.summary.cities) && review.summary.cities.length === CITY_POLICIES.length,
    'review.summary.cities must contain both cities')
  for (const [index, summary] of review.summary.cities.entries()) {
    exactKeys(summary, ['cityId', 'candidatePool', 'selected', 'delivery', 'sourceFamilies', 'riskFlags'],
      `review.summary.cities[${index}]`)
    invariant(summary.cityId === CITY_POLICIES[index].cityId, `review.summary.cities[${index}].cityId is out of order`)
    invariant(Number.isInteger(summary.candidatePool) && summary.candidatePool >= SAMPLE_PER_CITY,
      `review.summary.cities[${index}].candidatePool is too small`)
    invariant(summary.selected === SAMPLE_PER_CITY, `review.summary.cities[${index}].selected must be ${SAMPLE_PER_CITY}`)
    validateCountRows(summary.delivery, `review.summary.cities[${index}].delivery`)
    validateCountRows(summary.sourceFamilies, `review.summary.cities[${index}].sourceFamilies`)
    validateCountRows(summary.riskFlags, `review.summary.cities[${index}].riskFlags`)
  }

  invariant(Array.isArray(review.items) && review.items.length === review.summary.total,
    'review.items must contain exactly 100 rows')
  review.items.forEach(validateItem)
  const identities = new Set(review.items.map(item => `${item.cityId}|${item.itemId}`))
  invariant(identities.size === review.items.length, 'review.items must use unique city/item identities')
  for (const city of CITY_POLICIES) {
    invariant(review.items.filter(item => item.cityId === city.cityId).length === SAMPLE_PER_CITY,
      `${city.cityId} must contribute exactly ${SAMPLE_PER_CITY} rows`)
  }
  return review
}

function isoInstant(value, label) {
  invariant(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} must be an ISO instant`)
  invariant(new Date(value).toISOString() === value, `${label} must be a canonical ISO instant`)
  return value
}

function validateReviewedBytes(bytes, item, reviewedAt, label) {
  exactKeys(bytes, ['sha256', 'bytes', 'width', 'height', 'mimeType', 'retrievedAt', 'finalUrl'], label)
  invariant(HASH.test(bytes.sha256 || ''), `${label}.sha256 must bind the reviewed bytes`)
  for (const key of ['bytes', 'width', 'height']) {
    invariant(Number.isInteger(bytes[key]) && bytes[key] > 0, `${label}.${key} must be positive`)
  }
  invariant(REVIEW_MIME_TYPES.has(bytes.mimeType), `${label}.mimeType is invalid`)
  isoInstant(bytes.retrievedAt, `${label}.retrievedAt`)
  const ageMs = Date.parse(reviewedAt) - Date.parse(bytes.retrievedAt)
  invariant(ageMs >= 0, `${label}.retrievedAt cannot follow the review`)
  invariant(ageMs <= MAX_REVIEW_BYTE_AGE_MS, `${label}.retrievedAt is too old for this review`)

  if (item.image.delivery === 'remote') {
    httpsUrl(bytes.finalUrl, `${label}.finalUrl`)
    invariant(bytes.finalUrl === item.image.reference,
      `${label}.finalUrl must match the audited image reference`)
  } else {
    invariant(bytes.finalUrl === null, `${label}.finalUrl must be null for self-hosted bytes`)
    invariant(bytes.sha256 === item.image.localByte.sha256, `${label}.sha256 does not match local reviewed bytes`)
    invariant(bytes.bytes === item.image.localByte.bytes, `${label}.bytes does not match local reviewed bytes`)
    invariant(bytes.width === item.image.localByte.width, `${label}.width does not match local reviewed bytes`)
    invariant(bytes.height === item.image.localByte.height, `${label}.height does not match local reviewed bytes`)
    invariant(bytes.mimeType === `image/${item.image.localByte.format}`,
      `${label}.mimeType does not match local reviewed bytes`)
  }
}

/**
 * Validate the separate human review receipt. Remote decisions bind the exact
 * fetched pixels, not only a mutable URL; local decisions must match the bytes
 * already bound by the artifact review manifest.
 */
export function validateFlagshipImageDecisionReceipt({ review, receipt } = {}) {
  validateFlagshipImageReview(review)
  exactKeys(receipt, ['schemaVersion', 'reportSha256', 'reviewer', 'reviewedAt', 'items'], 'decision receipt')
  invariant(receipt.schemaVersion === FLAGSHIP_IMAGE_DECISION_SCHEMA_VERSION,
    'decision receipt schemaVersion is invalid')
  invariant(receipt.reportSha256 === flagshipImageReviewSha256(review),
    'decision receipt reportSha256 does not match the review population')
  invariant(text(receipt.reviewer), 'decision receipt reviewer is required')
  isoInstant(receipt.reviewedAt, 'decision receipt reviewedAt')
  invariant(Array.isArray(receipt.items) && receipt.items.length === review.items.length,
    'decision receipt must contain every reviewed item')

  let passed = 0
  for (const [index, decision] of receipt.items.entries()) {
    const item = review.items[index]
    const label = `decision receipt items[${index}]`
    exactKeys(decision, [
      'sampleIndex', 'cityId', 'itemId', 'imageReference', 'reviewedBytes',
      'identity', 'pixel', 'creditLicense', 'resolution',
    ], label)
    invariant(decision.sampleIndex === item.sampleIndex, `${label}.sampleIndex does not match`)
    invariant(decision.cityId === item.cityId, `${label}.cityId does not match`)
    invariant(decision.itemId === item.itemId, `${label}.itemId does not match`)
    invariant(decision.imageReference === item.image.reference, `${label}.imageReference does not match`)
    validateReviewedBytes(decision.reviewedBytes, item, receipt.reviewedAt, `${label}.reviewedBytes`)
    for (const key of ['identity', 'pixel', 'creditLicense']) {
      invariant(REVIEW_VERDICTS.has(decision[key]), `${label}.${key} is invalid`)
    }
    invariant(REVIEW_RESOLUTIONS.has(decision.resolution), `${label}.resolution is invalid`)
    const allPass = decision.identity === 'pass' && decision.pixel === 'pass' &&
      decision.creditLicense === 'pass'
    invariant(decision.resolution !== 'keep' || allPass, `${label} cannot keep a failed image`)
    if (decision.resolution === 'keep' && allPass) passed++
  }

  return Object.freeze({
    ok: true,
    complete: true,
    passed: passed === review.items.length,
    kept: passed,
    actionRequired: review.items.length - passed,
    reportSha256: receipt.reportSha256,
  })
}

function canonicalReview(review) {
  return JSON.stringify(review)
}

export function flagshipImageReviewSha256(review) {
  validateFlagshipImageReview(review)
  return sha256(Buffer.from(canonicalReview(review), 'utf8'))
}

export async function verifyFlagshipImageReview({ repoRoot, review } = {}) {
  validateFlagshipImageReview(review)
  const expected = await buildFlagshipImageReview({ repoRoot })
  invariant(canonicalReview(review) === canonicalReview(expected),
    'review manifest does not match the current pinned artifacts and deterministic selection')
  return {
    ok: true,
    sha256: flagshipImageReviewSha256(review),
    itemCount: review.items.length,
  }
}

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(modulePath), '..')
  try {
    const review = await buildFlagshipImageReview({ repoRoot })
    process.stdout.write(`${JSON.stringify(review, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`)
    process.exitCode = 1
  }
}
