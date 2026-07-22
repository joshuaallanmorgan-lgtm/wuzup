// Immutable preimage bindings for the Sprint 10 reviewed-image correction.
//
// The editorial decisions live in each city config. This file binds the one-time
// correction writer to the exact artifact and local bytes inspected on 2026-07-21,
// so it cannot strip a later replacement or relabel a different artifact.

export const S10_IMAGE_REVIEW_REPORT_SHA256 =
  'sha256:4bee54bf0847f6de7a06443ffdf513055abfd85d0f2d6a67110f928518958830'

const BATCHES = {
  'tampa-bay': {
    schemaVersion: 1,
    auditDocument: 'planning/v2/S10_IMAGE_AUDIT_2026-07-21.md',
    auditReportSha256: S10_IMAGE_REVIEW_REPORT_SHA256,
    expectedPreimage: {
      manifestId: 'sha256:035cb1eed7e67d143c4b0739d8dd3c2373bd3af2e85562aad0fc4895651615b1',
      buildId: 'sha256:65a75e81823893d24051e99387364d1b1ab450be748f6dc58cc58c14d61d5381',
      placesSha256: '749eed658f2df7c8f9d175391ba06518c7b88168f4e27afab0a63ff647e3a57b',
    },
    expectedRemoved: {
      attributionEntries: [
        'File:CassiaFistula02 PalmaSola Asit.jpg',
        'File:Colt Creek SP road01.jpg',
        'File:Curtis Hixon Park Tampa Florida United States - panoramio (1).jpg',
        'File:Edward Medard Park Lake July 2024.jpg',
        'File:Fort Hamer Bridge.jpg',
        'File:Morris Bridge Summer Day (9433839633).jpg',
        'File:Sunset Beach, Tarpon Springs, United States (Unsplash).jpg',
        'File:Ybor City (8061548385).jpg',
        'Mapillary:1342952362741418',
        'Mapillary:484893932562446',
        'Mapillary:522934939993817',
        'Mapillary:650653606780814',
        'Mapillary:974016848499650',
      ],
    },
    localImages: {
      'p|tenth-street-coffee': {
        image: '/place-img/tenth-street-coffee.jpg',
        mapillaryId: '650653606780814',
        bytes: 42337,
        sha256: 'e85b2422d9b8e9cf997ec8492d181521e331edbae6878dc56f32d1868e4b64a5',
      },
      'p|banyan-coffee-co': {
        image: '/place-img/banyan-coffee-co.jpg',
        mapillaryId: '522934939993817',
        bytes: 47900,
        sha256: '8619db7d532cb30e6afaf547d0425922dc81b1f6814b2df751be6009e633f6bd',
      },
      'p|beangood-coffee': {
        image: '/place-img/beangood-coffee.jpg',
        mapillaryId: '974016848499650',
        bytes: 50537,
        sha256: 'e4edbae7e7013f3533cb0eafb778a4a5862f5644cd4405ac973551f234502d8f',
      },
      'p|foundation-coffee-company': {
        image: '/place-img/foundation-coffee-company.jpg',
        mapillaryId: '484893932562446',
        bytes: 36583,
        sha256: '220e9679cbc8599e2cb849377e9f3b45e94caaf53e2ec36f985781e37cf68bec',
      },
      'p|indian-shores-coffee': {
        image: '/place-img/indian-shores-coffee.jpg',
        mapillaryId: '1342952362741418',
        bytes: 54401,
        sha256: '2e413cda8c75b069942a9df8cea092efb6d8a34b73977295c443f7262b13dde9',
      },
    },
  },
  'sf-east-bay': {
    schemaVersion: 1,
    auditDocument: 'planning/v2/S10_IMAGE_AUDIT_2026-07-21.md',
    auditReportSha256: S10_IMAGE_REVIEW_REPORT_SHA256,
    expectedPreimage: {
      manifestId: 'sha256:64bb1151dc6ab947689ac5fa661b563ce5951c7c1098a7c1733884ddccccddf9',
      buildId: 'sha256:7b025d648b008ee914eefbc0df65cc20b2ec783d405db8958779eb11ce35a0d7',
      placesSha256: '3266d7bd41c784fb2a87295a17498c7a6194ea93ba2b37555bdb713c89774646',
    },
    expectedRemoved: {
      attributionEntries: [
        'File:Candlestick Point Park5.jpg',
        'File:Chabot Park, San Leandro, California, US.jpg',
        'File:Coit Tower 2021.jpg',
        'File:DinoHillPano2731x505.jpg',
        'File:Don Guillermo Castro (cropped).jpg',
        'File:Euc presidio.jpg',
        'File:Ocean and waves (Unsplash).jpg',
        'File:Sutro Heights Park - panoramio.jpg',
      ],
    },
    localImages: {},
  },
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export const S10_IMAGE_REJECTION_BATCHES = deepFreeze(BATCHES)

export function s10ImageRejectionBatchFor(cityId) {
  const batch = S10_IMAGE_REJECTION_BATCHES[cityId]
  if (!batch) throw new Error(`No Sprint 10 image-rejection batch exists for '${cityId}'`)
  return batch
}
