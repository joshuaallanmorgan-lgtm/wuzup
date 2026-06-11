// MapView — Leaflet map of upcoming events with coordinates. Base map chrome
// (.map-wrap/.map/.map-note) lives in App.css; Sprint-J additions (cluster
// bubbles, pin-preview sheet) live in map.css. The map (and its markers) is
// created lazily on the FIRST activation of the Map tab — never at boot — and
// uses canvas rendering for the 1,500+ marker count.
//
// SPRINT J — the map utility pass:
//   J1 pins wear their category hue (CATEGORY_HUES) and scale with heat:
//      base 7px → 9px at buzz>=2 → 11px + a subtle hot ring at buzz>=3.
//   J2 plugin-free clustering at zoom <= 12: events bucket into a 64px
//      WORLD-pixel grid (map.project at the current zoom — viewport-
//      independent, so panning never re-buckets; only zoomend rebuilds,
//      debounced). One teal divIcon bubble per bucket — teal because clusters
//      are NAVIGATION, never heat — sized by log2(count); tap → zoom in 2 on
//      the bucket centroid. O(n) per rebuild: one projection + one Map insert
//      per event, so every event lands in exactly one bucket.
//   J3 pin tap opens the in-page PinSheet (bottom of file) instead of jumping
//      straight to detail; "Full details →" hands off to onSelect(e, null).
//   J4 the map note carries a live "N in view" count of events inside the
//      current bounds (moveend, debounced 150ms).
import { useEffect, useMemo, useRef, useState } from 'react'
import { getLeaflet } from './leaflet-lazy.js'
import { useNav, viewIndex } from './nav.jsx'
import { CATEGORY_HUES, CardImg, HeatBadge, PriceChip, SponsoredTag } from './cards.jsx'
import { SaveHeart } from './saves.js'
import { dayLabelLoose, keyOf, startLabel } from './lib.js'
import './map.css'

// Leaflet arrives via the shared lazy loader (leaflet-lazy.js, audit prep #3):
// the module is fetched on the Map tab's FIRST activation, never in the boot
// chunk. L is set before the map is created; everything below that touches L
// (pinFor / redraw / fitBounds) only runs once the map exists, so L is always
// loaded by then.
let L = null

// J2 thresholds: zoom >= PIN_ZOOM → every event is its own pin; below it,
// grid clusters. CELL is the bucket size in projected px (~a thumb's width).
const PIN_ZOOM = 13
const CELL = 64
// canvas strokes can't resolve CSS variables — literal mirror of --hot
// (index.css). Fills use the comma HSL form for maximum canvas parser safety.
const HOT = '#ff5a3c'
const pinFill = (e) => `hsl(${CATEGORY_HUES[e.category] ?? CATEGORY_HUES.other}, 70%, 45%)`

// O(n) screen-space bucketing (J2): project each event ONCE at the current
// zoom into world-pixel space, floor into CELL-px cells. floor() is a pure
// function of one point → each event contributes to exactly one bucket, and
// two points in one bucket are always < CELL px apart on each axis. Buckets
// accumulate a count + centroid (cluster position and zoom-in target); `one`
// keeps the sole member so count-1 buckets render a real pin, not a "1" badge.
// (Verified by the Sprint-J Node sim: partition + count correctness, zooms 9–14.)
function bucketEvents(list, project) {
  const buckets = new Map()
  for (const e of list) {
    const p = project(e.lat, e.lng)
    const k = Math.floor(p.x / CELL) + ':' + Math.floor(p.y / CELL)
    let b = buckets.get(k)
    if (!b) buckets.set(k, (b = { count: 0, latSum: 0, lngSum: 0, one: e }))
    b.count++
    b.latSum += e.lat
    b.lngSum += e.lng
  }
  return buckets
}

