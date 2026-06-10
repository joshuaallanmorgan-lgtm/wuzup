// MapView — Leaflet map of upcoming events with coordinates. Map styles live in
// App.css. The map (and its markers) is created lazily on the FIRST activation
// of the Map tab — never at boot — and uses canvas rendering for marker count.
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export default function MapView({ events, anchors, onSelect, active }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const didFitRef = useRef(false)
  const [ready, setReady] = useState(false) // map exists (set on first activation)
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
  // create the map exactly once, on first activation of the tab
  useEffect(() => {
    if (!active || mapRef.current || !elRef.current) return
    const map = L.map(elRef.current, { zoomControl: false, preferCanvas: true }).setView([27.95, -82.46], 10)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap © CARTO',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    setReady(true)
  }, [active])
  // (re)draw markers only when the DATA changes (or the map first exists);
  // fitBounds only on first non-empty data
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!ready || !map || !layer) return
    layer.clearLayers()
    const markers = []
    for (const e of withCoords) {
      const m = L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: '#0d9488', fillOpacity: 1 })
      m.on('click', () => onSelectRef.current(e))
      m.bindTooltip(e.title + (e.sponsored === true ? ' · Sponsored' : ''), { direction: 'top', offset: [0, -6] })
      m.addTo(layer)
      markers.push(m)
    }
    if (markers.length && !didFitRef.current) {
      didFitRef.current = true
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
    }
  }, [withCoords, ready])
  useEffect(() => {
    if (active && mapRef.current) setTimeout(() => mapRef.current.invalidateSize(), 80)
  }, [active])
  return (
    <div className="map-wrap">
      <div ref={elRef} className="map" />
      <div className="map-note">{withCoords.length} of {upcoming.length} upcoming events on the map</div>
    </div>
  )
}
