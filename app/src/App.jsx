import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

// Per-city hero art is a future, multi-city feature; hardcoded to Tampa for now.
const CITY = {
  name: 'Tampa Bay',
  hero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/1920px-Tampa_Skyline_-_Eric_Statzer.jpg',
}
const VIEWS = ['list', 'map', 'calendar']

// --- formatting helpers ---
function dayKey(iso) {
  const d = new Date(iso)
  return isNaN(d) ? 'Date TBD' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
function timeOf(iso) {
  if (!iso || !/T\d/.test(iso)) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function priceLabel(e) {
  if (e.isFree === true) return 'Free'
  if (e.price > 0) return '$' + e.price
  return null
}
// deterministic gradient for events without an image (keeps the UI colorful)
function gradFor(s) {
  let h = 0
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `linear-gradient(135deg, hsl(${h} 68% 52%), hsl(${(h + 45) % 360} 72% 42%))`
}

const Icon = {
  list: (p) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
  ),
  map: (p) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Zm0 0v15m6-12v15" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" /></svg>
  ),
  calendar: (p) => (
    <svg viewBox="0 0 24 24" {...p}><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.1" /><path d="M3 9.5h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>
  ),
}

function PriceChip({ e }) {
  const label = priceLabel(e)
  if (!label) return null
  return <span className={'chip' + (e.isFree === true ? ' chip-free' : '')}>{label}</span>
}

function Thumb({ e, className }) {
  if (e.image) return <div className={className} style={{ backgroundImage: `url(${e.image})` }} />
  return (
    <div className={className + ' thumb-fallback'} style={{ background: gradFor(e.title) }}>
      <span>{timeOf(e.start) || '★'}</span>
    </div>
  )
}

function EventCard({ e, onClick, index = 0 }) {
  return (
    <button className="card" style={{ animationDelay: Math.min(index, 12) * 22 + 'ms' }} onClick={onClick}>
      <Thumb e={e} className="card-thumb" />
      <div className="card-main">
        <div className="card-title">{e.title}</div>
        <div className="card-meta">{[timeOf(e.start), e.venue].filter(Boolean).join(' · ') || 'Tap for details'}</div>
      </div>
      <PriceChip e={e} />
    </button>
  )
}

function DayGroups({ groups, onSelect }) {
  if (!groups.length) return <div className="empty">No upcoming events found.<br />Re-run the finder to refresh.</div>
  return groups.map(([day, evs]) => (
    <section key={day} className="day-group">
      <h3 className="day-header">{day}</h3>
      {evs.map((e, i) => (
        <EventCard key={(e.url || e.title) + i} e={e} index={i} onClick={() => onSelect(e)} />
      ))}
    </section>
  ))
}

function ListView({ events, groups, onSelect }) {
  return (
    <div className="list-scroll">
      <header className="hero">
        <div className="hero-img" style={{ backgroundImage: `url(${CITY.hero})` }} />
        <div className="hero-grad" />
        <div className="hero-text">
          <div className="hero-kicker">WHAT'S ON · THIS WEEK</div>
          <h1 className="hero-city">{CITY.name}</h1>
          <div className="hero-sub">{events.length} events near you</div>
        </div>
      </header>
      <div className="list-body">
        <DayGroups groups={groups} onSelect={onSelect} />
      </div>
    </div>
  )
}

function railLabel(iso) {
  const d = new Date(iso)
  return isNaN(d)
    ? { dow: '', dnum: '' }
    : { dow: d.toLocaleDateString('en-US', { weekday: 'short' }), dnum: d.toLocaleDateString('en-US', { day: 'numeric' }) }
}

function CalendarView({ groups, onSelect }) {
  const [sel, setSel] = useState(0)
  const idx = Math.min(sel, Math.max(groups.length - 1, 0))
  const current = groups[idx]
  return (
    <div className="cal-wrap">
      <div className="cal-top">
        <h2 className="cal-title">Calendar</h2>
        <div className="date-rail">
          {groups.map(([d, list], i) => {
            const { dow, dnum } = railLabel(list[0].start)
            return (
              <button key={d} className={'date-pill' + (i === idx ? ' active' : '')} onClick={() => setSel(i)}>
                <span className="dp-dow">{dow}</span>
                <span className="dp-num">{dnum}</span>
                <span className="dp-count">{list.length}</span>
              </button>
            )
          })}
        </div>
      </div>
      {current ? (
        <>
          <h3 className="day-header cal-day">{current[0]}</h3>
          <div className="cal-list">
            {current[1].map((e, i) => (
              <EventCard key={(e.url || e.title) + i} e={e} index={i} onClick={() => onSelect(e)} />
            ))}
          </div>
        </>
      ) : (
        <div className="empty">No upcoming events found.</div>
      )}
    </div>
  )
}