export default function MapView({ events, anchors }) {
  // navigation via useNav (O6): tab activation, detail opener, focus handoff
  const { active: activeIdx, openDetail: onSelect, mapFocus: focusTarget } = useNav()
  const active = activeIdx === viewIndex('map')
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const didFitRef = useRef(false)
  const timersRef = useRef({}) // zoomend/moveend debounce handles
  const [ready, setReady] = useState(false) // map exists (set on first activation)
  const [sheet, setSheet] = useState(null) // J3: event previewed in the bottom sheet
  const [inView, setInView] = useState(null) // J4: count in bounds (null until the map exists)
  // Escape closes the preview sheet before App's listener can act (capture
  // phase + stopPropagation — the same pattern as WeekendBuilder's picker).
  // BUT when a detail page is stacked on top (pin sheet → "Full details"),
  // the visible detail must win: bail out so App's handler closes IT first —
  // otherwise the first Escape silently closes the hidden sheet underneath.
  useEffect(() => {
    if (!sheet) return
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      if (document.querySelector('.detail')) return
      ev.stopPropagation()
      setSheet(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sheet])
  useEffect(() => {
    onSelectRef.current = onSelect // markers read the latest handler from a ref —
  }) // marker redraw must NOT depend on a per-render callback identity
  // pins are for events you can still attend: drop events whose run has ended
  // (undated events stay — they aren't known to be over)
  const upcoming = useMemo(
    () => events.filter((e) => e._day == null || (e._endDay ?? e._day) >= anchors.todayTs),
    [events, anchors]
  )
  const withCoords = useMemo(() => upcoming.filter((e) => e.lat != null && e.lng != null), [upcoming])

  // J1: category-hue pin, heat-scaled. Tap → preview sheet (J3), never a page jump.
  // bubblingMouseEvents:false so a pin tap doesn't ALSO fire the map click that
  // closes the sheet (canvas + svg renderers both bubble path clicks by default).
  const pinFor = (e) => {
    const buzz = typeof e.buzz === 'number' ? e.buzz : 0
    const hot = buzz >= 3
    const m = L.circleMarker([e.lat, e.lng], {
      radius: hot ? 11 : buzz >= 2 ? 9 : 7,
      color: hot ? HOT : '#fff', // hot ring is the ONLY coral on this canvas
      weight: 2.5,
      fillColor: pinFill(e),
      fillOpacity: 1,
      bubblingMouseEvents: false,
    })
    m.on('click', () => setSheet(e))
    m.bindTooltip(e.title + (e.sponsored === true ? ' · Sponsored' : ''), { direction: 'top', offset: [0, -8] })
    return m
  }

  // full marker rebuild: pins at zoom >= PIN_ZOOM, grid clusters below.
  // Defined fresh each render (closes over withCoords), executed only from the
  // data effect + debounced zoomend via redrawRef.
  const redraw = () => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const zoom = map.getZoom()
    if (zoom >= PIN_ZOOM) {
      for (const e of withCoords) layer.addLayer(pinFor(e))
      return
    }
    for (const b of bucketEvents(withCoords, (lat, lng) => map.project([lat, lng], zoom)).values()) {
      if (b.count === 1) {
        layer.addLayer(pinFor(b.one)) // a cluster of one is just a pin
        continue
      }
      const center = [b.latSum / b.count, b.lngSum / b.count]
      const s = Math.round(Math.min(56, 24 + 8 * Math.log2(b.count + 1))) // 2→37px … 50+→56px cap
      const icon = L.divIcon({
        className: 'cl-ico',
        html: `<div class="cl-bubble" role="button" aria-label="${b.count} events — tap to zoom" style="width:${s}px;height:${s}px;font-size:${Math.max(11, Math.round(s * 0.32))}px">${b.count}</div>`,
        iconSize: [s, s], // anchor defaults to the center
      })
      const m = L.marker(center, { icon, bubblingMouseEvents: false })
      // animate:false — UI_SPEC §3 keeps the map un-animated (same call the
      // focus effect makes), and the jump reads as navigation, not motion
      m.on('click', () => map.setView(center, Math.min(map.getZoom() + 2, 19), { animate: false }))
      layer.addLayer(m)
    }
  }
  // J4: count events inside the current bounds (the note renders it live)
  const countInView = () => {
    const map = mapRef.current
    if (!map) return
    const b = map.getBounds()
    let n = 0
    for (const e of withCoords) if (b.contains([e.lat, e.lng])) n++
    setInView(n)
  }
  // map event handlers are bound ONCE at creation — they read the latest
  // closures through refs (same contract as onSelectRef). Declared before the
  // create/data effects so the refs are current within every commit.
  const redrawRef = useRef(redraw)
  const countRef = useRef(countInView)
  const coordsRef = useRef(withCoords)
  useEffect(() => {
    redrawRef.current = redraw
    countRef.current = countInView
    coordsRef.current = withCoords
  })

  // create the map exactly once, on first activation of the tab. Leaflet
  // itself loads lazily here (shared loader): the first activation awaits the
  // chunk, every later pass resolves instantly off the cached promise. The
  // cancelled flag covers unmount-before-resolve; the mapRef/elRef re-checks
  // inside .then() cover a re-run racing an in-flight load (StrictMode's
  // double-invoke included — the second resolve finds mapRef set and bails).
  useEffect(() => {
    if (!active || mapRef.current || !elRef.current) return
    let cancelled = false
    getLeaflet().then((mod) => {
      if (cancelled || mapRef.current || !elRef.current) return
      L = mod
      const map = L.map(elRef.current, { zoomControl: false, preferCanvas: true }).setView([27.95, -82.46], 10)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap © CARTO',
      }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      const t = timersRef.current
      // zoomend → pins↔clusters rebuild (debounced; buckets depend on zoom only)
      map.on('zoomend', () => {
        clearTimeout(t.zoom)
        t.zoom = setTimeout(() => redrawRef.current(), 120)
      })
      // moveend → in-view count ONLY (J4): the bucket grid is world-anchored,
      // so panning never invalidates it. (Leaflet fires moveend after zooms too,
      // which keeps the count fresh on zoom for free.)
      map.on('moveend', () => {
        clearTimeout(t.move)
        t.move = setTimeout(() => countRef.current(), 150)
      })
      map.on('click', () => setSheet(null)) // bare-map tap dismisses the preview
      mapRef.current = map
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [active])
  useEffect(() => {
    const t = timersRef.current
    return () => {
      clearTimeout(t.zoom)
      clearTimeout(t.move)
    }
  }, [])

  // (re)draw markers only when the DATA changes (or the map first exists);
  // fitBounds only on first non-empty data
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !layerRef.current) return
    redrawRef.current()
    countRef.current()
    if (withCoords.length && !didFitRef.current) {
      didFitRef.current = true
      map.fitBounds(L.latLngBounds(withCoords.map((e) => [e.lat, e.lng])).pad(0.2))
    }
  }, [withCoords, ready])
  useEffect(() => {
    if (active && mapRef.current) setTimeout(() => mapRef.current.invalidateSize(), 80)
  }, [active])

  // focus-on-event (detail mini-map tap): pan/zoom straight to the target.
  // Zoom 15 >= PIN_ZOOM, so focus always lands in pin mode (zoomend rebuilds).
  // If the tab was never visited, the create-effect above starts the (lazy)
  // Leaflet load in the same commit nav's focusMap flips `active` together
  // with focusTarget; this effect bails on the null mapRef, then `ready` in
  // the deps re-runs it once the map exists. On that ready-flip pass the
  // marker effect (declared above) runs first — its first-data fitBounds and
  // this setView land in the same effect flush, so the user only ever sees
  // the focused view (didFitRef then suppresses later fit-to-all). The focused
  // event also opens its preview sheet (J3) so the target pin is identified.
  useEffect(() => {
    if (!focusTarget || focusTarget.lat == null || focusTarget.lng == null) return
    const map = mapRef.current
    if (!map) return
    didFitRef.current = true // the focused view IS the view — never fit-to-all over it
    map.setView([focusTarget.lat, focusTarget.lng], 15, { animate: false })
    setSheet(focusTarget.key ? (coordsRef.current.find((e) => keyOf(e) === focusTarget.key) ?? null) : null)
  }, [focusTarget, ready])

  return (
    <div className="map-wrap">
      <div ref={elRef} className="map" />
      {!sheet && (
        <div className="map-note">
          {inView == null
            ? `${withCoords.length.toLocaleString('en-US')} of ${upcoming.length.toLocaleString('en-US')} upcoming events on the map`
            : `${inView.toLocaleString('en-US')} in view · ${withCoords.length.toLocaleString('en-US')}/${upcoming.length.toLocaleString('en-US')} upcoming on the map`}
        </div>
      )}
      {sheet && (
        <PinSheet
          key={keyOf(sheet)} // another pin tapped → the sheet swaps (remount replays the rise)
          e={sheet}
          onClose={() => setSheet(null)}
          onDetail={() => onSelectRef.current(sheet, null)} // null cardEl: slide-up, no VT morph
        />
      )}
    </div>
  )
}

