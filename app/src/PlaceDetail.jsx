// PlaceDetail — full-page place detail (Sprint S2), the place-side twin of
// DetailPage. Reuses the detail chrome (hero morph, back, ♥ save, lazy
// mini-map, share, directions) but speaks PLACE semantics instead of event
// ones: no when/tickets/ICS — instead amenities, hours, free/fee, an honest
// weather-fit line, sources, and the place→plan bridge ("Make this my plan").
//
// Opened through the SHARED detail layer (nav.openDetail records the taste +
// recents signal generically via keyOf/category); App renders THIS component
// when detail.kind === 'place'. The hero owns the 'evt-hero' viewTransitionName
// so the card→detail morph works exactly as it does for events.
//
// ALL COPY IS DRAFT for Charles.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getLeaflet } from './leaflet-lazy.js'
import { useNav } from './nav.jsx'
import { keyOf } from './lib.js'
import { CATEGORY_EMOJI, SecHead, TonightCard, hueFor } from './cards.jsx'
import { SaveHeart } from './saves.js'
import { dateKey } from './weather.js'
import { usePlaces } from './places.js'
import { loadDayPlans, saveDayPlans, withSlot, dayEntryFor } from './dayplan.js'
import './locations.css'

// normalized amenity vocabulary → human label + emoji (DRAFT for Charles).
// Unknown amenities fall back to a title-cased version of the slug, so a new
// pipeline amenity never renders as a raw token.
const AMENITY_LABELS = {
  'dog-park': ['🐕', 'Dog park'],
  'dog-beach': ['🐕', 'Dog beach'],
  'dogs-allowed': ['🐕', 'Dogs allowed'],
  beach: ['🏖️', 'Beach'],
  hiking: ['🥾', 'Hiking'],
  swimming: ['🏊', 'Swimming'],
  boating: ['⛵', 'Boating'],
  fishing: ['🎣', 'Fishing'],
  'boat-ramp': ['🚤', 'Boat ramp'],
  'canoe-launch': ['🛶', 'Canoe / kayak launch'],
  restrooms: ['🚻', 'Restrooms'],
  playground: ['🛝', 'Playground'],
  ada: ['♿', 'Accessible'],
  tennis: ['🎾', 'Tennis'],
  pickleball: ['🏓', 'Pickleball'],
  basketball: ['🏀', 'Basketball'],
  volleyball: ['🏐', 'Volleyball'],
  racquetball: ['🎾', 'Racquetball'],
  'disc-golf': ['🥏', 'Disc golf'],
  shuffleboard: ['🥌', 'Shuffleboard'],
  'skate-park': ['🛹', 'Skate park'],
  trails: ['🥾', 'Trails'],
  'nature-trails': ['🌿', 'Nature trails'],
  pier: ['🎣', 'Pier'],
  marina: ['⚓', 'Marina'],
  pool: ['🏊', 'Pool'],
  'splash-pad': ['💦', 'Splash pad'],
  grills: ['🔥', 'Grills'],
  shelters: ['⛱️', 'Picnic shelters'],
  picnic: ['🧺', 'Picnic area'],
  golf: ['⛳', 'Golf'],
  gym: ['🏋️', 'Gym'],
  fitness: ['🏋️', 'Fitness'],
  camping: ['🏕️', 'Camping'],
  'community-center': ['🏛️', 'Community center'],
  concessions: ['🍿', 'Concessions'],
  bandshell: ['🎶', 'Bandshell'],
  baseball: ['⚾', 'Ball fields'],
  'autism-friendly': ['🧩', 'Autism-friendly'],
}
const amenityChip = (a) => AMENITY_LABELS[a] || ['•', a.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())]

const wdLong = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })

// upcoming days for the Make-this-my-plan picker: today + the next 13 days
// (two weeks of horizon — the same supply window the day screen plans into).
function planDays(anchors) {
  const out = []
  const d0 = new Date(anchors.todayTs)
  for (let i = 0; i < 14; i++) {
    const ts = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime()
    out.push({ ts, label: ts === anchors.todayTs ? 'Today' : ts === anchors.tomorrowTs ? 'Tomorrow' : wdLong(ts) })
  }
  return out
}

