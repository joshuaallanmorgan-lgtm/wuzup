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
//      debounced). One cream-disc divIcon bubble per bucket (gold ring + gold-ink
//      count — 3.7P-5 retune, was solid Sunset Gold; clusters are NAVIGATION,
//      never heat) — sized by log2(count); tap → zoom in 2 on
//      the bucket centroid. O(n) per rebuild: one projection + one Map insert
//      per event, so every event lands in exactly one bucket.
//   J3 pin tap opens the in-page PinSheet (bottom of file) instead of jumping
//      straight to detail; "Full details →" hands off to onSelect(e, null).
//   J4 the map note carries a live "N in view" count of events inside the
//      current bounds (moveend, debounced 150ms).
//
// SPRINT T1 — MAP v2 (cross-layer): the map now shows BOTH supply layers.
//   · LAYER TOGGLE (Events / Spots / Both): a segmented control gates which
//     stores render. Places load lazily via usePlaces() — the /places.json
//     fetch fires only when the Spots/Both segment is first selected (events-
//     only viewers never pay it).
//   · PLACE PINS read DISTINCTLY from event pins: events stay round
//     circleMarkers (J1); places are SQUARE divIcon pins in the category hue.
//     One glance separates "what's happening" from "what's always here".
//   · FILTERS (Josh's ask): a date strip (Any · Today · Tomorrow · Weekend)
//     that gates EVENTS ONLY — a place has no date, so the strip is honestly
//     disabled-looking for the Spots layer (places ignore it); category chips
//     and a Free toggle apply to WHICHEVER layer(s) are shown.
//   · CLUSTERING handles the UNION: the bucket grid buckets the combined
//     visible set; a bucket-of-one renders the right pin type, a multi-bucket
//     is the cream/gold navigation bubble (count of both kinds — it's "more here").
//   · NEVER-HIDE holds: filters reorder/scope what the MAP draws the way the
//     list bubbles already scope a list; the note states the honest counts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getLeaflet } from './leaflet-lazy.js'
import { useNav } from './nav.jsx'
import { CATEGORY_HUES, CardImg, HeatBadge, PriceChip, SponsoredTag } from './cards.jsx'
import { SaveHeart } from './saves.js'
import { CITY, dayLabelLoose, keyOf, startLabel } from './lib.js'
import { CATEGORIES, CATEGORY_EMOJI, PLACETYPE_EMOJI } from './categories.js'
import { usePlaces, isPlaceKey } from './places.js'
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
const CELL = 88 // 3.7P-5: widened from 64 → fewer, gutter'd buckets (declutter the dense metro)
// canvas strokes can't resolve CSS variables — literal mirror of --hot
// (index.css). Fills use the comma HSL form for maximum canvas parser safety.
const HOT = '#ff3b5f'
const hueOf = (e) => CATEGORY_HUES[e.category] ?? CATEGORY_HUES.other
const pinFill = (e) => `hsl(${hueOf(e)}, 70%, 45%)`

// T1 date strip: each option scopes the EVENTS layer to a day window (places
// ignore it — they have no date). 'any' = all upcoming.
const DATE_FILTERS = [
  { id: 'any', label: 'Any day' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'Weekend' },
]
// does an event's [_day.._endDay] span cover the chosen window? (places skip this)
function eventInDateFilter(e, id, anchors) {
  if (id === 'any') return true
  const s = e._day
  const en = e._endDay ?? e._day
  if (s == null) return false // a date filter excludes undated events honestly
  if (id === 'today') return s <= anchors.todayTs && en >= anchors.todayTs
  if (id === 'tomorrow') return s <= anchors.tomorrowTs && en >= anchors.tomorrowTs
  if (id === 'weekend') return s <= anchors.wkEndTs && en >= anchors.wkStartTs
  return true
}

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

