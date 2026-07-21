// Pure, policy-free corpus observability for the Sprint 5 signal foundation.
// "Confidence" here means retained-field completeness, not a claim that a
// field's value is true. Source freshness and editorial judgments stay in
// their respective receipts and evaluation fixtures.

const DECISION_FIELDS = Object.freeze([
  'title',
  'start',
  'end',
  'venue',
  'address',
  'coordinates',
  'price',
  'category',
  'rawCategories',
  'description',
  'image',
  'imageRank',
  'organizer',
  'status',
  'source',
])

function invariant(condition, message) {
  if (!condition) throw new TypeError(message)
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function sourceNames(row) {
  const values = Array.isArray(row.sources) && row.sources.length > 0
    ? row.sources
    : [row.source]
  return [...new Set(values.filter(nonEmptyString).map(value => value.trim()))]
}

function fieldPresent(row, field) {
  switch (field) {
    case 'coordinates':
      return Number.isFinite(row.lat) && Number.isFinite(row.lng)
    case 'price':
      return Number.isFinite(row.price) || row.isFree === true
    case 'imageRank':
      return Number.isFinite(row[field])
    case 'rawCategories':
      return Array.isArray(row.rawCategories) && row.rawCategories.some(nonEmptyString)
    case 'source':
      return sourceNames(row).length > 0
    default:
      return nonEmptyString(row[field])
  }
}

function textLengthStats(rows, field) {
  const lengths = rows
    .map(row => row[field])
    .filter(nonEmptyString)
    .map(value => value.trim().length)
  return {
    meanLength: lengths.length === 0 ? null : lengths.reduce((total, length) => total + length, 0) / lengths.length,
    minLength: lengths.length === 0 ? null : Math.min(...lengths),
    maxLength: lengths.length === 0 ? null : Math.max(...lengths),
  }
}

function decisionFieldConfidence(rows) {
  return Object.fromEntries(DECISION_FIELDS.map((field) => {
    const present = rows.filter(row => fieldPresent(row, field)).length
    const report = {
      present,
      missing: rows.length - present,
      coverage: ratio(present, rows.length),
    }
    if (field === 'description') Object.assign(report, textLengthStats(rows, field))
    return [field, report]
  }))
}

function sourceConcentration(rows) {
  const counts = new Map()
  let citedRows = 0
  let multiSourcedRows = 0
  for (const row of rows) {
    const names = sourceNames(row)
    if (names.length > 0) citedRows += 1
    if (names.length > 1) multiSourcedRows += 1
    for (const name of names) counts.set(name, (counts.get(name) || 0) + 1)
  }

  const ordered = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  const maxCount = ordered.length === 0 ? 0 : Math.max(...ordered.map(([, count]) => count))
  return {
    citedRows,
    uncitedRows: rows.length - citedRows,
    multiSourcedRows,
    distinct: ordered.length,
    counts: Object.fromEntries(ordered),
    maxCount,
    maxShare: ratio(maxCount, rows.length),
    dominant: ordered
      .filter(([, count]) => count === maxCount)
      .map(([name]) => name),
  }
}

function ids(rows, label) {
  return rows.map((row, index) => {
    invariant(row && typeof row === 'object' && !Array.isArray(row), `${label}[${index}] must be an object`)
    invariant(nonEmptyString(row.id), `${label}[${index}].id must be a non-empty string`)
    return row.id
  })
}

/**
 * Reports retained event decision signals and source concentration.
 * It does not set a quality floor or determine rank eligibility.
 */
export function assessCorpusQuality(rows) {
  invariant(Array.isArray(rows), 'rows must be an array')
  rows.forEach((row, index) => invariant(row && typeof row === 'object' && !Array.isArray(row), `rows[${index}] must be an object`))
  return {
    rowCount: rows.length,
    sourceConcentration: sourceConcentration(rows),
    decisionFieldConfidence: decisionFieldConfidence(rows),
  }
}

/**
 * Count-preservation receipt for a corpus transform. IDs make a same-length
 * replacement visible; neither input array is mutated.
 */
export function assessCountPreservation(inputRows, outputRows) {
  invariant(Array.isArray(inputRows), 'inputRows must be an array')
  invariant(Array.isArray(outputRows), 'outputRows must be an array')
  const inputIds = ids(inputRows, 'inputRows')
  const outputIds = ids(outputRows, 'outputRows')
  const inputSet = new Set(inputIds)
  const outputCounts = new Map()
  for (const id of outputIds) outputCounts.set(id, (outputCounts.get(id) || 0) + 1)
  const missing = inputIds.filter(id => !outputCounts.has(id))
  const extra = [...outputCounts.keys()].filter(id => !inputSet.has(id))
  const duplicated = [...outputCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }))
  return {
    inputCount: inputRows.length,
    outputCount: outputRows.length,
    missing,
    extra,
    duplicated,
    exactPermutation:
      inputRows.length === outputRows.length &&
      missing.length === 0 &&
      extra.length === 0 &&
      duplicated.length === 0,
  }
}
