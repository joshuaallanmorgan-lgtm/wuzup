// MapView — Leaflet map of all events with coordinates. Map styles live in App.css.
import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export default function MapView({ events, onSelect, active }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const didFitRef = useRef(false)
  useEffect(() => {
    onSelectRef.current = onSelect // markers read the latest handler from a ref —
  }) // marker redraw must NOT depend on a per-render callback identity
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
  // (re)draw markers only when the DATA changes; fitBounds only on first non-empty data
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const markers = []
    for (const e of withCoords) {
      const m = L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: '#0d9488', fillOpacity: 1 })
      m.on('click', () => onSelectRef.current(e))
      m.bindTooltip(e.title, { direction: 'top', offset: [0, -6] })
      m.addTo(layer)
      markers.push(m)
    }
    if (markers.length && !didFitRef.current) {
      didFitRef.current = true
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
    }
  }, [withCoords])
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
