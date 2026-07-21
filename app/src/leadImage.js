import { selectImageCandidate } from '../../shared/image-candidate.mjs'

const DISPLAY_ROLES = new Set(['exact-item', 'verified-venue', 'contextual'])

export const LEAD_IMAGE_ROLES = Object.freeze({
  EXACT: 'exact-item',
  VENUE: 'verified-venue',
  CONTEXTUAL: 'contextual',
  AURORA: 'aurora',
})

export const LEAD_IMAGE_CODES = Object.freeze({
  ITEM_INVALID: 'LEAD_IMAGE_ITEM_INVALID',
  ITEM_ID_MISMATCH: 'LEAD_IMAGE_ITEM_ID_MISMATCH',
})

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function itemId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function aurora(event, selection, reasons = selection.reasons) {
  return {
    ...event,
    image: null,
    imageCredit: null,
    imageCandidate: null,
    imageEvidence: Object.freeze({ verified: false, role: LEAD_IMAGE_ROLES.AURORA }),
    _imageRole: LEAD_IMAGE_ROLES.AURORA,
    _imageSelection: Object.freeze({
      state: 'fallback',
      role: LEAD_IMAGE_ROLES.AURORA,
      delivery: null,
      reasons: Object.freeze([...new Set(reasons)]),
    }),
  }
}

/**
 * Produces the image-safe copy used by the credible first-screen slice.
 *
 * Raw `event.image`, `event.imageCredit`, `event.imageEvidence`, and
 * `event.imageCandidate` never confer trust. Only a receipt in
 * `event.imageCandidates` that validates under an explicit policy may display.
 * Missing policy or evidence intentionally yields the existing Aurora art floor.
 */
export function presentLeadImage(event, { policy } = {}) {
  if (!plainObject(event) || !itemId(event.id)) {
    throw new TypeError(LEAD_IMAGE_CODES.ITEM_INVALID)
  }

  const expectedItemId = itemId(event.id)
  const candidates = Array.isArray(event.imageCandidates) ? event.imageCandidates : []
  const mismatched = candidates.some(candidate => itemId(candidate?.itemId) !== expectedItemId)
  const selection = selectImageCandidate(candidates, { policy })

  if (mismatched) {
    return aurora(event, selection, [LEAD_IMAGE_CODES.ITEM_ID_MISMATCH, ...selection.reasons])
  }

  if (selection.state !== 'selected' || !DISPLAY_ROLES.has(selection.role)) {
    return aurora(event, selection)
  }

  const candidate = selection.candidate
  const imageCredit = Object.freeze({
    attribution: candidate.attribution,
    author: candidate.author,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    url: candidate.sourcePage,
    role: candidate.role,
    retrievedAt: candidate.retrievedAt,
  })
  const validatedCandidate = Object.freeze({
    state: 'ready',
    role: candidate.role,
    candidate: Object.freeze({ ...candidate }),
  })

  return {
    ...event,
    image: candidate.image,
    imageCredit,
    imageCandidate: validatedCandidate,
    imageEvidence: Object.freeze({
      verified: true,
      role: candidate.role,
      delivery: candidate.delivery,
      sourcePage: candidate.sourcePage,
    }),
    _imageRole: candidate.role,
    _imageSelection: Object.freeze({
      state: 'selected',
      role: candidate.role,
      delivery: candidate.delivery,
      reasons: Object.freeze([]),
    }),
  }
}
