// App — shell: data fetch + normalize, anchors, pager + tabbar, subpage mounting
// (BubblePage / SearchPage / FindMyNight), detail open/close (View Transitions),
// geolocation (requestCoords), and display-mode state (localStorage 'display-mode').
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CITY, Icon, keyOf, loadMyEvents, makeAnchors, normalize, rawOf, saveMyEvents } from './lib.js'
import { recordSignal } from './taste.js'
import { recordView } from './recents.js'
import Primer, { loadPrimerState } from './Primer.jsx'
import { DISPLAY_MODES, DisplayModeContext, DisplayModeToggle, WxContext } from './cards.jsx'
import { getForecast } from './weather.js'
import HotView from './HotView.jsx'
import MapView from './MapView.jsx'
import CalendarView from './CalendarView.jsx'
import DetailPage from './DetailPage.jsx'
import BubblePage from './BubblePage.jsx'
import SearchPage from './SearchPage.jsx'
import FindMyNight from './FindMyNight.jsx'
import AddEvent from './AddEvent.jsx'
import './App.css'

const VIEWS = [
  { id: 'hot', label: 'Hot' },
  { id: 'map', label: 'Map' },
  { id: 'calendar', label: 'Calendar' },
]

function TabBar({ active, onTab }) {
  return (
    <nav className="tabbar">
      {VIEWS.map((v, i) => {
        const I = Icon[v.id]
        return (
          <button
            key={v.id}
            className={'tab' + (active === i ? ' active' : '') + (v.id === 'hot' ? ' tab-hot' : '')}
            onClick={() => onTab(i)}
          >
            <I className="tab-ic" width="24" height="24" />
            <span className="tab-label">{v.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

const supportsVT = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [bootVis, setBootVis] = useState(false) // boot overlay gated 300ms (no flash on fast loads)
  const [active, setActive] = useState(0)
  const [detail, setDetail] = useState(null)
  const [closing, setClosing] = useState(false)
  const [vtOpen, setVtOpen] = useState(false)
  // subpage overlay: null | {type:'bubble',bubble} | {type:'search'} | {type:'night'} | {type:'add'}
  const [page, setPage] = useState(null)
  const [pageClosing, setPageClosing] = useState(false)
  const [coords, setCoords] = useState(null)
  // display mode: 'editorial' | 'poster' | 'cinematic', persisted to localStorage
  const [displayMode, setDisplayMode] = useState(() => {
    try {
      const v = localStorage.getItem('display-mode')
      return DISPLAY_MODES.includes(v) ? v : 'editorial'
    } catch {
      return 'editorial'
    }
  })
  // H1 mood primer: mounts while no stored state exists (first open only).
  // Primer.jsx owns 'primer-v1' + the taste seeding; App only gates the mount
  // and passes the when-preference down for the H2 greeting flavor.
  const [primer, setPrimer] = useState(() => loadPrimerState())
  const pagerRef = useRef(null)
  const morphElRef = useRef(null)
  const pageTRef = useRef(null)
  const coordsRef = useRef(null)

  useEffect(() => {
    fetch('/events.json')
      .then((r) => r.json())
      .then((d) => setEvents(Array.isArray(d) ? d : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setBootVis(true), 300)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('display-mode', displayMode)
    } catch {
      /* private mode etc. — mode still works for the session */
    }
  }, [displayMode])

  // anchors must track the real clock: an app left open past midnight (or
  // resumed from background the next day) would otherwise show yesterday's
  // "Today". Recompute when the tab becomes visible and shortly after each
  // local midnight; only re-set state when the day actually rolled over.
  const [anchors, setAnchors] = useState(() => makeAnchors())
  useEffect(() => {
    const refresh = () => setAnchors((prev) => {
      const next = makeAnchors()
      return next.todayTs === prev.todayTs ? prev : next
    })
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    let timer
    const schedule = () => {
      const now = new Date()
      // 30s past local midnight (cushion for clock skew / timer coalescing)
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30)
      timer = setTimeout(() => {
        refresh()
        schedule()
      }, next.getTime() - now.getTime())
    }
    schedule()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearTimeout(timer)
    }
  }, [])
  // "Added by you" events (Sprint C MVP): raw schema-v2 objects from the
  // AddEvent form, persisted to localStorage 'my-events-v1' and concat'd into
  // norm below — same normalize() path as fetched events, so they surface
  // everywhere list-wise (feed, bubbles, search, calendar; lat/lng null → no
  // map pin). rawOf strips computed _fields when an undo restores a
  // normalized copy, keeping storage pure schema-v2.
  const [myEvents, setMyEvents] = useState(loadMyEvents)
  useEffect(() => {
    saveMyEvents(myEvents)
  }, [myEvents])
  // Re-read storage inside the setters: a stale tab must never clobber another
  // tab's adds. Duplicate adds (same title+date, no URL → same key) are no-ops.
  const addMine = useCallback((raw) => {
    setMyEvents(() => {
      const fresh = loadMyEvents()
      const r = rawOf(raw)
      if (fresh.some((x) => keyOf(x) === keyOf(r))) return fresh
      return [...fresh, r]
    })
  }, [])
  const removeMine = useCallback((e) => {
    const k = keyOf(e)
    setMyEvents(() => loadMyEvents().filter((x) => keyOf(x) !== k))
  }, [])
  const norm = useMemo(() => [...events, ...myEvents].map((e) => normalize(e, anchors)), [events, myEvents, anchors])
  const displayCtx = useMemo(() => ({ mode: displayMode, setMode: setDisplayMode }), [displayMode])

  // 16-day Tampa forecast, fetched ONCE at App level (was CalendarView-local):
  // CalendarView (prop), DetailPage (prop) and outdoor feed rows (WxContext)
  // all read the same map. null = no weather, every consumer degrades silently.
  const [wx, setWx] = useState(null)
  useEffect(() => {
    let on = true
    getForecast().then((m) => {
      if (on && m) setWx(m)
    })
    return () => {
      on = false
    }
  }, [])

  const goTo = (i) => {
    setActive(i)
    const p = pagerRef.current
    // instant jump: never slide through intermediate pages (finger-swipe snap unaffected)
    if (p) p.scrollTo({ left: i * p.clientWidth, behavior: 'instant' })
  }
  const onScroll = () => {
    const p = pagerRef.current
    if (!p) return
    const i = Math.round(p.scrollLeft / p.clientWidth)
    if (i !== active) setActive(i)
  }

  // detail mini-map tap → close the detail + any subpage, jump to the Map tab,
  // and hand MapView a focus target ({lat,lng,key}; fresh object every call so
  // re-focusing the same event re-runs MapView's focus effect).
  const [mapFocus, setMapFocus] = useState(null)
  const focusMap = (e) => {
    morphElRef.current = null // card name is already cleared post-open; just drop the ref
    setDetail(null)
    setClosing(false)
    setVtOpen(false)
    clearTimeout(pageTRef.current)
    setPage(null)
    setPageClosing(false)
    setMapFocus({ lat: e.lat, lng: e.lng, key: keyOf(e) })
    goTo(1)
  }

  // geolocation lifted into App so any page can ask: resolves to coords or null
  // (denied / unsupported). Last fix is cached and also exposed via the coords prop.
  const requestCoords = useCallback(() => {
    return new Promise((resolve) => {
      if (coordsRef.current) return resolve(coordsRef.current)
      if (!navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const c = { lat: p.coords.latitude, lng: p.coords.longitude }
          coordsRef.current = c
          setCoords(c)
          resolve(c)
        },
        () => resolve(null)
      )
    })
  }, [])

  // subpages: slide in over the Hot tab (z 1500, below detail 2000)
  const openBubble = useCallback((bubble) => {
    // taste seam: tapping a CATEGORY bubble is a (weak) interest signal;
    // time/free/near bubbles say nothing about category taste
    if (bubble.kind === 'cat') recordSignal('bubble', { category: bubble.value })
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'bubble', bubble })
  }, [])
  const openSearch = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'search' })
  }, [])
  const openNight = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'night' })
  }, [])
  const openAdd = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'add' })
  }, [])
  const closePage = useCallback(() => {
    setPageClosing(true)
    clearTimeout(pageTRef.current)
    pageTRef.current = setTimeout(() => {
      setPage(null)
      setPageClosing(false)
    }, 400)
  }, [])
  useEffect(() => () => clearTimeout(pageTRef.current), [])

  // detail open/close with App-Store morph: View Transitions when available, slide-up otherwise.
  // useCallback: a stable identity so MapView's marker effect never re-runs because of us.
  const openDetail = useCallback((e, cardEl) => {
    recordSignal('open', e) // taste seam: opening a detail = +1 category interest
    recordView(e) // recents seam (H3): FIFO 'recents-v1' + the in-session list (H4)
    setClosing(false)
    const el = cardEl ? cardEl.querySelector('[data-vt]') : null
    if (supportsVT() && el) {
      morphElRef.current = el
      el.style.viewTransitionName = 'evt-hero' // old snapshot: the card image owns the name
      document.startViewTransition(() => {
        el.style.viewTransitionName = '' // new snapshot: only the detail hero owns it
        flushSync(() => {
          setVtOpen(true)
          setDetail(e)
        })
      })
    } else {
      morphElRef.current = null
      setVtOpen(false)
      setDetail(e)
    }
  }, [])
  const closeDetail = useCallback(() => {
    const el = morphElRef.current
    if (vtOpen && supportsVT()) {
      const t = document.startViewTransition(() => {
        flushSync(() => setDetail(null))
        if (el && el.isConnected) el.style.viewTransitionName = 'evt-hero'
      })
      t.finished.finally(() => {
        if (el) el.style.viewTransitionName = ''
        morphElRef.current = null
      })
    } else {
      setClosing(true)
      setTimeout(() => {
        setDetail(null)
        setClosing(false)
      }, 240)
    }
  }, [vtOpen])

  // Escape closes the topmost layer: detail first, then any open subpage
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      if (detail) closeDetail()
      else if (page && !pageClosing) closePage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, page, pageClosing, closeDetail, closePage])

  return (
    <DisplayModeContext.Provider value={displayCtx}>
      <WxContext.Provider value={wx}>
      <div className="app">
        {/* inert while the primer overlay is up: Tab must not reach (and Enter
            must not activate) the obscured app behind it */}
        <div className="pager" ref={pagerRef} onScroll={onScroll} inert={!primer ? true : undefined}>
          <section className="page page-hot">
            <HotView
              events={norm}
              anchors={anchors}
              loading={loading}
              displayMode={displayMode}
              whenPref={primer?.when ?? null}
              onSelect={openDetail}
              onOpenBubble={openBubble}
              onOpenSearch={openSearch}
              onOpenAdd={openAdd}
            />
          </section>
          <section className="page page-map">
            <MapView events={norm} anchors={anchors} onSelect={openDetail} active={active === 1} focusTarget={mapFocus} />
          </section>
          <section className="page">
            <CalendarView events={norm} anchors={anchors} onSelect={openDetail} wx={wx} />
          </section>
        </div>
        <TabBar active={active} onTab={goTo} />
        {active === 0 && norm.length > 0 && (
          <button className="dice" onClick={openNight} aria-label="Find my night">
            🎲
          </button>
        )}
        {/* 🎨 pill hides while Find My Night is open — it floats dead over the dark flow */}
        {active === 0 && page?.type !== 'night' && page?.type !== 'add' && <DisplayModeToggle />}
        {page && (
          <div className={'subpage' + (pageClosing ? ' subpage-closing' : '')}>
            {page.type === 'bubble' && (
              <BubblePage
                bubble={page.bubble}
                events={norm}
                anchors={anchors}
                coords={coords}
                requestCoords={requestCoords}
                onSelect={openDetail}
                onClose={closePage}
              />
            )}
            {page.type === 'search' && (
              <SearchPage events={norm} anchors={anchors} coords={coords} onSelect={openDetail} onClose={closePage} />
            )}
            {page.type === 'night' && (
              <FindMyNight events={norm} anchors={anchors} coords={coords} onSelect={openDetail} onClose={closePage} />
            )}
            {page.type === 'add' && (
              <AddEvent anchors={anchors} myEvents={myEvents} onAdd={addMine} onClose={closePage} />
            )}
          </div>
        )}
        {/* H1: first open only — Primer persists its own state + seeds taste;
            onDone hands the saved state back so the gate closes for good */}
        {!primer && <Primer onDone={setPrimer} />}
        {/* keyed by event: a More-like-this swap REMOUNTS the detail (scroll resets
            to top, mini-map is destroyed + rebuilt for the new coords) */}
        {detail && (
          <DetailPage
            key={keyOf(detail)}
            e={detail}
            events={norm}
            anchors={anchors}
            wx={wx}
            closing={closing}
            vt={vtOpen}
            onClose={closeDetail}
            onSelect={openDetail}
            onFocusMap={focusMap}
            onRemoveMine={removeMine}
            onRestoreMine={addMine}
          />
        )}
        {loading && bootVis && <div className="boot">Loading {CITY.name}…</div>}
      </div>
      </WxContext.Provider>
    </DisplayModeContext.Provider>
  )
}