function MapView({ events, onSelect, active }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const withCoords = useMemo(() => events.filter((e) => e.lat != null && e.lng != null), [events])
  // create the map exactly once
  useEffect(() => {
    if (mapRef.current || !elRef.current) return
    const map = L.map(elRef.current, { zoomControl: false }).setView([27.95, -82.46], 10)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap © CARTO',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
  }, [])
  // (re)draw markers whenever the data arrives or changes
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const markers = []
    for (const e of withCoords) {
      const m = L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: '#ff5a3c', fillOpacity: 1 })
      m.on('click', () => onSelect(e))
      m.bindTooltip(e.title, { direction: 'top', offset: [0, -6] })
      m.addTo(layer)
      markers.push(m)
    }
    if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
  }, [withCoords, onSelect])
  useEffect(() => {
    if (active && mapRef.current) setTimeout(() => mapRef.current.invalidateSize(), 80)
  }, [active])
  return (
    <div className="map-wrap">
      <div ref={elRef} className="map" />
      <div className="map-note">{withCoords.length} of {events.length} events on the map</div>
    </div>
  )
}

function DetailPage({ e, closing, onClose }) {
  const day = dayKey(e.start)
  const time = timeOf(e.start)
  return (
    <div className={'detail' + (closing ? ' detail-closing' : '')}>
      <div className="detail-hero" style={e.image ? { backgroundImage: `url(${e.image})` } : { background: gradFor(e.title) }}>
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
        <div className="detail-rows">
          <div className="d-row"><span className="d-ic">📅</span><div><div className="d-k">When</div><div className="d-v">{day}{time ? ` · ${time}` : ''}</div></div></div>
          {e.venue && <div className="d-row"><span className="d-ic">📍</span><div><div className="d-k">Where</div><div className="d-v">{e.venue}{e.address ? `, ${e.address}` : ''}</div></div></div>}
          <div className="d-row"><span className="d-ic">🎟️</span><div><div className="d-k">Price</div><div className="d-v">{priceLabel(e) || 'See event for pricing'}</div></div></div>
          <div className="d-row"><span className="d-ic">🔎</span><div><div className="d-k">Found via</div><div className="d-v">{e.source}</div></div></div>
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

function TabBar({ active, onTab }) {
  return (
    <nav className="tabbar">
      {VIEWS.map((v, i) => {
        const I = Icon[v]
        return (
          <button key={v} className={'tab' + (active === i ? ' active' : '')} onClick={() => onTab(i)}>
            <I className="tab-ic" width="24" height="24" />
            <span className="tab-label">{v[0].toUpperCase() + v.slice(1)}</span>
          </button>
        )
      })}
    </nav>
  )
}

export default function App() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(0)
  const [detail, setDetail] = useState(null)
  const [closing, setClosing] = useState(false)
  const pagerRef = useRef(null)

  useEffect(() => {
    fetch('/events.json')
      .then((r) => r.json())
      .then((d) => setEvents(Array.isArray(d) ? d : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])

  const groups = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      const k = dayKey(e.start)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(e)
    }
    return [...m.entries()]
  }, [events])

  const goTo = (i) => {
    setActive(i) // optimistic — snappy tab highlight even before the scroll settles
    const p = pagerRef.current
    if (p) p.scrollLeft = i * p.clientWidth // CSS scroll-behavior handles the smoothing
  }
  const onScroll = () => {
    const p = pagerRef.current
    if (!p) return
    const i = Math.round(p.scrollLeft / p.clientWidth)
    if (i !== active) setActive(i)
  }

  const openDetail = (e) => { setClosing(false); setDetail(e) }
  const closeDetail = () => {
    setClosing(true)
    setTimeout(() => { setDetail(null); setClosing(false) }, 240)
  }

  return (
    <div className="app">
      <div className="pager" ref={pagerRef} onScroll={onScroll}>
        <section className="page"><ListView events={events} groups={groups} onSelect={openDetail} /></section>
        <section className="page page-map"><MapView events={events} onSelect={openDetail} active={active === 1} /></section>
        <section className="page"><CalendarView groups={groups} onSelect={openDetail} /></section>
      </div>
      <TabBar active={active} onTab={goTo} />
      {detail && <DetailPage e={detail} closing={closing} onClose={closeDetail} />}
      {loading && <div className="boot">Loading {CITY.name}…</div>}
    </div>
  )
}
