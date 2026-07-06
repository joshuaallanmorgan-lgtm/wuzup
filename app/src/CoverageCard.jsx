// CoverageCard — D-G1 (Stage D graft, V2 adjudication ruling #6 / V2_VISION
// §8.6): the small honest "what we know here" surface. One compact card —
// N events · M sources · updated <day> · imagery coverage — every number
// DERIVED at render time (coverage.js) from data the app already loads, the
// attribution page's anti-drift contract. Two placements share this component:
//
//   · Home, as the colophon under the last section (compact form) — and, for
//     a sparse week-one city (events < SPARSE_EVENTS_FLOOR), PROMOTED near the
//     top of Home with one extra honest sentence. HomeView owns that decision
//     (isSparse) and passes `promoted`; the promotion is the honest floor for
//     a new city — never fake density, say what we actually have.
//   · The attribution page, as its summary header (the sections below break
//     the same numbers down).
//
// Honesty rails: counts real, never inflated; "updated" renders ONLY when the
// boot fetch carried a Last-Modified stamp (absent header = no claim, the
// stale-banner grace); the spots/photos line renders ONLY once the places
// layer is loaded — usePlaces(false) subscribes without ever triggering the
// ~1.2MB fetch (Home must not pay it at boot; the attribution page already
// pays it for its own sections); zero loaded events = render nothing (the
// loading/empty states own that story — a failed fetch is not a sparse city).
// ALL COPY IS DRAFT ⚑ Charles.
import { useMemo } from 'react'
import { CITY, fmtLocale } from './lib.js'
import { coverageStats, dayStamp, photoStats } from './coverage.js'
import { usePlaces } from './places.js'
import './coverage.css'

const fmtN = (n) => n.toLocaleString(fmtLocale)

export default function CoverageCard({ events, dataAt, promoted = false }) {
  const stats = useMemo(() => coverageStats(events), [events])
  // subscribe-only: speak the places layer when another surface loaded it
  const { places, status } = usePlaces(false)
  const ph = useMemo(() => (status === 'ready' ? photoStats(places) : null), [places, status])
  if (stats.events === 0) return null
  return (
    <div className="cov">
      <div className="cov-over">What we know</div>
      {promoted && (
        <div className="cov-new">
          We’re new to {CITY.shortName} — <span className="num">{fmtN(stats.events)}</span> event
          {stats.events === 1 ? '' : 's'} and growing.
        </div>
      )}
      <div className="cov-line">
        <span className="num">{fmtN(stats.events)}</span> event{stats.events === 1 ? '' : 's'} from{' '}
        <span className="num">{fmtN(stats.sources)}</span> local source{stats.sources === 1 ? '' : 's'}
        {dataAt != null && <span className="cov-dim"> · updated {dayStamp(dataAt)}</span>}
      </div>
      {ph && (
        <div className="cov-line">
          <span className="num">{fmtN(ph.spots)}</span> spots · <span className="num">{fmtN(ph.photos)}</span> with
          real photos
        </div>
      )}
    </div>
  )
}