// J3 — compact pin-preview bottom sheet, INSIDE the map page (z 1010: above
// every Leaflet pane, below the fixed tabbar at z 1100). Reuses the shared
// card primitives — CardImg (fallback art included), HeatBadge, PriceChip,
// SponsoredTag, SaveHeart — never forks them. Swipe-down (pointer drag > 60px)
// or ✕ closes; the outer wrapper owns the entrance animation while the inner
// node owns the drag transform, so the two never fight over `transform`.
function PinSheet({ e, onClose, onDetail }) {
  const ref = useRef(null)
  const drag = useRef(null)
  const meta = (e._ongoing ? ['Ongoing', e.venue] : [dayLabelLoose(e), startLabel(e), e.venue])
    .filter(Boolean)
    .join(' · ')
  const down = (ev) => {
    // drags start anywhere except the interactive bits (heart / buttons)
    if (ev.target.closest('.save-btn, .msheet-cta, .msheet-x')) return
    drag.current = { y0: ev.clientY, dy: 0 }
    ref.current.classList.add('dragging')
    ref.current.setPointerCapture?.(ev.pointerId)
  }
  const move = (ev) => {
    const d = drag.current
    if (!d) return
    d.dy = Math.max(0, ev.clientY - d.y0) // downward only
    ref.current.style.transform = `translateY(${d.dy}px)`
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (!ref.current) return
    ref.current.classList.remove('dragging')
    if (d && d.dy > 60) onClose()
    else ref.current.style.transform = '' // not far enough — snap back
  }
  return (
    <div className="msheet-pop">
      <div
        className="msheet"
        ref={ref}
        role="dialog"
        aria-label={e.title}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <span className="msheet-grip" aria-hidden />
        <button className="msheet-x" onClick={onClose} aria-label="Close preview">
          ✕
        </button>
        <div className="msheet-row">
          <CardImg e={e} className="msheet-thumb">
            <SaveHeart e={e} />
          </CardImg>
          <div className="msheet-main">
            <div className="msheet-title">{e.title}</div>
            <div className="msheet-meta">{meta || 'Tap for details'}</div>
            <div className="msheet-chips">
              <HeatBadge e={e} />
              <PriceChip e={e} />
              <SponsoredTag e={e} />
            </div>
          </div>
        </div>
        <button className="msheet-cta pressable" onClick={onDetail}>
          Full details →
        </button>
      </div>
    </div>
  )
}
