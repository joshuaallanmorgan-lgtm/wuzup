// DetailPage — full-page event detail (z 2000, above tabbar/subpages/Leaflet).
// View Transitions open/close logic lives in App.jsx; detail styles in App.css.
import { useEffect, useState } from 'react'
import { dayKey, gradFor, priceLabel, timeOf } from './lib.js'

export default function DetailPage({ e, closing, vt, onClose }) {
  const day = dayKey(e.start) || 'Date TBD'
  const time = timeOf(e.start)
  const endDay = e.end ? dayKey(e.end) : null
  const when = e._ongoing ? 'Ongoing' + (endDay ? ` · through ${endDay}` : '') : day + (time ? ` · ${time}` : '')
  const via = e.sources && e.sources.length ? e.sources.join(' · ') : e.source
  // detail hero image: preload + 300ms fade over the dark placeholder.
  // Loaded state is keyed to the src, so a new event never flashes the old image.
  const [loadedSrc, setLoadedSrc] = useState(null)
  useEffect(() => {
    if (!e.image) return
    const src = e.image
    const img = new Image()
    img.onload = () => setLoadedSrc(src)
    img.src = src
    return () => {
      img.onload = null
    }
  }, [e.image])
  const imgOk = loadedSrc === e.image
  return (
    <div className={'detail' + (closing ? ' detail-closing' : '') + (vt ? ' detail-vt' : '')}>
      <div
        className="detail-hero"
        style={{ viewTransitionName: 'evt-hero', background: e.image ? '#1d212a' : gradFor(e.title) }}
      >
        {e.image && (
          <div className={'detail-hero-img' + (imgOk ? ' on' : '')} style={{ backgroundImage: `url(${e.image})` }} />
        )}
        <button className="detail-back" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="detail-hero-grad" />
        <div className="detail-hero-text">
          {priceLabel(e) && <span className={'chip detail-chip' + (e.isFree === true ? ' chip-free' : '')}>{priceLabel(e)}</span>}
          <h1 className="detail-title">{e.title}</h1>
        </div>
      </div>
      <div className="detail-body">
        {e.sponsored === true && <div className="sp-label detail-sp">Sponsored</div>}
        <div className="detail-rows">
          <div className="d-row"><span className="d-ic">📅</span><div><div className="d-k">When</div><div className="d-v">{when}</div></div></div>
          {e.venue && <div className="d-row"><span className="d-ic">📍</span><div><div className="d-k">Where</div><div className="d-v">{e.venue}{e.address ? `, ${e.address}` : ''}</div></div></div>}
          <div className="d-row"><span className="d-ic">🎟️</span><div><div className="d-k">Price</div><div className="d-v">{priceLabel(e) || 'See event for pricing'}</div></div></div>
          {via && <div className="d-row"><span className="d-ic">🔎</span><div><div className="d-k">Found via</div><div className="d-v">{via}</div></div></div>}
        </div>
        {e.description && <p className="detail-desc">{e.description}</p>}
      </div>
      {e.url && (
        <a className="detail-cta" href={e.url} target="_blank" rel="noreferrer">
          Get Tickets <span className="cta-arr">→</span>
        </a>
      )}
    </div>
  )
}