export default function PlaceDetail({ e, anchors, wx }) {
  const { closing, vtOpen: vt, closeDetail: onClose, openDetail: onSelect, focusMap: onFocusMap } = useNav()
  const { places } = usePlaces()

  // W4: a place with a REAL Wikidata photo gets an image hero (preload + 300ms
  // fade over a dark placeholder, DetailPage's exact pattern); places without a
  // photo keep the category-art hero. e.image is only ever a verified photo OF
  // THIS place (Wikidata P18 → Commons), never a representative stand-in.
  const [loadedSrc, setLoadedSrc] = useState(null)
  const [heroFailed, setHeroFailed] = useState(false)
  useEffect(() => {
    if (!e.image) return
    const src = e.image
    const img = new Image()
    img.onload = () => setLoadedSrc(src)
    img.onerror = () => setHeroFailed(true) // dead URL → fall back to category-art
    img.src = src
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [e.image])
  const imgOk = loadedSrc === e.image
  // a real photo that loads → image hero; no photo OR a broken URL → art hero
  const heroArt = !e.image || heroFailed

  const hasCoords = e.lat != null && e.lng != null
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
    : e.name
      ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([e.name, e.address].filter(Boolean).join(', '))
      : null

  const free = e.isFree === true
  const feeLine = free ? 'Free' : e.fee ? e.fee : null

  // weather-fit (S2): honest, derived only from the real 16-day forecast.
  // For an outdoor place, find the soonest CLEAR/PARTLY day in the next week
  // and name it ("Great park day Saturday"). Omitted entirely when no forecast
  // or no good day — never invented.
  const wxFit = useMemo(() => {
    if (!wx) return null
    const outdoorish = ['outdoors'].includes(e.category) || ['park', 'beach', 'preserve', 'trail', 'viewpoint', 'pier', 'dog_park', 'garden'].includes(e.placeType)
    if (!outdoorish) return null
    const noun = e.placeType === 'beach' ? 'beach' : e.placeType === 'trail' || e.placeType === 'preserve' ? 'trail' : 'park'
    const d0 = new Date(anchors.todayTs)
    for (let i = 0; i < 7; i++) {
      const ts = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime()
      const w = wx[dateKey(ts)]
      if (w && (w.emoji === '☀️' || w.emoji === '⛅') && (w.rain == null || w.rain < 40)) {
        const when = ts === anchors.todayTs ? 'today' : ts === anchors.tomorrowTs ? 'tomorrow' : wdLong(ts)
        const hi = w.hi != null ? `, ${w.hi}°` : ''
        return `${w.emoji} Great ${noun} day ${when}${hi}`
      }
    }
    return null
  }, [wx, anchors, e.category, e.placeType])

  // mini-map: lazy non-interactive Leaflet, destroyed on unmount (DetailPage's
  // exact pattern — the shared lazy loader keeps Leaflet out of the boot chunk)
  const mapElRef = useRef(null)
  useEffect(() => {
    const el = mapElRef.current
    if (e.lat == null || e.lng == null || !el) return
    let cancelled = false
    let m = null
    let t = null
    getLeaflet().then((L) => {
      if (cancelled || !el.isConnected) return
      m = L.map(el, {
        zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
        touchZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
      }).setView([e.lat, e.lng], 14)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(m)
      L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: '#0d9488', fillOpacity: 1, interactive: false }).addTo(m)
      t = setTimeout(() => m.invalidateSize(), 280)
    })
    return () => {
      cancelled = true
      clearTimeout(t)
      if (m) m.remove()
    }
  }, [e.lat, e.lng])

  // "More spots like this" — same placeType, nearest by simple coord delta,
  // up to 4 (places only; never crosses into events)
  const similar = useMemo(() => {
    if (!Array.isArray(places)) return []
    const self = e.key
    return places
      .filter((p) => p.key !== self && p.placeType === e.placeType)
      .map((p) => ({ p, d: hasCoords && p.lat != null ? Math.hypot(p.lat - e.lat, p.lng - e.lng) : Infinity }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.p)
  }, [places, e, hasCoords])

  // ===== utility row: directions / share-or-copy + toast =====
  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1600)
  }
  const share = async () => {
    const text = [e.name, e.venue, e.hours].filter(Boolean).join(' · ')
    if (navigator.share) {
      try {
        await navigator.share(e.url ? { title: e.name, text: e.name, url: e.url } : { title: e.name, text })
      } catch {
        /* dismissed — not an error */
      }
    } else if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(e.url || text)
        flash('Details copied ✓')
      } catch {
        flash("Couldn't copy")
      }
    } else {
      flash("Sharing isn't available here")
    }
  }

  // ===== Make this my plan — the place→day-plan bridge (S2). A sheet picks a
  // day + daypart; on pick we write the place KEY into that day's slot via the
  // dayplan.js seams (withSlot clears any rest mark). NEVER CLOBBERS: a filled
  // slot is shown taken and is not overwritable. =====
  const [planning, setPlanning] = useState(false)
  const [planDay, setPlanDay] = useState(anchors.todayTs)
  const [plansVersion, setPlansVersion] = useState(0) // bump to re-read filled state after a write
  const days = useMemo(() => planDays(anchors), [anchors])
  const filled = useMemo(() => {
    // read the current entry for the selected day to disable taken slots
    void plansVersion
    const map = loadDayPlans(anchors)
    const entry = dayEntryFor(map[String(planDay)])
    return { day: entry?.slots.day || null, night: entry?.slots.night || null, rest: entry?.state === 'rest' }
  }, [planDay, anchors, plansVersion])

  const addToPlan = (part) => {
    const map = loadDayPlans(anchors)
    const entry = dayEntryFor(map[String(planDay)])
    if (entry && entry.slots[part]) return // never clobber a filled slot
    saveDayPlans(withSlot(map, planDay, part, e.key))
    setPlansVersion((v) => v + 1)
    const dlabel = days.find((d) => d.ts === planDay)?.label || ''
    flash(`Added to ${dlabel} ${part === 'day' ? '☀️' : '🌙'} ✓`)
    setPlanning(false)
  }

  return (
    <div className={'detail' + (closing ? ' detail-closing' : '') + (vt ? ' detail-vt' : '')}>
      <div
        className={'detail-hero' + (heroArt ? ' imgbox-art' : '')}
        style={
          heroArt
            ? { viewTransitionName: 'evt-hero', '--ch': hueFor(e) }
            : { viewTransitionName: 'evt-hero', background: '#1d212a' }
        }
      >
        {!heroArt ? (
          <div className={'detail-hero-img' + (imgOk ? ' on' : '')} style={{ backgroundImage: `url(${e.image})` }} />
        ) : (
          <span className="imgbox-mark" aria-hidden>
            {CATEGORY_EMOJI[e.category] ?? CATEGORY_EMOJI.other}
          </span>
        )}
        <button className="detail-back" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <SaveHeart e={e} big />
        <div className="detail-hero-grad" />
        <div className="detail-hero-text">
          {free && <span className="chip detail-chip chip-free">Free</span>}
          <span className="chip detail-chip detail-catchip" style={{ '--ch': hueFor(e) }}>
            {CATEGORY_EMOJI[e.category] ?? '⭐'} {e.placeType?.replace(/_/g, ' ') || 'spot'}
          </span>
          <h1 className="detail-title">{e.name}</h1>
        </div>
      </div>

      <div className="detail-body">
        {/* Make this my plan — the headline place action (the place→plan bridge) */}
        <button className="loc-plan-cta" onClick={() => setPlanning(true)}>
          ＋ Make this my plan
        </button>

        <div className="detail-rows">
          {e.venue && (
            <a className="d-row" href={mapsUrl} target="_blank" rel="noreferrer">
              <span className="d-ic">📍</span>
              <div>
                <div className="d-k">Where</div>
                <div className="d-v">{e.venue}<span className="d-ext">↗</span></div>
              </div>
            </a>
          )}
          {e.hours && (
            <div className="d-row"><span className="d-ic">🕑</span><div><div className="d-k">Hours</div><div className="d-v">{e.hours}</div></div></div>
          )}
          {feeLine && (
            <div className="d-row"><span className="d-ic">🎟️</span><div><div className="d-k">Entry</div><div className="d-v">{feeLine}</div></div></div>
          )}
          {wxFit && (
            <div className="d-row"><span className="d-ic">{wxFit.slice(0, 2)}</span><div><div className="d-k">Weather</div><div className="d-v">{wxFit.slice(2).trim()}</div></div></div>
          )}
        </div>

        {e.amenities.length > 0 && (
          <div className="loc-amen">
            <div className="d-k">What's here</div>
            <div className="loc-amen-chips">
              {e.amenities.map((a) => {
                const [ic, label] = amenityChip(a)
                return (
                  <span className="loc-amen-chip" key={a}>
                    <span aria-hidden>{ic}</span> {label}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {hasCoords && (
          <div className="mini-map">
            <div className="mini-map-canvas" ref={mapElRef} />
            <button className="mini-map-tap" onClick={() => onFocusMap(e)} aria-label="Open in the Map tab">
              <span className="mini-map-hint">Open in Map ↗</span>
            </button>
          </div>
        )}

        {e.description && (
          <div className="detail-about">
            <div className="d-k">About</div>
            <p className="detail-desc">{e.description}</p>
          </div>
        )}

        <div className="util-row">
          {mapsUrl && (
            <a className="util-btn" href={mapsUrl} target="_blank" rel="noreferrer">🧭 Directions</a>
          )}
          <button className="util-btn" onClick={share}>🔗 Share</button>
        </div>

        {similar.length > 0 && (
          <div className="detail-rail">
            <SecHead overline="Around the bay" title="More spots like this" />
            <div className="carousel">
              {similar.map((p) => (
                <TonightCard key={keyOf(p)} e={p} onSelect={(e2) => onSelect(e2, null)} />
              ))}
            </div>
          </div>
        )}

        {/* provenance footer — never hidden, just quiet (X3 attribution feeds off this) */}
        {e.sources.length > 0 && <div className="detail-via">Sourced from {e.sources.join(' · ')}</div>}
      </div>

      {/* Make-this-my-plan sheet */}
      {planning && (
        <div className="loc-plan-wrap">
          <button className="loc-scrim" onClick={() => setPlanning(false)} aria-label="Close" />
          <div className="loc-plan-sheet" role="dialog" aria-label="Add to a day">
            <div className="loc-sheet-head">
              <div className="loc-sheet-title">Add {e.name} to a day</div>
              <button className="loc-sheet-close" onClick={() => setPlanning(false)} aria-label="Close">✕</button>
            </div>
            <div className="loc-plan-days">
              {days.map((d) => (
                <button
                  key={d.ts}
                  className={'loc-plan-day' + (d.ts === planDay ? ' on' : '')}
                  onClick={() => setPlanDay(d.ts)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {filled.rest ? (
              <div className="loc-note">That's a quiet day 🌙 — clear the rest mark on the day screen to plan it.</div>
            ) : (
              <div className="loc-plan-slots">
                {['day', 'night'].map((part) => (
                  <button
                    key={part}
                    className="loc-plan-slot"
                    disabled={!!filled[part]}
                    onClick={() => addToPlan(part)}
                  >
                    <span className="loc-plan-slot-ic">{part === 'day' ? '☀️' : '🌙'}</span>
                    <span className="loc-plan-slot-label">{part === 'day' ? 'Daytime' : 'Night'}</span>
                    {filled[part] && <span className="loc-plan-slot-taken">taken</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="detail-toast">{toast}</div>}
    </div>
  )
}
