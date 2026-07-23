export const CORRECTION_STATE_VERSION = 1
export const CORRECTION_CAP = 128
export const CORRECTION_DETAIL_MAX = 1000
export const CORRECTION_PROBLEMS = Object.freeze([
  ['wrong-time', 'Date or time is wrong'],
  ['wrong-location', 'Place or address is wrong'],
  ['cancelled', 'Cancelled or no longer happening'],
  ['duplicate', 'Duplicate listing'],
  ['wrong-image', 'Image is wrong'],
  ['other', 'Something else'],
])

const PROBLEM_IDS = new Set(CORRECTION_PROBLEMS.map(([id]) => id))
const KINDS = new Set(['event', 'place', 'guide'])
const safeText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const validCityId = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
const exactKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key))
const copyCorrection = (value) => ({ ...value, item: { ...value.item } })

export function emptyCorrectionState(cityId) {
  const cleanCityId = safeText(cityId, 96)
  if (!validCityId(cleanCityId)) throw new TypeError('valid cityId is required')
  return Object.freeze({ version: CORRECTION_STATE_VERSION, cityId: cleanCityId, corrections: Object.freeze([]) })
}

function canonicalItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!exactKeys(value, ['kind', 'id', 'title', 'sourceFamily', 'sourceUrl'])) return null
  const kind = safeText(value.kind, 16)
  const id = safeText(value.id, 240)
  const title = safeText(value.title, 240)
  const sourceFamily = safeText(value.sourceFamily, 160)
  const sourceUrl = safeText(value.sourceUrl, 2048)
  if (!KINDS.has(kind) || !id || !title) return null
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return null
  return { kind, id, title, sourceFamily: sourceFamily || null, sourceUrl: sourceUrl || null }
}

export function canonicalCorrection(value, cityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!exactKeys(value, ['id', 'cityId', 'item', 'problem', 'detail', 'createdAt'])) return null
  const id = safeText(value.id, 120)
  const problem = safeText(value.problem, 40)
  const detail = safeText(value.detail, CORRECTION_DETAIL_MAX)
  const createdAt = safeText(value.createdAt, 40)
  const item = canonicalItem(value.item)
  if (!id || !PROBLEM_IDS.has(problem) || !item || !Number.isFinite(Date.parse(createdAt))) return null
  if (value.cityId !== cityId) return null
  return { id, cityId, item, problem, detail, createdAt: new Date(createdAt).toISOString() }
}

export function normalizeCorrectionState(value, cityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.version !== CORRECTION_STATE_VERSION
      || !exactKeys(value, ['version', 'cityId', 'corrections'])
      || value.cityId !== cityId
      || !Array.isArray(value.corrections)
      || value.corrections.length > CORRECTION_CAP) return null
  const corrections = []
  const seen = new Set()
  for (const raw of value.corrections) {
    const item = canonicalCorrection(raw, cityId)
    if (!item || seen.has(item.id)) return null
    seen.add(item.id)
    corrections.push(item)
  }
  for (const item of corrections) Object.freeze(item.item)
  corrections.forEach(Object.freeze)
  Object.freeze(corrections)
  return Object.freeze({ version: CORRECTION_STATE_VERSION, cityId, corrections })
}

export function addCorrection(state, input, { now = Date.now(), id } = {}) {
  const current = normalizeCorrectionState(state, state?.cityId)
  if (!current) return { changed: false, code: 'invalid-state', state }
  if (current.corrections.length >= CORRECTION_CAP) return { changed: false, code: 'correction-cap-reached', state: current }
  if (!Number.isFinite(now)) return { changed: false, code: 'invalid-correction-time', state: current }
  const createdAt = new Date(now).toISOString()
  const candidate = canonicalCorrection({
    id: id || `correction-${now.toString(36)}-${current.corrections.length.toString(36)}`,
    cityId: current.cityId,
    item: input?.item,
    problem: input?.problem,
    detail: input?.detail || '',
    createdAt,
  }, current.cityId)
  if (!candidate) return { changed: false, code: 'invalid-correction', state: current }
  if (current.corrections.some((row) => row.id === candidate.id)) {
    return { changed: false, code: 'duplicate-correction', state: current }
  }
  const next = normalizeCorrectionState({ ...current, corrections: [...current.corrections, candidate] }, current.cityId)
  return { changed: true, code: 'correction-recorded', state: next, correction: candidate }
}

export function correctionExportReceipt(state, exportedAt = Date.now()) {
  const normalized = normalizeCorrectionState(state, state?.cityId)
  if (!normalized || !Number.isFinite(exportedAt)) return null
  return {
    schema: 'wuzup-corrections',
    version: CORRECTION_STATE_VERSION,
    cityId: normalized.cityId,
    exportedAt: new Date(exportedAt).toISOString(),
    corrections: normalized.corrections.map(copyCorrection),
    delivery: 'not-sent',
  }
}

export function correctionImportDocument(value, cityId) {
  if (!value || typeof value !== 'object' || value.schema !== 'wuzup-corrections'
      || !exactKeys(value, ['schema', 'version', 'cityId', 'exportedAt', 'corrections', 'delivery'])
      || value.version !== CORRECTION_STATE_VERSION || value.cityId !== cityId
      || value.delivery !== 'not-sent' || !Number.isFinite(Date.parse(value.exportedAt))) return null
  return normalizeCorrectionState({
    version: value.version,
    cityId: value.cityId,
    corrections: value.corrections,
  }, cityId)
}