export default function MapView({ events, anchors, coords, requestCoords }) {
  // navigation via useNav (O6). Stage R: Map is a SUB-VIEW now — it is "active"
  // when the {type:'map'} subpage is open (was: the Map tab being the active tab).
  const { page, openDetail: onSelect, mapFocus: focusTarget, closePage, openSearch } = useNav()
  const active = page?.type === 'map'
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const youRef = useRef(null) // 3.7P-14: the "you are here" marker (lazy-created)
  const filterSheetRef = useRef(null) // 3.7P-18: filter dialog — focus moves in on open
  const filterBtnRef = useRef(null) // the Filters trigger — focus returns here on close
  const onSelectRef = useRef(onSelect)
  const didFitRef = useRef(false)
  const timersRef = useRef({}) // zoomend/moveend debounce handles
  const [ready, setReady] = useState(false) // map exists (set on first activation)
  const [sheet, setSheet] = useState(null) // J3: event/place previewed in the bottom sheet
  const [inView, setInView] = useState(null) // J4: count in bounds (null until the map exists)
  const [picks, setPicks] = useState([]) // 3.7P-28: top in-view items feeding the decision deck
  const [deckOpen, setDeckOpen] = useState(false) // 3.7P-28: deck expanded (full picks) vs one-pick peek
  // ===== T1 filter state =====
  // layer: null = AUTO (follow context — Events normally, but Both while a
  // place focus is pending so "Open in Map" from a PlaceDetail lands on the
  // place's pin instead of a pinless events-only map). A manual segment tap
  // sets it and wins thereafter. Deriving (not setState-in-effect) keeps the
  // focus→layer sync out of the effect, which the lint rule rightly forbids
  // (a layer set there feeds the effect's own deps → cascade).
  const [layer, setLayer] = useState(null)
  const [dateF, setDateF] = useState('any') // DATE_FILTERS id — gates EVENTS only.
  // 3.7P-18: dateF persists across a Spots-layer detour BY DESIGN — a day you
  // chose resumes when you return to Events/Both, and the re-mounted date button
  // wears its .on highlight so the active scope is always visible (never hidden).
  const [cat, setCat] = useState('all') // a single category id, or 'all'
  const [freeOnly, setFreeOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false) // 3.7P-18: category/free filters live in a sheet now
  const placeFocusing = !!(focusTarget && (focusTarget.kind === 'place' || isPlaceKey(focusTarget.key)))
  const effLayer = layer ?? (placeFocusing ? 'both' : 'events')
  const showEvents = effLayer === 'events' || effLayer === 'both'
  const showPlaces = effLayer === 'places' || effLayer === 'both'
  // lazy places: the fetch fires only once the Spots/Both segment is selected
  const { places } = usePlaces(showPlaces)
  // 3.7P-18: the filter sheet is a real dialog (mirrors LensNav) — focus moves IN
  // on open, returns to the trigger on close, and Tab is trapped while open.
  const closeFilters = () => {
    setFiltersOpen(false)
    filterBtnRef.current?.focus() // WCAG 2.4.3: focus returns to the Filters trigger
  }
  // move focus INTO the filter sheet when it opens (a dialog you can reach)
  useEffect(() => {
    if (filtersOpen) filterSheetRef.current?.focus()
  }, [filtersOpen])
  // R-M3: ONE capture-phase Escape ladder for the whole Map sub-view. This
  // replaces the two separate capture handlers (pin sheet + filter sheet) that
  // BOTH fired on a single Escape — stopPropagation doesn't stop other listeners
  // on the same window/phase, so the filter Escape ALSO closed the pin sheet
  // underneath. Priority: a stacked detail page wins (bail so App closes IT) →
  // filter sheet → pin sheet. When neither overlay is open this effect isn't
  // mounted, so Escape falls through to the nav bubble handler (closes the
  // subpage). The detail guard now covers BOTH overlay paths (was pin-only).
  useEffect(() => {
    if (!sheet && !filtersOpen) return
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      if (document.querySelector('.detail')) return // a stacked detail wins
      ev.stopPropagation()
      if (filtersOpen) closeFilters()
      else if (sheet) setSheet(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sheet, filtersOpen])
  // minimal Tab trap: keep focus within the sheet's controls while it's open
  const filterTrap = (ev) => {
    if (ev.key !== 'Tab') return
    const f = filterSheetRef.current?.querySelectorAll('button')
    if (!f || !f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault()
      first.focus()
    }
  }
  useEffect(() => {
    onSelectRef.current = onSelect // markers read the latest handler from a ref —
  }) // marker redraw must NOT depend on a per-render callback identity
  // pins are for events you can still attend: drop events whose run has ended
  // (undated events stay — they aren't known to be over)
  const upcoming = useMemo(
    () => events.filter((e) => e._day == null || (e._endDay ?? e._day) >= anchors.todayTs),
    [events, anchors]
  )
  // T1: per-layer filtered pins, then the UNION. Events honor the date strip +
  // category + free; places honor category + free (they have no date). Every
  // shown item carries .lat/.lng (the pins/buckets read those identically for
  // both kinds); .kind tells redraw which marker to draw. The category/free
  // chips apply to WHICHEVER layers are on — never-hide: this scopes the map
  // the way a list bubble scopes a list, it doesn't lie about what's out there.
  const eventPins = useMemo(() => {
    if (!showEvents) return []
    const okCat = (e) => cat === 'all' || e.category === cat
    const okFree = (e) => !freeOnly || e._free === true || e.isFree === true
    return upcoming.filter(
      (e) => e.lat != null && e.lng != null && eventInDateFilter(e, dateF, anchors) && okCat(e) && okFree(e)
    )
  }, [showEvents, upcoming, dateF, anchors, cat, freeOnly])
  const placePins = useMemo(() => {
    if (!showPlaces || !Array.isArray(places)) return []
    const okCat = (p) => cat === 'all' || p.category === cat
    const okFree = (p) => !freeOnly || p._free === true || p.isFree === true
    return places.filter((p) => p.lat != null && p.lng != null && okCat(p) && okFree(p))
  }, [showPlaces, places, cat, freeOnly])
  const withCoords = useMemo(() => eventPins.concat(placePins), [eventPins, placePins])
  // the honest denominators for the note: total mappable supply per active layer
  const totalShown = useMemo(() => {
    let n = 0
    if (showEvents) n += upcoming.filter((e) => e.lat != null && e.lng != null).length
    if (showPlaces && Array.isArray(places)) n += places.filter((p) => p.lat != null && p.lng != null).length
    return n
  }, [showEvents, showPlaces, upcoming, places])
  const placesLoading = showPlaces && !Array.isArray(places)

  // J1: category-hue ROUND pin, heat-scaled. Tap → preview sheet (J3), never a
  // page jump. bubblingMouseEvents:false so a pin tap doesn't ALSO fire the map
  // click that closes the sheet (canvas + svg renderers both bubble by default).
  const eventPinFor = (e) => {
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
  // T1: a PLACE pin is a SQUARE divIcon in the category hue — square vs round
  // is the at-a-glance "always here" vs "happening" distinction. No heat ring
  // (places never wear the flame, places.js contract). divIcon (not
  // circleMarker) because canvas can't render a rounded square cheaply; the
  // count is small enough (places.json mappable set) that DOM markers are fine.
  const placePinFor = (p) => {
    const icon = L.divIcon({
      className: 'pl-ico',
      html: `<span class="pl-pin" style="background:hsl(${hueOf(p)},62%,42%)"></span>`,
      iconSize: [14, 14], // Stage R: match .pl-pin (14px) so the pin centers on the coord
      iconAnchor: [7, 7],
    })
    const m = L.marker([p.lat, p.lng], { icon, bubblingMouseEvents: false })
    m.on('click', () => setSheet(p))
    m.bindTooltip(p.title + ' · Spot', { direction: 'top', offset: [0, -8] })
    return m
  }
  // dispatch by kind — a bucket-of-one and the pin-zoom path both route here
  const pinFor = (e) => (e.kind === 'place' ? placePinFor(e) : eventPinFor(e))

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
      // 3.7P-5: smaller + slower curve (was 24 + 8*log2, 37–56px) so a disc sits
      // inside its 88px cell with real gutter — less saturated area per cluster.
      const s = Math.round(Math.min(46, 18 + 6 * Math.log2(b.count + 1))) // 2→28px … big→46px cap
      const icon = L.divIcon({
        className: 'cl-ico',
        html: `<div class="cl-bubble" role="button" aria-label="${b.count} here — tap to zoom" style="width:${s}px;height:${s}px;font-size:${Math.max(11, Math.round(s * 0.42))}px">${b.count}</div>`,
        iconSize: [s, s], // anchor defaults to the center
      })
      const m = L.marker(center, { icon, bubblingMouseEvents: false })
      // animate:false — UI_SPEC §3 keeps the map un-animated (same call the
      // focus effect makes), and the jump reads as navigation, not motion
      m.on('click', () => map.setView(center, Math.min(map.getZoom() + 2, 19), { animate: false }))
      layer.addLayer(m)
    }
  }
  // J4 / 3.7P-28: scan the current bounds ONCE — it feeds BOTH the honest in-view
  // count AND the decision deck's top picks, so a pan updates them together. Picks
  // are "curated" by a REAL signal: event buzz, with a hot ring counting double.
  // Places carry no heat (places.js contract) so they score 0 — on a Spots view
  // the deck is an honest "what's here" list and its header drops the "Top" claim
  // (D6). Capped at 8: the deck never holds the whole in-view set (a metro view
  // can be hundreds), and never-hide still holds — every pin stays on the map.
  const countInView = () => {
    const map = mapRef.current
    if (!map) return
    const b = map.getBounds()
    const vis = []
    for (const e of withCoords) if (b.contains([e.lat, e.lng])) vis.push(e)
    setInView(vis.length)
    const scored = vis
      .map((e) => ({
        e,
        s: e.kind === 'place' ? 0 : (typeof e.buzz === 'number' ? e.buzz : 0) + (e.buzz >= 3 ? 5 : 0),
      }))
      .sort((a, z) => z.s - a.s)
      .slice(0, 8)
    setPicks(scored.map((x) => x.e))
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
    // T1: a place focus (from PlaceDetail's "Open in Map") shows the Spots
    // layer automatically — `effLayer` flips to Both while the focus is pending
    // (derived above, not set here), so usePlaces loads + the pin draws; this
    // effect re-runs on the showPlaces/places deps and then opens its sheet.
    const map = mapRef.current
    if (!map) return
    didFitRef.current = true // the focused view IS the view — never fit-to-all over it
    map.setView([focusTarget.lat, focusTarget.lng], 15, { animate: false })
    setSheet(focusTarget.key ? (coordsRef.current.find((e) => keyOf(e) === focusTarget.key) ?? null) : null)
  }, [focusTarget, ready, showPlaces, places])

  const num = (n) => n.toLocaleString('en-US')
  const noun = effLayer === 'events' ? 'events' : effLayer === 'places' ? 'spots' : 'pins'
  // 3.7P-18 / R-M2: how many filters are active, for the Filters button badge.
  // Category + Free always count; the date scope counts ONLY when events are
  // shown — a date filter is meaningless on the pure-Spots layer (places have no
  // date), so counting it there would make the badge lie about the Spots view.
  const activeFilterCount =
    (cat !== 'all' ? 1 : 0) + (freeOnly ? 1 : 0) + (showEvents && dateF !== 'any' ? 1 : 0)

  // 3.7P-14: recenter on the user. With a cached fix, jump straight there; else
  // ask (App's requestCoords resolves to coords or null). A denial resolves null
  // → no-op (the map stays put — graceful, never an error). Drops/moves a passive
  // "you are here" dot so the recenter is legible.
  const goNearMe = () => {
    const map = mapRef.current
    if (!map || !L) return
    const apply = (c) => {
      if (!c || c.lat == null || c.lng == null) return
      map.setView([c.lat, c.lng], 14, { animate: false })
      if (youRef.current) youRef.current.setLatLng([c.lat, c.lng])
      else
        youRef.current = L.marker([c.lat, c.lng], {
          icon: L.divIcon({ className: 'map-you-ico', html: '<span class="map-you"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
          interactive: false,
          keyboard: false,
        }).addTo(map)
    }
    if (coords) apply(coords)
    else if (requestCoords) requestCoords().then(apply)
  }

  // 3.7P-28: the decision deck — a docked card answering "what should I do in
  // THIS view?" without hunting pin to pin. A pick taps straight into the map's
  // OWN flow (pan + the existing PinSheet preview), never a parallel one. The
  // emoji mirrors the pin's identity: category for events, placeType for spots.
  const pickEmoji = (e) =>
    e.kind === 'place' ? PLACETYPE_EMOJI[e.placeType] ?? '📍' : CATEGORY_EMOJI[e.category] ?? '⭐'
  const pickMeta = (e) =>
    e.kind === 'place'
      ? 'Spot'
      : e._ongoing
        ? 'Ongoing'
        : [dayLabelLoose(e), startLabel(e)].filter(Boolean).join(' · ') || 'Tap for details'
  const onPickTap = (p) => {
    const map = mapRef.current
    if (map && p.lat != null && p.lng != null) {
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), PIN_ZOOM), { animate: true })
    }
    setSheet(p) // the SAME preview a marker tap opens (the deck hides while it's up)
  }
  const expandable = picks.length > 1
  // Stage R: the deck shows a few picks BY DEFAULT (benchmark), expanding to the
  // full capped top-8 on "View all in this area".
  const PEEK = 3
  const deckList = deckOpen ? picks.slice(0, 8) : picks.slice(0, PEEK)
  // header honesty (D6 / R-M4): "Top picks" only earns the word when a VISIBLE
  // pick is a ranked event (carries buzz); a flat / pure-spots view stays the
  // honest "In this area". Gate on deckList (what's actually rendered) rather
  // than the full picks array: today picks is score-sorted desc so a ranked
  // event always lands in the leading peek (the two checks coincide), but tying
  // the label to the shown rows keeps it honest if the ordering/cap ever changes.
  const ranked = deckList.some((p) => p.kind !== 'place' && (p.buzz || 0) > 0)
  const countLabel =
    inView == null
      ? `${num(withCoords.length)} ${noun} on the map`
      : inView === 0
        ? 'Nothing mapped in this view'
        : `${num(inView)} ${inView === 1 ? 'thing' : 'things'} around ${CITY.name}`
  const supplyLabel = `${num(withCoords.length)}/${num(totalShown)} ${noun} mapped`
  const deckHead = (
    <>
      <span className="map-deck-titlerow">
        <span className="map-deck-count">{countLabel}</span>
        {expandable && (
          <span className="map-deck-chev" aria-hidden>
            {deckOpen ? '▴' : '▾'}
          </span>
        )}
      </span>
      <span className="map-deck-supply">{supplyLabel}</span>
    </>
  )

  return (
    <div className="map-wrap">
      <div ref={elRef} className="map" />

      {/* Stage R: Map is a sub-view (subpage) now — a back button closes it back
          to Events/Spots (Escape also closes it via the nav bubble handler). */}
      <button className="map-back pressable" onClick={closePage} aria-label="Back">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {/* ===== map toolbar (overlays the top). R-M1/R-M2: a search bar matching
          Events/Spots (row 1) → into the global SearchPage, the layer toggle (row
          2), and an actions row with ALL filters behind one button (dates moved in
          too) + Near me. The date strip + 12-chip sprawl no longer sit on the map. ===== */}
      <div className="map-tools">
        {/* R-M1: the search bar — the same .loc-search affordance Events/Spots use */}
        <button
          className="loc-search map-search pressable"
          onClick={openSearch}
          aria-label="Search events and spots"
        >
          <span className="loc-search-ic" aria-hidden>🔎</span>
          <span className="loc-search-ph">Search events, spots, vibes…</span>
        </button>
        {/* layer toggle — events / spots / both */}
        <div className="map-seg" role="group" aria-label="Map layer">
          {[
            ['events', 'Events'],
            ['places', 'Spots'],
            ['both', 'Both'],
          ].map(([id, lbl]) => (
            <button
              key={id}
              className={'map-seg-btn' + (effLayer === id ? ' on' : '')}
              aria-pressed={effLayer === id}
              onClick={() => setLayer(id)}
            >
              {lbl}
            </button>
          ))}
        </div>
        {/* R-M1/R-M2: actions row — the Filters button (now holds date + category +
            Free behind a sliders glyph) and Near me. */}
        <div className="map-tools-actions">
          <button
            ref={filterBtnRef}
            className={'map-filter-btn pressable' + (activeFilterCount > 0 ? ' on' : '')}
            onClick={() => setFiltersOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
          >
            {/* R-M1: horizontal-lines / sliders glyph (was a ⚙️ gear) */}
            <span className="map-filter-ic" aria-hidden>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
            </span>
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </button>
          <button
            className="map-near pressable"
            onClick={goNearMe}
            aria-label="Center the map on your location"
          >
            <span aria-hidden>📍</span> Near me
          </button>
        </div>
      </div>

      {/* 3.7P-18: the filter sheet — category + Free, opened from the Filters
          button. Tapping a chip toggles it (the sheet stays open so you can set
          several); scrim / ✕ / Done / Escape close it. Real dialog: focus moves
          in on open, traps on Tab, and returns to the trigger on close. */}
      {filtersOpen && (
        <div className="map-filter-wrap">
          <button className="map-filter-scrim" aria-label="Close filters" onClick={closeFilters} />
          <div
            className="map-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Map filters"
            ref={filterSheetRef}
            tabIndex={-1}
            onKeyDown={filterTrap}
          >
            <div className="map-filter-head">
              <div className="map-filter-title">Filters</div>
              <button className="map-filter-close pressable" onClick={closeFilters} aria-label="Close">
                ✕
              </button>
            </div>
            {/* R-M2: the date scope lives in the sheet now. It gates EVENTS only —
                a place has no date — so on the Spots layer it's an honest note
                instead of dead buttons. */}
            <div className="map-filter-group">
              <div className="map-filter-grouplab">When</div>
              {showEvents ? (
                <div className="map-filter-dates">
                  {DATE_FILTERS.map((d) => (
                    <button
                      key={d.id}
                      className={'map-chip' + (dateF === d.id ? ' on' : '')}
                      aria-pressed={dateF === d.id}
                      onClick={() => setDateF(d.id)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="map-filter-note">🗓️ Dates apply to events — switch on the Events layer to filter by day.</div>
              )}
            </div>
            <div className="map-filter-group">
              <div className="map-filter-grouplab">Category &amp; price</div>
              <div className="map-chips map-filter-chips">
                <button
                  className={'map-chip map-chip-free' + (freeOnly ? ' on' : '')}
                  aria-pressed={freeOnly}
                  onClick={() => setFreeOnly((v) => !v)}
                >
                  🆓 Free
                </button>
                <button className={'map-chip' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>
                  All
                </button>
                {CATEGORIES.filter((c) => c.id !== 'other').map((c) => (
                  <button
                    key={c.id}
                    className={'map-chip' + (cat === c.id ? ' on' : '')}
                    aria-pressed={cat === c.id}
                    onClick={() => setCat((v) => (v === c.id ? 'all' : c.id))}
                  >
                    <span aria-hidden>{c.emoji}</span> {c.label}
                  </button>
                ))}
              </div>
            </div>
            <button className="map-filter-done pressable" onClick={closeFilters}>
              Done
            </button>
          </div>
        </div>
      )}

      {!sheet &&
        (placesLoading && layer === 'places' ? (
          <div className="map-deck">
            <div className="map-deck-head">
              <span className="map-deck-titlerow">
                <span className="map-deck-count">Loading spots…</span>
              </span>
            </div>
          </div>
        ) : (
          <div className={'map-deck' + (deckOpen ? ' open' : '')}>
            {expandable ? (
              <button
                className="map-deck-head map-deck-toggle"
                onClick={() => setDeckOpen((v) => !v)}
                aria-expanded={deckOpen}
                aria-label={deckOpen ? 'Hide top picks in this area' : 'Show top picks in this area'}
              >
                {deckHead}
              </button>
            ) : (
              <div className="map-deck-head">{deckHead}</div>
            )}
            {picks.length > 0 && (
              <div className="map-deck-list">
                {/* Stage R: the label shows by default above the picks (benchmark). */}
                <div className="map-deck-label">{ranked ? 'Top picks in this area' : 'In this area'}</div>
                {deckList.map((p) => (
                  <button key={keyOf(p)} className="map-deck-pick pressable" onClick={() => onPickTap(p)}>
                    <span className="map-deck-emoji" aria-hidden>
                      {pickEmoji(p)}
                    </span>
                    <span className="map-deck-pick-main">
                      <span className="map-deck-pick-title">{p.title}</span>
                      <span className="map-deck-pick-meta">{pickMeta(p)}</span>
                    </span>
                    <span className="map-deck-go" aria-hidden>
                      ›
                    </span>
                  </button>
                ))}
                {/* Stage R: "View all in this area" reveals the full set of TOP
                    picks (capped at 8); the count line above shows the true total,
                    so "view all" reads as "view all the top picks" (honest, never
                    implies the deck holds every in-view pin). */}
                {expandable &&
                  (picks.length > deckList.length ? (
                    <button className="map-deck-more" onClick={() => setDeckOpen(true)}>
                      View all in this area
                    </button>
                  ) : deckOpen && picks.length > PEEK ? (
                    <button className="map-deck-more" onClick={() => setDeckOpen(false)}>
                      Show fewer
                    </button>
                  ) : null)}
              </div>
            )}
          </div>
        ))}
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
  // T1: a PLACE has no date — its meta is the honest "always here" line, never
  // a fabricated time; events keep their day/time/ongoing meta. The chips row
  // also branches: a place wears no heat/sponsored (places.js contract).
  const isPlace = e.kind === 'place'
  const meta = (
    isPlace
      ? ['Always here · no schedule', e.venue]
      : e._ongoing
        ? ['Ongoing', e.venue]
        : [dayLabelLoose(e), startLabel(e), e.venue]
  )
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
              {isPlace ? (
                <>
                  <span className="msheet-spot-tag">📍 Spot</span>
                  {e.isFree === true && <PriceChip e={e} />}
                </>
              ) : (
                <>
                  <HeatBadge e={e} />
                  <PriceChip e={e} />
                  <SponsoredTag e={e} />
                </>
              )}
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
